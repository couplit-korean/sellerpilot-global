begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 916300001);

do $ebay_exact_qa_rpc_preimage$
declare
  v_stored_name constant text :=
    'sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit';
  v_rpc_name constant text :=
    'sellerpilot_service_get_ebay_exact_qa_recovery_identity';
begin
  if pg_catalog.octet_length(v_stored_name) <> 63
     or pg_catalog.octet_length(v_rpc_name) > 63
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'
        ) is null
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'
        ) is not null
  then
    raise exception 'eBay exact QA RPC preimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_exact_qa_rpc_preimage$;

-- PostgreSQL stored the original 64-byte identifier under its 63-byte
-- truncated name. Keep it in place because existing SQL/PLpgSQL fences call
-- it textually, and expose a stable, untruncated PostgREST RPC name instead.
create function public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    p_listing_id,
    p_credential_id,
    p_product_id,
    p_market,
    p_target_id
  )
$$;

revoke all on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    uuid, uuid, uuid, text, text
  ) to service_role;

revoke all on function
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

comment on function
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) is
  'PostgREST-safe service-role wrapper for the exact eBay QA recovery identity. The 63-byte stored predecessor remains intact for existing database fences.';

do $ebay_exact_qa_rpc_postimage$
declare
  v_rpc_definition text;
  v_rpc_name text;
  v_rpc_count integer;
begin
  select procedure_row.proname,
         pg_catalog.pg_get_functiondef(procedure_row.oid),
         count(*) over ()::integer
    into v_rpc_name, v_rpc_definition, v_rpc_count
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
   where namespace_row.nspname = 'public'
     and procedure_row.proname =
       'sellerpilot_service_get_ebay_exact_qa_recovery_identity';

  if v_rpc_count is distinct from 1
     or v_rpc_name is distinct from
          'sellerpilot_service_get_ebay_exact_qa_recovery_identity'
     or pg_catalog.octet_length(v_rpc_name) > 63
     or v_rpc_definition not like
          '%sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(%'
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'
        ) is null
     or pg_catalog.has_function_privilege(
          'public',
          'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'public',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
  then
    raise exception 'eBay exact QA RPC postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_exact_qa_rpc_postimage$;

notify pgrst, 'reload schema';

commit;
