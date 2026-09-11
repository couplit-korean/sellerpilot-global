-- Retire the resolved exact Qoo10 update job so the listing slot is free again.
--
-- Why this is a repair, not a bypass:
--   * Job 089467c1 (qoo10 listing.update) has status reconciliation_required
--     since 2026-09-04, but sellerpilot_private.listing_mutation_reconciliation_
--     resolved(089467c1) is already true: its remote divergence was adjudicated.
--   * The resolution never moved the queue row to a terminal status, so the
--     partial unique index
--     channel_gateway_jobs_one_active_listing_or_lineage_idx still treats it as
--     an active listing job and rejects the next qoo10 listing.update with
--     23505.
--   * Its S1 readback evidence produced a live/S2 remote
--     (remote 1217536689, provider_status S2), so the row is merely a stale
--     bookkeeping leftover.
--
-- This migration only moves that single resolved row to a terminal status. It
-- keeps request/response payloads, completion receipts, the attempt row and
-- the S1 observation untouched, and never calls a provider.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

select set_config('request.jwt.claim.role', 'service_role', true);

do $retire_resolved_qoo10_update_job$
declare
  c_update_job_id constant uuid :=
    '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;
  c_listing_id constant uuid :=
    '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;

  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
begin
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs
   where id = c_update_job_id;
  select * into v_listing
    from sellerpilot_private.product_listings
   where id = c_listing_id;

  if v_job.id is null
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.listing_id is distinct from c_listing_id
     or v_job.status is distinct from 'reconciliation_required'
     or not sellerpilot_private.listing_mutation_reconciliation_resolved(
              c_update_job_id
            )
  then
    raise exception 'resolved Qoo10 update job is not in the expected shape'
      using errcode = '55000';
  end if;

  if v_listing.remote_visibility is distinct from 'live'
     or v_listing.provider_status is distinct from 'S2'
  then
    raise exception 'target listing is not the verified live S2 remote'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs
     set status = 'failed',
         error_message =
           'QOO10_EXACT_UPDATE_RECONCILIATION_RESOLVED_TERMINAL',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = coalesce(completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where id = c_update_job_id
     and status = 'reconciliation_required';

  if not found then
    raise exception 'resolved Qoo10 update job was not retired'
      using errcode = '55000';
  end if;
end
$retire_resolved_qoo10_update_job$;

commit;
