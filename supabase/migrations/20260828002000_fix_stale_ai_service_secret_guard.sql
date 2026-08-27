-- Opaque Supabase sb_secret_* keys execute RPCs as the service_role database
-- role but do not populate the legacy request.jwt.claim.role GUC. EXECUTE
-- privileges are the authorization boundary for this SECURITY DEFINER RPC.

begin;

do $migration$
declare
  v_signature constant text :=
    'public.sellerpilot_service_expire_stale_ai_jobs(timestamptz,integer)';
  v_definition text;
  v_rewritten text;
  v_guard constant text := E'  if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then\n    raise exception ''service role required'' using errcode = ''42501'';\n  end if;\n';
begin
  select pg_get_functiondef(v_signature::regprocedure) into v_definition;
  v_rewritten := replace(v_definition, v_guard, '');
  if v_rewritten = v_definition then
    raise exception 'expected legacy role guard was not found in %', v_signature;
  end if;
  execute v_rewritten;
end;
$migration$;

revoke all on function
  public.sellerpilot_service_expire_stale_ai_jobs(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_expire_stale_ai_jobs(timestamptz, integer)
  to service_role;

commit;
