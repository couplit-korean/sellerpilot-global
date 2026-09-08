-- Replace the deleted publish-draft dependency in the exact Coupang price
-- repair lane with immutable evidence captured by the 0515 adjudication.
-- The 0530 migration is already installed and its permit table must be empty.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072053);

do $preflight$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  enqueue_definition text;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_price_repair_permits'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_local_claim_allowed(uuid,uuid,uuid,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_job_allowed_before_coupang_price_repair(uuid,uuid,uuid,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'
     ) is null then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
  if not exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'coupang_exact_price_repair_permits'
          and column_name = 'draft_id'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'coupang_exact_price_repair_permits'
          and column_name = 'draft_version'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'coupang_exact_price_repair_permits'
          and column_name = 'draft_data_sha256'
     )
     or exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'coupang_exact_price_repair_permits'
          and column_name in (
            'source_job_row_sha256','source_attempt_row_sha256',
            'verifier_job_row_sha256','listing_adjudicated_sha256'
          )
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_SCHEMA_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  if exists (
       select 1
         from sellerpilot_private.coupang_exact_price_repair_permits
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangExactPriceRepair',false)
     )
     or exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.channel = 'coupang'
          and attempt.operation = 'price.update'
          and attempt.idempotency_key =
            'exact-coupang-price-repair:25adf712-1e9a-432b-8b0d-09cf35a826c5'
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_NOT_EMPTY'
      using errcode = '55000';
  end if;
  if exists (
       select 1
         from sellerpilot_private.product_registration_drafts draft
        where draft.owner_id =
          '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and draft.kind = 'publish'
          and draft.draft_id =
            '2e868857-5868-4665-8304-978b431f7f00'::uuid
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_PUBLISH_DRAFT_REAPPEARED'
      using errcode = '55000';
  end if;

  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
   for share;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid
   for share;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
   for share;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
   for share;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = source_job.id
     and verifier_job_id = verifier.id
     and source_attempt_id = source_attempt.id
     and listing_id = listing.id
   for share;

  if source_job.status <> 'reconciliation_required'
     or source_job.operation <> 'listing.create'
     or source_attempt.status <> 'manual_required'
     or source_attempt.operation <> 'listing.create'
     or verifier.status <> 'reconciliation_required'
     or verifier.operation <> 'listing.publication.verify'
     or adjudication.decision <> 'provider_live_price_drift'
     or adjudication.contract <>
       'coupang_exact_live_price_drift_adjudication_v1'
     or adjudication.provider_mutation_performed
     or adjudication.provider_call_replayed
     or not adjudication.provider_live_verified
     or adjudication.exact_content_verified
     or adjudication.buyer_visible_verified
     or encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
       <> adjudication.source_job_sha256
     or encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
       <> adjudication.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
       <> adjudication.verifier_job_sha256
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256
     or encode(extensions.digest(
       adjudication.adjudication_evidence::text,'sha256'
     ),'hex') <> adjudication.adjudication_sha256
     or (source_job.request_payload#>>
       '{arguments,body,items,0,salePrice}')::integer <> 3190
     or listing.currency <> 'KRW'
     or listing.price <> 3190 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_EVIDENCE_DRIFT'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  if pg_catalog.strpos(enqueue_definition,
       'draft sellerpilot_private.product_registration_drafts%rowtype') = 0
     or pg_catalog.strpos(enqueue_definition,
       'select * into strict draft') = 0
     or pg_catalog.strpos(enqueue_definition,
       $$'draftId',draft.draft_id$$) = 0
     or pg_catalog.strpos(enqueue_definition,
       'draft_id,draft_version,draft_data_sha256') = 0 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_FUNCTION_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

alter table sellerpilot_private.coupang_exact_price_repair_permits
  add column source_job_row_sha256 text not null check (
    source_job_row_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add column source_attempt_row_sha256 text not null check (
    source_attempt_row_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add column verifier_job_row_sha256 text not null check (
    verifier_job_row_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add column listing_adjudicated_sha256 text not null check (
    listing_adjudicated_sha256 ~ '^[a-f0-9]{64}$'
  );

create or replace function
sellerpilot_private.coupang_exact_price_repair_job_matches(
  job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select job.listing_id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    and job.credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
    and job.attempt_id is not null
    and job.channel = 'coupang'
    and job.operation = 'price.update'
    and job.environment = 'production'
    and job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
    and job.seller_account_key =
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
    and job.write_resource_kind = 'listing_mutation'
    and job.write_resource_key = encode(extensions.digest(
      convert_to('coupang','UTF8') || decode('00','hex')
        || convert_to('listing_mutation','UTF8') || decode('00','hex')
        || convert_to('fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4','UTF8'),
      'sha256'
    ), 'hex')
    and job.request_fingerprint ~ '^[a-f0-9]{64}$'
    and job.request_payload->>'periodicKey' =
      'coupang-exact-price-repair:v1:25adf712-1e9a-432b-8b0d-09cf35a826c5'
    and job.request_payload#>>'{arguments,vendorItemId}' = '96027942778'
    and job.request_payload#>>'{arguments,sellerProductId}' = '16375780938'
    and job.request_payload#>'{arguments,price}' = '3190'::jsonb
    and job.request_payload#>'{arguments,forceSalePriceUpdate}' = 'true'::jsonb
    and job.request_payload#>>'{arguments,currency}' = 'KRW'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,contract}' =
      'coupang_exact_price_repair_v1'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceJobId}' =
      '25adf712-1e9a-432b-8b0d-09cf35a826c5'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceAttemptId}' =
      'd771421b-f408-4f75-addd-03879393fab8'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,verifierJobId}' =
      '86d2cb63-d382-4cc9-8153-654cf7ccec80'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,productId}' =
      '1ed4acfc-7603-48ec-a638-241131e59358'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceRequestFingerprint}' =
      'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,workerTokenId}' =
      '02955cb4-fa9f-466b-824f-b61f06276190'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,egressIpSha256}' =
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,releaseSha}'
      ~ '^[a-f0-9]{40}$'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceJobRowSha256}'
      ~ '^[a-f0-9]{64}$'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceAttemptRowSha256}'
      ~ '^[a-f0-9]{64}$'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,verifierJobRowSha256}'
      ~ '^[a-f0-9]{64}$'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,listingAdjudicatedSha256}'
      ~ '^[a-f0-9]{64}$'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,adjudicationSha256}'
      ~ '^[a-f0-9]{64}$'
$$;

create or replace function
sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_price_repair_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.repair_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.repair_attempt_id
      join sellerpilot_private.channel_gateway_jobs source_job
        on source_job.id = permit.source_job_id
      join sellerpilot_private.channel_operation_attempts source_attempt
        on source_attempt.id = permit.source_attempt_id
      join sellerpilot_private.channel_gateway_jobs verifier
        on verifier.id = permit.verifier_job_id
      join sellerpilot_private.coupang_exact_live_price_drift_adjudications adjudication
        on adjudication.source_job_id = permit.source_job_id
       and adjudication.source_attempt_id = permit.source_attempt_id
       and adjudication.verifier_job_id = permit.verifier_job_id
       and adjudication.listing_id = permit.listing_id
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
      join sellerpilot_private.products product
        on product.id = permit.product_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
      join sellerpilot_private.local_channel_executor_routes route
        on route.id = permit.source_route_id
      join sellerpilot_private.ai_cli_worker_tokens worker
        on worker.id = permit.worker_token_id
     where permit.repair_job_id = p_job_id
       and permit.expires_at > clock_timestamp()
       and sellerpilot_private.coupang_exact_price_repair_job_matches(job)
       and encode(extensions.digest(job.request_payload::text,'sha256'),'hex')
         = permit.request_payload_sha256
       and octet_length(job.request_payload::text) = permit.request_payload_bytes
       and job.attempt_id = attempt.id
       and job.credential_id = credential.id
       and job.listing_id = listing.id
       and job.seller_account_key = permit.seller_account_key
       and job.credential_refresh_in_flight is false
       and job.credential_refresh_recovery_vault_id is null
       and job.prepared_credential_id is null
       and job.oauth_exchange_completed is false
       and attempt.owner_id = permit.seller_owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.channel = 'coupang'
       and attempt.operation = 'price.update'
       and attempt.status = 'running'
       and attempt.remote_id is null
       and attempt.completed_at is null
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = permit.request_payload_sha256
       and source_job.status = 'reconciliation_required'
       and source_job.channel = 'coupang'
       and source_job.operation = 'listing.create'
       and source_job.attempt_id = source_attempt.id
       and source_job.listing_id = permit.listing_id
       and source_job.credential_id = permit.credential_id
       and source_job.request_fingerprint = permit.source_request_fingerprint
       and source_job.request_payload#>'{arguments,body,items,0,salePrice}' =
         '3190'::jsonb
       and source_attempt.status = 'manual_required'
       and source_attempt.channel = 'coupang'
       and source_attempt.operation = 'listing.create'
       and source_attempt.owner_id = permit.seller_owner_id
       and source_attempt.credential_id = permit.credential_id
       and source_attempt.remote_id = permit.seller_product_id
       and verifier.status = 'reconciliation_required'
       and verifier.channel = 'coupang'
       and verifier.operation = 'listing.publication.verify'
       and verifier.listing_id = permit.listing_id
       and encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
         = permit.source_job_row_sha256
       and permit.source_job_row_sha256 = adjudication.source_job_sha256
       and encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
         = permit.source_attempt_row_sha256
       and permit.source_attempt_row_sha256 = adjudication.source_attempt_sha256
       and encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
         = permit.verifier_job_row_sha256
       and permit.verifier_job_row_sha256 = adjudication.verifier_job_sha256
       and to_jsonb(listing) = adjudication.listing_after_snapshot
       and encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
         = permit.listing_adjudicated_sha256
       and permit.listing_adjudicated_sha256 = adjudication.listing_after_sha256
       and permit.adjudication_sha256 = adjudication.adjudication_sha256
       and encode(extensions.digest(
         adjudication.adjudication_evidence::text,'sha256'
       ),'hex') = permit.adjudication_sha256
       and adjudication.decision = 'provider_live_price_drift'
       and adjudication.contract =
         'coupang_exact_live_price_drift_adjudication_v1'
       and adjudication.provider_live_verified
       and not adjudication.exact_content_verified
       and not adjudication.buyer_visible_verified
       and not adjudication.provider_mutation_performed
       and not adjudication.provider_call_replayed
       and listing.owner_id = permit.seller_owner_id
       and listing.product_id = permit.product_id
       and listing.channel_key = 'coupang'
       and listing.seller_account_key = permit.seller_account_key
       and listing.remote_id = permit.seller_product_id
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.remote_visibility = 'live'
       and listing.remote_resources#>>'{resources,sellerProductId}'
         = permit.seller_product_id
       and listing.remote_resources#>'{resources,vendorItemIds}'
         = jsonb_build_array(permit.vendor_item_id)
       and listing.currency = permit.currency
       and listing.price = permit.desired_price
       and product.owner_id = permit.seller_owner_id
       and product.sku = permit.sku
       and product.on_hand = permit.observed_stock
       and not product.demo
       and product.status <> 'archived'
       and credential.created_by = permit.credential_owner_id
       and credential.channel = 'coupang'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.last_checked_at = permit.credential_last_checked_at
       and credential.last_check_status = 'passed'
       and worker.id = permit.worker_token_id
       and worker.scope = 'gateway'
       and worker.status = 'active'
       and worker.expires_at > clock_timestamp()
       and worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
       and worker.last_version = 'sellerpilot-cli-worker/1.61+'
         || permit.release_sha || '.' || left(permit.egress_ip_sha256,11)
       and route.owner_id = permit.seller_owner_id
       and route.channel = 'coupang'
       and route.operation in (
         'categories.attributes','categories.validate','listing.create'
       )
       and route.credential_id = permit.credential_id
       and route.seller_account_key = permit.seller_account_key
       and route.worker_token_id = permit.worker_token_id
       and route.release_sha = permit.release_sha
       and route.egress_ip_sha256 = permit.egress_ip_sha256
       and route.enabled
       and route.approved_at <= clock_timestamp()
       and route.expires_at > clock_timestamp()
       and sellerpilot_private.local_channel_executor_route_is_current(
         permit.seller_owner_id,route.channel,route.operation,
         permit.credential_id,permit.worker_token_id,permit.release_sha,
         permit.egress_ip_sha256,worker.last_version
       )
       and sellerpilot_private.active_serverless_runtime_release_sha()
         = permit.release_sha
       and sellerpilot_private.listing_mutation_release_gate_is_effective(
         'coupang'
       )
       and sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
         permit.source_job_id
       )
       and not exists (
         select 1
           from sellerpilot_private.coupang_exact_live_verify_receipts receipt
          where receipt.verifier_job_id = permit.verifier_job_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = permit.seller_owner_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = permit.credential_owner_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = route.approved_by
       )
  ), false)
$$;

do $patch_enqueue$
declare
  definition text;
  fragment text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict definition;

  fragment := '  draft sellerpilot_private.product_registration_drafts%rowtype;' || chr(10);
  if (length(definition)-length(replace(definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFT_DECLARATION_DRIFT';
  end if;
  definition := replace(definition,fragment,'');

  fragment := $old$  select * into strict draft
    from sellerpilot_private.product_registration_drafts
   where owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and kind = 'publish'
     and draft_id = '2e868857-5868-4665-8304-978b431f7f00'::uuid
   for share;
$old$;
  if (length(definition)-length(replace(definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFT_SELECT_DRIFT';
  end if;
  definition := replace(definition,fragment,'');

  fragment := $old$     or draft.product_id <> product.id or draft.version <> 13
     or jsonb_typeof(draft.data) <> 'object'
$old$;
  if (length(definition)-length(replace(definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFT_PREIMAGE_DRIFT';
  end if;
  definition := replace(definition,fragment,$new$     or encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
       <> adjudication.source_job_sha256
     or encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
       <> adjudication.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
       <> adjudication.verifier_job_sha256
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256
     or encode(extensions.digest(
       adjudication.adjudication_evidence::text,'sha256'
     ),'hex') <> adjudication.adjudication_sha256
$new$);

  fragment := $old$    'draftId',draft.draft_id,
    'draftVersion',draft.version,
$old$;
  if (length(definition)-length(replace(definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFT_MARKER_DRIFT';
  end if;
  definition := replace(definition,fragment,$new$    'sourceJobRowSha256',adjudication.source_job_sha256,
    'sourceAttemptRowSha256',adjudication.source_attempt_sha256,
    'verifierJobRowSha256',adjudication.verifier_job_sha256,
    'listingAdjudicatedSha256',adjudication.listing_after_sha256,
$new$);

  fragment := '    draft_id,draft_version,draft_data_sha256,credential_id,seller_owner_id,';
  if (length(definition)-length(replace(definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFT_COLUMNS_DRIFT';
  end if;
  definition := replace(definition,fragment,
    '    source_job_row_sha256,source_attempt_row_sha256,' || chr(10)
    || '    verifier_job_row_sha256,listing_adjudicated_sha256,' || chr(10)
    || '    credential_id,seller_owner_id,');

  fragment := $old$    draft.draft_id,draft.version,
    encode(extensions.digest(draft.data::text,'sha256'),'hex'),credential.id,
$old$;
  if (length(definition)-length(replace(definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFT_VALUES_DRIFT';
  end if;
  definition := replace(definition,fragment,$new$    adjudication.source_job_sha256,adjudication.source_attempt_sha256,
    adjudication.verifier_job_sha256,adjudication.listing_after_sha256,
    credential.id,
$new$);

  if pg_catalog.strpos(definition,'product_registration_drafts') > 0
     or pg_catalog.strpos(definition,'draft_id') > 0
     or pg_catalog.strpos(definition,'draft_version') > 0
     or pg_catalog.strpos(definition,'draft_data_sha256') > 0
     or pg_catalog.strpos(definition,'sourceJobRowSha256') = 0
     or pg_catalog.strpos(definition,'listingAdjudicatedSha256') = 0 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_PATCH_FAILED';
  end if;
  execute definition;
end
$patch_enqueue$;

alter table sellerpilot_private.coupang_exact_price_repair_permits
  drop column draft_id,
  drop column draft_version,
  drop column draft_data_sha256;

-- The 0530 SQL wrapper evaluated the exact repair predicate for every queued
-- local-executor candidate.  A permit PK lookup must select the exceptional
-- path before any of its snapshot joins run.
create or replace function sellerpilot_private.local_channel_executor_job_allowed(
  p_job_id uuid,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from sellerpilot_private.coupang_exact_price_repair_permits permit
     where permit.repair_job_id = p_job_id
  ) then
    return coalesce(
      sellerpilot_private.coupang_exact_price_repair_local_claim_allowed(
        p_job_id,p_credential_id,p_worker_token_id,p_worker_version,
        p_release_sha,p_egress_ip_sha256
      ),
      false
    );
  end if;
  return coalesce(
    sellerpilot_private.local_channel_executor_job_allowed_before_coupang_price_repair(
      p_job_id,p_credential_id,p_worker_token_id,p_worker_version,
      p_release_sha,p_egress_ip_sha256
    ),
    false
  );
end
$$;

revoke all on function
sellerpilot_private.local_channel_executor_job_allowed(
  uuid,uuid,uuid,text,text,text
) from public, anon, authenticated, service_role;

do $postflight$
declare
  job_definition text;
  snapshot_definition text;
  enqueue_definition text;
  local_definition text;
  local_language text;
  local_security_definer boolean;
  local_volatility "char";
  permit_probe_position integer;
  exact_probe_position integer;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
begin
  if exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'coupang_exact_price_repair_permits'
          and column_name in ('draft_id','draft_version','draft_data_sha256')
     )
     or (select count(*) from information_schema.columns
          where table_schema = 'sellerpilot_private'
            and table_name = 'coupang_exact_price_repair_permits'
            and column_name in (
              'source_job_row_sha256','source_attempt_row_sha256',
              'verifier_job_row_sha256','listing_adjudicated_sha256'
            )) <> 4
     or exists (
       select 1 from sellerpilot_private.coupang_exact_price_repair_permits
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangExactPriceRepair',false)
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_POSTFLIGHT_DATA_FAILED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  ) into strict job_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict snapshot_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into strict local_definition;
  select language.lanname,procedure.prosecdef,procedure.provolatile
    into strict local_language,local_security_definer,local_volatility
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid=procedure.prolang
   where procedure.oid =
     'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure;
  permit_probe_position := pg_catalog.strpos(
    local_definition,'where permit.repair_job_id = p_job_id'
  );
  exact_probe_position := pg_catalog.strpos(
    local_definition,'coupang_exact_price_repair_local_claim_allowed'
  );
  if pg_catalog.strpos(job_definition,'sourceJobRowSha256') = 0
     or pg_catalog.strpos(snapshot_definition,'source_job_row_sha256') = 0
     or pg_catalog.strpos(snapshot_definition,'listing_after_snapshot') = 0
     or pg_catalog.strpos(enqueue_definition,'sourceJobRowSha256') = 0
     or pg_catalog.strpos(enqueue_definition,'listingAdjudicatedSha256') = 0
     or pg_catalog.strpos(job_definition,'draftId') > 0
     or pg_catalog.strpos(snapshot_definition,'product_registration_drafts') > 0
     or pg_catalog.strpos(enqueue_definition,'product_registration_drafts') > 0
     or pg_catalog.strpos(enqueue_definition,'draft_id') > 0
     or permit_probe_position = 0
     or pg_catalog.strpos(local_definition,
       'local_channel_executor_job_allowed_before_coupang_price_repair') = 0
     or exact_probe_position = 0
     or permit_probe_position >= exact_probe_position
     or local_language <> 'plpgsql'
     or not local_security_definer
     or local_volatility <> 's' then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_POSTFLIGHT_FUNCTION_FAILED'
      using errcode = '55000';
  end if;
  if sellerpilot_private.local_channel_executor_job_allowed(
       '00000000-0000-4000-8000-000000000001'::uuid,
       '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid,
       '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
       'sellerpilot-cli-worker/draftless-fast-path-postflight',
       '0000000000000000000000000000000000000000',
       '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
     ) is distinct from
     sellerpilot_private.local_channel_executor_job_allowed_before_coupang_price_repair(
       '00000000-0000-4000-8000-000000000001'::uuid,
       '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid,
       '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
       'sellerpilot-cli-worker/draftless-fast-path-postflight',
       '0000000000000000000000000000000000000000',
       '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_FAST_PATH_FAILED'
      using errcode = '55000';
  end if;

  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid;
  if not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs source_job
        where source_job.id = adjudication.source_job_id
          and encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
            = adjudication.source_job_sha256
     )
     or not exists (
       select 1 from sellerpilot_private.channel_operation_attempts source_attempt
        where source_attempt.id = adjudication.source_attempt_id
          and encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
            = adjudication.source_attempt_sha256
     )
     or not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs verifier
        where verifier.id = adjudication.verifier_job_id
          and encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
            = adjudication.verifier_job_sha256
     )
     or not exists (
       select 1 from sellerpilot_private.product_listings listing
        where listing.id = adjudication.listing_id
          and to_jsonb(listing) = adjudication.listing_after_snapshot
          and encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
            = adjudication.listing_after_sha256
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DRAFTLESS_POSTFLIGHT_EVIDENCE_FAILED'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on table sellerpilot_private.coupang_exact_price_repair_permits is
  'One exact Coupang price-repair permit bound to the immutable 0515 source job, source attempt, verifier, and adjudicated listing evidence. Deleted publish drafts are not recreated or substituted.';

notify pgrst, 'reload schema';
commit;
