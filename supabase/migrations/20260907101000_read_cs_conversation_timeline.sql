-- Read existing CS ledgers without exposing provider envelopes or changing delivery state.
begin;
create function public.sellerpilot_get_cs_conversation(
  p_ticket_id uuid,
  p_limit integer default 50,
  p_before_time timestamptz default null,
  p_before_key text default null,
  p_as_of timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  v_rows jsonb;
  v_more boolean;
  v_last jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or (p_before_time is null) <> (p_before_key is null)
     or (p_before_key is not null and p_before_key !~ '^[idt]:[0-9a-f-]{36}$')
     or v_as_of > statement_timestamp() + interval '5 seconds' then
    raise exception 'invalid conversation cursor' using errcode = '22023';
  end if;
  select * into v_ticket from sellerpilot_private.support_tickets t
   where t.id=p_ticket_id and t.owner_id=auth.uid() and not t.demo;
  if not found then return null; end if;

  with events as (
    select 'i:'||m.id::text as key, m.sender_role as role, m.body,
      m.received_at as occurred_at, m.created_at as observed_at,
      'channel'::text as source, 'remote_observed'::text as delivery_status,
      m.remote_message_id, null::uuid as job_id
    from sellerpilot_private.support_inbound_messages m
    where m.ticket_id=v_ticket.id and m.owner_id=v_ticket.owner_id
      and m.channel_key=v_ticket.channel_key and m.created_at<=v_as_of
    union all
    select 'd:'||d.id::text, 'seller',
      case when d.channel_key='qoo10' then j.request_payload#>>'{arguments,params,contents}'
        else j.request_payload#>>'{arguments,reply}' end,
      d.queued_at, d.created_at, 'sellerpilot',
      case when d.status='succeeded' then 'provider_accepted' else d.status end,
      d.provider_message_id, d.gateway_job_id
    from sellerpilot_private.support_reply_deliveries d
    join sellerpilot_private.channel_gateway_jobs j on j.id=d.gateway_job_id
      and j.operation='inquiries.reply' and j.channel=d.channel_key
      and j.request_payload->>'sellerpilotTicketId'=d.ticket_id::text
    where d.ticket_id=v_ticket.id and d.owner_id=v_ticket.owner_id
      and d.channel_key=v_ticket.channel_key and d.created_at<=v_as_of
      and not exists (
        select 1 from sellerpilot_private.support_inbound_messages echo
         where echo.ticket_id=d.ticket_id and echo.owner_id=d.owner_id
           and echo.channel_key=d.channel_key and echo.sender_role='seller'
           and d.provider_message_id is not null
           and echo.remote_message_id=d.provider_message_id and echo.created_at<=v_as_of
      )
    union all
    -- Legacy tickets have no message row yet. Display the stored original,
    -- never the mutable reply draft as if it were a sent answer.
    select 't:'||v_ticket.id::text,'customer',v_ticket.message,
      v_ticket.received_at,null::timestamptz,'legacy_ticket','recorded',null,null
    where not exists (
      select 1 from sellerpilot_private.support_inbound_messages m
       where m.ticket_id=v_ticket.id and m.owner_id=v_ticket.owner_id and m.sender_role='customer'
         and m.created_at<=v_as_of
    ) and v_ticket.received_at<=v_as_of
  ), page as (
    select * from events
    where (p_before_time is null or (occurred_at,key)<(p_before_time,p_before_key))
    order by occurred_at desc,key desc limit p_limit+1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',key,'role',role,'body',body,'occurredAt',occurred_at,'observedAt',observed_at,
    'source',source,'deliveryStatus',delivery_status,'remoteMessageId',remote_message_id,'jobId',job_id
  ) order by occurred_at desc,key desc),'[]'::jsonb) into v_rows from page;
  v_more := jsonb_array_length(v_rows)>p_limit;
  if v_more then v_rows:=v_rows-p_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('ticketId',v_ticket.id,'messages',v_rows,'asOf',v_as_of,
    'nextCursor',case when v_more then jsonb_build_object('beforeTime',v_last->>'occurredAt','beforeKey',v_last->>'key','asOf',v_as_of) else null end);
end $$;
revoke all on function public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz) from public,anon,service_role;
grant execute on function public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
