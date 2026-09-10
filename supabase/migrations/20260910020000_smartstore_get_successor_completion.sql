-- Create an explicit, GET-only successor for the one rejected SmartStore
-- adoption recheck. The migration installs contracts only: it never enqueues
-- a job, calls Naver, changes a listing, or rewrites the rejected lineage.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(193674993, 910020000);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_adoption_rechecks'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_adoption_recheck_completions'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.gateway_completion_receipts'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_adoption_recheck_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_binding(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_official_identity(jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(uuid,uuid,uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'
     ) is null then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create table sellerpilot_private.smartstore_get_successors (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  operator_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (credential_fingerprint ~ '^[A-Fa-f0-9]{12}$'),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  seller_sku text not null check (
    length(trim(seller_sku)) between 1 and 100
    and seller_sku !~ '[[:cntrl:]]'
  ),
  origin_product_no text not null check (origin_product_no = '13688607602'),
  channel_product_no text not null check (channel_product_no = '13749310594'),
  source_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  repair_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  repair_baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id)
    on delete restrict,
  recovery_receipt_id uuid not null
    references sellerpilot_private.smartstore_content_repair_no_product_effect_receipts(id)
    on delete restrict,
  prior_recheck_id uuid not null unique
    references sellerpilot_private.smartstore_repair_adoption_rechecks(id)
    on delete restrict,
  prior_readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  prior_completion_claim_token uuid not null,
  prior_completion_worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  approval_revision bigint not null check (approval_revision > 0),
  approval_content_sha256 text not null check (approval_content_sha256 ~ '^[a-f0-9]{64}$'),
  approved_manifest_digest text not null check (approved_manifest_digest ~ '^[a-f0-9]{64}$'),
  preparation_sha256 text not null check (preparation_sha256 ~ '^[a-f0-9]{64}$'),
  prior_recheck_snapshot_sha256 text not null check (prior_recheck_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  prior_job_snapshot_sha256 text not null check (prior_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  prior_completion_snapshot_sha256 text not null check (prior_completion_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_job_snapshot_sha256 text not null check (source_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_attempt_snapshot_sha256 text not null check (source_attempt_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_listing_snapshot_sha256 text not null check (source_listing_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  readback_request_sha256 text not null check (readback_request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (owner_id, product_id)
);

create table sellerpilot_private.smartstore_get_successor_receipts (
  successor_id uuid not null unique
    references sellerpilot_private.smartstore_get_successors(id) on delete restrict,
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  result_status text not null check (result_status in ('verified','reconciliation_required')),
  reason text not null check (length(reason) between 1 and 160),
  raw_official_readback jsonb,
  raw_official_readback_sha256 text check (
    raw_official_readback_sha256 is null
    or raw_official_readback_sha256 ~ '^[a-f0-9]{64}$'
  ),
  derived_commit_readback_sha256 text check (
    derived_commit_readback_sha256 is null
    or derived_commit_readback_sha256 ~ '^[a-f0-9]{64}$'
  ),
  adoption_receipt_id uuid
    references sellerpilot_private.smartstore_manual_adoption_receipts(id) on delete restrict,
  attestation_id uuid
    references sellerpilot_private.smartstore_manual_adoption_attestations(id) on delete restrict,
  provider_mutation_performed boolean not null check (not provider_mutation_performed),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (job_id, claim_token),
  check (
    (result_status = 'verified'
      and raw_official_readback is not null
      and raw_official_readback_sha256 is not null
      and derived_commit_readback_sha256 is not null
      and adoption_receipt_id is not null
      and attestation_id is not null)
    or
    (result_status = 'reconciliation_required'
      and adoption_receipt_id is null
      and attestation_id is null)
  )
);

alter table sellerpilot_private.smartstore_get_successors enable row level security;
alter table sellerpilot_private.smartstore_get_successor_receipts enable row level security;
revoke all on sellerpilot_private.smartstore_get_successors
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.smartstore_get_successor_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_get_successor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT'
     or not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or current_setting('sellerpilot.smartstore_get_successor_insert', true)
          is distinct from new.id::text then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_EVIDENCE_IMMUTABLE'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_get_successor()
  from public, anon, authenticated, service_role;
create trigger smartstore_get_successors_immutable
before insert or update or delete
on sellerpilot_private.smartstore_get_successors
for each row execute function
  sellerpilot_private.guard_smartstore_get_successor();

create function sellerpilot_private.guard_smartstore_get_successor_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT'
     or not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or current_setting('sellerpilot.smartstore_get_successor_insert', true)
          is distinct from new.successor_id::text then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_EVIDENCE_IMMUTABLE'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_get_successor_receipt()
  from public, anon, authenticated, service_role;
create trigger smartstore_get_successor_receipts_immutable
before insert or update or delete
on sellerpilot_private.smartstore_get_successor_receipts
for each row execute function
  sellerpilot_private.guard_smartstore_get_successor_receipt();

create function sellerpilot_private.smartstore_get_successor_job_shape_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  stripped sellerpilot_private.channel_gateway_jobs%rowtype;
  successor_id text;
begin
  successor_id := p_job.request_payload->>'sellerpilotSmartstoreGetSuccessorId';
  if successor_id is null
     or successor_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_job.request_payload,
       array[
         'arguments','sellerpilotLineageVersion',
         'sellerpilotSmartstoreGetSuccessorId'
       ]
     ) then
    return false;
  end if;
  stripped := p_job;
  stripped.request_payload := p_job.request_payload
    - 'sellerpilotSmartstoreGetSuccessorId';
  return sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
    stripped
  );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_get_successor_job_shape_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_get_successor_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.smartstore_get_successors successor
     where successor.readback_job_id = p_job.id
       and p_job.request_payload->>'sellerpilotSmartstoreGetSuccessorId'
             = successor.id::text
       and successor.operator_id = p_job.created_by
       and successor.listing_id = p_job.listing_id
       and successor.credential_id = p_job.credential_id
       and successor.seller_account_key = p_job.seller_account_key
       and sellerpilot_private.smartstore_get_successor_job_shape_matches(
         p_job
       )
       and sellerpilot_private.external_detail_hash(p_job.request_payload)
             = successor.readback_request_sha256
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_get_successor_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_get_successor_is_current(
  p_successor_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  successor sellerpilot_private.smartstore_get_successors%rowtype;
  prior_recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  prior_job sellerpilot_private.channel_gateway_jobs%rowtype;
  prior_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  preparation jsonb;
begin
  select candidate.* into successor
    from sellerpilot_private.smartstore_get_successors candidate
   where candidate.id = p_successor_id;
  select candidate.* into prior_recheck
    from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
   where candidate.id = successor.prior_recheck_id;
  select candidate.* into prior_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = successor.prior_readback_job_id;
  select candidate.* into prior_completion
    from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
   where candidate.recheck_id = prior_recheck.id
     and candidate.job_id = prior_job.id
     and candidate.claim_token = successor.prior_completion_claim_token
     and candidate.worker_token_id = successor.prior_completion_worker_token_id;
  select candidate.* into source_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = successor.source_job_id;
  select candidate.* into source_attempt
    from sellerpilot_private.channel_operation_attempts candidate
   where candidate.id = successor.source_attempt_id;
  select candidate.* into listing
    from sellerpilot_private.product_listings candidate
   where candidate.id = successor.listing_id;
  select candidate.* into product
    from sellerpilot_private.products candidate
   where candidate.id = successor.product_id;
  select candidate.* into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = successor.credential_id;
  select candidate.* into readback_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = successor.readback_job_id;
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    successor.owner_id, successor.product_id
  );

  return successor.id is not null
    and successor.origin_product_no = '13688607602'
    and successor.channel_product_no = '13749310594'
    and prior_recheck.id = successor.prior_recheck_id
    and prior_recheck.readback_job_id = prior_job.id
    and prior_job.id = successor.prior_readback_job_id
    and prior_job.status = 'reconciliation_required'
    and prior_job.provider_mutation_started_at is null
    and prior_completion.job_id = prior_job.id
    and prior_completion.result_status = 'reconciliation_required'
    and prior_completion.readback_sha256 is null
    and prior_completion.adoption_receipt_id is null
    and prior_completion.attestation_id is null
    and not prior_completion.provider_mutation_performed
    and sellerpilot_private.smartstore_repair_adoption_recheck_is_current(
      prior_recheck.id
    )
    and source_job.id = successor.source_job_id
    and source_attempt.id = successor.source_attempt_id
    and source_job.attempt_id = source_attempt.id
    and source_job.listing_id = successor.listing_id
    and source_job.credential_id = successor.credential_id
    and source_job.created_by = successor.operator_id
    and source_job.seller_account_key = successor.seller_account_key
    and listing.id = successor.listing_id
    and listing.owner_id = successor.owner_id
    and listing.product_id = successor.product_id
    and listing.channel_key = 'smartstore'
    and product.id = successor.product_id
    and product.owner_id = successor.owner_id
    and product.sku = successor.seller_sku
    and credential.id = successor.credential_id
    and credential.created_by = successor.operator_id
    and exists (
      select 1
        from sellerpilot_private.admin_users admin
       where admin.user_id = successor.operator_id
    )
    and credential.channel = 'smartstore'
    and credential.environment = 'production'
    and credential.status = 'active'
    and (credential.expires_at is null
      or credential.expires_at > pg_catalog.clock_timestamp())
    and credential.version = successor.credential_version
    and credential.fingerprint = successor.credential_fingerprint
    and credential.seller_account_key = successor.seller_account_key
    and credential.seller_account_key_source in (
      'provider_certified_v1', 'credential_incarnation_v1'
    )
    and readback_job.id = successor.readback_job_id
    and readback_job.status in ('queued','running','reconciliation_required')
    and readback_job.attempt_count between 0 and 1
    and readback_job.provider_mutation_started_at is null
    and sellerpilot_private.smartstore_get_successor_job_matches(readback_job)
    and sellerpilot_private.external_detail_hash(to_jsonb(prior_recheck))
          = successor.prior_recheck_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(prior_job))
          = successor.prior_job_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(prior_completion))
          = successor.prior_completion_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(source_job))
          = successor.source_job_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
          = successor.source_attempt_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(listing))
          = successor.source_listing_snapshot_sha256
    and sellerpilot_private.external_detail_hash(preparation)
          = successor.preparation_sha256
    and preparation->>'contract' = 'smartstore_manual_adoption_prepare_v1'
    and preparation->>'status' = 'ready'
    and preparation->>'sourceJobId' = successor.source_job_id::text
    and preparation->>'sourceAttemptId' = successor.source_attempt_id::text
    and preparation->>'listingId' = successor.listing_id::text
    and preparation->>'credentialId' = successor.credential_id::text
    and preparation->>'sellerSku' = successor.seller_sku
    and preparation->>'approvalRevision' = successor.approval_revision::text
    and preparation->>'contentSha256' = successor.approval_content_sha256
    and preparation->>'manifestDigest' = successor.approved_manifest_digest;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_get_successor_is_current(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_get_successor_terminal_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.smartstore_get_successors successor
      join sellerpilot_private.smartstore_get_successor_receipts receipt
        on receipt.successor_id = successor.id
       and receipt.job_id = successor.readback_job_id
     where successor.readback_job_id = p_job.id
       and sellerpilot_private.smartstore_get_successor_job_matches(p_job)
       and p_job.provider_mutation_started_at is null
       and (
         (receipt.result_status = 'verified'
           and p_job.status = 'succeeded'
           and p_job.error_message is null
           and p_job.response_payload#>>'{contract}'
                 = 'smartstore_get_successor_gateway_receipt_v1'
           and p_job.response_payload#>>'{verificationStatus}' = 'verified'
           and p_job.response_payload#>>'{rawReadbackSha256}'
                 = receipt.raw_official_readback_sha256
           and p_job.response_payload#>>'{derivedCommitReadbackSha256}'
                 = receipt.derived_commit_readback_sha256
           and p_job.response_payload#>>'{providerMutationPerformed}' = 'false')
         or
         (receipt.result_status = 'reconciliation_required'
           and p_job.status = 'reconciliation_required'
           and p_job.response_payload is null
           and p_job.error_message = receipt.reason)
       )
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_get_successor_terminal_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

alter function
  sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) rename to sp_10020000_readback_matcher_pre_successor;

revoke all on function
  sellerpilot_private.sp_10020000_readback_matcher_pre_successor(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
    p_job sellerpilot_private.channel_gateway_jobs
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_job.request_payload ? 'sellerpilotSmartstoreGetSuccessorId'
      then case
        when exists (
          select 1
            from sellerpilot_private.smartstore_get_successors successor
           where successor.readback_job_id = p_job.id
        ) then exists (
          select 1
            from sellerpilot_private.smartstore_get_successors successor
           where successor.readback_job_id = p_job.id
             and sellerpilot_private.smartstore_get_successor_job_matches(p_job)
             and (
               sellerpilot_private.smartstore_get_successor_is_current(successor.id)
               or sellerpilot_private.smartstore_get_successor_terminal_job_matches(
                 p_job
               )
             )
        )
        else sellerpilot_private.smartstore_get_successor_job_shape_matches(
          p_job
        )
      end
    else sellerpilot_private.sp_10020000_readback_matcher_pre_successor(p_job)
  end
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

alter function
  sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
    uuid,uuid,uuid,text
  ) rename to sp_10020000_claim_allowed_pre_successor;

revoke all on function
  sellerpilot_private.sp_10020000_claim_allowed_pre_successor(
    uuid,uuid,uuid,text
  ) from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
    p_job_id uuid,
    p_credential_id uuid,
    p_worker_token_id uuid,
    p_worker_version text
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id
         and job.request_payload ? 'sellerpilotSmartstoreGetSuccessorId'
    ) then exists (
      select 1
        from sellerpilot_private.smartstore_get_successors successor
       where successor.readback_job_id = p_job_id
         and successor.credential_id = p_credential_id
         and sellerpilot_private.smartstore_get_successor_is_current(successor.id)
         and not exists (
           select 1
             from sellerpilot_private.smartstore_get_successor_receipts receipt
            where receipt.successor_id = successor.id
         )
         and exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs job
            where job.id = successor.readback_job_id
              and job.status = 'queued'
              and job.attempt_count = 0
         )
         and sellerpilot_private.sp_10020000_claim_allowed_pre_successor(
           p_job_id,p_credential_id,p_worker_token_id,p_worker_version
         )
    )
    else sellerpilot_private.sp_10020000_claim_allowed_pre_successor(
      p_job_id,p_credential_id,p_worker_token_id,p_worker_version
    )
  end
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
    uuid,uuid,uuid,text
  ) from public, anon, authenticated, service_role;

do $successor_active_lane$
declare
  definition text;
  old_fragment constant text :=
    'WHEN sellerpilot_private.sp_10020000_readback_matcher_pre_successor(channel_gateway_jobs.*) THEN ''smartstore_manual_adoption_readback_v1''::text';
  new_fragment constant text :=
    'WHEN sellerpilot_private.smartstore_get_successor_job_shape_matches(channel_gateway_jobs.*) THEN ''smartstore_get_successor_v1''::text WHEN sellerpilot_private.sp_10020000_readback_matcher_pre_successor(channel_gateway_jobs.*) THEN ''smartstore_manual_adoption_readback_v1''::text';
  old_hits integer;
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into definition
    from pg_catalog.pg_index
   where indexrelid =
     'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition,old_fragment,''))
  ) / pg_catalog.length(old_fragment) into old_hits;
  if old_hits <> 1
     or pg_catalog.strpos(
       definition,'smartstore_get_successor_job_shape_matches'
     ) <> 0 then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_ACTIVE_LANE_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  definition := pg_catalog.replace(definition,old_fragment,new_fragment);
  drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
  execute definition;
end;
$successor_active_lane$;

create function sellerpilot_private.guard_smartstore_get_successor_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and exists (
    select 1
      from sellerpilot_private.smartstore_get_successors successor
     where successor.readback_job_id = old.id
  ) then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_JOB_IMMUTABLE'
      using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1
      from sellerpilot_private.smartstore_get_successors successor
     where successor.readback_job_id = new.id
  ) and (
    new.request_payload is distinct from old.request_payload
    or new.listing_id is distinct from old.listing_id
    or new.credential_id is distinct from old.credential_id
    or new.seller_account_key is distinct from old.seller_account_key
    or new.created_by is distinct from old.created_by
    or new.channel is distinct from old.channel
    or new.operation is distinct from old.operation
    or new.environment is distinct from old.environment
    or new.provider_mutation_started_at is not null
  ) then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_JOB_IMMUTABLE'
      using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function sellerpilot_private.guard_smartstore_get_successor_job()
  from public, anon, authenticated, service_role;
create trigger smartstore_get_successor_job_guard
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_smartstore_get_successor_job();

create function public.sellerpilot_service_enqueue_smartstore_get_successor(
  p_actor uuid,
  p_product_id uuid,
  p_prior_recheck_id uuid,
  p_prior_readback_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  existing sellerpilot_private.smartstore_get_successors%rowtype;
  prior_recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  prior_job sellerpilot_private.channel_gateway_jobs%rowtype;
  prior_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  preparation jsonb;
  request_payload jsonb;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  stripped_job sellerpilot_private.channel_gateway_jobs%rowtype;
  successor_id uuid := gen_random_uuid();
  readback_job_id uuid := gen_random_uuid();
  prior_insert_guc text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor
     )
     or not exists (
       select 1 from sellerpilot_private.products product
        where product.id = p_product_id
          and product.owner_id = p_actor
          and not product.demo
          and product.status <> 'archived'
     ) then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('smartstore-get-successor:' || p_product_id::text)
  );

  select candidate.* into existing
    from sellerpilot_private.smartstore_get_successors candidate
   where candidate.owner_id = p_actor
     and candidate.product_id = p_product_id;
  if existing.id is not null then
    if existing.prior_recheck_id is distinct from p_prior_recheck_id
       or existing.prior_readback_job_id
            is distinct from p_prior_readback_job_id then
      raise exception 'SMARTSTORE_GET_SUCCESSOR_LINEAGE_CONFLICT'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract','smartstore_get_successor_v1',
      'status',coalesce((
        select receipt.result_status
          from sellerpilot_private.smartstore_get_successor_receipts receipt
         where receipt.successor_id = existing.id
      ),(
        select job.status
          from sellerpilot_private.channel_gateway_jobs job
         where job.id = existing.readback_job_id
      ),'blocked'),
      'successorId',existing.id,
      'jobId',existing.readback_job_id,
      'reused',true,
      'providerMutationPerformed',false
    );
  end if;

  select candidate.* into prior_recheck
    from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
   where candidate.id = p_prior_recheck_id
     and candidate.owner_id = p_actor
     and candidate.product_id = p_product_id
     and candidate.readback_job_id = p_prior_readback_job_id;
  select candidate.* into prior_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = p_prior_readback_job_id
     and candidate.id = prior_recheck.readback_job_id
   for share;
  select candidate.* into prior_completion
    from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
   where candidate.recheck_id = prior_recheck.id
     and candidate.job_id = prior_job.id;
  select candidate.* into source_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = prior_recheck.source_job_id
   for share;
  select candidate.* into source_attempt
    from sellerpilot_private.channel_operation_attempts candidate
   where candidate.id = prior_recheck.source_attempt_id
   for share;
  select candidate.* into listing
    from sellerpilot_private.product_listings candidate
   where candidate.id = prior_recheck.listing_id
   for share;
  select candidate.* into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = prior_recheck.credential_id
   for share;
  select candidate.* into baseline
    from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
   where candidate.id = prior_recheck.repair_baseline_id
   for share;
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor, p_product_id
  );

  if prior_recheck.id is null
     or prior_job.id is null
     or prior_completion.job_id is null
     or source_job.id is null
     or source_attempt.id is null
     or listing.id is null
     or credential.id is null
     or baseline.id is null
     or prior_job.status <> 'reconciliation_required'
     or prior_job.provider_mutation_started_at is not null
     or prior_completion.result_status <> 'reconciliation_required'
     or prior_completion.readback_sha256 is not null
     or prior_completion.adoption_receipt_id is not null
     or prior_completion.attestation_id is not null
     or prior_completion.provider_mutation_performed
     or sellerpilot_private.smartstore_repair_adoption_recheck_is_current(
       prior_recheck.id
     ) is not true
     or preparation->>'contract' <> 'smartstore_manual_adoption_prepare_v1'
     or preparation->>'status' <> 'ready'
     or preparation->>'sourceJobId' <> source_job.id::text
     or preparation->>'sourceAttemptId' <> source_attempt.id::text
     or preparation->>'listingId' <> listing.id::text
     or preparation->>'credentialId' <> credential.id::text
     or preparation->>'sellerSku' <> source_job.request_payload#>>
          '{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}'
     or baseline.origin_product_no <> '13688607602'
     or baseline.channel_product_no <> '13749310594'
     or baseline.owner_id <> p_actor
     or baseline.product_id <> p_product_id
     or baseline.listing_id <> listing.id
     or baseline.credential_id <> credential.id
     or baseline.source_job_id <> source_job.id
     or baseline.source_attempt_id <> source_attempt.id
     or baseline.seller_account_key <> credential.seller_account_key
     or source_job.created_by is null
     or credential.created_by is distinct from source_job.created_by
     or not exists (
       select 1
         from sellerpilot_private.admin_users admin
        where admin.user_id = source_job.created_by
     ) then
    return jsonb_build_object(
      'contract','smartstore_get_successor_v1',
      'status','blocked','reason','SUCCESSOR_SOURCE_NOT_CURRENT',
      'successorId',null,'jobId',null,'reused',false,
      'providerMutationPerformed',false
    );
  end if;

  request_payload := (
    prior_job.request_payload
      - 'sellerpilotSmartstoreRepairAdoptionRecheckId'
  ) || jsonb_build_object(
    'sellerpilotSmartstoreGetSuccessorId',successor_id
  );
  readback_job := jsonb_populate_record(
    null::sellerpilot_private.channel_gateway_jobs,
    to_jsonb(prior_job) || jsonb_build_object(
      'id',readback_job_id,'credential_id',credential.id,
      'attempt_id',null,'listing_id',listing.id,
      'channel','smartstore','operation','listing.lineage.verify',
      'environment','production','seller_account_key',credential.seller_account_key,
      'created_by',source_job.created_by,
      'request_payload',request_payload,
      'status','queued','attempt_count',0,
      'provider_mutation_started_at',null,
      'worker_token_id',null,'claim_token',null,'lease_expires_at',null,
      'response_payload',null,'error_message',null,'completed_at',null,
      'request_fingerprint',null,
      'credential_refresh_in_flight',false,
      'credential_refresh_recovery_vault_id',null,
      'prepared_credential_id',null,'oauth_exchange_completed',false,
      'created_at',pg_catalog.clock_timestamp(),
      'updated_at',pg_catalog.clock_timestamp()
    )
  );
  stripped_job := readback_job;
  stripped_job.request_payload := request_payload
    - 'sellerpilotSmartstoreGetSuccessorId';
  if sellerpilot_private.sellerpilot_175400_readback_job_matches_pre_recheck(
       stripped_job
     ) is not true
     or sellerpilot_private.smartstore_manual_adoption_readback_binding(
       readback_job
     ) is null then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_BASE_JOB_INVALID';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs
  select (readback_job).*;

  prior_insert_guc := coalesce(current_setting(
    'sellerpilot.smartstore_get_successor_insert', true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_get_successor_insert', successor_id::text, true
  );
  begin
    insert into sellerpilot_private.smartstore_get_successors (
      id,owner_id,operator_id,product_id,listing_id,credential_id,
      credential_version,
      credential_fingerprint,seller_account_key,seller_sku,
      origin_product_no,channel_product_no,source_job_id,source_attempt_id,
      repair_job_id,repair_baseline_id,recovery_receipt_id,prior_recheck_id,
      prior_readback_job_id,prior_completion_claim_token,
      prior_completion_worker_token_id,readback_job_id,approval_revision,
      approval_content_sha256,approved_manifest_digest,preparation_sha256,
      prior_recheck_snapshot_sha256,prior_job_snapshot_sha256,
      prior_completion_snapshot_sha256,source_job_snapshot_sha256,
      source_attempt_snapshot_sha256,source_listing_snapshot_sha256,
      readback_request_sha256
    ) values (
      successor_id,p_actor,source_job.created_by,p_product_id,listing.id,
      credential.id,
      credential.version,credential.fingerprint,credential.seller_account_key,
      preparation->>'sellerSku',baseline.origin_product_no,
      baseline.channel_product_no,source_job.id,source_attempt.id,
      prior_recheck.repair_job_id,baseline.id,prior_recheck.recovery_receipt_id,
      prior_recheck.id,prior_job.id,prior_completion.claim_token,
      prior_completion.worker_token_id,readback_job_id,
      (preparation->>'approvalRevision')::bigint,
      preparation->>'contentSha256',preparation->>'manifestDigest',
      sellerpilot_private.external_detail_hash(preparation),
      sellerpilot_private.external_detail_hash(to_jsonb(prior_recheck)),
      sellerpilot_private.external_detail_hash(to_jsonb(prior_job)),
      sellerpilot_private.external_detail_hash(to_jsonb(prior_completion)),
      sellerpilot_private.external_detail_hash(to_jsonb(source_job)),
      sellerpilot_private.external_detail_hash(to_jsonb(source_attempt)),
      sellerpilot_private.external_detail_hash(to_jsonb(listing)),
      sellerpilot_private.external_detail_hash(request_payload)
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_get_successor_insert', prior_insert_guc, true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_get_successor_insert', prior_insert_guc, true
  );

  if sellerpilot_private.smartstore_get_successor_is_current(successor_id)
       is not true then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_BINDING_FAILED';
  end if;

  return jsonb_build_object(
    'contract','smartstore_get_successor_v1',
    'status','queued','reason','FRESH_OFFICIAL_GET_REQUIRED',
    'successorId',successor_id,'jobId',readback_job_id,
    'priorJobId',prior_job.id,'priorRecheckId',prior_recheck.id,
    'originProductNo',baseline.origin_product_no,
    'channelProductNo',baseline.channel_product_no,
    'reused',false,'providerMutationPerformed',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_get_successor(
    uuid,uuid,uuid,uuid
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_get_successor(
    uuid,uuid,uuid,uuid
  )
  to service_role;

create function sellerpilot_private.smartstore_get_successor_commit_readback(
  p_successor_id uuid,
  p_raw_readback jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  successor sellerpilot_private.smartstore_get_successors%rowtype;
  search_response jsonb;
  origin_response jsonb;
  origin_product jsonb;
  embedded_channel jsonb;
  channel_response jsonb;
  channel_product jsonb;
  normalized jsonb;
  observed timestamptz;
  matching_candidates integer;
  resolved_origin_product_no text;
  resolved_channel_product_no text;
begin
  select candidate.* into successor
    from sellerpilot_private.smartstore_get_successors candidate
   where candidate.id = p_successor_id;
  if successor.id is null
     or sellerpilot_private.smartstore_get_successor_is_current(successor.id)
          is not true
     or pg_catalog.jsonb_typeof(p_raw_readback) is distinct from 'object'
     or pg_catalog.octet_length(p_raw_readback::text) > 2097152
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_raw_readback,array[
         'channelReadback','contract','detailImagePixelSha256s',
         'detailImageUrls','observedAt','originReadback',
         'providerMutationPerformed','searchReadback','source'
       ]
     )
     or p_raw_readback->>'contract'
          is distinct from 'smartstore_official_manual_adoption_readback_v1'
     or p_raw_readback->>'source'
          is distinct from 'smartstore_official_api_readback_v1'
     or p_raw_readback->'providerMutationPerformed'
          is distinct from 'false'::jsonb
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_raw_readback->'searchReadback',
       array['httpStatus','method','path','request','response']
     )
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_raw_readback->'originReadback',
       array['httpStatus','method','path','request','response']
     )
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_raw_readback->'channelReadback',
       array['httpStatus','method','path','request','response']
     )
     or pg_catalog.jsonb_typeof(p_raw_readback->'detailImageUrls')
          is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_raw_readback->'detailImageUrls') <> 8
     or pg_catalog.jsonb_typeof(p_raw_readback->'detailImagePixelSha256s')
          is distinct from 'array'
     or pg_catalog.jsonb_array_length(
          p_raw_readback->'detailImagePixelSha256s'
        ) <> 8
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements_text(
           p_raw_readback->'detailImagePixelSha256s'
         ) digest(value)
        where digest.value !~ '^[a-f0-9]{64}$'
     ) then
    return null;
  end if;

  begin
    observed := nullif(p_raw_readback->>'observedAt','')::timestamptz;
  exception when others then
    return null;
  end;
  if observed is null
     or not pg_catalog.isfinite(observed)
     or observed < successor.created_at
     or observed > pg_catalog.clock_timestamp() + interval '1 minute' then
    return null;
  end if;

  if p_raw_readback#>>'{searchReadback,method}' is distinct from 'POST'
     or p_raw_readback#>>'{searchReadback,path}'
          is distinct from '/v1/products/search'
     or p_raw_readback#>'{searchReadback,httpStatus}'
          is distinct from '200'::jsonb
     or p_raw_readback#>'{searchReadback,request}' is distinct from
          jsonb_build_object(
            'searchKeywordType','SELLER_CODE',
            'sellerManagementCode',successor.seller_sku,
            'page',1,'size',50,'orderType','NO'
          )
     or p_raw_readback#>>'{originReadback,method}' is distinct from 'GET'
     or p_raw_readback#>>'{originReadback,path}' is distinct from
          '/v2/products/origin-products/' || successor.origin_product_no
     or p_raw_readback#>'{originReadback,httpStatus}'
          is distinct from '200'::jsonb
     or p_raw_readback#>'{originReadback,request}'
          is distinct from 'null'::jsonb
     or p_raw_readback#>>'{channelReadback,method}' is distinct from 'GET'
     or p_raw_readback#>>'{channelReadback,path}' is distinct from
          '/v2/products/channel-products/' || successor.channel_product_no
     or p_raw_readback#>'{channelReadback,httpStatus}'
          is distinct from '200'::jsonb
     or p_raw_readback#>'{channelReadback,request}'
          is distinct from 'null'::jsonb then
    return null;
  end if;

  select identity.origin_product_no, identity.channel_product_no
    into resolved_origin_product_no, resolved_channel_product_no
    from sellerpilot_private.smartstore_manual_adoption_official_identity(
      p_raw_readback, successor.seller_sku
    ) identity;
  if resolved_origin_product_no is distinct from successor.origin_product_no
     or resolved_channel_product_no
          is distinct from successor.channel_product_no then
    return null;
  end if;

  search_response := p_raw_readback#>'{searchReadback,response}';
  origin_response := p_raw_readback#>'{originReadback,response}';
  origin_product := origin_response->'originProduct';
  embedded_channel := origin_response->'smartstoreChannelProduct';
  channel_response := p_raw_readback#>'{channelReadback,response}';
  channel_product := channel_response->'smartstoreChannelProduct';

  if pg_catalog.jsonb_typeof(search_response) is distinct from 'object'
     or pg_catalog.jsonb_typeof(search_response->'contents')
          is distinct from 'array'
     or pg_catalog.jsonb_typeof(search_response->'page')
          is distinct from 'number'
     or pg_catalog.jsonb_typeof(search_response->'size')
          is distinct from 'number'
     or pg_catalog.jsonb_typeof(search_response->'totalElements')
          is distinct from 'number'
     or pg_catalog.jsonb_typeof(search_response->'totalPages')
          is distinct from 'number'
     or pg_catalog.jsonb_typeof(search_response->'first')
          is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(search_response->'last')
          is distinct from 'boolean'
     or (search_response->>'page')::integer <> 1
     or (search_response->>'size')::integer <> 50
     or (search_response->>'totalElements')::integer
          <> pg_catalog.jsonb_array_length(search_response->'contents')
     or (search_response->>'totalPages')::integer <> 1
     or search_response->'first' is distinct from 'true'::jsonb
     or search_response->'last' is distinct from 'true'::jsonb
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(search_response->'contents') entry(value)
        where pg_catalog.jsonb_typeof(entry.value) is distinct from 'object'
           or pg_catalog.jsonb_typeof(entry.value->'channelProducts')
                is distinct from 'array'
     ) then
    return null;
  end if;

  select pg_catalog.count(*)::integer into matching_candidates
    from pg_catalog.jsonb_array_elements(search_response->'contents') entry(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      entry.value->'channelProducts'
    ) channel(value)
   where entry.value->>'originProductNo' = successor.origin_product_no
     and channel.value->>'sellerManagementCode' = successor.seller_sku
     and channel.value->>'channelProductNo' = successor.channel_product_no
     and (
       not (channel.value ? 'smartstoreChannelProductNo')
       or channel.value->>'smartstoreChannelProductNo'
            = successor.channel_product_no
     );
  if matching_candidates <> 1
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(search_response->'contents') entry(value)
         cross join lateral pg_catalog.jsonb_array_elements(
           entry.value->'channelProducts'
         ) channel(value)
        where channel.value->>'sellerManagementCode' = successor.seller_sku
          and (
            entry.value->>'originProductNo' is distinct from successor.origin_product_no
            or channel.value->>'channelProductNo'
                 is distinct from successor.channel_product_no
            or (channel.value ? 'smartstoreChannelProductNo'
              and channel.value->>'smartstoreChannelProductNo'
                    is distinct from successor.channel_product_no)
          )
     ) then
    return null;
  end if;

  if pg_catalog.jsonb_typeof(origin_product) is distinct from 'object'
     or pg_catalog.jsonb_typeof(channel_product) is distinct from 'object'
     or (origin_response ? 'originProductNo'
       and origin_response->>'originProductNo'
             is distinct from successor.origin_product_no)
     or (origin_product ? 'originProductNo'
       and origin_product->>'originProductNo'
             is distinct from successor.origin_product_no)
     or (origin_response ? 'smartstoreChannelProductNo'
       and origin_response->>'smartstoreChannelProductNo'
             is distinct from successor.channel_product_no)
     or (origin_response ? 'channelProductNo'
       and origin_response->>'channelProductNo'
             is distinct from successor.channel_product_no)
     or (pg_catalog.jsonb_typeof(embedded_channel) = 'object'
       and embedded_channel ? 'originProductNo'
       and embedded_channel->>'originProductNo'
             is distinct from successor.origin_product_no)
     or (pg_catalog.jsonb_typeof(embedded_channel) = 'object'
       and embedded_channel ? 'channelProductNo'
       and embedded_channel->>'channelProductNo'
             is distinct from successor.channel_product_no)
     or (pg_catalog.jsonb_typeof(embedded_channel) = 'object'
       and embedded_channel ? 'smartstoreChannelProductNo'
       and embedded_channel->>'smartstoreChannelProductNo'
             is distinct from successor.channel_product_no)
     or (channel_response ? 'originProductNo'
       and channel_response->>'originProductNo'
             is distinct from successor.origin_product_no)
     or (channel_response ? 'channelProductNo'
       and channel_response->>'channelProductNo'
             is distinct from successor.channel_product_no)
     or (channel_response ? 'smartstoreChannelProductNo'
       and channel_response->>'smartstoreChannelProductNo'
             is distinct from successor.channel_product_no)
     or (channel_product ? 'originProductNo'
       and channel_product->>'originProductNo'
             is distinct from successor.origin_product_no)
     or (channel_product ? 'channelProductNo'
       and channel_product->>'channelProductNo'
             is distinct from successor.channel_product_no)
     or (channel_product ? 'smartstoreChannelProductNo'
       and channel_product->>'smartstoreChannelProductNo'
             is distinct from successor.channel_product_no) then
    return null;
  end if;

  normalized := p_raw_readback;
  normalized := pg_catalog.jsonb_set(
    normalized,'{originReadback,response,originProductNo}',
    pg_catalog.to_jsonb(successor.origin_product_no),true
  );
  normalized := pg_catalog.jsonb_set(
    normalized,'{originReadback,response,smartstoreChannelProductNo}',
    pg_catalog.to_jsonb(successor.channel_product_no),true
  );
  normalized := pg_catalog.jsonb_set(
    normalized,'{originReadback,response,originProduct,originProductNo}',
    pg_catalog.to_jsonb(successor.origin_product_no),true
  );
  normalized := pg_catalog.jsonb_set(
    normalized,'{channelReadback,response,originProductNo}',
    pg_catalog.to_jsonb(successor.origin_product_no),true
  );
  normalized := pg_catalog.jsonb_set(
    normalized,'{channelReadback,response,smartstoreChannelProductNo}',
    pg_catalog.to_jsonb(successor.channel_product_no),true
  );
  normalized := pg_catalog.jsonb_set(
    normalized,'{channelReadback,response,smartstoreChannelProduct,originProductNo}',
    pg_catalog.to_jsonb(successor.origin_product_no),true
  );
  normalized := pg_catalog.jsonb_set(
    normalized,'{channelReadback,response,smartstoreChannelProduct,channelProductNo}',
    pg_catalog.to_jsonb(successor.channel_product_no),true
  );
  return normalized;
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_get_successor_commit_readback(uuid,jsonb)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) rename to sp_10020000_complete_smartstore_readback_pre_successor;

revoke all on function
  public.sp_10020000_complete_smartstore_readback_pre_successor(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_readback jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  successor sellerpilot_private.smartstore_get_successors%rowtype;
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  existing sellerpilot_private.smartstore_get_successor_receipts%rowtype;
  normalized jsonb;
  commit_result jsonb;
  raw_hash text;
  normalized_hash text;
  completion_fingerprint text;
  result_status text;
  result_reason text;
  prior_recheck_guc text;
  prior_lineage_guc text;
  prior_insert_guc text;
begin
  select candidate.* into successor
    from sellerpilot_private.smartstore_get_successors candidate
   where candidate.readback_job_id = p_job_id;
  if successor.id is null then
    return public.sp_10020000_complete_smartstore_readback_pre_successor(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
  end if;

  if p_claim_token is null
     or p_status not in ('succeeded','failed')
     or (p_readback is not null
       and pg_catalog.octet_length(p_readback::text) > 2097152)
     or pg_catalog.length(coalesce(p_error_message,'')) > 500 then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_COMPLETION_INVALID';
  end if;

  select candidate.* into worker_token
    from sellerpilot_private.ai_cli_worker_tokens candidate
   where candidate.token_hash = p_token_hash
     and candidate.scope = 'gateway'
     and candidate.status = 'active'
     and candidate.expires_at > pg_catalog.clock_timestamp();
  raw_hash := case when p_readback is null then null
    else sellerpilot_private.external_detail_hash(p_readback) end;
  completion_fingerprint := sellerpilot_private.external_detail_hash(
    jsonb_build_object(
      'status',p_status,
      'rawReadbackSha256',raw_hash,
      'safeError',case when p_status='failed' then coalesce(
        nullif(p_error_message,''),'SMARTSTORE_GET_FAILED'
      ) else null end
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('smartstore-get-successor-job:' || p_job_id::text)
  );
  select candidate.* into existing
    from sellerpilot_private.smartstore_get_successor_receipts candidate
   where candidate.job_id = p_job_id
     and candidate.claim_token = p_claim_token
     and candidate.worker_token_id = worker_token.id;
  if existing.job_id is not null then
    return jsonb_build_object(
      'contract','smartstore_get_successor_completion_v1',
      'status',case
        when existing.completion_fingerprint = completion_fingerprint
          then existing.result_status
        else 'reconciliation_required'
      end,
      'reason',case
        when existing.completion_fingerprint = completion_fingerprint
          then existing.reason
        else 'COMPLETION_REPLAY_MISMATCH'
      end,
      'successorId',existing.successor_id,
      'jobId',existing.job_id,
      'receiptId',existing.adoption_receipt_id,
      'attestationId',existing.attestation_id,
      'rawReadbackSha256',existing.raw_official_readback_sha256,
      'reused',true,'providerMutationPerformed',false
    );
  end if;

  select candidate.* into job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = p_job_id
     and candidate.status = 'running'
     and candidate.worker_token_id = worker_token.id
     and candidate.claim_token = p_claim_token
     and candidate.lease_expires_at > pg_catalog.clock_timestamp()
   for update;
  if worker_token.id is null
     or job.id is null
     or sellerpilot_private.smartstore_get_successor_is_current(successor.id)
          is not true then
    return jsonb_build_object(
      'contract','smartstore_get_successor_completion_v1',
      'status','lease_lost','reason','CLAIM_LEASE_LOST',
      'successorId',successor.id,'jobId',p_job_id,
      'receiptId',null,'attestationId',null,'rawReadbackSha256',null,
      'reused',false,'providerMutationPerformed',false
    );
  end if;

  if p_status = 'succeeded' and p_error_message is null then
    normalized := sellerpilot_private.smartstore_get_successor_commit_readback(
      successor.id,p_readback
    );
  end if;

  if normalized is not null then
    normalized_hash := sellerpilot_private.external_detail_hash(normalized);
    prior_recheck_guc := coalesce(current_setting(
      'sellerpilot.smartstore_repair_adoption_recheck_job',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_repair_adoption_recheck_job',
      successor.prior_readback_job_id::text,true
    );
    begin
      begin
        commit_result := public.sellerpilot_service_commit_smartstore_manual_adoption(
          successor.owner_id,successor.product_id,successor.source_job_id,
          successor.credential_id,successor.approval_revision,
          successor.approval_content_sha256,successor.approved_manifest_digest,
          normalized
        );
      exception when others then
        commit_result := null;
      end;
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_repair_adoption_recheck_job',
        prior_recheck_guc,true
      );
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_repair_adoption_recheck_job',
        prior_recheck_guc,true
      );
      raise;
    end;
  end if;

  if commit_result->>'contract' = 'smartstore_manual_adoption_verified_v1'
     and commit_result->>'status' in ('verified','already_verified')
     and commit_result->>'providerMutationPerformed' = 'false'
     and commit_result->>'normalUpdateEligible' = 'true' then
    result_status := 'verified';
    result_reason := 'FRESH_OFFICIAL_GET_VERIFIED';
  else
    result_status := 'reconciliation_required';
    result_reason := case
      when p_status = 'failed' then 'FRESH_OFFICIAL_GET_FAILED'
      when normalized is null then 'FRESH_OFFICIAL_GET_INVALID'
      else 'FRESH_OFFICIAL_GET_COMMIT_REJECTED'
    end;
  end if;

  prior_insert_guc := coalesce(current_setting(
    'sellerpilot.smartstore_get_successor_insert',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_get_successor_insert',successor.id::text,true
  );
  begin
    insert into sellerpilot_private.smartstore_get_successor_receipts (
      successor_id,job_id,claim_token,worker_token_id,completion_fingerprint,
      result_status,reason,raw_official_readback,
      raw_official_readback_sha256,derived_commit_readback_sha256,
      adoption_receipt_id,attestation_id,provider_mutation_performed
    ) values (
      successor.id,job.id,p_claim_token,worker_token.id,
      completion_fingerprint,result_status,result_reason,p_readback,raw_hash,
      normalized_hash,
      case when result_status='verified'
        then (commit_result->>'receiptId')::uuid else null end,
      case when result_status='verified'
        then (commit_result->>'attestationId')::uuid else null end,
      false
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_get_successor_insert',prior_insert_guc,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.smartstore_get_successor_insert',prior_insert_guc,true
  );

  prior_lineage_guc := coalesce(current_setting(
    'sellerpilot.provider_listing_lineage_rebind',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
  );
  begin
    update sellerpilot_private.channel_gateway_jobs
       set status = case when result_status='verified'
            then 'succeeded' else 'reconciliation_required' end,
           response_payload = case when result_status='verified' then
             jsonb_build_object(
               'contract','smartstore_get_successor_gateway_receipt_v1',
               'ok',true,'channel','smartstore',
               'operation','listing.lineage.verify',
               'verificationStatus','verified',
               'rawReadbackSha256',raw_hash,
               'derivedCommitReadbackSha256',normalized_hash,
               'receiptId',commit_result->>'receiptId',
               'attestationId',commit_result->>'attestationId',
               'originProductNo',successor.origin_product_no,
               'channelProductNo',successor.channel_product_no,
               'providerMutationPerformed',false
             ) else null end,
           error_message = case when result_status='verified'
             then null else result_reason end,
           worker_token_id=null,claim_token=null,lease_expires_at=null,
           completed_at=pg_catalog.clock_timestamp(),
           updated_at=pg_catalog.clock_timestamp()
     where id=job.id and status='running' and claim_token=p_claim_token;
    if not found then
      raise exception 'SMARTSTORE_GET_SUCCESSOR_LEASE_LOST';
    end if;
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
    job_id,claim_token,worker_token_id,completion_fingerprint,
    continuation_job_id
  ) values (
    job.id,p_claim_token,worker_token.id,completion_fingerprint,null
  );

  return jsonb_build_object(
    'contract','smartstore_get_successor_completion_v1',
    'status',result_status,'reason',result_reason,
    'successorId',successor.id,'jobId',job.id,
    'receiptId',case when result_status='verified'
      then commit_result->>'receiptId' else null end,
    'attestationId',case when result_status='verified'
      then commit_result->>'attestationId' else null end,
    'rawReadbackSha256',raw_hash,
    'reused',false,'providerMutationPerformed',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) to service_role;

create function sellerpilot_private.smartstore_get_successor_reconciliation_resolved(
  p_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  successor sellerpilot_private.smartstore_get_successors%rowtype;
  receipt sellerpilot_private.smartstore_get_successor_receipts%rowtype;
  prior_recheck sellerpilot_private.smartstore_repair_adoption_rechecks%rowtype;
  prior_job sellerpilot_private.channel_gateway_jobs%rowtype;
  prior_completion sellerpilot_private.smartstore_repair_adoption_recheck_completions%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
  recovery sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
begin
  select candidate.* into successor
    from sellerpilot_private.smartstore_get_successors candidate
    join sellerpilot_private.smartstore_content_repair_no_product_effect_receipts recovery_candidate
      on recovery_candidate.id = candidate.recovery_receipt_id
   where p_job_id in (candidate.repair_job_id,recovery_candidate.prior_repair_job_id)
   order by candidate.created_at desc limit 1;
  select candidate.* into receipt
    from sellerpilot_private.smartstore_get_successor_receipts candidate
   where candidate.successor_id = successor.id
     and candidate.result_status = 'verified';
  select candidate.* into prior_recheck
    from sellerpilot_private.smartstore_repair_adoption_rechecks candidate
   where candidate.id = successor.prior_recheck_id;
  select candidate.* into prior_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = successor.prior_readback_job_id;
  select candidate.* into prior_completion
    from sellerpilot_private.smartstore_repair_adoption_recheck_completions candidate
   where candidate.recheck_id = prior_recheck.id;
  select candidate.* into source_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = successor.source_job_id;
  select candidate.* into source_attempt
    from sellerpilot_private.channel_operation_attempts candidate
   where candidate.id = successor.source_attempt_id;
  select candidate.* into readback_job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = successor.readback_job_id;
  select candidate.* into attestation
    from sellerpilot_private.smartstore_manual_adoption_attestations candidate
   where candidate.id = receipt.attestation_id;
  select candidate.* into recovery
    from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
   where candidate.id = successor.recovery_receipt_id;

  return successor.id is not null
    and receipt.successor_id = successor.id
    and receipt.result_status = 'verified'
    and not receipt.provider_mutation_performed
    and receipt.raw_official_readback is not null
    and sellerpilot_private.external_detail_hash(receipt.raw_official_readback)
          = receipt.raw_official_readback_sha256
    and receipt.derived_commit_readback_sha256
          = attestation.official_readback_sha256
    and receipt.adoption_receipt_id = attestation.receipt_id
    and receipt.attestation_id = attestation.id
    and attestation.source_job_id = source_job.id
    and attestation.source_attempt_id = source_attempt.id
    and attestation.listing_id = successor.listing_id
    and attestation.credential_id = successor.credential_id
    and attestation.seller_account_key = successor.seller_account_key
    and attestation.origin_product_no = successor.origin_product_no
    and attestation.channel_product_no = successor.channel_product_no
    and attestation.approval_revision = successor.approval_revision
    and attestation.approval_content_sha256 = successor.approval_content_sha256
    and attestation.approved_manifest_digest = successor.approved_manifest_digest
    and attestation.source_listing_snapshot_sha256
          = successor.source_listing_snapshot_sha256
    and attestation.provenance = 'manual_adoption_verified'
    and not attestation.api_create_succeeded
    and not attestation.provider_mutation_performed
    and sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(
      source_job.id
    )
    and prior_recheck.id = successor.prior_recheck_id
    and prior_job.id = successor.prior_readback_job_id
    and prior_job.status = 'reconciliation_required'
    and prior_job.provider_mutation_started_at is null
    and prior_completion.job_id = prior_job.id
    and prior_completion.result_status = 'reconciliation_required'
    and prior_completion.readback_sha256 is null
    and prior_completion.adoption_receipt_id is null
    and prior_completion.attestation_id is null
    and not prior_completion.provider_mutation_performed
    and readback_job.id = successor.readback_job_id
    and readback_job.status = 'succeeded'
    and readback_job.provider_mutation_started_at is null
    and readback_job.response_payload#>>'{verificationStatus}' = 'verified'
    and readback_job.response_payload#>>'{rawReadbackSha256}'
          = receipt.raw_official_readback_sha256
    and readback_job.response_payload#>>'{derivedCommitReadbackSha256}'
          = receipt.derived_commit_readback_sha256
    and recovery.id = successor.recovery_receipt_id
    and recovery.after_baseline_id = successor.repair_baseline_id
    and sellerpilot_private.external_detail_hash(to_jsonb(prior_recheck))
          = successor.prior_recheck_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(prior_job))
          = successor.prior_job_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(prior_completion))
          = successor.prior_completion_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(source_job))
          = successor.source_job_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
          = successor.source_attempt_snapshot_sha256;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_get_successor_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

alter function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  rename to sp_10020000_listing_reconciliation_pre_successor;

create function sellerpilot_private.listing_mutation_reconciliation_resolved(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
  select sellerpilot_private.sp_10020000_listing_reconciliation_pre_successor(
           p_job_id
         )
      or sellerpilot_private.smartstore_get_successor_reconciliation_resolved(
           p_job_id
         )
$$;

revoke all on function
  sellerpilot_private.sp_10020000_listing_reconciliation_pre_successor(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_get_smartstore_content_repair_status(
  uuid,uuid
) rename to sp_10020000_get_smartstore_repair_status_pre_successor;

revoke all on function
  public.sp_10020000_get_smartstore_repair_status_pre_successor(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_smartstore_content_repair_status(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  successor sellerpilot_private.smartstore_get_successors%rowtype;
  receipt sellerpilot_private.smartstore_get_successor_receipts%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor
     )
     or not exists (
       select 1 from sellerpilot_private.products product
        where product.id = p_product_id
          and product.owner_id = p_actor
          and not product.demo
          and product.status <> 'archived'
     ) then
    raise exception 'SMARTSTORE_GET_SUCCESSOR_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  select candidate.* into successor
    from sellerpilot_private.smartstore_get_successors candidate
   where candidate.owner_id = p_actor
     and candidate.product_id = p_product_id;
  select candidate.* into receipt
    from sellerpilot_private.smartstore_get_successor_receipts candidate
   where candidate.successor_id = successor.id;
  if receipt.result_status = 'verified'
     and sellerpilot_private.smartstore_get_successor_reconciliation_resolved(
       successor.repair_job_id
     ) then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','verified','reason','FRESH_OFFICIAL_GET_VERIFIED',
      'jobId',successor.repair_job_id,
      'verificationJobId',successor.readback_job_id,
      'baselineId',successor.repair_baseline_id,
      'productId',successor.product_id,'listingId',successor.listing_id,
      'reused',true,'contentVerified',true,
      'providerMutationPerformed',false,'normalUpdateEligible',true
    );
  end if;
  return public.sp_10020000_get_smartstore_repair_status_pre_successor(
    p_actor,p_product_id
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  to service_role;

comment on function
  public.sellerpilot_service_enqueue_smartstore_get_successor(
    uuid,uuid,uuid,uuid
  ) is
  'Explicitly creates one GET-only successor for the rejected SmartStore C03 adoption recheck. Installation never enqueues it and no provider mutation is permitted.';
comment on table sellerpilot_private.smartstore_get_successor_receipts is
  'Immutable raw official GET evidence and its separately hashed derived commit object. Missing aliases are derived only after exact endpoints, search identity, lineage and every present alias are validated.';

notify pgrst, 'reload schema';

commit;
