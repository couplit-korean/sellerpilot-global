-- Retire the temporary combined worker credential only after a replacement
-- three-scope token set is active. Fresh databases with no usable legacy token
-- may install the strict boundary without manufacturing worker credentials.

begin;

-- Serialize with pending-set activation and prevent a direct token row update
-- from changing the precondition between validation and revocation.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
lock table sellerpilot_private.ai_cli_worker_tokens in share row exclusive mode;

do $migration$
declare
  v_now timestamptz := clock_timestamp();
  v_usable_legacy integer;
  v_running_legacy_ai_jobs integer;
  v_running_legacy_gateway_jobs integer;
  v_replacement_set_id uuid;
begin
  select count(*)::integer
    into v_usable_legacy
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.scope = 'legacy_combined'
     and token.status = 'active'
     and token.expires_at > v_now;

  if v_usable_legacy > 0 then
    select token.rotation_set_id
      into v_replacement_set_id
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.scope in ('ai', 'gateway', 'scheduler')
       and token.status = 'active'
       and token.expires_at > v_now
       and token.rotation_set_id is not null
       and token.activated_at is not null
     group by token.rotation_set_id
    having count(*) = 3
       and count(distinct token.scope) = 3
     limit 1;

    if v_replacement_set_id is null then
      raise exception
        'active scoped worker token set required before retiring legacy_combined'
        using errcode = '55000';
    end if;
  end if;

  -- Revoking a token while it owns a live lease can strand an AI completion or,
  -- more seriously, lose the acknowledgement for an already-sent marketplace
  -- write. The token-table lock above serializes this check with new claims.
  -- Operators must drain the legacy worker before retrying this migration.
  select count(*)::integer
    into v_running_legacy_ai_jobs
    from sellerpilot_private.ai_cli_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where token.scope = 'legacy_combined'
     and token.status <> 'revoked'
     and job.status = 'running';

  select count(*)::integer
    into v_running_legacy_gateway_jobs
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where token.scope = 'legacy_combined'
     and token.status <> 'revoked'
     and job.status = 'running';

  if v_running_legacy_ai_jobs > 0 or v_running_legacy_gateway_jobs > 0 then
    raise exception
      'legacy_combined worker leases must drain before token retirement (ai %, gateway %)',
      v_running_legacy_ai_jobs,
      v_running_legacy_gateway_jobs
      using errcode = '55000';
  end if;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked',
           revoked_at = coalesce(token.revoked_at, v_now)
     where token.scope = 'legacy_combined'
       and token.status <> 'revoked'
     returning token.id, token.scope
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, safe_detail
  )
  select
    'token_revoked',
    revoked.id,
    jsonb_build_object(
      'reason', 'legacy_combined_retired',
      'scope', revoked.scope,
      'replacement_set_id', v_replacement_set_id
    )
  from revoked;
end;
$migration$;

-- A retired combined token cannot be reactivated later through a direct row
-- update and reach one of the historical completion helpers that still binds
-- ownership to the original token id.
alter table sellerpilot_private.ai_cli_worker_tokens
  add constraint ai_cli_worker_tokens_no_active_legacy_combined_check
  check (scope <> 'legacy_combined' or status <> 'active');

-- Capability checks are now exact. The p_require_active=false mode still
-- supports historical checks for a single scope, never the combined bridge.
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
  select coalesce(p_scope in ('ai', 'gateway', 'scheduler'), false)
     and exists (
       select 1
         from sellerpilot_private.ai_cli_worker_tokens token
        where token.token_hash = p_token_hash
          and token.scope = p_scope
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

-- Preserve the product claimant implementation byte-for-byte behind a new
-- strict scope wrapper. The delegated function retains its existing queue,
-- lease, audit, request, and response behavior.
alter function public.sellerpilot_claim_product_ai_job(text, text)
  rename to sellerpilot_20260828_claim_product_ai_job_scoped_once;

create function public.sellerpilot_claim_product_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_has_scope(
    p_token_hash,
    'ai',
    true
  ) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  return public.sellerpilot_20260828_claim_product_ai_job_scoped_once(
    p_token_hash,
    p_worker_version
  );
end;
$$;

revoke all on function public.sellerpilot_20260828_claim_product_ai_job_scoped_once(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_claim_product_ai_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_product_ai_job(text, text)
  to service_role;

-- Scheduler heartbeat/authentication must also use its exact token. AI and
-- gateway claim wrappers already call the strict helper above.
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
     and token.scope = 'scheduler'
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_service_validate_worker_token(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_validate_worker_token(text, text)
  to service_role;

comment on function sellerpilot_private.worker_token_has_scope(text, text, boolean) is
  'Checks one exact worker capability; legacy_combined never satisfies a scope.';
comment on function public.sellerpilot_claim_product_ai_job(text, text) is
  'Claims product AI jobs only after an exact active AI-scope token check.';

commit;
