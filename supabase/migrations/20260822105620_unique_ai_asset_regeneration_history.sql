-- Regenerate exactly one generated product asset under a unique migration
-- history version while keeping the remaining
-- studio result and the product's original AI job linkage intact.

begin;
alter table sellerpilot_private.ai_cli_jobs
  drop constraint if exists ai_cli_jobs_kind_check;
alter table sellerpilot_private.ai_cli_jobs
  add constraint ai_cli_jobs_kind_check
  check (kind in ('product_studio', 'product_research', 'support_reply', 'product_asset_regeneration'));
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

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (
    p_id,
    'product_asset_regeneration',
    jsonb_build_object(
      'source_job_id', p_source_job_id,
      'source_product_id', p_source_product_id,
      'asset_id', p_asset_id,
      'image_paths', v_source.request_payload->'image_paths',
      'source_result', v_source.result_payload - 'asset_storage_paths' - 'hero_storage_path'
    ),
    auth.uid()
  );

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', auth.uid(), p_id, jsonb_build_object(
    'kind', 'product_asset_regeneration',
    'asset_id', p_asset_id,
    'source_job_id', p_source_job_id,
    'source_product_id', p_source_product_id
  ));
  return p_id;
end;
$$;
create or replace function public.sellerpilot_complete_ai_job(
  p_token_hash text,
  p_job_id uuid,
  p_status text,
  p_result_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_updated integer;
  v_kind text;
  v_request jsonb;
  v_asset_id text;
  v_asset_path text;
  v_source_job_id uuid;
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'invalid completion status'; end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash and t.status = 'active' and t.expires_at > now();
  if v_token_id is null then raise exception 'invalid worker token' using errcode = '42501'; end if;

  select j.kind, j.request_payload into v_kind, v_request
    from sellerpilot_private.ai_cli_jobs j
   where j.id = p_job_id and j.status = 'running' and j.worker_token_id = v_token_id
   for update;
  if not found then return false; end if;

  if v_kind = 'product_asset_regeneration' and p_status = 'succeeded' then
    v_asset_id := v_request->>'asset_id';
    v_source_job_id := (v_request->>'source_job_id')::uuid;
    v_asset_path := p_result_payload->'asset_storage_paths'->>v_asset_id;
    if p_result_payload->>'mode' <> 'asset-regeneration'
       or p_result_payload->>'assetId' <> v_asset_id
       or (p_result_payload->>'sourceJobId')::uuid <> v_source_job_id
       or v_asset_path is null
       or v_asset_path not like ('results/' || p_job_id::text || '/%') then
      raise exception 'invalid asset regeneration completion';
    end if;
  end if;

  update sellerpilot_private.ai_cli_jobs
     set status = p_status,
         result_payload = case when p_status = 'succeeded' then p_result_payload else null end,
         error_message = case when p_status = 'failed' then left(coalesce(p_error_message, 'CLI worker failed.'), 500) else null end,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where id = p_job_id and status = 'running' and worker_token_id = v_token_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  if v_kind = 'product_asset_regeneration' and p_status = 'succeeded' then
    update sellerpilot_private.ai_cli_jobs
       set result_payload = jsonb_set(
             coalesce(result_payload, '{}'::jsonb),
             array['asset_storage_paths', v_asset_id],
             to_jsonb(v_asset_path),
             true
           ),
           updated_at = now()
     where id = v_source_job_id and kind = 'product_studio' and status = 'succeeded';
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then raise exception 'source studio job update failed'; end if;
  end if;

  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values (
    case when p_status = 'succeeded' then 'job_succeeded' else 'job_failed' end,
    v_token_id,
    p_job_id,
    case
      when p_status = 'failed' then jsonb_build_object('error', left(coalesce(p_error_message, ''), 180))
      when v_kind = 'product_asset_regeneration' then jsonb_build_object('asset_id', v_asset_id, 'source_job_id', v_source_job_id)
      else '{}'::jsonb
    end
  );
  return true;
end;
$$;
revoke all on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text) to authenticated;
revoke all on function public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text) to service_role;
commit;
