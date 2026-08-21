-- Commerce operations v2: selectable sales ranges, live product/channel state,
-- competitor prices, fulfillment/settlement facts, templates, and notifications.

begin;

alter table sellerpilot_private.products
  add column if not exists supplier_name text not null default '' check (length(supplier_name) <= 240),
  add column if not exists comparison_memo text not null default '' check (length(comparison_memo) <= 4000),
  add column if not exists competitor_query text not null default '' check (length(competitor_query) <= 500),
  add column if not exists competitor_monitor_enabled boolean not null default true,
  add column if not exists competitor_checked_at timestamptz;

alter table sellerpilot_private.product_listings
  add column if not exists marketplace_sku text check (marketplace_sku is null or length(marketplace_sku) <= 160);

alter table sellerpilot_private.commerce_orders
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists carrier_code text check (carrier_code is null or length(carrier_code) <= 80),
  add column if not exists tracking_number text check (tracking_number is null or length(tracking_number) <= 160),
  add column if not exists delivered_at timestamptz,
  add column if not exists settlement_status text not null default 'pending'
    check (settlement_status in ('pending','expected','settled','held','disputed')),
  add column if not exists settlement_amount numeric(16,2) check (settlement_amount is null or settlement_amount >= 0),
  add column if not exists settlement_currency text check (settlement_currency is null or length(settlement_currency) = 3),
  add column if not exists settlement_rate_krw numeric(18,6) check (settlement_rate_krw is null or settlement_rate_krw > 0),
  add column if not exists reference_rate_krw numeric(18,6) check (reference_rate_krw is null or reference_rate_krw > 0),
  add column if not exists settled_at timestamptz;

create index if not exists commerce_orders_live_range_idx
  on sellerpilot_private.commerce_orders (ordered_at desc, channel_key, status)
  where not demo;
create index if not exists commerce_orders_product_range_idx
  on sellerpilot_private.commerce_orders (product_id, ordered_at desc)
  where not demo and product_id is not null;
create index if not exists product_listings_live_product_idx
  on sellerpilot_private.product_listings (product_id, channel_key, market, updated_at desc)
  where status in ('published','queued','failed');

create table if not exists sellerpilot_private.competitor_price_observations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  provider text not null check (provider in ('naver_shopping','manual')),
  external_id text not null check (length(external_id) between 1 and 500),
  title text not null check (length(title) between 1 and 1000),
  product_url text not null check (length(product_url) between 1 and 4000),
  image_url text check (image_url is null or length(image_url) <= 4000),
  mall_name text not null default '' check (length(mall_name) <= 240),
  price numeric(16,2) not null check (price >= 0),
  currency text not null default 'KRW' check (length(currency) = 3),
  checked_at timestamptz not null default now(),
  unique (product_id, provider, external_id)
);
create index if not exists competitor_prices_product_checked_idx
  on sellerpilot_private.competitor_price_observations (product_id, checked_at desc, price);
alter table sellerpilot_private.competitor_price_observations enable row level security;
revoke all on sellerpilot_private.competitor_price_observations from public, anon, authenticated;

create table if not exists sellerpilot_private.commerce_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('shipping_fee','packaging_shipping')),
  "values" jsonb not null check (jsonb_typeof("values")='object' and octet_length("values"::text) <= 16000),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind, name)
);
create index if not exists commerce_templates_owner_kind_idx
  on sellerpilot_private.commerce_templates (owner_id, kind, is_default desc, updated_at desc);
alter table sellerpilot_private.commerce_templates enable row level security;
revoke all on sellerpilot_private.commerce_templates from public, anon, authenticated;

create table if not exists sellerpilot_private.notification_dismissals (
  owner_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null check (length(notification_key) between 1 and 240),
  dismissed_at timestamptz not null default now(),
  primary key (owner_id, notification_key)
);
alter table sellerpilot_private.notification_dismissals enable row level security;
revoke all on sellerpilot_private.notification_dismissals from public, anon, authenticated;

create table if not exists sellerpilot_private.kakao_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kakao_user_id text not null check (length(kakao_user_id) between 1 and 120),
  nickname text not null default '' check (length(nickname) <= 160),
  vault_secret_id uuid not null,
  status text not null default 'active' check (status in ('active','revoked','invalid')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);
create table if not exists sellerpilot_private.notification_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  kakao_enabled boolean not null default true,
  order_paid boolean not null default true,
  shipping_ready boolean not null default true,
  shipping_completed boolean not null default true,
  listing_published boolean not null default true,
  listing_failed boolean not null default true,
  low_stock boolean not null default true,
  cs_waiting boolean not null default true,
  settlement_rate_risk boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists sellerpilot_private.kakao_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null check (length(event_key) between 1 and 240),
  event_type text not null check (event_type in ('order_paid','shipping_ready','shipping_completed','listing_published','listing_failed','low_stock','cs_waiting','settlement_rate_risk','test')),
  title text not null check (length(title) <= 200),
  body text not null check (length(body) <= 1000),
  link_path text not null default '/' check (length(link_path) <= 500),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (owner_id,event_key)
);
create index if not exists kakao_delivery_pending_idx on sellerpilot_private.kakao_notification_deliveries(created_at) where status='pending';
alter table sellerpilot_private.kakao_integrations enable row level security;
alter table sellerpilot_private.notification_preferences enable row level security;
alter table sellerpilot_private.kakao_notification_deliveries enable row level security;
revoke all on sellerpilot_private.kakao_integrations,sellerpilot_private.notification_preferences,sellerpilot_private.kakao_notification_deliveries from public,anon,authenticated;

create or replace function public.sellerpilot_service_store_kakao_integration(p_owner_id uuid,p_secret_payload jsonb,p_kakao_user_id text,p_nickname text,p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare v_id uuid; v_vault uuid; v_old_vault uuid;
begin
  if not exists(select 1 from sellerpilot_private.admin_users where user_id=p_owner_id) or jsonb_typeof(p_secret_payload)<>'object' or octet_length(p_secret_payload::text)>32000 then raise exception 'invalid kakao integration'; end if;
  select vault_secret_id into v_old_vault from sellerpilot_private.kakao_integrations where owner_id=p_owner_id for update;
  select vault.create_secret(p_secret_payload::text,format('sellerpilot_kakao_%s_%s',p_owner_id,gen_random_uuid()),'SellerPilot Kakao user OAuth tokens') into v_vault;
  insert into sellerpilot_private.kakao_integrations(owner_id,kakao_user_id,nickname,vault_secret_id,status,expires_at)
  values(p_owner_id,left(p_kakao_user_id,120),left(coalesce(p_nickname,''),160),v_vault,'active',p_expires_at)
  on conflict(owner_id) do update set kakao_user_id=excluded.kakao_user_id,nickname=excluded.nickname,vault_secret_id=excluded.vault_secret_id,status='active',expires_at=excluded.expires_at,updated_at=now()
  returning id into v_id;
  insert into sellerpilot_private.notification_preferences(owner_id) values(p_owner_id) on conflict do nothing;
  if v_old_vault is not null and v_old_vault<>v_vault then perform vault.delete_secret(v_old_vault); end if;
  return v_id;
end;
$$;

create or replace function public.sellerpilot_get_notification_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  return jsonb_build_object(
    'kakao',coalesce((select jsonb_build_object('connected',k.status='active','nickname',k.nickname,'kakaoUserId',k.kakao_user_id,'expiresAt',k.expires_at,'updatedAt',k.updated_at) from sellerpilot_private.kakao_integrations k where k.owner_id=auth.uid()),jsonb_build_object('connected',false)),
    'preferences',coalesce((select to_jsonb(p)-'owner_id'-'updated_at' from sellerpilot_private.notification_preferences p where p.owner_id=auth.uid()),jsonb_build_object('kakao_enabled',true,'order_paid',true,'shipping_ready',true,'shipping_completed',true,'listing_published',true,'listing_failed',true,'low_stock',true,'cs_waiting',true,'settlement_rate_risk',true))
  );
end;
$$;

create or replace function public.sellerpilot_save_notification_preferences(p_values jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() or jsonb_typeof(p_values)<>'object' then raise exception 'invalid notification preferences'; end if;
  insert into sellerpilot_private.notification_preferences(owner_id,kakao_enabled,order_paid,shipping_ready,shipping_completed,listing_published,listing_failed,low_stock,cs_waiting,settlement_rate_risk)
  values(auth.uid(),coalesce((p_values->>'kakao_enabled')::boolean,true),coalesce((p_values->>'order_paid')::boolean,true),coalesce((p_values->>'shipping_ready')::boolean,true),coalesce((p_values->>'shipping_completed')::boolean,true),coalesce((p_values->>'listing_published')::boolean,true),coalesce((p_values->>'listing_failed')::boolean,true),coalesce((p_values->>'low_stock')::boolean,true),coalesce((p_values->>'cs_waiting')::boolean,true),coalesce((p_values->>'settlement_rate_risk')::boolean,true))
  on conflict(owner_id) do update set kakao_enabled=excluded.kakao_enabled,order_paid=excluded.order_paid,shipping_ready=excluded.shipping_ready,shipping_completed=excluded.shipping_completed,listing_published=excluded.listing_published,listing_failed=excluded.listing_failed,low_stock=excluded.low_stock,cs_waiting=excluded.cs_waiting,settlement_rate_risk=excluded.settlement_rate_risk,updated_at=now();
  return true;
end;
$$;

create or replace function public.sellerpilot_service_get_kakao_secret(p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare v jsonb;
begin
  select jsonb_build_object('integrationId',k.id,'kakaoUserId',k.kakao_user_id,'nickname',k.nickname,'expiresAt',k.expires_at,'secret',d.decrypted_secret::jsonb) into v from sellerpilot_private.kakao_integrations k join vault.decrypted_secrets d on d.id=k.vault_secret_id where k.owner_id=p_owner_id and k.status='active'; return v;
end;
$$;

create or replace function public.sellerpilot_service_enqueue_kakao_summaries()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_count integer:=0;
begin
  with facts as (
    select k.owner_id,p.*,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and status='paid') paid,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and status='paid') paid_at,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and status='ready_to_ship') ready,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and status='ready_to_ship') ready_at,
      (select count(*) from sellerpilot_private.products where not demo and status<>'archived' and on_hand-reserved<=reorder_point) low,
      (select max(updated_at) from sellerpilot_private.products where not demo and status<>'archived' and on_hand-reserved<=reorder_point) low_at,
      (select count(*) from sellerpilot_private.support_tickets where not demo and status<>'resolved') cs,
      (select max(updated_at) from sellerpilot_private.support_tickets where not demo and status<>'resolved') cs_at,
      (select count(*) from sellerpilot_private.product_listings l join sellerpilot_private.products pr on pr.id=l.product_id where not pr.demo and l.status='failed') failures,
      (select max(l.updated_at) from sellerpilot_private.product_listings l join sellerpilot_private.products pr on pr.id=l.product_id where not pr.demo and l.status='failed') failure_at,
      (select count(*) from sellerpilot_private.commerce_orders where not demo and reference_rate_krw>0 and settlement_rate_krw is not null and (reference_rate_krw-settlement_rate_krw)/reference_rate_krw>=.02) rate_risk,
      (select max(updated_at) from sellerpilot_private.commerce_orders where not demo and reference_rate_krw>0 and settlement_rate_krw is not null and (reference_rate_krw-settlement_rate_krw)/reference_rate_krw>=.02) rate_at
    from sellerpilot_private.kakao_integrations k join sellerpilot_private.notification_preferences p on p.owner_id=k.owner_id where k.status='active' and p.kakao_enabled
  ), events as (
    select owner_id,'order_paid' type,paid count,paid_at changed,'새 결제 주문' title,format('결제완료 주문 %s건을 확인하세요.',paid) body,'/?view=orders' path from facts where order_paid and paid>0
    union all select owner_id,'shipping_ready',ready,ready_at,'출고 대기',format('출고 처리할 주문 %s건이 있습니다.',ready),'/?view=orders' from facts where shipping_ready and ready>0
    union all select owner_id,'low_stock',low,low_at,'재고 주의',format('재고를 확인할 상품 %s개가 있습니다.',low),'/?view=products' from facts where low_stock and low>0
    union all select owner_id,'cs_waiting',cs,cs_at,'미처리 고객문의',format('답변이 필요한 문의 %s건이 있습니다.',cs),'/?view=cs' from facts where cs_waiting and cs>0
    union all select owner_id,'listing_failed',failures,failure_at,'상품 등록 확인',format('채널 등록 보완이 필요한 상품 %s건이 있습니다.',failures),'/?view=publishing' from facts where listing_failed and failures>0
    union all select owner_id,'settlement_rate_risk',rate_risk,rate_at,'환율 정산 손실 주의',format('기준환율 대비 2%% 이상 불리한 정산 %s건을 확인하세요.',rate_risk),'/?view=orders' from facts where settlement_rate_risk and rate_risk>0
  )
  insert into sellerpilot_private.kakao_notification_deliveries(owner_id,event_key,event_type,title,body,link_path)
  select e.owner_id,e.type||':'||encode(extensions.digest(e.count::text||':'||coalesce(e.changed::text,''),'sha256'),'hex'),e.type,e.title,e.body,e.path from events e
  on conflict(owner_id,event_key) do nothing;
  get diagnostics v_count=row_count; return v_count;
end;
$$;

create or replace function public.sellerpilot_service_claim_kakao_notifications(p_limit integer default 50)
returns table(id uuid,owner_id uuid,event_type text,title text,body text,link_path text,secret_payload jsonb,expires_at timestamptz,kakao_user_id text,nickname text)
language sql
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
  select d.id,d.owner_id,d.event_type,d.title,d.body,d.link_path,s.decrypted_secret::jsonb,k.expires_at,k.kakao_user_id,k.nickname
  from sellerpilot_private.kakao_notification_deliveries d join sellerpilot_private.kakao_integrations k on k.owner_id=d.owner_id and k.status='active' join vault.decrypted_secrets s on s.id=k.vault_secret_id
  where d.status='pending' and d.attempt_count<3 order by d.created_at limit greatest(1,least(coalesce(p_limit,50),100))
$$;

create or replace function public.sellerpilot_service_complete_kakao_notification(p_id uuid,p_success boolean,p_error text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  update sellerpilot_private.kakao_notification_deliveries set status=case when p_success then 'sent' when attempt_count+1>=3 then 'failed' else 'pending' end,attempt_count=attempt_count+1,last_error=case when p_success then null else left(coalesce(p_error,'send failed'),500) end,sent_at=case when p_success then now() else sent_at end where id=p_id; return found;
end;
$$;

create or replace function public.sellerpilot_list_commerce_templates()
returns table(id uuid,name text,kind text,"values" jsonb,is_default boolean,updated_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select t.id,t.name,t.kind,t."values",t.is_default,t.updated_at from sellerpilot_private.commerce_templates t
  where t.owner_id=auth.uid() and public.sellerpilot_is_admin() order by t.kind,t.is_default desc,t.updated_at desc
$$;

create or replace function public.sellerpilot_save_commerce_template(p_id uuid,p_name text,p_kind text,p_values jsonb,p_is_default boolean default false)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() or p_kind not in ('shipping_fee','packaging_shipping') or length(trim(coalesce(p_name,''))) not between 1 and 120 or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>16000 then raise exception 'invalid commerce template'; end if;
  if coalesce(p_is_default,false) then update sellerpilot_private.commerce_templates set is_default=false,updated_at=now() where owner_id=auth.uid() and kind=p_kind and is_default; end if;
  insert into sellerpilot_private.commerce_templates(id,owner_id,name,kind,"values",is_default) values(v_id,auth.uid(),trim(p_name),p_kind,p_values,coalesce(p_is_default,false))
  on conflict(id) do update set name=excluded.name,kind=excluded.kind,"values"=excluded."values",is_default=excluded.is_default,updated_at=now() where sellerpilot_private.commerce_templates.owner_id=auth.uid();
  return v_id;
end;
$$;

create or replace function public.sellerpilot_delete_commerce_template(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  delete from sellerpilot_private.commerce_templates where id=p_id and owner_id=auth.uid(); return found;
end;
$$;

create or replace function public.sellerpilot_get_sales_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_from date := coalesce(p_from, current_date - 29);
  v_to date := coalesce(p_to, current_date);
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
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
      from sellerpilot_private.products p
      left join lateral (
        select sum(q.quantity)::integer sold,sum(q.amount_krw) revenue,
          jsonb_agg(jsonb_build_object('channelKey',q.channel_key,'channelCode',c.code,'sold',q.quantity,'revenueKrw',q.amount_krw) order by q.quantity desc) channels
        from (
          select o.channel_key,sum(o.quantity)::integer quantity,sum(o.amount_krw) amount_krw
          from sellerpilot_private.commerce_orders o where o.product_id=p.id and not o.demo
            and o.status not in ('cancelled','refunded') and o.ordered_at >= v_from::timestamptz and o.ordered_at < (v_to+1)::timestamptz
          group by o.channel_key
        ) q join sellerpilot_private.channels c on c.key=q.channel_key
      ) x on true where p.status <> 'archived' and not p.demo)
  );
end;
$$;

create or replace function public.sellerpilot_get_ticket_reply_context(p_id uuid)
returns table(id uuid,external_ticket_id text,channel_key text,status text)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select t.id,t.external_ticket_id,t.channel_key,t.status from sellerpilot_private.support_tickets t where public.sellerpilot_is_admin() and t.id=p_id and not t.demo limit 1
$$;

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
      left join lateral (select ca.category_id,ca.category_path,ca.status from sellerpilot_private.product_category_assignments ca
        where ca.product_id=p.id and ca.channel=l.channel_key and (ca.market=l.market or ca.market='') order by (ca.market=l.market) desc,ca.updated_at desc limit 1) a on true
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
      where ca.product_id=p.id and ca.channel=l.channel_key and (ca.market=l.market or ca.market='')
      order by (ca.market=l.market) desc,ca.updated_at desc limit 1
    ) a on true
    where l.status='failed' and l.failure_class='external_action'
  ),'[]'::jsonb);
end;
$$;

create or replace function public.sellerpilot_update_product_commerce_notes(
  p_product_id uuid,p_supplier_name text,p_comparison_memo text,p_competitor_query text,p_monitor_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  update sellerpilot_private.products set supplier_name=left(trim(coalesce(p_supplier_name,'')),240),comparison_memo=left(trim(coalesce(p_comparison_memo,'')),4000),competitor_query=left(trim(coalesce(p_competitor_query,'')),500),competitor_monitor_enabled=coalesce(p_monitor_enabled,true),updated_at=now() where id=p_product_id and not demo;
  return found;
end;
$$;

create or replace function public.sellerpilot_service_due_competitor_products(p_limit integer default 50)
returns table(product_id uuid,query text)
language sql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select p.id,coalesce(nullif(p.competitor_query,''),p.name) from sellerpilot_private.products p
  where not p.demo and p.status <> 'archived' and p.competitor_monitor_enabled
    and (p.competitor_checked_at is null or p.competitor_checked_at <= now()-interval '30 minutes')
  order by p.competitor_checked_at nulls first,p.updated_at desc limit greatest(1,least(coalesce(p_limit,50),100))
$$;

create or replace function public.sellerpilot_service_record_competitor_prices(p_product_id uuid,p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v jsonb; v_count integer:=0; v_external text;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>5 then raise exception 'invalid competitor prices'; end if;
  if not exists(select 1 from sellerpilot_private.products where id=p_product_id and status<>'archived' and competitor_monitor_enabled) then return 0; end if;
  for v in select value from jsonb_array_elements(p_items) loop
    v_external:=left(coalesce(nullif(trim(v->>'externalId'),''),md5(coalesce(v->>'url',''))),500);
    if coalesce((v->>'price')::numeric,-1)<0 then continue; end if;
    insert into sellerpilot_private.competitor_price_observations(product_id,provider,external_id,title,product_url,image_url,mall_name,price,currency,checked_at)
    values(p_product_id,'naver_shopping',v_external,left(coalesce(v->>'title','상품'),1000),left(coalesce(v->>'url',''),4000),nullif(left(coalesce(v->>'imageUrl',''),4000),''),left(coalesce(v->>'mallName',''),240),(v->>'price')::numeric,'KRW',now())
    on conflict(product_id,provider,external_id) do update set title=excluded.title,product_url=excluded.product_url,image_url=excluded.image_url,mall_name=excluded.mall_name,price=excluded.price,checked_at=now();
    v_count:=v_count+1;
  end loop;
  update sellerpilot_private.products set competitor_checked_at=now() where id=p_product_id;
  return v_count;
end;
$$;

-- Keep remote lifecycle facts current on every order sync, including explicit
-- Coupang cancellation rows from the return/cancellation API.
alter function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  rename to sellerpilot_service_ingest_orders_pre_v2;
create or replace function public.sellerpilot_service_ingest_orders(p_credential_id uuid,p_channel text,p_orders jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_count integer; v_order jsonb; v_owner uuid;
begin
  v_count:=public.sellerpilot_service_ingest_orders_pre_v2(p_credential_id,p_channel,p_orders);
  select created_by into v_owner from sellerpilot_private.channel_credentials where id=p_credential_id and channel=p_channel;
  for v_order in select value from jsonb_array_elements(p_orders) loop
    update sellerpilot_private.commerce_orders set last_seen_at=now(),
      delivered_at=case when v_order->>'status'='delivered' then coalesce(delivered_at,now()) else delivered_at end,
      updated_at=now()
    where owner_id=v_owner and channel_key=p_channel and external_order_id=v_order->>'externalOrderId';
  end loop;
  return v_count;
end;
$$;

alter function public.sellerpilot_get_operations_snapshot()
  rename to sellerpilot_get_operations_snapshot_pre_v2;
create or replace function public.sellerpilot_get_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  v_result:=public.sellerpilot_get_operations_snapshot_pre_v2();
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
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_get_sales_analytics(date,date) from public,anon;
revoke all on function public.sellerpilot_get_ticket_reply_context(uuid) from public,anon;
revoke all on function public.sellerpilot_list_commerce_templates() from public,anon;
revoke all on function public.sellerpilot_save_commerce_template(uuid,text,text,jsonb,boolean) from public,anon;
revoke all on function public.sellerpilot_delete_commerce_template(uuid) from public,anon;
revoke all on function public.sellerpilot_service_store_kakao_integration(uuid,jsonb,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.sellerpilot_get_notification_settings() from public,anon;
revoke all on function public.sellerpilot_save_notification_preferences(jsonb) from public,anon;
revoke all on function public.sellerpilot_service_get_kakao_secret(uuid) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_enqueue_kakao_summaries() from public,anon,authenticated;
revoke all on function public.sellerpilot_service_claim_kakao_notifications(integer) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_complete_kakao_notification(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.sellerpilot_get_product_operations_v2(uuid) from public,anon;
revoke all on function public.sellerpilot_list_external_listing_actions() from public,anon;
revoke all on function public.sellerpilot_update_product_commerce_notes(uuid,text,text,text,boolean) from public,anon;
revoke all on function public.sellerpilot_service_due_competitor_products(integer) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.sellerpilot_get_operations_snapshot() from public,anon;
grant execute on function public.sellerpilot_get_sales_analytics(date,date) to authenticated;
grant execute on function public.sellerpilot_get_ticket_reply_context(uuid) to authenticated;
grant execute on function public.sellerpilot_list_commerce_templates() to authenticated;
grant execute on function public.sellerpilot_save_commerce_template(uuid,text,text,jsonb,boolean) to authenticated;
grant execute on function public.sellerpilot_delete_commerce_template(uuid) to authenticated;
grant execute on function public.sellerpilot_service_store_kakao_integration(uuid,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.sellerpilot_get_notification_settings() to authenticated;
grant execute on function public.sellerpilot_save_notification_preferences(jsonb) to authenticated;
grant execute on function public.sellerpilot_service_get_kakao_secret(uuid) to service_role;
grant execute on function public.sellerpilot_service_enqueue_kakao_summaries() to service_role;
grant execute on function public.sellerpilot_service_claim_kakao_notifications(integer) to service_role;
grant execute on function public.sellerpilot_service_complete_kakao_notification(uuid,boolean,text) to service_role;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid) to authenticated;
grant execute on function public.sellerpilot_list_external_listing_actions() to authenticated;
grant execute on function public.sellerpilot_update_product_commerce_notes(uuid,text,text,text,boolean) to authenticated;
grant execute on function public.sellerpilot_service_due_competitor_products(integer) to service_role;
grant execute on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb) to service_role;
grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) to service_role;
grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;

commit;
