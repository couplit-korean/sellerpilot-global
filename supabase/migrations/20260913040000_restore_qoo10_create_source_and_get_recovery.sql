-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_assert_qoo10_create_fulfillment_capture_current') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_assert_qoo10_create_fulfillment_capture_current';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_qoo10_gateway_create_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_begin_qoo10_gateway_create_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_complete_qoo10_local_create_after_boundary') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_complete_qoo10_local_create_after_boundary';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_fence_qoo10_create_now_v3') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_fence_qoo10_create_now_v3';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_qoo10_create_get_rec_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_qoo10_create_get_rec_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_qoo10_create_fulfillment_capture') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_qoo10_create_fulfillment_capture';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_take_qoo10_create_fulfillment_capture') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_take_qoo10_create_fulfillment_capture';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='block_qoo10_create_fulfillment_ledger_change') then raise exception 'RECOVERY_ALREADY_DEFINED:block_qoo10_create_fulfillment_ledger_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='qoo10_create_fulfillment_capture_valid') then raise exception 'RECOVERY_ALREADY_DEFINED:qoo10_create_fulfillment_capture_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='qoo10_create_fulfillment_exact_keys') then raise exception 'RECOVERY_ALREADY_DEFINED:qoo10_create_fulfillment_exact_keys';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='qoo10_create_fulfillment_has_secret_key') then raise exception 'RECOVERY_ALREADY_DEFINED:qoo10_create_fulfillment_has_secret_key';end if;
end $recovery_guard$;
-- Reviewed source: 20260910023500_qoo10_fulfillment_evidence.sql
-- Source SHA256: 1dbaae9e69ad71dbf8217311a9ca66dd79e97ff03984bd6691c2cfb6b66c4b30
-- Durable, service-role-only source for one sanitized CHANGHEE QSM capture.
-- The create route consumes one fresh row before fingerprint, claim or enqueue.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 901002350);

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create function sellerpilot_private.qoo10_create_fulfillment_exact_keys(
  p_value jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and p_value ?& p_keys
    and (select count(*) from pg_catalog.jsonb_object_keys(p_value))
          = pg_catalog.cardinality(p_keys),
    false
  )
$$;

create function sellerpilot_private.qoo10_create_fulfillment_has_secret_key(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    for v_key, v_item in select key, value from pg_catalog.jsonb_each(p_value)
    loop
      if v_key ~* '(authorization|cookie|password|secret|token|api[_-]?key|certification[_-]?key)'
         or sellerpilot_private.qoo10_create_fulfillment_has_secret_key(v_item) then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    for v_item in select value from pg_catalog.jsonb_array_elements(p_value)
    loop
      if sellerpilot_private.qoo10_create_fulfillment_has_secret_key(v_item) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

create function sellerpilot_private.qoo10_create_fulfillment_capture_valid(
  p_capture jsonb,
  p_seller_id text,
  p_test_item_code text,
  p_dispatch_place_id text,
  p_return_policy_id text,
  p_source_revision text,
  p_capture_digest text,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_observed_at timestamptz;
begin
  if not sellerpilot_private.qoo10_create_fulfillment_exact_keys(
    p_capture,
    array[
      'contract','collector','trustBoundary','browser','sourceOrigin',
      'authenticatedSellerId','testItemCode','testItemSellerCode','observedAt',
      'dispatchPlaces','returnPolicies','sourceRevision','captureDigest'
    ]
  ) or not sellerpilot_private.qoo10_create_fulfillment_exact_keys(
    p_capture->'browser', array['name','family','type','profileName']
  ) or p_capture->>'contract' <> 'sellerpilot_qoo10_qsm_create_fulfillment_capture_v1'
    or p_capture->>'collector' <> 'sellerpilot_qsm_changhee_create_fulfillment_readonly_v1'
    or p_capture->>'trustBoundary' <> 'server_injected_changhee_browser_capture'
    or p_capture->>'sourceOrigin' <> 'https://qsm.qoo10.jp'
    or p_capture#>>'{browser,name}' <> 'Chrome'
    or p_capture#>>'{browser,family}' <> 'chrome'
    or p_capture#>>'{browser,type}' <> 'extension'
    or p_capture#>>'{browser,profileName}' <> 'CHANGHEE'
    or p_capture->>'authenticatedSellerId' is distinct from p_seller_id
    or p_capture->>'testItemCode' is distinct from p_test_item_code
    or nullif(pg_catalog.btrim(p_capture->>'testItemSellerCode'), '') is null
    or p_capture->>'sourceRevision' is distinct from p_source_revision
    or p_capture->>'captureDigest' is distinct from p_capture_digest
    or p_seller_id is null or pg_catalog.length(pg_catalog.btrim(p_seller_id)) not between 1 and 160
    or p_test_item_code !~ '^[0-9]{9,10}$'
    or p_dispatch_place_id is null
    or pg_catalog.length(pg_catalog.btrim(p_dispatch_place_id)) not between 1 and 200
    or p_return_policy_id is null
    or pg_catalog.length(pg_catalog.btrim(p_return_policy_id)) not between 1 and 200
    or p_source_revision !~ '^sha256:[a-f0-9]{64}$'
    or p_capture_digest !~ '^[a-f0-9]{64}$'
    or p_capture->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    or sellerpilot_private.qoo10_create_fulfillment_has_secret_key(p_capture)
    or pg_catalog.jsonb_typeof(p_capture->'dispatchPlaces') <> 'array'
    or pg_catalog.jsonb_array_length(p_capture->'dispatchPlaces') not between 1 and 1000
    or pg_catalog.jsonb_typeof(p_capture->'returnPolicies') <> 'array'
    or pg_catalog.jsonb_array_length(p_capture->'returnPolicies') not between 1 and 1000 then
    return false;
  end if;

  begin
    v_observed_at := (p_capture->>'observedAt')::timestamptz;
  exception when others then
    return false;
  end;
  if v_observed_at > p_now + interval '5 seconds'
     or v_observed_at < p_now - interval '5 minutes' then
    return false;
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_capture->'dispatchPlaces') item(value)
     where not sellerpilot_private.qoo10_create_fulfillment_exact_keys(
       item.value, array['id','active','payload']
     )
        or nullif(pg_catalog.btrim(item.value->>'id'), '') is null
        or pg_catalog.length(pg_catalog.btrim(item.value->>'id')) > 200
        or pg_catalog.jsonb_typeof(item.value->'active') <> 'boolean'
        or pg_catalog.jsonb_typeof(item.value->'payload') <> 'object'
        or not sellerpilot_private.qoo10_create_fulfillment_exact_keys(
          item.value->'payload', array['label','countryCode','postalCode','addressLine1']
        )
        or nullif(pg_catalog.btrim(item.value#>>'{payload,label}'), '') is null
        or item.value#>>'{payload,countryCode}' !~ '^[A-Z]{2}$'
        or pg_catalog.jsonb_typeof(item.value#>'{payload,postalCode}') <> 'string'
        or pg_catalog.jsonb_typeof(item.value#>'{payload,addressLine1}') <> 'string'
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_capture->'returnPolicies') item(value)
     where not sellerpilot_private.qoo10_create_fulfillment_exact_keys(
       item.value, array['id','active','payload']
     )
        or nullif(pg_catalog.btrim(item.value->>'id'), '') is null
        or pg_catalog.length(pg_catalog.btrim(item.value->>'id')) > 200
        or pg_catalog.jsonb_typeof(item.value->'active') <> 'boolean'
        or pg_catalog.jsonb_typeof(item.value->'payload') <> 'object'
        or not sellerpilot_private.qoo10_create_fulfillment_exact_keys(
          item.value->'payload', array['label','returnWindowDays','returnShippingPaidBy']
        )
        or nullif(pg_catalog.btrim(item.value#>>'{payload,label}'), '') is null
        or pg_catalog.jsonb_typeof(item.value#>'{payload,returnWindowDays}') <> 'number'
        or (item.value#>>'{payload,returnWindowDays}')::numeric <> pg_catalog.trunc((item.value#>>'{payload,returnWindowDays}')::numeric)
        or (item.value#>>'{payload,returnWindowDays}')::numeric not between 0 and 365
        or item.value#>>'{payload,returnShippingPaidBy}' not in ('seller','buyer')
  ) or (
    select count(*)
      from pg_catalog.jsonb_array_elements(p_capture->'dispatchPlaces') item(value)
     where item.value->>'id' = p_dispatch_place_id
       and item.value->'active' = 'true'::jsonb
  ) <> 1 or (
    select count(*)
      from pg_catalog.jsonb_array_elements(p_capture->'returnPolicies') item(value)
     where item.value->>'id' = p_return_policy_id
       and item.value->'active' = 'true'::jsonb
  ) <> 1 or (
    select count(distinct item.value->>'id')
      from pg_catalog.jsonb_array_elements(p_capture->'dispatchPlaces') item(value)
  ) <> pg_catalog.jsonb_array_length(p_capture->'dispatchPlaces') or (
    select count(distinct item.value->>'id')
      from pg_catalog.jsonb_array_elements(p_capture->'returnPolicies') item(value)
  ) <> pg_catalog.jsonb_array_length(p_capture->'returnPolicies')
  or p_capture->'dispatchPlaces' is distinct from (
    select pg_catalog.jsonb_agg(item.value order by item.value->>'id')
      from pg_catalog.jsonb_array_elements(p_capture->'dispatchPlaces') item(value)
  ) or p_capture->'returnPolicies' is distinct from (
    select pg_catalog.jsonb_agg(item.value order by item.value->>'id')
      from pg_catalog.jsonb_array_elements(p_capture->'returnPolicies') item(value)
  ) then
    return false;
  end if;
  return true;
end;
$$;

create table sellerpilot_private.qoo10_create_fulfillment_captures (
  source_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  market text not null check (market = 'JP'),
  target_id text not null check (length(btrim(target_id)) between 1 and 160),
  seller_id text not null check (length(btrim(seller_id)) between 1 and 160),
  test_item_code text not null check (test_item_code ~ '^[0-9]{9,10}$'),
  test_item_seller_code text not null
    check (length(btrim(test_item_seller_code)) between 1 and 200),
  dispatch_place_id text not null
    check (length(btrim(dispatch_place_id)) between 1 and 200),
  return_policy_id text not null
    check (length(btrim(return_policy_id)) between 1 and 200),
  source_revision text not null check (source_revision ~ '^sha256:[a-f0-9]{64}$'),
  capture_digest text not null unique check (capture_digest ~ '^[a-f0-9]{64}$'),
  stored_capture_sha256 text not null
    check (stored_capture_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  capture jsonb not null check (jsonb_typeof(capture) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint qoo10_create_fulfillment_capture_freshness check (
    expires_at = observed_at + interval '5 minutes'
    and recorded_at >= observed_at - interval '5 seconds'
    and recorded_at <= observed_at + interval '5 minutes'
  ),
  unique (
    owner_id, product_id, credential_id, credential_version, market, target_id,
    seller_id, test_item_code,
    dispatch_place_id, return_policy_id, source_revision
  )
);

create table sellerpilot_private.qoo10_create_fulfillment_capture_consumptions (
  source_id uuid primary key
    references sellerpilot_private.qoo10_create_fulfillment_captures(source_id)
    on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  consumed_at timestamptz not null default clock_timestamp(),
  reason text not null check (reason = 'create_fulfillment_evidence_taken')
);

create table sellerpilot_private.qoo10_create_fulfillment_mutation_fences (
  source_id uuid primary key
    references sellerpilot_private.qoo10_create_fulfillment_captures(source_id)
    on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  local_attempt_id uuid unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  fulfillment_evidence_digest text not null
    check (fulfillment_evidence_digest ~ '^[a-f0-9]{64}$'),
  fenced_at timestamptz not null default clock_timestamp(),
  reason text not null check (reason = 'set_new_goods_prewrite_cas')
);

alter table sellerpilot_private.qoo10_create_fulfillment_captures enable row level security;
alter table sellerpilot_private.qoo10_create_fulfillment_capture_consumptions enable row level security;
alter table sellerpilot_private.qoo10_create_fulfillment_mutation_fences enable row level security;
revoke all on sellerpilot_private.qoo10_create_fulfillment_captures,
  sellerpilot_private.qoo10_create_fulfillment_capture_consumptions,
  sellerpilot_private.qoo10_create_fulfillment_mutation_fences
  from public, anon, authenticated, service_role;

create function sellerpilot_private.block_qoo10_create_fulfillment_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'QOO10_CREATE_FULFILLMENT_LEDGER_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger block_qoo10_create_fulfillment_capture_change
before update or delete on sellerpilot_private.qoo10_create_fulfillment_captures
for each row execute function
  sellerpilot_private.block_qoo10_create_fulfillment_ledger_change();

create trigger block_qoo10_create_fulfillment_consumption_change
before update or delete on sellerpilot_private.qoo10_create_fulfillment_capture_consumptions
for each row execute function
  sellerpilot_private.block_qoo10_create_fulfillment_ledger_change();

create trigger block_qoo10_create_fulfillment_mutation_fence_change
before update or delete on sellerpilot_private.qoo10_create_fulfillment_mutation_fences
for each row execute function
  sellerpilot_private.block_qoo10_create_fulfillment_ledger_change();

create function public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_market text,
  p_target_id text,
  p_seller_id text,
  p_test_item_code text,
  p_dispatch_place_id text,
  p_return_policy_id text,
  p_source_revision text,
  p_capture_digest text,
  p_capture jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_secret_seller_id text;
  v_now timestamptz := clock_timestamp();
  v_observed_at timestamptz;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'QOO10_CREATE_FULFILLMENT_SOURCE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_owner_id is null or not exists (
    select 1 from sellerpilot_private.admin_users admin_user
     where admin_user.user_id = p_owner_id
  ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_OWNER_INVALID' using errcode = '42501';
  end if;
  if p_product_id is null or pg_catalog.upper(pg_catalog.btrim(p_market)) <> 'JP'
     or nullif(pg_catalog.btrim(p_target_id), '') is null
     or not exists (
       select 1 from sellerpilot_private.products product
        where product.id = p_product_id and product.owner_id = p_owner_id
          and product.demo is false and product.status <> 'archived'
     ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_PRODUCT_TARGET_MISMATCH' using errcode = '22023';
  end if;

  select nullif(pg_catalog.btrim(secret.decrypted_secret::jsonb->>'seller_id'), '')
    into v_secret_seller_id
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.created_by = p_owner_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = p_credential_version
     and (credential.expires_at is null or credential.expires_at > v_now);
  if v_secret_seller_id is null or v_secret_seller_id is distinct from pg_catalog.btrim(p_seller_id) then
    raise exception 'QOO10_CREATE_FULFILLMENT_CREDENTIAL_MISMATCH' using errcode = '22023';
  end if;
  if not sellerpilot_private.qoo10_create_fulfillment_capture_valid(
    p_capture, pg_catalog.btrim(p_seller_id), pg_catalog.btrim(p_test_item_code),
    pg_catalog.btrim(p_dispatch_place_id), pg_catalog.btrim(p_return_policy_id),
    p_source_revision, p_capture_digest, v_now
  ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_CAPTURE_INVALID' using errcode = '22023';
  end if;
  v_observed_at := (p_capture->>'observedAt')::timestamptz;

  if exists (
    select 1
      from sellerpilot_private.qoo10_create_fulfillment_captures source
     where source.owner_id = p_owner_id
       and source.product_id = p_product_id
       and source.credential_id = p_credential_id
       and source.credential_version = p_credential_version
       and source.expires_at > v_now
       and not exists (
         select 1
           from sellerpilot_private.qoo10_create_fulfillment_capture_consumptions consumed
          where consumed.source_id = source.source_id
       )
  ) or exists (
    select 1
      from sellerpilot_private.qoo10_create_fulfillment_captures source
     where source.capture_digest = p_capture_digest
        or (
          source.owner_id = p_owner_id
          and source.credential_id = p_credential_id
          and source.credential_version = p_credential_version
          and source.source_revision = p_source_revision
        )
  ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_CAPTURE_REPLAY' using errcode = '23505';
  end if;

  insert into sellerpilot_private.qoo10_create_fulfillment_captures (
    owner_id, product_id, credential_id, credential_version, market, target_id,
    seller_id, test_item_code,
    test_item_seller_code, dispatch_place_id, return_policy_id,
    source_revision, capture_digest, stored_capture_sha256,
    observed_at, expires_at, capture, recorded_at
  ) values (
    p_owner_id, p_product_id, p_credential_id, p_credential_version,
    'JP', pg_catalog.btrim(p_target_id),
    pg_catalog.btrim(p_seller_id), pg_catalog.btrim(p_test_item_code),
    pg_catalog.btrim(p_capture->>'testItemSellerCode'),
    pg_catalog.btrim(p_dispatch_place_id), pg_catalog.btrim(p_return_policy_id),
    p_source_revision, p_capture_digest,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_capture::text, 'UTF8'), 'sha256'), 'hex'),
    v_observed_at, v_observed_at + interval '5 minutes', p_capture, v_now
  ) returning source_id into v_source_id;
  return v_source_id;
end;
$$;

create function public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source sellerpilot_private.qoo10_create_fulfillment_captures%rowtype;
  v_secret_seller_id text;
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_consumed_at timestamptz;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'QOO10_CREATE_FULFILLMENT_SOURCE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_owner_id is null or not exists (
    select 1 from sellerpilot_private.admin_users admin_user
     where admin_user.user_id = p_owner_id
  ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_OWNER_INVALID' using errcode = '42501';
  end if;
  if p_product_id is null or pg_catalog.upper(pg_catalog.btrim(p_market)) <> 'JP'
     or nullif(pg_catalog.btrim(p_target_id), '') is null
     or not exists (
       select 1 from sellerpilot_private.products product
        where product.id = p_product_id and product.owner_id = p_owner_id
          and product.demo is false and product.status <> 'archived'
     ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_PRODUCT_TARGET_MISMATCH' using errcode = '22023';
  end if;

  select nullif(pg_catalog.btrim(secret.decrypted_secret::jsonb->>'seller_id'), '')
    into v_secret_seller_id
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.created_by = p_owner_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = p_credential_version
     and (credential.expires_at is null or credential.expires_at > v_now);
  if v_secret_seller_id is null then
    raise exception 'QOO10_CREATE_FULFILLMENT_CREDENTIAL_MISMATCH' using errcode = '22023';
  end if;

  select count(*) into v_count
    from sellerpilot_private.qoo10_create_fulfillment_captures source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.credential_version = p_credential_version
     and source.market = 'JP'
     and source.target_id = pg_catalog.btrim(p_target_id)
     and source.seller_id = v_secret_seller_id
     and source.observed_at <= v_now + interval '5 seconds'
     and source.observed_at >= v_now - interval '5 minutes'
     and source.expires_at > v_now
     and not exists (
       select 1
         from sellerpilot_private.qoo10_create_fulfillment_capture_consumptions consumed
        where consumed.source_id = source.source_id
     );
  if v_count = 0 then return null; end if;
  if v_count <> 1 then
    raise exception 'QOO10_CREATE_FULFILLMENT_SOURCE_AMBIGUOUS' using errcode = '21000';
  end if;

  select source.* into strict v_source
    from sellerpilot_private.qoo10_create_fulfillment_captures source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.credential_version = p_credential_version
     and source.market = 'JP'
     and source.target_id = pg_catalog.btrim(p_target_id)
     and source.seller_id = v_secret_seller_id
     and source.observed_at <= v_now + interval '5 seconds'
     and source.observed_at >= v_now - interval '5 minutes'
     and source.expires_at > v_now
     and not exists (
       select 1
         from sellerpilot_private.qoo10_create_fulfillment_capture_consumptions consumed
        where consumed.source_id = source.source_id
     )
   for share;

  if v_source.credential_version <> p_credential_version
     or v_source.seller_id <> v_secret_seller_id
     or v_source.test_item_code <> v_source.capture->>'testItemCode'
     or v_source.test_item_seller_code <> v_source.capture->>'testItemSellerCode'
     or v_source.source_revision <> v_source.capture->>'sourceRevision'
     or v_source.capture_digest <> v_source.capture->>'captureDigest'
     or v_source.stored_capture_sha256 <> pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(v_source.capture::text, 'UTF8'), 'sha256'), 'hex'
     )
     or not sellerpilot_private.qoo10_create_fulfillment_capture_valid(
       v_source.capture, v_source.seller_id, v_source.test_item_code,
       v_source.dispatch_place_id, v_source.return_policy_id,
       v_source.source_revision, v_source.capture_digest, v_now
     ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_SOURCE_INVALID' using errcode = '22023';
  end if;

  insert into sellerpilot_private.qoo10_create_fulfillment_capture_consumptions (
    source_id, owner_id, product_id, credential_id, consumed_at, reason
  ) values (
    v_source.source_id, p_owner_id, p_product_id, p_credential_id, v_now,
    'create_fulfillment_evidence_taken'
  ) returning consumed_at into v_consumed_at;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_qoo10_durable_create_fulfillment_source_v1',
    'sourceId', v_source.source_id,
    'ownerId', v_source.owner_id,
    'productId', v_source.product_id,
    'credentialId', v_source.credential_id,
    'credentialVersion', v_source.credential_version,
    'market', v_source.market,
    'targetId', v_source.target_id,
    'sellerId', v_source.seller_id,
    'testItemCode', v_source.test_item_code,
    'testItemSellerCode', v_source.test_item_seller_code,
    'dispatchPlaceId', v_source.dispatch_place_id,
    'returnPolicyId', v_source.return_policy_id,
    'sourceRevision', v_source.source_revision,
    'captureDigest', v_source.capture_digest,
    'observedAt', v_source.observed_at,
    'expiresAt', v_source.expires_at,
    'consumedAt', v_consumed_at,
    'capture', v_source.capture
  );
end;
$$;

create function public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_current(
  p_source_id uuid,
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_id text,
  p_market text,
  p_target_id text,
  p_source_revision text,
  p_capture_digest text,
  p_fulfillment_evidence_digest text,
  p_attempt_id uuid default null,
  p_request_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source sellerpilot_private.qoo10_create_fulfillment_captures%rowtype;
  v_secret_seller_id text;
  v_now timestamptz := clock_timestamp();
  v_local_attempt_id uuid;
  v_updated integer;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'QOO10_CREATE_FULFILLMENT_SOURCE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_source_id is null or p_owner_id is null or p_product_id is null
     or p_credential_id is null or p_credential_version < 1
     or pg_catalog.upper(pg_catalog.btrim(p_market)) <> 'JP'
     or nullif(pg_catalog.btrim(p_target_id), '') is null
     or p_source_revision !~ '^sha256:[a-f0-9]{64}$'
     or p_capture_digest !~ '^[a-f0-9]{64}$'
     or p_fulfillment_evidence_digest !~ '^[a-f0-9]{64}$'
     or (p_attempt_id is null) <> (p_request_fingerprint is null)
     or (p_request_fingerprint is not null
       and p_request_fingerprint !~ '^[a-f0-9]{64}$') then
    raise exception 'QOO10_CREATE_FULFILLMENT_MUTATION_FENCE_INVALID' using errcode = '22023';
  end if;

  select nullif(pg_catalog.btrim(secret.decrypted_secret::jsonb->>'seller_id'), '')
    into v_secret_seller_id
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.created_by = p_owner_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = p_credential_version
     and (credential.expires_at is null or credential.expires_at > v_now);

  select source.* into strict v_source
    from sellerpilot_private.qoo10_create_fulfillment_captures source
   where source.source_id = p_source_id
     and source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.credential_version = p_credential_version
     and source.seller_id = pg_catalog.btrim(p_seller_id)
     and source.seller_id = v_secret_seller_id
     and source.market = 'JP'
     and source.target_id = pg_catalog.btrim(p_target_id)
     and source.source_revision = p_source_revision
     and source.capture_digest = p_capture_digest
     and source.observed_at <= v_now + interval '5 seconds'
     and source.observed_at >= v_now - interval '5 minutes'
     and source.expires_at > v_now
     and exists (
       select 1 from sellerpilot_private.qoo10_create_fulfillment_capture_consumptions consumed
        where consumed.source_id = source.source_id
          and consumed.owner_id = p_owner_id
          and consumed.product_id = p_product_id
          and consumed.credential_id = p_credential_id
     )
     and not exists (
       select 1 from sellerpilot_private.qoo10_create_fulfillment_mutation_fences fenced
        where fenced.source_id = source.source_id
     )
   for share;

  if not exists (
       select 1 from sellerpilot_private.products product
        where product.id = p_product_id and product.owner_id = p_owner_id
          and product.demo is false and product.status <> 'archived'
     ) or v_source.stored_capture_sha256 <> pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(v_source.capture::text, 'UTF8'), 'sha256'), 'hex'
     ) or not sellerpilot_private.qoo10_create_fulfillment_capture_valid(
       v_source.capture, v_source.seller_id, v_source.test_item_code,
       v_source.dispatch_place_id, v_source.return_policy_id,
       v_source.source_revision, v_source.capture_digest, v_now
     ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_MUTATION_FENCE_INVALID' using errcode = '22023';
  end if;

  if p_attempt_id is not null then
    select attempt.id into v_local_attempt_id
      from sellerpilot_private.channel_operation_attempts attempt
     where attempt.id = p_attempt_id
       and attempt.owner_id = p_owner_id
       and attempt.credential_id = p_credential_id
       and attempt.channel = 'qoo10'
       and attempt.operation = 'listing.create'
       and attempt.request_fingerprint = p_request_fingerprint
       and attempt.status = 'running'
       and attempt.gateway_write_required
       and attempt.pre_gateway_retryable is false
       and not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs job
          where job.attempt_id = attempt.id
       )
     for update;
    if v_local_attempt_id is null then
      raise exception 'QOO10_LOCAL_CREATE_ATTEMPT_BOUNDARY_REJECTED' using errcode = '55000';
    end if;
  end if;

  insert into sellerpilot_private.qoo10_create_fulfillment_mutation_fences (
    source_id, owner_id, product_id, credential_id, local_attempt_id,
    fulfillment_evidence_digest, fenced_at, reason
  ) values (
    p_source_id, p_owner_id, p_product_id, p_credential_id,
    v_local_attempt_id,
    p_fulfillment_evidence_digest, v_now, 'set_new_goods_prewrite_cas'
  );

  if v_local_attempt_id is not null then
    update sellerpilot_private.channel_operation_attempts attempt
       set status = 'manual_required',
           http_status = 409,
           remote_id = null,
           safe_message = 'Qoo10 CREATE provider boundary crossed; official SellerCode lookup required.',
           completed_at = v_now,
           pre_gateway_retryable = false
     where attempt.id = v_local_attempt_id
       and attempt.status = 'running';
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'QOO10_LOCAL_CREATE_ATTEMPT_BOUNDARY_REJECTED' using errcode = '55000';
    end if;
  end if;
  return true;
exception when no_data_found or unique_violation then
  raise exception 'QOO10_CREATE_FULFILLMENT_MUTATION_FENCE_REJECTED' using errcode = '55000';
end;
$$;

create function public.sellerpilot_service_complete_qoo10_local_create_after_boundary(
  p_source_id uuid,
  p_attempt_id uuid,
  p_http_status integer,
  p_remote_id text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'QOO10_CREATE_FULFILLMENT_SOURCE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_source_id is null or p_attempt_id is null
     or p_http_status not between 200 and 299
     or pg_catalog.btrim(coalesce(p_remote_id, '')) !~ '^\d{9,10}$'
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_safe_message, ''))) not between 1 and 1000 then
    raise exception 'QOO10_LOCAL_CREATE_COMPLETION_INVALID' using errcode = '22023';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'succeeded',
         http_status = p_http_status,
         remote_id = pg_catalog.btrim(p_remote_id),
         safe_message = pg_catalog.btrim(p_safe_message),
         completed_at = clock_timestamp(),
         pre_gateway_retryable = false
   where attempt.id = p_attempt_id
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.create'
     and attempt.status = 'manual_required'
     and exists (
       select 1
         from sellerpilot_private.qoo10_create_fulfillment_mutation_fences fence
        where fence.source_id = p_source_id
          and fence.local_attempt_id = attempt.id
     );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function sellerpilot_private.qoo10_create_fulfillment_exact_keys(jsonb,text[]),
  sellerpilot_private.qoo10_create_fulfillment_has_secret_key(jsonb),
  sellerpilot_private.qoo10_create_fulfillment_capture_valid(
    jsonb,text,text,text,text,text,text,timestamptz
  ),
  sellerpilot_private.block_qoo10_create_fulfillment_ledger_change()
  from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
  uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,jsonb
), public.sellerpilot_service_take_qoo10_create_fulfillment_capture(uuid,uuid,uuid,integer,text,text),
public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_current(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
), public.sellerpilot_service_complete_qoo10_local_create_after_boundary(
  uuid,uuid,integer,text,text
)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
  uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,jsonb
), public.sellerpilot_service_take_qoo10_create_fulfillment_capture(uuid,uuid,uuid,integer,text,text),
public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_current(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
), public.sellerpilot_service_complete_qoo10_local_create_after_boundary(
  uuid,uuid,integer,text,text
)
  to service_role;


-- Reviewed source: 20260910033500_qoo10_gateway_create_atomic_recovery.sql
-- Source SHA256: d8a6f7ad2fb79b5883486d07241c7abcc1e7d4cbe2da4449d0aad7250fbb9e1c
-- Forward-fix Qoo10 CREATE so the fresh QSM source fence and the gateway
-- provider boundary are one transaction. The historical 23500 function name
-- was truncated by PostgreSQL; rename that catalog entry to an addressable
-- identifier before exposing the combined gateway-only boundary.

do $rename_qoo10_fulfillment_fence$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_cur(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text)'
    ) is null then
      raise exception 'QOO10_FULFILLMENT_FENCE_FORWARD_FIX_SOURCE_MISSING'
        using errcode = '55000';
    end if;
    alter function public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_cur(
      uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
    ) rename to sellerpilot_service_fence_qoo10_create_fulfillment_v2;
  end if;
end;
$rename_qoo10_fulfillment_fence$;

-- The local direct path never owns Qoo10 CREATE. Retire its success-only RPC
-- so a rolling old application cannot commit an attempt before a listing row.
revoke all on function public.sellerpilot_service_complete_qoo10_local_create_after_boundary(
  uuid,uuid,integer,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_source_id uuid,
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_id text,
  p_market text,
  p_target_id text,
  p_source_revision text,
  p_capture_digest text,
  p_fulfillment_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_listing_id uuid;
  v_request_fingerprint text;
  v_fenced boolean;
  v_started boolean;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_source_id is null
     or p_owner_id is null or p_product_id is null or p_credential_id is null
     or p_credential_version < 1 then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select job.attempt_id, job.listing_id, job.request_fingerprint
    into v_attempt_id, v_listing_id, v_request_fingerprint
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > clock_timestamp()
     and job.channel = 'qoo10'
     and job.operation = 'listing.create'
     and job.credential_id = p_credential_id
     and job.request_fingerprint ~ '^[a-f0-9]{64}$'
     and job.request_fingerprint = attempt.request_fingerprint
     and attempt.owner_id = p_owner_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.create'
     and attempt.status = 'running'
     and listing.owner_id = p_owner_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'qoo10'
     and listing.market = 'JP'
     and listing.target_id = pg_catalog.btrim(p_target_id)
     and listing.operation_attempt_id = attempt.id
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceId}'
       = p_source_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,ownerId}'
       = p_owner_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,productId}'
       = p_product_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,credentialId}'
       = p_credential_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceRevision}'
       = p_source_revision
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,captureDigest}'
       = p_capture_digest
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,fulfillmentEvidenceDigest}'
       = p_fulfillment_evidence_digest
   for update of job,attempt,listing;
  if not found or v_attempt_id is null or v_listing_id is null then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;

  v_fenced := public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
    p_source_id,p_owner_id,p_product_id,p_credential_id,p_credential_version,
    p_seller_id,p_market,p_target_id,p_source_revision,p_capture_digest,
    p_fulfillment_evidence_digest,null,null
  );
  if v_fenced is not true then
    raise exception 'QOO10_GATEWAY_CREATE_FULFILLMENT_FENCE_REJECTED'
      using errcode = '55000';
  end if;

  -- This call and the QSM fence above share the same database transaction.
  -- A false/throw rolls both back; a committed response binds the same
  -- job/listing/attempt/request fingerprint before SetNewGoods is reachable.
  v_started := public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    p_token_hash,p_job_id,p_claim_token
  );
  if v_started is not true then
    raise exception 'QOO10_GATEWAY_CREATE_PROVIDER_BOUNDARY_REJECTED'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_qoo10_gateway_create_boundary_v1',
    'status','started',
    'sourceId',p_source_id,
    'attemptId',v_attempt_id,
    'listingId',v_listing_id,
    'requestFingerprint',v_request_fingerprint
  );
end;
$$;

revoke all on function public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) to service_role;

revoke all on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) to service_role;


-- Reviewed source: 20260910050000_qoo10_retired_runtime_and_create_recovery_hardening_r5.sql
-- Source SHA256: fbd3aab08ac3b8f1bbc7d634f022d8f036514d37b962a41fecf581e5abcc5157
-- Qoo10 r5: retire the active Lotte/existing-product runtime, re-read
-- current product/listing state at the CREATE mutation CAS, and persist
-- official GET-only recovery so a lost SetNewGoods response is not a
-- permanent manual 409. Existing item 1217536689 is never a fresh CREATE.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 901005000);

-- Safe DB retirement of the 2026-09-09 Lotte/existing-product RPCs.
-- Historical migration bodies stay immutable; execute is revoked.
do $retire_qoo10_lotte_runtime$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_record_qoo10_lotte_existing_carrier_source(jsonb)'
  ) is not null then
    revoke all on function public.sellerpilot_service_record_qoo10_lotte_existing_carrier_source(jsonb)
      from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_get_qoo10_lotte_existing_carrier_source(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,text)'
  ) is not null then
    revoke all on function public.sellerpilot_service_get_qoo10_lotte_existing_carrier_source(
      uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,text
    ) from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_record_qoo10_existing_requirement(text,uuid,uuid,text,jsonb,text,jsonb)'
  ) is not null then
    revoke all on function public.sellerpilot_service_record_qoo10_existing_requirement(
      text,uuid,uuid,text,jsonb,text,jsonb
    ) from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_get_qoo10_lotte_existing_postwrite_context(uuid,uuid)'
  ) is not null then
    revoke all on function public.sellerpilot_service_get_qoo10_lotte_existing_postwrite_context(
      uuid,uuid
    ) from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_complete_qoo10_lotte_existing_postwrite(uuid,uuid,uuid,uuid,text,text,jsonb)'
  ) is not null then
    revoke all on function public.sellerpilot_service_complete_qoo10_lotte_existing_postwrite(
      uuid,uuid,uuid,uuid,text,text,jsonb
    ) from public, anon, authenticated, service_role;
  end if;
end;
$retire_qoo10_lotte_runtime$;

-- Shortened fulfillment fence successor. The 23500 name exceeded 63 bytes
-- and 33500 renamed it to fence_v2; v3 re-reads current product status
-- (active, not merely non-archived) before the historical fence body.
create function public.sellerpilot_service_fence_qoo10_create_now_v3(
  p_source_id uuid,
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_id text,
  p_market text,
  p_target_id text,
  p_source_revision text,
  p_capture_digest text,
  p_fulfillment_evidence_digest text,
  p_attempt_id uuid default null,
  p_request_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.products product
     where product.id = p_product_id
       and product.owner_id = p_owner_id
       and product.demo is false
       and product.status = 'active'
  ) then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_REJECTED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
    p_source_id, p_owner_id, p_product_id, p_credential_id, p_credential_version,
    p_seller_id, p_market, p_target_id, p_source_revision, p_capture_digest,
    p_fulfillment_evidence_digest, p_attempt_id, p_request_fingerprint
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_source_id uuid,
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_id text,
  p_market text,
  p_target_id text,
  p_source_revision text,
  p_capture_digest text,
  p_fulfillment_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_listing_id uuid;
  v_request_fingerprint text;
  v_listing_remote_id text;
  v_listing_status text;
  v_product_demo boolean;
  v_product_status text;
  v_fenced boolean;
  v_started boolean;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_source_id is null
     or p_owner_id is null or p_product_id is null or p_credential_id is null
     or p_credential_version < 1 then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select job.attempt_id, job.listing_id, job.request_fingerprint,
         listing.remote_id, listing.status, product.demo, product.status
    into v_attempt_id, v_listing_id, v_request_fingerprint,
         v_listing_remote_id, v_listing_status, v_product_demo, v_product_status
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > clock_timestamp()
     and job.channel = 'qoo10'
     and job.operation = 'listing.create'
     and job.credential_id = p_credential_id
     and job.request_fingerprint ~ '^[a-f0-9]{64}$'
     and job.request_fingerprint = attempt.request_fingerprint
     and attempt.owner_id = p_owner_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.create'
     and attempt.status = 'running'
     and listing.owner_id = p_owner_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'qoo10'
     and listing.market = 'JP'
     and listing.target_id = pg_catalog.btrim(p_target_id)
     and listing.operation_attempt_id = attempt.id
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceId}'
       = p_source_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,ownerId}'
       = p_owner_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,productId}'
       = p_product_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,credentialId}'
       = p_credential_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceRevision}'
       = p_source_revision
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,captureDigest}'
       = p_capture_digest
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,fulfillmentEvidenceDigest}'
       = p_fulfillment_evidence_digest
   for update of job, attempt, listing, product;
  if not found or v_attempt_id is null or v_listing_id is null then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;

  -- Current-state CAS: a post-enqueue product-status/demo/listing drift
  -- must stop SetNewGoods. Enqueued lineage alone is not enough.
  if v_product_demo is not false
     or v_product_status is distinct from 'active'
     or v_listing_remote_id is not null
     or v_listing_status is distinct from 'queued' then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_REJECTED'
      using errcode = '55000';
  end if;

  v_fenced := public.sellerpilot_service_fence_qoo10_create_now_v3(
    p_source_id, p_owner_id, p_product_id, p_credential_id, p_credential_version,
    p_seller_id, p_market, p_target_id, p_source_revision, p_capture_digest,
    p_fulfillment_evidence_digest, null, null
  );
  if v_fenced is not true then
    raise exception 'QOO10_GATEWAY_CREATE_FULFILLMENT_FENCE_REJECTED'
      using errcode = '55000';
  end if;

  v_started := public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    p_token_hash, p_job_id, p_claim_token
  );
  if v_started is not true then
    raise exception 'QOO10_GATEWAY_CREATE_PROVIDER_BOUNDARY_REJECTED'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_qoo10_gateway_create_boundary_v1',
    'status', 'started',
    'sourceId', p_source_id,
    'attemptId', v_attempt_id,
    'listingId', v_listing_id,
    'requestFingerprint', v_request_fingerprint
  );
end;
$$;

create table if not exists sellerpilot_private.qoo10_create_get_recovery_receipts (
  receipt_id uuid primary key default pg_catalog.gen_random_uuid(),
  source_id uuid not null,
  owner_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  listing_id uuid not null,
  seller_code text not null,
  match_status text not null
    check (match_status in ('unique', 'absent', 'ambiguous')),
  remote_id text,
  receipt_kind text not null
    check (receipt_kind = 'official_get_recovery'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  http_status integer not null,
  result_code text,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (attempt_id)
);

-- Recovery: production attempts use manual_required; gateway jobs retain reconciliation_required.
create function public.sellerpilot_service_qoo10_create_get_rec_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_source_id uuid,
  p_seller_code text,
  p_match_status text,
  p_remote_id text,
  p_request_sha256 text,
  p_response_sha256 text,
  p_http_status integer,
  p_result_code text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_listing_id uuid;
  v_owner_id uuid;
  v_product_id uuid;
  v_credential_id uuid;
  v_listing_remote_id text;
  v_receipt_id uuid;
  v_now timestamptz := clock_timestamp();
  v_remote_id text := nullif(pg_catalog.btrim(coalesce(p_remote_id, '')), '');
  v_seller_code text := pg_catalog.btrim(coalesce(p_seller_code, ''));
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_CREATE_GET_RECOVERY_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_source_id is null
     or v_seller_code = '' or v_seller_code = '1217536689'
     or coalesce(p_match_status, '') not in ('unique', 'absent', 'ambiguous')
     or coalesce(p_request_sha256, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_response_sha256, '') !~ '^[a-f0-9]{64}$'
     or p_http_status is null
     or p_observed_at is null
     or p_observed_at > v_now + interval '5 seconds' then
    raise exception 'QOO10_CREATE_GET_RECOVERY_INVALID'
      using errcode = '22023';
  end if;
  if p_match_status = 'unique' then
    if v_remote_id is null or v_remote_id !~ '^[0-9]{9,10}$' then
      raise exception 'QOO10_CREATE_GET_RECOVERY_INVALID'
        using errcode = '22023';
    end if;
  elsif v_remote_id is not null then
    raise exception 'QOO10_CREATE_GET_RECOVERY_INVALID'
      using errcode = '22023';
  end if;
  if v_remote_id = '1217536689' then
    raise exception 'QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED'
      using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);

  select job.attempt_id, job.listing_id, attempt.owner_id,
         listing.product_id, job.credential_id, listing.remote_id
    into v_attempt_id, v_listing_id, v_owner_id,
         v_product_id, v_credential_id, v_listing_remote_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.qoo10_create_fulfillment_mutation_fences fence
      on fence.source_id = p_source_id
     and fence.owner_id = attempt.owner_id
     and fence.product_id = listing.product_id
     and fence.credential_id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'qoo10'
     and job.operation = 'listing.create'
     and job.provider_mutation_started_at is not null
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.create'
     and attempt.status in ('running', 'manual_required')
     and listing.channel_key = 'qoo10'
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceId}'
       = p_source_id::text
     and job.request_payload#>>'{arguments,params,SellerCode}' = v_seller_code
   for update of job, attempt, listing;
  if not found or v_attempt_id is null or v_listing_id is null then
    raise exception 'QOO10_CREATE_GET_RECOVERY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;
  if v_listing_remote_id is not null then
    raise exception 'QOO10_CREATE_GET_RECOVERY_POST_RECEIPT_EXISTS'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_create_get_recovery_receipts (
    source_id, owner_id, product_id, credential_id, job_id, attempt_id,
    listing_id, seller_code, match_status, remote_id, receipt_kind,
    request_sha256, response_sha256, http_status, result_code, observed_at
  ) values (
    p_source_id, v_owner_id, v_product_id, v_credential_id, p_job_id,
    v_attempt_id, v_listing_id, v_seller_code, p_match_status, v_remote_id,
    'official_get_recovery', p_request_sha256, p_response_sha256,
    p_http_status, nullif(pg_catalog.btrim(coalesce(p_result_code, '')), ''),
    p_observed_at
  )
  returning receipt_id into v_receipt_id;

  -- GET recovery is not a SetNewGoods POST success. Keep listing.remote_id
  -- null and do not publish. Close the permanent 409 by recording GET bytes.
  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'manual_required',
         http_status = p_http_status,
         remote_id = case when p_match_status = 'unique' then v_remote_id else null end,
         safe_message = case p_match_status
           when 'unique' then 'QOO10_CREATE_RECOVERED_VIA_OFFICIAL_GET'
           when 'absent' then 'QOO10_CREATE_GET_RECOVERY_ABSENT'
           else 'QOO10_CREATE_GET_RECOVERY_AMBIGUOUS'
         end,
         completed_at = v_now,
         pre_gateway_retryable = false
   where attempt.id = v_attempt_id
     and attempt.status in ('running', 'manual_required');
  if not found then
    raise exception 'QOO10_CREATE_GET_RECOVERY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'reconciliation_required'
   where job.id = p_job_id
     and job.status in ('running', 'reconciliation_required');

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_qoo10_create_official_get_recovery_v1',
    'status', 'recorded',
    'receiptKind', 'official_get_recovery',
    'receiptId', v_receipt_id,
    'sourceId', p_source_id,
    'attemptId', v_attempt_id,
    'listingId', v_listing_id,
    'matchStatus', p_match_status,
    'remoteId', v_remote_id,
    'listingPublished', false,
    'synthesizedPostReceipt', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_fence_qoo10_create_now_v3(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_fence_qoo10_create_now_v3(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) to service_role;

revoke all on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) to service_role;

revoke all on function public.sellerpilot_service_qoo10_create_get_rec_v1(
  text,uuid,uuid,uuid,text,text,text,text,text,integer,text,timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_qoo10_create_get_rec_v1(
  text,uuid,uuid,uuid,text,text,text,text,text,integer,text,timestamptz
) to service_role;


commit;
