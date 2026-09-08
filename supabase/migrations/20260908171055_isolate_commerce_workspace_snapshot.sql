-- Independent commerce read model. Preserve inventory, settlement and sales calculations
-- from the accuracy/v2/stock snapshots without invoking their CS wrapper chain.
begin;

create or replace function public.sellerpilot_get_commerce_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := jsonb_build_object('contract', 'sellerpilot-commerce-snapshot/1', 'generatedAt', now(), 'channels', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb) from sellerpilot_private.channels c));

  v_result := jsonb_set(v_result, '{channelMetrics}', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'channelKey', c.key, 'channelCode', c.code, 'name', c.name,
      'market', c.market, 'color', c.color, 'channelStatus', c.status,
      'credentialStatus', coalesce(cr.status, 'missing'), 'credentialExpiresAt', cr.expires_at,
      'productCount', coalesce(pm.product_count, 0), 'publishedCount', coalesce(pm.published_count, 0),
      'sold30d', coalesce(om.sold_30d, 0), 'revenue30dKrw', coalesce(om.revenue_30d_krw, 0),
      'orderCount', coalesce(om.order_count, 0), 'readyToShipCount', coalesce(om.ready_to_ship_count, 0),
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
        select count(*)::integer failed_count
          from sellerpilot_private.product_listings pl
          join sellerpilot_private.products p on p.id = pl.product_id
         where pl.channel_key = c.key and pl.status = 'failed' and pl.failure_class = 'retryable' and not p.demo
      ) fm on true
      left join lateral (
        select max(a.started_at) last_operation_at from sellerpilot_private.channel_operation_attempts a where a.channel = c.key and a.operation not in ('inquiries.list', 'inquiries.reply')
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
  v_result:=jsonb_set(v_result,'{orders}',coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'externalOrderId',o.external_order_id,'channelKey',o.channel_key,'channelCode',c.code,
    'customerName',o.customer_name,'productId',o.product_id,'productName',o.product_name,'quantity',o.quantity,
    'amount',o.amount,'currency',o.currency,'amountKrw',o.amount_krw,'status',o.status,
    'orderedAt',o.ordered_at,'shippedAt',o.shipped_at,'deliveredAt',o.delivered_at,'lastSeenAt',o.last_seen_at,
    'carrierCode',coalesce(o.carrier_code,o.shipping_carrier),'trackingNumber',o.tracking_number,'settlementStatus',o.settlement_status,
    'settlementAmount',o.settlement_amount,'settlementCurrency',o.settlement_currency,'settledAt',o.settled_at,
    'settlementRateKrw',o.settlement_rate_krw,'referenceRateKrw',o.reference_rate_krw,
    'exchangeLossPercent',case when o.reference_rate_krw>0 and o.settlement_rate_krw is not null then round((o.reference_rate_krw-o.settlement_rate_krw)/o.reference_rate_krw*100,2) else null end,
    'demo',false,'updatedAt',o.updated_at
  ) order by o.ordered_at desc) from sellerpilot_private.commerce_orders o join sellerpilot_private.channels c on c.key=o.channel_key where not o.demo),'[]'::jsonb),true);
  v_result:=jsonb_set(v_result,'{summary,settlementRiskCount}',to_jsonb((select count(*) from sellerpilot_private.commerce_orders o where not o.demo and o.reference_rate_krw>0 and o.settlement_rate_krw is not null and (o.reference_rate_krw-o.settlement_rate_krw)/o.reference_rate_krw>=0.02)),true);
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

revoke all on function public.sellerpilot_get_commerce_snapshot() from public, anon;
grant execute on function public.sellerpilot_get_commerce_snapshot() to authenticated;
notify pgrst, 'reload schema';
commit;
