-- Let the fixed-IP read claim pick CS inquiries, not only diagnostic.test.
--
-- Production HTTP still only accepts a small tuple list; among CS reads that
-- list includes coupang:inquiries.list. Claiming diagnostic.test first made the
-- HTTP layer return 409 and leave the job running, which then blocked the
-- channel via guard_channel_gateway_running_parallelism (SPC02). Prefer
-- inquiries.list so a Coupang CS read can complete the local-executor HTTP path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 910241000);

do $patch$
declare
  v_def text;
  v_count integer;
  v_op_marker text := 'and j.operation = ''diagnostic.test''';
  v_op_repl text := 'and j.operation in (''diagnostic.test'', ''inquiries.list'')';
  v_ord_marker text := 'order by j.created_at, j.id';
  v_ord_repl text := 'order by case when j.operation = ''inquiries.list'' then 0 else 1 end, j.created_at, j.id';
begin
  select pg_catalog.pg_get_functiondef(p.oid) into v_def
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sellerpilot_private'
     and p.proname = 'claim_local_channel_executor_read_job';
  if v_def is null then
    raise exception 'read claim function missing' using errcode = '55000';
  end if;
  if pg_catalog.strpos(v_def, v_op_repl) = 0 then
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_op_marker, '')))
      / pg_catalog.length(v_op_marker);
    if v_count <> 1 then
      raise exception 'read claim op marker count %', v_count using errcode = '55000';
    end if;
    v_def := pg_catalog.replace(v_def, v_op_marker, v_op_repl);
  end if;
  if pg_catalog.strpos(v_def, v_ord_repl) = 0 then
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_ord_marker, '')))
      / pg_catalog.length(v_ord_marker);
    if v_count <> 1 then
      raise exception 'read claim order marker count %', v_count using errcode = '55000';
    end if;
    v_def := pg_catalog.replace(v_def, v_ord_marker, v_ord_repl);
  end if;
  execute v_def;
end;
$patch$;

commit;
