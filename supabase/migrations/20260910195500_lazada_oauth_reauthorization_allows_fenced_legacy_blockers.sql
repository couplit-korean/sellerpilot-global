-- A fresh Lazada seller authorization could never be exchanged.
--
-- Why: sellerpilot_enqueue_channel_gateway_job refuses a new oauth.exchange
-- while any other Lazada oauth.exchange job is queued, running, or in
-- reconciliation. Two fenced legacy failures (faee01e1 from the 2026-09-02
-- provider failure and d917f08b from the same incident) sit in
-- reconciliation_required with credential_refresh_in_flight = true. The guard
-- excludes only the single job id returned by
-- safe_lazada_oauth_exchange_reauthorization_blocker, so the remaining fenced
-- row always tripped "unresolved OAuth exchange already exists". The same two
-- rows also fence every Lazada gateway claim, so diagnostics and CS reads stay
-- queued forever.
--
-- What this changes: the guard ignores the two preimage-fixed legacy rows when
-- it looks for a *conflicting* OAuth exchange. It does not touch those rows,
-- does not mark them succeeded, and keeps blocking on any other unresolved
-- exchange. The designed supersession trigger still has to observe a certified
-- new credential and a claim-bound MY readback before those rows change state.
--
-- Nothing else in the function is rewritten: the migration patches the live
-- definition text in place and fails closed if the expected guard is missing,
-- duplicated, or already patched.
do $lazada_oauth_guard$
declare
  v_def text;
  v_marker text := 'and other_oauth.id <> v_blocker_job_id';
  v_replacement text :=
    'and other_oauth.id <> v_blocker_job_id' || chr(10) ||
    '       and other_oauth.id not in (' || chr(10) ||
    '         ''faee01e1-2d68-4f99-951c-15684822fc43''::uuid,' || chr(10) ||
    '         ''d917f08b-1283-456e-930a-6042ec0b24a7''::uuid' || chr(10) ||
    '       )';
  v_already_patched text := 'faee01e1-2d68-4f99-951c-15684822fc43''::uuid,';
  v_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into v_def
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'sellerpilot_enqueue_channel_gateway_job';

  if v_def is null then
    raise exception 'Lazada OAuth enqueue guard not found' using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_def, v_already_patched) > 0 then
    return;
  end if;

  v_count := (
    pg_catalog.length(v_def)
    - pg_catalog.length(pg_catalog.replace(v_def, v_marker, ''))
  ) / pg_catalog.length(v_marker);
  if v_count <> 1 then
    raise exception 'Lazada OAuth enqueue guard preimage mismatch (%)', v_count
      using errcode = '55000';
  end if;

  v_def := pg_catalog.replace(v_def, v_marker, v_replacement);
  if pg_catalog.strpos(v_def, v_already_patched) = 0 then
    raise exception 'Lazada OAuth enqueue guard patch did not apply' using errcode = '55000';
  end if;

  execute v_def;
end;
$lazada_oauth_guard$;

-- The dedicated-reply enqueue path holds the same conflict guard and runs
-- before the public wrapper can use its own. Patch it identically so a fresh
-- authorization is not rejected by the two fenced legacy failures.
do $lazada_oauth_guard_dedicated$
declare
  v_def text;
  v_marker text :=
    'and j.status in (''queued'', ''running'', ''reconciliation_required'')' || chr(10) ||
    '     order by case when j.status = ''reconciliation_required'' then 0 else 1 end,';
  v_replacement text :=
    'and j.status in (''queued'', ''running'', ''reconciliation_required'')' || chr(10) ||
    '       and j.id not in (' || chr(10) ||
    '         ''faee01e1-2d68-4f99-951c-15684822fc43''::uuid,' || chr(10) ||
    '         ''d917f08b-1283-456e-930a-6042ec0b24a7''::uuid' || chr(10) ||
    '       )' || chr(10) ||
    '     order by case when j.status = ''reconciliation_required'' then 0 else 1 end,';
  v_already_patched text := 'and j.id not in (';
  v_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into v_def
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'sellerpilot_enqueue_channel_gateway_job_pre_dedicated_reply';

  if v_def is null then
    raise exception 'Lazada OAuth dedicated-reply guard not found' using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_def, v_already_patched) > 0 then
    return;
  end if;

  v_count := (
    pg_catalog.length(v_def)
    - pg_catalog.length(pg_catalog.replace(v_def, v_marker, ''))
  ) / pg_catalog.length(v_marker);
  if v_count <> 1 then
    raise exception 'Lazada OAuth dedicated-reply guard preimage mismatch (%)', v_count
      using errcode = '55000';
  end if;

  v_def := pg_catalog.replace(v_def, v_marker, v_replacement);
  execute v_def;
end;
$lazada_oauth_guard_dedicated$;
