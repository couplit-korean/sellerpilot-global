-- Queue AI Storage objects before deleting their database jobs. Storage API
-- failures are then retriable without retaining the full job payload forever.

begin;

create table if not exists sellerpilot_private.ai_storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'sellerpilot-ai'
    check (bucket = 'sellerpilot-ai'),
  object_path text not null check (
    length(object_path) between 1 and 1000
    and object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
    and object_path ~ '^((results/)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/input/))'
  ),
  status text not null default 'queued'
    check (status in ('queued', 'running')),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0
    check (attempt_count between 0 and 20),
  available_at timestamptz not null default clock_timestamp(),
  last_error text check (last_error is null or length(last_error) <= 180),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bucket, object_path),
  check (
    (status = 'queued' and claim_token is null and lease_expires_at is null)
    or
    (status = 'running' and claim_token is not null and lease_expires_at is not null)
  )
);

create index if not exists ai_storage_cleanup_available_idx
  on sellerpilot_private.ai_storage_cleanup_queue (available_at, created_at)
  where status = 'queued';
create index if not exists ai_storage_cleanup_lease_idx
  on sellerpilot_private.ai_storage_cleanup_queue (lease_expires_at)
  where status = 'running';

alter table sellerpilot_private.ai_storage_cleanup_queue enable row level security;
revoke all on sellerpilot_private.ai_storage_cleanup_queue
  from public, anon, authenticated, service_role;

-- Signed result-upload URLs can succeed immediately before a cancellation or
-- lease loss. Keep every claim-bound destination durable until the same claim
-- commits successfully or hands it to the delayed cleanup queue.
create table if not exists sellerpilot_private.ai_result_upload_staging (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  claim_token uuid not null,
  object_path text not null check (
    length(object_path) between 1 and 1000
    and object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
    and object_path ~ '^results/[0-9a-fA-F-]{36}/claims/[0-9a-fA-F-]{36}/[a-z0-9][a-z0-9-]{0,80}\.png$'
  ),
  staged_at timestamptz not null default clock_timestamp(),
  unique (job_id, claim_token, object_path)
);

create index if not exists ai_result_upload_staging_job_claim_idx
  on sellerpilot_private.ai_result_upload_staging (job_id, claim_token);
create index if not exists ai_result_upload_staging_age_idx
  on sellerpilot_private.ai_result_upload_staging (staged_at);

alter table sellerpilot_private.ai_result_upload_staging enable row level security;
revoke all on sellerpilot_private.ai_result_upload_staging
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_stage_ai_result_uploads(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_paths text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_prefix text;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null
     or coalesce(cardinality(p_paths), 0) not between 1 and 8
     or (select count(*) from unnest(p_paths) path) <>
        (select count(distinct path) from unnest(p_paths) path)
     or exists (
       select 1
         from unnest(p_paths) path
        where path is null
           or length(path) not between 1 and 1000
           or path !~ '^results/[0-9a-fA-F-]{36}/claims/[0-9a-fA-F-]{36}/[a-z0-9][a-z0-9-]{0,80}\.png$'
           or path ~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
     ) then
    raise exception 'invalid AI result upload staging';
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

  perform 1
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.worker_token_id = v_token_id
     and job.lease_expires_at > clock_timestamp()
     for update;
  if not found then return false; end if;

  v_prefix := 'results/' || p_job_id::text || '/claims/' || p_claim_token::text || '/';
  if exists (
    select 1 from unnest(p_paths) path
     where left(path, length(v_prefix)) <> v_prefix
  ) then
    raise exception 'AI result upload path does not match claim';
  end if;

  insert into sellerpilot_private.ai_result_upload_staging (
    job_id, claim_token, object_path
  )
  select p_job_id, p_claim_token, path
    from unnest(p_paths) path
  on conflict (job_id, claim_token, object_path) do nothing;
  return true;
end;
$$;

create or replace function sellerpilot_private.manage_ai_result_upload_staging()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_token uuid := old.claim_token;
begin
  if tg_op = 'DELETE' then
    insert into sellerpilot_private.ai_storage_cleanup_queue (
      bucket, object_path, available_at, last_error
    )
    -- Supabase signed upload URLs remain valid for two hours. Delay deletion
    -- beyond that window so a late worker upload cannot recreate an orphan
    -- after cleanup has already run.
    select
      'sellerpilot-ai', staging.object_path,
      clock_timestamp() + interval '3 hours',
      'partial_result_upload_cleanup'
      from sellerpilot_private.ai_result_upload_staging staging
     where staging.job_id = old.id
    on conflict (bucket, object_path) do nothing;

    delete from sellerpilot_private.ai_result_upload_staging staging
     where staging.job_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and new.status = 'succeeded'
     and old.status is distinct from new.status then
    delete from sellerpilot_private.ai_result_upload_staging staging
     where staging.job_id = old.id
       and staging.claim_token = old.claim_token;
    return new;
  end if;

  if old.claim_token is not null
     and (
       new.claim_token is distinct from old.claim_token
       or new.status in ('failed', 'cancelled')
     ) then
    insert into sellerpilot_private.ai_storage_cleanup_queue (
      bucket, object_path, available_at, last_error
    )
    select
      'sellerpilot-ai', staging.object_path,
      clock_timestamp() + interval '3 hours',
      'partial_result_upload_cleanup'
      from sellerpilot_private.ai_result_upload_staging staging
     where staging.job_id = new.id
       and staging.claim_token = v_claim_token
    on conflict (bucket, object_path) do nothing;

    delete from sellerpilot_private.ai_result_upload_staging staging
     where staging.job_id = new.id
       and staging.claim_token = v_claim_token;
  end if;

  return new;
end;
$$;

revoke all on function sellerpilot_private.manage_ai_result_upload_staging()
  from public, anon, authenticated, service_role;

drop trigger if exists ai_result_upload_staging_lifecycle
  on sellerpilot_private.ai_cli_jobs;
create trigger ai_result_upload_staging_lifecycle
before update of status, claim_token or delete
on sellerpilot_private.ai_cli_jobs
for each row execute function sellerpilot_private.manage_ai_result_upload_staging();

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
set search_path = ''
as $$
begin
  if p_completed_before > clock_timestamp() - interval '7 days' then
    raise exception 'retention window must be at least seven days';
  end if;

  return query
  with candidates as (
    select job.id,
           array(
             select jsonb_array_elements_text(
               case
                 when job.request_payload->'image_paths' is null then '[]'::jsonb
                 when jsonb_typeof(job.request_payload->'image_paths') = 'array'
                   then job.request_payload->'image_paths'
                 else '["__invalid_image_paths__"]'::jsonb
               end
             )
           ) as inputs,
           array(
             select value
               from jsonb_each_text(
                 case
                   when job.result_payload->'asset_storage_paths' is null
                     then '{}'::jsonb
                   when jsonb_typeof(job.result_payload->'asset_storage_paths') = 'object'
                     then job.result_payload->'asset_storage_paths'
                   else '{"__invalid__":"__invalid_asset_storage_paths__"}'::jsonb
                 end
               )
             union all
             select nullif(job.result_payload->>'hero_storage_path', '')
              where nullif(job.result_payload->>'hero_storage_path', '') is not null
             union all
             select staging.object_path
               from sellerpilot_private.ai_result_upload_staging staging
              where staging.job_id = job.id
           ) as generated_paths
      from sellerpilot_private.ai_cli_jobs job
     where job.status in ('succeeded', 'failed', 'cancelled')
       and coalesce(job.completed_at, job.updated_at) < p_completed_before
       and not exists (
         select 1
           from sellerpilot_private.products product
          where product.ai_job_id = job.id
             or (
               job.kind = 'product_asset_regeneration'
               and product.ai_job_id::text = job.request_payload->>'source_job_id'
             )
       )
  ),
  validated as (
    select candidates.*
      from candidates
     where not exists (
       select 1
         from unnest(
           coalesce(candidates.inputs, array[]::text[])
           || coalesce(candidates.generated_paths, array[]::text[])
         ) as path(object_path)
        where nullif(trim(path.object_path), '') is not null
          and not (
            length(path.object_path) <= 1000
            and path.object_path ~ '^((results/)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/input/))'
            and path.object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
          )
     )
  ),
  selected as (
    select validated.id, validated.inputs, validated.generated_paths
      from validated
      join sellerpilot_private.ai_cli_jobs job on job.id = validated.id
     order by coalesce(job.completed_at, job.updated_at), job.id
     for update of job skip locked
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ),
  enqueued as (
    insert into sellerpilot_private.ai_storage_cleanup_queue (
      bucket, object_path
    )
    select 'sellerpilot-ai', path.object_path
      from selected
      cross join lateral unnest(
        coalesce(selected.inputs, array[]::text[])
        || coalesce(selected.generated_paths, array[]::text[])
      ) as path(object_path)
     where nullif(trim(path.object_path), '') is not null
       and length(path.object_path) <= 1000
       and path.object_path ~ '^((results/)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/input/))'
       and path.object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
    on conflict (bucket, object_path) do nothing
    returning id
  ),
  audited as (
    insert into sellerpilot_private.ai_cli_audit (
      action, safe_detail
    )
    select
      'job_pruned',
      jsonb_build_object(
        'job_id', selected.id,
        'input_count', coalesce(cardinality(selected.inputs), 0),
        'result_count', coalesce(cardinality(selected.generated_paths), 0),
        'cleanup_queued',
          coalesce(cardinality(selected.inputs), 0)
          + coalesce(cardinality(selected.generated_paths), 0) > 0
      )
    from selected
    returning id as audit_id
  ),
  deleted as (
    delete from sellerpilot_private.ai_cli_jobs job
    using selected
    where job.id = selected.id
      and (select count(*) from enqueued) >= 0
      and (select count(*) from audited) >= 0
    returning job.id
  )
  select selected.id, selected.inputs, selected.generated_paths
    from selected
    join deleted on deleted.id = selected.id;
end;
$$;

create or replace function public.sellerpilot_service_claim_ai_storage_cleanup(
  p_limit integer default 200,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 900);
  v_claim_token uuid := gen_random_uuid();
  v_paths jsonb;
begin
  update sellerpilot_private.ai_storage_cleanup_queue cleanup
     set status = 'queued',
         claim_token = null,
         lease_expires_at = null,
         available_at = clock_timestamp(),
         last_error = coalesce(cleanup.last_error, 'cleanup_lease_expired'),
         updated_at = clock_timestamp()
   where cleanup.status = 'running'
     and cleanup.lease_expires_at <= clock_timestamp();

  with selected as (
    select cleanup.id
      from sellerpilot_private.ai_storage_cleanup_queue cleanup
     where cleanup.status = 'queued'
       and cleanup.available_at <= clock_timestamp()
     order by cleanup.available_at, cleanup.created_at, cleanup.id
     for update skip locked
     limit v_limit
  ), claimed as (
    update sellerpilot_private.ai_storage_cleanup_queue cleanup
       set status = 'running',
           claim_token = v_claim_token,
           lease_expires_at = clock_timestamp()
             + make_interval(secs => v_lease_seconds),
           attempt_count = least(cleanup.attempt_count + 1, 20),
           updated_at = clock_timestamp()
      from selected
     where cleanup.id = selected.id
    returning cleanup.object_path
  )
  select jsonb_agg(claimed.object_path order by claimed.object_path)
    into v_paths
    from claimed;

  if v_paths is null then return null; end if;
  return jsonb_build_object(
    'claimToken', v_claim_token,
    'bucket', 'sellerpilot-ai',
    'paths', v_paths
  );
end;
$$;

create or replace function public.sellerpilot_service_complete_ai_storage_cleanup(
  p_claim_token uuid,
  p_removed_paths text[],
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer := 0;
  v_requeued integer := 0;
begin
  if p_claim_token is null
     or coalesce(cardinality(p_removed_paths), 0) > 500
     or exists (
       select 1
         from unnest(coalesce(p_removed_paths, array[]::text[])) path
        where length(path) not between 1 and 1000
     ) then
    raise exception 'invalid AI storage cleanup completion';
  end if;

  delete from sellerpilot_private.ai_storage_cleanup_queue cleanup
   where cleanup.status = 'running'
     and cleanup.claim_token = p_claim_token
     and cleanup.object_path = any(coalesce(p_removed_paths, array[]::text[]));
  get diagnostics v_removed = row_count;

  update sellerpilot_private.ai_storage_cleanup_queue cleanup
     set status = 'queued',
         claim_token = null,
         lease_expires_at = null,
         available_at = clock_timestamp()
           + make_interval(secs => least(900, greatest(30, cleanup.attempt_count * 30))),
         last_error = left(coalesce(
           nullif(trim(p_error), ''),
           'storage_remove_incomplete'
         ), 180),
         updated_at = clock_timestamp()
   where cleanup.status = 'running'
     and cleanup.claim_token = p_claim_token;
  get diagnostics v_requeued = row_count;

  return jsonb_build_object('removed', v_removed, 'requeued', v_requeued);
end;
$$;

revoke all on function public.sellerpilot_prune_ai_jobs(timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_ai_storage_cleanup(integer, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_ai_storage_cleanup(uuid, text[], text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_stage_ai_result_uploads(text, uuid, uuid, text[])
  from public, anon, authenticated;

grant execute on function public.sellerpilot_prune_ai_jobs(timestamptz, integer)
  to service_role;
grant execute on function public.sellerpilot_service_claim_ai_storage_cleanup(integer, integer)
  to service_role;
grant execute on function public.sellerpilot_service_complete_ai_storage_cleanup(uuid, text[], text)
  to service_role;
grant execute on function public.sellerpilot_service_stage_ai_result_uploads(text, uuid, uuid, text[])
  to service_role;

commit;
