-- Keep every currently active worker credential alive until every job it owns
-- has left the running state. Revoking any scoped or combined token while a
-- marketplace write is still in flight can strand the acknowledgement and make
-- a retry unsafe.

begin;

create or replace function public.sellerpilot_service_activate_worker_token_set(
  p_rotation_set_id uuid,
  p_token_hashes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_hash text;
  v_total integer;
  v_matching integer;
  v_pending integer;
  v_active integer;
  v_revoked integer;
  v_activation_expires_at timestamptz;
  v_ai_running integer;
  v_gateway_running integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  lock table sellerpilot_private.ai_cli_worker_tokens in share row exclusive mode;

  if p_rotation_set_id is null
     or jsonb_typeof(p_token_hashes) <> 'object'
     or p_token_hashes - array['ai', 'gateway', 'scheduler']::text[] <> '{}'::jsonb then
    return jsonb_build_object('status', 'invalid');
  end if;
  foreach v_scope in array array['ai', 'gateway', 'scheduler']::text[] loop
    v_hash := coalesce(p_token_hashes->>v_scope, '');
    if v_hash !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('status', 'invalid');
    end if;
  end loop;

  perform 1
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.rotation_set_id = p_rotation_set_id
   order by token.scope
   for update;
  select
    count(*),
    count(*) filter (where token.token_hash = p_token_hashes->>token.scope),
    count(*) filter (where token.status = 'pending'),
    count(*) filter (where token.status = 'active'),
    count(*) filter (where token.status = 'revoked'),
    min(token.activation_expires_at)
  into v_total, v_matching, v_pending, v_active, v_revoked,
       v_activation_expires_at
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.rotation_set_id = p_rotation_set_id;

  if v_total <> 3 or v_matching <> 3 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_revoked = 3 then
    return jsonb_build_object('status', 'aborted', 'tokenSetId', p_rotation_set_id);
  end if;
  if v_active <> 3 and v_pending <> 3 then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Count every running job owned by any active token that this activation
  -- would revoke, including a stale-looking lease. Cleanup/reconciliation must
  -- move the job out of the running state before credential retirement;
  -- guessing that an external marketplace side effect did not happen would not
  -- be fail-closed. The ownership join also blocks an inconsistent cross-scope
  -- lease instead of silently revoking the token that owns it.
  select count(*)::integer
    into v_ai_running
    from sellerpilot_private.ai_cli_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where token.status = 'active'
     and token.scope in ('ai', 'gateway', 'scheduler', 'legacy_combined')
     and token.rotation_set_id is distinct from p_rotation_set_id
     and job.status = 'running';

  select count(*)::integer
    into v_gateway_running
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where token.status = 'active'
     and token.scope in ('ai', 'gateway', 'scheduler', 'legacy_combined')
     and token.rotation_set_id is distinct from p_rotation_set_id
     and job.status = 'running';

  if v_ai_running > 0 or v_gateway_running > 0 then
    return jsonb_build_object(
      'status', 'leases_active',
      'aiRunning', v_ai_running,
      'gatewayRunning', v_gateway_running
    );
  end if;

  if v_active = 3 then
    return jsonb_build_object(
      'status', 'activated',
      'tokenSetId', p_rotation_set_id,
      'replayed', true
    );
  end if;

  if v_activation_expires_at is null
     or v_activation_expires_at <= clock_timestamp() then
    with expired as (
      update sellerpilot_private.ai_cli_worker_tokens token
         set status = 'revoked', revoked_at = clock_timestamp()
       where token.rotation_set_id = p_rotation_set_id
         and token.status = 'pending'
       returning token.id, token.scope
    )
    insert into sellerpilot_private.ai_cli_audit (
      action, worker_token_id, safe_detail
    )
    select
      'token_revoked', expired.id,
      jsonb_build_object(
        'reason', 'pending_set_expired',
        'rotation_set_id', p_rotation_set_id,
        'scope', expired.scope
      )
    from expired;
    return jsonb_build_object('status', 'expired', 'tokenSetId', p_rotation_set_id);
  end if;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked', revoked_at = clock_timestamp()
     where token.status = 'active'
       and token.scope in ('ai', 'gateway', 'scheduler', 'legacy_combined')
       and token.rotation_set_id is distinct from p_rotation_set_id
     returning token.id, token.scope
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, safe_detail
  )
  select
    'token_revoked', revoked.id,
    jsonb_build_object(
      'reason', 'token_set_activated',
      'replacement_set_id', p_rotation_set_id,
      'scope', revoked.scope
    )
  from revoked;

  with activated as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'active',
           activated_at = clock_timestamp(),
           revoked_at = null
     where token.rotation_set_id = p_rotation_set_id
       and token.status = 'pending'
     returning token.id, token.scope, token.fingerprint
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, safe_detail
  )
  select
    'token_issued', activated.id,
    jsonb_build_object(
      'phase', 'activated',
      'rotation_set_id', p_rotation_set_id,
      'scope', activated.scope,
      'fingerprint', activated.fingerprint
    )
  from activated;

  if (
    select count(*)
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.rotation_set_id = p_rotation_set_id
       and token.status = 'active'
  ) <> 3 then
    raise exception 'worker token set activation was incomplete';
  end if;
  return jsonb_build_object(
    'status', 'activated',
    'tokenSetId', p_rotation_set_id,
    'replayed', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_activate_worker_token_set(
  uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_activate_worker_token_set(
  uuid, jsonb
) to service_role;

commit;
