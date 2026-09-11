-- A completion receipt is keyed by (job, claim), but the table's primary key is
-- job_id alone. When a job is re-claimed after a requeue, the old receipt makes
-- the insert fail with "duplicate key value violates ... pkey" and the worker
-- loops on 503 forever, so that channel never completes another read.
--
-- Keep the primary key, and drop a stale receipt for the same job that belongs to
-- a different claim just before the new receipt is written. The replay check
-- already scopes to the claim token, so this only removes receipts that can no
-- longer be replayed.
create or replace function sellerpilot_private.drop_stale_completion_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = new.job_id
     and receipt.claim_token <> new.claim_token;
  return new;
end;
$$;

drop trigger if exists drop_stale_completion_receipt
  on sellerpilot_private.gateway_completion_receipts;

create trigger drop_stale_completion_receipt
before insert on sellerpilot_private.gateway_completion_receipts
for each row
execute function sellerpilot_private.drop_stale_completion_receipt();

-- Jobs that never settled still carry a receipt from an earlier attempt. Those
-- receipts cannot be replayed (the job is not completed), so remove them once.
delete from sellerpilot_private.gateway_completion_receipts receipt
 using sellerpilot_private.channel_gateway_jobs job
 where receipt.job_id = job.id
   and job.status in ('queued', 'running');
