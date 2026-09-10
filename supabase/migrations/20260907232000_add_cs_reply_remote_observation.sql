-- Separate provider acceptance from an answer observed again through the
-- channel read path. Exact seller observations may close an uncertain ACK,
-- but only for the same ticket generation, recipient binding and body digest.
begin;

alter table sellerpilot_private.support_reply_deliveries
  add column verification_status text not null default 'unverified'
    check (verification_status in ('unverified','provider_accepted','remote_observed','reconciliation_required','failed')),
  add column verification_contract text,
  add column provider_accepted_at timestamptz,
  add column remote_observed_at timestamptz,
  add column observed_message_id uuid references sellerpilot_private.support_inbound_messages(id) on delete set null;

update sellerpilot_private.support_reply_deliveries set
  verification_status=case
    when status='succeeded' then 'provider_accepted'
    when status='reconciliation_required' then 'reconciliation_required'
    when status in ('failed','cancelled') then 'failed'
    else 'unverified' end,
  verification_contract=case when status='succeeded' then 'sellerpilot-reply-acceptance/1' else null end,
  provider_accepted_at=case when status='succeeded' then completed_at else null end;

create index support_reply_deliveries_verification_attention_idx
  on sellerpilot_private.support_reply_deliveries(verification_status,updated_at desc,id desc)
  where verification_status in ('unverified','provider_accepted','reconciliation_required');

create function sellerpilot_private.track_reply_acceptance_verification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.verification_status='remote_observed' then return new; end if;
  if new.status='succeeded' then
    new.verification_status:='provider_accepted';
    new.verification_contract:='sellerpilot-reply-acceptance/1';
    new.provider_accepted_at:=coalesce(new.provider_accepted_at,new.completed_at,clock_timestamp());
  elsif new.status='reconciliation_required' then
    new.verification_status:='reconciliation_required';
  elsif new.status in ('failed','cancelled') then
    new.verification_status:='failed';
  else
    new.verification_status:='unverified';
  end if;
  return new;
end $$;

create trigger track_reply_acceptance_verification
before insert or update of status on sellerpilot_private.support_reply_deliveries
for each row execute function sellerpilot_private.track_reply_acceptance_verification();
revoke all on function sellerpilot_private.track_reply_acceptance_verification()
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_observe_inquiry_replies_v1(
  p_credential_id uuid,p_channel text,p_observations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_credential record; v_observation jsonb; v_ticket sellerpilot_private.support_tickets%rowtype;
  v_message_id uuid; v_delivery_ids uuid[]; v_delivery_id uuid; v_job_id uuid;
  v_body text; v_fingerprint text; v_occurred_at timestamptz; v_now timestamptz:=clock_timestamp();
  v_received integer:=0; v_stored integer:=0; v_matched integer:=0; v_unmatched integer:=0; v_ambiguous integer:=0;
begin
  if p_channel not in ('qoo10','shopee','lazada','coupang','smartstore','ebay')
     or jsonb_typeof(p_observations)<>'array' or jsonb_array_length(p_observations)>500
     or octet_length(p_observations::text)>1000000 then
    raise exception 'CS_REPLY_OBSERVATION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  select c.created_by,c.channel into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id=p_credential_id and c.channel=p_channel and c.status in ('active','grace');
  if not found then raise exception 'active channel credential required'; end if;

  for v_observation in select value from jsonb_array_elements(p_observations) loop
    v_received:=v_received+1;
    if jsonb_typeof(v_observation)<>'object'
       or v_observation->>'contract'<>'sellerpilot-reply-observation/1'
       or coalesce(v_observation->>'externalTicketId','')=''
       or length(v_observation->>'externalTicketId')>240
       or coalesce(v_observation->>'inboundKey','') not like p_channel||':%'
       or length(coalesce(v_observation->>'inboundKey',''))>500
       or coalesce(v_observation->>'remoteMessageId','')=''
       or length(v_observation->>'remoteMessageId')>240
       or jsonb_typeof(v_observation->'binding')<>'object'
       or octet_length((v_observation->'binding')::text)>64000 then
      raise exception 'CS_REPLY_OBSERVATION_ARGUMENT_INVALID' using errcode='22023';
    end if;
    v_body:=v_observation->>'body';
    v_fingerprint:=v_observation->>'replyFingerprint';
    begin v_occurred_at:=(v_observation->>'occurredAt')::timestamptz;
    exception when others then raise exception 'CS_REPLY_OBSERVATION_ARGUMENT_INVALID' using errcode='22023'; end;
    if length(coalesce(v_body,'')) not between 1 and 20000 or v_occurred_at>v_now+interval '5 minutes'
       or v_fingerprint !~ '^[a-f0-9]{64}$'
       or encode(extensions.digest(regexp_replace(v_body,'^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')<>v_fingerprint then
      raise exception 'CS_REPLY_OBSERVATION_ARGUMENT_INVALID' using errcode='22023';
    end if;

    select ticket.* into v_ticket from sellerpilot_private.support_tickets ticket
     where ticket.owner_id=v_credential.created_by and ticket.channel_key=p_channel
       and ticket.source_credential_id=p_credential_id and not ticket.demo
       and (ticket.external_ticket_id=v_observation->>'externalTicketId'
         or (p_channel='ebay' and ticket.reply_context->>'parentMessageId'=v_observation#>>'{binding,parentMessageId}'))
     limit 1 for update;
    if not found then v_unmatched:=v_unmatched+1; continue; end if;

    insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,
      provider_context,received_at,updated_at
    ) values (
      v_ticket.id,v_ticket.owner_id,p_channel,v_observation->>'inboundKey',v_observation->>'remoteMessageId',
      'seller',v_body,jsonb_build_object('replyObservationContract','sellerpilot-reply-observation/1',
        'binding',v_observation->'binding'),v_occurred_at,v_now
    ) on conflict(owner_id,channel_key,inbound_key) do update set
      sender_role='seller',remote_message_id=excluded.remote_message_id,
      provider_context=sellerpilot_private.support_inbound_messages.provider_context||excluded.provider_context,
      updated_at=v_now
    where sellerpilot_private.support_inbound_messages.ticket_id=excluded.ticket_id
      and encode(extensions.digest(regexp_replace(sellerpilot_private.support_inbound_messages.body,
        '^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')=v_fingerprint
    returning id into v_message_id;
    if v_message_id is null then v_ambiguous:=v_ambiguous+1; continue; end if;
    v_stored:=v_stored+1;

    select array_agg(delivery.id order by delivery.queued_at desc),max(job.id::text)::uuid
      into v_delivery_ids,v_job_id
      from sellerpilot_private.support_reply_deliveries delivery
      join sellerpilot_private.channel_gateway_jobs job on job.id=delivery.gateway_job_id
     where delivery.ticket_id=v_ticket.id and delivery.owner_id=v_ticket.owner_id
       and delivery.channel_key=p_channel and delivery.status in ('succeeded','reconciliation_required')
       and delivery.verification_status<>'remote_observed'
       and delivery.reply_fingerprint=v_fingerprint
       and job.operation='inquiries.reply' and job.provider_mutation_started_at is not null
       and v_occurred_at>=job.provider_mutation_started_at-interval '5 minutes'
       and delivery.queued_at<=v_occurred_at+interval '5 minutes'
       and case p_channel
         when 'qoo10' then job.request_payload#>>'{arguments,params,inq_type}'=v_observation#>>'{binding,inquiryType}'
           and job.request_payload#>>'{arguments,params,question_no}'=v_observation#>>'{binding,questionNo}'
           and job.request_payload#>>'{arguments,params,seq_no}'=v_observation#>>'{binding,sequenceNo}'
         when 'shopee' then job.request_payload#>>'{arguments,shopId}'=v_observation#>>'{binding,shopId}'
           and job.request_payload#>>'{arguments,commentId}'=v_observation#>>'{binding,commentId}'
           and job.request_payload#>>'{arguments,itemId}'=v_observation#>>'{binding,itemId}'
         when 'lazada' then job.request_payload#>>'{arguments,sessionId}'=v_observation#>>'{binding,sessionId}'
         when 'coupang' then job.request_payload#>>'{arguments,kind}'=v_observation#>>'{binding,kind}'
           and job.request_payload#>>'{arguments,inquiryId}'=v_observation#>>'{binding,inquiryId}'
           and (job.request_payload#>>'{arguments,kind}'<>'call-center'
             or job.request_payload#>>'{arguments,parentAnswerId}'=v_observation#>>'{binding,parentAnswerId}')
         when 'smartstore' then job.request_payload#>>'{arguments,kind}'=v_observation#>>'{binding,kind}'
           and coalesce(job.request_payload#>>'{arguments,inquiryNo}',job.request_payload#>>'{arguments,questionId}')
             =coalesce(v_observation#>>'{binding,inquiryNo}',v_observation#>>'{binding,questionId}')
         when 'ebay' then job.request_payload#>>'{arguments,itemId}'=v_observation#>>'{binding,itemId}'
           and job.request_payload#>>'{arguments,parentMessageId}'=v_observation#>>'{binding,parentMessageId}'
           and job.request_payload#>>'{arguments,recipientId}'=v_observation#>>'{binding,recipientId}'
           and job.request_payload#>>'{arguments,marketplaceId}'=v_observation#>>'{binding,marketplaceId}'
         else false end;
    if coalesce(cardinality(v_delivery_ids),0)=0 then v_unmatched:=v_unmatched+1; continue; end if;
    if cardinality(v_delivery_ids)<>1 then v_ambiguous:=v_ambiguous+1; continue; end if;
    v_delivery_id:=v_delivery_ids[1];
    select gateway_job_id into v_job_id from sellerpilot_private.support_reply_deliveries where id=v_delivery_id;
    update sellerpilot_private.support_reply_deliveries set
      status='succeeded',verification_status='remote_observed',
      verification_contract='sellerpilot-reply-observation/1',remote_observed_at=v_occurred_at,
      observed_message_id=v_message_id,provider_message_id=v_observation->>'remoteMessageId',
      reconciliation_reason=null,updated_at=v_now
    where id=v_delivery_id;
    update sellerpilot_private.support_tickets ticket set
      status='resolved',provider_status='answered',provider_status_updated_at=v_now,
      reply_delivery_status='succeeded',reply_delivery_error=null,
      resolved_at=coalesce(ticket.resolved_at,v_occurred_at),updated_at=v_now
    from sellerpilot_private.channel_gateway_jobs job
    where ticket.id=v_ticket.id and job.id=v_job_id
      and job.request_payload->>'sellerpilotInboundKey'=ticket.latest_inbound_key;
    v_matched:=v_matched+1;
  end loop;
  return jsonb_build_object('contract','sellerpilot-reply-observation-result/1',
    'received',v_received,'stored',v_stored,'matched',v_matched,
    'unmatched',v_unmatched,'ambiguous',v_ambiguous);
end $$;

revoke all on function public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)
  to service_role;

create or replace function public.sellerpilot_get_inquiry_reply_delivery(
  p_ticket_id uuid,p_job_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else (
    select jsonb_build_object(
      'jobId',d.gateway_job_id,'ticketId',d.ticket_id,'channel',d.channel_key,
      'inboundKey',job.request_payload->>'sellerpilotInboundKey','status',d.status,
      'verificationStatus',d.verification_status,'verificationContract',d.verification_contract,
      'safeMessage',d.safe_message,'reconciliationReason',d.reconciliation_reason,
      'providerRequestId',d.provider_request_id,'providerMessageId',d.provider_message_id,
      'providerAcceptedAt',d.provider_accepted_at,'remoteObservedAt',d.remote_observed_at,
      'queuedAt',d.queued_at,'startedAt',d.started_at,'completedAt',d.completed_at,'updatedAt',d.updated_at)
    from sellerpilot_private.support_reply_deliveries d
    join sellerpilot_private.channel_gateway_jobs job on job.id=d.gateway_job_id
    join sellerpilot_private.support_tickets t on t.id=d.ticket_id
    where d.ticket_id=p_ticket_id and ((p_job_id is not null and d.gateway_job_id=p_job_id)
      or (p_job_id is null and d.gateway_job_id=t.last_delivery_job_id)) and not t.demo
    order by d.queued_at desc,d.id desc limit 1
  ) end
$$;
revoke all on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid) to authenticated;

-- Keep the existing workspace contract and add the two verification fields to
-- both current and blocking delivery objects without duplicating the large
-- snapshot query or changing its unrelated product/order fields.
do $extend_cs_workspace_reply_verification$
declare v_definition text; v_rewritten text;
begin
  if to_regprocedure('public.sellerpilot_get_cs_workspace_snapshot()') is null then return; end if;
  select pg_catalog.pg_get_functiondef('public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure)
    into v_definition;
  v_rewritten:=replace(v_definition,
    $old$'status', d.status,$old$,
    $new$'status', d.status, 'verificationStatus', d.verification_status,
        'verificationContract', d.verification_contract,
        'providerAcceptedAt', d.provider_accepted_at, 'remoteObservedAt', d.remote_observed_at,$new$);
  v_rewritten:=replace(v_rewritten,
    $old$'status', blocking.status,$old$,
    $new$'status', blocking.status, 'verificationStatus', blocking.verification_status,
        'verificationContract', blocking.verification_contract,
        'providerAcceptedAt', blocking.provider_accepted_at, 'remoteObservedAt', blocking.remote_observed_at,$new$);
  if v_rewritten=v_definition
     or v_rewritten not like '%verificationStatus%'
     or v_rewritten not like '%remoteObservedAt%' then
    raise exception 'CS workspace reply verification contract mismatch';
  end if;
  execute v_rewritten;
end
$extend_cs_workspace_reply_verification$;

notify pgrst,'reload schema';
commit;
