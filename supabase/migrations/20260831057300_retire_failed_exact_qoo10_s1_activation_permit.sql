-- Retire the single exact Qoo10 S1 activation permit that was claimed and
-- completed as a proven pre-provider failure before migration 572 admitted
-- listing.activate at the innermost provider boundary.  The failed job,
-- attempt, completion receipt and immutable outcome remain untouched.
--
-- The old outcome must also stop monopolizing source/listing uniqueness.  Only
-- a payloadless failed outcome whose permit was explicitly retired by this
-- evidence fence may be retried.  Any succeeded, reconciliation-required, or
-- provider-observed outcome remains a single decisive terminal outcome.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $qoo10_failed_permit_history_and_preimage$
declare
  v_history_table regclass;
  v_binding_sha text;
  v_provider_boundary_sha text;
  v_unique_count integer;
  v_rpc_count integer;
begin
  v_history_table := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if (
      select pg_catalog.count(*)
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831057200'
         and migration.name =
               'allow_exact_qoo10_s1_activation_provider_boundary'
         and pg_catalog.cardinality(migration.statements) = 0
    ) <> 1
       or exists (
         select 1
           from supabase_migrations.schema_migrations migration
          where migration.version = '20260831057300'
       )
    then
      raise exception 'exact Qoo10 failed-permit migration history drifted'
        using errcode = '55000';
    end if;
  elsif exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_activation_permits
  ) or exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_activation_outcomes
  ) or exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_verifier_runs
  ) or exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_observations
  ) then
    -- Schema-only replay is allowed without CLI history only before any exact
    -- activation evidence exists.  A hosted target can never infer history
    -- from schema when production rows are present.
    raise exception 'exact Qoo10 failed-permit migration history unavailable'
      using errcode = '55000';
  end if;

  select encode(extensions.digest(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           'sha256'
         ), 'hex')
    into v_binding_sha
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
           'sellerpilot_private.qoo10_exact_s1_activation_permits'::regclass
     and constraint_row.conname =
           'qoo10_exact_s1_activation_binding_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated
     and not constraint_row.condeferrable
     and not constraint_row.condeferred;
  if v_binding_sha is distinct from
       'd32fc569d88ecf21e069e39fd451b7af207be8c0d1ac6d8bb106f3862c8ee7f9'
  then
    raise exception 'exact Qoo10 activation binding constraint drifted'
      using errcode = '55000';
  end if;

  select encode(extensions.digest(pg_catalog.pg_get_functiondef(
           'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
         ), 'sha256'), 'hex')
    into v_provider_boundary_sha;
  if v_provider_boundary_sha is distinct from
       '968b6336c02432bd790445b90902548f6182e3b4128d2c533151d95c90347b06'
  then
    raise exception 'exact Qoo10 provider-boundary function drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)
    into v_unique_count
    from (
      values
        ('qoo10_exact_s1_activation_outcomes_source_job_id_key',
         'UNIQUE (source_job_id)',
         '444073b05fd6664a1e7b6b650a632d2a'),
        ('qoo10_exact_s1_activation_outcomes_verifier_job_id_key',
         'UNIQUE (verifier_job_id)',
         '88ec8d06ce8207592bf0b65b3cc5e840'),
        ('qoo10_exact_s1_activation_outcomes_listing_id_key',
         'UNIQUE (listing_id)',
         '3a8c501d269810afde2adef4d187ea35')
    ) expected(constraint_name,definition,definition_md5)
    join pg_catalog.pg_constraint constraint_row
      on constraint_row.conrelid =
           'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
     and constraint_row.conname = expected.constraint_name
     and constraint_row.contype = 'u'
     and constraint_row.convalidated
     and not constraint_row.condeferrable
     and not constraint_row.condeferred
     and pg_catalog.pg_get_constraintdef(constraint_row.oid) =
           expected.definition
     and pg_catalog.md5(pg_catalog.pg_get_constraintdef(
           constraint_row.oid
         )) = expected.definition_md5;
  if v_unique_count <> 3 then
    raise exception 'exact Qoo10 activation outcome uniqueness drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)
    into v_rpc_count
    from (
      values
        ('public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text)',
         '5f72b59b4ac2dfb4601472f218d4d428'),
        ('public.sellerpilot_service_enqueue_exact_qoo10_s1_activation(uuid,text)',
         '735d1bf88e8e213fb144b1099bacb068')
    ) expected(signature,definition_md5)
    join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where owner.rolname = 'postgres'
     and language.lanname = 'plpgsql'
     and procedure.prosecdef
     and procedure.provolatile = 'v'
     and not procedure.proisstrict
     and procedure.proconfig = array['search_path=""']::text[]
     and procedure.proacl::text =
           '{postgres=X/postgres,service_role=X/postgres}'
     and pg_catalog.md5(pg_catalog.pg_get_functiondef(procedure.oid)) =
           expected.definition_md5;
  if v_rpc_count <> 2 then
    raise exception 'exact Qoo10 activation retry RPC preimage drifted'
      using errcode = '55000';
  end if;

  if not (
    select relation.relrowsecurity
      from pg_catalog.pg_class relation
     where relation.oid =
       'sellerpilot_private.qoo10_exact_s1_activation_permits'::regclass
  ) or not (
    select relation.relrowsecurity
      from pg_catalog.pg_class relation
     where relation.oid =
       'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
  ) or exists (
    select 1
      from (values
        ('public'::name),('anon'::name),('authenticated'::name),
        ('service_role'::name)
      ) role(role_name)
      cross join (values
        ('sellerpilot_private.qoo10_exact_s1_activation_permits'::text),
        ('sellerpilot_private.qoo10_exact_s1_activation_outcomes'::text)
      ) relation(relation_name)
      cross join (values
        ('SELECT'::text),('INSERT'::text),('UPDATE'::text),('DELETE'::text),
        ('TRUNCATE'::text),('REFERENCES'::text),('TRIGGER'::text)
      ) privilege(privilege_name)
     where pg_catalog.has_table_privilege(
       role.role_name, relation.relation_name, privilege.privilege_name
     )
  ) then
    raise exception 'exact Qoo10 activation ledger privilege drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_failed_permit_history_and_preimage$;

lock table sellerpilot_private.qoo10_exact_s1_activation_permits
  in access exclusive mode;
lock table sellerpilot_private.qoo10_exact_s1_activation_outcomes,
  sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.channel_operation_attempts,
  sellerpilot_private.gateway_completion_receipts
  in share row exclusive mode;

alter table sellerpilot_private.qoo10_exact_s1_activation_permits
  drop constraint qoo10_exact_s1_activation_binding_check;
alter table sellerpilot_private.qoo10_exact_s1_activation_permits
  add constraint qoo10_exact_s1_activation_binding_check check (
    (
      invalidated_at is null and invalidation_reason is null
      and (
        (
          bound_at is null and bound_worker_token_id is null
          and bound_claim_token is null and consumed_at is null
        ) or (
          bound_at is not null and bound_worker_token_id is not null
          and bound_claim_token is not null
          and (consumed_at is null or consumed_at >= bound_at)
        )
      )
    ) or (
      invalidated_at is not null
      and invalidated_at >= expires_at
      and invalidation_reason = 'expired_before_claim'
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
    ) or (
      invalidated_at is not null
      and invalidated_at >= expires_at
      and invalidated_at >= bound_at
      and invalidation_reason = 'failed_before_provider'
      and bound_at is not null
      and bound_at >= armed_at
      and bound_at < expires_at
      and bound_worker_token_id is not null
      and bound_claim_token is not null
      and consumed_at is null
    )
  );

alter table sellerpilot_private.qoo10_exact_s1_activation_outcomes
  drop constraint qoo10_exact_s1_activation_outcomes_source_job_id_key;
alter table sellerpilot_private.qoo10_exact_s1_activation_outcomes
  drop constraint qoo10_exact_s1_activation_outcomes_listing_id_key;

-- Row-local indexes retain one decisive terminal outcome.  A payloadless
-- failed row is excluded only from these indexes; the cross-table helper and
-- both enqueue RPCs below still require its exact retired-permit evidence.
create unique index qoo10_exact_s1_one_decisive_source_outcome
  on sellerpilot_private.qoo10_exact_s1_activation_outcomes(source_job_id)
  where not (
    terminal_status = 'failed'
    and activation_response_sha256 is null
    and activation_response_bytes is null
    and provider_status is null
    and remote_visibility is null
    and verified_at is null
  );
create unique index qoo10_exact_s1_one_decisive_listing_outcome
  on sellerpilot_private.qoo10_exact_s1_activation_outcomes(listing_id)
  where not (
    terminal_status = 'failed'
    and activation_response_sha256 is null
    and activation_response_bytes is null
    and provider_status is null
    and remote_visibility is null
    and verified_at is null
  );

create function sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(
  p_activation_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
      join sellerpilot_private.qoo10_exact_s1_activation_permits permit
        on permit.activation_job_id = outcome.activation_job_id
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.activation_attempt_id
     where outcome.activation_job_id = p_activation_job_id
       and outcome.source_job_id = permit.source_job_id
       and outcome.verifier_job_id = permit.verifier_job_id
       and outcome.listing_id = permit.listing_id
       and outcome.remote_id = permit.remote_id
       and outcome.terminal_status = 'failed'
       and outcome.activation_response_sha256 is null
       and outcome.activation_response_bytes is null
       and outcome.provider_status is null
       and outcome.remote_visibility is null
       and outcome.verified_at is null
       and outcome.completed_at = job.completed_at
       and outcome.contract = 'qoo10_exact_s1_activation_outcome_v1'
       and permit.invalidated_at is not null
       and permit.invalidated_at >= permit.expires_at
       and permit.invalidated_at >= permit.bound_at
       and permit.invalidation_reason = 'failed_before_provider'
       and permit.bound_at is not null
       and permit.bound_at >= permit.armed_at
       and permit.bound_at < permit.expires_at
       and permit.bound_worker_token_id is not null
       and permit.bound_claim_token is not null
       and permit.consumed_at is null
       and job.credential_id = permit.credential_id
       and job.attempt_id = permit.activation_attempt_id
       and job.listing_id = permit.listing_id
       and job.channel = 'qoo10'
       and job.operation = 'listing.activate'
       and job.environment = 'production'
       and job.status = 'failed'
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.activation_request_sha256
       and octet_length(job.request_payload::text) =
             permit.activation_request_bytes
       and encode(extensions.digest(job.request_payload::text,'sha256'),'hex') =
             permit.activation_request_sha256
       and job.write_resource_kind = 'listing_mutation'
       and job.write_resource_key = permit.write_resource_key
       and job.attempt_count = 1
       and job.started_at is not null
       and job.completed_at is not null
       and job.provider_mutation_started_at is null
       and job.response_payload is null
       and job.worker_token_id is null
       and job.claim_token is null
       and job.lease_expires_at is null
       and attempt.credential_id = permit.credential_id
       and attempt.owner_id = permit.owner_id
       and attempt.channel = 'qoo10'
       and attempt.operation = 'listing.activate'
       and attempt.request_fingerprint = permit.activation_request_sha256
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.status = 'failed'
       and attempt.http_status = 422
       and attempt.gateway_write_required
       and not attempt.pre_gateway_retryable
       and attempt.started_at is not null
       and attempt.completed_at = job.completed_at
       and (
         select pg_catalog.count(*)
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = permit.activation_job_id
       ) = 1
       and exists (
         select 1
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = permit.activation_job_id
            and receipt.claim_token = permit.bound_claim_token
            and receipt.worker_token_id = permit.bound_worker_token_id
            and receipt.continuation_job_id is null
            and receipt.completion_fingerprint ~ '^[a-f0-9]{64}$'
       )
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(uuid)
  from public, anon, authenticated, service_role;

do $qoo10_failed_permit_patch_enqueue_rpcs$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.md5(v_definition) <>
       '5f72b59b4ac2dfb4601472f218d4d428'
  then
    raise exception 'exact Qoo10 verifier enqueue preimage drifted'
      using errcode = '55000';
  end if;
  v_rewritten := pg_catalog.replace(
    v_definition,
    $needle$or exists (
       select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits
        where invalidated_at is null
     )
  then$needle$,
    $replacement$or exists (
       select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits
        where invalidated_at is null
     )
     or exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
        where outcome.source_job_id = p_source_job_id
          and not sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(
            outcome.activation_job_id
          )
     )
  then$replacement$
  );
  if v_rewritten = v_definition then
    raise exception 'exact Qoo10 verifier retry fence patch missed preimage'
      using errcode = '55000';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_qoo10_s1_activation(uuid,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.md5(v_definition) <>
       '735d1bf88e8e213fb144b1099bacb068'
  then
    raise exception 'exact Qoo10 activation enqueue preimage drifted'
      using errcode = '55000';
  end if;
  v_rewritten := pg_catalog.replace(
    v_definition,
    $needle$or not sellerpilot_private.qoo10_exact_s1_source_is_current()
  then$needle$,
    $replacement$or not sellerpilot_private.qoo10_exact_s1_source_is_current()
     or exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
        where (
          outcome.source_job_id = v_run.source_job_id
          or outcome.listing_id = v_run.listing_id
        )
          and not sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(
            outcome.activation_job_id
          )
     )
  then$replacement$
  );
  if v_rewritten = v_definition then
    raise exception 'exact Qoo10 activation retry fence patch missed preimage'
      using errcode = '55000';
  end if;
  execute v_rewritten;
end;
$qoo10_failed_permit_patch_enqueue_rpcs$;

do $qoo10_failed_permit_exact_data_patch$
declare
  c_activation_job_id constant uuid :=
    '7ec26a02-0507-4385-8da6-ccd393891556'::uuid;
  c_verifier_job_id constant uuid :=
    '69137e9b-b888-4f4e-9ae6-c7b262943b1b'::uuid;
  c_source_job_id constant uuid :=
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid;
  c_listing_id constant uuid :=
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid;
  c_credential_id constant uuid :=
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  c_release_sha constant text :=
    '495c504d37607c8ec63c270baaf74971cfc5dce4';
  c_request_payload_sha constant text :=
    'c6554bb1d891af5367c9df3d0b3d3e5f5d092614e6d8113a4f10e3845be25db9';
  c_completion_fingerprint constant text :=
    '7312499def14d2bf03937d3e6e4a55faed7ea57867fe72dc697f9629bd0fde2a';
  c_receipt_row_sha constant text :=
    'c73b8cf53aabbbdf58c20594250dc99dc289ffdfd7b142712eedf983477c76ee';

  v_permit_before jsonb;
  v_permit_after jsonb;
  v_job_before jsonb;
  v_attempt_before jsonb;
  v_receipt_before jsonb;
  v_outcome_before jsonb;
  v_permit_total bigint;
  v_outcome_total bigint;
  v_job_total bigint;
  v_attempt_total bigint;
  v_receipt_total bigint;
  v_rows integer;
begin
  select to_jsonb(permit) into v_permit_before
    from sellerpilot_private.qoo10_exact_s1_activation_permits permit
   where permit.activation_job_id = c_activation_job_id;
  if v_permit_before is null then
    -- A deterministic schema replay has no exact production evidence.  It is
    -- safe only while all exact permit/outcome ledgers remain empty.
    if exists (
      select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits
    ) or exists (
      select 1 from sellerpilot_private.qoo10_exact_s1_activation_outcomes
    ) or exists (
      select 1 from sellerpilot_private.qoo10_exact_s1_verifier_runs
    ) or exists (
      select 1 from sellerpilot_private.qoo10_exact_s1_observations
    ) then
      raise exception 'exact Qoo10 failed permit target is missing amid evidence'
        using errcode = '55000';
    end if;
    return;
  end if;

  select to_jsonb(job) into strict v_job_before
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = c_activation_job_id;
  select to_jsonb(attempt) into strict v_attempt_before
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = (v_permit_before->>'activation_attempt_id')::uuid;
  select to_jsonb(receipt) into strict v_receipt_before
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = c_activation_job_id;
  select to_jsonb(outcome) into strict v_outcome_before
    from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
   where outcome.activation_job_id = c_activation_job_id;

  select count(*) into v_permit_total
    from sellerpilot_private.qoo10_exact_s1_activation_permits;
  select count(*) into v_outcome_total
    from sellerpilot_private.qoo10_exact_s1_activation_outcomes;
  select count(*) into v_job_total
    from sellerpilot_private.channel_gateway_jobs;
  select count(*) into v_attempt_total
    from sellerpilot_private.channel_operation_attempts;
  select count(*) into v_receipt_total
    from sellerpilot_private.gateway_completion_receipts;

  if (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_permits
       where invalidated_at is null) <> 1
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_permits
          where invalidated_at is null and bound_at is not null
            and consumed_at is null) <> 1
     or (select count(*) from sellerpilot_private.gateway_completion_receipts
          where job_id = c_activation_job_id) <> 1
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_outcomes
          where activation_job_id = c_activation_job_id) <> 1
     or (v_permit_before->>'verifier_job_id')::uuid <> c_verifier_job_id
     or (v_permit_before->>'source_job_id')::uuid <> c_source_job_id
     or (v_permit_before->>'listing_id')::uuid <> c_listing_id
     or (v_permit_before->>'credential_id')::uuid <> c_credential_id
     or v_permit_before->>'remote_id' <> '1217336970'
     or v_permit_before->>'release_sha' <> c_release_sha
     or v_permit_before->>'contract' <>
          'qoo10_exact_s1_activation_permit_v1'
     or v_permit_before->'bound_at' = 'null'::jsonb
     or v_permit_before->'bound_worker_token_id' = 'null'::jsonb
     or v_permit_before->'bound_claim_token' = 'null'::jsonb
     or v_permit_before->'consumed_at' <> 'null'::jsonb
     or v_permit_before->'invalidated_at' <> 'null'::jsonb
     or v_permit_before->'invalidation_reason' <> 'null'::jsonb
     or (v_permit_before->>'expires_at')::timestamptz > statement_timestamp()
     or (v_permit_before->>'bound_at')::timestamptz <
          (v_permit_before->>'armed_at')::timestamptz
     or (v_permit_before->>'bound_at')::timestamptz >=
          (v_permit_before->>'expires_at')::timestamptz
     or v_job_before->>'status' <> 'failed'
     or v_job_before->>'channel' <> 'qoo10'
     or v_job_before->>'operation' <> 'listing.activate'
     or v_job_before->>'environment' <> 'production'
     or (v_job_before->>'credential_id')::uuid <> c_credential_id
     or (v_job_before->>'attempt_id')::uuid <>
          (v_permit_before->>'activation_attempt_id')::uuid
     or (v_job_before->>'listing_id')::uuid <> c_listing_id
     or (v_job_before->>'attempt_count')::integer <> 1
     or v_job_before->'provider_mutation_started_at' <> 'null'::jsonb
     or v_job_before->'response_payload' <> 'null'::jsonb
     or v_job_before->'worker_token_id' <> 'null'::jsonb
     or v_job_before->'claim_token' <> 'null'::jsonb
     or v_job_before->'lease_expires_at' <> 'null'::jsonb
     or v_job_before->'started_at' = 'null'::jsonb
     or v_job_before->'completed_at' = 'null'::jsonb
     or v_job_before->>'request_fingerprint' <>
          v_permit_before->>'activation_request_sha256'
     or encode(extensions.digest(
          (v_job_before->'request_payload')::text,'sha256'
        ),'hex') <> c_request_payload_sha
     or v_job_before->>'write_resource_kind' <> 'listing_mutation'
     or v_job_before->>'write_resource_key' <>
          v_permit_before->>'write_resource_key'
     or v_job_before#>>'{request_payload,arguments,sellerpilotQoo10S1Activation,sourceJobId}' <>
          c_source_job_id::text
     or v_job_before#>>'{request_payload,arguments,sellerpilotQoo10S1Activation,verifierJobId}' <>
          c_verifier_job_id::text
     or v_job_before#>>'{request_payload,arguments,sellerpilotQoo10S1Activation,remoteId}' <>
          '1217336970'
     or v_attempt_before->>'status' <> 'failed'
     or v_attempt_before->>'channel' <> 'qoo10'
     or v_attempt_before->>'operation' <> 'listing.activate'
     or (v_attempt_before->>'http_status')::integer <> 422
     or v_attempt_before->'completed_at' <> v_job_before->'completed_at'
     or v_attempt_before->>'request_fingerprint' <>
          v_permit_before->>'activation_request_sha256'
     or v_attempt_before->>'seller_account_key' <>
          v_permit_before->>'seller_account_key'
     or v_attempt_before->'gateway_write_required' <> 'true'::jsonb
     or v_attempt_before->'pre_gateway_retryable' <> 'false'::jsonb
     or (v_receipt_before->>'claim_token')::uuid <>
          (v_permit_before->>'bound_claim_token')::uuid
     or (v_receipt_before->>'worker_token_id')::uuid <>
          (v_permit_before->>'bound_worker_token_id')::uuid
     or v_receipt_before->>'completion_fingerprint' <>
          c_completion_fingerprint
     or v_receipt_before->'continuation_job_id' <> 'null'::jsonb
     or encode(extensions.digest(v_receipt_before::text,'sha256'),'hex') <>
          c_receipt_row_sha
     or v_outcome_before->>'terminal_status' <> 'failed'
     or (v_outcome_before->>'source_job_id')::uuid <> c_source_job_id
     or (v_outcome_before->>'verifier_job_id')::uuid <> c_verifier_job_id
     or (v_outcome_before->>'listing_id')::uuid <> c_listing_id
     or v_outcome_before->>'remote_id' <> '1217336970'
     or v_outcome_before->'activation_response_sha256' <> 'null'::jsonb
     or v_outcome_before->'activation_response_bytes' <> 'null'::jsonb
     or v_outcome_before->'provider_status' <> 'null'::jsonb
     or v_outcome_before->'remote_visibility' <> 'null'::jsonb
     or v_outcome_before->'verified_at' <> 'null'::jsonb
     or v_outcome_before->'completed_at' <> v_job_before->'completed_at'
     or v_outcome_before->>'contract' <>
          'qoo10_exact_s1_activation_outcome_v1'
     or not sellerpilot_private.qoo10_exact_s1_source_is_current()
  then
    raise exception 'exact Qoo10 failed-before-provider evidence drifted'
      using errcode = '55000';
  end if;

  update sellerpilot_private.qoo10_exact_s1_activation_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'failed_before_provider'
   where permit.activation_job_id = c_activation_job_id
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp()
     and permit.bound_at is not null
     and permit.bound_worker_token_id is not null
     and permit.bound_claim_token is not null
     and permit.consumed_at is null
     and exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = permit.activation_job_id
          and receipt.claim_token = permit.bound_claim_token
          and receipt.worker_token_id = permit.bound_worker_token_id
          and receipt.continuation_job_id is null
          and receipt.completion_fingerprint = c_completion_fingerprint
     );
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'exact Qoo10 failed permit retirement lost row ownership'
      using errcode = '40001';
  end if;

  select to_jsonb(permit) into strict v_permit_after
    from sellerpilot_private.qoo10_exact_s1_activation_permits permit
   where permit.activation_job_id = c_activation_job_id;
  if (v_permit_after - 'invalidated_at' - 'invalidation_reason') <>
       (v_permit_before - 'invalidated_at' - 'invalidation_reason')
     or v_permit_after->>'invalidation_reason' <> 'failed_before_provider'
     or (v_permit_after->>'invalidated_at')::timestamptz <
          (v_permit_before->>'expires_at')::timestamptz
     or (v_permit_after->>'invalidated_at')::timestamptz <
          (v_permit_before->>'bound_at')::timestamptz
     or not sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(
          c_activation_job_id
        )
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_permits)
          <> v_permit_total
     or (select count(*) from sellerpilot_private.qoo10_exact_s1_activation_outcomes)
          <> v_outcome_total
     or (select count(*) from sellerpilot_private.channel_gateway_jobs)
          <> v_job_total
     or (select count(*) from sellerpilot_private.channel_operation_attempts)
          <> v_attempt_total
     or (select count(*) from sellerpilot_private.gateway_completion_receipts)
          <> v_receipt_total
     or (select to_jsonb(job) from sellerpilot_private.channel_gateway_jobs job
          where job.id = c_activation_job_id) <> v_job_before
     or (select to_jsonb(attempt)
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id =
            (v_permit_before->>'activation_attempt_id')::uuid) <>
          v_attempt_before
     or (select to_jsonb(receipt)
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = c_activation_job_id) <> v_receipt_before
     or (select to_jsonb(outcome)
           from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
          where outcome.activation_job_id = c_activation_job_id) <>
          v_outcome_before
  then
    raise exception 'exact Qoo10 failed permit retirement postimage drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_failed_permit_exact_data_patch$;

do $qoo10_failed_permit_schema_postimage$
declare
  v_binding_definition text;
  v_binding_sha text;
  v_provider_boundary_sha text;
  v_verifier_unique_count integer;
  v_partial_index_count integer;
  v_rpc_count integer;
begin
  select encode(extensions.digest(pg_catalog.pg_get_functiondef(
           'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
         ), 'sha256'), 'hex')
    into v_provider_boundary_sha;
  if v_provider_boundary_sha is distinct from
       '968b6336c02432bd790445b90902548f6182e3b4128d2c533151d95c90347b06'
  then
    raise exception 'exact Qoo10 provider-boundary postimage drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    into v_binding_definition
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
           'sellerpilot_private.qoo10_exact_s1_activation_permits'::regclass
     and constraint_row.conname =
           'qoo10_exact_s1_activation_binding_check'
     and constraint_row.contype = 'c'
     and constraint_row.convalidated;
  v_binding_sha := encode(extensions.digest(v_binding_definition,'sha256'),'hex');
  if v_binding_definition is null
     or v_binding_sha <>
          'c5286ff848adfd2e30be7376c6563f6b298d685e6daea26a7a5b2bb5e04d2260'
     or pg_catalog.strpos(
          v_binding_definition,
          'invalidation_reason = ''expired_before_claim''::text'
        ) = 0
     or pg_catalog.strpos(
          v_binding_definition,
          'invalidation_reason = ''failed_before_provider''::text'
        ) = 0
     or pg_catalog.strpos(v_binding_definition, 'consumed_at IS NULL') = 0
     or pg_catalog.strpos(v_binding_definition, 'bound_at IS NOT NULL') = 0
  then
    raise exception 'exact Qoo10 activation binding postimage drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*) into v_verifier_unique_count
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
           'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
     and constraint_row.conname =
           'qoo10_exact_s1_activation_outcomes_verifier_job_id_key'
     and constraint_row.contype = 'u'
     and constraint_row.convalidated
     and pg_catalog.md5(pg_catalog.pg_get_constraintdef(
           constraint_row.oid
         )) = '88ec8d06ce8207592bf0b65b3cc5e840';
  if v_verifier_unique_count <> 1
     or exists (
       select 1 from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid =
              'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
          and constraint_row.conname in (
            'qoo10_exact_s1_activation_outcomes_source_job_id_key',
            'qoo10_exact_s1_activation_outcomes_listing_id_key'
          )
     )
  then
    raise exception 'exact Qoo10 activation outcome constraint postimage drifted'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_proc procedure
        on procedure.oid = trigger_row.tgfoid
     where trigger_row.tgrelid =
           'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
       and trigger_row.tgname =
           'block_qoo10_exact_s1_activation_outcome_change'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled = 'O'
       and procedure.oid = pg_catalog.to_regprocedure(
         'sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change()'
       )
  ) then
    raise exception 'exact Qoo10 immutable outcome trigger drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*) into v_partial_index_count
    from (values
      ('qoo10_exact_s1_one_decisive_source_outcome'::name),
      ('qoo10_exact_s1_one_decisive_listing_outcome'::name)
    ) expected(index_name)
    join pg_catalog.pg_class index_relation
      on index_relation.relnamespace =
           'sellerpilot_private'::regnamespace
     and index_relation.relname = expected.index_name
     and index_relation.relkind = 'i'
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
     and index_row.indisunique
     and index_row.indisvalid
     and index_row.indpred is not null
   where pg_catalog.strpos(
           pg_catalog.pg_get_indexdef(index_relation.oid),
           'terminal_status = ''failed''::text'
         ) > 0
     and pg_catalog.strpos(
           pg_catalog.pg_get_indexdef(index_relation.oid),
           'activation_response_sha256 IS NULL'
         ) > 0
     and pg_catalog.strpos(
           pg_catalog.pg_get_indexdef(index_relation.oid),
           'provider_status IS NULL'
         ) > 0;
  if v_partial_index_count <> 2 then
    raise exception 'exact Qoo10 decisive outcome indexes drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*) into v_rpc_count
    from (values
      ('public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text)'),
      ('public.sellerpilot_service_enqueue_exact_qoo10_s1_activation(uuid,text)')
    ) expected(signature)
    join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
   where procedure.prosecdef
     and procedure.provolatile = 'v'
     and not procedure.proisstrict
     and procedure.proconfig = array['search_path=""']::text[]
     and procedure.proacl::text =
           '{postgres=X/postgres,service_role=X/postgres}'
     and pg_catalog.strpos(
           pg_catalog.pg_get_functiondef(procedure.oid),
           'qoo10_exact_s1_failed_before_provider_retired'
         ) > 0;
  if v_rpc_count <> 2
     or exists (
       select 1
         from (values
           ('public'::name),('anon'::name),('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(uuid)',
          'EXECUTE'
        )
     )
  then
    raise exception 'exact Qoo10 retry fence RPC postimage drifted'
      using errcode = '55000';
  end if;

  if not (
    select relation.relrowsecurity
      from pg_catalog.pg_class relation
     where relation.oid =
       'sellerpilot_private.qoo10_exact_s1_activation_permits'::regclass
  ) or not (
    select relation.relrowsecurity
      from pg_catalog.pg_class relation
     where relation.oid =
       'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
  ) or exists (
    select 1
      from (values
        ('public'::name),('anon'::name),('authenticated'::name),
        ('service_role'::name)
      ) role(role_name)
      cross join (values
        ('sellerpilot_private.qoo10_exact_s1_activation_permits'::text),
        ('sellerpilot_private.qoo10_exact_s1_activation_outcomes'::text)
      ) relation(relation_name)
      cross join (values
        ('SELECT'::text),('INSERT'::text),('UPDATE'::text),('DELETE'::text),
        ('TRUNCATE'::text),('REFERENCES'::text),('TRIGGER'::text)
      ) privilege(privilege_name)
     where pg_catalog.has_table_privilege(
       role.role_name, relation.relation_name, privilege.privilege_name
     )
  ) then
    raise exception 'exact Qoo10 activation ledger postimage ACL drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_failed_permit_schema_postimage$;

comment on function
  sellerpilot_private.qoo10_exact_s1_failed_before_provider_retired(uuid) is
  'Returns true only for a preserved payloadless failed outcome whose exact bound permit was retired after one matching completion receipt proved the provider boundary was never crossed.';

commit;
