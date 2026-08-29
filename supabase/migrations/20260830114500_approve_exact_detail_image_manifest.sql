-- Approve one exact eight-image Puck document against the current 16-asset
-- Studio ledger. Existing pages remain readable but unapproved until an
-- operator saves a valid eight-image document through the guarded RPC.

begin;

alter table sellerpilot_private.products
  add column if not exists detail_page_approved_version bigint not null default 0,
  add column if not exists detail_page_image_manifest jsonb;

alter table sellerpilot_private.products
  drop constraint if exists products_detail_page_approval_check;
alter table sellerpilot_private.products
  add constraint products_detail_page_approval_check check (
    (
      detail_page_approved_version = 0
      and detail_page_image_manifest is null
    )
    or (
      detail_page_data is not null
      and detail_page_version > 0
      and detail_page_approved_version = detail_page_version
      and jsonb_typeof(detail_page_image_manifest) = 'object'
      and detail_page_image_manifest->>'contract' = 'sellerpilot_detail_image_manifest_v1'
      and detail_page_image_manifest->>'algorithm' = 'sha256'
      and detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(detail_page_image_manifest->'images') = 'array'
      and jsonb_array_length(detail_page_image_manifest->'images') = 8
    )
  );

create or replace function sellerpilot_private.detail_page_asset_path_is_valid(
  p_role text,
  p_path text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_file text := case p_role
    when 'detail-overview' then 'detail-overview.png'
    when 'detail-feature' then 'detail-feature.png'
    when 'detail-use' then 'detail-use.png'
    when 'detail-package' then 'detail-package.png'
    when 'detail-routine' then 'detail-routine.png'
    when 'detail-scale' then 'detail-scale.png'
    when 'detail-storage' then 'detail-storage.png'
    when 'detail-context' then 'detail-context.png'
    when 'detail-material' then 'detail-material.png'
    when 'detail-dimensions' then 'detail-dimensions.png'
    when 'detail-contents' then 'detail-contents.png'
    when 'detail-care' then 'detail-care.png'
    else null
  end;
  v_uuid_pattern text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
begin
  return v_file is not null
    and coalesce(p_path, '') ~ (
      '^results/' || v_uuid_pattern || '/claims/' || v_uuid_pattern || '/' || replace(v_file, '.', '[.]') || '$'
    );
end;
$$;

revoke all on function sellerpilot_private.detail_page_asset_path_is_valid(text, text)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.clear_stale_detail_page_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ai_job_id is distinct from old.ai_job_id
     or new.detail_page_data is null
     or new.detail_page_version = 0
     or (
       (
         new.detail_page_data is distinct from old.detail_page_data
         or new.detail_page_version is distinct from old.detail_page_version
       )
       and (
         new.detail_page_data is not distinct from old.detail_page_data
         or new.detail_page_version <> old.detail_page_version + 1
         or new.detail_page_approved_version is distinct from new.detail_page_version
         or new.detail_page_image_manifest is null
       )
     ) then
    new.detail_page_approved_version := 0;
    new.detail_page_image_manifest := null;
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.clear_stale_detail_page_approval()
  from public, anon, authenticated, service_role;

drop trigger if exists products_clear_stale_detail_page_approval
  on sellerpilot_private.products;
create trigger products_clear_stale_detail_page_approval
before update of ai_job_id, detail_page_data, detail_page_version
on sellerpilot_private.products
for each row execute function sellerpilot_private.clear_stale_detail_page_approval();

create or replace function public.sellerpilot_get_product_detail_page(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'productId', product.id,
    'data', product.detail_page_data,
    'version', product.detail_page_version,
    'approvedVersion', product.detail_page_approved_version,
    'imageManifest', product.detail_page_image_manifest,
    'updatedAt', product.detail_page_updated_at
  )
    into v_result
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = auth.uid()
     and not product.demo
     and product.status <> 'archived';
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_get_product_detail_page(uuid)
  from public, anon, service_role;
grant execute on function public.sellerpilot_get_product_detail_page(uuid)
  to authenticated;

create or replace function public.sellerpilot_save_product_detail_page(
  p_product_id uuid,
  p_data jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_generated_paths jsonb;
  v_manifest_images jsonb;
  v_manifest_input text;
  v_manifest_digest text;
  v_manifest jsonb;
  v_next_version bigint;
  v_updated_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_product_id is null
     or p_data is null
     or jsonb_typeof(p_data) <> 'object'
     or octet_length(p_data::text) > 262144
     or jsonb_typeof(p_data->'root') is distinct from 'object'
     or jsonb_typeof(p_data->'content') is distinct from 'array'
     or jsonb_array_length(p_data->'content') > 64
     or exists (
       select 1
         from jsonb_array_elements(p_data->'content') block
        where jsonb_typeof(block) is distinct from 'object'
           or coalesce(block->>'type', '') not in (
             'HeroBlock',
             'VerificationRibbonBlock',
             'BenefitBlock',
             'ImageStoryBlock',
             'AnimatedGifBlock',
             'StoryBlock',
             'CtaBlock'
           )
           or jsonb_typeof(block->'props') is distinct from 'object'
           or length(trim(coalesce(block->'props'->>'id', ''))) not between 1 and 120
           or (
             block->>'type' = 'AnimatedGifBlock'
             and (
               jsonb_typeof(block->'props'->'id') is distinct from 'string'
               or jsonb_typeof(block->'props'->'gifUrl') is distinct from 'string'
               or jsonb_typeof(block->'props'->'posterUrl') is distinct from 'string'
               or jsonb_typeof(block->'props'->'alt') is distinct from 'string'
               or jsonb_typeof(block->'props'->'caption') is distinct from 'string'
               or jsonb_typeof(block->'props'->'tone') is distinct from 'string'
               or not sellerpilot_private.detail_page_media_url_is_valid(block->'props'->>'gifUrl', 'gif')
               or not sellerpilot_private.detail_page_media_url_is_valid(block->'props'->>'posterUrl', 'poster')
               or length(trim(coalesce(block->'props'->>'alt', ''))) not between 1 and 500
               or length(trim(coalesce(block->'props'->>'caption', ''))) not between 1 and 2000
               or coalesce(block->'props'->>'tone', '') not in ('light', 'dark')
             )
           )
     )
     or (
       select count(*) <> count(distinct block->'props'->>'id')
         from jsonb_array_elements(p_data->'content') block
     )
     or (
       select count(*) <> 8
         from jsonb_array_elements(p_data->'content') block
        where block->>'type' = 'ImageStoryBlock'
     )
     or exists (
       select 1
         from jsonb_array_elements(p_data->'content') block
        where block->>'type' = 'ImageStoryBlock'
          and (
            jsonb_typeof(block->'props'->'imageUrl') is distinct from 'string'
            or coalesce(block->'props'->>'imageUrl', '') !~ '^sellerpilot-asset://detail-[a-z-]+$'
            or substring(block->'props'->>'imageUrl' from 21) not in (
              'detail-overview', 'detail-feature', 'detail-use', 'detail-package',
              'detail-routine', 'detail-scale', 'detail-storage', 'detail-context',
              'detail-material', 'detail-dimensions', 'detail-contents', 'detail-care'
            )
            or jsonb_typeof(block->'props'->'imageAlt') is distinct from 'string'
            or length(trim(coalesce(block->'props'->>'imageAlt', ''))) not between 1 and 180
            or (
              block->'props' ? 'imageRole'
              and (
                jsonb_typeof(block->'props'->'imageRole') is distinct from 'string'
                or block->'props'->>'imageRole' <> substring(block->'props'->>'imageUrl' from 21)
              )
            )
          )
     )
     or (
       select count(*) <> count(distinct block->'props'->>'imageUrl')
         from jsonb_array_elements(p_data->'content') block
        where block->>'type' = 'ImageStoryBlock'
     ) then
    raise exception 'DETAIL_PAGE_INVALID';
  end if;

  select product.* into v_product
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = auth.uid()
     and not product.demo
     and product.status <> 'archived'
   for update;
  if not found then return null; end if;

  if (p_expected_version is null and v_product.detail_page_version <> 0)
     or (
       p_expected_version is not null
       and p_expected_version <> v_product.detail_page_version
     ) then
    raise exception 'DETAIL_PAGE_VERSION_CONFLICT' using errcode = '40001';
  end if;

  select job.result_payload->'asset_storage_paths'
    into v_generated_paths
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_product.ai_job_id
     and job.kind = 'product_studio'
     and job.created_by = v_product.owner_id
     and job.status = 'succeeded'
     and job.result_payload->>'mode' = 'cli';

  if jsonb_typeof(v_generated_paths) is distinct from 'object'
     or (
       select count(*) <> 16
         from jsonb_object_keys(v_generated_paths)
     )
     or exists (
       select 1
         from jsonb_array_elements(p_data->'content') block
        cross join lateral (
          select substring(block->'props'->>'imageUrl' from 21) as role
        ) selected
        where block->>'type' = 'ImageStoryBlock'
          and (
            not sellerpilot_private.detail_page_asset_path_is_valid(
              selected.role,
              v_generated_paths->>selected.role
            )
            or not exists (
              select 1
                from storage.objects stored
               where stored.bucket_id = 'sellerpilot-ai'
                 and stored.name = v_generated_paths->>selected.role
            )
          )
     )
     or (
       select count(*) <> count(distinct v_generated_paths->>selected.role)
         from jsonb_array_elements(p_data->'content') block
        cross join lateral (
          select substring(block->'props'->>'imageUrl' from 21) as role
        ) selected
        where block->>'type' = 'ImageStoryBlock'
     ) then
    raise exception 'DETAIL_PAGE_ASSETS_UNRESOLVED';
  end if;

  with image_blocks as (
    select substring(entry.value->'props'->>'imageUrl' from 21) as role,
           v_generated_paths->>substring(entry.value->'props'->>'imageUrl' from 21) as path,
           entry.ordinality
      from jsonb_array_elements(p_data->'content') with ordinality entry(value, ordinality)
     where entry.value->>'type' = 'ImageStoryBlock'
  )
  select jsonb_agg(
           jsonb_build_object('role', image_blocks.role, 'path', image_blocks.path)
           order by image_blocks.ordinality
         ),
         string_agg(
           image_blocks.role || chr(9) || image_blocks.path,
           chr(10)
           order by image_blocks.ordinality
         )
    into v_manifest_images, v_manifest_input
    from image_blocks;

  v_manifest_digest := encode(
    extensions.digest(v_manifest_input, 'sha256'),
    'hex'
  );
  v_manifest := jsonb_build_object(
    'contract', 'sellerpilot_detail_image_manifest_v1',
    'algorithm', 'sha256',
    'digest', v_manifest_digest,
    'images', v_manifest_images
  );

  v_next_version := v_product.detail_page_version + 1;
  update sellerpilot_private.products product
     set detail_page_data = p_data,
         detail_page_version = v_next_version,
         detail_page_updated_at = v_updated_at,
         detail_page_approved_version = v_next_version,
         detail_page_image_manifest = v_manifest,
         updated_at = v_updated_at
   where product.id = p_product_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    auth.uid(),
    'product_detail_page_saved',
    'product',
    p_product_id::text,
    jsonb_build_object(
      'version', v_next_version,
      'block_count', jsonb_array_length(p_data->'content'),
      'document_bytes', octet_length(p_data::text),
      'image_count', 8,
      'manifest_digest', v_manifest_digest
    )
  );

  return jsonb_build_object(
    'productId', p_product_id,
    'data', p_data,
    'version', v_next_version,
    'approvedVersion', v_next_version,
    'imageManifest', v_manifest,
    'updatedAt', v_updated_at
  );
end;
$$;

revoke all on function public.sellerpilot_save_product_detail_page(uuid, jsonb, bigint)
  from public, anon, service_role;
grant execute on function public.sellerpilot_save_product_detail_page(uuid, jsonb, bigint)
  to authenticated;

do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_get_product_publish_context_pre_detail_manifest(uuid)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.sellerpilot_get_product_publish_context(uuid)'
    ) is null then
      raise exception 'product publish context function not found';
    end if;
    alter function public.sellerpilot_get_product_publish_context(uuid)
      rename to sellerpilot_get_product_publish_context_pre_detail_manifest;
  end if;
end;
$migration$;

create or replace function public.sellerpilot_get_product_publish_context(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_detail_page jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  v_result := public.sellerpilot_get_product_publish_context_pre_detail_manifest(
    p_product_id
  );
  if v_result is null then return null; end if;

  select jsonb_build_object(
           'data', product.detail_page_data,
           'version', product.detail_page_version,
           'approvedVersion', product.detail_page_approved_version,
           'imageManifest', product.detail_page_image_manifest,
           'updatedAt', product.detail_page_updated_at
         )
    into v_detail_page
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = auth.uid()
     and not product.demo
     and product.status <> 'archived';

  return jsonb_set(
    v_result,
    '{detailPage}',
    coalesce(
      v_detail_page,
      jsonb_build_object(
        'data', null,
        'version', 0,
        'approvedVersion', 0,
        'imageManifest', null,
        'updatedAt', null
      )
    ),
    true
  );
end;
$$;

revoke all on function
  public.sellerpilot_get_product_publish_context_pre_detail_manifest(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_get_product_publish_context(uuid)
  from public, anon, service_role;
grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;

commit;
