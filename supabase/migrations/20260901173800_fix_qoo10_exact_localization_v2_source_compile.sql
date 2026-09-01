-- Compile the existing exact Qoo10 localization v2 source predicate by
-- declaring the two JSON projections it already validates. The full function
-- body, security boundary, owner and ACL are fingerprinted before and after;
-- every other predicate remains byte-for-byte unchanged.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 914400001);

do $fix_qoo10_exact_localization_v2_source_compile$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.qoo10_exact_localization_v2_source_is_current(uuid,text)'::regprocedure;
  v_expected_pre_sha256 constant text :=
    'f754b74e2b961dfe794303a0eefcddc282c4fd5b6151ea55f494cab038b744c4';
  v_expected_post_sha256 constant text :=
    'e717d7faacf36e8ec0fc1ae36045b881ef5f874f6e83ad02d2000f65f6ea43b6';
  v_declaration_anchor constant text :=
    E'  v_arguments jsonb;\nbegin';
  v_declaration_replacement constant text :=
    E'  v_arguments jsonb;\n  v_params jsonb;\n  v_marker jsonb;\nbegin';
  v_assignment_anchor constant text :=
    E'  v_arguments := v_job.request_payload->''arguments'';\n\n  if';
  v_assignment_replacement constant text :=
    E'  v_arguments := v_job.request_payload->''arguments'';\n  v_params := v_arguments->''params'';\n  v_marker := v_arguments->''sellerpilotQoo10ExactLocalization'';\n\n  if';
  v_definition text;
  v_prosrc text;
  v_metadata jsonb;
  v_after_definition text;
  v_after_prosrc text;
  v_after_metadata jsonb;
begin
  select
    pg_catalog.pg_get_functiondef(proc.oid),
    proc.prosrc,
    jsonb_build_object(
      'owner', proc.proowner::text,
      'ownerName', pg_catalog.pg_get_userbyid(proc.proowner),
      'language', lang.lanname,
      'volatility', proc.provolatile,
      'securityDefiner', proc.prosecdef,
      'config', to_jsonb(proc.proconfig),
      'acl', to_jsonb(proc.proacl)
    )
    into v_definition, v_prosrc, v_metadata
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_language lang on lang.oid = proc.prolang
   where proc.oid = v_signature;

  if encode(extensions.digest(v_prosrc, 'sha256'), 'hex')
       is distinct from v_expected_pre_sha256
     or v_metadata->>'language' is distinct from 'plpgsql'
     or v_metadata->>'ownerName' is distinct from 'postgres'
     or v_metadata->>'volatility' is distinct from 's'
     or (v_metadata->>'securityDefiner')::boolean is distinct from true
     or v_metadata->'config' is distinct from '["search_path=\"\""]'::jsonb
     or v_metadata->'acl' is distinct from '["postgres=X/postgres"]'::jsonb
     or (
       pg_catalog.length(v_prosrc)
       - pg_catalog.length(pg_catalog.replace(
           v_prosrc, v_declaration_anchor, ''
         ))
     ) / pg_catalog.length(v_declaration_anchor) <> 1
     or (
       pg_catalog.length(v_prosrc)
       - pg_catalog.length(pg_catalog.replace(
           v_prosrc, v_assignment_anchor, ''
         ))
     ) / pg_catalog.length(v_assignment_anchor) <> 1
  then
    raise exception 'Qoo10 localization v2 source predicate preimage invalid'
      using errcode = '55000';
  end if;

  v_after_definition := pg_catalog.replace(
    pg_catalog.replace(
      v_definition,
      v_declaration_anchor,
      v_declaration_replacement
    ),
    v_assignment_anchor,
    v_assignment_replacement
  );
  if v_after_definition = v_definition then
    raise exception 'Qoo10 localization v2 source predicate rewrite missed'
      using errcode = '55000';
  end if;
  execute v_after_definition;

  select
    proc.prosrc,
    jsonb_build_object(
      'owner', proc.proowner::text,
      'ownerName', pg_catalog.pg_get_userbyid(proc.proowner),
      'language', lang.lanname,
      'volatility', proc.provolatile,
      'securityDefiner', proc.prosecdef,
      'config', to_jsonb(proc.proconfig),
      'acl', to_jsonb(proc.proacl)
    )
    into v_after_prosrc, v_after_metadata
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_language lang on lang.oid = proc.prolang
   where proc.oid = v_signature;

  if encode(extensions.digest(v_after_prosrc, 'sha256'), 'hex')
       is distinct from v_expected_post_sha256
     or v_after_metadata is distinct from v_metadata
     or (
       pg_catalog.length(v_after_prosrc)
       - pg_catalog.length(pg_catalog.replace(
           v_after_prosrc, E'  v_params jsonb;', ''
         ))
     ) / pg_catalog.length(E'  v_params jsonb;') <> 1
     or (
       pg_catalog.length(v_after_prosrc)
       - pg_catalog.length(pg_catalog.replace(
           v_after_prosrc, E'  v_marker jsonb;', ''
         ))
     ) / pg_catalog.length(E'  v_marker jsonb;') <> 1
     or (
       pg_catalog.length(v_after_prosrc)
       - pg_catalog.length(pg_catalog.replace(
           v_after_prosrc,
           E'  v_params := v_arguments->''params'';',
           ''
         ))
     ) / pg_catalog.length(
       E'  v_params := v_arguments->''params'';'
     ) <> 1
     or (
       pg_catalog.length(v_after_prosrc)
       - pg_catalog.length(pg_catalog.replace(
           v_after_prosrc,
           E'  v_marker := v_arguments->''sellerpilotQoo10ExactLocalization'';',
           ''
         ))
     ) / pg_catalog.length(
       E'  v_marker := v_arguments->''sellerpilotQoo10ExactLocalization'';'
     ) <> 1
  then
    raise exception 'Qoo10 localization v2 source predicate postimage invalid'
      using errcode = '55000';
  end if;
end;
$fix_qoo10_exact_localization_v2_source_compile$;

notify pgrst, 'reload schema';

commit;
