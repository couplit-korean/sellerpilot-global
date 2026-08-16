-- SellerPilot operational data plane.
-- All business rows are private and can only be reached through audited admin RPCs.

begin;

create table if not exists sellerpilot_private.channels (
  key text primary key check (key in ('qoo10', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'alibaba', 'one688')),
  name text not null,
  market text not null,
  code text not null unique,
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  status text not null check (status in ('active', 'auth_required', 'planned', 'disabled')),
  sort_order integer not null unique,
  updated_at timestamptz not null default now()
);

insert into sellerpilot_private.channels (key, name, market, code, color, status, sort_order)
values
  ('qoo10', 'Qoo10 Japan', '일본', 'Q', '#ff5e62', 'auth_required', 10),
  ('lazada', 'Lazada Malaysia', '말레이시아', 'L', '#7357ff', 'auth_required', 20),
  ('coupang', '쿠팡', '대한민국', 'C', '#e8344e', 'planned', 30),
  ('elevenst', '11번가', '대한민국', '11', '#ff2d55', 'planned', 40),
  ('smartstore', '네이버 스마트스토어', '대한민국', 'N', '#03c75a', 'planned', 50),
  ('ebay', 'eBay Global', '글로벌', 'E', '#3665f3', 'planned', 60),
  ('alibaba', 'Alibaba.com', '글로벌 B2B', 'A', '#ff6a00', 'disabled', 70),
  ('one688', '1688.com', '중국 내수 B2B', '1688', '#ff7300', 'disabled', 80)
on conflict (key) do update set
  name = excluded.name,
  market = excluded.market,
  code = excluded.code,
  color = excluded.color,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists sellerpilot_private.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  external_code text not null,
  sku text not null,
  name text not null,
  description text not null default '',
  source_url text,
  image_url text,
  ai_job_id uuid references sellerpilot_private.ai_cli_jobs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'low_stock', 'out_of_stock', 'archived')),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  reorder_point integer not null default 10 check (reorder_point >= 0),
  cost_krw numeric(14,2) not null default 0 check (cost_krw >= 0),
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, external_code),
  unique (owner_id, sku),
  unique (owner_id, ai_job_id)
);

create table if not exists sellerpilot_private.product_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  channel_key text not null references sellerpilot_private.channels(key),
  remote_id text,
  status text not null default 'draft' check (status in ('draft', 'queued', 'published', 'failed', 'paused', 'scope_excluded')),
  currency text not null default 'KRW',
  price numeric(14,2) not null default 0 check (price >= 0),
  sold_30d integer not null default 0 check (sold_30d >= 0),
  revenue_30d_krw numeric(16,2) not null default 0 check (revenue_30d_krw >= 0),
  last_error text,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, product_id, channel_key)
);

create table if not exists sellerpilot_private.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  external_order_id text not null,
  channel_key text not null references sellerpilot_private.channels(key),
  customer_name text not null,
  product_id uuid references sellerpilot_private.products(id) on delete set null,
  product_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null,
  amount_krw numeric(16,2) not null check (amount_krw >= 0),
  status text not null check (status in ('paid', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'refunded')),
  ordered_at timestamptz not null,
  shipped_at timestamptz,
  demo boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (owner_id, channel_key, external_order_id)
);

create table if not exists sellerpilot_private.support_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  external_ticket_id text not null,
  channel_key text not null references sellerpilot_private.channels(key),
  order_id uuid references sellerpilot_private.commerce_orders(id) on delete set null,
  customer_name text not null,
  subject text not null,
  message text not null,
  translated_message text,
  reply_draft text,
  status text not null default 'waiting' check (status in ('urgent', 'waiting', 'in_progress', 'resolved')),
  priority integer not null default 3 check (priority between 1 and 5),
  received_at timestamptz not null,
  resolved_at timestamptz,
  demo boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (owner_id, channel_key, external_ticket_id)
);

create table if not exists sellerpilot_private.margin_scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  channel_key text not null references sellerpilot_private.channels(key),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 32768),
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sellerpilot_private.operation_audit (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  safe_detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists products_owner_status_idx on sellerpilot_private.products (owner_id, status, updated_at desc);
create index if not exists listings_owner_channel_idx on sellerpilot_private.product_listings (owner_id, channel_key, updated_at desc);
create index if not exists orders_owner_time_idx on sellerpilot_private.commerce_orders (owner_id, ordered_at desc);
create index if not exists orders_owner_status_idx on sellerpilot_private.commerce_orders (owner_id, status, ordered_at desc);
create index if not exists tickets_owner_status_idx on sellerpilot_private.support_tickets (owner_id, status, received_at desc);
create index if not exists audit_owner_time_idx on sellerpilot_private.operation_audit (owner_id, occurred_at desc);

alter table sellerpilot_private.channels enable row level security;
alter table sellerpilot_private.products enable row level security;
alter table sellerpilot_private.product_listings enable row level security;
alter table sellerpilot_private.commerce_orders enable row level security;
alter table sellerpilot_private.support_tickets enable row level security;
alter table sellerpilot_private.margin_scenarios enable row level security;
alter table sellerpilot_private.operation_audit enable row level security;

revoke all on sellerpilot_private.channels from public, anon, authenticated;
revoke all on sellerpilot_private.products from public, anon, authenticated;
revoke all on sellerpilot_private.product_listings from public, anon, authenticated;
revoke all on sellerpilot_private.commerce_orders from public, anon, authenticated;
revoke all on sellerpilot_private.support_tickets from public, anon, authenticated;
revoke all on sellerpilot_private.margin_scenarios from public, anon, authenticated;
revoke all on sellerpilot_private.operation_audit from public, anon, authenticated;

create or replace function public.sellerpilot_seed_demo_operations()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_user uuid := auth.uid();
  v_product uuid;
  v_index integer := 0;
  v_names text[] := array[
    '화이트토마토 글루타치온 30정', '저분자 피쉬콜라겐 60포', '비타민C 구미 90정',
    '프로바이오틱스 데일리 30포', '세라마이드 모이스처 크림', '레티놀 퍼밍 나이트 세럼',
    '유기농 제주 말차 스틱 20포', '멀티비타민 미네랄 데일리', '콜드브루 콜라겐 젤리 14포', '제주 비자림 클렌징 밤'
  ];
  v_skus text[] := array['IB-WTG-30','IB-FC-60','IB-VCG-90','IB-PRO-30','IB-CER-50','SK-RTN-30','FD-MTC-20','HL-MVM-60','IB-CBJ-14','SK-BJR-80'];
  v_stock integer[] := array[86,42,18,0,73,64,27,9,51,34];
  v_sales integer[] := array[382,247,196,121,98,84,76,61,48,37];
  v_revenue numeric[] := array[12864000,8306000,5782000,4114000,3188000,2940000,2128000,1982000,1536000,1184000];
  v_images text[] := array['premium-studio.png','morning-routine.png','ingredient-flatlay.png','daily-carry.png'];
begin
  if v_user is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.operation_audit
    where owner_id = v_user and action = 'demo_seeded' and entity_type = 'workspace'
  ) then
    return true;
  end if;

  for v_index in 1..array_length(v_names, 1) loop
    insert into sellerpilot_private.products (
      owner_id, external_code, sku, name, description, image_url, status, on_hand, reorder_point, cost_krw, demo
    ) values (
      v_user,
      'SP-' || to_char(date '2026-08-16' - (v_index - 1), 'YYMMDD') || '-' || lpad(v_index::text, 3, '0'),
      v_skus[v_index], v_names[v_index], '화면과 데이터 연결 검증용 상품입니다.',
      '/demo/setting-shots/' || v_images[((v_index - 1) % 4) + 1],
      case when v_stock[v_index] = 0 then 'out_of_stock' when v_stock[v_index] <= 20 then 'low_stock' else 'active' end,
      v_stock[v_index], 10, 9800 + (v_index * 750), true
    )
    on conflict (owner_id, sku) do update set
      name = excluded.name, image_url = excluded.image_url, on_hand = excluded.on_hand,
      status = excluded.status, updated_at = now()
    returning id into v_product;

    insert into sellerpilot_private.product_listings (
      owner_id, product_id, channel_key, status, currency, price, sold_30d, revenue_30d_krw, published_at
    ) values
      (v_user, v_product, 'qoo10', 'published', 'JPY', 4280 + v_index * 50, greatest(v_sales[v_index] * 45 / 100, 1), v_revenue[v_index] * .45, now() - interval '30 days'),
      (v_user, v_product, 'lazada', 'published', 'MYR', 120 + v_index, greatest(v_sales[v_index] * 20 / 100, 1), v_revenue[v_index] * .20, now() - interval '25 days'),
      (v_user, v_product, 'coupang', 'draft', 'KRW', 29000 + v_index * 500, greatest(v_sales[v_index] * 15 / 100, 0), v_revenue[v_index] * .15, null),
      (v_user, v_product, 'smartstore', 'draft', 'KRW', 29500 + v_index * 500, greatest(v_sales[v_index] * 12 / 100, 0), v_revenue[v_index] * .12, null),
      (v_user, v_product, 'ebay', 'draft', 'USD', 29 + v_index, greatest(v_sales[v_index] * 8 / 100, 0), v_revenue[v_index] * .08, null)
    on conflict (owner_id, product_id, channel_key) do update set
      sold_30d = excluded.sold_30d,
      revenue_30d_krw = excluded.revenue_30d_krw,
      updated_at = now();
  end loop;

  select id into v_product from sellerpilot_private.products where owner_id = v_user and sku = 'IB-WTG-30';
  insert into sellerpilot_private.commerce_orders (
    owner_id, external_order_id, channel_key, customer_name, product_id, product_name, amount, currency, amount_krw, status, ordered_at, demo
  ) values
    (v_user, 'QT-8603921', 'qoo10', 'Yuki Tanaka', v_product, '화이트토마토 글루타치온 30정', 4280, 'JPY', 40510, 'paid', now() - interval '8 minutes', true),
    (v_user, 'LZ-1485027', 'lazada', 'Nur Aisyah', v_product, '비타민C 구미 90정', 128, 'MYR', 39680, 'shipped', now() - interval '59 minutes', true),
    (v_user, 'CP-7402851', 'coupang', '이수민', v_product, '콜드브루 콜라겐 젤리 14포', 32000, 'KRW', 32000, 'paid', now() - interval '3 hours', true),
    (v_user, 'NV-6381920', 'smartstore', '김하은', v_product, '세라마이드 모이스처 크림', 32800, 'KRW', 32800, 'ready_to_ship', now() - interval '5 hours', true),
    (v_user, 'EB-5840219', 'ebay', 'Olivia Smith', v_product, '제주 비자림 클렌징 밤', 34, 'USD', 47090, 'delivered', now() - interval '8 hours', true)
  on conflict (owner_id, channel_key, external_order_id) do update set status = excluded.status, updated_at = now();

  insert into sellerpilot_private.support_tickets (
    owner_id, external_ticket_id, channel_key, customer_name, subject, message, status, priority, received_at, demo
  ) values
    (v_user, 'CS-2841', 'qoo10', 'Yuki Tanaka', '배송 조회가 되지 않아요', '주문한 지 3일이 지났는데 아직 송장 조회가 되지 않습니다.', 'urgent', 1, now() - interval '8 minutes', true),
    (v_user, 'CS-2839', 'lazada', 'Nur Aisyah', '복용 방법 문의', 'Can I take two tablets at once after a meal?', 'waiting', 3, now() - interval '21 minutes', true),
    (v_user, 'CS-2826', 'smartstore', '김하은', '오늘 출고 가능한가요?', '오후 주문인데 오늘 출고 가능한지 궁금해요.', 'waiting', 2, now() - interval '4 hours', true),
    (v_user, 'CS-2823', 'ebay', 'Olivia Smith', 'International shipping', 'Is tracking included for international delivery?', 'in_progress', 3, now() - interval '5 hours', true)
  on conflict (owner_id, channel_key, external_ticket_id) do update set status = excluded.status, updated_at = now();

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, safe_detail)
  values (v_user, 'demo_seeded', 'workspace', jsonb_build_object('version', 1));
  return true;
end;
$$;

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
    'channels', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb) from sellerpilot_private.channels c),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'externalCode', p.external_code, 'sku', p.sku, 'name', p.name,
        'description', p.description, 'sourceUrl', p.source_url, 'imageUrl', p.image_url,
        'aiHeroPath', coalesce(aj.result_payload->'asset_storage_paths'->>'hero', aj.result_payload->>'hero_storage_path'),
        'status', p.status, 'onHand', p.on_hand, 'reserved', p.reserved,
        'available', p.on_hand - p.reserved, 'costKrw', p.cost_krw,
        'sold30d', coalesce(l.sold, 0), 'revenue30dKrw', coalesce(l.revenue, 0),
        'listingChannels', coalesce(l.channel_codes, '[]'::jsonb), 'demo', p.demo,
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
      where p.owner_id = v_user and p.status <> 'archived'
    ),
    'orders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'externalOrderId', o.external_order_id, 'channelKey', o.channel_key,
        'channelCode', c.code, 'customerName', o.customer_name, 'productName', o.product_name,
        'quantity', o.quantity, 'amount', o.amount, 'currency', o.currency,
        'amountKrw', o.amount_krw, 'status', o.status, 'orderedAt', o.ordered_at,
        'updatedAt', o.updated_at, 'demo', o.demo
      ) order by o.ordered_at desc), '[]'::jsonb)
      from sellerpilot_private.commerce_orders o
      join sellerpilot_private.channels c on c.key = o.channel_key
      where o.owner_id = v_user
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'externalTicketId', t.external_ticket_id, 'channelKey', t.channel_key,
        'channelCode', c.code, 'customerName', t.customer_name, 'subject', t.subject,
        'message', t.message, 'translatedMessage', t.translated_message,
        'replyDraft', t.reply_draft, 'status', t.status, 'priority', t.priority,
        'receivedAt', t.received_at, 'updatedAt', t.updated_at, 'demo', t.demo
      ) order by t.priority, t.received_at desc), '[]'::jsonb)
      from sellerpilot_private.support_tickets t
      join sellerpilot_private.channels c on c.key = t.channel_key
      where t.owner_id = v_user
    ),
    'summary', jsonb_build_object(
      'revenue30dKrw', coalesce((select sum(revenue_30d_krw) from sellerpilot_private.product_listings where owner_id = v_user), 0),
      'sold30d', coalesce((select sum(sold_30d) from sellerpilot_private.product_listings where owner_id = v_user), 0),
      'orderCount', (select count(*) from sellerpilot_private.commerce_orders where owner_id = v_user),
      'openTicketCount', (select count(*) from sellerpilot_private.support_tickets where owner_id = v_user and status <> 'resolved'),
      'lowStockCount', (select count(*) from sellerpilot_private.products where owner_id = v_user and on_hand - reserved <= reorder_point and status <> 'archived')
    )
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.sellerpilot_update_order_status(p_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_updated integer;
begin
  if not public.sellerpilot_is_admin() or p_status not in ('paid', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'refunded') then
    raise exception 'invalid order update' using errcode = '42501';
  end if;
  update sellerpilot_private.commerce_orders set status = p_status,
    shipped_at = case when p_status = 'shipped' then coalesce(shipped_at, now()) else shipped_at end,
    updated_at = now() where id = p_id and owner_id = auth.uid();
  get diagnostics v_updated = row_count;
  if v_updated = 1 then insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
    values (auth.uid(), 'status_updated', 'order', p_id::text, jsonb_build_object('status', p_status)); end if;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_update_ticket(
  p_id uuid, p_status text, p_reply_draft text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_updated integer;
begin
  if not public.sellerpilot_is_admin() or p_status not in ('urgent', 'waiting', 'in_progress', 'resolved') then
    raise exception 'invalid ticket update' using errcode = '42501';
  end if;
  update sellerpilot_private.support_tickets set status = p_status,
    reply_draft = left(nullif(trim(p_reply_draft), ''), 8000),
    resolved_at = case when p_status = 'resolved' then now() else null end,
    updated_at = now() where id = p_id and owner_id = auth.uid();
  get diagnostics v_updated = row_count;
  if v_updated = 1 then insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
    values (auth.uid(), 'ticket_updated', 'support_ticket', p_id::text, jsonb_build_object('status', p_status, 'has_reply', nullif(trim(p_reply_draft), '') is not null)); end if;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_save_margin_scenario(
  p_name text, p_channel_key text, p_inputs jsonb, p_result jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.sellerpilot_is_admin()
     or length(trim(coalesce(p_name, ''))) not between 1 and 120
     or p_channel_key not in ('qoo10', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay')
     or jsonb_typeof(p_inputs) <> 'object' or jsonb_typeof(p_result) <> 'object'
     or octet_length(p_inputs::text) > 32768 or octet_length(p_result::text) > 32768 then
    raise exception 'invalid margin scenario';
  end if;
  insert into sellerpilot_private.margin_scenarios (id, owner_id, name, channel_key, inputs, result)
  values (v_id, auth.uid(), trim(p_name), p_channel_key, p_inputs, p_result);
  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'scenario_saved', 'margin_scenario', v_id::text, jsonb_build_object('channel', p_channel_key));
  return v_id;
end;
$$;

create or replace function public.sellerpilot_create_product_from_ai(
  p_job_id uuid,
  p_name text,
  p_description text,
  p_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_suffix text := upper(substr(replace(p_job_id::text, '-', ''), 1, 10));
begin
  if not public.sellerpilot_is_admin()
     or length(trim(coalesce(p_name, ''))) not between 1 and 160
     or length(coalesce(p_description, '')) > 4000
     or length(coalesce(p_source_url, '')) > 1000
     or not exists (
       select 1 from sellerpilot_private.ai_cli_jobs
       where id = p_job_id and created_by = auth.uid() and status = 'succeeded'
     ) then
    raise exception 'invalid AI product';
  end if;

  insert into sellerpilot_private.products (
    id, owner_id, external_code, sku, name, description, source_url,
    ai_job_id, status, on_hand, reorder_point, demo
  ) values (
    v_id, auth.uid(), 'SP-AI-' || v_suffix, 'AI-' || v_suffix,
    trim(p_name), trim(coalesce(p_description, '')), nullif(trim(p_source_url), ''),
    p_job_id, 'draft', 0, 10, false
  )
  on conflict (owner_id, ai_job_id) do update set
    name = excluded.name,
    description = excluded.description,
    source_url = excluded.source_url,
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'product_created_from_ai', 'product', v_id::text, jsonb_build_object('job_id', p_job_id));
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_seed_demo_operations() from public, anon;
revoke all on function public.sellerpilot_get_operations_snapshot() from public, anon;
revoke all on function public.sellerpilot_update_order_status(uuid, text) from public, anon;
revoke all on function public.sellerpilot_update_ticket(uuid, text, text) from public, anon;
revoke all on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) from public, anon;
revoke all on function public.sellerpilot_create_product_from_ai(uuid, text, text, text) from public, anon;

grant execute on function public.sellerpilot_seed_demo_operations() to authenticated;
grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;
grant execute on function public.sellerpilot_update_order_status(uuid, text) to authenticated;
grant execute on function public.sellerpilot_update_ticket(uuid, text, text) to authenticated;
grant execute on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.sellerpilot_create_product_from_ai(uuid, text, text, text) to authenticated;

commit;
