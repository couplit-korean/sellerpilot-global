-- Proposal only. Apply with temu-002-partial-detail-retry.patch after review.
-- This must not be executed against production from the Temu worktree.

begin;

create table sellerpilot_private.temu_after_sales_detail_retry_ledger (
  job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  retry_count smallint not null check (retry_count between 1 and 3),
  deferred_count smallint not null check (deferred_count between 1 and 200),
  provider_status smallint not null
    check (provider_status in (408, 425, 500, 502, 503, 504)),
  failure_code text not null default 'TEMU_AFTER_SALES_DETAIL_READ_FAILED'
    check (failure_code = 'TEMU_AFTER_SALES_DETAIL_READ_FAILED'),
  request_arguments_sha256 text not null check (request_arguments_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  next_attempt_at timestamptz not null,
  outcome text not null default 'scheduled'
    check (outcome in ('scheduled', 'retry_failed', 'succeeded', 'terminal_failed', 'retry_exhausted')),
  resolved_at timestamptz,
  primary key (job_id, retry_count),
  check (
    (outcome = 'scheduled' and resolved_at is null)
    or (outcome <> 'scheduled' and resolved_at is not null)
  )
);

create index temu_after_sales_detail_retry_unresolved_idx
  on sellerpilot_private.temu_after_sales_detail_retry_ledger (next_attempt_at, job_id)
  where outcome = 'scheduled';

alter table sellerpilot_private.temu_after_sales_detail_retry_ledger enable row level security;
revoke all on sellerpilot_private.temu_after_sales_detail_retry_ledger
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_requeue_temu_after_sales_detail_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_retry_arguments jsonb,
  p_retry_count integer,
  p_retry_after_seconds integer,
  p_deferred_count integer,
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
  v_old_arguments jsonb;
  v_old_queue jsonb;
  v_new_queue jsonb;
  v_old_retry_count integer;
  v_expected_retry_after integer;
  v_now timestamptz := clock_timestamp();
  v_old_suffix_offset integer;
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
    raise exception 'gateway job ownership lost' using errcode = '40001';
  end if;

  if v_job.channel <> 'temu'
     or v_job.operation <> 'inquiries.list'
     or v_job.provider_mutation_started_at is not null then
    raise exception 'Temu after-sales read job required' using errcode = '22023';
  end if;

  v_expected_retry_after := case p_retry_count
    when 1 then 5
    when 2 then 10
    when 3 then 20
    else null
  end;
  if v_expected_retry_after is null
     or p_retry_after_seconds is distinct from v_expected_retry_after
     or not coalesce(p_deferred_count between 1 and 200, false)
     or not coalesce(p_provider_status in (408, 425, 500, 502, 503, 504), false)
     or jsonb_typeof(p_retry_arguments) is distinct from 'object'
     or coalesce(octet_length(p_retry_arguments::text) > 64000, true) then
    raise exception 'invalid Temu detail retry descriptor' using errcode = '22023';
  end if;

  v_old_arguments := v_job.request_payload->'arguments';
  v_old_queue := v_old_arguments->'detailQueue';
  v_new_queue := p_retry_arguments->'detailQueue';
  begin
    v_old_retry_count := coalesce(
      nullif(v_old_arguments->>'sellerpilotTemuDetailRetryCount', '')::integer,
      0
    );
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid existing Temu detail retry count' using errcode = '22023';
  end;

  if p_retry_count is distinct from v_old_retry_count + 1
     or (p_retry_arguments->>'sellerpilotTemuDetailRetryCount')::integer is distinct from p_retry_count
     or p_retry_arguments->>'kind' is distinct from 'after_sales'
     or p_retry_arguments->'includeDetails' is distinct from 'true'::jsonb
     or jsonb_typeof(v_new_queue) is distinct from 'array'
     or jsonb_array_length(v_new_queue) <> p_deferred_count
     or jsonb_array_length(v_new_queue) < 1
     or jsonb_array_length(v_new_queue) > 200
     or p_retry_arguments->'pageNo' is distinct from v_old_arguments->'pageNo'
     or p_retry_arguments->'pageSize' is distinct from v_old_arguments->'pageSize'
     or p_retry_arguments->'updateAtStart' is distinct from v_old_arguments->'updateAtStart'
     or p_retry_arguments->'updateAtEnd' is distinct from v_old_arguments->'updateAtEnd'
     or p_retry_arguments->'createAtStart' is distinct from v_old_arguments->'createAtStart'
     or p_retry_arguments->'createAtEnd' is distinct from v_old_arguments->'createAtEnd'
     or p_retry_arguments->'afterSalesStatusGroup' is distinct from v_old_arguments->'afterSalesStatusGroup'
     or p_retry_arguments->'sellerpilotHistoryRunId' is distinct from v_old_arguments->'sellerpilotHistoryRunId'
     or p_retry_arguments ? 'sellerpilotPaginationDepth'
     or p_retry_arguments ? 'sellerpilotPaginationEpoch'
     or p_retry_arguments ? 'sellerpilotPaginationTrail'
     or p_retry_arguments::text ~* '"(phone|phoneNumber|address|contact|email|mobile)"[[:space:]]*:' then
    raise exception 'Temu detail retry scope changed' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_new_queue) item
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
        or (item ? 'availableOperateList' and jsonb_typeof(item->'availableOperateList') <> 'array')
        or jsonb_array_length(coalesce(item->'availableOperateList', '[]'::jsonb)) > 100
        or exists (
          select 1
            from jsonb_array_elements(coalesce(item->'availableOperateList', '[]'::jsonb)) operation
           where jsonb_typeof(operation) not in ('string', 'number')
        )
  ) or (
    select count(*) <> count(distinct item->>'parentAfterSalesSn')
      from jsonb_array_elements(v_new_queue) item
  ) then
    raise exception 'invalid Temu detail retry queue' using errcode = '22023';
  end if;

  -- A retry of an already persisted queue may only remove a successful prefix.
  if v_old_queue is not null then
    if jsonb_typeof(v_old_queue) <> 'array'
       or jsonb_array_length(v_new_queue) > jsonb_array_length(v_old_queue) then
      raise exception 'Temu detail retry queue lineage changed' using errcode = '22023';
    end if;
    select old_item.ordinality::integer - 1
      into v_old_suffix_offset
      from jsonb_array_elements(v_old_queue) with ordinality old_item(item, ordinality)
     where old_item.item->>'parentAfterSalesSn' = v_new_queue->0->>'parentAfterSalesSn'
       and old_item.item->>'parentOrderSn' = v_new_queue->0->>'parentOrderSn'
     order by old_item.ordinality
     limit 1;
    if v_old_suffix_offset is null
       or exists (
         select 1
           from jsonb_array_elements(v_new_queue) with ordinality new_item(item, ordinality)
          where new_item.item is distinct from v_old_queue->(v_old_suffix_offset + new_item.ordinality::integer - 1)
       ) then
      raise exception 'Temu detail retry queue lineage changed' using errcode = '22023';
    end if;
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
    provider_status,
    request_arguments_sha256,
    observed_at,
    next_attempt_at
  ) values (
    v_job.id,
    p_retry_count,
    p_deferred_count,
    p_provider_status,
    encode(extensions.digest(p_retry_arguments::text, 'sha256'), 'hex'),
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
    'contract', 'temu-after-sales-detail-retry-v1',
    'status', 'deferred',
    'retryCount', p_retry_count,
    'retryAfterSeconds', p_retry_after_seconds,
    'deferredCount', p_deferred_count,
    'failureCode', 'TEMU_AFTER_SALES_DETAIL_READ_FAILED'
  );
end
$$;

revoke all on function public.sellerpilot_service_requeue_temu_after_sales_detail_v1(
  text, uuid, uuid, jsonb, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_requeue_temu_after_sales_detail_v1(
  text, uuid, uuid, jsonb, integer, integer, integer, integer
) to service_role;

create function sellerpilot_private.resolve_temu_after_sales_detail_retry()
returns trigger
language plpgsql
set search_path = pg_catalog, sellerpilot_private
as $$
declare
  v_retry_count integer;
  v_outcome text;
begin
  if new.channel <> 'temu'
     or new.operation <> 'inquiries.list'
     or new.status not in ('succeeded', 'failed', 'cancelled', 'reconciliation_required') then
    return new;
  end if;
  begin
    v_retry_count := nullif(
      new.request_payload#>>'{arguments,sellerpilotTemuDetailRetryCount}',
      ''
    )::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return new;
  end;
  if v_retry_count not between 1 and 3 then return new; end if;
  v_outcome := case
    when new.status = 'succeeded' then 'succeeded'
    when v_retry_count = 3 then 'retry_exhausted'
    else 'terminal_failed'
  end;
  update sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
     set outcome = v_outcome,
         resolved_at = clock_timestamp()
   where ledger.job_id = new.id
     and ledger.retry_count = v_retry_count
     and ledger.outcome = 'scheduled';
  return new;
end
$$;

revoke all on function sellerpilot_private.resolve_temu_after_sales_detail_retry()
  from public, anon, authenticated, service_role;

create trigger resolve_temu_after_sales_detail_retry
after update of status on sellerpilot_private.channel_gateway_jobs
for each row
when (old.status is distinct from new.status)
execute function sellerpilot_private.resolve_temu_after_sales_detail_retry();

create or replace function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v1(
  p_job_id uuid default null
)
returns table (
  job_id uuid,
  retry_count smallint,
  deferred_count smallint,
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

revoke all on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v1(uuid)
  to authenticated;

commit;
