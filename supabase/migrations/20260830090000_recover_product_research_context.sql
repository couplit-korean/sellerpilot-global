begin;

-- A successful first-stage result must remain recoverable after a tab, browser,
-- or device change. Keep the private request payload behind a creator-only RPC;
-- the application route validates every path and returns only short-lived URLs.
create or replace function public.sellerpilot_get_product_research_recovery(
  p_id uuid
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
$$;

revoke all on function public.sellerpilot_get_product_research_recovery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_product_research_recovery(uuid)
  to authenticated;

comment on function public.sellerpilot_get_product_research_recovery(uuid) is
  'Returns one creator-owned successful product-research request and result to the validating recovery API.';

commit;
