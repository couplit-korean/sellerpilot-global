CREATE OR REPLACE FUNCTION sellerpilot_private.claim_local_channel_executor_read_job(p_token_hash text, p_worker_version text, p_release_sha text, p_egress_ip_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select j.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c
      on c.id = j.credential_id and c.status = 'active'
   where j.status = 'queued'
     and j.operation in ('diagnostic.test', 'inquiries.list')
     and j.environment = 'production'
     and sellerpilot_private.local_channel_executor_access(
           j.channel, j.operation) = 'read'
     and sellerpilot_private.local_channel_executor_job_allowed(
           j.id, c.id, v_token_id, p_worker_version,
           p_release_sha, p_egress_ip_sha256)
   order by case when j.operation = 'inquiries.list' then 0 else 1 end, j.created_at, j.id
   limit 1;
  if v_job_id is null then
    return null;
  end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.channel_gateway_jobs j
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = j.attempt_count + 1,
         lease_expires_at = now() + interval '15 minutes',
         started_at = coalesce(j.started_at, now()),
         error_message = null,
         updated_at = now()
   where j.id = v_job_id;

  select jsonb_build_object(
           'id', j.id,
           'claim_token', j.claim_token,
           'credential_id', j.credential_id,
           'channel', j.channel,
           'operation', j.operation,
           'environment', j.environment,
           'request', j.request_payload,
           'attempt_count', j.attempt_count,
           'credential', d.decrypted_secret::jsonb, 'seller_account_key', c.seller_account_key)
    into v_result
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where j.id = v_job_id
     and c.status = 'active';
  return v_result;
end
$function$
