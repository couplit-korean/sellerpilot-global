-- Read the current owner-scoped product form state without asserting that its
-- detail approval or publication source is fresh enough for a provider write.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702400);

create or replace function public.sellerpilot_service_get_product_registration_context(
  p_owner_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_job sellerpilot_private.ai_cli_jobs%rowtype;
  v_external sellerpilot_private.external_detail_imports%rowtype;
  v_manual_fields jsonb := '{}'::jsonb;
  v_image_specs jsonb := '[]'::jsonb;
  v_source_paths jsonb := '[]'::jsonb;
  v_generated_paths jsonb := '{}'::jsonb;
  v_localized_listings jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_listings jsonb := '[]'::jsonb;
  v_content_mode text;
  v_detail_asset_source text;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'PRODUCT_REGISTRATION_CONTEXT_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_owner_id is null
     or not exists (
       select 1
         from sellerpilot_private.admin_users admin_user
        where admin_user.user_id = p_owner_id
     ) then
    raise exception 'PRODUCT_REGISTRATION_CONTEXT_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'PRODUCT_REGISTRATION_CONTEXT_INVALID' using errcode = '22023';
  end if;

  select product.* into v_product
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = p_owner_id
     and not product.demo
     and product.status <> 'archived';
  if v_product.id is null then return null; end if;

  if v_product.ai_job_id is not null then
    select job.* into v_job
      from sellerpilot_private.ai_cli_jobs job
     where job.id = v_product.ai_job_id
       and job.created_by = v_product.owner_id;
    if v_job.id is null then
      raise exception 'PRODUCT_REGISTRATION_CONTEXT_SOURCE_JOB_OWNER_MISMATCH'
        using errcode = '42501';
    end if;

    v_image_specs := coalesce(v_job.request_payload->'image_specs', '[]'::jsonb);
    v_source_paths := coalesce(v_job.request_payload->'image_paths', '[]'::jsonb);
    v_generated_paths := coalesce(v_job.result_payload->'asset_storage_paths', '{}'::jsonb);
    v_localized_listings := coalesce(v_job.result_payload->'localizedListings', '[]'::jsonb);
    if pg_catalog.jsonb_typeof(v_image_specs) <> 'array'
       or pg_catalog.jsonb_typeof(v_source_paths) <> 'array'
       or pg_catalog.jsonb_typeof(v_generated_paths) <> 'object'
       or pg_catalog.jsonb_typeof(v_localized_listings) <> 'array' then
      raise exception 'PRODUCT_REGISTRATION_CONTEXT_SOURCE_JOB_INVALID'
        using errcode = '22023';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(v_source_paths) with ordinality source_path(value, ordinal)
       where pg_catalog.jsonb_typeof(source_path.value) <> 'string'
          or source_path.value #>> '{}' is distinct from (
            v_product.owner_id::text || '/' || v_job.id::text || '/input/'
            || pg_catalog.lpad(source_path.ordinal::text, 3, '0') || '.jpg'
          )
    ) or exists (
      select 1
        from pg_catalog.jsonb_array_elements(v_image_specs) with ordinality image_spec(value, ordinal)
       where pg_catalog.jsonb_typeof(image_spec.value) <> 'object'
          or (
            image_spec.value ? 'originalPath'
            and (
              pg_catalog.jsonb_typeof(image_spec.value->'originalPath') <> 'string'
              or image_spec.value->>'originalPath' is distinct from (
                v_product.owner_id::text || '/' || v_job.id::text || '/original/'
                || pg_catalog.lpad(image_spec.ordinal::text, 3, '0') || '.source'
              )
            )
          )
    ) then
      raise exception 'PRODUCT_REGISTRATION_CONTEXT_SOURCE_PATH_INVALID'
        using errcode = '42501';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_each(v_generated_paths) generated(key, value)
       where pg_catalog.jsonb_typeof(generated.value) <> 'string'
          or generated.value #>> '{}' !~ (
            '^results/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/claims/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[^/]+$'
          )
          or generated.value #>> '{}' like '%..%'
    ) then
      raise exception 'PRODUCT_REGISTRATION_CONTEXT_GENERATED_PATH_INVALID'
        using errcode = '42501';
    end if;
    if exists (
      select 1
        from pg_catalog.jsonb_each_text(v_generated_paths) generated(key, path)
       where not exists (
         select 1
           from sellerpilot_private.ai_cli_jobs asset_job
          where asset_job.id = pg_catalog.split_part(generated.path, '/', 2)::uuid
            and asset_job.created_by = v_product.owner_id
       )
    ) then
      raise exception 'PRODUCT_REGISTRATION_CONTEXT_GENERATED_PATH_INVALID'
        using errcode = '42501';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(v_product.product_facts) = 'object'
     and v_product.product_facts <> '{}'::jsonb then
    v_manual_fields := v_product.product_facts;
  elsif v_job.id is not null
        and pg_catalog.jsonb_typeof(v_job.request_payload->'manual_fields') = 'object' then
    v_manual_fields := v_job.request_payload->'manual_fields';
  end if;

  if v_product.external_detail_import_id is not null then
    select external_import.* into v_external
      from sellerpilot_private.external_detail_imports external_import
     where external_import.id = v_product.external_detail_import_id
       and external_import.product_id = v_product.id
       and external_import.owner_id = v_product.owner_id;
    if v_external.id is null then
      raise exception 'PRODUCT_REGISTRATION_CONTEXT_EXTERNAL_OWNER_MISMATCH'
        using errcode = '42501';
    end if;
    v_content_mode := 'external_generated';
    v_detail_asset_source := 'external_generated';
  elsif v_job.kind = 'manual_product' then
    v_content_mode := 'manual_mvp';
    v_detail_asset_source := 'manual_source';
  elsif v_job.id is not null then
    v_content_mode := 'ai_generated';
    v_detail_asset_source := 'ai_generated';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', assignment.id,
      'channel', assignment.channel,
      'environment', assignment.environment,
      'market', assignment.market,
      'categoryId', assignment.category_id,
      'categoryPath', assignment.category_path,
      'providedAttributes', coalesce((
        select pg_catalog.jsonb_object_agg(attribute.key, attribute.value)
          from pg_catalog.jsonb_each(assignment.provided_attributes) attribute(key, value)
         where pg_catalog.jsonb_typeof(attribute.value) = 'string'
            or (
              pg_catalog.jsonb_typeof(attribute.value) = 'array'
              and not exists (
                select 1
                  from pg_catalog.jsonb_array_elements(attribute.value) item(value)
                 where pg_catalog.jsonb_typeof(item.value) <> 'string'
              )
            )
      ), '{}'::jsonb),
      'status', assignment.status,
      'confirmedAt', assignment.confirmed_at,
      'requiredAttributes', assignment.required_attributes,
      'officialMetadata', assignment.official_metadata,
      'missingRequiredAttributes', assignment.missing_required_attributes,
      'officialVerifiedAt', assignment.official_verified_at,
      'isLeaf', assignment.is_leaf,
      'classificationSource', assignment.classification_source
    ) order by assignment.channel, assignment.market
  ), '[]'::jsonb) into v_assignments
    from sellerpilot_private.product_category_assignments assignment
   where assignment.product_id = v_product.id
     and assignment.owner_id = v_product.owner_id;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', listing.id,
      'channel', listing.channel_key,
      'market', listing.market,
      'targetId', listing.target_id,
      'remoteId', listing.remote_id,
      'marketplaceSku', listing.marketplace_sku,
      'publicUrl', listing.public_url,
      'publicPageStatus', listing.public_page_status,
      'publicPageCheckedAt', listing.public_page_checked_at,
      'status', listing.status,
      'currency', listing.currency,
      'price', listing.price,
      'lastError', listing.last_error,
      'failureClass', listing.failure_class,
      'inventorySyncStatus', listing.inventory_sync_status,
      'lastInventoryQuantity', listing.last_inventory_quantity,
      'inventorySyncError', listing.inventory_sync_error,
      'lastInventorySyncedAt', listing.last_inventory_synced_at,
      'publishedAt', listing.published_at,
      'sellerAccountKey', listing.seller_account_key,
      'operationAttemptId', listing.operation_attempt_id,
      'requestedPublicationIntent', listing.requested_publication_intent,
      'remoteVisibility', listing.remote_visibility,
      'providerStatus', listing.provider_status,
      'remoteResources', listing.remote_resources,
      'remoteCreatedAt', listing.remote_created_at,
      'remoteVerifiedAt', listing.last_verified_at,
      'updatedAt', listing.updated_at
    ) order by listing.channel_key, listing.market, listing.target_id
  ), '[]'::jsonb) into v_listings
    from sellerpilot_private.product_listings listing
   where listing.product_id = v_product.id
     and listing.owner_id = v_product.owner_id;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_product_registration_context_v1',
    'contextMode', 'editing_only',
    'ownerId', v_product.owner_id,
    'product', pg_catalog.jsonb_build_object(
      'id', v_product.id,
      'externalCode', v_product.external_code,
      'sku', v_product.sku,
      'name', v_product.name,
      'description', v_product.description,
      'sourceUrl', v_product.source_url,
      'status', v_product.status,
      'onHand', v_product.on_hand,
      'costKrw', v_product.cost_krw
    ),
    'manualFields', v_manual_fields,
    'imageSpecs', v_image_specs,
    'sourceImagePaths', v_source_paths,
    'generatedImagePaths', v_generated_paths,
    'localizedListings', v_localized_listings,
    'assignments', v_assignments,
    'listings', v_listings,
    'detailPage', pg_catalog.jsonb_build_object(
      'data', v_product.detail_page_data,
      'version', v_product.detail_page_version,
      'approvedVersion', v_product.detail_page_approved_version,
      'imageManifest', v_product.detail_page_image_manifest,
      'updatedAt', v_product.detail_page_updated_at
    ),
    'contentMode', v_content_mode,
    'detailAssetSource', v_detail_asset_source,
    'studioResult', v_job.result_payload,
    'studioJob', case when v_job.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'kind', v_job.kind,
      'status', v_job.status
    ) end,
    'classification', case
      when pg_catalog.jsonb_typeof(v_job.result_payload->'product'->'classification') = 'object'
        then v_job.result_payload->'product'->'classification'
      else null
    end,
    'externalDetailState', case when v_external.id is null then null else pg_catalog.jsonb_build_object(
      'id', v_external.id,
      'status', v_external.status,
      'approvedAt', v_external.approved_at,
      'approvedProductUpdatedAt', v_external.approved_product_updated_at,
      'approvedDetailVersion', v_external.approved_detail_version
    ) end
  );
end;
$$;

revoke all on function public.sellerpilot_service_get_product_registration_context(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_product_registration_context(uuid, uuid)
  to service_role;

commit;
