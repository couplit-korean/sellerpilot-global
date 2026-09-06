-- Repair an already identified SmartStore product without replaying CREATE.
-- Identity-only evidence is kept separate from verified adoption. One exact
-- content-only UPDATE is admitted through the Mac gateway, then a fresh strict
-- readback must bind the provider-native JPEGs before adoption is verified.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907174000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_prepare_smartstore_manual_adoption(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_official_identity(jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_asset_binding_is_current(jsonb,jsonb,bigint,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_current_approved_manifest(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_hash(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_jsonb_has_exact_keys(jsonb,text[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_binding(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_gateway_job_seller_lineage()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.temu_containment_seller_lineage_allowed(jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
     ) is null
  then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end;
$dependencies$;

create table sellerpilot_private.smartstore_existing_remote_repair_baselines (
  id uuid primary key default gen_random_uuid(),
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_claim_token uuid not null,
  readback_worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  seller_sku text not null check (
    length(trim(seller_sku)) between 1 and 160 and seller_sku !~ '[[:cntrl:]]'
  ),
  origin_product_no text not null check (origin_product_no ~ '^[1-9][0-9]{5,19}$'),
  channel_product_no text not null check (channel_product_no ~ '^[1-9][0-9]{5,19}$'),
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
  baseline_body_sha256 text not null check (baseline_body_sha256 ~ '^[a-f0-9]{64}$'),
  protected_body_sha256 text not null check (protected_body_sha256 ~ '^[a-f0-9]{64}$'),
  origin_response_sha256 text not null check (origin_response_sha256 ~ '^[a-f0-9]{64}$'),
  channel_response_sha256 text not null check (channel_response_sha256 ~ '^[a-f0-9]{64}$'),
  source_detail_image_urls jsonb not null check (
    jsonb_typeof(source_detail_image_urls) = 'array'
    and jsonb_array_length(source_detail_image_urls) = 8
  ),
  remote_detail_image_urls jsonb not null check (
    jsonb_typeof(remote_detail_image_urls) = 'array'
    and jsonb_array_length(remote_detail_image_urls) = 8
  ),
  approved_transport_images jsonb not null check (
    jsonb_typeof(approved_transport_images) = 'array'
    and jsonb_array_length(approved_transport_images) = 8
  ),
  source_job_snapshot_sha256 text not null check (source_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_attempt_snapshot_sha256 text not null check (source_attempt_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_listing_snapshot_sha256 text not null check (source_listing_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  mismatch_code text not null check (mismatch_code in (
    'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH',
    'SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID',
    'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH',
    'SMARTSTORE_MANUAL_ADOPTION_PIXEL_BINDING_MISMATCH'
  )),
  observed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id,product_id,approval_revision,official_readback_sha256)
);

create index smartstore_existing_remote_repair_baseline_current_idx
  on sellerpilot_private.smartstore_existing_remote_repair_baselines
  (product_id,created_at desc,id desc);

alter table sellerpilot_private.smartstore_existing_remote_repair_baselines
  enable row level security;
revoke all on sellerpilot_private.smartstore_existing_remote_repair_baselines
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_existing_content_repair_permits (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  request_payload_sha256 text not null check (request_payload_sha256 ~ '^[a-f0-9]{64}$'),
  request_payload_bytes integer not null check (request_payload_bytes > 0),
  bound_worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  bound_at timestamptz,
  consumed_at timestamptz,
  verification_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  completed_readback_sha256 text check (
    completed_readback_sha256 is null or completed_readback_sha256 ~ '^[a-f0-9]{64}$'
  ),
  approved_transmission_images jsonb check (
    approved_transmission_images is null or (
      jsonb_typeof(approved_transmission_images)='array'
      and jsonb_array_length(approved_transmission_images)=8
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 minutes'),
  check (
    (bound_at is null and bound_worker_token_id is null and bound_claim_token is null)
    or (bound_at is not null and bound_worker_token_id is not null and bound_claim_token is not null)
  ),
  check (consumed_at is null or bound_at is not null)
);

alter table sellerpilot_private.smartstore_existing_content_repair_permits
  enable row level security;
create index smartstore_existing_content_repair_permit_baseline_idx
  on sellerpilot_private.smartstore_existing_content_repair_permits
  (baseline_id,created_at desc,id desc);
revoke all on sellerpilot_private.smartstore_existing_content_repair_permits
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_existing_content_repair_completion_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  baseline_id uuid not null references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  result_status text not null check (
    result_status in ('verification_queued','failed','reconciliation_required')
  ),
  readback_sha256 text check (readback_sha256 is null or readback_sha256 ~ '^[a-f0-9]{64}$'),
  verification_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id,claim_token),
  check (
    (result_status = 'verification_queued' and readback_sha256 is not null and verification_job_id is not null)
    or (result_status <> 'verification_queued' and readback_sha256 is null and verification_job_id is null)
  )
);

alter table sellerpilot_private.smartstore_existing_content_repair_completion_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_existing_content_repair_completion_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_existing_content_repair_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_EVIDENCE_IMMUTABLE'
    using errcode='55000';
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_existing_content_repair_evidence()
  from public, anon, authenticated, service_role;

create trigger smartstore_existing_remote_repair_baseline_immutable
before update or delete
on sellerpilot_private.smartstore_existing_remote_repair_baselines
for each row execute function
  sellerpilot_private.guard_smartstore_existing_content_repair_evidence();

create trigger smartstore_existing_content_repair_receipt_immutable
before update or delete
on sellerpilot_private.smartstore_existing_content_repair_completion_receipts
for each row execute function
  sellerpilot_private.guard_smartstore_existing_content_repair_evidence();

create function sellerpilot_private.smartstore_repair_html_image_urls(p_html text)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(trim(replace(match[1],'&amp;','&'))) order by ordinal),'[]'::jsonb)
  from pg_catalog.regexp_matches(
    coalesce(p_html,''),
    '<img[^>]*[[:space:]]src=["''](https://[^"'']+)["'']',
    'gi'
  ) with ordinality matches(match,ordinal)
$$;

revoke all on function sellerpilot_private.smartstore_repair_html_image_urls(text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_body_hashes(p_readback jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  origin_product jsonb := p_readback#>'{originReadback,response,originProduct}';
  channel_product jsonb := p_readback#>'{channelReadback,response,smartstoreChannelProduct}';
begin
  if jsonb_typeof(origin_product) is distinct from 'object'
     or jsonb_typeof(channel_product) is distinct from 'object' then
    return null;
  end if;
  return jsonb_build_object(
    'baselineBodySha256',sellerpilot_private.external_detail_hash(jsonb_build_object(
      'originProduct',origin_product,'smartstoreChannelProduct',channel_product
    )),
    'protectedBodySha256',sellerpilot_private.external_detail_hash(jsonb_build_object(
      'originProduct',origin_product - 'name' - 'detailContent' - 'images',
      'smartstoreChannelProduct',channel_product - 'channelProductName'
    ))
  );
end;
$$;

revoke all on function sellerpilot_private.smartstore_repair_body_hashes(jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
  p_baseline_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  preparation jsonb;
  manifest jsonb;
begin
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id = p_baseline_id;
  if baseline.id is null then return false; end if;
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    baseline.owner_id,baseline.product_id
  );
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id = baseline.source_job_id;
  select * into source_attempt from sellerpilot_private.channel_operation_attempts
  where id = baseline.source_attempt_id;
  select * into listing from sellerpilot_private.product_listings
  where id = baseline.listing_id;
  select * into credential from sellerpilot_private.channel_credentials
  where id = baseline.credential_id;
  manifest := sellerpilot_private.smartstore_current_approved_manifest(
    baseline.approval_import_id
  );
  return preparation->>'contract' = 'smartstore_manual_adoption_prepare_v1'
    and preparation->>'status' = 'ready'
    and preparation->>'productId' = baseline.product_id::text
    and preparation->>'listingId' = baseline.listing_id::text
    and preparation->>'sourceJobId' = baseline.source_job_id::text
    and preparation->>'sourceAttemptId' = baseline.source_attempt_id::text
    and preparation->>'credentialId' = baseline.credential_id::text
    and preparation->>'sellerSku' = baseline.seller_sku
    and preparation->>'approvalRevision' = baseline.approval_revision::text
    and preparation->>'contentSha256' = baseline.approval_content_sha256
    and preparation->>'manifestDigest' = baseline.approved_manifest_digest
    and source_job.id is not null
    and source_attempt.id is not null
    and listing.id is not null
    and credential.id is not null
    and sellerpilot_private.external_detail_hash(to_jsonb(source_job))
      = baseline.source_job_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(source_attempt))
      = baseline.source_attempt_snapshot_sha256
    and sellerpilot_private.external_detail_hash(to_jsonb(listing))
      = baseline.source_listing_snapshot_sha256
    and credential.version = baseline.credential_version
    and credential.status = 'active'
    and credential.channel = 'smartstore'
    and credential.environment = 'production'
    and credential.seller_account_key = baseline.seller_account_key
    and credential.created_by = source_job.created_by
    and (credential.expires_at is null or credential.expires_at > clock_timestamp())
    and manifest->>'digest' = baseline.approved_manifest_digest
    and manifest->>'approvalRevision' = baseline.approval_revision::text
    and manifest->>'contentSha256' = baseline.approval_content_sha256
    and sellerpilot_private.external_detail_asset_binding_is_current(
      source_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}',
      manifest,
      (source_job.request_payload#>>'{arguments,sellerpilotExternalDetail,version}')::bigint,
      source_attempt.id
    );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.record_smartstore_existing_remote_repair_baseline(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_readback jsonb,
  p_mismatch_code text,
  p_completion_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  marker jsonb;
  preparation jsonb;
  manifest jsonb;
  asset_binding jsonb;
  transport jsonb;
  transport_item jsonb;
  source_html text;
  source_urls jsonb;
  remote_urls jsonb;
  remote_pixels jsonb;
  transport_images jsonb := '[]'::jsonb;
  remote_pixel text;
  remote_ordinal integer;
  body_hashes jsonb;
  origin_no text;
  channel_no text;
  observed timestamptz;
  baseline_id uuid;
  image_index integer;
begin
  if p_mismatch_code not in (
       'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH',
       'SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID',
       'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH',
       'SMARTSTORE_MANUAL_ADOPTION_PIXEL_BINDING_MISMATCH'
     )
     or coalesce(p_completion_fingerprint,'') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_readback) is distinct from 'object'
     or octet_length(p_readback::text) > 2097152 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_INPUT_INVALID';
  end if;
  select * into worker_token
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.token_hash = p_token_hash
    and token.scope = 'gateway' and token.status = 'active'
    and token.expires_at > clock_timestamp();
  select * into readback_job
  from sellerpilot_private.channel_gateway_jobs job
  where job.id = p_job_id
    and job.status = 'running'
    and job.worker_token_id = worker_token.id
    and job.claim_token = p_claim_token
    and job.lease_expires_at > clock_timestamp()
  for update;
  if worker_token.id is null or readback_job.id is null
     or sellerpilot_private.smartstore_manual_adoption_readback_job_matches(readback_job)
       is not true
     or sellerpilot_private.smartstore_manual_adoption_readback_binding(readback_job.id)
       #>>'{status}' is distinct from 'ready' then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_CLAIM_INVALID';
  end if;
  marker := readback_job.request_payload
    #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    (marker->>'ownerId')::uuid,(marker->>'productId')::uuid
  );
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id = (marker->>'sourceJobId')::uuid;
  select * into source_attempt from sellerpilot_private.channel_operation_attempts
  where id = (marker->>'sourceAttemptId')::uuid;
  select * into listing from sellerpilot_private.product_listings
  where id = (marker->>'listingId')::uuid;
  select * into product from sellerpilot_private.products
  where id = (marker->>'productId')::uuid;
  select * into credential from sellerpilot_private.channel_credentials
  where id = (marker->>'credentialId')::uuid;
  manifest := sellerpilot_private.smartstore_current_approved_manifest(
    product.external_detail_import_id
  );
  asset_binding := source_job.request_payload
    #>'{arguments,sellerpilotPublicationAssetBinding}';
  transport := asset_binding->'providerTransportImages';
  if preparation->>'status' is distinct from 'ready'
     or source_job.id is null or source_attempt.id is null
     or listing.id is null or product.id is null or credential.id is null
     or product.owner_id is distinct from (marker->>'ownerId')::uuid
     or listing.owner_id is distinct from product.owner_id
     or source_attempt.owner_id is distinct from product.owner_id
     or credential.created_by is distinct from source_job.created_by
     or source_job.attempt_id is distinct from source_attempt.id
     or source_job.listing_id is distinct from listing.id
     or source_job.credential_id is distinct from credential.id
     or source_job.status <> 'reconciliation_required'
     or source_attempt.status <> 'manual_required'
     or listing.status <> 'failed'
     or listing.remote_id is not null
     or product.sku is distinct from marker->>'sellerSku'
     or jsonb_typeof(source_job.request_payload#>'{arguments,body,originProduct,salePrice}')
       is distinct from 'number'
     or (source_job.request_payload#>>'{arguments,body,originProduct,salePrice}')::numeric
       is distinct from listing.price
     or jsonb_typeof(source_job.request_payload#>'{arguments,body,originProduct,stockQuantity}')
       is distinct from 'number'
     or (source_job.request_payload#>>'{arguments,body,originProduct,stockQuantity}')::numeric
       is distinct from product.on_hand::numeric
     or credential.version < 1
     or credential.status <> 'active'
     or credential.seller_account_key is distinct from marker->>'sellerAccountKey'
     or credential.seller_account_key is distinct from source_job.seller_account_key
     or credential.seller_account_key is distinct from source_attempt.seller_account_key
     or (listing.seller_account_key is not null
       and listing.seller_account_key is distinct from credential.seller_account_key)
     or manifest->>'digest' is distinct from marker->>'manifestDigest'
     or manifest->>'approvalRevision' is distinct from marker->>'approvalRevision'
     or manifest->>'contentSha256' is distinct from marker->>'contentSha256'
     or not sellerpilot_private.external_detail_asset_binding_is_current(
       asset_binding,manifest,
       (source_job.request_payload#>>'{arguments,sellerpilotExternalDetail,version}')::bigint,
       source_attempt.id
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_TUPLE_DRIFT';
  end if;

  if not sellerpilot_private.smartstore_jsonb_has_exact_keys(p_readback,array[
       'channelReadback','contract','detailImagePixelSha256s','detailImageUrls',
       'observedAt','originReadback','providerMutationPerformed','searchReadback','source'
     ])
     or p_readback->>'contract' <> 'smartstore_official_manual_adoption_readback_v1'
     or p_readback->>'source' <> 'smartstore_official_api_readback_v1'
     or p_readback->'providerMutationPerformed' is distinct from 'false'::jsonb then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_READBACK_INVALID';
  end if;
  observed := (p_readback->>'observedAt')::timestamptz;
  if observed is null or observed > clock_timestamp() + interval '1 minute'
     or observed < clock_timestamp() - interval '15 minutes' then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_STALE';
  end if;
  select identity.origin_product_no,identity.channel_product_no
  into origin_no,channel_no
  from sellerpilot_private.smartstore_manual_adoption_official_identity(
    p_readback,marker->>'sellerSku'
  ) identity;
  if origin_no is distinct from coalesce(preparation->>'originProductNo',origin_no)
     or channel_no is distinct from coalesce(preparation->>'channelProductNo',channel_no)
     or jsonb_typeof(p_readback#>'{originReadback,response,originProduct,salePrice}')
       is distinct from 'number'
     or (p_readback#>>'{originReadback,response,originProduct,salePrice}')::numeric
       is distinct from listing.price
     or jsonb_typeof(p_readback#>'{originReadback,response,originProduct,stockQuantity}')
       is distinct from 'number'
     or (p_readback#>>'{originReadback,response,originProduct,stockQuantity}')::numeric
       is distinct from product.on_hand::numeric then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_REMOTE_DRIFT';
  end if;

  source_html := source_job.request_payload
    #>>'{arguments,body,originProduct,detailContent}';
  source_urls := sellerpilot_private.smartstore_repair_html_image_urls(source_html);
  remote_urls := p_readback->'detailImageUrls';
  remote_pixels := p_readback->'detailImagePixelSha256s';
  if jsonb_array_length(source_urls) is distinct from 8
     or (select count(distinct value) from jsonb_array_elements_text(source_urls) value) <> 8
     or jsonb_typeof(remote_urls) is distinct from 'array'
     or jsonb_array_length(remote_urls) <> 8
     or (select count(distinct value) from jsonb_array_elements_text(remote_urls) value) <> 8
     or jsonb_typeof(remote_pixels) is distinct from 'array'
     or jsonb_array_length(remote_pixels) <> 8
     or exists (select 1 from jsonb_array_elements_text(remote_pixels) value
       where value !~ '^[a-f0-9]{64}$')
     or exists (select 1 from jsonb_array_elements_text(source_urls) source(value)
       where not exists (select 1 from jsonb_array_elements_text(remote_urls) remote(value)
         where remote.value = source.value))
     or exists (select 1 from jsonb_array_elements_text(remote_urls) remote(value)
       where not exists (select 1 from jsonb_array_elements_text(source_urls) source(value)
         where source.value = remote.value)) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_SOURCE_IMAGE_SET_INVALID';
  end if;
  if asset_binding->>'providerImageSurface' = 'gallery' then
    if jsonb_array_length(transport) is distinct from 9 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
    end if;
  elsif jsonb_array_length(transport) is distinct from 8 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
  end if;
  for image_index in 0..7 loop
    transport_item := transport->(
      image_index + case when asset_binding->>'providerImageSurface'='gallery' then 1 else 0 end
    );
    if transport_item->>'publicUrl' is distinct from source_urls->>image_index
       or transport_item->>'contentSha256' !~ '^[a-f0-9]{64}$'
       or transport_item->>'objectPath' is distinct from
         'normalized/' || left(transport_item->>'contentSha256',2) || '/'
           || (transport_item->>'contentSha256') || '.jpg'
       or not exists (
         select 1
         from sellerpilot_private.marketplace_normalized_asset_refs ref
         join sellerpilot_private.marketplace_normalized_assets asset
           on asset.object_path=ref.object_path
         where ref.attempt_id=source_attempt.id
           and ref.object_path=transport_item->>'objectPath'
           and ref.canonical_public_url=transport_item->>'publicUrl'
           and ref.source_object_path=transport_item->>'approvedObjectPath'
           and ref.source_content_sha256=transport_item->>'approvedSourceSha256'
           and ref.upload_confirmed_at is not null
           and asset.status='available'
           and asset.content_sha256=transport_item->>'contentSha256'
       ) then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
    end if;
    select ordinality::integer-1,remote_pixels->>(ordinality::integer-1)
    into remote_ordinal,remote_pixel
    from jsonb_array_elements_text(remote_urls) with ordinality remote(value,ordinality)
    where remote.value = source_urls->>image_index;
    if remote_ordinal is null or remote_pixel !~ '^[a-f0-9]{64}$' then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_PIXEL_INVALID';
    end if;
    transport_images := transport_images || jsonb_build_array(jsonb_build_object(
      'index',image_index,
      'url',transport_item->>'publicUrl',
      'objectPath',transport_item->>'objectPath',
      'contentSha256',transport_item->>'contentSha256',
      'approvedObjectPath',transport_item->>'approvedObjectPath',
      'approvedSourceSha256',transport_item->>'approvedSourceSha256',
      'decodedRgbaSha256',remote_pixel
    ));
  end loop;
  body_hashes := sellerpilot_private.smartstore_repair_body_hashes(p_readback);
  if body_hashes is null then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_BODY_INVALID';
  end if;

  insert into sellerpilot_private.smartstore_existing_remote_repair_baselines (
    readback_job_id,readback_claim_token,readback_worker_token_id,
    owner_id,product_id,listing_id,source_job_id,source_attempt_id,
    credential_id,credential_version,seller_account_key,seller_sku,
    origin_product_no,channel_product_no,approval_import_id,approval_revision,
    approval_content_sha256,approved_manifest_digest,official_readback,
    official_readback_sha256,baseline_body_sha256,protected_body_sha256,
    origin_response_sha256,channel_response_sha256,source_detail_image_urls,
    remote_detail_image_urls,approved_transport_images,
    source_job_snapshot_sha256,source_attempt_snapshot_sha256,
    source_listing_snapshot_sha256,completion_fingerprint,mismatch_code,observed_at
  ) values (
    readback_job.id,p_claim_token,worker_token.id,
    (marker->>'ownerId')::uuid,(marker->>'productId')::uuid,
    listing.id,source_job.id,source_attempt.id,credential.id,credential.version,
    credential.seller_account_key,marker->>'sellerSku',origin_no,channel_no,
    product.external_detail_import_id,(marker->>'approvalRevision')::bigint,
    marker->>'contentSha256',marker->>'manifestDigest',p_readback,
    sellerpilot_private.external_detail_hash(p_readback),
    body_hashes->>'baselineBodySha256',body_hashes->>'protectedBodySha256',
    sellerpilot_private.external_detail_hash(p_readback#>'{originReadback,response}'),
    sellerpilot_private.external_detail_hash(p_readback#>'{channelReadback,response}'),
    source_urls,remote_urls,transport_images,
    sellerpilot_private.external_detail_hash(to_jsonb(source_job)),
    sellerpilot_private.external_detail_hash(to_jsonb(source_attempt)),
    sellerpilot_private.external_detail_hash(to_jsonb(listing)),
    p_completion_fingerprint,p_mismatch_code,observed
  )
  on conflict (readback_job_id) do nothing
  returning id into baseline_id;
  if baseline_id is null then
    select id into baseline_id
    from sellerpilot_private.smartstore_existing_remote_repair_baselines
    where readback_job_id=readback_job.id
      and completion_fingerprint=p_completion_fingerprint
      and official_readback_sha256=sellerpilot_private.external_detail_hash(p_readback);
  end if;
  if baseline_id is null then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_CONFLICT';
  end if;
  return baseline_id;
end;
$$;

revoke all on function
  sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)
  from public, anon, authenticated, service_role;

-- The 160000 readback guard normally permits success only after a full 150000
-- attestation. A repair baseline is a separate terminal read result: it proves
-- identity and preserves the mismatch, but never makes the listing verified.
do $patch_readback_guard$
declare
  definition text;
  before_fragment constant text := $before$  if new.status = 'succeeded' and binding#>>'{status}' <> 'already_verified' then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_VERIFICATION_REQUIRED';
  end if;$before$;
  after_fragment constant text := $after$  if new.status = 'succeeded'
     and binding#>>'{status}' <> 'already_verified'
     and not exists (
       select 1
       from sellerpilot_private.smartstore_existing_remote_repair_baselines baseline
       where baseline.readback_job_id = new.id
     ) then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_VERIFICATION_REQUIRED';
  end if;$after$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_smartstore_manual_adoption_readback_job()'::regprocedure
  );
  if pg_catalog.strpos(definition,'smartstore_existing_remote_repair_baselines') = 0 then
    if pg_catalog.strpos(definition,before_fragment) = 0 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_READBACK_GUARD_DRIFT';
    end if;
    execute pg_catalog.replace(definition,before_fragment,after_fragment);
  end if;
end;
$patch_readback_guard$;

alter function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) rename to sellerpilot_174000_complete_smartstore_readback_pre_repair;

revoke all on function
  public.sellerpilot_174000_complete_smartstore_readback_pre_repair(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_readback jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  result jsonb;
  readback_sha text;
  safe_error text;
  completion_fingerprint text;
  mismatch_code text;
  baseline_id uuid;
  safe_response jsonb;
  prior_lineage_rebind text;
  prior_repair_verifier text;
  is_repair_verifier boolean := false;
begin
  safe_error := case
    when p_status='succeeded' then null
    when coalesce(p_error_message,'') ~ '^[A-Z0-9_:-]{1,160}$'
      then p_error_message
    else 'SMARTSTORE_ADOPTION_READBACK_FAILED'
  end;
  readback_sha := case when p_status='succeeded'
    then sellerpilot_private.external_detail_hash(p_readback) else null end;
  completion_fingerprint := sellerpilot_private.external_detail_hash(
    jsonb_build_object(
      'status',p_status,'readbackSha256',readback_sha,'safeError',safe_error
    )
  );
  select * into worker_token
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.token_hash=p_token_hash and token.scope='gateway'
    and token.status='active' and token.expires_at>clock_timestamp();
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where readback_job_id=p_job_id;
  if baseline.id is not null then
    if worker_token.id is null
       or baseline.readback_worker_token_id is distinct from worker_token.id
       or baseline.readback_claim_token is distinct from p_claim_token
       or baseline.completion_fingerprint is distinct from completion_fingerprint
       or baseline.official_readback_sha256 is distinct from readback_sha then
      return jsonb_build_object(
        'contract','smartstore_manual_adoption_readback_completion_v1',
        'status','reconciliation_required','jobId',p_job_id,
        'receiptId',null,'attestationId',null,'baselineId',baseline.id,
        'readbackSha256',baseline.official_readback_sha256,
        'reused',true,'reason','COMPLETION_REPLAY_MISMATCH'
      );
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','repair_required','jobId',p_job_id,
      'receiptId',null,'attestationId',null,'baselineId',baseline.id,
      'readbackSha256',baseline.official_readback_sha256,
      'reused',true,'reason','APPROVED_CONTENT_REPAIR_REQUIRED'
    );
  end if;

  if p_status <> 'succeeded' then
    result := public.sellerpilot_174000_complete_smartstore_readback_pre_repair(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
    return result || jsonb_build_object('baselineId',null);
  end if;

  select exists (
    select 1
    from sellerpilot_private.smartstore_existing_content_repair_permits permit
    where permit.verification_job_id=p_job_id
      and permit.completed_readback_sha256 is not null
  ) into is_repair_verifier;
  prior_repair_verifier := coalesce(current_setting(
    'sellerpilot.smartstore_content_repair_verifier_job',true
  ),'');
  if is_repair_verifier then
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_verifier_job',p_job_id::text,true
    );
  end if;
  begin
    result := public.sellerpilot_174000_complete_smartstore_readback_pre_repair(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_verifier_job',prior_repair_verifier,true
    );
    return result || jsonb_build_object('baselineId',null);
  exception when others then
    mismatch_code := SQLERRM;
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_verifier_job',prior_repair_verifier,true
    );
    if is_repair_verifier then raise; end if;
    if mismatch_code not in (
      'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH',
      'SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID',
      'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH',
      'SMARTSTORE_MANUAL_ADOPTION_PIXEL_BINDING_MISMATCH'
    ) then
      raise;
    end if;
  end;

  baseline_id := sellerpilot_private.record_smartstore_existing_remote_repair_baseline(
    p_token_hash,p_job_id,p_claim_token,p_readback,mismatch_code,
    completion_fingerprint
  );
  safe_response := jsonb_build_object(
    'contract','smartstore_manual_adoption_gateway_receipt_v1',
    'ok',true,'channel','smartstore','operation','listing.lineage.verify',
    'verificationStatus','repair_required','baselineId',baseline_id,
    'readbackSha256',readback_sha,'providerMutationPerformed',false,
    'contentVerified',false,'normalUpdateEligible',false
  );
  prior_lineage_rebind := coalesce(current_setting(
    'sellerpilot.provider_listing_lineage_rebind',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',p_job_id::text,true
  );
  begin
    update sellerpilot_private.channel_gateway_jobs
    set status='succeeded',response_payload=safe_response,error_message=null,
        worker_token_id=null,claim_token=null,lease_expires_at=null,
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_job_id and status='running'
      and worker_token_id=worker_token.id and claim_token=p_claim_token;
    if not found then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BASELINE_LEASE_LOST';
    end if;
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
  );
  insert into sellerpilot_private.gateway_completion_receipts (
    job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
  ) values (p_job_id,p_claim_token,worker_token.id,completion_fingerprint,null);
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_completion_v1',
    'status','repair_required','jobId',p_job_id,
    'receiptId',null,'attestationId',null,'baselineId',baseline_id,
    'readbackSha256',readback_sha,'reused',false,
    'reason','APPROVED_CONTENT_REPAIR_REQUIRED'
  );
end;
$$;

revoke all on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) to service_role;

alter function public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(
  uuid,uuid
) rename to sellerpilot_174000_enqueue_smartstore_readback_pre_repair;
revoke all on function
  public.sellerpilot_174000_enqueue_smartstore_readback_pre_repair(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(
  p_actor uuid,p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  result jsonb;
begin
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if baseline.id is not null
     and sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     ) then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','repair_required','reason','APPROVED_CONTENT_REPAIR_REQUIRED',
      'productId',p_product_id,'listingId',baseline.listing_id,
      'jobId',baseline.readback_job_id,'baselineId',baseline.id,'reused',true,
      'receiptId',null,'attestationId',null,
      'originProductNo',baseline.origin_product_no,
      'channelProductNo',baseline.channel_product_no,
      'providerMutationPerformed',false,'contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  result := public.sellerpilot_174000_enqueue_smartstore_readback_pre_repair(
    p_actor,p_product_id
  );
  return result || jsonb_build_object('baselineId',null);
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(uuid,uuid)
  to service_role;

alter function public.sellerpilot_service_get_smartstore_adoption_readback_status(
  uuid,uuid
) rename to sellerpilot_174000_get_smartstore_readback_pre_repair;
revoke all on function
  public.sellerpilot_174000_get_smartstore_readback_pre_repair(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_smartstore_adoption_readback_status(
  p_actor uuid,p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  result jsonb;
begin
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if baseline.id is not null
     and sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     ) then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','repair_required','reason','APPROVED_CONTENT_REPAIR_REQUIRED',
      'productId',p_product_id,'listingId',baseline.listing_id,
      'jobId',baseline.readback_job_id,'baselineId',baseline.id,'reused',true,
      'receiptId',null,'attestationId',null,
      'originProductNo',baseline.origin_product_no,
      'channelProductNo',baseline.channel_product_no,
      'providerMutationPerformed',false,'contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  result := public.sellerpilot_174000_get_smartstore_readback_pre_repair(
    p_actor,p_product_id
  );
  return result || jsonb_build_object('baselineId',null);
end;
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)
  to service_role;

create function sellerpilot_private.smartstore_existing_content_repair_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_job.channel='smartstore'
    and p_job.operation='listing.update'
    and p_job.environment='production'
    and p_job.attempt_id is null
    and p_job.listing_id is not null
    and p_job.credential_id is not null
    and p_job.seller_account_key ~ '^[a-f0-9]{64}$'
    and p_job.credential_refresh_in_flight is false
    and p_job.credential_refresh_recovery_vault_id is null
    and p_job.prepared_credential_id is null
    and p_job.oauth_exchange_completed is false
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload,array['arguments']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload->'arguments',array[
        'body','imageUrls','originProductNo','publicationExpectedImageCount',
        'publicationExpectedLocale','publicationIntent',
        'sellerpilotSmartstoreExistingContentRepair'
      ]
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,body}',
      array['originProduct','smartstoreChannelProduct']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,body,originProduct}',
      array['detailContent','images','name']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,body,smartstoreChannelProduct}',
      array['channelProductName']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}',
      array[
        'approvalRevision','baselineBodySha256','baselineId','channelProductNo',
        'contentSha256','contract','credentialId','listingId','manifestDigest',
        'originProductNo','ownerId','productId','protectedBodySha256',
        'sellerAccountKey','sellerSku','sourceAttemptId','sourceJobId'
      ]
    )
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,contract}'
      ='smartstore_existing_content_repair_job_v1'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,listingId}'
      =p_job.listing_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,credentialId}'
      =p_job.credential_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerAccountKey}'
      =p_job.seller_account_key
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,ownerId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,productId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,baselineId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sourceJobId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sourceAttemptId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and length(p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerSku}')
      between 1 and 160
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerSku}'
      =trim(p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerSku}')
    and p_job.request_payload#>>'{arguments,originProductNo}'
      =p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,originProductNo}'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,originProductNo}'
      ~ '^[1-9][0-9]{5,19}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,channelProductNo}'
      ~ '^[1-9][0-9]{5,19}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,approvalRevision}'
      ~ '^[1-9][0-9]*$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,contentSha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,manifestDigest}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,baselineBodySha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,protectedBodySha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,publicationIntent}'='live'
    and p_job.request_payload#>>'{arguments,publicationExpectedLocale}'='ko-KR'
    and p_job.request_payload#>>'{arguments,publicationExpectedImageCount}'='8'
    and jsonb_typeof(p_job.request_payload#>'{arguments,imageUrls}')='array'
    and jsonb_array_length(p_job.request_payload#>'{arguments,imageUrls}')=9
    and (select count(distinct value)
      from jsonb_array_elements_text(p_job.request_payload#>'{arguments,imageUrls}') value)=9
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

-- The failed legacy listing remains bound to its immutable CREATE attempt.
-- Admit only this DB-created repair job without rewriting that lineage.
create function sellerpilot_private.smartstore_existing_content_repair_insert_allowed(
  p_job sellerpilot_private.channel_gateway_jobs,
  p_listing jsonb,
  p_credential_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  marker jsonb;
begin
  marker := p_job.request_payload
    #>'{arguments,sellerpilotSmartstoreExistingContentRepair}';
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=(marker->>'baselineId')::uuid;
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id;
  select * into source_attempt from sellerpilot_private.channel_operation_attempts
  where id=baseline.source_attempt_id;
  select * into listing from sellerpilot_private.product_listings
  where id=baseline.listing_id;
  select * into credential from sellerpilot_private.channel_credentials
  where id=baseline.credential_id;
  return sellerpilot_private.smartstore_existing_content_repair_job_matches(p_job)
    and p_job.status='queued' and p_job.attempt_count=0
    and p_job.worker_token_id is null and p_job.claim_token is null
    and p_job.provider_mutation_started_at is null and p_job.completed_at is null
    and baseline.id is not null and source_job.id is not null
    and source_attempt.id is not null and listing.id is not null
    and credential.id is not null
    and p_job.created_by=source_job.created_by
    and p_job.listing_id=baseline.listing_id
    and p_job.credential_id=baseline.credential_id
    and p_job.seller_account_key=baseline.seller_account_key
    and p_credential_key=baseline.seller_account_key
    and marker->>'ownerId'=baseline.owner_id::text
    and marker->>'productId'=baseline.product_id::text
    and marker->>'sourceJobId'=baseline.source_job_id::text
    and marker->>'sourceAttemptId'=baseline.source_attempt_id::text
    and marker->>'credentialId'=baseline.credential_id::text
    and marker->>'sellerAccountKey'=baseline.seller_account_key
    and marker->>'sellerSku'=baseline.seller_sku
    and marker->>'originProductNo'=baseline.origin_product_no
    and marker->>'channelProductNo'=baseline.channel_product_no
    and marker->>'approvalRevision'=baseline.approval_revision::text
    and marker->>'contentSha256'=baseline.approval_content_sha256
    and marker->>'manifestDigest'=baseline.approved_manifest_digest
    and marker->>'baselineBodySha256'=baseline.baseline_body_sha256
    and marker->>'protectedBodySha256'=baseline.protected_body_sha256
    and source_job.status='reconciliation_required'
    and source_job.attempt_id=source_attempt.id
    and source_job.listing_id=listing.id
    and source_job.credential_id=credential.id
    and source_attempt.status='manual_required'
    and source_attempt.owner_id=baseline.owner_id
    and listing.product_id=baseline.product_id
    and listing.owner_id=baseline.owner_id
    and listing.channel_key='smartstore'
    and listing.status='failed'
    and listing.failure_class='external_action'
    and listing.remote_id is null
    and listing.operation_attempt_id=source_attempt.id
    and (listing.seller_account_key is null
      or listing.seller_account_key=baseline.seller_account_key)
    and p_listing->>'id'=listing.id::text
    and p_listing->>'operation_attempt_id'=source_attempt.id::text
    and (p_listing->>'seller_account_key' is null
      or p_listing->>'seller_account_key'=baseline.seller_account_key)
    and credential.created_by=source_job.created_by
    and credential.status='active' and credential.channel='smartstore'
    and credential.environment='production'
    and credential.seller_account_key=baseline.seller_account_key
    and sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
      baseline.id
    );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_insert_allowed(
    sellerpilot_private.channel_gateway_jobs,jsonb,text
  ) from public, anon, authenticated, service_role;

do $patch_gateway_seller_lineage$
declare
  definition text;
  before_fragment constant text := $before$      ) and not sellerpilot_private.temu_containment_seller_lineage_allowed(
        to_jsonb(new),to_jsonb(v_listing)
      ) then$before$;
  after_fragment constant text := $after$      ) and not sellerpilot_private.temu_containment_seller_lineage_allowed(
        to_jsonb(new),to_jsonb(v_listing)
      ) and not sellerpilot_private.smartstore_existing_content_repair_insert_allowed(
        new,to_jsonb(v_listing),v_credential_key
      ) then$after$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  );
  if pg_catalog.strpos(
       definition,'smartstore_existing_content_repair_insert_allowed'
     )=0 then
    if pg_catalog.strpos(definition,before_fragment)=0 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_SELLER_LINEAGE_PREIMAGE_DRIFT';
    end if;
    execute pg_catalog.replace(definition,before_fragment,after_fragment);
  end if;
end;
$patch_gateway_seller_lineage$;

create function sellerpilot_private.smartstore_existing_content_repair_binding(
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  marker jsonb;
begin
  select * into job from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  select * into permit from sellerpilot_private.smartstore_existing_content_repair_permits
  where repair_job_id=p_job_id;
  select * into baseline from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=permit.baseline_id;
  marker := job.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}';
  if job.id is null or permit.id is null or baseline.id is null
     or sellerpilot_private.smartstore_existing_content_repair_job_matches(job) is not true
     or permit.owner_id is distinct from baseline.owner_id
     or permit.product_id is distinct from baseline.product_id
     or permit.listing_id is distinct from baseline.listing_id
     or permit.credential_id is distinct from baseline.credential_id
     or permit.seller_account_key is distinct from baseline.seller_account_key
     or permit.request_payload_sha256 is distinct from sellerpilot_private.external_detail_hash(job.request_payload)
     or permit.request_payload_bytes is distinct from octet_length(job.request_payload::text)
     or permit.release_sha is distinct from sellerpilot_private.active_serverless_runtime_release_sha()
     or marker->>'baselineId' is distinct from baseline.id::text
     or marker->>'ownerId' is distinct from baseline.owner_id::text
     or marker->>'productId' is distinct from baseline.product_id::text
     or marker->>'listingId' is distinct from baseline.listing_id::text
     or marker->>'sourceJobId' is distinct from baseline.source_job_id::text
     or marker->>'sourceAttemptId' is distinct from baseline.source_attempt_id::text
     or marker->>'credentialId' is distinct from baseline.credential_id::text
     or marker->>'sellerAccountKey' is distinct from baseline.seller_account_key
     or marker->>'sellerSku' is distinct from baseline.seller_sku
     or marker->>'originProductNo' is distinct from baseline.origin_product_no
     or marker->>'channelProductNo' is distinct from baseline.channel_product_no
     or marker->>'approvalRevision' is distinct from baseline.approval_revision::text
     or marker->>'contentSha256' is distinct from baseline.approval_content_sha256
     or marker->>'manifestDigest' is distinct from baseline.approved_manifest_digest
     or marker->>'baselineBodySha256' is distinct from baseline.baseline_body_sha256
     or marker->>'protectedBodySha256' is distinct from baseline.protected_body_sha256
     or not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(baseline.id)
  then return null; end if;
  return jsonb_build_object(
    'contract','smartstore_existing_content_repair_binding_v1',
    'status','ready','baselineId',baseline.id,'permitId',permit.id
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_binding(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_existing_content_repair_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  terminal_job_id uuid;
begin
  if new.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}' is null
     and (tg_op='INSERT' or old.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}' is null)
  then return new; end if;
  if sellerpilot_private.smartstore_existing_content_repair_job_matches(new) is not true
     or (tg_op='UPDATE' and (
       old.request_payload is distinct from new.request_payload
       or old.channel is distinct from new.channel
       or old.operation is distinct from new.operation
       or old.environment is distinct from new.environment
       or old.listing_id is distinct from new.listing_id
       or old.credential_id is distinct from new.credential_id
       or old.seller_account_key is distinct from new.seller_account_key
       or old.created_by is distinct from new.created_by
     )) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_MARKER_INVALID';
  end if;
  if tg_op='INSERT' then return new; end if;
  select * into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits
  where repair_job_id=new.id;
  begin
    terminal_job_id := nullif(current_setting(
      'sellerpilot.smartstore_content_repair_terminal_job',true
    ),'')::uuid;
  exception when others then
    terminal_job_id := null;
  end;
  if old.status is distinct from new.status then
    if old.status='queued' and new.status='running' then
      null;
    elsif old.status='running' and new.status='reconciliation_required' then
      null;
    elsif old.status='queued' and new.status='failed'
       and terminal_job_id=new.id
       and old.provider_mutation_started_at is null
       and permit.consumed_at is null
       and permit.expires_at<=clock_timestamp() then
      null;
    elsif old.status='running' and new.status='failed'
       and terminal_job_id=new.id
       and old.provider_mutation_started_at is null
       and permit.consumed_at is null then
      null;
    elsif old.status='running' and new.status='succeeded'
       and terminal_job_id=new.id
       and old.provider_mutation_started_at is not null
       and permit.consumed_at is not null then
      null;
    else
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TERMINAL_PATH_INVALID';
    end if;
  end if;
  if new.status in ('queued','running','succeeded')
     and sellerpilot_private.smartstore_existing_content_repair_binding(new.id) is null then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_BINDING_NOT_CURRENT';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_existing_content_repair_job()
  from public, anon, authenticated, service_role;
create trigger smartstore_existing_content_repair_job_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_smartstore_existing_content_repair_job();

create function public.sellerpilot_service_enqueue_smartstore_content_repair(
  p_actor uuid,p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  existing_job sellerpilot_private.channel_gateway_jobs%rowtype;
  existing_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  completed_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  completed_repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  completed_verification_job sellerpilot_private.channel_gateway_jobs%rowtype;
  blocking_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  blocking_job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  repair_job_id uuid := gen_random_uuid();
  release_sha text;
  marker jsonb;
  source_arguments jsonb;
  repair_arguments jsonb;
  request_payload jsonb;
  preparation jsonb;
  prior_terminal_job text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (select 1 from sellerpilot_private.admin_users where user_id=p_actor)
     or not exists (
       select 1 from sellerpilot_private.products
       where id=p_product_id and owner_id=p_actor and not demo and status<>'archived'
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_ACCESS_DENIED'
      using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-content-repair:'||p_product_id::text)
  );
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1
  for update;
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor,p_product_id
  );
  if baseline.id is not null then
    select repair_job.* into completed_repair_job
    from sellerpilot_private.smartstore_existing_content_repair_permits candidate
    join sellerpilot_private.channel_gateway_jobs repair_job
      on repair_job.id=candidate.repair_job_id
    where candidate.baseline_id=baseline.id
    order by candidate.created_at desc,candidate.id desc limit 1
    for update of repair_job;
    select * into completed_permit
    from sellerpilot_private.smartstore_existing_content_repair_permits candidate
    where candidate.repair_job_id=completed_repair_job.id
    for update;
    select * into completed_verification_job
    from sellerpilot_private.channel_gateway_jobs
    where id=completed_permit.verification_job_id;
  end if;
  if preparation->>'status'='already_verified' and baseline.id is not null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','verified','reason','ADOPTION_ALREADY_VERIFIED',
      'jobId',completed_permit.repair_job_id,
      'verificationJobId',completed_permit.verification_job_id,
      'baselineId',baseline.id,'productId',p_product_id,
      'listingId',preparation->>'listingId','reused',true,
      'contentVerified',true,'providerMutationPerformed',true,
      'normalUpdateEligible',true
    );
  end if;
  if baseline.id is null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','blocked','reason','REPAIR_BASELINE_REQUIRED',
      'jobId',null,'verificationJobId',null,'baselineId',null,
      'productId',p_product_id,'listingId',null,'reused',false,
      'contentVerified',false,'providerMutationPerformed',false,
      'normalUpdateEligible',false
    );
  end if;
  if not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     ) then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','blocked','reason','REPAIR_BASELINE_STALE',
      'jobId',null,'verificationJobId',null,'baselineId',baseline.id,
      'productId',p_product_id,'listingId',baseline.listing_id,'reused',false,
      'contentVerified',false,'providerMutationPerformed',false,
      'normalUpdateEligible',false
    );
  end if;
  select permit.* into blocking_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits permit
  join sellerpilot_private.smartstore_existing_remote_repair_baselines prior_baseline
    on prior_baseline.id=permit.baseline_id
  join sellerpilot_private.channel_gateway_jobs prior_job
    on prior_job.id=permit.repair_job_id
  where prior_baseline.product_id=p_product_id
    and prior_baseline.listing_id=baseline.listing_id
    and (
      (permit.baseline_id<>baseline.id and (
        prior_job.status in ('queued','running','reconciliation_required','succeeded')
        or prior_job.provider_mutation_started_at is not null
        or permit.consumed_at is not null
      ))
      or (permit.baseline_id=baseline.id and prior_job.status='failed' and (
        prior_job.provider_mutation_started_at is not null
        or permit.consumed_at is not null
      ))
    )
  order by
    case when prior_job.provider_mutation_started_at is not null
           or permit.consumed_at is not null then 0
      when prior_job.status in ('reconciliation_required','succeeded') then 1
      when prior_job.status='running' then 2 else 3 end,
    prior_job.created_at desc,prior_job.id desc
  limit 1 for update of prior_job;
  if blocking_permit.id is not null then
    select * into blocking_job
    from sellerpilot_private.channel_gateway_jobs
    where id=blocking_permit.repair_job_id;
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status',case
        when blocking_job.provider_mutation_started_at is not null
          or blocking_permit.consumed_at is not null
          or blocking_job.status in ('reconciliation_required','succeeded')
        then 'reconciliation_required' else 'blocked' end,
      'reason',case
        when blocking_job.provider_mutation_started_at is not null
          or blocking_permit.consumed_at is not null
          or blocking_job.status in ('reconciliation_required','succeeded')
        then 'CONTENT_REPAIR_RECONCILIATION_REQUIRED'
        else 'REPAIR_BASELINE_STALE' end,
      'jobId',blocking_job.id,'verificationJobId',blocking_permit.verification_job_id,
      'baselineId',blocking_permit.baseline_id,'productId',p_product_id,
      'listingId',baseline.listing_id,'reused',true,
      'contentVerified',false,
      'providerMutationPerformed',blocking_job.provider_mutation_started_at is not null
        or blocking_permit.consumed_at is not null,
      'normalUpdateEligible',false
    );
  end if;
  if completed_repair_job.status='succeeded' then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status',case completed_verification_job.status
        when 'queued' then 'verification_queued'
        when 'running' then 'verification_running'
        when 'reconciliation_required' then 'verification_reconciliation_required'
        else 'blocked' end,
      'reason',case completed_verification_job.status
        when 'queued' then 'STRICT_READBACK_QUEUED'
        when 'running' then 'STRICT_READBACK_RUNNING'
        when 'reconciliation_required' then 'STRICT_READBACK_RECONCILIATION_REQUIRED'
        else 'STRICT_READBACK_FAILED' end,
      'jobId',completed_repair_job.id,
      'verificationJobId',completed_verification_job.id,
      'baselineId',baseline.id,'productId',p_product_id,
      'listingId',baseline.listing_id,'reused',true,
      'contentVerified',false,'providerMutationPerformed',true,
      'normalUpdateEligible',false
    );
  end if;

  select job.* into existing_job
  from sellerpilot_private.smartstore_existing_content_repair_permits permit
  join sellerpilot_private.channel_gateway_jobs job on job.id=permit.repair_job_id
  where permit.baseline_id=baseline.id
    and job.status in ('queued','running','reconciliation_required')
  order by job.created_at desc,job.id desc limit 1 for update of job;
  if existing_job.id is not null then
    select * into existing_permit
    from sellerpilot_private.smartstore_existing_content_repair_permits permit_row
    where permit_row.repair_job_id=existing_job.id for update;
  end if;
  if existing_job.id is not null and existing_job.status='queued'
     and existing_permit.expires_at<=clock_timestamp() then
    prior_terminal_job := coalesce(current_setting(
      'sellerpilot.smartstore_content_repair_terminal_job',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_terminal_job',existing_job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='failed',
          response_payload=jsonb_build_object(
            'contract','smartstore_existing_content_repair_gateway_receipt_v1',
            'ok',false,'channel','smartstore','operation','listing.update',
            'reason','SMARTSTORE_EXISTING_CONTENT_REPAIR_PERMIT_EXPIRED',
            'providerMutationPerformed',false,'contentVerified',false,
            'normalUpdateEligible',false
          ),
          error_message='SMARTSTORE_EXISTING_CONTENT_REPAIR_PERMIT_EXPIRED',
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=existing_job.id and status='queued'
        and provider_mutation_started_at is null;
      if not found then
        raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_EXPIRED_JOB_RACE'
          using errcode='40001';
      end if;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_content_repair_terminal_job',prior_terminal_job,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_terminal_job',prior_terminal_job,true
    );
    existing_job := null;
    existing_permit := null;
  end if;
  if existing_job.id is not null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status',existing_job.status,
      'reason',case existing_job.status
        when 'queued' then 'CONTENT_REPAIR_QUEUED'
        when 'running' then 'CONTENT_REPAIR_RUNNING'
        else 'CONTENT_REPAIR_RECONCILIATION_REQUIRED' end,
      'jobId',existing_job.id,'verificationJobId',null,
      'baselineId',baseline.id,'productId',p_product_id,
      'listingId',baseline.listing_id,'reused',true,
      'contentVerified',false,
      'providerMutationPerformed',existing_job.provider_mutation_started_at is not null,
      'normalUpdateEligible',false
    );
  end if;

  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id for share;
  select * into credential from sellerpilot_private.channel_credentials
  where id=baseline.credential_id for share;
  release_sha := sellerpilot_private.active_serverless_runtime_release_sha();
  source_arguments := source_job.request_payload->'arguments';
  if source_job.id is null or credential.id is null
     or release_sha !~ '^[a-f0-9]{40}$'
     or credential.created_by is distinct from source_job.created_by
     or credential.seller_account_key is distinct from baseline.seller_account_key
     or jsonb_typeof(source_arguments#>'{body,originProduct,images}') is distinct from 'object'
     or coalesce(source_arguments#>>'{body,originProduct,name}','')=''
     or coalesce(source_arguments#>>'{body,originProduct,detailContent}','')=''
     or coalesce(source_arguments#>>'{body,smartstoreChannelProduct,channelProductName}','')=''
     or jsonb_typeof(source_arguments->'imageUrls') is distinct from 'array'
     or jsonb_array_length(source_arguments->'imageUrls') <> 9
  then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_SOURCE_INVALID';
  end if;
  marker := jsonb_build_object(
    'contract','smartstore_existing_content_repair_job_v1',
    'ownerId',baseline.owner_id,'baselineId',baseline.id,
    'productId',baseline.product_id,'listingId',baseline.listing_id,
    'sourceJobId',baseline.source_job_id,'sourceAttemptId',baseline.source_attempt_id,
    'credentialId',baseline.credential_id,'sellerAccountKey',baseline.seller_account_key,
    'sellerSku',baseline.seller_sku,'originProductNo',baseline.origin_product_no,
    'channelProductNo',baseline.channel_product_no,
    'approvalRevision',baseline.approval_revision,
    'contentSha256',baseline.approval_content_sha256,
    'manifestDigest',baseline.approved_manifest_digest,
    'baselineBodySha256',baseline.baseline_body_sha256,
    'protectedBodySha256',baseline.protected_body_sha256
  );
  repair_arguments := jsonb_build_object(
    'originProductNo',baseline.origin_product_no,
    'publicationIntent','live','publicationExpectedLocale','ko-KR',
    'publicationExpectedImageCount',8,
    'imageUrls',source_arguments->'imageUrls',
    'sellerpilotSmartstoreExistingContentRepair',marker,
    'body',jsonb_build_object(
      'originProduct',jsonb_build_object(
        'name',source_arguments#>'{body,originProduct,name}',
        'detailContent',source_arguments#>'{body,originProduct,detailContent}',
        'images',source_arguments#>'{body,originProduct,images}'
      ),
      'smartstoreChannelProduct',jsonb_build_object(
        'channelProductName',source_arguments#>'{body,smartstoreChannelProduct,channelProductName}'
      )
    )
  );
  request_payload := jsonb_build_object('arguments',repair_arguments);
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,request_fingerprint,seller_account_key,created_by
  ) values (
    repair_job_id,credential.id,null,baseline.listing_id,'smartstore',
    'listing.update','production',request_payload,
    sellerpilot_private.external_detail_hash(repair_arguments),
    baseline.seller_account_key,source_job.created_by
  );
  insert into sellerpilot_private.smartstore_existing_content_repair_permits (
    baseline_id,repair_job_id,owner_id,product_id,listing_id,credential_id,
    seller_account_key,release_sha,request_payload_sha256,request_payload_bytes
  ) values (
    baseline.id,repair_job_id,baseline.owner_id,baseline.product_id,
    baseline.listing_id,baseline.credential_id,baseline.seller_account_key,
    release_sha,sellerpilot_private.external_detail_hash(request_payload),
    octet_length(request_payload::text)
  );
  if sellerpilot_private.smartstore_existing_content_repair_binding(repair_job_id)
       #>>'{status}' is distinct from 'ready' then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_ENQUEUE_BINDING_FAILED';
  end if;
  return jsonb_build_object(
    'contract','smartstore_existing_content_repair_enqueue_v1',
    'status','queued','reason','CONTENT_REPAIR_QUEUED',
    'jobId',repair_job_id,'verificationJobId',null,'baselineId',baseline.id,
    'productId',p_product_id,'listingId',baseline.listing_id,'reused',false,
    'contentVerified',false,'providerMutationPerformed',false,
    'normalUpdateEligible',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)
  to service_role;

create function public.sellerpilot_service_get_smartstore_content_repair_status(
  p_actor uuid,p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preparation jsonb;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  verification_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor,p_product_id
  );
  select candidate.* into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if baseline.id is not null then
    select candidate.* into permit
    from sellerpilot_private.smartstore_existing_content_repair_permits candidate
    where candidate.baseline_id=baseline.id
    order by candidate.created_at desc,candidate.id desc limit 1;
    select * into repair_job from sellerpilot_private.channel_gateway_jobs
    where id=permit.repair_job_id;
    select * into verification_job from sellerpilot_private.channel_gateway_jobs
    where id=permit.verification_job_id;
  end if;
  if preparation->>'status'='already_verified' and baseline.id is not null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','verified','reason','ADOPTION_ALREADY_VERIFIED',
      'jobId',repair_job.id,'verificationJobId',verification_job.id,
      'baselineId',baseline.id,'productId',p_product_id,
      'listingId',preparation->>'listingId','reused',true,
      'contentVerified',true,'providerMutationPerformed',true,
      'normalUpdateEligible',true
    );
  end if;
  if verification_job.id is not null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status',case verification_job.status
        when 'queued' then 'verification_queued'
        when 'running' then 'verification_running'
        when 'reconciliation_required' then 'verification_reconciliation_required'
        else 'blocked' end,
      'reason',case verification_job.status
        when 'queued' then 'STRICT_READBACK_QUEUED'
        when 'running' then 'STRICT_READBACK_RUNNING'
        when 'reconciliation_required' then 'STRICT_READBACK_RECONCILIATION_REQUIRED'
        else 'STRICT_READBACK_FAILED' end,
      'jobId',repair_job.id,'verificationJobId',verification_job.id,
      'baselineId',baseline.id,'productId',p_product_id,
      'listingId',baseline.listing_id,'reused',true,
      'contentVerified',false,'providerMutationPerformed',true,
      'normalUpdateEligible',false
    );
  end if;
  if repair_job.id is not null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status',case
        when repair_job.status='queued'
         and permit.expires_at<=clock_timestamp() then 'blocked'
        when repair_job.status='queued' then 'queued'
        when repair_job.status='running' then 'running'
        when repair_job.status='reconciliation_required' then 'reconciliation_required'
        else 'blocked' end,
      'reason',case
        when repair_job.status='queued'
         and permit.expires_at<=clock_timestamp() then 'REPAIR_JOB_EXPIRED'
        when repair_job.status='queued' then 'CONTENT_REPAIR_QUEUED'
        when repair_job.status='running' then 'CONTENT_REPAIR_RUNNING'
        when repair_job.status='reconciliation_required' then 'CONTENT_REPAIR_RECONCILIATION_REQUIRED'
        else 'REPAIR_JOB_FAILED' end,
      'jobId',repair_job.id,'verificationJobId',null,
      'baselineId',baseline.id,'productId',p_product_id,
      'listingId',baseline.listing_id,'reused',true,
      'contentVerified',false,
      'providerMutationPerformed',repair_job.provider_mutation_started_at is not null,
      'normalUpdateEligible',false
    );
  end if;
  if baseline.id is null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','blocked','reason','REPAIR_BASELINE_REQUIRED',
      'jobId',null,'verificationJobId',null,'baselineId',null,
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'reused',false,'contentVerified',false,
      'providerMutationPerformed',false,'normalUpdateEligible',false
    );
  end if;
  if not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     ) then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_enqueue_v1',
      'status','blocked','reason','REPAIR_BASELINE_STALE',
      'jobId',null,'verificationJobId',null,'baselineId',baseline.id,
      'productId',p_product_id,'listingId',baseline.listing_id,
      'reused',false,'contentVerified',false,
      'providerMutationPerformed',false,'normalUpdateEligible',false
    );
  end if;
  return jsonb_build_object(
    'contract','smartstore_existing_content_repair_enqueue_v1',
    'status','repair_required','reason','APPROVED_CONTENT_REPAIR_REQUIRED',
    'jobId',null,'verificationJobId',null,'baselineId',baseline.id,
    'productId',p_product_id,'listingId',baseline.listing_id,'reused',true,
    'contentVerified',false,'providerMutationPerformed',false,
    'normalUpdateEligible',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  to service_role;

create function sellerpilot_private.smartstore_existing_content_repair_claim_allowed(
  p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,p_worker_version text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_existing_content_repair_permits permit
      on permit.repair_job_id=job.id
    join sellerpilot_private.smartstore_existing_remote_repair_baselines baseline
      on baseline.id=permit.baseline_id
    join sellerpilot_private.channel_credentials credential
      on credential.id=job.credential_id and credential.id=p_credential_id
     and credential.channel='smartstore' and credential.environment='production'
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key=job.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id=p_worker_token_id and token.scope='gateway'
     and token.id=baseline.readback_worker_token_id
     and token.status='active' and token.expires_at>clock_timestamp()
     and token.last_version=p_worker_version
     and p_worker_version ~ '^sellerpilot-cli-worker/1[.]61[+][0-9a-f]{40}[.][0-9a-f]{11}$'
     and p_worker_version like 'sellerpilot-cli-worker/1.61+'
       || sellerpilot_private.active_serverless_runtime_release_sha() || '.%'
    where job.id=p_job_id and job.status='queued' and job.attempt_count=0
      and job.provider_mutation_started_at is null
      and sellerpilot_private.smartstore_existing_content_repair_job_matches(job)
      and sellerpilot_private.smartstore_existing_content_repair_binding(job.id)
        #>>'{status}'='ready'
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_claim_allowed(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.bind_smartstore_existing_content_repair_claim(
  p_old jsonb,p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_old->>'status' <> 'queued' or p_new->>'status' <> 'running'
     or p_old->>'id' is distinct from p_new->>'id'
     or p_old->'request_payload' is distinct from p_new->'request_payload'
     or p_new->>'attempt_count' <> '1'
     or coalesce(p_new->>'claim_token','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_new->>'worker_token_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not sellerpilot_private.smartstore_existing_content_repair_claim_allowed(
       (p_new->>'id')::uuid,(p_new->>'credential_id')::uuid,
       (p_new->>'worker_token_id')::uuid,
       (select last_version from sellerpilot_private.ai_cli_worker_tokens
        where id=(p_new->>'worker_token_id')::uuid)
     ) then
    return false;
  end if;
  update sellerpilot_private.smartstore_existing_content_repair_permits permit
  set bound_worker_token_id=(p_new->>'worker_token_id')::uuid,
      bound_claim_token=(p_new->>'claim_token')::uuid,
      bound_at=clock_timestamp()
  where permit.repair_job_id=(p_new->>'id')::uuid
    and permit.bound_at is null and permit.consumed_at is null
    and permit.expires_at>clock_timestamp()
    and permit.request_payload_sha256=
      sellerpilot_private.external_detail_hash(p_new->'request_payload')
    and permit.request_payload_bytes=octet_length((p_new->'request_payload')::text);
  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.bind_smartstore_existing_content_repair_claim(jsonb,jsonb)
  from public, anon, authenticated, service_role;

-- The exact repair gets its own active lane. The uncertain source CREATE stays
-- in the default lane and remains untouched.
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
      when sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
        channel_gateway_jobs
      ) then 'smartstore_manual_adoption_readback_v1'
      when sellerpilot_private.smartstore_existing_content_repair_job_matches(
        channel_gateway_jobs
      ) then 'smartstore_existing_content_repair_v1'
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

do $patch_claim$
declare
  definition text;
  general_before constant text := $before$and not sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
         j.id,c.id,v_token_id,p_worker_version
       )$before$;
  general_after constant text := $after$and not sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
         j.id,c.id,v_token_id,p_worker_version
       )
       and not sellerpilot_private.smartstore_existing_content_repair_claim_allowed(
         j.id,c.id,v_token_id,p_worker_version
       )$after$;
  recovery_before constant text := $before$or sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
               j.id,c.id,v_token_id,p_worker_version
             )$before$;
  recovery_after constant text := $after$or sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
               j.id,c.id,v_token_id,p_worker_version
             )
             or sellerpilot_private.smartstore_existing_content_repair_claim_allowed(
               j.id,c.id,v_token_id,p_worker_version
             )$after$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(definition,'smartstore_existing_content_repair_claim_allowed')=0 then
    if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
          definition,general_before,'')))/pg_catalog.length(general_before) <> 1
       or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
          definition,recovery_before,'')))/pg_catalog.length(recovery_before) <> 1 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_CLAIM_PREIMAGE_DRIFT';
    end if;
    definition := pg_catalog.replace(definition,general_before,general_after);
    definition := pg_catalog.replace(definition,recovery_before,recovery_after);
    execute definition;
  end if;
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
       definition,'smartstore_existing_content_repair_claim_allowed','')))
       / pg_catalog.length('smartstore_existing_content_repair_claim_allowed') <> 2
     or pg_catalog.strpos(definition,'sellerpilot.local_gateway_recovery_lane')=0
     or pg_catalog.strpos(definition,'sellerpilot.local_channel_executor_lane')=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_CLAIM_POSTIMAGE_DRIFT';
  end if;
end;
$patch_claim$;

do $patch_closed_gate$
declare
  definition text;
  before_fragment constant text := $before$or sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )$before$;
  after_fragment constant text := $after$or sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_smartstore_existing_content_repair_claim(
         to_jsonb(old),to_jsonb(new)
       )$after$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  );
  if pg_catalog.strpos(definition,'bind_smartstore_existing_content_repair_claim')=0 then
    if pg_catalog.strpos(definition,before_fragment)=0 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_CLOSED_GATE_PREIMAGE_DRIFT';
    end if;
    execute pg_catalog.replace(definition,before_fragment,after_fragment);
  end if;
end;
$patch_closed_gate$;

create function sellerpilot_private.smartstore_existing_content_repair_provider_allowed(
  p_job_id uuid,p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from sellerpilot_private.smartstore_existing_content_repair_permits permit
    join sellerpilot_private.channel_gateway_jobs job on job.id=permit.repair_job_id
    where permit.repair_job_id=p_job_id
      and permit.bound_claim_token=p_claim_token
      and permit.bound_worker_token_id=job.worker_token_id
      and permit.bound_at is not null and permit.consumed_at is null
      and permit.expires_at>clock_timestamp()
      and permit.release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
      and job.status='running' and job.channel='smartstore'
      and job.operation='listing.update' and job.environment='production'
      and job.claim_token=p_claim_token and job.attempt_count=1
      and job.started_at is not null and job.lease_expires_at>clock_timestamp()
      and job.completed_at is null and job.response_payload is null
      and job.error_message is null and job.provider_mutation_started_at is null
      and permit.request_payload_sha256=sellerpilot_private.external_detail_hash(job.request_payload)
      and permit.request_payload_bytes=octet_length(job.request_payload::text)
      and sellerpilot_private.smartstore_existing_content_repair_binding(job.id)
        #>>'{status}'='ready'
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_provider_allowed(uuid,uuid)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_174000_begin_gateway_mutation_pre_repair;
revoke all on function
  public.sellerpilot_174000_begin_gateway_mutation_pre_repair(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_repair boolean;
  started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select exists (
    select 1 from sellerpilot_private.smartstore_existing_content_repair_permits
    where repair_job_id=p_job_id
  ) into is_repair;
  if not is_repair then
    return public.sellerpilot_174000_begin_gateway_mutation_pre_repair(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if not sellerpilot_private.smartstore_existing_content_repair_provider_allowed(
       p_job_id,p_claim_token
     ) then return false; end if;
  started := public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    p_token_hash,p_job_id,p_claim_token
  );
  if not coalesce(started,false) then return false; end if;
  update sellerpilot_private.smartstore_existing_content_repair_permits permit
  set consumed_at=clock_timestamp()
  where permit.repair_job_id=p_job_id
    and permit.bound_claim_token=p_claim_token
    and permit.bound_at is not null and permit.consumed_at is null;
  if not found then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_PERMIT_CONSUMPTION_FAILED'
      using errcode='40001';
  end if;
  return true;
end;
$$;

revoke all on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

alter function public.sellerpilot_service_gateway_completion_context(
  text,uuid,uuid
) rename to sellerpilot_174000_gateway_completion_context_pre_repair;
revoke all on function
  public.sellerpilot_174000_gateway_completion_context_pre_repair(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context jsonb;
  repair_contract text;
begin
  context := public.sellerpilot_174000_gateway_completion_context_pre_repair(
    p_token_hash,p_job_id,p_claim_token
  );
  if context is null then return null; end if;
  select case
    when sellerpilot_private.smartstore_existing_content_repair_job_matches(job)
      then 'smartstore_existing_content_repair_job_v1'
    else null end
  into repair_contract
  from sellerpilot_private.channel_gateway_jobs job
  where job.id=p_job_id;
  return context || jsonb_build_object(
    'smartstoreContentRepairContract',repair_contract
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
  to service_role;

create function sellerpilot_private.smartstore_repair_detail_html_matches(
  p_source_html text,p_remote_html text
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  source_html text := p_source_html;
  remote_html text := p_remote_html;
  token text;
  image_index integer;
begin
  if jsonb_array_length(sellerpilot_private.smartstore_repair_html_image_urls(source_html))<>8
     or jsonb_array_length(sellerpilot_private.smartstore_repair_html_image_urls(remote_html))<>8
     or (select count(*) from pg_catalog.regexp_matches(source_html,'<img([[:space:]]|>)','gi'))<>8
     or (select count(*) from pg_catalog.regexp_matches(remote_html,'<img([[:space:]]|>)','gi'))<>8
  then return false; end if;
  for image_index in 0..7 loop
    token := '__SELLERPILOT_DETAIL_IMAGE_'||(image_index+1)::text||'__';
    if position(token in source_html)>0 or position(token in remote_html)>0 then
      return false;
    end if;
    source_html := pg_catalog.regexp_replace(
      source_html,'(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1'||token||E'\\2','i'
    );
    remote_html := pg_catalog.regexp_replace(
      remote_html,'(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1'||token||E'\\2','i'
    );
  end loop;
  return source_html is not distinct from remote_html;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_detail_html_matches(text,text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_existing_content_repair_result_valid(
  p_job_id uuid,p_readback jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  marker jsonb;
  post_readback jsonb;
  transmission jsonb;
  proof jsonb;
  expected jsonb;
  optional_image_urls jsonb;
  representative_image_url text;
  origin_no text;
  channel_no text;
  observed timestamptz;
  image_index integer;
begin
  select * into job from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  select * into permit from sellerpilot_private.smartstore_existing_content_repair_permits
  where repair_job_id=p_job_id;
  select * into baseline from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=permit.baseline_id;
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id;
  marker := job.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}';
  if job.id is null or permit.id is null or baseline.id is null or source_job.id is null
     or not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     )
     or jsonb_typeof(p_readback) is distinct from 'object'
     or octet_length(p_readback::text)>2097152
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(p_readback,array[
       'approvedTransmissionImages','baselineBodySha256','channelProductNo','contract',
       'observedAt','originProductNo','postwriteChannelResponseSha256',
       'postwriteOriginResponseSha256','postwriteProtectedBodySha256','postwriteReadback',
       'prewriteChannelResponseSha256','prewriteOriginResponseSha256',
       'prewriteProtectedBodySha256','providerMutationPerformed','source'
     ])
     or p_readback->>'contract'<>'smartstore_existing_content_repair_result_v1'
     or p_readback->>'source'<>'smartstore_official_content_repair_v1'
     or p_readback->'providerMutationPerformed' is distinct from 'true'::jsonb
     or p_readback->>'originProductNo' is distinct from baseline.origin_product_no
     or p_readback->>'channelProductNo' is distinct from baseline.channel_product_no
     or p_readback->>'baselineBodySha256' is distinct from baseline.baseline_body_sha256
     or p_readback->>'prewriteProtectedBodySha256' is distinct from baseline.protected_body_sha256
     or p_readback->>'postwriteProtectedBodySha256' is distinct from baseline.protected_body_sha256
     or p_readback->>'prewriteOriginResponseSha256' is distinct from baseline.origin_response_sha256
     or p_readback->>'prewriteChannelResponseSha256' is distinct from baseline.channel_response_sha256
     or jsonb_typeof(p_readback->'approvedTransmissionImages') is distinct from 'array'
     or jsonb_array_length(p_readback->'approvedTransmissionImages')<>8
     or jsonb_typeof(p_readback->'postwriteReadback') is distinct from 'object'
     or permit.consumed_at is null
     or marker->>'baselineId' is distinct from baseline.id::text then
    return false;
  end if;
  observed := (p_readback->>'observedAt')::timestamptz;
  if observed is null or observed<permit.consumed_at
     or observed>clock_timestamp()+interval '1 minute'
     or observed<clock_timestamp()-interval '15 minutes' then
    return false;
  end if;
  post_readback := p_readback->'postwriteReadback';
  transmission := p_readback->'approvedTransmissionImages';
  if post_readback->>'contract'<>'smartstore_official_manual_adoption_readback_v1'
     or post_readback->>'source'<>'smartstore_official_api_readback_v1'
     or post_readback->'providerMutationPerformed' is distinct from 'false'::jsonb
     or p_readback->>'postwriteOriginResponseSha256' is distinct from
       sellerpilot_private.external_detail_hash(post_readback#>'{originReadback,response}')
     or p_readback->>'postwriteChannelResponseSha256' is distinct from
       sellerpilot_private.external_detail_hash(post_readback#>'{channelReadback,response}') then
    return false;
  end if;
  select identity.origin_product_no,identity.channel_product_no
  into origin_no,channel_no
  from sellerpilot_private.smartstore_manual_adoption_official_identity(
    post_readback,baseline.seller_sku
  ) identity;
  representative_image_url := post_readback
    #>>'{originReadback,response,originProduct,images,representativeImage,url}';
  select coalesce(jsonb_agg(to_jsonb(image.value->>'url') order by image.ordinal),'[]'::jsonb)
  into optional_image_urls
  from jsonb_array_elements(
    case
      when jsonb_typeof(post_readback
        #>'{originReadback,response,originProduct,images,optionalImages}')='array'
        then post_readback
          #>'{originReadback,response,originProduct,images,optionalImages}'
      else '[]'::jsonb
    end
  ) with ordinality image(value,ordinal);
  if origin_no is distinct from baseline.origin_product_no
     or channel_no is distinct from baseline.channel_product_no
     or p_readback->>'observedAt' is distinct from post_readback->>'observedAt'
     or sellerpilot_private.smartstore_repair_body_hashes(post_readback)
       #>>'{protectedBodySha256}' is distinct from baseline.protected_body_sha256
     or post_readback#>>'{originReadback,response,originProduct,name}' is distinct from
       source_job.request_payload#>>'{arguments,body,originProduct,name}'
     or post_readback#>>'{channelReadback,response,smartstoreChannelProduct,channelProductName}'
       is distinct from source_job.request_payload#>>'{arguments,body,smartstoreChannelProduct,channelProductName}'
     or not sellerpilot_private.smartstore_repair_detail_html_matches(
       source_job.request_payload#>>'{arguments,body,originProduct,detailContent}',
       post_readback#>>'{originReadback,response,originProduct,detailContent}'
     )
     or jsonb_typeof(post_readback->'detailImageUrls') is distinct from 'array'
     or jsonb_array_length(post_readback->'detailImageUrls')<>8
     or (select count(distinct value)
       from jsonb_array_elements_text(post_readback->'detailImageUrls') value)<>8
     or exists (
       select 1 from jsonb_array_elements_text(post_readback->'detailImageUrls') value
       where value !~* '^https://shop-phinf[.]pstatic[.]net/.+[.][a-z0-9]+$'
     )
     or jsonb_typeof(post_readback->'detailImagePixelSha256s') is distinct from 'array'
     or jsonb_array_length(post_readback->'detailImagePixelSha256s')<>8
     or (select count(distinct value)
       from jsonb_array_elements_text(post_readback->'detailImagePixelSha256s') value)<>8
     or representative_image_url !~* '^https://shop-phinf[.]pstatic[.]net/.+[.][a-z0-9]+$'
     or optional_image_urls is distinct from post_readback->'detailImageUrls'
     or (select count(distinct value->>'url') from jsonb_array_elements(transmission) value)<>8
     or (select count(distinct value->>'contentSha256') from jsonb_array_elements(transmission) value)<>8
     or (select count(distinct value->>'decodedRgbaSha256') from jsonb_array_elements(transmission) value)<>8 then
    return false;
  end if;
  for image_index in 0..7 loop
    proof := transmission->image_index;
    expected := baseline.approved_transport_images->image_index;
    if not sellerpilot_private.smartstore_jsonb_has_exact_keys(proof,array[
         'contentSha256','decodedRgbaSha256','height','index','url','width'
       ])
       or proof->>'index' is distinct from image_index::text
       or proof->>'url' is distinct from expected->>'url'
       or proof->>'contentSha256' is distinct from expected->>'contentSha256'
       or proof->>'decodedRgbaSha256' is distinct from expected->>'decodedRgbaSha256'
       or proof->>'contentSha256' !~ '^[a-f0-9]{64}$'
       or proof->>'decodedRgbaSha256' !~ '^[a-f0-9]{64}$'
       or proof->>'width' !~ '^[0-9]+$'
       or proof->>'height' !~ '^[0-9]+$'
       or (proof->>'width')::integer not between 600 and 1600
       or (proof->>'height')::integer not between 600 and 1600
       or post_readback#>>array['detailImagePixelSha256s',image_index::text]
         is distinct from proof->>'decodedRgbaSha256' then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_result_valid(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(
  p_source_job_id uuid,p_readback jsonb,p_original_expected_pixels jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  verifier_job_id uuid;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  receipt sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  expected_pixels jsonb;
begin
  if p_readback->'detailImagePixelSha256s' is not distinct from p_original_expected_pixels
  then return true; end if;
  begin
    verifier_job_id := nullif(current_setting(
      'sellerpilot.smartstore_content_repair_verifier_job',true
    ),'')::uuid;
  exception when others then
    return false;
  end;
  select candidate.* into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  join sellerpilot_private.smartstore_existing_remote_repair_baselines baseline
    on baseline.id=candidate.baseline_id
  join sellerpilot_private.channel_gateway_jobs repair_job
    on repair_job.id=candidate.repair_job_id
  where candidate.verification_job_id=verifier_job_id
    and baseline.source_job_id=p_source_job_id
    and repair_job.status='succeeded'
    and candidate.consumed_at is not null
    and candidate.completed_readback_sha256 is not null;
  select candidate.* into receipt
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=permit.repair_job_id
    and candidate.result_status='verification_queued'
    and candidate.verification_job_id=verifier_job_id
    and candidate.readback_sha256=permit.completed_readback_sha256;
  if permit.id is null or receipt.job_id is null
     or jsonb_typeof(permit.approved_transmission_images) is distinct from 'array'
     or jsonb_array_length(permit.approved_transmission_images)<>8 then
    return false;
  end if;
  select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
  into expected_pixels
  from jsonb_array_elements(permit.approved_transmission_images)
    with ordinality image(value,ordinal);
  return p_readback->'detailImagePixelSha256s' is not distinct from expected_pixels;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;

do $patch_adoption_pixel_contract$
declare
  definition text;
  before_fragment constant text := $before$     or p_readback->'detailImagePixelSha256s' is distinct from expected_pixels then$before$;
  after_fragment constant text := $after$     or not sellerpilot_private.smartstore_manual_adoption_pixel_binding_is_valid(
       source_job.id,p_readback,expected_pixels
     ) then$after$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
  );
  if pg_catalog.strpos(definition,'smartstore_manual_adoption_pixel_binding_is_valid')=0 then
    if pg_catalog.strpos(definition,before_fragment)=0 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_PIXEL_PREIMAGE_DRIFT';
    end if;
    execute pg_catalog.replace(definition,before_fragment,after_fragment);
  end if;
end;
$patch_adoption_pixel_contract$;

create function sellerpilot_private.enqueue_smartstore_repair_strict_verifier(
  p_baseline_id uuid,p_repair_job_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  existing_job sellerpilot_private.channel_gateway_jobs%rowtype;
  marker jsonb;
  request_payload jsonb;
  verifier_job_id uuid := gen_random_uuid();
begin
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=p_baseline_id;
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id;
  select * into credential from sellerpilot_private.channel_credentials
  where id=baseline.credential_id;
  select verifier.* into existing_job
  from sellerpilot_private.smartstore_existing_content_repair_permits permit
  join sellerpilot_private.channel_gateway_jobs verifier
    on verifier.id=permit.verification_job_id
  where permit.repair_job_id=p_repair_job_id;
  if existing_job.id is not null then return existing_job.id; end if;
  if baseline.id is null or source_job.id is null or credential.id is null
     or not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_VERIFIER_BINDING_STALE';
  end if;
  marker := jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_job_v1',
    'ownerId',baseline.owner_id,'productId',baseline.product_id,
    'listingId',baseline.listing_id,'sourceJobId',baseline.source_job_id,
    'sourceAttemptId',baseline.source_attempt_id,
    'credentialId',baseline.credential_id,
    'sellerAccountKey',baseline.seller_account_key,
    'sellerSku',baseline.seller_sku,
    'approvalRevision',baseline.approval_revision,
    'contentSha256',baseline.approval_content_sha256,
    'manifestDigest',baseline.approved_manifest_digest
  );
  request_payload := jsonb_build_object(
    'sellerpilotLineageVersion','provider_listing_readback_v1',
    'arguments',jsonb_build_object(
      'sellerpilotSmartstoreManualAdoptionReadback',marker
    )
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,seller_account_key,created_by
  ) values (
    verifier_job_id,credential.id,null,baseline.listing_id,'smartstore',
    'listing.lineage.verify','production',request_payload,
    baseline.seller_account_key,source_job.created_by
  );
  return verifier_job_id;
end;
$$;

revoke all on function
  sellerpilot_private.enqueue_smartstore_repair_strict_verifier(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_content_repair(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_readback jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  receipt sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  readback_sha text;
  safe_error text;
  fingerprint text;
  verifier_job_id uuid;
  result_status text;
  result_reason text;
  safe_response jsonb;
  prior_terminal_job text;
begin
  if p_job_id is null or p_claim_token is null
     or p_status not in ('succeeded','failed','reconciliation_required')
     or (p_status='succeeded' and (
       jsonb_typeof(p_readback) is distinct from 'object'
       or octet_length(p_readback::text)>2097152
       or p_error_message is not null
     ))
     or (p_status<>'succeeded' and p_readback is not null) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_COMPLETION_INVALID';
  end if;
  select * into worker_token
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.token_hash=p_token_hash and token.scope='gateway'
    and token.status='active' and token.expires_at>clock_timestamp();
  if worker_token.id is null then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_WORKER_DENIED'
      using errcode='42501';
  end if;
  safe_error := case
    when p_status='succeeded' then null
    when coalesce(p_error_message,'') ~ '^[A-Z0-9_:-]{1,160}$' then p_error_message
    else 'SMARTSTORE_EXISTING_CONTENT_REPAIR_FAILED' end;
  readback_sha := case when p_status='succeeded'
    then sellerpilot_private.external_detail_hash(p_readback) else null end;
  fingerprint := sellerpilot_private.external_detail_hash(jsonb_build_object(
    'status',p_status,'readbackSha256',readback_sha,'safeError',safe_error
  ));
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-content-repair-job:'||p_job_id::text)
  );
  select * into receipt
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts
  where job_id=p_job_id and claim_token=p_claim_token
    and worker_token_id=worker_token.id;
  if receipt.job_id is not null then
    if receipt.completion_fingerprint is distinct from fingerprint then
      return jsonb_build_object(
        'contract','smartstore_existing_content_repair_completion_v1',
        'status','reconciliation_required',
        'reason','CONTENT_REPAIR_RECONCILIATION_REQUIRED',
        'jobId',p_job_id,'baselineId',receipt.baseline_id,
        'verificationJobId',receipt.verification_job_id,
        'readbackSha256',receipt.readback_sha256,'reused',true
      );
    end if;
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_completion_v1',
      'status',receipt.result_status,'reason',receipt.reason,
      'jobId',p_job_id,'baselineId',receipt.baseline_id,
      'verificationJobId',receipt.verification_job_id,
      'readbackSha256',receipt.readback_sha256,'reused',true
    );
  end if;
  select claimed.* into job
  from sellerpilot_private.channel_gateway_jobs claimed
  where claimed.id=p_job_id and claimed.status='running'
    and claimed.worker_token_id=worker_token.id
    and claimed.claim_token=p_claim_token
    and claimed.lease_expires_at>clock_timestamp()
  for update;
  select * into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits
  where repair_job_id=p_job_id for update;
  if job.id is null or permit.id is null then
    return jsonb_build_object(
      'contract','smartstore_existing_content_repair_completion_v1',
      'status','lease_lost','reason','CLAIM_LEASE_LOST','jobId',p_job_id,
      'baselineId',permit.baseline_id,'verificationJobId',null,
      'readbackSha256',null,'reused',false
    );
  end if;
  if sellerpilot_private.smartstore_existing_content_repair_job_matches(job) is not true
     or permit.bound_worker_token_id is distinct from worker_token.id
     or permit.bound_claim_token is distinct from p_claim_token
     or permit.bound_at is null then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_COMPLETION_BINDING_INVALID';
  end if;
  if p_status='failed' and (
       job.provider_mutation_started_at is not null or permit.consumed_at is not null
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_FAILED_AFTER_MUTATION';
  end if;
  if p_status in ('succeeded','reconciliation_required') and (
       job.provider_mutation_started_at is null or permit.consumed_at is null
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_MUTATION_BOUNDARY_MISSING';
  end if;

  if p_status='succeeded' then
    if sellerpilot_private.smartstore_existing_content_repair_result_valid(
         job.id,p_readback
       ) is not true then
      update sellerpilot_private.channel_gateway_jobs
      set status='reconciliation_required',response_payload=null,
          error_message='SMARTSTORE_EXISTING_CONTENT_REPAIR_RESULT_INVALID',
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id;
      insert into sellerpilot_private.smartstore_existing_content_repair_completion_receipts (
        job_id,claim_token,worker_token_id,baseline_id,completion_fingerprint,
        result_status,readback_sha256,verification_job_id,reason
      ) values (
        job.id,p_claim_token,worker_token.id,permit.baseline_id,fingerprint,
        'reconciliation_required',null,null,
        'CONTENT_REPAIR_RECONCILIATION_REQUIRED'
      );
      insert into sellerpilot_private.gateway_completion_receipts (
        job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
      ) values (job.id,p_claim_token,worker_token.id,fingerprint,null);
      return jsonb_build_object(
        'contract','smartstore_existing_content_repair_completion_v1',
        'status','reconciliation_required',
        'reason','CONTENT_REPAIR_RECONCILIATION_REQUIRED',
        'jobId',job.id,'baselineId',permit.baseline_id,
        'verificationJobId',null,'readbackSha256',null,'reused',false
      );
    end if;
    safe_response := jsonb_build_object(
      'contract','smartstore_existing_content_repair_gateway_receipt_v1',
      'ok',true,'channel','smartstore','operation','listing.update',
      'verificationStatus','strict_readback_queued',
      'originProductNo',job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,originProductNo}',
      'channelProductNo',job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,channelProductNo}',
      'readbackSha256',readback_sha,'providerMutationPerformed',true,
      'contentVerified',false,'normalUpdateEligible',false
    );
    prior_terminal_job := coalesce(current_setting(
      'sellerpilot.smartstore_content_repair_terminal_job',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_terminal_job',job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='succeeded',response_payload=safe_response,error_message=null,
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_content_repair_terminal_job',prior_terminal_job,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_terminal_job',prior_terminal_job,true
    );
    verifier_job_id := sellerpilot_private.enqueue_smartstore_repair_strict_verifier(
      permit.baseline_id,job.id
    );
    update sellerpilot_private.smartstore_existing_content_repair_permits
    set verification_job_id=verifier_job_id,
        completed_readback_sha256=readback_sha,
        approved_transmission_images=p_readback->'approvedTransmissionImages'
    where id=permit.id and verification_job_id is null;
    if not found then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_VERIFIER_BIND_FAILED';
    end if;
    result_status := 'verification_queued';
    result_reason := 'STRICT_READBACK_QUEUED';
  elsif p_status='reconciliation_required' then
    update sellerpilot_private.channel_gateway_jobs
    set status='reconciliation_required',response_payload=null,
        error_message=safe_error,worker_token_id=null,claim_token=null,
        lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=job.id;
    result_status := 'reconciliation_required';
    result_reason := 'CONTENT_REPAIR_RECONCILIATION_REQUIRED';
  else
    safe_response := jsonb_build_object(
      'contract','smartstore_existing_content_repair_gateway_receipt_v1',
      'ok',false,'channel','smartstore','operation','listing.update',
      'reason',safe_error,'providerMutationPerformed',false,
      'contentVerified',false,'normalUpdateEligible',false
    );
    prior_terminal_job := coalesce(current_setting(
      'sellerpilot.smartstore_content_repair_terminal_job',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_terminal_job',job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='failed',response_payload=safe_response,error_message=safe_error,
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.smartstore_content_repair_terminal_job',prior_terminal_job,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.smartstore_content_repair_terminal_job',prior_terminal_job,true
    );
    result_status := 'failed';
    result_reason := 'CONTENT_REPAIR_FAILED';
  end if;

  insert into sellerpilot_private.smartstore_existing_content_repair_completion_receipts (
    job_id,claim_token,worker_token_id,baseline_id,completion_fingerprint,
    result_status,readback_sha256,verification_job_id,reason
  ) values (
    job.id,p_claim_token,worker_token.id,permit.baseline_id,fingerprint,
    result_status,readback_sha,verifier_job_id,result_reason
  );
  insert into sellerpilot_private.gateway_completion_receipts (
    job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
  ) values (
    job.id,p_claim_token,worker_token.id,fingerprint,verifier_job_id
  );
  return jsonb_build_object(
    'contract','smartstore_existing_content_repair_completion_v1',
    'status',result_status,'reason',result_reason,'jobId',job.id,
    'baselineId',permit.baseline_id,'verificationJobId',verifier_job_id,
    'readbackSha256',readback_sha,'reused',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_complete_smartstore_content_repair(text,uuid,uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_complete_smartstore_content_repair(text,uuid,uuid,text,jsonb,text)
  to service_role;

comment on function
  public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)
  is 'Creates one DB-bound SmartStore content-only repair job from an immutable official-readback mismatch baseline. It never replays CREATE or opens the channel publication gate.';
comment on function
  public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)
  is 'Returns safe repair, strict-readback, or verified state without exposing credentials, raw request payloads, or official provider bodies.';
comment on function
  public.sellerpilot_complete_smartstore_content_repair(text,uuid,uuid,text,jsonb,text)
  is 'Atomically closes an exact Mac-gateway repair claim. A successful provider mutation queues a fresh strict readback and does not mark the listing verified.';

do $verify_contract$
declare
  definition text;
  index_definition text;
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_content_repair(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_content_repair_result_valid(uuid,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_content_repair_insert_allowed(sellerpilot_private.channel_gateway_jobs,jsonb,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_remote_repair_baselines'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_completion_receipts'
     ) is null then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_INSTALL_INCOMPLETE';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_complete_smartstore_content_repair(text,uuid,uuid,text,jsonb,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.sellerpilot_service_get_smartstore_content_repair_status(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       'public.sellerpilot_complete_smartstore_content_repair(text,uuid,uuid,text,jsonb,text)',
       'EXECUTE'
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_FUNCTION_ACL_INVALID';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'sellerpilot_private.smartstore_existing_remote_repair_baselines',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'sellerpilot_private.smartstore_existing_content_repair_permits',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'sellerpilot_private.smartstore_existing_content_repair_completion_receipts',
       'SELECT,INSERT,UPDATE,DELETE'
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TABLE_ACL_INVALID';
  end if;

  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  );
  if pg_catalog.strpos(
       definition,'smartstore_existing_content_repair_insert_allowed'
     )=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_SELLER_LINEAGE_PATCH_MISSING';
  end if;
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
       definition,'smartstore_existing_content_repair_claim_allowed','')))
       /pg_catalog.length('smartstore_existing_content_repair_claim_allowed')<>2 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_CLAIM_PATCH_INVALID';
  end if;
  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  );
  if pg_catalog.strpos(
       definition,'bind_smartstore_existing_content_repair_claim'
     )=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_CLOSED_GATE_PATCH_MISSING';
  end if;
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
  );
  if pg_catalog.strpos(
       definition,'smartstore_manual_adoption_pixel_binding_is_valid'
     )=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_PATCH_MISSING';
  end if;
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)'::regprocedure
  );
  if pg_catalog.strpos(definition,'smartstoreContentRepairContract')=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_CONTEXT_PATCH_MISSING';
  end if;
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'::regprocedure
  );
  if pg_catalog.strpos(definition,'APPROVED_CONTENT_REPAIR_REQUIRED')=0
     or pg_catalog.strpos(definition,'baselineId')=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_READBACK_PATCH_MISSING';
  end if;

  select pg_catalog.pg_get_indexdef(index_rel.oid) into index_definition
  from pg_catalog.pg_class index_rel
  join pg_catalog.pg_namespace namespace
    on namespace.oid=index_rel.relnamespace
  where namespace.nspname='sellerpilot_private'
    and index_rel.relname='channel_gateway_jobs_one_active_listing_or_lineage_idx';
  if pg_catalog.strpos(
       index_definition,'smartstore_existing_content_repair_job_matches'
     )=0 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_ACTIVE_LANE_MISSING';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_trigger trigger_row
       join pg_catalog.pg_class table_row on table_row.oid=trigger_row.tgrelid
       join pg_catalog.pg_namespace namespace on namespace.oid=table_row.relnamespace
       where namespace.nspname='sellerpilot_private'
         and table_row.relname='smartstore_existing_remote_repair_baselines'
         and trigger_row.tgname='smartstore_existing_remote_repair_baseline_immutable'
         and not trigger_row.tgisinternal
     ) or not exists (
       select 1 from pg_catalog.pg_trigger trigger_row
       join pg_catalog.pg_class table_row on table_row.oid=trigger_row.tgrelid
       join pg_catalog.pg_namespace namespace on namespace.oid=table_row.relnamespace
       where namespace.nspname='sellerpilot_private'
         and table_row.relname='smartstore_existing_content_repair_completion_receipts'
         and trigger_row.tgname='smartstore_existing_content_repair_receipt_immutable'
         and not trigger_row.tgisinternal
     ) then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_IMMUTABILITY_MISSING';
  end if;
end;
$verify_contract$;

notify pgrst, 'reload schema';

commit;
