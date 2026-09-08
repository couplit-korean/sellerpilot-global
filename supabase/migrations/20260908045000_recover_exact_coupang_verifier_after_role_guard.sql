-- Preserve the exhausted GET-only verifier and both expired local route
-- preimages before one exact retry after the service-role guard repair.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072038);

create table if not exists
sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries (
  verifier_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (
      verifier_job_id =
        '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ),
  failed_job_snapshot jsonb not null,
  failed_job_sha256 text not null check (
    failed_job_sha256 =
      'a1829784b6eae6ab834b9bcffe5e2ba0542d0e77d691300931f752e0c7080c79'
  ),
  prior_recovery_snapshot jsonb not null,
  prior_recovery_sha256 text not null check (
    prior_recovery_sha256 =
      '855e30f766bc98895b247871d8d0b7017553c05821a391513eef5eac46ebbcd5'
  ),
  source_route_snapshot jsonb not null,
  source_route_sha256 text not null check (
    source_route_sha256 =
      '39bdf32ea69af37d3adf254a724b942c1d9bfbbac6f1d3d44d21fb6e0d132a33'
  ),
  exact_route_snapshot jsonb not null,
  exact_route_sha256 text not null check (
    exact_route_sha256 =
      'ebeabb6899f361e5e685523e1e6ad0adf2e9cd039b49100a2d576f95e430e446'
  ),
  source_read_route_id uuid not null references
    sellerpilot_private.local_channel_executor_routes(id) on delete restrict
    check (
      source_read_route_id =
        '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid
    ),
  worker_token_id uuid not null references
    sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict
    check (
      worker_token_id =
        '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
    ),
  release_sha text not null check (
    release_sha = 'a78cc371969f4954db4bcfa986d7494631e84cfb'
  ),
  egress_ip_sha256 text not null check (
    egress_ip_sha256 =
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
  ),
  prior_attempt_count integer not null check (prior_attempt_count = 4),
  retry_attempt_count integer not null check (retry_attempt_count = 3),
  prior_started_at timestamptz not null check (
    prior_started_at = '2026-09-07 19:12:17.050487+00'::timestamptz
  ),
  prior_completed_at timestamptz not null check (
    prior_completed_at = '2026-09-07 19:27:22.398549+00'::timestamptz
  ),
  prior_error_message text not null check (
    prior_error_message = 'Channel worker lease expired four times.'
  ),
  refreshed_expires_at timestamptz not null,
  contract text not null check (
    contract = 'coupang_exact_live_role_guard_retry_recovery_v1'
  ),
  provider_mutation_performed boolean not null check (
    provider_mutation_performed is false
  ),
  recovered_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(failed_job_snapshot) = 'object'),
  check (jsonb_typeof(prior_recovery_snapshot) = 'object'),
  check (jsonb_typeof(source_route_snapshot) = 'object'),
  check (jsonb_typeof(exact_route_snapshot) = 'object'),
  check (refreshed_expires_at > recovered_at)
);

alter table
sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries
  enable row level security;
revoke all on
sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries
  from public, anon, authenticated, service_role;

create or replace function
sellerpilot_private.block_coupang_exact_live_role_guard_retry_recovery_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_RECOVERY_IMMUTABLE'
    using errcode = '55000';
end
$$;
revoke all on function
sellerpilot_private.block_coupang_exact_live_role_guard_retry_recovery_change()
  from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
       'sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries'::regclass
       and trigger_row.tgname =
         'block_coupang_exact_live_role_guard_retry_recovery_change'
       and not trigger_row.tgisinternal
  ) then
    create trigger block_coupang_exact_live_role_guard_retry_recovery_change
    before update or delete
    on sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries
    for each row execute function
      sellerpilot_private.block_coupang_exact_live_role_guard_retry_recovery_change();
  end if;
end
$trigger$;

do $recover$
declare
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  prior_recovery sellerpilot_private.coupang_exact_live_completion_recoveries%rowtype;
  source_route sellerpilot_private.local_channel_executor_routes%rowtype;
  exact_route sellerpilot_private.coupang_exact_live_local_claim_routes%rowtype;
  run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  source_listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  recovery sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries%rowtype;
  verifier_snapshot jsonb;
  prior_recovery_snapshot jsonb;
  source_route_snapshot jsonb;
  exact_route_snapshot jsonb;
  verifier_sha256 text;
  prior_recovery_sha256 text;
  source_route_sha256 text;
  exact_route_sha256 text;
  refreshed_expiry timestamptz;
  updated_count integer;
  anchor_count integer;
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
       'sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries'::regclass
       and trigger_row.tgname =
         'block_coupang_exact_live_role_guard_retry_recovery_change'
       and trigger_row.tgenabled = 'O'
       and trigger_row.tgtype = 27
       and trigger_row.tgfoid =
         'sellerpilot_private.block_coupang_exact_live_role_guard_retry_recovery_change()'::regprocedure
       and not trigger_row.tgisinternal
  ) then
    raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_TRIGGER_DRIFT'
      using errcode = '55000';
  end if;

  select count(*) into anchor_count
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;

  if anchor_count = 0 then
    if exists (
      select 1
        from sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries
    ) then
      raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_PARTIAL_ANCHOR'
        using errcode = '55000';
    end if;
  else
    select * into recovery
      from sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries
     where verifier_job_id =
       '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;

    if recovery.verifier_job_id is not null then
      if recovery.failed_job_sha256 is distinct from
           'a1829784b6eae6ab834b9bcffe5e2ba0542d0e77d691300931f752e0c7080c79'
         or encode(extensions.digest(
              recovery.failed_job_snapshot::text, 'sha256'
            ), 'hex') is distinct from recovery.failed_job_sha256
         or recovery.prior_recovery_sha256 is distinct from
           '855e30f766bc98895b247871d8d0b7017553c05821a391513eef5eac46ebbcd5'
         or encode(extensions.digest(
              recovery.prior_recovery_snapshot::text, 'sha256'
            ), 'hex') is distinct from recovery.prior_recovery_sha256
         or recovery.source_route_sha256 is distinct from
           '39bdf32ea69af37d3adf254a724b942c1d9bfbbac6f1d3d44d21fb6e0d132a33'
         or encode(extensions.digest(
              recovery.source_route_snapshot::text, 'sha256'
            ), 'hex') is distinct from recovery.source_route_sha256
         or recovery.exact_route_sha256 is distinct from
           'ebeabb6899f361e5e685523e1e6ad0adf2e9cd039b49100a2d576f95e430e446'
         or encode(extensions.digest(
              recovery.exact_route_snapshot::text, 'sha256'
            ), 'hex') is distinct from recovery.exact_route_sha256
         or recovery.contract is distinct from
           'coupang_exact_live_role_guard_retry_recovery_v1'
         or recovery.provider_mutation_performed is not false
      then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_POSTIMAGE_DRIFT'
          using errcode = '55000';
      end if;
    else
      select * into strict verifier
        from sellerpilot_private.channel_gateway_jobs
       where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
       for update;
      select * into strict prior_recovery
        from sellerpilot_private.coupang_exact_live_completion_recoveries
       where verifier_job_id = verifier.id
       for share;
      select * into strict exact_route
        from sellerpilot_private.coupang_exact_live_local_claim_routes
       where job_id = verifier.id
       for update;
      select * into strict source_route
        from sellerpilot_private.local_channel_executor_routes
       where id = exact_route.source_read_route_id
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
      select * into strict credential
        from sellerpilot_private.channel_credentials
       where id = verifier.credential_id
       for share;
      select * into strict worker
        from sellerpilot_private.ai_cli_worker_tokens
       where id = exact_route.worker_token_id
       for share;

      verifier_snapshot := to_jsonb(verifier);
      prior_recovery_snapshot := to_jsonb(prior_recovery);
      source_route_snapshot := to_jsonb(source_route);
      exact_route_snapshot := to_jsonb(exact_route);
      verifier_sha256 := encode(
        extensions.digest(verifier_snapshot::text, 'sha256'), 'hex'
      );
      prior_recovery_sha256 := encode(
        extensions.digest(prior_recovery_snapshot::text, 'sha256'), 'hex'
      );
      source_route_sha256 := encode(
        extensions.digest(source_route_snapshot::text, 'sha256'), 'hex'
      );
      exact_route_sha256 := encode(
        extensions.digest(exact_route_snapshot::text, 'sha256'), 'hex'
      );

      if verifier_sha256 is distinct from
           'a1829784b6eae6ab834b9bcffe5e2ba0542d0e77d691300931f752e0c7080c79'
         or verifier.status is distinct from 'failed'
         or verifier.attempt_count is distinct from 4
         or verifier.started_at is distinct from
           '2026-09-07 19:12:17.050487+00'::timestamptz
         or verifier.completed_at is distinct from
           '2026-09-07 19:27:22.398549+00'::timestamptz
         or verifier.error_message is distinct from
           'Channel worker lease expired four times.'
         or verifier.channel is distinct from 'coupang'
         or verifier.operation is distinct from 'listing.publication.verify'
         or verifier.environment is distinct from 'production'
         or verifier.listing_id is distinct from
           'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
         or verifier.credential_id is distinct from
           '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
         or verifier.created_by is distinct from
           '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
         or verifier.seller_account_key is distinct from
           'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
         or verifier.request_fingerprint is distinct from
           'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
         or verifier.response_payload is not null
         or verifier.worker_token_id is not null
         or verifier.claim_token is not null
         or verifier.lease_expires_at is not null
         or verifier.attempt_id is not null
         or verifier.oauth_provider_call_started_at is not null
         or verifier.provider_mutation_started_at is not null
         or verifier.write_resource_kind is not null
         or verifier.write_resource_key is not null
         or sellerpilot_private.coupang_exact_live_verifier_job_matches(verifier)
           is not true
         or sellerpilot_private.coupang_exact_live_source_current() is not true
         or (select count(*)
               from sellerpilot_private.coupang_exact_live_verify_runs) <> 1
         or run.source_job_id is distinct from
           '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
         or run.source_attempt_id is distinct from
           'd771421b-f408-4f75-addd-03879393fab8'::uuid
         or run.listing_id is distinct from
           'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
         or run.remote_id is distinct from '16375780938'
         or run.source_job_sha256 is distinct from prior_recovery.source_job_sha256
         or run.source_attempt_sha256 is distinct from
           prior_recovery.source_attempt_sha256
         or run.source_listing_sha256 is distinct from
           prior_recovery.source_listing_sha256
         or encode(
           extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex'
         ) is distinct from run.source_job_sha256
         or encode(
           extensions.digest(to_jsonb(source_attempt)::text, 'sha256'), 'hex'
         ) is distinct from run.source_attempt_sha256
         or encode(
           extensions.digest(to_jsonb(source_listing)::text, 'sha256'), 'hex'
         ) is distinct from run.source_listing_sha256
         or source_listing.owner_id is distinct from source_attempt.owner_id
         or source_attempt.owner_id is not distinct from source_job.created_by
         or exists (
           select 1
             from sellerpilot_private.gateway_completion_receipts receipt
            where receipt.job_id = verifier.id
         )
         or exists (
           select 1
             from sellerpilot_private.coupang_exact_live_verify_receipts receipt
            where receipt.verifier_job_id = verifier.id
         )
      then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_JOB_DRIFT'
          using errcode = '55000';
      end if;

      refreshed_expiry := clock_timestamp() + interval '20 minutes';

      if prior_recovery_sha256 is distinct from
           '855e30f766bc98895b247871d8d0b7017553c05821a391513eef5eac46ebbcd5'
         or prior_recovery.failed_job_sha256 is distinct from
           '3730e8557ea68c69c9b6924f4287a50c4b29cdb973ed4664303a60c42f106370'
         or prior_recovery.contract is distinct from
           'coupang_exact_live_failed_completion_recovery_v1'
         or prior_recovery.provider_mutation_performed is not false
      then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_PRIOR_DRIFT'
          using errcode = '55000';
      end if;

      if source_route_sha256 is distinct from
           '39bdf32ea69af37d3adf254a724b942c1d9bfbbac6f1d3d44d21fb6e0d132a33'
         or exact_route_sha256 is distinct from
           'ebeabb6899f361e5e685523e1e6ad0adf2e9cd039b49100a2d576f95e430e446'
         or source_route.id is distinct from
           '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid
         or source_route.owner_id is distinct from exact_route.owner_id
         or source_route.channel is distinct from 'coupang'
         or source_route.operation is distinct from 'categories.validate'
         or source_route.credential_id is distinct from verifier.credential_id
         or source_route.worker_token_id is distinct from exact_route.worker_token_id
         or source_route.seller_account_key is distinct from verifier.seller_account_key
         or source_route.egress_ip_sha256 is distinct from
           '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
         or source_route.enabled is not true
         or source_route.approved_at > clock_timestamp()
         or exact_route.job_id is distinct from verifier.id
         or exact_route.owner_id is distinct from
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         or exact_route.channel is distinct from 'coupang'
         or exact_route.operation is distinct from 'listing.publication.verify'
         or exact_route.credential_id is distinct from verifier.credential_id
         or exact_route.worker_token_id is distinct from
           '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
         or exact_route.source_read_route_id is distinct from source_route.id
         or exact_route.release_sha is distinct from
           'a78cc371969f4954db4bcfa986d7494631e84cfb'
         or sellerpilot_private.active_serverless_runtime_release_sha()
           is distinct from exact_route.release_sha
         or exact_route.egress_ip_sha256 is distinct from source_route.egress_ip_sha256
         or exact_route.activated_by is distinct from verifier.created_by
         or exact_route.activated_at > clock_timestamp()
         or credential.id is distinct from
           '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
         or credential.channel is distinct from 'coupang'
         or credential.environment is distinct from 'production'
         or credential.status is distinct from 'active'
         or (credential.expires_at is not null
           and credential.expires_at <= refreshed_expiry)
         or credential.last_check_status is distinct from 'passed'
         or credential.seller_account_key is distinct from verifier.seller_account_key
         or credential.seller_account_key_source not in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
         or credential.created_by is distinct from verifier.created_by
         or worker.id is distinct from exact_route.worker_token_id
         or worker.scope is distinct from 'gateway'
         or worker.status is distinct from 'active'
         or worker.expires_at <= refreshed_expiry
         or worker.last_seen_at is null
         or worker.last_seen_at < clock_timestamp() - interval '3 minutes'
         or worker.last_version is distinct from
           'sellerpilot-cli-worker/1.61+' || exact_route.release_sha || '.' ||
           left(exact_route.egress_ip_sha256, 11)
         or not exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = credential.created_by
         )
         or not exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = worker.created_by
         )
         or not exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = exact_route.owner_id
         )
         or not exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = source_route.approved_by
         )
         or not exists (
           select 1
             from sellerpilot_private.serverless_static_egress_policy policy
            where policy.channel = 'coupang'
              and policy.enabled is false
         )
         or not exists (
           select 1
             from pg_catalog.pg_proc p
            where p.oid =
              'public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid)'::regprocedure
              and encode(extensions.digest(p.prosrc::bytea, 'sha256'), 'hex') =
                'af8340dcac984a197adf6dd7a9f3d54b61c32cdfeb5e5d6b040827266c1c8193'
         )
      then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_ROUTE_DRIFT'
          using errcode = '55000';
      end if;

      insert into
      sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries (
        verifier_job_id,
        failed_job_snapshot,
        failed_job_sha256,
        prior_recovery_snapshot,
        prior_recovery_sha256,
        source_route_snapshot,
        source_route_sha256,
        exact_route_snapshot,
        exact_route_sha256,
        source_read_route_id,
        worker_token_id,
        release_sha,
        egress_ip_sha256,
        prior_attempt_count,
        retry_attempt_count,
        prior_started_at,
        prior_completed_at,
        prior_error_message,
        refreshed_expires_at,
        contract,
        provider_mutation_performed
      ) values (
        verifier.id,
        verifier_snapshot,
        verifier_sha256,
        prior_recovery_snapshot,
        prior_recovery_sha256,
        source_route_snapshot,
        source_route_sha256,
        exact_route_snapshot,
        exact_route_sha256,
        source_route.id,
        exact_route.worker_token_id,
        exact_route.release_sha,
        exact_route.egress_ip_sha256,
        4,
        3,
        verifier.started_at,
        verifier.completed_at,
        verifier.error_message,
        refreshed_expiry,
        'coupang_exact_live_role_guard_retry_recovery_v1',
        false
      );

      update sellerpilot_private.local_channel_executor_routes route
         set expires_at = refreshed_expiry
       where route.id = source_route.id
         and encode(
           extensions.digest(to_jsonb(route)::text, 'sha256'), 'hex'
         ) = '39bdf32ea69af37d3adf254a724b942c1d9bfbbac6f1d3d44d21fb6e0d132a33';
      get diagnostics updated_count = row_count;
      if updated_count <> 1 then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_SOURCE_ROUTE_UPDATE'
          using errcode = '55000';
      end if;

      update sellerpilot_private.coupang_exact_live_local_claim_routes route
         set expires_at = refreshed_expiry
       where route.job_id = verifier.id
         and encode(
           extensions.digest(to_jsonb(route)::text, 'sha256'), 'hex'
         ) = 'ebeabb6899f361e5e685523e1e6ad0adf2e9cd039b49100a2d576f95e430e446';
      get diagnostics updated_count = row_count;
      if updated_count <> 1 then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_EXACT_ROUTE_UPDATE'
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
         and encode(
           extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex'
         ) = 'a1829784b6eae6ab834b9bcffe5e2ba0542d0e77d691300931f752e0c7080c79'
         and job.status = 'failed'
         and job.attempt_count = 4
         and job.provider_mutation_started_at is null
         and job.write_resource_kind is null
         and job.write_resource_key is null;
      get diagnostics updated_count = row_count;
      if updated_count <> 1 then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_JOB_UPDATE'
          using errcode = '55000';
      end if;

      select * into strict recovery
        from sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries
       where verifier_job_id = verifier.id;
      select * into strict verifier
        from sellerpilot_private.channel_gateway_jobs
       where id = verifier.id;
      select * into strict source_route
        from sellerpilot_private.local_channel_executor_routes
       where id = recovery.source_read_route_id;
      select * into strict exact_route
        from sellerpilot_private.coupang_exact_live_local_claim_routes
       where job_id = verifier.id;

      if verifier.status is distinct from 'queued'
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
         or source_route.expires_at is distinct from recovery.refreshed_expires_at
         or exact_route.expires_at is distinct from recovery.refreshed_expires_at
         or recovery.refreshed_expires_at <= clock_timestamp()
         or exists (
           select 1
             from sellerpilot_private.gateway_completion_receipts receipt
            where receipt.job_id = verifier.id
         )
         or exists (
           select 1
             from sellerpilot_private.coupang_exact_live_verify_receipts receipt
            where receipt.verifier_job_id = verifier.id
         )
      then
        raise exception 'COUPANG_EXACT_LIVE_ROLE_GUARD_RETRY_POSTIMAGE_INVALID'
          using errcode = '55000';
      end if;
    end if;
  end if;
end
$recover$;

comment on table
sellerpilot_private.coupang_exact_live_role_guard_retry_recoveries is
  'Immutable exact-row evidence for the one GET-only retry after fixing the PostgREST service-role completion guard; preserves the exhausted verifier and both refreshed route preimages.';

commit;
