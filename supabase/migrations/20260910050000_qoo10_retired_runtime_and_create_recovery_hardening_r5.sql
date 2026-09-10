-- Qoo10 r5: retire the active Lotte/existing-product runtime, re-read
-- current product/listing state at the CREATE mutation CAS, and persist
-- official GET-only recovery so a lost SetNewGoods response is not a
-- permanent manual 409. Existing item 1217536689 is never a fresh CREATE.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 901005000);

-- Safe DB retirement of the 2026-09-09 Lotte/existing-product RPCs.
-- Historical migration bodies stay immutable; execute is revoked.
do $retire_qoo10_lotte_runtime$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_record_qoo10_lotte_existing_carrier_source(jsonb)'
  ) is not null then
    revoke all on function public.sellerpilot_service_record_qoo10_lotte_existing_carrier_source(jsonb)
      from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_get_qoo10_lotte_existing_carrier_source(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,text)'
  ) is not null then
    revoke all on function public.sellerpilot_service_get_qoo10_lotte_existing_carrier_source(
      uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,text
    ) from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_record_qoo10_existing_requirement(text,uuid,uuid,text,jsonb,text,jsonb)'
  ) is not null then
    revoke all on function public.sellerpilot_service_record_qoo10_existing_requirement(
      text,uuid,uuid,text,jsonb,text,jsonb
    ) from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_get_qoo10_lotte_existing_postwrite_context(uuid,uuid)'
  ) is not null then
    revoke all on function public.sellerpilot_service_get_qoo10_lotte_existing_postwrite_context(
      uuid,uuid
    ) from public, anon, authenticated, service_role;
  end if;
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_complete_qoo10_lotte_existing_postwrite(uuid,uuid,uuid,uuid,text,text,jsonb)'
  ) is not null then
    revoke all on function public.sellerpilot_service_complete_qoo10_lotte_existing_postwrite(
      uuid,uuid,uuid,uuid,text,text,jsonb
    ) from public, anon, authenticated, service_role;
  end if;
end;
$retire_qoo10_lotte_runtime$;

-- Shortened fulfillment fence successor. The 23500 name exceeded 63 bytes
-- and 33500 renamed it to fence_v2; v3 re-reads current product status
-- (active, not merely non-archived) before the historical fence body.
create function public.sellerpilot_service_fence_qoo10_create_now_v3(
  p_source_id uuid,
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_id text,
  p_market text,
  p_target_id text,
  p_source_revision text,
  p_capture_digest text,
  p_fulfillment_evidence_digest text,
  p_attempt_id uuid default null,
  p_request_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.products product
     where product.id = p_product_id
       and product.owner_id = p_owner_id
       and product.demo is false
       and product.status = 'active'
  ) then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_REJECTED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
    p_source_id, p_owner_id, p_product_id, p_credential_id, p_credential_version,
    p_seller_id, p_market, p_target_id, p_source_revision, p_capture_digest,
    p_fulfillment_evidence_digest, p_attempt_id, p_request_fingerprint
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_source_id uuid,
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_id text,
  p_market text,
  p_target_id text,
  p_source_revision text,
  p_capture_digest text,
  p_fulfillment_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_listing_id uuid;
  v_request_fingerprint text;
  v_listing_remote_id text;
  v_listing_status text;
  v_product_demo boolean;
  v_product_status text;
  v_fenced boolean;
  v_started boolean;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_source_id is null
     or p_owner_id is null or p_product_id is null or p_credential_id is null
     or p_credential_version < 1 then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select job.attempt_id, job.listing_id, job.request_fingerprint,
         listing.remote_id, listing.status, product.demo, product.status
    into v_attempt_id, v_listing_id, v_request_fingerprint,
         v_listing_remote_id, v_listing_status, v_product_demo, v_product_status
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > clock_timestamp()
     and job.channel = 'qoo10'
     and job.operation = 'listing.create'
     and job.credential_id = p_credential_id
     and job.request_fingerprint ~ '^[a-f0-9]{64}$'
     and job.request_fingerprint = attempt.request_fingerprint
     and attempt.owner_id = p_owner_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.create'
     and attempt.status = 'running'
     and listing.owner_id = p_owner_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'qoo10'
     and listing.market = 'JP'
     and listing.target_id = pg_catalog.btrim(p_target_id)
     and listing.operation_attempt_id = attempt.id
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceId}'
       = p_source_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,ownerId}'
       = p_owner_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,productId}'
       = p_product_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,credentialId}'
       = p_credential_id::text
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceRevision}'
       = p_source_revision
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,captureDigest}'
       = p_capture_digest
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,fulfillmentEvidenceDigest}'
       = p_fulfillment_evidence_digest
   for update of job, attempt, listing, product;
  if not found or v_attempt_id is null or v_listing_id is null then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;

  -- Current-state CAS: a post-enqueue product-status/demo/listing drift
  -- must stop SetNewGoods. Enqueued lineage alone is not enough.
  if v_product_demo is not false
     or v_product_status is distinct from 'active'
     or v_listing_remote_id is not null
     or v_listing_status is distinct from 'queued' then
    raise exception 'QOO10_CREATE_CURRENT_STATE_CAS_REJECTED'
      using errcode = '55000';
  end if;

  v_fenced := public.sellerpilot_service_fence_qoo10_create_now_v3(
    p_source_id, p_owner_id, p_product_id, p_credential_id, p_credential_version,
    p_seller_id, p_market, p_target_id, p_source_revision, p_capture_digest,
    p_fulfillment_evidence_digest, null, null
  );
  if v_fenced is not true then
    raise exception 'QOO10_GATEWAY_CREATE_FULFILLMENT_FENCE_REJECTED'
      using errcode = '55000';
  end if;

  v_started := public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    p_token_hash, p_job_id, p_claim_token
  );
  if v_started is not true then
    raise exception 'QOO10_GATEWAY_CREATE_PROVIDER_BOUNDARY_REJECTED'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_qoo10_gateway_create_boundary_v1',
    'status', 'started',
    'sourceId', p_source_id,
    'attemptId', v_attempt_id,
    'listingId', v_listing_id,
    'requestFingerprint', v_request_fingerprint
  );
end;
$$;

create table if not exists sellerpilot_private.qoo10_create_get_recovery_receipts (
  receipt_id uuid primary key default pg_catalog.gen_random_uuid(),
  source_id uuid not null,
  owner_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  listing_id uuid not null,
  seller_code text not null,
  match_status text not null
    check (match_status in ('unique', 'absent', 'ambiguous')),
  remote_id text,
  receipt_kind text not null
    check (receipt_kind = 'official_get_recovery'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  http_status integer not null,
  result_code text,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (attempt_id)
);

create function public.sellerpilot_service_qoo10_create_get_rec_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_source_id uuid,
  p_seller_code text,
  p_match_status text,
  p_remote_id text,
  p_request_sha256 text,
  p_response_sha256 text,
  p_http_status integer,
  p_result_code text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_listing_id uuid;
  v_owner_id uuid;
  v_product_id uuid;
  v_credential_id uuid;
  v_listing_remote_id text;
  v_receipt_id uuid;
  v_now timestamptz := clock_timestamp();
  v_remote_id text := nullif(pg_catalog.btrim(coalesce(p_remote_id, '')), '');
  v_seller_code text := pg_catalog.btrim(coalesce(p_seller_code, ''));
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role' then
    raise exception 'QOO10_CREATE_GET_RECOVERY_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_source_id is null
     or v_seller_code = '' or v_seller_code = '1217536689'
     or p_match_status not in ('unique', 'absent', 'ambiguous')
     or p_request_sha256 !~ '^[a-f0-9]{64}$'
     or p_response_sha256 !~ '^[a-f0-9]{64}$'
     or p_http_status is null
     or p_observed_at is null
     or p_observed_at > v_now + interval '5 seconds' then
    raise exception 'QOO10_CREATE_GET_RECOVERY_INVALID'
      using errcode = '22023';
  end if;
  if p_match_status = 'unique' then
    if v_remote_id is null or v_remote_id !~ '^[0-9]{9,10}$' then
      raise exception 'QOO10_CREATE_GET_RECOVERY_INVALID'
        using errcode = '22023';
    end if;
  elsif v_remote_id is not null then
    raise exception 'QOO10_CREATE_GET_RECOVERY_INVALID'
      using errcode = '22023';
  end if;
  if v_remote_id = '1217536689' then
    raise exception 'QOO10_CREATE_GET_RECOVERY_EXISTING_ITEM_REJECTED'
      using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);

  select job.attempt_id, job.listing_id, attempt.owner_id,
         listing.product_id, job.credential_id, listing.remote_id
    into v_attempt_id, v_listing_id, v_owner_id,
         v_product_id, v_credential_id, v_listing_remote_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.qoo10_create_fulfillment_mutation_fences fence
      on fence.source_id = p_source_id
     and fence.owner_id = attempt.owner_id
     and fence.product_id = listing.product_id
     and fence.credential_id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'qoo10'
     and job.operation = 'listing.create'
     and job.provider_mutation_started_at is not null
     and attempt.channel = 'qoo10'
     and attempt.operation = 'listing.create'
     and attempt.status in ('running', 'manual_required')
     and listing.channel_key = 'qoo10'
     and job.request_payload#>>'{arguments,sellerpilotQoo10CreateFulfillmentDurableSource,sourceId}'
       = p_source_id::text
     and job.request_payload#>>'{arguments,params,SellerCode}' = v_seller_code
   for update of job, attempt, listing;
  if not found or v_attempt_id is null or v_listing_id is null then
    raise exception 'QOO10_CREATE_GET_RECOVERY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;
  if v_listing_remote_id is not null then
    raise exception 'QOO10_CREATE_GET_RECOVERY_POST_RECEIPT_EXISTS'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_create_get_recovery_receipts (
    source_id, owner_id, product_id, credential_id, job_id, attempt_id,
    listing_id, seller_code, match_status, remote_id, receipt_kind,
    request_sha256, response_sha256, http_status, result_code, observed_at
  ) values (
    p_source_id, v_owner_id, v_product_id, v_credential_id, p_job_id,
    v_attempt_id, v_listing_id, v_seller_code, p_match_status, v_remote_id,
    'official_get_recovery', p_request_sha256, p_response_sha256,
    p_http_status, nullif(pg_catalog.btrim(coalesce(p_result_code, '')), ''),
    p_observed_at
  )
  returning receipt_id into v_receipt_id;

  -- GET recovery is not a SetNewGoods POST success. Keep listing.remote_id
  -- null and do not publish. Close the permanent 409 by recording GET bytes.
  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'reconciliation_required',
         http_status = p_http_status,
         remote_id = case when p_match_status = 'unique' then v_remote_id else null end,
         safe_message = case p_match_status
           when 'unique' then 'QOO10_CREATE_RECOVERED_VIA_OFFICIAL_GET'
           when 'absent' then 'QOO10_CREATE_GET_RECOVERY_ABSENT'
           else 'QOO10_CREATE_GET_RECOVERY_AMBIGUOUS'
         end,
         completed_at = v_now,
         pre_gateway_retryable = false
   where attempt.id = v_attempt_id
     and attempt.status in ('running', 'manual_required');
  if not found then
    raise exception 'QOO10_CREATE_GET_RECOVERY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'reconciliation_required'
   where job.id = p_job_id
     and job.status in ('running', 'reconciliation_required');

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_qoo10_create_official_get_recovery_v1',
    'status', 'recorded',
    'receiptKind', 'official_get_recovery',
    'receiptId', v_receipt_id,
    'sourceId', p_source_id,
    'attemptId', v_attempt_id,
    'listingId', v_listing_id,
    'matchStatus', p_match_status,
    'remoteId', v_remote_id,
    'listingPublished', false,
    'synthesizedPostReceipt', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_fence_qoo10_create_now_v3(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_fence_qoo10_create_now_v3(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) to service_role;

revoke all on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) to service_role;

revoke all on function public.sellerpilot_service_qoo10_create_get_rec_v1(
  text,uuid,uuid,uuid,text,text,text,text,text,integer,text,timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_qoo10_create_get_rec_v1(
  text,uuid,uuid,uuid,text,text,text,text,text,integer,text,timestamptz
) to service_role;

commit;
