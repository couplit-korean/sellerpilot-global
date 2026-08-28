-- Track the bounded Korean inquiry history refresh as one durable run. The
-- ledger stores only run scope and counters; customer names, messages, order
-- references, and provider response bodies remain in their existing ledgers.

begin;

create table sellerpilot_private.inquiry_history_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique
    check (request_key ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  initiated_by uuid references auth.users(id) on delete set null,
  history_days integer not null check (history_days between 7 and 30),
  range_start date not null,
  range_end date not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  expected_initial_jobs integer not null check (expected_initial_jobs > 0),
  total_jobs integer not null default 0 check (total_jobs >= 0),
  queued_jobs integer not null default 0 check (queued_jobs >= 0),
  running_jobs integer not null default 0 check (running_jobs >= 0),
  succeeded_jobs integer not null default 0 check (succeeded_jobs >= 0),
  failed_jobs integer not null default 0 check (failed_jobs >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (range_end >= range_start),
  check (range_end - range_start = history_days - 1),
  check (total_jobs >= queued_jobs + running_jobs + succeeded_jobs + failed_jobs),
  check (
    (status in ('queued', 'running') and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

alter table sellerpilot_private.inquiry_history_backfill_runs
  enable row level security;
revoke all on sellerpilot_private.inquiry_history_backfill_runs
  from public, anon, authenticated, service_role;

create index inquiry_history_backfill_runs_owner_created_idx
  on sellerpilot_private.inquiry_history_backfill_runs (
    owner_id, created_at desc, id desc
  );
create index inquiry_history_backfill_runs_active_idx
  on sellerpilot_private.inquiry_history_backfill_runs (
    updated_at, id
  )
  where status in ('queued', 'running');

create index channel_gateway_jobs_history_run_status_idx
  on sellerpilot_private.channel_gateway_jobs (
    ((request_payload #>> '{arguments,sellerpilotHistoryRunId}')::text),
    status,
    created_at,
    id
  )
  where nullif(
    request_payload #>> '{arguments,sellerpilotHistoryRunId}', ''
  ) is not null;

create unique index channel_gateway_jobs_history_initial_item_idx
  on sellerpilot_private.channel_gateway_jobs (
    ((request_payload #>> '{arguments,sellerpilotHistoryRunId}')::text),
    channel,
    ((request_payload #>> '{arguments,sellerpilotHistoryItemKey}')::text)
  )
  where nullif(
      request_payload #>> '{arguments,sellerpilotHistoryRunId}', ''
    ) is not null
    and nullif(
      request_payload #>> '{arguments,sellerpilotHistoryItemKey}', ''
    ) is not null
    and nullif(request_payload->>'continuationOf', '') is null;

create function sellerpilot_private.refresh_inquiry_history_backfill_run(
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
    'channels', jsonb_build_array('coupang', 'smartstore'),
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

revoke all on function
  sellerpilot_private.refresh_inquiry_history_backfill_run(uuid)
  from public, anon, authenticated, service_role;

-- Pagination continuations are created inside the atomic completion function.
-- Inherit only the two non-PII run tags from the parent, even if a provider or
-- worker omits them from nextArguments. Every continuation is then included in
-- the same aggregate before the parent completion transaction commits.
create function sellerpilot_private.inherit_inquiry_history_backfill_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_id_text text;
  v_run_id_text text;
  v_item_key text;
begin
  v_parent_id_text := nullif(new.request_payload->>'continuationOf', '');
  if v_parent_id_text is null
     or v_parent_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  select parent.request_payload #>> '{arguments,sellerpilotHistoryRunId}',
         parent.request_payload #>> '{arguments,sellerpilotHistoryItemKey}'
    into v_run_id_text, v_item_key
    from sellerpilot_private.channel_gateway_jobs parent
   where parent.id = v_parent_id_text::uuid
     and parent.created_by = new.created_by;

  if v_run_id_text is null
     or v_run_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_item_key is null
     or v_item_key !~ '^[a-z0-9:_-]{1,160}$'
     or not exists (
       select 1
         from sellerpilot_private.inquiry_history_backfill_runs run
        where run.id = v_run_id_text::uuid
          and run.owner_id = new.created_by
     ) then
    return new;
  end if;

  new.request_payload := jsonb_set(
    jsonb_set(
      new.request_payload,
      '{arguments,sellerpilotHistoryRunId}',
      to_jsonb(v_run_id_text),
      true
    ),
    '{arguments,sellerpilotHistoryItemKey}',
    to_jsonb(v_item_key),
    true
  );
  return new;
end;
$$;

create trigger inherit_inquiry_history_backfill_tags
before insert on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.inherit_inquiry_history_backfill_tags();

revoke all on function
  sellerpilot_private.inherit_inquiry_history_backfill_tags()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.refresh_inquiry_history_backfill_from_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id_text text;
begin
  v_run_id_text := new.request_payload
    #>> '{arguments,sellerpilotHistoryRunId}';
  if v_run_id_text is not null
     and v_run_id_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    perform sellerpilot_private.refresh_inquiry_history_backfill_run(
      v_run_id_text::uuid
    );
  end if;
  return new;
end;
$$;

create trigger refresh_inquiry_history_backfill_from_job
after insert or update of status
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.refresh_inquiry_history_backfill_from_job();

revoke all on function
  sellerpilot_private.refresh_inquiry_history_backfill_from_job()
  from public, anon, authenticated, service_role;

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
  v_result jsonb;
  v_job_id uuid;
begin
  if p_channel not in ('coupang', 'smartstore')
     or p_item_key !~ '^[a-z0-9:_-]{1,160}$'
     or jsonb_typeof(p_arguments) <> 'object'
     or not exists (
       select 1
         from sellerpilot_private.inquiry_history_backfill_runs run
        where run.id = p_run_id
     ) then
    raise exception 'invalid inquiry history backfill item';
  end if;

  v_result := public.sellerpilot_service_enqueue_periodic_sync(
    p_channel,
    'inquiries.list',
    jsonb_build_object(
      'periodicKey', format(
        'inquiries:history:%s:%s:%s',
        p_run_id,
        p_channel,
        p_item_key
      ),
      'arguments', p_arguments || jsonb_build_object(
        'sellerpilotHistoryRunId', p_run_id::text,
        'sellerpilotHistoryItemKey', p_item_key
      )
    ),
    60
  );
  if v_result->>'status' is distinct from 'queued'
     or coalesce(v_result->>'jobId', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'inquiry history backfill enqueue refused for %:%',
      p_channel, p_item_key;
  end if;
  v_job_id := (v_result->>'jobId')::uuid;
  return v_job_id;
end;
$$;

revoke all on function
  sellerpilot_private.enqueue_inquiry_history_backfill_item(
    uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_start_inquiry_history_backfill(
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
  v_coupang_owner_id uuid;
  v_smartstore_owner_id uuid;
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

  -- Lock both exact active credentials. This prevents a concurrent rotation
  -- from making the 27 atomic enqueue calls switch accounts mid-run.
  select credential.created_by
    into v_coupang_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'coupang'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > v_now
     )
   order by credential.version desc
   limit 1
   for update;

  select credential.created_by
    into v_smartstore_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'smartstore'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > v_now
     )
   order by credential.version desc
   limit 1
   for update;

  if v_coupang_owner_id is null or v_smartstore_owner_id is null then
    raise exception 'both Korean marketplace credentials must be active'
      using errcode = '55000';
  end if;
  if v_coupang_owner_id is distinct from v_smartstore_owner_id then
    raise exception 'Korean marketplace credential owners do not match'
      using errcode = '55000';
  end if;
  v_owner_id := v_coupang_owner_id;

  v_range_end := (v_now at time zone 'Asia/Seoul')::date;
  v_range_start := v_range_end - (p_history_days - 1);
  v_expected := ceil(p_history_days / 7.0)::integer * 5 + 2;
  v_request_key := encode(
    extensions.digest(
      concat_ws(
        '|',
        'korean-inquiry-history-v1',
        v_owner_id::text,
        v_range_start::text,
        v_range_end::text,
        p_history_days::text,
        'coupang,smartstore'
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
    expected_initial_jobs
  ) values (
    v_request_key,
    v_owner_id,
    v_actor,
    p_history_days,
    v_range_start,
    v_range_end,
    v_expected
  ) returning id into v_run_id;

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

revoke all on function
  public.sellerpilot_start_inquiry_history_backfill(integer)
  from public, anon, service_role;
grant execute on function
  public.sellerpilot_start_inquiry_history_backfill(integer)
  to authenticated;

create function public.sellerpilot_get_inquiry_history_backfill(
  p_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run_id uuid;
begin
  if v_actor is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  if p_run_id is not null then
    select run.id into v_run_id
      from sellerpilot_private.inquiry_history_backfill_runs run
     where run.id = p_run_id;
  else
    select run.id into v_run_id
      from sellerpilot_private.inquiry_history_backfill_runs run
     order by run.created_at desc, run.id desc
     limit 1;
  end if;
  if v_run_id is null then
    return null;
  end if;
  return sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
end;
$$;

revoke all on function
  public.sellerpilot_get_inquiry_history_backfill(uuid)
  from public, anon, service_role;
grant execute on function
  public.sellerpilot_get_inquiry_history_backfill(uuid)
  to authenticated;

-- The dedicated Vercel claimant handles customer replies before current
-- reads, and current reads before the bounded history backlog. Only the ORDER
-- BY clause is replaced, leaving the three exact channel guards intact for the
-- following Qoo10 extension migration.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old constant text := 'order by job.created_at, job.id';
  v_new constant text := $order$
order by
     case
       when job.operation = 'inquiries.reply' then 0
       when coalesce(job.request_payload->>'periodicKey', '') like 'inquiries:history:%'
         or nullif(job.request_payload #>> '{arguments,sellerpilotHistoryRunId}', '') is not null
         then 2
       else 1
     end,
     job.created_at,
     job.id$order$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_cs_job(text,text)'::regprocedure
  ) into v_definition;
  if (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old) <> 1 then
    raise exception 'expected one serverless CS claim ordering clause';
  end if;
  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition or position(v_old in v_rewritten) > 0 then
    raise exception 'serverless CS claim ordering rewrite failed';
  end if;
  execute v_rewritten;
end;
$migration$;

-- Preserve the generic gateway claimant's credential and prepared-attempt
-- safety ordering. Within that fence, replies precede current reads and the
-- bounded history backlog is last. This modifies the original unsafe body
-- that all later wrappers still delegate to.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_order_old constant text :=
    'case when j.attempt_id is null then 1 else 0 end,';
  v_order_new constant text := $order$case when j.attempt_id is null then 1 else 0 end,
     case
       when j.operation = 'inquiries.reply' then 0
       when coalesce(j.request_payload->>'periodicKey', '') like 'inquiries:history:%'
         or nullif(j.request_payload #>> '{arguments,sellerpilotHistoryRunId}', '') is not null
         then 2
       else 1
     end,$order$;
  v_where_old constant text := $where$where j.status = 'queued'
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running$where$;
  v_where_new constant text := $where$where j.status = 'queued'
     and not (
       j.channel in ('qoo10', 'ebay', 'coupang', 'smartstore')
       and j.operation in ('inquiries.list', 'inquiries.reply')
       and exists (
         select 1
           from sellerpilot_private.ai_cli_worker_tokens serverless_token
          where serverless_token.scope = 'serverless_cs'
            and serverless_token.status = 'active'
       )
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running$where$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if (
    length(v_definition) - length(replace(v_definition, v_order_old, ''))
  ) / length(v_order_old) <> 1 then
    raise exception 'expected one generic gateway claim ordering clause';
  end if;
  if (
    length(v_definition) - length(replace(v_definition, v_where_old, ''))
  ) / length(v_where_old) <> 1 then
    raise exception 'expected one generic gateway queued selection clause';
  end if;
  v_rewritten := replace(v_definition, v_order_old, v_order_new);
  v_rewritten := replace(v_rewritten, v_where_old, v_where_new);
  if v_rewritten = v_definition
     or position(v_where_old in v_rewritten) > 0
     or position('sellerpilotHistoryRunId' in v_rewritten) = 0
     or position('serverless_token.scope = ''serverless_cs''' in v_rewritten) = 0 then
    raise exception 'generic gateway claim selection rewrite failed';
  end if;
  execute v_rewritten;
end;
$migration$;

commit;
