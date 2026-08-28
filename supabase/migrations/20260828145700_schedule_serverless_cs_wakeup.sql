-- Wake the bounded Vercel CS drain from Supabase Cron without placing bearer
-- material in cron.job.command or database logs. The job is installed paused;
-- a service-role canary explicitly activates it after the route succeeds.

begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The Authorization header necessarily exists in pg_net's transient internal
-- request queue until dispatch. Keep both extension schemas inaccessible to
-- every API-facing role; only postgres-owned SECURITY DEFINER functions below
-- may enqueue a wake or alter the named schedule.
revoke all on schema net from public, anon, authenticated, service_role;
revoke all on all tables in schema net
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema net
  from public, anon, authenticated, service_role;
revoke all on all functions in schema net
  from public, anon, authenticated, service_role;
revoke all on schema cron from public, anon, authenticated, service_role;
revoke all on all tables in schema cron
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema cron
  from public, anon, authenticated, service_role;
revoke all on all functions in schema cron
  from public, anon, authenticated, service_role;

create table if not exists sellerpilot_private.serverless_cs_wake_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text not null default 'queued' check (
    outcome in (
      'queued', 'delivered', 'retryable_failure', 'permanent_failure',
      'permanent_failure_acknowledged'
    )
  ),
  http_status integer check (http_status is null or http_status between 100 and 599),
  timed_out boolean not null default false,
  safe_error_code text check (
    safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'
  )
);

create index if not exists serverless_cs_wake_requests_recent_idx
  on sellerpilot_private.serverless_cs_wake_requests (requested_at desc);

alter table sellerpilot_private.serverless_cs_wake_requests
  enable row level security;
revoke all on sellerpilot_private.serverless_cs_wake_requests
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.reconcile_serverless_cs_wakeups()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivered integer := 0;
  v_retryable integer := 0;
  v_permanent integer := 0;
  v_stale integer := 0;
begin
  with resolved as (
    update sellerpilot_private.serverless_cs_wake_requests wake
       set outcome = case
             when response.status_code between 200 and 299
               then 'delivered'
             when response.timed_out
               or response.error_msg is not null
               or response.status_code is null
               or response.status_code >= 500
               then 'retryable_failure'
             else 'permanent_failure'
           end,
           http_status = response.status_code,
           timed_out = coalesce(response.timed_out, false),
           safe_error_code = case
             when response.status_code between 200 and 299 then null
             when response.timed_out then 'network_timeout'
             when response.error_msg is not null then 'network_transport_error'
             when response.status_code is null then 'network_response_missing'
             when response.status_code >= 500 then 'upstream_5xx'
             when response.status_code in (401, 403) then 'wake_auth_rejected'
             when response.status_code = 404 then 'wake_route_not_found'
             when response.status_code = 429 then 'wake_rate_limited'
             else 'upstream_non_retryable'
           end,
           resolved_at = clock_timestamp()
      from net._http_response response
     where wake.request_id = response.id
       and wake.outcome = 'queued'
    returning wake.request_id, wake.outcome
  ), deleted_responses as (
    delete from net._http_response response
     using resolved
     where response.id = resolved.request_id
    returning response.id
  )
  select
    count(*) filter (where resolved.outcome = 'delivered')::integer,
    count(*) filter (where resolved.outcome = 'retryable_failure')::integer,
    count(*) filter (where resolved.outcome = 'permanent_failure')::integer
    into v_delivered, v_retryable, v_permanent
    from resolved;

  with stale as (
    update sellerpilot_private.serverless_cs_wake_requests wake
       set outcome = 'retryable_failure',
           timed_out = true,
           safe_error_code = 'network_response_expired',
           resolved_at = clock_timestamp()
     where wake.outcome = 'queued'
       and wake.requested_at < clock_timestamp() - interval '6 minutes'
    returning wake.request_id
  )
  select count(*)::integer into v_stale from stale;

  return jsonb_build_object(
    'delivered', coalesce(v_delivered, 0),
    'retryableFailures', coalesce(v_retryable, 0) + coalesce(v_stale, 0),
    'permanentFailures', coalesce(v_permanent, 0)
  );
end;
$$;

create or replace function sellerpilot_private.schedule_serverless_cs_wakeup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wake_secret text;
  v_request_id bigint;
  v_latest_outcome text;
  v_cron_job_id bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);
  perform sellerpilot_private.reconcile_serverless_cs_wakeups();

  delete from sellerpilot_private.serverless_cs_wake_requests wake
   where wake.outcome <> 'queued'
     and wake.requested_at < clock_timestamp() - interval '30 days';

  select job.jobid
    into v_cron_job_id
    from cron.job job
   where job.jobname = 'sellerpilot-serverless-cs-wake-v1'
   limit 1;
  if v_cron_job_id is not null then
    delete from cron.job_run_details run
     where run.jobid = v_cron_job_id
       and run.end_time < clock_timestamp() - interval '7 days';
  end if;

  if exists (
    select 1
      from sellerpilot_private.serverless_cs_wake_requests wake
     where wake.outcome = 'queued'
  ) then
    return null;
  end if;

  select wake.outcome
    into v_latest_outcome
    from sellerpilot_private.serverless_cs_wake_requests wake
   order by wake.requested_at desc, wake.request_id desc
   limit 1;

  -- A 4xx is a configuration/canary failure, not a retryable delivery. Pause
  -- the named schedule after the first permanent response; only an explicit
  -- service-role canary may reactivate it.
  if v_latest_outcome = 'permanent_failure' then
    if v_cron_job_id is not null then
      perform cron.alter_job(job_id := v_cron_job_id, active := false);
    end if;
    return null;
  end if;

  select decrypted.decrypted_secret
    into v_wake_secret
    from vault.secrets secret
    join vault.decrypted_secrets decrypted on decrypted.id = secret.id
   where secret.name = 'sellerpilot_serverless_cs_wake_v1'
   order by secret.created_at desc, secret.id
   limit 1;
  if coalesce(v_wake_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    if v_cron_job_id is not null then
      perform cron.alter_job(job_id := v_cron_job_id, active := false);
    end if;
    -- Do not raise after pausing: an exception would roll back the cron state
    -- change and cause the same missing-secret failure every minute.
    raise warning 'serverless CS wake secret unavailable; scheduler paused';
    return null;
  end if;

  select net.http_post(
    url := 'https://sellerpilot-global.vercel.app/api/internal/channel-gateway-drain',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_wake_secret,
      'Content-Type', 'application/json',
      'User-Agent', 'SellerPilot-Supabase-Cron/1',
      'X-SellerPilot-Wake-Version', 'serverless_cs_v1'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  ) into v_request_id;

  insert into sellerpilot_private.serverless_cs_wake_requests (
    request_id, requested_at
  ) values (
    v_request_id, clock_timestamp()
  );

  return v_request_id;
end;
$$;

create or replace function public.sellerpilot_service_set_serverless_cs_wakeup_active(
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
begin
  if p_active is null then
    raise exception 'wake scheduler state required';
  end if;

  select job.jobid
    into v_job_id
    from cron.job job
   where job.jobname = 'sellerpilot-serverless-cs-wake-v1'
   limit 1;
  if v_job_id is null then
    raise exception 'serverless CS wake scheduler is not installed'
      using errcode = '55000';
  end if;

  if p_active then
    -- Activation is the explicit external-canary acknowledgement. Preserve
    -- the failed delivery as history while allowing exactly the next cron run
    -- to test the corrected configuration.
    update sellerpilot_private.serverless_cs_wake_requests wake
       set outcome = 'permanent_failure_acknowledged'
     where wake.request_id = (
       select latest.request_id
         from sellerpilot_private.serverless_cs_wake_requests latest
        where latest.outcome = 'permanent_failure'
        order by latest.requested_at desc, latest.request_id desc
        limit 1
     );
  end if;

  perform cron.alter_job(job_id := v_job_id, active := p_active);
  return jsonb_build_object(
    'configured', true,
    'version', 'serverless_cs_v1',
    'active', p_active
  );
end;
$$;

create or replace function public.sellerpilot_service_serverless_cs_wakeup_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configured', job.jobid is not null,
    'version', 'serverless_cs_v1',
    'active', coalesce(job.active, false),
    'lastWake', case
      when wake.request_id is null then null
      else jsonb_build_object(
        'requestedAt', wake.requested_at,
        'resolvedAt', wake.resolved_at,
        'outcome', wake.outcome,
        'httpStatus', wake.http_status,
        'timedOut', wake.timed_out,
        'safeErrorCode', wake.safe_error_code
      )
    end
  )
  from (values (true)) singleton(present)
  left join lateral (
    select scheduled.jobid, scheduled.active
      from cron.job scheduled
     where scheduled.jobname = 'sellerpilot-serverless-cs-wake-v1'
     limit 1
  ) job on true
  left join lateral (
    select request.request_id, request.requested_at, request.resolved_at,
           request.outcome, request.http_status, request.timed_out,
           request.safe_error_code
      from sellerpilot_private.serverless_cs_wake_requests request
     order by request.requested_at desc, request.request_id desc
     limit 1
  ) wake on true
$$;

revoke all on function sellerpilot_private.reconcile_serverless_cs_wakeups()
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.schedule_serverless_cs_wakeup()
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_set_serverless_cs_wakeup_active(boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_set_serverless_cs_wakeup_active(boolean)
  to service_role;

revoke all on function public.sellerpilot_service_serverless_cs_wakeup_status()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_serverless_cs_wakeup_status()
  to service_role;

-- cron.schedule is an upsert by job name. Store only a fixed function call in
-- cron.job.command; the bearer is decrypted inside the function at run time.
select cron.schedule(
  'sellerpilot-serverless-cs-wake-v1',
  '* * * * *',
  'select sellerpilot_private.schedule_serverless_cs_wakeup();'
);

select cron.alter_job(
  job_id := job.jobid,
  active := false
)
from cron.job job
where job.jobname = 'sellerpilot-serverless-cs-wake-v1';

comment on table sellerpilot_private.serverless_cs_wake_requests is
  'Secret-free pg_net delivery ledger; response bodies, headers, and transport messages are never copied.';
comment on function sellerpilot_private.schedule_serverless_cs_wakeup() is
  'Posts one non-overlapping bounded wake to the fixed production Vercel route using a Vault bearer.';

commit;
