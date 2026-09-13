-- Freeze the approved SmartStore CREATE source and revalidate it at the last
-- local-worker boundary before any provider/media mutation. This migration
-- installs contracts only; it does not enqueue, claim, deploy, or call Naver.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910010000);

do $dependencies$
begin
  if pg_catalog.to_regclass('sellerpilot_private.products') is null
     or pg_catalog.to_regclass('sellerpilot_private.admin_users') is null
     or pg_catalog.to_regclass('sellerpilot_private.ai_cli_jobs') is null
     or pg_catalog.to_regclass('sellerpilot_private.product_listings') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_credentials') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_operation_attempts') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or pg_catalog.to_regprocedure(
          'sellerpilot_private.request_has_unambiguous_service_role_claim()'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
        ) is null then
    raise exception 'SMARTSTORE_CREATE_SOURCE_FENCE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create function public.sellerpilot_service_smartstore_create_source_snapshot(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'contract', 'smartstore_listing_create_source_snapshot_v1',
           'productId', product.id,
           'ownerId', product.owner_id,
           'productUpdatedAt', product.updated_at,
           'detailPageVersion', product.detail_page_version,
           'approvedDetailPageVersion', product.detail_page_approved_version,
           'approvedManifestDigest', product.detail_page_image_manifest->>'digest',
           'sellerManagementCode', coalesce(
             nullif(trim(ai_job.request_payload#>>'{manual_fields,sellerSku}'), ''),
             trim(product.sku)
           ),
           'credentialId', credential.id,
           'credentialVersion', credential.version,
           'credentialFingerprint', credential.fingerprint
         )
    into result
    from sellerpilot_private.products product
    left join sellerpilot_private.ai_cli_jobs ai_job on ai_job.id = product.ai_job_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = 'smartstore'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.last_check_status = 'passed'
     and credential.version > 0
     and credential.fingerprint ~ '^[A-Fa-f0-9]{12}$'
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
   where product.id = p_product_id
     and product.owner_id = p_owner_id
     and product.status = 'ready'
     and not product.demo
     and product.detail_page_version > 0
     and product.detail_page_approved_version = product.detail_page_version
     and coalesce(product.detail_page_image_manifest->>'digest', '')
       ~ '^[a-f0-9]{64}$'
     and length(coalesce(
           nullif(trim(ai_job.request_payload#>>'{manual_fields,sellerSku}'), ''),
           trim(product.sku)
         )) between 1 and 100
     and exists (
       select 1 from sellerpilot_private.admin_users admin
       where admin.user_id = product.owner_id
     );

  return result;
end;
$$;

revoke all on function
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)
  to service_role;

create function sellerpilot_private.smartstore_create_source_is_current(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  binding jsonb;
begin
  select job.request_payload#>'{arguments,sellerpilotSmartstoreCreateSource}'
    into binding
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
     and attempt.owner_id = job.created_by
     and attempt.credential_id = job.credential_id
     and attempt.channel = job.channel
     and attempt.operation = job.operation
     and attempt.status = 'running'
     and attempt.remote_id is null
     and attempt.seller_account_key is not distinct from job.seller_account_key
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
     and listing.owner_id = attempt.owner_id
     and listing.channel_key = job.channel
     and listing.operation_attempt_id = attempt.id
     and listing.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and (
       listing.seller_account_key = job.seller_account_key
       or listing.seller_account_key is null
     )
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = attempt.owner_id
     and product.status = 'ready'
     and not product.demo
     and product.updated_at = (
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productUpdatedAt}'
     )::timestamptz
     and product.detail_page_version = (
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,detailPageVersion}'
     )::bigint
     and product.detail_page_approved_version = product.detail_page_version
     and product.detail_page_approved_version = (
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,approvedDetailPageVersion}'
     )::bigint
     and product.detail_page_image_manifest->>'digest' =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,approvedManifestDigest}'
    left join sellerpilot_private.ai_cli_jobs ai_job on ai_job.id = product.ai_job_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,credentialId}'
     and credential.channel = job.channel
     and credential.environment = job.environment
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.last_check_status = 'passed'
     and credential.version = (
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,credentialVersion}'
     )::integer
     and credential.fingerprint =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,credentialFingerprint}'
     and credential.seller_account_key = job.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
   where job.id = p_job_id
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.provider_mutation_started_at is null
     and job.completed_at is null
     and job.response_payload is null
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,contract}'
       = 'smartstore_listing_create_source_v1'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
       = product.id::text
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,ownerId}'
       = product.owner_id::text
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,sellerManagementCode}' = coalesce(
       nullif(trim(ai_job.request_payload#>>'{manual_fields,sellerSku}'), ''),
       trim(product.sku)
     )
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,sellerManagementCode}' =
       job.request_payload#>>'{arguments,body,originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,approvedManifestDigest}'
       ~ '^[a-f0-9]{64}$'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,credentialFingerprint}'
       ~ '^[A-Fa-f0-9]{12}$';

  return binding is not null;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_091001_begin_gateway_before_smartstore_create;
revoke all on function
  public.sellerpilot_091001_begin_gateway_before_smartstore_create(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  exact_smartstore_create boolean;
begin
  -- Follow the existing gateway ledger order before taking this wrapper's
  -- lock. Shopee's outer CREATE fence already holds the ledger lock; reversing
  -- this order here could deadlock concurrent SmartStore and Shopee jobs.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910010000);
  select job.channel = 'smartstore' and job.operation = 'listing.create'
    into exact_smartstore_create
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if coalesce(exact_smartstore_create, false)
     and not sellerpilot_private.smartstore_create_source_is_current(
       p_job_id, p_claim_token
     ) then
    return false;
  end if;
  return public.sellerpilot_091001_begin_gateway_before_smartstore_create(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

comment on function
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid) is
  'Final pre-provider fence for SmartStore listing.create. Product revision, canonical seller SKU, approved detail manifest, credential incarnation, owner and claim must still equal the immutable enqueued binding.';

notify pgrst, 'reload schema';

commit;
