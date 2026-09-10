-- Proposal only. Do not apply directly to production.
-- Qoo10 S3 list membership is status-only evidence. It must never set the
-- generic remote_observed flag, which means an exact seller body was observed.
begin;

alter table sellerpilot_private.support_reply_deliveries
  add column qoo10_s3_status_observed boolean not null default false,
  add column qoo10_s3_status_observed_at timestamptz,
  add column qoo10_s3_last_checked_at timestamptz,
  add column qoo10_s3_readback_state text,
  add column qoo10_s3_readback_reason text,
  add column qoo10_s3_matching_rows integer,
  add column qoo10_s3_verification_contract text,
  add column qoo10_reply_content_observed boolean not null default false,
  add column qoo10_automatic_resend_allowed boolean not null default false,
  add constraint support_reply_deliveries_qoo10_s3_state_check check (
    qoo10_s3_readback_state is null
    or qoo10_s3_readback_state in ('verified','pending','incomplete')
  ),
  add constraint support_reply_deliveries_qoo10_s3_reason_check check (
    qoo10_s3_readback_reason is null
    or qoo10_s3_readback_reason in (
      'exact_s3_status_observed','exact_s3_not_observed','wrong_sequence_observed',
      'exact_identity_not_completed','provider_rejected',
      'provider_transport_or_contract_failed'
    )
  ),
  add constraint support_reply_deliveries_qoo10_s3_count_check check (
    qoo10_s3_matching_rows is null or qoo10_s3_matching_rows >= 0
  ),
  add constraint support_reply_deliveries_qoo10_s3_consistency_check check (
    case qoo10_s3_readback_state
      when 'verified' then
        qoo10_s3_status_observed is true
        and qoo10_s3_status_observed_at is not null
        and qoo10_s3_last_checked_at is not null
        and qoo10_s3_readback_reason is not distinct from 'exact_s3_status_observed'
        and qoo10_s3_matching_rows is not null
        and qoo10_s3_matching_rows > 0
        and qoo10_s3_verification_contract is not distinct from 'sellerpilot-qoo10-s3-status/1'
      when 'pending' then
        qoo10_s3_status_observed is false
        and qoo10_s3_status_observed_at is null
        and qoo10_s3_last_checked_at is not null
        and qoo10_s3_readback_reason is not distinct from 'exact_s3_not_observed'
        and qoo10_s3_matching_rows is not distinct from 0
        and qoo10_s3_verification_contract is null
      when 'incomplete' then
        qoo10_s3_status_observed is false
        and qoo10_s3_status_observed_at is null
        and qoo10_s3_last_checked_at is not null
        and qoo10_s3_readback_reason is not null
        and qoo10_s3_readback_reason in (
          'wrong_sequence_observed','exact_identity_not_completed','provider_rejected',
          'provider_transport_or_contract_failed'
        )
        and qoo10_s3_matching_rows is not null
        and qoo10_s3_matching_rows >= 0
        and qoo10_s3_verification_contract is null
      else
        qoo10_s3_readback_state is null
        and qoo10_s3_status_observed is false
        and qoo10_s3_status_observed_at is null
        and qoo10_s3_last_checked_at is null
        and qoo10_s3_readback_reason is null
        and qoo10_s3_matching_rows is null
        and qoo10_s3_verification_contract is null
    end
  ),
  add constraint support_reply_deliveries_qoo10_s3_no_content_claim_check check (
    channel_key <> 'qoo10'
    or (not qoo10_reply_content_observed and not qoo10_automatic_resend_allowed)
  );

create function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_delivery_id uuid,
  p_state text,
  p_reason text,
  p_matching_rows integer,
  p_reply_content_observed boolean,
  p_resend_allowed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_reply_request jsonb;
  v_read_request jsonb;
  v_read_response jsonb;
  v_read_status text;
  v_checked_at timestamptz;
  v_provider_data jsonb;
  v_provider_rows jsonb;
  v_provider_result_code text;
  v_target_type text;
  v_target_question text;
  v_target_sequence text;
  v_same_question_rows integer;
  v_exact_rows integer;
  v_exact_completed_rows integer;
  v_derived_state text;
  v_derived_reason text;
  v_derived_matching_rows integer;
  v_effective_state text;
  v_effective_reason text;
  v_effective_matching_rows integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_delivery_id is null
     or p_state is null or p_reason is null
     or p_state not in ('verified','pending','incomplete')
     or p_matching_rows is null or p_matching_rows < 0
     or p_reply_content_observed is distinct from false
     or p_resend_allowed is distinct from false
     or (p_state = 'verified' and (p_reason <> 'exact_s3_status_observed' or p_matching_rows < 1))
     or (p_state = 'pending' and (p_reason <> 'exact_s3_not_observed' or p_matching_rows <> 0))
     or (p_state = 'incomplete' and p_reason not in (
       'wrong_sequence_observed','exact_identity_not_completed','provider_rejected',
       'provider_transport_or_contract_failed'
     )) then
    raise exception 'QOO10_REPLY_S3_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select delivery.* into v_delivery
    from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id = p_delivery_id
     and delivery.channel_key = 'qoo10'
     and delivery.status in ('succeeded','reconciliation_required')
   for update;
  if not found then
    raise exception 'QOO10_REPLY_S3_READBACK_LINEAGE_INVALID' using errcode = '55000';
  end if;

  select reply_job.request_payload, read_job.request_payload,
         read_job.response_payload, read_job.status,
         coalesce(read_job.completed_at, read_job.updated_at, clock_timestamp())
    into v_reply_request, v_read_request, v_read_response, v_read_status, v_checked_at
    from sellerpilot_private.support_tickets ticket
    join sellerpilot_private.channel_gateway_jobs reply_job
      on reply_job.id = v_delivery.gateway_job_id
    join sellerpilot_private.channel_gateway_jobs read_job
      on read_job.id = p_job_id
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id = read_job.id and receipt.claim_token = p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = receipt.worker_token_id and token.token_hash = p_token_hash
    join sellerpilot_private.channel_credentials credential
      on credential.id = read_job.credential_id
   where ticket.id = v_delivery.ticket_id and ticket.owner_id = v_delivery.owner_id
     and reply_job.channel = 'qoo10' and reply_job.operation = 'inquiries.reply'
     and read_job.channel = 'qoo10' and read_job.operation = 'inquiries.list'
     and read_job.status in ('succeeded','failed','reconciliation_required')
     and read_job.credential_id = reply_job.credential_id
     and ticket.source_credential_id = read_job.credential_id
     and reply_job.environment = read_job.environment
     and reply_job.created_by = ticket.owner_id
     and read_job.created_by = ticket.owner_id
     and credential.channel = 'qoo10'
     and credential.environment = read_job.environment
     and credential.created_by = ticket.owner_id
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key is not null
     and credential.seller_account_key = ticket.seller_account_key
     and reply_job.seller_account_key = credential.seller_account_key
     and read_job.seller_account_key = credential.seller_account_key
     and ticket.latest_inbound_key = reply_job.request_payload->>'sellerpilotInboundKey'
     and token.scope in ('gateway','legacy_combined')
     and token.status = 'active' and token.expires_at > clock_timestamp()
   for update of ticket;
  if not found then
    raise exception 'QOO10_REPLY_S3_READBACK_LINEAGE_INVALID' using errcode = '55000';
  end if;

  if v_read_request#>>'{arguments,sellerpilotQoo10ReplyReadback,contractVersion}'
       is distinct from 'sellerpilot-qoo10-reply-readback/1'
     or v_read_request#>>'{arguments,sellerpilotQoo10ReplyReadback,deliveryId}'
       is distinct from p_delivery_id::text
     or v_read_request#>>'{arguments,params,proc_status}' is distinct from 'S3'
     or v_read_request#>>'{arguments,sellerpilotQoo10ReplyReadback,inquiryType}'
       is distinct from v_reply_request#>>'{arguments,params,inq_type}'
     or v_read_request#>>'{arguments,sellerpilotQoo10ReplyReadback,questionNo}'
       is distinct from v_reply_request#>>'{arguments,params,question_no}'
     or v_read_request#>>'{arguments,sellerpilotQoo10ReplyReadback,sequenceNo}'
       is distinct from v_reply_request#>>'{arguments,params,seq_no}' then
    raise exception 'QOO10_REPLY_S3_READBACK_TARGET_INVALID' using errcode = '22023';
  end if;

  v_target_type := v_reply_request#>>'{arguments,params,inq_type}';
  v_target_question := v_reply_request#>>'{arguments,params,question_no}';
  v_target_sequence := v_reply_request#>>'{arguments,params,seq_no}';
  v_provider_data := v_read_response#>'{steps,0,data}';
  v_provider_result_code := v_provider_data->>'ResultCode';

  if v_read_status <> 'succeeded'
     or jsonb_typeof(v_read_response) is distinct from 'object'
     or v_read_response->>'channel' is distinct from 'qoo10'
     or v_read_response->>'operation' is distinct from 'inquiries.list' then
    v_derived_state := 'incomplete';
    v_derived_reason := 'provider_transport_or_contract_failed';
    v_derived_matching_rows := 0;
  elsif jsonb_typeof(v_read_response->'steps') is distinct from 'array' then
    v_derived_state := 'incomplete';
    v_derived_reason := 'provider_transport_or_contract_failed';
    v_derived_matching_rows := 0;
  elsif jsonb_array_length(v_read_response->'steps') <> 1
     or v_read_response#>>'{steps,0,name}' is distinct from 'GetInquiryMessage'
     or jsonb_typeof(v_provider_data) is distinct from 'object' then
    v_derived_state := 'incomplete';
    v_derived_reason := 'provider_transport_or_contract_failed';
    v_derived_matching_rows := 0;
  elsif v_provider_result_code is not null and v_provider_result_code <> '0' then
    v_derived_state := 'incomplete';
    v_derived_reason := 'provider_rejected';
    v_derived_matching_rows := 0;
  elsif v_read_response->>'ok' is distinct from 'true'
     or v_read_response#>>'{steps,0,ok}' is distinct from 'true'
     or v_provider_result_code is distinct from '0' then
    v_derived_state := 'incomplete';
    v_derived_reason := 'provider_transport_or_contract_failed';
    v_derived_matching_rows := 0;
  else
    v_provider_rows := case
      when jsonb_typeof(v_provider_data->'ResultObject') = 'array'
        then v_provider_data->'ResultObject'
      when jsonb_typeof(v_provider_data#>'{ResultObject,InquiryInfo}') = 'array'
        then v_provider_data#>'{ResultObject,InquiryInfo}'
      when jsonb_typeof(v_provider_data#>'{ResultObject,InquiryMessage}') = 'array'
        then v_provider_data#>'{ResultObject,InquiryMessage}'
      else null
    end;
    if jsonb_typeof(v_provider_rows) is distinct from 'array' then
      v_derived_state := 'incomplete';
      v_derived_reason := 'provider_transport_or_contract_failed';
      v_derived_matching_rows := 0;
    elsif exists (
         select 1 from jsonb_array_elements(v_provider_rows) row_value
          where jsonb_typeof(row_value) is distinct from 'object'
       ) then
      v_derived_state := 'incomplete';
      v_derived_reason := 'provider_transport_or_contract_failed';
      v_derived_matching_rows := 0;
    else
      select
        count(*) filter (
          where upper(trim(coalesce(row_value->>'INQ_TYPE', row_value->>'inq_type', ''))) = v_target_type
            and trim(coalesce(row_value->>'QUESTION_NO', row_value->>'question_no', '')) = v_target_question
        ),
        count(*) filter (
          where upper(trim(coalesce(row_value->>'INQ_TYPE', row_value->>'inq_type', ''))) = v_target_type
            and trim(coalesce(row_value->>'QUESTION_NO', row_value->>'question_no', '')) = v_target_question
            and trim(coalesce(row_value->>'SEQ_NO', row_value->>'seq_no', '')) = v_target_sequence
        ),
        count(*) filter (
          where upper(trim(coalesce(row_value->>'INQ_TYPE', row_value->>'inq_type', ''))) = v_target_type
            and trim(coalesce(row_value->>'QUESTION_NO', row_value->>'question_no', '')) = v_target_question
            and trim(coalesce(row_value->>'SEQ_NO', row_value->>'seq_no', '')) = v_target_sequence
            and upper(trim(coalesce(
              row_value->>'STATUS', row_value->>'Status', row_value->>'AnswerYN', ''
            ))) ~ '^(S3|ANSWER(ED)?|COMPLETE(D)?)$'
        )
        into v_same_question_rows, v_exact_rows, v_exact_completed_rows
        from jsonb_array_elements(v_provider_rows) row_value;
      if v_exact_rows > 0 and v_exact_completed_rows = v_exact_rows then
        v_derived_state := 'verified';
        v_derived_reason := 'exact_s3_status_observed';
        v_derived_matching_rows := v_exact_rows;
      elsif v_exact_rows > 0 then
        v_derived_state := 'incomplete';
        v_derived_reason := 'exact_identity_not_completed';
        v_derived_matching_rows := v_exact_rows;
      elsif v_same_question_rows > 0 then
        v_derived_state := 'incomplete';
        v_derived_reason := 'wrong_sequence_observed';
        v_derived_matching_rows := 0;
      else
        v_derived_state := 'pending';
        v_derived_reason := 'exact_s3_not_observed';
        v_derived_matching_rows := 0;
      end if;
    end if;
  end if;

  if p_state is distinct from v_derived_state
     or p_reason is distinct from v_derived_reason
     or p_matching_rows is distinct from v_derived_matching_rows then
    raise exception 'QOO10_REPLY_S3_READBACK_EVIDENCE_MISMATCH' using errcode = '22023';
  end if;

  v_effective_state := case
    when v_delivery.qoo10_s3_status_observed then 'verified'
    else p_state
  end;
  v_effective_reason := case
    when v_delivery.qoo10_s3_status_observed then 'exact_s3_status_observed'
    else p_reason
  end;
  v_effective_matching_rows := case
    when v_delivery.qoo10_s3_status_observed
      then greatest(coalesce(v_delivery.qoo10_s3_matching_rows, 0), p_matching_rows)
    else p_matching_rows
  end;

  update sellerpilot_private.support_reply_deliveries delivery set
    qoo10_s3_status_observed = delivery.qoo10_s3_status_observed or p_state = 'verified',
    qoo10_s3_status_observed_at = case
      when delivery.qoo10_s3_status_observed_at is not null then delivery.qoo10_s3_status_observed_at
      when p_state = 'verified' then v_checked_at
      else null
    end,
    qoo10_s3_last_checked_at = greatest(delivery.qoo10_s3_last_checked_at, v_checked_at),
    qoo10_s3_readback_state = v_effective_state,
    qoo10_s3_readback_reason = v_effective_reason,
    qoo10_s3_matching_rows = v_effective_matching_rows,
    qoo10_s3_verification_contract = case
      when delivery.qoo10_s3_status_observed or p_state = 'verified'
        then 'sellerpilot-qoo10-s3-status/1'
      else null
    end,
    qoo10_reply_content_observed = false,
    qoo10_automatic_resend_allowed = false,
    updated_at = greatest(delivery.updated_at, v_checked_at)
   where delivery.id = p_delivery_id;

  select delivery.* into v_delivery
    from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id = p_delivery_id;
  return jsonb_build_object(
    'contract','sellerpilot-qoo10-s3-readback-result/1',
    'deliveryId',v_delivery.id,
    'state',v_delivery.qoo10_s3_readback_state,
    'reason',v_delivery.qoo10_s3_readback_reason,
    'statusObserved',v_delivery.qoo10_s3_status_observed,
    'replyContentObserved',v_delivery.qoo10_reply_content_observed,
    'automaticResendAllowed',v_delivery.qoo10_automatic_resend_allowed,
    'genericVerificationStatus',v_delivery.verification_status
  );
end
$$;

revoke all on function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) to service_role;

commit;
