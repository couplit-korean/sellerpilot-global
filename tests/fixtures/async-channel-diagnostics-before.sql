CREATE OR REPLACE FUNCTION public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text, p_response_payload jsonb DEFAULT NULL::jsonb, p_error_message text DEFAULT NULL::text, p_credential_refresh jsonb DEFAULT NULL::jsonb, p_normalized_orders jsonb DEFAULT NULL::jsonb, p_normalized_inquiries jsonb DEFAULT NULL::jsonb, p_diagnostic jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job record;
  v_preparation jsonb;
  v_preparation_status text;
  v_effective_credential_id uuid;
  v_refresh_payload jsonb;
  v_refresh_expires_at timestamptz;
  v_refresh_recovery_only boolean;
  v_refresh_oauth_complete boolean;
  v_result_ok boolean;
  v_sync_error text;
  v_completed boolean;
  v_continuation jsonb;
  v_continuation_arguments jsonb;
  v_continuation_depth integer;
  v_continuation_job_id uuid;
  v_completion_fingerprint text;
  v_receipt record;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_status not in ('succeeded', 'failed', 'reconciliation_required')
     or p_job_id is null
     or p_claim_token is null
     or not sellerpilot_private.worker_token_may_complete_gateway_job(
       p_token_hash,
       p_job_id,
       p_claim_token
     )
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) <> 'object'
       or octet_length(p_response_payload::text) > 1000000
     ))
     or (p_credential_refresh is not null and (
       jsonb_typeof(p_credential_refresh) <> 'object'
       or octet_length(p_credential_refresh::text) > 40000
     ))
     or (p_diagnostic is not null and (
       jsonb_typeof(p_diagnostic) <> 'object'
       or octet_length(p_diagnostic::text) > 4000
     )) then
    raise exception 'invalid atomic gateway completion';
  end if;

  v_completion_fingerprint := sellerpilot_private.gateway_completion_fingerprint(
    p_status,
    p_response_payload,
    p_error_message,
    p_credential_refresh,
    p_normalized_orders,
    p_normalized_inquiries,
    p_diagnostic
  );
  select receipt.completion_fingerprint, receipt.continuation_job_id
    into v_receipt
    from sellerpilot_private.gateway_completion_receipts receipt
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = receipt.worker_token_id
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token
     and worker_token.token_hash = p_token_hash
     and worker_token.scope in ('gateway', 'legacy_combined', 'serverless_cs')
     and worker_token.status = 'active'
     and worker_token.expires_at > clock_timestamp();
  if found then
    if v_receipt.completion_fingerprint <> v_completion_fingerprint then
      if exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
         where job.id = p_job_id
           and job.status <> 'running'
      ) then
        return jsonb_build_object(
          'status', 'completed',
          'replayed', true,
          'continuationJobId', v_receipt.continuation_job_id
        );
      end if;
      raise exception 'gateway completion replay mismatch' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'status', 'completed',
      'replayed', true,
      'continuationJobId', v_receipt.continuation_job_id
    );
  end if;

  select
    job.id,
    job.channel,
    job.operation,
    job.credential_id,
    job.status,
    job.worker_token_id,
    job.claim_token,
    job.lease_expires_at
  into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and worker_token.token_hash = p_token_hash
     and worker_token.scope in ('gateway', 'legacy_combined', 'serverless_cs')
     and worker_token.status = 'active'
     and worker_token.expires_at > clock_timestamp()
   for update of job;
  if not found then
    return jsonb_build_object('status', 'ownership_lost');
  end if;

  if p_response_payload is not null and (
    coalesce(p_response_payload->>'channel', '') <> v_job.channel
    or coalesce(p_response_payload->>'operation', '') <> v_job.operation
  ) then
    raise exception 'gateway response does not match claimed job';
  end if;
  if p_status = 'succeeded' and (
    p_response_payload is null
    or jsonb_typeof(p_response_payload->'ok') <> 'boolean'
  ) then
    raise exception 'successful gateway completion requires a result';
  end if;

  v_effective_credential_id := v_job.credential_id;
  if p_credential_refresh is not null then
    if v_job.channel not in ('shopee', 'lazada', 'ebay')
       or jsonb_typeof(p_credential_refresh->'payload') <> 'object' then
      raise exception 'credential refresh does not match claimed job';
    end if;
    v_refresh_payload := p_credential_refresh->'payload';
    begin
      v_refresh_expires_at := nullif(
        trim(coalesce(p_credential_refresh->>'expiresAt', '')),
        ''
      )::timestamptz;
    exception when others then
      raise exception 'invalid credential refresh expiry';
    end;
    v_refresh_recovery_only := coalesce(
      (p_credential_refresh->>'recoveryOnly')::boolean,
      false
    );
    v_refresh_oauth_complete := coalesce(
      (p_credential_refresh->>'oauthComplete')::boolean,
      false
    );

    v_preparation := public.sellerpilot_service_prepare_gateway_credential_refresh(
      p_token_hash,
      p_job_id,
      p_claim_token,
      v_refresh_payload,
      v_refresh_expires_at,
      v_refresh_recovery_only,
      v_refresh_oauth_complete
    );
    v_preparation_status := coalesce(v_preparation->>'status', '');
    if v_preparation_status = 'prepared'
       and coalesce(v_preparation->>'credential_id', '')
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      v_effective_credential_id := (v_preparation->>'credential_id')::uuid;
      if v_refresh_oauth_complete
         and coalesce((v_preparation->>'oauth_complete')::boolean, false) is not true then
        raise exception 'oauth credential refresh was not finalized';
      end if;
    elsif v_preparation_status = 'recovery_preserved'
          and v_refresh_recovery_only
          and p_status = 'reconciliation_required' then
      null;
    else
      raise exception 'credential refresh preparation rejected';
    end if;
  end if;

  if p_status = 'succeeded' then
    v_result_ok := coalesce((p_response_payload->>'ok')::boolean, false);
    v_sync_error := left(coalesce(
      nullif(trim(p_response_payload->>'safeMessage'), ''),
      '판매채널 조회 결과를 운영 원장에 반영하지 못했습니다.'
    ), 500);

    if v_job.operation = 'diagnostic.test'
       and p_credential_refresh is not null then
      if p_diagnostic is null
         or coalesce(p_diagnostic->>'status', '') not in ('passed', 'failed', 'manual') then
        raise exception 'invalid refreshed credential diagnostic';
      end if;
      perform public.sellerpilot_record_credential_test(
        v_effective_credential_id,
        p_diagnostic->>'status',
        left(coalesce(p_diagnostic->>'message', ''), 500)
      );
    end if;

    if v_job.operation = 'orders.list' then
      if v_result_ok then
        if jsonb_typeof(p_normalized_orders) <> 'array' then
          raise exception 'normalized order payload required';
        end if;
        perform public.sellerpilot_service_ingest_orders(
          v_effective_credential_id,
          v_job.channel,
          p_normalized_orders
        );
      else
        perform public.sellerpilot_service_mark_channel_sync(
          v_effective_credential_id,
          v_job.channel,
          'orders',
          'failed',
          v_sync_error
        );
      end if;
    elsif v_job.operation = 'inquiries.list' then
      if v_result_ok then
        if jsonb_typeof(p_normalized_inquiries) <> 'array' then
          raise exception 'normalized inquiry payload required';
        end if;
        perform public.sellerpilot_service_ingest_inquiries(
          v_effective_credential_id,
          v_job.channel,
          p_normalized_inquiries
        );
        if v_job.channel = 'lazada' then
          perform public.sellerpilot_service_record_lazada_im_bootstrap_result(
            p_job_id,
            v_effective_credential_id,
            true
          );
        end if;
      else
        if v_job.channel = 'lazada' then
          perform public.sellerpilot_service_record_lazada_im_bootstrap_result(
            p_job_id,
            v_effective_credential_id,
            false
          );
        end if;
        perform public.sellerpilot_service_mark_channel_sync(
          v_effective_credential_id,
          v_job.channel,
          'inquiries',
          'failed',
          v_sync_error
        );
      end if;
    end if;
  elsif v_job.operation in ('orders.list', 'inquiries.list') then
    if v_job.channel = 'lazada' and v_job.operation = 'inquiries.list' then
      perform public.sellerpilot_service_record_lazada_im_bootstrap_result(
        p_job_id,
        v_effective_credential_id,
        false
      );
    end if;
    perform public.sellerpilot_service_mark_channel_sync(
      v_effective_credential_id,
      v_job.channel,
      case when v_job.operation = 'orders.list' then 'orders' else 'inquiries' end,
      'failed',
      left(coalesce(nullif(trim(p_error_message), ''), '채널 작업이 완료되지 못했습니다.'), 500)
    );
  end if;

  v_continuation := p_response_payload->'continuation';
  if v_continuation is not null then
    if p_status <> 'succeeded'
       or v_job.operation not in ('orders.list', 'inquiries.list')
       or v_result_ok is not true
       or jsonb_typeof(v_continuation) <> 'object'
       or v_continuation->>'reason' <> 'page_cap_reached'
       or jsonb_typeof(v_continuation->'arguments') <> 'object'
       or octet_length((v_continuation->'arguments')::text) > 64000
       or coalesce(v_continuation->'arguments'->>'sellerpilotPaginationDepth', '') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid gateway pagination continuation';
    end if;
    v_continuation_arguments := v_continuation->'arguments';
    v_continuation_depth := (v_continuation_arguments->>'sellerpilotPaginationDepth')::integer;
    if v_continuation_depth not between 1 and 50 then
      raise exception 'invalid gateway pagination continuation depth';
    end if;

    insert into sellerpilot_private.channel_gateway_jobs (
      id,
      credential_id,
      attempt_id,
      channel,
      operation,
      environment,
      request_payload,
      created_by
    ) values (
      gen_random_uuid(),
      v_effective_credential_id,
      null,
      v_job.channel,
      v_job.operation,
      (
        select credential.environment
          from sellerpilot_private.channel_credentials credential
         where credential.id = v_effective_credential_id
      ),
      jsonb_build_object(
        'arguments', v_continuation_arguments,
        'periodicKey', format(
          'continuation:%s:%s',
          p_job_id,
          v_continuation_depth
        ),
        'continuationOf', p_job_id
      ),
      (
        select credential.created_by
          from sellerpilot_private.channel_credentials credential
         where credential.id = v_effective_credential_id
      )
    )
    on conflict do nothing
    returning id into v_continuation_job_id;

    if v_continuation_job_id is null then
      select followup.id into v_continuation_job_id
        from sellerpilot_private.channel_gateway_jobs followup
       where followup.request_payload->>'continuationOf' = p_job_id::text
       limit 1;
    end if;
    if v_continuation_job_id is null then
      raise exception 'gateway pagination continuation was not queued';
    end if;
    perform public.sellerpilot_service_mark_channel_sync(
      v_effective_credential_id,
      v_job.channel,
      case when v_job.operation = 'orders.list' then 'orders' else 'inquiries' end,
      'queued',
      null
    );
  end if;

  v_completed := public.sellerpilot_complete_channel_gateway_job(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_status,
    p_response_payload,
    case when p_status = 'succeeded' then null else p_error_message end
  );
  if v_completed is not true then
    raise exception 'gateway completion claim changed' using errcode = '40001';
  end if;

  insert into sellerpilot_private.gateway_completion_receipts (
    job_id,
    claim_token,
    worker_token_id,
    completion_fingerprint,
    continuation_job_id
  ) values (
    p_job_id,
    p_claim_token,
    v_job.worker_token_id,
    v_completion_fingerprint,
    v_continuation_job_id
  );

  return jsonb_build_object(
    'status', 'completed',
    'credentialId', v_effective_credential_id,
    'continuationJobId', v_continuation_job_id
  );
end;
$function$
