-- PostgreSQL silently stored the 65-byte Qoo10 adoption identity RPC under
-- its 63-byte truncated identifier. Direct SQL also truncates the requested
-- name, masking the problem, while PostgREST requires the exact stored name.
-- Rename both adoption RPCs to short, explicit service-role-only names without
-- changing their OIDs, bodies, owners, arguments, or provider fences.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917368001);

do $qoo10_adopted_short_rpc_preimage$
declare
  v_identity_signature constant regprocedure :=
    'public.sellerpilot_service_get_exact_qoo10_adopted_localization_identi(uuid,uuid,uuid,text,text)'::regprocedure;
  v_arm_signature constant regprocedure :=
    'public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(uuid,uuid,text,text,text,text)'::regprocedure;
  v_identity_name constant text :=
    'sellerpilot_service_get_qoo10_adopted_localization_identity';
  v_arm_name constant text :=
    'sellerpilot_service_arm_qoo10_adopted_localization_update';
  v_identity_sha256 constant text :=
    '68aabb874e63e8ebf690b86f9f8fe324d33729edbb7dd26678d5a02fa8486f86';
  v_arm_sha256 constant text :=
    '194611a4d9a74a4797644bbc66c1793b6614a2a3edd33500656de4011d579aad';
  v_identity_metadata jsonb;
  v_arm_metadata jsonb;
begin
  select jsonb_build_object(
           'oid', proc.oid::text,
           'name', proc.proname,
           'owner', pg_catalog.pg_get_userbyid(proc.proowner),
           'language', language.lanname,
           'volatility', proc.provolatile,
           'kind', proc.prokind,
           'securityDefiner', proc.prosecdef,
           'config', to_jsonb(proc.proconfig),
           'acl', to_jsonb(proc.proacl),
           'prosrcSha256', pg_catalog.encode(
             extensions.digest(proc.prosrc, 'sha256'), 'hex'
           )
         )
    into strict v_identity_metadata
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_language language on language.oid = proc.prolang
   where proc.oid = v_identity_signature;

  select jsonb_build_object(
           'oid', proc.oid::text,
           'name', proc.proname,
           'owner', pg_catalog.pg_get_userbyid(proc.proowner),
           'language', language.lanname,
           'volatility', proc.provolatile,
           'kind', proc.prokind,
           'securityDefiner', proc.prosecdef,
           'config', to_jsonb(proc.proconfig),
           'acl', to_jsonb(proc.proacl),
           'prosrcSha256', pg_catalog.encode(
             extensions.digest(proc.prosrc, 'sha256'), 'hex'
           )
         )
    into strict v_arm_metadata
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_language language on language.oid = proc.prolang
   where proc.oid = v_arm_signature;

  if pg_catalog.octet_length(
       'sellerpilot_service_get_exact_qoo10_adopted_localization_identi'
     ) <> 63
     or pg_catalog.octet_length(v_identity_name) > 63
     or pg_catalog.octet_length(v_arm_name) > 63
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_get_qoo10_adopted_localization_identity(uuid,uuid,uuid,text,text)'
        ) is not null
     or pg_catalog.to_regprocedure(
          'public.sellerpilot_service_arm_qoo10_adopted_localization_update(uuid,uuid,text,text,text,text)'
        ) is not null
     or v_identity_metadata->>'name' is distinct from
          'sellerpilot_service_get_exact_qoo10_adopted_localization_identi'
     or v_arm_metadata->>'name' is distinct from
          'sellerpilot_service_arm_exact_qoo10_adopted_localization_update'
     or v_identity_metadata->>'owner' is distinct from 'postgres'
     or v_arm_metadata->>'owner' is distinct from 'postgres'
     or v_identity_metadata->>'language' is distinct from 'plpgsql'
     or v_arm_metadata->>'language' is distinct from 'plpgsql'
     or v_identity_metadata->>'volatility' is distinct from 'v'
     or v_arm_metadata->>'volatility' is distinct from 'v'
     or v_identity_metadata->>'kind' is distinct from 'f'
     or v_arm_metadata->>'kind' is distinct from 'f'
     or (v_identity_metadata->>'securityDefiner')::boolean is distinct from true
     or (v_arm_metadata->>'securityDefiner')::boolean is distinct from true
     or v_identity_metadata->'config' is distinct from
          '["search_path=\"\""]'::jsonb
     or v_arm_metadata->'config' is distinct from
          '["search_path=\"\""]'::jsonb
     or v_identity_metadata->'acl' is distinct from
          '["postgres=X/postgres", "service_role=X/postgres"]'::jsonb
     or v_arm_metadata->'acl' is distinct from
          '["postgres=X/postgres", "service_role=X/postgres"]'::jsonb
     or v_identity_metadata->>'prosrcSha256' is distinct from
          v_identity_sha256
     or v_arm_metadata->>'prosrcSha256' is distinct from v_arm_sha256
  then
    raise exception 'Qoo10 adopted localization short RPC preimage invalid'
      using errcode = '55000';
  end if;
end;
$qoo10_adopted_short_rpc_preimage$;

alter function
  public.sellerpilot_service_get_exact_qoo10_adopted_localization_identi(
    uuid, uuid, uuid, text, text
  ) rename to sellerpilot_service_get_qoo10_adopted_localization_identity;

alter function
  public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ) rename to sellerpilot_service_arm_qoo10_adopted_localization_update;

revoke all on function
  public.sellerpilot_service_get_qoo10_adopted_localization_identity(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_arm_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ) from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_get_qoo10_adopted_localization_identity(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_arm_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ) to service_role;

do $qoo10_adopted_short_rpc_postimage$
declare
  v_identity_signature constant regprocedure :=
    'public.sellerpilot_service_get_qoo10_adopted_localization_identity(uuid,uuid,uuid,text,text)'::regprocedure;
  v_arm_signature constant regprocedure :=
    'public.sellerpilot_service_arm_qoo10_adopted_localization_update(uuid,uuid,text,text,text,text)'::regprocedure;
  v_identity_sha256 constant text :=
    '68aabb874e63e8ebf690b86f9f8fe324d33729edbb7dd26678d5a02fa8486f86';
  v_arm_sha256 constant text :=
    '194611a4d9a74a4797644bbc66c1793b6614a2a3edd33500656de4011d579aad';
  v_invalid boolean;
begin
  select pg_catalog.to_regprocedure(
           'public.sellerpilot_service_get_exact_qoo10_adopted_localization_identi(uuid,uuid,uuid,text,text)'
         ) is not null
      or pg_catalog.to_regprocedure(
           'public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(uuid,uuid,text,text,text,text)'
         ) is not null
      or exists (
        select 1
          from pg_catalog.pg_proc proc
          join pg_catalog.pg_language language on language.oid = proc.prolang
         where proc.oid in (v_identity_signature, v_arm_signature)
           and (
             pg_catalog.octet_length(proc.proname) > 63
             or pg_catalog.pg_get_userbyid(proc.proowner) <> 'postgres'
             or language.lanname <> 'plpgsql'
             or proc.provolatile <> 'v'
             or proc.prokind <> 'f'
             or not proc.prosecdef
             or proc.proconfig is distinct from
                  array['search_path=""']::text[]
             or proc.proacl is distinct from
                  array[
                    'postgres=X/postgres',
                    'service_role=X/postgres'
                  ]::aclitem[]
             or pg_catalog.encode(
                  extensions.digest(proc.prosrc, 'sha256'), 'hex'
                ) is distinct from case proc.oid
                  when v_identity_signature then v_identity_sha256
                  when v_arm_signature then v_arm_sha256
                end
           )
      )
      or (select count(*) from pg_catalog.pg_proc proc
           where proc.oid in (v_identity_signature, v_arm_signature)) <> 2
      or pg_catalog.has_function_privilege(
           'anon', v_identity_signature, 'EXECUTE'
         )
      or pg_catalog.has_function_privilege(
           'authenticated', v_identity_signature, 'EXECUTE'
         )
      or not pg_catalog.has_function_privilege(
           'service_role', v_identity_signature, 'EXECUTE'
         )
      or pg_catalog.has_function_privilege(
           'anon', v_arm_signature, 'EXECUTE'
         )
      or pg_catalog.has_function_privilege(
           'authenticated', v_arm_signature, 'EXECUTE'
         )
      or not pg_catalog.has_function_privilege(
           'service_role', v_arm_signature, 'EXECUTE'
         )
    into v_invalid;

  if v_invalid then
    raise exception 'Qoo10 adopted localization short RPC postimage invalid'
      using errcode = '55000';
  end if;
end;
$qoo10_adopted_short_rpc_postimage$;

comment on function
  public.sellerpilot_service_get_qoo10_adopted_localization_identity(
    uuid, uuid, uuid, text, text
  ) is
  'PostgREST-safe exact Qoo10 adopted-localization identity; service role only.';

comment on function
  public.sellerpilot_service_arm_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ) is
  'PostgREST-safe exact Qoo10 adopted-localization permit arm; service role only and performs no provider call.';

notify pgrst, 'reload schema';

commit;
