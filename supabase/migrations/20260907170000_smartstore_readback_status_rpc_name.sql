-- Expose the SmartStore adoption readback status RPC under a PostgREST-safe
-- identifier. PostgreSQL truncated the 66-byte declaration in 160000 to 63
-- bytes. Preserve that installed implementation and add a short service-only
-- wrapper so no internal dependency on the installed function is disturbed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907170000);

do $dependencies$
declare
  old_name constant text :=
    'sellerpilot_service_get_smartstore_manual_adoption_readback_sta';
  new_name constant text :=
    'sellerpilot_service_get_smartstore_adoption_readback_status';
begin
  if pg_catalog.octet_length(old_name) <> 63
     or pg_catalog.octet_length(new_name) >= 64 then
    raise exception 'SMARTSTORE_READBACK_STATUS_RPC_NAME_LENGTH_INVALID';
  end if;
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_manual_adoption_readback_sta(uuid,uuid)'
     ) is null then
    raise exception 'SMARTSTORE_READBACK_TRUNCATED_STATUS_RPC_MISSING'
      using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)'
     ) is not null then
    raise exception 'SMARTSTORE_READBACK_SHORT_STATUS_RPC_ALREADY_EXISTS'
      using errcode = '55000';
  end if;
end;
$dependencies$;

create function public.sellerpilot_service_get_smartstore_adoption_readback_status(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sellerpilot_service_get_smartstore_manual_adoption_readback_sta(
    p_actor,p_product_id
  )
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)
  to service_role;

do $verify$
declare
  old_definition text;
  new_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_smartstore_manual_adoption_readback_sta(uuid,uuid)'::regprocedure
  ) into old_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)'::regprocedure
  ) into new_definition;
  if old_definition is null
     or new_definition is null
     or pg_catalog.strpos(
       new_definition,
       'sellerpilot_service_get_smartstore_manual_adoption_readback_sta'
     ) = 0
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.pg_proc procedure
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname in (
           'sellerpilot_service_get_smartstore_manual_adoption_readback_sta',
           'sellerpilot_service_get_smartstore_adoption_readback_status'
         )
         and pg_catalog.octet_length(procedure.proname) > 63
     ) then
    raise exception 'SMARTSTORE_READBACK_STATUS_RPC_POSTCONDITION_FAILED';
  end if;
end;
$verify$;

comment on function
  public.sellerpilot_service_get_smartstore_adoption_readback_status(uuid,uuid)
  is 'PostgREST-safe service-only wrapper for the installed 160000 SmartStore adoption readback status implementation whose original 66-byte declaration was truncated by PostgreSQL.';

notify pgrst, 'reload schema';

commit;
