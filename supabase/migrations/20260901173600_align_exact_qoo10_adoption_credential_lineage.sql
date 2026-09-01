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
  v_definition text;
  v_expected text;
  v_postimage text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
    into strict v_definition;

  if (pg_catalog.length(v_definition) - pg_catalog.length(
        pg_catalog.replace(v_definition, v_old, '')
      )) / pg_catalog.length(v_old) <> 1
     or pg_catalog.strpos(v_definition, v_new) <> 0
  then
    raise exception
      'exact Qoo10 already-live adoption credential lineage pre-image mismatch'
      using errcode = '55000';
  end if;

  v_expected := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_expected;

  select pg_catalog.pg_get_functiondef(v_signature)
    into strict v_postimage;
  if pg_catalog.strpos(v_postimage, v_old) <> 0
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

comment on function public.sellerpilot_service_adopt_exact_qoo10_already_live(
  uuid, text, jsonb
) is
  'Adopts one exact already-live Qoo10 listing from fresh CHANGHEE seller-center and public readback without a provider call. Credential lineage is tied to the exact source job creator while seller ownership remains separately fenced.';

commit;
