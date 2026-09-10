-- Proposal only. The coordinator assigns the migration version after review.
-- Enqueues exact SmartStore history windows with an immutable observed cutoff.
-- A request through the current KST date is cutoff evidence; after that date,
-- the same calendar scope gets a distinct full-day run.
begin;

create or replace function public.sellerpilot_start_smartstore_inquiry_history_window_v6(
  p_from_date date,
  p_through_date date,
  p_credential_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := date_trunc('milliseconds',clock_timestamp());
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_history_days integer;
  v_credential record;
  v_coverage_mode text;
  v_coverage_from_at timestamptz;
  v_coverage_through_at timestamptz;
  v_request_key text;
  v_run_id uuid;
  v_existing_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_existing_from_text text;
  v_existing_through_text text;
  v_existing_observed_text text;
  v_retried_jobs integer := 0;
  v_result jsonb;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_from_date is null or p_through_date is null or p_from_date > p_through_date
     or p_from_date < date '2000-01-01' or p_through_date-p_from_date > 29
     or p_through_date > v_today or p_environment <> 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID' using errcode = '22023';
  end if;

  v_history_days := p_through_date-p_from_date+1;
  v_coverage_mode := case when p_through_date=v_today then 'cutoff' else 'full_day' end;
  v_coverage_from_at := p_from_date::timestamp at time zone 'Asia/Seoul';
  v_coverage_through_at := case when v_coverage_mode='cutoff' then v_now
    else (p_through_date+1)::timestamp at time zone 'Asia/Seoul'
      - interval '1 millisecond' end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:smartstore:'||p_environment)
  );
  if not exists (
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel='smartstore' and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment=p_environment
     and credential.status='active'
     and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>v_now)
   for update;
  if not found then
    raise exception 'SMARTSTORE_EXACT_HISTORY_CREDENTIAL_INVALID' using errcode = '42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id<>v_credential.id and other.channel='smartstore'
       and other.environment=p_environment and other.status='active'
       and (other.expires_at is null or other.expires_at>v_now)
  ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ACTIVE_SCOPE_AMBIGUOUS' using errcode = '55000';
  end if;

  v_request_key := encode(extensions.digest(concat_ws('|',
    'channel-inquiry-history-smartstore-exact-v6',v_credential.created_by::text,
    v_credential.id::text,v_credential.seller_account_key,p_environment,
    p_from_date::text,p_through_date::text,v_history_days::text,v_coverage_mode
  ),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:inquiry-history:'||v_request_key)
  );
  select run.* into v_existing_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.request_key=v_request_key for update;
  if found then
    if v_existing_run.owner_id<>v_credential.created_by
       or v_existing_run.history_days<>v_history_days
       or v_existing_run.range_start<>p_from_date
       or v_existing_run.range_end<>p_through_date
       or v_existing_run.channels<>array['smartstore']::text[]
       or v_existing_run.credential_ids->>'smartstore' is distinct from v_credential.id::text
       or (select count(*) from sellerpilot_private.channel_gateway_jobs job
            where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text)<>2
       or exists (
         select 1 from sellerpilot_private.channel_gateway_jobs job
          where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
            and (job.created_by is distinct from v_credential.created_by
              or job.credential_id is distinct from v_credential.id
              or job.channel is distinct from 'smartstore'
              or job.environment is distinct from p_environment
              or job.operation is distinct from 'inquiries.list'
              or job.request_payload#>>'{arguments,kind}' is null
              or job.request_payload#>>'{arguments,kind}' not in ('product','customer')
              or job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}' is distinct from
                format('%s:%s:%s',job.request_payload#>>'{arguments,kind}',p_from_date,p_through_date)
              or job.request_payload->>'periodicKey' is distinct from format(
                'inquiries:history:%s:smartstore:%s:%s:%s',v_existing_run.id,
                job.request_payload#>>'{arguments,kind}',p_from_date,p_through_date
              )
              or job.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'
                is distinct from v_coverage_mode
              or sellerpilot_private.try_timestamptz_v1(
                job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
              ) is distinct from v_coverage_from_at
              or case when v_coverage_mode='full_day' then
                sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
                ) is distinct from v_coverage_through_at
                or sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) is null
                or (sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) at time zone 'Asia/Seoul')::date<=p_through_date
              else
                sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
                ) is distinct from sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                )
                or sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) is null
                or (sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) at time zone 'Asia/Seoul')::date<>p_through_date
              end)
       ) then
      raise exception 'SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH' using errcode = '55000';
    end if;

    select min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'),
           min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'),
           min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}')
      into v_existing_from_text,v_existing_through_text,v_existing_observed_text
      from sellerpilot_private.channel_gateway_jobs job
     where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text;
    if v_existing_run.status='failed' then
      update sellerpilot_private.channel_gateway_jobs job set
        status='queued',worker_token_id=null,claim_token=null,lease_expires_at=null,
        completed_at=null,error_message=null,updated_at=clock_timestamp()
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
         and job.created_by=v_credential.created_by and job.credential_id=v_credential.id
         and job.channel='smartstore' and job.environment=p_environment
         and job.operation='inquiries.list' and job.status='failed'
         and job.attempt_count<4 and not job.credential_refresh_in_flight
         and job.credential_refresh_recovery_vault_id is null;
      get diagnostics v_retried_jobs = row_count;
    end if;
    return sellerpilot_private.refresh_inquiry_history_backfill_run(v_existing_run.id)
      || jsonb_build_object(
        'contract','sellerpilot-smartstore-exact-history-window/6',
        'reused',true,'retriedJobs',v_retried_jobs,'acceptedNotCompleted',true,
        'coverageMode',v_coverage_mode,'fullCalendarDayCoverage',v_coverage_mode='full_day',
        'coverageFromAt',v_existing_from_text,'coverageThroughAt',v_existing_through_text,
        'coverageObservedAt',v_existing_observed_text
      );
  end if;

  insert into sellerpilot_private.inquiry_history_backfill_runs(
    request_key,owner_id,initiated_by,history_days,range_start,range_end,
    expected_initial_jobs,channels,credential_ids
  ) values (
    v_request_key,v_credential.created_by,v_actor,v_history_days,p_from_date,p_through_date,
    2,array['smartstore']::text[],jsonb_build_object('smartstore',v_credential.id::text)
  ) returning id into v_run_id;

  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,'smartstore',format('product:%s:%s',p_from_date,p_through_date),
    jsonb_build_object(
      'kind','product',
      'sellerpilotHistoryCoverageMode',v_coverage_mode,
      'sellerpilotHistoryCoverageFromAt',v_coverage_from_at,
      'sellerpilotHistoryCoverageThroughAt',v_coverage_through_at,
      'sellerpilotHistoryCoverageObservedAt',v_now,
      'query',jsonb_build_object(
        'fromDate',format('%sT00:00:00.000+09:00',p_from_date),
        'toDate',to_char(v_coverage_through_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'page',1,'size',100
      )
    )
  );
  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,'smartstore',format('customer:%s:%s',p_from_date,p_through_date),
    jsonb_build_object(
      'kind','customer',
      'sellerpilotHistoryCoverageMode',v_coverage_mode,
      'sellerpilotHistoryCoverageFromAt',v_coverage_from_at,
      'sellerpilotHistoryCoverageThroughAt',v_coverage_through_at,
      'sellerpilotHistoryCoverageObservedAt',v_now,
      'query',jsonb_build_object(
        'startSearchDate',p_from_date::text,'endSearchDate',p_through_date::text,
        'page',1,'size',200
      )
    )
  );

  if (select count(*) from sellerpilot_private.channel_gateway_jobs job
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text)<>2
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text
          and (job.created_by is distinct from v_credential.created_by
            or job.credential_id is distinct from v_credential.id
            or job.channel is distinct from 'smartstore'
            or job.environment is distinct from p_environment
            or job.operation is distinct from 'inquiries.list'
            or job.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'
              is distinct from v_coverage_mode
            or sellerpilot_private.try_timestamptz_v1(
              job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
            ) is distinct from v_coverage_from_at
            or sellerpilot_private.try_timestamptz_v1(
              job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
            ) is distinct from v_coverage_through_at
            or sellerpilot_private.try_timestamptz_v1(
              job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
            ) is distinct from v_now)
     ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ENQUEUE_SCOPE_MISMATCH' using errcode = '55000';
  end if;
  v_result := sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
  if coalesce((v_result->>'totalJobs')::integer,0)<>2 then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ENQUEUE_COUNT_MISMATCH' using errcode = '55000';
  end if;
  return v_result || jsonb_build_object(
    'contract','sellerpilot-smartstore-exact-history-window/6',
    'reused',false,'retriedJobs',0,'acceptedNotCompleted',true,
    'coverageMode',v_coverage_mode,'fullCalendarDayCoverage',v_coverage_mode='full_day',
    'coverageFromAt',v_coverage_from_at,'coverageThroughAt',v_coverage_through_at,
    'coverageObservedAt',v_now
  );
end
$$;

revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text)
  to authenticated;

comment on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text) is
  'Admin-only exact SmartStore history enqueue. Current KST day is cutoff evidence; past dates are immutable full-day coverage and use a distinct request lineage.';

notify pgrst,'reload schema';
commit;
