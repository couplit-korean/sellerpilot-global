-- Proposal only. The coordinator assigns the migration version after review.
-- Preserve the generic coverage recorder while overriding SmartStore timestamps
-- only when the root history job carries the explicit v6 boundary contract.
begin;

create function sellerpilot_private.try_timestamptz_v1(p_value text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null
     or p_value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end
$$;

create function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root sellerpilot_private.channel_gateway_jobs%rowtype;
  v_mode text;
  v_from_text text;
  v_through_text text;
  v_observed_text text;
  v_from_at timestamptz;
  v_through_at timestamptz;
  v_observed_at timestamptz;
  v_from_date date;
  v_through_date date;
  v_kind text;
  v_item_key text;
begin
  if new.channel <> 'smartstore' then return new; end if;

  select job.* into v_root
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.root_job_id
     and job.created_by = new.owner_id
     and job.credential_id = new.credential_id
     and job.channel = new.channel
     and job.environment = new.environment
     and job.operation = 'inquiries.list';
  if not found then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_ROOT_INVALID' using errcode = '55000';
  end if;

  v_mode := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}','');
  v_from_text := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}','');
  v_through_text := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}','');
  v_observed_text := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}','');
  if v_mode is null and v_from_text is null and v_through_text is null
     and v_observed_text is null then
    return new;
  end if;
  if coalesce(v_mode,'') not in ('cutoff','full_day') or v_from_text is null
     or v_through_text is null or v_observed_text is null then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;

  v_from_at := sellerpilot_private.try_timestamptz_v1(v_from_text);
  v_through_at := sellerpilot_private.try_timestamptz_v1(v_through_text);
  v_observed_at := sellerpilot_private.try_timestamptz_v1(v_observed_text);
  if v_from_at is null or v_through_at is null or v_observed_at is null then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;
  if v_through_at < v_from_at then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;

  v_from_date := (v_from_at at time zone 'Asia/Seoul')::date;
  v_through_date := (v_through_at at time zone 'Asia/Seoul')::date;
  if v_from_at <> (v_from_date::timestamp at time zone 'Asia/Seoul') then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;
  if v_mode = 'full_day' and (
       v_through_at <> ((v_through_date+1)::timestamp at time zone 'Asia/Seoul'
         - interval '1 millisecond')
       or v_through_date >= (v_observed_at at time zone 'Asia/Seoul')::date
     ) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_FULL_DAY_INVALID' using errcode = '22023';
  end if;
  if v_mode = 'cutoff' and (
       v_through_at <> v_observed_at
       or v_through_date <> (v_observed_at at time zone 'Asia/Seoul')::date
     ) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_CUTOFF_INVALID' using errcode = '22023';
  end if;

  v_kind := nullif(v_root.request_payload#>>'{arguments,kind}','');
  v_item_key := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryItemKey}','');
  if coalesce(v_kind,'') not in ('product','customer')
     or v_item_key is distinct from format('%s:%s:%s',v_kind,v_from_date,v_through_date)
     or v_root.request_payload->>'periodicKey' is distinct from format(
       'inquiries:history:%s:smartstore:%s',
       v_root.request_payload#>>'{arguments,sellerpilotHistoryRunId}',v_item_key
     ) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_SCOPE_INVALID' using errcode = '22023';
  end if;
  if (v_kind = 'product' and (
        sellerpilot_private.try_timestamptz_v1(
          v_root.request_payload#>>'{arguments,query,fromDate}'
        ) is distinct from v_from_at
        or sellerpilot_private.try_timestamptz_v1(
          v_root.request_payload#>>'{arguments,query,toDate}'
        ) is distinct from v_through_at
      ))
     or (v_kind = 'customer' and (
        v_root.request_payload#>>'{arguments,query,startSearchDate}'
          is distinct from v_from_date::text
        or v_root.request_payload#>>'{arguments,query,endSearchDate}'
          is distinct from v_through_date::text
      )) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_QUERY_BOUNDARY_MISMATCH' using errcode = '22023';
  end if;

  new.timezone_name := 'Asia/Seoul';
  new.range_start_at := v_from_at;
  new.range_end_at := v_through_at;
  return new;
end
$$;

drop trigger if exists apply_smartstore_history_coverage_bounds_v1
  on sellerpilot_private.cs_history_scans;
create trigger apply_smartstore_history_coverage_bounds_v1
before insert on sellerpilot_private.cs_history_scans
for each row execute function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1();

revoke all on function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1()
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.try_timestamptz_v1(text)
  from public,anon,authenticated,service_role;

comment on function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1() is
  'Internal trigger: validates the SmartStore v6 explicit cutoff/full-day boundary contract and stores timezone-independent coverage timestamps.';
comment on function sellerpilot_private.try_timestamptz_v1(text) is
  'Internal fail-closed parser for explicit offset-bearing SmartStore history coverage timestamps.';

commit;
