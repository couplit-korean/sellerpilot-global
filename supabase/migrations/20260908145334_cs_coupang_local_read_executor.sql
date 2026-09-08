-- Schema-only enablement for a future exact, short-lived Coupang CS GET route.
-- This migration creates no route, queues no job, reads no credential secret,
-- and performs no provider or commerce mutation.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 900800800);

do $preflight$
declare
  v_access_md5 text;
  v_allowed_md5 text;
  v_claim_md5 text;
  v_constraint_md5 text;
begin
  select pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure
  )) into v_access_md5;
  select pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  )) into v_allowed_md5;
  select pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
  )) into v_claim_md5;
  select pg_catalog.md5(pg_catalog.pg_get_constraintdef(constraint_row.oid))
    into v_constraint_md5
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'sellerpilot_private.local_channel_executor_routes'::regclass
     and constraint_row.conname =
         'local_channel_executor_routes_operation_check';

  if v_access_md5 is distinct from '6b1f84d12642c644bf679af54d3f7d85'
     or v_allowed_md5 is distinct from '51ffc1577c1e2636c11924fba65bf273'
     or v_claim_md5 is distinct from '3eb4ef53f44490f60892312a2c0a2731'
     or v_constraint_md5 is distinct from '5ffadee0a3f1b1baa6ebcfe995c8d78b'
     or sellerpilot_private.local_channel_executor_access(
          'coupang','inquiries.list'
        ) is not null
     or exists (
       select 1
         from sellerpilot_private.local_channel_executor_routes route
        where route.channel = 'coupang'
          and route.operation = 'inquiries.list'
     ) then
    raise exception 'COUPANG_CS_LOCAL_READ_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end;
$preflight$;

alter table sellerpilot_private.local_channel_executor_routes
  drop constraint local_channel_executor_routes_operation_check;
alter table sellerpilot_private.local_channel_executor_routes
  add constraint local_channel_executor_routes_operation_check check (
    (channel = 'coupang' and operation in (
      'categories.attributes',
      'categories.validate',
      'inquiries.list',
      'listing.create',
      'listing.publication.verify'
    ))
    or (channel = 'smartstore' and operation in (
      'listing.create','listing.update'
    ))
  );

create or replace function sellerpilot_private.local_channel_executor_access(
  p_channel text,
  p_operation text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_channel = 'coupang'
      and p_operation in (
        'categories.attributes',
        'categories.validate',
        'inquiries.list',
        'listing.publication.verify'
      ) then 'read'
    when p_operation = 'listing.create'
      and p_channel in ('coupang','smartstore') then 'write'
    when p_channel = 'smartstore'
      and p_operation = 'listing.update' then 'write'
    else null
  end
$$;
revoke all on function
  sellerpilot_private.local_channel_executor_access(text,text)
  from public,anon,authenticated,service_role;

do $postflight$
begin
  if sellerpilot_private.local_channel_executor_access(
       'coupang','inquiries.list'
     ) is distinct from 'read'
     or sellerpilot_private.local_channel_executor_access(
       'coupang','inquiries.reply'
     ) is not null
     or sellerpilot_private.local_channel_executor_access(
       'coupang','orders.list'
     ) is not null
     or sellerpilot_private.local_channel_executor_access(
       'coupang','shipment.confirm'
     ) is not null
     or sellerpilot_private.local_channel_executor_access(
       'coupang','listing.update'
     ) is not null
     or sellerpilot_private.local_channel_executor_access(
       'smartstore','inquiries.list'
     ) is not null
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
     )) is distinct from '51ffc1577c1e2636c11924fba65bf273'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
     )) is distinct from '3eb4ef53f44490f60892312a2c0a2731'
     or exists (
       select 1
         from sellerpilot_private.local_channel_executor_routes route
        where route.channel = 'coupang'
          and route.operation = 'inquiries.list'
     ) then
    raise exception 'COUPANG_CS_LOCAL_READ_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end;
$postflight$;

notify pgrst,'reload schema';
commit;
