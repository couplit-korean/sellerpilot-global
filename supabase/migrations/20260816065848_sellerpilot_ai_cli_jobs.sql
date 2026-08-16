-- SellerPilot ChatGPT/Codex CLI worker queue.
-- ChatGPT OAuth credentials stay on the worker machine and are never stored in Supabase.

begin;

create table if not exists sellerpilot_private.ai_cli_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  fingerprint text not null check (char_length(fingerprint) = 12),
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  last_version text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists ai_cli_worker_one_active_idx
  on sellerpilot_private.ai_cli_worker_tokens ((status))
  where status = 'active';

create table if not exists sellerpilot_private.ai_cli_jobs (
  id uuid primary key,
  kind text not null check (kind in ('product_studio')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  result_payload jsonb check (result_payload is null or jsonb_typeof(result_payload) = 'object'),
  error_message text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id) on delete set null,
  lease_expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ai_cli_jobs_queue_idx
  on sellerpilot_private.ai_cli_jobs (created_at)
  where status = 'queued';

create index if not exists ai_cli_jobs_owner_time_idx
  on sellerpilot_private.ai_cli_jobs (created_by, created_at desc);

create table if not exists sellerpilot_private.ai_cli_audit (
  id bigint generated always as identity primary key,
  action text not null check (action in ('token_issued', 'token_revoked', 'job_queued', 'job_claimed', 'job_succeeded', 'job_failed')),
  actor_user_id uuid references auth.users(id) on delete set null,
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id) on delete set null,
  job_id uuid references sellerpilot_private.ai_cli_jobs(id) on delete set null,
  safe_detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table sellerpilot_private.ai_cli_worker_tokens enable row level security;
alter table sellerpilot_private.ai_cli_jobs enable row level security;
alter table sellerpilot_private.ai_cli_audit enable row level security;

revoke all on sellerpilot_private.ai_cli_worker_tokens from public, anon, authenticated;
revoke all on sellerpilot_private.ai_cli_jobs from public, anon, authenticated;
revoke all on sellerpilot_private.ai_cli_audit from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sellerpilot-ai',
  'sellerpilot-ai',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sellerpilot ai admin upload" on storage.objects;
create policy "sellerpilot ai admin upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sellerpilot-ai'
  and public.sellerpilot_is_admin()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "sellerpilot ai admin cleanup" on storage.objects;
create policy "sellerpilot ai admin cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'sellerpilot-ai'
  and public.sellerpilot_is_admin()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.sellerpilot_issue_ai_worker_token(
  p_label text,
  p_token_hash text,
  p_fingerprint text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if char_length(trim(p_label)) not between 1 and 80
     or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_fingerprint !~ '^[A-F0-9]{12}$'
     or p_expires_at <= now() then
    raise exception 'invalid worker token metadata';
  end if;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens
       set status = 'revoked', revoked_at = now()
     where status = 'active'
     returning id
  )
  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, worker_token_id, safe_detail)
  select 'token_revoked', auth.uid(), id, jsonb_build_object('reason', 'rotation')
  from revoked;

  insert into sellerpilot_private.ai_cli_worker_tokens (
    id, label, token_hash, fingerprint, expires_at, created_by
  ) values (
    v_id, trim(p_label), p_token_hash, p_fingerprint, p_expires_at, auth.uid()
  );

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, worker_token_id, safe_detail)
  values ('token_issued', auth.uid(), v_id, jsonb_build_object('label', trim(p_label), 'fingerprint', p_fingerprint, 'expires_at', p_expires_at));
  return v_id;
end;
$$;

create or replace function public.sellerpilot_ai_runtime_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'worker', (
      select jsonb_build_object(
        'label', t.label,
        'fingerprint', t.fingerprint,
        'expires_at', t.expires_at,
        'last_seen_at', t.last_seen_at,
        'last_version', t.last_version
      )
      from sellerpilot_private.ai_cli_worker_tokens t
      where t.status = 'active' and t.expires_at > now()
      order by t.created_at desc
      limit 1
    ),
    'queued', (select count(*) from sellerpilot_private.ai_cli_jobs where status = 'queued'),
    'running', (select count(*) from sellerpilot_private.ai_cli_jobs where status = 'running'),
    'succeeded_today', (select count(*) from sellerpilot_private.ai_cli_jobs where status = 'succeeded' and completed_at >= date_trunc('day', now())),
    'failed_today', (select count(*) from sellerpilot_private.ai_cli_jobs where status = 'failed' and completed_at >= date_trunc('day', now()))
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.sellerpilot_create_ai_job(
  p_id uuid,
  p_kind text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_kind <> 'product_studio'
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'image_paths') <> 'array'
     or jsonb_array_length(p_request_payload->'image_paths') not between 1 and 100
     or octet_length(p_request_payload::text) > 65536 then
    raise exception 'invalid AI job payload';
  end if;

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (p_id, p_kind, p_request_payload, auth.uid());

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', auth.uid(), p_id, jsonb_build_object('kind', p_kind, 'image_count', jsonb_array_length(p_request_payload->'image_paths')));
  return p_id;
end;
$$;

create or replace function public.sellerpilot_get_ai_job(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'status', j.status,
    'result', j.result_payload,
    'error', j.error_message,
    'attempt_count', j.attempt_count,
    'created_at', j.created_at,
    'started_at', j.started_at,
    'completed_at', j.completed_at,
    'updated_at', j.updated_at
  ) into v_result
  from sellerpilot_private.ai_cli_jobs j
  where j.id = p_id and j.created_by = auth.uid();

  return v_result;
end;
$$;

create or replace function public.sellerpilot_claim_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_result jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select t.id into v_token_id
  from sellerpilot_private.ai_cli_worker_tokens t
  where t.token_hash = p_token_hash and t.status = 'active' and t.expires_at > now()
  for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(), last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  update sellerpilot_private.ai_cli_jobs
     set status = case when attempt_count >= 3 then 'failed' else 'queued' end,
         error_message = case when attempt_count >= 3 then 'CLI worker lease expired three times.' else error_message end,
         worker_token_id = null,
         lease_expires_at = null,
         completed_at = case when attempt_count >= 3 then now() else completed_at end,
         updated_at = now()
   where status = 'running' and lease_expires_at < now();

  select j.id into v_job_id
  from sellerpilot_private.ai_cli_jobs j
  where j.status = 'queued'
  order by j.created_at
  for update skip locked
  limit 1;

  if v_job_id is null then return null; end if;

  update sellerpilot_private.ai_cli_jobs
     set status = 'running',
         worker_token_id = v_token_id,
         attempt_count = attempt_count + 1,
         lease_expires_at = now() + interval '15 minutes',
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_job_id;

  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values ('job_claimed', v_token_id, v_job_id, jsonb_build_object('worker_version', left(coalesce(p_worker_version, ''), 80)));

  select jsonb_build_object(
    'id', j.id,
    'kind', j.kind,
    'request', j.request_payload,
    'attempt_count', j.attempt_count
  ) into v_result
  from sellerpilot_private.ai_cli_jobs j
  where j.id = v_job_id;
  return v_result;
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
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed') then raise exception 'invalid completion status'; end if;

  select t.id into v_token_id
  from sellerpilot_private.ai_cli_worker_tokens t
  where t.token_hash = p_token_hash and t.status = 'active' and t.expires_at > now();
  if v_token_id is null then raise exception 'invalid worker token' using errcode = '42501'; end if;

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

  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values (
    case when p_status = 'succeeded' then 'job_succeeded' else 'job_failed' end,
    v_token_id,
    p_job_id,
    case when p_status = 'failed' then jsonb_build_object('error', left(coalesce(p_error_message, ''), 180)) else '{}'::jsonb end
  );
  return true;
end;
$$;

revoke all on function public.sellerpilot_issue_ai_worker_token(text, text, text, timestamptz) from public, anon;
revoke all on function public.sellerpilot_ai_runtime_status() from public, anon;
revoke all on function public.sellerpilot_create_ai_job(uuid, text, jsonb) from public, anon;
revoke all on function public.sellerpilot_get_ai_job(uuid) from public, anon;
revoke all on function public.sellerpilot_claim_ai_job(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.sellerpilot_issue_ai_worker_token(text, text, text, timestamptz) to authenticated;
grant execute on function public.sellerpilot_ai_runtime_status() to authenticated;
grant execute on function public.sellerpilot_create_ai_job(uuid, text, jsonb) to authenticated;
grant execute on function public.sellerpilot_get_ai_job(uuid) to authenticated;
grant execute on function public.sellerpilot_claim_ai_job(text, text) to service_role;
grant execute on function public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text) to service_role;

commit;
