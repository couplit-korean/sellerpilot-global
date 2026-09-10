-- Private integration-sandbox review draft; central assigns final version.
-- Read-only S3 observations only. This migration never schedules inquiries.reply.
begin;

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

commit;
