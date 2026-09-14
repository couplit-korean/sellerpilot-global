-- Bind one externally repaired eBay Offer to its published Listing identity.
-- The original CREATE job/attempt remain immutable evidence. The private local
-- receipt is represented by two distinct digests; this migration never reads
-- provider credentials and never performs a provider call.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';
set local timezone = 'UTC';

do $guard_preimage$
declare r record;
begin
  for r in select * from (values
    ('sellerpilot_private.guard_immutable_ebay_offer_identity()', '3d0b5fee29130c9f067870b7606d1c8f'),
    ('sellerpilot_private.guard_product_listing_seller_lineage()', '38e1a8cf1ece02889810c2a6da2696d0'),
    ('sellerpilot_private.guard_verified_ebay_listing_sku_recovery()', 'b1b18c0e2699cb783f4c5e7d278efa25')
  ) expected(signature, body_md5)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = r.signature::regprocedure)
         is distinct from r.body_md5 then
      raise exception 'EBAY_NARANGD_REPAIR_GUARD_DRIFT:%', r.signature
        using errcode = '55000';
    end if;
  end loop;
end $guard_preimage$;

create table sellerpilot_private.ebay_narangd_offer_repair_receipts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique
    references sellerpilot_private.product_listings(id) on delete restrict
    check (listing_id = 'b66bdb38-a9e2-4883-a147-5122659eec88'::uuid),
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict
    check (product_id = 'c0bdb493-6447-41bf-af0a-46a3da7a75a8'::uuid),
  source_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (source_job_id = '81f79abf-ed3f-44cd-a445-fe76e2dcba65'::uuid),
  source_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict
    check (source_attempt_id = '51ccc22f-36d3-4032-9125-d712cdb59f46'::uuid),
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict
    check (credential_id = '374cd5d4-89dc-402b-bed4-067d4dbbe836'::uuid),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  remote_listing_id text not null check (remote_listing_id = '800659240462'),
  offer_id text not null check (offer_id = '265437447011'),
  marketplace_sku text not null
    check (marketplace_sku = 'AUTO-00BF58A2E8434FF09667-US'),
  marketplace_id text not null check (marketplace_id = 'EBAY_US'),
  offer_status text not null check (offer_status = 'PUBLISHED'),
  listing_status text not null check (listing_status = 'ACTIVE'),
  inventory_put_status integer not null check (inventory_put_status = 204),
  publish_status integer not null check (publish_status = 200),
  inventory_readback_status integer not null check (inventory_readback_status = 200),
  offer_readback_status integer not null check (offer_readback_status = 200),
  verified_receipt_digest text not null
    check (verified_receipt_digest = '2267faf785338ba10317e11565076cbe347cebb324d44ceb3cde272de5421fb8'),
  receipt_file_sha256 text not null
    check (receipt_file_sha256 = '2a5d145af53f26299e7837ee01da0815a27d11349d3aa0abd0eda4ea4bad1b2a'),
  original_evidence_digest text not null
    check (original_evidence_digest = '7259e79504b3c67ad07ef0afa72e085c262b0042596475bb061d2088069cc2e7'),
  preflight_digest text not null
    check (preflight_digest = '0ef831995cfea8a7c617954ebaaad2f4ae06d1de84e525466e0e4228a7f4810d'),
  corrected_inventory_digest text not null
    check (corrected_inventory_digest = '81071501065d771278b9e038a0a5a77c03db18648f6edbd27949cd385308b64e'),
  final_offer_digest text not null
    check (final_offer_digest = 'a59a00b6432e0be14d23dfb0829850f060491f85e1bf97f65705b3dfc08efe4b'),
  executed_at timestamptz not null
    check (executed_at = '2026-09-14 06:46:46.951+00'::timestamptz),
  listing_before jsonb not null,
  source_job_before jsonb not null,
  source_attempt_before jsonb not null,
  product_before jsonb not null,
  buyer_visible_verified boolean not null default false
    check (buyer_visible_verified is false),
  provider_mutation_performed boolean not null default true
    check (provider_mutation_performed is true),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.ebay_narangd_offer_repair_receipts enable row level security;
revoke all on sellerpilot_private.ebay_narangd_offer_repair_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.ebay_narangd_offer_repair_receipt_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'eBay Narangd repair receipt is immutable' using errcode = '55000';
end $$;
create trigger ebay_narangd_offer_repair_receipt_immutable
before update or delete on sellerpilot_private.ebay_narangd_offer_repair_receipts
for each row execute function sellerpilot_private.ebay_narangd_offer_repair_receipt_immutable();

create function sellerpilot_private.ebay_narangd_offer_repair_source_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_table_name = 'channel_gateway_jobs'
      and old.id = '81f79abf-ed3f-44cd-a445-fe76e2dcba65'::uuid)
     or (tg_table_name = 'channel_operation_attempts'
      and old.id = '51ccc22f-36d3-4032-9125-d712cdb59f46'::uuid) then
    raise exception 'eBay Narangd repair source evidence is immutable'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger ebay_narangd_offer_repair_source_job_immutable
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row when (old.id = '81f79abf-ed3f-44cd-a445-fe76e2dcba65'::uuid)
execute function sellerpilot_private.ebay_narangd_offer_repair_source_immutable();
create trigger ebay_narangd_offer_repair_source_attempt_immutable
before update or delete on sellerpilot_private.channel_operation_attempts
for each row when (old.id = '51ccc22f-36d3-4032-9125-d712cdb59f46'::uuid)
execute function sellerpilot_private.ebay_narangd_offer_repair_source_immutable();

create function sellerpilot_private.ebay_narangd_offer_repair_remote_resources(p_receipt_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contract', 'ebay_narangd_offer_repair_receipt_v1',
    'verificationScope', 'provider_publish_and_exact_offer_readback',
    'providerLiveVerified', true,
    'buyerVisibleVerified', receipt.buyer_visible_verified,
    'providerMutationPerformed', receipt.provider_mutation_performed,
    'resources', jsonb_build_object(
      'listingId', receipt.remote_listing_id,
      'offerId', receipt.offer_id,
      'sku', receipt.marketplace_sku,
      'marketplaceId', receipt.marketplace_id
    ),
    'verification', jsonb_build_object(
      'verifiedReceiptDigest', receipt.verified_receipt_digest,
      'receiptFileSha256', receipt.receipt_file_sha256,
      'originalEvidenceDigest', receipt.original_evidence_digest,
      'preflightDigest', receipt.preflight_digest,
      'correctedInventoryDigest', receipt.corrected_inventory_digest,
      'finalOfferDigest', receipt.final_offer_digest,
      'offerStatus', receipt.offer_status,
      'listingStatus', receipt.listing_status,
      'inventoryPutStatus', receipt.inventory_put_status,
      'publishStatus', receipt.publish_status,
      'inventoryReadbackStatus', receipt.inventory_readback_status,
      'offerReadbackStatus', receipt.offer_readback_status,
      'executedAt', receipt.executed_at
    )
  )
  from sellerpilot_private.ebay_narangd_offer_repair_receipts receipt
  where receipt.id = p_receipt_id
$$;

create function sellerpilot_private.ebay_narangd_offer_repair_projection_allowed(
  p_old jsonb, p_new jsonb, p_receipt_id text
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare receipt sellerpilot_private.ebay_narangd_offer_repair_receipts%rowtype;
begin
  if coalesce(p_receipt_id, '') !~ '^[0-9a-f-]{36}$'
     or p_old->>'id' <> 'b66bdb38-a9e2-4883-a147-5122659eec88'
     or p_new->>'id' <> p_old->>'id' then
    return false;
  end if;
  select * into receipt
  from sellerpilot_private.ebay_narangd_offer_repair_receipts r
  where r.id = p_receipt_id::uuid and r.listing_id = (p_old->>'id')::uuid;
  if receipt.id is null or receipt.listing_before is distinct from p_old then
    return false;
  end if;
  return coalesce(
    (p_new - array[
      'remote_id','status','marketplace_sku','provider_resource_id',
      'remote_resources','remote_visibility','provider_status','published_at',
      'last_verified_at','last_error','failure_class','seller_account_key','updated_at'
    ]) = (p_old - array[
      'remote_id','status','marketplace_sku','provider_resource_id',
      'remote_resources','remote_visibility','provider_status','published_at',
      'last_verified_at','last_error','failure_class','seller_account_key','updated_at'
    ])
    and p_new->>'remote_id' = receipt.remote_listing_id
    and p_new->>'status' = 'published'
    and p_new->>'marketplace_sku' = receipt.marketplace_sku
    and p_new->>'provider_resource_id' = receipt.offer_id
    and p_new->>'seller_account_key' = receipt.seller_account_key
    and p_new->>'remote_visibility' = 'live'
    and p_new->>'provider_status' = 'ACTIVE'
    and p_new->'failure_class' = 'null'::jsonb
    and p_new->'last_error' = 'null'::jsonb
    and (p_new->>'published_at')::timestamptz = receipt.executed_at
    and (p_new->>'last_verified_at')::timestamptz = receipt.executed_at
    and p_new->'remote_resources' =
      sellerpilot_private.ebay_narangd_offer_repair_remote_resources(receipt.id),
    false
  );
exception when others then return false;
end $$;

do $patch_listing_guards$
declare
  signature text;
  definition text;
  position integer;
  branch text := E'\n  if nullif(current_setting(''sellerpilot.ebay_narangd_offer_repair_receipt'', true), '''') is not null then\n    if sellerpilot_private.ebay_narangd_offer_repair_projection_allowed(to_jsonb(old), to_jsonb(new), current_setting(''sellerpilot.ebay_narangd_offer_repair_receipt'', true)) is not true then\n      raise exception ''invalid exact eBay Narangd repair projection'' using errcode = ''55000'';\n    end if;\n    return new;\n  end if;\n';
begin
  foreach signature in array array[
    'sellerpilot_private.guard_immutable_ebay_offer_identity()',
    'sellerpilot_private.guard_product_listing_seller_lineage()',
    'sellerpilot_private.guard_verified_ebay_listing_sku_recovery()'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into strict definition;
    if strpos(definition, 'sellerpilot.ebay_narangd_offer_repair_receipt') > 0 then
      raise exception 'EBAY_NARANGD_REPAIR_GUARD_ALREADY_PATCHED:%', signature;
    end if;
    position := strpos(lower(definition), 'begin');
    if position = 0 then
      raise exception 'EBAY_NARANGD_REPAIR_GUARD_PREIMAGE_INVALID:%', signature;
    end if;
    definition := substr(definition, 1, position + 4) || branch || substr(definition, position + 5);
    execute definition;
  end loop;
end $patch_listing_guards$;

create function public.sellerpilot_service_reconcile_ebay_narangd_offer_repair(
  p_verified_receipt_digest text,
  p_receipt_file_sha256 text,
  p_expected_listing_md5 text,
  p_expected_job_md5 text,
  p_expected_attempt_md5 text,
  p_expected_product_md5 text
) returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '25s' as $$
declare
  listing sellerpilot_private.product_listings%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  receipt sellerpilot_private.ebay_narangd_offer_repair_receipts%rowtype;
  source_steps jsonb;
  resources jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_verified_receipt_digest <> '2267faf785338ba10317e11565076cbe347cebb324d44ceb3cde272de5421fb8'
     or p_receipt_file_sha256 <> '2a5d145af53f26299e7837ee01da0815a27d11349d3aa0abd0eda4ea4bad1b2a'
     or coalesce(p_expected_listing_md5, '') !~ '^[a-f0-9]{32}$'
     or coalesce(p_expected_job_md5, '') !~ '^[a-f0-9]{32}$'
     or coalesce(p_expected_attempt_md5, '') !~ '^[a-f0-9]{32}$'
     or coalesce(p_expected_product_md5, '') !~ '^[a-f0-9]{32}$' then
    raise exception 'EBAY_NARANGD_REPAIR_EXPECTATION_REQUIRED' using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select * into listing from sellerpilot_private.product_listings
   where id = 'b66bdb38-a9e2-4883-a147-5122659eec88' for update;
  select * into source_job from sellerpilot_private.channel_gateway_jobs
   where id = '81f79abf-ed3f-44cd-a445-fe76e2dcba65' for share;
  select * into source_attempt from sellerpilot_private.channel_operation_attempts
   where id = '51ccc22f-36d3-4032-9125-d712cdb59f46' for share;
  select * into product from sellerpilot_private.products
   where id = 'c0bdb493-6447-41bf-af0a-46a3da7a75a8' for share;
  select * into credential from sellerpilot_private.channel_credentials
   where id = '374cd5d4-89dc-402b-bed4-067d4dbbe836' for share;
  select * into receipt from sellerpilot_private.ebay_narangd_offer_repair_receipts
   where listing_id = listing.id;

  if receipt.id is not null then
    resources := sellerpilot_private.ebay_narangd_offer_repair_remote_resources(receipt.id);
    if receipt.verified_receipt_digest = p_verified_receipt_digest
       and receipt.receipt_file_sha256 = p_receipt_file_sha256
       and to_jsonb(source_job) = receipt.source_job_before
       and to_jsonb(source_attempt) = receipt.source_attempt_before
       and to_jsonb(product) = receipt.product_before
       and listing.remote_id = receipt.remote_listing_id
       and listing.status = 'published'
       and listing.marketplace_sku = receipt.marketplace_sku
       and listing.provider_resource_id = receipt.offer_id
       and listing.seller_account_key = receipt.seller_account_key
       and listing.remote_visibility = 'live'
       and listing.provider_status = 'ACTIVE'
       and listing.remote_resources = resources then
      return jsonb_build_object('status','already_reconciled','listingId',listing.id,
        'remoteId',listing.remote_id,'offerId',listing.provider_resource_id,
        'receiptId',receipt.id);
    end if;
    raise exception 'EBAY_NARANGD_REPAIR_REPLAY_DRIFT' using errcode = '55000';
  end if;

  source_steps := source_job.response_payload->'steps';
  if listing.id is null or source_job.id is null or source_attempt.id is null
     or product.id is null or credential.id is null
     or md5(to_jsonb(listing)::text) <> p_expected_listing_md5
     or md5(to_jsonb(source_job)::text) <> p_expected_job_md5
     or md5(to_jsonb(source_attempt)::text) <> p_expected_attempt_md5
     or md5(to_jsonb(product)::text) <> p_expected_product_md5
     or listing.product_id <> product.id
     or listing.owner_id <> product.owner_id
     or listing.channel_key <> 'ebay' or listing.market <> 'US'
     or listing.target_id <> 'EBAY_US' or listing.status <> 'failed'
     or listing.remote_id <> '265437447011'
     or listing.operation_attempt_id <> source_attempt.id
     or listing.marketplace_sku is not null or listing.provider_resource_id is not null
     or listing.remote_resources <> '{}'::jsonb
     or listing.remote_visibility <> 'unknown' or listing.provider_status is not null
     or listing.published_at is not null or listing.seller_account_key is not null
     or listing.failure_class <> 'external_action'
     or listing.requested_publication_intent <> 'live'
     or source_job.listing_id <> listing.id or source_job.attempt_id <> source_attempt.id
     or source_job.channel <> 'ebay' or source_job.operation <> 'listing.create'
     or source_job.environment <> 'production' or source_job.status <> 'reconciliation_required'
     or source_job.provider_mutation_started_at is null
     or source_job.seller_account_key is null
     or source_job.request_payload#>>'{arguments,sku}' <> 'AUTO-00BF58A2E8434FF09667-US'
     or source_job.request_payload#>>'{arguments,offer,marketplaceId}' <> 'EBAY_US'
     or source_job.request_payload#>>'{arguments,offer,categoryId}' <> '179188'
     or source_attempt.channel <> 'ebay' or source_attempt.operation <> 'listing.create'
     or source_attempt.status <> 'manual_required'
     or source_attempt.owner_id <> listing.owner_id
     or source_attempt.credential_id <> source_job.credential_id
     or source_attempt.remote_id <> '265437447011'
     or source_attempt.request_fingerprint <> source_job.request_fingerprint
     or source_attempt.seller_account_key <> source_job.seller_account_key
     or credential.channel <> 'ebay' or credential.environment <> 'production'
     or credential.status <> 'active'
     or credential.expires_at <= clock_timestamp()
     or credential.seller_account_key <> source_job.seller_account_key
     or credential.seller_account_key_source <> 'provider_certified_v1'
     or credential.seller_account_verified_at is null
     or not exists (select 1 from sellerpilot_private.admin_users a where a.user_id = listing.owner_id)
     or not exists (select 1 from sellerpilot_private.admin_users a where a.user_id = source_job.created_by)
     or not exists (select 1 from sellerpilot_private.admin_users a where a.user_id = credential.created_by)
     or jsonb_typeof(source_steps) <> 'array' or jsonb_array_length(source_steps) <> 8
     or source_steps#>>'{3,name}' <> 'inventory-item' or source_steps#>'{3,status}' <> '204'::jsonb
     or source_steps#>>'{5,name}' <> 'offer' or source_steps#>'{5,status}' <> '201'::jsonb
     or source_steps#>>'{5,data,offerId}' <> '265437447011'
     or source_steps#>>'{6,name}' <> 'offer-detail-image-readback'
     or source_steps#>'{6,status}' <> '200'::jsonb
     or source_steps#>>'{6,data,offerId}' <> '265437447011'
     or source_steps#>>'{6,data,sku}' <> 'AUTO-00BF58A2E8434FF09667-US'
     or source_steps#>>'{6,data,status}' <> 'UNPUBLISHED'
     or source_steps#>>'{7,name}' <> 'publish' or source_steps#>'{7,status}' <> '400'::jsonb
     or source_steps#>'{7,data,errors,0,errorId}' <> '25002'::jsonb
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs pending
       where pending.listing_id = listing.id and pending.id <> source_job.id
         and pending.status in ('queued','running','reconciliation_required')
     )
     or exists (
       select 1 from sellerpilot_private.provider_listing_lineage_attestations prior
       where prior.listing_id = listing.id
     ) then
    raise exception 'EBAY_NARANGD_REPAIR_EVIDENCE_MISMATCH' using errcode = '55000';
  end if;

  insert into sellerpilot_private.ebay_narangd_offer_repair_receipts (
    listing_id,product_id,source_job_id,source_attempt_id,credential_id,
    seller_account_key,remote_listing_id,offer_id,marketplace_sku,marketplace_id,
    offer_status,listing_status,inventory_put_status,publish_status,
    inventory_readback_status,offer_readback_status,verified_receipt_digest,
    receipt_file_sha256,original_evidence_digest,preflight_digest,
    corrected_inventory_digest,final_offer_digest,executed_at,
    listing_before,source_job_before,source_attempt_before,product_before
  ) values (
    listing.id,product.id,source_job.id,source_attempt.id,credential.id,
    credential.seller_account_key,'800659240462','265437447011',
    'AUTO-00BF58A2E8434FF09667-US','EBAY_US','PUBLISHED','ACTIVE',204,200,200,200,
    p_verified_receipt_digest,p_receipt_file_sha256,
    '7259e79504b3c67ad07ef0afa72e085c262b0042596475bb061d2088069cc2e7',
    '0ef831995cfea8a7c617954ebaaad2f4ae06d1de84e525466e0e4228a7f4810d',
    '81071501065d771278b9e038a0a5a77c03db18648f6edbd27949cd385308b64e',
    'a59a00b6432e0be14d23dfb0829850f060491f85e1bf97f65705b3dfc08efe4b',
    '2026-09-14 06:46:46.951+00'::timestamptz,
    to_jsonb(listing),to_jsonb(source_job),to_jsonb(source_attempt),to_jsonb(product)
  ) returning * into receipt;

  resources := sellerpilot_private.ebay_narangd_offer_repair_remote_resources(receipt.id);
  perform pg_catalog.set_config('sellerpilot.ebay_narangd_offer_repair_receipt', receipt.id::text, true);
  update sellerpilot_private.product_listings l
     set remote_id = receipt.remote_listing_id,
         status = 'published',
         marketplace_sku = receipt.marketplace_sku,
         provider_resource_id = receipt.offer_id,
         seller_account_key = receipt.seller_account_key,
         remote_resources = resources,
         remote_visibility = 'live',
         provider_status = 'ACTIVE',
         published_at = receipt.executed_at,
         last_verified_at = receipt.executed_at,
         last_error = null,
         failure_class = null,
         updated_at = clock_timestamp()
   where l.id = listing.id;
  if not found
     or to_jsonb(source_job) <> (select to_jsonb(j) from sellerpilot_private.channel_gateway_jobs j where j.id = source_job.id)
     or to_jsonb(source_attempt) <> (select to_jsonb(a) from sellerpilot_private.channel_operation_attempts a where a.id = source_attempt.id)
     or to_jsonb(product) <> (select to_jsonb(p) from sellerpilot_private.products p where p.id = product.id) then
    raise exception 'EBAY_NARANGD_REPAIR_HISTORY_CHANGED' using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
  values (listing.owner_id,'ebay_narangd_offer_repair_reconciled','product_listing',listing.id::text,
    jsonb_build_object('sourceJobId',source_job.id,'sourceAttemptId',source_attempt.id,
      'remoteId',receipt.remote_listing_id,'offerId',receipt.offer_id,
      'marketplaceSku',receipt.marketplace_sku,'marketplaceId',receipt.marketplace_id,
      'providerStatus',receipt.listing_status,'offerStatus',receipt.offer_status,
      'verifiedReceiptDigest',receipt.verified_receipt_digest,
      'receiptFileSha256',receipt.receipt_file_sha256,
      'providerLiveVerified',true,'buyerVisibleVerified',false,
      'providerMutationPerformed',true));
  return jsonb_build_object('status','reconciled','listingId',listing.id,
    'remoteId',receipt.remote_listing_id,'offerId',receipt.offer_id,
    'receiptId',receipt.id);
end $$;

revoke all on function public.sellerpilot_service_reconcile_ebay_narangd_offer_repair(
  text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reconcile_ebay_narangd_offer_repair(
  text,text,text,text,text,text
) to service_role;

notify pgrst, 'reload schema';
commit;
