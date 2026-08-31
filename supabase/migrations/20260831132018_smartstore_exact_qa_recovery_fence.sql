begin;

create function public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
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
    'contract', 'smartstore_exact_qa_recovery_v1',
    'phase', 'listing.update',
    'productId', product.id,
    'listingId', listing.id,
    'originProductNo', listing.remote_id,
    'channelProductNo', '13732202182',
    'centralSku', product.sku,
    'sellerManagementCodeSource', 'provider_readback_required',
    'sellerAccountLineage', 'validated_by_service_rpc'
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
   where p_listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'smartstore'
     and listing.remote_id = '13671684696'
     and listing.marketplace_sku is null
     and listing.remote_resources = '{}'::jsonb
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.currency = 'KRW'
     and listing.price = 5000
     and product.sku = 'QA-20260823-CC-001'
     and not product.demo
     and product.status = 'draft'
     and coalesce(listing.market, '') = trim(coalesce(p_market, ''))
     and coalesce(listing.target_id, '') = trim(coalesce(p_target_id, ''))
     and listing.seller_account_key =
       'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
     and credential.status = 'active'
     and credential.environment = 'production'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and credential.seller_account_key = listing.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
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
  public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_31132018_reserve_before_smartstore_exact_qa_fence;

revoke all on function
  public.sellerpilot_31132018_reserve_before_smartstore_exact_qa_fence(
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
  if p_channel = 'smartstore'
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid then
    raise exception 'SMARTSTORE_EXACT_QA_DUPLICATE_CREATE_FORBIDDEN'
      using errcode = '55000';
  end if;
  return public.sellerpilot_31132018_reserve_before_smartstore_exact_qa_fence(
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
) rename to sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence;

revoke all on function
  public.sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence(
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
    p_request_payload#>'{arguments,sellerpilotSmartstoreExactQaRecovery}';
  v_marker_key_count integer;
  v_expected jsonb;
  v_product_id uuid;
  v_market text;
  v_target_id text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     or v_marker is not null then
    if p_channel <> 'smartstore'
       or p_operation <> 'listing.update'
       or jsonb_typeof(v_marker) is distinct from 'object'
       or v_marker->>'contract' <> 'smartstore_exact_qa_recovery_v1'
       or v_marker->>'phase' <> 'listing.update'
       or v_marker->>'productId' <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'
       or v_marker->>'listingId' <> '7babb554-48dc-4869-81b1-cd4d435d7b96'
       or v_marker->>'originProductNo' <> '13671684696'
       or v_marker->>'channelProductNo' <> '13732202182'
       or v_marker->>'centralSku' <> 'QA-20260823-CC-001'
       or v_marker->>'sellerManagementCodeSource'
            <> 'provider_readback_required'
       or v_marker->>'sellerAccountLineage'
            <> 'validated_by_service_rpc' then
      raise exception 'SMARTSTORE_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
    select count(*) into v_marker_key_count from jsonb_object_keys(v_marker);
    if v_marker_key_count <> 9 then
      raise exception 'SMARTSTORE_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

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
       and listing.id = (v_marker->>'listingId')::uuid
       and listing.product_id = (v_marker->>'productId')::uuid
       and listing.remote_id = v_marker->>'originProductNo'
       and listing.marketplace_sku is null
       and listing.remote_resources = '{}'::jsonb
       and listing.seller_account_key = credential.seller_account_key
       and listing.seller_account_key =
         'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
       and product.sku = v_marker->>'centralSku'
       and credential.status = 'active'
       and credential.environment = 'production'
       and credential.seller_account_key_source in (
         'provider_certified_v1', 'credential_incarnation_v1'
       )
       and credential.seller_account_verified_at is not null
       and (credential.expires_at is null
         or credential.expires_at > statement_timestamp())
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
      raise exception 'SMARTSTORE_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    v_expected :=
      public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
        p_listing_id,
        p_credential_id,
        v_product_id,
        v_market,
        v_target_id
      );
    if v_expected is null or v_marker is distinct from v_expected then
      raise exception 'SMARTSTORE_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    if p_request_payload#>>'{arguments,originProductNo}' <> '13671684696'
       or p_request_payload#>>'{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}'
            <> 'QA-20260823-CC-001'
       or p_request_payload#>>'{arguments,body,originProduct,salePrice}'
            <> '5000'
       or coalesce(
         p_request_payload#>>'{arguments,body,originProduct,stockQuantity}', ''
       ) !~ '^[1-9][0-9]{0,7}$'
       or p_request_payload#>>'{arguments,publicationIntent}' <> 'live'
       or p_request_payload#>>'{arguments,publicationExpectedLocale}' <> 'ko-KR'
       or p_request_payload#>>'{arguments,publicationExpectedImageCount}' <> '8'
    then
      raise exception 'SMARTSTORE_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
  end if;

  return public.sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence(
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
  public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) is
  'Returns one exact existing Smartstore QA origin/channel tuple. Null marketplace_sku remains unmodified; provider sellerManagementCode must be read back before any image or listing mutation.';
comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is
  'Preserves existing listing enqueue gates and adds an atomic exact-ledger fence for one Smartstore QA recovery update.';

commit;
