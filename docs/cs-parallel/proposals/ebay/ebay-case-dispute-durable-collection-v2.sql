begin;

do $migration$
begin
  if pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_collection_scopes') is not null
     or pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_collection_runs') is not null
     or pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_collection_seen') is not null
     or pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_collection_pages') is not null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2(jsonb)') is not null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2(text,uuid,uuid,jsonb,jsonb)') is not null then
    raise exception 'EBAY_CASE_DISPUTE_DURABLE_COLLECTION_SOURCE_DRIFT';
  end if;
  if pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or pg_catalog.to_regclass('sellerpilot_private.ai_cli_worker_tokens') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_record_ebay_case_dispute_history_v1(uuid,text,text,text,text,timestamptz,jsonb)') is null then
    raise exception 'EBAY_CASE_DISPUTE_DURABLE_COLLECTION_DEPENDENCY_MISSING';
  end if;
end
$migration$;

create table sellerpilot_private.ebay_case_dispute_collection_scopes (
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null check (seller_account_key ~ '^[0-9a-f]{64}$'),
  availability text not null default 'active' check (
    availability in ('active','authorization_required','not_available_or_not_found')
  ),
  blocked_http_status integer check (blocked_http_status is null or blocked_http_status in (401,403,404)),
  initial_root_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete set null,
  initial_anchor_at timestamptz,
  initial_completed_at timestamptz,
  last_observed_at timestamptz,
  last_http_status integer check (last_http_status is null or last_http_status between 100 and 599),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (credential_id, resource_kind),
  check (
    (availability = 'active' and blocked_http_status is null)
    or (availability = 'authorization_required' and blocked_http_status in (401,403))
    or (availability = 'not_available_or_not_found' and blocked_http_status = 404)
  ),
  check (resource_kind = 'resolution_case' or (
    initial_root_job_id is null and initial_anchor_at is null and initial_completed_at is null
  ))
);

create table sellerpilot_private.ebay_case_dispute_collection_runs (
  root_job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null check (seller_account_key ~ '^[0-9a-f]{64}$'),
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  collection_kind text not null check (collection_kind in ('initial_backfill','recent_overlap','periodic_summary')),
  collection_anchor timestamptz not null,
  plan_key text not null check (plan_key ~ '^ebay-cdh:[irp]:[0-9]{17}(:[0-9]{17})?$'),
  root_arguments_sha256 text not null check (root_arguments_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table sellerpilot_private.ebay_case_dispute_collection_seen (
  root_job_id uuid not null references sellerpilot_private.ebay_case_dispute_collection_runs(root_job_id) on delete cascade,
  page_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  native_id_sha256 text not null check (native_id_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (root_job_id, native_id_sha256)
);

create table sellerpilot_private.ebay_case_dispute_collection_pages (
  job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  root_job_id uuid not null references sellerpilot_private.ebay_case_dispute_collection_runs(root_job_id) on delete cascade,
  parent_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null check (seller_account_key ~ '^[0-9a-f]{64}$'),
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  collection_kind text not null check (collection_kind in ('initial_backfill','recent_overlap','periodic_summary')),
  collection_anchor timestamptz not null,
  page_number integer not null check (page_number > 0),
  start_time timestamptz,
  end_time timestamptz,
  remaining_window_count integer not null check (remaining_window_count between 0 and 24),
  has_continuation boolean not null,
  provider_has_next boolean not null,
  request_arguments_sha256 text not null check (request_arguments_sha256 ~ '^[0-9a-f]{64}$'),
  next_arguments_sha256 text check (next_arguments_sha256 is null or next_arguments_sha256 ~ '^[0-9a-f]{64}$'),
  page_sha256 text not null check (page_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((resource_kind = 'resolution_case') = (start_time is not null and end_time is not null)),
  unique (root_job_id, parent_job_id)
);

alter table sellerpilot_private.ebay_case_dispute_collection_scopes enable row level security;
alter table sellerpilot_private.ebay_case_dispute_collection_runs enable row level security;
alter table sellerpilot_private.ebay_case_dispute_collection_seen enable row level security;
alter table sellerpilot_private.ebay_case_dispute_collection_pages enable row level security;
revoke all on sellerpilot_private.ebay_case_dispute_collection_scopes from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.ebay_case_dispute_collection_runs from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.ebay_case_dispute_collection_seen from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.ebay_case_dispute_collection_pages from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2(
  p_plan jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_anchor timestamptz;
  v_job jsonb;
  v_arguments jsonb;
  v_resource text;
  v_collection text;
  v_scope sellerpilot_private.ebay_case_dispute_collection_scopes%rowtype;
  v_enqueue jsonb;
  v_status text;
  v_job_id uuid;
  v_attempted integer := 0;
  v_queued integer := 0;
  v_pending integer := 0;
  v_scope_blocked integer := 0;
  v_deferred integer := 0;
  v_initial_active boolean := false;
  v_initial_complete boolean := false;
  v_lineage_valid boolean := false;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_previous_end timestamptz;
  v_window jsonb;
  v_window_count integer := 0;
  v_root_arguments_sha256 text;
begin
  if pg_catalog.jsonb_typeof(p_plan) <> 'object'
     or pg_catalog.octet_length(p_plan::text) > 16000
     or p_plan->>'contract' is distinct from 'sellerpilot-ebay-case-dispute-collection-plan/1'
     or pg_catalog.jsonb_typeof(p_plan->'jobs') <> 'array'
     or pg_catalog.jsonb_array_length(p_plan->'jobs') <> 3
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_plan) key_name(value)
        where key_name.value not in ('contract','anchorAt','jobs')
     ) then
    raise exception 'EBAY_CASE_DISPUTE_COLLECTION_PLAN_INVALID' using errcode = '22023';
  end if;
  begin
    v_anchor := (p_plan->>'anchorAt')::timestamptz;
  exception when others then
    raise exception 'EBAY_CASE_DISPUTE_COLLECTION_PLAN_INVALID' using errcode = '22023';
  end;
  if v_anchor is null or v_anchor <> pg_catalog.date_trunc('hour', v_anchor) then
    raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ANCHOR_INVALID' using errcode = '22023';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_plan->'jobs') job
       where job#>>'{arguments,resourceKind}' = 'resolution_case'
         and job#>>'{arguments,collectionKind}' = 'initial_backfill') <> 1
     or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_plan->'jobs') job
       where job#>>'{arguments,resourceKind}' = 'resolution_case'
         and job#>>'{arguments,collectionKind}' = 'recent_overlap') <> 1
     or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_plan->'jobs') job
       where job#>>'{arguments,resourceKind}' = 'payment_dispute'
         and job#>>'{arguments,collectionKind}' = 'periodic_summary') <> 1 then
    raise exception 'EBAY_CASE_DISPUTE_COLLECTION_JOB_SET_INVALID' using errcode = '22023';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'ebay'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > pg_catalog.clock_timestamp())
     and credential.seller_account_key ~ '^[0-9a-f]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.created_by is not null
   order by credential.version desc, credential.created_at desc, credential.id
   limit 1
   for share;
  if not found then
    return pg_catalog.jsonb_build_object(
      'contract','sellerpilot-ebay-case-dispute-collection-enqueue/1',
      'anchorAt',p_plan->>'anchorAt','attempted',0,'queued',0,'pending',0,
      'scopeBlocked',0,'deferred',3,'status','not_connected'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:ebay-case-dispute-collection:' || v_credential.id::text
  ));
  foreach v_resource in array array['resolution_case','payment_dispute'] loop
    insert into sellerpilot_private.ebay_case_dispute_collection_scopes (
      credential_id, resource_kind, owner_user_id, credential_version, seller_account_key
    ) values (
      v_credential.id, v_resource, v_credential.created_by,
      v_credential.version, v_credential.seller_account_key
    )
    on conflict (credential_id,resource_kind) do update set
      owner_user_id = excluded.owner_user_id,
      credential_version = excluded.credential_version,
      seller_account_key = excluded.seller_account_key,
      availability = case
        when sellerpilot_private.ebay_case_dispute_collection_scopes.credential_version <> excluded.credential_version
          or sellerpilot_private.ebay_case_dispute_collection_scopes.seller_account_key <> excluded.seller_account_key
          then 'active'
        else sellerpilot_private.ebay_case_dispute_collection_scopes.availability
      end,
      blocked_http_status = case
        when sellerpilot_private.ebay_case_dispute_collection_scopes.credential_version <> excluded.credential_version
          or sellerpilot_private.ebay_case_dispute_collection_scopes.seller_account_key <> excluded.seller_account_key
          then null
        else sellerpilot_private.ebay_case_dispute_collection_scopes.blocked_http_status
      end,
      initial_root_job_id = case
        when sellerpilot_private.ebay_case_dispute_collection_scopes.credential_version <> excluded.credential_version
          or sellerpilot_private.ebay_case_dispute_collection_scopes.seller_account_key <> excluded.seller_account_key
          then null
        else sellerpilot_private.ebay_case_dispute_collection_scopes.initial_root_job_id
      end,
      initial_anchor_at = case
        when sellerpilot_private.ebay_case_dispute_collection_scopes.credential_version <> excluded.credential_version
          or sellerpilot_private.ebay_case_dispute_collection_scopes.seller_account_key <> excluded.seller_account_key
          then null
        else sellerpilot_private.ebay_case_dispute_collection_scopes.initial_anchor_at
      end,
      initial_completed_at = case
        when sellerpilot_private.ebay_case_dispute_collection_scopes.credential_version <> excluded.credential_version
          or sellerpilot_private.ebay_case_dispute_collection_scopes.seller_account_key <> excluded.seller_account_key
          then null
        else sellerpilot_private.ebay_case_dispute_collection_scopes.initial_completed_at
      end,
      updated_at = pg_catalog.clock_timestamp();
  end loop;

  select scope.* into v_scope
    from sellerpilot_private.ebay_case_dispute_collection_scopes scope
   where scope.credential_id = v_credential.id and scope.resource_kind = 'resolution_case'
   for update;
  if v_scope.initial_root_job_id is not null and v_scope.initial_completed_at is null then
    with recursive lineage as (
      select job.id, job.status, job.request_payload, job.response_payload, 0 depth
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = v_scope.initial_root_job_id
      union all
      select child.id, child.status, child.request_payload, child.response_payload, parent.depth + 1
        from sellerpilot_private.channel_gateway_jobs child
        join lineage parent on child.request_payload->>'continuationOf' = parent.id::text
       where child.credential_id = v_credential.id
         and child.channel = 'ebay' and child.operation = 'inquiries.list'
         and parent.depth < 8192
    ), verified as (
      select lineage.id,lineage.status,lineage.request_payload,lineage.response_payload,lineage.depth,
             page.parent_job_id,page.has_continuation,page.provider_has_next,page.remaining_window_count
        from lineage
        join sellerpilot_private.ebay_case_dispute_collection_pages page on page.job_id=lineage.id
       where page.root_job_id=v_scope.initial_root_job_id
         and page.credential_id=v_credential.id
         and page.credential_version=v_credential.version
         and page.seller_account_key=v_credential.seller_account_key
         and page.resource_kind='resolution_case'
         and page.collection_kind='initial_backfill'
         and page.collection_anchor=v_scope.initial_anchor_at
    ), chain as (
      select verified.*,1 verified_count
        from verified
       where verified.id=v_scope.initial_root_job_id
         and verified.parent_job_id is null
      union all
      select child.*,parent.verified_count+1
        from verified child
        join chain parent on child.parent_job_id=parent.id
       where child.depth=parent.depth+1 and parent.has_continuation
    )
    select
      exists(select 1 from lineage where status in ('queued','running')),
      exists(
        select 1 from chain terminal
         where terminal.status='succeeded'
           and terminal.remaining_window_count=0
           and not terminal.provider_has_next
           and not terminal.has_continuation
           and (terminal.response_payload ? 'continuation') is false
           and not exists(select 1 from verified child where child.parent_job_id=terminal.id)
           and terminal.verified_count=(select pg_catalog.count(*) from verified)
           and terminal.verified_count=(select pg_catalog.count(*) from lineage)
      ),
      not exists(select 1 from lineage where depth>=8192)
      into v_initial_active,v_initial_complete,v_lineage_valid;
    if not v_lineage_valid then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_LINEAGE_DEPTH_INVALID';
    end if;
    if v_initial_complete then
      update sellerpilot_private.ebay_case_dispute_collection_scopes
         set initial_completed_at = coalesce(initial_completed_at,pg_catalog.clock_timestamp()),
             updated_at = pg_catalog.clock_timestamp()
       where credential_id = v_credential.id and resource_kind = 'resolution_case';
    end if;
  end if;

  for v_job in select value from pg_catalog.jsonb_array_elements(p_plan->'jobs') loop
    v_job_id := null;
    v_attempted := v_attempted + 1;
    if pg_catalog.jsonb_typeof(v_job) <> 'object'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_job) key_name(value)
          where key_name.value not in ('periodicKey','arguments')
       )
       or coalesce(v_job->>'periodicKey','') !~ '^ebay-cdh:[irp]:[0-9]{17}(:[0-9]{17})?$'
       or pg_catalog.jsonb_typeof(v_job->'arguments') <> 'object' then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_JOB_INVALID' using errcode = '22023';
    end if;
    v_arguments := v_job->'arguments';
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(v_arguments) key_name(value)
       where key_name.value not in (
         'kind','resourceKind','collectionKind','collectionAnchor','collectionRangeStart',
         'collectionRangeEnd','startTime','endTime','windowQueue','pageNumber','pageSize'
       )
    ) or v_arguments->>'kind' is distinct from 'case_dispute_history'
      or (v_arguments->>'collectionAnchor')::timestamptz is distinct from v_anchor
      or coalesce((v_arguments->>'pageNumber')::integer,0) <> 1
      or coalesce((v_arguments->>'pageSize')::integer,0) <> 25
      or pg_catalog.jsonb_typeof(v_arguments->'windowQueue') <> 'array' then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ARGUMENT_INVALID' using errcode = '22023';
    end if;
    v_resource := v_arguments->>'resourceKind';
    v_collection := v_arguments->>'collectionKind';
    if v_resource not in ('resolution_case','payment_dispute')
       or v_collection not in ('initial_backfill','recent_overlap','periodic_summary')
       or (v_resource = 'payment_dispute' and (
         v_collection <> 'periodic_summary'
         or v_arguments ? 'startTime' or v_arguments ? 'endTime'
         or v_arguments ? 'collectionRangeStart' or v_arguments ? 'collectionRangeEnd'
         or pg_catalog.jsonb_array_length(v_arguments->'windowQueue') <> 0
       ))
       or (v_resource = 'resolution_case' and v_collection = 'periodic_summary') then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_RESOURCE_INVALID' using errcode = '22023';
    end if;

    if v_resource = 'resolution_case' then
      if not (v_arguments ?& array['collectionRangeStart','collectionRangeEnd','startTime','endTime']) then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_RANGE_INVALID' using errcode = '22023';
      end if;
      begin
        v_current_start := (v_arguments->>'startTime')::timestamptz;
        v_current_end := (v_arguments->>'endTime')::timestamptz;
      exception when others then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_RANGE_INVALID' using errcode = '22023';
      end;
      if v_current_start >= v_current_end or v_current_end-v_current_start > interval '31 days'
         or (v_arguments->>'collectionRangeEnd')::timestamptz <> v_anchor then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_RANGE_INVALID' using errcode = '22023';
      end if;
      v_previous_end := v_current_end;
      v_window_count := 1;
      for v_window in select value from pg_catalog.jsonb_array_elements(v_arguments->'windowQueue') loop
        v_window_count := v_window_count + 1;
        if pg_catalog.jsonb_typeof(v_window) <> 'object'
           or exists (
             select 1 from pg_catalog.jsonb_object_keys(v_window) key_name(value)
              where key_name.value not in ('startTime','endTime')
           )
           or (v_window->>'startTime')::timestamptz <> v_previous_end + interval '1 millisecond'
           or (v_window->>'endTime')::timestamptz <= (v_window->>'startTime')::timestamptz
           or (v_window->>'endTime')::timestamptz - (v_window->>'startTime')::timestamptz > interval '31 days' then
          raise exception 'EBAY_CASE_DISPUTE_COLLECTION_WINDOWS_INVALID' using errcode = '22023';
        end if;
        v_previous_end := (v_window->>'endTime')::timestamptz;
      end loop;
      if v_previous_end <> v_anchor then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_WINDOWS_INVALID' using errcode = '22023';
      end if;
      if v_collection = 'initial_backfill' and (
        (v_arguments->>'collectionRangeStart')::timestamptz <> v_anchor - interval '18 months'
        or v_current_start <> v_anchor - interval '18 months'
        or v_window_count not between 18 and 24
      ) then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_INITIAL_RANGE_INVALID' using errcode = '22023';
      end if;
      if v_collection = 'recent_overlap' and (
        v_current_start <> v_anchor - interval '48 hours'
        or (v_arguments->>'collectionRangeStart')::timestamptz <> v_current_start
        or pg_catalog.jsonb_array_length(v_arguments->'windowQueue') <> 0
      ) then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_OVERLAP_INVALID' using errcode = '22023';
      end if;
    end if;
    if v_job->>'periodicKey' is distinct from (case
      when v_collection = 'initial_backfill' then
        'ebay-cdh:i:' || pg_catalog.to_char(v_current_start at time zone 'UTC','YYYYMMDDHH24MISSMS')
        || ':' || pg_catalog.to_char(v_anchor at time zone 'UTC','YYYYMMDDHH24MISSMS')
      when v_collection = 'recent_overlap' then
        'ebay-cdh:r:' || pg_catalog.to_char(v_anchor at time zone 'UTC','YYYYMMDDHH24MISSMS')
      else
        'ebay-cdh:p:' || pg_catalog.to_char(v_anchor at time zone 'UTC','YYYYMMDDHH24MISSMS')
    end) then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_PERIODIC_KEY_INVALID' using errcode = '22023';
    end if;

    select scope.* into v_scope
      from sellerpilot_private.ebay_case_dispute_collection_scopes scope
     where scope.credential_id = v_credential.id and scope.resource_kind = v_resource
     for update;
    if v_scope.availability <> 'active' then
      v_scope_blocked := v_scope_blocked + 1;
      continue;
    end if;
    if v_collection = 'recent_overlap' and v_scope.initial_completed_at is null then
      v_deferred := v_deferred + 1;
      continue;
    end if;
    if v_collection = 'initial_backfill' then
      if v_scope.initial_completed_at is not null or v_initial_complete or v_initial_active then
        v_deferred := v_deferred + 1;
        continue;
      end if;
    end if;

    v_enqueue := public.sellerpilot_service_enqueue_periodic_sync(
      'ebay','inquiries.list',v_job,60
    );
    v_status := v_enqueue->>'status';
    if v_status = 'queued' then
      v_queued := v_queued + 1;
    elsif v_status = 'already_pending' then
      v_pending := v_pending + 1;
    else
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ENQUEUE_UNAVAILABLE:%',coalesce(v_status,'invalid');
    end if;
    begin
      v_job_id := (v_enqueue->>'jobId')::uuid;
    exception when others then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ROOT_JOB_INVALID';
    end;
    if v_job_id is null then raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ROOT_JOB_INVALID'; end if;
    update sellerpilot_private.channel_gateway_jobs job
       set request_payload=pg_catalog.jsonb_set(
         pg_catalog.jsonb_set(
           job.request_payload,'{arguments,collectionRootJobId}',pg_catalog.to_jsonb(v_job_id::text),true
         ),'{arguments,collectionPlanKey}',v_job->'periodicKey',true
       ),updated_at=pg_catalog.clock_timestamp()
     where job.id=v_job_id and job.credential_id=v_credential.id
       and job.channel='ebay' and job.operation='inquiries.list'
       and job.status='queued' and job.attempt_count=0
       and job.worker_token_id is null and job.claim_token is null and job.lease_expires_at is null
         and (job.request_payload#>>'{arguments,collectionRootJobId}' is null
           or job.request_payload#>>'{arguments,collectionRootJobId}'=v_job_id::text)
         and (job.request_payload#>>'{arguments,collectionPlanKey}' is null
           or job.request_payload#>>'{arguments,collectionPlanKey}'=v_job->>'periodicKey');
    if not found and not exists(
      select 1 from sellerpilot_private.channel_gateway_jobs job
       where job.id=v_job_id and job.credential_id=v_credential.id
         and job.request_payload#>>'{arguments,collectionRootJobId}'=v_job_id::text
         and job.request_payload#>>'{arguments,collectionPlanKey}'=v_job->>'periodicKey'
    ) then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ROOT_BIND_FAILED';
    end if;
    select pg_catalog.encode(extensions.digest((job.request_payload->'arguments')::text,'sha256'),'hex')
      into v_root_arguments_sha256
      from sellerpilot_private.channel_gateway_jobs job
     where job.id=v_job_id and job.credential_id=v_credential.id;
    if v_root_arguments_sha256 is null then raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ROOT_HASH_FAILED'; end if;
    insert into sellerpilot_private.ebay_case_dispute_collection_runs(
      root_job_id,credential_id,credential_version,seller_account_key,resource_kind,
      collection_kind,collection_anchor,plan_key,root_arguments_sha256
    ) values(
      v_job_id,v_credential.id,v_credential.version,v_credential.seller_account_key,
      v_resource,v_collection,v_anchor,v_job->>'periodicKey',v_root_arguments_sha256
    ) on conflict(root_job_id) do nothing;
    if not exists(
      select 1 from sellerpilot_private.ebay_case_dispute_collection_runs run
       where run.root_job_id=v_job_id and run.credential_id=v_credential.id
         and run.credential_version=v_credential.version
         and run.seller_account_key=v_credential.seller_account_key
         and run.resource_kind=v_resource and run.collection_kind=v_collection
         and run.collection_anchor=v_anchor and run.plan_key=v_job->>'periodicKey'
         and run.root_arguments_sha256=v_root_arguments_sha256
    ) then
      raise exception 'EBAY_CASE_DISPUTE_COLLECTION_RUN_BIND_FAILED';
    end if;
    if v_collection = 'initial_backfill' then
      update sellerpilot_private.ebay_case_dispute_collection_scopes
         set initial_root_job_id = v_job_id,
             initial_anchor_at = v_anchor,
             updated_at = pg_catalog.clock_timestamp()
       where credential_id = v_credential.id and resource_kind = 'resolution_case';
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot-ebay-case-dispute-collection-enqueue/1',
    'anchorAt',p_plan->>'anchorAt','attempted',v_attempted,'queued',v_queued,
    'pending',v_pending,'scopeBlocked',v_scope_blocked,'deferred',v_deferred,
    'status','accepted'
  );
end
$function$;

create function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_page jsonb,
  p_continuation_arguments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_token_id uuid;
  v_root_job_id uuid;
  v_parent_job_id uuid;
  v_arguments jsonb;
  v_resource text;
  v_collection text;
  v_page jsonb;
  v_availability text;
  v_http_status integer;
  v_offset integer;
  v_next_offset integer;
  v_page_number integer;
  v_entry jsonb;
  v_native_id text;
  v_native_hash text;
  v_seen_job_id uuid;
  v_parent_page sellerpilot_private.ebay_case_dispute_collection_pages%rowtype;
  v_request_arguments_sha256 text;
  v_next_arguments_sha256 text;
  v_page_sha256 text;
  v_expected_arguments jsonb;
  v_expected_queue jsonb;
  v_current_depth integer;
  v_current_epoch integer;
  v_expected_depth integer;
  v_expected_epoch integer;
  v_current_trail_length integer;
  v_next_trail_length integer;
  v_next_digest text;
  v_trail_index integer;
  v_provider_has_next boolean;
  v_has_continuation boolean;
  v_remaining_window_count integer;
  v_receipt jsonb;
  v_observed integer := 0;
  v_inserted integer := 0;
  v_status text := 'deferred';
begin
  if p_job_id is null or p_claim_token is null or coalesce(p_token_hash,'') = ''
     or pg_catalog.jsonb_typeof(p_page) <> 'object'
     or pg_catalog.octet_length(p_page::text) > 64000
     or (p_continuation_arguments is not null and (
       pg_catalog.jsonb_typeof(p_continuation_arguments) is distinct from 'object'
       or pg_catalog.octet_length(p_continuation_arguments::text) > 64000
     ))
     or p_page->>'contract' is distinct from 'sellerpilot-ebay-case-dispute-gateway-page/1'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_page) key_name(value)
        where key_name.value not in ('contract','resourceKind','collectionKind','page')
     ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGE_INVALID' using errcode = '22023';
  end if;
  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash and token.status = 'active'
     and token.expires_at > pg_catalog.clock_timestamp();
  if v_token_id is null then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_TOKEN_INVALID' using errcode = '42501'; end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential on credential.id = job.credential_id
   where job.id = p_job_id
     and job.channel = 'ebay' and job.operation = 'inquiries.list'
     and job.status = 'running' and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > pg_catalog.clock_timestamp())
     and credential.version > 0
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_key ~ '^[0-9a-f]{64}$'
     and credential.seller_account_key = job.seller_account_key
   for share of job;
  if not found then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CLAIM_INVALID' using errcode = '55000'; end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > pg_catalog.clock_timestamp())
     and credential.version > 0
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_key ~ '^[0-9a-f]{64}$'
     and credential.seller_account_key = v_job.seller_account_key
   for share;
  if not found then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CREDENTIAL_INVALID' using errcode = '55000'; end if;

  v_arguments := v_job.request_payload->'arguments';
  v_resource := v_arguments->>'resourceKind';
  v_collection := v_arguments->>'collectionKind';
  v_page := p_page->'page';
  if v_arguments->>'kind' is distinct from 'case_dispute_history'
     or v_resource not in ('resolution_case','payment_dispute')
     or coalesce(v_arguments->>'collectionRootJobId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_page->>'resourceKind' is distinct from v_resource
     or p_page->>'collectionKind' is distinct from v_collection
     or pg_catalog.jsonb_typeof(v_page) <> 'object'
     or pg_catalog.jsonb_typeof(v_page->'entries') <> 'array'
     or pg_catalog.jsonb_array_length(v_page->'entries') > 25 then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_BINDING_INVALID' using errcode = '22023';
  end if;
  if exists(
    select 1 from pg_catalog.jsonb_object_keys(v_arguments) key_name(value)
     where key_name.value not in (
       'kind','resourceKind','collectionKind','collectionAnchor','collectionRangeStart',
       'collectionRangeEnd','startTime','endTime','windowQueue','pageNumber','pageSize',
       'marketplaceId','collectionRootJobId','collectionPlanKey','sellerpilotPaginationDepth',
       'sellerpilotPaginationEpoch','sellerpilotPaginationTrail'
     )
  ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_ARGUMENT_SHAPE_INVALID' using errcode='22023';
  end if;
  if (v_arguments ? 'sellerpilotPaginationDepth'
      or v_arguments ? 'sellerpilotPaginationEpoch'
      or v_arguments ? 'sellerpilotPaginationTrail')
     and not (v_arguments ?& array[
       'sellerpilotPaginationDepth','sellerpilotPaginationEpoch','sellerpilotPaginationTrail'
     ]) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGINATION_STATE_INVALID' using errcode='22023';
  end if;
  if v_arguments ? 'sellerpilotPaginationDepth' then
    if pg_catalog.jsonb_typeof(v_arguments->'sellerpilotPaginationTrail') is distinct from 'array' then
      raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGINATION_STATE_INVALID' using errcode='22023';
    end if;
    begin
      v_current_depth := (v_arguments->>'sellerpilotPaginationDepth')::integer;
      v_current_epoch := (v_arguments->>'sellerpilotPaginationEpoch')::integer;
      v_current_trail_length := pg_catalog.jsonb_array_length(v_arguments->'sellerpilotPaginationTrail');
    exception when others then
      raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGINATION_STATE_INVALID' using errcode='22023';
    end;
    if v_current_depth not between 1 and 50 or v_current_epoch not between 0 and 99
       or v_current_trail_length not between 1 and 50
       or exists(
         select 1 from pg_catalog.jsonb_array_elements_text(v_arguments->'sellerpilotPaginationTrail') digest
          where digest !~ '^[a-f0-9]{64}$'
       ) or (
         select pg_catalog.count(*) <> pg_catalog.count(distinct digest)
           from pg_catalog.jsonb_array_elements_text(v_arguments->'sellerpilotPaginationTrail') digest
       ) then
      raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGINATION_STATE_INVALID' using errcode='22023';
    end if;
  else
    v_current_depth := 0;
    v_current_epoch := 0;
    v_current_trail_length := 0;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(v_page) key_name(value)
     where key_name.value not in (
       'availability','httpStatus','entries','total','offset','nextOffset','startTime','endTime'
     )
  ) or not (v_page ?& array['availability','httpStatus','entries','total','offset','nextOffset'])
    or (v_resource = 'resolution_case' and not (v_page ?& array['startTime','endTime']))
    or (v_resource = 'payment_dispute' and (v_page ? 'startTime' or v_page ? 'endTime')) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGE_SHAPE_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from sellerpilot_private.ebay_case_dispute_collection_scopes scope
     where scope.credential_id = v_credential.id
       and scope.resource_kind = v_resource
       and scope.credential_version = v_credential.version
       and scope.seller_account_key = v_credential.seller_account_key
  ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_SCOPE_INVALID' using errcode = '55000';
  end if;
  v_page_number := (v_arguments->>'pageNumber')::integer;
  v_offset := (v_page->>'offset')::integer;
  v_next_offset := nullif(v_page->>'nextOffset','')::integer;
  v_availability := v_page->>'availability';
  v_http_status := nullif(v_page->>'httpStatus','')::integer;
  v_provider_has_next := v_next_offset is not null;
  v_has_continuation := p_continuation_arguments is not null;
  v_remaining_window_count := pg_catalog.jsonb_array_length(v_arguments->'windowQueue');
  if v_page_number < 1 or (v_arguments->>'pageSize')::integer <> 25
     or v_offset <> (v_page_number - 1) * 25
     or (v_next_offset is not null and v_next_offset <> v_offset + 25)
     or v_availability not in (
       'readable','authorization_required','not_available_or_not_found',
       'rate_limited','provider_unverified','sandbox_unsupported'
     ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CURSOR_INVALID' using errcode = '22023';
  end if;
  if v_resource = 'resolution_case' and (
    (v_page->>'startTime')::timestamptz is distinct from (v_arguments->>'startTime')::timestamptz
    or (v_page->>'endTime')::timestamptz is distinct from (v_arguments->>'endTime')::timestamptz
  ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_RANGE_MISMATCH' using errcode = '22023';
  end if;
  if v_availability='readable' then
    if v_provider_has_next then
      v_expected_arguments := pg_catalog.jsonb_set(v_arguments,'{pageNumber}',pg_catalog.to_jsonb(v_page_number+1),false);
    elsif v_resource='resolution_case' and v_remaining_window_count>0 then
      v_expected_queue := (v_arguments->'windowQueue') - 0;
      v_expected_arguments := v_arguments
        || pg_catalog.jsonb_build_object(
          'startTime',v_arguments#>>'{windowQueue,0,startTime}',
          'endTime',v_arguments#>>'{windowQueue,0,endTime}',
          'windowQueue',v_expected_queue,
          'pageNumber',1
        );
    else
      v_expected_arguments := null;
    end if;
  else
    v_expected_arguments := null;
  end if;
  if (v_expected_arguments is null) <> (p_continuation_arguments is null) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_PRESENCE_INVALID';
  end if;
  if v_expected_arguments is not null then
    if not (p_continuation_arguments ?& array[
      'sellerpilotPaginationDepth','sellerpilotPaginationEpoch','sellerpilotPaginationTrail','collectionRootJobId'
    ]) or pg_catalog.jsonb_typeof(p_continuation_arguments->'sellerpilotPaginationTrail') is distinct from 'array'
       or p_continuation_arguments-'sellerpilotPaginationDepth'-'sellerpilotPaginationEpoch'-'sellerpilotPaginationTrail'
          is distinct from v_expected_arguments-'sellerpilotPaginationDepth'-'sellerpilotPaginationEpoch'-'sellerpilotPaginationTrail'
       or coalesce((p_continuation_arguments->>'sellerpilotPaginationDepth')::integer,0) not between 1 and 50
       or coalesce((p_continuation_arguments->>'sellerpilotPaginationEpoch')::integer,-1) not between 0 and 99
       or pg_catalog.jsonb_array_length(p_continuation_arguments->'sellerpilotPaginationTrail') not between 1 and 50
       or exists(select 1 from pg_catalog.jsonb_array_elements_text(p_continuation_arguments->'sellerpilotPaginationTrail') digest where digest !~ '^[a-f0-9]{64}$') then
      raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_INVALID';
    end if;
    v_expected_depth := case when v_current_depth >= 49 then 1 else v_current_depth + 1 end;
    v_expected_epoch := case when v_current_depth >= 49 then v_current_epoch + 1 else v_current_epoch end;
    v_next_trail_length := pg_catalog.jsonb_array_length(p_continuation_arguments->'sellerpilotPaginationTrail');
    v_next_digest := p_continuation_arguments#>>array[
      'sellerpilotPaginationTrail',(v_next_trail_length - 1)::text
    ];
    if v_expected_epoch > 99
       or (p_continuation_arguments->>'sellerpilotPaginationDepth')::integer <> v_expected_depth
       or (p_continuation_arguments->>'sellerpilotPaginationEpoch')::integer <> v_expected_epoch
       or v_next_trail_length <> least(v_current_trail_length + 1,50)
       or exists(
         select 1 from pg_catalog.jsonb_array_elements_text(v_arguments->'sellerpilotPaginationTrail') digest
          where digest = v_next_digest
       ) then
      raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_STATE_INVALID';
    end if;
    if v_current_trail_length < 50 then
      for v_trail_index in 0..v_current_trail_length-1 loop
        if p_continuation_arguments#>>array['sellerpilotPaginationTrail',v_trail_index::text]
           is distinct from v_arguments#>>array['sellerpilotPaginationTrail',v_trail_index::text] then
          raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_TRAIL_INVALID';
        end if;
      end loop;
    else
      for v_trail_index in 0..48 loop
        if p_continuation_arguments#>>array['sellerpilotPaginationTrail',v_trail_index::text]
           is distinct from v_arguments#>>array['sellerpilotPaginationTrail',(v_trail_index+1)::text] then
          raise exception 'EBAY_CASE_DISPUTE_GATEWAY_CONTINUATION_TRAIL_INVALID';
        end if;
      end loop;
    end if;
  end if;
  if v_availability = 'readable' then
    if v_http_status <> 200 then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_HTTP_INVALID'; end if;
  elsif pg_catalog.jsonb_array_length(v_page->'entries') <> 0
     or v_page->'total' <> 'null'::jsonb or v_page->'nextOffset' <> 'null'::jsonb then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_UNAVAILABLE_COUNT_INVALID';
  end if;

  v_root_job_id := (v_arguments->>'collectionRootJobId')::uuid;
  v_parent_job_id := nullif(v_job.request_payload->>'continuationOf','')::uuid;
  if not exists(
    select 1 from sellerpilot_private.ebay_case_dispute_collection_runs run
     where run.root_job_id=v_root_job_id and run.credential_id=v_credential.id
       and run.credential_version=v_credential.version
       and run.seller_account_key=v_credential.seller_account_key
       and run.resource_kind=v_resource and run.collection_kind=v_collection
       and run.collection_anchor=(v_arguments->>'collectionAnchor')::timestamptz
       and run.plan_key=v_arguments->>'collectionPlanKey'
  ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_RUN_INVALID' using errcode='55000';
  end if;
  if p_job_id=v_root_job_id then
    if v_parent_job_id is not null then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_ROOT_PARENT_INVALID'; end if;
  else
    if v_parent_job_id is null then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_ORPHAN_CHILD'; end if;
    select page.* into v_parent_page
      from sellerpilot_private.ebay_case_dispute_collection_pages page
     where page.job_id=v_parent_job_id and page.root_job_id=v_root_job_id
       and page.credential_id=v_credential.id and page.credential_version=v_credential.version
       and page.seller_account_key=v_credential.seller_account_key
       and page.resource_kind=v_resource and page.collection_kind=v_collection
       and page.collection_anchor=(v_arguments->>'collectionAnchor')::timestamptz
       and page.has_continuation;
    if not found then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PARENT_PAGE_INVALID'; end if;
  end if;
  v_request_arguments_sha256 := pg_catalog.encode(extensions.digest(v_arguments::text,'sha256'),'hex');
  if p_job_id=v_root_job_id and not exists(
    select 1 from sellerpilot_private.ebay_case_dispute_collection_runs run
     where run.root_job_id=v_root_job_id and run.root_arguments_sha256=v_request_arguments_sha256
  ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_ROOT_ARGUMENT_MISMATCH';
  end if;
  if v_parent_job_id is not null and v_parent_page.next_arguments_sha256 is distinct from v_request_arguments_sha256 then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PARENT_ARGUMENT_MISMATCH';
  end if;
  v_next_arguments_sha256 := case when p_continuation_arguments is null then null
    else pg_catalog.encode(extensions.digest(p_continuation_arguments::text,'sha256'),'hex') end;
  v_page_sha256 := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object('page',p_page,'continuationArguments',p_continuation_arguments)::text,'sha256'
  ),'hex');

  insert into sellerpilot_private.ebay_case_dispute_collection_pages(
    job_id,root_job_id,parent_job_id,credential_id,credential_version,seller_account_key,
    resource_kind,collection_kind,collection_anchor,page_number,start_time,end_time,
    remaining_window_count,has_continuation,provider_has_next,request_arguments_sha256,
    next_arguments_sha256,page_sha256
  ) values(
    p_job_id,v_root_job_id,v_parent_job_id,v_credential.id,v_credential.version,
    v_credential.seller_account_key,v_resource,v_collection,
    (v_arguments->>'collectionAnchor')::timestamptz,v_page_number,
    case when v_resource='resolution_case' then (v_arguments->>'startTime')::timestamptz else null end,
    case when v_resource='resolution_case' then (v_arguments->>'endTime')::timestamptz else null end,
    v_remaining_window_count,v_has_continuation,v_provider_has_next,
    v_request_arguments_sha256,v_next_arguments_sha256,v_page_sha256
  ) on conflict(job_id) do nothing;
  if not exists(
    select 1 from sellerpilot_private.ebay_case_dispute_collection_pages page
     where page.job_id=p_job_id and page.root_job_id=v_root_job_id
       and page.parent_job_id is not distinct from v_parent_job_id
       and page.credential_id=v_credential.id and page.credential_version=v_credential.version
       and page.seller_account_key=v_credential.seller_account_key
       and page.resource_kind=v_resource and page.collection_kind=v_collection
       and page.request_arguments_sha256=v_request_arguments_sha256
       and page.next_arguments_sha256 is not distinct from v_next_arguments_sha256
       and page.page_sha256=v_page_sha256
  ) then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PAGE_REPLAY_MISMATCH';
  end if;

  if v_availability = 'readable' then
    for v_entry in select value from pg_catalog.jsonb_array_elements(v_page->'entries') loop
      v_native_id := case when v_resource = 'resolution_case'
        then v_entry->>'caseId' else v_entry->>'paymentDisputeId' end;
      if coalesce(v_native_id,'') = '' or pg_catalog.length(v_native_id) > 240 then
        raise exception 'EBAY_CASE_DISPUTE_GATEWAY_NATIVE_ID_INVALID';
      end if;
      v_native_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'sellerpilot-ebay-case-dispute-seen/1' || pg_catalog.chr(31)
        || v_credential.seller_account_key || pg_catalog.chr(31)
        || v_resource || pg_catalog.chr(31) || v_native_id,'UTF8'
      ),'sha256'),'hex');
      select seen.page_job_id into v_seen_job_id
        from sellerpilot_private.ebay_case_dispute_collection_seen seen
       where seen.root_job_id = v_root_job_id and seen.native_id_sha256 = v_native_hash;
      if v_seen_job_id is not null and v_seen_job_id <> p_job_id then
        raise exception 'EBAY_CASE_DISPUTE_GATEWAY_DUPLICATE_NATIVE_ID';
      end if;
      insert into sellerpilot_private.ebay_case_dispute_collection_seen (
        root_job_id,page_job_id,resource_kind,native_id_sha256
      ) values (v_root_job_id,p_job_id,v_resource,v_native_hash)
      on conflict (root_job_id,native_id_sha256) do nothing;

      v_receipt := public.sellerpilot_service_record_ebay_case_dispute_history_v1(
        v_credential.id,
        v_credential.seller_account_key,
        v_resource,
        v_native_id,
        v_entry->>'status',
        case when v_resource = 'resolution_case'
          then (v_entry->>'lastModifiedDate')::timestamptz
          else coalesce(
            nullif(v_entry->>'closedDate',''),nullif(v_entry->>'respondByDate',''),v_entry->>'openDate'
          )::timestamptz
        end,
        v_entry
      );
      if v_receipt->>'contract' is distinct from 'sellerpilot-ebay-case-dispute-history-record/1'
         or v_receipt->>'resourceKind' is distinct from v_resource
         or v_receipt->>'providerNativeId' is distinct from v_native_id then
        raise exception 'EBAY_CASE_DISPUTE_GATEWAY_HISTORY_RECEIPT_INVALID';
      end if;
      v_observed := v_observed + 1;
      if (v_receipt->>'inserted')::boolean then v_inserted := v_inserted + 1; end if;
    end loop;
    update sellerpilot_private.ebay_case_dispute_collection_scopes
       set availability = 'active', blocked_http_status = null,
           last_observed_at = pg_catalog.clock_timestamp(), last_http_status = 200,
           updated_at = pg_catalog.clock_timestamp()
     where credential_id = v_credential.id and resource_kind = v_resource;
    v_status := 'recorded';
  elsif v_availability in ('authorization_required','not_available_or_not_found') then
    if (v_availability = 'authorization_required' and v_http_status not in (401,403))
       or (v_availability = 'not_available_or_not_found' and v_http_status <> 404) then
      raise exception 'EBAY_CASE_DISPUTE_GATEWAY_BLOCK_STATUS_INVALID';
    end if;
    update sellerpilot_private.ebay_case_dispute_collection_scopes
       set availability = v_availability, blocked_http_status = v_http_status,
           last_observed_at = pg_catalog.clock_timestamp(), last_http_status = v_http_status,
           updated_at = pg_catalog.clock_timestamp()
     where credential_id = v_credential.id and resource_kind = v_resource;
    update sellerpilot_private.channel_gateway_jobs sibling
       set status = 'cancelled', completed_at = pg_catalog.clock_timestamp(),
           updated_at = pg_catalog.clock_timestamp(),
           error_message = 'EBAY_CASE_DISPUTE_SCOPE_BLOCKED'
     where sibling.credential_id = v_credential.id
       and sibling.channel = 'ebay' and sibling.operation = 'inquiries.list'
       and sibling.status = 'queued' and sibling.attempt_count = 0
       and sibling.request_payload#>>'{arguments,kind}' = 'case_dispute_history'
       and sibling.request_payload#>>'{arguments,resourceKind}' = v_resource;
    v_status := case when v_availability = 'authorization_required'
      then 'authorization_blocked' else 'not_available_blocked' end;
  else
    v_status := 'deferred';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot-ebay-case-dispute-gateway-record/1',
    'jobId',p_job_id,'resourceKind',v_resource,'status',v_status,
    'observedCount',v_observed,'insertedCount',v_inserted
  );
end
$function$;

revoke all on function public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2(jsonb)
  to service_role;
revoke all on function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2(text,uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2(text,uuid,uuid,jsonb,jsonb)
  to service_role;

comment on table sellerpilot_private.ebay_case_dispute_collection_scopes is
  'Credential-version and resource-isolated GET collection availability; a 403 or 404 never blocks the other eBay resource.';
comment on function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v2(text,uuid,uuid,jsonb,jsonb) is
  'Records one claim-fenced GET-only normalized page before generic gateway completion; no dispute business action is accepted.';

commit;
