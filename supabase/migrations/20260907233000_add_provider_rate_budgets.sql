begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists rate_not_before timestamptz,
  add column if not exists rate_limit_count integer not null default 0
    check (rate_limit_count between 0 and 1000);

create index if not exists channel_gateway_jobs_rate_ready_idx
  on sellerpilot_private.channel_gateway_jobs (rate_not_before, created_at, id)
  where status = 'queued';

create table sellerpilot_private.provider_rate_budgets (
  scope_key text primary key check (scope_key ~ '^[a-f0-9]{64}$'),
  channel text not null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  operation_lane text not null check (operation_lane in ('cs_reply','cs_current','cs_history','non_cs_read','non_cs_write')),
  target_fingerprint text not null check (target_fingerprint ~ '^[a-f0-9]{64}$'),
  min_interval_ms integer not null check (min_interval_ms between 50 and 60000),
  next_allowed_at timestamptz not null,
  last_dispatched_at timestamptz,
  last_rate_limited_at timestamptz,
  last_retry_after_seconds integer check (last_retry_after_seconds between 1 and 3600),
  dispatch_count bigint not null default 0 check (dispatch_count >= 0),
  rate_limit_count bigint not null default 0 check (rate_limit_count >= 0),
  updated_at timestamptz not null default now()
);

alter table sellerpilot_private.provider_rate_budgets enable row level security;
revoke all on sellerpilot_private.provider_rate_budgets from public, anon, authenticated, service_role;

create table sellerpilot_private.provider_global_rate_budgets (
  channel text primary key check (channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')),
  min_interval_ms integer not null check (min_interval_ms between 50 and 60000),
  next_allowed_at timestamptz not null,
  last_dispatched_at timestamptz,
  last_rate_limited_at timestamptz,
  last_retry_after_seconds integer check (last_retry_after_seconds between 1 and 3600),
  dispatch_count bigint not null default 0 check (dispatch_count >= 0),
  rate_limit_count bigint not null default 0 check (rate_limit_count >= 0),
  updated_at timestamptz not null default now()
);

alter table sellerpilot_private.provider_global_rate_budgets enable row level security;
revoke all on sellerpilot_private.provider_global_rate_budgets
  from public, anon, authenticated, service_role;

-- The existing claimants remain the single authority for credentials, leases,
-- mutation fences and per-channel concurrency. Add only the future eligibility
-- predicate so a rate-limited oldest row cannot starve ready work behind it.
do $migration$
declare
  v_source text;
  v_old constant text := $needle$where job.status = 'queued'
     and sellerpilot_private.serverless_gateway_job_allowed($needle$;
  v_new constant text := $replacement$where job.status = 'queued'
     and coalesce(job.rate_not_before, '-infinity'::timestamptz) <= clock_timestamp()
     and sellerpilot_private.serverless_gateway_job_allowed($replacement$;
begin
  select pg_get_functiondef(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure
  ) into v_source;
  if strpos(v_source, v_new) > 0 then return; end if;
  if strpos(v_source, v_old) = 0 then
    raise exception 'SERVERLESS_GATEWAY_RATE_BUDGET_CLAIM_SOURCE_DRIFT';
  end if;
  execute replace(v_source, v_old, v_new);
end
$migration$;

do $migration$
declare
  v_source text;
  v_old constant text := $needle$   where j.status = 'queued'$needle$;
  v_new constant text := $replacement$   where j.status = 'queued'
     and coalesce(j.rate_not_before, '-infinity'::timestamptz) <= clock_timestamp()$replacement$;
begin
  select pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_source;
  if strpos(v_source, v_new) > 0 then return; end if;
  if strpos(v_source, v_old) = 0
     or strpos(substr(v_source, strpos(v_source, v_old) + length(v_old)), v_old) > 0 then
    raise exception 'LOCAL_GATEWAY_RATE_BUDGET_CLAIM_SOURCE_DRIFT';
  end if;
  execute replace(v_source, v_old, v_new);
end
$migration$;

create function sellerpilot_private.provider_rate_scope(
  p_channel text,
  p_credential_id uuid,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  with scope as (
    select case
      when p_operation = 'inquiries.reply' then 'cs_reply'
      when p_operation = 'inquiries.list' and (
        coalesce(p_request_payload->>'periodicKey', '') like 'inquiries:history:%'
        or nullif(p_request_payload#>>'{arguments,sellerpilotHistoryRunId}', '') is not null
      ) then 'cs_history'
      when p_operation = 'inquiries.list' then 'cs_current'
      when p_operation in ('categories.list','categories.suggest','categories.attributes','categories.validate',
        'orders.list','orders.get','diagnostic.test','shops.get','competitor.search','listing.publication.verify')
        then 'non_cs_read'
      else 'non_cs_write'
    end operation_lane,
    coalesce(
      nullif(p_request_payload#>>'{arguments,shopId}', ''),
      nullif(p_request_payload#>>'{arguments,shop_id}', ''),
      nullif(p_request_payload#>>'{arguments,sellerpilotShopCredentialIndex}', ''),
      nullif(p_request_payload#>>'{arguments,marketplaceId}', ''),
      p_credential_id::text
    ) target_key
  )
  select jsonb_build_object(
    'operationLane', operation_lane,
    'targetFingerprint', encode(extensions.digest(target_key, 'sha256'), 'hex'),
    'scopeKey', encode(extensions.digest(
      p_channel || ':' || p_credential_id::text || ':' || operation_lane || ':' || target_key,
      'sha256'
    ), 'hex'),
    'minIntervalMs', case operation_lane
      when 'cs_reply' then 1000
      when 'cs_history' then 750
      when 'cs_current' then 250
      when 'non_cs_read' then 100
      else 500
    end
  )
  from scope
$$;

revoke all on function sellerpilot_private.provider_rate_scope(text,uuid,text,jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.provider_global_min_interval_ms(p_channel text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_channel
    when 'shopee' then 100
    when 'lazada' then 100
    when 'ebay' then 100
    else 250
  end
$$;

revoke all on function sellerpilot_private.provider_global_min_interval_ms(text)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_reserve_provider_rate_budget_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_scope jsonb;
  v_budget sellerpilot_private.provider_rate_budgets%rowtype;
  v_global_budget sellerpilot_private.provider_global_rate_budgets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ready_at timestamptz;
  v_jitter_ms integer;
  v_retry_after integer;
begin
  if not exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash and token.status = 'active'
       and token.expires_at > v_now and token.scope = 'gateway'
  ) then raise exception 'invalid worker token' using errcode = '42501'; end if;

  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id and job.claim_token = p_claim_token
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
$$;

create or replace function public.sellerpilot_service_reserve_provider_request_rate_budget_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_scope jsonb;
  v_budget sellerpilot_private.provider_rate_budgets%rowtype;
  v_global_budget sellerpilot_private.provider_global_rate_budgets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ready_at timestamptz;
  v_wait_ms integer;
begin
  if not exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash=p_token_hash and token.status='active'
       and token.expires_at>v_now and token.scope='gateway'
  ) then raise exception 'invalid worker token' using errcode='42501'; end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
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
end $$;

create or replace function public.sellerpilot_service_report_provider_rate_limit_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_retry_after_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_scope jsonb;
  v_now timestamptz := clock_timestamp();
  v_retry integer := greatest(1,least(coalesce(p_retry_after_seconds,60),3600));
  v_jitter_ms integer;
  v_safe_read boolean;
begin
  if not exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash=p_token_hash and token.status='active'
       and token.expires_at>v_now and token.scope='gateway'
  ) then raise exception 'invalid worker token' using errcode = '42501'; end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
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
$$;

revoke all on function public.sellerpilot_service_reserve_provider_rate_budget_v1(text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_provider_rate_budget_v1(text,uuid,uuid)
  to service_role;
revoke all on function public.sellerpilot_service_report_provider_rate_limit_v1(text,uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_report_provider_rate_limit_v1(text,uuid,uuid,integer)
  to service_role;
revoke all on function public.sellerpilot_service_reserve_provider_request_rate_budget_v1(text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_provider_request_rate_budget_v1(text,uuid,uuid)
  to service_role;

comment on table sellerpilot_private.provider_rate_budgets is
  'Private credential, shop target and operation lane provider pacing ledger; stores only target fingerprints.';
comment on table sellerpilot_private.provider_global_rate_budgets is
  'Private cross-worker channel-wide pacing and adaptive provider rate-limit ledger.';

commit;
