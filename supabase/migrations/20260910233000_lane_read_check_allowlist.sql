-- Let the fixed-IP lane claim the read checks it is responsible for.
--
-- `sellerpilot_private.serverless_gateway_job_allowed` answers false for
-- (coupang, temu) x (orders.list, inquiries.list, diagnostic.test) and for
-- (elevenst, shopee) x inquiries.list, because those reads must egress from the
-- seller's allowlisted address instead of a datacenter. The fixed-IP lane runs
-- inside `sellerpilot.local_channel_executor_lane = 'enabled'`, and it still
-- goes through this predicate, so the queued connection checks were never
-- handed to the worker that can actually run them.
--
-- The lane marker is transaction local and only set by the local executor
-- claim, so the serverless gateway keeps the original exclusions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 910233000);

create or replace function sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(
  p_channel text,
  p_operation text
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select case
    when coalesce(current_setting(
           'sellerpilot.local_channel_executor_lane', true), '') = 'enabled'
         and p_operation = 'diagnostic.test'
         and p_channel in (
           'coupang', 'smartstore', 'elevenst', 'temu', 'shopee', 'lazada'
         )
      then true
    when p_channel in ('coupang', 'temu')
         and p_operation in ('inquiries.list', 'diagnostic.test', 'orders.list')
      then false
    when p_channel in ('elevenst', 'shopee')
         and p_operation = 'inquiries.list'
      then false
    else sellerpilot_private.serverless_gateway_job_allowed_before_temu_173960(
      p_channel, p_operation
    )
  end
$function$;

comment on function sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(
  text, text
) is
  'Ordinary gateway allow-list; the fixed-IP lane may additionally claim diagnostic.test for the channels whose reads must egress from the allowlisted address.';
commit;
