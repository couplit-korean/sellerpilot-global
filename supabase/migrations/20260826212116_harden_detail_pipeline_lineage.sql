-- Keep the expanded 16-image detail pipeline on one owner lineage from the
-- user-created studio job through single-asset regeneration and publishing.

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
       'detail-overview', 'detail-feature', 'detail-use', 'detail-package',
       'detail-routine', 'detail-scale', 'detail-storage', 'detail-context',
       'detail-material', 'detail-dimensions', 'detail-contents', 'detail-care'
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
       and product.owner_id = v_actor_id
       and product.ai_job_id = p_source_job_id
       and not product.demo
       and product.status <> 'archived'
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
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text)
  to authenticated;

create or replace function public.sellerpilot_service_stage_ai_result_uploads(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_paths text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_prefix text;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null
     or coalesce(cardinality(p_paths), 0) not between 1 and 16
     or (select count(*) from unnest(p_paths) path) <>
        (select count(distinct path) from unnest(p_paths) path)
     or exists (
       select 1
         from unnest(p_paths) path
        where path is null
           or length(path) not between 1 and 1000
           or path !~ '^results/[0-9a-fA-F-]{36}/claims/[0-9a-fA-F-]{36}/[a-z0-9][a-z0-9-]{0,80}\.png$'
           or path ~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
     ) then
    raise exception 'invalid AI result upload staging';
  end if;

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope in ('ai', 'legacy_combined')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  perform 1
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.worker_token_id = v_token_id
     and job.lease_expires_at > clock_timestamp()
   for update;
  if not found then return false; end if;

  v_prefix := 'results/' || p_job_id::text || '/claims/' || p_claim_token::text || '/';
  if exists (
    select 1 from unnest(p_paths) path
     where left(path, length(v_prefix)) <> v_prefix
  ) then
    raise exception 'AI result upload path does not match claim';
  end if;

  insert into sellerpilot_private.ai_result_upload_staging (
    job_id, claim_token, object_path
  )
  select p_job_id, p_claim_token, path
    from unnest(p_paths) path
  on conflict (job_id, claim_token, object_path) do nothing;
  return true;
end;
$$;

revoke all on function public.sellerpilot_service_stage_ai_result_uploads(text, uuid, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_stage_ai_result_uploads(text, uuid, uuid, text[])
  to service_role;

-- This is the claim-bound implementation called by the idempotent receipt
-- wrapper installed in 20260826090000. Keep it private to the wrapper while
-- validating all 16 output paths and the source owner again at completion.
create or replace function public.sellerpilot_260826_complete_ai_job_once(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_result_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_updated integer;
  v_kind text;
  v_request jsonb;
  v_job_created_by uuid;
  v_asset_id text;
  v_asset_path text;
  v_expected_asset_file text;
  v_source_job_id uuid;
  v_source_product_id uuid;
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'invalid completion status'; end if;
  if p_claim_token is null then return false; end if;

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select job.kind, job.request_payload, job.created_by
    into v_kind, v_request, v_job_created_by
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
   for update;
  if not found then return false; end if;

  if v_kind = 'product_asset_regeneration' and p_status = 'succeeded' then
    v_asset_id := v_request->>'asset_id';
    v_source_job_id := (v_request->>'source_job_id')::uuid;
    v_source_product_id := nullif(v_request->>'source_product_id', '')::uuid;

    perform 1
      from sellerpilot_private.ai_cli_jobs source
     where source.id = v_source_job_id
       and source.kind = 'product_studio'
       and source.created_by = v_job_created_by
       and source.status = 'succeeded'
     for update;
    if not found then
      raise exception 'asset regeneration source owner mismatch';
    end if;

    if v_source_product_id is not null then
      perform 1
        from sellerpilot_private.products product
       where product.id = v_source_product_id
         and product.owner_id = v_job_created_by
         and product.ai_job_id = v_source_job_id
         and not product.demo
         and product.status <> 'archived'
       for key share;
      if not found then
        raise exception 'asset regeneration product owner mismatch';
      end if;
    end if;

    v_asset_path := p_result_payload->'asset_storage_paths'->>v_asset_id;
    v_expected_asset_file := case v_asset_id
      when 'hero' then 'hero.png'
      when 'square' then 'thumbnail-square.png'
      when 'portrait' then 'thumbnail-portrait.png'
      when 'wide' then 'thumbnail-wide.png'
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
    if p_result_payload->>'mode' <> 'asset-regeneration'
       or p_result_payload->>'assetId' <> v_asset_id
       or (p_result_payload->>'sourceJobId')::uuid <> v_source_job_id
       or v_asset_path is null
       or v_expected_asset_file is null
       or v_asset_path <> (
         'results/' || p_job_id::text || '/claims/' || p_claim_token::text || '/' || v_expected_asset_file
       ) then
      raise exception 'invalid asset regeneration completion';
    end if;
  end if;

  if v_kind = 'product_studio' and p_status = 'succeeded' then
    if jsonb_typeof(p_result_payload->'asset_storage_paths') is distinct from 'object' then
      raise exception 'invalid studio asset claim paths';
    end if;
    if (
      select count(*)
        from jsonb_object_keys(p_result_payload->'asset_storage_paths')
    ) <> 16 then
      raise exception 'invalid studio asset claim paths';
    end if;
    if exists (
      select 1
        from jsonb_each_text(p_result_payload->'asset_storage_paths') asset_path
       where asset_path.value <> (
         'results/' || p_job_id::text || '/claims/' || p_claim_token::text || '/'
         || case asset_path.key
           when 'hero' then 'hero.png'
           when 'square' then 'thumbnail-square.png'
           when 'portrait' then 'thumbnail-portrait.png'
           when 'wide' then 'thumbnail-wide.png'
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
           else '__invalid_asset__'
         end
       )
    ) then
      raise exception 'invalid studio asset claim paths';
    end if;
  end if;

  update sellerpilot_private.ai_cli_jobs job
     set status = p_status,
         result_payload = case when p_status = 'succeeded' then p_result_payload else null end,
         error_message = case
           when p_status = 'failed'
             then left(coalesce(p_error_message, 'CLI worker failed.'), 500)
           else null
         end,
         claim_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = p_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  if v_kind = 'product_asset_regeneration' and p_status = 'succeeded' then
    update sellerpilot_private.ai_cli_jobs source
       set result_payload = jsonb_set(
             coalesce(source.result_payload, '{}'::jsonb),
             array['asset_storage_paths', v_asset_id],
             to_jsonb(v_asset_path),
             true
           ),
           updated_at = clock_timestamp()
     where source.id = v_source_job_id
       and source.kind = 'product_studio'
       and source.created_by = v_job_created_by
       and source.status = 'succeeded';
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'source studio job update failed'; end if;
  end if;

  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values (
    case when p_status = 'succeeded' then 'job_succeeded' else 'job_failed' end,
    v_token_id,
    p_job_id,
    case
      when p_status = 'failed' then
        jsonb_build_object('error', left(coalesce(p_error_message, ''), 180))
      when v_kind = 'product_asset_regeneration' then
        jsonb_build_object(
          'asset_id', v_asset_id,
          'source_job_id', v_source_job_id,
          'source_product_id', v_source_product_id
        )
      else '{}'::jsonb
    end
  );
  return true;
end;
$$;

revoke all on function public.sellerpilot_260826_complete_ai_job_once(text, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;

-- The detailed studio result is intentionally filtered by product/job owner
-- lineage. The wrapper rename is conditional so a replay, or rollout after the
-- earlier draft migration, does not create an ever-growing wrapper chain.
do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_get_product_publish_context_pre_classification_evidence(uuid)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.sellerpilot_get_product_publish_context(uuid)'
    ) is null then
      raise exception 'product publish context function not found';
    end if;
    alter function public.sellerpilot_get_product_publish_context(uuid)
      rename to sellerpilot_get_product_publish_context_pre_classification_evidence;
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
  v_classification jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  v_result := public.sellerpilot_get_product_publish_context_pre_classification_evidence(
    p_product_id
  );
  if v_result is null then return null; end if;

  select case
           when jsonb_typeof(job.result_payload->'product'->'classification') = 'object'
             then job.result_payload->'product'->'classification'
           else null
         end
    into v_classification
    from sellerpilot_private.products product
    left join sellerpilot_private.ai_cli_jobs job
      on job.id = product.ai_job_id
     and job.kind = 'product_studio'
     and job.created_by = product.owner_id
     and job.status = 'succeeded'
     and job.result_payload->>'mode' = 'cli'
   where product.id = p_product_id
     and not product.demo
     and product.status <> 'archived';

  return jsonb_set(
    v_result,
    '{classification}',
    coalesce(v_classification, 'null'::jsonb),
    true
  );
end;
$$;

revoke all on function public.sellerpilot_get_product_publish_context_pre_classification_evidence(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_get_product_publish_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;

commit;
