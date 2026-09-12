begin;

set local lock_timeout='2s';

set local statement_timeout='15s';

-- Preserve rate intervals, backoff and mutation guards; accept only the owning runtime.

do $guard$ begin if md5(pg_get_functiondef('public.sellerpilot_service_reserve_provider_rate_budget_v1(text,uuid,uuid)'::regprocedure)) is distinct from '3f90fd75b033a1e4820d8142b27a0808' then raise exception 'PROVIDER_BUDGET_PREIMAGE_CHANGED:sellerpilot_service_reserve_provider_rate_budget_v1';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_reserve_provider_rate_budget_v1(p_token_hash text, p_job_id uuid, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'sellerpilot_private'
AS $function$
declare
  v_token_id uuid;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_scope jsonb;
  v_budget sellerpilot_private.provider_rate_budgets%rowtype;
  v_global_budget sellerpilot_private.provider_global_rate_budgets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ready_at timestamptz;
  v_jitter_ms integer;
  v_retry_after integer;
begin
  select token.id into v_token_id from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash=p_token_hash and token.status='active'
     and token.expires_at>v_now and token.scope in ('gateway','serverless_cs');
  if v_token_id is null then raise exception 'invalid worker token' using errcode='42501';end if;

  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.worker_token_id=v_token_id and job.id=p_job_id and job.claim_token = p_claim_token
     and job.status = 'running' and job.lease_expires_at > v_now
   for update;
  if not found then raise exception 'gateway job ownership lost' using errcode = '40001'; end if;

  v_scope := sellerpilot_private.provider_rate_scope(
    v_job.channel, v_job.credential_id, v_job.operation, v_job.request_payload
  );
  perform pg_advisory_xact_lock(hashtext('provider-global:' || v_job.channel));
  perform pg_advisory_xact_lock(hashtext(v_scope->>'scopeKey'));
  insert into sellerpilot_private.provider_global_rate_budgets(
    channel,min_interval_ms,next_allowed_at
  ) values (
    v_job.channel,
    sellerpilot_private.provider_global_min_interval_ms(v_job.channel),
    v_now
  ) on conflict (channel) do nothing;
  insert into sellerpilot_private.provider_rate_budgets(
    scope_key,channel,credential_id,operation_lane,target_fingerprint,min_interval_ms,next_allowed_at
  ) values (
    v_scope->>'scopeKey',v_job.channel,v_job.credential_id,v_scope->>'operationLane',
    v_scope->>'targetFingerprint',(v_scope->>'minIntervalMs')::integer,v_now
  ) on conflict (scope_key) do nothing;
  select * into v_budget from sellerpilot_private.provider_rate_budgets budget
   where budget.scope_key = v_scope->>'scopeKey' for update;
  select * into v_global_budget
    from sellerpilot_private.provider_global_rate_budgets budget
   where budget.channel = v_job.channel for update;
  v_ready_at := greatest(v_budget.next_allowed_at, v_global_budget.next_allowed_at);

  if v_ready_at > v_now then
    v_jitter_ms := get_byte(decode(substr(replace(v_job.id::text,'-',''),1,2),'hex'),0) % 251;
    update sellerpilot_private.channel_gateway_jobs job
       set status='queued', worker_token_id=null, claim_token=null, lease_expires_at=null,
           rate_not_before=v_ready_at + v_jitter_ms * interval '1 millisecond',
           attempt_count=greatest(job.attempt_count-1,0), updated_at=v_now
     where job.id=v_job.id and job.claim_token=p_claim_token and job.status='running';
    if not found then raise exception 'gateway job ownership lost' using errcode = '40001'; end if;
    v_retry_after := greatest(1,ceil(extract(epoch from (v_ready_at-v_now)))::integer);
    return jsonb_build_object('contract','sellerpilot-provider-rate-budget/1','status','deferred',
      'retryAfterSeconds',v_retry_after,'operationLane',v_scope->>'operationLane');
  end if;

  update sellerpilot_private.provider_rate_budgets budget
     set next_allowed_at=v_now + budget.min_interval_ms * interval '1 millisecond',
         last_dispatched_at=v_now,dispatch_count=budget.dispatch_count+1,updated_at=v_now
   where budget.scope_key=v_scope->>'scopeKey';
  update sellerpilot_private.provider_global_rate_budgets budget
     set next_allowed_at=v_now + budget.min_interval_ms * interval '1 millisecond',
         last_dispatched_at=v_now,dispatch_count=budget.dispatch_count+1,updated_at=v_now
   where budget.channel=v_job.channel;
  update sellerpilot_private.channel_gateway_jobs set rate_not_before=null where id=v_job.id;
  return jsonb_build_object('contract','sellerpilot-provider-rate-budget/1','status','reserved',
    'retryAfterSeconds',0,'operationLane',v_scope->>'operationLane');
end
$function$;

revoke all on function public.sellerpilot_service_reserve_provider_rate_budget_v1(text,uuid,uuid) from public,anon,authenticated,service_role;

grant execute on function public.sellerpilot_service_reserve_provider_rate_budget_v1(text,uuid,uuid) to service_role;

do $guard$ begin if md5(pg_get_functiondef('public.sellerpilot_service_reserve_provider_request_rate_budget_v1(text,uuid,uuid)'::regprocedure)) is distinct from '10f61dd77ee7be979c81bc5f71a4c336' then raise exception 'PROVIDER_BUDGET_PREIMAGE_CHANGED:sellerpilot_service_reserve_provider_request_rate_budget_v1';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_reserve_provider_request_rate_budget_v1(p_token_hash text, p_job_id uuid, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'sellerpilot_private'
AS $function$
declare
  v_token_id uuid;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_scope jsonb;
  v_budget sellerpilot_private.provider_rate_budgets%rowtype;
  v_global_budget sellerpilot_private.provider_global_rate_budgets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ready_at timestamptz;
  v_wait_ms integer;
begin
  select token.id into v_token_id from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash=p_token_hash and token.status='active'
     and token.expires_at>v_now and token.scope in ('gateway','serverless_cs');
  if v_token_id is null then raise exception 'invalid worker token' using errcode='42501';end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.worker_token_id=v_token_id and job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
     and job.lease_expires_at>v_now for update;
  if not found then raise exception 'gateway job ownership lost' using errcode='40001'; end if;
  v_scope:=sellerpilot_private.provider_rate_scope(v_job.channel,v_job.credential_id,v_job.operation,v_job.request_payload);
  perform pg_advisory_xact_lock(hashtext('provider-global:'||v_job.channel));
  perform pg_advisory_xact_lock(hashtext(v_scope->>'scopeKey'));
  insert into sellerpilot_private.provider_global_rate_budgets(channel,min_interval_ms,next_allowed_at)
  values(v_job.channel,sellerpilot_private.provider_global_min_interval_ms(v_job.channel),v_now)
  on conflict(channel)do nothing;
  insert into sellerpilot_private.provider_rate_budgets(scope_key,channel,credential_id,operation_lane,target_fingerprint,min_interval_ms,next_allowed_at)
  values(v_scope->>'scopeKey',v_job.channel,v_job.credential_id,v_scope->>'operationLane',v_scope->>'targetFingerprint',(v_scope->>'minIntervalMs')::integer,v_now)
  on conflict(scope_key)do nothing;
  select*into v_budget from sellerpilot_private.provider_rate_budgets where scope_key=v_scope->>'scopeKey'for update;
  select*into v_global_budget from sellerpilot_private.provider_global_rate_budgets where channel=v_job.channel for update;
  v_ready_at:=greatest(v_budget.next_allowed_at,v_global_budget.next_allowed_at);
  if v_ready_at>v_now then
    v_wait_ms:=greatest(1,least(60000,ceil(extract(epoch from(v_ready_at-v_now))*1000)::integer));
    return jsonb_build_object('contract','sellerpilot-provider-request-rate-budget/1','status','waiting','retryAfterMs',v_wait_ms,'operationLane',v_scope->>'operationLane');
  end if;
  update sellerpilot_private.provider_rate_budgets set next_allowed_at=v_now+min_interval_ms*interval'1 millisecond',last_dispatched_at=v_now,dispatch_count=dispatch_count+1,updated_at=v_now where scope_key=v_scope->>'scopeKey';
  update sellerpilot_private.provider_global_rate_budgets set next_allowed_at=v_now+min_interval_ms*interval'1 millisecond',last_dispatched_at=v_now,dispatch_count=dispatch_count+1,updated_at=v_now where channel=v_job.channel;
  return jsonb_build_object('contract','sellerpilot-provider-request-rate-budget/1','status','reserved','retryAfterMs',0,'operationLane',v_scope->>'operationLane');
end $function$;

revoke all on function public.sellerpilot_service_reserve_provider_request_rate_budget_v1(text,uuid,uuid) from public,anon,authenticated,service_role;

grant execute on function public.sellerpilot_service_reserve_provider_request_rate_budget_v1(text,uuid,uuid) to service_role;

do $guard$ begin if md5(pg_get_functiondef('public.sellerpilot_service_report_provider_rate_limit_v1(text,uuid,uuid,integer)'::regprocedure)) is distinct from '65aabeb28d2dd0d286e4a724e54e9abd' then raise exception 'PROVIDER_BUDGET_PREIMAGE_CHANGED:sellerpilot_service_report_provider_rate_limit_v1';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_report_provider_rate_limit_v1(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_retry_after_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'sellerpilot_private'
AS $function$
declare
  v_token_id uuid;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_scope jsonb;
  v_now timestamptz := clock_timestamp();
  v_retry integer := greatest(1,least(coalesce(p_retry_after_seconds,60),3600));
  v_jitter_ms integer;
  v_safe_read boolean;
begin
  select token.id into v_token_id from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash=p_token_hash and token.status='active'
     and token.expires_at>v_now and token.scope in ('gateway','serverless_cs');
  if v_token_id is null then raise exception 'invalid worker token' using errcode='42501';end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.worker_token_id=v_token_id and job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
     and job.lease_expires_at>v_now for update;
  if not found then raise exception 'gateway job ownership lost' using errcode = '40001'; end if;
  v_scope := sellerpilot_private.provider_rate_scope(
    v_job.channel,v_job.credential_id,v_job.operation,v_job.request_payload
  );
  perform pg_advisory_xact_lock(hashtext('provider-global:' || v_job.channel));
  perform pg_advisory_xact_lock(hashtext(v_scope->>'scopeKey'));
  v_jitter_ms := get_byte(decode(substr(replace(v_job.id::text,'-',''),3,2),'hex'),0) % 1001;
  insert into sellerpilot_private.provider_global_rate_budgets(
    channel,min_interval_ms,next_allowed_at,last_rate_limited_at,last_retry_after_seconds,rate_limit_count
  ) values (
    v_job.channel,sellerpilot_private.provider_global_min_interval_ms(v_job.channel),
    v_now+v_retry*interval '1 second'+v_jitter_ms*interval '1 millisecond',v_now,v_retry,1
  ) on conflict (channel) do update set
    next_allowed_at=greatest(sellerpilot_private.provider_global_rate_budgets.next_allowed_at,excluded.next_allowed_at),
    last_rate_limited_at=v_now,last_retry_after_seconds=v_retry,
    rate_limit_count=sellerpilot_private.provider_global_rate_budgets.rate_limit_count+1,updated_at=v_now;
  insert into sellerpilot_private.provider_rate_budgets(
    scope_key,channel,credential_id,operation_lane,target_fingerprint,min_interval_ms,next_allowed_at,
    last_rate_limited_at,last_retry_after_seconds,rate_limit_count
  ) values (
    v_scope->>'scopeKey',v_job.channel,v_job.credential_id,v_scope->>'operationLane',
    v_scope->>'targetFingerprint',(v_scope->>'minIntervalMs')::integer,
    v_now+v_retry*interval '1 second'+v_jitter_ms*interval '1 millisecond',v_now,v_retry,1
  ) on conflict (scope_key) do update set
    next_allowed_at=greatest(sellerpilot_private.provider_rate_budgets.next_allowed_at,excluded.next_allowed_at),
    last_rate_limited_at=v_now,last_retry_after_seconds=v_retry,
    rate_limit_count=sellerpilot_private.provider_rate_budgets.rate_limit_count+1,updated_at=v_now;

  v_safe_read := v_job.operation in ('categories.list','categories.suggest','categories.attributes',
    'categories.validate','orders.list','orders.get','inquiries.list','diagnostic.test','shops.get',
    'competitor.search','listing.publication.verify') and v_job.provider_mutation_started_at is null;
  if v_safe_read and v_job.attempt_count < 5 then
    update sellerpilot_private.channel_gateway_jobs job set status='queued',worker_token_id=null,
      claim_token=null,lease_expires_at=null,rate_not_before=v_now+v_retry*interval '1 second'
        +v_jitter_ms*interval '1 millisecond',rate_limit_count=job.rate_limit_count+1,
      error_message='PROVIDER_RATE_LIMITED_RETRY_SCHEDULED',updated_at=v_now
     where job.id=v_job.id and job.claim_token=p_claim_token and job.status='running';
    if not found then raise exception 'gateway job ownership lost' using errcode = '40001'; end if;
    return jsonb_build_object('contract','sellerpilot-provider-rate-budget/1','status','deferred',
      'retryAfterSeconds',v_retry,'operationLane',v_scope->>'operationLane');
  end if;
  return jsonb_build_object('contract','sellerpilot-provider-rate-budget/1','status','recorded',
    'retryAfterSeconds',v_retry,'operationLane',v_scope->>'operationLane');
end
$function$;

revoke all on function public.sellerpilot_service_report_provider_rate_limit_v1(text,uuid,uuid,integer) from public,anon,authenticated,service_role;

grant execute on function public.sellerpilot_service_report_provider_rate_limit_v1(text,uuid,uuid,integer) to service_role;

notify pgrst,'reload schema';

commit;
