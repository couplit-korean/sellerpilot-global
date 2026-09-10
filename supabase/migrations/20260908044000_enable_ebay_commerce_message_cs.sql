-- Add eBay Commerce Message conversations without weakening the existing
-- Trading API ASQ path. Conversation IDs and ASQ MessageIDs are intentionally
-- separate namespaces and are never interchangeable at ingest or send time.

begin;

do $$
begin
  if to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)') is null
     or to_regprocedure('sellerpilot_private.support_deletion_fingerprint(uuid,text,text)') is null
     or to_regclass('sellerpilot_private.support_ticket_deletions') is null
     or to_regclass('sellerpilot_private.support_message_deletions') is null then
    raise exception 'EBAY_COMMERCE_MESSAGE_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('public.sellerpilot_08003000_ingest_before_ebay_conversation(uuid,text,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_08003000_enqueue_reply_before_ebay_conversation(uuid,text,text,jsonb)') is not null then
    raise exception 'EBAY_COMMERCE_MESSAGE_MIGRATION_ALREADY_WRAPPED';
  end if;
end $$;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_08003000_ingest_before_ebay_conversation;
revoke all on function public.sellerpilot_08003000_ingest_before_ebay_conversation(uuid,text,jsonb)
  from public,anon,authenticated,service_role;

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
#variable_conflict use_variable
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_inquiry jsonb;
  v_context jsonb;
  v_reply_context jsonb;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_ticket_found boolean;
  v_existing_message sellerpilot_private.support_inbound_messages%rowtype;
  v_message_found boolean;
  v_current_received_at timestamptz;
  v_received_at timestamptz;
  v_external_id text;
  v_expected_external_id text;
  v_inbound_key text;
  v_expected_inbound_key text;
  v_remote_message_id text;
  v_expected_remote_message_id text;
  v_conversation_id text;
  v_conversation_type text;
  v_message_id text;
  v_sender_role text;
  v_message text;
  v_provider_status text;
  v_status text;
  v_reply_supported boolean;
  v_should_advance boolean;
  v_count integer:=0;
  v_ledger_count integer;
begin
  if p_channel <> 'ebay'
     or p_inquiries='[]'::jsonb
     or not exists(
       select 1 from jsonb_array_elements(p_inquiries) item
        where item#>>'{providerContext,kind}'='conversation'
     ) then
    return public.sellerpilot_08003000_ingest_before_ebay_conversation(
      p_credential_id,p_channel,p_inquiries
    );
  end if;

  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries)>500
     or octet_length(p_inquiries::text)>1000000
     or exists(
       select 1 from jsonb_array_elements(p_inquiries) item
        where jsonb_typeof(item) is distinct from 'object'
           or item#>>'{providerContext,kind}' is distinct from 'conversation'
     ) then
    raise exception 'EBAY_CONVERSATION_INGEST_BATCH_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993,821065043);
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='ebay'
     and credential.status in('active','grace')
   for update;
  if not found then raise exception 'active channel credential required';end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source<>'provider_certified_v1'
     or v_credential.seller_account_verified_at is null then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) item(value) loop
    v_context:=v_inquiry->'providerContext';
    v_reply_context:=case when jsonb_typeof(v_inquiry->'replyContext')='object'
      then v_inquiry->'replyContext' else '{}'::jsonb end;
    v_external_id:=coalesce(v_inquiry->>'externalTicketId','');
    v_inbound_key:=coalesce(v_inquiry->>'inboundKey','');
    v_remote_message_id:=coalesce(v_inquiry->>'remoteMessageId','');
    v_conversation_id:=coalesce(v_context->>'conversationId','');
    v_conversation_type:=coalesce(v_context->>'conversationType','');
    v_message_id:=coalesce(v_context->>'messageId','');
    v_sender_role:=coalesce(v_inquiry->>'senderRole','');
    v_message:=coalesce(v_inquiry->>'message','');
    v_provider_status:=coalesce(v_inquiry->>'providerStatus','');
    v_status:=coalesce(v_inquiry->>'status','');
    v_reply_supported:=coalesce((v_context->>'replySupported')::boolean,false);

    v_expected_external_id:='ebay:conversation:'||encode(extensions.digest(
      'ebay-conversation-v1'||chr(31)||v_conversation_id,'sha256'
    ),'hex');
    v_expected_remote_message_id:='conversation:'||encode(extensions.digest(
      'ebay-conversation-message-v1'||chr(31)||v_conversation_id||chr(31)||v_message_id,'sha256'
    ),'hex');
    v_expected_inbound_key:='ebay:'||encode(extensions.digest(
      'v2'||chr(31)||'ebay'||chr(31)||v_expected_external_id||chr(31)||v_expected_remote_message_id,'sha256'
    ),'hex');

    begin
      v_received_at:=(v_inquiry->>'receivedAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'EBAY_CONVERSATION_TIMESTAMP_INVALID';
    end;

    if jsonb_typeof(v_context) is distinct from 'object'
       or octet_length(v_context::text)>64000
       or v_conversation_id='' or length(v_conversation_id)>240
       or v_conversation_id<>trim(v_conversation_id)
       or v_conversation_id~'[[:cntrl:]]'
       or v_message_id='' or length(v_message_id)>240
       or v_message_id<>trim(v_message_id)
       or v_message_id~'[[:cntrl:]]'
       or v_conversation_type not in('FROM_MEMBERS','FROM_EBAY')
       or v_sender_role not in('customer','seller','system')
       or (v_conversation_type='FROM_EBAY' and v_sender_role<>'system')
       or (v_conversation_type='FROM_MEMBERS' and v_sender_role='system')
       or v_external_id<>v_expected_external_id
       or v_remote_message_id<>v_expected_remote_message_id
       or v_inbound_key<>v_expected_inbound_key
       or v_message='' or length(v_message)>20000 or octet_length(v_message)>60000
       or length(coalesce(v_inquiry->>'customerName',''))>240
       or length(coalesce(v_inquiry->>'subject',''))>2000
       or v_received_at is null
       or v_provider_status<>(case when v_sender_role='customer'then'waiting'else'answered'end)
       or v_status<>(case when v_sender_role='customer'then'waiting'else'resolved'end)
       or v_reply_supported is distinct from(
         v_conversation_type='FROM_MEMBERS' and v_sender_role='customer'
       )
       or coalesce(v_context->>'kind','')<>'conversation'
       or coalesce(v_context->>'senderUsername','')=''
       or coalesce(v_context->>'recipientUsername','')='' then
      raise exception 'EBAY_CONVERSATION_CONTEXT_INVALID';
    end if;

    if v_reply_supported then
      if (select count(*) from jsonb_object_keys(v_reply_context))<>5
         or v_reply_context->>'kind'<>'conversation'
         or v_reply_context->>'conversationId'<>v_conversation_id
         or v_reply_context->>'conversationType'<>'FROM_MEMBERS'
         or v_reply_context->>'messageId'<>v_message_id
         or v_reply_context->>'replySupported'<>'true' then
        raise exception 'EBAY_CONVERSATION_REPLY_CONTEXT_INVALID';
      end if;
    elsif v_reply_context->>'replySupported' is distinct from 'false'
       or v_reply_context->>'kind' is distinct from 'conversation'
       or v_reply_context->>'conversationId' is distinct from v_conversation_id
       or v_reply_context->>'conversationType' is distinct from v_conversation_type
       or v_reply_context->>'messageId' is distinct from v_message_id then
      -- finalizeInquiry copies providerContext for non-replyable messages.
      raise exception 'EBAY_CONVERSATION_NONREPLY_CONTEXT_INVALID';
    end if;

    -- A deleted history item stays deleted. A genuinely newer provider
    -- message may recreate the conversation and becomes its new generation.
    if exists(
      select 1 from sellerpilot_private.support_ticket_deletions deletion
       where deletion.owner_id=v_credential.created_by
         and deletion.channel_key='ebay'
         and deletion.external_ticket_fingerprint=
           sellerpilot_private.support_deletion_fingerprint(v_credential.created_by,'ebay',v_external_id)
         and(
           v_received_at<=deletion.deleted_through_at
           or exists(
             select 1 from sellerpilot_private.support_message_deletions message_deletion
              where message_deletion.deletion_id=deletion.id
                and(
                  message_deletion.inbound_key_fingerprint=
                    sellerpilot_private.support_deletion_fingerprint(v_credential.created_by,'ebay',v_inbound_key)
                  or message_deletion.remote_message_fingerprint=
                    sellerpilot_private.support_deletion_fingerprint(v_credential.created_by,'ebay',v_remote_message_id)
                )
           )
         )
    ) then continue;end if;

    select message.* into v_existing_message
      from sellerpilot_private.support_inbound_messages message
     where message.owner_id=v_credential.created_by
       and message.channel_key='ebay'
       and message.inbound_key=v_inbound_key
     for update;
    v_message_found:=found;
    if v_message_found and(
      v_existing_message.remote_message_id is distinct from v_remote_message_id
      or v_existing_message.sender_role is distinct from v_sender_role
      or v_existing_message.body is distinct from v_message
      or v_existing_message.provider_context is distinct from v_context
      or v_existing_message.received_at is distinct from v_received_at
    ) then
      raise exception 'EBAY_CONVERSATION_MESSAGE_CONFLICT';
    end if;

    select ticket.* into v_ticket
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id=v_credential.created_by
       and ticket.channel_key='ebay'
       and ticket.external_ticket_id=v_external_id
     for update;
    v_ticket_found:=found;
    if v_ticket_found and(
      v_ticket.seller_account_key is distinct from v_credential.seller_account_key
      or v_ticket.source_credential_id is null
    ) then
      raise exception 'INQUIRY_SELLER_LINEAGE_MISMATCH';
    end if;
    if v_message_found and(
      not v_ticket_found or v_existing_message.ticket_id<>v_ticket.id
    ) then
      raise exception 'EBAY_CONVERSATION_MESSAGE_TICKET_MISMATCH';
    end if;

    if not v_ticket_found then
      insert into sellerpilot_private.support_tickets(
        owner_id,external_ticket_id,channel_key,customer_name,subject,message,
        status,priority,received_at,resolved_at,demo,updated_at,
        source_credential_id,seller_account_key,reply_context,
        provider_status,provider_status_updated_at,latest_inbound_key,
        provider_context,channel_account_id,ticket_kind
      )values(
        v_credential.created_by,v_external_id,'ebay',
        left(coalesce(nullif(trim(v_inquiry->>'customerName'),''),'eBay 고객'),240),
        left(coalesce(nullif(trim(v_inquiry->>'subject'),''),'eBay 대화'),500),
        v_message,v_status,greatest(1,least(5,coalesce((v_inquiry->>'priority')::integer,3))),
        v_received_at,case when v_status='resolved'then v_received_at else null end,false,now(),
        p_credential_id,v_credential.seller_account_key,
        case when v_reply_supported then v_reply_context else '{}'::jsonb end,
        v_provider_status,now(),v_inbound_key,v_context,p_credential_id,'conversation'
      )returning * into v_ticket;
      v_ticket_found:=true;
      v_should_advance:=true;
    else
      select current_message.received_at into v_current_received_at
        from sellerpilot_private.support_inbound_messages current_message
       where current_message.ticket_id=v_ticket.id
         and current_message.inbound_key=v_ticket.latest_inbound_key;
      v_should_advance:=v_current_received_at is null
        or v_received_at>v_current_received_at
        or(v_received_at=v_current_received_at and v_inbound_key>=coalesce(v_ticket.latest_inbound_key,''));
      if v_should_advance then
        update sellerpilot_private.support_tickets ticket set
          customer_name=left(coalesce(nullif(trim(v_inquiry->>'customerName'),''),ticket.customer_name),240),
          subject=left(coalesce(nullif(trim(v_inquiry->>'subject'),''),ticket.subject),500),
          message=v_message,status=v_status,received_at=v_received_at,
          resolved_at=case when v_status='resolved'then coalesce(ticket.resolved_at,v_received_at)else null end,
          source_credential_id=p_credential_id,seller_account_key=v_credential.seller_account_key,
          channel_account_id=p_credential_id,latest_inbound_key=v_inbound_key,
          reply_context=case when v_reply_supported then v_reply_context else '{}'::jsonb end,
          provider_context=v_context,provider_status=v_provider_status,
          provider_status_updated_at=now(),ticket_kind='conversation',
          reply_draft=case when v_reply_supported and v_inbound_key is distinct from ticket.latest_inbound_key then null else ticket.reply_draft end,
          reply_delivery_status=case when v_reply_supported and v_inbound_key is distinct from ticket.latest_inbound_key then'never'else ticket.reply_delivery_status end,
          reply_delivery_error=case when v_reply_supported and v_inbound_key is distinct from ticket.latest_inbound_key then null else ticket.reply_delivery_error end,
          reply_gateway_job_id=case when v_reply_supported and v_inbound_key is distinct from ticket.latest_inbound_key then null else ticket.reply_gateway_job_id end,
          reply_operation_attempt_id=case when v_reply_supported and v_inbound_key is distinct from ticket.latest_inbound_key then null else ticket.reply_operation_attempt_id end,
          last_delivery_job_id=case when v_reply_supported and v_inbound_key is distinct from ticket.latest_inbound_key then null else ticket.last_delivery_job_id end,
          updated_at=now()
         where ticket.id=v_ticket.id
         returning * into v_ticket;
      elsif v_ticket.source_credential_id<>p_credential_id then
        update sellerpilot_private.support_tickets ticket set
          source_credential_id=p_credential_id,channel_account_id=p_credential_id,updated_at=now()
         where ticket.id=v_ticket.id returning * into v_ticket;
      end if;
    end if;

    if not v_message_found then
      insert into sellerpilot_private.support_inbound_messages(
        ticket_id,owner_id,channel_key,inbound_key,remote_message_id,
        sender_role,body,provider_context,received_at,updated_at
      )values(
        v_ticket.id,v_credential.created_by,'ebay',v_inbound_key,v_remote_message_id,
        v_sender_role,v_message,v_context,v_received_at,now()
      );
    end if;
    v_count:=v_count+1;
  end loop;

  select count(*)::integer into v_ledger_count
    from sellerpilot_private.support_tickets ticket
   where ticket.owner_id=v_credential.created_by and ticket.channel_key='ebay' and not ticket.demo;
  insert into sellerpilot_private.channel_sync_state(
    owner_id,channel_key,data_type,status,imported_count,
    last_started_at,last_succeeded_at,last_error,updated_at
  )values(
    v_credential.created_by,'ebay','inquiries','passed',v_ledger_count,now(),now(),null,now()
  )on conflict(owner_id,channel_key,data_type)do update set
    status='passed',imported_count=excluded.imported_count,last_succeeded_at=now(),last_error=null,updated_at=now();
  insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,safe_detail)
  values(v_credential.created_by,'channel_inquiries_synced','channel',jsonb_build_object(
    'channel','ebay','surface','commerce_message','response_count',v_count,'ledger_count',v_ledger_count
  ));
  return v_count;
end
$$;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  rename to sellerpilot_08003000_enqueue_reply_before_ebay_conversation;
revoke all on function public.sellerpilot_08003000_enqueue_reply_before_ebay_conversation(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  p_ticket_id uuid,
  p_channel text,
  p_reply_text text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_source_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing record;
  v_legacy record;
  v_credential_id uuid;
  v_environment text;
  v_created_by uuid;
  v_id uuid:=gen_random_uuid();
  v_reply text:=nullif(trim(p_reply_text),'');
  v_payload_reply text;
  v_reply_fingerprint text;
  v_conversation_id text;
  v_conversation_type text;
  v_expected_external_id text;
begin
  if p_channel<>'ebay' or p_request_payload#>>'{arguments,kind}' is distinct from'conversation' then
    return public.sellerpilot_08003000_enqueue_reply_before_ebay_conversation(
      p_ticket_id,p_channel,p_reply_text,p_request_payload
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065043);
  if p_ticket_id is null or v_reply is null or length(v_reply)>4000
     or regexp_replace(v_reply,E'[\t\n\r]','','g')~'[[:cntrl:]]'
     or v_reply~'</?[A-Za-z][^>]*>'
     or v_reply~*'&((amp;)?lt;|#0*60;|#x0*3c;)'
     or p_request_payload is null or jsonb_typeof(p_request_payload)<>'object'
     or jsonb_typeof(p_request_payload->'arguments')<>'object'
     or (select count(*) from jsonb_object_keys(p_request_payload->'arguments'))<>4
     or octet_length(p_request_payload::text)>128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  select ticket.* into v_ticket from sellerpilot_private.support_tickets ticket
   where ticket.id=p_ticket_id and ticket.channel_key='ebay' and not ticket.demo for update;
  if not found then raise exception 'inquiry reply ticket not found';end if;
  if v_ticket.provider_status<>'waiting' or v_ticket.status='resolved' then
    raise exception 'PROVIDER_INQUIRY_NOT_WAITING';
  end if;
  if nullif(p_request_payload->>'sellerpilotExpectedInboundKey','')
       is distinct from v_ticket.latest_inbound_key then
    raise exception 'INQUIRY_CONTEXT_STALE';
  end if;
  if v_ticket.latest_inbound_key is null or not exists(
    select 1 from sellerpilot_private.support_inbound_messages message
     where message.ticket_id=p_ticket_id and message.channel_key='ebay'
       and message.inbound_key=v_ticket.latest_inbound_key
       and message.sender_role='customer'
       and message.provider_context->>'kind'='conversation'
       and message.provider_context->>'conversationId'=v_ticket.reply_context->>'conversationId'
       and message.provider_context->>'conversationType'='FROM_MEMBERS'
       and message.provider_context->>'replySupported'='true'
  )then raise exception 'INQUIRY_LATEST_MESSAGE_UNBOUND';end if;
  if v_ticket.source_credential_id is null or v_ticket.seller_account_key is null then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  select credential.* into v_source_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_ticket.source_credential_id;
  if not found or v_source_credential.channel<>'ebay'
     or v_source_credential.created_by<>v_ticket.owner_id
     or v_source_credential.environment not in('sandbox','production')
     or v_source_credential.seller_account_key_source<>'provider_certified_v1'
     or v_source_credential.seller_account_verified_at is null
     or v_source_credential.seller_account_key is distinct from v_ticket.seller_account_key then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  v_payload_reply:=nullif(trim(p_request_payload#>>'{arguments,reply}'),'');
  v_conversation_id:=coalesce(p_request_payload#>>'{arguments,conversationId}','');
  v_conversation_type:=coalesce(p_request_payload#>>'{arguments,conversationType}','');
  v_expected_external_id:='ebay:conversation:'||encode(extensions.digest(
    'ebay-conversation-v1'||chr(31)||v_conversation_id,'sha256'
  ),'hex');
  if v_payload_reply is distinct from v_reply
     or v_conversation_id='' or length(v_conversation_id)>240
     or v_conversation_id<>trim(v_conversation_id) or v_conversation_id~'[[:cntrl:]]'
     or v_conversation_type<>'FROM_MEMBERS'
     or v_ticket.external_ticket_id is distinct from v_expected_external_id
     or (select count(*) from jsonb_object_keys(v_ticket.reply_context))<>5
     or v_ticket.reply_context->>'kind'<>'conversation'
     or v_ticket.reply_context->>'conversationId'<>v_conversation_id
     or v_ticket.reply_context->>'conversationType'<>'FROM_MEMBERS'
     or v_ticket.reply_context->>'replySupported'<>'true'
     or v_ticket.provider_context->>'kind'<>'conversation'
     or v_ticket.provider_context->>'conversationId'<>v_conversation_id
     or v_ticket.provider_context->>'conversationType'<>'FROM_MEMBERS'
     or v_ticket.provider_context->>'messageId'<>v_ticket.reply_context->>'messageId'
     or v_ticket.provider_context->>'replySupported'<>'true' then
    raise exception 'inquiry reply eBay conversation context mismatch';
  end if;

  if exists(
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.operation='inquiries.reply' and job.channel='ebay'
       and job.request_payload->>'sellerpilotTicketId'=p_ticket_id::text
       and job.status in('queued','running','reconciliation_required')
       and job.request_payload->>'sellerpilotInboundKey' is distinct from v_ticket.latest_inbound_key
  )then raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED';end if;

  select attempt.id,attempt.status,attempt.reply_fingerprint into v_legacy
    from sellerpilot_private.support_reply_attempts attempt
   where attempt.ticket_id=p_ticket_id
     and attempt.status in('preparing','sending','succeeded','reconciliation_required')
   order by case when attempt.status='reconciliation_required'then 0 when attempt.status='sending'then 1
     when attempt.status='preparing'then 2 else 3 end,attempt.created_at desc limit 1;
  if found then
    if v_legacy.status in('sending','reconciliation_required')then raise exception'INQUIRY_REPLY_RECONCILIATION_REQUIRED';end if;
    if v_legacy.status='preparing'then raise exception'INQUIRY_REPLY_LEGACY_IN_PROGRESS';end if;
    raise exception'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  v_reply_fingerprint:=encode(extensions.digest(v_reply,'sha256'),'hex');
  select job.id,job.status,job.request_payload->>'sellerpilotReplyFingerprint' reply_fingerprint
    into v_existing from sellerpilot_private.channel_gateway_jobs job
   where job.operation='inquiries.reply' and job.channel='ebay'
     and job.request_payload->>'sellerpilotTicketId'=p_ticket_id::text
     and(job.status in('queued','running','reconciliation_required')
       or(job.status='succeeded'and job.response_payload@>'{"ok":true}'::jsonb))
   order by case when job.status='reconciliation_required'then 0 when job.status in('queued','running')then 1 else 2 end,
     job.created_at desc,job.id desc limit 1;
  if found then
    if v_existing.reply_fingerprint is distinct from v_reply_fingerprint then raise exception'INQUIRY_REPLY_CONFLICT';end if;
    update sellerpilot_private.support_tickets ticket set
      reply_gateway_job_id=v_existing.id,
      reply_delivery_status=case v_existing.status when'queued'then'preparing'when'running'then'sending'
        when'reconciliation_required'then'reconciliation_required'else'succeeded'end,
      reply_delivery_error=case when v_existing.status='reconciliation_required'
        then'판매채널 답변 접수 여부를 수동 확인해야 합니다.'else null end,
      reply_operation_attempt_id=null,updated_at=now()
     where ticket.id=p_ticket_id;
    return v_existing.id;
  end if;

  select credential.id,credential.environment,credential.created_by
    into v_credential_id,v_environment,v_created_by
    from sellerpilot_private.channel_credentials credential
   where credential.channel='ebay'
     and credential.environment=v_source_credential.environment
     and credential.created_by=v_ticket.owner_id
     and credential.seller_account_key=v_ticket.seller_account_key
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.status='active'
     and(credential.expires_at is null or credential.expires_at>now())
   order by(credential.id=v_ticket.source_credential_id)desc,
     credential.seller_account_verified_at desc,credential.version desc,
     credential.created_at desc,credential.id for update limit 1;
  if not found then raise exception'INQUIRY_REPLY_LINEAGE_UNBOUND';end if;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,
    request_payload,created_by,seller_account_key
  )values(
    v_id,v_credential_id,null,'ebay','inquiries.reply',v_environment,
    jsonb_build_object(
      'arguments',jsonb_build_object('kind','conversation','conversationId',v_conversation_id,
        'conversationType','FROM_MEMBERS','reply',v_reply),
      'sellerpilotTicketId',p_ticket_id,'sellerpilotInboundKey',v_ticket.latest_inbound_key,
      'sellerpilotReplyFingerprint',v_reply_fingerprint
    ),v_created_by,v_ticket.seller_account_key
  );
  update sellerpilot_private.support_tickets ticket set
    reply_delivery_status='preparing',reply_delivery_error=null,
    reply_operation_attempt_id=null,reply_gateway_job_id=v_id,updated_at=now()
   where ticket.id=p_ticket_id and ticket.seller_account_key=v_ticket.seller_account_key;
  if not found then raise exception'inquiry reply ticket ledger mismatch';end if;
  return v_id;
end
$$;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  to service_role;

comment on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb) is
  'Queues exact-bound marketplace replies, including isolated eBay Commerce Message conversationId and Trading ASQ lineages.';

notify pgrst,'reload schema';
commit;
