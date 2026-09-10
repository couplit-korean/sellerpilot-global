-- Complete the durable Coupang CREATE response-loss chain. This revision
-- binds reconciliation to the mutation-time official snapshot, exact seller
-- SKUs, Vault secret digest and explicit SKU/item pairs, and queues recovery
-- automatically when the source mutation becomes uncertain.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910042000);

do $$
begin
  if to_regclass('sellerpilot_private.coupang_create_official_source_snapshots') is null then
    raise exception 'COUPANG_CREATE_RECONCILIATION_R9_PREIMAGE_REQUIRED';
  end if;
end $$;

alter table sellerpilot_private.coupang_create_reconciliation_receipts
  add column if not exists credential_secret_sha256 text,
  add column if not exists official_source_snapshot_id uuid,
  add column if not exists official_source_snapshot_digest_sha256 text,
  add column if not exists transmission_id uuid,
  add column if not exists transmission_digest_sha256 text,
  add column if not exists provider_body_seal_id uuid,
  add column if not exists provider_body_sha256 text,
  add column if not exists item_bindings jsonb;

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
  official_snapshot sellerpilot_private.coupang_create_official_source_snapshots%rowtype;
  transmission sellerpilot_private.coupang_create_transmissions%rowtype;
  provider_seal sellerpilot_private.coupang_create_provider_body_seals%rowtype;
  credential_secret jsonb;
  current_credential_secret_sha256 text;
  source_arguments jsonb;
  source_binding jsonb;
  expected_seller_skus jsonb;
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
  source_binding := source_arguments->'sellerpilotCoupangCreateTransmission';
  if expected_vendor_id is null
     or jsonb_typeof(source_arguments) <> 'object'
     or jsonb_typeof(source_binding) <> 'object'
     or coalesce(source_binding->>'transmissionId', '')
          !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
     or coalesce(source_binding->>'transmissionDigestSha256', '') !~ '^[a-f0-9]{64}$'
     or octet_length(source_arguments::text) > 120000 then
    raise exception 'COUPANG_CREATE_RECONCILIATION_INPUT_INVALID'
      using errcode = '55000';
  end if;
  select row.* into transmission
    from sellerpilot_private.coupang_create_transmissions row
   where row.id = (source_binding->>'transmissionId')::uuid
     and row.attempt_id = source_job.attempt_id
     and row.credential_id = credential.id
     and row.owner_id = source_job.created_by
     and row.product_id = source_product.id
     and row.transmission_digest_sha256 = source_binding->>'transmissionDigestSha256'
     and row.transmission_body_sha256 = source_binding->>'transmissionBodySha256'
     and row.transmission_body is not distinct from source_arguments->'body'
   for key share;
  if not found then
    raise exception 'COUPANG_CREATE_RECONCILIATION_TRANSMISSION_DRIFT'
      using errcode = '55000';
  end if;
  select snapshot.* into official_snapshot
    from sellerpilot_private.coupang_create_official_source_snapshots snapshot
   where snapshot.id = transmission.source_snapshot_id
     and snapshot.snapshot_digest_sha256 = transmission.source_snapshot_digest_sha256
     and snapshot.owner_id = source_job.created_by
     and snapshot.product_id = source_product.id
     and snapshot.credential_id = credential.id
     and snapshot.environment = source_job.environment
     and snapshot.credential_vault_secret_id = credential.vault_secret_id
   for key share;
  if not found
     or official_snapshot.credential_secret_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'COUPANG_CREATE_RECONCILIATION_OFFICIAL_SNAPSHOT_DRIFT'
      using errcode = '55000';
  end if;
  current_credential_secret_sha256 :=
    sellerpilot_private.coupang_create_official_sha256(credential_secret);
  if current_credential_secret_sha256 is distinct from official_snapshot.credential_secret_sha256 then
    raise exception 'COUPANG_CREATE_RECONCILIATION_CREDENTIAL_SECRET_DRIFT'
      using errcode = '55000';
  end if;
  select seal.* into provider_seal
    from sellerpilot_private.coupang_create_provider_body_seals seal
   where seal.job_id = source_job.id
     and seal.transmission_id = transmission.id
     and seal.source_snapshot_id = official_snapshot.id
     and seal.listing_id = source_listing.id
     and seal.attempt_id = source_attempt.id
     and seal.credential_id = credential.id
     and seal.credential_vault_secret_id = credential.vault_secret_id
     and seal.credential_secret_sha256 = current_credential_secret_sha256
     and seal.provider_body_sha256 =
       sellerpilot_private.coupang_create_official_sha256(seal.provider_body)
   for key share;
  if not found then
    raise exception 'COUPANG_CREATE_RECONCILIATION_PROVIDER_BODY_SEAL_DRIFT'
      using errcode = '55000';
  end if;
  select jsonb_agg(to_jsonb(trim(item.value->>'externalVendorSku')) order by item.ordinality)
    into expected_seller_skus
    from jsonb_array_elements(provider_seal.provider_body->'items') with ordinality item(value, ordinality);
  if jsonb_typeof(expected_seller_skus) <> 'array'
     or jsonb_array_length(expected_seller_skus) not between 1 and 100
     or exists (
       select 1 from jsonb_array_elements_text(expected_seller_skus) sku(value)
        where length(trim(sku.value)) not between 1 and 160
     )
     or (select count(*) <> count(distinct value)
           from jsonb_array_elements_text(expected_seller_skus)) then
    raise exception 'COUPANG_CREATE_RECONCILIATION_SOURCE_SKU_INVALID'
      using errcode = '55000';
  end if;
  source_sha256 := encode(extensions.digest(source_job.request_payload::text, 'sha256'), 'hex');

  select item.* into receipt
    from sellerpilot_private.coupang_create_reconciliation_receipts item
   where item.source_job_id = source_job.id;
  if receipt.source_job_id is not null
     and receipt.internal_completion_recorded
     and receipt.credential_secret_sha256 = current_credential_secret_sha256
     and receipt.official_source_snapshot_id = official_snapshot.id
     and receipt.official_source_snapshot_digest_sha256 = official_snapshot.snapshot_digest_sha256
     and receipt.transmission_id = transmission.id
     and receipt.transmission_digest_sha256 = transmission.transmission_digest_sha256
     and receipt.provider_body_seal_id = provider_seal.id
     and receipt.provider_body_sha256 = provider_seal.provider_body_sha256 then
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
     and job.request_payload#>>'{arguments,expectedCredentialSecretSha256}' = current_credential_secret_sha256
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
        'expectedCredentialSecretSha256', current_credential_secret_sha256,
        'expectedCredentialSellerAccountKeySource', credential.seller_account_key_source,
        'expectedOfficialSourceSnapshotId', official_snapshot.id,
        'expectedOfficialSourceSnapshotDigestSha256', official_snapshot.snapshot_digest_sha256,
        'expectedTransmissionId', transmission.id,
        'expectedTransmissionDigestSha256', transmission.transmission_digest_sha256,
        'expectedProviderBodySealId', provider_seal.id,
        'expectedProviderBodySha256', provider_seal.provider_body_sha256,
        'expectedSellerSkus', expected_seller_skus,
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
  official_snapshot sellerpilot_private.coupang_create_official_source_snapshots%rowtype;
  transmission sellerpilot_private.coupang_create_transmissions%rowtype;
  provider_seal sellerpilot_private.coupang_create_provider_body_seals%rowtype;
  credential_secret jsonb;
  current_credential_secret_sha256 text;
  request_arguments jsonb;
  response_skus jsonb;
  response_item_ids jsonb;
  response_item_bindings jsonb;
  expected_item_bindings jsonb;
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
  response_item_bindings := p_response_payload->'itemBindings';
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
     or jsonb_typeof(response_item_bindings) <> 'array'
     or jsonb_array_length(response_skus) not between 1 and 100
     or jsonb_array_length(response_skus) <> jsonb_array_length(response_item_ids)
     or jsonb_array_length(response_skus) <> jsonb_array_length(response_item_bindings)
     or response_skus is distinct from request_arguments->'expectedSellerSkus' then
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
     )
     or exists (
       select 1 from jsonb_array_elements(response_item_bindings) binding
        where jsonb_typeof(binding) <> 'object'
          or (select count(*) from jsonb_object_keys(binding)) <> 2
          or not (binding ?& array['sellerSku','sellerProductItemId'])
          or length(trim(binding->>'sellerSku')) not between 1 and 160
          or coalesce(binding->>'sellerProductItemId', '') !~ '^[1-9][0-9]{0,19}$'
     ) then
    raise exception 'COUPANG_CREATE_RECONCILIATION_IDENTITY_INVALID'
      using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object(
           'sellerSku', sku.value,
           'sellerProductItemId', item_id.value
         ) order by sku.ordinality)
    into expected_item_bindings
    from jsonb_array_elements_text(response_skus) with ordinality sku(value, ordinality)
    join jsonb_array_elements_text(response_item_ids) with ordinality item_id(value, ordinality)
      using (ordinality);
  if response_item_bindings is distinct from expected_item_bindings then
    raise exception 'COUPANG_CREATE_RECONCILIATION_ITEM_BINDING_INVALID'
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
  current_credential_secret_sha256 :=
    sellerpilot_private.coupang_create_official_sha256(credential_secret);
  select snapshot.* into official_snapshot
    from sellerpilot_private.coupang_create_official_source_snapshots snapshot
   where snapshot.id = (request_arguments->>'expectedOfficialSourceSnapshotId')::uuid
     and snapshot.snapshot_digest_sha256 = request_arguments->>'expectedOfficialSourceSnapshotDigestSha256'
     and snapshot.owner_id = source_job.created_by
     and snapshot.product_id = source_product.id
     and snapshot.credential_id = credential.id
     and snapshot.environment = source_job.environment
     and snapshot.credential_vault_secret_id = credential.vault_secret_id
     and snapshot.credential_secret_sha256 = request_arguments->>'expectedCredentialSecretSha256'
   for key share;
  if not found
     or current_credential_secret_sha256 is distinct from request_arguments->>'expectedCredentialSecretSha256'
     or current_credential_secret_sha256 is distinct from official_snapshot.credential_secret_sha256 then
    raise exception 'COUPANG_CREATE_RECONCILIATION_CREDENTIAL_SECRET_DRIFT'
      using errcode = '55000';
  end if;
  select row.* into transmission
    from sellerpilot_private.coupang_create_transmissions row
   where row.id = (request_arguments->>'expectedTransmissionId')::uuid
     and row.source_snapshot_id = official_snapshot.id
     and row.source_snapshot_digest_sha256 = official_snapshot.snapshot_digest_sha256
     and row.owner_id = source_job.created_by
     and row.product_id = source_product.id
     and row.credential_id = credential.id
     and row.attempt_id = source_job.attempt_id
     and row.transmission_digest_sha256 = request_arguments->>'expectedTransmissionDigestSha256'
     and row.transmission_body is not distinct from source_job.request_payload#>'{arguments,body}'
   for key share;
  select seal.* into provider_seal
    from sellerpilot_private.coupang_create_provider_body_seals seal
   where seal.id = (request_arguments->>'expectedProviderBodySealId')::uuid
     and seal.job_id = source_job.id
     and seal.transmission_id = transmission.id
     and seal.source_snapshot_id = official_snapshot.id
     and seal.listing_id = source_listing.id
     and seal.attempt_id = source_job.attempt_id
     and seal.credential_id = credential.id
     and seal.credential_vault_secret_id = credential.vault_secret_id
     and seal.credential_secret_sha256 = current_credential_secret_sha256
     and seal.provider_body_sha256 = request_arguments->>'expectedProviderBodySha256'
     and seal.provider_body_sha256 =
       sellerpilot_private.coupang_create_official_sha256(seal.provider_body)
   for key share;
  if transmission.id is null or provider_seal.id is null then
    raise exception 'COUPANG_CREATE_RECONCILIATION_PROVIDER_BODY_SEAL_DRIFT'
      using errcode = '55000';
  end if;
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
  if source_job.request_payload#>>'{arguments,publicationStateContract}' = 'verified_remote_state_v1'
     and not (p_response_payload ? 'remoteState') then
    if verifier.attempt_count < 5 then
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'queued', response_payload = null,
             error_message = 'provider_publication_readback_unverified',
             worker_token_id = null, claim_token = null, lease_expires_at = null,
             updated_at = clock_timestamp()
       where job.id = verifier.id;
      return jsonb_build_object(
        'status', 'queued', 'job_id', verifier.id,
        'source_job_id', source_job.id, 'reused', true
      );
    end if;
    raise exception 'COUPANG_CREATE_RECONCILIATION_PUBLICATION_UNVERIFIED_EXHAUSTED'
      using errcode = '55000';
  end if;
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
    if p_response_payload->>'publicationFulfilled' = 'false'
       and publication_state->>'visibility' = 'pending_review' then
      if verifier.attempt_count < 5 then
        update sellerpilot_private.channel_gateway_jobs job
           set status = 'queued', response_payload = null,
               error_message = 'provider_publication_pending',
               worker_token_id = null, claim_token = null, lease_expires_at = null,
               updated_at = clock_timestamp()
         where job.id = verifier.id;
        return jsonb_build_object(
          'status', 'queued', 'job_id', verifier.id,
          'source_job_id', source_job.id, 'reused', true
        );
      end if;
      raise exception 'COUPANG_CREATE_RECONCILIATION_PUBLICATION_PENDING_EXHAUSTED'
        using errcode = '55000';
    end if;
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
    credential_fingerprint, credential_vault_secret_id, credential_secret_sha256,
    official_source_snapshot_id, official_source_snapshot_digest_sha256,
    transmission_id, transmission_digest_sha256,
    provider_body_seal_id, provider_body_sha256,
    credential_seller_account_key_source, seller_account_key, source_request_sha256,
    verifier_response_sha256, vendor_id, seller_skus,
    seller_product_id, seller_product_item_ids, item_bindings, publication_state,
    internal_completion_recorded, provider_mutation_performed
  ) values (
    source_job.id, verifier.id, source_job.attempt_id, source_listing.id,
    source_product.id, source_listing.owner_id, credential.id, credential.version,
    credential.fingerprint, credential.vault_secret_id, current_credential_secret_sha256,
    official_snapshot.id, official_snapshot.snapshot_digest_sha256,
    transmission.id, transmission.transmission_digest_sha256,
    provider_seal.id, provider_seal.provider_body_sha256,
    credential.seller_account_key_source, source_job.seller_account_key, source_sha256,
    response_sha256, response_vendor_id, response_skus,
    verified_remote_id, response_item_ids, response_item_bindings, publication_state,
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


create or replace function sellerpilot_private.enqueue_coupang_create_reconciliation_after_uncertain_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'coupang'
     and new.operation = 'listing.create'
     and new.status = 'reconciliation_required'
     and new.provider_mutation_started_at is not null
     and (tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.provider_mutation_started_at is null) then
    perform public.sellerpilot_service_enqueue_coupang_create_reconciliation(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists channel_gateway_jobs_coupang_create_reconciliation_enqueue
  on sellerpilot_private.channel_gateway_jobs;
create trigger channel_gateway_jobs_coupang_create_reconciliation_enqueue
after insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.enqueue_coupang_create_reconciliation_after_uncertain_mutation();

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
        join vault.decrypted_secrets credential_secret
          on credential_secret.id = credential.vault_secret_id
        join sellerpilot_private.coupang_create_official_source_snapshots official_snapshot
          on official_snapshot.id = receipt.official_source_snapshot_id
        join sellerpilot_private.coupang_create_transmissions transmission
          on transmission.id = receipt.transmission_id
        join sellerpilot_private.coupang_create_provider_body_seals provider_seal
          on provider_seal.id = receipt.provider_body_seal_id
       where receipt.source_job_id = p_job
         and source_job.channel = 'coupang'
         and source_job.operation = 'listing.create'
         and source_job.status = 'reconciliation_required'
         and source_job.provider_mutation_started_at is not null
         and receipt.provider_mutation_performed = false
         and receipt.internal_completion_recorded
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
         and receipt.credential_secret_sha256 =
           sellerpilot_private.coupang_create_official_sha256(
             credential_secret.decrypted_secret::jsonb
           )
         and official_snapshot.snapshot_digest_sha256 =
           receipt.official_source_snapshot_digest_sha256
         and official_snapshot.credential_secret_sha256 = receipt.credential_secret_sha256
         and official_snapshot.credential_vault_secret_id = receipt.credential_vault_secret_id
         and transmission.source_snapshot_id = official_snapshot.id
         and transmission.source_snapshot_digest_sha256 = official_snapshot.snapshot_digest_sha256
         and transmission.transmission_digest_sha256 = receipt.transmission_digest_sha256
         and transmission.transmission_body is not distinct from
           source_job.request_payload#>'{arguments,body}'
         and provider_seal.job_id = source_job.id
         and provider_seal.transmission_id = transmission.id
         and provider_seal.source_snapshot_id = official_snapshot.id
         and provider_seal.listing_id = listing.id
         and provider_seal.attempt_id = attempt.id
         and provider_seal.credential_id = credential.id
         and provider_seal.credential_vault_secret_id = receipt.credential_vault_secret_id
         and provider_seal.credential_secret_sha256 = receipt.credential_secret_sha256
         and provider_seal.provider_body_sha256 = receipt.provider_body_sha256
         and provider_seal.provider_body_sha256 =
           sellerpilot_private.coupang_create_official_sha256(provider_seal.provider_body)
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
         and listing.status in ('published', 'paused')
         and listing.failure_class is null
         and attempt.status = 'succeeded'
         and attempt.remote_id = receipt.seller_product_id
    )
$$;


revoke all on function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.enqueue_coupang_create_reconciliation_after_uncertain_mutation()
  from public, anon, authenticated, service_role;

commit;
