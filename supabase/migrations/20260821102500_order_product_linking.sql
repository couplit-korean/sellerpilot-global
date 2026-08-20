-- Keep order facts tied to products so dashboard rankings are derived from
-- actual orders instead of stale listing counters.

begin;

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
  v_owner uuid;
  v_order jsonb;
  v_count integer := 0;
  v_ledger_count integer := 0;
  v_external_id text;
  v_status text;
  v_product_id uuid;
  v_product_name text;
begin
  if jsonb_typeof(p_orders) <> 'array'
     or jsonb_array_length(p_orders) > 500
     or octet_length(p_orders::text) > 1000000 then
    raise exception 'invalid normalized orders';
  end if;
  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id=p_credential_id and c.channel=p_channel and c.status in ('active','grace');
  if v_owner is null then raise exception 'active channel credential required'; end if;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    v_external_id := left(trim(coalesce(v_order->>'externalOrderId','')),240);
    v_status := coalesce(v_order->>'status','paid');
    v_product_name := left(coalesce(nullif(trim(v_order->>'productName'),''),'주문 상품'),500);
    if v_external_id='' or v_status not in ('paid','ready_to_ship','shipped','delivered','cancelled','refunded') then continue; end if;
    select p.id into v_product_id
      from sellerpilot_private.products p
     where not p.demo and v_product_name ilike p.name || '%'
     order by length(p.name) desc limit 1;

    insert into sellerpilot_private.commerce_orders (
      owner_id,external_order_id,channel_key,customer_name,product_id,product_name,
      quantity,amount,currency,amount_krw,status,ordered_at,demo,updated_at
    ) values (
      v_owner,v_external_id,p_channel,
      left(coalesce(nullif(trim(v_order->>'customerName'),''),'마켓 구매자'),240),
      v_product_id,v_product_name,
      greatest(1,least(999999,coalesce((v_order->>'quantity')::integer,1))),
      greatest(0,coalesce((v_order->>'amount')::numeric,0)),
      upper(left(coalesce(nullif(trim(v_order->>'currency'),''),'KRW'),3)),
      greatest(0,coalesce((v_order->>'amountKrw')::numeric,0)),
      v_status,coalesce((v_order->>'orderedAt')::timestamptz,now()),false,now()
    ) on conflict (owner_id,channel_key,external_order_id) do update set
      customer_name=excluded.customer_name,
      product_id=coalesce(excluded.product_id,sellerpilot_private.commerce_orders.product_id),
      product_name=excluded.product_name,quantity=excluded.quantity,amount=excluded.amount,
      currency=excluded.currency,amount_krw=excluded.amount_krw,status=excluded.status,
      ordered_at=excluded.ordered_at,demo=false,updated_at=now();
    v_count := v_count + 1;
  end loop;

  select count(*) into v_ledger_count from sellerpilot_private.commerce_orders o
   where o.owner_id=v_owner and o.channel_key=p_channel and not o.demo;
  insert into sellerpilot_private.channel_sync_state (
    owner_id,channel_key,data_type,status,imported_count,last_started_at,last_succeeded_at,last_error,updated_at
  ) values (v_owner,p_channel,'orders','passed',v_ledger_count,now(),now(),null,now())
  on conflict (owner_id,channel_key,data_type) do update set
    status='passed',imported_count=excluded.imported_count,last_succeeded_at=now(),last_error=null,updated_at=now();
  insert into sellerpilot_private.operation_audit (owner_id,action,entity_type,safe_detail)
  values (v_owner,'channel_orders_synced','channel',jsonb_build_object('channel',p_channel,'response_count',v_count,'ledger_count',v_ledger_count));
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) to service_role;

commit;
