-- First-draft concept images (portrait, wide, detail-overview, detail-use,
-- detail-routine, detail-scale) for a degraded product-research preflight.
--
-- The Vercel preflight can only degrade to a source-photo catalog for this
-- account because the AI-Gateway image model is not available. The Mac Codex
-- worker is the only lane that can draw real concept images, so a completed and
-- degraded research job is queued here, claimed by that worker, and adopted back
-- into the canonical research result only after all six canonical assets are
-- uploaded and re-verified.
--
-- This migration only adds one private queue table and the RPCs that operate on
-- it. It never rewrites assets, other jobs, or any existing contract.

begin;

create table if not exists sellerpilot_private.first_draft_image_requests (
  job_id uuid primary key references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'generating', 'done')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id) on delete set null,
  verified_assets jsonb not null default '{}'::jsonb
    check (jsonb_typeof(verified_assets) = 'object'),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table sellerpilot_private.first_draft_image_requests is
  'Operator-started first-draft image generation for one degraded product_research job. Assets are adopted into the research result only after all six canonical PNGs are uploaded and digest-verified.';

alter table sellerpilot_private.first_draft_image_requests enable row level security;
revoke all on sellerpilot_private.first_draft_image_requests
  from public, anon, authenticated, service_role;

create index if not exists first_draft_image_requests_queue_idx
  on sellerpilot_private.first_draft_image_requests (created_at)
  where status = 'queued';

-- Operator entry: queue one completed but degraded research job. Returns a safe
-- status token instead of raising so the route can answer precisely.
create or replace function public.sellerpilot_enqueue_first_draft_image_request(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids constant text[] := array[
    'portrait', 'wide', 'detail-overview', 'detail-use', 'detail-routine', 'detail-scale'
  ];
  v_job record;
  v_status text;
  v_created_at timestamptz;
  v_attempts integer;
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

  select request.status, request.created_at, request.attempts
    into v_status, v_created_at, v_attempts
    from sellerpilot_private.first_draft_image_requests request
   where request.job_id = p_job_id;

  return jsonb_build_object(
    'status', v_status,
    'createdAt', v_created_at,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function public.sellerpilot_enqueue_first_draft_image_request(uuid)
  from public, anon;
grant execute on function public.sellerpilot_enqueue_first_draft_image_request(uuid)
  to authenticated;

comment on function public.sellerpilot_enqueue_first_draft_image_request(uuid) is
  'Queues one creator-owned, succeeded, source-photo-catalog research job for Mac first-draft image generation.';

-- Worker claim: oldest pending request. A generating row abandoned by a dead
-- worker becomes reclaimable after the generation lease expires.
create or replace function public.sellerpilot_service_claim_first_draft_image_request(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
   where request.attempts < 3
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
$$;

revoke all on function public.sellerpilot_service_claim_first_draft_image_request(text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_claim_first_draft_image_request(text)
  to service_role;

comment on function public.sellerpilot_service_claim_first_draft_image_request(text) is
  'Claims the oldest pending first-draft image request for one active AI worker token and returns the job request/result needed to build the payload.';

-- Worker state read for a POST submission: only the generating row owned by the
-- same worker token is visible, token-verified.
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
     and request.worker_token_id = v_token_id;
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

  return jsonb_build_object(
    'status', v_request.status,
    'verifiedAssets', coalesce(v_request.verified_assets, '{}'::jsonb),
    'request', v_job_request,
    'result', v_result
  );
end;
$$;

revoke all on function public.sellerpilot_service_get_first_draft_image_request(text, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_get_first_draft_image_request(text, uuid)
  to service_role;

comment on function public.sellerpilot_service_get_first_draft_image_request(text, uuid) is
  'Returns the canonical asset paths and verified upload state of one generating first-draft image request owned by the calling worker token.';

-- Worker failure release: bounded retry instead of a stuck generating row.
create or replace function public.sellerpilot_service_release_first_draft_image_request(
  p_token_hash text,
  p_job_id uuid,
  p_safe_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_updated integer;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' or p_job_id is null then
    return false;
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

  update sellerpilot_private.first_draft_image_requests
     set status = 'queued',
         last_error = left(coalesce(nullif(btrim(p_safe_reason), ''), 'generation-failed'), 300),
         updated_at = clock_timestamp()
   where job_id = p_job_id
     and status = 'generating'
     and worker_token_id = v_token_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_service_release_first_draft_image_request(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_release_first_draft_image_request(text, uuid, text)
  to service_role;

comment on function public.sellerpilot_service_release_first_draft_image_request(text, uuid, text) is
  'Returns one failed first-draft image generation attempt to the queue with a bounded, safe reason.';

-- Adoption: record verified uploads and, once all six canonical assets exist at
-- their canonical paths, rewrite only preflightAssetLineage (digest +
-- segmented-source-composite) so the app keeps reading the same result shape.
create or replace function public.sellerpilot_service_record_first_draft_image_assets(
  p_token_hash text,
  p_job_id uuid,
  p_assets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids constant text[] := array[
    'portrait', 'wide', 'detail-overview', 'detail-use', 'detail-routine', 'detail-scale'
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
     or jsonb_array_length(p_assets) not between 1 and 6 then
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
           end
        or (entry->>'height')::integer <> case entry->>'id'
             when 'portrait' then 1500
             when 'wide' then 900
             when 'detail-overview' then 1500
             when 'detail-use' then 1500
             when 'detail-routine' then 1500
             when 'detail-scale' then 1200
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
        from unnest(v_asset_ids) as asset(asset_id)) <> 6 then
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
  if (select count(*) from jsonb_object_keys(v_lineage)) <> 6 then
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
$$;

revoke all on function public.sellerpilot_service_record_first_draft_image_assets(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_record_first_draft_image_assets(text, uuid, jsonb)
  to service_role;

comment on function public.sellerpilot_service_record_first_draft_image_assets(text, uuid, jsonb) is
  'Records digest-verified first-draft uploads; on the sixth asset it rewrites only preflightAssetLineage to segmented-source-composite and marks the request done.';

commit;
