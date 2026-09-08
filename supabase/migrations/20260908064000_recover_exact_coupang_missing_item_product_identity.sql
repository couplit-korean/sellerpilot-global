-- Accept Coupang's documented runtime shape where the seller-product
-- response has the exact root productId but omits the duplicate item-level
-- productId. The exact sellerProductId, root productId, vendorItemId, itemId,
-- price, stock, sale state, content, lineage, and GET-only boundary remain
-- mandatory. This migration installs validation logic only; it does not claim,
-- enqueue, complete, or mutate any gateway job.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

do $preflight$
declare
  procedure_name constant regprocedure :=
    'sellerpilot_private.coupang_exact_post_price_completion_valid(uuid)'::regprocedure;
  definition text;
  procedure_security_definer boolean;
  procedure_volatility "char";
  procedure_language text;
  procedure_config text[];
begin
  select pg_catalog.pg_get_functiondef(procedure_name),
         p.prosecdef, p.provolatile, l.lanname, p.proconfig
    into strict definition, procedure_security_definer,
         procedure_volatility, procedure_language, procedure_config
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.oid = procedure_name;
  if pg_catalog.strpos(
       definition,
       'seller_root->>''productId'' = run.product_id'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'seller_root#>>''{items,0,productId}'' = run.product_id'
     ) = 0
     or pg_catalog.strpos(definition, 'nullif') > 0
     or pg_catalog.strpos(
       definition,
       'coupang_item_product_id_optional_when_root_exact_v1'
     ) > 0
     or procedure_security_definer is not true
     or procedure_volatility is distinct from 's'::"char"
     or procedure_language is distinct from 'plpgsql'
     or not exists (
       select 1
         from unnest(coalesce(procedure_config, '{}'::text[])) config(value)
        where config.value in ('search_path=', 'search_path=""')
     ) then
    raise exception 'COUPANG_ITEM_PRODUCT_ID_OPTIONAL_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

create or replace function sellerpilot_private.coupang_exact_post_price_completion_valid(
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
    -- coupang_item_product_id_optional_when_root_exact_v1: Coupang may omit
    -- the item-level duplicate productId while returning the exact root productId.
    -- A nonempty conflicting item productId remains a hard failure.
    and (
      nullif(seller_root#>>'{items,0,productId}', '') is null
      or seller_root#>>'{items,0,productId}' = run.product_id
    )
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

do $postflight$
declare
  procedure_name constant regprocedure :=
    'sellerpilot_private.coupang_exact_post_price_completion_valid(uuid)'::regprocedure;
  definition text;
  procedure_security_definer boolean;
  procedure_volatility "char";
  procedure_language text;
  procedure_config text[];
  exposed_acl_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure_name),
         p.prosecdef, p.provolatile, l.lanname, p.proconfig
    into strict definition, procedure_security_definer,
         procedure_volatility, procedure_language, procedure_config
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.oid = procedure_name;
  select count(*) into strict exposed_acl_count
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
   where pg_catalog.has_function_privilege(
     roles.role_name, procedure_name, 'EXECUTE'
   );
  if pg_catalog.strpos(
       definition,
       'coupang_item_product_id_optional_when_root_exact_v1'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'seller_root->>''productId'' = run.product_id'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'nullif(seller_root#>>''{items,0,productId}'', '''') is null'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'seller_root#>>''{items,0,productId}'' = run.product_id'
     ) = 0
     or procedure_security_definer is not true
     or procedure_volatility is distinct from 's'::"char"
     or procedure_language is distinct from 'plpgsql'
     or not exists (
       select 1
         from unnest(coalesce(procedure_config, '{}'::text[])) config(value)
        where config.value in ('search_path=', 'search_path=""')
     )
     or exposed_acl_count <> 0 then
    raise exception 'COUPANG_ITEM_PRODUCT_ID_OPTIONAL_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on function
sellerpilot_private.coupang_exact_post_price_completion_valid(uuid) is
'Validates the exact Coupang post-price GET-only completion and accepts a missing duplicate item productId only when the root productId and all descendant identities are exact.';

commit;
