-- Create one fresh GET-only publication verifier after the exact Coupang price
-- repair succeeded. The terminal CREATE and the retired verifier are never
-- queued, claimed, or used as this verifier's execution source.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072061);

do $preflight$
declare
  definition text;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_succeeded(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_live_asset_digest(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_live_json_array(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_product_listing_seller_lineage()'
     ) is null then
    raise exception 'COUPANG_POST_PRICE_VERIFIER_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from (values
        (
          'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure,
          'd8918fbe0051ad2a00a83df463f7dda31980a98bca14786fca7d359363e96b85'
        ),
        (
          'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'::regprocedure,
          '9c4f70b305305ef649812746c6fb1e5af0b813b3518c70960106cf5d9c3ac2e2'
        ),
        (
          'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure,
          '61979aed80b64d9a9ad8ec79945790df51d209b3d0f102d21716f38fe96e8035'
        ),
        (
          'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
          'd4d4acff0257923b7d6c74fd05a13cf4a09e5c388bb9165a3d64ba9dc9b77130'
        ),
        (
          'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure,
          'b2775958aa6083a99a10065e01033cedec63344434d80091a2c5d3cc95ef5f59'
        )
      ) expected(procedure_name, definition_sha256)
     where encode(
       extensions.digest(pg_catalog.pg_get_functiondef(expected.procedure_name), 'sha256'),
       'hex'
     ) <> expected.definition_sha256
  ) then
    raise exception 'COUPANG_POST_PRICE_VERIFIER_PREDECESSOR_DRIFT'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict definition;
  if pg_catalog.strpos(
       definition, 'sellerpilot.coupang_exact_post_price_reconcile'
     ) <> 0 then
    raise exception 'COUPANG_POST_PRICE_LISTING_GUARD_ALREADY_PATCHED'
      using errcode = '55000';
  end if;
end
$preflight$;

create table sellerpilot_private.coupang_exact_post_price_verify_runs (
  verifier_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid),
  source_attempt_id uuid not null
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict
    check (source_attempt_id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid),
  price_repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (price_repair_job_id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid),
  price_repair_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict
    check (price_repair_attempt_id = '05508966-7665-4873-a89b-89fda8ea8a25'::uuid),
  listing_id uuid not null unique
    references sellerpilot_private.product_listings(id) on delete restrict
    check (listing_id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid),
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict
    check (credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid),
  source_route_id uuid not null
    references sellerpilot_private.local_channel_executor_routes(id) on delete restrict,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  seller_product_id text not null check (seller_product_id = '16375780938'),
  vendor_item_id text not null check (vendor_item_id = '96027942778'),
  product_id text not null check (product_id = '9725220700'),
  item_id text not null check (item_id = '29102903416'),
  desired_price integer not null check (desired_price = 3190),
  currency text not null check (currency = 'KRW'),
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  egress_ip_sha256 text not null check (egress_ip_sha256 ~ '^[a-f0-9]{64}$'),
  price_repair_job_sha256 text not null
    check (price_repair_job_sha256 ~ '^[a-f0-9]{64}$'),
  price_repair_attempt_sha256 text not null
    check (price_repair_attempt_sha256 ~ '^[a-f0-9]{64}$'),
  price_repair_response_sha256 text not null
    check (price_repair_response_sha256 ~ '^[a-f0-9]{64}$'),
  source_job_sha256 text not null
    check (source_job_sha256 ~ '^[a-f0-9]{64}$'),
  source_attempt_sha256 text not null
    check (source_attempt_sha256 ~ '^[a-f0-9]{64}$'),
  source_listing_sha256 text not null
    check (source_listing_sha256 ~ '^[a-f0-9]{64}$'),
  price_repair_permit_sha256 text not null
    check (price_repair_permit_sha256 ~ '^[a-f0-9]{64}$'),
  request_payload_sha256 text not null
    check (request_payload_sha256 ~ '^[a-f0-9]{64}$'),
  contract text not null
    check (contract = 'coupang_exact_post_price_publication_v1'),
  queued_at timestamptz not null default clock_timestamp()
);

create table sellerpilot_private.coupang_exact_post_price_verify_receipts (
  verifier_job_id uuid primary key
    references sellerpilot_private.coupang_exact_post_price_verify_runs(verifier_job_id)
      on delete restrict,
  source_job_id uuid not null unique
    check (source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid),
  source_attempt_id uuid not null
    check (source_attempt_id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid),
  price_repair_job_id uuid not null unique
    check (price_repair_job_id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid),
  price_repair_attempt_id uuid not null unique
    check (price_repair_attempt_id = '05508966-7665-4873-a89b-89fda8ea8a25'::uuid),
  listing_id uuid not null unique
    check (listing_id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid),
  seller_product_id text not null check (seller_product_id = '16375780938'),
  vendor_item_id text not null check (vendor_item_id = '96027942778'),
  product_id text not null check (product_id = '9725220700'),
  item_id text not null check (item_id = '29102903416'),
  desired_price integer not null check (desired_price = 3190),
  observed_price integer not null check (observed_price = desired_price),
  observed_stock integer not null check (observed_stock = 1),
  currency text not null check (currency = 'KRW'),
  public_url text not null check (
    public_url = 'https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778'
  ),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  seller_product_verified boolean not null check (seller_product_verified),
  seller_approved boolean not null check (seller_approved),
  all_vendor_items_on_sale boolean not null check (all_vendor_items_on_sale),
  exact_eight_images_verified boolean not null check (exact_eight_images_verified),
  price_verified boolean not null check (price_verified),
  provider_live_verified boolean not null check (provider_live_verified),
  buyer_visible_verified boolean not null default false check (not buyer_visible_verified),
  provider_mutation_performed boolean not null default false
    check (not provider_mutation_performed),
  listing_after_snapshot jsonb not null,
  listing_after_sha256 text not null
    check (listing_after_sha256 ~ '^[a-f0-9]{64}$'),
  claim_attempt_count integer not null check (claim_attempt_count = 1),
  contract text not null
    check (contract = 'coupang_exact_post_price_publication_receipt_v1'),
  recorded_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.coupang_exact_post_price_verify_runs
  enable row level security;
alter table sellerpilot_private.coupang_exact_post_price_verify_receipts
  enable row level security;
revoke all on
  sellerpilot_private.coupang_exact_post_price_verify_runs,
  sellerpilot_private.coupang_exact_post_price_verify_receipts
from public, anon, authenticated, service_role;

create function sellerpilot_private.block_coupang_post_price_verify_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_POST_PRICE_VERIFIER_EVIDENCE_IMMUTABLE'
    using errcode = '55000';
end
$$;

revoke all on function
sellerpilot_private.block_coupang_post_price_verify_change()
from public, anon, authenticated, service_role;

create trigger block_coupang_post_price_verify_run_change
before update or delete
on sellerpilot_private.coupang_exact_post_price_verify_runs
for each row execute function
sellerpilot_private.block_coupang_post_price_verify_change();

create trigger block_coupang_post_price_verify_receipt_change
before update or delete
on sellerpilot_private.coupang_exact_post_price_verify_receipts
for each row execute function
sellerpilot_private.block_coupang_post_price_verify_change();

create function sellerpilot_private.coupang_exact_post_price_verifier_job_matches(
  job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select job.credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
    and job.attempt_id is null
    and job.listing_id is null
    and job.channel = 'coupang'
    and job.operation = 'listing.publication.verify'
    and job.environment = 'production'
    and job.provider_mutation_started_at is null
    and job.oauth_provider_call_started_at is null
    and job.write_resource_kind is null
    and job.write_resource_key is null
    and job.seller_account_key =
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
    and job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
    and job.request_fingerprint ~ '^[a-f0-9]{64}$'
    and job.request_payload->>'periodicKey' =
      'coupang-exact-post-price-publication:v1:36fcb808-a2f1-42b7-a6c9-264d884f25fb'
    and job.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
    and job.request_payload#>>'{arguments,remoteId}' = '16375780938'
    and job.request_payload#>>'{arguments,market}' = ''
    and job.request_payload#>>'{arguments,targetId}' = ''
    and job.request_payload#>>'{arguments,publicationIntent}' = 'live'
    and job.request_payload#>>'{arguments,publicationStateContract}' =
      'verified_remote_state_v1'
    and job.request_payload#>>'{arguments,publicationExpectedLocale}' = 'ko-KR'
    and job.request_payload#>>'{arguments,publicationExpectedFingerprint}' =
      job.request_fingerprint
    and job.request_payload#>>'{arguments,publicationExpectedImageCount}' = '8'
    and job.request_payload#>>'{arguments,publicationReviewSourceJobId}' =
      '25adf712-1e9a-432b-8b0d-09cf35a826c5'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,contract}' =
      'coupang_exact_post_price_publication_v1'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,verifierJobId}' =
      job.id::text
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,priceRepairJobId}' =
      '36fcb808-a2f1-42b7-a6c9-264d884f25fb'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,priceRepairAttemptId}' =
      '05508966-7665-4873-a89b-89fda8ea8a25'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,sellerProductId}' =
      '16375780938'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,vendorItemId}' =
      '96027942778'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,productId}' =
      '9725220700'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,itemId}' =
      '29102903416'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,desiredPrice}' = '3190'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,currency}' = 'KRW'
    and job.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,priceRepairResponseSha256}'
      ~ '^[a-f0-9]{64}$'
$$;

revoke all on function
sellerpilot_private.coupang_exact_post_price_verifier_job_matches(
  sellerpilot_private.channel_gateway_jobs
)
from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_coupang_exact_post_price_verifier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_marked boolean := false;
  new_marked boolean := false;
begin
  if tg_op <> 'INSERT' then
    old_marked := coalesce((old.request_payload#>'{arguments}')
      ? 'sellerpilotCoupangPostPriceVerification', false);
  end if;
  new_marked := coalesce((new.request_payload#>'{arguments}')
    ? 'sellerpilotCoupangPostPriceVerification', false);
  if not old_marked and not new_marked then return new; end if;
  if sellerpilot_private.coupang_exact_post_price_verifier_job_matches(new)
       is not true
     or (tg_op = 'INSERT' and current_setting(
       'sellerpilot.coupang_post_price_verifier_enqueue', true
     ) is distinct from new.id::text)
     or (tg_op = 'UPDATE' and (
       not old_marked
       or old.id is distinct from new.id
       or old.credential_id is distinct from new.credential_id
       or old.attempt_id is distinct from new.attempt_id
       or old.listing_id is distinct from new.listing_id
       or old.channel is distinct from new.channel
       or old.operation is distinct from new.operation
       or old.environment is distinct from new.environment
       or old.request_payload is distinct from new.request_payload
       or old.seller_account_key is distinct from new.seller_account_key
       or old.request_fingerprint is distinct from new.request_fingerprint
       or old.created_by is distinct from new.created_by
       or old.provider_mutation_started_at is distinct from
          new.provider_mutation_started_at
       or old.oauth_provider_call_started_at is distinct from
          new.oauth_provider_call_started_at
       or old.write_resource_kind is distinct from new.write_resource_kind
       or old.write_resource_key is distinct from new.write_resource_key
     )) then
    raise exception 'COUPANG_POST_PRICE_VERIFIER_LINEAGE_INVALID'
      using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function
sellerpilot_private.guard_coupang_exact_post_price_verifier()
from public, anon, authenticated, service_role;

create trigger guard_coupang_exact_post_price_verifier
before insert or update
on sellerpilot_private.channel_gateway_jobs
for each row execute function
sellerpilot_private.guard_coupang_exact_post_price_verifier();

create function sellerpilot_private.coupang_exact_post_price_source_current(
  p_verifier_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  permit sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
begin
  select * into run
    from sellerpilot_private.coupang_exact_post_price_verify_runs
   where verifier_job_id = p_verifier_job_id;
  select * into verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = run.verifier_job_id;
  select * into source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = run.source_job_id;
  select * into source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = run.source_attempt_id;
  select * into listing
    from sellerpilot_private.product_listings
   where id = run.listing_id;
  select * into repair_job
    from sellerpilot_private.channel_gateway_jobs
   where id = run.price_repair_job_id;
  select * into repair_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = run.price_repair_attempt_id;
  select * into permit
    from sellerpilot_private.coupang_exact_price_repair_permits
   where repair_job_id = run.price_repair_job_id;

  return coalesce(
    run.verifier_job_id is not null
    and sellerpilot_private.coupang_exact_post_price_verifier_job_matches(verifier)
    and verifier.id <> run.price_repair_job_id
    and run.source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
    and run.source_attempt_id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid
    and run.product_id = '9725220700'
    and run.item_id = '29102903416'
    and source_job.attempt_id = source_attempt.id
    and source_job.listing_id = listing.id
    and source_job.channel = 'coupang'
    and source_job.operation = 'listing.create'
    and source_job.environment = 'production'
    and source_job.status = 'reconciliation_required'
    and source_job.response_payload->>'remoteId' = run.seller_product_id
    and source_job.response_payload->>'channel' = 'coupang'
    and source_job.response_payload->>'operation' = 'listing.create'
    and verifier.request_fingerprint = source_job.request_fingerprint
    and source_attempt.channel = 'coupang'
    and source_attempt.operation = 'listing.create'
    and source_attempt.status = 'manual_required'
    and source_attempt.remote_id = run.seller_product_id
    and listing.id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    and listing.channel_key = 'coupang'
    and listing.remote_id = run.seller_product_id
    and (
      (
        listing.status = 'failed'
        and listing.failure_class = 'external_action'
        and listing.remote_visibility = 'live'
        and listing.provider_status = 'APPROVED|requested=false|onSale=true'
        and encode(
          extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex'
        ) = run.source_listing_sha256
      )
      or (
        listing.status = 'published'
        and listing.failure_class is null
        and listing.remote_visibility = 'live'
        and listing.marketplace_sku = 'AUTO-780720401E2D4E4EA45F'
        and listing.seller_account_key =
          'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
        and listing.price = run.desired_price
        and listing.currency = run.currency
        and listing.public_url =
          'https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778'
        and exists (
          select 1
            from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
           where receipt.verifier_job_id = run.verifier_job_id
             and receipt.response_sha256 = encode(
               extensions.digest(verifier.response_payload::text, 'sha256'), 'hex'
             )
             and receipt.product_id = run.product_id
             and receipt.item_id = run.item_id
             and receipt.listing_after_snapshot = to_jsonb(listing)
             and receipt.listing_after_sha256 = encode(
               extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex'
             )
             and receipt.listing_after_sha256 = encode(
               extensions.digest(receipt.listing_after_snapshot::text, 'sha256'), 'hex'
             )
        )
      )
    )
    and run.price_repair_job_id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid
    and run.price_repair_attempt_id =
      '05508966-7665-4873-a89b-89fda8ea8a25'::uuid
    and repair_job.attempt_id = repair_attempt.id
    and repair_job.operation = 'price.update'
    and repair_attempt.operation = 'price.update'
    and repair_attempt.status = 'succeeded'
    and repair_attempt.remote_id = run.vendor_item_id
    and repair_attempt.completed_at is not null
    and sellerpilot_private.coupang_exact_price_repair_succeeded(repair_job)
    and permit.repair_job_id = repair_job.id
    and permit.repair_attempt_id = repair_attempt.id
    and permit.listing_id = run.listing_id
    and permit.credential_id = run.credential_id
    and permit.seller_product_id = run.seller_product_id
    and permit.vendor_item_id = run.vendor_item_id
    and permit.desired_price = run.desired_price
    and permit.currency = run.currency
    and permit.consumed_at is not null
    and permit.bound_at is not null
    and permit.bound_claim_token is not null
    and encode(extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex') =
      run.source_job_sha256
    and encode(extensions.digest(to_jsonb(source_attempt)::text, 'sha256'), 'hex') =
      run.source_attempt_sha256
    and encode(extensions.digest(to_jsonb(permit)::text, 'sha256'), 'hex') =
      run.price_repair_permit_sha256
    and encode(extensions.digest(to_jsonb(repair_job)::text, 'sha256'), 'hex') =
      run.price_repair_job_sha256
    and encode(extensions.digest(to_jsonb(repair_attempt)::text, 'sha256'), 'hex') =
      run.price_repair_attempt_sha256
    and encode(extensions.digest(repair_job.response_payload::text, 'sha256'), 'hex') =
      run.price_repair_response_sha256
    and verifier.request_payload#>>'{arguments,sellerpilotCoupangPostPriceVerification,priceRepairResponseSha256}' =
      run.price_repair_response_sha256
    and encode(extensions.digest(verifier.request_payload::text, 'sha256'), 'hex') =
      run.request_payload_sha256,
    false
  );
exception when others then
  return false;
end
$$;

revoke all on function
sellerpilot_private.coupang_exact_post_price_source_current(uuid)
from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_post_price_local_claim_allowed(
  p_job_id uuid,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_post_price_verify_runs run
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = run.verifier_job_id
      join sellerpilot_private.local_channel_executor_routes route
        on route.id = run.source_route_id
      join sellerpilot_private.ai_cli_worker_tokens worker
        on worker.id = run.worker_token_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = run.credential_id
     where run.verifier_job_id = p_job_id
       and sellerpilot_private.coupang_exact_post_price_source_current(job.id)
       and job.status = 'queued'
       and job.attempt_count = 0
       and job.worker_token_id is null
       and job.claim_token is null
       and job.lease_expires_at is null
       and job.started_at is null
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and job.provider_mutation_started_at is null
       and job.oauth_provider_call_started_at is null
       and job.write_resource_kind is null
       and job.write_resource_key is null
       and run.credential_id = p_credential_id
       and run.worker_token_id = p_worker_token_id
       and run.release_sha = p_release_sha
       and run.egress_ip_sha256 = p_egress_ip_sha256
       and p_worker_version = 'sellerpilot-cli-worker/1.61+'
         || run.release_sha || '.' || left(run.egress_ip_sha256, 11)
       and worker.scope = 'gateway'
       and worker.status = 'active'
       and worker.expires_at > clock_timestamp()
       and worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
       and worker.last_version = p_worker_version
       and credential.channel = 'coupang'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.last_check_status = 'passed'
       and credential.seller_account_key = job.seller_account_key
       and credential.created_by = job.created_by
       and route.owner_id =
         (select permit.seller_owner_id
            from sellerpilot_private.coupang_exact_price_repair_permits permit
           where permit.repair_job_id = run.price_repair_job_id)
       and route.channel = 'coupang'
       and route.operation in ('categories.attributes', 'categories.validate')
       and route.credential_id = run.credential_id
       and route.worker_token_id = run.worker_token_id
       and route.seller_account_key = job.seller_account_key
       and route.release_sha = run.release_sha
       and route.egress_ip_sha256 = run.egress_ip_sha256
       and route.enabled
       and route.approved_at <= clock_timestamp()
       and route.expires_at > clock_timestamp()
       and sellerpilot_private.local_channel_executor_route_is_current(
         route.owner_id, route.channel, route.operation, route.credential_id,
         route.worker_token_id, route.release_sha, route.egress_ip_sha256,
         p_worker_version
       )
       and sellerpilot_private.active_serverless_runtime_release_sha() =
         run.release_sha
       and exists (select 1 from sellerpilot_private.admin_users admin
         where admin.user_id = route.owner_id)
       and exists (select 1 from sellerpilot_private.admin_users admin
         where admin.user_id = route.approved_by)
       and exists (select 1 from sellerpilot_private.admin_users admin
         where admin.user_id = credential.created_by)
       and exists (select 1 from sellerpilot_private.admin_users admin
         where admin.user_id = worker.created_by)
       and exists (
         select 1 from sellerpilot_private.serverless_static_egress_policy policy
          where policy.channel = 'coupang' and policy.enabled is false
       )
       and not exists (
         select 1
           from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
          where receipt.verifier_job_id = job.id
       )
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_post_price_local_claim_allowed(
  uuid, uuid, uuid, text, text, text
)
from public, anon, authenticated, service_role;

alter function sellerpilot_private.local_channel_executor_job_allowed(
  uuid, uuid, uuid, text, text, text
) rename to local_channel_executor_job_allowed_before_coupang_post_price;

revoke all on function
sellerpilot_private.local_channel_executor_job_allowed_before_coupang_post_price(
  uuid, uuid, uuid, text, text, text
)
from public, anon, authenticated, service_role;

create function sellerpilot_private.local_channel_executor_job_allowed(
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
      from sellerpilot_private.coupang_exact_post_price_verify_runs run
     where run.verifier_job_id = p_job_id
  ) then
    return sellerpilot_private.coupang_exact_post_price_local_claim_allowed(
      p_job_id, p_credential_id, p_worker_token_id, p_worker_version,
      p_release_sha, p_egress_ip_sha256
    );
  end if;
  return sellerpilot_private.local_channel_executor_job_allowed_before_coupang_post_price(
    p_job_id, p_credential_id, p_worker_token_id, p_worker_version,
    p_release_sha, p_egress_ip_sha256
  );
end
$$;

revoke all on function
sellerpilot_private.local_channel_executor_job_allowed(
  uuid, uuid, uuid, text, text, text
)
from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_post_price_local_running_owned(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_post_price_verify_runs run
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = run.verifier_job_id
      join sellerpilot_private.ai_cli_worker_tokens worker
        on worker.id = job.worker_token_id
     where run.verifier_job_id = p_job_id
       and current_setting(
         'sellerpilot.coupang_post_price_verifier_hydration', true
       ) = job.id::text
       and job.status = 'running'
       and job.claim_token = p_claim_token
       and job.worker_token_id = run.worker_token_id
       and job.lease_expires_at > clock_timestamp()
       and job.attempt_count = 1
       and job.attempt_id is null
       and job.provider_mutation_started_at is null
       and job.oauth_provider_call_started_at is null
       and job.write_resource_kind is null
       and job.write_resource_key is null
       and worker.token_hash = p_token_hash
       and worker.scope = 'gateway'
       and worker.status = 'active'
       and worker.expires_at > clock_timestamp()
       and worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
       and worker.last_version = 'sellerpilot-cli-worker/1.61+'
         || run.release_sha || '.' || left(run.egress_ip_sha256, 11)
       and sellerpilot_private.active_serverless_runtime_release_sha() =
         run.release_sha
       and sellerpilot_private.coupang_exact_post_price_source_current(job.id)
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_post_price_local_running_owned(text, uuid, uuid)
from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_listing_publication_verification_source(
  text, uuid, uuid
) rename to sellerpilot_verification_source_before_coupang_post_price;

revoke all on function
public.sellerpilot_verification_source_before_coupang_post_price(text, uuid, uuid)
from public, anon, authenticated, service_role;

create function public.sellerpilot_service_listing_publication_verification_source(
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
  run sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_step jsonb;
  source_payload jsonb;
  binding jsonb;
  image_ids jsonb;
  image_roles jsonb;
  vendor_ids jsonb;
begin
  select * into run
    from sellerpilot_private.coupang_exact_post_price_verify_runs
   where verifier_job_id = p_job_id;
  if run.verifier_job_id is null then
    return public.sellerpilot_verification_source_before_coupang_post_price(
      p_token_hash, p_job_id, p_claim_token
    );
  end if;
  if sellerpilot_private.coupang_exact_post_price_local_running_owned(
       p_token_hash, p_job_id, p_claim_token
     ) is not true then
    raise exception 'COUPANG_POST_PRICE_VERIFIER_SOURCE_OWNERSHIP_REQUIRED'
      using errcode = '42501';
  end if;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = run.verifier_job_id;
  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = run.source_job_id;
  select step.value into strict source_step
    from jsonb_array_elements(source_job.response_payload->'steps')
      with ordinality step(value, position)
   where step.value->>'name' = 'listing-approval-readback'
   order by position desc
   limit 1;
  binding := source_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
  select jsonb_agg(image.value->>'publicUrl' order by image.position),
         jsonb_agg(image.value->>'role' order by image.position)
    into image_ids, image_roles
    from jsonb_array_elements(binding->'providerTransportImages')
      with ordinality image(value, position);
  select coalesce(
           jsonb_agg(item.value->>'vendorItemId' order by item.position)
             filter (where nullif(btrim(item.value->>'vendorItemId'), '') is not null),
           '[]'::jsonb
         )
    into vendor_ids
    from jsonb_array_elements(source_step#>'{data,data,items}')
      with ordinality item(value, position);
  source_payload := source_job.response_payload || jsonb_build_object(
    'steps', coalesce(source_job.response_payload->'steps', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'name', 'seller-product-publication-readback',
        'ok', true,
        'status', (source_step->>'status')::integer,
        'data', source_step->'data'
      )),
    'remoteState', jsonb_build_object(
      'resources', jsonb_build_object(
        'sellerProductId', run.seller_product_id,
        'vendorItemIds', vendor_ids
      ),
      'evidence', jsonb_build_object(
        'providerAssignedDescendantIdentityBinding', jsonb_build_object(
          'contract', 'coupang_provider_assigned_vendor_items_v1',
          'sourceJobId', source_job.id,
          'sellerProductId', run.seller_product_id
        ),
        'publicationAssetBinding', jsonb_build_object(
          'contract', 'sellerpilot_provider_asset_binding_v1',
          'sourceAssetBindingDigest',
            sellerpilot_private.coupang_exact_live_asset_digest(binding),
          'approvedManifestDigest', binding->>'approvedManifestDigest',
          'approvedDetailPageVersion',
            (binding->>'approvedDetailPageVersion')::integer,
          'approvedDetailRoles', (
            select jsonb_agg(image.value->>'role' order by image.position)
              from jsonb_array_elements(binding->'approvedDetailImages')
                with ordinality image(value, position)
          ),
          'providerImageSurface', 'detail_content',
          'providerTransportRoles', image_roles,
          'providerDetailImageIdentities', image_ids,
          'providerImageDigest', encode(
            extensions.digest(
              sellerpilot_private.coupang_exact_live_json_array(image_ids),
              'sha256'
            ),
            'hex'
          )
        )
      )
    )
  );
  return jsonb_build_object(
    'contract', 'listing_publication_verification_source_v1',
    'verificationJobId', verifier.id,
    'sourceJobId', source_job.id,
    'sourceOperation', source_job.operation,
    'sourceArguments', source_job.request_payload->'arguments',
    'sourceResponsePayload', source_payload,
    'sourceFingerprint', source_job.request_fingerprint,
    'expectedRemoteId', run.seller_product_id,
    'expectedLocale', 'ko-KR',
    'expectedImageCount', 8,
    'market', verifier.request_payload#>>'{arguments,market}',
    'targetId', verifier.request_payload#>>'{arguments,targetId}'
  );
end
$$;

revoke all on function
public.sellerpilot_service_listing_publication_verification_source(text, uuid, uuid),
public.sellerpilot_verification_source_before_coupang_post_price(text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function
public.sellerpilot_service_listing_publication_verification_source(text, uuid, uuid)
to service_role;

alter function public.sellerpilot_claim_local_channel_executor_job(
  text, text, text, text
) rename to sellerpilot_claim_local_executor_before_coupang_post_price;

revoke all on function
public.sellerpilot_claim_local_executor_before_coupang_post_price(
  text, text, text, text
)
from public, anon, authenticated, service_role;

create function public.sellerpilot_claim_local_channel_executor_job(
  p_token_hash text,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  source jsonb;
  job_id uuid;
  claim_token uuid;
  prior_marker text;
begin
  result := public.sellerpilot_claim_local_executor_before_coupang_post_price(
    p_token_hash, p_worker_version, p_release_sha, p_egress_ip_sha256
  );
  if result is null
     or not exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_verify_runs run
        where run.verifier_job_id = (result->>'id')::uuid
     ) then
    return result;
  end if;
  job_id := (result->>'id')::uuid;
  claim_token := (result->>'claim_token')::uuid;
  prior_marker := coalesce(current_setting(
    'sellerpilot.coupang_post_price_verifier_hydration', true
  ), '');
  perform pg_catalog.set_config(
    'sellerpilot.coupang_post_price_verifier_hydration', job_id::text, true
  );
  begin
    source := public.sellerpilot_service_listing_publication_verification_source(
      p_token_hash, job_id, claim_token
    );
    if source->>'contract' is distinct from
         'listing_publication_verification_source_v1'
       or source->>'verificationJobId' is distinct from job_id::text
       or source->>'sourceJobId' is distinct from
         '25adf712-1e9a-432b-8b0d-09cf35a826c5'
       or source->>'sourceOperation' is distinct from 'listing.create'
       or source->>'expectedRemoteId' is distinct from '16375780938'
       or source->>'expectedLocale' is distinct from 'ko-KR'
       or source->>'expectedImageCount' is distinct from '8'
       or jsonb_typeof(source->'sourceArguments') is distinct from 'object'
       or jsonb_typeof(source->'sourceResponsePayload') is distinct from 'object'
       or source#>>'{sourceResponsePayload,remoteId}' is distinct from
         '16375780938'
       or source#>>'{sourceResponsePayload,remoteState,resources,sellerProductId}'
         is distinct from '16375780938'
       or source#>>'{sourceResponsePayload,remoteState,resources,vendorItemIds,0}'
         is distinct from '96027942778'
       or jsonb_array_length(
         source#>'{sourceResponsePayload,remoteState,resources,vendorItemIds}'
       ) <> 1 then
      raise exception 'COUPANG_POST_PRICE_VERIFIER_SOURCE_INVALID'
        using errcode = '55000';
    end if;
    result := jsonb_set(
      result,
      '{request,arguments}',
      result#>'{request,arguments}' || jsonb_build_object(
        'sellerpilotPublicationSource', source
      ),
      false
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.coupang_post_price_verifier_hydration', prior_marker, true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.coupang_post_price_verifier_hydration', prior_marker, true
  );
  return result;
end
$$;

revoke all on function
public.sellerpilot_claim_local_channel_executor_job(text, text, text, text),
public.sellerpilot_claim_local_executor_before_coupang_post_price(
  text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function
public.sellerpilot_claim_local_channel_executor_job(text, text, text, text)
to service_role;

create function sellerpilot_private.coupang_exact_post_price_completion_valid(
  p_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  run sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  state jsonb;
  seller_step jsonb;
  vendor_step jsonb;
  content_step jsonb;
  verify_step jsonb;
  seller_root jsonb;
begin
  select * into job
    from sellerpilot_private.channel_gateway_jobs
   where id = p_job_id;
  select * into run
    from sellerpilot_private.coupang_exact_post_price_verify_runs
   where verifier_job_id = p_job_id;
  if job.id is null
     or sellerpilot_private.coupang_exact_post_price_source_current(p_job_id)
       is not true then return false; end if;
  state := job.response_payload->'remoteState';
  select step.value into seller_step
    from jsonb_array_elements(job.response_payload->'steps')
      with ordinality step(value, position)
   where step.value->>'name' = 'seller-product-publication-reverification';
  select step.value into vendor_step
    from jsonb_array_elements(job.response_payload->'steps')
      with ordinality step(value, position)
   where step.value->>'name' = 'vendor-item-publication-reverification';
  select step.value into content_step
    from jsonb_array_elements(job.response_payload->'steps')
      with ordinality step(value, position)
   where step.value->>'name' = 'publication-content-verification';
  select step.value into verify_step
    from jsonb_array_elements(job.response_payload->'steps')
      with ordinality step(value, position)
   where step.value->>'name' = 'post-price-publication-verification';
  seller_root := seller_step#>'{data,data}';
  return coalesce(
    job.status = 'succeeded'
    and job.completed_at is not null
    and job.attempt_count = 1
    and job.attempt_id is null
    and job.listing_id is null
    and job.provider_mutation_started_at is null
    and job.oauth_provider_call_started_at is null
    and job.write_resource_kind is null
    and job.write_resource_key is null
    and job.response_payload->>'ok' = 'true'
    and job.response_payload->>'channel' = 'coupang'
    and job.response_payload->>'operation' = 'listing.publication.verify'
    and job.response_payload->>'remoteId' = run.seller_product_id
    and job.response_payload->>'publicationIntent' = 'live'
    and job.response_payload->>'publicationStateContract' =
      'verified_remote_state_v1'
    and job.response_payload->>'publicationFulfilled' = 'true'
    and jsonb_array_length(job.response_payload->'steps') = 4
    and seller_step->>'ok' = 'true'
    and seller_step->>'status' ~ '^2[0-9][0-9]$'
    and seller_step#>>'{data,code}' = 'SUCCESS'
    and seller_root->>'sellerProductId' = run.seller_product_id
    and seller_root->>'productId' = run.product_id
    and upper(coalesce(
      seller_root->>'statusName', seller_root->>'approvalStatus',
      seller_root->>'status', seller_root->>'mdId', ''
    )) in ('승인완료', '부분승인완료', 'APPROVED', 'PARTIAL_APPROVED')
    and seller_root->'requested' = 'false'::jsonb
    and jsonb_array_length(seller_root->'items') = 1
    and seller_root#>>'{items,0,vendorItemId}' = run.vendor_item_id
    and seller_root#>>'{items,0,productId}' = run.product_id
    and seller_root#>>'{items,0,itemId}' = run.item_id
    and vendor_step->>'ok' = 'true'
    and vendor_step->>'status' ~ '^2[0-9][0-9]$'
    and vendor_step#>>'{data,code}' = 'SUCCESS'
    and vendor_step#>>'{data,data,onSale}' = 'true'
    and vendor_step#>>'{data,data,sellerItemId}' = run.vendor_item_id
    and vendor_step#>>'{data,data,amountInStock}' = '1'
    and vendor_step#>>'{data,data,salePrice}' = run.desired_price::text
    and vendor_step#>>'{data,sellerpilotVendorItemId}' = run.vendor_item_id
    and vendor_step#>>'{data,sellerpilotObservedSellerItemId}' = run.vendor_item_id
    and vendor_step#>>'{data,sellerpilotObservedPrice}' = run.desired_price::text
    and vendor_step#>>'{data,sellerpilotObservedStock}' = '1'
    and vendor_step#>>'{data,sellerpilotCurrency}' = run.currency
    and vendor_step#>>'{data,sellerpilotVerification}' =
      'COUPANG_POST_PRICE_PUBLICATION_PRICE_VERIFIED'
    and content_step->>'ok' = 'true'
    and content_step->>'status' = '200'
    and content_step#>>'{data,sellerpilotVerification}' =
      'LISTING_PUBLICATION_CONTENT_VERIFIED'
    and content_step#>>'{data,sourceJobId}' = run.source_job_id::text
    and content_step#>>'{data,sourceOperation}' = 'listing.create'
    and content_step#>>'{data,titleVerified}' = 'true'
    and content_step#>>'{data,descriptionVerified}' = 'true'
    and content_step#>>'{data,languageContentVerified}' = 'true'
    and content_step#>>'{data,detailImageCountVerified}' = 'true'
    and content_step#>>'{data,approvedManifestDigestVerified}' = 'true'
    and content_step#>>'{data,sourceIdentityVerified}' = 'true'
    and content_step#>>'{data,contentDigestVerified}' = 'true'
    and content_step#>>'{data,sourceDetailImageCount}' = '8'
    and content_step#>>'{data,sourceReadbackDetailImageCount}' = '8'
    and content_step#>>'{data,remoteDetailImageCount}' = '8'
    and verify_step->>'ok' = 'true'
    and verify_step->>'status' = '200'
    and verify_step#>>'{data,sellerpilotVerification}' =
      'COUPANG_POST_PRICE_PUBLICATION_VERIFIED'
    and verify_step#>>'{data,providerMutationPerformed}' = 'false'
    and verify_step#>>'{data,buyerVisibleVerified}' = 'false'
    and verify_step#>>'{data,observedPrice}' = run.desired_price::text
    and verify_step#>>'{data,observedStock}' = '1'
    and verify_step#>>'{data,currency}' = run.currency
    and verify_step#>>'{data,sellerRequested}' = 'false'
    and verify_step#>>'{data,productId}' = run.product_id
    and verify_step#>>'{data,itemId}' = run.item_id
    and verify_step#>>'{data,expectedProductId}' = run.product_id
    and verify_step#>>'{data,expectedItemId}' = run.item_id
    and verify_step#>>'{data,publicUrl}' =
      'https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778'
    and state->>'verified' = 'true'
    and state->>'visibility' = 'live'
    and state->>'locale' = 'ko-KR'
    and state->>'fingerprint' = job.request_fingerprint
    and state->>'imageCount' = '8'
    and state#>>'{resources,sellerProductId}' = run.seller_product_id
    and state#>>'{resources,vendorItemIds,0}' = run.vendor_item_id
    and jsonb_array_length(state#>'{resources,vendorItemIds}') = 1
    and state#>>'{resources,productId}' = run.product_id
    and state#>>'{resources,itemId}' = run.item_id
    and state#>>'{evidence,verificationScope}' =
      'provider_publication_after_price_repair'
    and state#>>'{evidence,priceRepairJobId}' = run.price_repair_job_id::text
    and state#>>'{evidence,priceRepairAttemptId}' =
      run.price_repair_attempt_id::text
    and state#>>'{evidence,priceRepairResponseSha256}' =
      run.price_repair_response_sha256
    and state#>>'{evidence,priceRepairOfficialReadbackVerified}' = 'true'
    and state#>>'{evidence,postPricePublicationReadbackVerified}' = 'true'
    and state#>>'{evidence,sourceJobId}' = run.source_job_id::text
    and state#>>'{evidence,sourceOperation}' = 'listing.create'
    and state#>>'{evidence,contentVerified}' = 'true'
    and state#>>'{evidence,observedPrice}' = run.desired_price::text
    and state#>>'{evidence,observedStock}' = '1'
    and state#>>'{evidence,currency}' = run.currency
    and state#>>'{evidence,providerMutationPerformed}' = 'false'
    and state#>>'{evidence,buyerVisibleVerified}' = 'false'
    and state#>>'{evidence,providerPublicUrl}' =
      'https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778',
    false
  );
exception when others then
  return false;
end
$$;

revoke all on function
sellerpilot_private.coupang_exact_post_price_completion_valid(uuid)
from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_post_price_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_job_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_post_price_verify_runs run
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = run.verifier_job_id
      join sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
        on receipt.verifier_job_id = run.verifier_job_id
     where p_job_id ~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and run.verifier_job_id = p_job_id::uuid
       and run.listing_id = (p_old->>'id')::uuid
       and encode(extensions.digest(p_old::text, 'sha256'), 'hex') =
         run.source_listing_sha256
       and receipt.response_sha256 = encode(
         extensions.digest(job.response_payload::text, 'sha256'), 'hex'
       )
       and receipt.provider_live_verified
       and not receipt.provider_mutation_performed
       and receipt.product_id = run.product_id
       and receipt.item_id = run.item_id
       and receipt.listing_after_snapshot = p_new
       and receipt.listing_after_sha256 = encode(
         extensions.digest(p_new::text, 'sha256'), 'hex'
       )
       and receipt.listing_after_sha256 = encode(
         extensions.digest(receipt.listing_after_snapshot::text, 'sha256'), 'hex'
       )
       and p_old->>'status' = 'failed'
       and p_old->>'failure_class' = 'external_action'
       and p_old->>'remote_visibility' = 'live'
       and p_old->>'remote_id' = run.seller_product_id
       and p_new->>'id' = p_old->>'id'
       and p_new->>'remote_id' = run.seller_product_id
       and p_new->>'seller_account_key' =
         'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
       and p_new->>'marketplace_sku' = 'AUTO-780720401E2D4E4EA45F'
       and p_new->>'status' = 'published'
       and p_new->'failure_class' = 'null'::jsonb
       and p_new->>'remote_visibility' = 'live'
       and p_new->>'provider_status' = job.response_payload#>>'{remoteState,providerStatus}'
       and p_new->'remote_resources' = job.response_payload#>'{remoteState,resources}'
       and p_new->>'public_url' =
         'https://www.coupang.com/vp/products/9725220700?vendorItemId=96027942778'
       and (p_new->>'last_verified_at')::timestamptz =
         (job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz
       and p_new->'last_error' = 'null'::jsonb
       and p_new->>'currency' = run.currency
       and (p_new->>'price')::numeric = run.desired_price
       and (
         p_new - array[
           'seller_account_key', 'marketplace_sku', 'status', 'failure_class',
           'remote_visibility', 'provider_status', 'remote_resources',
           'public_url', 'published_at', 'last_verified_at', 'last_error',
           'currency', 'price', 'updated_at'
         ]::text[]
       ) = (
         p_old - array[
           'seller_account_key', 'marketplace_sku', 'status', 'failure_class',
           'remote_visibility', 'provider_status', 'remote_resources',
           'public_url', 'published_at', 'last_verified_at', 'last_error',
           'currency', 'price', 'updated_at'
         ]::text[]
       )
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_post_price_listing_update_allowed(
  jsonb, jsonb, text
)
from public, anon, authenticated, service_role;

do $listing_guard$
declare
  procedure_name constant regprocedure :=
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure;
  definition text;
  installed_definition text;
  begin_position integer;
  branch constant text := E'\n  if nullif(current_setting(''sellerpilot.coupang_exact_post_price_reconcile'', true), '''') is not null then\n    if sellerpilot_private.coupang_exact_post_price_listing_update_allowed(\n      to_jsonb(old), to_jsonb(new),\n      current_setting(''sellerpilot.coupang_exact_post_price_reconcile'', true)\n    ) is not true then\n      raise exception ''invalid exact Coupang post-price listing projection''\n        using errcode = ''55000'';\n    end if;\n    return new;\n  end if;\n';
begin
  select pg_catalog.pg_get_functiondef(procedure_name) into strict definition;
  if pg_catalog.strpos(
       definition, 'sellerpilot.coupang_exact_post_price_reconcile'
     ) > 0 then return; end if;
  begin_position := pg_catalog.strpos(lower(definition), 'begin');
  if begin_position = 0 then
    raise exception 'COUPANG_POST_PRICE_LISTING_GUARD_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  definition := pg_catalog.substr(definition, 1, begin_position + 4)
    || branch || pg_catalog.substr(definition, begin_position + 5);
  execute definition;
  select pg_catalog.pg_get_functiondef(procedure_name)
    into strict installed_definition;
  if installed_definition is distinct from definition then
    raise exception 'COUPANG_POST_PRICE_LISTING_GUARD_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$listing_guard$;

create function sellerpilot_private.record_coupang_exact_post_price_completion(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  run sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  listing_after sellerpilot_private.product_listings%rowtype;
  receipt sellerpilot_private.coupang_exact_post_price_verify_receipts%rowtype;
  response_sha text;
  verified_at timestamptz;
  projection_at timestamptz;
  v_public_url text;
  listing_after_snapshot jsonb;
begin
  select * into run
    from sellerpilot_private.coupang_exact_post_price_verify_runs
   where verifier_job_id = p_job_id for share;
  if run.verifier_job_id is null then return false; end if;
  select * into strict job
    from sellerpilot_private.channel_gateway_jobs
   where id = p_job_id for update;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = run.listing_id for update;
  response_sha := encode(
    extensions.digest(job.response_payload::text, 'sha256'), 'hex'
  );
  select * into receipt
    from sellerpilot_private.coupang_exact_post_price_verify_receipts
   where verifier_job_id = p_job_id;
  if receipt.verifier_job_id is not null then
    return receipt.response_sha256 = response_sha
      and receipt.source_job_id = run.source_job_id
      and receipt.source_attempt_id = run.source_attempt_id
      and receipt.price_repair_job_id = run.price_repair_job_id
      and receipt.product_id = run.product_id
      and receipt.item_id = run.item_id
      and receipt.provider_live_verified
      and not receipt.provider_mutation_performed
      and receipt.listing_after_snapshot = to_jsonb(listing)
      and receipt.listing_after_sha256 = encode(
        extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex'
      )
      and receipt.listing_after_sha256 = encode(
        extensions.digest(receipt.listing_after_snapshot::text, 'sha256'), 'hex'
      );
  end if;
  if sellerpilot_private.coupang_exact_post_price_completion_valid(p_job_id)
       is not true then
    raise exception 'COUPANG_POST_PRICE_GET_VERIFICATION_INCOMPLETE'
      using errcode = '55000';
  end if;
  verified_at := (job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
  projection_at := clock_timestamp();
  v_public_url := job.response_payload#>>'{remoteState,evidence,providerPublicUrl}';
  listing_after_snapshot := to_jsonb(listing) || jsonb_build_object(
    'seller_account_key',
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd',
    'marketplace_sku', 'AUTO-780720401E2D4E4EA45F',
    'remote_id', run.seller_product_id,
    'status', 'published',
    'failure_class', null,
    'remote_visibility', 'live',
    'provider_status', job.response_payload#>>'{remoteState,providerStatus}',
    'remote_resources', job.response_payload#>'{remoteState,resources}',
    'public_url', v_public_url,
    'published_at', coalesce(listing.published_at, verified_at),
    'last_verified_at', verified_at,
    'last_error', null,
    'currency', run.currency,
    'price', run.desired_price,
    'updated_at', projection_at
  );
  insert into sellerpilot_private.coupang_exact_post_price_verify_receipts (
    verifier_job_id, source_job_id, source_attempt_id, price_repair_job_id,
    price_repair_attempt_id, listing_id, seller_product_id, vendor_item_id,
    product_id, item_id,
    desired_price, observed_price, observed_stock, currency, public_url,
    response_sha256, seller_product_verified, seller_approved,
    all_vendor_items_on_sale, exact_eight_images_verified, price_verified,
    provider_live_verified, buyer_visible_verified, provider_mutation_performed,
    listing_after_snapshot, listing_after_sha256,
    claim_attempt_count, contract, recorded_at
  ) values (
    job.id, run.source_job_id, run.source_attempt_id, run.price_repair_job_id,
    run.price_repair_attempt_id, run.listing_id, run.seller_product_id,
    run.vendor_item_id, run.product_id, run.item_id,
    run.desired_price, run.desired_price, 1, run.currency,
    v_public_url, response_sha, true, true, true, true, true,
    true, false, false, listing_after_snapshot,
    encode(extensions.digest(listing_after_snapshot::text, 'sha256'), 'hex'),
    job.attempt_count,
    'coupang_exact_post_price_publication_receipt_v1', clock_timestamp()
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_post_price_reconcile', job.id::text, true
  );
  update sellerpilot_private.product_listings current_listing
     set seller_account_key =
           'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd',
         marketplace_sku = 'AUTO-780720401E2D4E4EA45F',
         remote_id = run.seller_product_id,
         status = 'published',
         failure_class = null,
         remote_visibility = 'live',
         provider_status = job.response_payload#>>'{remoteState,providerStatus}',
         remote_resources = job.response_payload#>'{remoteState,resources}',
         public_url = v_public_url,
         published_at = coalesce(listing.published_at, verified_at),
         last_verified_at = verified_at,
         last_error = null,
         currency = run.currency,
         price = run.desired_price,
         updated_at = projection_at
   where current_listing.id = run.listing_id
     and to_jsonb(current_listing) = to_jsonb(listing);
  if not found then
    raise exception 'COUPANG_POST_PRICE_LISTING_UPDATE_LOST_FENCE'
      using errcode = '55000';
  end if;
  select * into strict listing_after
    from sellerpilot_private.product_listings
   where id = run.listing_id;
  if to_jsonb(listing_after) <> listing_after_snapshot
     or encode(
       extensions.digest(to_jsonb(listing_after)::text, 'sha256'), 'hex'
     ) <> encode(
       extensions.digest(listing_after_snapshot::text, 'sha256'), 'hex'
     ) then
    raise exception 'COUPANG_POST_PRICE_LISTING_POSTIMAGE_REJECTED'
      using errcode = '55000';
  end if;
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) select permit.seller_owner_id,
      'coupang_exact_post_price_publication_verified',
      'channel_gateway_job', job.id::text,
      jsonb_build_object(
        'contract', 'coupang_exact_post_price_publication_receipt_v1',
        'priceRepairJobId', run.price_repair_job_id,
        'sourceJobId', run.source_job_id,
        'sourceAttemptId', run.source_attempt_id,
        'verifierJobId', run.verifier_job_id,
        'sellerProductId', run.seller_product_id,
        'vendorItemId', run.vendor_item_id,
        'price', run.desired_price,
        'currency', run.currency,
        'publicUrl', v_public_url,
        'providerLiveVerified', true,
        'buyerVisibleVerified', false,
        'providerMutationPerformed', false,
        'responseSha256', response_sha
      )
    from sellerpilot_private.coupang_exact_price_repair_permits permit
   where permit.repair_job_id = run.price_repair_job_id;
  return true;
end
$$;

revoke all on function
sellerpilot_private.record_coupang_exact_post_price_completion(uuid)
from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
) rename to sellerpilot_complete_before_coupang_post_price;

revoke all on function
public.sellerpilot_complete_before_coupang_post_price(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
)
from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  exact_run boolean;
begin
  select exists (
    select 1
      from sellerpilot_private.coupang_exact_post_price_verify_runs run
     where run.verifier_job_id = p_job_id
  ) into exact_run;
  result := public.sellerpilot_complete_before_coupang_post_price(
    p_token_hash, p_job_id, p_claim_token, p_status, p_response_payload,
    p_error_message, p_credential_refresh, p_normalized_orders,
    p_normalized_inquiries, p_diagnostic
  );
  if exact_run and result->>'status' in ('completed', 'completed_replay') then
    if p_status = 'succeeded' then
      if sellerpilot_private.record_coupang_exact_post_price_completion(p_job_id)
           is not true then
        raise exception 'COUPANG_POST_PRICE_RECEIPT_NOT_RECORDED'
          using errcode = '55000';
      end if;
    elsif exists (
      select 1
        from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
       where receipt.verifier_job_id = p_job_id
    ) then
      raise exception 'COUPANG_POST_PRICE_FAILURE_HAS_SUCCESS_RECEIPT'
        using errcode = '55000';
    end if;
  end if;
  return result;
end
$$;

revoke all on function
public.sellerpilot_service_complete_gateway_transaction(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
),
public.sellerpilot_complete_before_coupang_post_price(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
)
from public, anon, authenticated, service_role;
grant execute on function
public.sellerpilot_service_complete_gateway_transaction(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
)
to service_role;

create function public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier(
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  repair_job sellerpilot_private.channel_gateway_jobs%rowtype;
  repair_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  permit sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  route sellerpilot_private.local_channel_executor_routes%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  existing sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  existing_job sellerpilot_private.channel_gateway_jobs%rowtype;
  verifier_job_id uuid;
  payload jsonb;
  response_sha text;
begin
  if current_setting('role', true) is distinct from 'service_role'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$' then
    raise exception 'COUPANG_POST_PRICE_RELEASE_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1637578093, 8072061);

  select * into existing
    from sellerpilot_private.coupang_exact_post_price_verify_runs
   where price_repair_job_id =
     '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid;
  if existing.verifier_job_id is not null then
    select * into strict existing_job
      from sellerpilot_private.channel_gateway_jobs
     where id = existing.verifier_job_id;
    if existing.release_sha is distinct from p_release_sha then
      raise exception 'COUPANG_POST_PRICE_VERIFIER_RELEASE_MISMATCH'
        using errcode = '55000';
    end if;
    if sellerpilot_private.coupang_exact_post_price_source_current(
         existing.verifier_job_id
       ) is not true then
      raise exception 'COUPANG_POST_PRICE_VERIFIER_REPLAY_DRIFT'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', 'coupang_exact_post_price_publication_enqueue_v1',
      'status', existing_job.status,
      'jobId', existing.verifier_job_id,
      'releaseSha', existing.release_sha,
      'reused', true,
      'providerMutationStarted', false,
      'providerMutationPerformed', false
    );
  end if;

  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
   for share;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid
   for share;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
   for share;
  select * into strict repair_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid
   for share;
  select * into strict repair_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = '05508966-7665-4873-a89b-89fda8ea8a25'::uuid
   for share;
  select * into strict permit
    from sellerpilot_private.coupang_exact_price_repair_permits
   where repair_job_id = repair_job.id
   for share;
  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = permit.credential_id
   for share;
  select candidate.* into strict route
    from sellerpilot_private.local_channel_executor_routes candidate
   where candidate.owner_id = permit.seller_owner_id
     and candidate.channel = 'coupang'
     and candidate.operation in ('categories.attributes', 'categories.validate')
     and candidate.credential_id = permit.credential_id
     and candidate.seller_account_key = permit.seller_account_key
     and candidate.release_sha = p_release_sha
     and candidate.enabled
     and candidate.approved_at <= clock_timestamp()
     and candidate.expires_at > clock_timestamp()
   order by candidate.expires_at desc, candidate.id
   limit 1
   for share;
  select * into strict worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = route.worker_token_id
   for share;
  response_sha := encode(
    extensions.digest(repair_job.response_payload::text, 'sha256'), 'hex'
  );

  if sellerpilot_private.coupang_exact_price_repair_succeeded(repair_job)
       is not true
     or source_job.attempt_id is distinct from source_attempt.id
     or source_job.listing_id is distinct from listing.id
     or source_job.channel is distinct from 'coupang'
     or source_job.operation is distinct from 'listing.create'
     or source_job.environment is distinct from 'production'
     or source_job.status is distinct from 'reconciliation_required'
     or source_job.response_payload->>'remoteId' is distinct from '16375780938'
     or source_job.request_fingerprint !~ '^[a-f0-9]{64}$'
     or source_attempt.channel is distinct from 'coupang'
     or source_attempt.operation is distinct from 'listing.create'
     or source_attempt.status is distinct from 'manual_required'
     or source_attempt.remote_id is distinct from '16375780938'
     or listing.channel_key is distinct from 'coupang'
     or listing.remote_id is distinct from '16375780938'
     or listing.status is distinct from 'failed'
     or listing.failure_class is distinct from 'external_action'
     or listing.remote_visibility is distinct from 'live'
     or listing.provider_status is distinct from
       'APPROVED|requested=false|onSale=true'
     or sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
       source_job.id
     ) is not true
     or repair_job.attempt_id is distinct from repair_attempt.id
     or repair_attempt.status is distinct from 'succeeded'
     or repair_attempt.operation is distinct from 'price.update'
     or repair_attempt.remote_id is distinct from '96027942778'
     or repair_attempt.completed_at is null
     or permit.repair_attempt_id is distinct from repair_attempt.id
     or permit.listing_id is distinct from
       'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
     or permit.seller_product_id is distinct from '16375780938'
     or permit.vendor_item_id is distinct from '96027942778'
     or permit.desired_price is distinct from 3190
     or permit.currency is distinct from 'KRW'
     or permit.consumed_at is null
     or permit.bound_at is null
     or permit.bound_claim_token is null
     or credential.id is distinct from
       '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
     or credential.channel is distinct from 'coupang'
     or credential.environment is distinct from 'production'
     or credential.status is distinct from 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= clock_timestamp())
     or credential.last_check_status is distinct from 'passed'
     or credential.seller_account_key is distinct from permit.seller_account_key
     or route.egress_ip_sha256 <> permit.egress_ip_sha256
     or worker.scope is distinct from 'gateway'
     or worker.status is distinct from 'active'
     or worker.expires_at <= clock_timestamp()
     or worker.last_seen_at < clock_timestamp() - interval '3 minutes'
     or worker.last_version is distinct from 'sellerpilot-cli-worker/1.61+'
       || p_release_sha || '.' || left(route.egress_ip_sha256, 11)
     or sellerpilot_private.active_serverless_runtime_release_sha() <>
       p_release_sha
     or sellerpilot_private.local_channel_executor_route_is_current(
       route.owner_id, route.channel, route.operation, route.credential_id,
       route.worker_token_id, route.release_sha, route.egress_ip_sha256,
       worker.last_version
     ) is not true
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs old_verifier
        where old_verifier.id =
          '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
          and old_verifier.status in ('queued', 'running')
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs duplicate
        where coalesce((duplicate.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangPostPriceVerification', false)
     ) then
    raise exception 'COUPANG_POST_PRICE_VERIFIER_PREIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  verifier_job_id := gen_random_uuid();
  payload := jsonb_build_object(
    'periodicKey',
      'coupang-exact-post-price-publication:v1:36fcb808-a2f1-42b7-a6c9-264d884f25fb',
    'arguments', jsonb_build_object(
      'sellerpilotReadOnly', true,
      'publicationReviewSourceJobId', source_job.id,
      'remoteId', '16375780938',
      'market', '',
      'targetId', '',
      'publicationIntent', 'live',
      'publicationStateContract', 'verified_remote_state_v1',
      'publicationExpectedLocale', 'ko-KR',
      'publicationExpectedFingerprint', source_job.request_fingerprint,
      'publicationExpectedImageCount', 8,
      'sellerpilotCoupangPostPriceVerification', jsonb_build_object(
        'contract', 'coupang_exact_post_price_publication_v1',
        'verifierJobId', verifier_job_id,
        'priceRepairJobId', repair_job.id,
        'priceRepairAttemptId', repair_attempt.id,
        'sellerProductId', '16375780938',
        'vendorItemId', '96027942778',
        'productId', '9725220700',
        'itemId', '29102903416',
        'desiredPrice', 3190,
        'currency', 'KRW',
        'priceRepairResponseSha256', response_sha
      )
    )
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_post_price_verifier_enqueue',
    verifier_job_id::text,
    true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation, environment,
    request_payload, status, seller_account_key, request_fingerprint,
    created_by, created_at, updated_at
  ) values (
    verifier_job_id, credential.id, null, null, 'coupang',
    'listing.publication.verify', 'production', payload, 'queued',
    permit.seller_account_key, source_job.request_fingerprint,
    credential.created_by, clock_timestamp(), clock_timestamp()
  );
  insert into sellerpilot_private.coupang_exact_post_price_verify_runs (
    verifier_job_id, source_job_id, source_attempt_id, price_repair_job_id,
    price_repair_attempt_id, listing_id, credential_id, source_route_id,
    worker_token_id, seller_product_id,
    vendor_item_id, product_id, item_id,
    desired_price, currency, release_sha, egress_ip_sha256,
    price_repair_job_sha256, price_repair_attempt_sha256,
    price_repair_response_sha256, source_job_sha256, source_attempt_sha256,
    source_listing_sha256, price_repair_permit_sha256,
    request_payload_sha256, contract, queued_at
  ) values (
    verifier_job_id, source_job.id, source_attempt.id, repair_job.id,
    repair_attempt.id, permit.listing_id, credential.id, route.id, worker.id,
    '16375780938', '96027942778', '9725220700', '29102903416', 3190,
    'KRW', p_release_sha, route.egress_ip_sha256,
    encode(extensions.digest(to_jsonb(repair_job)::text, 'sha256'), 'hex'),
    encode(extensions.digest(to_jsonb(repair_attempt)::text, 'sha256'), 'hex'),
    response_sha,
    encode(extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex'),
    encode(extensions.digest(to_jsonb(source_attempt)::text, 'sha256'), 'hex'),
    encode(extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex'),
    encode(extensions.digest(to_jsonb(permit)::text, 'sha256'), 'hex'),
    encode(extensions.digest(payload::text, 'sha256'), 'hex'),
    'coupang_exact_post_price_publication_v1', clock_timestamp()
  );
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    permit.seller_owner_id,
    'coupang_exact_post_price_publication_enqueued',
    'channel_gateway_job', verifier_job_id::text,
    jsonb_build_object(
      'contract', 'coupang_exact_post_price_publication_enqueue_v1',
      'priceRepairJobId', repair_job.id,
      'sourceJobId', source_job.id,
      'sourceAttemptId', source_attempt.id,
      'verifierJobId', verifier_job_id,
      'sellerProductId', '16375780938',
      'vendorItemId', '96027942778',
      'price', 3190,
      'currency', 'KRW',
      'releaseSha', p_release_sha,
      'providerMutationPerformed', false
    )
  );
  return jsonb_build_object(
    'contract', 'coupang_exact_post_price_publication_enqueue_v1',
    'status', 'queued',
      'jobId', verifier_job_id,
      'releaseSha', p_release_sha,
    'reused', false,
    'providerMutationStarted', false,
    'providerMutationPerformed', false
  );
end
$$;

revoke all on function
public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier(text)
from public, anon, authenticated;
grant execute on function
public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier(text)
to service_role;

do $postflight$
declare
  enqueue_acl text;
  definition text;
  matcher_definition text;
begin
  if (select count(*)
        from sellerpilot_private.coupang_exact_post_price_verify_runs) <> 0
     or (select count(*)
           from sellerpilot_private.coupang_exact_post_price_verify_receipts) <> 0
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangPostPriceVerification', false)
     ) then
    raise exception 'COUPANG_POST_PRICE_INSTALL_CREATED_RUNTIME_STATE'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier(text)'::regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition, 'publicationReviewSourceJobId') = 0
     or pg_catalog.strpos(definition, 'listing.publication.verify') = 0
     or pg_catalog.strpos(definition, 'listing.create') = 0
     or pg_catalog.strpos(definition, 'price.update') = 0
     or pg_catalog.strpos(definition, 'COUPANG_POST_PRICE_VERIFIER_RELEASE_MISMATCH') = 0
     or pg_catalog.strpos(definition, '''releaseSha''') = 0 then
    raise exception 'COUPANG_POST_PRICE_ENQUEUE_DEFINITION_INVALID'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_post_price_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  ) into strict matcher_definition;
  if pg_catalog.strpos(matcher_definition, 'provider_mutation_started_at') = 0
     or pg_catalog.strpos(matcher_definition, 'oauth_provider_call_started_at') = 0
     or pg_catalog.strpos(matcher_definition, 'productId') = 0
     or pg_catalog.strpos(matcher_definition, 'itemId') = 0 then
    raise exception 'COUPANG_POST_PRICE_MATCHER_DEFINITION_INVALID'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from (values
        (
          'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure,
          'fa88b5c706c7abdef8e40d19d6607237dd268d29ce6c274dcc703a300aa9964c'
        ),
        (
          'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'::regprocedure,
          '141fe06760c29c8a6162f30c27b810b08b25c00faea4b4aa179da58fb59fae4e'
        ),
        (
          'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure,
          'ff68cbfe6dc283cac95bdaaaa7797477f191c20df1b29d73c7d22009e82e4b0f'
        ),
        (
          'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
          'e3ad7aa1fcb0e3d2434bd3b112234e1d083d77c51504d4769308f8457d492085'
        )
      ) expected(procedure_name, definition_sha256)
     where encode(
       extensions.digest(pg_catalog.pg_get_functiondef(expected.procedure_name), 'sha256'),
       'hex'
     ) <> expected.definition_sha256
  ) then
    raise exception 'COUPANG_POST_PRICE_VERIFIER_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  select coalesce(array_to_string(procedure.proacl, ','), '')
    into strict enqueue_acl
    from pg_catalog.pg_proc procedure
   where procedure.oid =
     'public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier(text)'::regprocedure
     and procedure.prosecdef
     and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
     and procedure.proconfig @> array['search_path=""', 'TimeZone=UTC'];
  if enqueue_acl !~ 'service_role=X/postgres'
     or enqueue_acl ~ '(anon|authenticated|PUBLIC)' then
    raise exception 'COUPANG_POST_PRICE_ENQUEUE_ACL_INVALID'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on table sellerpilot_private.coupang_exact_post_price_verify_runs is
  'One fresh GET-only Coupang publication verifier bound to the successful exact price repair and its official price readback.';
comment on table sellerpilot_private.coupang_exact_post_price_verify_receipts is
  'Immutable provider-live publication evidence after the exact price repair; buyer visibility remains a separate check.';

commit;
