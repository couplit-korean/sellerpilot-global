-- Align the exact Smartstore permit with the canonical square asset filename
-- already enforced by the product-generation ledger. This is a forward-only
-- function-body rewrite because 20260901053500 may already be in production.

begin;

do $correct_smartstore_representative_filename$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'
  );
  v_definition text;
  v_rewritten text;
  v_old constant text :=
    '^results/[0-9a-f-]+/claims/[0-9a-f-]+/square[.]png$';
  v_new constant text :=
    '^results/[0-9a-f-]+/claims/[0-9a-f-]+/thumbnail-square[.]png$';
  v_old_count integer;
  v_new_count integer;
begin
  if v_signature is null then
    raise exception 'Smartstore exact QA argument validator is missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
  v_old_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  v_new_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
  ) / pg_catalog.length(v_new);

  if v_old_count = 0 and v_new_count = 1 then
    return;
  end if;
  if v_old_count <> 1 or v_new_count <> 0 then
    raise exception 'Smartstore representative validator preimage drifted'
      using errcode = '55000';
  end if;

  v_rewritten := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_rewritten;
end;
$correct_smartstore_representative_filename$;

-- This private predicate is called only inside server-owned permit functions.
-- Reassert that no API role can invoke it directly after CREATE OR REPLACE.
revoke all on function
  sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb, text)
  from public, anon, authenticated, service_role;

do $smartstore_representative_filename_postimage$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'
  );
  v_definition text;
  v_old constant text :=
    '^results/[0-9a-f-]+/claims/[0-9a-f-]+/square[.]png$';
  v_new constant text :=
    '^results/[0-9a-f-]+/claims/[0-9a-f-]+/thumbnail-square[.]png$';
begin
  if v_signature is null then
    raise exception 'Smartstore representative validator postimage missing'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;

  if pg_catalog.strpos(v_definition, v_old) <> 0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
     ) / pg_catalog.length(v_new) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_signature
          and not procedure.prosecdef
          and procedure.provolatile = 'i'::"char"
          and procedure.proconfig = array['search_path=""']::text[]
     )
     or exists (
       select 1
         from (values
           ('public'::name),
           ('anon'::name),
           ('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          v_signature,
          'EXECUTE'
        )
     )
  then
    raise exception 'Smartstore representative validator postimage invalid'
      using errcode = '55000';
  end if;
end;
$smartstore_representative_filename_postimage$;

commit;
