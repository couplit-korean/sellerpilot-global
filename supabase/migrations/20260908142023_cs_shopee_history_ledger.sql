-- Executable review draft only. The integration coordinator must allocate the
-- migration version after verifying the recorded common-file preimages.
begin;

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

commit;
