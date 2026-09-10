begin;

do $$
declare
  v_ingest regprocedure := to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)');
  v_reply regprocedure := to_regprocedure('public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)');
  v_allowed regprocedure := to_regprocedure('sellerpilot_private.serverless_gateway_job_allowed(text,text)');
  v_history regprocedure := to_regprocedure('public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)');
  v_enqueue_history regprocedure := to_regprocedure('sellerpilot_private.enqueue_inquiry_history_backfill_item(uuid,text,text,jsonb)');
begin
  if v_ingest is null or not exists (
    select 1 from pg_proc p where p.oid=v_ingest
      and position('QOO10_CLAIM_CONTEXT_INVALID' in p.prosrc)>0
      and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig=array['search_path=""']::text[]
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
  ) then raise exception 'ELEVENST_QNA_INGEST_PREIMAGE_REVIEW_REQUIRED'; end if;
  if v_reply is null or not exists (
    select 1 from pg_proc p where p.oid=v_reply
      and position('inquiry reply eBay conversation context mismatch' in p.prosrc)>0
      and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig=array['search_path=""']::text[]
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
  ) then raise exception 'ELEVENST_QNA_REPLY_PREIMAGE_REVIEW_REQUIRED'; end if;
  if v_allowed is null or not exists (
    select 1 from pg_proc p where p.oid=v_allowed
      and position($needle$when 'inquiries.list' then$needle$ in p.prosrc)>0
      and position($needle$'elevenst'$needle$ in p.prosrc)>0
  ) then raise exception 'ELEVENST_QNA_GATEWAY_PREIMAGE_REVIEW_REQUIRED'; end if;
  if v_history is null or not exists (
    select 1 from pg_proc p where p.oid=v_history
      and position('COUPANG_AFTER_SALES_HISTORY_ENQUEUE_COUNT_MISMATCH' in p.prosrc)>0
      and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig=array['search_path=""']::text[]
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE')
  ) then raise exception 'ELEVENST_QNA_HISTORY_PREIMAGE_REVIEW_REQUIRED'; end if;
  if v_enqueue_history is null or not exists (
    select 1 from pg_proc p where p.oid=v_enqueue_history
      and position($needle$p_channel not in ('coupang', 'smartstore')$needle$ in p.prosrc)>0
      and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig=array['search_path=""']::text[]
  ) then raise exception 'ELEVENST_QNA_HISTORY_ENQUEUE_PREIMAGE_REVIEW_REQUIRED'; end if;
  if not exists (
    select 1 from pg_constraint constraint_row
     where constraint_row.conname='inquiry_history_selected_channels_check'
       and constraint_row.conrelid='sellerpilot_private.inquiry_history_backfill_runs'::regclass
       and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%coupang%smartstore%'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid) not like '%elevenst%'
  ) then raise exception 'ELEVENST_QNA_HISTORY_CONSTRAINT_PREIMAGE_REVIEW_REQUIRED'; end if;
  if to_regprocedure('public.sellerpilot_08049000_ingest_before_elevenst_qna(uuid,text,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_08049000_enqueue_reply_before_elevenst_qna(uuid,text,text,jsonb)') is not null
     or to_regprocedure('sellerpilot_private.serverless_gateway_job_allowed_before_elevenst_qna(text,text)') is not null
     or to_regprocedure('sellerpilot_private.enqueue_inquiry_history_backfill_item_before_elevenst_qna(uuid,text,text,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_start_inquiry_history_backfill_v4(text[],integer,date)') is not null then
    raise exception 'ELEVENST_QNA_MIGRATION_ALREADY_APPLIED';
  end if;
end $$;

alter function sellerpilot_private.serverless_gateway_job_allowed(text,text)
  rename to serverless_gateway_job_allowed_before_elevenst_qna;

create function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
immutable
parallel safe
set search_path=''
as $$
  select case
    when p_channel='elevenst' and p_operation in ('inquiries.list','inquiries.reply') then true
    else sellerpilot_private.serverless_gateway_job_allowed_before_elevenst_qna(
      p_channel,p_operation
    )
  end
$$;

revoke all on function sellerpilot_private.serverless_gateway_job_allowed_before_elevenst_qna(text,text)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.serverless_gateway_job_allowed(text,text)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_08049000_ingest_before_elevenst_qna;

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
  v_credential record;
  v_inquiry jsonb;
  v_context jsonb;
  v_reply_context jsonb;
  v_external_id text;
  v_brd_info_no text;
  v_prd_no text;
  v_remote_message_id text;
  v_expected_inbound_key text;
  v_answer_revision text;
  v_sender_role text;
  v_qna_type text;
  v_answer_yn text;
  v_order_no text;
begin
  if p_channel<>'elevenst' then
    return public.sellerpilot_08049000_ingest_before_elevenst_qna(
      p_credential_id,p_channel,p_inquiries
    );
  end if;
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries)>500
     or octet_length(p_inquiries::text)>1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select credential.created_by,credential.seller_account_key,
         credential.seller_account_key_source,credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='elevenst'
     and credential.status in ('active','grace');
  if not found then raise exception 'active channel credential required'; end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source not in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     or v_credential.seller_account_verified_at is null then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) item(value) loop
    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or jsonb_typeof(v_inquiry->'providerContext') is distinct from 'object'
       or jsonb_typeof(v_inquiry->'replyContext') is distinct from 'object' then
      raise exception 'ELEVENST_PRODUCT_QNA_CONTEXT_INVALID';
    end if;
    v_context:=v_inquiry->'providerContext';
    v_reply_context:=v_inquiry->'replyContext';
    v_external_id:=coalesce(v_inquiry->>'externalTicketId','');
    v_brd_info_no:=coalesce(v_context->>'brdInfoNo','');
    v_prd_no:=coalesce(v_context->>'prdNo','');
    v_remote_message_id:=coalesce(v_inquiry->>'remoteMessageId','');
    v_answer_revision:=coalesce(v_context->>'answerRevision','');
    v_sender_role:=coalesce(v_inquiry->>'senderRole','');
    v_qna_type:=coalesce(v_context->>'qnaTypeCode','');
    v_answer_yn:=coalesce(v_context->>'answerYn','');
    v_order_no:=coalesce(v_context->>'orderNo','');
    v_expected_inbound_key:='elevenst:'||encode(extensions.digest(
      'v2'||chr(31)||'elevenst'||chr(31)||v_external_id||chr(31)||v_remote_message_id,
      'sha256'
    ),'hex');

    if v_brd_info_no!~'^[1-9][0-9]{0,19}$'
       or v_prd_no!~'^[1-9][0-9]{0,19}$'
       or v_external_id is distinct from 'elevenst:'||v_brd_info_no
       or v_qna_type not in ('01','02','03','04','05')
       or v_answer_yn not in ('Y','N')
       or coalesce(v_context->>'buyYn','') not in ('','Y','N')
       or coalesce(v_context->>'dispYn','') not in ('','Y','N')
       or (v_order_no<>'' and v_order_no!~'^[1-9][0-9]{0,19}$')
       or coalesce(v_inquiry->>'externalOrderReference','') is distinct from v_order_no
       or v_inquiry->>'ticketKind' is distinct from 'conversation'
       or v_sender_role not in ('customer','seller')
       or v_inquiry->>'status' is distinct from
          (case when v_answer_yn='Y' then 'resolved' else 'waiting' end)
       or v_inquiry->>'providerStatus' is distinct from
          (case when v_answer_yn='Y' then 'answered' else 'waiting' end)
       or v_inquiry->'priority' is distinct from
          to_jsonb(case when v_qna_type in ('02','03','04') then 2 else 3 end)
       or coalesce(v_inquiry->>'inboundKey','') is distinct from v_expected_inbound_key
       or (select count(*) from jsonb_object_keys(v_reply_context))<>2
       or v_reply_context->>'brdInfoNo' is distinct from v_brd_info_no
       or v_reply_context->>'prdNo' is distinct from v_prd_no
       or octet_length(v_context::text)>64000
       or exists (
         select 1 from jsonb_object_keys(v_context) key
          where key<>all(array[
            'kind','brdInfoNo','prdNo','qnaTypeCode','qnaType','buyYn','dispYn',
            'answerYn','answerDate','orderNo','orderPaymentDate',
            'unsequencedAnswers','answerRevision'
          ])
       )
       or v_context->>'kind' is distinct from 'product_qna'
       or jsonb_typeof(v_context->'unsequencedAnswers') is distinct from 'array'
       or jsonb_array_length(v_context->'unsequencedAnswers')>1
       or exists (
         select 1 from jsonb_array_elements(v_context->'unsequencedAnswers') answer
          where jsonb_typeof(answer) is distinct from 'object'
             or answer->>'reason' is distinct from 'provider_timestamp_unavailable'
             or nullif(answer->>'body','') is null
             or length(answer->>'body')>4000
             or (select count(*) from jsonb_object_keys(answer))<>2
       )
       or exists (
         select 1 from jsonb_each(v_context) item
          where item.key not in ('unsequencedAnswers')
            and jsonb_typeof(item.value) is distinct from 'string'
       ) then
      raise exception 'ELEVENST_PRODUCT_QNA_CONTEXT_INVALID';
    end if;

    if v_sender_role='customer' then
      if v_remote_message_id is distinct from 'qna:'||v_brd_info_no||':question'
         or v_answer_revision<>'' then
        raise exception 'ELEVENST_PRODUCT_QNA_MESSAGE_IDENTITY_INVALID';
      end if;
    elsif v_answer_yn<>'Y'
       or v_answer_revision!~'^[a-f0-9]{64}$'
       or v_remote_message_id is distinct from
          'qna:'||v_brd_info_no||':answer:'||v_answer_revision then
      raise exception 'ELEVENST_PRODUCT_QNA_MESSAGE_IDENTITY_INVALID';
    end if;
  end loop;

  return public.sellerpilot_08049000_ingest_before_elevenst_qna(
    p_credential_id,p_channel,p_inquiries
  );
end;
$$;

revoke all on function public.sellerpilot_08049000_ingest_before_elevenst_qna(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  rename to sellerpilot_08049000_enqueue_reply_before_elevenst_qna;

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
  v_brd_info_no text;
  v_prd_no text;
begin
  if p_channel<>'elevenst' then
    return public.sellerpilot_08049000_enqueue_reply_before_elevenst_qna(
      p_ticket_id,p_channel,p_reply_text,p_request_payload
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065044);
  if p_ticket_id is null or v_reply is null or length(v_reply)>4000
     or regexp_replace(v_reply,E'[\t\n\r]','','g')~'[[:cntrl:]]'
     or p_request_payload is null or jsonb_typeof(p_request_payload)<>'object'
     or (select count(*) from jsonb_object_keys(p_request_payload))<>2
     or jsonb_typeof(p_request_payload->'arguments')<>'object'
     or (select count(*) from jsonb_object_keys(p_request_payload->'arguments'))<>3
     or octet_length(p_request_payload::text)>128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  select ticket.* into v_ticket from sellerpilot_private.support_tickets ticket
   where ticket.id=p_ticket_id and ticket.channel_key='elevenst' and not ticket.demo
   for update;
  if not found then raise exception 'inquiry reply ticket not found'; end if;
  if v_ticket.provider_status<>'waiting' or v_ticket.status='resolved' then
    raise exception 'PROVIDER_INQUIRY_NOT_WAITING';
  end if;
  if nullif(p_request_payload->>'sellerpilotExpectedInboundKey','')
       is distinct from v_ticket.latest_inbound_key then
    raise exception 'INQUIRY_CONTEXT_STALE';
  end if;
  v_brd_info_no:=coalesce(p_request_payload#>>'{arguments,brdInfoNo}','');
  v_prd_no:=coalesce(p_request_payload#>>'{arguments,prdNo}','');
  v_payload_reply:=nullif(trim(p_request_payload#>>'{arguments,reply}'),'');
  if v_payload_reply is distinct from v_reply
     or v_brd_info_no!~'^[1-9][0-9]{0,19}$'
     or v_prd_no!~'^[1-9][0-9]{0,19}$'
     or v_ticket.external_ticket_id is distinct from 'elevenst:'||v_brd_info_no
     or jsonb_typeof(v_ticket.reply_context) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_ticket.reply_context))<>2
     or v_ticket.reply_context->>'brdInfoNo' is distinct from v_brd_info_no
     or v_ticket.reply_context->>'prdNo' is distinct from v_prd_no
     or v_ticket.provider_context->>'kind' is distinct from 'product_qna'
     or v_ticket.provider_context->>'brdInfoNo' is distinct from v_brd_info_no
     or v_ticket.provider_context->>'prdNo' is distinct from v_prd_no then
    raise exception 'inquiry reply 11st Product Q&A context mismatch';
  end if;
  if v_ticket.latest_inbound_key is null or not exists(
    select 1 from sellerpilot_private.support_inbound_messages message
     where message.ticket_id=p_ticket_id and message.channel_key='elevenst'
       and message.inbound_key=v_ticket.latest_inbound_key
       and message.sender_role='customer'
       and message.remote_message_id='qna:'||v_brd_info_no||':question'
       and message.provider_context->>'kind'='product_qna'
       and message.provider_context->>'brdInfoNo'=v_brd_info_no
       and message.provider_context->>'prdNo'=v_prd_no
  ) then raise exception 'INQUIRY_LATEST_MESSAGE_UNBOUND'; end if;
  if v_ticket.source_credential_id is null or v_ticket.seller_account_key is null then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;
  select credential.* into v_source_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_ticket.source_credential_id;
  if not found or v_source_credential.channel<>'elevenst'
     or v_source_credential.created_by<>v_ticket.owner_id
     or v_source_credential.environment not in('sandbox','production')
     or v_source_credential.seller_account_key_source not in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     or v_source_credential.seller_account_verified_at is null
     or v_source_credential.seller_account_key is distinct from v_ticket.seller_account_key then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;
  if not exists(
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel='elevenst' and policy.enabled
  ) then raise exception 'STATIC_EGRESS_REQUIRED' using errcode='55000'; end if;

  if exists(
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.operation='inquiries.reply' and job.channel='elevenst'
       and job.request_payload->>'sellerpilotTicketId'=p_ticket_id::text
       and job.status in('queued','running','reconciliation_required')
       and job.request_payload->>'sellerpilotInboundKey' is distinct from v_ticket.latest_inbound_key
  ) then raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED'; end if;
  select attempt.id,attempt.status,attempt.reply_fingerprint into v_legacy
    from sellerpilot_private.support_reply_attempts attempt
   where attempt.ticket_id=p_ticket_id
     and attempt.status in('preparing','sending','succeeded','reconciliation_required')
   order by case when attempt.status='reconciliation_required' then 0
     when attempt.status='sending' then 1 when attempt.status='preparing' then 2 else 3 end,
     attempt.created_at desc limit 1;
  if found then
    if v_legacy.status in('sending','reconciliation_required') then
      raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED';
    end if;
    if v_legacy.status='preparing' then raise exception 'INQUIRY_REPLY_LEGACY_IN_PROGRESS'; end if;
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  v_reply_fingerprint:=encode(extensions.digest(v_reply,'sha256'),'hex');
  select job.id,job.status,job.request_payload->>'sellerpilotReplyFingerprint' reply_fingerprint
    into v_existing from sellerpilot_private.channel_gateway_jobs job
   where job.operation='inquiries.reply' and job.channel='elevenst'
     and job.request_payload->>'sellerpilotTicketId'=p_ticket_id::text
     and (job.status in('queued','running','reconciliation_required')
       or (job.status='succeeded' and job.response_payload@>'{"ok":true}'::jsonb))
   order by case when job.status='reconciliation_required' then 0
     when job.status in('queued','running') then 1 else 2 end,
     job.created_at desc,job.id desc limit 1;
  if found then
    if v_existing.reply_fingerprint is distinct from v_reply_fingerprint then
      raise exception 'INQUIRY_REPLY_CONFLICT';
    end if;
    update sellerpilot_private.support_tickets ticket set
      reply_gateway_job_id=v_existing.id,
      reply_delivery_status=case v_existing.status when 'queued' then 'preparing'
        when 'running' then 'sending' when 'reconciliation_required' then 'reconciliation_required'
        else 'succeeded' end,
      reply_delivery_error=case when v_existing.status='reconciliation_required'
        then '판매채널 답변 접수 여부를 수동 확인해야 합니다.' else null end,
      reply_operation_attempt_id=null,updated_at=now()
     where ticket.id=p_ticket_id;
    return v_existing.id;
  end if;

  select credential.id,credential.environment,credential.created_by
    into v_credential_id,v_environment,v_created_by
    from sellerpilot_private.channel_credentials credential
   where credential.channel='elevenst'
     and credential.environment=v_source_credential.environment
     and credential.created_by=v_ticket.owner_id
     and credential.seller_account_key=v_ticket.seller_account_key
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>now())
   order by (credential.id=v_ticket.source_credential_id) desc,
     credential.seller_account_verified_at desc,credential.version desc,
     credential.created_at desc,credential.id for update limit 1;
  if not found then raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND'; end if;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,
    request_payload,created_by,seller_account_key
  ) values (
    v_id,v_credential_id,null,'elevenst','inquiries.reply',v_environment,
    jsonb_build_object(
      'arguments',jsonb_build_object(
        'brdInfoNo',v_brd_info_no,'prdNo',v_prd_no,'reply',v_reply
      ),
      'sellerpilotTicketId',p_ticket_id,
      'sellerpilotInboundKey',v_ticket.latest_inbound_key,
      'sellerpilotReplyFingerprint',v_reply_fingerprint
    ),v_created_by,v_ticket.seller_account_key
  );
  update sellerpilot_private.support_tickets ticket set
    reply_delivery_status='preparing',reply_delivery_error=null,
    reply_operation_attempt_id=null,reply_gateway_job_id=v_id,updated_at=now()
   where ticket.id=p_ticket_id and ticket.seller_account_key=v_ticket.seller_account_key;
  if not found then raise exception 'inquiry reply ticket ledger mismatch'; end if;
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_08049000_enqueue_reply_before_elevenst_qna(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  to service_role;

alter function sellerpilot_private.enqueue_inquiry_history_backfill_item(uuid,text,text,jsonb)
  rename to enqueue_inquiry_history_backfill_item_before_elevenst_qna;

create function sellerpilot_private.enqueue_inquiry_history_backfill_item(
  p_run_id uuid,
  p_channel text,
  p_item_key text,
  p_arguments jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_job_id uuid;
  v_start date;
  v_end date;
begin
  if p_channel<>'elevenst' then
    return sellerpilot_private.enqueue_inquiry_history_backfill_item_before_elevenst_qna(
      p_run_id,p_channel,p_item_key,p_arguments
    );
  end if;
  if p_item_key!~'^product_qna:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_arguments))<>3
     or coalesce(p_arguments->>'startDate','')!~'^[0-9]{8}$'
     or coalesce(p_arguments->>'endDate','')!~'^[0-9]{8}$'
     or p_arguments->>'answerStatus' is distinct from '00'
     or not exists(
       select 1 from sellerpilot_private.inquiry_history_backfill_runs run
        where run.id=p_run_id and run.channels=array['elevenst']::text[]
     ) then raise exception 'invalid 11st inquiry history backfill item'; end if;
  begin
    v_start:=to_date(p_arguments->>'startDate','YYYYMMDD');
    v_end:=to_date(p_arguments->>'endDate','YYYYMMDD');
  exception when others then
    raise exception 'invalid 11st inquiry history backfill item';
  end;
  if to_char(v_start,'YYYYMMDD')<>p_arguments->>'startDate'
     or to_char(v_end,'YYYYMMDD')<>p_arguments->>'endDate'
     or v_end<v_start or v_end-v_start>6 then
    raise exception 'invalid 11st inquiry history backfill item';
  end if;
  v_result:=public.sellerpilot_service_enqueue_periodic_sync(
    'elevenst','inquiries.list',jsonb_build_object(
      'periodicKey',format('inquiries:history:%s:elevenst:%s',p_run_id,p_item_key),
      'arguments',p_arguments||jsonb_build_object(
        'sellerpilotHistoryRunId',p_run_id::text,
        'sellerpilotHistoryItemKey',p_item_key
      )
    ),60
  );
  if v_result->>'status' is distinct from 'queued'
     or coalesce(v_result->>'jobId','')
       !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'inquiry history backfill enqueue refused for 11st:%',p_item_key;
  end if;
  v_job_id:=(v_result->>'jobId')::uuid;
  return v_job_id;
end;
$$;

revoke all on function sellerpilot_private.enqueue_inquiry_history_backfill_item_before_elevenst_qna(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.enqueue_inquiry_history_backfill_item(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;

alter table sellerpilot_private.inquiry_history_backfill_runs
  drop constraint inquiry_history_selected_channels_check,
  add constraint inquiry_history_selected_channels_check check (
    channels=array['coupang']::text[] or channels=array['smartstore']::text[]
    or channels=array['coupang','smartstore']::text[]
    or channels=array['elevenst']::text[]
  );

create function public.sellerpilot_start_inquiry_history_backfill_v4(
  p_channels text[],
  p_history_days integer default 30,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_range_end date;
  v_range_start date;
  v_credential record;
  v_request_key text;
  v_run_id uuid;
  v_existing_run_id uuid;
  v_existing_status text;
  v_retried_jobs integer:=0;
  v_slice_start date;
  v_slice_end date;
  v_expected integer;
  v_result jsonb;
begin
  if not ('elevenst'=any(coalesce(p_channels,array[]::text[]))) then
    return public.sellerpilot_start_inquiry_history_backfill_v3(
      p_channels,p_history_days,p_end_date
    );
  end if;
  if v_actor is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_history_days is null or p_history_days not between 7 and 30 then
    raise exception 'history range must be between 7 and 30 days';
  end if;
  if cardinality(p_channels)<>1 or p_channels[1]<>'elevenst' then
    raise exception '11st inquiry history must be requested independently' using errcode='22023';
  end if;
  if not exists(
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel='elevenst' and policy.enabled
  ) then raise exception 'STATIC_EGRESS_REQUIRED' using errcode='55000'; end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.channel='elevenst' and credential.environment='production'
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
   order by credential.version desc,credential.created_at desc,credential.id
   for update limit 1;
  if not found then raise exception 'selected marketplace credential must be active' using errcode='55000'; end if;

  v_range_end:=coalesce(p_end_date,(v_now at time zone 'Asia/Seoul')::date);
  if v_range_end>(v_now at time zone 'Asia/Seoul')::date or v_range_end<date '2000-01-30' then
    raise exception 'invalid inquiry history end date' using errcode='22023';
  end if;
  v_range_start:=v_range_end-(p_history_days-1);
  v_expected:=ceil(p_history_days/7.0)::integer;
  v_request_key:=encode(extensions.digest(concat_ws('|',
    'channel-inquiry-history-elevenst-v1',v_credential.created_by::text,
    v_range_start::text,v_range_end::text,p_history_days::text,
    v_credential.id::text,v_credential.seller_account_key
  ),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:inquiry-history:'||v_request_key)
  );
  select run.id,run.status into v_existing_run_id,v_existing_status
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.request_key=v_request_key for update;
  if v_existing_run_id is not null then
    if v_existing_status='blocked' then
      update sellerpilot_private.inquiry_history_backfill_runs set
        status='failed',blocked_reason=null,updated_at=clock_timestamp()
       where id=v_existing_run_id;
      v_existing_status:='failed';
    end if;
    if v_existing_status='failed' then
      update sellerpilot_private.channel_gateway_jobs job set
        status='queued',worker_token_id=null,claim_token=null,lease_expires_at=null,
        completed_at=null,error_message=null,updated_at=clock_timestamp()
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run_id::text
         and job.credential_id=v_credential.id and job.channel='elevenst'
         and job.operation='inquiries.list' and job.status='failed'
         and job.attempt_count<4 and not job.credential_refresh_in_flight
         and job.credential_refresh_recovery_vault_id is null;
      get diagnostics v_retried_jobs=row_count;
    end if;
    return sellerpilot_private.refresh_inquiry_history_backfill_run(v_existing_run_id)
      ||jsonb_build_object('reused',true,'retriedJobs',v_retried_jobs);
  end if;

  insert into sellerpilot_private.inquiry_history_backfill_runs(
    request_key,owner_id,initiated_by,history_days,range_start,range_end,
    expected_initial_jobs,channels,credential_ids
  ) values (
    v_request_key,v_credential.created_by,v_actor,p_history_days,v_range_start,v_range_end,
    v_expected,array['elevenst']::text[],jsonb_build_object('elevenst',v_credential.id::text)
  ) returning id into v_run_id;
  v_slice_start:=v_range_start;
  while v_slice_start<=v_range_end loop
    v_slice_end:=least(v_slice_start+6,v_range_end);
    perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
      v_run_id,'elevenst',format('product_qna:%s:%s',v_slice_start,v_slice_end),
      jsonb_build_object(
        'startDate',to_char(v_slice_start,'YYYYMMDD'),
        'endDate',to_char(v_slice_end,'YYYYMMDD'),
        'answerStatus','00'
      )
    );
    v_slice_start:=v_slice_start+7;
  end loop;
  if exists(
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text
       and (job.channel<>'elevenst' or job.credential_id<>v_credential.id
         or job.operation<>'inquiries.list')
  ) then raise exception '11st inquiry history credential changed during enqueue'; end if;
  v_result:=sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
  if coalesce((v_result->>'totalJobs')::integer,0)<>v_expected then
    raise exception 'ELEVENST_QNA_HISTORY_ENQUEUE_COUNT_MISMATCH';
  end if;
  return v_result||jsonb_build_object('reused',false,'retriedJobs',0);
end;
$$;

revoke all on function public.sellerpilot_start_inquiry_history_backfill_v4(text[],integer,date)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_inquiry_history_backfill_v4(text[],integer,date)
  to authenticated;

do $elevenst_remote_reply_resolution_fence$
declare
  v_definition text;
  v_old constant text := $old$v_ticket.channel_key in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay')$old$;
  v_new constant text := $new$v_ticket.channel_key in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay')$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_update_ticket(uuid,text,text,text)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition)>0 and position(v_old in v_definition)=0 then null;
  elsif position(v_old in v_definition)>0 and position(v_new in v_definition)=0 then
    execute replace(v_definition,v_old,v_new);
  else raise exception '11st remote reply resolution fence preimage drifted'; end if;
end;
$elevenst_remote_reply_resolution_fence$;

comment on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) is
  'Ingests exact CS identities, including sanitized 11st Product Q&A events bound to one verified credential lineage, board number and product number.';
comment on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb) is
  'Queues exact-bound marketplace replies, including 11st Product Q&A bound to credential, latest inbound generation, board number and product number.';
comment on function public.sellerpilot_start_inquiry_history_backfill_v4(text[],integer,date) is
  'Queues one channel history run; 11st Product Q&A is split into official seven-calendar-day windows and prior Korean channel behavior delegates to v3.';

notify pgrst,'reload schema';
commit;
