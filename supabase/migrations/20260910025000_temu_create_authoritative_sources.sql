-- Append-only, service-role-only evidence for the three non-provider Temu
-- readiness sources. Browser requests cannot insert or read these rows.

begin;

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
  credential_fingerprint text not null check (credential_fingerprint ~ '^[a-f0-9]{64}$'),
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
     or coalesce(p_credential_fingerprint,'')!~'^[a-f0-9]{64}$'
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

commit;
