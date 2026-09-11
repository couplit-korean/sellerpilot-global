-- CS and order reads must not stop just because Production shipped a new commit.
--
-- The fixed-IP read route check pinned both the route row and the active runtime
-- release to the exact worker SHA, so every deploy silently disabled the Mac read
-- lane until someone repinned it by hand (the recurring CS stall).
--
-- Read operations are idempotent and the route row still requires an approved
-- route, the same credential with a passed check, the same egress hash, and the
-- same recently-seen worker token. Relax only the release equality for reads.
-- Write operations keep the exact release pin.
do $patch$
declare
  v_def text;
  v_read text := 'sellerpilot_private.local_channel_executor_access(p_channel, p_operation) = ''read''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sellerpilot_private'
     and p.proname = 'local_channel_executor_route_is_current';
  if v_def is null then
    raise exception 'route currency function missing';
  end if;
  if position('local_channel_executor_access(p_channel, p_operation) = ''read''))' in v_def) > 0
     and position('route.release_sha = p_release_sha or' in v_def) > 0 then
    raise notice 'already relaxed for reads';
    return;
  end if;
  v_def := regexp_replace(
    v_def,
    'sellerpilot_private\.active_serverless_runtime_release_sha\(\)[[:space:]]*=[[:space:]]*p_release_sha',
    '(sellerpilot_private.active_serverless_runtime_release_sha() = p_release_sha or ' || v_read || ')',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    'route\.release_sha[[:space:]]*=[[:space:]]*p_release_sha',
    '(route.release_sha = p_release_sha or ' || v_read || ')',
    'g'
  );
  execute v_def;
end;
$patch$;
