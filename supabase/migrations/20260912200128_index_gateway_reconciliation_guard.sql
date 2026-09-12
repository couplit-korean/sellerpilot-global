-- Measured in sqaoqucxakebqkiygdxb on 2026-09-13 KST: the credential
-- reconciliation guard scanned 56,644 queue rows (5,415 shared blocks) for
-- three matches. Existing queued/running indexes cannot satisfy this state.
-- Index only the small unresolved set; preserve every claim/credential guard.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '15s';

create index channel_gateway_jobs_reconciliation_lookup_idx
  on sellerpilot_private.channel_gateway_jobs
    (credential_id, channel, environment, operation, id)
  where status = 'reconciliation_required';

analyze sellerpilot_private.channel_gateway_jobs;
commit;
