-- Integration-owned forward migration proposal. Do not apply from the Coupang
-- worktree. The existing v3 wrapper remains the canonical Coupang path. New
-- runs collapse the four Call Center status calls to one NONE=All call while
-- legacy eight-scope runs remain replayable and checkpoint-readable.
begin;

do $migration$
declare
  v_checkpoint text;
  v_core text;
  v_extend text;
  v_enqueue regprocedure := to_regprocedure(
    'sellerpilot_private.enqueue_inquiry_history_backfill_item(uuid,text,text,jsonb)'
  );
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)'::regprocedure
  ) into v_checkpoint;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_08047100_history_before_coupang_after_sales(text[],integer,date)'::regprocedure
  ) into v_core;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)'::regprocedure
  ) into v_extend;
  if v_checkpoint is null
     or position('ceil(v_run.history_days / 7.0)::integer * 8' in v_checkpoint) = 0
     or position('sellerpilot-coupang-history-checkpoint/1' in v_checkpoint) = 0
     or v_core is null
     or position('ceil(p_history_days / 7.0)::integer * 5' in v_core) = 0
     or v_extend is null
     or position('ceil(v_run.history_days/7.0)::integer*8' in v_extend) = 0
     or v_enqueue is null
     or not exists (
       select 1 from pg_proc p
        where p.oid = v_enqueue
          and position(
            'enqueue_inquiry_history_backfill_item_before_elevenst_qna'
            in p.prosrc
          ) > 0
     )
     or to_regprocedure(
       'sellerpilot_private.enqueue_inquiry_history_backfill_item_before_coupang_none_all(uuid,text,text,jsonb)'
     ) is not null
     or not has_function_privilege(
       'authenticated',
       'public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)',
       'EXECUTE'
     ) then
    raise exception 'COUPANG_HISTORY_NONE_ALL_PREIMAGE_REVIEW_REQUIRED';
  end if;
end
$migration$;

-- The reviewed core v3 function originally counts product plus four Call
-- Center requests per window. The wrapper below adds three after-sales jobs.
-- After the enqueue adapter suppresses the three overlapping status calls,
-- the core must expect product plus NONE only before the wrapper extends it.
do $core$
declare
  v_definition text;
  v_old constant text := 'ceil(p_history_days / 7.0)::integer * 5';
  v_new constant text := 'ceil(p_history_days / 7.0)::integer * 2';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_08047100_history_before_coupang_after_sales(text[],integer,date)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) = 0 or position(v_new in v_definition) > 0 then
    raise exception 'COUPANG_HISTORY_NONE_ALL_CORE_PREIMAGE_REVIEW_REQUIRED';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$core$;

alter function sellerpilot_private.enqueue_inquiry_history_backfill_item(
  uuid, text, text, jsonb
) rename to enqueue_inquiry_history_backfill_item_before_coupang_none_all;

create function sellerpilot_private.enqueue_inquiry_history_backfill_item(
  p_run_id uuid,
  p_channel text,
  p_item_key text,
  p_arguments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := p_arguments #>> '{query,partnerCounselingStatus}';
  v_start text := p_arguments #>> '{query,inquiryStartAt}';
  v_end text := p_arguments #>> '{query,inquiryEndAt}';
  v_none_item_key text;
  v_none_job_id uuid;
begin
  if p_channel = 'coupang'
     and p_arguments->>'kind' = 'call-center'
     and v_status in ('ANSWER', 'NO_ANSWER', 'TRANSFER') then
    if v_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or v_end !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or p_item_key is distinct from format(
         'call-center:%s:%s:%s', lower(v_status), v_start, v_end
       )
       or p_arguments #>> '{query,pageNum}' is distinct from '1'
       or p_arguments #>> '{query,pageSize}' is distinct from '30'
       or not exists (
         select 1
           from sellerpilot_private.inquiry_history_backfill_runs run
          where run.id = p_run_id
            and 'coupang' = any(run.channels)
       ) then
      raise exception 'COUPANG_HISTORY_REDUNDANT_STATUS_SCOPE_INVALID';
    end if;
    v_none_item_key := format('call-center:none:%s:%s', v_start, v_end);
    select job.id into v_none_job_id
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'coupang'
       and job.operation = 'inquiries.list'
       and job.request_payload #>> '{arguments,sellerpilotHistoryRunId}' = p_run_id::text
       and job.request_payload #>> '{arguments,sellerpilotHistoryItemKey}' = v_none_item_key
       and job.request_payload #>> '{arguments,query,partnerCounselingStatus}' = 'NONE';
    if v_none_job_id is null then
      raise exception 'COUPANG_HISTORY_NONE_SCOPE_MISSING';
    end if;
    return v_none_job_id;
  end if;
  return sellerpilot_private.enqueue_inquiry_history_backfill_item_before_coupang_none_all(
    p_run_id, p_channel, p_item_key, p_arguments
  );
end;
$$;

revoke all on function
  sellerpilot_private.enqueue_inquiry_history_backfill_item_before_coupang_none_all(
    uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.enqueue_inquiry_history_backfill_item(
    uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_start_inquiry_history_backfill_v3(
  p_channels text[],
  p_history_days integer default 30,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_run_id uuid;
  v_run record;
  v_slice_start date;
  v_slice_end date;
  v_item_key text;
  v_expected integer;
  v_current_expected integer;
  v_legacy_expected integer;
  v_reused boolean;
  v_retried integer;
begin
  v_result := public.sellerpilot_08047100_history_before_coupang_after_sales(
    p_channels, p_history_days, p_end_date
  );
  v_reused := coalesce((v_result->>'reused')::boolean, false);
  v_retried := coalesce((v_result->>'retriedJobs')::integer, 0);
  if not ('coupang' = any(p_channels)) then return v_result; end if;
  if coalesce(v_result->>'runId', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'COUPANG_AFTER_SALES_HISTORY_RUN_INVALID';
  end if;
  v_run_id := (v_result->>'runId')::uuid;
  select run.history_days, run.range_start, run.range_end, run.channels,
         run.expected_initial_jobs
    into strict v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id = v_run_id
   for update;
  v_current_expected := case when 'coupang' = any(v_run.channels)
      then ceil(v_run.history_days / 7.0)::integer * 5 else 0 end
    + case when 'smartstore' = any(v_run.channels) then 2 else 0 end;
  v_legacy_expected := case when 'coupang' = any(v_run.channels)
      then ceil(v_run.history_days / 7.0)::integer * 8 else 0 end
    + case when 'smartstore' = any(v_run.channels) then 2 else 0 end;
  if v_reused then
    if v_run.expected_initial_jobs not in (v_current_expected, v_legacy_expected) then
      raise exception 'COUPANG_AFTER_SALES_HISTORY_EXPECTED_SCOPE_INVALID';
    end if;
    v_expected := v_run.expected_initial_jobs;
  else
    v_expected := v_current_expected;
    update sellerpilot_private.inquiry_history_backfill_runs
       set expected_initial_jobs = v_expected,
           updated_at = clock_timestamp()
     where id = v_run_id;
  end if;

  v_slice_start := v_run.range_start;
  while v_slice_start <= v_run.range_end loop
    v_slice_end := least(v_slice_start + 6, v_run.range_end);
    foreach v_item_key in array array['return_request', 'cancel_request'] loop
      if not exists (
        select 1 from sellerpilot_private.channel_gateway_jobs job
         where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}' = v_run_id::text
           and job.request_payload #>> '{arguments,sellerpilotHistoryItemKey}' =
             format('%s:%s:%s', v_item_key, v_slice_start, v_slice_end)
      ) then
        perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
          v_run_id,
          'coupang',
          format('%s:%s:%s', v_item_key, v_slice_start, v_slice_end),
          jsonb_build_object(
            'kind', v_item_key,
            'query', jsonb_build_object(
              'searchType', 'timeFrame',
              'createdAtFrom', format('%sT00:00', v_slice_start),
              'createdAtTo', format('%sT23:59', v_slice_end),
              'cancelType', case when v_item_key = 'return_request'
                then 'RETURN' else 'CANCEL' end
            )
          )
        );
      end if;
    end loop;
    if not exists (
      select 1 from sellerpilot_private.channel_gateway_jobs job
       where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}' = v_run_id::text
         and job.request_payload #>> '{arguments,sellerpilotHistoryItemKey}' =
           format('exchange_request:%s:%s', v_slice_start, v_slice_end)
    ) then
      perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
        v_run_id,
        'coupang',
        format('exchange_request:%s:%s', v_slice_start, v_slice_end),
        jsonb_build_object(
          'kind', 'exchange_request',
          'query', jsonb_build_object(
            'createdAtFrom', format('%sT00:00:00', v_slice_start),
            'createdAtTo', format('%sT23:59:59', v_slice_end),
            'maxPerPage', 10
          )
        )
      );
    end if;
    v_slice_start := v_slice_start + 7;
  end loop;
  v_result := sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
  if coalesce((v_result->>'totalJobs')::integer, 0) < v_expected then
    raise exception 'COUPANG_AFTER_SALES_HISTORY_ENQUEUE_COUNT_MISMATCH';
  end if;
  if not v_reused and coalesce((v_result->>'totalJobs')::integer, 0) <> v_expected then
    raise exception 'COUPANG_AFTER_SALES_HISTORY_ENQUEUE_COUNT_MISMATCH';
  end if;
  return v_result || jsonb_build_object(
    'reused', v_reused,
    'retriedJobs', v_retried
  );
end;
$$;

revoke all on function
  public.sellerpilot_start_inquiry_history_backfill_v3(text[], integer, date)
  from public, anon, service_role;
grant execute on function
  public.sellerpilot_start_inquiry_history_backfill_v3(text[], integer, date)
  to authenticated;

create or replace function public.sellerpilot_get_coupang_history_checkpoint_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_state jsonb;
  v_current_expected integer;
  v_legacy_expected integer;
  v_expected integer;
  v_total integer;
  v_queued integer;
  v_running integer;
  v_succeeded integer;
  v_failed integer;
  v_complete boolean;
begin
  if v_actor is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select run.* into v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id = p_run_id
   for update;
  if not found then return null; end if;

  v_current_expected := ceil(v_run.history_days / 7.0)::integer * 5;
  v_legacy_expected := ceil(v_run.history_days / 7.0)::integer * 8;
  if v_run.channels is distinct from array['coupang']::text[]
     or v_run.history_days not between 7 and 30
     or v_run.range_end - v_run.range_start <> v_run.history_days - 1
     or v_run.expected_initial_jobs not in (v_current_expected, v_legacy_expected) then
    raise exception 'COUPANG_HISTORY_CHECKPOINT_SCOPE_INVALID'
      using errcode = '23514';
  end if;
  v_expected := v_run.expected_initial_jobs;

  v_state := sellerpilot_private.refresh_inquiry_history_backfill_run(v_run.id);
  if v_state is null then return null; end if;
  v_total := coalesce((v_state->>'totalJobs')::integer, -1);
  v_queued := coalesce((v_state->>'queuedJobs')::integer, -1);
  v_running := coalesce((v_state->>'runningJobs')::integer, -1);
  v_succeeded := coalesce((v_state->>'succeededJobs')::integer, -1);
  v_failed := coalesce((v_state->>'failedJobs')::integer, -1);
  if least(v_total, v_queued, v_running, v_succeeded, v_failed) < 0
     or v_total < v_expected
     or v_total <> v_queued + v_running + v_succeeded + v_failed
     or v_state->>'fromDate' is distinct from v_run.range_start::text
     or v_state->>'toDate' is distinct from v_run.range_end::text
     or (v_state->>'expectedInitialJobs')::integer is distinct from v_expected then
    raise exception 'COUPANG_HISTORY_CHECKPOINT_LEDGER_INVALID'
      using errcode = '23514';
  end if;

  v_complete := coalesce(v_state->>'status' = 'succeeded', false)
    and v_queued = 0
    and v_running = 0
    and v_failed = 0
    and v_succeeded = v_total
    and nullif(v_state->>'completedAt', '') is not null;

  return v_state || jsonb_build_object(
    'contract', 'sellerpilot-coupang-history-checkpoint/1',
    'canAdvance', v_complete,
    'replayEndDate', v_run.range_end::text,
    'nextEndDate', case when v_complete
      then (v_run.range_start - 1)::text else null end
  );
end;
$$;

revoke all on function
  public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)
  to authenticated;

comment on function
  public.sellerpilot_start_inquiry_history_backfill_v3(text[], integer, date) is
  'Queues current five-scope Coupang history while replaying existing legacy eight-scope runs unchanged.';
comment on function public.sellerpilot_get_coupang_history_checkpoint_v1(uuid) is
  'Authenticated Coupang-only checkpoint accepting current five-scope and existing legacy eight-scope runs.';

notify pgrst, 'reload schema';
commit;
