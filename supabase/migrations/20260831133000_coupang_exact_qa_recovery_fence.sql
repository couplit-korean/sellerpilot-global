begin;

create function public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text,
  p_phase text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'coupang_exact_qa_recovery_v1',
    'phase', p_phase,
    'productId', product.id,
    'listingId', listing.id,
    'sellerProductId', listing.remote_id,
    'vendorItemId', '95962393877',
    'sellerSku', product.sku,
    'sellerAccountLineage', 'validated_by_service_rpc'
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
   where p_phase in ('listing.update', 'listing.stop')
     and p_listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'coupang'
     and listing.remote_id = '16356981734'
     and product.sku = 'QA-20260823-CC-001'
     and not product.demo
     and product.status <> 'archived'
     and coalesce(listing.market, '') = trim(coalesce(p_market, ''))
     and coalesce(listing.target_id, '') = trim(coalesce(p_target_id, ''))
     and listing.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.status = 'active'
     and credential.environment = 'production'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key = listing.seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
     and (
       (
         p_phase = 'listing.update'
         and listing.status = 'failed'
         and (listing.failure_class is null or listing.failure_class = 'external_action')
         and listing.requested_publication_intent = 'live'
         and listing.remote_visibility = 'unknown'
         and listing.provider_status is null
         and listing.published_at is null
       )
       or (
         p_phase = 'listing.stop'
         and listing.status = 'published'
         and listing.failure_class is null
         and listing.requested_publication_intent = 'live'
         and listing.remote_visibility = 'live'
         and listing.published_at is not null
         and listing.remote_resources->'vendorItemIds'
               = '["95962393877"]'::jsonb
       )
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
   limit 1;
$$;

revoke all on function
  public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text, text
  ) to service_role;

alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_311330_reserve_listing_before_coupang_exact_qa_fence;

revoke all on function
  public.sellerpilot_311330_reserve_listing_before_coupang_exact_qa_fence(
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
  if p_channel = 'coupang'
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid then
    raise exception 'COUPANG_EXACT_QA_DUPLICATE_CREATE_FORBIDDEN'
      using errcode = '55000';
  end if;
  return public.sellerpilot_311330_reserve_listing_before_coupang_exact_qa_fence(
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
) rename to sellerpilot_311330_enqueue_listing_before_coupang_exact_qa_fence;

revoke all on function
  public.sellerpilot_311330_enqueue_listing_before_coupang_exact_qa_fence(
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
  v_marker jsonb := p_request_payload#>'{arguments,sellerpilotCoupangExactQaRecovery}';
  v_marker_key_count integer;
  v_expected jsonb;
  v_product_id uuid;
  v_market text;
  v_target_id text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
     or v_marker is not null then
    if p_channel <> 'coupang'
       or p_operation not in ('listing.update', 'listing.stop')
       or jsonb_typeof(v_marker) is distinct from 'object'
       or v_marker->>'contract' <> 'coupang_exact_qa_recovery_v1'
       or v_marker->>'phase' <> p_operation
       or v_marker->>'productId' <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'
       or v_marker->>'listingId' <> '7ffc6e46-3173-4695-9889-5fa1529765f1'
       or v_marker->>'sellerProductId' <> '16356981734'
       or v_marker->>'vendorItemId' <> '95962393877'
       or v_marker->>'sellerSku' <> 'QA-20260823-CC-001'
       or v_marker->>'sellerAccountLineage' <> 'validated_by_service_rpc' then
      raise exception 'COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
    select count(*) into v_marker_key_count from jsonb_object_keys(v_marker);
    if v_marker_key_count <> 8 then
      raise exception 'COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
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
       and listing.remote_id = v_marker->>'sellerProductId'
       and listing.seller_account_key = credential.seller_account_key
       and product.sku = v_marker->>'sellerSku'
       and credential.status = 'active'
       and credential.environment = 'production'
       and credential.seller_account_key_source = 'credential_incarnation_v1'
       and credential.seller_account_verified_at is not null
       and (credential.expires_at is null or credential.expires_at > statement_timestamp())
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
      raise exception 'COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    v_expected := public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
      p_listing_id,
      p_credential_id,
      v_product_id,
      v_market,
      v_target_id,
      p_operation
    );
    if v_expected is null or v_marker is distinct from v_expected then
      raise exception 'COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    if p_operation = 'listing.update' and (
      p_request_payload#>>'{arguments,body,sellerProductId}' <> '16356981734'
      or p_request_payload#>>'{arguments,publicationIntent}' <> 'live'
      or p_request_payload#>>'{arguments,publicationExpectedLocale}' <> 'ko-KR'
      or p_request_payload#>>'{arguments,publicationExpectedImageCount}' <> '8'
    ) then
      raise exception 'COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
    if p_operation = 'listing.stop' and (
      p_request_payload#>>'{arguments,sellerProductId}' <> '16356981734'
      or p_request_payload#>>'{arguments,vendorItemId}' <> '95962393877'
      or p_request_payload#>>'{arguments,sellerSku}' <> 'QA-20260823-CC-001'
      or p_request_payload#>>'{arguments,publicationExpectedImageCount}' <> '0'
    ) then
      raise exception 'COUPANG_EXACT_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
  end if;

  return public.sellerpilot_311330_enqueue_listing_before_coupang_exact_qa_fence(
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

comment on function public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
  uuid, uuid, uuid, text, text, text
) is 'Returns only the exact existing Coupang QA listing binding after immutable seller-account, SKU, remote-id, state, and active-job checks.';
comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is 'Preserves all existing listing enqueue gates and adds an atomic exact-ledger fence for the one Coupang QA recovery update/stop.';

commit;
