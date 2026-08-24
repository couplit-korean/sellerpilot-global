-- Every signed-in dashboard used to enqueue its own five-minute order and
-- inquiry reads. Route all refreshes through the existing periodic idempotency
-- key and index that lookup so one marketplace request is shared globally.

begin;
create index if not exists channel_gateway_jobs_periodic_dedupe_idx
  on sellerpilot_private.channel_gateway_jobs (
    credential_id,
    channel,
    operation,
    (left(coalesce(nullif(trim(request_payload->>'periodicKey'), ''), md5(request_payload::text)), 120)),
    created_at desc
  )
  where attempt_id is null;
alter table sellerpilot_private.channel_gateway_jobs set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
commit;

