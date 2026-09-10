-- Continue verified SmartStore listings through the same release/IP-bound local
-- executor as creation. This does not enable a route or open a publication gate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_catalog.pg_advisory_xact_lock(193674993, 907161000);

do $dependencies$
begin
  if to_regprocedure('sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)') is null
     or to_regprocedure('sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid)') is null then
    raise exception 'SMARTSTORE_LOCAL_UPDATE_DEPENDENCY_MISSING';
  end if;
end;
$dependencies$;

do $operation_constraint$
declare
  constraint_name text;
  constraint_count integer;
begin
  select count(*), min(conname) into constraint_count, constraint_name
  from pg_constraint
  where conrelid = 'sellerpilot_private.local_channel_executor_routes'::regclass
    and contype = 'c'
    and position('operation' in pg_get_constraintdef(oid)) > 0;
  if constraint_count <> 1 then
    raise exception 'SMARTSTORE_LOCAL_UPDATE_ROUTE_CONSTRAINT_DRIFT';
  end if;
  execute format('alter table sellerpilot_private.local_channel_executor_routes drop constraint %I', constraint_name);
  alter table sellerpilot_private.local_channel_executor_routes
    add constraint local_channel_executor_routes_operation_check check (
      (channel = 'coupang' and operation in ('categories.attributes','categories.validate','listing.create'))
      or (channel = 'smartstore' and operation in ('listing.create','listing.update'))
    );
end;
$operation_constraint$;

create or replace function sellerpilot_private.local_channel_executor_access(
  p_channel text, p_operation text
)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_channel = 'coupang' and p_operation in ('categories.attributes','categories.validate') then 'read'
    when p_operation = 'listing.create' and p_channel in ('coupang','smartstore') then 'write'
    when p_channel = 'smartstore' and p_operation = 'listing.update' then 'write'
    else null
  end
$$;
revoke all on function sellerpilot_private.local_channel_executor_access(text,text)
  from public, anon, authenticated, service_role;

do $update_identity_guard$
declare
  definition text;
  needle constant text := '  if listing.id is null then return false; end if;';
  replacement constant text := $guard$  if listing.id is null then return false; end if;
  -- SMARTSTORE_LOCAL_UPDATE_REMOTE_IDENTITY: preserve the exact existing origin.
  if job.channel = 'smartstore' and job.operation = 'listing.update' and (
    coalesce(listing.remote_id,'') !~ '^[1-9][0-9]{5,19}$'
    or job.request_payload#>>'{arguments,originProductNo}' is distinct from listing.remote_id
  ) then
    return false;
  end if;$guard$;
begin
  definition := pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  );
  if position('SMARTSTORE_LOCAL_UPDATE_REMOTE_IDENTITY' in definition) > 0
     or (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 then
    raise exception 'SMARTSTORE_LOCAL_UPDATE_JOB_PREDICATE_DRIFT';
  end if;
  execute replace(definition,needle,replacement);
end;
$update_identity_guard$;

commit;
