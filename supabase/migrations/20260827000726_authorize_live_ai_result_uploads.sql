begin;

create or replace function public.sellerpilot_service_authorize_ai_result_upload(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_asset_id text,
  p_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_kind text;
  v_request jsonb;
  v_file text;
  v_expected_path text;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null
     or coalesce(length(p_asset_id), 0) not between 1 and 80
     or coalesce(length(p_path), 0) not between 1 and 1000 then
    return false;
  end if;

  v_file := case p_asset_id
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
  if v_file is null then return false; end if;

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

  select job.kind, job.request_payload
    into v_kind, v_request
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
   for update;
  if not found then return false; end if;

  if v_kind = 'product_studio' then
    null;
  elsif v_kind = 'product_asset_regeneration'
        and v_request->>'asset_id' = p_asset_id then
    null;
  else
    return false;
  end if;

  v_expected_path := 'results/' || p_job_id::text || '/claims/'
    || p_claim_token::text || '/' || v_file;
  if p_path <> v_expected_path then return false; end if;

  insert into sellerpilot_private.ai_result_upload_staging (
    job_id, claim_token, object_path
  ) values (
    p_job_id, p_claim_token, v_expected_path
  )
  on conflict (job_id, claim_token, object_path) do nothing;

  return true;
end;
$$;

revoke all on function public.sellerpilot_service_authorize_ai_result_upload(text, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_authorize_ai_result_upload(text, uuid, uuid, text, text)
  to service_role;

commit;
