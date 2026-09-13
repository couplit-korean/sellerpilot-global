-- Integrated recovery, reviewed against sqaoqucxakebqkiygdxb on 2026-09-13.
-- Installs absent Shopee history/reply ledgers and latest contracts atomically.
-- Does not replay historical channel writes or overwrite deployed functions.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $preimage$ begin if exists(select 1 from (values ('public','sellerpilot_read_cs_shopee_history_events_v1'),('public','sellerpilot_service_complete_serverless_cs_shopee_history_v1'),('public','sellerpilot_service_plan_cs_shopee_history_v1'),('public','sellerpilot_service_reconcile_shopee_return_revision_v1'),('public','sellerpilot_service_record_cs_shopee_history_event_v1'),('public','sellerpilot_service_record_shopee_reply_readback_v1'),('public','sellerpilot_service_resume_cs_shopee_history_v1'),('public','sellerpilot_service_start_cs_shopee_history_v1'),('public','sellerpilot_service_start_cs_shopee_history_v2'),('sellerpilot_private','cs_shopee_history_event_job_guard_v1'),('sellerpilot_private','cs_shopee_history_scope_binding_guard_v1'),('sellerpilot_private','enqueue_shopee_reply_readback_after_acceptance')) required(schema_name,function_name) join pg_namespace n on n.nspname=required.schema_name join pg_proc p on p.pronamespace=n.oid and p.proname=required.function_name) then raise exception 'SHOPEE_REVIEWED_RECOVERY_ALREADY_PRESENT';end if;end $preimage$;
-- Reviewed source: 20260908142023_cs_shopee_history_ledger.sql
-- SHA256: cd06a37df2b598e128f3def2088dd6104b7859bab43539bc118f2649a5147dd8


do $$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.gateway_completion_receipts') is null
     or to_regclass('sellerpilot_private.ai_cli_worker_tokens') is null
     or to_regclass('sellerpilot_private.support_tickets') is null
     or to_regclass('sellerpilot_private.support_inbound_messages') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'SHOPEE_HISTORY_LEDGER_PREIMAGE_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.cs_shopee_history_scopes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  history_run_id text not null check (history_run_id ~ '^[A-Za-z0-9:_-]{1,120}$'),
  scope_key text not null check (length(scope_key) between 1 and 200),
  scope_digest text not null check (scope_digest ~ '^[a-f0-9]{64}$'),
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  country text not null check (country ~ '^[A-Z][A-Z0-9_-]{1,39}$'),
  kind text not null check (kind in ('product_review','return_refund')),
  coverage text not null check (coverage in ('provider_cursor_corpus','explicit_time_window')),
  scope_payload jsonb not null check (jsonb_typeof(scope_payload) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id,credential_id,history_run_id,scope_key)
);

create table sellerpilot_private.cs_shopee_history_events (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references sellerpilot_private.cs_shopee_history_scopes(id) on delete cascade,
  job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  event_key text not null check (event_key ~ '^[A-Za-z0-9:_-]{1,160}$'),
  sequence integer not null check (sequence > 0),
  event_type text not null check (event_type in ('page','interruption')),
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  event_payload jsonb not null check (jsonb_typeof(event_payload) = 'object'),
  observed_at timestamptz not null default clock_timestamp(),
  unique(scope_id,event_key),
  unique(scope_id,sequence)
);

create table sellerpilot_private.cs_shopee_return_revision_reconciliations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  ticket_id uuid not null references sellerpilot_private.support_tickets(id) on delete cascade,
  external_ticket_id text not null check (length(external_ticket_id) between 1 and 240),
  incoming_inbound_key text not null check (incoming_inbound_key ~ '^shopee:[a-f0-9]{64}$'),
  incoming_detail_revision text not null check (incoming_detail_revision ~ '^[a-f0-9]{64}$'),
  reason text not null check (reason = 'legacy_revision_unattested'),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique(owner_id,external_ticket_id,incoming_inbound_key)
);

create index cs_shopee_history_scopes_read_idx
  on sellerpilot_private.cs_shopee_history_scopes(owner_id,created_at desc,history_run_id);
create index cs_shopee_history_events_scope_idx
  on sellerpilot_private.cs_shopee_history_events(scope_id,sequence);
create index cs_shopee_return_revision_open_idx
  on sellerpilot_private.cs_shopee_return_revision_reconciliations(owner_id,created_at desc)
  where status = 'open';

alter table sellerpilot_private.cs_shopee_history_scopes enable row level security;
alter table sellerpilot_private.cs_shopee_history_events enable row level security;
alter table sellerpilot_private.cs_shopee_return_revision_reconciliations enable row level security;
revoke all on sellerpilot_private.cs_shopee_history_scopes,
  sellerpilot_private.cs_shopee_history_events,
  sellerpilot_private.cs_shopee_return_revision_reconciliations
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_plan_cs_shopee_history_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_history_run_id text,
  p_scopes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_scope jsonb;
  v_arguments jsonb;
  v_scope_key text;
  v_shop_id text;
  v_country text;
  v_kind text;
  v_coverage text;
  v_from bigint;
  v_to bigint;
  v_digest text;
  v_existing_digest text;
  v_inserted integer := 0;
  v_reused integer := 0;
begin
  if coalesce(p_token_hash,'') !~ '^[A-Za-z0-9._:-]{8,255}$'
     or length(p_token_hash) > 256
     or p_claim_token is null
     or coalesce(p_history_run_id,'') !~ '^[A-Za-z0-9:_-]{1,120}$'
     or jsonb_typeof(p_scopes) is distinct from 'array'
     or jsonb_array_length(p_scopes) not between 1 and 20000
     or octet_length(p_scopes::text) > 4000000 then
    raise exception 'SHOPEE_HISTORY_PLAN_INVALID' using errcode='22023';
  end if;
  select job.id,job.credential_id,job.created_by,credential.environment
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id=job.credential_id and credential.created_by=job.created_by
     and credential.channel='shopee' and credential.status in ('active','grace')
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id=job.worker_token_id and token.token_hash=p_token_hash
     and token.status='active' and token.expires_at>clock_timestamp()
   where job.id=p_job_id and job.claim_token=p_claim_token
     and job.channel='shopee' and job.operation='inquiries.list'
     and job.status='running' and job.lease_expires_at>clock_timestamp()
   for update of job;
  if not found then raise exception 'SHOPEE_HISTORY_PLAN_CLAIM_REQUIRED' using errcode='42501'; end if;
  if (select count(distinct value->>'shopId') from jsonb_array_elements(p_scopes)) > 8 then
    raise exception 'SHOPEE_HISTORY_PLAN_SHOPS_INVALID' using errcode='22023';
  end if;

  for v_scope in select value from jsonb_array_elements(p_scopes) loop
    if jsonb_typeof(v_scope) is distinct from 'object'
       or not (v_scope ?& array['scopeKey','kind','shopId','country','coverage','arguments'])
       or v_scope - array['scopeKey','kind','shopId','country','coverage','arguments'] <> '{}'::jsonb
       or jsonb_typeof(v_scope->'arguments') is distinct from 'object' then
      raise exception 'SHOPEE_HISTORY_SCOPE_INVALID' using errcode='22023';
    end if;
    v_scope_key:=v_scope->>'scopeKey';v_kind:=v_scope->>'kind';v_shop_id:=v_scope->>'shopId';
    v_country:=v_scope->>'country';v_coverage:=v_scope->>'coverage';v_arguments:=v_scope->'arguments';
    if coalesce(v_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
       or coalesce(v_country,'') !~ '^[A-Z][A-Z0-9_-]{1,39}$'
       or v_arguments->>'shopId' is distinct from v_shop_id
       or v_arguments->>'kind' is distinct from v_kind then
      raise exception 'SHOPEE_HISTORY_SCOPE_INVALID' using errcode='22023';
    end if;
    if v_kind='product_review' then
      if v_coverage<>'provider_cursor_corpus'
         or v_scope_key<>format('shopee:%s:product_review:cursor-corpus',v_shop_id)
         or v_arguments - array['kind','cursor','pageSize','shopId'] <> '{}'::jsonb
         or v_arguments->>'cursor'<>''
         or (v_arguments->>'pageSize')::integer<>100 then
        raise exception 'SHOPEE_HISTORY_REVIEW_SCOPE_INVALID' using errcode='22023';
      end if;
    elsif v_kind='return_refund' then
      begin
        v_from:=(v_arguments->>'createTimeFrom')::bigint;
        v_to:=(v_arguments->>'createTimeTo')::bigint;
      exception when others then
        raise exception 'SHOPEE_HISTORY_RETURN_SCOPE_INVALID' using errcode='22023';
      end;
      if v_coverage<>'explicit_time_window'
         or v_scope_key<>format('shopee:%s:return_refund:%s-%s',v_shop_id,v_from,v_to)
         or v_arguments - array['kind','createTimeFrom','createTimeTo','pageNo','pageSize','shopId'] <> '{}'::jsonb
         or v_from<1 or v_to<=v_from or v_to-v_from>1296000
         or (v_arguments->>'pageNo')::integer<>1 or (v_arguments->>'pageSize')::integer<>100 then
        raise exception 'SHOPEE_HISTORY_RETURN_SCOPE_INVALID' using errcode='22023';
      end if;
    else
      raise exception 'SHOPEE_HISTORY_SCOPE_KIND_INVALID' using errcode='22023';
    end if;
    v_digest:=encode(extensions.digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
    insert into sellerpilot_private.cs_shopee_history_scopes(
      owner_id,credential_id,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
    ) values(v_job.created_by,v_job.credential_id,p_history_run_id,v_scope_key,v_digest,v_shop_id,v_country,v_kind,v_coverage,v_scope)
    on conflict(owner_id,credential_id,history_run_id,scope_key) do nothing;
    if found then v_inserted:=v_inserted+1;
    else
      select scope.scope_digest into v_existing_digest
        from sellerpilot_private.cs_shopee_history_scopes scope
       where scope.owner_id=v_job.created_by and scope.credential_id=v_job.credential_id
         and scope.history_run_id=p_history_run_id and scope.scope_key=v_scope_key;
      if v_existing_digest is distinct from v_digest then
        raise exception 'SHOPEE_HISTORY_SCOPE_REUSE_MISMATCH' using errcode='23514';
      end if;
      v_reused:=v_reused+1;
    end if;
  end loop;
  return jsonb_build_object('contract','sellerpilot-shopee-history-plan/1','status','recorded',
    'historyRunId',p_history_run_id,'insertedCount',v_inserted,'reusedCount',v_reused);
end $$;

create function public.sellerpilot_service_record_cs_shopee_history_event_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_history_run_id text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_scope sellerpilot_private.cs_shopee_history_scopes%rowtype;
  v_event_type text;
  v_event_key text;
  v_event_digest text;
  v_existing_digest text;
  v_sequence integer;
  v_last_sequence integer;
  v_last_page jsonb;
  v_expected_checkpoint text;
  v_input_checkpoint text;
  v_next_checkpoint jsonb;
  v_next_digest text;
  v_array_key text;
begin
  if coalesce(p_token_hash,'') !~ '^[A-Za-z0-9._:-]{8,255}$'
     or length(p_token_hash) > 256 or p_claim_token is null
     or coalesce(p_history_run_id,'') !~ '^[A-Za-z0-9:_-]{1,120}$'
     or jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text)>2000000 then
    raise exception 'SHOPEE_HISTORY_EVENT_INVALID' using errcode='22023';
  end if;
  select job.id,job.credential_id,job.created_by,job.status,job.request_payload
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id=job.id and receipt.claim_token=p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id=receipt.worker_token_id and token.token_hash=p_token_hash
     and token.status='active' and token.expires_at>clock_timestamp()
   where job.id=p_job_id and job.channel='shopee' and job.operation='inquiries.list'
     and job.status in ('succeeded','failed','reconciliation_required');
  if not found then raise exception 'SHOPEE_HISTORY_EVENT_RECEIPT_REQUIRED' using errcode='42501'; end if;
  select scope.* into v_scope from sellerpilot_private.cs_shopee_history_scopes scope
   where scope.owner_id=v_job.created_by and scope.credential_id=v_job.credential_id
     and scope.history_run_id=p_history_run_id and scope.scope_key=p_event->>'scopeKey'
   for update;
  if not found
     or p_event->>'shopId' is distinct from v_scope.shop_id
     or p_event->>'kind' is distinct from v_scope.kind
     or v_job.request_payload#>>'{arguments,sellerpilotShopeeScopeKey}' is distinct from v_scope.scope_key
     or v_job.request_payload#>>'{arguments,shopId}' is distinct from v_scope.shop_id
     or v_job.request_payload#>>'{arguments,kind}' is distinct from v_scope.kind then
    raise exception 'SHOPEE_HISTORY_EVENT_SCOPE_MISMATCH' using errcode='23514';
  end if;
  v_event_type:=p_event->>'type';v_event_key:=p_event->>'eventKey';
  begin v_sequence:=(p_event->>'sequence')::integer;
  exception when others then raise exception 'SHOPEE_HISTORY_EVENT_SEQUENCE_INVALID' using errcode='22023'; end;
  if coalesce(v_event_key,'') !~ '^[A-Za-z0-9:_-]{1,160}$' or v_sequence<1 then
    raise exception 'SHOPEE_HISTORY_EVENT_INVALID' using errcode='22023';
  end if;
  if (v_event_type='page' and v_job.status<>'succeeded')
     or (v_event_type='interruption' and v_job.status='succeeded')
     or v_event_type not in ('page','interruption') then
    raise exception 'SHOPEE_HISTORY_EVENT_STATUS_MISMATCH' using errcode='23514';
  end if;
  v_event_digest:=encode(extensions.digest(convert_to(p_event::text,'UTF8'),'sha256'),'hex');
  select event.event_digest into v_existing_digest
    from sellerpilot_private.cs_shopee_history_events event
   where event.scope_id=v_scope.id and event.event_key=v_event_key;
  if found then
    if v_existing_digest is distinct from v_event_digest then
      raise exception 'SHOPEE_HISTORY_EVENT_REUSE_MISMATCH' using errcode='23514';
    end if;
    return jsonb_build_object('contract','sellerpilot-shopee-history-event/1','status','duplicate',
      'scopeKey',v_scope.scope_key,'eventKey',v_event_key,'sequence',v_sequence);
  end if;
  select coalesce(max(event.sequence),0) into v_last_sequence
    from sellerpilot_private.cs_shopee_history_events event where event.scope_id=v_scope.id;
  if v_sequence<>v_last_sequence+1 then
    raise exception 'SHOPEE_HISTORY_EVENT_SEQUENCE_CONFLICT' using errcode='23514';
  end if;
  select event.event_payload into v_last_page
    from sellerpilot_private.cs_shopee_history_events event
   where event.scope_id=v_scope.id and event.event_type='page'
   order by event.sequence desc limit 1;
  if v_last_page is not null and v_last_page->'nextCheckpoint'='null'::jsonb then
    raise exception 'SHOPEE_HISTORY_SCOPE_ALREADY_COMPLETE' using errcode='23514';
  end if;
  v_expected_checkpoint:=case when v_last_page is null then null
    else v_last_page#>>'{nextCheckpoint,checkpointDigest}' end;

  if v_event_type='interruption' then
    if not (p_event ?& array['type','eventKey','sequence','scopeKey','shopId','kind','checkpointDigest','reason','errorCode'])
       or p_event-array['type','eventKey','sequence','scopeKey','shopId','kind','checkpointDigest','reason','errorCode']<>'{}'::jsonb
       or p_event->>'reason' not in ('failed','authorization_required')
       or coalesce(p_event->>'errorCode','') !~ '^[A-Z0-9:_-]{1,120}$'
       or nullif(p_event->>'checkpointDigest','') is distinct from v_expected_checkpoint
       or (p_event->>'reason'='authorization_required'
         and p_event->>'errorCode' !~ '(401|403|TOKEN|AUTH|PERMISSION)') then
      raise exception 'SHOPEE_HISTORY_INTERRUPTION_INVALID' using errcode='22023';
    end if;
  else
    if not (p_event ?& array['type','eventKey','sequence','scopeKey','shopId','kind','inputCheckpointDigest','pageDigest',
      'remoteRecordDigests','normalizedRecordDigests','isolatedRecordDigests','excludedRecordDigests','projectedEventDigests','nextCheckpoint'])
       or p_event-array['type','eventKey','sequence','scopeKey','shopId','kind','inputCheckpointDigest','pageDigest',
      'remoteRecordDigests','normalizedRecordDigests','isolatedRecordDigests','excludedRecordDigests','projectedEventDigests','nextCheckpoint']<>'{}'::jsonb
       or coalesce(p_event->>'pageDigest','') !~ '^[a-f0-9]{64}$' then
      raise exception 'SHOPEE_HISTORY_PAGE_INVALID' using errcode='22023';
    end if;
    v_input_checkpoint:=nullif(p_event->>'inputCheckpointDigest','');
    if v_input_checkpoint is distinct from v_expected_checkpoint then
      raise exception 'SHOPEE_HISTORY_CHECKPOINT_CHAIN_INVALID' using errcode='23514';
    end if;
    foreach v_array_key in array array['remoteRecordDigests','normalizedRecordDigests','isolatedRecordDigests','excludedRecordDigests','projectedEventDigests'] loop
      if jsonb_typeof(p_event->v_array_key) is distinct from 'array'
         or jsonb_array_length(p_event->v_array_key)>5000
         or exists(select 1 from jsonb_array_elements_text(p_event->v_array_key) item where item !~ '^[a-f0-9]{64}$')
         or (select count(*)<>count(distinct item) from jsonb_array_elements_text(p_event->v_array_key) item) then
        raise exception 'SHOPEE_HISTORY_PAGE_DIGESTS_INVALID' using errcode='22023';
      end if;
    end loop;
    if exists(
      select 1 from (
        select value from jsonb_array_elements_text(p_event->'normalizedRecordDigests')
        union all select value from jsonb_array_elements_text(p_event->'isolatedRecordDigests')
        union all select value from jsonb_array_elements_text(p_event->'excludedRecordDigests')
      ) outcome where not exists(
        select 1 from jsonb_array_elements_text(p_event->'remoteRecordDigests') remote where remote=outcome.value
      )
    ) or (select count(*)<>count(distinct value) from (
      select value from jsonb_array_elements_text(p_event->'normalizedRecordDigests')
      union all select value from jsonb_array_elements_text(p_event->'isolatedRecordDigests')
      union all select value from jsonb_array_elements_text(p_event->'excludedRecordDigests')
    ) outcomes) then
      raise exception 'SHOPEE_HISTORY_PAGE_OUTCOME_INVALID' using errcode='23514';
    end if;
    v_next_checkpoint:=p_event->'nextCheckpoint';
    if v_next_checkpoint<>'null'::jsonb then
      v_next_digest:=v_next_checkpoint->>'checkpointDigest';
      if jsonb_typeof(v_next_checkpoint) is distinct from 'object'
         or v_next_checkpoint->>'kind' is distinct from v_scope.kind
         or coalesce(v_next_digest,'') !~ '^[a-f0-9]{64}$'
         or coalesce((v_next_checkpoint->>'paginationDepth')::integer,0) not between 1 and 50
         or coalesce((v_next_checkpoint->>'paginationEpoch')::bigint,-1)<0
         or v_next_digest is not distinct from v_expected_checkpoint
         or exists(select 1 from sellerpilot_private.cs_shopee_history_events prior
           where prior.scope_id=v_scope.id and prior.event_payload#>>'{nextCheckpoint,checkpointDigest}'=v_next_digest) then
        raise exception 'SHOPEE_HISTORY_CHECKPOINT_INVALID' using errcode='22023';
      end if;
      if v_scope.kind='product_review' and (
        v_next_checkpoint-array['kind','checkpointDigest','cursorDigest','paginationEpoch','paginationDepth']<>'{}'::jsonb
        or coalesce(v_next_checkpoint->>'cursorDigest','') !~ '^[a-f0-9]{64}$'
        or jsonb_array_length(p_event->'remoteRecordDigests')=0) then
        raise exception 'SHOPEE_HISTORY_REVIEW_CHECKPOINT_INVALID' using errcode='22023';
      elsif v_scope.kind='return_refund' and (
        v_next_checkpoint-array['kind','checkpointDigest','pageNo','pendingDetailCount','nextListPageNo','paginationEpoch','paginationDepth']<>'{}'::jsonb
        or coalesce((v_next_checkpoint->>'pageNo')::integer,0) not between 1 and 1000000
        or coalesce((v_next_checkpoint->>'pendingDetailCount')::integer,-1) not between 0 and 100
        or ((v_next_checkpoint->>'pendingDetailCount')::integer=0 and v_next_checkpoint->'nextListPageNo'='null'::jsonb)
      ) then
        raise exception 'SHOPEE_HISTORY_RETURN_CHECKPOINT_INVALID' using errcode='22023';
      end if;
    end if;
  end if;
  insert into sellerpilot_private.cs_shopee_history_events(
    scope_id,job_id,event_key,sequence,event_type,event_digest,event_payload
  ) values(v_scope.id,p_job_id,v_event_key,v_sequence,v_event_type,v_event_digest,p_event);
  return jsonb_build_object('contract','sellerpilot-shopee-history-event/1','status','recorded',
    'scopeKey',v_scope.scope_key,'eventKey',v_event_key,'sequence',v_sequence);
end $$;

create function public.sellerpilot_read_cs_shopee_history_events_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid:=auth.uid();
  v_credential uuid;
  v_run text;
begin
  if v_owner is null or not public.sellerpilot_is_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  select scope.credential_id,scope.history_run_id into v_credential,v_run
    from sellerpilot_private.cs_shopee_history_scopes scope
   where scope.owner_id=v_owner order by scope.created_at desc,scope.id desc limit 1;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-history-events-read/1',
    'checkedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'historyRunId',v_run,
    'plannedScopes',case when v_run is null then '[]'::jsonb else coalesce((
      select jsonb_agg(scope.scope_payload order by scope.shop_id,scope.kind,scope.scope_key)
        from sellerpilot_private.cs_shopee_history_scopes scope
       where scope.owner_id=v_owner and scope.credential_id=v_credential and scope.history_run_id=v_run
    ),'[]'::jsonb) end,
    'observedEvents',case when v_run is null then '[]'::jsonb else coalesce((
      select jsonb_agg(event.event_payload order by scope.shop_id,scope.kind,scope.scope_key,event.sequence)
        from sellerpilot_private.cs_shopee_history_events event
        join sellerpilot_private.cs_shopee_history_scopes scope on scope.id=event.scope_id
       where scope.owner_id=v_owner and scope.credential_id=v_credential and scope.history_run_id=v_run
    ),'[]'::jsonb) end
  );
end $$;

create function public.sellerpilot_service_reconcile_shopee_return_revision_v1(
  p_credential_id uuid,
  p_external_ticket_id text,
  p_shop_id text,
  p_return_sn text,
  p_remote_message_id text,
  p_inbound_key text,
  p_detail_revision text,
  p_legacy_remote_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_expected_inbound text;
  v_existing_count integer;
  v_decision text;
  v_reason text;
begin
  select credential.created_by into v_owner from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='shopee' and credential.status in ('active','grace');
  if not found or coalesce(p_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(p_return_sn,'') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
     or p_external_ticket_id is distinct from format('shopee:return:%s:%s',p_shop_id,p_return_sn)
     or coalesce(p_remote_message_id,'') !~ ('^'||p_shop_id||':'||p_return_sn||':[a-f0-9]{64}$')
     or coalesce(p_detail_revision,'') !~ '^[a-f0-9]{64}$'
     or (p_legacy_remote_message_id is not null
       and p_legacy_remote_message_id !~ ('^'||p_shop_id||':'||p_return_sn||':[a-f0-9]{64}$')) then
    raise exception 'SHOPEE_RETURN_REVISION_IDENTITY_INVALID' using errcode='22023';
  end if;
  v_expected_inbound:='shopee:'||encode(extensions.digest(convert_to(
    'v2'||chr(31)||'shopee'||chr(31)||p_external_ticket_id||chr(31)||p_remote_message_id,'UTF8'
  ),'sha256'),'hex');
  if p_inbound_key is distinct from v_expected_inbound then
    raise exception 'SHOPEE_RETURN_REVISION_INBOUND_INVALID' using errcode='23514';
  end if;
  select ticket.* into v_ticket from sellerpilot_private.support_tickets ticket
   where ticket.owner_id=v_owner and ticket.channel_key='shopee'
     and ticket.external_ticket_id=p_external_ticket_id and not ticket.demo for update;
  if not found then
    return jsonb_build_object('contract','sellerpilot-shopee-return-revision-reconciliation/1',
      'decision','new_ticket','externalTicketId',p_external_ticket_id,'incomingInboundKey',p_inbound_key,
      'existingRevisionCount',0,'appendOnly',true,'replySupported',false,'reason','no_existing_ledger');
  end if;
  if v_ticket.ticket_kind is distinct from 'after_sales' or coalesce(v_ticket.reply_context,'{}'::jsonb)<>'{}'::jsonb
     or v_ticket.provider_context#>>'{replySupported}' is distinct from 'false' then
    raise exception 'SHOPEE_RETURN_REVISION_TICKET_BOUNDARY_INVALID' using errcode='23514';
  end if;
  select count(*)::integer into v_existing_count from sellerpilot_private.support_inbound_messages message
   where message.ticket_id=v_ticket.id and message.owner_id=v_owner and message.channel_key='shopee';
  if exists(select 1 from sellerpilot_private.support_inbound_messages message
    where message.ticket_id=v_ticket.id and message.owner_id=v_owner and message.channel_key='shopee'
      and (message.inbound_key=p_inbound_key or message.remote_message_id=p_remote_message_id
        or message.provider_context->>'detailRevision'=p_detail_revision)) then
    v_decision:='duplicate';v_reason:='already_recorded';
  elsif exists(select 1 from sellerpilot_private.support_inbound_messages message
    where message.ticket_id=v_ticket.id and message.owner_id=v_owner and message.channel_key='shopee'
      and nullif(message.provider_context->>'detailRevision','') is not null) then
    v_decision:='append_revision';v_reason:='new_detail_revision';
  elsif p_legacy_remote_message_id is not null and exists(select 1
    from sellerpilot_private.support_inbound_messages message
    where message.ticket_id=v_ticket.id and message.owner_id=v_owner and message.channel_key='shopee'
      and message.remote_message_id=p_legacy_remote_message_id) then
    v_decision:='append_revision';v_reason:='legacy_remote_revision_attested';
  else
    v_decision:='reconciliation_required';v_reason:='legacy_revision_unattested';
    insert into sellerpilot_private.cs_shopee_return_revision_reconciliations(
      owner_id,credential_id,ticket_id,external_ticket_id,incoming_inbound_key,incoming_detail_revision,reason
    ) values(v_owner,p_credential_id,v_ticket.id,p_external_ticket_id,p_inbound_key,p_detail_revision,v_reason)
    on conflict(owner_id,external_ticket_id,incoming_inbound_key) do nothing;
  end if;
  return jsonb_build_object('contract','sellerpilot-shopee-return-revision-reconciliation/1',
    'decision',v_decision,'externalTicketId',p_external_ticket_id,'incomingInboundKey',p_inbound_key,
    'existingRevisionCount',v_existing_count,'appendOnly',true,'replySupported',false,'reason',v_reason);
end $$;

revoke all on function public.sellerpilot_service_plan_cs_shopee_history_v1(text,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_plan_cs_shopee_history_v1(text,uuid,uuid,text,jsonb)
  to service_role;
revoke all on function public.sellerpilot_service_record_cs_shopee_history_event_v1(text,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_record_cs_shopee_history_event_v1(text,uuid,uuid,text,jsonb)
  to service_role;
revoke all on function public.sellerpilot_read_cs_shopee_history_events_v1()
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_cs_shopee_history_events_v1()
  to authenticated;
revoke all on function public.sellerpilot_service_reconcile_shopee_return_revision_v1(uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_reconcile_shopee_return_revision_v1(uuid,text,text,text,text,text,text,text)
  to service_role;


-- Reviewed source: 20260908142028_cs_shopee_history_start.sql
-- SHA256: adb3bf4f30bee3e78b1d4e512ddf6ce155adf49cc4e1e8e5bdca0089f405e3ce


do $$
begin
  if to_regclass('sellerpilot_private.cs_shopee_history_scopes') is null
     or to_regclass('sellerpilot_private.channel_market_targets') is null
     or to_regclass('sellerpilot_private.admin_users') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)') is null then
    raise exception 'SHOPEE_HISTORY_START_PREIMAGE_REQUIRED';
  end if;
end $$;

create function public.sellerpilot_service_start_cs_shopee_history_v1(
  p_owner_id uuid,
  p_request_key uuid,
  p_from bigint,
  p_to bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_target record;
  v_scope jsonb;
  v_scope_key text;
  v_scope_digest text;
  v_run_id text:='shopee-history-'||replace(p_request_key::text,'-','');
  v_window_from bigint;
  v_window_to bigint;
  v_job_id uuid;
  v_shop_count integer;
  v_review_count integer:=0;
  v_return_count integer:=0;
  v_reused_count integer:=0;
begin
  if p_owner_id is null or p_request_key is null
     or p_from<1 or p_to<=p_from or p_to-p_from>315360000
     or p_to>extract(epoch from clock_timestamp()+interval '5 minutes')::bigint
     or not exists(select 1 from sellerpilot_private.admin_users admin where admin.user_id=p_owner_id) then
    raise exception 'SHOPEE_HISTORY_START_INVALID' using errcode='22023';
  end if;
  select credential.id,credential.version,credential.vault_secret_id,
         decrypted.decrypted_secret::jsonb payload into v_credential
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where credential.created_by=p_owner_id and credential.channel='shopee'
     and credential.environment='production' and credential.status='active'
   for update of credential;
  if not found then
    return jsonb_build_object('contract','sellerpilot-shopee-history-start/1',
      'status','reconnect_required','historyRunId',v_run_id,'shopCount',0,
      'reviewScopeCount',0,'returnScopeCount',0,'queuedJobCount',0,'reusedScopeCount',0);
  end if;
  if jsonb_typeof(v_credential.payload->'shopee_targets') is distinct from 'array' then
    raise exception 'SHOPEE_HISTORY_TARGETS_INVALID' using errcode='23514';
  end if;
  select count(*)::integer into v_shop_count from (
    select distinct target.target_id
      from sellerpilot_private.channel_market_targets target
     where target.owner_id=p_owner_id and target.channel='shopee'
       and target.environment='production' and target.target_id~'^[1-9][0-9]{0,31}$'
       and target.market_code~'^[A-Z]{2}$'
       and exists(select 1 from jsonb_array_elements(v_credential.payload->'shopee_targets') item(value)
         where value->>'type'='shop' and value->>'id'=target.target_id)
  ) verified;
  if v_shop_count not between 1 and 8 then
    raise exception 'SHOPEE_HISTORY_TARGETS_INVALID' using errcode='23514';
  end if;

  for v_target in
    select distinct on(target.target_id) target.target_id,target.market_code
      from sellerpilot_private.channel_market_targets target
     where target.owner_id=p_owner_id and target.channel='shopee'
       and target.environment='production' and target.target_id~'^[1-9][0-9]{0,31}$'
       and target.market_code~'^[A-Z]{2}$'
       and exists(select 1 from jsonb_array_elements(v_credential.payload->'shopee_targets') item(value)
         where value->>'type'='shop' and value->>'id'=target.target_id)
     order by target.target_id,target.verified_at desc,target.id desc
  loop
    v_scope_key:=format('shopee:%s:product_review:cursor-corpus',v_target.target_id);
    v_scope:=jsonb_build_object(
      'scopeKey',v_scope_key,'kind','product_review','shopId',v_target.target_id,
      'country',v_target.market_code,'coverage','provider_cursor_corpus',
      'arguments',jsonb_build_object('kind','product_review','cursor','','pageSize',100,'shopId',v_target.target_id)
    );
    v_scope_digest:=encode(extensions.digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
    insert into sellerpilot_private.cs_shopee_history_scopes(
      owner_id,credential_id,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
    ) values(p_owner_id,v_credential.id,v_run_id,v_scope_key,v_scope_digest,v_target.target_id,
      v_target.market_code,'product_review','provider_cursor_corpus',v_scope)
    on conflict(owner_id,credential_id,history_run_id,scope_key) do nothing;
    if found then
      v_job_id:=public.sellerpilot_enqueue_channel_gateway_job(v_credential.id,null,'shopee','inquiries.list',
        jsonb_build_object('periodicKey','inquiries:history:'||v_run_id||':'||v_scope_key,
          'arguments',(v_scope->'arguments')||jsonb_build_object(
            'sellerpilotShopeeHistoryRunId',v_run_id,'sellerpilotShopeeScopeKey',v_scope_key,
            'sellerpilotShopeeHistorySequence',1,'sellerpilotShopeeInputCheckpointDigest',null)));
      if v_job_id is null then raise exception 'SHOPEE_HISTORY_ENQUEUE_FAILED'; end if;
      v_review_count:=v_review_count+1;
    else v_reused_count:=v_reused_count+1;
    end if;

    v_window_to:=p_to;
    while v_window_to>p_from loop
      v_window_from:=greatest(p_from,v_window_to-1296000);
      v_scope_key:=format('shopee:%s:return_refund:%s-%s',v_target.target_id,v_window_from,v_window_to);
      v_scope:=jsonb_build_object(
        'scopeKey',v_scope_key,'kind','return_refund','shopId',v_target.target_id,
        'country',v_target.market_code,'coverage','explicit_time_window',
        'arguments',jsonb_build_object('kind','return_refund','createTimeFrom',v_window_from,
          'createTimeTo',v_window_to,'pageNo',1,'pageSize',100,'shopId',v_target.target_id)
      );
      v_scope_digest:=encode(extensions.digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
      insert into sellerpilot_private.cs_shopee_history_scopes(
        owner_id,credential_id,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
      ) values(p_owner_id,v_credential.id,v_run_id,v_scope_key,v_scope_digest,v_target.target_id,
        v_target.market_code,'return_refund','explicit_time_window',v_scope)
      on conflict(owner_id,credential_id,history_run_id,scope_key) do nothing;
      if found then
        v_job_id:=public.sellerpilot_enqueue_channel_gateway_job(v_credential.id,null,'shopee','inquiries.list',
          jsonb_build_object('periodicKey','inquiries:history:'||v_run_id||':'||v_scope_key,
            'arguments',(v_scope->'arguments')||jsonb_build_object(
              'sellerpilotShopeeHistoryRunId',v_run_id,'sellerpilotShopeeScopeKey',v_scope_key,
              'sellerpilotShopeeHistorySequence',1,'sellerpilotShopeeInputCheckpointDigest',null)));
        if v_job_id is null then raise exception 'SHOPEE_HISTORY_ENQUEUE_FAILED'; end if;
        v_return_count:=v_return_count+1;
      else v_reused_count:=v_reused_count+1;
      end if;
      if v_window_from=p_from then exit; end if;
      v_window_to:=v_window_from+1;
    end loop;
  end loop;
  return jsonb_build_object('contract','sellerpilot-shopee-history-start/1',
    'status',case when v_review_count+v_return_count=0 then 'reused' else 'queued' end,
    'historyRunId',v_run_id,'shopCount',v_shop_count,'reviewScopeCount',v_review_count,
    'returnScopeCount',v_return_count,'queuedJobCount',v_review_count+v_return_count,
    'reusedScopeCount',v_reused_count);
end $$;

revoke all on function public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)
  to service_role;


-- Reviewed source: 20260908142029_cs_shopee_atomic_history_completion.sql
-- SHA256: 01491db0840bd5b91de55ee4ff78af61de38720f67b7112a11f547d062ac4c89


do $$
begin
  if to_regprocedure('public.sellerpilot_service_complete_serverless_cs_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.sellerpilot_service_record_cs_shopee_history_event_v1(text,uuid,uuid,text,jsonb)') is null then
    raise exception 'SHOPEE_HISTORY_COMPLETION_PREIMAGE_REQUIRED';
  end if;
end $$;

create function public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null,
  p_history_run_id text default null,
  p_history_event jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion jsonb;
  v_history jsonb;
begin
  if coalesce(p_history_run_id,'') !~ '^[A-Za-z0-9:_-]{1,120}$'
     or jsonb_typeof(p_history_event) is distinct from 'object' then
    raise exception 'SHOPEE_HISTORY_COMPLETION_EVENT_REQUIRED' using errcode='22023';
  end if;
  v_completion:=public.sellerpilot_service_complete_serverless_cs_transaction(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
    p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  if coalesce(v_completion->>'status','')<>'completed' then return v_completion; end if;
  v_history:=public.sellerpilot_service_record_cs_shopee_history_event_v1(
    p_token_hash,p_job_id,p_claim_token,p_history_run_id,p_history_event
  );
  if coalesce(v_history->>'contract','')<>'sellerpilot-shopee-history-event/1'
     or coalesce(v_history->>'status','') not in ('recorded','duplicate') then
    raise exception 'SHOPEE_HISTORY_COMPLETION_EVENT_FAILED' using errcode='55000';
  end if;
  return v_completion||jsonb_build_object(
    'shopeeHistoryEventStatus',v_history->>'status',
    'shopeeHistoryEventSequence',(v_history->>'sequence')::integer
  );
end $$;

revoke all on function public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,jsonb
) to service_role;


-- Reviewed source: 20260908145331_cs_shopee_history_request_invariants.sql
-- SHA256: 126e546ae02965953e2f4e5fc80d0face84d47a4826d6c9e57bdaec86dea8ceb


do $$
begin
  if to_regclass('sellerpilot_private.cs_shopee_history_scopes') is null
     or to_regclass('sellerpilot_private.cs_shopee_history_events') is null
     or to_regclass('sellerpilot_private.channel_market_targets') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)') is null then
    raise exception 'SHOPEE_HISTORY_INVARIANT_PREIMAGE_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.cs_shopee_history_start_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  history_run_id text not null check (history_run_id ~ '^shopee-history-[a-f0-9]{32}$'),
  from_epoch bigint not null check (from_epoch > 0),
  to_epoch bigint not null check (to_epoch > from_epoch),
  target_plan_digest text not null check (target_plan_digest ~ '^[a-f0-9]{64}$'),
  target_plan jsonb not null check (jsonb_typeof(target_plan) = 'array'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,request_key)
);

alter table sellerpilot_private.cs_shopee_history_start_requests enable row level security;
revoke all on sellerpilot_private.cs_shopee_history_start_requests
  from public,anon,authenticated,service_role;

create function sellerpilot_private.cs_shopee_history_scope_binding_guard_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_market_count integer;
  v_vault_count integer;
begin
  select decrypted.decrypted_secret::jsonb into v_payload
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where credential.id=new.credential_id and credential.created_by=new.owner_id
     and credential.channel='shopee' and credential.environment='production'
     and credential.status in ('active','grace');
  if not found or jsonb_typeof(v_payload->'shopee_targets') is distinct from 'array' then
    raise exception 'SHOPEE_HISTORY_SCOPE_CREDENTIAL_MISMATCH' using errcode='23514';
  end if;
  select count(*)::integer into v_vault_count
    from jsonb_array_elements(v_payload->'shopee_targets') item(value)
   where item.value->>'type'='shop' and item.value->>'id'=new.shop_id;
  select count(*)::integer into v_market_count
    from sellerpilot_private.channel_market_targets target
   where target.owner_id=new.owner_id and target.credential_id=new.credential_id
     and target.channel='shopee' and target.environment='production'
     and target.target_id=new.shop_id and target.market_code=new.country;
  if v_vault_count<>1 or v_market_count<>1
     or exists(select 1 from sellerpilot_private.channel_market_targets target
       where target.owner_id=new.owner_id and target.credential_id=new.credential_id
         and target.channel='shopee' and target.environment='production'
         and target.target_id=new.shop_id and target.market_code<>new.country) then
    raise exception 'SHOPEE_HISTORY_SCOPE_TARGET_MISMATCH' using errcode='23514';
  end if;
  return new;
end $$;

create trigger cs_shopee_history_scope_binding_guard_v1
before insert or update of owner_id,credential_id,shop_id,country
on sellerpilot_private.cs_shopee_history_scopes
for each row execute function sellerpilot_private.cs_shopee_history_scope_binding_guard_v1();

create function sellerpilot_private.cs_shopee_history_event_job_guard_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope sellerpilot_private.cs_shopee_history_scopes%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_arguments jsonb;
  v_sequence_text text;
  v_request_checkpoint text;
  v_event_checkpoint text;
begin
  select scope.* into v_scope from sellerpilot_private.cs_shopee_history_scopes scope
   where scope.id=new.scope_id;
  select job.* into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=new.job_id;
  v_arguments:=v_job.request_payload->'arguments';
  v_sequence_text:=v_arguments->>'sellerpilotShopeeHistorySequence';
  v_request_checkpoint:=nullif(v_arguments->>'sellerpilotShopeeInputCheckpointDigest','');
  v_event_checkpoint:=case when new.event_type='page'
    then nullif(new.event_payload->>'inputCheckpointDigest','')
    else nullif(new.event_payload->>'checkpointDigest','') end;
  if v_scope.id is null or v_job.id is null or jsonb_typeof(v_arguments) is distinct from 'object'
     or v_job.credential_id is distinct from v_scope.credential_id
     or v_job.created_by is distinct from v_scope.owner_id
     or v_arguments->>'sellerpilotShopeeHistoryRunId' is distinct from v_scope.history_run_id
     or v_arguments->>'sellerpilotShopeeScopeKey' is distinct from v_scope.scope_key
     or v_arguments->>'shopId' is distinct from v_scope.shop_id
     or v_arguments->>'kind' is distinct from v_scope.kind
     or coalesce(v_sequence_text,'') !~ '^[1-9][0-9]{0,6}$'
     or v_sequence_text::integer is distinct from new.sequence
     or v_request_checkpoint is distinct from v_event_checkpoint then
    raise exception 'SHOPEE_HISTORY_EVENT_JOB_METADATA_MISMATCH' using errcode='23514';
  end if;
  return new;
end $$;

create trigger cs_shopee_history_event_job_guard_v1
before insert or update of scope_id,job_id,sequence,event_type,event_payload
on sellerpilot_private.cs_shopee_history_events
for each row execute function sellerpilot_private.cs_shopee_history_event_job_guard_v1();

create or replace function public.sellerpilot_service_start_cs_shopee_history_v1(
  p_owner_id uuid,p_request_key uuid,p_from bigint,p_to bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_target record;
  v_request sellerpilot_private.cs_shopee_history_start_requests%rowtype;
  v_scope jsonb;
  v_scope_key text;
  v_scope_digest text;
  v_existing_scope_digest text;
  v_run_id text:='shopee-history-'||replace(p_request_key::text,'-','');
  v_target_plan jsonb;
  v_target_plan_digest text;
  v_window_from bigint;
  v_window_to bigint;
  v_job_id uuid;
  v_shop_count integer;
  v_market_count integer;
  v_vault_shop_count integer;
  v_vault_distinct_count integer;
  v_active_credential_count integer;
  v_review_count integer:=0;
  v_return_count integer:=0;
  v_reused_count integer:=0;
  v_total_scope_count integer;
  v_request_inserted boolean;
begin
  if p_owner_id is null or p_request_key is null or p_from is null or p_to is null
     or p_from<1 or p_to<=p_from or p_to-p_from>315360000
     or p_to>extract(epoch from clock_timestamp()+interval '5 minutes')::bigint
     or not exists(select 1 from sellerpilot_private.admin_users admin where admin.user_id=p_owner_id) then
    raise exception 'SHOPEE_HISTORY_START_INVALID' using errcode='22023';
  end if;
  select count(*)::integer into v_active_credential_count
    from sellerpilot_private.channel_credentials credential
   where credential.created_by=p_owner_id and credential.channel='shopee'
     and credential.environment='production' and credential.status='active';
  if v_active_credential_count=0 then
    return jsonb_build_object('contract','sellerpilot-shopee-history-start/1',
      'status','reconnect_required','historyRunId',v_run_id,'shopCount',0,
      'reviewScopeCount',0,'returnScopeCount',0,'queuedJobCount',0,'reusedScopeCount',0);
  elsif v_active_credential_count<>1 then
    raise exception 'SHOPEE_HISTORY_CREDENTIAL_AMBIGUOUS' using errcode='23514';
  end if;
  select credential.id,credential.version,credential.vault_secret_id,
         decrypted.decrypted_secret::jsonb payload into v_credential
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where credential.created_by=p_owner_id and credential.channel='shopee'
     and credential.environment='production' and credential.status='active'
   for update of credential;
  if not found or jsonb_typeof(v_credential.payload->'shopee_targets') is distinct from 'array' then
    raise exception 'SHOPEE_HISTORY_TARGETS_INVALID' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(v_credential.payload->'shopee_targets') item(value)
    where jsonb_typeof(item.value) is distinct from 'object'
       or item.value->>'type' not in ('shop','merchant')
       or coalesce(item.value->>'id','') !~ '^[1-9][0-9]{0,31}$') then
    raise exception 'SHOPEE_HISTORY_TARGETS_INVALID' using errcode='23514';
  end if;
  select count(*)::integer,count(distinct item.value->>'id')::integer
    into v_vault_shop_count,v_vault_distinct_count
    from jsonb_array_elements(v_credential.payload->'shopee_targets') item(value)
   where item.value->>'type'='shop';
  if v_vault_shop_count not between 1 and 8 or v_vault_shop_count<>v_vault_distinct_count then
    raise exception 'SHOPEE_HISTORY_TARGETS_INVALID' using errcode='23514';
  end if;
  select count(*)::integer,count(distinct target.target_id)::integer,
         jsonb_agg(jsonb_build_object('shopId',target.target_id,'country',target.market_code)
           order by target.target_id,target.market_code)
    into v_market_count,v_shop_count,v_target_plan
    from sellerpilot_private.channel_market_targets target
   where target.owner_id=p_owner_id and target.credential_id=v_credential.id
     and target.channel='shopee' and target.environment='production'
     and target.target_id~'^[1-9][0-9]{0,31}$' and target.market_code~'^[A-Z]{2}$'
     and exists(select 1 from jsonb_array_elements(v_credential.payload->'shopee_targets') item(value)
       where item.value->>'type'='shop' and item.value->>'id'=target.target_id);
  if v_market_count<>v_vault_shop_count or v_shop_count<>v_vault_shop_count
     or jsonb_typeof(v_target_plan) is distinct from 'array' then
    raise exception 'SHOPEE_HISTORY_TARGET_COUNTRY_AMBIGUOUS' using errcode='23514';
  end if;
  v_target_plan_digest:=encode(extensions.digest(convert_to(v_target_plan::text,'UTF8'),'sha256'),'hex');

  insert into sellerpilot_private.cs_shopee_history_start_requests(
    owner_id,request_key,credential_id,history_run_id,from_epoch,to_epoch,target_plan_digest,target_plan
  ) values(p_owner_id,p_request_key,v_credential.id,v_run_id,p_from,p_to,v_target_plan_digest,v_target_plan)
  on conflict(owner_id,request_key) do nothing;
  v_request_inserted:=found;
  if not v_request_inserted then
    select request.* into v_request
      from sellerpilot_private.cs_shopee_history_start_requests request
     where request.owner_id=p_owner_id and request.request_key=p_request_key for update;
    if v_request.credential_id is distinct from v_credential.id
       or v_request.history_run_id is distinct from v_run_id
       or v_request.from_epoch is distinct from p_from or v_request.to_epoch is distinct from p_to
       or v_request.target_plan_digest is distinct from v_target_plan_digest
       or v_request.target_plan is distinct from v_target_plan then
      raise exception 'SHOPEE_HISTORY_REQUEST_REUSE_MISMATCH' using errcode='23514';
    end if;
  end if;
  if exists(select 1 from sellerpilot_private.cs_shopee_history_scopes scope
    where scope.owner_id=p_owner_id and scope.history_run_id=v_run_id
      and scope.credential_id<>v_credential.id) then
    raise exception 'SHOPEE_HISTORY_REQUEST_CREDENTIAL_MISMATCH' using errcode='23514';
  end if;

  for v_target in select value->>'shopId' shop_id,value->>'country' country
    from jsonb_array_elements(v_target_plan)
  loop
    v_scope_key:=format('shopee:%s:product_review:cursor-corpus',v_target.shop_id);
    v_scope:=jsonb_build_object('scopeKey',v_scope_key,'kind','product_review','shopId',v_target.shop_id,
      'country',v_target.country,'coverage','provider_cursor_corpus','arguments',
      jsonb_build_object('kind','product_review','cursor','','pageSize',100,'shopId',v_target.shop_id));
    v_scope_digest:=encode(extensions.digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
    insert into sellerpilot_private.cs_shopee_history_scopes(
      owner_id,credential_id,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
    ) values(p_owner_id,v_credential.id,v_run_id,v_scope_key,v_scope_digest,v_target.shop_id,
      v_target.country,'product_review','provider_cursor_corpus',v_scope)
    on conflict(owner_id,credential_id,history_run_id,scope_key) do nothing;
    if found then
      v_job_id:=public.sellerpilot_enqueue_channel_gateway_job(v_credential.id,null,'shopee','inquiries.list',
        jsonb_build_object('periodicKey','inquiries:history:'||v_run_id||':'||v_scope_key,
          'arguments',(v_scope->'arguments')||jsonb_build_object('sellerpilotShopeeHistoryRunId',v_run_id,
            'sellerpilotShopeeScopeKey',v_scope_key,'sellerpilotShopeeHistorySequence',1,
            'sellerpilotShopeeInputCheckpointDigest',null)));
      if v_job_id is null then raise exception 'SHOPEE_HISTORY_ENQUEUE_FAILED'; end if;
      v_review_count:=v_review_count+1;
    else
      select scope.scope_digest into v_existing_scope_digest from sellerpilot_private.cs_shopee_history_scopes scope
       where scope.owner_id=p_owner_id and scope.credential_id=v_credential.id
         and scope.history_run_id=v_run_id and scope.scope_key=v_scope_key;
      if v_existing_scope_digest is distinct from v_scope_digest then
        raise exception 'SHOPEE_HISTORY_SCOPE_REUSE_MISMATCH' using errcode='23514';
      end if;
      v_reused_count:=v_reused_count+1;
    end if;

    v_window_to:=p_to;
    while v_window_to>p_from loop
      v_window_from:=greatest(p_from,v_window_to-1296000);
      v_scope_key:=format('shopee:%s:return_refund:%s-%s',v_target.shop_id,v_window_from,v_window_to);
      v_scope:=jsonb_build_object('scopeKey',v_scope_key,'kind','return_refund','shopId',v_target.shop_id,
        'country',v_target.country,'coverage','explicit_time_window','arguments',
        jsonb_build_object('kind','return_refund','createTimeFrom',v_window_from,'createTimeTo',v_window_to,
          'pageNo',1,'pageSize',100,'shopId',v_target.shop_id));
      v_scope_digest:=encode(extensions.digest(convert_to(v_scope::text,'UTF8'),'sha256'),'hex');
      insert into sellerpilot_private.cs_shopee_history_scopes(
        owner_id,credential_id,history_run_id,scope_key,scope_digest,shop_id,country,kind,coverage,scope_payload
      ) values(p_owner_id,v_credential.id,v_run_id,v_scope_key,v_scope_digest,v_target.shop_id,
        v_target.country,'return_refund','explicit_time_window',v_scope)
      on conflict(owner_id,credential_id,history_run_id,scope_key) do nothing;
      if found then
        v_job_id:=public.sellerpilot_enqueue_channel_gateway_job(v_credential.id,null,'shopee','inquiries.list',
          jsonb_build_object('periodicKey','inquiries:history:'||v_run_id||':'||v_scope_key,
            'arguments',(v_scope->'arguments')||jsonb_build_object('sellerpilotShopeeHistoryRunId',v_run_id,
              'sellerpilotShopeeScopeKey',v_scope_key,'sellerpilotShopeeHistorySequence',1,
              'sellerpilotShopeeInputCheckpointDigest',null)));
        if v_job_id is null then raise exception 'SHOPEE_HISTORY_ENQUEUE_FAILED'; end if;
        v_return_count:=v_return_count+1;
      else
        select scope.scope_digest into v_existing_scope_digest from sellerpilot_private.cs_shopee_history_scopes scope
         where scope.owner_id=p_owner_id and scope.credential_id=v_credential.id
           and scope.history_run_id=v_run_id and scope.scope_key=v_scope_key;
        if v_existing_scope_digest is distinct from v_scope_digest then
          raise exception 'SHOPEE_HISTORY_SCOPE_REUSE_MISMATCH' using errcode='23514';
        end if;
        v_reused_count:=v_reused_count+1;
      end if;
      if v_window_from=p_from then exit; end if;
      v_window_to:=v_window_from+1;
    end loop;
  end loop;
  select count(*)::integer into v_total_scope_count from sellerpilot_private.cs_shopee_history_scopes scope
   where scope.owner_id=p_owner_id and scope.credential_id=v_credential.id and scope.history_run_id=v_run_id;
  if v_total_scope_count<>v_review_count+v_return_count+v_reused_count then
    raise exception 'SHOPEE_HISTORY_REQUEST_SCOPE_SET_MISMATCH' using errcode='23514';
  end if;
  return jsonb_build_object('contract','sellerpilot-shopee-history-start/1',
    'status',case when v_review_count+v_return_count=0 then 'reused' else 'queued' end,
    'historyRunId',v_run_id,'shopCount',v_shop_count,'reviewScopeCount',v_review_count,
    'returnScopeCount',v_return_count,'queuedJobCount',v_review_count+v_return_count,
    'reusedScopeCount',v_reused_count);
end $$;

revoke all on function sellerpilot_private.cs_shopee_history_scope_binding_guard_v1()
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.cs_shopee_history_event_job_guard_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)
  to service_role;


-- Reviewed source: 20260908151735_cs_shopee_history_date_intent_cutoff.sql
-- SHA256: 87ebc67918a18621b4cdc1403fb07442bf533e60ebfa2c7bfda415e8948eb02c


do $$
begin
  if to_regclass('sellerpilot_private.cs_shopee_history_start_requests') is null
     or to_regprocedure('public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)') is null then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_PREIMAGE_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.cs_shopee_history_request_intents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  from_date date not null,
  to_date date not null,
  from_epoch bigint not null check (from_epoch > 0),
  cutoff_epoch bigint not null check (cutoff_epoch > from_epoch),
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,request_key),
  check (to_date >= from_date),
  check (to_date-from_date <= 3650)
);

alter table sellerpilot_private.cs_shopee_history_request_intents enable row level security;
revoke all on sellerpilot_private.cs_shopee_history_request_intents
  from public,anon,authenticated,service_role;

-- Preserve an exact cutoff for any local row created between the preceding
-- invariant migration and this follow-up.
insert into sellerpilot_private.cs_shopee_history_request_intents(
  owner_id,request_key,from_date,to_date,from_epoch,cutoff_epoch,created_at
)
select request.owner_id,request.request_key,
       (pg_catalog.to_timestamp(request.from_epoch) at time zone 'Asia/Seoul')::date,
       (pg_catalog.to_timestamp(request.to_epoch) at time zone 'Asia/Seoul')::date,
       request.from_epoch,request.to_epoch,request.created_at
  from sellerpilot_private.cs_shopee_history_start_requests request
on conflict(owner_id,request_key) do nothing;

create function public.sellerpilot_service_start_cs_shopee_history_v2(
  p_owner_id uuid,
  p_request_key uuid,
  p_from_date date,
  p_to_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_today date;
  v_from_epoch bigint;
  v_candidate_cutoff bigint;
  v_intent sellerpilot_private.cs_shopee_history_request_intents%rowtype;
begin
  v_today:=(v_now at time zone 'Asia/Seoul')::date;
  if p_owner_id is null or p_request_key is null or p_from_date is null or p_to_date is null
     or p_from_date>p_to_date or p_to_date>v_today or p_to_date-p_from_date>3650 then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_INVALID' using errcode='22023';
  end if;
  v_from_epoch:=floor(extract(epoch from
    (p_from_date::timestamp at time zone 'Asia/Seoul')))::bigint;
  v_candidate_cutoff:=case when p_to_date=v_today
    then floor(extract(epoch from v_now))::bigint
    else floor(extract(epoch from
      (((p_to_date+1)::timestamp at time zone 'Asia/Seoul')-interval '1 second')))::bigint end;
  if v_from_epoch<1 or v_candidate_cutoff<=v_from_epoch
     or v_candidate_cutoff-v_from_epoch>315360000 then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_INVALID' using errcode='22023';
  end if;

  insert into sellerpilot_private.cs_shopee_history_request_intents(
    owner_id,request_key,from_date,to_date,from_epoch,cutoff_epoch
  ) values(p_owner_id,p_request_key,p_from_date,p_to_date,v_from_epoch,v_candidate_cutoff)
  on conflict(owner_id,request_key) do nothing;

  select intent.* into v_intent
    from sellerpilot_private.cs_shopee_history_request_intents intent
   where intent.owner_id=p_owner_id and intent.request_key=p_request_key
   for update;
  if not found or v_intent.from_date is distinct from p_from_date
     or v_intent.to_date is distinct from p_to_date
     or v_intent.from_epoch is distinct from v_from_epoch then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_REUSE_MISMATCH' using errcode='23514';
  end if;

  return public.sellerpilot_service_start_cs_shopee_history_v1(
    p_owner_id,p_request_key,v_intent.from_epoch,v_intent.cutoff_epoch
  );
end $$;

revoke all on function public.sellerpilot_service_start_cs_shopee_history_v1(
  uuid,uuid,bigint,bigint
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_start_cs_shopee_history_v2(
  uuid,uuid,date,date
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_start_cs_shopee_history_v2(
  uuid,uuid,date,date
) to service_role;


-- Reviewed source: 20260909130916_cs_shopee_history_recovery.sql
-- SHA256: 05f36fee09b50131ba9c7e7b752d0cf59bcbfb6f84a08f50fd903ddb510bb38a


do $$
begin
  if to_regclass('sellerpilot_private.cs_shopee_history_scopes') is null
     or to_regclass('sellerpilot_private.cs_shopee_history_events') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.admin_users') is null
     or to_regprocedure('public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)') is null then
    raise exception 'SHOPEE_HISTORY_RECOVERY_PREIMAGE_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.cs_shopee_history_recovery_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  history_run_id text not null check (history_run_id ~ '^[A-Za-z0-9:_-]{1,120}$'),
  scope_key text not null check (length(scope_key) between 1 and 200),
  source_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  recovery_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  recovery_attempt integer not null check (recovery_attempt between 1 and 3),
  input_checkpoint_digest text check (input_checkpoint_digest is null
    or input_checkpoint_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_key),
  unique(source_job_id),
  unique(recovery_job_id)
);

alter table sellerpilot_private.cs_shopee_history_recovery_requests enable row level security;
revoke all on sellerpilot_private.cs_shopee_history_recovery_requests
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_resume_cs_shopee_history_v1(
  p_actor_id uuid,
  p_request_key uuid,
  p_history_run_id text,
  p_scope_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope sellerpilot_private.cs_shopee_history_scopes%rowtype;
  v_event sellerpilot_private.cs_shopee_history_events%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing sellerpilot_private.cs_shopee_history_recovery_requests%rowtype;
  v_args jsonb;
  v_checkpoint jsonb;
  v_checkpoint_digest text;
  v_cursor_digest text;
  v_previous_attempt integer;
  v_recovery_count integer;
  v_attempt integer;
  v_next_args jsonb;
  v_next_job_id uuid;
  v_scope_count integer;
begin
  if current_setting('role',true) is distinct from 'service_role'
     or p_actor_id is null or p_request_key is null
     or coalesce(p_history_run_id,'') !~ '^[A-Za-z0-9:_-]{1,120}$'
     or length(coalesce(p_scope_key,'')) not between 1 and 200
     or not exists(select 1 from sellerpilot_private.admin_users admin
       where admin.user_id=p_actor_id) then
    raise exception 'SHOPEE_HISTORY_RECOVERY_INVALID' using errcode='22023';
  end if;

  select request.* into v_existing
    from sellerpilot_private.cs_shopee_history_recovery_requests request
   where request.actor_id=p_actor_id and request.request_key=p_request_key;
  if found then
    if v_existing.history_run_id is distinct from p_history_run_id
       or v_existing.scope_key is distinct from p_scope_key then
      raise exception 'SHOPEE_HISTORY_RECOVERY_REQUEST_REUSE_MISMATCH' using errcode='23514';
    end if;
    return jsonb_build_object(
      'contract','sellerpilot-shopee-history-recovery/1','status','reused',
      'historyRunId',v_existing.history_run_id,'scopeKey',v_existing.scope_key,
      'recoveryJobId',v_existing.recovery_job_id,'recoveryAttempt',v_existing.recovery_attempt,
      'inputCheckpointDigest',v_existing.input_checkpoint_digest
    );
  end if;

  select count(*)::integer into v_scope_count
    from sellerpilot_private.cs_shopee_history_scopes scope
   where scope.history_run_id=p_history_run_id and scope.scope_key=p_scope_key;
  if v_scope_count=0 then
    raise exception 'SHOPEE_HISTORY_RECOVERY_SCOPE_NOT_FOUND' using errcode='P0002';
  elsif v_scope_count<>1 then
    raise exception 'SHOPEE_HISTORY_RECOVERY_SCOPE_AMBIGUOUS' using errcode='23514';
  end if;
  select scope.* into v_scope
    from sellerpilot_private.cs_shopee_history_scopes scope
   where scope.history_run_id=p_history_run_id
     and scope.scope_key=p_scope_key
   for update;
  if not found then
    raise exception 'SHOPEE_HISTORY_RECOVERY_SCOPE_NOT_FOUND' using errcode='P0002';
  end if;

  -- Recheck after the scope lock so concurrent retries of the same request key
  -- return the first committed recovery job instead of racing the unique key.
  select request.* into v_existing
    from sellerpilot_private.cs_shopee_history_recovery_requests request
   where request.actor_id=p_actor_id and request.request_key=p_request_key;
  if found then
    if v_existing.history_run_id is distinct from p_history_run_id
       or v_existing.scope_key is distinct from p_scope_key then
      raise exception 'SHOPEE_HISTORY_RECOVERY_REQUEST_REUSE_MISMATCH' using errcode='23514';
    end if;
    return jsonb_build_object(
      'contract','sellerpilot-shopee-history-recovery/1','status','reused',
      'historyRunId',v_existing.history_run_id,'scopeKey',v_existing.scope_key,
      'recoveryJobId',v_existing.recovery_job_id,'recoveryAttempt',v_existing.recovery_attempt,
      'inputCheckpointDigest',v_existing.input_checkpoint_digest
    );
  end if;

  select event.* into v_event
    from sellerpilot_private.cs_shopee_history_events event
   where event.scope_id=v_scope.id
   order by event.sequence desc limit 1;
  if not found or v_event.event_type<>'interruption'
     or coalesce(v_event.event_payload->>'reason','') not in ('failed','authorization_required') then
    raise exception 'SHOPEE_HISTORY_RECOVERY_INTERRUPTION_REQUIRED' using errcode='23514';
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=v_event.job_id;
  v_args:=v_job.request_payload->'arguments';
  v_checkpoint_digest:=nullif(v_event.event_payload->>'checkpointDigest','');
  if not found or v_job.created_by is distinct from v_scope.owner_id
     or v_job.credential_id is distinct from v_scope.credential_id
     or v_job.channel<>'shopee' or v_job.operation<>'inquiries.list' or v_job.status<>'failed'
     or jsonb_typeof(v_args) is distinct from 'object'
     or v_args->>'sellerpilotShopeeHistoryRunId' is distinct from v_scope.history_run_id
     or v_args->>'sellerpilotShopeeScopeKey' is distinct from v_scope.scope_key
     or v_args->>'shopId' is distinct from v_scope.shop_id
     or v_args->>'kind' is distinct from v_scope.kind
     or coalesce(v_args->>'sellerpilotShopeeHistorySequence','') !~ '^[1-9][0-9]{0,6}$'
     or (v_args->>'sellerpilotShopeeHistorySequence')::integer is distinct from v_event.sequence
     or nullif(v_args->>'sellerpilotShopeeInputCheckpointDigest','') is distinct from v_checkpoint_digest
     or v_args ?| array['reply','commentId','itemId'] then
    raise exception 'SHOPEE_HISTORY_RECOVERY_JOB_MISMATCH' using errcode='23514';
  end if;

  select page.event_payload->'nextCheckpoint' into v_checkpoint
    from sellerpilot_private.cs_shopee_history_events page
   where page.scope_id=v_scope.id and page.event_type='page'
   order by page.sequence desc limit 1;
  if found and v_checkpoint='null'::jsonb then
    raise exception 'SHOPEE_HISTORY_RECOVERY_SCOPE_COMPLETE' using errcode='23514';
  end if;
  if nullif(v_checkpoint->>'checkpointDigest','') is distinct from v_checkpoint_digest then
    raise exception 'SHOPEE_HISTORY_RECOVERY_CHECKPOINT_STALE' using errcode='23514';
  end if;

  if v_scope.kind='product_review' then
    if v_args-array['kind','shopId','cursor','pageSize','sellerpilotShopeeScopeKey',
         'sellerpilotShopeeHistoryRunId','sellerpilotShopeeHistorySequence',
         'sellerpilotShopeeInputCheckpointDigest','sellerpilotPaginationDepth',
         'sellerpilotPaginationEpoch','sellerpilotPaginationTrail',
         'sellerpilotShopeeHistoryRecoveryContract','sellerpilotShopeeHistoryRecoveryAttempt',
         'sellerpilotShopeeHistoryRecoveryOfJobId']<>'{}'::jsonb
       or jsonb_typeof(v_args->'cursor') is distinct from 'string'
       or length(v_args->>'cursor')>500 or coalesce((v_args->>'pageSize')::integer,0)<>100 then
      raise exception 'SHOPEE_HISTORY_RECOVERY_REVIEW_ARGUMENTS_INVALID' using errcode='23514';
    end if;
    if v_checkpoint is not null then
      v_cursor_digest:=encode(extensions.digest(convert_to(to_jsonb(v_args->>'cursor')::text,'UTF8'),'sha256'),'hex');
      if coalesce(v_args->>'cursor','')='' or v_cursor_digest is distinct from v_checkpoint->>'cursorDigest'
         or (v_args->>'sellerpilotPaginationDepth')::integer is distinct from
           (v_checkpoint->>'paginationDepth')::integer
         or (v_args->>'sellerpilotPaginationEpoch')::bigint is distinct from
           (v_checkpoint->>'paginationEpoch')::bigint then
        raise exception 'SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH' using errcode='23514';
      end if;
    end if;
  else
    if v_args-array['kind','shopId','createTimeFrom','createTimeTo','pageNo','pageSize','returnQueue','nextPageNo',
         'sellerpilotShopeeScopeKey','sellerpilotShopeeHistoryRunId','sellerpilotShopeeHistorySequence',
         'sellerpilotShopeeInputCheckpointDigest','sellerpilotPaginationDepth','sellerpilotPaginationEpoch',
         'sellerpilotPaginationTrail','sellerpilotShopeeHistoryRecoveryContract',
         'sellerpilotShopeeHistoryRecoveryAttempt','sellerpilotShopeeHistoryRecoveryOfJobId']<>'{}'::jsonb
       or (v_args->>'createTimeFrom')::bigint is distinct from
         (v_scope.scope_payload#>>'{arguments,createTimeFrom}')::bigint
       or (v_args->>'createTimeTo')::bigint is distinct from
         (v_scope.scope_payload#>>'{arguments,createTimeTo}')::bigint
       or coalesce((v_args->>'pageSize')::integer,0)<>100 then
      raise exception 'SHOPEE_HISTORY_RECOVERY_WINDOW_MISMATCH' using errcode='23514';
    end if;
    if v_checkpoint is not null and (
       (v_args->>'pageNo')::integer is distinct from (v_checkpoint->>'pageNo')::integer
       or coalesce(jsonb_array_length(v_args->'returnQueue'),0) is distinct from
         (v_checkpoint->>'pendingDetailCount')::integer
       or case when v_args ? 'nextPageNo' then (v_args->>'nextPageNo')::integer else null end
         is distinct from case when v_checkpoint->'nextListPageNo'<>'null'::jsonb
           then (v_checkpoint->>'nextListPageNo')::integer else null end
       or (v_args->>'sellerpilotPaginationDepth')::integer is distinct from
         (v_checkpoint->>'paginationDepth')::integer
       or (v_args->>'sellerpilotPaginationEpoch')::bigint is distinct from
         (v_checkpoint->>'paginationEpoch')::bigint) then
      raise exception 'SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH' using errcode='23514';
    end if;
  end if;

  if exists(select 1 from sellerpilot_private.channel_gateway_jobs active
    where active.created_by=v_scope.owner_id and active.channel='shopee' and active.operation='inquiries.list'
      and active.request_payload#>>'{arguments,sellerpilotShopeeHistoryRunId}'=p_history_run_id
      and active.request_payload#>>'{arguments,sellerpilotShopeeScopeKey}'=p_scope_key
      and (active.status in ('queued','running')
        or active.status in ('succeeded','reconciliation_required') and not exists(
          select 1 from sellerpilot_private.cs_shopee_history_events observed
           where observed.job_id=active.id))) then
    raise exception 'SHOPEE_HISTORY_RECOVERY_ACTIVE_JOB_EXISTS' using errcode='23514';
  end if;

  select count(*)::integer into v_recovery_count
    from sellerpilot_private.channel_gateway_jobs prior
   where prior.created_by=v_scope.owner_id and prior.channel='shopee' and prior.operation='inquiries.list'
     and prior.request_payload#>>'{arguments,sellerpilotShopeeHistoryRunId}'=p_history_run_id
     and prior.request_payload#>>'{arguments,sellerpilotShopeeScopeKey}'=p_scope_key
     and prior.request_payload#>>'{arguments,sellerpilotShopeeHistoryRecoveryContract}'=
       'sellerpilot-shopee-history-recovery/1';
  begin
    v_previous_attempt:=coalesce((v_args->>'sellerpilotShopeeHistoryRecoveryAttempt')::integer,0);
  exception when others then
    raise exception 'SHOPEE_HISTORY_RECOVERY_ATTEMPT_INVALID' using errcode='23514';
  end;
  if v_previous_attempt<>v_recovery_count or v_previous_attempt not between 0 and 3 then
    raise exception 'SHOPEE_HISTORY_RECOVERY_ATTEMPT_MISMATCH' using errcode='23514';
  end if;
  v_attempt:=v_previous_attempt+1;
  if v_attempt>3 then
    raise exception 'SHOPEE_HISTORY_RECOVERY_ATTEMPTS_EXHAUSTED' using errcode='23514';
  end if;

  v_next_args:=v_args||jsonb_build_object(
    'sellerpilotShopeeHistorySequence',v_event.sequence+1,
    'sellerpilotShopeeHistoryRecoveryContract','sellerpilot-shopee-history-recovery/1',
    'sellerpilotShopeeHistoryRecoveryAttempt',v_attempt,
    'sellerpilotShopeeHistoryRecoveryOfJobId',v_job.id
  );
  v_next_job_id:=public.sellerpilot_enqueue_channel_gateway_job(
    v_scope.credential_id,null,'shopee','inquiries.list',jsonb_build_object(
      'periodicKey',format('inquiries:history:resume:%s:%s',v_job.id,v_attempt),
      'arguments',v_next_args
    )
  );
  if v_next_job_id is null then raise exception 'SHOPEE_HISTORY_RECOVERY_ENQUEUE_FAILED'; end if;

  insert into sellerpilot_private.cs_shopee_history_recovery_requests(
    actor_id,owner_id,request_key,credential_id,history_run_id,scope_key,source_job_id,
    recovery_job_id,recovery_attempt,input_checkpoint_digest
  ) values(p_actor_id,v_scope.owner_id,p_request_key,v_scope.credential_id,p_history_run_id,p_scope_key,
    v_job.id,v_next_job_id,v_attempt,v_checkpoint_digest);
  return jsonb_build_object(
    'contract','sellerpilot-shopee-history-recovery/1','status','queued',
    'historyRunId',p_history_run_id,'scopeKey',p_scope_key,
    'recoveryJobId',v_next_job_id,'recoveryAttempt',v_attempt,
    'inputCheckpointDigest',v_checkpoint_digest
  );
end $$;

revoke all on function public.sellerpilot_service_resume_cs_shopee_history_v1(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_resume_cs_shopee_history_v1(uuid,uuid,text,text)
  to service_role;


-- Reviewed source: 20260909131448_cs_shopee_reply_readback.sql
-- SHA256: 4ddd12c94237b68012f66bb449cc232995d0ae934bc128829c18c12739711d6c


create table sellerpilot_private.shopee_reply_readback_attempts (
  delivery_id uuid not null
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  attempt integer not null check (attempt between 1 and 3),
  source_job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  next_readback_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  ticket_id uuid not null
    references sellerpilot_private.support_tickets(id) on delete restrict,
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  comment_id text not null check (comment_id ~ '^[1-9][0-9]{0,18}$'),
  item_id text not null check (item_id ~ '^[1-9][0-9]{0,18}$'),
  expected_inbound_key text not null check (expected_inbound_key ~ '^shopee:[a-f0-9]{64}$'),
  expected_reply_fingerprint text not null check (expected_reply_fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued'
    check (state in ('queued','observed','delayed','missing','mismatch','incomplete')),
  reason text,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (delivery_id, attempt),
  unique (source_job_id, attempt)
);

alter table sellerpilot_private.shopee_reply_readback_attempts enable row level security;
revoke all on sellerpilot_private.shopee_reply_readback_attempts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.enqueue_shopee_reply_readback_after_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_readback_job_id uuid := gen_random_uuid();
  v_shop_id text; v_comment_id text; v_item_id text; v_inbound_key text;
begin
  if new.channel_key <> 'shopee' or new.status <> 'succeeded'
     or new.verification_status <> 'provider_accepted' then return new; end if;
  if exists (select 1 from sellerpilot_private.shopee_reply_readback_attempts attempt
      where attempt.delivery_id = new.id) then return new; end if;

  select job.* into v_source from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.gateway_job_id for update;
  if not found or v_source.channel <> 'shopee' or v_source.operation <> 'inquiries.reply'
     or v_source.status <> 'succeeded'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,contract}'
          is distinct from 'sellerpilot-reply-acceptance/1'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,level}'
          is distinct from 'provider_accepted'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,channel}'
          is distinct from 'shopee'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,kind}'
          is distinct from 'product_review' then
    raise exception 'SHOPEE_REPLY_READBACK_SOURCE_INVALID' using errcode = '23514';
  end if;
  v_shop_id := nullif(v_source.request_payload#>>'{arguments,shopId}','');
  v_comment_id := nullif(v_source.request_payload#>>'{arguments,commentId}','');
  v_item_id := nullif(v_source.request_payload#>>'{arguments,itemId}','');
  v_inbound_key := nullif(v_source.request_payload->>'sellerpilotInboundKey','');
  if coalesce(v_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(v_comment_id,'') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(v_item_id,'') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(v_inbound_key,'') !~ '^shopee:[a-f0-9]{64}$'
     or new.reply_fingerprint is distinct from
          v_source.request_payload->>'sellerpilotReplyFingerprint' then
    raise exception 'SHOPEE_REPLY_READBACK_BINDING_INVALID' using errcode = '23514';
  end if;

  select ticket.* into v_ticket from sellerpilot_private.support_tickets ticket
   where ticket.id = new.ticket_id and ticket.channel_key = 'shopee'
     and ticket.external_ticket_id = 'shopee:' || v_shop_id || ':' || v_comment_id
     and ticket.reply_context->>'shopId' = v_shop_id
     and ticket.reply_context->>'commentId' = v_comment_id
     and ticket.reply_context->>'itemId' = v_item_id and not ticket.demo for update;
  if not found then raise exception 'SHOPEE_REPLY_READBACK_TICKET_INVALID' using errcode = '23514'; end if;

  select credential.* into v_credential from sellerpilot_private.channel_credentials credential
   where credential.id = v_source.credential_id and credential.channel = 'shopee'
     and credential.environment = v_source.environment
     and credential.created_by = v_ticket.owner_id and credential.status in ('active','grace')
     and (credential.expires_at is null or credential.expires_at > statement_timestamp()) for share;
  if not found or v_source.created_by is distinct from v_ticket.owner_id
     or v_ticket.source_credential_id is distinct from v_source.credential_id
     or coalesce(v_source.seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or v_ticket.seller_account_key is distinct from v_source.seller_account_key
     or v_credential.seller_account_key is distinct from v_source.seller_account_key then
    raise exception 'SHOPEE_REPLY_READBACK_CREDENTIAL_INVALID' using errcode = '23514';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,request_payload,
    created_by,seller_account_key,rate_not_before
  ) values (
    v_readback_job_id,v_source.credential_id,null,'shopee','inquiries.list',v_source.environment,
    jsonb_build_object(
      'periodicKey','inquiries:reply-readback:shopee:' || new.id::text || ':1',
      'arguments',jsonb_build_object('kind','product_review','shopId',v_shop_id,
        'commentId',v_comment_id,'itemId',v_item_id,'cursor','','pageSize',100),
      'sellerpilotShopeeReplyReadback',jsonb_build_object(
        'contract','sellerpilot-shopee-reply-readback/1','deliveryId',new.id,
        'sourceJobId',v_source.id,'ticketId',v_ticket.id,'expectedInboundKey',v_inbound_key,
        'expectedReplyFingerprint',new.reply_fingerprint,'shopId',v_shop_id,
        'commentId',v_comment_id,'itemId',v_item_id,'attempt',1)
    ),v_source.created_by,v_source.seller_account_key,clock_timestamp()+interval '15 seconds'
  );
  insert into sellerpilot_private.shopee_reply_readback_attempts(
    delivery_id,attempt,source_job_id,readback_job_id,credential_id,ticket_id,
    shop_id,comment_id,item_id,expected_inbound_key,expected_reply_fingerprint
  ) values (new.id,1,v_source.id,v_readback_job_id,v_source.credential_id,v_ticket.id,
    v_shop_id,v_comment_id,v_item_id,v_inbound_key,new.reply_fingerprint);
  return new;
end $$;

revoke all on function sellerpilot_private.enqueue_shopee_reply_readback_after_acceptance()
  from public, anon, authenticated, service_role;
create trigger enqueue_shopee_reply_readback_after_acceptance
after insert or update of status,verification_status
on sellerpilot_private.support_reply_deliveries for each row execute function
sellerpilot_private.enqueue_shopee_reply_readback_after_acceptance();

create function public.sellerpilot_service_record_shopee_reply_readback_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_delivery_id uuid,p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt sellerpilot_private.shopee_reply_readback_attempts%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_next_job_id uuid; v_state text; v_reason text; v_attempt_no integer;
  v_evidence_sha text; v_now timestamptz := clock_timestamp();
begin
  if coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$' or p_job_id is null
     or p_claim_token is null or p_delivery_id is null
     or jsonb_typeof(p_outcome) is distinct from 'object'
     or not (p_outcome ?& array['state','reason','attempt','matchingSellerReplies',
       'replyContentObserved','automaticResendAllowed'])
     or p_outcome - array['state','reason','attempt','matchingSellerReplies',
       'replyContentObserved','automaticResendAllowed'] <> '{}'::jsonb then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_outcome->'state') is distinct from 'string'
     or jsonb_typeof(p_outcome->'reason') is distinct from 'string'
     or jsonb_typeof(p_outcome->'attempt') is distinct from 'number'
     or coalesce(p_outcome->>'attempt','') !~ '^[1-3]$'
     or jsonb_typeof(p_outcome->'matchingSellerReplies') is distinct from 'number'
     or coalesce(p_outcome->>'matchingSellerReplies','') !~ '^(0|[1-9][0-9]{0,8})$'
     or jsonb_typeof(p_outcome->'replyContentObserved') is distinct from 'boolean'
     or jsonb_typeof(p_outcome->'automaticResendAllowed') is distinct from 'boolean' then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode='22023';
  end if;
  begin
    v_state := p_outcome->>'state'; v_reason := p_outcome->>'reason';
    v_attempt_no := (p_outcome->>'attempt')::integer;
  exception when others then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end;
  if v_state not in ('observed','delayed','missing','mismatch','incomplete')
     or v_attempt_no not between 1 and 3
     or (p_outcome->>'matchingSellerReplies')::integer < 0
     or (p_outcome->>'automaticResendAllowed')::boolean is distinct from false
     or ((p_outcome->>'replyContentObserved')::boolean) is distinct from (v_state='observed')
     or (v_state='observed' and v_reason<>'exact_reply_observed')
     or (v_state='delayed' and (v_reason<>'exact_reply_not_yet_observed' or v_attempt_no>=3))
     or (v_state='missing' and (v_reason<>'exact_reply_missing_after_bound' or v_attempt_no<>3))
     or (v_state='mismatch' and v_reason not in ('reply_body_mismatch','reply_target_mismatch'))
     or (v_state='incomplete' and v_reason not in ('reply_timestamp_unavailable','provider_result_invalid')) then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select attempt.* into v_attempt
    from sellerpilot_private.shopee_reply_readback_attempts attempt
   where attempt.delivery_id=p_delivery_id and attempt.attempt=v_attempt_no
     and attempt.readback_job_id=p_job_id for update;
  if not found then raise exception 'SHOPEE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000'; end if;


  select job.* into v_job from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id=job.id and receipt.claim_token=p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id=receipt.worker_token_id and token.token_hash=p_token_hash
    join sellerpilot_private.support_tickets ticket
      on ticket.id=v_attempt.ticket_id and ticket.owner_id=job.created_by
     and ticket.source_credential_id=job.credential_id and not ticket.demo
     and ticket.seller_account_key=job.seller_account_key
    join sellerpilot_private.channel_credentials credential
      on credential.id=job.credential_id and credential.created_by=job.created_by
     and credential.channel='shopee' and credential.environment=job.environment
     and credential.seller_account_key=job.seller_account_key
     and credential.status in ('active','grace')
     and (credential.expires_at is null or credential.expires_at>v_now)
    join sellerpilot_private.channel_gateway_jobs source
      on source.id=v_attempt.source_job_id and source.created_by=job.created_by
     and source.credential_id=job.credential_id and source.seller_account_key=job.seller_account_key
     and source.channel='shopee' and source.operation='inquiries.reply' and source.status='succeeded'
   where job.id=p_job_id and job.channel='shopee' and job.operation='inquiries.list'
     and job.status='succeeded' and job.credential_id=v_attempt.credential_id
     and token.scope in ('gateway','legacy_combined','serverless_cs') and token.status='active'
     and token.expires_at>v_now;
  if not found
     or v_job.request_payload->>'periodicKey' is distinct from
        'inquiries:reply-readback:shopee:'||p_delivery_id::text||':'||v_attempt_no::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,contract}'
        is distinct from 'sellerpilot-shopee-reply-readback/1'
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,deliveryId}'
        is distinct from p_delivery_id::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,sourceJobId}'
        is distinct from v_attempt.source_job_id::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,ticketId}'
        is distinct from v_attempt.ticket_id::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,expectedInboundKey}'
        is distinct from v_attempt.expected_inbound_key
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,expectedReplyFingerprint}'
        is distinct from v_attempt.expected_reply_fingerprint
     or v_job.request_payload#>>'{arguments,shopId}' is distinct from v_attempt.shop_id
     or v_job.request_payload#>>'{arguments,commentId}' is distinct from v_attempt.comment_id
     or v_job.request_payload#>>'{arguments,itemId}' is distinct from v_attempt.item_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,shopId}'
        is distinct from v_attempt.shop_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,commentId}'
        is distinct from v_attempt.comment_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,itemId}'
        is distinct from v_attempt.item_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,attempt}'
        is distinct from v_attempt_no::text then
    raise exception 'SHOPEE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000';
  end if;
  v_evidence_sha := encode(extensions.digest(p_outcome::text,'sha256'),'hex');
  if v_attempt.state<>'queued' then
    if v_attempt.evidence_sha256 is distinct from v_evidence_sha then
      raise exception 'SHOPEE_REPLY_READBACK_REPLAY_MISMATCH' using errcode='40001';
    end if;
    return jsonb_build_object('contract','sellerpilot-shopee-reply-readback-result/1',
      'deliveryId',v_attempt.delivery_id,'attempt',v_attempt.attempt,'state',v_attempt.state,
      'nextJobId',v_attempt.next_readback_job_id,'providerAcceptancePreserved',
        (select verification_status='provider_accepted' from sellerpilot_private.support_reply_deliveries where id=v_attempt.delivery_id),
      'automaticResendAllowed',false);
  end if;

  select delivery.* into v_delivery from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id=p_delivery_id and delivery.gateway_job_id=v_attempt.source_job_id
     and delivery.channel_key='shopee' and delivery.reply_fingerprint=v_attempt.expected_reply_fingerprint
     and delivery.status='succeeded' for update;
  if not found or (v_state='observed' and v_delivery.verification_status<>'remote_observed')
     or (v_state<>'observed' and v_delivery.verification_status<>'provider_accepted') then
    raise exception 'SHOPEE_REPLY_READBACK_OBSERVATION_MISMATCH' using errcode='55000';
  end if;

  v_evidence_sha := encode(extensions.digest(p_outcome::text,'sha256'),'hex');
  if v_state='delayed' then
    v_next_job_id := gen_random_uuid();
    insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,channel,operation,environment,request_payload,
      created_by,seller_account_key,rate_not_before
    ) select v_next_job_id,job.credential_id,null,'shopee','inquiries.list',job.environment,
      jsonb_set(jsonb_set(job.request_payload,'{periodicKey}',
        to_jsonb('inquiries:reply-readback:shopee:'||p_delivery_id::text||':'||(v_attempt_no+1)::text)),
        '{sellerpilotShopeeReplyReadback,attempt}',to_jsonb(v_attempt_no+1)),
      job.created_by,job.seller_account_key,v_now+(30*v_attempt_no)*interval '1 second'
      from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
    insert into sellerpilot_private.shopee_reply_readback_attempts(
      delivery_id,attempt,source_job_id,readback_job_id,credential_id,ticket_id,
      shop_id,comment_id,item_id,expected_inbound_key,expected_reply_fingerprint
    ) values (p_delivery_id,v_attempt_no+1,v_attempt.source_job_id,v_next_job_id,
      v_attempt.credential_id,v_attempt.ticket_id,v_attempt.shop_id,v_attempt.comment_id,
      v_attempt.item_id,v_attempt.expected_inbound_key,v_attempt.expected_reply_fingerprint);
  end if;
  update sellerpilot_private.shopee_reply_readback_attempts set state=v_state,reason=v_reason,
    evidence_sha256=v_evidence_sha,checked_at=v_now,next_readback_job_id=v_next_job_id
   where delivery_id=p_delivery_id and attempt=v_attempt_no;
  return jsonb_build_object('contract','sellerpilot-shopee-reply-readback-result/1',
    'deliveryId',p_delivery_id,'attempt',v_attempt_no,'state',v_state,'nextJobId',v_next_job_id,
    'providerAcceptancePreserved',v_state<>'observed','automaticResendAllowed',false);
end $$;

revoke all on function public.sellerpilot_service_record_shopee_reply_readback_v1(
  text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_shopee_reply_readback_v1(
  text,uuid,uuid,uuid,jsonb) to service_role;


notify pgrst,'reload schema';
commit;
