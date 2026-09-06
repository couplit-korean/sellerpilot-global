-- The rollback confirmation function already accepts the current adapter's
-- Pattern B evidence. The service identity RPC still accepted only Pattern A,
-- so the UI could not bind the same confirmed S1 remote item to listing.update.
-- Extend only that read-only identity projection. This migration does not call
-- Qoo10, does not update confirmation/listing rows, and does not retry a job.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

create or replace function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
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
  v_identity record;
  v_contract constant text := 'qoo10_create_rollback_confirmation_v1';
begin
  if p_listing_id is null
     or p_credential_id is null
     or p_product_id is null
     or p_market is null
     or p_market <> trim(p_market)
     or p_market !~ '^[A-Z]{2}$'
     or p_target_id is null
     or p_target_id <> trim(p_target_id)
     or length(p_target_id) > 160 then
    return jsonb_build_object(
      'status', 'blocked',
      'contract', v_contract
    );
  end if;

  select listing.id as listing_id,
         listing.remote_id,
         listing.provider_status,
         confirmation.source_job_id,
         confirmation.category_code,
         confirmation.retail_price_jpy,
         confirmation.sell_price_jpy,
         confirmation.quantity,
         confirmation.shipping_no,
         confirmation.bi_contents_no
    into v_identity
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.product_listings listing
      on listing.id = confirmation.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = confirmation.credential_id
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = confirmation.source_job_id
    join sellerpilot_private.channel_operation_attempts source_attempt
      on source_attempt.id = confirmation.source_attempt_id
   where confirmation.listing_id = p_listing_id
     and confirmation.credential_id = p_credential_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'qoo10'
     and listing.market = p_market
     and listing.target_id = p_target_id
     and listing.status = 'paused'
     and listing.failure_class = 'retryable'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'non_public'
     and listing.provider_status = 'S1'
     and listing.published_at is null
     and listing.last_verified_at = confirmation.confirmed_at
     and listing.last_error =
       'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요'
     and listing.remote_id = confirmation.remote_id
     and listing.seller_account_key = confirmation.seller_account_key
     and listing.operation_attempt_id = confirmation.source_attempt_id
     and product.id = p_product_id
     and product.owner_id = listing.owner_id
     and not product.demo
     and product.status <> 'archived'
     and credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > statement_timestamp()
     )
     and credential.fingerprint = confirmation.credential_fingerprint
     and credential.seller_account_key = confirmation.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and confirmation.request_fingerprint ~ '^[a-f0-9]{64}$'
     and confirmation.observed_provider_status in ('S1', '1')
     and confirmation.previous_job_status = 'reconciliation_required'
     and confirmation.new_job_status = 'failed'
     and confirmation.previous_attempt_status = 'manual_required'
     and confirmation.new_attempt_status = 'failed'
     and confirmation.previous_listing_status = 'failed'
     and confirmation.new_listing_status = 'paused'
     and confirmation.previous_failure_class = 'external_action'
     and confirmation.new_failure_class = 'retryable'
     and confirmation.previous_remote_visibility = 'unknown'
     and confirmation.new_remote_visibility = 'non_public'
     and confirmation.new_provider_status = 'S1'
     and confirmation.requested_publication_intent = 'live'
     and source_job.id = confirmation.source_job_id
     and source_job.attempt_id = confirmation.source_attempt_id
     and source_job.listing_id = confirmation.listing_id
     and source_job.credential_id = confirmation.credential_id
     and source_job.channel = 'qoo10'
     and source_job.operation = 'listing.create'
     and source_job.environment = 'production'
     and source_job.status = 'failed'
     and source_job.error_message =
       'QOO10_LISTING_CREATE_ROLLBACK_CONFIRMED: provider status S1; continue only with listing.update.'
     and source_job.request_fingerprint = confirmation.request_fingerprint
     and source_job.seller_account_key = confirmation.seller_account_key
     and source_job.response_payload->>'channel' = 'qoo10'
     and source_job.response_payload->>'operation' = 'listing.create'
     and source_job.response_payload->'ok' = 'false'::jsonb
     and source_job.response_payload->>'remoteId' = confirmation.remote_id
     and source_job.request_payload#>>'{arguments,publicationIntent}' = 'live'
     and source_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
           = confirmation.request_fingerprint
     and source_job.request_payload#>>'{arguments,params,SecondSubCat}'
           = confirmation.category_code
     and source_job.request_payload#>>'{arguments,params,RetailPrice}'
           = confirmation.retail_price_jpy::text
     and source_job.request_payload#>>'{arguments,params,ItemPrice}'
           = confirmation.sell_price_jpy::text
     and source_job.request_payload#>>'{arguments,params,ItemQty}'
           = confirmation.quantity::text
     and source_job.request_payload#>>'{arguments,params,ShippingNo}'
           = confirmation.shipping_no
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,contract}'
           = 'sellerpilot_qoo10_listing_create_context_v1'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,market}'
           = 'JP'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,locale}'
           = 'ja-JP'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,currency}'
           = 'JPY'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,price}'
           = confirmation.sell_price_jpy::text
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,quantity}'
           = confirmation.quantity::text
     and jsonb_typeof(source_job.response_payload->'steps') = 'array'
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', ''))
          = 'qoo10-create-contract-preflight'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', ''))
          = 'qoo10-create-contract-preflight'
          and step->'ok' = 'true'::jsonb
          and step#>>'{data,categoryCode}' = confirmation.category_code
          and step#>>'{data,price}' = confirmation.sell_price_jpy::text
          and step#>>'{data,quantity}' = confirmation.quantity::text
          and step#>>'{data,shippingNo}' = confirmation.shipping_no
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'setnewgoods'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'setnewgoods'
          and step->'ok' = 'true'::jsonb
          and step#>>'{data,ResultObject,GdNo}' = confirmation.remote_id
          and step#>>'{data,ResultObject,BIContentsNo}'
                = confirmation.bi_contents_no::text
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'editgoodscontents'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'editgoodscontents'
          and step->'ok' = 'true'::jsonb
     )
     and (
       (
         (select count(*)
            from jsonb_array_elements(source_job.response_payload->'steps') step
           where lower(coalesce(step->>'name', '')) = 'detail-image-readback') = 1
         and exists (
           select 1
             from jsonb_array_elements(source_job.response_payload->'steps') step
            where lower(coalesce(step->>'name', '')) = 'detail-image-readback'
              and step->'ok' = 'false'::jsonb
              and step#>>'{data,detailImageCount}' = '8'
         )
         and (select count(*)
                from jsonb_array_elements(source_job.response_payload->'steps') step
               where lower(coalesce(step->>'name', '')) =
                     'getitemdetailinfo-publication-readback') = 0
       )
       or
       (
         (select count(*)
            from jsonb_array_elements(source_job.response_payload->'steps') step
           where lower(coalesce(step->>'name', '')) = 'detail-image-readback') = 1
         and exists (
           select 1
             from jsonb_array_elements(source_job.response_payload->'steps') step
            where lower(coalesce(step->>'name', '')) = 'detail-image-readback'
              and step->'ok' = 'true'::jsonb
         )
         and (select count(*)
                from jsonb_array_elements(source_job.response_payload->'steps') step
               where lower(coalesce(step->>'name', '')) =
                     'getitemdetailinfo-publication-readback') = 1
         and exists (
           select 1
             from jsonb_array_elements(source_job.response_payload->'steps') step
            where lower(coalesce(step->>'name', '')) =
                  'getitemdetailinfo-publication-readback'
              and step->'ok' = 'false'::jsonb
              and step#>>'{data,ResultMsg}' =
                  'QOO10_PUBLICATION_STATE_UNVERIFIED'
         )
         and (select min(entry.ordinality)
                from jsonb_array_elements(source_job.response_payload->'steps')
                     with ordinality entry(step, ordinality)
               where lower(coalesce(entry.step->>'name', '')) =
                     'detail-image-readback')
             <
             (select min(entry.ordinality)
                from jsonb_array_elements(source_job.response_payload->'steps')
                     with ordinality entry(step, ordinality)
               where lower(coalesce(entry.step->>'name', '')) =
                     'getitemdetailinfo-publication-readback')
         and (select min(entry.ordinality)
                from jsonb_array_elements(source_job.response_payload->'steps')
                     with ordinality entry(step, ordinality)
               where lower(coalesce(entry.step->>'name', '')) =
                     'getitemdetailinfo-publication-readback')
             <
             (select min(entry.ordinality)
                from jsonb_array_elements(source_job.response_payload->'steps')
                     with ordinality entry(step, ordinality)
               where lower(coalesce(entry.step->>'name', '')) =
                     'rollback-missing-detail')
       )
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'rollback-missing-detail'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'rollback-missing-detail'
          and step->'ok' = 'true'::jsonb
          and step#>>'{data,ResultCode}' = '0'
     )
     and source_attempt.id = source_job.attempt_id
     and source_attempt.owner_id = listing.owner_id
     and source_attempt.credential_id = source_job.credential_id
     and source_attempt.channel = source_job.channel
     and source_attempt.operation = source_job.operation
     and source_attempt.status = 'failed'
     and source_attempt.http_status = 409
     and source_attempt.gateway_write_required
     and not source_attempt.pre_gateway_retryable
     and source_attempt.remote_id = confirmation.remote_id
     and source_attempt.request_fingerprint = source_job.request_fingerprint
     and source_attempt.seller_account_key = source_job.seller_account_key
     and source_attempt.safe_message =
       'Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.';

  if not found then
    return jsonb_build_object(
      'status', 'blocked',
      'contract', v_contract
    );
  end if;

  return jsonb_build_object(
    'status', 'allowed',
    'contract', v_contract,
    'listingId', v_identity.listing_id,
    'remoteId', v_identity.remote_id,
    'providerStatus', v_identity.provider_status,
    'sourceJobId', v_identity.source_job_id,
    'expectedState', jsonb_build_object(
      'categoryCode', v_identity.category_code,
      'retailPriceJpy', v_identity.retail_price_jpy,
      'sellPriceJpy', v_identity.sell_price_jpy,
      'quantity', v_identity.quantity,
      'shippingNo', v_identity.shipping_no,
      'biContentsNo', v_identity.bi_contents_no
    )
  );
exception when others then
  return jsonb_build_object(
    'status', 'blocked',
    'contract', v_contract
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

comment on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) is 'Service-only identifier-minimizing readback of an exact Qoo10 create rollback confirmation for a later listing.update preflight.';

commit;
