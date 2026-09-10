-- Proposal only. Do not apply directly to production.
-- Apply after qoo10-007 and qoo10-008. This migration does not backfill old
-- reply receipts. Only a newly inserted, exact provider-acceptance receipt can
-- enqueue the delivery-bound read-only S3 child in the same transaction.
begin;

create table sellerpilot_private.qoo10_reply_s3_readback_enqueues (
  delivery_id uuid primary key
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  reply_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  reply_claim_token uuid not null,
  inquiry_type text not null check (inquiry_type in ('MSG','HELP','ITEM')),
  question_no text not null check (question_no ~ '^[0-9]{1,40}$'),
  sequence_no text not null check (sequence_no ~ '^[0-9]{1,40}$'),
  search_start_dt text not null check (search_start_dt ~ '^[0-9]{14}$'),
  search_end_dt text not null check (search_end_dt ~ '^[0-9]{14}$'),
  enqueued_at timestamptz not null default clock_timestamp(),
  check (search_end_dt >= search_start_dt),
  foreign key (reply_job_id, reply_claim_token)
    references sellerpilot_private.gateway_completion_receipts(job_id, claim_token)
    on delete restrict
);

alter table sellerpilot_private.qoo10_reply_s3_readback_enqueues enable row level security;
revoke all on sellerpilot_private.qoo10_reply_s3_readback_enqueues
  from public, anon, authenticated, service_role;

create unique index qoo10_reply_s3_readback_periodic_key_idx
  on sellerpilot_private.channel_gateway_jobs ((request_payload->>'periodicKey'))
  where channel = 'qoo10'
    and operation = 'inquiries.list'
    and request_payload#>>'{arguments,sellerpilotQoo10ReplyReadback,contractVersion}'
      = 'sellerpilot-qoo10-reply-readback/1';

create function sellerpilot_private.qoo10_reply_acceptance_binding_sha256(
  p_inquiry_type text,
  p_question_no text,
  p_sequence_no text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(extensions.digest(
    '{"inquiryType":' || to_json(p_inquiry_type)::text
      || ',"questionNo":' || to_json(p_question_no)::text
      || ',"sequenceNo":' || to_json(p_sequence_no)::text || '}',
    'sha256'
  ), 'hex')
$$;

revoke all on function sellerpilot_private.qoo10_reply_acceptance_binding_sha256(
  text,text,text
) from public, anon, authenticated, service_role;

create function sellerpilot_private.enqueue_qoo10_reply_s3_after_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_received_at timestamptz;
  v_inquiry_type text;
  v_question_no text;
  v_sequence_no text;
  v_expected_binding_sha256 text;
  v_marker jsonb;
  v_search_start_dt text;
  v_search_end_dt text;
  v_child_id uuid := gen_random_uuid();
  v_request jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.job_id
   for share;
  if not found then
    raise exception 'QOO10_REPLY_S3_PARENT_JOB_MISSING' using errcode = '55000';
  end if;

  if v_job.channel <> 'qoo10' or v_job.operation <> 'inquiries.reply' then
    return new;
  end if;
  -- Failed or uncertain replies remain terminal without a readback child. A
  -- child is mandatory only when the common completion stores a success ACK.
  if v_job.status <> 'succeeded' then return new; end if;
  if v_job.completed_at is null
     or v_job.response_payload is null
     or v_job.response_payload->>'channel' is distinct from 'qoo10'
     or v_job.response_payload->>'operation' is distinct from 'inquiries.reply'
     or v_job.response_payload->>'ok' is distinct from 'true'
     or jsonb_typeof(v_job.response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(v_job.response_payload->'steps') <> 1
     or v_job.response_payload#>>'{steps,0,name}' is distinct from 'SetInquiryMessage'
     or v_job.response_payload#>>'{steps,0,ok}' is distinct from 'true'
     or v_job.response_payload#>>'{steps,0,data,ResultCode}' is distinct from '0' then
    raise exception 'QOO10_REPLY_S3_PROVIDER_ACCEPTANCE_INVALID' using errcode = '55000';
  end if;

  v_inquiry_type := upper(trim(coalesce(
    v_job.request_payload#>>'{arguments,params,inq_type}', ''
  )));
  v_question_no := trim(coalesce(
    v_job.request_payload#>>'{arguments,params,question_no}', ''
  ));
  v_sequence_no := trim(coalesce(
    v_job.request_payload#>>'{arguments,params,seq_no}', ''
  ));
  if v_inquiry_type not in ('MSG','HELP','ITEM')
     or v_question_no !~ '^[0-9]{1,40}$'
     or v_sequence_no !~ '^[0-9]{1,40}$'
     or nullif(trim(v_job.request_payload#>>'{arguments,params,contents}'), '') is null then
    raise exception 'QOO10_REPLY_S3_PARENT_TARGET_INVALID' using errcode = '55000';
  end if;

  v_marker := v_job.response_payload#>'{steps,0,data,sellerpilotReplyAcceptance}';
  v_expected_binding_sha256 :=
    sellerpilot_private.qoo10_reply_acceptance_binding_sha256(
      v_inquiry_type, v_question_no, v_sequence_no
    );
  if jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contract' is distinct from 'sellerpilot-reply-acceptance/1'
     or v_marker->>'level' is distinct from 'provider_accepted'
     or v_marker->>'channel' is distinct from 'qoo10'
     or v_marker->>'kind' is distinct from 'inquiry'
     or v_marker->>'bindingDigest' is distinct from v_expected_binding_sha256 then
    raise exception 'QOO10_REPLY_S3_PROVIDER_ACCEPTANCE_BINDING_INVALID' using errcode = '55000';
  end if;

  select delivery.* into v_delivery
    from sellerpilot_private.support_reply_deliveries delivery
   where delivery.gateway_job_id = v_job.id
     and delivery.channel_key = 'qoo10'
     and delivery.status = 'succeeded'
     and delivery.verification_status = 'provider_accepted'
     and delivery.verification_contract = 'sellerpilot-reply-acceptance/1'
   for update;
  if not found then
    raise exception 'QOO10_REPLY_S3_DELIVERY_NOT_ACCEPTED' using errcode = '55000';
  end if;

  select inbound.received_at
    into v_received_at
    from sellerpilot_private.support_tickets ticket
    join sellerpilot_private.support_inbound_messages inbound
      on inbound.ticket_id = ticket.id
     and inbound.owner_id = ticket.owner_id
     and inbound.channel_key = ticket.channel_key
     and inbound.inbound_key = ticket.latest_inbound_key
     and inbound.sender_role = 'customer'
   where ticket.id = v_delivery.ticket_id
     and ticket.owner_id = v_delivery.owner_id
     and ticket.channel_key = 'qoo10'
     and ticket.ticket_kind = 'conversation'
     and ticket.source_credential_id = v_job.credential_id
     and ticket.seller_account_key = v_job.seller_account_key
     and ticket.latest_inbound_key = v_job.request_payload->>'sellerpilotInboundKey'
     and not ticket.demo
   for update of ticket;
  if not found then
    raise exception 'QOO10_REPLY_S3_INBOUND_LINEAGE_INVALID' using errcode = '55000';
  end if;

  perform 1
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.channel = 'qoo10'
     and credential.environment = v_job.environment
     and credential.created_by = v_job.created_by
     and credential.seller_account_key = v_job.seller_account_key
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
   for share;
  if not found then
    raise exception 'QOO10_REPLY_S3_CREDENTIAL_LINEAGE_INVALID' using errcode = '55000';
  end if;

  v_search_start_dt := to_char(
    date_trunc('day', v_received_at at time zone 'Asia/Tokyo'),
    'YYYYMMDDHH24MISS'
  );
  v_search_end_dt := to_char(
    date_trunc('day', v_received_at at time zone 'Asia/Tokyo')
      + interval '1 day' - interval '1 second',
    'YYYYMMDDHH24MISS'
  );
  v_request := jsonb_build_object(
    'periodicKey', 'inquiries:reply-readback:qoo10:' || v_delivery.id::text,
    'arguments', jsonb_build_object(
      'params', jsonb_build_object(
        'search_start_dt', v_search_start_dt,
        'search_end_dt', v_search_end_dt,
        'proc_status', 'S3'
      ),
      'sellerpilotQoo10ReplyReadback', jsonb_build_object(
        'contractVersion', 'sellerpilot-qoo10-reply-readback/1',
        'deliveryId', v_delivery.id,
        'inquiryType', v_inquiry_type,
        'questionNo', v_question_no,
        'sequenceNo', v_sequence_no
      )
    )
  );

  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,channel,operation,environment,request_payload,
    status,seller_account_key,created_by,created_at,updated_at
  ) values (
    v_child_id,v_job.credential_id,null,'qoo10','inquiries.list',v_job.environment,
    v_request,'queued',v_job.seller_account_key,v_job.created_by,
    clock_timestamp(),clock_timestamp()
  );

  insert into sellerpilot_private.qoo10_reply_s3_readback_enqueues (
    delivery_id,reply_job_id,readback_job_id,reply_claim_token,
    inquiry_type,question_no,sequence_no,search_start_dt,search_end_dt
  ) values (
    v_delivery.id,v_job.id,v_child_id,new.claim_token,
    v_inquiry_type,v_question_no,v_sequence_no,v_search_start_dt,v_search_end_dt
  );
  return new;
end
$$;

revoke all on function sellerpilot_private.enqueue_qoo10_reply_s3_after_acceptance()
  from public, anon, authenticated, service_role;

create trigger enqueue_qoo10_reply_s3_after_acceptance
after insert on sellerpilot_private.gateway_completion_receipts
for each row execute function sellerpilot_private.enqueue_qoo10_reply_s3_after_acceptance();

create function sellerpilot_private.guard_qoo10_reply_s3_readback_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'QOO10_REPLY_S3_READBACK_ENQUEUE_IMMUTABLE' using errcode = '55000';
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_readback_enqueue()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_readback_enqueue
before update or delete on sellerpilot_private.qoo10_reply_s3_readback_enqueues
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_readback_enqueue();

-- The remote completion route receives no request payload. Expose only the
-- validated Qoo10 readback marker, never reply text or provider rows.
alter function public.sellerpilot_service_gateway_completion_context(
  text,uuid,uuid
) rename to sellerpilot_140423_gateway_completion_context_pre_qoo10_s3;

revoke all on function public.sellerpilot_140423_gateway_completion_context_pre_qoo10_s3(
  text,uuid,uuid
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_marker jsonb;
begin
  v_context := public.sellerpilot_140423_gateway_completion_context_pre_qoo10_s3(
    p_token_hash,p_job_id,p_claim_token
  );
  if v_context is null
     or v_context->>'channel' <> 'qoo10'
     or v_context->>'operation' <> 'inquiries.list' then
    return v_context;
  end if;

  select job.request_payload#>'{arguments,sellerpilotQoo10ReplyReadback}'
    into v_marker
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.channel = 'qoo10'
     and job.operation = 'inquiries.list';
  if not found or v_marker is null then return v_context; end if;
  return v_context || jsonb_build_object('qoo10ReplyReadback',v_marker);
end
$$;

revoke all on function public.sellerpilot_service_gateway_completion_context(
  text,uuid,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_gateway_completion_context(
  text,uuid,uuid
) to service_role;

-- Make the 007 fields real in both direct delivery reads and workspace reads.
create or replace function public.sellerpilot_get_inquiry_reply_delivery(
  p_ticket_id uuid,p_job_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else (
    select jsonb_build_object(
      'jobId',d.gateway_job_id,'ticketId',d.ticket_id,'channel',d.channel_key,
      'inboundKey',job.request_payload->>'sellerpilotInboundKey','status',d.status,
      'verificationStatus',d.verification_status,'verificationContract',d.verification_contract,
      'qoo10S3StatusObserved',d.qoo10_s3_status_observed,
      'qoo10S3StatusObservedAt',d.qoo10_s3_status_observed_at,
      'qoo10S3LastCheckedAt',d.qoo10_s3_last_checked_at,
      'qoo10S3ReadbackState',d.qoo10_s3_readback_state,
      'qoo10S3ReadbackReason',d.qoo10_s3_readback_reason,
      'qoo10S3MatchingRows',d.qoo10_s3_matching_rows,
      'qoo10S3VerificationContract',d.qoo10_s3_verification_contract,
      'qoo10ReplyContentObserved',d.qoo10_reply_content_observed,
      'qoo10AutomaticResendAllowed',d.qoo10_automatic_resend_allowed,
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
grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  to authenticated;

do $extend_qoo10_s3_workspace_reads$
declare
  v_definition text;
  v_rewritten text;
begin
  if to_regprocedure('public.sellerpilot_get_cs_workspace_snapshot()') is null then
    raise exception 'QOO10_REPLY_S3_WORKSPACE_RPC_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure
  ) into v_definition;
  if v_definition like '%qoo10S3StatusObserved%' then return; end if;

  v_rewritten := replace(v_definition,
    $old$'verificationContract', d.verification_contract,$old$,
    $new$'verificationContract', d.verification_contract,
      'qoo10S3StatusObserved', d.qoo10_s3_status_observed,
      'qoo10S3StatusObservedAt', d.qoo10_s3_status_observed_at,
      'qoo10S3LastCheckedAt', d.qoo10_s3_last_checked_at,
      'qoo10S3ReadbackState', d.qoo10_s3_readback_state,
      'qoo10S3ReadbackReason', d.qoo10_s3_readback_reason,
      'qoo10S3MatchingRows', d.qoo10_s3_matching_rows,
      'qoo10S3VerificationContract', d.qoo10_s3_verification_contract,
      'qoo10ReplyContentObserved', d.qoo10_reply_content_observed,
      'qoo10AutomaticResendAllowed', d.qoo10_automatic_resend_allowed,$new$);
  v_rewritten := replace(v_rewritten,
    $old$'verificationContract', blocking.verification_contract,$old$,
    $new$'verificationContract', blocking.verification_contract,
      'qoo10S3StatusObserved', blocking.qoo10_s3_status_observed,
      'qoo10S3StatusObservedAt', blocking.qoo10_s3_status_observed_at,
      'qoo10S3LastCheckedAt', blocking.qoo10_s3_last_checked_at,
      'qoo10S3ReadbackState', blocking.qoo10_s3_readback_state,
      'qoo10S3ReadbackReason', blocking.qoo10_s3_readback_reason,
      'qoo10S3MatchingRows', blocking.qoo10_s3_matching_rows,
      'qoo10S3VerificationContract', blocking.qoo10_s3_verification_contract,
      'qoo10ReplyContentObserved', blocking.qoo10_reply_content_observed,
      'qoo10AutomaticResendAllowed', blocking.qoo10_automatic_resend_allowed,$new$);
  if v_rewritten = v_definition
     or v_rewritten not like '%qoo10S3StatusObserved%'
     or v_rewritten not like '%qoo10AutomaticResendAllowed%' then
    raise exception 'QOO10_REPLY_S3_WORKSPACE_CONTRACT_MISMATCH';
  end if;
  execute v_rewritten;
end
$extend_qoo10_s3_workspace_reads$;

commit;
