-- Fence persisted competitor observations by the exact matcher contract that
-- admitted them. Legacy automatic rows remain available for audit, but only
-- manual observations and rows produced by the current strict matcher are
-- returned to the application.
-- Rollout order: deploy the version-tagging producer before applying this
-- migration. The previous recorder safely ignores the extra JSON field.

begin;

alter table sellerpilot_private.competitor_price_observations
  add column if not exists matcher_version text;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'competitor_price_observations_matcher_version_check'
       and conrelid = 'sellerpilot_private.competitor_price_observations'::regclass
  ) then
    alter table sellerpilot_private.competitor_price_observations
      add constraint competitor_price_observations_matcher_version_check
      check (
        matcher_version is null
        or matcher_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      ) not valid;
  end if;
end;
$$;

alter table sellerpilot_private.competitor_price_observations
  validate constraint competitor_price_observations_matcher_version_check;

comment on column sellerpilot_private.competitor_price_observations.matcher_version is
  'Exact automatic same-product matcher contract. NULL denotes legacy or manual provenance.';

create index if not exists competitor_prices_current_matcher_idx
  on sellerpilot_private.competitor_price_observations
     (product_id, marketplace, checked_at desc, price, id)
  where provider = 'manual'
     or matcher_version = 'strict-2026-08-27-v1';

create or replace function public.sellerpilot_service_record_competitor_prices(
  p_product_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_count integer := 0;
  v_external text;
  v_marketplace text;
  v_provider text;
  v_currency text;
  v_matcher_version text;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid competitor prices';
  end if;
  if not exists(
    select 1
      from sellerpilot_private.products
     where id = p_product_id
       and status <> 'archived'
       and competitor_monitor_enabled
  ) then
    return 0;
  end if;

  for v in select value from jsonb_array_elements(p_items) loop
    v_external := left(coalesce(nullif(trim(v->>'externalId'),''),md5(coalesce(v->>'url',''))),500);
    v_marketplace := coalesce(nullif(v->>'marketplace',''),'other');
    v_provider := coalesce(nullif(v->>'provider',''),'naver_shopping');
    v_currency := upper(coalesce(nullif(v->>'currency',''),'KRW'));
    v_matcher_version := case
      when v_provider = 'manual' then null
      else nullif(trim(v->>'matcherVersion'), '')
    end;

    if v_marketplace not in ('smartstore','coupang','elevenst','qoo10','shopee','lazada','ebay','temu','other') then
      v_marketplace := 'other';
    end if;
    if v_provider not in ('naver_shopping','elevenst_product_search','ebay_browse','brave_marketplace_web','manual') then
      raise exception 'invalid competitor provider';
    end if;
    if v_provider <> 'manual'
       and v_matcher_version is distinct from 'strict-2026-08-27-v1' then
      raise exception 'invalid competitor matcher version';
    end if;
    if v_currency !~ '^[A-Z]{3}$' then
      raise exception 'invalid competitor currency';
    end if;
    if coalesce((v->>'price')::numeric,-1) < 0 then
      continue;
    end if;

    insert into sellerpilot_private.competitor_price_observations(
      product_id,provider,external_id,title,product_url,image_url,mall_name,
      marketplace,price,currency,checked_at,matcher_version
    ) values (
      p_product_id,v_provider,v_external,left(coalesce(v->>'title','상품'),1000),left(coalesce(v->>'url',''),4000),
      nullif(left(coalesce(v->>'imageUrl',''),4000),''),left(coalesce(v->>'mallName',''),240),v_marketplace,
      (v->>'price')::numeric,v_currency,now(),v_matcher_version
    )
    on conflict(product_id,provider,external_id) do update
      set title=excluded.title,
          product_url=excluded.product_url,
          image_url=excluded.image_url,
          mall_name=excluded.mall_name,
          marketplace=excluded.marketplace,
          price=excluded.price,
          currency=excluded.currency,
          checked_at=now(),
          matcher_version=excluded.matcher_version;
    v_count := v_count + 1;
  end loop;

  update sellerpilot_private.products
     set competitor_checked_at = now()
   where id = p_product_id;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb)
  to service_role;

create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_prices jsonb;
begin
  v_result := public.sellerpilot_get_product_operations_v2_pre_freshness(p_product_id);
  if v_result is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'title', ranked.title,
    'url', ranked.product_url,
    'imageUrl', ranked.image_url,
    'mallName', ranked.mall_name,
    'marketplace', ranked.marketplace,
    'price', ranked.price,
    'currency', ranked.currency,
    'checkedAt', ranked.checked_at
  ) order by ranked.marketplace, ranked.price, ranked.checked_at desc), '[]'::jsonb)
    into v_prices
    from (
      select cp.*,
             row_number() over(
               partition by cp.marketplace
               order by (cp.provider = 'manual') desc, cp.checked_at desc, cp.price, cp.id
             ) as market_rank
        from sellerpilot_private.competitor_price_observations cp
       where cp.product_id = p_product_id
         and (
           cp.provider = 'manual'
           or (
             cp.matcher_version = 'strict-2026-08-27-v1'
             and cp.checked_at >= now() - interval '7 days'
           )
         )
    ) ranked
   where ranked.market_rank <= 3;

  return jsonb_set(v_result, '{competitorPrices}', v_prices, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_operations_v2(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid)
  to authenticated;

commit;
