-- Executable review draft only. Starts one isolated job per verified shop and
-- scope; it never returns or accepts OAuth secrets.
begin;

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

commit;
