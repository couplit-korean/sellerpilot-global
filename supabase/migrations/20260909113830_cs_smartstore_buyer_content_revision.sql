begin;

do $$
declare
  v_ingest regprocedure :=
    to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)');
begin
  if v_ingest is null
     or not exists (
       select 1
         from pg_proc procedure
        where procedure.oid = v_ingest
          and procedure.prosecdef
          and procedure.proowner = 'postgres'::regrole
          and procedure.proconfig = array['search_path=""']::text[]
          and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
          and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
     ) then
    raise exception 'SMARTSTORE_REVISION_INGEST_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure(
    'public.sellerpilot_09091045_ingest_before_smartstore_revision(uuid,text,jsonb)'
  ) is not null then
    raise exception 'SMARTSTORE_REVISION_INGEST_ALREADY_WRAPPED';
  end if;
end
$$;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_09091045_ingest_before_smartstore_revision;

create function public.sellerpilot_service_ingest_inquiries(
  p_credential_id uuid,
  p_channel text,
  p_inquiries jsonb
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_inquiry jsonb;
  v_inbound_key text;
  v_new_inbound_keys jsonb := '{}'::jsonb;
  v_previous_states jsonb := '{}'::jsonb;
  v_previous_state jsonb;
  v_count integer;
  v_provider_status text;
  v_provider_context jsonb;
  v_reply_context jsonb;
  v_ticket_kind text;
  v_external_order_reference text;
begin
  if p_channel <> 'smartstore'
     or jsonb_typeof(p_inquiries) is distinct from 'array' then
    return public.sellerpilot_09091045_ingest_before_smartstore_revision(
      p_credential_id,p_channel,p_inquiries
    );
  end if;

  select credential.created_by
    into v_owner
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.status in ('active','grace');
  if v_owner is null then
    return public.sellerpilot_09091045_ingest_before_smartstore_revision(
      p_credential_id,p_channel,p_inquiries
    );
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or coalesce(v_inquiry->>'senderRole','customer') in ('seller','system') then
      continue;
    end if;
    v_inbound_key:=left(nullif(trim(v_inquiry->>'inboundKey'),''),500);
    select to_jsonb(ticket)
      into v_previous_state
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id=v_owner
       and ticket.channel_key='smartstore'
       and ticket.external_ticket_id=left(
         trim(coalesce(v_inquiry->>'externalTicketId','')),
         240
       )
       and ticket.source_credential_id=p_credential_id
       and not ticket.demo
     for update;
    if found and v_inbound_key is not null then
      v_previous_states:=v_previous_states||jsonb_build_object(
        v_inbound_key,
        v_previous_state
      );
    end if;
    if v_inbound_key is not null and not exists(
      select 1
        from sellerpilot_private.support_inbound_messages message
       where message.owner_id=v_owner
         and message.channel_key='smartstore'
         and message.inbound_key=v_inbound_key
    ) then
      v_new_inbound_keys:=v_new_inbound_keys||jsonb_build_object(v_inbound_key,true);
    end if;
  end loop;

  v_count:=public.sellerpilot_09091045_ingest_before_smartstore_revision(
    p_credential_id,p_channel,p_inquiries
  );

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or coalesce(v_inquiry->>'senderRole','customer') in ('seller','system') then
      continue;
    end if;
    v_inbound_key:=left(nullif(trim(v_inquiry->>'inboundKey'),''),500);
    if v_inbound_key is null then
      continue;
    end if;

    v_previous_state:=v_previous_states->v_inbound_key;
    if not (v_new_inbound_keys ? v_inbound_key)
       and v_previous_state is not null
       and v_previous_state->>'latest_inbound_key' is distinct from v_inbound_key then
      update sellerpilot_private.support_tickets ticket
         set customer_name=v_previous_state->>'customer_name',
             subject=v_previous_state->>'subject',
             message=v_previous_state->>'message',
             received_at=(v_previous_state->>'received_at')::timestamptz,
             latest_inbound_key=v_previous_state->>'latest_inbound_key',
             provider_context=coalesce(v_previous_state->'provider_context','{}'::jsonb),
             reply_context=coalesce(v_previous_state->'reply_context','{}'::jsonb),
             provider_status=v_previous_state->>'provider_status',
             provider_status_updated_at=nullif(
               v_previous_state->>'provider_status_updated_at',''
             )::timestamptz,
             external_order_reference=v_previous_state->>'external_order_reference',
             ticket_kind=v_previous_state->>'ticket_kind',
             status=v_previous_state->>'status',
             priority=(v_previous_state->>'priority')::integer,
             resolved_at=nullif(v_previous_state->>'resolved_at','')::timestamptz,
             reply_draft=v_previous_state->>'reply_draft',
             reply_delivery_status=v_previous_state->>'reply_delivery_status',
             reply_delivery_error=v_previous_state->>'reply_delivery_error',
             reply_gateway_job_id=nullif(
               v_previous_state->>'reply_gateway_job_id',''
             )::uuid,
             reply_operation_attempt_id=nullif(
               v_previous_state->>'reply_operation_attempt_id',''
             )::uuid,
             last_delivery_job_id=nullif(
               v_previous_state->>'last_delivery_job_id',''
             )::uuid,
             updated_at=clock_timestamp()
       where ticket.id=(v_previous_state->>'id')::uuid;
      continue;
    end if;
    if not (v_new_inbound_keys ? v_inbound_key) then
      continue;
    end if;

    v_provider_status:=coalesce(
      nullif(v_inquiry->>'providerStatus',''),
      case when v_inquiry->>'status'='resolved' then 'answered' else 'waiting' end
    );
    v_provider_context:=case
      when jsonb_typeof(v_inquiry->'providerContext')='object'
        then v_inquiry->'providerContext'
      when jsonb_typeof(v_inquiry->'replyContext')='object'
        then v_inquiry->'replyContext'
      else '{}'::jsonb
    end;
    v_reply_context:=case
      when jsonb_typeof(v_inquiry->'replyContext')='object'
        then v_inquiry->'replyContext'
      else '{}'::jsonb
    end;
    v_ticket_kind:=coalesce(nullif(v_inquiry->>'ticketKind',''),'conversation');
    v_external_order_reference:=left(
      nullif(trim(v_inquiry->>'externalOrderReference'),''),
      240
    );

    update sellerpilot_private.support_tickets ticket
       set customer_name=left(coalesce(
             nullif(trim(v_inquiry->>'customerName'),''),
             ticket.customer_name
           ),240),
           subject=left(coalesce(
             nullif(trim(v_inquiry->>'subject'),''),
             ticket.subject
           ),500),
           message=v_inquiry->>'message',
           received_at=message.received_at,
           latest_inbound_key=v_inbound_key,
           provider_context=ticket.provider_context||v_provider_context,
           reply_context=v_reply_context,
           provider_status=v_provider_status,
           provider_status_updated_at=clock_timestamp(),
           external_order_reference=coalesce(
             v_external_order_reference,
             ticket.external_order_reference
           ),
           ticket_kind=v_ticket_kind,
           status=case
             when ticket.status='resolved' and v_provider_status='waiting'
               then 'waiting'
             else ticket.status
           end,
           resolved_at=case
             when ticket.status='resolved' and v_provider_status='waiting'
               then null
             else ticket.resolved_at
           end,
           reply_draft=null,
           reply_delivery_status='never',
           reply_delivery_error=null,
           reply_gateway_job_id=null,
           reply_operation_attempt_id=null,
           last_delivery_job_id=null,
           updated_at=clock_timestamp()
      from sellerpilot_private.support_inbound_messages message
     where message.owner_id=v_owner
       and message.channel_key='smartstore'
       and message.inbound_key=v_inbound_key
       and message.ticket_id=ticket.id
       and ticket.owner_id=v_owner
       and ticket.channel_key='smartstore'
       and ticket.source_credential_id=p_credential_id
       and not ticket.demo
       and ticket.latest_inbound_key is distinct from v_inbound_key;
  end loop;

  return v_count;
end
$$;

revoke all on function
  public.sellerpilot_09091045_ingest_before_smartstore_revision(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

comment on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) is
  'Ingests CS observations and advances a newly observed SmartStore buyer content revision even when the provider timestamp is unchanged; exact replays remain idempotent.';

notify pgrst,'reload schema';
commit;
