-- Bind an already-existing SmartStore product to SellerPilot only after fresh
-- official API readback proves the exact owner/product/credential/account,
-- source request, remote identifiers, public sale state, and approved 8-image
-- content. This never rewrites the uncertain CREATE job or attempt, asserts a
-- remote creation origin, or represents it as an API CREATE success.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907150000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_hash(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_approval_revision_is_current(uuid,bigint,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_11820_enqueue_listing_unsafe(uuid,uuid,uuid,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_listing_mutation_release_gate_status()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
     ) is null then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_DEPENDENCY_MISSING';
  end if;
end;
$dependencies$;

-- The earlier exact/manual-browser receipt migration collided with an already
-- applied migration version in production. Bootstrap the table here. If that
-- exact contract exists in another environment, preserve its rows while
-- removing only its one-product checks so official service readback can use
-- the generalized contract.
create table if not exists sellerpilot_private.smartstore_manual_adoption_receipts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null unique references sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  seller_account_key text not null,
  seller_sku text not null,
  origin_product_no text not null,
  channel_product_no text not null,
  public_url text,
  observation jsonb not null,
  observation_sha256 text not null,
  source_request_sha256 text not null,
  source_response_sha256 text not null,
  source_job_snapshot_sha256 text not null,
  source_attempt_snapshot_sha256 text not null,
  listing_snapshot_sha256 text not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  origin text not null default 'existing_remote_adoption',
  provider_call_replayed boolean not null default false,
  content_verified boolean not null default false
);

alter table sellerpilot_private.smartstore_manual_adoption_receipts
  alter column public_url drop not null;

alter table sellerpilot_private.smartstore_manual_adoption_receipts
  drop constraint if exists smartstore_manual_adoption_exact_target,
  drop constraint if exists smartstore_manual_adoption_receipts_credential_version_check,
  drop constraint if exists smartstore_manual_adoption_receipts_seller_account_key_check,
  drop constraint if exists smartstore_manual_adoption_receipts_seller_sku_check,
  drop constraint if exists smartstore_manual_adoption_receipts_origin_product_no_check,
  drop constraint if exists smartstore_manual_adoption_receipts_channel_product_no_check,
  drop constraint if exists smartstore_manual_adoption_receipts_public_url_check,
  drop constraint if exists smartstore_manual_adoption_receipts_observation_check,
  drop constraint if exists smartstore_manual_adoption_receipts_observation_sha256_check,
  drop constraint if exists smartstore_manual_adoption_receipts_source_request_sha256_check,
  drop constraint if exists smartstore_manual_adoption_receipts_source_response_sha256_check,
  drop constraint if exists smartstore_manual_adoption_receipts_origin_check,
  drop constraint if exists smartstore_manual_adoption_receipts_provider_call_replayed_check,
  drop constraint if exists smartstore_manual_adoption_receipts_content_verified_check;

alter table sellerpilot_private.smartstore_manual_adoption_receipts
  add constraint smartstore_manual_adoption_receipt_credential_version_check
    check (credential_version > 0),
  add constraint smartstore_manual_adoption_receipt_account_check
    check (seller_account_key ~ '^[a-f0-9]{64}$'),
  add constraint smartstore_manual_adoption_receipt_sku_check
    check (length(trim(seller_sku)) between 1 and 160 and seller_sku !~ '[[:cntrl:]]'),
  add constraint smartstore_manual_adoption_receipt_remote_ids_check
    check (
      origin_product_no ~ '^[0-9]+$'
      and channel_product_no ~ '^[0-9]+$'
    ),
  add constraint smartstore_manual_adoption_receipt_public_url_check
    check (public_url is null or (length(public_url) <= 1000 and public_url ~ '^https://')),
  add constraint smartstore_manual_adoption_receipt_observation_check
    check (jsonb_typeof(observation) = 'object' and octet_length(observation::text) <= 2097152),
  add constraint smartstore_manual_adoption_receipt_hashes_check
    check (
      observation_sha256 ~ '^[a-f0-9]{64}$'
      and source_request_sha256 ~ '^[a-f0-9]{64}$'
      and source_response_sha256 ~ '^[a-f0-9]{64}$'
      and source_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'
      and source_attempt_snapshot_sha256 ~ '^[a-f0-9]{64}$'
      and listing_snapshot_sha256 ~ '^[a-f0-9]{64}$'
    ),
  add constraint smartstore_manual_adoption_receipt_origin_check
    check (origin in ('manual_seller_center','official_api_readback','existing_remote_adoption')),
  add constraint smartstore_manual_adoption_receipt_no_create_replay_check
    check (not provider_call_replayed),
  add constraint smartstore_manual_adoption_receipt_not_content_attestation_check
    check (not content_verified);

create unique index if not exists smartstore_manual_adoption_receipt_origin_idx
  on sellerpilot_private.smartstore_manual_adoption_receipts
  (seller_account_key, origin_product_no);
create unique index if not exists smartstore_manual_adoption_receipt_channel_idx
  on sellerpilot_private.smartstore_manual_adoption_receipts
  (seller_account_key, channel_product_no);
create unique index if not exists smartstore_manual_adoption_receipt_product_sku_idx
  on sellerpilot_private.smartstore_manual_adoption_receipts
  (owner_id, product_id, seller_account_key, seller_sku);

alter table sellerpilot_private.smartstore_manual_adoption_receipts enable row level security;
revoke all on sellerpilot_private.smartstore_manual_adoption_receipts
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_manual_adoption_attestations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique
    references sellerpilot_private.smartstore_manual_adoption_receipts(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null unique references sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  seller_sku text not null check (
    length(trim(seller_sku)) between 1 and 160 and seller_sku !~ '[[:cntrl:]]'
  ),
  origin_product_no text not null check (origin_product_no ~ '^[0-9]+$'),
  channel_product_no text not null check (channel_product_no ~ '^[0-9]+$'),
  approval_import_id uuid not null
    references sellerpilot_private.external_detail_imports(id) on delete restrict,
  approval_revision bigint not null check (approval_revision > 0),
  approval_content_sha256 text not null check (approval_content_sha256 ~ '^[a-f0-9]{64}$'),
  approved_manifest_digest text not null check (approved_manifest_digest ~ '^[a-f0-9]{64}$'),
  official_readback jsonb not null check (
    jsonb_typeof(official_readback) = 'object'
    and octet_length(official_readback::text) <= 2097152
  ),
  official_readback_sha256 text not null check (official_readback_sha256 ~ '^[a-f0-9]{64}$'),
  search_response_sha256 text not null check (search_response_sha256 ~ '^[a-f0-9]{64}$'),
  origin_response_sha256 text not null check (origin_response_sha256 ~ '^[a-f0-9]{64}$'),
  channel_response_sha256 text not null check (channel_response_sha256 ~ '^[a-f0-9]{64}$'),
  detail_html_sha256 text not null check (detail_html_sha256 ~ '^[a-f0-9]{64}$'),
  detail_image_urls jsonb not null check (
    jsonb_typeof(detail_image_urls) = 'array'
    and jsonb_array_length(detail_image_urls) = 8
  ),
  detail_image_pixel_sha256s jsonb not null check (
    jsonb_typeof(detail_image_pixel_sha256s) = 'array'
    and jsonb_array_length(detail_image_pixel_sha256s) = 8
  ),
  source_job_snapshot_sha256 text not null check (source_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_attempt_snapshot_sha256 text not null check (source_attempt_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_listing_snapshot_sha256 text not null check (source_listing_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  adopted_listing_snapshot_sha256 text not null check (adopted_listing_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  attested_at timestamptz not null default clock_timestamp(),
  provenance text not null default 'manual_adoption_verified'
    check (provenance = 'manual_adoption_verified'),
  api_create_succeeded boolean not null default false check (not api_create_succeeded),
  provider_mutation_performed boolean not null default false check (not provider_mutation_performed),
  unique (seller_account_key, origin_product_no),
  unique (seller_account_key, channel_product_no),
  unique (owner_id, product_id, seller_account_key, seller_sku),
  foreign key (approval_import_id, approval_revision)
    references sellerpilot_private.external_detail_approval_revisions(import_id, revision)
    on delete restrict
);

alter table sellerpilot_private.smartstore_manual_adoption_attestations enable row level security;
revoke all on sellerpilot_private.smartstore_manual_adoption_attestations
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_jsonb_has_exact_keys(
  p_value jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'object'
    and coalesce((
      select array_agg(key order by key)
      from jsonb_object_keys(p_value) key
    ), array[]::text[]) = (
      select array_agg(key order by key) from unnest(p_keys) key
    )
$$;

revoke all on function
  sellerpilot_private.smartstore_jsonb_has_exact_keys(jsonb,text[])
  from public, anon, authenticated, service_role;

-- Build the current approved manifest directly from the approved import. A
-- historical CREATE request can predate approval revisions, so its legacy
-- publication binding is verified separately and is never rewritten merely to
-- make the newer source-job manifest helper accept it.
create function sellerpilot_private.smartstore_current_approved_manifest(
  p_import_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  external_import sellerpilot_private.external_detail_imports%rowtype;
  approval sellerpilot_private.external_detail_approval_revisions%rowtype;
  images jsonb;
  pixels jsonb;
  canonical text;
begin
  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = p_import_id;
  select * into approval
  from sellerpilot_private.external_detail_approval_revisions
  where import_id = p_import_id
  order by revision desc limit 1;
  if external_import.id is null or approval.import_id is null
     or not sellerpilot_private.external_detail_approval_revision_is_current(
       approval.import_id,approval.revision,approval.content_sha256
     )
     or jsonb_typeof(external_import.payload->'assets') <> 'array'
     or jsonb_array_length(external_import.payload->'assets') <> 8
     or jsonb_typeof(external_import.receipts) <> 'array'
     or jsonb_array_length(external_import.receipts) <> 8 then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object(
      'role',value->>'role','path',value->>'storagePath',
      'sourceSha256',value->>'sourceSha256'
    ) order by ordinal),
    string_agg(
      (value->>'role') || chr(9) || (value->>'storagePath') || chr(9)
        || (value->>'sourceSha256'),chr(10) order by ordinal
    )
  into images,canonical
  from jsonb_array_elements(external_import.payload->'assets')
  with ordinality asset(value,ordinal);
  select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
  into pixels
  from jsonb_array_elements(external_import.receipts)
  with ordinality receipt(value,ordinal);
  if canonical is null
     or exists (
       select 1 from jsonb_array_elements(images) image(value)
       where coalesce(value->>'role','') = ''
          or coalesce(value->>'path','') = ''
          or coalesce(value->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
     )
     or exists (
       select 1 from jsonb_array_elements_text(pixels) value
       where value !~ '^[a-f0-9]{64}$'
     ) then
    return null;
  end if;
  return jsonb_build_object(
    'contract','sellerpilot_detail_image_manifest_v2',
    'algorithm','sha256',
    'digest',encode(sha256(convert_to(canonical,'UTF8')),'hex'),
    'images',images,
    'pixelSha256s',pixels,
    'approvalRevision',approval.revision,
    'contentSha256',approval.content_sha256
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_current_approved_manifest(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_legacy_publication_binding_is_current(
  p_job_id uuid,
  p_product_id uuid,
  p_manifest_digest text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  product sellerpilot_private.products%rowtype;
  external_import sellerpilot_private.external_detail_imports%rowtype;
  binding jsonb;
  locale text;
begin
  select * into job from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  select * into product from sellerpilot_private.products where id=p_product_id;
  binding:=job.request_payload#>'{arguments,sellerpilotExternalDetail}';
  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id=product.external_detail_import_id;
  if job.id is null or product.id is null or external_import.id is null
     or binding is null
     or job.channel <> 'smartstore'
     or job.operation <> 'listing.create'
     or job.created_by is distinct from (
       select credential.created_by
       from sellerpilot_private.channel_credentials credential
       where credential.id=job.credential_id
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users admin_user
       where admin_user.user_id=job.created_by
     )
     or external_import.product_id is distinct from product.id
     or external_import.owner_id is distinct from product.owner_id
     or binding->>'importId' is distinct from external_import.id::text
     or binding->>'productId' is distinct from product.id::text
     or binding->>'ownerId' is distinct from product.owner_id::text
     or binding->>'requestSha256' is distinct from external_import.request_sha256
     or binding->>'version' is distinct from external_import.approved_detail_version::text
     or binding->>'channel' <> 'smartstore'
     or split_part(binding->>'locale','-',1) is distinct from binding->>'language'
     or binding->>'locale' is distinct from
       job.request_payload#>>'{arguments,publicationExpectedLocale}'
     or job.request_fingerprint is distinct from
       job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
     or binding->>'documentSha256' is distinct from external_import.payload#>>array[
       'reviewedCopy',binding->>'language','documentSha256'
     ]
     or binding->>'exportSha256' is distinct from
       sellerpilot_private.external_detail_hash(jsonb_build_object(
         'title',binding->'title','html',binding->'html','plain',binding->'plain',
         'sections',binding->'sections'
       ))
     or binding->'imageSha256s' is distinct from (
       select jsonb_agg(value->'sourceSha256' order by ordinal)
       from jsonb_array_elements(external_import.payload->'assets')
       with ordinality asset(value,ordinal)
     )
     or binding->'pixelSha256s' is distinct from (
       select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
       from jsonb_array_elements(external_import.receipts)
       with ordinality receipt(value,ordinal)
     )
     or coalesce(p_manifest_digest,'') !~ '^[a-f0-9]{64}$'
     or p_manifest_digest is distinct from
       sellerpilot_private.smartstore_current_approved_manifest(external_import.id)->>'digest' then
    return false;
  end if;
  foreach locale in array array['ko','ja','en'] loop
    if binding#>>array['allLocaleDocumentSha256',locale]
         is distinct from external_import.payload#>>array[
           'reviewedCopy',locale,'documentSha256'
         ] then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_legacy_publication_binding_is_current(uuid,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.guard_smartstore_manual_adoption_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'SMARTSTORE_MANUAL_RECEIPT_IMMUTABLE';
  end if;
  if current_setting('sellerpilot.smartstore_manual_adoption_service', true)
       is distinct from new.recorded_by::text
     or not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'SMARTSTORE_MANUAL_RECEIPT_SERVICE_REQUIRED'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_smartstore_manual_adoption_receipt()
  from public, anon, authenticated, service_role;
drop trigger if exists smartstore_manual_adoption_immutable
  on sellerpilot_private.smartstore_manual_adoption_receipts;
create trigger smartstore_manual_adoption_immutable
before insert or update or delete
on sellerpilot_private.smartstore_manual_adoption_receipts
for each row execute function sellerpilot_private.guard_smartstore_manual_adoption_receipt();

create function sellerpilot_private.guard_smartstore_manual_adoption_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'SMARTSTORE_MANUAL_ATTESTATION_IMMUTABLE';
  end if;
  if current_setting('sellerpilot.smartstore_manual_adoption_attestation', true)
       is distinct from new.id::text
     or not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'SMARTSTORE_MANUAL_ATTESTATION_SERVICE_REQUIRED'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_smartstore_manual_adoption_attestation()
  from public, anon, authenticated, service_role;
create trigger smartstore_manual_adoption_attestation_immutable
before insert or update or delete
on sellerpilot_private.smartstore_manual_adoption_attestations
for each row execute function
  sellerpilot_private.guard_smartstore_manual_adoption_attestation();

create function sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(
  p_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
  receipt sellerpilot_private.smartstore_manual_adoption_receipts%rowtype;
begin
  select * into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations
  where source_job_id = p_job_id;
  select * into receipt
  from sellerpilot_private.smartstore_manual_adoption_receipts
  where id = attestation.receipt_id;

  if attestation.id is null or receipt.id is null then return false; end if;

  return exists (
    select 1
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = attestation.source_attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = attestation.listing_id
    join sellerpilot_private.products product
      on product.id = attestation.product_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = attestation.credential_id
    join sellerpilot_private.external_detail_approval_revisions approval
      on approval.import_id = attestation.approval_import_id
     and approval.revision = attestation.approval_revision
   where job.id = p_job_id
     and job.id = attestation.source_job_id
     and job.status = 'reconciliation_required'
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.listing_id = listing.id
     and job.attempt_id = attempt.id
     and job.credential_id = credential.id
     and exists (
       select 1 from sellerpilot_private.admin_users admin_user
       where admin_user.user_id = job.created_by
     )
     and job.seller_account_key = attestation.seller_account_key
     and encode(sha256(convert_to(to_jsonb(job)::text,'UTF8')),'hex')
       = attestation.source_job_snapshot_sha256
     and attempt.status = 'manual_required'
     and attempt.channel = 'smartstore'
     and attempt.operation = 'listing.create'
     and attempt.owner_id = attestation.owner_id
     and attempt.credential_id = credential.id
     and attempt.seller_account_key = attestation.seller_account_key
     and encode(sha256(convert_to(to_jsonb(attempt)::text,'UTF8')),'hex')
       = attestation.source_attempt_snapshot_sha256
     and listing.owner_id = attestation.owner_id
     and listing.product_id = product.id
     and listing.channel_key = 'smartstore'
     and listing.remote_id = attestation.origin_product_no
     and listing.marketplace_sku = attestation.seller_sku
     and listing.seller_account_key = attestation.seller_account_key
     and product.owner_id = attestation.owner_id
     and product.sku = attestation.seller_sku
     and credential.created_by = job.created_by
     and credential.channel = 'smartstore'
     and credential.environment = 'production'
     and credential.version = attestation.credential_version
     and credential.seller_account_key = attestation.seller_account_key
     and approval.product_id = attestation.product_id
     and approval.owner_id = attestation.owner_id
     and approval.content_sha256 = attestation.approval_content_sha256
     and receipt.owner_id = attestation.owner_id
     and receipt.product_id = attestation.product_id
     and receipt.listing_id = attestation.listing_id
     and receipt.source_job_id = attestation.source_job_id
     and receipt.source_attempt_id = attestation.source_attempt_id
     and receipt.credential_id = attestation.credential_id
     and receipt.credential_version = attestation.credential_version
     and receipt.seller_account_key = attestation.seller_account_key
     and receipt.seller_sku = attestation.seller_sku
     and receipt.origin_product_no = attestation.origin_product_no
     and receipt.channel_product_no = attestation.channel_product_no
     and receipt.source_job_snapshot_sha256 = attestation.source_job_snapshot_sha256
     and receipt.source_attempt_snapshot_sha256 = attestation.source_attempt_snapshot_sha256
     and receipt.listing_snapshot_sha256 = attestation.source_listing_snapshot_sha256
     and attestation.provenance = 'manual_adoption_verified'
     and not attestation.api_create_succeeded
     and not attestation.provider_mutation_performed
  );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.listing_mutation_reconciliation_resolved(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
  select sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(p_job_id)
      or sellerpilot_private.temu_safe_test_source_reconciliation_resolved(p_job_id)
      or sellerpilot_private.unstarted_listing_create_reconciliation_resolved(p_job_id)
      or sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(p_job_id)
      or sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(p_job_id)
$$;

revoke all on function
  sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_manual_adoption_listing_transition_allowed(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
  select exists (
    select 1
    from sellerpilot_private.smartstore_manual_adoption_attestations attestation
    join sellerpilot_private.smartstore_manual_adoption_receipts receipt
      on receipt.id = attestation.receipt_id
   where attestation.id::text = current_setting(
       'sellerpilot.smartstore_manual_adoption_attestation', true
     )
     and p_old->>'id' = attestation.listing_id::text
     and attestation.source_listing_snapshot_sha256 =
       encode(sha256(convert_to(p_old::text,'UTF8')),'hex')
     and attestation.adopted_listing_snapshot_sha256 =
       encode(sha256(convert_to(p_new::text,'UTF8')),'hex')
     and p_new = p_old || jsonb_build_object(
       'remote_id', attestation.origin_product_no,
       'marketplace_sku', attestation.seller_sku,
       'seller_account_key', attestation.seller_account_key,
       'status', 'published',
       'requested_publication_intent', 'live',
       'remote_visibility', 'live',
       'provider_status', 'SALE|ON',
       'remote_resources', jsonb_build_object(
         'resources', jsonb_build_object(
           'originProductNo', attestation.origin_product_no,
           'smartstoreChannelProductNo', attestation.channel_product_no,
           'sellerManagementCode', attestation.seller_sku
         ),
         'verification', jsonb_build_object(
           'contract', 'smartstore_manual_adoption_verified_v1',
           'provenance', 'manual_adoption_verified',
           'receiptId', receipt.id,
           'attestationId', attestation.id,
           'sourceJobId', attestation.source_job_id,
           'sourceAttemptId', attestation.source_attempt_id,
           'approvalImportId', attestation.approval_import_id,
           'approvalRevision', attestation.approval_revision,
           'contentSha256', attestation.approval_content_sha256,
           'manifestDigest', attestation.approved_manifest_digest,
           'officialReadbackSha256', attestation.official_readback_sha256,
           'detailImageCount', 8,
           'apiCreateSucceeded', false,
           'providerMutationPerformed', false,
           'verifiedAt', attestation.observed_at
         )
       ),
       'price', (attestation.official_readback#>>'{originReadback,response,originProduct,salePrice}')::numeric,
       'last_error', null,
       'failure_class', null,
       'published_at', attestation.observed_at,
       'last_verified_at', attestation.observed_at,
       'public_page_status', 'unverified',
       'public_page_checked_at', null,
       'updated_at', attestation.attested_at
     )
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_listing_transition_allowed(jsonb,jsonb)
  from public, anon, authenticated, service_role;

-- Install a narrow transition branch in the existing complete seller-lineage
-- guard. A transaction-local attestation id alone is insufficient: the helper
-- compares the entire OLD and NEW rows against immutable evidence.
do $listing_guard$
declare
  definition text;
  after_entry text := E'\nbegin\n  if current_setting(''sellerpilot.smartstore_manual_adoption_attestation'', true) <> '''' then\n    if not sellerpilot_private.smartstore_manual_adoption_listing_transition_allowed(\n      to_jsonb(old), to_jsonb(new)\n    ) then\n      raise exception ''SMARTSTORE_MANUAL_ADOPTION_LISTING_TRANSITION_INVALID'';\n    end if;\n    return new;\n  end if;\n';
  entry_position integer;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into definition;
  if pg_catalog.strpos(definition, 'sellerpilot.smartstore_manual_adoption_attestation') = 0 then
    -- pg_get_functiondef preserves formatter-specific indentation around the
    -- PL/pgSQL entry token. Match the token itself; this fixed function's
    -- header cannot contain it.
    entry_position := pg_catalog.strpos(pg_catalog.lower(definition), 'begin');
    if entry_position = 0 then
      raise exception 'SMARTSTORE_LISTING_GUARD_ENTRY_NOT_FOUND';
    end if;
    execute pg_catalog.substr(definition,1,entry_position-1)
      || after_entry
      || pg_catalog.substr(definition,entry_position+5);
  end if;
end;
$listing_guard$;

create function sellerpilot_private.guard_smartstore_manual_adoption_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
begin
  select * into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations
  where listing_id = coalesce(new.id, old.id);
  if attestation.id is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_LISTING_IMMUTABLE';
  end if;
  if current_setting('sellerpilot.smartstore_manual_adoption_attestation', true)
       = attestation.id::text
     and sellerpilot_private.smartstore_manual_adoption_listing_transition_allowed(
       to_jsonb(old), to_jsonb(new)
     ) then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.product_id is distinct from old.product_id
     or new.channel_key is distinct from old.channel_key
     or new.market is distinct from old.market
     or new.target_id is distinct from old.target_id
     or new.seller_account_key is distinct from old.seller_account_key
     or new.remote_id is distinct from old.remote_id
     or new.marketplace_sku is distinct from old.marketplace_sku then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_LISTING_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_smartstore_manual_adoption_lineage()
  from public, anon, authenticated, service_role;
create trigger smartstore_manual_adoption_listing_lineage
before update or delete on sellerpilot_private.product_listings
for each row execute function sellerpilot_private.guard_smartstore_manual_adoption_lineage();

create function sellerpilot_private.guard_smartstore_manual_adoption_source_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from sellerpilot_private.smartstore_manual_adoption_attestations attestation
    where (tg_table_name = 'channel_gateway_jobs' and attestation.source_job_id = old.id)
       or (tg_table_name = 'channel_operation_attempts' and attestation.source_attempt_id = old.id)
  ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SOURCE_LEDGER_IMMUTABLE';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function sellerpilot_private.guard_smartstore_manual_adoption_source_ledger()
  from public, anon, authenticated, service_role;
create trigger smartstore_manual_adoption_source_job_immutable
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_smartstore_manual_adoption_source_ledger();
create trigger smartstore_manual_adoption_source_attempt_immutable
before update or delete on sellerpilot_private.channel_operation_attempts
for each row execute function
  sellerpilot_private.guard_smartstore_manual_adoption_source_ledger();

create function public.sellerpilot_service_prepare_smartstore_manual_adoption(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_count integer;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  manifest jsonb;
  binding jsonb;
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users where user_id = p_actor
     ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  select * into product
  from sellerpilot_private.products
  where id = p_product_id and owner_id = p_actor and not demo and status <> 'archived';
  if product.id is null then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_OWNER_REQUIRED'
      using errcode = '42501';
  end if;

  select count(*)::integer into source_count
  from sellerpilot_private.channel_gateway_jobs job
  join sellerpilot_private.product_listings candidate on candidate.id = job.listing_id
  where candidate.product_id = product.id
    and candidate.owner_id = product.owner_id
    and candidate.channel_key = 'smartstore'
    and job.channel = 'smartstore'
    and job.operation = 'listing.create'
    and job.status = 'reconciliation_required';
  if source_count <> 1 then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_prepare_v1',
      'status','blocked',
      'reason',case when source_count = 0 then 'SOURCE_RECONCILIATION_REQUIRED' else 'SOURCE_RECONCILIATION_AMBIGUOUS' end,
      'productId',product.id,
      'listingId',null,
      'sourceJobId',null,
      'sourceAttemptId',null,
      'credentialId',null,
      'sellerSku',product.sku,
      'originProductNo',null,
      'channelProductNo',null,
      'approvalRevision',null,
      'contentSha256',null,
      'manifestDigest',null,
      'receiptId',null,
      'attestationId',null,
      'provenance',null,
      'remoteCreationOriginAsserted',false,
      'apiCreateSucceeded',false,
      'providerMutationPerformed',false,
      'contentVerified',false,
      'normalUpdateEligible',false,
      'normalUpdateEligibilityScope','database_linkage_only',
      'publicationGateOpenAsserted',false,
      'reused',false
    );
  end if;

  select job.* into source_job
  from sellerpilot_private.channel_gateway_jobs job
  join sellerpilot_private.product_listings candidate on candidate.id = job.listing_id
  where candidate.product_id = product.id
    and candidate.owner_id = product.owner_id
    and candidate.channel_key = 'smartstore'
    and job.channel = 'smartstore'
    and job.operation = 'listing.create'
    and job.status = 'reconciliation_required';
  select * into listing from sellerpilot_private.product_listings where id = source_job.listing_id;
  select * into attempt from sellerpilot_private.channel_operation_attempts where id = source_job.attempt_id;
  select * into credential from sellerpilot_private.channel_credentials where id = source_job.credential_id;
  select * into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations
  where source_job_id = source_job.id;

  if attestation.id is not null then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_prepare_v1',
      'status',case when sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id) then 'already_verified' else 'blocked' end,
      'reason',case when sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id) then null else 'VERIFIED_BINDING_DRIFT' end,
      'productId',product.id,
      'listingId',listing.id,
      'sourceJobId',source_job.id,
      'sourceAttemptId',attempt.id,
      'credentialId',credential.id,
      'sellerSku',attestation.seller_sku,
      'originProductNo',attestation.origin_product_no,
      'channelProductNo',attestation.channel_product_no,
      'approvalRevision',attestation.approval_revision,
      'contentSha256',attestation.approval_content_sha256,
      'manifestDigest',attestation.approved_manifest_digest,
      'receiptId',attestation.receipt_id,
      'attestationId',attestation.id,
      'normalUpdateEligible',sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id),
      'normalUpdateEligibilityScope','database_linkage_only',
      'publicationGateOpenAsserted',false,
      'provenance','manual_adoption_verified',
      'remoteCreationOriginAsserted',false,
      'apiCreateSucceeded',false,
      'providerMutationPerformed',false,
      'contentVerified',true,
      'reused',true
    );
  end if;

  binding := source_job.request_payload#>'{arguments,sellerpilotExternalDetail}';
  manifest := sellerpilot_private.smartstore_current_approved_manifest(
    product.external_detail_import_id
  );
  if listing.id is null
     or attempt.id is null
     or credential.id is null
     or listing.owner_id is distinct from p_actor
     or product.owner_id is distinct from p_actor
     or attempt.owner_id is distinct from p_actor
     or credential.created_by is distinct from source_job.created_by
     or not exists (
       select 1 from sellerpilot_private.admin_users admin_user
       where admin_user.user_id=source_job.created_by
     )
     or source_job.attempt_id is distinct from attempt.id
     or source_job.credential_id is distinct from credential.id
     or attempt.credential_id is distinct from credential.id
     or listing.operation_attempt_id is distinct from attempt.id
     or attempt.request_fingerprint is distinct from source_job.request_fingerprint
     or source_job.seller_account_key is null
     or source_job.seller_account_key is distinct from attempt.seller_account_key
     or (listing.seller_account_key is not null
       and source_job.seller_account_key is distinct from listing.seller_account_key)
     or source_job.seller_account_key is distinct from credential.seller_account_key
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or credential.seller_account_key_source not in ('provider_certified_v1','credential_incarnation_v1')
     or (credential.expires_at is not null and credential.expires_at <= clock_timestamp())
     or attempt.channel <> 'smartstore'
     or attempt.operation <> 'listing.create'
     or attempt.status <> 'manual_required'
     or source_job.provider_mutation_started_at is null
     or source_job.completed_at is null
     or listing.status <> 'failed'
     or listing.failure_class <> 'external_action'
     or listing.remote_id is not null
     or listing.requested_publication_intent <> 'live'
     or product.sku is distinct from source_job.request_payload#>>'{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}'
     or jsonb_typeof(source_job.request_payload#>'{arguments,body,originProduct,salePrice}') <> 'number'
     or (source_job.request_payload#>>'{arguments,body,originProduct,salePrice}')::numeric
       is distinct from listing.price
     or jsonb_typeof(source_job.request_payload#>'{arguments,body,originProduct,stockQuantity}') <> 'number'
     or (source_job.request_payload#>>'{arguments,body,originProduct,stockQuantity}')::numeric
       is distinct from product.on_hand::numeric
     or binding is null
     or binding->>'productId' is distinct from product.id::text
     or binding->>'ownerId' is distinct from product.owner_id::text
     or manifest is null
     or coalesce(manifest->>'digest','') !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.smartstore_legacy_publication_binding_is_current(
       source_job.id,product.id,manifest->>'digest'
     ) then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_prepare_v1',
      'status','blocked',
      'reason','SOURCE_TUPLE_OR_APPROVAL_NOT_CURRENT',
      'productId',product.id,
      'listingId',listing.id,
      'sourceJobId',source_job.id,
      'sourceAttemptId',attempt.id,
      'credentialId',credential.id,
      'sellerSku',product.sku,
      'originProductNo',null,
      'channelProductNo',null,
      'approvalRevision',null,
      'contentSha256',null,
      'manifestDigest',null,
      'receiptId',null,
      'attestationId',null,
      'provenance',null,
      'remoteCreationOriginAsserted',false,
      'apiCreateSucceeded',false,
      'providerMutationPerformed',false,
      'contentVerified',false,
      'normalUpdateEligible',false,
      'normalUpdateEligibilityScope','database_linkage_only',
      'publicationGateOpenAsserted',false,
      'reused',false
    );
  end if;

  return jsonb_build_object(
    'contract','smartstore_manual_adoption_prepare_v1',
    'status','ready',
    'reason',null,
    'productId',product.id,
    'listingId',listing.id,
    'sourceJobId',source_job.id,
    'sourceAttemptId',attempt.id,
    'credentialId',credential.id,
    'sellerSku',product.sku,
    'originProductNo',null,
    'channelProductNo',null,
    'approvalRevision',(manifest->>'approvalRevision')::bigint,
    'contentSha256',manifest->>'contentSha256',
    'manifestDigest',manifest->>'digest',
    'receiptId',null,
    'attestationId',null,
    'normalUpdateEligible',false,
    'normalUpdateEligibilityScope','database_linkage_only',
    'publicationGateOpenAsserted',false,
    'provenance',null,
    'remoteCreationOriginAsserted',false,
    'apiCreateSucceeded',false,
    'providerMutationPerformed',false,
    'contentVerified',false,
    'reused',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_prepare_smartstore_manual_adoption(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_prepare_smartstore_manual_adoption(uuid,uuid)
  to service_role;

create function public.sellerpilot_service_commit_smartstore_manual_adoption(
  p_actor uuid,
  p_product_id uuid,
  p_source_job_id uuid,
  p_credential_id uuid,
  p_expected_approval_revision bigint,
  p_expected_content_sha256 text,
  p_expected_manifest_digest text,
  p_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  external_import sellerpilot_private.external_detail_imports%rowtype;
  approval sellerpilot_private.external_detail_approval_revisions%rowtype;
  receipt sellerpilot_private.smartstore_manual_adoption_receipts%rowtype;
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
  binding jsonb;
  manifest jsonb;
  origin_response jsonb;
  origin_product jsonb;
  embedded_channel jsonb;
  channel_response jsonb;
  channel_product jsonb;
  search_response jsonb;
  origin_no text;
  channel_no text;
  seller_sku text;
  detail_html text;
  expected_origin_name text;
  expected_channel_name text;
  origin_name text;
  channel_name text;
  source_detail_html text;
  extracted_urls jsonb;
  source_extracted_urls jsonb;
  normalized_source_detail_html text;
  normalized_remote_detail_html text;
  image_token text;
  image_index integer;
  expected_pixels jsonb;
  readback_hash text;
  search_hash text;
  origin_hash text;
  channel_hash text;
  detail_hash text;
  job_hash text;
  attempt_hash text;
  listing_hash text;
  adopted_listing jsonb;
  adopted_hash text;
  observed timestamptz;
  match_count integer;
  attestation_id uuid := gen_random_uuid();
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users where user_id = p_actor
     ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if p_product_id is null or p_source_job_id is null or p_credential_id is null
     or p_expected_approval_revision is null or p_expected_approval_revision < 1
     or coalesce(p_expected_content_sha256,'') !~ '^[a-f0-9]{64}$'
     or coalesce(p_expected_manifest_digest,'') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_readback) is distinct from 'object'
     or octet_length(p_readback::text) > 2097152 then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 907150000);

  select * into source_job
  from sellerpilot_private.channel_gateway_jobs
  where id = p_source_job_id for update;
  select * into listing
  from sellerpilot_private.product_listings
  where id = source_job.listing_id for update;
  select * into product
  from sellerpilot_private.products
  where id = p_product_id for update;
  select * into attempt
  from sellerpilot_private.channel_operation_attempts
  where id = source_job.attempt_id for update;
  select * into credential
  from sellerpilot_private.channel_credentials
  where id = p_credential_id for update;

  readback_hash := sellerpilot_private.external_detail_hash(p_readback);
  select * into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations
  where source_job_id = source_job.id for update;
  if attestation.id is not null then
    select * into receipt
    from sellerpilot_private.smartstore_manual_adoption_receipts
    where id = attestation.receipt_id for update;
    if attestation.owner_id is distinct from p_actor
       or attestation.product_id is distinct from p_product_id
       or attestation.credential_id is distinct from p_credential_id
       or attestation.official_readback_sha256 is distinct from readback_hash
       or attestation.approval_revision is distinct from p_expected_approval_revision
       or attestation.approval_content_sha256 is distinct from p_expected_content_sha256
       or attestation.approved_manifest_digest is distinct from p_expected_manifest_digest
       or not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id) then
      raise exception 'SMARTSTORE_MANUAL_ADOPTION_ATTESTATION_CONFLICT';
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_verified_v1',
      'status','already_verified',
      'receiptId',receipt.id,
      'attestationId',attestation.id,
      'productId',product.id,
      'listingId',listing.id,
      'sourceJobId',source_job.id,
      'sourceAttemptId',attempt.id,
      'credentialId',credential.id,
      'originProductNo',attestation.origin_product_no,
      'channelProductNo',attestation.channel_product_no,
      'sellerSku',attestation.seller_sku,
      'provenance','manual_adoption_verified',
      'remoteCreationOriginAsserted',false,
      'apiCreateSucceeded',false,
      'providerMutationPerformed',false,
      'sourcePreserved',true,
      'contentVerified',true,
      'normalUpdateEligible',true,
      'normalUpdateEligibilityScope','database_linkage_only',
      'publicationGateOpenAsserted',false,
      'reused',true
    );
  end if;

  seller_sku := source_job.request_payload#>>'{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}';
  binding := source_job.request_payload#>'{arguments,sellerpilotExternalDetail}';
  manifest := sellerpilot_private.smartstore_current_approved_manifest(
    product.external_detail_import_id
  );
  if source_job.id is null or listing.id is null or product.id is null
     or attempt.id is null or credential.id is null
     or source_job.listing_id is distinct from listing.id
     or listing.product_id is distinct from product.id
     or product.id is distinct from p_product_id
     or product.owner_id is distinct from p_actor
     or listing.owner_id is distinct from p_actor
     or attempt.owner_id is distinct from p_actor
     or credential.created_by is distinct from source_job.created_by
     or not exists (
       select 1 from sellerpilot_private.admin_users admin_user
       where admin_user.user_id=source_job.created_by
     )
     or source_job.credential_id is distinct from credential.id
     or credential.id is distinct from p_credential_id
     or source_job.attempt_id is distinct from attempt.id
     or attempt.credential_id is distinct from credential.id
     or listing.operation_attempt_id is distinct from attempt.id
     or attempt.request_fingerprint is distinct from source_job.request_fingerprint
     or source_job.channel <> 'smartstore'
     or source_job.environment <> 'production'
     or source_job.operation <> 'listing.create'
     or source_job.status <> 'reconciliation_required'
     or source_job.provider_mutation_started_at is null
     or source_job.completed_at is null
     or attempt.channel <> 'smartstore'
     or attempt.operation <> 'listing.create'
     or attempt.status <> 'manual_required'
     or listing.channel_key <> 'smartstore'
     or listing.status <> 'failed'
     or listing.failure_class <> 'external_action'
     or listing.remote_id is not null
     or listing.requested_publication_intent <> 'live'
     or product.demo or product.status = 'archived'
     or seller_sku is null or seller_sku is distinct from product.sku
     or jsonb_typeof(source_job.request_payload#>'{arguments,body,originProduct,salePrice}') <> 'number'
     or (source_job.request_payload#>>'{arguments,body,originProduct,salePrice}')::numeric
       is distinct from listing.price
     or jsonb_typeof(source_job.request_payload#>'{arguments,body,originProduct,stockQuantity}') <> 'number'
     or (source_job.request_payload#>>'{arguments,body,originProduct,stockQuantity}')::numeric
       is distinct from product.on_hand::numeric
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or credential.seller_account_key_source not in ('provider_certified_v1','credential_incarnation_v1')
     or (credential.expires_at is not null and credential.expires_at <= clock_timestamp())
     or credential.seller_account_key is null
     or credential.seller_account_key is distinct from source_job.seller_account_key
     or credential.seller_account_key is distinct from attempt.seller_account_key
     or (listing.seller_account_key is not null
       and credential.seller_account_key is distinct from listing.seller_account_key)
     or binding->>'productId' is distinct from product.id::text
     or binding->>'ownerId' is distinct from p_actor::text
     or coalesce(binding->>'importId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or manifest is null
     or (manifest->>'approvalRevision')::bigint is distinct from p_expected_approval_revision
     or manifest->>'contentSha256' is distinct from p_expected_content_sha256
     or manifest->>'digest' is distinct from p_expected_manifest_digest
     or not sellerpilot_private.smartstore_legacy_publication_binding_is_current(
       source_job.id,product.id,p_expected_manifest_digest
     )
     or not sellerpilot_private.external_detail_approval_revision_is_current(
       product.external_detail_import_id,
       p_expected_approval_revision,
       p_expected_content_sha256
     ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SOURCE_TUPLE_OR_APPROVAL_DRIFT';
  end if;

  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = (binding->>'importId')::uuid
    and product_id = product.id and owner_id = product.owner_id
  for update;
  select * into approval
  from sellerpilot_private.external_detail_approval_revisions
  where import_id=external_import.id
    and revision=p_expected_approval_revision
    and content_sha256=p_expected_content_sha256
  for update;
  if external_import.id is null
     or approval.import_id is null
     or approval.product_id is distinct from product.id
     or approval.owner_id is distinct from product.owner_id
     or jsonb_typeof(approval.content_snapshot) <> 'object'
     or jsonb_typeof(external_import.receipts) <> 'array'
     or jsonb_array_length(external_import.receipts) <> 8 then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_APPROVED_IMAGES_INVALID';
  end if;

  if not sellerpilot_private.smartstore_jsonb_has_exact_keys(p_readback,array[
       'channelReadback','contract','detailImagePixelSha256s','detailImageUrls',
       'observedAt','originReadback','providerMutationPerformed','searchReadback','source'
     ])
     or p_readback->>'contract' <> 'smartstore_official_manual_adoption_readback_v1'
     or p_readback->>'source' <> 'smartstore_official_api_readback_v1'
     or p_readback->'providerMutationPerformed' is distinct from 'false'::jsonb
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_readback->'searchReadback',array['httpStatus','method','path','request','response']
     )
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_readback->'originReadback',array['httpStatus','method','path','request','response']
     )
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_readback->'channelReadback',array['httpStatus','method','path','request','response']
     ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_READBACK_CONTRACT_INVALID';
  end if;

  observed := (p_readback->>'observedAt')::timestamptz;
  if observed is null or not isfinite(observed)
     or observed > clock_timestamp() + interval '1 minute'
     or observed < clock_timestamp() - interval '15 minutes' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_FRESH_READBACK_REQUIRED';
  end if;
  if p_readback#>>'{searchReadback,method}' <> 'POST'
     or p_readback#>>'{searchReadback,path}' <> '/v1/products/search'
     or p_readback#>'{searchReadback,httpStatus}' is distinct from '200'::jsonb
     or p_readback#>'{searchReadback,request}' is distinct from jsonb_build_object(
       'searchKeywordType','SELLER_CODE','sellerManagementCode',seller_sku,
       'page',1,'size',50,'orderType','NO'
     )
     or p_readback#>>'{originReadback,method}' <> 'GET'
     or p_readback#>'{originReadback,httpStatus}' is distinct from '200'::jsonb
     or p_readback#>'{originReadback,request}' is distinct from 'null'::jsonb
     or p_readback#>>'{channelReadback,method}' <> 'GET'
     or p_readback#>'{channelReadback,httpStatus}' is distinct from '200'::jsonb
     or p_readback#>'{channelReadback,request}' is distinct from 'null'::jsonb then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_OFFICIAL_REQUEST_INVALID';
  end if;

  search_response := p_readback#>'{searchReadback,response}';
  origin_response := p_readback#>'{originReadback,response}';
  origin_product := origin_response->'originProduct';
  embedded_channel := origin_response->'smartstoreChannelProduct';
  channel_response := p_readback#>'{channelReadback,response}';
  channel_product := channel_response->'smartstoreChannelProduct';
  origin_no := trim(coalesce(origin_response->>'originProductNo',origin_product->>'originProductNo',''));
  channel_no := trim(coalesce(
    origin_response->>'smartstoreChannelProductNo',embedded_channel->>'channelProductNo',''
  ));
  if origin_no !~ '^[0-9]+$' or channel_no !~ '^[0-9]+$'
     or p_readback#>>'{originReadback,path}'
       is distinct from '/v2/products/origin-products/' || origin_no
     or p_readback#>>'{channelReadback,path}'
       is distinct from '/v2/products/channel-products/' || channel_no
     or coalesce(channel_product->>'channelProductNo',channel_product->>'smartstoreChannelProductNo')
       is distinct from channel_no
     or coalesce(channel_product->>'originProductNo',channel_response->>'originProductNo')
       is distinct from origin_no
     or origin_product->>'statusType' <> 'SALE'
     or channel_product->>'channelProductDisplayStatusType' <> 'ON'
     or origin_product#>>'{detailAttribute,sellerCodeInfo,sellerManagementCode}'
       is distinct from seller_sku then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID';
  end if;

  if jsonb_typeof(search_response) <> 'object'
     or jsonb_typeof(search_response->'contents') <> 'array'
     or jsonb_typeof(search_response->'page') <> 'number'
     or jsonb_typeof(search_response->'size') <> 'number'
     or jsonb_typeof(search_response->'totalElements') <> 'number'
     or jsonb_typeof(search_response->'totalPages') <> 'number'
     or jsonb_typeof(search_response->'first') <> 'boolean'
     or jsonb_typeof(search_response->'last') <> 'boolean' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INVALID';
  end if;
  if (search_response->>'page')::integer <> 1
     or (search_response->>'size')::integer <> 50
     or (search_response->>'totalElements')::integer
       <> jsonb_array_length(search_response->'contents')
     or (search_response->>'totalPages')::integer <> 1
     or search_response->'first' is distinct from 'true'::jsonb
     or search_response->'last' is distinct from 'true'::jsonb then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INCOMPLETE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(search_response->'contents') entry(value)
    where jsonb_typeof(entry.value) <> 'object'
       or jsonb_typeof(entry.value->'channelProducts') <> 'array'
  ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INVALID';
  end if;
  select count(*)::integer into match_count
  from jsonb_array_elements(search_response->'contents') entry(value)
  cross join lateral jsonb_array_elements(entry.value->'channelProducts') channel(value)
  where channel.value->>'sellerManagementCode' = seller_sku;
  if match_count <> 1 or not exists (
    select 1 from jsonb_array_elements(search_response->'contents') entry(value)
    cross join lateral jsonb_array_elements(entry.value->'channelProducts') channel(value)
    where entry.value->>'originProductNo' = origin_no
      and channel.value->>'sellerManagementCode' = seller_sku
      and coalesce(channel.value->>'channelProductNo',channel.value->>'smartstoreChannelProductNo') = channel_no
  ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS';
  end if;

  expected_origin_name := approval.content_snapshot#>>'{product,name}';
  expected_channel_name := source_job.request_payload#>>'{arguments,body,smartstoreChannelProduct,channelProductName}';
  origin_name := origin_product->>'name';
  channel_name := channel_product->>'channelProductName';
  detail_html := origin_product->>'detailContent';
  source_detail_html := source_job.request_payload#>>'{arguments,body,originProduct,detailContent}';
  if coalesce(expected_origin_name,'') = ''
     or origin_name is distinct from expected_origin_name
     or source_job.request_payload#>>'{arguments,body,originProduct,name}'
       is distinct from expected_origin_name
     or coalesce(expected_channel_name,'') = ''
     or expected_channel_name is distinct from expected_origin_name
     or channel_name is distinct from expected_channel_name
     or jsonb_typeof(origin_product->'salePrice') <> 'number'
     or (origin_product->>'salePrice')::numeric is distinct from listing.price
     or jsonb_typeof(origin_product->'stockQuantity') <> 'number'
     or (origin_product->>'stockQuantity')::numeric is distinct from product.on_hand::numeric
     or coalesce(detail_html,'') = ''
     or coalesce(source_detail_html,'') = '' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH';
  end if;

  select coalesce(jsonb_agg(to_jsonb(match[1]) order by ordinal),'[]'::jsonb)
  into extracted_urls
  from regexp_matches(
    detail_html,
    '<img[^>]*[[:space:]]src=["''](https://[^"'']+)["'']',
    'gi'
  ) with ordinality matches(match,ordinal);
  select coalesce(jsonb_agg(to_jsonb(match[1]) order by ordinal),'[]'::jsonb)
  into source_extracted_urls
  from regexp_matches(
    source_detail_html,
    '<img[^>]*[[:space:]]src=["''](https://[^"'']+)["'']',
    'gi'
  ) with ordinality matches(match,ordinal);
  if jsonb_array_length(extracted_urls) <> 8
     or jsonb_array_length(source_extracted_urls) <> 8
     or (select count(distinct value) from jsonb_array_elements_text(extracted_urls) value) <> 8
     or (select count(distinct value) from jsonb_array_elements_text(source_extracted_urls) value) <> 8
     or (select count(*) from regexp_matches(detail_html,'<img([[:space:]]|>)','gi')) <> 8
     or (select count(*) from regexp_matches(source_detail_html,'<img([[:space:]]|>)','gi')) <> 8
     or p_readback->'detailImageUrls' is distinct from extracted_urls
     or exists (
       select 1 from jsonb_array_elements_text(extracted_urls) value
       where value !~* '^https://shop-phinf[.]pstatic[.]net/.+[.][a-z0-9]+$'
     )
     or exists (
       select 1 from jsonb_array_elements_text(source_extracted_urls) value
       where value !~ '^https://'
     ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID';
  end if;
  if jsonb_typeof(source_job.request_payload#>'{arguments,imageUrls}') <> 'array'
     or jsonb_array_length(source_job.request_payload#>'{arguments,imageUrls}') <> 9
     or (select count(distinct value)
           from jsonb_array_elements_text(
             source_job.request_payload#>'{arguments,imageUrls}'
           ) value) <> 9
     or exists (
       select 1 from jsonb_array_elements_text(
         source_job.request_payload#>'{arguments,imageUrls}'
       ) value where value !~ '^https://'
     )
     or exists (
       select 1 from jsonb_array_elements_text(source_extracted_urls) detail_url(value)
       where not exists (
         select 1 from jsonb_array_elements_text(
           source_job.request_payload#>'{arguments,imageUrls}'
         ) argument_url(value)
         where argument_url.value = replace(detail_url.value,'&amp;','&')
       )
     )
     or (
       select count(*)
       from jsonb_array_elements_text(
         source_job.request_payload#>'{arguments,imageUrls}'
       ) argument_url(value)
       where not exists (
         select 1 from jsonb_array_elements_text(source_extracted_urls) detail_url(value)
         where replace(detail_url.value,'&amp;','&') = argument_url.value
       )
     ) <> 1 then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SOURCE_DETAIL_IMAGES_INVALID';
  end if;

  normalized_source_detail_html := source_detail_html;
  normalized_remote_detail_html := detail_html;
  for image_index in 0..7 loop
    image_token := '__SELLERPILOT_DETAIL_IMAGE_' || (image_index + 1)::text || '__';
    if position(image_token in normalized_source_detail_html) > 0
       or position(image_token in normalized_remote_detail_html) > 0 then
      raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_TOKEN_COLLISION';
    end if;
    normalized_source_detail_html := regexp_replace(
      normalized_source_detail_html,
      '(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1' || image_token || E'\\2',
      'i'
    );
    normalized_remote_detail_html := regexp_replace(
      normalized_remote_detail_html,
      '(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1' || image_token || E'\\2',
      'i'
    );
  end loop;
  if normalized_remote_detail_html is distinct from normalized_source_detail_html then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH';
  end if;

  select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
  into expected_pixels
  from jsonb_array_elements(external_import.receipts)
  with ordinality receipt_row(value,ordinal);
  if jsonb_typeof(p_readback->'detailImagePixelSha256s') <> 'array'
     or jsonb_array_length(p_readback->'detailImagePixelSha256s') <> 8
     or exists (
       select 1 from jsonb_array_elements_text(p_readback->'detailImagePixelSha256s') value
       where value !~ '^[a-f0-9]{64}$'
     )
     or p_readback->'detailImagePixelSha256s' is distinct from expected_pixels then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_PIXEL_BINDING_MISMATCH';
  end if;

  search_hash := sellerpilot_private.external_detail_hash(search_response);
  origin_hash := sellerpilot_private.external_detail_hash(origin_response);
  channel_hash := sellerpilot_private.external_detail_hash(channel_response);
  detail_hash := encode(sha256(convert_to(detail_html,'UTF8')),'hex');
  job_hash := encode(sha256(convert_to(to_jsonb(source_job)::text,'UTF8')),'hex');
  attempt_hash := encode(sha256(convert_to(to_jsonb(attempt)::text,'UTF8')),'hex');
  listing_hash := encode(sha256(convert_to(to_jsonb(listing)::text,'UTF8')),'hex');

  select * into receipt
  from sellerpilot_private.smartstore_manual_adoption_receipts
  where source_job_id = source_job.id for update;
  if receipt.id is not null then
    if receipt.owner_id is distinct from p_actor
       or receipt.product_id is distinct from product.id
       or receipt.listing_id is distinct from listing.id
       or receipt.source_attempt_id is distinct from attempt.id
       or receipt.credential_id is distinct from credential.id
       or receipt.credential_version is distinct from credential.version
       or receipt.seller_account_key is distinct from credential.seller_account_key
       or receipt.seller_sku is distinct from seller_sku
       or receipt.origin_product_no is distinct from origin_no
       or receipt.channel_product_no is distinct from channel_no
       or receipt.source_job_snapshot_sha256 is distinct from job_hash
       or receipt.source_attempt_snapshot_sha256 is distinct from attempt_hash
       or receipt.listing_snapshot_sha256 is distinct from listing_hash then
      raise exception 'SMARTSTORE_MANUAL_ADOPTION_LEGACY_RECEIPT_CONFLICT';
    end if;
  else
    perform set_config('sellerpilot.smartstore_manual_adoption_service',p_actor::text,true);
    insert into sellerpilot_private.smartstore_manual_adoption_receipts (
      product_id,listing_id,source_job_id,source_attempt_id,credential_id,
      credential_version,owner_id,seller_account_key,seller_sku,
      origin_product_no,channel_product_no,public_url,observation,
      observation_sha256,source_request_sha256,source_response_sha256,
      source_job_snapshot_sha256,source_attempt_snapshot_sha256,
      listing_snapshot_sha256,observed_at,recorded_by,origin,
      provider_call_replayed,content_verified
    ) values (
      product.id,listing.id,source_job.id,attempt.id,credential.id,
      credential.version,p_actor,credential.seller_account_key,seller_sku,
      origin_no,channel_no,listing.public_url,p_readback,readback_hash,
      encode(sha256(convert_to(source_job.request_payload::text,'UTF8')),'hex'),
      encode(sha256(convert_to(coalesce(source_job.response_payload,'null'::jsonb)::text,'UTF8')),'hex'),
      job_hash,attempt_hash,listing_hash,observed,p_actor,'existing_remote_adoption',false,false
    ) returning * into receipt;
    perform set_config('sellerpilot.smartstore_manual_adoption_service','',true);
  end if;

  select * into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations
  where source_job_id = source_job.id for update;
  if attestation.id is not null then
    if attestation.official_readback_sha256 is distinct from readback_hash
       or attestation.approval_revision is distinct from p_expected_approval_revision
       or attestation.approval_content_sha256 is distinct from p_expected_content_sha256
       or attestation.approved_manifest_digest is distinct from p_expected_manifest_digest
       or not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id) then
      raise exception 'SMARTSTORE_MANUAL_ADOPTION_ATTESTATION_CONFLICT';
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_verified_v1',
      'status','already_verified',
      'receiptId',receipt.id,
      'attestationId',attestation.id,
      'productId',product.id,
      'listingId',listing.id,
      'sourceJobId',source_job.id,
      'sourceAttemptId',attempt.id,
      'credentialId',credential.id,
      'originProductNo',attestation.origin_product_no,
      'channelProductNo',attestation.channel_product_no,
      'sellerSku',attestation.seller_sku,
      'provenance','manual_adoption_verified',
      'remoteCreationOriginAsserted',false,
      'apiCreateSucceeded',false,
      'providerMutationPerformed',false,
      'sourcePreserved',true,
      'contentVerified',true,
      'normalUpdateEligible',true,
      'normalUpdateEligibilityScope','database_linkage_only',
      'publicationGateOpenAsserted',false,
      'reused',true
    );
  end if;

  adopted_listing := to_jsonb(listing) || jsonb_build_object(
    'remote_id',origin_no,
    'marketplace_sku',seller_sku,
    'seller_account_key',credential.seller_account_key,
    'status','published',
    'requested_publication_intent','live',
    'remote_visibility','live',
    'provider_status','SALE|ON',
    'remote_resources',jsonb_build_object(
      'resources',jsonb_build_object(
        'originProductNo',origin_no,
        'smartstoreChannelProductNo',channel_no,
        'sellerManagementCode',seller_sku
      ),
      'verification',jsonb_build_object(
        'contract','smartstore_manual_adoption_verified_v1',
        'provenance','manual_adoption_verified',
        'receiptId',receipt.id,
        'attestationId',attestation_id,
        'sourceJobId',source_job.id,
        'sourceAttemptId',attempt.id,
        'approvalImportId',external_import.id,
        'approvalRevision',p_expected_approval_revision,
        'contentSha256',p_expected_content_sha256,
        'manifestDigest',p_expected_manifest_digest,
        'officialReadbackSha256',readback_hash,
        'detailImageCount',8,
        'apiCreateSucceeded',false,
        'providerMutationPerformed',false,
        'verifiedAt',observed
      )
    ),
    'price',(origin_product->>'salePrice')::numeric,
    'last_error',null,
    'failure_class',null,
    'published_at',observed,
    'last_verified_at',observed,
    'public_page_status','unverified',
    'public_page_checked_at',null,
    'updated_at',clock_timestamp()
  );
  adopted_hash := encode(sha256(convert_to(adopted_listing::text,'UTF8')),'hex');

  perform set_config(
    'sellerpilot.smartstore_manual_adoption_attestation',attestation_id::text,true
  );
  insert into sellerpilot_private.smartstore_manual_adoption_attestations (
    id,receipt_id,owner_id,product_id,listing_id,source_job_id,
    source_attempt_id,credential_id,credential_version,seller_account_key,
    seller_sku,origin_product_no,channel_product_no,approval_import_id,
    approval_revision,approval_content_sha256,approved_manifest_digest,
    official_readback,official_readback_sha256,search_response_sha256,
    origin_response_sha256,channel_response_sha256,detail_html_sha256,
    detail_image_urls,detail_image_pixel_sha256s,source_job_snapshot_sha256,
    source_attempt_snapshot_sha256,source_listing_snapshot_sha256,
    adopted_listing_snapshot_sha256,observed_at,attested_at
  ) values (
    attestation_id,receipt.id,p_actor,product.id,listing.id,source_job.id,
    attempt.id,credential.id,credential.version,credential.seller_account_key,
    seller_sku,origin_no,channel_no,external_import.id,
    p_expected_approval_revision,p_expected_content_sha256,p_expected_manifest_digest,
    p_readback,readback_hash,search_hash,origin_hash,channel_hash,detail_hash,
    extracted_urls,p_readback->'detailImagePixelSha256s',job_hash,
    attempt_hash,listing_hash,adopted_hash,observed,
    (adopted_listing->>'updated_at')::timestamptz
  ) returning * into attestation;

  update sellerpilot_private.product_listings
  set remote_id = origin_no,
      marketplace_sku = seller_sku,
      seller_account_key = credential.seller_account_key,
      status = 'published',
      requested_publication_intent = 'live',
      remote_visibility = 'live',
      provider_status = 'SALE|ON',
      remote_resources = adopted_listing->'remote_resources',
      price = (origin_product->>'salePrice')::numeric,
      last_error = null,
      failure_class = null,
      published_at = observed,
      last_verified_at = observed,
      public_page_status = 'unverified',
      public_page_checked_at = null,
      updated_at = attestation.attested_at
  where id = listing.id;
  if not found or encode(sha256(convert_to((
       select to_jsonb(current_listing)::text
       from sellerpilot_private.product_listings current_listing
       where current_listing.id = listing.id
     ),'UTF8')),'hex') is distinct from adopted_hash then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_LISTING_BIND_FAILED';
  end if;
  perform set_config('sellerpilot.smartstore_manual_adoption_attestation','',true);

  if not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(source_job.id) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_RESOLUTION_FAILED';
  end if;

  return jsonb_build_object(
    'contract','smartstore_manual_adoption_verified_v1',
    'status','verified',
    'receiptId',receipt.id,
    'attestationId',attestation.id,
    'productId',product.id,
    'listingId',listing.id,
    'sourceJobId',source_job.id,
    'sourceAttemptId',attempt.id,
    'credentialId',credential.id,
    'originProductNo',origin_no,
    'channelProductNo',channel_no,
    'sellerSku',seller_sku,
    'provenance','manual_adoption_verified',
    'remoteCreationOriginAsserted',false,
    'apiCreateSucceeded',false,
    'providerMutationPerformed',false,
    'sourcePreserved',true,
    'contentVerified',true,
    'normalUpdateEligible',true,
    'normalUpdateEligibilityScope','database_linkage_only',
    'publicationGateOpenAsserted',false,
    'reused',false
  );
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_READBACK_TIME_INVALID';
end;
$$;

revoke all on function
  public.sellerpilot_service_commit_smartstore_manual_adoption(
    uuid,uuid,uuid,uuid,bigint,text,text,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_commit_smartstore_manual_adoption(
    uuid,uuid,uuid,uuid,bigint,text,text,jsonb
  ) to service_role;

create function public.sellerpilot_get_verified_smartstore_manual_adoption(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attestation sellerpilot_private.smartstore_manual_adoption_attestations%rowtype;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_AUTHENTICATED_OWNER_REQUIRED'
      using errcode = '42501';
  end if;
  select * into attestation
  from sellerpilot_private.smartstore_manual_adoption_attestations
  where product_id = p_product_id and owner_id = auth.uid();
  if attestation.id is null then return null; end if;
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_verified_v1',
    'status',case when sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(attestation.source_job_id) then 'verified' else 'blocked' end,
    'receiptId',attestation.receipt_id,
    'attestationId',attestation.id,
    'productId',attestation.product_id,
    'listingId',attestation.listing_id,
    'sourceJobId',attestation.source_job_id,
    'sourceAttemptId',attestation.source_attempt_id,
    'credentialId',attestation.credential_id,
    'originProductNo',attestation.origin_product_no,
    'channelProductNo',attestation.channel_product_no,
    'sellerSku',attestation.seller_sku,
    'observedAt',attestation.observed_at,
    'attestedAt',attestation.attested_at,
    'provenance','manual_adoption_verified',
    'remoteCreationOriginAsserted',false,
    'apiCreateSucceeded',false,
    'providerMutationPerformed',false,
    'sourcePreserved',true,
    'contentVerified',true,
    'normalUpdateEligible',sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(attestation.source_job_id),
    'normalUpdateEligibilityScope','database_linkage_only',
    'publicationGateOpenAsserted',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_get_verified_smartstore_manual_adoption(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_get_verified_smartstore_manual_adoption(uuid)
  to authenticated;

-- If the old exact/browser receipt contract exists, retain its immutable
-- response semantics after the listing is legitimately bound. It still says
-- contentVerified=false and apiCreateSucceeded=false; the successor getter is
-- the only API that reports official content verification.
do $legacy_replay$
declare
  definition text;
  before_fragment text := 'or receipt.listing_snapshot_sha256 is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') from sellerpilot_private.product_listings x where x.id=receipt.listing_id) then';
  after_fragment text := 'or (receipt.listing_snapshot_sha256 is distinct from (select encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') from sellerpilot_private.product_listings x where x.id=receipt.listing_id) and not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(receipt.source_job_id)) then';
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_record_exact_smartstore_manual_adoption(jsonb)'
     ) is not null then
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_record_exact_smartstore_manual_adoption(jsonb)'::regprocedure
    ) into definition;
    if pg_catalog.strpos(definition,'smartstore_manual_adoption_reconciliation_resolved') = 0 then
      if pg_catalog.strpos(definition,before_fragment) = 0 then
        raise exception 'SMARTSTORE_LEGACY_RECEIPT_REPLAY_FRAGMENT_NOT_FOUND';
      end if;
      execute pg_catalog.replace(definition,before_fragment,after_fragment);
    end if;
  end if;
end;
$legacy_replay$;

-- The generic enqueue function must ignore only evidence-resolved historical
-- reconciliations. The new UPDATE still carries an attestation marker and is
-- put in a separate serialization lane below; every unresolved reconciliation
-- remains a hard conflict.
do $enqueue_patch$
declare
  definition text;
  before_fragment text := E'where j.status in (''queued'', ''running'', ''reconciliation_required'')\n     and j.operation in (''listing.create'', ''listing.update'', ''listing.stop'')';
  after_fragment text := E'where (j.status in (''queued'', ''running'')\n       or (j.status = ''reconciliation_required''\n         and not sellerpilot_private.listing_mutation_reconciliation_resolved(j.id)))\n     and j.operation in (''listing.create'', ''listing.update'', ''listing.stop'')';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_enqueue_listing_unsafe(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into definition;
  if pg_catalog.strpos(definition,'listing_mutation_reconciliation_resolved') = 0 then
    if pg_catalog.strpos(definition,before_fragment) = 0 then
      raise exception 'SMARTSTORE_ENQUEUE_RECONCILIATION_FRAGMENT_NOT_FOUND';
    end if;
    execute pg_catalog.replace(definition,before_fragment,after_fragment);
  end if;
end;
$enqueue_patch$;

create function sellerpilot_private.smartstore_manual_adoption_update_marker_is_valid(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from sellerpilot_private.smartstore_manual_adoption_attestations attestation
   where p_job.channel = 'smartstore'
     and p_job.operation = 'listing.update'
     and p_job.listing_id = attestation.listing_id
     and p_job.credential_id = attestation.credential_id
     and p_job.seller_account_key = attestation.seller_account_key
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contract}'
       = 'smartstore_manual_adoption_verified_v1'
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,status}' = 'verified'
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,attestationId}' = attestation.id::text
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,receiptId}' = attestation.receipt_id::text
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,sourceJobId}' = attestation.source_job_id::text
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,listingId}' = attestation.listing_id::text
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,originProductNo}' = attestation.origin_product_no
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,channelProductNo}' = attestation.channel_product_no
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,sellerSku}' = attestation.seller_sku
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,approvalRevision}' = attestation.approval_revision::text
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contentSha256}' = attestation.approval_content_sha256
     and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,manifestDigest}' = attestation.approved_manifest_digest
     and sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(attestation.source_job_id)
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_update_marker_is_valid(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_manual_adoption_update_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'smartstore'
     and new.operation = 'listing.update'
     and new.status in ('queued','running','reconciliation_required')
     and (
       new.request_payload#>'{arguments,sellerpilotSmartstoreManualAdoption}' is not null
       or exists (
         select 1
         from sellerpilot_private.smartstore_manual_adoption_attestations attestation
         where attestation.listing_id = new.listing_id
       )
     )
     and not sellerpilot_private.smartstore_manual_adoption_update_marker_is_valid(new) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_UPDATE_ATTESTATION_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_smartstore_manual_adoption_update_marker()
  from public, anon, authenticated, service_role;
create trigger smartstore_manual_adoption_update_marker_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_smartstore_manual_adoption_update_marker();

-- Preserve every pre-existing Qoo10/Temu lane from the current index and add
-- exactly one SmartStore lane. The trigger above proves that the marker is
-- backed by the immutable attestation before the index can separate it from
-- the historical default-lane CREATE reconciliation.
drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_verifier_v1'
      when sellerpilot_private.qoo10_shipping_s1_activation_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_activation_v1'
      when sellerpilot_private.qoo10_exact_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_exact_s1_verifier_v1'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.update'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,contract}'='qoo10_exact_localization_update_v2'
        then 'qoo10_exact_localization_update_v2'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.activate'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'='qoo10_s1_activation_v1'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'='1217336970'
        then 'qoo10_exact_s1_activation_v1'
      when channel='temu' and operation='listing.stop'
       and request_payload#>>'{arguments,sellerpilotTemuContainment,version}'='temu_safe_test_containment_v1'
        then 'temu_safe_test_containment_v1'
      when channel='temu' and operation='listing.publication.verify'
       and request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'='temu_safe_test_containment_discovery_v1'
       and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
        then 'temu_safe_test_containment_discovery_v1'
      when channel='smartstore' and operation='listing.update'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contract}'='smartstore_manual_adoption_verified_v1'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,status}'='verified'
        then 'smartstore_manual_adoption_normal_update_v1'
      else 'default'
    end)
  )
  where listing_id is not null
    and operation in (
      'listing.create','listing.update','listing.stop','listing.activate',
      'price.update','inventory.update',
      'listing.lineage.verify','listing.publication.verify'
    )
    and status in ('queued','running','reconciliation_required');

-- Apply the same evidence-resolved predicate to the global status and opener.
-- Channel-scoped Qoo10/Coupang counters and effective-gate functions remain
-- byte-for-byte outside this migration's scope.
do $global_gate_patch$
declare
  procedure_name regprocedure;
  definition text;
  before_fragment text := E'and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)\n           and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)\n           and not sellerpilot_private.unstarted_listing_create_reconciliation_resolved(job.id)\n           and not sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(job.id)';
  before_parenthesized text := E'(not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)\n        and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)\n        and not sellerpilot_private.unstarted_listing_create_reconciliation_resolved(job.id)\n        and not sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(job.id))';
begin
  procedure_name := 'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure;
  select pg_catalog.pg_get_functiondef(procedure_name) into definition;
  if pg_catalog.strpos(definition,'listing_mutation_reconciliation_resolved') = 0 then
    if pg_catalog.strpos(definition,before_fragment) = 0 then
      raise exception 'SMARTSTORE_GLOBAL_GATE_STATUS_FRAGMENT_NOT_FOUND';
    end if;
    execute pg_catalog.replace(
      definition,before_fragment,
      'and not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)'
    );
  end if;

  procedure_name := 'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)'::regprocedure;
  select pg_catalog.pg_get_functiondef(procedure_name) into definition;
  if pg_catalog.strpos(definition,'listing_mutation_reconciliation_resolved') = 0 then
    if pg_catalog.strpos(definition,before_parenthesized) = 0 then
      raise exception 'SMARTSTORE_GLOBAL_GATE_SETTER_FRAGMENT_NOT_FOUND';
    end if;
    execute pg_catalog.replace(
      definition,before_parenthesized,
      '(not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id))'
    );
  end if;
end;
$global_gate_patch$;

comment on function
  public.sellerpilot_service_prepare_smartstore_manual_adoption(uuid,uuid) is
  'Returns server-selected SmartStore source/credential and current approval CAS values. Performs no provider call and no adoption.';
comment on function
  public.sellerpilot_service_commit_smartstore_manual_adoption(
    uuid,uuid,uuid,uuid,bigint,text,text,jsonb
  ) is
  'Atomically records official readback evidence and binds an existing remote product. The legacy provenance name manual_adoption_verified does not assert how the remote was created; apiCreateSucceeded=false and providerMutationPerformed=false describe this adoption transaction. normalUpdateEligible means database linkage only and does not assert that a publication gate is open.';
comment on function
  sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid) is
  'Evidence-only resolution for the immutable source SmartStore CREATE reconciliation. Later UPDATE jobs retain independent reconciliation state.';

commit;
