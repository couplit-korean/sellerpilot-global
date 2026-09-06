-- Follow-up to 20260828210000. Do not rewrite that applied history.
-- Live schedule_serverless_cs_wakeup() still inserts request_id from
-- net.http_post as the PK and keeps non-queued receipts for 30 days.
-- pg_net reuses those ids (live 1345/1347/1348 are Aug 29 delivered rows),
-- so unique_violation 23505 rolls back the whole cron tick and blocks wakes.
-- After a new http_post, archive only a resolved collided receipt and reset
-- the live PK row for the new request. A still-queued collision stays
-- fail-closed. This migration does not claim or mutate marketplace jobs.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500140);

create table if not exists sellerpilot_private.serverless_cs_wake_request_archives (
  archive_id bigint generated always as identity primary key,
  archived_at timestamptz not null default clock_timestamp(),
  archive_reason text not null check (
    archive_reason = 'pg_net_request_id_reused'
  ),
  request_id bigint not null,
  requested_at timestamptz not null,
  resolved_at timestamptz,
  outcome text not null,
  http_status integer,
  timed_out boolean not null,
  safe_error_code text
);

create index if not exists serverless_cs_wake_request_archives_request_idx
  on sellerpilot_private.serverless_cs_wake_request_archives (
    request_id, archived_at desc
  );

alter table sellerpilot_private.serverless_cs_wake_request_archives
  enable row level security;
revoke all on sellerpilot_private.serverless_cs_wake_request_archives
  from public, anon, authenticated, service_role;

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
  v_latest_error text;
  v_latest_requested_at timestamptz;
  v_retry_after interval;
  v_cron_job_id bigint;
  v_archived integer;
  v_reset integer;
  v_requested_at timestamptz;
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
    select 1 from sellerpilot_private.serverless_cs_wake_requests wake
     where wake.outcome = 'queued'
  ) then
    return null;
  end if;

  select wake.outcome, wake.safe_error_code, wake.requested_at
    into v_latest_outcome, v_latest_error, v_latest_requested_at
    from sellerpilot_private.serverless_cs_wake_requests wake
   order by wake.requested_at desc, wake.request_id desc
   limit 1;

  if v_latest_outcome = 'permanent_failure' then
    if v_cron_job_id is not null then
      perform cron.alter_job(job_id := v_cron_job_id, active := false);
    end if;
    return null;
  end if;
  if v_latest_outcome = 'retryable_failure' then
    v_retry_after := case
      when v_latest_error = 'wake_rate_limited' then interval '5 minutes'
      else interval '1 minute'
    end;
    if v_latest_requested_at > clock_timestamp() - v_retry_after then
      return null;
    end if;
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
    raise warning 'serverless CS wake secret unavailable; scheduler paused';
    return null;
  end if;

  select net.http_post(
    url := 'https://sellerpilot-global.vercel.app/api/internal/channel-gateway-drain',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_wake_secret,
      'Content-Type', 'application/json',
      'User-Agent', 'SellerPilot-Supabase-Cron/2',
      'X-SellerPilot-Wake-Version', 'serverless_runtime_v2'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  ) into v_request_id;
  if v_request_id is null then
    raise exception 'serverless CS wake request id missing'
      using errcode = '55000';
  end if;

  v_requested_at := clock_timestamp();
  begin
    insert into sellerpilot_private.serverless_cs_wake_requests (
      request_id, requested_at
    ) values (
      v_request_id, v_requested_at
    );
  exception
    when unique_violation then
      insert into sellerpilot_private.serverless_cs_wake_request_archives (
        archive_reason, request_id, requested_at, resolved_at,
        outcome, http_status, timed_out, safe_error_code
      )
      select 'pg_net_request_id_reused',
             wake.request_id, wake.requested_at, wake.resolved_at,
             wake.outcome, wake.http_status, wake.timed_out, wake.safe_error_code
        from sellerpilot_private.serverless_cs_wake_requests wake
       where wake.request_id = v_request_id
         and wake.outcome is distinct from 'queued';
      get diagnostics v_archived = row_count;
      if v_archived is distinct from 1 then
        raise exception 'serverless CS wake request id still in flight'
          using errcode = '55000';
      end if;
      update sellerpilot_private.serverless_cs_wake_requests wake
         set requested_at = v_requested_at,
             resolved_at = null,
             outcome = 'queued',
             http_status = null,
             timed_out = false,
             safe_error_code = null
       where wake.request_id = v_request_id
         and wake.outcome is distinct from 'queued';
      get diagnostics v_reset = row_count;
      if v_reset is distinct from 1 then
        raise exception 'serverless CS wake request id still in flight'
          using errcode = '55000';
      end if;
      delete from net._http_response response
       where response.id = v_request_id
         and response.created < v_requested_at;
  end;
  return v_request_id;
end;
$$;

revoke all on function sellerpilot_private.schedule_serverless_cs_wakeup()
  from public, anon, authenticated, service_role;

comment on table sellerpilot_private.serverless_cs_wake_request_archives is
  'Secret-free archive of resolved wake receipts whose pg_net request_id was reused.';
comment on function sellerpilot_private.schedule_serverless_cs_wakeup() is
  'Posts one non-overlapping bounded wake; archives a resolved receipt if pg_net reuses its request_id.';

commit;
