-- 11st is an enabled SellerPilot sales channel even while its Open API service
-- registration is pending. Margin scenarios are manual calculations and can be
-- saved without an API key, so keep the shared calculator's channel set aligned.

begin;

create or replace function public.sellerpilot_save_margin_scenario(
  p_name text, p_channel_key text, p_inputs jsonb, p_result jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.sellerpilot_is_admin()
     or length(trim(coalesce(p_name, ''))) not between 1 and 120
     or p_channel_key not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or jsonb_typeof(p_inputs) <> 'object' or jsonb_typeof(p_result) <> 'object'
     or octet_length(p_inputs::text) > 32768 or octet_length(p_result::text) > 32768 then
    raise exception 'invalid margin scenario';
  end if;
  insert into sellerpilot_private.margin_scenarios (id, owner_id, name, channel_key, inputs, result)
  values (v_id, auth.uid(), trim(p_name), p_channel_key, p_inputs, p_result);
  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'scenario_saved', 'margin_scenario', v_id::text, jsonb_build_object('channel', p_channel_key));
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) to authenticated;

commit;
