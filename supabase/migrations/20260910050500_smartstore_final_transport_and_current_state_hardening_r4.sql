-- Bind SmartStore CREATE to the current product, manual intake, credential
-- incarnation and the exact UTF-8 JSON bytes used by POST /v2/products.
-- This migration installs contracts only; it performs no provider call.

begin;

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
       <> 'service_role'
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
     or pg_catalog.octet_length(coalesce(p_body_text, '')) <> p_body_byte_length
     or encode(extensions.digest(p_body_text, 'sha256'), 'hex') <> p_body_sha256 then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_BYTES_INVALID'
      using errcode = '22023';
  end if;
  begin
    final_body := p_body_text::jsonb;
  exception when others then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_JSON_INVALID'
      using errcode = '22023';
  end;
  if pg_catalog.jsonb_typeof(final_body) <> 'object' then
    raise exception 'SMARTSTORE_CREATE_TRANSPORT_JSON_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 910050500);
  select * into job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = p_job_id for update;
  if job.id is null
     or job.claim_token is distinct from p_claim_token
     or job.channel <> 'smartstore'
     or job.operation <> 'listing.create'
     or job.environment <> 'production'
     or job.status <> 'running'
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
     or attempt.channel <> job.channel
     or attempt.operation <> job.operation
     or attempt.status <> 'running'
     or attempt.remote_id is not null
     or listing.id is null
     or listing.owner_id is distinct from job.created_by
     or listing.channel_key <> 'smartstore'
     or listing.operation_attempt_id is distinct from attempt.id
     or listing.status not in ('draft', 'queued')
     or listing.remote_id is not null
     or product.id is null
     or product.owner_id is distinct from job.created_by
     or product.status <> 'ready'
     or product.demo
     or credential.id is null
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or credential.last_check_status <> 'passed'
     or credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp()
     or source_binding->>'contract' <> 'smartstore_listing_create_source_v1'
     or source_binding->>'productId' <> product.id::text
     or source_binding->>'ownerId' <> product.owner_id::text
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
     or source_binding->>'credentialId' <> credential.id::text
     or (source_binding->>'credentialVersion')::integer
       is distinct from credential.version
     or source_binding->>'credentialFingerprint'
       is distinct from credential.fingerprint
     or source_binding->>'credentialVaultSecretId'
       is distinct from credential.vault_secret_id::text
     or (source_binding->>'credentialLastRotatedAt')::timestamptz
       is distinct from credential.last_rotated_at
     or source_binding->>'bodyBindingSha256' is distinct from p_body_binding_sha256
     or pg_catalog.jsonb_typeof(queued_body) <> 'object'
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
     or final_body#>>'{smartstoreChannelProduct,naverShoppingRegistration}' <> 'true'
     or final_body#>>'{originProduct,statusType}' not in ('SALE', 'SUSPENSION')
     or final_body#>>'{smartstoreChannelProduct,channelProductDisplayStatusType}'
       not in ('ON', 'SUSPENSION')
     or pg_catalog.jsonb_typeof(final_body#>'{originProduct,images}') <> 'object'
     or pg_catalog.jsonb_typeof(
       final_body#>'{originProduct,images,optionalImages}'
     ) <> 'array'
     or pg_catalog.jsonb_array_length(
       final_body#>'{originProduct,images,optionalImages}'
     ) <> 8 then
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
       <> 'service_role'
     or not sellerpilot_private.worker_token_may_complete_gateway_job(
       p_token_hash, p_job_id, p_claim_token
     ) then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if coalesce(p_origin_product_no, '') !~ '^[0-9]+$'
     or coalesce(p_channel_product_no, '') !~ '^[0-9]+$'
     or pg_catalog.jsonb_typeof(coalesce(p_response_payload, 'null'::jsonb))
       <> 'object' then
    raise exception 'SMARTSTORE_CREATE_COMPLETION_RECEIPT_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 910050500);
  select * into job
    from sellerpilot_private.channel_gateway_jobs candidate
   where candidate.id = p_job_id for update;
  if job.id is null
     or job.claim_token is distinct from p_claim_token
     or job.channel <> 'smartstore'
     or job.operation <> 'listing.create'
     or job.environment <> 'production' then
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
     or listing.id is null
     or product.id is null
     or product.status <> 'ready'
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
    if job.status <> 'running'
       or job.completed_at is not null
       or attempt.status <> 'running'
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
       set status = 'completed',
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
