-- Add one immutable GET-only successor for a rejected SmartStore adoption
-- recheck. The predecessor job and completion remain reconciliation evidence;
-- neither a provider PUT nor a CREATE is available through this contract.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908084220);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_adoption_rechecks'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_adoption_recheck_completions'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_adoption_recheck_claim_allowed(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(uuid,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_prepare_smartstore_manual_adoption(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_current_approved_manifest(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_approval_revision_is_current(uuid,bigint,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)'
     ) is null then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_DEPENDENCY_MISSING'
      using errcode='55000';
  end if;
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_adoption_recheck_successors'
     ) is not null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_adoption_recheck_successor_receipts'
     ) is not null then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_ALREADY_EXISTS'
      using errcode='55000';
  end if;
end;
$dependencies$;

create table sellerpilot_private.smartstore_adoption_recheck_successors (
  id uuid primary key,
  contract_version smallint not null default 1 check (contract_version=1),
  requested_by uuid not null references auth.users(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key~'^[a-f0-9]{64}$'),
  source_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  predecessor_recheck_id uuid not null unique
    references sellerpilot_private.smartstore_repair_adoption_rechecks(id) on delete restrict,
  predecessor_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  predecessor_completion_fingerprint text not null
    check (predecessor_completion_fingerprint~'^[a-f0-9]{64}$'),
  repair_baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  origin_product_no text not null check (origin_product_no~'^[1-9][0-9]{5,19}$'),
  channel_product_no text not null check (channel_product_no~'^[1-9][0-9]{5,19}$'),
  seller_sku text not null check (
    length(trim(seller_sku)) between 1 and 100 and seller_sku!~'[[:cntrl:]]'
  ),
  approval_revision bigint not null check (approval_revision>0),
  approval_content_sha256 text not null check (approval_content_sha256~'^[a-f0-9]{64}$'),
  approved_manifest_digest text not null check (approved_manifest_digest~'^[a-f0-9]{64}$'),
  predecessor_recheck_snapshot_sha256 text not null
    check (predecessor_recheck_snapshot_sha256~'^[a-f0-9]{64}$'),
  predecessor_job_snapshot_sha256 text not null
    check (predecessor_job_snapshot_sha256~'^[a-f0-9]{64}$'),
  predecessor_completion_snapshot_sha256 text not null
    check (predecessor_completion_snapshot_sha256~'^[a-f0-9]{64}$'),
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id)
    on delete restrict deferrable initially deferred,
  readback_request_sha256 text not null check (readback_request_sha256~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id,product_id,approval_revision)
);

create index smartstore_adoption_recheck_successors_product_idx
  on sellerpilot_private.smartstore_adoption_recheck_successors
  (product_id,created_at desc,id desc);

alter table sellerpilot_private.smartstore_adoption_recheck_successors
  enable row level security;
revoke all on sellerpilot_private.smartstore_adoption_recheck_successors
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_adoption_recheck_successor_receipts (
  successor_id uuid not null unique
    references sellerpilot_private.smartstore_adoption_recheck_successors(id) on delete restrict,
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  completion_fingerprint text not null check (completion_fingerprint~'^[a-f0-9]{64}$'),
  result_status text not null check (result_status in ('verified','reconciliation_required')),
  official_readback_sha256 text check (
    official_readback_sha256 is null or official_readback_sha256~'^[a-f0-9]{64}$'
  ),
  adoption_receipt_id uuid
    references sellerpilot_private.smartstore_manual_adoption_receipts(id) on delete restrict,
  attestation_id uuid
    references sellerpilot_private.smartstore_manual_adoption_attestations(id) on delete restrict,
  provider_mutation_performed boolean not null check (not provider_mutation_performed),
  content_verified boolean not null,
  reason text not null check (length(reason) between 1 and 160),
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id,claim_token),
  check (
    (result_status='verified' and official_readback_sha256 is not null
      and adoption_receipt_id is not null and attestation_id is not null
      and content_verified)
    or
    (result_status='reconciliation_required' and official_readback_sha256 is null
      and adoption_receipt_id is null and attestation_id is null
      and not content_verified)
  )
);

alter table sellerpilot_private.smartstore_adoption_recheck_successor_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_adoption_recheck_successor_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_adoption_successor_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_EVIDENCE_IMMUTABLE'
    using errcode='55000';
end;
$$;
revoke all on function sellerpilot_private.guard_smartstore_adoption_successor_evidence()
  from public, anon, authenticated, service_role;
create trigger smartstore_adoption_recheck_successors_immutable
before update or delete on sellerpilot_private.smartstore_adoption_recheck_successors
for each row execute function sellerpilot_private.guard_smartstore_adoption_successor_evidence();
create trigger smartstore_adoption_recheck_successor_receipts_immutable
before update or delete on sellerpilot_private.smartstore_adoption_recheck_successor_receipts
for each row execute function sellerpilot_private.guard_smartstore_adoption_successor_evidence();

-- This predicate is deliberately structural and immutable because it is used
-- by the shared active-lineage index. Exact table/current checks belong to the
-- claim predicate below and cannot be bypassed through the base matcher.
create function sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean language plpgsql immutable parallel safe set search_path='' as $$
declare stripped sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  if p_job.request_payload->>'sellerpilotSmartstoreAdoptionRecheckSuccessorId'
       !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_job.request_payload,
       array[
         'sellerpilotLineageVersion','arguments',
         'sellerpilotSmartstoreAdoptionRecheckSuccessorId'
       ]
     ) then
    return false;
  end if;
  stripped:=p_job;
  stripped.request_payload:=p_job.request_payload
    -'sellerpilotSmartstoreAdoptionRecheckSuccessorId';
  return sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
    stripped
  );
exception when others then
  return false;
end;
$$;
revoke all on function
  sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_adoption_recheck_successor_is_current(
  p_successor_id uuid
)
returns boolean language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  predecessor sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  predecessor_job sellerpilot_private.channel_gateway_jobs%rowtype;
  predecessor_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  product sellerpilot_private.products%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  manifest jsonb;
begin
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.id=p_successor_id;
  select candidate.* into predecessor
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=successor.predecessor_recheck_id;
  select candidate.* into predecessor_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.predecessor_job_id;
  select candidate.* into predecessor_completion
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  where candidate.recheck_id=predecessor.id;
  select candidate.* into readback_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.readback_job_id;
  select candidate.* into product from sellerpilot_private.products candidate
  where candidate.id=successor.product_id;
  select candidate.* into listing from sellerpilot_private.product_listings candidate
  where candidate.id=successor.listing_id;
  select candidate.* into credential from sellerpilot_private.channel_credentials candidate
  where candidate.id=successor.credential_id;
  select candidate.* into source_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.source_job_id;
  select candidate.* into source_attempt
  from sellerpilot_private.channel_operation_attempts candidate
  where candidate.id=successor.source_attempt_id;
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=successor.repair_baseline_id;
  manifest:=sellerpilot_private.smartstore_current_approved_manifest(
    product.external_detail_import_id
  );
  return successor.id is not null and successor.contract_version=1
    and predecessor.id=successor.predecessor_recheck_id
    and predecessor.readback_job_id=successor.predecessor_job_id
    and predecessor_job.id=successor.predecessor_job_id
    and predecessor_job.status='reconciliation_required'
    and predecessor_job.provider_mutation_started_at is null
    and predecessor_completion.recheck_id=predecessor.id
    and predecessor_completion.result_status='reconciliation_required'
    and predecessor_completion.reason='ADOPTION_RECHECK_COMMIT_REJECTED'
    and predecessor_completion.readback_sha256 is null
    and predecessor_completion.adoption_receipt_id is null
    and predecessor_completion.attestation_id is null
    and successor.predecessor_completion_fingerprint
      =predecessor_completion.completion_fingerprint
    and successor.predecessor_recheck_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(predecessor))
    and successor.predecessor_job_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(predecessor_job))
    and successor.predecessor_completion_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(predecessor_completion))
    and product.id=successor.product_id and product.owner_id=successor.owner_id
    and not product.demo and product.status<>'archived'
    and listing.id=successor.listing_id and listing.product_id=product.id
    and listing.owner_id=successor.owner_id and listing.channel_key='smartstore'
    and listing.status='failed' and listing.remote_id is null
    and credential.id=successor.credential_id
    and credential.channel='smartstore' and credential.environment='production'
    and credential.status='active'
    and (credential.expires_at is null or credential.expires_at>clock_timestamp())
    and credential.seller_account_key=successor.seller_account_key
    and credential.seller_account_key_source in (
      'provider_certified_v1','credential_incarnation_v1'
    )
    and source_job.id=successor.source_job_id
    and source_job.created_by=readback_job.created_by
    and exists (
      select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=successor.requested_by
    )
    and exists (
      select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=source_job.created_by
    )
    and source_attempt.id=successor.source_attempt_id
    and source_attempt.owner_id=successor.owner_id
    and baseline.id=successor.repair_baseline_id
    and baseline.owner_id=successor.owner_id
    and baseline.product_id=successor.product_id
    and baseline.listing_id=successor.listing_id
    and baseline.credential_id=successor.credential_id
    and baseline.seller_account_key=successor.seller_account_key
    and baseline.source_job_id=successor.source_job_id
    and baseline.source_attempt_id=successor.source_attempt_id
    and baseline.origin_product_no=successor.origin_product_no
    and baseline.channel_product_no=successor.channel_product_no
    and baseline.seller_sku=successor.seller_sku
    and baseline.approval_revision=successor.approval_revision
    and baseline.approval_content_sha256=successor.approval_content_sha256
    and baseline.approved_manifest_digest=successor.approved_manifest_digest
    and sellerpilot_private.external_detail_approval_revision_is_current(
      product.external_detail_import_id,successor.approval_revision,
      successor.approval_content_sha256
    )
    and manifest->>'approvalRevision'=successor.approval_revision::text
    and manifest->>'contentSha256'=successor.approval_content_sha256
    and manifest->>'digest'=successor.approved_manifest_digest
    and readback_job.id=successor.readback_job_id
    and readback_job.listing_id=successor.listing_id
    and readback_job.credential_id=successor.credential_id
    and readback_job.seller_account_key=successor.seller_account_key
    and readback_job.status in ('queued','running')
    and readback_job.provider_mutation_started_at is null
    and sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(
      readback_job
    )
    and readback_job.request_payload
      ->>'sellerpilotSmartstoreAdoptionRecheckSuccessorId'=successor.id::text
    and sellerpilot_private.external_detail_hash(readback_job.request_payload)
      =successor.readback_request_sha256
    and not exists (
      select 1
      from sellerpilot_private.smartstore_adoption_recheck_successors newer
      where newer.product_id=successor.product_id
        and (newer.created_at,newer.id)>(successor.created_at,successor.id)
    );
exception when others then
  return false;
end;
$$;
revoke all on function
  sellerpilot_private.smartstore_adoption_recheck_successor_is_current(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_adoption_recheck_successor_claim_allowed(
  p_job_id uuid,p_worker_token_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from sellerpilot_private.smartstore_adoption_recheck_successors successor
    where successor.readback_job_id=p_job_id
      and sellerpilot_private.smartstore_adoption_recheck_successor_is_current(
        successor.id
      )
      and exists (
        select 1 from sellerpilot_private.ai_cli_worker_tokens token
        where token.id=p_worker_token_id and token.scope='gateway'
          and token.status='active' and token.expires_at>clock_timestamp()
      )
  )
$$;
revoke all on function
  sellerpilot_private.smartstore_adoption_recheck_successor_claim_allowed(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean language sql immutable parallel safe set search_path='' as $$
  select case
    when p_job.request_payload?'sellerpilotSmartstoreAdoptionRecheckSuccessorId'
      then p_job.status<>'reconciliation_required'
        and sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(
          p_job
        )
    when p_job.request_payload?'sellerpilotSmartstoreRepairAdoptionRecheckId'
      then p_job.status<>'reconciliation_required'
        and sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(p_job)
    else sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(p_job)
  end
$$;
revoke all on function sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

-- Functional-index keys do not refresh when an immutable matcher body changes.
-- Give the new successor its own lane and rebuild from the exact installed
-- definition so predecessor/capture/default lanes are neither overwritten nor
-- accidentally merged.
do $active_lane$
declare
  definition text;
  needle constant text :=
    'WHEN sellerpilot_private.smartstore_repair_adoption_recheck_job_matches';
  replacement constant text :=
    'WHEN sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(channel_gateway_jobs) THEN ''smartstore_adoption_recheck_successor_v1''::text WHEN sellerpilot_private.smartstore_repair_adoption_recheck_job_matches';
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into definition
  from pg_catalog.pg_index
  where indexrelid=
    'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  if definition is null
     or pg_catalog.strpos(definition,
       'smartstore_adoption_recheck_successor_job_shape_matches')<>0
     or (
       pg_catalog.length(definition)
       -pg_catalog.length(pg_catalog.replace(definition,needle,''))
     )/pg_catalog.length(needle)<>1
     then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_ACTIVE_LANE_PREIMAGE_DRIFT';
  end if;
  execute 'drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx';
  execute pg_catalog.replace(definition,needle,replacement);
end;
$active_lane$;

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
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
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
      and case
        when job.request_payload?'sellerpilotSmartstoreAdoptionRecheckSuccessorId'
          then sellerpilot_private.smartstore_adoption_recheck_successor_claim_allowed(
            job.id,p_worker_token_id
          )
        when job.request_payload?'sellerpilotSmartstoreRepairAdoptionRecheckId'
          then sellerpilot_private.smartstore_repair_adoption_recheck_claim_allowed(
            job.id,p_worker_token_id
          )
        else true
      end
      and sellerpilot_private.smartstore_manual_adoption_readback_binding(job.id)
        #>>'{status}'='ready'
  )
$$;
revoke all on function sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
  uuid,uuid,uuid,text
) from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_adoption_recheck_successor_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_id text; new_id text;
begin
  new_id:=new.request_payload->>'sellerpilotSmartstoreAdoptionRecheckSuccessorId';
  if tg_op='UPDATE' then
    old_id:=old.request_payload->>'sellerpilotSmartstoreAdoptionRecheckSuccessorId';
  end if;
  if new_id is null and old_id is null then return new; end if;
  if new_id is null
     or sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(
       new
     ) is not true
     or (tg_op='INSERT' and current_setting(
       'sellerpilot.smartstore_adoption_recheck_successor_enqueue',true
     ) is distinct from new_id)
     or (tg_op='UPDATE' and (
       old_id is distinct from new_id
       or old.request_payload is distinct from new.request_payload
       or old.listing_id is distinct from new.listing_id
       or old.credential_id is distinct from new.credential_id
       or old.seller_account_key is distinct from new.seller_account_key
       or old.created_by is distinct from new.created_by
     )) then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_JOB_INVALID';
  end if;
  return new;
end;
$$;
revoke all on function
  sellerpilot_private.guard_smartstore_adoption_recheck_successor_job()
  from public, anon, authenticated, service_role;
create trigger smartstore_adoption_recheck_successor_job_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_smartstore_adoption_recheck_successor_job();

create unique index channel_gateway_jobs_smartstore_adoption_successor_id_idx
  on sellerpilot_private.channel_gateway_jobs (
    (request_payload->>'sellerpilotSmartstoreAdoptionRecheckSuccessorId')
  ) where request_payload?'sellerpilotSmartstoreAdoptionRecheckSuccessorId';

create function sellerpilot_private.smartstore_adoption_recheck_successor_safe_state(
  p_successor_id uuid,p_reused boolean
)
returns jsonb language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  receipt sellerpilot_private.smartstore_adoption_recheck_successor_receipts%rowtype;
  state text; state_reason text;
begin
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.id=p_successor_id;
  select candidate.* into job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.readback_job_id;
  select candidate.* into receipt
  from sellerpilot_private.smartstore_adoption_recheck_successor_receipts candidate
  where candidate.successor_id=successor.id;
  if receipt.result_status='verified'
     and sellerpilot_private.smartstore_adoption_successor_reconciliation_resolved(
       successor.source_job_id
     ) then
    state:='verified'; state_reason:='EXACT_SUCCESSOR_REMOTE_STATE_VERIFIED';
  elsif receipt.result_status='verified' then
    state:='blocked'; state_reason:='EXACT_SUCCESSOR_VERIFIED_BINDING_DRIFT';
  elsif receipt.result_status='reconciliation_required' then
    state:='reconciliation_required'; state_reason:=receipt.reason;
  elsif job.status='queued' then
    state:='queued'; state_reason:='EXACT_SUCCESSOR_QUEUED';
  elsif job.status='running' then
    state:='running'; state_reason:='EXACT_SUCCESSOR_RUNNING';
  else
    state:='blocked'; state_reason:='EXACT_SUCCESSOR_NOT_CURRENT';
  end if;
  return jsonb_build_object(
    'contract','smartstore_adoption_recheck_successor_v1',
    'status',state,'reason',state_reason,'successorId',successor.id,
    'predecessorRecheckId',successor.predecessor_recheck_id,
    'predecessorJobId',successor.predecessor_job_id,
    'jobId',job.id,'productId',successor.product_id,
    'listingId',successor.listing_id,'sourceJobId',successor.source_job_id,
    'originProductNo',successor.origin_product_no,
    'channelProductNo',successor.channel_product_no,
    'approvalRevision',successor.approval_revision,
    'receiptId',receipt.adoption_receipt_id,
    'attestationId',receipt.attestation_id,
    'readbackSha256',receipt.official_readback_sha256,
    'reused',p_reused,'contentVerified',coalesce(receipt.content_verified,false),
    'providerMutationPerformed',false,
    'normalUpdateEligible',state='verified'
  );
exception when others then
  return jsonb_build_object(
    'contract','smartstore_adoption_recheck_successor_v1',
    'status','blocked','reason','EXACT_SUCCESSOR_STATE_INVALID',
    'successorId',p_successor_id,'jobId',null,'receiptId',null,
    'attestationId',null,'readbackSha256',null,'reused',p_reused,
    'contentVerified',false,'providerMutationPerformed',false,
    'normalUpdateEligible',false
  );
end;
$$;
revoke all on function
  sellerpilot_private.smartstore_adoption_recheck_successor_safe_state(uuid,boolean)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_smartstore_adoption_successor(
  p_actor uuid,p_product_id uuid
)
returns jsonb language plpgsql security definer
set search_path='' set timezone='UTC' as $$
declare
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  predecessor sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  predecessor_job sellerpilot_private.channel_gateway_jobs%rowtype;
  predecessor_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  product sellerpilot_private.products%rowtype;
  preparation jsonb;
  request_payload jsonb;
  successor_id uuid:=gen_random_uuid();
  readback_job_id uuid:=gen_random_uuid();
  prior_enqueue_guc text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin where admin.user_id=p_actor
     ) then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_ACCESS_DENIED'
      using errcode='42501';
  end if;
  select candidate.* into product from sellerpilot_private.products candidate
  where candidate.id=p_product_id and candidate.owner_id=p_actor
    and not candidate.demo and candidate.status<>'archived';
  if product.id is null then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_ACCESS_DENIED'
      using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext(
      'smartstore-adoption-successor:'||p_product_id::text
    )
  );
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if successor.id is not null then
    return sellerpilot_private.smartstore_adoption_recheck_successor_safe_state(
      successor.id,true
    );
  end if;
  select candidate.* into predecessor
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  select candidate.* into predecessor_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=predecessor.readback_job_id for share;
  select candidate.* into predecessor_completion
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  where candidate.recheck_id=predecessor.id;
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=predecessor.repair_baseline_id for share;
  select candidate.* into source_job from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=predecessor.source_job_id for share;
  select candidate.* into source_attempt
  from sellerpilot_private.channel_operation_attempts candidate
  where candidate.id=predecessor.source_attempt_id for share;
  preparation:=public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor,p_product_id
  );
  if predecessor.id is null or predecessor_job.id is null
     or predecessor_completion.recheck_id is null or baseline.id is null
     or source_job.id is null or source_attempt.id is null
     or predecessor_job.status<>'reconciliation_required'
     or predecessor_job.provider_mutation_started_at is not null
     or predecessor_completion.result_status<>'reconciliation_required'
     or predecessor_completion.reason<>'ADOPTION_RECHECK_COMMIT_REJECTED'
     or predecessor_completion.readback_sha256 is not null
     or predecessor_completion.adoption_receipt_id is not null
     or predecessor_completion.attestation_id is not null
     or baseline.owner_id<>p_actor or baseline.product_id<>p_product_id
     or preparation->>'contract'<>'smartstore_manual_adoption_prepare_v1'
     or preparation->>'status'<>'ready'
     or preparation->>'sourceJobId'<>source_job.id::text
     or preparation->>'sourceAttemptId'<>source_attempt.id::text
     or preparation->>'credentialId'<>baseline.credential_id::text
     or preparation->>'listingId'<>baseline.listing_id::text
     or preparation->>'approvalRevision'<>baseline.approval_revision::text
     or preparation->>'contentSha256'<>baseline.approval_content_sha256
     or preparation->>'manifestDigest'<>baseline.approved_manifest_digest
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
       where admin.user_id=source_job.created_by
     ) then
    return jsonb_build_object(
      'contract','smartstore_adoption_recheck_successor_v1',
      'status','blocked','reason','EXACT_SUCCESSOR_SOURCE_NOT_CURRENT',
      'successorId',null,'predecessorRecheckId',predecessor.id,
      'predecessorJobId',predecessor_job.id,'jobId',null,
      'productId',p_product_id,'listingId',baseline.listing_id,
      'receiptId',null,'attestationId',null,'readbackSha256',null,
      'reused',false,'contentVerified',false,
      'providerMutationPerformed',false,'normalUpdateEligible',false
    );
  end if;
  request_payload:=predecessor_job.request_payload
    -'sellerpilotSmartstoreRepairAdoptionRecheckId'
    ||jsonb_build_object(
      'sellerpilotSmartstoreAdoptionRecheckSuccessorId',successor_id
    );
  insert into sellerpilot_private.smartstore_adoption_recheck_successors (
    id,requested_by,owner_id,product_id,listing_id,credential_id,
    seller_account_key,source_job_id,source_attempt_id,
    predecessor_recheck_id,predecessor_job_id,
    predecessor_completion_fingerprint,repair_baseline_id,
    origin_product_no,channel_product_no,seller_sku,
    approval_revision,approval_content_sha256,approved_manifest_digest,
    predecessor_recheck_snapshot_sha256,predecessor_job_snapshot_sha256,
    predecessor_completion_snapshot_sha256,readback_job_id,
    readback_request_sha256
  ) values (
    successor_id,p_actor,baseline.owner_id,baseline.product_id,
    baseline.listing_id,baseline.credential_id,baseline.seller_account_key,
    baseline.source_job_id,baseline.source_attempt_id,
    predecessor.id,predecessor_job.id,
    predecessor_completion.completion_fingerprint,baseline.id,
    baseline.origin_product_no,baseline.channel_product_no,baseline.seller_sku,
    baseline.approval_revision,baseline.approval_content_sha256,
    baseline.approved_manifest_digest,
    sellerpilot_private.external_detail_hash(to_jsonb(predecessor)),
    sellerpilot_private.external_detail_hash(to_jsonb(predecessor_job)),
    sellerpilot_private.external_detail_hash(to_jsonb(predecessor_completion)),
    readback_job_id,sellerpilot_private.external_detail_hash(request_payload)
  ) returning * into successor;
  prior_enqueue_guc:=coalesce(current_setting(
    'sellerpilot.smartstore_adoption_recheck_successor_enqueue',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_adoption_recheck_successor_enqueue',
    successor.id::text,true
  );
  begin
    insert into sellerpilot_private.channel_gateway_jobs (
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,seller_account_key,created_by
    ) values (
      successor.readback_job_id,successor.credential_id,null,
      successor.listing_id,'smartstore','listing.lineage.verify','production',
      request_payload,successor.seller_account_key,source_job.created_by
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_adoption_recheck_successor_enqueue',
      prior_enqueue_guc,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_adoption_recheck_successor_enqueue',
    prior_enqueue_guc,true
  );
  if sellerpilot_private.smartstore_adoption_recheck_successor_is_current(
       successor.id
     ) is not true then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_BINDING_FAILED';
  end if;
  return sellerpilot_private.smartstore_adoption_recheck_successor_safe_state(
    successor.id,false
  );
end;
$$;
revoke all on function
  public.sellerpilot_service_enqueue_smartstore_adoption_successor(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_adoption_successor(uuid,uuid)
  to service_role;

create function sellerpilot_private.smartstore_adoption_recheck_successor_pixel_is_valid(
  p_source_job_id uuid,p_readback jsonb
)
returns boolean language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  successor_job_id uuid;
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  expected_pixels jsonb;
begin
  begin
    successor_job_id:=nullif(current_setting(
      'sellerpilot.smartstore_adoption_recheck_successor_job',true
    ),'')::uuid;
  exception when others then
    return false;
  end;
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.readback_job_id=successor_job_id;
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=successor.repair_baseline_id;
  if successor.id is null or baseline.id is null
     or successor.source_job_id<>p_source_job_id
     or sellerpilot_private.smartstore_adoption_recheck_successor_is_current(
       successor.id
     ) is not true
     or jsonb_typeof(baseline.approved_transport_images) is distinct from 'array'
     or jsonb_array_length(baseline.approved_transport_images)<>8 then
    return false;
  end if;
  select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
  into expected_pixels
  from jsonb_array_elements(baseline.approved_transport_images)
  with ordinality image(value,ordinal);
  return p_readback->'detailImagePixelSha256s' is not distinct from expected_pixels;
exception when others then
  return false;
end;
$$;
revoke all on function
  sellerpilot_private.smartstore_adoption_recheck_successor_pixel_is_valid(uuid,jsonb)
  from public, anon, authenticated, service_role;

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
      or sellerpilot_private.smartstore_adoption_recheck_successor_pixel_is_valid(
           p_source_job_id,p_readback
         )
$$;
revoke all on function sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(
  uuid,jsonb,jsonb
) from public, anon, authenticated, service_role;

alter function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) rename to sellerpilot_084220_complete_smartstore_readback_pre_successor;
revoke all on function public.sellerpilot_084220_complete_smartstore_readback_pre_successor(
  text,uuid,uuid,text,jsonb,text
) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_readback jsonb default null,p_error_message text default null
)
returns jsonb language plpgsql security definer
set search_path='' set timezone='UTC' as $$
declare
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  receipt sellerpilot_private.smartstore_adoption_recheck_successor_receipts%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  result jsonb;
  completion_fingerprint text;
  readback_sha text;
  prior_successor_guc text;
begin
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.readback_job_id=p_job_id;
  if successor.id is null then
    return public.sellerpilot_084220_complete_smartstore_readback_pre_successor(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
  end if;
  select candidate.* into worker
  from sellerpilot_private.ai_cli_worker_tokens candidate
  where candidate.token_hash=p_token_hash and candidate.scope='gateway';
  if worker.id is null or p_claim_token is null then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_COMPLETION_INVALID';
  end if;
  readback_sha:=case when jsonb_typeof(p_readback)='object'
    then sellerpilot_private.external_detail_hash(p_readback) else null end;
  completion_fingerprint:=sellerpilot_private.external_detail_hash(
    jsonb_build_object(
      'status',p_status,'readbackSha256',readback_sha,
      'safeError',p_error_message
    )
  );
  select candidate.* into receipt
  from sellerpilot_private.smartstore_adoption_recheck_successor_receipts candidate
  where candidate.job_id=p_job_id and candidate.claim_token=p_claim_token
    and candidate.worker_token_id=worker.id;
  if receipt.job_id is not null then
    if receipt.completion_fingerprint is distinct from completion_fingerprint then
      return jsonb_build_object(
        'contract','smartstore_manual_adoption_readback_completion_v1',
        'status','reconciliation_required','jobId',p_job_id,
        'receiptId',receipt.adoption_receipt_id,
        'attestationId',receipt.attestation_id,'baselineId',null,
        'readbackSha256',receipt.official_readback_sha256,
        'reused',true,'reason','COMPLETION_REPLAY_MISMATCH'
      );
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status',receipt.result_status,'jobId',p_job_id,
      'receiptId',receipt.adoption_receipt_id,
      'attestationId',receipt.attestation_id,'baselineId',null,
      'readbackSha256',receipt.official_readback_sha256,
      'reused',true,'reason',receipt.reason
    );
  end if;
  if p_status='succeeded'
     and sellerpilot_private.smartstore_adoption_recheck_successor_is_current(
       successor.id
     ) is not true then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','lease_lost','jobId',p_job_id,'receiptId',null,
      'attestationId',null,'baselineId',null,'readbackSha256',null,
      'reused',false,'reason','CLAIM_LEASE_LOST'
    );
  end if;
  prior_successor_guc:=coalesce(current_setting(
    'sellerpilot.smartstore_adoption_recheck_successor_job',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_adoption_recheck_successor_job',p_job_id::text,true
  );
  begin
    result:=public.sellerpilot_084220_complete_smartstore_readback_pre_successor(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_adoption_recheck_successor_job',
      prior_successor_guc,true
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_adoption_recheck_successor_job',
      prior_successor_guc,true
    );
    raise;
  end;
  if result->>'status' in ('verified','already_verified')
     and result->>'providerMutationPerformed' is distinct from 'true'
     and result->>'receiptId'~'^[0-9a-f-]{36}$'
     and result->>'attestationId'~'^[0-9a-f-]{36}$'
     and readback_sha is not null then
    insert into sellerpilot_private.smartstore_adoption_recheck_successor_receipts (
      successor_id,job_id,claim_token,worker_token_id,completion_fingerprint,
      result_status,official_readback_sha256,adoption_receipt_id,attestation_id,
      provider_mutation_performed,content_verified,reason
    ) values (
      successor.id,p_job_id,p_claim_token,worker.id,completion_fingerprint,
      'verified',readback_sha,(result->>'receiptId')::uuid,
      (result->>'attestationId')::uuid,false,true,
      'EXACT_SUCCESSOR_REMOTE_STATE_VERIFIED'
    );
  elsif result->>'status'='reconciliation_required' then
    insert into sellerpilot_private.smartstore_adoption_recheck_successor_receipts (
      successor_id,job_id,claim_token,worker_token_id,completion_fingerprint,
      result_status,official_readback_sha256,adoption_receipt_id,attestation_id,
      provider_mutation_performed,content_verified,reason
    ) values (
      successor.id,p_job_id,p_claim_token,worker.id,completion_fingerprint,
      'reconciliation_required',null,null,null,false,false,
      left(coalesce(result->>'reason','EXACT_SUCCESSOR_COMMIT_REJECTED'),160)
    );
  end if;
  return result;
end;
$$;
revoke all on function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) to service_role;

-- The ordinary adoption receipt resolves the original listing.create. This
-- exact resolver additionally links that receipt to both preserved repair
-- failures, without rewriting either failed job or its completion evidence.
create function sellerpilot_private.smartstore_adoption_successor_reconciliation_resolved(
  p_job_id uuid
)
returns boolean language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  successor_receipt sellerpilot_private.smartstore_adoption_recheck_successor_receipts%rowtype;
  predecessor sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  predecessor_job sellerpilot_private.channel_gateway_jobs%rowtype;
  predecessor_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
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
  successor_job sellerpilot_private.channel_gateway_jobs%rowtype;
  gateway_receipt sellerpilot_private.gateway_completion_receipts%rowtype;
  adoption_receipt sellerpilot_private.smartstore_manual_adoption_receipts%rowtype;
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
  product sellerpilot_private.products%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  manifest jsonb;
begin
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  join sellerpilot_private.smartstore_adoption_recheck_successor_receipts receipt
    on receipt.successor_id=candidate.id and receipt.result_status='verified'
  join sellerpilot_private.smartstore_repair_adoption_rechecks recheck
    on recheck.id=candidate.predecessor_recheck_id
  join sellerpilot_private.smartstore_content_repair_no_product_effect_receipts recovery
    on recovery.id=recheck.recovery_receipt_id
  where p_job_id in (
    candidate.source_job_id,recheck.repair_job_id,recovery.prior_repair_job_id
  )
  order by candidate.created_at desc,candidate.id desc limit 1;
  select candidate.* into successor_receipt
  from sellerpilot_private.smartstore_adoption_recheck_successor_receipts candidate
  where candidate.successor_id=successor.id;
  select candidate.* into predecessor
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=successor.predecessor_recheck_id;
  select candidate.* into predecessor_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.predecessor_job_id;
  select candidate.* into predecessor_completion
  from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
  where candidate.recheck_id=predecessor.id;
  select candidate.* into source_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.source_job_id;
  select candidate.* into source_attempt
  from sellerpilot_private.channel_operation_attempts candidate
  where candidate.id=successor.source_attempt_id;
  select candidate.* into repair_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=predecessor.repair_job_id;
  select candidate.* into repair_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=predecessor.repair_permit_id;
  select candidate.* into repair_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=predecessor.repair_job_id
    and candidate.claim_token=predecessor.repair_completion_claim_token
    and candidate.worker_token_id=predecessor.repair_completion_worker_token_id;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=successor.repair_baseline_id;
  select candidate.* into recovery_receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.id=predecessor.recovery_receipt_id;
  select candidate.* into prior_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=recovery_receipt.prior_repair_job_id;
  select candidate.* into prior_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=recovery_receipt.prior_permit_id;
  select candidate.* into prior_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=prior_job.id and candidate.result_status='reconciliation_required';
  select candidate.* into captured_relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=predecessor.captured_relation_id;
  select candidate.* into captured_receipt
  from sellerpilot_private.smartstore_repair_uncertain_readback_receipts candidate
  where candidate.id=predecessor.captured_receipt_id;
  select candidate.* into captured_completion
  from sellerpilot_private.smartstore_repair_uncertain_readback_completions candidate
  where candidate.job_id=predecessor.captured_readback_job_id
    and candidate.claim_token=predecessor.captured_readback_claim_token
    and candidate.worker_token_id=predecessor.captured_readback_worker_token_id;
  select candidate.* into captured_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=predecessor.captured_readback_job_id;
  select candidate.* into successor_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=successor.readback_job_id;
  select candidate.* into gateway_receipt
  from sellerpilot_private.gateway_completion_receipts candidate
  where candidate.job_id=successor_receipt.job_id
    and candidate.claim_token=successor_receipt.claim_token
    and candidate.worker_token_id=successor_receipt.worker_token_id;
  select candidate.* into adoption_receipt
  from sellerpilot_private.smartstore_manual_adoption_receipts candidate
  where candidate.id=successor_receipt.adoption_receipt_id;
  select candidate.* into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations candidate
  where candidate.id=successor_receipt.attestation_id;
  select candidate.* into product from sellerpilot_private.products candidate
  where candidate.id=successor.product_id;
  select candidate.* into listing from sellerpilot_private.product_listings candidate
  where candidate.id=successor.listing_id;
  select candidate.* into credential from sellerpilot_private.channel_credentials candidate
  where candidate.id=successor.credential_id;
  manifest:=sellerpilot_private.smartstore_current_approved_manifest(
    product.external_detail_import_id
  );

  return successor.id is not null and successor.contract_version=1
    and successor_receipt.successor_id=successor.id
    and successor_receipt.job_id=successor.readback_job_id
    and successor_receipt.result_status='verified'
    and not successor_receipt.provider_mutation_performed
    and successor_receipt.content_verified
    and successor_receipt.official_readback_sha256=attestation.official_readback_sha256
    and successor_receipt.adoption_receipt_id=adoption_receipt.id
    and successor_receipt.attestation_id=attestation.id
    and successor_receipt.completion_fingerprint=gateway_receipt.completion_fingerprint
    and gateway_receipt.job_id=successor_job.id
    and gateway_receipt.continuation_job_id is null
    and sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(
      successor.source_job_id
    )
    and adoption_receipt.source_job_id=successor.source_job_id
    and attestation.source_job_id=successor.source_job_id
    and attestation.source_attempt_id=successor.source_attempt_id
    and attestation.owner_id=successor.owner_id
    and attestation.product_id=successor.product_id
    and attestation.listing_id=successor.listing_id
    and attestation.credential_id=successor.credential_id
    and attestation.seller_account_key=successor.seller_account_key
    and attestation.origin_product_no=successor.origin_product_no
    and attestation.channel_product_no=successor.channel_product_no
    and attestation.seller_sku=successor.seller_sku
    and attestation.approval_revision=successor.approval_revision
    and attestation.approval_content_sha256=successor.approval_content_sha256
    and attestation.approved_manifest_digest=successor.approved_manifest_digest
    and attestation.provenance='manual_adoption_verified'
    and not attestation.api_create_succeeded
    and not attestation.provider_mutation_performed
    and successor.predecessor_recheck_id=predecessor.id
    and successor.predecessor_job_id=predecessor.readback_job_id
    and successor.predecessor_completion_fingerprint
      =predecessor_completion.completion_fingerprint
    and successor.predecessor_recheck_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(predecessor))
    and successor.predecessor_job_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(predecessor_job))
    and successor.predecessor_completion_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(predecessor_completion))
    and predecessor.generation=1
    and predecessor_job.id=predecessor.readback_job_id
    and predecessor_job.status='reconciliation_required'
    and predecessor_job.provider_mutation_started_at is null
    and predecessor_completion.recheck_id=predecessor.id
    and predecessor_completion.result_status='reconciliation_required'
    and predecessor_completion.reason='ADOPTION_RECHECK_COMMIT_REJECTED'
    and predecessor_completion.readback_sha256 is null
    and predecessor_completion.adoption_receipt_id is null
    and predecessor_completion.attestation_id is null
    and source_job.id=predecessor.source_job_id
    and source_attempt.id=predecessor.source_attempt_id
    and repair_job.id=predecessor.repair_job_id
    and repair_job.status='reconciliation_required'
    and repair_job.provider_mutation_started_at is not null
    and repair_permit.id=predecessor.repair_permit_id
    and repair_permit.repair_job_id=repair_job.id
    and repair_permit.consumed_at is not null
    and repair_permit.verification_job_id is null
    and repair_completion.job_id=repair_job.id
    and repair_completion.result_status='reconciliation_required'
    and repair_completion.readback_sha256 is null
    and repair_completion.verification_job_id is null
    and repair_baseline.id=predecessor.repair_baseline_id
    and repair_baseline.id=successor.repair_baseline_id
    and recovery_receipt.id=predecessor.recovery_receipt_id
    and recovery_receipt.prior_repair_job_id=prior_job.id
    and recovery_receipt.prior_permit_id=prior_permit.id
    and recovery_receipt.after_baseline_id=repair_baseline.id
    and recovery_receipt.product_body_unchanged
    and recovery_receipt.provider_media_upload_may_have_occurred
    and prior_job.id is not null and prior_job.status='reconciliation_required'
    and prior_job.provider_mutation_started_at is not null
    and prior_permit.repair_job_id=prior_job.id
    and prior_permit.consumed_at is not null
    and prior_completion.job_id=prior_job.id
    and prior_completion.result_status='reconciliation_required'
    and prior_completion.readback_sha256 is null
    and prior_completion.verification_job_id is null
    and recovery_receipt.prior_repair_job_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(prior_job))
    and recovery_receipt.prior_permit_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(prior_permit))
    and recovery_receipt.prior_completion_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(prior_completion))
    and captured_relation.id=predecessor.captured_relation_id
    and captured_receipt.id=predecessor.captured_receipt_id
    and captured_receipt.relation_id=captured_relation.id
    and captured_receipt.official_readback_sha256=predecessor.captured_readback_sha256
    and not captured_receipt.readback_provider_mutation_performed
    and captured_receipt.repair_mutation_outcome='unknown'
    and not captured_receipt.content_verified
    and not captured_receipt.normal_update_eligible
    and captured_completion.job_id=captured_receipt.readback_job_id
    and captured_completion.relation_id=captured_relation.id
    and captured_completion.result_status='captured'
    and captured_completion.evidence_receipt_id=captured_receipt.id
    and captured_job.id=captured_receipt.readback_job_id
    and captured_job.status='reconciliation_required'
    and captured_job.provider_mutation_started_at is null
    and predecessor.source_job_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(source_job))
    and predecessor.source_attempt_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
    and predecessor.repair_job_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(repair_job))
    and predecessor.repair_permit_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(repair_permit))
    and predecessor.repair_completion_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(repair_completion))
    and predecessor.repair_baseline_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(repair_baseline))
    and predecessor.recovery_receipt_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(recovery_receipt))
    and predecessor.captured_relation_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(captured_relation))
    and predecessor.captured_receipt_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(captured_receipt))
    and predecessor.captured_completion_snapshot_sha256
      =sellerpilot_private.external_detail_hash(to_jsonb(captured_completion))
    and product.id=successor.product_id and product.owner_id=successor.owner_id
    and not product.demo and product.status<>'archived'
    and listing.id=successor.listing_id and listing.owner_id=successor.owner_id
    and listing.product_id=successor.product_id and listing.channel_key='smartstore'
    and listing.remote_id=successor.origin_product_no
    and listing.marketplace_sku=successor.seller_sku
    and listing.seller_account_key=successor.seller_account_key
    and credential.id=successor.credential_id
    and credential.channel='smartstore' and credential.environment='production'
    and credential.status='active'
    and (credential.expires_at is null or credential.expires_at>clock_timestamp())
    and credential.seller_account_key=successor.seller_account_key
    and exists (select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=successor.requested_by)
    and exists (select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=source_job.created_by)
    and repair_baseline.owner_id=successor.owner_id
    and repair_baseline.product_id=successor.product_id
    and repair_baseline.listing_id=successor.listing_id
    and repair_baseline.credential_id=successor.credential_id
    and repair_baseline.seller_account_key=successor.seller_account_key
    and repair_baseline.source_job_id=successor.source_job_id
    and repair_baseline.source_attempt_id=successor.source_attempt_id
    and repair_baseline.origin_product_no=successor.origin_product_no
    and repair_baseline.channel_product_no=successor.channel_product_no
    and repair_baseline.seller_sku=successor.seller_sku
    and repair_baseline.approval_revision=successor.approval_revision
    and repair_baseline.approval_content_sha256=successor.approval_content_sha256
    and repair_baseline.approved_manifest_digest=successor.approved_manifest_digest
    and sellerpilot_private.external_detail_approval_revision_is_current(
      product.external_detail_import_id,successor.approval_revision,
      successor.approval_content_sha256
    )
    and manifest->>'approvalRevision'=successor.approval_revision::text
    and manifest->>'contentSha256'=successor.approval_content_sha256
    and manifest->>'digest'=successor.approved_manifest_digest
    and successor_job.id=successor.readback_job_id
    and successor_job.status='succeeded'
    and successor_job.provider_mutation_started_at is null
    and successor_job.created_by=source_job.created_by
    and successor_job.listing_id=successor.listing_id
    and successor_job.credential_id=successor.credential_id
    and successor_job.seller_account_key=successor.seller_account_key
    and successor_job.request_payload
      ->>'sellerpilotSmartstoreAdoptionRecheckSuccessorId'=successor.id::text
    and sellerpilot_private.smartstore_adoption_recheck_successor_job_shape_matches(
      successor_job
    )
    and sellerpilot_private.external_detail_hash(successor_job.request_payload)
      =successor.readback_request_sha256
    and not exists (
      select 1 from sellerpilot_private.smartstore_adoption_recheck_successors newer
      where newer.product_id=successor.product_id
        and (newer.created_at,newer.id)>(successor.created_at,successor.id)
    );
exception when others then return false;
end;
$$;
revoke all on function
  sellerpilot_private.smartstore_adoption_successor_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

alter function sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(
  uuid
) rename to sellerpilot_084220_repair_adoption_resolved_pre_successor;
revoke all on function
  sellerpilot_private.sellerpilot_084220_repair_adoption_resolved_pre_successor(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(
  p_job_id uuid
)
returns boolean language sql stable security definer
set search_path='' set timezone='UTC' as $$
  select sellerpilot_private.sellerpilot_084220_repair_adoption_resolved_pre_successor(
           p_job_id
         )
      or sellerpilot_private.smartstore_adoption_successor_reconciliation_resolved(
           p_job_id
         )
$$;
revoke all on function
  sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_get_smartstore_content_repair_status(
  uuid,uuid
) rename to sellerpilot_084220_get_smartstore_repair_pre_successor;
revoke all on function
  public.sellerpilot_084220_get_smartstore_repair_pre_successor(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_smartstore_content_repair_status(
  p_actor uuid,p_product_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  prior_state jsonb;
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
  predecessor sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
begin
  prior_state:=public.sellerpilot_084220_get_smartstore_repair_pre_successor(
    p_actor,p_product_id
  );
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  select candidate.* into predecessor
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.id=successor.predecessor_recheck_id;
  if successor.id is not null
     and sellerpilot_private.smartstore_adoption_successor_reconciliation_resolved(
       predecessor.repair_job_id
     ) then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','verified','reason','EXACT_SUCCESSOR_REMOTE_STATE_VERIFIED',
      'jobId',predecessor.repair_job_id,
      'verificationJobId',successor.readback_job_id,
      'successorId',successor.id,
      'predecessorRecheckId',predecessor.id,
      'baselineId',successor.repair_baseline_id,
      'productId',successor.product_id,'listingId',successor.listing_id,
      'reused',true,'contentVerified',true,
      'providerMutationPerformed',false,'normalUpdateEligible',true
    );
  end if;
  return prior_state;
end;
$$;
revoke all on function public.sellerpilot_service_get_smartstore_content_repair_status(
  uuid,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_smartstore_content_repair_status(
  uuid,uuid
) to service_role;

create or replace function public.sellerpilot_service_get_smartstore_adoption_recheck(
  p_actor uuid,p_product_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path='' set timezone='UTC' as $$
declare
  successor sellerpilot_private.smartstore_adoption_recheck_successors%rowtype;
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
  select candidate.* into successor
  from sellerpilot_private.smartstore_adoption_recheck_successors candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if successor.id is not null then
    return sellerpilot_private.smartstore_adoption_recheck_successor_safe_state(
      successor.id,true
    );
  end if;
  select candidate.* into recheck
  from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if recheck.id is null then
    return jsonb_build_object(
      'contract','smartstore_repair_adoption_recheck_v1',
      'status','blocked','reason','ADOPTION_RECHECK_NOT_FOUND',
      'jobId',null,'recheckId',null,'productId',p_product_id,
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

do $postcheck$
declare
  matcher_definition text;
  claim_definition text;
  completion_definition text;
  resolver_definition text;
  repair_status_definition text;
begin
  matcher_definition:=pg_catalog.pg_get_functiondef(
    'sellerpilot_private.smartstore_manual_adoption_readback_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  );
  claim_definition:=pg_catalog.pg_get_functiondef(
    'sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(uuid,uuid,uuid,text)'::regprocedure
  );
  completion_definition:=pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'::regprocedure
  );
  resolver_definition:=pg_catalog.pg_get_functiondef(
    'sellerpilot_private.smartstore_repair_adoption_reconciliation_resolved(uuid)'::regprocedure
  );
  repair_status_definition:=pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)'::regprocedure
  );
  if pg_catalog.strpos(
       matcher_definition,'smartstore_adoption_recheck_successor_job_shape_matches'
     )=0
     or pg_catalog.strpos(
       claim_definition,'smartstore_adoption_recheck_successor_claim_allowed'
     )=0
     or pg_catalog.strpos(
       completion_definition,'smartstore_adoption_recheck_successor_receipts'
     )=0
     or pg_catalog.strpos(
       resolver_definition,'smartstore_adoption_successor_reconciliation_resolved'
     )=0
     or pg_catalog.strpos(
       repair_status_definition,'EXACT_SUCCESSOR_REMOTE_STATE_VERIFIED'
     )=0 then
    raise exception 'SMARTSTORE_ADOPTION_SUCCESSOR_POSTIMAGE_DRIFT';
  end if;
end;
$postcheck$;

comment on table sellerpilot_private.smartstore_adoption_recheck_successors is
  'Immutable exact predecessor and GET-only successor binding. No provider mutation permission is represented.';
comment on table sellerpilot_private.smartstore_adoption_recheck_successor_receipts is
  'Immutable result of one exact successor readback; successful rows point to the normal adoption receipt and attestation.';
comment on function
  public.sellerpilot_service_enqueue_smartstore_adoption_successor(uuid,uuid) is
  'Queues one exact GET-only successor for the latest rejected adoption recheck. It never requeues the predecessor or calls a provider mutation.';

notify pgrst, 'reload schema';

commit;
