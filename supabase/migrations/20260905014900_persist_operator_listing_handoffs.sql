-- Persist explicit operator listing handoffs beside category assignments.
-- eBay business policies and merchantLocationKey are not reconstructed from
-- unique Account GET results, product_listings, or SERVER_MANAGED drafts.
-- EXECUTE grants are the boundary: service_role only, never anon.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500149);

create table if not exists sellerpilot_private.product_channel_listing_handoff (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  channel text not null check (channel = 'ebay'),
  environment text not null check (environment in ('production', 'sandbox')),
  market text not null check (market ~ '^[A-Z]{2}$'),
  marketplace_id text not null
    check (
      char_length(btrim(marketplace_id)) between 1 and 32
      and marketplace_id = btrim(marketplace_id)
      and upper(marketplace_id) <> 'SERVER_MANAGED'
      and marketplace_id = ('EBAY_' || market)
    ),
  fulfillment_policy_id text not null
    check (
      char_length(btrim(fulfillment_policy_id)) between 1 and 64
      and fulfillment_policy_id = btrim(fulfillment_policy_id)
      and upper(fulfillment_policy_id) <> 'SERVER_MANAGED'
    ),
  payment_policy_id text not null
    check (
      char_length(btrim(payment_policy_id)) between 1 and 64
      and payment_policy_id = btrim(payment_policy_id)
      and upper(payment_policy_id) <> 'SERVER_MANAGED'
    ),
  return_policy_id text not null
    check (
      char_length(btrim(return_policy_id)) between 1 and 64
      and return_policy_id = btrim(return_policy_id)
      and upper(return_policy_id) <> 'SERVER_MANAGED'
    ),
  merchant_location_key text not null
    check (
      char_length(btrim(merchant_location_key)) between 1 and 80
      and merchant_location_key = btrim(merchant_location_key)
      and upper(merchant_location_key) <> 'SERVER_MANAGED'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_handoff_scope_key
    unique (owner_id, product_id, channel, environment, market)
);

create index if not exists listing_handoff_product_idx
  on sellerpilot_private.product_channel_listing_handoff
    (product_id, channel, environment, market);

alter table sellerpilot_private.product_channel_listing_handoff enable row level security;
revoke all on sellerpilot_private.product_channel_listing_handoff
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_get_listing_handoff(
  p_product_id uuid,
  p_channel text,
  p_environment text,
  p_market text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_row sellerpilot_private.product_channel_listing_handoff%rowtype;
begin
  if p_channel is distinct from 'ebay'
     or p_environment not in ('production', 'sandbox')
     or p_market is null
     or p_market !~ '^[A-Z]{2}$' then
    raise exception 'invalid listing handoff query' using errcode = '22023';
  end if;

  select * into v_product
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo;
  if v_product.id is null then
    return null;
  end if;

  select * into v_row
    from sellerpilot_private.product_channel_listing_handoff h
   where h.owner_id = v_product.owner_id
     and h.product_id = p_product_id
     and h.channel = p_channel
     and h.environment = p_environment
     and h.market = p_market;

  if v_row.id is null then
    return null;
  end if;

  if v_row.owner_id is distinct from v_product.owner_id
     or v_row.marketplace_id is distinct from ('EBAY_' || v_row.market)
     or v_row.market is distinct from p_market then
    raise exception 'listing handoff market mismatch' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'productId', v_row.product_id,
    'channel', v_row.channel,
    'environment', v_row.environment,
    'market', v_row.market,
    'marketplaceId', v_row.marketplace_id,
    'fulfillmentPolicyId', v_row.fulfillment_policy_id,
    'paymentPolicyId', v_row.payment_policy_id,
    'returnPolicyId', v_row.return_policy_id,
    'merchantLocationKey', v_row.merchant_location_key,
    'updatedAt', v_row.updated_at
  );
end;
$$;

create or replace function public.sellerpilot_put_listing_handoff(
  p_product_id uuid,
  p_channel text,
  p_environment text,
  p_market text,
  p_handoff jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_key_count integer;
  v_marketplace_id text;
  v_fulfillment_policy_id text;
  v_payment_policy_id text;
  v_return_policy_id text;
  v_merchant_location_key text;
  v_row sellerpilot_private.product_channel_listing_handoff%rowtype;
begin
  if p_channel is distinct from 'ebay'
     or p_environment not in ('production', 'sandbox')
     or p_market is null
     or p_market !~ '^[A-Z]{2}$' then
    raise exception 'invalid listing handoff query' using errcode = '22023';
  end if;

  if jsonb_typeof(p_handoff) is distinct from 'object' then
    raise exception 'invalid listing handoff' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_key_count
    from jsonb_object_keys(p_handoff);

  if v_key_count is distinct from 5
     or not (p_handoff ?& array[
       'marketplaceId',
       'fulfillmentPolicyId',
       'paymentPolicyId',
       'returnPolicyId',
       'merchantLocationKey'
     ]::text[]) then
    raise exception 'invalid listing handoff' using errcode = '22023';
  end if;

  v_marketplace_id := btrim(p_handoff->>'marketplaceId');
  v_fulfillment_policy_id := btrim(p_handoff->>'fulfillmentPolicyId');
  v_payment_policy_id := btrim(p_handoff->>'paymentPolicyId');
  v_return_policy_id := btrim(p_handoff->>'returnPolicyId');
  v_merchant_location_key := btrim(p_handoff->>'merchantLocationKey');

  if v_marketplace_id = ''
     or v_fulfillment_policy_id = ''
     or v_payment_policy_id = ''
     or v_return_policy_id = ''
     or v_merchant_location_key = ''
     or upper(v_marketplace_id) = 'SERVER_MANAGED'
     or upper(v_fulfillment_policy_id) = 'SERVER_MANAGED'
     or upper(v_payment_policy_id) = 'SERVER_MANAGED'
     or upper(v_return_policy_id) = 'SERVER_MANAGED'
     or upper(v_merchant_location_key) = 'SERVER_MANAGED'
     or jsonb_typeof(p_handoff->'marketplaceId') is distinct from 'string'
     or jsonb_typeof(p_handoff->'fulfillmentPolicyId') is distinct from 'string'
     or jsonb_typeof(p_handoff->'paymentPolicyId') is distinct from 'string'
     or jsonb_typeof(p_handoff->'returnPolicyId') is distinct from 'string'
     or jsonb_typeof(p_handoff->'merchantLocationKey') is distinct from 'string' then
    raise exception 'invalid listing handoff' using errcode = '22023';
  end if;

  if v_marketplace_id is distinct from ('EBAY_' || p_market) then
    raise exception 'listing handoff market mismatch' using errcode = '22023';
  end if;

  select * into v_product
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo
   for update;
  if v_product.id is null then
    return null;
  end if;

  insert into sellerpilot_private.product_channel_listing_handoff (
    owner_id,
    product_id,
    channel,
    environment,
    market,
    marketplace_id,
    fulfillment_policy_id,
    payment_policy_id,
    return_policy_id,
    merchant_location_key,
    updated_at
  ) values (
    v_product.owner_id,
    p_product_id,
    p_channel,
    p_environment,
    p_market,
    v_marketplace_id,
    v_fulfillment_policy_id,
    v_payment_policy_id,
    v_return_policy_id,
    v_merchant_location_key,
    now()
  )
  on conflict on constraint listing_handoff_scope_key do update set
    marketplace_id = excluded.marketplace_id,
    fulfillment_policy_id = excluded.fulfillment_policy_id,
    payment_policy_id = excluded.payment_policy_id,
    return_policy_id = excluded.return_policy_id,
    merchant_location_key = excluded.merchant_location_key,
    updated_at = now()
  where sellerpilot_private.product_channel_listing_handoff.owner_id = excluded.owner_id
  returning * into v_row;

  if v_row.id is null
     or v_row.owner_id is distinct from v_product.owner_id
     or v_row.market is distinct from p_market then
    raise exception 'listing handoff owner mismatch' using errcode = '22023';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail
  ) values (
    v_product.owner_id,
    'listing_handoff_upserted',
    'product',
    p_product_id::text,
    jsonb_build_object(
      'channel', p_channel,
      'environment', p_environment,
      'market', p_market,
      'marketplaceId', v_marketplace_id
    )
  );

  return jsonb_build_object(
    'productId', v_row.product_id,
    'channel', v_row.channel,
    'environment', v_row.environment,
    'market', v_row.market,
    'marketplaceId', v_row.marketplace_id,
    'fulfillmentPolicyId', v_row.fulfillment_policy_id,
    'paymentPolicyId', v_row.payment_policy_id,
    'returnPolicyId', v_row.return_policy_id,
    'merchantLocationKey', v_row.merchant_location_key,
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke all on function public.sellerpilot_get_listing_handoff(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_put_listing_handoff(uuid, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.sellerpilot_get_listing_handoff(uuid, text, text, text)
  to service_role;
grant execute on function public.sellerpilot_put_listing_handoff(uuid, text, text, text, jsonb)
  to service_role;

commit;
