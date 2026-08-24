-- Keep shipment failures auditable even when a marketplace does not provide a
-- tracking number. This helper cannot mark an order shipped or write tracking
-- data; only the authenticated-admin RPC may persist a confirmed shipment.

begin;

create or replace function public.sellerpilot_service_record_order_shipment_failure(
  p_actor_id uuid,
  p_id uuid,
  p_carrier text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_updated integer;
begin
  if p_actor_id is null
     or not exists (
       select 1
         from sellerpilot_private.admin_users a
        where a.user_id = p_actor_id
     )
     or p_id is null
     or length(trim(coalesce(p_carrier, ''))) not between 1 and 40
     or length(trim(coalesce(p_error, ''))) not between 1 and 500 then
    raise exception 'invalid shipment failure record' using errcode = '42501';
  end if;

  update sellerpilot_private.commerce_orders
     set shipping_carrier = trim(p_carrier),
         last_shipment_at = now(),
         last_shipment_error = left(trim(p_error), 500),
         updated_at = now()
   where id = p_id
     and not demo;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    insert into sellerpilot_private.operation_audit (
      owner_id,
      action,
      entity_type,
      entity_id,
      safe_detail
    ) values (
      p_actor_id,
      'shipment_failed',
      'order',
      p_id::text,
      jsonb_build_object(
        'carrier', trim(p_carrier),
        'success', false,
        'tracking_recorded', false,
        'source', 'admin_fulfillment_route'
      )
    );
  end if;

  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_service_record_order_shipment_failure(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_record_order_shipment_failure(uuid, uuid, text, text)
  to service_role;

commit;
