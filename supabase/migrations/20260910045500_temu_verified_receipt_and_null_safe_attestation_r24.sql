-- Route crypto verification is represented by a one-time receipt which only a
-- dedicated PostgREST role may mint. service_role can consume, never mint it.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local timezone='UTC';

do $$
begin
  if not exists(select 1 from pg_roles where rolname='sellerpilot_temu_collector_verifier') then
    create role sellerpilot_temu_collector_verifier nologin noinherit;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticator') then
    grant sellerpilot_temu_collector_verifier to authenticator;
  end if;
end;$$;
grant usage on schema public to sellerpilot_temu_collector_verifier;

create function sellerpilot_private.temu_attestation_shape_valid(p_value jsonb)
returns boolean language plpgsql immutable security definer set search_path='' as $$
declare v_required text[]:=array[
  'contract','uiContractSha256','keyId','receiptKeyId','challengeId','nonce','ownerId','productId','credentialId',
  'credentialVersion','credentialFingerprint','credentialVaultSecretId','productRevisionFingerprint',
  'partnerAccountSubject','appId','appState','complianceState','rejectionReason','observedAt','mallId','regionId',
  'shipping','egress'];
begin
  if (jsonb_typeof(p_value)='object') is not true
     or (p_value ?& v_required) is not true
     or exists(select 1 from jsonb_object_keys(p_value) key_name
       where key_name<>all(v_required))
     or (p_value->>'contract'='temu_operator_collector_attestation_v1') is not true
     or (p_value->>'uiContractSha256'='8a9403966b16dd11744d181a8280dbc176b76b3a40aa77d4cd8d5ed54025eaca') is not true
     or (jsonb_typeof(p_value->'keyId')='string') is not true
     or (length(btrim(p_value->>'keyId')) between 1 and 128) is not true
     or (jsonb_typeof(p_value->'receiptKeyId')='string') is not true
     or (length(btrim(p_value->>'receiptKeyId')) between 1 and 128) is not true
     or (jsonb_typeof(p_value->'challengeId')='string') is not true
     or ((p_value->>'challengeId')::uuid is not null) is not true
     or (jsonb_typeof(p_value->'nonce')='string') is not true
     or ((p_value->>'nonce')~'^[A-Za-z0-9_-]{43}$') is not true
     or (jsonb_typeof(p_value->'ownerId')='string') is not true
     or ((p_value->>'ownerId')::uuid is not null) is not true
     or (jsonb_typeof(p_value->'productId')='string') is not true
     or ((p_value->>'productId')::uuid is not null) is not true
     or (jsonb_typeof(p_value->'credentialId')='string') is not true
     or ((p_value->>'credentialId')::uuid is not null) is not true
     or (jsonb_typeof(p_value->'credentialVersion')='number') is not true
     or ((p_value->>'credentialVersion')::integer>0) is not true
     or (jsonb_typeof(p_value->'credentialFingerprint')='string') is not true
     or ((p_value->>'credentialFingerprint')~'^[a-f0-9]{64}$') is not true
     or (jsonb_typeof(p_value->'credentialVaultSecretId')='string') is not true
     or ((p_value->>'credentialVaultSecretId')::uuid is not null) is not true
     or (jsonb_typeof(p_value->'productRevisionFingerprint')='string') is not true
     or ((p_value->>'productRevisionFingerprint')~'^[a-f0-9]{64}$') is not true
     or (jsonb_typeof(p_value->'partnerAccountSubject')='string') is not true
     or ((p_value->>'partnerAccountSubject')~'^temu-account:sha256:[a-f0-9]{64}$') is not true
     or (jsonb_typeof(p_value->'appId')='string') is not true
     or (length(btrim(p_value->>'appId')) between 1 and 256) is not true
     or ((p_value->>'appState') in('active','inactive','unknown')) is not true
     or ((p_value->>'complianceState') in('approved','rejected','reviewing','unknown')) is not true
     or ((jsonb_typeof(p_value->'rejectionReason')='null') or
       (jsonb_typeof(p_value->'rejectionReason')='string' and
        length(btrim(p_value->>'rejectionReason')) between 1 and 1000)) is not true
     or (jsonb_typeof(p_value->'observedAt')='string') is not true
     or ((p_value->>'observedAt')::timestamptz is not null) is not true
     or ((p_value->>'mallId')~'^[1-9][0-9]{0,31}$') is not true
     or ((p_value->>'regionId')~'^[1-9][0-9]{0,31}$') is not true
     or (jsonb_typeof(p_value->'shipping')='object') is not true
     or ((p_value->'shipping') ?& array['defaultTemplateId','warehouseVerified','feeRuleVerified','returnPolicyVerified']) is not true
     or exists(select 1 from jsonb_object_keys(p_value->'shipping') key_name where key_name<>all(
       array['defaultTemplateId','warehouseVerified','feeRuleVerified','returnPolicyVerified']))
     or (jsonb_typeof(p_value#>'{shipping,defaultTemplateId}')='string') is not true
     or (length(btrim(p_value#>>'{shipping,defaultTemplateId}')) between 1 and 256) is not true
     or (jsonb_typeof(p_value#>'{shipping,warehouseVerified}')='boolean') is not true
     or (jsonb_typeof(p_value#>'{shipping,feeRuleVerified}')='boolean') is not true
     or (jsonb_typeof(p_value#>'{shipping,returnPolicyVerified}')='boolean') is not true
     or (jsonb_typeof(p_value->'egress')='object') is not true
     or ((p_value->'egress') ?& array['state','verificationMethod']) is not true
     or exists(select 1 from jsonb_object_keys(p_value->'egress') key_name where key_name<>all(
       array['state','verificationMethod']))
     or ((p_value#>>'{egress,state}') in('static_ip_verified','provider_confirmed_no_allowlist','blocked_until_stable_ip','unknown')) is not true
     or ((p_value#>>'{egress,verificationMethod}') in('temu_allowlist_readback','temu_provider_policy_readback','temu_global_endpoint_probe')) is not true then
    return false;
  end if;
  return true;
exception when others then return false;
end;$$;
revoke all on function sellerpilot_private.temu_attestation_shape_valid(jsonb)
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;

create function sellerpilot_private.temu_key_policy_active(
  p_name text,p_require_current boolean default false
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_text text; v_policy jsonb;
begin
  select decrypted_secret into v_text from vault.decrypted_secrets
    where name=p_name order by created_at desc limit 1;
  if v_text is null then return false; end if;
  v_policy:=v_text::jsonb;
  if p_require_current then return (v_policy->>'status'='current') is true; end if;
  return ((v_policy->>'status'='current') or (v_policy->>'status'='grace'
    and (v_policy->>'graceUntil')::timestamptz>clock_timestamp())) is true;
exception when others then return false;
end;$$;
revoke all on function sellerpilot_private.temu_key_policy_active(text,boolean)
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;

create table sellerpilot_private.temu_collector_verified_receipts(
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references sellerpilot_private.temu_collector_challenges(id) on delete restrict,
  attestation_sha256 text not null check(attestation_sha256~'^[a-f0-9]{64}$'),
  signature_sha256 text not null check(signature_sha256~'^[a-f0-9]{64}$'),
  key_id text not null check(length(btrim(key_id)) between 1 and 128),
  receipt_key_id text not null check(length(btrim(receipt_key_id)) between 1 and 128),
  verified_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  unique(attestation_sha256,signature_sha256),
  check(expires_at>verified_at and expires_at<=verified_at+interval '2 minutes')
);
alter table sellerpilot_private.temu_collector_verified_receipts enable row level security;
revoke all on sellerpilot_private.temu_collector_verified_receipts
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;

create table sellerpilot_private.temu_collector_attestation_outcomes(
  challenge_id uuid primary key references sellerpilot_private.temu_collector_challenges(id) on delete restrict,
  receipt_id uuid not null unique references sellerpilot_private.temu_collector_verified_receipts(id) on delete restrict,
  attestation_id uuid not null unique references sellerpilot_private.temu_verified_collector_attestations(id) on delete restrict,
  attestation_sha256 text not null unique check(attestation_sha256~'^[a-f0-9]{64}$'),
  signature_sha256 text not null unique check(signature_sha256~'^[a-f0-9]{64}$'),
  status text not null check(status in('allowed','blocked')),
  denial_code text,
  result jsonb not null check(jsonb_typeof(result)='object'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.temu_collector_attestation_outcomes enable row level security;
revoke all on sellerpilot_private.temu_collector_attestation_outcomes
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;

create or replace function public.sellerpilot_service_issue_temu_collector_challenge_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,
  p_product_revision_fingerprint text,p_nonce_sha256 text,
  p_expected_key_id text,p_receipt_key_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_expires timestamptz:=clock_timestamp()+interval '2 minutes';
  v_expected_app_id text; v_credential_version integer;
  v_credential_fingerprint text; v_credential_vault_secret_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if (p_product_revision_fingerprint~'^[a-f0-9]{64}$') is not true
     or (p_nonce_sha256~'^[a-f0-9]{64}$') is not true
     or (length(btrim(p_expected_key_id)) between 1 and 128) is not true
     or (length(btrim(p_receipt_key_id)) between 1 and 128) is not true
     or sellerpilot_private.temu_key_policy_active(
       'sellerpilot_temu_collector_signing_policy_v1.'||p_expected_key_id,true) is not true
     or sellerpilot_private.temu_key_policy_active(
       'sellerpilot_temu_collector_db_receipt_policy_v1.'||p_receipt_key_id,true) is not true
     or not exists(select 1 from sellerpilot_private.products product
       where product.id=p_product_id and product.owner_id=p_owner_id)
     or not exists(select 1 from sellerpilot_private.channel_credentials credential
       where credential.id=p_credential_id and credential.created_by=p_owner_id
         and credential.channel='temu' and credential.environment='production'
         and credential.status='active'
         and(credential.expires_at is null or credential.expires_at>clock_timestamp())) then
    raise exception 'TEMU_COLLECTOR_CHALLENGE_SCOPE_INVALID' using errcode='22023'; end if;
  select nullif(btrim(secret.decrypted_secret::jsonb->>'app_key'),''),credential.version,
    credential.fingerprint,credential.vault_secret_id
    into v_expected_app_id,v_credential_version,v_credential_fingerprint,v_credential_vault_secret_id
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets secret on secret.id=credential.vault_secret_id
   where credential.id=p_credential_id and credential.created_by=p_owner_id
     and credential.channel='temu' and credential.environment='production'
     and credential.status='active'
     and(credential.expires_at is null or credential.expires_at>clock_timestamp());
  if (length(v_expected_app_id) between 1 and 256) is not true then
    raise exception 'TEMU_COLLECTOR_EXPECTED_APP_ID_UNAVAILABLE' using errcode='22023'; end if;
  insert into sellerpilot_private.temu_collector_challenges(owner_id,product_id,credential_id,
    expected_app_id,expected_key_id,receipt_key_id,credential_version,credential_fingerprint,
    credential_vault_secret_id,product_revision_fingerprint,nonce_sha256,expires_at)
  values(p_owner_id,p_product_id,p_credential_id,v_expected_app_id,p_expected_key_id,p_receipt_key_id,
    v_credential_version,v_credential_fingerprint,v_credential_vault_secret_id,
    p_product_revision_fingerprint,p_nonce_sha256,v_expires) returning id into v_id;
  return jsonb_build_object('contract','temu_collector_challenge_v1','challengeId',v_id,
    'expiresAt',v_expires,'expectedAppId',v_expected_app_id,'keyId',p_expected_key_id,
    'receiptKeyId',p_receipt_key_id,'credentialVersion',v_credential_version,
    'credentialFingerprint',v_credential_fingerprint,
    'credentialVaultSecretId',v_credential_vault_secret_id);
end;$$;

create function public.sellerpilot_verifier_record_temu_collector_receipt_v1(
  p_attestation jsonb,p_signature_base64 text,p_attestation_sha256 text,
  p_route_receipt_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_challenge sellerpilot_private.temu_collector_challenges%rowtype;
  v_existing sellerpilot_private.temu_collector_verified_receipts%rowtype;
  v_id uuid; v_signature_sha256 text; v_secret text;
  v_material text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'sellerpilot_temu_collector_verifier' then
    raise exception 'TEMU_COLLECTOR_VERIFIER_ROLE_REQUIRED' using errcode='42501'; end if;
  if sellerpilot_private.temu_attestation_shape_valid(p_attestation) is not true
     or (p_signature_base64~'^[A-Za-z0-9+/]{86}==$') is not true
     or (octet_length(decode(p_signature_base64,'base64'))=64) is not true
     or (p_attestation_sha256~'^[a-f0-9]{64}$') is not true
     or sellerpilot_private.constant_time_equal_32(decode(p_attestation_sha256,'hex'),
       extensions.digest(convert_to(sellerpilot_private.canonical_jsonb_text(p_attestation),'UTF8'),'sha256')) is not true then
    raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_INVALID' using errcode='22023'; end if;
  v_signature_sha256:=encode(extensions.digest(decode(p_signature_base64,'base64'),'sha256'),'hex');
  select * into v_existing from sellerpilot_private.temu_collector_verified_receipts
    where attestation_sha256=p_attestation_sha256 and signature_sha256=v_signature_sha256;
  if found then
    if (v_existing.challenge_id=(p_attestation->>'challengeId')::uuid) is not true
       or (v_existing.key_id=p_attestation->>'keyId') is not true
       or (v_existing.receipt_key_id=p_attestation->>'receiptKeyId') is not true then
      raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_REPLAY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('contract','temu_collector_verified_receipt_v1','receiptId',v_existing.id);
  end if;
  select * into v_challenge from sellerpilot_private.temu_collector_challenges
    where id=(p_attestation->>'challengeId')::uuid for share;
  if found is not true or (v_challenge.consumed_at is null) is not true
     or (v_challenge.expires_at>clock_timestamp()) is not true
     or (v_challenge.owner_id=(p_attestation->>'ownerId')::uuid) is not true
     or (v_challenge.product_id=(p_attestation->>'productId')::uuid) is not true
     or (v_challenge.credential_id=(p_attestation->>'credentialId')::uuid) is not true
     or (v_challenge.expected_app_id=p_attestation->>'appId') is not true
     or (v_challenge.expected_key_id=p_attestation->>'keyId') is not true
     or (v_challenge.receipt_key_id=p_attestation->>'receiptKeyId') is not true
     or (v_challenge.credential_version=(p_attestation->>'credentialVersion')::integer) is not true
     or (v_challenge.credential_fingerprint=p_attestation->>'credentialFingerprint') is not true
     or (v_challenge.credential_vault_secret_id=(p_attestation->>'credentialVaultSecretId')::uuid) is not true
     or (v_challenge.product_revision_fingerprint=p_attestation->>'productRevisionFingerprint') is not true
     or (v_challenge.nonce_sha256=encode(extensions.digest(
       convert_to(p_attestation->>'nonce','UTF8'),'sha256'),'hex')) is not true then
    raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_SCOPE_CHANGED' using errcode='40001'; end if;
  if not exists(select 1 from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets secret on secret.id=credential.vault_secret_id
    where credential.id=v_challenge.credential_id and credential.created_by=v_challenge.owner_id
      and credential.channel='temu' and credential.environment='production' and credential.status='active'
      and(credential.expires_at is null or credential.expires_at>clock_timestamp())
      and credential.version=v_challenge.credential_version
      and credential.fingerprint=v_challenge.credential_fingerprint
      and credential.vault_secret_id=v_challenge.credential_vault_secret_id
      and (nullif(btrim(secret.decrypted_secret::jsonb->>'app_key'),'')=v_challenge.expected_app_id) is true) then
    raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_CREDENTIAL_CHANGED' using errcode='40001'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name='sellerpilot_temu_collector_db_receipt_v1.'||v_challenge.receipt_key_id
    order by created_at desc limit 1;
  v_material:=concat_ws(E'\n','temu_collector_route_receipt_v1',p_attestation_sha256,
    v_signature_sha256,v_challenge.id::text,v_challenge.expected_app_id,v_challenge.receipt_key_id);
  if (v_secret~'^[A-Za-z0-9+/]+={0,2}$') is not true
     or (octet_length(decode(v_secret,'base64'))>=32) is not true
     or sellerpilot_private.temu_key_policy_active(
       'sellerpilot_temu_collector_db_receipt_policy_v1.'||v_challenge.receipt_key_id) is not true
     or sellerpilot_private.temu_key_policy_active(
       'sellerpilot_temu_collector_signing_policy_v1.'||v_challenge.expected_key_id) is not true
     or (p_route_receipt_sha256~'^[a-f0-9]{64}$') is not true
     or sellerpilot_private.constant_time_equal_32(decode(p_route_receipt_sha256,'hex'),
       extensions.hmac(convert_to(v_material,'UTF8'),decode(v_secret,'base64'),'sha256')) is not true then
    raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_PROOF_INVALID' using errcode='42501'; end if;
  insert into sellerpilot_private.temu_collector_verified_receipts(challenge_id,
    attestation_sha256,signature_sha256,key_id,receipt_key_id,expires_at)
  values(v_challenge.id,p_attestation_sha256,v_signature_sha256,p_attestation->>'keyId',
    p_attestation->>'receiptKeyId',least(v_challenge.expires_at,clock_timestamp()+interval '2 minutes'))
  on conflict(attestation_sha256,signature_sha256) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from sellerpilot_private.temu_collector_verified_receipts
      where attestation_sha256=p_attestation_sha256 and signature_sha256=v_signature_sha256;
  end if;
  return jsonb_build_object('contract','temu_collector_verified_receipt_v1','receiptId',v_id);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_INVALID' using errcode='22023';
end;$$;

alter function public.sellerpilot_service_consume_temu_collector_attestation_v1(jsonb,text,text,text)
  set schema sellerpilot_private;
alter function sellerpilot_private.sellerpilot_service_consume_temu_collector_attestation_v1(jsonb,text,text,text)
  rename to temu_consume_collector_attestation_r23;

create function public.sellerpilot_service_consume_temu_collector_attestation_v2(
  p_attestation jsonb,p_signature_base64 text,p_attestation_sha256 text,
  p_verified_receipt_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_receipt sellerpilot_private.temu_collector_verified_receipts%rowtype;
  v_outcome sellerpilot_private.temu_collector_attestation_outcomes%rowtype;
  v_signature_sha256 text; v_secret text; v_material text; v_internal_receipt text;
  v_legacy jsonb; v_attestation_id uuid; v_status text; v_denial text; v_result jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if sellerpilot_private.temu_attestation_shape_valid(p_attestation) is not true
     or (p_signature_base64~'^[A-Za-z0-9+/]{86}==$') is not true
     or (octet_length(decode(p_signature_base64,'base64'))=64) is not true
     or (p_attestation_sha256~'^[a-f0-9]{64}$') is not true then
    raise exception 'TEMU_COLLECTOR_ATTESTATION_INVALID' using errcode='22023'; end if;
  v_signature_sha256:=encode(extensions.digest(decode(p_signature_base64,'base64'),'sha256'),'hex');
  select * into v_receipt from sellerpilot_private.temu_collector_verified_receipts
    where id=p_verified_receipt_id for update;
  if found is not true
     or (v_receipt.challenge_id=(p_attestation->>'challengeId')::uuid) is not true
     or (v_receipt.attestation_sha256=p_attestation_sha256) is not true
     or (v_receipt.signature_sha256=v_signature_sha256) is not true
     or (v_receipt.key_id=p_attestation->>'keyId') is not true
     or (v_receipt.receipt_key_id=p_attestation->>'receiptKeyId') is not true then
    raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_REQUIRED' using errcode='42501'; end if;
  select * into v_outcome from sellerpilot_private.temu_collector_attestation_outcomes
    where receipt_id=v_receipt.id;
  if found then return v_outcome.result; end if;
  if (v_receipt.consumed_at is null) is not true or (v_receipt.expires_at>clock_timestamp()) is not true then
    raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_CONSUMED' using errcode='40001'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where
    name='sellerpilot_temu_collector_db_receipt_v1.'||v_receipt.receipt_key_id
    order by created_at desc limit 1;
  v_material:=concat_ws(E'\n','temu_collector_route_receipt_v1',p_attestation_sha256,
    v_signature_sha256,v_receipt.challenge_id::text,p_attestation->>'appId',v_receipt.receipt_key_id);
  v_internal_receipt:=encode(extensions.hmac(convert_to(v_material,'UTF8'),
    decode(v_secret,'base64'),'sha256'),'hex');
  v_legacy:=sellerpilot_private.temu_consume_collector_attestation_r23(
    p_attestation,p_signature_base64,p_attestation_sha256,v_internal_receipt);
  v_attestation_id:=(v_legacy->>'attestationId')::uuid;
  v_status:=case when (p_attestation->>'appState'='active') is true
    and (p_attestation->>'complianceState'='approved') is true
    and ((p_attestation#>>'{shipping,warehouseVerified}')::boolean is true)
    and ((p_attestation#>>'{shipping,feeRuleVerified}')::boolean is true)
    and ((p_attestation#>>'{shipping,returnPolicyVerified}')::boolean is true)
    and ((p_attestation#>>'{egress,state}') in('static_ip_verified','provider_confirmed_no_allowlist')) is true
    then 'allowed' else 'blocked' end;
  v_denial:=case when p_attestation->>'appState'<>'active' then 'TEMU_APP_INACTIVE'
    when p_attestation->>'complianceState'<>'approved' then 'TEMU_COMPLIANCE_NOT_APPROVED'
    when not ((p_attestation#>>'{shipping,warehouseVerified}')::boolean
      and (p_attestation#>>'{shipping,feeRuleVerified}')::boolean
      and (p_attestation#>>'{shipping,returnPolicyVerified}')::boolean) then 'TEMU_SHIPPING_NOT_VERIFIED'
    when p_attestation#>>'{egress,state}' not in('static_ip_verified','provider_confirmed_no_allowlist')
      then 'TEMU_EGRESS_NOT_VERIFIED' else null end;
  v_result:=jsonb_build_object('contract','temu_verified_collector_record_v1',
    'attestationId',v_attestation_id,'status',v_status,'denialCode',v_denial);
  update sellerpilot_private.temu_collector_verified_receipts set consumed_at=clock_timestamp()
    where id=v_receipt.id and consumed_at is null;
  if found is not true then raise exception 'TEMU_COLLECTOR_VERIFIED_RECEIPT_REPLAY' using errcode='40001'; end if;
  insert into sellerpilot_private.temu_collector_attestation_outcomes(challenge_id,receipt_id,
    attestation_id,attestation_sha256,signature_sha256,status,denial_code,result)
  values(v_receipt.challenge_id,v_receipt.id,v_attestation_id,p_attestation_sha256,
    v_signature_sha256,v_status,v_denial,v_result);
  return v_result;
end;$$;

create function sellerpilot_private.temu_current_attestation_valid(
  p_attestation_id uuid,p_owner_id uuid,p_product_id uuid,p_credential_id uuid
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_ok boolean;
begin
  select true into v_ok from sellerpilot_private.temu_verified_collector_attestations attestation
  join sellerpilot_private.temu_collector_attestation_outcomes outcome
    on outcome.attestation_id=attestation.id
  join sellerpilot_private.temu_collector_challenges challenge on challenge.id=attestation.challenge_id
  join sellerpilot_private.channel_credentials credential on credential.id=attestation.credential_id
  join vault.decrypted_secrets secret on secret.id=credential.vault_secret_id
  where attestation.id=p_attestation_id and attestation.owner_id=p_owner_id
    and attestation.product_id=p_product_id and attestation.credential_id=p_credential_id
    and sellerpilot_private.temu_attestation_shape_valid(attestation.envelope) is true
    and attestation.observed_at between clock_timestamp()-interval '5 minutes' and clock_timestamp()
    and credential.created_by=p_owner_id and credential.channel='temu'
    and credential.environment='production' and credential.status='active'
    and(credential.expires_at is null or credential.expires_at>clock_timestamp())
    and credential.version=challenge.credential_version
    and credential.fingerprint=challenge.credential_fingerprint
    and credential.vault_secret_id=challenge.credential_vault_secret_id
    and (attestation.envelope->>'credentialVersion')::integer=credential.version
    and attestation.envelope->>'credentialFingerprint'=credential.fingerprint
    and (attestation.envelope->>'credentialVaultSecretId')::uuid=credential.vault_secret_id
    and nullif(btrim(secret.decrypted_secret::jsonb->>'app_key'),'')=challenge.expected_app_id
    and challenge.expected_app_id=attestation.envelope->>'appId'
    and sellerpilot_private.temu_key_policy_active(
      'sellerpilot_temu_collector_db_receipt_policy_v1.'||(attestation.envelope->>'receiptKeyId')) is true
    and sellerpilot_private.temu_key_policy_active(
      'sellerpilot_temu_collector_signing_policy_v1.'||attestation.key_id) is true
    and not exists(select 1 from sellerpilot_private.temu_verified_collector_attestations later
      where later.owner_id=attestation.owner_id and later.product_id=attestation.product_id
        and later.credential_id=attestation.credential_id
        and later.ingest_sequence>attestation.ingest_sequence);
  return coalesce(v_ok,false);
exception when others then return false;
end;$$;
revoke all on function sellerpilot_private.temu_current_attestation_valid(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;

alter function public.sellerpilot_service_read_temu_verified_create_app_gate_v1(uuid,uuid,uuid)
  rename to sellerpilot_read_temu_verified_app_gate_r23;
create function public.sellerpilot_service_read_temu_verified_create_app_gate_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_attestation_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  v_result:=public.sellerpilot_read_temu_verified_app_gate_r23(p_owner_id,p_product_id,p_credential_id);
  begin v_attestation_id:=(v_result->>'collectorAttestationId')::uuid;
  exception when others then v_attestation_id:=null; end;
  if sellerpilot_private.temu_current_attestation_valid(v_attestation_id,p_owner_id,p_product_id,p_credential_id) is not true then
    return jsonb_build_object('contract','temu_verified_create_app_gate_v1','status','missing');
  end if;
  return v_result;
end;$$;

alter function public.sellerpilot_service_read_temu_verified_authoritative_sources_v1(uuid,uuid,text,text,text,text)
  rename to sellerpilot_read_temu_verified_sources_r23;
create function public.sellerpilot_service_read_temu_verified_authoritative_sources_v1(
  p_owner_id uuid,p_product_id uuid,p_account_subject text,p_mall_id text,
  p_region_id text,p_product_revision_fingerprint text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_attestation_id uuid; v_credential_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  v_result:=public.sellerpilot_read_temu_verified_sources_r23(p_owner_id,p_product_id,
    p_account_subject,p_mall_id,p_region_id,p_product_revision_fingerprint);
  begin v_attestation_id:=(v_result->>'collectorAttestationId')::uuid;
    select credential_id into v_credential_id from sellerpilot_private.temu_verified_collector_attestations
      where id=v_attestation_id;
  exception when others then v_attestation_id:=null; end;
  if sellerpilot_private.temu_current_attestation_valid(v_attestation_id,p_owner_id,p_product_id,v_credential_id) is not true then
    return jsonb_build_object('contract','temu_verified_authoritative_source_bundle_v1',
      'ownerId',p_owner_id,'productId',p_product_id,'accountSubject',p_account_subject,
      'mallId',p_mall_id,'regionId',p_region_id,
      'productRevisionFingerprint',p_product_revision_fingerprint,'readAt',clock_timestamp(),
      'maxAgeSeconds',300,'collectorAttestationId',null,'appSnapshot',null,
      'shippingSnapshot',null,'egressAttestation',null);
  end if;
  return v_result;
end;$$;

create function sellerpilot_private.temu_create_source_r24_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_attestation_id uuid;
begin
  select gate.collector_attestation_id into v_attestation_id
    from sellerpilot_private.temu_create_app_gate_observations gate
    join sellerpilot_private.temu_verified_collector_attestations attestation
      on attestation.id=gate.collector_attestation_id
   where gate.owner_id=new.owner_id and gate.product_id=new.product_id
     and gate.credential_id=new.credential_id
     and gate.source='service_verified_signed_local_collector_v1'
   order by attestation.ingest_sequence desc limit 1;
  if sellerpilot_private.temu_current_attestation_valid(v_attestation_id,new.owner_id,
       new.product_id,new.credential_id) is not true
     or (jsonb_typeof(new.evidence)='object') is not true
     or ((new.evidence#>>'{credential,version}')::integer=new.credential_version) is not true
     or ((new.evidence#>>'{credential,credentialId}')::uuid=new.credential_id) is not true then
    raise exception 'TEMU_CREATE_SOURCE_R24_CURRENT_SCOPE_REQUIRED' using errcode='40001'; end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'TEMU_CREATE_SOURCE_R24_CURRENT_SCOPE_REQUIRED' using errcode='40001';
end;$$;
revoke all on function sellerpilot_private.temu_create_source_r24_guard()
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;
create trigger r24_guard_temu_create_source before insert
  on sellerpilot_private.temu_create_authoritative_sources for each row
  execute function sellerpilot_private.temu_create_source_r24_guard();

alter function public.sellerpilot_service_read_temu_create_authoritative_source_v1(uuid,uuid,uuid,text)
  rename to sellerpilot_read_temu_create_source_r23;
create function public.sellerpilot_service_read_temu_create_authoritative_source_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_request_fingerprint text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_attestation_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  v_result:=public.sellerpilot_read_temu_create_source_r23(p_owner_id,p_product_id,
    p_credential_id,p_request_fingerprint);
  if (v_result->>'status'='ready') is not true then return v_result; end if;
  begin select collector_attestation_id into v_attestation_id
    from sellerpilot_private.temu_create_authoritative_sources
    where id=(v_result->>'sourceId')::uuid;
  exception when others then v_attestation_id:=null; end;
  if sellerpilot_private.temu_current_attestation_valid(v_attestation_id,p_owner_id,p_product_id,p_credential_id) is not true then
    return jsonb_build_object('contract','temu_create_authoritative_source_read_v1','status','missing');
  end if;
  return v_result;
end;$$;

alter function public.sellerpilot_service_record_temu_final_create_payload_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)
  rename to sellerpilot_record_temu_final_payload_r23;
create function public.sellerpilot_service_record_temu_final_create_payload_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_attempt_id uuid,p_source_id uuid,
  p_request_fingerprint text,p_final_arguments jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_attestation_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_FINAL_PAYLOAD_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  begin select collector_attestation_id into v_attestation_id
    from sellerpilot_private.temu_create_authoritative_sources where id=p_source_id;
  exception when others then v_attestation_id:=null; end;
  if sellerpilot_private.temu_current_attestation_valid(v_attestation_id,p_owner_id,p_product_id,p_credential_id) is not true
     or (jsonb_typeof(p_final_arguments)='object') is not true
     or (jsonb_typeof(p_final_arguments->'sellerpilotTemuAuthoritativeSource')='object') is not true
     or ((p_final_arguments#>>'{sellerpilotTemuAuthoritativeSource,sourceId}')::uuid=p_source_id) is not true
     or (p_final_arguments#>>'{sellerpilotTemuAuthoritativeSource,requestFingerprint}'=p_request_fingerprint) is not true then
    raise exception 'TEMU_FINAL_PAYLOAD_R24_SCOPE_CHANGED' using errcode='40001'; end if;
  return public.sellerpilot_record_temu_final_payload_r23(p_owner_id,p_product_id,p_credential_id,
    p_attempt_id,p_source_id,p_request_fingerprint,p_final_arguments);
exception when invalid_text_representation then
  raise exception 'TEMU_FINAL_PAYLOAD_R24_SCOPE_CHANGED' using errcode='40001';
end;$$;

alter function sellerpilot_private.temu_create_source_provider_allowed(uuid,uuid)
  rename to temu_create_source_provider_allowed_r23;
create function sellerpilot_private.temu_create_source_provider_allowed(
  p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
begin
  select * into v_job from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  if found is not true or (v_job.claim_token=p_claim_token) is not true
     or (jsonb_typeof(v_job.request_payload#>'{arguments,sellerpilotTemuAuthoritativeSource}')='object') is not true
     or (jsonb_typeof(v_job.request_payload#>'{arguments,sellerpilotTemuFinalPayload}')='object') is not true then
    return false; end if;
  begin select * into v_source from sellerpilot_private.temu_create_authoritative_sources
    where id=(v_job.request_payload#>>'{arguments,sellerpilotTemuAuthoritativeSource,sourceId}')::uuid;
  exception when others then return false; end;
  if sellerpilot_private.temu_current_attestation_valid(v_source.collector_attestation_id,
       v_source.owner_id,v_source.product_id,v_source.credential_id) is not true then return false; end if;
  return sellerpilot_private.temu_create_source_provider_allowed_r23(p_job_id,p_claim_token);
end;$$;

revoke all on function sellerpilot_private.temu_consume_collector_attestation_r23(jsonb,text,text,text)
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;
revoke all on function public.sellerpilot_verifier_record_temu_collector_receipt_v1(jsonb,text,text,text)
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;
grant execute on function public.sellerpilot_verifier_record_temu_collector_receipt_v1(jsonb,text,text,text)
  to sellerpilot_temu_collector_verifier;
revoke all on function public.sellerpilot_service_consume_temu_collector_attestation_v2(jsonb,text,text,uuid)
  from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;
grant execute on function public.sellerpilot_service_consume_temu_collector_attestation_v2(jsonb,text,text,uuid)
  to service_role;

revoke all on function public.sellerpilot_read_temu_verified_app_gate_r23(uuid,uuid,uuid),
 public.sellerpilot_read_temu_verified_sources_r23(uuid,uuid,text,text,text,text),
 public.sellerpilot_read_temu_create_source_r23(uuid,uuid,uuid,text),
 public.sellerpilot_record_temu_final_payload_r23(uuid,uuid,uuid,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;
grant execute on function public.sellerpilot_service_read_temu_verified_create_app_gate_v1(uuid,uuid,uuid),
 public.sellerpilot_service_read_temu_verified_authoritative_sources_v1(uuid,uuid,text,text,text,text),
 public.sellerpilot_service_read_temu_create_authoritative_source_v1(uuid,uuid,uuid,text),
 public.sellerpilot_service_record_temu_final_create_payload_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)
 to service_role;
revoke all on function sellerpilot_private.temu_create_source_provider_allowed(uuid,uuid),
 sellerpilot_private.temu_create_source_provider_allowed_r23(uuid,uuid)
 from public,anon,authenticated,service_role,sellerpilot_temu_collector_verifier;

commit;
