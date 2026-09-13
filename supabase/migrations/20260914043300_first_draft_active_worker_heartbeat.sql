begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid =
        'public.sellerpilot_service_get_first_draft_image_request(text,uuid)'::regprocedure)
       is distinct from '17dae819c10f88958cd71dcc248b9fae' then
    raise exception 'first draft worker state function changed; review before applying heartbeat';
  end if;
end;
$guard$;

-- Preserve the existing owner-bound worker RPC, response fields and grants.
-- This compatibility fix keeps already-running image jobs alive without
-- restarting the worker or resetting a generation attempt.
create or replace function public.sellerpilot_service_get_first_draft_image_request(
  p_token_hash text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_request record;
  v_result jsonb;
  v_job_request jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' or p_job_id is null then
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
     and request.updated_at >= clock_timestamp() - interval '30 minutes'
   for update;
  if not found then
    return null;
  end if;

  select job.result_payload, job.request_payload
    into v_result, v_job_request
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.kind = 'product_research'
     and job.status = 'succeeded';
  if v_result is null
     or coalesce(jsonb_typeof(v_result->'asset_storage_paths'), '') <> 'object'
     or coalesce(jsonb_typeof(v_result->'preflightAssetLineage'), '') <> 'object' then
    return null;
  end if;

  -- The existing authenticated cancellation poll is also a lease renewal.
  -- It is reached through the worker's no-store GET every five seconds. Renew
  -- at most once per minute to avoid unnecessary writes. A stopped request,
  -- another worker's claim or an expired lease cannot reach this update.
  -- The row lock above makes validation and renewal atomic with reclaim/stop.
  -- Legacy clients carry only the worker token, so this does not distinguish
  -- two processes sharing one token; the installed worker must remain single.
  update sellerpilot_private.first_draft_image_requests request
     set updated_at = clock_timestamp()
   where request.job_id = p_job_id
     and request.status = 'generating'
     and request.worker_token_id = v_token_id
     and request.updated_at < clock_timestamp() - interval '1 minute';

  return jsonb_build_object(
    'status', v_request.status,
    'verifiedAssets', coalesce(v_request.verified_assets, '{}'::jsonb),
    'request', v_job_request,
    'result', v_result
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
