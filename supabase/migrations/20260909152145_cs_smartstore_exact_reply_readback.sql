-- A SmartStore provider ACK is only transport acceptance. Queue one bounded,
-- read-only provider list request and resolve the ticket only after the common
-- observation ledger sees the exact account, target, generation and body.
begin;

alter table sellerpilot_private.support_reply_deliveries
  add column smartstore_readback_state text
    check(smartstore_readback_state in('pending','verified','unverified','failed')),
  add column smartstore_readback_reason text,
  add column smartstore_readback_checked_at timestamptz,
  add column smartstore_automatic_resend_allowed boolean not null default false;

alter table sellerpilot_private.support_reply_deliveries
  add constraint support_reply_deliveries_smartstore_no_automatic_resend check(
    channel_key<>'smartstore' or smartstore_automatic_resend_allowed=false
  );

create table sellerpilot_private.smartstore_reply_readback_links_v1(
  source_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  delivery_id uuid not null unique
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  ticket_id uuid not null
    references sellerpilot_private.support_tickets(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check(seller_account_key~'^[a-f0-9]{64}$'),
  provider_ticket_kind text not null
    check(provider_ticket_kind in('product','customer')),
  provider_ticket_id text not null check(provider_ticket_id~'^[1-9][0-9]{0,18}$'),
  expected_inbound_key text not null check(expected_inbound_key~'^smartstore:[a-f0-9]{64}$'),
  expected_reply_fingerprint text not null check(expected_reply_fingerprint~'^[a-f0-9]{64}$'),
  accepted_after timestamptz not null,
  state text not null default 'pending'
    check(state in('pending','verified','unverified','failed')),
  reason text,
  observed_message_id uuid
    references sellerpilot_private.support_inbound_messages(id) on delete set null,
  checked_at timestamptz,
  automatic_resend_allowed boolean not null default false
    check(automatic_resend_allowed=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.smartstore_reply_readback_links_v1 enable row level security;
revoke all on sellerpilot_private.smartstore_reply_readback_links_v1
  from public,anon,authenticated,service_role;

create function sellerpilot_private.prepare_smartstore_reply_readback_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.channel_key='smartstore' and new.status='succeeded'
     and new.smartstore_readback_state is null then
    new.smartstore_readback_state:='pending';
    new.smartstore_readback_reason:='provider_accepted_exact_readback_pending';
    new.smartstore_automatic_resend_allowed:=false;
  end if;
  return new;
end
$$;
revoke all on function sellerpilot_private.prepare_smartstore_reply_readback_v1()
  from public,anon,authenticated,service_role;
create trigger prepare_smartstore_reply_readback_v1
before insert or update of status,verification_status
on sellerpilot_private.support_reply_deliveries
for each row execute function sellerpilot_private.prepare_smartstore_reply_readback_v1();

create function sellerpilot_private.enqueue_smartstore_reply_readback_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_identity sellerpilot_private.smartstore_cs_ticket_identities_v1%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_readback_job_id uuid:=gen_random_uuid();
  v_kind text;
  v_provider_ticket_id text;
  v_reply text;
  v_reply_fingerprint text;
  v_query jsonb;
  v_from timestamptz;
  v_to timestamptz;
begin
  if new.channel_key<>'smartstore' or new.status<>'succeeded'
     or new.verification_status<>'provider_accepted' then
    return new;
  end if;
  if exists(select 1 from sellerpilot_private.smartstore_reply_readback_links_v1
    where source_job_id=new.gateway_job_id) then
    return new;
  end if;

  select job.* into v_source
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=new.gateway_job_id
   for update;
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id=new.ticket_id
     and ticket.owner_id=new.owner_id
     and ticket.channel_key='smartstore'
     and not ticket.demo
   for update;
  select identity.* into v_identity
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
   where identity.ticket_id=new.ticket_id
   for share;
  if v_source.id is null or v_ticket.id is null or v_identity.ticket_id is null
     or v_source.channel<>'smartstore' or v_source.operation<>'inquiries.reply'
     or v_source.status<>'succeeded'
     or v_source.provider_mutation_started_at is null
     or v_source.request_payload->>'sellerpilotTicketId' is distinct from v_ticket.id::text
     or v_source.request_payload->>'sellerpilotInboundKey' is distinct from v_ticket.latest_inbound_key then
    raise exception 'SMARTSTORE_REPLY_READBACK_SOURCE_INVALID' using errcode='23514';
  end if;

  v_kind:=coalesce(nullif(v_source.request_payload#>>'{arguments,kind}',''),'product');
  v_provider_ticket_id:=case v_kind
    when 'product' then v_source.request_payload#>>'{arguments,questionId}'
    when 'customer' then v_source.request_payload#>>'{arguments,inquiryNo}'
    else null end;
  v_reply:=nullif(trim(v_source.request_payload#>>'{arguments,reply}'),'');
  v_reply_fingerprint:=case when v_reply is null then null else
    encode(extensions.digest(v_reply,'sha256'),'hex') end;
  if v_kind is distinct from v_identity.provider_ticket_kind
     or v_provider_ticket_id is distinct from v_identity.provider_ticket_id
     or v_source.request_payload->>'sellerpilotReplyFingerprint'
          is distinct from new.reply_fingerprint
     or v_reply_fingerprint is distinct from new.reply_fingerprint
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,contract}'
          is distinct from 'sellerpilot-reply-acceptance/1'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,level}'
          is distinct from 'provider_accepted'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,channel}'
          is distinct from 'smartstore'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,kind}'
          is distinct from v_kind
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,bindingDigest}'
          is distinct from encode(extensions.digest(
            case v_kind
              when 'product' then '{"questionId":"'||v_provider_ticket_id||'"}'
              else '{"inquiryNo":"'||v_provider_ticket_id||'"}' end,
            'sha256'
          ),'hex') then
    raise exception 'SMARTSTORE_REPLY_READBACK_TARGET_INVALID' using errcode='23514';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_source.credential_id
     and credential.created_by=v_ticket.owner_id
     and credential.channel='smartstore'
     and credential.environment=v_source.environment
     and credential.status in('active','grace')
     and credential.seller_account_key=v_ticket.seller_account_key
     and credential.seller_account_key=v_identity.seller_account_key
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>statement_timestamp())
   for share;
  if v_credential.id is null
     or v_source.created_by is distinct from v_ticket.owner_id
     or v_source.credential_id is distinct from v_ticket.source_credential_id
     or v_source.credential_id is distinct from v_identity.source_credential_id
     or v_source.seller_account_key is distinct from v_ticket.seller_account_key
     or v_source.seller_account_key is distinct from v_identity.seller_account_key then
    raise exception 'SMARTSTORE_REPLY_READBACK_ACCOUNT_INVALID' using errcode='23514';
  end if;

  v_from:=v_ticket.received_at-interval '5 minutes';
  v_to:=v_ticket.received_at+interval '5 minutes';
  v_query:=case v_kind when 'product' then jsonb_build_object(
    'fromDate',to_char(v_from at time zone 'Asia/Seoul','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+09:00',
    'toDate',to_char(v_to at time zone 'Asia/Seoul','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+09:00',
    'answered',true,'page',1,'size',100
  ) else jsonb_build_object(
    'startSearchDate',to_char(v_ticket.received_at at time zone 'Asia/Seoul','YYYY-MM-DD'),
    'endSearchDate',to_char(v_ticket.received_at at time zone 'Asia/Seoul','YYYY-MM-DD'),
    'answered',true,'page',1,'size',200
  ) end;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,
    request_payload,created_by,seller_account_key
  ) values(
    v_readback_job_id,v_source.credential_id,null,'smartstore','inquiries.list',
    v_source.environment,
    jsonb_build_object(
      'periodicKey','inquiries:reply-readback:smartstore:'||new.id::text,
      'arguments',jsonb_build_object(
        'kind',v_kind,
        case when v_kind='product' then 'questionId' else 'inquiryNo' end,
        v_provider_ticket_id,
        'query',v_query
      ),
      'sellerpilotSmartstoreReplyReadback',jsonb_build_object(
        'contract','sellerpilot-smartstore-reply-readback/1',
        'sourceJobId',v_source.id,'deliveryId',new.id,'ticketId',v_ticket.id,
        'kind',v_kind,'providerTicketId',v_provider_ticket_id,
        'expectedInboundKey',v_ticket.latest_inbound_key,
        'expectedReplyFingerprint',new.reply_fingerprint
      )
    ),
    v_source.created_by,v_source.seller_account_key
  );
  insert into sellerpilot_private.smartstore_reply_readback_links_v1(
    source_job_id,delivery_id,readback_job_id,ticket_id,owner_id,
    credential_id,seller_account_key,provider_ticket_kind,provider_ticket_id,
    expected_inbound_key,expected_reply_fingerprint,accepted_after
  ) values(
    v_source.id,new.id,v_readback_job_id,v_ticket.id,v_ticket.owner_id,
    v_source.credential_id,v_source.seller_account_key,v_kind,
    v_provider_ticket_id,v_ticket.latest_inbound_key,new.reply_fingerprint,
    v_source.provider_mutation_started_at
  );
  update sellerpilot_private.support_tickets ticket set
    status='in_progress',provider_status='waiting',
    provider_status_updated_at=clock_timestamp(),resolved_at=null,
    reply_delivery_status='sending',
    reply_delivery_error='판매채널 접수 후 동일 답변의 원격 재조회를 확인 중입니다.',
    updated_at=clock_timestamp()
   where ticket.id=v_ticket.id
     and ticket.latest_inbound_key=v_ticket.latest_inbound_key;
  return new;
end
$$;
revoke all on function sellerpilot_private.enqueue_smartstore_reply_readback_v1()
  from public,anon,authenticated,service_role;
create trigger enqueue_smartstore_reply_readback_v1
after insert or update of status,verification_status
on sellerpilot_private.support_reply_deliveries
for each row execute function sellerpilot_private.enqueue_smartstore_reply_readback_v1();

create function public.sellerpilot_service_record_smartstore_reply_readback_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_link sellerpilot_private.smartstore_reply_readback_links_v1%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_readback sellerpilot_private.channel_gateway_jobs%rowtype;
  v_target_count integer:=0;
  v_exact_count integer:=0;
  v_exact_message_id uuid;
  v_state text;
  v_reason text;
  v_checked_at timestamptz;
begin
  if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null then
    raise exception 'SMARTSTORE_REPLY_READBACK_ARGUMENT_INVALID' using errcode='22023';
  end if;
  select link.* into v_link
    from sellerpilot_private.smartstore_reply_readback_links_v1 link
   where link.readback_job_id=p_job_id
   for update;
  if not found then
    raise exception 'SMARTSTORE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000';
  end if;
  select delivery.* into v_delivery
    from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id=v_link.delivery_id
   for update;
  select readback.* into v_readback
    from sellerpilot_private.channel_gateway_jobs readback
   where readback.id=v_link.readback_job_id;
  if v_delivery.id is null or v_readback.id is null or not exists(
    select 1
      from sellerpilot_private.channel_gateway_jobs source
      join sellerpilot_private.support_tickets ticket
        on ticket.id=v_link.ticket_id
      join sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
        on identity.ticket_id=ticket.id
      join sellerpilot_private.channel_credentials credential
        on credential.id=v_link.credential_id
      join sellerpilot_private.gateway_completion_receipts receipt
        on receipt.job_id=v_readback.id and receipt.claim_token=p_claim_token
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id=receipt.worker_token_id and token.token_hash=p_token_hash
     where source.id=v_link.source_job_id
       and v_readback.channel='smartstore' and v_readback.operation='inquiries.list'
       and v_readback.status in('succeeded','failed','reconciliation_required')
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,contract}'
            ='sellerpilot-smartstore-reply-readback/1'
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,sourceJobId}'
            =source.id::text
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,deliveryId}'
            =v_delivery.id::text
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,ticketId}'
            =ticket.id::text
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,expectedInboundKey}'
            =v_link.expected_inbound_key
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,expectedReplyFingerprint}'
            =v_link.expected_reply_fingerprint
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,kind}'
            =v_link.provider_ticket_kind
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,providerTicketId}'
            =v_link.provider_ticket_id
       and source.channel='smartstore' and source.operation='inquiries.reply'
       and source.status='succeeded' and source.provider_mutation_started_at=v_link.accepted_after
       and source.request_payload->>'sellerpilotInboundKey'=v_link.expected_inbound_key
       and source.request_payload->>'sellerpilotReplyFingerprint'=v_link.expected_reply_fingerprint
       and source.credential_id=v_link.credential_id and v_readback.credential_id=v_link.credential_id
       and source.created_by=v_link.owner_id and v_readback.created_by=v_link.owner_id
       and source.seller_account_key=v_link.seller_account_key
       and v_readback.seller_account_key=v_link.seller_account_key
       and ticket.owner_id=v_link.owner_id and ticket.source_credential_id=v_link.credential_id
       and ticket.seller_account_key=v_link.seller_account_key
       and identity.owner_id=v_link.owner_id
       and identity.source_credential_id=v_link.credential_id
       and identity.seller_account_key=v_link.seller_account_key
       and identity.provider_ticket_kind=v_link.provider_ticket_kind
       and identity.provider_ticket_id=v_link.provider_ticket_id
       and credential.created_by=v_link.owner_id and credential.channel='smartstore'
       and credential.seller_account_key=v_link.seller_account_key
       and token.scope in('gateway','legacy_combined','serverless_cs')
       and token.status='active' and token.expires_at>statement_timestamp()
  ) then
    raise exception 'SMARTSTORE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000';
  end if;
  v_checked_at:=coalesce(v_readback.completed_at,v_readback.updated_at,clock_timestamp());

  select count(*),count(*) filter(where
      encode(extensions.digest(regexp_replace(message.body,
        '^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')
        =v_link.expected_reply_fingerprint),
    (min(message.id::text) filter(where
      encode(extensions.digest(regexp_replace(message.body,
        '^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')
        =v_link.expected_reply_fingerprint))::uuid
    into v_target_count,v_exact_count,v_exact_message_id
    from sellerpilot_private.support_inbound_messages message
   where message.ticket_id=v_link.ticket_id
     and message.owner_id=v_link.owner_id
     and message.channel_key='smartstore'
     and message.sender_role='seller'
     and message.provider_context->>'replyObservationContract'
          ='sellerpilot-reply-observation/1'
     and message.provider_context#>>'{binding,kind}'=v_link.provider_ticket_kind
     and coalesce(message.provider_context#>>'{binding,questionId}',
       message.provider_context#>>'{binding,inquiryNo}')=v_link.provider_ticket_id
     and message.received_at>=v_link.accepted_after-interval '5 minutes';

  if v_readback.status<>'succeeded' then
    v_state:='failed';v_reason:='provider_read_failed';
  elsif v_exact_count=1
      and v_delivery.verification_status='remote_observed'
      and v_delivery.observed_message_id=v_exact_message_id then
    v_state:='verified';v_reason:='exact_reply_observed';
  elsif v_exact_count>1 then
    v_state:='unverified';v_reason:='ambiguous_exact_reply_observations';
  elsif v_target_count>0 then
    v_state:='unverified';v_reason:='reply_body_mismatch';
  else
    v_state:='unverified';v_reason:='exact_reply_not_observed';
  end if;

  update sellerpilot_private.smartstore_reply_readback_links_v1 link set
    state=v_state,reason=v_reason,observed_message_id=case
      when v_state='verified' then v_exact_message_id else null end,
    checked_at=v_checked_at,automatic_resend_allowed=false,
    updated_at=clock_timestamp()
   where link.readback_job_id=p_job_id;
  update sellerpilot_private.support_reply_deliveries delivery set
    smartstore_readback_state=v_state,smartstore_readback_reason=v_reason,
    smartstore_readback_checked_at=v_checked_at,
    smartstore_automatic_resend_allowed=false,
    verification_status=case when v_state='verified' then 'remote_observed'
      else 'reconciliation_required' end,
    verification_contract='sellerpilot-smartstore-reply-readback/1',
    reconciliation_reason=case when v_state='verified' then null else v_reason end,
    updated_at=clock_timestamp()
   where delivery.id=v_link.delivery_id;
  if v_state<>'verified' then
    update sellerpilot_private.support_tickets ticket set
      status='in_progress',provider_status='waiting',
      provider_status_updated_at=clock_timestamp(),resolved_at=null,
      reply_delivery_status='reconciliation_required',
      reply_delivery_error='판매채널 답변의 동일 본문을 재조회로 확인하지 못했습니다. 재전송 없이 확인이 필요합니다.',
      updated_at=clock_timestamp()
     where ticket.id=v_link.ticket_id
       and ticket.latest_inbound_key=v_link.expected_inbound_key;
  end if;
  return jsonb_build_object(
    'contract','sellerpilot-smartstore-reply-readback-result/1',
    'deliveryId',v_link.delivery_id,'state',v_state,'reason',v_reason,
    'targetObservations',v_target_count,'exactObservations',v_exact_count,
    'automaticResendAllowed',false
  );
end
$$;
revoke all on function public.sellerpilot_service_record_smartstore_reply_readback_v1(
  text,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_smartstore_reply_readback_v1(
  text,uuid,uuid
) to service_role;

create function public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1(
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer:=0;v_now timestamptz:=clock_timestamp();
begin
  if p_limit not between 1 and 500 then
    raise exception 'SMARTSTORE_STALE_REPLY_LIMIT_INVALID' using errcode='22023';
  end if;
  with stale as(
    select delivery.id,link.ticket_id,link.expected_inbound_key
      from sellerpilot_private.support_reply_deliveries delivery
      join sellerpilot_private.smartstore_reply_readback_links_v1 link
        on link.delivery_id=delivery.id
     where delivery.channel_key='smartstore'
       and delivery.verification_status='provider_accepted'
       and delivery.provider_accepted_at<=statement_timestamp()-interval '15 minutes'
       and link.state='pending'
     order by delivery.provider_accepted_at,delivery.id
     for update of delivery,link skip locked limit p_limit
  ),updated as(
    update sellerpilot_private.support_reply_deliveries delivery set
      verification_status='reconciliation_required',
      verification_contract='sellerpilot-smartstore-reply-readback/1',
      reconciliation_reason='stale_provider_accepted',
      smartstore_readback_state='unverified',
      smartstore_readback_reason='stale_provider_accepted',
      smartstore_readback_checked_at=v_now,
      smartstore_automatic_resend_allowed=false,updated_at=v_now
     from stale where delivery.id=stale.id returning stale.*
  ),links as(
    update sellerpilot_private.smartstore_reply_readback_links_v1 link set
      state='unverified',reason='stale_provider_accepted',checked_at=v_now,
      automatic_resend_allowed=false,updated_at=v_now
     from updated where link.delivery_id=updated.id returning updated.*
  ),tickets as(
    update sellerpilot_private.support_tickets ticket set
      status='in_progress',provider_status='waiting',
      provider_status_updated_at=v_now,resolved_at=null,
      reply_delivery_status='reconciliation_required',
      reply_delivery_error='판매채널 접수 후 15분 동안 동일 답변이 확인되지 않았습니다. 재전송 없이 확인이 필요합니다.',
      updated_at=v_now
     from links where ticket.id=links.ticket_id
       and ticket.latest_inbound_key=links.expected_inbound_key returning ticket.id
  ) select count(*) into v_count from links;
  return jsonb_build_object(
    'contract','sellerpilot-smartstore-stale-reply-escalation/1',
    'escalated',v_count,'automaticResendAllowed',false
  );
end
$$;
revoke all on function public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1(integer)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1(integer)
  to service_role;

create or replace function public.sellerpilot_get_inquiry_reply_delivery(
  p_ticket_id uuid,p_job_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else(
    select jsonb_build_object(
      'jobId',d.gateway_job_id,'ticketId',d.ticket_id,'channel',d.channel_key,
      'inboundKey',job.request_payload->>'sellerpilotInboundKey','status',d.status,
      'verificationStatus',d.verification_status,'verificationContract',d.verification_contract,
      'safeMessage',d.safe_message,'reconciliationReason',d.reconciliation_reason,
      'providerRequestId',d.provider_request_id,'providerMessageId',d.provider_message_id,
      'providerAcceptedAt',d.provider_accepted_at,'remoteObservedAt',d.remote_observed_at,
      'smartstoreReadbackState',d.smartstore_readback_state,
      'smartstoreReadbackReason',d.smartstore_readback_reason,
      'smartstoreReadbackCheckedAt',d.smartstore_readback_checked_at,
      'automaticResendAllowed',case when d.channel_key='smartstore' then false else null end,
      'verificationAttention',case
        when d.channel_key='smartstore' and d.verification_status='provider_accepted'
         and d.provider_accepted_at<=statement_timestamp()-interval '15 minutes'
          then 'stale_provider_accepted'
        when d.channel_key='smartstore' and d.verification_status='provider_accepted'
          then 'exact_readback_pending'
        when d.channel_key='smartstore' and d.verification_status='reconciliation_required'
          then 'manual_verification_required'
        else null end,
      'queuedAt',d.queued_at,'startedAt',d.started_at,'completedAt',d.completed_at,'updatedAt',d.updated_at)
      from sellerpilot_private.support_reply_deliveries d
      join sellerpilot_private.channel_gateway_jobs job on job.id=d.gateway_job_id
      join sellerpilot_private.support_tickets ticket on ticket.id=d.ticket_id
     where d.ticket_id=p_ticket_id and((p_job_id is not null and d.gateway_job_id=p_job_id)
       or(p_job_id is null and d.gateway_job_id=ticket.last_delivery_job_id))
       and not ticket.demo
     order by d.queued_at desc,d.id desc limit 1
  ) end
$$;
revoke all on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  to authenticated;

notify pgrst,'reload schema';
commit;
