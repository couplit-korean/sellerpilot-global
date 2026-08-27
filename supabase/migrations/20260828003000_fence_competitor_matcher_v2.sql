-- The v2 matcher rejects collectible-card and promotional-card listings that
-- merely repeat the product name. Keep automatic observations fail-closed by
-- exposing and accepting only rows produced by this exact contract.

begin;

drop index if exists sellerpilot_private.competitor_prices_current_matcher_idx;
create index competitor_prices_current_matcher_idx
  on sellerpilot_private.competitor_price_observations
     (product_id, marketplace, checked_at desc, price, id)
  where provider = 'manual'
     or matcher_version = 'strict-2026-08-28-v2';

do $migration$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
  v_targets constant text[] := array[
    'public.sellerpilot_service_record_competitor_prices(uuid,jsonb)',
    'public.sellerpilot_get_product_operations_v2(uuid)'
  ];
begin
  foreach v_signature in array v_targets loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_rewritten := replace(
      v_definition,
      'strict-2026-08-27-v1',
      'strict-2026-08-28-v2'
    );
    if v_rewritten = v_definition then
      raise exception 'expected competitor matcher version was not found in %', v_signature;
    end if;
    execute v_rewritten;
  end loop;
end;
$migration$;

revoke all on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb)
  to service_role;
revoke all on function public.sellerpilot_get_product_operations_v2(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid)
  to authenticated;

commit;
