begin;

alter function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) rename to sellerpilot_091105_serverless_cs_context_before_temu_binding;

revoke all on function public.sellerpilot_091105_serverless_cs_context_before_temu_binding(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_serverless_cs_completion_context(
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
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_blocker text;
begin
  v_context := public.sellerpilot_091105_serverless_cs_context_before_temu_binding(
    p_token_hash, p_job_id, p_claim_token
  );
  if v_context is null
      or v_context->>'channel' <> 'temu'
      or v_context->>'operation' <> 'inquiries.list'
      or v_context->>'status' not in ('running', 'completed_replay') then
    return v_context;
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.credential_id = (v_context->>'credential_id')::uuid
     and job.channel = 'temu'
     and job.operation = 'inquiries.list';
  if not found then
    v_blocker := 'TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
  else
    select credential.* into v_credential
      from sellerpilot_private.channel_credentials credential
     where credential.id = v_job.credential_id
       and credential.channel = v_job.channel
       and credential.environment = v_job.environment;
    if not found
        or v_job.created_by is null
        or v_credential.created_by is null
        or v_job.created_by <> v_credential.created_by then
      v_blocker := 'TEMU_JOB_CREDENTIAL_OWNER_MISMATCH';
    elsif coalesce(v_job.seller_account_key, '') !~ '^[a-f0-9]{64}$'
        or v_job.seller_account_key is distinct from v_credential.seller_account_key then
      v_blocker := 'TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
    elsif v_credential.seller_account_key_source is distinct from 'provider_certified_v1'
        or v_credential.seller_account_verified_at is null then
      v_blocker := 'TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
    end if;
  end if;

  return v_context || jsonb_build_object(
    'credential_binding_context',
    case when v_blocker is not null then jsonb_build_object(
      'contract', 'sellerpilot-cs-credential-context/1',
      'status', 'blocked',
      'blocker', v_blocker,
      'workerIdentityCompared', false
    ) else jsonb_build_object(
      'contract', 'sellerpilot-cs-credential-context/1',
      'status', 'verified',
      'credentialId', v_credential.id,
      'sellerAccountKey', v_credential.seller_account_key,
      'sellerAccountKeySource', v_credential.seller_account_key_source,
      'sellerAccountVerifiedAt', v_credential.seller_account_verified_at,
      'ownerBinding', 'job_credential_same_owner',
      'workerIdentityCompared', false
    ) end
  );
end;
$$;

revoke all on function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) to service_role;

do $verify$
declare
  v_signature regprocedure := to_regprocedure(
    'public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)'
  );
begin
  if not exists (
    select 1
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=""']::text[]
       and pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(procedure.oid),
         '''workerIdentityCompared'', false'
       ) > 0
       and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'TEMU_CS_BINDING_CONTEXT_POSTIMAGE_INVALID';
  end if;
end
$verify$;

comment on function public.sellerpilot_service_serverless_cs_completion_context(
  text, uuid, uuid
) is
  'Returns owned serverless CS completion context plus Temu job-to-credential seller binding evidence; shared worker administrator identity is not treated as seller identity.';

commit;
