-- Preserve the exact 173400 already-live adoption contract while correcting
-- its credential lineage comparison. Production stores the credential under
-- the internal release actor (the exact source job creator), while the product
-- listing belongs to the seller owner. The credential ID, seller account key,
-- certification, environment, status, and expiry fences remain unchanged.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065043);

do $replace_exact_qoo10_adoption_lineage$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid,text,jsonb)'::regprocedure;
  v_old constant text :=
    'v_credential.created_by is distinct from v_listing.owner_id';
  v_new constant text :=
    'v_credential.created_by is distinct from v_source.created_by';
  v_preimage_prosrc_sha256 constant text :=
    '9f158f36c2c3c1348229ae2c7cc38fdb9f8552df2d702fdeba234438b32bc946';
  v_postimage_prosrc_sha256 constant text :=
    'ee52ff84cb0346b38a4c6d5de690f42e7cf8933c4cfa214111359512b0352fa6';
  v_definition text;
  v_expected text;
  v_postimage text;
  v_prosrc text;
  v_function_owner oid;
  v_postimage_owner oid;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_function_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_preimage_prosrc_sha256
     or (pg_catalog.length(v_definition) - pg_catalog.length(
        pg_catalog.replace(v_definition, v_old, '')
      )) / pg_catalog.length(v_old) <> 1
     or pg_catalog.strpos(v_definition, v_new) <> 0
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_signature
          and procedure.proowner = v_function_owner
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
     )
  then
    raise exception
      'exact Qoo10 already-live adoption credential lineage pre-image mismatch'
      using errcode = '55000';
  end if;

  v_expected := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_expected;

  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_postimage, v_prosrc, v_postimage_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_postimage_prosrc_sha256
     or v_postimage_owner is distinct from v_function_owner
     or pg_catalog.strpos(v_postimage, v_old) <> 0
     or (pg_catalog.length(v_postimage) - pg_catalog.length(
          pg_catalog.replace(v_postimage, v_new, '')
        )) / pg_catalog.length(v_new) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
     )
  then
    raise exception
      'exact Qoo10 already-live adoption credential lineage post-image mismatch'
      using errcode = '55000';
  end if;
end;
$replace_exact_qoo10_adoption_lineage$;

-- CREATE OR REPLACE preserves the existing ACL, but reassert it explicitly so
-- an already-drifted public SECURITY DEFINER endpoint cannot survive rollout.
revoke all on function
  public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid, text, jsonb)
  to service_role;

do $exact_qoo10_adoption_lineage_acl_postimage$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid,text,jsonb)'::regprocedure;
begin
  if not pg_catalog.has_function_privilege(
       'service_role', v_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', v_signature, 'EXECUTE'
     )
  then
    raise exception
      'exact Qoo10 already-live adoption credential lineage ACL post-image mismatch'
      using errcode = '55000';
  end if;
end;
$exact_qoo10_adoption_lineage_acl_postimage$;

comment on function public.sellerpilot_service_adopt_exact_qoo10_already_live(
  uuid, text, jsonb
) is
  'Adopts one exact already-live Qoo10 listing from fresh CHANGHEE seller-center and public readback without a provider call. Credential lineage is tied to the exact source job creator while seller ownership remains separately fenced.';

commit;
