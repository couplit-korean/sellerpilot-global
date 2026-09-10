-- Reconcile one already-created Coupang seller product with authoritative GETs.
-- The source create job and attempt remain terminal and immutable. This lane can
-- enqueue only listing.publication.verify and can never acquire a write fence.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local timezone='UTC';

create table sellerpilot_private.coupang_exact_live_verify_runs(
  verifier_job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_job_id uuid not null unique check(source_job_id='25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid),
  source_attempt_id uuid not null check(source_attempt_id='d771421b-f408-4f75-addd-03879393fab8'::uuid),
  listing_id uuid not null check(listing_id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid),
  remote_id text not null check(remote_id='16375780938'),
  source_job_sha256 text not null check(source_job_sha256~'^[a-f0-9]{64}$'),
  source_attempt_sha256 text not null check(source_attempt_sha256~'^[a-f0-9]{64}$'),
  source_listing_sha256 text not null check(source_listing_sha256~'^[a-f0-9]{64}$'),
  queued_at timestamptz not null default clock_timestamp()
);
create table sellerpilot_private.coupang_exact_live_verify_receipts(
  verifier_job_id uuid primary key references sellerpilot_private.coupang_exact_live_verify_runs(verifier_job_id) on delete restrict,
  source_job_id uuid not null unique check(source_job_id='25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid),
  source_attempt_id uuid not null check(source_attempt_id='d771421b-f408-4f75-addd-03879393fab8'::uuid),
  listing_id uuid not null unique check(listing_id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid),
  remote_id text not null check(remote_id='16375780938'),
  response_sha256 text not null check(response_sha256~'^[a-f0-9]{64}$'),
  seller_product_verified boolean not null check(seller_product_verified),
  all_vendor_items_on_sale boolean not null check(all_vendor_items_on_sale),
  exact_content_verified boolean not null check(exact_content_verified),
  exact_eight_images_verified boolean not null check(exact_eight_images_verified),
  vendor_item_ids jsonb not null check(jsonb_typeof(vendor_item_ids)='array' and jsonb_array_length(vendor_item_ids)>0),
  provider_live_verified boolean not null check(provider_live_verified),
  buyer_visible_verified boolean not null default false check(not buyer_visible_verified),
  provider_mutation_performed boolean not null default false check(not provider_mutation_performed),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.coupang_exact_live_verify_runs enable row level security;
alter table sellerpilot_private.coupang_exact_live_verify_receipts enable row level security;
revoke all on sellerpilot_private.coupang_exact_live_verify_runs,sellerpilot_private.coupang_exact_live_verify_receipts from public,anon,authenticated,service_role;

create function sellerpilot_private.coupang_exact_live_rows_immutable()returns trigger language plpgsql set search_path='' as $$
begin raise exception 'exact Coupang reconciliation evidence is immutable' using errcode='55000';end$$;
create trigger coupang_exact_live_runs_immutable before update or delete on sellerpilot_private.coupang_exact_live_verify_runs for each row execute function sellerpilot_private.coupang_exact_live_rows_immutable();
create trigger coupang_exact_live_receipts_immutable before update or delete on sellerpilot_private.coupang_exact_live_verify_receipts for each row execute function sellerpilot_private.coupang_exact_live_rows_immutable();

create function sellerpilot_private.coupang_exact_live_source_immutable()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_table_name='channel_gateway_jobs' and old.id='25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid)
    or (tg_table_name='channel_operation_attempts' and old.id='d771421b-f408-4f75-addd-03879393fab8'::uuid)
 then raise exception 'exact Coupang source evidence is immutable' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger coupang_exact_live_source_job_immutable before update or delete on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.coupang_exact_live_source_immutable();
create trigger coupang_exact_live_source_attempt_immutable before update or delete on sellerpilot_private.channel_operation_attempts for each row when(old.id='d771421b-f408-4f75-addd-03879393fab8'::uuid) execute function sellerpilot_private.coupang_exact_live_source_immutable();

create function sellerpilot_private.coupang_exact_live_source_current()returns boolean language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;a sellerpilot_private.channel_operation_attempts%rowtype;l sellerpilot_private.product_listings%rowtype; readback jsonb;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id='25adf712-1e9a-432b-8b0d-09cf35a826c5';
 select * into a from sellerpilot_private.channel_operation_attempts where id='d771421b-f408-4f75-addd-03879393fab8';
 select * into l from sellerpilot_private.product_listings where id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4';
 select x into readback from jsonb_array_elements(coalesce(j.response_payload->'steps','[]'))with ordinality q(x,n) where x->>'name'='listing-approval-readback' order by n desc limit 1;
 return j.id is not null and a.id is not null and l.id is not null
  and j.attempt_id=a.id and j.listing_id=l.id and j.channel='coupang' and j.operation='listing.create' and j.environment='production'
  and j.status='reconciliation_required' and j.provider_mutation_started_at is not null and j.response_payload->>'remoteId'='16375780938'
  and a.id='d771421b-f408-4f75-addd-03879393fab8' and a.owner_id=j.created_by and a.credential_id=j.credential_id
  and a.channel='coupang' and a.operation='listing.create' and a.status='manual_required'
  and a.remote_id='16375780938' and a.request_fingerprint=j.request_fingerprint and a.seller_account_key=j.seller_account_key
  and l.channel_key='coupang' and l.product_id='1ed4acfc-7603-48ec-a638-241131e59358' and l.owner_id=a.owner_id
  and l.operation_attempt_id=a.id and l.status='failed' and l.failure_class='external_action'
  and l.requested_publication_intent='live' and l.remote_visibility='unknown'
  and l.marketplace_sku is null and l.seller_account_key is null
  and l.remote_id='16375780938' and j.request_fingerprint~'^[a-f0-9]{64}$'
  and jsonb_array_length(j.request_payload#>'{arguments,body,items}')>0
  and not exists(select 1 from jsonb_array_elements(j.request_payload#>'{arguments,body,items}')item where item->>'externalVendorSku'<>'AUTO-780720401E2D4E4EA45F' or item->>'salePrice'<>'3190' or item->>'maximumBuyCount'<>'1')
  and j.request_payload#>>'{arguments,publicationExpectedFingerprint}'=j.request_fingerprint
  and j.request_payload#>>'{arguments,publicationIntent}'='live'
  and j.request_payload#>>'{arguments,publicationStateContract}'='verified_remote_state_v1'
  and j.request_payload#>>'{arguments,publicationExpectedLocale}'='ko-KR'
  and j.request_payload#>>'{arguments,publicationExpectedImageCount}'='8'
  and jsonb_typeof(j.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}')='object'
  and readback->>'status'~'^2[0-9][0-9]$' and readback#>>'{data,code}'='SUCCESS'
  and readback#>>'{data,data,sellerProductId}'='16375780938'
  and jsonb_array_length(readback#>'{data,data,items}')>0
  and not exists(select 1 from jsonb_array_elements(readback#>'{data,data,items}')item where coalesce(item->>'vendorItemId','')='' or (select count(*) from jsonb_array_elements(item->'contents')content cross join lateral jsonb_array_elements(content->'contentDetails')detail where upper(detail->>'detailType')='IMAGE' and coalesce(detail->>'content','')<>'')<>8);
exception when others then return false;end$$;

create function public.sellerpilot_service_enqueue_exact_coupang_live_verifier()returns uuid language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;a sellerpilot_private.channel_operation_attempts%rowtype;l sellerpilot_private.product_listings%rowtype;v uuid;args jsonb;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(1637578093,8072038);
 select * into j from sellerpilot_private.channel_gateway_jobs where id='25adf712-1e9a-432b-8b0d-09cf35a826c5' for update;
 select * into a from sellerpilot_private.channel_operation_attempts where id='d771421b-f408-4f75-addd-03879393fab8' for update;
 select * into l from sellerpilot_private.product_listings where id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4' for update;
 if sellerpilot_private.coupang_exact_live_source_current() is not true then raise exception 'exact Coupang source evidence drifted' using errcode='55000';end if;
 select verifier_job_id into v from sellerpilot_private.coupang_exact_live_verify_runs; if v is not null then return v;end if;
 v:=gen_random_uuid();
 args:=jsonb_build_object('publicationReviewSourceJobId',j.id,'sellerpilotReadOnly',true,'sellerpilotCoupangExactLiveReconciliation','coupang_exact_live_get_only_v1','remoteId','16375780938','market',l.market,'targetId',l.target_id,'publicationIntent','live','publicationStateContract','verified_remote_state_v1','publicationExpectedLocale','ko-KR','publicationExpectedFingerprint',j.request_fingerprint,'publicationExpectedImageCount',8);
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,attempt_id,listing_id,channel,operation,environment,request_payload,status,seller_account_key,request_fingerprint,created_by,created_at,updated_at)
 values(v,j.credential_id,null,j.listing_id,'coupang','listing.publication.verify','production',jsonb_build_object('periodicKey','coupang-exact-live:'||j.id,'arguments',args),'queued',j.seller_account_key,j.request_fingerprint,j.created_by,clock_timestamp(),clock_timestamp());
 insert into sellerpilot_private.coupang_exact_live_verify_runs values(v,j.id,a.id,l.id,'16375780938',encode(extensions.digest(to_jsonb(j)::text,'sha256'),'hex'),encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex'),encode(extensions.digest(to_jsonb(l)::text,'sha256'),'hex'),clock_timestamp());
 return v;
end$$;
revoke all on function public.sellerpilot_service_enqueue_exact_coupang_live_verifier() from public,anon,authenticated;
grant execute on function public.sellerpilot_service_enqueue_exact_coupang_live_verifier() to service_role;

-- JSON.stringify-compatible projections used by the TypeScript content verifier.
create function sellerpilot_private.coupang_exact_live_json_array(p_values jsonb)returns text language sql immutable set search_path='' as $$
 select '['||coalesce(string_agg(to_jsonb(btrim(value))::text,',' order by n),'')||']' from jsonb_array_elements_text(p_values)with ordinality q(value,n)
$$;
create function sellerpilot_private.coupang_exact_live_identity_array(p_values jsonb)returns text language sql immutable set search_path='' as $$
 select '['||coalesce(string_agg('{"role":'||to_jsonb(btrim(x->>'role'))::text||case when nullif(btrim(x->>'approvedObjectPath'),'')is null then '' else ',"approvedObjectPath":'||to_jsonb(btrim(x->>'approvedObjectPath'))::text end||case when nullif(btrim(x->>'approvedSourceSha256'),'')is null then '' else ',"approvedSourceSha256":'||to_jsonb(btrim(x->>'approvedSourceSha256'))::text end||',"publicUrl":'||to_jsonb(btrim(x->>'publicUrl'))::text||',"objectPath":'||to_jsonb(btrim(x->>'objectPath'))::text||',"contentSha256":'||to_jsonb(btrim(x->>'contentSha256'))::text||'}',',' order by n),'')||']' from jsonb_array_elements(p_values)with ordinality q(x,n)
$$;
create function sellerpilot_private.coupang_exact_live_asset_digest(p_binding jsonb)returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest('{"contract":'||to_jsonb(btrim(p_binding->>'contract'))::text||',"approvedDetailPageVersion":'||((p_binding->>'approvedDetailPageVersion')::bigint)::text||',"approvedManifestDigest":'||to_jsonb(btrim(p_binding->>'approvedManifestDigest'))::text||',"approvedDetailImages":'||sellerpilot_private.coupang_exact_live_identity_array(p_binding->'approvedDetailImages')||',"providerImageSurface":'||to_jsonb(btrim(p_binding->>'providerImageSurface'))::text||',"providerTransportImages":'||sellerpilot_private.coupang_exact_live_identity_array(p_binding->'providerTransportImages')||'}','sha256'),'hex')
$$;

alter function public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid) rename to sellerpilot_verification_source_before_coupang_exact_live;
create function public.sellerpilot_service_listing_publication_verification_source(p_token_hash text,p_job_id uuid,p_claim_token uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;s sellerpilot_private.channel_gateway_jobs%rowtype;a sellerpilot_private.channel_operation_attempts%rowtype;l sellerpilot_private.product_listings%rowtype;r sellerpilot_private.coupang_exact_live_verify_runs%rowtype;step jsonb;payload jsonb;binding jsonb;ids jsonb;roles jsonb;
begin
 if p_token_hash is null or p_job_id is null or p_claim_token is null or not sellerpilot_private.serverless_cs_job_is_owned(p_token_hash,p_job_id,p_claim_token,true) then raise exception 'publication verification source ownership required' using errcode='42501';end if;
 select * into r from sellerpilot_private.coupang_exact_live_verify_runs where verifier_job_id=p_job_id;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=r.verifier_job_id;
 if j.id is null then return public.sellerpilot_verification_source_before_coupang_exact_live(p_token_hash,p_job_id,p_claim_token);end if;
 select * into s from sellerpilot_private.channel_gateway_jobs where id=r.source_job_id;select * into a from sellerpilot_private.channel_operation_attempts where id=r.source_attempt_id;select * into l from sellerpilot_private.product_listings where id=r.listing_id;
 if j.status<>'running' or j.claim_token is distinct from p_claim_token or j.operation<>'listing.publication.verify' or j.attempt_id is not null or j.provider_mutation_started_at is not null or j.write_resource_kind is not null or j.write_resource_key is not null or j.request_payload#>>'{arguments,sellerpilotReadOnly}'<>'true' or sellerpilot_private.coupang_exact_live_source_current() is not true
  or encode(extensions.digest(to_jsonb(s)::text,'sha256'),'hex')<>r.source_job_sha256 or encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex')<>r.source_attempt_sha256 or encode(extensions.digest(to_jsonb(l)::text,'sha256'),'hex')<>r.source_listing_sha256
 then raise exception 'exact Coupang verifier source unavailable' using errcode='55000';end if;
 select x into step from jsonb_array_elements(s.response_payload->'steps')with ordinality q(x,n) where x->>'name'='listing-approval-readback' order by n desc limit 1;
 binding:=s.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
 select jsonb_agg(x->>'publicUrl' order by n),jsonb_agg(x->>'role' order by n) into ids,roles from jsonb_array_elements(binding->'providerTransportImages')with ordinality q(x,n);
 payload:=s.response_payload||jsonb_build_object('steps',coalesce(s.response_payload->'steps','[]')||jsonb_build_array(jsonb_build_object('name','seller-product-publication-readback','ok',true,'status',(step->>'status')::int,'data',step->'data')),'remoteState',jsonb_build_object('resources',jsonb_build_object('sellerProductId','16375780938','vendorItemIds',(select jsonb_agg(x->>'vendorItemId' order by n)from jsonb_array_elements(step#>'{data,data,items}')with ordinality q(x,n))),'evidence',jsonb_build_object('publicationAssetBinding',jsonb_build_object('contract','sellerpilot_provider_asset_binding_v1','sourceAssetBindingDigest',sellerpilot_private.coupang_exact_live_asset_digest(binding),'approvedManifestDigest',binding->>'approvedManifestDigest','approvedDetailPageVersion',(binding->>'approvedDetailPageVersion')::int,'approvedDetailRoles',(select jsonb_agg(x->>'role' order by n)from jsonb_array_elements(binding->'approvedDetailImages')with ordinality q(x,n)),'providerImageSurface','detail_content','providerTransportRoles',roles,'providerDetailImageIdentities',ids,'providerImageDigest',encode(extensions.digest(sellerpilot_private.coupang_exact_live_json_array(ids),'sha256'),'hex')))));
 return jsonb_build_object('contract','listing_publication_verification_source_v1','verificationJobId',j.id,'sourceJobId',s.id,'sourceOperation',s.operation,'sourceArguments',s.request_payload->'arguments','sourceResponsePayload',payload,'sourceFingerprint',s.request_fingerprint,'expectedRemoteId','16375780938','expectedLocale','ko-KR','expectedImageCount',8,'market',j.request_payload#>>'{arguments,market}','targetId',j.request_payload#>>'{arguments,targetId}');
end$$;
revoke all on function public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid),public.sellerpilot_verification_source_before_coupang_exact_live(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid) to service_role;

create function sellerpilot_private.coupang_exact_live_completion_valid(p_job uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;r sellerpilot_private.coupang_exact_live_verify_runs%rowtype;s sellerpilot_private.channel_gateway_jobs%rowtype;a sellerpilot_private.channel_operation_attempts%rowtype;l sellerpilot_private.product_listings%rowtype;st jsonb;seller_step jsonb;seller_root jsonb;resource_ids jsonb;step_ids jsonb;raw_ids jsonb;resource_count int;resource_distinct int;step_count int;step_distinct int;raw_count int;raw_distinct int;seller_count int;vendor_steps_valid boolean;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job;select * into r from sellerpilot_private.coupang_exact_live_verify_runs where verifier_job_id=p_job;select * into s from sellerpilot_private.channel_gateway_jobs where id=r.source_job_id;select * into a from sellerpilot_private.channel_operation_attempts where id=r.source_attempt_id;select * into l from sellerpilot_private.product_listings where id=r.listing_id;
 if j.id is null or sellerpilot_private.coupang_exact_live_source_current() is not true or encode(extensions.digest(to_jsonb(s)::text,'sha256'),'hex')<>r.source_job_sha256 or encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex')<>r.source_attempt_sha256 or encode(extensions.digest(to_jsonb(l)::text,'sha256'),'hex')<>r.source_listing_sha256 then return false;end if;
 st:=j.response_payload->'remoteState';
 select x,count(*) over() into seller_step,seller_count from jsonb_array_elements(j.response_payload->'steps')x where x->>'name'='seller-product-publication-reverification' limit 1;seller_root:=seller_step#>'{data,data}';
 select jsonb_agg(value order by value),count(*),count(distinct value) into resource_ids,resource_count,resource_distinct from jsonb_array_elements_text(st#>'{resources,vendorItemIds}')q(value);
 select jsonb_agg(id order by id),count(*),count(distinct id),bool_and(valid) into step_ids,step_count,step_distinct,vendor_steps_valid from(select x#>>'{data,sellerpilotVendorItemId}' id,x->>'ok'='true' and x->>'status'~'^2[0-9][0-9]$' and x#>>'{data,code}'='SUCCESS' and x#>>'{data,data,onSale}'='true' and x#>>'{data,data,amountInStock}'='1' and x#>>'{data,data,salePrice}'='3190' valid from jsonb_array_elements(j.response_payload->'steps')x where x->>'name'='vendor-item-publication-reverification')q;
 select jsonb_agg(id order by id),count(*),count(distinct id) into raw_ids,raw_count,raw_distinct from(select x->>'vendorItemId'id from jsonb_array_elements(seller_root->'items')x)q;
 return coalesce(j.status='succeeded' and j.channel='coupang' and j.operation='listing.publication.verify' and j.attempt_id is null and j.provider_mutation_started_at is null and j.write_resource_kind is null and j.write_resource_key is null
  and j.response_payload->>'ok'='true' and j.response_payload->>'remoteId'='16375780938' and j.response_payload->>'publicationFulfilled'='true'
  and st->>'visibility'='live' and st->>'verified'='true' and st->>'locale'='ko-KR' and st->>'fingerprint'=s.request_fingerprint and st->>'imageCount'='8' and st#>>'{resources,sellerProductId}'='16375780938'
  and resource_count>0 and resource_count=resource_distinct and step_count=resource_count and step_distinct=step_count and raw_count=resource_count and raw_distinct=raw_count and resource_ids=step_ids and resource_ids=raw_ids and vendor_steps_valid
  and jsonb_typeof(st#>'{evidence,vendorItemOnSale}')='array' and jsonb_array_length(st#>'{evidence,vendorItemOnSale}')=resource_count and not exists(select 1 from jsonb_array_elements(st#>'{evidence,vendorItemOnSale}')x where x<>'true'::jsonb)
  and jsonb_typeof(st#>'{evidence,detailImageCounts}')='array' and jsonb_array_length(st#>'{evidence,detailImageCounts}')=resource_count and not exists(select 1 from jsonb_array_elements(st#>'{evidence,detailImageCounts}')x where x<>'8'::jsonb)
  and seller_count=1 and seller_step->>'ok'='true' and seller_step->>'status'~'^2[0-9][0-9]$' and seller_step#>>'{data,code}'='SUCCESS' and seller_root->>'sellerProductId'='16375780938'
  and upper(coalesce(seller_root->>'statusName',seller_root->>'approvalStatus',seller_root->>'status',seller_root->>'mdId','')) in('승인완료','부분승인완료','APPROVED','PARTIAL_APPROVED')
  and not exists(select 1 from jsonb_array_elements(seller_root->'items')item where coalesce(item->>'salePrice','')<>'' and item->>'salePrice'<>'3190')
  and not exists(select 1 from jsonb_array_elements(seller_root->'items')item where (select count(*) from jsonb_array_elements(item->'contents')content cross join lateral jsonb_array_elements(content->'contentDetails')detail where upper(detail->>'detailType')='IMAGE' and coalesce(detail->>'content','')<>'')<>8)
  and st#>>'{evidence,sourceJobId}'='25adf712-1e9a-432b-8b0d-09cf35a826c5' and st#>>'{evidence,contentVerified}'='true' and st#>>'{evidence,titleVerified}'='true' and st#>>'{evidence,descriptionVerified}'='true' and st#>>'{evidence,languageContentVerified}'='true' and st#>>'{evidence,approvedManifestDigestVerified}'='true' and st#>>'{evidence,sourceIdentityVerified}'='true' and st#>>'{evidence,contentDigestVerified}'='true'
  and exists(select 1 from jsonb_array_elements(j.response_payload->'steps')x where x->>'name'='publication-content-verification' and x->>'ok'='true' and x#>>'{data,sellerpilotVerification}'='LISTING_PUBLICATION_CONTENT_VERIFIED'),false);
exception when others then return false;end$$;

create function sellerpilot_private.coupang_exact_live_remote_resources(p_job uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'contract','coupang_exact_live_get_only_v1',
   'verificationScope','provider_live_only',
   'providerLiveVerified',true,
   'buyerVisibleVerified',false,
   'resources',job.response_payload#>'{remoteState,resources}',
   'verification',job.response_payload#>'{remoteState,evidence}',
   'verifierJobId',job.id,
   'sourceJobId','25adf712-1e9a-432b-8b0d-09cf35a826c5',
   'responseSha256',encode(extensions.digest(job.response_payload::text,'sha256'),'hex'),
   'providerMutationPerformed',false
 ) from sellerpilot_private.channel_gateway_jobs job where job.id=p_job
$$;

create function public.sellerpilot_service_resolve_exact_coupang_live_verifier(p_job uuid)returns boolean language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;s sellerpilot_private.channel_gateway_jobs%rowtype;a sellerpilot_private.channel_operation_attempts%rowtype;l sellerpilot_private.product_listings%rowtype;r sellerpilot_private.coupang_exact_live_verify_runs%rowtype;receipt sellerpilot_private.coupang_exact_live_verify_receipts%rowtype;response_sha text;resources jsonb;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(1637578093,8072039);
 select * into r from sellerpilot_private.coupang_exact_live_verify_runs where verifier_job_id=p_job for update;if r.verifier_job_id is null then raise exception 'exact Coupang verifier run missing' using errcode='55000';end if;
 select * into s from sellerpilot_private.channel_gateway_jobs where id=r.source_job_id for update;
 select * into a from sellerpilot_private.channel_operation_attempts where id=r.source_attempt_id for update;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=r.verifier_job_id for update;
 select * into l from sellerpilot_private.product_listings where id=r.listing_id for update;
 select * into receipt from sellerpilot_private.coupang_exact_live_verify_receipts where verifier_job_id=p_job for share;
 response_sha:=encode(extensions.digest(j.response_payload::text,'sha256'),'hex');resources:=sellerpilot_private.coupang_exact_live_remote_resources(j.id);
 if receipt.verifier_job_id is not null then
  if receipt.response_sha256=response_sha and receipt.source_job_id=s.id and receipt.source_attempt_id=a.id and receipt.listing_id=l.id and receipt.remote_id='16375780938' and not receipt.provider_mutation_performed and receipt.provider_live_verified and not receipt.buyer_visible_verified
   and encode(extensions.digest(to_jsonb(s)::text,'sha256'),'hex')=r.source_job_sha256 and encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex')=r.source_attempt_sha256
   and l.remote_id='16375780938' and l.status='published' and l.remote_visibility='live' and l.remote_resources=resources
  then return true;end if;
  raise exception 'exact Coupang reconciliation replay drifted' using errcode='55000';
 end if;
 if sellerpilot_private.coupang_exact_live_completion_valid(p_job) is not true then raise exception 'exact Coupang GET verification incomplete' using errcode='55000';end if;
 insert into sellerpilot_private.coupang_exact_live_verify_receipts(verifier_job_id,source_job_id,source_attempt_id,listing_id,remote_id,response_sha256,seller_product_verified,all_vendor_items_on_sale,exact_content_verified,exact_eight_images_verified,vendor_item_ids,provider_live_verified,buyer_visible_verified,provider_mutation_performed,recorded_at)
 values(j.id,s.id,a.id,l.id,'16375780938',response_sha,true,true,true,true,j.response_payload#>'{remoteState,resources,vendorItemIds}',true,false,false,clock_timestamp());
 perform set_config('sellerpilot.coupang_exact_live_reconcile',j.id::text,true);
 update sellerpilot_private.product_listings set remote_id='16375780938',status='published',failure_class=null,remote_visibility='live',provider_status=j.response_payload#>>'{remoteState,providerStatus}',remote_resources=resources,published_at=coalesce(published_at,(j.response_payload#>>'{remoteState,verifiedAt}')::timestamptz),last_verified_at=(j.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,last_error=null,updated_at=clock_timestamp() where id=l.id;
 insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail) values(l.owner_id,'coupang_exact_live_get_reconciled','product_listing',l.id::text,jsonb_build_object('sourceJobId',s.id,'sourceAttemptId',a.id,'verifierJobId',j.id,'remoteId','16375780938','verificationScope','provider_live_only','providerLiveVerified',true,'buyerVisibleVerified',false,'providerMutationPerformed',false,'responseSha256',response_sha));
 return true;
end$$;
revoke all on function public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid) to service_role;

-- Attach resolution to the gateway worker's atomic completion transaction.
-- Any failed exact resolver check raises and rolls the predecessor completion
-- back, leaving the verifier leased/running instead of persisting a false live.
alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_complete_before_coupang_exact_live;
revoke all on function public.sellerpilot_complete_before_coupang_exact_live(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_response_payload jsonb default null,p_error_message text default null,
  p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
)returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;final_status text;
begin
 result:=public.sellerpilot_complete_before_coupang_exact_live(
   p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
   p_error_message,p_credential_refresh,p_normalized_orders,
   p_normalized_inquiries,p_diagnostic
 );
 if result->>'status' in('completed','completed_replay') and exists(
   select 1 from sellerpilot_private.coupang_exact_live_verify_runs run
    where run.verifier_job_id=p_job_id
 ) then
  select job.status into final_status from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  if final_status='succeeded' then perform public.sellerpilot_service_resolve_exact_coupang_live_verifier(p_job_id);end if;
 end if;
 return result;
end$$;
revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

create function sellerpilot_private.coupang_exact_live_listing_update_allowed(p_old jsonb,p_new jsonb,p_job text)returns boolean language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;
begin
 if p_job!~'^[0-9a-f-]{36}$' or p_old->>'id'<>'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4' or p_new->>'id'<>p_old->>'id' or not exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts r where r.verifier_job_id=p_job::uuid and r.listing_id=(p_new->>'id')::uuid and not r.provider_mutation_performed) then return false;end if;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job::uuid;
 return coalesce(sellerpilot_private.coupang_exact_live_completion_valid(j.id)
  and (p_new-array['remote_id','status','failure_class','remote_visibility','provider_status','remote_resources','published_at','last_verified_at','last_error','updated_at'])=(p_old-array['remote_id','status','failure_class','remote_visibility','provider_status','remote_resources','published_at','last_verified_at','last_error','updated_at'])
  and p_new->>'remote_id'='16375780938' and p_new->>'status'='published' and p_new->'failure_class'='null'::jsonb and p_new->>'remote_visibility'='live' and p_new->>'provider_status'=j.response_payload#>>'{remoteState,providerStatus}' and p_new->'remote_resources'=sellerpilot_private.coupang_exact_live_remote_resources(j.id) and p_new->'last_error'='null'::jsonb and p_new->>'published_at' is not null and (p_new->>'last_verified_at')::timestamptz=(j.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,false);
exception when others then return false;end$$;
do $patch$ declare d text;p int;branch text:=E'  if nullif(current_setting(''sellerpilot.coupang_exact_live_reconcile'',true),'''') is not null then\n    if sellerpilot_private.coupang_exact_live_listing_update_allowed(to_jsonb(old),to_jsonb(new),current_setting(''sellerpilot.coupang_exact_live_reconcile'',true)) is not true then raise exception ''invalid exact Coupang listing projection''; end if;\n    return new;\n  end if;\n';begin select pg_get_functiondef('sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure)into strict d;if strpos(d,'coupang_exact_live_reconcile')=0 then p:=strpos(lower(d),'begin');if p=0 then raise exception 'listing guard preimage drifted' using errcode='55000';end if;d:=substr(d,1,p+4)||E'\n'||branch||substr(d,p+5);execute d;end if;end$patch$;

alter function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid) rename to listing_mutation_reconciliation_resolved_before_coupang_exact_live;
create function sellerpilot_private.listing_mutation_reconciliation_resolved(p_job uuid)returns boolean language sql stable security definer set search_path='' as $$select sellerpilot_private.listing_mutation_reconciliation_resolved_before_coupang_exact_live(p_job) or (p_job='25adf712-1e9a-432b-8b0d-09cf35a826c5' and exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts receipt join sellerpilot_private.channel_gateway_jobs verifier on verifier.id=receipt.verifier_job_id join sellerpilot_private.product_listings listing on listing.id=receipt.listing_id where receipt.source_job_id=p_job and receipt.response_sha256=encode(extensions.digest(verifier.response_payload::text,'sha256'),'hex') and receipt.provider_live_verified and not receipt.buyer_visible_verified and not receipt.provider_mutation_performed and listing.remote_id='16375780938' and listing.status='published' and listing.remote_visibility='live' and listing.remote_resources=sellerpilot_private.coupang_exact_live_remote_resources(verifier.id)))$$;
revoke all on function sellerpilot_private.listing_mutation_reconciliation_resolved(uuid),sellerpilot_private.listing_mutation_reconciliation_resolved_before_coupang_exact_live(uuid),sellerpilot_private.coupang_exact_live_source_current(),sellerpilot_private.coupang_exact_live_completion_valid(uuid),sellerpilot_private.coupang_exact_live_remote_resources(uuid),sellerpilot_private.coupang_exact_live_listing_update_allowed(jsonb,jsonb,text),sellerpilot_private.coupang_exact_live_rows_immutable(),sellerpilot_private.coupang_exact_live_source_immutable(),sellerpilot_private.coupang_exact_live_json_array(jsonb),sellerpilot_private.coupang_exact_live_identity_array(jsonb),sellerpilot_private.coupang_exact_live_asset_digest(jsonb) from public,anon,authenticated,service_role;

commit;
