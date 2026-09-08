-- Let the one exact Coupang price-repair enqueue recover its already-claimed
-- job after a dead worker's lease expires.  The exception is transaction-local
-- to the existing recovery RPC and never makes a stale worker claimable.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072056);

do $preflight$
declare
  permit sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  route sellerpilot_private.local_channel_executor_routes%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  snapshot_definition text;
  enqueue_definition text;
  snapshot_preimage_sha256 constant text :=
    'bd0f129c678e84a3f0560ac4ba30cee15e576d0d5f5ff8f3ce936b8b9f4abb29';
  enqueue_sha256 constant text :=
    '6099a7e5566c6b7264696a1a0482780d42074d82b7e8eef18cdfd428bb627752';
  worker_freshness_fragment constant text :=
    '       and worker.last_seen_at >= clock_timestamp() - interval ''3 minutes''';
  route_current_fragment constant text := $fragment$       and sellerpilot_private.local_channel_executor_route_is_current(
         permit.seller_owner_id,route.channel,route.operation,
         permit.credential_id,permit.worker_token_id,permit.release_sha,
         permit.egress_ip_sha256,worker.last_version
       )$fragment$;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_route_is_current(uuid,text,text,uuid,uuid,text,text,text)'
     ) is null then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;

  select * into strict permit
    from sellerpilot_private.coupang_exact_price_repair_permits
   where source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
     and repair_job_id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid
     and repair_attempt_id = '05508966-7665-4873-a89b-89fda8ea8a25'::uuid
   for share;
  select * into strict repair_job
    from sellerpilot_private.channel_gateway_jobs
   where id = permit.repair_job_id
   for share;
  select * into strict repair_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = permit.repair_attempt_id
   for share;
  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = permit.source_job_id
   for share;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = permit.source_attempt_id
   for share;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = permit.verifier_job_id
   for share;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = permit.listing_id
   for share;
  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = permit.credential_id
   for share;
  select * into strict worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = permit.worker_token_id
   for share;
  select * into strict route
    from sellerpilot_private.local_channel_executor_routes
   where id = permit.source_route_id
   for share;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = permit.source_job_id
     and source_attempt_id = permit.source_attempt_id
     and verifier_job_id = permit.verifier_job_id
     and listing_id = permit.listing_id
   for share;

  if permit.contract <> 'coupang_exact_price_repair_permit_v1'
     or permit.release_sha <>
       'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
     or permit.claim_count <> 1
     or permit.recovery_count <> 0
     or permit.recovered_at is not null
     or permit.bound_at is null
     or permit.bound_worker_token_id is distinct from permit.worker_token_id
     or permit.bound_claim_token is distinct from repair_job.claim_token
     or permit.consumed_at is not null
     or repair_job.status <> 'running'
     or repair_job.operation <> 'price.update'
     or repair_job.attempt_id is distinct from permit.repair_attempt_id
     or repair_job.listing_id is distinct from permit.listing_id
     or repair_job.credential_id is distinct from permit.credential_id
     or repair_job.worker_token_id is distinct from permit.worker_token_id
     or repair_job.claim_token is null
     or repair_job.attempt_count <> permit.claim_count
     or repair_job.lease_expires_at is null
     or repair_job.lease_expires_at > clock_timestamp()
     or repair_job.provider_mutation_started_at is not null
     or repair_job.completed_at is not null
     or repair_job.response_payload is not null
     or repair_job.error_message is not null
     or repair_attempt.status <> 'running'
     or repair_attempt.operation <> 'price.update'
     or repair_attempt.completed_at is not null
     or repair_attempt.remote_id is not null
     or repair_attempt.request_fingerprint is distinct from
       repair_job.request_fingerprint
     or worker.scope <> 'gateway'
     or worker.status <> 'active'
     or worker.expires_at <= clock_timestamp()
     or worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
     or worker.last_version <> 'sellerpilot-cli-worker/1.61+'
       || permit.release_sha || '.' || left(permit.egress_ip_sha256,11)
     or credential.status <> 'active'
     or credential.channel <> 'coupang'
     or credential.environment <> 'production'
     or credential.seller_account_key is distinct from
       permit.seller_account_key
     or credential.last_check_status <> 'passed'
     or route.owner_id is distinct from permit.seller_owner_id
     or route.channel <> 'coupang'
     or route.operation not in (
       'categories.attributes','categories.validate','listing.create'
     )
     or route.credential_id is distinct from permit.credential_id
     or route.worker_token_id is distinct from permit.worker_token_id
     or route.release_sha is distinct from permit.release_sha
     or route.egress_ip_sha256 is distinct from permit.egress_ip_sha256
     or not route.enabled
     or route.approved_at > clock_timestamp()
     or route.expires_at <= clock_timestamp()
     or sellerpilot_private.active_serverless_runtime_release_sha()
       <> permit.release_sha
     or sellerpilot_private.listing_mutation_release_gate_is_effective(
       'coupang'
     ) is not true
     or sellerpilot_private.coupang_exact_price_repair_job_matches(
       repair_job
     ) is not true
     or sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
       repair_job.id
     ) is not false then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_STATE_DRIFT'
      using errcode = '55000';
  end if;

  if listing.seller_account_key is not null
     or source_job.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or source_attempt.seller_account_key is distinct from
       source_job.seller_account_key
     or verifier.seller_account_key is distinct from source_job.seller_account_key
     or encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
       <> adjudication.source_job_sha256
     or encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
       <> adjudication.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
       <> adjudication.verifier_job_sha256
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256
     or encode(extensions.digest(
       adjudication.adjudication_evidence::text,'sha256'
     ),'hex') <> adjudication.adjudication_sha256 then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_EVIDENCE_DRIFT'
      using errcode = '55000';
  end if;

  if (select count(*) from
       sellerpilot_private.coupang_exact_price_repair_permits) <> 1
     or (select count(*) from sellerpilot_private.channel_gateway_jobs job
          where coalesce((job.request_payload#>'{arguments}')
            ? 'sellerpilotCoupangExactPriceRepair',false)) <> 1
     or (select count(*) from
       sellerpilot_private.channel_operation_attempts attempt
       where attempt.channel = 'coupang'
         and attempt.operation = 'price.update'
         and attempt.idempotency_key =
           'exact-coupang-price-repair:25adf712-1e9a-432b-8b0d-09cf35a826c5'
     ) <> 1 then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_DUPLICATE_DRIFT'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict snapshot_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  if encode(extensions.digest(snapshot_definition,'sha256'),'hex')
       <> snapshot_preimage_sha256
     or encode(extensions.digest(enqueue_definition,'sha256'),'hex')
       <> enqueue_sha256
     or (length(snapshot_definition)-length(pg_catalog.replace(
       snapshot_definition,worker_freshness_fragment,''
     ))) / length(worker_freshness_fragment) <> 1
     or (length(snapshot_definition)-length(pg_catalog.replace(
       snapshot_definition,route_current_fragment,''
     ))) / length(route_current_fragment) <> 1 then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_FUNCTION_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

create function sellerpilot_private.coupang_exact_price_repair_stale_recovery_context_is_current(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_price_repair_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.repair_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.repair_attempt_id
      join sellerpilot_private.local_channel_executor_routes route
        on route.id = permit.source_route_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
      join sellerpilot_private.ai_cli_worker_tokens worker
        on worker.id = permit.worker_token_id
     where permit.repair_job_id = p_job_id
       and current_setting(
         'sellerpilot.coupang_exact_price_repair_permit_recover',true
       ) = job.id::text
       and permit.contract = 'coupang_exact_price_repair_permit_v1'
       and permit.recovery_count = 1
       and permit.recovered_at is not null
       and permit.claim_count = 1
       and permit.bound_at is null
       and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null
       and permit.consumed_at is null
       and permit.expires_at > clock_timestamp()
       and job.status = 'running'
       and sellerpilot_private.coupang_exact_price_repair_job_matches(job)
       and job.attempt_id = attempt.id
       and job.credential_id = permit.credential_id
       and job.listing_id = permit.listing_id
       and job.worker_token_id = permit.worker_token_id
       and job.claim_token is not null
       and job.attempt_count = permit.claim_count
       and job.lease_expires_at is not null
       and job.lease_expires_at <= clock_timestamp()
       and job.provider_mutation_started_at is null
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and attempt.status = 'running'
       and attempt.operation = 'price.update'
       and attempt.owner_id = permit.seller_owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = job.request_fingerprint
       and credential.created_by = permit.credential_owner_id
       and credential.channel = 'coupang'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
       and credential.seller_account_verified_at =
         permit.credential_verified_at
       and credential.last_checked_at = permit.credential_last_checked_at
       and credential.last_check_status = 'passed'
       and worker.id = permit.worker_token_id
       and worker.scope = 'gateway'
       and worker.status = 'active'
       and worker.expires_at > clock_timestamp()
       and worker.last_version = 'sellerpilot-cli-worker/1.61+'
         || permit.release_sha || '.' || left(permit.egress_ip_sha256,11)
       and route.owner_id = permit.seller_owner_id
       and route.channel = 'coupang'
       and route.operation in (
         'categories.attributes','categories.validate','listing.create'
       )
       and sellerpilot_private.local_channel_executor_access(
         route.channel,route.operation
       ) is not null
       and route.credential_id = permit.credential_id
       and route.seller_account_key = permit.seller_account_key
       and route.worker_token_id = permit.worker_token_id
       and route.release_sha = permit.release_sha
       and route.egress_ip_sha256 = permit.egress_ip_sha256
       and route.enabled
       and route.approved_at <= clock_timestamp()
       and route.expires_at > clock_timestamp()
       and sellerpilot_private.active_serverless_runtime_release_sha()
         = permit.release_sha
       and sellerpilot_private.listing_mutation_release_gate_is_effective(
         route.channel
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = route.owner_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = route.approved_by
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = credential.created_by
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = worker.created_by
       )
       and exists (
         select 1
           from sellerpilot_private.serverless_static_egress_policy policy
          where policy.channel = route.channel
            and policy.enabled is false
       )
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_stale_recovery_context_is_current(uuid)
from public, anon, authenticated, service_role;

do $patch_snapshot$
declare
  definition text;
  worker_freshness_fragment constant text :=
    '       and worker.last_seen_at >= clock_timestamp() - interval ''3 minutes''';
  worker_recovery_fragment constant text := $fragment$       and (
         worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
         or sellerpilot_private.coupang_exact_price_repair_stale_recovery_context_is_current(
           p_job_id
         )
       )$fragment$;
  route_current_fragment constant text := $fragment$       and sellerpilot_private.local_channel_executor_route_is_current(
         permit.seller_owner_id,route.channel,route.operation,
         permit.credential_id,permit.worker_token_id,permit.release_sha,
         permit.egress_ip_sha256,worker.last_version
       )$fragment$;
  route_recovery_fragment constant text := $fragment$       and (
         sellerpilot_private.local_channel_executor_route_is_current(
           permit.seller_owner_id,route.channel,route.operation,
           permit.credential_id,permit.worker_token_id,permit.release_sha,
           permit.egress_ip_sha256,worker.last_version
         )
         or sellerpilot_private.coupang_exact_price_repair_stale_recovery_context_is_current(
           p_job_id
         )
       )$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict definition;
  definition := pg_catalog.replace(
    definition,worker_freshness_fragment,worker_recovery_fragment
  );
  definition := pg_catalog.replace(
    definition,route_current_fragment,route_recovery_fragment
  );
  if pg_catalog.strpos(definition,worker_freshness_fragment) > 0
     or pg_catalog.strpos(definition,route_current_fragment) > 0
     or pg_catalog.strpos(definition,
       'coupang_exact_price_repair_stale_recovery_context_is_current') = 0 then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_PATCH_FAILED'
      using errcode = '55000';
  end if;
  execute definition;
end
$patch_snapshot$;

do $postflight$
declare
  permit sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  snapshot_definition text;
  enqueue_definition text;
  helper_definition text;
  snapshot_language text;
  snapshot_security_definer boolean;
  snapshot_volatility "char";
  snapshot_config text[];
  snapshot_oid oid;
  helper_language text;
  helper_security_definer boolean;
  helper_volatility "char";
  helper_config text[];
  helper_oid oid;
  enqueue_language text;
  enqueue_security_definer boolean;
  enqueue_volatility "char";
  enqueue_config text[];
  enqueue_oid oid;
  enqueue_owner oid;
  snapshot_owner oid;
  helper_owner oid;
  snapshot_postimage_sha256 constant text :=
    'a9ce721ca8a5db0d382a84be5b6fdd2471368975549fcff16202c0efc06f311d';
  helper_sha256 constant text :=
    '878f51ccfaa60dc6386d4def313fb7175d48a621c0d53b988c7a4dcfedc046b7';
  enqueue_sha256 constant text :=
    '6099a7e5566c6b7264696a1a0482780d42074d82b7e8eef18cdfd428bb627752';
begin
  select * into strict permit
    from sellerpilot_private.coupang_exact_price_repair_permits
   where repair_job_id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid;
  select * into strict repair_job
    from sellerpilot_private.channel_gateway_jobs
   where id = permit.repair_job_id;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict snapshot_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_stale_recovery_context_is_current(uuid)'::regprocedure
  ) into strict helper_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  select procedure.oid,procedure.proowner,language.lanname,procedure.prosecdef,
         procedure.provolatile,procedure.proconfig
    into strict snapshot_oid,snapshot_owner,snapshot_language,
         snapshot_security_definer,snapshot_volatility,snapshot_config
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where procedure.oid =
     'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure;
  select procedure.oid,procedure.proowner,language.lanname,procedure.prosecdef,
         procedure.provolatile,procedure.proconfig
    into strict helper_oid,helper_owner,helper_language,
         helper_security_definer,helper_volatility,helper_config
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where procedure.oid =
     'sellerpilot_private.coupang_exact_price_repair_stale_recovery_context_is_current(uuid)'::regprocedure;
  select procedure.oid,procedure.proowner,language.lanname,procedure.prosecdef,
         procedure.provolatile,procedure.proconfig
    into strict enqueue_oid,enqueue_owner,enqueue_language,
         enqueue_security_definer,enqueue_volatility,enqueue_config
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where procedure.oid =
     'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure;

  if encode(extensions.digest(snapshot_definition,'sha256'),'hex')
       <> snapshot_postimage_sha256
     or encode(extensions.digest(helper_definition,'sha256'),'hex')
       <> helper_sha256
     or encode(extensions.digest(enqueue_definition,'sha256'),'hex')
       <> enqueue_sha256
     or snapshot_owner <> helper_owner
     or snapshot_owner <> enqueue_owner
     or snapshot_language <> 'sql'
     or not snapshot_security_definer
     or snapshot_volatility <> 's'
     or snapshot_config is distinct from array['search_path=""']::text[]
     or helper_language <> 'sql'
     or not helper_security_definer
     or helper_volatility <> 's'
     or helper_config is distinct from array['search_path=""']::text[]
     or enqueue_language <> 'plpgsql'
     or not enqueue_security_definer
     or enqueue_volatility <> 'v'
     or enqueue_config is distinct from
       array['search_path=""','TimeZone=UTC']::text[]
     or pg_catalog.has_function_privilege('anon',snapshot_oid,'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',snapshot_oid,'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',snapshot_oid,'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon',helper_oid,'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',helper_oid,'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',helper_oid,'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon',enqueue_oid,'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',enqueue_oid,'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',enqueue_oid,'EXECUTE'
     )
     or permit.claim_count <> 1
     or permit.recovery_count <> 0
     or permit.recovered_at is not null
     or permit.consumed_at is not null
     or repair_job.status <> 'running'
     or repair_job.provider_mutation_started_at is not null
     or repair_job.completed_at is not null
     or repair_job.response_payload is not null
     or repair_job.error_message is not null
     or sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
       repair_job.id
     ) is not false then
    raise exception 'COUPANG_EXACT_DEAD_WORKER_RECOVERY_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;
end
$postflight$;

commit;
