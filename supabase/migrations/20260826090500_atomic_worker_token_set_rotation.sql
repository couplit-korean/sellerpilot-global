-- Rotate the three local worker capabilities as one proof-bound set. New
-- tokens stay unusable while the installer validates and boots the staged
-- runtime; only an exact three-token proof can atomically activate the set and
-- revoke the previous workers. A failed installer can therefore discard its
-- pending set without interrupting the currently active runtime.

begin;

alter table sellerpilot_private.ai_cli_worker_tokens
  drop constraint if exists ai_cli_worker_tokens_status_check;
alter table sellerpilot_private.ai_cli_worker_tokens
  add constraint ai_cli_worker_tokens_status_check
  check (status in ('pending', 'active', 'revoked'));

alter table sellerpilot_private.ai_cli_worker_tokens
  add column if not exists rotation_set_id uuid,
  add column if not exists activation_expires_at timestamptz,
  add column if not exists activated_at timestamptz;

alter table sellerpilot_private.ai_cli_worker_tokens
  drop constraint if exists ai_cli_worker_tokens_pending_metadata_check;
alter table sellerpilot_private.ai_cli_worker_tokens
  add constraint ai_cli_worker_tokens_pending_metadata_check
  check (
    status <> 'pending'
    or (
      rotation_set_id is not null
      and activation_expires_at is not null
      and activated_at is null
    )
  );

create unique index if not exists ai_cli_worker_token_set_scope_idx
  on sellerpilot_private.ai_cli_worker_tokens (rotation_set_id, scope)
  where rotation_set_id is not null;
create index if not exists ai_cli_worker_pending_expiry_idx
  on sellerpilot_private.ai_cli_worker_tokens (activation_expires_at)
  where status = 'pending';

create or replace function public.sellerpilot_issue_pending_worker_token_set(
  p_label text,
  p_token_metadata jsonb,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set_id uuid := gen_random_uuid();
  v_activation_expires_at timestamptz := clock_timestamp() + interval '30 minutes';
  v_scope text;
  v_hash text;
  v_fingerprint text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_label, ''))) not between 1 and 80
     or p_expires_at <= v_activation_expires_at
     or jsonb_typeof(p_token_metadata) <> 'object'
     or p_token_metadata - array['ai', 'gateway', 'scheduler']::text[] <> '{}'::jsonb then
    raise exception 'invalid pending worker token set metadata';
  end if;

  foreach v_scope in array array['ai', 'gateway', 'scheduler']::text[] loop
    if jsonb_typeof(p_token_metadata->v_scope) <> 'object' then
      raise exception 'invalid pending worker token set metadata';
    end if;
    v_hash := coalesce(p_token_metadata->v_scope->>'tokenHash', '');
    v_fingerprint := coalesce(p_token_metadata->v_scope->>'fingerprint', '');
    if v_hash !~ '^[a-f0-9]{64}$'
       or v_fingerprint !~ '^[A-F0-9]{12}$'
       or (p_token_metadata->v_scope) - array['tokenHash', 'fingerprint']::text[] <> '{}'::jsonb then
      raise exception 'invalid pending worker token set metadata';
    end if;
  end loop;

  with replaced as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked',
           revoked_at = clock_timestamp()
     where token.status = 'pending'
     returning token.id, token.rotation_set_id, token.scope
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  )
  select
    'token_revoked', auth.uid(), replaced.id,
    jsonb_build_object(
      'reason', 'pending_set_replaced',
      'rotation_set_id', replaced.rotation_set_id,
      'scope', replaced.scope
    )
  from replaced;

  insert into sellerpilot_private.ai_cli_worker_tokens (
    label,
    token_hash,
    fingerprint,
    status,
    scope,
    expires_at,
    created_by,
    rotation_set_id,
    activation_expires_at
  )
  select
    left(trim(p_label) || ' · ' || case scope_name
      when 'ai' then 'AI'
      when 'gateway' then 'Gateway'
      else 'Scheduler'
    end, 80),
    p_token_metadata->scope_name->>'tokenHash',
    p_token_metadata->scope_name->>'fingerprint',
    'pending',
    scope_name,
    p_expires_at,
    auth.uid(),
    v_set_id,
    v_activation_expires_at
  from unnest(array['ai', 'gateway', 'scheduler']::text[]) as scope_name;

  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  )
  select
    'token_issued', auth.uid(), token.id,
    jsonb_build_object(
      'phase', 'pending',
      'rotation_set_id', v_set_id,
      'scope', token.scope,
      'fingerprint', token.fingerprint,
      'activation_expires_at', v_activation_expires_at,
      'expires_at', p_expires_at
    )
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.rotation_set_id = v_set_id;

  return jsonb_build_object(
    'status', 'pending',
    'tokenSetId', v_set_id,
    'activationExpiresAt', v_activation_expires_at
  );
end;
$$;

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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
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
  if v_active = 3 then
    return jsonb_build_object(
      'status', 'activated',
      'tokenSetId', p_rotation_set_id,
      'replayed', true
    );
  end if;
  if v_revoked = 3 then
    return jsonb_build_object('status', 'aborted', 'tokenSetId', p_rotation_set_id);
  end if;
  if v_pending <> 3 then
    return jsonb_build_object('status', 'invalid');
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

create or replace function public.sellerpilot_service_abort_worker_token_set(
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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  if p_rotation_set_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_token_hashes is null
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
    count(*) filter (
      where token.token_hash = p_token_hashes->>token.scope
    ),
    count(*) filter (where token.status = 'pending'),
    count(*) filter (where token.status = 'active'),
    count(*) filter (where token.status = 'revoked')
  into v_total, v_matching, v_pending, v_active, v_revoked
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.rotation_set_id = p_rotation_set_id;

  if v_total <> 3 or v_matching <> 3 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_active = 3 then
    return jsonb_build_object('status', 'active', 'tokenSetId', p_rotation_set_id);
  end if;
  if v_revoked = 3 then
    return jsonb_build_object(
      'status', 'aborted',
      'tokenSetId', p_rotation_set_id,
      'replayed', true
    );
  end if;
  if v_pending <> 3 then
    return jsonb_build_object('status', 'invalid');
  end if;

  with aborted as (
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
    'token_revoked', aborted.id,
    jsonb_build_object(
      'reason', 'pending_set_aborted',
      'rotation_set_id', p_rotation_set_id,
      'scope', aborted.scope
    )
  from aborted;
  return jsonb_build_object(
    'status', 'aborted',
    'tokenSetId', p_rotation_set_id,
    'replayed', false
  );
end;
$$;

create or replace function public.sellerpilot_service_expire_pending_worker_token_sets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  with expired as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked', revoked_at = clock_timestamp()
     where token.status = 'pending'
       and token.activation_expires_at <= clock_timestamp()
     returning token.id, token.rotation_set_id, token.scope
  ), audited as (
    insert into sellerpilot_private.ai_cli_audit (
      action, worker_token_id, safe_detail
    )
    select
      'token_revoked', expired.id,
      jsonb_build_object(
        'reason', 'pending_set_expired',
        'rotation_set_id', expired.rotation_set_id,
        'scope', expired.scope
      )
    from expired
    returning id
  )
  select count(*) into v_count from expired;
  return coalesce(v_count, 0);
end;
$$;

-- The old single-scope issuer revokes a live worker before installation can be
-- verified. Keep its signature for migration compatibility but remove direct
-- application access; all new UI issuance uses the pending set RPC above.
revoke all on function public.sellerpilot_issue_ai_worker_token(
  text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.sellerpilot_issue_ai_worker_token(
  text, text, text, timestamptz, text
) from public, anon, authenticated;

revoke all on function public.sellerpilot_issue_pending_worker_token_set(
  text, jsonb, timestamptz
) from public, anon;
grant execute on function public.sellerpilot_issue_pending_worker_token_set(
  text, jsonb, timestamptz
) to authenticated;

revoke all on function public.sellerpilot_service_activate_worker_token_set(
  uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_abort_worker_token_set(
  uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_expire_pending_worker_token_sets()
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_activate_worker_token_set(
  uuid, jsonb
) to service_role;
grant execute on function public.sellerpilot_service_abort_worker_token_set(
  uuid, jsonb
) to service_role;
grant execute on function public.sellerpilot_service_expire_pending_worker_token_sets()
  to service_role;

commit;
