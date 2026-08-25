-- Keep AI jobs claimable after transient route-side preparation failures.
-- A claimed job is not considered attempted until the worker receives it,
-- but three independent preparation failures terminate the poisoned job.

begin;

alter table sellerpilot_private.ai_cli_jobs
  add column if not exists available_at timestamptz not null default now();

alter table sellerpilot_private.ai_cli_jobs
  add column if not exists preparation_failure_count integer not null default 0;

alter table sellerpilot_private.ai_cli_jobs
  add column if not exists claim_token uuid;

-- Recover only expired pre-migration claims. A live claim must be drained by
-- the rollout procedure; inventing a nonce for it would make a healthy worker
-- unable to complete and could turn an in-flight generation into a false retry.
update sellerpilot_private.ai_cli_jobs
   set status = case when attempt_count >= 3 then 'failed' else 'queued' end,
       error_message = case
         when attempt_count >= 3 then 'CLI worker lease expired three times.'
         else error_message
       end,
       worker_token_id = null,
       claim_token = null,
       lease_expires_at = null,
       available_at = case when attempt_count >= 3 then available_at else now() end,
       completed_at = case when attempt_count >= 3 then now() else completed_at end,
       updated_at = now()
 where status = 'running'
   and (lease_expires_at is null or lease_expires_at <= now());

do $$
begin
  if exists (
    select 1
      from sellerpilot_private.ai_cli_jobs
     where status = 'running'
  ) then
    raise exception 'live AI jobs must drain before claim nonce rollout';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'ai_cli_jobs_preparation_failure_count_check'
       and conrelid = 'sellerpilot_private.ai_cli_jobs'::regclass
  ) then
    alter table sellerpilot_private.ai_cli_jobs
      add constraint ai_cli_jobs_preparation_failure_count_check
      check (preparation_failure_count between 0 and 3);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'ai_cli_jobs_running_claim_token_check'
       and conrelid = 'sellerpilot_private.ai_cli_jobs'::regclass
  ) then
    alter table sellerpilot_private.ai_cli_jobs
      add constraint ai_cli_jobs_running_claim_token_check
      check (status <> 'running' or claim_token is not null);
  end if;
end
$$;

create index if not exists ai_cli_jobs_available_queue_idx
  on sellerpilot_private.ai_cli_jobs (available_at, created_at)
  where status = 'queued';

create or replace function public.sellerpilot_claim_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  update sellerpilot_private.ai_cli_jobs j
     set status = case when j.attempt_count >= 3 then 'failed' else 'queued' end,
         error_message = case when j.attempt_count >= 3 then 'CLI worker lease expired three times.' else j.error_message end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = case when j.attempt_count >= 3 then j.available_at else now() end,
         completed_at = case when j.attempt_count >= 3 then now() else j.completed_at end,
         updated_at = now()
   where j.status = 'running'
     and j.lease_expires_at < now();

  select j.id into v_job_id
    from sellerpilot_private.ai_cli_jobs j
   where j.status = 'queued'
     and j.available_at <= now()
   order by j.available_at, j.created_at
   for update skip locked
   limit 1;

  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();

  update sellerpilot_private.ai_cli_jobs
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = attempt_count + 1,
         lease_expires_at = now() + interval '15 minutes',
         available_at = now(),
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_job_id;

  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values (
    'job_claimed',
    v_token_id,
    v_job_id,
    jsonb_build_object('worker_version', left(coalesce(p_worker_version, ''), 80))
  );

  select jsonb_build_object(
    'id', j.id,
    'claim_token', j.claim_token,
    'kind', j.kind,
    'request', j.request_payload,
    'attempt_count', j.attempt_count
  ) into v_result
    from sellerpilot_private.ai_cli_jobs j
   where j.id = v_job_id;
  return v_result;
end;
$$;

create or replace function public.sellerpilot_service_release_ai_job_claim(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_safe_reason text default null,
  p_retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_retry_after_seconds integer := greatest(30, least(coalesce(p_retry_after_seconds, 60), 900));
  v_restored_attempt_count integer;
  v_preparation_failure_count integer;
  v_terminal boolean;
  v_safe_reason text := left(coalesce(nullif(trim(p_safe_reason), ''), 'claim_preparation_failed'), 180);
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null then
    return false;
  end if;

  -- Compensation is service-role-only. Match the exact token that owns the
  -- claim even if it was revoked or expired during storage preparation.
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
   for update;
  if v_token_id is null then return false; end if;

  update sellerpilot_private.ai_cli_jobs j
     set status = case when j.preparation_failure_count + 1 >= 3 then 'failed' else 'queued' end,
         attempt_count = greatest(j.attempt_count - 1, 0),
         preparation_failure_count = least(j.preparation_failure_count + 1, 3),
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = case
           when j.preparation_failure_count + 1 >= 3 then j.available_at
           else now() + (v_retry_after_seconds * interval '1 second')
         end,
         started_at = case when j.attempt_count <= 1 then null else j.started_at end,
         completed_at = case when j.preparation_failure_count + 1 >= 3 then now() else null end,
         error_message = case
           when j.preparation_failure_count + 1 >= 3
             then left('Claim preparation failed three times: ' || v_safe_reason, 500)
           else null
         end,
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now()
  returning
    attempt_count,
    preparation_failure_count
  into
    v_restored_attempt_count,
    v_preparation_failure_count;
  if not found then return false; end if;
  v_terminal := v_preparation_failure_count >= 3;

  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values (
    case when v_terminal then 'job_failed' else 'job_retried' end,
    v_token_id,
    p_job_id,
    jsonb_build_object(
      'source', 'claim_preparation',
      'reason', v_safe_reason,
      'retry_after_seconds', case when v_terminal then 0 else v_retry_after_seconds end,
      'restored_attempt_count', v_restored_attempt_count,
      'preparation_failure_count', v_preparation_failure_count,
      'terminal', v_terminal
    )
  );
  return true;
end;
$$;

-- Heartbeats may renew only the still-live lease owned by this exact worker.
-- Returning a job's generic `running` status after a zero-row update would let
-- a stale worker continue after another worker reclaimed the same job.
drop function if exists public.sellerpilot_touch_ai_job(text, uuid, text);

create function public.sellerpilot_touch_ai_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_worker_version text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_status text;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  update sellerpilot_private.ai_cli_jobs j
     set lease_expires_at = now() + interval '15 minutes',
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now()
  returning j.status into v_status;
  if found then return v_status; end if;

  if exists (
    select 1 from sellerpilot_private.ai_cli_jobs j where j.id = p_job_id
  ) then
    return 'ownership_lost';
  end if;
  return null;
end;
$$;

drop function if exists public.sellerpilot_service_begin_ai_job_completion(text, uuid);

create function public.sellerpilot_service_begin_ai_job_completion(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
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
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_claim_token is null then return false; end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then return false; end if;

  update sellerpilot_private.ai_cli_jobs j
     set lease_expires_at = greatest(j.lease_expires_at, now() + interval '5 minutes')
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now()
   where id = v_token_id;
  return true;
end;
$$;

drop function if exists public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text);

create function public.sellerpilot_complete_ai_job(
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
  v_asset_id text;
  v_asset_path text;
  v_expected_asset_file text;
  v_source_job_id uuid;
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'invalid completion status'; end if;
  if p_claim_token is null then return false; end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select j.kind, j.request_payload into v_kind, v_request
    from sellerpilot_private.ai_cli_jobs j
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now()
   for update;
  if not found then return false; end if;

  if v_kind = 'product_asset_regeneration' and p_status = 'succeeded' then
    v_asset_id := v_request->>'asset_id';
    v_source_job_id := (v_request->>'source_job_id')::uuid;
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
    ) <> 8 then
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
           else '__invalid_asset__'
         end
       )
    ) then
      raise exception 'invalid studio asset claim paths';
    end if;
  end if;

  update sellerpilot_private.ai_cli_jobs j
     set status = p_status,
         result_payload = case when p_status = 'succeeded' then p_result_payload else null end,
         error_message = case when p_status = 'failed' then left(coalesce(p_error_message, 'CLI worker failed.'), 500) else null end,
         claim_token = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now();
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
     where id = v_source_job_id
       and kind = 'product_studio'
       and status = 'succeeded';
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

revoke all on function public.sellerpilot_claim_ai_job(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_release_ai_job_claim(text, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.sellerpilot_touch_ai_job(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_ai_job_completion(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_ai_job(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.sellerpilot_claim_ai_job(text, text) to service_role;
grant execute on function public.sellerpilot_service_release_ai_job_claim(text, uuid, uuid, text, integer) to service_role;
grant execute on function public.sellerpilot_touch_ai_job(text, uuid, uuid, text) to service_role;
grant execute on function public.sellerpilot_service_begin_ai_job_completion(text, uuid, uuid) to service_role;
grant execute on function public.sellerpilot_complete_ai_job(text, uuid, uuid, text, jsonb, text) to service_role;

commit;
