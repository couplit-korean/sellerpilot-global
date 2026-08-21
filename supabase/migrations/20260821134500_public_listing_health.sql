-- Persist safe public listing destinations for every deterministic channel and
-- distinguish an existing remote listing from its current public-page health.

begin;

alter table sellerpilot_private.product_listings
  add column if not exists public_page_status text not null default 'unverified'
    check (public_page_status in ('unverified','active','unavailable')),
  add column if not exists public_page_checked_at timestamptz;

update sellerpilot_private.product_listings
   set public_url = case channel_key
     when 'qoo10' then 'https://www.qoo10.jp/g/' || remote_id
     when 'lazada' then case when upper(coalesce(market,'MY'))='MY' then 'https://www.lazada.com.my/products/i' || remote_id || '.html' end
     when 'elevenst' then 'https://www.11st.co.kr/products/' || remote_id
     when 'ebay' then 'https://www.ebay.com/itm/' || remote_id
     when 'temu' then 'https://www.temu.com/goods.html?_bg_fs=1&goods_id=' || remote_id
     else public_url
   end,
       updated_at = now()
 where status = 'published'
   and remote_id is not null
   and trim(remote_id) <> ''
   and public_url is null
   and channel_key in ('qoo10','lazada','elevenst','ebay','temu');

create or replace function public.sellerpilot_service_set_listing_public_page_status(
  p_listing_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if p_status not in ('unverified','active','unavailable') then return false; end if;
  update sellerpilot_private.product_listings
     set public_page_status = p_status,
         public_page_checked_at = now(),
         updated_at = now()
   where id = p_listing_id and public_url is not null;
  return found;
end;
$$;

revoke all on function public.sellerpilot_service_set_listing_public_page_status(uuid,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_set_listing_public_page_status(uuid,text) to service_role;

alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_public_health;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_result jsonb;
begin
  v_result := public.sellerpilot_get_product_publish_context_pre_public_health(p_product_id);
  if v_result is null then return null; end if;
  return jsonb_set(v_result, '{listings}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'channel', l.channel_key, 'market', l.market, 'targetId', l.target_id,
      'remoteId', l.remote_id, 'publicUrl', l.public_url, 'publicPageStatus', l.public_page_status,
      'publicPageCheckedAt', l.public_page_checked_at, 'status', l.status,
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

commit;
