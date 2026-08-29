-- Bound server-side product image work across independent Vercel invocations.
-- The advisory transaction lock makes the running-count admission atomic even
-- during worker-token rotation, while the existing row/claim-token lease fence
-- remains the authority for each individual job.

begin;

create or replace function public.sellerpilot_claim_product_ai_job(
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
  v_running_jobs integer;
  v_result jsonb;
  v_context jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'ai'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where token.id = v_token_id;

  -- Claims from different Vercel invocations and temporarily overlapping AI
  -- tokens must share one admission decision. Completion never takes this lock:
  -- a concurrent completion can only free capacity, never exceed the bound.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065061);

  update sellerpilot_private.ai_cli_jobs job
     set status = case when job.attempt_count >= 3 then 'failed' else 'queued' end,
         error_message = case
           when job.attempt_count >= 3 then 'CLI worker lease expired three times.'
           else job.error_message
         end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = case
           when job.attempt_count >= 3 then job.available_at
           else clock_timestamp()
         end,
         completed_at = case
           when job.attempt_count >= 3 then clock_timestamp()
           else job.completed_at
         end,
         updated_at = clock_timestamp()
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running'
     and job.lease_expires_at < clock_timestamp();

  select count(*)::integer
    into v_running_jobs
    from sellerpilot_private.ai_cli_jobs job
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running';
  -- One Studio job already owns three independent three-wide remote lanes, so
  -- admitting a second job would exceed the verified nine-call process bound.
  if v_running_jobs >= 1 then return null; end if;

  select job.id
    into v_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'queued'
     and job.available_at <= clock_timestamp()
   order by job.available_at, job.created_at
   for update skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.ai_cli_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         available_at = clock_timestamp(),
         started_at = coalesce(job.started_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.status = 'queued';
  if not found then
    raise exception 'product AI job claim lost its row lock';
  end if;

  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, job_id, safe_detail
  ) values (
    'job_claimed',
    v_token_id,
    v_job_id,
    jsonb_build_object(
      'worker_version', left(coalesce(p_worker_version, ''), 80),
      'claim_scope', 'product'
    )
  );

  select jsonb_build_object(
           'id', job.id,
           'claim_token', job.claim_token,
           'kind', job.kind,
           'request', job.request_payload,
           'attempt_count', job.attempt_count,
           'claim_scope', 'product'
         ),
         job.terminal_image_failure_context
    into v_result, v_context
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = v_claim_token;
  if not found then
    raise exception 'claimed product AI job ownership mismatch';
  end if;
  if v_context is not null then
    v_result := v_result || jsonb_build_object(
      'terminal_image_failure_context', v_context
    );
  end if;
  return v_result;
end;
$$;

-- Release automation must quiesce Studio claims before applying this function.
-- Fail closed instead of accepting an already-overlapping runtime that the new
-- admission fence could only prevent prospectively.
do $$
declare
  v_running_jobs integer;
begin
  select count(*)::integer
    into v_running_jobs
    from sellerpilot_private.ai_cli_jobs job
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running';
  if v_running_jobs > 1 then
    raise exception 'server product studio concurrency must be quiesced before migration';
  end if;
end;
$$;

-- The claimer's advisory lock gives a clean null response at capacity. This
-- partial unique index is the final declarative fence for a pre-commit caller
-- that began executing the previous function body during a rolling cutover.
create unique index ai_cli_jobs_single_server_studio_running_uidx
  on sellerpilot_private.ai_cli_jobs ((1))
  where status = 'running'
    and kind in ('product_studio', 'product_asset_regeneration');

revoke all on function public.sellerpilot_claim_product_ai_job(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_product_ai_job(text, text)
  to service_role;

comment on function public.sellerpilot_claim_product_ai_job(text, text) is
  'Claims one server product studio or asset-regeneration job at a time across invocations; each job owns the verified nine-call remote bound.';

commit;
