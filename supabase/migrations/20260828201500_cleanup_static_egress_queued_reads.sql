-- Close Korean inquiry reads that were queued before the static-egress gate
-- was installed. This deliberately excludes replies and every non-read
-- operation; no product, order, history-run, or customer row is mutated.

begin;

update sellerpilot_private.channel_gateway_jobs job
   set status = 'failed',
       error_message = 'STATIC_EGRESS_REQUIRED',
       worker_token_id = null,
       claim_token = null,
       lease_expires_at = null,
       completed_at = coalesce(job.completed_at, clock_timestamp()),
       updated_at = clock_timestamp()
 where job.status = 'queued'
   and job.channel in ('coupang', 'smartstore')
   and job.operation = 'inquiries.list'
   and nullif(
         job.request_payload #>> '{arguments,sellerpilotHistoryRunId}',
         ''
       ) is null;

commit;
