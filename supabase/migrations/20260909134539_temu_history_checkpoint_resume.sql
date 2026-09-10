begin;

create table sellerpilot_private.temu_history_runs (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  initiated_by uuid references auth.users(id) on delete set null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  from_date date not null,
  to_date date not null,
  cursor_date date,
  cursor_status_group integer check (cursor_status_group between 1 and 7),
  cursor_page_no integer check (cursor_page_no between 1 and 1000000),
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  status text not null default 'running' check (status in ('running','failed','complete')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (to_date >= from_date and to_date - from_date < 366),
  check ((status = 'complete') = (cursor_date is null)),
  check ((status = 'complete') = (cursor_status_group is null)),
  check ((status = 'complete') = (cursor_page_no is null))
);

create table sellerpilot_private.temu_history_completed_pages (
  run_id uuid not null references sellerpilot_private.temu_history_runs(id) on delete cascade,
  cursor_date date not null,
  status_group integer not null check (status_group between 1 and 7),
  page_no integer not null check (page_no between 1 and 1000000),
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  response_digest text not null check (response_digest ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default clock_timestamp(),
  primary key (run_id,cursor_date,status_group,page_no),
  unique (job_id)
);

create table sellerpilot_private.temu_history_checkpoint_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  run_id uuid not null references sellerpilot_private.temu_history_runs(id) on delete restrict,
  cursor_date date not null,
  status_group integer not null check (status_group between 1 and 7),
  page_no integer not null check (page_no between 1 and 1000000),
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (job_id, claim_token)
);

create function sellerpilot_private.reject_temu_history_checkpoint_receipt_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'TEMU_HISTORY_CHECKPOINT_RECEIPT_IMMUTABLE' using errcode='55000';
end;
$$;

create trigger temu_history_checkpoint_receipts_immutable
before update or delete on sellerpilot_private.temu_history_checkpoint_receipts
for each row execute function sellerpilot_private.reject_temu_history_checkpoint_receipt_change();

alter table sellerpilot_private.temu_history_runs enable row level security;
alter table sellerpilot_private.temu_history_completed_pages enable row level security;
alter table sellerpilot_private.temu_history_checkpoint_receipts enable row level security;
revoke all on sellerpilot_private.temu_history_runs from public,anon,authenticated,service_role;
revoke all on sellerpilot_private.temu_history_completed_pages from public,anon,authenticated,service_role;
revoke all on sellerpilot_private.temu_history_checkpoint_receipts from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.reject_temu_history_checkpoint_receipt_change()
  from public,anon,authenticated,service_role;

create function sellerpilot_private.temu_history_arguments(
  p_date date,p_status_group integer,p_page_no integer
) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'kind','after_sales','includeDetails',true,'pageNo',p_page_no,'pageSize',200,
    'afterSalesStatusGroup',p_status_group,
    'updateAtStart',extract(epoch from p_date::timestamp at time zone 'Asia/Seoul')::bigint,
    'updateAtEnd',extract(epoch from (p_date+1)::timestamp at time zone 'Asia/Seoul')::bigint-1
  );
$$;
revoke all on function sellerpilot_private.temu_history_arguments(date,integer,integer)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.temu_history_checkpoint(
  p_credential_id uuid,p_run_id uuid,p_from_date date,p_to_date date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_run sellerpilot_private.temu_history_runs%rowtype;
  v_completed integer:=0;
  v_pending integer:=0;
  v_status text;
begin
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'TEMU_HISTORY_CREDENTIAL_UNVERIFIED' using errcode='55000'; end if;
  if p_from_date is null or p_to_date is null or p_to_date<p_from_date
     or p_to_date-p_from_date>=366 then
    raise exception 'TEMU_HISTORY_RANGE_INVALID' using errcode='22023';
  end if;
  if p_run_id is null then
    return jsonb_build_object(
      'contract','sellerpilot-temu-history-checkpoint/1','checkedAt',statement_timestamp(),
      'runId',null,'status','idle','credentialId',v_credential.id,
      'sellerAccountKeyHash',v_credential.seller_account_key,
      'fromDate',p_from_date,'toDate',p_to_date,
      'activeCursor',jsonb_build_object('date',p_from_date,'statusGroup',1,'pageNo',1),
      'providerArguments',sellerpilot_private.temu_history_arguments(p_from_date,1,1),
      'completedPageCount',0,'pendingJobCount',0,'retryCount',0,'retryCap',3,
      'canResume',true,'completedPagesPreserved',true,
      'providerRetention',jsonb_build_object('status','unverified','earliestSupportedDate',null)
    );
  end if;
  select run.* into v_run from sellerpilot_private.temu_history_runs run
   where run.id=p_run_id and run.credential_id=v_credential.id
     and run.seller_account_key=v_credential.seller_account_key
     and run.owner_id=v_credential.created_by
     and run.from_date=p_from_date and run.to_date=p_to_date;
  if not found then raise exception 'TEMU_HISTORY_RUN_SCOPE_MISMATCH' using errcode='22023'; end if;
  select count(*)::integer into v_completed
    from sellerpilot_private.temu_history_completed_pages page where page.run_id=v_run.id;
  select count(*)::integer into v_pending
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'=v_run.id::text
     and job.status in('queued','running');
  v_status:=case when v_run.status='failed' and v_run.retry_count=3 then'retry_exhausted' else v_run.status end;
  return jsonb_build_object(
    'contract','sellerpilot-temu-history-checkpoint/1','checkedAt',statement_timestamp(),
    'runId',v_run.id,'status',v_status,'credentialId',v_run.credential_id,
    'sellerAccountKeyHash',v_run.seller_account_key,'fromDate',v_run.from_date,'toDate',v_run.to_date,
    'activeCursor',case when v_run.status='complete'then null else jsonb_build_object(
      'date',v_run.cursor_date,'statusGroup',v_run.cursor_status_group,'pageNo',v_run.cursor_page_no)end,
    'providerArguments',case when v_run.status='complete'then null else
      sellerpilot_private.temu_history_arguments(v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no)end,
    'completedPageCount',v_completed,'pendingJobCount',v_pending,'retryCount',v_run.retry_count,'retryCap',3,
    'canResume',v_status in('failed') and v_run.retry_count<3,
    'completedPagesPreserved',true,
    'providerRetention',jsonb_build_object('status','unverified','earliestSupportedDate',null)
  );
end;
$$;
revoke all on function sellerpilot_private.temu_history_checkpoint(uuid,uuid,date,date)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.enqueue_temu_history_cursor(p_run_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_run sellerpilot_private.temu_history_runs%rowtype;v_result jsonb;v_job_id uuid;v_arguments jsonb;
begin
  select run.* into strict v_run from sellerpilot_private.temu_history_runs run where run.id=p_run_id for update;
  v_arguments:=sellerpilot_private.temu_history_arguments(
    v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no
  )||jsonb_build_object(
    'sellerpilotTemuHistoryRunId',v_run.id::text,
    'sellerpilotTemuHistoryCursor',jsonb_build_object(
      'date',v_run.cursor_date,'statusGroup',v_run.cursor_status_group,'pageNo',v_run.cursor_page_no)
  );
  v_result:=public.sellerpilot_service_enqueue_periodic_sync(
    'temu','inquiries.list',jsonb_build_object(
      'periodicKey',format('inquiries:history:temu:%s:%s:%s:%s',v_run.id,v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no),
      'arguments',v_arguments
    ),60
  );
  if v_result->>'status'<>'queued' or coalesce(v_result->>'jobId','')
      !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'TEMU_HISTORY_ENQUEUE_REFUSED';
  end if;
  v_job_id:=(v_result->>'jobId')::uuid;
  if not exists(select 1 from sellerpilot_private.channel_gateway_jobs job
    where job.id=v_job_id and job.credential_id=v_run.credential_id
      and job.seller_account_key=v_run.seller_account_key and job.created_by=v_run.owner_id
      and job.channel='temu' and job.operation='inquiries.list'
      and job.request_payload->'arguments'=v_arguments) then
    raise exception 'TEMU_HISTORY_ENQUEUE_LINEAGE_MISMATCH';
  end if;
  return v_job_id;
end;
$$;
revoke all on function sellerpilot_private.enqueue_temu_history_cursor(uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_get_temu_history_checkpoint_v1(
  p_credential_id uuid,p_run_id uuid,p_from_date date,p_to_date date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  return sellerpilot_private.temu_history_checkpoint(p_credential_id,p_run_id,p_from_date,p_to_date);
end;
$$;
revoke all on function public.sellerpilot_get_temu_history_checkpoint_v1(uuid,uuid,date,date)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_temu_history_checkpoint_v1(uuid,uuid,date,date)
  to authenticated;

create function public.sellerpilot_start_or_resume_temu_history_v1(
  p_credential_id uuid,p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_credential sellerpilot_private.channel_credentials%rowtype;
  v_run sellerpilot_private.temu_history_runs%rowtype;v_cursor jsonb;v_job_id uuid;
begin
  if v_actor is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select credential.* into v_credential from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu' and credential.environment='production'
     and credential.status='active' and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>clock_timestamp());
  if not found then raise exception 'TEMU_HISTORY_CREDENTIAL_UNVERIFIED';end if;
  if p_request->>'action'='start' then
    if jsonb_typeof(p_request)is distinct from'object'
       or (select count(*) from jsonb_object_keys(p_request))<>4
       or exists(select 1 from jsonb_object_keys(p_request)key
         where key not in('action','requestKey','fromDate','toDate'))
       or coalesce(p_request->>'requestKey','')!~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(p_request->>'fromDate','')!~'^\d{4}-\d{2}-\d{2}$'
       or coalesce(p_request->>'toDate','')!~'^\d{4}-\d{2}-\d{2}$'
       or (p_request->>'toDate')::date<(p_request->>'fromDate')::date
       or (p_request->>'toDate')::date-(p_request->>'fromDate')::date>=366
       or (p_request->>'toDate')::date>(clock_timestamp()at time zone'Asia/Seoul')::date then
      raise exception 'TEMU_HISTORY_START_INVALID';end if;
    insert into sellerpilot_private.temu_history_runs(
      request_key,owner_id,initiated_by,credential_id,seller_account_key,from_date,to_date,
      cursor_date,cursor_status_group,cursor_page_no
    )values((p_request->>'requestKey')::uuid,v_credential.created_by,v_actor,v_credential.id,
      v_credential.seller_account_key,(p_request->>'fromDate')::date,(p_request->>'toDate')::date,
      (p_request->>'fromDate')::date,1,1)
    on conflict(request_key)do nothing;
    select run.* into strict v_run from sellerpilot_private.temu_history_runs run
     where run.request_key=(p_request->>'requestKey')::uuid for update;
    if v_run.credential_id<>v_credential.id or v_run.seller_account_key<>v_credential.seller_account_key
       or v_run.from_date<>(p_request->>'fromDate')::date or v_run.to_date<>(p_request->>'toDate')::date then
      raise exception 'TEMU_HISTORY_START_SCOPE_MISMATCH';end if;
    if not exists(select 1 from sellerpilot_private.channel_gateway_jobs job
      where job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'=v_run.id::text) then
      perform sellerpilot_private.enqueue_temu_history_cursor(v_run.id);
    end if;
  elsif p_request->>'action'='resume' then
    v_cursor:=p_request->'expectedCursor';
    if jsonb_typeof(p_request)is distinct from'object'
       or (select count(*) from jsonb_object_keys(p_request))<>4
       or exists(select 1 from jsonb_object_keys(p_request)key
         where key not in('action','runId','expectedCursor','expectedRetryCount'))
       or coalesce(p_request->>'runId','')!~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_cursor)is distinct from'object'
       or (select count(*) from jsonb_object_keys(v_cursor))<>3
       or exists(select 1 from jsonb_object_keys(v_cursor)key
         where key not in('date','statusGroup','pageNo'))
       or coalesce(v_cursor->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_cursor->>'statusGroup','')!~'^[1-7]$'
       or coalesce(v_cursor->>'pageNo','')!~'^[1-9][0-9]{0,5}$'
       or coalesce(p_request->>'expectedRetryCount','')!~'^[0-2]$' then
      raise exception 'TEMU_HISTORY_RESUME_INVALID';end if;
    select run.* into strict v_run from sellerpilot_private.temu_history_runs run
     where run.id=(p_request->>'runId')::uuid and run.credential_id=v_credential.id
       and run.seller_account_key=v_credential.seller_account_key and run.owner_id=v_credential.created_by
       and run.status='failed' and run.retry_count=(p_request->>'expectedRetryCount')::integer
       and run.retry_count<3 and run.cursor_date=(v_cursor->>'date')::date
       and run.cursor_status_group=(v_cursor->>'statusGroup')::integer
       and run.cursor_page_no=(v_cursor->>'pageNo')::integer for update;
    select job.id into strict v_job_id from sellerpilot_private.channel_gateway_jobs job
     where job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'=v_run.id::text
       and job.request_payload#>'{arguments,sellerpilotTemuHistoryCursor}'=v_cursor
       and job.credential_id=v_run.credential_id and job.seller_account_key=v_run.seller_account_key
       and job.created_by=v_run.owner_id and job.channel='temu' and job.operation='inquiries.list'
       and job.status='failed' and job.attempt_count<4
       and job.provider_mutation_started_at is null
     order by job.created_at desc limit 1 for update;
    delete from sellerpilot_private.gateway_completion_receipts receipt
     where receipt.job_id=v_job_id
       and exists(select 1 from sellerpilot_private.ai_cli_worker_tokens token
         where token.id=receipt.worker_token_id and token.scope in('gateway','serverless_cs'));
    if not found then raise exception 'TEMU_HISTORY_FAILED_RECEIPT_REQUIRED';end if;
    update sellerpilot_private.channel_gateway_jobs set status='queued',worker_token_id=null,
      claim_token=null,lease_expires_at=null,completed_at=null,error_message=null,updated_at=clock_timestamp()
     where id=v_job_id;
    update sellerpilot_private.temu_history_runs set status='running',retry_count=retry_count+1,
      updated_at=clock_timestamp() where id=v_run.id returning*into v_run;
  else raise exception 'TEMU_HISTORY_ACTION_INVALID' using errcode='22023';end if;
  return sellerpilot_private.temu_history_checkpoint(
    v_credential.id,v_run.id,v_run.from_date,v_run.to_date
  );
end;
$$;
revoke all on function public.sellerpilot_start_or_resume_temu_history_v1(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_or_resume_temu_history_v1(uuid,jsonb)
  to authenticated;

alter function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  rename to sellerpilot_091120_gateway_context_before_temu_history;
revoke all on function public.sellerpilot_091120_gateway_context_before_temu_history(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb;v_run_id uuid;
begin
  v_context:=public.sellerpilot_091120_gateway_context_before_temu_history(
    p_token_hash,p_job_id,p_claim_token
  );
  if v_context is null or v_context->>'channel'is distinct from'temu'
     or v_context->>'operation'is distinct from'inquiries.list'
     or v_context->>'status'not in('running','completed_replay')then
    return v_context;
  end if;
  select run.id into v_run_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.temu_history_runs run
      on run.id=(case when coalesce(
        job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}',''
      )~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}'end)::uuid
     and run.credential_id=job.credential_id
     and run.seller_account_key=job.seller_account_key
     and run.owner_id=job.created_by
   where job.id=p_job_id and job.credential_id=(v_context->>'credential_id')::uuid
     and job.channel='temu'and job.operation='inquiries.list';
  if not found then return v_context;end if;
  return v_context||jsonb_build_object('temuHistoryRunId',v_run_id);
end;
$$;
revoke all on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  to service_role;

create function public.sellerpilot_service_record_temu_history_checkpoint_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_receipt sellerpilot_private.gateway_completion_receipts%rowtype;
  v_checkpoint_receipt sellerpilot_private.temu_history_checkpoint_receipts%rowtype;
  v_run sellerpilot_private.temu_history_runs%rowtype;v_cursor jsonb;v_source_cursor jsonb;
  v_next_job uuid;v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:temu-history-checkpoint:' || coalesce(p_job_id::text,'') || ':' ||
    coalesce(p_claim_token::text,'')
  ));
  select checkpoint.* into v_checkpoint_receipt
    from sellerpilot_private.temu_history_checkpoint_receipts checkpoint
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=checkpoint.worker_token_id
   where checkpoint.job_id=p_job_id and checkpoint.claim_token=p_claim_token
     and token.token_hash=p_token_hash and token.scope in('gateway','serverless_cs')
     and token.status='active' and token.expires_at>clock_timestamp();
  if found then
    return v_checkpoint_receipt.result_payload||jsonb_build_object('replayed',true);
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt on receipt.job_id=job.id
      and receipt.claim_token=p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=receipt.worker_token_id
      and token.token_hash=p_token_hash and token.scope in('gateway','serverless_cs')
      and token.status='active' and token.expires_at>clock_timestamp()
   where job.id=p_job_id and job.channel='temu' and job.operation='inquiries.list'
     and job.status in('succeeded','failed');
  if not found then raise exception 'TEMU_HISTORY_COMPLETION_RECEIPT_REQUIRED';end if;
  select receipt.* into strict v_receipt
    from sellerpilot_private.gateway_completion_receipts receipt
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=receipt.worker_token_id
   where receipt.job_id=v_job.id and receipt.claim_token=p_claim_token
     and token.token_hash=p_token_hash and token.scope in('gateway','serverless_cs')
     and token.status='active' and token.expires_at>clock_timestamp();
  v_source_cursor:=v_job.request_payload#>'{arguments,sellerpilotTemuHistoryCursor}';
  if jsonb_typeof(v_source_cursor)is distinct from'object'
     or coalesce(v_source_cursor->>'date','')!~'^\d{4}-\d{2}-\d{2}$'
     or coalesce(v_source_cursor->>'statusGroup','')!~'^[1-7]$'
     or coalesce(v_source_cursor->>'pageNo','')!~'^[1-9][0-9]{0,5}$' then
    raise exception 'TEMU_HISTORY_COMPLETION_CURSOR_INVALID';
  end if;
  v_cursor:=v_source_cursor;
  select run.* into strict v_run from sellerpilot_private.temu_history_runs run
   where run.id=(v_job.request_payload#>>'{arguments,sellerpilotTemuHistoryRunId}')::uuid
     and run.credential_id=v_job.credential_id and run.seller_account_key=v_job.seller_account_key
     and run.owner_id=v_job.created_by for update;
  if v_run.status='complete'
     or v_run.cursor_date is distinct from(v_source_cursor->>'date')::date
     or v_run.cursor_status_group is distinct from(v_source_cursor->>'statusGroup')::integer
     or v_run.cursor_page_no is distinct from(v_source_cursor->>'pageNo')::integer then
    raise exception 'TEMU_HISTORY_COMPLETION_CURSOR_STALE' using errcode='40001';
  end if;
  if v_job.status='failed' then
    update sellerpilot_private.temu_history_runs set status='failed',updated_at=clock_timestamp()
     where id=v_run.id returning*into v_run;
  else
    if v_receipt.continuation_job_id is not null then
      select job.request_payload#>'{arguments,sellerpilotTemuHistoryCursor}' into strict v_cursor
        from sellerpilot_private.channel_gateway_jobs job
       where job.id=v_receipt.continuation_job_id and job.credential_id=v_run.credential_id
         and job.seller_account_key=v_run.seller_account_key and job.created_by=v_run.owner_id
         and job.channel='temu' and job.operation='inquiries.list';
      if v_cursor is distinct from v_source_cursor then
        insert into sellerpilot_private.temu_history_completed_pages(
          run_id,cursor_date,status_group,page_no,job_id,response_digest
        )values(v_run.id,v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no,
          v_job.id,v_receipt.completion_fingerprint)on conflict do nothing;
      end if;
      update sellerpilot_private.temu_history_runs set cursor_date=(v_cursor->>'date')::date,
        cursor_status_group=(v_cursor->>'statusGroup')::integer,
        cursor_page_no=(v_cursor->>'pageNo')::integer,retry_count=0,status='running',
        updated_at=clock_timestamp()where id=v_run.id returning*into v_run;
    else
      insert into sellerpilot_private.temu_history_completed_pages(
        run_id,cursor_date,status_group,page_no,job_id,response_digest
      )values(v_run.id,v_run.cursor_date,v_run.cursor_status_group,v_run.cursor_page_no,
        v_job.id,v_receipt.completion_fingerprint)on conflict do nothing;
    end if;
    if v_receipt.continuation_job_id is not null then
      null;
    elsif v_run.cursor_status_group<7 then
      update sellerpilot_private.temu_history_runs set cursor_status_group=cursor_status_group+1,
        cursor_page_no=1,retry_count=0,status='running',updated_at=clock_timestamp()
       where id=v_run.id returning*into v_run;
      v_next_job:=sellerpilot_private.enqueue_temu_history_cursor(v_run.id);
    elsif v_run.cursor_date<v_run.to_date then
      update sellerpilot_private.temu_history_runs set cursor_date=cursor_date+1,
        cursor_status_group=1,cursor_page_no=1,retry_count=0,status='running',updated_at=clock_timestamp()
       where id=v_run.id returning*into v_run;
      v_next_job:=sellerpilot_private.enqueue_temu_history_cursor(v_run.id);
    else
      update sellerpilot_private.temu_history_runs set cursor_date=null,cursor_status_group=null,
        cursor_page_no=null,status='complete',completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where id=v_run.id returning*into v_run;
    end if;
  end if;
  v_result:=sellerpilot_private.temu_history_checkpoint(
    v_run.credential_id,v_run.id,v_run.from_date,v_run.to_date
  )||jsonb_build_object('replayed',false);
  insert into sellerpilot_private.temu_history_checkpoint_receipts(
    job_id,claim_token,worker_token_id,run_id,cursor_date,status_group,page_no,
    completion_fingerprint,result_payload
  )values(
    v_job.id,p_claim_token,v_receipt.worker_token_id,v_run.id,
    (v_source_cursor->>'date')::date,(v_source_cursor->>'statusGroup')::integer,
    (v_source_cursor->>'pageNo')::integer,v_receipt.completion_fingerprint,v_result
  );
  return v_result;
end;
$$;
revoke all on function public.sellerpilot_service_record_temu_history_checkpoint_v1(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_temu_history_checkpoint_v1(text,uuid,uuid)
  to service_role;

comment on function public.sellerpilot_start_or_resume_temu_history_v1(uuid,jsonb) is
  'Starts or explicitly resumes one exact Temu read-only history cursor with a three-retry cap. Completed page receipts are never reset; provider retention remains unverified.';

comment on function public.sellerpilot_service_record_temu_history_checkpoint_v1(text,uuid,uuid) is
  'Advances one exact completed Temu history cursor once and returns the immutable per-job/claim checkpoint receipt on immediate, delayed, or post-completion replay.';

comment on function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid) is
  'Preserves the canonical gateway completion context and adds only a validated Temu history run id for the exact owned history job.';

notify pgrst,'reload schema';
commit;
