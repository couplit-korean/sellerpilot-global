-- Forward-fix Qoo10 CREATE so the fresh QSM source fence and the gateway
-- provider boundary are one transaction. The historical 23500 function name
-- was truncated by PostgreSQL; rename that catalog entry to an addressable
-- identifier before exposing the combined gateway-only boundary.

begin;

do $rename_qoo10_fulfillment_fence$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_cur(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text)'
    ) is null then
      raise exception 'QOO10_FULFILLMENT_FENCE_FORWARD_FIX_SOURCE_MISSING'
        using errcode = '55000';
    end if;
    alter function public.sellerpilot_service_assert_qoo10_create_fulfillment_capture_cur(
      uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
    ) rename to sellerpilot_service_fence_qoo10_create_fulfillment_v2;
  end if;
end;
$rename_qoo10_fulfillment_fence$;

-- The local direct path never owns Qoo10 CREATE. Retire its success-only RPC
-- so a rolling old application cannot commit an attempt before a listing row.
revoke all on function public.sellerpilot_service_complete_qoo10_local_create_after_boundary(
  uuid,uuid,integer,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
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

  select job.attempt_id, job.listing_id, job.request_fingerprint
    into v_attempt_id, v_listing_id, v_request_fingerprint
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
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
   for update of job,attempt,listing;
  if not found or v_attempt_id is null or v_listing_id is null then
    raise exception 'QOO10_GATEWAY_CREATE_BOUNDARY_LINEAGE_REJECTED'
      using errcode = '55000';
  end if;

  v_fenced := public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
    p_source_id,p_owner_id,p_product_id,p_credential_id,p_credential_version,
    p_seller_id,p_market,p_target_id,p_source_revision,p_capture_digest,
    p_fulfillment_evidence_digest,null,null
  );
  if v_fenced is not true then
    raise exception 'QOO10_GATEWAY_CREATE_FULFILLMENT_FENCE_REJECTED'
      using errcode = '55000';
  end if;

  -- This call and the QSM fence above share the same database transaction.
  -- A false/throw rolls both back; a committed response binds the same
  -- job/listing/attempt/request fingerprint before SetNewGoods is reachable.
  v_started := public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    p_token_hash,p_job_id,p_claim_token
  );
  if v_started is not true then
    raise exception 'QOO10_GATEWAY_CREATE_PROVIDER_BOUNDARY_REJECTED'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_qoo10_gateway_create_boundary_v1',
    'status','started',
    'sourceId',p_source_id,
    'attemptId',v_attempt_id,
    'listingId',v_listing_id,
    'requestFingerprint',v_request_fingerprint
  );
end;
$$;

revoke all on function public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_fence_qoo10_create_fulfillment_v2(
  uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,uuid,text
) to service_role;

revoke all on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_begin_qoo10_gateway_create_v1(
  text,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text
) to service_role;

commit;
