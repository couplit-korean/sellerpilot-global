-- Capture one fresh official SmartStore readback after an uncertain content
-- repair without replaying the provider mutation or claiming that the listing
-- is verified. The existing fixed-gateway lineage collector is reused, while
-- the raw provider bodies and decoded image evidence stay in an immutable
-- private ledger. Promotion to a verified adoption is intentionally outside
-- this migration.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907175200);

do $dependencies$
declare
  completion_definition text;
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_readback_binding(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_official_identity(jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_content_repair_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_hash(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_jsonb_has_exact_keys(jsonb,text[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_content_repair_no_product_effect_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_remote_repair_baselines'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_completion_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.gateway_completion_receipts'
     ) is null then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_DEPENDENCY_MISSING'
      using errcode='55000';
  end if;
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_uncertain_readbacks'
     ) is not null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_uncertain_readback_receipts'
     ) is not null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_repair_uncertain_readback_completions'
     ) is not null then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_ALREADY_EXISTS'
      using errcode='55000';
  end if;
  completion_definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'::regprocedure
  );
  if pg_catalog.strpos(
       completion_definition,
       'smartstore_content_repair_reconciliation_readbacks'
     ) = 0
     or pg_catalog.strpos(
       completion_definition,
       'sellerpilot_175100_complete_smartstore_readback_pre_recovery'
     ) = 0 then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_COMPLETION_PREIMAGE_DRIFT'
      using errcode='55000';
  end if;
end;
$dependencies$;

create table sellerpilot_private.smartstore_repair_uncertain_readbacks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null
    check (seller_account_key ~ '^[a-f0-9]{64}$'),
  repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  repair_permit_id uuid not null unique
    references sellerpilot_private.smartstore_existing_content_repair_permits(id)
    on delete restrict,
  repair_baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id)
    on delete restrict,
  recovery_receipt_id uuid not null unique
    references sellerpilot_private.smartstore_content_repair_no_product_effect_receipts(id)
    on delete restrict,
  repair_completion_claim_token uuid not null,
  repair_completion_worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  repair_job_snapshot_sha256 text not null
    check (repair_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  repair_permit_snapshot_sha256 text not null
    check (repair_permit_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  repair_completion_snapshot_sha256 text not null
    check (repair_completion_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  recovery_receipt_snapshot_sha256 text not null
    check (recovery_receipt_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  repair_baseline_snapshot_sha256 text not null
    check (repair_baseline_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id,product_id,repair_baseline_id)
);

create index smartstore_repair_uncertain_readbacks_product_idx
  on sellerpilot_private.smartstore_repair_uncertain_readbacks
  (product_id,created_at desc,id desc);

alter table sellerpilot_private.smartstore_repair_uncertain_readbacks
  enable row level security;
revoke all on sellerpilot_private.smartstore_repair_uncertain_readbacks
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_repair_uncertain_readback_receipts (
  id uuid primary key default gen_random_uuid(),
  relation_id uuid not null unique
    references sellerpilot_private.smartstore_repair_uncertain_readbacks(id)
    on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null
    check (seller_account_key ~ '^[a-f0-9]{64}$'),
  repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  repair_permit_id uuid not null unique
    references sellerpilot_private.smartstore_existing_content_repair_permits(id)
    on delete restrict,
  repair_baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id)
    on delete restrict,
  recovery_receipt_id uuid not null unique
    references sellerpilot_private.smartstore_content_repair_no_product_effect_receipts(id)
    on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_claim_token uuid not null,
  readback_worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  completion_fingerprint text not null
    check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  official_readback jsonb not null check (
    jsonb_typeof(official_readback)='object'
    and octet_length(official_readback::text)<=2097152
  ),
  official_readback_sha256 text not null
    check (official_readback_sha256 ~ '^[a-f0-9]{64}$'),
  search_response_sha256 text not null
    check (search_response_sha256 ~ '^[a-f0-9]{64}$'),
  origin_response_sha256 text not null
    check (origin_response_sha256 ~ '^[a-f0-9]{64}$'),
  channel_response_sha256 text not null
    check (channel_response_sha256 ~ '^[a-f0-9]{64}$'),
  detail_image_urls jsonb not null check (
    jsonb_typeof(detail_image_urls)='array'
    and jsonb_array_length(detail_image_urls)=8
  ),
  detail_image_pixel_sha256s jsonb not null check (
    jsonb_typeof(detail_image_pixel_sha256s)='array'
    and jsonb_array_length(detail_image_pixel_sha256s)=8
  ),
  origin_product_no text not null
    check (origin_product_no ~ '^[1-9][0-9]{5,19}$'),
  channel_product_no text not null
    check (channel_product_no ~ '^[1-9][0-9]{5,19}$'),
  observed_at timestamptz not null,
  readback_provider_mutation_performed boolean not null
    check (not readback_provider_mutation_performed),
  repair_mutation_outcome text not null
    check (repair_mutation_outcome='unknown'),
  content_verified boolean not null check (not content_verified),
  normal_update_eligible boolean not null check (not normal_update_eligible),
  captured_at timestamptz not null default clock_timestamp()
);

create index smartstore_repair_uncertain_receipts_product_idx
  on sellerpilot_private.smartstore_repair_uncertain_readback_receipts
  (product_id,captured_at desc,id desc);

alter table sellerpilot_private.smartstore_repair_uncertain_readback_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_repair_uncertain_readback_receipts
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_repair_uncertain_readback_completions (
  job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  relation_id uuid not null
    references sellerpilot_private.smartstore_repair_uncertain_readbacks(id)
    on delete restrict,
  completion_fingerprint text not null
    check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  result_status text not null
    check (result_status in ('captured','reconciliation_required')),
  readback_sha256 text not null
    check (readback_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_receipt_id uuid
    references sellerpilot_private.smartstore_repair_uncertain_readback_receipts(id)
    on delete restrict,
  reason text not null check (length(reason) between 1 and 160),
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id,claim_token),
  check (
    (result_status='captured' and evidence_receipt_id is not null)
    or (result_status='reconciliation_required' and evidence_receipt_id is null)
  )
);

alter table sellerpilot_private.smartstore_repair_uncertain_readback_completions
  enable row level security;
revoke all on sellerpilot_private.smartstore_repair_uncertain_readback_completions
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_repair_uncertain_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SMARTSTORE_REPAIR_UNCERTAIN_READBACK_EVIDENCE_IMMUTABLE'
    using errcode='55000';
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_repair_uncertain_evidence()
  from public, anon, authenticated, service_role;

create trigger smartstore_repair_uncertain_readbacks_immutable
before update or delete
on sellerpilot_private.smartstore_repair_uncertain_readbacks
for each row execute function
  sellerpilot_private.guard_smartstore_repair_uncertain_evidence();

create trigger smartstore_repair_uncertain_readback_receipts_immutable
before update or delete
on sellerpilot_private.smartstore_repair_uncertain_readback_receipts
for each row execute function
  sellerpilot_private.guard_smartstore_repair_uncertain_evidence();

create trigger smartstore_repair_uncertain_completions_immutable
before update or delete
on sellerpilot_private.smartstore_repair_uncertain_readback_completions
for each row execute function
  sellerpilot_private.guard_smartstore_repair_uncertain_evidence();

create function sellerpilot_private.smartstore_repair_uncertain_relation_is_current(
  p_relation_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  recovery_receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  repair_completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  readback_marker jsonb;
begin
  select candidate.* into relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=p_relation_id;
  select candidate.* into repair_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=relation.repair_job_id;
  select candidate.* into readback_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=relation.readback_job_id;
  select candidate.* into repair_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.id=relation.repair_permit_id;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=relation.repair_baseline_id;
  select candidate.* into recovery_receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.id=relation.recovery_receipt_id;
  select candidate.* into repair_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=relation.repair_job_id
    and candidate.claim_token=relation.repair_completion_claim_token
    and candidate.worker_token_id=relation.repair_completion_worker_token_id;
  readback_marker := readback_job.request_payload
    #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';
  return relation.id is not null
    and repair_job.id=relation.repair_job_id
    and repair_job.status='reconciliation_required'
    and repair_job.provider_mutation_started_at is not null
    and repair_job.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId'
      = relation.recovery_receipt_id::text
    and sellerpilot_private.smartstore_existing_content_repair_job_matches(repair_job)
    and repair_permit.id=relation.repair_permit_id
    and repair_permit.repair_job_id=repair_job.id
    and repair_permit.baseline_id=repair_baseline.id
    and repair_permit.consumed_at is not null
    and repair_permit.verification_job_id is null
    and repair_completion.job_id=repair_job.id
    and repair_completion.baseline_id=repair_baseline.id
    and repair_completion.result_status='reconciliation_required'
    and repair_completion.readback_sha256 is null
    and repair_completion.verification_job_id is null
    and recovery_receipt.id=relation.recovery_receipt_id
    and recovery_receipt.after_baseline_id=repair_baseline.id
    and sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
      recovery_receipt.id,repair_baseline.id
    )
    and sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
      repair_baseline.id
    )
    and relation.owner_id=repair_baseline.owner_id
    and relation.product_id=repair_baseline.product_id
    and relation.listing_id=repair_baseline.listing_id
    and relation.credential_id=repair_baseline.credential_id
    and relation.seller_account_key=repair_baseline.seller_account_key
    and relation.repair_job_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(repair_job))
    and relation.repair_permit_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(repair_permit))
    and relation.repair_completion_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(repair_completion))
    and relation.recovery_receipt_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(recovery_receipt))
    and relation.repair_baseline_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(repair_baseline))
    and readback_job.id=relation.readback_job_id
    and readback_job.listing_id=relation.listing_id
    and readback_job.credential_id=relation.credential_id
    and readback_job.seller_account_key=relation.seller_account_key
    and readback_job.provider_mutation_started_at is null
    and sellerpilot_private.smartstore_manual_adoption_readback_job_matches(readback_job)
    and readback_marker->>'ownerId'=relation.owner_id::text
    and readback_marker->>'productId'=relation.product_id::text
    and readback_marker->>'listingId'=relation.listing_id::text
    and readback_marker->>'sourceJobId'=repair_baseline.source_job_id::text
    and readback_marker->>'sourceAttemptId'=repair_baseline.source_attempt_id::text
    and readback_marker->>'credentialId'=relation.credential_id::text
    and readback_marker->>'sellerAccountKey'=relation.seller_account_key
    and readback_marker->>'sellerSku'=repair_baseline.seller_sku
    and readback_marker->>'approvalRevision'=repair_baseline.approval_revision::text
    and readback_marker->>'contentSha256'=repair_baseline.approval_content_sha256
    and readback_marker->>'manifestDigest'=repair_baseline.approved_manifest_digest
    and sellerpilot_private.smartstore_manual_adoption_readback_binding(readback_job.id)
      #>>'{status}'='ready';
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_uncertain_relation_is_current(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_uncertain_readback_identity(
  p_relation_id uuid,
  p_readback jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  readback_marker jsonb;
  search_request jsonb;
  origin_no text;
  channel_no text;
  observed timestamptz;
  image_urls jsonb;
  image_pixels jsonb;
begin
  if sellerpilot_private.smartstore_repair_uncertain_relation_is_current(
       p_relation_id
     ) is not true
     or jsonb_typeof(p_readback) is distinct from 'object'
     or octet_length(p_readback::text)>2097152
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(p_readback,array[
       'channelReadback','contract','detailImagePixelSha256s','detailImageUrls',
       'observedAt','originReadback','providerMutationPerformed','searchReadback','source'
     ])
     or p_readback->>'contract' is distinct from
       'smartstore_official_manual_adoption_readback_v1'
     or p_readback->>'source' is distinct from
       'smartstore_official_api_readback_v1'
     or p_readback->'providerMutationPerformed' is distinct from 'false'::jsonb
     or jsonb_typeof(p_readback->'searchReadback') is distinct from 'object'
     or jsonb_typeof(p_readback->'originReadback') is distinct from 'object'
     or jsonb_typeof(p_readback->'channelReadback') is distinct from 'object'
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_readback->'searchReadback',
       array['httpStatus','method','path','request','response']
     )
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_readback->'originReadback',
       array['httpStatus','method','path','request','response']
     )
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(
       p_readback->'channelReadback',
       array['httpStatus','method','path','request','response']
     )
     or p_readback#>>'{searchReadback,method}' is distinct from 'POST'
     or p_readback#>>'{searchReadback,path}' is distinct from '/v1/products/search'
     or p_readback#>'{searchReadback,httpStatus}' is distinct from '200'::jsonb
     or p_readback#>>'{originReadback,method}' is distinct from 'GET'
     or p_readback#>'{originReadback,httpStatus}' is distinct from '200'::jsonb
     or p_readback#>'{originReadback,request}' is distinct from 'null'::jsonb
     or p_readback#>>'{channelReadback,method}' is distinct from 'GET'
     or p_readback#>'{channelReadback,httpStatus}' is distinct from '200'::jsonb
     or p_readback#>'{channelReadback,request}' is distinct from 'null'::jsonb then
    return null;
  end if;
  select candidate.* into relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=p_relation_id;
  select candidate.* into repair_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=relation.repair_job_id;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=relation.repair_baseline_id;
  select candidate.request_payload
    #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}'
  into readback_marker
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=relation.readback_job_id;
  search_request:=p_readback#>'{searchReadback,request}';
  if jsonb_typeof(search_request) is distinct from 'object'
     or not sellerpilot_private.smartstore_jsonb_has_exact_keys(search_request,array[
       'orderType','page','searchKeywordType','sellerManagementCode','size'
     ])
     or search_request->>'searchKeywordType' is distinct from 'SELLER_CODE'
     or search_request->>'sellerManagementCode' is distinct from
       readback_marker->>'sellerSku'
     or search_request->'page' is distinct from '1'::jsonb
     or search_request->'size' is distinct from '50'::jsonb
     or search_request->>'orderType' is distinct from 'NO' then
    return null;
  end if;
  begin
    observed:=nullif(p_readback->>'observedAt','')::timestamptz;
  exception when others then
    return null;
  end;
  if observed is null
     or observed<=repair_job.provider_mutation_started_at
     or observed<relation.created_at
     or observed<clock_timestamp()-interval '15 minutes'
     or observed>clock_timestamp()+interval '1 minute' then
    return null;
  end if;
  begin
    select identity.origin_product_no,identity.channel_product_no
    into origin_no,channel_no
    from sellerpilot_private.smartstore_manual_adoption_official_identity(
      p_readback,readback_marker->>'sellerSku'
    ) identity;
  exception when others then
    return null;
  end;
  if origin_no is distinct from repair_baseline.origin_product_no
     or channel_no is distinct from repair_baseline.channel_product_no then
    return null;
  end if;
  image_urls:=p_readback->'detailImageUrls';
  image_pixels:=p_readback->'detailImagePixelSha256s';
  if jsonb_typeof(image_urls) is distinct from 'array'
     or jsonb_array_length(image_urls)<>8
     or exists (
       select 1 from jsonb_array_elements(image_urls) image(value)
       where jsonb_typeof(image.value) is distinct from 'string'
          or length(image.value#>>'{}') not between 1 and 4000
          or image.value#>>'{}' !~ '^https://[^[:space:]]+$'
     )
     or (select count(distinct image.value#>>'{}')
         from jsonb_array_elements(image_urls) image(value))<>8
     or jsonb_typeof(image_pixels) is distinct from 'array'
     or jsonb_array_length(image_pixels)<>8
     or exists (
       select 1 from jsonb_array_elements(image_pixels) image(value)
       where jsonb_typeof(image.value) is distinct from 'string'
          or image.value#>>'{}' !~ '^[a-f0-9]{64}$'
     )
     or (select count(distinct image.value#>>'{}')
         from jsonb_array_elements(image_pixels) image(value))<>8 then
    return null;
  end if;
  return jsonb_build_object(
    'contract','smartstore_repair_uncertain_readback_identity_v1',
    'originProductNo',origin_no,'channelProductNo',channel_no,
    'observedAt',observed,'readbackSha256',
    sellerpilot_private.external_detail_hash(p_readback),
    'searchResponseSha256',sellerpilot_private.external_detail_hash(
      p_readback#>'{searchReadback,response}'
    ),
    'originResponseSha256',sellerpilot_private.external_detail_hash(
      p_readback#>'{originReadback,response}'
    ),
    'channelResponseSha256',sellerpilot_private.external_detail_hash(
      p_readback#>'{channelReadback,response}'
    )
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_uncertain_readback_identity(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_repair_uncertain_safe_state(
  p_relation_id uuid,
  p_reused boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  evidence sellerpilot_private.smartstore_repair_uncertain_readback_receipts%rowtype;
  completion sellerpilot_private.smartstore_repair_uncertain_readback_completions%rowtype;
  result_status text;
  result_reason text;
begin
  select candidate.* into relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.id=p_relation_id;
  select candidate.* into readback_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=relation.readback_job_id;
  select candidate.* into evidence
  from sellerpilot_private.smartstore_repair_uncertain_readback_receipts candidate
  where candidate.relation_id=relation.id;
  select candidate.* into completion
  from sellerpilot_private.smartstore_repair_uncertain_readback_completions candidate
  where candidate.relation_id=relation.id
  order by candidate.created_at desc limit 1;
  result_status:=case
    when evidence.id is not null then 'captured'
    when completion.result_status='reconciliation_required'
      then 'reconciliation_required'
    when readback_job.status in (
      'queued','running','reconciliation_required','failed'
    ) then readback_job.status
    else 'blocked' end;
  result_reason:=case result_status
    when 'captured' then 'UNCERTAIN_REPAIR_READBACK_CAPTURED'
    when 'queued' then 'UNCERTAIN_REPAIR_READBACK_QUEUED'
    when 'running' then 'UNCERTAIN_REPAIR_READBACK_RUNNING'
    when 'reconciliation_required' then coalesce(
      completion.reason,'UNCERTAIN_REPAIR_READBACK_RECONCILIATION_REQUIRED'
    )
    when 'failed' then 'UNCERTAIN_REPAIR_READBACK_FAILED'
    else 'UNCERTAIN_REPAIR_READBACK_BLOCKED' end;
  return jsonb_build_object(
    'contract','smartstore_repair_result_readback_v1',
    'status',result_status,'reason',result_reason,
    'productId',relation.product_id,'listingId',relation.listing_id,
    'repairJobId',relation.repair_job_id,
    'baselineId',relation.repair_baseline_id,
    'readbackJobId',relation.readback_job_id,
    'evidenceReceiptId',evidence.id,
    'readbackSha256',evidence.official_readback_sha256,
    'originProductNo',evidence.origin_product_no,
    'channelProductNo',evidence.channel_product_no,
    'observedAt',evidence.observed_at,
    'reused',p_reused,'officialReadbackCaptured',evidence.id is not null,
    'repairMutationOutcome','unknown','contentVerified',false,
    'normalUpdateEligible',false
  );
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_uncertain_safe_state(uuid,boolean)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_smartstore_repair_result_readback(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
       where admin.user_id=p_actor
     )
     or not exists (
       select 1 from sellerpilot_private.products product
       where product.id=p_product_id and product.owner_id=p_actor
         and not product.demo and product.status<>'archived'
     ) then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_ACCESS_DENIED'
      using errcode='42501';
  end if;
  select candidate.* into relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if relation.id is null then
    return jsonb_build_object(
      'contract','smartstore_repair_result_readback_v1',
      'status','blocked','reason','UNCERTAIN_REPAIR_READBACK_NOT_FOUND',
      'productId',p_product_id,'listingId',null,'repairJobId',null,
      'baselineId',null,'readbackJobId',null,'evidenceReceiptId',null,
      'readbackSha256',null,'originProductNo',null,'channelProductNo',null,
      'observedAt',null,'reused',false,'officialReadbackCaptured',false,
      'repairMutationOutcome','unknown','contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  return sellerpilot_private.smartstore_repair_uncertain_safe_state(
    relation.id,true
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_repair_result_readback(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_smartstore_repair_result_readback(uuid,uuid)
  to service_role;

create function public.sellerpilot_service_enqueue_smartstore_repair_result_readback(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  recovery_receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  repair_completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  marker jsonb;
  request_payload jsonb;
  readback_job_id uuid:=gen_random_uuid();
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
       where admin.user_id=p_actor
     )
     or not exists (
       select 1 from sellerpilot_private.products product
       where product.id=p_product_id and product.owner_id=p_actor
         and not product.demo and product.status<>'archived'
     ) then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_ACCESS_DENIED'
      using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('smartstore-repair-result-readback:'||p_product_id::text)
  );
  select candidate.* into relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if relation.id is not null then
    return sellerpilot_private.smartstore_repair_uncertain_safe_state(
      relation.id,true
    );
  end if;

  select job.* into repair_job
  from sellerpilot_private.channel_gateway_jobs job
  join sellerpilot_private.smartstore_existing_content_repair_permits permit
    on permit.repair_job_id=job.id
  join sellerpilot_private.smartstore_existing_remote_repair_baselines baseline
    on baseline.id=permit.baseline_id
  join sellerpilot_private.smartstore_existing_content_repair_completion_receipts completion
    on completion.job_id=job.id
  join sellerpilot_private.smartstore_content_repair_no_product_effect_receipts recovery
    on recovery.id::text=
      job.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId'
  where baseline.owner_id=p_actor and baseline.product_id=p_product_id
    and sellerpilot_private.smartstore_existing_content_repair_job_matches(job)
    and job.status='reconciliation_required'
    and job.provider_mutation_started_at is not null
    and permit.consumed_at is not null
    and permit.verification_job_id is null
    and completion.result_status='reconciliation_required'
    and completion.baseline_id=baseline.id
    and completion.readback_sha256 is null
    and completion.verification_job_id is null
    and recovery.after_baseline_id=baseline.id
    and sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
      recovery.id,baseline.id
    )
  order by job.completed_at desc nulls last,job.created_at desc,job.id desc
  limit 1 for update of job;
  if repair_job.id is null then
    return jsonb_build_object(
      'contract','smartstore_repair_result_readback_v1',
      'status','blocked','reason','UNCERTAIN_REPAIR_READBACK_NOT_ELIGIBLE',
      'productId',p_product_id,'listingId',null,'repairJobId',null,
      'baselineId',null,'readbackJobId',null,'evidenceReceiptId',null,
      'readbackSha256',null,'originProductNo',null,'channelProductNo',null,
      'observedAt',null,'reused',false,'officialReadbackCaptured',false,
      'repairMutationOutcome','unknown','contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  select candidate.* into repair_permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  where candidate.repair_job_id=repair_job.id for share;
  select candidate.* into repair_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines candidate
  where candidate.id=repair_permit.baseline_id for share;
  select candidate.* into recovery_receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.id::text=repair_job.request_payload
    ->>'sellerpilotSmartstoreRepairRecoveryReceiptId' for share;
  select candidate.* into repair_completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts candidate
  where candidate.job_id=repair_job.id
    and candidate.result_status='reconciliation_required'
  order by candidate.created_at desc limit 1;
  select candidate.* into source_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=repair_baseline.source_job_id for share;
  select candidate.* into readback_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.listing_id=repair_baseline.listing_id
    and candidate.status in ('queued','running','reconciliation_required')
    and sellerpilot_private.smartstore_manual_adoption_readback_job_matches(candidate)
  order by candidate.created_at desc,candidate.id desc limit 1 for update;
  if readback_job.id is not null then
    return jsonb_build_object(
      'contract','smartstore_repair_result_readback_v1',
      'status','blocked','reason','UNCERTAIN_REPAIR_READBACK_LANE_BUSY',
      'productId',p_product_id,'listingId',repair_baseline.listing_id,
      'repairJobId',repair_job.id,'baselineId',repair_baseline.id,
      'readbackJobId',readback_job.id,'evidenceReceiptId',null,
      'readbackSha256',null,'originProductNo',null,'channelProductNo',null,
      'observedAt',null,'reused',true,'officialReadbackCaptured',false,
      'repairMutationOutcome','unknown','contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  if repair_permit.id is null or repair_baseline.id is null
     or recovery_receipt.id is null or repair_completion.job_id is null
     or source_job.id is null
     or repair_completion.claim_token is null
     or repair_completion.worker_token_id is null
     or repair_permit.baseline_id is distinct from repair_baseline.id
     or repair_permit.consumed_at is null
     or repair_permit.verification_job_id is not null
     or repair_completion.baseline_id is distinct from repair_baseline.id
     or repair_completion.readback_sha256 is not null
     or repair_completion.verification_job_id is not null
     or recovery_receipt.after_baseline_id is distinct from repair_baseline.id
     or sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
       recovery_receipt.id,repair_baseline.id
     ) is not true
     or sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       repair_baseline.id
     ) is not true then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_TUPLE_DRIFT'
      using errcode='40001';
  end if;
  marker:=jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_job_v1',
    'ownerId',repair_baseline.owner_id,
    'productId',repair_baseline.product_id,
    'listingId',repair_baseline.listing_id,
    'sourceJobId',repair_baseline.source_job_id,
    'sourceAttemptId',repair_baseline.source_attempt_id,
    'credentialId',repair_baseline.credential_id,
    'sellerAccountKey',repair_baseline.seller_account_key,
    'sellerSku',repair_baseline.seller_sku,
    'approvalRevision',repair_baseline.approval_revision,
    'contentSha256',repair_baseline.approval_content_sha256,
    'manifestDigest',repair_baseline.approved_manifest_digest
  );
  request_payload:=jsonb_build_object(
    'sellerpilotLineageVersion','provider_listing_readback_v1',
    'arguments',jsonb_build_object(
      'sellerpilotSmartstoreManualAdoptionReadback',marker
    )
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,seller_account_key,created_by
  ) values (
    readback_job_id,repair_baseline.credential_id,null,
    repair_baseline.listing_id,'smartstore','listing.lineage.verify','production',
    request_payload,repair_baseline.seller_account_key,source_job.created_by
  );
  insert into sellerpilot_private.smartstore_repair_uncertain_readbacks (
    owner_id,product_id,listing_id,credential_id,seller_account_key,
    repair_job_id,repair_permit_id,repair_baseline_id,recovery_receipt_id,
    repair_completion_claim_token,repair_completion_worker_token_id,
    repair_job_snapshot_sha256,repair_permit_snapshot_sha256,
    repair_completion_snapshot_sha256,recovery_receipt_snapshot_sha256,
    repair_baseline_snapshot_sha256,readback_job_id
  ) values (
    repair_baseline.owner_id,repair_baseline.product_id,
    repair_baseline.listing_id,repair_baseline.credential_id,
    repair_baseline.seller_account_key,repair_job.id,repair_permit.id,
    repair_baseline.id,recovery_receipt.id,repair_completion.claim_token,
    repair_completion.worker_token_id,
    sellerpilot_private.external_detail_hash(to_jsonb(repair_job)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_permit)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_completion)),
    sellerpilot_private.external_detail_hash(to_jsonb(recovery_receipt)),
    sellerpilot_private.external_detail_hash(to_jsonb(repair_baseline)),
    readback_job_id
  ) returning * into relation;
  if sellerpilot_private.smartstore_repair_uncertain_relation_is_current(
       relation.id
     ) is not true then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_BINDING_FAILED';
  end if;
  return sellerpilot_private.smartstore_repair_uncertain_safe_state(
    relation.id,false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)
  to service_role;

alter function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) rename to sellerpilot_175200_complete_smartstore_readback_pre_uncertain;

revoke all on function
  public.sellerpilot_175200_complete_smartstore_readback_pre_uncertain(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_readback jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  relation sellerpilot_private.smartstore_repair_uncertain_readbacks%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  existing_completion sellerpilot_private.smartstore_repair_uncertain_readback_completions%rowtype;
  identity_result jsonb;
  readback_sha text;
  safe_error text;
  completion_fingerprint text;
  result_status text;
  result_reason text;
  evidence_receipt_id uuid;
  safe_response jsonb;
  prior_lineage_rebind text;
begin
  if p_job_id is null or p_claim_token is null
     or p_status not in ('succeeded','failed','retryable')
     or (p_status='succeeded' and (
       jsonb_typeof(p_readback) is distinct from 'object'
       or octet_length(p_readback::text)>2097152
       or p_error_message is not null
     ))
     or (p_status<>'succeeded' and p_readback is not null) then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_COMPLETION_INVALID';
  end if;
  select candidate.* into relation
  from sellerpilot_private.smartstore_repair_uncertain_readbacks candidate
  where candidate.readback_job_id=p_job_id;
  if relation.id is null then
    return public.sellerpilot_175200_complete_smartstore_readback_pre_uncertain(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
  end if;
  select candidate.* into worker_token
  from sellerpilot_private.ai_cli_worker_tokens candidate
  where candidate.token_hash=p_token_hash and candidate.scope='gateway'
    and candidate.status='active' and candidate.expires_at>clock_timestamp();
  if worker_token.id is null then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_WORKER_DENIED'
      using errcode='42501';
  end if;
  safe_error:=case
    when p_status='succeeded' then null
    when coalesce(p_error_message,'') ~ '^[A-Z0-9_:-]{1,160}$'
      then p_error_message
    else 'SMARTSTORE_REPAIR_RESULT_READBACK_FAILED' end;
  readback_sha:=case when p_status='succeeded'
    then sellerpilot_private.external_detail_hash(p_readback) else null end;
  completion_fingerprint:=sellerpilot_private.external_detail_hash(
    jsonb_build_object(
      'status',p_status,'readbackSha256',readback_sha,'safeError',safe_error
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-adoption-job:'||p_job_id::text)
  );
  select candidate.* into existing_completion
  from sellerpilot_private.smartstore_repair_uncertain_readback_completions candidate
  where candidate.job_id=p_job_id
    and candidate.claim_token=p_claim_token
    and candidate.worker_token_id=worker_token.id;
  if existing_completion.job_id is not null then
    if existing_completion.completion_fingerprint
         is distinct from completion_fingerprint then
      return jsonb_build_object(
        'contract','smartstore_manual_adoption_readback_completion_v1',
        'status','reconciliation_required','jobId',p_job_id,
        'receiptId',null,'attestationId',null,'baselineId',null,
        'readbackSha256',existing_completion.readback_sha256,
        'reused',true,'reason','COMPLETION_REPLAY_MISMATCH'
      );
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','reconciliation_required','jobId',p_job_id,
      'receiptId',null,'attestationId',null,'baselineId',null,
      'readbackSha256',existing_completion.readback_sha256,
      'reused',true,'reason',existing_completion.reason
    );
  end if;
  if p_status<>'succeeded' then
    return public.sellerpilot_175200_complete_smartstore_readback_pre_uncertain(
      p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
    );
  end if;
  select candidate.* into readback_job
  from sellerpilot_private.channel_gateway_jobs candidate
  where candidate.id=p_job_id and candidate.status='running'
    and candidate.worker_token_id=worker_token.id
    and candidate.claim_token=p_claim_token
    and candidate.lease_expires_at>clock_timestamp()
  for update;
  if readback_job.id is null then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','lease_lost','jobId',p_job_id,
      'receiptId',null,'attestationId',null,'baselineId',null,
      'readbackSha256',null,'reused',false,'reason','CLAIM_LEASE_LOST'
    );
  end if;
  identity_result:=sellerpilot_private.smartstore_repair_uncertain_readback_identity(
    relation.id,p_readback
  );
  if identity_result is null then
    result_status:='reconciliation_required';
    result_reason:='UNCERTAIN_REPAIR_READBACK_INVALID';
    safe_response:=null;
  else
    result_status:='captured';
    result_reason:='UNCERTAIN_REPAIR_READBACK_CAPTURED';
    insert into sellerpilot_private.smartstore_repair_uncertain_readback_receipts (
      relation_id,owner_id,product_id,listing_id,credential_id,
      seller_account_key,repair_job_id,repair_permit_id,repair_baseline_id,
      recovery_receipt_id,readback_job_id,readback_claim_token,
      readback_worker_token_id,completion_fingerprint,official_readback,
      official_readback_sha256,search_response_sha256,
      origin_response_sha256,channel_response_sha256,detail_image_urls,
      detail_image_pixel_sha256s,origin_product_no,channel_product_no,
      observed_at,readback_provider_mutation_performed,
      repair_mutation_outcome,content_verified,normal_update_eligible
    ) values (
      relation.id,relation.owner_id,relation.product_id,relation.listing_id,
      relation.credential_id,relation.seller_account_key,relation.repair_job_id,
      relation.repair_permit_id,relation.repair_baseline_id,
      relation.recovery_receipt_id,readback_job.id,p_claim_token,worker_token.id,
      completion_fingerprint,p_readback,identity_result->>'readbackSha256',
      identity_result->>'searchResponseSha256',
      identity_result->>'originResponseSha256',
      identity_result->>'channelResponseSha256',p_readback->'detailImageUrls',
      p_readback->'detailImagePixelSha256s',
      identity_result->>'originProductNo',identity_result->>'channelProductNo',
      (identity_result->>'observedAt')::timestamptz,false,'unknown',false,false
    ) returning id into evidence_receipt_id;
    safe_response:=jsonb_build_object(
      'contract','smartstore_repair_result_readback_gateway_receipt_v1',
      'ok',true,'channel','smartstore','operation','listing.lineage.verify',
      'verificationStatus','evidence_captured',
      'evidenceReceiptId',evidence_receipt_id,
      'readbackSha256',identity_result->>'readbackSha256',
      'originProductNo',identity_result->>'originProductNo',
      'channelProductNo',identity_result->>'channelProductNo',
      'readbackProviderMutationPerformed',false,
      'repairMutationOutcome','unknown','contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  prior_lineage_rebind:=coalesce(current_setting(
    'sellerpilot.provider_listing_lineage_rebind',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',readback_job.id::text,true
  );
  begin
    update sellerpilot_private.channel_gateway_jobs
    set status='reconciliation_required',response_payload=safe_response,
        error_message=case when result_status='captured' then null
          else 'SMARTSTORE_REPAIR_RESULT_READBACK_INVALID' end,
        worker_token_id=null,claim_token=null,lease_expires_at=null,
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=readback_job.id and status='running'
      and worker_token_id=worker_token.id and claim_token=p_claim_token;
    if not found then
      raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_LEASE_LOST';
    end if;
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
  );
  insert into sellerpilot_private.smartstore_repair_uncertain_readback_completions (
    job_id,claim_token,worker_token_id,relation_id,completion_fingerprint,
    result_status,readback_sha256,evidence_receipt_id,reason
  ) values (
    readback_job.id,p_claim_token,worker_token.id,relation.id,
    completion_fingerprint,result_status,readback_sha,evidence_receipt_id,
    result_reason
  );
  insert into sellerpilot_private.gateway_completion_receipts (
    job_id,claim_token,worker_token_id,completion_fingerprint,
    continuation_job_id
  ) values (
    readback_job.id,p_claim_token,worker_token.id,completion_fingerprint,null
  );
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_completion_v1',
    'status','reconciliation_required','jobId',readback_job.id,
    'receiptId',null,'attestationId',null,'baselineId',null,
    'readbackSha256',readback_sha,'reused',false,'reason',result_reason
  );
end;
$$;

revoke all on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) to service_role;

do $verify$
declare
  completion_definition text;
begin
  completion_definition:=pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'::regprocedure
  );
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_175200_complete_smartstore_readback_pre_uncertain(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_repair_result_readback(uuid,uuid)'
     ) is null
     or pg_catalog.strpos(
       completion_definition,'smartstore_repair_uncertain_readbacks'
     )=0
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_get_smartstore_repair_result_readback(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'SMARTSTORE_REPAIR_RESULT_READBACK_POSTCONDITION_FAILED';
  end if;
end;
$verify$;

comment on table
  sellerpilot_private.smartstore_repair_uncertain_readback_receipts
  is 'Immutable fresh official SmartStore search and GET evidence captured after an uncertain repair. It records no adoption, content verification, update eligibility, or provider-write success claim.';
comment on function
  public.sellerpilot_service_enqueue_smartstore_repair_result_readback(uuid,uuid)
  is 'Queues one fixed-gateway official readback for an exact recovery repair that ended reconciliation_required after crossing the write boundary. It never grants or performs another provider mutation.';
comment on function
  public.sellerpilot_service_get_smartstore_repair_result_readback(uuid,uuid)
  is 'Returns only safe IDs, digests and state for an uncertain repair readback. Raw provider responses remain private and no captured state is reported as verified.';

notify pgrst, 'reload schema';

commit;
