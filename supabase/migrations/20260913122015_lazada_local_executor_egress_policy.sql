-- The application already supports Lazada's fixed-IP local route, but the
-- policy table's five-channel CHECK cannot store its required disabled row.
-- A false row enables only eligibility for the existing approved local route;
-- credential, worker, release, IP and per-product approval checks still apply.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $precondition$
declare definition text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into definition
  from pg_catalog.pg_constraint
  where conrelid = 'sellerpilot_private.serverless_static_egress_policy'::regclass
    and conname = 'serverless_static_egress_policy_channel_check';
  if definition is distinct from
    'CHECK ((channel = ANY (ARRAY[''coupang''::text, ''smartstore''::text, ''elevenst''::text, ''temu''::text, ''shopee''::text])))'
  then
    raise exception 'LAZADA_EGRESS_POLICY_PRECONDITION_CHANGED';
  end if;
end $precondition$;

alter table sellerpilot_private.serverless_static_egress_policy
  drop constraint serverless_static_egress_policy_channel_check;
alter table sellerpilot_private.serverless_static_egress_policy
  add constraint serverless_static_egress_policy_channel_check
  check (channel in ('coupang','smartstore','elevenst','temu','shopee','lazada'));

insert into sellerpilot_private.serverless_static_egress_policy(channel,enabled)
values ('lazada',false);

commit;
