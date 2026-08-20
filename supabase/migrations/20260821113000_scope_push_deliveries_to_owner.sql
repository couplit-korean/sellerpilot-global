-- Keep every order alert inside the owning admin workspace. The original
-- trigger selected every enabled device, which becomes unsafe once another
-- administrator installs the PWA.

create or replace function sellerpilot_private.queue_order_push_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_notification_id uuid;
  v_event_key text;
  v_event_type text;
  v_channel_name text;
  v_title text;
  v_body text;
begin
  if new.demo then return new; end if;
  v_channel_name := case new.channel_key
    when 'qoo10' then '큐텐'
    when 'shopee' then '쇼피'
    when 'lazada' then '라자다'
    when 'coupang' then '쿠팡'
    when 'elevenst' then '11번가'
    when 'smartstore' then '네이버'
    when 'ebay' then '이베이'
    when 'temu' then '테무'
    else new.channel_key
  end;

  if tg_op = 'INSERT' then
    v_event_key := 'order:' || new.id::text || ':created';
    v_event_type := 'purchase';
    v_title := '[' || v_channel_name || '] 새 주문 접수';
    v_body := left(new.product_name || ' · ' || new.quantity::text || '개 주문이 들어왔습니다.', 280);
  elsif old.status is not distinct from new.status then
    return new;
  else
    v_event_key := 'order:' || new.id::text || ':status:' || new.status;
    v_event_type := case when new.status in ('ready_to_ship', 'shipped', 'delivered') then 'shipping' else 'purchase' end;
    v_title := '[' || v_channel_name || '] ' || case new.status
      when 'paid' then '결제 완료'
      when 'ready_to_ship' then '출고 준비 필요'
      when 'shipped' then '배송 시작'
      when 'delivered' then '배송 완료'
      when 'cancelled' then '주문 취소'
      when 'refunded' then '환불 완료'
      else '주문 상태 변경'
    end;
    v_body := left(new.product_name || ' 주문 상태가 변경되었습니다.', 280);
  end if;

  insert into sellerpilot_private.push_notification_outbox (
    owner_id, order_id, event_key, event_type, title, body, target_url
  ) values (
    new.owner_id, new.id, v_event_key, v_event_type, v_title, v_body,
    '/?view=orders&orderId=' || new.id::text
  )
  on conflict (event_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is not null then
    insert into sellerpilot_private.push_notification_deliveries (notification_id, subscription_id)
    select v_notification_id, s.id
    from sellerpilot_private.push_subscriptions s
    where s.enabled
      and s.owner_id = new.owner_id
    on conflict (notification_id, subscription_id) do nothing;
  end if;
  return new;
end;
$$;
