-- Run text-only product research in a Vercel Function without copying the
-- desktop AI worker bearer token into Vercel. The original ai_cli_jobs row
-- remains the only job ledger; these tables contain only server claim fences
-- and per-claim transition digests.

begin;

create table sellerpilot_private.server_product_research_claims (
  job_id uuid primary key
    references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
  claim_token uuid not null unique,
  claimed_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  check (lease_expires_at > claimed_at)
);

create table sellerpilot_private.server_product_research_completion_receipts (
  job_id uuid not null
    references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
  claim_token uuid not null,
  status text not null check (status in ('queued', 'succeeded', 'failed')),
  completion_fingerprint text not null
    check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id, claim_token)
);

alter table sellerpilot_private.server_product_research_claims enable row level security;
alter table sellerpilot_private.server_product_research_completion_receipts enable row level security;
revoke all on sellerpilot_private.server_product_research_claims
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.server_product_research_completion_receipts
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_claim_product_research_ai_job(
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_result jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  -- Recover any expired product_research lease, including a desktop claim
  -- left behind during cutover. The old claim nonce is cleared before this
  -- function can assign a new one, so a late desktop completion stays fenced.
  with expired as (
    update sellerpilot_private.ai_cli_jobs job
       set status = case when job.attempt_count >= 3 then 'failed' else 'queued' end,
           result_payload = null,
           error_message = case
             when job.attempt_count >= 3 then 'Server product research lease expired three times.'
             else null
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
             else null
           end,
           updated_at = clock_timestamp()
     where job.kind = 'product_research'
       and job.status = 'running'
       and job.lease_expires_at <= clock_timestamp()
    returning job.id, job.status, job.attempt_count
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  )
  select
    case when expired.status = 'failed' then 'job_failed' else 'job_retried' end,
    expired.id,
    jsonb_build_object(
      'source', 'vercel_product_research',
      'reason', 'lease_expired',
      'attempt_count', expired.attempt_count,
      'terminal', expired.status = 'failed'
    )
  from expired;

  delete from sellerpilot_private.server_product_research_claims claim
   where not exists (
     select 1
       from sellerpilot_private.ai_cli_jobs job
      where job.id = claim.job_id
        and job.kind = 'product_research'
        and job.status = 'running'
        and job.worker_token_id is null
        and job.claim_token = claim.claim_token
        and job.lease_expires_at > clock_timestamp()
   );

  select job.id
    into v_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.kind = 'product_research'
     and job.status = 'queued'
     and job.attempt_count < 3
     and job.available_at <= clock_timestamp()
   order by job.available_at, job.created_at
   for update skip locked
   limit 1;

  if v_job_id is null then return null; end if;

  insert into sellerpilot_private.server_product_research_claims (
    job_id, claim_token, claimed_at, lease_expires_at
  ) values (
    v_job_id,
    v_claim_token,
    clock_timestamp(),
    clock_timestamp() + interval '15 minutes'
  )
  on conflict (job_id) do update
    set claim_token = excluded.claim_token,
        claimed_at = excluded.claimed_at,
        lease_expires_at = excluded.lease_expires_at;

  update sellerpilot_private.ai_cli_jobs job
     set status = 'running',
         worker_token_id = null,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         available_at = clock_timestamp(),
         started_at = coalesce(job.started_at, clock_timestamp()),
         completed_at = null,
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.kind = 'product_research'
     and job.status = 'queued';
  if not found then
    raise exception 'server product research claim lost its row lock';
  end if;

  update sellerpilot_private.server_product_research_claims claim
     set lease_expires_at = (
       select job.lease_expires_at
         from sellerpilot_private.ai_cli_jobs job
        where job.id = v_job_id
     )
   where claim.job_id = v_job_id
     and claim.claim_token = v_claim_token;

  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  ) values (
    'job_claimed',
    v_job_id,
    jsonb_build_object(
      'source', 'vercel_product_research',
      'worker_version', left(coalesce(p_worker_version, ''), 80),
      'claim_scope', 'product_research'
    )
  );

  select jsonb_build_object(
    'id', job.id,
    'claim_token', job.claim_token,
    'kind', job.kind,
    'request', job.request_payload,
    'attempt_count', job.attempt_count,
    'claim_scope', 'server_product_research'
  )
    into v_result
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_job_id
     and job.status = 'running'
     and job.worker_token_id is null
     and job.claim_token = v_claim_token;
  if not found then
    raise exception 'server product research claim ownership mismatch';
  end if;
  return v_result;
end;
$$;

create function public.sellerpilot_service_touch_product_research_ai_job(
  p_job_id uuid,
  p_claim_token uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease_expires_at timestamptz := clock_timestamp() + interval '15 minutes';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_claim_token is null then return 'ownership_lost'; end if;

  perform 1
    from sellerpilot_private.ai_cli_jobs job
    join sellerpilot_private.server_product_research_claims claim
      on claim.job_id = job.id
     and claim.claim_token = p_claim_token
   where job.id = p_job_id
     and job.kind = 'product_research'
     and job.status = 'running'
     and job.worker_token_id is null
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and claim.lease_expires_at > clock_timestamp()
   for update of job, claim;
  if not found then return 'ownership_lost'; end if;

  update sellerpilot_private.ai_cli_jobs job
     set lease_expires_at = v_lease_expires_at,
         updated_at = clock_timestamp()
   where job.id = p_job_id;
  update sellerpilot_private.server_product_research_claims claim
     set lease_expires_at = v_lease_expires_at
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token;
  return 'running';
end;
$$;

create function public.sellerpilot_service_complete_product_research_ai_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_result_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_receipt record;
  v_fingerprint text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_claim_token is null then return false; end if;
  if jsonb_typeof(p_result_payload) is distinct from 'object'
     or p_result_payload->>'mode' <> 'cli-research'
     or pg_catalog.octet_length(p_result_payload::text) > 262144 then
    raise exception 'invalid product research result';
  end if;

  v_fingerprint := sellerpilot_private.ai_completion_fingerprint(
    'succeeded', p_result_payload, null
  );

  select job.kind, job.status, job.worker_token_id, job.claim_token,
         job.lease_expires_at
    into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
   for update;
  if not found then return false; end if;

  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.server_product_research_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token;
  if found then
    return v_receipt.status = 'succeeded'
       and v_receipt.completion_fingerprint = v_fingerprint;
  end if;

  if v_job.kind <> 'product_research'
     or v_job.status <> 'running'
     or v_job.worker_token_id is not null
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_expires_at <= clock_timestamp()
     or not exists (
       select 1
         from sellerpilot_private.server_product_research_claims claim
        where claim.job_id = p_job_id
          and claim.claim_token = p_claim_token
          and claim.lease_expires_at > clock_timestamp()
     ) then
    return false;
  end if;

  update sellerpilot_private.ai_cli_jobs job
     set status = 'succeeded',
         result_payload = p_result_payload,
         error_message = null,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = p_job_id;

  insert into sellerpilot_private.server_product_research_completion_receipts (
    job_id, claim_token, status, completion_fingerprint
  ) values (
    p_job_id, p_claim_token, 'succeeded', v_fingerprint
  );
  delete from sellerpilot_private.server_product_research_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token;
  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  ) values (
    'job_succeeded', p_job_id,
    jsonb_build_object('source', 'vercel_product_research')
  );
  return true;
end;
$$;

create function public.sellerpilot_service_release_product_research_ai_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_safe_reason text,
  p_terminal boolean default false,
  p_retry_after_seconds integer default 60
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_receipt record;
  v_safe_reason text := lower(trim(coalesce(p_safe_reason, '')));
  v_retry_after_seconds integer := greatest(30, least(coalesce(p_retry_after_seconds, 60), 900));
  v_terminal boolean;
  v_error_message text;
  v_fingerprint text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_claim_token is null then return 'ownership_lost'; end if;
  if v_safe_reason !~ '^[a-z][a-z0-9_]{1,79}$' then
    raise exception 'invalid safe reason';
  end if;
  v_error_message := left('Server product research failed: ' || v_safe_reason, 500);
  v_fingerprint := sellerpilot_private.ai_completion_fingerprint(
    'failed',
    null,
    v_error_message
      || ':requested_terminal=' || coalesce(p_terminal, false)::text
      || ':retry_after_seconds=' || v_retry_after_seconds::text
  );

  select job.kind, job.status, job.worker_token_id, job.claim_token,
         job.lease_expires_at, job.attempt_count
    into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
   for update;
  if not found then return 'ownership_lost'; end if;

  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.server_product_research_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token;
  if found then
    return case
      when v_receipt.status in ('queued', 'failed')
       and v_receipt.completion_fingerprint = v_fingerprint then v_receipt.status
      else 'ownership_lost'
    end;
  end if;

  if v_job.kind <> 'product_research'
     or v_job.status <> 'running'
     or v_job.worker_token_id is not null
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_expires_at <= clock_timestamp()
     or not exists (
       select 1
         from sellerpilot_private.server_product_research_claims claim
        where claim.job_id = p_job_id
          and claim.claim_token = p_claim_token
          and claim.lease_expires_at > clock_timestamp()
     ) then
    return 'ownership_lost';
  end if;

  v_terminal := coalesce(p_terminal, false) or v_job.attempt_count >= 3;
  update sellerpilot_private.ai_cli_jobs job
     set status = case when v_terminal then 'failed' else 'queued' end,
         result_payload = null,
         error_message = case when v_terminal then v_error_message else null end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = case
           when v_terminal then job.available_at
           else clock_timestamp() + (v_retry_after_seconds * interval '1 second')
         end,
         completed_at = case when v_terminal then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where job.id = p_job_id;

  insert into sellerpilot_private.server_product_research_completion_receipts (
    job_id, claim_token, status, completion_fingerprint
  ) values (
    p_job_id,
    p_claim_token,
    case when v_terminal then 'failed' else 'queued' end,
    v_fingerprint
  );
  delete from sellerpilot_private.server_product_research_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token;
  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  ) values (
    case when v_terminal then 'job_failed' else 'job_retried' end,
    p_job_id,
    jsonb_build_object(
      'source', 'vercel_product_research',
      'reason', v_safe_reason,
      'retry_after_seconds', case when v_terminal then 0 else v_retry_after_seconds end,
      'attempt_count', v_job.attempt_count,
      'terminal', v_terminal
    )
  );
  return case when v_terminal then 'failed' else 'queued' end;
end;
$$;

revoke all on function public.sellerpilot_service_claim_product_research_ai_job(text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_touch_product_research_ai_job(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_release_product_research_ai_job(uuid, uuid, text, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_claim_product_research_ai_job(text)
  to service_role;
grant execute on function public.sellerpilot_service_touch_product_research_ai_job(uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.sellerpilot_service_release_product_research_ai_job(uuid, uuid, text, boolean, integer)
  to service_role;

comment on function public.sellerpilot_service_claim_product_research_ai_job(text) is
  'Claims exactly one product_research job for the Vercel OIDC runtime.';

commit;
