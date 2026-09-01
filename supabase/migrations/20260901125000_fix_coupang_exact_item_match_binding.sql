-- Ordered after the applied Smartstore 20260901120000 migration and before the
-- pending 11st 20260901130000 migration.
-- The exact Coupang update reached the idempotency attempt but rolled back
-- before a durable gateway job because the server carried the seller SKU as
-- sellerpilotItemMatchId while the closed-gate permit correctly required the
-- provider-owned vendorItemId. Retire only that proved unbound permit and
-- restore only that proved pre-gateway listing to its exact recovery class.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 911000001);

do $reconcile_coupang_exact_item_match_pre_gateway_failure$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_listing_id constant uuid :=
    '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid;
  v_attempt_id constant uuid :=
    '29b3a950-295c-4e78-9748-4e97ae9e4aef'::uuid;
  v_permit_id constant uuid :=
    'ad3ad7ad-11d5-4151-93dc-969e762facfb'::uuid;
  v_release_sha constant text :=
    '8671d3ac311f450a0ef425da18694a049cb2b08b';
  v_safe_message constant text :=
    'Vercel 서버리스 채널 게이트웨이에서 안전하게 처리된 오류가 발생했습니다.';
  v_present_rows integer;
  v_updated_rows integer;
begin
  -- Some bounded migration-contract tests intentionally replay only an older
  -- schema prefix. This production reconciliation must remain a no-op until
  -- the closed-gate permit ledger itself exists; it must never create or infer
  -- that ledger on an older schema image.
  if to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  select
    (select count(*) from sellerpilot_private.product_listings listing
      where listing.id = v_listing_id)
    +
    (select count(*) from sellerpilot_private.channel_operation_attempts attempt
      where attempt.id = v_attempt_id)
    +
    (select count(*) from sellerpilot_private.exact_existing_update_permits permit
      where permit.permit_id = v_permit_id)
    into v_present_rows;

  -- Clean migration replay must not manufacture this production-only tuple.
  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 3 then
    raise exception 'COUPANG_EXACT_ITEM_MATCH_RECONCILIATION_INCOMPLETE'
      using errcode = '55000';
  end if;

  perform 1
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
     and attempt.owner_id = listing.owner_id
     and attempt.channel = listing.channel_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = attempt.credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = v_permit_id
     and permit.channel = listing.channel_key
     and permit.listing_id = listing.id
     and permit.product_id = listing.product_id
     and permit.owner_id = listing.owner_id
     and permit.credential_id = credential.id
     and permit.seller_account_key = listing.seller_account_key
     and permit.request_fingerprint = attempt.request_fingerprint
   where listing.id = v_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'coupang'
     and listing.remote_id = '16356981734'
     and listing.market = 'KR'
     and listing.target_id = 'KR'
     and listing.currency = 'KRW'
     and listing.price = 5000
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.operation_attempt_id = v_attempt_id
     and listing.last_error = v_safe_message
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status <> 'archived'
     and attempt.id = v_attempt_id
     and attempt.operation = 'listing.update'
     and attempt.status = 'failed'
     and attempt.http_status = 422
     and attempt.remote_id is null
     and attempt.safe_message = v_safe_message
     and attempt.gateway_write_required
     and attempt.pre_gateway_retryable
     and attempt.completed_at is not null
     and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
     and attempt.seller_account_key = listing.seller_account_key
     and credential.status = 'active'
     and credential.environment = 'production'
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
     and credential.last_check_status = 'passed'
     and credential.last_checked_at is not null
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and permit.release_sha = v_release_sha
     and permit.armed_at = '2026-09-01 03:42:58.975594+00'::timestamptz
     and permit.expires_at = '2026-09-01 03:47:58.975594+00'::timestamptz
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.arguments_sha256 is null
     and permit.arguments_bytes is null
     and permit.request_payload_sha256 is null
     and permit.request_payload_bytes is null
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp()
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
           or job.id = permit.update_job_id
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = v_listing_id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   for update of listing, product, attempt, credential, permit;

  if not found then
    raise exception 'COUPANG_EXACT_ITEM_MATCH_RECONCILIATION_MISMATCH'
      using errcode = '55000';
  end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.permit_id = v_permit_id
     and permit.channel = 'coupang'
     and permit.listing_id = v_listing_id
     and permit.release_sha = v_release_sha
     and permit.request_fingerprint = (
       select attempt.request_fingerprint
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = v_attempt_id
          and attempt.credential_id = permit.credential_id
     )
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.bound_at is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at <= statement_timestamp()
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
     );

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_ITEM_MATCH_PERMIT_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.product_listings listing
     set failure_class = 'external_action'
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and listing.failure_class = 'retryable'
     and listing.last_error = v_safe_message;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_ITEM_MATCH_LISTING_RESTORE_FAILED'
      using errcode = '55000';
  end if;
end;
$reconcile_coupang_exact_item_match_pre_gateway_failure$;

commit;
