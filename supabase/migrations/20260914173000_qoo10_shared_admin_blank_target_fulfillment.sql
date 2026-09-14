-- Qoo10 has one JP seller account and uses the existing blank external target_id.
-- The exact active credential version plus decrypted seller_id remain the seller fence.
-- Shared admins may own the product and credential separately; both owners must remain admins.
-- Public QAPI has no dispatch-place or return-policy master GET, so this migration does
-- not synthesize the browser-only fulfillment capture.

begin;

alter table sellerpilot_private.qoo10_create_fulfillment_captures
  drop constraint qoo10_create_fulfillment_captures_target_id_check;
alter table sellerpilot_private.qoo10_create_fulfillment_captures
  add constraint qoo10_create_fulfillment_captures_target_id_check
  check (length(btrim(target_id)) <= 160);
alter table sellerpilot_private.qoo10_create_fulfillment_captures
  add column source_product_status text not null
  check (source_product_status in ('draft', 'active'));

create or replace function public.sellerpilot_service_record_qoo10_create_fulfillment_capture(
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
  v_product_status text;
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
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_target_id, ''))) > 160
     or not exists (
       select 1 from sellerpilot_private.products product
        where product.id = p_product_id and product.owner_id = p_owner_id
          and product.demo is false and product.status in ('draft', 'active')
     ) then
    raise exception 'QOO10_CREATE_FULFILLMENT_PRODUCT_TARGET_MISMATCH' using errcode = '22023';
  end if;
  select product.status into strict v_product_status
    from sellerpilot_private.products product
   where product.id = p_product_id and product.owner_id = p_owner_id
     and product.demo is false and product.status in ('draft', 'active');

  select nullif(pg_catalog.btrim(secret.decrypted_secret::jsonb->>'seller_id'), '')
    into v_secret_seller_id
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and exists (
       select 1 from sellerpilot_private.admin_users credential_admin
        where credential_admin.user_id = credential.created_by
     )
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
    source_revision, capture_digest, source_product_status, stored_capture_sha256,
    observed_at, expires_at, capture, recorded_at
  ) values (
    p_owner_id, p_product_id, p_credential_id, p_credential_version,
    'JP', pg_catalog.btrim(p_target_id),
    pg_catalog.btrim(p_seller_id), pg_catalog.btrim(p_test_item_code),
    pg_catalog.btrim(p_capture->>'testItemSellerCode'),
    pg_catalog.btrim(p_dispatch_place_id), pg_catalog.btrim(p_return_policy_id),
    p_source_revision, p_capture_digest, v_product_status,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_capture::text, 'UTF8'), 'sha256'), 'hex'),
    v_observed_at, v_observed_at + interval '5 minutes', p_capture, v_now
  ) returning source_id into v_source_id;
  return v_source_id;
end;
$$;

create or replace function public.sellerpilot_service_take_qoo10_create_fulfillment_capture(
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
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_target_id, ''))) > 160
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
     and credential.channel = 'qoo10'
     and exists (
       select 1 from sellerpilot_private.admin_users credential_admin
        where credential_admin.user_id = credential.created_by
     )
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

create or replace function public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
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
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_target_id, ''))) > 160
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
     and credential.channel = 'qoo10'
     and exists (
       select 1 from sellerpilot_private.admin_users credential_admin
        where credential_admin.user_id = credential.created_by
     )
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

create or replace function public.sellerpilot_service_fence_qoo10_create_now_v3(
  p_source_id uuid, p_owner_id uuid, p_product_id uuid, p_credential_id uuid,
  p_credential_version integer, p_seller_id text, p_market text, p_target_id text,
  p_source_revision text, p_capture_digest text, p_fulfillment_evidence_digest text,
  p_attempt_id uuid default null, p_request_fingerprint text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_source_product_status text;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_ACCESS_DENIED' using errcode = '42501';
  end if;
  select source.source_product_status into v_source_product_status
    from sellerpilot_private.qoo10_create_fulfillment_captures source
   where source.source_id=p_source_id and source.owner_id=p_owner_id
     and source.product_id=p_product_id and source.credential_id=p_credential_id
     and source.credential_version=p_credential_version;
  if v_source_product_status is null or not exists (
    select 1 from sellerpilot_private.products product
     where product.id=p_product_id and product.owner_id=p_owner_id
       and product.demo is false and product.status=v_source_product_status
       and product.status in ('draft','active')
  ) then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_REJECTED' using errcode = '55000';
  end if;
  return public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
    p_source_id,p_owner_id,p_product_id,p_credential_id,p_credential_version,
    p_seller_id,p_market,p_target_id,p_source_revision,p_capture_digest,
    p_fulfillment_evidence_digest,p_attempt_id,p_request_fingerprint
  );
end;
$$;

revoke all on function public.sellerpilot_service_record_qoo10_create_fulfillment_capture(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,jsonb), public.sellerpilot_service_take_qoo10_create_fulfillment_capture(uuid,uuid,uuid,integer,text,text), public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text), public.sellerpilot_service_fence_qoo10_create_now_v3(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_qoo10_create_fulfillment_capture(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,jsonb), public.sellerpilot_service_take_qoo10_create_fulfillment_capture(uuid,uuid,uuid,integer,text,text), public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text), public.sellerpilot_service_fence_qoo10_create_now_v3(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text) to service_role;

commit;
