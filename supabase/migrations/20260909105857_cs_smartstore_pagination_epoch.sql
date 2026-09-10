begin;
do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('sellerpilot_private.smartstore_history_run_lineage_valid_v1(uuid,uuid,uuid,text,date,date,text)')) is distinct from '2deed052418fcd072718428e6b842cb0' then
  raise exception 'SMARTSTORE_PAGINATION_EPOCH_PREIMAGE_DRIFTED';
 end if;
end $guard$;


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
    root.id,root.kind,root.item_key,
    0 as absolute_depth,0 as generation_depth,0 as pagination_epoch,
    '[]'::jsonb as pagination_trail,false as durable,
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
    and not (root.request_payload->'arguments' ?| array[
      'sellerpilotPaginationDepth','sellerpilotPaginationEpoch','sellerpilotPaginationTrail'
    ])
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
lineage(
  id,kind,item_key,absolute_depth,generation_depth,pagination_epoch,
  pagination_trail,durable,page_number,page_size,from_at,through_at,observed_at
) as (
  select id,kind,item_key,absolute_depth,generation_depth,pagination_epoch,
    pagination_trail,durable,page_number,page_size,from_at,through_at,observed_at
    from valid_roots
  union all
  select
    child.id,parent.kind,parent.item_key,parent.absolute_depth+1,
    case when child.request_payload->'arguments' ? 'sellerpilotPaginationEpoch'
      then (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer
      else parent.absolute_depth+1 end,
    case when child.request_payload->'arguments' ? 'sellerpilotPaginationEpoch'
      then (child.request_payload#>>'{arguments,sellerpilotPaginationEpoch}')::integer
      else 0 end,
    case when child.request_payload->'arguments' ? 'sellerpilotPaginationEpoch'
      then child.request_payload#>'{arguments,sellerpilotPaginationTrail}'
      else '[]'::jsonb end,
    child.request_payload->'arguments' ? 'sellerpilotPaginationEpoch',
    parent.page_number+1,parent.page_size,parent.from_at,parent.through_at,parent.observed_at
  from lineage parent
  join sellerpilot_private.channel_gateway_jobs child
    on child.request_payload->>'continuationOf'=parent.id::text
  where parent.absolute_depth<128
    and child.created_by=p_owner_id
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
    and child.request_payload#>>'{arguments,query,page}' ~ '^[1-9][0-9]{0,6}$'
    and (child.request_payload#>>'{arguments,query,page}')::integer=parent.page_number+1
    and child.request_payload#>>'{arguments,query,size}'=parent.page_size::text
    and (
      (
        not (child.request_payload->'arguments' ?| array[
          'sellerpilotPaginationEpoch','sellerpilotPaginationTrail'
        ])
        and child.request_payload#>>'{arguments,sellerpilotPaginationDepth}' ~ '^[1-9][0-9]?$'
        and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer
          =parent.absolute_depth+1
        and parent.durable is false
        and parent.absolute_depth<50
        and child.request_payload->>'periodicKey'=format(
          'continuation:%s:%s',parent.id,parent.absolute_depth+1
        )
      )
      or
      (
        child.request_payload#>>'{arguments,sellerpilotPaginationDepth}' ~ '^[1-9][0-9]?$'
        and child.request_payload#>>'{arguments,sellerpilotPaginationEpoch}' ~ '^(0|[1-9][0-9]?)$'
        and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer between 1 and 49
        and (child.request_payload#>>'{arguments,sellerpilotPaginationEpoch}')::integer = case
          when parent.durable and parent.generation_depth=49 then parent.pagination_epoch+1
          when parent.durable then parent.pagination_epoch
          when parent.absolute_depth>=49 then 1
          else 0 end
        and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer = case
          when parent.durable and parent.generation_depth=49 then 1
          when parent.durable then parent.generation_depth+1
          when parent.absolute_depth>=49 then 1
          else parent.absolute_depth+1 end
        and jsonb_typeof(child.request_payload#>'{arguments,sellerpilotPaginationTrail}')='array'
        and jsonb_array_length(child.request_payload#>'{arguments,sellerpilotPaginationTrail}')
          =case when parent.durable
            then least(jsonb_array_length(parent.pagination_trail)+1,50)
            else 1 end
        and case when jsonb_typeof(
          child.request_payload#>'{arguments,sellerpilotPaginationTrail}'
        )='array' then not exists (
          select 1
            from jsonb_array_elements_text(
              child.request_payload#>'{arguments,sellerpilotPaginationTrail}'
            ) trail(value)
           where trail.value !~ '^[a-f0-9]{64}$'
        ) else false end
        and case when jsonb_typeof(
          child.request_payload#>'{arguments,sellerpilotPaginationTrail}'
        )='array' then not exists (
          select 1
            from jsonb_array_elements_text(
              child.request_payload#>'{arguments,sellerpilotPaginationTrail}'
            ) trail(value)
           group by trail.value having count(*)>1
        ) else false end
        and (
          parent.durable is false
          or (jsonb_array_length(parent.pagination_trail)<50
            and (child.request_payload#>'{arguments,sellerpilotPaginationTrail}')
              - (jsonb_array_length(child.request_payload#>'{arguments,sellerpilotPaginationTrail}')-1)
              =parent.pagination_trail)
          or (jsonb_array_length(parent.pagination_trail)=50
            and (child.request_payload#>'{arguments,sellerpilotPaginationTrail}')-49
              =parent.pagination_trail-0)
        )
        and child.request_payload->>'periodicKey'=format(
          'continuation:%s:%s',parent.id,
          (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer
        )
      )
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

comment on function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
  uuid,uuid,uuid,text,date,date,text
) is 'Internal exact SmartStore lineage validator with bounded pagination epochs, 50-entry cycle trail, and one legacy depth-50 rollover.';

commit;
