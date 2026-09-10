-- Generated central migration proposal for CS-coupang-CONT-01.
-- Unapplied outside the private integration sandbox.
-- Central must re-check production version, name, source hash, and ACLs before use.

begin;

do $$
begin
  if to_regprocedure(
       'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)'
     ) is null
     or (select md5(prosrc) from pg_proc
          where oid = 'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)'::regprocedure)
        is distinct from '5f9207857224ff50f745d8ce5bb51d96'
     or not has_function_privilege(
          'authenticated',
          'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)',
          'EXECUTE'
        )
     or has_function_privilege(
          'anon',
          'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)',
          'EXECUTE'
        )
     or has_function_privilege(
          'service_role',
          'public.sellerpilot_read_coupang_cs_verification_v1(uuid,date,date,text,integer)',
          'EXECUTE'
        ) then
    raise exception 'COUPANG_CS_VERIFICATION_NAMESPACE_PREIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

create or replace function public.sellerpilot_read_coupang_cs_verification_v1(
  p_credential_id uuid,
  p_from_date date,
  p_to_date date,
  p_kind text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_total integer;
  v_tickets jsonb;
begin
  if v_actor is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_kind is null or p_limit is null or p_kind not in (
       'product','call-center','return_request','cancel_request','exchange_request'
     )
     or p_from_date is null or p_to_date is null
     or p_to_date < p_from_date or p_to_date - p_from_date > 30
     or p_from_date < date '2000-01-01'
     or p_to_date > (current_timestamp at time zone 'Asia/Seoul')::date
     or p_limit not between 1 and 100 then
    raise exception 'COUPANG_CS_VERIFICATION_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select credential.created_by into v_owner
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'coupang';
  if not found then
    raise exception 'COUPANG_CS_VERIFICATION_CREDENTIAL_INVALID' using errcode = '22023';
  end if;

  select count(*)::integer into v_total
    from sellerpilot_private.support_tickets ticket
   where ticket.owner_id = v_owner
     and ticket.source_credential_id = p_credential_id
     and ticket.channel_key = 'coupang'
     and not ticket.demo
     and ticket.external_ticket_id like any (
       case p_kind
         when 'return_request' then array['return_request:%', 'coupang:return:%']
         when 'cancel_request' then array['cancel_request:%', 'coupang:cancel:%']
         when 'exchange_request' then array['exchange_request:%', 'coupang:exchange:%']
         else array[p_kind || ':%']
       end
     )
     and ticket.received_at >= (p_from_date::timestamp at time zone 'Asia/Seoul')
     and ticket.received_at < ((p_to_date + 1)::timestamp at time zone 'Asia/Seoul');

  select coalesce(jsonb_agg(selected.value order by selected.received_at desc, selected.external_ticket_id), '[]'::jsonb)
    into v_tickets
    from (
      select ticket.received_at, ticket.external_ticket_id,
        jsonb_build_object(
          'externalTicketId', ticket.external_ticket_id,
          'externalOrderReference', ticket.external_order_reference,
          'ticketKind', ticket.ticket_kind,
          'status', ticket.status,
          'providerStatus', ticket.provider_status,
          'receivedAt', to_char(ticket.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'messages', coalesce((
            select jsonb_agg(jsonb_build_object(
              'inboundKey', message.inbound_key,
              'remoteMessageId', message.remote_message_id,
              'senderRole', message.sender_role,
              'body', message.body,
              'receivedAt', to_char(message.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'parentAnswerId', coalesce(
                message.provider_context#>>'{binding,parentAnswerId}',
                message.provider_context->>'parentAnswerId'
              )
            ) order by message.received_at, message.id)
              from sellerpilot_private.support_inbound_messages message
             where message.ticket_id = ticket.id
               and message.owner_id = v_owner
               and message.channel_key = 'coupang'
          ), '[]'::jsonb)
        ) value
        from sellerpilot_private.support_tickets ticket
       where ticket.owner_id = v_owner
         and ticket.source_credential_id = p_credential_id
         and ticket.channel_key = 'coupang'
         and not ticket.demo
         and ticket.external_ticket_id like any (
           case p_kind
             when 'return_request' then array['return_request:%', 'coupang:return:%']
             when 'cancel_request' then array['cancel_request:%', 'coupang:cancel:%']
             when 'exchange_request' then array['exchange_request:%', 'coupang:exchange:%']
             else array[p_kind || ':%']
           end
         )
         and ticket.received_at >= (p_from_date::timestamp at time zone 'Asia/Seoul')
         and ticket.received_at < ((p_to_date + 1)::timestamp at time zone 'Asia/Seoul')
       order by ticket.received_at desc, ticket.external_ticket_id
       limit p_limit
    ) selected;

  return jsonb_build_object(
    'contract', 'sellerpilot-coupang-cs-verification/1',
    'credentialId', p_credential_id,
    'kind', p_kind,
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'totalTickets', v_total,
    'displayedTickets', jsonb_array_length(v_tickets),
    'tickets', v_tickets
  );
end;
$$;

revoke all on function public.sellerpilot_read_coupang_cs_verification_v1(
  uuid,date,date,text,integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_coupang_cs_verification_v1(
  uuid,date,date,text,integer
) to authenticated;

comment on function public.sellerpilot_read_coupang_cs_verification_v1(
  uuid,date,date,text,integer
) is 'Authenticated exact-ID Coupang CS DB-to-web verification read with legacy after-sales namespace compatibility.';

notify pgrst, 'reload schema';
commit;
