-- Narrow the already-scoped Smartstore QA update to the single approved unit.
-- The historical validator admitted any positive stock value; this forward
-- patch preserves every other exact identity and asset fence while requiring
-- stockQuantity=1 in the final server-owned provider payload.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
lock table sellerpilot_private.smartstore_exact_qa_update_permits
  in share row exclusive mode;

do $smartstore_exact_stock_preflight$
declare
  v_signature regprocedure :=
    'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'::regprocedure;
  v_definition text;
  v_old text :=
    'and coalesce(v_origin->>''stockQuantity'', '''') ~ ''^[1-9][0-9]{0,7}$''';
  v_new text :=
    'and v_origin->>''stockQuantity'' is not distinct from ''1''';
  v_old_count integer;
  v_new_count integer;
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'smartstore'
       and job.operation = 'listing.update'
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.request_payload#>>'{arguments,sellerpilotSmartstoreExactQaRecovery,listingId}'
             = '7babb554-48dc-4869-81b1-cd4d435d7b96'
  ) then
    raise exception 'Smartstore exact stock patch requires no active exact update job'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.smartstore_exact_qa_update_permits permit
     where permit.listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
       and permit.invalidated_at is null
       and permit.consumed_at is null
       and permit.expires_at > statement_timestamp()
  ) then
    raise exception 'Smartstore exact stock patch requires no active permit'
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

  if v_old_count = 1 and v_new_count = 0 then
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
    execute v_definition;
  elsif v_old_count = 0 and v_new_count = 1 then
    null;
  else
    raise exception
      'Smartstore exact stock validator preimage drift (old %, new %)',
      v_old_count, v_new_count
      using errcode = '55000';
  end if;
end;
$smartstore_exact_stock_preflight$;

revoke all on function
  sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)
  from public, anon, authenticated, service_role;

do $smartstore_exact_stock_postimage$
declare
  v_signature regprocedure :=
    'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_signature);
  v_old text :=
    'and coalesce(v_origin->>''stockQuantity'', '''') ~ ''^[1-9][0-9]{0,7}$''';
  v_new text :=
    'and v_origin->>''stockQuantity'' is not distinct from ''1''';
begin
  if pg_catalog.strpos(v_definition, v_old) <> 0
     or pg_catalog.strpos(v_definition, v_new) = 0
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_signature
          and procedure.provolatile = 'i'
          and not procedure.prosecdef
          and procedure.proconfig = array['search_path=""']::text[]
     )
     or pg_catalog.has_function_privilege(
       'public', v_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', v_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_signature, 'EXECUTE'
     )
  then
    raise exception 'Smartstore exact stock validator postimage invalid'
      using errcode = '55000';
  end if;
end;
$smartstore_exact_stock_postimage$;

commit;
