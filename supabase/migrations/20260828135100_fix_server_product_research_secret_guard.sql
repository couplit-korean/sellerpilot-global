-- Opaque Supabase sb_secret_* keys execute RPCs as the service_role database
-- role but do not populate the legacy request.jwt.claim.role GUC. Keep the
-- four Vercel product-research RPCs service-only through exact EXECUTE grants.

begin;

do $migration$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
  v_guard constant text := E'  if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then\n    raise exception ''service role required'' using errcode = ''42501'';\n  end if;\n';
  v_targets constant text[] := array[
    'public.sellerpilot_service_claim_product_research_ai_job(text)',
    'public.sellerpilot_service_touch_product_research_ai_job(uuid,uuid)',
    'public.sellerpilot_service_complete_product_research_ai_job(uuid,uuid,jsonb)',
    'public.sellerpilot_service_release_product_research_ai_job(uuid,uuid,text,boolean,integer)'
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

revoke all on function public.sellerpilot_service_claim_product_research_ai_job(text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_touch_product_research_ai_job(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_release_product_research_ai_job(uuid, uuid, text, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_claim_product_research_ai_job(text)
  to service_role;
grant execute on function public.sellerpilot_service_touch_product_research_ai_job(uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.sellerpilot_service_release_product_research_ai_job(uuid, uuid, text, boolean, integer)
  to service_role;

comment on function public.sellerpilot_service_claim_product_research_ai_job(text) is
  'Claims exactly one product_research job for the Vercel OIDC runtime; authorization is the service_role EXECUTE grant.';

commit;
