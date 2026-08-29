-- Keep Temu and eBay listing creates out of the durable mutation queue until
-- their non-inferable production prerequisites are present. The application
-- performs the same checks for a useful operator response; this database
-- fence protects direct RPC callers and older application releases.

begin;

alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_20260829_reserve_listing_unsafe;

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
declare
  v_runtime_status jsonb;
  v_static_egress_enabled boolean := false;
begin
  if p_channel = 'ebay' and (
       nullif(trim(p_request_payload #>> '{arguments,offer,marketplaceId}'), '') is null
       or upper(trim(p_request_payload #>> '{arguments,offer,marketplaceId}')) = 'SERVER_MANAGED'
       or nullif(trim(p_request_payload #>> '{arguments,offer,listingPolicies,fulfillmentPolicyId}'), '') is null
       or upper(trim(p_request_payload #>> '{arguments,offer,listingPolicies,fulfillmentPolicyId}')) = 'SERVER_MANAGED'
       or nullif(trim(p_request_payload #>> '{arguments,offer,listingPolicies,paymentPolicyId}'), '') is null
       or upper(trim(p_request_payload #>> '{arguments,offer,listingPolicies,paymentPolicyId}')) = 'SERVER_MANAGED'
       or nullif(trim(p_request_payload #>> '{arguments,offer,listingPolicies,returnPolicyId}'), '') is null
       or upper(trim(p_request_payload #>> '{arguments,offer,listingPolicies,returnPolicyId}')) = 'SERVER_MANAGED'
       or nullif(trim(p_request_payload #>> '{arguments,offer,merchantLocationKey}'), '') is null
       or upper(trim(p_request_payload #>> '{arguments,offer,merchantLocationKey}')) = 'SERVER_MANAGED'
     ) then
    raise exception 'EBAY_LISTING_CONFIGURATION_REQUIRED'
      using errcode = '55000';
  end if;

  if p_channel = 'temu' then
    select policy.enabled
      into v_static_egress_enabled
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'temu'
     for share;
    if not coalesce(v_static_egress_enabled, false) then
      raise exception 'STATIC_EGRESS_REQUIRED'
        using errcode = '55000';
    end if;

    v_runtime_status := public.sellerpilot_service_serverless_cs_wakeup_status();
    if coalesce(v_runtime_status ->> 'configured', 'false') <> 'true'
       or coalesce(v_runtime_status ->> 'active', 'false') <> 'true'
       or coalesce(v_runtime_status ->> 'scheduleCount', '') <> '6' then
      raise exception 'SERVERLESS_WORKER_REQUIRED'
        using errcode = '55000';
    end if;
  end if;

  return public.sellerpilot_20260829_reserve_listing_unsafe(
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

revoke all on function public.sellerpilot_20260829_reserve_listing_unsafe(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

comment on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) is 'Atomically fail closed before Temu/eBay listing enqueue when required runtime or explicit seller configuration is absent.';

commit;
