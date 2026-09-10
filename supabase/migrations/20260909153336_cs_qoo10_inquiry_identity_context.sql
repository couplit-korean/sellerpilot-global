-- Private integration-sandbox review draft; central assigns final version.
begin;

create function public.sellerpilot_service_qoo10_inquiry_identity_context_v1(
  p_token_hash text, p_job_id uuid, p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_is_replay boolean := false;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.channel = 'qoo10'
     and job.operation = 'inquiries.list'
     and exists (
       select 1 from sellerpilot_private.ai_cli_worker_tokens token
        where token.token_hash = p_token_hash
          and token.scope in ('gateway','serverless_cs','legacy_combined')
          and (
            (token.status = 'active' and token.expires_at > v_now
              and job.status = 'running' and job.worker_token_id = token.id
              and job.claim_token = p_claim_token and job.lease_expires_at > v_now)
            or exists (
              select 1 from sellerpilot_private.gateway_completion_receipts receipt
               where receipt.job_id = job.id
                 and receipt.claim_token = p_claim_token
                 and receipt.worker_token_id = token.id
            )
          )
     );
  if not found then
    raise exception 'QOO10_INQUIRY_IDENTITY_CONTEXT_RECEIPT_REQUIRED' using errcode = '42501';
  end if;

  select exists (
    select 1
      from sellerpilot_private.gateway_completion_receipts receipt
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = receipt.worker_token_id
     where receipt.job_id = v_job.id
       and receipt.claim_token = p_claim_token
       and token.token_hash = p_token_hash
       and token.scope in ('gateway','serverless_cs','legacy_combined')
  ) into v_is_replay;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.channel = 'qoo10'
     and credential.environment = v_job.environment
     and credential.created_by = v_job.created_by
     and credential.seller_account_key is not distinct from v_job.seller_account_key
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
     and (
       v_is_replay
       or (credential.status = 'active'
         and (credential.expires_at is null or credential.expires_at > v_now))
     );
  if not found then
    raise exception 'QOO10_INQUIRY_ACCOUNT_LINEAGE_UNATTESTED' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-inquiry-identity-context/1',
    'ownerId',v_credential.created_by,
    'sellerAccountKey',v_credential.seller_account_key,
    'environment',v_credential.environment,
    'sourceCredentialId',v_credential.id
  );
end
$$;

revoke all on function public.sellerpilot_service_qoo10_inquiry_identity_context_v1(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_qoo10_inquiry_identity_context_v1(text,uuid,uuid)
  to service_role;

commit;
