-- Recover the exact existing 11st listing's full Product snapshot from its
-- already-attested successful legacy create. 11st copied the four submitted
-- images into provider-owned CDN URLs, so only those four fields are overlaid
-- from a fresh, read-only Seller Office observation. Every other Product field
-- remains byte-for-byte sourced from the historical request. This forward-only
-- repair is deliberately independent of the unapplied 20260831054000 recovery
-- flow.
-- It performs no provider request, creates no gateway job or publication
-- review, and does not change any runtime, release-gate, or static-egress
-- policy. A later listing.update must still GET the provider and match this
-- snapshot fingerprint before its first PUT.

begin;

do $recover_exact_elevenst_snapshot_forward$
declare
  v_source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing_snapshot sellerpilot_private.elevenst_listing_snapshots%rowtype;
  v_source_product jsonb;
  v_snapshot_product jsonb;
  v_image_observation_input text;
  v_image_observation_sha text;
  v_request_sha text;
  v_response_sha text;
  v_same_attempt_jobs integer;
  v_same_remote_jobs integer;
  v_later_writes integer;
  v_active_exact_jobs integer;
  v_observed_image_01 constant text :=
    'https://cdn.011st.com/product/9573255804/B.webp?15666467';
  v_observed_image_02 constant text :=
    'https://cdn.011st.com/product/9573255804/A1.webp?93344322';
  v_observed_image_03 constant text :=
    'https://cdn.011st.com/product/9573255804/A2.webp?158196316';
  v_observed_image_04 constant text :=
    'https://cdn.011st.com/product/9573255804/A3.webp?260866092';
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 957325580);

  -- Fresh databases and non-production fixtures have none of this exact
  -- identity. They must replay the schema without manufacturing QA data.
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs
     where id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
  ) and not exists (
    select 1
      from sellerpilot_private.product_listings
     where id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
  ) and not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts
     where id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
  ) then
    return;
  end if;

  select job.* into strict v_source_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
   for update;
  select attempt.* into strict v_source_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
   for update;
  select listing.* into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
   for update;
  select product.* into strict v_product
    from sellerpilot_private.products product
   where product.id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
   for update;
  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
   for update;

  v_source_product := v_source_job.request_payload#>'{arguments,product}';
  v_image_observation_input := concat_ws(
    E'\n',
    'elevenst_seller_office_read_only_image_observation_v1',
    '2026-08-31T20:19:53.322Z',
    '11st_seller_office_product_edit_read_only',
    '9573255804',
    'QA-20260823-CC-001',
    '부착형 케이블 정리 클립 6개 세트',
    '105',
    v_observed_image_01,
    v_observed_image_02,
    v_observed_image_03,
    v_observed_image_04
  );
  v_image_observation_sha := encode(
    extensions.digest(v_image_observation_input, 'sha256'), 'hex'
  );
  v_snapshot_product := v_source_product || jsonb_build_object(
    'prdImage01', v_observed_image_01,
    'prdImage02', v_observed_image_02,
    'prdImage03', v_observed_image_03,
    'prdImage04', v_observed_image_04
  );
  v_request_sha := encode(
    extensions.digest(v_source_job.request_payload::text, 'sha256'), 'hex'
  );
  v_response_sha := encode(
    extensions.digest(v_source_job.response_payload::text, 'sha256'), 'hex'
  );

  select count(*)::integer into v_same_attempt_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.attempt_id = v_source_attempt.id
     and job.channel = 'elevenst'
     and job.operation in ('listing.create', 'listing.update');
  select count(*)::integer into v_same_remote_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'elevenst'
     and job.operation in ('listing.create', 'listing.update')
     and job.response_payload->>'remoteId' = '9573255804';
  select count(*)::integer into v_later_writes
    from sellerpilot_private.channel_gateway_jobs job
   where job.id <> v_source_job.id
     and job.channel = 'elevenst'
     and job.operation in (
       'listing.create', 'listing.update', 'listing.stop', 'listing.activate'
     )
     and job.created_at > v_source_job.completed_at
     and (
       job.listing_id = v_listing.id
       or job.attempt_id = v_source_attempt.id
       or job.response_payload->>'remoteId' = '9573255804'
       or job.request_payload#>>'{arguments,remoteId}' = '9573255804'
       or job.request_payload#>>'{arguments,productNo}' = '9573255804'
     );
  select count(*)::integer into v_active_exact_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'elevenst'
     and job.status in ('queued', 'running', 'reconciliation_required')
     and (
       job.listing_id = v_listing.id
       or job.attempt_id = v_source_attempt.id
       or job.response_payload->>'remoteId' = '9573255804'
       or job.request_payload#>>'{arguments,remoteId}' = '9573255804'
       or job.request_payload#>>'{arguments,productNo}' = '9573255804'
     );

  if v_source_job.credential_id <> v_credential.id
     or v_source_job.attempt_id <> v_source_attempt.id
     or v_source_job.listing_id is not null
     or v_source_job.channel <> 'elevenst'
     or v_source_job.operation <> 'listing.create'
     or v_source_job.environment <> 'production'
     or v_source_job.status <> 'succeeded'
     or v_source_job.attempt_count <> 1
     or v_source_job.seller_account_key is not null
     or v_source_job.request_fingerprint is not null
     or v_source_job.provider_mutation_started_at is not null
     or v_source_job.created_by <> v_listing.owner_id
     or v_source_job.created_at <>
          '2026-08-24T07:42:18.57602Z'::timestamptz
     or v_source_job.started_at <>
          '2026-08-24T07:42:22.07751Z'::timestamptz
     or v_source_job.completed_at <>
          '2026-08-24T07:42:26.415136Z'::timestamptz
     or v_source_job.updated_at <>
          '2026-08-24T07:42:26.415136Z'::timestamptz
     or octet_length(v_source_job.request_payload::text) <> 4349
     or octet_length(v_source_job.response_payload::text) <> 1083
     or v_request_sha <>
          'eed923ee9a26973e58d1f8ba381c28e190296f7c89b10cce5d7ec4d4fa1dbd71'
     or v_response_sha <>
          '77debf98a349c27cbecc8a348f62e8fdf55d61d97fe87e7bac8e4d9f68fb7fd7'
     or jsonb_typeof(v_source_job.request_payload->'arguments') <> 'object'
     or (select count(*) from jsonb_object_keys(
          v_source_job.request_payload->'arguments'
        )) <> 2
     or not (v_source_job.request_payload->'arguments' ? 'product')
     or not (v_source_job.request_payload->'arguments' ? 'verificationOnly')
     or v_source_job.request_payload#>>'{arguments,verificationOnly}' <> 'true'
     or jsonb_typeof(v_source_product) <> 'object'
     or v_source_product->>'sellerPrdCd' <> 'QA-20260823-CC-001'
     or v_source_product->>'dispCtgrNo' <> '1341821'
     or v_source_product->>'prdNm' <>
          '부착형 케이블 정리 클립 6개 세트'
     or v_source_product->>'selPrc' <> '5000'
     or v_source_product->>'prdSelQty' <> '1'
     or coalesce(v_source_product->>'prdImage01', '') !~ '^https://'
     or v_image_observation_sha <>
          '2ce9e1896d7d14525bce5c509c89228520c720476defd955054ace603756f2b9'
     or v_snapshot_product->>'prdImage01' <> v_observed_image_01
     or v_snapshot_product->>'prdImage02' <> v_observed_image_02
     or v_snapshot_product->>'prdImage03' <> v_observed_image_03
     or v_snapshot_product->>'prdImage04' <> v_observed_image_04
     or (
       v_snapshot_product - 'prdImage01' - 'prdImage02' - 'prdImage03' - 'prdImage04'
     ) is distinct from (
       v_source_product - 'prdImage01' - 'prdImage02' - 'prdImage03' - 'prdImage04'
     )
     or nullif(trim(v_source_product->>'htmlDetail'), '') is null
     or v_source_product->>'htmlDetail' !~ '[가-힣]'
     or not (
       v_source_product ?& array[
         'selMthdCd', 'dispCtgrNo', 'prdTypCd', 'prdNm', 'brand',
         'rmaterialTypCd', 'orgnTypCd', 'orgnNmVal', 'sellerPrdCd',
         'suplDtyfrPrdClfCd', 'forAbrdBuyClf', 'prdStatCd',
         'minorSelCnYn', 'prdImage01', 'htmlDetail', 'ProductCertGroup',
         'selPrdClfCd', 'aplBgnDy', 'aplEndDy', 'selPrc', 'prdSelQty',
         'dlvCnAreaCd', 'dlvWyCd', 'dlvCstInstBasiCd', 'bndlDlvCnYn',
         'dlvCstPayTypCd', 'rtngdDlvCst', 'exchDlvCst', 'asDetail',
         'rtngExchDetail', 'ProductNotification'
       ]
     )
     or jsonb_typeof(v_source_job.response_payload->'steps') <> 'array'
     or jsonb_array_length(v_source_job.response_payload->'steps') <> 3
     or v_source_job.response_payload->>'ok' <> 'true'
     or v_source_job.response_payload->>'remoteId' <> '9573255804'
     or not exists (
       select 1
         from jsonb_array_elements(v_source_job.response_payload->'steps') step(value)
        where step.value->>'name' = 'product-create'
          and step.value->>'ok' = 'true'
          and step.value->>'status' = '200'
     )
     or not exists (
       select 1
         from jsonb_array_elements(v_source_job.response_payload->'steps') step(value)
        where step.value->>'name' = 'product-readback'
          and step.value->>'ok' = 'true'
          and step.value->>'status' = '200'
     )
     or not exists (
       select 1
         from jsonb_array_elements(v_source_job.response_payload->'steps') step(value)
        where step.value->>'name' = 'verification-stop-display'
          and step.value->>'ok' = 'true'
          and step.value->>'status' = '200'
     )
     or v_source_attempt.owner_id <> v_listing.owner_id
     or v_source_attempt.credential_id <> v_credential.id
     or v_source_attempt.channel <> 'elevenst'
     or v_source_attempt.operation <> 'listing.create'
     or v_source_attempt.status <> 'succeeded'
     or v_source_attempt.http_status <> 200
     or v_source_attempt.remote_id <> '9573255804'
     or v_source_attempt.request_fingerprint <>
          '1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af'
     or v_source_attempt.gateway_write_required
     or v_source_attempt.pre_gateway_retryable
     or v_source_attempt.seller_account_key is not null
     or v_listing.owner_id <> v_product.owner_id
     or v_listing.product_id <> v_product.id
     or v_listing.operation_attempt_id <> v_source_attempt.id
     or v_listing.channel_key <> 'elevenst'
     or v_listing.remote_id <> '9573255804'
     or v_listing.status <> 'failed'
     or v_listing.failure_class <> 'external_action'
     or v_listing.currency <> 'KRW'
     or v_listing.price <> 5000
     or v_listing.requested_publication_intent <> 'live'
     or v_listing.remote_visibility <> 'unknown'
     or v_listing.provider_status is not null
     or v_listing.published_at is not null
     or v_listing.seller_account_key is null
     or (
       v_listing.marketplace_sku is not null
       and v_listing.marketplace_sku <> 'QA-20260823-CC-001'
     )
     or v_product.sku <> 'QA-20260823-CC-001'
     or v_product.name <> '부착형 케이블 정리 클립 6개 세트'
     or v_product.status <> 'draft'
     or v_product.detail_page_version <> 1
     or v_product.detail_page_approved_version <> 1
     or v_product.detail_page_image_manifest->>'contract' <>
          'sellerpilot_detail_image_manifest_v2'
     or v_product.detail_page_image_manifest->>'digest' <>
          '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
     or jsonb_typeof(v_product.detail_page_image_manifest->'images') <> 'array'
     or jsonb_array_length(v_product.detail_page_image_manifest->'images') <> 8
     or v_credential.channel <> 'elevenst'
     or v_credential.environment <> 'production'
     or v_credential.version <> 2
     or v_credential.status <> 'active'
     or (
       v_credential.expires_at is not null
       and v_credential.expires_at <= clock_timestamp()
     )
     or v_credential.created_by <> v_listing.owner_id
     or v_credential.seller_account_key is distinct from
          v_listing.seller_account_key
     or v_credential.seller_account_key_source <>
          'credential_incarnation_v1'
     or v_credential.seller_account_verified_at is null
     or v_credential.last_check_status <> 'passed'
     or v_credential.last_checked_at is null
     or v_same_attempt_jobs <> 1
     or v_same_remote_jobs <> 1
     or v_later_writes <> 0
     or v_active_exact_jobs <> 0
     or exists (
       select 1
         from sellerpilot_private.listing_publication_reviews review
        where review.listing_id = v_listing.id
     )
     or sellerpilot_private.listing_mutation_release_gate_is_effective()
     or sellerpilot_private.listing_mutation_release_gate_is_effective('elevenst') then
    raise exception 'exact 11st forward snapshot tuple does not match'
      using errcode = '55000';
  end if;

  select snapshot.* into v_existing_snapshot
    from sellerpilot_private.elevenst_listing_snapshots snapshot
   where snapshot.listing_id = v_listing.id;
  if found and (
    v_existing_snapshot.credential_id is distinct from v_credential.id
    or v_existing_snapshot.seller_account_key is distinct from
         v_listing.seller_account_key
    or v_existing_snapshot.remote_id is distinct from v_listing.remote_id
    or v_existing_snapshot.product_payload is distinct from v_snapshot_product
    or v_existing_snapshot.source_job_id is distinct from v_source_job.id
    or v_existing_snapshot.source_operation is distinct from 'listing.create'
  ) then
    raise exception 'exact 11st forward snapshot conflict'
      using errcode = '55000';
  end if;

  if v_existing_snapshot.listing_id is null then
    insert into sellerpilot_private.elevenst_listing_snapshots (
      listing_id, credential_id, seller_account_key, remote_id,
      product_payload, source_job_id, source_operation
    ) values (
      v_listing.id, v_credential.id, v_listing.seller_account_key,
      v_listing.remote_id, v_snapshot_product, v_source_job.id,
      'listing.create'
    );
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    'elevenst_exact_listing_snapshot_forward_recovered',
    'product_listing',
    v_listing.id::text,
    jsonb_build_object(
      'contract', 'elevenst_exact_snapshot_forward_recovery_v1',
      'listingId', v_listing.id,
      'productId', v_product.id,
      'credentialId', v_credential.id,
      'sourceJobId', v_source_job.id,
      'sourceAttemptId', v_source_attempt.id,
      'remoteId', v_listing.remote_id,
      'sellerSku', 'QA-20260823-CC-001',
      'sourceRequestSha256', v_request_sha,
      'sourceResponseSha256', v_response_sha,
      'providerImageObservation', jsonb_build_object(
        'contract', 'elevenst_seller_office_read_only_image_observation_v1',
        'source', '11st_seller_office_product_edit_read_only',
        'observedAt', '2026-08-31T20:19:53.322Z',
        'remoteId', '9573255804',
        'sellerSku', 'QA-20260823-CC-001',
        'title', '부착형 케이블 정리 클립 6개 세트',
        'sellerStatusCode', '105',
        'sha256', v_image_observation_sha,
        'imageUrls', jsonb_build_array(
          v_observed_image_01,
          v_observed_image_02,
          v_observed_image_03,
          v_observed_image_04
        )
      ),
      'providerImageNormalizationOverlayOnly', true,
      'historicalSourceFieldsPreservedExceptProviderImages', true,
      'approvedDetailImageCount', 8,
      'marketplaceSkuBackfilled', false,
      'legacyListingMarketplaceSkuPreserved', v_listing.marketplace_sku is null,
      'providerWritePerformed', false,
      'gatewayJobCreated', false,
      'publicationReviewCreated', false,
      'listingPublicationStateChanged', false,
      'runtimeStaticEgressChanged', false,
      'releaseGateChanged', false,
      'requiresFreshProviderPreflight', true
    )
  );
exception
  when no_data_found or too_many_rows then
    raise exception 'exact 11st forward snapshot tuple is incomplete'
      using errcode = '55000';
end;
$recover_exact_elevenst_snapshot_forward$;

commit;
