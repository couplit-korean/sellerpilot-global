-- SellerPilot AI operations: history, cancellation, safe retry, and retention.
-- Depends on 20260816065848_sellerpilot_ai_cli_jobs.sql.

begin;

alter table sellerpilot_private.ai_cli_audit
  drop constraint if exists ai_cli_audit_action_check;

alter table sellerpilot_private.ai_cli_audit
  add constraint ai_cli_audit_action_check
  check (action in (
    'token_issued',
    'token_revoked',
    'job_queued',
    'job_claimed',
    'job_succeeded',
    'job_failed',
    'job_retried',
    'job_cancelled',
    'job_pruned'
  ));

create or replace function public.sellerpilot_list_ai_jobs(p_limit integer default 30)
returns table (
  id uuid,
  kind text,
  status text,
  attempt_count integer,
  image_count integer,
  product_description text,
  product_url text,
  error_message text,
  has_result boolean,
  has_hero boolean,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  return query
  select
    j.id,
    j.kind,
    j.status,
    j.attempt_count,
    coalesce(jsonb_array_length(j.request_payload->'image_paths'), 0),
    left(coalesce(j.request_payload->>'description', ''), 160),
    left(coalesce(j.request_payload->>'product_url', ''), 500),
    j.error_message,
    j.result_payload is not null,
    coalesce(j.result_payload ? 'asset_storage_paths' or j.result_payload ? 'hero_storage_path', false),
    j.created_at,
    j.started_at,
    j.completed_at,
    j.updated_at
  from sellerpilot_private.ai_cli_jobs j
  where j.created_by = auth.uid()
  order by j.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.sellerpilot_retry_ai_job(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_updated integer;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_jobs
     set status = 'queued',
         result_payload = null,
         error_message = null,
         worker_token_id = null,
         lease_expires_at = null,
         started_at = null,
         completed_at = null,
         updated_at = now()
   where id = p_id
     and created_by = auth.uid()
     and status in ('failed', 'cancelled');
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
    values ('job_retried', auth.uid(), p_id, jsonb_build_object('source', 'admin_ui'));
  end if;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_cancel_ai_job(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_updated integer;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_jobs
     set status = 'cancelled',
         error_message = '관리자가 작업을 취소했습니다.',
         worker_token_id = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where id = p_id
     and created_by = auth.uid()
     and status in ('queued', 'running');
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
    values ('job_cancelled', auth.uid(), p_id, jsonb_build_object('source', 'admin_ui'));
  end if;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_prune_ai_jobs(
  p_completed_before timestamptz,
  p_limit integer default 200
)
returns table (
  job_id uuid,
  input_paths text[],
  result_paths text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_completed_before > now() - interval '7 days' then
    raise exception 'retention window must be at least seven days';
  end if;

  return query
  with selected as (
    select j.id,
           array(
             select jsonb_array_elements_text(j.request_payload->'image_paths')
           ) as inputs,
           array(
             select value
             from jsonb_each_text(coalesce(j.result_payload->'asset_storage_paths', '{}'::jsonb))
             union all
             select nullif(j.result_payload->>'hero_storage_path', '')
             where nullif(j.result_payload->>'hero_storage_path', '') is not null
           ) as generated_paths
      from sellerpilot_private.ai_cli_jobs j
     where j.status in ('succeeded', 'failed', 'cancelled')
       and coalesce(j.completed_at, j.updated_at) < p_completed_before
     order by coalesce(j.completed_at, j.updated_at)
     for update skip locked
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ),
  audited as (
    insert into sellerpilot_private.ai_cli_audit (action, job_id, safe_detail)
    select 'job_pruned', s.id, jsonb_build_object(
      'input_count', coalesce(cardinality(s.inputs), 0),
      'result_count', coalesce(cardinality(s.generated_paths), 0)
    )
    from selected s
    returning job_id
  ),
  deleted as (
    delete from sellerpilot_private.ai_cli_jobs j
    using selected s
    where j.id = s.id
    returning j.id
  )
  select s.id, s.inputs, s.generated_paths
  from selected s
  join deleted d on d.id = s.id;
end;
$$;

create or replace function public.sellerpilot_touch_ai_job(
  p_token_hash text,
  p_job_id uuid,
  p_worker_version text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_status text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

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

  update sellerpilot_private.ai_cli_jobs
     set lease_expires_at = now() + interval '15 minutes',
         updated_at = now()
   where id = p_job_id
     and status = 'running'
     and worker_token_id = v_token_id;

  select j.status into v_status
  from sellerpilot_private.ai_cli_jobs j
  where j.id = p_job_id;
  return v_status;
end;
$$;

revoke all on function public.sellerpilot_list_ai_jobs(integer) from public, anon;
revoke all on function public.sellerpilot_retry_ai_job(uuid) from public, anon;
revoke all on function public.sellerpilot_cancel_ai_job(uuid) from public, anon;
revoke all on function public.sellerpilot_prune_ai_jobs(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.sellerpilot_touch_ai_job(text, uuid, text) from public, anon, authenticated;

grant execute on function public.sellerpilot_list_ai_jobs(integer) to authenticated;
grant execute on function public.sellerpilot_retry_ai_job(uuid) to authenticated;
grant execute on function public.sellerpilot_cancel_ai_job(uuid) to authenticated;
grant execute on function public.sellerpilot_prune_ai_jobs(timestamptz, integer) to service_role;
grant execute on function public.sellerpilot_touch_ai_job(text, uuid, text) to service_role;

commit;
