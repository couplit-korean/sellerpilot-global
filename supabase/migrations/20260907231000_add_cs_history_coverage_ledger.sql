-- Body-free coverage evidence for every explicit inquiry-history pagination
-- lineage. Provider row counts, projected message events, repeated observations,
-- and unsupported/excluded rows remain separate so a successful last page is
-- never represented as proof of full reconciliation by itself.
begin;

create table sellerpilot_private.cs_history_scans (
  id uuid primary key default gen_random_uuid(),
  root_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  channel text not null check (channel in ('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu')),
  environment text not null check (environment in ('sandbox','production')),
  scope_key text not null check (length(scope_key) between 1 and 200),
  scope_digest text not null check (scope_digest ~ '^[a-f0-9]{64}$'),
  ticket_kind text not null check (ticket_kind ~ '^[a-z0-9:_-]{1,80}$'),
  provider_contract_version text not null
    check (provider_contract_version ~ '^sellerpilot-inquiry-coverage/[1-9][0-9]{0,5}$'),
  timezone_name text not null check (timezone_name in ('Asia/Seoul','UTC')),
  range_start_at timestamptz,
  range_end_at timestamptz,
  status text not null default 'running'
    check (status in ('running','completed','reconciliation_required','failed')),
  page_count integer not null default 0 check (page_count >= 0),
  provider_row_count integer not null default 0 check (provider_row_count >= 0),
  projected_event_count integer not null default 0 check (projected_event_count >= 0),
  observed_unique_count integer not null default 0 check (observed_unique_count >= 0),
  repeated_observation_count integer not null default 0 check (repeated_observation_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  unprocessed_count integer check (unprocessed_count is null or unprocessed_count >= 0),
  missing_ranges jsonb not null default '[]'::jsonb
    check (jsonb_typeof(missing_ranges) = 'array' and octet_length(missing_ranges::text) <= 16000),
  started_at timestamptz not null,
  scan_completed_at timestamptz,
  reconciled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((range_start_at is null) = (range_end_at is null)),
  check (range_start_at is null or range_end_at >= range_start_at),
  check (
    (status = 'running' and scan_completed_at is null and reconciled_at is null)
    or (status = 'completed' and scan_completed_at is not null and reconciled_at is not null)
    or (status in ('reconciliation_required','failed') and scan_completed_at is not null)
  )
);

create table sellerpilot_private.cs_history_scan_pages (
  job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  scan_id uuid not null references sellerpilot_private.cs_history_scans(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  provider_row_count integer not null check (provider_row_count >= 0),
  projected_event_count integer not null check (projected_event_count >= 0),
  new_observation_count integer not null check (new_observation_count >= 0),
  repeated_observation_count integer not null check (repeated_observation_count >= 0),
  excluded_count integer not null check (excluded_count >= 0),
  event_row_comparable boolean not null,
  continuation_expected boolean not null,
  observed_at timestamptz not null,
  unique (scan_id, page_number),
  check (new_observation_count + repeated_observation_count <= projected_event_count)
);

create table sellerpilot_private.cs_history_scan_observations (
  scan_id uuid not null references sellerpilot_private.cs_history_scans(id) on delete cascade,
  observation_digest text not null check (observation_digest ~ '^[a-f0-9]{64}$'),
  first_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  first_observed_at timestamptz not null,
  primary key (scan_id, observation_digest)
);

create table sellerpilot_private.cs_history_scan_gaps (
  job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  channel text not null check (channel in ('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu')),
  environment text not null check (environment in ('sandbox','production')),
  scope_key text not null check (length(scope_key) between 1 and 200),
  terminal_status text not null check (terminal_status in ('failed','cancelled','reconciliation_required')),
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz,
  check (last_observed_at >= first_observed_at),
  check (resolved_at is null or resolved_at >= first_observed_at)
);

alter table sellerpilot_private.cs_history_scans enable row level security;
alter table sellerpilot_private.cs_history_scan_pages enable row level security;
alter table sellerpilot_private.cs_history_scan_observations enable row level security;
alter table sellerpilot_private.cs_history_scan_gaps enable row level security;
revoke all on sellerpilot_private.cs_history_scans,
  sellerpilot_private.cs_history_scan_pages,
  sellerpilot_private.cs_history_scan_observations,
  sellerpilot_private.cs_history_scan_gaps
  from public, anon, authenticated, service_role;

create index cs_history_scans_admin_idx
  on sellerpilot_private.cs_history_scans(status, updated_at desc, id desc);
create index cs_history_scan_gaps_open_idx
  on sellerpilot_private.cs_history_scan_gaps(last_observed_at desc,job_id)
  where resolved_at is null;

create function sellerpilot_private.track_cs_history_scan_gap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_key text;
  v_now timestamptz := clock_timestamp();
begin
  if new.operation <> 'inquiries.list'
     or (coalesce(new.request_payload->>'periodicKey','') not like 'inquiries:history:%'
       and nullif(new.request_payload#>>'{arguments,sellerpilotHistoryRunId}','') is null) then
    return new;
  end if;
  v_scope_key := left(coalesce(
    nullif(new.request_payload->>'periodicKey',''),
    'inquiries:history-run:' || nullif(new.request_payload#>>'{arguments,sellerpilotHistoryRunId}',''),
    'inquiries:history:' || new.id::text
  ),200);
  if new.status = 'succeeded' then
    update sellerpilot_private.cs_history_scan_gaps gap
       set resolved_at=coalesce(gap.resolved_at,v_now),last_observed_at=v_now
     where gap.owner_id=new.created_by and gap.credential_id=new.credential_id
       and gap.channel=new.channel and gap.environment=new.environment
       and gap.scope_key=v_scope_key and gap.resolved_at is null;
  elsif new.status in ('failed','cancelled','reconciliation_required') then
    insert into sellerpilot_private.cs_history_scan_gaps(
      job_id,owner_id,credential_id,channel,environment,scope_key,terminal_status,
      first_observed_at,last_observed_at
    ) values (
      new.id,new.created_by,new.credential_id,new.channel,new.environment,v_scope_key,new.status,
      coalesce(new.completed_at,v_now),v_now
    ) on conflict (job_id) do update set
      terminal_status=excluded.terminal_status,last_observed_at=excluded.last_observed_at,resolved_at=null;
  end if;
  return new;
end
$$;

-- Start with the actionable recovery window already present in the gateway
-- ledger. A later success resolves only the same account, channel,
-- environment and frozen history scope.
insert into sellerpilot_private.cs_history_scan_gaps(
  job_id,owner_id,credential_id,channel,environment,scope_key,terminal_status,
  first_observed_at,last_observed_at
)
select job.id,job.created_by,job.credential_id,job.channel,job.environment,
  left(coalesce(
    nullif(job.request_payload->>'periodicKey',''),
    'inquiries:history-run:' || nullif(job.request_payload#>>'{arguments,sellerpilotHistoryRunId}',''),
    'inquiries:history:' || job.id::text
  ),200),
  job.status,coalesce(job.completed_at,job.created_at),coalesce(job.completed_at,job.created_at)
from sellerpilot_private.channel_gateway_jobs job
where job.operation='inquiries.list'
  and job.status in ('failed','cancelled','reconciliation_required')
  and (coalesce(job.request_payload->>'periodicKey','') like 'inquiries:history:%'
    or nullif(job.request_payload#>>'{arguments,sellerpilotHistoryRunId}','') is not null)
  and coalesce(job.completed_at,job.created_at) >= statement_timestamp()-interval '35 days'
on conflict (job_id) do nothing;

with resolved as (
  select gap.job_id,min(coalesce(job.completed_at,job.created_at)) completed_at
  from sellerpilot_private.cs_history_scan_gaps gap
  join sellerpilot_private.channel_gateway_jobs job
    on job.operation='inquiries.list' and job.status='succeeded'
   and job.created_by=gap.owner_id and job.credential_id=gap.credential_id
   and job.channel=gap.channel and job.environment=gap.environment
   and left(coalesce(
     nullif(job.request_payload->>'periodicKey',''),
     'inquiries:history-run:' || nullif(job.request_payload#>>'{arguments,sellerpilotHistoryRunId}',''),
     'inquiries:history:' || job.id::text
   ),200)=gap.scope_key
   and coalesce(job.completed_at,job.created_at)>gap.first_observed_at
  where gap.resolved_at is null
  group by gap.job_id
)
update sellerpilot_private.cs_history_scan_gaps gap
set resolved_at=resolved.completed_at,last_observed_at=resolved.completed_at
from resolved where resolved.job_id=gap.job_id;

create trigger track_cs_history_scan_gap
after insert or update of status on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.track_cs_history_scan_gap();
revoke all on function sellerpilot_private.track_cs_history_scan_gap()
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_record_cs_history_page_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_contract_version text,
  p_provider_row_count integer,
  p_projected_event_count integer,
  p_observation_digests jsonb,
  p_excluded_count integer,
  p_event_row_comparable boolean,
  p_has_continuation boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_root sellerpilot_private.channel_gateway_jobs%rowtype;
  v_parent_id uuid;
  v_depth integer := 0;
  v_scan_id uuid;
  v_existing_scan_id uuid;
  v_page_number integer;
  v_observation_count integer;
  v_new_count integer;
  v_repeated_count integer;
  v_totals record;
  v_scope_key text;
  v_ticket_kind text;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_missing jsonb;
begin
  if p_job_id is null or p_claim_token is null
     or p_provider_contract_version !~ '^sellerpilot-inquiry-coverage/[1-9][0-9]{0,5}$'
     or p_provider_row_count is null or p_provider_row_count not between 0 and 100000
     or p_projected_event_count is null or p_projected_event_count not between 0 and 100000
     or p_excluded_count is null or p_excluded_count not between 0 and 100000
     or p_event_row_comparable is null or p_has_continuation is null
     or jsonb_typeof(p_observation_digests) <> 'array'
     or jsonb_array_length(p_observation_digests) <> p_projected_event_count
     or jsonb_array_length(p_observation_digests) > 5000
     or exists (
       select 1 from jsonb_array_elements_text(p_observation_digests) digest
        where digest !~ '^[a-f0-9]{64}$'
     ) then
    raise exception 'CS_HISTORY_COVERAGE_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id = job.id and receipt.claim_token = p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = receipt.worker_token_id and token.token_hash = p_token_hash
   where job.id = p_job_id
     and job.operation = 'inquiries.list'
     and job.status = 'succeeded'
     and job.response_payload @> '{"ok":true,"operation":"inquiries.list"}'::jsonb
     and token.status = 'active' and token.expires_at > v_now;
  if not found then raise exception 'CS_HISTORY_COMPLETION_RECEIPT_REQUIRED'; end if;

  if coalesce(v_job.request_payload->>'periodicKey','') not like 'inquiries:history:%'
     and nullif(v_job.request_payload#>>'{arguments,sellerpilotHistoryRunId}','') is null then
    return jsonb_build_object('contract','cs_history_coverage_v1','status','ignored','jobId',p_job_id);
  end if;
  if (v_job.response_payload ? 'continuation') is distinct from p_has_continuation then
    raise exception 'CS_HISTORY_CONTINUATION_MISMATCH';
  end if;

  v_root := v_job;
  loop
    v_parent_id := nullif(v_root.request_payload->>'continuationOf','')::uuid;
    exit when v_parent_id is null;
    v_depth := v_depth + 1;
    if v_depth > 128 then raise exception 'CS_HISTORY_LINEAGE_DEPTH_INVALID'; end if;
    select parent.* into v_root
      from sellerpilot_private.channel_gateway_jobs parent
     where parent.id = v_parent_id
       and parent.created_by = v_job.created_by
       and parent.credential_id = v_job.credential_id
       and parent.channel = v_job.channel
       and parent.operation = 'inquiries.list';
    if not found then raise exception 'CS_HISTORY_PARENT_JOB_INVALID'; end if;
  end loop;

  v_scope_key := left(coalesce(nullif(v_root.request_payload->>'periodicKey',''),
    'inquiries:history:' || v_root.id::text), 200);
  v_ticket_kind := left(lower(coalesce(nullif(v_root.request_payload#>>'{arguments,kind}',''), 'conversation')), 80);
  if v_ticket_kind !~ '^[a-z0-9:_-]{1,80}$' then v_ticket_kind := 'conversation'; end if;
  begin
    v_range_start := coalesce(
      nullif(v_root.request_payload#>>'{arguments,query,inquiryStartAt}','')::date::timestamptz,
      nullif(v_root.request_payload#>>'{arguments,query,fromDate}','')::timestamptz,
      nullif(v_root.request_payload#>>'{arguments,query,startSearchDate}','')::date::timestamptz
    );
    v_range_end := coalesce(
      (nullif(v_root.request_payload#>>'{arguments,query,inquiryEndAt}','')::date + 1)::timestamptz - interval '1 microsecond',
      nullif(v_root.request_payload#>>'{arguments,query,toDate}','')::timestamptz,
      (nullif(v_root.request_payload#>>'{arguments,query,endSearchDate}','')::date + 1)::timestamptz - interval '1 microsecond'
    );
  exception when others then
    v_range_start := null; v_range_end := null;
  end;
  if (v_range_start is null) <> (v_range_end is null) then
    v_range_start := null; v_range_end := null;
  end if;

  insert into sellerpilot_private.cs_history_scans(
    root_job_id,owner_id,credential_id,channel,environment,scope_key,scope_digest,
    ticket_kind,provider_contract_version,timezone_name,range_start_at,range_end_at,started_at
  ) values (
    v_root.id,v_job.created_by,v_job.credential_id,v_job.channel,v_job.environment,v_scope_key,
    encode(extensions.digest(convert_to(v_root.request_payload::text,'UTF8'),'sha256'),'hex'),
    v_ticket_kind,p_provider_contract_version,
    case when v_job.channel in ('coupang','smartstore','qoo10','elevenst') then 'Asia/Seoul' else 'UTC' end,
    v_range_start,v_range_end,coalesce(v_root.started_at,v_root.created_at)
  ) on conflict (root_job_id) do update set
    provider_contract_version = excluded.provider_contract_version,
    updated_at = v_now
  returning id into v_scan_id;

  select scan_id into v_existing_scan_id
    from sellerpilot_private.cs_history_scan_pages where job_id = p_job_id;
  if found then
    return jsonb_build_object('contract','cs_history_coverage_v1','status','duplicate','scanId',v_existing_scan_id,'jobId',p_job_id);
  end if;

  select coalesce(max(page_number),0) + 1 into v_page_number
    from sellerpilot_private.cs_history_scan_pages where scan_id = v_scan_id;
  select jsonb_array_length(p_observation_digests) into v_observation_count;
  with inserted as (
    insert into sellerpilot_private.cs_history_scan_observations(
      scan_id,observation_digest,first_job_id,first_observed_at
    )
    select v_scan_id,digest,p_job_id,coalesce(v_job.completed_at,v_now)
      from jsonb_array_elements_text(p_observation_digests) digest
    on conflict do nothing returning 1
  ) select count(*)::integer into v_new_count from inserted;
  v_repeated_count := v_observation_count - v_new_count;

  insert into sellerpilot_private.cs_history_scan_pages(
    job_id,scan_id,page_number,provider_row_count,projected_event_count,
    new_observation_count,repeated_observation_count,excluded_count,
    event_row_comparable,continuation_expected,observed_at
  ) values (
    p_job_id,v_scan_id,v_page_number,p_provider_row_count,p_projected_event_count,
    v_new_count,v_repeated_count,p_excluded_count,p_event_row_comparable,
    p_has_continuation,coalesce(v_job.completed_at,v_now)
  );

  select count(*)::integer page_count,
         sum(provider_row_count)::integer provider_rows,
         sum(projected_event_count)::integer projected_events,
         sum(repeated_observation_count)::integer repeats,
         sum(excluded_count)::integer exclusions,
         bool_and(event_row_comparable) comparable
    into v_totals
    from sellerpilot_private.cs_history_scan_pages where scan_id = v_scan_id;

  if p_has_continuation then
    v_status := 'running'; v_missing := '[]'::jsonb;
  elsif not v_totals.comparable then
    v_status := 'reconciliation_required';
    v_missing := jsonb_build_array(jsonb_build_object(
      'reason','provider_rows_and_projected_events_not_one_to_one',
      'scopeKey',v_scope_key
    ));
  elsif v_totals.provider_rows <> v_totals.projected_events + v_totals.exclusions then
    v_status := 'reconciliation_required';
    v_missing := jsonb_build_array(jsonb_build_object(
      'reason','provider_projection_count_mismatch',
      'providerRows',v_totals.provider_rows,
      'projectedEvents',v_totals.projected_events,
      'excluded',v_totals.exclusions
    ));
  else
    v_status := 'completed'; v_missing := '[]'::jsonb;
  end if;

  update sellerpilot_private.cs_history_scans scan set
    status=v_status,
    page_count=v_totals.page_count,
    provider_row_count=v_totals.provider_rows,
    projected_event_count=v_totals.projected_events,
    observed_unique_count=(select count(*)::integer from sellerpilot_private.cs_history_scan_observations o where o.scan_id=v_scan_id),
    repeated_observation_count=v_totals.repeats,
    excluded_count=v_totals.exclusions,
    unprocessed_count=case when not p_has_continuation and v_totals.comparable
      then greatest(0,v_totals.provider_rows-v_totals.projected_events-v_totals.exclusions) else null end,
    missing_ranges=v_missing,
    scan_completed_at=case when p_has_continuation then null else coalesce(v_job.completed_at,v_now) end,
    reconciled_at=case when v_status='completed' then v_now else null end,
    updated_at=v_now
   where scan.id=v_scan_id;

  return jsonb_build_object(
    'contract','cs_history_coverage_v1','status',v_status,'scanId',v_scan_id,
    'jobId',p_job_id,'pageNumber',v_page_number
  );
end
$$;

revoke all on function public.sellerpilot_service_record_cs_history_page_v1(
  text,uuid,uuid,text,integer,integer,jsonb,integer,boolean,boolean
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_cs_history_page_v1(
  text,uuid,uuid,text,integer,integer,jsonb,integer,boolean,boolean
) to service_role;

create function public.sellerpilot_read_cs_history_coverage_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'contract','cs_history_coverage_read_v1',
    'checkedAt',statement_timestamp(),
    'scans',coalesce(jsonb_agg(jsonb_build_object(
      'scanId',id,'channel',channel,'environment',environment,'scopeKey',scope_key,
      'ticketKind',ticket_kind,'status',status,'rangeStartAt',range_start_at,
      'rangeEndAt',range_end_at,'timezone',timezone_name,'pageCount',page_count,
      'providerRowCount',provider_row_count,'projectedEventCount',projected_event_count,
      'observedUniqueCount',observed_unique_count,'repeatedObservationCount',repeated_observation_count,
      'excludedCount',excluded_count,'unprocessedCount',unprocessed_count,'missingRanges',missing_ranges,
      'startedAt',started_at,'scanCompletedAt',scan_completed_at,'reconciledAt',reconciled_at,
      'updatedAt',updated_at
    ) order by updated_at desc,id desc) filter (where id is not null),'[]'::jsonb),
    'gaps',(select coalesce(jsonb_agg(jsonb_build_object(
      'jobId',job_id,'channel',channel,'environment',environment,'scopeKey',scope_key,
      'terminalStatus',terminal_status,'firstObservedAt',first_observed_at,
      'lastObservedAt',last_observed_at,'resolvedAt',resolved_at
    ) order by last_observed_at desc,job_id desc),'[]'::jsonb)
      from (select * from sellerpilot_private.cs_history_scan_gaps
        order by last_observed_at desc,job_id desc limit 100) recent_gap)
  ) into v_result
  from (select * from sellerpilot_private.cs_history_scans order by updated_at desc,id desc limit 100) scan;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_read_cs_history_coverage_v1()
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_cs_history_coverage_v1()
  to authenticated;

commit;
