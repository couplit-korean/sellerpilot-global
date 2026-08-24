begin;
create or replace function public.sellerpilot_service_store_kakao_integration(
  p_owner_id uuid,
  p_secret_payload jsonb,
  p_kakao_user_id text,
  p_nickname text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_vault uuid;
  v_old_vault uuid;
begin
  if not exists (
    select 1 from sellerpilot_private.admin_users where user_id = p_owner_id
  ) or jsonb_typeof(p_secret_payload) <> 'object'
    or octet_length(p_secret_payload::text) > 32000 then
    raise exception 'invalid kakao integration';
  end if;

  select vault_secret_id
    into v_old_vault
    from sellerpilot_private.kakao_integrations
   where owner_id = p_owner_id
   for update;

  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_kakao_%s_%s', p_owner_id, gen_random_uuid()),
    'SellerPilot Kakao user OAuth tokens'
  ) into v_vault;

  insert into sellerpilot_private.kakao_integrations (
    owner_id, kakao_user_id, nickname, vault_secret_id, status, expires_at
  ) values (
    p_owner_id, left(p_kakao_user_id, 120), left(coalesce(p_nickname, ''), 160),
    v_vault, 'active', p_expires_at
  )
  on conflict (owner_id) do update
    set kakao_user_id = excluded.kakao_user_id,
        nickname = excluded.nickname,
        vault_secret_id = excluded.vault_secret_id,
        status = 'active',
        expires_at = excluded.expires_at,
        updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.notification_preferences (owner_id)
  values (p_owner_id)
  on conflict do nothing;

  if v_old_vault is not null and v_old_vault <> v_vault then
    delete from vault.secrets where id = v_old_vault;
  end if;
  return v_id;
end;
$$;
create or replace function public.sellerpilot_service_enqueue_kakao_summaries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with facts as (
    select k.owner_id,
      p.kakao_enabled, p.order_paid, p.shipping_ready, p.shipping_completed,
      p.listing_published, p.listing_failed, p.low_stock, p.cs_waiting, p.settlement_rate_risk,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and status = 'paid') paid,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and status = 'paid') paid_at,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and status = 'ready_to_ship') ready,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and status = 'ready_to_ship') ready_at,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and status = 'delivered') delivered,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and status = 'delivered') delivered_at,
      (select count(*) from sellerpilot_private.products where not demo and status <> 'archived' and on_hand - reserved <= reorder_point) low,
      (select max(updated_at) from sellerpilot_private.products where not demo and status <> 'archived' and on_hand - reserved <= reorder_point) low_at,
      (select count(*) from sellerpilot_private.support_tickets where not demo and status <> 'resolved') cs,
      (select max(updated_at) from sellerpilot_private.support_tickets where not demo and status <> 'resolved') cs_at,
      (select count(*) from sellerpilot_private.product_listings l join sellerpilot_private.products pr on pr.id = l.product_id where not pr.demo and l.status = 'failed') failures,
      (select max(l.updated_at) from sellerpilot_private.product_listings l join sellerpilot_private.products pr on pr.id = l.product_id where not pr.demo and l.status = 'failed') failure_at,
      (select count(*) from sellerpilot_private.product_listings l join sellerpilot_private.products pr on pr.id = l.product_id where not pr.demo and l.status = 'published') published,
      (select max(l.updated_at) from sellerpilot_private.product_listings l join sellerpilot_private.products pr on pr.id = l.product_id where not pr.demo and l.status = 'published') published_at,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and reference_rate_krw > 0 and settlement_rate_krw is not null and (reference_rate_krw - settlement_rate_krw) / reference_rate_krw >= .02) rate_risk,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and reference_rate_krw > 0 and settlement_rate_krw is not null and (reference_rate_krw - settlement_rate_krw) / reference_rate_krw >= .02) rate_at
    from sellerpilot_private.kakao_integrations k
    join sellerpilot_private.notification_preferences p on p.owner_id = k.owner_id
    where k.status = 'active' and p.kakao_enabled
  ), events as (
    select f.owner_id, 'order_paid' type, f.paid count, f.paid_at changed, '새 결제 주문' title, format('결제완료 주문 %s건을 확인하세요.', f.paid) body, '/?view=orders' path from facts f where f.order_paid and f.paid > 0
    union all select f.owner_id, 'shipping_ready', f.ready, f.ready_at, '출고 대기', format('출고 처리할 주문 %s건이 있습니다.', f.ready), '/?view=orders' from facts f where f.shipping_ready and f.ready > 0
    union all select f.owner_id, 'shipping_completed', f.delivered, f.delivered_at, '배송 완료', format('배송완료 주문 %s건을 확인하세요.', f.delivered), '/?view=orders' from facts f where f.shipping_completed and f.delivered > 0
    union all select f.owner_id, 'low_stock', f.low, f.low_at, '재고 주의', format('재고를 확인할 상품 %s개가 있습니다.', f.low), '/?view=products' from facts f where f.low_stock and f.low > 0
    union all select f.owner_id, 'cs_waiting', f.cs, f.cs_at, '미처리 고객문의', format('답변이 필요한 문의 %s건이 있습니다.', f.cs), '/?view=cs' from facts f where f.cs_waiting and f.cs > 0
    union all select f.owner_id, 'listing_published', f.published, f.published_at, '상품 등록 완료', format('판매 중인 채널 상품 %s건을 확인하세요.', f.published), '/?view=products' from facts f where f.listing_published and f.published > 0
    union all select f.owner_id, 'listing_failed', f.failures, f.failure_at, '상품 등록 확인', format('채널 등록 보완이 필요한 상품 %s건이 있습니다.', f.failures), '/?view=publishing' from facts f where f.listing_failed and f.failures > 0
    union all select f.owner_id, 'settlement_rate_risk', f.rate_risk, f.rate_at, '환율 정산 손실 주의', format('기준환율 대비 2%% 이상 불리한 정산 %s건을 확인하세요.', f.rate_risk), '/?view=orders' from facts f where f.settlement_rate_risk and f.rate_risk > 0
  )
  insert into sellerpilot_private.kakao_notification_deliveries (
    owner_id, event_key, event_type, title, body, link_path
  )
  select e.owner_id,
         e.type || ':' || encode(extensions.digest(e.count::text || ':' || coalesce(e.changed::text, ''), 'sha256'), 'hex'),
         e.type, e.title, e.body, e.path
    from events e
  on conflict (owner_id, event_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.sellerpilot_service_store_kakao_integration(uuid, jsonb, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_enqueue_kakao_summaries()
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_store_kakao_integration(uuid, jsonb, text, text, timestamptz)
  to service_role;
grant execute on function public.sellerpilot_service_enqueue_kakao_summaries()
  to service_role;
commit;

