-- Channel-native category confirmation and preflight records.
-- A category can only be confirmed after an official API response has proved it is a leaf,
-- and every required attribute exposed by that response has a supplied value.

begin;

alter table sellerpilot_private.channel_operation_attempts
  drop constraint if exists channel_operation_attempts_operation_check;

alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_operation_check
  check (operation in (
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'shipment.acknowledge', 'shipment.confirm'
  ));

create table if not exists sellerpilot_private.product_category_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references sellerpilot_private.products(id) on delete cascade,
  source_ref text not null check (length(trim(source_ref)) between 1 and 160),
  product_name text not null check (length(trim(product_name)) between 1 and 500),
  channel text not null check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay')),
  environment text not null check (environment in ('sandbox', 'production')),
  market text not null default '' check (length(market) <= 80),
  category_id text not null check (length(trim(category_id)) between 1 and 120),
  category_path text[] not null default '{}',
  is_leaf boolean not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  classification_source text not null check (classification_source in ('channel_recommendation', 'official_tree_search', 'seller_selected')),
  required_attributes jsonb not null default '[]'::jsonb check (jsonb_typeof(required_attributes) = 'array'),
  provided_attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(provided_attributes) = 'object'),
  missing_required_attributes jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_required_attributes) = 'array'),
  official_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(official_metadata) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'stale')),
  official_verified_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_ref, channel, environment, market)
);

create index if not exists product_category_assignments_owner_updated_idx
  on sellerpilot_private.product_category_assignments (owner_id, updated_at desc);

alter table sellerpilot_private.product_category_assignments enable row level security;
revoke all on sellerpilot_private.product_category_assignments from public, anon, authenticated;

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
  v_missing jsonb := '[]'::jsonb;
  v_verified_at timestamptz := now();
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay')
     or p_environment not in ('sandbox', 'production')
     or length(trim(coalesce(p_source_ref, ''))) not between 1 and 160
     or length(trim(coalesce(p_product_name, ''))) not between 1 and 500
     or length(trim(coalesce(p_category_id, ''))) not between 1 and 120
     or p_confidence not between 0 and 1
     or p_classification_source not in ('channel_recommendation', 'official_tree_search', 'seller_selected')
     or jsonb_typeof(p_required_attributes) <> 'array'
     or jsonb_typeof(p_provided_attributes) <> 'object'
     or jsonb_typeof(p_official_metadata) <> 'object' then
    raise exception 'invalid category assignment';
  end if;
  if p_product_id is not null and not exists (
    select 1 from sellerpilot_private.products p
     where p.id = p_product_id and p.owner_id = auth.uid()
  ) then
    raise exception 'product not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(a->>'id', a->>'name'),
    'name', coalesce(a->>'name', a->>'id')
  )), '[]'::jsonb)
    into v_missing
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
    auth.uid(), p_product_id, trim(p_source_ref), trim(p_product_name), p_channel,
    p_environment, coalesce(trim(p_market), ''), trim(p_category_id), coalesce(p_category_path, '{}'),
    p_is_leaf, p_confidence, p_classification_source, p_required_attributes,
    p_provided_attributes, v_missing, p_official_metadata,
    case when p_confirm then 'confirmed' else 'pending' end,
    v_verified_at, case when p_confirm then v_verified_at else null end
  )
  on conflict (owner_id, source_ref, channel, environment, market) do update set
    product_id = excluded.product_id,
    product_name = excluded.product_name,
    category_id = excluded.category_id,
    category_path = excluded.category_path,
    is_leaf = excluded.is_leaf,
    confidence = excluded.confidence,
    classification_source = excluded.classification_source,
    required_attributes = excluded.required_attributes,
    provided_attributes = excluded.provided_attributes,
    missing_required_attributes = excluded.missing_required_attributes,
    official_metadata = excluded.official_metadata,
    status = excluded.status,
    official_verified_at = excluded.official_verified_at,
    confirmed_at = excluded.confirmed_at,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.sellerpilot_list_product_category_assignments(p_source_ref text)
returns table (
  id uuid,
  product_id uuid,
  source_ref text,
  product_name text,
  channel text,
  environment text,
  market text,
  category_id text,
  category_path text[],
  is_leaf boolean,
  confidence numeric,
  classification_source text,
  required_attributes jsonb,
  provided_attributes jsonb,
  missing_required_attributes jsonb,
  status text,
  official_verified_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select a.id, a.product_id, a.source_ref, a.product_name, a.channel, a.environment,
         a.market, a.category_id, a.category_path, a.is_leaf, a.confidence,
         a.classification_source, a.required_attributes, a.provided_attributes,
         a.missing_required_attributes, a.status, a.official_verified_at,
         a.confirmed_at, a.updated_at
    from sellerpilot_private.product_category_assignments a
   where public.sellerpilot_is_admin()
     and a.owner_id = auth.uid()
     and a.source_ref = trim(p_source_ref)
   order by a.channel, a.market
$$;

create or replace function public.sellerpilot_claim_channel_operation(
  p_credential_id uuid,
  p_channel text,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_status text;
  v_fingerprint text;
  v_inserted boolean := false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay')
     or p_operation not in (
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update', 'orders.list', 'orders.get',
       'shipment.acknowledge', 'shipment.confirm'
     )
     or length(trim(p_idempotency_key)) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid channel operation';
  end if;
  if not exists (
    select 1 from sellerpilot_private.channel_credentials c
     where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
  ) then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint
  ) values (
    auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint
  )
  on conflict (owner_id, channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint into v_id, v_status, v_fingerprint;
  v_inserted := found;

  if not v_inserted then
    select a.id, a.status, a.request_fingerprint
      into v_id, v_status, v_fingerprint
      from sellerpilot_private.channel_operation_attempts a
     where a.owner_id = auth.uid()
       and a.channel = p_channel
       and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key);
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;
  end if;

  return jsonb_build_object('attempt_id', v_id, 'status', v_status, 'duplicate', not v_inserted);
end;
$$;

revoke all on function public.sellerpilot_save_product_category_assignment(uuid, text, text, text, text, text, text, text[], boolean, numeric, text, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.sellerpilot_save_product_category_assignment(uuid, text, text, text, text, text, text, text[], boolean, numeric, text, jsonb, jsonb, jsonb, boolean) to authenticated;
revoke all on function public.sellerpilot_list_product_category_assignments(text) from public, anon;
grant execute on function public.sellerpilot_list_product_category_assignments(text) to authenticated;
revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) from public, anon;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) to authenticated;

commit;
