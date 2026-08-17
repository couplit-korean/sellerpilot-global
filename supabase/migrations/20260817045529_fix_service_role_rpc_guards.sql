begin;

-- Supabase's current sb_secret_* keys are opaque API keys. The gateway maps
-- them to the service_role database role, but it does not populate the legacy
-- request.jwt.claim.role GUC. These RPCs are already executable only by
-- service_role, so the duplicate in-body JWT/GUC check rejected legitimate
-- backend calls without adding an authorization boundary.
do $migration$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
  v_guard constant text := E'  if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then\n    raise exception ''service role required'' using errcode = ''42501'';\n  end if;\n';
  v_targets constant text[] := array[
    'public.sellerpilot_decrypt_credential(uuid)',
    'public.sellerpilot_record_credential_test(uuid,text,text)',
    'public.sellerpilot_get_active_credential_secret(text,text)',
    'public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamptz)',
    'public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)',
    'public.sellerpilot_service_refresh_shopee(uuid,jsonb,timestamptz)',
    'public.sellerpilot_service_complete_channel_operation(uuid,text,integer,text,text)',
    'public.sellerpilot_claim_ai_job(text,text)',
    'public.sellerpilot_complete_ai_job(text,uuid,text,jsonb,text)',
    'public.sellerpilot_prune_ai_jobs(timestamptz,integer)',
    'public.sellerpilot_touch_ai_job(text,uuid,text)'
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

  v_signature := 'public.sellerpilot_service_complete_product_listing(uuid,uuid,text,boolean,text,text)';
  select pg_get_functiondef(v_signature::regprocedure) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role''\n     or p_operation not in (''listing.create'', ''listing.update'', ''listing.stop'')\n     or length(coalesce(p_remote_id, '''')) > 240\n     or length(coalesce(p_safe_message, '''')) > 1000 then\n    raise exception ''service role required'' using errcode = ''42501'';\n  end if;\n',
    E'  if p_operation not in (''listing.create'', ''listing.update'', ''listing.stop'')\n     or length(coalesce(p_remote_id, '''')) > 240\n     or length(coalesce(p_safe_message, '''')) > 1000 then\n    raise exception ''invalid listing completion request'';\n  end if;\n'
  );
  if v_rewritten = v_definition then
    raise exception 'expected legacy role guard was not found in %', v_signature;
  end if;
  execute v_rewritten;
end;
$migration$;

-- Reassert the real authorization boundary explicitly. Revoking PUBLIC is
-- essential because PostgreSQL grants new functions EXECUTE to PUBLIC by
-- default, including SECURITY DEFINER functions.
revoke all on function public.sellerpilot_decrypt_credential(uuid) from public, anon, authenticated;
revoke all on function public.sellerpilot_record_credential_test(uuid, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_get_active_credential_secret(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_refresh_lazada(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_refresh_ebay(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_refresh_shopee(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_channel_operation(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_claim_ai_job(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_prune_ai_jobs(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.sellerpilot_touch_ai_job(text, uuid, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_product_listing(uuid, uuid, text, boolean, text, text) from public, anon, authenticated;

grant execute on function public.sellerpilot_decrypt_credential(uuid) to service_role;
grant execute on function public.sellerpilot_record_credential_test(uuid, text, text) to service_role;
grant execute on function public.sellerpilot_get_active_credential_secret(text, text) to service_role;
grant execute on function public.sellerpilot_service_refresh_lazada(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.sellerpilot_service_refresh_ebay(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.sellerpilot_service_refresh_shopee(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.sellerpilot_service_complete_channel_operation(uuid, text, integer, text, text) to service_role;
grant execute on function public.sellerpilot_claim_ai_job(text, text) to service_role;
grant execute on function public.sellerpilot_complete_ai_job(text, uuid, text, jsonb, text) to service_role;
grant execute on function public.sellerpilot_prune_ai_jobs(timestamptz, integer) to service_role;
grant execute on function public.sellerpilot_touch_ai_job(text, uuid, text) to service_role;
grant execute on function public.sellerpilot_service_complete_product_listing(uuid, uuid, text, boolean, text, text) to service_role;

commit;
