-- Recheck an uncertain SmartStore repair through the fixed read-only gateway and
-- atomically reuse the existing verified-adoption commit. The prior CREATE,
-- repair, permit, completion, and readback ledgers remain immutable.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993,907175400);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(uuid,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_detail_html_matches(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_uncertain_relation_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(uuid,uuid,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_uncertain_readback_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_uncertain_readbacks'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_content_repair_no_product_effect_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_remote_repair_baselines'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
     ) is null then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_DEPENDENCY_MISSING'
      using errcode='55000';
  end if;
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_adoption_rechecks'
     ) is not null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_adoption_recheck_completions'
     ) is not null then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_ALREADY_EXISTS'
      using errcode='55000';
  end if;
end;
$dependencies$;

create table sellerpilot_private.smartstore_repair_adoption_rechecks (
  id uuid primary key,
  generation smallint not null default 1 check (generation=1),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key~'^[a-f0-9]{64}$'),
  source_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  repair_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  repair_permit_id uuid not null unique references sellerpilot_private.smartstore_existing_content_repair_permits(id) on delete restrict,
  repair_completion_claim_token uuid not null,
  repair_completion_worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  repair_baseline_id uuid not null references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  recovery_receipt_id uuid not null unique references sellerpilot_private.smartstore_content_repair_no_product_effect_receipts(id) on delete restrict,
  captured_relation_id uuid not null unique references sellerpilot_private.smartstore_repair_uncertain_readbacks(id) on delete restrict,
  captured_receipt_id uuid not null unique references sellerpilot_private.smartstore_repair_uncertain_readback_receipts(id) on delete restrict,
  captured_readback_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  captured_readback_claim_token uuid not null,
  captured_readback_worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  captured_readback_sha256 text not null check (captured_readback_sha256~'^[a-f0-9]{64}$'),
  source_job_snapshot_sha256 text not null check (source_job_snapshot_sha256~'^[a-f0-9]{64}$'),
  source_attempt_snapshot_sha256 text not null check (source_attempt_snapshot_sha256~'^[a-f0-9]{64}$'),
  repair_job_snapshot_sha256 text not null check (repair_job_snapshot_sha256~'^[a-f0-9]{64}$'),
  repair_permit_snapshot_sha256 text not null check (repair_permit_snapshot_sha256~'^[a-f0-9]{64}$'),
  repair_completion_snapshot_sha256 text not null check (repair_completion_snapshot_sha256~'^[a-f0-9]{64}$'),
  repair_baseline_snapshot_sha256 text not null check (repair_baseline_snapshot_sha256~'^[a-f0-9]{64}$'),
  recovery_receipt_snapshot_sha256 text not null check (recovery_receipt_snapshot_sha256~'^[a-f0-9]{64}$'),
  captured_relation_snapshot_sha256 text not null check (captured_relation_snapshot_sha256~'^[a-f0-9]{64}$'),
  captured_receipt_snapshot_sha256 text not null check (captured_receipt_snapshot_sha256~'^[a-f0-9]{64}$'),
  captured_completion_snapshot_sha256 text not null check (captured_completion_snapshot_sha256~'^[a-f0-9]{64}$'),
  readback_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_request_sha256 text not null check (readback_request_sha256~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (captured_receipt_id,generation)
);

create index smartstore_repair_adoption_rechecks_product_idx
  on sellerpilot_private.smartstore_repair_adoption_rechecks
  (product_id,created_at desc,id desc);

alter table sellerpilot_private.smartstore_repair_adoption_rechecks
  enable row level security;
revoke all on sellerpilot_private.smartstore_repair_adoption_rechecks
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_repair_adoption_recheck_completions (
  recheck_id uuid not null unique
    references sellerpilot_private.smartstore_repair_adoption_rechecks(id) on delete restrict,
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  completion_fingerprint text not null check (completion_fingerprint~'^[a-f0-9]{64}$'),
  result_status text not null check (result_status in ('verified','reconciliation_required')),
  readback_sha256 text check (readback_sha256 is null or readback_sha256~'^[a-f0-9]{64}$'),
  adoption_receipt_id uuid references sellerpilot_private.smartstore_manual_adoption_receipts(id) on delete restrict,
  attestation_id uuid references sellerpilot_private.smartstore_manual_adoption_attestations(id) on delete restrict,
  provider_mutation_performed boolean not null check (not provider_mutation_performed),
  content_verified boolean not null,
  reason text not null check (length(reason) between 1 and 160),
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id,claim_token),
  check (
    (result_status='verified' and readback_sha256 is not null
      and adoption_receipt_id is not null and attestation_id is not null
      and content_verified)
    or (result_status='reconciliation_required' and readback_sha256 is null
      and adoption_receipt_id is null and attestation_id is null
      and not content_verified)
  )
);

alter table sellerpilot_private.smartstore_repair_adoption_recheck_completions
  enable row level security;
revoke all on sellerpilot_private.smartstore_repair_adoption_recheck_completions
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_repair_adoption_recheck_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_EVIDENCE_IMMUTABLE'
    using errcode='55000';
end;
$$;
revoke all on function
  sellerpilot_private.guard_smartstore_repair_adoption_recheck_evidence()
  from public, anon, authenticated, service_role;
create trigger smartstore_repair_adoption_rechecks_immutable
before update or delete on sellerpilot_private.smartstore_repair_adoption_rechecks
for each row execute function sellerpilot_private.guard_smartstore_repair_adoption_recheck_evidence();
create trigger smartstore_repair_adoption_recheck_completions_immutable
before update or delete on sellerpilot_private.smartstore_repair_adoption_recheck_completions
for each row execute function sellerpilot_private.guard_smartstore_repair_adoption_recheck_evidence();

-- Preserve the exact 160000 matcher as a reusable preimage and then extend the
-- public predicate only for a structurally exact, database-created recheck job.
create function sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean language sql immutable parallel safe set search_path='' as $$
  select p_job.channel = 'smartstore'
    and p_job.operation = 'listing.lineage.verify'
    and p_job.environment = 'production'
    and p_job.attempt_id is null
    and p_job.listing_id is not null
    and p_job.credential_id is not null
    and coalesce(p_job.seller_account_key,'') ~ '^[a-f0-9]{64}$'
    and p_job.provider_mutation_started_at is null
    and p_job.credential_refresh_in_flight is false
    and p_job.credential_refresh_recovery_vault_id is null
    and p_job.prepared_credential_id is null
    and p_job.oauth_exchange_completed is false
    and p_job.request_payload->>'sellerpilotLineageVersion'='provider_listing_readback_v1'
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload,array['sellerpilotLineageVersion','arguments']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload->'arguments',array['sellerpilotSmartstoreManualAdoptionReadback']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}',
      array[
        'contract','ownerId','productId','listingId','sourceJobId',
        'sourceAttemptId','credentialId','sellerAccountKey','sellerSku',
        'approvalRevision','contentSha256','manifestDigest'
      ]
    )
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,contract}'='smartstore_manual_adoption_readback_job_v1'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,ownerId}'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,productId}'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,listingId}'=p_job.listing_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sourceJobId}'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sourceAttemptId}'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,credentialId}'=p_job.credential_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sellerAccountKey}'=p_job.seller_account_key
    and length(trim(p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sellerSku}')) between 1 and 100
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sellerSku}'!~'[[:cntrl:]]'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,approvalRevision}'~'^[1-9][0-9]*$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,contentSha256}'~'^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,manifestDigest}'~'^[a-f0-9]{64}$'
$$;
revoke all on function sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean language plpgsql immutable parallel safe set search_path='' as $$
declare
  stripped sellerpilot_private.channel_gateway_jobs%rowtype;
  recheck_id text;
begin
  recheck_id:=p_job.request_payload->>'sellerpilotSmartstoreRepairAdoptionRecheckId';
  if recheck_id is null
     or recheck_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_job.request_payload,
       array['sellerpilotLineageVersion','arguments','sellerpilotSmartstoreRepairAdoptionRecheckId']
     ) then
    return false;
  end if;
  stripped:=p_job;
  stripped.request_payload:=p_job.request_payload-'sellerpilotSmartstoreRepairAdoptionRecheckId';
  return sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(stripped);
exception when others then
  return false;
end;
$$;
revoke all on function sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean language sql immutable parallel safe set search_path='' as $$
  select sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(p_job)
      or sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(p_job)
$$;
revoke all on function sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_adoption_recheck_is_current(
  p_recheck_id uuid
)
returns boolean language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  recovery_receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  captured_relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  captured_receipt sellerpilot_private.smartstore_repair_uncertain_readback_receipts%rowtype;
  captured_completion sellerpilot_private.smartstore_repair_uncertain_readback_completions%rowtype;
  captured_job sellerpilot_private.channel_gateway_jobs%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=p_recheck_id;
  select candidate.* into source_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.source_job_id;
  select candidate.* into source_attempt from sellerpilot_private.channel_operation_attempts candidate
  where candidate.id=recheck.source_attempt_id;
  select candidate.* into repair_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.repair_job_id;
  select candidate.* into repair_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=recheck.repair_permit_id;
  select candidate.* into repair_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=recheck.repair_job_id
    and candidate.claim_token=recheck.repair_completion_claim_token
    and candidate.worker_token_id=recheck.repair_completion_worker_token_id;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=recheck.repair_baseline_id;
  select candidate.* into recovery_receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.id=recheck.recovery_receipt_id;
  select candidate.* into captured_relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=recheck.captured_relation_id;
  select candidate.* into captured_receipt
  from sellerpilot_private.smartstore_repair_uncertain_readback_receipts candidate
  where candidate.id=recheck.captured_receipt_id;
  select candidate.* into captured_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.captured_readback_job_id;
  select candidate.* into captured_completion
  from sellerpilot_private.smartstore_repair_uncertain_readback_completions candidate
  where candidate.job_id=recheck.captured_readback_job_id
    and candidate.claim_token=recheck.captured_readback_claim_token
    and candidate.worker_token_id=recheck.captured_readback_worker_token_id;
  select candidate.* into readback_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.readback_job_id;

  return recheck.id is not null and recheck.generation=1
    and source_job.id=recheck.source_job_id
    and source_attempt.id=recheck.source_attempt_id
    and repair_job.id=recheck.repair_job_id
    and repair_job.status='reconciliation_required'
    and repair_job.provider_mutation_started_at is not null
    and repair_permit.id=recheck.repair_permit_id
    and repair_permit.repair_job_id=repair_job.id
    and repair_permit.baseline_id=recheck.repair_baseline_id
    and repair_permit.consumed_at is not null
    and repair_permit.verification_job_id is null
    and repair_completion.job_id=repair_job.id
    and repair_completion.result_status='reconciliation_required'
    and repair_completion.readback_sha256 is null
    and repair_completion.verification_job_id is null
    and repair_baseline.id=recheck.repair_baseline_id
    and recovery_receipt.id=recheck.recovery_receipt_id
    and recovery_receipt.after_baseline_id=repair_baseline.id
    and captured_relation.id=recheck.captured_relation_id
    and captured_relation.repair_job_id=repair_job.id
    and captured_relation.repair_permit_id=repair_permit.id
    and captured_relation.repair_baseline_id=repair_baseline.id
    and captured_relation.recovery_receipt_id=recovery_receipt.id
    and captured_receipt.id=recheck.captured_receipt_id
    and captured_receipt.relation_id=captured_relation.id
    and captured_receipt.readback_job_id=recheck.captured_readback_job_id
    and captured_receipt.readback_claim_token=recheck.captured_readback_claim_token
    and captured_receipt.readback_worker_token_id=recheck.captured_readback_worker_token_id
    and captured_receipt.official_readback_sha256=recheck.captured_readback_sha256
    and not captured_receipt.readback_provider_mutation_performed
    and captured_receipt.repair_mutation_outcome='unknown'
    and not captured_receipt.content_verified
    and not captured_receipt.normal_update_eligible
    and captured_completion.job_id=captured_receipt.readback_job_id
    and captured_completion.relation_id=captured_relation.id
    and captured_completion.result_status='captured'
    and captured_completion.evidence_receipt_id=captured_receipt.id
    and captured_completion.readback_sha256=captured_receipt.official_readback_sha256
    and captured_job.id=captured_receipt.readback_job_id
    and captured_job.status='reconciliation_required'
    and captured_job.provider_mutation_started_at is null
    and readback_job.id=recheck.readback_job_id
    and readback_job.listing_id=recheck.listing_id
    and readback_job.credential_id=recheck.credential_id
    and readback_job.seller_account_key=recheck.seller_account_key
    and readback_job.created_by=source_job.created_by
    and readback_job.status in ('queued','running','reconciliation_required')
    and readback_job.provider_mutation_started_at is null
    and readback_job.request_payload->>'sellerpilotSmartstoreRepairAdoptionRecheckId'=recheck.id::text
    and sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(readback_job)
    and sellerpilot_private.external_detail_hash(readback_job.request_payload)=recheck.readback_request_sha256
    and recheck.owner_id=repair_baseline.owner_id
    and recheck.product_id=repair_baseline.product_id
    and recheck.listing_id=repair_baseline.listing_id
    and recheck.credential_id=repair_baseline.credential_id
    and recheck.seller_account_key=repair_baseline.seller_account_key
    and recheck.source_job_id=repair_baseline.source_job_id
    and recheck.source_attempt_id=repair_baseline.source_attempt_id
    and recheck.captured_readback_worker_token_id=repair_baseline.readback_worker_token_id
    and recheck.source_job_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(source_job))
    and recheck.source_attempt_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
    and recheck.repair_job_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_job))
    and recheck.repair_permit_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_permit))
    and recheck.repair_completion_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_completion))
    and recheck.repair_baseline_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_baseline))
    and recheck.recovery_receipt_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(recovery_receipt))
    and recheck.captured_relation_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(captured_relation))
    and recheck.captured_receipt_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(captured_receipt))
    and recheck.captured_completion_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(captured_completion))
    and sellerpilot_private.smartstore_repair_uncertain_relation_is_current(captured_relation.id);
exception when others then
  return false;
end;
$$;
revoke all on function sellerpilot_private.smartstore_repair_adoption_recheck_is_current(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_adoption_recheck_claim_allowed(
  p_job_id uuid,p_worker_token_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from sellerpilot_private.smartstore_repair_adoption_rechecks recheck
    where recheck.readback_job_id=p_job_id
      and recheck.captured_readback_worker_token_id=p_worker_token_id
      and sellerpilot_private.smartstore_repair_adoption_recheck_is_current(recheck.id)
  )
$$;
revoke all on function sellerpilot_private.smartstore_repair_adoption_recheck_claim_allowed(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
  p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,p_worker_version text
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id=job.credential_id and credential.id=p_credential_id
     and credential.channel='smartstore' and credential.environment='production'
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key=job.seller_account_key
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id=p_worker_token_id and token.scope='gateway'
     and token.status='active' and token.expires_at>clock_timestamp()
     and token.last_version=p_worker_version
     and p_worker_version~'^sellerpilot-cli-worker/1[.]61[+][0-9a-f]{40}[.][0-9a-f]{11}$'
     and p_worker_version like 'sellerpilot-cli-worker/1.61+'
       ||sellerpilot_private.active_serverless_runtime_release_sha()||'.%'
    where job.id=p_job_id and job.status='queued'
      and (
        job.attempt_count=0
        or job.updated_at<=clock_timestamp()-case
          when job.attempt_count=1 then interval '5 seconds'
          when job.attempt_count=2 then interval '10 seconds'
          when job.attempt_count=3 then interval '20 seconds'
          when job.attempt_count=4 then interval '40 seconds'
          else interval '80 seconds' end
      )
      and sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job)
      and (
        not sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(job)
        or sellerpilot_private.smartstore_repair_adoption_recheck_claim_allowed(
          job.id,p_worker_token_id
        )
      )
      and sellerpilot_private.smartstore_manual_adoption_readback_binding(job.id)
        #>>'{status}'='ready'
  )
$$;
revoke all on function sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
  uuid,uuid,uuid,text
) from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_repair_adoption_recheck_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  old_id text;
  new_id text;
begin
  new_id:=new.request_payload->>'sellerpilotSmartstoreRepairAdoptionRecheckId';
  if tg_op='UPDATE' then
    old_id:=old.request_payload->>'sellerpilotSmartstoreRepairAdoptionRecheckId';
  end if;
  if new_id is null and old_id is null then return new; end if;
  if new_id is null
     or sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(new) is not true
     or (tg_op='INSERT' and current_setting(
       'sellerpilot.smartstore_repair_adoption_recheck_enqueue',true
     ) is distinct from new_id)
     or (tg_op='UPDATE' and (
       old_id is distinct from new_id
       or old.request_payload is distinct from new.request_payload
       or old.listing_id is distinct from new.listing_id
       or old.credential_id is distinct from new.credential_id
       or old.seller_account_key is distinct from new.seller_account_key
       or old.created_by is distinct from new.created_by
     )) then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_JOB_INVALID';
  end if;
  return new;
end;
$$;
revoke all on function sellerpilot_private.guard_smartstore_repair_adoption_recheck_job()
  from public, anon, authenticated, service_role;
create trigger smartstore_repair_adoption_recheck_job_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_smartstore_repair_adoption_recheck_job();

create unique index channel_gateway_jobs_smartstore_adoption_recheck_id_idx
  on sellerpilot_private.channel_gateway_jobs (
    (request_payload->>'sellerpilotSmartstoreRepairAdoptionRecheckId')
  ) where request_payload?'sellerpilotSmartstoreRepairAdoptionRecheckId';

do $active_lane_preimage$
declare definition text;
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into definition
  from pg_catalog.pg_index
  where indexrelid='sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  if definition is null
     or sellerpilot_private.external_detail_hash(to_jsonb(definition))<>
       'b84a914908c0929e830e2a23b88bc08f2f393ead72fed7d29bc0335a627d2001' then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_ACTIVE_LANE_PREIMAGE_DRIFT';
  end if;
end;
$active_lane_preimage$;

drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_verifier_v1'
      when sellerpilot_private.qoo10_shipping_s1_activation_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_activation_v1'
      when sellerpilot_private.qoo10_exact_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_exact_s1_verifier_v1'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.update'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,contract}'='qoo10_exact_localization_update_v2'
        then 'qoo10_exact_localization_update_v2'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.activate'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'='qoo10_s1_activation_v1'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'='1217336970'
        then 'qoo10_exact_s1_activation_v1'
      when channel='temu' and operation='listing.stop'
       and request_payload#>>'{arguments,sellerpilotTemuContainment,version}'='temu_safe_test_containment_v1'
        then 'temu_safe_test_containment_v1'
      when channel='temu' and operation='listing.publication.verify'
       and request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'='temu_safe_test_containment_discovery_v1'
       and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
        then 'temu_safe_test_containment_discovery_v1'
      when sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(channel_gateway_jobs)
        then 'smartstore_repair_adoption_recheck_v1'
      when sellerpilot_private.smartstore_manual_adoption_readback_job_matches(channel_gateway_jobs)
        then 'smartstore_manual_adoption_readback_v1'
      when sellerpilot_private.smartstore_existing_content_repair_job_matches(channel_gateway_jobs)
       and request_payload?'sellerpilotSmartstoreRepairRecoveryReceiptId'
        then 'smartstore_existing_content_repair_recovery_v1'
      when sellerpilot_private.smartstore_existing_content_repair_job_matches(channel_gateway_jobs)
        then 'smartstore_existing_content_repair_v1'
      when channel='smartstore' and operation='listing.update'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contract}'='smartstore_manual_adoption_verified_v1'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,status}'='verified'
        then 'smartstore_manual_adoption_normal_update_v1'
      else 'default'
    end)
  )
  where listing_id is not null
    and operation in (
      'listing.create','listing.update','listing.stop','listing.activate',
      'price.update','inventory.update','listing.lineage.verify','listing.publication.verify'
    )
    and status in ('queued','running','reconciliation_required');

create function sellerpilot_private.smartstore_repair_adoption_recheck_safe_state(
  p_recheck_id uuid,p_reused boolean
)
returns jsonb language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  state text;
  reason text;
begin
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=p_recheck_id;
  select candidate.* into job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.readback_job_id;
  select candidate.* into completion
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  where candidate.recheck_id=recheck.id;
  if completion.result_status='verified' then
    state:='verified'; reason:='POST_REPAIR_REMOTE_STATE_VERIFIED';
  elsif job.status='queued' then
    state:='queued'; reason:='ADOPTION_RECHECK_QUEUED';
  elsif job.status='running' then
    state:='running'; reason:='ADOPTION_RECHECK_RUNNING';
  elsif job.status='reconciliation_required' then
    state:='reconciliation_required';
    reason:=coalesce(completion.reason,'ADOPTION_RECHECK_RECONCILIATION_REQUIRED');
  else
    state:='blocked'; reason:='ADOPTION_RECHECK_FAILED';
  end if;
  return jsonb_build_object(
    'contract','smartstore_repair_adoption_recheck_v1',
    'status',state,'reason',reason,
    'jobId',job.id,'recheckId',recheck.id,
    'capturedReceiptId',recheck.captured_receipt_id,
    'repairJobId',recheck.repair_job_id,
    'baselineId',recheck.repair_baseline_id,
    'productId',recheck.product_id,'listingId',recheck.listing_id,
    'receiptId',completion.adoption_receipt_id,
    'attestationId',completion.attestation_id,
    'readbackSha256',completion.readback_sha256,
    'reused',p_reused,
    'contentVerified',coalesce(completion.content_verified,false),
    'providerMutationPerformed',false,
    'normalUpdateEligible',coalesce(completion.result_status='verified',false)
  );
exception when others then
  return jsonb_build_object(
    'contract','smartstore_repair_adoption_recheck_v1',
    'status','blocked','reason','ADOPTION_RECHECK_STATE_INVALID',
    'jobId',null,'recheckId',p_recheck_id,'capturedReceiptId',null,
    'repairJobId',null,'baselineId',null,'productId',null,'listingId',null,
    'receiptId',null,'attestationId',null,'readbackSha256',null,
    'reused',p_reused,'contentVerified',false,
    'providerMutationPerformed',false,'normalUpdateEligible',false
  );
end;
$$;
revoke all on function sellerpilot_private.smartstore_repair_adoption_recheck_safe_state(uuid,boolean)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_smartstore_adoption_recheck(
  p_actor uuid,p_product_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin where admin.user_id=p_actor
     )
     or not exists (
       select 1 from sellerpilot_private.products product
       where product.id=p_product_id and product.owner_id=p_actor
         and not product.demo and product.status<>'archived'
     ) then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_ACCESS_DENIED'
      using errcode='42501';
  end if;
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if recheck.id is null then
    return jsonb_build_object(
      'contract','smartstore_repair_adoption_recheck_v1',
      'status','blocked','reason','ADOPTION_RECHECK_NOT_FOUND',
      'jobId',null,'recheckId',null,'capturedReceiptId',null,
      'repairJobId',null,'baselineId',null,'productId',p_product_id,'listingId',null,
      'receiptId',null,'attestationId',null,'readbackSha256',null,
      'reused',false,'contentVerified',false,
      'providerMutationPerformed',false,'normalUpdateEligible',false
    );
  end if;
  return sellerpilot_private.smartstore_repair_adoption_recheck_safe_state(
    recheck.id,true
  );
end;
$$;
revoke all on function public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)
  to service_role;

create function public.sellerpilot_service_enqueue_smartstore_adoption_recheck(
  p_actor uuid,p_product_id uuid
)
returns jsonb language plpgsql security definer
set search_path='' set timezone='UTC' as $$
declare
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  captured_receipt sellerpilot_private.smartstore_repair_uncertain_readback_receipts%rowtype;
  captured_relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  captured_completion sellerpilot_private.smartstore_repair_uncertain_readback_completions%rowtype;
  captured_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  recovery_receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  preparation jsonb;
  request_payload jsonb;
  recheck_id uuid:=gen_random_uuid();
  readback_job_id uuid:=gen_random_uuid();
  prior_enqueue_guc text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin where admin.user_id=p_actor
     )
     or not exists (
       select 1 from sellerpilot_private.products product
       where product.id=p_product_id and product.owner_id=p_actor
         and not product.demo and product.status<>'archived'
     ) then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_ACCESS_DENIED'
      using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-repair-adoption-recheck:'||p_product_id::text)
  );
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if recheck.id is not null then
    return sellerpilot_private.smartstore_repair_adoption_recheck_safe_state(
      recheck.id,true
    );
  end if;

  select candidate.* into captured_receipt
  from sellerpilot_private.smartstore_repair_uncertain_readback_receipts candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.captured_at desc,candidate.id desc limit 1;
  select candidate.* into captured_relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=captured_receipt.relation_id;
  select candidate.* into captured_completion
  from sellerpilot_private.smartstore_repair_uncertain_readback_completions candidate
  where candidate.job_id=captured_receipt.readback_job_id
    and candidate.claim_token=captured_receipt.readback_claim_token
    and candidate.worker_token_id=captured_receipt.readback_worker_token_id;
  select candidate.* into captured_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=captured_receipt.readback_job_id for share;
  select candidate.* into repair_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=captured_relation.repair_job_id for share;
  select candidate.* into repair_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=captured_relation.repair_permit_id for share;
  select candidate.* into repair_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=repair_job.id
    and candidate.claim_token=captured_relation.repair_completion_claim_token
    and candidate.worker_token_id=captured_relation.repair_completion_worker_token_id;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=captured_relation.repair_baseline_id for share;
  select candidate.* into recovery_receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.id=captured_relation.recovery_receipt_id for share;
  select candidate.* into source_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=repair_baseline.source_job_id for share;
  select candidate.* into source_attempt
  from sellerpilot_private.channel_operation_attempts candidate
  where candidate.id=repair_baseline.source_attempt_id for share;
  preparation:=public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor,p_product_id
  );
  if captured_receipt.id is null or captured_relation.id is null
     or captured_completion.job_id is null or captured_job.id is null
     or source_job.id is null or source_attempt.id is null
     or repair_job.id is null or repair_permit.id is null
     or repair_completion.job_id is null or repair_baseline.id is null
     or recovery_receipt.id is null
     or captured_completion.result_status<>'captured'
     or captured_completion.evidence_receipt_id<>captured_receipt.id
     or captured_receipt.official_readback_sha256<>captured_completion.readback_sha256
     or sellerpilot_private.smartstore_repair_uncertain_relation_is_current(
       captured_relation.id
     ) is not true
     or preparation->>'contract'<>'smartstore_manual_adoption_prepare_v1'
     or preparation->>'status'<>'ready'
     or preparation->>'sourceJobId'<>source_job.id::text
     or preparation->>'sourceAttemptId'<>source_attempt.id::text
     or preparation->>'credentialId'<>repair_baseline.credential_id::text
     or preparation->>'listingId'<>repair_baseline.listing_id::text
     or preparation->>'approvalRevision'<>repair_baseline.approval_revision::text
     or preparation->>'contentSha256'<>repair_baseline.approval_content_sha256
     or preparation->>'manifestDigest'<>repair_baseline.approved_manifest_digest then
    return jsonb_build_object(
      'contract','smartstore_repair_adoption_recheck_v1',
      'status','blocked','reason','ADOPTION_RECHECK_SOURCE_NOT_CURRENT',
      'jobId',null,'recheckId',null,'capturedReceiptId',captured_receipt.id,
      'repairJobId',repair_job.id,'baselineId',repair_baseline.id,
      'productId',p_product_id,'listingId',repair_baseline.listing_id,
      'receiptId',null,'attestationId',null,'readbackSha256',null,
      'reused',false,'contentVerified',false,
      'providerMutationPerformed',false,'normalUpdateEligible',false
    );
  end if;
  request_payload:=captured_job.request_payload||jsonb_build_object(
    'sellerpilotSmartstoreRepairAdoptionRecheckId',recheck_id
  );
  prior_enqueue_guc:=coalesce(current_setting(
    'sellerpilot.smartstore_repair_adoption_recheck_enqueue',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_repair_adoption_recheck_enqueue',recheck_id::text,true
  );
  begin
    insert into sellerpilot_private.channel_gateway_jobs (
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,seller_account_key,created_by
    ) values (
      readback_job_id,repair_baseline.credential_id,null,
      repair_baseline.listing_id,'smartstore','listing.lineage.verify','production',
      request_payload,repair_baseline.seller_account_key,source_job.created_by
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_repair_adoption_recheck_enqueue',prior_enqueue_guc,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_repair_adoption_recheck_enqueue',prior_enqueue_guc,true
  );
  insert into sellerpilot_private.smartstore_repair_adoption_rechecks (
    id,owner_id,product_id,listing_id,credential_id,seller_account_key,
    source_job_id,source_attempt_id,repair_job_id,repair_permit_id,
    repair_completion_claim_token,repair_completion_worker_token_id,
    repair_baseline_id,recovery_receipt_id,captured_relation_id,
    captured_receipt_id,captured_readback_job_id,captured_readback_claim_token,
    captured_readback_worker_token_id,captured_readback_sha256,
    source_job_snapshot_sha256,source_attempt_snapshot_sha256,
    repair_job_snapshot_sha256,repair_permit_snapshot_sha256,
    repair_completion_snapshot_sha256,repair_baseline_snapshot_sha256,
    recovery_receipt_snapshot_sha256,captured_relation_snapshot_sha256,
    captured_receipt_snapshot_sha256,captured_completion_snapshot_sha256,
    readback_job_id,readback_request_sha256
  ) values (
    recheck_id,repair_baseline.owner_id,repair_baseline.product_id,
    repair_baseline.listing_id,repair_baseline.credential_id,
    repair_baseline.seller_account_key,source_job.id,source_attempt.id,
    repair_job.id,repair_permit.id,captured_relation.repair_completion_claim_token,
    captured_relation.repair_completion_worker_token_id,
    repair_baseline.id,recovery_receipt.id,
    captured_relation.id,captured_receipt.id,captured_job.id,
    captured_receipt.readback_claim_token,captured_receipt.readback_worker_token_id,
    captured_receipt.official_readback_sha256,
    sellerpilot_private.external_detail_hash(to_jsonb(source_job)),
    sellerpilot_private.external_detail_hash(to_jsonb(source_attempt)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_job)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_permit)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_completion)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_baseline)),
    sellerpilot_private.external_detail_hash(to_jsonb(recovery_receipt)),
    sellerpilot_private.external_detail_hash(to_jsonb(captured_relation)),
    sellerpilot_private.external_detail_hash(to_jsonb(captured_receipt)),
    sellerpilot_private.external_detail_hash(to_jsonb(captured_completion)),
    readback_job_id,sellerpilot_private.external_detail_hash(request_payload)
  ) returning * into recheck;
  if sellerpilot_private.smartstore_repair_adoption_recheck_is_current(recheck.id)
       is not true then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_BINDING_FAILED';
  end if;
  return sellerpilot_private.smartstore_repair_adoption_recheck_safe_state(
    recheck.id,false
  );
end;
$$;
revoke all on function public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)
  to service_role;

create function sellerpilot_private.smartstore_repair_adoption_recheck_pixel_is_valid(
  p_source_job_id uuid,p_readback jsonb
)
returns boolean language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  recheck_job_id uuid;
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  captured sellerpilot_private.smartstore_repair_uncertain_readback_receipts%rowtype;
  expected_pixels jsonb;
  transport jsonb;
  image_index integer;
begin
  begin
    recheck_job_id:=nullif(current_setting(
      'sellerpilot.smartstore_repair_adoption_recheck_job',true
    ),'')::uuid;
  exception when others then
    return false;
  end;
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.readback_job_id=recheck_job_id;
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=recheck.repair_baseline_id;
  select candidate.* into captured
  from sellerpilot_private.smartstore_repair_uncertain_readback_receipts candidate
  where candidate.id=recheck.captured_receipt_id;
  if recheck.id is null or baseline.id is null or captured.id is null
     or recheck.source_job_id is distinct from p_source_job_id
     or sellerpilot_private.smartstore_repair_adoption_recheck_is_current(
       recheck.id
     ) is not true
     or jsonb_typeof(baseline.approved_transport_images) is distinct from 'array'
     or jsonb_array_length(baseline.approved_transport_images)<>8 then
    return false;
  end if;
  for image_index in 0..7 loop
    transport:=baseline.approved_transport_images->image_index;
    if not sellerpilot_private.smartstore_jsonb_has_exact_keys(transport,array[
         'approvedObjectPath','approvedSourceSha256','contentSha256',
         'decodedRgbaSha256','index','objectPath','url'
       ])
       or transport->>'index' is distinct from image_index::text
       or transport->>'contentSha256'!~'^[a-f0-9]{64}$'
       or transport->>'decodedRgbaSha256'!~'^[a-f0-9]{64}$'
       or captured.detail_image_pixel_sha256s->>image_index
         is distinct from transport->>'decodedRgbaSha256'
       or p_readback#>>array['detailImagePixelSha256s',image_index::text]
         is distinct from transport->>'decodedRgbaSha256' then
      return false;
    end if;
  end loop;
  select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
    into expected_pixels
  from jsonb_array_elements(baseline.approved_transport_images)
    with ordinality image(value,ordinal);
  return captured.detail_image_pixel_sha256s is not distinct from expected_pixels
    and p_readback->'detailImagePixelSha256s' is not distinct from expected_pixels;
exception when others then
  return false;
end;
$$;
revoke all on function sellerpilot_private.smartstore_repair_adoption_recheck_pixel_is_valid(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.sellerpilot_175400_manual_adoption_pixel_pre_recheck(
  p_source_job_id uuid,p_readback jsonb,p_original_expected_pixels jsonb
)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  verifier_job_id uuid;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  receipt sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  expected_pixels jsonb;
begin
  if p_readback->'detailImagePixelSha256s' is not distinct from p_original_expected_pixels
  then return true; end if;
  begin
    verifier_job_id:=nullif(current_setting(
      'sellerpilot.smartstore_content_repair_verifier_job',true
    ),'')::uuid;
  exception when others then return false;
  end;
  select candidate.* into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  join sellerpilot_private.smartstore_existing_remote_repair_baselines baseline
    on baseline.id=candidate.baseline_id
  join sellerpilot_private.channel_gateway_jobs repair_job
    on repair_job.id=candidate.repair_job_id
  where candidate.verification_job_id=verifier_job_id
    and baseline.source_job_id=p_source_job_id
    and repair_job.status='succeeded'
    and candidate.consumed_at is not null
    and candidate.completed_readback_sha256 is not null;
  select candidate.* into receipt
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=permit.repair_job_id
    and candidate.result_status='verification_queued'
    and candidate.verification_job_id=verifier_job_id
    and candidate.readback_sha256=permit.completed_readback_sha256;
  if permit.id is null or receipt.job_id is null
     or jsonb_typeof(permit.approved_transmission_images) is distinct from 'array'
     or jsonb_array_length(permit.approved_transmission_images)<>8 then
    return false;
  end if;
  select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
    into expected_pixels
  from jsonb_array_elements(permit.approved_transmission_images)
    with ordinality image(value,ordinal);
  return p_readback->'detailImagePixelSha256s' is not distinct from expected_pixels;
exception when others then return false;
end;
$$;
revoke all on function sellerpilot_private.sellerpilot_175400_manual_adoption_pixel_pre_recheck(
  uuid,jsonb,jsonb
) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(
  p_source_job_id uuid,p_readback jsonb,p_original_expected_pixels jsonb
)
returns boolean language sql stable security definer set search_path='' as $$
  select sellerpilot_private.sellerpilot_175400_manual_adoption_pixel_pre_recheck(
           p_source_job_id,p_readback,p_original_expected_pixels
         )
      or sellerpilot_private.smartstore_repair_adoption_recheck_pixel_is_valid(
           p_source_job_id,p_readback
         )
$$;
revoke all on function sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(
  uuid,jsonb,jsonb
) from public, anon, authenticated, service_role;

alter function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) rename to sellerpilot_175400_complete_smartstore_readback_pre_recheck;
revoke all on function public.sellerpilot_175400_complete_smartstore_readback_pre_recheck(
  text,uuid,uuid,text,jsonb,text
) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_readback jsonb default null,p_error_message text default null
)
returns jsonb language plpgsql security definer
set search_path='' set timezone='UTC' as $$
declare
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  existing_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  marker jsonb;
  commit_result jsonb;
  safe_response jsonb;
  readback_sha text;
  completion_fingerprint text;
  commit_error text;
  body_hashes jsonb;
  observed_at timestamptz;
  prior_recheck_guc text;
  prior_lineage_guc text;
begin
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.readback_job_id=p_job_id;
  if recheck.id is null or p_status<>'succeeded' then
    return public.sellerpilot_175400_complete_smartstore_readback_pre_recheck(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
  end if;
  if p_claim_token is null
     or jsonb_typeof(p_readback) is distinct from 'object'
     or octet_length(p_readback::text)>2097152
     or p_error_message is not null then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_COMPLETION_INVALID';
  end if;
  readback_sha:=sellerpilot_private.external_detail_hash(p_readback);
  completion_fingerprint:=sellerpilot_private.external_detail_hash(
    jsonb_build_object(
      'status',p_status,'readbackSha256',readback_sha,'safeError',null
    )
  );
  select candidate.* into worker_token
  from sellerpilot_private.ai_cli_worker_tokens candidate
  where candidate.token_hash=p_token_hash and candidate.scope='gateway'
    and candidate.status='active' and candidate.expires_at>clock_timestamp();
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-repair-adoption-recheck-job:'||p_job_id::text)
  );
  select candidate.* into existing_completion
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  where candidate.job_id=p_job_id and candidate.claim_token=p_claim_token
    and candidate.worker_token_id=worker_token.id;
  if existing_completion.job_id is not null then
    if existing_completion.completion_fingerprint is distinct from completion_fingerprint then
      return jsonb_build_object(
        'contract','smartstore_manual_adoption_readback_completion_v1',
        'status','reconciliation_required','jobId',p_job_id,
        'receiptId',existing_completion.adoption_receipt_id,
        'attestationId',existing_completion.attestation_id,'baselineId',null,
        'readbackSha256',existing_completion.readback_sha256,
        'reused',true,'reason','COMPLETION_REPLAY_MISMATCH'
      );
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status',existing_completion.result_status,'jobId',p_job_id,
      'receiptId',existing_completion.adoption_receipt_id,
      'attestationId',existing_completion.attestation_id,'baselineId',null,
      'readbackSha256',existing_completion.readback_sha256,
      'reused',true,'reason',existing_completion.reason
    );
  end if;
  select candidate.* into job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=p_job_id and candidate.status='running'
    and candidate.worker_token_id=worker_token.id
    and candidate.claim_token=p_claim_token
    and candidate.lease_expires_at>clock_timestamp()
  for update;
  if worker_token.id is null or job.id is null
     or worker_token.id is distinct from recheck.captured_readback_worker_token_id
     or sellerpilot_private.smartstore_repair_adoption_recheck_is_current(
       recheck.id
     ) is not true then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','lease_lost','jobId',p_job_id,
      'receiptId',null,'attestationId',null,'baselineId',null,
      'readbackSha256',null,'reused',false,'reason','CLAIM_LEASE_LOST'
    );
  end if;
  marker:=job.request_payload#>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=recheck.repair_baseline_id;
  body_hashes:=sellerpilot_private.smartstore_repair_body_hashes(p_readback);
  begin
    observed_at:=nullif(p_readback->>'observedAt','')::timestamptz;
  exception when others then
    observed_at:=null;
  end;
  if observed_at is null
     or observed_at<recheck.created_at
     or observed_at>clock_timestamp()+interval '1 minute'
     or repair_baseline.id is null
     or body_hashes#>>'{protectedBodySha256}'
       is distinct from repair_baseline.protected_body_sha256 then
    commit_error:='SMARTSTORE_REPAIR_ADOPTION_RECHECK_EVIDENCE_MISMATCH';
  else
    prior_recheck_guc:=coalesce(current_setting(
      'sellerpilot.smartstore_repair_adoption_recheck_job',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_repair_adoption_recheck_job',job.id::text,true
    );
    begin
      begin
        commit_result:=public.sellerpilot_service_commit_smartstore_manual_adoption(
          (marker->>'ownerId')::uuid,(marker->>'productId')::uuid,
          (marker->>'sourceJobId')::uuid,(marker->>'credentialId')::uuid,
          (marker->>'approvalRevision')::bigint,marker->>'contentSha256',
          marker->>'manifestDigest',p_readback
        );
      exception when others then
        commit_error:=SQLERRM;
      end;
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_repair_adoption_recheck_job',prior_recheck_guc,true
      );
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_repair_adoption_recheck_job',prior_recheck_guc,true
      );
      raise;
    end;
  end if;
  if commit_error is not null
     or commit_result->>'contract' is distinct from 'smartstore_manual_adoption_verified_v1'
     or commit_result->>'status' not in ('verified','already_verified')
     or commit_result->>'providerMutationPerformed' is distinct from 'false'
     or commit_result->>'normalUpdateEligible' is distinct from 'true' then
    prior_lineage_guc:=coalesce(current_setting(
      'sellerpilot.provider_listing_lineage_rebind',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='reconciliation_required',response_payload=null,
          error_message='SMARTSTORE_REPAIR_ADOPTION_RECHECK_REJECTED',
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id and status='running' and claim_token=p_claim_token;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',prior_lineage_guc,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_guc,true
    );
    insert into sellerpilot_private.smartstore_repair_adoption_recheck_completions (
      recheck_id,job_id,claim_token,worker_token_id,completion_fingerprint,
      result_status,readback_sha256,adoption_receipt_id,attestation_id,
      provider_mutation_performed,content_verified,reason
    ) values (
      recheck.id,job.id,p_claim_token,worker_token.id,completion_fingerprint,
      'reconciliation_required',null,null,null,false,false,
      'ADOPTION_RECHECK_COMMIT_REJECTED'
    );
    insert into sellerpilot_private.gateway_completion_receipts (
      job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
    ) values (job.id,p_claim_token,worker_token.id,completion_fingerprint,null);
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','reconciliation_required','jobId',job.id,
      'receiptId',null,'attestationId',null,'baselineId',null,
      'readbackSha256',null,'reused',false,
      'reason','ADOPTION_RECHECK_COMMIT_REJECTED'
    );
  end if;
  safe_response:=jsonb_build_object(
    'contract','smartstore_manual_adoption_gateway_receipt_v1',
    'ok',true,'channel','smartstore','operation','listing.lineage.verify',
    'verificationStatus','verified','readbackSha256',readback_sha,
    'receiptId',commit_result->>'receiptId',
    'attestationId',commit_result->>'attestationId',
    'originProductNo',commit_result->>'originProductNo',
    'channelProductNo',commit_result->>'channelProductNo',
    'providerMutationPerformed',false
  );
  insert into sellerpilot_private.smartstore_repair_adoption_recheck_completions (
    recheck_id,job_id,claim_token,worker_token_id,completion_fingerprint,
    result_status,readback_sha256,adoption_receipt_id,attestation_id,
    provider_mutation_performed,content_verified,reason
  ) values (
    recheck.id,job.id,p_claim_token,worker_token.id,completion_fingerprint,
    'verified',readback_sha,(commit_result->>'receiptId')::uuid,
    (commit_result->>'attestationId')::uuid,false,true,
    'POST_REPAIR_REMOTE_STATE_VERIFIED'
  );
  prior_lineage_guc:=coalesce(current_setting(
    'sellerpilot.provider_listing_lineage_rebind',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
  );
  begin
    update sellerpilot_private.channel_gateway_jobs
    set status='succeeded',response_payload=safe_response,error_message=null,
        worker_token_id=null,claim_token=null,lease_expires_at=null,
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=job.id and status='running' and claim_token=p_claim_token;
    if not found then raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_LEASE_LOST'; end if;
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_guc,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',prior_lineage_guc,true
  );
  insert into sellerpilot_private.gateway_completion_receipts (
    job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
  ) values (job.id,p_claim_token,worker_token.id,completion_fingerprint,null);
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_completion_v1',
    'status','verified','jobId',job.id,
    'receiptId',commit_result->>'receiptId',
    'attestationId',commit_result->>'attestationId','baselineId',null,
    'readbackSha256',readback_sha,'reused',false,
    'reason','POST_REPAIR_REMOTE_STATE_VERIFIED'
  );
end;
$$;
revoke all on function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) to service_role;

create function sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(
  p_job_id uuid
)
returns boolean language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  bridge sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  recovery_receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  prior_job sellerpilot_private.channel_gateway_jobs%rowtype;
  prior_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  prior_completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  captured_relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  captured_receipt sellerpilot_private.smartstore_repair_uncertain_readback_receipts%rowtype;
  captured_completion sellerpilot_private.smartstore_repair_uncertain_readback_completions%rowtype;
  captured_job sellerpilot_private.channel_gateway_jobs%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  adoption_receipt sellerpilot_private.smartstore_manual_adoption_receipts%rowtype;
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
begin
  select candidate.* into bridge
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  join sellerpilot_private.smartstore_repair_adoption_rechecks session
    on session.id=candidate.recheck_id
  where candidate.result_status='verified'
    and p_job_id in (
      session.repair_job_id,
      (select receipt.prior_repair_job_id
       from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts receipt
       where receipt.id=session.recovery_receipt_id)
    )
  order by candidate.created_at desc limit 1;
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=bridge.recheck_id;
  select candidate.* into source_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.source_job_id;
  select candidate.* into source_attempt from sellerpilot_private.channel_operation_attempts candidate
  where candidate.id=recheck.source_attempt_id;
  select candidate.* into repair_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.repair_job_id;
  select candidate.* into repair_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=recheck.repair_permit_id;
  select candidate.* into repair_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=recheck.repair_job_id
    and candidate.claim_token=recheck.repair_completion_claim_token
    and candidate.worker_token_id=recheck.repair_completion_worker_token_id;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=recheck.repair_baseline_id;
  select candidate.* into recovery_receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.id=recheck.recovery_receipt_id;
  select candidate.* into prior_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recovery_receipt.prior_repair_job_id;
  select candidate.* into prior_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=recovery_receipt.prior_permit_id;
  select candidate.* into prior_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=recovery_receipt.prior_repair_job_id
    and candidate.result_status='reconciliation_required';
  select candidate.* into captured_relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=recheck.captured_relation_id;
  select candidate.* into captured_receipt
  from sellerpilot_private.smartstore_repair_uncertain_readback_receipts candidate
  where candidate.id=recheck.captured_receipt_id;
  select candidate.* into captured_completion
  from sellerpilot_private.smartstore_repair_uncertain_readback_completions candidate
  where candidate.job_id=recheck.captured_readback_job_id
    and candidate.claim_token=recheck.captured_readback_claim_token
    and candidate.worker_token_id=recheck.captured_readback_worker_token_id;
  select candidate.* into captured_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.captured_readback_job_id;
  select candidate.* into readback_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recheck.readback_job_id;
  select candidate.* into adoption_receipt
  from sellerpilot_private.smartstore_manual_adoption_receipts candidate
  where candidate.id=bridge.adoption_receipt_id;
  select candidate.* into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations candidate
  where candidate.id=bridge.attestation_id;
  select candidate.* into listing from sellerpilot_private.product_listings candidate
  where candidate.id=recheck.listing_id;

  return bridge.recheck_id is not null and bridge.result_status='verified'
    and not bridge.provider_mutation_performed and bridge.content_verified
    and bridge.readback_sha256=attestation.official_readback_sha256
    and bridge.adoption_receipt_id=attestation.receipt_id
    and adoption_receipt.id=bridge.adoption_receipt_id
    and adoption_receipt.source_job_id=source_job.id
    and attestation.id=bridge.attestation_id
    and attestation.source_job_id=source_job.id
    and attestation.source_attempt_id=source_attempt.id
    and attestation.listing_id=recheck.listing_id
    and attestation.credential_id=recheck.credential_id
    and attestation.seller_account_key=recheck.seller_account_key
    and attestation.origin_product_no=repair_baseline.origin_product_no
    and attestation.channel_product_no=repair_baseline.channel_product_no
    and attestation.approval_import_id=repair_baseline.approval_import_id
    and attestation.approval_revision=repair_baseline.approval_revision
    and attestation.approval_content_sha256=repair_baseline.approval_content_sha256
    and attestation.approved_manifest_digest=repair_baseline.approved_manifest_digest
    and attestation.provenance='manual_adoption_verified'
    and not attestation.api_create_succeeded
    and not attestation.provider_mutation_performed
    and sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id)
    and listing.id=recheck.listing_id and listing.owner_id=recheck.owner_id
    and listing.product_id=recheck.product_id and listing.channel_key='smartstore'
    and listing.remote_id=attestation.origin_product_no
    and listing.marketplace_sku=attestation.seller_sku
    and listing.seller_account_key=attestation.seller_account_key
    and repair_job.id=recheck.repair_job_id
    and repair_job.status='reconciliation_required'
    and repair_job.provider_mutation_started_at is not null
    and repair_permit.id=recheck.repair_permit_id
    and repair_permit.repair_job_id=repair_job.id
    and repair_permit.consumed_at is not null
    and repair_permit.verification_job_id is null
    and repair_completion.job_id=repair_job.id
    and repair_completion.result_status='reconciliation_required'
    and repair_completion.readback_sha256 is null
    and repair_completion.verification_job_id is null
    and recovery_receipt.id=recheck.recovery_receipt_id
    and recovery_receipt.prior_repair_job_id=prior_job.id
    and recovery_receipt.prior_permit_id=prior_permit.id
    and recovery_receipt.after_baseline_id=repair_baseline.id
    and recovery_receipt.product_body_unchanged
    and recovery_receipt.provider_media_upload_may_have_occurred
    and prior_job.id is not null and prior_job.status='reconciliation_required'
    and prior_job.provider_mutation_started_at is not null
    and prior_permit.id=recovery_receipt.prior_permit_id
    and prior_permit.repair_job_id=prior_job.id
    and prior_permit.consumed_at is not null
    and prior_completion.job_id=prior_job.id
    and prior_completion.result_status='reconciliation_required'
    and prior_completion.readback_sha256 is null
    and prior_completion.verification_job_id is null
    and recovery_receipt.prior_repair_job_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(prior_job))
    and recovery_receipt.prior_permit_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(prior_permit))
    and recovery_receipt.prior_completion_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(prior_completion))
    and captured_relation.id=recheck.captured_relation_id
    and captured_receipt.id=recheck.captured_receipt_id
    and captured_receipt.relation_id=captured_relation.id
    and captured_receipt.official_readback_sha256=recheck.captured_readback_sha256
    and captured_completion.job_id=captured_receipt.readback_job_id
    and captured_completion.result_status='captured'
    and captured_completion.evidence_receipt_id=captured_receipt.id
    and captured_job.id=captured_receipt.readback_job_id
    and captured_job.status='reconciliation_required'
    and captured_job.provider_mutation_started_at is null
    and readback_job.id=recheck.readback_job_id
    and readback_job.status='succeeded'
    and readback_job.provider_mutation_started_at is null
    and readback_job.response_payload#>>'{verificationStatus}'='verified'
    and recheck.source_job_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(source_job))
    and recheck.source_attempt_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
    and recheck.repair_job_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_job))
    and recheck.repair_permit_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_permit))
    and recheck.repair_completion_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_completion))
    and recheck.repair_baseline_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(repair_baseline))
    and recheck.recovery_receipt_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(recovery_receipt))
    and recheck.captured_relation_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(captured_relation))
    and recheck.captured_receipt_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(captured_receipt))
    and recheck.captured_completion_snapshot_sha256=sellerpilot_private.external_detail_hash(to_jsonb(captured_completion));
exception when others then return false;
end;
$$;
revoke all on function sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.listing_mutation_reconciliation_resolved(
  p_job_id uuid
)
returns boolean language sql stable security definer
set search_path='' set timezone='UTC' as $$
  select sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(p_job_id)
      or sellerpilot_private.temu_safe_test_source_reconciliation_resolved(p_job_id)
      or sellerpilot_private.unstarted_listing_create_reconciliation_resolved(p_job_id)
      or sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(p_job_id)
      or sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(p_job_id)
      or sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(p_job_id)
$$;
revoke all on function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

do $smartstore_scoped_gate_patch$
declare
  procedure_name regprocedure;
  definition text;
  before_fragment constant text :=
    'not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(job.id)';
  after_fragment constant text :=
    'not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)';
  hit_count integer;
begin
  foreach procedure_name in array array[
    'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure,
    'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
  ] loop
    definition:=pg_catalog.pg_get_functiondef(procedure_name);
    select (
      pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,before_fragment,''))
    )/pg_catalog.length(before_fragment) into hit_count;
    if hit_count<>1 or pg_catalog.strpos(definition,after_fragment)>0 then
      raise exception 'SMARTSTORE_REPAIR_ADOPTION_GATE_PREIMAGE_DRIFT';
    end if;
    execute pg_catalog.replace(definition,before_fragment,after_fragment);
  end loop;
end;
$smartstore_scoped_gate_patch$;

alter function public.sellerpilot_service_get_smartstore_content_repair_status(
  uuid,uuid
) rename to sellerpilot_175400_get_smartstore_repair_status_pre_recheck;
revoke all on function public.sellerpilot_175400_get_smartstore_repair_status_pre_recheck(
  uuid,uuid
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_smartstore_content_repair_status(
  p_actor uuid,p_product_id uuid
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  bridge sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
begin
  select candidate.* into bridge
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  join sellerpilot_private.smartstore_repair_adoption_rechecks session
    on session.id=candidate.recheck_id
  where session.owner_id=p_actor and session.product_id=p_product_id
    and candidate.result_status='verified'
  order by candidate.created_at desc limit 1;
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=bridge.recheck_id;
  if bridge.recheck_id is not null
     and sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(
       recheck.repair_job_id
     ) then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','verified','reason','POST_REPAIR_REMOTE_STATE_VERIFIED',
      'jobId',recheck.repair_job_id,'verificationJobId',recheck.readback_job_id,
      'baselineId',recheck.repair_baseline_id,'productId',recheck.product_id,
      'listingId',recheck.listing_id,'reused',true,
      'contentVerified',true,'providerMutationPerformed',false,
      'normalUpdateEligible',true
    );
  end if;
  return public.sellerpilot_175400_get_smartstore_repair_status_pre_recheck(
    p_actor,p_product_id
  );
end;
$$;
revoke all on function public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  to service_role;

do $verify$
declare
  index_definition text;
  completion_definition text;
  matcher_definition text;
  resolver_definition text;
  status_definition text;
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into index_definition
  from pg_catalog.pg_index
  where indexrelid=
    'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  completion_definition:=pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'::regprocedure
  );
  matcher_definition:=pg_catalog.pg_get_functiondef(
    'sellerpilot_private.smartstore_manual_adoption_readback_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  );
  resolver_definition:=pg_catalog.pg_get_functiondef(
    'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure
  );
  status_definition:=pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)'::regprocedure
  );
  if index_definition is null
     or pg_catalog.strpos(index_definition,'smartstore_repair_adoption_recheck_v1')=0
     or pg_catalog.strpos(completion_definition,'smartstore_repair_adoption_rechecks')=0
     or pg_catalog.strpos(completion_definition,'protectedBodySha256')=0
     or pg_catalog.strpos(matcher_definition,'smartstore_repair_adoption_recheck_job_matches')=0
     or pg_catalog.strpos(resolver_definition,'smartstore_repair_adoption_reconciliation_resolved')=0
     or pg_catalog.strpos(status_definition,'POST_REPAIR_REMOTE_STATE_VERIFIED')=0
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_175400_complete_smartstore_readback_pre_recheck(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_175400_get_smartstore_repair_status_pre_recheck(uuid,uuid)'
     ) is null
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'SMARTSTORE_REPAIR_ADOPTION_RECHECK_POSTCONDITION_FAILED';
  end if;
end;
$verify$;

comment on table sellerpilot_private.smartstore_repair_adoption_rechecks
  is 'Immutable binding for one fresh fixed-gateway SmartStore readback that may verify an already-applied uncertain content repair. It grants no provider mutation.';
comment on table sellerpilot_private.smartstore_repair_adoption_recheck_completions
  is 'Immutable atomic bridge from a fresh official readback to the existing strict manual-adoption receipt and attestation. It records providerMutationPerformed=false for this read-only recheck.';
comment on function public.sellerpilot_service_enqueue_smartstore_adoption_recheck(uuid,uuid)
  is 'Queues one fixed-gateway read-only SmartStore verification for an immutable uncertain repair capture. Repeated calls reuse the same job and never enqueue a provider write.';
comment on function public.sellerpilot_service_get_smartstore_adoption_recheck(uuid,uuid)
  is 'Returns safe state and evidence identifiers for the one read-only post-repair adoption recheck; raw provider responses remain private.';

notify pgrst, 'reload schema';

commit;
