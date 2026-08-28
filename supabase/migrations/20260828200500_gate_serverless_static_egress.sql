-- Coupang and Smartstore require an explicitly approved stable outbound IP.
-- Keep them out of the Vercel serverless claim path until both the database
-- policy and the request-scoped runtime attestation are present. Qoo10/eBay
-- remain available to the bounded serverless CS worker.

begin;

create table sellerpilot_private.serverless_static_egress_policy (
  channel text primary key check (channel in ('coupang', 'smartstore')),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.serverless_static_egress_policy
  enable row level security;
revoke all on sellerpilot_private.serverless_static_egress_policy
  from public, anon, authenticated, service_role;

insert into sellerpilot_private.serverless_static_egress_policy (channel, enabled)
values ('coupang', false), ('smartstore', false)
on conflict (channel) do nothing;

create function sellerpilot_private.serverless_static_egress_allowed(
  p_channel text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_channel in ('coupang', 'smartstore')
    and exists (
      select 1
        from sellerpilot_private.serverless_static_egress_policy policy
       where policy.channel = p_channel
         and policy.enabled
    )
    and p_channel = any (
      regexp_split_to_array(
        coalesce(
          nullif(
            coalesce(
              nullif(current_setting('request.headers', true), ''),
              '{}'
            )::jsonb ->> 'x-sellerpilot-static-egress-channels',
            ''
          ),
          ''
        ),
        '\s*,\s*'
      )
    ),
    false
  );
$$;

revoke all on function
  sellerpilot_private.serverless_static_egress_allowed(text)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_serverless_static_egress_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'coupang', coalesce(bool_or(policy.enabled) filter (where policy.channel = 'coupang'), false),
    'smartstore', coalesce(bool_or(policy.enabled) filter (where policy.channel = 'smartstore'), false)
  )
  from sellerpilot_private.serverless_static_egress_policy policy;
$$;

revoke all on function
  public.sellerpilot_service_serverless_static_egress_status()
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_serverless_static_egress_status()
  to service_role;

-- Stop minute-by-minute queue creation before the provider boundary. The
-- status is intentionally distinct from a credential or provider failure.
alter function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) rename to sellerpilot_20260828_enqueue_periodic_sync_before_static_egress_gate;

create function public.sellerpilot_service_enqueue_periodic_sync(
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel in ('coupang', 'smartstore')
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
          and policy.enabled
     ) then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', 'fixed_egress_required',
      'blockedReason', 'STATIC_EGRESS_REQUIRED'
    );
  end if;
  return public.sellerpilot_20260828_enqueue_periodic_sync_before_static_egress_gate(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$$;

revoke all on function
  public.sellerpilot_20260828_enqueue_periodic_sync_before_static_egress_gate(
    text, text, jsonb, integer
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_enqueue_periodic_sync(text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_periodic_sync(text, text, jsonb, integer)
  to service_role;

-- A Korean-channel reply must never be accepted into a queue that no eligible
-- worker can drain. The API also checks its runtime configuration, while this
-- database fence prevents direct service-role callers from creating a
-- misleading forever-queued reply when the rollout policy is still disabled.
alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) rename to sellerpilot_20260828_enqueue_reply_before_static_gate;

create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  p_ticket_id uuid,
  p_channel text,
  p_reply_text text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel in ('coupang', 'smartstore')
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
          and policy.enabled
     ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;

  return public.sellerpilot_20260828_enqueue_reply_before_static_gate(
    p_ticket_id,
    p_channel,
    p_reply_text,
    p_request_payload
  );
end;
$$;

revoke all on function
  public.sellerpilot_20260828_enqueue_reply_before_static_gate(
    uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_enqueue_inquiry_reply_gateway_job(
    uuid, text, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_enqueue_inquiry_reply_gateway_job(
    uuid, text, text, jsonb
  ) to service_role;

-- Patch only the queued selector of the current dedicated claimant. Existing
-- live claims retain their completion fence and can settle normally.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old constant text := $old$where job.status = 'queued'
     and job.channel in ('ebay', 'coupang', 'smartstore', 'qoo10')
     and job.operation in ('inquiries.list', 'inquiries.reply')$old$;
  v_new constant text := $new$where job.status = 'queued'
     and (
       job.channel in ('ebay', 'qoo10')
       or (
         job.channel in ('coupang', 'smartstore')
         and sellerpilot_private.serverless_static_egress_allowed(job.channel)
       )
     )
     and job.operation in ('inquiries.list', 'inquiries.reply')$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_cs_job(text,text)'::regprocedure
  ) into v_definition;
  if (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old) <> 1 then
    raise exception 'expected one serverless CS queued selector';
  end if;
  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition
     or position(v_old in v_rewritten) > 0
     or position('serverless_static_egress_allowed(job.channel)' in v_rewritten) = 0 then
    raise exception 'serverless static egress claim gate rewrite failed';
  end if;
  execute v_rewritten;
end;
$migration$;

-- The generic/local gateway claimant must never become an implicit fallback
-- for Korean CS when the dedicated token expires or is revoked. Coupang and
-- Smartstore CS jobs stay exclusively on the attested serverless path;
-- Qoo10/eBay keep the previous active-token handoff behavior.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old constant text := $old$and not (
       j.channel in ('qoo10', 'ebay', 'coupang', 'smartstore')
       and j.operation in ('inquiries.list', 'inquiries.reply')
       and exists (
         select 1
           from sellerpilot_private.ai_cli_worker_tokens serverless_token
          where serverless_token.scope = 'serverless_cs'
            and serverless_token.status = 'active'
       )
     )$old$;
  v_new constant text := $new$and not (
       (
         j.channel in ('coupang', 'smartstore')
         and j.operation in ('inquiries.list', 'inquiries.reply')
       )
       or (
         j.channel in ('qoo10', 'ebay')
         and j.operation in ('inquiries.list', 'inquiries.reply')
         and exists (
           select 1
             from sellerpilot_private.ai_cli_worker_tokens serverless_token
            where serverless_token.scope = 'serverless_cs'
              and serverless_token.status = 'active'
         )
       )
     )$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old) <> 1 then
    raise exception 'expected one generic CS claimant handoff guard';
  end if;
  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition
     or position(v_old in v_rewritten) > 0
     or position('j.channel in (''coupang'', ''smartstore'')' in v_rewritten) = 0 then
    raise exception 'generic Korean CS fallback exclusion rewrite failed';
  end if;
  execute v_rewritten;
end;
$migration$;

-- Preserve the truthful blocked state for the one active Korean history run.
alter table sellerpilot_private.inquiry_history_backfill_runs
  add column blocked_reason text
  check (blocked_reason is null or blocked_reason = 'STATIC_EGRESS_REQUIRED');

alter table sellerpilot_private.inquiry_history_backfill_runs
  drop constraint inquiry_history_backfill_runs_status_check;
alter table sellerpilot_private.inquiry_history_backfill_runs
  add constraint inquiry_history_backfill_runs_status_check
  check (status in ('queued', 'running', 'succeeded', 'failed', 'blocked'));

do $migration$
declare
  v_constraint text;
begin
  select constraint_row.conname
    into v_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'sellerpilot_private.inquiry_history_backfill_runs'::regclass
     and constraint_row.contype = 'c'
     and pg_catalog.pg_get_constraintdef(constraint_row.oid)
         like '%completed_at%status%'
   limit 1;
  if v_constraint is null then
    select constraint_row.conname
      into v_constraint
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'sellerpilot_private.inquiry_history_backfill_runs'::regclass
       and constraint_row.contype = 'c'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid)
           like '%completed_at%';
  end if;
  if v_constraint is null then
    raise exception 'history completion constraint not found';
  end if;
  execute format(
    'alter table sellerpilot_private.inquiry_history_backfill_runs drop constraint %I',
    v_constraint
  );
end;
$migration$;

alter table sellerpilot_private.inquiry_history_backfill_runs
  add constraint inquiry_history_backfill_runs_completion_check check (
    (status in ('queued', 'running') and completed_at is null)
    or (status in ('succeeded', 'failed', 'blocked') and completed_at is not null)
  );

alter function sellerpilot_private.refresh_inquiry_history_backfill_run(uuid)
  rename to refresh_inquiry_history_backfill_run_before_static_egress_gate;

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
    'channels', jsonb_build_array('coupang', 'smartstore'),
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

revoke all on function
  sellerpilot_private.refresh_inquiry_history_backfill_run_before_static_egress_gate(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.refresh_inquiry_history_backfill_run(uuid)
  from public, anon, authenticated, service_role;

-- Mark only the queued read jobs belonging to an explicit Korean history run.
-- Product, order, reply, and provider data are outside this update.
update sellerpilot_private.inquiry_history_backfill_runs run
   set status = 'blocked',
       blocked_reason = 'STATIC_EGRESS_REQUIRED',
       queued_jobs = 0,
       running_jobs = 0,
       failed_jobs = 0,
       completed_at = coalesce(run.completed_at, clock_timestamp()),
       updated_at = clock_timestamp()
 where run.status in ('queued', 'running')
   and exists (
     select 1
       from sellerpilot_private.channel_gateway_jobs job
      where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}'
            = run.id::text
        and job.channel in ('coupang', 'smartstore')
        and job.operation = 'inquiries.list'
        and job.status = 'queued'
   );

update sellerpilot_private.channel_gateway_jobs job
   set status = 'failed',
       error_message = 'STATIC_EGRESS_REQUIRED',
       worker_token_id = null,
       claim_token = null,
       lease_expires_at = null,
       completed_at = clock_timestamp(),
       updated_at = clock_timestamp()
 where job.channel in ('coupang', 'smartstore')
   and job.operation = 'inquiries.list'
   and job.status = 'queued'
   and exists (
     select 1
       from sellerpilot_private.inquiry_history_backfill_runs run
      where run.id::text = (
              job.request_payload #>> '{arguments,sellerpilotHistoryRunId}'
            )
        and run.status = 'blocked'
        and run.history_days = 30
        and run.blocked_reason = 'STATIC_EGRESS_REQUIRED'
   );

alter function public.sellerpilot_start_inquiry_history_backfill(integer)
  rename to sellerpilot_20260828_start_history_before_static_egress_gate;

create function public.sellerpilot_start_inquiry_history_backfill(
  p_history_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'coupang' and policy.enabled
  ) or not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'smartstore' and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;

  -- An explicit administrator retry after both DB gates are enabled may
  -- resume only today's matching blocked run through the original safe retry
  -- path. No automatic wakeup performs this transition.
  update sellerpilot_private.inquiry_history_backfill_runs run
     set status = 'failed',
         blocked_reason = null,
         failed_jobs = (
           select count(*)::integer
             from sellerpilot_private.channel_gateway_jobs job
            where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}'
                  = run.id::text
              and job.status = 'failed'
         ),
         completed_at = coalesce(run.completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where run.status = 'blocked'
     and run.history_days = p_history_days
     and run.range_end = (clock_timestamp() at time zone 'Asia/Seoul')::date;

  return public.sellerpilot_20260828_start_history_before_static_egress_gate(
    p_history_days
  );
end;
$$;

revoke all on function
  public.sellerpilot_20260828_start_history_before_static_egress_gate(integer)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_start_inquiry_history_backfill(integer)
  from public, anon, service_role;
grant execute on function
  public.sellerpilot_start_inquiry_history_backfill(integer)
  to authenticated;

comment on table sellerpilot_private.serverless_static_egress_policy is
  'Fail-closed DB gate for serverless channels that require a stable provider-allowlisted outbound IP.';
comment on function public.sellerpilot_service_serverless_static_egress_status() is
  'Returns only boolean static-egress readiness; no provider credential or payload data.';

commit;
