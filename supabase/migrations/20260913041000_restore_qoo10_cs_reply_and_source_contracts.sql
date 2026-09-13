-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_get_inquiry_reply_delivery' and pg_get_function_identity_arguments(p.oid)='p_ticket_id uuid, p_job_id uuid') is distinct from 'ccebb0e7b5f754b8c69c16bf2f473bfa' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_get_inquiry_reply_delivery';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_qoo10_inquiry_source_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_qoo10_inquiry_source_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_qoo10_review_chat_accounts_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_qoo10_review_chat_accounts_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_qoo10_review_chat_observation_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_qoo10_review_chat_observation_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_apply_qoo10_reply_s3_requery_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_apply_qoo10_reply_s3_requery_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_complete_gateway_transaction' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text, p_response_payload jsonb, p_error_message text, p_credential_refresh jsonb, p_normalized_orders jsonb, p_normalized_inquiries jsonb, p_diagnostic jsonb') is distinct from 'beaa6d2c3c3d3ca414c6211861237955' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_complete_gateway_transaction';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_complete_serverless_cs_transaction' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text, p_response_payload jsonb, p_error_message text, p_credential_refresh jsonb, p_normalized_orders jsonb, p_normalized_inquiries jsonb, p_diagnostic jsonb') is distinct from 'a6dabfd85e676c33d3cf0a41324017db' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_complete_serverless_cs_transaction';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_gateway_completion_context' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from '53498b91491fee6170d592b8105cc430' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_gateway_completion_context';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_qoo10_reply_s3_requery_context_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_qoo10_reply_s3_requery_context_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_qoo10_reply_s3_readback_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_qoo10_reply_s3_readback_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_qoo10_review_chat_observation_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_qoo10_review_chat_observation_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='enqueue_qoo10_reply_s3_after_acceptance') then raise exception 'RECOVERY_ALREADY_DEFINED:enqueue_qoo10_reply_s3_after_acceptance';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_qoo10_reply_s3_readback_enqueue') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_qoo10_reply_s3_readback_enqueue';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_qoo10_reply_s3_requery_ledger') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_qoo10_reply_s3_requery_ledger';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_qoo10_reply_s3_seal_immutable') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_qoo10_reply_s3_seal_immutable';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_qoo10_reply_s3_seal_source') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_qoo10_reply_s3_seal_source';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_qoo10_reply_s3_sealed_job') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_qoo10_reply_s3_sealed_job';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='qoo10_reply_acceptance_binding_sha256') then raise exception 'RECOVERY_ALREADY_DEFINED:qoo10_reply_acceptance_binding_sha256';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='qoo10_reply_s3_json_sha256') then raise exception 'RECOVERY_ALREADY_DEFINED:qoo10_reply_s3_json_sha256';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='qoo10_reply_s3_requery_context_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:qoo10_reply_s3_requery_context_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='reject_qoo10_review_chat_observation_change') then raise exception 'RECOVERY_ALREADY_DEFINED:reject_qoo10_review_chat_observation_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='seal_qoo10_reply_s3_gateway_completion') then raise exception 'RECOVERY_ALREADY_DEFINED:seal_qoo10_reply_s3_gateway_completion';end if;
end $recovery_guard$;
-- Reviewed source: 20260908140419_cs_qoo10_reply_s3_status.sql
-- Source SHA256: 89a51d43800ea1621c646f7ed213f5ffdc32dcde4bcef2d5d08755925ed7e182
-- Proposal only. Do not apply directly to production.
-- Qoo10 S3 list membership is status-only evidence. It must never set the
-- generic remote_observed flag, which means an exact seller body was observed.
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


-- Reviewed source: 20260908140421_cs_qoo10_reply_s3_response_seal.sql
-- Source SHA256: f31954baa26c91d8e20c07432fabdb77c021557b4d374d781d074fb7dec4672c
-- Proposal only. Do not apply directly to production.
-- Apply after qoo10-007. This seals only delivery-bound Qoo10 S3 readback
-- jobs when their common gateway completion receipt is inserted. There is no
-- backfill: a receipt that predates this seal is not trusted as S3 evidence.
create table sellerpilot_private.qoo10_reply_s3_completion_seals (
  job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  credential_id uuid not null,
  channel text not null check (channel = 'qoo10'),
  operation text not null check (operation = 'inquiries.list'),
  environment text not null,
  created_by uuid not null,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  terminal_status text not null
    check (terminal_status in ('succeeded','failed','reconciliation_required')),
  completed_at timestamptz not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  sealed_at timestamptz not null default clock_timestamp(),
  unique (job_id, claim_token),
  foreign key (job_id, claim_token)
    references sellerpilot_private.gateway_completion_receipts(job_id, claim_token)
    on delete restrict
);

alter table sellerpilot_private.qoo10_reply_s3_completion_seals enable row level security;
revoke all on sellerpilot_private.qoo10_reply_s3_completion_seals
  from public, anon, authenticated, service_role;

create function sellerpilot_private.qoo10_reply_s3_json_sha256(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(coalesce(p_value, 'null'::jsonb)::text, 'sha256'),
    'hex'
  )
$$;

revoke all on function sellerpilot_private.qoo10_reply_s3_json_sha256(jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.seal_qoo10_reply_s3_gateway_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_marker jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.job_id
   for share;
  if not found then
    raise exception 'QOO10_REPLY_S3_SEAL_JOB_MISSING' using errcode = '55000';
  end if;

  v_marker := v_job.request_payload#>'{arguments,sellerpilotQoo10ReplyReadback}';
  if v_marker is null then return new; end if;

  if jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-readback/1'
     or coalesce(v_marker->>'deliveryId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_marker->>'inquiryType','') not in ('MSG','HELP','ITEM')
     or coalesce(v_marker->>'questionNo','') !~ '^[0-9]{1,40}$'
     or coalesce(v_marker->>'sequenceNo','') !~ '^[0-9]{1,40}$'
     or v_job.request_payload#>>'{arguments,params,proc_status}' is distinct from 'S3'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_start_dt}','') !~ '^[0-9]{14}$'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_end_dt}','') !~ '^[0-9]{14}$'
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'inquiries.list'
     or v_job.status not in ('succeeded','failed','reconciliation_required')
     or v_job.completed_at is null
     or v_job.credential_id is null
     or v_job.created_by is null
     or coalesce(v_job.seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or new.claim_token is null
     or new.worker_token_id is null
     or coalesce(new.completion_fingerprint,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'QOO10_REPLY_S3_SEAL_SOURCE_INVALID' using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_reply_s3_completion_seals (
    job_id,claim_token,worker_token_id,credential_id,channel,operation,
    environment,created_by,seller_account_key,terminal_status,completed_at,
    request_sha256,response_sha256,completion_fingerprint
  ) values (
    v_job.id,new.claim_token,new.worker_token_id,v_job.credential_id,
    v_job.channel,v_job.operation,v_job.environment,v_job.created_by,
    v_job.seller_account_key,v_job.status,v_job.completed_at,
    sellerpilot_private.qoo10_reply_s3_json_sha256(v_job.request_payload),
    sellerpilot_private.qoo10_reply_s3_json_sha256(v_job.response_payload),
    new.completion_fingerprint
  );
  return new;
end
$$;

revoke all on function sellerpilot_private.seal_qoo10_reply_s3_gateway_completion()
  from public, anon, authenticated, service_role;

create trigger seal_qoo10_reply_s3_gateway_completion
after insert on sellerpilot_private.gateway_completion_receipts
for each row execute function sellerpilot_private.seal_qoo10_reply_s3_gateway_completion();

create function sellerpilot_private.guard_qoo10_reply_s3_sealed_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from sellerpilot_private.qoo10_reply_s3_completion_seals seal
     where seal.job_id = old.id
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'QOO10_REPLY_S3_SEALED_JOB_IMMUTABLE' using errcode = '55000';
  end if;
  if new.credential_id is distinct from old.credential_id
     or new.channel is distinct from old.channel
     or new.operation is distinct from old.operation
     or new.environment is distinct from old.environment
     or new.status is distinct from old.status
     or new.request_payload is distinct from old.request_payload
     or new.response_payload is distinct from old.response_payload
     or new.created_by is distinct from old.created_by
     or new.seller_account_key is distinct from old.seller_account_key
     or new.completed_at is distinct from old.completed_at then
    raise exception 'QOO10_REPLY_S3_SEALED_JOB_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_sealed_job()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_sealed_job
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_sealed_job();

create function sellerpilot_private.guard_qoo10_reply_s3_seal_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from sellerpilot_private.qoo10_reply_s3_completion_seals seal
     where seal.job_id = old.job_id
  ) then
    raise exception 'QOO10_REPLY_S3_COMPLETION_RECEIPT_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_seal_source()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_seal_source
before update or delete on sellerpilot_private.gateway_completion_receipts
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_seal_source();

create function sellerpilot_private.guard_qoo10_reply_s3_seal_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'QOO10_REPLY_S3_COMPLETION_SEAL_IMMUTABLE' using errcode = '55000';
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_seal_immutable()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_seal_immutable
before update or delete on sellerpilot_private.qoo10_reply_s3_completion_seals
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_seal_immutable();

alter function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) rename to sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1;

revoke all on function public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) from public, anon, authenticated, service_role;

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
  v_result jsonb;
begin
  perform 1
    from sellerpilot_private.qoo10_reply_s3_completion_seals seal
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id = seal.job_id
     and receipt.claim_token = seal.claim_token
     and receipt.worker_token_id = seal.worker_token_id
     and receipt.completion_fingerprint = seal.completion_fingerprint
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = seal.job_id
     and job.credential_id = seal.credential_id
     and job.channel = seal.channel
     and job.operation = seal.operation
     and job.environment = seal.environment
     and job.created_by = seal.created_by
     and job.seller_account_key = seal.seller_account_key
     and job.status = seal.terminal_status
     and job.completed_at = seal.completed_at
   where seal.job_id = p_job_id
     and seal.claim_token = p_claim_token
     and sellerpilot_private.qoo10_reply_s3_json_sha256(job.request_payload)
           = seal.request_sha256
     and sellerpilot_private.qoo10_reply_s3_json_sha256(job.response_payload)
           = seal.response_sha256
   for share of seal, receipt, job;
  if not found then
    raise exception 'QOO10_REPLY_S3_READBACK_SEAL_INVALID' using errcode = '55000';
  end if;

  select public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(
    p_token_hash,p_job_id,p_claim_token,p_delivery_id,p_state,p_reason,
    p_matching_rows,p_reply_content_observed,p_resend_allowed
  ) into v_result;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) to service_role;


-- Reviewed source: 20260908145336_cs_qoo10_reply_s3_common_paths.sql
-- Source SHA256: a595454731d119f2608e19354a7972a44ea9a50e30fd7f87012821b9fb126889
-- Proposal only. Do not apply directly to production.
-- Apply after qoo10-007 and qoo10-008. This migration does not backfill old
-- reply receipts. Only a newly inserted, exact provider-acceptance receipt can
-- enqueue the delivery-bound read-only S3 child in the same transaction.
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
CREATE OR REPLACE FUNCTION public.sellerpilot_get_inquiry_reply_delivery(p_ticket_id uuid, p_job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else(
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
$function$;

revoke all on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  to authenticated;

do $extend_qoo10_s3_workspace_reads$
declare
  v_definition text;
  v_rewritten text;
begin
  if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()'::regprocedure) is distinct from '7d1ba4d6bae8a4f044b19cf2e162b957' then raise exception 'QOO10_WORKSPACE_BASE_PREIMAGE_DRIFT';end if;
  if to_regprocedure('public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()') is null then
    raise exception 'QOO10_REPLY_S3_WORKSPACE_RPC_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()'::regprocedure
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


-- Reviewed source: 20260908153341_cs_qoo10_reply_s3_actual_completion.sql
-- Source SHA256: 1b6a391f392a12622b6d6f76bd5b95502f4e250b25e8d7890f552e70b6e3e827
-- Proposal only. Do not apply directly to production.
-- Apply after qoo10-007, qoo10-008, and qoo10-009.
--
-- The generic atomic completion requires normalized inquiries for every
-- successful inquiries.list result. A delivery-bound Qoo10 S3 readback is not
-- a ticket import and intentionally has no normalized inquiry payload. Route
-- only that sealed marker contract through an exact atomic terminal+receipt
-- path, leaving every ordinary read and every other channel on the predecessor.
-- Also allow the exact serverless_cs receipt owner through the already sealed
-- qoo10-007 lineage query; the outer qoo10-008 wrapper still verifies the
-- immutable job/receipt/seal tuple before this predicate can be reached.

do $patch_qoo10_s3_serverless_scope$
declare
  v_definition text;
  v_rewritten text;
  v_compact_old constant text := 'token.scope in (''gateway'',''legacy_combined'')';
  v_spaced_old constant text := 'token.scope in (''gateway'', ''legacy_combined'')';
  v_new constant text := 'token.scope in (''gateway'',''legacy_combined'',''serverless_cs'')';
  v_occurrences integer;
begin
  if to_regprocedure(
    'public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(text,uuid,uuid,uuid,text,text,integer,boolean,boolean)'
  ) is null then
    raise exception 'QOO10_REPLY_S3_UNSEALED_STATUS_RPC_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(text,uuid,uuid,uuid,text,text,integer,boolean,boolean)'::regprocedure
  ) into v_definition;
  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_compact_old, '')))
      / length(v_compact_old)
    + (length(v_definition) - length(replace(v_definition, v_spaced_old, '')))
      / length(v_spaced_old);
  if v_occurrences <> 1 then
    raise exception 'QOO10_REPLY_S3_STATUS_SCOPE_PREIMAGE_MISMATCH';
  end if;

  v_rewritten := replace(v_definition, v_compact_old, v_new);
  v_rewritten := replace(v_rewritten, v_spaced_old, v_new);
  if v_rewritten = v_definition
     or v_rewritten like '%' || v_compact_old || '%'
     or v_rewritten like '%' || v_spaced_old || '%' then
    raise exception 'QOO10_REPLY_S3_STATUS_SCOPE_REWRITE_FAILED';
  end if;
  execute v_rewritten;
end
$patch_qoo10_s3_serverless_scope$;

revoke all on function
  public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(
    text,uuid,uuid,uuid,text,text,integer,boolean,boolean
  ) from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_145336_complete_before_qoo10_reply_s3;

revoke all on function public.sellerpilot_145336_complete_before_qoo10_reply_s3(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_worker_id uuid;
  v_completion_fingerprint text;
  v_receipt sellerpilot_private.gateway_completion_receipts%rowtype;
  v_completed boolean;
  v_marker jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  v_marker := v_job.request_payload#>'{arguments,sellerpilotQoo10ReplyReadback}';

  if not found
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'inquiries.list'
     or v_marker is null then
    return public.sellerpilot_145336_complete_before_qoo10_reply_s3(
      p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
      p_error_message,p_credential_refresh,p_normalized_orders,
      p_normalized_inquiries,p_diagnostic
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null
     or p_status not in ('succeeded','failed','reconciliation_required')
     or p_credential_refresh is not null
     or p_normalized_orders is not null
     or p_normalized_inquiries is not null
     or p_diagnostic is not null
     or jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-readback/1'
     or coalesce(v_marker->>'deliveryId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_marker->>'inquiryType','') not in ('MSG','HELP','ITEM')
     or coalesce(v_marker->>'questionNo','') !~ '^[0-9]{1,40}$'
     or coalesce(v_marker->>'sequenceNo','') !~ '^[0-9]{1,40}$'
     or v_job.request_payload#>>'{arguments,params,proc_status}' is distinct from 'S3'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_start_dt}','') !~ '^[0-9]{14}$'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_end_dt}','') !~ '^[0-9]{14}$'
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) is distinct from 'object'
       or octet_length(p_response_payload::text) > 1000000
       or p_response_payload->>'channel' is distinct from 'qoo10'
       or p_response_payload->>'operation' is distinct from 'inquiries.list'
       or p_response_payload#>>'{steps,0,data,sellerpilotMarker}' is distinct from
          'sellerpilot-qoo10-s3-stored-evidence/1'
     ))
     or (p_status = 'succeeded' and (
       p_response_payload is null
       or p_response_payload->>'ok' is distinct from 'true'
       or jsonb_typeof(p_response_payload->'steps') is distinct from 'array'
       or jsonb_array_length(p_response_payload->'steps') <> 1
       or p_response_payload#>>'{steps,0,name}' is distinct from 'GetInquiryMessage'
       or p_response_payload#>>'{steps,0,ok}' is distinct from 'true'
       or p_response_payload#>>'{steps,0,data,ResultCode}' is distinct from '0'
       or jsonb_typeof(p_response_payload#>'{steps,0,data,ResultObject}')
            is distinct from 'array'
     )) then
    raise exception 'QOO10_REPLY_S3_ATOMIC_COMPLETION_INVALID' using errcode = '22023';
  end if;

  if not sellerpilot_private.worker_token_may_complete_gateway_job(
    p_token_hash,p_job_id,p_claim_token
  ) then
    return jsonb_build_object('status','ownership_lost');
  end if;

  v_completion_fingerprint := sellerpilot_private.gateway_completion_fingerprint(
    p_status,p_response_payload,p_error_message,p_credential_refresh,
    p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  select receipt.* into v_receipt
    from sellerpilot_private.gateway_completion_receipts receipt
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = receipt.worker_token_id
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token
     and token.token_hash = p_token_hash
     and token.scope in ('gateway','legacy_combined','serverless_cs')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if found then
    if v_receipt.completion_fingerprint <> v_completion_fingerprint then
      raise exception 'gateway completion replay mismatch' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'status','completed','replayed',true,'continuationJobId',null
    );
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where job.id = p_job_id
     and job.channel = 'qoo10'
     and job.operation = 'inquiries.list'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.token_hash = p_token_hash
     and token.scope in ('gateway','legacy_combined','serverless_cs')
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update of job;
  if not found then return jsonb_build_object('status','ownership_lost'); end if;
  v_worker_id := v_job.worker_token_id;

  v_completed := public.sellerpilot_complete_channel_gateway_job(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    case when p_status='succeeded' then null else p_error_message end
  );
  if v_completed is not true then
    raise exception 'gateway completion claim changed' using errcode = '40001';
  end if;

  insert into sellerpilot_private.gateway_completion_receipts(
    job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
  ) values(
    p_job_id,p_claim_token,v_worker_id,v_completion_fingerprint,null
  );
  return jsonb_build_object(
    'status','completed','credentialId',v_job.credential_id,
    'continuationJobId',null
  );
end
$$;

revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

-- Recreate the delegating wrapper after the canonical function rename so its
-- compiled dependency always resolves to the new exact S3 branch.
create or replace function public.sellerpilot_service_complete_serverless_cs_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_may_complete_gateway_job(
    p_token_hash,p_job_id,p_claim_token
  ) then
    return jsonb_build_object('status','ownership_lost');
  end if;
  return public.sellerpilot_service_complete_gateway_transaction(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    p_error_message,p_credential_refresh,p_normalized_orders,
    p_normalized_inquiries,p_diagnostic
  );
end
$$;

revoke all on function public.sellerpilot_service_complete_serverless_cs_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_serverless_cs_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;


-- Reviewed source: 20260909153338_cs_qoo10_reply_s3_requery.sql
-- Source SHA256: b6b1835cf1b6f18b64acf7458f9b642ce439b18fe339db722b312fbe5de05153
-- Private integration-sandbox review draft; central assigns final version.
-- Read-only S3 observations only. This migration never schedules inquiries.reply.
create table sellerpilot_private.qoo10_reply_s3_requery_ledger (
  delivery_id uuid not null
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  attempt_number smallint not null check (attempt_number between 1 and 5),
  source_readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  requery_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  lineage_digest text not null check (lineage_digest ~ '^[a-f0-9]{64}$'),
  verification_state text not null check (verification_state in ('verified','pending','incomplete')),
  verification_reason text not null,
  matching_rows integer not null check (matching_rows >= 0),
  first_checked_at timestamptz not null,
  last_checked_at timestamptz not null,
  next_attempt_at timestamptz,
  outcome text not null check (outcome in ('scheduled','verified','reconciliation_required')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (delivery_id, attempt_number),
  check (last_checked_at >= first_checked_at),
  check (
    (outcome = 'scheduled' and requery_job_id is not null and next_attempt_at is not null)
    or (outcome <> 'scheduled' and requery_job_id is null and next_attempt_at is null)
  ),
  check (next_attempt_at is null or next_attempt_at <= first_checked_at + interval '6 hours')
);

alter table sellerpilot_private.qoo10_reply_s3_requery_ledger enable row level security;
revoke all on sellerpilot_private.qoo10_reply_s3_requery_ledger
  from public,anon,authenticated,service_role;

create function sellerpilot_private.guard_qoo10_reply_s3_requery_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'QOO10_REPLY_S3_REQUERY_LEDGER_IMMUTABLE' using errcode = '55000';
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_requery_ledger()
  from public,anon,authenticated,service_role;

create trigger guard_qoo10_reply_s3_requery_ledger
before update or delete on sellerpilot_private.qoo10_reply_s3_requery_ledger
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_requery_ledger();

create function sellerpilot_private.qoo10_reply_s3_requery_context_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_initial sellerpilot_private.channel_gateway_jobs%rowtype;
  v_reply sellerpilot_private.channel_gateway_jobs%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_enqueue sellerpilot_private.qoo10_reply_s3_readback_enqueues%rowtype;
  v_marker jsonb;
  v_requery_marker jsonb;
  v_attempt integer;
  v_expected_digest text;
  v_digest text;
  v_first_checked_at timestamptz;
  v_last_checked_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null then
    raise exception 'QOO10_REPLY_REQUERY_CONTEXT_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select source.* into v_source
    from sellerpilot_private.channel_gateway_jobs source
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id = source.id and receipt.claim_token = p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = receipt.worker_token_id
     and token.token_hash = p_token_hash
     and token.scope in ('gateway','legacy_combined','serverless_cs')
     and token.status = 'active'
     and token.expires_at > v_now
   where source.id = p_job_id
     and source.channel = 'qoo10'
     and source.operation = 'inquiries.list'
     and source.status in ('succeeded','failed','reconciliation_required');
  if not found then
    raise exception 'QOO10_REPLY_REQUERY_COMPLETION_RECEIPT_REQUIRED' using errcode = '42501';
  end if;

  v_marker := v_source.request_payload#>'{arguments,sellerpilotQoo10ReplyReadback}';
  if jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-readback/1'
     or coalesce(v_marker->>'deliveryId','') !~ '^[0-9a-f-]{36}$' then
    raise exception 'QOO10_REPLY_REQUERY_MARKER_INVALID' using errcode = '22023';
  end if;

  select enqueue.* into v_enqueue
    from sellerpilot_private.qoo10_reply_s3_readback_enqueues enqueue
    join sellerpilot_private.support_reply_deliveries delivery
      on delivery.id = enqueue.delivery_id
    join sellerpilot_private.support_tickets ticket
      on ticket.id = delivery.ticket_id and ticket.owner_id = delivery.owner_id
    join sellerpilot_private.channel_gateway_jobs reply
      on reply.id = enqueue.reply_job_id and reply.id = delivery.gateway_job_id
    join sellerpilot_private.channel_gateway_jobs initial
      on initial.id = enqueue.readback_job_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = v_source.credential_id
   where enqueue.delivery_id = (v_marker->>'deliveryId')::uuid
     and delivery.channel_key = 'qoo10'
     and reply.channel = 'qoo10' and reply.operation = 'inquiries.reply'
     and initial.channel = 'qoo10' and initial.operation = 'inquiries.list'
     and v_source.credential_id = reply.credential_id
     and initial.credential_id = reply.credential_id
     and v_source.environment = reply.environment
     and initial.environment = reply.environment
     and v_source.created_by = ticket.owner_id
     and reply.created_by = ticket.owner_id
     and initial.created_by = ticket.owner_id
     and ticket.source_credential_id = reply.credential_id
     and ticket.seller_account_key = reply.seller_account_key
     and v_source.seller_account_key = reply.seller_account_key
     and initial.seller_account_key = reply.seller_account_key
     and ticket.latest_inbound_key = reply.request_payload->>'sellerpilotInboundKey'
     and credential.channel = 'qoo10'
     and credential.environment = reply.environment
     and credential.created_by = ticket.owner_id
     and credential.seller_account_key = ticket.seller_account_key
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now);
  if not found then
    raise exception 'QOO10_REPLY_REQUERY_LINEAGE_INVALID' using errcode = '55000';
  end if;
  select * into strict v_delivery
    from sellerpilot_private.support_reply_deliveries where id = v_enqueue.delivery_id;
  select * into strict v_ticket
    from sellerpilot_private.support_tickets where id = v_delivery.ticket_id;
  select * into strict v_reply
    from sellerpilot_private.channel_gateway_jobs where id = v_enqueue.reply_job_id;
  select * into strict v_initial
    from sellerpilot_private.channel_gateway_jobs where id = v_enqueue.readback_job_id;

  if v_marker->>'inquiryType' is distinct from v_enqueue.inquiry_type
     or v_marker->>'questionNo' is distinct from v_enqueue.question_no
     or v_marker->>'sequenceNo' is distinct from v_enqueue.sequence_no
     or v_source.request_payload#>>'{arguments,params,proc_status}' is distinct from 'S3'
     or v_source.request_payload#>>'{arguments,params,search_start_dt}' is distinct from v_enqueue.search_start_dt
     or v_source.request_payload#>>'{arguments,params,search_end_dt}' is distinct from v_enqueue.search_end_dt
     or v_reply.request_payload#>>'{arguments,params,inq_type}' is distinct from v_enqueue.inquiry_type
     or v_reply.request_payload#>>'{arguments,params,question_no}' is distinct from v_enqueue.question_no
     or v_reply.request_payload#>>'{arguments,params,seq_no}' is distinct from v_enqueue.sequence_no then
    raise exception 'QOO10_REPLY_REQUERY_TARGET_INVALID' using errcode = '22023';
  end if;

  v_requery_marker := v_source.request_payload#>'{arguments,sellerpilotQoo10ReplyReadbackRequery}';
  if v_requery_marker is null then
    v_attempt := 1;
    v_expected_digest := null;
    if v_source.id is distinct from v_enqueue.readback_job_id then
      raise exception 'QOO10_REPLY_REQUERY_INITIAL_JOB_INVALID' using errcode = '55000';
    end if;
  else
    if jsonb_typeof(v_requery_marker) is distinct from 'object'
       or v_requery_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-s3-requery/1'
       or coalesce(v_requery_marker->>'attemptNumber','') !~ '^[2-5]$'
       or coalesce(v_requery_marker->>'lineageDigest','') !~ '^[a-f0-9]{64}$' then
      raise exception 'QOO10_REPLY_REQUERY_MARKER_INVALID' using errcode = '22023';
    end if;
    v_attempt := (v_requery_marker->>'attemptNumber')::integer;
    v_expected_digest := v_requery_marker->>'lineageDigest';
    if not exists (
      select 1
        from sellerpilot_private.qoo10_reply_s3_requery_ledger ledger
       where ledger.delivery_id = v_delivery.id
         and ledger.attempt_number = v_attempt - 1
         and ledger.requery_job_id = v_source.id
         and ledger.lineage_digest = v_expected_digest
         and ledger.outcome = 'scheduled'
    ) then
      raise exception 'QOO10_REPLY_REQUERY_PARENT_LEDGER_INVALID' using errcode = '55000';
    end if;
  end if;

  v_first_checked_at := date_trunc(
    'milliseconds',coalesce(v_initial.completed_at,v_initial.updated_at)
  );
  v_last_checked_at := date_trunc(
    'milliseconds',coalesce(v_source.completed_at,v_source.updated_at)
  );
  if v_first_checked_at is null or v_last_checked_at is null
     or v_last_checked_at < v_first_checked_at then
    raise exception 'QOO10_REPLY_REQUERY_TIME_INVALID' using errcode = '22023';
  end if;

  v_digest := encode(extensions.digest(
    'sellerpilot-qoo10-reply-s3-requery/1' || chr(31)
      || v_ticket.owner_id::text || chr(31)
      || v_source.credential_id::text || chr(31)
      || v_ticket.seller_account_key || chr(31)
      || v_source.environment::text || chr(31)
      || v_delivery.id::text || chr(31)
      || v_reply.id::text || chr(31)
      || v_ticket.latest_inbound_key || chr(31)
      || v_enqueue.search_start_dt || chr(31)
      || v_enqueue.search_end_dt || chr(31)
      || v_enqueue.inquiry_type || chr(31)
      || v_enqueue.question_no || chr(31)
      || v_enqueue.sequence_no,
    'sha256'
  ),'hex');
  if v_expected_digest is not null and v_expected_digest is distinct from v_digest then
    raise exception 'QOO10_REPLY_REQUERY_DIGEST_MISMATCH' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-reply-s3-requery-context/1',
    'sourceReadbackJobId',v_source.id,
    'attemptNumber',v_attempt,
    'expectedLineageDigest',v_expected_digest,
    'lineageDigest',v_digest,
    'firstCheckedAt',to_char(v_first_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastCheckedAt',to_char(v_last_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lineage',jsonb_build_object(
      'ownerId',v_ticket.owner_id,'credentialId',v_source.credential_id,
      'sellerAccountKey',v_ticket.seller_account_key,'environment',v_source.environment,
      'deliveryId',v_delivery.id,'replyJobId',v_reply.id,
      'inboundKey',v_ticket.latest_inbound_key,
      'searchStartAt',v_enqueue.search_start_dt,'searchEndAt',v_enqueue.search_end_dt,
      'target',jsonb_build_object(
        'inquiryType',v_enqueue.inquiry_type,'questionNo',v_enqueue.question_no,
        'sequenceNo',v_enqueue.sequence_no
      )
    )
  );
end
$$;

revoke all on function sellerpilot_private.qoo10_reply_s3_requery_context_v1(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_qoo10_reply_s3_requery_context_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select sellerpilot_private.qoo10_reply_s3_requery_context_v1(
    p_token_hash,p_job_id,p_claim_token
  )
$$;

revoke all on function public.sellerpilot_service_qoo10_reply_s3_requery_context_v1(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_qoo10_reply_s3_requery_context_v1(text,uuid,uuid)
  to service_role;

create function public.sellerpilot_service_apply_qoo10_reply_s3_requery_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,
  p_state text,p_reason text,p_matching_rows integer,p_descriptor jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_lineage jsonb;
  v_existing sellerpilot_private.qoo10_reply_s3_requery_ledger%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_attempt integer;
  v_next_attempt integer;
  v_delay integer;
  v_expected_retry_at timestamptz;
  v_retry_at timestamptz;
  v_first_checked_at timestamptz;
  v_last_checked_at timestamptz;
  v_digest text;
  v_child_id uuid;
  v_outcome text;
  v_now timestamptz := clock_timestamp();
begin
  v_context := sellerpilot_private.qoo10_reply_s3_requery_context_v1(
    p_token_hash,p_job_id,p_claim_token
  );
  v_lineage := v_context->'lineage';
  v_attempt := (v_context->>'attemptNumber')::integer;
  v_first_checked_at := (v_context->>'firstCheckedAt')::timestamptz;
  v_last_checked_at := (v_context->>'lastCheckedAt')::timestamptz;
  v_digest := p_descriptor->>'lineageDigest';

  if jsonb_typeof(p_descriptor) is distinct from 'object'
     or p_descriptor->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-s3-requery/1'
     or (p_descriptor->>'attemptNumber')::integer is distinct from v_attempt
     or coalesce(v_digest,'') !~ '^[a-f0-9]{64}$'
     or v_digest is distinct from v_context->>'lineageDigest'
     or p_descriptor->'readOnly' is distinct from 'true'::jsonb
     or p_descriptor->'resendAllowed' is distinct from 'false'::jsonb
     or p_descriptor->'replyOperationAllowed' is distinct from 'false'::jsonb
     or p_state not in ('verified','pending','incomplete')
     or p_matching_rows is null or p_matching_rows < 0 then
    raise exception 'QOO10_REPLY_REQUERY_DESCRIPTOR_INVALID' using errcode = '22023';
  end if;

  select delivery.* into v_delivery
    from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id = (v_lineage->>'deliveryId')::uuid
     and delivery.channel_key = 'qoo10'
   for update;
  if not found
     or v_delivery.qoo10_s3_readback_state is distinct from p_state
     or v_delivery.qoo10_s3_readback_reason is distinct from p_reason
     or v_delivery.qoo10_s3_matching_rows is distinct from p_matching_rows
     or v_delivery.qoo10_reply_content_observed
     or v_delivery.qoo10_automatic_resend_allowed then
    raise exception 'QOO10_REPLY_REQUERY_STATUS_EVIDENCE_REQUIRED' using errcode = '55000';
  end if;

  select ledger.* into v_existing
    from sellerpilot_private.qoo10_reply_s3_requery_ledger ledger
   where ledger.source_readback_job_id = p_job_id;
  if found then
    if v_existing.delivery_id is distinct from v_delivery.id
       or v_existing.attempt_number is distinct from v_attempt
       or v_existing.lineage_digest is distinct from v_digest
       or v_existing.verification_state is distinct from p_state
       or v_existing.verification_reason is distinct from p_reason
       or v_existing.matching_rows is distinct from p_matching_rows then
      raise exception 'QOO10_REPLY_REQUERY_REPLAY_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'contract','sellerpilot-qoo10-reply-s3-requery-result/1',
      'status',v_existing.outcome,'sourceReadbackJobId',p_job_id,
      'deliveryId',v_existing.delivery_id,'attemptNumber',v_existing.attempt_number,
      'nextAttemptNumber',case when v_existing.requery_job_id is null then null else v_attempt+1 end,
      'lineageDigest',v_existing.lineage_digest,'requeryJobId',v_existing.requery_job_id,
      'replayed',true
    );
  end if;

  if p_descriptor->>'decision' = 'retry' then
    v_next_attempt := (p_descriptor->>'nextAttemptNumber')::integer;
    v_delay := case v_attempt when 1 then 60 when 2 then 300 when 3 then 900 when 4 then 3600 else null end;
    v_retry_at := (p_descriptor->>'retryAt')::timestamptz;
    v_expected_retry_at := v_last_checked_at + v_delay * interval '1 second';
    if p_state = 'verified'
       or (p_state || ':' || p_reason) not in (
         'pending:exact_s3_not_observed',
         'incomplete:wrong_sequence_observed',
         'incomplete:exact_identity_not_completed',
         'incomplete:provider_rejected',
         'incomplete:provider_transport_or_contract_failed'
       )
       or v_delay is null or v_next_attempt is distinct from v_attempt + 1
       or v_next_attempt > 5
       or p_descriptor->>'reason' is distinct from 'bounded_read_only_requery'
       or p_descriptor->>'operation' is distinct from 'inquiries.list'
       or p_descriptor->>'periodicKey' is distinct from
         'inquiries:reply-readback:qoo10:' || v_delivery.id::text || ':attempt:' || v_next_attempt::text
       or v_retry_at is distinct from v_expected_retry_at
       or v_retry_at > v_first_checked_at + interval '6 hours'
       or p_descriptor#>>'{arguments,params,proc_status}' is distinct from 'S3'
       or p_descriptor#>>'{arguments,params,search_start_dt}' is distinct from v_lineage->>'searchStartAt'
       or p_descriptor#>>'{arguments,params,search_end_dt}' is distinct from v_lineage->>'searchEndAt'
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadback,contractVersion}'
            is distinct from 'sellerpilot-qoo10-reply-readback/1'
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadback,deliveryId}'
            is distinct from v_delivery.id::text
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadback,inquiryType}'
            is distinct from v_lineage#>>'{target,inquiryType}'
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadback,questionNo}'
            is distinct from v_lineage#>>'{target,questionNo}'
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadback,sequenceNo}'
            is distinct from v_lineage#>>'{target,sequenceNo}'
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadbackRequery,contractVersion}'
            is distinct from 'sellerpilot-qoo10-reply-s3-requery/1'
       or (p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadbackRequery,attemptNumber}')::integer
            is distinct from v_next_attempt
       or p_descriptor#>>'{arguments,sellerpilotQoo10ReplyReadbackRequery,lineageDigest}'
            is distinct from v_digest
       or p_descriptor::text ~* '"contents"[[:space:]]*:' then
      raise exception 'QOO10_REPLY_REQUERY_RETRY_INVALID' using errcode = '22023';
    end if;

    v_child_id := gen_random_uuid();
    insert into sellerpilot_private.channel_gateway_jobs (
      id,credential_id,attempt_id,channel,operation,environment,request_payload,
      status,seller_account_key,created_by,rate_not_before,created_at,updated_at
    ) values (
      v_child_id,(v_lineage->>'credentialId')::uuid,null,'qoo10','inquiries.list',
      v_lineage->>'environment',
      jsonb_build_object(
        'periodicKey',p_descriptor->>'periodicKey',
        'arguments',p_descriptor->'arguments'
      ),
      'queued',v_lineage->>'sellerAccountKey',(v_lineage->>'ownerId')::uuid,
      v_retry_at,v_now,v_now
    );
    v_outcome := 'scheduled';
  elsif p_descriptor->>'decision' = 'stop'
        and p_descriptor->>'reason' = 'already_verified'
        and p_state = 'verified'
        and p_reason = 'exact_s3_status_observed'
        and v_delivery.qoo10_s3_status_observed then
    v_outcome := 'verified';
    update sellerpilot_private.support_reply_deliveries
       set status='succeeded',reconciliation_reason=null,updated_at=greatest(updated_at,v_now)
     where id=v_delivery.id;
  elsif p_descriptor->>'decision' = 'stop'
        and p_descriptor->>'reason' in ('attempt_limit_reached','elapsed_limit_reached')
        and p_state <> 'verified'
        and (
          (p_descriptor->>'reason' = 'attempt_limit_reached' and v_attempt >= 5)
          or (
            p_descriptor->>'reason' = 'elapsed_limit_reached'
            and v_attempt < 5
            and (
              v_last_checked_at >= v_first_checked_at + interval '6 hours'
              or v_last_checked_at
                + (case v_attempt when 1 then 60 when 2 then 300 when 3 then 900 when 4 then 3600 end)
                  * interval '1 second'
                > v_first_checked_at + interval '6 hours'
            )
          )
        ) then
    v_outcome := 'reconciliation_required';
    update sellerpilot_private.support_reply_deliveries
       set status='reconciliation_required',
           verification_status='reconciliation_required',
           reconciliation_reason='QOO10_REPLY_S3_REQUERY_EXHAUSTED',
           safe_message='Qoo10 S3 상태 재확인 한도에 도달해 수동 대조가 필요합니다.',
           updated_at=greatest(updated_at,v_now)
     where id=v_delivery.id;
  else
    raise exception 'QOO10_REPLY_REQUERY_STOP_INVALID' using errcode = '22023';
  end if;

  insert into sellerpilot_private.qoo10_reply_s3_requery_ledger (
    delivery_id,attempt_number,source_readback_job_id,requery_job_id,
    lineage_digest,verification_state,verification_reason,matching_rows,
    first_checked_at,last_checked_at,next_attempt_at,outcome
  ) values (
    v_delivery.id,v_attempt,p_job_id,v_child_id,v_digest,p_state,p_reason,p_matching_rows,
    v_first_checked_at,v_last_checked_at,v_retry_at,v_outcome
  );

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-reply-s3-requery-result/1',
    'status',v_outcome,'sourceReadbackJobId',p_job_id,'deliveryId',v_delivery.id,
    'attemptNumber',v_attempt,
    'nextAttemptNumber',case when v_child_id is null then null else v_attempt+1 end,
    'lineageDigest',v_digest,'requeryJobId',v_child_id,'replayed',false
  );
end
$$;

revoke all on function public.sellerpilot_service_apply_qoo10_reply_s3_requery_v1(
  text,uuid,uuid,text,text,integer,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_apply_qoo10_reply_s3_requery_v1(
  text,uuid,uuid,text,text,integer,jsonb
) to service_role;


-- Reviewed source: 20260910043000_cs_qoo10_review_chat_observation_ledger.sql
-- Source SHA256: 7c6c0292ed50ff36e3e4906ad73121d44627172291d6e461ba7b7b7608f1ca1b
do $preimage$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
      or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_PREIMAGE_MISSING';
  end if;
  if to_regclass('sellerpilot_private.qoo10_review_chat_observations') is not null
      or to_regprocedure(
        'public.sellerpilot_read_qoo10_review_chat_accounts_v1()'
      ) is not null
      or to_regprocedure(
        'public.sellerpilot_read_qoo10_review_chat_observation_v1(uuid)'
      ) is not null
      or to_regprocedure(
        'public.sellerpilot_service_record_qoo10_review_chat_observation_v1(uuid,bigint,jsonb,jsonb)'
      ) is not null then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_ALREADY_APPLIED';
  end if;
end
$preimage$;

create table sellerpilot_private.qoo10_review_chat_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null check (environment in ('sandbox','production')),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  credential_version integer not null check (credential_version > 0),
  source_revision bigint not null check (source_revision > 0),
  source_artifact_id text not null check (
    length(source_artifact_id) between 8 and 240
    and source_artifact_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$'
  ),
  source_artifact_sha256 text not null check (
    source_artifact_sha256 ~ '^[a-f0-9]{64}$'
  ),
  observation_sha256 text not null check (observation_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  valid_until timestamptz not null,
  seller_dashboard_visible boolean not null,
  buyer_inquiry_summary_visible boolean not null,
  review_history_visible boolean not null,
  review_navigation_result text not null check (
    review_navigation_result in ('history_visible','redirected_to_login','unavailable')
  ),
  review_history_state text not null check (
    review_history_state in ('unknown','verified_zero')
  ),
  review_observed_count integer check (
    review_observed_count is null or review_observed_count >= 0
  ),
  review_imported_count integer not null check (review_imported_count = 0),
  review_reconciled_count integer not null check (review_reconciled_count = 0),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (credential_id, source_revision),
  check (valid_until > observed_at and valid_until <= observed_at + interval '15 minutes'),
  check (
    (
      review_history_state = 'unknown'
      and review_observed_count is null
      and review_imported_count = 0
      and review_reconciled_count = 0
    )
    or (
      review_history_state = 'verified_zero'
      and review_history_visible
      and review_navigation_result = 'history_visible'
      and review_observed_count = 0
      and review_imported_count = 0
      and review_reconciled_count = 0
    )
  )
);

create index qoo10_review_chat_observations_latest_idx
  on sellerpilot_private.qoo10_review_chat_observations (
    credential_id, source_revision desc, observed_at desc
  );

create function sellerpilot_private.reject_qoo10_review_chat_observation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger qoo10_review_chat_observations_immutable
before update or delete on sellerpilot_private.qoo10_review_chat_observations
for each row execute function
  sellerpilot_private.reject_qoo10_review_chat_observation_change();

alter table sellerpilot_private.qoo10_review_chat_observations enable row level security;
revoke all on sellerpilot_private.qoo10_review_chat_observations
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.reject_qoo10_review_chat_observation_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_read_qoo10_review_chat_accounts_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'credentialId',credential.id,
    'label','Qoo10 연결 계정 · ' || left(credential.fingerprint,12),
    'credentialState',case
      when credential.expires_at is not null
        and credential.expires_at <= statement_timestamp() then 'expired'
      when credential.status = 'active'
        and credential.seller_account_key ~ '^[a-f0-9]{64}$'
        and credential.seller_account_key_source in (
          'provider_certified_v1','credential_incarnation_v1'
        )
        and credential.seller_account_verified_at is not null then 'active'
      when credential.status = 'grace' then 'grace'
      when credential.status = 'revoked' then 'revoked'
      when credential.status = 'invalid' then 'invalid'
      else 'unverified'
    end,
    'credentialExpiresAt',credential.expires_at,
    'sellerAccountBinding',case
      when credential.seller_account_key_source = 'provider_certified_v1'
        and credential.seller_account_verified_at is not null then 'provider_certified'
      when credential.seller_account_key_source = 'credential_incarnation_v1'
        and credential.seller_account_verified_at is not null then 'credential_incarnation'
      else 'unverified'
    end,
    'sellerAccountKeyHash',case
      when credential.seller_account_key ~ '^[a-f0-9]{64}$'
        then credential.seller_account_key
      else null
    end,
    'environment',credential.environment
  ) order by
    case credential.status when 'active' then 0 when 'grace' then 1 else 2 end,
    credential.version desc,credential.id),'[]'::jsonb)
    into v_rows
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'qoo10'
     and credential.environment = 'production';

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-accounts/2',
    'checkedAt',statement_timestamp(),
    'accounts',v_rows
  );
end;
$$;

create function public.sellerpilot_read_qoo10_review_chat_observation_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_evidence sellerpilot_private.qoo10_review_chat_observations%rowtype;
  v_credential_state text;
  v_binding text;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production';
  if not found then
    raise exception 'QOO10_REVIEW_CHAT_ACCOUNT_SELECTION_INVALID'
      using errcode = '22023';
  end if;

  v_credential_state := case
    when v_credential.expires_at is not null and v_credential.expires_at <= v_now
      then 'expired'
    when v_credential.status = 'active'
      and v_credential.seller_account_key ~ '^[a-f0-9]{64}$'
      and v_credential.seller_account_key_source in (
        'provider_certified_v1','credential_incarnation_v1'
      )
      and v_credential.seller_account_verified_at is not null then 'active'
    when v_credential.status = 'grace' then 'grace'
    when v_credential.status = 'revoked' then 'revoked'
    when v_credential.status = 'invalid' then 'invalid'
    else 'unverified'
  end;
  v_binding := case
    when v_credential.seller_account_key_source = 'provider_certified_v1'
      and v_credential.seller_account_verified_at is not null
      then 'provider_certified'
    when v_credential.seller_account_key_source = 'credential_incarnation_v1'
      and v_credential.seller_account_verified_at is not null
      then 'credential_incarnation'
    else 'unverified'
  end;

  if v_credential.seller_account_key ~ '^[a-f0-9]{64}$' then
    select evidence.* into v_evidence
      from sellerpilot_private.qoo10_review_chat_observations evidence
     where evidence.credential_id = v_credential.id
       and evidence.owner_id = v_credential.created_by
       and evidence.environment = v_credential.environment
       and evidence.seller_account_key = v_credential.seller_account_key
       and evidence.credential_version = v_credential.version
     order by evidence.source_revision desc,evidence.observed_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-observation-read/1',
    'checkedAt',v_now,
    'account',jsonb_build_object(
      'credentialId',v_credential.id,
      'label','Qoo10 연결 계정 · ' || left(v_credential.fingerprint,12),
      'credentialState',v_credential_state,
      'credentialExpiresAt',v_credential.expires_at,
      'sellerAccountBinding',v_binding,
      'sellerAccountKeyHash',case
        when v_credential.seller_account_key ~ '^[a-f0-9]{64}$'
          then v_credential.seller_account_key
        else null
      end,
      'environment',v_credential.environment
    ),
    'observationState',case
      when v_evidence.id is null then 'no_evidence'
      when v_evidence.valid_until <= v_now then 'expired'
      else 'current'
    end,
    'evidence',case when v_evidence.id is null then null else jsonb_build_object(
      'contract','sellerpilot-qoo10-review-chat-durable-observation/1',
      'source','sellerpilot_private.qoo10_review_chat_observations',
      'sourceRevision',v_evidence.source_revision,
      'sourceRevisionSha256',v_evidence.observation_sha256,
      'sourceArtifactId',v_evidence.source_artifact_id,
      'sourceArtifactSha256',v_evidence.source_artifact_sha256,
      'credentialId',v_evidence.credential_id,
      'sellerAccountKeyHash',v_evidence.seller_account_key,
      'environment',v_evidence.environment,
      'observedAt',v_evidence.observed_at,
      'validUntil',v_evidence.valid_until,
      'sellerDashboardVisible',v_evidence.seller_dashboard_visible,
      'buyerInquirySummaryVisible',v_evidence.buyer_inquiry_summary_visible,
      'reviewHistoryVisible',v_evidence.review_history_visible,
      'reviewNavigationResult',v_evidence.review_navigation_result,
      'review',jsonb_build_object(
        'historyState',v_evidence.review_history_state,
        'observedCount',v_evidence.review_observed_count,
        'importedCount',v_evidence.review_imported_count,
        'reconciledCount',v_evidence.review_reconciled_count
      ),
      'buyerChatHistoryVisible',false,
      'buyerChatNavigationResult','unavailable',
      'buyerChat',jsonb_build_object(
        'historyState','unknown',
        'observedCount',null,
        'importedCount',0,
        'reconciledCount',0
      )
    ) end
  );
end;
$$;

create function public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
  p_credential_id uuid,
  p_source_revision bigint,
  p_source_artifact jsonb,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing sellerpilot_private.qoo10_review_chat_observations%rowtype;
  v_latest_revision bigint;
  v_observed_at timestamptz;
  v_valid_until timestamptz;
  v_review jsonb;
  v_buyer_chat jsonb;
  v_canonical jsonb;
  v_observation_sha text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'QOO10_REVIEW_CHAT_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_source_revision is null or p_source_revision < 1 then
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_REVISION_INVALID';
  end if;
  if jsonb_typeof(p_source_artifact) is distinct from 'object'
      or not p_source_artifact ?& array[
        'contract','sourceKind','artifactId','sha256'
      ]
      or p_source_artifact - array[
        'contract','sourceKind','artifactId','sha256'
      ] <> '{}'::jsonb
      or p_source_artifact->>'contract' is distinct from
        'sellerpilot-qoo10-review-chat-source-artifact/1'
      or p_source_artifact->>'sourceKind' is distinct from
        'authenticated_qsm_seller_ui'
      or length(coalesce(p_source_artifact->>'artifactId','')) not between 8 and 240
      or coalesce(p_source_artifact->>'artifactId','')
        !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$'
      or coalesce(p_source_artifact->>'sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_ARTIFACT_INVALID';
  end if;
  if jsonb_typeof(p_observation) is distinct from 'object'
      or not p_observation ?& array[
        'contract','observedAt','validUntil','sellerDashboardVisible',
        'buyerInquirySummaryVisible','reviewHistoryVisible',
        'reviewNavigationResult','review','buyerChatHistoryVisible',
        'buyerChatNavigationResult','buyerChat'
      ]
      or p_observation - array[
        'contract','observedAt','validUntil','sellerDashboardVisible',
        'buyerInquirySummaryVisible','reviewHistoryVisible',
        'reviewNavigationResult','review','buyerChatHistoryVisible',
        'buyerChatNavigationResult','buyerChat'
      ] <> '{}'::jsonb
      or p_observation->>'contract' is distinct from
        'sellerpilot-qoo10-review-chat-recording/1'
      or jsonb_typeof(p_observation->'sellerDashboardVisible') <> 'boolean'
      or jsonb_typeof(p_observation->'buyerInquirySummaryVisible') <> 'boolean'
      or jsonb_typeof(p_observation->'reviewHistoryVisible') <> 'boolean'
      or coalesce(p_observation->>'reviewNavigationResult','') not in (
        'history_visible','redirected_to_login','unavailable'
      )
      or jsonb_typeof(p_observation->'buyerChatHistoryVisible') <> 'boolean'
      or p_observation->'buyerChatHistoryVisible' <> 'false'::jsonb
      or p_observation->>'buyerChatNavigationResult' is distinct from
        'unavailable' then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_INVALID';
  end if;

  begin
    v_observed_at := (p_observation->>'observedAt')::timestamptz;
    v_valid_until := (p_observation->>'validUntil')::timestamptz;
  exception when others then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_TIME_INVALID';
  end;
  if v_observed_at > v_now + interval '60 seconds'
      or v_valid_until <= v_observed_at
      or v_valid_until > v_observed_at + interval '15 minutes' then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_TIME_INVALID';
  end if;

  v_review := p_observation->'review';
  if jsonb_typeof(v_review) is distinct from 'object'
      or not v_review ?& array[
        'historyState','observedCount','importedCount','reconciledCount'
      ]
      or v_review - array[
        'historyState','observedCount','importedCount','reconciledCount'
      ] <> '{}'::jsonb
      or (
        v_review->>'historyState' = 'unknown'
        and not (
          v_review->'observedCount' = 'null'::jsonb
          and v_review->'importedCount' = '0'::jsonb
          and v_review->'reconciledCount' = '0'::jsonb
        )
      )
      or (
        v_review->>'historyState' = 'verified_zero'
        and not (
          p_observation->'reviewHistoryVisible' = 'true'::jsonb
          and p_observation->>'reviewNavigationResult' = 'history_visible'
          and v_review->'observedCount' = '0'::jsonb
          and v_review->'importedCount' = '0'::jsonb
          and v_review->'reconciledCount' = '0'::jsonb
        )
      )
      or coalesce(v_review->>'historyState','') not in (
        'unknown','verified_zero'
      ) then
    raise exception 'QOO10_REVIEW_CHAT_REVIEW_OBSERVATION_INVALID';
  end if;

  v_buyer_chat := p_observation->'buyerChat';
  if jsonb_typeof(v_buyer_chat) is distinct from 'object'
      or not v_buyer_chat ?& array[
        'historyState','observedCount','importedCount','reconciledCount'
      ]
      or v_buyer_chat - array[
        'historyState','observedCount','importedCount','reconciledCount'
      ] <> '{}'::jsonb
      or v_buyer_chat <> jsonb_build_object(
        'historyState','unknown','observedCount',null,
        'importedCount',0,'reconciledCount',0
      ) then
    raise exception 'QOO10_BUYER_CHAT_OBSERVATION_UNVERIFIED';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    raise exception 'QOO10_REVIEW_CHAT_CREDENTIAL_BINDING_INVALID'
      using errcode = '42501';
  end if;

  v_canonical := jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-durable-observation/1',
    'ownerId',v_credential.created_by,
    'credentialId',v_credential.id,
    'credentialVersion',v_credential.version,
    'environment',v_credential.environment,
    'sellerAccountKeyHash',v_credential.seller_account_key,
    'sourceRevision',p_source_revision,
    'sourceArtifact',p_source_artifact,
    'observation',p_observation
  );
  v_observation_sha := encode(
    extensions.digest(v_canonical::text,'sha256'),'hex'
  );

  select evidence.* into v_existing
    from sellerpilot_private.qoo10_review_chat_observations evidence
   where evidence.credential_id = v_credential.id
     and evidence.source_revision = p_source_revision;
  if found then
    if v_existing.observation_sha256 = v_observation_sha
        and v_existing.source_artifact_id = p_source_artifact->>'artifactId'
        and v_existing.source_artifact_sha256 = p_source_artifact->>'sha256' then
      return jsonb_build_object(
        'contract','sellerpilot-qoo10-review-chat-recording-result/1',
        'status','already_recorded',
        'credentialId',v_credential.id,
        'sourceRevision',p_source_revision,
        'observationSha256',v_observation_sha,
        'permissionsGranted',false
      );
    end if;
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_REVISION_IMMUTABLE'
      using errcode = '55000';
  end if;

  select max(evidence.source_revision) into v_latest_revision
    from sellerpilot_private.qoo10_review_chat_observations evidence
   where evidence.credential_id = v_credential.id;
  if p_source_revision <> coalesce(v_latest_revision,0) + 1 then
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_REVISION_SEQUENCE_INVALID';
  end if;

  insert into sellerpilot_private.qoo10_review_chat_observations (
    owner_id,credential_id,environment,seller_account_key,credential_version,
    source_revision,source_artifact_id,source_artifact_sha256,
    observation_sha256,observed_at,valid_until,seller_dashboard_visible,
    buyer_inquiry_summary_visible,review_history_visible,
    review_navigation_result,review_history_state,review_observed_count,
    review_imported_count,review_reconciled_count
  ) values (
    v_credential.created_by,v_credential.id,v_credential.environment,
    v_credential.seller_account_key,v_credential.version,p_source_revision,
    p_source_artifact->>'artifactId',p_source_artifact->>'sha256',
    v_observation_sha,v_observed_at,v_valid_until,
    (p_observation->>'sellerDashboardVisible')::boolean,
    (p_observation->>'buyerInquirySummaryVisible')::boolean,
    (p_observation->>'reviewHistoryVisible')::boolean,
    p_observation->>'reviewNavigationResult',
    v_review->>'historyState',
    case when v_review->'observedCount' = 'null'::jsonb
      then null else (v_review->>'observedCount')::integer end,
    0,0
  );

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-recording-result/1',
    'status','recorded',
    'credentialId',v_credential.id,
    'sourceRevision',p_source_revision,
    'observationSha256',v_observation_sha,
    'permissionsGranted',false
  );
end;
$$;

revoke all on function public.sellerpilot_read_qoo10_review_chat_accounts_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_qoo10_review_chat_accounts_v1()
  to authenticated;
revoke all on function
  public.sellerpilot_read_qoo10_review_chat_observation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_read_qoo10_review_chat_observation_v1(uuid)
  to authenticated;
revoke all on function
  public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
    uuid,bigint,jsonb,jsonb
  )
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
    uuid,bigint,jsonb,jsonb
  )
  to service_role;

comment on table sellerpilot_private.qoo10_review_chat_observations is
  'Immutable credential, seller-account and environment-bound QSM observation ledger. It grants no review import, Buyer Chat, or reply permission.';
comment on function
  public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
    uuid,bigint,jsonb,jsonb
  ) is
  'Service-role-only append boundary. Caller owner, seller and environment claims are never accepted; Buyer Chat and import completion claims are rejected.';

notify pgrst,'reload schema';

-- Reviewed source: 20260910050000_cs_qoo10_source_capability_status.sql
-- Source SHA256: d99b8fdb33e95cc5c1643e30b6800435a03483f568edb31264817165de9568ca
-- Read-only, fail-closed source-capability projection. This does not add a
-- provider endpoint or customer mutation; it projects the already canonical
-- GetInquiryMessage history for one attested Qoo10 seller account.
do $preimage$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
      or to_regclass('sellerpilot_private.support_tickets') is null
      or to_regclass('sellerpilot_private.support_inbound_messages') is null
      or to_regclass('sellerpilot_private.qoo10_history_windows') is null
      or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'QOO10_SOURCE_CAPABILITY_PREIMAGE_MISSING';
  end if;
  if to_regprocedure(
    'public.sellerpilot_read_qoo10_inquiry_source_v1(uuid)'
  ) is not null then
    raise exception 'QOO10_SOURCE_CAPABILITY_ALREADY_APPLIED';
  end if;
end
$preimage$;

create index qoo10_support_tickets_account_source_idx
  on sellerpilot_private.support_tickets(
    owner_id,seller_account_key,received_at desc,id
  )
  where channel_key='qoo10' and not demo
    and ticket_kind='conversation'
    and external_ticket_id ~ '^qoo10:conversation:[a-f0-9]{64}$';

create function public.sellerpilot_read_qoo10_inquiry_source_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_scope_state text := 'identity_unverified';
  v_ticket_count integer := 0;
  v_inbound_count integer := 0;
  v_waiting_count integer := 0;
  v_answered_count integer := 0;
  v_closed_count integer := 0;
  v_unknown_count integer := 0;
  v_last_received_at timestamptz;
  v_window_count integer := 0;
  v_queued_count integer := 0;
  v_complete_count integer := 0;
  v_refining_count integer := 0;
  v_gap_count integer := 0;
  v_verified_zero_count integer := 0;
  v_positive_complete_count integer := 0;
  v_earliest_date date;
  v_latest_date date;
  v_last_window_at timestamptz;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='qoo10'
     and credential.environment='production';
  if not found then
    raise exception 'QOO10_SOURCE_CAPABILITY_ACCOUNT_SELECTION_INVALID'
      using errcode='22023';
  end if;

  if v_credential.seller_account_key ~ '^[a-f0-9]{64}$'
      and v_credential.seller_account_key_source in (
        'provider_certified_v1','credential_incarnation_v1'
      )
      and v_credential.seller_account_verified_at is not null then
    v_scope_state := case
      when v_credential.status='active'
        and (v_credential.expires_at is null or v_credential.expires_at>v_now)
        then 'account_scoped'
      else 'credential_unavailable'
    end;

    if v_scope_state='account_scoped' then
    select count(*)::integer,
           count(*) filter (where ticket.provider_status='waiting')::integer,
           count(*) filter (where ticket.provider_status='answered')::integer,
           count(*) filter (where ticket.provider_status='closed')::integer,
           count(*) filter (where ticket.provider_status='unknown')::integer
      into v_ticket_count,v_waiting_count,v_answered_count,
           v_closed_count,v_unknown_count
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id=v_credential.created_by
       and ticket.channel_key='qoo10'
       and ticket.seller_account_key=v_credential.seller_account_key
       and ticket.ticket_kind='conversation'
       and ticket.external_ticket_id ~ '^qoo10:conversation:[a-f0-9]{64}$'
       and not ticket.demo;

    select count(*)::integer,max(message.received_at)
      into v_inbound_count,v_last_received_at
      from sellerpilot_private.support_inbound_messages message
      join sellerpilot_private.support_tickets ticket on ticket.id=message.ticket_id
     where ticket.owner_id=v_credential.created_by
       and ticket.channel_key='qoo10'
       and ticket.seller_account_key=v_credential.seller_account_key
       and ticket.ticket_kind='conversation'
       and ticket.external_ticket_id ~ '^qoo10:conversation:[a-f0-9]{64}$'
       and not ticket.demo
       and message.owner_id=ticket.owner_id
       and message.channel_key='qoo10'
       and message.sender_role='customer';

    select count(*)::integer,
           count(*) filter (where history_window.completion_state='queued')::integer,
           count(*) filter (where history_window.completion_state='complete')::integer,
           count(*) filter (where history_window.completion_state='refining')::integer,
           count(*) filter (where history_window.completion_state='gap')::integer,
           count(*) filter (
             where history_window.completion_state='complete'
               and history_window.completion_reason in (
                 'provider_success_empty','provider_total_reconciled'
               )
               and history_window.provider_status between 200 and 299
               and history_window.provider_row_count=0
           )::integer,
           count(*) filter (
             where history_window.completion_state='complete'
               and history_window.provider_status between 200 and 299
               and history_window.provider_row_count>0
           )::integer,
           min(history_window.calendar_date),max(history_window.calendar_date),
           max(history_window.updated_at)
      into v_window_count,v_queued_count,v_complete_count,v_refining_count,
           v_gap_count,v_verified_zero_count,v_positive_complete_count,
           v_earliest_date,v_latest_date,v_last_window_at
      from sellerpilot_private.qoo10_history_windows history_window
      join sellerpilot_private.channel_credentials source_credential
        on source_credential.id=history_window.credential_id
     where source_credential.created_by=v_credential.created_by
       and source_credential.channel='qoo10'
       and source_credential.environment=v_credential.environment
       and source_credential.seller_account_key=v_credential.seller_account_key
       and source_credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
       and source_credential.seller_account_verified_at is not null
       and history_window.source='qapi_inquiry';
    end if;
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-inquiry-source-read/1',
    'checkedAt',v_now,
    'credentialId',v_credential.id,
    'sellerAccountKeyHash',case when v_scope_state<>'identity_unverified'
      then v_credential.seller_account_key else null end,
    'environment',v_credential.environment,
    'scopeState',v_scope_state,
    'canonical',jsonb_build_object(
      'ticketCount',v_ticket_count,
      'inboundMessageCount',v_inbound_count,
      'waitingTicketCount',v_waiting_count,
      'answeredTicketCount',v_answered_count,
      'closedTicketCount',v_closed_count,
      'unknownTicketCount',v_unknown_count,
      'lastReceivedAt',v_last_received_at
    ),
    'history',jsonb_build_object(
      'windowCount',v_window_count,
      'queuedWindowCount',v_queued_count,
      'completeWindowCount',v_complete_count,
      'refiningWindowCount',v_refining_count,
      'gapWindowCount',v_gap_count,
      'verifiedZeroWindowCount',v_verified_zero_count,
      'positiveCompleteWindowCount',v_positive_complete_count,
      'earliestCalendarDate',v_earliest_date,
      'latestCalendarDate',v_latest_date,
      'lastUpdatedAt',v_last_window_at
    )
  );
end
$$;

revoke all on function public.sellerpilot_read_qoo10_inquiry_source_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_qoo10_inquiry_source_v1(uuid)
  to authenticated;


commit;
