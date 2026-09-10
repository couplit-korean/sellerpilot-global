-- Unapplied forward-migration proposal for CS-smartstore-R02.
-- Archive the exact prior completion receipt atomically when v7 requeues the
-- same failed SmartStore history job. Completion/claim functions and grants
-- are deliberately unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

create table if not exists sellerpilot_private.smartstore_history_retired_completion_receipts (
  job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  history_run_id uuid not null
    references sellerpilot_private.inquiry_history_backfill_runs(id) on delete restrict,
  history_item_key text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null,
  receipt_snapshot jsonb not null check (jsonb_typeof(receipt_snapshot) = 'object'),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  failed_job_snapshot jsonb not null check (jsonb_typeof(failed_job_snapshot) = 'object'),
  failed_job_sha256 text not null check (failed_job_sha256 ~ '^[a-f0-9]{64}$'),
  retired_at timestamptz not null default clock_timestamp(),
  contract text not null default 'smartstore_history_retry_receipt_v1'
    check (contract = 'smartstore_history_retry_receipt_v1'),
  primary key (job_id, claim_token)
);

alter table sellerpilot_private.smartstore_history_retired_completion_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_history_retired_completion_receipts
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.block_smartstore_history_retired_receipt_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SMARTSTORE_HISTORY_RETIRED_RECEIPT_IMMUTABLE'
    using errcode = '55000';
end
$$;
revoke all on function sellerpilot_private.block_smartstore_history_retired_receipt_change_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists block_smartstore_history_retired_receipt_change_v1
  on sellerpilot_private.smartstore_history_retired_completion_receipts;
create trigger block_smartstore_history_retired_receipt_change_v1
before update or delete
on sellerpilot_private.smartstore_history_retired_completion_receipts
for each row execute function
  sellerpilot_private.block_smartstore_history_retired_receipt_change_v1();

create or replace function sellerpilot_private.archive_smartstore_history_retry_receipt_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_receipt sellerpilot_private.gateway_completion_receipts%rowtype;
  v_run_id uuid;
  v_item_key text;
  v_coverage_mode text;
  v_receipt_snapshot jsonb;
  v_job_snapshot jsonb;
  v_deleted_snapshot jsonb;
  v_deleted_count integer;
begin
  if old.status is distinct from 'failed'
     or new.status is distinct from 'queued'
     or old.channel is distinct from 'smartstore'
     or old.operation is distinct from 'inquiries.list'
     or nullif(old.request_payload#>>'{arguments,sellerpilotHistoryRunId}', '') is null
     or nullif(old.request_payload#>>'{arguments,sellerpilotHistoryItemKey}', '') is null then
    return new;
  end if;

  -- Match only the exact v7 retry transition. A drifted update aborts rather
  -- than retiring evidence for an unrelated/manual state change.
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.credential_id is distinct from old.credential_id
     or new.channel is distinct from old.channel
     or new.operation is distinct from old.operation
     or new.environment is distinct from old.environment
     or new.request_payload is distinct from old.request_payload
     or new.response_payload is distinct from old.response_payload
     or new.attempt_count is distinct from old.attempt_count
     or new.started_at is distinct from old.started_at
     or (to_jsonb(new) - array[
       'status','worker_token_id','claim_token','lease_expires_at',
       'completed_at','error_message','updated_at'
     ]::text[]) is distinct from (to_jsonb(old) - array[
       'status','worker_token_id','claim_token','lease_expires_at',
       'completed_at','error_message','updated_at'
     ]::text[])
     or new.worker_token_id is not null
     or new.claim_token is not null
     or new.lease_expires_at is not null
     or new.completed_at is not null
     or new.error_message is not null
     or old.attempt_count >= 4
     or old.credential_refresh_in_flight is not false
     or old.credential_refresh_recovery_vault_id is not null then
    raise exception 'SMARTSTORE_HISTORY_RETRY_TRANSITION_INVALID'
      using errcode = '55000';
  end if;

  begin
    v_run_id := (old.request_payload#>>'{arguments,sellerpilotHistoryRunId}')::uuid;
  exception when others then
    raise exception 'SMARTSTORE_HISTORY_RETRY_SCOPE_INVALID'
      using errcode = '55000';
  end;
  v_item_key := old.request_payload#>>'{arguments,sellerpilotHistoryItemKey}';
  v_coverage_mode := old.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}';

  select run.* into v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id = v_run_id
     and run.owner_id = old.created_by
     and run.credential_ids->>'smartstore' = old.credential_id::text
     and run.channels @> array['smartstore']::text[]
   for share;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = old.credential_id
     and credential.created_by = old.created_by
     and credential.channel = 'smartstore'
     and credential.environment = old.environment
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
   for share;
  if v_run.id is null
     or v_credential.id is null
     or sellerpilot_private.smartstore_history_run_lineage_valid_v1(
       v_run.id, old.created_by, old.credential_id, old.environment,
       v_run.range_start, v_run.range_end, v_coverage_mode
     ) is not true then
    raise exception 'SMARTSTORE_HISTORY_RETRY_SCOPE_INVALID'
      using errcode = '55000';
  end if;

  select receipt.* into v_receipt
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = old.id
   for update;
  if not found then
    return new;
  end if;

  v_receipt_snapshot := to_jsonb(v_receipt);
  v_job_snapshot := to_jsonb(old);
  insert into sellerpilot_private.smartstore_history_retired_completion_receipts (
    job_id, claim_token, history_run_id, history_item_key, owner_id,
    credential_id, environment, receipt_snapshot, receipt_sha256,
    failed_job_snapshot, failed_job_sha256
  ) values (
    old.id, v_receipt.claim_token, v_run.id, v_item_key, old.created_by,
    old.credential_id, old.environment, v_receipt_snapshot,
    encode(extensions.digest(v_receipt_snapshot::text, 'sha256'), 'hex'),
    v_job_snapshot,
    encode(extensions.digest(v_job_snapshot::text, 'sha256'), 'hex')
  );

  delete from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = old.id
     and receipt.claim_token = v_receipt.claim_token
     and to_jsonb(receipt) = v_receipt_snapshot
  returning to_jsonb(receipt) into v_deleted_snapshot;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1
     or v_deleted_snapshot is distinct from v_receipt_snapshot then
    raise exception 'SMARTSTORE_HISTORY_RETRY_RECEIPT_ARCHIVE_MISMATCH'
      using errcode = '55000';
  end if;
  return new;
end
$$;
revoke all on function sellerpilot_private.archive_smartstore_history_retry_receipt_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists archive_smartstore_history_retry_receipt_v1
  on sellerpilot_private.channel_gateway_jobs;
create trigger archive_smartstore_history_retry_receipt_v1
before update on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.archive_smartstore_history_retry_receipt_v1();

comment on table sellerpilot_private.smartstore_history_retired_completion_receipts is
  'Immutable attempt evidence archived only when the exact validated SmartStore v7 history lineage requeues the same failed job ID.';

commit;
