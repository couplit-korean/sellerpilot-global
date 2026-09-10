-- Hold Coupang CREATE reconciliation retries until a durable eligibility time.
-- Apply only after 20260910041500 and 20260910042000. This migration number is
-- proposed/reserved locally and must not be deployed until central reservation is confirmed.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 910042500);

do $migration$
begin
  if pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or not exists (
       select 1 from pg_catalog.pg_attribute
        where attrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
          and attname = 'rate_not_before' and not attisdropped
     ) then
    raise exception 'COUPANG_CREATE_RECONCILIATION_BACKOFF_DEPENDENCY_MISSING';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure
     ), 'rate_not_before') = 0 then
    raise exception 'COUPANG_CREATE_RECONCILIATION_CLAIM_ELIGIBILITY_MISSING';
  end if;
end
$migration$;

create or replace function sellerpilot_private.coupang_create_reconciliation_backoff_seconds(
  p_attempt_count integer,
  p_provider_retry_after_seconds integer default null
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_provider_retry_after_seconds is not null
      then greatest(60, least(p_provider_retry_after_seconds, 3600))
    else least(
      900,
      60 * (2 ^ greatest(0, least(coalesce(p_attempt_count, 1), 5) - 1))::integer
    )
  end
$$;

revoke all on function sellerpilot_private.coupang_create_reconciliation_backoff_seconds(integer,integer)
  from public, anon, authenticated, service_role;

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
  provider_retry_after_seconds integer;
  retry_after_seconds integer;
  next_eligible_at timestamptz;
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

  begin
    provider_retry_after_seconds := (p_response_payload->>'retryAfterSeconds')::integer;
  exception when others then
    provider_retry_after_seconds := null;
  end;

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
    retry_after_seconds := sellerpilot_private.coupang_create_reconciliation_backoff_seconds(
      verifier.attempt_count, provider_retry_after_seconds
    );
    next_eligible_at := clock_timestamp() + retry_after_seconds * interval '1 second';
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'queued', worker_token_id = null, claim_token = null,
           lease_expires_at = null, error_message = 'provider_readback_retryable',
           rate_not_before = next_eligible_at, updated_at = clock_timestamp()
     where job.id = verifier.id;
    return jsonb_build_object(
      'status', 'queued', 'job_id', verifier.id,
      'source_job_id', source_job.id, 'reused', true,
      'retry_after_seconds', retry_after_seconds,
      'next_eligible_at', next_eligible_at
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
      retry_after_seconds := sellerpilot_private.coupang_create_reconciliation_backoff_seconds(
        verifier.attempt_count, provider_retry_after_seconds
      );
      next_eligible_at := clock_timestamp() + retry_after_seconds * interval '1 second';
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'queued', response_payload = null,
             error_message = 'provider_publication_readback_unverified',
             worker_token_id = null, claim_token = null, lease_expires_at = null,
             rate_not_before = next_eligible_at, updated_at = clock_timestamp()
       where job.id = verifier.id;
      return jsonb_build_object(
        'status', 'queued', 'job_id', verifier.id,
        'source_job_id', source_job.id, 'reused', true,
        'retry_after_seconds', retry_after_seconds,
        'next_eligible_at', next_eligible_at
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
        retry_after_seconds := sellerpilot_private.coupang_create_reconciliation_backoff_seconds(
          verifier.attempt_count, provider_retry_after_seconds
        );
        next_eligible_at := clock_timestamp() + retry_after_seconds * interval '1 second';
        update sellerpilot_private.channel_gateway_jobs job
           set status = 'queued', response_payload = null,
               error_message = 'provider_publication_pending',
               worker_token_id = null, claim_token = null, lease_expires_at = null,
               rate_not_before = next_eligible_at, updated_at = clock_timestamp()
         where job.id = verifier.id;
        return jsonb_build_object(
          'status', 'queued', 'job_id', verifier.id,
          'source_job_id', source_job.id, 'reused', true,
          'retry_after_seconds', retry_after_seconds,
          'next_eligible_at', next_eligible_at
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


comment on function public.sellerpilot_complete_coupang_create_reconciliation(
  text, uuid, uuid, text, jsonb, text
) is 'Completes GET-only Coupang CREATE reconciliation atomically and durably defers pending or retryable readback before it can be claimed again.';

commit;
