-- Reconcile an uncertain eBay listing.create with official read-only lookups.
-- A crashed recovery worker may reclaim the same expired lease once; no path
-- created here can enqueue or repeat an eBay listing mutation.
begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists ebay_publication_recovery_claim_count smallint
    not null default 0
    check (ebay_publication_recovery_claim_count between 0 and 2);

create index if not exists channel_gateway_jobs_ebay_publication_recovery_idx
  on sellerpilot_private.channel_gateway_jobs (completed_at, id)
  where channel = 'ebay'
    and operation = 'listing.create'
    and status in ('reconciliation_required', 'running')
    and ebay_publication_recovery_claim_count < 2;

create or replace function public.sellerpilot_claim_ebay_publication_reconciliation(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_attempt_id uuid;
  v_listing_id uuid;
  v_credential_id uuid;
  v_job_status text;
  v_claim_token uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope in ('gateway', 'legacy_combined')
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if not found then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  -- The second recovery lease is the final bounded attempt. If that worker
  -- also disappears, return all three projections to an explicit terminal
  -- reconciliation state instead of leaving a permanent running/queued row.
  with exhausted as (
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'reconciliation_required',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = clock_timestamp(),
           error_message = 'EBAY_PUBLICATION_RECONCILIATION_RETRY_EXHAUSTED',
           updated_at = clock_timestamp()
     where job.channel = 'ebay'
       and job.operation = 'listing.create'
       and job.status = 'running'
       and job.lease_expires_at <= clock_timestamp()
       and job.ebay_publication_recovery_claim_count >= 2
     returning job.attempt_id, job.listing_id
  ), reset_attempt as (
    update sellerpilot_private.channel_operation_attempts attempt
       set status = 'manual_required',
           http_status = 409,
           safe_message = 'eBay 공식 조회 복구가 두 번 중단되어 운영 확인이 필요합니다.',
           completed_at = clock_timestamp()
      from exhausted
     where attempt.id = exhausted.attempt_id
       and attempt.status = 'running'
     returning exhausted.listing_id
  )
  update sellerpilot_private.product_listings listing
     set status = 'failed',
         failure_class = 'external_action',
         last_error = 'EBAY_PUBLICATION_RECONCILIATION_RETRY_EXHAUSTED',
         updated_at = clock_timestamp()
    from reset_attempt
   where listing.id = reset_attempt.listing_id
     and listing.status = 'queued';

  select job.id, job.attempt_id, job.listing_id, job.credential_id, job.status
    into v_job_id, v_attempt_id, v_listing_id, v_credential_id, v_job_status
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = job.channel
     and credential.environment = job.environment
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
     and attempt.credential_id = job.credential_id
     and attempt.channel = job.channel
     and attempt.operation = job.operation
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
     and listing.operation_attempt_id = job.attempt_id
     and listing.channel_key = job.channel
   where job.channel = 'ebay'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and (
       (
         job.status = 'reconciliation_required'
         and (job.lease_expires_at is null
           or job.lease_expires_at <= clock_timestamp())
         and (
           (attempt.status = 'manual_required'
             and listing.status = 'failed'
             and listing.failure_class = 'external_action')
           or
           (attempt.status = 'running'
             and listing.status = 'queued'
             and listing.failure_class is null)
         )
       )
       or
       (
         job.status = 'running'
         and job.lease_expires_at <= clock_timestamp()
         and attempt.status = 'running'
         and listing.status = 'queued'
         and listing.failure_class is null
       )
     )
     and job.provider_mutation_started_at is not null
     and job.ebay_publication_recovery_claim_count < 2
     and job.credential_refresh_in_flight is false
     and job.credential_refresh_recovery_vault_id is null
     and job.prepared_credential_id is null
     and job.request_payload#>>'{arguments,publicationStateContract}' = 'verified_remote_state_v1'
     and job.request_payload#>>'{arguments,publicationIntent}' = 'live'
     and job.request_payload#>>'{arguments,marketplaceId}' = 'EBAY_US'
     and coalesce(job.request_payload#>>'{arguments,sku}', '')
           ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
     and coalesce(job.request_payload#>>'{arguments,offerId}', '')
           ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
     and coalesce(job.request_payload#>>'{arguments,publicationExpectedFingerprint}', '')
           ~ '^[a-f0-9]{64}$'
     and job.request_fingerprint =
           job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs sibling
        where sibling.id <> job.id
          and sibling.credential_id = job.credential_id
          and sibling.status = 'running'
     )
   order by job.completed_at, job.id
   for update of job, credential, attempt, listing skip locked
   limit 1;
  if not found then return null; end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         started_at = clock_timestamp(),
         completed_at = null,
         error_message = null,
         ebay_publication_recovery_claim_count =
           job.ebay_publication_recovery_claim_count + 1,
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.status = v_job_status
     and (v_job_status <> 'running'
       or job.lease_expires_at <= clock_timestamp());
  if not found then
    raise exception 'eBay publication reconciliation claim changed'
      using errcode = '40001';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'running',
         http_status = null,
         safe_message = 'eBay 공식 조회로 기존 게시 결과를 재연결하고 있습니다.',
         completed_at = null
   where attempt.id = v_attempt_id
     and attempt.credential_id = v_credential_id
     and attempt.status in ('manual_required', 'running');
  if not found then
    raise exception 'eBay publication reconciliation attempt changed'
      using errcode = '40001';
  end if;

  update sellerpilot_private.product_listings listing
     set status = 'queued',
         last_error = null,
         failure_class = null,
         updated_at = clock_timestamp()
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and (
       (listing.status = 'failed' and listing.failure_class = 'external_action')
       or (listing.status = 'queued' and listing.failure_class is null)
     );
  if not found then
    raise exception 'eBay publication reconciliation listing changed'
      using errcode = '40001';
  end if;

  select jsonb_build_object(
    'id', job.id,
    'claim_token', job.claim_token,
    'credential_id', job.credential_id,
    'channel', job.channel,
    'operation', job.operation,
    'environment', job.environment,
    'request', job.request_payload,
    'attempt_count', job.attempt_count,
    'credential', decrypted.decrypted_secret::jsonb,
    'ebay_publication_reconciliation', jsonb_build_object(
      'contract', 'sellerpilot-ebay-publication-reconciliation/1',
      'sourceJobId', job.id,
      'attemptId', job.attempt_id,
      'credentialId', job.credential_id,
      'sku', job.request_payload#>>'{arguments,sku}',
      'marketplaceId', 'EBAY_US',
      'offerId', job.request_payload#>>'{arguments,offerId}',
      'requestFingerprint', job.request_fingerprint
    )
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where job.id = v_job_id
     and decrypted.decrypted_secret::jsonb#>>'{provider_account_identity_version}' = 'v1'
     and decrypted.decrypted_secret::jsonb#>>'{provider_account_subject}'
           ~ '^ebay:eias:[A-Za-z0-9+/]{16,}={0,2}$';
  if v_result is null then
    raise exception 'eBay publication reconciliation credential is not decryptable or attested'
      using errcode = '55000';
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_claim_ebay_publication_reconciliation(
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_ebay_publication_reconciliation(
  text, text
) to service_role;

commit;
