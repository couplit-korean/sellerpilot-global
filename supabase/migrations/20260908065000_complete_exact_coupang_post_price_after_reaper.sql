-- Finish the already-read exact Coupang post-price verifier after the generic
-- stale reaper cleared its expired ownership. The caller supplies the original
-- claim and the result reconstructed from the already-captured GET responses.
-- No claim, provider call, attempt increment, or standalone running lease is
-- performed by this migration. The recovery and ordinary completion execute
-- in one database transaction and roll back together on any mismatch.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

do $preflight$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  completion_definition text;
  predecessor_definition text;
  recorder_definition text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_OWNER_INVALID'
      using errcode = '42501';
  end if;
  if to_regclass(
       'sellerpilot_private.coupang_exact_post_price_reaper_completions'
     ) is not null
     or to_regprocedure(
       'sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)'
     ) is not null then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_ALREADY_INSTALLED'
      using errcode = '55000';
  end if;

  select * into strict job
    from sellerpilot_private.channel_gateway_jobs
   where id = '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into strict completion_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_before_coupang_post_price(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into strict predecessor_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.record_coupang_exact_post_price_completion(uuid)'::regprocedure
  ) into strict recorder_definition;

  if encode(extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex') <>
       '6a4dd03a0d9a8d7a0e34a4d61c30c79589f465a40a7142eecd531031c7800493'
     or encode(extensions.digest(completion_definition, 'sha256'), 'hex') <>
       'e3ad7aa1fcb0e3d2434bd3b112234e1d083d77c51504d4769308f8457d492085'
     or encode(extensions.digest(predecessor_definition, 'sha256'), 'hex') <>
       'a7de4b91dbda703f55a7e0f98242185c84519b39d65883afeb63a4f78b1ffaba'
     or encode(extensions.digest(recorder_definition, 'sha256'), 'hex') <>
       'c78c6f8adc8acb860387091f7dad1e5594b25aa815c36d1adc57dbda650e2de3'
     or job.status <> 'queued'
     or job.attempt_count <> 1
     or job.started_at is null
     or job.worker_token_id is not null
     or job.claim_token is not null
     or job.lease_expires_at is not null
     or job.completed_at is not null
     or job.response_payload is not null
     or job.error_message is not null
     or job.attempt_id is not null
     or job.listing_id is not null
     or job.provider_mutation_started_at is not null
     or job.oauth_provider_call_started_at is not null
     or job.write_resource_kind is not null
     or job.write_resource_key is not null
     or job.credential_refresh_in_flight is distinct from false
     or job.credential_refresh_fingerprint is not null
     or job.prepared_credential_id is not null
     or job.credential_refresh_prepared_at is not null
     or job.credential_refresh_recovery_vault_id is not null
     or job.credential_refresh_recovery_fingerprint is not null
     or job.credential_refresh_recovery_staged_at is not null
     or job.credential_refresh_started_at is not null
     or job.oauth_request_vault_id is not null
     or job.oauth_request_fingerprint is not null
     or job.oauth_source_credential_id is not null
     or job.oauth_exchange_completed is distinct from false
     or sellerpilot_private.coupang_exact_post_price_verifier_job_matches(job)
          is not true
     or sellerpilot_private.coupang_exact_post_price_source_current(job.id)
          is not true
     or (
       select count(*)
         from sellerpilot_private.coupang_exact_post_price_verify_runs run
        where run.verifier_job_id = job.id
     ) <> 1
     or exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = job.id
     )
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
        where receipt.verifier_job_id = job.id
     )
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'sellerpilot_private.coupang_exact_post_price_completion_valid(uuid)'::regprocedure
       ),
       'coupang_item_product_id_optional_when_root_exact_v1'
     ) = 0 then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

create table sellerpilot_private.coupang_exact_post_price_reaper_completions (
  verifier_job_id uuid primary key references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  worker_token_id uuid not null references
    sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  claim_token uuid not null,
  queued_job_snapshot jsonb not null,
  queued_job_sha256 text not null check (
    queued_job_sha256 ~ '^[a-f0-9]{64}$'
  ),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  completed_job_snapshot jsonb not null,
  completed_job_sha256 text not null check (
    completed_job_sha256 ~ '^[a-f0-9]{64}$'
  ),
  provider_mutation_performed boolean not null default false check (
    provider_mutation_performed is false
  ),
  contract text not null check (
    contract = 'coupang_exact_post_price_reaper_atomic_completion_v1'
  ),
  recovered_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.coupang_exact_post_price_reaper_completions
  enable row level security;
alter table sellerpilot_private.coupang_exact_post_price_reaper_completions
  owner to postgres;
revoke all on table
sellerpilot_private.coupang_exact_post_price_reaper_completions
from public, anon, authenticated, service_role;

create function sellerpilot_private.reject_coupang_exact_post_price_reaper_completion_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_IMMUTABLE'
    using errcode = '55000';
end
$$;

alter function
sellerpilot_private.reject_coupang_exact_post_price_reaper_completion_change()
owner to postgres;
revoke all on function
sellerpilot_private.reject_coupang_exact_post_price_reaper_completion_change()
from public, anon, authenticated, service_role;

create trigger reject_coupang_exact_post_price_reaper_completion_change
before update or delete on
sellerpilot_private.coupang_exact_post_price_reaper_completions
for each row execute function
sellerpilot_private.reject_coupang_exact_post_price_reaper_completion_change();

create function sellerpilot_private.complete_exact_coupang_post_price_after_reaper(
  p_claim_token uuid,
  p_response_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  expected_job_id constant uuid :=
    '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid;
  expected_job_sha constant text :=
    '6a4dd03a0d9a8d7a0e34a4d61c30c79589f465a40a7142eecd531031c7800493';
  expected_claim_sha constant text :=
    '4c08b0cf88c6d7543f7a4241ff6591624f1bb14bde18ff51ffa3ef985901da36';
  expected_response_sha constant text :=
    '77c6aa6a25c65f801b3064d776a80bbfce49408680a1916a12dd1112bfbd43d1';
  expected_completion_sha constant text :=
    'e3ad7aa1fcb0e3d2434bd3b112234e1d083d77c51504d4769308f8457d492085';
  expected_predecessor_sha constant text :=
    'a7de4b91dbda703f55a7e0f98242185c84519b39d65883afeb63a4f78b1ffaba';
  expected_recorder_sha constant text :=
    'c78c6f8adc8acb860387091f7dad1e5594b25aa815c36d1adc57dbda650e2de3';
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  completed_job sellerpilot_private.channel_gateway_jobs%rowtype;
  run sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  recovery
    sellerpilot_private.coupang_exact_post_price_reaper_completions%rowtype;
  queued_snapshot jsonb;
  completed_snapshot jsonb;
  queued_sha text;
  response_sha text;
  result jsonb;
  new_expiry timestamptz;
  updated_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(1637578093, 8072065);

  if p_claim_token is null
     or encode(
       extensions.digest(p_claim_token::text, 'sha256'), 'hex'
     ) <> expected_claim_sha
     or p_response_payload is null
     or jsonb_typeof(p_response_payload) <> 'object'
     or octet_length(p_response_payload::text) > 1000000 then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_INPUT_INVALID'
      using errcode = '22023';
  end if;
  response_sha := encode(
    extensions.digest(p_response_payload::text, 'sha256'), 'hex'
  );
  if response_sha <> expected_response_sha then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_RESPONSE_DRIFT'
      using errcode = '22023';
  end if;

  select * into job
    from sellerpilot_private.channel_gateway_jobs
   where id = expected_job_id
   for update;
  if job.id is null then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_JOB_MISSING'
      using errcode = '55000';
  end if;

  select * into recovery
    from sellerpilot_private.coupang_exact_post_price_reaper_completions
   where verifier_job_id = expected_job_id;
  if recovery.verifier_job_id is not null then
    if job.status <> 'succeeded'
       or job.attempt_count <> 1
       or recovery.claim_token <> p_claim_token
       or recovery.response_sha256 <> response_sha
       or recovery.completed_job_snapshot <> to_jsonb(job)
       or recovery.completed_job_sha256 <> encode(
         extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex'
       )
       or not exists (
         select 1 from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = job.id
            and receipt.claim_token = p_claim_token
       )
       or not exists (
         select 1
           from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
          where receipt.verifier_job_id = job.id
            and receipt.response_sha256 = response_sha
       ) then
      raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_REPLAY_DRIFT'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'status', 'completed_replay',
      'jobId', job.id,
      'attemptCount', job.attempt_count,
      'providerMutationPerformed', false
    );
  end if;

  queued_snapshot := to_jsonb(job);
  queued_sha := encode(
    extensions.digest(queued_snapshot::text, 'sha256'), 'hex'
  );
  select * into run
    from sellerpilot_private.coupang_exact_post_price_verify_runs
   where verifier_job_id = job.id;
  select * into worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = run.worker_token_id;
  new_expiry := clock_timestamp() + interval '5 minutes';

  if queued_sha <> expected_job_sha
     or job.status <> 'queued'
     or job.attempt_count <> 1
     or job.started_at is null
     or job.worker_token_id is not null
     or job.claim_token is not null
     or job.lease_expires_at is not null
     or job.completed_at is not null
     or job.response_payload is not null
     or job.error_message is not null
     or job.attempt_id is not null
     or job.listing_id is not null
     or job.provider_mutation_started_at is not null
     or job.oauth_provider_call_started_at is not null
     or job.write_resource_kind is not null
     or job.write_resource_key is not null
     or job.credential_refresh_in_flight is distinct from false
     or job.credential_refresh_fingerprint is not null
     or job.prepared_credential_id is not null
     or job.credential_refresh_prepared_at is not null
     or job.credential_refresh_recovery_vault_id is not null
     or job.credential_refresh_recovery_fingerprint is not null
     or job.credential_refresh_recovery_staged_at is not null
     or job.credential_refresh_started_at is not null
     or job.oauth_request_vault_id is not null
     or job.oauth_request_fingerprint is not null
     or job.oauth_source_credential_id is not null
     or job.oauth_exchange_completed is distinct from false
     or run.verifier_job_id is null
     or run.worker_token_id is distinct from
       '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
     or worker.id is distinct from run.worker_token_id
     or worker.scope <> 'gateway'
     or worker.status <> 'active'
     or worker.expires_at <= new_expiry
     or sellerpilot_private.active_serverless_runtime_release_sha() <>
       run.release_sha
     or sellerpilot_private.coupang_exact_post_price_verifier_job_matches(job)
          is not true
     or sellerpilot_private.coupang_exact_post_price_source_current(job.id)
          is not true
     or exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = job.id
     )
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
        where receipt.verifier_job_id = job.id
     ) then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_STATE_DRIFT'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs current_job
     set status = 'running',
         worker_token_id = run.worker_token_id,
         claim_token = p_claim_token,
         lease_expires_at = new_expiry,
         updated_at = clock_timestamp()
   where current_job.id = job.id
     and to_jsonb(current_job) = queued_snapshot;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_RESTORE_LOST'
      using errcode = '55000';
  end if;

  if encode(extensions.digest(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
     ), 'sha256'), 'hex') is distinct from expected_completion_sha
     or encode(extensions.digest(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_complete_before_coupang_post_price(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
     ), 'sha256'), 'hex') is distinct from expected_predecessor_sha
     or encode(extensions.digest(pg_catalog.pg_get_functiondef(
       'sellerpilot_private.record_coupang_exact_post_price_completion(uuid)'::regprocedure
     ), 'sha256'), 'hex') is distinct from expected_recorder_sha then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_CALL_GRAPH_DRIFT'
      using errcode = '55000';
  end if;

  result := public.sellerpilot_service_complete_gateway_transaction(
    worker.token_hash,
    job.id,
    p_claim_token,
    'succeeded',
    p_response_payload,
    null,
    null,
    null,
    null,
    null
  );
  if result->>'status' <> 'completed'
     or result->>'replayed' = 'true' then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_NOT_COMPLETED'
      using errcode = '55000';
  end if;

  select * into strict completed_job
    from sellerpilot_private.channel_gateway_jobs
   where id = job.id;
  completed_snapshot := to_jsonb(completed_job);
  if completed_job.status <> 'succeeded'
     or completed_job.attempt_count <> 1
     or completed_job.worker_token_id is not null
     or completed_job.claim_token is not null
     or completed_job.lease_expires_at is not null
     or completed_job.completed_at is null
     or completed_job.error_message is not null
     or completed_job.response_payload <> p_response_payload
     or completed_job.provider_mutation_started_at is not null
     or completed_job.oauth_provider_call_started_at is not null
     or completed_job.write_resource_kind is not null
     or completed_job.write_resource_key is not null
     or sellerpilot_private.coupang_exact_post_price_completion_valid(job.id)
          is not true
     or not exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = job.id
          and receipt.worker_token_id = run.worker_token_id
          and receipt.claim_token = p_claim_token
     )
     or not exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
        where receipt.verifier_job_id = job.id
          and receipt.response_sha256 = response_sha
          and receipt.claim_attempt_count = 1
          and receipt.provider_live_verified
          and not receipt.provider_mutation_performed
     ) then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  insert into
  sellerpilot_private.coupang_exact_post_price_reaper_completions (
    verifier_job_id,
    worker_token_id,
    claim_token,
    queued_job_snapshot,
    queued_job_sha256,
    response_sha256,
    completed_job_snapshot,
    completed_job_sha256,
    provider_mutation_performed,
    contract,
    recovered_at
  ) values (
    job.id,
    run.worker_token_id,
    p_claim_token,
    queued_snapshot,
    queued_sha,
    response_sha,
    completed_snapshot,
    encode(extensions.digest(completed_snapshot::text, 'sha256'), 'hex'),
    false,
    'coupang_exact_post_price_reaper_atomic_completion_v1',
    clock_timestamp()
  );

  return jsonb_build_object(
    'status', 'completed',
    'jobId', job.id,
    'attemptCount', completed_job.attempt_count,
    'providerMutationPerformed', false
  );
end
$$;

alter function
sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)
owner to postgres;
revoke all on function
sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)
from public, anon, authenticated, service_role;

do $postflight$
declare
  procedure_name constant regprocedure :=
    'sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)'::regprocedure;
  definition text;
  security_definer boolean;
  procedure_config text[];
  exposed_acl_count integer;
  exact_owner_count integer;
  unauthorized_acl_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure_name),
         procedure.prosecdef,
         procedure.proconfig
    into strict definition, security_definer, procedure_config
    from pg_catalog.pg_proc procedure
   where procedure.oid = procedure_name;
  select count(*) into strict exposed_acl_count
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
   where pg_catalog.has_function_privilege(
     roles.role_name, procedure_name, 'EXECUTE'
   );
  select count(*) into strict exact_owner_count
    from pg_catalog.pg_proc procedure
   where procedure.oid in (
     procedure_name,
     'sellerpilot_private.reject_coupang_exact_post_price_reaper_completion_change()'::regprocedure
   )
     and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres';
  select exact_owner_count + count(*) into strict exact_owner_count
    from pg_catalog.pg_class relation
   where relation.oid =
       'sellerpilot_private.coupang_exact_post_price_reaper_completions'::regclass
     and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres';
  select count(*) into strict unauthorized_acl_count
    from (
      select acl.grantee
        from pg_catalog.pg_proc procedure
        cross join lateral pg_catalog.aclexplode(coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )) acl
       where procedure.oid in (
         procedure_name,
         'sellerpilot_private.reject_coupang_exact_post_price_reaper_completion_change()'::regprocedure
       )
         and acl.grantee <> procedure.proowner
      union all
      select acl.grantee
        from pg_catalog.pg_class relation
        cross join lateral pg_catalog.aclexplode(coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )) acl
       where relation.oid =
         'sellerpilot_private.coupang_exact_post_price_reaper_completions'::regclass
         and acl.grantee <> relation.relowner
    ) unauthorized;
  if pg_catalog.strpos(
       definition,
       'coupang_exact_post_price_reaper_atomic_completion_v1'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'public.sellerpilot_service_complete_gateway_transaction('
     ) = 0
     or security_definer is not true
     or not exists (
       select 1
         from unnest(coalesce(procedure_config, '{}'::text[])) config(value)
        where config.value in ('search_path=', 'search_path=""')
     )
     or exposed_acl_count <> 0
     or exact_owner_count <> 3
     or unauthorized_acl_count <> 0
     or (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid
          and encode(
            extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex'
          ) = '6a4dd03a0d9a8d7a0e34a4d61c30c79589f465a40a7142eecd531031c7800493'
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_reaper_completions
     ) then
    raise exception 'COUPANG_POST_PRICE_REAPER_COMPLETION_INSTALL_DRIFT'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on table
sellerpilot_private.coupang_exact_post_price_reaper_completions is
'Immutable proof that the exact post-price verifier was atomically completed from its original claim after the generic stale reaper cleared ownership; no provider call is performed.';
comment on function
sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb) is
'Atomically restores and completes only the exact reaped Coupang post-price verifier from its original claim and already-captured GET result.';

commit;
