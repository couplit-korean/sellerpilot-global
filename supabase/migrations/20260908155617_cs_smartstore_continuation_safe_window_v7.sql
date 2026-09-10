-- Proposal only. Apply after the frozen supplement 006 candidate.
-- Keep the two initial SmartStore jobs distinct from their pagination
-- descendants, validate the complete tagged lineage, and retry only failed
-- jobs in that exact lineage.
begin;

create or replace function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
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
with recursive
expected as (
  select
    p_from_date::timestamp at time zone 'Asia/Seoul' as from_at,
    (p_through_date+1)::timestamp at time zone 'Asia/Seoul'
      - interval '1 millisecond' as full_day_through_at
),
roots as (
  select
    job.id,
    job.request_payload,
    job.request_payload#>>'{arguments,kind}' as kind,
    job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}' as item_key
  from sellerpilot_private.channel_gateway_jobs job
  where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
    and nullif(job.request_payload->>'continuationOf','') is null
),
valid_roots as (
  select
    root.id,root.kind,root.item_key,0 as depth,
    (root.request_payload#>>'{arguments,query,page}')::integer as page_number,
    (root.request_payload#>>'{arguments,query,size}')::integer as page_size,
    sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
    ) as from_at,
    sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
    ) as through_at,
    sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
    ) as observed_at
  from roots root
  join sellerpilot_private.channel_gateway_jobs job on job.id=root.id
  cross join expected
  where job.created_by=p_owner_id
    and job.credential_id=p_credential_id
    and job.channel='smartstore'
    and job.environment=p_environment
    and job.operation='inquiries.list'
    and root.kind in ('product','customer')
    and root.item_key=format('%s:%s:%s',root.kind,p_from_date,p_through_date)
    and root.request_payload->>'periodicKey'=format(
      'inquiries:history:%s:smartstore:%s:%s:%s',
      p_run_id,root.kind,p_from_date,p_through_date
    )
    and root.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'=p_coverage_mode
    and root.request_payload#>>'{arguments,query,page}'='1'
    and (
      (root.kind='product' and root.request_payload#>>'{arguments,query,size}'='100')
      or (root.kind='customer' and root.request_payload#>>'{arguments,query,size}'='200')
    )
    and sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
    )=expected.from_at
    and sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
    ) is not null
    and (
      (p_coverage_mode='full_day'
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
        )=expected.full_day_through_at
        and (sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
        ) at time zone 'Asia/Seoul')::date>p_through_date)
      or
      (p_coverage_mode='cutoff'
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
        )=sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
        )
        and (sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
        ) at time zone 'Asia/Seoul')::date=p_through_date)
    )
    and (
      (root.kind='product'
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,query,fromDate}'
        )=expected.from_at
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,query,toDate}'
        )=sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
        ))
      or
      (root.kind='customer'
        and root.request_payload#>>'{arguments,query,startSearchDate}'=p_from_date::text
        and root.request_payload#>>'{arguments,query,endSearchDate}'=p_through_date::text)
    )
),
lineage(id,kind,item_key,depth,page_number,page_size,from_at,through_at,observed_at) as (
  select id,kind,item_key,depth,page_number,page_size,from_at,through_at,observed_at
    from valid_roots
  union all
  select
    child.id,parent.kind,parent.item_key,parent.depth+1,parent.page_number+1,parent.page_size,
    parent.from_at,parent.through_at,parent.observed_at
  from lineage parent
  join sellerpilot_private.channel_gateway_jobs child
    on child.request_payload->>'continuationOf'=parent.id::text
  where child.created_by=p_owner_id
    and child.credential_id=p_credential_id
    and child.channel='smartstore'
    and child.environment=p_environment
    and child.operation='inquiries.list'
    and child.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
    and child.request_payload#>>'{arguments,sellerpilotHistoryItemKey}'=parent.item_key
    and child.request_payload#>>'{arguments,kind}'=parent.kind
    and child.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'=p_coverage_mode
    and sellerpilot_private.try_timestamptz_v1(
      child.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
    )=parent.from_at
    and sellerpilot_private.try_timestamptz_v1(
      child.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
    )=parent.through_at
    and sellerpilot_private.try_timestamptz_v1(
      child.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
    )=parent.observed_at
    and child.request_payload#>>'{arguments,sellerpilotPaginationDepth}'
      ~ '^[1-9][0-9]?$'
    and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer
      =parent.depth+1
    and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer<=50
    and child.request_payload#>>'{arguments,query,page}' ~ '^[1-9][0-9]{0,6}$'
    and (child.request_payload#>>'{arguments,query,page}')::integer=parent.page_number+1
    and child.request_payload#>>'{arguments,query,size}'=parent.page_size::text
    and child.request_payload->>'periodicKey'=format(
      'continuation:%s:%s',parent.id,parent.depth+1
    )
    and (
      (parent.kind='product'
        and sellerpilot_private.try_timestamptz_v1(
          child.request_payload#>>'{arguments,query,fromDate}'
        )=parent.from_at
        and sellerpilot_private.try_timestamptz_v1(
          child.request_payload#>>'{arguments,query,toDate}'
        )=parent.through_at)
      or
      (parent.kind='customer'
        and child.request_payload#>>'{arguments,query,startSearchDate}'=p_from_date::text
        and child.request_payload#>>'{arguments,query,endSearchDate}'=p_through_date::text)
    )
),
tagged as (
  select job.id,job.request_payload
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
)
select coalesce(
  p_coverage_mode in ('cutoff','full_day')
  and (select count(*) from roots)=2
  and (select count(*) from valid_roots)=2
  and (select count(*) from valid_roots where kind='product')=1
  and (select count(*) from valid_roots where kind='customer')=1
  and (select count(distinct through_at) from valid_roots)=1
  and (select count(distinct observed_at) from valid_roots)=1
  and (select count(*) from tagged)=(select count(*) from lineage)
  and not exists (
    select 1 from tagged
     where not exists (select 1 from lineage where lineage.id=tagged.id)
  )
  and not exists (
    select 1 from tagged
     where nullif(tagged.request_payload->>'continuationOf','') is not null
     group by tagged.request_payload->>'continuationOf'
     having count(*)<>1
  ),false
)
$$;

revoke all on function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
  uuid,uuid,uuid,text,date,date,text
) from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
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
  v_request_key text;
  v_existing_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_existing_from_text text;
  v_existing_through_text text;
  v_existing_observed_text text;
  v_retried_jobs integer := 0;
  v_result jsonb;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_from_date is null or p_through_date is null or p_from_date>p_through_date
     or p_from_date<date '2000-01-01' or p_through_date-p_from_date>29
     or p_through_date>v_today or p_environment is distinct from 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID' using errcode='22023';
  end if;
  v_history_days:=p_through_date-p_from_date+1;
  v_coverage_mode:=case when p_through_date=v_today then 'cutoff' else 'full_day' end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:smartstore:'||p_environment)
  );
  if not exists (
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel='smartstore' and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode='55000';
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
    raise exception 'SMARTSTORE_EXACT_HISTORY_CREDENTIAL_INVALID' using errcode='42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id<>v_credential.id and other.channel='smartstore'
       and other.environment=p_environment and other.status='active'
       and (other.expires_at is null or other.expires_at>v_now)
  ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ACTIVE_SCOPE_AMBIGUOUS' using errcode='55000';
  end if;

  -- v7 deliberately adopts the compatible v6 request lineage so installing
  -- the continuation fix cannot duplicate a window already accepted by v6.
  v_request_key:=encode(extensions.digest(concat_ws('|',
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

  if not found then
    v_result:=public.sellerpilot_start_smartstore_inquiry_history_window_v6(
      p_from_date,p_through_date,p_credential_id,p_environment
    );
    return v_result||jsonb_build_object(
      'contract','sellerpilot-smartstore-exact-history-window/7'
    );
  end if;

  if v_existing_run.owner_id<>v_credential.created_by
     or v_existing_run.history_days<>v_history_days
     or v_existing_run.range_start<>p_from_date
     or v_existing_run.range_end<>p_through_date
     or v_existing_run.channels<>array['smartstore']::text[]
     or v_existing_run.credential_ids->>'smartstore' is distinct from v_credential.id::text
     or sellerpilot_private.smartstore_history_run_lineage_valid_v1(
       v_existing_run.id,v_credential.created_by,v_credential.id,p_environment,
       p_from_date,p_through_date,v_coverage_mode
     ) is distinct from true then
    raise exception 'SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH' using errcode='55000';
  end if;

  select
    min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'),
    min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'),
    min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}')
    into v_existing_from_text,v_existing_through_text,v_existing_observed_text
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
     and nullif(job.request_payload->>'continuationOf','') is null;

  if v_existing_run.status='failed' then
    update sellerpilot_private.channel_gateway_jobs job set
      status='queued',worker_token_id=null,claim_token=null,lease_expires_at=null,
      completed_at=null,error_message=null,updated_at=clock_timestamp()
     where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
       and job.created_by=v_credential.created_by
       and job.credential_id=v_credential.id
       and job.channel='smartstore' and job.environment=p_environment
       and job.operation='inquiries.list' and job.status='failed'
       and job.attempt_count<4 and not job.credential_refresh_in_flight
       and job.credential_refresh_recovery_vault_id is null;
    get diagnostics v_retried_jobs=row_count;
  end if;

  return sellerpilot_private.refresh_inquiry_history_backfill_run(v_existing_run.id)
    ||jsonb_build_object(
      'contract','sellerpilot-smartstore-exact-history-window/7',
      'reused',true,'retriedJobs',v_retried_jobs,'acceptedNotCompleted',true,
      'coverageMode',v_coverage_mode,
      'fullCalendarDayCoverage',v_coverage_mode='full_day',
      'coverageFromAt',v_existing_from_text,
      'coverageThroughAt',v_existing_through_text,
      'coverageObservedAt',v_existing_observed_text
    );
end
$$;

revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(
  date,date,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  date,date,uuid,text
) from public,anon,service_role;
grant execute on function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  date,date,uuid,text
) to authenticated;

comment on function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
  uuid,uuid,uuid,text,date,date,text
) is 'Internal exact SmartStore root plus continuation lineage validator.';
comment on function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  date,date,uuid,text
) is 'Admin-only v6-compatible SmartStore history enqueue/retry that accepts valid page continuations and rejects forged or duplicate lineages.';

notify pgrst,'reload schema';
commit;
