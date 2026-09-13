begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_get_product_research_recovery(uuid)'::regprocedure) is distinct from '3f5e8f4ddd9671159bfb6f33e90475aa' then raise exception 'recovery function changed; review before applying'; end if;
end $guard$;

-- Return the already-stored per-photo evidence without widening owner/admin access.
-- A legacy single-photo result keeps the optional key absent rather than null.
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
    ) || case when job.result_payload ? 'sourcePhotoEvidence'
      then jsonb_build_object('sourcePhotoEvidence', job.result_payload->'sourcePhotoEvidence')
      else '{}'::jsonb end,
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
notify pgrst, 'reload schema';
commit;
