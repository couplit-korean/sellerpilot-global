-- Add exact Elevenst reply observation while preserving all existing channel branches.
begin;
do $migration$
declare
  v_oid regprocedure := to_regprocedure('public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)');
  v_sql text;
  v_list text := $old$('qoo10','shopee','lazada','coupang','smartstore','ebay')$old$;
  v_end text := '         else false end;';
begin
  if v_oid is null then raise exception 'ELEVENST_REPLY_OBSERVATION_PREREQUISITE_REQUIRED'; end if;
  v_sql := pg_get_functiondef(v_oid);
  if (length(v_sql)-length(replace(v_sql,v_list,'')))/length(v_list) <> 1
     or (length(v_sql)-length(replace(v_sql,v_end,'')))/length(v_end) <> 1
     or position('when ''elevenst'' then' in v_sql)>0 then
    raise exception 'ELEVENST_REPLY_OBSERVATION_PREIMAGE_MISMATCH';
  end if;
  v_sql := replace(v_sql,v_list,$new$('qoo10','shopee','lazada','coupang','smartstore','ebay','elevenst')$new$);
  v_sql := replace(v_sql,v_end,$branch$         when 'elevenst' then job.channel='elevenst'
           and job.credential_id=p_credential_id
           and v_observation#>>'{binding,kind}'='product_qna'
           and job.request_payload->>'sellerpilotTicketId'=v_ticket.id::text
           and job.request_payload->>'sellerpilotInboundKey'=v_ticket.latest_inbound_key
           and job.request_payload#>>'{arguments,brdInfoNo}'=v_observation#>>'{binding,brdInfoNo}'
           and job.request_payload#>>'{arguments,prdNo}'=v_observation#>>'{binding,prdNo}'
           and v_ticket.reply_context->>'brdInfoNo'=v_observation#>>'{binding,brdInfoNo}'
           and v_ticket.reply_context->>'prdNo'=v_observation#>>'{binding,prdNo}'
$branch$||v_end);
  execute v_sql;
end $migration$;
revoke all on function public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb) to service_role;
commit;
