-- Restore asynchronous diagnostic recording in the existing atomic completion.
-- Preserve authentication, claim ownership, receipts, refresh and other side effects.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $migration$
declare
  definition text := pg_get_functiondef('public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
begin
  if md5(definition) is distinct from 'b0076ceb8ad23e77e35e485b1e5fe35e' then
    raise exception 'ASYNC_DIAGNOSTIC_PREIMAGE_CHANGED';
  end if;
  definition := replace(definition,$old$    if v_job.operation = 'diagnostic.test'
       and p_credential_refresh is not null then$old$,$new$    if v_job.operation = 'diagnostic.test' then
      if p_diagnostic is distinct from p_response_payload->'diagnostic' then
        raise exception 'diagnostic result does not match response';
      end if;$new$);
  definition := replace(definition,$old$      perform public.sellerpilot_record_credential_test(
        v_effective_credential_id,
        p_diagnostic->>'status',
        left(coalesce(p_diagnostic->>'message', ''), 500)
      );$old$,$new$      -- Completion owns recording even after the HTTP caller stops waiting.
      -- A late older job cannot replace a newer requested diagnostic.
      if not exists (
        select 1 from sellerpilot_private.channel_gateway_jobs newer
        join sellerpilot_private.channel_gateway_jobs current_job on current_job.id=p_job_id
        where newer.credential_id=v_effective_credential_id
          and newer.operation='diagnostic.test' and newer.status<>'cancelled'
          and (newer.created_at,newer.id)>(current_job.created_at,current_job.id)
      ) then
        perform public.sellerpilot_record_credential_test(
          v_effective_credential_id,
          p_diagnostic->>'status',
          left(coalesce(p_diagnostic->>'message', ''), 500)
        );
      end if;$new$);
  execute definition;
end $migration$;
commit;
