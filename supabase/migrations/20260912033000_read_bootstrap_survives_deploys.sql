do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sellerpilot_private'
     and p.proname = 'local_channel_executor_read_bootstrap_allowed';
  if v_def is null then
    raise exception 'read bootstrap gate missing';
  end if;
  v_def := regexp_replace(
    v_def,
    'active_serverless_runtime_release_sha\(\)\s*=\s*p_release_sha',
    '(sellerpilot_private.active_serverless_runtime_release_sha() = p_release_sha or sellerpilot_private.local_channel_executor_access(job.channel, job.operation) = ''read'')',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    'route\.release_sha\s*=\s*p_release_sha',
    '(route.release_sha = p_release_sha or sellerpilot_private.local_channel_executor_access(job.channel, job.operation) = ''read'')',
    'g'
  );
  if strpos(v_def, 'local_channel_executor_access(job.channel, job.operation)') = 0 then
    raise exception 'bootstrap relaxation did not apply';
  end if;
  execute v_def;
end;
$patch$;
