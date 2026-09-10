-- Integration-owned forward migration draft. Do not apply to production from
-- the Lazada worktree. It projects only evidence-backed V3 revision state into
-- the authenticated shared archive/conversation readers.
begin;

do $migration$
begin
  if to_regclass('sellerpilot_private.lazada_im_message_revisions') is null
     or to_regprocedure('public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)') is null
     or to_regprocedure('public.sellerpilot_search_cs_archive_v2(text,text,text,date,date,uuid,text,text,text,integer,timestamptz,uuid,timestamptz)') is null then
    raise exception 'LAZADA_IM_V3_CONVERSATION_READ_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('sellerpilot_private.lazada_im_projection_state_v1(uuid,uuid,text,text,text,text,timestamptz)') is not null then
    raise exception 'LAZADA_IM_V3_CONVERSATION_READ_ALREADY_EXISTS';
  end if;
end
$migration$;

create function sellerpilot_private.lazada_im_projection_state_v1(
  p_owner_id uuid,
  p_credential_id uuid,
  p_seller_account_key text,
  p_external_ticket_id text,
  p_remote_message_id text,
  p_native_content_fingerprint text,
  p_as_of timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
        select 1
          from sellerpilot_private.lazada_im_message_revisions revision
         where revision.owner_id = p_owner_id
           and revision.credential_id = p_credential_id
           and revision.seller_account_key = p_seller_account_key
           and revision.external_ticket_id = p_external_ticket_id
           and revision.remote_message_id = p_remote_message_id
           and revision.revision_kind = 'recalled'
           and revision.native_content_fingerprint = p_native_content_fingerprint
           and revision.provider_context->>'eventKind' = 'recalled'
           and revision.provider_context->>'recallTargetMessageId' = p_remote_message_id
           and revision.first_observed_at <= p_as_of
      ) then 'recalled'
    when exists (
      select 1
        from sellerpilot_private.lazada_im_message_revisions revision
       where revision.owner_id = p_owner_id
         and revision.credential_id = p_credential_id
         and revision.seller_account_key = p_seller_account_key
         and revision.external_ticket_id = p_external_ticket_id
         and revision.remote_message_id = p_remote_message_id
         and revision.revision_kind = 'conflict'
         and revision.first_observed_at <= p_as_of
    ) then 'conflict_review_required'
    else 'normal'
  end
$$;
revoke all on function sellerpilot_private.lazada_im_projection_state_v1(uuid,uuid,text,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_get_cs_conversation(
  p_ticket_id uuid, p_limit integer default 50,
  p_before_time timestamptz default null, p_before_key text default null,
  p_as_of timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_as_of timestamptz:=coalesce(p_as_of,statement_timestamp());
  v_rows jsonb; v_more boolean; v_last jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_time is null)<>(p_before_key is null)
    or (p_before_key is not null and p_before_key !~ '^[idt]:[0-9a-f-]{36}$')
    or v_as_of>statement_timestamp()+interval '5 seconds' then
    raise exception 'invalid conversation cursor' using errcode='22023';
  end if;
  select * into v_ticket from sellerpilot_private.support_tickets t
    where t.id=p_ticket_id and t.owner_id=auth.uid() and not t.demo;
  if not found then return null; end if;

  with message_events as (
    select m.*,
      case when m.channel_key='lazada' then
        sellerpilot_private.lazada_im_projection_state_v1(
          m.owner_id,v_ticket.source_credential_id,v_ticket.seller_account_key,
          v_ticket.external_ticket_id,m.remote_message_id,
          m.provider_context->>'nativeContentFingerprint',v_as_of
        ) else 'normal' end as message_state
      from sellerpilot_private.support_inbound_messages m
     where m.ticket_id=v_ticket.id and m.owner_id=v_ticket.owner_id
       and m.channel_key=v_ticket.channel_key and m.created_at<=v_as_of
  ), events as (
    select 'i:'||m.id::text as key,m.sender_role as role,
      case when m.message_state='recalled' then 'Lazada 메시지가 회수되었습니다.' else m.body end as body,
      m.received_at as occurred_at,m.created_at as observed_at,
      'channel'::text as source,'remote_observed'::text as delivery_status,
      m.remote_message_id,null::uuid as job_id,
      case when m.message_state='recalled' then null::jsonb
        when jsonb_typeof(m.provider_context->'nativeMedia')='object'
        then m.provider_context->'nativeMedia' else null end as native_media,
      coalesce((select jsonb_agg(jsonb_build_object('body',a.value->>'body','reason','provider_timestamp_unavailable') order by a.ordinality)
        from jsonb_array_elements(case when jsonb_typeof(m.provider_context->'unsequencedAnswers')='array'
          then m.provider_context->'unsequencedAnswers' else '[]'::jsonb end) with ordinality a(value,ordinality)
        where a.ordinality<=100 and jsonb_typeof(a.value->'body')='string'
          and length(a.value->>'body') between 1 and 20000
          and a.value->>'reason'='provider_timestamp_unavailable'),'[]'::jsonb) as unsequenced_answers,
      m.message_state
    from message_events m
    union all
    select 'd:'||d.id::text,'seller',case when d.channel_key='qoo10' then j.request_payload#>>'{arguments,params,contents}'
      else j.request_payload#>>'{arguments,reply}' end,d.queued_at,d.created_at,'sellerpilot',
      case when d.status='succeeded' then 'provider_accepted' else d.status end,
      d.provider_message_id,d.gateway_job_id,null::jsonb,'[]'::jsonb,'normal'::text
    from sellerpilot_private.support_reply_deliveries d
    join sellerpilot_private.channel_gateway_jobs j on j.id=d.gateway_job_id and j.operation='inquiries.reply'
      and j.channel=d.channel_key and j.request_payload->>'sellerpilotTicketId'=d.ticket_id::text
    where d.ticket_id=v_ticket.id and d.owner_id=v_ticket.owner_id and d.channel_key=v_ticket.channel_key
      and d.created_at<=v_as_of and not exists(select 1 from sellerpilot_private.support_inbound_messages echo
        where echo.ticket_id=d.ticket_id and echo.owner_id=d.owner_id and echo.channel_key=d.channel_key
          and echo.sender_role='seller' and d.provider_message_id is not null
          and echo.remote_message_id=d.provider_message_id and echo.created_at<=v_as_of)
    union all
    select 't:'||v_ticket.id::text,'customer',v_ticket.message,v_ticket.received_at,null::timestamptz,
      'legacy_ticket','recorded',null,null,null::jsonb,'[]'::jsonb,'normal'::text
    where not exists(select 1 from sellerpilot_private.support_inbound_messages m
      where m.ticket_id=v_ticket.id and m.owner_id=v_ticket.owner_id and m.sender_role='customer'
        and m.created_at<=v_as_of) and v_ticket.received_at<=v_as_of
  ), page as (
    select * from events where (p_before_time is null or (occurred_at,key)<(p_before_time,p_before_key))
      order by occurred_at desc,key desc limit p_limit+1
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'key',key,'role',role,'body',body,'occurredAt',occurred_at,'observedAt',observed_at,
    'source',source,'deliveryStatus',delivery_status,'remoteMessageId',remote_message_id,'jobId',job_id,
    'nativeMedia',native_media,'unsequencedAnswers',unsequenced_answers,'messageState',message_state
  ) order by occurred_at desc,key desc),'[]'::jsonb) into v_rows from page;
  v_more:=jsonb_array_length(v_rows)>p_limit;
  if v_more then v_rows:=v_rows-p_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('ticketId',v_ticket.id,'messages',v_rows,'asOf',v_as_of,
    'nextCursor',case when v_more then jsonb_build_object('beforeTime',v_last->>'occurredAt','beforeKey',v_last->>'key','asOf',v_as_of) else null end);
end $$;

revoke all on function public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)
  to authenticated;

create or replace function public.sellerpilot_search_cs_archive_v2(
  p_query text default '', p_channel text default null, p_status text default null,
  p_from_date date default null, p_to_date date default null,
  p_account_id uuid default null, p_shop_id text default null,
  p_ticket_kind text default null, p_source text default null,
  p_limit integer default 25, p_before_time timestamptz default null,
  p_before_id uuid default null, p_as_of timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_as_of timestamptz:=coalesce(p_as_of,statement_timestamp());
  v_query text:=trim(coalesce(p_query,''));
  v_shop_id text:=nullif(trim(coalesce(p_shop_id,'')),'');
  v_pattern text; v_rows jsonb; v_more boolean; v_last jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if length(v_query)>120 or p_limit is null or p_limit not between 1 and 50
    or (p_channel is not null and p_channel not in ('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu'))
    or (p_status is not null and p_status not in ('waiting','urgent','in_progress','resolved'))
    or (v_shop_id is not null and (length(v_shop_id)>120 or v_shop_id !~ '^[A-Za-z0-9:_-]+$'))
    or (p_ticket_kind is not null and p_ticket_kind not in ('conversation','after_sales'))
    or (p_source is not null and p_source not in ('channel','legacy_ticket'))
    or (p_from_date is not null and p_to_date is not null and p_from_date>p_to_date)
    or (p_before_time is null)<>(p_before_id is null)
    or v_as_of>statement_timestamp()+interval '5 seconds' then
    raise exception 'invalid archive search' using errcode='22023';
  end if;
  v_pattern:='%'||replace(replace(replace(v_query,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with results as (
    select t.id,t.channel_key,t.external_ticket_id,t.customer_name,t.subject,t.status,t.received_at,
      t.source_credential_id,
      coalesce(nullif(t.reply_context->>'shopId',''),nullif(t.provider_context->>'shopId',''),
        nullif(t.provider_context->>'sellerId',''),nullif(t.provider_context->>'sellerNo',''),
        nullif(t.provider_context->>'accountId','')) as shop_id,
      t.ticket_kind,
      case when exists(select 1 from sellerpilot_private.support_inbound_messages source_message
        where source_message.ticket_id=t.id and source_message.owner_id=t.owner_id
          and source_message.channel_key=t.channel_key and source_message.created_at<=v_as_of)
        then 'channel' else 'legacy_ticket' end as source,
      case when coalesce(latest_projection.message_state,'normal')='recalled'
        then 'Lazada 메시지가 회수되었습니다.' else left(t.message,250) end as preview,
      coalesce(latest_projection.message_state,'normal') as latest_message_state
    from sellerpilot_private.support_tickets t
    left join lateral (
      select sellerpilot_private.lazada_im_projection_state_v1(
        latest.owner_id,t.source_credential_id,t.seller_account_key,t.external_ticket_id,
        latest.remote_message_id,latest.provider_context->>'nativeContentFingerprint',
        v_as_of
      ) as message_state
      from sellerpilot_private.support_inbound_messages latest
      where t.channel_key='lazada' and latest.ticket_id=t.id and latest.owner_id=t.owner_id
        and latest.channel_key=t.channel_key and latest.inbound_key=t.latest_inbound_key
        and latest.created_at<=v_as_of
      order by latest.created_at desc,latest.id desc limit 1
    ) latest_projection on true
    where t.owner_id=auth.uid() and not t.demo and t.updated_at<=v_as_of
      and (p_channel is null or t.channel_key=p_channel)
      and (p_status is null or t.status=p_status)
      and (p_account_id is null or t.source_credential_id=p_account_id)
      and (v_shop_id is null or v_shop_id=coalesce(nullif(t.reply_context->>'shopId',''),
        nullif(t.provider_context->>'shopId',''),nullif(t.provider_context->>'sellerId',''),
        nullif(t.provider_context->>'sellerNo',''),nullif(t.provider_context->>'accountId','')))
      and (p_ticket_kind is null or t.ticket_kind=p_ticket_kind)
      and (p_source is null or (p_source='channel')=exists(select 1
        from sellerpilot_private.support_inbound_messages source_message
        where source_message.ticket_id=t.id and source_message.owner_id=t.owner_id
          and source_message.channel_key=t.channel_key and source_message.created_at<=v_as_of))
      and (p_from_date is null or t.received_at>=p_from_date::timestamp at time zone 'Asia/Seoul')
      and (p_to_date is null or t.received_at<(p_to_date+1)::timestamp at time zone 'Asia/Seoul')
      and (p_before_time is null or (t.received_at,t.id)<(p_before_time,p_before_id))
      and (v_query='' or t.external_ticket_id ilike v_pattern or t.customer_name ilike v_pattern
        or t.subject ilike v_pattern
        or (coalesce(latest_projection.message_state,'normal')<>'recalled' and t.message ilike v_pattern)
        or exists(select 1 from sellerpilot_private.support_inbound_messages m
          where m.ticket_id=t.id and m.owner_id=t.owner_id and m.channel_key=t.channel_key and m.created_at<=v_as_of
            and (m.channel_key<>'lazada' or sellerpilot_private.lazada_im_projection_state_v1(
              m.owner_id,t.source_credential_id,t.seller_account_key,t.external_ticket_id,
              m.remote_message_id,m.provider_context->>'nativeContentFingerprint',v_as_of
            )<>'recalled')
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
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'channel',channel_key,'externalId',external_ticket_id,'customer',customer_name,
    'subject',subject,'status',status,'receivedAt',received_at,'preview',preview,
    'accountId',source_credential_id,'shopId',shop_id,'ticketKind',ticket_kind,'source',source,
    'latestMessageState',latest_message_state
  ) order by received_at desc,id desc),'[]'::jsonb) into v_rows from results;
  v_more:=jsonb_array_length(v_rows)>p_limit;
  if v_more then v_rows:=v_rows-p_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('tickets',v_rows,'asOf',v_as_of,'nextCursor',case when v_more then
    jsonb_build_object('beforeTime',v_last->>'receivedAt','beforeId',v_last->>'id','asOf',v_as_of) else null end);
end $$;

revoke all on function public.sellerpilot_search_cs_archive_v2(text,text,text,date,date,uuid,text,text,text,integer,timestamptz,uuid,timestamptz)
  from public,anon,service_role;
grant execute on function public.sellerpilot_search_cs_archive_v2(text,text,text,date,date,uuid,text,text,text,integer,timestamptz,uuid,timestamptz)
  to authenticated;

notify pgrst,'reload schema';
commit;
