-- Follow-up to frozen delta-after-integration-003. Apply after 004 and 007 in
-- an isolated database. It binds every scope to the exact credential/Vault
-- shop/country, seals job run/sequence/checkpoint metadata at event insert, and
-- makes one request UUID immutable across range, credential and target plan.
begin;

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

commit;
