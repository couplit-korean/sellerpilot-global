-- Proposal only. Apply after smartstore-009-continuation-safe-window-v7.sql.
-- A reconciled current-day cutoff is still incomplete, but it is deferred
-- while older full-day windows remain. After the date rolls over, the same
-- window becomes eligible for a distinct full-day v7 run.
begin;

create or replace function sellerpilot_private.smartstore_history_run_reconciled_v1(
  p_run_id uuid,
  p_owner_id uuid,
  p_credential_id uuid,
  p_environment text,
  p_from_date date,
  p_through_date date,
  p_coverage_mode text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
with recursive target_run as (
  select run.*
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id=p_run_id
     and run.owner_id=p_owner_id
     and run.range_start=p_from_date
     and run.range_end=p_through_date
     and run.history_days=p_through_date-p_from_date+1
     and run.channels=array['smartstore']::text[]
     and run.credential_ids->>'smartstore'=p_credential_id::text
     and run.status='succeeded'
     and run.completed_at is not null
     and run.expected_initial_jobs=2
     and run.total_jobs>=run.expected_initial_jobs
     and run.succeeded_jobs=run.total_jobs
     and run.queued_jobs=0 and run.running_jobs=0 and run.failed_jobs=0
),
tagged_jobs as (
  select job.*
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
),
roots as (
  select job.*
    from tagged_jobs job
   where nullif(job.request_payload->>'continuationOf','') is null
),
job_roots(job_id,root_job_id) as (
  select root.id,root.id from roots root
  union all
  select child.id,parent.root_job_id
    from job_roots parent
    join tagged_jobs child
      on child.request_payload->>'continuationOf'=parent.job_id::text
),
matched as (
  select root.request_payload#>>'{arguments,kind}' as kind
    from roots root
    join sellerpilot_private.cs_history_scans scan
      on scan.root_job_id=root.id
     and scan.owner_id=root.created_by
     and scan.credential_id=root.credential_id
     and scan.channel=root.channel
     and scan.environment=root.environment
   where root.status='succeeded'
     and scan.scope_key=format(
       'inquiries:history:%s:smartstore:%s:%s:%s',p_run_id,
       root.request_payload#>>'{arguments,kind}',p_from_date,p_through_date
     )
     and scan.ticket_kind=root.request_payload#>>'{arguments,kind}'
     and scan.status='completed'
     and scan.scan_completed_at is not null
     and scan.reconciled_at is not null
     and scan.unprocessed_count=0
     and scan.timezone_name='Asia/Seoul'
     and scan.range_start_at=p_from_date::timestamp at time zone 'Asia/Seoul'
     and scan.range_end_at=sellerpilot_private.try_timestamptz_v1(
       root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
     )
     and scan.scope_digest=encode(extensions.digest(
       pg_catalog.convert_to(root.request_payload::text,'UTF8'),'sha256'
     ),'hex')
),
matched_pages as (
  select mapped.job_id
    from job_roots mapped
    join sellerpilot_private.cs_history_scans scan
      on scan.root_job_id=mapped.root_job_id
    join sellerpilot_private.cs_history_scan_pages page
      on page.scan_id=scan.id and page.job_id=mapped.job_id
   where page.continuation_expected=exists(
     select 1 from tagged_jobs child
      where child.request_payload->>'continuationOf'=mapped.job_id::text
   )
)
select coalesce(
  exists(select 1 from target_run)
  and sellerpilot_private.smartstore_history_run_lineage_valid_v1(
    p_run_id,p_owner_id,p_credential_id,p_environment,
    p_from_date,p_through_date,p_coverage_mode
  )
  and (select count(*) from tagged_jobs)=(select total_jobs from target_run)
  and not exists(select 1 from tagged_jobs where status<>'succeeded')
  and (select count(*) from matched_pages)=(select count(*) from tagged_jobs)
  and (select count(*) from matched)=2
  and (select count(*) from matched where kind='product')=1
  and (select count(*) from matched where kind='customer')=1,
  false
)
$$;

revoke all on function sellerpilot_private.smartstore_history_run_reconciled_v1(
  uuid,uuid,uuid,text,date,date,text
) from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_next_smartstore_history_window_v4(
  p_floor_date date,
  p_through_date date,
  p_credential_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz:=statement_timestamp();
  v_today date:=(v_now at time zone 'Asia/Seoul')::date;
  v_owner_id uuid;
  v_total integer:=0;
  v_completed integer:=0;
  v_window_start date;
  v_window_end date;
  v_window_complete boolean;
  v_cutoff_observed boolean;
  v_next_start date;
  v_next_end date;
  v_deferred_start date;
  v_deferred_end date;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_floor_date is null or p_through_date is null or p_floor_date>p_through_date
     or p_floor_date<date '2000-01-01' or p_through_date-p_floor_date>5000
     or p_through_date>v_today or p_environment is distinct from 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_RANGE_INVALID' using errcode='22023';
  end if;

  select credential.created_by into v_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.created_by is not null
     and credential.channel='smartstore'
     and credential.environment=p_environment
     and credential.status='active'
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>v_now)
   limit 1;
  if not found then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_CREDENTIAL_INVALID' using errcode='42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id<>p_credential_id and other.channel='smartstore'
       and other.environment=p_environment and other.status='active'
       and (other.expires_at is null or other.expires_at>v_now)
  ) then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_ACTIVE_SCOPE_AMBIGUOUS' using errcode='55000';
  end if;

  v_window_end:=p_through_date;
  loop
    v_window_start:=greatest(p_floor_date,v_window_end-29);
    v_total:=v_total+1;

    select v_window_end<v_today and exists (
      select 1
        from sellerpilot_private.inquiry_history_backfill_runs run
       where run.owner_id=v_owner_id
         and run.range_start=v_window_start
         and run.range_end=v_window_end
         and sellerpilot_private.smartstore_history_run_reconciled_v1(
           run.id,v_owner_id,p_credential_id,p_environment,
           v_window_start,v_window_end,'full_day'
         )
    ) into v_window_complete;

    select v_window_end=v_today and exists (
      select 1
        from sellerpilot_private.inquiry_history_backfill_runs run
       where run.owner_id=v_owner_id
         and run.range_start=v_window_start
         and run.range_end=v_window_end
         and sellerpilot_private.smartstore_history_run_reconciled_v1(
           run.id,v_owner_id,p_credential_id,p_environment,
           v_window_start,v_window_end,'cutoff'
         )
    ) into v_cutoff_observed;

    if v_window_complete then
      v_completed:=v_completed+1;
    elsif v_cutoff_observed then
      v_deferred_start:=v_window_start;
      v_deferred_end:=v_window_end;
    elsif v_next_start is null then
      v_next_start:=v_window_start;
      v_next_end:=v_window_end;
    end if;

    exit when v_window_start=p_floor_date;
    v_window_end:=v_window_start-1;
  end loop;

  -- A current cutoff is never completion. Once it has been reconciled, leave
  -- it behind older missing full-day windows; return it again only when no
  -- older work remains so the route never represents the full range complete.
  if v_next_start is null and v_deferred_start is not null then
    v_next_start:=v_deferred_start;
    v_next_end:=v_deferred_end;
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-smartstore-history-checkpoint/4',
    'checkedAt',v_now,
    'environment',p_environment,
    'totalWindowCount',v_total,
    'completedWindowCount',v_completed,
    'remainingWindowCount',v_total-v_completed,
    'complete',v_next_start is null,
    'nextWindow',case when v_next_start is null then null else jsonb_build_object(
      'key',format('smartstore:history:v4:%s:%s',v_next_start,v_next_end),
      'fromDate',v_next_start,
      'throughDate',v_next_end,
      'productItemKey',format('product:%s:%s',v_next_start,v_next_end),
      'customerItemKey',format('customer:%s:%s',v_next_start,v_next_end)
    ) end,
    'advanceRule','current_cutoff_deferred_behind_older_exact_full_kst_day_windows'
  );
end
$$;

revoke all on function public.sellerpilot_next_smartstore_history_window_v3(
  date,date,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_next_smartstore_history_window_v4(
  date,date,uuid,text
) from public,anon,service_role;
grant execute on function public.sellerpilot_next_smartstore_history_window_v4(
  date,date,uuid,text
) to authenticated;

comment on function sellerpilot_private.smartstore_history_run_reconciled_v1(
  uuid,uuid,uuid,text,date,date,text
) is 'Internal exact-run, exact-lineage and two-kind reconciled SmartStore coverage check.';
comment on function public.sellerpilot_next_smartstore_history_window_v4(
  date,date,uuid,text
) is 'Admin-only checkpoint that defers a reconciled current cutoff behind older full-day work without ever counting that cutoff complete.';

notify pgrst,'reload schema';
commit;
