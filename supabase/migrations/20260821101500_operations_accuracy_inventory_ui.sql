-- Make operational counters action-oriented, derive sales from the order ledger,
-- and expose one audited inventory workflow to every approved administrator.

begin;

alter table sellerpilot_private.product_listings
  add column if not exists failure_class text default 'retryable'
    check (failure_class in ('retryable', 'external_action'));

update sellerpilot_private.product_listings
   set failure_class = case
     when status = 'failed' and coalesce(last_error, '') ~* '(permission|권한|카테고리|category|attribute|속성|인증 대상|certification|partner does not have permission|feature.toggle|직접 입력 필요)'
       then 'external_action'
     else 'retryable'
   end
 where status = 'failed';

-- Link existing aggregated order names back to their product ledger. Coupang
-- appends option text to the registered product name, so longest prefix wins.
update sellerpilot_private.commerce_orders o
   set product_id = (
         select p.id from sellerpilot_private.products p
          where not p.demo and o.product_name ilike p.name || '%'
          order by length(p.name) desc limit 1
       ),
       updated_at = now()
 where o.product_id is null
   and exists (
     select 1 from sellerpilot_private.products p
      where not p.demo and o.product_name ilike p.name || '%'
   );

alter function public.sellerpilot_get_operations_snapshot()
  rename to sellerpilot_get_operations_snapshot_pre_accuracy;

create or replace function public.sellerpilot_get_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_get_operations_snapshot_pre_accuracy();

  v_result := jsonb_set(v_result, '{channelMetrics}', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'channelKey', c.key, 'channelCode', c.code, 'name', c.name,
      'market', c.market, 'color', c.color, 'channelStatus', c.status,
      'credentialStatus', coalesce(cr.status, 'missing'), 'credentialExpiresAt', cr.expires_at,
      'productCount', coalesce(pm.product_count, 0), 'publishedCount', coalesce(pm.published_count, 0),
      'sold30d', coalesce(om.sold_30d, 0), 'revenue30dKrw', coalesce(om.revenue_30d_krw, 0),
      'orderCount', coalesce(om.order_count, 0), 'readyToShipCount', coalesce(om.ready_to_ship_count, 0),
      'openTicketCount', coalesce(tm.open_ticket_count, 0),
      'failedAttemptCount', coalesce(fm.failed_count, 0), 'lastOperationAt', am.last_operation_at
    ) order by c.sort_order), '[]'::jsonb)
      from sellerpilot_private.channels c
      left join lateral (
        select cc.status, cc.expires_at from sellerpilot_private.channel_credentials cc
         where cc.channel = c.key and cc.environment = 'production' and cc.status = 'active'
         order by cc.version desc limit 1
      ) cr on true
      left join lateral (
        select count(distinct pl.product_id)::integer product_count,
               count(*) filter (where pl.status = 'published')::integer published_count
          from sellerpilot_private.product_listings pl
          join sellerpilot_private.products p on p.id = pl.product_id
         where pl.channel_key = c.key and not p.demo
      ) pm on true
      left join lateral (
        select coalesce(sum(o.quantity) filter (where o.ordered_at >= now() - interval '30 days' and o.status not in ('cancelled','refunded')), 0)::integer sold_30d,
               coalesce(sum(o.amount_krw) filter (where o.ordered_at >= now() - interval '30 days' and o.status not in ('cancelled','refunded')), 0) revenue_30d_krw,
               count(*)::integer order_count,
               count(*) filter (where o.status = 'ready_to_ship')::integer ready_to_ship_count
          from sellerpilot_private.commerce_orders o
         where o.channel_key = c.key and not o.demo
      ) om on true
      left join lateral (
        select count(*) filter (where t.status <> 'resolved')::integer open_ticket_count
          from sellerpilot_private.support_tickets t where t.channel_key = c.key and not t.demo
      ) tm on true
      left join lateral (
        select count(*)::integer failed_count
          from sellerpilot_private.product_listings pl
          join sellerpilot_private.products p on p.id = pl.product_id
         where pl.channel_key = c.key and pl.status = 'failed' and pl.failure_class = 'retryable' and not p.demo
      ) fm on true
      left join lateral (
        select max(a.started_at) last_operation_at from sellerpilot_private.channel_operation_attempts a where a.channel = c.key
      ) am on true
     where c.status <> 'disabled'
  ), true);

  v_result := jsonb_set(v_result, '{products}', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'externalCode', p.external_code, 'sku', p.sku, 'name', p.name,
      'description', p.description, 'sourceUrl', p.source_url, 'imageUrl', p.image_url,
      'aiHeroPath', coalesce(aj.result_payload->'asset_storage_paths'->>'hero', aj.result_payload->>'hero_storage_path'),
      'status', p.status, 'onHand', p.on_hand, 'reserved', p.reserved,
      'available', p.on_hand - p.reserved, 'costKrw', p.cost_krw,
      'sold30d', coalesce(os.sold, 0), 'revenue30dKrw', coalesce(os.revenue, 0),
      'listingChannels', coalesce(ls.channel_codes, '[]'::jsonb), 'demo', false,
      'updatedAt', p.updated_at
    ) order by coalesce(os.sold, 0) desc, p.updated_at desc), '[]'::jsonb)
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs aj on aj.id = p.ai_job_id
      left join lateral (
        select coalesce(sum(o.quantity), 0)::integer sold, coalesce(sum(o.amount_krw), 0) revenue
          from sellerpilot_private.commerce_orders o
         where o.product_id = p.id and not o.demo and o.ordered_at >= now() - interval '30 days'
           and o.status not in ('cancelled','refunded')
      ) os on true
      left join lateral (
        select jsonb_agg(c.code order by c.sort_order) channel_codes
          from sellerpilot_private.product_listings pl
          join sellerpilot_private.channels c on c.key = pl.channel_key
         where pl.product_id = p.id and pl.status = 'published'
      ) ls on true
     where p.status <> 'archived' and not p.demo
  ), true);

  v_result := jsonb_set(v_result, '{pipeline}', jsonb_build_object(
    'aiRunning', (select count(*) from sellerpilot_private.ai_cli_jobs where status in ('queued','claimed','running')),
    'listingQueued', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id=pl.product_id where pl.status in ('draft','queued') and not p.demo),
    'listingPublished', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id=pl.product_id where pl.status='published' and not p.demo),
    'listingFailed', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id=pl.product_id where pl.status='failed' and pl.failure_class='retryable' and not p.demo),
    'listingBlocked', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id=pl.product_id where pl.status='failed' and pl.failure_class='external_action' and not p.demo)
  ), true);

  v_result := jsonb_set(v_result, '{summary}', jsonb_build_object(
    'revenue30dKrw', coalesce((select sum(amount_krw) from sellerpilot_private.commerce_orders where not demo and ordered_at >= now()-interval '30 days' and status not in ('cancelled','refunded')),0),
    'sold30d', coalesce((select sum(quantity) from sellerpilot_private.commerce_orders where not demo and ordered_at >= now()-interval '30 days' and status not in ('cancelled','refunded')),0),
    'orderCount', (select count(*) from sellerpilot_private.commerce_orders where not demo),
    'paidOrderCount', (select count(*) from sellerpilot_private.commerce_orders where status='paid' and not demo),
    'readyToShipCount', (select count(*) from sellerpilot_private.commerce_orders where status='ready_to_ship' and not demo),
    'openTicketCount', (select count(*) from sellerpilot_private.support_tickets where status<>'resolved' and not demo),
    'lowStockCount', (select count(*) from sellerpilot_private.products where on_hand-reserved<=reorder_point and status<>'archived' and not demo),
    'productCount', (select count(*) from sellerpilot_private.products where status<>'archived' and not demo),
    'registrationErrorCount', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id=pl.product_id where pl.status='failed' and pl.failure_class='retryable' and not p.demo),
    'registrationBlockedCount', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id=pl.product_id where pl.status='failed' and pl.failure_class='external_action' and not p.demo),
    'activeCredentialCount', (
      select count(distinct channel)
        from sellerpilot_private.channel_credentials
       where environment = 'production'
         and status = 'active'
         and last_check_status = 'passed'
         and (expires_at is null or expires_at > now())
    ),
    'registeredCredentialCount', (
      select count(distinct channel)
        from sellerpilot_private.channel_credentials
       where environment = 'production'
         and status = 'active'
         and (expires_at is null or expires_at > now())
    )
  ), true);
  return v_result;
end;
$$;

alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_inventory;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_result jsonb;
begin
  v_result := public.sellerpilot_get_product_publish_context_pre_inventory(p_product_id);
  if v_result is null then return null; end if;
  return jsonb_set(v_result, '{listings}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'channel', l.channel_key, 'market', l.market, 'targetId', l.target_id,
      'remoteId', l.remote_id, 'status', l.status, 'currency', l.currency, 'price', l.price,
      'lastError', l.last_error, 'failureClass', l.failure_class,
      'inventorySyncStatus', l.inventory_sync_status,
      'lastInventoryQuantity', l.last_inventory_quantity,
      'inventorySyncError', l.inventory_sync_error,
      'lastInventorySyncedAt', l.last_inventory_synced_at,
      'updatedAt', l.updated_at
    ) order by l.channel_key,l.market,l.target_id)
      from sellerpilot_private.product_listings l
     where l.product_id=p_product_id
  ), '[]'::jsonb), true);
end;
$$;

revoke all on function public.sellerpilot_get_operations_snapshot() from public, anon;
revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public, anon;
grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;

commit;
