-- Preserve the user-confirmed product identity fields when a single generated
-- asset is regenerated. The AI worker must anchor brand, manufacturer, GTIN,
-- and other protected facts to the succeeded source studio request.

begin;

update sellerpilot_private.ai_cli_jobs regeneration
   set request_payload = jsonb_set(
         regeneration.request_payload,
         '{manual_fields}',
         source.request_payload->'manual_fields',
         true
       )
  from sellerpilot_private.ai_cli_jobs source
 where regeneration.kind = 'product_asset_regeneration'
   and source.id::text = regeneration.request_payload->>'source_job_id'
   and source.kind = 'product_studio'
   and source.created_by = regeneration.created_by
   and jsonb_typeof(source.request_payload->'manual_fields') = 'object'
   and regeneration.request_payload->'manual_fields'
         is distinct from source.request_payload->'manual_fields';

create or replace function public.sellerpilot_create_asset_regeneration_job(
  p_id uuid,
  p_source_job_id uuid,
  p_source_product_id uuid,
  p_asset_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source sellerpilot_private.ai_cli_jobs%rowtype;
  v_existing_job_id uuid;
  v_comparison_asset_count integer := 0;
begin
  if v_actor_id is null
     or not public.sellerpilot_is_admin()
     or p_asset_id not in (
       'hero', 'square', 'portrait', 'wide',
       'detail-overview', 'detail-feature', 'detail-use', 'detail-package'
     ) then
    raise exception 'invalid asset regeneration request' using errcode = '42501';
  end if;

  select source.* into v_source
    from sellerpilot_private.ai_cli_jobs source
   where source.id = p_source_job_id
     and source.kind = 'product_studio'
     and source.created_by = v_actor_id
     and source.status = 'succeeded'
     and source.result_payload->>'mode' = 'cli';
  if not found then raise exception 'source studio job not found'; end if;
  if jsonb_typeof(v_source.request_payload->'manual_fields') is distinct from 'object' then
    raise exception 'source studio manual fields not found';
  end if;

  if p_source_product_id is not null and not exists (
    select 1
      from sellerpilot_private.products product
     where product.id = p_source_product_id
       and product.ai_job_id = p_source_job_id
       and not product.demo
  ) then
    raise exception 'source product does not match studio job';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:asset-regeneration:' || v_actor_id::text || ':'
    || p_source_job_id::text || ':' || p_asset_id
  ));

  select job.id into v_existing_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id
     and job.created_by = v_actor_id
     and job.kind = 'product_asset_regeneration'
     and job.request_payload->>'source_job_id' = p_source_job_id::text
     and job.request_payload->>'asset_id' = p_asset_id
     and (job.request_payload->>'source_product_id')
           is not distinct from p_source_product_id::text;
  if found then return v_existing_job_id; end if;

  select job.id into v_existing_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.created_by = v_actor_id
     and job.kind = 'product_asset_regeneration'
     and job.status in ('queued', 'claimed', 'running')
     and job.request_payload->>'source_job_id' = p_source_job_id::text
     and job.request_payload->>'asset_id' = p_asset_id
     and (job.request_payload->>'source_product_id')
           is not distinct from p_source_product_id::text
   order by job.created_at, job.id
   limit 1;
  if found then return v_existing_job_id; end if;

  select count(*)::integer into v_comparison_asset_count
    from jsonb_object_keys(coalesce(v_source.result_payload->'asset_storage_paths', '{}'::jsonb));

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (
    p_id,
    'product_asset_regeneration',
    jsonb_build_object(
      'source_job_id', p_source_job_id,
      'source_product_id', p_source_product_id,
      'asset_id', p_asset_id,
      'manual_fields', v_source.request_payload->'manual_fields',
      'image_paths', v_source.request_payload->'image_paths',
      'image_specs', v_source.request_payload->'image_specs',
      'comparison_asset_paths', v_source.result_payload->'asset_storage_paths',
      'source_result', v_source.result_payload - 'asset_storage_paths' - 'hero_storage_path'
    ),
    v_actor_id
  );

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', v_actor_id, p_id, jsonb_build_object(
    'kind', 'product_asset_regeneration',
    'asset_id', p_asset_id,
    'source_job_id', p_source_job_id,
    'source_product_id', p_source_product_id,
    'image_role_count', coalesce(jsonb_array_length(v_source.request_payload->'image_specs'), 0),
    'comparison_asset_count', v_comparison_asset_count,
    'deduplicated', false
  ));
  return p_id;
end;
$$;

revoke all on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text)
  to authenticated;

commit;
