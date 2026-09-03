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

create table sellerpilot_private.coupang_exact_rep_prewrites (
  permit_id uuid primary key references
    sellerpilot_private.coupang_exact_representative_permits(permit_id)
    on delete restrict,
  job_id uuid not null unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null,
  prewrite_images jsonb not null,
  prewrite_snapshot_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint coupang_exact_rep_prewrite_shape_check check (
    jsonb_typeof(prewrite_images) = 'array'
    and jsonb_array_length(prewrite_images) = 9
    and prewrite_snapshot_sha256 ~ '^[a-f0-9]{64}$'
  )
);

alter table sellerpilot_private.coupang_exact_rep_prewrites
  enable row level security;
revoke all on sellerpilot_private.coupang_exact_rep_prewrites
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

create trigger guard_coupang_exact_rep_prewrite
before update or delete
on sellerpilot_private.coupang_exact_rep_prewrites
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

create function public.sellerpilot_service_bind_coupang_rep_prewrite(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_images jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permit_id uuid;
  v_worker_token_id uuid;
  v_snapshot_sha256 text;
begin
  if current_setting('request.jwt.claim.role',true) <> 'service_role'
     or not sellerpilot_private.serverless_cs_job_is_owned(
       p_token_hash,p_job_id,p_claim_token,true
     )
     or jsonb_typeof(p_images) is distinct from 'array'
     or jsonb_array_length(p_images) <> 9
     or exists (
       select 1
         from jsonb_array_elements(p_images) with ordinality image(value,position)
        where jsonb_typeof(image.value) is distinct from 'object'
           or image.value - 'imageOrder' - 'imageType' - 'cdnPath' - 'vendorPath'
                is distinct from '{}'::jsonb
           or (image.value->>'imageOrder')::integer <> image.position - 1
           or image.value->>'imageType' is distinct from
                case when image.position = 1 then 'REPRESENTATION' else 'DETAIL' end
           or (coalesce(image.value->>'cdnPath','') = ''
             and coalesce(image.value->>'vendorPath','') = '')
           or pg_catalog.length(coalesce(image.value->>'cdnPath','')) > 2048
           or pg_catalog.length(coalesce(image.value->>'vendorPath','')) > 2048
           or coalesce(image.value->>'cdnPath','') ~ '[?#[:cntrl:]]'
           or coalesce(image.value->>'vendorPath','') ~ '[?#[:cntrl:]]'
     )
  then raise exception 'Coupang exact representative prewrite invalid'
    using errcode = '55000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,917399002);
  select permit.permit_id, job.worker_token_id
    into v_permit_id, v_worker_token_id
    from sellerpilot_private.exact_existing_update_permits permit
    join sellerpilot_private.coupang_exact_representative_permits rep
      on rep.permit_id = permit.permit_id
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = permit.update_job_id
   where job.id = p_job_id
     and job.channel = 'coupang'
     and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.worker_token_id = permit.bound_worker_token_id
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and job.provider_mutation_started_at is null
   for share of job,permit,rep;
  if not found then
    raise exception 'Coupang exact representative prewrite lineage invalid'
      using errcode = '55000';
  end if;
  select encode(extensions.digest(pg_catalog.convert_to(
      string_agg(
        (image.value->>'imageOrder') || chr(31) ||
        (image.value->>'imageType') || chr(31) ||
        coalesce(image.value->>'cdnPath','') || chr(31) ||
        coalesce(image.value->>'vendorPath',''),
        chr(30) order by image.position
      ),'UTF8'),'sha256'),'hex')
    into v_snapshot_sha256
    from jsonb_array_elements(p_images) with ordinality image(value,position);
  insert into sellerpilot_private.coupang_exact_rep_prewrites(
    permit_id,job_id,claim_token,worker_token_id,prewrite_images,
    prewrite_snapshot_sha256
  ) values (
    v_permit_id,p_job_id,p_claim_token,v_worker_token_id,p_images,
    v_snapshot_sha256
  ) on conflict (permit_id) do nothing;
  if not exists (
    select 1 from sellerpilot_private.coupang_exact_rep_prewrites prewrite
     where prewrite.permit_id = v_permit_id
       and prewrite.job_id = p_job_id
       and prewrite.claim_token = p_claim_token
       and prewrite.worker_token_id = v_worker_token_id
       and prewrite.prewrite_images = p_images
       and prewrite.prewrite_snapshot_sha256 = v_snapshot_sha256
  ) then raise exception 'Coupang exact representative prewrite conflict'
    using errcode = '55000'; end if;
  return jsonb_build_object(
    'contract','coupang_exact_rep_prewrite_v1',
    'jobId',p_job_id,
    'prewriteSnapshotSha256',v_snapshot_sha256
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Coupang exact representative prewrite invalid'
    using errcode = '55000';
end;
$$;

revoke all on function public.sellerpilot_service_bind_coupang_rep_prewrite(
  text,uuid,uuid,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_bind_coupang_rep_prewrite(
  text,uuid,uuid,jsonb
) to service_role;

do $copy_bind_claim_predecessor$
declare
  v_definition text;
  v_anchor constant text :=
    'sellerpilot_private.bind_exact_existing_update_claim(';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_anchor,''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'exact update claim preimage drifted' using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition,v_anchor,'sellerpilot_private.sp_173990_bind_claim_pre('
  );
end;
$copy_bind_claim_predecessor$;

revoke all on function sellerpilot_private.sp_173990_bind_claim_pre(jsonb,jsonb)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.bind_exact_existing_update_claim(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_old->>'channel' <> 'coupang' then
    return sellerpilot_private.sp_173990_bind_claim_pre(p_old,p_new);
  end if;
  if jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' is distinct from 'queued'
     or p_new->>'status' is distinct from 'running'
     or p_new->>'channel' is distinct from 'coupang'
     or p_old->>'operation' is distinct from 'listing.update'
     or p_new->>'operation' is distinct from 'listing.update'
     or (p_old->>'attempt_count')::integer is distinct from 0
     or (p_new->>'attempt_count')::integer is distinct from 1
     or p_old->'worker_token_id' is distinct from 'null'::jsonb
     or p_old->'claim_token' is distinct from 'null'::jsonb
     or p_old->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'worker_token_id' = 'null'::jsonb
     or p_new->'claim_token' = 'null'::jsonb
     or p_new->'completed_at' is distinct from 'null'::jsonb
     or p_new->'response_payload' is distinct from 'null'::jsonb
     or p_new->'error_message' is distinct from 'null'::jsonb
     or (p_new->>'lease_expires_at')::timestamptz <= statement_timestamp()
     or p_new-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
        is distinct from
        p_old-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
  then return false; end if;
  v_job_id := (p_new->>'id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = (p_new->>'worker_token_id')::uuid,
         bound_claim_token = (p_new->>'claim_token')::uuid
   where permit.update_job_id = v_job_id
     and permit.update_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.channel = 'coupang'
     and permit.listing_id = (p_new->>'listing_id')::uuid
     and permit.credential_id = (p_new->>'credential_id')::uuid
     and permit.seller_account_key = p_new->>'seller_account_key'
     and permit.request_fingerprint = p_new->>'request_fingerprint'
     and permit.request_payload_sha256 = encode(extensions.digest(
           (p_new->'request_payload')::text,'sha256'
         ),'hex')
     and permit.request_payload_bytes = octet_length(
           (p_new->'request_payload')::text
         )
     and permit.invalidated_at is null
     and permit.consumed_at is null
     and permit.bound_at is null
     and permit.expires_at > statement_timestamp()
     and exists (
       select 1
         from sellerpilot_private.coupang_exact_representative_permits rep
        where rep.permit_id = permit.permit_id
          and rep.request_fingerprint = permit.request_fingerprint
          and rep.release_sha = permit.release_sha
     )
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           'coupang',p_new->'request_payload'->'arguments',permit.release_sha,
           permit.request_fingerprint,permit.stock
         );
  return found;
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.bind_exact_existing_update_claim(
  jsonb,jsonb
) from public, anon, authenticated, service_role;

do $copy_enqueue_predecessor$
declare
  v_definition text;
  v_anchor constant text :=
    'public.sellerpilot_service_enqueue_listing_gateway_job(';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_anchor,''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'listing enqueue preimage drifted' using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition,v_anchor,'public.sp_173990_enqueue_pre('
  );
end;
$copy_enqueue_predecessor$;

revoke all on function public.sp_173990_enqueue_pre(
  uuid,uuid,uuid,text,text,jsonb
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  if p_channel <> 'coupang'
     or p_operation <> 'listing.update'
     or p_listing_id <> '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
     or v_arguments#>>'{sellerpilotCoupangExactQaRepresentative,contract}' <>
          'coupang_exact_qa_representative_v1'
  then return public.sp_173990_enqueue_pre(
    p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
    p_request_payload
  ); end if;
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,917399001);
  select permit.* into strict v_permit
    from sellerpilot_private.exact_existing_update_permits permit
    join sellerpilot_private.coupang_exact_representative_permits rep
      on rep.permit_id = permit.permit_id
   where permit.channel = 'coupang'
     and permit.listing_id = p_listing_id
     and permit.credential_id = p_credential_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and rep.request_fingerprint = permit.request_fingerprint
     and rep.release_sha = permit.release_sha
     and sellerpilot_private.exact_existing_update_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           'coupang',v_arguments,permit.release_sha,
           permit.request_fingerprint,permit.stock
         )
     and exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = p_attempt_id
          and attempt.owner_id = permit.owner_id
          and attempt.credential_id = permit.credential_id
          and attempt.channel = 'coupang'
          and attempt.operation = 'listing.update'
          and attempt.status = 'running'
          and attempt.seller_account_key = permit.seller_account_key
          and attempt.request_fingerprint = permit.request_fingerprint
     )
   for update of permit,rep;
  v_result := public.sp_173990_enqueue_pre(
    p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
    p_request_payload
  );
  if coalesce(v_result->>'job_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_result->>'status' <> 'queued'
  then raise exception 'Coupang exact representative job not newly queued'
    using errcode = '55000'; end if;
  v_job_id := (v_result->>'job_id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set update_job_id = v_job_id,
         update_attempt_id = p_attempt_id,
         arguments_sha256 = encode(
           extensions.digest(v_arguments::text,'sha256'),'hex'
         ),
         arguments_bytes = octet_length(v_arguments::text),
         request_payload_sha256 = encode(
           extensions.digest(p_request_payload::text,'sha256'),'hex'
         ),
         request_payload_bytes = octet_length(p_request_payload::text)
   where permit.permit_id = v_permit.permit_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = v_job_id
          and job.attempt_id = p_attempt_id
          and job.listing_id = permit.listing_id
          and job.credential_id = permit.credential_id
          and job.channel = 'coupang'
          and job.operation = 'listing.update'
          and job.environment = 'production'
          and job.status = 'queued'
          and job.attempt_count = 0
          and job.seller_account_key = permit.seller_account_key
          and job.request_fingerprint = permit.request_fingerprint
          and job.request_payload = p_request_payload
          and job.provider_mutation_started_at is null
          and job.response_payload is null
          and job.completed_at is null
     );
  if not found then
    if not exists (
      select 1 from sellerpilot_private.exact_existing_update_permits permit
       where permit.permit_id = v_permit.permit_id
         and permit.update_job_id = v_job_id
         and permit.update_attempt_id = p_attempt_id
         and permit.arguments_sha256 = encode(
           extensions.digest(v_arguments::text,'sha256'),'hex'
         )
         and permit.request_payload_sha256 = encode(
           extensions.digest(p_request_payload::text,'sha256'),'hex'
         )
    ) then raise exception 'Coupang exact representative job binding failed'
      using errcode = '55000'; end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
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
        join sellerpilot_private.coupang_exact_rep_prewrites prewrite
          on prewrite.permit_id = permit.permit_id
        join sellerpilot_private.channel_gateway_jobs job
          on job.id = permit.update_job_id
       where permit.update_job_id = p_job_id
         and permit.channel = 'coupang'
         and permit.bound_claim_token = p_claim_token
         and permit.consumed_at is null
         and prewrite.job_id = job.id
         and prewrite.claim_token = permit.bound_claim_token
         and prewrite.worker_token_id = permit.bound_worker_token_id
         and prewrite.prewrite_snapshot_sha256 ~ '^[a-f0-9]{64}$'
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
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_evidence jsonb;
  v_prewrite sellerpilot_private.coupang_exact_rep_prewrites%rowtype;
  v_post_snapshot_sha256 text;
  v_verified_at timestamptz;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.update_job_id = job.id and permit.channel = 'coupang'
     and permit.consumed_at is not null
    join sellerpilot_private.coupang_exact_representative_permits rep
      on rep.permit_id = permit.permit_id
    join sellerpilot_private.coupang_exact_rep_prewrites prewrite
      on prewrite.permit_id = permit.permit_id
   where job.id = p_job_id
     and job.channel = 'coupang' and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.provider_mutation_started_at is not null
     and permit.consumed_at is not null
     ;
  if not found or jsonb_typeof(p_response) <> 'object' then return false; end if;
  select permit.* into strict v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.update_job_id = p_job_id and permit.channel = 'coupang';
  if v_job.status = 'running' then
    if v_job.response_payload is not null
       or v_job.completed_at is not null
       or v_job.worker_token_id is distinct from v_permit.bound_worker_token_id
       or v_job.claim_token is distinct from v_permit.bound_claim_token
       or exists (
         select 1 from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = v_job.id
       )
    then return false; end if;
  elsif v_job.status = 'succeeded' then
    if v_job.response_payload is distinct from p_response
       or v_job.completed_at is null
       or not exists (
         select 1 from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = v_job.id
            and receipt.worker_token_id = v_permit.bound_worker_token_id
            and receipt.claim_token = v_permit.bound_claim_token
            and receipt.completion_fingerprint ~ '^[a-f0-9]{64}$'
       )
    then return false; end if;
  else
    return false;
  end if;
  select prewrite.* into strict v_prewrite
    from sellerpilot_private.coupang_exact_rep_prewrites prewrite
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = prewrite.permit_id
   where permit.update_job_id = p_job_id;
  begin
    v_verified_at := (p_response#>>'{remoteState,verifiedAt}')::timestamptz;
  exception when others then
    return false;
  end;
  select step->'data'->'sellerpilotCoupangExactRepresentativeReadback'
    into v_evidence
    from jsonb_array_elements(p_response->'steps') step
   where step->>'name' = 'listing-readback' and step->>'ok' = 'true'
   limit 1;
  select encode(extensions.digest(pg_catalog.convert_to(
      string_agg(
        (image.value->>'imageOrder') || chr(31) ||
        (image.value->>'imageType') || chr(31) ||
        coalesce(image.value->>'cdnPath','') || chr(31) ||
        coalesce(image.value->>'vendorPath',''),
        chr(30) order by image.position
      ),'UTF8'),'sha256'),'hex')
    into v_post_snapshot_sha256
    from jsonb_array_elements(v_evidence->'postwriteImages')
         with ordinality image(value,position);
  return coalesce(p_response->>'ok' = 'true'
    and p_response->>'channel' = 'coupang'
    and p_response->>'operation' = 'listing.update'
    and p_response->>'remoteId' = '16356981734'
    and p_response->>'publicationIntent' = 'live'
    and p_response->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_response#>>'{remoteState,verified}' = 'true'
    and case when v_job.status = 'running' then
      p_response->>'publicationFulfilled' = 'true'
      and p_response#>>'{remoteState,visibility}' = 'live'
    else
      p_response->>'publicationFulfilled' = 'false'
      and p_response#>>'{remoteState,visibility}' = 'pending_review'
      and p_response#>>'{remoteState,evidence,providerObservedVisibility}' = 'live'
    end
    and p_response#>>'{remoteState,locale}' = 'ko-KR'
    and p_response#>>'{remoteState,fingerprint}' = v_job.request_fingerprint
    and p_response#>>'{remoteState,imageCount}' = '8'
    and p_response#>>'{remoteState,providerStatus}' = '승인완료'
    and p_response#>>'{remoteState,resources,sellerProductId}' = '16356981734'
    and p_response#>'{remoteState,resources,vendorItemIds}' =
          '["95962393877"]'::jsonb
    and p_response#>>'{remoteState,evidence,version}' =
          'coupang_seller_product_inventory_v2'
    and not exists (
      select 1 from (values
        ('identityVerified'),('statusVerified'),('localeVerified'),
        ('fingerprintVerified'),('imageCountVerified')
      ) expected(key)
      where p_response#>>array['remoteState','evidence',expected.key] <> 'true'
    )
    and v_verified_at >= v_job.provider_mutation_started_at
    and v_verified_at <= pg_catalog.statement_timestamp() + interval '5 minutes'
    and exists (
      select 1 from jsonb_array_elements(p_response->'steps') step
       where step->>'name' = 'coupang-exact-commerce-readback'
         and step->>'ok' = 'true'
         and step#>>'{data,sellerpilotVerification}' =
               'COUPANG_EXACT_QA_COMMERCE_VERIFIED'
         and step#>>'{data,data,amountInStock}' = '1'
         and step#>>'{data,data,salePrice}' = '5000'
         and step#>>'{data,data,onSale}' = 'true'
    )
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
    and v_evidence->>'remoteGalleryVerified' = 'true'
    and v_evidence->>'providerPrewriteSnapshotSha256' =
          v_prewrite.prewrite_snapshot_sha256
    and v_evidence->'prewriteImages' = v_prewrite.prewrite_images
    and jsonb_typeof(v_evidence->'postwriteImages') = 'array'
    and jsonb_array_length(v_evidence->'postwriteImages') = 9
    and v_evidence->>'providerReadbackSnapshotSha256' =
          v_post_snapshot_sha256
    and v_evidence->>'providerVendorBasenamesVerified' = 'true'
    and v_evidence->>'providerDetailImagesPreserved' = 'true'
    and v_evidence->>'providerRepresentativeChanged' in ('true','false')
    and v_evidence->>'providerRepresentativeAlreadyExpected' in ('true','false')
    and jsonb_typeof(v_evidence->'expectedContentSha256s') = 'array'
    and v_evidence->'expectedContentSha256s' = (
      select jsonb_agg(asset.value->>'contentSha256' order by asset.position)
        from jsonb_array_elements(v_job.request_payload#>
          '{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}')
          with ordinality asset(value,position)
    )
    and not exists (
      select 1 from generate_series(0,8) position
       where v_evidence#>>array[
         'postwriteImages',position::text,'vendorPath'
       ] is null
          or pg_catalog.regexp_replace(
            v_evidence#>>array['postwriteImages',position::text,'vendorPath'],
            '^.*/',''
          ) is distinct from
            (v_evidence->'expectedContentSha256s'->>position) || '.jpg'
          or (v_evidence#>>array[
            'postwriteImages',position::text,'imageOrder'
          ])::integer is distinct from position
          or v_evidence#>>array[
            'postwriteImages',position::text,'imageType'
          ] is distinct from
            case when position = 0 then 'REPRESENTATION' else 'DETAIL' end
    )
    and not exists (
      select 1 from generate_series(1,8) position
       where v_evidence->'prewriteImages'->position is distinct from
             v_evidence->'postwriteImages'->position
    )
    and v_evidence->>'providerRepresentativeChanged' = case when
      nullif(v_evidence#>>'{prewriteImages,0,cdnPath}','') is not null
      and nullif(v_evidence#>>'{postwriteImages,0,cdnPath}','') is not null
      and v_evidence#>>'{prewriteImages,0,cdnPath}' is distinct from
            v_evidence#>>'{postwriteImages,0,cdnPath}'
      then 'true' else 'false' end
    and v_evidence->>'providerRepresentativeAlreadyExpected' = case when
      pg_catalog.regexp_replace(
        v_evidence#>>'{prewriteImages,0,vendorPath}','^.*/',''
      ) = (v_evidence->'expectedContentSha256s'->>0) || '.jpg'
      and nullif(v_evidence#>>'{prewriteImages,0,cdnPath}','') is not null
      and v_evidence#>>'{prewriteImages,0,cdnPath}' =
            v_evidence#>>'{postwriteImages,0,cdnPath}'
      then 'true' else 'false' end
    and (
      v_evidence->>'providerRepresentativeChanged' = 'true'
      or v_evidence->>'providerRepresentativeAlreadyExpected' = 'true'
    ), false);
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.coupang_exact_rep_response_valid(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_rep_remote_resources_from_job(
  p_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'resources', job.response_payload#>'{remoteState,resources}',
    'verification', jsonb_build_object(
      'contract', 'coupang_exact_qa_representative_readback_v1',
      'jobId', job.id,
      'verifiedAt', job.response_payload#>>'{remoteState,verifiedAt}',
      'evidence', (
        select step->'data'->'sellerpilotCoupangExactRepresentativeReadback'
          from jsonb_array_elements(job.response_payload->'steps') step
         where step->>'name' = 'listing-readback' and step->>'ok' = 'true'
         limit 1
      ),
      'locale', 'ko-KR',
      'fingerprint', job.request_fingerprint,
      'imageCount', 8,
      'currency', 'KRW', 'price', 5000, 'stock', 1
    )
  )
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and sellerpilot_private.coupang_exact_rep_response_valid(
       job.id,job.response_payload
     )
$$;

revoke all on function
  sellerpilot_private.coupang_exact_rep_remote_resources_from_job(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_rep_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_job_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_allowed text[] := array[
    'remote_id','status','requested_publication_intent','remote_visibility',
    'provider_status','remote_resources','remote_created_at','published_at',
    'last_verified_at','last_error','failure_class','operation_attempt_id',
    'updated_at'
  ];
begin
  if p_job_id !~ '^[0-9a-fA-F-]{36}$'
     or jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object'
  then return false; end if;
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id::uuid
     and job.channel = 'coupang' and job.operation = 'listing.update'
     and job.environment = 'production' and job.status = 'succeeded'
     and job.completed_at is not null;
  if not found then return false; end if;
  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.update_job_id = v_job.id and permit.channel = 'coupang'
     and permit.consumed_at is not null;
  if not found
     or not sellerpilot_private.coupang_exact_rep_response_valid(
       v_job.id,v_job.response_payload
     )
     or (p_new - v_allowed) is distinct from (p_old - v_allowed)
     or p_new->>'id' <> '7ffc6e46-3173-4695-9889-5fa1529765f1'
     or p_new->>'id' is distinct from v_job.listing_id::text
     or p_new->>'seller_account_key' is distinct from v_job.seller_account_key
     or p_new->>'remote_id' <> '16356981734'
     or p_new->>'requested_publication_intent' <> 'live'
     or p_new->>'status' <> 'published'
     or p_new->>'remote_visibility' <> 'live'
     or p_new->>'provider_status' <> '승인완료'
     or p_new->>'operation_attempt_id' is distinct from v_job.attempt_id::text
     or p_new#>>'{remote_resources,resources,sellerProductId}' <>
          '16356981734'
     or p_new#>'{remote_resources,resources,vendorItemIds}' <>
          '["95962393877"]'::jsonb
     or p_new#>>'{remote_resources,verification,contract}' <>
          'coupang_exact_qa_representative_readback_v1'
     or p_new#>>'{remote_resources,verification,jobId}' <> v_job.id::text
     or p_new#>>'{remote_resources,verification,fingerprint}' <>
          v_job.request_fingerprint
     or p_new#>>'{remote_resources,verification,currency}' <> 'KRW'
     or p_new#>>'{remote_resources,verification,price}' <> '5000'
     or p_new#>>'{remote_resources,verification,stock}' <> '1'
     or p_new->'last_error' <> 'null'::jsonb
     or p_new->'failure_class' <> 'null'::jsonb
  then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.coupang_exact_rep_listing_update_allowed(jsonb,jsonb,text)
  from public, anon, authenticated, service_role;

do $coupang_exact_rep_listing_guard_patch$
declare
  v_definition text;
  v_before text;
  v_after text;
  v_branch constant text := '  if nullif(current_setting(''sellerpilot.coupang_exact_rep_apply'', true), '''') is not null then
    if not sellerpilot_private.coupang_exact_rep_listing_update_allowed(
      to_jsonb(old),to_jsonb(new),
      current_setting(''sellerpilot.coupang_exact_rep_apply'', true)
    ) then
      raise exception ''invalid Coupang exact representative listing projection'';
    end if;
    return new;
  end if;

';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.coupang_exact_rep_apply') > 0
  then return; end if;
  v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_already_live_adoption'', true), '''') is not null then';
  if pg_catalog.strpos(v_definition,v_before) = 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.shopee_existing_adoption'', true), '''') is not null then';
  end if;
  if pg_catalog.strpos(v_definition,v_before) = 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.elevenst_manual_live_reconciliation'', true), '''') is not null then';
  end if;
  if pg_catalog.strpos(v_definition,v_before) = 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
  end if;
  if pg_catalog.strpos(v_definition,v_before) = 0 then
    v_before := 'begin
  if old.seller_account_key is null';
  end if;
  if pg_catalog.strpos(v_definition,v_before) = 0 then
    raise exception 'Coupang listing guard preimage drifted'
      using errcode = '55000';
  end if;
  v_after := 'begin
' || v_branch || pg_catalog.substr(v_before,pg_catalog.length('begin
') + 1);
  execute pg_catalog.replace(v_definition,v_before,v_after);
end;
$coupang_exact_rep_listing_guard_patch$;

do $copy_completion_predecessor$
declare
  v_definition text;
  v_anchor constant text :=
    'public.sellerpilot_service_complete_gateway_transaction(';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_anchor,''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'gateway completion preimage drifted' using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition,v_anchor,'public.sp_173990_complete_pre('
  );
end;
$copy_completion_predecessor$;

revoke all on function public.sp_173990_complete_pre(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_complete_gateway_transaction(
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
  v_exact boolean := false;
  v_result jsonb;
begin
  select exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
    join sellerpilot_private.coupang_exact_representative_permits rep
      on rep.permit_id = permit.permit_id
   where permit.update_job_id = p_job_id and permit.channel = 'coupang'
  ) into v_exact;
  if p_status = 'succeeded' and v_exact
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = p_job_id and job.status = 'running'
     )
     and not sellerpilot_private.coupang_exact_rep_response_valid(
       p_job_id,p_response_payload
     )
  then raise exception 'invalid Coupang exact representative completion attestation'
    using errcode = '55000'; end if;
  v_result := public.sp_173990_complete_pre(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    p_error_message,p_credential_refresh,p_normalized_orders,
    p_normalized_inquiries,p_diagnostic
  );
  if v_exact and v_result->>'status' in ('completed','completed_replay')
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = p_job_id and job.status = 'succeeded'
     )
     and not sellerpilot_private.coupang_exact_rep_response_valid(
       p_job_id,
       (select job.response_payload
          from sellerpilot_private.channel_gateway_jobs job
         where job.id = p_job_id)
     )
  then raise exception 'persisted Coupang representative attestation invalid'
    using errcode = '55000'; end if;
  if v_exact and v_result->>'status' in ('completed','completed_replay')
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = p_job_id and job.status = 'succeeded'
     )
     and v_result->>'status' <> 'completed_replay'
     and v_result->>'replayed' is distinct from 'true'
  then
    perform pg_catalog.set_config(
      'sellerpilot.coupang_exact_rep_apply',p_job_id::text,true
    );
    update sellerpilot_private.product_listings listing
       set remote_id = '16356981734',
           status = 'published',
           requested_publication_intent = 'live',
           remote_visibility = 'live',
           provider_status = '승인완료',
           remote_resources =
             sellerpilot_private.coupang_exact_rep_remote_resources_from_job(
               p_job_id
             ),
           published_at = coalesce(
             listing.published_at,
             (select (job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz
                from sellerpilot_private.channel_gateway_jobs job
               where job.id = p_job_id)
           ),
           last_verified_at =
             (select (job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz
                from sellerpilot_private.channel_gateway_jobs job
               where job.id = p_job_id),
           last_error = null,
           failure_class = null,
           operation_attempt_id =
             (select job.attempt_id
                from sellerpilot_private.channel_gateway_jobs job
               where job.id = p_job_id),
           updated_at = pg_catalog.clock_timestamp()
     where listing.id = (
       select job.listing_id
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = p_job_id
     );
    if not found then
      raise exception 'Coupang exact representative listing projection failed'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

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
       new.id,
       (select job.response_payload
          from sellerpilot_private.channel_gateway_jobs job
         where job.id = new.id)
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
  v_signature regprocedure;
begin
  if pg_catalog.length('sellerpilot_service_arm_coupang_exact_rep') > 63 then
    raise exception 'Coupang exact representative RPC name exceeds PostgreSQL limit';
  end if;
  if pg_catalog.length('sellerpilot_service_bind_coupang_rep_prewrite') > 63 then
    raise exception 'Coupang exact prewrite RPC name exceeds PostgreSQL limit';
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
  select procedure.prosecdef,
         pg_catalog.array_to_string(procedure.proconfig,',')
    into strict v_security_definer, v_config
    from pg_catalog.pg_proc procedure
   where procedure.oid =
     'public.sellerpilot_service_bind_coupang_rep_prewrite(text,uuid,uuid,jsonb)'::regprocedure;
  if v_security_definer is distinct from true
     or v_config <> 'search_path=""'
     or has_function_privilege('public','public.sellerpilot_service_bind_coupang_rep_prewrite(text,uuid,uuid,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.sellerpilot_service_bind_coupang_rep_prewrite(text,uuid,uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.sellerpilot_service_bind_coupang_rep_prewrite(text,uuid,uuid,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.sellerpilot_service_bind_coupang_rep_prewrite(text,uuid,uuid,jsonb)','EXECUTE')
  then raise exception 'Coupang exact prewrite RPC metadata or ACL invalid'
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
  if not exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'sellerpilot_private'
      and relation.relname = 'coupang_exact_rep_prewrites'
      and relation.relrowsecurity
  )
     or has_table_privilege('public','sellerpilot_private.coupang_exact_rep_prewrites','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon','sellerpilot_private.coupang_exact_rep_prewrites','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','sellerpilot_private.coupang_exact_rep_prewrites','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role','sellerpilot_private.coupang_exact_rep_prewrites','SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'Coupang exact prewrite table ACL invalid'
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
        'coupang_exact_rep_remote_resources_from_job',
        'coupang_exact_rep_listing_update_allowed',
        'sp_173990_bind_claim_pre',
        'bind_exact_existing_update_claim',
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
  foreach v_signature in array array[
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select procedure.prosecdef,
           pg_catalog.array_to_string(procedure.proconfig,',')
      into strict v_security_definer,v_config
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature;
    if v_security_definer is distinct from true
       or v_config <> 'search_path=""'
       or has_function_privilege('public',v_signature,'EXECUTE')
       or has_function_privilege('anon',v_signature,'EXECUTE')
       or has_function_privilege('authenticated',v_signature,'EXECUTE')
       or not has_function_privilege('service_role',v_signature,'EXECUTE')
    then raise exception 'Coupang exact gateway wrapper metadata or ACL invalid'
      using errcode = '55000'; end if;
  end loop;
  foreach v_signature in array array[
    'public.sp_173990_enqueue_pre(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sp_173990_complete_pre(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    if has_function_privilege('public',v_signature,'EXECUTE')
       or has_function_privilege('anon',v_signature,'EXECUTE')
       or has_function_privilege('authenticated',v_signature,'EXECUTE')
       or has_function_privilege('service_role',v_signature,'EXECUTE')
    then raise exception 'Coupang exact predecessor ACL invalid'
      using errcode = '55000'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.coupang_exact_rep_apply') = 0
     or pg_catalog.strpos(
       v_definition,'coupang_exact_rep_listing_update_allowed'
     ) = 0
  then raise exception 'Coupang exact listing guard postimage invalid'
    using errcode = '55000'; end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_rep_response_valid(uuid,jsonb)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'coupang-exact-commerce-readback') = 0
     or pg_catalog.strpos(v_definition,'providerReadbackSnapshotSha256') = 0
     or pg_catalog.strpos(v_definition,'expectedContentSha256s') = 0
     or pg_catalog.strpos(v_definition,'providerObservedVisibility') = 0
  then raise exception 'Coupang exact response contract postimage invalid'
    using errcode = '55000'; end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.coupang_exact_rep_apply') = 0
     or pg_catalog.strpos(v_definition,'coupang_exact_rep_remote_resources_from_job') = 0
     or pg_catalog.strpos(v_definition,'coupang_exact_rep_response_valid') = 0
  then raise exception 'Coupang exact completion wrapper postimage invalid'
    using errcode = '55000'; end if;
end;
$coupang_exact_rep_postimage$;

commit;
