begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
-- Preserve cumulative attempts. Extra retries are an explicit operator action,
-- never granted by enqueue or by a browser poll.
alter table sellerpilot_private.first_draft_image_requests
 add column max_attempts integer not null default 3 check (max_attempts between 3 and 6);
alter table sellerpilot_private.first_draft_image_requests drop constraint first_draft_image_requests_attempts_check;
alter table sellerpilot_private.first_draft_image_requests add constraint first_draft_image_requests_attempts_check check (attempts >= 0 and attempts <= max_attempts);

CREATE OR REPLACE FUNCTION public.sellerpilot_enqueue_first_draft_image_request(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_asset_ids constant text[] := array[
    'portrait', 'wide', 'detail-overview', 'detail-use', 'detail-routine', 'detail-scale'
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

CREATE OR REPLACE FUNCTION public.sellerpilot_get_product_research_recovery(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', job.id,
    'kind', job.kind,
    'status', job.status,
    'request', jsonb_build_object(
      'jobId', job.id,
      'researchInput', job.request_payload->>'research_input',
      'sourcePhotoFingerprint', job.request_payload->>'source_photo_sha256',
      'imagePaths', job.request_payload->'image_paths',
      'imageSpecs', job.request_payload->'image_specs'
    ),
    'result', jsonb_build_object(
      'mode', job.result_payload->'mode',
      'summary', job.result_payload->'summary',
      'suggestedFields', job.result_payload->'suggestedFields',
      'searchQueries', job.result_payload->'searchQueries',
      'details', job.result_payload->'details',
      'sources', job.result_payload->'sources',
      'warnings', job.result_payload->'warnings',
      'preflightVersion', job.result_payload->'preflightVersion',
      'researchInputSha256', job.result_payload->'researchInputSha256',
      'sourcePhotoSha256', job.result_payload->'sourcePhotoSha256',
      'asset_storage_paths', job.result_payload->'asset_storage_paths',
      'preflightAssetLineage', job.result_payload->'preflightAssetLineage'
    ),
    'firstDraftGeneration', (select jsonb_build_object(
      'status', q.status, 'attempts', q.attempts, 'maxAttempts', q.max_attempts,
      'exhausted', q.status = 'queued' and q.attempts >= q.max_attempts
    ) from sellerpilot_private.first_draft_image_requests q where q.job_id=job.id and q.owner_id=job.created_by),
    'completedAt', job.completed_at
  )
    into v_result
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id
     and job.created_by = auth.uid()
     and job.kind = 'product_research'
     and job.status = 'succeeded';

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_claim_first_draft_image_request(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_job record;
  v_verified jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
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
  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = clock_timestamp()
   where id = v_token_id;

  select request.job_id
    into v_job_id
    from sellerpilot_private.first_draft_image_requests request
   where request.attempts < request.max_attempts
     and (
       request.status = 'queued'
       or (request.status = 'generating'
           and request.updated_at < clock_timestamp() - interval '30 minutes')
     )
   order by request.created_at
   limit 1
   for update skip locked;
  if v_job_id is null then
    return null;
  end if;

  update sellerpilot_private.first_draft_image_requests
     set status = 'generating',
         attempts = attempts + 1,
         worker_token_id = v_token_id,
         updated_at = clock_timestamp()
   where job_id = v_job_id
   returning verified_assets into v_verified;

  select job.id, job.created_by, job.request_payload, job.result_payload, job.status
    into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_job_id;
  if not found
     or v_job.status <> 'succeeded'
     or v_job.result_payload is null
     or v_job.result_payload->'asset_storage_paths' is null
     or v_job.result_payload->'preflightAssetLineage' is null then
    update sellerpilot_private.first_draft_image_requests
       set status = 'queued',
           last_error = 'job-not-adoptable',
           updated_at = clock_timestamp()
     where job_id = v_job_id;
    return null;
  end if;

  return jsonb_build_object(
    'jobId', v_job_id,
    'ownerId', v_job.created_by,
    'request', v_job.request_payload,
    'result', v_job.result_payload,
    'verifiedAssets', coalesce(v_verified, '{}'::jsonb)
  );
end;
$function$;

notify pgrst, 'reload schema';
commit;
