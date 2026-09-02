-- Retire one expired, unbound Qoo10 adopted-localization permit and restore
-- the exact already-live listing projection after an HTTP 422 content
-- validation failure. The failed attempt never created a gateway job or a
-- normalized asset reference and therefore never reached Qoo10. This forward
-- migration records that proof without rewriting the failed attempt.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 902090000);

create table if not exists
  sellerpilot_private.qoo10_adopted_content_validation_reconciliations (
    -- This migration is replayed by bounded historical-schema tests that do
    -- not contain the Qoo10 permit subsystem. Exact CHECK constraints plus
    -- the locked reconciliation joins below provide the production lineage;
    -- omitting FKs keeps those historical prefixes a clean no-op.
    attempt_id uuid primary key,
    permit_id uuid not null unique,
    listing_id uuid not null unique,
    product_id uuid not null,
    credential_id uuid not null,
    owner_id uuid not null,
    source_job_id uuid not null,
    source_attempt_id uuid not null,
    ai_job_id uuid not null,
    remote_id text not null,
    release_sha text not null,
    request_fingerprint text not null,
    approved_manifest_digest text not null,
    observation_sha256 text not null,
    prewrite_snapshot_sha256 text not null,
    http_status integer not null,
    gateway_job_count integer not null,
    normalized_asset_ref_count integer not null,
    provider_mutation_started boolean not null,
    provider_call_replayed boolean not null,
    reconciled_at timestamptz not null,
    constraint qoo10_adopted_content_validation_exact_target_check check (
      attempt_id = '089c2075-9a60-4c4e-9b02-d1c39474b618'::uuid
      and permit_id = '2f481a12-23c2-48cd-aea7-6e5f72dac1c7'::uuid
      and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
      and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
      and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
      and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
      and source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
      and source_attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
      and ai_job_id = '334631fe-0095-4ea8-a20a-16971f6ca71a'::uuid
      and remote_id = '1217336970'
    ),
    constraint qoo10_adopted_content_validation_evidence_check check (
      release_sha = 'bb9d4980e18e209d25e988f0e6830e543a554ab1'
      and request_fingerprint =
        '9a830c5a9ce9157a7fa976d949aca11e16026c6b65c2eec263a3041d24c2ead6'
      and approved_manifest_digest =
        '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
      and observation_sha256 =
        'bf50afc32b165c4e69675eeaad4870fd6c82305aaddb4010efc9bd36629690b6'
      and prewrite_snapshot_sha256 =
        '13f0c61d2cfceda134fe5dd1cc0d5c97da14b05616c177a69e394dbeaef1b3fc'
      and http_status = 422
      and gateway_job_count = 0
      and normalized_asset_ref_count = 0
      and not provider_mutation_started
      and not provider_call_replayed
    )
  );

alter table
  sellerpilot_private.qoo10_adopted_content_validation_reconciliations
  enable row level security;
revoke all on table
  sellerpilot_private.qoo10_adopted_content_validation_reconciliations
  from public, anon, authenticated, service_role;

create function
  sellerpilot_private.block_qoo10_adopted_content_validation_reconciliation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'exact Qoo10 adopted content validation reconciliation evidence is immutable'
    using errcode = '55000';
end;
$$;

revoke all on function
  sellerpilot_private.block_qoo10_adopted_content_validation_reconciliation_change()
  from public, anon, authenticated, service_role;

create trigger block_qoo10_adopted_content_validation_reconciliation_change
before update or delete
on sellerpilot_private.qoo10_adopted_content_validation_reconciliations
for each row execute function
  sellerpilot_private.block_qoo10_adopted_content_validation_reconciliation_change();

create function
  sellerpilot_private.qoo10_adopted_content_validation_restore_allowed(
    p_old jsonb,
    p_new jsonb,
    p_attempt_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_failure_message constant text :=
    '채널용 상세페이지 전용 이미지 8장이 모두 생성·검증되지 않아 실제 채널 등록을 차단했습니다. AI 상세 제작을 다시 실행해 주세요.';
begin
  if p_attempt_id is distinct from
       '089c2075-9a60-4c4e-9b02-d1c39474b618'
     or jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object'
  then return false; end if;

  perform 1
    from sellerpilot_private.qoo10_adopted_content_validation_reconciliations
      evidence
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = evidence.attempt_id
    join sellerpilot_private.qoo10_exact_localization_update_permits permit
      on permit.permit_id = evidence.permit_id
    join sellerpilot_private.qoo10_exact_already_live_adoptions receipt
      on receipt.source_job_id = evidence.source_job_id
     and receipt.source_attempt_id = evidence.source_attempt_id
     and receipt.listing_id = evidence.listing_id
     and receipt.product_id = evidence.product_id
     and receipt.credential_id = evidence.credential_id
     and receipt.owner_id = evidence.owner_id
     and receipt.remote_id = evidence.remote_id
    join sellerpilot_private.products product
      on product.id = evidence.product_id
     and product.owner_id = evidence.owner_id
    join sellerpilot_private.channel_gateway_jobs source
     on source.id = evidence.source_job_id
     and source.attempt_id = evidence.source_attempt_id
     and source.listing_id = evidence.listing_id
     and source.credential_id = evidence.credential_id
     and source.created_by =
           '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     and source.channel = 'qoo10'
     and source.operation = 'listing.update'
     and source.status = 'failed'
    join sellerpilot_private.channel_credentials credential
      on credential.id = evidence.credential_id
     and credential.created_by = source.created_by
   where evidence.attempt_id =
           '089c2075-9a60-4c4e-9b02-d1c39474b618'::uuid
     and evidence.permit_id =
           '2f481a12-23c2-48cd-aea7-6e5f72dac1c7'::uuid
     and evidence.listing_id =
           '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and evidence.request_fingerprint = attempt.request_fingerprint
     and evidence.request_fingerprint = permit.request_fingerprint
     and evidence.release_sha = permit.release_sha
     and evidence.approved_manifest_digest =
           product.detail_page_image_manifest->>'digest'
     and evidence.observation_sha256 = receipt.observation_sha256
     and evidence.prewrite_snapshot_sha256 =
           permit.prewrite_snapshot_sha256
     and evidence.http_status = 422
     and evidence.gateway_job_count = 0
     and evidence.normalized_asset_ref_count = 0
     and not evidence.provider_mutation_started
     and not evidence.provider_call_replayed
     and attempt.owner_id = evidence.owner_id
     and attempt.credential_id = evidence.credential_id
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.update'
     and attempt.status = 'failed'
     and attempt.http_status = 422
     and attempt.remote_id is null
     and attempt.safe_message = v_failure_message
     and attempt.gateway_write_required
     and attempt.pre_gateway_retryable
     and permit.listing_id = evidence.listing_id
     and permit.product_id = evidence.product_id
     and permit.credential_id = evidence.credential_id
     and permit.owner_id = evidence.owner_id
     and permit.remote_id = evidence.remote_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.bound_at is null
     and permit.consumed_at is null
     and permit.invalidated_at = evidence.reconciled_at
     and permit.invalidation_reason = 'expired_before_job'
     and receipt.observation_sha256 = evidence.observation_sha256
     and receipt.provider_status = 'S2'
     and receipt.remote_visibility = 'live'
     and receipt.purchase_available
     and not receipt.provider_call_replayed
     and receipt.external_write_count = 0
     and product.ai_job_id = evidence.ai_job_id
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status is distinct from 'archived'
     and product.detail_page_version = 1
     and product.detail_page_approved_version = 1
     and product.detail_page_image_manifest->>'contract' =
           'sellerpilot_detail_image_manifest_v2'
     and jsonb_array_length(
           product.detail_page_image_manifest->'images'
         ) = 8
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.seller_account_key =
           '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     and credential.seller_account_key = source.seller_account_key
     and credential.seller_account_key_source in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
     and credential.seller_account_verified_at is not null
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
     and (
       credential.expires_at is null
       or credential.expires_at > statement_timestamp()
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = evidence.attempt_id
     )
     and not exists (
       select 1
         from sellerpilot_private.marketplace_normalized_asset_refs ref
        where ref.attempt_id = evidence.attempt_id
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = evidence.listing_id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'listing.activate', 'price.update', 'inventory.update'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
     and p_old->>'id' = evidence.listing_id::text
     and p_old->>'owner_id' = evidence.owner_id::text
     and p_old->>'product_id' = evidence.product_id::text
     and p_old->>'channel_key' = 'qoo10'
     and p_old->>'market' = 'JP'
     and p_old->>'target_id' = ''
     and p_old->>'remote_id' = evidence.remote_id
     and p_old->>'operation_attempt_id' = evidence.attempt_id::text
     and p_old->>'status' = 'failed'
     and p_old->>'failure_class' = 'retryable'
     and p_old->>'requested_publication_intent' = 'live'
     and p_old->>'remote_visibility' = 'live'
     and p_old->>'provider_status' = 'S2'
     and p_old->>'currency' = 'JPY'
     and (p_old->>'price')::numeric = 1871
     and p_old->>'seller_account_key' = credential.seller_account_key
     and p_old->>'last_error' = v_failure_message
     and (p_old->>'published_at')::timestamptz = receipt.observed_at
     and (p_old->>'last_verified_at')::timestamptz = receipt.observed_at
     and p_old#>>'{remote_resources,resources,itemCode}' = evidence.remote_id
     and p_old#>>'{remote_resources,verification,evidenceSha256}' =
           evidence.observation_sha256
     and p_new->>'id' = p_old->>'id'
     and p_new->>'operation_attempt_id' = evidence.source_attempt_id::text
     and p_new->>'status' = 'published'
     and p_new->'failure_class' = 'null'::jsonb
     and p_new->'last_error' = 'null'::jsonb
     and (p_new->>'updated_at')::timestamptz = evidence.reconciled_at
     and p_new - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'last_error' - 'updated_at'
       = p_old - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'last_error' - 'updated_at';

  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_adopted_content_validation_restore_allowed(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

do $patch_qoo10_adopted_content_validation_listing_guard$
declare
  v_definition text;
  -- Insert immediately before the already-live Qoo10 branch instead of
  -- assuming that branch is the first statement after BEGIN. Production can
  -- legitimately prepend other exact-channel recovery branches (for example
  -- Coupang) while preserving this Qoo10 anchor unchanged.
  v_before constant text := '  if nullif(current_setting(''sellerpilot.qoo10_already_live_adoption'', true), '''') is not null then';
  v_after constant text := '  if nullif(current_setting(''sellerpilot.qoo10_adopted_content_validation_restore'', true), '''') is not null then
    if not sellerpilot_private.qoo10_adopted_content_validation_restore_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_adopted_content_validation_restore'', true)
    ) then
      raise exception ''invalid exact Qoo10 adopted content validation restore'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_already_live_adoption'', true), '''') is not null then';
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_localization_update_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_already_live_adoptions'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_product_listing_seller_lineage()'
     ) is null
  then return; end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_adopted_content_validation_restore'
     ) > 0 then return; end if;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before) <> 1 then
    -- Historical-prefix migration tests can contain the permit relation but
    -- predate the adopted-live guard branch. They are a no-op unless the one
    -- production permit reconciled by this migration is actually present.
    if not exists (
      select 1
        from sellerpilot_private.qoo10_exact_localization_update_permits permit
       where permit.permit_id =
               '2f481a12-23c2-48cd-aea7-6e5f72dac1c7'::uuid
    ) then return; end if;
    raise exception 'Qoo10 adopted content validation guard preimage drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_qoo10_adopted_content_validation_listing_guard$;

do $reconcile_qoo10_adopted_content_validation$
declare
  v_attempt_id constant uuid :=
    '089c2075-9a60-4c4e-9b02-d1c39474b618'::uuid;
  v_permit_id constant uuid :=
    '2f481a12-23c2-48cd-aea7-6e5f72dac1c7'::uuid;
  v_listing_id constant uuid :=
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_credential_id constant uuid :=
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_source_job_id constant uuid :=
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid;
  v_source_attempt_id constant uuid :=
    '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid;
  v_failure_message constant text :=
    '채널용 상세페이지 전용 이미지 8장이 모두 생성·검증되지 않아 실제 채널 등록을 차단했습니다. AI 상세 제작을 다시 실행해 주세요.';
  v_now timestamptz := clock_timestamp();
  v_present_rows integer;
  v_changed_rows integer;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_localization_update_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_already_live_adoptions'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.marketplace_normalized_asset_refs'
     ) is null
  then return; end if;
  select
    (select count(*) from sellerpilot_private.channel_operation_attempts
      where id = v_attempt_id)
    + (select count(*)
         from sellerpilot_private.qoo10_exact_localization_update_permits
        where permit_id = v_permit_id)
    + (select count(*) from sellerpilot_private.product_listings
      where id = v_listing_id)
    into v_present_rows;
  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 3 then
    raise exception 'QOO10_ADOPTED_CONTENT_VALIDATION_EVIDENCE_INCOMPLETE'
      using errcode = '55000';
  end if;

  perform 1
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = attempt.credential_id
    join sellerpilot_private.channel_gateway_jobs source
     on source.id = v_source_job_id
     and source.attempt_id = v_source_attempt_id
     and source.listing_id = listing.id
     and source.credential_id = credential.id
     and source.created_by =
           '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     and source.channel = 'qoo10'
     and source.operation = 'listing.update'
     and source.status = 'failed'
    join sellerpilot_private.qoo10_exact_localization_update_permits permit
      on permit.permit_id = v_permit_id
    join sellerpilot_private.qoo10_exact_already_live_adoptions receipt
      on receipt.source_job_id = v_source_job_id
     and receipt.source_attempt_id = v_source_attempt_id
     and receipt.listing_id = listing.id
     and receipt.product_id = product.id
     and receipt.credential_id = credential.id
   where listing.id = v_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'qoo10'
     and listing.market = 'JP'
     and listing.target_id = ''
     and listing.remote_id = '1217336970'
     and listing.operation_attempt_id = v_attempt_id
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'live'
     and listing.provider_status = 'S2'
     and listing.currency = 'JPY'
     and listing.price = 1871
     and listing.last_error = v_failure_message
     and listing.published_at = receipt.observed_at
     and listing.last_verified_at = receipt.observed_at
     and listing.seller_account_key =
           '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     and listing.remote_resources#>>'{resources,itemCode}' = '1217336970'
     and listing.remote_resources#>>'{verification,evidenceSha256}' =
           receipt.observation_sha256
     and product.ai_job_id =
           '334631fe-0095-4ea8-a20a-16971f6ca71a'::uuid
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status is distinct from 'archived'
     and product.detail_page_version = 1
     and product.detail_page_approved_version = 1
     and product.detail_page_image_manifest->>'contract' =
           'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'algorithm' = 'sha256'
     and product.detail_page_image_manifest->>'digest' =
           '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
     and jsonb_array_length(
           product.detail_page_image_manifest->'images'
         ) = 8
     and attempt.id = v_attempt_id
     and attempt.owner_id = v_owner_id
     and attempt.credential_id = v_credential_id
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.update'
     and attempt.idempotency_key =
           'qoo10-adopted-localization:1217336970:bb9d4980e18e209d25e988f0e6830e543a554ab1'
     and attempt.request_fingerprint =
           '9a830c5a9ce9157a7fa976d949aca11e16026c6b65c2eec263a3041d24c2ead6'
     and attempt.status = 'failed'
     and attempt.http_status = 422
     and attempt.remote_id is null
     and attempt.safe_message = v_failure_message
     and attempt.gateway_write_required
     and attempt.pre_gateway_retryable
     and permit.listing_id = v_listing_id
     and permit.product_id = v_product_id
     and permit.credential_id = v_credential_id
     and permit.owner_id = v_owner_id
     and permit.remote_id = '1217336970'
     and permit.release_sha =
           'bb9d4980e18e209d25e988f0e6830e543a554ab1'
     and permit.request_fingerprint = attempt.request_fingerprint
     and permit.lineage_contract = 'qoo10_exact_already_live_adoption_v1'
     and permit.adoption_source_job_id = v_source_job_id
     and permit.adoption_observation_sha256 = receipt.observation_sha256
     and permit.prewrite_snapshot_sha256 =
           '13f0c61d2cfceda134fe5dd1cc0d5c97da14b05616c177a69e394dbeaef1b3fc'
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.arguments_sha256 is null
     and permit.arguments_bytes is null
     and permit.request_payload_sha256 is null
     and permit.request_payload_bytes is null
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp()
     and credential.created_by = source.created_by
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.seller_account_key = listing.seller_account_key
     and credential.seller_account_key = source.seller_account_key
     and credential.seller_account_key_source in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
     and credential.seller_account_verified_at is not null
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
     and (
       credential.expires_at is null
       or credential.expires_at > statement_timestamp()
     )
     and receipt.owner_id = v_owner_id
     and receipt.remote_id = '1217336970'
     and receipt.observation_sha256 =
           'bf50afc32b165c4e69675eeaad4870fd6c82305aaddb4010efc9bd36629690b6'
     and receipt.provider_status = 'S2'
     and receipt.remote_visibility = 'live'
     and receipt.purchase_available
     and not receipt.provider_call_replayed
     and receipt.external_write_count = 0
     and not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
     )
     and not exists (
       select 1 from sellerpilot_private.marketplace_normalized_asset_refs ref
        where ref.attempt_id = v_attempt_id
     )
     and not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = v_listing_id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'listing.activate', 'price.update', 'inventory.update'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   for update of listing, product, attempt, credential, permit, receipt;
  if not found then
    raise exception 'QOO10_ADOPTED_CONTENT_VALIDATION_PREIMAGE_MISMATCH'
      using errcode = '55000';
  end if;

  update sellerpilot_private.qoo10_exact_localization_update_permits permit
     set invalidated_at = v_now,
         invalidation_reason = 'expired_before_job'
   where permit.permit_id = v_permit_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.bound_at is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at <= statement_timestamp();
  get diagnostics v_changed_rows = row_count;
  if v_changed_rows <> 1 then
    raise exception 'QOO10_ADOPTED_CONTENT_VALIDATION_PERMIT_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  insert into
    sellerpilot_private.qoo10_adopted_content_validation_reconciliations (
      attempt_id, permit_id, listing_id, product_id, credential_id, owner_id,
      source_job_id, source_attempt_id, ai_job_id, remote_id, release_sha,
      request_fingerprint, approved_manifest_digest, observation_sha256,
      prewrite_snapshot_sha256, http_status, gateway_job_count,
      normalized_asset_ref_count, provider_mutation_started,
      provider_call_replayed, reconciled_at
    ) values (
      v_attempt_id, v_permit_id, v_listing_id, v_product_id,
      v_credential_id, v_owner_id, v_source_job_id, v_source_attempt_id,
      '334631fe-0095-4ea8-a20a-16971f6ca71a'::uuid,
      '1217336970',
      'bb9d4980e18e209d25e988f0e6830e543a554ab1',
      '9a830c5a9ce9157a7fa976d949aca11e16026c6b65c2eec263a3041d24c2ead6',
      '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62',
      'bf50afc32b165c4e69675eeaad4870fd6c82305aaddb4010efc9bd36629690b6',
      '13f0c61d2cfceda134fe5dd1cc0d5c97da14b05616c177a69e394dbeaef1b3fc',
      422, 0, 0, false, false, v_now
    );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_adopted_content_validation_restore',
    v_attempt_id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set operation_attempt_id = v_source_attempt_id,
         status = 'published',
         failure_class = null,
         last_error = null,
         updated_at = v_now
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.last_error = v_failure_message;
  get diagnostics v_changed_rows = row_count;
  if v_changed_rows <> 1 then
    raise exception 'QOO10_ADOPTED_CONTENT_VALIDATION_LISTING_RESTORE_FAILED'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner_id,
    'qoo10_adopted_content_validation_reconciled',
    'channel_operation_attempt',
    v_attempt_id::text,
    jsonb_build_object(
      'contract', 'qoo10_adopted_content_validation_reconciliation_v1',
      'attemptId', v_attempt_id,
      'permitId', v_permit_id,
      'listingId', v_listing_id,
      'sourceAttemptId', v_source_attempt_id,
      'remoteId', '1217336970',
      'httpStatus', 422,
      'gatewayJobCount', 0,
      'normalizedAssetRefCount', 0,
      'providerMutationStarted', false,
      'providerCallReplayed', false,
      'failedAttemptPreserved', true,
      'providerRequestCreated', false,
      'reconciledAt', v_now
    )
  );
end;
$reconcile_qoo10_adopted_content_validation$;

do $qoo10_adopted_content_validation_postimage$
declare
  v_definition text;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_localization_update_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_already_live_adoptions'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_product_listing_seller_lineage()'
     ) is null
  then return; end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_adopted_content_validation_restore'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.qoo10_adopted_content_validation_restore_allowed('
     ) = 0
  then
    if not exists (
      select 1
        from sellerpilot_private.qoo10_adopted_content_validation_reconciliations
       where attempt_id =
               '089c2075-9a60-4c4e-9b02-d1c39474b618'::uuid
    ) then return; end if;
    raise exception 'Qoo10 adopted content validation guard postimage mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.qoo10_adopted_content_validation_reconciliations
     where attempt_id =
             '089c2075-9a60-4c4e-9b02-d1c39474b618'::uuid
  ) and not exists (
    select 1
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.qoo10_exact_already_live_adoptions receipt
        on receipt.listing_id = listing.id
     where listing.id =
             '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and listing.operation_attempt_id = receipt.source_attempt_id
       and listing.status = 'published'
       and listing.failure_class is null
       and listing.last_error is null
       and listing.remote_id = '1217336970'
       and listing.remote_visibility = 'live'
       and listing.provider_status = 'S2'
       and listing.requested_publication_intent = 'live'
       and listing.currency = 'JPY'
       and listing.price = 1871
  ) then
    raise exception 'Qoo10 adopted content validation restore postimage mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_adopted_content_validation_postimage$;

commit;
