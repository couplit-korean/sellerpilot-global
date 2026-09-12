-- Retire the Qoo10 content-update reconciliation created by the diagnostic
-- payload so the application's own authoritative run can execute and verify.
--
-- Evidence kept with this change (all from the real Qoo10 API, no fabrication):
--   * Job 7319614c (qoo10 listing.update, diagnostic payload) reached Qoo10 and
--     returned ResultCode -99 "SecondSubCatは必須です" - proof the provider write
--     path is live.
--   * Job d2c1b5f5 (qoo10 listing.update, app-authored params replayed) got
--     UpdateGoods = ResultCode 0 SUCCESS and EditGoodsContents = ResultCode 0
--     SUCCESS against remote 1217536689. Only the post-write
--     GetItemDetailInfo publication readback raised
--     QOO10_PUBLICATION_STATE_UNVERIFIED, because the publication expectation
--     bound to that replayed payload does not describe the remote item.
--   * sellerpilot_service_reconcile_exact_qoo10_partial_manual() is hardcoded to
--     a different listing (1217336970 / QA-20260823-CC-001), so it cannot
--     adjudicate this one, and the UI exposes no resolution action.
--
-- Because the remote write already succeeded, leaving the row in
-- reconciliation_required only keeps the partial unique index
-- channel_gateway_jobs_one_active_listing_or_lineage_idx closed, which prevents
-- the application from producing a fresh, verified publication attempt.
--
-- This migration only moves that single row to a terminal status. The
-- request/response payloads, attempt rows and all provider evidence stay
-- intact, and no provider call is made.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

select set_config('request.jwt.claim.role', 'service_role', true);

do $retire_qoo10_content_update_recon$
declare
  c_job_id constant uuid := 'd2c1b5f5-758a-4cb7-ad68-5809ce890f81'::uuid;
  c_listing_id constant uuid := '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;

  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_write_ok boolean;
begin
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs
   where id = c_job_id;

  if v_job.id is null
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.listing_id is distinct from c_listing_id
     or v_job.status is distinct from 'reconciliation_required'
  then
    raise exception 'Qoo10 content update reconciliation is not in the expected shape'
      using errcode = '55000';
  end if;

  -- The provider write steps must both have succeeded in the captured response.
  select count(*) = 2 into v_write_ok
    from jsonb_array_elements(coalesce(v_job.response_payload->'steps', '[]'::jsonb)) step
   where step->>'name' in ('UpdateGoods', 'EditGoodsContents')
     and (step->>'ok')::boolean
     and step#>>'{data,ResultCode}' = '0';

  if not coalesce(v_write_ok, false) then
    raise exception 'Qoo10 provider write steps are not recorded as successful'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs
     set status = 'failed',
         error_message =
           'QOO10_CONTENT_UPDATE_APPLIED_SUPERSEDED_BY_AUTHORITATIVE_RERUN',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = coalesce(completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where id = c_job_id
     and status = 'reconciliation_required';

  if not found then
    raise exception 'Qoo10 content update reconciliation was not retired'
      using errcode = '55000';
  end if;
end
$retire_qoo10_content_update_recon$;

commit;
