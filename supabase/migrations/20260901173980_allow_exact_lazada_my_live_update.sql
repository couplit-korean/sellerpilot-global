-- Admit one exact listing.update of the already adopted Lazada MY item.
-- The global listing release gate remains closed. The permit is bound to the
-- provider-certified OAuth incarnation, immutable lineage attestation, active
-- runtime release, canonical request fingerprint, one gateway job/claim, and
-- the first provider mutation boundary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917398001);
select pg_catalog.pg_advisory_xact_lock(193674993, 908000001);

lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
lock table sellerpilot_private.channel_operation_attempts in share row exclusive mode;
lock table sellerpilot_private.product_listings in share row exclusive mode;
lock table sellerpilot_private.exact_existing_update_permits in share row exclusive mode;

alter table sellerpilot_private.exact_existing_update_permits
  add column lineage_attestation_id uuid
    references sellerpilot_private.provider_listing_lineage_attestations(id)
    on delete restrict,
  add column lineage_evidence_digest text;

do $lazada_exact_update_preflight$
declare
  v_signature regprocedure;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  foreach v_signature in array array[
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure,
    'sellerpilot_private.exact_existing_update_release_is_current(text,text)'::regprocedure,
    'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure,
    'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'::regprocedure,
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_catalog.pg_get_userbyid(proc.proowner), proc.prosecdef,
           proc.proconfig
      into v_owner, v_security_definer, v_config
      from pg_catalog.pg_proc proc where proc.oid = v_signature;
    if v_owner is distinct from 'postgres'
       or v_config is distinct from array['search_path=""']::text[]
       or (
         pg_catalog.pg_function_is_visible(v_signature::oid)
         and v_signature::text like 'public.%'
         and v_security_definer is distinct from true
       ) then
      raise exception 'Lazada exact update function preimage invalid: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'lazada'
       and job.listing_id = '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
       and job.operation in (
         'listing.create','listing.update','listing.stop','listing.lineage.verify'
       )
       and job.status in ('queued','running','reconciliation_required')
  ) then
    raise exception 'Lazada exact update requires no competing listing job'
      using errcode = '55000';
  end if;
end;
$lazada_exact_update_preflight$;

alter table sellerpilot_private.exact_existing_update_permits
  drop constraint exact_existing_update_permit_target_check;
alter table sellerpilot_private.exact_existing_update_permits
  add constraint exact_existing_update_permit_target_check check (
    product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and seller_account_key ~ '^[a-f0-9]{64}$'
    and credential_version > 0
    and credential_fingerprint ~ '^[A-F0-9]{12}$'
    and credential_account_source in (
      'provider_certified_v1', 'credential_incarnation_v1'
    )
    and release_sha ~ '^[a-f0-9]{40}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
    and expires_at > armed_at
    and expires_at <= armed_at + interval '5 minutes'
    and (
      (
        channel = 'coupang'
        and listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
        and market = 'KR' and target_id = 'KR'
        and remote_id = '16356981734'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id = '95962393877'
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_account_source = 'credential_incarnation_v1'
        and snapshot_revision is null and snapshot_payload_sha256 is null
        and snapshot_source_job_id is null
        and lineage_attestation_id is null and lineage_evidence_digest is null
      ) or (
        channel = 'elevenst'
        and listing_id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
        and credential_id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
        and market = 'KR' and target_id = 'KR'
        and remote_id = '9573255804'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id is null
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_version = 2
        and credential_account_source = 'credential_incarnation_v1'
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision > 0
        and snapshot_payload_sha256 ~ '^[a-f0-9]{64}$'
        and snapshot_source_job_id is not null
        and lineage_attestation_id is null and lineage_evidence_digest is null
      ) or (
        channel = 'ebay'
        and listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
        and market = 'US' and target_id = 'EBAY_US'
        and remote_id = '800551945442'
        and seller_sku = 'QA-20260823-CC-001-US'
        and provider_resource_id = '244042196011'
        and currency = 'USD' and price = 12.90
        and stock between 1 and 999999
        and credential_account_source = 'provider_certified_v1'
        and credential_expires_at is not null
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision is null and snapshot_payload_sha256 is null
        and snapshot_source_job_id is null
        and lineage_attestation_id is null and lineage_evidence_digest is null
        and seller_account_key =
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      ) or (
        channel = 'temu'
        and market = 'KR' and target_id = 'KR'
        and remote_id = '608570473054515'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id = '123896921649274'
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_account_source = 'provider_certified_v1'
        and credential_expires_at is not null
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision > 0
        and snapshot_payload_sha256 ~ '^[a-f0-9]{64}$'
        and snapshot_source_job_id is not null
        and lineage_attestation_id is null and lineage_evidence_digest is null
      ) or (
        channel = 'lazada'
        and listing_id = '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
        and market = 'MY' and target_id ~ '^\d+$'
        and remote_id = '14976038919'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id is null
        and currency = 'MYR' and price > 0 and price <= 999999999
        and stock = 1
        and credential_account_source = 'provider_certified_v1'
        and credential_expires_at is not null
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision > 0
        and snapshot_payload_sha256 ~ '^[a-f0-9]{64}$'
        and snapshot_source_job_id is not null
        and lineage_attestation_id is not null
        and lineage_evidence_digest ~ '^[a-f0-9]{64}$'
      )
    )
  );

create function sellerpilot_private.lazada_exact_update_arguments_valid(
  p_arguments jsonb,
  p_release_sha text,
  p_request_fingerprint text,
  p_expected_price numeric,
  p_expected_stock integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_marker jsonb := p_arguments->'sellerpilotLazadaExactExistingUpdate';
  v_policy jsonb := p_arguments->'sellerpilotLazadaPricePolicy';
  v_assets jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_product jsonb := p_arguments#>'{request,Request,Product}';
  v_attributes jsonb := p_arguments#>'{request,Request,Product,Attributes}';
  v_sku jsonb := p_arguments#>'{request,Request,Product,Skus,Sku,0}';
  v_transport jsonb := p_arguments#>'{sellerpilotPublicationAssetBinding,providerTransportImages}';
  v_gallery jsonb := p_arguments#>'{sellerpilotAssets,galleryImageUrls}';
  v_images jsonb := p_arguments->'imageUrls';
begin
  return coalesce(
    jsonb_typeof(p_arguments) = 'object'
    and p_release_sha ~ '^[a-f0-9]{40}$'
    and p_request_fingerprint ~ '^[a-f0-9]{64}$'
    and p_expected_price > 0 and p_expected_price <= 999999999
    and p_expected_stock = 1
    and p_arguments->>'publicationExpectedFingerprint' = p_request_fingerprint
    and p_arguments->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_arguments->>'publicationIntent' = 'live'
    and p_arguments->>'publicationExpectedLocale' = 'ms-MY'
    and (p_arguments->>'publicationExpectedImageCount')::integer = 8
    and lower(p_arguments->>'country') = 'my'
    and p_arguments->>'itemId' = '14976038919'
    and p_arguments->>'sellerpilotExpectedSellerId' = v_marker->>'targetId'
    and jsonb_typeof(v_marker) = 'object'
    and (select count(*) from jsonb_object_keys(v_marker)) = 12
    and v_marker->>'contract' = 'lazada_exact_existing_my_live_update_v1'
    and v_marker->>'productId' = 'ddccde35-9c58-4856-b673-d7aa27ce4220'
    and v_marker->>'listingId' = '42021335-9793-4834-8cd5-b73169fd1f48'
    and v_marker->>'credentialId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and v_marker->>'itemId' = '14976038919'
    and v_marker->>'sellerSku' = 'QA-20260823-CC-001-MY'
    and v_marker->>'sellerAccountKey' ~ '^[a-f0-9]{64}$'
    and v_marker->>'targetId' ~ '^\d+$'
    and v_marker->>'lineageAttestationId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and v_marker->>'lineageEvidenceDigest' ~ '^[a-f0-9]{64}$'
    and v_marker->>'approvedManifestDigest' ~ '^[a-f0-9]{64}$'
    and v_marker->>'releaseSha' = p_release_sha
    and jsonb_typeof(v_policy) = 'object'
    and v_policy->>'contract' = 'lazada_krw_myr_reference_price_v1'
    and v_policy->>'sourceCurrency' = 'KRW'
    and (v_policy->>'sourcePriceKrw')::numeric = 5000
    and v_policy->>'targetCurrency' = 'MYR'
    and (v_policy->>'targetPriceMyr')::numeric = p_expected_price
    and (v_policy#>>'{rate,krwPerMyr}')::numeric > 0
    and v_policy#>>'{rate,sourceUrl}' ~ '^https://'
    and v_policy#>>'{rate,frequency}' in (
      'minute-market','daily-reference-fallback'
    )
    and jsonb_typeof(v_product) = 'object'
    and (v_product->>'PrimaryCategory') ~ '^\d+$'
    and jsonb_typeof(v_attributes) = 'object'
    and nullif(trim(v_attributes->>'name'), '') is not null
    and length(v_attributes->>'name') <= 255
    and v_attributes->>'name' ~* '(klip|kabel|pelekat|kemas|mudah|pakej)'
    and nullif(trim(v_attributes->>'description'), '') is not null
    and length(v_attributes->>'description') <= 30000
    and v_attributes->>'description' ~* '(yang|dan|untuk|dengan|produk|kabel|klip|kemas|pelekat|mudah)'
    and jsonb_typeof(p_arguments#>'{request,Request,Product,Skus,Sku}') = 'array'
    and jsonb_array_length(p_arguments#>'{request,Request,Product,Skus,Sku}') = 1
    and v_sku->>'SellerSku' = 'QA-20260823-CC-001-MY'
    and (v_sku->>'price')::numeric = p_expected_price
    and (v_sku->>'quantity')::integer = 1
    and lower(v_sku->>'Status') = 'active'
    and jsonb_typeof(v_assets) = 'object'
    and v_assets->>'contract' = 'sellerpilot_publication_asset_binding_v1'
    and v_assets->>'providerImageSurface' = 'detail_content'
    and v_assets->>'approvedManifestDigest' =
      v_marker->>'approvedManifestDigest'
    and jsonb_typeof(v_transport) = 'array'
    and jsonb_array_length(v_transport) = 8
    and (select count(distinct row->>'publicUrl')
           from jsonb_array_elements(v_transport) row) = 8
    and not exists (
      select 1 from jsonb_array_elements(v_transport) row
       where row->>'publicUrl' !~ '^https://'
          or nullif(trim(row->>'role'), '') is null
    )
    and jsonb_typeof(v_gallery) = 'array'
    and jsonb_array_length(v_gallery) >= 1
    and (v_gallery->>0) ~ '^https://'
    and jsonb_typeof(v_images) = 'array'
    and jsonb_array_length(v_images) = 9
    and (select count(distinct value)
           from jsonb_array_elements_text(v_images)) = 9
    and not exists (
      select 1 from jsonb_array_elements_text(v_images) image(value)
       where value !~ '^https://'
    )
    and v_images ? (v_gallery->>0)
    and not exists (
      select 1 from jsonb_array_elements(v_transport) row
       where not (v_images ? (row->>'publicUrl'))
          or row->>'publicUrl' = v_gallery->>0
    ), false
  );
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.lazada_exact_update_arguments_valid(
  jsonb,text,text,numeric,integer
) from public, anon, authenticated, service_role;

alter function sellerpilot_private.exact_existing_update_arguments_valid(
  text,jsonb,text,text,integer
) rename to exact_existing_update_arguments_before_lazada_173980;

create function sellerpilot_private.exact_existing_update_arguments_valid(
  p_channel text,
  p_arguments jsonb,
  p_release_sha text,
  p_request_fingerprint text,
  p_expected_stock integer
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when p_channel = 'lazada' then
    sellerpilot_private.lazada_exact_update_arguments_valid(
      p_arguments,p_release_sha,p_request_fingerprint,
      (p_arguments#>>'{sellerpilotLazadaPricePolicy,targetPriceMyr}')::numeric,
      p_expected_stock
    )
  else sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(
    p_channel,p_arguments,p_release_sha,p_request_fingerprint,p_expected_stock
  ) end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(
    text,jsonb,text,text,integer
  ),
  sellerpilot_private.exact_existing_update_arguments_valid(
    text,jsonb,text,text,integer
  ) from public, anon, authenticated, service_role;

alter function sellerpilot_private.exact_existing_update_release_is_current(
  text,text
) rename to exact_existing_update_release_before_lazada_173980;

create function sellerpilot_private.exact_existing_update_release_is_current(
  p_channel text,p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_channel = 'lazada' then coalesce(
    p_release_sha ~ '^[a-f0-9]{40}$'
    and sellerpilot_private.active_serverless_runtime_release_sha() = p_release_sha
    and exists (
      select 1 from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton and not gate.is_open
         and gate.opened_at is null and gate.opened_release_sha is null
         and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective('lazada'),
    false
  ) else sellerpilot_private.exact_existing_update_release_before_lazada_173980(
    p_channel,p_release_sha
  ) end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_release_before_lazada_173980(text,text),
  sellerpilot_private.exact_existing_update_release_is_current(text,text)
  from public, anon, authenticated, service_role;

alter function sellerpilot_private.exact_existing_update_lineage_is_current(uuid)
  rename to exact_existing_update_lineage_before_lazada_173980;

create function sellerpilot_private.exact_existing_update_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.permit_id = p_permit_id and permit.channel = 'lazada'
  ) then exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.owner_id = permit.owner_id
       and listing.product_id = permit.product_id
       and listing.channel_key = 'lazada'
       and upper(trim(listing.market)) = permit.market
       and listing.target_id = permit.target_id
       and listing.remote_id = permit.remote_id
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id and product.owner_id = permit.owner_id
       and product.sku = permit.seller_sku and product.on_hand = permit.stock
       and not product.demo and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
       and credential.created_by = permit.owner_id
       and credential.channel = 'lazada'
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.expires_at = permit.credential_expires_at
       and credential.last_checked_at = permit.credential_last_checked_at
       and credential.last_check_status = permit.credential_last_check_status
       and credential.expires_at > statement_timestamp()
      join sellerpilot_private.channel_market_targets target
        on target.owner_id = permit.owner_id
       and target.credential_id = permit.credential_id
       and target.channel = 'lazada' and target.environment = 'production'
       and target.market_code = 'MY' and target.target_id = permit.target_id
       and target.locale = 'ms-MY' and target.currency = 'MYR'
       and lower(trim(target.remote_status)) in ('active','live','enabled')
      join sellerpilot_private.provider_listing_lineage_attestations attestation
        on attestation.listing_id = permit.listing_id
       and attestation.credential_id = permit.credential_id
       and attestation.gateway_job_id = permit.snapshot_source_job_id
       and attestation.seller_account_key = permit.seller_account_key
       and attestation.channel = 'lazada'
       and attestation.environment = 'production'
       and attestation.expected_remote_id = permit.remote_id
       and attestation.verified_remote_id = permit.remote_id
       and upper(trim(attestation.market)) = 'MY'
       and attestation.target_id = permit.target_id
       and attestation.evidence_version = 'provider_listing_readback_v1'
       and attestation.id = permit.lineage_attestation_id
       and attestation.evidence_digest = permit.lineage_evidence_digest
      join sellerpilot_private.channel_gateway_jobs source_job
        on source_job.id = attestation.gateway_job_id
       and source_job.channel = 'lazada'
       and source_job.operation = 'listing.lineage.verify'
       and source_job.status = 'succeeded'
       and source_job.request_payload#>>'{arguments,marketplaceSku}' =
             'QA-20260823-CC-001-MY'
     where permit.permit_id = p_permit_id
       and permit.channel = 'lazada'
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and permit.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and permit.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and permit.listing_id = '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
       and permit.remote_id = '14976038919'
       and permit.seller_sku = 'QA-20260823-CC-001'
       and permit.provider_resource_id is null
       and permit.market = 'MY' and permit.target_id ~ '^\d+$'
       and permit.currency = 'MYR' and permit.price > 0 and permit.stock = 1
       and permit.snapshot_revision = product.detail_page_version
       and permit.snapshot_payload_sha256 =
             product.detail_page_image_manifest->>'digest'
       and product.detail_page_version = product.detail_page_approved_version
       and product.detail_page_version > 0
       and product.detail_page_image_manifest->>'contract' =
             'sellerpilot_detail_image_manifest_v2'
       and product.detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
       and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
       and listing.provider_status is null and listing.published_at is null
       and sellerpilot_private.exact_existing_update_release_is_current(
             'lazada',permit.release_sha
           )
       and not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs active_job
          where active_job.listing_id = permit.listing_id
            and active_job.operation in (
              'listing.create','listing.update','listing.stop','listing.lineage.verify'
            )
            and active_job.status in ('queued','running','reconciliation_required')
       )
       and (
         select count(*) from sellerpilot_private.channel_credentials current_credential
         join sellerpilot_private.channel_market_targets current_target
           on current_target.owner_id = permit.owner_id
          and current_target.credential_id = current_credential.id
          and current_target.channel = 'lazada'
          and current_target.environment = 'production'
          and current_target.market_code = 'MY'
          and current_target.locale = 'ms-MY'
          and current_target.currency = 'MYR'
          and lower(trim(current_target.remote_status)) in ('active','live','enabled')
        where current_credential.created_by = permit.owner_id
          and current_credential.channel = 'lazada'
          and current_credential.environment = 'production'
          and current_credential.status = 'active'
          and current_credential.seller_account_key_source = 'provider_certified_v1'
          and current_credential.expires_at > statement_timestamp()
       ) = 1
  ) else sellerpilot_private.exact_existing_update_lineage_before_lazada_173980(
    p_permit_id
  ) end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_lineage_before_lazada_173980(uuid),
  sellerpilot_private.exact_existing_update_lineage_is_current(uuid)
  from public, anon, authenticated, service_role;

alter function
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)
  rename to exact_existing_update_enqueued_before_lazada_173980;

create function sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.permit_id = p_permit_id and permit.channel = 'lazada'
  ) then exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.owner_id = permit.owner_id
       and listing.product_id = permit.product_id
       and listing.channel_key = 'lazada'
       and upper(trim(listing.market)) = permit.market
       and listing.target_id = permit.target_id
       and listing.remote_id = permit.remote_id
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id and product.owner_id = permit.owner_id
       and product.sku = permit.seller_sku and product.on_hand = permit.stock
       and not product.demo and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
       and credential.created_by = permit.owner_id
       and credential.channel = 'lazada'
       and credential.environment = 'production' and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.expires_at = permit.credential_expires_at
       and credential.last_checked_at = permit.credential_last_checked_at
       and credential.last_check_status = permit.credential_last_check_status
       and credential.expires_at > statement_timestamp()
      join sellerpilot_private.channel_market_targets target
        on target.owner_id = permit.owner_id
       and target.credential_id = permit.credential_id
       and target.channel = 'lazada' and target.environment = 'production'
       and target.market_code = 'MY' and target.target_id = permit.target_id
       and target.locale = 'ms-MY' and target.currency = 'MYR'
       and lower(trim(target.remote_status)) in ('active','live','enabled')
      join sellerpilot_private.provider_listing_lineage_attestations attestation
        on attestation.listing_id = permit.listing_id
       and attestation.credential_id = permit.credential_id
       and attestation.gateway_job_id = permit.snapshot_source_job_id
       and attestation.seller_account_key = permit.seller_account_key
       and attestation.channel = 'lazada'
       and attestation.environment = 'production'
       and attestation.expected_remote_id = permit.remote_id
       and attestation.verified_remote_id = permit.remote_id
       and upper(trim(attestation.market)) = 'MY'
       and attestation.target_id = permit.target_id
       and attestation.id = permit.lineage_attestation_id
       and attestation.evidence_digest = permit.lineage_evidence_digest
      join sellerpilot_private.channel_gateway_jobs source_job
        on source_job.id = attestation.gateway_job_id
       and source_job.status = 'succeeded'
       and source_job.request_payload#>>'{arguments,marketplaceSku}' =
             'QA-20260823-CC-001-MY'
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = listing.operation_attempt_id
       and attempt.owner_id = permit.owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.channel = 'lazada' and attempt.operation = 'listing.update'
       and attempt.status = 'running'
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = permit.request_fingerprint
      join sellerpilot_private.channel_gateway_jobs job
        on job.attempt_id = attempt.id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.channel = 'lazada' and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.status in ('queued','running')
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and job.completed_at is null and job.response_payload is null
       and job.error_message is null
     where permit.permit_id = p_permit_id
       and permit.channel = 'lazada'
       and permit.invalidated_at is null and permit.expires_at > statement_timestamp()
       and permit.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and permit.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and permit.listing_id = '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
       and permit.remote_id = '14976038919'
       and permit.currency = 'MYR' and permit.price > 0 and permit.stock = 1
       and permit.snapshot_revision = product.detail_page_version
       and permit.snapshot_payload_sha256 =
             product.detail_page_image_manifest->>'digest'
       and product.detail_page_version = product.detail_page_approved_version
       and product.detail_page_image_manifest->>'digest' =
             job.request_payload#>>'{arguments,sellerpilotLazadaExactExistingUpdate,approvedManifestDigest}'
       and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
       and listing.status = 'queued' and listing.failure_class is null
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
       and listing.provider_status is null and listing.published_at is null
       and job.request_payload#>>'{arguments,sellerpilotLazadaExactExistingUpdate,listingId}' =
             permit.listing_id::text
       and job.request_payload#>>'{arguments,sellerpilotLazadaExactExistingUpdate,credentialId}' =
             permit.credential_id::text
       and job.request_payload#>>'{arguments,sellerpilotLazadaExactExistingUpdate,sellerAccountKey}' =
             permit.seller_account_key
       and job.request_payload#>>'{arguments,sellerpilotLazadaExactExistingUpdate,lineageAttestationId}' =
             attestation.id::text
       and job.request_payload#>>'{arguments,sellerpilotLazadaExactExistingUpdate,lineageEvidenceDigest}' =
             attestation.evidence_digest
       and (
         (permit.update_job_id is null and permit.update_attempt_id is null)
         or (permit.update_job_id = job.id and permit.update_attempt_id = attempt.id)
       )
       and sellerpilot_private.lazada_exact_update_arguments_valid(
             job.request_payload->'arguments',permit.release_sha,
             permit.request_fingerprint,permit.price,permit.stock
           )
       and sellerpilot_private.exact_existing_update_release_is_current(
             'lazada',permit.release_sha
           )
  ) else sellerpilot_private.exact_existing_update_enqueued_before_lazada_173980(
    p_permit_id
  ) end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_enqueued_before_lazada_173980(uuid),
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_lazada_exact_update_id(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
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
  v_result jsonb;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'contract','lazada_exact_existing_my_live_update_v1',
    'productId',product.id,
    'listingId',listing.id,
    'credentialId',credential.id,
    'itemId',listing.remote_id,
    'sellerSku','QA-20260823-CC-001-MY',
    'sellerAccountKey',listing.seller_account_key,
    'targetId',listing.target_id,
    'lineageAttestationId',attestation.id,
    'lineageEvidenceDigest',attestation.evidence_digest
  ) into v_result
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.created_by = listing.owner_id
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.seller_account_key = listing.seller_account_key
    join sellerpilot_private.channel_market_targets target
      on target.owner_id = listing.owner_id
     and target.credential_id = credential.id
     and target.channel = 'lazada' and target.environment = 'production'
     and target.market_code = 'MY' and target.target_id = listing.target_id
     and target.locale = 'ms-MY' and target.currency = 'MYR'
     and lower(trim(target.remote_status)) in ('active','live','enabled')
    join sellerpilot_private.provider_listing_lineage_attestations attestation
      on attestation.listing_id = listing.id
     and attestation.credential_id = credential.id
     and attestation.seller_account_key = listing.seller_account_key
     and attestation.channel = 'lazada'
     and attestation.environment = 'production'
     and attestation.expected_remote_id = listing.remote_id
     and attestation.verified_remote_id = listing.remote_id
     and upper(trim(attestation.market)) = 'MY'
     and attestation.target_id = listing.target_id
     and attestation.evidence_version = 'provider_listing_readback_v1'
     and attestation.evidence_digest ~ '^[a-f0-9]{64}$'
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = attestation.gateway_job_id
     and source_job.status = 'succeeded'
     and source_job.channel = 'lazada'
     and source_job.operation = 'listing.lineage.verify'
     and source_job.request_payload#>>'{arguments,marketplaceSku}' =
           'QA-20260823-CC-001-MY'
   where listing.id = p_listing_id
     and listing.id = '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
     and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and listing.product_id = p_product_id
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.channel_key = 'lazada'
     and upper(trim(listing.market)) = p_market and p_market = 'MY'
     and listing.target_id = p_target_id and p_target_id ~ '^\d+$'
     and listing.remote_id = '14976038919'
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null and listing.published_at is null
     and listing.seller_account_key ~ '^[a-f0-9]{64}$'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1 and not product.demo
     and product.status <> 'archived'
     and product.detail_page_version = product.detail_page_approved_version
     and product.detail_page_version > 0
     and product.detail_page_image_manifest->>'contract' =
           'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
     and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
     and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
     and credential.version > 0
     and credential.fingerprint ~ '^[A-F0-9]{12}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.expires_at > statement_timestamp()
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
     and (
       select count(*) from sellerpilot_private.channel_credentials competing
       join sellerpilot_private.channel_market_targets competing_target
         on competing_target.owner_id = listing.owner_id
        and competing_target.credential_id = competing.id
        and competing_target.channel = 'lazada'
        and competing_target.environment = 'production'
        and competing_target.market_code = 'MY'
        and competing_target.locale = 'ms-MY'
        and competing_target.currency = 'MYR'
        and lower(trim(competing_target.remote_status)) in ('active','live','enabled')
      where competing.created_by = listing.owner_id
        and competing.channel = 'lazada'
        and competing.environment = 'production'
        and competing.status = 'active'
        and competing.seller_account_key_source = 'provider_certified_v1'
        and competing.expires_at > statement_timestamp()
     ) = 1
     and not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = listing.id
          and job.operation in (
            'listing.create','listing.update','listing.stop','listing.lineage.verify'
          )
          and job.status in ('queued','running','reconciliation_required')
     )
   limit 1;
  return v_result;
exception when others then
  return null;
end;
$$;

revoke all on function public.sellerpilot_service_get_lazada_exact_update_id(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_lazada_exact_update_id(
  uuid,uuid,uuid,text,text
) to service_role;

create function public.sellerpilot_service_arm_lazada_exact_update(
  p_channel text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text,
  p_target_price_myr numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_attestation sellerpilot_private.provider_listing_lineage_attestations%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917398001);
  if p_channel is distinct from 'lazada'
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_target_price_myr <= 0 or p_target_price_myr > 999999999
     or trunc(p_target_price_myr,2) <> p_target_price_myr
     or not sellerpilot_private.exact_existing_update_release_is_current(
       'lazada',p_release_sha
     ) then
    raise exception 'Lazada exact update permit identity invalid'
      using errcode = '55000';
  end if;
  select * into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id for share;
  select * into strict v_product
    from sellerpilot_private.products product
   where product.id = v_listing.product_id for share;
  select * into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id for share;
  select * into strict v_attestation
    from sellerpilot_private.provider_listing_lineage_attestations attestation
   where attestation.listing_id = p_listing_id
     and attestation.credential_id = p_credential_id for share;
  v_identity := public.sellerpilot_service_get_lazada_exact_update_id(
    p_listing_id,p_credential_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'MY',v_listing.target_id
  );
  if v_identity->>'contract' is distinct from
       'lazada_exact_existing_my_live_update_v1'
     or v_identity->>'lineageAttestationId' is distinct from
       v_attestation.id::text
     or v_identity->>'lineageEvidenceDigest' is distinct from
       v_attestation.evidence_digest then
    raise exception 'Lazada exact update lineage invalid'
      using errcode = '55000';
  end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.channel = 'lazada'
     and permit.listing_id = p_listing_id
     and permit.update_job_id is null and permit.invalidated_at is null
     and permit.expires_at <= v_now;

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.channel = 'lazada'
     and permit.listing_id = p_listing_id
     and permit.invalidated_at is null for update;
  if found then
    if v_permit.credential_id = p_credential_id
       and v_permit.release_sha = p_release_sha
       and v_permit.request_fingerprint = p_request_fingerprint
       and v_permit.price = p_target_price_myr
       and v_permit.update_job_id is null
       and v_permit.bound_at is null and v_permit.consumed_at is null
       and v_permit.expires_at > v_now then
      return jsonb_build_object(
        'contract','exact_existing_update_permit_v1',
        'permitId',v_permit.permit_id,'channel','lazada',
        'listingId',v_permit.listing_id,'releaseSha',v_permit.release_sha,
        'requestFingerprint',v_permit.request_fingerprint,
        'armedAt',v_permit.armed_at,'expiresAt',v_permit.expires_at,
        'bound',false,'reused',true
      );
    end if;
    raise exception 'Lazada exact update already has a different active permit'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.exact_existing_update_permits (
    channel,listing_id,product_id,credential_id,owner_id,
    market,target_id,remote_id,seller_sku,provider_resource_id,
    currency,price,stock,seller_account_key,
    credential_version,credential_fingerprint,credential_account_source,
    credential_verified_at,credential_expires_at,credential_last_checked_at,
    credential_last_check_status,snapshot_revision,snapshot_payload_sha256,
    snapshot_source_job_id,lineage_attestation_id,lineage_evidence_digest,
    release_sha,request_fingerprint,armed_at,expires_at
  ) values (
    'lazada',v_listing.id,v_product.id,v_credential.id,v_listing.owner_id,
    'MY',v_listing.target_id,'14976038919','QA-20260823-CC-001',null,
    'MYR',p_target_price_myr,1,v_listing.seller_account_key,
    v_credential.version,v_credential.fingerprint,
    v_credential.seller_account_key_source,
    v_credential.seller_account_verified_at,v_credential.expires_at,
    v_credential.last_checked_at,v_credential.last_check_status,
    v_product.detail_page_version,
    v_product.detail_page_image_manifest->>'digest',
    v_attestation.gateway_job_id,v_attestation.id,v_attestation.evidence_digest,
    p_release_sha,p_request_fingerprint,v_now,v_now + interval '5 minutes'
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract','exact_existing_update_permit_v1',
    'permitId',v_permit.permit_id,'channel','lazada',
    'listingId',v_permit.listing_id,'releaseSha',v_permit.release_sha,
    'requestFingerprint',v_permit.request_fingerprint,
    'armedAt',v_permit.armed_at,'expiresAt',v_permit.expires_at,
    'bound',false,'reused',false
  );
end;
$$;

revoke all on function public.sellerpilot_service_arm_lazada_exact_update(
  text,uuid,uuid,text,text,numeric
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_arm_lazada_exact_update(
  text,uuid,uuid,text,text,numeric
) to service_role;

alter function
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid,uuid,uuid,text,text,jsonb
  ) rename to exact_existing_update_enqueue_before_lazada_173980;

create function sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
begin
  if p_channel <> 'lazada' then
    return sellerpilot_private.exact_existing_update_enqueue_before_lazada_173980(
      p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
      p_request_payload
    );
  end if;
  return coalesce(
    p_operation = 'listing.update'
    and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,contract}' =
          'lazada_exact_existing_my_live_update_v1'
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.channel = 'lazada'
         and permit.listing_id = p_listing_id
         and permit.credential_id = p_credential_id
         and permit.request_fingerprint = attempt.request_fingerprint
         and permit.update_job_id is null and permit.update_attempt_id is null
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
         and permit.price =
               (v_arguments#>>'{sellerpilotLazadaPricePolicy,targetPriceMyr}')::numeric
         and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,listingId}' =
               permit.listing_id::text
         and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,credentialId}' =
               permit.credential_id::text
         and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,sellerAccountKey}' =
               permit.seller_account_key
         and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,lineageAttestationId}' =
               permit.lineage_attestation_id::text
         and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,lineageEvidenceDigest}' =
               permit.lineage_evidence_digest
         and v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,approvedManifestDigest}' =
               permit.snapshot_payload_sha256
         and sellerpilot_private.exact_existing_update_lineage_is_current(
               permit.permit_id
             )
         and sellerpilot_private.lazada_exact_update_arguments_valid(
               v_arguments,permit.release_sha,permit.request_fingerprint,
               permit.price,permit.stock
             )
       where attempt.id = p_attempt_id
         and attempt.owner_id = permit.owner_id
         and attempt.credential_id = permit.credential_id
         and attempt.channel = 'lazada'
         and attempt.operation = 'listing.update'
         and attempt.status = 'running'
         and attempt.seller_account_key = permit.seller_account_key
         and attempt.request_fingerprint = permit.request_fingerprint
    ), false
  );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_enqueue_before_lazada_173980(
    uuid,uuid,uuid,text,text,jsonb
  ),
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid,uuid,uuid,text,text,jsonb
  ) from public, anon, authenticated, service_role;

alter function sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)
  rename to bind_exact_existing_update_claim_before_lazada_173980;

create function sellerpilot_private.bind_exact_existing_update_claim(
  p_old jsonb,p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_old->>'channel' <> 'lazada' then
    return sellerpilot_private.bind_exact_existing_update_claim_before_lazada_173980(
      p_old,p_new
    );
  end if;
  if jsonb_typeof(p_old) <> 'object' or jsonb_typeof(p_new) <> 'object'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' <> 'queued' or p_new->>'status' <> 'running'
     or p_new->>'channel' <> 'lazada'
     or p_old->>'operation' <> 'listing.update'
     or p_new->>'operation' <> 'listing.update'
     or (p_old->>'attempt_count')::integer <> 0
     or (p_new->>'attempt_count')::integer <> 1
     or p_old->'worker_token_id' <> 'null'::jsonb
     or p_old->'claim_token' <> 'null'::jsonb
     or p_new->'worker_token_id' = 'null'::jsonb
     or p_new->'claim_token' = 'null'::jsonb
     or p_old->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'completed_at' <> 'null'::jsonb
     or p_new->'response_payload' <> 'null'::jsonb
     or p_new->'error_message' <> 'null'::jsonb
     or (p_new->>'lease_expires_at')::timestamptz <= statement_timestamp()
     or p_new-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
        is distinct from
        p_old-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
  then return false; end if;
  v_job_id := (p_new->>'id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = (p_new->>'worker_token_id')::uuid,
         bound_claim_token = (p_new->>'claim_token')::uuid
   where permit.update_job_id = v_job_id
     and permit.update_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.channel = 'lazada'
     and permit.listing_id = (p_new->>'listing_id')::uuid
     and permit.credential_id = (p_new->>'credential_id')::uuid
     and permit.seller_account_key = p_new->>'seller_account_key'
     and permit.request_fingerprint = p_new->>'request_fingerprint'
     and permit.request_payload_sha256 = encode(
           extensions.digest((p_new->'request_payload')::text,'sha256'),'hex'
         )
     and permit.request_payload_bytes = octet_length(
           (p_new->'request_payload')::text
         )
     and permit.invalidated_at is null and permit.consumed_at is null
     and permit.bound_at is null and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         );
  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.bind_exact_existing_update_claim_before_lazada_173980(
    jsonb,jsonb
  ),
  sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)
  from public, anon, authenticated, service_role;

alter function sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)
  rename to exact_existing_update_provider_before_lazada_173980;

create function sellerpilot_private.exact_existing_update_provider_allowed(
  p_job_id uuid,p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id and permit.channel = 'lazada'
  ) then exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.update_job_id
     where permit.update_job_id = p_job_id and permit.channel = 'lazada'
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_at is not null and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
             permit.permit_id
           )
       and job.status = 'running' and job.channel = 'lazada'
       and job.operation = 'listing.update' and job.environment = 'production'
       and job.claim_token = p_claim_token and job.attempt_count = 1
       and job.started_at is not null
       and job.lease_expires_at > statement_timestamp()
       and job.completed_at is null and job.response_payload is null
       and job.error_message is null
       and job.provider_mutation_started_at is null
       and job.attempt_id = permit.update_attempt_id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and permit.arguments_sha256 = encode(
             extensions.digest((job.request_payload->'arguments')::text,'sha256'),
             'hex'
           )
       and permit.request_payload_sha256 = encode(
             extensions.digest(job.request_payload::text,'sha256'),'hex'
           )
       and sellerpilot_private.lazada_exact_update_arguments_valid(
             job.request_payload->'arguments',permit.release_sha,
             permit.request_fingerprint,permit.price,permit.stock
           )
  ) else sellerpilot_private.exact_existing_update_provider_before_lazada_173980(
    p_job_id,p_claim_token
  ) end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_provider_before_lazada_173980(uuid,uuid),
  sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)
  from public, anon, authenticated, service_role;

do $patch_lazada_exact_job_guard$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure;
  v_definition text;
  v_marker_anchor constant text :=
    'or coalesce(v_arguments ? ''sellerpilotTemuExactExistingUpdate'', false);';
  v_marker_replacement constant text :=
    'or coalesce(v_arguments ? ''sellerpilotTemuExactExistingUpdate'', false)'
    || E'\n    or coalesce(v_arguments ? ''sellerpilotLazadaExactExistingUpdate'', false);';
  v_channel_anchor constant text :=
    'v_job.channel not in (''coupang'', ''elevenst'', ''ebay'', ''temu'')';
  v_channel_replacement constant text :=
    'v_job.channel not in (''coupang'', ''elevenst'', ''ebay'', ''temu'', ''lazada'')';
begin
  select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition,v_marker_anchor,''))
  ) / pg_catalog.length(v_marker_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition,v_channel_anchor,''))
     ) / pg_catalog.length(v_channel_anchor) <> 1 then
    raise exception 'Lazada exact job guard preimage drifted'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,v_marker_anchor,v_marker_replacement
  );
  execute pg_catalog.replace(
    v_definition,v_channel_anchor,v_channel_replacement
  );
end;
$patch_lazada_exact_job_guard$;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
) rename to sellerpilot_173980_enqueue_before_lazada_exact;

revoke all on function public.sellerpilot_173980_enqueue_before_lazada_exact(
  uuid,uuid,uuid,text,text,jsonb
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  if p_channel <> 'lazada'
     or p_operation <> 'listing.update'
     or v_arguments#>>'{sellerpilotLazadaExactExistingUpdate,contract}' <>
          'lazada_exact_existing_my_live_update_v1' then
    return public.sellerpilot_173980_enqueue_before_lazada_exact(
      p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
      p_request_payload
    );
  end if;
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917398001);
  select * into strict v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.channel = 'lazada'
     and permit.listing_id = p_listing_id
     and permit.credential_id = p_credential_id
     and permit.update_job_id is null and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and permit.price =
           (v_arguments#>>'{sellerpilotLazadaPricePolicy,targetPriceMyr}')::numeric
     and permit.snapshot_payload_sha256 = v_arguments#>>
           '{sellerpilotLazadaExactExistingUpdate,approvedManifestDigest}'
     and permit.lineage_attestation_id::text = v_arguments#>>
           '{sellerpilotLazadaExactExistingUpdate,lineageAttestationId}'
     and permit.lineage_evidence_digest = v_arguments#>>
           '{sellerpilotLazadaExactExistingUpdate,lineageEvidenceDigest}'
     and sellerpilot_private.exact_existing_update_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.lazada_exact_update_arguments_valid(
           v_arguments,permit.release_sha,permit.request_fingerprint,
           permit.price,permit.stock
         )
     and exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = p_attempt_id
          and attempt.owner_id = permit.owner_id
          and attempt.credential_id = permit.credential_id
          and attempt.channel = 'lazada'
          and attempt.operation = 'listing.update'
          and attempt.status = 'running'
          and attempt.seller_account_key = permit.seller_account_key
          and attempt.request_fingerprint = permit.request_fingerprint
     ) for update;

  v_result := public.sellerpilot_173980_enqueue_before_lazada_exact(
    p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
    p_request_payload
  );
  if coalesce(v_result->>'job_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_result->>'status' <> 'queued' then
    raise exception 'Lazada exact update job not newly queued'
      using errcode = '55000';
  end if;
  v_job_id := (v_result->>'job_id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set update_job_id = v_job_id,
         update_attempt_id = p_attempt_id,
         arguments_sha256 = encode(
           extensions.digest(v_arguments::text,'sha256'),'hex'
         ),
         arguments_bytes = octet_length(v_arguments::text),
         request_payload_sha256 = encode(
           extensions.digest(p_request_payload::text,'sha256'),'hex'
         ),
         request_payload_bytes = octet_length(p_request_payload::text)
   where permit.permit_id = v_permit.permit_id
     and permit.update_job_id is null and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = v_job_id and job.attempt_id = p_attempt_id
          and job.listing_id = permit.listing_id
          and job.credential_id = permit.credential_id
          and job.channel = 'lazada' and job.operation = 'listing.update'
          and job.environment = 'production' and job.status = 'queued'
          and job.attempt_count = 0
          and job.seller_account_key = permit.seller_account_key
          and job.request_fingerprint = permit.request_fingerprint
          and job.request_payload = p_request_payload
          and job.provider_mutation_started_at is null
          and job.response_payload is null and job.completed_at is null
     );
  if not found then
    raise exception 'Lazada exact update job binding failed'
      using errcode = '55000';
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
) to service_role;

create function sellerpilot_private.lazada_exact_update_response_valid(
  p_job_id uuid,p_response jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_verified_at timestamptz;
  v_representative text;
  v_details jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.channel = 'lazada' and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.provider_mutation_started_at is not null
     and (
       (job.status = 'running' and job.completed_at is null
         and job.response_payload is null)
       or (job.status = 'succeeded' and job.completed_at is not null
         and job.response_payload = p_response)
     );
  if not found or jsonb_typeof(p_response) <> 'object' then return false; end if;
  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.update_job_id = v_job.id
     and permit.channel = 'lazada'
     and permit.consumed_at is not null
     and (
       (v_job.status = 'running'
         and permit.bound_worker_token_id = v_job.worker_token_id
         and permit.bound_claim_token = v_job.claim_token)
       or (v_job.status = 'succeeded' and exists (
         select 1 from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = v_job.id
            and receipt.worker_token_id = permit.bound_worker_token_id
            and receipt.claim_token = permit.bound_claim_token
       ))
     );
  if not found then return false; end if;
  begin
    v_verified_at := (p_response#>>'{remoteState,verifiedAt}')::timestamptz;
  exception when others then return false; end;
  v_representative := p_response#>>
    '{remoteState,resources,representativeImageUrl}';
  v_details := p_response#>'{remoteState,resources,detailImageUrls}';
  return p_response->>'ok' = 'true'
    and p_response->>'channel' = 'lazada'
    and p_response->>'operation' = 'listing.update'
    and p_response->>'publicationIntent' = 'live'
    and (
      (v_job.status = 'running'
        and p_response->>'publicationFulfilled' = 'true'
        and p_response#>>'{remoteState,visibility}' = 'live')
      or (v_job.status = 'succeeded'
        and p_response->>'publicationFulfilled' = 'false'
        and p_response#>>'{remoteState,visibility}' = 'pending_review'
        and p_response#>>'{remoteState,evidence,providerObservedVisibility}' =
              'live')
    )
    and p_response->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_response->>'remoteId' = '14976038919'
    and p_response#>>'{remoteState,verified}' = 'true'
    and p_response#>>'{remoteState,providerStatus}' in ('ACTIVE','LIVE','ONLINE')
    and p_response#>>'{remoteState,locale}' = 'ms-MY'
    and p_response#>>'{remoteState,fingerprint}' = v_job.request_fingerprint
    and p_response#>>'{remoteState,imageCount}' = '8'
    and p_response#>>'{remoteState,resources,itemId}' = '14976038919'
    and p_response#>>'{remoteState,resources,skuId}' ~ '^\d+$'
    and p_response#>>'{remoteState,resources,sellerSku}' =
          'QA-20260823-CC-001-MY'
    and p_response#>>'{remoteState,resources,country}' = 'my'
    and p_response#>>'{remoteState,resources,currency}' = 'MYR'
    and (p_response#>>'{remoteState,resources,price}')::numeric = v_permit.price
    and (p_response#>>'{remoteState,resources,stock}')::integer = 1
    and p_response#>>'{remoteState,resources,categoryId}' ~ '^\d+$'
    and v_representative ~ '^https://'
    and jsonb_typeof(v_details) = 'array'
    and jsonb_array_length(v_details) = 8
    and (select count(distinct value)
           from jsonb_array_elements_text(v_details)) = 8
    and not (v_details ? v_representative)
    and not exists (
      select 1 from jsonb_array_elements_text(v_details) detail(value)
       where value !~ '^https://'
    )
    and p_response#>>'{remoteState,evidence,version}' =
          'lazada_exact_my_update_readback_v1'
    and not exists (
      select 1 from (values
        ('identityVerified'),('statusVerified'),('localeVerified'),
        ('fingerprintVerified'),('imageCountVerified'),('categoryVerified'),
        ('commerceVerified'),('contentVerified'),('sellerSkuVerified'),
        ('skuIdVerified'),('priceVerified'),('stockVerified'),
        ('activeStatusVerified'),('titleLanguageVerified'),
        ('descriptionLanguageVerified'),('representativeImageVerified'),
        ('detailImagesVerified'),('categoryAttributesVerified')
      ) expected(key)
      where p_response#>>array['remoteState','evidence',expected.key] <> 'true'
    )
    and p_response#>>'{remoteState,evidence,observedRepresentativeImageCount}' = '1'
    and p_response#>>'{remoteState,evidence,observedDetailImageCount}' = '8'
    and p_response#>>'{remoteState,evidence,preflightSkuId}' =
          p_response#>>'{remoteState,resources,skuId}'
    and p_response#>>'{remoteState,evidence,representativeImageDigest}' =
          encode(extensions.digest(
            pg_catalog.jsonb_build_array(v_representative)::text,'sha256'
          ),'hex')
    and p_response#>>'{remoteState,evidence,orderedDetailImageDigest}' = (
      select encode(extensions.digest(
        '[' || string_agg(pg_catalog.to_json(value)::text,',' order by ordinal) || ']',
        'sha256'
      ),'hex')
        from jsonb_array_elements_text(v_details)
               with ordinality detail(value,ordinal)
    )
    and p_response#>>'{remoteState,evidence,titleDigest}' = encode(
      extensions.digest(trim(v_job.request_payload#>>
        '{arguments,request,Request,Product,Attributes,name}'),'sha256'),'hex'
    )
    and p_response#>>'{remoteState,evidence,descriptionDigest}' = encode(
      extensions.digest(trim(v_job.request_payload#>>
        '{arguments,request,Request,Product,Attributes,description}'),'sha256'),'hex'
    )
    and v_verified_at >= v_job.provider_mutation_started_at
    and v_verified_at <= clock_timestamp() + interval '5 minutes';
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.lazada_exact_update_response_valid(
  uuid,jsonb
) from public, anon, authenticated, service_role;

create function sellerpilot_private.lazada_exact_update_remote_resources(
  p_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'resources',job.response_payload#>'{remoteState,resources}',
    'verification',jsonb_build_object(
      'contract','lazada_exact_existing_my_live_update_v1',
      'jobId',job.id,
      'verifiedAt',job.response_payload#>>'{remoteState,verifiedAt}',
      'evidence',job.response_payload#>'{remoteState,evidence}',
      'locale','ms-MY',
      'fingerprint',job.request_fingerprint,
      'imageCount',8,
      'country','my','currency','MYR',
      'price',(job.response_payload#>>'{remoteState,resources,price}')::numeric,
      'stock',1,'representativeImageCount',1,'detailImageCount',8
    )
  )
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.update_job_id=job.id and permit.channel='lazada'
   where job.id=p_job_id and job.status='succeeded'
     and permit.consumed_at is not null
     and sellerpilot_private.lazada_exact_update_response_valid(
           job.id,job.response_payload
         )
$$;

revoke all on function
  sellerpilot_private.lazada_exact_update_remote_resources(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.lazada_exact_listing_projection_allowed(
  p_old jsonb,p_new jsonb,p_job_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_allowed text[] := array[
    'remote_id','status','requested_publication_intent','remote_visibility',
    'provider_status','remote_resources','remote_created_at','published_at',
    'last_verified_at','last_error','failure_class','operation_attempt_id',
    'updated_at'
  ];
begin
  if p_job_id !~ '^[0-9a-fA-F-]{36}$'
     or jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object' then return false; end if;
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id::uuid and job.channel='lazada'
     and job.operation='listing.update' and job.environment='production'
     and job.status='succeeded' and job.completed_at is not null;
  if not found then return false; end if;
  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.update_job_id=v_job.id and permit.channel='lazada'
     and permit.consumed_at is not null;
  return found
    and (p_new-v_allowed) is not distinct from (p_old-v_allowed)
    and p_new->>'id' = '42021335-9793-4834-8cd5-b73169fd1f48'
    and p_new->>'id' = v_job.listing_id::text
    and p_new->>'seller_account_key' = v_job.seller_account_key
    and p_new->>'remote_id' = '14976038919'
    and p_new->>'status' = 'published'
    and p_new->>'requested_publication_intent' = 'live'
    and p_new->>'remote_visibility' = 'live'
    and p_new->>'provider_status' in ('ACTIVE','LIVE','ONLINE')
    and p_new->>'operation_attempt_id' = v_job.attempt_id::text
    and p_new->'last_error' = 'null'::jsonb
    and p_new->'failure_class' = 'null'::jsonb
    and p_new->'remote_resources' =
          sellerpilot_private.lazada_exact_update_remote_resources(v_job.id)
    and p_new#>>'{remote_resources,resources,itemId}' = '14976038919'
    and p_new#>>'{remote_resources,resources,skuId}' =
          v_job.response_payload#>>'{remoteState,evidence,preflightSkuId}'
    and p_new#>>'{remote_resources,resources,sellerSku}' =
          'QA-20260823-CC-001-MY'
    and p_new#>>'{remote_resources,resources,country}' = 'my'
    and p_new#>>'{remote_resources,resources,currency}' = 'MYR'
    and (p_new#>>'{remote_resources,resources,price}')::numeric = v_permit.price
    and (p_new#>>'{remote_resources,resources,stock}')::integer = 1
    and sellerpilot_private.lazada_exact_update_response_valid(
          v_job.id,v_job.response_payload
        );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.lazada_exact_listing_projection_allowed(jsonb,jsonb,text)
  from public, anon, authenticated, service_role;

do $patch_lazada_exact_listing_projection_guard$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure;
  v_definition text;
  v_anchor constant text :=
    'if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
  v_replacement constant text := $replacement$if nullif(current_setting('sellerpilot.lazada_exact_update_apply', true), '') is not null then
    if not sellerpilot_private.lazada_exact_listing_projection_allowed(
      to_jsonb(old),to_jsonb(new),
      current_setting('sellerpilot.lazada_exact_update_apply', true)
    ) then
      raise exception 'invalid Lazada exact listing projection';
    end if;
    return new;
  end if;

  if nullif(current_setting('sellerpilot.temu_publication_apply', true), '') is not null then$replacement$;
begin
  select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition,v_anchor,''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'Lazada exact listing guard preimage drifted'
      using errcode='55000';
  end if;
  execute pg_catalog.replace(v_definition,v_anchor,v_replacement);
end;
$patch_lazada_exact_listing_projection_guard$;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_173980_complete_before_lazada_exact;

revoke all on function public.sellerpilot_173980_complete_before_lazada_exact(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_exact boolean := false;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
begin
  select exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id and permit.channel = 'lazada'
  ) into v_exact;
  if p_status = 'succeeded' and v_exact
     and not sellerpilot_private.lazada_exact_update_response_valid(
       p_job_id,p_response_payload
     ) then
    raise exception 'invalid exact Lazada update completion attestation'
      using errcode = '55000';
  end if;
  v_result := public.sellerpilot_173980_complete_before_lazada_exact(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    p_error_message,p_credential_refresh,p_normalized_orders,
    p_normalized_inquiries,p_diagnostic
  );
  if v_exact and v_result->>'status' in ('completed','completed_replay') then
    select * into v_job
      from sellerpilot_private.channel_gateway_jobs job where job.id = p_job_id;
    select * into v_permit
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id and permit.channel = 'lazada';
    if v_job.status = 'succeeded' then
      if not sellerpilot_private.lazada_exact_update_response_valid(
           p_job_id,v_job.response_payload
         )
         or v_permit.consumed_at is null then
        raise exception 'persisted exact Lazada update attestation invalid'
          using errcode = '55000';
      end if;
      perform pg_catalog.set_config(
        'sellerpilot.lazada_exact_update_apply',p_job_id::text,true
      );
      update sellerpilot_private.product_listings listing
         set remote_id='14976038919',status='published',
             requested_publication_intent='live',remote_visibility='live',
             provider_status=v_job.response_payload#>>'{remoteState,providerStatus}',
             remote_resources=
               sellerpilot_private.lazada_exact_update_remote_resources(p_job_id),
             published_at=coalesce(
               listing.published_at,
               (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz
             ),
             last_verified_at=
               (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,
             last_error=null,failure_class=null,
             operation_attempt_id=v_job.attempt_id,updated_at=clock_timestamp()
       where listing.id=v_job.listing_id;
      if not found then
        raise exception 'exact Lazada listing projection failed'
          using errcode = '55000';
      end if;
      select * into strict v_listing
        from sellerpilot_private.product_listings listing
       where listing.id = v_job.listing_id;
      if v_listing.status <> 'published'
         or v_listing.remote_id <> '14976038919'
         or v_listing.requested_publication_intent <> 'live'
         or v_listing.remote_visibility <> 'live'
         or v_listing.provider_status not in ('ACTIVE','LIVE','ONLINE')
         or v_listing.failure_class is not null
         or v_listing.last_error is not null
         or v_listing.operation_attempt_id is distinct from v_job.attempt_id
         or v_listing.remote_resources#>>'{resources,itemId}' <> '14976038919'
         or v_listing.remote_resources#>>'{resources,skuId}' !~ '^\d+$'
         or v_listing.remote_resources#>>'{resources,sellerSku}' <>
              'QA-20260823-CC-001-MY'
         or v_listing.remote_resources#>>'{resources,country}' <> 'my'
         or v_listing.remote_resources#>>'{resources,currency}' <> 'MYR'
         or (v_listing.remote_resources#>>'{resources,price}')::numeric <>
              v_permit.price
         or (v_listing.remote_resources#>>'{resources,stock}')::integer <> 1
         or not exists (
           select 1 from sellerpilot_private.gateway_completion_receipts receipt
            where receipt.job_id = p_job_id
              and receipt.worker_token_id = v_permit.bound_worker_token_id
              and receipt.claim_token = v_permit.bound_claim_token
         ) then
        raise exception 'persisted exact Lazada update attestation invalid'
          using errcode = '55000';
      end if;
    elsif v_permit.consumed_at is not null
       and v_job.status not in ('reconciliation_required','failed') then
      raise exception 'ambiguous exact Lazada update was not fenced'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

do $lazada_exact_update_postimage$
declare
  v_name text;
  v_signature regprocedure;
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  foreach v_name in array array[
    'sellerpilot_service_get_lazada_exact_update_id',
    'sellerpilot_service_arm_lazada_exact_update'
  ] loop
    if octet_length(v_name) > 63 then
      raise exception 'Lazada public RPC exceeds PostgreSQL identifier limit'
        using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'public.sellerpilot_service_get_lazada_exact_update_id(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.sellerpilot_service_arm_lazada_exact_update(text,uuid,uuid,text,text,numeric)'::regprocedure,
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_catalog.pg_get_userbyid(proc.proowner),proc.prosecdef,
           proc.proconfig,pg_catalog.pg_get_functiondef(proc.oid)
      into v_owner,v_security_definer,v_config,v_definition
      from pg_catalog.pg_proc proc where proc.oid = v_signature;
    if v_owner is distinct from 'postgres'
       or v_security_definer is distinct from true
       or v_config is distinct from array['search_path=""']::text[]
       or pg_catalog.has_function_privilege('public',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
       or not pg_catalog.has_function_privilege(
         'service_role',v_signature,'EXECUTE'
       ) then
      raise exception 'Lazada exact public RPC postimage invalid: %',v_signature
        using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'sellerpilot_private.lazada_exact_update_arguments_valid(jsonb,text,text,numeric,integer)'::regprocedure,
    'sellerpilot_private.lazada_exact_update_response_valid(uuid,jsonb)'::regprocedure,
    'sellerpilot_private.lazada_exact_update_remote_resources(uuid)'::regprocedure,
    'sellerpilot_private.lazada_exact_listing_projection_allowed(jsonb,jsonb,text)'::regprocedure,
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure,
    'sellerpilot_private.exact_existing_update_release_is_current(text,text)'::regprocedure,
    'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure
  ] loop
    select pg_catalog.pg_get_userbyid(proc.proowner),proc.proconfig,
           pg_catalog.pg_get_functiondef(proc.oid)
      into v_owner,v_config,v_definition
      from pg_catalog.pg_proc proc where proc.oid = v_signature;
    if v_owner is distinct from 'postgres'
       or v_config is distinct from array['search_path=""']::text[]
       or pg_catalog.has_function_privilege('public',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_signature,'EXECUTE')
       or pg_catalog.strpos(v_definition,'lazada') = 0 then
      raise exception 'Lazada exact private helper postimage invalid: %',v_signature
        using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current('
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.exact_existing_update_lineage_is_current('
     ) > 0 then
    raise exception 'Lazada exact consume lineage phase regressed'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilotLazadaExactExistingUpdate') = 0
     or pg_catalog.strpos(
       v_definition,
       '''coupang'', ''elevenst'', ''ebay'', ''temu'', ''lazada'''
     ) = 0 then
    raise exception 'Lazada exact job guard postimage invalid'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.lazada_exact_update_apply') = 0
     or pg_catalog.strpos(
       v_definition,'sellerpilot_private.lazada_exact_listing_projection_allowed('
     ) = 0 then
    raise exception 'Lazada exact listing projection guard postimage invalid'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute attribute
     where attribute.attrelid =
           'sellerpilot_private.exact_existing_update_permits'::regclass
       and attribute.attname = 'lineage_attestation_id'
       and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute attribute
     where attribute.attrelid =
           'sellerpilot_private.exact_existing_update_permits'::regclass
       and attribute.attname = 'lineage_evidence_digest'
       and not attribute.attisdropped
  ) then
    raise exception 'Lazada exact permit lineage columns missing'
      using errcode = '55000';
  end if;
end;
$lazada_exact_update_postimage$;

notify pgrst, 'reload schema';

commit;
