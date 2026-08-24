-- Domestic and single-market listings store an empty market code while their
-- confirmed category assignment keeps a human-readable provider market label
-- (for example "Korea · Open API" or "Japan · QAPI"). Prefer an exact market
-- match for multi-market channels, and fall back to the channel assignment
-- only when the listing itself has no market code.

begin;
create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if not exists(select 1 from sellerpilot_private.products p where p.id=p_product_id and not p.demo) then return null; end if;
  return (select jsonb_build_object(
    'aiJobId',p.ai_job_id,
    'supplierName',p.supplier_name,
    'comparisonMemo',p.comparison_memo,
    'competitorQuery',coalesce(nullif(p.competitor_query,''),p.name),
    'competitorMonitorEnabled',p.competitor_monitor_enabled,
    'competitorCheckedAt',p.competitor_checked_at,
    'listings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'channel',l.channel_key,'channelCode',c.code,'market',l.market,'targetId',l.target_id,
      'status',l.status,'remoteId',l.remote_id,'marketplaceSku',l.marketplace_sku,
      'inventoryQuantity',l.last_inventory_quantity,'inventoryStatus',l.inventory_sync_status,
      'inventoryError',l.inventory_sync_error,'inventorySyncedAt',l.last_inventory_synced_at,
      'categoryId',a.category_id,'categoryPath',a.category_path,'categoryStatus',a.status,
      'sold30d',coalesce(s.sold,0),'revenue30dKrw',coalesce(s.revenue,0)
    ) order by c.sort_order,l.market,l.target_id)
      from sellerpilot_private.product_listings l
      join sellerpilot_private.channels c on c.key=l.channel_key
      left join lateral (
        select ca.category_id,ca.category_path,ca.status
        from sellerpilot_private.product_category_assignments ca
        where ca.product_id=p.id
          and ca.channel=l.channel_key
          and (ca.market=l.market or ca.market='' or l.market='')
        order by (ca.market=l.market) desc,(ca.market='') desc,ca.updated_at desc
        limit 1
      ) a on true
      left join lateral (select sum(o.quantity)::integer sold,sum(o.amount_krw) revenue from sellerpilot_private.commerce_orders o
        where o.product_id=p.id and o.channel_key=l.channel_key and not o.demo and o.status not in ('cancelled','refunded') and o.ordered_at>=now()-interval '30 days') s on true
      where l.product_id=p.id),'[]'::jsonb),
    'competitorPrices',coalesce((select jsonb_agg(x.item order by x.price,x.checked_at desc) from (
      select jsonb_build_object('id',cp.id,'title',cp.title,'url',cp.product_url,'imageUrl',cp.image_url,'mallName',cp.mall_name,'price',cp.price,'currency',cp.currency,'checkedAt',cp.checked_at) item,
        cp.price,cp.checked_at from sellerpilot_private.competitor_price_observations cp where cp.product_id=p.id order by cp.checked_at desc,cp.price limit 5
    ) x),'[]'::jsonb)
  ) from sellerpilot_private.products p where p.id=p_product_id);
end;
$$;
create or replace function public.sellerpilot_list_external_listing_actions()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'listingId',l.id,
      'productId',p.id,
      'productCode',p.external_code,
      'productName',p.name,
      'sku',p.sku,
      'channel',l.channel_key,
      'channelCode',c.code,
      'channelName',c.name,
      'market',l.market,
      'targetId',l.target_id,
      'message',coalesce(l.last_error,'판매자센터에서 상품 정보 또는 판매 권한을 확인해 주세요.'),
      'categoryId',a.category_id,
      'categoryPath',a.category_path,
      'updatedAt',l.updated_at
    ) order by l.updated_at desc)
    from sellerpilot_private.product_listings l
    join sellerpilot_private.products p on p.id=l.product_id and not p.demo
    join sellerpilot_private.channels c on c.key=l.channel_key
    left join lateral (
      select ca.category_id,ca.category_path
      from sellerpilot_private.product_category_assignments ca
      where ca.product_id=p.id
        and ca.channel=l.channel_key
        and (ca.market=l.market or ca.market='' or l.market='')
      order by (ca.market=l.market) desc,(ca.market='') desc,ca.updated_at desc
      limit 1
    ) a on true
    where l.status='failed' and l.failure_class='external_action'
  ),'[]'::jsonb);
end;
$$;
-- Coupang and Smartstore expose the exact public sale-page identity during a
-- verified inventory read. Persist that identity at gateway completion so new
-- listings do not depend on a one-time repair migration or a browser timeout.
create or replace function sellerpilot_private.capture_listing_public_url_from_inventory()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_remote_id text;
  v_product_id text;
  v_vendor_item_id text;
  v_channel_product_no text;
  v_public_url text;
begin
  if new.status <> 'succeeded'
     or new.operation <> 'inventory.update'
     or jsonb_typeof(new.response_payload) <> 'object' then
    return new;
  end if;

  if new.channel = 'smartstore' then
    v_remote_id := nullif(trim(new.request_payload->'arguments'->>'originProductNo'), '');
    v_channel_product_no := jsonb_path_query_first(
      new.response_payload,
      '$.steps[*].data.smartstoreChannelProductNo'
    ) #>> '{}';
    if v_remote_id is not null and v_channel_product_no ~ '^[0-9]+$' then
      v_public_url := 'https://smartstore.naver.com/main/products/' || v_channel_product_no;
    end if;
  elsif new.channel = 'coupang' then
    v_remote_id := nullif(trim(new.request_payload->'arguments'->>'sellerProductId'), '');
    v_product_id := jsonb_path_query_first(
      new.response_payload,
      '$.steps[*].data.data.productId'
    ) #>> '{}';
    v_vendor_item_id := jsonb_path_query_first(
      new.response_payload,
      '$.steps[*].data.data.items[*].vendorItemId'
    ) #>> '{}';
    if v_remote_id is not null
       and v_product_id ~ '^[0-9]+$'
       and v_vendor_item_id ~ '^[0-9]+$' then
      v_public_url := 'https://www.coupang.com/vp/products/' || v_product_id ||
        '?vendorItemId=' || v_vendor_item_id;
    end if;
  end if;

  if v_public_url is not null then
    update sellerpilot_private.product_listings
       set public_url = v_public_url,
           updated_at = now()
     where channel_key = new.channel
       and remote_id = v_remote_id
       and status in ('published', 'paused');
  end if;
  return new;
end;
$$;
drop trigger if exists capture_listing_public_url_from_inventory
  on sellerpilot_private.channel_gateway_jobs;
create trigger capture_listing_public_url_from_inventory
after update of status, response_payload
on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.capture_listing_public_url_from_inventory();
revoke all on function sellerpilot_private.capture_listing_public_url_from_inventory()
  from public, anon, authenticated;
-- Repair exact sale-page links already observed before the trigger existed.
with resolved as (
  select distinct on (l.id)
    l.id,
    'https://smartstore.naver.com/main/products/' ||
      (jsonb_path_query_first(g.response_payload, '$.steps[*].data.smartstoreChannelProductNo') #>> '{}') as public_url
  from sellerpilot_private.product_listings l
  join sellerpilot_private.channel_gateway_jobs g
    on g.channel = 'smartstore'
   and g.operation = 'inventory.update'
   and g.status = 'succeeded'
   and g.request_payload->'arguments'->>'originProductNo' = l.remote_id
  where l.channel_key = 'smartstore'
    and l.status in ('published', 'paused')
    and (jsonb_path_query_first(g.response_payload, '$.steps[*].data.smartstoreChannelProductNo') #>> '{}') ~ '^[0-9]+$'
  order by l.id, g.created_at desc
)
update sellerpilot_private.product_listings l
   set public_url = r.public_url,
       updated_at = now()
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
   and g.status = 'succeeded'
   and g.request_payload->'arguments'->>'sellerProductId' = l.remote_id
  where l.channel_key = 'coupang'
    and l.status in ('published', 'paused')
    and (jsonb_path_query_first(g.response_payload, '$.steps[*].data.data.productId') #>> '{}') ~ '^[0-9]+$'
    and (jsonb_path_query_first(g.response_payload, '$.steps[*].data.data.items[*].vendorItemId') #>> '{}') ~ '^[0-9]+$'
  order by l.id, g.created_at desc
)
update sellerpilot_private.product_listings l
   set public_url = r.public_url,
       updated_at = now()
  from resolved r
 where l.id = r.id;
commit;

