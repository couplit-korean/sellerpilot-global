-- Reconcile one exact 11st listing after an operator verified the final remote
-- state in the CHANGHEE Seller Office session and on the public product page.
-- The migration performs no provider request, creates no gateway job or
-- operation attempt, and never creates a second marketplace product.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 957325581);

create table sellerpilot_private.elevenst_manual_live_reconciliations (
  listing_id uuid primary key check (
    listing_id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
  ) references sellerpilot_private.product_listings(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null check (
    product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
  ) references sellerpilot_private.products(id) on delete restrict,
  source_attempt_id uuid not null check (
    source_attempt_id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
  ) references sellerpilot_private.channel_operation_attempts(id)
    on delete restrict,
  source_job_id uuid not null check (
    source_job_id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
  ) references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null check (
    credential_id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
  ) references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (
    seller_account_key ~ '^[a-f0-9]{64}$'
  ),
  remote_id text not null check (remote_id = '9573255804'),
  seller_sku text not null check (seller_sku = 'QA-20260823-CC-001'),
  locale text not null check (locale = 'ko-KR'),
  title text not null check (title = '부착형 케이블 정리 클립 6개 세트'),
  currency text not null check (currency = 'KRW'),
  price numeric not null check (price = 5000),
  stock integer not null check (stock = 1),
  provider_status text not null check (provider_status = '103'),
  remote_visibility text not null check (remote_visibility = 'live'),
  approved_manifest_digest text not null check (
    approved_manifest_digest =
      '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
  ),
  approved_detail_image_count integer not null check (
    approved_detail_image_count = 8
  ),
  all_approved_detail_images_loaded boolean not null check (
    all_approved_detail_images_loaded
  ),
  cart_visible boolean not null check (cart_visible),
  buy_now_visible boolean not null check (buy_now_visible),
  effective_content_update_count integer not null check (
    effective_content_update_count = 1
  ),
  no_remote_effect_ui_attempt_count integer not null check (
    no_remote_effect_ui_attempt_count = 1
  ),
  sale_release_count integer not null check (sale_release_count = 1),
  new_product_created boolean not null check (not new_product_created),
  source text not null check (
    source = 'elevenst_seller_office_changhee_browser_verified_v1'
  ),
  observation_date date not null check (observation_date = date '2026-09-01'),
  observation_timezone text not null check (
    observation_timezone = 'Asia/Seoul'
  ),
  observed_at timestamptz check (observed_at is null),
  exact_observed_time_available boolean not null check (
    not exact_observed_time_available
  ),
  recorded_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.elevenst_manual_live_reconciliations
  enable row level security;
revoke all on sellerpilot_private.elevenst_manual_live_reconciliations
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_manual_live_resources(
  p_listing_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'sellerpilot_manual_remote_readback_v1',
    'resources', jsonb_build_object(
      'remoteId', receipt.remote_id,
      'sellerSku', receipt.seller_sku
    ),
    'verification', jsonb_build_object(
      'contract', receipt.source,
      'recordedAt', receipt.recorded_at,
      'verifiedAt', receipt.recorded_at,
      'observedAt', null,
      'observationWindow', jsonb_build_object(
        'date', receipt.observation_date,
        'timezone', receipt.observation_timezone,
        'exactTimeAvailable', receipt.exact_observed_time_available
      ),
      'source', '11st_seller_office_and_public_product_page',
      'browserProfile', 'CHANGHEE',
      'locale', receipt.locale,
      'identityVerified', true,
      'statusVerified', true,
      'localeVerified', true,
      'commerceVerified', true,
      'contentVerified', true,
      'remoteVisibility', receipt.remote_visibility,
      'providerStatus', receipt.provider_status,
      'title', receipt.title,
      'currency', receipt.currency,
      'price', receipt.price,
      'stock', receipt.stock,
      'imageCount', receipt.approved_detail_image_count,
      'detailImageCount', receipt.approved_detail_image_count,
      'approvedManifestDigest', receipt.approved_manifest_digest,
      'allApprovedDetailImagesLoaded',
        receipt.all_approved_detail_images_loaded,
      'purchaseControls', jsonb_build_object(
        'cartVisible', receipt.cart_visible,
        'buyNowVisible', receipt.buy_now_visible
      ),
      'providerActions', jsonb_build_object(
        'effectiveContentUpdateCount',
          receipt.effective_content_update_count,
        'noRemoteEffectUiAttemptCount',
          receipt.no_remote_effect_ui_attempt_count,
        'saleReleaseCount', receipt.sale_release_count,
        'newProductCreated', receipt.new_product_created
      )
    )
  )
    from sellerpilot_private.elevenst_manual_live_reconciliations receipt
   where receipt.listing_id = p_listing_id
$$;

revoke all on function
  sellerpilot_private.elevenst_manual_live_resources(uuid)
  from public, anon, authenticated, service_role;

create function
  sellerpilot_private.elevenst_manual_live_reconciliation_update_allowed(
    p_old jsonb,
    p_new jsonb,
    p_listing_id uuid
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt sellerpilot_private.elevenst_manual_live_reconciliations%rowtype;
  v_resources jsonb;
begin
  if jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object'
     or p_listing_id <> '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
     or p_old->>'id' <> p_listing_id::text
     or p_new->>'id' <> p_listing_id::text then
    return false;
  end if;

  select receipt.* into v_receipt
    from sellerpilot_private.elevenst_manual_live_reconciliations receipt
   where receipt.listing_id = p_listing_id
     and receipt.product_id =
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and receipt.source_attempt_id =
       '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
     and receipt.source_job_id =
       'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
     and receipt.credential_id =
       'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
     and receipt.remote_id = '9573255804'
     and receipt.seller_sku = 'QA-20260823-CC-001'
     and receipt.locale = 'ko-KR'
     and receipt.title = '부착형 케이블 정리 클립 6개 세트'
     and receipt.currency = 'KRW'
     and receipt.price = 5000
     and receipt.stock = 1
     and receipt.provider_status = '103'
     and receipt.remote_visibility = 'live'
     and receipt.approved_detail_image_count = 8
     and receipt.all_approved_detail_images_loaded
     and receipt.cart_visible
     and receipt.buy_now_visible
     and receipt.effective_content_update_count = 1
     and receipt.no_remote_effect_ui_attempt_count = 1
     and receipt.sale_release_count = 1
     and not receipt.new_product_created
     and receipt.source =
       'elevenst_seller_office_changhee_browser_verified_v1'
     and receipt.observation_date = date '2026-09-01'
     and receipt.observation_timezone = 'Asia/Seoul'
     and receipt.observed_at is null
     and not receipt.exact_observed_time_available;
  if not found then return false; end if;

  v_resources := sellerpilot_private.elevenst_manual_live_resources(
    p_listing_id
  );
  if jsonb_typeof(v_resources) <> 'object'
     or octet_length(v_resources::text) > 65536 then
    return false;
  end if;

  return p_old->>'channel_key' = 'elevenst'
     and p_old->>'product_id' = v_receipt.product_id::text
     and p_old->>'owner_id' = v_receipt.owner_id::text
     and p_old->>'remote_id' = v_receipt.remote_id
     and p_old->>'marketplace_sku' = v_receipt.seller_sku
     and p_old->>'operation_attempt_id' = v_receipt.source_attempt_id::text
     and p_old->>'seller_account_key' = v_receipt.seller_account_key
     and p_old->>'market' = 'KR'
     and p_old->>'target_id' = 'KR'
     and p_old->>'currency' = 'KRW'
     and (p_old->>'price')::numeric = 5000
     and p_old->>'requested_publication_intent' = 'live'
     and p_old->>'status' = 'failed'
     and p_old->>'failure_class' = 'external_action'
     and p_old->>'remote_visibility' = 'unknown'
     and (p_old->'provider_status' = 'null'::jsonb
       or p_old->>'provider_status' = '105')
     and p_old->'published_at' = 'null'::jsonb
     and p_old->'last_verified_at' = 'null'::jsonb
     and p_new = p_old || jsonb_build_object(
       'status', 'published',
       'remote_visibility', 'live',
       'provider_status', v_receipt.provider_status,
       'remote_resources', v_resources,
       'published_at', to_jsonb(v_receipt.recorded_at),
       'last_verified_at', to_jsonb(v_receipt.recorded_at),
       'last_error', 'null'::jsonb,
       'failure_class', 'null'::jsonb,
       'updated_at', to_jsonb(v_receipt.recorded_at)
     );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.elevenst_manual_live_reconciliation_update_allowed(
    jsonb, jsonb, uuid
  ) from public, anon, authenticated, service_role;

-- Extend the existing listing-lineage trigger with a transaction-local branch.
-- The validator above compares the complete OLD and NEW rows and accepts only
-- the exact receipt-linked projection, so setting the marker never grants a
-- generic listing-update capability.
do $patch_listing_guard$
declare
  v_definition text;
  v_before text;
  v_branch text := '  if nullif(current_setting(''sellerpilot.elevenst_manual_live_reconciliation'', true), '''') is not null then
    if not sellerpilot_private.elevenst_manual_live_reconciliation_update_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.elevenst_manual_live_reconciliation'', true)::uuid
    ) then
      raise exception ''invalid exact 11st manual live reconciliation'';
    end if;
    return new;
  end if;

';
  v_after text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.elevenst_manual_live_reconciliation'
     ) > 0 then
    return;
  end if;

  -- Bounded migration tests deliberately omit different historical guard
  -- patches. Accept only an entry point that is known to this repository,
  -- newest first; every predecessor receives the same exact-row validator.
  if pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_partial_manual_apply'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_partial_manual_apply'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_s1_activation_apply'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_s1_activation_apply'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_adultyn_rejection_job'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_adultyn_rejection_job'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_preprovider_gate_job'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_preprovider_gate_job'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_origin_rejection_job'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_origin_rejection_job'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_rollback_retry_job'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_rollback_retry_job'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.qoo10_create_rollback_source_job'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_create_rollback_source_job'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.publication_source_pending_job'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.publication_source_pending_job'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then') > 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if current_setting(''sellerpilot.remote_publication_backfill'', true) = ''legacy-unverified-v1'' then') > 0 then
    v_before := 'begin
  if current_setting(''sellerpilot.remote_publication_backfill'', true) = ''legacy-unverified-v1'' then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if current_setting(''sellerpilot.static_listing_lineage_backfill'', true) = ''exact-static-v1'' then') > 0 then
    v_before := 'begin
  if current_setting(''sellerpilot.static_listing_lineage_backfill'', true) = ''exact-static-v1'' then';
  elsif pg_catalog.strpos(v_definition, 'begin
  if old.seller_account_key is null') > 0 then
    v_before := 'begin
  if old.seller_account_key is null';
  else
    raise exception '11st listing guard preimage drifted'
      using errcode = '55000';
  end if;

  v_after := 'begin
' || v_branch || pg_catalog.substr(v_before, length('begin
') + 1);
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_listing_guard$;

do $reconcile_exact_elevenst_manual_live$
declare
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_snapshot sellerpilot_private.elevenst_listing_snapshots%rowtype;
  v_existing_receipt
    sellerpilot_private.elevenst_manual_live_reconciliations%rowtype;
  v_recorded_at timestamptz;
  v_resources jsonb;
  v_active_jobs integer;
  v_active_permits integer;
  v_same_remote_listings integer;
begin
  -- Fresh databases have none of this exact operational tuple. They replay the
  -- schema without manufacturing QA data.
  if not exists (
    select 1 from sellerpilot_private.product_listings
     where id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
  ) and not exists (
    select 1 from sellerpilot_private.products
     where id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
  ) and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts
     where id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
  ) then
    return;
  end if;

  select listing.* into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
   for update;
  select product.* into strict v_product
    from sellerpilot_private.products product
   where product.id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
   for update;
  select attempt.* into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = '84957a46-4a90-43bb-a9b6-e4f2be984b58'::uuid
   for update;
  select job.* into strict v_source_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'f7927a29-46b2-4d77-90da-759c79c50bc7'::uuid
   for update;
  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
   for update;
  select snapshot.* into strict v_snapshot
    from sellerpilot_private.elevenst_listing_snapshots snapshot
   where snapshot.listing_id = v_listing.id
   for update;

  select count(*)::integer into v_active_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'elevenst'
     and job.operation in (
       'listing.create', 'listing.update', 'listing.stop',
       'listing.activate', 'listing.publication.verify'
     )
     and job.status in ('queued', 'running', 'reconciliation_required')
     and (
       job.listing_id = v_listing.id
       or job.attempt_id = v_attempt.id
       or job.request_payload#>>'{arguments,remoteId}' = '9573255804'
       or job.request_payload#>>'{arguments,productNo}' = '9573255804'
       or job.response_payload->>'remoteId' = '9573255804'
     );
  select count(*)::integer into v_active_permits
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.channel = 'elevenst'
     and permit.listing_id = v_listing.id
     and permit.invalidated_at is null;
  select count(*)::integer into v_same_remote_listings
    from sellerpilot_private.product_listings other_listing
   where other_listing.channel_key = 'elevenst'
     and other_listing.remote_id = '9573255804';

  select receipt.* into v_existing_receipt
    from sellerpilot_private.elevenst_manual_live_reconciliations receipt
   where receipt.listing_id = v_listing.id;
  if found then
    v_resources := sellerpilot_private.elevenst_manual_live_resources(
      v_listing.id
    );
    if v_listing.status = 'published'
       and v_listing.remote_visibility = 'live'
       and v_listing.provider_status = '103'
       and v_listing.remote_resources = v_resources
       and v_listing.published_at = v_existing_receipt.recorded_at
       and v_listing.last_verified_at = v_existing_receipt.recorded_at
       and v_listing.failure_class is null
       and v_listing.last_error is null then
      return;
    end if;
    raise exception 'exact 11st manual reconciliation conflicts with existing receipt'
      using errcode = '55000';
  end if;

  if v_listing.owner_id <> v_product.owner_id
     or v_listing.product_id <> v_product.id
     or v_listing.channel_key <> 'elevenst'
     or v_listing.remote_id <> '9573255804'
     or v_listing.market <> 'KR'
     or v_listing.target_id <> 'KR'
     or v_listing.marketplace_sku <> 'QA-20260823-CC-001'
     or v_listing.currency <> 'KRW'
     or v_listing.price <> 5000
     or v_listing.status <> 'failed'
     or v_listing.failure_class <> 'external_action'
     or v_listing.requested_publication_intent <> 'live'
     or v_listing.remote_visibility <> 'unknown'
     or (
       v_listing.provider_status is not null
       and v_listing.provider_status <> '105'
     )
     or v_listing.remote_resources <> '{}'::jsonb
     or v_listing.published_at is not null
     or v_listing.last_verified_at is not null
     or v_listing.operation_attempt_id <> v_attempt.id
     or v_listing.seller_account_key is null
     or v_listing.seller_account_key !~ '^[a-f0-9]{64}$'
     or v_product.sku <> 'QA-20260823-CC-001'
     or v_product.name <> '부착형 케이블 정리 클립 6개 세트'
     or v_product.on_hand <> 1
     or v_product.status not in ('draft', 'active')
     or v_product.detail_page_version <> 1
     or v_product.detail_page_approved_version <> 1
     or v_product.detail_page_image_manifest->>'contract' <>
          'sellerpilot_detail_image_manifest_v2'
     or v_product.detail_page_image_manifest->>'digest' <>
          '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62'
     or jsonb_typeof(v_product.detail_page_image_manifest->'images') <> 'array'
     or jsonb_array_length(v_product.detail_page_image_manifest->'images') <> 8
     or v_attempt.owner_id <> v_listing.owner_id
     or v_attempt.credential_id <> v_credential.id
     or v_attempt.channel <> 'elevenst'
     or v_attempt.operation <> 'listing.create'
     or v_attempt.status <> 'succeeded'
     or v_attempt.http_status <> 200
     or v_attempt.remote_id <> '9573255804'
     or v_attempt.request_fingerprint <>
          '1da5b4b2b29ca9b70cf5e8360c3615ec2d153013f10acb652a0a0f3df7ced8af'
     or v_attempt.seller_account_key is distinct from
          v_listing.seller_account_key
     or v_credential.created_by <> v_listing.owner_id
     or v_credential.channel <> 'elevenst'
     or v_credential.environment <> 'production'
     or v_credential.version <> 2
     or v_credential.status <> 'active'
     or v_credential.fingerprint !~ '^[A-F0-9]{12}$'
     or v_credential.seller_account_key is distinct from
          v_listing.seller_account_key
     or v_credential.seller_account_key_source <>
          'credential_incarnation_v1'
     or v_credential.seller_account_verified_at is null
     or v_credential.last_checked_at is null
     or v_credential.last_check_status <> 'passed'
     or (v_credential.expires_at is not null
       and v_credential.expires_at <= statement_timestamp())
     or v_source_job.credential_id <> v_credential.id
     or v_source_job.attempt_id <> v_attempt.id
     or v_source_job.listing_id is not null
     or v_source_job.channel <> 'elevenst'
     or v_source_job.operation <> 'listing.create'
     or v_source_job.environment <> 'production'
     or v_source_job.status <> 'succeeded'
     or v_source_job.attempt_count <> 1
     or v_source_job.response_payload->>'ok' <> 'true'
     or v_source_job.response_payload->>'remoteId' <> '9573255804'
     or v_source_job.request_payload#>>'{arguments,product,sellerPrdCd}' <>
          'QA-20260823-CC-001'
     or v_source_job.request_payload#>>'{arguments,product,prdNm}' <>
          '부착형 케이블 정리 클립 6개 세트'
     or v_source_job.request_payload#>>'{arguments,product,selPrc}' <> '5000'
     or v_source_job.request_payload#>>'{arguments,product,prdSelQty}' <> '1'
     or v_snapshot.credential_id <> v_credential.id
     or v_snapshot.seller_account_key <> v_listing.seller_account_key
     or v_snapshot.remote_id <> '9573255804'
     or v_snapshot.source_job_id <> v_source_job.id
     or v_snapshot.source_operation <> 'listing.create'
     or v_snapshot.product_payload->>'sellerPrdCd' <>
          'QA-20260823-CC-001'
     or v_snapshot.product_payload->>'prdNm' <>
          '부착형 케이블 정리 클립 6개 세트'
     or v_snapshot.product_payload->>'selPrc' <> '5000'
     or v_snapshot.product_payload->>'prdSelQty' <> '1'
     or v_active_jobs <> 0
     or v_active_permits <> 0
     or v_same_remote_listings <> 1
     or exists (
       select 1 from sellerpilot_private.listing_publication_reviews review
        where review.listing_id = v_listing.id
     ) then
    raise exception 'exact 11st manual live tuple does not match'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.elevenst_manual_live_reconciliations (
    listing_id, owner_id, product_id, source_attempt_id, source_job_id,
    credential_id, seller_account_key, remote_id, seller_sku, locale,
    title, currency, price, stock, provider_status, remote_visibility,
    approved_manifest_digest, approved_detail_image_count,
    all_approved_detail_images_loaded, cart_visible, buy_now_visible,
    effective_content_update_count, no_remote_effect_ui_attempt_count,
    sale_release_count, new_product_created, source, observation_date,
    observation_timezone, observed_at, exact_observed_time_available
  ) values (
    v_listing.id, v_listing.owner_id, v_product.id, v_attempt.id,
    v_source_job.id, v_credential.id, v_listing.seller_account_key,
    '9573255804', 'QA-20260823-CC-001', 'ko-KR',
    '부착형 케이블 정리 클립 6개 세트', 'KRW', 5000, 1,
    '103', 'live',
    '728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62',
    8, true, true, true, 1, 1, 1, false,
    'elevenst_seller_office_changhee_browser_verified_v1',
    date '2026-09-01', 'Asia/Seoul', null, false
  )
  returning recorded_at into v_recorded_at;

  v_resources := sellerpilot_private.elevenst_manual_live_resources(
    v_listing.id
  );
  if jsonb_typeof(v_resources) <> 'object'
     or octet_length(v_resources::text) > 65536 then
    raise exception 'exact 11st manual live receipt is invalid'
      using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.elevenst_manual_live_reconciliation',
    v_listing.id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set status = 'published',
         remote_visibility = 'live',
         provider_status = '103',
         remote_resources = v_resources,
         published_at = v_recorded_at,
         last_verified_at = v_recorded_at,
         last_error = null,
         failure_class = null,
         updated_at = v_recorded_at
   where listing.id = v_listing.id
     and listing.operation_attempt_id = v_attempt.id
     and listing.status = 'failed'
     and listing.remote_visibility = 'unknown';
  if not found then
    raise exception 'exact 11st listing projection failed'
      using errcode = '55000';
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.elevenst_manual_live_reconciliation',
    '',
    true
  );

  update sellerpilot_private.products product
     set status = 'active',
         updated_at = v_recorded_at
   where product.id = v_product.id
     and product.owner_id = v_listing.owner_id
     and product.status in ('draft', 'active');
  if not found then
    raise exception 'exact 11st product projection failed'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    'elevenst_exact_manual_live_reconciled',
    'product_listing',
    v_listing.id::text,
    jsonb_build_object(
      'contract', 'elevenst_exact_manual_live_reconciliation_v1',
      'listingId', v_listing.id,
      'productId', v_product.id,
      'sourceAttemptId', v_attempt.id,
      'sourceJobId', v_source_job.id,
      'credentialId', v_credential.id,
      'remoteId', '9573255804',
      'sellerSku', 'QA-20260823-CC-001',
      'locale', 'ko-KR',
      'title', '부착형 케이블 정리 클립 6개 세트',
      'priceKrw', 5000,
      'stock', 1,
      'providerStatus', '103',
      'remoteVisibility', 'live',
      'approvedDetailImageCount', 8,
      'allApprovedDetailImagesLoaded', true,
      'cartVisible', true,
      'buyNowVisible', true,
      'observationDate', date '2026-09-01',
      'observationTimezone', 'Asia/Seoul',
      'observedAt', null,
      'exactObservedTimeAvailable', false,
      'recordedAt', v_recorded_at,
      'effectiveContentUpdateCount', 1,
      'noRemoteEffectUiAttemptCount', 1,
      'saleReleaseCount', 1,
      'newProductCreated', false,
      'sellerOfficeMutationObserved', true,
      'providerWritePerformedByMigration', false,
      'sellerPilotGatewayJobCreated', false,
      'sourceAttemptRewritten', false,
      'newListingCreated', false
    )
  );
exception
  when no_data_found or too_many_rows then
    raise exception 'exact 11st manual live tuple is incomplete'
      using errcode = '55000';
end;
$reconcile_exact_elevenst_manual_live$;

commit;
