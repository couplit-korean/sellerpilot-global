-- Teach the local channel-executor access oracle about the single approved
-- Qoo10 write tuple so the release-aligned gateway worker can claim the
-- already-enqueued Qoo10 content update for the existing 롯데 롯샌 remote.
--
-- sellerpilot_private.local_channel_executor_access() is the authority used by
-- local_channel_executor_route_is_current(): it returned null for
-- ('qoo10','listing.update'), so the approved route row added in
-- 20260911054500_approve_local_qoo10_listing_update_route.sql could never be
-- considered current and the worker kept skipping the job.
--
-- This adds exactly one tuple. Qoo10 listing.create stays disallowed, and no
-- other channel or operation gains access. Writes still require the channel's
-- effective publication release gate, which is checked separately.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

create or replace function sellerpilot_private.local_channel_executor_access(
  p_channel text,
  p_operation text
)
returns text
language sql
stable
security definer
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
    -- Added 2026-09-11: update an existing Qoo10 remote only. Create, stop and
    -- activate remain unavailable to the local executor.
    when p_channel = 'qoo10' and p_operation = 'listing.update'
      then 'write'
    else null
  end
$function$;

revoke all on function sellerpilot_private.local_channel_executor_access(text, text)
  from public, anon, authenticated, service_role;

commit;
