-- Recover one exact legacy 11st Product snapshot with a provider-write-free
-- GET. The legacy create predates listing/account/fingerprint binding and the
-- eight-image publication contract, so it may prove only immutable remote
-- identity. It must never create a live publication review or assert that the
-- current approved eight-image detail build is already present remotely.

begin;

create table sellerpilot_private.elevenst_exact_legacy_source_attestations (
  source_job_id uuid primary key check (
    source_job_id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
  ) references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  listing_id uuid not null unique check (
    listing_id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
  ) references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null check (
    product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
  ) references sellerpilot_private.products(id) on delete restrict,
  source_attempt_id uuid not null unique check (
    source_attempt_id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
  ) references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null check (
    credential_id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
  ) references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  remote_id text not null check (remote_id = '9573255804'),
  source_request_sha256 text not null check (
    source_request_sha256 =
      'eed923ee9a26973e58d1f8ba381c28e190296f7c89b10cce5d7ec4d4fa1dbd71'
  ),
  source_response_sha256 text not null check (
    source_response_sha256 =
      '77debf98a349c27cbecc8a348f62e8fdf55d61d97fe87e7bac8e4d9f68fb7fd7'
  ),
  source_request_bytes integer not null check (source_request_bytes = 4349),
  source_response_bytes integer not null check (source_response_bytes = 1083),
  source_attempt_fingerprint text not null check (
    source_attempt_fingerprint =
      '1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af'
  ),
  approved_manifest_digest text not null check (
    approved_manifest_digest =
      '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
  ),
  approved_detail_page_version bigint not null check (
    approved_detail_page_version = 1
  ),
  source_created_at timestamptz not null check (
    source_created_at = '2026-08-24T07:42:18.57602Z'::timestamptz
  ),
  source_started_at timestamptz not null check (
    source_started_at = '2026-08-24T07:42:22.07751Z'::timestamptz
  ),
  source_completed_at timestamptz not null check (
    source_completed_at = '2026-08-24T07:42:26.415136Z'::timestamptz
  ),
  source_updated_at timestamptz not null check (
    source_updated_at = '2026-08-24T07:42:26.415136Z'::timestamptz
  ),
  attested_at timestamptz not null default clock_timestamp()
);

create table sellerpilot_private.elevenst_listing_snapshot_recoveries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references
    sellerpilot_private.product_listings(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references
    sellerpilot_private.products(id) on delete restrict,
  source_job_id uuid not null references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  verification_job_id uuid not null unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  remote_id text not null check (remote_id = '9573255804'),
  expected_fingerprint text not null check (expected_fingerprint ~ '^[a-f0-9]{64}$'),
  approved_manifest_digest text not null check (
    approved_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  approved_detail_page_version bigint not null check (approved_detail_page_version > 0),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'failed',
    'reconciliation_required', 'cancelled'
  )),
  safe_error text check (safe_error is null or length(safe_error) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create unique index elevenst_snapshot_recovery_active_listing_idx
  on sellerpilot_private.elevenst_listing_snapshot_recoveries (listing_id)
  where status in ('queued', 'running', 'reconciliation_required');

alter table sellerpilot_private.elevenst_exact_legacy_source_attestations
  enable row level security;
alter table sellerpilot_private.elevenst_listing_snapshot_recoveries
  enable row level security;
revoke all on sellerpilot_private.elevenst_exact_legacy_source_attestations
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.elevenst_listing_snapshot_recoveries
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_legacy_snapshot_immutable_product_matches(
  p_source jsonb,
  p_remote jsonb
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_typeof(p_source) = 'object'
     and jsonb_typeof(p_remote) = 'object'
     and nullif(trim(p_source->>'sellerPrdCd'), '') is not null
     and nullif(trim(p_source->>'dispCtgrNo'), '') is not null
     and (p_remote->>'sellerPrdCd') is not distinct from (p_source->>'sellerPrdCd')
     and (p_remote->>'dispCtgrNo') is not distinct from (p_source->>'dispCtgrNo')
     and (p_remote->>'selMthdCd') is not distinct from (p_source->>'selMthdCd')
     and (p_remote->>'prdTypCd') is not distinct from (p_source->>'prdTypCd')
     and (p_remote->>'rmaterialTypCd') is not distinct from (p_source->>'rmaterialTypCd')
     and (p_remote->>'orgnTypCd') is not distinct from (p_source->>'orgnTypCd')
     and (p_remote->>'suplDtyfrPrdClfCd') is not distinct from
           (p_source->>'suplDtyfrPrdClfCd')
     and (p_remote->>'forAbrdBuyClf') is not distinct from
           (p_source->>'forAbrdBuyClf')
     and (p_remote->>'minorSelCnYn') is not distinct from (p_source->>'minorSelCnYn')
     and (p_remote->>'selPrdClfCd') is not distinct from (p_source->>'selPrdClfCd')
     and (p_remote->>'dlvCnAreaCd') is not distinct from (p_source->>'dlvCnAreaCd')
     and (p_remote->>'dlvWyCd') is not distinct from (p_source->>'dlvWyCd')
     and (p_remote->>'dlvCstInstBasiCd') is not distinct from
           (p_source->>'dlvCstInstBasiCd')
     and (p_remote->>'bndlDlvCnYn') is not distinct from (p_source->>'bndlDlvCnYn')
     and (p_remote->>'dlvCstPayTypCd') is not distinct from
           (p_source->>'dlvCstPayTypCd')
     and (p_remote->'ProductCertGroup') is not distinct from
           (p_source->'ProductCertGroup')
$$;

revoke all on function
  sellerpilot_private.elevenst_legacy_snapshot_immutable_product_matches(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- The insert is a one-off attestation, not a generic null-field backfill. A
-- fresh database has none of these IDs and therefore inserts nothing. If any
-- production tuple member exists, every immutable field and digest must match
-- or the migration aborts without creating an attestation.
do $attest_exact_elevenst_legacy_source$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_request_sha text;
  v_response_sha text;
  v_same_attempt_jobs integer;
  v_same_remote_jobs integer;
  v_later_writes integer;
begin
  if not exists (
    select 1 from sellerpilot_private.channel_gateway_jobs
     where id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
  ) and not exists (
    select 1 from sellerpilot_private.product_listings
     where id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
  ) and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts
     where id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
  ) then
    return;
  end if;

  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs
   where id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid;
  select * into strict v_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid;
  select * into strict v_listing
    from sellerpilot_private.product_listings
   where id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid;
  select * into strict v_product
    from sellerpilot_private.products
   where id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  select * into strict v_credential
    from sellerpilot_private.channel_credentials
   where id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid;

  v_request_sha := encode(
    extensions.digest(v_job.request_payload::text, 'sha256'), 'hex'
  );
  v_response_sha := encode(
    extensions.digest(v_job.response_payload::text, 'sha256'), 'hex'
  );
  select count(*)::integer into v_same_attempt_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.attempt_id = v_attempt.id
     and job.channel = 'elevenst'
     and job.operation in ('listing.create', 'listing.update');
  select count(*)::integer into v_same_remote_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'elevenst'
     and job.operation in ('listing.create', 'listing.update')
     and job.response_payload->>'remoteId' = '9573255804';
  select count(*)::integer into v_later_writes
    from sellerpilot_private.channel_gateway_jobs job
   where job.id <> v_job.id
     and job.channel = 'elevenst'
     and job.operation in ('listing.create', 'listing.update', 'listing.stop')
     and job.created_at > v_job.completed_at
     and (
       job.listing_id = v_listing.id
       or job.attempt_id = v_attempt.id
       or job.response_payload->>'remoteId' = '9573255804'
       or job.request_payload#>>'{arguments,remoteId}' = '9573255804'
       or job.request_payload#>>'{arguments,productNo}' = '9573255804'
     );

  if v_job.credential_id <> v_credential.id
     or v_job.attempt_id <> v_attempt.id
     or v_job.listing_id is not null
     or v_job.channel <> 'elevenst'
     or v_job.operation <> 'listing.create'
     or v_job.environment <> 'production'
     or v_job.status <> 'succeeded'
     or v_job.attempt_count <> 1
     or v_job.seller_account_key is not null
     or v_job.request_fingerprint is not null
     or v_job.provider_mutation_started_at is not null
     or v_job.created_at <> '2026-08-24T07:42:18.57602Z'::timestamptz
     or v_job.started_at <> '2026-08-24T07:42:22.07751Z'::timestamptz
     or v_job.completed_at <> '2026-08-24T07:42:26.415136Z'::timestamptz
     or v_job.updated_at <> '2026-08-24T07:42:26.415136Z'::timestamptz
     or octet_length(v_job.request_payload::text) <> 4349
     or octet_length(v_job.response_payload::text) <> 1083
     or v_request_sha <>
       'eed923ee9a26973e58d1f8ba381c28e190296f7c89b10cce5d7ec4d4fa1dbd71'
     or v_response_sha <>
       '77debf98a349c27cbecc8a348f62e8fdf55d61d97fe87e7bac8e4d9f68fb7fd7'
     or v_job.request_payload#>>'{arguments,product,prdNm}' <>
       '부착형 케이블 정리 클립 6개 세트'
     or v_job.request_payload#>>'{arguments,product,dispCtgrNo}' <> '1341821'
     or jsonb_typeof(v_job.request_payload#>'{arguments,product}') <> 'object'
     or jsonb_typeof(v_job.response_payload->'steps') <> 'array'
     or jsonb_array_length(v_job.response_payload->'steps') <> 3
     or v_job.response_payload->>'ok' <> 'true'
     or v_job.response_payload->>'remoteId' <> '9573255804'
     or v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
          is not null
     or v_job.response_payload->'remoteState' is not null
     or (select count(*) from jsonb_object_keys(v_job.request_payload->'arguments')) <> 2
     or not (v_job.request_payload->'arguments' ? 'product')
     or not (v_job.request_payload->'arguments' ? 'verificationOnly')
     or not exists (
       select 1 from jsonb_array_elements(v_job.response_payload->'steps') step(value)
        where step.value->>'name' = 'product-create'
          and step.value->>'ok' = 'true'
          and step.value->>'status' = '200'
     )
     or not exists (
       select 1 from jsonb_array_elements(v_job.response_payload->'steps') step(value)
        where step.value->>'name' = 'product-readback'
          and step.value->>'ok' = 'true'
          and step.value->>'status' = '200'
     )
     or not exists (
       select 1 from jsonb_array_elements(v_job.response_payload->'steps') step(value)
        where step.value->>'name' = 'verification-stop-display'
          and step.value->>'ok' = 'true'
          and step.value->>'status' = '200'
     )
     or v_attempt.owner_id <> v_listing.owner_id
     or v_job.created_by <> v_listing.owner_id
     or v_attempt.credential_id <> v_credential.id
     or v_attempt.channel <> 'elevenst'
     or v_attempt.operation <> 'listing.create'
     or v_attempt.status <> 'succeeded'
     or v_attempt.http_status <> 200
     or v_attempt.remote_id <> '9573255804'
     or v_attempt.request_fingerprint <>
       '1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af'
     or v_attempt.gateway_write_required
     or v_attempt.pre_gateway_retryable
     or v_attempt.seller_account_key is not null
     or v_listing.product_id <> v_product.id
     or v_listing.operation_attempt_id <> v_attempt.id
     or v_listing.channel_key <> 'elevenst'
     or v_listing.remote_id <> '9573255804'
     or v_listing.status <> 'failed'
     or v_listing.failure_class <> 'external_action'
     or v_listing.requested_publication_intent <> 'live'
     or v_listing.remote_visibility <> 'unknown'
     or v_listing.seller_account_key is null
     or v_listing.marketplace_sku is distinct from
          v_job.request_payload#>>'{arguments,product,sellerPrdCd}'
     or v_credential.channel <> 'elevenst'
     or v_credential.environment <> 'production'
     or v_credential.version <> 2
     or v_credential.status <> 'active'
     or v_credential.seller_account_key is distinct from
          v_listing.seller_account_key
     or v_credential.seller_account_key_source <> 'credential_incarnation_v1'
     or v_credential.seller_account_verified_at is null
     or v_credential.last_check_status <> 'passed'
     or v_product.owner_id <> v_listing.owner_id
     or v_product.detail_page_version <> 1
     or v_product.detail_page_approved_version <> 1
     or v_product.detail_page_image_manifest->>'contract' <>
          'sellerpilot_detail_image_manifest_v2'
     or v_product.detail_page_image_manifest->>'digest' <>
          '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
     or jsonb_typeof(v_product.detail_page_image_manifest->'images') <> 'array'
     or jsonb_array_length(v_product.detail_page_image_manifest->'images') <> 8
     or v_same_attempt_jobs <> 1
     or v_same_remote_jobs <> 1
     or v_later_writes <> 0
     or sellerpilot_private.listing_mutation_release_gate_is_effective()
     or sellerpilot_private.listing_mutation_release_gate_is_effective('elevenst') then
    raise exception 'exact 11st legacy source tuple does not match';
  end if;

  insert into sellerpilot_private.elevenst_exact_legacy_source_attestations (
    source_job_id, listing_id, product_id, source_attempt_id,
    credential_id, owner_id, seller_account_key, remote_id,
    source_request_sha256, source_response_sha256,
    source_request_bytes, source_response_bytes, source_attempt_fingerprint,
    approved_manifest_digest, approved_detail_page_version,
    source_created_at, source_started_at, source_completed_at, source_updated_at
  ) values (
    v_job.id, v_listing.id, v_product.id, v_attempt.id,
    v_credential.id, v_listing.owner_id, v_listing.seller_account_key,
    v_listing.remote_id, v_request_sha, v_response_sha,
    octet_length(v_job.request_payload::text),
    octet_length(v_job.response_payload::text),
    v_attempt.request_fingerprint,
    v_product.detail_page_image_manifest->>'digest',
    v_product.detail_page_approved_version,
    v_job.created_at, v_job.started_at, v_job.completed_at, v_job.updated_at
  );
exception
  when no_data_found or too_many_rows then
    raise exception 'exact 11st legacy source tuple is incomplete';
end;
$attest_exact_elevenst_legacy_source$;

create function sellerpilot_private.elevenst_listing_snapshot_recovery_context(
  p_listing_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_release_sha text;
begin
  select attestation.*, listing.market, listing.target_id,
         listing.marketplace_sku, source_job.environment
    into v_context
    from sellerpilot_private.elevenst_exact_legacy_source_attestations attestation
    join sellerpilot_private.product_listings listing
      on listing.id = attestation.listing_id
     and listing.owner_id = attestation.owner_id
     and listing.product_id = attestation.product_id
     and listing.operation_attempt_id = attestation.source_attempt_id
     and listing.channel_key = 'elevenst'
     and listing.remote_id = attestation.remote_id
     and listing.seller_account_key = attestation.seller_account_key
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
    join sellerpilot_private.products product
      on product.id = attestation.product_id
     and product.owner_id = attestation.owner_id
     and product.detail_page_version = attestation.approved_detail_page_version
     and product.detail_page_approved_version = attestation.approved_detail_page_version
     and product.detail_page_image_manifest->>'contract' =
       'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'digest' =
       attestation.approved_manifest_digest
     and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
     and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = attestation.source_attempt_id
     and attempt.owner_id = attestation.owner_id
     and attempt.credential_id = attestation.credential_id
     and attempt.channel = 'elevenst'
     and attempt.operation = 'listing.create'
     and attempt.status = 'succeeded'
     and attempt.http_status = 200
     and attempt.remote_id = attestation.remote_id
     and attempt.request_fingerprint = attestation.source_attempt_fingerprint
     and not attempt.gateway_write_required
     and not attempt.pre_gateway_retryable
     and attempt.seller_account_key is null
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = attestation.source_job_id
     and source_job.credential_id = attestation.credential_id
     and source_job.attempt_id = attestation.source_attempt_id
     and source_job.listing_id is null
     and source_job.channel = 'elevenst'
     and source_job.operation = 'listing.create'
     and source_job.environment = 'production'
     and source_job.status = 'succeeded'
     and source_job.attempt_count = 1
     and source_job.seller_account_key is null
     and source_job.request_fingerprint is null
     and source_job.provider_mutation_started_at is null
     and source_job.response_payload->>'ok' = 'true'
     and source_job.response_payload->>'remoteId' = attestation.remote_id
     and octet_length(source_job.request_payload::text) =
       attestation.source_request_bytes
     and octet_length(source_job.response_payload::text) =
       attestation.source_response_bytes
     and encode(extensions.digest(source_job.request_payload::text, 'sha256'), 'hex') =
       attestation.source_request_sha256
     and encode(extensions.digest(source_job.response_payload::text, 'sha256'), 'hex') =
       attestation.source_response_sha256
    join sellerpilot_private.channel_credentials credential
      on credential.id = attestation.credential_id
     and credential.channel = 'elevenst'
     and credential.environment = source_job.environment
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key = attestation.seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
     and credential.last_check_status = 'passed'
     and credential.last_checked_at is not null
   where attestation.listing_id = p_listing_id;
  if not found then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked', 'blockedReason', 'exact_legacy_source_attestation_required'
    );
  end if;

  if exists (
    select 1 from sellerpilot_private.elevenst_listing_snapshots snapshot
     where snapshot.listing_id = p_listing_id
  ) then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked', 'blockedReason', 'trusted_snapshot_already_exists'
    );
  end if;
  if exists (
    select 1 from sellerpilot_private.listing_publication_reviews review
     where review.listing_id = p_listing_id
  ) then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked', 'blockedReason', 'publication_review_already_exists'
    );
  end if;
  if exists (
    select 1
      from sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
     where recovery.listing_id = p_listing_id
       and recovery.status in ('queued', 'running', 'reconciliation_required')
  ) then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked', 'blockedReason', 'snapshot_recovery_already_active'
    );
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = p_listing_id
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'listing.publication.verify'
       )
  ) then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked', 'blockedReason', 'listing_gateway_work_already_active'
    );
  end if;
  if not sellerpilot_private.serverless_static_egress_allowed('elevenst') then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked', 'blockedReason', 'static_egress_required'
    );
  end if;

  select adapter.release_sha into v_release_sha
    from sellerpilot_private.listing_publication_adapter_release adapter
    join sellerpilot_private.listing_publication_rechecker_release rechecker
      on rechecker.singleton
     and rechecker.rechecker_ready
     and rechecker.release_sha = adapter.release_sha
     and rechecker.verified_at is not null
   where adapter.channel = 'elevenst'
     and adapter.adapter_ready
     and adapter.contract_version = 'verified_remote_state_v1'
     and adapter.verified_at is not null
     and adapter.release_sha =
       sellerpilot_private.active_serverless_runtime_release_sha();
  if not found then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', 'blocked',
      'blockedReason', 'exact_adapter_rechecker_runtime_release_required'
    );
  end if;

  return jsonb_build_object(
    'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
    'status', 'ready',
    'readOnly', true,
    'snapshotOnly', true,
    'approvedContentVerified', false,
    'publicationReviewAllowed', false,
    'createAllowed', false,
    'listingMutationAllowed', false,
    'listingId', v_context.listing_id,
    'ownerId', v_context.owner_id,
    'productId', v_context.product_id,
    'sourceJobId', v_context.source_job_id,
    'sourceAttemptId', v_context.source_attempt_id,
    'sourceOperation', 'listing.create',
    'credentialId', v_context.credential_id,
    'sellerAccountKey', v_context.seller_account_key,
    'environment', v_context.environment,
    'market', v_context.market,
    'targetId', v_context.target_id,
    'marketplaceSku', v_context.marketplace_sku,
    'remoteId', v_context.remote_id,
    'expectedLocale', 'ko-KR',
    'approvedTargetImageCount', 8,
    'expectedFingerprint', v_context.source_attempt_fingerprint,
    'approvedManifestDigest', v_context.approved_manifest_digest,
    'approvedDetailPageVersion', v_context.approved_detail_page_version,
    'sourceRequestSha256', v_context.source_request_sha256,
    'sourceResponseSha256', v_context.source_response_sha256,
    'releaseSha', v_release_sha
  );
exception when others then
  return jsonb_build_object(
    'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
    'status', 'blocked', 'blockedReason', 'snapshot_recovery_context_unavailable'
  );
end;
$$;

revoke all on function
  sellerpilot_private.elevenst_listing_snapshot_recovery_context(uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_prepare_elevenst_listing_snapshot_recovery(
  p_listing_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return sellerpilot_private.elevenst_listing_snapshot_recovery_context(
    p_listing_id
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_prepare_elevenst_listing_snapshot_recovery(uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_prepare_elevenst_listing_snapshot_recovery(uuid)
  to service_role;

create function public.sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery(
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_existing record;
  v_job_id uuid;
  v_recovery_id uuid;
  v_arguments jsonb;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_listing_id is null then
    raise exception 'listing id required' using errcode = '22004';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:elevenst-snapshot:' || p_listing_id::text)
  );

  select recovery.id, recovery.verification_job_id, recovery.status
    into v_existing
    from sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
   where recovery.listing_id = p_listing_id
     and recovery.status in ('queued', 'running', 'reconciliation_required')
   order by recovery.created_at desc, recovery.id
   limit 1;
  if found then
    return jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'status', v_existing.status, 'queued', true,
      'readOnly', true, 'snapshotOnly', true,
      'approvedContentVerified', false, 'publicationReviewAllowed', false,
      'createAllowed', false, 'listingMutationAllowed', false,
      'recoveryId', v_existing.id, 'jobId', v_existing.verification_job_id
    );
  end if;

  v_context := sellerpilot_private.elevenst_listing_snapshot_recovery_context(
    p_listing_id
  );
  if v_context->>'status' <> 'ready' then return v_context; end if;

  v_job_id := gen_random_uuid();
  v_recovery_id := gen_random_uuid();
  v_arguments := jsonb_build_object(
    'sellerpilotElevenstSnapshotRecovery',
      'elevenst_exact_legacy_snapshot_recovery_v1',
    'elevenstSnapshotRecoveryId', v_recovery_id,
    'publicationReviewSourceJobId', v_context->>'sourceJobId',
    'sellerpilotReadOnly', true,
    'sellerpilotSnapshotOnly', true,
    'remoteId', v_context->>'remoteId',
    'market', coalesce(v_context->>'market', ''),
    'targetId', coalesce(v_context->>'targetId', ''),
    'publicationIntent', 'live',
    'publicationStateContract', 'verified_remote_state_v1',
    'publicationExpectedLocale', 'ko-KR',
    'publicationExpectedFingerprint', v_context->>'expectedFingerprint',
    'publicationExpectedImageCount', 8,
    'approvedManifestDigest', v_context->>'approvedManifestDigest',
    'approvedDetailPageVersion',
      (v_context->>'approvedDetailPageVersion')::bigint
  );

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key,
    request_fingerprint, created_by, created_at, updated_at
  ) values (
    v_job_id, (v_context->>'credentialId')::uuid, null, p_listing_id,
    'elevenst', 'listing.publication.verify', v_context->>'environment',
    jsonb_build_object(
      'periodicKey', 'elevenst-legacy-snapshot:' || p_listing_id::text,
      'arguments', v_arguments
    ),
    'queued', v_context->>'sellerAccountKey',
    v_context->>'expectedFingerprint', (v_context->>'ownerId')::uuid,
    clock_timestamp(), clock_timestamp()
  );

  insert into sellerpilot_private.elevenst_listing_snapshot_recoveries (
    id, listing_id, owner_id, product_id, source_job_id,
    source_attempt_id, verification_job_id, credential_id,
    seller_account_key, remote_id, expected_fingerprint,
    approved_manifest_digest, approved_detail_page_version
  ) values (
    v_recovery_id, p_listing_id, (v_context->>'ownerId')::uuid,
    (v_context->>'productId')::uuid, (v_context->>'sourceJobId')::uuid,
    (v_context->>'sourceAttemptId')::uuid, v_job_id,
    (v_context->>'credentialId')::uuid, v_context->>'sellerAccountKey',
    v_context->>'remoteId', v_context->>'expectedFingerprint',
    v_context->>'approvedManifestDigest',
    (v_context->>'approvedDetailPageVersion')::bigint
  );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    (v_context->>'ownerId')::uuid,
    'elevenst_legacy_listing_snapshot_recovery_queued',
    'product_listing', p_listing_id::text,
    jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'jobId', v_job_id, 'sourceJobId', v_context->>'sourceJobId',
      'remoteId', v_context->>'remoteId',
      'readOnly', true, 'snapshotOnly', true,
      'approvedContentVerified', false, 'publicationReviewAllowed', false,
      'createAllowed', false, 'listingMutationAllowed', false
    )
  );

  return v_context || jsonb_build_object(
    'status', 'queued', 'queued', true,
    'recoveryId', v_recovery_id, 'jobId', v_job_id
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery(uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery(uuid)
  to service_role;

-- Keep the normal publication source resolver intact. Only its explicit
-- source-unavailable result may enter this exact snapshot-only fallback.
alter function public.sellerpilot_service_listing_publication_verification_source(
  text, uuid, uuid
) rename to sellerpilot_310540_listing_publication_verification_source;
revoke all on function
  public.sellerpilot_310540_listing_publication_verification_source(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_listing_publication_verification_source(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
begin
  begin
    return public.sellerpilot_310540_listing_publication_verification_source(
      p_token_hash, p_job_id, p_claim_token
    );
  exception when sqlstate '55000' then
    null;
  end;

  if p_token_hash is null
     or p_job_id is null
     or p_claim_token is null
     or not sellerpilot_private.serverless_cs_job_is_owned(
       p_token_hash, p_job_id, p_claim_token, true
     ) then
    raise exception 'publication verification source ownership required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'contract', 'listing_publication_verification_source_v1',
           'verificationJobId', verifier.id,
           'sourceJobId', source_job.id,
           'sourceOperation', 'listing.create',
           'sourceArguments',
             source_job.request_payload->'arguments' || jsonb_build_object(
               'sellerpilotElevenstLegacySnapshotAttestation',
               jsonb_build_object(
                 'contract', 'elevenst_exact_legacy_source_attestation_v1',
                 'snapshotOnly', true,
                 'approvedContentVerified', false,
                 'publicationReviewAllowed', false,
                 'sourceRequestSha256', attestation.source_request_sha256,
                 'sourceResponseSha256', attestation.source_response_sha256,
                 'approvedManifestDigest', attestation.approved_manifest_digest,
                 'approvedDetailPageVersion',
                   attestation.approved_detail_page_version
               )
             ),
           'sourceResponsePayload', source_job.response_payload,
           'sourceFingerprint', attestation.source_attempt_fingerprint,
           'expectedRemoteId', attestation.remote_id,
           'expectedLocale', 'ko-KR',
           'expectedImageCount', 8,
           'market', listing.market,
           'targetId', listing.target_id
         )
    into v_source
    from sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
    join sellerpilot_private.elevenst_exact_legacy_source_attestations attestation
      on attestation.listing_id = recovery.listing_id
     and attestation.source_job_id = recovery.source_job_id
     and attestation.source_attempt_id = recovery.source_attempt_id
     and attestation.credential_id = recovery.credential_id
     and attestation.owner_id = recovery.owner_id
     and attestation.product_id = recovery.product_id
     and attestation.seller_account_key = recovery.seller_account_key
     and attestation.remote_id = recovery.remote_id
     and attestation.source_attempt_fingerprint = recovery.expected_fingerprint
     and attestation.approved_manifest_digest = recovery.approved_manifest_digest
     and attestation.approved_detail_page_version =
       recovery.approved_detail_page_version
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = recovery.verification_job_id
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = recovery.source_job_id
     and source_job.listing_id is null
     and source_job.seller_account_key is null
     and source_job.request_fingerprint is null
     and source_job.provider_mutation_started_at is null
     and encode(extensions.digest(source_job.request_payload::text, 'sha256'), 'hex') =
       attestation.source_request_sha256
     and encode(extensions.digest(source_job.response_payload::text, 'sha256'), 'hex') =
       attestation.source_response_sha256
    join sellerpilot_private.product_listings listing
      on listing.id = recovery.listing_id
     and listing.owner_id = recovery.owner_id
     and listing.product_id = recovery.product_id
     and listing.operation_attempt_id = recovery.source_attempt_id
     and listing.channel_key = 'elevenst'
     and listing.remote_id = recovery.remote_id
     and listing.seller_account_key = recovery.seller_account_key
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
    join sellerpilot_private.products product
      on product.id = recovery.product_id
     and product.owner_id = recovery.owner_id
     and product.detail_page_version = recovery.approved_detail_page_version
     and product.detail_page_approved_version = recovery.approved_detail_page_version
     and product.detail_page_image_manifest->>'digest' =
       recovery.approved_manifest_digest
     and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
     and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
    join sellerpilot_private.channel_credentials credential
      on credential.id = recovery.credential_id
     and credential.channel = 'elevenst'
     and credential.environment = verifier.environment
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key = recovery.seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
     and credential.last_check_status = 'passed'
     and credential.last_checked_at is not null
    join sellerpilot_private.listing_publication_adapter_release adapter
      on adapter.channel = 'elevenst'
     and adapter.adapter_ready
     and adapter.contract_version = 'verified_remote_state_v1'
     and adapter.verified_at is not null
    join sellerpilot_private.listing_publication_rechecker_release rechecker
      on rechecker.singleton
     and rechecker.rechecker_ready
     and rechecker.release_sha = adapter.release_sha
     and rechecker.verified_at is not null
   where recovery.id = (
           verifier.request_payload#>>'{arguments,elevenstSnapshotRecoveryId}'
         )::uuid
     and recovery.status = 'running'
     and verifier.id = p_job_id
     and verifier.claim_token = p_claim_token
     and verifier.status = 'running'
     and verifier.channel = 'elevenst'
     and verifier.operation = 'listing.publication.verify'
     and verifier.attempt_id is null
     and verifier.provider_mutation_started_at is null
     and verifier.write_resource_kind is null
     and verifier.write_resource_key is null
     and verifier.request_fingerprint = recovery.expected_fingerprint
     and verifier.request_payload#>>'{arguments,sellerpilotElevenstSnapshotRecovery}' =
       'elevenst_exact_legacy_snapshot_recovery_v1'
     and verifier.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
     and verifier.request_payload#>>'{arguments,sellerpilotSnapshotOnly}' = 'true'
     and verifier.request_payload#>>'{arguments,publicationReviewSourceJobId}' =
       source_job.id::text
     and verifier.request_payload#>>'{arguments,remoteId}' = recovery.remote_id
     and verifier.request_payload#>>'{arguments,publicationExpectedLocale}' = 'ko-KR'
     and verifier.request_payload#>>'{arguments,publicationExpectedFingerprint}' =
       recovery.expected_fingerprint
     and verifier.request_payload#>>'{arguments,publicationExpectedImageCount}' = '8'
     and verifier.request_payload#>>'{arguments,approvedManifestDigest}' =
       recovery.approved_manifest_digest
     and verifier.request_payload#>>'{arguments,approvedDetailPageVersion}' =
       recovery.approved_detail_page_version::text
     and sellerpilot_private.serverless_static_egress_allowed('elevenst')
     and adapter.release_sha =
       sellerpilot_private.active_serverless_runtime_release_sha();

  if v_source is null then
    raise exception 'publication verification source is unavailable'
      using errcode = '55000';
  end if;
  return v_source;
exception when invalid_text_representation then
  raise exception 'publication verification source is unavailable'
    using errcode = '55000';
end;
$$;

revoke all on function
  public.sellerpilot_service_listing_publication_verification_source(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_listing_publication_verification_source(
    text, uuid, uuid
  ) to service_role;

create function sellerpilot_private.elevenst_snapshot_recovery_completion_valid(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
      join sellerpilot_private.elevenst_exact_legacy_source_attestations attestation
        on attestation.listing_id = recovery.listing_id
       and attestation.source_job_id = recovery.source_job_id
       and attestation.source_attempt_id = recovery.source_attempt_id
       and attestation.credential_id = recovery.credential_id
       and attestation.owner_id = recovery.owner_id
       and attestation.product_id = recovery.product_id
       and attestation.seller_account_key = recovery.seller_account_key
       and attestation.remote_id = recovery.remote_id
       and attestation.source_attempt_fingerprint = recovery.expected_fingerprint
       and attestation.approved_manifest_digest = recovery.approved_manifest_digest
       and attestation.approved_detail_page_version =
         recovery.approved_detail_page_version
      join sellerpilot_private.channel_gateway_jobs verifier
        on verifier.id = recovery.verification_job_id
      join sellerpilot_private.channel_gateway_jobs source_job
        on source_job.id = recovery.source_job_id
       and source_job.listing_id is null
       and source_job.seller_account_key is null
       and source_job.request_fingerprint is null
       and source_job.provider_mutation_started_at is null
       and encode(extensions.digest(source_job.request_payload::text, 'sha256'), 'hex') =
         attestation.source_request_sha256
       and encode(extensions.digest(source_job.response_payload::text, 'sha256'), 'hex') =
         attestation.source_response_sha256
      join sellerpilot_private.product_listings listing
        on listing.id = recovery.listing_id
       and listing.owner_id = recovery.owner_id
       and listing.product_id = recovery.product_id
       and listing.operation_attempt_id = recovery.source_attempt_id
       and listing.channel_key = 'elevenst'
       and listing.remote_id = recovery.remote_id
       and listing.seller_account_key = recovery.seller_account_key
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
      join sellerpilot_private.products product
        on product.id = recovery.product_id
       and product.owner_id = recovery.owner_id
       and product.detail_page_version = recovery.approved_detail_page_version
       and product.detail_page_approved_version = recovery.approved_detail_page_version
       and product.detail_page_image_manifest->>'digest' =
         recovery.approved_manifest_digest
       and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
       and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
      join sellerpilot_private.channel_credentials credential
        on credential.id = recovery.credential_id
       and credential.channel = 'elevenst'
       and credential.environment = verifier.environment
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > clock_timestamp())
       and credential.seller_account_key = recovery.seller_account_key
       and credential.seller_account_key_source = 'credential_incarnation_v1'
       and credential.seller_account_verified_at is not null
       and credential.last_check_status = 'passed'
       and credential.last_checked_at is not null
      join sellerpilot_private.listing_publication_adapter_release adapter
        on adapter.channel = 'elevenst'
       and adapter.adapter_ready
       and adapter.contract_version = 'verified_remote_state_v1'
       and adapter.verified_at is not null
      join sellerpilot_private.listing_publication_rechecker_release rechecker
        on rechecker.singleton
       and rechecker.rechecker_ready
       and rechecker.release_sha = adapter.release_sha
       and rechecker.verified_at is not null
     where verifier.id = p_job_id
       and recovery.status in ('queued', 'running')
       and verifier.status = 'succeeded'
       and verifier.channel = 'elevenst'
       and verifier.operation = 'listing.publication.verify'
       and verifier.attempt_id is null
       and verifier.provider_mutation_started_at is null
       and verifier.write_resource_kind is null
       and verifier.write_resource_key is null
       and verifier.credential_refresh_in_flight is not true
       and verifier.prepared_credential_id is null
       and verifier.credential_refresh_recovery_vault_id is null
       and verifier.request_fingerprint = recovery.expected_fingerprint
       and verifier.request_payload#>>'{arguments,sellerpilotElevenstSnapshotRecovery}' =
         'elevenst_exact_legacy_snapshot_recovery_v1'
       and verifier.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
       and verifier.request_payload#>>'{arguments,sellerpilotSnapshotOnly}' = 'true'
       and verifier.response_payload->>'ok' = 'true'
       and verifier.response_payload->>'channel' = 'elevenst'
       and verifier.response_payload->>'operation' = 'listing.publication.verify'
       and verifier.response_payload->>'remoteId' = recovery.remote_id
       and verifier.response_payload#>>'{remoteState,verified}' = 'true'
       and verifier.response_payload#>>'{remoteState,visibility}' in (
         'live', 'pending_review', 'non_public', 'withdrawn', 'rejected'
       )
       and verifier.response_payload#>>'{remoteState,locale}' = 'ko-KR'
       and verifier.response_payload#>>'{remoteState,fingerprint}' =
         recovery.expected_fingerprint
       and verifier.response_payload#>>'{remoteState,resources,productNo}' =
         recovery.remote_id
       and verifier.response_payload#>>'{remoteState,evidence,snapshotOnly}' = 'true'
       and verifier.response_payload#>>'{remoteState,evidence,approvedContentVerified}' =
         'false'
       and verifier.response_payload#>>'{remoteState,evidence,approvedImageCountVerified}' =
         'false'
       and verifier.response_payload#>>'{remoteState,evidence,publicationReviewCreated}' =
         'false'
       and verifier.response_payload#>>'{remoteState,evidence,legacySourceAttested}' =
         'true'
       and verifier.response_payload#>>'{remoteState,evidence,freshFullProductReadback}' =
         'true'
       and verifier.response_payload#>>'{remoteState,evidence,immutableSourceFieldsVerified}' =
         'true'
       and verifier.response_payload#>>'{remoteState,evidence,sourceJobId}' =
         source_job.id::text
       and verifier.response_payload#>>'{remoteState,evidence,approvedManifestDigest}' =
         recovery.approved_manifest_digest
       and verifier.response_payload#>>'{remoteState,evidence,approvedDetailPageVersion}' =
         recovery.approved_detail_page_version::text
       and verifier.response_payload#>>'{remoteState,evidence,fullProductVerified}' = 'true'
       and verifier.response_payload#>>'{remoteState,evidence,fullProductBytes}' ~
         '^[1-9][0-9]{0,5}$'
       and (verifier.response_payload#>>'{remoteState,evidence,fullProductBytes}')::integer
         <= 128000
       and sellerpilot_private.safe_listing_publication_timestamp(
         verifier.response_payload#>>'{remoteState,verifiedAt}'
       ) >= verifier.started_at
       and sellerpilot_private.safe_listing_publication_timestamp(
         verifier.response_payload#>>'{remoteState,verifiedAt}'
       ) <= clock_timestamp() + interval '5 minutes'
       and exists (
         select 1
           from jsonb_array_elements(
             coalesce(verifier.response_payload->'steps', '[]'::jsonb)
           ) step(value)
          where step.value->>'name' = 'product-publication-reverification'
            and step.value->>'ok' = 'true'
            and coalesce(step.value->>'status', '') ~ '^2[0-9][0-9]$'
            and step.value#>>'{data,accepted}' = 'true'
            and step.value#>>'{data,product,prdNo}' = recovery.remote_id
            and jsonb_typeof(step.value#>'{data,product}') = 'object'
            and octet_length((step.value#>'{data,product}')::text) <= 128000
            and sellerpilot_private.elevenst_legacy_snapshot_immutable_product_matches(
              source_job.request_payload#>'{arguments,product}',
              step.value#>'{data,product}'
            )
       )
       and not exists (
         select 1
           from jsonb_array_elements(
             coalesce(verifier.response_payload->'steps', '[]'::jsonb)
           ) step(value)
          where step.value->>'name' = 'publication-content-verification'
            and step.value->>'ok' = 'true'
       )
       and not exists (
         select 1 from sellerpilot_private.elevenst_listing_snapshots snapshot
          where snapshot.listing_id = recovery.listing_id
       )
       and not exists (
         select 1 from sellerpilot_private.listing_publication_reviews review
          where review.listing_id = recovery.listing_id
       )
       and not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs active_job
          where active_job.listing_id = recovery.listing_id
            and active_job.id <> verifier.id
            and active_job.status in ('queued', 'running', 'reconciliation_required')
            and active_job.operation in (
              'listing.create', 'listing.update', 'listing.stop',
              'listing.publication.verify'
            )
       )
       and sellerpilot_private.serverless_static_egress_allowed('elevenst')
       and adapter.release_sha =
         sellerpilot_private.active_serverless_runtime_release_sha()
  );
$$;

revoke all on function
  sellerpilot_private.elevenst_snapshot_recovery_completion_valid(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.apply_elevenst_snapshot_recovery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovery record;
  v_source record;
  v_remote_product jsonb;
  v_snapshot_product jsonb;
  v_snapshot_inserted boolean := false;
begin
  if new.channel <> 'elevenst'
     or new.operation <> 'listing.publication.verify' then
    return new;
  end if;
  select recovery.* into v_recovery
    from sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
   where recovery.verification_job_id = new.id
   for update;
  if not found then return new; end if;

  if new.status = 'running' then
    update sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
       set status = 'running', safe_error = null,
           updated_at = clock_timestamp()
     where recovery.id = v_recovery.id and recovery.status = 'queued';
    return new;
  end if;
  if new.status not in (
    'succeeded', 'failed', 'reconciliation_required', 'cancelled'
  ) then
    return new;
  end if;
  if new.status <> 'succeeded' then
    update sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
       set status = new.status,
           safe_error = left(coalesce(nullif(trim(new.error_message), ''),
             'read_only_snapshot_observation_did_not_succeed'), 500),
           completed_at = clock_timestamp(), updated_at = clock_timestamp()
     where recovery.id = v_recovery.id;
    return new;
  end if;

  if not sellerpilot_private.elevenst_snapshot_recovery_completion_valid(new.id) then
    update sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
       set status = 'failed',
           safe_error = 'exact_legacy_snapshot_readback_mismatch',
           completed_at = clock_timestamp(), updated_at = clock_timestamp()
     where recovery.id = v_recovery.id;
    return new;
  end if;

  select source_job.* into strict v_source
    from sellerpilot_private.channel_gateway_jobs source_job
   where source_job.id = v_recovery.source_job_id;
  select step.value#>'{data,product}' into strict v_remote_product
    from jsonb_array_elements(new.response_payload->'steps') step(value)
   where step.value->>'name' = 'product-publication-reverification'
     and step.value->>'ok' = 'true';
  v_snapshot_product := v_remote_product
    - 'prdNo'::text - 'selStatCd'::text - 'selStatNm'::text;

  insert into sellerpilot_private.elevenst_listing_snapshots (
    listing_id, credential_id, seller_account_key, remote_id,
    product_payload, source_job_id, source_operation
  ) values (
    v_recovery.listing_id, v_recovery.credential_id,
    v_recovery.seller_account_key, v_recovery.remote_id,
    v_snapshot_product, v_recovery.source_job_id, v_source.operation
  )
  on conflict (listing_id) do nothing
  returning true into v_snapshot_inserted;
  if not coalesce(v_snapshot_inserted, false) then
    update sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
       set status = 'failed', safe_error = 'trusted_snapshot_conflict',
           completed_at = clock_timestamp(), updated_at = clock_timestamp()
     where recovery.id = v_recovery.id;
    return new;
  end if;

  -- Deliberately do not update product_listings and do not insert a
  -- listing_publication_reviews row. A later separately-gated UPDATE must use
  -- this snapshot plus the current approved eight-image build and then prove
  -- the resulting live provider state.
  update sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
     set status = 'succeeded', safe_error = null,
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
   where recovery.id = v_recovery.id;
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_recovery.owner_id,
    'elevenst_legacy_listing_snapshot_observed',
    'product_listing', v_recovery.listing_id::text,
    jsonb_build_object(
      'contract', 'elevenst_exact_legacy_snapshot_recovery_v1',
      'jobId', new.id, 'sourceJobId', v_recovery.source_job_id,
      'remoteId', v_recovery.remote_id,
      'providerStatus', new.response_payload#>>'{remoteState,providerStatus}',
      'visibility', new.response_payload#>>'{remoteState,visibility}',
      'observedImageCount', new.response_payload#>>'{remoteState,imageCount}',
      'readOnly', true, 'snapshotOnly', true,
      'approvedContentVerified', false, 'publicationReviewCreated', false,
      'listingStateChanged', false, 'createAllowed', false,
      'listingMutationAllowed', false
    )
  );
  return new;
exception when no_data_found or too_many_rows then
  update sellerpilot_private.elevenst_listing_snapshot_recoveries recovery
     set status = 'failed', safe_error = 'exact_snapshot_product_unavailable',
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
   where recovery.verification_job_id = new.id;
  return new;
end;
$$;

drop trigger if exists zz_apply_elevenst_snapshot_recovery
  on sellerpilot_private.channel_gateway_jobs;
create trigger zz_apply_elevenst_snapshot_recovery
after insert or update of status, response_payload
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.apply_elevenst_snapshot_recovery();

revoke all on function
  sellerpilot_private.apply_elevenst_snapshot_recovery()
  from public, anon, authenticated, service_role;

comment on table sellerpilot_private.elevenst_exact_legacy_source_attestations is
  'One exact digest-bound 11st legacy create attestation. It cannot attest modern publication content.';
comment on table sellerpilot_private.elevenst_listing_snapshot_recoveries is
  'Read-only exact 11st legacy Product observations. Success creates only a snapshot and never a publication review.';
comment on function
  public.sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery(uuid) is
  'Queues one exact provider-write-free 11st GET for snapshot-only recovery; listing create/update and publication promotion are forbidden.';

commit;
