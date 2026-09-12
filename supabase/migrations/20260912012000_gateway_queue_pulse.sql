-- Measured cost: sellerpilot_claim_channel_gateway_job averaged ~470 ms of database
-- CPU per call (31% of instance CPU) because every poll, even with an empty queue,
-- walked the advisory-locked claim chain. This pulse returns the same "is there
-- anything to claim" answer with two indexed counts so the worker can skip the
-- expensive claim while nothing is queued.

create index if not exists channel_gateway_jobs_running_lease_idx
  on sellerpilot_private.channel_gateway_jobs (lease_expires_at)
  where status = 'running';

create or replace function public.sellerpilot_gateway_queue_pulse(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_queued integer;
  v_stale_running integer;
begin
  if not sellerpilot_private.worker_token_has_scope(p_token_hash, 'gateway', true) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- queued jobs are served by channel_gateway_jobs_queue_idx
  select count(*) into v_queued
    from sellerpilot_private.channel_gateway_jobs
   where status = 'queued';

  -- a running job whose lease already lapsed still needs the ordinary claim path
  select count(*) into v_stale_running
    from sellerpilot_private.channel_gateway_jobs
   where status = 'running'
     and (lease_expires_at is null or lease_expires_at <= clock_timestamp());

  return jsonb_build_object(
    'queued', v_queued,
    'staleRunning', v_stale_running
  );
end;
$function$;

revoke all on function public.sellerpilot_gateway_queue_pulse(text) from public;
grant execute on function public.sellerpilot_gateway_queue_pulse(text)
  to anon, authenticated, service_role;
