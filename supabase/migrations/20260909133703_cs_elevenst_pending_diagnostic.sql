-- channel: elevenst
-- assignment: CS-elevenst-CONT-09
-- Proposal only. Apply after the accepted CONT-08 credential lifecycle and the
-- centrally combined multi-account active-index migration.
--
-- This adds one read-only fixed-egress lane for a pending 11st credential. It
-- does not certify seller identity: ProductSearch only proves API-key access.

begin;

create unique index channel_gateway_jobs_one_elevenst_pending_diagnostic_idx
  on sellerpilot_private.channel_gateway_jobs (credential_id)
  where channel = 'elevenst'
    and operation = 'diagnostic.test'
    and status in ('queued','running')
    and request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true';

create function public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1(
  p_credential_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_job_id uuid := gen_random_uuid();
  v_existing uuid;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = 'pending'
     and claim.seller_account_key = credential.seller_account_key
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'pending'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
   for update of credential;
  if not found then
    raise exception 'ELEVENST_PENDING_CREDENTIAL_REQUIRED';
  end if;
  select job.id into v_existing
    from sellerpilot_private.channel_gateway_jobs job
   where job.credential_id = v_credential.id
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and job.status in ('queued','running')
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true'
   order by job.created_at desc
   limit 1;
  if v_existing is not null then return v_existing; end if;
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,channel,operation,environment,
    request_payload,status,created_by
  ) values (
    v_job_id,v_credential.id,null,'elevenst','diagnostic.test',
    v_credential.environment,
    jsonb_build_object(
      'sellerpilotPendingCredentialDiagnosticV1',true,
      'identityEvidence','admin_claim_v1'
    ),
    'queued',v_credential.created_by
  );
  return v_job_id;
end;
$$;

create function public.sellerpilot_claim_elevenst_pending_diagnostic_v1(
  p_token_hash text,
  p_worker_version text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_result jsonb;
begin
  if not sellerpilot_private.worker_token_has_scope(
       p_token_hash,'gateway',true
     ) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if not found then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version),''),80)
   where token.id = v_token_id;
  -- Pending diagnostics are read-only and may safely reclaim a lost lease.
  -- A fresh claim token fences the previous worker; attempts remain bounded.
  update sellerpilot_private.channel_gateway_jobs job
    set status=case when attempt_count >= 3 then 'failed' else 'queued' end,
        worker_token_id=null, claim_token=null, lease_expires_at=null,
        completed_at=case when attempt_count >= 3 then clock_timestamp() else null end,
        error_message=case when attempt_count >= 3 then 'ELEVENST_PENDING_DIAGNOSTIC_ATTEMPTS_EXHAUSTED' else null end,
        updated_at=clock_timestamp()
    where (p_job_id is null or job.id=p_job_id)
      and job.channel='elevenst' and job.operation='diagnostic.test'
      and job.status='running' and job.lease_expires_at <= clock_timestamp()
      and job.provider_mutation_started_at is null
      and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1'='true';
  select job.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs job
   where (p_job_id is null or job.id = p_job_id)
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and job.status = 'queued'
     and job.attempt_count < 3
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true'
     and exists (
       select 1
         from sellerpilot_private.channel_credentials credential
         join sellerpilot_private.elevenst_credential_identity_claims claim
           on claim.credential_id = credential.id
          and claim.lifecycle_state = 'pending'
          and claim.seller_account_key = credential.seller_account_key
        where credential.id = job.credential_id
          and credential.channel = 'elevenst'
          and credential.status = 'pending'
          and (credential.expires_at is null
            or credential.expires_at > clock_timestamp())
     )
   order by job.created_at,job.id
   limit 1
   for update of job skip locked;
  if v_job_id is null then return null; end if;
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '3 minutes',
         started_at = coalesce(job.started_at,clock_timestamp()),
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and job.status = 'queued'
     and job.attempt_count < 3
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true';
  if not found then return null; end if;
  select jsonb_build_object(
    'id',job.id,
    'claim_token',job.claim_token,
    'credential_id',job.credential_id,
    'channel',job.channel,
    'operation',job.operation,
    'environment',job.environment,
    'request',job.request_payload,
    'credential',decrypted.decrypted_secret::jsonb,
    'attempt_count',job.attempt_count
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.status = 'pending'
     and credential.channel = 'elevenst'
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = 'pending'
     and claim.seller_account_key = credential.seller_account_key
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where job.id = v_job_id
     and job.claim_token = v_claim_token
     and job.worker_token_id = v_token_id
     and job.status = 'running';
  if v_result is null then
    raise exception 'ELEVENST_PENDING_DIAGNOSTIC_CLAIM_MISMATCH';
  end if;
  return v_result;
end;
$$;

create function public.sellerpilot_complete_elevenst_pending_diagnostic_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_diagnostic jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_status text := coalesce(p_diagnostic->>'status','');
  v_message text := trim(coalesce(p_diagnostic->>'message',''));
  v_response jsonb;
begin
  if jsonb_typeof(p_diagnostic) is distinct from 'object'
     or v_status not in ('passed','manual','failed')
     or length(v_message) not between 1 and 500
     or exists (
       select 1 from jsonb_object_keys(p_diagnostic) key
        where key <> all(array['status','message','remoteRequestId'])
     )
     or (p_diagnostic ? 'remoteRequestId'
       and length(coalesce(p_diagnostic->>'remoteRequestId','')) > 160) then
    raise exception 'ELEVENST_PENDING_DIAGNOSTIC_RESULT_INVALID';
  end if;
  if not sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true) then
    raise exception 'invalid worker token' using errcode='42501';
  end if;
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = 'elevenst'
     and credential.status in ('pending','active','grace','revoked','invalid')
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = credential.status
     and claim.seller_account_key = credential.seller_account_key
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and (job.status in ('succeeded','failed')
       or (job.status='running' and job.lease_expires_at > clock_timestamp() and credential.status='pending'))
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true'
   for update of job,credential,claim;
  if not found then
    raise exception 'ELEVENST_PENDING_DIAGNOSTIC_COMPLETION_MISMATCH';
  end if;
  if v_job.status in ('succeeded','failed') then
    if v_job.response_payload->'diagnostic' is distinct from p_diagnostic
       or v_job.response_payload->>'identityEvidence' is distinct from 'admin_claim_v1' then
      raise exception 'ELEVENST_PENDING_DIAGNOSTIC_REPLAY_MISMATCH';
    end if;
    return jsonb_build_object('status','completed','jobId',v_job.id,
      'credentialId',v_job.credential_id,'diagnosticStatus',v_status,
      'identityEvidence','admin_claim_v1');
  end if;
  v_response := jsonb_build_object(
    'ok',v_status <> 'failed',
    'channel','elevenst',
    'operation','diagnostic.test',
    'diagnostic',p_diagnostic,
    'safeMessage',v_message,
    'identityEvidence','admin_claim_v1'
  );
  update sellerpilot_private.channel_gateway_jobs job
     set status = case when v_status = 'failed' then 'failed' else 'succeeded' end,
         response_payload = v_response,
         error_message = case when v_status = 'failed' then v_message else null end,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = v_job.id;
  update sellerpilot_private.channel_credentials credential
     set last_checked_at = clock_timestamp(),
         last_check_status = v_status,
         last_check_message = v_message
   where credential.id = v_job.credential_id
     and credential.status = 'pending';
  insert into sellerpilot_private.credential_audit (
    credential_id,channel,environment,action,safe_detail
  ) values (
    v_job.credential_id,'elevenst',v_job.environment,'tested',jsonb_build_object(
      'status',v_status,'message',v_message,
      'jobId',v_job.id,'identityEvidence','admin_claim_v1'
    )
  );
  return jsonb_build_object(
    'status','completed','jobId',v_job.id,
    'credentialId',v_job.credential_id,'diagnosticStatus',v_status,
    'identityEvidence','admin_claim_v1'
  );
end;
$$;

revoke all on function public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1(uuid)
  from public,anon;
revoke all on function public.sellerpilot_claim_elevenst_pending_diagnostic_v1(text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_complete_elevenst_pending_diagnostic_v1(text,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1(uuid)
  to authenticated;
grant execute on function public.sellerpilot_claim_elevenst_pending_diagnostic_v1(text,text,uuid)
  to service_role;
grant execute on function public.sellerpilot_complete_elevenst_pending_diagnostic_v1(text,uuid,uuid,jsonb)
  to service_role;

commit;
