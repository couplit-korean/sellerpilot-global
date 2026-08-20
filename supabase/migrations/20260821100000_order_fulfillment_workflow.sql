-- Record external shipment results only after the marketplace confirms the write.

begin;

alter table sellerpilot_private.commerce_orders
  add column if not exists shipping_carrier text,
  add column if not exists tracking_number text,
  add column if not exists last_shipment_at timestamptz,
  add column if not exists last_shipment_error text;

create or replace function public.sellerpilot_get_order_fulfillment_context(p_ids uuid[])
returns table (
  id uuid,
  external_order_id text,
  channel_key text,
  status text
)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select o.id, o.external_order_id, o.channel_key, o.status
    from sellerpilot_private.commerce_orders o
   where public.sellerpilot_is_admin()
     and o.id = any(coalesce(p_ids, array[]::uuid[]))
     and not o.demo
   order by o.ordered_at
   limit 20
$$;

create or replace function public.sellerpilot_record_order_shipment(
  p_id uuid,
  p_carrier text,
  p_tracking text,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_updated integer;
begin
  if not public.sellerpilot_is_admin()
     or length(trim(coalesce(p_carrier, ''))) not between 1 and 40
     or length(trim(coalesce(p_tracking, ''))) not between 1 and 100
     or length(coalesce(p_error, '')) > 500 then
    raise exception 'invalid shipment result' using errcode = '42501';
  end if;

  update sellerpilot_private.commerce_orders
     set shipping_carrier = trim(p_carrier),
         tracking_number = trim(p_tracking),
         status = case when p_success then 'shipped' else status end,
         shipped_at = case when p_success then coalesce(shipped_at, now()) else shipped_at end,
         last_shipment_at = now(),
         last_shipment_error = case when p_success then null else left(coalesce(p_error, 'shipment failed'), 500) end,
         updated_at = now()
   where id = p_id
     and not demo;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
    values (auth.uid(), case when p_success then 'shipment_confirmed' else 'shipment_failed' end, 'order', p_id::text,
      jsonb_build_object('carrier', trim(p_carrier), 'success', p_success));
  end if;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_get_order_fulfillment_context(uuid[]) from public, anon;
revoke all on function public.sellerpilot_record_order_shipment(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.sellerpilot_get_order_fulfillment_context(uuid[]) to authenticated;
grant execute on function public.sellerpilot_record_order_shipment(uuid, text, text, boolean, text) to authenticated;

commit;
