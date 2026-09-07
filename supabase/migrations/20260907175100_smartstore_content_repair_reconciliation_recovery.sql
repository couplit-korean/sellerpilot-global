-- A SmartStore repair crossed the image-upload write boundary but was stopped
-- before the product PUT because the worker attempted to record the same
-- boundary twice. Preserve that uncertain repair and its consumed permit.
-- A fresh fixed-gateway official readback may prove that the product body is
-- byte-for-byte unchanged from the immutable pre-write baseline. Only that
-- proof admits one successor repair in a separate active lane.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907175100);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_content_repair_job_matches(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_content_repair_insert_allowed(sellerpilot_private.channel_gateway_jobs,jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_existing_content_repair_binding(uuid)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_remote_repair_baselines'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_permits'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_existing_content_repair_completion_receipts'
     ) is null then
    raise exception 'SMARTSTORE_REPAIR_RECONCILIATION_RECOVERY_DEPENDENCY_MISSING'
      using errcode='55000';
  end if;
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_content_repair_reconciliation_readbacks'
     ) is not null
     or pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_content_repair_no_product_effect_receipts'
     ) is not null then
    raise exception 'SMARTSTORE_REPAIR_RECONCILIATION_RECOVERY_ALREADY_EXISTS'
      using errcode='55000';
  end if;
end;
$dependencies$;

create table sellerpilot_private.smartstore_content_repair_reconciliation_readbacks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  prior_repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  prior_permit_id uuid not null unique
    references sellerpilot_private.smartstore_existing_content_repair_permits(id) on delete restrict,
  before_baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id,product_id,before_baseline_id)
);

create index smartstore_repair_reconciliation_readbacks_product_idx
  on sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
  (product_id,created_at desc,id desc);

alter table sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
  enable row level security;
revoke all on sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
  from public, anon, authenticated, service_role;

create table sellerpilot_private.smartstore_content_repair_no_product_effect_receipts (
  id uuid primary key default gen_random_uuid(),
  reconciliation_readback_id uuid not null unique
    references sellerpilot_private.smartstore_content_repair_reconciliation_readbacks(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  prior_repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  prior_permit_id uuid not null unique
    references sellerpilot_private.smartstore_existing_content_repair_permits(id) on delete restrict,
  before_baseline_id uuid not null
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  after_baseline_id uuid not null unique
    references sellerpilot_private.smartstore_existing_remote_repair_baselines(id) on delete restrict,
  origin_product_no text not null check (origin_product_no ~ '^[1-9][0-9]{5,19}$'),
  channel_product_no text not null check (channel_product_no ~ '^[1-9][0-9]{5,19}$'),
  approval_revision bigint not null check (approval_revision > 0),
  approval_content_sha256 text not null check (approval_content_sha256 ~ '^[a-f0-9]{64}$'),
  approved_manifest_digest text not null check (approved_manifest_digest ~ '^[a-f0-9]{64}$'),
  baseline_body_sha256 text not null check (baseline_body_sha256 ~ '^[a-f0-9]{64}$'),
  protected_body_sha256 text not null check (protected_body_sha256 ~ '^[a-f0-9]{64}$'),
  origin_response_sha256 text not null check (origin_response_sha256 ~ '^[a-f0-9]{64}$'),
  channel_response_sha256 text not null check (channel_response_sha256 ~ '^[a-f0-9]{64}$'),
  before_official_readback_sha256 text not null
    check (before_official_readback_sha256 ~ '^[a-f0-9]{64}$'),
  after_official_readback_sha256 text not null
    check (after_official_readback_sha256 ~ '^[a-f0-9]{64}$'),
  prior_repair_job_snapshot_sha256 text not null
    check (prior_repair_job_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  prior_permit_snapshot_sha256 text not null
    check (prior_permit_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  prior_completion_snapshot_sha256 text not null
    check (prior_completion_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  product_body_unchanged boolean not null check (product_body_unchanged),
  provider_media_upload_may_have_occurred boolean not null
    check (provider_media_upload_may_have_occurred),
  verified_at timestamptz not null default clock_timestamp()
);

create index smartstore_repair_no_product_effect_product_idx
  on sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  (product_id,verified_at desc,id desc);

alter table sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_smartstore_repair_reconciliation_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'SMARTSTORE_REPAIR_RECONCILIATION_EVIDENCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_repair_reconciliation_evidence()
  from public, anon, authenticated, service_role;

create trigger smartstore_repair_reconciliation_readbacks_immutable
before update or delete
on sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
for each row execute function
  sellerpilot_private.guard_smartstore_repair_reconciliation_evidence();

create trigger smartstore_repair_no_product_effect_receipts_immutable
before update or delete
on sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
for each row execute function
  sellerpilot_private.guard_smartstore_repair_reconciliation_evidence();

create function sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
  p_receipt_id uuid,
  p_after_baseline_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  relation sellerpilot_private.smartstore_content_repair_reconciliation_readbacks%rowtype;
  before_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  after_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  prior_job sellerpilot_private.channel_gateway_jobs%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
begin
  select * into receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  where id=p_receipt_id;
  select * into relation
  from sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
  where id=receipt.reconciliation_readback_id;
  select * into before_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=receipt.before_baseline_id;
  select * into after_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=receipt.after_baseline_id;
  select * into prior_job from sellerpilot_private.channel_gateway_jobs
  where id=receipt.prior_repair_job_id;
  select * into readback_job from sellerpilot_private.channel_gateway_jobs
  where id=receipt.readback_job_id;
  select * into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits
  where id=receipt.prior_permit_id;
  select * into completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts
  where job_id=receipt.prior_repair_job_id
    and result_status='reconciliation_required';
  return receipt.id is not null
    and (p_after_baseline_id is null or receipt.after_baseline_id=p_after_baseline_id)
    and relation.id=receipt.reconciliation_readback_id
    and relation.owner_id=receipt.owner_id
    and relation.product_id=receipt.product_id
    and relation.listing_id=receipt.listing_id
    and relation.credential_id=receipt.credential_id
    and relation.seller_account_key=receipt.seller_account_key
    and relation.prior_repair_job_id=receipt.prior_repair_job_id
    and relation.prior_permit_id=receipt.prior_permit_id
    and relation.before_baseline_id=receipt.before_baseline_id
    and relation.readback_job_id=receipt.readback_job_id
    and before_baseline.id is not null and after_baseline.id is not null
    and before_baseline.owner_id=receipt.owner_id
    and before_baseline.product_id=receipt.product_id
    and before_baseline.listing_id=receipt.listing_id
    and before_baseline.credential_id=receipt.credential_id
    and before_baseline.seller_account_key=receipt.seller_account_key
    and after_baseline.owner_id=receipt.owner_id
    and after_baseline.product_id=receipt.product_id
    and after_baseline.listing_id=receipt.listing_id
    and after_baseline.credential_id=receipt.credential_id
    and after_baseline.seller_account_key=receipt.seller_account_key
    and prior_job.id=receipt.prior_repair_job_id
    and prior_job.status='reconciliation_required'
    and prior_job.provider_mutation_started_at is not null
    and prior_job.request_payload#>>'{sellerpilotSmartstoreRepairRecoveryReceiptId}' is null
    and permit.id=receipt.prior_permit_id
    and permit.repair_job_id=prior_job.id
    and permit.baseline_id=before_baseline.id
    and permit.consumed_at is not null
    and permit.verification_job_id is null
    and completion.job_id=prior_job.id
    and completion.baseline_id=before_baseline.id
    and completion.verification_job_id is null
    and completion.readback_sha256 is null
    and readback_job.id=receipt.readback_job_id
    and readback_job.status='succeeded'
    and readback_job.operation='listing.lineage.verify'
    and readback_job.provider_mutation_started_at is null
    and readback_job.response_payload#>>'{verificationStatus}'='repair_required'
    and readback_job.response_payload#>>'{baselineId}'=after_baseline.id::text
    and before_baseline.readback_worker_token_id=after_baseline.readback_worker_token_id
    and before_baseline.source_job_id=after_baseline.source_job_id
    and before_baseline.source_attempt_id=after_baseline.source_attempt_id
    and before_baseline.approval_import_id=after_baseline.approval_import_id
    and before_baseline.approval_revision=after_baseline.approval_revision
    and before_baseline.approval_content_sha256=after_baseline.approval_content_sha256
    and before_baseline.approved_manifest_digest=after_baseline.approved_manifest_digest
    and before_baseline.origin_product_no=after_baseline.origin_product_no
    and before_baseline.channel_product_no=after_baseline.channel_product_no
    and before_baseline.baseline_body_sha256=after_baseline.baseline_body_sha256
    and before_baseline.protected_body_sha256=after_baseline.protected_body_sha256
    and before_baseline.origin_response_sha256=after_baseline.origin_response_sha256
    and before_baseline.channel_response_sha256=after_baseline.channel_response_sha256
    and before_baseline.source_detail_image_urls=after_baseline.source_detail_image_urls
    and before_baseline.remote_detail_image_urls=after_baseline.remote_detail_image_urls
    and before_baseline.approved_transport_images=after_baseline.approved_transport_images
    and before_baseline.mismatch_code=after_baseline.mismatch_code
    and after_baseline.observed_at>prior_job.provider_mutation_started_at
    and after_baseline.created_at>=completion.created_at
    and receipt.origin_product_no=after_baseline.origin_product_no
    and receipt.channel_product_no=after_baseline.channel_product_no
    and receipt.approval_revision=after_baseline.approval_revision
    and receipt.approval_content_sha256=after_baseline.approval_content_sha256
    and receipt.approved_manifest_digest=after_baseline.approved_manifest_digest
    and receipt.baseline_body_sha256=after_baseline.baseline_body_sha256
    and receipt.protected_body_sha256=after_baseline.protected_body_sha256
    and receipt.origin_response_sha256=after_baseline.origin_response_sha256
    and receipt.channel_response_sha256=after_baseline.channel_response_sha256
    and receipt.before_official_readback_sha256=before_baseline.official_readback_sha256
    and receipt.after_official_readback_sha256=after_baseline.official_readback_sha256
    and receipt.prior_repair_job_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(prior_job))
    and receipt.prior_permit_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(permit))
    and receipt.prior_completion_snapshot_sha256=
      sellerpilot_private.external_detail_hash(to_jsonb(completion))
    and receipt.product_body_unchanged
    and receipt.provider_media_upload_may_have_occurred
    and sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
      after_baseline.id
    );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(uuid,uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.try_record_smartstore_repair_no_product_effect(
  p_reconciliation_readback_id uuid,
  p_after_baseline_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_content_repair_reconciliation_readbacks%rowtype;
  before_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  after_baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  prior_job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  receipt_id uuid;
begin
  select * into relation
  from sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
  where id=p_reconciliation_readback_id for share;
  select * into before_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=relation.before_baseline_id for share;
  select * into after_baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=p_after_baseline_id for share;
  select * into prior_job from sellerpilot_private.channel_gateway_jobs
  where id=relation.prior_repair_job_id for share;
  select * into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits
  where id=relation.prior_permit_id for share;
  select * into completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts
  where job_id=relation.prior_repair_job_id
    and result_status='reconciliation_required' for share;
  if relation.id is null or before_baseline.id is null or after_baseline.id is null
     or prior_job.id is null or permit.id is null or completion.job_id is null
     or relation.readback_job_id is distinct from after_baseline.readback_job_id
     or relation.owner_id is distinct from before_baseline.owner_id
     or relation.product_id is distinct from before_baseline.product_id
     or relation.listing_id is distinct from before_baseline.listing_id
     or relation.credential_id is distinct from before_baseline.credential_id
     or relation.seller_account_key is distinct from before_baseline.seller_account_key
     or prior_job.status is distinct from 'reconciliation_required'
     or prior_job.provider_mutation_started_at is null
     or permit.repair_job_id is distinct from prior_job.id
     or permit.baseline_id is distinct from before_baseline.id
     or permit.consumed_at is null
     or permit.verification_job_id is not null
     or completion.baseline_id is distinct from before_baseline.id
     or completion.verification_job_id is not null
     or completion.readback_sha256 is not null
     or before_baseline.readback_worker_token_id is distinct from after_baseline.readback_worker_token_id
     or before_baseline.owner_id is distinct from after_baseline.owner_id
     or before_baseline.product_id is distinct from after_baseline.product_id
     or before_baseline.listing_id is distinct from after_baseline.listing_id
     or before_baseline.credential_id is distinct from after_baseline.credential_id
     or before_baseline.seller_account_key is distinct from after_baseline.seller_account_key
     or before_baseline.source_job_id is distinct from after_baseline.source_job_id
     or before_baseline.source_attempt_id is distinct from after_baseline.source_attempt_id
     or before_baseline.approval_import_id is distinct from after_baseline.approval_import_id
     or before_baseline.approval_revision is distinct from after_baseline.approval_revision
     or before_baseline.approval_content_sha256 is distinct from after_baseline.approval_content_sha256
     or before_baseline.approved_manifest_digest is distinct from after_baseline.approved_manifest_digest
     or before_baseline.origin_product_no is distinct from after_baseline.origin_product_no
     or before_baseline.channel_product_no is distinct from after_baseline.channel_product_no
     or before_baseline.baseline_body_sha256 is distinct from after_baseline.baseline_body_sha256
     or before_baseline.protected_body_sha256 is distinct from after_baseline.protected_body_sha256
     or before_baseline.origin_response_sha256 is distinct from after_baseline.origin_response_sha256
     or before_baseline.channel_response_sha256 is distinct from after_baseline.channel_response_sha256
     or before_baseline.source_detail_image_urls is distinct from after_baseline.source_detail_image_urls
     or before_baseline.remote_detail_image_urls is distinct from after_baseline.remote_detail_image_urls
     or before_baseline.approved_transport_images is distinct from after_baseline.approved_transport_images
     or before_baseline.mismatch_code is distinct from after_baseline.mismatch_code
     or after_baseline.observed_at<=prior_job.provider_mutation_started_at
     or after_baseline.created_at<completion.created_at
     or not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       after_baseline.id
     ) then
    return null;
  end if;
  insert into sellerpilot_private.smartstore_content_repair_no_product_effect_receipts (
    reconciliation_readback_id,owner_id,product_id,listing_id,credential_id,
    seller_account_key,prior_repair_job_id,prior_permit_id,before_baseline_id,
    readback_job_id,after_baseline_id,origin_product_no,channel_product_no,
    approval_revision,approval_content_sha256,approved_manifest_digest,
    baseline_body_sha256,protected_body_sha256,origin_response_sha256,
    channel_response_sha256,before_official_readback_sha256,
    after_official_readback_sha256,prior_repair_job_snapshot_sha256,
    prior_permit_snapshot_sha256,prior_completion_snapshot_sha256,
    product_body_unchanged,provider_media_upload_may_have_occurred
  ) values (
    relation.id,relation.owner_id,relation.product_id,relation.listing_id,
    relation.credential_id,relation.seller_account_key,prior_job.id,permit.id,
    before_baseline.id,relation.readback_job_id,after_baseline.id,
    after_baseline.origin_product_no,after_baseline.channel_product_no,
    after_baseline.approval_revision,after_baseline.approval_content_sha256,
    after_baseline.approved_manifest_digest,after_baseline.baseline_body_sha256,
    after_baseline.protected_body_sha256,after_baseline.origin_response_sha256,
    after_baseline.channel_response_sha256,before_baseline.official_readback_sha256,
    after_baseline.official_readback_sha256,
    sellerpilot_private.external_detail_hash(to_jsonb(prior_job)),
    sellerpilot_private.external_detail_hash(to_jsonb(permit)),
    sellerpilot_private.external_detail_hash(to_jsonb(completion)),true,true
  ) on conflict (reconciliation_readback_id) do nothing returning id into receipt_id;
  if receipt_id is null then
    select id into receipt_id
    from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
    where reconciliation_readback_id=relation.id
      and after_baseline_id=after_baseline.id;
  end if;
  if sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
       receipt_id,after_baseline.id
     ) is not true then return null; end if;
  return receipt_id;
exception when unique_violation then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.try_record_smartstore_repair_no_product_effect(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_smartstore_repair_recheck(
  p_actor uuid,p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  relation sellerpilot_private.smartstore_content_repair_reconciliation_readbacks%rowtype;
  receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  readback_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  completion sellerpilot_private.smartstore_existing_content_repair_completion_receipts%rowtype;
  marker jsonb;
  request_payload jsonb;
  readback_job_id uuid:=gen_random_uuid();
  result_status text;
  result_reason text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (select 1 from sellerpilot_private.admin_users where user_id=p_actor)
     or not exists (
       select 1 from sellerpilot_private.products
       where id=p_product_id and owner_id=p_actor and not demo and status<>'archived'
     ) then
    raise exception 'SMARTSTORE_REPAIR_RECHECK_ACCESS_DENIED' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-content-repair:'||p_product_id::text)
  );
  select candidate.* into relation
  from sellerpilot_private.smartstore_content_repair_reconciliation_readbacks candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
  order by candidate.created_at desc,candidate.id desc limit 1;
  if relation.id is not null then
    select * into readback_job from sellerpilot_private.channel_gateway_jobs
    where id=relation.readback_job_id;
    select * into receipt
    from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
    where reconciliation_readback_id=relation.id;
    result_status:=case
      when receipt.id is not null and
        sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
          receipt.id,receipt.after_baseline_id
        ) then 'verified'
      when readback_job.status in ('queued','running','reconciliation_required','failed')
        then readback_job.status
      else 'blocked' end;
    result_reason:=case result_status
      when 'verified' then 'REMOTE_PRODUCT_STATE_UNCHANGED'
      when 'queued' then 'REPAIR_RECHECK_QUEUED'
      when 'running' then 'REPAIR_RECHECK_RUNNING'
      when 'reconciliation_required' then 'REPAIR_RECHECK_RECONCILIATION_REQUIRED'
      when 'failed' then 'REPAIR_RECHECK_FAILED'
      else 'REMOTE_PRODUCT_STATE_CHANGED' end;
    return jsonb_build_object(
      'contract','smartstore_content_repair_recheck_v1','status',result_status,
      'reason',result_reason,'productId',p_product_id,
      'listingId',relation.listing_id,'priorRepairJobId',relation.prior_repair_job_id,
      'beforeBaselineId',relation.before_baseline_id,
      'readbackJobId',relation.readback_job_id,
      'afterBaselineId',receipt.after_baseline_id,'receiptId',receipt.id,'reused',true
    );
  end if;
  select candidate.* into permit
  from sellerpilot_private.smartstore_existing_content_repair_permits candidate
  join sellerpilot_private.smartstore_existing_remote_repair_baselines base
    on base.id=candidate.baseline_id
  join sellerpilot_private.channel_gateway_jobs job
    on job.id=candidate.repair_job_id
  where base.owner_id=p_actor and base.product_id=p_product_id
    and job.status='reconciliation_required'
    and job.provider_mutation_started_at is not null
    and job.request_payload#>>'{sellerpilotSmartstoreRepairRecoveryReceiptId}' is null
    and candidate.consumed_at is not null
    and candidate.verification_job_id is null
  order by job.completed_at desc nulls last,job.created_at desc,job.id desc
  limit 1 for update of job;
  select * into repair_job from sellerpilot_private.channel_gateway_jobs
  where id=permit.repair_job_id;
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=permit.baseline_id;
  select completion_receipt.* into completion
  from sellerpilot_private.smartstore_existing_content_repair_completion_receipts
    completion_receipt
  where completion_receipt.job_id=repair_job.id
    and completion_receipt.result_status='reconciliation_required';
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id;
  select * into credential from sellerpilot_private.channel_credentials
  where id=baseline.credential_id;
  if permit.id is null or repair_job.id is null or baseline.id is null
     or completion.job_id is null or source_job.id is null or credential.id is null
     or completion.baseline_id is distinct from baseline.id
     or completion.verification_job_id is not null
     or completion.readback_sha256 is not null
     or credential.created_by is distinct from source_job.created_by
     or credential.seller_account_key is distinct from baseline.seller_account_key
     or not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
       baseline.id
     ) then
    return jsonb_build_object(
      'contract','smartstore_content_repair_recheck_v1','status','blocked',
      'reason','REPAIR_RECHECK_NOT_ELIGIBLE','productId',p_product_id,
      'listingId',baseline.listing_id,'priorRepairJobId',repair_job.id,
      'beforeBaselineId',baseline.id,'readbackJobId',null,
      'afterBaselineId',null,'receiptId',null,'reused',false
    );
  end if;
  marker:=jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_job_v1',
    'ownerId',baseline.owner_id,'productId',baseline.product_id,
    'listingId',baseline.listing_id,'sourceJobId',baseline.source_job_id,
    'sourceAttemptId',baseline.source_attempt_id,'credentialId',baseline.credential_id,
    'sellerAccountKey',baseline.seller_account_key,'sellerSku',baseline.seller_sku,
    'approvalRevision',baseline.approval_revision,
    'contentSha256',baseline.approval_content_sha256,
    'manifestDigest',baseline.approved_manifest_digest
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
    readback_job_id,credential.id,null,baseline.listing_id,'smartstore',
    'listing.lineage.verify','production',request_payload,
    baseline.seller_account_key,source_job.created_by
  );
  insert into sellerpilot_private.smartstore_content_repair_reconciliation_readbacks (
    owner_id,product_id,listing_id,credential_id,seller_account_key,
    prior_repair_job_id,prior_permit_id,before_baseline_id,readback_job_id
  ) values (
    baseline.owner_id,baseline.product_id,baseline.listing_id,baseline.credential_id,
    baseline.seller_account_key,repair_job.id,permit.id,baseline.id,readback_job_id
  ) returning * into relation;
  return jsonb_build_object(
    'contract','smartstore_content_repair_recheck_v1','status','queued',
    'reason','REPAIR_RECHECK_QUEUED','productId',p_product_id,
    'listingId',baseline.listing_id,'priorRepairJobId',repair_job.id,
    'beforeBaselineId',baseline.id,'readbackJobId',readback_job_id,
    'afterBaselineId',null,'receiptId',null,'reused',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)
  to service_role;

alter function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  text,uuid,uuid,text,jsonb,text
) rename to sellerpilot_175100_complete_smartstore_readback_pre_recovery;
revoke all on function
  public.sellerpilot_175100_complete_smartstore_readback_pre_recovery(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_readback jsonb default null,p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  relation sellerpilot_private.smartstore_content_repair_reconciliation_readbacks%rowtype;
  result jsonb;
  receipt_id uuid;
begin
  select * into relation
  from sellerpilot_private.smartstore_content_repair_reconciliation_readbacks
  where readback_job_id=p_job_id;
  result:=public.sellerpilot_175100_complete_smartstore_readback_pre_recovery(
    p_token_hash,p_job_id,p_claim_token,p_status,p_readback,p_error_message
  );
  if relation.id is not null and p_status='succeeded'
     and result->>'status'='repair_required'
     and coalesce(result->>'baselineId','') ~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    receipt_id:=sellerpilot_private.try_record_smartstore_repair_no_product_effect(
      relation.id,(result->>'baselineId')::uuid
    );
  end if;
  return result;
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

create or replace function sellerpilot_private.smartstore_existing_content_repair_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_job.channel='smartstore'
    and p_job.operation='listing.update'
    and p_job.environment='production'
    and p_job.attempt_id is null
    and p_job.listing_id is not null
    and p_job.credential_id is not null
    and p_job.seller_account_key ~ '^[a-f0-9]{64}$'
    and p_job.credential_refresh_in_flight is false
    and p_job.credential_refresh_recovery_vault_id is null
    and p_job.prepared_credential_id is null
    and p_job.oauth_exchange_completed is false
    and (
      (
        p_job.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId' is null
        and sellerpilot_private.smartstore_jsonb_has_exact_keys(
          p_job.request_payload,array['arguments']
        )
      )
      or (
        p_job.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and sellerpilot_private.smartstore_jsonb_has_exact_keys(
          p_job.request_payload,
          array['arguments','sellerpilotSmartstoreRepairRecoveryReceiptId']
        )
      )
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload->'arguments',array[
        'body','imageUrls','originProductNo','publicationExpectedImageCount',
        'publicationExpectedLocale','publicationIntent',
        'sellerpilotSmartstoreExistingContentRepair'
      ]
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,body}',
      array['originProduct','smartstoreChannelProduct']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,body,originProduct}',
      array['detailContent','images','name']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,body,smartstoreChannelProduct}',
      array['channelProductName']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}',
      array[
        'approvalRevision','baselineBodySha256','baselineId','channelProductNo',
        'contentSha256','contract','credentialId','listingId','manifestDigest',
        'originProductNo','ownerId','productId','protectedBodySha256',
        'sellerAccountKey','sellerSku','sourceAttemptId','sourceJobId'
      ]
    )
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,contract}'
      ='smartstore_existing_content_repair_job_v1'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,listingId}'
      =p_job.listing_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,credentialId}'
      =p_job.credential_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerAccountKey}'
      =p_job.seller_account_key
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,ownerId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,productId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,baselineId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sourceJobId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sourceAttemptId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and length(p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerSku}')
      between 1 and 160
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerSku}'
      =trim(p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,sellerSku}')
    and p_job.request_payload#>>'{arguments,originProductNo}'
      =p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,originProductNo}'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,originProductNo}'
      ~ '^[1-9][0-9]{5,19}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,channelProductNo}'
      ~ '^[1-9][0-9]{5,19}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,approvalRevision}'
      ~ '^[1-9][0-9]*$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,contentSha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,manifestDigest}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,baselineBodySha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreExistingContentRepair,protectedBodySha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,publicationIntent}'='live'
    and p_job.request_payload#>>'{arguments,publicationExpectedLocale}'='ko-KR'
    and p_job.request_payload#>>'{arguments,publicationExpectedImageCount}'='8'
    and jsonb_typeof(p_job.request_payload#>'{arguments,imageUrls}')='array'
    and jsonb_array_length(p_job.request_payload#>'{arguments,imageUrls}')=9
    and (select count(distinct value)
      from jsonb_array_elements_text(p_job.request_payload#>'{arguments,imageUrls}') value)=9
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;


create function sellerpilot_private.smartstore_repair_recovery_successor_allowed(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  receipt_id uuid;
  receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  marker jsonb;
begin
  if p_job.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId' is null
  then return true; end if;
  receipt_id:=(p_job.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId')::uuid;
  select * into receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  where id=receipt_id;
  marker:=p_job.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}';
  return receipt.id is not null
    and receipt.after_baseline_id=(marker->>'baselineId')::uuid
    and receipt.owner_id=(marker->>'ownerId')::uuid
    and receipt.product_id=(marker->>'productId')::uuid
    and receipt.listing_id=p_job.listing_id
    and receipt.credential_id=p_job.credential_id
    and receipt.seller_account_key=p_job.seller_account_key
    and sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
      receipt.id,receipt.after_baseline_id
    )
    and not exists (
      select 1 from sellerpilot_private.channel_gateway_jobs existing
      where existing.id<>p_job.id
        and existing.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId'=
          receipt.id::text
    );
exception when others then return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_recovery_successor_allowed(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.smartstore_existing_content_repair_insert_allowed(
  p_job sellerpilot_private.channel_gateway_jobs,
  p_listing jsonb,
  p_credential_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  marker jsonb;
begin
  marker := p_job.request_payload
    #>'{arguments,sellerpilotSmartstoreExistingContentRepair}';
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=(marker->>'baselineId')::uuid;
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id;
  select * into source_attempt from sellerpilot_private.channel_operation_attempts
  where id=baseline.source_attempt_id;
  select * into listing from sellerpilot_private.product_listings
  where id=baseline.listing_id;
  select * into credential from sellerpilot_private.channel_credentials
  where id=baseline.credential_id;
  return sellerpilot_private.smartstore_existing_content_repair_job_matches(p_job)
    and p_job.status='queued' and p_job.attempt_count=0
    and p_job.worker_token_id is null and p_job.claim_token is null
    and p_job.provider_mutation_started_at is null and p_job.completed_at is null
    and baseline.id is not null and source_job.id is not null
    and source_attempt.id is not null and listing.id is not null
    and credential.id is not null
    and p_job.created_by=source_job.created_by
    and p_job.listing_id=baseline.listing_id
    and p_job.credential_id=baseline.credential_id
    and p_job.seller_account_key=baseline.seller_account_key
    and p_credential_key=baseline.seller_account_key
    and marker->>'ownerId'=baseline.owner_id::text
    and marker->>'productId'=baseline.product_id::text
    and marker->>'sourceJobId'=baseline.source_job_id::text
    and marker->>'sourceAttemptId'=baseline.source_attempt_id::text
    and marker->>'credentialId'=baseline.credential_id::text
    and marker->>'sellerAccountKey'=baseline.seller_account_key
    and marker->>'sellerSku'=baseline.seller_sku
    and marker->>'originProductNo'=baseline.origin_product_no
    and marker->>'channelProductNo'=baseline.channel_product_no
    and marker->>'approvalRevision'=baseline.approval_revision::text
    and marker->>'contentSha256'=baseline.approval_content_sha256
    and marker->>'manifestDigest'=baseline.approved_manifest_digest
    and marker->>'baselineBodySha256'=baseline.baseline_body_sha256
    and marker->>'protectedBodySha256'=baseline.protected_body_sha256
    and source_job.status='reconciliation_required'
    and source_job.attempt_id=source_attempt.id
    and source_job.listing_id=listing.id
    and source_job.credential_id=credential.id
    and source_attempt.status='manual_required'
    and source_attempt.owner_id=baseline.owner_id
    and listing.product_id=baseline.product_id
    and listing.owner_id=baseline.owner_id
    and listing.channel_key='smartstore'
    and listing.status='failed'
    and listing.failure_class='external_action'
    and listing.remote_id is null
    and listing.operation_attempt_id=source_attempt.id
    and (listing.seller_account_key is null
      or listing.seller_account_key=baseline.seller_account_key)
    and p_listing->>'id'=listing.id::text
    and p_listing->>'operation_attempt_id'=source_attempt.id::text
    and (p_listing->>'seller_account_key' is null
      or p_listing->>'seller_account_key'=baseline.seller_account_key)
    and credential.created_by=source_job.created_by
    and credential.status='active' and credential.channel='smartstore'
    and credential.environment='production'
    and credential.seller_account_key=baseline.seller_account_key
    and sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(
      baseline.id
    )
    and sellerpilot_private.smartstore_repair_recovery_successor_allowed(p_job);
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_insert_allowed(
    sellerpilot_private.channel_gateway_jobs,jsonb,text
  ) from public, anon, authenticated, service_role;


create or replace function sellerpilot_private.smartstore_existing_content_repair_binding(
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.smartstore_existing_content_repair_permits%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  marker jsonb;
begin
  select * into job from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  select * into permit from sellerpilot_private.smartstore_existing_content_repair_permits
  where repair_job_id=p_job_id;
  select * into baseline from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=permit.baseline_id;
  marker := job.request_payload#>'{arguments,sellerpilotSmartstoreExistingContentRepair}';
  if job.id is null or permit.id is null or baseline.id is null
     or sellerpilot_private.smartstore_existing_content_repair_job_matches(job) is not true
     or permit.owner_id is distinct from baseline.owner_id
     or permit.product_id is distinct from baseline.product_id
     or permit.listing_id is distinct from baseline.listing_id
     or permit.credential_id is distinct from baseline.credential_id
     or permit.seller_account_key is distinct from baseline.seller_account_key
     or permit.request_payload_sha256 is distinct from sellerpilot_private.external_detail_hash(job.request_payload)
     or permit.request_payload_bytes is distinct from octet_length(job.request_payload::text)
     or permit.release_sha is distinct from sellerpilot_private.active_serverless_runtime_release_sha()
     or marker->>'baselineId' is distinct from baseline.id::text
     or marker->>'ownerId' is distinct from baseline.owner_id::text
     or marker->>'productId' is distinct from baseline.product_id::text
     or marker->>'listingId' is distinct from baseline.listing_id::text
     or marker->>'sourceJobId' is distinct from baseline.source_job_id::text
     or marker->>'sourceAttemptId' is distinct from baseline.source_attempt_id::text
     or marker->>'credentialId' is distinct from baseline.credential_id::text
     or marker->>'sellerAccountKey' is distinct from baseline.seller_account_key
     or marker->>'sellerSku' is distinct from baseline.seller_sku
     or marker->>'originProductNo' is distinct from baseline.origin_product_no
     or marker->>'channelProductNo' is distinct from baseline.channel_product_no
     or marker->>'approvalRevision' is distinct from baseline.approval_revision::text
     or marker->>'contentSha256' is distinct from baseline.approval_content_sha256
     or marker->>'manifestDigest' is distinct from baseline.approved_manifest_digest
     or marker->>'baselineBodySha256' is distinct from baseline.baseline_body_sha256
     or marker->>'protectedBodySha256' is distinct from baseline.protected_body_sha256
     or not sellerpilot_private.smartstore_existing_remote_repair_baseline_is_current(baseline.id)
     or sellerpilot_private.smartstore_repair_recovery_successor_allowed(job) is not true
  then return null; end if;
  return jsonb_build_object(
    'contract','smartstore_existing_content_repair_binding_v1',
    'status','ready','baselineId',baseline.id,'permitId',permit.id
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_existing_content_repair_binding(uuid)
  from public, anon, authenticated, service_role;


create unique index channel_gateway_jobs_smartstore_repair_recovery_receipt_idx
  on sellerpilot_private.channel_gateway_jobs (
    (request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId')
  )
  where request_payload ? 'sellerpilotSmartstoreRepairRecoveryReceiptId';

do $active_lane_preimage$
declare
  definition text;
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into definition
  from pg_catalog.pg_index
  where indexrelid=
    'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  if definition is null
     or sellerpilot_private.external_detail_hash(to_jsonb(definition))<>
       '5edca2ea9d95d4d4e8a20607639ea2e044f454a88b2d81cd194307ee68eaf39c'
  then
    raise exception 'SMARTSTORE_REPAIR_RECOVERY_ACTIVE_LANE_PREIMAGE_DRIFT';
  end if;
end;
$active_lane_preimage$;

drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_verifier_v1'
      when sellerpilot_private.qoo10_shipping_s1_activation_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_activation_v1'
      when sellerpilot_private.qoo10_exact_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_exact_s1_verifier_v1'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.update'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,contract}'='qoo10_exact_localization_update_v2'
        then 'qoo10_exact_localization_update_v2'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.activate'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'='qoo10_s1_activation_v1'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'='1217336970'
        then 'qoo10_exact_s1_activation_v1'
      when channel='temu' and operation='listing.stop'
       and request_payload#>>'{arguments,sellerpilotTemuContainment,version}'='temu_safe_test_containment_v1'
        then 'temu_safe_test_containment_v1'
      when channel='temu' and operation='listing.publication.verify'
       and request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'='temu_safe_test_containment_discovery_v1'
       and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
        then 'temu_safe_test_containment_discovery_v1'
      when sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
        channel_gateway_jobs
      ) then 'smartstore_manual_adoption_readback_v1'
      when sellerpilot_private.smartstore_existing_content_repair_job_matches(
        channel_gateway_jobs
      ) and request_payload ? 'sellerpilotSmartstoreRepairRecoveryReceiptId'
        then 'smartstore_existing_content_repair_recovery_v1'
      when sellerpilot_private.smartstore_existing_content_repair_job_matches(
        channel_gateway_jobs
      ) then 'smartstore_existing_content_repair_v1'
      when channel='smartstore' and operation='listing.update'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contract}'='smartstore_manual_adoption_verified_v1'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,status}'='verified'
        then 'smartstore_manual_adoption_normal_update_v1'
      else 'default'
    end)
  )
  where listing_id is not null
    and operation in (
      'listing.create','listing.update','listing.stop','listing.activate',
      'price.update','inventory.update',
      'listing.lineage.verify','listing.publication.verify'
    )
    and status in ('queued','running','reconciliation_required');

create function sellerpilot_private.enqueue_smartstore_content_repair_recovery_successor(
  p_actor uuid,p_product_id uuid,p_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
  baseline sellerpilot_private.smartstore_existing_remote_repair_baselines%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  existing_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_job_id uuid:=gen_random_uuid();
  release_sha text;
  source_arguments jsonb;
  marker jsonb;
  repair_arguments jsonb;
  request_payload jsonb;
begin
  select * into receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  where id=p_receipt_id for share;
  select * into baseline
  from sellerpilot_private.smartstore_existing_remote_repair_baselines
  where id=receipt.after_baseline_id for share;
  select existing.* into existing_job
  from sellerpilot_private.channel_gateway_jobs existing
  where existing.request_payload->>'sellerpilotSmartstoreRepairRecoveryReceiptId'=
    receipt.id::text;
  if existing_job.id is not null then
    return public.sellerpilot_service_get_smartstore_content_repair_status(
      p_actor,p_product_id
    );
  end if;
  select * into source_job from sellerpilot_private.channel_gateway_jobs
  where id=baseline.source_job_id for share;
  select * into credential from sellerpilot_private.channel_credentials
  where id=baseline.credential_id for share;
  release_sha:=sellerpilot_private.active_serverless_runtime_release_sha();
  source_arguments:=source_job.request_payload->'arguments';
  if receipt.id is null or baseline.id is null or source_job.id is null
     or credential.id is null or receipt.owner_id is distinct from p_actor
     or receipt.product_id is distinct from p_product_id
     or release_sha !~ '^[a-f0-9]{40}$'
     or sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
       receipt.id,baseline.id
     ) is not true
     or credential.created_by is distinct from source_job.created_by
     or credential.seller_account_key is distinct from baseline.seller_account_key
     or jsonb_typeof(source_arguments#>'{body,originProduct,images}') is distinct from 'object'
     or coalesce(source_arguments#>>'{body,originProduct,name}','')=''
     or coalesce(source_arguments#>>'{body,originProduct,detailContent}','')=''
     or coalesce(source_arguments#>>'{body,smartstoreChannelProduct,channelProductName}','')=''
     or jsonb_typeof(source_arguments->'imageUrls') is distinct from 'array'
     or jsonb_array_length(source_arguments->'imageUrls') is distinct from 9 then
    raise exception 'SMARTSTORE_REPAIR_RECOVERY_SUCCESSOR_NOT_ALLOWED';
  end if;
  marker:=jsonb_build_object(
    'contract','smartstore_existing_content_repair_job_v1',
    'ownerId',baseline.owner_id,'baselineId',baseline.id,
    'productId',baseline.product_id,'listingId',baseline.listing_id,
    'sourceJobId',baseline.source_job_id,'sourceAttemptId',baseline.source_attempt_id,
    'credentialId',baseline.credential_id,'sellerAccountKey',baseline.seller_account_key,
    'sellerSku',baseline.seller_sku,'originProductNo',baseline.origin_product_no,
    'channelProductNo',baseline.channel_product_no,
    'approvalRevision',baseline.approval_revision,
    'contentSha256',baseline.approval_content_sha256,
    'manifestDigest',baseline.approved_manifest_digest,
    'baselineBodySha256',baseline.baseline_body_sha256,
    'protectedBodySha256',baseline.protected_body_sha256
  );
  repair_arguments:=jsonb_build_object(
    'originProductNo',baseline.origin_product_no,
    'publicationIntent','live','publicationExpectedLocale','ko-KR',
    'publicationExpectedImageCount',8,'imageUrls',source_arguments->'imageUrls',
    'sellerpilotSmartstoreExistingContentRepair',marker,
    'body',jsonb_build_object(
      'originProduct',jsonb_build_object(
        'name',source_arguments#>'{body,originProduct,name}',
        'detailContent',source_arguments#>'{body,originProduct,detailContent}',
        'images',source_arguments#>'{body,originProduct,images}'
      ),
      'smartstoreChannelProduct',jsonb_build_object(
        'channelProductName',source_arguments#>'{body,smartstoreChannelProduct,channelProductName}'
      )
    )
  );
  request_payload:=jsonb_build_object(
    'arguments',repair_arguments,
    'sellerpilotSmartstoreRepairRecoveryReceiptId',receipt.id
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,request_fingerprint,seller_account_key,created_by
  ) values (
    repair_job_id,credential.id,null,baseline.listing_id,'smartstore',
    'listing.update','production',request_payload,
    sellerpilot_private.external_detail_hash(repair_arguments),
    baseline.seller_account_key,source_job.created_by
  );
  insert into sellerpilot_private.smartstore_existing_content_repair_permits (
    baseline_id,repair_job_id,owner_id,product_id,listing_id,credential_id,
    seller_account_key,release_sha,request_payload_sha256,request_payload_bytes
  ) values (
    baseline.id,repair_job_id,baseline.owner_id,baseline.product_id,
    baseline.listing_id,baseline.credential_id,baseline.seller_account_key,
    release_sha,sellerpilot_private.external_detail_hash(request_payload),
    octet_length(request_payload::text)
  );
  if sellerpilot_private.smartstore_existing_content_repair_binding(repair_job_id)
       #>>'{status}' is distinct from 'ready' then
    raise exception 'SMARTSTORE_REPAIR_RECOVERY_SUCCESSOR_BINDING_FAILED';
  end if;
  return jsonb_build_object(
    'contract','smartstore_existing_content_repair_enqueue_v1',
    'status','queued','reason','CONTENT_REPAIR_QUEUED',
    'jobId',repair_job_id,'verificationJobId',null,'baselineId',baseline.id,
    'productId',p_product_id,'listingId',baseline.listing_id,'reused',false,
    'contentVerified',false,'providerMutationPerformed',false,
    'normalUpdateEligible',false
  );
end;
$$;

revoke all on function
  sellerpilot_private.enqueue_smartstore_content_repair_recovery_successor(
    uuid,uuid,uuid
  ) from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)
  rename to sellerpilot_175100_enqueue_content_repair_pre_recovery;
revoke all on function
  public.sellerpilot_175100_enqueue_content_repair_pre_recovery(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_smartstore_content_repair(
  p_actor uuid,p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt sellerpilot_private.smartstore_content_repair_no_product_effect_receipts%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not exists (select 1 from sellerpilot_private.admin_users where user_id=p_actor)
  then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_ACCESS_DENIED'
      using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-content-repair:'||p_product_id::text)
  );
  select candidate.* into receipt
  from sellerpilot_private.smartstore_content_repair_no_product_effect_receipts candidate
  where candidate.owner_id=p_actor and candidate.product_id=p_product_id
    and sellerpilot_private.smartstore_repair_reconciliation_receipt_is_current(
      candidate.id,candidate.after_baseline_id
    )
  order by candidate.verified_at desc,candidate.id desc limit 1 for share;
  if receipt.id is not null then
    return sellerpilot_private.enqueue_smartstore_content_repair_recovery_successor(
      p_actor,p_product_id,receipt.id
    );
  end if;
  return public.sellerpilot_175100_enqueue_content_repair_pre_recovery(
    p_actor,p_product_id
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)
  to service_role;

do $verify$
declare
  index_definition text;
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into index_definition
  from pg_catalog.pg_index
  where indexrelid=
    'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  if pg_catalog.strpos(index_definition,'smartstore_existing_content_repair_recovery_v1')=0
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_smartstore_content_repair(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)'
     ) is null
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'SMARTSTORE_REPAIR_RECONCILIATION_RECOVERY_POSTCONDITION_FAILED';
  end if;
end;
$verify$;

comment on function
  public.sellerpilot_service_enqueue_smartstore_repair_recheck(uuid,uuid)
  is 'Queues one fixed-gateway read-only SmartStore recheck for an immutable consumed repair reconciliation. It never changes the prior repair job or permit and never calls a provider write.';
comment on table
  sellerpilot_private.smartstore_content_repair_no_product_effect_receipts
  is 'Immutable evidence that a fresh official readback after an uncertain repair boundary matched the full pre-write product baseline. Provider media upload may have occurred; the receipt proves only that the product body was unchanged.';

notify pgrst, 'reload schema';

commit;
