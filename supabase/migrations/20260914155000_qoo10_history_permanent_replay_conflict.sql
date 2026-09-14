-- A different completed job for the same history window is a permanent
-- evidence conflict, not a serialization failure. Preserve the original
-- job/claim/fingerprint and do not invite transaction or worker retries.
begin;
do $migration$
declare
  signature text := 'public.sellerpilot_service_record_qoo10_history_window_v1(text,uuid,uuid,jsonb)';
  source text;
  old_raise text := $old$raise exception 'QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH' using errcode='40001';$old$;
  new_raise text := $new$raise exception 'QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH' using errcode='PT409';$new$;
begin
  if (select md5(prosrc) from pg_proc where oid=signature::regprocedure)
      is distinct from '8714df63daa5e565bb9f441d0e17b467' then
    raise exception 'QOO10_HISTORY_CONFLICT_PREIMAGE_CHANGED';
  end if;
  source := pg_get_functiondef(signature::regprocedure);
  if (length(source)-length(replace(source,old_raise,'')))/length(old_raise) <> 2 then
    raise exception 'QOO10_HISTORY_CONFLICT_PATCH_DRIFT';
  end if;
  execute replace(source,old_raise,new_raise);
end;
$migration$;
commit;
