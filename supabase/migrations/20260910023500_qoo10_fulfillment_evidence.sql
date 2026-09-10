-- Durable, service-role-only source for one sanitized CHANGHEE QSM capture.
-- The create route consumes one fresh row before fingerprint, claim or enqueue.

begin;

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

commit;
