-- Forward recovery of the complete Temu retry/history/account family.
-- Current gateway contexts are retained as predecessors; the reviewed history
-- reader adds explicit Temu account filtering. This creates no history run,
-- approval evidence, provider call or new execution permission.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_admin_temu_after_sales_detail_retry_status_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_admin_temu_after_sales_detail_retry_status_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_admin_temu_after_sales_detail_retry_status_v2') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_admin_temu_after_sales_detail_retry_status_v2';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_admin_temu_after_sales_detail_retry_status_v3') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_admin_temu_after_sales_detail_retry_status_v3';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_get_temu_history_checkpoint_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_get_temu_history_checkpoint_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_list_temu_cs_accounts_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_list_temu_cs_accounts_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_cs_history_coverage_v1' and pg_get_function_identity_arguments(p.oid)='') is distinct from '80d523d0aa6e1391f34a8554368e5bd9' then raise exception 'TEMU_CS_RECOVERY_PREIMAGE_DRIFT:sellerpilot_read_cs_history_coverage_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_cs_history_coverage_v2') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_read_cs_history_coverage_v2';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_temu_buyer_chat_readiness_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_read_temu_buyer_chat_readiness_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_gateway_completion_context' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from 'f361c12c34b3d04b51ea463beb6eda36' then raise exception 'TEMU_CS_RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_gateway_completion_context';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_get_temu_buyer_chat_readiness_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_service_get_temu_buyer_chat_readiness_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_cs_credential_binding_v1' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid, p_evidence jsonb') is distinct from 'eca178b910e41f5942b8d521abf6f060' then raise exception 'TEMU_CS_RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_record_cs_credential_binding_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_temu_history_checkpoint_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_temu_history_checkpoint_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_requeue_temu_after_sales_detail_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_service_requeue_temu_after_sales_detail_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_requeue_temu_after_sales_detail_v2') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_service_requeue_temu_after_sales_detail_v2';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_serverless_cs_completion_context' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from '549a0c8fdcdcf517338a11bd47807e48' then raise exception 'TEMU_CS_RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_serverless_cs_completion_context';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_start_or_resume_temu_history_v1') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:sellerpilot_start_or_resume_temu_history_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='enqueue_temu_history_cursor') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:enqueue_temu_history_cursor';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='reject_temu_buyer_chat_observation_diagnostic_change') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:reject_temu_buyer_chat_observation_diagnostic_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='reject_temu_buyer_chat_readiness_evidence_change') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:reject_temu_buyer_chat_readiness_evidence_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='reject_temu_cs_binding_receipt_change') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:reject_temu_cs_binding_receipt_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='reject_temu_history_checkpoint_receipt_change') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:reject_temu_history_checkpoint_receipt_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='resolve_temu_after_sales_detail_retry') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:resolve_temu_after_sales_detail_retry';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_after_sales_retry_queue_valid') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:temu_after_sales_retry_queue_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_history_arguments') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:temu_history_arguments';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_history_checkpoint') then raise exception 'TEMU_CS_RECOVERY_ALREADY_DEFINED:temu_history_checkpoint';end if;
end $recovery_guard$;
-- Reviewed source: 20260908140414_cs_temu_durable_detail_retry.sql
-- Original SHA256: 13fcd1f2856a7599db6963597e54e71e76b6939fba5cd710bffa2f96be771a2b
-- Proposal only. Apply with temu-002-partial-detail-retry.patch after review.
-- This must not be executed against production from the Temu worktree.

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


-- Reviewed source: 20260908140416_cs_temu_detail_retry_replay.sql
-- Original SHA256: d5a06aa35d4ad7a0f9e6ecc300a9ca5aef5acf453eadd09395e22408c8b1255a
-- Layered proposal: apply only after temu-002-durable-detail-retry.sql.
-- Proposal-only; do not execute against production from this worktree.

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


-- Reviewed source: 20260909101645_cs_temu_serverless_retry_scope.sql
-- Original SHA256: 0794240f85a0e666090cd1d1a7110453467c341725fd0d1e00ba7d2c8a1446e7
-- CS-temu-R01: preserve the shared administrator worker model. Authorization
-- remains the exact worker token / job / claim / live lease relationship.
-- Owner equality from the channel proposal is deliberately not introduced.
do $migration$
declare
  v_signature regprocedure := to_regprocedure('public.sellerpilot_service_requeue_temu_after_sales_detail_v2(text,uuid,uuid,jsonb,integer,integer,integer,integer,integer)');
  v_definition text;
  v_old constant text := 'and token.scope = ''gateway''';
  v_new constant text := 'and token.scope in (''gateway'', ''serverless_cs'')';
begin
  if v_signature is null then
    raise exception 'TEMU_RETRY_SCOPE_PREIMAGE_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1
     or strpos(v_definition, 'job.worker_token_id = v_token_id') = 0
     or strpos(v_definition, 'job.claim_token = p_claim_token') = 0
     or strpos(v_definition, 'job.lease_expires_at > v_now') = 0
     or strpos(v_definition, 'v_job.operation <> ''inquiries.list''') = 0
     or strpos(v_definition, 'v_job.channel <> ''temu''') = 0
     or not exists (
       select 1 from pg_catalog.pg_proc p where p.oid = v_signature
         and p.prosecdef
         and p.proconfig = array['search_path=pg_catalog, public, sellerpilot_private']::text[]
         and p.proowner = 'postgres'::regrole
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
     ) then
    raise exception 'TEMU_RETRY_SCOPE_PREIMAGE_DRIFTED';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

-- Reviewed source: 20260909134538_temu_cs_verified_account_binding_context.sql
-- Original SHA256: 7ba5b2b109361d4fb39961d16a87071bc7b263a8a8bb8e1feb1f0400f435af98
alter function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) rename to sellerpilot_091105_serverless_cs_context_before_temu_binding;

revoke all on function public.sellerpilot_091105_serverless_cs_context_before_temu_binding(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_serverless_cs_completion_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_blocker text;
begin
  v_context := public.sellerpilot_091105_serverless_cs_context_before_temu_binding(
    p_token_hash, p_job_id, p_claim_token
  );
  if v_context is null
      or v_context->>'channel' <> 'temu'
      or v_context->>'operation' <> 'inquiries.list'
      or v_context->>'status' not in ('running', 'completed_replay') then
    return v_context;
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.credential_id = (v_context->>'credential_id')::uuid
     and job.channel = 'temu'
     and job.operation = 'inquiries.list';
  if not found then
    v_blocker := 'TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
  else
    select credential.* into v_credential
      from sellerpilot_private.channel_credentials credential
     where credential.id = v_job.credential_id
       and credential.channel = v_job.channel
       and credential.environment = v_job.environment;
    if not found
        or v_job.created_by is null
        or v_credential.created_by is null
        or v_job.created_by <> v_credential.created_by then
      v_blocker := 'TEMU_JOB_CREDENTIAL_OWNER_MISMATCH';
    elsif coalesce(v_job.seller_account_key, '') !~ '^[a-f0-9]{64}$'
        or v_job.seller_account_key is distinct from v_credential.seller_account_key then
      v_blocker := 'TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
    elsif v_credential.seller_account_key_source is distinct from 'provider_certified_v1'
        or v_credential.seller_account_verified_at is null then
      v_blocker := 'TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
    end if;
  end if;

  return v_context || jsonb_build_object(
    'credential_binding_context',
    case when v_blocker is not null then jsonb_build_object(
      'contract', 'sellerpilot-cs-credential-context/1',
      'status', 'blocked',
      'blocker', v_blocker,
      'workerIdentityCompared', false
    ) else jsonb_build_object(
      'contract', 'sellerpilot-cs-credential-context/1',
      'status', 'verified',
      'credentialId', v_credential.id,
      'sellerAccountKey', v_credential.seller_account_key,
      'sellerAccountKeySource', v_credential.seller_account_key_source,
      'sellerAccountVerifiedAt', v_credential.seller_account_verified_at,
      'ownerBinding', 'job_credential_same_owner',
      'workerIdentityCompared', false
    ) end
  );
end;
$$;

revoke all on function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) to service_role;

do $verify$
declare
  v_signature regprocedure := to_regprocedure(
    'public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)'
  );
begin
  if not exists (
    select 1
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=""']::text[]
       and pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(procedure.oid),
         '''workerIdentityCompared'', false'
       ) > 0
       and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'TEMU_CS_BINDING_CONTEXT_POSTIMAGE_INVALID';
  end if;
end
$verify$;

comment on function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) is
  'Returns owned serverless CS completion context plus Temu job-to-credential seller binding evidence; shared worker administrator identity is not treated as seller identity.';


-- Reviewed source: 20260909134539_temu_history_checkpoint_resume.sql
-- Original SHA256: fba9de634278133402467bcdd83a604fa46da695e5d11ef301e1400a9f0b20d6
create table sellerpilot_private.temu_history_runs (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  initiated_by uuid references auth.users(id) on delete set null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  from_date date not null,
  to_date date not null,
  cursor_date date,
  cursor_status_group integer check (cursor_status_group between 1 and 7),
  cursor_page_no integer check (cursor_page_no between 1 and 1000000),
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  status text not null default 'running' check (status in ('running','failed','complete')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (to_date >= from_date and to_date - from_date < 366),
  check ((status = 'complete') = (cursor_date is null)),
  check ((status = 'complete') = (cursor_status_group is null)),
  check ((status = 'complete') = (cursor_page_no is null))
);

create table sellerpilot_private.temu_history_completed_pages (
  run_id uuid not null references sellerpilot_private.temu_history_runs(id) on delete cascade,
  cursor_date date not null,
  status_group integer not null check (status_group between 1 and 7),
  page_no integer not null check (page_no between 1 and 1000000),
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  response_digest text not null check (response_digest ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default clock_timestamp(),
  primary key (run_id,cursor_date,status_group,page_no),
  unique (job_id)
);

create table sellerpilot_private.temu_history_checkpoint_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  run_id uuid not null references sellerpilot_private.temu_history_runs(id) on delete restrict,
  cursor_date date not null,
  status_group integer not null check (status_group between 1 and 7),
  page_no integer not null check (page_no between 1 and 1000000),
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (job_id, claim_token)
);

create function sellerpilot_private.reject_temu_history_checkpoint_receipt_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'TEMU_HISTORY_CHECKPOINT_RECEIPT_IMMUTABLE' using errcode='55000';
end;
$$;

create trigger temu_history_checkpoint_receipts_immutable
before update or delete on sellerpilot_private.temu_history_checkpoint_receipts
for each row execute function sellerpilot_private.reject_temu_history_checkpoint_receipt_change();

alter table sellerpilot_private.temu_history_runs enable row level security;
alter table sellerpilot_private.temu_history_completed_pages enable row level security;
alter table sellerpilot_private.temu_history_checkpoint_receipts enable row level security;
revoke all on sellerpilot_private.temu_history_runs from public,anon,authenticated,service_role;
revoke all on sellerpilot_private.temu_history_completed_pages from public,anon,authenticated,service_role;
revoke all on sellerpilot_private.temu_history_checkpoint_receipts from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.reject_temu_history_checkpoint_receipt_change()
  from public,anon,authenticated,service_role;

create function sellerpilot_private.temu_history_arguments(
  p_date date,p_status_group integer,p_page_no integer
) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'kind','after_sales','includeDetails',true,'pageNo',p_page_no,'pageSize',200,
    'afterSalesStatusGroup',p_status_group,
    'updateAtStart',extract(epoch from p_date::timestamp at time zone 'Asia/Seoul')::bigint,
    'updateAtEnd',extract(epoch from (p_date+1)::timestamp at time zone 'Asia/Seoul')::bigint-1
  );
$$;
revoke all on function sellerpilot_private.temu_history_arguments(date,integer,integer)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.temu_history_checkpoint(
  p_credential_id uuid,p_run_id uuid,p_from_date date,p_to_date date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_run sellerpilot_private.temu_history_runs%rowtype;
  v_completed integer:=0;
  v_pending integer:=0;
  v_status text;
begin
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'TEMU_HISTORY_CREDENTIAL_UNVERIFIED' using errcode='55000'; end if;
  if p_from_date is null or p_to_date is null or p_to_date<p_from_date
     or p_to_date-p_from_date>=366 then
    raise exception 'TEMU_HISTORY_RANGE_INVALID' using errcode='22023';
  end if;
  if p_run_id is null then
    return jsonb_build_object(
      'contract','sellerpilot-temu-history-checkpoint/1','checkedAt',statement_timestamp(),
      'runId',null,'status','idle','credentialId',v_credential.id,
      'sellerAccountKeyHash',v_credential.seller_account_key,
      'fromDate',p_from_date,'toDate',p_to_date,
      'activeCursor',jsonb_build_object('date',p_from_date,'statusGroup',1,'pageNo',1),
      'providerArguments',sellerpilot_private.temu_history_arguments(p_from_date,1,1),
      'completedPageCount',0,'pendingJobCount',0,'retryCount',0,'retryCap',3,
      'canResume',true,'completedPagesPreserved',true,
      'providerRetention',jsonb_build_object('status','unverified','earliestSupportedDate',null)
    );
  end if;
  select run.* into v_run from sellerpilot_private.temu_history_runs run
   where run.id=p_run_id and run.credential_id=v_credential.id
     and run.seller_account_key=v_credential.seller_account_key
     and run.owner_id=v_credential.created_by
     and run.from_date=p_from_date and run.to_date=p_to_date;
  if not found then raise exception 'TEMU_HISTORY_RUN_SCOPE_MISMATCH' using errcode='22023'; end if;
  select count(*)::integer into v_completed
    from sellerpilot_private.temu_history_completed_pages page where page.run_id=v_run.id;
  select count(*)::integer into v_pending
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'=v_run.id::text
     and job.status in('queued','running');
  v_status:=case when v_run.status='failed' and v_run.retry_count=3 then'retry_exhausted' else v_run.status end;
  return jsonb_build_object(
    'contract','sellerpilot-temu-history-checkpoint/1','checkedAt',statement_timestamp(),
    'runId',v_run.id,'status',v_status,'credentialId',v_run.credential_id,
    'sellerAccountKeyHash',v_run.seller_account_key,'fromDate',v_run.from_date,'toDate',v_run.to_date,
    'activeCursor',case when v_run.status='complete'then null else jsonb_build_object(
      'date',v_run.cursor_date,'statusGroup',v_run.cursor_status_group,'pageNo',v_run.cursor_page_no)end,
    'providerArguments',case when v_run.status='complete'then null else
      sellerpilot_private.temu_history_arguments(v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no)end,
    'completedPageCount',v_completed,'pendingJobCount',v_pending,'retryCount',v_run.retry_count,'retryCap',3,
    'canResume',v_status in('failed') and v_run.retry_count<3,
    'completedPagesPreserved',true,
    'providerRetention',jsonb_build_object('status','unverified','earliestSupportedDate',null)
  );
end;
$$;
revoke all on function sellerpilot_private.temu_history_checkpoint(uuid,uuid,date,date)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.enqueue_temu_history_cursor(p_run_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_run sellerpilot_private.temu_history_runs%rowtype;v_result jsonb;v_job_id uuid;v_arguments jsonb;
begin
  select run.* into strict v_run from sellerpilot_private.temu_history_runs run where run.id=p_run_id for update;
  v_arguments:=sellerpilot_private.temu_history_arguments(
    v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no
  )||jsonb_build_object(
    'sellerpilotTemuHistoryRunId',v_run.id::text,
    'sellerpilotTemuHistoryCursor',jsonb_build_object(
      'date',v_run.cursor_date,'statusGroup',v_run.cursor_status_group,'pageNo',v_run.cursor_page_no)
  );
  v_result:=public.sellerpilot_service_enqueue_periodic_sync(
    'temu','inquiries.list',jsonb_build_object(
      'periodicKey',format('inquiries:history:temu:%s:%s:%s:%s',v_run.id,v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no),
      'arguments',v_arguments
    ),60
  );
  if v_result->>'status'<>'queued' or coalesce(v_result->>'jobId','')
      !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'TEMU_HISTORY_ENQUEUE_REFUSED';
  end if;
  v_job_id:=(v_result->>'jobId')::uuid;
  if not exists(select 1 from sellerpilot_private.channel_gateway_jobs job
    where job.id=v_job_id and job.credential_id=v_run.credential_id
      and job.seller_account_key=v_run.seller_account_key and job.created_by=v_run.owner_id
      and job.channel='temu' and job.operation='inquiries.list'
      and job.request_payload->'arguments'=v_arguments) then
    raise exception 'TEMU_HISTORY_ENQUEUE_LINEAGE_MISMATCH';
  end if;
  return v_job_id;
end;
$$;
revoke all on function sellerpilot_private.enqueue_temu_history_cursor(uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_get_temu_history_checkpoint_v1(
  p_credential_id uuid,p_run_id uuid,p_from_date date,p_to_date date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  return sellerpilot_private.temu_history_checkpoint(p_credential_id,p_run_id,p_from_date,p_to_date);
end;
$$;
revoke all on function public.sellerpilot_get_temu_history_checkpoint_v1(uuid,uuid,date,date)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_temu_history_checkpoint_v1(uuid,uuid,date,date)
  to authenticated;

create function public.sellerpilot_start_or_resume_temu_history_v1(
  p_credential_id uuid,p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_credential sellerpilot_private.channel_credentials%rowtype;
  v_run sellerpilot_private.temu_history_runs%rowtype;v_cursor jsonb;v_job_id uuid;
begin
  if v_actor is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select credential.* into v_credential from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu' and credential.environment='production'
     and credential.status='active' and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>clock_timestamp());
  if not found then raise exception 'TEMU_HISTORY_CREDENTIAL_UNVERIFIED';end if;
  if p_request->>'action'='start' then
    if jsonb_typeof(p_request)is distinct from'object'
       or (select count(*) from jsonb_object_keys(p_request))<>4
       or exists(select 1 from jsonb_object_keys(p_request)key
         where key not in('action','requestKey','fromDate','toDate'))
       or coalesce(p_request->>'requestKey','')!~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(p_request->>'fromDate','')!~'^\d{4}-\d{2}-\d{2}$'
       or coalesce(p_request->>'toDate','')!~'^\d{4}-\d{2}-\d{2}$'
       or (p_request->>'toDate')::date<(p_request->>'fromDate')::date
       or (p_request->>'toDate')::date-(p_request->>'fromDate')::date>=366
       or (p_request->>'toDate')::date>(clock_timestamp()at time zone'Asia/Seoul')::date then
      raise exception 'TEMU_HISTORY_START_INVALID';end if;
    insert into sellerpilot_private.temu_history_runs(
      request_key,owner_id,initiated_by,credential_id,seller_account_key,from_date,to_date,
      cursor_date,cursor_status_group,cursor_page_no
    )values((p_request->>'requestKey')::uuid,v_credential.created_by,v_actor,v_credential.id,
      v_credential.seller_account_key,(p_request->>'fromDate')::date,(p_request->>'toDate')::date,
      (p_request->>'fromDate')::date,1,1)
    on conflict(request_key)do nothing;
    select run.* into strict v_run from sellerpilot_private.temu_history_runs run
     where run.request_key=(p_request->>'requestKey')::uuid for update;
    if v_run.credential_id<>v_credential.id or v_run.seller_account_key<>v_credential.seller_account_key
       or v_run.from_date<>(p_request->>'fromDate')::date or v_run.to_date<>(p_request->>'toDate')::date then
      raise exception 'TEMU_HISTORY_START_SCOPE_MISMATCH';end if;
    if not exists(select 1 from sellerpilot_private.channel_gateway_jobs job
      where job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'=v_run.id::text) then
      perform sellerpilot_private.enqueue_temu_history_cursor(v_run.id);
    end if;
  elsif p_request->>'action'='resume' then
    v_cursor:=p_request->'expectedCursor';
    if jsonb_typeof(p_request)is distinct from'object'
       or (select count(*) from jsonb_object_keys(p_request))<>4
       or exists(select 1 from jsonb_object_keys(p_request)key
         where key not in('action','runId','expectedCursor','expectedRetryCount'))
       or coalesce(p_request->>'runId','')!~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_cursor)is distinct from'object'
       or (select count(*) from jsonb_object_keys(v_cursor))<>3
       or exists(select 1 from jsonb_object_keys(v_cursor)key
         where key not in('date','statusGroup','pageNo'))
       or coalesce(v_cursor->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_cursor->>'statusGroup','')!~'^[1-7]$'
       or coalesce(v_cursor->>'pageNo','')!~'^[1-9][0-9]{0,5}$'
       or coalesce(p_request->>'expectedRetryCount','')!~'^[0-2]$' then
      raise exception 'TEMU_HISTORY_RESUME_INVALID';end if;
    select run.* into strict v_run from sellerpilot_private.temu_history_runs run
     where run.id=(p_request->>'runId')::uuid and run.credential_id=v_credential.id
       and run.seller_account_key=v_credential.seller_account_key and run.owner_id=v_credential.created_by
       and run.status='failed' and run.retry_count=(p_request->>'expectedRetryCount')::integer
       and run.retry_count<3 and run.cursor_date=(v_cursor->>'date')::date
       and run.cursor_status_group=(v_cursor->>'statusGroup')::integer
       and run.cursor_page_no=(v_cursor->>'pageNo')::integer for update;
    select job.id into strict v_job_id from sellerpilot_private.channel_gateway_jobs job
     where job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'=v_run.id::text
       and job.request_payload#>'{arguments,sellerpilotTemuHistoryCursor}'=v_cursor
       and job.credential_id=v_run.credential_id and job.seller_account_key=v_run.seller_account_key
       and job.created_by=v_run.owner_id and job.channel='temu' and job.operation='inquiries.list'
       and job.status='failed' and job.attempt_count<4
       and job.provider_mutation_started_at is null
     order by job.created_at desc limit 1 for update;
    delete from sellerpilot_private.gateway_completion_receipts receipt
     where receipt.job_id=v_job_id
       and exists(select 1 from sellerpilot_private.ai_cli_worker_tokens token
         where token.id=receipt.worker_token_id and token.scope in('gateway','serverless_cs'));
    if not found then raise exception 'TEMU_HISTORY_FAILED_RECEIPT_REQUIRED';end if;
    update sellerpilot_private.channel_gateway_jobs set status='queued',worker_token_id=null,
      claim_token=null,lease_expires_at=null,completed_at=null,error_message=null,updated_at=clock_timestamp()
     where id=v_job_id;
    update sellerpilot_private.temu_history_runs set status='running',retry_count=retry_count+1,
      updated_at=clock_timestamp() where id=v_run.id returning*into v_run;
  else raise exception 'TEMU_HISTORY_ACTION_INVALID' using errcode='22023';end if;
  return sellerpilot_private.temu_history_checkpoint(
    v_credential.id,v_run.id,v_run.from_date,v_run.to_date
  );
end;
$$;
revoke all on function public.sellerpilot_start_or_resume_temu_history_v1(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_or_resume_temu_history_v1(uuid,jsonb)
  to authenticated;

alter function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  rename to sellerpilot_091120_gateway_context_before_temu_history;
revoke all on function public.sellerpilot_091120_gateway_context_before_temu_history(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb;v_run_id uuid;
begin
  v_context:=public.sellerpilot_091120_gateway_context_before_temu_history(
    p_token_hash,p_job_id,p_claim_token
  );
  if v_context is null or v_context->>'channel'is distinct from'temu'
     or v_context->>'operation'is distinct from'inquiries.list'
     or v_context->>'status'not in('running','completed_replay')then
    return v_context;
  end if;
  select run.id into v_run_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.temu_history_runs run
      on run.id=(case when coalesce(
        job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}',''
      )~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'end)::uuid
     and run.credential_id=job.credential_id
     and run.seller_account_key=job.seller_account_key
     and run.owner_id=job.created_by
   where job.id=p_job_id and job.credential_id=(v_context->>'credential_id')::uuid
     and job.channel='temu'and job.operation='inquiries.list';
  if not found then return v_context;end if;
  return v_context||jsonb_build_object('temuHistoryRunId',v_run_id);
end;
$$;
revoke all on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  to service_role;

create function public.sellerpilot_service_record_temu_history_checkpoint_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_receipt sellerpilot_private.gateway_completion_receipts%rowtype;
  v_checkpoint_receipt sellerpilot_private.temu_history_checkpoint_receipts%rowtype;
  v_run sellerpilot_private.temu_history_runs%rowtype;v_cursor jsonb;v_source_cursor jsonb;
  v_next_job uuid;v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:temu-history-checkpoint:' || coalesce(p_job_id::text,'') || ':' ||
    coalesce(p_claim_token::text,'')
  ));
  select checkpoint.* into v_checkpoint_receipt
    from sellerpilot_private.temu_history_checkpoint_receipts checkpoint
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=checkpoint.worker_token_id
   where checkpoint.job_id=p_job_id and checkpoint.claim_token=p_claim_token
     and token.token_hash=p_token_hash and token.scope in('gateway','serverless_cs')
     and token.status='active' and token.expires_at>clock_timestamp();
  if found then
    return v_checkpoint_receipt.result_payload||jsonb_build_object('replayed',true);
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt on receipt.job_id=job.id
      and receipt.claim_token=p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=receipt.worker_token_id
      and token.token_hash=p_token_hash and token.scope in('gateway','serverless_cs')
      and token.status='active' and token.expires_at>clock_timestamp()
   where job.id=p_job_id and job.channel='temu' and job.operation='inquiries.list'
     and job.status in('succeeded','failed');
  if not found then raise exception 'TEMU_HISTORY_COMPLETION_RECEIPT_REQUIRED';end if;
  select receipt.* into strict v_receipt
    from sellerpilot_private.gateway_completion_receipts receipt
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=receipt.worker_token_id
   where receipt.job_id=v_job.id and receipt.claim_token=p_claim_token
     and token.token_hash=p_token_hash and token.scope in('gateway','serverless_cs')
     and token.status='active' and token.expires_at>clock_timestamp();
  v_source_cursor:=v_job.request_payload#>'{arguments,sellerpilotTemuHistoryCursor}';
  if jsonb_typeof(v_source_cursor)is distinct from'object'
     or coalesce(v_source_cursor->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
     or coalesce(v_source_cursor->>'statusGroup','')!~'^[1-7]$'
     or coalesce(v_source_cursor->>'pageNo','')!~'^[1-9][0-9]{0,5}$' then
    raise exception 'TEMU_HISTORY_COMPLETION_CURSOR_INVALID';
  end if;
  v_cursor:=v_source_cursor;
  select run.* into strict v_run from sellerpilot_private.temu_history_runs run
   where run.id=(v_job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}')::uuid
     and run.credential_id=v_job.credential_id and run.seller_account_key=v_job.seller_account_key
     and run.owner_id=v_job.created_by for update;
  if v_run.status='complete'
     or v_run.cursor_date is distinct from(v_source_cursor->>'date')::date
     or v_run.cursor_status_group is distinct from(v_source_cursor->>'statusGroup')::integer
     or v_run.cursor_page_no is distinct from(v_source_cursor->>'pageNo')::integer then
    raise exception 'TEMU_HISTORY_COMPLETION_CURSOR_STALE' using errcode='40001';
  end if;
  if v_job.status='failed' then
    update sellerpilot_private.temu_history_runs set status='failed',updated_at=clock_timestamp()
     where id=v_run.id returning*into v_run;
  else
    if v_receipt.continuation_job_id is not null then
      select job.request_payload#>'{arguments,sellerpilotTemuHistoryCursor}' into strict v_cursor
        from sellerpilot_private.channel_gateway_jobs job
       where job.id=v_receipt.continuation_job_id and job.credential_id=v_run.credential_id
         and job.seller_account_key=v_run.seller_account_key and job.created_by=v_run.owner_id
         and job.channel='temu' and job.operation='inquiries.list';
      if v_cursor is distinct from v_source_cursor then
        insert into sellerpilot_private.temu_history_completed_pages(
          run_id,cursor_date,status_group,page_no,job_id,response_digest
        )values(v_run.id,v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no,
          v_job.id,v_receipt.completion_fingerprint)on conflict do nothing;
      end if;
      update sellerpilot_private.temu_history_runs set cursor_date=(v_cursor->>'date')::date,
        cursor_status_group=(v_cursor->>'statusGroup')::integer,
        cursor_page_no=(v_cursor->>'pageNo')::integer,retry_count=0,status='running',
        updated_at=clock_timestamp()where id=v_run.id returning*into v_run;
    else
      insert into sellerpilot_private.temu_history_completed_pages(
        run_id,cursor_date,status_group,page_no,job_id,response_digest
      )values(v_run.id,v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no,
        v_job.id,v_receipt.completion_fingerprint)on conflict do nothing;
    end if;
    if v_receipt.continuation_job_id is not null then
      null;
    elsif v_run.cursor_status_group<7 then
      update sellerpilot_private.temu_history_runs set cursor_status_group=cursor_status_group+1,
        cursor_page_no=1,retry_count=0,status='running',updated_at=clock_timestamp()
       where id=v_run.id returning*into v_run;
      v_next_job:=sellerpilot_private.enqueue_temu_history_cursor(v_run.id);
    elsif v_run.cursor_date<v_run.to_date then
      update sellerpilot_private.temu_history_runs set cursor_date=cursor_date+1,
        cursor_status_group=1,cursor_page_no=1,retry_count=0,status='running',updated_at=clock_timestamp()
       where id=v_run.id returning*into v_run;
      v_next_job:=sellerpilot_private.enqueue_temu_history_cursor(v_run.id);
    else
      update sellerpilot_private.temu_history_runs set cursor_date=null,cursor_status_group=null,
        cursor_page_no=null,status='complete',completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where id=v_run.id returning*into v_run;
    end if;
  end if;
  v_result:=sellerpilot_private.temu_history_checkpoint(
    v_run.credential_id,v_run.id,v_run.from_date,v_run.to_date
  )||jsonb_build_object('replayed',false);
  insert into sellerpilot_private.temu_history_checkpoint_receipts(
    job_id,claim_token,worker_token_id,run_id,cursor_date,status_group,page_no,
    completion_fingerprint,result_payload
  )values(
    v_job.id,p_claim_token,v_receipt.worker_token_id,v_run.id,
    (v_source_cursor->>'date')::date,(v_source_cursor->>'statusGroup')::integer,
    (v_source_cursor->>'pageNo')::integer,v_receipt.completion_fingerprint,v_result
  );
  return v_result;
end;
$$;
revoke all on function public.sellerpilot_service_record_temu_history_checkpoint_v1(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_temu_history_checkpoint_v1(text,uuid,uuid)
  to service_role;

comment on function public.sellerpilot_start_or_resume_temu_history_v1(uuid,jsonb) is
  'Starts or explicitly resumes one exact Temu read-only history cursor with a three-retry cap. Completed page receipts are never reset; provider retention remains unverified.';

comment on function public.sellerpilot_service_record_temu_history_checkpoint_v1(text,uuid,uuid) is
  'Advances one exact completed Temu history cursor once and returns the immutable per-job/claim checkpoint receipt on immediate, delayed, or post-completion replay.';

comment on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid) is
  'Preserves the canonical gateway completion context and adds only a validated Temu history run id for the exact owned history job.';

notify pgrst,'reload schema';

-- Reviewed source: 20260909134540_temu_account_scoped_history_metadata.sql
-- Original SHA256: 165793f77b5b032bf97758d9cb2ecfba4273e2ab78a218a34a7331354c3cdc0a
-- The legacy no-argument reader remains available for other channels, but it
-- no longer exposes Temu rows. Temu requires an explicit verified account.
create or replace function public.sellerpilot_read_cs_history_coverage_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'contract','cs_history_coverage_read_v1',
    'checkedAt',statement_timestamp(),
    'scans',coalesce(jsonb_agg(jsonb_build_object(
      'scanId',id,'channel',channel,'environment',environment,'scopeKey',scope_key,
      'ticketKind',ticket_kind,'status',status,'rangeStartAt',range_start_at,
      'rangeEndAt',range_end_at,'timezone',timezone_name,'pageCount',page_count,
      'providerRowCount',provider_row_count,'projectedEventCount',projected_event_count,
      'observedUniqueCount',observed_unique_count,'repeatedObservationCount',repeated_observation_count,
      'excludedCount',excluded_count,'unprocessedCount',unprocessed_count,'missingRanges',missing_ranges,
      'startedAt',started_at,'scanCompletedAt',scan_completed_at,'reconciledAt',reconciled_at,
      'updatedAt',updated_at
    ) order by updated_at desc,id desc) filter (where id is not null),'[]'::jsonb),
    'gaps',(select coalesce(jsonb_agg(jsonb_build_object(
      'jobId',job_id,'channel',channel,'environment',environment,'scopeKey',scope_key,
      'terminalStatus',terminal_status,'firstObservedAt',first_observed_at,
      'lastObservedAt',last_observed_at,'resolvedAt',resolved_at
    ) order by last_observed_at desc,job_id desc),'[]'::jsonb)
      from (select * from sellerpilot_private.cs_history_scan_gaps
        where channel<>'temu' order by last_observed_at desc,job_id desc limit 100) recent_gap)
  ) into v_result
  from (select * from sellerpilot_private.cs_history_scans where channel<>'temu'
    order by updated_at desc,id desc limit 100) scan;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_list_temu_cs_accounts_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'contract','sellerpilot-temu-cs-accounts/1','checkedAt',statement_timestamp(),
    'accounts',coalesce(jsonb_agg(jsonb_build_object(
      'credentialId',credential.id,
      'label',format('Temu 운영 계정 · 키 %s · v%s',left(credential.fingerprint,8),credential.version),
      'environment','production','credentialFingerprint',credential.fingerprint,
      'sellerAccountKeyHash',credential.seller_account_key
    )order by credential.version desc,credential.id),'[]'::jsonb)
  )into v_result
  from sellerpilot_private.channel_credentials credential
  where credential.channel='temu' and credential.environment='production'
    and credential.status='active'
    and (credential.expires_at is null or credential.expires_at>clock_timestamp())
    and coalesce(credential.fingerprint,'')<>''
    and credential.seller_account_key~'^[a-f0-9]{64}$'
    and credential.seller_account_key_source='provider_certified_v1'
    and credential.seller_account_verified_at is not null;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_list_temu_cs_accounts_v1()
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_list_temu_cs_accounts_v1()to authenticated;

create function public.sellerpilot_read_cs_history_coverage_v2(p_credential_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_now timestamptz:=statement_timestamp();
  v_scans jsonb;
  v_gaps jsonb;
  v_exact integer;
  v_legacy integer;
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'TEMU_HISTORY_ACCOUNT_SELECTION_INVALID' using errcode='22023';end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'scanId',row.id,'channel',row.channel,'environment',row.environment,'scopeKey',row.scope_key,
    'ticketKind',row.ticket_kind,'status',row.status,'rangeStartAt',row.range_start_at,
    'rangeEndAt',row.range_end_at,'timezone',row.timezone_name,'pageCount',row.page_count,
    'providerRowCount',row.provider_row_count,'projectedEventCount',row.projected_event_count,
    'observedUniqueCount',row.observed_unique_count,'repeatedObservationCount',row.repeated_observation_count,
    'excludedCount',row.excluded_count,'unprocessedCount',row.unprocessed_count,'missingRanges',row.missing_ranges,
    'startedAt',row.started_at,'scanCompletedAt',row.scan_completed_at,'reconciledAt',row.reconciled_at,
    'updatedAt',row.updated_at
  )order by row.updated_at desc,row.id desc),'[]'::jsonb)into v_scans
  from(select scan.* from sellerpilot_private.cs_history_scans scan
    join sellerpilot_private.channel_gateway_jobs root on root.id=scan.root_job_id
   where scan.channel='temu' and scan.environment='production'
     and scan.credential_id=v_credential.id and scan.owner_id=v_credential.created_by
     and root.credential_id=v_credential.id and root.created_by=v_credential.created_by
     and root.channel='temu' and root.operation='inquiries.list'
     and (root.seller_account_key=v_credential.seller_account_key or root.seller_account_key is null)
   order by scan.updated_at desc,scan.id desc limit 100)row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',row.job_id,'channel',row.channel,'environment',row.environment,'scopeKey',row.scope_key,
    'terminalStatus',row.terminal_status,'firstObservedAt',row.first_observed_at,
    'lastObservedAt',row.last_observed_at,'resolvedAt',row.resolved_at
  )order by row.last_observed_at desc,row.job_id desc),'[]'::jsonb)into v_gaps
  from(select gap.* from sellerpilot_private.cs_history_scan_gaps gap
    join sellerpilot_private.channel_gateway_jobs job on job.id=gap.job_id
   where gap.channel='temu' and gap.environment='production'
     and gap.credential_id=v_credential.id and gap.owner_id=v_credential.created_by
     and job.credential_id=v_credential.id and job.created_by=v_credential.created_by
     and job.channel='temu' and job.operation='inquiries.list'
     and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
   order by gap.last_observed_at desc,gap.job_id desc limit 100)row;

  select count(*)filter(where seller_key=v_credential.seller_account_key)::integer,
         count(*)filter(where seller_key is null)::integer into v_exact,v_legacy
  from(
    select root.seller_account_key seller_key from sellerpilot_private.cs_history_scans scan
      join sellerpilot_private.channel_gateway_jobs root on root.id=scan.root_job_id
     where scan.channel='temu' and scan.environment='production'
       and scan.credential_id=v_credential.id and scan.owner_id=v_credential.created_by
       and root.credential_id=v_credential.id and root.created_by=v_credential.created_by
       and (root.seller_account_key=v_credential.seller_account_key or root.seller_account_key is null)
    union all
    select job.seller_account_key from sellerpilot_private.cs_history_scan_gaps gap
      join sellerpilot_private.channel_gateway_jobs job on job.id=gap.job_id
     where gap.channel='temu' and gap.environment='production'
       and gap.credential_id=v_credential.id and gap.owner_id=v_credential.created_by
       and job.credential_id=v_credential.id and job.created_by=v_credential.created_by
       and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
  )binding;

  return jsonb_build_object(
    'contract','cs_history_coverage_read_v2','checkedAt',v_now,
    'credentialId',v_credential.id,'sellerAccountKeyHash',v_credential.seller_account_key,
    'coverage',jsonb_build_object('contract','cs_history_coverage_read_v1','checkedAt',v_now,
      'scans',v_scans,'gaps',v_gaps),
    'bindingSummary',jsonb_build_object('exactSellerRows',v_exact,'legacyCredentialRows',v_legacy)
  );
end
$$;

revoke all on function public.sellerpilot_read_cs_history_coverage_v2(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_cs_history_coverage_v2(uuid)to authenticated;

create function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(
  p_credential_id uuid,p_job_id uuid default null
)returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_rows jsonb;
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'TEMU_RETRY_ACCOUNT_SELECTION_INVALID' using errcode='22023';end if;
  if p_job_id is not null and not exists(
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.id=p_job_id and job.credential_id=v_credential.id
       and job.created_by=v_credential.created_by and job.channel='temu'
       and job.operation='inquiries.list'
       and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
  )then raise exception 'TEMU_RETRY_JOB_SCOPE_MISMATCH' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',row.job_id,'retryCount',row.retry_count,'deferredCount',row.deferred_count,
    'replayCount',row.replay_count,'providerStatus',row.provider_status,
    'failureCode',row.failure_code,'observedAt',row.observed_at,
    'nextAttemptAt',row.next_attempt_at,'outcome',row.outcome,'resolvedAt',row.resolved_at,
    'accountBinding',case when row.seller_account_key is null then'legacy_credential_owner'
      else'credential_seller_exact'end
  )order by row.observed_at desc,row.job_id,row.retry_count desc),'[]'::jsonb)into v_rows
  from(select ledger.*,job.seller_account_key
    from sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
    join sellerpilot_private.channel_gateway_jobs job on job.id=ledger.job_id
   where job.credential_id=v_credential.id and job.created_by=v_credential.created_by
     and job.channel='temu' and job.operation='inquiries.list'
     and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
     and (p_job_id is null or job.id=p_job_id)
   order by ledger.observed_at desc,ledger.job_id,ledger.retry_count desc limit 100)row;
  return jsonb_build_object(
    'contract','sellerpilot-temu-detail-retry-read/1','checkedAt',statement_timestamp(),
    'credentialId',v_credential.id,'sellerAccountKeyHash',v_credential.seller_account_key,
    'retries',v_rows
  );
end
$$;

revoke all on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(uuid,uuid)
  to authenticated;

comment on function public.sellerpilot_read_cs_history_coverage_v2(uuid)is
  'Reads Temu history coverage for one explicitly selected active provider-certified credential. Shared admins may select accounts; worker ownership is never used as seller ownership.';
comment on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(uuid,uuid)is
  'Reads body-free Temu detail retry metadata for one selected credential and seller binding, with credential-owner compatibility for legacy jobs lacking seller_account_key.';

notify pgrst,'reload schema';

-- Reviewed source: 20260909134541_temu_cs_binding_persistence_replay.sql
-- Original SHA256: c3f8f32fa4f2c494811496109befec01c67391ef553b3dfe949a323e0f3fbc38
do $preimage$
declare
  v_definition text;
begin
  if to_regprocedure(
    'public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'
  ) is null then
    raise exception 'TEMU_CS_BINDING_CANONICAL_RPC_MISSING';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'::regprocedure
  );
  if pg_catalog.strpos(v_definition, 'sellerpilot_private.cs_credential_capability_bindings') = 0
      or pg_catalog.strpos(v_definition, 'token.scope') = 0
      or pg_catalog.strpos(v_definition, '''gateway''') = 0
      or pg_catalog.strpos(v_definition, 'sellerpilot-cs-credential-binding/1') = 0 then
    raise exception 'TEMU_CS_BINDING_CANONICAL_RPC_DRIFT';
  end if;
end
$preimage$;

alter function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) rename to sellerpilot_091215_record_cs_binding_before_temu_serverless;

revoke all on function public.sellerpilot_091215_record_cs_binding_before_temu_serverless(
  text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create table sellerpilot_private.temu_cs_binding_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  app_fingerprint text not null check (app_fingerprint ~ '^[a-f0-9]{64}$'),
  token_fingerprint text not null check (token_fingerprint ~ '^[a-f0-9]{64}$'),
  target_fingerprint text not null check (target_fingerprint ~ '^[a-f0-9]{64}$'),
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (job_id, claim_token)
);

create function sellerpilot_private.reject_temu_cs_binding_receipt_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'TEMU_CS_BINDING_RECEIPT_IMMUTABLE' using errcode='55000';
end;
$$;

create trigger temu_cs_binding_receipts_immutable
before update or delete on sellerpilot_private.temu_cs_binding_receipts
for each row execute function sellerpilot_private.reject_temu_cs_binding_receipt_change();

alter table sellerpilot_private.temu_cs_binding_receipts enable row level security;
revoke all on sellerpilot_private.temu_cs_binding_receipts
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reject_temu_cs_binding_receipt_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_record_cs_credential_binding_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_token_id uuid;
  v_now timestamptz := clock_timestamp();
  v_binding_receipt sellerpilot_private.temu_cs_binding_receipts%rowtype;
  v_result jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found or v_job.channel <> 'temu' then
    return public.sellerpilot_091215_record_cs_binding_before_temu_serverless(
      p_token_hash, p_job_id, p_claim_token, p_evidence
    );
  end if;

  if v_job.operation <> 'inquiries.list'
      or v_job.environment <> 'production'
      or v_job.status <> 'succeeded' then
    raise exception 'TEMU_CS_BINDING_JOB_SCOPE_INVALID';
  end if;

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.worker_token_id = token.id
     and receipt.job_id = v_job.id
     and receipt.claim_token = p_claim_token
   where token.token_hash = p_token_hash
     and token.scope in ('gateway', 'serverless_cs')
     and token.status = 'active'
     and token.expires_at > v_now;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.channel = v_job.channel
     and credential.environment = v_job.environment
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now);
  if not found then
    raise exception 'TEMU_CS_BINDING_CREDENTIAL_INACTIVE';
  end if;
  if v_job.created_by is null
      or v_credential.created_by is null
      or v_job.created_by <> v_credential.created_by then
    raise exception 'TEMU_CS_BINDING_OWNER_MISMATCH';
  end if;
  if coalesce(v_job.seller_account_key, '') !~ '^[a-f0-9]{64}$'
      or v_job.seller_account_key is distinct from v_credential.seller_account_key
      or v_credential.seller_account_key_source is distinct from 'provider_certified_v1'
      or v_credential.seller_account_verified_at is null then
    raise exception 'TEMU_CS_BINDING_ACCOUNT_MISMATCH';
  end if;

  if jsonb_typeof(p_evidence) is distinct from 'object'
      or p_evidence->>'contract' is distinct from 'sellerpilot-cs-credential-binding/1'
      or p_evidence->>'channel' is distinct from 'temu'
      or p_evidence->>'operation' is distinct from 'inquiries.list'
      or p_evidence->>'country' is distinct from 'UNSCOPED'
      or p_evidence->>'sellerAccountKey' is distinct from v_credential.seller_account_key
      or coalesce(p_evidence->>'appFingerprint', '') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'tokenFingerprint', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(p_evidence->'targetFingerprints') is distinct from 'array'
      or jsonb_array_length(case
        when jsonb_typeof(p_evidence->'targetFingerprints') = 'array'
          then p_evidence->'targetFingerprints'
        else '[]'::jsonb
      end) <> 1
      or p_evidence->'targetFingerprints'->>0 is distinct from v_credential.seller_account_key then
    raise exception 'TEMU_CS_BINDING_EVIDENCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:temu-cs-binding:' || v_job.id::text
  ));
  select receipt.* into v_binding_receipt
    from sellerpilot_private.temu_cs_binding_receipts receipt
   where receipt.job_id = v_job.id
     and receipt.claim_token = p_claim_token;
  if found then
    if v_binding_receipt.worker_token_id is distinct from v_token_id
        or v_binding_receipt.credential_id is distinct from v_credential.id
        or v_binding_receipt.seller_account_key is distinct from v_credential.seller_account_key
        or v_binding_receipt.app_fingerprint is distinct from p_evidence->>'appFingerprint'
        or v_binding_receipt.token_fingerprint is distinct from p_evidence->>'tokenFingerprint'
        or v_binding_receipt.target_fingerprint is distinct from v_credential.seller_account_key then
      raise exception 'TEMU_CS_BINDING_REPLAY_MISMATCH' using errcode = '40001';
    end if;
    return v_binding_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  update sellerpilot_private.cs_credential_capability_bindings binding
     set status = 'superseded',
         updated_at = v_now
   where binding.credential_id = v_credential.id
     and binding.operation = 'inquiries.list'
     and binding.status = 'active'
     and (
       binding.app_fingerprint <> p_evidence->>'appFingerprint'
       or binding.token_fingerprint <> p_evidence->>'tokenFingerprint'
       or binding.target_fingerprint <> v_credential.seller_account_key
     );

  insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id, channel, operation, country, app_fingerprint,
    token_fingerprint, target_fingerprint, status, verified_job_id,
    verified_at, expires_at, updated_at
  ) values (
    v_credential.id, 'temu', 'inquiries.list', 'UNSCOPED',
    p_evidence->>'appFingerprint', p_evidence->>'tokenFingerprint',
    v_credential.seller_account_key, 'active', v_job.id, v_now,
    v_credential.expires_at, v_now
  )
  on conflict(
    credential_id, operation, country, app_fingerprint,
    token_fingerprint, target_fingerprint
  ) do update set
    status = 'active',
    verified_job_id = excluded.verified_job_id,
    verified_at = excluded.verified_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  v_result := jsonb_build_object(
    'contract', 'sellerpilot-cs-credential-binding/1',
    'status', 'recorded',
    'bindingCount', 1,
    'credentialId', v_credential.id,
    'sellerAccountKey', v_credential.seller_account_key,
    'replayed', false,
    'workerIdentityCompared', false
  );
  insert into sellerpilot_private.temu_cs_binding_receipts(
    job_id, claim_token, worker_token_id, credential_id, seller_account_key,
    app_fingerprint, token_fingerprint, target_fingerprint, result_payload
  ) values (
    v_job.id, p_claim_token, v_token_id, v_credential.id,
    v_credential.seller_account_key, p_evidence->>'appFingerprint',
    p_evidence->>'tokenFingerprint', v_credential.seller_account_key, v_result
  );
  return v_result;
end
$$;

revoke all on function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) to service_role;

do $postimage$
declare
  v_signature regprocedure := to_regprocedure(
    'public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'
  );
  v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  if not exists (
    select 1
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=""']::text[]
       and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  )
      or pg_catalog.strpos(v_definition, 'receipt.worker_token_id = token.id') = 0
      or pg_catalog.strpos(v_definition, '''serverless_cs''') = 0
      or pg_catalog.strpos(v_definition, 'v_job.created_by <> v_credential.created_by') = 0
      or pg_catalog.strpos(v_definition, 'sellerpilot_private.temu_cs_binding_receipts') = 0
      or pg_catalog.strpos(v_definition, 'is distinct from ''sellerpilot-cs-credential-binding/1''') = 0
      or pg_catalog.strpos(v_definition, 'workerIdentityCompared'', false') = 0 then
    raise exception 'TEMU_CS_BINDING_PERSISTENCE_POSTIMAGE_INVALID';
  end if;
end
$postimage$;

comment on function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) is
  'Records exact Temu inquiry binding for the gateway or dedicated serverless_cs token that owns the immutable completion receipt. Strict JSON identity checks reject missing and null fields; an immutable per-job binding receipt makes old response replay side-effect free after later verification. Job and credential owner/account/environment must match; shared worker identity is not seller identity. Other channels retain the canonical gateway implementation.';

notify pgrst, 'reload schema';

-- Reviewed source: 20260910033000_cs_temu_buyer_chat_readiness.sql
-- Original SHA256: 6178773d968ac5ced7ab65629daec71867ad4058acb1a441bb31ff0c0ecc65a4
do $preimage$
begin
  if to_regprocedure('public.sellerpilot_list_temu_cs_accounts_v1()') is null
      or to_regprocedure(
        'public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)'
      ) is null then
    raise exception 'TEMU_BUYER_CHAT_READINESS_PREIMAGE_MISSING';
  end if;
end
$preimage$;

create table sellerpilot_private.temu_buyer_chat_readiness_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'production')),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  region text not null check (region ~ '^[A-Z][A-Z0-9_-]{1,39}$'),
  source_kind text not null check (source_kind in (
    'partner_center_authenticated_readback',
    'partner_api_authenticated_readback'
  )),
  source_revision bigint not null check (source_revision > 0),
  source_revision_sha256 text not null check (source_revision_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  app_status text not null check (app_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  compliance_status text not null check (compliance_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  security_questionnaire_status text not null check (security_questionnaire_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  seller_authorization_status text not null check (seller_authorization_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  contract_key text check (
    contract_key is null or contract_key ~ '^[A-Z0-9][A-Z0-9_.:/-]{2,159}$'
  ),
  contract_revision_sha256 text check (
    contract_revision_sha256 is null or contract_revision_sha256 ~ '^[a-f0-9]{64}$'
  ),
  permission_package text check (
    permission_package is null or length(permission_package) between 1 and 160
  ),
  granted_permission_packages jsonb not null default '[]'::jsonb check (
    jsonb_typeof(granted_permission_packages) = 'array'
    and octet_length(granted_permission_packages::text) <= 16000
  ),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (credential_id, source_revision),
  check (expires_at > observed_at and expires_at <= observed_at + interval '15 minutes'),
  check (
    (contract_key is null and contract_revision_sha256 is null and permission_package is null)
    or
    (contract_key is not null and contract_revision_sha256 is not null and permission_package is not null)
  )
);

create index temu_buyer_chat_readiness_evidence_latest_idx
  on sellerpilot_private.temu_buyer_chat_readiness_evidence (
    credential_id, source_revision desc, observed_at desc
  );

create function sellerpilot_private.reject_temu_buyer_chat_readiness_evidence_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'TEMU_BUYER_CHAT_EVIDENCE_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger temu_buyer_chat_readiness_evidence_immutable
before update or delete on sellerpilot_private.temu_buyer_chat_readiness_evidence
for each row execute function sellerpilot_private.reject_temu_buyer_chat_readiness_evidence_change();

alter table sellerpilot_private.temu_buyer_chat_readiness_evidence enable row level security;
revoke all on sellerpilot_private.temu_buyer_chat_readiness_evidence
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reject_temu_buyer_chat_readiness_evidence_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_read_temu_buyer_chat_readiness_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_evidence sellerpilot_private.temu_buyer_chat_readiness_evidence%rowtype;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID' using errcode = '22023';
  end if;

  select evidence.* into v_evidence
    from sellerpilot_private.temu_buyer_chat_readiness_evidence evidence
   where evidence.credential_id = v_credential.id
     and evidence.owner_id = v_credential.created_by
     and evidence.environment = v_credential.environment
     and evidence.seller_account_key = v_credential.seller_account_key
   order by evidence.source_revision desc, evidence.observed_at desc
   limit 1;

  return jsonb_build_object(
    'contract', 'sellerpilot-temu-buyer-chat-runtime-read/1',
    'checkedAt', statement_timestamp(),
    'credentialId', v_credential.id,
    'sellerAccountKey', v_credential.seller_account_key,
    'environment', v_credential.environment,
    'evidence', case when v_evidence.id is null then null else jsonb_build_object(
      'contract', 'sellerpilot-temu-buyer-chat-runtime-evidence/1',
      'source', 'sellerpilot_private.temu_buyer_chat_readiness_evidence',
      'sourceKind', v_evidence.source_kind,
      'sourceRevision', v_evidence.source_revision,
      'sourceRevisionSha256', v_evidence.source_revision_sha256,
      'credentialId', v_evidence.credential_id,
      'sellerAccountKey', v_evidence.seller_account_key,
      'environment', v_evidence.environment,
      'region', v_evidence.region,
      'observedAt', v_evidence.observed_at,
      'expiresAt', v_evidence.expires_at,
      'appStatus', v_evidence.app_status,
      'complianceStatus', v_evidence.compliance_status,
      'securityQuestionnaireStatus', v_evidence.security_questionnaire_status,
      'sellerAuthorizationStatus', v_evidence.seller_authorization_status,
      'contractKey', v_evidence.contract_key,
      'contractRevisionSha256', v_evidence.contract_revision_sha256,
      'permissionPackage', v_evidence.permission_package,
      'grantedPermissionPackages', v_evidence.granted_permission_packages
    ) end
  );
end;
$$;

create function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_evidence sellerpilot_private.temu_buyer_chat_readiness_evidence%rowtype;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where token.token_hash = p_token_hash
     and token.scope in ('gateway', 'serverless_cs')
     and token.status = 'active'
     and token.expires_at > v_now
     and job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > v_now
     and job.channel = 'temu'
     and job.operation = 'inquiries.list'
     and job.request_payload #>> '{arguments,kind}' = 'buyer_chat';
  if not found then
    raise exception 'TEMU_BUYER_CHAT_JOB_OWNERSHIP_INVALID' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.channel = v_job.channel
     and credential.environment = v_job.environment
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now)
     and credential.created_by = v_job.created_by
     and credential.seller_account_key = v_job.seller_account_key
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'TEMU_BUYER_CHAT_ACCOUNT_BINDING_INVALID' using errcode = '42501';
  end if;

  select evidence.* into v_evidence
    from sellerpilot_private.temu_buyer_chat_readiness_evidence evidence
   where evidence.credential_id = v_credential.id
     and evidence.owner_id = v_credential.created_by
     and evidence.environment = v_credential.environment
     and evidence.seller_account_key = v_credential.seller_account_key
   order by evidence.source_revision desc, evidence.observed_at desc
   limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'contract', 'sellerpilot-temu-buyer-chat-runtime-evidence/1',
    'source', 'sellerpilot_private.temu_buyer_chat_readiness_evidence',
    'sourceKind', v_evidence.source_kind,
    'sourceRevision', v_evidence.source_revision,
    'sourceRevisionSha256', v_evidence.source_revision_sha256,
    'credentialId', v_evidence.credential_id,
    'sellerAccountKey', v_evidence.seller_account_key,
    'environment', v_evidence.environment,
    'region', v_evidence.region,
    'observedAt', v_evidence.observed_at,
    'expiresAt', v_evidence.expires_at,
    'appStatus', v_evidence.app_status,
    'complianceStatus', v_evidence.compliance_status,
    'securityQuestionnaireStatus', v_evidence.security_questionnaire_status,
    'sellerAuthorizationStatus', v_evidence.seller_authorization_status,
    'contractKey', v_evidence.contract_key,
    'contractRevisionSha256', v_evidence.contract_revision_sha256,
    'permissionPackage', v_evidence.permission_package,
    'grantedPermissionPackages', v_evidence.granted_permission_packages
  );
end;
$$;

revoke all on function public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)
  to authenticated;
revoke all on function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid)
  to service_role;

comment on table sellerpilot_private.temu_buyer_chat_readiness_evidence is
  'Immutable short-lived server evidence only. No public writer exists; arbitrary request or credential payload strings cannot activate Buyer Chat.';
comment on function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid) is
  'Returns exact job/claim/credential/seller-bound Temu Buyer Chat evidence without making a provider request.';


-- Reviewed source: 20260910051600_cs_temu_buyer_chat_observation_writer.sql
-- Original SHA256: 644e0e70de0fa86995810c5f3ed7f661a535cff9843a86ee45eabaf59b038721
do $preimage$
begin
  if to_regclass('sellerpilot_private.temu_buyer_chat_readiness_evidence') is null
      or to_regprocedure('public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)') is null then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_PREIMAGE_MISSING';
  end if;
end
$preimage$;

create table sellerpilot_private.temu_buyer_chat_observation_diagnostics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null check (environment = 'production'),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  region text not null check (region = 'GLOBAL'),
  source_kind text not null check (source_kind = 'authenticated_admin_diagnostic'),
  verification_state text not null check (verification_state = 'unverified'),
  source_actor_id uuid not null references auth.users(id) on delete restrict,
  client_observation_id uuid not null,
  artifact_id uuid not null unique,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  source_revision bigint not null check (source_revision > 0),
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_app_status text not null check (claimed_app_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  claimed_compliance_status text not null check (claimed_compliance_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  claimed_security_questionnaire_status text not null check (claimed_security_questionnaire_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  claimed_seller_authorization_status text not null check (claimed_seller_authorization_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  diagnostic_reason text not null check (diagnostic_reason = 'PROVIDER_AUTHENTICATED_SOURCE_UNVERIFIED'),
  unique (credential_id, client_observation_id),
  unique (credential_id, source_revision),
  check (observed_at >= recorded_at - interval '15 minutes'),
  check (observed_at <= recorded_at + interval '1 minute'),
  check (expires_at > recorded_at and expires_at <= recorded_at + interval '15 minutes')
);

create index temu_buyer_chat_observation_diagnostics_latest_idx
  on sellerpilot_private.temu_buyer_chat_observation_diagnostics (
    credential_id, source_revision desc, recorded_at desc
  );

create function sellerpilot_private.reject_temu_buyer_chat_observation_diagnostic_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'TEMU_BUYER_CHAT_OBSERVATION_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger temu_buyer_chat_observation_diagnostics_immutable
before update or delete on sellerpilot_private.temu_buyer_chat_observation_diagnostics
for each row execute function sellerpilot_private.reject_temu_buyer_chat_observation_diagnostic_change();

alter table sellerpilot_private.temu_buyer_chat_observation_diagnostics enable row level security;
revoke all on sellerpilot_private.temu_buyer_chat_observation_diagnostics
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reject_temu_buyer_chat_observation_diagnostic_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  p_credential_id uuid,
  p_client_observation_id uuid,
  p_artifact_id uuid,
  p_artifact_sha256 text,
  p_expected_revision bigint,
  p_observed_at timestamptz,
  p_claimed_app_status text,
  p_claimed_compliance_status text,
  p_claimed_security_questionnaire_status text,
  p_claimed_seller_authorization_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_actor uuid := auth.uid();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_revision bigint;
  v_row sellerpilot_private.temu_buyer_chat_observation_diagnostics%rowtype;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_artifact_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_ARTIFACT_INVALID' using errcode = '22023';
  end if;
  if p_observed_at < v_now - interval '15 minutes'
      or p_observed_at > v_now + interval '1 minute' then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_TIME_INVALID' using errcode = '22023';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('temu-buyer-chat-observation:' || v_credential.id::text, 0));
  select coalesce(max(diagnostic.source_revision), 0) + 1 into v_revision
    from sellerpilot_private.temu_buyer_chat_observation_diagnostics diagnostic
   where diagnostic.credential_id = v_credential.id;
  if p_expected_revision is distinct from v_revision then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_REVISION_MISMATCH' using errcode = '40001';
  end if;

  insert into sellerpilot_private.temu_buyer_chat_observation_diagnostics(
    owner_id,credential_id,environment,seller_account_key,region,source_kind,
    verification_state,source_actor_id,client_observation_id,artifact_id,
    artifact_sha256,source_revision,observed_at,recorded_at,expires_at,
    claimed_app_status,claimed_compliance_status,
    claimed_security_questionnaire_status,claimed_seller_authorization_status,
    diagnostic_reason
  ) values(
    v_credential.created_by,v_credential.id,v_credential.environment,
    v_credential.seller_account_key,'GLOBAL','authenticated_admin_diagnostic',
    'unverified',v_actor,p_client_observation_id,p_artifact_id,
    p_artifact_sha256,v_revision,p_observed_at,v_now,v_now + interval '15 minutes',
    p_claimed_app_status,p_claimed_compliance_status,
    p_claimed_security_questionnaire_status,p_claimed_seller_authorization_status,
    'PROVIDER_AUTHENTICATED_SOURCE_UNVERIFIED'
  ) returning * into v_row;

  return jsonb_build_object(
    'contract', 'sellerpilot-temu-buyer-chat-observation-diagnostic/1',
    'artifactId', v_row.artifact_id,
    'artifactSha256', v_row.artifact_sha256,
    'credentialId', v_row.credential_id,
    'sellerAccountKey', v_row.seller_account_key,
    'environment', v_row.environment,
    'region', v_row.region,
    'sourceKind', v_row.source_kind,
    'sourceRevision', v_row.source_revision,
    'verificationState', v_row.verification_state,
    'observedAt', v_row.observed_at,
    'recordedAt', v_row.recorded_at,
    'expiresAt', v_row.expires_at,
    'diagnosticReason', v_row.diagnostic_reason,
    'trustedReadinessEvidenceCreated', false
  );
exception
  when unique_violation then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_REPLAY' using errcode = '23505';
end;
$$;

revoke all on function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  uuid,uuid,uuid,text,bigint,timestamptz,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  uuid,uuid,uuid,text,bigint,timestamptz,text,text,text,text
) to authenticated;

comment on table sellerpilot_private.temu_buyer_chat_observation_diagnostics is
  'Immutable, short-lived authenticated-admin observations. Always unverified and excluded from the trusted Buyer Chat readiness ledger and runtime gate.';
comment on function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  uuid,uuid,uuid,text,bigint,timestamptz,text,text,text,text
) is
  'Persists claims only as unverified diagnostics. It cannot create or promote Temu Buyer Chat readiness evidence.';


commit;
