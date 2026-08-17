-- Opaque sb_secret_* keys execute RPCs as the service_role database role but
-- do not populate the legacy request.jwt.claim.role GUC. EXECUTE grants are
-- the authorization boundary, matching the other SellerPilot service RPCs.

begin;

do $migration$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
  v_guard constant text := E'  if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then\n    raise exception ''service role required'' using errcode = ''42501'';\n  end if;\n';
  v_targets constant text[] := array[
    'public.sellerpilot_service_store_channel_oauth_state(uuid,uuid,text,text)',
    'public.sellerpilot_service_claim_channel_oauth_state(uuid,text,text)'
  ];
begin
  foreach v_signature in array v_targets loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_rewritten := replace(v_definition, v_guard, '');
    if v_rewritten = v_definition then
      raise exception 'expected legacy role guard was not found in %', v_signature;
    end if;
    execute v_rewritten;
  end loop;
end;
$migration$;

revoke all on function public.sellerpilot_service_store_channel_oauth_state(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_channel_oauth_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_store_channel_oauth_state(uuid, uuid, text, text) to service_role;
grant execute on function public.sellerpilot_service_claim_channel_oauth_state(uuid, text, text) to service_role;

commit;
