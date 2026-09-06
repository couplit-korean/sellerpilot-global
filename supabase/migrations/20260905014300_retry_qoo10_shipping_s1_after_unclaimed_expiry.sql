-- Follow-up to 20260905014200. Do not rewrite applied history.
-- The first direct shipping-S1 activation was armed at 18:25:20 UTC but
-- remained unclaimed while concurrent Qoo10 periodic reads won the channel
-- slot. It expired with attempt_count=0 and provider_mutation_started_at NULL.
-- Preserve that failed receipt. Permit exactly one fresh-GET retry, keep the
-- two-minute limit, and stop other Qoo10 claims racing the fresh activation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500143);

do $qoo10_shipping_s1_expired_preimage$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.qoo10_shipping_s1_activation_permits%rowtype;
begin
  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '12eaf867-9ee5-45b1-aed0-b5456bc124a3'::uuid;
  select * into strict v_permit
    from sellerpilot_private.qoo10_shipping_s1_activation_permits
   where activation_job_id = v_job.id;
  if v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.activate'
     or v_job.listing_id is distinct from
          '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
     or v_job.status is distinct from 'failed'
     or v_job.attempt_count is distinct from 0
     or v_job.started_at is not null
     or v_job.provider_mutation_started_at is not null
     or v_job.completed_at is null
     or v_job.error_message is distinct from
          'Exact Qoo10 shipping S1 activation observation expired before claim; no provider mutation was started.'
     or v_permit.verifier_job_id is distinct from
          '457b4481-0a66-4a76-89a0-884087d0c22e'::uuid
     or v_permit.bound_at is not null
     or v_permit.consumed_at is not null
     or v_permit.invalidated_at is null
     or v_permit.invalidation_reason is distinct from 'expired_before_claim'
     or v_permit.expires_at > statement_timestamp()
     or exists (
       select 1
         from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
        where outcome.activation_job_id = v_job.id
     )
  then
    raise exception 'exact Qoo10 shipping S1 expired activation preimage drifted'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
             'sellerpilot_private.qoo10_shipping_s1_activation_permits'::regclass
       and constraint_row.conname =
             'qoo10_shipping_s1_activation_permits_verifier_job_id_key'
       and constraint_row.contype = 'u'
  ) then
    raise exception 'exact Qoo10 shipping S1 verifier uniqueness preimage drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_shipping_s1_expired_preimage$;

create table sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts (
  retry_activation_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  failed_activation_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  verifier_job_id uuid not null
    references sellerpilot_private.qoo10_shipping_s1_observations(verifier_job_id)
    on delete restrict,
  listing_id uuid not null,
  remote_id text not null,
  release_sha text not null,
  readback_sha256 text not null,
  readback_bytes integer not null,
  verified_at timestamptz not null,
  contract text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint qoo10_shipping_s1_direct_retry_receipt_check check (
    failed_activation_job_id =
      '12eaf867-9ee5-45b1-aed0-b5456bc124a3'::uuid
    and verifier_job_id =
      '457b4481-0a66-4a76-89a0-884087d0c22e'::uuid
    and listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and remote_id = '1217536689'
    and release_sha ~ '^[a-f0-9]{40}$'
    and readback_sha256 ~ '^[a-f0-9]{64}$'
    and readback_bytes between 100 and 1000000
    and contract = 'qoo10_shipping_s1_direct_retry_receipt_v1'
  )
);

alter table sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts
  enable row level security;
revoke all on sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts
  from public, anon, authenticated, service_role;

create trigger block_qoo10_shipping_s1_direct_retry_receipt_change
before update or delete
on sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts
for each row execute function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change();

alter table sellerpilot_private.qoo10_shipping_s1_activation_permits
  drop constraint qoo10_shipping_s1_activation_permits_verifier_job_id_key;
create unique index qoo10_shipping_s1_one_active_verifier_permit
  on sellerpilot_private.qoo10_shipping_s1_activation_permits(verifier_job_id)
  where invalidated_at is null;

create function sellerpilot_private.qoo10_shipping_s1_fresh_activation_waiting()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
     where job.status = 'queued'
       and job.channel = 'qoo10'
       and job.operation = 'listing.activate'
       and job.attempt_count = 0
       and job.worker_token_id is null
       and job.claim_token is null
       and job.provider_mutation_started_at is null
       and permit.invalidated_at is null
       and permit.bound_at is null
       and permit.consumed_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)
  ), false)
$$;

create function sellerpilot_private.guard_qoo10_shipping_s1_fresh_activation_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'queued'
     and new.status = 'running'
     and new.channel = 'qoo10'
     and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(new.id)
     and sellerpilot_private.qoo10_shipping_s1_fresh_activation_waiting()
  then
    raise exception using
      errcode = 'SPC02',
      message = 'fresh exact Qoo10 shipping S1 activation owns the channel claim slot';
  end if;
  return new;
end;
$$;

create trigger guard_00_qoo10_shipping_s1_fresh_activation_slot
before update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_qoo10_shipping_s1_fresh_activation_slot();

create function public.sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify(
  p_failed_activation_job_id uuid,
  p_release_sha text,
  p_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_failed_permit sellerpilot_private.qoo10_shipping_s1_activation_permits%rowtype;
  v_run sellerpilot_private.qoo10_shipping_s1_verifier_runs%rowtype;
  v_verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  v_observation sellerpilot_private.qoo10_shipping_s1_observations%rowtype;
  v_create sellerpilot_private.channel_gateway_jobs%rowtype;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_item jsonb;
  v_count integer;
  v_verified_at timestamptz;
  v_response jsonb;
  v_expectation jsonb;
  v_job_id uuid := gen_random_uuid();
  v_attempt_id uuid := gen_random_uuid();
  v_arguments jsonb;
  v_marker jsonb;
  v_payload jsonb;
  v_request_sha text;
  v_resource_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
  if p_failed_activation_job_id is distinct from
       '12eaf867-9ee5-45b1-aed0-b5456bc124a3'::uuid
     or not sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
     or exists (
       select 1
         from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
        where permit.invalidated_at is null
     )
     or exists (
       select 1
         from sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts receipt
        where receipt.failed_activation_job_id = p_failed_activation_job_id
     )
  then
    raise exception 'exact Qoo10 shipping S1 direct retry preconditions are not met'
      using errcode = '55000';
  end if;

  select * into strict v_failed_job
    from sellerpilot_private.channel_gateway_jobs
   where id = p_failed_activation_job_id;
  select * into strict v_failed_permit
    from sellerpilot_private.qoo10_shipping_s1_activation_permits
   where activation_job_id = p_failed_activation_job_id;
  if v_failed_job.status is distinct from 'failed'
     or v_failed_job.attempt_count is distinct from 0
     or v_failed_job.started_at is not null
     or v_failed_job.provider_mutation_started_at is not null
     or v_failed_job.error_message is distinct from
          'Exact Qoo10 shipping S1 activation observation expired before claim; no provider mutation was started.'
     or v_failed_permit.bound_at is not null
     or v_failed_permit.consumed_at is not null
     or v_failed_permit.invalidated_at is null
     or v_failed_permit.invalidation_reason is distinct from 'expired_before_claim'
     or v_failed_permit.expires_at > statement_timestamp()
     or exists (
       select 1
         from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
        where outcome.activation_job_id = p_failed_activation_job_id
     )
  then
    raise exception 'exact Qoo10 shipping S1 failed activation is not retryable'
      using errcode = '55000';
  end if;

  select * into strict v_run
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs
   where verifier_job_id = v_failed_permit.verifier_job_id;
  select * into strict v_verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = v_run.verifier_job_id;
  select * into strict v_observation
    from sellerpilot_private.qoo10_shipping_s1_observations
   where verifier_job_id = v_run.verifier_job_id;
  select * into strict v_create
    from sellerpilot_private.channel_gateway_jobs
   where id = v_run.create_job_id;
  select * into strict v_update
    from sellerpilot_private.channel_gateway_jobs
   where id = v_run.update_job_id;
  if v_verifier.status is distinct from 'reconciliation_required'
     or v_verifier.provider_mutation_started_at is not null
     or v_verifier.credential_refresh_in_flight
     or not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(v_verifier)
     or v_observation.contract is distinct from
          'qoo10_shipping_s1_observation_v1'
     or v_observation.provider_status is distinct from 'S1'
     or v_observation.remote_visibility is distinct from 'non_public'
     or v_observation.activation_expectation#>>'{expectedState,shippingNo}'
          is distinct from '806971'
  then
    raise exception 'exact Qoo10 shipping S1 immutable verifier evidence drifted'
      using errcode = '55000';
  end if;

  if jsonb_typeof(p_readback) is distinct from 'object'
     or p_readback->>'ResultCode' is distinct from '0'
  then
    raise exception 'exact Qoo10 shipping S1 retry readback is not ResultCode 0'
      using errcode = '55000';
  end if;
  select count(distinct coalesce(item->>'ItemCode', item->>'GdNo', item->>'ItemNo'))
    into v_count
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(p_readback->'ResultObject', p_readback), '1217536689'
    ) item;
  if v_count is distinct from 1 then
    raise exception 'exact Qoo10 shipping S1 retry item is not unique'
      using errcode = '55000';
  end if;
  select item into strict v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(p_readback->'ResultObject', p_readback), '1217536689'
    ) item;
  v_expectation := v_observation.activation_expectation;
  if not sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
       v_item, v_create.request_payload->'arguments',
       v_update.request_payload->'arguments'
     )
     or not sellerpilot_private.qoo10_shipping_s1_direct_reverify_expectation_valid(
       v_expectation, v_update.request_payload->'arguments',
       v_create.request_payload->'arguments', v_item
     )
  then
    raise exception 'exact Qoo10 shipping S1 retry GET did not match immutable evidence'
      using errcode = '55000';
  end if;

  v_verified_at := clock_timestamp();
  v_response := jsonb_build_object(
    'ok', true,
    'ResultCode', '0',
    'ResultObject', v_item,
    'sellerpilotDirectReverifyRetry',
      'qoo10_shipping_s1_direct_reverify_retry_v1'
  );
  if octet_length(v_response::text) < 100 then
    raise exception 'exact Qoo10 shipping S1 retry receipt is too small'
      using errcode = '55000';
  end if;

  v_marker := jsonb_set(
    v_expectation || jsonb_build_object(
      'status', 'allowed',
      'contract', 'qoo10_s1_activation_v1',
      'listingId', v_run.listing_id,
      'remoteId', v_run.remote_id,
      'providerStatus', 'S1',
      'sourceJobId', v_run.update_job_id,
      'verifierJobId', v_run.verifier_job_id,
      'verifierResponseSha256',
        encode(extensions.digest(v_response::text, 'sha256'), 'hex'),
      'verifierCompletedAt', v_verified_at
    ),
    '{expectedState,shippingNo}', '"806971"'::jsonb, true
  );
  v_arguments := jsonb_set(
    coalesce(v_update.request_payload->'arguments', '{}'::jsonb),
    '{sellerpilotQoo10S1Activation}', v_marker, true
  );
  v_arguments := jsonb_set(
    v_arguments,
    '{sellerpilotQoo10ShippingS1Activation}',
    jsonb_build_object(
      'status', 'allowed',
      'contract', 'qoo10_shipping_s1_activation_v1',
      'listingId', v_run.listing_id,
      'remoteId', v_run.remote_id,
      'createJobId', v_run.create_job_id,
      'updateJobId', v_run.update_job_id,
      'verifierJobId', v_run.verifier_job_id,
      'retryOfActivationJobId', p_failed_activation_job_id
    ),
    true
  );
  if v_arguments#>>'{params,ShippingNo}' is distinct from '0' then
    raise exception 'exact Qoo10 shipping S1 retry source ShippingNo is not 0'
      using errcode = '55000';
  end if;
  v_arguments := jsonb_set(
    v_arguments, '{params,ShippingNo}', '"806971"'::jsonb, true
  );
  v_arguments := jsonb_set(
    v_arguments, '{params,Keyword}', to_jsonb(v_item->>'Keyword'), true
  );
  v_arguments := jsonb_set(
    v_arguments, '{params,PromotionName}',
    to_jsonb(v_item->>'PromotionName'), true
  );
  v_payload := jsonb_build_object('arguments', v_arguments);
  v_request_sha := encode(
    extensions.digest(v_payload::text, 'sha256'), 'hex'
  );
  v_resource_key := encode(extensions.digest(
    'qoo10-shipping-s1-activation:' || v_run.update_job_id::text || ':' ||
      v_run.verifier_job_id::text || ':' || v_run.remote_id,
    'sha256'
  ), 'hex');

  insert into sellerpilot_private.channel_operation_attempts (
    id, owner_id, credential_id, channel, operation, idempotency_key,
    request_fingerprint, status, started_at, seller_account_key,
    gateway_write_required, pre_gateway_retryable
  ) values (
    v_attempt_id, v_run.owner_id, v_run.credential_id, 'qoo10',
    'listing.activate',
    'qoo10-shipping-s1-activate:' || v_run.update_job_id::text || ':' ||
      v_run.verifier_job_id::text || ':direct-retry-1',
    v_request_sha, 'running', clock_timestamp(), v_run.seller_account_key,
    true, false
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_shipping_s1_activation_enqueue', v_job_id::text, true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation, environment,
    request_payload, status, seller_account_key, request_fingerprint,
    write_resource_kind, write_resource_key, created_by, created_at, updated_at
  ) values (
    v_job_id, v_run.credential_id, v_attempt_id, v_run.listing_id, 'qoo10',
    'listing.activate', 'production', v_payload, 'queued',
    v_run.seller_account_key, v_request_sha, 'listing_mutation', v_resource_key,
    v_update.created_by, clock_timestamp(), clock_timestamp()
  );
  insert into sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts (
    retry_activation_job_id, failed_activation_job_id, verifier_job_id,
    listing_id, remote_id, release_sha, readback_sha256, readback_bytes,
    verified_at, contract
  ) values (
    v_job_id, p_failed_activation_job_id, v_run.verifier_job_id,
    v_run.listing_id, v_run.remote_id, p_release_sha,
    encode(extensions.digest(v_response::text, 'sha256'), 'hex'),
    octet_length(v_response::text), v_verified_at,
    'qoo10_shipping_s1_direct_retry_receipt_v1'
  );
  insert into sellerpilot_private.qoo10_shipping_s1_activation_permits (
    activation_job_id, activation_attempt_id, verifier_job_id, create_job_id,
    update_job_id, listing_id, credential_id, owner_id, remote_id,
    seller_account_key, release_sha, activation_request_sha256,
    activation_request_bytes, write_resource_key, contract, armed_at,
    expires_at
  ) values (
    v_job_id, v_attempt_id, v_run.verifier_job_id, v_run.create_job_id,
    v_run.update_job_id, v_run.listing_id, v_run.credential_id, v_run.owner_id,
    v_run.remote_id, v_run.seller_account_key, p_release_sha, v_request_sha,
    octet_length(v_payload::text), v_resource_key,
    'qoo10_shipping_s1_activation_permit_v1', v_verified_at,
    v_verified_at + interval '2 minutes'
  );

  perform sellerpilot_private.schedule_serverless_cs_wakeup();

  return jsonb_build_object(
    'contract', 'qoo10_shipping_s1_direct_reverify_retry_v1',
    'failedActivationJobId', p_failed_activation_job_id,
    'createJobId', v_run.create_job_id,
    'updateJobId', v_run.update_job_id,
    'verifierJobId', v_run.verifier_job_id,
    'activationJobId', v_job_id,
    'activationAttemptId', v_attempt_id,
    'expectedShippingNo', '806971',
    'sourceJobRewritten', false,
    'verifierRewritten', false,
    'expiredActivationRewritten', false,
    'expiresAt', v_verified_at + interval '2 minutes'
  );
end;
$$;

do $qoo10_shipping_s1_status_latest_permit$
declare
  v_definition text;
  v_before constant text :=
    'where permit.verifier_job_id = v_verifier.verifier_job_id;';
  v_after constant text :=
    'where permit.verifier_job_id = v_verifier.verifier_job_id order by permit.armed_at desc, permit.activation_job_id desc limit 1;';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_shipping_s1_release_status(uuid,uuid,text)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition, v_after) > 0 then
    return;
  end if;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before) <> 1 then
    raise exception 'exact Qoo10 shipping S1 status permit preimage drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_status_latest_permit$;

revoke all on function
  sellerpilot_private.qoo10_shipping_s1_fresh_activation_waiting(),
  sellerpilot_private.guard_qoo10_shipping_s1_fresh_activation_slot()
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify(
    uuid, text, jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify(
    uuid, text, jsonb
  ) to service_role;

comment on table sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts is
  'Immutable one-shot fresh GET receipt after exact expired-before-claim activation; does not rewrite source, verifier, observation, or failed activation.';
comment on function
  sellerpilot_private.qoo10_shipping_s1_fresh_activation_waiting() is
  'Keeps concurrent serverless claimers from racing periodic Qoo10 reads against the fresh two-minute activation.';
comment on function
  public.sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify(uuid,text,jsonb) is
  'One exact fresh-GET retry after 12eaf867 expired unclaimed; records a new immutable receipt and queues one new activation without rewriting prior evidence.';

commit;
