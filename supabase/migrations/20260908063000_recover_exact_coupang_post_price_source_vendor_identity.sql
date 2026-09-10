-- Recover the exact post-price verifier's provider-assigned vendor identity
-- from its immutable price-repair lineage when the original CREATE readback
-- predates vendorItemId persistence. This migration installs claim hydration
-- only: it does not claim, enqueue, complete, or mutate any gateway job.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

do $preflight$
declare
  procedure_name constant regprocedure :=
    'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure;
  definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure_name)
    into strict definition;
  if pg_catalog.strpos(
       definition,
       'sellerpilot_claim_local_executor_before_coupang_post_price'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'COUPANG_POST_PRICE_VERIFIER_SOURCE_INVALID'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'coupang_post_price_vendor_identity_hydration_v1'
     ) > 0 then
    raise exception 'COUPANG_POST_PRICE_VENDOR_HYDRATION_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

create or replace function public.sellerpilot_claim_local_channel_executor_job(
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
  source_step jsonb;
  run sellerpilot_private.coupang_exact_post_price_verify_runs%rowtype;
  job_id uuid;
  claim_token uuid;
  prior_marker text;
  vendor_ids jsonb;
  hydration_contract constant text :=
    'coupang_post_price_vendor_identity_hydration_v1';
begin
  result := public.sellerpilot_claim_local_executor_before_coupang_post_price(
    p_token_hash, p_worker_version, p_release_sha, p_egress_ip_sha256
  );
  if result is null
     or not exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_verify_runs exact_run
        where exact_run.verifier_job_id = (result->>'id')::uuid
     ) then
    return result;
  end if;
  job_id := (result->>'id')::uuid;
  claim_token := (result->>'claim_token')::uuid;
  select * into strict run
    from sellerpilot_private.coupang_exact_post_price_verify_runs exact_run
   where exact_run.verifier_job_id = job_id;
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
    vendor_ids := source#>'{sourceResponsePayload,remoteState,resources,vendorItemIds}';
    if vendor_ids = '[]'::jsonb then
      select step.value into strict source_step
        from jsonb_array_elements(
          source#>'{sourceResponsePayload,steps}'
        ) with ordinality step(value, position)
       where step.value->>'name' = 'seller-product-publication-readback'
       order by step.position desc
       limit 1;
      if hydration_contract is distinct from
           'coupang_post_price_vendor_identity_hydration_v1'
         or run.source_job_id is distinct from
           '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
         or run.price_repair_job_id is distinct from
           '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid
         or run.price_repair_attempt_id is distinct from
           '05508966-7665-4873-a89b-89fda8ea8a25'::uuid
         or run.seller_product_id is distinct from '16375780938'
         or run.vendor_item_id is distinct from '96027942778'
         or sellerpilot_private.coupang_exact_post_price_source_current(job_id)
              is not true
         or source_step->>'ok' is distinct from 'true'
         or source_step->>'status' !~ '^2[0-9][0-9]$'
         or source_step#>>'{data,code}' is distinct from 'SUCCESS'
         or source_step#>>'{data,data,sellerProductId}' is distinct from
           run.seller_product_id
         or jsonb_typeof(source_step#>'{data,data,items}') is distinct from
           'array'
         or jsonb_array_length(source_step#>'{data,data,items}') <> 1 then
        raise exception 'COUPANG_POST_PRICE_VENDOR_HYDRATION_SOURCE_INVALID'
          using errcode = '55000';
      end if;
      source := jsonb_set(
        source,
        '{sourceResponsePayload,remoteState,resources,vendorItemIds}',
        jsonb_build_array(run.vendor_item_id),
        false
      );
    end if;
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
public.sellerpilot_claim_local_channel_executor_job(text, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function
public.sellerpilot_claim_local_channel_executor_job(text, text, text, text)
to service_role;

do $postflight$
declare
  definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
  ) into strict definition;
  if pg_catalog.strpos(
       definition,
       'coupang_post_price_vendor_identity_hydration_v1'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'jsonb_build_array(run.vendor_item_id)'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'sellerpilot_claim_local_executor_before_coupang_post_price'
     ) = 0 then
    raise exception 'COUPANG_POST_PRICE_VENDOR_HYDRATION_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on function public.sellerpilot_claim_local_channel_executor_job(
  text, text, text, text
) is
'Claims gateway work and hydrates the exact Coupang post-price verifier vendor identity from its immutable successful price-repair lineage.';

commit;
