-- Reclassify the one exact Coupang QA listing after a proved pre-gateway
-- Vercel failure. The failed attempt has the durable pre_gateway_retryable
-- marker and no gateway job, so the provider boundary was never crossed.
-- This migration does not create a listing, arm a permit, or change the
-- global publication gate.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908250001);

do $reconcile_coupang_exact_pre_gateway_failure$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_listing_id constant uuid :=
    '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid;
  v_attempt_id constant uuid :=
    'edea9f6b-6527-4367-96cb-08b368ea80f9'::uuid;
  v_safe_message constant text :=
    'Vercel 서버리스 채널 게이트웨이에서 안전하게 처리된 오류가 발생했습니다.';
  v_present_rows integer;
  v_updated_rows integer;
begin
  select
    (select count(*) from sellerpilot_private.product_listings listing
      where listing.id = v_listing_id)
    +
    (select count(*) from sellerpilot_private.channel_operation_attempts attempt
      where attempt.id = v_attempt_id)
    into v_present_rows;

  -- Clean migration replay must not manufacture the production QA tuple.
  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 2 then
    raise exception 'COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_INCOMPLETE'
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
     and listing.remote_resources = '{}'::jsonb
     and listing.seller_account_key ~ '^[a-f0-9]{64}$'
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
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
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
   for update of listing, product, attempt, credential;

  if not found then
    raise exception 'COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_MISMATCH'
      using errcode = '55000';
  end if;

  -- external_action is the existing exact-recovery classifier. It means the
  -- current remote product was independently read back and may enter the
  -- server-owned immutable-ID checks; it does not itself authorize a write.
  update sellerpilot_private.product_listings listing
     set failure_class = 'external_action'
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and listing.failure_class = 'retryable'
     and listing.last_error = v_safe_message;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_UPDATE_FAILED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id = v_listing_id
       and listing.failure_class = 'external_action'
       and listing.operation_attempt_id = v_attempt_id
       and listing.remote_id = '16356981734'
       and listing.market = 'KR'
       and listing.target_id = 'KR'
       and listing.remote_visibility = 'unknown'
       and listing.provider_status is null
       and listing.published_at is null
  ) then
    raise exception 'COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_POSTIMAGE_INVALID'
      using errcode = '55000';
  end if;
end;
$reconcile_coupang_exact_pre_gateway_failure$;

commit;
