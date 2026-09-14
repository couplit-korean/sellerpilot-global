-- Repair only a request SKU falsely projected as a remote listing ID after an
-- exact Inventory API description rejection. No job retry/provider call and
-- no change to the immutable real-offer or general remote-identity fences.
begin;
set local lock_timeout='5s';
set local statement_timeout='25s';
do $guards$
declare r record;
begin
 for r in select * from(values
 ('sellerpilot_private.guard_immutable_ebay_offer_identity()','3d0b5fee29130c9f067870b7606d1c8f'),
 ('sellerpilot_private.guard_product_listing_seller_lineage()','38e1a8cf1ece02889810c2a6da2696d0'),
 ('sellerpilot_private.guard_verified_ebay_listing_sku_recovery()','b1b18c0e2699cb783f4c5e7d278efa25')
 ) x(signature,hash) loop
 if (select md5(prosrc) from pg_proc where oid=r.signature::regprocedure) is distinct from r.hash
 then raise exception 'EBAY_REJECTED_INVENTORY_GUARD_DRIFT:%',r.signature;end if;
 end loop;
end $guards$;

create table sellerpilot_private.ebay_rejected_inventory_identity_receipts(
 job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
 listing_id uuid not null references sellerpilot_private.product_listings(id),
 listing_before jsonb not null,job_before jsonb not null,attempt_before jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.ebay_rejected_inventory_identity_receipts enable row level security;
revoke all on sellerpilot_private.ebay_rejected_inventory_identity_receipts from public,anon,authenticated,service_role;

create function public.sellerpilot_service_correct_ebay_rejected_inventory_identity(
 p_listing_id uuid,p_job_id uuid,p_expected_listing_md5 text,p_expected_job_md5 text,p_expected_attempt_md5 text
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='25s' as $body$
declare l sellerpilot_private.product_listings%rowtype;
 j sellerpilot_private.channel_gateway_jobs%rowtype;
 a sellerpilot_private.channel_operation_attempts%rowtype;
 receipt sellerpilot_private.ebay_rejected_inventory_identity_receipts%rowtype;
 steps jsonb;sku text;
begin
 if not sellerpilot_private.request_has_unambiguous_service_role_claim()
 then raise exception 'service role required' using errcode='42501';end if;
 if coalesce(p_expected_listing_md5,'')!~'^[a-f0-9]{32}$'
 or coalesce(p_expected_job_md5,'')!~'^[a-f0-9]{32}$' or coalesce(p_expected_attempt_md5,'')!~'^[a-f0-9]{32}$'
 then raise exception 'EBAY_REJECTED_INVENTORY_EXPECTATION_REQUIRED';end if;
 perform pg_advisory_xact_lock(193674993,821065042);
 select * into l from sellerpilot_private.product_listings where id=p_listing_id for update;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job_id for share;
 select * into a from sellerpilot_private.channel_operation_attempts where id=j.attempt_id for share;
 select * into receipt from sellerpilot_private.ebay_rejected_inventory_identity_receipts where job_id=p_job_id;
 if receipt.job_id is not null then
  if receipt.listing_id is distinct from p_listing_id
  or md5(receipt.listing_before::text) is distinct from p_expected_listing_md5
  or md5(receipt.job_before::text) is distinct from p_expected_job_md5
  or md5(receipt.attempt_before::text) is distinct from p_expected_attempt_md5
  or to_jsonb(j) is distinct from receipt.job_before or to_jsonb(a) is distinct from receipt.attempt_before
  or to_jsonb(l) is distinct from (receipt.listing_before||jsonb_build_object('remote_id',null))
  then raise exception 'EBAY_REJECTED_INVENTORY_REPLAY_DRIFT';end if;
  return jsonb_build_object('status','already_corrected','listingId',l.id,'sourceJobId',j.id);
 end if;
 steps:=j.response_payload->'steps';sku:=nullif(btrim(j.request_payload#>>'{arguments,sku}'),'');
 if l.id is null or j.id is null or a.id is null
 or md5(to_jsonb(l)::text) is distinct from p_expected_listing_md5
 or md5(to_jsonb(j)::text) is distinct from p_expected_job_md5
 or md5(to_jsonb(a)::text) is distinct from p_expected_attempt_md5
 or l.channel_key is distinct from 'ebay' or l.status is distinct from 'failed'
 or l.operation_attempt_id is distinct from a.id or j.listing_id is distinct from l.id
 or j.channel is distinct from 'ebay' or j.operation is distinct from 'listing.create' or j.environment is distinct from 'production'
 or j.status is distinct from 'succeeded' or j.response_payload->'ok' is distinct from 'false'::jsonb
 or a.channel is distinct from 'ebay' or a.operation is distinct from 'listing.create' or a.status is distinct from 'failed'
 or a.owner_id is distinct from l.owner_id or a.credential_id is distinct from j.credential_id
 or a.request_fingerprint is distinct from j.request_fingerprint
 or sku is null or l.remote_id is distinct from sku or a.remote_id is distinct from sku or j.response_payload->>'remoteId' is distinct from sku
 or l.provider_resource_id is not null or l.marketplace_sku is not null
 or l.published_at is not null or l.public_url is not null or l.remote_created_at is not null or l.last_verified_at is not null
 or l.remote_resources is distinct from '{}'::jsonb or l.remote_visibility is distinct from 'unknown'
 or not exists(select 1 from sellerpilot_private.channel_credentials c where c.id=j.credential_id and c.channel='ebay'
 and c.environment='production' and c.seller_account_key=j.seller_account_key and c.seller_account_key=a.seller_account_key
 and (l.seller_account_key is null or l.seller_account_key=c.seller_account_key)
 and c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null
 and exists(select 1 from sellerpilot_private.admin_users where user_id=c.created_by))
 or not exists(select 1 from sellerpilot_private.admin_users where user_id=l.owner_id)
 or not exists(select 1 from sellerpilot_private.admin_users where user_id=j.created_by)
 or jsonb_typeof(steps) is distinct from 'array' or jsonb_array_length(steps)<>4
 or steps#>>'{0,name}' is distinct from 'listing-create-configuration-preflight' or steps#>'{0,ok}' is distinct from 'true'::jsonb
 or steps#>'{0,status}' is distinct from '200'::jsonb
 or steps#>>'{1,name}' is distinct from 'inventory-create-lineage-preflight' or steps#>'{1,ok}' is distinct from 'true'::jsonb
 or not coalesce(steps#>'{1,status}' in('400'::jsonb,'404'::jsonb),false)
 or steps#>>'{1,data,code}' is distinct from 'EBAY_INVENTORY_AND_OFFER_ABSENT' or steps#>'{1,data,inventoryPresent}' is distinct from 'false'::jsonb
 or steps#>>'{2,name}' is distinct from 'offer-create-lineage-preflight' or steps#>'{2,ok}' is distinct from 'true'::jsonb
 or not coalesce(steps#>'{2,status}' in('200'::jsonb,'404'::jsonb),false)
 or steps#>>'{2,data,code}' is distinct from 'EBAY_INVENTORY_AND_OFFER_ABSENT' or steps#>'{2,data,exactOfferId}' is distinct from 'null'::jsonb
 or steps#>>'{3,name}' is distinct from 'inventory-item' or steps#>'{3,ok}' is distinct from 'false'::jsonb or steps#>'{3,status}' is distinct from '400'::jsonb
 or jsonb_typeof(steps#>'{3,data,errors}') is distinct from 'array' or jsonb_array_length(steps#>'{3,data,errors}')<>1
 or steps#>'{3,data,errors,0,errorId}' is distinct from '25718'::jsonb
 or steps#>>'{3,data,errors,0,domain}' is distinct from 'API_INVENTORY' or steps#>>'{3,data,errors,0,category}' is distinct from 'Request'
 or jsonb_typeof(steps#>'{3,data,errors,0,parameters}') is distinct from 'array'
 or not exists(select 1 from jsonb_array_elements(steps#>'{3,data,errors,0,parameters}') parameter where parameter->>'name'='description')
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs pending where pending.listing_id=l.id and pending.id<>j.id and pending.status in('queued','running','reconciliation_required'))
 -- A prior remote write/attestation could own the same apparent identifier.
 -- This correction is limited to the first definitively rejected CREATE.
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs prior where prior.listing_id=l.id and prior.id<>j.id and prior.operation in('listing.create','listing.update','listing.stop','listing.activate'))
 or exists(select 1 from sellerpilot_private.provider_listing_lineage_attestations prior where prior.listing_id=l.id)
 then raise exception 'EBAY_REJECTED_INVENTORY_EVIDENCE_MISMATCH';end if;
 insert into sellerpilot_private.ebay_rejected_inventory_identity_receipts(job_id,listing_id,listing_before,job_before,attempt_before)
 values(j.id,l.id,to_jsonb(l),to_jsonb(j),to_jsonb(a));
 update sellerpilot_private.product_listings set remote_id=null where id=l.id;
 if (select to_jsonb(x) from sellerpilot_private.product_listings x where id=l.id) is distinct from (to_jsonb(l)||jsonb_build_object('remote_id',null))
 or (select to_jsonb(x) from sellerpilot_private.channel_gateway_jobs x where id=j.id) is distinct from to_jsonb(j)
 or (select to_jsonb(x) from sellerpilot_private.channel_operation_attempts x where id=a.id) is distinct from to_jsonb(a)
 then raise exception 'EBAY_REJECTED_INVENTORY_HISTORY_CHANGED';end if;
 insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
 values(l.owner_id,'ebay_rejected_inventory_identity_corrected','product_listing',l.id::text,jsonb_build_object('sourceJobId',j.id,'attemptId',a.id,'providerCode',25718,'inventoryAndOfferAbsent',true,'providerWritePerformed',false,'jobCreated',false));
 return jsonb_build_object('status','corrected','listingId',l.id,'sourceJobId',j.id);
end $body$;
revoke all on function public.sellerpilot_service_correct_ebay_rejected_inventory_identity(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_correct_ebay_rejected_inventory_identity(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
