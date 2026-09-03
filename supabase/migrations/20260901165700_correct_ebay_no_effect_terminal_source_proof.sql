-- Correct the exact eBay no-effect proof to the terminal gateway row observed
-- after completion. The worker and claim tokens are cleared from the terminal
-- job, while the immutable consumed permit retains the non-null binding proof.
-- The already-recorded 165500 migration remains unchanged.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000001);

create or replace function
  sellerpilot_private.ebay_exact_no_effect_source_is_proved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = job.attempt_id
      join sellerpilot_private.product_listings listing
        on listing.id = job.listing_id
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.permit_id =
             'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
       and permit.update_job_id = job.id
       and permit.update_attempt_id = attempt.id
       and permit.listing_id = listing.id
     where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
       and job.attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and job.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and job.credential_id =
             '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and job.channel = 'ebay'
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.status = 'succeeded'
       and job.attempt_count = 1
       and job.worker_token_id is null
       and job.claim_token is null
       and job.started_at =
             '2026-09-01 08:16:05.58709+00'::timestamptz
       and job.provider_mutation_started_at =
             '2026-09-01 08:16:12.740995+00'::timestamptz
       and job.completed_at =
             '2026-09-01 08:16:15.994005+00'::timestamptz
       and job.provider_mutation_started_at >= job.started_at
       and job.completed_at >= job.provider_mutation_started_at
       and job.request_fingerprint =
             '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
       and encode(extensions.digest(
             (job.request_payload->'arguments')::text, 'sha256'
           ), 'hex') =
             '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
       and encode(extensions.digest(
             job.request_payload::text, 'sha256'
           ), 'hex') =
             '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
       and job.request_payload#>>
             '{arguments,sellerpilotEbayExactExistingQaRecovery,contract}' =
             'ebay_exact_existing_qa_recovery_v2'
       and jsonb_typeof(job.response_payload) = 'object'
       and job.response_payload->>'ok' = 'false'
       and job.response_payload->>'channel' = 'ebay'
       and job.response_payload->>'operation' = 'listing.update'
       and job.response_payload->>'remoteId' = '800551945442'
       and jsonb_typeof(job.response_payload->'steps') = 'array'
       and jsonb_array_length(job.response_payload->'steps') = 4
       and job.response_payload#>>'{steps,0,name}' =
             'offer-update-discovery-readback'
       and job.response_payload#>>'{steps,0,ok}' = 'true'
       and job.response_payload#>>'{steps,1,name}' =
             'offer-update-preflight-readback'
       and job.response_payload#>>'{steps,1,ok}' = 'true'
       and job.response_payload#>>'{steps,2,name}' =
             'inventory-item-update-preflight-readback'
       and job.response_payload#>>'{steps,2,ok}' = 'true'
       and job.response_payload#>>'{steps,3,name}' =
             'inventory-item-update'
       and job.response_payload#>>'{steps,3,ok}' = 'false'
       and job.response_payload#>>'{steps,3,status}' = '400'
       and job.response_payload#>>'{steps,3,data,errors,0,errorId}' = '25718'
       and job.response_payload#>>'{steps,3,data,errors,0,domain}' =
             'API_INVENTORY'
       and job.response_payload#>>'{steps,3,data,errors,0,category}' =
             'Request'
       and job.response_payload#>>'{steps,3,data,errors,0,message}' =
             'Invalid value for description. The length should be between 1 and 4000 characters.'
       and not jsonb_path_exists(
             job.response_payload,
             '$.steps[*] ? (@.name == "offer-update")'
           )
       and attempt.id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and attempt.status = 'failed'
       and attempt.http_status = 400
       and attempt.remote_id = '800551945442'
       and attempt.completed_at = job.completed_at
       and attempt.gateway_write_required
       and not attempt.pre_gateway_retryable
       and attempt.request_fingerprint = job.request_fingerprint
       and listing.id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and listing.owner_id =
             '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and listing.product_id =
             'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = 'ebay'
       and listing.status = 'failed'
       and listing.failure_class = 'retryable'
       and listing.operation_attempt_id = attempt.id
       and listing.remote_id = '800551945442'
       and listing.market = 'US'
       and listing.target_id = 'EBAY_US'
       and listing.marketplace_sku = 'QA-20260823-CC-001-US'
       and listing.provider_resource_id = '244042196011'
       and listing.currency = 'USD'
       and listing.price = 12.90
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
       and listing.provider_status is null
       and listing.published_at is null
       and listing.seller_account_key =
             'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
       and permit.channel = 'ebay'
       and permit.release_sha =
             '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b'
       and permit.request_fingerprint = job.request_fingerprint
       and permit.arguments_sha256 =
             '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
       and permit.request_payload_sha256 =
             '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
       and permit.bound_at is not null
       and permit.bound_worker_token_id is not null
       and permit.bound_claim_token is not null
       and permit.consumed_at is not null
       and permit.consumed_at >= permit.bound_at
       and permit.consumed_at <= job.completed_at
       and (
         (
           permit.invalidated_at is null
           and permit.invalidation_reason is null
         ) or (
           permit.invalidated_at is not null
           and permit.invalidated_at >= permit.consumed_at
           and permit.invalidation_reason =
                 'ebay_deterministic_no_effect_400'
         )
       )
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_no_effect_source_is_proved()
  from public, anon, authenticated, service_role;

commit;
