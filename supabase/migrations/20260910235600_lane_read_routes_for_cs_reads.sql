-- Let the fixed-IP lane run the CS and order reads it is responsible for.
--
-- The CS/order reads of the fixed-IP channels are deliberately excluded from the
-- ordinary (serverless) gateway lane, so the machine with the allowlisted
-- address has to claim them. That lane only described the listing routes and
-- `diagnostic.test`, so a queued `orders.list` or `inquiries.list` could not be
-- claimed by either lane and stayed queued indefinitely; the CS ledger stayed
-- empty while jobs accumulated.
--
-- 1. Register `orders.list` and `inquiries.list` as read routes for the
--    fixed-IP channels in the lane's tuple list.
-- 2. Extend the approved-read bootstrap to those read tuples. The strict route
--    gate requires `credential.last_check_status = 'passed'`, which can only be
--    produced by a successful run, so the first read needs the explicit
--    approved-route bootstrap. Write routes keep the strict gate.
-- 3. Insert the approved route rows for each channel's active production
--    credential, pinned to the release that is active now and to the
--    allowlisted egress address.
--
-- Every claim still needs a matching route row, release, egress, worker token,
-- an active production credential and a matching seller account key. No
-- credential check status is written or upgraded here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 910235600);

create or replace function sellerpilot_private.local_channel_executor_access(
  p_channel text,
  p_operation text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_operation = 'diagnostic.test'
         and p_channel in (
           'coupang', 'smartstore', 'elevenst', 'temu', 'shopee', 'lazada'
         )
      then 'read'
    when p_operation in ('orders.list', 'inquiries.list')
         and p_channel in (
           'coupang', 'smartstore', 'elevenst', 'temu', 'shopee', 'lazada'
         )
      then 'read'
    when p_channel = 'coupang'
         and p_operation in (
           'categories.attributes', 'categories.validate',
           'listing.publication.verify'
         )
      then 'read'
    when p_operation = 'listing.create' and p_channel in ('coupang', 'smartstore')
      then 'write'
    when p_channel = 'smartstore' and p_operation = 'listing.update'
      then 'write'
    else null
  end
$function$;

do $read_bootstrap$
declare
  v_def text;
  v_marker text := 'and job.operation = ''diagnostic.test''';
  v_replacement text := 'and job.operation in (''diagnostic.test'', ''orders.list'', ''inquiries.list'')';
  v_count integer;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into v_def
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'sellerpilot_private'
     and procedure.proname = 'local_channel_executor_read_bootstrap_allowed';

  if v_def is null then
    raise exception 'read bootstrap function not found' using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_def, v_replacement) > 0 then
    return;
  end if;

  v_count := (
    pg_catalog.length(v_def)
    - pg_catalog.length(pg_catalog.replace(v_def, v_marker, ''))
  ) / pg_catalog.length(v_marker);
  if v_count <> 1 then
    raise exception 'read bootstrap preimage mismatch (%)', v_count using errcode = '55000';
  end if;

  v_def := pg_catalog.replace(v_def, v_marker, v_replacement);
  if pg_catalog.strpos(v_def, v_replacement) = 0 then
    raise exception 'read bootstrap patch did not apply' using errcode = '55000';
  end if;
  execute v_def;
end;
$read_bootstrap$;

insert into sellerpilot_private.local_channel_executor_routes (
  owner_id,
  channel,
  operation,
  credential_id,
  seller_account_key,
  worker_token_id,
  release_sha,
  egress_ip_sha256,
  approved_by,
  approved_at,
  expires_at,
  enabled
)
select
  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
  credential.channel,
  read_route.operation,
  credential.id,
  credential.seller_account_key,
  '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
  sellerpilot_private.active_serverless_runtime_release_sha(),
  '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01',
  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
  clock_timestamp(),
  clock_timestamp() + interval '6 hours',
  true
from sellerpilot_private.channel_credentials credential
cross join (
  values ('orders.list'), ('inquiries.list')
) as read_route(operation)
where credential.environment = 'production'
  and credential.status = 'active'
  and credential.channel in (
    'coupang', 'smartstore', 'elevenst', 'temu', 'shopee', 'lazada'
  )
  and credential.seller_account_key is not null
  and credential.seller_account_key_source in (
    'provider_certified_v1', 'credential_incarnation_v1'
  )
  and sellerpilot_private.active_serverless_runtime_release_sha() ~ '^[a-f0-9]{40}$'
  and not exists (
    select 1
      from sellerpilot_private.local_channel_executor_routes route
     where route.channel = credential.channel
       and route.operation = read_route.operation
       and route.credential_id = credential.id
       and route.worker_token_id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
  );

commit;
