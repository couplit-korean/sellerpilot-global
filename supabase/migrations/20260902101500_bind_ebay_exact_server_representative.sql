-- Bind the approved eBay content correction to the server-owned square source.
-- The route now downloads and hashes this exact private Storage object before
-- calculating the request fingerprint. This migration changes only the exact
-- validator and expired-permit rearm contract. It creates no permit or job,
-- does not arm the permit, and never calls eBay.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000007);

do $ebay_exact_server_representative_preimage$
declare
  v_signature regprocedure;
  v_definition text;
  v_old constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_new constant text :=
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e';
begin
  foreach v_signature in array array[
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)'::regprocedure,
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure,
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure,
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
    if pg_catalog.strpos(v_definition, v_old) = 0
       or pg_catalog.strpos(v_definition, v_new) <> 0
       or pg_catalog.strpos(
            v_definition, 'ebay_exact_current_credential_is_valid'
          ) = 0
          and v_signature::text not like
            'sellerpilot_private.ebay_exact_v101_content_arguments_valid%'
          and v_signature::text not like
            'sellerpilot_private.exact_existing_update_arguments_before_temu_173960%'
    then
      raise exception 'eBay server representative preimage mismatch'
        using errcode = '55000', detail = v_signature::text;
    end if;
  end loop;
end;
$ebay_exact_server_representative_preimage$;

do $patch_ebay_exact_server_representative_arguments$
declare
  v_signature regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_new constant text :=
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e';
  v_path_anchor constant text := $old$p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedObjectPath}' ~
          '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'$old$;
  v_path_replacement constant text := $new$p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedObjectPath}' =
          'results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/thumbnail-square.png'$new$;
  v_sha_anchor constant text := $old$p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedSourceSha256}' ~
          '^[a-f0-9]{64}$'$old$;
  v_sha_replacement constant text := $new$p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedSourceSha256}' =
          '1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753'$new$;
begin
  v_signature :=
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure;
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_path_anchor, ''
         ))
     ) / pg_catalog.length(v_path_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_sha_anchor, ''
         ))
     ) / pg_catalog.length(v_sha_anchor) <> 1
  then
    raise exception 'eBay representative validator preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_definition := pg_catalog.replace(
    v_definition, v_path_anchor, v_path_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_sha_anchor, v_sha_replacement
  );
  execute v_definition;
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_old) <> 0
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(
          v_definition,
          'results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/thumbnail-square.png'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          '1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753'
        ) = 0
  then
    raise exception 'eBay representative validator postimage mismatch'
      using errcode = '55000';
  end if;

  v_signature :=
    'sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)'::regprocedure;
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 1
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_v101_content_arguments_valid'
        ) = 0
  then
    raise exception 'eBay representative argument fence preimage mismatch'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_old) <> 0
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_v101_content_arguments_valid'
        ) = 0
  then
    raise exception 'eBay representative argument fence postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_server_representative_arguments$;

do $patch_ebay_exact_server_representative_proof$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_new constant text :=
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e';
  v_pair constant text := $old$'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
               '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'$old$;
  v_triplet constant text := $new$'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
               'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef',
               '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'$new$;
  v_credential_anchor constant text :=
    'and permit.credential_id is distinct from p_credential_id';
  v_credential_replacement constant text := $new$and (
                 permit.credential_id is distinct from p_credential_id
                 or permit.request_fingerprint is distinct from
                      p_request_fingerprint
               )$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 2
  then
    raise exception 'eBay representative proof preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_pair, ''))
     ) / pg_catalog.length(v_pair) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_credential_anchor, ''
         ))
     ) / pg_catalog.length(v_credential_anchor) <> 1
  then
    raise exception 'eBay representative proof permit preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_pair, v_triplet);
  execute pg_catalog.replace(
    v_definition, v_credential_anchor, v_credential_replacement
  );
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(v_definition, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_definition, 'ref.canonical_public_url ~') = 0
     or pg_catalog.strpos(
          v_definition,
          'permit.request_fingerprint is distinct from'
        ) = 0
  then
    raise exception 'eBay representative proof postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_server_representative_proof$;

do $patch_ebay_exact_server_representative_guard$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_new constant text :=
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e';
  v_pair constant text := $old$'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
           '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'$old$;
  v_triplet constant text := $new$'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
           'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef',
           '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 2
  then
    raise exception 'eBay representative guard preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_pair, ''))
     ) / pg_catalog.length(v_pair) <> 1
  then
    raise exception 'eBay representative guard permit preimage mismatch'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_pair, v_triplet);
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(v_definition, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(
          v_definition, 'new.request_fingerprint ='
        ) = 0
  then
    raise exception 'eBay representative guard postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_server_representative_guard$;

do $patch_ebay_exact_server_representative_arm$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_new constant text :=
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e';
  v_pair constant text := $old$'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
           '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'$old$;
  v_triplet constant text := $new$'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
           'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef',
           '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 3
  then
    raise exception 'eBay representative arm preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_pair, ''))
     ) / pg_catalog.length(v_pair) <> 2
  then
    raise exception 'eBay representative arm permit preimage mismatch'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_pair, v_triplet);
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(
          v_definition, 'set request_fingerprint = p_request_fingerprint'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'v_permit.request_fingerprint is distinct from p_request_fingerprint'
        ) = 0
     or pg_catalog.strpos(v_definition, 'ebay_exact_current_credential_is_valid') = 0
  then
    raise exception 'eBay representative arm postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_server_representative_arm$;

revoke all on function
  sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb),
  sellerpilot_private.exact_existing_update_arguments_before_temu_173960(
    text, jsonb, text, text, integer
  ),
  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
    uuid, text, text
  ),
  sellerpilot_private.guard_exact_existing_update_permit_transition(),
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) to service_role;

do $ebay_exact_server_representative_postimage$
declare
  v_validator text;
  v_arguments text;
  v_proof text;
  v_guard text;
  v_arm text;
  v_new constant text :=
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure
  ) into strict v_validator;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)'::regprocedure
  ) into strict v_arguments;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure
  ) into strict v_proof;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into strict v_guard;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into strict v_arm;

  if pg_catalog.strpos(v_validator, v_new) = 0
     or pg_catalog.strpos(v_arguments, v_new) = 0
     or pg_catalog.strpos(v_proof, v_new) = 0
     or pg_catalog.strpos(v_guard, v_new) = 0
     or pg_catalog.strpos(v_arm, v_new) = 0
     or pg_catalog.strpos(
          v_validator,
          'results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/thumbnail-square.png'
        ) = 0
     or pg_catalog.strpos(
          v_validator,
          '1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753'
        ) = 0
     or pg_catalog.strpos(v_proof, 'ref.canonical_public_url ~') = 0
     or pg_catalog.strpos(v_proof, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_guard, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_arm, 'ebay_exact_current_credential_is_valid') = 0
  then
    raise exception 'eBay server representative final postimage mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      join pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) privilege on true
      left join pg_catalog.pg_roles grantee
        on grantee.oid = privilege.grantee
     where (
       namespace.nspname = 'sellerpilot_private'
       and procedure.proname in (
         'ebay_exact_v101_content_arguments_valid',
         'exact_existing_update_arguments_before_temu_173960',
         'ebay_exact_v101_content_rebind_is_proved',
         'guard_exact_existing_update_permit_transition'
       )
       or namespace.nspname = 'public'
       and procedure.proname = 'sellerpilot_service_arm_ebay_no_effect_retry'
     )
       and privilege.privilege_type = 'EXECUTE'
       and coalesce(grantee.rolname, 'PUBLIC') in (
         'PUBLIC', 'anon', 'authenticated'
       )
  ) then
    raise exception 'eBay representative function privilege drift'
      using errcode = '55000';
  end if;
end;
$ebay_exact_server_representative_postimage$;

comment on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) is
  'Arms only eBay listing 800551945442 / offer 244042196011 after the server-owned square path and source SHA have been exact-validated. This migration itself creates no permit or job and never calls eBay.';

commit;
