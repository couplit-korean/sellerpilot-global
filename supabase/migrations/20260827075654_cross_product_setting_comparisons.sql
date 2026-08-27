-- Supply a claimed product-studio worker with a bounded, owner-isolated set
-- of earlier setting-shot paths. The application signs these private paths;
-- raw storage paths never leave the worker-only claim response.

begin;

create index if not exists products_cross_product_comparisons_idx
  on sellerpilot_private.products (owner_id, updated_at desc, id)
  where not demo and status <> 'archived' and ai_job_id is not null;

create function public.sellerpilot_service_get_cross_product_setting_comparisons(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_limit_products integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_owner_id uuid;
  v_job_kind text;
  v_job_request jsonb;
  v_excluded_source_job_id uuid;
  v_excluded_product_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit_products, 8), 8));
  v_result jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null then
    raise exception 'invalid cross-product comparison request' using errcode = '22023';
  end if;

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'ai'
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select job.created_by, job.kind, job.request_payload
    into v_owner_id, v_job_kind, v_job_request
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp();
  if not found then return null; end if;

  if v_job_kind = 'product_studio' then
    v_excluded_source_job_id := p_job_id;
  else
    if coalesce(v_job_request->>'source_job_id', '')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (
         nullif(v_job_request->>'source_product_id', '') is not null
         and v_job_request->>'source_product_id'
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       ) then
      return null;
    end if;

    v_excluded_source_job_id := (v_job_request->>'source_job_id')::uuid;
    v_excluded_product_id := nullif(v_job_request->>'source_product_id', '')::uuid;

    if not exists (
      select 1
        from sellerpilot_private.ai_cli_jobs source_job
       where source_job.id = v_excluded_source_job_id
         and source_job.created_by = v_owner_id
         and source_job.kind = 'product_studio'
         and source_job.status = 'succeeded'
         and source_job.result_payload->>'mode' = 'cli'
    ) then
      return null;
    end if;

    if v_excluded_product_id is not null and not exists (
      select 1
        from sellerpilot_private.products source_product
       where source_product.id = v_excluded_product_id
         and source_product.owner_id = v_owner_id
         and source_product.ai_job_id = v_excluded_source_job_id
         and not source_product.demo
         and source_product.status <> 'archived'
    ) then
      return null;
    end if;
  end if;

  -- Probe a bounded multiple of the requested product count through the
  -- owner/recency partial index. All eight role paths are validated in one
  -- set-based provenance query rather than one query per path.
  with recent_products as materialized (
    select product.id, product.owner_id, product.ai_job_id, product.updated_at
      from sellerpilot_private.products product
     where product.owner_id = v_owner_id
       and product.ai_job_id <> v_excluded_source_job_id
       and (v_excluded_product_id is null or product.id <> v_excluded_product_id)
       and product.status <> 'archived'
       and not product.demo
       and product.ai_job_id is not null
     order by product.updated_at desc, product.id
     limit greatest(32, v_limit * 8)
  ), recent_candidates as materialized (
    select
      product.id as product_id,
      product.updated_at as product_updated_at,
      source_job.id as source_job_id,
      btrim(source_job.result_payload->'product'->>'category') as category,
      btrim(source_job.result_payload->'product'->>'name') as product_name,
      source_job.result_payload
    from recent_products product
    join sellerpilot_private.ai_cli_jobs source_job
      on source_job.id = product.ai_job_id
     and source_job.created_by = product.owner_id
   where source_job.kind = 'product_studio'
     and source_job.status = 'succeeded'
     and source_job.result_payload->>'mode' = 'cli'
     and jsonb_typeof(source_job.result_payload->'asset_storage_paths') = 'object'
     and length(btrim(coalesce(source_job.result_payload->'product'->>'category', ''))) between 1 and 120
     and length(btrim(coalesce(source_job.result_payload->'product'->>'name', ''))) between 1 and 160
     and btrim(source_job.result_payload->'product'->>'category') !~ '[[:cntrl:]]'
     and btrim(source_job.result_payload->'product'->>'name') !~ '[[:cntrl:]]'
  ), roles(asset_id, file_name) as (
    values
          ('portrait', 'thumbnail-portrait.png'),
          ('wide', 'thumbnail-wide.png'),
          ('detail-overview', 'detail-overview.png'),
          ('detail-use', 'detail-use.png'),
          ('detail-routine', 'detail-routine.png'),
          ('detail-scale', 'detail-scale.png'),
          ('detail-storage', 'detail-storage.png'),
          ('detail-context', 'detail-context.png')
  ), candidate_assets as materialized (
    select
      candidate.product_id,
      candidate.product_updated_at,
      candidate.source_job_id,
      candidate.category,
      candidate.product_name,
      role.asset_id,
      role.file_name,
      candidate.result_payload->'asset_storage_paths'->>role.asset_id as storage_path,
      string_to_array(
        coalesce(candidate.result_payload->'asset_storage_paths'->>role.asset_id, ''),
        '/'
      ) as path_segments
    from recent_candidates candidate
    cross join roles role
  ), valid_assets as (
    select asset.*
      from candidate_assets asset
      join sellerpilot_private.ai_cli_jobs provenance_job
        on provenance_job.id::text = asset.path_segments[2]
       and provenance_job.created_by = v_owner_id
       and provenance_job.status = 'succeeded'
       and (
             (
               provenance_job.id = asset.source_job_id
               and provenance_job.kind = 'product_studio'
               and provenance_job.result_payload->'asset_storage_paths'->>asset.asset_id = asset.storage_path
             )
             or (
               provenance_job.kind = 'product_asset_regeneration'
               and provenance_job.request_payload->>'source_job_id' = asset.source_job_id::text
               and provenance_job.request_payload->>'asset_id' = asset.asset_id
               and (
                 nullif(provenance_job.request_payload->>'source_product_id', '') is null
                 or provenance_job.request_payload->>'source_product_id' = asset.product_id::text
               )
               and provenance_job.result_payload->'asset_storage_paths'->>asset.asset_id = asset.storage_path
             )
           )
     where asset.storage_path is not null
       and length(asset.storage_path) between 1 and 400
       and cardinality(asset.path_segments) = 5
       and asset.path_segments[1] = 'results'
       and asset.path_segments[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and asset.path_segments[3] = 'claims'
       and asset.path_segments[4] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and asset.path_segments[5] = asset.file_name
       and asset.storage_path !~ '[[:cntrl:]]'
  ), complete_products as materialized (
    select
      asset.product_id,
      asset.product_updated_at,
      asset.source_job_id,
      asset.category,
      asset.product_name,
      jsonb_object_agg(asset.asset_id, asset.storage_path) as assets
    from valid_assets asset
    group by
      asset.product_id,
      asset.product_updated_at,
      asset.source_job_id,
      asset.category,
      asset.product_name
    having count(*) = 8
    order by asset.product_updated_at desc, asset.product_id
    limit v_limit
  )
  select jsonb_build_object(
    'version', 1,
    'productCount', count(*)::integer,
    'assetCount', count(*)::integer * 8,
    'products', coalesce(jsonb_agg(
      jsonb_build_object(
        'sourceJobId', product.source_job_id,
        'sceneIdentity', jsonb_build_object(
          'category', product.category,
          'name', product.product_name
        ),
        'assets', product.assets
      ) order by product.product_updated_at desc, product.product_id
    ), '[]'::jsonb)
  ) into v_result
    from complete_products product;

  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_get_cross_product_setting_comparisons(text, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_cross_product_setting_comparisons(text, uuid, uuid, integer)
  to service_role;

commit;
