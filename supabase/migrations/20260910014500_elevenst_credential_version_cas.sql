-- Bind 11st credential rotation and CREATE execution to the exact credential
-- incarnation without changing the shared rotation RPC or other channels.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regprocedure('public.sellerpilot_rotate_credential(text,text,jsonb,timestamp with time zone,integer,integer,integer)') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null
     or to_regprocedure('sellerpilot_private.worker_token_has_scope(text,text,boolean)') is null then
    raise exception 'ELEVENST_CREDENTIAL_VERSION_CAS_PREIMAGE_REQUIRED';
  end if;
  if to_regprocedure('public.sellerpilot_rotate_elevenst_credential_exact(uuid,integer,text,jsonb,timestamp with time zone,integer,integer,integer)') is not null
     or to_regprocedure('public.sellerpilot_service_elevenst_gateway_credential_version(text,uuid,uuid)') is not null
     or to_regprocedure('sellerpilot_private.guard_elevenst_gateway_credential_version()') is not null then
    raise exception 'ELEVENST_CREDENTIAL_VERSION_CAS_ALREADY_DEFINED';
  end if;
end $$;

create function public.sellerpilot_rotate_elevenst_credential_exact(
  p_expected_credential_id uuid,
  p_expected_version integer,
  p_environment text,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_rotation_interval_days integer default 90,
  p_warning_days integer default 30,
  p_grace_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_id uuid;
  v_active_version integer;
  v_rotated_id uuid;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_expected_credential_id is null
     or coalesce(p_expected_version, 0) < 1
     or p_environment is null
     or p_environment not in ('sandbox', 'production') then
    raise exception 'ELEVENST_CREDENTIAL_SOURCE_INVALID' using errcode = '22023';
  end if;

  -- This is the same lock key used by the shared rotation function. Holding it
  -- through the source check and delegated rotation closes the route read/RPC
  -- race without changing that function's signature for any other channel.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:elevenst:' || p_environment)
  );
  select credential.id, credential.version
    into v_active_id, v_active_version
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'elevenst'
     and credential.environment = p_environment
     and credential.status = 'active'
   for update;
  if not found
     or v_active_id is distinct from p_expected_credential_id
     or v_active_version is distinct from p_expected_version then
    raise exception 'ELEVENST_CREDENTIAL_SOURCE_STALE' using errcode = 'P0001';
  end if;

  v_rotated_id := public.sellerpilot_rotate_credential(
    'elevenst',
    p_environment,
    p_secret_payload,
    p_expires_at,
    p_rotation_interval_days,
    p_warning_days,
    p_grace_days
  );
  if v_rotated_id is null then
    raise exception 'ELEVENST_CREDENTIAL_ROTATION_RESULT_INVALID';
  end if;
  return v_rotated_id;
end;
$$;

create function public.sellerpilot_service_elevenst_gateway_credential_version(
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
  v_credential_id uuid;
  v_credential_version integer;
  v_environment text;
  v_binding jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.worker_token_has_scope(
       p_token_hash, 'gateway', true
     ) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select job.credential_id, credential.version, job.environment,
         job.request_payload#>'{arguments,sellerpilotElevenstCredentialBinding}'
    into v_credential_id, v_credential_version, v_environment, v_binding
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = 'elevenst'
     and credential.environment = job.environment
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.clock_timestamp())
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.channel = 'elevenst'
     and job.operation = 'listing.create'
     and job.provider_mutation_started_at is null
   for key share of job, credential;

  if not found
     or jsonb_typeof(v_binding) is distinct from 'object'
     or v_binding->>'contract' is distinct from 'sellerpilot_elevenst_credential_binding_v1'
     or v_binding->>'credentialId' is distinct from v_credential_id::text
     or v_binding->>'environment' is distinct from v_environment
     or coalesce(v_binding->>'credentialVersion', '') !~ '^[1-9][0-9]*$'
     or (v_binding->>'credentialVersion')::integer is distinct from v_credential_version then
    raise exception 'ELEVENST_GATEWAY_CREDENTIAL_VERSION_MISMATCH'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'contract', 'sellerpilot-elevenst-gateway-credential-version/1',
    'status', 'verified',
    'jobId', p_job_id,
    'credentialId', v_credential_id,
    'credentialVersion', v_credential_version,
    'environment', v_environment
  );
end;
$$;

create function sellerpilot_private.guard_elevenst_gateway_credential_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding jsonb;
  v_current_version integer;
begin
  if new.channel <> 'elevenst'
     or new.operation <> 'listing.create'
     or old.provider_mutation_started_at is not null
     or new.provider_mutation_started_at is null then
    return new;
  end if;

  v_binding := new.request_payload#>'{arguments,sellerpilotElevenstCredentialBinding}';
  select credential.version into v_current_version
    from sellerpilot_private.channel_credentials credential
   where credential.id = new.credential_id
     and credential.channel = 'elevenst'
     and credential.environment = new.environment
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.clock_timestamp())
   for key share;

  if not found
     or jsonb_typeof(v_binding) is distinct from 'object'
     or v_binding->>'contract' is distinct from 'sellerpilot_elevenst_credential_binding_v1'
     or v_binding->>'credentialId' is distinct from new.credential_id::text
     or v_binding->>'environment' is distinct from new.environment
     or coalesce(v_binding->>'credentialVersion', '') !~ '^[1-9][0-9]*$'
     or (v_binding->>'credentialVersion')::integer is distinct from v_current_version then
    raise exception 'ELEVENST_GATEWAY_CREDENTIAL_VERSION_MISMATCH'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger channel_gateway_jobs_elevenst_credential_version_guard
before update of provider_mutation_started_at
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_elevenst_gateway_credential_version();

revoke all on function public.sellerpilot_rotate_elevenst_credential_exact(
  uuid, integer, text, jsonb, timestamptz, integer, integer, integer
) from public, anon;
grant execute on function public.sellerpilot_rotate_elevenst_credential_exact(
  uuid, integer, text, jsonb, timestamptz, integer, integer, integer
) to authenticated;

revoke all on function public.sellerpilot_service_elevenst_gateway_credential_version(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_elevenst_gateway_credential_version(
  text, uuid, uuid
) to service_role;

revoke all on function sellerpilot_private.guard_elevenst_gateway_credential_version()
  from public, anon, authenticated, service_role;

comment on function public.sellerpilot_rotate_elevenst_credential_exact(
  uuid, integer, text, jsonb, timestamptz, integer, integer, integer
) is 'Atomically rotates only the exact active 11st credential ID and version; the shared rotation RPC remains unchanged.';
comment on function public.sellerpilot_service_elevenst_gateway_credential_version(
  text, uuid, uuid
) is 'Returns safe current 11st credential-version evidence for the exact running CREATE claim before provider mutation.';

commit;
