-- Supply the product list with the remote identifiers required for safe,
-- channel-aware marketplace links. The private listing ledger remains hidden;
-- authenticated administrators only receive their own published rows.

begin;
create or replace function public.sellerpilot_list_published_product_destinations()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'productId', l.product_id,
    'channelKey', l.channel_key,
    'channelCode', c.code,
    'remoteId', l.remote_id,
    'market', l.market,
    'targetId', l.target_id
  ) order by l.product_id, c.sort_order, l.market, l.target_id), '[]'::jsonb)
    from sellerpilot_private.product_listings l
    join sellerpilot_private.products p on p.id = l.product_id
    join sellerpilot_private.channels c on c.key = l.channel_key
   where public.sellerpilot_is_admin()
     and l.owner_id = auth.uid()
     and p.owner_id = auth.uid()
     and l.status = 'published'
     and nullif(trim(coalesce(l.remote_id, '')), '') is not null
     and p.status <> 'archived'
     and not p.demo
$$;
revoke all on function public.sellerpilot_list_published_product_destinations() from public, anon;
grant execute on function public.sellerpilot_list_published_product_destinations() to authenticated;
commit;
