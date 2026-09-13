-- Credential fingerprint is canonical uppercase 12-character metadata. Evidence SHA256 checks remain 64 characters.
-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from '6985d4a46a007bd47c42496d4dca5c7f' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_gateway_provider_mutation';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_serverless_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from 'bd96f6971641e8ef8953704a480b9506' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_serverless_gateway_provider_mutation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_consume_temu_collector_attestation_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_consume_temu_collector_attestation_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_consume_temu_collector_attestation_v2') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_consume_temu_collector_attestation_v2';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_issue_temu_collector_challenge_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_issue_temu_collector_challenge_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_temu_authoritative_sources_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_temu_authoritative_sources_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_temu_create_app_gate_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_temu_create_app_gate_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_temu_create_authoritative_source_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_temu_create_authoritative_source_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_temu_verified_authoritative_sources_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_temu_verified_authoritative_sources_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_temu_verified_create_app_gate_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_temu_verified_create_app_gate_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_temu_authoritative_source_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_temu_authoritative_source_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_temu_create_app_gate_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_temu_create_app_gate_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_temu_create_authoritative_source_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_temu_create_authoritative_source_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_temu_final_create_payload_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_temu_final_create_payload_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_retire_temu_create_authoritative_source_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_retire_temu_create_authoritative_source_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_temu_create_source_context_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_temu_create_source_context_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_verifier_record_temu_collector_receipt_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_verifier_record_temu_collector_receipt_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='bind_temu_create_source_to_collector_attestation') then raise exception 'RECOVERY_ALREADY_DEFINED:bind_temu_create_source_to_collector_attestation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='canonical_jsonb_text') then raise exception 'RECOVERY_ALREADY_DEFINED:canonical_jsonb_text';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='constant_time_equal_32') then raise exception 'RECOVERY_ALREADY_DEFINED:constant_time_equal_32';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_temu_authoritative_source_append_only') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_temu_authoritative_source_append_only';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_temu_collector_immutable') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_temu_collector_immutable';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_temu_create_source_append_only') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_temu_create_source_append_only';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_attestation_shape_valid') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_attestation_shape_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_create_evidence_valid') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_create_evidence_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_create_source_provider_allowed') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_create_source_provider_allowed';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_create_source_r24_guard') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_create_source_r24_guard';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_current_attestation_valid') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_current_attestation_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_final_asset_bytes_sha256') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_final_asset_bytes_sha256';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='temu_key_policy_active') then raise exception 'RECOVERY_ALREADY_DEFINED:temu_key_policy_active';end if;
end $recovery_guard$;
-- Reviewed source: 20260910025000_temu_create_authoritative_sources.sql
-- Source SHA256: 6e92d01393bdd13d451c7220dcf874c7592cf27de9b5b84b6b8aa1de44276e88
-- Append-only, service-role-only evidence for the three non-provider Temu
-- readiness sources. Browser requests cannot insert or read these rows.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

create table sellerpilot_private.temu_authoritative_source_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  account_subject text not null check (
    account_subject ~ '^temu-account:sha256:[a-f0-9]{64}$'
  ),
  mall_id text not null check (mall_id ~ '^[1-9][0-9]{0,31}$'),
  region_id text not null check (region_id ~ '^[1-9][0-9]{0,31}$'),
  product_revision_fingerprint text not null check (
    product_revision_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  source_kind text not null check (source_kind in (
    'partner_app_management',
    'seller_center_shipping',
    'global_egress'
  )),
  source_revision bigint not null check (source_revision > 0),
  observed_at timestamptz not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 32768
  ),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (
    owner_id, account_subject, mall_id, region_id, product_id,
    product_revision_fingerprint, source_kind, source_revision
  ),
  unique (
    owner_id, account_subject, mall_id, region_id, product_id,
    product_revision_fingerprint, source_kind, evidence_sha256
  )
);

create index temu_authoritative_source_current_idx
  on sellerpilot_private.temu_authoritative_source_observations (
    owner_id, product_id, account_subject, mall_id, region_id,
    product_revision_fingerprint, source_kind, source_revision desc
  );

alter table sellerpilot_private.temu_authoritative_source_observations
  enable row level security;
revoke all on sellerpilot_private.temu_authoritative_source_observations
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_temu_authoritative_source_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TEMU_AUTHORITATIVE_SOURCE_APPEND_ONLY'
    using errcode = '55000';
end;
$$;

revoke all on function
  sellerpilot_private.guard_temu_authoritative_source_append_only()
  from public, anon, authenticated, service_role;

create trigger guard_temu_authoritative_source_append_only
before update or delete
on sellerpilot_private.temu_authoritative_source_observations
for each row execute function
  sellerpilot_private.guard_temu_authoritative_source_append_only();

create function public.sellerpilot_service_record_temu_authoritative_source_v1(
  p_owner_id uuid,
  p_product_id uuid,
  p_account_subject text,
  p_mall_id text,
  p_region_id text,
  p_product_revision_fingerprint text,
  p_source_kind text,
  p_source_revision bigint,
  p_observed_at timestamptz,
  p_evidence_sha256 text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing sellerpilot_private.temu_authoritative_source_observations%rowtype;
  v_expected_revision bigint;
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role' then
    raise exception 'TEMU_AUTHORITATIVE_SOURCE_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_owner_id is null
     or p_product_id is null
     or coalesce(p_account_subject, '')
          !~ '^temu-account:sha256:[a-f0-9]{64}$'
     or coalesce(p_mall_id, '') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(p_region_id, '') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(p_product_revision_fingerprint, '')
          !~ '^[a-f0-9]{64}$'
     or p_source_kind not in (
       'partner_app_management',
       'seller_center_shipping',
       'global_egress'
     )
     or p_source_revision is null
     or p_source_revision < 1
     or p_observed_at is null
     or not isfinite(p_observed_at)
     or p_observed_at > clock_timestamp()
     or p_observed_at < clock_timestamp() - interval '5 minutes'
     or coalesce(p_evidence_sha256, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 32768
     or not exists (
       select 1
         from sellerpilot_private.products product
        where product.id = p_product_id
          and product.owner_id = p_owner_id
     ) then
    raise exception 'TEMU_AUTHORITATIVE_SOURCE_SCOPE_INVALID'
      using errcode = '22023';
  end if;

  if p_source_kind = 'partner_app_management' then
    if p_payload->>'source'
         is distinct from 'temu_authenticated_partner_app_management_v1'
       or jsonb_typeof(p_payload->'rows') is distinct from 'array'
       or jsonb_array_length(p_payload->'rows') > 100
       or exists (
         select 1 from jsonb_object_keys(p_payload) key
          where key <> all(array['source', 'rows'])
       )
       or exists (
         select 1
           from jsonb_array_elements(p_payload->'rows') row_value
          where jsonb_typeof(row_value) is distinct from 'object'
             or nullif(btrim(row_value->>'appId'), '') is null
             or length(row_value->>'appId') > 256
             or row_value->>'state'
                  not in ('active', 'inactive', 'unknown')
             or row_value->>'complianceState'
                  not in ('approved', 'rejected', 'reviewing', 'unknown')
             or (
               jsonb_typeof(row_value->'rejectionReason')
                 not in ('string', 'null')
               or (
                 jsonb_typeof(row_value->'rejectionReason') = 'string'
                 and (
                   nullif(btrim(row_value->>'rejectionReason'), '') is null
                   or length(row_value->>'rejectionReason') > 1000
                 )
               )
             )
             or exists (
               select 1 from jsonb_object_keys(row_value) row_key
                where row_key <> all(array[
                  'appId', 'state', 'complianceState', 'rejectionReason'
                ])
             )
       ) then
      raise exception 'TEMU_AUTHORITATIVE_APP_PAYLOAD_INVALID'
        using errcode = '22023';
    end if;
  elsif p_source_kind = 'seller_center_shipping' then
    if p_payload->>'source'
         is distinct from 'temu_authenticated_seller_center_shipping_v1'
       or jsonb_typeof(p_payload->'warehouseVerified')
            is distinct from 'boolean'
       or jsonb_typeof(p_payload->'feeRuleVerified')
            is distinct from 'boolean'
       or jsonb_typeof(p_payload->'returnPolicyVerified')
            is distinct from 'boolean'
       or jsonb_typeof(p_payload->'defaultTemplateId')
            not in ('string', 'null')
       or (
         jsonb_typeof(p_payload->'defaultTemplateId') = 'string'
         and (
           nullif(btrim(p_payload->>'defaultTemplateId'), '') is null
           or length(p_payload->>'defaultTemplateId') > 256
         )
       )
       or exists (
         select 1 from jsonb_object_keys(p_payload) key
          where key <> all(array[
            'source', 'defaultTemplateId', 'warehouseVerified',
            'feeRuleVerified', 'returnPolicyVerified'
          ])
       ) then
      raise exception 'TEMU_AUTHORITATIVE_SHIPPING_PAYLOAD_INVALID'
        using errcode = '22023';
    end if;
  else
    if p_payload->>'source'
         is distinct from 'temu_global_endpoint_egress_attestation_v1'
       or p_payload->>'endpointHost'
            is distinct from 'openapi-b-global.temu.com'
       or p_payload->>'state' not in (
         'static_ip_verified',
         'provider_confirmed_no_allowlist',
         'blocked_until_stable_ip',
         'unknown'
       )
       or p_payload->>'verificationMethod' not in (
         'temu_allowlist_readback',
         'temu_provider_policy_readback',
         'temu_global_endpoint_probe'
       )
       or (
         p_payload->>'state' = 'static_ip_verified'
         and p_payload->>'verificationMethod' <> 'temu_allowlist_readback'
       )
       or (
         p_payload->>'state' = 'provider_confirmed_no_allowlist'
         and p_payload->>'verificationMethod'
               <> 'temu_provider_policy_readback'
       )
       or exists (
         select 1 from jsonb_object_keys(p_payload) key
          where key <> all(array[
            'source', 'endpointHost', 'state', 'verificationMethod'
          ])
       ) then
      raise exception 'TEMU_AUTHORITATIVE_EGRESS_PAYLOAD_INVALID'
        using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat_ws('|', p_owner_id::text, p_product_id::text,
        p_account_subject, p_mall_id, p_region_id,
        p_product_revision_fingerprint, p_source_kind),
      0
    )
  );

  select observation.* into v_existing
    from sellerpilot_private.temu_authoritative_source_observations observation
   where observation.owner_id = p_owner_id
     and observation.product_id = p_product_id
     and observation.account_subject = p_account_subject
     and observation.mall_id = p_mall_id
     and observation.region_id = p_region_id
     and observation.product_revision_fingerprint
           = p_product_revision_fingerprint
     and observation.source_kind = p_source_kind
     and observation.evidence_sha256 = p_evidence_sha256;
  if found then
    if v_existing.source_revision = p_source_revision
       and v_existing.observed_at = p_observed_at
       and v_existing.payload = p_payload then
      return v_existing.id;
    end if;
    raise exception 'TEMU_AUTHORITATIVE_SOURCE_EVIDENCE_CONFLICT'
      using errcode = '23505';
  end if;

  select coalesce(max(observation.source_revision), 0) + 1
    into v_expected_revision
    from sellerpilot_private.temu_authoritative_source_observations observation
   where observation.owner_id = p_owner_id
     and observation.product_id = p_product_id
     and observation.account_subject = p_account_subject
     and observation.mall_id = p_mall_id
     and observation.region_id = p_region_id
     and observation.product_revision_fingerprint
           = p_product_revision_fingerprint
     and observation.source_kind = p_source_kind;
  if p_source_revision is distinct from v_expected_revision then
    raise exception 'TEMU_AUTHORITATIVE_SOURCE_REVISION_MISMATCH'
      using errcode = '40001';
  end if;

  insert into sellerpilot_private.temu_authoritative_source_observations (
    owner_id, product_id, account_subject, mall_id, region_id,
    product_revision_fingerprint, source_kind, source_revision,
    observed_at, evidence_sha256, payload
  ) values (
    p_owner_id, p_product_id, p_account_subject, p_mall_id, p_region_id,
    p_product_revision_fingerprint, p_source_kind, p_source_revision,
    p_observed_at, p_evidence_sha256, p_payload
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.sellerpilot_service_read_temu_authoritative_sources_v1(
  p_owner_id uuid,
  p_product_id uuid,
  p_account_subject text,
  p_mall_id text,
  p_region_id text,
  p_product_revision_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app sellerpilot_private.temu_authoritative_source_observations%rowtype;
  v_shipping sellerpilot_private.temu_authoritative_source_observations%rowtype;
  v_egress sellerpilot_private.temu_authoritative_source_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role' then
    raise exception 'TEMU_AUTHORITATIVE_SOURCE_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_owner_id is null
     or p_product_id is null
     or coalesce(p_account_subject, '')
          !~ '^temu-account:sha256:[a-f0-9]{64}$'
     or coalesce(p_mall_id, '') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(p_region_id, '') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(p_product_revision_fingerprint, '')
          !~ '^[a-f0-9]{64}$'
     or not exists (
       select 1
         from sellerpilot_private.products product
        where product.id = p_product_id
          and product.owner_id = p_owner_id
     ) then
    raise exception 'TEMU_AUTHORITATIVE_SOURCE_SCOPE_INVALID'
      using errcode = '22023';
  end if;

  select observation.* into v_app
    from sellerpilot_private.temu_authoritative_source_observations observation
   where observation.owner_id = p_owner_id
     and observation.product_id = p_product_id
     and observation.account_subject = p_account_subject
     and observation.mall_id = p_mall_id
     and observation.region_id = p_region_id
     and observation.product_revision_fingerprint
           = p_product_revision_fingerprint
     and observation.source_kind = 'partner_app_management'
     and observation.observed_at <= clock_timestamp()
     and observation.observed_at >= clock_timestamp() - interval '5 minutes'
   order by observation.source_revision desc
   limit 1;

  select observation.* into v_shipping
    from sellerpilot_private.temu_authoritative_source_observations observation
   where observation.owner_id = p_owner_id
     and observation.product_id = p_product_id
     and observation.account_subject = p_account_subject
     and observation.mall_id = p_mall_id
     and observation.region_id = p_region_id
     and observation.product_revision_fingerprint
           = p_product_revision_fingerprint
     and observation.source_kind = 'seller_center_shipping'
     and observation.observed_at <= clock_timestamp()
     and observation.observed_at >= clock_timestamp() - interval '5 minutes'
   order by observation.source_revision desc
   limit 1;

  select observation.* into v_egress
    from sellerpilot_private.temu_authoritative_source_observations observation
   where observation.owner_id = p_owner_id
     and observation.product_id = p_product_id
     and observation.account_subject = p_account_subject
     and observation.mall_id = p_mall_id
     and observation.region_id = p_region_id
     and observation.product_revision_fingerprint
           = p_product_revision_fingerprint
     and observation.source_kind = 'global_egress'
     and observation.observed_at <= clock_timestamp()
     and observation.observed_at >= clock_timestamp() - interval '5 minutes'
   order by observation.source_revision desc
   limit 1;

  return jsonb_build_object(
    'contract', 'temu_authoritative_source_bundle_v1',
    'ownerId', p_owner_id,
    'productId', p_product_id,
    'accountSubject', p_account_subject,
    'mallId', p_mall_id,
    'regionId', p_region_id,
    'productRevisionFingerprint', p_product_revision_fingerprint,
    'readAt', clock_timestamp(),
    'maxAgeSeconds', 300,
    'appSnapshot', case when v_app.id is null then null else
      v_app.payload || jsonb_build_object(
        'observedAt', v_app.observed_at,
        'sourceRevision', v_app.source_revision,
        'evidenceSha256', v_app.evidence_sha256
      ) end,
    'shippingSnapshot', case when v_shipping.id is null then null else
      v_shipping.payload || jsonb_build_object(
        'observedAt', v_shipping.observed_at,
        'sourceRevision', v_shipping.source_revision,
        'evidenceSha256', v_shipping.evidence_sha256
      ) end,
    'egressAttestation', case when v_egress.id is null then null else
      v_egress.payload || jsonb_build_object(
        'observedAt', v_egress.observed_at,
        'sourceRevision', v_egress.source_revision,
        'evidenceSha256', v_egress.evidence_sha256
      ) end
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_record_temu_authoritative_source_v1(
    uuid, uuid, text, text, text, text, text, bigint, timestamptz, text, jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_record_temu_authoritative_source_v1(
    uuid, uuid, text, text, text, text, text, bigint, timestamptz, text, jsonb
  ) to service_role;

revoke all on function
  public.sellerpilot_service_read_temu_authoritative_sources_v1(
    uuid, uuid, text, text, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_read_temu_authoritative_sources_v1(
    uuid, uuid, text, text, text, text
  ) to service_role;

-- A create source is one immutable, complete row.  The smaller observations
-- above are inputs; they are never sufficient to authorize CREATE by
-- themselves.  The mutable current table is only a CAS pointer/consumption
-- fence and contains no provider evidence.
create table sellerpilot_private.temu_create_app_gate_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  partner_account_subject text not null check (partner_account_subject ~ '^temu-account:sha256:[a-f0-9]{64}$'),
  app_id text not null check (length(app_id) between 1 and 256),
  app_state text not null check (app_state in ('active','inactive','unknown')),
  compliance_state text not null check (compliance_state in ('approved','rejected','reviewing','unknown')),
  rejection_reason text check (rejection_reason is null or length(rejection_reason) between 1 and 1000),
  observed_at timestamptz not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(owner_id,product_id,credential_id,evidence_sha256)
);
alter table sellerpilot_private.temu_create_app_gate_observations enable row level security;
revoke all on sellerpilot_private.temu_create_app_gate_observations from public,anon,authenticated,service_role;
create trigger guard_temu_create_app_gate_append_only before update or delete
on sellerpilot_private.temu_create_app_gate_observations for each row
execute function sellerpilot_private.guard_temu_authoritative_source_append_only();

create function public.sellerpilot_service_record_temu_create_app_gate_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_partner_account_subject text,
  p_app_id text,p_app_state text,p_compliance_state text,p_rejection_reason text,
  p_observed_at timestamptz,p_evidence_sha256 text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing sellerpilot_private.temu_create_app_gate_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if coalesce(p_partner_account_subject,'')!~'^temu-account:sha256:[a-f0-9]{64}$'
     or nullif(btrim(p_app_id),'') is null or length(p_app_id)>256
     or p_app_state not in ('active','inactive','unknown')
     or p_compliance_state not in ('approved','rejected','reviewing','unknown')
     or (p_rejection_reason is not null and (nullif(btrim(p_rejection_reason),'') is null or length(p_rejection_reason)>1000))
     or p_observed_at is null or p_observed_at>clock_timestamp() or p_observed_at<clock_timestamp()-interval '5 minutes'
     or coalesce(p_evidence_sha256,'')!~'^[a-f0-9]{64}$'
     or not exists(select 1 from sellerpilot_private.products where id=p_product_id and owner_id=p_owner_id)
     or not exists(select 1 from sellerpilot_private.channel_credentials where id=p_credential_id
       and created_by=p_owner_id and channel='temu' and environment='production') then
    raise exception 'TEMU_CREATE_APP_GATE_INVALID' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws('|',p_owner_id::text,p_product_id::text,p_credential_id::text,'app'),0));
  select * into v_existing from sellerpilot_private.temu_create_app_gate_observations
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
     and evidence_sha256=p_evidence_sha256;
  if found then
    if v_existing.partner_account_subject<>p_partner_account_subject or v_existing.app_id<>p_app_id
       or v_existing.app_state<>p_app_state or v_existing.compliance_state<>p_compliance_state
       or v_existing.rejection_reason is distinct from p_rejection_reason or v_existing.observed_at<>p_observed_at then
      raise exception 'TEMU_CREATE_APP_GATE_REPLAY_CONFLICT' using errcode='23505'; end if;
    return v_existing.id;
  end if;
  insert into sellerpilot_private.temu_create_app_gate_observations(
    owner_id,product_id,credential_id,partner_account_subject,app_id,app_state,
    compliance_state,rejection_reason,observed_at,evidence_sha256
  ) values (p_owner_id,p_product_id,p_credential_id,p_partner_account_subject,p_app_id,p_app_state,
    p_compliance_state,p_rejection_reason,p_observed_at,p_evidence_sha256) returning id into v_id;
  return v_id;
end;
$$;

create table sellerpilot_private.temu_create_authoritative_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  source_revision bigint not null check (source_revision > 0),
  product_revision text not null check (product_revision ~ '^[1-9][0-9]{0,31}$'),
  product_revision_fingerprint text not null check (product_revision_fingerprint ~ '^[a-f0-9]{64}$'),
  product_updated_at timestamptz not null,
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (credential_fingerprint ~ '^[A-F0-9]{12}$'),
  partner_account_subject text not null check (partner_account_subject ~ '^temu-account:sha256:[a-f0-9]{64}$'),
  token_identity_subject text not null check (token_identity_subject ~ '^temu:sha256:[a-f0-9]{64}$'),
  mall_id text not null check (mall_id ~ '^[1-9][0-9]{0,31}$'),
  region_id text not null check (region_id ~ '^[1-9][0-9]{0,31}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  category_plan_sha256 text not null check (category_plan_sha256 ~ '^[a-f0-9]{64}$'),
  category_request_sha256 text not null check (category_request_sha256 ~ '^[a-f0-9]{64}$'),
  category_response_sha256 text not null check (category_response_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 131072
  ),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (owner_id, product_id, credential_id, source_revision),
  unique (owner_id, product_id, credential_id, evidence_sha256)
);

create table sellerpilot_private.temu_create_authoritative_current (
  owner_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  source_id uuid not null references sellerpilot_private.temu_create_authoritative_sources(id) on delete restrict,
  source_revision bigint not null check (source_revision > 0),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  consumed_job_id uuid,
  consumed_claim_token uuid,
  consumed_at timestamptz,
  retired_at timestamptz,
  retire_reason text check (retire_reason is null or (length(retire_reason) between 1 and 128)),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, product_id, credential_id),
  unique (source_id),
  check ((consumed_job_id is null) = (consumed_claim_token is null)),
  check ((consumed_job_id is null) = (consumed_at is null))
);

alter table sellerpilot_private.temu_create_authoritative_sources enable row level security;
alter table sellerpilot_private.temu_create_authoritative_current enable row level security;
revoke all on sellerpilot_private.temu_create_authoritative_sources from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.temu_create_authoritative_current from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_temu_create_source_append_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'TEMU_CREATE_AUTHORITATIVE_SOURCE_APPEND_ONLY' using errcode='55000';
end;
$$;
revoke all on function sellerpilot_private.guard_temu_create_source_append_only()
  from public, anon, authenticated, service_role;
create trigger guard_temu_create_source_append_only before update or delete
on sellerpilot_private.temu_create_authoritative_sources for each row
execute function sellerpilot_private.guard_temu_create_source_append_only();

create function sellerpilot_private.temu_create_evidence_valid(
  p_evidence jsonb,
  p_product_id uuid,
  p_product_revision_fingerprint text,
  p_credential_id uuid,
  p_credential_version integer,
  p_partner_account_subject text,
  p_token_identity_subject text,
  p_mall_id text,
  p_region_id text,
  p_request_fingerprint text,
  p_category_plan_sha256 text,
  p_category_request_sha256 text,
  p_category_response_sha256 text
)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_evidence)='object'
    and p_evidence->>'contract'='temu_create_authoritative_source_v1'
    and p_evidence#>>'{product,productId}'=p_product_id::text
    and p_evidence#>>'{product,revisionFingerprint}'=p_product_revision_fingerprint
    and p_evidence#>>'{credential,credentialId}'=p_credential_id::text
    and (p_evidence#>>'{credential,version}')::integer=p_credential_version
    and p_evidence#>>'{account,partnerAccountSubject}'=p_partner_account_subject
    and p_evidence#>>'{account,tokenIdentitySubject}'=p_token_identity_subject
    and p_evidence#>>'{account,mallId}'=p_mall_id
    and p_evidence#>>'{account,regionId}'=p_region_id
    and p_evidence->>'requestFingerprint'=p_request_fingerprint
    and p_evidence#>>'{app,state}'='active'
    and p_evidence#>>'{app,complianceState}'='approved'
    and nullif(btrim(p_evidence#>>'{app,appId}'),'') is not null
    and p_evidence#>>'{credential,active}'='true'
    and p_evidence#>>'{category,categoryPlanSha256}'=p_category_plan_sha256
    and p_evidence#>>'{category,requestEvidenceSha256}'=p_category_request_sha256
    and p_evidence#>>'{category,responseEvidenceSha256}'=p_category_response_sha256
    and p_evidence#>>'{category,leafCategoryVerified}'='true'
    and p_evidence#>>'{category,categoryRecommendationVerified}'='true'
    and p_evidence#>>'{category,categoryAttributesVerified}'='true'
    and p_evidence#>>'{category,categoryComplianceVerified}'='true'
    and p_evidence#>>'{category,certificationDecisionVerified}'='true'
    and p_evidence#>>'{shipping,storeDefaultShippingVerified}'='true'
    and p_evidence#>>'{shipping,warehouseVerified}'='true'
    and p_evidence#>>'{shipping,feeRuleVerified}'='true'
    and p_evidence#>>'{shipping,returnPolicyVerified}'='true'
    and nullif(btrim(p_evidence#>>'{shipping,defaultTemplateId}'),'') is not null
    and p_evidence#>>'{egress,endpointHost}'='openapi-b-global.temu.com'
    and p_evidence#>>'{egress,state}' in ('static_ip_verified','provider_confirmed_no_allowlist')
    and jsonb_typeof(p_evidence#>'{assets,representativeImages}')='array'
    and jsonb_array_length(p_evidence#>'{assets,representativeImages}')=1
    and jsonb_typeof(p_evidence#>'{assets,detailImages}')='array'
    and jsonb_array_length(p_evidence#>'{assets,detailImages}')=8
    and p_evidence#>>'{assets,productId}'=p_product_id::text
    and p_evidence#>>'{assets,productRevisionFingerprint}'=p_product_revision_fingerprint
    and p_evidence#>>'{duplicateRead,goodsReadComplete}'='true'
    and p_evidence#>>'{duplicateRead,skuReadComplete}'='true'
    and p_evidence#>>'{duplicateRead,goodsEmpty}'='true'
    and p_evidence#>>'{duplicateRead,skuEmpty}'='true'
    and p_evidence#>>'{duplicateRead,continuationPresent}'='false'
    and p_evidence#>>'{duplicateRead,existingGoodsRecoveryUsed}'='false'
$$;
revoke all on function sellerpilot_private.temu_create_evidence_valid(
  jsonb,uuid,text,uuid,integer,text,text,text,text,text,text,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_record_temu_create_authoritative_source_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_source_revision bigint,
  p_product_revision text,p_product_revision_fingerprint text,p_product_updated_at timestamptz,
  p_credential_version integer,p_credential_fingerprint text,
  p_partner_account_subject text,p_token_identity_subject text,p_mall_id text,p_region_id text,
  p_request_fingerprint text,p_category_plan_sha256 text,p_category_request_sha256 text,
  p_category_response_sha256 text,p_observed_at timestamptz,p_expires_at timestamptz,
  p_evidence_sha256 text,p_evidence jsonb,p_expected_current_source_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
  v_current sellerpilot_private.temu_create_authoritative_current%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
  v_replayed boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if p_source_revision<1 or p_observed_at is null or p_expires_at is null
     or p_observed_at>clock_timestamp() or p_observed_at<clock_timestamp()-interval '5 minutes'
     or p_expires_at<=clock_timestamp() or p_expires_at>p_observed_at+interval '5 minutes'
     or coalesce(p_product_revision,'')!~'^[1-9][0-9]{0,31}$'
     or coalesce(p_product_revision_fingerprint,'')!~'^[a-f0-9]{64}$'
     or coalesce(p_credential_fingerprint,'')!~'^[A-F0-9]{12}$'
     or coalesce(p_partner_account_subject,'')!~'^temu-account:sha256:[a-f0-9]{64}$'
     or coalesce(p_token_identity_subject,'')!~'^temu:sha256:[a-f0-9]{64}$'
     or coalesce(p_mall_id,'')!~'^[1-9][0-9]{0,31}$'
     or coalesce(p_region_id,'')!~'^[1-9][0-9]{0,31}$'
     or coalesce(p_request_fingerprint,'')!~'^[a-f0-9]{64}$'
     or coalesce(p_category_plan_sha256,'')!~'^[a-f0-9]{64}$'
     or coalesce(p_category_request_sha256,'')!~'^[a-f0-9]{64}$'
     or coalesce(p_category_response_sha256,'')!~'^[a-f0-9]{64}$'
     or coalesce(p_evidence_sha256,'')!~'^[a-f0-9]{64}$'
     or not sellerpilot_private.temu_create_evidence_valid(
       p_evidence,p_product_id,p_product_revision_fingerprint,p_credential_id,p_credential_version,
       p_partner_account_subject,p_token_identity_subject,p_mall_id,p_region_id,p_request_fingerprint,
       p_category_plan_sha256,p_category_request_sha256,p_category_response_sha256
     ) then raise exception 'TEMU_CREATE_SOURCE_INVALID' using errcode='22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws('|',p_owner_id::text,p_product_id::text,p_credential_id::text),0));
  select * into v_product from sellerpilot_private.products where id=p_product_id for share;
  select * into v_credential from sellerpilot_private.channel_credentials where id=p_credential_id for share;
  select * into v_app from sellerpilot_private.temu_create_app_gate_observations
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
   order by observed_at desc,recorded_at desc,id desc limit 1 for share;
  if not found or v_product.owner_id<>p_owner_id or v_product.updated_at<>p_product_updated_at
     or v_credential.created_by<>p_owner_id or v_credential.channel<>'temu'
     or v_credential.environment<>'production' or v_credential.status<>'active'
     or (v_credential.expires_at is not null and v_credential.expires_at<=clock_timestamp())
     or v_credential.version<>p_credential_version or v_credential.fingerprint<>p_credential_fingerprint
     or v_credential.seller_account_key is null
     or v_app.partner_account_subject<>p_partner_account_subject
     or v_app.app_id<>p_evidence#>>'{app,appId}'
     or v_app.app_state<>'active' or v_app.compliance_state<>'approved'
     or v_app.observed_at<clock_timestamp()-interval '5 minutes' then
    raise exception 'TEMU_CREATE_SOURCE_CURRENT_SCOPE_MISMATCH' using errcode='40001';
  end if;
  select * into v_current from sellerpilot_private.temu_create_authoritative_current
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id for update;

  select * into v_source from sellerpilot_private.temu_create_authoritative_sources
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
     and evidence_sha256=p_evidence_sha256;
  if found then
    if v_source.source_revision<>p_source_revision or v_source.request_fingerprint<>p_request_fingerprint
       or v_source.evidence<>p_evidence then
      raise exception 'TEMU_CREATE_SOURCE_REPLAY_CONFLICT' using errcode='23505';
    end if;
    if v_current.source_id is distinct from v_source.id or v_current.retired_at is not null
       or v_current.consumed_job_id is not null then
      raise exception 'TEMU_CREATE_SOURCE_REPLAY_NOT_CURRENT' using errcode='40001';
    end if;
    v_replayed := true;
  else
    if (v_current.source_id is null and p_expected_current_source_id is not null)
       or (v_current.source_id is not null and v_current.source_id is distinct from p_expected_current_source_id)
       or p_source_revision<>coalesce(v_current.source_revision,0)+1 then
      raise exception 'TEMU_CREATE_SOURCE_CAS_MISMATCH' using errcode='40001';
    end if;
    insert into sellerpilot_private.temu_create_authoritative_sources(
      owner_id,product_id,credential_id,source_revision,product_revision,product_revision_fingerprint,
      product_updated_at,credential_version,credential_fingerprint,partner_account_subject,
      token_identity_subject,mall_id,region_id,request_fingerprint,category_plan_sha256,
      category_request_sha256,category_response_sha256,evidence_sha256,observed_at,expires_at,evidence
    ) values (
      p_owner_id,p_product_id,p_credential_id,p_source_revision,p_product_revision,p_product_revision_fingerprint,
      p_product_updated_at,p_credential_version,p_credential_fingerprint,p_partner_account_subject,
      p_token_identity_subject,p_mall_id,p_region_id,p_request_fingerprint,p_category_plan_sha256,
      p_category_request_sha256,p_category_response_sha256,p_evidence_sha256,p_observed_at,p_expires_at,p_evidence
    ) returning * into v_source;
  end if;

  insert into sellerpilot_private.temu_create_authoritative_current(
    owner_id,product_id,credential_id,source_id,source_revision,evidence_sha256
  ) values (p_owner_id,p_product_id,p_credential_id,v_source.id,v_source.source_revision,v_source.evidence_sha256)
  on conflict(owner_id,product_id,credential_id) do update set
    source_id=excluded.source_id,source_revision=excluded.source_revision,evidence_sha256=excluded.evidence_sha256,
    consumed_job_id=null,consumed_claim_token=null,consumed_at=null,retired_at=null,retire_reason=null,
    updated_at=clock_timestamp();
  return jsonb_build_object('contract','temu_create_authoritative_source_record_v1','sourceId',v_source.id,
    'sourceRevision',v_source.source_revision,'evidenceSha256',v_source.evidence_sha256,'replayed',v_replayed);
end;
$$;

create function public.sellerpilot_service_read_temu_create_app_gate_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select * into v_app from sellerpilot_private.temu_create_app_gate_observations
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
   order by observed_at desc,recorded_at desc,id desc limit 1;
  if not found or v_app.observed_at<clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('contract','temu_create_app_gate_v1','status','missing'); end if;
  return jsonb_build_object('contract','temu_create_app_gate_v1','status',case
    when v_app.app_state='active' and v_app.compliance_state='approved'
      then 'allowed' else 'blocked' end,
    'appState',v_app.app_state,'complianceState',v_app.compliance_state,
    'observedAt',v_app.observed_at,'expiresAt',v_app.observed_at+interval '5 minutes');
end;
$$;

create function public.sellerpilot_service_read_temu_create_authoritative_source_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_request_fingerprint text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select source.* into v_source
    from sellerpilot_private.temu_create_authoritative_current current_source
    join sellerpilot_private.temu_create_authoritative_sources source on source.id=current_source.source_id
   where current_source.owner_id=p_owner_id and current_source.product_id=p_product_id
     and current_source.credential_id=p_credential_id and current_source.retired_at is null
     and current_source.consumed_job_id is null and source.request_fingerprint=p_request_fingerprint
     and source.expires_at>clock_timestamp();
  if not found then return jsonb_build_object('contract','temu_create_authoritative_source_read_v1','status','missing'); end if;
  return jsonb_build_object('contract','temu_create_authoritative_source_read_v1','status','ready',
    'sourceId',v_source.id,'sourceRevision',v_source.source_revision,'evidenceSha256',v_source.evidence_sha256,
    'requestFingerprint',v_source.request_fingerprint,'expiresAt',v_source.expires_at);
end;
$$;

create function public.sellerpilot_service_retire_temu_create_authoritative_source_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid,p_expected_source_id uuid,
  p_expected_evidence_sha256 text,p_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  update sellerpilot_private.temu_create_authoritative_current set retired_at=clock_timestamp(),
    retire_reason=left(nullif(btrim(p_reason),''),128),updated_at=clock_timestamp()
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
     and source_id=p_expected_source_id and evidence_sha256=p_expected_evidence_sha256
     and retired_at is null and consumed_job_id is null;
  return found;
end;
$$;

create function sellerpilot_private.temu_create_source_provider_allowed(
  p_job_id uuid,p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_current sellerpilot_private.temu_create_authoritative_current%rowtype;
  v_source sellerpilot_private.temu_create_authoritative_sources%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
  v_binding jsonb;
begin
  select * into v_job from sellerpilot_private.channel_gateway_jobs where id=p_job_id for update;
  if not found or v_job.channel<>'temu' or v_job.operation<>'listing.create'
     or v_job.environment<>'production' or v_job.status<>'running' or v_job.claim_token<>p_claim_token
     or v_job.lease_expires_at<=clock_timestamp() or v_job.provider_mutation_started_at is not null then return false; end if;
  v_binding:=v_job.request_payload#>'{arguments,sellerpilotTemuAuthoritativeSource}';
  if jsonb_typeof(v_binding)<>'object' or v_binding->>'contract'<>'temu_create_authoritative_source_binding_v1' then return false; end if;
  select * into v_current from sellerpilot_private.temu_create_authoritative_current
   where owner_id=v_job.created_by and credential_id=v_job.credential_id
     and source_id=(v_binding->>'sourceId')::uuid for update;
  if not found or v_current.retired_at is not null or v_current.consumed_job_id is not null
     or v_current.source_revision<>(v_binding->>'sourceRevision')::bigint
     or v_current.evidence_sha256<>v_binding->>'evidenceSha256' then return false; end if;
  select * into v_source from sellerpilot_private.temu_create_authoritative_sources where id=v_current.source_id for share;
  select * into v_credential from sellerpilot_private.channel_credentials where id=v_job.credential_id for share;
  select * into v_product from sellerpilot_private.products where id=v_source.product_id for share;
  select * into v_app from sellerpilot_private.temu_create_app_gate_observations
   where owner_id=v_source.owner_id and product_id=v_source.product_id
     and credential_id=v_source.credential_id
   order by observed_at desc,recorded_at desc,id desc limit 1 for share;
  if v_source.expires_at<=clock_timestamp() or v_source.request_fingerprint<>v_job.request_fingerprint
     or v_source.request_fingerprint<>v_binding->>'requestFingerprint'
     or v_source.owner_id<>v_job.created_by or v_source.product_id<>v_current.product_id
     or v_product.owner_id<>v_source.owner_id or v_product.updated_at<>v_source.product_updated_at
     or v_credential.created_by<>v_source.owner_id or v_credential.channel<>'temu'
     or v_credential.environment<>'production' or v_credential.status<>'active'
     or (v_credential.expires_at is not null and v_credential.expires_at<=clock_timestamp())
     or v_credential.version<>v_source.credential_version or v_credential.fingerprint<>v_source.credential_fingerprint
     or v_app.observed_at<clock_timestamp()-interval '5 minutes'
     or v_app.partner_account_subject<>v_source.partner_account_subject
     or v_app.app_id<>v_source.evidence#>>'{app,appId}'
     or v_app.app_state<>'active' or v_app.compliance_state<>'approved'
     or not sellerpilot_private.temu_create_evidence_valid(
       v_source.evidence,v_source.product_id,v_source.product_revision_fingerprint,v_source.credential_id,
       v_source.credential_version,v_source.partner_account_subject,v_source.token_identity_subject,
       v_source.mall_id,v_source.region_id,v_source.request_fingerprint,v_source.category_plan_sha256,
       v_source.category_request_sha256,v_source.category_response_sha256
     ) then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
revoke all on function sellerpilot_private.temu_create_source_provider_allowed(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Wrap both execution modes.  The current-row lock remains held until the
-- previous begin boundary and pointer consumption finish in this transaction.
alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_100250_begin_gateway_before_temu_create_source;
revoke all on function public.sellerpilot_100250_begin_gateway_before_temu_create_source(text,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_is_temu boolean; v_started boolean;
begin
  select channel='temu' and operation='listing.create' into v_is_temu
    from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  if not coalesce(v_is_temu,false) then
    return public.sellerpilot_100250_begin_gateway_before_temu_create_source(p_token_hash,p_job_id,p_claim_token); end if;
  if not sellerpilot_private.temu_create_source_provider_allowed(p_job_id,p_claim_token) then return false; end if;
  v_started:=public.sellerpilot_100250_begin_gateway_before_temu_create_source(p_token_hash,p_job_id,p_claim_token);
  if not coalesce(v_started,false) then return false; end if;
  update sellerpilot_private.temu_create_authoritative_current set
    consumed_job_id=p_job_id,consumed_claim_token=p_claim_token,consumed_at=clock_timestamp(),updated_at=clock_timestamp()
   where source_id=(select (request_payload#>>'{arguments,sellerpilotTemuAuthoritativeSource,sourceId}')::uuid
                      from sellerpilot_private.channel_gateway_jobs where id=p_job_id)
     and consumed_job_id is null and retired_at is null;
  if not found then raise exception 'TEMU_CREATE_SOURCE_CONSUMPTION_FAILED' using errcode='40001'; end if;
  return true;
end;
$$;

do $temu_serverless_wrap$
begin
  if to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_100250_begin_serverless_before_temu_create_source';
  execute 'revoke all on function public.sellerpilot_100250_begin_serverless_before_temu_create_source(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute $fn$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path = '' as $body$
    declare v_is_temu boolean; v_started boolean;
    begin
      select channel='temu' and operation='listing.create' into v_is_temu
        from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
      if not coalesce(v_is_temu,false) then
        return public.sellerpilot_100250_begin_serverless_before_temu_create_source(p_token_hash,p_job_id,p_claim_token); end if;
      if not sellerpilot_private.temu_create_source_provider_allowed(p_job_id,p_claim_token) then return false; end if;
      v_started:=public.sellerpilot_100250_begin_serverless_before_temu_create_source(p_token_hash,p_job_id,p_claim_token);
      if not coalesce(v_started,false) then return false; end if;
      update sellerpilot_private.temu_create_authoritative_current set
        consumed_job_id=p_job_id,consumed_claim_token=p_claim_token,consumed_at=clock_timestamp(),updated_at=clock_timestamp()
       where source_id=(select (request_payload#>>'{arguments,sellerpilotTemuAuthoritativeSource,sourceId}')::uuid
                          from sellerpilot_private.channel_gateway_jobs where id=p_job_id)
         and consumed_job_id is null and retired_at is null;
      if not found then raise exception 'TEMU_CREATE_SOURCE_CONSUMPTION_FAILED' using errcode='40001'; end if;
      return true;
    end;$body$
  $fn$;
end;
$temu_serverless_wrap$;

revoke all on function public.sellerpilot_service_record_temu_create_authoritative_source_v1(
  uuid,uuid,uuid,bigint,text,text,timestamptz,integer,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_record_temu_create_authoritative_source_v1(
  uuid,uuid,uuid,bigint,text,text,timestamptz,integer,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,jsonb,uuid
) to service_role;
revoke all on function public.sellerpilot_service_record_temu_create_app_gate_v1(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_record_temu_create_app_gate_v1(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,text
) to service_role;
revoke all on function public.sellerpilot_service_read_temu_create_app_gate_v1(uuid,uuid,uuid),
  public.sellerpilot_service_read_temu_create_authoritative_source_v1(uuid,uuid,uuid,text),
  public.sellerpilot_service_retire_temu_create_authoritative_source_v1(uuid,uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_read_temu_create_app_gate_v1(uuid,uuid,uuid),
  public.sellerpilot_service_read_temu_create_authoritative_source_v1(uuid,uuid,uuid,text),
  public.sellerpilot_service_retire_temu_create_authoritative_source_v1(uuid,uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;
do $grant_serverless$
begin
  if to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is not null then
    execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) from public,anon,authenticated,service_role';
    execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role';
  end if;
end;$grant_serverless$;


-- Reviewed source: 20260910033000_temu_create_producer_context.sql
-- Source SHA256: 7968b7aa5d6dd9e51f0bad69a4943040a7b52fc86619d25a262380ea760aae33
-- Service-only, read-only snapshot used by the Temu listing.create producer.
-- It exposes no credential secret and is rechecked by the append CAS in 025000.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

create or replace function public.sellerpilot_service_read_temu_create_app_gate_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_app sellerpilot_private.temu_create_app_gate_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select * into v_app from sellerpilot_private.temu_create_app_gate_observations
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id
   order by observed_at desc,recorded_at desc,id desc limit 1;
  if not found or v_app.observed_at<clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('contract','temu_create_app_gate_v1','status','missing'); end if;
  return jsonb_build_object('contract','temu_create_app_gate_v1','status',case
    when v_app.app_state='active' and v_app.compliance_state='approved'
      then 'allowed' else 'blocked' end,
    'appId',v_app.app_id,'appState',v_app.app_state,
    'complianceState',v_app.compliance_state,
    'rejectionReason',v_app.rejection_reason,
    'partnerAccountSubject',v_app.partner_account_subject,
    'evidenceSha256',v_app.evidence_sha256,
    'observedAt',v_app.observed_at,'expiresAt',v_app.observed_at+interval '5 minutes');
end;
$$;

create function public.sellerpilot_service_temu_create_source_context_v1(
  p_owner_id uuid,p_product_id uuid,p_credential_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_current sellerpilot_private.temu_create_authoritative_current%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'TEMU_CREATE_SOURCE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select * into v_product from sellerpilot_private.products
   where id=p_product_id and owner_id=p_owner_id;
  select * into v_credential from sellerpilot_private.channel_credentials
   where id=p_credential_id and created_by=p_owner_id and channel='temu'
     and environment='production' and status='active';
  if v_product.id is null or v_credential.id is null
     or (v_credential.expires_at is not null and v_credential.expires_at<=clock_timestamp())
     or v_credential.seller_account_key is null then
    return jsonb_build_object('contract','temu_create_source_context_v1','status','missing');
  end if;
  select * into v_current from sellerpilot_private.temu_create_authoritative_current
   where owner_id=p_owner_id and product_id=p_product_id and credential_id=p_credential_id;
  return jsonb_build_object(
    'contract','temu_create_source_context_v1','status','ready',
    'productUpdatedAt',v_product.updated_at,
    'productRevision',greatest(coalesce(v_product.detail_page_version,0),1)::text,
    'credentialVersion',v_credential.version,
    'credentialFingerprint',v_credential.fingerprint,
    'credentialEnvironment',v_credential.environment,
    'currentSourceId',v_current.source_id,
    'currentSourceRevision',coalesce(v_current.source_revision,0),
    'readAt',clock_timestamp());
end;
$$;

revoke all on function public.sellerpilot_service_temu_create_source_context_v1(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_temu_create_source_context_v1(uuid,uuid,uuid)
  to service_role;


-- Reviewed source: 20260910040500_temu_operator_app_observation_source.sql
-- Source SHA256: 76abdf13b73a6323839df5e74633d41b59c8b19f8d8d27340c3f1596fc5008e5
-- Valid UTC migration sequence: 03:30:00 -> 04:05:00.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table sellerpilot_private.temu_create_app_gate_observations
  add column if not exists source text not null
  default 'operator_attested_authenticated_partner_ui_v1';
alter table sellerpilot_private.temu_create_app_gate_observations
  add constraint temu_create_app_gate_source_exact check (
    source='operator_attested_authenticated_partner_ui_v1'
  );

-- Reviewed source: 20260910040600_temu_official_app_attestation_and_final_body_cas.sql
-- Source SHA256: ab767f35fab01dc37c6d5c58a4144caf3550cd6d640d95033f6a10fdee81ba52
-- Valid UTC migration sequence: 04:05:00 -> 04:06:00.
-- A browser-admin POST is not evidence that Temu granted an app permission.
-- Only a short-lived challenge signed by the configured local collector may
-- feed the CREATE gate. The exact post-normalization arguments and verified
-- image byte identities are then frozen before enqueue and checked again in
-- the worker's atomic pre-provider transaction.

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
  credential_fingerprint text not null check(credential_fingerprint~'^[A-F0-9]{12}$'),
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
     or coalesce(p_attestation->>'credentialFingerprint','')!~'^[A-F0-9]{12}$'
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


-- Reviewed source: 20260910045500_temu_verified_receipt_and_null_safe_attestation_r24.sql
-- Source SHA256: b0bcb33c57e094e35f52cf2fdbfcafabe5013f1d2c7e309b18cdc48b1f8098c1
-- Route crypto verification is represented by a one-time receipt which only a
-- dedicated PostgREST role may mint. service_role can consume, never mint it.
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
     or ((p_value->>'credentialFingerprint')~'^[A-F0-9]{12}$') is not true
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
