-- Let the fixed-IP worker run read checks for the channels whose reads are
-- excluded from the ordinary gateway lane.
--
-- `sellerpilot_private.serverless_gateway_job_allowed` answers false for
-- (coupang, temu) x (orders.list, inquiries.list, diagnostic.test) and for
-- (elevenst, shopee) x inquiries.list, because those reads have to egress from
-- the seller's allowlisted address instead of a datacenter. The only lane that
-- runs provider calls from that machine is the local channel executor, but its
-- route table accepted only coupang and smartstore listing operations, so a
-- connection check for Temu or Lazada was queued and never claimable.
--
-- This migration widens the allowed (channel, operation) pairs. It does not
-- approve anything by itself: a route row still needs an owner approval with a
-- release, egress and expiry before the worker can claim it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 910230000);

alter table sellerpilot_private.local_channel_executor_routes
  drop constraint if exists local_channel_executor_routes_channel_check;
alter table sellerpilot_private.local_channel_executor_routes
  add constraint local_channel_executor_routes_channel_check check (
    channel = any (array[
      'coupang', 'smartstore', 'elevenst', 'temu', 'shopee', 'lazada'
    ]::text[])
  );

alter table sellerpilot_private.local_channel_executor_routes
  drop constraint if exists local_channel_executor_routes_operation_check;
alter table sellerpilot_private.local_channel_executor_routes
  add constraint local_channel_executor_routes_operation_check check (
    (channel = 'coupang' and operation = any (array[
      'categories.attributes', 'categories.validate', 'listing.create',
      'listing.publication.verify', 'orders.list', 'inquiries.list',
      'diagnostic.test'
    ]::text[]))
    or (channel = 'smartstore' and operation = any (array[
      'listing.create', 'listing.update', 'orders.list', 'inquiries.list',
      'diagnostic.test'
    ]::text[]))
    or (channel = any (array['elevenst', 'temu', 'shopee', 'lazada']::text[])
        and operation = any (array[
          'orders.list', 'inquiries.list', 'diagnostic.test'
        ]::text[]))
  );

comment on constraint local_channel_executor_routes_operation_check
  on sellerpilot_private.local_channel_executor_routes is
  'Fixed-IP read checks and existing listing routes; each route still needs an explicit owner approval row.';
commit;
