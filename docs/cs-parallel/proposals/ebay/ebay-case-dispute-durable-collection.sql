begin;

do $migration$
begin
  if pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_collection_scopes') is not null
     or pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_collection_seen') is not null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1(jsonb)') is not null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(text,uuid,uuid,jsonb)') is not null then
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

create table sellerpilot_private.ebay_case_dispute_collection_seen (
  root_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  page_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  native_id_sha256 text not null check (native_id_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (root_job_id, native_id_sha256)
);

alter table sellerpilot_private.ebay_case_dispute_collection_scopes enable row level security;
alter table sellerpilot_private.ebay_case_dispute_collection_seen enable row level security;
revoke all on sellerpilot_private.ebay_case_dispute_collection_scopes from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.ebay_case_dispute_collection_seen from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1(
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
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_previous_end timestamptz;
  v_window jsonb;
  v_window_count integer := 0;
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
      select job.id, job.status, job.request_payload, job.response_payload
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = v_scope.initial_root_job_id
      union all
      select child.id, child.status, child.request_payload, child.response_payload
        from sellerpilot_private.channel_gateway_jobs child
        join lineage parent on child.request_payload->>'continuationOf' = parent.id::text
       where child.credential_id = v_credential.id
         and child.channel = 'ebay' and child.operation = 'inquiries.list'
    )
    select
      coalesce(pg_catalog.bool_or(status in ('queued','running')),false),
      coalesce(pg_catalog.bool_or(
        status = 'succeeded'
        and request_payload#>>'{arguments,collectionKind}' = 'initial_backfill'
        and request_payload#>'{arguments,windowQueue}' = '[]'::jsonb
        and not coalesce(response_payload ? 'continuation',false)
      ),false)
      into v_initial_active,v_initial_complete
      from lineage;
    if v_initial_complete then
      update sellerpilot_private.ebay_case_dispute_collection_scopes
         set initial_completed_at = coalesce(initial_completed_at,pg_catalog.clock_timestamp()),
             updated_at = pg_catalog.clock_timestamp()
       where credential_id = v_credential.id and resource_kind = 'resolution_case';
    end if;
  end if;

  for v_job in select value from pg_catalog.jsonb_array_elements(p_plan->'jobs') loop
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
    if v_collection = 'initial_backfill' then
      begin
        v_job_id := (v_enqueue->>'jobId')::uuid;
      exception when others then
        raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ROOT_JOB_INVALID';
      end;
      if v_job_id is null then raise exception 'EBAY_CASE_DISPUTE_COLLECTION_ROOT_JOB_INVALID'; end if;
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

create function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_page jsonb
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
  v_depth integer := 0;
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
  v_receipt jsonb;
  v_observed integer := 0;
  v_inserted integer := 0;
  v_status text := 'deferred';
begin
  if p_job_id is null or p_claim_token is null or coalesce(p_token_hash,'') = ''
     or pg_catalog.jsonb_typeof(p_page) <> 'object'
     or pg_catalog.octet_length(p_page::text) > 64000
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
     or p_page->>'resourceKind' is distinct from v_resource
     or p_page->>'collectionKind' is distinct from v_collection
     or pg_catalog.jsonb_typeof(v_page) <> 'object'
     or pg_catalog.jsonb_typeof(v_page->'entries') <> 'array'
     or pg_catalog.jsonb_array_length(v_page->'entries') > 25 then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_BINDING_INVALID' using errcode = '22023';
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
  if v_availability = 'readable' then
    if v_http_status <> 200 then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_HTTP_INVALID'; end if;
  elsif pg_catalog.jsonb_array_length(v_page->'entries') <> 0
     or v_page->'total' <> 'null'::jsonb or v_page->'nextOffset' <> 'null'::jsonb then
    raise exception 'EBAY_CASE_DISPUTE_GATEWAY_UNAVAILABLE_COUNT_INVALID';
  end if;

  v_root_job_id := v_job.id;
  loop
    v_parent_job_id := nullif(v_job.request_payload->>'continuationOf','')::uuid;
    exit when v_parent_job_id is null;
    v_depth := v_depth + 1;
    if v_depth > 128 then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_LINEAGE_DEPTH_INVALID'; end if;
    select parent.* into v_job
      from sellerpilot_private.channel_gateway_jobs parent
     where parent.id = v_parent_job_id
       and parent.credential_id = v_credential.id
       and parent.channel = 'ebay' and parent.operation = 'inquiries.list'
       and parent.seller_account_key = v_credential.seller_account_key
       and parent.request_payload#>>'{arguments,kind}' = 'case_dispute_history'
       and parent.request_payload#>>'{arguments,resourceKind}' = v_resource;
    if not found then raise exception 'EBAY_CASE_DISPUTE_GATEWAY_PARENT_INVALID'; end if;
    v_root_job_id := v_job.id;
  end loop;

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

revoke all on function public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1(jsonb)
  to service_role;
revoke all on function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(text,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(text,uuid,uuid,jsonb)
  to service_role;

comment on table sellerpilot_private.ebay_case_dispute_collection_scopes is
  'Credential-version and resource-isolated GET collection availability; a 403 or 404 never blocks the other eBay resource.';
comment on function public.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1(text,uuid,uuid,jsonb) is
  'Records one claim-fenced GET-only normalized page before generic gateway completion; no dispute business action is accepted.';

commit;
