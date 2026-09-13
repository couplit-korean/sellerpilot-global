-- Move all eight generative studio scenes to preparation. Preserve legacy six-role jobs in flight.
begin;

CREATE OR REPLACE FUNCTION public.sellerpilot_enqueue_first_draft_image_request(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_asset_ids text[] := array[
    'portrait', 'wide', 'detail-overview', 'detail-use', 'detail-routine', 'detail-scale', 'detail-storage', 'detail-context'
  ];
  v_job record;
  v_status text;
  v_created_at timestamptz;
  v_attempts integer;
  v_max_attempts integer;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_job_id is null then
    return jsonb_build_object('status', 'missing');
  end if;

  select job.status, job.result_payload
    into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.created_by = auth.uid()
     and job.kind = 'product_research';
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_job.status <> 'succeeded' or v_job.result_payload is null then
    return jsonb_build_object('status', 'not-completed');
  end if;
  if not (coalesce(v_job.result_payload->'asset_storage_paths', '{}'::jsonb) ?| array['detail-storage','detail-context']) then
    v_asset_ids := array['portrait','wide','detail-overview','detail-use','detail-routine','detail-scale'];
  end if;
  if coalesce(jsonb_typeof(v_job.result_payload->'asset_storage_paths'), '') <> 'object'
     or coalesce(jsonb_typeof(v_job.result_payload->'preflightAssetLineage'), '') <> 'object'
     or not (v_job.result_payload->'asset_storage_paths' ?& v_asset_ids)
     or not (v_job.result_payload->'preflightAssetLineage' ?& v_asset_ids) then
    return jsonb_build_object('status', 'no-assets');
  end if;
  if exists (
    select 1
      from unnest(v_asset_ids) as asset(asset_id)
     where coalesce(
             v_job.result_payload->'preflightAssetLineage'->asset.asset_id->>'auditMode',
             ''
           ) <> 'source-photo-catalog'
  ) then
    return jsonb_build_object('status', 'already-generated');
  end if;

  insert into sellerpilot_private.first_draft_image_requests (job_id, owner_id)
  values (p_job_id, auth.uid())
  on conflict (job_id) do nothing;

  select request.status, request.created_at, request.attempts, request.max_attempts
    into v_status, v_created_at, v_attempts, v_max_attempts
    from sellerpilot_private.first_draft_image_requests request
   where request.job_id = p_job_id;

  return jsonb_build_object(
    'status', v_status,
    'createdAt', v_created_at,
    'attempts', v_attempts,
    'maxAttempts', v_max_attempts,
    'exhausted', v_status = 'queued' and v_attempts >= v_max_attempts
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.sellerpilot_service_record_first_draft_image_assets(p_token_hash text, p_job_id uuid, p_assets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_asset_ids text[] := array[
    'portrait', 'wide', 'detail-overview', 'detail-use', 'detail-routine', 'detail-scale', 'detail-storage', 'detail-context'
  ];
  v_token_id uuid;
  v_request record;
  v_result jsonb;
  v_verified jsonb;
  v_lineage jsonb;
  v_next jsonb;
  v_pending jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_assets is null
     or coalesce(jsonb_typeof(p_assets), '') <> 'array'
     or jsonb_array_length(p_assets) not between 1 and 8 then
    return null;
  end if;

  if not (
    select coalesce(bool_and(
      coalesce(jsonb_typeof(entry), '') = 'object'
      and coalesce(entry->>'id', '') = any(v_asset_ids)
      and coalesce(entry->>'path', '') <> ''
      and length(entry->>'path') <= 400
      and coalesce(entry->>'digest', '') ~ '^[a-f0-9]{64}$'
      and coalesce(entry->>'bytes', '') ~ '^[1-9][0-9]{0,9}$'
      and coalesce(entry->>'width', '') ~ '^[0-9]{1,5}$'
      and coalesce(entry->>'height', '') ~ '^[0-9]{1,5}$'
    ), false)
    from jsonb_array_elements(p_assets) entry
  ) then
    return null;
  end if;
  if (select count(distinct entry->>'id') from jsonb_array_elements(p_assets) entry)
     <> jsonb_array_length(p_assets) then
    return null;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_assets) entry
     where (entry->>'width')::integer <> case entry->>'id'
             when 'portrait' then 1200
             when 'wide' then 1600
             when 'detail-overview' then 1200
             when 'detail-use' then 1200
             when 'detail-routine' then 1200
             when 'detail-scale' then 1200
             when 'detail-storage' then 1200
             when 'detail-context' then 1600
           end
        or (entry->>'height')::integer <> case entry->>'id'
             when 'portrait' then 1500
             when 'wide' then 900
             when 'detail-overview' then 1500
             when 'detail-use' then 1500
             when 'detail-routine' then 1500
             when 'detail-scale' then 1200
             when 'detail-storage' then 1500
             when 'detail-context' then 900
           end
  ) then
    return null;
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

  select request.status, request.verified_assets
    into v_request
    from sellerpilot_private.first_draft_image_requests request
   where request.job_id = p_job_id
     and request.status = 'generating'
     and request.worker_token_id = v_token_id
   for update;
  if not found then
    return null;
  end if;

  select job.result_payload
    into v_result
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.kind = 'product_research'
     and job.status = 'succeeded';
  if not (coalesce(v_result->'asset_storage_paths', '{}'::jsonb) ?| array['detail-storage','detail-context']) then
    v_asset_ids := array['portrait','wide','detail-overview','detail-use','detail-routine','detail-scale'];
  end if;
  if v_result is null
     or coalesce(jsonb_typeof(v_result->'asset_storage_paths'), '') <> 'object'
     or coalesce(jsonb_typeof(v_result->'preflightAssetLineage'), '') <> 'object'
     or not (v_result->'asset_storage_paths' ?& v_asset_ids)
     or not (v_result->'preflightAssetLineage' ?& v_asset_ids) then
    return null;
  end if;

  -- Every submitted asset must sit at exactly the canonical path the research
  -- result already declares, and the uploaded object must really exist.
  if exists (
    select 1
      from jsonb_array_elements(p_assets) entry
     where entry->>'path' <> coalesce(v_result->'asset_storage_paths'->>(entry->>'id'), '')
  ) then
    return null;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_assets) entry
     where not exists (
       select 1
         from storage.objects object
        where object.bucket_id = 'sellerpilot-ai'
          and object.name = entry->>'path'
     )
  ) then
    return null;
  end if;

  v_verified := coalesce(v_request.verified_assets, '{}'::jsonb);
  select coalesce(jsonb_object_agg(entry->>'id', entry), '{}'::jsonb)
    into v_pending
    from jsonb_array_elements(p_assets) entry;
  v_verified := v_verified || v_pending;

  if not (v_verified ?& v_asset_ids) then
    update sellerpilot_private.first_draft_image_requests
       set verified_assets = v_verified,
           updated_at = clock_timestamp()
     where job_id = p_job_id;
    select coalesce(jsonb_agg(asset.asset_id order by asset.asset_id), '[]'::jsonb)
      into v_pending
      from unnest(v_asset_ids) as asset(asset_id)
     where not (v_verified ? asset.asset_id);
    return jsonb_build_object('status', 'recorded', 'pending', v_pending);
  end if;

  if exists (
    select 1
      from unnest(v_asset_ids) as asset(asset_id)
     where coalesce(v_verified->asset.asset_id->>'digest', '') !~ '^[a-f0-9]{64}$'
  ) then
    return null;
  end if;
  if (select count(distinct v_verified->asset.asset_id->>'digest')
        from unnest(v_asset_ids) as asset(asset_id)) <> cardinality(v_asset_ids) then
    return null;
  end if;

  select jsonb_object_agg(
           asset.asset_id,
           coalesce(v_result->'preflightAssetLineage'->asset.asset_id, '{}'::jsonb)
             || jsonb_build_object(
                  'digest', v_verified->asset.asset_id->>'digest',
                  'role', case when asset.asset_id in ('portrait', 'wide') then 'creative' else 'detail' end,
                  'auditMode', 'segmented-source-composite',
                  'sourceRole', coalesce(
                    v_result->'preflightAssetLineage'->asset.asset_id->>'sourceRole',
                    'main'
                  )
                )
         )
    into v_lineage
    from unnest(v_asset_ids) as asset(asset_id);

  v_next := jsonb_set(v_result, '{preflightAssetLineage}', v_lineage, true);
  if (v_next - 'preflightAssetLineage') is distinct from (v_result - 'preflightAssetLineage') then
    return null;
  end if;
  if (select count(*) from jsonb_object_keys(v_lineage)) <> cardinality(v_asset_ids) then
    return null;
  end if;

  update sellerpilot_private.ai_cli_jobs
     set result_payload = v_next,
         updated_at = clock_timestamp()
   where id = p_job_id;

  update sellerpilot_private.first_draft_image_requests
     set verified_assets = v_verified,
         status = 'done',
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp(),
         last_error = null
   where job_id = p_job_id;

  return jsonb_build_object('status', 'done', 'result', v_next);
end;
$function$;


commit;
