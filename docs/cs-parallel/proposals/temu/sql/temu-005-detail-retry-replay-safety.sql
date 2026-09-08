-- Layered proposal: apply only after temu-002-durable-detail-retry.sql.
-- Proposal-only; do not execute against production from this worktree.

begin;

alter table sellerpilot_private.temu_after_sales_detail_retry_ledger
  add column replay_count smallint not null
    check (replay_count between 0 and 199),
  add column worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  add column source_claim_token_sha256 text not null
    check (source_claim_token_sha256 ~ '^[a-f0-9]{64}$');

alter table sellerpilot_private.temu_after_sales_detail_retry_ledger
  add constraint temu_after_sales_detail_retry_total_queue_check
  check (replay_count + deferred_count between 1 and 200);

create function sellerpilot_private.temu_after_sales_retry_queue_valid(
  p_queue jsonb,
  p_allow_empty boolean
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_queue) is distinct from 'array' then false
    when jsonb_array_length(p_queue) > 200 then false
    when not p_allow_empty and jsonb_array_length(p_queue) = 0 then false
    else not exists (
      select 1
        from jsonb_array_elements(p_queue) item
       where jsonb_typeof(item) <> 'object'
          or coalesce(item->>'parentAfterSalesSn', '') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
          or coalesce(item->>'parentOrderSn', '') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
          or exists (
            select 1
              from jsonb_object_keys(item) key
             where key <> all (array[
               'parentAfterSalesSn', 'parentOrderSn', 'afterSalesStatusGroup',
               'operateExpireTimeMs', 'availableOperateList', 'returnDeliveryType',
               'parentAfterSalesStatus', 'updateAt', 'afterSalesType', 'createAt'
             ])
          )
          or (
            item ? 'availableOperateList'
            and (
              jsonb_typeof(item->'availableOperateList') <> 'array'
              or jsonb_array_length(item->'availableOperateList') > 100
              or exists (
                select 1
                  from jsonb_array_elements(item->'availableOperateList') operation
                 where jsonb_typeof(operation) not in ('string', 'number')
              )
            )
          )
    ) and (
      select count(*) = count(distinct item->>'parentAfterSalesSn')
        from jsonb_array_elements(p_queue) item
    )
  end
$$;

revoke all on function sellerpilot_private.temu_after_sales_retry_queue_valid(jsonb, boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_service_requeue_temu_after_sales_detail_v1(
  text, uuid, uuid, jsonb, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
drop function public.sellerpilot_service_requeue_temu_after_sales_detail_v1(
  text, uuid, uuid, jsonb, integer, integer, integer, integer
);

create function public.sellerpilot_service_requeue_temu_after_sales_detail_v2(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_retry_arguments jsonb,
  p_retry_count integer,
  p_retry_after_seconds integer,
  p_deferred_count integer,
  p_replay_count integer,
  p_provider_status integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing sellerpilot_private.temu_after_sales_detail_retry_ledger%rowtype;
  v_old_arguments jsonb;
  v_old_queue jsonb;
  v_old_replay_queue jsonb;
  v_new_queue jsonb;
  v_new_replay_queue jsonb;
  v_old_retry_count integer;
  v_expected_retry_after integer;
  v_arguments_sha256 text;
  v_claim_sha256 text;
  v_now timestamptz := clock_timestamp();
begin
  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'gateway'
     and token.status = 'active'
     and token.expires_at > v_now;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  v_expected_retry_after := case p_retry_count
    when 1 then 5
    when 2 then 10
    when 3 then 20
    else null
  end;
  if p_claim_token is null
     or v_expected_retry_after is null
     or p_retry_after_seconds is distinct from v_expected_retry_after
     or not coalesce(p_deferred_count between 1 and 200, false)
     or not coalesce(p_replay_count between 0 and 199, false)
     or not coalesce(p_deferred_count + p_replay_count between 1 and 200, false)
     or not coalesce(p_provider_status in (408, 425, 500, 502, 503, 504), false)
     or jsonb_typeof(p_retry_arguments) is distinct from 'object'
     or coalesce(octet_length(p_retry_arguments::text) > 64000, true) then
    raise exception 'invalid Temu detail retry descriptor' using errcode = '22023';
  end if;

  v_arguments_sha256 := encode(extensions.digest(p_retry_arguments::text, 'sha256'), 'hex');
  v_claim_sha256 := encode(extensions.digest(p_claim_token::text, 'sha256'), 'hex');
  v_new_queue := p_retry_arguments->'detailQueue';
  v_new_replay_queue := coalesce(p_retry_arguments->'retryReplayQueue', '[]'::jsonb);

  if p_retry_arguments->>'kind' is distinct from 'after_sales'
     or p_retry_arguments->'includeDetails' is distinct from 'true'::jsonb
     or (p_retry_arguments->>'sellerpilotTemuDetailRetryCount')::integer is distinct from p_retry_count
     or jsonb_array_length(v_new_queue) is distinct from p_deferred_count
     or jsonb_array_length(v_new_replay_queue) is distinct from p_replay_count
     or not sellerpilot_private.temu_after_sales_retry_queue_valid(v_new_queue, false)
     or not sellerpilot_private.temu_after_sales_retry_queue_valid(v_new_replay_queue, true)
     or exists (
       select 1
         from jsonb_array_elements(v_new_replay_queue || v_new_queue) item
        group by item->>'parentAfterSalesSn'
       having count(*) > 1
     )
     or p_retry_arguments ? 'sellerpilotPaginationDepth'
     or p_retry_arguments ? 'sellerpilotPaginationEpoch'
     or p_retry_arguments ? 'sellerpilotPaginationTrail'
     or p_retry_arguments::text ~* '"(phone|phoneNumber|address|contact|email|mobile)"[[:space:]]*:' then
    raise exception 'invalid Temu detail retry queue' using errcode = '22023';
  end if;

  -- Lock the running claim first. A concurrent duplicate waits here; after the
  -- first call commits it observes the queued state and follows the exact
  -- receipt-replay branch below without consuming another retry.
  select job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > v_now
   for update;
  if not found then
    select ledger.*
      into v_existing
      from sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
     where ledger.job_id = p_job_id
       and ledger.retry_count = p_retry_count;
    if not found
       or v_existing.worker_token_id is distinct from v_token_id
       or v_existing.source_claim_token_sha256 is distinct from v_claim_sha256
       or v_existing.request_arguments_sha256 is distinct from v_arguments_sha256
       or v_existing.deferred_count is distinct from p_deferred_count
       or v_existing.replay_count is distinct from p_replay_count
       or v_existing.provider_status is distinct from p_provider_status
       or v_existing.next_attempt_at is distinct from
         v_existing.observed_at + p_retry_after_seconds * interval '1 second'
       or not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs queued_job
          where queued_job.id = p_job_id
            and queued_job.status = 'queued'
            and queued_job.worker_token_id is null
            and queued_job.claim_token is null
            and queued_job.error_message = 'TEMU_AFTER_SALES_DETAIL_RETRY_SCHEDULED'
            and queued_job.rate_not_before is not distinct from v_existing.next_attempt_at
            and encode(
              extensions.digest((queued_job.request_payload->'arguments')::text, 'sha256'),
              'hex'
            ) = v_arguments_sha256
       ) then
      raise exception 'gateway job ownership lost or Temu detail retry replay conflict'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'contract', 'temu-after-sales-detail-retry-v2',
      'status', 'deferred',
      'retryCount', p_retry_count,
      'retryAfterSeconds', p_retry_after_seconds,
      'deferredCount', p_deferred_count,
      'replayCount', p_replay_count,
      'failureCode', 'TEMU_AFTER_SALES_DETAIL_READ_FAILED',
      'replayed', true
    );
  end if;

  if v_job.channel <> 'temu'
     or v_job.operation <> 'inquiries.list'
     or v_job.provider_mutation_started_at is not null then
    raise exception 'Temu after-sales read job required' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.id = v_job.credential_id
       and credential.channel = 'temu'
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > v_now)
  ) then
    raise exception 'Temu credential no longer active' using errcode = '55000';
  end if;

  v_old_arguments := v_job.request_payload->'arguments';
  v_old_queue := v_old_arguments->'detailQueue';
  v_old_replay_queue := coalesce(v_old_arguments->'retryReplayQueue', '[]'::jsonb);
  begin
    v_old_retry_count := coalesce(
      nullif(v_old_arguments->>'sellerpilotTemuDetailRetryCount', '')::integer,
      0
    );
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid existing Temu detail retry count' using errcode = '22023';
  end;

  if p_retry_count is distinct from v_old_retry_count + 1
     or p_retry_arguments->'pageNo' is distinct from v_old_arguments->'pageNo'
     or p_retry_arguments->'pageSize' is distinct from v_old_arguments->'pageSize'
     or p_retry_arguments->'updateAtStart' is distinct from v_old_arguments->'updateAtStart'
     or p_retry_arguments->'updateAtEnd' is distinct from v_old_arguments->'updateAtEnd'
     or p_retry_arguments->'createAtStart' is distinct from v_old_arguments->'createAtStart'
     or p_retry_arguments->'createAtEnd' is distinct from v_old_arguments->'createAtEnd'
     or p_retry_arguments->'afterSalesStatusGroup' is distinct from v_old_arguments->'afterSalesStatusGroup'
     or p_retry_arguments->'sellerpilotHistoryRunId' is distinct from v_old_arguments->'sellerpilotHistoryRunId' then
    raise exception 'Temu detail retry scope changed' using errcode = '22023';
  end if;

  -- On retries 2 and 3, repartitioning around the new failed identity is
  -- allowed, but the combined replay + remainder lineage must be identical.
  if v_old_queue is not null
     and v_new_replay_queue || v_new_queue
       is distinct from v_old_replay_queue || v_old_queue then
    raise exception 'Temu detail retry queue lineage changed' using errcode = '22023';
  end if;

  if p_retry_count > 1 then
    update sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
       set outcome = 'retry_failed',
           resolved_at = v_now
     where ledger.job_id = v_job.id
       and ledger.retry_count = p_retry_count - 1
       and ledger.outcome = 'scheduled';
    if not found then
      raise exception 'Temu detail retry ledger lineage missing' using errcode = '40001';
    end if;
  elsif exists (
    select 1
      from sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
     where ledger.job_id = v_job.id
  ) then
    raise exception 'Temu detail retry ledger already exists' using errcode = '40001';
  end if;

  insert into sellerpilot_private.temu_after_sales_detail_retry_ledger (
    job_id,
    retry_count,
    deferred_count,
    replay_count,
    provider_status,
    request_arguments_sha256,
    worker_token_id,
    source_claim_token_sha256,
    observed_at,
    next_attempt_at
  ) values (
    v_job.id,
    p_retry_count,
    p_deferred_count,
    p_replay_count,
    p_provider_status,
    v_arguments_sha256,
    v_token_id,
    v_claim_sha256,
    v_now,
    v_now + p_retry_after_seconds * interval '1 second'
  );

  update sellerpilot_private.channel_gateway_jobs job
     set request_payload = jsonb_set(job.request_payload, '{arguments}', p_retry_arguments, false),
         status = 'queued',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         rate_not_before = v_now + p_retry_after_seconds * interval '1 second',
         error_message = 'TEMU_AFTER_SALES_DETAIL_RETRY_SCHEDULED',
         completed_at = null,
         updated_at = v_now
   where job.id = v_job.id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token;
  if not found then
    raise exception 'gateway job ownership lost' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'contract', 'temu-after-sales-detail-retry-v2',
    'status', 'deferred',
    'retryCount', p_retry_count,
    'retryAfterSeconds', p_retry_after_seconds,
    'deferredCount', p_deferred_count,
    'replayCount', p_replay_count,
    'failureCode', 'TEMU_AFTER_SALES_DETAIL_READ_FAILED',
    'replayed', false
  );
end
$$;

revoke all on function public.sellerpilot_service_requeue_temu_after_sales_detail_v2(
  text, uuid, uuid, jsonb, integer, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_requeue_temu_after_sales_detail_v2(
  text, uuid, uuid, jsonb, integer, integer, integer, integer, integer
) to service_role;

drop function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v1(uuid);
create function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(
  p_job_id uuid default null
)
returns table (
  job_id uuid,
  retry_count smallint,
  deferred_count smallint,
  replay_count smallint,
  provider_status smallint,
  failure_code text,
  observed_at timestamptz,
  next_attempt_at timestamptz,
  outcome text,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if not coalesce(public.sellerpilot_is_admin(), false) then
    raise exception 'admin required' using errcode = '42501';
  end if;
  return query
  select ledger.job_id,
         ledger.retry_count,
         ledger.deferred_count,
         ledger.replay_count,
         ledger.provider_status,
         ledger.failure_code,
         ledger.observed_at,
         ledger.next_attempt_at,
         ledger.outcome,
         ledger.resolved_at
    from sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
   where p_job_id is null or ledger.job_id = p_job_id
   order by ledger.observed_at desc, ledger.job_id, ledger.retry_count desc
   limit 100;
end
$$;

revoke all on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)
  to authenticated;

commit;
