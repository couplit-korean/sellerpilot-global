-- Preserve the Temu marketplace identifiers required for verified shipment
-- confirmation without exposing them through the public operations snapshot.

begin;

alter table sellerpilot_private.commerce_orders
  add column if not exists provider_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_context) = 'object' and octet_length(provider_context::text) <= 32768);

alter function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  rename to sellerpilot_service_ingest_orders_pre_temu_fulfillment;

create or replace function public.sellerpilot_service_ingest_orders(
  p_credential_id uuid,
  p_channel text,
  p_orders jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_count integer;
  v_owner uuid;
  v_order jsonb;
  v_context jsonb;
begin
  v_count := public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(
    p_credential_id,
    p_channel,
    p_orders
  );

  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status in ('active','grace');
  if v_owner is null then
    raise exception 'active channel credential required';
  end if;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    v_context := v_order->'providerContext';
    update sellerpilot_private.commerce_orders o
       set provider_context = case
             when jsonb_typeof(v_context) = 'object'
                  and octet_length(v_context::text) <= 32768
               then v_context
             else o.provider_context
           end,
           last_seen_at = now(),
           delivered_at = case
             when v_order->>'status' = 'delivered' then coalesce(o.delivered_at, now())
             else o.delivered_at
           end,
           updated_at = now()
     where o.owner_id = v_owner
       and o.channel_key = p_channel
       and o.external_order_id = left(trim(coalesce(v_order->>'externalOrderId','')),240)
       and not o.demo;
  end loop;

  return v_count;
end;
$$;

create or replace function public.sellerpilot_get_order_fulfillment_context_v2(p_ids uuid[])
returns table (
  id uuid,
  external_order_id text,
  channel_key text,
  status text,
  provider_context jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select o.id, o.external_order_id, o.channel_key, o.status, o.provider_context
    from sellerpilot_private.commerce_orders o
   where public.sellerpilot_is_admin()
     and o.id = any(coalesce(p_ids, array[]::uuid[]))
     and not o.demo
   order by o.ordered_at
   limit 20
$$;

revoke all on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.sellerpilot_get_order_fulfillment_context_v2(uuid[]) from public,anon;
grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) to service_role;
grant execute on function public.sellerpilot_get_order_fulfillment_context_v2(uuid[]) to authenticated;

commit;
