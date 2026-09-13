-- Integrated Elevenst recovery. No approval or provider job is inserted here.
-- Preserves the currently installed non-Elevenst mutation/completion functions.
-- Repairs absent approval-request references using the actual source approval ledger,
-- restores r6 GET-only evidence, and binds image bytes before immutable approval.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_approve_elevenst_new_product_source') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_approve_elevenst_new_product_source';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_elevenst_final_provider_mutation') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_begin_elevenst_final_provider_mutation';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from 'd11cb3c4efc837b2cfd379a331572a0c' then raise exception 'ELEVENST_RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_gateway_provider_mutation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_serverless_11st_final_mutation') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_begin_serverless_11st_final_mutation';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_serverless_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from 'e897e3a921f042a53d543243e09e627a' then raise exception 'ELEVENST_RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_serverless_gateway_provider_mutation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_bind_elevenst_new_product_execution') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_bind_elevenst_new_product_execution';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_claim_elevenst_create_recovery') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_claim_elevenst_create_recovery';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_complete_gateway_transaction' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text, p_response_payload jsonb, p_error_message text, p_credential_refresh jsonb, p_normalized_orders jsonb, p_normalized_inquiries jsonb, p_diagnostic jsonb') is distinct from '969527261a9b1e993f444759da30e367' then raise exception 'ELEVENST_RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_complete_gateway_transaction';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_elevenst_new_product_approval_context') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_elevenst_new_product_approval_context';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_elevenst_new_product_source') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_elevenst_new_product_source';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_elevenst_new_product_source_readback') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_elevenst_new_product_source_readback';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_finish_elevenst_create_recovery') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_finish_elevenst_create_recovery';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_retire_elevenst_new_product_source') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_retire_elevenst_new_product_source';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_seal_elevenst_new_product_final_body') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:sellerpilot_service_seal_elevenst_new_product_final_body';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_begin_final_provider_mutation') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_begin_final_provider_mutation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_current_six_kind_digest') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_current_six_kind_digest';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_execution_reconciliation_convergence') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_execution_reconciliation_convergence';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_execution_source_advisory_lock') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_execution_source_advisory_lock';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_final_execution_seal') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_final_execution_seal';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_full_create_completion_valid') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_full_create_completion_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_new_product_execution_binding') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_new_product_execution_binding';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_new_product_job_source_current') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_new_product_job_source_current';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_new_product_source_approval_hash') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:elevenst_new_product_source_approval_hash';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='prevent_elevenst_new_product_source_mutation') then raise exception 'ELEVENST_RECOVERY_ALREADY_DEFINED:prevent_elevenst_new_product_source_mutation';end if;
end $recovery_guard$;
create function sellerpilot_private.elevenst_jsonb_exact_keys(p_value jsonb,p_keys text[])
returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)='object' then
   (select array_agg(k order by k collate "C") from jsonb_object_keys(p_value) k)
   is not distinct from (select array_agg(k order by k collate "C") from unnest(p_keys) k)
 else false end
$$;
create function sellerpilot_private.elevenst_canonical_json(p_value jsonb)
returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then
  select '{'||coalesce(string_agg(to_jsonb(entry.key)::text||':'||sellerpilot_private.elevenst_canonical_json(entry.value),',' order by entry.key collate "C"),'')||'}'
   into result from jsonb_each(p_value) entry;
 when 'array' then
  select '['||coalesce(string_agg(sellerpilot_private.elevenst_canonical_json(entry.value),',' order by entry.ordinality),'')||']'
   into result from jsonb_array_elements(p_value) with ordinality entry(value,ordinality);
 else result:=coalesce(p_value::text,'null');
 end case;
 return result;
end $$;
create function sellerpilot_private.elevenst_canonical_sha256(p_value jsonb)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(sellerpilot_private.elevenst_canonical_json(p_value),'sha256'),'hex')
$$;
revoke all on function sellerpilot_private.elevenst_jsonb_exact_keys(jsonb,text[]),
 sellerpilot_private.elevenst_canonical_json(jsonb),sellerpilot_private.elevenst_canonical_sha256(jsonb)
 from public,anon,authenticated,service_role;

-- Reviewed source: 20260910022500_elevenst_new_product_server_sources.sql
-- Original SHA256: b78d0b8ba9a0a622a51b56808494f8060724600bb5aadffdbf6ab68cba5f413d
-- Service-only, exact source ledger for an Elevenst processed-food CREATE.
-- This migration creates no operating approval rows and performs no provider work.

create table sellerpilot_private.elevenst_new_product_server_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  category_id text not null check (category_id = '1346631'),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  product_updated_at timestamptz not null,
  product_revision bigint not null check (product_revision > 0),
  product_approval_revision bigint not null check (product_approval_revision > 0),
  approved_price_krw integer not null check (approved_price_krw > 0),
  approved_inventory_quantity integer not null check (approved_inventory_quantity >= 0),
  provider_product jsonb not null check (
    jsonb_typeof(provider_product) = 'object'
    and octet_length(provider_product::text) <= 262144
    and provider_product->>'dispCtgrNo' = '1346631'
    and nullif(btrim(provider_product->>'prdNm'), '') is not null
    and nullif(btrim(provider_product->>'sellerPrdCd'), '') is not null
    and provider_product->>'selPrc' ~ '^[0-9]+$'
    and provider_product->>'prdSelQty' ~ '^[0-9]+$'
    and not (provider_product ? 'ProductNotification')
  ),
  provider_product_sha256 text not null check (provider_product_sha256 ~ '^[a-f0-9]{64}$'),
  notices jsonb not null check (
    jsonb_typeof(notices) = 'array'
    and jsonb_array_length(notices) = 10
    and octet_length(notices::text) <= 131072
  ),
  seller_receipt jsonb not null check (
    jsonb_typeof(seller_receipt) = 'object'
    and octet_length(seller_receipt::text) <= 8192
  ),
  availability_receipt jsonb not null check (
    jsonb_typeof(availability_receipt) = 'object'
    and octet_length(availability_receipt::text) <= 8192
  ),
  policy_source jsonb not null check (
    jsonb_typeof(policy_source) = 'object'
    and octet_length(policy_source::text) <= 262144
  ),
  policy_source_revision bigint not null check (policy_source_revision > 0),
  policy_approval_revision bigint not null check (policy_approval_revision > 0),
  approved_at timestamptz not null,
  status text not null default 'approved' check (status in ('approved', 'retired')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (owner_id = created_by),
  check (product_approval_revision = product_revision),
  check ((provider_product->>'selPrc')::numeric = approved_price_krw),
  check ((provider_product->>'prdSelQty')::numeric = approved_inventory_quantity)
);

create unique index elevenst_new_product_one_approved_source_idx
  on sellerpilot_private.elevenst_new_product_server_sources(product_id, credential_id)
  where status = 'approved';

create index elevenst_new_product_source_lookup_idx
  on sellerpilot_private.elevenst_new_product_server_sources(
    owner_id, product_id, category_id, credential_id, credential_version,
    product_revision, product_approval_revision
  );

revoke all on sellerpilot_private.elevenst_new_product_server_sources
  from public, anon, authenticated, service_role;

create function sellerpilot_private.prevent_elevenst_new_product_source_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_DELETE_FORBIDDEN';
  end if;
  if old.status = 'approved'
     and new.status = 'retired'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_IMMUTABLE';
end;
$$;

create trigger elevenst_new_product_source_immutable
before update or delete on sellerpilot_private.elevenst_new_product_server_sources
for each row execute function sellerpilot_private.prevent_elevenst_new_product_source_mutation();

create function public.sellerpilot_service_elevenst_new_product_source(
  p_kind text,
  p_owner_id uuid,
  p_product_id uuid,
  p_category_id text,
  p_credential_id uuid,
  p_credential_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  product_row sellerpilot_private.products%rowtype;
  credential_row sellerpilot_private.channel_credentials%rowtype;
begin
  if p_kind not in ('product', 'credential', 'notices', 'seller', 'availability', 'policy')
     or p_owner_id is null
     or p_product_id is null
     or p_category_id is distinct from '1346631'
     or p_credential_id is null
     or p_credential_version is null
     or p_credential_version < 1 then
    return null;
  end if;

  select * into product_row
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = p_owner_id
     and not product.demo
     and product.status  is distinct from  'archived';
  if not found then return null; end if;

  select * into credential_row
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.created_by = p_owner_id
     and credential.channel = 'elevenst'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = p_credential_version
     and (credential.expires_at is null or credential.expires_at > clock_timestamp());
  if not found then return null; end if;

  select * into source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.category_id = p_category_id
     and source.credential_id = p_credential_id
     and source.credential_version = p_credential_version
     and source.status = 'approved'
     and source.product_updated_at = product_row.updated_at
     and source.product_revision = product_row.detail_page_version
     and source.product_approval_revision = product_row.detail_page_approved_version
     and product_row.detail_page_version > 0
     and product_row.detail_page_approved_version = product_row.detail_page_version
     and source.approved_at <= clock_timestamp()
     and source.provider_product->>'prdNm' = product_row.name
     and source.provider_product->>'sellerPrdCd' = product_row.sku
     and (source.provider_product->>'prdSelQty')::integer = product_row.on_hand
     and source.approved_inventory_quantity = product_row.on_hand;
  if not found then return null; end if;

  if p_kind = 'product' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_server_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'categoryId', source_row.category_id,
      'revision', source_row.product_revision,
      'approvalRevision', source_row.product_approval_revision,
      'providerProduct', source_row.provider_product,
      'providerProductSha256', source_row.provider_product_sha256
    );
  elsif p_kind = 'credential' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_credential_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'credentialId', credential_row.id,
      'credentialVersion', credential_row.version,
      'channel', credential_row.channel,
      'environment', credential_row.environment,
      'status', credential_row.status
    );
  elsif p_kind = 'notices' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_notice_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'categoryId', source_row.category_id,
      'productRevision', source_row.product_revision,
      'notices', source_row.notices
    );
  elsif p_kind = 'seller' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_seller_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'credentialId', source_row.credential_id,
      'credentialVersion', source_row.credential_version,
      'receipt', source_row.seller_receipt
    );
  elsif p_kind = 'availability' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_availability_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'credentialId', source_row.credential_id,
      'credentialVersion', source_row.credential_version,
      'receipt', source_row.availability_receipt
    );
  end if;

  return source_row.policy_source || jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_policy_source_v1',
    'current', true,
    'ownerId', source_row.owner_id,
    'productId', source_row.product_id,
    'categoryId', source_row.category_id,
    'productRevision', source_row.product_revision,
    'sourceRevision', source_row.policy_source_revision,
    'approvalRevision', source_row.policy_approval_revision,
    'approvedAt', source_row.approved_at
  );
end;
$$;

revoke all on function public.sellerpilot_service_elevenst_new_product_source(
  text, uuid, uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_elevenst_new_product_source(
  text, uuid, uuid, text, uuid, integer
) to service_role;


-- Reviewed source: 20260910030000_elevenst_new_product_source_approval.sql
-- Original SHA256: 3624fc0378aa851bfcac5818963f9d9a1019b49d1b868c772eb3228a7db0882b
-- Server-owned production and approval boundary for the Elevenst 1346631
-- source ledger. This migration creates no approval rows and calls no provider.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702600);

do $migration$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.elevenst_new_product_server_sources'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_registration_drafts'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create table sellerpilot_private.elevenst_new_product_source_approvals (
  source_id uuid primary key references
    sellerpilot_private.elevenst_new_product_server_sources(id) on delete restrict,
  approval_request_id uuid not null unique,
  actor_id uuid not null references auth.users(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  draft_version bigint not null check (draft_version > 0),
  detail_manifest_digest text not null check (
    detail_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  approval_payload_sha256 text not null check (
    approval_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  approved_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table sellerpilot_private.elevenst_new_product_source_retirements (
  id bigint generated always as identity primary key,
  source_id uuid not null references
    sellerpilot_private.elevenst_new_product_server_sources(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (
    pg_catalog.char_length(pg_catalog.btrim(reason)) between 1 and 500
    and reason !~ '[[:cntrl:]]'
  ),
  retired_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on sellerpilot_private.elevenst_new_product_source_approvals
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.elevenst_new_product_source_retirements
  from public, anon, authenticated, service_role;
revoke all on sequence
  sellerpilot_private.elevenst_new_product_source_retirements_id_seq
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_new_product_source_approval_hash(
  p_payload jsonb
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      coalesce(p_payload, 'null'::jsonb)::text,
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function
  sellerpilot_private.elevenst_new_product_source_approval_hash(jsonb)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_elevenst_new_product_approval_context(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  product_row sellerpilot_private.products%rowtype;
  credential_row sellerpilot_private.channel_credentials%rowtype;
  draft_row sellerpilot_private.product_registration_drafts%rowtype;
  assignment_row sellerpilot_private.product_category_assignments%rowtype;
  source_paths jsonb;
  channel_draft jsonb;
  detail_paths jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null
     or p_product_id is null
     or p_credential_id is null
     or nullif(pg_catalog.btrim(p_market), '') is null
     or nullif(pg_catalog.btrim(p_target_id), '') is null
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor_id
     ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  select product.* into product_row
    from sellerpilot_private.products product
   where product.id = p_product_id
     and not product.demo
     and product.status  is distinct from  'archived';
  if not found then return null; end if;

  select credential.* into credential_row
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.created_by = product_row.owner_id
     and credential.channel = 'elevenst'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.statement_timestamp());
  if not found then return null; end if;

  select assignment.* into assignment_row
    from sellerpilot_private.product_category_assignments assignment
   where assignment.owner_id = product_row.owner_id
     and assignment.product_id = product_row.id
     and assignment.channel = 'elevenst'
     and assignment.environment = 'production'
     and assignment.market = pg_catalog.btrim(p_market)
     and assignment.category_id = '1346631'
     and assignment.status = 'confirmed'
     and assignment.is_leaf
     and assignment.confirmed_at is not null;
  if not found then return null; end if;

  select draft.* into draft_row
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = product_row.owner_id
     and draft.draft_id = product_row.id
     and draft.kind = 'publish'
     and draft.product_id = product_row.id;
  if not found then return null; end if;

  select entry.value into channel_draft
    from pg_catalog.jsonb_each(
      case when pg_catalog.jsonb_typeof(draft_row.data->'channels') = 'object'
        then draft_row.data->'channels' else '{}'::jsonb end
    ) entry
   where entry.key::jsonb = pg_catalog.to_jsonb(array[
       'elevenst', pg_catalog.btrim(p_market), pg_catalog.btrim(p_target_id),
       credential_row.id::text
     ])
     and entry.value->>'categoryId' = '1346631';
  if not found then return null; end if;

  if product_row.detail_page_version < 1
     or product_row.on_hand < 1
     or product_row.detail_page_approved_version
       is distinct from product_row.detail_page_version
     or pg_catalog.jsonb_typeof(product_row.detail_page_image_manifest)  is distinct from  'object'
     or product_row.detail_page_image_manifest->>'digest'
       !~ '^[a-f0-9]{64}$'
     or pg_catalog.jsonb_typeof(
       product_row.detail_page_image_manifest->'images'
     )  is distinct from  'array'
     or pg_catalog.jsonb_array_length(
       product_row.detail_page_image_manifest->'images'
     )  is distinct from  8
     or coalesce(draft_row.data#>>'{common,price}', '') !~ '^[0-9]+$'
     or coalesce(draft_row.data#>>'{common,quantity}', '') !~ '^[0-9]+$'
     or draft_row.data#>>'{common,fields,productName}'
       is distinct from product_row.name
     or nullif(pg_catalog.btrim(
       draft_row.data#>>'{common,fields,brandName}'
     ), '') is null
     or nullif(pg_catalog.btrim(
       draft_row.data#>>'{common,fields,countryOfOrigin}'
     ), '') is null then
    return null;
  end if;
  if (draft_row.data#>>'{common,price}')::numeric <= 0
     or pg_catalog.mod((draft_row.data#>>'{common,price}')::numeric, 10)  is distinct from  0
     or (draft_row.data#>>'{common,price}')::numeric
        is distinct from  pg_catalog.trunc((draft_row.data#>>'{common,price}')::numeric)
     or (draft_row.data#>>'{common,quantity}')::numeric
        is distinct from  product_row.on_hand then
    return null;
  end if;

  select coalesce(pg_catalog.jsonb_agg(path order by ordinal), '[]'::jsonb)
    into source_paths
    from (
      select item.value #>> '{}' as path, item.ordinality as ordinal
        from sellerpilot_private.ai_cli_jobs job
        cross join lateral pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(job.request_payload->'image_paths') = 'array'
            then job.request_payload->'image_paths' else '[]'::jsonb end
        ) with ordinality item(value, ordinality)
       where job.id = product_row.ai_job_id
         and job.created_by = product_row.owner_id
         and item.value #>> '{}' like product_row.owner_id::text || '/%'
    ) paths;

  select coalesce(
      pg_catalog.jsonb_agg(image.value->>'path' order by image.ordinality),
      '[]'::jsonb
    )
    into detail_paths
    from pg_catalog.jsonb_array_elements(
      product_row.detail_page_image_manifest->'images'
    ) with ordinality image(value, ordinality)
   where nullif(pg_catalog.btrim(image.value->>'path'), '') is not null;
  if coalesce(pg_catalog.jsonb_array_length(source_paths), 0)  is distinct from  4
     or coalesce(pg_catalog.jsonb_array_length(detail_paths), 0)  is distinct from  8 then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_approval_context_v1',
    'actorId', p_actor_id,
    'ownerId', product_row.owner_id,
    'productId', product_row.id,
    'productUpdatedAt', product_row.updated_at,
    'productRevision', product_row.detail_page_version,
    'productApprovalRevision', product_row.detail_page_approved_version,
    'productName', product_row.name,
    'sellerProductCode', product_row.sku,
    'inventoryQuantity', product_row.on_hand,
    'credentialId', credential_row.id,
    'credentialVersion', credential_row.version,
    'draftVersion', draft_row.version,
    'approvedPriceKrw', (draft_row.data#>>'{common,price}')::integer,
    'approvedQuantity', (draft_row.data#>>'{common,quantity}')::integer,
    'brand', pg_catalog.btrim(
      draft_row.data#>>'{common,fields,brandName}'
    ),
    'countryOfOrigin', pg_catalog.btrim(
      draft_row.data#>>'{common,fields,countryOfOrigin}'
    ),
    'conditionCode', '01',
    'productImagePaths', source_paths,
    'detailImagePaths', detail_paths,
    'detailManifestDigest', product_row.detail_page_image_manifest->>'digest'
  );
end;
$$;

create function public.sellerpilot_service_approve_elevenst_new_product_source(
  p_actor_id uuid,
  p_approval_request_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  existing_approval sellerpilot_private.elevenst_new_product_source_approvals%rowtype;
  payload_hash text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_approval_request_id is null
     or pg_catalog.jsonb_typeof(p_payload)  is distinct from  'object'
     or pg_catalog.octet_length(p_payload::text) > 786432 then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  if coalesce(p_payload->>'credentialVersion', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'productRevision', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'productApprovalRevision', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'draftVersion', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload#>>'{providerProduct,selPrc}', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload#>>'{providerProduct,prdSelQty}', '') !~ '^[0-9]+$'
     or coalesce(p_payload#>>'{sellerReceipt,credentialVersion}', '')
       !~ '^[1-9][0-9]*$'
     or coalesce(p_payload#>>'{policySource,shipping,shippingFeeKrw}', '')
       !~ '^[0-9]+$'
     or coalesce(p_payload->>'policySourceRevision', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'policyApprovalRevision', '') !~ '^[1-9][0-9]*$' then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  context_value := public.sellerpilot_service_elevenst_new_product_approval_context(
    p_actor_id, p_product_id, p_credential_id, p_market, p_target_id
  );
  if context_value is null then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONTEXT_STALE'
      using errcode = '40001';
  end if;
  payload_hash := sellerpilot_private.elevenst_new_product_source_approval_hash(
    p_payload
  );

  select approval.* into existing_approval
    from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.approval_request_id = p_approval_request_id;
  if found then
    if existing_approval.actor_id = p_actor_id
       and existing_approval.product_id = p_product_id
       and existing_approval.credential_id = p_credential_id
       and existing_approval.approval_payload_sha256 = payload_hash then
      return pg_catalog.jsonb_build_object(
        'status', 'existing', 'sourceId', existing_approval.source_id,
        'approvalPayloadSha256', payload_hash
      );
    end if;
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_REQUEST_CONFLICT'
      using errcode = '23505';
  end if;

  if p_payload->>'contract'
       is distinct from 'sellerpilot_elevenst_new_product_source_approval_v1'
     or p_payload->>'approvalRequestId'
       is distinct from p_approval_request_id::text
     or p_payload->>'actorId' is distinct from p_actor_id::text
     or p_payload->>'ownerId' is distinct from context_value->>'ownerId'
     or p_payload->>'productId' is distinct from context_value->>'productId'
     or p_payload->>'categoryId' is distinct from '1346631'
     or p_payload->>'credentialId'
       is distinct from context_value->>'credentialId'
     or (p_payload->>'credentialVersion')::integer
       is distinct from (context_value->>'credentialVersion')::integer
     or p_payload->>'productUpdatedAt'
       is distinct from context_value->>'productUpdatedAt'
     or (p_payload->>'productRevision')::bigint
       is distinct from (context_value->>'productRevision')::bigint
     or (p_payload->>'productApprovalRevision')::bigint
       is distinct from (context_value->>'productApprovalRevision')::bigint
     or (p_payload->>'draftVersion')::bigint
       is distinct from (context_value->>'draftVersion')::bigint
     or p_payload->>'detailManifestDigest'
       is distinct from context_value->>'detailManifestDigest'
     or pg_catalog.jsonb_typeof(p_payload->'providerProduct')  is distinct from  'object'
     or p_payload#>>'{providerProduct,dispCtgrNo}' is distinct from '1346631'
     or p_payload#>>'{providerProduct,prdNm}'
       is distinct from context_value->>'productName'
     or p_payload#>>'{providerProduct,sellerPrdCd}'
       is distinct from context_value->>'sellerProductCode'
     or (p_payload#>>'{providerProduct,selPrc}')::integer
       is distinct from (context_value->>'approvedPriceKrw')::integer
     or (p_payload#>>'{providerProduct,prdSelQty}')::integer
       is distinct from (context_value->>'approvedQuantity')::integer
     or p_payload#>>'{providerProduct,brand}'
       is distinct from context_value->>'brand'
     or p_payload#>>'{providerProduct,orgnNmVal}'
       is distinct from context_value->>'countryOfOrigin'
     or p_payload#>>'{providerProduct,prdStatCd}'
       is distinct from context_value->>'conditionCode'
     or p_payload->>'providerProductSha256' !~ '^[a-f0-9]{64}$'
     or pg_catalog.jsonb_typeof(p_payload->'notices')  is distinct from  'array'
     or pg_catalog.jsonb_array_length(p_payload->'notices')  is distinct from  10
     or (select pg_catalog.array_agg(notice.value->>'code' order by notice.ordinality)
           from pg_catalog.jsonb_array_elements(p_payload->'notices')
             with ordinality notice(value, ordinality))
       is distinct from array[
         '176400445','176398001','42154823','23757260','23757095',
         '176312674','23756754','23757245','42155152','23757000'
       ]::text[]
     or p_payload#>>'{sellerReceipt,credentialId}'
       is distinct from context_value->>'credentialId'
     or (p_payload#>>'{sellerReceipt,credentialVersion}')::integer
       is distinct from (context_value->>'credentialVersion')::integer
     or p_payload#>>'{sellerReceipt,sellerIdSha256}'
       is distinct from p_payload#>>'{sellerReceipt,sellerOfficeAccountSha256}'
     or p_payload#>>'{sellerReceipt,sellerIdSha256}' !~ '^[a-f0-9]{64}$'
     or p_payload#>>'{availabilityReceipt,state}' is distinct from 'available'
     or (p_payload#>>'{policySource,shipping,shippingFeeKrw}')::integer
       is distinct from 3000
     or p_payload#>>'{policySource,shipping,deliveryCostBasisCode}'
       is distinct from '02'
     or p_payload#>>'{policySource,shipping,paymentTypeCode}'
       is distinct from '03'
     or coalesce(pg_catalog.jsonb_array_length(
       p_payload#>'{policySource,content,productImageUrls}'
     ), -1)  is distinct from  4
     or coalesce(pg_catalog.jsonb_array_length(
       p_payload#>'{policySource,content,detailImageUrls}'
     ), -1)  is distinct from  8
     or (p_payload->>'policySourceRevision')::bigint
       is distinct from (context_value->>'draftVersion')::bigint
     or (p_payload->>'policyApprovalRevision')::bigint
       is distinct from (context_value->>'draftVersion')::bigint then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from sellerpilot_private.elevenst_new_product_server_sources source
     where source.product_id = p_product_id
       and source.credential_id = p_credential_id
       and source.status = 'approved'
  ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ALREADY_EXISTS'
      using errcode = '23505';
  end if;

  insert into sellerpilot_private.elevenst_new_product_server_sources (
    owner_id, product_id, category_id, credential_id, credential_version,
    product_updated_at, product_revision, product_approval_revision,
    approved_price_krw, approved_inventory_quantity, provider_product,
    provider_product_sha256, notices, seller_receipt, availability_receipt,
    policy_source, policy_source_revision, policy_approval_revision,
    approved_at, created_by
  ) values (
    (context_value->>'ownerId')::uuid,
    p_product_id,
    '1346631',
    p_credential_id,
    (context_value->>'credentialVersion')::integer,
    (context_value->>'productUpdatedAt')::timestamptz,
    (context_value->>'productRevision')::bigint,
    (context_value->>'productApprovalRevision')::bigint,
    (context_value->>'approvedPriceKrw')::integer,
    (context_value->>'approvedQuantity')::integer,
    p_payload->'providerProduct',
    p_payload->>'providerProductSha256',
    p_payload->'notices',
    p_payload->'sellerReceipt',
    p_payload->'availabilityReceipt',
    p_payload->'policySource',
    (p_payload->>'policySourceRevision')::bigint,
    (p_payload->>'policyApprovalRevision')::bigint,
    pg_catalog.clock_timestamp(),
    (context_value->>'ownerId')::uuid
  ) returning * into source_row;

  insert into sellerpilot_private.elevenst_new_product_source_approvals (
    source_id, approval_request_id, actor_id, owner_id, product_id,
    credential_id, credential_version, draft_version,
    detail_manifest_digest, approval_payload_sha256
  ) values (
    source_row.id, p_approval_request_id, p_actor_id, source_row.owner_id,
    source_row.product_id, source_row.credential_id,
    source_row.credential_version, (context_value->>'draftVersion')::bigint,
    context_value->>'detailManifestDigest', payload_hash
  );

  return pg_catalog.jsonb_build_object(
    'status', 'approved', 'sourceId', source_row.id,
    'approvalPayloadSha256', payload_hash
  );
end;
$$;

create function public.sellerpilot_service_retire_elevenst_new_product_source(
  p_actor_id uuid,
  p_source_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null
     or p_source_id is null
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_reason, '')))
       not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor_id
     ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_RETIRE_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  select source.* into source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id = p_source_id
   for update;
  if not found then return false; end if;
  if source_row.status = 'retired' then return true; end if;

  update sellerpilot_private.elevenst_new_product_server_sources source
     set status = 'retired'
   where source.id = source_row.id;
  insert into sellerpilot_private.elevenst_new_product_source_retirements (
    source_id, actor_id, reason
  ) values (source_row.id, p_actor_id, pg_catalog.btrim(p_reason));
  return true;
end;
$$;

revoke all on function
  public.sellerpilot_service_elevenst_new_product_approval_context(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid, uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_retire_elevenst_new_product_source(
    uuid, uuid, text
  ) from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_elevenst_new_product_approval_context(
    uuid, uuid, uuid, text, text
  ) to service_role;
grant execute on function
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid, uuid, uuid, uuid, text, text, jsonb
  ) to service_role;
grant execute on function
  public.sellerpilot_service_retire_elevenst_new_product_source(
    uuid, uuid, text
  ) to service_role;


-- Reviewed source: 20260910031600_elevenst_new_product_source_readback.sql
-- Original SHA256: 5334c688cf7094aa6eae0ac5c380913d67da32cda3df5f4d09af24c93fcac869
-- Safe service-only projection for the current Elevenst 1346631 approval.
-- Provider Product and credential secrets are consumed for binding/digest only
-- and are never projected by this RPC.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702650);

do $migration$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.elevenst_new_product_source_approvals'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_elevenst_new_product_approval_context(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_elevenst_new_product_source(text,uuid,uuid,text,uuid,integer)'
     ) is null then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_READBACK_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create function public.sellerpilot_service_elevenst_new_product_source_readback(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  approval_row sellerpilot_private.elevenst_new_product_source_approvals%rowtype;
  source_values jsonb;
  source_digest text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null
     or p_product_id is null
     or p_credential_id is null
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor_id
     ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_READBACK_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  context_value := public.sellerpilot_service_elevenst_new_product_approval_context(
    p_actor_id, p_product_id, p_credential_id, p_market, p_target_id
  );
  if context_value is null then return null; end if;

  select source.*
    into source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.owner_id = (context_value->>'ownerId')::uuid
     and source.product_id = p_product_id
     and source.category_id = '1346631'
     and source.credential_id = p_credential_id
     and source.credential_version = (context_value->>'credentialVersion')::integer
     and source.product_updated_at = (context_value->>'productUpdatedAt')::timestamptz
     and source.product_revision = (context_value->>'productRevision')::bigint
     and source.product_approval_revision = (context_value->>'productApprovalRevision')::bigint
     and source.status = 'approved'
     and exists (
       select 1
         from sellerpilot_private.elevenst_new_product_source_approvals approval
        where approval.source_id = source.id
          and approval.draft_version = (context_value->>'draftVersion')::bigint
          and approval.detail_manifest_digest = context_value->>'detailManifestDigest'
     );
  if not found then return null; end if;

  select approval.* into strict approval_row
    from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.source_id = source_row.id;

  source_values := pg_catalog.jsonb_build_object(
    'product', public.sellerpilot_service_elevenst_new_product_source(
      'product', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'credential', public.sellerpilot_service_elevenst_new_product_source(
      'credential', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'notices', public.sellerpilot_service_elevenst_new_product_source(
      'notices', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'seller', public.sellerpilot_service_elevenst_new_product_source(
      'seller', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'availability', public.sellerpilot_service_elevenst_new_product_source(
      'availability', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    ),
    'policy', public.sellerpilot_service_elevenst_new_product_source(
      'policy', source_row.owner_id, source_row.product_id, '1346631',
      source_row.credential_id, source_row.credential_version
    )
  );
  if exists (
    select 1
      from pg_catalog.jsonb_each(source_values) item
     where item.value = 'null'::jsonb
        or item.value->>'current' is distinct from 'true'
  ) then
    return null;
  end if;

  source_digest := pg_catalog.encode(
    extensions.digest(source_values::text, 'sha256'), 'hex'
  );
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_source_readback_v1',
    'current', true,
    'sourceId', source_row.id,
    'ownerId', source_row.owner_id,
    'productId', source_row.product_id,
    'credentialId', source_row.credential_id,
    'credentialVersion', source_row.credential_version,
    'productRevision', source_row.product_revision,
    'productApprovalRevision', source_row.product_approval_revision,
    'draftVersion', approval_row.draft_version,
    'approvalPayloadSha256', approval_row.approval_payload_sha256,
    'approvedAt', approval_row.approved_at,
    'sixKindDigest', source_digest
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_elevenst_new_product_source_readback(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_elevenst_new_product_source_readback(
    uuid, uuid, uuid, text, text
  ) to service_role;


-- Reviewed source: 20260910031700_elevenst_new_product_execution_cas.sql
-- Original SHA256: a49587105d32e9874c7c44eb0decc52e30d87b95e77cf2086ff8b16c7fec709f
-- Final one-shot execution fence for an approved Elevenst 1346631 CREATE.
-- No provider call or source row is created by this migration.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702700);

do $migration$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_elevenst_new_product_source_readback(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CAS_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create table sellerpilot_private.elevenst_new_product_execution_permits (
  permit_id uuid primary key default pg_catalog.gen_random_uuid(),
  source_id uuid not null unique references
    sellerpilot_private.elevenst_new_product_server_sources(id) on delete restrict,
  approval_request_id uuid not null unique references
    sellerpilot_private.elevenst_new_product_source_approvals(approval_request_id) on delete restrict,
  approval_payload_sha256 text not null check (approval_payload_sha256 ~ '^[a-f0-9]{64}$'),
  six_kind_digest text not null check (six_kind_digest ~ '^[a-f0-9]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  product_revision bigint not null check (product_revision > 0),
  product_approval_revision bigint not null check (product_approval_revision > 0),
  draft_version bigint not null check (draft_version > 0),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  assignment_id uuid not null references sellerpilot_private.product_category_assignments(id) on delete restrict,
  assignment_confirmed_at timestamptz not null,
  market text not null,
  target_id text not null,
  status text not null default 'bound' check (status in ('bound','consumed','reconciliation_required')),
  bound_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  consumed_claim_token uuid,
  consumed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (product_revision = product_approval_revision),
  check ((consumed_job_id is null) = (consumed_claim_token is null)),
  check ((consumed_job_id is null) = (consumed_at is null)),
  check ((status = 'bound') = (consumed_job_id is null))
);

revoke all on sellerpilot_private.elevenst_new_product_execution_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_new_product_execution_binding(
  p_permit sellerpilot_private.elevenst_new_product_execution_permits
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_new_product_execution_binding_v1',
    'permitId',p_permit.permit_id,
    'sourceId',p_permit.source_id,
    'approvalPayloadSha256',p_permit.approval_payload_sha256,
    'sixKindDigest',p_permit.six_kind_digest,
    'requestFingerprint',p_permit.request_fingerprint,
    'ownerId',p_permit.owner_id,
    'productId',p_permit.product_id,
    'productRevision',p_permit.product_revision,
    'productApprovalRevision',p_permit.product_approval_revision,
    'draftVersion',p_permit.draft_version,
    'credentialId',p_permit.credential_id,
    'credentialVersion',p_permit.credential_version,
    'assignmentId',p_permit.assignment_id,
    'assignmentConfirmedAt',p_permit.assignment_confirmed_at,
    'boundAt',p_permit.bound_at
  )
$$;

revoke all on function sellerpilot_private.elevenst_new_product_execution_binding(
  sellerpilot_private.elevenst_new_product_execution_permits
) from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_current_six_kind_digest(
  p_source sellerpilot_private.elevenst_new_product_server_sources
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare source_values jsonb;
begin
  source_values := pg_catalog.jsonb_build_object(
    'product', public.sellerpilot_service_elevenst_new_product_source(
      'product',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'credential', public.sellerpilot_service_elevenst_new_product_source(
      'credential',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'notices', public.sellerpilot_service_elevenst_new_product_source(
      'notices',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'seller', public.sellerpilot_service_elevenst_new_product_source(
      'seller',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'availability', public.sellerpilot_service_elevenst_new_product_source(
      'availability',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'policy', public.sellerpilot_service_elevenst_new_product_source(
      'policy',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version)
  );
  if exists(select 1 from pg_catalog.jsonb_each(source_values) item
            where item.value='null'::jsonb or item.value->>'current' is distinct from 'true') then
    return null;
  end if;
  return pg_catalog.encode(extensions.digest(source_values::text,'sha256'),'hex');
end;
$$;

revoke all on function sellerpilot_private.elevenst_current_six_kind_digest(
  sellerpilot_private.elevenst_new_product_server_sources
) from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_elevenst_new_product_source_readback(
  uuid,uuid,uuid,text,text
) rename to sellerpilot_100317_elevenst_source_readback_before_execution_ca;
revoke all on function public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_elevenst_new_product_source_readback(
  p_actor_id uuid,p_product_id uuid,p_credential_id uuid,p_market text,p_target_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; permit_status text;
begin
  result:=public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
  if result is null then return null; end if;
  select permit.status into permit_status
    from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.source_id=(result->>'sourceId')::uuid;
  if found and permit_status in ('consumed','reconciliation_required') then return null; end if;
  return result;
end;
$$;

create function public.sellerpilot_service_bind_elevenst_new_product_execution(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text,
  p_source_id uuid,
  p_approval_payload_sha256 text,
  p_six_kind_digest text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  approval_row sellerpilot_private.elevenst_new_product_source_approvals%rowtype;
  assignment_row sellerpilot_private.product_category_assignments%rowtype;
  permit_row sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  current_digest text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null or p_product_id is null or p_credential_id is null or p_source_id is null
     or p_approval_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_six_kind_digest !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_BIND_ACCESS_DENIED' using errcode='42501';
  end if;
  context_value := public.sellerpilot_service_elevenst_new_product_approval_context(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
  if context_value is null then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONTEXT_STALE' using errcode='40001';
  end if;
  perform 1 from sellerpilot_private.products product
   where product.id=p_product_id and product.owner_id=(context_value->>'ownerId')::uuid for update;
  perform 1 from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.version=(context_value->>'credentialVersion')::integer
     and credential.status='active' and credential.channel='elevenst' and credential.environment='production' for update;
  select assignment.* into strict assignment_row
    from sellerpilot_private.product_category_assignments assignment
   where assignment.owner_id=(context_value->>'ownerId')::uuid and assignment.product_id=p_product_id
     and assignment.channel='elevenst' and assignment.environment='production'
     and assignment.market=pg_catalog.btrim(p_market) and assignment.category_id='1346631'
     and assignment.status='confirmed' and assignment.is_leaf and assignment.confirmed_at is not null
   for update;
  perform 1 from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id=(context_value->>'ownerId')::uuid and draft.product_id=p_product_id
     and draft.kind='publish' and draft.version=(context_value->>'draftVersion')::bigint for update;
  select source.* into strict source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id=p_source_id and source.owner_id=(context_value->>'ownerId')::uuid
     and source.product_id=p_product_id and source.category_id='1346631'
     and source.credential_id=p_credential_id
     and source.credential_version=(context_value->>'credentialVersion')::integer
     and source.product_updated_at=(context_value->>'productUpdatedAt')::timestamptz
     and source.product_revision=(context_value->>'productRevision')::bigint
     and source.product_approval_revision=(context_value->>'productApprovalRevision')::bigint
     and source.status='approved' for update;
  select approval.* into strict approval_row
    from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.source_id=p_source_id and approval.approval_payload_sha256=p_approval_payload_sha256
     and approval.draft_version=(context_value->>'draftVersion')::bigint for update;
  if nullif(source_row.availability_receipt->>'observedAt','') is null
     or (source_row.availability_receipt->>'observedAt')::timestamptz
       < pg_catalog.clock_timestamp()-interval '10 minutes' then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_AVAILABILITY_STALE' using errcode='40001';
  end if;
  current_digest := sellerpilot_private.elevenst_current_six_kind_digest(source_row);
  if current_digest is null or current_digest is distinct from p_six_kind_digest then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_SOURCE_STALE' using errcode='40001';
  end if;
  select permit.* into permit_row
    from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.source_id=p_source_id for update;
  if found then
    if permit_row.status='bound' and permit_row.request_fingerprint=p_request_fingerprint
       and permit_row.six_kind_digest=p_six_kind_digest then
      return sellerpilot_private.elevenst_new_product_execution_binding(permit_row);
    end if;
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_REPLAY_REQUIRES_RECONCILIATION' using errcode='40001';
  end if;
  insert into sellerpilot_private.elevenst_new_product_execution_permits(
    source_id,approval_request_id,approval_payload_sha256,six_kind_digest,request_fingerprint,
    actor_id,owner_id,product_id,product_revision,product_approval_revision,draft_version,
    credential_id,credential_version,assignment_id,assignment_confirmed_at,market,target_id
  ) values(
    source_row.id,approval_row.approval_request_id,approval_row.approval_payload_sha256,current_digest,
    p_request_fingerprint,p_actor_id,source_row.owner_id,source_row.product_id,source_row.product_revision,
    source_row.product_approval_revision,approval_row.draft_version,source_row.credential_id,
    source_row.credential_version,assignment_row.id,assignment_row.confirmed_at,
    pg_catalog.btrim(p_market),pg_catalog.btrim(p_target_id)
  ) returning * into permit_row;
  return sellerpilot_private.elevenst_new_product_execution_binding(permit_row);
exception
  when no_data_found or invalid_text_representation or invalid_datetime_format then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONTEXT_STALE'
      using errcode='40001';
end;
$$;

create function sellerpilot_private.elevenst_new_product_job_source_current(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row sellerpilot_private.channel_gateway_jobs%rowtype;
  permit_row sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  binding jsonb;
  current_digest text;
begin
  select job.* into job_row from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id for update;
  if not found or job_row.channel is distinct from 'elevenst' or job_row.operation is distinct from 'listing.create'
     or job_row.environment is distinct from 'production'
     or job_row.status is distinct from 'running' or job_row.claim_token is distinct from p_claim_token then return false; end if;
  binding:=job_row.request_payload#>'{arguments,sellerpilotElevenstExecutionBinding}';
  if not sellerpilot_private.elevenst_jsonb_exact_keys(binding,array[
       'contract','permitId','sourceId','approvalPayloadSha256','sixKindDigest','requestFingerprint',
       'ownerId','productId','productRevision','productApprovalRevision','draftVersion','credentialId',
       'credentialVersion','assignmentId','assignmentConfirmedAt','boundAt'])
     or binding->>'contract' is distinct from 'sellerpilot_elevenst_new_product_execution_binding_v1' then return false; end if;
  select permit.* into permit_row from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.permit_id=(binding->>'permitId')::uuid and permit.status='bound' for update;
  if not found or permit_row.source_id::text is distinct from binding->>'sourceId'
     or permit_row.approval_payload_sha256 is distinct from binding->>'approvalPayloadSha256'
     or permit_row.six_kind_digest is distinct from binding->>'sixKindDigest'
     or permit_row.request_fingerprint is distinct from binding->>'requestFingerprint'
     or permit_row.owner_id::text is distinct from binding->>'ownerId' or permit_row.product_id::text is distinct from binding->>'productId'
     or permit_row.product_revision::text is distinct from binding->>'productRevision'
     or permit_row.product_approval_revision::text is distinct from binding->>'productApprovalRevision'
     or permit_row.draft_version::text is distinct from binding->>'draftVersion'
     or permit_row.credential_id::text is distinct from binding->>'credentialId'
     or permit_row.credential_version::text is distinct from binding->>'credentialVersion'
     or permit_row.assignment_id::text is distinct from binding->>'assignmentId'
     or permit_row.assignment_confirmed_at is distinct from (binding->>'assignmentConfirmedAt')::timestamptz
     or permit_row.bound_at is distinct from (binding->>'boundAt')::timestamptz
     or job_row.credential_id is distinct from permit_row.credential_id
     or job_row.created_by is distinct from permit_row.owner_id
     or job_row.request_fingerprint is distinct from permit_row.request_fingerprint
     then return false; end if;
  perform 1 from sellerpilot_private.products product where product.id=permit_row.product_id
    and product.owner_id=permit_row.owner_id and product.updated_at=(select product_updated_at from sellerpilot_private.elevenst_new_product_server_sources where id=permit_row.source_id)
    and product.detail_page_version=permit_row.product_revision
    and product.detail_page_approved_version=permit_row.product_approval_revision for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.channel_credentials credential where credential.id=permit_row.credential_id
    and credential.created_by=permit_row.owner_id and credential.version=permit_row.credential_version
    and credential.channel='elevenst' and credential.environment='production' and credential.status='active' for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_category_assignments assignment where assignment.id=permit_row.assignment_id
    and assignment.owner_id=permit_row.owner_id and assignment.product_id=permit_row.product_id
    and assignment.channel='elevenst' and assignment.environment='production' and assignment.market=permit_row.market
    and assignment.category_id='1346631' and assignment.status='confirmed' and assignment.is_leaf
    and assignment.confirmed_at=permit_row.assignment_confirmed_at for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_registration_drafts draft where draft.owner_id=permit_row.owner_id
    and draft.product_id=permit_row.product_id and draft.kind='publish' and draft.version=permit_row.draft_version for update;
  if not found then return false; end if;
  select source.* into strict source_row from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id=permit_row.source_id and source.status='approved' for update;
  if nullif(source_row.availability_receipt->>'observedAt','') is null
     or (source_row.availability_receipt->>'observedAt')::timestamptz
       < pg_catalog.clock_timestamp()-interval '10 minutes' then return false; end if;
  current_digest:=sellerpilot_private.elevenst_current_six_kind_digest(source_row);
  return current_digest is not null and current_digest=permit_row.six_kind_digest;
exception when invalid_text_representation or invalid_datetime_format or no_data_found then return false;
end;
$$;

revoke all on function sellerpilot_private.elevenst_new_product_job_source_current(uuid,uuid)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_100317_begin_gateway_before_elevenst_source;
revoke all on function public.sellerpilot_100317_begin_gateway_before_elevenst_source(text,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare is_elevenst_create boolean; started boolean;
begin
  select channel='elevenst' and operation='listing.create' into is_elevenst_create
    from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  if not coalesce(is_elevenst_create,false) then
    return public.sellerpilot_100317_begin_gateway_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
  end if;
  if not sellerpilot_private.elevenst_new_product_job_source_current(p_job_id,p_claim_token) then return false; end if;
  started:=public.sellerpilot_100317_begin_gateway_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
  if not coalesce(started,false) then return false; end if;
  update sellerpilot_private.elevenst_new_product_execution_permits permit
     set status='consumed',consumed_job_id=p_job_id,consumed_claim_token=p_claim_token,
         consumed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
   where permit.permit_id=(select (job.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,permitId}')::uuid
                             from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id)
     and permit.status='bound' and permit.consumed_job_id is null;
  if not found then raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONSUMPTION_FAILED' using errcode='40001'; end if;
  return true;
end;
$$;

do $serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_100317_begin_serverless_before_elevenst_source';
  execute 'revoke all on function public.sellerpilot_100317_begin_serverless_before_elevenst_source(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute $fn$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $body$
    declare is_elevenst_create boolean; started boolean;
    begin
      select channel='elevenst' and operation='listing.create' into is_elevenst_create
        from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
      if not coalesce(is_elevenst_create,false) then
        return public.sellerpilot_100317_begin_serverless_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
      end if;
      if not sellerpilot_private.elevenst_new_product_job_source_current(p_job_id,p_claim_token) then return false; end if;
      started:=public.sellerpilot_100317_begin_serverless_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
      if not coalesce(started,false) then return false; end if;
      update sellerpilot_private.elevenst_new_product_execution_permits permit
         set status='consumed',consumed_job_id=p_job_id,consumed_claim_token=p_claim_token,
             consumed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
       where permit.permit_id=(select (job.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,permitId}')::uuid
                                 from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id)
         and permit.status='bound' and permit.consumed_job_id is null;
      if not found then raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONSUMPTION_FAILED' using errcode='40001'; end if;
      return true;
    end;$body$
  $fn$;
end;
$serverless$;

create function sellerpilot_private.elevenst_execution_reconciliation_convergence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.channel='elevenst' and new.operation='listing.create'
     and new.status='reconciliation_required' and old.status is distinct from new.status then
    update sellerpilot_private.elevenst_new_product_execution_permits permit
       set status='reconciliation_required',updated_at=pg_catalog.clock_timestamp()
     where permit.consumed_job_id=new.id and permit.status='consumed';
  end if;
  return new;
end;
$$;
revoke all on function sellerpilot_private.elevenst_execution_reconciliation_convergence()
  from public,anon,authenticated,service_role;
create trigger elevenst_execution_reconciliation_convergence
after update of status on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.elevenst_execution_reconciliation_convergence();

revoke all on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_elevenst_new_product_source_readback(uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_elevenst_new_product_source_readback(uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

do $grant_serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is not null then
    execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) from public,anon,authenticated,service_role';
    execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role';
  end if;
end;
$grant_serverless$;


-- Reviewed source: 20260910043000_elevenst_final_body_recovery_and_lock_order_r4.sql
-- Original SHA256: 8ebe63c386bf84c1b43aca77034a3d1fe3a5a3bab4f1480ed8fc69d980afa869
-- Forward-only r4 hardening for every Elevenst listing.create.
-- This migration does not enqueue or call a provider.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900703900);

do $dependencies$
begin
  if pg_catalog.to_regclass('sellerpilot_private.elevenst_new_product_execution_permits') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_bind_elevenst_new_product_execution(uuid,uuid,uuid,text,text,uuid,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)') is null then
    raise exception 'ELEVENST_R4_DEPENDENCY_MISSING';
  end if;
end;
$dependencies$;

do $one_confirmed$
begin
  if exists(
    select 1
      from sellerpilot_private.product_category_assignments assignment
     where assignment.channel='elevenst'
       and assignment.environment='production'
       and assignment.status='confirmed'
     group by assignment.owner_id,assignment.product_id,assignment.environment,assignment.market
    having count(*)>1
  ) then
    raise exception 'ELEVENST_PRODUCTION_CONFIRMED_CATEGORY_DUPLICATE';
  end if;
end;
$one_confirmed$;

create unique index product_category_assignments_one_elevenst_production_confirmed_
  on sellerpilot_private.product_category_assignments(owner_id,product_id,environment,market)
  where channel='elevenst' and environment='production' and status='confirmed';

alter table sellerpilot_private.elevenst_new_product_execution_permits
  add column final_arguments_sha256 text check(final_arguments_sha256 is null or final_arguments_sha256~'^[a-f0-9]{64}$'),
  add column provider_body_sha256 text check(provider_body_sha256 is null or provider_body_sha256~'^[a-f0-9]{64}$'),
  add column provider_body_bytes integer check(provider_body_bytes is null or provider_body_bytes>0),
  add column credential_fingerprint text check(credential_fingerprint is null or credential_fingerprint~'^[A-F0-9]{12}$'),
  add column vault_secret_id uuid,
  add column api_key_sha256 text check(api_key_sha256 is null or api_key_sha256~'^[a-f0-9]{64}$'),
  add column sealed_at timestamptz,
  add column recovery_claim_token uuid,
  add column recovery_lease_expires_at timestamptz,
  add column recovery_attempt_count integer not null default 0 check(recovery_attempt_count between 0 and 20),
  add column recovery_observation jsonb;

alter table sellerpilot_private.elevenst_new_product_execution_permits
  drop constraint if exists elevenst_new_product_execution_permits_status_check;
alter table sellerpilot_private.elevenst_new_product_execution_permits
  add constraint elevenst_new_product_execution_permits_status_check
  check(status in('bound','sealed','consumed','reconciliation_required','completed'));
do $drop_bound_constraint$
declare constraint_name text;
begin
  select value.conname into constraint_name
    from pg_catalog.pg_constraint value
   where value.conrelid='sellerpilot_private.elevenst_new_product_execution_permits'::pg_catalog.regclass
     and value.contype='c'
     and pg_catalog.pg_get_constraintdef(value.oid) like '%status = ''bound''%consumed_job_id IS NULL%';
  if constraint_name is not null then
    execute pg_catalog.format(
      'alter table sellerpilot_private.elevenst_new_product_execution_permits drop constraint %I',
      constraint_name
    );
  end if;
end;
$drop_bound_constraint$;
alter table sellerpilot_private.elevenst_new_product_execution_permits
  add constraint elevenst_new_product_execution_permits_consumption_check
  check(
    (status in('bound','sealed') and consumed_job_id is null and consumed_claim_token is null and consumed_at is null)
    or (status in('consumed','reconciliation_required','completed') and consumed_job_id is not null and consumed_claim_token is not null and consumed_at is not null)
  );

create function sellerpilot_private.elevenst_execution_source_advisory_lock(p_source_id uuid)
returns void language sql volatile set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellerpilot:elevenst:create:'||p_source_id::text,43000)
  )
$$;

revoke all on function sellerpilot_private.elevenst_execution_source_advisory_lock(uuid)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.elevenst_final_execution_seal(
  p_permit sellerpilot_private.elevenst_new_product_execution_permits
) returns jsonb language sql stable set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_final_execution_seal_v1',
    'permitId',p_permit.permit_id,
    'sourceId',p_permit.source_id,
    'requestFingerprint',p_permit.request_fingerprint,
    'finalArgumentsSha256',p_permit.final_arguments_sha256,
    'providerBodySha256',p_permit.provider_body_sha256,
    'providerBodyBytes',p_permit.provider_body_bytes,
    'credentialId',p_permit.credential_id,
    'credentialVersion',p_permit.credential_version,
    'credentialFingerprint',p_permit.credential_fingerprint,
    'vaultSecretId',p_permit.vault_secret_id,
    'apiKeySha256',p_permit.api_key_sha256,
    'sealedAt',p_permit.sealed_at
  )
$$;

revoke all on function sellerpilot_private.elevenst_final_execution_seal(
  sellerpilot_private.elevenst_new_product_execution_permits
) from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text
) rename to sellerpilot_100430_bind_elevenst_before_advisory;
revoke all on function public.sellerpilot_100430_bind_elevenst_before_advisory(
  uuid,uuid,uuid,text,text,uuid,text,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_bind_elevenst_new_product_execution(
  p_actor_id uuid,p_product_id uuid,p_credential_id uuid,p_market text,p_target_id text,
  p_source_id uuid,p_approval_payload_sha256 text,p_six_kind_digest text,p_request_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(p_source_id);
  return public.sellerpilot_100430_bind_elevenst_before_advisory(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id,p_source_id,
    p_approval_payload_sha256,p_six_kind_digest,p_request_fingerprint
  );
end;
$$;

create function public.sellerpilot_service_seal_elevenst_new_product_final_body(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_binding jsonb,
  p_final_arguments jsonb,
  p_provider_body_sha256 text,
  p_provider_body_bytes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  api_key text;
  arguments_sha text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not sellerpilot_private.elevenst_jsonb_exact_keys(p_binding,array[
       'contract','permitId','sourceId','approvalPayloadSha256','sixKindDigest','requestFingerprint',
       'ownerId','productId','productRevision','productApprovalRevision','draftVersion','credentialId',
       'credentialVersion','assignmentId','assignmentConfirmedAt','boundAt'])
     or p_binding->>'contract' is distinct from 'sellerpilot_elevenst_new_product_execution_binding_v1'
     or pg_catalog.jsonb_typeof(p_final_arguments) is distinct from 'object'
     or p_final_arguments ? 'sellerpilotElevenstFinalExecutionSeal'
     or p_provider_body_sha256!~'^[a-f0-9]{64}$'
     or p_provider_body_bytes<1 then
    raise exception 'ELEVENST_FINAL_EXECUTION_SEAL_ACCESS_DENIED' using errcode='42501';
  end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock((p_binding->>'sourceId')::uuid);
  perform 1 from sellerpilot_private.products product
   where product.id=(p_binding->>'productId')::uuid and product.owner_id=(p_binding->>'ownerId')::uuid for update;
  select * into strict credential from sellerpilot_private.channel_credentials value
   where value.id=(p_binding->>'credentialId')::uuid and value.created_by=(p_binding->>'ownerId')::uuid
     and value.version=(p_binding->>'credentialVersion')::integer and value.channel='elevenst'
     and value.environment='production' and value.status='active' for update;
  perform 1 from sellerpilot_private.product_category_assignments assignment
   where assignment.id=(p_binding->>'assignmentId')::uuid and assignment.status='confirmed' for update;
  perform 1 from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id=(p_binding->>'ownerId')::uuid and draft.product_id=(p_binding->>'productId')::uuid
     and draft.kind='publish' and draft.version=(p_binding->>'draftVersion')::bigint for update;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id=(p_binding->>'sourceId')::uuid and source.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.source_id=(p_binding->>'sourceId')::uuid
     and approval.approval_payload_sha256=p_binding->>'approvalPayloadSha256' for update;
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.permit_id=(p_binding->>'permitId')::uuid and value.source_id=(p_binding->>'sourceId')::uuid
     and value.request_fingerprint=p_binding->>'requestFingerprint' for update;
  perform 1 from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id=p_attempt_id and attempt.owner_id=permit.owner_id
     and attempt.credential_id=permit.credential_id and attempt.channel='elevenst'
     and attempt.operation='listing.create' and attempt.status='running'
     and attempt.request_fingerprint=permit.request_fingerprint for update;
  if not found then raise exception 'ELEVENST_FINAL_EXECUTION_ATTEMPT_STALE' using errcode='40001'; end if;
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into api_key
    from vault.decrypted_secrets secret where secret.id=credential.vault_secret_id;
  if api_key!~'^[A-Za-z0-9]{32}$' then
    raise exception 'ELEVENST_FINAL_EXECUTION_SECRET_INVALID' using errcode='40001';
  end if;
  arguments_sha:=pg_catalog.encode(extensions.digest(p_final_arguments::text,'sha256'),'hex');
  if permit.status='sealed' then
    if permit.final_arguments_sha256=arguments_sha and permit.provider_body_sha256=p_provider_body_sha256
       and permit.provider_body_bytes=p_provider_body_bytes and permit.vault_secret_id=credential.vault_secret_id
       and permit.credential_fingerprint=credential.fingerprint
       and permit.api_key_sha256=pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex') then
      return sellerpilot_private.elevenst_final_execution_seal(permit);
    end if;
    raise exception 'ELEVENST_FINAL_EXECUTION_SEAL_REPLAY_DRIFT' using errcode='40001';
  end if;
  if permit.status is distinct from 'bound' then raise exception 'ELEVENST_FINAL_EXECUTION_PERMIT_NOT_BOUND' using errcode='40001'; end if;
  update sellerpilot_private.elevenst_new_product_execution_permits value set
    status='sealed',final_arguments_sha256=arguments_sha,provider_body_sha256=p_provider_body_sha256,
    provider_body_bytes=p_provider_body_bytes,credential_fingerprint=credential.fingerprint,
    vault_secret_id=credential.vault_secret_id,
    api_key_sha256=pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex'),
    sealed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id returning * into permit;
  return sellerpilot_private.elevenst_final_execution_seal(permit);
exception when no_data_found or invalid_text_representation or invalid_datetime_format then
  raise exception 'ELEVENST_FINAL_EXECUTION_CONTEXT_STALE' using errcode='40001';
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_100430_begin_gateway_before_final_body;
revoke all on function public.sellerpilot_100430_begin_gateway_before_final_body(text,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from sellerpilot_private.channel_gateway_jobs job
             where job.id=p_job_id and job.channel='elevenst' and job.operation='listing.create') then
    return false;
  end if;
  return public.sellerpilot_100430_begin_gateway_before_final_body(p_token_hash,p_job_id,p_claim_token);
end;
$$;

create function sellerpilot_private.elevenst_begin_final_provider_mutation(
  p_serverless boolean,
  p_token_hash text,p_job_id uuid,p_claim_token uuid,
  p_final_arguments_sha256 text,p_provider_body_sha256 text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  v_source_id uuid;
  seal jsonb;
  current_arguments_sha text;
  current_api_key text;
  started boolean;
begin
  if p_final_arguments_sha256!~'^[a-f0-9]{64}$' or p_provider_body_sha256!~'^[a-f0-9]{64}$' then return false; end if;
  select (value.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,sourceId}')::uuid
    into v_source_id from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id;
  if v_source_id is null then return false; end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(v_source_id);
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=v_source_id;
  perform 1 from sellerpilot_private.products value where value.id=permit.product_id and value.owner_id=permit.owner_id for update;
  perform 1 from sellerpilot_private.channel_credentials value where value.id=permit.credential_id
    and value.version=permit.credential_version and value.status='active'
    and value.vault_secret_id=permit.vault_secret_id and value.fingerprint=permit.credential_fingerprint for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_category_assignments value where value.id=permit.assignment_id
    and value.status='confirmed' for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=permit.owner_id
    and value.product_id=permit.product_id and value.kind='publish' and value.version=permit.draft_version for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=permit.source_id
    and value.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=permit.source_id for update;
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=v_source_id for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id for update;
  seal:=job.request_payload#>'{arguments,sellerpilotElevenstFinalExecutionSeal}';
  current_arguments_sha:=pg_catalog.encode(extensions.digest(
    ((job.request_payload#>'{arguments}')-'sellerpilotElevenstFinalExecutionSeal')::text,'sha256'),'hex');
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into current_api_key
    from vault.decrypted_secrets secret where secret.id=permit.vault_secret_id;
  if permit.status is distinct from 'sealed' or job.channel is distinct from 'elevenst' or job.operation is distinct from 'listing.create'
     or job.environment is distinct from 'production' or job.status is distinct from 'running' or job.claim_token is distinct from p_claim_token
     or job.credential_id is distinct from permit.credential_id or job.created_by is distinct from permit.owner_id
     or job.request_fingerprint is distinct from permit.request_fingerprint
     or not sellerpilot_private.elevenst_jsonb_exact_keys(seal,array[
       'contract','permitId','sourceId','requestFingerprint','finalArgumentsSha256','providerBodySha256',
       'providerBodyBytes','credentialId','credentialVersion','credentialFingerprint','vaultSecretId','apiKeySha256','sealedAt'])
     or seal->>'contract' is distinct from 'sellerpilot_elevenst_final_execution_seal_v1'
     or seal->>'permitId' is distinct from permit.permit_id::text or seal->>'sourceId' is distinct from permit.source_id::text
     or seal->>'finalArgumentsSha256' is distinct from permit.final_arguments_sha256
     or seal->>'providerBodySha256' is distinct from permit.provider_body_sha256
     or p_final_arguments_sha256 is distinct from permit.final_arguments_sha256
     or p_provider_body_sha256 is distinct from permit.provider_body_sha256
     or current_arguments_sha is distinct from permit.final_arguments_sha256
     or pg_catalog.encode(extensions.digest(current_api_key,'sha256'),'hex') is distinct from permit.api_key_sha256 then
    return false;
  end if;
  -- The 31700 predecessor recognizes only its original bound state. Expose it
  -- inside this already advisory-serialized transaction after all r4 hashes
  -- have matched; any failed predecessor is restored to sealed before return.
  update sellerpilot_private.elevenst_new_product_execution_permits value
     set status='bound',updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id and value.status='sealed';
  if p_serverless then
    started:=public.sellerpilot_100430_begin_serverless_before_final_body(
      p_token_hash,p_job_id,p_claim_token
    );
  else
    started:=public.sellerpilot_100430_begin_gateway_before_final_body(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if not coalesce(started,false) then
    update sellerpilot_private.elevenst_new_product_execution_permits value
       set status='sealed',updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id and value.status='bound';
    return false;
  end if;
  update sellerpilot_private.elevenst_new_product_execution_permits value
     set status='consumed',updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id and value.status in('sealed','consumed');
  return found;
exception when no_data_found or invalid_text_representation then return false;
end;
$$;

create function public.sellerpilot_service_begin_elevenst_final_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,
  p_final_arguments_sha256 text,p_provider_body_sha256 text
) returns boolean language sql security definer set search_path='' as $$
  select sellerpilot_private.elevenst_begin_final_provider_mutation(
    false,
    p_token_hash,p_job_id,p_claim_token,p_final_arguments_sha256,p_provider_body_sha256
  )
$$;

do $serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_100430_begin_serverless_before_final_body';
  execute 'revoke all on function public.sellerpilot_100430_begin_serverless_before_final_body(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute $fn$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $body$
    begin
      if exists(select 1 from sellerpilot_private.channel_gateway_jobs job
                 where job.id=p_job_id and job.channel='elevenst' and job.operation='listing.create') then return false; end if;
      return public.sellerpilot_100430_begin_serverless_before_final_body(p_token_hash,p_job_id,p_claim_token);
    end;$body$;
    create function public.sellerpilot_service_begin_serverless_11st_final_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,
      p_final_arguments_sha256 text,p_provider_body_sha256 text
    ) returns boolean language sql security definer set search_path='' as $body$
      select sellerpilot_private.elevenst_begin_final_provider_mutation(
        true,
        p_token_hash,p_job_id,p_claim_token,p_final_arguments_sha256,p_provider_body_sha256
      )
    $body$;
  $fn$;
end;
$serverless$;

create function public.sellerpilot_service_claim_elevenst_create_recovery(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  recovery_token uuid:=pg_catalog.gen_random_uuid();
  candidate_source_id uuid;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope='gateway' and value.status='active'
                   and value.expires_at>pg_catalog.clock_timestamp()) then
    raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
  end if;
  select value.source_id into candidate_source_id
    from sellerpilot_private.elevenst_new_product_execution_permits value
   join sellerpilot_private.channel_gateway_jobs candidate on candidate.id=value.consumed_job_id
   where value.status='reconciliation_required' and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
     and candidate.channel='elevenst' and candidate.operation='listing.create'
   order by value.updated_at limit 1;
  if candidate_source_id is null then return null; end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(candidate_source_id);
  select value.* into permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=candidate_source_id and value.status='reconciliation_required'
     and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
  ;
  if not found then return null; end if;
  perform 1 from sellerpilot_private.products value where value.id=permit.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials value where value.id=permit.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments value where value.id=permit.assignment_id for update;
  perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=permit.owner_id
    and value.product_id=permit.product_id and value.kind='publish' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=permit.source_id for update;
  select value.* into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=candidate_source_id and value.status='reconciliation_required'
     and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
   for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value where value.id=permit.consumed_job_id for update;
  update sellerpilot_private.elevenst_new_product_execution_permits value set
    recovery_claim_token=recovery_token,recovery_lease_expires_at=pg_catalog.clock_timestamp()+interval '60 seconds',
    recovery_attempt_count=recovery_attempt_count+1,updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id;
  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_create_recovery_claim_v1',
    'jobId',job.id,'recoveryToken',recovery_token,'credentialId',permit.credential_id,
    'expectedProduct',job.request_payload#>'{arguments,product}'
  );
exception when no_data_found then
  raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
end;
$$;

create function public.sellerpilot_service_finish_elevenst_create_recovery(
  p_token_hash text,p_job_id uuid,p_recovery_token uuid,p_observation jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  remote_id text:=pg_catalog.btrim(p_observation->>'productNo');
  completed boolean;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope='gateway' and value.status='active'
                   and value.expires_at>pg_catalog.clock_timestamp())
     or not sellerpilot_private.elevenst_jsonb_exact_keys(p_observation,array[
       'contract','outcome','sellerProductCode','productNo','fullOfficialReadback','productMismatches',
       'stockMismatches','providerReadbackUnavailableFields','providerMutationPerformed'])
     or p_observation->>'contract' is distinct from 'sellerpilot_elevenst_create_get_only_recovery_v1'
     or p_observation->>'providerMutationPerformed' is distinct from 'false' then
    raise exception 'ELEVENST_CREATE_RECOVERY_RESULT_INVALID' using errcode='42501';
  end if;
  select value.* into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.consumed_job_id=p_job_id;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(permit.source_id);
  perform 1 from sellerpilot_private.products value where value.id=permit.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials value where value.id=permit.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments value where value.id=permit.assignment_id for update;
  perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=permit.owner_id
    and value.product_id=permit.product_id and value.kind='publish' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=permit.source_id for update;
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.permit_id=permit.permit_id and value.status='reconciliation_required'
     and value.recovery_claim_token=p_recovery_token and value.recovery_lease_expires_at>=pg_catalog.clock_timestamp() for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id for update;
  perform 1 from sellerpilot_private.channel_operation_attempts value where value.id=job.attempt_id for update;
  perform 1 from sellerpilot_private.product_listings value where value.id=job.listing_id for update;
  completed:=p_observation->>'outcome'='unique' and p_observation->>'fullOfficialReadback'='true'
    and remote_id~'^[0-9]{1,20}$';
  if completed then
    update sellerpilot_private.product_listings listing set
      remote_id=remote_id,status='published',last_error=null,
      published_at=coalesce(listing.published_at,pg_catalog.clock_timestamp()),
      last_verified_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
     where listing.id=job.listing_id and listing.owner_id=permit.owner_id
       and listing.product_id=permit.product_id and listing.channel_key='elevenst';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_LISTING_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.channel_operation_attempts attempt set
      status='succeeded',http_status=200,remote_id=remote_id,
      safe_message='11번가 SellerPrdCd 공식 GET-only 복구 완료',completed_at=pg_catalog.clock_timestamp()
     where attempt.id=job.attempt_id and attempt.status in('running','manual_required');
    update sellerpilot_private.channel_gateway_jobs value set
      status='succeeded',response_payload=pg_catalog.jsonb_build_object(
        'ok',true,'channel','elevenst','operation','listing.create','remoteId',remote_id,
        'recovery',p_observation),error_message=null,completed_at=pg_catalog.clock_timestamp(),
      lease_expires_at=null,worker_token_id=null,claim_token=null,updated_at=pg_catalog.clock_timestamp()
     where value.id=job.id;
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      status='completed',recovery_observation=p_observation,recovery_claim_token=null,
      recovery_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id;
  else
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      recovery_observation=p_observation,recovery_claim_token=null,recovery_lease_expires_at=null,
      updated_at=pg_catalog.clock_timestamp() where value.permit_id=permit.permit_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'status',case when completed then 'completed' else 'reconciliation_required' end,
    'jobId',job.id,'remoteId',case when completed then remote_id else null end,
    'automaticRetryAllowed',false,'providerMutationPerformed',false
  );
exception when no_data_found then
  raise exception 'ELEVENST_CREATE_RECOVERY_CLAIM_STALE' using errcode='40001';
end;
$$;

-- All generic completion calls serialize with the same source advisory lock.
create function sellerpilot_private.elevenst_full_create_completion_valid(p_result jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_result)='object'
    and p_result->>'ok'='true'
    and p_result->>'channel'='elevenst'
    and p_result->>'operation'='listing.create'
    and p_result->>'remoteId'~'^[0-9]{1,20}$'
    and pg_catalog.jsonb_typeof(p_result->'steps')='array'
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_result->'steps') step
       where step->>'ok'='true'
         and step#>>'{data,sellerpilotFullOfficialReadbackVerified}'='true'
         and step#>>'{data,sellerpilotAdditionalEvidenceRequired}'='false'
    )
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_result->'steps') step
       where step->>'ok'='true'
         and step#>>'{data,sellerpilotFullOfficialStockReadbackVerified}'='true'
    ),false
  )
$$;

revoke all on function sellerpilot_private.elevenst_full_create_completion_valid(jsonb)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_100430_complete_gateway_before_elevenst_lock;
revoke all on function public.sellerpilot_100430_complete_gateway_before_elevenst_lock(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_response_payload jsonb default null,p_error_message text default null,
  p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_source_id uuid;
  v_permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  result jsonb;
begin
  select (gateway_job.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,sourceId}')::uuid
    into v_source_id from sellerpilot_private.channel_gateway_jobs gateway_job
   where gateway_job.id=p_job_id and gateway_job.channel='elevenst' and gateway_job.operation='listing.create';
  if v_source_id is not null then
    perform sellerpilot_private.elevenst_execution_source_advisory_lock(v_source_id);
    select * into strict v_permit from sellerpilot_private.elevenst_new_product_execution_permits value
     where value.source_id=v_source_id;
    perform 1 from sellerpilot_private.products value where value.id=v_permit.product_id for update;
    perform 1 from sellerpilot_private.channel_credentials value where value.id=v_permit.credential_id for update;
    perform 1 from sellerpilot_private.product_category_assignments value where value.id=v_permit.assignment_id for update;
    perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=v_permit.owner_id
      and value.product_id=v_permit.product_id and value.kind='publish' for update;
    perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=v_permit.source_id for update;
    perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=v_permit.source_id for update;
      perform 1 from sellerpilot_private.elevenst_new_product_execution_permits value where value.permit_id=v_permit.permit_id for update;
    select * into strict v_job from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id for update;
    perform 1 from sellerpilot_private.channel_operation_attempts value where value.id=v_job.attempt_id for update;
    perform 1 from sellerpilot_private.product_listings value where value.id=v_job.listing_id for update;
  end if;
  if v_source_id is not null and p_status='succeeded'
     and not sellerpilot_private.elevenst_full_create_completion_valid(p_response_payload) then
    raise exception 'ELEVENST_FULL_CREATE_COMPLETION_EVIDENCE_REQUIRED' using errcode='40001';
  end if;
  result:=public.sellerpilot_100430_complete_gateway_before_elevenst_lock(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
    p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  if v_source_id is not null and result->>'status' in('completed','completed_replay') then
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      status=case when p_status='succeeded' then 'completed' else 'reconciliation_required' end,
      recovery_observation=case when p_status='succeeded' then p_response_payload else value.recovery_observation end,
      updated_at=pg_catalog.clock_timestamp()
     where value.source_id=v_source_id and value.status in('consumed','reconciliation_required');
  end if;
  return result;
end;
$$;

revoke all on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_seal_elevenst_new_product_final_body(uuid,uuid,jsonb,jsonb,text,integer),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_elevenst_final_provider_mutation(text,uuid,uuid,text,text),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb),
  public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_seal_elevenst_new_product_final_body(uuid,uuid,jsonb,jsonb,text,integer),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_elevenst_final_provider_mutation(text,uuid,uuid,text,text),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb),
  public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)
  to service_role;

do $grant_serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_11st_final_mutation(text,uuid,uuid,text,text)') is not null then
    execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid), public.sellerpilot_service_begin_serverless_11st_final_mutation(text,uuid,uuid,text,text) from public,anon,authenticated,service_role';
    execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid), public.sellerpilot_service_begin_serverless_11st_final_mutation(text,uuid,uuid,text,text) to service_role';
  end if;
end;
$grant_serverless$;


-- Reviewed source: 20260910044500_elevenst_recovery_observation_and_identifier_hardening_r6.sql
-- Original SHA256: a9ef775220bdf23e0a722769a742fa5506e5a08e73ed8415bcf6a50433c4f4e0
-- Forward-only r6 hardening for Elevenst approved assets and GET-only CREATE recovery.
-- This migration never enqueues a job and never calls the provider.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900704450);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_category_assignments_one_elevenst_production_confirmed_'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)'
     ) is null then
    raise exception 'ELEVENST_R6_DEPENDENCY_MISSING';
  end if;
end;
$dependencies$;

-- PostgreSQL stored the two r3/r4 identifiers after silent 63-byte truncation.
-- Rename those exact catalog names; never refer to the misleading source spellings.
alter function public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(
  uuid,uuid,uuid,text,text
) rename to sellerpilot_100445_11st_source_readback_pre_cas;

alter index sellerpilot_private.product_category_assignments_one_elevenst_production_confirmed_
  rename to product_cat_one_11st_prod_confirmed_uidx;

revoke all on function public.sellerpilot_100445_11st_source_readback_pre_cas(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_service_elevenst_new_product_source_readback(
  p_actor_id uuid,p_product_id uuid,p_credential_id uuid,p_market text,p_target_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; permit_status text;
begin
  result:=public.sellerpilot_100445_11st_source_readback_pre_cas(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
  if result is null then return null; end if;
  select permit.status into permit_status
    from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.source_id=(result->>'sourceId')::uuid;
  if found and permit_status in('consumed','reconciliation_required') then return null; end if;
  return result;
end;
$$;

-- Preserve the current URL-based provider builder and persist server-read object
-- identities in the same immutable insert; never update an approved source.
alter function public.sellerpilot_service_approve_elevenst_new_product_source(uuid,uuid,uuid,uuid,text,text,jsonb)
 rename to sellerpilot_100445_11st_approve_before_object_bytes;
revoke all on function public.sellerpilot_100445_11st_approve_before_object_bytes(uuid,uuid,uuid,uuid,text,text,jsonb)
 from public,anon,authenticated,service_role;
create function public.sellerpilot_service_approve_elevenst_new_product_source(
 p_actor_id uuid,p_approval_request_id uuid,p_product_id uuid,p_credential_id uuid,
 p_market text,p_target_id text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 context_value jsonb;
 content jsonb:=p_payload#>'{policySource,content}';
 receipts jsonb:=content->'objectReceipts';
 detail_bucket text:=content->>'detailImageBucket';
 result jsonb;
begin
 context_value:=public.sellerpilot_service_elevenst_new_product_approval_context(
  p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
 if context_value is null then
  raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONTEXT_STALE' using errcode='40001';
 end if;
 if p_payload->>'providerProductSha256' is distinct from sellerpilot_private.elevenst_canonical_sha256(p_payload->'providerProduct')
   or jsonb_typeof(receipts) is distinct from 'array'
   or jsonb_array_length(receipts) is distinct from 12
   or content->'productImagePaths' is distinct from context_value->'productImagePaths'
   or content->'detailImagePaths' is distinct from context_value->'detailImagePaths'
   or content->>'productImageBucket' is distinct from 'sellerpilot-ai'
   or coalesce(detail_bucket,'') not in('sellerpilot-ai','sellerpilot-detail-imports')
   or content->>'objectReceiptsSha256' is distinct from sellerpilot_private.elevenst_canonical_sha256(receipts)
   or not sellerpilot_private.elevenst_jsonb_exact_keys(content,array[
    'htmlDetail','htmlDetailSha256','productImageUrls','detailImageUrls','imageUrlsSha256',
    'productImageBucket','detailImageBucket','productImagePaths','detailImagePaths',
    'objectReceipts','objectReceiptsSha256']) then
  raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_EVIDENCE_INVALID' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(receipts) with ordinality receipt(value,ordinality)
   where not sellerpilot_private.elevenst_jsonb_exact_keys(receipt.value,array['bucket','path','bytesSha256','contentLength','contentType'])
    or coalesce(receipt.value->>'bytesSha256','')!~'^[a-f0-9]{64}$'
    or coalesce(receipt.value->>'contentLength','')!~'^[1-9][0-9]*$'
    or (receipt.value->>'contentLength')::numeric>20971520
    or coalesce(receipt.value->>'contentType','')!~'^image/[a-z0-9.+-]+$'
    or receipt.value->>'bucket' is distinct from case when receipt.ordinality<=4 then 'sellerpilot-ai' else detail_bucket end
    or receipt.value->>'path' is distinct from case when receipt.ordinality<=4
       then (context_value->'productImagePaths')->>(receipt.ordinality::integer-1)
       else (context_value->'detailImagePaths')->>(receipt.ordinality::integer-5) end
    or (receipt.ordinality>4 and receipt.value->>'path' not like
       case when detail_bucket='sellerpilot-ai' then 'results/%' else 'external-detail/%' end)) then
  raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_EVIDENCE_INVALID' using errcode='22023';
 end if;
 result:=public.sellerpilot_100445_11st_approve_before_object_bytes(
  p_actor_id,p_approval_request_id,p_product_id,p_credential_id,p_market,p_target_id,p_payload);
 return result;
end $$;

create or replace function public.sellerpilot_service_claim_elevenst_create_recovery(
  p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  api_key text;
  recovery_token uuid:=pg_catalog.gen_random_uuid();
  candidate_source_id uuid;
  current_source jsonb;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope in('gateway','serverless_cs')
                   and value.status='active' and value.expires_at>pg_catalog.clock_timestamp()) then
    raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
  end if;
  select value.source_id into candidate_source_id
    from sellerpilot_private.elevenst_new_product_execution_permits value
    join sellerpilot_private.channel_gateway_jobs candidate on candidate.id=value.consumed_job_id
   where value.status='reconciliation_required' and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null
       or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
     and candidate.channel='elevenst' and candidate.operation='listing.create'
     and candidate.status='reconciliation_required'
   order by value.updated_at limit 1;
  if candidate_source_id is null then return null; end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(candidate_source_id);
  select * into strict permit
    from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=candidate_source_id and value.status='reconciliation_required'
     and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null
       or value.recovery_lease_expires_at<pg_catalog.clock_timestamp()) for update;
  perform 1 from sellerpilot_private.products value
   where value.id=permit.product_id and value.owner_id=permit.owner_id for update;
  select * into strict credential from sellerpilot_private.channel_credentials value
   where value.id=permit.credential_id and value.created_by=permit.owner_id
     and value.version=permit.credential_version and value.channel='elevenst'
     and value.environment='production' and value.status='active'
     and (value.expires_at is null or value.expires_at>pg_catalog.clock_timestamp()) for update;
  perform 1 from sellerpilot_private.product_category_assignments value
   where value.id=permit.assignment_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.channel='elevenst'
     and value.environment='production' and value.market=permit.market
     and value.category_id='1346631' and value.status='confirmed'
     and value.is_leaf and value.confirmed_at=permit.assignment_confirmed_at for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.product_registration_drafts value
   where value.owner_id=permit.owner_id and value.product_id=permit.product_id
     and value.kind='publish' and value.version=permit.draft_version for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value
   where value.id=permit.source_id and value.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value
   where value.source_id=permit.source_id
     and value.approval_payload_sha256=permit.approval_payload_sha256 for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value
   where value.id=permit.consumed_job_id and value.attempt_id is not null
     and value.listing_id is not null and value.channel='elevenst'
     and value.operation='listing.create' and value.environment='production'
     and value.status='reconciliation_required' and value.credential_id=permit.credential_id
     and value.created_by=permit.owner_id
     and value.request_fingerprint=permit.request_fingerprint for update;
  current_source:=public.sellerpilot_100445_11st_source_readback_pre_cas(
    permit.owner_id,permit.product_id,permit.credential_id,permit.market,permit.target_id);
  if current_source is null or current_source->>'sourceId' is distinct from permit.source_id::text
     or current_source->>'sixKindDigest' is distinct from permit.six_kind_digest
     or current_source->>'approvalPayloadSha256' is distinct from permit.approval_payload_sha256 then
    raise no_data_found;
  end if;
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into api_key
    from vault.decrypted_secrets secret where secret.id=credential.vault_secret_id;
  if api_key!~'^[A-Za-z0-9]{32}$' then raise no_data_found; end if;
  update sellerpilot_private.elevenst_new_product_execution_permits value set
    recovery_claim_token=recovery_token,
    recovery_lease_expires_at=pg_catalog.clock_timestamp()+interval '60 seconds',
    recovery_attempt_count=recovery_attempt_count+1,updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id;
  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_create_recovery_claim_v1',
    'jobId',job.id,'recoveryToken',recovery_token,
    'credentialId',credential.id,'credentialVersion',credential.version,
    'credentialFingerprint',credential.fingerprint,'vaultSecretId',credential.vault_secret_id,
    'expectedApiKeySha256',pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex'),
    'expectedProduct',job.request_payload#>'{arguments,product}',
    'credential',pg_catalog.jsonb_build_object('api_key',api_key));
exception when no_data_found then
  raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
end;
$$;

create or replace function public.sellerpilot_service_finish_elevenst_create_recovery(
  p_token_hash text,p_job_id uuid,p_recovery_token uuid,p_observation jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  source sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  current_source jsonb;
  seal jsonb;
  api_key text;
  v_remote_id text:=pg_catalog.btrim(p_observation->>'productNo');
  seller_code text;
  observed_at timestamptz;
  reads jsonb:=p_observation->'providerReads';
  completed boolean:=false;
  changed_rows integer;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope in('gateway','serverless_cs')
                   and value.status='active' and value.expires_at>pg_catalog.clock_timestamp())
     or not sellerpilot_private.elevenst_jsonb_exact_keys(p_observation,array[
       'contract','outcome','sellerProductCode','productNo','fullOfficialReadback',
       'productMismatches','stockMismatches','providerReadbackUnavailableFields',
       'providerMutationPerformed','credentialEvidence','authoritativeSnapshot',
       'providerReads','observedAt'])
     or p_observation->>'contract' is distinct from 'sellerpilot_elevenst_create_get_only_recovery_v2'
     or p_observation->>'providerMutationPerformed' is distinct from 'false'
     or p_observation->>'outcome' not in('unique','absent','ambiguous','unavailable')
     or not sellerpilot_private.elevenst_jsonb_exact_keys(
       p_observation->'credentialEvidence',array[
         'credentialId','credentialVersion','credentialFingerprint','vaultSecretId','apiKeySha256'])
     or not sellerpilot_private.elevenst_jsonb_exact_keys(
       p_observation->'authoritativeSnapshot',array[
         'categoryId','priceKrw','stockQuantity','titleSha256',
         'productImagesSha256','detailHtmlSha256']) then
    raise exception 'ELEVENST_CREATE_RECOVERY_RESULT_INVALID' using errcode='42501';
  end if;
  select * into strict permit
    from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.consumed_job_id=p_job_id;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(permit.source_id);
  perform 1 from sellerpilot_private.products value
   where value.id=permit.product_id and value.owner_id=permit.owner_id for update;
  select * into strict credential from sellerpilot_private.channel_credentials value
   where value.id=permit.credential_id and value.created_by=permit.owner_id
     and value.version=permit.credential_version and value.channel='elevenst'
     and value.environment='production' and value.status='active'
     and value.fingerprint=permit.credential_fingerprint
     and value.vault_secret_id=permit.vault_secret_id
     and (value.expires_at is null or value.expires_at>pg_catalog.clock_timestamp()) for update;
  perform 1 from sellerpilot_private.product_category_assignments value
   where value.id=permit.assignment_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.channel='elevenst'
     and value.environment='production' and value.market=permit.market
     and value.category_id='1346631' and value.status='confirmed'
     and value.is_leaf and value.confirmed_at=permit.assignment_confirmed_at for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.product_registration_drafts value
   where value.owner_id=permit.owner_id and value.product_id=permit.product_id
     and value.kind='publish' and value.version=permit.draft_version for update;
  if not found then raise no_data_found; end if;
  select * into strict source from sellerpilot_private.elevenst_new_product_server_sources value
   where value.id=permit.source_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.credential_id=permit.credential_id
     and value.credential_version=permit.credential_version
     and value.product_revision=permit.product_revision
     and value.product_approval_revision=permit.product_approval_revision
     and value.category_id='1346631' and value.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value
   where value.source_id=permit.source_id and value.approval_request_id=permit.approval_request_id
     and value.owner_id=permit.owner_id and value.product_id=permit.product_id
     and value.credential_id=permit.credential_id and value.credential_version=permit.credential_version
     and value.draft_version=permit.draft_version
     and value.approval_payload_sha256=permit.approval_payload_sha256 for update;
  if not found then raise no_data_found; end if;
  if not found then raise no_data_found; end if;
  select * into strict permit
    from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.permit_id=permit.permit_id and value.status='reconciliation_required'
     and value.recovery_claim_token=p_recovery_token
     and value.recovery_lease_expires_at>=pg_catalog.clock_timestamp() for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value
   where value.id=p_job_id and value.attempt_id is not null and value.listing_id is not null
     and value.channel='elevenst' and value.operation='listing.create'
     and value.environment='production' and value.status='reconciliation_required'
     and value.credential_id=permit.credential_id and value.created_by=permit.owner_id
     and value.request_fingerprint=permit.request_fingerprint for update;
  select * into strict attempt from sellerpilot_private.channel_operation_attempts value
   where value.id=job.attempt_id and value.owner_id=permit.owner_id
     and value.credential_id=permit.credential_id and value.channel='elevenst'
     and value.operation='listing.create' and value.status in('running','manual_required')
     and value.request_fingerprint=permit.request_fingerprint and value.remote_id is null for update;
  select * into strict listing from sellerpilot_private.product_listings value
   where value.id=job.listing_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.channel_key='elevenst'
     and value.remote_id is null for update;
  current_source:=public.sellerpilot_100445_11st_source_readback_pre_cas(
    permit.owner_id,permit.product_id,permit.credential_id,permit.market,permit.target_id);
  if current_source is null or current_source->>'sourceId' is distinct from permit.source_id::text
     or current_source->>'ownerId' is distinct from permit.owner_id::text
     or current_source->>'productId' is distinct from permit.product_id::text
     or current_source->>'credentialId' is distinct from permit.credential_id::text
     or (current_source->>'credentialVersion')::integer is distinct from permit.credential_version
     or (current_source->>'productRevision')::bigint is distinct from permit.product_revision
     or (current_source->>'productApprovalRevision')::bigint is distinct from permit.product_approval_revision
     or (current_source->>'draftVersion')::bigint is distinct from permit.draft_version
     or current_source->>'approvalPayloadSha256' is distinct from permit.approval_payload_sha256
     or current_source->>'sixKindDigest' is distinct from permit.six_kind_digest then raise no_data_found; end if;
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into api_key
    from vault.decrypted_secrets secret where secret.id=credential.vault_secret_id;
  seal:=job.request_payload#>'{arguments,sellerpilotElevenstFinalExecutionSeal}';
  seller_code:=pg_catalog.btrim(job.request_payload#>>'{arguments,product,sellerPrdCd}');
  begin observed_at:=(p_observation->>'observedAt')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'ELEVENST_CREATE_RECOVERY_RESULT_INVALID' using errcode='42501'; end;
  if api_key!~'^[A-Za-z0-9]{32}$'
     or pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex') is distinct from permit.api_key_sha256
     or not sellerpilot_private.elevenst_jsonb_exact_keys(seal,array[
       'contract','permitId','sourceId','requestFingerprint','finalArgumentsSha256',
       'providerBodySha256','providerBodyBytes','credentialId','credentialVersion',
       'credentialFingerprint','vaultSecretId','apiKeySha256','sealedAt'])
     or seal->>'contract' is distinct from 'sellerpilot_elevenst_final_execution_seal_v1'
     or seal->>'permitId' is distinct from permit.permit_id::text or seal->>'sourceId' is distinct from permit.source_id::text
     or seal->>'requestFingerprint' is distinct from permit.request_fingerprint
     or seal->>'finalArgumentsSha256' is distinct from permit.final_arguments_sha256
     or seal->>'providerBodySha256' is distinct from permit.provider_body_sha256
     or seal->>'credentialId' is distinct from permit.credential_id::text
     or (seal->>'credentialVersion')::integer is distinct from permit.credential_version
     or seal->>'credentialFingerprint' is distinct from permit.credential_fingerprint
     or seal->>'vaultSecretId' is distinct from permit.vault_secret_id::text
     or seal->>'apiKeySha256' is distinct from permit.api_key_sha256
     or pg_catalog.encode(extensions.digest(
       ((job.request_payload#>'{arguments}')-'sellerpilotElevenstFinalExecutionSeal')::text,
       'sha256'),'hex') is distinct from permit.final_arguments_sha256
     or p_observation->>'sellerProductCode' is distinct from seller_code
     or p_observation#>>'{credentialEvidence,credentialId}' is distinct from credential.id::text
     or (p_observation#>>'{credentialEvidence,credentialVersion}')::integer is distinct from credential.version
     or p_observation#>>'{credentialEvidence,credentialFingerprint}' is distinct from credential.fingerprint
     or p_observation#>>'{credentialEvidence,vaultSecretId}' is distinct from credential.vault_secret_id::text
     or p_observation#>>'{credentialEvidence,apiKeySha256}' is distinct from permit.api_key_sha256
     or p_observation#>>'{authoritativeSnapshot,categoryId}' is distinct from 
       job.request_payload#>>'{arguments,product,dispCtgrNo}'
     or (p_observation#>>'{authoritativeSnapshot,priceKrw}')::numeric is distinct from 
       (job.request_payload#>>'{arguments,product,selPrc}')::numeric
     or (p_observation#>>'{authoritativeSnapshot,stockQuantity}')::numeric is distinct from 
       (job.request_payload#>>'{arguments,product,prdSelQty}')::numeric
     or p_observation#>>'{authoritativeSnapshot,titleSha256}' is distinct from pg_catalog.encode(
       extensions.digest(job.request_payload#>>'{arguments,product,prdNm}','sha256'),'hex')
     or p_observation#>>'{authoritativeSnapshot,productImagesSha256}' is distinct from pg_catalog.encode(
       extensions.digest(pg_catalog.concat_ws(E'\n',
         job.request_payload#>>'{arguments,product,prdImage01}',
         job.request_payload#>>'{arguments,product,prdImage02}',
         job.request_payload#>>'{arguments,product,prdImage03}',
         job.request_payload#>>'{arguments,product,prdImage04}'),'sha256'),'hex')
     or p_observation#>>'{authoritativeSnapshot,detailHtmlSha256}' is distinct from pg_catalog.encode(
       extensions.digest(job.request_payload#>>'{arguments,product,htmlDetail}','sha256'),'hex')
     or observed_at<permit.updated_at-interval '2 seconds'
     or observed_at>pg_catalog.clock_timestamp()+interval '5 seconds' then
    raise exception 'ELEVENST_CREATE_RECOVERY_CONTEXT_STALE' using errcode='40001';
  end if;
  completed:=p_observation->>'outcome'='unique'
    and p_observation->>'fullOfficialReadback'='true'
    and v_remote_id~'^[0-9]{1,20}$'
    and p_observation->'productMismatches'='[]'::jsonb
    and p_observation->'stockMismatches'='[]'::jsonb
    and p_observation->'providerReadbackUnavailableFields'='[]'::jsonb
    and pg_catalog.jsonb_typeof(reads)='array' and pg_catalog.jsonb_array_length(reads)=4
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(reads) with ordinality reading(value,ordinality)
       where not sellerpilot_private.elevenst_jsonb_exact_keys(reading.value,array[
         'kind','method','requestBytesSha256','responseBodySha256','responseBodyBytes',
         'httpStatus','accepted'])
         or reading.value->>'kind' is distinct from
           (array['seller-product-code','seller-product-identity','product','stock'])[reading.ordinality::integer]
         or reading.value->>'method' is distinct from 'GET' or reading.value->>'accepted' is distinct from 'true'
         or reading.value->>'httpStatus' is distinct from '200'
         or reading.value->>'responseBodyBytes'!~'^[1-9][0-9]*$'
         or reading.value->>'responseBodySha256'!~'^[a-f0-9]{64}$'
         or reading.value->>'requestBytesSha256' is distinct from pg_catalog.encode(extensions.digest(
           'GET'||E'\n'||case reading.ordinality
             when 1 then '/rest/prodmarketservice/sellerprodcode/'||seller_code
             when 2 then '/rest/prodmarketservice/prodmarket/'||v_remote_id
             when 3 then '/rest/prodmarketservice/prodmarket/'||v_remote_id
             when 4 then '/rest/prodmarketservice/prodmarket/stck/'||v_remote_id end||E'\n',
           'sha256'),'hex')
    );
  if completed then
    update sellerpilot_private.product_listings value set
      remote_id=v_remote_id,status='published',last_error=null,
      published_at=coalesce(value.published_at,pg_catalog.clock_timestamp()),
      last_verified_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
     where value.id=listing.id and value.remote_id is null;
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_LISTING_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.channel_operation_attempts value set
      status='succeeded',http_status=200,remote_id=v_remote_id,
      safe_message='11번가 SellerPrdCd 공식 GET-only 복구 완료',
      completed_at=pg_catalog.clock_timestamp()
     where value.id=attempt.id and value.status in('running','manual_required')
       and value.remote_id is null;
    get diagnostics changed_rows=row_count;
    if changed_rows is distinct from 1 then raise exception 'ELEVENST_CREATE_RECOVERY_ATTEMPT_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.channel_gateway_jobs value set
      status='succeeded',response_payload=pg_catalog.jsonb_build_object(
        'ok',true,'channel','elevenst','operation','listing.create','remoteId',v_remote_id,
        'recovery',p_observation),error_message=null,completed_at=pg_catalog.clock_timestamp(),
      lease_expires_at=null,worker_token_id=null,claim_token=null,updated_at=pg_catalog.clock_timestamp()
     where value.id=job.id and value.status='reconciliation_required';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_JOB_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      status='completed',recovery_observation=p_observation,recovery_claim_token=null,
      recovery_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id and value.status='reconciliation_required';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_PERMIT_MISMATCH' using errcode='40001'; end if;
  else
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      recovery_observation=p_observation,recovery_claim_token=null,
      recovery_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id and value.status='reconciliation_required';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_PERMIT_MISMATCH' using errcode='40001'; end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'status',case when completed then 'completed' else 'reconciliation_required' end,
    'jobId',job.id,'remoteId',case when completed then v_remote_id else null end,
    'automaticRetryAllowed',false,'providerMutationPerformed',false);
exception when no_data_found or invalid_text_representation then
  raise exception 'ELEVENST_CREATE_RECOVERY_CLAIM_STALE' using errcode='40001';
end;
$$;

revoke all on function public.sellerpilot_service_elevenst_new_product_source_readback(
  uuid,uuid,uuid,text,text),
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid,uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_elevenst_new_product_source_readback(
  uuid,uuid,uuid,text,text),
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid,uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)
  to service_role;


alter table sellerpilot_private.elevenst_new_product_execution_permits enable row level security;
revoke all on sellerpilot_private.elevenst_new_product_execution_permits from public,anon,authenticated,service_role;
alter table sellerpilot_private.elevenst_new_product_server_sources enable row level security;
revoke all on sellerpilot_private.elevenst_new_product_server_sources from public,anon,authenticated,service_role;
alter table sellerpilot_private.elevenst_new_product_source_approvals enable row level security;
revoke all on sellerpilot_private.elevenst_new_product_source_approvals from public,anon,authenticated,service_role;
alter table sellerpilot_private.elevenst_new_product_source_retirements enable row level security;
revoke all on sellerpilot_private.elevenst_new_product_source_retirements from public,anon,authenticated,service_role;
commit;
