-- Restore 11st to the category and listing workflow after the Temu expansion
-- replaced several allowlists without 11st. All seller writes continue through
-- the fixed-egress gateway worker registered with 11st.

begin;

alter table sellerpilot_private.product_category_assignments
  drop constraint if exists product_category_assignments_channel_check;
alter table sellerpilot_private.product_category_assignments
  add constraint product_category_assignments_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu'));

create or replace function public.sellerpilot_save_product_category_assignment(
  p_product_id uuid,
  p_source_ref text,
  p_product_name text,
  p_channel text,
  p_environment text,
  p_market text,
  p_category_id text,
  p_category_path text[],
  p_is_leaf boolean,
  p_confidence numeric,
  p_classification_source text,
  p_required_attributes jsonb,
  p_provided_attributes jsonb,
  p_official_metadata jsonb,
  p_confirm boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_owner_id uuid := auth.uid();
  v_missing jsonb := '[]'::jsonb;
  v_verified_at timestamptz := now();
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_environment not in ('sandbox', 'production')
     or length(trim(coalesce(p_source_ref, ''))) not between 1 and 160
     or length(trim(coalesce(p_product_name, ''))) not between 1 and 500
     or length(trim(coalesce(p_category_id, ''))) not between 1 and 120
     or p_confidence not between 0 and 1
     or p_classification_source not in ('channel_recommendation', 'official_tree_search', 'seller_selected')
     or jsonb_typeof(p_required_attributes) <> 'array'
     or jsonb_typeof(p_provided_attributes) <> 'object'
     or jsonb_typeof(p_official_metadata) <> 'object' then raise exception 'invalid category assignment'; end if;
  if p_product_id is not null then
    select p.owner_id into v_owner_id
      from sellerpilot_private.products p
     where p.id = p_product_id and not p.demo and p.status <> 'archived';
    if v_owner_id is null then raise exception 'product not found'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(a->>'id', a->>'name'),
    'name', coalesce(a->>'name', a->>'id'))), '[]'::jsonb) into v_missing
    from jsonb_array_elements(p_required_attributes) a
   where coalesce((a->>'required')::boolean, false)
     and not (p_provided_attributes ? coalesce(a->>'id', a->>'name'));
  if p_confirm and (not p_is_leaf or jsonb_array_length(v_missing) > 0) then
    raise exception 'category confirmation requires an active leaf and every required attribute';
  end if;
  insert into sellerpilot_private.product_category_assignments (
    owner_id, product_id, source_ref, product_name, channel, environment, market,
    category_id, category_path, is_leaf, confidence, classification_source,
    required_attributes, provided_attributes, missing_required_attributes,
    official_metadata, status, official_verified_at, confirmed_at
  ) values (
    v_owner_id, p_product_id, trim(p_source_ref), trim(p_product_name), p_channel,
    p_environment, coalesce(trim(p_market), ''), trim(p_category_id), coalesce(p_category_path, '{}'),
    p_is_leaf, p_confidence, p_classification_source, p_required_attributes,
    p_provided_attributes, v_missing, p_official_metadata,
    case when p_confirm then 'confirmed' else 'pending' end, v_verified_at,
    case when p_confirm then v_verified_at else null end
  ) on conflict (owner_id, source_ref, channel, environment, market) do update set
    product_id = excluded.product_id, product_name = excluded.product_name,
    category_id = excluded.category_id, category_path = excluded.category_path,
    is_leaf = excluded.is_leaf, confidence = excluded.confidence,
    classification_source = excluded.classification_source,
    required_attributes = excluded.required_attributes,
    provided_attributes = excluded.provided_attributes,
    missing_required_attributes = excluded.missing_required_attributes,
    official_metadata = excluded.official_metadata, status = excluded.status,
    official_verified_at = excluded.official_verified_at, confirmed_at = excluded.confirmed_at,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.sellerpilot_prepare_product_market_listing(
  p_product_id uuid,
  p_channel text,
  p_operation text,
  p_market text default '',
  p_target_id text default '',
  p_currency text default 'KRW',
  p_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_owner_id uuid;
  v_market text := upper(trim(coalesce(p_market, '')));
  v_target_id text := trim(coalesce(p_target_id, ''));
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(trim(coalesce(p_currency, ''))) <> 3 or length(v_market) > 80
     or length(v_target_id) > 160 or p_price < 0 then raise exception 'invalid product listing request'; end if;
  if p_channel in ('shopee', 'lazada') and v_market !~ '^[A-Z]{2}$' then raise exception 'concrete market required'; end if;
  if p_channel = 'shopee' and v_target_id = '' then raise exception 'shop target required'; end if;
  select p.owner_id into v_owner_id
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo and p.status <> 'archived';
  if v_owner_id is null then raise exception 'product not found'; end if;
  if not exists (select 1 from sellerpilot_private.channel_credentials c where c.channel = p_channel
    and c.status = 'active' and (c.expires_at is null or c.expires_at > now())) then raise exception 'active channel credential required'; end if;
  if p_operation in ('listing.create', 'listing.update') and not exists (
    select 1 from sellerpilot_private.product_category_assignments a
     where a.owner_id = v_owner_id and a.product_id = p_product_id and a.channel = p_channel
       and (p_channel not in ('shopee', 'lazada') or a.market = v_market)
       and a.status = 'confirmed' and a.is_leaf
       and jsonb_array_length(a.missing_required_attributes) = 0 and a.confirmed_at is not null
  ) then raise exception 'confirmed market category required'; end if;
  if p_operation = 'listing.stop' and not exists (select 1 from sellerpilot_private.product_listings l
    where l.owner_id = v_owner_id and l.product_id = p_product_id and l.channel_key = p_channel
      and l.market = v_market and l.target_id = v_target_id and l.remote_id is not null) then raise exception 'remote market listing required'; end if;
  insert into sellerpilot_private.product_listings (
    owner_id, product_id, channel_key, market, target_id, status, currency, price, last_error, updated_at
  ) values (
    v_owner_id, p_product_id, p_channel, v_market, v_target_id,
    case when p_operation = 'listing.stop' then 'published' else 'queued' end,
    upper(trim(p_currency)), p_price, null, now()
  ) on conflict (owner_id, product_id, channel_key, market, target_id) do update set
    status = case when p_operation = 'listing.stop' then sellerpilot_private.product_listings.status else 'queued' end,
    currency = excluded.currency, price = excluded.price, last_error = null, updated_at = now()
  returning id into v_id;
  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'listing_prepared', 'product_listing', v_id::text,
    jsonb_build_object('product_id', p_product_id, 'channel', p_channel, 'market', v_market,
      'has_target', v_target_id <> '', 'operation', p_operation));
  return v_id;
end;
$$;

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
  if p_channel not in ('shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or (p_channel = 'elevenst' and p_operation not in (
       'diagnostic.test', 'categories.list', 'categories.suggest', 'categories.attributes',
       'categories.validate', 'listing.create', 'listing.stop', 'orders.list'
     ))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;
  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now()) for update;
  if not found then raise exception 'active channel credential required'; end if;
  if p_attempt_id is not null and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.credential_id = p_credential_id
       and a.channel = p_channel and a.operation = p_operation and a.status = 'running'
  ) then raise exception 'running channel operation required'; end if;
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment,
    p_request_payload, v_created_by
  );
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  to service_role;

commit;
