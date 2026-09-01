-- Bind the one approved Coupang representative source and its deterministic
-- normalized JPEG to the exact existing-listing one-shot permit. This does not
-- open the global listing mutation gate or admit any other listing.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917399001);

create table sellerpilot_private.coupang_exact_representative_permits (
  permit_id uuid primary key references
    sellerpilot_private.exact_existing_update_permits(permit_id)
    on delete restrict,
  listing_id uuid not null,
  role text not null,
  source_bucket text not null,
  source_object_path text not null,
  source_sha256 text not null,
  normalized_object_path text not null,
  content_sha256 text not null,
  release_sha text not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint coupang_exact_representative_permit_exact_check check (
    listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
    and role = 'gallery-representative'
    and source_bucket = 'sellerpilot-ai'
    and source_object_path ~
      '^results/[0-9a-f-]+/claims/[0-9a-f-]+/thumbnail-square[.]png$'
    and source_sha256 ~ '^[a-f0-9]{64}$'
    and content_sha256 ~ '^[a-f0-9]{64}$'
    and normalized_object_path =
      'normalized/' || left(content_sha256, 2) || '/' || content_sha256 || '.jpg'
    and release_sha ~ '^[a-f0-9]{40}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
  )
);

alter table sellerpilot_private.coupang_exact_representative_permits
  enable row level security;
revoke all on sellerpilot_private.coupang_exact_representative_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_coupang_exact_rep_permit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Coupang exact representative permit is immutable'
    using errcode = '55000';
end;
$$;

create trigger guard_coupang_exact_rep_permit
before update or delete
on sellerpilot_private.coupang_exact_representative_permits
for each row execute function
  sellerpilot_private.guard_coupang_exact_rep_permit();

revoke all on function
  sellerpilot_private.guard_coupang_exact_rep_permit()
  from public, anon, authenticated, service_role;

do $copy_exact_arguments_predecessor$
declare
  v_definition text;
  v_anchor constant text :=
    'sellerpilot_private.exact_existing_update_arguments_valid(';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'exact update arguments preimage drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition,
    v_anchor,
    'sellerpilot_private.sp_173990_exact_args_pre('
  );
end;
$copy_exact_arguments_predecessor$;

revoke all on function sellerpilot_private.sp_173990_exact_args_pre(
  text,jsonb,text,text,integer
) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.exact_existing_update_arguments_valid(
  p_channel text,
  p_arguments jsonb,
  p_release_sha text,
  p_request_fingerprint text,
  p_expected_stock integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_recovery jsonb := p_arguments->'sellerpilotCoupangExactQaRecovery';
  v_rep jsonb := p_arguments->'sellerpilotCoupangExactQaRepresentative';
  v_assets jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_item jsonb := p_arguments#>'{body,items,0}';
  v_transport jsonb := v_assets->'providerTransportImages';
  v_approved jsonb := v_assets->'approvedDetailImages';
begin
  if p_channel <> 'coupang' then
    return sellerpilot_private.sp_173990_exact_args_pre(
      p_channel,p_arguments,p_release_sha,p_request_fingerprint,p_expected_stock
    );
  end if;
  if not coalesce(
    jsonb_typeof(p_arguments) = 'object'
    and p_release_sha ~ '^[a-f0-9]{40}$'
    and p_request_fingerprint ~ '^[a-f0-9]{64}$'
    and p_arguments->>'publicationExpectedFingerprint' = p_request_fingerprint
    and p_arguments->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_arguments->>'publicationIntent' = 'live'
    and p_arguments->>'publicationExpectedLocale' = 'ko-KR'
    and (p_arguments->>'publicationExpectedImageCount')::integer = 8
    and p_expected_stock = 1
    and jsonb_typeof(v_recovery) = 'object'
    and v_recovery = jsonb_build_object(
       'contract','coupang_exact_qa_recovery_v1',
       'phase','listing.update',
       'productId','ddccde35-9c58-4856-b673-d7aa27ce4220',
       'listingId','7ffc6e46-3173-4695-9889-5fa1529765f1',
       'sellerProductId','16356981734',
       'vendorItemId','95962393877',
       'sellerSku','QA-20260823-CC-001',
       'sellerAccountLineage','validated_by_service_rpc'
     )
    and jsonb_typeof(v_rep) = 'object'
    and v_rep->>'contract' = 'coupang_exact_qa_representative_v1'
    and v_rep->>'role' = 'gallery-representative'
    and v_rep->>'sourceBucket' = 'sellerpilot-ai'
    and v_rep->>'sourceObjectPath' ~
       '^results/[0-9a-f-]+/claims/[0-9a-f-]+/thumbnail-square[.]png$'
    and v_rep->>'sourceSha256' ~ '^[a-f0-9]{64}$'
    and v_rep->>'contentSha256' ~ '^[a-f0-9]{64}$'
    and (v_rep->>'normalizedObjectPath') =
       'normalized/' || left((v_rep->>'contentSha256'),2) || '/' ||
       (v_rep->>'contentSha256') || '.jpg'
    and p_arguments#>>'{body,sellerProductId}' = '16356981734'
    and jsonb_typeof(p_arguments#>'{body,items}') = 'array'
    and jsonb_array_length(p_arguments#>'{body,items}') = 1
    and v_item->>'sellerpilotItemMatchId' = '95962393877'
    and v_item->>'modelNo' = 'QA-20260823-CC-001'
    and not (v_item ?| array[
       'externalVendorSku','originalPrice','salePrice','maximumBuyCount'
     ])
    and jsonb_typeof(v_assets) = 'object'
    and v_assets->>'contract' = 'sellerpilot_publication_asset_binding_v1'
    and v_assets->>'providerImageSurface' = 'gallery'
    and jsonb_typeof(v_approved) = 'array'
    and jsonb_array_length(v_approved) = 8
    and jsonb_typeof(v_transport) = 'array'
    and jsonb_array_length(v_transport) = 9
    and jsonb_typeof(v_item->'images') = 'array'
    and jsonb_array_length(v_item->'images') = 9,
    false
  ) then return false; end if;

  if not coalesce(
    (v_transport->0)->>'role' = 'gallery-representative'
    and (v_transport->0)->>'approvedObjectPath' = v_rep->>'sourceObjectPath'
    and (v_transport->0)->>'approvedSourceSha256' = v_rep->>'sourceSha256'
    and (v_transport->0)->>'objectPath' = v_rep->>'normalizedObjectPath'
    and (v_transport->0)->>'contentSha256' = v_rep->>'contentSha256'
    and (v_transport->0)->>'publicUrl' ~
      '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/'
    and pg_catalog.split_part(
      (v_transport->0)->>'publicUrl',
      '/storage/v1/object/public/sellerpilot-marketplace/',2
    ) = (v_transport->0)->>'objectPath'
    and v_item#>>'{images,0,imageType}' = 'REPRESENTATION'
    and v_item#>>'{images,0,vendorPath}' = (v_transport->0)->>'publicUrl',
    false
  ) then return false; end if;

  return not exists (
    select 1 from generate_series(0,7) as positions(image_index)
     where ((v_transport->(image_index + 1))->>'role') is distinct from
             ((v_approved->image_index)->>'role')
        or ((v_transport->(image_index + 1))->>'approvedObjectPath') is distinct from
             ((v_approved->image_index)->>'approvedObjectPath')
        or ((v_transport->(image_index + 1))->>'approvedSourceSha256') is distinct from
             ((v_approved->image_index)->>'approvedSourceSha256')
        or ((v_transport->(image_index + 1))->>'objectPath') is distinct from
             ((v_approved->image_index)->>'objectPath')
        or ((v_transport->(image_index + 1))->>'contentSha256') is distinct from
             ((v_approved->image_index)->>'contentSha256')
        or ((v_transport->(image_index + 1))->>'publicUrl') is distinct from
             ((v_approved->image_index)->>'publicUrl')
        or (v_transport->(image_index + 1))->>'publicUrl' !~
             '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/'
        or pg_catalog.split_part(
             (v_transport->(image_index + 1))->>'publicUrl',
             '/storage/v1/object/public/sellerpilot-marketplace/',2
           ) is distinct from (v_transport->(image_index + 1))->>'objectPath'
        or v_item#>>array['images',(image_index + 1)::text,'imageType'] is distinct from 'DETAIL'
        or v_item#>>array['images',(image_index + 1)::text,'vendorPath'] is distinct from
             ((v_transport->(image_index + 1))->>'publicUrl')
        or pg_catalog.strpos(
             (v_item->'contents')::text,
             (v_transport->(image_index + 1))->>'publicUrl'
           ) = 0
  );
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.exact_existing_update_arguments_valid(
  text,jsonb,text,text,integer
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_arm_coupang_exact_rep(
  p_channel text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text,
  p_source_object_path text,
  p_source_sha256 text,
  p_normalized_object_path text,
  p_content_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_permit_id uuid;
begin
  if not coalesce(
    current_setting('request.jwt.claim.role',true) = 'service_role'
    and p_channel = 'coupang'
    and p_listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
    and p_source_object_path ~
       '^results/[0-9a-f-]+/claims/[0-9a-f-]+/thumbnail-square[.]png$'
    and p_source_sha256 ~ '^[a-f0-9]{64}$'
    and p_content_sha256 ~ '^[a-f0-9]{64}$'
    and p_normalized_object_path =
      'normalized/' || left(p_content_sha256,2) || '/' || p_content_sha256 || '.jpg',
    false
  )
  then raise exception 'Coupang exact representative identity invalid'
    using errcode = '55000'; end if;
  v_result := public.sellerpilot_service_arm_exact_existing_update(
    p_channel,p_listing_id,p_credential_id,p_release_sha,p_request_fingerprint
  );
  v_permit_id := (v_result->>'permitId')::uuid;
  insert into sellerpilot_private.coupang_exact_representative_permits(
    permit_id,listing_id,role,source_bucket,source_object_path,source_sha256,
    normalized_object_path,content_sha256,release_sha,request_fingerprint
  ) values (
    v_permit_id,p_listing_id,'gallery-representative','sellerpilot-ai',
    p_source_object_path,p_source_sha256,p_normalized_object_path,
    p_content_sha256,p_release_sha,p_request_fingerprint
  ) on conflict (permit_id) do nothing;
  if not exists (
    select 1 from sellerpilot_private.coupang_exact_representative_permits rep
     where rep.permit_id = v_permit_id
       and rep.listing_id = p_listing_id
       and rep.source_object_path = p_source_object_path
       and rep.source_sha256 = p_source_sha256
       and rep.normalized_object_path = p_normalized_object_path
       and rep.content_sha256 = p_content_sha256
       and rep.release_sha = p_release_sha
       and rep.request_fingerprint = p_request_fingerprint
  ) then raise exception 'Coupang exact representative permit conflict'
    using errcode = '55000'; end if;
  return v_result || jsonb_build_object(
    'representativeContract','coupang_exact_qa_representative_v1',
    'sourceSha256',p_source_sha256,'contentSha256',p_content_sha256
  );
end;
$$;

revoke all on function public.sellerpilot_service_arm_coupang_exact_rep(
  text,uuid,uuid,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_arm_coupang_exact_rep(
  text,uuid,uuid,text,text,text,text,text,text
) to service_role;

do $copy_provider_allowed_predecessor$
declare
  v_definition text;
  v_anchor constant text :=
    'sellerpilot_private.exact_existing_update_provider_allowed(';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_anchor,''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'exact update provider preimage drifted' using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition,v_anchor,'sellerpilot_private.sp_173990_provider_allowed_pre('
  );
end;
$copy_provider_allowed_predecessor$;

revoke all on function sellerpilot_private.sp_173990_provider_allowed_pre(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.exact_existing_update_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select sellerpilot_private.sp_173990_provider_allowed_pre(p_job_id,p_claim_token)
    and case when exists (
      select 1 from sellerpilot_private.exact_existing_update_permits permit
       where permit.update_job_id = p_job_id and permit.channel = 'coupang'
    ) then exists (
      select 1
        from sellerpilot_private.exact_existing_update_permits permit
        join sellerpilot_private.coupang_exact_representative_permits rep
          on rep.permit_id = permit.permit_id
        join sellerpilot_private.channel_gateway_jobs job
          on job.id = permit.update_job_id
       where permit.update_job_id = p_job_id
         and permit.channel = 'coupang'
         and permit.bound_claim_token = p_claim_token
         and permit.consumed_at is null
         and rep.listing_id = permit.listing_id
         and rep.release_sha = permit.release_sha
         and rep.request_fingerprint = permit.request_fingerprint
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,contract}' =
               'coupang_exact_qa_representative_v1'
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,role}' = rep.role
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,sourceBucket}' = rep.source_bucket
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,sourceObjectPath}' = rep.source_object_path
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,sourceSha256}' = rep.source_sha256
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,normalizedObjectPath}' = rep.normalized_object_path
         and job.request_payload#>>'{arguments,sellerpilotCoupangExactQaRepresentative,contentSha256}' = rep.content_sha256
    ) else true end
$$;

revoke all on function sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_rep_response_valid(
  p_job_id uuid,
  p_response jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_evidence jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.update_job_id = job.id and permit.channel = 'coupang'
     and permit.consumed_at is not null
    join sellerpilot_private.coupang_exact_representative_permits rep
      on rep.permit_id = permit.permit_id
   where job.id = p_job_id
     and job.channel = 'coupang' and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.response_payload = p_response
     and job.status = 'succeeded' and job.completed_at is not null
     and exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = job.id
          and receipt.worker_token_id = permit.bound_worker_token_id
          and receipt.claim_token = permit.bound_claim_token
          and receipt.completion_fingerprint ~ '^[a-f0-9]{64}$'
     );
  if not found or jsonb_typeof(p_response) <> 'object' then return false; end if;
  select step->'data'->'sellerpilotCoupangExactRepresentativeReadback'
    into v_evidence
    from jsonb_array_elements(p_response->'steps') step
   where step->>'name' = 'listing-readback' and step->>'ok' = 'true'
   limit 1;
  return coalesce(p_response->>'ok' = 'true'
    and p_response->>'channel' = 'coupang'
    and p_response->>'operation' = 'listing.update'
    and p_response->>'remoteId' = '16356981734'
    and p_response->>'publicationIntent' = 'live'
    and p_response->>'publicationFulfilled' = 'true'
    and p_response->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_response#>>'{remoteState,verified}' = 'true'
    and p_response#>>'{remoteState,visibility}' = 'live'
    and p_response#>>'{remoteState,locale}' = 'ko-KR'
    and p_response#>>'{remoteState,fingerprint}' = v_job.request_fingerprint
    and p_response#>>'{remoteState,imageCount}' = '8'
    and v_evidence->>'contract' = 'coupang_exact_qa_representative_readback_v1'
    and v_evidence->>'sellerProductId' = '16356981734'
    and v_evidence->>'vendorItemId' = '95962393877'
    and v_evidence->>'role' = v_job.request_payload#>>
      '{arguments,sellerpilotCoupangExactQaRepresentative,role}'
    and v_evidence->>'sourceBucket' = v_job.request_payload#>>
      '{arguments,sellerpilotCoupangExactQaRepresentative,sourceBucket}'
    and v_evidence->>'sourceObjectPath' = v_job.request_payload#>>
      '{arguments,sellerpilotCoupangExactQaRepresentative,sourceObjectPath}'
    and v_evidence->>'sourceSha256' = v_job.request_payload#>>
      '{arguments,sellerpilotCoupangExactQaRepresentative,sourceSha256}'
    and v_evidence->>'normalizedObjectPath' = v_job.request_payload#>>
      '{arguments,sellerpilotCoupangExactQaRepresentative,normalizedObjectPath}'
    and v_evidence->>'contentSha256' = v_job.request_payload#>>
      '{arguments,sellerpilotCoupangExactQaRepresentative,contentSha256}'
    and v_evidence->>'representativeImageCount' = '1'
    and v_evidence->>'detailImageCount' = '8'
    and v_evidence->>'remoteGalleryVerified' = 'true', false);
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.coupang_exact_rep_response_valid(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_coupang_exact_rep_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'succeeded' and old.status is distinct from new.status
     and exists (
       select 1 from sellerpilot_private.exact_existing_update_permits permit
        where permit.update_job_id = new.id and permit.channel = 'coupang'
     )
     and not sellerpilot_private.coupang_exact_rep_response_valid(
       new.id,new.response_payload
     )
  then raise exception 'invalid Coupang exact representative completion attestation'
    using errcode = '55000'; end if;
  return new;
end;
$$;

create constraint trigger guard_coupang_exact_rep_completion
after update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function
  sellerpilot_private.guard_coupang_exact_rep_completion();

revoke all on function sellerpilot_private.guard_coupang_exact_rep_completion()
  from public, anon, authenticated, service_role;

do $coupang_exact_rep_postimage$
declare
  v_definition text;
  v_security_definer boolean;
  v_config text;
begin
  if pg_catalog.length('sellerpilot_service_arm_coupang_exact_rep') > 63 then
    raise exception 'Coupang exact representative RPC name exceeds PostgreSQL limit';
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sp_173990_exact_args_pre') = 0
     or pg_catalog.strpos(v_definition,'sellerpilotCoupangExactQaRepresentative') = 0
     or pg_catalog.strpos(v_definition,'''gallery''') = 0
  then raise exception 'Coupang exact representative arguments postimage invalid'
    using errcode = '55000'; end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sp_173990_provider_allowed_pre') = 0
     or pg_catalog.strpos(v_definition,'coupang_exact_representative_permits') = 0
  then raise exception 'Coupang exact representative provider postimage invalid'
    using errcode = '55000'; end if;
  select procedure.prosecdef,
         pg_catalog.array_to_string(procedure.proconfig,',')
    into strict v_security_definer, v_config
    from pg_catalog.pg_proc procedure
   where procedure.oid =
     'public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)'::regprocedure;
  if v_security_definer is distinct from true
     or v_config <> 'search_path=""'
  then raise exception 'Coupang exact representative RPC metadata invalid'
    using errcode = '55000'; end if;
  if has_function_privilege('public','public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE')
  then raise exception 'Coupang exact representative RPC ACL invalid'
    using errcode = '55000'; end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'sellerpilot_private'
      and relation.relname = 'coupang_exact_representative_permits'
      and relation.relrowsecurity
  )
     or has_table_privilege('public','sellerpilot_private.coupang_exact_representative_permits','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon','sellerpilot_private.coupang_exact_representative_permits','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','sellerpilot_private.coupang_exact_representative_permits','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role','sellerpilot_private.coupang_exact_representative_permits','SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'Coupang exact representative table ACL invalid'
    using errcode = '55000'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'sellerpilot_private'
      and procedure.proname in (
        'guard_coupang_exact_rep_permit',
        'sp_173990_exact_args_pre',
        'exact_existing_update_arguments_valid',
        'sp_173990_provider_allowed_pre',
        'exact_existing_update_provider_allowed',
        'coupang_exact_rep_response_valid',
        'guard_coupang_exact_rep_completion'
      )
      and (
        has_function_privilege('public',procedure.oid,'EXECUTE')
        or has_function_privilege('anon',procedure.oid,'EXECUTE')
        or has_function_privilege('authenticated',procedure.oid,'EXECUTE')
        or has_function_privilege('service_role',procedure.oid,'EXECUTE')
      )
  ) then raise exception 'Coupang exact representative private ACL invalid'
    using errcode = '55000'; end if;
  if not exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid =
      'sellerpilot_private.coupang_exact_rep_response_valid(uuid,jsonb)'::regprocedure
      and procedure.prosecdef
      and procedure.proconfig = array['search_path=""']::text[]
  )
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'sellerpilot_private.coupang_exact_rep_response_valid(uuid,jsonb)'::regprocedure
       ),
       'gateway_completion_receipts'
     ) = 0
  then raise exception 'Coupang exact representative completion postimage invalid'
    using errcode = '55000'; end if;
end;
$coupang_exact_rep_postimage$;

commit;
