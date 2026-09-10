begin;

do $preimage$
begin
  if to_regprocedure('public.sellerpilot_list_temu_cs_accounts_v1()') is null
      or to_regprocedure(
        'public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)'
      ) is null then
    raise exception 'TEMU_BUYER_CHAT_READINESS_PREIMAGE_MISSING';
  end if;
end
$preimage$;

create table sellerpilot_private.temu_buyer_chat_readiness_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'production')),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  region text not null check (region ~ '^[A-Z][A-Z0-9_-]{1,39}$'),
  source_kind text not null check (source_kind in (
    'partner_center_authenticated_readback',
    'partner_api_authenticated_readback'
  )),
  source_revision bigint not null check (source_revision > 0),
  source_revision_sha256 text not null check (source_revision_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  app_status text not null check (app_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  compliance_status text not null check (compliance_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  security_questionnaire_status text not null check (security_questionnaire_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  seller_authorization_status text not null check (seller_authorization_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  contract_key text check (
    contract_key is null or contract_key ~ '^[A-Z0-9][A-Z0-9_.:/-]{2,159}$'
  ),
  contract_revision_sha256 text check (
    contract_revision_sha256 is null or contract_revision_sha256 ~ '^[a-f0-9]{64}$'
  ),
  permission_package text check (
    permission_package is null or length(permission_package) between 1 and 160
  ),
  granted_permission_packages jsonb not null default '[]'::jsonb check (
    jsonb_typeof(granted_permission_packages) = 'array'
    and octet_length(granted_permission_packages::text) <= 16000
  ),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (credential_id, source_revision),
  check (expires_at > observed_at and expires_at <= observed_at + interval '15 minutes'),
  check (
    (contract_key is null and contract_revision_sha256 is null and permission_package is null)
    or
    (contract_key is not null and contract_revision_sha256 is not null and permission_package is not null)
  )
);

create index temu_buyer_chat_readiness_evidence_latest_idx
  on sellerpilot_private.temu_buyer_chat_readiness_evidence (
    credential_id, source_revision desc, observed_at desc
  );

create function sellerpilot_private.reject_temu_buyer_chat_readiness_evidence_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'TEMU_BUYER_CHAT_EVIDENCE_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger temu_buyer_chat_readiness_evidence_immutable
before update or delete on sellerpilot_private.temu_buyer_chat_readiness_evidence
for each row execute function sellerpilot_private.reject_temu_buyer_chat_readiness_evidence_change();

alter table sellerpilot_private.temu_buyer_chat_readiness_evidence enable row level security;
revoke all on sellerpilot_private.temu_buyer_chat_readiness_evidence
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reject_temu_buyer_chat_readiness_evidence_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_read_temu_buyer_chat_readiness_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_evidence sellerpilot_private.temu_buyer_chat_readiness_evidence%rowtype;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID' using errcode = '22023';
  end if;

  select evidence.* into v_evidence
    from sellerpilot_private.temu_buyer_chat_readiness_evidence evidence
   where evidence.credential_id = v_credential.id
     and evidence.owner_id = v_credential.created_by
     and evidence.environment = v_credential.environment
     and evidence.seller_account_key = v_credential.seller_account_key
   order by evidence.source_revision desc, evidence.observed_at desc
   limit 1;

  return jsonb_build_object(
    'contract', 'sellerpilot-temu-buyer-chat-runtime-read/1',
    'checkedAt', statement_timestamp(),
    'credentialId', v_credential.id,
    'sellerAccountKey', v_credential.seller_account_key,
    'environment', v_credential.environment,
    'evidence', case when v_evidence.id is null then null else jsonb_build_object(
      'contract', 'sellerpilot-temu-buyer-chat-runtime-evidence/1',
      'source', 'sellerpilot_private.temu_buyer_chat_readiness_evidence',
      'sourceKind', v_evidence.source_kind,
      'sourceRevision', v_evidence.source_revision,
      'sourceRevisionSha256', v_evidence.source_revision_sha256,
      'credentialId', v_evidence.credential_id,
      'sellerAccountKey', v_evidence.seller_account_key,
      'environment', v_evidence.environment,
      'region', v_evidence.region,
      'observedAt', v_evidence.observed_at,
      'expiresAt', v_evidence.expires_at,
      'appStatus', v_evidence.app_status,
      'complianceStatus', v_evidence.compliance_status,
      'securityQuestionnaireStatus', v_evidence.security_questionnaire_status,
      'sellerAuthorizationStatus', v_evidence.seller_authorization_status,
      'contractKey', v_evidence.contract_key,
      'contractRevisionSha256', v_evidence.contract_revision_sha256,
      'permissionPackage', v_evidence.permission_package,
      'grantedPermissionPackages', v_evidence.granted_permission_packages
    ) end
  );
end;
$$;

create function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_evidence sellerpilot_private.temu_buyer_chat_readiness_evidence%rowtype;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where token.token_hash = p_token_hash
     and token.scope in ('gateway', 'serverless_cs')
     and token.status = 'active'
     and token.expires_at > v_now
     and job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > v_now
     and job.channel = 'temu'
     and job.operation = 'inquiries.list'
     and job.request_payload #>> '{arguments,kind}' = 'buyer_chat';
  if not found then
    raise exception 'TEMU_BUYER_CHAT_JOB_OWNERSHIP_INVALID' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
     and credential.channel = v_job.channel
     and credential.environment = v_job.environment
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now)
     and credential.created_by = v_job.created_by
     and credential.seller_account_key = v_job.seller_account_key
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'TEMU_BUYER_CHAT_ACCOUNT_BINDING_INVALID' using errcode = '42501';
  end if;

  select evidence.* into v_evidence
    from sellerpilot_private.temu_buyer_chat_readiness_evidence evidence
   where evidence.credential_id = v_credential.id
     and evidence.owner_id = v_credential.created_by
     and evidence.environment = v_credential.environment
     and evidence.seller_account_key = v_credential.seller_account_key
   order by evidence.source_revision desc, evidence.observed_at desc
   limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'contract', 'sellerpilot-temu-buyer-chat-runtime-evidence/1',
    'source', 'sellerpilot_private.temu_buyer_chat_readiness_evidence',
    'sourceKind', v_evidence.source_kind,
    'sourceRevision', v_evidence.source_revision,
    'sourceRevisionSha256', v_evidence.source_revision_sha256,
    'credentialId', v_evidence.credential_id,
    'sellerAccountKey', v_evidence.seller_account_key,
    'environment', v_evidence.environment,
    'region', v_evidence.region,
    'observedAt', v_evidence.observed_at,
    'expiresAt', v_evidence.expires_at,
    'appStatus', v_evidence.app_status,
    'complianceStatus', v_evidence.compliance_status,
    'securityQuestionnaireStatus', v_evidence.security_questionnaire_status,
    'sellerAuthorizationStatus', v_evidence.seller_authorization_status,
    'contractKey', v_evidence.contract_key,
    'contractRevisionSha256', v_evidence.contract_revision_sha256,
    'permissionPackage', v_evidence.permission_package,
    'grantedPermissionPackages', v_evidence.granted_permission_packages
  );
end;
$$;

revoke all on function public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)
  to authenticated;
revoke all on function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid)
  to service_role;

comment on table sellerpilot_private.temu_buyer_chat_readiness_evidence is
  'Immutable short-lived server evidence only. No public writer exists; arbitrary request or credential payload strings cannot activate Buyer Chat.';
comment on function public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid) is
  'Returns exact job/claim/credential/seller-bound Temu Buyer Chat evidence without making a provider request.';

commit;
