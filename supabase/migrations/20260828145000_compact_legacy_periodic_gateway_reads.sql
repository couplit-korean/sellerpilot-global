-- Remove only the obsolete unkeyed periodic read backlog, then enforce one
-- active periodic read per credential/channel/operation/key. Marketplace
-- writes, competitor searches, operation-attempt work, and terminal history
-- are outside this migration's scope.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('sellerpilot:compact-legacy-periodic-gateway-reads:v1')
);
lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;

do $migration$
declare
  v_migration_started_at timestamptz := clock_timestamp();
begin
  -- Legacy browser polling omitted periodicKey entirely. Only old, unclaimed,
  -- queued reads are safe to close; fresh reads and every manual attempt remain.
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         completed_at = v_migration_started_at,
         updated_at = v_migration_started_at,
         error_message = 'LEGACY_PERIODIC_READ_UNKEYED_COMPACTED'
   where job.attempt_id is null
     and job.operation in ('orders.list', 'inquiries.list')
     and job.status = 'queued'
     and nullif(trim(job.request_payload->>'periodicKey'), '') is null
     and job.created_at <= v_migration_started_at - interval '30 minutes';

  -- A unique index cannot be built over historical active duplicates. A
  -- running read may also be refreshing an OAuth credential, so never revoke
  -- its live claim here. Prefer that running row; otherwise retain the newest
  -- queued exact periodic read and close only the redundant queued rows.
  with ranked_active_reads as materialized (
    select
      job.id,
      row_number() over (
        partition by
          job.credential_id,
          job.channel,
          job.operation,
          trim(job.request_payload->>'periodicKey')
        order by
          case when job.status = 'running' then 0 else 1 end,
          job.created_at desc,
          job.id desc
      ) as duplicate_rank
    from sellerpilot_private.channel_gateway_jobs job
    where job.attempt_id is null
      and job.operation in ('orders.list', 'inquiries.list')
      and job.status in ('queued', 'running')
      and nullif(trim(job.request_payload->>'periodicKey'), '') is not null
  )
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         completed_at = v_migration_started_at,
         updated_at = v_migration_started_at,
         error_message = 'PERIODIC_READ_ACTIVE_DUPLICATE_COMPACTED'
    from ranked_active_reads ranked
   where ranked.duplicate_rank > 1
     and job.id = ranked.id
     and job.status = 'queued';
end;
$migration$;

create unique index if not exists channel_gateway_jobs_active_periodic_read_once_idx
  on sellerpilot_private.channel_gateway_jobs (
    credential_id,
    channel,
    operation,
    (trim(request_payload->>'periodicKey'))
  )
  where attempt_id is null
    and operation in ('orders.list', 'inquiries.list')
    and status in ('queued', 'running')
    and nullif(trim(request_payload->>'periodicKey'), '') is not null;

commit;
