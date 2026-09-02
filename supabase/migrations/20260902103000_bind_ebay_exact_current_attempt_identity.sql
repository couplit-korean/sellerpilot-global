-- Bind the exact eBay content-update identity to the current failed
-- pre-provider attempt observed in production. The previous identity RPC was
-- still pinned to an older failed attempt, so it returned null even though the
-- exact listing, current credential, product and provider lineage were valid.
--
-- This migration only replaces the read-only identity RPC. It creates no
-- permit or operation attempt, enqueues no gateway job and never calls eBay.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000008);

do $ebay_exact_current_attempt_preimage$
declare
  v_identity text;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_release_is_current(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'
     ) is null
  then
    raise exception 'eBay current-attempt identity preimage missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_identity;

  if pg_catalog.strpos(v_identity, '800551945442') = 0
     or pg_catalog.strpos(v_identity, '244042196011') = 0
     or pg_catalog.strpos(v_identity, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.strpos(
          v_identity, 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'
        ) = 0
     or pg_catalog.strpos(
          v_identity, '079cd680-47fb-4910-b3d8-27d19356e66e'
        ) <> 0
     or pg_catalog.strpos(
          v_identity, 'ebay_exact_current_credential_is_valid'
        ) = 0
  then
    raise exception 'eBay current-attempt identity preimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_current_attempt_preimage$;

create or replace function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
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
    -- The immutable provider source attestation remains the same. The
    -- current failed attempt below only proves that this retry has not crossed
    -- the gateway/provider boundary.
    'sourceAttemptId',
      '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid,
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
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
     and attempt.owner_id = listing.owner_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = listing.channel_key
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
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'ebay'
     and listing.remote_id = '800551945442'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.remote_resources = '{}'::jsonb
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.operation_attempt_id =
           '079cd680-47fb-4910-b3d8-27d19356e66e'::uuid
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.currency = 'USD'
     and listing.price = 12.90
     and listing.market = 'US'
     and listing.target_id = 'EBAY_US'
     and trim(coalesce(p_market, '')) = 'US'
     and trim(coalesce(p_target_id, '')) = 'EBAY_US'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status <> 'archived'
     and listing.seller_account_key =
       'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and attempt.id = '079cd680-47fb-4910-b3d8-27d19356e66e'::uuid
     and attempt.operation = 'listing.update'
     and attempt.status = 'failed'
     and attempt.http_status = 422
     and attempt.remote_id is null
     and attempt.gateway_write_required
     and attempt.pre_gateway_retryable
     and attempt.seller_account_key = listing.seller_account_key
     and credential.seller_account_key = listing.seller_account_key
     and sellerpilot_private.ebay_exact_current_credential_is_valid(
       credential.id, listing.seller_account_key
     )
     and sellerpilot_private.exact_existing_update_release_is_current(
       'ebay', sellerpilot_private.active_serverless_runtime_release_sha()
     )
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
         from sellerpilot_private.channel_gateway_jobs attempt_job
        where attempt_job.attempt_id = attempt.id
     )
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
   limit 1
$$;

create or replace function
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
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
  select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    p_listing_id, p_credential_id, p_product_id, p_market, p_target_id
  )
$$;

revoke all on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

do $ebay_exact_current_attempt_postimage$
declare
  v_identity text;
  v_alias text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_identity;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_alias;

  if pg_catalog.strpos(
       v_identity, '079cd680-47fb-4910-b3d8-27d19356e66e'
     ) = 0
     or pg_catalog.strpos(
          v_identity, 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'
        ) <> 0
     or pg_catalog.strpos(
          v_identity,
          'credential.version' || pg_catalog.chr(32) || '='
            || pg_catalog.chr(32) || '106'
        ) <> 0
     or pg_catalog.strpos(
          v_identity, 'attempt_job.attempt_id = attempt.id'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'exact_existing_update_release_is_current'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'active_serverless_runtime_release_sha'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'ebay_exact_current_credential_is_valid'
        ) = 0
     or pg_catalog.strpos(v_identity, '800551945442') = 0
     or pg_catalog.strpos(v_identity, '244042196011') = 0
     or pg_catalog.strpos(v_identity, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.strpos(v_identity, 'listing.price = 12.90') = 0
     or pg_catalog.strpos(v_identity, 'product.on_hand = 1') = 0
     or pg_catalog.strpos(
          v_alias,
          'sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit'
        ) = 0
  then
    raise exception 'eBay current-attempt identity postimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_current_attempt_postimage$;

comment on function
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) is
  'Returns exact eBay item 800551945442 identity only for failed no-provider attempt 079cd680, the sole current provider-certified same-seller credential, and the current closed-gate runtime.';

commit;
