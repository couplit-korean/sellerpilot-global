-- Admit the server-only marketplace web-search provider into the durable
-- competitor-price snapshot path. Existing lease fencing and seven-day
-- retention semantics remain unchanged.

begin;

alter table sellerpilot_private.competitor_price_observations
  drop constraint if exists competitor_price_observations_provider_check;

alter table sellerpilot_private.competitor_price_observations
  add constraint competitor_price_observations_provider_check
  check (provider in (
    'naver_shopping',
    'elevenst_product_search',
    'ebay_browse',
    'brave_marketplace_web',
    'manual'
  ));

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

    if v_marketplace not in ('smartstore','coupang','elevenst','qoo10','shopee','lazada','ebay','temu','other') then
      v_marketplace := 'other';
    end if;
    if v_provider not in ('naver_shopping','elevenst_product_search','ebay_browse','brave_marketplace_web','manual') then
      raise exception 'invalid competitor provider';
    end if;
    if v_currency !~ '^[A-Z]{3}$' then
      raise exception 'invalid competitor currency';
    end if;
    if coalesce((v->>'price')::numeric,-1) < 0 then
      continue;
    end if;

    insert into sellerpilot_private.competitor_price_observations(
      product_id,provider,external_id,title,product_url,image_url,mall_name,marketplace,price,currency,checked_at
    ) values (
      p_product_id,v_provider,v_external,left(coalesce(v->>'title','상품'),1000),left(coalesce(v->>'url',''),4000),
      nullif(left(coalesce(v->>'imageUrl',''),4000),''),left(coalesce(v->>'mallName',''),240),v_marketplace,
      (v->>'price')::numeric,v_currency,now()
    )
    on conflict(product_id,provider,external_id) do update
      set title=excluded.title,
          product_url=excluded.product_url,
          image_url=excluded.image_url,
          mall_name=excluded.mall_name,
          marketplace=excluded.marketplace,
          price=excluded.price,
          currency=excluded.currency,
          checked_at=now();
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

create or replace function public.sellerpilot_service_complete_competitor_price_refresh(
  p_product_id uuid,
  p_claim_token uuid,
  p_items jsonb,
  p_providers jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_provider text;
begin
  if p_items is null
     or p_providers is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 30
     or jsonb_typeof(p_providers) <> 'array'
     or jsonb_array_length(p_providers) < 1
     or jsonb_array_length(p_providers) > 4
     or exists (
       select 1
         from jsonb_array_elements(p_providers) provider(value)
        where jsonb_typeof(provider.value) <> 'object'
           or coalesce(provider.value->>'provider', '') not in (
             'naver_shopping',
             'elevenst_product_search',
             'ebay_browse',
             'brave_marketplace_web'
           )
           or coalesce(provider.value->>'status', '') not in ('searched', 'unavailable', 'failed')
           or case
                when coalesce(provider.value->>'count', '') ~ '^\d{1,6}$'
                  then (provider.value->>'count')::integer not between 0 and 100000
                else true
              end
     )
     or not exists (
       select 1
         from jsonb_array_elements(p_providers) provider(value)
        where provider.value->>'status' = 'searched'
     )
     or (
       select count(*) <> count(distinct provider.value->>'provider')
         from jsonb_array_elements(p_providers) provider(value)
     )
     or (
       jsonb_array_length(p_items) = 0
       and exists (
         select 1
           from jsonb_array_elements(p_providers) provider(value)
          where provider.value->>'status' = 'searched'
            and coalesce(provider.value->>'count', '') <> '0'
       )
     )
     or exists (
       select 1
         from jsonb_array_elements(p_items) item(value)
        where jsonb_typeof(item.value) <> 'object'
           or coalesce(item.value->>'provider', '') not in (
             'naver_shopping',
             'elevenst_product_search',
             'ebay_browse',
             'brave_marketplace_web'
           )
           or not exists (
             select 1
               from jsonb_array_elements(p_providers) provider(value)
              where provider.value->>'provider' = item.value->>'provider'
                and provider.value->>'status' = 'searched'
                and provider.value->>'count' <> '0'
           )
     ) then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  -- Preserve the existing product -> refresh-claim lock order so a stale
  -- worker cannot complete after its lease has been reclaimed.
  perform 1
    from sellerpilot_private.products p
   where p.id = p_product_id
   for update;
  if not found then return -1; end if;

  perform 1
    from sellerpilot_private.competitor_price_refresh_claims c
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token
   for update;
  if not found then return -1; end if;

  for v_provider in
    select distinct provider.value->>'provider'
      from jsonb_array_elements(p_providers) provider(value)
     where provider.value->>'status' = 'searched'
  loop
    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = p_product_id
       and observation.provider = v_provider
       and not exists (
         select 1
           from jsonb_array_elements(p_items) item(value)
          where coalesce(nullif(item.value->>'provider', ''), 'naver_shopping') = v_provider
            and left(
              coalesce(
                nullif(trim(item.value->>'externalId'), ''),
                md5(coalesce(item.value->>'url', ''))
              ),
              500
            ) = observation.external_id
       );
  end loop;

  delete from sellerpilot_private.competitor_price_observations observation
   where observation.product_id = p_product_id
     and observation.provider <> 'manual'
     and observation.checked_at < now() - interval '7 days';

  select public.sellerpilot_service_record_competitor_prices(p_product_id, p_items)
    into v_count;

  update sellerpilot_private.competitor_price_refresh_claims c
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  to service_role;

commit;
