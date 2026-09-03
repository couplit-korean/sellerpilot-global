-- Stabilize the one approved eBay content correction across expiring Storage
-- signed URLs and rotations inside the already-verified seller lineage. This
-- migration changes no permit row, creates no job and never calls eBay. The
-- existing expired, unbound permit can move to the new fingerprint only when
-- the service-role arm RPC is called with the sole current credential.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000006);

do $ebay_exact_stable_fingerprint_preimage$
declare
  v_signature regprocedure;
  v_definition text;
  v_old constant text :=
    'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231';
  v_new constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
begin
  foreach v_signature in array array[
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
    if (
         pg_catalog.length(v_definition)
         - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
       ) / pg_catalog.length(v_old) <> 1
       or pg_catalog.strpos(v_definition, v_new) <> 0
    then
      raise exception 'eBay stable content validator preimage mismatch'
        using errcode = '55000', detail = v_signature::text;
    end if;
  end loop;

  foreach v_signature in array array[
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
    then
      raise exception 'eBay stable permit preimage mismatch'
        using errcode = '55000', detail = v_signature::text;
    end if;
  end loop;
end;
$ebay_exact_stable_fingerprint_preimage$;

do $patch_ebay_exact_stable_content_validators$
declare
  v_signature regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231';
  v_new constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
begin
  foreach v_signature in array array[
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
      into strict v_definition, v_owner
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature;
    execute pg_catalog.replace(v_definition, v_old, v_new);
    select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
      into strict v_definition, v_post_owner
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature;
    if v_post_owner is distinct from v_owner
       or pg_catalog.strpos(v_definition, v_old) <> 0
       or pg_catalog.strpos(v_definition, v_new) = 0
       or (
         pg_catalog.strpos(
           v_definition, 'ebay_exact_v101_content_arguments_valid'
         ) = 0
         and v_signature::text like
           'sellerpilot_private.exact_existing_update_arguments_before_temu_173960%'
       )
    then
      raise exception 'eBay stable content validator postimage mismatch'
        using errcode = '55000', detail = v_signature::text;
    end if;
  end loop;
end;
$patch_ebay_exact_stable_content_validators$;

do $patch_ebay_exact_stable_rearm_proof$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231';
  v_new constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_permit_anchor constant text :=
    'and permit.request_fingerprint = p_request_fingerprint';
  v_permit_replacement constant text := $new$and permit.request_fingerprint in (
               'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
               'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
             )$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_permit_anchor, ''
         ))
     ) / pg_catalog.length(v_permit_anchor) <> 1
  then
    raise exception 'eBay stable rearm proof permit preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_definition := pg_catalog.replace(
    v_definition, v_permit_anchor, v_permit_replacement
  );
  execute v_definition;
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(
          v_definition,
          'permit.request_fingerprint = p_request_fingerprint'
        ) <> 0
     or pg_catalog.strpos(
          v_definition,
          'ref.canonical_public_url ~'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a[.]jpg$'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_current_credential_is_valid'
        ) = 0
  then
    raise exception 'eBay stable rearm proof postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_stable_rearm_proof$;

do $patch_ebay_exact_stable_permit_transition$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_start integer;
  v_end integer;
  v_tail text;
  v_end_marker constant text := E'  then return new; end if;\n\n';
  v_prior_start constant text := $old$  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.request_fingerprint =
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'$old$;
  v_transition constant text := $new$  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.request_fingerprint in (
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
           'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
         )
     and new.request_fingerprint =
           'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
     and new.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and sellerpilot_private.exact_existing_update_release_is_current(
           'ebay', new.release_sha
         )
     and old.update_job_id is null and old.update_attempt_id is null
     and old.arguments_sha256 is null and old.arguments_bytes is null
     and old.request_payload_sha256 is null
     and old.request_payload_bytes is null
     and old.bound_at is null and old.bound_worker_token_id is null
     and old.bound_claim_token is null and old.consumed_at is null
     and old.invalidated_at is null and old.invalidation_reason is null
     and old.expires_at <= statement_timestamp()
     and new.armed_at = statement_timestamp()
     and new.expires_at = new.armed_at + interval '5 minutes'
     and sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
           new.credential_id, new.release_sha, new.request_fingerprint
         )
     and exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.id = new.credential_id
          and credential.channel = 'ebay'
          and credential.environment = 'production'
          and credential.status = 'active'
          and credential.seller_account_key = old.seller_account_key
          and credential.seller_account_key_source = 'provider_certified_v1'
          and credential.seller_account_verified_at =
                new.credential_verified_at
          and credential.expires_at is not distinct from
                new.credential_expires_at
          and credential.last_checked_at is not distinct from
                new.credential_last_checked_at
          and credential.last_check_status is not distinct from
                new.credential_last_check_status
          and credential.version = new.credential_version
          and credential.fingerprint = new.credential_fingerprint
          and credential.seller_account_key_source =
                new.credential_account_source
          and sellerpilot_private.ebay_exact_current_credential_is_valid(
                credential.id, old.seller_account_key
              )
     )
     and to_jsonb(new) - array[
           'armed_at', 'expires_at', 'credential_id',
           'credential_version', 'credential_fingerprint',
           'credential_account_source', 'credential_verified_at',
           'credential_expires_at', 'credential_last_checked_at',
           'credential_last_check_status', 'release_sha',
           'request_fingerprint'
         ] is not distinct from
         to_jsonb(old) - array[
           'armed_at', 'expires_at', 'credential_id',
           'credential_version', 'credential_fingerprint',
           'credential_account_source', 'credential_verified_at',
           'credential_expires_at', 'credential_last_checked_at',
           'credential_last_check_status', 'release_sha',
           'request_fingerprint'
         ]
  then return new; end if;

$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  v_start := pg_catalog.strpos(v_definition, v_prior_start);
  v_tail := pg_catalog.substr(v_definition, v_start);
  v_end := pg_catalog.strpos(v_tail, v_end_marker);
  if v_start = 0 or v_end = 0 then
    raise exception 'eBay stable permit transition preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1)
    || v_transition
    || pg_catalog.substr(
         v_tail, v_end + pg_catalog.length(v_end_marker)
       );
  execute v_definition;
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(
          v_definition, 'and old.request_fingerprint in ('
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'and new.request_fingerprint ='
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_current_credential_is_valid'
        ) = 0
  then
    raise exception 'eBay stable permit transition postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_stable_permit_transition$;

do $patch_ebay_exact_stable_arm$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231';
  v_new constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_permit_anchor constant text :=
    'and permit.request_fingerprint = p_request_fingerprint';
  v_permit_replacement constant text := $new$and permit.request_fingerprint in (
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
           'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
         )$new$;
  v_set_anchor constant text := $old$set credential_id = p_credential_id,$old$;
  v_set_replacement constant text := $new$set request_fingerprint = p_request_fingerprint,
         credential_id = p_credential_id,$new$;
  v_active_anchor constant text := $old$if v_permit.expires_at > statement_timestamp() then
    if v_permit.credential_id is distinct from p_credential_id$old$;
  v_active_replacement constant text := $new$if v_permit.expires_at > statement_timestamp() then
    if v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.credential_id is distinct from p_credential_id$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_permit_anchor, ''
         ))
     ) / pg_catalog.length(v_permit_anchor) <> 2
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_set_anchor, ''
         ))
     ) / pg_catalog.length(v_set_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_active_anchor, ''
         ))
     ) / pg_catalog.length(v_active_anchor) <> 1
  then
    raise exception 'eBay stable arm preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_definition := pg_catalog.replace(
    v_definition, v_permit_anchor, v_permit_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_set_anchor, v_set_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_active_anchor, v_active_replacement
  );
  execute v_definition;
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_new) = 0
     or pg_catalog.strpos(
          v_definition,
          'set request_fingerprint = p_request_fingerprint'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'v_permit.request_fingerprint is distinct from p_request_fingerprint'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_current_credential_is_valid'
        ) = 0
  then
    raise exception 'eBay stable arm postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_stable_arm$;

revoke all on function
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

do $ebay_exact_stable_fingerprint_postimage$
declare
  v_validator text;
  v_arguments text;
  v_lazada_arguments text;
  v_coupang_arguments text;
  v_proof text;
  v_guard text;
  v_arm text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure
  ) into strict v_validator;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)'::regprocedure
  ) into strict v_arguments;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(text,jsonb,text,text,integer)'::regprocedure
  ) into strict v_lazada_arguments;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure
  ) into strict v_coupang_arguments;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure
  ) into strict v_proof;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into strict v_guard;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into strict v_arm;

  if pg_catalog.strpos(
       v_validator,
       'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
     ) = 0
     or pg_catalog.strpos(
       v_arguments,
       'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
     ) = 0
     or pg_catalog.strpos(
       v_arguments, 'ebay_exact_v101_content_arguments_valid'
     ) = 0
     or pg_catalog.strpos(
       v_lazada_arguments, 'exact_existing_update_arguments_before_temu_173960'
     ) = 0
     or pg_catalog.strpos(
       v_coupang_arguments, 'sp_173990_exact_args_pre'
     ) = 0
     or pg_catalog.strpos(
       v_proof,
       'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
     ) = 0
     or pg_catalog.strpos(
       v_guard,
       'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
     ) = 0
     or pg_catalog.strpos(
       v_arm,
       'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
     ) = 0
     or pg_catalog.strpos(v_proof, 'ref.canonical_public_url ~') = 0
     or pg_catalog.strpos(
       v_proof,
       '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a[.]jpg$'
     ) = 0
     or pg_catalog.strpos(v_proof, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_guard, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_arm, 'ebay_exact_current_credential_is_valid') = 0
  then
    raise exception 'eBay stable fingerprint final postimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_stable_fingerprint_postimage$;

comment on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) is
  'Arms only eBay listing 800551945442 / offer 244042196011 with the stable approved-content fingerprint and the sole current provider-certified credential. The migration itself never arms or calls the provider.';

commit;
