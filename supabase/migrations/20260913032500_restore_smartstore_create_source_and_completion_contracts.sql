-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_complete_smartstore_listing_create') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_complete_smartstore_listing_create';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_append_smartstore_create_category_source') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_append_smartstore_create_category_source';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from 'da7cf524d20a8f1a63724152cf665448' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_gateway_provider_mutation';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_serverless_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from 'ec86d1fc01d6b6602ad2da532d1c22f1' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_serverless_gateway_provider_mutation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_smartstore_create_category_source') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_smartstore_create_category_source';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_retire_smartstore_create_category_source') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_retire_smartstore_create_category_source';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_smartstore_create_category_collect_ctx') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_smartstore_create_category_collect_ctx';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_smartstore_create_source_snapshot') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_smartstore_create_source_snapshot';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_stage_smartstore_create_transport') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_stage_smartstore_create_transport';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='guard_smartstore_category_source_append_only') then raise exception 'RECOVERY_ALREADY_DEFINED:guard_smartstore_category_source_append_only';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_assignment_source_payload') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_assignment_source_payload';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_canonical') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_canonical';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_compile_stored_selection') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_compile_stored_selection';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_current_json') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_current_json';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_hash') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_hash';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_payload_is_valid') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_payload_is_valid';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_range_contains') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_range_contains';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_category_source_sorted_records') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_category_source_sorted_records';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_create_source_is_current') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_create_source_is_current';end if;
end $recovery_guard$;
-- Reviewed source: 20260910010000_fence_smartstore_create_source_revision.sql
-- Source SHA256: ccb6028edf7042a0be7b5970a1a2ecb04e8a68f47312a478b7a4197c3fa7185b
-- Freeze the approved SmartStore CREATE source and revalidate it at the last
-- local-worker boundary before any provider/media mutation. This migration
-- installs contracts only; it does not enqueue, claim, deploy, or call Naver.

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


-- Reviewed source: 20260910014000_fence_smartstore_serverless_create_source_revision.sql
-- Source SHA256: 47ecde1e2ffc7e3e62c0a93a9d404021959dfca1c8351a71402b0de491cfa00c
-- Apply the existing SmartStore CREATE source fence to the serverless worker's
-- distinct provider-mutation RPC. The local-worker boundary was fenced by
-- 20260910010000; no job, listing, receipt, or provider row is mutated here.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- Match the gateway ledger -> SmartStore order used by the local boundary.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(193674993, 910010000);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    raise exception 'SMARTSTORE_SERVERLESS_CREATE_SOURCE_FENCE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

alter function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) rename to sp_60910014000_begin_serverless_before_smartstore;

revoke all on function
  public.sp_60910014000_begin_serverless_before_smartstore(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
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
  -- Keep this outer wrapper compatible with the local SmartStore fence and
  -- with the Shopee wrapper now beneath it. A single lock order prevents the
  -- two provider entry points from acquiring the same locks in reverse.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910010000);

  -- Deliberately identify the protected tuple by job id, not claim token.
  -- A wrong claim for an existing SmartStore CREATE must enter the predicate
  -- and fail closed rather than bypassing this wrapper as a non-SmartStore job.
  select job.channel = 'smartstore' and job.operation = 'listing.create'
    into exact_smartstore_create
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;

  if coalesce(exact_smartstore_create, false)
     and sellerpilot_private.smartstore_create_source_is_current(
       p_job_id, p_claim_token
     ) is not true then
    return false;
  end if;

  return public.sp_60910014000_begin_serverless_before_smartstore(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ) to service_role;

comment on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ) is
  'Serverless provider boundary. SmartStore listing.create must retain the immutable product, SKU, approved-detail, credential, owner and claim binding installed at enqueue; all other jobs delegate to the previously installed boundary chain.';

notify pgrst, 'reload schema';


-- Reviewed source: 20260910031000_smartstore_create_category_attribute_source.sql
-- Source SHA256: 2919f4f9040b902e3808841df7822284e45cf87bf57de0e7db4bd027c6c4c4c9
-- Durable, service-owned SmartStore new-CREATE category/attribute evidence.
-- This migration only installs data contracts and last-moment fences. It does
-- not enqueue work, call Naver, deploy code, or touch historical listings.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910031000);

do $dependencies$
begin
  if pg_catalog.to_regclass('sellerpilot_private.products') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_credentials') is null
     or pg_catalog.to_regclass('sellerpilot_private.product_category_assignments') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create function sellerpilot_private.smartstore_category_source_canonical(
  p_value jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(key)::text || ':' ||
          sellerpilot_private.smartstore_category_source_canonical(value),
        ',' order by key collate "C"
      ), '') || '}'
        into result
        from pg_catalog.jsonb_each(p_value);
    when 'array' then
      select '[' || coalesce(pg_catalog.string_agg(
        sellerpilot_private.smartstore_category_source_canonical(value),
        ',' order by ordinal
      ), '') || ']'
        into result
        from pg_catalog.jsonb_array_elements(p_value)
          with ordinality item(value, ordinal);
    else
      result := p_value::text;
  end case;
  return result;
end;
$$;

create function sellerpilot_private.smartstore_category_source_hash(
  p_value jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      sellerpilot_private.smartstore_category_source_canonical(p_value),
      'UTF8'
    )),
    'hex'
  )
$$;

create function sellerpilot_private.smartstore_category_source_sorted_records(
  p_value jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(value order by
    sellerpilot_private.smartstore_category_source_canonical(value)
      collate "C"), '[]'::jsonb)
  from pg_catalog.jsonb_array_elements(p_value) item(value)
$$;

create function sellerpilot_private.smartstore_category_assignment_source_payload(
  p_assignment jsonb,
  p_provider_attributes jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p_assignment->'id',
    'ownerId', p_assignment->'owner_id',
    'productId', p_assignment->'product_id',
    'channel', p_assignment->'channel',
    'environment', p_assignment->'environment',
    'market', p_assignment->'market',
    'categoryId', p_assignment->'category_id',
    'categoryPath', p_assignment->'category_path',
    'isLeaf', p_assignment->'is_leaf',
    'requiredAttributes', p_assignment->'required_attributes',
    'providedAttributes', p_assignment->'provided_attributes',
    'providerCreateAttributes',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      ),
    'missingRequiredAttributes', p_assignment->'missing_required_attributes',
    'officialMetadata', p_assignment->'official_metadata',
    'status', p_assignment->'status',
    'officialVerifiedAt', p_assignment->'official_verified_at',
    'confirmedAt', p_assignment->'confirmed_at'
  )
$$;

create function sellerpilot_private.smartstore_category_source_range_contains(
  p_real_value text,
  p_value jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  part text;
  minimum numeric;
  maximum numeric;
begin
  if p_real_value !~ '^\d+(?:\.\d+)?(?:[~x]\d+(?:\.\d+)?)?$'
     or coalesce(p_value->>'minAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'
     or coalesce(p_value->>'maxAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$' then
    return false;
  end if;
  minimum := (p_value->>'minAttributeValue')::numeric;
  maximum := (p_value->>'maxAttributeValue')::numeric;
  if minimum > maximum then return false; end if;
  foreach part in array pg_catalog.regexp_split_to_array(p_real_value, '[~x]')
  loop
    if part::numeric < minimum or part::numeric > maximum then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.smartstore_category_source_payload_is_valid(
  p_category_id text,
  p_provider_attributes jsonb,
  p_official_readback jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  attribute_row jsonb;
  value_row jsonb;
  unit_row jsonb;
  provider_row jsonb;
  matched_attribute jsonb;
  matched_value jsonb;
  attribute_ids text[] := array[]::text[];
  value_ids text[] := array[]::text[];
  attribute_value_ids text[] := array[]::text[];
  unit_ids text[] := array[]::text[];
  attribute_seq text;
  attribute_value_seq text;
  pair_id text;
  classification text;
  unit_code text;
  real_value text;
  selection_count integer;
  maximum_count numeric;
  is_required boolean;
  unit_usable boolean;
begin
  if pg_catalog.jsonb_typeof(p_provider_attributes) is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_official_readback) is distinct from 'object'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'category'
     ) is distinct from 'object'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributes'
     ) is distinct from 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValues'
     ) is distinct from 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValueUnits'
     ) is distinct from 'array'
     or nullif(pg_catalog.btrim(
       p_official_readback#>>'{category,id}'
     ), '') is distinct from p_category_id
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,last}'
     ) is distinct from 'boolean'
     or p_official_readback#>>'{category,last}' is distinct from 'true'
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,id}'
     ) is distinct from 'string'
     or (p_official_readback#>'{category,name}' is not null
       and pg_catalog.jsonb_typeof(
         p_official_readback#>'{category,name}'
       ) is distinct from 'string')
     or (p_official_readback#>'{category,wholeCategoryName}' is not null
       and pg_catalog.jsonb_typeof(
         p_official_readback#>'{category,wholeCategoryName}'
       ) is distinct from 'string')
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         p_official_readback->'category'
       ) field_name
       where field_name not in ('id', 'name', 'wholeCategoryName', 'last')
     ) then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_official_readback) field_name
    where field_name not in (
      'category', 'attributes', 'attributeValues', 'attributeValueUnits'
    )
  ) then
    return false;
  end if;

  for attribute_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributes'
    ) candidate(item)
  loop
    attribute_seq := attribute_row->>'attributeSeq';
    classification := attribute_row->>'attributeClassificationType';
    if pg_catalog.jsonb_typeof(attribute_row) is distinct from 'object'
       or coalesce(attribute_seq, '') !~ '^[1-9]\d*$'
       or attribute_seq::numeric > 9007199254740991
       or attribute_seq = any(attribute_ids)
       or pg_catalog.jsonb_typeof(
         attribute_row->'attributeName'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(attribute_row->>'attributeName'), '') is null
       or pg_catalog.jsonb_typeof(
         attribute_row->'attributeClassificationType'
       ) is distinct from 'string'
       or classification not in ('SINGLE_SELECT', 'MULTI_SELECT', 'RANGE')
       or pg_catalog.jsonb_typeof(
         attribute_row->'attributeType'
       ) is distinct from 'string'
       or attribute_row->>'attributeType' not in ('PRIMARY', 'OPTIONAL')
       or pg_catalog.jsonb_typeof(
         attribute_row->'unitUsable'
       ) is distinct from 'boolean'
       or coalesce(
         attribute_row->>'attributeValueMaxMatchingCount', ''
       ) !~ '^\d+$'
       or (attribute_row->>'attributeValueMaxMatchingCount')::numeric
         > 2147483647
       or (attribute_row ? 'representativeUnitCode'
         and attribute_row->'representativeUnitCode' <> 'null'::jsonb
         and (pg_catalog.jsonb_typeof(
           attribute_row->'representativeUnitCode'
         ) <> 'string'
         or attribute_row->>'representativeUnitCode' !~ '^A\d{5}$'))
       or (attribute_row ? 'required'
         and pg_catalog.jsonb_typeof(attribute_row->'required') <> 'boolean')
       or (attribute_row ? 'mandatory'
         and pg_catalog.jsonb_typeof(attribute_row->'mandatory') <> 'boolean')
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(attribute_row) field_name
         where field_name not in (
           'attributeSeq', 'attributeName', 'attributeClassificationType',
           'attributeType', 'unitUsable', 'representativeUnitCode',
           'attributeValueMaxMatchingCount', 'required', 'mandatory'
         )
       ) then
      return false;
    end if;
    attribute_ids := pg_catalog.array_append(attribute_ids, attribute_seq);
  end loop;

  for value_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributeValues'
    ) candidate(item)
  loop
    attribute_seq := value_row->>'attributeSeq';
    attribute_value_seq := value_row->>'attributeValueSeq';
    pair_id := attribute_seq || ':' || attribute_value_seq;
    if pg_catalog.jsonb_typeof(value_row) is distinct from 'object'
       or coalesce(attribute_seq, '') !~ '^[1-9]\d*$'
       or attribute_seq::numeric > 9007199254740991
       or coalesce(attribute_value_seq, '') !~ '^[1-9]\d*$'
       or attribute_value_seq::numeric > 9007199254740991
       or not attribute_seq = any(attribute_ids)
       or pair_id = any(value_ids)
       or attribute_value_seq = any(attribute_value_ids)
       or pg_catalog.jsonb_typeof(
         value_row->'minAttributeValue'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(value_row->>'minAttributeValue'), '') is null
       or (value_row ? 'attributeValueName'
         and pg_catalog.jsonb_typeof(
           value_row->'attributeValueName'
         ) <> 'string')
       or (value_row ? 'maxAttributeValue'
         and value_row->'maxAttributeValue' <> 'null'::jsonb
         and pg_catalog.jsonb_typeof(
           value_row->'maxAttributeValue'
         ) <> 'string')
       or (value_row ? 'minAttributeValueUnitCode'
         and value_row->'minAttributeValueUnitCode' <> 'null'::jsonb
         and (pg_catalog.jsonb_typeof(
           value_row->'minAttributeValueUnitCode'
         ) <> 'string'
         or value_row->>'minAttributeValueUnitCode' !~ '^A\d{5}$'))
       or (value_row ? 'maxAttributeValueUnitCode'
         and value_row->'maxAttributeValueUnitCode' <> 'null'::jsonb
         and (pg_catalog.jsonb_typeof(
           value_row->'maxAttributeValueUnitCode'
         ) <> 'string'
         or value_row->>'maxAttributeValueUnitCode' !~ '^A\d{5}$'))
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(value_row) field_name
         where field_name not in (
           'attributeSeq', 'attributeValueSeq', 'attributeValueName',
           'minAttributeValue', 'maxAttributeValue',
           'minAttributeValueUnitCode', 'maxAttributeValueUnitCode'
         )
       ) then
      return false;
    end if;
    value_ids := pg_catalog.array_append(value_ids, pair_id);
    attribute_value_ids := pg_catalog.array_append(
      attribute_value_ids, attribute_value_seq
    );
  end loop;

  for unit_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributeValueUnits'
    ) candidate(item)
  loop
    unit_code := unit_row->>'id';
    if pg_catalog.jsonb_typeof(unit_row) is distinct from 'object'
       or coalesce(unit_code, '') !~ '^A\d{5}$'
       or unit_code = any(unit_ids)
       or pg_catalog.jsonb_typeof(
         unit_row->'unitCodeName'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(unit_row->>'unitCodeName'), '') is null
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(unit_row) field_name
         where field_name not in ('id', 'unitCodeName')
       ) then
      return false;
    end if;
    unit_ids := pg_catalog.array_append(unit_ids, unit_code);
  end loop;

  -- Every unit reference and every RANGE bound must itself be official and
  -- internally coherent, even when that value was not selected by the product.
  for attribute_row in
    select item from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributes'
    ) candidate(item)
  loop
    unit_code := nullif(pg_catalog.btrim(
      attribute_row->>'representativeUnitCode'
    ), '');
    unit_usable := (attribute_row->>'unitUsable')::boolean;
    classification := attribute_row->>'attributeClassificationType';
    if (unit_code is not null and not unit_code = any(unit_ids))
       or (not unit_usable and unit_code is not null)
       or (unit_usable and classification = 'RANGE'
         and unit_code is null) then
      return false;
    end if;
  end loop;
  for value_row in
    select item from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributeValues'
    ) candidate(item)
  loop
    select item into matched_attribute
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributes'
      ) candidate(item)
     where item->>'attributeSeq' = value_row->>'attributeSeq';
    classification := matched_attribute->>'attributeClassificationType';
    unit_usable := (matched_attribute->>'unitUsable')::boolean;
    if classification = 'RANGE' and (
         coalesce(value_row->>'minAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or coalesce(value_row->>'maxAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or (value_row->>'minAttributeValue')::numeric
           > (value_row->>'maxAttributeValue')::numeric
       ) then
      return false;
    end if;
    foreach unit_code in array array[
      nullif(pg_catalog.btrim(value_row->>'minAttributeValueUnitCode'), ''),
      nullif(pg_catalog.btrim(value_row->>'maxAttributeValueUnitCode'), '')
    ]
    loop
      if unit_code is not null and not unit_code = any(unit_ids) then
        return false;
      end if;
    end loop;
    if classification = 'RANGE' and unit_usable and (
         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is null
       ) then
      return false;
    end if;
    if not unit_usable and (
         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is not null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is not null
       ) then
      return false;
    end if;
  end loop;

  value_ids := array[]::text[];
  for provider_row in
    select item
    from pg_catalog.jsonb_array_elements(p_provider_attributes) candidate(item)
  loop
    attribute_seq := provider_row->>'attributeSeq';
    attribute_value_seq := provider_row->>'attributeValueSeq';
    pair_id := attribute_seq || ':' || attribute_value_seq;
    if pg_catalog.jsonb_typeof(provider_row) is distinct from 'object'
       or coalesce(attribute_seq, '') !~ '^[1-9]\d*$'
       or attribute_seq::numeric > 9007199254740991
       or coalesce(attribute_value_seq, '') !~ '^[1-9]\d*$'
       or attribute_value_seq::numeric > 9007199254740991
       or pair_id = any(value_ids)
       or (provider_row ? 'attributeRealValue'
         and pg_catalog.jsonb_typeof(
           provider_row->'attributeRealValue'
         ) <> 'string')
       or (provider_row ? 'attributeRealValueUnitCode'
         and (pg_catalog.jsonb_typeof(
           provider_row->'attributeRealValueUnitCode'
         ) <> 'string'
         or provider_row->>'attributeRealValueUnitCode' !~ '^A\d{5}$'))
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(provider_row) field_name
         where field_name not in (
           'attributeSeq', 'attributeValueSeq', 'attributeRealValue',
           'attributeRealValueUnitCode'
         )
       ) then
      return false;
    end if;
    select item into matched_attribute
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributes'
      ) candidate(item)
     where item->>'attributeSeq' = attribute_seq;
    select item into matched_value
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributeValues'
      ) candidate(item)
     where item->>'attributeSeq' = attribute_seq
       and item->>'attributeValueSeq' = attribute_value_seq;
    if matched_attribute is null or matched_value is null then return false; end if;

    classification := matched_attribute->>'attributeClassificationType';
    if classification <> 'RANGE'
       and (provider_row ? 'attributeRealValue'
         or provider_row ? 'attributeRealValueUnitCode') then
      return false;
    end if;
    if classification = 'RANGE' then
      real_value := nullif(pg_catalog.btrim(
        provider_row->>'attributeRealValue'
      ), '');
      unit_code := nullif(pg_catalog.btrim(
        provider_row->>'attributeRealValueUnitCode'
      ), '');
      unit_usable := (matched_attribute->>'unitUsable')::boolean;
      if real_value is null
         or not sellerpilot_private.smartstore_category_source_range_contains(
           real_value, matched_value
         )
         or (unit_usable and (
           unit_code is null or not unit_code = any(unit_ids)
         ))
         or (not unit_usable
           and provider_row ? 'attributeRealValueUnitCode')
         or (unit_code is not null
           and coalesce(
             nullif(matched_value->>'minAttributeValueUnitCode', ''),
             nullif(matched_value->>'maxAttributeValueUnitCode', ''),
             nullif(matched_attribute->>'representativeUnitCode', '')
           ) is not null
           and unit_code not in (
             coalesce(matched_value->>'minAttributeValueUnitCode', ''),
             coalesce(matched_value->>'maxAttributeValueUnitCode', ''),
             coalesce(matched_attribute->>'representativeUnitCode', '')
           )) then
        return false;
      end if;
    end if;
    value_ids := pg_catalog.array_append(value_ids, pair_id);
  end loop;

  for attribute_row in
    select item
    from pg_catalog.jsonb_array_elements(
      p_official_readback->'attributes'
    ) candidate(item)
  loop
    attribute_seq := attribute_row->>'attributeSeq';
    classification := attribute_row->>'attributeClassificationType';
    maximum_count :=
      (attribute_row->>'attributeValueMaxMatchingCount')::numeric;
    is_required := attribute_row->>'attributeType' = 'PRIMARY'
      or coalesce((attribute_row->>'required')::boolean, false)
      or coalesce((attribute_row->>'mandatory')::boolean, false);
    select pg_catalog.count(*)::integer into selection_count
      from pg_catalog.jsonb_array_elements(p_provider_attributes) item
     where item->>'attributeSeq' = attribute_seq;
    if (is_required and selection_count = 0)
       or (classification in ('SINGLE_SELECT', 'RANGE')
         and selection_count > 1)
       or (classification = 'MULTI_SELECT' and maximum_count > 0
         and selection_count > maximum_count) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create table sellerpilot_private.smartstore_create_category_attribute_sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null,
  product_id uuid not null
    references sellerpilot_private.products(id),
  product_updated_at timestamptz not null,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id),
  credential_version integer not null check (credential_version > 0),
  seller_account_key text not null
    check (seller_account_key ~ '^[a-f0-9]{64}$'),
  approved_detail_revision bigint not null
    check (approved_detail_revision > 0),
  approved_detail_digest text not null
    check (approved_detail_digest ~ '^[a-f0-9]{64}$'),
  assignment_id uuid not null
    references sellerpilot_private.product_category_assignments(id),
  assignment_updated_at timestamptz not null,
  assignment_revision bigint not null check (assignment_revision > 0),
  assignment_source_digest text not null
    check (assignment_source_digest ~ '^[a-f0-9]{64}$'),
  assignment_digest text not null
    check (assignment_digest ~ '^[a-f0-9]{64}$'),
  assignment jsonb not null check (
    pg_catalog.jsonb_typeof(assignment) = 'object'
    and assignment->>'contract' =
      'smartstore_category_attribute_assignment_v1'
    and assignment->>'channel' = 'smartstore'
    and assignment->>'operation' = 'listing.create'
    and assignment->>'environment' = 'production'
    and assignment->>'market' = 'KR'
    and assignment->>'status' = 'confirmed'
    and pg_catalog.jsonb_typeof(assignment->'providedAttributes') = 'array'
  ),
  official_readback_digest text not null
    check (official_readback_digest ~ '^[a-f0-9]{64}$'),
  official_readback jsonb not null check (
    pg_catalog.jsonb_typeof(official_readback) = 'object'
    and official_readback->>'contract' =
      'smartstore_category_attribute_official_readback_v1'
    and pg_catalog.jsonb_typeof(official_readback->'category') = 'object'
    and pg_catalog.jsonb_typeof(official_readback->'attributes') = 'array'
    and pg_catalog.jsonb_typeof(official_readback->'attributeValues') = 'array'
    and pg_catalog.jsonb_typeof(
      official_readback->'attributeValueUnits'
    ) = 'array'
  ),
  product_attributes_sha256 text not null
    check (product_attributes_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  retired_at timestamptz,
  retired_reason text check (
    retired_reason is null or retired_reason in (
      'superseded', 'operator_retired', 'source_invalidated'
    )
  ),
  check ((retired_at is null) = (retired_reason is null)),
  unique (
    product_id, credential_id, product_updated_at, assignment_updated_at,
    assignment_source_digest, official_readback_digest
  )
);

create unique index smartstore_create_category_source_one_current_idx
  on sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id
  ) where retired_at is null;

create index smartstore_create_category_source_revision_idx
  on sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id, assignment_revision desc
  );

alter table sellerpilot_private.smartstore_create_category_attribute_sources
  enable row level security;
revoke all on sellerpilot_private.smartstore_create_category_attribute_sources
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_category_source_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or old.retired_at is not null
     or new.retired_at is null
     or new.retired_reason is null
     or (pg_catalog.to_jsonb(new) - 'retired_at' - 'retired_reason')
       is distinct from
       (pg_catalog.to_jsonb(old) - 'retired_at' - 'retired_reason') then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_APPEND_ONLY'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger smartstore_create_category_source_append_only
before update or delete
on sellerpilot_private.smartstore_create_category_attribute_sources
for each row execute function
  sellerpilot_private.guard_smartstore_category_source_append_only();

create function sellerpilot_private.smartstore_category_source_current_json(
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
  select pg_catalog.jsonb_build_object(
           'contract', 'smartstore_listing_create_category_source_v1',
           'assignment', source.assignment,
           'officialReadback', source.official_readback
         )
    into result
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.retired_at is null
     and exists (
       select 1 from sellerpilot_private.products product
       where product.id = source.product_id
         and product.owner_id = source.owner_id
         and product.updated_at = source.product_updated_at
         and product.status = 'ready'
         and not product.demo
         and product.detail_page_version = source.approved_detail_revision
         and product.detail_page_approved_version =
           source.approved_detail_revision
         and product.detail_page_image_manifest->>'digest' =
           source.approved_detail_digest
     )
     and exists (
       select 1 from sellerpilot_private.channel_credentials credential
       where credential.id = source.credential_id
         and credential.channel = 'smartstore'
         and credential.environment = 'production'
         and credential.status = 'active'
         and (credential.expires_at is null
           or credential.expires_at > pg_catalog.clock_timestamp())
         and credential.last_check_status = 'passed'
         and credential.version = source.credential_version
         and credential.seller_account_key = source.seller_account_key
         and credential.seller_account_key_source in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
     )
     and exists (
       select 1
       from sellerpilot_private.product_category_assignments category_assignment
       where category_assignment.id = source.assignment_id
         and category_assignment.owner_id = source.owner_id
         and category_assignment.product_id = source.product_id
         and category_assignment.channel = 'smartstore'
         and category_assignment.environment = 'production'
         and category_assignment.market = 'KR'
         and category_assignment.status = 'confirmed'
         and category_assignment.is_leaf
         and category_assignment.category_id = source.assignment->>'categoryId'
         and category_assignment.updated_at = source.assignment_updated_at
         and category_assignment.official_verified_at is not null
         and category_assignment.confirmed_at is not null
         and pg_catalog.jsonb_typeof(
           category_assignment.missing_required_attributes
         ) = 'array'
         and pg_catalog.jsonb_array_length(
           category_assignment.missing_required_attributes
         ) = 0
         and sellerpilot_private.smartstore_category_source_hash(
           sellerpilot_private.smartstore_category_assignment_source_payload(
             pg_catalog.to_jsonb(category_assignment),
             source.assignment->'providedAttributes'
           )
         ) = source.assignment_source_digest
     )
     and source.assignment_digest = source.assignment->>'digest'
     and source.assignment_revision =
       (source.assignment->>'revision')::bigint
     and source.official_readback_digest =
       source.official_readback->>'digest'
     and source.official_readback->>'categoryId' =
       source.assignment->>'categoryId'
     and source.official_readback->>'assignmentRevision' =
       source.assignment_revision::text
     and source.official_readback->>'assignmentDigest' =
       source.assignment_digest
     and source.product_attributes_sha256 =
       sellerpilot_private.smartstore_category_source_hash(
         sellerpilot_private.smartstore_category_source_sorted_records(
           source.assignment->'providedAttributes'
         )
       );
  return result;
exception when others then
  return null;
end;
$$;

create function public.sellerpilot_service_read_smartstore_create_category_source(
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
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return sellerpilot_private.smartstore_category_source_current_json(
    p_owner_id, p_product_id, p_credential_id
  );
end;
$$;

create function public.sellerpilot_service_append_smartstore_create_category_source(
  p_owner_id uuid,
  p_product_id uuid,
  p_product_updated_at timestamptz,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_account_key text,
  p_approved_detail_revision bigint,
  p_approved_detail_digest text,
  p_assignment_id uuid,
  p_assignment_updated_at timestamptz,
  p_provider_attributes jsonb,
  p_official_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  current_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  matching_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  prior_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  assignment_source_digest text;
  assignment_revision bigint;
  assignment_value jsonb;
  assignment_digest text;
  official_value jsonb;
  official_digest text;
  product_attributes_sha256 text;
  inserted_id uuid;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910031000);

  if p_owner_id is null or p_product_id is null
     or p_product_updated_at is null or p_credential_id is null
     or p_credential_version is null or p_seller_account_key is null
     or p_approved_detail_revision is null or p_approved_detail_digest is null
     or p_assignment_id is null or p_assignment_updated_at is null
     or p_provider_attributes is null or p_official_readback is null
     or pg_catalog.jsonb_typeof(p_provider_attributes) <> 'array'
     or pg_catalog.jsonb_typeof(p_official_readback) <> 'object'
     or pg_catalog.jsonb_typeof(p_official_readback->'category') <> 'object'
     or pg_catalog.jsonb_typeof(p_official_readback->'attributes') <> 'array'
     or pg_catalog.jsonb_typeof(p_official_readback->'attributeValues') <> 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValueUnits'
     ) <> 'array' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_NULL_OR_SHAPE_INVALID'
      using errcode = '22023';
  end if;

  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = p_product_id
   for update;
  if product.id is null
     or product.owner_id is distinct from p_owner_id
     or product.updated_at is distinct from p_product_updated_at
     or product.status <> 'ready' or product.demo
     or product.detail_page_version is distinct from p_approved_detail_revision
     or product.detail_page_approved_version is distinct from
       p_approved_detail_revision
     or product.detail_page_image_manifest->>'digest' is distinct from
       p_approved_detail_digest
     or p_approved_detail_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PRODUCT_STALE'
      using errcode = '55000';
  end if;

  select * into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = p_credential_id
   for update;
  if credential.id is null
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp())
     or credential.last_check_status <> 'passed'
     or credential.version is distinct from p_credential_version
     or credential.seller_account_key is distinct from p_seller_account_key
     or p_seller_account_key !~ '^[a-f0-9]{64}$'
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CREDENTIAL_STALE'
      using errcode = '55000';
  end if;

  select * into assignment
    from sellerpilot_private.product_category_assignments candidate
   where candidate.id = p_assignment_id
   for update;
  if assignment.id is null
     or assignment.owner_id is distinct from p_owner_id
     or assignment.product_id is distinct from p_product_id
     or assignment.updated_at is distinct from p_assignment_updated_at
     or assignment.channel <> 'smartstore'
     or assignment.environment <> 'production'
     or assignment.market <> 'KR'
     or assignment.status <> 'confirmed'
     or not assignment.is_leaf
     or assignment.official_verified_at is null
     or assignment.confirmed_at is null
     or pg_catalog.jsonb_typeof(assignment.missing_required_attributes)
       <> 'array'
     or pg_catalog.jsonb_array_length(
       assignment.missing_required_attributes
     ) <> 0 then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_ASSIGNMENT_STALE'
      using errcode = '55000';
  end if;

  -- Validate every nested official/provider field before revision lookup. An
  -- invalid receipt therefore cannot reserve or poison an assignment revision.
  if p_official_readback#>>'{category,id}' is distinct from
       assignment.category_id
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,last}'
     ) <> 'boolean'
     or p_official_readback#>>'{category,last}' is distinct from 'true' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CROSS_CATEGORY'
      using errcode = '55000';
  end if;
  if not sellerpilot_private.smartstore_category_source_payload_is_valid(
    assignment.category_id, p_provider_attributes, p_official_readback
  ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  assignment_source_digest :=
    sellerpilot_private.smartstore_category_source_hash(
      sellerpilot_private.smartstore_category_assignment_source_payload(
        pg_catalog.to_jsonb(assignment), p_provider_attributes
      )
    );

  select * into current_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.retired_at is null
   for update;

  select * into matching_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.assignment_source_digest = assignment_source_digest
   order by source.created_at desc
   limit 1;

  if current_source.id is not null
     and current_source.assignment_source_digest = assignment_source_digest then
    assignment_revision := current_source.assignment_revision;
  elsif current_source.id is null and matching_source.id is not null then
    assignment_revision := matching_source.assignment_revision;
  else
    select coalesce(max(source.assignment_revision), 0) + 1
      into assignment_revision
      from sellerpilot_private.smartstore_create_category_attribute_sources source
     where source.owner_id = p_owner_id
       and source.product_id = p_product_id;
  end if;

  assignment_value := pg_catalog.jsonb_build_object(
    'contract', 'smartstore_category_attribute_assignment_v1',
    'channel', 'smartstore',
    'operation', 'listing.create',
    'environment', 'production',
    'market', 'KR',
    'status', 'confirmed',
    'categoryId', assignment.category_id,
    'revision', assignment_revision,
    'providedAttributes',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      )
  );
  assignment_digest :=
    sellerpilot_private.smartstore_category_source_hash(assignment_value);
  assignment_value := assignment_value || pg_catalog.jsonb_build_object(
    'digest', assignment_digest
  );
  product_attributes_sha256 :=
    sellerpilot_private.smartstore_category_source_hash(
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      )
    );

  official_value := pg_catalog.jsonb_build_object(
    'contract', 'smartstore_category_attribute_official_readback_v1',
    'categoryId', assignment.category_id,
    'assignmentRevision', assignment_revision,
    'assignmentDigest', assignment_digest,
    'category', p_official_readback->'category',
    'attributes', sellerpilot_private.smartstore_category_source_sorted_records(
      p_official_readback->'attributes'
    ),
    'attributeValues',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValues'
      ),
    'attributeValueUnits',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValueUnits'
      )
  );
  official_digest :=
    sellerpilot_private.smartstore_category_source_hash(official_value);
  official_value := official_value || pg_catalog.jsonb_build_object(
    'digest', official_digest
  );

  select * into prior_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.assignment_revision = assignment_revision
   order by source.created_at desc
   limit 1;

  if prior_source.id is not null
     and (prior_source.assignment_digest is distinct from assignment_digest
       or prior_source.official_readback_digest is distinct from official_digest
       or prior_source.product_attributes_sha256 is distinct from
         product_attributes_sha256) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_REVISION_CONFLICT'
      using errcode = '23505';
  end if;

  if current_source.id is not null
     and current_source.product_updated_at = p_product_updated_at
     and current_source.credential_id = p_credential_id
     and current_source.credential_version = p_credential_version
     and current_source.seller_account_key = p_seller_account_key
     and current_source.approved_detail_revision = p_approved_detail_revision
     and current_source.approved_detail_digest = p_approved_detail_digest
     and current_source.assignment_id = p_assignment_id
     and current_source.assignment_updated_at = p_assignment_updated_at
     and current_source.assignment_source_digest = assignment_source_digest
     and current_source.assignment_digest = assignment_digest
     and current_source.official_readback_digest = official_digest
     and current_source.product_attributes_sha256 =
       product_attributes_sha256 then
    return pg_catalog.jsonb_build_object(
      'sourceId', current_source.id,
      'replayed', true,
      'assignmentRevision', current_source.assignment_revision,
      'assignmentDigest', current_source.assignment_digest,
      'officialReadbackDigest', current_source.official_readback_digest,
      'productAttributesSha256', current_source.product_attributes_sha256
    );
  end if;

  if current_source.id is null and prior_source.id is not null
     and prior_source.retired_reason in (
       'operator_retired', 'source_invalidated'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRED_REPLAY'
      using errcode = '55000';
  end if;

  if current_source.id is not null then
    update sellerpilot_private.smartstore_create_category_attribute_sources
       set retired_at = pg_catalog.clock_timestamp(),
           retired_reason = 'superseded'
     where id = current_source.id;
  end if;

  insert into sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id, product_updated_at,
    credential_id, credential_version, seller_account_key,
    approved_detail_revision, approved_detail_digest,
    assignment_id, assignment_updated_at, assignment_revision,
    assignment_source_digest, assignment_digest, assignment,
    official_readback_digest, official_readback,
    product_attributes_sha256
  ) values (
    p_owner_id, p_product_id, p_product_updated_at,
    p_credential_id, p_credential_version, p_seller_account_key,
    p_approved_detail_revision, p_approved_detail_digest,
    p_assignment_id, p_assignment_updated_at, assignment_revision,
    assignment_source_digest, assignment_digest, assignment_value,
    official_digest, official_value, product_attributes_sha256
  ) returning id into inserted_id;

  return pg_catalog.jsonb_build_object(
    'sourceId', inserted_id,
    'replayed', false,
    'assignmentRevision', assignment_revision,
    'assignmentDigest', assignment_digest,
    'officialReadbackDigest', official_digest,
    'productAttributesSha256', product_attributes_sha256
  );
end;
$$;

create function public.sellerpilot_service_retire_smartstore_create_category_source(
  p_source_id uuid,
  p_assignment_digest text,
  p_official_readback_digest text,
  p_reason text default 'operator_retired'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_source_id is null or p_assignment_digest is null
     or p_official_readback_digest is null
     or p_reason not in ('operator_retired', 'source_invalidated') then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRE_INVALID'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910031000);
  update sellerpilot_private.smartstore_create_category_attribute_sources source
     set retired_at = pg_catalog.clock_timestamp(),
         retired_reason = p_reason
   where source.id = p_source_id
     and source.retired_at is null
     and source.assignment_digest = p_assignment_digest
     and source.official_readback_digest = p_official_readback_digest;
  return found;
end;
$$;

alter function public.sellerpilot_service_smartstore_create_source_snapshot(
  uuid,uuid,uuid
) rename to sp_60910031000_smartstore_snapshot_before_category_source;
revoke all on function
  public.sp_60910031000_smartstore_snapshot_before_category_source(
    uuid,uuid,uuid
  ) from public, anon, authenticated, service_role;

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
  base_snapshot jsonb;
  category_source jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  base_snapshot :=
    public.sp_60910031000_smartstore_snapshot_before_category_source(
      p_owner_id, p_product_id, p_credential_id
    );
  if base_snapshot is null then
    return null;
  end if;
  category_source :=
    sellerpilot_private.smartstore_category_source_current_json(
      p_owner_id, p_product_id, p_credential_id
    );
  return base_snapshot || pg_catalog.jsonb_build_object(
    'categoryAttributeSource', category_source
  );
end;
$$;

alter function sellerpilot_private.smartstore_create_source_is_current(
  uuid,uuid
) rename to sp_60910031000_smartstore_source_before_category;
revoke all on function
  sellerpilot_private.sp_60910031000_smartstore_source_before_category(
    uuid,uuid
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_create_source_is_current(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
begin
  select source.*
    into source_row
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by
     and source.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and source.credential_id = job.credential_id
     and source.retired_at is null
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'running'
     and job.provider_mutation_started_at is null
     and job.seller_account_key = source.seller_account_key
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,contract}'
       = 'smartstore_category_attribute_mapping_v1'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,ok}'
       = 'true'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,categoryId}'
       = source.assignment->>'categoryId'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentRevision}'
       = source.assignment_revision::text
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentDigest}'
       = source.assignment_digest
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,officialReadbackDigest}'
       = source.official_readback_digest
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,productAttributesSha256}'
       = source.product_attributes_sha256
     and job.request_payload#>>'{arguments,body,originProduct,leafCategoryId}'
       = source.assignment->>'categoryId'
     and pg_catalog.jsonb_typeof(
       job.request_payload#>'{arguments,body,originProduct,detailAttribute,productAttributes}'
     ) = 'array'
     and sellerpilot_private.smartstore_category_source_hash(
       sellerpilot_private.smartstore_category_source_sorted_records(
         job.request_payload#>'{arguments,body,originProduct,detailAttribute,productAttributes}'
       )
     ) = source.product_attributes_sha256
   for update of job, source;

  if source_row.id is null then
    return false;
  end if;
  perform 1 from sellerpilot_private.products product
   where product.id = source_row.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials credential
   where credential.id = source_row.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments assignment
   where assignment.id = source_row.assignment_id for update;
  if sellerpilot_private.smartstore_category_source_current_json(
       source_row.owner_id,
       source_row.product_id,
       source_row.credential_id
     ) is null then
    return false;
  end if;
  return sellerpilot_private.sp_60910031000_smartstore_source_before_category(
    p_job_id, p_claim_token
  ) is true;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_category_source_canonical(jsonb),
  sellerpilot_private.smartstore_category_source_hash(jsonb),
  sellerpilot_private.smartstore_category_source_sorted_records(jsonb),
  sellerpilot_private.smartstore_category_assignment_source_payload(jsonb,jsonb),
  sellerpilot_private.guard_smartstore_category_source_append_only(),
  sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid),
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_read_smartstore_create_category_source(uuid,uuid,uuid),
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ),
  public.sellerpilot_service_retire_smartstore_create_category_source(
    uuid,text,text,text
  ),
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_read_smartstore_create_category_source(uuid,uuid,uuid),
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ),
  public.sellerpilot_service_retire_smartstore_create_category_source(
    uuid,text,text,text
  ),
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)
  to service_role;

comment on table
  sellerpilot_private.smartstore_create_category_attribute_sources is
  'Append-only, service-owned SmartStore listing.create category/attribute source. One current row binds exact owner/product revision, approval, credential account/version, confirmed assignment revision, and canonical official readback.';
comment on function
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid) is
  'Final local/serverless SmartStore listing.create fence. Locks and rechecks the durable category source and exact job mapping/body digests before either provider begin wrapper can mutate.';

notify pgrst, 'reload schema';


-- Reviewed source: 20260910032000_smartstore_create_category_source_collector_context.sql
-- Source SHA256: 645b3d261999194470c14db8eb005646d7e570e3428d14e9753cd46ad3a96625
-- Service-only preparation context for the SmartStore CREATE category source
-- collector. The official Naver receipt is fetched after this transaction and
-- the 031000 append RPC re-locks every referenced row to reject TOCTOU drift.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910032000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_category_assignments'
     ) is null then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTOR_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create function public.sellerpilot_service_smartstore_create_category_collect_ctx(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  assignment_count integer;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_product_id is null or p_credential_id is null then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_NULL'
      using errcode = '22023';
  end if;

  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = p_product_id
   for share;
  if product.id is null
     or product.owner_id is distinct from p_owner_id
     or product.status <> 'ready'
     or product.demo
     or product.updated_at is null
     or product.detail_page_version is null
     or product.detail_page_version < 1
     or product.detail_page_approved_version is distinct from
       product.detail_page_version
     or product.detail_page_image_manifest->>'digest' !~ '^[a-f0-9]{64}$' then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_PRODUCT_NOT_READY'
      using errcode = '55000';
  end if;

  select * into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = p_credential_id
   for share;
  if credential.id is null
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp())
     or credential.last_check_status <> 'passed'
     or credential.version is null or credential.version < 1
     or credential.seller_account_key !~ '^[a-f0-9]{64}$'
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_CREDENTIAL_NOT_READY'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer into assignment_count
    from sellerpilot_private.product_category_assignments candidate
   where candidate.owner_id = p_owner_id
     and candidate.product_id = p_product_id
     and candidate.channel = 'smartstore'
     and candidate.environment = 'production'
     and candidate.market = 'KR'
     and candidate.status = 'confirmed'
     and candidate.is_leaf
     and length(pg_catalog.btrim(candidate.category_id)) between 1 and 120
     and candidate.updated_at is not null
     and candidate.official_verified_at is not null
     and candidate.confirmed_at is not null
     and pg_catalog.jsonb_typeof(candidate.required_attributes) = 'array'
     and pg_catalog.jsonb_typeof(candidate.provided_attributes) = 'object'
     and pg_catalog.jsonb_typeof(candidate.missing_required_attributes) =
       'array'
     and pg_catalog.jsonb_array_length(
       candidate.missing_required_attributes
     ) = 0;
  if assignment_count <> 1 then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_ASSIGNMENT_AMBIGUOUS'
      using errcode = '55000';
  end if;

  select * into assignment
    from sellerpilot_private.product_category_assignments candidate
   where candidate.owner_id = p_owner_id
     and candidate.product_id = p_product_id
     and candidate.channel = 'smartstore'
     and candidate.environment = 'production'
     and candidate.market = 'KR'
     and candidate.status = 'confirmed'
     and candidate.is_leaf
     and length(pg_catalog.btrim(candidate.category_id)) between 1 and 120
     and candidate.updated_at is not null
     and candidate.official_verified_at is not null
     and candidate.confirmed_at is not null
     and pg_catalog.jsonb_typeof(candidate.required_attributes) = 'array'
     and pg_catalog.jsonb_typeof(candidate.provided_attributes) = 'object'
     and pg_catalog.jsonb_typeof(candidate.missing_required_attributes) =
       'array'
     and pg_catalog.jsonb_array_length(
       candidate.missing_required_attributes
     ) = 0
   for share;

  return pg_catalog.jsonb_build_object(
    'contract', 'smartstore_create_category_source_collection_context_v1',
    'ownerId', product.owner_id,
    'productId', product.id,
    'productUpdatedAt', product.updated_at,
    'credentialId', credential.id,
    'credentialVersion', credential.version,
    'sellerAccountKey', credential.seller_account_key,
    'approvedDetailRevision', product.detail_page_version,
    'approvedDetailDigest',
      product.detail_page_image_manifest->>'digest',
    'assignmentId', assignment.id,
    'assignmentUpdatedAt', assignment.updated_at,
    'categoryId', assignment.category_id,
    'providedAttributes', assignment.provided_attributes
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_smartstore_create_category_collect_ctx(
    uuid, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_smartstore_create_category_collect_ctx(
    uuid, uuid, uuid
  ) to service_role;

comment on function
  public.sellerpilot_service_smartstore_create_category_collect_ctx(
    uuid, uuid, uuid
  ) is
  'Returns exact DB facts to the service-only Naver category source collector; 031000 append rechecks every fact after official GETs.';


-- Reviewed source: 20260910035500_smartstore_create_category_source_hardening.sql
-- Source SHA256: a3afc48458818bccfd4aff850cc1dac2585e1b2d5f7efcc83ad3645fa58a95d7
-- SmartStore 012-r3: official category projection, stored-selection
-- equivalence, exact-one assignment CAS, expiring source refresh, and a single
-- product/credential/assignment/source lock order at both provider boundaries.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910035500);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_create_category_attribute_sources'
     ) is null then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_HARDENING_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

alter table sellerpilot_private.smartstore_create_category_attribute_sources
  add column expires_at timestamptz;

update sellerpilot_private.smartstore_create_category_attribute_sources
   set expires_at = created_at + interval '15 minutes';

alter table sellerpilot_private.smartstore_create_category_attribute_sources
  alter column expires_at set not null,
  alter column expires_at set default
    (pg_catalog.clock_timestamp() + interval '15 minutes'),
  add constraint smartstore_create_category_source_expiry_valid
    check (expires_at > created_at);

create unique index
  smartstore_one_confirmed_production_kr_leaf_assignment_idx
on sellerpilot_private.product_category_assignments(
  owner_id, product_id, channel, environment, market
)
where product_id is not null
  and channel = 'smartstore'
  and environment = 'production'
  and market = 'KR'
  and status = 'confirmed'
  and is_leaf;

alter function
  sellerpilot_private.smartstore_category_source_payload_is_valid(
    text,jsonb,jsonb
  ) rename to sp_60910035500_category_payload_before_documented_fields;

revoke all on function
  sellerpilot_private.sp_60910035500_category_payload_before_documented_fields(
    text,jsonb,jsonb
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_category_source_payload_is_valid(
  p_category_id text,
  p_provider_attributes jsonb,
  p_official_readback jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  category_value jsonb := p_official_readback->'category';
  certification jsonb;
  base_readback jsonb;
begin
  if pg_catalog.jsonb_typeof(category_value) is distinct from 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(category_value) field_name
       where field_name not in (
         'id', 'name', 'wholeCategoryName', 'last',
         'exceptionalCategories', 'certificationInfos'
       )
     )
     or (category_value ? 'exceptionalCategories'
       and (pg_catalog.jsonb_typeof(
         category_value->'exceptionalCategories'
       ) <> 'array'
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           category_value->'exceptionalCategories'
         ) item
         where pg_catalog.jsonb_typeof(item) <> 'string'
           or nullif(pg_catalog.btrim(item#>>'{}'), '') is null
       )))
     or (category_value ? 'certificationInfos'
       and pg_catalog.jsonb_typeof(
         category_value->'certificationInfos'
       ) <> 'array') then
    return false;
  end if;

  for certification in
    select item from pg_catalog.jsonb_array_elements(
      coalesce(category_value->'certificationInfos', '[]'::jsonb)
    ) item
  loop
    if pg_catalog.jsonb_typeof(certification) <> 'object'
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(certification) field_name
         where field_name not in ('id', 'name', 'kindTypes')
       )
       or coalesce(certification->>'id', '') !~ '^[1-9]\d*$'
       or (certification->>'id')::numeric > 9007199254740991
       or pg_catalog.jsonb_typeof(certification->'name') <> 'string'
       or nullif(pg_catalog.btrim(certification->>'name'), '') is null
       or pg_catalog.jsonb_typeof(certification->'kindTypes') <> 'array'
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(certification->'kindTypes') item
         where pg_catalog.jsonb_typeof(item) <> 'string'
           or nullif(pg_catalog.btrim(item#>>'{}'), '') is null
       ) then
      return false;
    end if;
  end loop;

  base_readback := pg_catalog.jsonb_set(
    p_official_readback,
    '{category}',
    category_value - 'exceptionalCategories' - 'certificationInfos'
  );
  return sellerpilot_private
    .sp_60910035500_category_payload_before_documented_fields(
      p_category_id, p_provider_attributes, base_readback
    );
exception when others then
  return false;
end;
$$;

create function
  sellerpilot_private.smartstore_category_source_compile_stored_selection(
    p_stored_selection jsonb,
    p_official_readback jsonb
  )
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  attribute_key text;
  stored_value jsonb;
  selected_value jsonb;
  attribute_row jsonb;
  classification text;
  attribute_seq numeric;
  attribute_value_seq numeric;
  real_value text;
  unit_code text;
  compiled jsonb := '[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(p_stored_selection) <> 'object' then
    return null;
  end if;
  for attribute_key, stored_value in
    select key, value from pg_catalog.jsonb_each(p_stored_selection)
  loop
    if attribute_key !~ '^[1-9]\d*$'
       or attribute_key::numeric > 9007199254740991 then
      return null;
    end if;
    attribute_seq := attribute_key::numeric;
    select item into attribute_row
      from pg_catalog.jsonb_array_elements(
        p_official_readback->'attributes'
      ) item
     where item->>'attributeSeq' = attribute_key
     limit 1;
    if attribute_row is null then
      return null;
    end if;
    classification := attribute_row->>'attributeClassificationType';

    if classification in ('SINGLE_SELECT', 'MULTI_SELECT') then
      if pg_catalog.jsonb_typeof(stored_value) = 'array' then
        if pg_catalog.jsonb_array_length(stored_value) = 0 then
          return null;
        end if;
        for selected_value in
          select item from pg_catalog.jsonb_array_elements(stored_value) item
        loop
          if coalesce(selected_value#>>'{}', '') !~ '^[1-9]\d*$'
             or (selected_value#>>'{}')::numeric > 9007199254740991 then
            return null;
          end if;
          attribute_value_seq := (selected_value#>>'{}')::numeric;
          compiled := compiled || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'attributeSeq', attribute_seq,
              'attributeValueSeq', attribute_value_seq
            )
          );
        end loop;
      else
        if coalesce(stored_value#>>'{}', '') !~ '^[1-9]\d*$'
           or (stored_value#>>'{}')::numeric > 9007199254740991 then
          return null;
        end if;
        attribute_value_seq := (stored_value#>>'{}')::numeric;
        compiled := compiled || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'attributeSeq', attribute_seq,
            'attributeValueSeq', attribute_value_seq
          )
        );
      end if;
    elsif classification = 'RANGE' then
      if pg_catalog.jsonb_typeof(stored_value) <> 'object'
         or exists (
           select 1 from pg_catalog.jsonb_object_keys(stored_value) field_name
           where field_name not in (
             'attributeValueSeq', 'attributeRealValue',
             'attributeRealValueUnitCode'
           )
         )
         or coalesce(stored_value->>'attributeValueSeq', '') !~ '^[1-9]\d*$'
         or (stored_value->>'attributeValueSeq')::numeric > 9007199254740991
         or nullif(pg_catalog.btrim(
           stored_value->>'attributeRealValue'
         ), '') is null then
        return null;
      end if;
      attribute_value_seq := (stored_value->>'attributeValueSeq')::numeric;
      real_value := pg_catalog.btrim(stored_value->>'attributeRealValue');
      unit_code := nullif(pg_catalog.btrim(
        stored_value->>'attributeRealValueUnitCode'
      ), '');
      compiled := compiled || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'attributeSeq', attribute_seq,
          'attributeValueSeq', attribute_value_seq,
          'attributeRealValue', real_value
        ) || case when unit_code is null then '{}'::jsonb
          else pg_catalog.jsonb_build_object(
            'attributeRealValueUnitCode', unit_code
          ) end
      );
    else
      return null;
    end if;
  end loop;
  return sellerpilot_private.smartstore_category_source_sorted_records(
    compiled
  );
exception when others then
  return null;
end;
$$;

create or replace function public.sellerpilot_service_append_smartstore_create_category_source(
  p_owner_id uuid,
  p_product_id uuid,
  p_product_updated_at timestamptz,
  p_credential_id uuid,
  p_credential_version integer,
  p_seller_account_key text,
  p_approved_detail_revision bigint,
  p_approved_detail_digest text,
  p_assignment_id uuid,
  p_assignment_updated_at timestamptz,
  p_provider_attributes jsonb,
  p_official_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  current_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  matching_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  prior_source sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
  assignment_source_digest text;
  assignment_revision bigint;
  assignment_value jsonb;
  assignment_digest text;
  official_value jsonb;
  official_digest text;
  product_attributes_sha256 text;
  inserted_id uuid;
  compiled_provider_attributes jsonb;
  current_official_payload jsonb;
  normalized_official_payload jsonb;
  assignment_count integer;
  matching_retired sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910035500);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910031000);

  if p_owner_id is null or p_product_id is null
     or p_product_updated_at is null or p_credential_id is null
     or p_credential_version is null or p_seller_account_key is null
     or p_approved_detail_revision is null or p_approved_detail_digest is null
     or p_assignment_id is null or p_assignment_updated_at is null
     or p_provider_attributes is null or p_official_readback is null
     or pg_catalog.jsonb_typeof(p_provider_attributes) <> 'array'
     or pg_catalog.jsonb_typeof(p_official_readback) <> 'object'
     or pg_catalog.jsonb_typeof(p_official_readback->'category') <> 'object'
     or pg_catalog.jsonb_typeof(p_official_readback->'attributes') <> 'array'
     or pg_catalog.jsonb_typeof(p_official_readback->'attributeValues') <> 'array'
     or pg_catalog.jsonb_typeof(
       p_official_readback->'attributeValueUnits'
     ) <> 'array' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_NULL_OR_SHAPE_INVALID'
      using errcode = '22023';
  end if;

  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = p_product_id
   for update;
  if product.id is null
     or product.owner_id is distinct from p_owner_id
     or product.updated_at is distinct from p_product_updated_at
     or product.status <> 'ready' or product.demo
     or product.detail_page_version is distinct from p_approved_detail_revision
     or product.detail_page_approved_version is distinct from
       p_approved_detail_revision
     or product.detail_page_image_manifest->>'digest' is distinct from
       p_approved_detail_digest
     or p_approved_detail_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PRODUCT_STALE'
      using errcode = '55000';
  end if;

  select * into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = p_credential_id
   for update;
  if credential.id is null
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp())
     or credential.last_check_status <> 'passed'
     or credential.version is distinct from p_credential_version
     or credential.seller_account_key is distinct from p_seller_account_key
     or p_seller_account_key !~ '^[a-f0-9]{64}$'
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CREDENTIAL_STALE'
      using errcode = '55000';
  end if;

  select * into assignment
    from sellerpilot_private.product_category_assignments candidate
   where candidate.id = p_assignment_id
   for update;
  if assignment.id is null
     or assignment.owner_id is distinct from p_owner_id
     or assignment.product_id is distinct from p_product_id
     or assignment.updated_at is distinct from p_assignment_updated_at
     or assignment.channel <> 'smartstore'
     or assignment.environment <> 'production'
     or assignment.market <> 'KR'
     or assignment.status <> 'confirmed'
     or not assignment.is_leaf
     or assignment.official_verified_at is null
     or assignment.confirmed_at is null
     or pg_catalog.jsonb_typeof(assignment.missing_required_attributes)
       <> 'array'
     or pg_catalog.jsonb_array_length(
       assignment.missing_required_attributes
     ) <> 0 then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_ASSIGNMENT_STALE'
      using errcode = '55000';
  end if;

  -- Validate every nested official/provider field before revision lookup. An
  -- invalid receipt therefore cannot reserve or poison an assignment revision.
  if p_official_readback#>>'{category,id}' is distinct from
       assignment.category_id
     or pg_catalog.jsonb_typeof(
       p_official_readback#>'{category,last}'
     ) <> 'boolean'
     or p_official_readback#>>'{category,last}' is distinct from 'true' then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_CROSS_CATEGORY'
      using errcode = '55000';
  end if;
  if not sellerpilot_private.smartstore_category_source_payload_is_valid(
    assignment.category_id, p_provider_attributes, p_official_readback
  ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer into assignment_count
    from sellerpilot_private.product_category_assignments candidate
   where candidate.owner_id = p_owner_id
     and candidate.product_id = p_product_id
     and candidate.channel = 'smartstore'
     and candidate.environment = 'production'
     and candidate.market = 'KR'
     and candidate.status = 'confirmed'
     and candidate.is_leaf
     and length(pg_catalog.btrim(candidate.category_id)) between 1 and 120
     and candidate.updated_at is not null
     and candidate.official_verified_at is not null
     and candidate.confirmed_at is not null
     and pg_catalog.jsonb_typeof(candidate.required_attributes) = 'array'
     and pg_catalog.jsonb_typeof(candidate.provided_attributes) = 'object'
     and pg_catalog.jsonb_typeof(candidate.missing_required_attributes) = 'array'
     and pg_catalog.jsonb_array_length(
       candidate.missing_required_attributes
     ) = 0;
  if assignment_count <> 1 then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_ASSIGNMENT_AMBIGUOUS'
      using errcode = '55000';
  end if;

  compiled_provider_attributes :=
    sellerpilot_private.smartstore_category_source_compile_stored_selection(
      assignment.provided_attributes, p_official_readback
    );
  if compiled_provider_attributes is null
     or compiled_provider_attributes is distinct from
       sellerpilot_private.smartstore_category_source_sorted_records(
         p_provider_attributes
       ) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_STORED_SELECTION_MISMATCH'
      using errcode = '22023';
  end if;

  normalized_official_payload := pg_catalog.jsonb_build_object(
    'category', p_official_readback->'category',
    'attributes', sellerpilot_private.smartstore_category_source_sorted_records(
      p_official_readback->'attributes'
    ),
    'attributeValues',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValues'
      ),
    'attributeValueUnits',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValueUnits'
      )
  );

  assignment_source_digest :=
    sellerpilot_private.smartstore_category_source_hash(
      sellerpilot_private.smartstore_category_assignment_source_payload(
        pg_catalog.to_jsonb(assignment), p_provider_attributes
      )
    );

  select * into current_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.retired_at is null
   for update;

  if current_source.id is not null then
    current_official_payload := current_source.official_readback
      - 'contract' - 'categoryId' - 'assignmentRevision'
      - 'assignmentDigest' - 'digest';
  end if;

  if current_source.id is not null
     and current_source.expires_at > pg_catalog.clock_timestamp()
     and current_source.assignment_source_digest = assignment_source_digest
     and current_official_payload = normalized_official_payload then
    assignment_revision := current_source.assignment_revision;
  else
    select coalesce(max(source.assignment_revision), 0) + 1
      into assignment_revision
      from sellerpilot_private.smartstore_create_category_attribute_sources source
     where source.owner_id = p_owner_id
       and source.product_id = p_product_id;
  end if;

  assignment_value := pg_catalog.jsonb_build_object(
    'contract', 'smartstore_category_attribute_assignment_v1',
    'channel', 'smartstore',
    'operation', 'listing.create',
    'environment', 'production',
    'market', 'KR',
    'status', 'confirmed',
    'categoryId', assignment.category_id,
    'revision', assignment_revision,
    'providedAttributes',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      )
  );
  assignment_digest :=
    sellerpilot_private.smartstore_category_source_hash(assignment_value);
  assignment_value := assignment_value || pg_catalog.jsonb_build_object(
    'digest', assignment_digest
  );
  product_attributes_sha256 :=
    sellerpilot_private.smartstore_category_source_hash(
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_provider_attributes
      )
    );

  official_value := pg_catalog.jsonb_build_object(
    'contract', 'smartstore_category_attribute_official_readback_v1',
    'categoryId', assignment.category_id,
    'assignmentRevision', assignment_revision,
    'assignmentDigest', assignment_digest,
    'category', p_official_readback->'category',
    'attributes', sellerpilot_private.smartstore_category_source_sorted_records(
      p_official_readback->'attributes'
    ),
    'attributeValues',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValues'
      ),
    'attributeValueUnits',
      sellerpilot_private.smartstore_category_source_sorted_records(
        p_official_readback->'attributeValueUnits'
      )
  );
  official_digest :=
    sellerpilot_private.smartstore_category_source_hash(official_value);
  official_value := official_value || pg_catalog.jsonb_build_object(
    'digest', official_digest
  );

  select * into prior_source
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.assignment_revision = assignment_revision
   order by source.created_at desc
   limit 1;

  if prior_source.id is not null
     and (prior_source.assignment_digest is distinct from assignment_digest
       or prior_source.official_readback_digest is distinct from official_digest
       or prior_source.product_attributes_sha256 is distinct from
         product_attributes_sha256) then
    raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_REVISION_CONFLICT'
      using errcode = '23505';
  end if;

  if current_source.id is not null
     and current_source.expires_at > pg_catalog.clock_timestamp()
     and current_source.product_updated_at = p_product_updated_at
     and current_source.credential_id = p_credential_id
     and current_source.credential_version = p_credential_version
     and current_source.seller_account_key = p_seller_account_key
     and current_source.approved_detail_revision = p_approved_detail_revision
     and current_source.approved_detail_digest = p_approved_detail_digest
     and current_source.assignment_id = p_assignment_id
     and current_source.assignment_updated_at = p_assignment_updated_at
     and current_source.assignment_source_digest = assignment_source_digest
     and current_source.assignment_digest = assignment_digest
     and current_source.official_readback_digest = official_digest
     and current_source.product_attributes_sha256 =
       product_attributes_sha256 then
    return pg_catalog.jsonb_build_object(
      'sourceId', current_source.id,
      'replayed', true,
      'assignmentRevision', current_source.assignment_revision,
      'assignmentDigest', current_source.assignment_digest,
      'officialReadbackDigest', current_source.official_readback_digest,
      'productAttributesSha256', current_source.product_attributes_sha256
    );
  end if;

  if current_source.id is null then
    select * into matching_retired
      from sellerpilot_private.smartstore_create_category_attribute_sources source
     where source.owner_id = p_owner_id
       and source.product_id = p_product_id
       and source.assignment_source_digest = assignment_source_digest
       and (source.official_readback
         - 'contract' - 'categoryId' - 'assignmentRevision'
         - 'assignmentDigest' - 'digest') = normalized_official_payload
     order by source.created_at desc
     limit 1;
    if matching_retired.id is not null
       and matching_retired.retired_reason in (
         'operator_retired', 'source_invalidated'
       ) then
      raise exception 'SMARTSTORE_CATEGORY_ATTRIBUTE_SOURCE_RETIRED_REPLAY'
        using errcode = '55000';
    end if;
  end if;

  if current_source.id is not null then
    update sellerpilot_private.smartstore_create_category_attribute_sources
       set retired_at = pg_catalog.clock_timestamp(),
           retired_reason = 'superseded'
     where id = current_source.id;
  end if;

  insert into sellerpilot_private.smartstore_create_category_attribute_sources(
    owner_id, product_id, product_updated_at,
    credential_id, credential_version, seller_account_key,
    approved_detail_revision, approved_detail_digest,
    assignment_id, assignment_updated_at, assignment_revision,
    assignment_source_digest, assignment_digest, assignment,
    official_readback_digest, official_readback,
    product_attributes_sha256
  ) values (
    p_owner_id, p_product_id, p_product_updated_at,
    p_credential_id, p_credential_version, p_seller_account_key,
    p_approved_detail_revision, p_approved_detail_digest,
    p_assignment_id, p_assignment_updated_at, assignment_revision,
    assignment_source_digest, assignment_digest, assignment_value,
    official_digest, official_value, product_attributes_sha256
  ) returning id into inserted_id;

  return pg_catalog.jsonb_build_object(
    'sourceId', inserted_id,
    'replayed', false,
    'assignmentRevision', assignment_revision,
    'assignmentDigest', assignment_digest,
    'officialReadbackDigest', official_digest,
    'productAttributesSha256', product_attributes_sha256
  );
end;
$$;

create or replace function sellerpilot_private.smartstore_category_source_current_json(
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
  select pg_catalog.jsonb_build_object(
           'contract', 'smartstore_listing_create_category_source_v1',
           'collectedAt', source.created_at,
           'expiresAt', source.expires_at,
           'assignment', source.assignment,
           'officialReadback', source.official_readback
         )
    into result
    from sellerpilot_private.smartstore_create_category_attribute_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.credential_id = p_credential_id
     and source.retired_at is null
     and source.expires_at > pg_catalog.clock_timestamp()
     and exists (
       select 1 from sellerpilot_private.products product
       where product.id = source.product_id
         and product.owner_id = source.owner_id
         and product.updated_at = source.product_updated_at
         and product.status = 'ready'
         and not product.demo
         and product.detail_page_version = source.approved_detail_revision
         and product.detail_page_approved_version =
           source.approved_detail_revision
         and product.detail_page_image_manifest->>'digest' =
           source.approved_detail_digest
     )
     and exists (
       select 1 from sellerpilot_private.channel_credentials credential
       where credential.id = source.credential_id
         and credential.channel = 'smartstore'
         and credential.environment = 'production'
         and credential.status = 'active'
         and (credential.expires_at is null
           or credential.expires_at > pg_catalog.clock_timestamp())
         and credential.last_check_status = 'passed'
         and credential.version = source.credential_version
         and credential.seller_account_key = source.seller_account_key
         and credential.seller_account_key_source in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
     )
     and exists (
       select 1
       from sellerpilot_private.product_category_assignments category_assignment
       where category_assignment.id = source.assignment_id
         and category_assignment.owner_id = source.owner_id
         and category_assignment.product_id = source.product_id
         and category_assignment.channel = 'smartstore'
         and category_assignment.environment = 'production'
         and category_assignment.market = 'KR'
         and category_assignment.status = 'confirmed'
         and category_assignment.is_leaf
         and category_assignment.category_id = source.assignment->>'categoryId'
         and category_assignment.updated_at = source.assignment_updated_at
         and category_assignment.official_verified_at is not null
         and category_assignment.confirmed_at is not null
         and pg_catalog.jsonb_typeof(
           category_assignment.missing_required_attributes
         ) = 'array'
         and pg_catalog.jsonb_array_length(
           category_assignment.missing_required_attributes
         ) = 0
         and sellerpilot_private.smartstore_category_source_hash(
           sellerpilot_private.smartstore_category_assignment_source_payload(
             pg_catalog.to_jsonb(category_assignment),
             source.assignment->'providedAttributes'
           )
         ) = source.assignment_source_digest
     )
     and 1 = (
       select pg_catalog.count(*)
       from sellerpilot_private.product_category_assignments exact_assignment
       where exact_assignment.owner_id = source.owner_id
         and exact_assignment.product_id = source.product_id
         and exact_assignment.channel = 'smartstore'
         and exact_assignment.environment = 'production'
         and exact_assignment.market = 'KR'
         and exact_assignment.status = 'confirmed'
         and exact_assignment.is_leaf
         and length(pg_catalog.btrim(
           exact_assignment.category_id
         )) between 1 and 120
         and exact_assignment.updated_at is not null
         and exact_assignment.official_verified_at is not null
         and exact_assignment.confirmed_at is not null
         and pg_catalog.jsonb_typeof(
           exact_assignment.required_attributes
         ) = 'array'
         and pg_catalog.jsonb_typeof(
           exact_assignment.provided_attributes
         ) = 'object'
         and pg_catalog.jsonb_typeof(
           exact_assignment.missing_required_attributes
         ) = 'array'
         and pg_catalog.jsonb_array_length(
           exact_assignment.missing_required_attributes
         ) = 0
     )
     and source.assignment_digest = source.assignment->>'digest'
     and source.assignment_revision =
       (source.assignment->>'revision')::bigint
     and source.official_readback_digest =
       source.official_readback->>'digest'
     and source.official_readback->>'categoryId' =
       source.assignment->>'categoryId'
     and source.official_readback->>'assignmentRevision' =
       source.assignment_revision::text
     and source.official_readback->>'assignmentDigest' =
       source.assignment_digest
     and source.product_attributes_sha256 =
       sellerpilot_private.smartstore_category_source_hash(
         sellerpilot_private.smartstore_category_source_sorted_records(
           source.assignment->'providedAttributes'
         )
       );
  return result;
exception when others then
  return null;
end;
$$;


create or replace function sellerpilot_private.smartstore_create_source_is_current(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910035500);

  -- Discover identifiers without locking, then acquire the shared rows in the
  -- same order as append. The second SELECT is the authoritative locked CAS.
  select source.* into source_row
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by
     and source.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and source.credential_id = job.credential_id
     and source.retired_at is null
     and source.expires_at > pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'running'
     and job.provider_mutation_started_at is null;

  if source_row.id is null then
    return false;
  end if;

  perform 1 from sellerpilot_private.products product
   where product.id = source_row.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials credential
   where credential.id = source_row.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments assignment
   where assignment.id = source_row.assignment_id for update;

  select source.* into source_row
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by
     and source.product_id::text =
       job.request_payload#>>'{arguments,sellerpilotSmartstoreCreateSource,productId}'
     and source.credential_id = job.credential_id
     and source.retired_at is null
     and source.expires_at > pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'smartstore'
     and job.operation = 'listing.create'
     and job.environment = 'production'
     and job.status = 'running'
     and job.provider_mutation_started_at is null
     and job.seller_account_key = source.seller_account_key
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,contract}'
       = 'smartstore_category_attribute_mapping_v1'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,ok}'
       = 'true'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,categoryId}'
       = source.assignment->>'categoryId'
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentRevision}'
       = source.assignment_revision::text
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentDigest}'
       = source.assignment_digest
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,officialReadbackDigest}'
       = source.official_readback_digest
     and job.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,productAttributesSha256}'
       = source.product_attributes_sha256
     and job.request_payload#>>'{arguments,body,originProduct,leafCategoryId}'
       = source.assignment->>'categoryId'
     and pg_catalog.jsonb_typeof(
       job.request_payload#>'{arguments,body,originProduct,detailAttribute,productAttributes}'
     ) = 'array'
     and sellerpilot_private.smartstore_category_source_hash(
       sellerpilot_private.smartstore_category_source_sorted_records(
         job.request_payload#>'{arguments,body,originProduct,detailAttribute,productAttributes}'
       )
     ) = source.product_attributes_sha256
   for update of job, source;

  if source_row.id is null then
    return false;
  end if;
  if sellerpilot_private.smartstore_category_source_current_json(
       source_row.owner_id,
       source_row.product_id,
       source_row.credential_id
     ) is null then
    return false;
  end if;
  return sellerpilot_private.sp_60910031000_smartstore_source_before_category(
    p_job_id, p_claim_token
  ) is true;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_category_source_payload_is_valid(
    text,jsonb,jsonb
  ),
  sellerpilot_private.smartstore_category_source_compile_stored_selection(
    jsonb,jsonb
  ),
  sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid),
  sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ) to service_role;

comment on function
  public.sellerpilot_service_append_smartstore_create_category_source(
    uuid,uuid,timestamptz,uuid,integer,text,bigint,text,
    uuid,timestamptz,jsonb,jsonb
  ) is
  'Appends an expiring SmartStore official category source only when provider attributes exactly compile from the one current DB assignment; official drift advances revision and supersedes the old source.';


-- Recovery corrections: NULL cannot pass required transport fields; completion
-- revalidates owner/credential/attempt/listing lineage and distinct provider IDs.
-- The production gateway ledger uses succeeded; completed is only the API contract.
-- Reviewed source: 20260910050500_smartstore_final_transport_and_current_state_hardening_r4.sql
-- Source SHA256: 10456e14c95027afb442a71f071e8d67a5df63f85f55770bf871a017c64228ef
-- Bind SmartStore CREATE to the current product, manual intake, credential
-- incarnation and the exact UTF-8 JSON bytes used by POST /v2/products.
-- This migration installs contracts only; it performs no provider call.

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910050500);

do $dependencies$
begin
  if pg_catalog.to_regclass('sellerpilot_private.products') is null
     or pg_catalog.to_regclass('sellerpilot_private.product_listings') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_credentials') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_operation_attempts') is null
     or pg_catalog.to_regclass('sellerpilot_private.ai_cli_jobs') is null
     or pg_catalog.to_regprocedure(
          'sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)'
        ) is null then
    raise exception 'SMARTSTORE_FINAL_TRANSPORT_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create table sellerpilot_private.smartstore_create_final_transports (
  job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  attempt_id uuid not null
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  credential_vault_secret_id uuid not null,
  credential_last_rotated_at timestamptz not null,
  body_text text not null,
  body_json jsonb not null check (pg_catalog.jsonb_typeof(body_json) = 'object'),
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  body_byte_length integer not null check (body_byte_length between 2 and 1048576),
  body_binding_sha256 text not null check (body_binding_sha256 ~ '^[a-f0-9]{64}$'),
  product_updated_at timestamptz not null,
  manual_fields_sha256 text not null check (manual_fields_sha256 ~ '^[a-f0-9]{64}$'),
  staged_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint smartstore_create_final_transport_body_exact check (
    pg_catalog.octet_length(body_text) = body_byte_length
    and body_text::jsonb = body_json
  )
);

create unique index smartstore_create_transport_attempt_unique
  on sellerpilot_private.smartstore_create_final_transports(attempt_id);
create unique index smartstore_create_transport_listing_unique
  on sellerpilot_private.smartstore_create_final_transports(listing_id);

alter table sellerpilot_private.smartstore_create_final_transports
  enable row level security;
revoke all on sellerpilot_private.smartstore_create_final_transports
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_smartstore_create_source_snapshot(
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
  category_source jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select pg_catalog.jsonb_build_object(
           'contract', 'smartstore_listing_create_source_snapshot_v1',
           'productId', product.id,
           'ownerId', product.owner_id,
           'productUpdatedAt', product.updated_at,
           'detailPageVersion', product.detail_page_version,
           'approvedDetailPageVersion', product.detail_page_approved_version,
           'approvedManifestDigest', product.detail_page_image_manifest->>'digest',
           'sellerManagementCode', coalesce(
             nullif(pg_catalog.btrim(ai_job.request_payload#>>'{manual_fields,sellerSku}'), ''),
             pg_catalog.btrim(product.sku)
           ),
           'productName', coalesce(
             nullif(pg_catalog.btrim(ai_job.request_payload#>>'{manual_fields,productName}'), ''),
             pg_catalog.btrim(product.name)
           ),
           'salePrice', (ai_job.request_payload#>>'{manual_fields,sellingPrice}')::integer,
           'stockQuantity', (ai_job.request_payload#>>'{manual_fields,stock}')::integer,
           'manualFieldsSha256', encode(extensions.digest(
             coalesce(ai_job.request_payload->'manual_fields', '{}'::jsonb)::text,
             'sha256'
           ), 'hex'),
           'credentialId', credential.id,
           'credentialVersion', credential.version,
           'credentialFingerprint', credential.fingerprint,
           'credentialVaultSecretId', credential.vault_secret_id,
           'credentialLastRotatedAt', credential.last_rotated_at
         )
    into result
    from sellerpilot_private.products product
    join sellerpilot_private.ai_cli_jobs ai_job on ai_job.id = product.ai_job_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = 'smartstore'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.clock_timestamp())
     and credential.last_check_status = 'passed'
     and credential.version > 0
     and credential.fingerprint ~ '^[A-Fa-f0-9]{12}$'
     and credential.vault_secret_id is not null
     and credential.last_rotated_at is not null
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
     and pg_catalog.jsonb_typeof(ai_job.request_payload->'manual_fields') = 'object'
     and coalesce(ai_job.request_payload#>>'{manual_fields,currency}', '') = 'KRW'
     and coalesce(ai_job.request_payload#>>'{manual_fields,sellingPrice}', '')
       ~ '^[0-9]+$'
     and (ai_job.request_payload#>>'{manual_fields,sellingPrice}')::numeric
       between 10 and 999999990
     and (ai_job.request_payload#>>'{manual_fields,sellingPrice}')::numeric % 10 = 0
     and coalesce(ai_job.request_payload#>>'{manual_fields,stock}', '') ~ '^[0-9]+$'
     and (ai_job.request_payload#>>'{manual_fields,stock}')::numeric
       between 0 and 99999999
     and product.on_hand = (ai_job.request_payload#>>'{manual_fields,stock}')::integer
     and coalesce(
           nullif(pg_catalog.btrim(ai_job.request_payload#>>'{manual_fields,productName}'), ''),
           pg_catalog.btrim(product.name)
         ) = pg_catalog.btrim(product.name)
     and pg_catalog.char_length(pg_catalog.btrim(product.name)) between 1 and 100
     and pg_catalog.char_length(coalesce(
           nullif(pg_catalog.btrim(ai_job.request_payload#>>'{manual_fields,sellerSku}'), ''),
           pg_catalog.btrim(product.sku)
         )) between 1 and 100
     and exists (
       select 1 from sellerpilot_private.admin_users admin
       where admin.user_id = product.owner_id
     );

  if result is null then
    return null;
  end if;
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid)'
     ) is not null then
    execute
      'select sellerpilot_private.smartstore_category_source_current_json($1,$2,$3)'
      into category_source
      using p_owner_id, p_product_id, p_credential_id;
    if category_source is null then
      return null;
    end if;
    result := result || pg_catalog.jsonb_build_object(
      'categoryAttributeSource', category_source
    );
  end if;
  return result;
exception when others then
  return null;
end;
$$;

create function public.sellerpilot_service_stage_smartstore_create_transport(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_body_text text,
  p_body_sha256 text,
  p_body_byte_length integer,
  p_body_binding_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  manual_fields jsonb;
  source_binding jsonb;
  queued_body jsonb;
  final_body jsonb;
  current_manual_sha256 text;
  existing sellerpilot_private.smartstore_create_final_transports%rowtype;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
     or not sellerpilot_private.worker_token_may_complete_gateway_job(
       p_token_hash, p_job_id, p_claim_token
     ) then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_body_sha256, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_body_binding_sha256, '') !~ '^[a-f0-9]{64}$'
     or p_body_byte_length is null
     or p_body_byte_length not between 2 and 1048576
     or pg_catalog.octet_length(coalesce(p_body_text, '')) is distinct from p_body_byte_length
     or encode(extensions.digest(p_body_text, 'sha256'), 'hex') is distinct from p_body_sha256 then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_BYTES_INVALID'
      using errcode = '22023';
  end if;
  begin
    final_body := p_body_text::jsonb;
  exception when others then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_JSON_INVALID'
      using errcode = '22023';
  end;
  if pg_catalog.jsonb_typeof(final_body) is distinct from 'object' then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_JSON_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 910050500);
  select * into job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = p_job_id for update;
  if job.id is null
     or job.claim_token is distinct from p_claim_token
     or job.channel is distinct from 'smartstore'
     or job.operation is distinct from 'listing.create'
     or job.environment is distinct from 'production'
     or job.status is distinct from 'running'
     or job.provider_mutation_started_at is null
     or job.completed_at is not null
     or job.response_payload is not null then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_JOB_NOT_CURRENT'
      using errcode = '55000';
  end if;

  select * into attempt
    from sellerpilot_private.channel_operation_attempts candidate
   where candidate.id = job.attempt_id for update;
  select * into listing
    from sellerpilot_private.product_listings candidate
   where candidate.id = job.listing_id for update;
  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = listing.product_id for update;
  select * into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = job.credential_id for update;
  select coalesce(ai_job.request_payload->'manual_fields', '{}'::jsonb)
    into manual_fields
    from sellerpilot_private.ai_cli_jobs ai_job
   where ai_job.id = product.ai_job_id;

  source_binding := job.request_payload#>'{arguments,sellerpilotSmartstoreCreateSource}';
  queued_body := job.request_payload#>'{arguments,body}';
  current_manual_sha256 := encode(
    extensions.digest(coalesce(manual_fields, '{}'::jsonb)::text, 'sha256'),
    'hex'
  );

  if attempt.id is null
     or attempt.owner_id is distinct from job.created_by
     or attempt.credential_id is distinct from job.credential_id
     or attempt.channel is distinct from job.channel
     or attempt.operation is distinct from job.operation
     or attempt.status is distinct from 'running'
     or attempt.remote_id is not null
     or listing.id is null
     or listing.owner_id is distinct from job.created_by
     or listing.channel_key is distinct from 'smartstore'
     or listing.operation_attempt_id is distinct from attempt.id
     or listing.status not in ('draft', 'queued')
     or listing.remote_id is not null
     or product.id is null
     or product.owner_id is distinct from job.created_by
     or product.status is distinct from 'ready'
     or product.demo
     or credential.id is null
     or credential.channel is distinct from 'smartstore'
     or credential.environment is distinct from 'production'
     or credential.status is distinct from 'active'
     or credential.last_check_status is distinct from 'passed'
     or credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp()
     or source_binding->>'contract' is distinct from 'smartstore_listing_create_source_v1'
     or source_binding->>'productId' is distinct from product.id::text
     or source_binding->>'ownerId' is distinct from product.owner_id::text
     or (source_binding->>'productUpdatedAt')::timestamptz
       is distinct from product.updated_at
     or (source_binding->>'detailPageVersion')::bigint
       is distinct from product.detail_page_version
     or (source_binding->>'approvedDetailPageVersion')::bigint
       is distinct from product.detail_page_approved_version
     or source_binding->>'approvedManifestDigest'
       is distinct from product.detail_page_image_manifest->>'digest'
     or source_binding->>'sellerManagementCode'
       is distinct from coalesce(
         nullif(pg_catalog.btrim(manual_fields->>'sellerSku'), ''),
         pg_catalog.btrim(product.sku)
       )
     or source_binding->>'productName' is distinct from pg_catalog.btrim(product.name)
     or (source_binding->>'salePrice')::numeric
       is distinct from (manual_fields->>'sellingPrice')::numeric
     or (source_binding->>'stockQuantity')::integer
       is distinct from product.on_hand
     or source_binding->>'manualFieldsSha256' is distinct from current_manual_sha256
     or source_binding->>'credentialId' is distinct from credential.id::text
     or (source_binding->>'credentialVersion')::integer
       is distinct from credential.version
     or source_binding->>'credentialFingerprint'
       is distinct from credential.fingerprint
     or source_binding->>'credentialVaultSecretId'
       is distinct from credential.vault_secret_id::text
     or (source_binding->>'credentialLastRotatedAt')::timestamptz
       is distinct from credential.last_rotated_at
     or source_binding->>'bodyBindingSha256' is distinct from p_body_binding_sha256
     or pg_catalog.jsonb_typeof(queued_body) is distinct from 'object'
     or final_body#>>'{originProduct,name}' is distinct from pg_catalog.btrim(product.name)
     or (final_body#>>'{originProduct,salePrice}')::numeric
       is distinct from (manual_fields->>'sellingPrice')::numeric
     or (final_body#>>'{originProduct,stockQuantity}')::integer
       is distinct from product.on_hand
     or final_body#>>'{originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}'
       is distinct from source_binding->>'sellerManagementCode'
     or final_body#>'{originProduct,deliveryInfo}'
       is distinct from queued_body#>'{originProduct,deliveryInfo}'
     or final_body#>'{originProduct,detailAttribute,optionInfo}'
       is distinct from queued_body#>'{originProduct,detailAttribute,optionInfo}'
     or final_body#>'{originProduct,detailAttribute,unitCapacity}'
       is distinct from queued_body#>'{originProduct,detailAttribute,unitCapacity}'
     or final_body#>'{originProduct,detailAttribute,productAttributes}'
       is distinct from queued_body#>'{originProduct,detailAttribute,productAttributes}'
     or final_body#>>'{originProduct,leafCategoryId}'
       is distinct from queued_body#>>'{originProduct,leafCategoryId}'
     or final_body#>>'{smartstoreChannelProduct,channelProductName}'
       is distinct from queued_body#>>'{smartstoreChannelProduct,channelProductName}'
     or final_body#>>'{smartstoreChannelProduct,naverShoppingRegistration}' is distinct from 'true'
     or coalesce(final_body#>>'{originProduct,statusType}', '') not in ('SALE', 'SUSPENSION')
     or coalesce(final_body#>>'{smartstoreChannelProduct,channelProductDisplayStatusType}', '')
       not in ('ON', 'SUSPENSION')
     or pg_catalog.jsonb_typeof(final_body#>'{originProduct,images}') is distinct from 'object'
     or pg_catalog.jsonb_typeof(
       final_body#>'{originProduct,images,optionalImages}'
     ) is distinct from 'array'
     or pg_catalog.jsonb_array_length(
       final_body#>'{originProduct,images,optionalImages}'
     ) is distinct from 8 then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_SOURCE_DRIFT'
      using errcode = '55000';
  end if;

  select * into existing
    from sellerpilot_private.smartstore_create_final_transports transport
   where transport.job_id = job.id for update;
  if existing.job_id is not null then
    if existing.body_sha256 is distinct from p_body_sha256
       or existing.body_byte_length is distinct from p_body_byte_length
       or existing.body_binding_sha256 is distinct from p_body_binding_sha256
       or existing.body_text is distinct from p_body_text
       or existing.credential_id is distinct from credential.id
       or existing.credential_version is distinct from credential.version
       or existing.credential_vault_secret_id is distinct from credential.vault_secret_id
       or existing.credential_last_rotated_at is distinct from credential.last_rotated_at then
      raise exception 'SMARTSTORE_CREATE_TRANSPORT_REPLAY_MISMATCH'
        using errcode = '23505';
    end if;
  else
    insert into sellerpilot_private.smartstore_create_final_transports(
      job_id,attempt_id,listing_id,product_id,owner_id,credential_id,
      credential_version,credential_vault_secret_id,credential_last_rotated_at,
      body_text,body_json,body_sha256,body_byte_length,body_binding_sha256,
      product_updated_at,manual_fields_sha256
    ) values (
      job.id,attempt.id,listing.id,product.id,product.owner_id,credential.id,
      credential.version,credential.vault_secret_id,credential.last_rotated_at,
      p_body_text,final_body,p_body_sha256,p_body_byte_length,p_body_binding_sha256,
      product.updated_at,current_manual_sha256
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'smartstore_create_transport_stage_v1',
    'jobId', job.id,
    'bodySha256', p_body_sha256,
    'bodyByteLength', p_body_byte_length,
    'staged', true
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_SOURCE_DRIFT'
      using errcode = '55000';
end;
$$;

create table sellerpilot_private.smartstore_create_final_completions (
  job_id uuid primary key
    references sellerpilot_private.smartstore_create_final_transports(job_id)
    on delete restrict,
  attempt_id uuid not null
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  origin_product_no text not null check (origin_product_no ~ '^[0-9]+$'),
  channel_product_no text not null check (channel_product_no ~ '^[0-9]+$'),
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  body_binding_sha256 text not null check (body_binding_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table sellerpilot_private.smartstore_create_final_completions
  enable row level security;
revoke all on table sellerpilot_private.smartstore_create_final_completions
  from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_listing_create(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_origin_product_no text,
  p_channel_product_no text,
  p_response_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  transport sellerpilot_private.smartstore_create_final_transports%rowtype;
  existing sellerpilot_private.smartstore_create_final_completions%rowtype;
  manual_fields jsonb;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
     or not sellerpilot_private.worker_token_may_complete_gateway_job(
       p_token_hash, p_job_id, p_claim_token
     ) then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_origin_product_no, '') !~ '^[0-9]+$'
     or coalesce(p_channel_product_no, '') !~ '^[0-9]+$'
     or p_origin_product_no = p_channel_product_no
     or pg_catalog.jsonb_typeof(coalesce(p_response_payload, 'null'::jsonb))
       is distinct from 'object' then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_RECEIPT_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 910050500);
  select * into job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = p_job_id for update;
  if job.id is null
     or job.claim_token is distinct from p_claim_token
     or job.channel is distinct from 'smartstore'
     or job.operation is distinct from 'listing.create'
     or job.environment is distinct from 'production' then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_JOB_NOT_CURRENT'
      using errcode = '55000';
  end if;

  select * into transport
    from sellerpilot_private.smartstore_create_final_transports candidate
   where candidate.job_id = job.id for update;
  if transport.job_id is null then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_TRANSPORT_MISSING'
      using errcode = '55000';
  end if;

  select * into attempt
    from sellerpilot_private.channel_operation_attempts candidate
   where candidate.id = job.attempt_id for update;
  select * into listing
    from sellerpilot_private.product_listings candidate
   where candidate.id = job.listing_id for update;
  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = listing.product_id for update;
  select coalesce(ai_job.request_payload->'manual_fields', '{}'::jsonb)
    into manual_fields
    from sellerpilot_private.ai_cli_jobs ai_job
   where ai_job.id = product.ai_job_id;

  if attempt.id is null
     or attempt.owner_id is distinct from job.created_by
     or attempt.credential_id is distinct from job.credential_id
     or attempt.channel is distinct from job.channel
     or attempt.operation is distinct from job.operation
     or transport.attempt_id is distinct from attempt.id
     or transport.listing_id is distinct from listing.id
     or transport.credential_id is distinct from job.credential_id
     or transport.owner_id is distinct from job.created_by
     or transport.product_id is distinct from product.id
     or listing.owner_id is distinct from job.created_by
     or listing.channel_key is distinct from job.channel
     or listing.operation_attempt_id is distinct from attempt.id
     or product.owner_id is distinct from job.created_by
     or listing.id is null
     or product.id is null
     or product.status is distinct from 'ready'
     or product.demo
     or transport.body_json#>>'{originProduct,name}'
       is distinct from pg_catalog.btrim(product.name)
     or (transport.body_json#>>'{originProduct,salePrice}')::numeric
       is distinct from (manual_fields->>'sellingPrice')::numeric
     or (transport.body_json#>>'{originProduct,stockQuantity}')::integer
       is distinct from product.on_hand
     or p_response_payload#>>'{originProduct,name}'
       is distinct from transport.body_json#>>'{originProduct,name}'
     or (p_response_payload#>>'{originProduct,salePrice}')::numeric
       is distinct from (transport.body_json#>>'{originProduct,salePrice}')::numeric
     or (p_response_payload#>>'{originProduct,stockQuantity}')::integer
       is distinct from (transport.body_json#>>'{originProduct,stockQuantity}')::integer then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_SOURCE_MISMATCH'
      using errcode = '55000';
  end if;

  select * into existing
    from sellerpilot_private.smartstore_create_final_completions completion
   where completion.job_id = job.id for update;
  if existing.job_id is not null then
    if existing.origin_product_no is distinct from p_origin_product_no
       or existing.channel_product_no is distinct from p_channel_product_no
       or existing.body_sha256 is distinct from transport.body_sha256
       or existing.body_binding_sha256 is distinct from transport.body_binding_sha256 then
      raise exception 'SMARTSTORE_CREATE_COMPLETION_REPLAY_MISMATCH'
        using errcode = '23505';
    end if;
  else
    if job.status is distinct from 'running'
       or job.completed_at is not null
       or attempt.status is distinct from 'running'
       or listing.status not in ('draft', 'queued')
       or listing.remote_id is not null then
      raise exception 'SMARTSTORE_CREATE_COMPLETION_JOB_NOT_CURRENT'
        using errcode = '55000';
    end if;
    insert into sellerpilot_private.smartstore_create_final_completions(
      job_id, attempt_id, listing_id, origin_product_no, channel_product_no,
      body_sha256, body_binding_sha256
    ) values (
      job.id, attempt.id, listing.id, p_origin_product_no, p_channel_product_no,
      transport.body_sha256, transport.body_binding_sha256
    );
    update sellerpilot_private.channel_gateway_jobs
       set status = 'succeeded',
           completed_at = pg_catalog.clock_timestamp(),
           response_payload = p_response_payload
     where id = job.id;
    update sellerpilot_private.channel_operation_attempts
       set status = 'succeeded',
           remote_id = p_origin_product_no
     where id = attempt.id;
    update sellerpilot_private.product_listings
       set status = 'published',
           remote_id = p_origin_product_no
     where id = listing.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'smartstore_create_completion_v1',
    'jobId', job.id,
    'status', 'completed',
    'originProductNo', p_origin_product_no,
    'channelProductNo', p_channel_product_no,
    'bodySha256', transport.body_sha256,
    'reused', existing.job_id is not null
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_SOURCE_MISMATCH'
      using errcode = '55000';
end;
$$;

revoke all on function
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid),
  public.sellerpilot_service_stage_smartstore_create_transport(
    text,uuid,uuid,text,text,integer,text
  ),
  public.sellerpilot_complete_smartstore_listing_create(
    text,uuid,uuid,text,text,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid),
  public.sellerpilot_service_stage_smartstore_create_transport(
    text,uuid,uuid,text,text,integer,text
  ),
  public.sellerpilot_complete_smartstore_listing_create(
    text,uuid,uuid,text,text,jsonb
  ) to service_role;

comment on table sellerpilot_private.smartstore_create_final_transports is
  'Append-only SmartStore CREATE transport bytes and the exact current source and credential incarnation authorized immediately before POST /v2/products.';
comment on table sellerpilot_private.smartstore_create_final_completions is
  'One atomic SmartStore CREATE completion bound to the staged UTF-8 body and official origin/channel numbers.';
comment on function public.sellerpilot_service_stage_smartstore_create_transport(
  text,uuid,uuid,text,text,integer,text
) is
  'Stages one exact SmartStore CREATE JSON body after media upload and fails closed on product, manual input, listing, claim, credential Vault incarnation, commercial, option, category, shipping, or return drift.';
comment on function public.sellerpilot_complete_smartstore_listing_create(
  text,uuid,uuid,text,text,jsonb
) is
  'Completes one SmartStore CREATE job only from the staged transport and matching official commercial fields. Does not use the generic gateway completion RPC.';

notify pgrst, 'reload schema';


commit;
