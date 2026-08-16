-- Replace the former demo-first snapshot with live operational aggregates only.

begin;

create or replace function public.sellerpilot_get_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generatedAt', now(),
    'channels', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb)
      from sellerpilot_private.channels c
    ),
    'channelMetrics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'channelKey', c.key,
        'channelCode', c.code,
        'name', c.name,
        'market', c.market,
        'color', c.color,
        'channelStatus', c.status,
        'credentialStatus', coalesce(cr.status, 'missing'),
        'credentialExpiresAt', cr.expires_at,
        'productCount', coalesce(pm.product_count, 0),
        'publishedCount', coalesce(pm.published_count, 0),
        'sold30d', coalesce(pm.sold_30d, 0),
        'revenue30dKrw', coalesce(pm.revenue_30d_krw, 0),
        'orderCount', coalesce(om.order_count, 0),
        'readyToShipCount', coalesce(om.ready_to_ship_count, 0),
        'openTicketCount', coalesce(tm.open_ticket_count, 0),
        'failedAttemptCount', coalesce(am.failed_attempt_count, 0),
        'lastOperationAt', am.last_operation_at
      ) order by c.sort_order), '[]'::jsonb)
      from sellerpilot_private.channels c
      left join lateral (
        select cc.status, cc.expires_at
        from sellerpilot_private.channel_credentials cc
        where cc.channel = c.key and cc.environment = 'production' and cc.status = 'active'
        order by cc.version desc
        limit 1
      ) cr on true
      left join lateral (
        select count(distinct pl.product_id)::integer product_count,
               count(*) filter (where pl.status = 'published')::integer published_count,
               coalesce(sum(pl.sold_30d), 0)::integer sold_30d,
               coalesce(sum(pl.revenue_30d_krw), 0) revenue_30d_krw
        from sellerpilot_private.product_listings pl
        join sellerpilot_private.products p on p.id = pl.product_id
        where pl.owner_id = v_user and pl.channel_key = c.key and not p.demo
      ) pm on true
      left join lateral (
        select count(*)::integer order_count,
               count(*) filter (where o.status = 'ready_to_ship')::integer ready_to_ship_count
        from sellerpilot_private.commerce_orders o
        where o.owner_id = v_user and o.channel_key = c.key and not o.demo
      ) om on true
      left join lateral (
        select count(*) filter (where t.status <> 'resolved')::integer open_ticket_count
        from sellerpilot_private.support_tickets t
        where t.owner_id = v_user and t.channel_key = c.key and not t.demo
      ) tm on true
      left join lateral (
        select count(*) filter (where a.status in ('failed', 'manual_required'))::integer failed_attempt_count,
               max(a.started_at) last_operation_at
        from sellerpilot_private.channel_operation_attempts a
        where a.owner_id = v_user and a.channel = c.key
      ) am on true
      where c.status <> 'disabled'
    ),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'externalCode', p.external_code, 'sku', p.sku, 'name', p.name,
        'description', p.description, 'sourceUrl', p.source_url, 'imageUrl', p.image_url,
        'aiHeroPath', coalesce(aj.result_payload->'asset_storage_paths'->>'hero', aj.result_payload->>'hero_storage_path'),
        'status', p.status, 'onHand', p.on_hand, 'reserved', p.reserved,
        'available', p.on_hand - p.reserved, 'costKrw', p.cost_krw,
        'sold30d', coalesce(l.sold, 0), 'revenue30dKrw', coalesce(l.revenue, 0),
        'listingChannels', coalesce(l.channel_codes, '[]'::jsonb), 'demo', false,
        'updatedAt', p.updated_at
      ) order by coalesce(l.sold, 0) desc, p.updated_at desc), '[]'::jsonb)
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs aj on aj.id = p.ai_job_id
      left join lateral (
        select sum(pl.sold_30d)::integer sold,
               sum(pl.revenue_30d_krw) revenue,
               jsonb_agg(c.code order by c.sort_order) channel_codes
        from sellerpilot_private.product_listings pl
        join sellerpilot_private.channels c on c.key = pl.channel_key
        where pl.product_id = p.id and pl.owner_id = v_user
      ) l on true
      where p.owner_id = v_user and p.status <> 'archived' and not p.demo
    ),
    'orders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'externalOrderId', o.external_order_id, 'channelKey', o.channel_key,
        'channelCode', c.code, 'customerName', o.customer_name, 'productName', o.product_name,
        'quantity', o.quantity, 'amount', o.amount, 'currency', o.currency,
        'amountKrw', o.amount_krw, 'status', o.status, 'orderedAt', o.ordered_at,
        'updatedAt', o.updated_at, 'demo', false
      ) order by o.ordered_at desc), '[]'::jsonb)
      from sellerpilot_private.commerce_orders o
      join sellerpilot_private.channels c on c.key = o.channel_key
      where o.owner_id = v_user and not o.demo
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'externalTicketId', t.external_ticket_id, 'channelKey', t.channel_key,
        'channelCode', c.code, 'customerName', t.customer_name, 'subject', t.subject,
        'message', t.message, 'translatedMessage', t.translated_message,
        'replyDraft', t.reply_draft, 'status', t.status, 'priority', t.priority,
        'receivedAt', t.received_at, 'updatedAt', t.updated_at, 'demo', false
      ) order by t.priority, t.received_at desc), '[]'::jsonb)
      from sellerpilot_private.support_tickets t
      join sellerpilot_private.channels c on c.key = t.channel_key
      where t.owner_id = v_user and not t.demo
    ),
    'pipeline', jsonb_build_object(
      'aiRunning', (select count(*) from sellerpilot_private.ai_cli_jobs where created_by = v_user and status in ('queued', 'claimed', 'running')),
      'listingQueued', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.owner_id = v_user and pl.status in ('draft', 'queued') and not p.demo),
      'listingPublished', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.owner_id = v_user and pl.status = 'published' and not p.demo),
      'listingFailed', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.owner_id = v_user and pl.status = 'failed' and not p.demo)
    ),
    'summary', jsonb_build_object(
      'revenue30dKrw', coalesce((select sum(pl.revenue_30d_krw) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.owner_id = v_user and not p.demo), 0),
      'sold30d', coalesce((select sum(pl.sold_30d) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.owner_id = v_user and not p.demo), 0),
      'orderCount', (select count(*) from sellerpilot_private.commerce_orders where owner_id = v_user and not demo),
      'paidOrderCount', (select count(*) from sellerpilot_private.commerce_orders where owner_id = v_user and status = 'paid' and not demo),
      'readyToShipCount', (select count(*) from sellerpilot_private.commerce_orders where owner_id = v_user and status = 'ready_to_ship' and not demo),
      'openTicketCount', (select count(*) from sellerpilot_private.support_tickets where owner_id = v_user and status <> 'resolved' and not demo),
      'lowStockCount', (select count(*) from sellerpilot_private.products where owner_id = v_user and on_hand - reserved <= reorder_point and status <> 'archived' and not demo),
      'productCount', (select count(*) from sellerpilot_private.products where owner_id = v_user and status <> 'archived' and not demo),
      'registrationErrorCount', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.owner_id = v_user and pl.status = 'failed' and not p.demo),
      'activeCredentialCount', (select count(*) from sellerpilot_private.channel_credentials where status = 'active' and environment = 'production' and (expires_at is null or expires_at > now()))
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.sellerpilot_seed_demo_operations()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  raise exception 'demo data is disabled' using errcode = '42501';
end;
$$;

revoke all on function public.sellerpilot_seed_demo_operations() from public, anon, authenticated;
revoke all on function public.sellerpilot_get_operations_snapshot() from public, anon;
grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;

commit;
