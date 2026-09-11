-- A completed job must not kill the worker when a late retry carries a different
-- payload. The previous behaviour raised 40001 and the worker treated the 503 as
-- fatal, which left the channel blocked and the CS inbox empty.
--
-- The gate stays exactly as strict as before while the job is still running: a
-- conflicting payload for a live claim is still rejected. Only an already
-- committed job answers with its recorded outcome.
do $patch$
declare
  v_def text;
  v_marker text := $m$    if v_receipt.completion_fingerprint <> v_completion_fingerprint then
      raise exception 'gateway completion replay mismatch' using errcode = '40001';
    end if;$m$;
  v_replacement text := $m$    if v_receipt.completion_fingerprint <> v_completion_fingerprint then
      if exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
         where job.id = p_job_id
           and job.status <> 'running'
      ) then
        return jsonb_build_object(
          'status', 'completed',
          'replayed', true,
          'continuationJobId', v_receipt.continuation_job_id
        );
      end if;
      raise exception 'gateway completion replay mismatch' using errcode = '40001';
    end if;$m$;
  v_count integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sellerpilot_056700_complete_gateway_before_qoo10_s1_activation';
  if v_def is null then
    raise exception 'completion guard function missing';
  end if;
  v_count := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
  if v_count = 0 then
    raise notice 'already patched';
    return;
  end if;
  if v_count <> 1 then
    raise exception 'unexpected marker count %', v_count;
  end if;
  execute replace(v_def, v_marker, v_replacement);
end;
$patch$;
