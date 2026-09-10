-- Proposal-only coordinator migration. Apply only after the reviewed 007
-- Coupang order-lineage migration. No provider or commerce mutation is added.

begin;

do $$
begin
  if to_regprocedure('sellerpilot_private.coupang_cs_order_binding_candidate_v1(uuid)') is null
     or to_regprocedure('sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)') is null
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.coupang_cs_order_binding_candidate_v1(uuid)'::regprocedure)
        is distinct from 'e9c382cbd7696dc878f755f38bcb25ac'
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)'::regprocedure)
        is distinct from '6c053e7477c176dcf1eb38bf7b4c067c'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure)
        is distinct from 'a1395073773c39c98aae04b2cdc0652f'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_get_ticket_reply_context_v2(uuid)'::regprocedure)
        is distinct from 'a95fc5f04ab1eec9a2c3287f47fdaef7'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)'::regprocedure)
        is distinct from '843404d8ab9b1531017c2508b255f36a'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_31033000_create_support_reply_job_unsafe(uuid,uuid,text,text)'::regprocedure)
        is distinct from 'f283b016bf036df178a8ed34c97096c4'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_read_cs_order_binding_health_v1()'::regprocedure)
        is distinct from '545c98eb651cac531354bbe32ccb0196'
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE') then
    raise exception 'COUPANG_CS_ORDER_READER_GATE_PREIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

create function sellerpilot_private.coupang_cs_order_read_is_exact_v1(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce((
    select ticket.channel_key<>'coupang' or (
      ticket.order_id is not null
      and sellerpilot_private.cs_order_binding_is_exact(
        ticket.owner_id,ticket.channel_key,ticket.external_order_reference,
        ticket.source_credential_id,ticket.order_id
      )
    )
      from sellerpilot_private.support_tickets ticket
     where ticket.id=p_ticket_id and not ticket.demo
  ),false)
$$;
revoke all on function sellerpilot_private.coupang_cs_order_read_is_exact_v1(uuid)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_get_cs_workspace_snapshot()
  rename to sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1;
revoke all on function public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1()
  from public,anon,authenticated,service_role;

create function public.sellerpilot_get_cs_workspace_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_tickets jsonb;
begin
  v_result:=public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1();
  select coalesce(jsonb_agg(
    case when ticket.channel_key='coupang'
              and item.value->'orderId'<>'null'::jsonb
              and not sellerpilot_private.coupang_cs_order_read_is_exact_v1(ticket.id)
         then jsonb_set(item.value,'{orderId}','null'::jsonb,true)
         else item.value end
    order by item.ordinality
  ),'[]'::jsonb)
    into v_tickets
    from jsonb_array_elements(coalesce(v_result->'tickets','[]'::jsonb))
      with ordinality item(value,ordinality)
    left join sellerpilot_private.support_tickets ticket
      on ticket.id=(item.value->>'ticketId')::uuid;
  return jsonb_set(v_result,'{tickets}',v_tickets,true);
end;
$$;
revoke all on function public.sellerpilot_get_cs_workspace_snapshot()
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_cs_workspace_snapshot()
  to authenticated;

alter function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  rename to sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  v_result:=public.sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1(p_id);
  if v_result is not null
     and v_result->>'channel_key'='coupang'
     and v_result->'order_id'<>'null'::jsonb
     and not sellerpilot_private.coupang_cs_order_read_is_exact_v1(p_id) then
    v_result:=jsonb_set(v_result,'{order_id}','null'::jsonb,true);
  end if;
  return v_result;
end;
$$;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  to authenticated;

alter function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  rename to sellerpilot_create_support_reply_job_pre_coupang_order_gate_v1;
revoke all on function public.sellerpilot_create_support_reply_job_pre_coupang_order_gate_v1(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_create_support_reply_job(
  p_id uuid,p_ticket_id uuid,p_expected_inbound_key text,
  p_target_locale text,p_tone text default 'polite'
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job_id uuid;
begin
  v_job_id:=public.sellerpilot_create_support_reply_job_pre_coupang_order_gate_v1(
    p_id,p_ticket_id,p_expected_inbound_key,p_target_locale,p_tone
  );
  if not sellerpilot_private.coupang_cs_order_read_is_exact_v1(p_ticket_id) then
    update sellerpilot_private.ai_cli_jobs job
       set request_payload=jsonb_set(job.request_payload,'{order}','null'::jsonb,true)
     where job.id=v_job_id
       and job.kind='support_reply'
       and job.created_by=auth.uid()
       and exists(
         select 1 from sellerpilot_private.support_tickets ticket
          where ticket.id=p_ticket_id and ticket.channel_key='coupang' and not ticket.demo
       );
    update sellerpilot_private.ai_cli_audit audit
       set safe_detail=jsonb_set(audit.safe_detail,'{has_order_context}','false'::jsonb,true)
     where audit.job_id=v_job_id
       and audit.action='job_queued'
       and audit.actor_user_id=auth.uid();
  end if;
  return v_job_id;
end;
$$;
revoke all on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  to authenticated;

alter function public.sellerpilot_read_cs_order_binding_health_v1()
  rename to sellerpilot_read_cs_order_binding_health_pre_coupang_gate_v1;
revoke all on function public.sellerpilot_read_cs_order_binding_health_pre_coupang_gate_v1()
  from public,anon,authenticated,service_role;

create function public.sellerpilot_read_cs_order_binding_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',channel,'status',status,'count',count
  ) order by channel,status),'[]'::jsonb)
    into v_rows
    from(
      select effective.channel,effective.status,count(*)::integer count
        from(
          select binding.channel,
            case when binding.channel<>'coupang' then binding.status
                 else case (select candidate.lineage_status
                              from sellerpilot_private.coupang_cs_order_binding_candidate_v1(ticket.id)
                                   candidate)
                        when 'exact' then 'exact'
                        when 'not_applicable' then 'not_applicable'
                        when 'unverified_credential' then 'unverified_credential'
                        else 'unmatched' end
                 end as status
            from sellerpilot_private.cs_order_bindings binding
            join sellerpilot_private.support_tickets ticket
              on ticket.id=binding.ticket_id
           where ticket.owner_id=auth.uid() and not ticket.demo
        ) effective
       group by effective.channel,effective.status
    ) summary;
  return jsonb_build_object(
    'contract','sellerpilot-cs-order-binding-health/1',
    'checkedAt',statement_timestamp(),
    'groups',v_rows,
    'matchingRule','same_owner_channel_exact_external_order_and_credential',
    'csCommerceMutationAllowed',false
  );
end;
$$;
revoke all on function public.sellerpilot_read_cs_order_binding_health_v1()
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_order_binding_health_v1()
  to authenticated;

do $$
begin
  if (select md5(prosrc) from pg_proc
        where oid='public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1()'::regprocedure)
       is distinct from 'a1395073773c39c98aae04b2cdc0652f'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1(uuid)'::regprocedure)
        is distinct from 'a95fc5f04ab1eec9a2c3287f47fdaef7'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_create_support_reply_job_pre_coupang_order_gate_v1(uuid,uuid,text,text,text)'::regprocedure)
        is distinct from '843404d8ab9b1531017c2508b255f36a'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_31033000_create_support_reply_job_unsafe(uuid,uuid,text,text)'::regprocedure)
        is distinct from 'f283b016bf036df178a8ed34c97096c4'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_read_cs_order_binding_health_pre_coupang_gate_v1()'::regprocedure)
        is distinct from '545c98eb651cac531354bbe32ccb0196'
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE') then
    raise exception 'COUPANG_CS_ORDER_READER_GATE_POSTIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

notify pgrst,'reload schema';
commit;
