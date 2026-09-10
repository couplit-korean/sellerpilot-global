begin;

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

commit;
