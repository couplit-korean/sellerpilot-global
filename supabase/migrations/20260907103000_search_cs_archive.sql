-- Read-only archive search, independent of the dashboard's recent ticket cap.
begin;
create index if not exists support_tickets_owner_archive_idx
 on sellerpilot_private.support_tickets(owner_id,received_at desc,id desc) where not demo;

create function public.sellerpilot_search_cs_archive(
 p_query text default '', p_channel text default null, p_status text default null,
 p_from_date date default null, p_to_date date default null, p_limit integer default 25,
 p_before_time timestamptz default null, p_before_id uuid default null, p_as_of timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_as_of timestamptz:=coalesce(p_as_of,statement_timestamp());
 v_query text:=trim(coalesce(p_query,'')); v_pattern text;
 v_rows jsonb; v_more boolean; v_last jsonb;
begin
 if auth.uid() is null or not public.sellerpilot_is_admin() then
  raise exception 'administrator access required' using errcode='42501';
 end if;
 if length(v_query)>120 or p_limit is null or p_limit not between 1 and 50
  or (p_channel is not null and p_channel not in ('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu'))
  or (p_status is not null and p_status not in ('waiting','urgent','in_progress','resolved'))
  or (p_from_date is not null and p_to_date is not null and p_from_date>p_to_date)
  or (p_before_time is null)<>(p_before_id is null)
  or v_as_of>statement_timestamp()+interval '5 seconds' then
  raise exception 'invalid archive search' using errcode='22023';
 end if;
 -- User percent/underscore/backslash are literal text, never wildcard control.
 v_pattern:='%'||replace(replace(replace(v_query,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with results as (
  select t.id,t.channel_key,t.external_ticket_id,t.customer_name,t.subject,t.status,t.received_at,
    left(t.message,250) as preview
  from sellerpilot_private.support_tickets t
  where t.owner_id=auth.uid() and not t.demo and t.updated_at<=v_as_of
   and (p_channel is null or t.channel_key=p_channel)
   and (p_status is null or t.status=p_status)
   and (p_from_date is null or t.received_at>=p_from_date::timestamp at time zone 'Asia/Seoul')
   and (p_to_date is null or t.received_at<(p_to_date+1)::timestamp at time zone 'Asia/Seoul')
   and (p_before_time is null or (t.received_at,t.id)<(p_before_time,p_before_id))
   and (v_query='' or t.external_ticket_id ilike v_pattern or t.customer_name ilike v_pattern
     or t.subject ilike v_pattern or t.message ilike v_pattern
     or exists(select 1 from sellerpilot_private.support_inbound_messages m
       where m.ticket_id=t.id and m.owner_id=t.owner_id and m.channel_key=t.channel_key and m.created_at<=v_as_of
        and (m.body ilike v_pattern or exists(select 1
          from jsonb_array_elements(case when jsonb_typeof(m.provider_context->'unsequencedAnswers')='array'
           then m.provider_context->'unsequencedAnswers' else '[]'::jsonb end) a
          where a->>'body' ilike v_pattern)))
     or exists(select 1 from sellerpilot_private.support_reply_deliveries d
       join sellerpilot_private.channel_gateway_jobs j on j.id=d.gateway_job_id and j.channel=d.channel_key
        and j.operation='inquiries.reply' and j.request_payload->>'sellerpilotTicketId'=d.ticket_id::text
       where d.ticket_id=t.id and d.owner_id=t.owner_id and d.channel_key=t.channel_key and d.created_at<=v_as_of
        and (case when d.channel_key='qoo10' then j.request_payload#>>'{arguments,params,contents}'
          else j.request_payload#>>'{arguments,reply}' end) ilike v_pattern))
  order by t.received_at desc,t.id desc limit p_limit+1
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel_key,'externalId',external_ticket_id,
   'customer',customer_name,'subject',subject,'status',status,'receivedAt',received_at,'preview',preview)
   order by received_at desc,id desc),'[]'::jsonb) into v_rows from results;
 v_more:=jsonb_array_length(v_rows)>p_limit;
 if v_more then v_rows:=v_rows-p_limit;end if;
 v_last:=v_rows->(jsonb_array_length(v_rows)-1);
 return jsonb_build_object('tickets',v_rows,'asOf',v_as_of,'nextCursor',case when v_more then
  jsonb_build_object('beforeTime',v_last->>'receivedAt','beforeId',v_last->>'id','asOf',v_as_of) else null end);
end $$;
revoke all on function public.sellerpilot_search_cs_archive(text,text,text,date,date,integer,timestamptz,uuid,timestamptz) from public,anon,service_role;
grant execute on function public.sellerpilot_search_cs_archive(text,text,text,date,date,integer,timestamptz,uuid,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
