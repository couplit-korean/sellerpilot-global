-- Accept both Supabase/PostgREST role-claim GUC formats while rejecting
-- missing, malformed, or contradictory claims on the three registration RPCs.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900703150);

create or replace function sellerpilot_private.request_has_unambiguous_service_role_claim()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_legacy_role text := nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  v_claims_text text := nullif(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  );
  v_json_role text;
begin
  if v_claims_text is not null then
    begin
      if pg_catalog.jsonb_typeof(v_claims_text::jsonb) <> 'object' then
        return false;
      end if;
      v_json_role := nullif((v_claims_text::jsonb)->>'role', '');
    exception when others then
      return false;
    end;
    if v_json_role is null then
      return false;
    end if;
  end if;

  if v_legacy_role is not null and v_legacy_role <> 'service_role' then
    return false;
  end if;
  if v_json_role is not null and v_json_role <> 'service_role' then
    return false;
  end if;

  return coalesce(
    v_legacy_role = 'service_role' or v_json_role = 'service_role',
    false
  );
end;
$$;

revoke all on function sellerpilot_private.request_has_unambiguous_service_role_claim()
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_signature text;
  v_oid oid;
  v_definition text;
  v_updated_definition text;
  v_occurrences integer;
  v_old_guard constant text :=
    $guard$if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then$guard$;
  v_new_guard constant text :=
    $guard$if not sellerpilot_private.request_has_unambiguous_service_role_claim() then$guard$;
begin
  foreach v_signature in array array[
    'public.sellerpilot_service_get_product_registration_draft(uuid,uuid,text)',
    'public.sellerpilot_service_put_product_registration_draft(uuid,uuid,text,uuid,bigint,jsonb)',
    'public.sellerpilot_service_get_product_registration_context(uuid,uuid)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_oid is null then
      raise exception 'PRODUCT_REGISTRATION_ROLE_CLAIMS_TARGET_MISSING: %', v_signature;
    end if;

    select pg_catalog.pg_get_functiondef(v_oid) into strict v_definition;
    v_occurrences := (
      pg_catalog.char_length(v_definition)
      - pg_catalog.char_length(pg_catalog.replace(v_definition, v_old_guard, ''))
    ) / pg_catalog.char_length(v_old_guard);
    if v_occurrences <> 1 then
      raise exception 'PRODUCT_REGISTRATION_ROLE_CLAIMS_GUARD_DRIFT: % (% occurrences)',
        v_signature, v_occurrences;
    end if;

    v_updated_definition := pg_catalog.replace(v_definition, v_old_guard, v_new_guard);
    execute v_updated_definition;

    select pg_catalog.pg_get_functiondef(v_oid) into strict v_definition;
    v_occurrences := (
      pg_catalog.char_length(v_definition)
      - pg_catalog.char_length(pg_catalog.replace(v_definition, v_new_guard, ''))
    ) / pg_catalog.char_length(v_new_guard);
    if pg_catalog.strpos(v_definition, v_old_guard) <> 0 or v_occurrences <> 1 then
      raise exception 'PRODUCT_REGISTRATION_ROLE_CLAIMS_REWRITE_FAILED: %', v_signature;
    end if;
  end loop;
end;
$migration$;

revoke all on function public.sellerpilot_service_get_product_registration_draft(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_put_product_registration_draft(uuid, uuid, text, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_get_product_registration_context(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.sellerpilot_service_get_product_registration_draft(uuid, uuid, text)
  to service_role;
grant execute on function public.sellerpilot_service_put_product_registration_draft(uuid, uuid, text, uuid, bigint, jsonb)
  to service_role;
grant execute on function public.sellerpilot_service_get_product_registration_context(uuid, uuid)
  to service_role;

commit;
