-- Android/PWA push subscriptions and a durable, privacy-minimized order alert outbox.

create table if not exists sellerpilot_private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (length(endpoint) between 20 and 4096),
  endpoint_hash text not null unique check (length(endpoint_hash) = 64),
  p256dh text not null check (length(p256dh) between 20 and 512),
  auth_secret text not null check (length(auth_secret) between 8 and 512),
  user_agent text not null default '' check (length(user_agent) <= 512),
  device_label text not null default 'Android 웹앱' check (length(device_label) between 1 and 80),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sellerpilot_private.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references sellerpilot_private.commerce_orders(id) on delete cascade,
  event_key text not null unique check (length(event_key) between 10 and 180),
  event_type text not null check (event_type in ('purchase', 'shipping')),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 280),
  target_url text not null default '/?view=orders' check (length(target_url) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists sellerpilot_private.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references sellerpilot_private.push_notification_outbox(id) on delete cascade,
  subscription_id uuid not null references sellerpilot_private.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);

create index if not exists push_subscriptions_owner_enabled_idx
  on sellerpilot_private.push_subscriptions (owner_id, enabled, updated_at desc);
create index if not exists push_delivery_claim_idx
  on sellerpilot_private.push_notification_deliveries (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

alter table sellerpilot_private.push_subscriptions enable row level security;
alter table sellerpilot_private.push_notification_outbox enable row level security;
alter table sellerpilot_private.push_notification_deliveries enable row level security;

revoke all on sellerpilot_private.push_subscriptions from public, anon, authenticated;
revoke all on sellerpilot_private.push_notification_outbox from public, anon, authenticated;
revoke all on sellerpilot_private.push_notification_deliveries from public, anon, authenticated;

create or replace function public.sellerpilot_upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_user_agent text default '',
  p_device_label text default 'Android 웹앱'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_id uuid;
begin
  if v_user is null or not public.sellerpilot_is_admin() then
    raise exception 'admin access required';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) not between 20 and 4096
     or p_p256dh is null or length(p_p256dh) not between 20 and 512
     or p_auth_secret is null or length(p_auth_secret) not between 8 and 512
     or length(coalesce(p_user_agent, '')) > 512
     or length(coalesce(nullif(trim(p_device_label), ''), 'Android 웹앱')) > 80 then
    raise exception 'invalid push subscription';
  end if;

  v_hash := encode(extensions.digest(p_endpoint, 'sha256'), 'hex');
  insert into sellerpilot_private.push_subscriptions (
    owner_id, endpoint, endpoint_hash, p256dh, auth_secret, user_agent, device_label,
    enabled, last_seen_at, updated_at
  ) values (
    v_user, p_endpoint, v_hash, p_p256dh, p_auth_secret, left(coalesce(p_user_agent, ''), 512),
    left(coalesce(nullif(trim(p_device_label), ''), 'Android 웹앱'), 80), true, now(), now()
  )
  on conflict (endpoint_hash) do update set
    owner_id = excluded.owner_id,
    endpoint = excluded.endpoint,
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    user_agent = excluded.user_agent,
    device_label = excluded.device_label,
    enabled = true,
    last_seen_at = now(),
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (v_user, 'push_subscription_enabled', 'push_subscription', v_id::text, jsonb_build_object('device', left(coalesce(p_device_label, 'Android 웹앱'), 80)));
  return v_id;
end;
$$;

create or replace function public.sellerpilot_disable_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user is null or not public.sellerpilot_is_admin() then
    raise exception 'admin access required';
  end if;
  update sellerpilot_private.push_subscriptions
  set enabled = false, updated_at = now()
  where owner_id = v_user
    and endpoint_hash = encode(extensions.digest(p_endpoint, 'sha256'), 'hex');
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function public.sellerpilot_get_push_subscription(p_endpoint text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, sellerpilot_private, extensions
as $$
  select case
    when auth.uid() is null or not public.sellerpilot_is_admin() then null
    else (
      select jsonb_build_object(
        'id', s.id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'authSecret', s.auth_secret,
        'enabled', s.enabled,
        'deviceLabel', s.device_label
      )
      from sellerpilot_private.push_subscriptions s
      where s.owner_id = auth.uid()
        and s.endpoint_hash = encode(extensions.digest(p_endpoint, 'sha256'), 'hex')
      limit 1
    )
  end
$$;

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
    on conflict (notification_id, subscription_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sellerpilot_order_push_notification on sellerpilot_private.commerce_orders;
create trigger sellerpilot_order_push_notification
after insert or update of status on sellerpilot_private.commerce_orders
for each row execute function sellerpilot_private.queue_order_push_notification();

create or replace function public.sellerpilot_service_claim_push_deliveries(p_limit integer default 25)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  event_type text,
  title text,
  body text,
  target_url text
)
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  return query
  with candidates as (
    select d.id
    from sellerpilot_private.push_notification_deliveries d
    join sellerpilot_private.push_subscriptions s on s.id = d.subscription_id and s.enabled
    where d.status in ('pending', 'failed')
      and d.next_attempt_at <= now()
      and d.attempt_count < 5
    order by d.created_at
    for update of d skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update sellerpilot_private.push_notification_deliveries d
    set status = 'sending', attempt_count = d.attempt_count + 1, updated_at = now()
    from candidates c
    where d.id = c.id
    returning d.id, d.subscription_id, d.notification_id
  )
  select c.id, s.id, s.endpoint, s.p256dh, s.auth_secret,
         n.event_type, n.title, n.body, n.target_url
  from claimed c
  join sellerpilot_private.push_subscriptions s on s.id = c.subscription_id
  join sellerpilot_private.push_notification_outbox n on n.id = c.notification_id;
end;
$$;

create or replace function public.sellerpilot_service_finish_push_delivery(
  p_delivery_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_subscription_id uuid;
  v_count integer := 0;
begin
  if p_status not in ('sent', 'failed', 'gone') then raise exception 'invalid push result'; end if;

  update sellerpilot_private.push_notification_deliveries d
  set status = case when p_status = 'sent' then 'sent' else 'failed' end,
      sent_at = case when p_status = 'sent' then now() else null end,
      next_attempt_at = case when p_status = 'failed' then now() + interval '5 minutes' else d.next_attempt_at end,
      last_error = case when p_status = 'sent' then null else left(coalesce(p_error, 'push delivery failed'), 300) end,
      updated_at = now()
  where d.id = p_delivery_id and d.status = 'sending'
  returning d.subscription_id into v_subscription_id;
  get diagnostics v_count = row_count;

  if p_status = 'gone' and v_subscription_id is not null then
    update sellerpilot_private.push_subscriptions
    set enabled = false, updated_at = now()
    where id = v_subscription_id;
  end if;
  return v_count > 0;
end;
$$;

revoke all on function public.sellerpilot_upsert_push_subscription(text, text, text, text, text) from public, anon;
revoke all on function public.sellerpilot_disable_push_subscription(text) from public, anon;
revoke all on function public.sellerpilot_get_push_subscription(text) from public, anon;
revoke all on function public.sellerpilot_service_claim_push_deliveries(integer) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_finish_push_delivery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_upsert_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.sellerpilot_disable_push_subscription(text) to authenticated;
grant execute on function public.sellerpilot_get_push_subscription(text) to authenticated;
grant execute on function public.sellerpilot_service_claim_push_deliveries(integer) to service_role;
grant execute on function public.sellerpilot_service_finish_push_delivery(uuid, text, text) to service_role;
