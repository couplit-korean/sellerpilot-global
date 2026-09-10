-- Recover a Coupang listing.create whose provider mutation started but whose
-- worker process ended before the response was durably recorded. The source
-- job remains immutable and reconciliation_required. A separate GET-only
-- listing.lineage.verify job discovers the exact sellerProductId by every
-- compiled externalVendorSku and stores one receipt bound to the original
-- job, attempt, listing, credential vendor, request digest, and verifier result.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910020500);

create table if not exists sellerpilot_private.coupang_create_reconciliation_receipts (
  source_job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  verifier_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  source_product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  owner_id uuid not null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (length(credential_fingerprint) between 1 and 160),
  credential_vault_secret_id uuid not null,
  credential_seller_account_key_source text not null check (
    length(credential_seller_account_key_source) between 1 and 80
  ),
  seller_account_key text not null,
  source_request_sha256 text not null check (source_request_sha256 ~ '^[a-f0-9]{64}$'),
  verifier_response_sha256 text not null check (verifier_response_sha256 ~ '^[a-f0-9]{64}$'),
  vendor_id text not null check (length(vendor_id) between 1 and 160),
  seller_skus jsonb not null check (
    jsonb_typeof(seller_skus) = 'array'
    and jsonb_array_length(seller_skus) between 1 and 100
  ),
  seller_product_id text not null check (seller_product_id ~ '^[1-9][0-9]{5,19}$'),
  seller_product_item_ids jsonb not null check (
    jsonb_typeof(seller_product_item_ids) = 'array'
    and jsonb_array_length(seller_product_item_ids) between 1 and 100
  ),
  publication_state jsonb check (
    publication_state is null or jsonb_typeof(publication_state) = 'object'
  ),
  internal_completion_recorded boolean not null,
  provider_mutation_performed boolean not null default false check (not provider_mutation_performed),
  verified_at timestamptz not null default clock_timestamp()
);

revoke all on sellerpilot_private.coupang_create_reconciliation_receipts
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.coupang_create_reconciliation_receipt_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Coupang CREATE reconciliation receipts are immutable'
    using errcode = '55000';
end;
$$;

revoke all on function sellerpilot_private.coupang_create_reconciliation_receipt_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists coupang_create_reconciliation_receipt_immutable
  on sellerpilot_private.coupang_create_reconciliation_receipts;
create trigger coupang_create_reconciliation_receipt_immutable
before update or delete on sellerpilot_private.coupang_create_reconciliation_receipts
for each row execute function sellerpilot_private.coupang_create_reconciliation_receipt_immutable();

create or replace function public.sellerpilot_service_enqueue_coupang_create_reconciliation(
  p_source_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_listing sellerpilot_private.product_listings%rowtype;
  source_product sellerpilot_private.products%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  credential_secret jsonb;
  source_arguments jsonb;
  source_sha256 text;
  expected_vendor_id text;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  verifier_id uuid := gen_random_uuid();
  receipt sellerpilot_private.coupang_create_reconciliation_receipts%rowtype;
begin
  if p_source_job_id is null then
    raise exception 'COUPANG_CREATE_RECONCILIATION_SOURCE_REQUIRED';
  end if;

  select job.* into source_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_source_job_id
   for update;
  if not found
     or source_job.channel is distinct from 'coupang'
     or source_job.operation is distinct from 'listing.create'
     or source_job.status is distinct from 'reconciliation_required'
     or source_job.provider_mutation_started_at is null
     or source_job.attempt_id is null
     or source_job.listing_id is null
     or source_job.credential_id is null
     or source_job.seller_account_key is null then
    raise exception 'COUPANG_CREATE_RECONCILIATION_SOURCE_INVALID'
      using errcode = '55000';
  end if;

  select listing.* into source_listing
    from sellerpilot_private.product_listings listing
   where listing.id = source_job.listing_id
     and listing.channel_key = 'coupang'
     and listing.operation_attempt_id = source_job.attempt_id
   for update;
  select attempt.* into source_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = source_job.attempt_id
     and attempt.channel = 'coupang'
     and attempt.operation = 'listing.create'
   for update;
  select product.* into source_product
    from sellerpilot_private.products product
   where product.id = source_listing.product_id
   for share;
  select item.* into credential
    from sellerpilot_private.channel_credentials item
   where item.id = source_job.credential_id
     and item.channel = 'coupang'
     and item.environment = source_job.environment
     and item.seller_account_key is not distinct from source_job.seller_account_key
     and item.version > 0
     and length(item.fingerprint) between 1 and 160
     and item.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     and item.status = 'active'
     and (item.expires_at is null or item.expires_at > clock_timestamp())
   for share;
  if source_listing.id is null
     or source_attempt.id is null
     or source_product.id is null
     or credential.id is null
     or source_attempt.credential_id is distinct from credential.id
     or source_listing.owner_id is distinct from source_attempt.owner_id
     or source_listing.owner_id is distinct from source_product.owner_id
     or source_listing.owner_id is distinct from source_job.created_by then
    raise exception 'COUPANG_CREATE_RECONCILIATION_LINEAGE_INVALID'
      using errcode = '55000';
  end if;

  select decrypted.decrypted_secret::jsonb into credential_secret
    from vault.decrypted_secrets decrypted
   where decrypted.id = credential.vault_secret_id;
  expected_vendor_id := nullif(trim(credential_secret->>'vendor_id'), '');
  source_arguments := source_job.request_payload->'arguments';
  if expected_vendor_id is null
     or jsonb_typeof(source_arguments) <> 'object'
     or octet_length(source_arguments::text) > 120000 then
    raise exception 'COUPANG_CREATE_RECONCILIATION_INPUT_INVALID'
      using errcode = '55000';
  end if;
  source_sha256 := encode(extensions.digest(source_job.request_payload::text, 'sha256'), 'hex');

  select item.* into receipt
    from sellerpilot_private.coupang_create_reconciliation_receipts item
   where item.source_job_id = source_job.id;
  if receipt.source_job_id is not null then
    return jsonb_build_object(
      'status', 'verified',
      'source_job_id', source_job.id,
      'verifier_job_id', receipt.verifier_job_id,
      'listing_id', receipt.listing_id,
      'seller_product_id', receipt.seller_product_id,
      'reused', true
    );
  end if;

  select job.* into verifier
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'coupang'
     and job.operation = 'listing.lineage.verify'
     and job.request_payload->>'sellerpilotLineageVersion' = 'coupang_create_reconciliation_v1'
     and job.request_payload#>>'{arguments,sourceJobId}' = source_job.id::text
   order by job.created_at desc, job.id desc
   limit 1;
  if verifier.id is not null then
    return jsonb_build_object(
      'status', case
        when verifier.status in ('queued', 'running', 'reconciliation_required') then 'queued'
        when verifier.status = 'failed' then 'manual_required'
        else verifier.status
      end,
      'source_job_id', source_job.id,
      'verifier_job_id', verifier.id,
      'listing_id', source_listing.id,
      'reused', true
    );
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, created_by, seller_account_key
  ) values (
    verifier_id, credential.id, null, null, 'coupang', 'listing.lineage.verify',
    source_job.environment,
    jsonb_build_object(
      'sellerpilotLineageVersion', 'coupang_create_reconciliation_v1',
      'arguments', jsonb_build_object(
        'contract', 'coupang_durable_create_reconciliation_v1',
        'sourceJobId', source_job.id,
        'sourceAttemptId', source_attempt.id,
        'listingId', source_listing.id,
        'sourceProductId', source_product.id,
        'sourceRequestSha256', source_sha256,
        'expectedVendorId', expected_vendor_id,
        'expectedCredentialId', credential.id,
        'expectedCredentialVersion', credential.version,
        'expectedCredentialFingerprint', credential.fingerprint,
        'expectedCredentialVaultSecretId', credential.vault_secret_id,
        'expectedCredentialSellerAccountKeySource', credential.seller_account_key_source,
        'sourceArguments', source_arguments
      )
    ),
    'queued', source_job.created_by, source_job.seller_account_key
  );

  return jsonb_build_object(
    'status', 'queued',
    'source_job_id', source_job.id,
    'verifier_job_id', verifier_id,
    'listing_id', source_listing.id,
    'reused', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_coupang_create_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_coupang_create_reconciliation(uuid)
  to service_role;

create or replace function public.sellerpilot_complete_coupang_create_reconciliation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_id uuid;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_listing sellerpilot_private.product_listings%rowtype;
  source_product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  credential_secret jsonb;
  request_arguments jsonb;
  response_skus jsonb;
  response_item_ids jsonb;
  source_sha256 text;
  response_sha256 text;
  verified_remote_id text;
  response_vendor_id text;
  safe_error text;
  duplicate_count integer;
  publication_state jsonb;
  publication_intent text;
  publication_verified_at timestamptz;
  publication_compatible boolean := false;
  internal_completion_recorded boolean := false;
begin
  if p_status not in ('succeeded', 'failed', 'retryable')
     or p_job_id is null
     or p_claim_token is null
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) <> 'object'
       or octet_length(p_response_payload::text) > 1000000
     )) then
    raise exception 'invalid Coupang CREATE reconciliation completion';
  end if;

  select token.id into token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select job.* into verifier
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.channel = 'coupang'
     and job.operation = 'listing.lineage.verify'
     and job.status = 'running'
     and job.worker_token_id = token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotLineageVersion' = 'coupang_create_reconciliation_v1'
   for update;
  if not found then
    return jsonb_build_object('status', 'lease_lost', 'job_id', p_job_id);
  end if;

  request_arguments := verifier.request_payload->'arguments';
  select job.* into source_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = (request_arguments->>'sourceJobId')::uuid
     and job.channel = 'coupang'
     and job.operation = 'listing.create'
     and job.status = 'reconciliation_required'
     and job.provider_mutation_started_at is not null
     and job.attempt_id = (request_arguments->>'sourceAttemptId')::uuid
     and job.listing_id = (request_arguments->>'listingId')::uuid
     and job.credential_id = verifier.credential_id
     and job.credential_id = (request_arguments->>'expectedCredentialId')::uuid
     and job.seller_account_key is not distinct from verifier.seller_account_key
   for update;
  if not found then
    raise exception 'COUPANG_CREATE_RECONCILIATION_SOURCE_DRIFT'
      using errcode = '55000';
  end if;

  source_sha256 := encode(extensions.digest(source_job.request_payload::text, 'sha256'), 'hex');
  if request_arguments->>'contract' <> 'coupang_durable_create_reconciliation_v1'
     or request_arguments->>'sourceRequestSha256' <> source_sha256
     or request_arguments->'sourceArguments' is distinct from source_job.request_payload->'arguments' then
    raise exception 'COUPANG_CREATE_RECONCILIATION_REQUEST_DRIFT'
      using errcode = '55000';
  end if;

  select listing.* into source_listing
    from sellerpilot_private.product_listings listing
   where listing.id = source_job.listing_id
     and listing.channel_key = 'coupang'
     and listing.operation_attempt_id = source_job.attempt_id
     and listing.product_id = (request_arguments->>'sourceProductId')::uuid
     and listing.owner_id = source_job.created_by
   for update;
  select product.* into source_product
    from sellerpilot_private.products product
   where product.id = source_listing.product_id
     and product.owner_id = source_listing.owner_id
   for update;
  if source_listing.id is null or source_product.id is null then
    raise exception 'COUPANG_CREATE_RECONCILIATION_PRODUCT_LINEAGE_DRIFT'
      using errcode = '55000';
  end if;

  if p_status = 'retryable' and verifier.attempt_count < 5 then
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'queued', worker_token_id = null, claim_token = null,
           lease_expires_at = null, error_message = 'provider_readback_retryable',
           updated_at = clock_timestamp()
     where job.id = verifier.id;
    return jsonb_build_object(
      'status', 'queued', 'job_id', verifier.id,
      'source_job_id', source_job.id, 'reused', true
    );
  end if;

  if p_status <> 'succeeded' then
    safe_error := left(coalesce(nullif(trim(p_error_message), ''), 'provider_readback_rejected'), 160);
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed', response_payload = null, error_message = safe_error,
           worker_token_id = null, claim_token = null, lease_expires_at = null,
           completed_at = clock_timestamp(), updated_at = clock_timestamp()
     where job.id = verifier.id;
    return jsonb_build_object(
      'status', 'manual_required', 'job_id', verifier.id,
      'source_job_id', source_job.id, 'reason', safe_error
    );
  end if;

  verified_remote_id := nullif(trim(p_response_payload->>'verifiedRemoteId'), '');
  response_vendor_id := nullif(trim(p_response_payload->>'vendorId'), '');
  response_skus := p_response_payload->'sellerSkus';
  response_item_ids := p_response_payload->'sellerProductItemIds';
  if p_response_payload->>'reconciliationContract' <> 'coupang_durable_create_reconciliation_v1'
     or p_response_payload->>'sourceJobId' <> source_job.id::text
     or p_response_payload->>'sourceAttemptId' <> source_job.attempt_id::text
     or p_response_payload->>'listingId' <> source_job.listing_id::text
     or p_response_payload->>'sourceRequestSha256' <> source_sha256
     or p_response_payload->>'expectedRemoteId' <> verified_remote_id
     or p_response_payload->>'market' <> 'KR'
     or p_response_payload->>'targetId' <> response_vendor_id
     or verified_remote_id !~ '^[1-9][0-9]{5,19}$'
     or jsonb_typeof(response_skus) <> 'array'
     or jsonb_typeof(response_item_ids) <> 'array'
     or jsonb_array_length(response_skus) not between 1 and 100
     or jsonb_array_length(response_skus) <> jsonb_array_length(response_item_ids) then
    raise exception 'COUPANG_CREATE_RECONCILIATION_RESPONSE_INVALID'
      using errcode = '55000';
  end if;

  select count(*) - count(distinct value) into duplicate_count
    from jsonb_array_elements_text(response_skus);
  if duplicate_count <> 0
     or (select count(*) <> count(distinct value)
           from jsonb_array_elements_text(response_item_ids))
     or exists (
       select 1 from jsonb_array_elements_text(response_skus) value
        where length(trim(value)) not between 1 and 160
     )
     or exists (
       select 1 from jsonb_array_elements_text(response_item_ids) value
        where value !~ '^[1-9][0-9]{0,19}$'
     ) then
    raise exception 'COUPANG_CREATE_RECONCILIATION_IDENTITY_INVALID'
      using errcode = '55000';
  end if;

  select item.* into credential
    from sellerpilot_private.channel_credentials item
   where item.id = source_job.credential_id
     and item.channel = 'coupang'
     and item.environment = source_job.environment
     and item.seller_account_key is not distinct from source_job.seller_account_key
     and item.status = 'active'
     and (item.expires_at is null or item.expires_at > clock_timestamp())
     and item.version = (request_arguments->>'expectedCredentialVersion')::integer
     and item.fingerprint = request_arguments->>'expectedCredentialFingerprint'
     and item.vault_secret_id = (request_arguments->>'expectedCredentialVaultSecretId')::uuid
     and item.seller_account_key_source = request_arguments->>'expectedCredentialSellerAccountKeySource'
   for share;
  if not found then
    raise exception 'COUPANG_CREATE_RECONCILIATION_CREDENTIAL_DRIFT'
      using errcode = '55000';
  end if;
  select decrypted.decrypted_secret::jsonb into credential_secret
    from vault.decrypted_secrets decrypted
   where decrypted.id = credential.vault_secret_id;
  if response_vendor_id is null
     or response_vendor_id <> nullif(trim(credential_secret->>'vendor_id'), '')
     or response_vendor_id <> request_arguments->>'expectedVendorId' then
    raise exception 'COUPANG_CREATE_RECONCILIATION_VENDOR_MISMATCH'
      using errcode = '55000';
  end if;

  select listing.* into source_listing
    from sellerpilot_private.product_listings listing
   where listing.id = source_job.listing_id
     and listing.channel_key = 'coupang'
     and listing.operation_attempt_id = source_job.attempt_id
     and listing.product_id = source_product.id
     and listing.owner_id = source_product.owner_id
     and (listing.remote_id is null or listing.remote_id = verified_remote_id)
   for update;
  if not found then
    raise exception 'COUPANG_CREATE_RECONCILIATION_LISTING_DRIFT'
      using errcode = '55000';
  end if;

  publication_state := p_response_payload->'remoteState';
  publication_intent := p_response_payload->>'publicationIntent';
  if (p_response_payload ? 'remoteState')
       <> (p_response_payload ? 'publicationIntent')
     or (p_response_payload ? 'remoteState')
       <> (p_response_payload ? 'publicationFulfilled')
     or (p_response_payload ? 'remoteState')
       <> (p_response_payload ? 'publicationStateContract') then
    raise exception 'COUPANG_CREATE_RECONCILIATION_PARTIAL_PUBLICATION_STATE'
      using errcode = '55000';
  end if;
  if p_response_payload ? 'remoteState' then
    begin
      publication_verified_at := (publication_state->>'verifiedAt')::timestamptz;
    exception when others then
      publication_verified_at := null;
    end;
    publication_compatible :=
      p_response_payload->>'publicationStateContract' = 'verified_remote_state_v1'
      and source_job.request_payload#>>'{arguments,publicationStateContract}' = 'verified_remote_state_v1'
      and publication_intent = source_listing.requested_publication_intent
      and publication_intent = source_job.request_payload#>>'{arguments,publicationIntent}'
      and jsonb_typeof(p_response_payload->'publicationFulfilled') = 'boolean'
      and coalesce((p_response_payload->>'publicationFulfilled')::boolean, false)
      and jsonb_typeof(publication_state) = 'object'
      and jsonb_typeof(publication_state->'verified') = 'boolean'
      and coalesce((publication_state->>'verified')::boolean, false)
      and publication_verified_at is not null
      and publication_verified_at >= source_job.provider_mutation_started_at
      and publication_verified_at <= clock_timestamp() + interval '5 minutes'
      and publication_state->>'locale' = source_job.request_payload#>>'{arguments,publicationExpectedLocale}'
      and publication_state->>'fingerprint' = source_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
      and publication_state->>'fingerprint' = source_job.request_fingerprint
      and (publication_state->>'fingerprint') ~ '^[a-f0-9]{64}$'
      and (publication_state->>'imageCount') ~ '^[0-9]{1,2}$'
      and (publication_state->>'imageCount')::integer
        >= (source_job.request_payload#>>'{arguments,publicationExpectedImageCount}')::integer
      and publication_state#>>'{resources,sellerProductId}' = verified_remote_id
      and publication_state#>>'{evidence,identityVerified}' = 'true'
      and publication_state#>>'{evidence,statusVerified}' = 'true'
      and publication_state#>>'{evidence,localeVerified}' = 'true'
      and publication_state#>>'{evidence,fingerprintVerified}' = 'true'
      and publication_state#>>'{evidence,imageCountVerified}' = 'true'
      and case publication_intent
        when 'live' then publication_state->>'visibility' = 'live'
        when 'safe_test' then publication_state->>'visibility' in ('non_public', 'withdrawn')
        else false
      end;
    if not publication_compatible then
      raise exception 'COUPANG_CREATE_RECONCILIATION_PUBLICATION_STATE_INVALID'
        using errcode = '55000';
    end if;
  end if;
  internal_completion_recorded := publication_compatible;

  response_sha256 := encode(extensions.digest(p_response_payload::text, 'sha256'), 'hex');
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'succeeded', response_payload = p_response_payload,
         error_message = null, worker_token_id = null, claim_token = null,
         lease_expires_at = null, completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = verifier.id;

  insert into sellerpilot_private.coupang_create_reconciliation_receipts (
    source_job_id, verifier_job_id, source_attempt_id, listing_id,
    source_product_id, owner_id, credential_id, credential_version,
    credential_fingerprint, credential_vault_secret_id,
    credential_seller_account_key_source, seller_account_key, source_request_sha256,
    verifier_response_sha256, vendor_id, seller_skus,
    seller_product_id, seller_product_item_ids, publication_state,
    internal_completion_recorded, provider_mutation_performed
  ) values (
    source_job.id, verifier.id, source_job.attempt_id, source_listing.id,
    source_product.id, source_listing.owner_id, credential.id, credential.version,
    credential.fingerprint, credential.vault_secret_id,
    credential.seller_account_key_source, source_job.seller_account_key, source_sha256,
    response_sha256, response_vendor_id, response_skus,
    verified_remote_id, response_item_ids, publication_state,
    internal_completion_recorded, false
  );

  if internal_completion_recorded then
    update sellerpilot_private.product_listings listing
       set remote_id = verified_remote_id,
           status = case when publication_state->>'visibility' = 'live'
             then 'published' else 'paused' end,
           remote_visibility = publication_state->>'visibility',
           provider_status = publication_state->>'providerStatus',
           remote_resources = jsonb_build_object(
             'resources', publication_state->'resources',
             'verification', jsonb_build_object(
               'verifiedAt', publication_state->'verifiedAt',
               'evidence', publication_state->'evidence',
               'locale', publication_state->'locale',
               'fingerprint', publication_state->'fingerprint',
               'imageCount', publication_state->'imageCount'
             )
           ),
           published_at = case when publication_state->>'visibility' = 'live'
             then publication_verified_at else null end,
           last_verified_at = publication_verified_at,
           last_error = null,
           failure_class = null,
           updated_at = clock_timestamp()
     where listing.id = source_listing.id;
    update sellerpilot_private.channel_operation_attempts attempt
       set status = 'succeeded', http_status = 200,
           remote_id = verified_remote_id,
           safe_message = '쿠팡 CREATE 응답 유실을 공식 GET으로 복구하고 원격 상태를 확인했습니다.',
           completed_at = clock_timestamp()
     where attempt.id = source_job.attempt_id
       and attempt.owner_id = source_listing.owner_id
       and attempt.status = 'manual_required';
    if not found then
      raise exception 'COUPANG_CREATE_RECONCILIATION_ATTEMPT_DRIFT'
        using errcode = '55000';
    end if;
    if publication_state->>'visibility' = 'live' then
      update sellerpilot_private.products product
         set status = 'active', updated_at = clock_timestamp()
       where product.id = source_product.id;
    end if;
  else
    update sellerpilot_private.product_listings listing
       set remote_id = verified_remote_id,
           last_verified_at = clock_timestamp(),
           last_error = '쿠팡 CREATE 원격 식별값은 복구했지만 공개 상태 확인이 필요합니다.',
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = source_listing.id;
    update sellerpilot_private.channel_operation_attempts attempt
       set remote_id = coalesce(attempt.remote_id, verified_remote_id)
     where attempt.id = source_job.attempt_id
       and attempt.owner_id = source_listing.owner_id
       and attempt.status = 'manual_required';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    source_listing.owner_id,
    'coupang_create_reconciled_get_only',
    'product_listing',
    source_listing.id::text,
    jsonb_build_object(
      'source_job_id', source_job.id,
      'verifier_job_id', verifier.id,
      'seller_product_id', verified_remote_id,
      'seller_sku_count', jsonb_array_length(response_skus),
      'response_loss_preserved', true,
      'internal_completion_recorded', internal_completion_recorded,
      'remote_visibility', case when internal_completion_recorded
        then publication_state->>'visibility' else 'unknown' end,
      'provider_mutation_performed', false
    )
  );

  return jsonb_build_object(
    'status', 'verified', 'job_id', verifier.id,
    'source_job_id', source_job.id, 'listing_id', source_listing.id,
    'seller_product_id', verified_remote_id,
    'internal_completion_recorded', internal_completion_recorded,
    'reused', false
  );
end;
$$;

revoke all on function public.sellerpilot_complete_coupang_create_reconciliation(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_coupang_create_reconciliation(
  text, uuid, uuid, text, jsonb, text
) to service_role;

-- Add the read-only verifier to the bounded serverless claim allowlist without
-- weakening any existing channel/operation rule.
do $allowlist$
begin
  if to_regprocedure(
       'sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(text,text)'
     ) is null then
    alter function sellerpilot_private.serverless_gateway_job_allowed(text, text)
      rename to serverless_gateway_job_allowed_before_coupang_create_reconciliation;
  end if;
end;
$allowlist$;

create or replace function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    p_channel = 'coupang'
    and p_operation = 'listing.lineage.verify'
  ) or sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(
    p_channel,
    p_operation
  )
$$;

revoke all on function sellerpilot_private.serverless_gateway_job_allowed(text, text)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.reap_coupang_durable_create_reconciliation_leases(
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  retried_count integer := 0;
  failed_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid Coupang reconciliation reap limit';
  end if;
  for item in
    select job.id, job.attempt_count
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'coupang'
       and job.operation = 'listing.lineage.verify'
       and job.status = 'running'
       and job.lease_expires_at <= clock_timestamp()
       and job.provider_mutation_started_at is null
       and job.request_payload->>'sellerpilotLineageVersion'
         = 'coupang_create_reconciliation_v1'
     order by job.lease_expires_at, job.id
     for update skip locked
     limit p_limit
  loop
    if item.attempt_count < 5 then
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'queued', worker_token_id = null, claim_token = null,
             lease_expires_at = null,
             error_message = 'readback_worker_lease_expired',
             updated_at = clock_timestamp()
       where job.id = item.id;
      retried_count := retried_count + 1;
    else
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'failed', worker_token_id = null, claim_token = null,
             lease_expires_at = null,
             error_message = 'readback_attempts_exhausted',
             completed_at = clock_timestamp(), updated_at = clock_timestamp()
       where job.id = item.id;
      failed_count := failed_count + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'retried', retried_count,
    'failed', failed_count,
    'total', retried_count + failed_count
  );
end;
$$;

revoke all on function sellerpilot_private.reap_coupang_durable_create_reconciliation_leases(integer)
  from public, anon, authenticated, service_role;

do $reaper$
begin
  if to_regprocedure(
       'public.sellerpilot_reap_before_coupang_durable_create(integer)'
     ) is null then
    alter function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
      rename to sellerpilot_reap_before_coupang_durable_create;
  end if;
end;
$reaper$;

revoke all on function public.sellerpilot_reap_before_coupang_durable_create(integer)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_reap_stale_channel_gateway_jobs(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  coupang_result jsonb;
  prior_result jsonb;
  coupang_total integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid stale gateway recovery limit';
  end if;
  coupang_result := sellerpilot_private.reap_coupang_durable_create_reconciliation_leases(p_limit);
  coupang_total := coalesce((coupang_result->>'total')::integer, 0);
  if coupang_total < p_limit then
    prior_result := public.sellerpilot_reap_before_coupang_durable_create(
      p_limit - coupang_total
    );
  else
    prior_result := jsonb_build_object(
      'retried', 0, 'failed', 0, 'reconciliationRequired', 0,
      'oauthCompleted', 0, 'total', 0
    );
  end if;
  return prior_result || jsonb_build_object(
    'retried', coalesce((prior_result->>'retried')::integer, 0)
      + coalesce((coupang_result->>'retried')::integer, 0),
    'failed', coalesce((prior_result->>'failed')::integer, 0)
      + coalesce((coupang_result->>'failed')::integer, 0),
    'total', coalesce((prior_result->>'total')::integer, 0) + coupang_total
  );
end;
$$;

revoke all on function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  to service_role;

-- Extend the resolved predicate only for a receipt whose source request and
-- verifier response still match their immutable SHA-256 bindings.
do $resolved$
begin
  if to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved_before_coupang_durable_create(uuid)'
     ) is null then
    alter function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
      rename to listing_mutation_reconciliation_resolved_before_coupang_durable_create;
  end if;
end;
$resolved$;

create or replace function sellerpilot_private.listing_mutation_reconciliation_resolved(
  p_job uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select sellerpilot_private.listing_mutation_reconciliation_resolved_before_coupang_durable_create(p_job)
    or exists (
      select 1
        from sellerpilot_private.coupang_create_reconciliation_receipts receipt
        join sellerpilot_private.channel_gateway_jobs source_job
          on source_job.id = receipt.source_job_id
        join sellerpilot_private.channel_gateway_jobs verifier_job
          on verifier_job.id = receipt.verifier_job_id
        join sellerpilot_private.product_listings listing
          on listing.id = receipt.listing_id
        join sellerpilot_private.products product
          on product.id = receipt.source_product_id
        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id = receipt.source_attempt_id
        join sellerpilot_private.channel_credentials credential
          on credential.id = receipt.credential_id
       where receipt.source_job_id = p_job
         and source_job.channel = 'coupang'
         and source_job.operation = 'listing.create'
         and source_job.status = 'reconciliation_required'
         and source_job.provider_mutation_started_at is not null
         and receipt.provider_mutation_performed = false
         and receipt.owner_id = listing.owner_id
         and receipt.owner_id = product.owner_id
         and receipt.owner_id = attempt.owner_id
         and source_job.created_by = receipt.owner_id
         and source_job.attempt_id = receipt.source_attempt_id
         and source_job.listing_id = receipt.listing_id
         and source_job.credential_id = receipt.credential_id
         and listing.product_id = receipt.source_product_id
         and listing.operation_attempt_id = receipt.source_attempt_id
         and credential.status = 'active'
         and credential.environment = source_job.environment
         and (credential.expires_at is null or credential.expires_at > current_timestamp)
         and credential.version = receipt.credential_version
         and credential.fingerprint = receipt.credential_fingerprint
         and credential.vault_secret_id = receipt.credential_vault_secret_id
         and credential.seller_account_key_source
           = receipt.credential_seller_account_key_source
         and credential.seller_account_key is not distinct from receipt.seller_account_key
         and receipt.source_request_sha256 = encode(
           extensions.digest(source_job.request_payload::text, 'sha256'), 'hex'
         )
         and verifier_job.status = 'succeeded'
         and receipt.verifier_response_sha256 = encode(
           extensions.digest(verifier_job.response_payload::text, 'sha256'), 'hex'
         )
         and listing.remote_id = receipt.seller_product_id
    )
$$;

revoke all on function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

comment on function public.sellerpilot_service_enqueue_coupang_create_reconciliation(uuid) is
  'Queues one GET-only Coupang lineage verifier for an exact reconciliation_required listing.create source job.';
comment on function public.sellerpilot_complete_coupang_create_reconciliation(text,uuid,uuid,text,jsonb,text) is
  'Stores an exact source-job/request/vendor/SKU/sellerProductId-bound Coupang CREATE recovery receipt without a provider write.';

commit;
