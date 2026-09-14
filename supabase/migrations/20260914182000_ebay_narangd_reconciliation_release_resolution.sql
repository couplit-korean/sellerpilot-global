-- Treat the immutable, verified eBay Narangd repair receipt as resolution of
-- the original uncertain CREATE fence. The source job remains
-- reconciliation_required; only standard release/readiness predicates stop
-- counting that one already-resolved mutation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $preimage$
begin
  if to_regclass('sellerpilot_private.ebay_narangd_offer_repair_receipts') is null
     or to_regprocedure('sellerpilot_private.ebay_narangd_offer_repair_remote_resources(uuid)') is null then
    raise exception 'EBAY_NARANGD_REPAIR_RECEIPT_CONTRACT_MISSING' using errcode = '55000';
  end if;
  if (select md5(p.prosrc) from pg_proc p
      where p.oid = 'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure)
       is distinct from '36929a92795ac77eac6984c76fa762de' then
    raise exception 'EBAY_NARANGD_RELEASE_RESOLVER_DRIFT' using errcode = '55000';
  end if;
end $preimage$;

alter function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  rename to listing_mutation_reconciliation_resolved_before_ebay_narangd_repair;

create function sellerpilot_private.listing_mutation_reconciliation_resolved(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_repair(p_job)
    or (
      p_job = '81f79abf-ed3f-44cd-a445-fe76e2dcba65'::uuid
      and exists (
        select 1
        from sellerpilot_private.ebay_narangd_offer_repair_receipts receipt
        join sellerpilot_private.channel_gateway_jobs source_job
          on source_job.id = receipt.source_job_id
        join sellerpilot_private.channel_operation_attempts source_attempt
          on source_attempt.id = receipt.source_attempt_id
        join sellerpilot_private.products product
          on product.id = receipt.product_id
        join sellerpilot_private.product_listings listing
          on listing.id = receipt.listing_id
        where receipt.source_job_id = p_job
          and receipt.listing_id = 'b66bdb38-a9e2-4883-a147-5122659eec88'::uuid
          and receipt.product_id = 'c0bdb493-6447-41bf-af0a-46a3da7a75a8'::uuid
          and receipt.source_attempt_id = '51ccc22f-36d3-4032-9125-d712cdb59f46'::uuid
          and receipt.remote_listing_id = '800659240462'
          and receipt.offer_id = '265437447011'
          and receipt.marketplace_sku = 'AUTO-00BF58A2E8434FF09667-US'
          and receipt.marketplace_id = 'EBAY_US'
          and receipt.offer_status = 'PUBLISHED'
          and receipt.listing_status = 'ACTIVE'
          and receipt.inventory_put_status = 204
          and receipt.publish_status = 200
          and receipt.inventory_readback_status = 200
          and receipt.offer_readback_status = 200
          and receipt.verified_receipt_digest =
            '2267faf785338ba10317e11565076cbe347cebb324d44ceb3cde272de5421fb8'
          and receipt.receipt_file_sha256 =
            '2a5d145af53f26299e7837ee01da0815a27d11349d3aa0abd0eda4ea4bad1b2a'
          and receipt.provider_mutation_performed
          and not receipt.buyer_visible_verified
          and to_jsonb(source_job) = receipt.source_job_before
          and to_jsonb(source_attempt) = receipt.source_attempt_before
          and source_job.status = 'reconciliation_required'
          and source_job.channel = 'ebay'
          and source_job.operation = 'listing.create'
          and source_job.provider_mutation_started_at is not null
          and source_attempt.status = 'manual_required'
          and source_attempt.channel = 'ebay'
          and source_attempt.operation = 'listing.create'
          and product.owner_id = listing.owner_id
          and product.sku = 'AUTO-00BF58A2E8434FF09667'
          and source_attempt.owner_id = listing.owner_id
          and listing.product_id = receipt.product_id
          and listing.operation_attempt_id = receipt.source_attempt_id
          and listing.channel_key = 'ebay'
          and listing.remote_id = receipt.remote_listing_id
          and listing.marketplace_sku = receipt.marketplace_sku
          and listing.provider_resource_id = receipt.offer_id
          and listing.seller_account_key = receipt.seller_account_key
      )
    )
$$;

revoke all on function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.listing_mutation_reconciliation_resolved_before_ebay_narangd_repair(uuid)
  from public, anon, authenticated, service_role;

commit;
