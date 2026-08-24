begin;

create or replace function public.sellerpilot_create_asset_regeneration_job(
  p_id uuid,
  p_source_job_id uuid,
  p_source_product_id uuid,
  p_asset_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_source sellerpilot_private.ai_cli_jobs%rowtype;
  v_comparison_asset_count integer := 0;
begin
  if not public.sellerpilot_is_admin()
     or p_asset_id not in ('hero', 'square', 'portrait', 'wide', 'detail-overview', 'detail-feature', 'detail-use', 'detail-package') then
    raise exception 'invalid asset regeneration request' using errcode = '42501';
  end if;

  select * into v_source
    from sellerpilot_private.ai_cli_jobs j
   where j.id = p_source_job_id
     and j.kind = 'product_studio'
     and j.status = 'succeeded'
     and j.result_payload->>'mode' = 'cli';
  if not found then raise exception 'source studio job not found'; end if;

  if p_source_product_id is not null and not exists (
    select 1 from sellerpilot_private.products p
     where p.id = p_source_product_id and p.ai_job_id = p_source_job_id and not p.demo
  ) then
    raise exception 'source product does not match studio job';
  end if;

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
      'image_paths', v_source.request_payload->'image_paths',
      'image_specs', v_source.request_payload->'image_specs',
      'comparison_asset_paths', v_source.result_payload->'asset_storage_paths',
      'source_result', v_source.result_payload - 'asset_storage_paths' - 'hero_storage_path'
    ),
    auth.uid()
  );

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', auth.uid(), p_id, jsonb_build_object(
    'kind', 'product_asset_regeneration',
    'asset_id', p_asset_id,
    'source_job_id', p_source_job_id,
    'source_product_id', p_source_product_id,
    'image_role_count', coalesce(jsonb_array_length(v_source.request_payload->'image_specs'), 0),
    'comparison_asset_count', v_comparison_asset_count
  ));
  return p_id;
end;
$$;

revoke all on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text) to authenticated;

commit;
