-- Preserve the actual read-only catalog source for every competitor price.
-- The table remains private and only the service-role scheduler can write it.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_operation_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
    'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
  )) not valid;

-- Production keeps historical gateway rows for audit. Some pre-release rows
-- predate the current operation vocabulary, so validating the whole ledger
-- would either block this additive release or require mutating audit history.
-- NOT VALID still enforces this allowlist for every new or updated row, while
-- the SECURITY DEFINER enqueue function below independently rejects unknown
-- operations before insert.

create or replace function public.sellerpilot_enqueue_channel_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee','lazada','coupang','elevenst','smartstore','temu')
     or p_operation not in (
       'oauth.exchange','shops.get','diagnostic.test','competitor.search',
       'categories.list','categories.suggest','categories.attributes','categories.validate',
       'listing.create','listing.update','listing.stop','price.update','inventory.update',
       'orders.list','orders.get','inquiries.list','shipment.acknowledge','shipment.confirm'
     )
     or (p_channel in ('coupang','smartstore','temu') and p_operation in ('oauth.exchange','shops.get'))
     or (p_operation = 'competitor.search' and (p_channel <> 'elevenst' or p_attempt_id is not null))
     or (p_channel = 'elevenst' and p_operation not in (
       'diagnostic.test','competitor.search','categories.list','categories.suggest','categories.attributes',
       'categories.validate','listing.create','listing.stop','orders.list'
     ))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  select c.environment,c.created_by into v_environment,v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now()) for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_attempt_id is not null and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.credential_id = p_credential_id
       and a.channel = p_channel and a.operation = p_operation and a.status = 'running'
  ) then raise exception 'running channel operation required'; end if;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,request_payload,created_by
  ) values (
    v_id,p_credential_id,p_attempt_id,p_channel,p_operation,v_environment,p_request_payload,v_created_by
  );
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb) to service_role;

alter table sellerpilot_private.competitor_price_observations
  drop constraint if exists competitor_price_observations_provider_check;

alter table sellerpilot_private.competitor_price_observations
  add constraint competitor_price_observations_provider_check
  check (provider in ('naver_shopping','elevenst_product_search','ebay_browse','manual'));

create or replace function public.sellerpilot_service_record_competitor_prices(p_product_id uuid,p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v jsonb;
  v_count integer := 0;
  v_external text;
  v_marketplace text;
  v_provider text;
  v_currency text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
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
    if v_provider not in ('naver_shopping','elevenst_product_search','ebay_browse','manual') then
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

revoke all on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb) to service_role;

commit;
