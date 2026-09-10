-- Independent commerce read model. Preserve inventory, settlement and sales calculations
-- from the accuracy/v2/stock snapshots without invoking their CS wrapper chain.
begin;

create or replace function public.sellerpilot_get_product_registration_snapshot()
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
  v_result := jsonb_build_object('contract', 'sellerpilot-product-registration-snapshot/1', 'generatedAt', now(), 'channels', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb) from sellerpilot_private.channels c));

  v_result := jsonb_set(v_result, '{channelMetrics}', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'channelKey', c.key, 'channelCode', c.code, 'name', c.name,
      'market', c.market, 'color', c.color, 'channelStatus', c.status,
      'credentialStatus', coalesce(cr.status, 'missing'), 'credentialExpiresAt', cr.expires_at,
      'productCount', coalesce(pm.product_count, 0), 'publishedCount', coalesce(pm.published_count, 0),
      'sold30d', 0, 'revenue30dKrw', 0,
      'orderCount', 0, 'readyToShipCount', 0,
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
        select count(*)::integer failed_count
          from sellerpilot_private.product_listings pl
          join sellerpilot_private.products p on p.id = pl.product_id
         where pl.channel_key = c.key and pl.status = 'failed' and pl.failure_class = 'retryable' and not p.demo
      ) fm on true
      left join lateral (
        select max(a.started_at) last_operation_at from sellerpilot_private.channel_operation_attempts a where a.channel = c.key and a.operation not in ('inquiries.list', 'inquiries.reply', 'orders.list', 'orders.get', 'shipment.acknowledge', 'shipment.confirm')
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
      'sold30d', 0, 'revenue30dKrw', 0,
      'listingChannels', coalesce(ls.channel_codes, '[]'::jsonb), 'demo', false,
      'updatedAt', p.updated_at
    ) order by p.updated_at desc), '[]'::jsonb)
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs aj on aj.id = p.ai_job_id
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
    'revenue30dKrw', 0, 'sold30d', 0, 'orderCount', 0, 'paidOrderCount', 0, 'readyToShipCount', 0, 'settlementRiskCount', 0,
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
  v_result:=jsonb_set(v_result,'{orders}','[]'::jsonb,true);
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

revoke all on function public.sellerpilot_get_product_registration_snapshot() from public, anon;
grant execute on function public.sellerpilot_get_product_registration_snapshot() to authenticated;

create or replace function public.sellerpilot_get_shipping_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
 if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then raise exception 'administrator access required' using errcode='42501'; end if;
 v_result:=jsonb_build_object('contract','sellerpilot-shipping-snapshot/1','generatedAt',now(),'summary',jsonb_build_object(
 'revenue30dKrw',coalesce((select sum(amount_krw) from sellerpilot_private.commerce_orders where not demo and ordered_at>=now()-interval '30 days' and status not in ('cancelled','refunded')),0),
 'sold30d',coalesce((select sum(quantity) from sellerpilot_private.commerce_orders where not demo and ordered_at>=now()-interval '30 days' and status not in ('cancelled','refunded')),0),
 'orderCount',(select count(*) from sellerpilot_private.commerce_orders where not demo),
 'paidOrderCount',(select count(*) from sellerpilot_private.commerce_orders where not demo and status='paid'),
 'readyToShipCount',(select count(*) from sellerpilot_private.commerce_orders where not demo and status='ready_to_ship')));
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

 v_result:=jsonb_set(v_result,'{syncStatus}',coalesce((select jsonb_agg(row) from (select channel_key,data_type,status,imported_count,last_started_at,last_succeeded_at,last_error,updated_at from sellerpilot_private.channel_sync_state where data_type='orders') row),'[]'::jsonb));
 v_result:=jsonb_set(v_result,'{channelMetrics}',coalesce((select jsonb_agg(jsonb_build_object('channelKey',channel_key,'sold30d',sold,'revenue30dKrw',revenue,'orderCount',orders,'readyToShipCount',ready)) from (select channel_key,coalesce(sum(quantity) filter(where ordered_at>=now()-interval '30 days' and status not in ('cancelled','refunded')),0) sold,coalesce(sum(amount_krw) filter(where ordered_at>=now()-interval '30 days' and status not in ('cancelled','refunded')),0) revenue,count(*) orders,count(*) filter(where status='ready_to_ship') ready from sellerpilot_private.commerce_orders where not demo group by channel_key) x),'[]'::jsonb));
 v_result:=jsonb_set(v_result,'{productSales}',coalesce((select jsonb_agg(jsonb_build_object('productId',product_id,'sold30d',sold,'revenue30dKrw',revenue)) from (select product_id,sum(quantity) sold,sum(amount_krw) revenue from sellerpilot_private.commerce_orders where not demo and product_id is not null and ordered_at>=now()-interval '30 days' and status not in ('cancelled','refunded') group by product_id) x),'[]'::jsonb));
 return v_result;
end; $$;
revoke all on function public.sellerpilot_get_shipping_snapshot() from public,anon;
grant execute on function public.sellerpilot_get_shipping_snapshot() to authenticated;
create or replace function public.sellerpilot_get_shipping_sales_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_from, current_date - 29);
  v_to date := coalesce(p_to, current_date);
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if v_from > v_to or v_to - v_from > 3660 then
    raise exception 'invalid sales date range';
  end if;
  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'summary', jsonb_build_object(
      'revenueKrw', coalesce((select sum(o.amount_krw) from sellerpilot_private.commerce_orders o where not o.demo and o.status not in ('cancelled','refunded') and o.ordered_at >= v_from::timestamptz and o.ordered_at < (v_to+1)::timestamptz),0),
      'sold', coalesce((select sum(o.quantity) from sellerpilot_private.commerce_orders o where not o.demo and o.status not in ('cancelled','refunded') and o.ordered_at >= v_from::timestamptz and o.ordered_at < (v_to+1)::timestamptz),0),
      'orderCount', (select count(*) from sellerpilot_private.commerce_orders o where not o.demo and o.status not in ('cancelled','refunded') and o.ordered_at >= v_from::timestamptz and o.ordered_at < (v_to+1)::timestamptz)
    ),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
      'date', d.day,
      'revenueKrw', coalesce(m.revenue,0),
      'sold', coalesce(m.sold,0),
      'orderCount', coalesce(m.orders,0),
      'domesticRevenueKrw', coalesce(m.domestic_revenue,0),
      'overseasRevenueKrw', coalesce(m.overseas_revenue,0),
      'channels', coalesce(m.channels,'{}'::jsonb)
    ) order by d.day),'[]'::jsonb)
      from generate_series(v_from,v_to,interval '1 day') d(day)
      left join lateral (
        select sum(o.amount_krw) revenue, sum(o.quantity)::integer sold, count(*)::integer orders,
          sum(o.amount_krw) filter(where o.channel_key in ('coupang','elevenst','smartstore','temu')) domestic_revenue,
          sum(o.amount_krw) filter(where o.channel_key not in ('coupang','elevenst','smartstore','temu')) overseas_revenue,
          jsonb_object_agg(o.channel_key,o.channel_revenue) channels
        from (
          select channel_key,sum(amount_krw) amount_krw,sum(quantity) quantity,
            sum(amount_krw) channel_revenue
          from sellerpilot_private.commerce_orders
          where not demo and status not in ('cancelled','refunded')
            and ordered_at >= d.day and ordered_at < d.day + interval '1 day'
          group by channel_key
        ) o
      ) m on true),
    'channels', (select coalesce(jsonb_agg(jsonb_build_object(
      'channelKey',c.key,'channelCode',c.code,'name',c.name,'market',c.market,'color',c.color,
      'revenueKrw',coalesce(x.revenue,0),'sold',coalesce(x.sold,0),'orderCount',coalesce(x.orders,0)
    ) order by coalesce(x.revenue,0) desc,c.sort_order),'[]'::jsonb)
      from sellerpilot_private.channels c
      left join lateral (
        select sum(o.amount_krw) revenue,sum(o.quantity)::integer sold,count(*)::integer orders
        from sellerpilot_private.commerce_orders o where o.channel_key=c.key and not o.demo
          and o.status not in ('cancelled','refunded') and o.ordered_at >= v_from::timestamptz and o.ordered_at < (v_to+1)::timestamptz
      ) x on true where c.status <> 'disabled'),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
      'productId',p.id,'sold',coalesce(x.sold,0),'revenueKrw',coalesce(x.revenue,0),
      'channels',coalesce(x.channels,'[]'::jsonb)
    ) order by coalesce(x.sold,0) desc,p.updated_at desc),'[]'::jsonb)
      from (select product_id id,max(updated_at) updated_at from sellerpilot_private.commerce_orders where not demo and product_id is not null group by product_id) p
      left join lateral (
        select sum(q.quantity)::integer sold,sum(q.amount_krw) revenue,
          jsonb_agg(jsonb_build_object('channelKey',q.channel_key,'channelCode',c.code,'sold',q.quantity,'revenueKrw',q.amount_krw) order by q.quantity desc) channels
        from (
          select o.channel_key,sum(o.quantity)::integer quantity,sum(o.amount_krw) amount_krw
          from sellerpilot_private.commerce_orders o where o.product_id=p.id and not o.demo
            and o.status not in ('cancelled','refunded') and o.ordered_at >= v_from::timestamptz and o.ordered_at < (v_to+1)::timestamptz
          group by o.channel_key
        ) q join sellerpilot_private.channels c on c.key=q.channel_key
      ) x on true)
  );
end;
$$;

revoke all on function public.sellerpilot_get_shipping_sales_analytics(date,date) from public,anon;
grant execute on function public.sellerpilot_get_shipping_sales_analytics(date,date) to authenticated;
create or replace function public.sellerpilot_get_shipping_attempt_result(p_attempt_id uuid,p_credential_id uuid,p_channel text,p_operation text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then raise exception 'administrator access required' using errcode='42501';end if;
 if p_operation not in ('orders.list','orders.get','shipment.acknowledge','shipment.confirm') then raise exception 'shipping operation required' using errcode='22023';end if;
 select jsonb_build_object('status',j.status,'jobId',j.id,'response',j.response_payload) into v_result
 from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.channel_operation_attempts a on a.id=j.attempt_id
 where j.attempt_id=p_attempt_id and j.credential_id=p_credential_id and j.channel=p_channel and j.operation=p_operation
 and a.credential_id=p_credential_id and a.channel=p_channel and a.operation=p_operation
 order by j.created_at desc limit 1;
 return v_result;
end;$$;
revoke all on function public.sellerpilot_get_shipping_attempt_result(uuid,uuid,text,text) from public,anon;
grant execute on function public.sellerpilot_get_shipping_attempt_result(uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
