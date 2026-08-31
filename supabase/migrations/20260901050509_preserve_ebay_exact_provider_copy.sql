begin;

-- The exact recovery no longer accepts localized/browser title or description
-- text. The queued request transports only the commerce tuple, one normalized
-- representative image and the eight approved detail images. The worker reads
-- the immutable live offer/inventory first and preserves that provider-owned
-- English copy when it builds the two PUT bodies.
create or replace function
  public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
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
  v_marker jsonb :=
    p_request_payload#>'{arguments,sellerpilotEbayExactExistingQaRecovery}';
  v_expected jsonb;
  v_product_id uuid;
  v_market text;
  v_target_id text;
  v_stock integer;
  v_marker_key_count integer;
  v_image_count integer;
  v_unique_image_count integer;
  v_all_https boolean;
  v_detail_image_count integer;
  v_unique_detail_image_count integer;
  v_all_detail_https boolean;
  v_bound_images_present boolean;
  v_inventory_description text := coalesce(
    p_request_payload#>>'{arguments,inventoryItem,product,description}', ''
  );
  v_listing_description text := coalesce(
    p_request_payload#>>'{arguments,offer,listingDescription}', ''
  );
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or v_marker is not null then
    if p_channel is distinct from 'ebay'
       or p_operation is distinct from 'listing.update'
       or p_credential_id is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
       or jsonb_typeof(v_marker) is distinct from 'object'
       or v_marker->>'contract' is distinct from
         'ebay_exact_existing_qa_recovery_v2'
       or v_marker->>'phase' is distinct from 'listing.update'
       or v_marker->>'productId' is distinct from
         'ddccde35-9c58-4856-b673-d7aa27ce4220'
       or v_marker->>'listingId' is distinct from
         '8b2cbfaf-3854-437d-b381-abfd70291354'
       or v_marker->>'sourceAttemptId' is distinct from
         '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'
       or v_marker->>'publicListingId' is distinct from '800551945442'
       or v_marker->>'market' is distinct from 'US'
       or v_marker->>'marketplaceId' is distinct from 'EBAY_US'
       or v_marker->>'marketplaceSku' is distinct from
         'QA-20260823-CC-001-US'
       or v_marker->>'offerId' is distinct from '244042196011'
       or v_marker->>'currency' is distinct from 'USD'
       or v_marker->'priceUsd' is distinct from '12.9'::jsonb
       or jsonb_typeof(v_marker->'stock') is distinct from 'number'
       or coalesce(v_marker->>'stock', '') !~ '^[1-9][0-9]{0,5}$'
       or v_marker->>'credentialId' is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'
       or v_marker->>'sellerAccountKey' is distinct from
         'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
       or v_marker->>'offerIdSource' is distinct from
         'immutable_lineage_attestation_v1'
       or v_marker->>'sellerAccountLineage' is distinct from
         'validated_by_service_rpc' then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
    select count(*) into v_marker_key_count from jsonb_object_keys(v_marker);
    if v_marker_key_count <> 17 then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
    v_stock := (v_marker->>'stock')::integer;

    select listing.product_id, listing.market, listing.target_id
      into v_product_id, v_market, v_target_id
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product
        on product.id = listing.product_id
       and product.owner_id = listing.owner_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = p_credential_id
       and credential.channel = listing.channel_key
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = p_attempt_id
       and attempt.credential_id = credential.id
       and attempt.channel = listing.channel_key
       and attempt.operation = p_operation
     where listing.id = p_listing_id
       and listing.product_id = (v_marker->>'productId')::uuid
       and listing.remote_id = v_marker->>'publicListingId'
       and listing.marketplace_sku = v_marker->>'marketplaceSku'
       and listing.provider_resource_id = v_marker->>'offerId'
       and listing.remote_resources = '{}'::jsonb
       and listing.operation_attempt_id =
         (v_marker->>'sourceAttemptId')::uuid
       and listing.seller_account_key = credential.seller_account_key
       and listing.seller_account_key = v_marker->>'sellerAccountKey'
       and listing.seller_account_key =
         'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
       and product.sku = 'QA-20260823-CC-001'
       and product.on_hand = v_stock
       and credential.id =
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
       and credential.id = (v_marker->>'credentialId')::uuid
       and credential.status = 'active'
       and credential.environment = 'production'
       and credential.version = 92
       and credential.fingerprint = 'B82F3FE28085'
       and credential.expires_at > statement_timestamp()
       and (credential.expires_at at time zone 'UTC')::date = date '2028-02-17'
       and credential.last_checked_at is not null
       and credential.last_check_status = 'passed'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
       and attempt.status = 'running'
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs active_job
          where active_job.listing_id = listing.id
            and active_job.operation in (
              'listing.create', 'listing.update', 'listing.stop'
            )
            and active_job.status in (
              'queued', 'running', 'reconciliation_required'
            )
       )
     for update of listing, product, credential, attempt;
    if not found then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    v_expected :=
      public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
        p_listing_id,
        p_credential_id,
        v_product_id,
        v_market,
        v_target_id
      );
    if v_expected is null or v_marker is distinct from v_expected then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    if jsonb_typeof(
         p_request_payload#>'{arguments,inventoryItem,product,imageUrls}'
       ) is distinct from 'array'
       or jsonb_typeof(
         p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
       ) is distinct from 'array'
       or jsonb_typeof(
         p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
       ) is distinct from 'array' then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    if p_request_payload#>>'{arguments,listingId}' is distinct from '800551945442'
       or p_request_payload#>>'{arguments,sku}' is distinct from
         'QA-20260823-CC-001-US'
       or p_request_payload#>>'{arguments,marketplaceId}' is distinct from
         'EBAY_US'
       or (p_request_payload#>'{arguments}') ? 'offerId'
       or (p_request_payload#>'{arguments}') ? 'providerResourceId'
       or p_request_payload#>>'{arguments,publicationIntent}' is distinct from
         'live'
       or p_request_payload#>>'{arguments,publicationStateContract}' is distinct from
         'verified_remote_state_v1'
       or p_request_payload#>>'{arguments,publicationExpectedLocale}' is distinct from
         'en-US'
       or p_request_payload#>>'{arguments,publicationExpectedImageCount}' is distinct from
         '8'
       or p_request_payload#>>'{arguments,inventoryItem,condition}' is distinct from
         'NEW'
       or p_request_payload#>'{arguments,inventoryItem,availability,shipToLocationAvailability,quantity}'
            is distinct from to_jsonb(v_stock)
       or p_request_payload#>'{arguments,offer,availableQuantity}'
            is distinct from to_jsonb(v_stock)
       or p_request_payload#>>'{arguments,offer,pricingSummary,price,currency}' is distinct from
         'USD'
       or (case jsonb_typeof(
         p_request_payload#>'{arguments,offer,pricingSummary,price,value}'
       )
         when 'number' then
           p_request_payload#>'{arguments,offer,pricingSummary,price,value}' is distinct from
             '12.9'::jsonb
         when 'string' then
           p_request_payload#>>'{arguments,offer,pricingSummary,price,value}'
             not in ('12.9', '12.90')
         else true
       end)
       or coalesce(trim(
         p_request_payload#>>'{arguments,inventoryItem,product,title}'
       ), '') <> ''
       or trim(regexp_replace(v_inventory_description, '<[^>]*>', ' ', 'g')) <> ''
       or trim(regexp_replace(v_listing_description, '<[^>]*>', ' ', 'g')) <> ''
       or coalesce(regexp_count(
         v_inventory_description, '<img[[:space:]>]', 1, 'i'
       ), 0) <> 8
       or coalesce(regexp_count(
         v_listing_description, '<img[[:space:]>]', 1, 'i'
       ), 0) <> 8
       or p_request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,contract}' is distinct from
         'sellerpilot_publication_asset_binding_v1'
       or p_request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,providerImageSurface}' is distinct from
         'detail_content'
       or jsonb_array_length(
         p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
       ) <> 8
       or jsonb_array_length(
         p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
       ) <> 8
       or p_request_payload#>'{arguments,publish}' = 'true'::jsonb then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    select count(*), count(distinct image_url),
           coalesce(bool_and(image_url ~ '^https://'), false)
      into v_image_count, v_unique_image_count, v_all_https
      from jsonb_array_elements_text(
        p_request_payload#>'{arguments,inventoryItem,product,imageUrls}'
      ) as images(image_url);
    if v_image_count <> 1
       or v_unique_image_count <> 1
       or not v_all_https then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    select count(*), count(distinct image->>'publicUrl'),
           coalesce(bool_and((image->>'publicUrl') ~ '^https://'), false),
           coalesce(bool_and(
             position(format('src="%s"', image->>'publicUrl') in
               v_inventory_description) > 0
             and position(format('src="%s"', image->>'publicUrl') in
               v_listing_description) > 0
           ), false)
      into v_detail_image_count, v_unique_detail_image_count,
           v_all_detail_https, v_bound_images_present
      from jsonb_array_elements(
        p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
      ) as detail_images(image);
    if v_detail_image_count <> 8
       or v_unique_detail_image_count <> 8
       or not v_all_detail_https
       or not v_bound_images_present then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
  end if;

  return public.sellerpilot_311430_enqueue_before_ebay_exact_existing_qa_fence(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  )
$$;

revoke all on function
  public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is
  'Preserves every existing enqueue and immutable eBay lineage fence while accepting only a copy-free exact QA request with one representative and eight approved bound detail images; provider English copy is derived after official read preflight.';

commit;
