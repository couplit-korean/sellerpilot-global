-- Turn abandoned non-CS AI work into an explicit, retryable terminal state.
-- Workers already reclaim expired leases while claiming new work; this
-- maintenance path covers the separate case where no AI worker is alive.

begin;

create index if not exists ai_cli_jobs_non_cs_running_lease_idx
  on sellerpilot_private.ai_cli_jobs (lease_expires_at, id)
  where status = 'running'
    and kind in ('product_studio', 'product_research', 'product_asset_regeneration');

create index if not exists ai_cli_jobs_non_cs_running_unleased_age_idx
  on sellerpilot_private.ai_cli_jobs ((coalesce(started_at, updated_at, created_at)), id)
  where status = 'running'
    and lease_expires_at is null
    and kind in ('product_studio', 'product_research', 'product_asset_regeneration');

create index if not exists ai_cli_jobs_non_cs_queued_age_idx
  on sellerpilot_private.ai_cli_jobs ((coalesce(retry_started_at, created_at)), id)
  where status = 'queued'
    and kind in ('product_studio', 'product_research', 'product_asset_regeneration');

create or replace function public.sellerpilot_service_expire_stale_ai_jobs(
  p_queued_before timestamptz,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_queued_expired integer := 0;
  v_running_expired integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  -- A bad cutoff must never turn a brief queue delay into a bulk failure.
  if p_queued_before is null
     or p_queued_before > v_now - interval '6 hours' then
    raise exception 'queued AI expiry window must be at least six hours';
  end if;

  with selected as (
    select job.id, job.status as stale_status
      from sellerpilot_private.ai_cli_jobs job
     where job.kind in ('product_studio', 'product_research', 'product_asset_regeneration')
       and (
         (
           job.status = 'running'
           -- Normal workers use an elapsed lease. Legacy rows written before
           -- leases were required are abandoned only after the same bounded
           -- age cutoff used for unclaimed work; recent unleased work is kept.
           and (
             job.lease_expires_at < v_now
             or (
               job.lease_expires_at is null
               and coalesce(job.started_at, job.updated_at, job.created_at) < p_queued_before
             )
           )
         )
         or (
           job.status = 'queued'
           and job.available_at <= v_now
           and coalesce(job.retry_started_at, job.created_at) < p_queued_before
         )
       )
     order by
       case when job.status = 'running' then 0 else 1 end,
       coalesce(job.lease_expires_at, job.started_at, job.retry_started_at, job.updated_at, job.created_at),
       job.id
     for update of job skip locked
     limit v_limit
  ), expired as (
    update sellerpilot_private.ai_cli_jobs job
       set status = 'failed',
           result_payload = null,
           error_message = case selected.stale_status
             when 'running' then
               'AI 작업자 연결이 끊겨 분석 작업의 실행 시간이 만료되었습니다. 기존 입력으로 다시 시도해 주세요.'
             else
               'AI 작업자가 분석 요청을 가져가지 않아 대기 시간이 초과되었습니다. 기존 입력으로 다시 시도해 주세요.'
           end,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = v_now,
           updated_at = v_now
      from selected
     where job.id = selected.id
       and job.status = selected.stale_status
    returning job.id, selected.stale_status
  ), audited as (
    insert into sellerpilot_private.ai_cli_audit (
      action, job_id, safe_detail
    )
    select
      'job_failed',
      expired.id,
      jsonb_build_object(
        'source', 'scheduled_maintenance',
        'reason', case expired.stale_status
          when 'running' then 'worker_lease_expired'
          else 'worker_claim_timeout'
        end,
        'retryable', true
      )
      from expired
    returning job_id
  )
  select
    count(*) filter (where expired.stale_status = 'queued')::integer,
    count(*) filter (where expired.stale_status = 'running')::integer
    into v_queued_expired, v_running_expired
    from expired
   where (select count(*) from audited) >= 0;

  return jsonb_build_object(
    'queuedExpired', v_queued_expired,
    'runningExpired', v_running_expired,
    'total', v_queued_expired + v_running_expired
  );
end;
$$;

revoke all on function public.sellerpilot_service_expire_stale_ai_jobs(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_expire_stale_ai_jobs(timestamptz, integer)
  to service_role;

commit;
