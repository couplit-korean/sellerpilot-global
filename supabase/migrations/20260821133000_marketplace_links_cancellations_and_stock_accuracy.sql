-- Keep the public sale-page identity separate from provider management IDs,
-- preserve paid-order facts when a cancellation feed only carries status, and
-- expose one consistent low-stock calculation to every screen.

begin;

alter table sellerpilot_private.product_listings
  add column if not exists public_url text
    check (public_url is null or (length(public_url) <= 1000 and public_url ~ '^https://'));

create or replace function public.sellerpilot_service_set_listing_public_url(
  p_listing_id uuid,
  p_public_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_channel text;
  v_url text := left(trim(coalesce(p_public_url, '')), 1000);
begin
  select channel_key into v_channel
    from sellerpilot_private.product_listings
   where id = p_listing_id;
  if v_channel is null or v_url = '' or v_url !~ '^https://' then return false; end if;
  if v_channel = 'coupang' and v_url !~ '^https://(www\.)?coupang\.com/vp/products/[0-9]+' then return false; end if;
  if v_channel = 'smartstore' and v_url !~ '^https://smartstore\.naver\.com/' then return false; end if;
  if v_channel not in ('coupang', 'smartstore') then return false; end if;
  update sellerpilot_private.product_listings
     set public_url = v_url, updated_at = now()
   where id = p_listing_id;
  return found;
end;
$$;

revoke all on function public.sellerpilot_service_set_listing_public_url(uuid,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_set_listing_public_url(uuid,text) to service_role;

-- Recover exact public IDs already observed during verified inventory readback.
with resolved as (
  select distinct on (l.id)
    l.id,
    'https://smartstore.naver.com/main/products/' ||
      (jsonb_path_query_first(g.response_payload, '$.steps[*].data.smartstoreChannelProductNo') #>> '{}') as public_url
  from sellerpilot_private.product_listings l
  join sellerpilot_private.channel_gateway_jobs g
    on g.channel = 'smartstore'
   and g.operation = 'inventory.update'
   and g.request_payload->'arguments'->>'originProductNo' = l.remote_id
  where l.channel_key = 'smartstore'
    and l.status = 'published'
    and jsonb_path_query_first(g.response_payload, '$.steps[*].data.smartstoreChannelProductNo') is not null
  order by l.id, g.created_at desc
)
update sellerpilot_private.product_listings l
   set public_url = r.public_url, updated_at = now()
  from resolved r
 where l.id = r.id;

with resolved as (
  select distinct on (l.id)
    l.id,
    'https://www.coupang.com/vp/products/' ||
      (jsonb_path_query_first(g.response_payload, '$.steps[*].data.data.productId') #>> '{}') ||
      '?vendorItemId=' ||
      (jsonb_path_query_first(g.response_payload, '$.steps[*].data.data.items[*].vendorItemId') #>> '{}') as public_url
  from sellerpilot_private.product_listings l
  join sellerpilot_private.channel_gateway_jobs g
    on g.channel = 'coupang'
   and g.operation = 'inventory.update'
   and g.request_payload->'arguments'->>'sellerProductId' = l.remote_id
  where l.channel_key = 'coupang'
    and l.status = 'published'
    and jsonb_path_query_first(g.response_payload, '$.steps[*].data.data.productId') is not null
    and jsonb_path_query_first(g.response_payload, '$.steps[*].data.data.items[*].vendorItemId') is not null
  order by l.id, g.created_at desc
)
update sellerpilot_private.product_listings l
   set public_url = r.public_url, updated_at = now()
  from resolved r
 where l.id = r.id;

alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_public_url;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_result jsonb;
begin
  v_result := public.sellerpilot_get_product_publish_context_pre_public_url(p_product_id);
  if v_result is null then return null; end if;
  return jsonb_set(v_result, '{listings}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'channel', l.channel_key, 'market', l.market, 'targetId', l.target_id,
      'remoteId', l.remote_id, 'publicUrl', l.public_url, 'status', l.status,
      'currency', l.currency, 'price', l.price, 'lastError', l.last_error,
      'failureClass', l.failure_class, 'inventorySyncStatus', l.inventory_sync_status,
      'lastInventoryQuantity', l.last_inventory_quantity,
      'inventorySyncError', l.inventory_sync_error,
      'lastInventorySyncedAt', l.last_inventory_synced_at, 'updatedAt', l.updated_at
    ) order by l.channel_key,l.market,l.target_id)
      from sellerpilot_private.product_listings l
     where l.product_id = p_product_id
  ), '[]'::jsonb), true);
end;
$$;

revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public,anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;

alter function public.sellerpilot_get_operations_snapshot()
  rename to sellerpilot_get_operations_snapshot_pre_stock_accuracy;

create or replace function public.sellerpilot_get_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_get_operations_snapshot_pre_stock_accuracy();
  v_result := jsonb_set(v_result, '{products}', coalesce((
    select jsonb_agg(
      product_row.value || jsonb_build_object(
        'reorderPoint', p.reorder_point,
        'status', case
          when p.on_hand - p.reserved <= 0 then 'out_of_stock'
          when p.on_hand - p.reserved <= p.reorder_point then 'low_stock'
          else p.status
        end
      ) order by product_row.ordinality
    )
      from jsonb_array_elements(coalesce(v_result->'products','[]'::jsonb)) with ordinality product_row(value, ordinality)
      join sellerpilot_private.products p on p.id = (product_row.value->>'id')::uuid
  ), '[]'::jsonb), true);
  v_result := jsonb_set(v_result, '{listingIssues}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'productId', p.id, 'productName', p.name, 'channelKey', l.channel_key,
      'market', l.market, 'failureClass', l.failure_class,
      'message', left(coalesce(l.last_error,'등록 실패 원인을 확인해 주세요.'),500),
      'updatedAt', l.updated_at
    ) order by l.updated_at desc)
      from sellerpilot_private.product_listings l
      join sellerpilot_private.products p on p.id = l.product_id
     where l.status = 'failed' and not p.demo
  ), '[]'::jsonb), true);
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_get_operations_snapshot() from public,anon;
grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;

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
  v_quantity integer;
  v_amount numeric;
  v_amount_krw numeric;
  v_currency text;
  v_listing_price numeric;
  v_listing_currency text;
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

    v_product_id := null;
    select p.id into v_product_id
      from sellerpilot_private.products p
     where not p.demo and v_product_name ilike p.name || '%'
     order by length(p.name) desc limit 1;

    v_quantity := greatest(1,least(999999,coalesce((v_order->>'quantity')::integer,1)));
    v_amount := greatest(0,coalesce((v_order->>'amount')::numeric,0));
    v_amount_krw := greatest(0,coalesce((v_order->>'amountKrw')::numeric,0));
    v_currency := upper(left(coalesce(nullif(trim(v_order->>'currency'),''),'KRW'),3));

    if v_amount = 0 and v_product_id is not null and v_status not in ('cancelled','refunded') then
      v_listing_price := null;
      v_listing_currency := null;
      select l.price, l.currency into v_listing_price, v_listing_currency
        from sellerpilot_private.product_listings l
       where l.owner_id=v_owner and l.product_id=v_product_id and l.channel_key=p_channel
         and l.status='published' and l.price>0
       order by l.updated_at desc limit 1;
      if v_listing_price is not null then
        v_amount := v_listing_price * v_quantity;
        v_currency := upper(left(coalesce(nullif(trim(v_listing_currency),''),'KRW'),3));
        if v_currency='KRW' then v_amount_krw := v_amount; end if;
      end if;
    end if;

    insert into sellerpilot_private.commerce_orders (
      owner_id,external_order_id,channel_key,customer_name,product_id,product_name,
      quantity,amount,currency,amount_krw,status,ordered_at,demo,updated_at
    ) values (
      v_owner,v_external_id,p_channel,
      left(coalesce(nullif(trim(v_order->>'customerName'),''),'마켓 구매자'),240),
      v_product_id,v_product_name,v_quantity,v_amount,v_currency,v_amount_krw,
      v_status,coalesce((v_order->>'orderedAt')::timestamptz,now()),false,now()
    ) on conflict (owner_id,channel_key,external_order_id) do update set
      customer_name=case when excluded.customer_name in ('쿠팡 구매자','마켓 구매자') then sellerpilot_private.commerce_orders.customer_name else excluded.customer_name end,
      product_id=coalesce(excluded.product_id,sellerpilot_private.commerce_orders.product_id),
      product_name=case when excluded.product_name in ('쿠팡 취소 상품','주문 상품') then sellerpilot_private.commerce_orders.product_name else excluded.product_name end,
      quantity=case when excluded.status in ('cancelled','refunded') then sellerpilot_private.commerce_orders.quantity else excluded.quantity end,
      amount=case when excluded.status in ('cancelled','refunded') and excluded.amount=0 then sellerpilot_private.commerce_orders.amount else excluded.amount end,
      currency=case when excluded.status in ('cancelled','refunded') and excluded.amount=0 then sellerpilot_private.commerce_orders.currency else excluded.currency end,
      amount_krw=case when excluded.status in ('cancelled','refunded') and excluded.amount_krw=0 then sellerpilot_private.commerce_orders.amount_krw else excluded.amount_krw end,
      status=excluded.status,
      ordered_at=case when excluded.status in ('cancelled','refunded') then sellerpilot_private.commerce_orders.ordered_at else excluded.ordered_at end,
      demo=false,updated_at=now();
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
