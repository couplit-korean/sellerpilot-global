-- Allow the fixed-IP lane to run the connection checks it is responsible for.
--
-- `sellerpilot_private.local_channel_executor_access` is the tuple list the
-- local executor consults before it hands a queued job to the machine with the
-- allowlisted address. It only described the coupang and smartstore listing
-- routes, so a queued `diagnostic.test` for one of the fixed-IP channels (whose
-- read is deliberately excluded from the ordinary gateway lane) could never be
-- claimed. Reading the channel's own state is read-only, so it is registered as
-- a read route; every claim still needs an approved route row with a matching
-- release, egress, token and expiry.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 910235500);

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
    when p_channel = 'coupang'
         and p_operation in (
           'categories.attributes', 'categories.validate',
           'listing.publication.verify'
         )
      then 'read'
    when p_operation = 'listing.create'
         and p_channel in ('coupang', 'smartstore')
      then 'write'
    when p_channel = 'smartstore' and p_operation = 'listing.update'
      then 'write'
    else null
  end
$function$;

comment on function sellerpilot_private.local_channel_executor_access(text, text) is
  'Fixed-IP lane route list; diagnostic.test is a read route for the channels whose reads cannot run from the serverless gateway.';
commit;
