begin;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.sellerpilot_08047000_ingest_before_coupang_after_sales(uuid,text,jsonb)'
  );
  v_definition text;
  v_before text;
  v_old text := E'         or coalesce(v_case->>''orderSn'','''') !~ ''^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$''\n         or exists (';
  v_new text := E'         or coalesce(v_case->>''orderSn'','''') !~ ''^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$''\n         or v_case->>''orderSn'' is distinct from v_order_sn\n         or exists (';
begin
  if v_signature is null then
    raise exception 'TEMU_CHILD_ORDER_LINEAGE_PREIMAGE_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_signature)
    into strict v_definition;
  if pg_catalog.strpos(v_definition, 'v_case->>''orderSn'' is distinct from v_order_sn') > 0 then
    raise exception 'TEMU_CHILD_ORDER_LINEAGE_ALREADY_INSTALLED';
  end if;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'TEMU_CHILD_ORDER_LINEAGE_PREIMAGE_DRIFTED';
  end if;
  v_before := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if v_definition = v_before then
    raise exception 'TEMU_CHILD_ORDER_LINEAGE_PREIMAGE_DRIFTED';
  end if;
  execute v_definition;
end
$migration$;

do $verify$
declare
  v_signature regprocedure := to_regprocedure(
    'public.sellerpilot_08047000_ingest_before_coupang_after_sales(uuid,text,jsonb)'
  );
begin
  if not exists (
    select 1
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature
       and pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(procedure.oid),
         'v_case->>''orderSn'' is distinct from v_order_sn'
       ) > 0
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=""']::text[]
       and procedure.proowner = 'postgres'::regrole
       and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'TEMU_CHILD_ORDER_LINEAGE_POSTIMAGE_INVALID';
  end if;
end
$verify$;

comment on function public.sellerpilot_08047000_ingest_before_coupang_after_sales(
  uuid, text, jsonb
) is
  'Ingests exact marketplace CS identities and rejects Temu child after-sales cases outside their parent order.';

commit;
