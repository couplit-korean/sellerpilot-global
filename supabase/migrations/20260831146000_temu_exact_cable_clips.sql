-- Prepare one exact Temu cable-clip QA create without synthesizing a
-- credential, listing, category, or shipping template. The provider app and
-- store remain external prerequisites; this migration only hardens the
-- server-owned request and terminal readback contracts.

begin;

do $migration$
declare
  v_reserve_definition text;
  v_terminal_definition text;
  v_history_reached_predecessor boolean := false;
  v_exact_predecessor boolean := false;
  v_later_history boolean := false;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $history$
      select
        exists (
          select 1
            from supabase_migrations.schema_migrations migration
           where migration.version = '20260831145000'
             and migration.name = 'release_smartstore_from_static_egress'
        ),
        exists (
          select 1
            from supabase_migrations.schema_migrations migration
           where migration.version >= '20260831145000'
        ),
        exists (
          select 1
            from supabase_migrations.schema_migrations migration
           where migration.version > '20260831145000'
        )
    $history$
      into v_exact_predecessor, v_history_reached_predecessor, v_later_history;
  end if;
  if v_history_reached_predecessor
     and (not v_exact_predecessor or v_later_history) then
    raise exception 'Temu exact cable migration history drifted';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)'::regprocedure
  ) into v_reserve_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.temu_terminal_remote_state_valid(uuid,text,text,integer,text[])'::regprocedure
  ) into v_terminal_definition;
  if v_reserve_definition is null
     or position(
       'sellerpilot_311430_reserve_before_ebay_exact_existing_qa_fence'
       in v_reserve_definition
     ) = 0
     or v_terminal_definition is null
     or position('temu_list_status_detail_stock_v2' in v_terminal_definition) = 0
     or position('temu_list_status_detail_stock_v3' in v_terminal_definition) > 0 then
    raise exception 'Temu exact cable executable preimage drifted';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'temu'
       and job.operation in (
         'listing.create', 'listing.activate', 'listing.publication.verify'
       )
       and job.status in ('queued', 'running')
  ) then
    raise exception 'Temu publication jobs must be idle before exact cable migration';
  end if;
end;
$migration$;

alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_311460_reserve_before_temu_exact_cable_fence;

revoke all on function
  public.sellerpilot_311460_reserve_before_temu_exact_cable_fence(
    uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_body jsonb := p_request_payload#>'{arguments,body}';
  v_goods_basic jsonb := p_request_payload#>'{arguments,body,goodsBasic}';
  v_sku_list jsonb := p_request_payload#>'{arguments,body,skuList}';
  v_sku jsonb;
  v_carousel jsonb := p_request_payload#>'{arguments,body,goodsBasic,goodsCarouselImage}';
  v_details jsonb := p_request_payload#>'{arguments,body,goodsBasic,detailImage}';
  v_marker jsonb := p_request_payload#>'{arguments,sellerpilotTemuCreateCorrelation}';
  v_binding jsonb := p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
  v_bound_transport_urls jsonb;
  v_category_id text;
  v_external_goods_id text;
  v_attempt_idempotency_key text;
  v_expected_scope_fingerprint text;
  v_owner_id uuid;
  v_environment text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_channel = 'temu'
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid then
    select product.owner_id
      into v_owner_id
      from sellerpilot_private.products product
     where product.id = p_product_id
       and product.sku = 'QA-20260823-CC-001'
       and not product.demo
       and product.status <> 'archived'
       and product.on_hand - product.reserved = 1
     for key share;
    if not found then
      raise exception 'TEMU_EXACT_CABLE_PRODUCT_IDENTITY_MISMATCH'
        using errcode = '55000';
    end if;

    select credential.environment
      into v_environment
      from sellerpilot_private.channel_credentials credential
     where credential.id = p_credential_id
       and credential.channel = 'temu'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > statement_timestamp())
     for update;
    if not found then
      raise exception 'TEMU_EXACT_CABLE_ACTIVE_CREDENTIAL_REQUIRED'
        using errcode = '55000';
    end if;

    select attempt.idempotency_key
      into v_attempt_idempotency_key
      from sellerpilot_private.channel_operation_attempts attempt
     where attempt.id = p_attempt_id
       and attempt.owner_id = v_owner_id
       and attempt.credential_id = p_credential_id
       and attempt.channel = 'temu'
       and attempt.operation = 'listing.create'
       and attempt.status = 'running'
       and attempt.request_fingerprint = p_request_fingerprint
     for update;
    if not found then
      raise exception 'TEMU_EXACT_CABLE_ATTEMPT_LINEAGE_MISMATCH'
        using errcode = '55000';
    end if;

    select assignment.category_id
      into v_category_id
      from sellerpilot_private.product_category_assignments assignment
     where assignment.owner_id = v_owner_id
       and assignment.product_id = p_product_id
       and assignment.channel = 'temu'
       and assignment.environment = v_environment
       and upper(trim(assignment.market)) = 'KR'
       and assignment.status = 'confirmed'
       and assignment.is_leaf
       and jsonb_array_length(assignment.missing_required_attributes) = 0
       and assignment.confirmed_at is not null
     for key share;
    if not found or v_category_id !~ '^[1-9][0-9]*$' then
      raise exception 'TEMU_EXACT_CABLE_CONFIRMED_LEAF_REQUIRED'
        using errcode = '55000';
    end if;

    if jsonb_typeof(v_arguments) is distinct from 'object'
       or jsonb_typeof(v_body) is distinct from 'object'
       or jsonb_typeof(v_goods_basic) is distinct from 'object'
       or p_market is distinct from 'KR'
       or upper(trim(coalesce(p_currency, ''))) is distinct from 'KRW'
       or p_price is distinct from 5000
       or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
       or v_arguments->>'publicationIntent' is distinct from 'safe_test'
       or v_arguments->>'publicationStateContract' is distinct from 'verified_remote_state_v1'
       or v_arguments->>'publicationExpectedLocale' is distinct from 'ko-KR'
       or v_arguments->>'publicationExpectedImageCount' is distinct from '8'
       or v_arguments->>'publicationExpectedFingerprint' is distinct from p_request_fingerprint
       or v_body->>'language' is distinct from 'ko'
       or v_goods_basic->>'extCatName' is distinct from v_category_id
       or nullif(trim(v_goods_basic->>'costTemplate'), '') is null
       or length(v_goods_basic->>'costTemplate') > 500
       or v_goods_basic->>'costTemplate' ~ '[[:cntrl:]]'
       or lower(trim(v_goods_basic->>'costTemplate')) in (
         'server_managed', 'unknown', 'n/a', '미확인', '확인 필요'
       ) then
      raise exception 'TEMU_EXACT_CABLE_REQUEST_CONTEXT_MISMATCH'
        using errcode = '55000';
    end if;

    v_external_goods_id := v_goods_basic->>'externalGoodsId';
    v_expected_scope_fingerprint := encode(extensions.digest(
      '{"contract":"temu_create_attempt_external_id_v1",' ||
      '"productId":"ddccde35-9c58-4856-b673-d7aa27ce4220",' ||
      '"sourceSku":"QA-20260823-CC-001",' ||
      '"market":"KR","targetId":' || to_jsonb(trim(coalesce(p_target_id, '')))::text ||
      ',"idempotencyKey":' || to_jsonb(v_attempt_idempotency_key)::text || '}',
      'sha256'
    ), 'hex');
    if coalesce(v_external_goods_id, '') !~ '^SP-DDCCDE359C58-[A-F0-9]{32}$'
       or jsonb_typeof(v_marker) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_marker)) is distinct from 5
       or v_marker->>'version' is distinct from 'temu_create_attempt_external_id_v1'
       or v_marker->>'sourceSellerSku' is distinct from 'QA-20260823-CC-001'
       or v_marker->>'externalGoodsId' is distinct from v_external_goods_id
       or coalesce(v_marker->>'scopeFingerprint', '') !~ '^[a-f0-9]{64}$'
       or v_marker->>'scopeFingerprint' is distinct from
            v_expected_scope_fingerprint
       or v_external_goods_id is distinct from
            'SP-DDCCDE359C58-' || upper(left(v_expected_scope_fingerprint, 32))
       or v_marker->>'skuCount' is distinct from '1' then
      raise exception 'TEMU_EXACT_CABLE_EXTERNAL_ID_MISMATCH'
        using errcode = '55000';
    end if;

    if jsonb_typeof(v_sku_list) is distinct from 'array'
       or jsonb_array_length(v_sku_list) is distinct from 1 then
      raise exception 'TEMU_EXACT_CABLE_SKU_CONTRACT_MISMATCH'
        using errcode = '55000';
    end if;
    v_sku := v_sku_list->0;
    if jsonb_typeof(v_sku) is distinct from 'object'
       or v_sku->>'externalSkuId' is distinct from v_external_goods_id || '-01'
       or v_sku->>'quantity' is distinct from '1'
       or v_sku#>>'{price,basePrice,amount}' is distinct from '5000'
       or upper(trim(coalesce(v_sku#>>'{price,basePrice,currency}', '')))
            is distinct from 'KRW' then
      raise exception 'TEMU_EXACT_CABLE_SKU_CONTRACT_MISMATCH'
        using errcode = '55000';
    end if;

    if jsonb_typeof(v_carousel) is distinct from 'array'
       or jsonb_array_length(v_carousel) is distinct from 1
       or jsonb_typeof(v_details) is distinct from 'array'
       or jsonb_array_length(v_details) is distinct from 8 then
      raise exception 'TEMU_EXACT_CABLE_IMAGE_CONTRACT_MISMATCH'
        using errcode = '55000';
    end if;
    if (select count(distinct image.value) from jsonb_array_elements_text(v_details) image(value))
         is distinct from 8
       or exists (
         select 1
           from jsonb_array_elements_text(v_carousel || v_details) image(value)
          where image.value !~ '^https://'
       )
       or exists (
         select 1
           from jsonb_array_elements_text(v_details) detail(value)
          where detail.value = v_carousel->>0
       ) then
      raise exception 'TEMU_EXACT_CABLE_IMAGE_CONTRACT_MISMATCH'
        using errcode = '55000';
    end if;

    select jsonb_agg(entry.value->>'publicUrl' order by entry.ordinality)
      into v_bound_transport_urls
      from jsonb_array_elements(case
        when jsonb_typeof(v_binding->'providerTransportImages') = 'array'
          then v_binding->'providerTransportImages'
        else '[]'::jsonb
      end) with ordinality entry(value, ordinality);
    if sellerpilot_private.temu_publication_asset_identity(v_binding) is null
       or v_binding->>'providerImageSurface' is distinct from 'detail_content'
       or jsonb_typeof(v_binding->'providerTransportImages') is distinct from 'array'
       or jsonb_array_length(v_binding->'providerTransportImages') is distinct from 8
       or v_bound_transport_urls is distinct from v_details then
      raise exception 'TEMU_EXACT_CABLE_APPROVED_ASSET_BINDING_REQUIRED'
        using errcode = '55000';
    end if;
  end if;

  return public.sellerpilot_311460_reserve_before_temu_exact_cable_fence(
    p_product_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_market,
    p_target_id,
    p_currency,
    p_price,
    p_request_fingerprint,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

create or replace function sellerpilot_private.temu_terminal_remote_state_valid(
  p_job_id uuid,
  p_goods_id text,
  p_external_goods_id text,
  p_expected_image_count integer,
  p_allowed_visibility text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_state jsonb;
  v_asset jsonb;
  v_source_binding jsonb;
  v_bound_transport_urls jsonb;
  v_carousel jsonb;
  v_details jsonb;
  v_verified_at timestamptz;
begin
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='temu'
     and job.status='succeeded' and job.completed_at is not null;
  if not found or v_job.response_payload->>'ok' is distinct from 'true'
     or v_job.response_payload->>'publicationStateContract' is distinct from
          'verified_remote_state_v1'
     or v_job.response_payload->>'remoteId' is distinct from p_goods_id then return false; end if;
  v_state:=v_job.response_payload->'remoteState';
  begin v_verified_at:=(v_state->>'verifiedAt')::timestamptz;
  exception when others then return false; end;
  if v_state#>>'{evidence,imageOrderVerified}' is distinct from 'true'
     or v_state#>>'{evidence,contentVerified}' is distinct from 'true'
     or v_state#>>'{evidence,skuIdentityVerified}' is distinct from 'true'
     or v_state#>>'{evidence,priceVerified}' is distinct from 'true'
     or v_state#>>'{evidence,stockVerified}' is distinct from 'true'
     or v_state#>>'{evidence,goodsIdVerified}' is distinct from 'true'
     or v_state#>>'{evidence,externalGoodsIdVerified}' is distinct from 'true' then
    return false;
  end if;
  if p_expected_image_count=8 then
    v_asset:=v_state#>'{evidence,publicationAssetBinding}';
    v_source_binding:=v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
    v_carousel:=v_job.request_payload#>'{arguments,body,goodsBasic,goodsCarouselImage}';
    v_details:=v_job.request_payload#>'{arguments,body,goodsBasic,detailImage}';
    select jsonb_agg(entry.value->>'publicUrl' order by entry.ordinality)
      into v_bound_transport_urls
      from jsonb_array_elements(case
        when jsonb_typeof(v_source_binding->'providerTransportImages') = 'array'
          then v_source_binding->'providerTransportImages'
        else '[]'::jsonb
      end) with ordinality entry(value, ordinality);
    if v_state#>>'{evidence,version}' is distinct from 'temu_list_status_detail_stock_v3'
       or v_state#>>'{evidence,representativeImageVerified}' is distinct from 'true'
       or v_state#>>'{evidence,observedRepresentativeImageCount}' is distinct from '1'
       or coalesce(v_state#>>'{evidence,representativeImageDigest}','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(v_carousel) is distinct from 'array'
       or jsonb_array_length(v_carousel) is distinct from 1
       or jsonb_typeof(v_details) is distinct from 'array'
       or jsonb_array_length(v_details) is distinct from 8
       or v_state#>>'{evidence,representativeImageDigest}' is distinct from
            encode(extensions.digest(v_carousel::text,'sha256'),'hex')
       or exists (
         select 1 from jsonb_array_elements_text(v_details) detail(value)
          where detail.value=v_carousel->>0
       )
       or not (
         coalesce(v_state#>'{evidence,readbackMethods}','[]'::jsonb)
           @> '["temu.local.goods.sku.stock.query"]'::jsonb
       )
       or jsonb_typeof(v_job.request_payload#>'{arguments,body,skuList}') is distinct from 'array'
       or jsonb_array_length(v_job.request_payload#>'{arguments,body,skuList}')<1
       or v_state#>>'{evidence,observedSkuCount}' is distinct from
            jsonb_array_length(v_job.request_payload#>'{arguments,body,skuList}')::text
       or jsonb_typeof(v_asset) is distinct from 'object'
       or v_asset->>'contract' is distinct from 'sellerpilot_provider_asset_binding_v1'
       or v_asset->>'providerImageSurface' is distinct from 'detail_content'
       or coalesce(v_asset->>'sourceAssetBindingDigest','') !~ '^[a-f0-9]{64}$'
       or coalesce(v_asset->>'providerImageDigest','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(v_asset->'approvedDetailRoles') is distinct from 'array'
       or jsonb_array_length(v_asset->'approvedDetailRoles') is distinct from 8
       or jsonb_typeof(v_asset->'providerTransportRoles') is distinct from 'array'
       or v_asset->'providerTransportRoles' is distinct from v_asset->'approvedDetailRoles'
       or jsonb_typeof(v_asset->'providerDetailImageIdentities') is distinct from 'array'
       or jsonb_array_length(v_asset->'providerDetailImageIdentities') is distinct from 8
       or v_bound_transport_urls is distinct from v_details
       or v_asset->'providerDetailImageIdentities' is distinct from v_details
       or (select count(distinct image.value)::integer
             from jsonb_array_elements_text(
               v_asset->'providerDetailImageIdentities'
             ) image(value)) is distinct from 8
       or not exists(
         select 1
           from sellerpilot_private.product_listings listing
           join sellerpilot_private.products product
             on product.id=listing.product_id and product.owner_id=listing.owner_id
          where listing.id=v_job.listing_id
            and product.detail_page_approved_version is not null
            and product.detail_page_version=product.detail_page_approved_version
            and product.detail_page_image_manifest->>'contract'=
                 'sellerpilot_detail_image_manifest_v2'
            and product.detail_page_image_manifest->>'algorithm'='sha256'
            and product.detail_page_image_manifest->>'digest'=
                 v_asset->>'approvedManifestDigest'
            and product.detail_page_approved_version::text=
                 v_asset->>'approvedDetailPageVersion'
            and sellerpilot_private.temu_publication_asset_identity(
                  v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
                ) is not null
            and v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}'=
                 v_asset->>'approvedManifestDigest'
            and v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}'=
                 v_asset->>'approvedDetailPageVersion'
            and not exists(
              select 1
                from jsonb_array_elements(
                  v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
                ) with ordinality bound(image,position)
                full join jsonb_array_elements(product.detail_page_image_manifest->'images')
                  with ordinality current_image(image,position)
                  using(position)
               where bound.image is null or current_image.image is null
                  or bound.image->>'role' is distinct from current_image.image->>'role'
                  or bound.image->>'approvedObjectPath' is distinct from current_image.image->>'path'
                  or bound.image->>'approvedSourceSha256' is distinct from current_image.image->>'sourceSha256'
            )
            and v_asset->'approvedDetailRoles'=(
              select jsonb_agg(image.value->>'role' order by image.ordinality)
                from jsonb_array_elements(
                  product.detail_page_image_manifest->'images'
                ) with ordinality image(value,ordinality)
            )
       ) then
      return false;
    end if;
  elsif p_expected_image_count is distinct from 0 then
    return false;
  end if;
  return v_state->>'verified' is not distinct from 'true'
    and coalesce(v_state->>'visibility'=any(p_allowed_visibility),false)
    and coalesce(v_state->>'providerStatus','')<>''
    and v_state->>'locale' is not distinct from 'ko-KR'
    and v_state->>'fingerprint' is not distinct from v_job.request_fingerprint
    and v_state->>'imageCount' is not distinct from p_expected_image_count::text
    and v_state#>>'{resources,goodsId}' is not distinct from p_goods_id
    and v_state#>>'{resources,externalGoodsId}' is not distinct from p_external_goods_id
    and v_state#>>'{evidence,identityVerified}' is not distinct from 'true'
    and v_state#>>'{evidence,statusVerified}' is not distinct from 'true'
    and v_state#>>'{evidence,localeVerified}' is not distinct from 'true'
    and v_state#>>'{evidence,fingerprintVerified}' is not distinct from 'true'
    and v_state#>>'{evidence,imageCountVerified}' is not distinct from 'true'
    and coalesce(v_verified_at>=v_job.provider_mutation_started_at,false)
    and coalesce(v_verified_at<=clock_timestamp()+interval '5 minutes',false);
exception when others then return false;
end;
$$;

revoke all on function sellerpilot_private.temu_terminal_remote_state_valid(
  uuid, text, text, integer, text[]
) from public, anon, authenticated, service_role;

do $migration$
declare
  v_reserve_definition text;
  v_terminal_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)'::regprocedure
  ) into v_reserve_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.temu_terminal_remote_state_valid(uuid,text,text,integer,text[])'::regprocedure
  ) into v_terminal_definition;
  if v_reserve_definition is null
     or position('TEMU_EXACT_CABLE_IMAGE_CONTRACT_MISMATCH' in v_reserve_definition) = 0
     or position('sellerpilot_311460_reserve_before_temu_exact_cable_fence' in v_reserve_definition) = 0
     or v_terminal_definition is null
     or position('temu_list_status_detail_stock_v3' in v_terminal_definition) = 0
     or position('representativeImageVerified' in v_terminal_definition) = 0
     or position('temu_list_status_detail_stock_v2' in v_terminal_definition) > 0
     or not has_function_privilege(
       'service_role',
       'public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'Temu exact cable executable postimage failed';
  end if;
end;
$migration$;

comment on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) is
  'Preserves all existing listing-create gates and exact-binds the one Temu cable QA product to its confirmed leaf category, explicit shipping template, KRW 5000, stock 1, derived external IDs, one representative, eight approved details, and safe-test intent.';
comment on function sellerpilot_private.temu_terminal_remote_state_valid(
  uuid, text, text, integer, text[]
) is
  'Accepts Temu terminal publication evidence only after exact immutable IDs, commerce, one representative image, eight approved details, and independent list/status/detail/stock readbacks.';

commit;
