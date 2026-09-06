-- Follow-up to 20260905012000. Do not rewrite that applied history.
-- Opaque sb_secret_* keys execute as the service_role database role but do
-- not populate request.jwt.claim.role. EXECUTE grants remain the boundary.
-- This migration does not GET the provider, does not POST, does not rewrite
-- job b9faa28e, and does not apply a live listing bind.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 501210);

do $elevenst_cookie_create_legacy_jwt$
declare
  v_definition text;
  v_before text;
  v_after text;
  v_hits integer;
  v_signature text;
begin
  v_signature :=
    'public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)';
  select pg_catalog.pg_get_functiondef(v_signature::regprocedure)
    into v_definition;
  v_before := $status_jwt$coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
     or $status_jwt$;
  v_after := '';
  v_hits := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before);
  if v_hits is distinct from 1 then
    raise exception '11st cookie create recovery status jwt guard is not unique'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);

  v_signature :=
    'public.sellerpilot_service_record_elevenst_cookie_create_observation(uuid,text,text,integer,integer,boolean,boolean,text)';
  select pg_catalog.pg_get_functiondef(v_signature::regprocedure)
    into v_definition;
  v_before := $record_jwt$  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
  then
    raise exception 'exact 11st cookie create observation denied'
      using errcode = '42501';
  end if;
$record_jwt$;
  v_after := '';
  v_hits := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before);
  if v_hits is distinct from 1 then
    raise exception '11st cookie create observation jwt guard is not unique'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);

  v_signature :=
    'public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)';
  select pg_catalog.pg_get_functiondef(v_signature::regprocedure)
    into v_definition;
  v_before := $bind_jwt$  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
  then
    raise exception 'exact 11st cookie create bind denied'
      using errcode = '42501';
  end if;
$bind_jwt$;
  v_after := '';
  v_hits := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / pg_catalog.length(v_before);
  if v_hits is distinct from 1 then
    raise exception '11st cookie create bind jwt guard is not unique'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);

  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)'::regprocedure
       ),
       'request.jwt.claim.role'
     ) > 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.sellerpilot_service_record_elevenst_cookie_create_observation(uuid,text,text,integer,integer,boolean,boolean,text)'::regprocedure
       ),
       'request.jwt.claim.role'
     ) > 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)'::regprocedure
       ),
       'request.jwt.claim.role'
     ) > 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)'::regprocedure
       ),
       '1ed4acfc-7603-48ec-a638-241131e59358'
     ) = 0
  then
    raise exception '11st cookie create jwt guard patch drifted'
      using errcode = '55000';
  end if;
end;
$elevenst_cookie_create_legacy_jwt$;

revoke all on function
  public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)
  from public, anon, authenticated;
revoke all on function
  public.sellerpilot_service_record_elevenst_cookie_create_observation(
    uuid, text, text, integer, integer, boolean, boolean, text
  ) from public, anon, authenticated;
revoke all on function
  public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)
  to service_role;
grant execute on function
  public.sellerpilot_service_record_elevenst_cookie_create_observation(
    uuid, text, text, integer, integer, boolean, boolean, text
  ) to service_role;
grant execute on function
  public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)
  to service_role;

commit;
