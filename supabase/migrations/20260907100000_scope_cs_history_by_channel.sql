-- Scope history runs to the selected channels. Preserve legacy calls and jobs.
begin;
alter table sellerpilot_private.inquiry_history_backfill_runs
  add column channels text[] not null default array['coupang', 'smartstore']::text[],
  add column credential_ids jsonb not null default '{}'::jsonb,
  add constraint inquiry_history_selected_channels_check check (
    channels = array['coupang']::text[] or channels = array['smartstore']::text[]
    or channels = array['coupang', 'smartstore']::text[]
  ),
  add constraint inquiry_history_credential_ids_check check (jsonb_typeof(credential_ids) = 'object');

create or replace function sellerpilot_private.refresh_inquiry_history_backfill_run_before_static_egress_gate(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_total integer := 0;
  v_queued integer := 0;
  v_running integer := 0;
  v_succeeded integer := 0;
  v_failed integer := 0;
  v_status text;
  v_completed_at timestamptz;
  v_progress integer := 0;
begin
  select run.*
    into v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id = p_run_id
   for update;
  if not found then
    return null;
  end if;

  select count(*)::integer,
         count(*) filter (where job.status = 'queued')::integer,
         count(*) filter (where job.status = 'running')::integer,
         count(*) filter (where job.status = 'succeeded')::integer,
         count(*) filter (
           where job.status in ('failed', 'cancelled', 'reconciliation_required')
         )::integer
    into v_total, v_queued, v_running, v_succeeded, v_failed
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}'
         = p_run_id::text;

  v_status := case
    when v_total >= v_run.expected_initial_jobs
      and v_queued = 0
      and v_running = 0
      and v_failed = 0
      then 'succeeded'
    when v_total >= v_run.expected_initial_jobs
      and v_queued = 0
      and v_running = 0
      and v_failed > 0
      then 'failed'
    when v_running > 0 or v_succeeded > 0 or v_failed > 0
      then 'running'
    else 'queued'
  end;
  v_completed_at := case
    when v_status in ('succeeded', 'failed')
      then coalesce(v_run.completed_at, clock_timestamp())
    else null
  end;
  v_progress := case
    when v_total = 0 then 0
    else floor(100.0 * (v_succeeded + v_failed) / v_total)::integer
  end;

  update sellerpilot_private.inquiry_history_backfill_runs run
     set status = v_status,
         total_jobs = v_total,
         queued_jobs = v_queued,
         running_jobs = v_running,
         succeeded_jobs = v_succeeded,
         failed_jobs = v_failed,
         updated_at = clock_timestamp(),
         completed_at = v_completed_at
   where run.id = p_run_id
  returning run.* into v_run;

  return jsonb_build_object(
    'runId', v_run.id,
    'status', v_run.status,
    'historyDays', v_run.history_days,
    'fromDate', v_run.range_start,
    'toDate', v_run.range_end,
    'channels', to_jsonb(v_run.channels),
    'expectedInitialJobs', v_run.expected_initial_jobs,
    'totalJobs', v_run.total_jobs,
    'queuedJobs', v_run.queued_jobs,
    'runningJobs', v_run.running_jobs,
    'succeededJobs', v_run.succeeded_jobs,
    'failedJobs', v_run.failed_jobs,
    'progressPercent', v_progress,
    'startedAt', v_run.created_at,
    'updatedAt', v_run.updated_at,
    'completedAt', v_run.completed_at
  );
end;
$$;

create or replace function sellerpilot_private.refresh_inquiry_history_backfill_run(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_progress integer := 0;
begin
  select run.*
    into v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id = p_run_id;
  if not found then return null; end if;
  if v_run.status <> 'blocked' then
    return sellerpilot_private.refresh_inquiry_history_backfill_run_before_static_egress_gate(
      p_run_id
    );
  end if;
  v_progress := case
    when v_run.total_jobs = 0 then 0
    else floor(100.0 * v_run.succeeded_jobs / v_run.total_jobs)::integer
  end;
  return jsonb_build_object(
    'runId', v_run.id,
    'status', 'blocked',
    'blockedReason', v_run.blocked_reason,
    'historyDays', v_run.history_days,
    'fromDate', v_run.range_start,
    'toDate', v_run.range_end,
    'channels', to_jsonb(v_run.channels),
    'expectedInitialJobs', v_run.expected_initial_jobs,
    'totalJobs', v_run.total_jobs,
    'queuedJobs', 0,
    'runningJobs', 0,
    'succeededJobs', v_run.succeeded_jobs,
    'failedJobs', 0,
    'progressPercent', v_progress,
    'startedAt', v_run.created_at,
    'updatedAt', v_run.updated_at,
    'completedAt', v_run.completed_at
  );
end;
$$;

create function public.sellerpilot_start_inquiry_history_backfill_v2(
  p_channels text[],
  p_history_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_range_end date;
  v_range_start date;
  v_owner_id uuid;
  v_channels text[];
  v_channel text;
  v_credential record;
  v_credentials jsonb := '{}'::jsonb;
  v_request_key text;
  v_run_id uuid;
  v_existing_run_id uuid;
  v_existing_status text;
  v_expected integer;
  v_retried_jobs integer := 0;
  v_slice_start date;
  v_slice_end date;
  v_partner_status text;
  v_result jsonb;
begin
  if v_actor is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_history_days is null or p_history_days not between 7 and 30 then
    raise exception 'history range must be between 7 and 30 days';
  end if;

  if p_channels is null or cardinality(p_channels) not between 1 and 2
     or array_position(p_channels, null) is not null
     or not p_channels <@ array['coupang', 'smartstore']::text[] then
    raise exception 'invalid inquiry history channels' using errcode = '22023';
  end if;
  select array_agg(distinct channel order by channel) into v_channels
    from unnest(p_channels) channel;
  if cardinality(v_channels) <> cardinality(p_channels) then
    raise exception 'duplicate inquiry history channels' using errcode = '22023';
  end if;
  foreach v_channel in array v_channels loop
    if not exists (
      select 1 from sellerpilot_private.serverless_static_egress_policy policy
       where policy.channel = v_channel and policy.enabled
    ) then
      raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
    end if;
    select credential.id, credential.created_by into v_credential
      from sellerpilot_private.channel_credentials credential
     where credential.channel = v_channel
       and credential.environment = 'production' and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > v_now)
     order by credential.version desc limit 1 for update;
    if not found or v_credential.created_by is null then
      raise exception 'selected marketplace credential must be active' using errcode = '55000';
    end if;
    if v_owner_id is not null and v_owner_id <> v_credential.created_by then
      raise exception 'selected marketplace credential owners do not match' using errcode = '55000';
    end if;
    v_owner_id := v_credential.created_by;
    v_credentials := v_credentials || jsonb_build_object(v_channel, v_credential.id::text);
  end loop;

  v_range_end := (v_now at time zone 'Asia/Seoul')::date;
  v_range_start := v_range_end - (p_history_days - 1);
  v_expected := case when 'coupang' = any(v_channels) then ceil(p_history_days / 7.0)::integer * 5 else 0 end
    + case when 'smartstore' = any(v_channels) then 2 else 0 end;
  v_request_key := encode(
    extensions.digest(
      concat_ws(
        '|',
        'channel-inquiry-history-v2',
        v_owner_id::text,
        v_range_start::text,
        v_range_end::text,
        p_history_days::text,
        array_to_string(v_channels, ','),
        v_credentials::text
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:inquiry-history:' || v_request_key)
  );
  select run.id, run.status
    into v_existing_run_id, v_existing_status
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.request_key = v_request_key
   for update;
  if v_existing_run_id is not null then
    -- This RPC is called only by the explicit administrator button. Recover
    -- bounded read failures in place, but never automatically replay a write,
    -- a reconciliation row, a cancelled row, or an exhausted four-attempt job.
    if v_existing_status = 'blocked' then
      update sellerpilot_private.inquiry_history_backfill_runs
         set status = 'failed', blocked_reason = null, updated_at = clock_timestamp()
       where id = v_existing_run_id;
      v_existing_status := 'failed';
    end if;
    if v_existing_status = 'failed' then
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'queued',
             worker_token_id = null,
             claim_token = null,
             lease_expires_at = null,
             completed_at = null,
             error_message = null,
             updated_at = clock_timestamp()
       where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}'
             = v_existing_run_id::text
         and job.credential_id::text = v_credentials->>job.channel
         and job.operation = 'inquiries.list'
         and job.status = 'failed'
         and job.attempt_count < 4
         and not job.credential_refresh_in_flight
         and job.credential_refresh_recovery_vault_id is null;
      get diagnostics v_retried_jobs = row_count;
    end if;
    return sellerpilot_private.refresh_inquiry_history_backfill_run(
      v_existing_run_id
    ) || jsonb_build_object(
      'reused', true,
      'retriedJobs', v_retried_jobs
    );
  end if;

  insert into sellerpilot_private.inquiry_history_backfill_runs (
    request_key,
    owner_id,
    initiated_by,
    history_days,
    range_start,
    range_end,
    expected_initial_jobs, channels, credential_ids
  ) values (
    v_request_key,
    v_owner_id,
    v_actor,
    p_history_days,
    v_range_start,
    v_range_end,
    v_expected, v_channels, v_credentials
  ) returning id into v_run_id;

  if 'coupang' = any(v_channels) then
  v_slice_start := v_range_start;
  while v_slice_start <= v_range_end loop
    v_slice_end := least(v_slice_start + 6, v_range_end);
    perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
      v_run_id,
      'coupang',
      format('product:%s:%s', v_slice_start, v_slice_end),
      jsonb_build_object(
        'kind', 'product',
        'query', jsonb_build_object(
          'inquiryStartAt', v_slice_start::text,
          'inquiryEndAt', v_slice_end::text,
          'answeredType', 'ALL',
          'pageNum', 1,
          'pageSize', 50
        )
      )
    );
    foreach v_partner_status in array
      array['NONE', 'ANSWER', 'NO_ANSWER', 'TRANSFER']
    loop
      perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
        v_run_id,
        'coupang',
        format(
          'call-center:%s:%s:%s',
          lower(v_partner_status),
          v_slice_start,
          v_slice_end
        ),
        jsonb_build_object(
          'kind', 'call-center',
          'query', jsonb_build_object(
            'inquiryStartAt', v_slice_start::text,
            'inquiryEndAt', v_slice_end::text,
            'partnerCounselingStatus', v_partner_status,
            'pageNum', 1,
            'pageSize', 30
          )
        )
      );
    end loop;
    v_slice_start := v_slice_start + 7;
  end loop;
  end if;

  if 'smartstore' = any(v_channels) then
  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,
    'smartstore',
    format('product:%s:%s', v_range_start, v_range_end),
    jsonb_build_object(
      'kind', 'product',
      'query', jsonb_build_object(
        'fromDate', format('%sT00:00:00.000+09:00', v_range_start),
        'toDate', to_char(
          v_now at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'page', 1,
        'size', 100
      )
    )
  );
  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,
    'smartstore',
    format('customer:%s:%s', v_range_start, v_range_end),
    jsonb_build_object(
      'kind', 'customer',
      'query', jsonb_build_object(
        'startSearchDate', v_range_start::text,
        'endSearchDate', v_range_end::text,
        'page', 1,
        'size', 200
      )
    )
  );

  end if;
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}' = v_run_id::text
       and (job.credential_id::text is distinct from v_credentials->>job.channel)
  ) then
    raise exception 'inquiry history credential changed during enqueue' using errcode = '55000';
  end if;
  v_result := sellerpilot_private.refresh_inquiry_history_backfill_run(
    v_run_id
  );
  if coalesce((v_result->>'totalJobs')::integer, 0) <> v_expected then
    raise exception 'inquiry history backfill initial enqueue count mismatch';
  end if;
  return v_result || jsonb_build_object(
    'reused', false,
    'retriedJobs', 0
  );
end;
$$;

revoke all on function public.sellerpilot_start_inquiry_history_backfill_v2(text[], integer)
  from public, anon, service_role;
grant execute on function public.sellerpilot_start_inquiry_history_backfill_v2(text[], integer)
  to authenticated;

-- Older clients retain their explicit two-channel request and both gates.
create or replace function public.sellerpilot_start_inquiry_history_backfill(p_history_days integer default 30)
returns jsonb language sql security definer set search_path = '' as $$
  select public.sellerpilot_start_inquiry_history_backfill_v2(array['coupang', 'smartstore']::text[], p_history_days)
$$;
revoke all on function public.sellerpilot_start_inquiry_history_backfill(integer) from public, anon, service_role;
grant execute on function public.sellerpilot_start_inquiry_history_backfill(integer) to authenticated;
notify pgrst, 'reload schema';
commit;
