CREATE OR REPLACE FUNCTION public.sellerpilot_service_gateway_completion_context(p_token_hash text, p_job_id uuid, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  capture
    sellerpilot_private.coupang_exact_live_invalid_completion_captures%rowtype;
begin
  result :=
    public.sellerpilot_gateway_completion_context_before_coupang_exact_invalid_capture(
      p_token_hash,
      p_job_id,
      p_claim_token
    );
  if result is not null then return result; end if;

  select * into capture
    from sellerpilot_private.coupang_exact_live_invalid_completion_captures
   where verifier_job_id = p_job_id
     and claim_token = p_claim_token;
  if capture.verifier_job_id is null then return null; end if;

  select job_row.* into job
    from sellerpilot_private.channel_gateway_jobs job_row
    join sellerpilot_private.ai_cli_worker_tokens worker
      on worker.id = capture.worker_token_id
     and worker.token_hash = p_token_hash
     and worker.scope in ('gateway', 'legacy_combined')
     and worker.status = 'active'
     and worker.expires_at > clock_timestamp()
   where job_row.id = capture.verifier_job_id
     and job_row.status = 'reconciliation_required'
     and job_row.response_payload = capture.response_payload
     and encode(
       extensions.digest(job_row.response_payload::text, 'sha256'),
       'hex'
     ) = capture.response_sha256
     and encode(
       extensions.digest(to_jsonb(job_row)::text, 'sha256'),
       'hex'
     ) = capture.completed_job_sha256
     and job_row.worker_token_id is null
     and job_row.claim_token is null
     and job_row.lease_expires_at is null
     and job_row.provider_mutation_started_at is null
     and job_row.oauth_provider_call_started_at is null
     and job_row.write_resource_kind is null
     and job_row.write_resource_key is null
     and not exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = job_row.id
     )
     and not exists (
       select 1
         from sellerpilot_private.coupang_exact_live_verify_receipts receipt
        where receipt.verifier_job_id = job_row.id
     );
  if job.id is null then return null; end if;

  return jsonb_build_object(
    'id', job.id,
    'credential_id', job.credential_id,
    'attempt_id', job.attempt_id,
    'listing_id', job.listing_id,
    'channel', job.channel,
    'operation', job.operation,
    'status', 'completed_replay',
    'normalization_timestamp', coalesce(job.started_at, job.created_at),
    'publication_verification_boundary',
      job.started_at,
    'updated_at', job.updated_at
  );
end
$function$
