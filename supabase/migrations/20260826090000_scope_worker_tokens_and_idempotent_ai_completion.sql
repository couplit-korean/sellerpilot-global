-- Split worker credentials by capability and make AI terminal completion an
-- exact, claim-bound replay. Existing active tokens remain usable only as a
-- short rollout bridge; newly issued tokens are always single-scope.

begin;

alter table sellerpilot_private.ai_cli_worker_tokens
  add column if not exists scope text not null default 'legacy_combined';

alter table sellerpilot_private.ai_cli_worker_tokens
  drop constraint if exists ai_cli_worker_tokens_scope_check;
alter table sellerpilot_private.ai_cli_worker_tokens
  add constraint ai_cli_worker_tokens_scope_check
  check (scope in ('ai', 'gateway', 'scheduler', 'legacy_combined'));

-- Bound the compatibility window instead of leaving an unscoped bearer token
-- capable of decrypting marketplace credentials indefinitely.
update sellerpilot_private.ai_cli_worker_tokens
   set scope = 'legacy_combined',
       expires_at = least(expires_at, clock_timestamp() + interval '7 days')
 where scope = 'legacy_combined';

alter table sellerpilot_private.ai_cli_worker_tokens
  alter column scope set default 'ai';

drop index if exists sellerpilot_private.ai_cli_worker_one_active_idx;
create unique index if not exists ai_cli_worker_one_active_per_scope_idx
  on sellerpilot_private.ai_cli_worker_tokens (scope)
  where status = 'active';

create or replace function sellerpilot_private.worker_token_has_scope(
  p_token_hash text,
  p_scope text,
  p_require_active boolean default true
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.scope in (p_scope, 'legacy_combined')
       and (
         not p_require_active
         or (
           token.status = 'active'
           and token.expires_at > clock_timestamp()
         )
       )
  );
$$;

revoke all on function sellerpilot_private.worker_token_has_scope(text, text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_issue_ai_worker_token(
  p_label text,
  p_token_hash text,
  p_fingerprint text,
  p_expires_at timestamptz,
  p_scope text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_scope text := lower(trim(coalesce(p_scope, '')));
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if char_length(trim(p_label)) not between 1 and 80
     or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_fingerprint !~ '^[A-F0-9]{12}$'
     or p_expires_at <= clock_timestamp()
     or v_scope not in ('ai', 'gateway', 'scheduler') then
    raise exception 'invalid worker token metadata';
  end if;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked', revoked_at = clock_timestamp()
     where token.status = 'active'
       and token.scope = v_scope
     returning token.id
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  )
  select
    'token_revoked', auth.uid(), revoked.id,
    jsonb_build_object('reason', 'scope_rotation', 'scope', v_scope)
  from revoked;

  insert into sellerpilot_private.ai_cli_worker_tokens (
    id, label, token_hash, fingerprint, scope, expires_at, created_by
  ) values (
    v_id, trim(p_label), p_token_hash, p_fingerprint, v_scope,
    p_expires_at, auth.uid()
  );

  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  ) values (
    'token_issued', auth.uid(), v_id,
    jsonb_build_object(
      'label', trim(p_label),
      'fingerprint', p_fingerprint,
      'expires_at', p_expires_at,
      'scope', v_scope
    )
  );
  return v_id;
end;
$$;

-- A rolling old application still issues the four-argument RPC. It now gets
-- an AI-only token, never a combined marketplace credential capability.
create or replace function public.sellerpilot_issue_ai_worker_token(
  p_label text,
  p_token_hash text,
  p_fingerprint text,
  p_expires_at timestamptz
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.sellerpilot_issue_ai_worker_token(
    p_label,
    p_token_hash,
    p_fingerprint,
    p_expires_at,
    'ai'
  );
$$;

create or replace function public.sellerpilot_ai_runtime_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
        'label', token.label,
        'fingerprint', token.fingerprint,
        'scope', token.scope,
        'expires_at', token.expires_at,
        'last_seen_at', token.last_seen_at,
        'last_version', token.last_version
      )
      from sellerpilot_private.ai_cli_worker_tokens token
      where token.status = 'active'
        and token.expires_at > clock_timestamp()
        and token.scope in ('ai', 'legacy_combined')
      order by case when token.scope = 'ai' then 0 else 1 end,
               token.created_at desc
      limit 1
    ),
    'workers', coalesce((
      select jsonb_object_agg(worker.scope, worker.snapshot)
      from (
        select distinct on (token.scope)
          token.scope,
          jsonb_build_object(
            'label', token.label,
            'fingerprint', token.fingerprint,
            'expires_at', token.expires_at,
            'last_seen_at', token.last_seen_at,
            'last_version', token.last_version
          ) as snapshot
        from sellerpilot_private.ai_cli_worker_tokens token
        where token.status = 'active'
          and token.expires_at > clock_timestamp()
        order by token.scope, token.created_at desc
      ) worker
    ), '{}'::jsonb),
    'queued', (
      select count(*) from sellerpilot_private.ai_cli_jobs where status = 'queued'
    ),
    'running', (
      select count(*) from sellerpilot_private.ai_cli_jobs where status = 'running'
    ),
    'succeeded_today', (
      select count(*)
        from sellerpilot_private.ai_cli_jobs
       where status = 'succeeded'
         and completed_at >= date_trunc('day', clock_timestamp())
    ),
    'failed_today', (
      select count(*)
        from sellerpilot_private.ai_cli_jobs
       where status = 'failed'
         and completed_at >= date_trunc('day', clock_timestamp())
    )
  ) into v_result;
  return v_result;
end;
$$;

-- Preserve only a digest of a terminal response. The result itself remains on
-- the job row, while the receipt proves that a response retry is byte-for-byte
-- equivalent after PostgreSQL's canonical jsonb normalization.
create table if not exists sellerpilot_private.ai_job_completion_receipts (
  job_id uuid primary key
    references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  claim_token uuid not null,
  status text not null check (status in ('succeeded', 'failed')),
  completion_fingerprint text not null
    check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (job_id, claim_token)
);

alter table sellerpilot_private.ai_job_completion_receipts enable row level security;
revoke all on sellerpilot_private.ai_job_completion_receipts
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.ai_completion_fingerprint(
  p_status text,
  p_result_payload jsonb,
  p_error_message text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      jsonb_build_object(
        'status', p_status,
        'result', case when p_status = 'succeeded' then p_result_payload else null end,
        'error', case
          when p_status = 'failed'
            then left(coalesce(p_error_message, 'CLI worker failed.'), 500)
          else null
        end
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function sellerpilot_private.ai_completion_fingerprint(text, jsonb, text)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_claim_ai_job(text, text)
  rename to sellerpilot_260826_claim_ai_job_unscoped;

create function public.sellerpilot_claim_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_has_scope(p_token_hash, 'ai', true) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  return public.sellerpilot_260826_claim_ai_job_unscoped(
    p_token_hash,
    p_worker_version
  );
end;
$$;

alter function public.sellerpilot_service_begin_ai_job_completion(text, uuid, uuid)
  rename to sellerpilot_260826_begin_ai_completion_once;

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
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null then
    return false;
  end if;

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope in ('ai', 'legacy_combined')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then return false; end if;

  if exists (
    select 1
      from sellerpilot_private.ai_job_completion_receipts receipt
     where receipt.job_id = p_job_id
       and receipt.worker_token_id = v_token_id
       and receipt.claim_token = p_claim_token
  ) then
    return true;
  end if;

  return public.sellerpilot_260826_begin_ai_completion_once(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

alter function public.sellerpilot_complete_ai_job(text, uuid, uuid, text, jsonb, text)
  rename to sellerpilot_260826_complete_ai_job_once;

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
  v_fingerprint text;
  v_receipt record;
  v_completed boolean;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid completion status';
  end if;
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null then
    return false;
  end if;

  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope in ('ai', 'legacy_combined')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  v_fingerprint := sellerpilot_private.ai_completion_fingerprint(
    p_status,
    p_result_payload,
    p_error_message
  );

  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.ai_job_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.worker_token_id = v_token_id
     and receipt.claim_token = p_claim_token;
  if found then
    return v_receipt.status = p_status
       and v_receipt.completion_fingerprint = v_fingerprint;
  end if;

  v_completed := public.sellerpilot_260826_complete_ai_job_once(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_status,
    p_result_payload,
    p_error_message
  );
  if v_completed then
    insert into sellerpilot_private.ai_job_completion_receipts (
      job_id, worker_token_id, claim_token, status, completion_fingerprint
    ) values (
      p_job_id, v_token_id, p_claim_token, p_status, v_fingerprint
    );
    return true;
  end if;

  -- A concurrent exact completion can commit while this call waits for the job
  -- row. Re-read its receipt with a fresh statement snapshot before rejecting.
  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.ai_job_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.worker_token_id = v_token_id
     and receipt.claim_token = p_claim_token;
  return found
     and v_receipt.status = p_status
     and v_receipt.completion_fingerprint = v_fingerprint;
end;
$$;

-- Only gateway-scoped tokens can reach the function that decrypts marketplace
-- credentials. The delegated implementation retains all existing claim/lease
-- and reconciliation behavior.
alter function public.sellerpilot_claim_channel_gateway_job(text, text)
  rename to sellerpilot_260826_claim_gateway_unscoped;

create function public.sellerpilot_claim_channel_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_has_scope(p_token_hash, 'gateway', true) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  return public.sellerpilot_260826_claim_gateway_unscoped(
    p_token_hash,
    p_worker_version
  );
end;
$$;

create or replace function public.sellerpilot_service_validate_worker_token(
  p_token_hash text,
  p_worker_version text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where token.token_hash = p_token_hash
     and token.scope in ('scheduler', 'legacy_combined')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_issue_ai_worker_token(text, text, text, timestamptz)
  from public, anon;
revoke all on function public.sellerpilot_issue_ai_worker_token(text, text, text, timestamptz, text)
  from public, anon;
grant execute on function public.sellerpilot_issue_ai_worker_token(text, text, text, timestamptz)
  to authenticated;
grant execute on function public.sellerpilot_issue_ai_worker_token(text, text, text, timestamptz, text)
  to authenticated;

revoke all on function public.sellerpilot_260826_claim_ai_job_unscoped(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_260826_begin_ai_completion_once(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_260826_complete_ai_job_once(text, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_260826_claim_gateway_unscoped(text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_claim_ai_job(text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_ai_job_completion(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_ai_job(text, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_claim_channel_gateway_job(text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_validate_worker_token(text, text)
  from public, anon, authenticated;

grant execute on function public.sellerpilot_claim_ai_job(text, text)
  to service_role;
grant execute on function public.sellerpilot_service_begin_ai_job_completion(text, uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_complete_ai_job(text, uuid, uuid, text, jsonb, text)
  to service_role;
grant execute on function public.sellerpilot_claim_channel_gateway_job(text, text)
  to service_role;
grant execute on function public.sellerpilot_service_validate_worker_token(text, text)
  to service_role;

commit;
