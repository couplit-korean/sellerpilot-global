-- Preserve the failed third-claim completion receipt and the exhausted
-- fourth GET-only verifier preimage before making one final fourth claim
-- possible. This patch is deliberately exact-row-only and forward-only.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- Serialize with gateway completion before locking the exact verifier row.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072038);

create table if not exists
sellerpilot_private.coupang_exact_live_completion_recoveries (
  verifier_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (
      verifier_job_id =
        '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ),
  failed_job_snapshot jsonb not null,
  failed_job_sha256 text not null check (
    failed_job_sha256 =
      '3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370'
  ),
  retired_completion_snapshot jsonb not null,
  retired_completion_sha256 text not null check (
    retired_completion_sha256 =
      '0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb'
  ),
  retired_claim_token uuid not null,
  retired_worker_token_id uuid not null,
  retired_completion_fingerprint text not null check (
    retired_completion_fingerprint =
      '238cbf895c00819732d7f3c038de800700c26557bc2f0d55765b43e4a5a92451'
  ),
  retired_completion_created_at timestamptz not null check (
    retired_completion_created_at =
      '2026-09-07 17:45:15.146245+00'::timestamptz
  ),
  source_read_route_id uuid not null references
    sellerpilot_private.local_channel_executor_routes(id) on delete restrict,
  release_sha text not null check (
    release_sha = 'a78cc371969f4954db4bcfa986d7494631e84cfb'
  ),
  egress_ip_sha256 text not null check (
    egress_ip_sha256 =
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
  ),
  source_job_sha256 text not null check (source_job_sha256 ~ '^[a-f0-9]{64}$'),
  source_attempt_sha256 text not null check (
    source_attempt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_listing_sha256 text not null check (
    source_listing_sha256 ~ '^[a-f0-9]{64}$'
  ),
  prior_attempt_count integer not null check (prior_attempt_count = 4),
  retry_attempt_count integer not null check (retry_attempt_count = 3),
  prior_started_at timestamptz not null check (
    prior_started_at = '2026-09-07 17:29:56.708853+00'::timestamptz
  ),
  prior_completed_at timestamptz not null check (
    prior_completed_at = '2026-09-07 18:50:21.332045+00'::timestamptz
  ),
  prior_error_message text not null check (
    prior_error_message = 'Channel worker lease expired four times.'
  ),
  contract text not null check (
    contract = 'coupang_exact_live_failed_completion_recovery_v1'
  ),
  provider_mutation_performed boolean not null check (
    provider_mutation_performed is false
  ),
  recovered_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(failed_job_snapshot) = 'object'),
  check (jsonb_typeof(retired_completion_snapshot) = 'object')
);

alter table sellerpilot_private.coupang_exact_live_completion_recoveries
  enable row level security;
revoke all on sellerpilot_private.coupang_exact_live_completion_recoveries
  from public, anon, authenticated, service_role;

create or replace function
sellerpilot_private.block_coupang_exact_live_completion_recovery_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_IMMUTABLE'
    using errcode = '55000';
end
$$;
revoke all on function
sellerpilot_private.block_coupang_exact_live_completion_recovery_change()
  from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
       'sellerpilot_private.coupang_exact_live_completion_recoveries'::regclass
       and trigger_row.tgname =
         'block_coupang_exact_live_completion_recovery_change'
       and not trigger_row.tgisinternal
  ) then
    create trigger block_coupang_exact_live_completion_recovery_change
    before update or delete
    on sellerpilot_private.coupang_exact_live_completion_recoveries
    for each row execute function
      sellerpilot_private.block_coupang_exact_live_completion_recovery_change();
  end if;
end
$trigger$;

do $recover$
declare
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  source_listing sellerpilot_private.product_listings%rowtype;
  completion sellerpilot_private.gateway_completion_receipts%rowtype;
  exact_route sellerpilot_private.coupang_exact_live_local_claim_routes%rowtype;
  source_route sellerpilot_private.local_channel_executor_routes%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  recovery sellerpilot_private.coupang_exact_live_completion_recoveries%rowtype;
  job_snapshot jsonb;
  completion_snapshot jsonb;
  deleted_snapshot jsonb;
  job_sha256 text;
  completion_sha256 text;
  unrelated_receipt_count_before bigint;
  unrelated_receipt_count_after bigint;
  unrelated_receipt_sha_before text;
  unrelated_receipt_sha_after text;
  anchor_count integer;
  updated_count integer;
  deleted_count integer;
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
       'sellerpilot_private.coupang_exact_live_completion_recoveries'::regclass
       and trigger_row.tgname =
         'block_coupang_exact_live_completion_recovery_change'
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 27
       and trigger_row.tgfoid =
         'sellerpilot_private.block_coupang_exact_live_completion_recovery_change()'::regprocedure
       and pg_catalog.strpos(
         pg_catalog.upper(pg_catalog.pg_get_triggerdef(trigger_row.oid)),
         ' BEFORE '
       ) > 0
       and pg_catalog.strpos(
         pg_catalog.upper(pg_catalog.pg_get_triggerdef(trigger_row.oid)),
         ' UPDATE '
       ) > 0
       and pg_catalog.strpos(
         pg_catalog.upper(pg_catalog.pg_get_triggerdef(trigger_row.oid)),
         ' DELETE '
       ) > 0
       and not trigger_row.tgisinternal
  ) then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_TRIGGER_DRIFT'
      using errcode = '55000';
  end if;

  select count(*) into anchor_count
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;

  -- Empty databases reached through the full migration chain stay empty.
  if anchor_count = 0 then
    if exists (
      select 1 from sellerpilot_private.gateway_completion_receipts
       where job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ) or exists (
      select 1 from sellerpilot_private.coupang_exact_live_verify_runs
       where verifier_job_id =
         '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ) or exists (
      select 1 from sellerpilot_private.coupang_exact_live_local_claim_routes
       where job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ) or exists (
      select 1
        from sellerpilot_private.coupang_exact_live_completion_recoveries
       where verifier_job_id =
         '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ) then
      raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_PARTIAL_ANCHORS'
        using errcode = '55000';
    end if;
  else
    select * into recovery
      from sellerpilot_private.coupang_exact_live_completion_recoveries
     where verifier_job_id =
       '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;

  -- A valid already-applied postimage is a safe no-op. The exact old receipt
  -- must remain absent and the recovered job must still be the unclaimed
  -- attempt-3 queue row; a later claim is outside migration replay scope.
  if recovery.verifier_job_id is not null then
    if recovery.failed_job_sha256 is distinct from
         '3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370'
       or encode(extensions.digest(
            recovery.failed_job_snapshot::text, 'sha256'
          ), 'hex') is distinct from recovery.failed_job_sha256
       or recovery.retired_completion_sha256 is distinct from
         '0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb'
       or encode(extensions.digest(
            recovery.retired_completion_snapshot::text, 'sha256'
          ), 'hex') is distinct from recovery.retired_completion_sha256
       or recovery.retired_completion_fingerprint is distinct from
         '238cbf895c00819732d7f3c038de800700c26557bc2f0d55765b43e4a5a92451'
       or recovery.retired_completion_created_at is distinct from
         '2026-09-07 17:45:15.146245+00'::timestamptz
       or recovery.prior_attempt_count is distinct from 4
       or recovery.retry_attempt_count is distinct from 3
       or recovery.provider_mutation_performed is not false
       or exists (
         select 1 from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = recovery.verifier_job_id
       )
    then
      raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_POSTIMAGE_DRIFT'
        using errcode = '55000';
    end if;

    select * into strict verifier
      from sellerpilot_private.channel_gateway_jobs
     where id = recovery.verifier_job_id
     for update;
    if verifier.status is distinct from 'queued'
       or verifier.attempt_count is distinct from 3
       or verifier.worker_token_id is not null
       or verifier.claim_token is not null
       or verifier.lease_expires_at is not null
       or verifier.started_at is not null
       or verifier.completed_at is not null
       or verifier.error_message is not null
       or verifier.response_payload is not null
       or verifier.attempt_id is not null
       or verifier.oauth_provider_call_started_at is not null
       or verifier.provider_mutation_started_at is not null
       or verifier.write_resource_kind is not null
       or verifier.write_resource_key is not null
       or sellerpilot_private.coupang_exact_live_verifier_job_matches(verifier)
         is not true
       or sellerpilot_private.coupang_exact_live_source_current() is not true
       or exists (
         select 1
           from sellerpilot_private.coupang_exact_live_verify_receipts
          where verifier_job_id = verifier.id
       )
    then
      raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_REPLAY_DRIFT'
        using errcode = '55000';
    end if;
  else

  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
   for update;
  select * into strict run
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = verifier.id
   for share;
  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = run.source_job_id
   for share;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = run.source_attempt_id
   for share;
  select * into strict source_listing
    from sellerpilot_private.product_listings
   where id = run.listing_id
   for share;
  select * into strict completion
    from sellerpilot_private.gateway_completion_receipts
   where job_id = verifier.id
   for update;
  select * into strict exact_route
    from sellerpilot_private.coupang_exact_live_local_claim_routes
   where job_id = verifier.id
   for share;
  select * into strict source_route
    from sellerpilot_private.local_channel_executor_routes
   where id = exact_route.source_read_route_id
   for share;
  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = verifier.credential_id
   for share;
  select * into strict worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = exact_route.worker_token_id
   for share;

  job_snapshot := to_jsonb(verifier);
  completion_snapshot := to_jsonb(completion);
  job_sha256 := encode(extensions.digest(job_snapshot::text, 'sha256'), 'hex');
  completion_sha256 := encode(
    extensions.digest(completion_snapshot::text, 'sha256'), 'hex'
  );

  if (select count(*) from sellerpilot_private.coupang_exact_live_verify_runs) <> 1
     or run.source_job_id is distinct from
       '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
     or run.source_attempt_id is distinct from
       'd771421b-f408-4f75-addd-03879393fab8'::uuid
     or run.listing_id is distinct from
       'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
     or run.remote_id is distinct from '16375780938'
     or encode(extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex')
       is distinct from run.source_job_sha256
     or encode(extensions.digest(to_jsonb(source_attempt)::text, 'sha256'), 'hex')
       is distinct from run.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(source_listing)::text, 'sha256'), 'hex')
       is distinct from run.source_listing_sha256
     or source_listing.owner_id is distinct from source_attempt.owner_id
     or source_attempt.owner_id is not distinct from source_job.created_by
     or sellerpilot_private.coupang_exact_live_verifier_job_matches(verifier)
       is not true
     or sellerpilot_private.coupang_exact_live_source_current() is not true
     or verifier.status is distinct from 'failed'
     or verifier.attempt_count is distinct from 4
     or verifier.started_at is distinct from
       '2026-09-07 17:29:56.708853+00'::timestamptz
     or verifier.completed_at is distinct from
       '2026-09-07 18:50:21.332045+00'::timestamptz
     or verifier.error_message is distinct from
       'Channel worker lease expired four times.'
     or verifier.worker_token_id is not null
     or verifier.claim_token is not null
     or verifier.lease_expires_at is not null
     or verifier.response_payload is not null
     or verifier.attempt_id is not null
     or verifier.oauth_provider_call_started_at is not null
     or verifier.provider_mutation_started_at is not null
     or verifier.write_resource_kind is not null
     or verifier.write_resource_key is not null
     or verifier.credential_refresh_in_flight is not false
     or verifier.credential_refresh_started_at is not null
     or verifier.credential_refresh_recovery_vault_id is not null
     or verifier.prepared_credential_id is not null
     or verifier.oauth_exchange_completed is not false
     or job_sha256 is distinct from
       '3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370'
     or exists (
       select 1 from sellerpilot_private.coupang_exact_live_verify_receipts
        where verifier_job_id = verifier.id
     )
  then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_JOB_DRIFT'
      using errcode = '55000';
  end if;

  if completion.claim_token is null
     or completion.worker_token_id is null
     or completion.worker_token_id is distinct from exact_route.worker_token_id
     or completion.completion_fingerprint is distinct from
       '238cbf895c00819732d7f3c038de800700c26557bc2f0d55765b43e4a5a92451'
     or completion.continuation_job_id is not null
     or completion.created_at is distinct from
       '2026-09-07 17:45:15.146245+00'::timestamptz
     or completion_sha256 is distinct from
       '0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb'
  then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_RECEIPT_DRIFT'
      using errcode = '55000';
  end if;

  if exact_route.credential_id is distinct from verifier.credential_id
     or exact_route.owner_id is distinct from
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or exact_route.channel is distinct from 'coupang'
     or exact_route.operation is distinct from 'listing.publication.verify'
     or exact_route.seller_account_key is distinct from verifier.seller_account_key
     or exact_route.release_sha is distinct from
       'a78cc371969f4954db4bcfa986d7494631e84cfb'
     or sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from exact_route.release_sha
     or exact_route.egress_ip_sha256 is distinct from
       '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
     or exact_route.activated_by is distinct from verifier.created_by
     or exact_route.expires_at <= clock_timestamp()
     or source_route.owner_id is distinct from exact_route.owner_id
     or source_route.channel is distinct from exact_route.channel
     or source_route.operation not in (
       'categories.attributes', 'categories.validate'
     )
     or source_route.credential_id is distinct from exact_route.credential_id
     or source_route.seller_account_key is distinct from
       exact_route.seller_account_key
     or source_route.worker_token_id is distinct from exact_route.worker_token_id
     or source_route.egress_ip_sha256 is distinct from
       exact_route.egress_ip_sha256
     or source_route.enabled is not true
     or source_route.approved_at > clock_timestamp()
     or source_route.expires_at <= clock_timestamp()
     or credential.channel is distinct from 'coupang'
     or credential.environment is distinct from 'production'
     or credential.status is distinct from 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= clock_timestamp())
     or credential.last_check_status is distinct from 'passed'
     or credential.seller_account_key is distinct from verifier.seller_account_key
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     or credential.created_by is distinct from verifier.created_by
     or worker.scope is distinct from 'gateway'
     or worker.status is distinct from 'active'
     or worker.expires_at <= clock_timestamp()
     or worker.last_seen_at is null
     or worker.last_seen_at < clock_timestamp() - interval '3 minutes'
     or worker.last_version is distinct from
       'sellerpilot-cli-worker/1.61+' || exact_route.release_sha || '.' ||
       left(exact_route.egress_ip_sha256, 11)
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = exact_route.owner_id
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = exact_route.activated_by
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = source_route.approved_by
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = worker.created_by
     )
     or not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = 'coupang' and policy.enabled is false
     )
  then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_ROUTE_DRIFT'
      using errcode = '55000';
  end if;

  select count(*), encode(extensions.digest(
           coalesce(string_agg(to_jsonb(receipt)::text, '' order by receipt.job_id), ''),
           'sha256'
         ), 'hex')
    into unrelated_receipt_count_before, unrelated_receipt_sha_before
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id <> verifier.id;

  insert into sellerpilot_private.coupang_exact_live_completion_recoveries (
    verifier_job_id, failed_job_snapshot, failed_job_sha256,
    retired_completion_snapshot, retired_completion_sha256,
    retired_claim_token, retired_worker_token_id,
    retired_completion_fingerprint, retired_completion_created_at,
    source_read_route_id, release_sha, egress_ip_sha256,
    source_job_sha256, source_attempt_sha256, source_listing_sha256,
    prior_attempt_count, retry_attempt_count, prior_started_at,
    prior_completed_at, prior_error_message, contract,
    provider_mutation_performed
  ) values (
    verifier.id, job_snapshot, job_sha256,
    completion_snapshot, completion_sha256,
    completion.claim_token, completion.worker_token_id,
    completion.completion_fingerprint, completion.created_at,
    exact_route.source_read_route_id, exact_route.release_sha,
    exact_route.egress_ip_sha256, run.source_job_sha256,
    run.source_attempt_sha256, run.source_listing_sha256,
    4, 3, verifier.started_at,
    verifier.completed_at, verifier.error_message,
    'coupang_exact_live_failed_completion_recovery_v1', false
  );

  delete from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = verifier.id
     and receipt.claim_token = completion.claim_token
     and encode(extensions.digest(to_jsonb(receipt)::text, 'sha256'), 'hex') =
       '0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb'
  returning to_jsonb(receipt) into deleted_snapshot;
  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 or deleted_snapshot is distinct from completion_snapshot then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_DELETE_MISMATCH'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'queued',
         attempt_count = 3,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         response_payload = null,
         error_message = null,
         started_at = null,
         completed_at = null,
         updated_at = clock_timestamp()
   where job.id = verifier.id
     and encode(extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex') =
       '3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370'
     and job.status = 'failed'
     and job.attempt_count = 4
     and job.provider_mutation_started_at is null
     and job.write_resource_kind is null
     and job.write_resource_key is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_UPDATE_MISMATCH'
      using errcode = '55000';
  end if;

  select * into strict recovery
    from sellerpilot_private.coupang_exact_live_completion_recoveries
   where verifier_job_id = verifier.id;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = verifier.id;
  select count(*), encode(extensions.digest(
           coalesce(string_agg(to_jsonb(receipt)::text, '' order by receipt.job_id), ''),
           'sha256'
         ), 'hex')
    into unrelated_receipt_count_after, unrelated_receipt_sha_after
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id <> verifier.id;

  if encode(extensions.digest(
       recovery.failed_job_snapshot::text, 'sha256'
     ), 'hex') is distinct from
       '3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370'
     or encode(extensions.digest(
       recovery.retired_completion_snapshot::text, 'sha256'
     ), 'hex') is distinct from
       '0dd6addb8cb52743efd75c547913d92d7abfc6d4a824c4d1c76069b692dea9eb'
     or exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = verifier.id
     )
     or unrelated_receipt_count_after is distinct from
       unrelated_receipt_count_before
     or unrelated_receipt_sha_after is distinct from unrelated_receipt_sha_before
     or verifier.status is distinct from 'queued'
     or verifier.attempt_count is distinct from 3
     or verifier.worker_token_id is not null
     or verifier.claim_token is not null
     or verifier.lease_expires_at is not null
     or verifier.started_at is not null
     or verifier.completed_at is not null
     or verifier.error_message is not null
     or verifier.response_payload is not null
     or verifier.provider_mutation_started_at is not null
     or verifier.write_resource_kind is not null
     or verifier.write_resource_key is not null
     or sellerpilot_private.coupang_exact_live_verifier_job_matches(verifier)
       is not true
     or sellerpilot_private.coupang_exact_live_source_current() is not true
     or exists (
       select 1 from sellerpilot_private.coupang_exact_live_verify_receipts
        where verifier_job_id = verifier.id
     )
  then
    raise exception 'COUPANG_EXACT_LIVE_COMPLETION_RECOVERY_POSTIMAGE_INVALID'
      using errcode = '55000';
  end if;
  end if;
  end if;
end
$recover$;

comment on table
sellerpilot_private.coupang_exact_live_completion_recoveries is
  'Immutable exact-row evidence for retiring the stale attempt-3 completion receipt and recovering the exhausted GET-only Coupang verifier for one final attempt-4 claim.';

commit;
