begin;

create function public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'ebay_exact_existing_qa_recovery_v2',
    'phase', 'listing.update',
    'productId', product.id,
    'listingId', listing.id,
    'sourceAttemptId', listing.operation_attempt_id,
    'publicListingId', listing.remote_id,
    'market', listing.market,
    'marketplaceId', listing.target_id,
    'marketplaceSku', listing.marketplace_sku,
    'offerId', listing.provider_resource_id,
    'currency', listing.currency,
    'priceUsd', listing.price,
    'stock', product.on_hand,
    'credentialId', credential.id,
    'sellerAccountKey', listing.seller_account_key,
    'offerIdSource', 'immutable_lineage_attestation_v1',
    'sellerAccountLineage', 'validated_by_service_rpc'
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
    join sellerpilot_private.provider_listing_lineage_attestations attestation
      on attestation.listing_id = listing.id
    join sellerpilot_private.channel_gateway_jobs lineage_job
      on lineage_job.id = attestation.gateway_job_id
    join sellerpilot_private.channel_credentials lineage_credential
      on lineage_credential.id = attestation.credential_id
   where p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and p_credential_id = 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'ebay'
     and listing.remote_id = '800551945442'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.remote_resources = '{}'::jsonb
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.currency = 'USD'
     and listing.price = 12.90
     and listing.operation_attempt_id =
       '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid
     and listing.market = 'US'
     and listing.target_id = 'EBAY_US'
     and trim(coalesce(p_market, '')) = 'US'
     and trim(coalesce(p_target_id, '')) = 'EBAY_US'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand between 1 and 999999
     and not product.demo
     and product.status <> 'archived'
     and listing.seller_account_key =
       'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and credential.id = 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
     and credential.status = 'active'
     and credential.environment = 'production'
     and credential.version = 92
     and credential.fingerprint = 'B82F3FE28085'
     and credential.expires_at > statement_timestamp()
     and (credential.expires_at at time zone 'UTC')::date = date '2028-02-17'
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
     and credential.seller_account_key = listing.seller_account_key
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and attestation.id = 'fc54f95c-3533-4dbd-820f-cb2dfaf018e7'::uuid
     and attestation.credential_id =
       'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1'::uuid
     and attestation.gateway_job_id =
       'fdff6983-1f08-4f51-a751-bc61b4bf7070'::uuid
     and attestation.channel = 'ebay'
     and attestation.environment = 'production'
     and attestation.seller_account_key = listing.seller_account_key
     and attestation.expected_remote_id = listing.remote_id
     and attestation.verified_remote_id = listing.remote_id
     and attestation.market = listing.market
     and attestation.target_id = listing.target_id
     and attestation.marketplace_sku = listing.marketplace_sku
     and attestation.provider_resource_id = listing.provider_resource_id
     and attestation.evidence_version = 'provider_listing_readback_v1'
     and attestation.evidence_digest =
       '3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a'
     and attestation.verified_at is not null
     and lineage_job.id =
       'fdff6983-1f08-4f51-a751-bc61b4bf7070'::uuid
     and lineage_job.listing_id = listing.id
     and lineage_job.credential_id = attestation.credential_id
     and lineage_job.channel = 'ebay'
     and lineage_job.environment = 'production'
     and lineage_job.operation = 'listing.lineage.verify'
     and lineage_job.status = 'succeeded'
     and lineage_job.seller_account_key = listing.seller_account_key
     and lineage_credential.id =
       'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1'::uuid
     and lineage_credential.channel = 'ebay'
     and lineage_credential.environment = 'production'
     and lineage_credential.status = 'revoked'
     and lineage_credential.version = 84
     and lineage_credential.fingerprint = 'A48BC6BD3D4B'
     and lineage_credential.seller_account_key = listing.seller_account_key
     and lineage_credential.seller_account_key_source = 'provider_certified_v1'
     and lineage_credential.seller_account_verified_at is not null
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
   limit 1;
$$;

revoke all on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_311430_reserve_before_ebay_exact_existing_qa_fence;

revoke all on function
  public.sellerpilot_311430_reserve_before_ebay_exact_existing_qa_fence(
    uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_channel = 'ebay' and (
    (
      p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
      and upper(trim(coalesce(p_market, ''))) = 'US'
      and upper(trim(coalesce(p_target_id, ''))) = 'EBAY_US'
    )
    or p_request_payload#>>'{arguments,sku}' = 'QA-20260823-CC-001-US'
    or p_request_payload#>>'{arguments,offer,sku}' = 'QA-20260823-CC-001-US'
    or p_request_payload#>>'{arguments,listingId}' = '800551945442'
  ) then
    raise exception 'EBAY_EXACT_EXISTING_QA_DUPLICATE_CREATE_FORBIDDEN'
      using errcode = '55000';
  end if;
  return public.sellerpilot_311430_reserve_before_ebay_exact_existing_qa_fence(
    p_product_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_market,
    p_target_id,
    p_currency,
    p_price,
    p_request_fingerprint,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_311430_enqueue_before_ebay_exact_existing_qa_fence;

revoke all on function
  public.sellerpilot_311430_enqueue_before_ebay_exact_existing_qa_fence(
    uuid, uuid, uuid, text, text, jsonb
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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or v_marker is not null then
    if p_channel is distinct from 'ebay'
       or p_operation is distinct from 'listing.update'
       or p_credential_id is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
       or jsonb_typeof(v_marker) is distinct from 'object'
       or v_marker->>'contract' is distinct from 'ebay_exact_existing_qa_recovery_v2'
       or v_marker->>'phase' is distinct from 'listing.update'
       or v_marker->>'productId' is distinct from 'ddccde35-9c58-4856-b673-d7aa27ce4220'
       or v_marker->>'listingId' is distinct from '8b2cbfaf-3854-437d-b381-abfd70291354'
       or v_marker->>'sourceAttemptId' is distinct from '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'
       or v_marker->>'publicListingId' is distinct from '800551945442'
       or v_marker->>'market' is distinct from 'US'
       or v_marker->>'marketplaceId' is distinct from 'EBAY_US'
       or v_marker->>'marketplaceSku' is distinct from 'QA-20260823-CC-001-US'
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
       or p_request_payload#>>'{arguments,sku}' is distinct from 'QA-20260823-CC-001-US'
       or p_request_payload#>>'{arguments,marketplaceId}' is distinct from 'EBAY_US'
       or (p_request_payload#>'{arguments}') ? 'offerId'
       or (p_request_payload#>'{arguments}') ? 'providerResourceId'
       or p_request_payload#>>'{arguments,publicationIntent}' is distinct from 'live'
       or p_request_payload#>>'{arguments,publicationStateContract}' is distinct from
         'verified_remote_state_v1'
       or p_request_payload#>>'{arguments,publicationExpectedLocale}' is distinct from 'en-US'
       or p_request_payload#>>'{arguments,publicationExpectedImageCount}' is distinct from '8'
       or p_request_payload#>>'{arguments,inventoryItem,condition}' is distinct from 'NEW'
       or p_request_payload#>'{arguments,inventoryItem,availability,shipToLocationAvailability,quantity}'
            is distinct from to_jsonb(v_stock)
       or p_request_payload#>'{arguments,offer,availableQuantity}'
            is distinct from to_jsonb(v_stock)
       or p_request_payload#>>'{arguments,offer,pricingSummary,price,currency}' is distinct from 'USD'
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
       or coalesce(length(trim(
         p_request_payload#>>'{arguments,inventoryItem,product,title}'
       )), 0) not between 2 and 80
       or coalesce(length(trim(
         p_request_payload#>>'{arguments,inventoryItem,product,description}'
       )), 0) < 20
       or coalesce(length(trim(
         p_request_payload#>>'{arguments,offer,listingDescription}'
       )), 0) < 20
       or coalesce(regexp_count(
         p_request_payload#>>'{arguments,inventoryItem,product,description}',
         '<img[[:space:]>]', 1, 'i'
       ), 0) < 8
       or coalesce(regexp_count(
         p_request_payload#>>'{arguments,offer,listingDescription}',
         '<img[[:space:]>]', 1, 'i'
       ), 0) < 8
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
    if v_image_count not between 1 and 12
       or v_unique_image_count <> v_image_count
       or not v_all_https then
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

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

comment on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) is
  'Returns only the exact failed/live eBay US QA tuple whose immutable lineage attestation binds offer 244042196011 and whose current writer is the fixed v92 provider-certified credential.';
comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is
  'Preserves all existing listing enqueue gates and atomically fences one exact eBay update to offer 244042196011, en-US content, approved images, USD 12.90, central stock, and no client offer ID.';

commit;
