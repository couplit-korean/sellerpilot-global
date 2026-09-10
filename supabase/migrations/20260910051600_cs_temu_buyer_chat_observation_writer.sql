begin;

do $preimage$
begin
  if to_regclass('sellerpilot_private.temu_buyer_chat_readiness_evidence') is null
      or to_regprocedure('public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)') is null then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_PREIMAGE_MISSING';
  end if;
end
$preimage$;

create table sellerpilot_private.temu_buyer_chat_observation_diagnostics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null check (environment = 'production'),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  region text not null check (region = 'GLOBAL'),
  source_kind text not null check (source_kind = 'authenticated_admin_diagnostic'),
  verification_state text not null check (verification_state = 'unverified'),
  source_actor_id uuid not null references auth.users(id) on delete restrict,
  client_observation_id uuid not null,
  artifact_id uuid not null unique,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  source_revision bigint not null check (source_revision > 0),
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_app_status text not null check (claimed_app_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  claimed_compliance_status text not null check (claimed_compliance_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  claimed_security_questionnaire_status text not null check (claimed_security_questionnaire_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  claimed_seller_authorization_status text not null check (claimed_seller_authorization_status in ('Active','Inactive','Approved','Reviewing','Rejected','Unknown')),
  diagnostic_reason text not null check (diagnostic_reason = 'PROVIDER_AUTHENTICATED_SOURCE_UNVERIFIED'),
  unique (credential_id, client_observation_id),
  unique (credential_id, source_revision),
  check (observed_at >= recorded_at - interval '15 minutes'),
  check (observed_at <= recorded_at + interval '1 minute'),
  check (expires_at > recorded_at and expires_at <= recorded_at + interval '15 minutes')
);

create index temu_buyer_chat_observation_diagnostics_latest_idx
  on sellerpilot_private.temu_buyer_chat_observation_diagnostics (
    credential_id, source_revision desc, recorded_at desc
  );

create function sellerpilot_private.reject_temu_buyer_chat_observation_diagnostic_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'TEMU_BUYER_CHAT_OBSERVATION_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger temu_buyer_chat_observation_diagnostics_immutable
before update or delete on sellerpilot_private.temu_buyer_chat_observation_diagnostics
for each row execute function sellerpilot_private.reject_temu_buyer_chat_observation_diagnostic_change();

alter table sellerpilot_private.temu_buyer_chat_observation_diagnostics enable row level security;
revoke all on sellerpilot_private.temu_buyer_chat_observation_diagnostics
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reject_temu_buyer_chat_observation_diagnostic_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  p_credential_id uuid,
  p_client_observation_id uuid,
  p_artifact_id uuid,
  p_artifact_sha256 text,
  p_expected_revision bigint,
  p_observed_at timestamptz,
  p_claimed_app_status text,
  p_claimed_compliance_status text,
  p_claimed_security_questionnaire_status text,
  p_claimed_seller_authorization_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_actor uuid := auth.uid();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_revision bigint;
  v_row sellerpilot_private.temu_buyer_chat_observation_diagnostics%rowtype;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_artifact_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_ARTIFACT_INVALID' using errcode = '22023';
  end if;
  if p_observed_at < v_now - interval '15 minutes'
      or p_observed_at > v_now + interval '1 minute' then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_TIME_INVALID' using errcode = '22023';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('temu-buyer-chat-observation:' || v_credential.id::text, 0));
  select coalesce(max(diagnostic.source_revision), 0) + 1 into v_revision
    from sellerpilot_private.temu_buyer_chat_observation_diagnostics diagnostic
   where diagnostic.credential_id = v_credential.id;
  if p_expected_revision is distinct from v_revision then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_REVISION_MISMATCH' using errcode = '40001';
  end if;

  insert into sellerpilot_private.temu_buyer_chat_observation_diagnostics(
    owner_id,credential_id,environment,seller_account_key,region,source_kind,
    verification_state,source_actor_id,client_observation_id,artifact_id,
    artifact_sha256,source_revision,observed_at,recorded_at,expires_at,
    claimed_app_status,claimed_compliance_status,
    claimed_security_questionnaire_status,claimed_seller_authorization_status,
    diagnostic_reason
  ) values(
    v_credential.created_by,v_credential.id,v_credential.environment,
    v_credential.seller_account_key,'GLOBAL','authenticated_admin_diagnostic',
    'unverified',v_actor,p_client_observation_id,p_artifact_id,
    p_artifact_sha256,v_revision,p_observed_at,v_now,v_now + interval '15 minutes',
    p_claimed_app_status,p_claimed_compliance_status,
    p_claimed_security_questionnaire_status,p_claimed_seller_authorization_status,
    'PROVIDER_AUTHENTICATED_SOURCE_UNVERIFIED'
  ) returning * into v_row;

  return jsonb_build_object(
    'contract', 'sellerpilot-temu-buyer-chat-observation-diagnostic/1',
    'artifactId', v_row.artifact_id,
    'artifactSha256', v_row.artifact_sha256,
    'credentialId', v_row.credential_id,
    'sellerAccountKey', v_row.seller_account_key,
    'environment', v_row.environment,
    'region', v_row.region,
    'sourceKind', v_row.source_kind,
    'sourceRevision', v_row.source_revision,
    'verificationState', v_row.verification_state,
    'observedAt', v_row.observed_at,
    'recordedAt', v_row.recorded_at,
    'expiresAt', v_row.expires_at,
    'diagnosticReason', v_row.diagnostic_reason,
    'trustedReadinessEvidenceCreated', false
  );
exception
  when unique_violation then
    raise exception 'TEMU_BUYER_CHAT_OBSERVATION_REPLAY' using errcode = '23505';
end;
$$;

revoke all on function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  uuid,uuid,uuid,text,bigint,timestamptz,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  uuid,uuid,uuid,text,bigint,timestamptz,text,text,text,text
) to authenticated;

comment on table sellerpilot_private.temu_buyer_chat_observation_diagnostics is
  'Immutable, short-lived authenticated-admin observations. Always unverified and excluded from the trusted Buyer Chat readiness ledger and runtime gate.';
comment on function public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
  uuid,uuid,uuid,text,bigint,timestamptz,text,text,text,text
) is
  'Persists claims only as unverified diagnostics. It cannot create or promote Temu Buyer Chat readiness evidence.';

commit;
