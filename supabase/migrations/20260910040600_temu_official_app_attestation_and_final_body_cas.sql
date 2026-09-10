-- Valid UTC migration sequence: 04:05:00 -> 04:06:00.
-- A browser-admin POST is not evidence that Temu granted an app permission.
-- Only a short-lived challenge signed by the configured local collector may
-- feed the CREATE gate. The exact post-normalization arguments and verified
-- image byte identities are then frozen before enqueue and checked again in
-- the worker's atomic pre-provider transaction.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local timezone='UTC';

create function sellerpilot_private.canonical_jsonb_text(p_value jsonb)
returns text language plpgsql immutable security definer set search_path='' as $$
declare v_type text:=jsonb_typeof(p_value); v_result text;
begin
  if v_type='object' then
    select '{'||coalesce(string_agg(to_jsonb(item.key)::text||':'||
      sellerpilot_private.canonical_jsonb_text(item.value),',' order by item.key),'')||'}'
      into v_result from jsonb_each(p_value) item;
    return v_result;
  elsif v_type='array' then
    select '['||coalesce(string_agg(sellerpilot_private.canonical_jsonb_text(item.value),','
      order by item.ordinality),'')||']' into v_result
      from jsonb_array_elements(p_value) with ordinality item(value,ordinality);
    return v_result;
  end if;
  return p_value::text;
end;$$;
revoke all on function sellerpilot_private.canonical_jsonb_text(jsonb)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.constant_time_equal_32(p_left bytea,p_right bytea)
returns boolean language plpgsql immutable security definer set search_path='' as $$
declare v_difference integer:=0; v_index integer;
begin
  if octet_length(p_left)<>32 or octet_length(p_right)<>32 then return false; end if;
  for v_index in 0..31 loop
    v_difference:=v_difference | (get_byte(p_left,v_index) # get_byte(p_right,v_index));
  end loop;
  return v_difference=0;
end;$$;
revoke all on function sellerpilot_private.constant_time_equal_32(bytea,bytea)
  from public,anon,authenticated,service_role;

create table sellerpilot_private.temu_collector_challenges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  expected_app_id text not null check(length(btrim(expected_app_id)) between 1 and 256),
  expected_key_id text not null check(length(btrim(expected_key_id)) between 1 and 128),
  receipt_key_id text not null check(length(btrim(receipt_key_id)) between 1 and 128),
  credential_version integer not null check(credential_version>0),
  credential_fingerprint text not null check(credential_fingerprint~'^[a-f0-9]{64}$'),
  credential_vault_secret_id uuid not null,
  product_revision_fingerprint text not null check(product_revision_fingerprint~'^[a-f0-9]{64}$'),
  nonce_sha256 text not null unique check(nonce_sha256~'^[a-f0-9]{64}$'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check(expires_at>issued_at and expires_at<=issued_at+interval '2 minutes')
);
alter table sellerpilot_private.temu_collector_challenges enable row level security;
revoke all on sellerpilot_private.temu_collector_challenges from public,anon,authenticated,service_role;

create table sellerpilot_private.temu_verified_collector_attestations (
  id uuid primary key default gen_random_uuid(),
  ingest_sequence bigint generated always as identity unique,
  challenge_id uuid not null unique references sellerpilot_private.temu_collector_challenges(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  key_id text not null check(length(key_id) between 1 and 128),
  attestation_sha256 text not null unique check(attestation_sha256~'^[a-f0-9]{64}$'),
  signature_base64 text not null check(signature_base64~'^[A-Za-z0-9+/]{86}==$'),
  signature_sha256 text not null unique check(signature_sha256~'^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  envelope jsonb not null check(jsonb_typeof(envelope)='object' and octet_length(envelope::text)<=32768),
  verified_at timestamptz not null default clock_timestamp(),
  source text not null default 'service_verified_signed_local_collector_v1'
    check(source='service_verified_signed_local_collector_v1')
);
alter table sellerpilot_private.temu_verified_collector_attestations enable row level security;
revoke all on sellerpilot_private.temu_verified_collector_attestations from public,anon,authenticated,service_role;

alter table sellerpilot_private.temu_create_app_gate_observations
  drop constraint temu_create_app_gate_source_exact;
alter table sellerpilot_private.temu_create_app_gate_observations
  add constraint temu_create_app_gate_source_exact check(source in(
    'operator_attested_authenticated_partner_ui_v1',
    'service_verified_signed_local_collector_v1'));
alter table sellerpilot_private.temu_create_app_gate_observations
  add column collector_attestation_id uuid references
    sellerpilot_private.temu_verified_collector_attestations(id) on delete restrict;
alter table sellerpilot_private.temu_authoritative_source_observations
  add column collector_attestation_id uuid references
    sellerpilot_private.temu_verified_collector_attestations(id) on delete restrict;
alter table sellerpilot_private.temu_create_authoritative_sources
  add column collector_attestation_id uuid references
    sellerpilot_private.temu_verified_collector_attestations(id) on delete restrict;

create function sellerpilot_private.bind_temu_create_source_to_collector_attestation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
  v_attestation sellerpilot_private.temu_verified_collector_attestations%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_shipping sellerpilot_private.temu_authoritative_source_observations%rowtype;
  v_egress sellerpilot_private.temu_authoritative_source_observations%rowtype;
begin
  select gate.* into v_app from sellerpilot_private.temu_create_app_gate_observations gate
    join sellerpilot_private.temu_verified_collector_attestations attestation
      on attestation.id=gate.collector_attestation_id
   where gate.owner_id=new.owner_id and gate.product_id=new.product_id
     and gate.credential_id=new.credential_id
     and gate.source='service_verified_signed_local_collector_v1'
   order by attestation.ingest_sequence desc limit 1 for share of gate;
  select * into v_shipping from sellerpilot_private.temu_authoritative_source_observations
   where collector_attestation_id=v_app.collector_attestation_id and source_kind='seller_center_shipping'
   limit 1 for share;
  select * into v_egress from sellerpilot_private.temu_authoritative_source_observations
   where collector_attestation_id=v_app.collector_attestation_id and source_kind='global_egress'
   limit 1 for share;
  select * into v_attestation from sellerpilot_private.temu_verified_collector_attestations
   where id=v_app.collector_attestation_id for share;
  select * into v_credential from sellerpilot_private.channel_credentials
   where id=new.credential_id for share;
  if v_app.id is null or v_app.observed_at<clock_timestamp()-interval '5 minutes'
     or v_app.partner_account_subject<>new.partner_account_subject
     or v_app.app_id<>(new.evidence#>>'{app,appId}')
     or v_app.app_state<>'active' or v_app.compliance_state<>'approved'
     or v_attestation.id is null or v_credential.id is null
     or (v_attestation.envelope->>'credentialVersion')::integer<>new.credential_version
     or v_attestation.envelope->>'credentialFingerprint'<>new.credential_fingerprint
     or (v_attestation.envelope->>'credentialVaultSecretId')::uuid<>v_credential.vault_secret_id
     or v_credential.version<>new.credential_version
     or v_credential.fingerprint<>new.credential_fingerprint
     or not exists(select 1 from vault.decrypted_secrets decrypted
       where decrypted.id=v_credential.vault_secret_id
         and nullif(btrim(decrypted.decrypted_secret::jsonb->>'app_key'),'')=v_app.app_id)
     or v_shipping.id is null or v_shipping.account_subject<>new.partner_account_subject
     or v_shipping.mall_id<>new.mall_id or v_shipping.region_id<>new.region_id
     or v_shipping.product_revision_fingerprint<>new.product_revision_fingerprint
     or v_shipping.payload#>>'{defaultTemplateId}'<>(new.evidence#>>'{shipping,defaultTemplateId}')
     or v_shipping.payload#>>'{warehouseVerified}'<>'true'
     or v_shipping.payload#>>'{feeRuleVerified}'<>'true'
     or v_shipping.payload#>>'{returnPolicyVerified}'<>'true'
     or v_egress.id is null or v_egress.account_subject<>new.partner_account_subject
     or v_egress.mall_id<>new.mall_id or v_egress.region_id<>new.region_id
     or v_egress.product_revision_fingerprint<>new.product_revision_fingerprint
     or v_egress.payload#>>'{endpointHost}'<>'openapi-b-global.temu.com'
     or v_egress.payload#>>'{state}' not in('static_ip_verified','provider_confirmed_no_allowlist')
     or v_egress.payload#>>'{state}'<>(new.evidence#>>'{egress,state}') then
    raise exception 'TEMU_CREATE_SOURCE_COLLECTOR_ATTESTATION_MISMATCH' using errcode='40001'; end if;
  new.collector_attestation_id:=v_app.collector_attestation_id;
  return new;
end;$$;
revoke all on function sellerpilot_private.bind_temu_create_source_to_collector_attestation()
  from public,anon,authenticated,service_role;
create trigger bind_temu_create_source_to_collector_attestation before insert
  on sellerpilot_private.temu_create_authoritative_sources for each row
  execute function sellerpilot_private.bind_temu_create_source_to_collector_attestation();

create function sellerpilot_private.guard_temu_collector_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'TEMU_COLLECTOR_LEDGER_IMMUTABLE' using errcode='55000'; end;$$;
revoke all on function sellerpilot_private.guard_temu_collector_immutable()
  from public,anon,authenticated,service_role;
create trigger guard_temu_verified_collector_immutable before update or delete
  on sellerpilot_private.temu_verified_collector_attestations for each row
  execute function sellerpilot_private.guard_temu_collector_immutable();

create function public.sellerpilot_service_issue_temu_collector_challenge_v1(
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
  if coalesce(p_product_revision_fingerprint,'')!~'^[a-f0-9]{64}$'
     or coalesce(p_nonce_sha256,'')!~'^[a-f0-9]{64}$'
     or nullif(btrim(p_expected_key_id),'') is null or length(p_expected_key_id)>128
     or nullif(btrim(p_receipt_key_id),'') is null or length(p_receipt_key_id)>128
     or not exists(select 1 from vault.decrypted_secrets receipt_policy
       where receipt_policy.name='sellerpilot_temu_collector_db_receipt_policy_v1.'||p_receipt_key_id
         and receipt_policy.decrypted_secret::jsonb->>'status'='current')
     or not exists(select 1 from sellerpilot_private.products p
       where p.id=p_product_id and p.owner_id=p_owner_id)
     or not exists(select 1 from sellerpilot_private.channel_credentials c
       where c.id=p_credential_id and c.created_by=p_owner_id and c.channel='temu'
         and c.environment='production' and c.status='active'
         and(c.expires_at is null or c.expires_at>clock_timestamp())) then
    raise exception 'TEMU_COLLECTOR_CHALLENGE_SCOPE_INVALID' using errcode='22023'; end if;
  select nullif(btrim(d.decrypted_secret::jsonb->>'app_key'),''),c.version,c.fingerprint,c.vault_secret_id
    into v_expected_app_id,v_credential_version,v_credential_fingerprint,v_credential_vault_secret_id
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id=c.vault_secret_id
   where c.id=p_credential_id and c.created_by=p_owner_id and c.channel='temu'
     and c.environment='production' and c.status='active'
     and(c.expires_at is null or c.expires_at>clock_timestamp());
  if v_expected_app_id is null or length(v_expected_app_id)>256 then
    raise exception 'TEMU_COLLECTOR_EXPECTED_APP_ID_UNAVAILABLE' using errcode='22023'; end if;
  insert into sellerpilot_private.temu_collector_challenges(
    owner_id,product_id,credential_id,expected_app_id,expected_key_id,receipt_key_id,
    credential_version,credential_fingerprint,credential_vault_secret_id,
    product_revision_fingerprint,nonce_sha256,expires_at)
  values(p_owner_id,p_product_id,p_credential_id,v_expected_app_id,p_expected_key_id,p_receipt_key_id,
    v_credential_version,v_credential_fingerprint,v_credential_vault_secret_id,
    p_product_revision_fingerprint,p_nonce_sha256,v_expires)
  returning id into v_id;
  return jsonb_build_object('contract','temu_collector_challenge_v1',
    'challengeId',v_id,'expiresAt',v_expires,'expectedAppId',v_expected_app_id,
    'keyId',p_expected_key_id,'receiptKeyId',p_receipt_key_id,
    'credentialVersion',v_credential_version,'credentialFingerprint',v_credential_fingerprint,
    'credentialVaultSecretId',v_credential_vault_secret_id);
end;$$;

create function public.sellerpilot_service_consume_temu_collector_attestation_v1(
  p_attestation jsonb,p_signature_base64 text,p_attestation_sha256 text,
  p_route_receipt_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_challenge sellerpilot_private.temu_collector_challenges%rowtype;
  v_attestation_id uuid:=gen_random_uuid(); v_owner uuid; v_product uuid; v_credential uuid;
  v_observed timestamptz; v_app_revision bigint; v_shipping_revision bigint; v_egress_revision bigint;
  v_source text:='service_verified_signed_local_collector_v1';
  v_signature_sha256 text; v_receipt_secret text; v_receipt_material text;
  v_receipt_policy jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  begin
    v_owner:=(p_attestation->>'ownerId')::uuid;
    v_product:=(p_attestation->>'productId')::uuid;
    v_credential:=(p_attestation->>'credentialId')::uuid;
    v_observed:=(p_attestation->>'observedAt')::timestamptz;
    if coalesce(p_signature_base64,'')!~'^[A-Za-z0-9+/]{86}==$'
       or octet_length(decode(p_signature_base64,'base64'))<>64 then
      raise exception 'signature'; end if;
    v_signature_sha256:=encode(extensions.digest(decode(p_signature_base64,'base64'),'sha256'),'hex');
  exception when others then
    raise exception 'TEMU_COLLECTOR_ATTESTATION_INVALID' using errcode='22023';
  end;
  if jsonb_typeof(p_attestation)<>'object'
     or p_attestation->>'contract'<>'temu_operator_collector_attestation_v1'
     or p_attestation->>'uiContractSha256'<>'8a9403966b16dd11744d181a8280dbc176b76b3a40aa77d4cd8d5ed54025eaca'
     or exists(select 1 from jsonb_object_keys(p_attestation) k where k<>all(array[
       'contract','uiContractSha256','keyId','receiptKeyId','challengeId','nonce','ownerId','productId','credentialId',
       'credentialVersion','credentialFingerprint','credentialVaultSecretId',
       'productRevisionFingerprint','partnerAccountSubject','appId','appState',
       'complianceState','rejectionReason','observedAt','mallId',
       'regionId','shipping','egress']))
     or coalesce(p_attestation->>'keyId','')=''
     or length(p_attestation->>'keyId')>128
     or coalesce(p_attestation->>'receiptKeyId','')=''
     or length(p_attestation->>'receiptKeyId')>128
     or coalesce(p_attestation->>'nonce','')!~'^[A-Za-z0-9_-]{43}$'
     or coalesce(p_attestation_sha256,'')!~'^[a-f0-9]{64}$'
     or not sellerpilot_private.constant_time_equal_32(
       decode(p_attestation_sha256,'hex'),extensions.digest(convert_to(
         sellerpilot_private.canonical_jsonb_text(p_attestation),'UTF8'),'sha256'))
     or coalesce(p_attestation->>'productRevisionFingerprint','')!~'^[a-f0-9]{64}$'
     or coalesce(p_attestation->>'credentialFingerprint','')!~'^[a-f0-9]{64}$'
     or coalesce(p_attestation->>'partnerAccountSubject','')!~'^temu-account:sha256:[a-f0-9]{64}$'
     or coalesce(p_attestation->>'mallId','')!~'^[1-9][0-9]{0,31}$'
     or coalesce(p_attestation->>'regionId','')!~'^[1-9][0-9]{0,31}$'
     or nullif(btrim(p_attestation->>'appId'),'') is null
     or length(p_attestation->>'appId')>256
     or p_attestation->>'appState' not in('active','inactive','unknown')
     or p_attestation->>'complianceState' not in('approved','rejected','reviewing','unknown')
     or v_observed>clock_timestamp() or v_observed<clock_timestamp()-interval '5 minutes'
     or jsonb_typeof(p_attestation->'shipping')<>'object'
     or jsonb_typeof(p_attestation->'egress')<>'object'
     or exists(select 1 from jsonb_object_keys(p_attestation->'shipping') k where k<>all(array[
       'defaultTemplateId','warehouseVerified','feeRuleVerified','returnPolicyVerified']))
     or exists(select 1 from jsonb_object_keys(p_attestation->'egress') k where k<>all(array[
       'state','verificationMethod']))
     or p_attestation#>>'{egress,state}' not in('static_ip_verified','provider_confirmed_no_allowlist','blocked_until_stable_ip','unknown')
     or p_attestation#>>'{egress,verificationMethod}' not in('temu_allowlist_readback','temu_provider_policy_readback','temu_global_endpoint_probe')
     or jsonb_typeof(p_attestation#>'{shipping,warehouseVerified}')<>'boolean'
     or jsonb_typeof(p_attestation#>'{shipping,feeRuleVerified}')<>'boolean'
     or jsonb_typeof(p_attestation#>'{shipping,returnPolicyVerified}')<>'boolean'
     or nullif(btrim(p_attestation#>>'{shipping,defaultTemplateId}'),'') is null then
    raise exception 'TEMU_COLLECTOR_ATTESTATION_INVALID' using errcode='22023'; end if;

  select * into v_challenge from sellerpilot_private.temu_collector_challenges
   where id=(p_attestation->>'challengeId')::uuid for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.expires_at<=clock_timestamp()
     or v_challenge.owner_id<>v_owner or v_challenge.product_id<>v_product
     or v_challenge.credential_id<>v_credential
     or v_challenge.expected_app_id<>(p_attestation->>'appId')
     or v_challenge.expected_key_id<>(p_attestation->>'keyId')
     or v_challenge.receipt_key_id<>(p_attestation->>'receiptKeyId')
     or v_challenge.credential_version<>(p_attestation->>'credentialVersion')::integer
     or v_challenge.credential_fingerprint<>(p_attestation->>'credentialFingerprint')
     or v_challenge.credential_vault_secret_id<>(p_attestation->>'credentialVaultSecretId')::uuid
     or v_challenge.product_revision_fingerprint<>(p_attestation->>'productRevisionFingerprint')
     or v_challenge.nonce_sha256<>encode(extensions.digest(convert_to(p_attestation->>'nonce','UTF8'),'sha256'),'hex') then
    raise exception 'TEMU_COLLECTOR_CHALLENGE_INVALID_OR_CONSUMED' using errcode='40001'; end if;
  if not exists(select 1 from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
    where credential.id=v_credential and credential.created_by=v_owner
      and credential.channel='temu' and credential.environment='production'
      and credential.status='active'
      and(credential.expires_at is null or credential.expires_at>clock_timestamp())
      and credential.version=v_challenge.credential_version
      and credential.fingerprint=v_challenge.credential_fingerprint
      and credential.vault_secret_id=v_challenge.credential_vault_secret_id
      and nullif(btrim(decrypted.decrypted_secret::jsonb->>'app_key'),'')=v_challenge.expected_app_id) then
    raise exception 'TEMU_COLLECTOR_CREDENTIAL_CHANGED' using errcode='40001'; end if;

  select decrypted_secret into v_receipt_secret from vault.decrypted_secrets
   where name='sellerpilot_temu_collector_db_receipt_v1.'||v_challenge.receipt_key_id
   order by created_at desc limit 1;
  select decrypted_secret::jsonb into v_receipt_policy from vault.decrypted_secrets
   where name='sellerpilot_temu_collector_db_receipt_policy_v1.'||v_challenge.receipt_key_id
   order by created_at desc limit 1;
  v_receipt_material:=concat_ws(E'\n','temu_collector_route_receipt_v1',
    p_attestation_sha256,v_signature_sha256,v_challenge.id::text,v_challenge.expected_app_id,
    v_challenge.receipt_key_id);
  if v_receipt_secret is null or v_receipt_secret!~'^[A-Za-z0-9+/]+={0,2}$'
     or v_receipt_policy is null
     or not(v_receipt_policy->>'status'='current' or(
       v_receipt_policy->>'status'='grace'
       and (v_receipt_policy->>'graceUntil')::timestamptz>clock_timestamp()))
     or octet_length(decode(v_receipt_secret,'base64'))<32
     or coalesce(p_route_receipt_sha256,'')!~'^[a-f0-9]{64}$'
     or not sellerpilot_private.constant_time_equal_32(decode(p_route_receipt_sha256,'hex'),
       extensions.hmac(convert_to(v_receipt_material,'UTF8'),decode(v_receipt_secret,'base64'),'sha256')) then
    raise exception 'TEMU_COLLECTOR_ROUTE_RECEIPT_INVALID' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',v_owner,v_product,v_credential),0));
  insert into sellerpilot_private.temu_verified_collector_attestations(
    id,challenge_id,owner_id,product_id,credential_id,key_id,attestation_sha256,
    signature_base64,signature_sha256,observed_at,envelope)
  values(v_attestation_id,v_challenge.id,v_owner,v_product,v_credential,
    p_attestation->>'keyId',p_attestation_sha256,p_signature_base64,v_signature_sha256,v_observed,p_attestation);

  insert into sellerpilot_private.temu_create_app_gate_observations(
    owner_id,product_id,credential_id,partner_account_subject,app_id,app_state,
    compliance_state,rejection_reason,observed_at,evidence_sha256,source,collector_attestation_id)
  values(v_owner,v_product,v_credential,p_attestation->>'partnerAccountSubject',
    p_attestation->>'appId',p_attestation->>'appState',p_attestation->>'complianceState',
    nullif(btrim(p_attestation->>'rejectionReason'),''),v_observed,p_attestation_sha256,
    v_source,v_attestation_id);

  if p_attestation->>'appState'='active' and p_attestation->>'complianceState'='approved' then
    select coalesce(max(source_revision),0)+1 into v_app_revision
      from sellerpilot_private.temu_authoritative_source_observations where owner_id=v_owner
      and product_id=v_product and account_subject=p_attestation->>'partnerAccountSubject'
      and mall_id=p_attestation->>'mallId' and region_id=p_attestation->>'regionId'
      and product_revision_fingerprint=p_attestation->>'productRevisionFingerprint'
      and source_kind='partner_app_management';
    select coalesce(max(source_revision),0)+1 into v_shipping_revision
      from sellerpilot_private.temu_authoritative_source_observations where owner_id=v_owner
      and product_id=v_product and account_subject=p_attestation->>'partnerAccountSubject'
      and mall_id=p_attestation->>'mallId' and region_id=p_attestation->>'regionId'
      and product_revision_fingerprint=p_attestation->>'productRevisionFingerprint'
      and source_kind='seller_center_shipping';
    select coalesce(max(source_revision),0)+1 into v_egress_revision
      from sellerpilot_private.temu_authoritative_source_observations where owner_id=v_owner
      and product_id=v_product and account_subject=p_attestation->>'partnerAccountSubject'
      and mall_id=p_attestation->>'mallId' and region_id=p_attestation->>'regionId'
      and product_revision_fingerprint=p_attestation->>'productRevisionFingerprint'
      and source_kind='global_egress';
    insert into sellerpilot_private.temu_authoritative_source_observations(
      owner_id,product_id,account_subject,mall_id,region_id,product_revision_fingerprint,
      source_kind,source_revision,observed_at,evidence_sha256,payload,collector_attestation_id)
    values
      (v_owner,v_product,p_attestation->>'partnerAccountSubject',p_attestation->>'mallId',p_attestation->>'regionId',
       p_attestation->>'productRevisionFingerprint','partner_app_management',v_app_revision,v_observed,p_attestation_sha256,
       jsonb_build_object('source','temu_authenticated_partner_app_management_v1','rows',jsonb_build_array(
         jsonb_build_object('appId',p_attestation->>'appId','state',p_attestation->>'appState',
           'complianceState',p_attestation->>'complianceState','rejectionReason',p_attestation->'rejectionReason'))),v_attestation_id),
      (v_owner,v_product,p_attestation->>'partnerAccountSubject',p_attestation->>'mallId',p_attestation->>'regionId',
       p_attestation->>'productRevisionFingerprint','seller_center_shipping',v_shipping_revision,v_observed,p_attestation_sha256,
       jsonb_build_object('source','temu_authenticated_seller_center_shipping_v1','defaultTemplateId',p_attestation#>>'{shipping,defaultTemplateId}',
         'warehouseVerified',p_attestation#>'{shipping,warehouseVerified}','feeRuleVerified',p_attestation#>'{shipping,feeRuleVerified}',
         'returnPolicyVerified',p_attestation#>'{shipping,returnPolicyVerified}'),v_attestation_id),
      (v_owner,v_product,p_attestation->>'partnerAccountSubject',p_attestation->>'mallId',p_attestation->>'regionId',
       p_attestation->>'productRevisionFingerprint','global_egress',v_egress_revision,v_observed,p_attestation_sha256,
       jsonb_build_object('source','temu_global_endpoint_egress_attestation_v1','endpointHost','openapi-b-global.temu.com',
         'state',p_attestation#>>'{egress,state}','verificationMethod',p_attestation#>>'{egress,verificationMethod}'),v_attestation_id);
  end if;
  update sellerpilot_private.temu_collector_challenges set consumed_at=clock_timestamp()
    where id=v_challenge.id and consumed_at is null;
  if not found then raise exception 'TEMU_COLLECTOR_CHALLENGE_REPLAY' using errcode='40001'; end if;
  update sellerpilot_private.temu_create_authoritative_current current_source
     set retired_at=clock_timestamp(),retire_reason='collector_attestation_superseded',
         updated_at=clock_timestamp()
    from sellerpilot_private.temu_create_authoritative_sources source
   where current_source.source_id=source.id and current_source.owner_id=v_owner
     and current_source.product_id=v_product and current_source.credential_id=v_credential
     and current_source.retired_at is null
     and source.collector_attestation_id is distinct from v_attestation_id;
  return jsonb_build_object('contract','temu_verified_collector_record_v1','attestationId',v_attestation_id);
end;$$;

create function public.sellerpilot_service_read_temu_verified_create_app_gate_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
  v_attestation sellerpilot_private.temu_verified_collector_attestations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select gate.* into v_app
    from sellerpilot_private.temu_create_app_gate_observations gate
    join sellerpilot_private.temu_verified_collector_attestations attestation
      on attestation.id=gate.collector_attestation_id
   where gate.owner_id=p_owner_id and gate.product_id=p_product_id
     and gate.credential_id=p_credential_id
     and gate.source='service_verified_signed_local_collector_v1'
   order by attestation.ingest_sequence desc limit 1;
  select * into v_attestation from sellerpilot_private.temu_verified_collector_attestations
   where id=v_app.collector_attestation_id;
  if not found or v_app.observed_at<clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('contract','temu_verified_create_app_gate_v1','status','missing'); end if;
  return jsonb_build_object('contract','temu_verified_create_app_gate_v1','status',case
    when v_app.app_state='active' and v_app.compliance_state='approved'
      and v_attestation.envelope#>>'{shipping,warehouseVerified}'='true'
      and v_attestation.envelope#>>'{shipping,feeRuleVerified}'='true'
      and v_attestation.envelope#>>'{shipping,returnPolicyVerified}'='true'
      and v_attestation.envelope#>>'{egress,state}' in('static_ip_verified','provider_confirmed_no_allowlist')
      then 'allowed' else 'blocked' end,
    'appId',v_app.app_id,'appState',v_app.app_state,'complianceState',v_app.compliance_state,
    'rejectionReason',v_app.rejection_reason,'partnerAccountSubject',v_app.partner_account_subject,
    'evidenceSha256',v_app.evidence_sha256,'observedAt',v_app.observed_at,
    'expiresAt',v_app.observed_at+interval '5 minutes','collectorAttestationId',v_app.collector_attestation_id);
end;$$;

create function public.sellerpilot_service_read_temu_verified_authoritative_sources_v1(
  p_owner_id uuid,p_product_id uuid,p_account_subject text,p_mall_id text,
  p_region_id text,p_product_revision_fingerprint text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_app sellerpilot_private.temu_authoritative_source_observations%rowtype;
  v_shipping sellerpilot_private.temu_authoritative_source_observations%rowtype;
  v_egress sellerpilot_private.temu_authoritative_source_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_COLLECTOR_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select observation.* into v_app from sellerpilot_private.temu_authoritative_source_observations observation
    join sellerpilot_private.temu_verified_collector_attestations attestation
      on attestation.id=observation.collector_attestation_id where
    observation.owner_id=p_owner_id and observation.product_id=p_product_id
    and observation.account_subject=p_account_subject and observation.mall_id=p_mall_id
    and observation.region_id=p_region_id
    and observation.product_revision_fingerprint=p_product_revision_fingerprint
    and observation.source_kind='partner_app_management'
    and observation.observed_at between clock_timestamp()-interval '5 minutes' and clock_timestamp()
    order by attestation.ingest_sequence desc limit 1;
  select * into v_shipping from sellerpilot_private.temu_authoritative_source_observations where
    owner_id=p_owner_id and product_id=p_product_id and account_subject=p_account_subject
    and mall_id=p_mall_id and region_id=p_region_id and product_revision_fingerprint=p_product_revision_fingerprint
    and source_kind='seller_center_shipping' and collector_attestation_id=v_app.collector_attestation_id
    and observed_at=v_app.observed_at order by source_revision desc limit 1;
  select * into v_egress from sellerpilot_private.temu_authoritative_source_observations where
    owner_id=p_owner_id and product_id=p_product_id and account_subject=p_account_subject
    and mall_id=p_mall_id and region_id=p_region_id and product_revision_fingerprint=p_product_revision_fingerprint
    and source_kind='global_egress' and collector_attestation_id=v_app.collector_attestation_id
    and observed_at=v_app.observed_at order by source_revision desc limit 1;
  return jsonb_build_object('contract','temu_verified_authoritative_source_bundle_v1',
    'ownerId',p_owner_id,'productId',p_product_id,'accountSubject',p_account_subject,
    'mallId',p_mall_id,'regionId',p_region_id,'productRevisionFingerprint',p_product_revision_fingerprint,
    'readAt',clock_timestamp(),'maxAgeSeconds',300,'collectorAttestationId',v_app.collector_attestation_id,
    'appSnapshot',case when v_app.id is null then null else v_app.payload||jsonb_build_object(
      'observedAt',v_app.observed_at,'sourceRevision',v_app.source_revision,'evidenceSha256',v_app.evidence_sha256) end,
    'shippingSnapshot',case when v_shipping.id is null then null else v_shipping.payload||jsonb_build_object(
      'observedAt',v_shipping.observed_at,'sourceRevision',v_shipping.source_revision,'evidenceSha256',v_shipping.evidence_sha256) end,
    'egressAttestation',case when v_egress.id is null then null else v_egress.payload||jsonb_build_object(
      'observedAt',v_egress.observed_at,'sourceRevision',v_egress.source_revision,'evidenceSha256',v_egress.evidence_sha256) end);
end;$$;

create or replace function public.sellerpilot_service_read_temu_create_authoritative_source_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_request_fingerprint text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select source.* into v_source from sellerpilot_private.temu_create_authoritative_current current_source
    join sellerpilot_private.temu_create_authoritative_sources source on source.id=current_source.source_id
    where current_source.owner_id=p_owner_id and current_source.product_id=p_product_id
      and current_source.credential_id=p_credential_id and current_source.retired_at is null
      and current_source.consumed_job_id is null and source.request_fingerprint=p_request_fingerprint
      and source.expires_at>clock_timestamp();
  if not found then return jsonb_build_object('contract','temu_create_authoritative_source_read_v1','status','missing'); end if;
  return jsonb_build_object('contract','temu_create_authoritative_source_read_v1','status','ready',
    'sourceId',v_source.id,'sourceRevision',v_source.source_revision,'evidenceSha256',v_source.evidence_sha256,
    'requestFingerprint',v_source.request_fingerprint,'productRevisionFingerprint',v_source.product_revision_fingerprint,
    'expiresAt',v_source.expires_at);
end;$$;

create table sellerpilot_private.temu_final_create_payloads(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  attempt_id uuid not null unique references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  source_id uuid not null unique references sellerpilot_private.temu_create_authoritative_sources(id) on delete restrict,
  collector_attestation_id uuid not null references sellerpilot_private.temu_verified_collector_attestations(id) on delete restrict,
  request_fingerprint text not null check(request_fingerprint~'^[a-f0-9]{64}$'),
  final_arguments_sha256 text not null check(final_arguments_sha256~'^[a-f0-9]{64}$'),
  asset_bytes_sha256 text not null check(asset_bytes_sha256~'^[a-f0-9]{64}$'),
  final_arguments jsonb not null check(jsonb_typeof(final_arguments)='object' and octet_length(final_arguments::text)<=128000),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.temu_final_create_payloads enable row level security;
revoke all on sellerpilot_private.temu_final_create_payloads from public,anon,authenticated,service_role;
create trigger guard_temu_final_create_payload_immutable before update or delete
  on sellerpilot_private.temu_final_create_payloads for each row
  execute function sellerpilot_private.guard_temu_collector_immutable();

create function sellerpilot_private.temu_final_asset_bytes_sha256(p_arguments jsonb)
returns text language plpgsql immutable security definer set search_path='' as $$
declare v_binding jsonb:=p_arguments->'sellerpilotPublicationAssetBinding'; v_images jsonb; v_digest text;
begin
  if jsonb_typeof(v_binding)<>'object' or (v_binding->>'contract')<>'sellerpilot_publication_asset_binding_v1'
     or jsonb_typeof(v_binding->'providerTransportImages')<>'array'
     or jsonb_array_length(v_binding->'providerTransportImages')<1
     or jsonb_typeof(v_binding->'approvedDetailImages')<>'array'
     or jsonb_array_length(v_binding->'approvedDetailImages')<1 then return null; end if;
  if exists(select 1 from jsonb_array_elements(v_binding->'approvedDetailImages') image(value)
      where jsonb_typeof(image.value)<>'object'
         or (image.value->>'contentSha256')!~'^[a-f0-9]{64}$'
         or (image.value->>'objectPath')<>('normalized/'||left((image.value->>'contentSha256'),2)||'/'||(image.value->>'contentSha256')||'.jpg'))
     or exists(select 1 from jsonb_array_elements(v_binding->'providerTransportImages') image(value)
      where jsonb_typeof(image.value)<>'object'
         or (image.value->>'contentSha256')!~'^[a-f0-9]{64}$'
         or (image.value->>'objectPath')<>('normalized/'||left((image.value->>'contentSha256'),2)||'/'||(image.value->>'contentSha256')||'.jpg')) then return null; end if;
  v_images:=jsonb_build_object('approved',v_binding->'approvedDetailImages',
    'transport',v_binding->'providerTransportImages');
  v_digest:=encode(extensions.digest(convert_to(v_images::text,'UTF8'),'sha256'),'hex');
  return v_digest;
end;$$;
revoke all on function sellerpilot_private.temu_final_asset_bytes_sha256(jsonb)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_record_temu_final_create_payload_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_attempt_id uuid,p_source_id uuid,
  p_request_fingerprint text,p_final_arguments jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_current sellerpilot_private.temu_create_authoritative_current%rowtype;
  v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
  v_existing sellerpilot_private.temu_final_create_payloads%rowtype;
  v_id uuid:=gen_random_uuid(); v_arguments_sha text; v_assets_sha text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_FINAL_PAYLOAD_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(p_final_arguments)<>'object' or p_final_arguments?'sellerpilotTemuFinalPayload'
     or octet_length(p_final_arguments::text)>128000 then
    raise exception 'TEMU_FINAL_PAYLOAD_INVALID' using errcode='22023'; end if;
  v_arguments_sha:=encode(extensions.digest(convert_to(p_final_arguments::text,'UTF8'),'sha256'),'hex');
  v_assets_sha:=sellerpilot_private.temu_final_asset_bytes_sha256(p_final_arguments);
  if v_assets_sha is null then raise exception 'TEMU_FINAL_ASSET_BYTES_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|',p_owner_id,p_product_id,p_credential_id),0));
  select * into v_attempt from sellerpilot_private.channel_operation_attempts where id=p_attempt_id for share;
  select * into v_source from sellerpilot_private.temu_create_authoritative_sources where id=p_source_id for share;
  select * into v_credential from sellerpilot_private.channel_credentials where id=p_credential_id for share;
  select * into v_current from sellerpilot_private.temu_create_authoritative_current
    where source_id=p_source_id and owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id for update;
  select gate.* into v_app from sellerpilot_private.temu_create_app_gate_observations gate
    join sellerpilot_private.temu_verified_collector_attestations attestation
      on attestation.id=gate.collector_attestation_id
    where gate.owner_id=p_owner_id and gate.product_id=p_product_id
      and gate.credential_id=p_credential_id
      and gate.source='service_verified_signed_local_collector_v1'
    order by attestation.ingest_sequence desc limit 1 for share of gate;
  if v_attempt.id is null or v_attempt.owner_id<>p_owner_id or v_attempt.credential_id<>p_credential_id
     or v_attempt.channel<>'temu' or v_attempt.operation<>'listing.create' or v_attempt.status<>'running'
     or v_attempt.request_fingerprint<>p_request_fingerprint or v_source.id is null
     or v_source.owner_id<>p_owner_id or v_source.product_id<>p_product_id or v_source.credential_id<>p_credential_id
     or v_source.request_fingerprint<>p_request_fingerprint or v_source.expires_at<=clock_timestamp()
     or v_current.source_id is null or v_current.retired_at is not null or v_current.consumed_job_id is not null
     or v_app.id is null or v_app.observed_at<clock_timestamp()-interval '5 minutes'
     or v_app.app_state<>'active' or v_app.compliance_state<>'approved'
     or not exists(select 1 from vault.decrypted_secrets decrypted
       where decrypted.id=v_credential.vault_secret_id
         and nullif(btrim(decrypted.decrypted_secret::jsonb->>'app_key'),'')=v_app.app_id)
     or v_source.collector_attestation_id is null
     or v_source.collector_attestation_id<>v_app.collector_attestation_id
     or (p_final_arguments#>>'{sellerpilotTemuAuthoritativeSource,sourceId}')<>p_source_id::text
     or (p_final_arguments#>>'{sellerpilotTemuAuthoritativeSource,requestFingerprint}')<>p_request_fingerprint then
    raise exception 'TEMU_FINAL_PAYLOAD_SCOPE_CHANGED' using errcode='40001'; end if;
  select * into v_existing from sellerpilot_private.temu_final_create_payloads
    where attempt_id=p_attempt_id or source_id=p_source_id;
  if found then
    if v_existing.attempt_id=p_attempt_id and v_existing.source_id=p_source_id
       and v_existing.final_arguments_sha256=v_arguments_sha and v_existing.asset_bytes_sha256=v_assets_sha
       and v_existing.final_arguments=p_final_arguments then
      return jsonb_build_object('contract','temu_final_create_payload_binding_v1','finalPayloadId',v_existing.id,
        'sourceId',v_existing.source_id,'attemptId',v_existing.attempt_id,
        'finalArgumentsSha256',v_existing.final_arguments_sha256,'assetBytesSha256',v_existing.asset_bytes_sha256);
    end if;
    raise exception 'TEMU_FINAL_PAYLOAD_REPLAY_CONFLICT' using errcode='23505'; end if;
  insert into sellerpilot_private.temu_final_create_payloads(id,owner_id,product_id,credential_id,
    attempt_id,source_id,collector_attestation_id,request_fingerprint,final_arguments_sha256,
    asset_bytes_sha256,final_arguments)
  values(v_id,p_owner_id,p_product_id,p_credential_id,p_attempt_id,p_source_id,
    v_source.collector_attestation_id,p_request_fingerprint,v_arguments_sha,v_assets_sha,p_final_arguments);
  return jsonb_build_object('contract','temu_final_create_payload_binding_v1','finalPayloadId',v_id,
    'sourceId',p_source_id,'attemptId',p_attempt_id,'finalArgumentsSha256',v_arguments_sha,'assetBytesSha256',v_assets_sha);
end;$$;

create or replace function sellerpilot_private.temu_create_source_provider_allowed(
  p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_current sellerpilot_private.temu_create_authoritative_current%rowtype;
  v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
  v_final sellerpilot_private.temu_final_create_payloads%rowtype;
  v_binding jsonb; v_final_binding jsonb; v_unbound jsonb;
begin
  select * into v_job from sellerpilot_private.channel_gateway_jobs where id=p_job_id for update;
  if not found or v_job.channel<>'temu' or v_job.operation<>'listing.create'
     or v_job.environment<>'production' or v_job.status<>'running' or v_job.claim_token<>p_claim_token
     or v_job.lease_expires_at<=clock_timestamp() or v_job.provider_mutation_started_at is not null then return false; end if;
  v_binding:=v_job.request_payload#>'{arguments,sellerpilotTemuAuthoritativeSource}';
  v_final_binding:=v_job.request_payload#>'{arguments,sellerpilotTemuFinalPayload}';
  if jsonb_typeof(v_binding)<>'object' or (v_binding->>'contract')<>'temu_create_authoritative_source_binding_v1'
     or jsonb_typeof(v_final_binding)<>'object' or (v_final_binding->>'contract')<>'temu_final_create_payload_binding_v1' then return false; end if;
  select * into v_source from sellerpilot_private.temu_create_authoritative_sources
   where id=(v_binding->>'sourceId')::uuid for share;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|',v_source.owner_id,v_source.product_id,v_source.credential_id),0));
  select * into v_current from sellerpilot_private.temu_create_authoritative_current
    where owner_id=v_job.created_by and credential_id=v_job.credential_id
      and source_id=(v_binding->>'sourceId')::uuid for update;
  select * into v_credential from sellerpilot_private.channel_credentials where id=v_job.credential_id for share;
  select * into v_product from sellerpilot_private.products where id=v_source.product_id for share;
  select gate.* into v_app from sellerpilot_private.temu_create_app_gate_observations gate
    join sellerpilot_private.temu_verified_collector_attestations attestation
      on attestation.id=gate.collector_attestation_id
    where gate.owner_id=v_source.owner_id and gate.product_id=v_source.product_id
      and gate.credential_id=v_source.credential_id
      and gate.source='service_verified_signed_local_collector_v1'
    order by attestation.ingest_sequence desc limit 1 for share of gate;
  select * into v_final from sellerpilot_private.temu_final_create_payloads
    where id=(v_final_binding->>'finalPayloadId')::uuid and attempt_id=v_job.attempt_id
      and source_id=v_source.id for share;
  v_unbound:=(v_job.request_payload->'arguments')-'sellerpilotTemuFinalPayload';
  if v_current.source_id is null or v_current.retired_at is not null or v_current.consumed_job_id is not null
     or v_current.source_revision<>(v_binding->>'sourceRevision')::bigint or v_current.evidence_sha256<>(v_binding->>'evidenceSha256')
     or v_source.expires_at<=clock_timestamp() or v_source.request_fingerprint<>v_job.request_fingerprint
     or v_source.request_fingerprint<>(v_binding->>'requestFingerprint') or v_source.owner_id<>v_job.created_by
     or v_source.product_revision_fingerprint<>(v_binding->>'productRevisionFingerprint')
     or v_source.product_id<>v_current.product_id or v_product.owner_id<>v_source.owner_id
     or v_product.updated_at<>v_source.product_updated_at or v_credential.created_by<>v_source.owner_id
     or v_credential.channel<>'temu' or v_credential.environment<>'production' or v_credential.status<>'active'
     or(v_credential.expires_at is not null and v_credential.expires_at<=clock_timestamp())
     or v_credential.version<>v_source.credential_version or v_credential.fingerprint<>v_source.credential_fingerprint
     or v_app.id is null or v_app.observed_at<clock_timestamp()-interval '5 minutes'
     or v_app.partner_account_subject<>v_source.partner_account_subject
     or v_app.app_id<>(v_source.evidence#>>'{app,appId}') or v_app.app_state<>'active' or v_app.compliance_state<>'approved'
     or not exists(select 1 from vault.decrypted_secrets decrypted
       where decrypted.id=v_credential.vault_secret_id
         and nullif(btrim(decrypted.decrypted_secret::jsonb->>'app_key'),'')=v_app.app_id)
     or v_source.collector_attestation_id is null
     or v_source.collector_attestation_id<>v_app.collector_attestation_id
     or v_final.id is null or v_final.owner_id<>v_job.created_by or v_final.product_id<>v_source.product_id
     or v_final.credential_id<>v_job.credential_id or v_final.collector_attestation_id<>v_source.collector_attestation_id
     or v_final.request_fingerprint<>v_job.request_fingerprint
     or v_final.final_arguments_sha256<>(v_final_binding->>'finalArgumentsSha256')
     or v_final.asset_bytes_sha256<>(v_final_binding->>'assetBytesSha256')
     or v_final.final_arguments<>v_unbound
     or v_final.final_arguments_sha256<>encode(extensions.digest(convert_to(v_unbound::text,'UTF8'),'sha256'),'hex')
     or v_final.asset_bytes_sha256<>sellerpilot_private.temu_final_asset_bytes_sha256(v_unbound)
     or not sellerpilot_private.temu_create_evidence_valid(v_source.evidence,v_source.product_id,
       v_source.product_revision_fingerprint,v_source.credential_id,v_source.credential_version,
       v_source.partner_account_subject,v_source.token_identity_subject,v_source.mall_id,v_source.region_id,
       v_source.request_fingerprint,v_source.category_plan_sha256,v_source.category_request_sha256,
       v_source.category_response_sha256) then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;

revoke all on function public.sellerpilot_service_issue_temu_collector_challenge_v1(uuid,uuid,uuid,text,text,text,text),
 public.sellerpilot_service_consume_temu_collector_attestation_v1(jsonb,text,text,text),
 public.sellerpilot_service_read_temu_verified_create_app_gate_v1(uuid,uuid,uuid),
 public.sellerpilot_service_read_temu_verified_authoritative_sources_v1(uuid,uuid,text,text,text,text),
 public.sellerpilot_service_record_temu_final_create_payload_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_issue_temu_collector_challenge_v1(uuid,uuid,uuid,text,text,text,text),
 public.sellerpilot_service_consume_temu_collector_attestation_v1(jsonb,text,text,text),
 public.sellerpilot_service_read_temu_verified_create_app_gate_v1(uuid,uuid,uuid),
 public.sellerpilot_service_read_temu_verified_authoritative_sources_v1(uuid,uuid,text,text,text,text),
 public.sellerpilot_service_record_temu_final_create_payload_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)
 to service_role;
revoke all on function sellerpilot_private.temu_create_source_provider_allowed(uuid,uuid)
 from public,anon,authenticated,service_role;

commit;
