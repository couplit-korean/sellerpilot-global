-- Persist the exact Shopee Global CREATE response only after the worker has
-- verified the same Global item through the official read API. A later SG
-- listing.create job may resume local publication only from this private,
-- immutable receipt; request/browser supplied Global IDs are never consulted.

begin;

do $preimage$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(uuid,uuid)'
     ) is null then
    raise exception 'SHOPEE_SG_CREATE_RESUME_PREIMAGE_REQUIRED';
  end if;
end
$preimage$;

create table sellerpilot_private.shopee_sg_create_stage_receipts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references
    sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  merchant_id text not null check (merchant_id ~ '^[1-9][0-9]{0,31}$'),
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  seller_sku text not null check (length(seller_sku) between 1 and 160),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  approved_detail_page_version integer not null check (
    approved_detail_page_version > 0
  ),
  approved_manifest_digest text not null check (
    approved_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  prepared_payload_sha256 text not null check (
    prepared_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  stage_sequence smallint not null check (stage_sequence between 0 and 10),
  stage_name text not null check (stage_name in (
    'image-upload', 'global-item-create', 'local-publish'
  )),
  source_url text,
  source_sha256 text,
  global_item_id text,
  status text not null check (status in ('started', 'completed')),
  output_id text,
  result jsonb,
  result_sha256 text,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  unique (listing_id, stage_sequence),
  check (
    (stage_sequence between 0 and 8 and stage_name = 'image-upload'
      and source_url is not null
      and source_sha256 ~ '^[a-f0-9]{64}$'
      and global_item_id is null)
    or (stage_sequence = 9 and stage_name = 'global-item-create'
      and source_url is null and source_sha256 is null
      and (global_item_id is null
        or global_item_id ~ '^[1-9][0-9]{0,31}$'))
    or (stage_sequence = 10 and stage_name = 'local-publish'
      and source_url is null and source_sha256 is null
      and global_item_id ~ '^[1-9][0-9]{0,31}$')
  ),
  check (
    (status = 'started' and output_id is null and result is null
      and result_sha256 is null and completed_at is null)
    or (status = 'completed' and pg_catalog.btrim(output_id) <> ''
      and pg_catalog.jsonb_typeof(result) = 'object'
      and result_sha256 ~ '^[a-f0-9]{64}$'
      and completed_at is not null)
  )
);

alter table sellerpilot_private.shopee_sg_create_stage_receipts
  enable row level security;
revoke all on sellerpilot_private.shopee_sg_create_stage_receipts
  from public, anon, authenticated, service_role;

create table sellerpilot_private.shopee_sg_global_create_receipts (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null unique references
    sellerpilot_private.product_listings(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  merchant_id text not null check (merchant_id ~ '^[1-9][0-9]{0,31}$'),
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  seller_sku text not null check (length(seller_sku) between 1 and 160),
  global_item_name text not null check (length(global_item_name) between 1 and 240),
  local_item_name text not null check (length(local_item_name) between 1 and 240),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  prepared_payload_sha256 text not null check (
    prepared_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  global_item_id text not null check (global_item_id ~ '^[1-9][0-9]{0,31}$'),
  prepared_arguments jsonb not null check (
    pg_catalog.jsonb_typeof(prepared_arguments) = 'object'
    and pg_catalog.octet_length(prepared_arguments::text) <= 128000
  ),
  create_response jsonb not null check (
    pg_catalog.jsonb_typeof(create_response) = 'object'
    and pg_catalog.octet_length(create_response::text) <= 1000000
  ),
  readback_response jsonb not null check (
    pg_catalog.jsonb_typeof(readback_response) = 'object'
    and pg_catalog.octet_length(readback_response::text) <= 1000000
  ),
  create_response_sha256 text not null check (
    create_response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  readback_response_sha256 text not null check (
    readback_response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table sellerpilot_private.shopee_sg_global_create_receipts
  enable row level security;
revoke all on sellerpilot_private.shopee_sg_global_create_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.block_shopee_sg_global_create_receipt_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_IMMUTABLE';
end
$$;

create trigger shopee_sg_global_create_receipts_immutable
before update or delete on sellerpilot_private.shopee_sg_global_create_receipts
for each row execute function
  sellerpilot_private.block_shopee_sg_global_create_receipt_change();

create function sellerpilot_private.shopee_sg_create_stage_job_context_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_require_provider_started boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_merchant_id text;
  v_shop_id text;
  v_sku text;
  v_request_fingerprint text;
  v_approval_version_text text;
  v_approved_manifest_digest text;
begin
  -- The 009-r2 ledger/channel locks must precede stage/job row locks.
  if sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    raise exception 'SHOPEE_SG_STAGE_OWNERSHIP_LOST' using errcode = '40001';
  end if;

  select job.id,
         job.attempt_id,
         job.listing_id,
         job.created_by,
         job.credential_id,
         job.request_payload,
         job.provider_mutation_started_at,
         credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for update of job, credential;
  if not found or v_job.attempt_id is null or v_job.listing_id is null
     or (p_require_provider_started
       and v_job.provider_mutation_started_at is null) then
    raise exception 'SHOPEE_SG_STAGE_OWNERSHIP_LOST' using errcode = '40001';
  end if;

  v_merchant_id := coalesce(
    v_job.request_payload #>>
      '{arguments,sellerpilotShopeeSgCreateContext,merchantId}',
    v_job.request_payload #>> '{arguments,merchantId}', ''
  );
  v_shop_id := coalesce(
    v_job.request_payload #>> '{arguments,publish,shop_id}', ''
  );
  v_sku := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,body,global_item_sku}', ''
  ));
  v_request_fingerprint := pg_catalog.lower(coalesce(
    v_job.request_payload #>> '{arguments,publicationExpectedFingerprint}', ''
  ));
  v_approval_version_text := coalesce(
    v_job.request_payload #>>
      '{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}',
    ''
  );
  v_approved_manifest_digest := pg_catalog.lower(coalesce(
    v_job.request_payload #>>
      '{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}',
    ''
  ));
  if v_merchant_id !~ '^[1-9][0-9]{0,31}$'
     or v_shop_id !~ '^[1-9][0-9]{0,31}$'
     or v_sku = ''
     or v_request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_approval_version_text !~ '^[1-9][0-9]{0,8}$'
     or v_approved_manifest_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_SG_STAGE_SOURCE_INVALID';
  end if;

  return pg_catalog.jsonb_build_object(
    'jobId', v_job.id,
    'attemptId', v_job.attempt_id,
    'listingId', v_job.listing_id,
    'ownerId', v_job.created_by,
    'credentialId', v_job.credential_id,
    'credentialVersion', v_job.credential_version,
    'merchantId', v_merchant_id,
    'shopId', v_shop_id,
    'sellerSku', v_sku,
    'requestFingerprint', v_request_fingerprint,
    'approvedDetailPageVersion', v_approval_version_text::integer,
    'approvedManifestDigest', v_approved_manifest_digest,
    'providerMutationStarted', v_job.provider_mutation_started_at is not null,
    'requestPayload', v_job.request_payload
  );
end
$$;

create function public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_completed jsonb;
  v_completed_count integer;
  v_total_count integer;
  v_started jsonb;
  v_started_count integer;
begin
  v_context := sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    p_token_hash, p_job_id, p_claim_token, false
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-create-stage:' ||
      (v_context ->> 'listingId'))
  );

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where stage.status = 'completed')::integer,
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'sequence', stage.stage_sequence,
             'stage', stage.stage_name,
             'preparedPayloadSha256', stage.prepared_payload_sha256,
             'sourceUrl', stage.source_url,
             'sourceSha256', stage.source_sha256,
             'globalItemId', stage.global_item_id,
             'outputId', stage.output_id
           ) order by stage.stage_sequence
         ) filter (where stage.status = 'completed'), '[]'::jsonb)
    into v_total_count, v_completed_count, v_completed
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.owner_id = (v_context ->> 'ownerId')::uuid
     and stage.credential_id = (v_context ->> 'credentialId')::uuid
     and stage.credential_version = (v_context ->> 'credentialVersion')::integer
     and stage.merchant_id = v_context ->> 'merchantId'
     and stage.shop_id = v_context ->> 'shopId'
     and stage.seller_sku = v_context ->> 'sellerSku'
     and stage.request_fingerprint = v_context ->> 'requestFingerprint'
     and stage.approved_detail_page_version =
          (v_context ->> 'approvedDetailPageVersion')::integer
     and stage.approved_manifest_digest =
          v_context ->> 'approvedManifestDigest';
  select pg_catalog.count(*)::integer,
         pg_catalog.max(pg_catalog.jsonb_build_object(
           'sequence', stage.stage_sequence,
           'stage', stage.stage_name,
           'preparedPayloadSha256', stage.prepared_payload_sha256,
           'sourceUrl', stage.source_url,
           'sourceSha256', stage.source_sha256,
           'globalItemId', stage.global_item_id
         )::text)::jsonb
    into v_started_count, v_started
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.status = 'started';
  if v_started_count > 1
     or v_total_count <> v_completed_count + v_started_count
     or exists (
       select 1
         from sellerpilot_private.shopee_sg_create_stage_receipts stage
        where stage.listing_id = (v_context ->> 'listingId')::uuid
          and stage.status = 'completed'
          and stage.stage_sequence >= v_completed_count
     )
     or (v_started_count = 1
       and (v_started ->> 'sequence')::integer <> v_completed_count) then
    raise exception 'SHOPEE_SG_STAGE_STATE_UNCERTAIN' using errcode = '40001';
  end if;
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-stage/1',
    'status', 'ready',
    'genericProviderMutationStarted',
      (v_context ->> 'providerMutationStarted')::boolean,
    'nextSequence', v_completed_count,
    'completedStages', v_completed,
    'startedStage', v_started
  );
end
$$;

create function public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_stage_sequence integer,
  p_stage_name text,
  p_prepared_payload_sha256 text,
  p_source_url text default null,
  p_source_sha256 text default null,
  p_global_item_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_existing sellerpilot_private.shopee_sg_create_stage_receipts%rowtype;
  v_previous_count integer;
  v_expected_url text;
  v_url_sha text;
  v_global_receipt sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
begin
  if p_stage_sequence not between 0 and 10
     or p_stage_name not in ('image-upload', 'global-item-create', 'local-publish')
     or coalesce(p_prepared_payload_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_SG_STAGE_INPUT_INVALID';
  end if;
  v_context := sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    p_token_hash, p_job_id, p_claim_token, true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-create-stage:' ||
      (v_context ->> 'listingId'))
  );

  if p_stage_sequence between 0 and 8 then
    if p_stage_name <> 'image-upload'
       or coalesce(p_source_url, '') = ''
       or coalesce(p_source_sha256, '') !~ '^[a-f0-9]{64}$'
       or p_global_item_id is not null then
      raise exception 'SHOPEE_SG_IMAGE_STAGE_INPUT_INVALID';
    end if;
    v_expected_url := v_context #>> array[
      'requestPayload', 'arguments', 'imageUrls', p_stage_sequence::text
    ];
    v_url_sha := substring(
      p_source_url from '/normalized/[a-f0-9]{2}/([a-f0-9]{64})[.](jpg|jpeg|png)$'
    );
    if v_expected_url is distinct from p_source_url
       or v_url_sha is distinct from p_source_sha256 then
      raise exception 'SHOPEE_SG_IMAGE_STAGE_SOURCE_INVALID';
    end if;
  elsif p_stage_sequence = 9 then
    if p_stage_name <> 'global-item-create' or p_source_url is not null
       or p_source_sha256 is not null or p_global_item_id is not null then
      raise exception 'SHOPEE_SG_GLOBAL_STAGE_INPUT_INVALID';
    end if;
  elsif p_stage_name <> 'local-publish'
     or p_source_url is not null or p_source_sha256 is not null
     or coalesce(p_global_item_id, '') !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'SHOPEE_SG_LOCAL_STAGE_INPUT_INVALID';
  end if;

  select * into v_existing
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.stage_sequence = p_stage_sequence
   for update;
  if found then
    if v_existing.stage_name is distinct from p_stage_name
       or v_existing.credential_id is distinct from
            (v_context ->> 'credentialId')::uuid
       or v_existing.credential_version is distinct from
            (v_context ->> 'credentialVersion')::integer
       or v_existing.merchant_id is distinct from v_context ->> 'merchantId'
       or v_existing.shop_id is distinct from v_context ->> 'shopId'
       or v_existing.seller_sku is distinct from v_context ->> 'sellerSku'
       or v_existing.request_fingerprint is distinct from
            v_context ->> 'requestFingerprint'
       or v_existing.approved_detail_page_version is distinct from
            (v_context ->> 'approvedDetailPageVersion')::integer
       or v_existing.approved_manifest_digest is distinct from
            v_context ->> 'approvedManifestDigest'
       or v_existing.prepared_payload_sha256 is distinct from
            p_prepared_payload_sha256
       or coalesce(v_existing.source_url, '') is distinct from
            coalesce(p_source_url, '')
       or coalesce(v_existing.source_sha256, '') is distinct from
            coalesce(p_source_sha256, '')
       or coalesce(v_existing.global_item_id, '') is distinct from
            coalesce(p_global_item_id, '') then
      raise exception 'SHOPEE_SG_STAGE_REPLAY_MISMATCH';
    end if;
    if v_existing.status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'contract', 'sellerpilot-shopee-sg-create-stage/1',
        'status', 'completed',
        'sequence', v_existing.stage_sequence,
        'outputId', v_existing.output_id
      );
    end if;
    raise exception 'SHOPEE_SG_STAGE_STATE_UNCERTAIN' using errcode = '40001';
  end if;

  select pg_catalog.count(*)::integer into v_previous_count
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.status = 'completed'
     and stage.stage_sequence < p_stage_sequence;
  if v_previous_count <> p_stage_sequence
     or exists (
       select 1
         from sellerpilot_private.shopee_sg_create_stage_receipts stage
        where stage.listing_id = (v_context ->> 'listingId')::uuid
          and stage.stage_sequence > p_stage_sequence
     ) then
    raise exception 'SHOPEE_SG_STAGE_SEQUENCE_INVALID';
  end if;
  if p_stage_sequence > 0 and exists (
    select 1
      from sellerpilot_private.shopee_sg_create_stage_receipts stage
     where stage.listing_id = (v_context ->> 'listingId')::uuid
       and stage.stage_sequence < p_stage_sequence
       and (stage.prepared_payload_sha256 is distinct from
              p_prepared_payload_sha256
         or stage.owner_id is distinct from (v_context ->> 'ownerId')::uuid
         or stage.credential_id is distinct from
              (v_context ->> 'credentialId')::uuid
         or stage.credential_version is distinct from
              (v_context ->> 'credentialVersion')::integer
         or stage.merchant_id is distinct from v_context ->> 'merchantId'
         or stage.shop_id is distinct from v_context ->> 'shopId'
         or stage.seller_sku is distinct from v_context ->> 'sellerSku'
         or stage.request_fingerprint is distinct from
              v_context ->> 'requestFingerprint'
         or stage.approved_detail_page_version is distinct from
              (v_context ->> 'approvedDetailPageVersion')::integer
         or stage.approved_manifest_digest is distinct from
              v_context ->> 'approvedManifestDigest')
  ) then
    raise exception 'SHOPEE_SG_STAGE_PAYLOAD_DRIFT';
  end if;
  if p_stage_sequence = 10 then
    select * into v_global_receipt
      from sellerpilot_private.shopee_sg_global_create_receipts receipt
     where receipt.listing_id = (v_context ->> 'listingId')::uuid
       and receipt.credential_id = (v_context ->> 'credentialId')::uuid
       and receipt.credential_version =
            (v_context ->> 'credentialVersion')::integer
       and receipt.prepared_payload_sha256 = p_prepared_payload_sha256
       and receipt.global_item_id = p_global_item_id;
    if not found then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_GLOBAL_RECEIPT_REQUIRED';
    end if;
  end if;

  insert into sellerpilot_private.shopee_sg_create_stage_receipts (
    listing_id, source_job_id, source_attempt_id, owner_id,
    credential_id, credential_version, merchant_id, shop_id, seller_sku,
    request_fingerprint, approved_detail_page_version,
    approved_manifest_digest, prepared_payload_sha256,
    stage_sequence, stage_name, source_url, source_sha256, global_item_id,
    status
  ) values (
    (v_context ->> 'listingId')::uuid, p_job_id,
    (v_context ->> 'attemptId')::uuid, (v_context ->> 'ownerId')::uuid,
    (v_context ->> 'credentialId')::uuid,
    (v_context ->> 'credentialVersion')::integer,
    v_context ->> 'merchantId', v_context ->> 'shopId',
    v_context ->> 'sellerSku', v_context ->> 'requestFingerprint',
    (v_context ->> 'approvedDetailPageVersion')::integer,
    v_context ->> 'approvedManifestDigest',
    p_prepared_payload_sha256, p_stage_sequence, p_stage_name,
    p_source_url, p_source_sha256, p_global_item_id, 'started'
  );
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-stage/1',
    'status', 'started',
    'sequence', p_stage_sequence
  );
end
$$;

create function public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_global_item_id text,
  p_create_response jsonb,
  p_readback_response jsonb,
  p_prepared_arguments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_worker_id uuid;
  v_existing sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
  v_stage sellerpilot_private.shopee_sg_create_stage_receipts%rowtype;
  v_evidence jsonb;
  v_global_row jsonb;
  v_sku text;
  v_global_name text;
  v_local_name text;
  v_request_fingerprint text;
  v_prepared_sha text;
  v_merchant_id text;
  v_shop_id text;
begin
  if p_job_id is null or p_claim_token is null
     or coalesce(p_global_item_id, '') !~ '^[1-9][0-9]{0,31}$'
     or pg_catalog.jsonb_typeof(p_create_response) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_readback_response) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_prepared_arguments) is distinct from 'object'
     or pg_catalog.octet_length(p_create_response::text) > 1000000
     or pg_catalog.octet_length(p_readback_response::text) > 1000000
     or pg_catalog.octet_length(p_prepared_arguments::text) > 128000 then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_INPUT_INVALID';
  end if;

  select token.id into v_worker_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'gateway'
     and token.status = 'active'
     and token.expires_at > pg_catalog.clock_timestamp();
  if v_worker_id is null then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_WORKER_DENIED'
      using errcode = '42501';
  end if;

  -- Preserve the 009-r2 ledger -> channel -> job/credential lock order.
  if sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-global-create:' || p_job_id::text)
  );
  select job.id,
         job.attempt_id,
         job.listing_id,
         job.created_by,
         job.credential_id,
         job.request_payload,
         credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.worker_token_id = v_worker_id
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for update of job, credential;
  if not found or v_job.attempt_id is null or v_job.listing_id is null then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  v_sku := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,body,global_item_sku}', ''
  ));
  v_global_name := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,body,global_item_name}', ''
  ));
  v_local_name := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,publish,item,item_name}', ''
  ));
  v_request_fingerprint := pg_catalog.lower(coalesce(
    v_job.request_payload #>> '{arguments,publicationExpectedFingerprint}', ''
  ));
  v_merchant_id := coalesce(
    v_job.request_payload #>> '{arguments,sellerpilotShopeeSgCreateContext,merchantId}',
    v_job.request_payload #>> '{arguments,merchantId}',
    ''
  );
  v_shop_id := coalesce(
    v_job.request_payload #>> '{arguments,publish,shop_id}', ''
  );
  v_evidence := p_prepared_arguments #>
    '{sellerpilotShopeeSgCreatePrewriteEvidence}';
  v_prepared_sha := pg_catalog.lower(coalesce(
    v_evidence ->> 'payloadSha256', ''
  ));

  if coalesce(p_create_response #>> '{response,global_item_id}', '')
       is distinct from p_global_item_id
     or coalesce(p_create_response ->> 'error', '') <> ''
     or coalesce(p_readback_response ->> 'error', '') <> ''
     or v_sku = '' or v_global_name = '' or v_local_name = ''
     or v_request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_merchant_id !~ '^[1-9][0-9]{0,31}$'
     or v_shop_id !~ '^[1-9][0-9]{0,31}$'
     or v_evidence ->> 'contract' is distinct from
          'sellerpilot_shopee_sg_create_prewrite_v1'
     or v_prepared_sha !~ '^[a-f0-9]{64}$'
     or v_evidence #>> '{credential,credentialId}' is distinct from
          v_job.credential_id::text
     or (v_evidence #>> '{credential,credentialVersion}')::integer
          is distinct from v_job.credential_version
     or v_evidence #>> '{provider,merchantId}' is distinct from v_merchant_id
     or v_evidence #>> '{provider,shopId}' is distinct from v_shop_id
     or p_prepared_arguments #>> '{body,global_item_sku}'
          is distinct from v_sku
     or p_prepared_arguments #>> '{body,global_item_name}'
          is distinct from v_global_name
     or p_prepared_arguments #>> '{publish,item,item_name}'
          is distinct from v_local_name
     or p_prepared_arguments #>> '{publicationExpectedFingerprint}'
          is distinct from v_request_fingerprint
     or p_prepared_arguments #>
          '{sellerpilotShopeeSgCreateExecutionLineage}'
          is distinct from v_job.request_payload #>
          '{arguments,sellerpilotShopeeSgCreateExecutionLineage}' then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_BINDING_INVALID';
  end if;

  select row.value into v_global_row
    from pg_catalog.jsonb_array_elements(
      coalesce(
        p_readback_response #> '{response,global_item_list}', '[]'::jsonb
      )
    ) row(value)
   where row.value ->> 'global_item_id' = p_global_item_id
     and coalesce(
       row.value ->> 'global_item_sku', row.value ->> 'item_sku', ''
     ) = v_sku
     and coalesce(
       row.value ->> 'global_item_name', row.value ->> 'item_name', ''
     ) = v_global_name;
  if v_global_row is null or (
    select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(
        coalesce(
          p_readback_response #> '{response,global_item_list}', '[]'::jsonb
        )
      ) row(value)
     where row.value ->> 'global_item_id' = p_global_item_id
       and coalesce(
         row.value ->> 'global_item_sku', row.value ->> 'item_sku', ''
       ) = v_sku
       and coalesce(
         row.value ->> 'global_item_name', row.value ->> 'item_name', ''
       ) = v_global_name
  ) <> 1 then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_OFFICIAL_READBACK_INVALID';
  end if;

  select * into v_stage
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = v_job.listing_id
     and stage.stage_sequence = 9
   for update;
  if not found
     or ((v_stage.source_job_id is distinct from p_job_id
          or v_stage.source_attempt_id is distinct from v_job.attempt_id)
       and p_create_response ->> 'sellerpilotReconciliation' is distinct from
         'official-exact-global-readback')
     or v_stage.stage_name is distinct from 'global-item-create'
     or v_stage.status is distinct from 'started'
     or v_stage.credential_id is distinct from v_job.credential_id
     or v_stage.credential_version is distinct from v_job.credential_version
     or v_stage.merchant_id is distinct from v_merchant_id
     or v_stage.shop_id is distinct from v_shop_id
     or v_stage.seller_sku is distinct from v_sku
     or v_stage.request_fingerprint is distinct from v_request_fingerprint
     or v_stage.approved_detail_page_version is distinct from
          (v_job.request_payload #>>
            '{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}')::integer
     or v_stage.approved_manifest_digest is distinct from
          v_job.request_payload #>>
            '{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}'
     or v_stage.prepared_payload_sha256 is distinct from v_prepared_sha then
    raise exception 'SHOPEE_SG_GLOBAL_STAGE_RECEIPT_REQUIRED';
  end if;

  select * into v_existing
    from sellerpilot_private.shopee_sg_global_create_receipts receipt
   where receipt.listing_id = v_job.listing_id;
  if found then
    if v_existing.source_job_id = p_job_id
       and v_existing.credential_id = v_job.credential_id
       and v_existing.credential_version = v_job.credential_version
       and v_existing.global_item_id = p_global_item_id
       and v_existing.prepared_payload_sha256 = v_prepared_sha
       and v_existing.create_response_sha256 = pg_catalog.encode(
         extensions.digest(p_create_response::text, 'sha256'), 'hex'
       )
       and v_existing.readback_response_sha256 = pg_catalog.encode(
         extensions.digest(p_readback_response::text, 'sha256'), 'hex'
       ) then
      return pg_catalog.jsonb_build_object(
        'contract', 'sellerpilot-shopee-sg-create-resume/1',
        'status', 'replayed',
        'receiptId', v_existing.id
      );
    end if;
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_CONFLICT';
  end if;

  insert into sellerpilot_private.shopee_sg_global_create_receipts (
    source_job_id, source_attempt_id, listing_id, owner_id,
    credential_id, credential_version, merchant_id, shop_id,
    seller_sku, global_item_name, local_item_name, request_fingerprint,
    prepared_payload_sha256, global_item_id, prepared_arguments,
    create_response, readback_response,
    create_response_sha256, readback_response_sha256
  ) values (
    p_job_id, v_job.attempt_id, v_job.listing_id, v_job.created_by,
    v_job.credential_id, v_job.credential_version, v_merchant_id, v_shop_id,
    v_sku, v_global_name, v_local_name, v_request_fingerprint,
    v_prepared_sha, p_global_item_id, p_prepared_arguments,
    p_create_response, p_readback_response,
    pg_catalog.encode(extensions.digest(p_create_response::text, 'sha256'), 'hex'),
    pg_catalog.encode(extensions.digest(p_readback_response::text, 'sha256'), 'hex')
  ) returning * into v_existing;

  update sellerpilot_private.shopee_sg_create_stage_receipts stage
     set status = 'completed',
         output_id = p_global_item_id,
         global_item_id = p_global_item_id,
         result = pg_catalog.jsonb_build_object(
           'globalItemId', p_global_item_id,
           'createResponse', p_create_response,
           'readbackResponse', p_readback_response
         ),
         result_sha256 = pg_catalog.encode(extensions.digest(
           pg_catalog.jsonb_build_object(
             'globalItemId', p_global_item_id,
             'createResponse', p_create_response,
             'readbackResponse', p_readback_response
           )::text,
           'sha256'
         ), 'hex'),
         completed_at = pg_catalog.clock_timestamp()
   where stage.id = v_stage.id
     and stage.status = 'started';
  if not found then
    raise exception 'SHOPEE_SG_GLOBAL_STAGE_COMPLETION_CONFLICT';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-resume/1',
    'status', 'recorded',
    'receiptId', v_existing.id
  );
end
$$;

create function public.sellerpilot_service_read_shopee_sg_create_resume_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_receipt sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
begin
  if not exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.scope = 'gateway'
       and token.status = 'active'
       and token.expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception 'SHOPEE_SG_CREATE_RESUME_WORKER_DENIED'
      using errcode = '42501';
  end if;

  -- Preserve the 009-r2 ledger -> channel -> job/credential lock order.
  if sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    raise exception 'SHOPEE_SG_CREATE_RESUME_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  select job.id,
         job.listing_id,
         job.created_by,
         job.credential_id,
         job.request_payload,
         credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for share of job, credential;
  if not found or v_job.listing_id is null then
    raise exception 'SHOPEE_SG_CREATE_RESUME_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  select receipt.* into v_receipt
    from sellerpilot_private.shopee_sg_global_create_receipts receipt
   where receipt.listing_id = v_job.listing_id
     and receipt.owner_id = v_job.created_by
     and receipt.credential_id = v_job.credential_id
     and receipt.credential_version = v_job.credential_version
     and receipt.shop_id = v_job.request_payload #>> '{arguments,publish,shop_id}'
     and receipt.seller_sku = v_job.request_payload #>>
          '{arguments,body,global_item_sku}'
     and receipt.global_item_name = v_job.request_payload #>>
          '{arguments,body,global_item_name}'
     and receipt.local_item_name = v_job.request_payload #>>
          '{arguments,publish,item,item_name}'
     and receipt.request_fingerprint = v_job.request_payload #>>
          '{arguments,publicationExpectedFingerprint}'
     and receipt.prepared_arguments #>
          '{sellerpilotShopeeSgCreateExecutionLineage}'
          = v_job.request_payload #>
          '{arguments,sellerpilotShopeeSgCreateExecutionLineage}';
  if not found then
    return pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-sg-create-resume/1',
      'status', 'absent'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-resume/1',
    'status', 'ready',
    'receipt', pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-sg-create-resume/1',
      'sourceJobId', v_receipt.source_job_id,
      'credentialId', v_receipt.credential_id,
      'credentialVersion', v_receipt.credential_version,
      'merchantId', v_receipt.merchant_id,
      'shopId', v_receipt.shop_id,
      'requestFingerprint', v_receipt.request_fingerprint,
      'globalItemId', v_receipt.global_item_id,
      'preparedArguments', v_receipt.prepared_arguments
    )
  );
end
$$;

create function public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_stage_sequence integer,
  p_stage_name text,
  p_prepared_payload_sha256 text,
  p_source_url text default null,
  p_source_sha256 text default null,
  p_global_item_id text default null,
  p_output_id text default null,
  p_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_stage sellerpilot_private.shopee_sg_create_stage_receipts%rowtype;
  v_receipt sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
  v_published jsonb;
  v_local jsonb;
  v_result_sha text;
begin
  if p_stage_sequence not between 0 and 10
     or p_stage_name not in ('image-upload', 'local-publish')
     or coalesce(p_prepared_payload_sha256, '') !~ '^[a-f0-9]{64}$'
     or pg_catalog.btrim(coalesce(p_output_id, '')) = ''
     or pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
     or pg_catalog.octet_length(p_result::text) > 1000000 then
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_INPUT_INVALID';
  end if;
  v_context := sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    p_token_hash, p_job_id, p_claim_token, true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-create-stage:' ||
      (v_context ->> 'listingId'))
  );
  select * into v_stage
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.stage_sequence = p_stage_sequence
   for update;
  if not found
     or ((v_stage.source_job_id is distinct from p_job_id
          or v_stage.source_attempt_id is distinct from
            (v_context ->> 'attemptId')::uuid)
       and not (p_stage_name = 'local-publish'
         and p_result ->> 'sellerpilotReconciliation' =
           'official-exact-local-readback'))
     or v_stage.stage_name is distinct from p_stage_name
     or v_stage.credential_id is distinct from
          (v_context ->> 'credentialId')::uuid
     or v_stage.credential_version is distinct from
          (v_context ->> 'credentialVersion')::integer
     or v_stage.merchant_id is distinct from v_context ->> 'merchantId'
     or v_stage.shop_id is distinct from v_context ->> 'shopId'
     or v_stage.seller_sku is distinct from v_context ->> 'sellerSku'
     or v_stage.request_fingerprint is distinct from
          v_context ->> 'requestFingerprint'
     or v_stage.approved_detail_page_version is distinct from
          (v_context ->> 'approvedDetailPageVersion')::integer
     or v_stage.approved_manifest_digest is distinct from
          v_context ->> 'approvedManifestDigest'
     or v_stage.prepared_payload_sha256 is distinct from
          p_prepared_payload_sha256
     or coalesce(v_stage.source_url, '') is distinct from
          coalesce(p_source_url, '')
     or coalesce(v_stage.source_sha256, '') is distinct from
          coalesce(p_source_sha256, '')
     or coalesce(v_stage.global_item_id, '') is distinct from
          coalesce(p_global_item_id, '') then
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_BINDING_INVALID';
  end if;
  v_result_sha := pg_catalog.encode(
    extensions.digest(p_result::text, 'sha256'), 'hex'
  );
  if v_stage.status = 'completed' then
    if v_stage.output_id is not distinct from p_output_id
       and v_stage.result_sha256 is not distinct from v_result_sha then
      return pg_catalog.jsonb_build_object(
        'contract', 'sellerpilot-shopee-sg-create-stage/1',
        'status', 'completed',
        'sequence', v_stage.stage_sequence,
        'outputId', v_stage.output_id
      );
    end if;
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_REPLAY_MISMATCH';
  end if;

  if p_stage_name = 'image-upload' then
    if p_stage_sequence not between 0 and 8
       or p_result ->> 'imageId' is distinct from p_output_id
       or exists (
         select 1
           from sellerpilot_private.shopee_sg_create_stage_receipts stage
          where stage.listing_id = v_stage.listing_id
            and stage.stage_name = 'image-upload'
            and stage.status = 'completed'
            and stage.output_id = p_output_id
       ) then
      raise exception 'SHOPEE_SG_IMAGE_STAGE_COMPLETION_INVALID';
    end if;
  else
    if p_stage_sequence <> 10
       or coalesce(p_global_item_id, '') !~ '^[1-9][0-9]{0,31}$'
       or coalesce(p_output_id, '') !~ '^[1-9][0-9]{0,31}$' then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_COMPLETION_INVALID';
    end if;
    select * into v_receipt
      from sellerpilot_private.shopee_sg_global_create_receipts receipt
     where receipt.listing_id = v_stage.listing_id
       and receipt.owner_id = v_stage.owner_id
       and receipt.credential_id = v_stage.credential_id
       and receipt.credential_version = v_stage.credential_version
       and receipt.prepared_payload_sha256 = p_prepared_payload_sha256
       and receipt.global_item_id = p_global_item_id;
    if not found or (
      p_result ->> 'sellerpilotReconciliation' is distinct from
        'official-exact-local-readback'
      and p_result #>> '{publishResponse,response,publish_task_id}'
        is distinct from p_result ->> 'publishTaskId'
    ) then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_GLOBAL_RECEIPT_INVALID';
    end if;
    select row.value into v_published
      from pg_catalog.jsonb_array_elements(coalesce(
        p_result #> '{publishedReadback,response,published_item}', '[]'::jsonb
      )) row(value)
     where coalesce(row.value ->> 'global_item_id', '') = p_global_item_id
       and coalesce(row.value ->> 'shop_id', '') = v_stage.shop_id
       and coalesce(row.value ->> 'item_id', '') = p_output_id;
    select row.value into v_local
      from pg_catalog.jsonb_array_elements(coalesce(
        p_result #> '{localReadback,response,item_list}', '[]'::jsonb
      )) row(value)
     where coalesce(row.value ->> 'item_id', '') = p_output_id
       and coalesce(row.value ->> 'item_sku', row.value ->> 'seller_sku', '')
            = v_stage.seller_sku
       and coalesce(row.value ->> 'item_name', '') =
            v_receipt.prepared_arguments #>> '{publish,item,item_name}'
       and coalesce(row.value ->> 'category_id', '') =
            v_receipt.prepared_arguments #>>
              '{sellerpilotProviderLocalCategoryId}';
    if v_published is null or v_local is null or (
      select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(coalesce(
          p_result #> '{publishedReadback,response,published_item}', '[]'::jsonb
        )) row(value)
       where coalesce(row.value ->> 'global_item_id', '') = p_global_item_id
         and coalesce(row.value ->> 'shop_id', '') = v_stage.shop_id
         and coalesce(row.value ->> 'item_id', '') = p_output_id
    ) <> 1 or (
      select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(coalesce(
          p_result #> '{localReadback,response,item_list}', '[]'::jsonb
        )) row(value)
       where coalesce(row.value ->> 'item_id', '') = p_output_id
    ) <> 1 then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_OFFICIAL_READBACK_INVALID';
    end if;
  end if;

  update sellerpilot_private.shopee_sg_create_stage_receipts stage
     set status = 'completed',
         output_id = p_output_id,
         result = p_result,
         result_sha256 = v_result_sha,
         completed_at = pg_catalog.clock_timestamp()
   where stage.id = v_stage.id and stage.status = 'started';
  if not found then
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_CONFLICT';
  end if;
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-stage/1',
    'status', 'completed',
    'sequence', p_stage_sequence,
    'outputId', p_output_id
  );
end
$$;

revoke all on function
  sellerpilot_private.block_shopee_sg_global_create_receipt_change()
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    text, uuid, uuid, boolean
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
    text, uuid, uuid
  ) to service_role;
revoke all on function
  public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text
  ) to service_role;
revoke all on function
  public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text, text, jsonb
  ) to service_role;
revoke all on function
  public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
    text, uuid, uuid, text, jsonb, jsonb, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
    text, uuid, uuid, text, jsonb, jsonb, jsonb
  ) to service_role;
revoke all on function
  public.sellerpilot_service_read_shopee_sg_create_resume_v1(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_read_shopee_sg_create_resume_v1(
    text, uuid, uuid
  ) to service_role;

commit;
