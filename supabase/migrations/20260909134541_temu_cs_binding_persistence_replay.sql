begin;

do $preimage$
declare
  v_definition text;
begin
  if to_regprocedure(
    'public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'
  ) is null then
    raise exception 'TEMU_CS_BINDING_CANONICAL_RPC_MISSING';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'::regprocedure
  );
  if pg_catalog.strpos(v_definition, 'sellerpilot_private.cs_credential_capability_bindings') = 0
      or pg_catalog.strpos(v_definition, 'token.scope') = 0
      or pg_catalog.strpos(v_definition, '''gateway''') = 0
      or pg_catalog.strpos(v_definition, 'sellerpilot-cs-credential-binding/1') = 0 then
    raise exception 'TEMU_CS_BINDING_CANONICAL_RPC_DRIFT';
  end if;
end
$preimage$;

alter function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) rename to sellerpilot_091215_record_cs_binding_before_temu_serverless;

revoke all on function public.sellerpilot_091215_record_cs_binding_before_temu_serverless(
  text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create table sellerpilot_private.temu_cs_binding_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  app_fingerprint text not null check (app_fingerprint ~ '^[a-f0-9]{64}$'),
  token_fingerprint text not null check (token_fingerprint ~ '^[a-f0-9]{64}$'),
  target_fingerprint text not null check (target_fingerprint ~ '^[a-f0-9]{64}$'),
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (job_id, claim_token)
);

create function sellerpilot_private.reject_temu_cs_binding_receipt_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'TEMU_CS_BINDING_RECEIPT_IMMUTABLE' using errcode='55000';
end;
$$;

create trigger temu_cs_binding_receipts_immutable
before update or delete on sellerpilot_private.temu_cs_binding_receipts
for each row execute function sellerpilot_private.reject_temu_cs_binding_receipt_change();

alter table sellerpilot_private.temu_cs_binding_receipts enable row level security;
revoke all on sellerpilot_private.temu_cs_binding_receipts
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reject_temu_cs_binding_receipt_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_record_cs_credential_binding_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_token_id uuid;
  v_now timestamptz := clock_timestamp();
  v_binding_receipt sellerpilot_private.temu_cs_binding_receipts%rowtype;
  v_result jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found or v_job.channel <> 'temu' then
    return public.sellerpilot_091215_record_cs_binding_before_temu_serverless(
      p_token_hash, p_job_id, p_claim_token, p_evidence
    );
  end if;

  if v_job.operation <> 'inquiries.list'
      or v_job.environment <> 'production'
      or v_job.status <> 'succeeded' then
    raise exception 'TEMU_CS_BINDING_JOB_SCOPE_INVALID';
  end if;

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.worker_token_id = token.id
     and receipt.job_id = v_job.id
     and receipt.claim_token = p_claim_token
   where token.token_hash = p_token_hash
     and token.scope in ('gateway', 'serverless_cs')
     and token.status = 'active'
     and token.expires_at > v_now;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.channel = v_job.channel
     and credential.environment = v_job.environment
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now);
  if not found then
    raise exception 'TEMU_CS_BINDING_CREDENTIAL_INACTIVE';
  end if;
  if v_job.created_by is null
      or v_credential.created_by is null
      or v_job.created_by <> v_credential.created_by then
    raise exception 'TEMU_CS_BINDING_OWNER_MISMATCH';
  end if;
  if coalesce(v_job.seller_account_key, '') !~ '^[a-f0-9]{64}$'
      or v_job.seller_account_key is distinct from v_credential.seller_account_key
      or v_credential.seller_account_key_source is distinct from 'provider_certified_v1'
      or v_credential.seller_account_verified_at is null then
    raise exception 'TEMU_CS_BINDING_ACCOUNT_MISMATCH';
  end if;

  if jsonb_typeof(p_evidence) is distinct from 'object'
      or p_evidence->>'contract' is distinct from 'sellerpilot-cs-credential-binding/1'
      or p_evidence->>'channel' is distinct from 'temu'
      or p_evidence->>'operation' is distinct from 'inquiries.list'
      or p_evidence->>'country' is distinct from 'UNSCOPED'
      or p_evidence->>'sellerAccountKey' is distinct from v_credential.seller_account_key
      or coalesce(p_evidence->>'appFingerprint', '') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'tokenFingerprint', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(p_evidence->'targetFingerprints') is distinct from 'array'
      or jsonb_array_length(case
        when jsonb_typeof(p_evidence->'targetFingerprints') = 'array'
          then p_evidence->'targetFingerprints'
        else '[]'::jsonb
      end) <> 1
      or p_evidence->'targetFingerprints'->>0 is distinct from v_credential.seller_account_key then
    raise exception 'TEMU_CS_BINDING_EVIDENCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:temu-cs-binding:' || v_job.id::text
  ));
  select receipt.* into v_binding_receipt
    from sellerpilot_private.temu_cs_binding_receipts receipt
   where receipt.job_id = v_job.id
     and receipt.claim_token = p_claim_token;
  if found then
    if v_binding_receipt.worker_token_id is distinct from v_token_id
        or v_binding_receipt.credential_id is distinct from v_credential.id
        or v_binding_receipt.seller_account_key is distinct from v_credential.seller_account_key
        or v_binding_receipt.app_fingerprint is distinct from p_evidence->>'appFingerprint'
        or v_binding_receipt.token_fingerprint is distinct from p_evidence->>'tokenFingerprint'
        or v_binding_receipt.target_fingerprint is distinct from v_credential.seller_account_key then
      raise exception 'TEMU_CS_BINDING_REPLAY_MISMATCH' using errcode = '40001';
    end if;
    return v_binding_receipt.result_payload || jsonb_build_object('replayed', true);
  end if;

  update sellerpilot_private.cs_credential_capability_bindings binding
     set status = 'superseded',
         updated_at = v_now
   where binding.credential_id = v_credential.id
     and binding.operation = 'inquiries.list'
     and binding.status = 'active'
     and (
       binding.app_fingerprint <> p_evidence->>'appFingerprint'
       or binding.token_fingerprint <> p_evidence->>'tokenFingerprint'
       or binding.target_fingerprint <> v_credential.seller_account_key
     );

  insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id, channel, operation, country, app_fingerprint,
    token_fingerprint, target_fingerprint, status, verified_job_id,
    verified_at, expires_at, updated_at
  ) values (
    v_credential.id, 'temu', 'inquiries.list', 'UNSCOPED',
    p_evidence->>'appFingerprint', p_evidence->>'tokenFingerprint',
    v_credential.seller_account_key, 'active', v_job.id, v_now,
    v_credential.expires_at, v_now
  )
  on conflict(
    credential_id, operation, country, app_fingerprint,
    token_fingerprint, target_fingerprint
  ) do update set
    status = 'active',
    verified_job_id = excluded.verified_job_id,
    verified_at = excluded.verified_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  v_result := jsonb_build_object(
    'contract', 'sellerpilot-cs-credential-binding/1',
    'status', 'recorded',
    'bindingCount', 1,
    'credentialId', v_credential.id,
    'sellerAccountKey', v_credential.seller_account_key,
    'replayed', false,
    'workerIdentityCompared', false
  );
  insert into sellerpilot_private.temu_cs_binding_receipts(
    job_id, claim_token, worker_token_id, credential_id, seller_account_key,
    app_fingerprint, token_fingerprint, target_fingerprint, result_payload
  ) values (
    v_job.id, p_claim_token, v_token_id, v_credential.id,
    v_credential.seller_account_key, p_evidence->>'appFingerprint',
    p_evidence->>'tokenFingerprint', v_credential.seller_account_key, v_result
  );
  return v_result;
end
$$;

revoke all on function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) to service_role;

do $postimage$
declare
  v_signature regprocedure := to_regprocedure(
    'public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'
  );
  v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  if not exists (
    select 1
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=""']::text[]
       and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  )
      or pg_catalog.strpos(v_definition, 'receipt.worker_token_id = token.id') = 0
      or pg_catalog.strpos(v_definition, '''serverless_cs''') = 0
      or pg_catalog.strpos(v_definition, 'v_job.created_by <> v_credential.created_by') = 0
      or pg_catalog.strpos(v_definition, 'sellerpilot_private.temu_cs_binding_receipts') = 0
      or pg_catalog.strpos(v_definition, 'is distinct from ''sellerpilot-cs-credential-binding/1''') = 0
      or pg_catalog.strpos(v_definition, 'workerIdentityCompared'', false') = 0 then
    raise exception 'TEMU_CS_BINDING_PERSISTENCE_POSTIMAGE_INVALID';
  end if;
end
$postimage$;

comment on function public.sellerpilot_service_record_cs_credential_binding_v1(
  text, uuid, uuid, jsonb
) is
  'Records exact Temu inquiry binding for the gateway or dedicated serverless_cs token that owns the immutable completion receipt. Strict JSON identity checks reject missing and null fields; an immutable per-job binding receipt makes old response replay side-effect free after later verification. Job and credential owner/account/environment must match; shared worker identity is not seller identity. Other channels retain the canonical gateway implementation.';

notify pgrst, 'reload schema';
commit;
