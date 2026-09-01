-- Allow exactly one content update followed by exactly one stock=1 update for
-- the already-adopted Shopee SG QA item. The ordinary publication gate stays
-- closed. Each phase is bound to the current runtime SHA, one request digest,
-- one fresh provider-certified credential, one first claim, and one provider
-- mutation boundary. No listing.create or public/NORMAL transition is allowed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 911739700);

create table sellerpilot_private.shopee_sg_exact_update_permits (
  permit_id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('content', 'inventory')),
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (credential_fingerprint ~ '^[A-F0-9]{12}$'),
  credential_verified_at timestamptz not null,
  adoption_attestation_id uuid not null references sellerpilot_private.shopee_existing_adoption_attestations(id) on delete restrict,
  adoption_gateway_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  adoption_evidence_digest text not null check (adoption_evidence_digest ~ '^[a-f0-9]{64}$'),
  item_id text not null check (item_id = '53717126190'),
  marketplace_sku text not null check (marketplace_sku = 'QA-20260823-CC-001'),
  merchant_id text not null check (merchant_id = '5511564'),
  shop_id text not null check (shop_id = '1719148844'),
  market text not null check (market = 'SG'),
  locale text not null check (locale = 'en-SG'),
  currency text not null check (currency = 'SGD'),
  price numeric(14,2) not null check (price = 16.77),
  stock integer not null check (stock = 1),
  provider_status text not null check (provider_status = 'UNLIST'),
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  update_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  update_attempt_id uuid unique references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  arguments_sha256 text,
  request_payload_sha256 text,
  approved_asset_evidence jsonb,
  approved_asset_evidence_sha256 text,
  bound_at timestamptz,
  bound_worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  check (product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid),
  check (expires_at > armed_at and expires_at <= armed_at + interval '5 minutes'),
  check ((update_job_id is null) = (update_attempt_id is null)),
  check ((update_job_id is null) = (arguments_sha256 is null)),
  check ((update_job_id is null) = (request_payload_sha256 is null)),
  check ((bound_at is null) = (bound_worker_token_id is null)),
  check ((bound_at is null) = (bound_claim_token is null)),
  check (arguments_sha256 is null or arguments_sha256 ~ '^[a-f0-9]{64}$'),
  check (request_payload_sha256 is null or request_payload_sha256 ~ '^[a-f0-9]{64}$'),
  check ((approved_asset_evidence is null) = (approved_asset_evidence_sha256 is null)),
  check (approved_asset_evidence_sha256 is null or approved_asset_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  check (consumed_at is null or (bound_at is not null and consumed_at >= bound_at)),
  check ((invalidated_at is null) = (invalidation_reason is null))
);

create unique index shopee_sg_exact_one_phase_per_listing
  on sellerpilot_private.shopee_sg_exact_update_permits(listing_id, phase)
  where invalidated_at is null;

alter table sellerpilot_private.shopee_sg_exact_update_permits enable row level security;
revoke all on sellerpilot_private.shopee_sg_exact_update_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.shopee_sg_exact_update_credential_allowed(
  p_credential_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret jsonb;
  v_shop jsonb;
  v_authorization_expires_at timestamptz;
  v_access_expires_at timestamptz;
  v_shop_match boolean := false;
  v_merchant_match boolean := false;
begin
  select decrypted.decrypted_secret::jsonb
    into v_secret
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted on decrypted.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version > 0
     and credential.fingerprint ~ '^[A-F0-9]{12}$'
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > statement_timestamp());
  if not found
     or jsonb_typeof(v_secret) <> 'object'
     or v_secret->>'partner_id' <> '2031489'
     or v_secret->>'provider_account_identity_version' <> 'v1'
     or coalesce(v_secret->>'provider_account_subject', '') !~ '^shopee:(main|shop):[0-9]+$'
  then return false; end if;

  v_authorization_expires_at := nullif(v_secret->>'authorization_expires_at', '')::timestamptz;
  if v_authorization_expires_at is not null
     and v_authorization_expires_at <= statement_timestamp() + interval '10 minutes'
  then return false; end if;

  select target into v_shop
    from jsonb_array_elements(
      case when jsonb_typeof(v_secret->'shopee_targets') = 'array'
        then v_secret->'shopee_targets' else '[]'::jsonb end
    ) target
   where target->>'type' = 'shop' and target->>'id' = '1719148844'
   limit 1;
  if v_shop is not null then
    v_shop_match := length(coalesce(v_shop->>'access_token', '')) >= 8;
    v_access_expires_at := nullif(v_shop->>'access_token_expires_at', '')::timestamptz;
  elsif v_secret->>'shop_id' = '1719148844' then
    v_shop_match := length(coalesce(v_secret->>'access_token', '')) >= 8;
    v_access_expires_at := nullif(v_secret->>'access_token_expires_at', '')::timestamptz;
  end if;
  v_merchant_match := v_secret->>'merchant_id' = '5511564'
    or exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_secret->'merchant_ids') = 'array'
          then v_secret->'merchant_ids' else '[]'::jsonb end
      ) value where value#>>'{}' = '5511564'
    )
    or exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_secret->'shopee_targets') = 'array'
          then v_secret->'shopee_targets' else '[]'::jsonb end
      ) target where target->>'type' = 'merchant' and target->>'id' = '5511564'
    );
  return v_shop_match and v_merchant_match
    and v_access_expires_at > statement_timestamp() + interval '10 minutes';
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.shopee_sg_exact_approved_asset_evidence(
  p_arguments jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_binding jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_marker jsonb := p_arguments->'sellerpilotShopeeSgExistingUpdate';
  v_transport jsonb := v_binding->'providerTransportImages';
  v_details jsonb := v_binding->'approvedDetailImages';
  v_representative jsonb;
  v_detail jsonb;
  v_transport_detail jsonb;
  v_evidence jsonb;
  v_detail_evidence jsonb := '[]'::jsonb;
  v_index integer;
begin
  if jsonb_typeof(v_binding) <> 'object'
     or v_binding->>'contract' <> 'sellerpilot_publication_asset_binding_v1'
     or v_binding->>'providerImageSurface' <> 'gallery'
     or jsonb_typeof(v_transport) <> 'array'
     or jsonb_array_length(v_transport) <> 9
     or jsonb_typeof(v_details) <> 'array'
     or jsonb_array_length(v_details) <> 8
  then return null; end if;
  v_representative := v_transport->0;
  if v_representative->>'role' <> 'gallery-representative'
     or coalesce(v_representative->>'approvedObjectPath','') !~ '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
     or coalesce(v_representative->>'approvedSourceSha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(v_representative->>'contentSha256','') !~ '^[a-f0-9]{64}$'
  then return null; end if;
  for v_index in 0..7 loop
    v_detail := v_details->v_index;
    v_transport_detail := v_transport->(v_index + 1);
    if coalesce(v_detail->>'role','') !~ '^detail-[a-z0-9-]+$'
       or coalesce(v_detail->>'approvedSourceSha256','') !~ '^[a-f0-9]{64}$'
       or coalesce(v_detail->>'contentSha256','') !~ '^[a-f0-9]{64}$'
       or v_transport_detail->>'role' <> v_detail->>'role'
       or v_transport_detail->>'publicUrl' <> v_detail->>'publicUrl'
       or v_transport_detail->>'objectPath' <> v_detail->>'objectPath'
       or v_transport_detail->>'contentSha256' <> v_detail->>'contentSha256'
    then return null; end if;
    v_detail_evidence := v_detail_evidence || jsonb_build_array(jsonb_build_object(
      'role', v_detail->>'role',
      'sourceSha256', v_detail->>'approvedSourceSha256',
      'contentSha256', v_detail->>'contentSha256'
    ));
  end loop;
  if (select count(distinct item->>'role') from jsonb_array_elements(v_detail_evidence) item) <> 8
     or (select count(distinct item->>'sourceSha256') from jsonb_array_elements(
           v_detail_evidence || jsonb_build_array(jsonb_build_object(
             'sourceSha256',v_representative->>'approvedSourceSha256'
           ))
         ) item) <> 9
     or (select count(distinct item->>'contentSha256') from jsonb_array_elements(
           v_detail_evidence || jsonb_build_array(jsonb_build_object(
             'contentSha256',v_representative->>'contentSha256'
           ))
         ) item) <> 9
  then return null; end if;
  v_evidence := jsonb_build_object(
    'contract','sellerpilot_shopee_sg_exact_assets_v1',
    'representativeImage',jsonb_build_object(
      'role','gallery-representative',
      'sourceSha256',v_representative->>'approvedSourceSha256',
      'contentSha256',v_representative->>'contentSha256'
    ),
    'detailImages',v_detail_evidence
  );
  if jsonb_typeof(v_marker) <> 'object'
     or v_marker->'approvedAssetEvidence' is distinct from v_evidence
  then return null; end if;
  return v_evidence;
exception when others then return null;
end;
$$;

create function sellerpilot_private.shopee_sg_exact_asset_evidence_valid(
  p_evidence jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_representative jsonb := p_evidence->'representativeImage';
  v_details jsonb := p_evidence->'detailImages';
begin
  return coalesce(
    jsonb_typeof(p_evidence) = 'object'
    and (p_evidence - array['contract','representativeImage','detailImages']) = '{}'::jsonb
    and (select count(*) from jsonb_object_keys(p_evidence)) = 3
    and p_evidence->>'contract' = 'sellerpilot_shopee_sg_exact_assets_v1'
    and jsonb_typeof(v_representative) = 'object'
    and (v_representative - array['role','sourceSha256','contentSha256']) = '{}'::jsonb
    and v_representative->>'role' = 'gallery-representative'
    and v_representative->>'sourceSha256' ~ '^[a-f0-9]{64}$'
    and v_representative->>'contentSha256' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(v_details) = 'array'
    and jsonb_array_length(v_details) = 8
    and not exists (
      select 1 from jsonb_array_elements(v_details) detail
       where jsonb_typeof(detail) <> 'object'
          or (detail - array['role','sourceSha256','contentSha256']) <> '{}'::jsonb
          or detail->>'role' !~ '^detail-[a-z0-9-]+$'
          or detail->>'sourceSha256' !~ '^[a-f0-9]{64}$'
          or detail->>'contentSha256' !~ '^[a-f0-9]{64}$'
    )
    and (select count(distinct detail->>'role') from jsonb_array_elements(v_details) detail) = 8
    and (select count(distinct digest) from (
      select v_representative->>'sourceSha256' digest
      union all select detail->>'sourceSha256' from jsonb_array_elements(v_details) detail
    ) values) = 9
    and (select count(distinct digest) from (
      select v_representative->>'contentSha256' digest
      union all select detail->>'contentSha256' from jsonb_array_elements(v_details) detail
    ) values) = 9,
    false
  );
exception when others then return false;
end;
$$;

create function sellerpilot_private.shopee_sg_exact_content_receipt_valid(
  p_response jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_readback jsonb;
begin
  if jsonb_typeof(p_response) <> 'object'
     or p_response->>'ok' <> 'true'
     or p_response->>'remoteId' <> '53717126190'
     or p_response->>'publicationFulfilled' <> 'true'
     or p_response#>>'{remoteState,visibility}' <> 'non_public'
     or p_response#>>'{remoteState,providerStatus}' <> 'UNLIST'
     or p_response#>>'{remoteState,locale}' <> 'en-SG'
     or p_response#>>'{remoteState,imageCount}' <> '8'
     or jsonb_typeof(p_response->'steps') <> 'array'
  then return false; end if;

  select step#>'{data,sellerpilotShopeeSgExistingReadback}'
    into v_readback
    from jsonb_array_elements(p_response->'steps') step
   where step#>>'{data,sellerpilotShopeeSgExistingReadback,contract}' =
         'sellerpilot_shopee_sg_existing_content_readback_v1';
  if not found
     or (select count(*) from jsonb_array_elements(p_response->'steps') step
          where step#>>'{data,sellerpilotShopeeSgExistingReadback,contract}' =
                'sellerpilot_shopee_sg_existing_content_readback_v1') <> 1
     or jsonb_typeof(v_readback) <> 'object'
     or (select count(*) from jsonb_object_keys(v_readback)) <> 13
     or (v_readback - array[
       'contract','itemId','sku','currency','priceSgd','providerStatus','visibility',
       'providerImageIdentityDigest','representativeImageCount','detailImageCount',
       'titleLanguageVerified','descriptionLanguageVerified','approvedAssetEvidence'
     ]) <> '{}'::jsonb
  then return false; end if;

  return v_readback->>'itemId' = '53717126190'
    and v_readback->>'sku' = 'QA-20260823-CC-001'
    and v_readback->>'currency' = 'SGD'
    and (v_readback->>'priceSgd')::numeric = 16.77
    and v_readback->>'providerStatus' = 'UNLIST'
    and v_readback->>'visibility' = 'non_public'
    and v_readback->>'providerImageIdentityDigest' ~ '^[a-f0-9]{64}$'
    and (v_readback->>'representativeImageCount')::integer = 1
    and (v_readback->>'detailImageCount')::integer = 8
    and (v_readback->>'titleLanguageVerified')::boolean
    and (v_readback->>'descriptionLanguageVerified')::boolean
    and sellerpilot_private.shopee_sg_exact_asset_evidence_valid(
          v_readback->'approvedAssetEvidence'
        );
exception when others then return false;
end;
$$;

create function sellerpilot_private.shopee_sg_exact_inventory_receipt_valid(
  p_response jsonb,
  p_content_image_digest text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_readback jsonb;
begin
  if p_content_image_digest !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_response) <> 'object'
     or p_response->>'ok' <> 'true'
     or p_response->>'remoteId' <> '53717126190'
     or jsonb_typeof(p_response->'steps') <> 'array'
  then return false; end if;

  select step#>'{data,sellerpilotShopeeSgExistingReadback}'
    into v_readback
    from jsonb_array_elements(p_response->'steps') step
   where step#>>'{data,sellerpilotShopeeSgExistingReadback,contract}' =
         'sellerpilot_shopee_sg_existing_inventory_readback_v1';
  if not found
     or (select count(*) from jsonb_array_elements(p_response->'steps') step
          where step#>>'{data,sellerpilotShopeeSgExistingReadback,contract}' =
                'sellerpilot_shopee_sg_existing_inventory_readback_v1') <> 1
     or jsonb_typeof(v_readback) <> 'object'
     or (select count(*) from jsonb_object_keys(v_readback)) <> 14
     or (v_readback - array[
       'contract','itemId','sku','currency','priceSgd','stock','providerStatus',
       'visibility','providerImageIdentityDigest','representativeImageCount','detailImageCount',
       'titleLanguageVerified','descriptionLanguageVerified','approvedAssetEvidence'
     ]) <> '{}'::jsonb
  then return false; end if;

  return v_readback->>'itemId' = '53717126190'
    and v_readback->>'sku' = 'QA-20260823-CC-001'
    and v_readback->>'currency' = 'SGD'
    and (v_readback->>'priceSgd')::numeric = 16.77
    and (v_readback->>'stock')::integer = 1
    and v_readback->>'providerStatus' = 'UNLIST'
    and v_readback->>'visibility' = 'non_public'
    and v_readback->>'providerImageIdentityDigest' = p_content_image_digest
    and (v_readback->>'representativeImageCount')::integer = 1
    and (v_readback->>'detailImageCount')::integer = 8
    and (v_readback->>'titleLanguageVerified')::boolean
    and (v_readback->>'descriptionLanguageVerified')::boolean
    and sellerpilot_private.shopee_sg_exact_asset_evidence_valid(
          v_readback->'approvedAssetEvidence'
        );
exception when others then return false;
end;
$$;

create function sellerpilot_private.shopee_sg_exact_receipt_asset_evidence(
  p_response jsonb,
  p_contract text
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select step#>'{data,sellerpilotShopeeSgExistingReadback,approvedAssetEvidence}'
    from jsonb_array_elements(p_response->'steps') step
   where step#>>'{data,sellerpilotShopeeSgExistingReadback,contract}' = p_contract
   limit 1
$$;

create function sellerpilot_private.shopee_sg_exact_content_receipt_image_digest(
  p_listing_id uuid,
  p_credential_id uuid,
  p_seller_account_key text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select step#>>'{data,sellerpilotShopeeSgExistingReadback,providerImageIdentityDigest}'
    from sellerpilot_private.shopee_sg_exact_update_permits permit
    join sellerpilot_private.channel_gateway_jobs job on job.id = permit.update_job_id
    join sellerpilot_private.gateway_completion_receipts receipt on receipt.job_id = job.id
    cross join lateral jsonb_array_elements(job.response_payload->'steps') step
   where permit.phase = 'content'
     and permit.listing_id = p_listing_id
     and permit.credential_id = p_credential_id
     and permit.seller_account_key = p_seller_account_key
     and permit.invalidated_at is null
     and permit.consumed_at is not null
     and receipt.claim_token = permit.bound_claim_token
     and receipt.claim_token = job.claim_token
     and receipt.worker_token_id = permit.bound_worker_token_id
     and receipt.worker_token_id = job.worker_token_id
     and job.status = 'succeeded'
     and sellerpilot_private.shopee_sg_exact_content_receipt_valid(job.response_payload)
     and sellerpilot_private.shopee_sg_exact_receipt_asset_evidence(
           job.response_payload,
           'sellerpilot_shopee_sg_existing_content_readback_v1'
         ) = permit.approved_asset_evidence
     and step#>>'{data,sellerpilotShopeeSgExistingReadback,contract}' =
           'sellerpilot_shopee_sg_existing_content_readback_v1'
$$;

create function sellerpilot_private.shopee_sg_exact_content_succeeded(
  p_listing_id uuid,
  p_credential_id uuid,
  p_seller_account_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.shopee_sg_exact_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job on job.id = permit.update_job_id
      join sellerpilot_private.gateway_completion_receipts receipt on receipt.job_id = job.id
     where permit.phase = 'content'
       and permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.seller_account_key = p_seller_account_key
       and permit.invalidated_at is null
       and permit.consumed_at is not null
       and receipt.claim_token = permit.bound_claim_token
       and receipt.claim_token = job.claim_token
       and receipt.worker_token_id = permit.bound_worker_token_id
       and receipt.worker_token_id = job.worker_token_id
       and job.status = 'succeeded'
       and job.attempt_count = 1
       and job.provider_mutation_started_at is not null
       and sellerpilot_private.shopee_sg_exact_content_receipt_valid(
             job.response_payload
           )
       and sellerpilot_private.shopee_sg_exact_receipt_asset_evidence(
             job.response_payload,
             'sellerpilot_shopee_sg_existing_content_readback_v1'
           ) = permit.approved_asset_evidence
  )
$$;

create function sellerpilot_private.shopee_sg_exact_update_identity_json(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text,
  p_phase text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_asset_evidence jsonb;
begin
  if p_product_id <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     or p_market <> 'SG' or p_target_id <> '1719148844'
     or p_phase not in ('content', 'inventory')
     or not sellerpilot_private.shopee_sg_exact_update_credential_allowed(p_credential_id)
  then return null; end if;

  select listing.id listing_id, listing.product_id, listing.owner_id,
         listing.seller_account_key, listing.price,
         credential.id credential_id, credential.version credential_version,
         credential.fingerprint credential_fingerprint,
         credential.seller_account_verified_at credential_verified_at,
         adoption.id adoption_id, adoption.gateway_job_id,
         adoption.evidence_digest
    into v_row
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.seller_account_key = listing.seller_account_key
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
    join sellerpilot_private.shopee_existing_adoption_attestations adoption
      on adoption.listing_id = listing.id
     and adoption.product_id = listing.product_id
     and adoption.owner_id = listing.owner_id
     and adoption.credential_id = credential.id
     and adoption.seller_account_key = listing.seller_account_key
     and adoption.remote_id = listing.remote_id
     and adoption.marketplace_sku = listing.marketplace_sku
     and adoption.merchant_id = '5511564'
     and adoption.shop_id = listing.target_id
     and adoption.market = listing.market
     and adoption.locale = 'en-SG'
     and adoption.currency = listing.currency
     and adoption.price = listing.price
     and adoption.price = 16.77
     and adoption.provider_status = listing.provider_status
     and adoption.detail_image_count = 8
    join sellerpilot_private.provider_listing_lineage_attestations lineage
      on lineage.listing_id = listing.id
     and lineage.gateway_job_id = adoption.gateway_job_id
     and lineage.credential_id = credential.id
     and lineage.seller_account_key = listing.seller_account_key
   where listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'shopee'
     and listing.remote_id = '53717126190'
     and listing.marketplace_sku = 'QA-20260823-CC-001'
     and listing.market = 'SG' and listing.target_id = '1719148844'
     and listing.status = 'paused'
     and listing.requested_publication_intent = 'safe_test'
     and listing.remote_visibility = 'non_public'
     and listing.provider_status = 'UNLIST'
     and listing.currency = 'SGD' and listing.price = 16.77
     and listing.published_at is null and listing.last_verified_at is not null
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1 and not product.demo and product.status <> 'archived';
  if not found then return null; end if;
  if p_phase = 'inventory'
     and not sellerpilot_private.shopee_sg_exact_content_succeeded(
       p_listing_id, p_credential_id, v_row.seller_account_key
     )
  then return null; end if;
  if p_phase = 'inventory' then
    select permit.approved_asset_evidence into v_asset_evidence
      from sellerpilot_private.shopee_sg_exact_update_permits permit
     where permit.phase = 'content'
       and permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.seller_account_key = v_row.seller_account_key
       and permit.invalidated_at is null
       and sellerpilot_private.shopee_sg_exact_asset_evidence_valid(
             permit.approved_asset_evidence
           );
    if not found then return null; end if;
  end if;
  return jsonb_build_object(
    'status', 'allowed',
    'contract', 'sellerpilot_shopee_sg_existing_update_identity_v1',
    'phase', p_phase,
    'listingId', v_row.listing_id,
    'productId', v_row.product_id,
    'credentialId', v_row.credential_id,
    'sellerAccountKey', v_row.seller_account_key,
    'itemId', '53717126190',
    'sku', 'QA-20260823-CC-001',
    'merchantId', '5511564',
    'shopId', '1719148844',
    'market', 'SG', 'locale', 'en-SG', 'currency', 'SGD',
    'priceSgd', 16.77, 'stock', 1, 'providerStatus', 'UNLIST',
    'adoptionAttestationId', v_row.adoption_id,
    'adoptionGatewayJobId', v_row.gateway_job_id,
    'adoptionEvidenceDigest', v_row.evidence_digest,
    'approvedAssetEvidence', v_asset_evidence
  );
end;
$$;

create function public.sellerpilot_service_get_shopee_sg_exact_update_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text,
  p_phase text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
  then raise exception 'service role required' using errcode = '42501'; end if;
  return sellerpilot_private.shopee_sg_exact_update_identity_json(
    p_listing_id, p_credential_id, p_product_id, p_market, p_target_id, p_phase
  );
end;
$$;

create function sellerpilot_private.shopee_sg_exact_update_release_is_current(
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_release_sha ~ '^[a-f0-9]{40}$'
    and sellerpilot_private.active_serverless_runtime_release_sha() = p_release_sha
    and exists (
      select 1 from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton and not gate.is_open and gate.opened_at is null
         and gate.opened_release_sha is null and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective('shopee'),
    false
  )
$$;

create function sellerpilot_private.shopee_sg_exact_update_arguments_valid(
  p_arguments jsonb,
  p_phase text,
  p_release_sha text,
  p_request_fingerprint text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_price numeric
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_marker jsonb := p_arguments->'sellerpilotShopeeSgExistingUpdate';
  v_body jsonb := p_arguments->'body';
  v_assets jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_title text;
  v_description text;
begin
  if jsonb_typeof(p_arguments) <> 'object'
     or p_phase not in ('content', 'inventory')
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(v_marker) <> 'object'
     or (v_marker - array[
       'contract','phase','listingId','productId','credentialId','sellerAccountKey',
       'itemId','sku','merchantId','shopId','market','locale','currency',
       'priceSgd','stock','providerStatus','adoptionAttestationId',
       'adoptionGatewayJobId','adoptionEvidenceDigest','approvedAssetEvidence','releaseSha'
     ]) <> '{}'::jsonb
     or (select count(*) from jsonb_object_keys(v_marker)) <> 21
     or v_marker->>'contract' <> 'sellerpilot_shopee_sg_existing_update_v1'
     or v_marker->>'phase' <> p_phase
     or v_marker->>'listingId' <> p_listing_id::text
     or v_marker->>'productId' <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'
     or v_marker->>'credentialId' <> p_credential_id::text
     or coalesce(v_marker->>'sellerAccountKey', '') !~ '^[a-f0-9]{64}$'
     or v_marker->>'itemId' <> '53717126190'
     or v_marker->>'sku' <> 'QA-20260823-CC-001'
     or v_marker->>'merchantId' <> '5511564'
     or v_marker->>'shopId' <> '1719148844'
     or v_marker->>'market' <> 'SG' or v_marker->>'locale' <> 'en-SG'
     or v_marker->>'currency' <> 'SGD'
     or (v_marker->>'priceSgd')::numeric <> p_price
     or (v_marker->>'priceSgd')::numeric <> 16.77
     or (v_marker->>'stock')::integer <> 1
     or v_marker->>'providerStatus' <> 'UNLIST'
     or coalesce(v_marker->>'adoptionAttestationId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(v_marker->>'adoptionGatewayJobId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(v_marker->>'adoptionEvidenceDigest', '') !~ '^[a-f0-9]{64}$'
     or v_marker->>'releaseSha' <> p_release_sha
  then return false; end if;

  if p_phase = 'inventory' then
    return (select count(*) from jsonb_object_keys(p_arguments)) = 5
      and (p_arguments - array[
        'sellerpilotShopeeSgExistingUpdate','shopId','country','itemId','quantity'
      ]) = '{}'::jsonb
      and p_arguments->>'shopId' = '1719148844'
      and p_arguments->>'country' = 'sg'
      and p_arguments->>'itemId' = '53717126190'
      and (p_arguments->>'quantity')::integer = 1
      and coalesce(sellerpilot_private.shopee_sg_exact_asset_evidence_valid(
            v_marker->'approvedAssetEvidence'
          ), false);
  end if;

  v_title := trim(coalesce(v_body->>'item_name', ''));
  v_description := trim(coalesce(v_body->>'description', ''));
  return p_arguments->>'localItemId' = '53717126190'
    and (select count(*) from jsonb_object_keys(p_arguments)) = 12
    and (p_arguments - array[
      'sellerpilotShopeeSgExistingUpdate','localItemId','shopId','country','body',
      'publicationStateContract','publicationIntent','publicationExpectedLocale',
      'publicationExpectedImageCount','publicationExpectedFingerprint','imageUrls',
      'sellerpilotPublicationAssetBinding'
    ]) = '{}'::jsonb
    and p_arguments->>'shopId' = '1719148844'
    and p_arguments->>'country' = 'sg'
    and jsonb_typeof(v_body) = 'object'
    and (select count(*) from jsonb_object_keys(v_body)) = 3
    and (v_body - array['item_id','item_name','description']) = '{}'::jsonb
    and v_body->>'item_id' = '53717126190'
    and not (v_body ?| array['item_status','item_sku','original_price','normal_stock','seller_stock'])
    and p_arguments->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_arguments->>'publicationIntent' = 'safe_test'
    and p_arguments->>'publicationExpectedLocale' = 'en-SG'
    and (p_arguments->>'publicationExpectedImageCount')::integer = 8
    and p_arguments->>'publicationExpectedFingerprint' = p_request_fingerprint
    and length(v_title) between 8 and 120 and v_title ~ '[A-Za-z]'
    and length(v_description) between 20 and 3000 and v_description ~ '[A-Za-z]'
    and v_title !~ '[가-힣ぁ-ヿ一-鿿]' and v_description !~ '[가-힣ぁ-ヿ一-鿿]'
    and jsonb_typeof(p_arguments->'imageUrls') = 'array'
    and jsonb_array_length(p_arguments->'imageUrls') = 9
    and (select count(distinct value#>>'{}') from jsonb_array_elements(p_arguments->'imageUrls') value) = 9
    and jsonb_typeof(v_assets) = 'object'
    and v_assets->>'contract' = 'sellerpilot_publication_asset_binding_v1'
    and v_assets->>'providerImageSurface' = 'gallery'
    and jsonb_typeof(v_assets->'providerTransportImages') = 'array'
    and jsonb_array_length(v_assets->'providerTransportImages') = 9
    and v_assets#>>'{providerTransportImages,0,role}' = 'gallery-representative'
    and not exists (
      select 1
        from jsonb_array_elements(v_assets->'providerTransportImages') with ordinality detail(value, ordinality)
       where detail.value->>'publicUrl' <>
             p_arguments->'imageUrls'->>((detail.ordinality - 1)::integer)
    )
    and coalesce(
      sellerpilot_private.shopee_sg_exact_approved_asset_evidence(p_arguments)
        = v_marker->'approvedAssetEvidence',
      false
    );
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.shopee_sg_exact_update_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.shopee_sg_exact_update_permits permit
     where permit.permit_id = p_permit_id
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.shopee_sg_exact_update_release_is_current(permit.release_sha)
       and sellerpilot_private.shopee_sg_exact_update_credential_allowed(permit.credential_id)
       and sellerpilot_private.shopee_sg_exact_update_identity_json(
         permit.listing_id, permit.credential_id, permit.product_id,
         permit.market, permit.shop_id, permit.phase
       ) @> jsonb_build_object(
         'status','allowed', 'phase',permit.phase, 'listingId',permit.listing_id,
         'credentialId',permit.credential_id, 'sellerAccountKey',permit.seller_account_key,
         'adoptionAttestationId',permit.adoption_attestation_id,
         'adoptionGatewayJobId',permit.adoption_gateway_job_id,
         'adoptionEvidenceDigest',permit.adoption_evidence_digest
       )
       and exists (
         select 1 from sellerpilot_private.channel_credentials credential
          where credential.id = permit.credential_id
            and credential.version = permit.credential_version
            and credential.fingerprint = permit.credential_fingerprint
            and credential.seller_account_verified_at = permit.credential_verified_at
       )
  )
$$;

-- Once the enqueue predecessor has accepted the exact paused listing it moves
-- that listing to queued. Claim and provider-boundary checks must therefore
-- validate the immutable enqueued lineage instead of reusing the pre-enqueue
-- identity predicate, which deliberately requires listing.status = paused.
create function sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.shopee_sg_exact_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.product_id = permit.product_id
       and listing.owner_id = permit.owner_id
       and listing.channel_key = 'shopee'
       and listing.remote_id = permit.item_id
       and listing.marketplace_sku = permit.marketplace_sku
       and listing.market = permit.market
       and listing.target_id = permit.shop_id
       and listing.currency = permit.currency
       and listing.price = permit.price
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id
       and product.owner_id = permit.owner_id
       and product.sku = permit.marketplace_sku
       and product.on_hand = permit.stock
       and not product.demo and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
       and credential.channel = 'shopee'
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at = permit.credential_verified_at
      join sellerpilot_private.shopee_existing_adoption_attestations adoption
        on adoption.id = permit.adoption_attestation_id
       and adoption.gateway_job_id = permit.adoption_gateway_job_id
       and adoption.evidence_digest = permit.adoption_evidence_digest
       and adoption.listing_id = permit.listing_id
       and adoption.product_id = permit.product_id
       and adoption.owner_id = permit.owner_id
       and adoption.credential_id = permit.credential_id
       and adoption.seller_account_key = permit.seller_account_key
       and adoption.remote_id = permit.item_id
       and adoption.marketplace_sku = permit.marketplace_sku
       and adoption.merchant_id = permit.merchant_id
       and adoption.shop_id = permit.shop_id
       and adoption.market = permit.market
       and adoption.locale = permit.locale
       and adoption.currency = permit.currency
       and adoption.price = permit.price
       and adoption.provider_status = permit.provider_status
       and adoption.detail_image_count = 8
      join sellerpilot_private.provider_listing_lineage_attestations lineage
        on lineage.listing_id = permit.listing_id
       and lineage.gateway_job_id = permit.adoption_gateway_job_id
       and lineage.credential_id = permit.credential_id
       and lineage.seller_account_key = permit.seller_account_key
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.update_attempt_id
       and attempt.owner_id = permit.owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.channel = 'shopee'
       and attempt.operation = case permit.phase
             when 'content' then 'listing.update' else 'inventory.update' end
       and attempt.status = 'running'
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = permit.request_fingerprint
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.update_job_id
       and job.attempt_id = permit.update_attempt_id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.channel = 'shopee'
       and job.operation = case permit.phase
             when 'content' then 'listing.update' else 'inventory.update' end
       and job.environment = 'production'
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
     where permit.permit_id = p_permit_id
       and permit.invalidated_at is null
       and permit.consumed_at is null
       and permit.expires_at > statement_timestamp()
       and permit.update_job_id is not null
       and permit.update_attempt_id is not null
       and listing.failure_class is null
       and listing.requested_publication_intent = 'safe_test'
       and listing.remote_visibility = 'non_public'
       and listing.provider_status = 'UNLIST'
       and listing.published_at is null
       and listing.last_verified_at is not null
       and (
         (permit.phase = 'content' and listing.status = 'queued'
           and listing.operation_attempt_id = permit.update_attempt_id)
         or
         (permit.phase = 'inventory' and listing.status = 'paused')
       )
       and (permit.phase = 'content'
         or sellerpilot_private.shopee_sg_exact_content_succeeded(
              permit.listing_id, permit.credential_id, permit.seller_account_key
            ))
       and sellerpilot_private.shopee_sg_exact_update_credential_allowed(
             permit.credential_id
           )
       and sellerpilot_private.shopee_sg_exact_update_release_is_current(
             permit.release_sha
           )
       and job.status in ('queued', 'running')
       and job.attempt_count = case job.status when 'queued' then 0 else 1 end
       and job.provider_mutation_started_at is null
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and (
         (job.status = 'queued' and job.worker_token_id is null
           and job.claim_token is null and job.started_at is null
           and job.lease_expires_at is null)
         or
         (job.status = 'running' and job.worker_token_id = permit.bound_worker_token_id
           and job.claim_token = permit.bound_claim_token
           and job.started_at is not null
           and job.lease_expires_at > statement_timestamp())
       )
       and permit.arguments_sha256 = encode(extensions.digest(
             (job.request_payload->'arguments')::text, 'sha256'
           ), 'hex')
       and permit.request_payload_sha256 = encode(extensions.digest(
             job.request_payload::text, 'sha256'
           ), 'hex')
       and sellerpilot_private.shopee_sg_exact_asset_evidence_valid(
             permit.approved_asset_evidence
           )
       and permit.approved_asset_evidence_sha256 = encode(extensions.digest(
             permit.approved_asset_evidence::text, 'sha256'
           ), 'hex')
       and job.request_payload#>'{arguments,sellerpilotShopeeSgExistingUpdate,approvedAssetEvidence}'
             = permit.approved_asset_evidence
       and sellerpilot_private.shopee_sg_exact_update_arguments_valid(
             job.request_payload->'arguments', permit.phase, permit.release_sha,
             permit.request_fingerprint, permit.listing_id,
             permit.credential_id, permit.price
           )
  )
$$;

create function public.sellerpilot_service_arm_shopee_sg_exact_update(
  p_phase text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_permit sellerpilot_private.shopee_sg_exact_update_permits%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
  then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 911739700);
  if p_phase not in ('content','inventory')
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.shopee_sg_exact_update_release_is_current(p_release_sha)
  then raise exception 'Shopee SG exact permit identity invalid' using errcode = '55000'; end if;
  v_identity := sellerpilot_private.shopee_sg_exact_update_identity_json(
    p_listing_id, p_credential_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'SG', '1719148844', p_phase
  );
  if v_identity is null then
    raise exception 'Shopee SG exact already-bound lineage required' using errcode = '55000';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = p_listing_id
       and job.status in ('queued','running','reconciliation_required')
  ) then raise exception 'Shopee SG exact active job exists' using errcode = '55000'; end if;
  update sellerpilot_private.shopee_sg_exact_update_permits permit
     set invalidated_at = statement_timestamp(), invalidation_reason = 'expired_before_job'
   where permit.listing_id = p_listing_id and permit.phase = p_phase
     and permit.invalidated_at is null and permit.update_job_id is null
     and permit.expires_at <= statement_timestamp();
  select * into v_permit
    from sellerpilot_private.shopee_sg_exact_update_permits permit
   where permit.listing_id = p_listing_id and permit.phase = p_phase
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.update_job_id is not null
       or v_permit.credential_id <> p_credential_id
       or v_permit.release_sha <> p_release_sha
       or v_permit.request_fingerprint <> p_request_fingerprint
       or v_permit.expires_at <= statement_timestamp()
    then raise exception 'Shopee SG exact permit already used' using errcode = '55000'; end if;
  else
    insert into sellerpilot_private.shopee_sg_exact_update_permits (
      phase, listing_id, product_id, credential_id, owner_id,
      seller_account_key, credential_version, credential_fingerprint,
      credential_verified_at, adoption_attestation_id,
      adoption_gateway_job_id, adoption_evidence_digest,
      item_id, marketplace_sku, merchant_id, shop_id, market, locale,
      currency, price, stock, provider_status, release_sha,
      request_fingerprint, approved_asset_evidence,
      approved_asset_evidence_sha256, armed_at, expires_at
    )
    select p_phase, p_listing_id, (v_identity->>'productId')::uuid,
      p_credential_id, listing.owner_id, v_identity->>'sellerAccountKey',
      credential.version, credential.fingerprint,
      credential.seller_account_verified_at,
      (v_identity->>'adoptionAttestationId')::uuid,
      (v_identity->>'adoptionGatewayJobId')::uuid,
      v_identity->>'adoptionEvidenceDigest', '53717126190',
      'QA-20260823-CC-001', '5511564', '1719148844', 'SG', 'en-SG',
      'SGD', 16.77, 1, 'UNLIST',
      p_release_sha, p_request_fingerprint,
      v_identity->'approvedAssetEvidence',
      case when v_identity->'approvedAssetEvidence' is null
        then null else encode(extensions.digest((v_identity->'approvedAssetEvidence')::text,'sha256'),'hex') end,
      statement_timestamp(),
      statement_timestamp() + interval '5 minutes'
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.channel_credentials credential on credential.id = p_credential_id
     where listing.id = p_listing_id
    returning * into v_permit;
  end if;
  return jsonb_build_object(
    'status','armed','contract','shopee_sg_exact_update_permit_v1',
    'phase',v_permit.phase,'permitId',v_permit.permit_id,
    'listingId',v_permit.listing_id,'releaseSha',v_permit.release_sha,
    'requestFingerprint',v_permit.request_fingerprint,
    'expiresAt',v_permit.expires_at,'bound',false
  );
end;
$$;

create function sellerpilot_private.shopee_sg_exact_update_enqueue_bypass_allowed(
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
  v_phase text := case p_operation when 'listing.update' then 'content'
    when 'inventory.update' then 'inventory' else null end;
begin
  return coalesce(
    p_channel = 'shopee' and v_phase is not null
    and jsonb_typeof(p_request_payload->'arguments') = 'object'
    and exists (
      select 1
        from sellerpilot_private.shopee_sg_exact_update_permits permit
        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id = p_attempt_id
         and attempt.owner_id = permit.owner_id
         and attempt.credential_id = permit.credential_id
         and attempt.channel = 'shopee'
         and attempt.operation = p_operation
         and attempt.status = 'running'
         and attempt.seller_account_key = permit.seller_account_key
         and attempt.request_fingerprint = permit.request_fingerprint
       where permit.phase = v_phase and permit.listing_id = p_listing_id
         and permit.credential_id = p_credential_id
         and permit.update_job_id is null and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
         and sellerpilot_private.shopee_sg_exact_update_lineage_is_current(permit.permit_id)
         and sellerpilot_private.shopee_sg_exact_update_arguments_valid(
           p_request_payload->'arguments', permit.phase, permit.release_sha,
           permit.request_fingerprint, permit.listing_id,
           permit.credential_id, permit.price
         )
    ), false
  );
exception when others then return false;
end;
$$;

-- Patch every live listing-enqueue predecessor that owns the closed-gate
-- condition. This is name-independent so later exact eBay/Temu wrappers can
-- precede this forward migration without being overwritten.
do $patch_shopee_sg_closed_gate_enqueue$
declare
  v_signature regprocedure;
  v_definition text;
  v_needle text := $body$and not sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
       p_listing_id,
       p_credential_id,
       p_attempt_id,
       p_channel,
       p_operation,
       p_request_payload
     )$body$;
  v_replacement text := v_needle || $body$
     and not sellerpilot_private.shopee_sg_exact_update_enqueue_bypass_allowed(
       p_listing_id,
       p_credential_id,
       p_attempt_id,
       p_channel,
       p_operation,
       p_request_payload
     )$body$;
begin
  for v_signature in
    select procedure.oid::regprocedure
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
             'uuid, uuid, uuid, text, text, jsonb'
       and pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(procedure.oid),
         'exact_existing_update_enqueue_gate_bypass_allowed'
       ) > 0
       and pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(procedure.oid),
         'shopee_sg_exact_update_enqueue_bypass_allowed'
       ) = 0
  loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    if pg_catalog.strpos(v_definition, v_needle) = 0 then
      raise exception 'Shopee SG closed-gate enqueue patch target drifted: %', v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_needle, v_replacement);
  end loop;
end;
$patch_shopee_sg_closed_gate_enqueue$;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
) rename to sellerpilot_173970_enqueue_listing_before_shopee_sg_exact;
revoke all on function public.sellerpilot_173970_enqueue_listing_before_shopee_sg_exact(
  uuid,uuid,uuid,text,text,jsonb
) from public,anon,authenticated,service_role;

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
  v_target boolean;
  v_permit sellerpilot_private.shopee_sg_exact_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 911739700);
  select p_channel = 'shopee' and p_operation = 'listing.update' and exists (
    select 1 from sellerpilot_private.product_listings listing
     where listing.id = p_listing_id and listing.product_id =
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.remote_id = '53717126190'
  ) into v_target;
  if v_target then
    select * into v_permit
      from sellerpilot_private.shopee_sg_exact_update_permits permit
     where permit.phase = 'content' and permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.invalidated_at is null and permit.update_job_id is null
       and permit.expires_at > statement_timestamp()
     for update;
    if not found
       or not sellerpilot_private.shopee_sg_exact_update_enqueue_bypass_allowed(
         p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,p_request_payload
       )
    then raise exception 'Shopee SG exact content permit required' using errcode = '55000'; end if;
  elsif coalesce(p_request_payload->'arguments' ? 'sellerpilotShopeeSgExistingUpdate', false) then
    raise exception 'Shopee SG exact marker target mismatch' using errcode = '55000';
  end if;
  v_result := public.sellerpilot_173970_enqueue_listing_before_shopee_sg_exact(
    p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,p_request_payload
  );
  if v_target then
    if v_result->>'status' <> 'queued' or coalesce(v_result->>'job_id','') !~ '^[0-9a-f-]{36}$'
    then raise exception 'Shopee SG exact content job not newly queued' using errcode = '55000'; end if;
    v_job_id := (v_result->>'job_id')::uuid;
    update sellerpilot_private.shopee_sg_exact_update_permits permit
       set update_job_id = v_job_id, update_attempt_id = p_attempt_id,
           arguments_sha256 = encode(extensions.digest((p_request_payload->'arguments')::text,'sha256'),'hex'),
           request_payload_sha256 = encode(extensions.digest(p_request_payload::text,'sha256'),'hex'),
           approved_asset_evidence = sellerpilot_private.shopee_sg_exact_approved_asset_evidence(
             p_request_payload->'arguments'
           ),
           approved_asset_evidence_sha256 = encode(extensions.digest(
             sellerpilot_private.shopee_sg_exact_approved_asset_evidence(
               p_request_payload->'arguments'
             )::text,'sha256'
           ),'hex')
     where permit.permit_id = v_permit.permit_id and permit.update_job_id is null;
    if not found then raise exception 'Shopee SG exact content job binding failed' using errcode = '55000'; end if;
  end if;
  return v_result;
end;
$$;

alter function public.sellerpilot_service_enqueue_resource_gateway_job(
  uuid,uuid,text,text,jsonb,text,text,text,uuid,uuid,uuid,text,text
) rename to sellerpilot_173970_enqueue_resource_before_shopee_sg_exact;
revoke all on function public.sellerpilot_173970_enqueue_resource_before_shopee_sg_exact(
  uuid,uuid,text,text,jsonb,text,text,text,uuid,uuid,uuid,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_enqueue_resource_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_resource_kind text,
  p_resource_key text,
  p_request_fingerprint text,
  p_listing_id uuid default null,
  p_inventory_item_id uuid default null,
  p_order_id uuid default null,
  p_shipment_carrier text default null,
  p_shipment_tracking text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target boolean;
  v_permit sellerpilot_private.shopee_sg_exact_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 911739700);
  select p_channel = 'shopee' and p_operation = 'inventory.update'
    and p_listing_id is not null and exists (
      select 1 from sellerpilot_private.product_listings listing
       where listing.id = p_listing_id and listing.product_id =
         'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and listing.remote_id = '53717126190'
    ) into v_target;
  if v_target then
    select * into v_permit
      from sellerpilot_private.shopee_sg_exact_update_permits permit
     where permit.phase = 'inventory' and permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.request_fingerprint = p_request_fingerprint
       and permit.invalidated_at is null and permit.update_job_id is null
       and permit.expires_at > statement_timestamp()
     for update;
    if not found
       or p_resource_kind <> 'listing_mutation'
       or not sellerpilot_private.shopee_sg_exact_update_enqueue_bypass_allowed(
         p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,p_request_payload
       )
    then raise exception 'Shopee SG exact inventory permit required' using errcode = '55000'; end if;
  elsif coalesce(p_request_payload->'arguments' ? 'sellerpilotShopeeSgExistingUpdate', false) then
    raise exception 'Shopee SG exact marker target mismatch' using errcode = '55000';
  end if;
  v_result := public.sellerpilot_173970_enqueue_resource_before_shopee_sg_exact(
    p_credential_id,p_attempt_id,p_channel,p_operation,p_request_payload,
    p_resource_kind,p_resource_key,p_request_fingerprint,p_listing_id,
    p_inventory_item_id,p_order_id,p_shipment_carrier,p_shipment_tracking
  );
  if v_target then
    if v_result->>'status' <> 'queued' or coalesce(v_result->>'job_id','') !~ '^[0-9a-f-]{36}$'
    then raise exception 'Shopee SG exact inventory job not newly queued' using errcode = '55000'; end if;
    v_job_id := (v_result->>'job_id')::uuid;
    update sellerpilot_private.shopee_sg_exact_update_permits permit
       set update_job_id = v_job_id, update_attempt_id = p_attempt_id,
           arguments_sha256 = encode(extensions.digest((p_request_payload->'arguments')::text,'sha256'),'hex'),
           request_payload_sha256 = encode(extensions.digest(p_request_payload::text,'sha256'),'hex'),
           approved_asset_evidence = p_request_payload#>'{arguments,sellerpilotShopeeSgExistingUpdate,approvedAssetEvidence}',
           approved_asset_evidence_sha256 = encode(extensions.digest(
             (p_request_payload#>'{arguments,sellerpilotShopeeSgExistingUpdate,approvedAssetEvidence}')::text,'sha256'
           ),'hex')
     where permit.permit_id = v_permit.permit_id and permit.update_job_id is null;
    if not found then raise exception 'Shopee SG exact inventory job binding failed' using errcode = '55000'; end if;
  end if;
  return v_result;
end;
$$;

create function sellerpilot_private.bind_shopee_sg_exact_update_claim(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_old) <> 'object' or jsonb_typeof(p_new) <> 'object'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' <> 'queued' or p_new->>'status' <> 'running'
     or p_old->>'channel' <> 'shopee'
     or p_old->>'operation' not in ('listing.update','inventory.update')
     or p_new->>'channel' <> p_old->>'channel'
     or p_new->>'operation' <> p_old->>'operation'
     or (p_old->>'attempt_count')::integer <> 0
     or (p_new->>'attempt_count')::integer <> 1
     or p_old->'worker_token_id' <> 'null'::jsonb
     or p_old->'claim_token' <> 'null'::jsonb
     or p_old->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'claim_token' = 'null'::jsonb
     or p_new->'worker_token_id' = 'null'::jsonb
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
  update sellerpilot_private.shopee_sg_exact_update_permits permit
     set bound_at = statement_timestamp(),
         bound_worker_token_id = (p_new->>'worker_token_id')::uuid,
         bound_claim_token = (p_new->>'claim_token')::uuid
   where permit.update_job_id = (p_new->>'id')::uuid
     and permit.update_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.listing_id = (p_new->>'listing_id')::uuid
     and permit.credential_id = (p_new->>'credential_id')::uuid
     and permit.seller_account_key = p_new->>'seller_account_key'
     and permit.request_fingerprint = p_new->>'request_fingerprint'
     and permit.request_payload_sha256 = encode(extensions.digest((p_new->'request_payload')::text,'sha256'),'hex')
     and permit.invalidated_at is null and permit.consumed_at is null
     and permit.bound_at is null and permit.expires_at > statement_timestamp()
     and sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current(
           permit.permit_id
         );
  return found;
exception when others then return false;
end;
$$;

do $patch_shopee_sg_claim$
declare
  v_definition text;
  v_needle text := $body$or sellerpilot_private.bind_exact_existing_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
  v_replacement text := v_needle || $body$
       or sellerpilot_private.bind_shopee_sg_exact_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition,'bind_shopee_sg_exact_update_claim') = 0 then
    if pg_catalog.strpos(v_definition,v_needle) = 0 then
      raise exception 'Shopee SG exact claim patch target drifted' using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition,v_needle,v_replacement);
  end if;
end;
$patch_shopee_sg_claim$;

create function sellerpilot_private.shopee_sg_exact_update_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.shopee_sg_exact_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job on job.id = permit.update_job_id
     where permit.update_job_id = p_job_id and permit.bound_claim_token = p_claim_token
       and permit.bound_at is not null and permit.consumed_at is null
       and permit.invalidated_at is null and permit.expires_at > statement_timestamp()
       and sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current(
             permit.permit_id
           )
       and job.status = 'running' and job.channel = 'shopee'
       and job.operation = case permit.phase when 'content' then 'listing.update' else 'inventory.update' end
       and job.environment = 'production' and job.claim_token = p_claim_token
       and job.worker_token_id = permit.bound_worker_token_id
       and job.attempt_count = 1 and job.lease_expires_at > statement_timestamp()
       and job.provider_mutation_started_at is null and job.completed_at is null
       and job.response_payload is null and job.error_message is null
       and job.listing_id = permit.listing_id and job.credential_id = permit.credential_id
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and permit.arguments_sha256 = encode(extensions.digest((job.request_payload->'arguments')::text,'sha256'),'hex')
       and permit.request_payload_sha256 = encode(extensions.digest(job.request_payload::text,'sha256'),'hex')
  )
$$;

create function sellerpilot_private.consume_shopee_sg_exact_update_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.shopee_sg_exact_update_permits permit
     set consumed_at = statement_timestamp()
   where permit.update_job_id = p_job_id and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = permit.update_job_id and job.status = 'running'
          and job.claim_token = p_claim_token
          and job.worker_token_id = permit.bound_worker_token_id
          and job.provider_mutation_started_at is not null
          and job.completed_at is null and job.response_payload is null
     );
  return found;
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_173970_begin_gateway_before_shopee_sg_exact;
revoke all on function public.sellerpilot_173970_begin_gateway_before_shopee_sg_exact(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_exact boolean; v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,911739700);
  select exists(select 1 from sellerpilot_private.shopee_sg_exact_update_permits where update_job_id=p_job_id)
    into v_exact;
  if not v_exact then
    return public.sellerpilot_173970_begin_gateway_before_shopee_sg_exact(p_token_hash,p_job_id,p_claim_token);
  end if;
  if not sellerpilot_private.shopee_sg_exact_update_provider_allowed(p_job_id,p_claim_token)
  then return false; end if;
  v_started := public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    p_token_hash,p_job_id,p_claim_token
  );
  if coalesce(v_started,false)
     and not sellerpilot_private.consume_shopee_sg_exact_update_provider(p_job_id,p_claim_token)
  then raise exception 'Shopee SG exact permit consumption failed' using errcode = '40001'; end if;
  return coalesce(v_started,false);
end;
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_173970_begin_serverless_before_shopee_sg_exact;
revoke all on function public.sellerpilot_173970_begin_serverless_before_shopee_sg_exact(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_exact boolean; v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,911739700);
  select exists(select 1 from sellerpilot_private.shopee_sg_exact_update_permits where update_job_id=p_job_id)
    into v_exact;
  if not v_exact then
    return public.sellerpilot_173970_begin_serverless_before_shopee_sg_exact(p_token_hash,p_job_id,p_claim_token);
  end if;
  if not sellerpilot_private.shopee_sg_exact_update_provider_allowed(p_job_id,p_claim_token)
  then return false; end if;
  v_started := public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
    p_token_hash,p_job_id,p_claim_token
  );
  if coalesce(v_started,false)
     and not sellerpilot_private.consume_shopee_sg_exact_update_provider(p_job_id,p_claim_token)
  then raise exception 'Shopee SG exact permit consumption failed' using errcode = '40001'; end if;
  return coalesce(v_started,false);
end;
$$;

create function sellerpilot_private.guard_shopee_sg_exact_update_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permit sellerpilot_private.shopee_sg_exact_update_permits%rowtype;
  v_success_evidence boolean := false;
begin
  select * into v_permit from sellerpilot_private.shopee_sg_exact_update_permits permit
   where permit.update_job_id = new.id;
  if not found then return new; end if;
  if new.channel <> 'shopee'
     or new.operation <> (case v_permit.phase
       when 'content' then 'listing.update' else 'inventory.update' end)
     or new.environment <> 'production' or new.attempt_count > 1
     or new.listing_id <> v_permit.listing_id
     or new.credential_id <> v_permit.credential_id
     or new.seller_account_key <> v_permit.seller_account_key
     or new.request_fingerprint <> v_permit.request_fingerprint
     or v_permit.arguments_sha256 <> encode(extensions.digest((new.request_payload->'arguments')::text,'sha256'),'hex')
     or v_permit.request_payload_sha256 <> encode(extensions.digest(new.request_payload::text,'sha256'),'hex')
  then raise exception 'Shopee SG exact job lineage invalid' using errcode = '55000'; end if;
  if new.status = 'succeeded' then
    if v_permit.consumed_at is null or new.provider_mutation_started_at is null
    then raise exception 'Shopee SG exact success without consumed permit' using errcode = '55000'; end if;
    if not exists (
      select 1 from sellerpilot_private.gateway_completion_receipts receipt
       where receipt.job_id = new.id
         and receipt.claim_token = new.claim_token
         and receipt.claim_token = v_permit.bound_claim_token
         and receipt.worker_token_id = new.worker_token_id
         and receipt.worker_token_id = v_permit.bound_worker_token_id
    ) then
      raise exception 'Shopee SG exact success without bound completion receipt'
        using errcode = '55000';
    end if;
    if v_permit.phase = 'content' then
      v_success_evidence := sellerpilot_private.shopee_sg_exact_content_receipt_valid(
        new.response_payload
      ) and sellerpilot_private.shopee_sg_exact_receipt_asset_evidence(
        new.response_payload,
        'sellerpilot_shopee_sg_existing_content_readback_v1'
      ) = v_permit.approved_asset_evidence;
    else
      v_success_evidence := sellerpilot_private.shopee_sg_exact_content_succeeded(
          v_permit.listing_id, v_permit.credential_id, v_permit.seller_account_key
        )
        and sellerpilot_private.shopee_sg_exact_inventory_receipt_valid(
          new.response_payload,
          sellerpilot_private.shopee_sg_exact_content_receipt_image_digest(
            v_permit.listing_id, v_permit.credential_id,
            v_permit.seller_account_key
          )
        ) and sellerpilot_private.shopee_sg_exact_receipt_asset_evidence(
          new.response_payload,
          'sellerpilot_shopee_sg_existing_inventory_readback_v1'
        ) = v_permit.approved_asset_evidence;
    end if;
    if not v_success_evidence then
      raise exception 'Shopee SG exact success readback invalid' using errcode = '55000';
    end if;
  elsif new.provider_mutation_started_at is not null
        and new.status in ('queued','failed','cancelled') then
    raise exception 'Shopee SG ambiguous provider result requires reconciliation'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create constraint trigger guard_shopee_sg_exact_update_job
after insert or update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function sellerpilot_private.guard_shopee_sg_exact_update_job();

revoke all on function
  sellerpilot_private.shopee_sg_exact_update_credential_allowed(uuid),
  sellerpilot_private.shopee_sg_exact_approved_asset_evidence(jsonb),
  sellerpilot_private.shopee_sg_exact_asset_evidence_valid(jsonb),
  sellerpilot_private.shopee_sg_exact_content_receipt_valid(jsonb),
  sellerpilot_private.shopee_sg_exact_inventory_receipt_valid(jsonb,text),
  sellerpilot_private.shopee_sg_exact_receipt_asset_evidence(jsonb,text),
  sellerpilot_private.shopee_sg_exact_content_succeeded(uuid,uuid,text),
  sellerpilot_private.shopee_sg_exact_content_receipt_image_digest(uuid,uuid,text),
  sellerpilot_private.shopee_sg_exact_update_identity_json(uuid,uuid,uuid,text,text,text),
  sellerpilot_private.shopee_sg_exact_update_release_is_current(text),
  sellerpilot_private.shopee_sg_exact_update_arguments_valid(jsonb,text,text,text,uuid,uuid,numeric),
  sellerpilot_private.shopee_sg_exact_update_lineage_is_current(uuid),
  sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current(uuid),
  sellerpilot_private.shopee_sg_exact_update_enqueue_bypass_allowed(uuid,uuid,uuid,text,text,jsonb),
  sellerpilot_private.bind_shopee_sg_exact_update_claim(jsonb,jsonb),
  sellerpilot_private.shopee_sg_exact_update_provider_allowed(uuid,uuid),
  sellerpilot_private.consume_shopee_sg_exact_update_provider(uuid,uuid),
  sellerpilot_private.guard_shopee_sg_exact_update_job()
  from public,anon,authenticated,service_role;

revoke all on function
  public.sellerpilot_service_get_shopee_sg_exact_update_identity(uuid,uuid,uuid,text,text,text),
  public.sellerpilot_service_arm_shopee_sg_exact_update(text,uuid,uuid,text,text),
  public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_enqueue_resource_gateway_job(uuid,uuid,text,text,jsonb,text,text,text,uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated,service_role;

grant execute on function
  public.sellerpilot_service_get_shopee_sg_exact_update_identity(uuid,uuid,uuid,text,text,text),
  public.sellerpilot_service_arm_shopee_sg_exact_update(text,uuid,uuid,text,text),
  public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_enqueue_resource_gateway_job(uuid,uuid,text,text,jsonb,text,text,text,uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

do $shopee_sg_exact_update_postimage$
declare
  v_definition text;
  v_bind_definition text;
  v_provider_definition text;
  v_guard_definition text;
  v_arguments_definition text;
begin
  if pg_catalog.to_regclass('sellerpilot_private.shopee_sg_exact_update_permits') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_get_shopee_sg_exact_update_identity(uuid,uuid,uuid,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_arm_shopee_sg_exact_update(text,uuid,uuid,text,text)') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.shopee_sg_exact_approved_asset_evidence(jsonb)') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.shopee_sg_exact_asset_evidence_valid(jsonb)') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.shopee_sg_exact_content_receipt_valid(jsonb)') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.shopee_sg_exact_inventory_receipt_valid(jsonb,text)') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.shopee_sg_exact_content_receipt_image_digest(uuid,uuid,text)') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.shopee_sg_exact_update_enqueued_lineage_is_current(uuid)') is null
     or exists (select 1 from sellerpilot_private.shopee_sg_exact_update_permits)
  then raise exception 'Shopee SG exact update postimage invalid' using errcode = '55000'; end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition,'bind_shopee_sg_exact_update_claim') = 0
  then raise exception 'Shopee SG exact claim postimage invalid' using errcode = '55000'; end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.bind_shopee_sg_exact_update_claim(jsonb,jsonb)'::regprocedure
  ) into v_bind_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.shopee_sg_exact_update_provider_allowed(uuid,uuid)'::regprocedure
  ) into v_provider_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_shopee_sg_exact_update_job()'::regprocedure
  ) into v_guard_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.shopee_sg_exact_update_arguments_valid(jsonb,text,text,text,uuid,uuid,numeric)'::regprocedure
  ) into v_arguments_definition;
  if pg_catalog.strpos(
       v_bind_definition,
       'shopee_sg_exact_update_enqueued_lineage_is_current'
     ) = 0
     or pg_catalog.strpos(
       v_provider_definition,
       'shopee_sg_exact_update_enqueued_lineage_is_current'
     ) = 0
     or pg_catalog.strpos(
       v_bind_definition,
       'shopee_sg_exact_update_lineage_is_current'
     ) > 0
     or pg_catalog.strpos(
       v_provider_definition,
       'shopee_sg_exact_update_lineage_is_current'
     ) > 0
  then raise exception 'Shopee SG enqueued lineage postimage invalid'
    using errcode = '55000'; end if;
  if pg_catalog.strpos(v_guard_definition,'shopee_sg_exact_content_receipt_valid') = 0
     or pg_catalog.strpos(v_guard_definition,'shopee_sg_exact_inventory_receipt_valid') = 0
     or pg_catalog.strpos(v_guard_definition,'shopee_sg_exact_content_succeeded') = 0
     or pg_catalog.strpos(v_guard_definition,'gateway_completion_receipts') = 0
     or pg_catalog.strpos(v_arguments_definition,'shopee_sg_exact_approved_asset_evidence') = 0
     or pg_catalog.strpos(v_arguments_definition,'jsonb_object_keys(p_arguments)') = 0
     or pg_catalog.strpos(v_arguments_definition,'jsonb_object_keys(v_body)') = 0
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger
        where trigger.tgrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
          and trigger.tgname = 'guard_shopee_sg_exact_update_job'
          and not trigger.tgisinternal
     )
  then raise exception 'Shopee SG exact receipt postimage invalid'
    using errcode = '55000'; end if;
end;
$shopee_sg_exact_update_postimage$;

comment on table sellerpilot_private.shopee_sg_exact_update_permits is
  'Five-minute one-use permits for exact Shopee SG item 53717126190: verified en-SG content while UNLIST, followed only after authoritative readback by stock=1.';

commit;
