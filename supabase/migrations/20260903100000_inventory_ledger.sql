-- Central inventory ledger (docs/무인_상품등록_자동화_구축_계획.md §10).
-- Append-only event ledger per SKU with replay-derived state:
--   판매가능재고 = 실재고(on_hand) - 예약재고(reserved) - 안전재고(safety_stock), 음수 불가.
--
-- Event types: RECEIPT, SALE_PENDING, SALE_CONFIRMED, CANCEL_RELEASE,
--              RETURN_RECEIVED, ADJUSTMENT, SAFETY_STOCK_CHANGE.
--
-- Concurrency fence: every mutation RPC locks the inventory_items row
-- (SELECT ... FOR UPDATE) first, then appends the ledger event and updates the
-- materialized state in the same transaction. The unique
-- (item_id, event_type, idempotency_key) constraint is the hard idempotency
-- fence, so the same 채널+주문번호+주문라인 can never deduct stock twice and
-- 10,000 concurrent orders can never drive stock negative.
--
-- This ledger is intentionally independent of products.on_hand/reserved
-- (channel inventory sync). A later migration can mirror products from items.

begin;

create table if not exists sellerpilot_private.inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sku text not null check (length(sku) between 1 and 240),
  product_id uuid references sellerpilot_private.products(id) on delete set null,
  on_hand integer not null default 0 check (on_hand between 0 and 99999999),
  reserved integer not null default 0 check (reserved between 0 and 99999999),
  safety_stock integer not null default 0 check (safety_stock between 0 and 99999999),
  ledger_seq bigint not null default 0 check (ledger_seq >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, sku),
  check (reserved <= on_hand)
);

-- 판매가능재고 is derived, never written by callers: the formula cannot drift
-- from the ledger counters.
alter table sellerpilot_private.inventory_items
  add column if not exists available integer
    generated always as (greatest(on_hand - reserved - safety_stock, 0)) stored;

create index if not exists inventory_items_owner_idx
  on sellerpilot_private.inventory_items (owner_id, updated_at desc);

create table if not exists sellerpilot_private.inventory_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references sellerpilot_private.inventory_items(id) on delete cascade,
  sequence bigint not null check (sequence >= 1),
  event_type text not null check (event_type in (
    'RECEIPT', 'SALE_PENDING', 'SALE_CONFIRMED', 'CANCEL_RELEASE',
    'RETURN_RECEIVED', 'ADJUSTMENT', 'SAFETY_STOCK_CHANGE'
  )),
  idempotency_key text not null check (length(idempotency_key) between 8 and 240),
  order_key text check (order_key is null or length(order_key) between 8 and 600),
  channel_key text,
  quantity integer not null default 0 check (quantity between 0 and 99999999),
  on_hand_delta integer not null default 0 check (on_hand_delta between -99999999 and 99999999),
  reserved_delta integer not null default 0 check (reserved_delta between -99999999 and 99999999),
  safety_stock_delta integer not null default 0 check (safety_stock_delta between -99999999 and 99999999),
  on_hand_after integer not null check (on_hand_after between 0 and 99999999),
  reserved_after integer not null check (reserved_after between 0 and 99999999),
  safety_stock_after integer not null check (safety_stock_after between 0 and 99999999),
  available_after integer not null check (available_after between 0 and 99999999),
  reason text not null default '' check (length(reason) <= 2000),
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  unique (item_id, event_type, idempotency_key),
  unique (item_id, sequence),
  check (reserved_after <= on_hand_after),
  check (available_after = greatest(on_hand_after - reserved_after - safety_stock_after, 0))
);

create index if not exists inventory_ledger_item_time_idx
  on sellerpilot_private.inventory_ledger (item_id, occurred_at desc, id desc);
create index if not exists inventory_ledger_owner_time_idx
  on sellerpilot_private.inventory_ledger (owner_id, occurred_at desc);
create index if not exists inventory_ledger_order_idx
  on sellerpilot_private.inventory_ledger (item_id, order_key)
  where order_key is not null;

create table if not exists sellerpilot_private.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references sellerpilot_private.inventory_items(id) on delete cascade,
  order_key text not null check (length(order_key) between 8 and 600),
  channel_key text not null check (length(channel_key) between 1 and 40),
  external_order_id text not null check (length(external_order_id) between 1 and 240),
  order_line_key text not null check (length(order_line_key) between 1 and 240),
  quantity integer not null check (quantity between 1 and 99999999),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'released')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (item_id, order_key)
);

create index if not exists inventory_reservations_status_idx
  on sellerpilot_private.inventory_reservations (item_id, status, created_at desc);

alter table sellerpilot_private.inventory_items enable row level security;
alter table sellerpilot_private.inventory_ledger enable row level security;
alter table sellerpilot_private.inventory_reservations enable row level security;

revoke all on sellerpilot_private.inventory_items from public, anon, authenticated;
revoke all on sellerpilot_private.inventory_ledger from public, anon, authenticated;
revoke all on sellerpilot_private.inventory_reservations from public, anon, authenticated;

create or replace function sellerpilot_private.inventory_item_snapshot(
  p_item sellerpilot_private.inventory_items
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'itemId', p_item.id,
    'sku', p_item.sku,
    'onHand', p_item.on_hand,
    'reserved', p_item.reserved,
    'safetyStock', p_item.safety_stock,
    'available', greatest(p_item.on_hand - p_item.reserved - p_item.safety_stock, 0),
    'sequence', p_item.ledger_seq
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role RPCs: order flows from channel workers (webhook/polling).
-- p_owner must be a registered admin user; item rows stay private behind RLS.
-- ---------------------------------------------------------------------------

create or replace function public.sellerpilot_inventory_receipt(
  p_owner uuid,
  p_sku text,
  p_quantity integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item sellerpilot_private.inventory_items%rowtype;
  v_seq bigint;
  v_replayed boolean := false;
  v_actor uuid;
begin
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_idempotency_key := trim(coalesce(p_idempotency_key, ''));
  if p_sku = ''
     or p_quantity not between 1 and 99999999
     or length(p_idempotency_key) not between 8 and 240
     or not exists (
       select 1 from sellerpilot_private.admin_users u where u.user_id = p_owner
     ) then
    raise exception 'invalid inventory receipt';
  end if;

  -- Get-or-create the item. The unique (owner_id, sku) fence plus the row lock
  -- below makes concurrent first receipts safe.
  insert into sellerpilot_private.inventory_items (owner_id, sku, product_id)
  select p_owner, p_sku, (
    select p.id
      from sellerpilot_private.products p
     where p.owner_id = p_owner and p.sku = p_sku
     order by p.created_at desc
     limit 1
  )
  on conflict (owner_id, sku) do nothing;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = p_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'RECEIPT'
       and l.idempotency_key = p_idempotency_key
  ) then
    v_replayed := true;
  else
    v_seq := v_item.ledger_seq + 1;
    v_actor := coalesce(auth.uid(), p_owner);
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      p_owner, v_item.id, v_seq, 'RECEIPT', p_idempotency_key, null, null,
      p_quantity, p_quantity, 0, 0,
      v_item.on_hand + p_quantity, v_item.reserved, v_item.safety_stock,
      greatest(v_item.on_hand + p_quantity - v_item.reserved - v_item.safety_stock, 0),
      '입고', v_actor
    );
    update sellerpilot_private.inventory_items
       set on_hand = on_hand + p_quantity,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.on_hand := v_item.on_hand + p_quantity;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      p_owner, 'inventory_receipt', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'quantity', p_quantity,
        'idempotencyKey', p_idempotency_key,
        'sequence', v_seq
      )
    );
  end if;

  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'replayed', v_replayed);
end;
$$;

create or replace function public.sellerpilot_inventory_reserve(
  p_owner uuid,
  p_sku text,
  p_channel text,
  p_external_order_id text,
  p_order_line_key text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item sellerpilot_private.inventory_items%rowtype;
  v_order_key text;
  v_seq bigint;
  v_reservation_id uuid;
  v_replayed boolean := false;
  v_actor uuid;
begin
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_channel := lower(trim(coalesce(p_channel, '')));
  p_external_order_id := trim(coalesce(p_external_order_id, ''));
  p_order_line_key := trim(coalesce(p_order_line_key, ''));
  if p_sku = ''
     or p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang', 'elevenst',
       'smartstore', 'ebay', 'temu', 'alibaba', 'one688'
     )
     or length(p_external_order_id) not between 1 and 240
     or length(p_order_line_key) not between 1 and 240
     or p_quantity not between 1 and 99999999
     or not exists (
       select 1 from sellerpilot_private.admin_users u where u.user_id = p_owner
     ) then
    raise exception 'invalid inventory reserve';
  end if;
  v_order_key := p_channel || ':' || p_external_order_id || ':' || p_order_line_key;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = p_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'SALE_PENDING'
       and l.idempotency_key = v_order_key
  ) then
    v_replayed := true;
  else
    if v_item.on_hand - v_item.reserved - v_item.safety_stock < p_quantity then
      raise exception 'INSUFFICIENT_STOCK';
    end if;
    v_seq := v_item.ledger_seq + 1;
    v_actor := coalesce(auth.uid(), p_owner);
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      p_owner, v_item.id, v_seq, 'SALE_PENDING', v_order_key, v_order_key, p_channel,
      p_quantity, 0, p_quantity, 0,
      v_item.on_hand, v_item.reserved + p_quantity, v_item.safety_stock,
      greatest(v_item.on_hand - (v_item.reserved + p_quantity) - v_item.safety_stock, 0),
      '주문 접수 예약', v_actor
    );
    insert into sellerpilot_private.inventory_reservations (
      owner_id, item_id, order_key, channel_key, external_order_id,
      order_line_key, quantity, status
    ) values (
      p_owner, v_item.id, v_order_key, p_channel, p_external_order_id,
      p_order_line_key, p_quantity, 'pending'
    )
    on conflict (item_id, order_key) do nothing
    returning id into v_reservation_id;
    if v_reservation_id is null then
      select r.id into v_reservation_id
        from sellerpilot_private.inventory_reservations r
       where r.item_id = v_item.id and r.order_key = v_order_key;
    end if;
    update sellerpilot_private.inventory_items
       set reserved = reserved + p_quantity,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.reserved := v_item.reserved + p_quantity;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      p_owner, 'inventory_reserved', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'channel', p_channel,
        'externalOrderId', p_external_order_id,
        'orderLineKey', p_order_line_key,
        'quantity', p_quantity,
        'reservationId', v_reservation_id,
        'sequence', v_seq
      )
    );
  end if;

  select r.id into v_reservation_id
    from sellerpilot_private.inventory_reservations r
   where r.item_id = v_item.id and r.order_key = v_order_key;
  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object(
      'ok', true,
      'replayed', v_replayed,
      'reservationId', v_reservation_id
    );
end;
$$;

create or replace function public.sellerpilot_inventory_confirm(
  p_owner uuid,
  p_sku text,
  p_channel text,
  p_external_order_id text,
  p_order_line_key text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item sellerpilot_private.inventory_items%rowtype;
  v_order_key text;
  v_seq bigint;
  v_reservation sellerpilot_private.inventory_reservations%rowtype;
  v_replayed boolean := false;
  v_actor uuid;
begin
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_channel := lower(trim(coalesce(p_channel, '')));
  p_external_order_id := trim(coalesce(p_external_order_id, ''));
  p_order_line_key := trim(coalesce(p_order_line_key, ''));
  if p_sku = ''
     or p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang', 'elevenst',
       'smartstore', 'ebay', 'temu', 'alibaba', 'one688'
     )
     or length(p_external_order_id) not between 1 and 240
     or length(p_order_line_key) not between 1 and 240
     or p_quantity not between 1 and 99999999
     or not exists (
       select 1 from sellerpilot_private.admin_users u where u.user_id = p_owner
     ) then
    raise exception 'invalid inventory confirm';
  end if;
  v_order_key := p_channel || ':' || p_external_order_id || ':' || p_order_line_key;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = p_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'SALE_CONFIRMED'
       and l.idempotency_key = v_order_key
  ) then
    v_replayed := true;
  else
    select * into v_reservation
      from sellerpilot_private.inventory_reservations r
     where r.item_id = v_item.id
       and r.order_key = v_order_key
       and r.status = 'pending'
     for update;
    if v_reservation.id is null then
      raise exception 'RESERVATION_NOT_FOUND';
    end if;
    if v_reservation.quantity <> p_quantity then
      raise exception 'RESERVATION_QUANTITY_MISMATCH';
    end if;

    v_seq := v_item.ledger_seq + 1;
    v_actor := coalesce(auth.uid(), p_owner);
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      p_owner, v_item.id, v_seq, 'SALE_CONFIRMED', v_order_key, v_order_key, p_channel,
      p_quantity, -p_quantity, -p_quantity, 0,
      v_item.on_hand - p_quantity, v_item.reserved - p_quantity, v_item.safety_stock,
      greatest((v_item.on_hand - p_quantity) - (v_item.reserved - p_quantity) - v_item.safety_stock, 0),
      '판매 확정', v_actor
    );
    update sellerpilot_private.inventory_reservations
       set status = 'confirmed',
           confirmed_at = now(),
           updated_at = now()
     where id = v_reservation.id;
    update sellerpilot_private.inventory_items
       set on_hand = on_hand - p_quantity,
           reserved = reserved - p_quantity,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.on_hand := v_item.on_hand - p_quantity;
    v_item.reserved := v_item.reserved - p_quantity;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      p_owner, 'inventory_sale_confirmed', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'channel', p_channel,
        'externalOrderId', p_external_order_id,
        'orderLineKey', p_order_line_key,
        'quantity', p_quantity,
        'reservationId', v_reservation.id,
        'sequence', v_seq
      )
    );
  end if;

  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'replayed', v_replayed);
end;
$$;

create or replace function public.sellerpilot_inventory_cancel_release(
  p_owner uuid,
  p_sku text,
  p_channel text,
  p_external_order_id text,
  p_order_line_key text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item sellerpilot_private.inventory_items%rowtype;
  v_order_key text;
  v_seq bigint;
  v_reservation sellerpilot_private.inventory_reservations%rowtype;
  v_replayed boolean := false;
  v_actor uuid;
begin
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_channel := lower(trim(coalesce(p_channel, '')));
  p_external_order_id := trim(coalesce(p_external_order_id, ''));
  p_order_line_key := trim(coalesce(p_order_line_key, ''));
  if p_sku = ''
     or p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang', 'elevenst',
       'smartstore', 'ebay', 'temu', 'alibaba', 'one688'
     )
     or length(p_external_order_id) not between 1 and 240
     or length(p_order_line_key) not between 1 and 240
     or p_quantity not between 1 and 99999999
     or not exists (
       select 1 from sellerpilot_private.admin_users u where u.user_id = p_owner
     ) then
    raise exception 'invalid inventory cancel';
  end if;
  v_order_key := p_channel || ':' || p_external_order_id || ':' || p_order_line_key;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = p_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'CANCEL_RELEASE'
       and l.idempotency_key = v_order_key
  ) then
    v_replayed := true;
  else
    select * into v_reservation
      from sellerpilot_private.inventory_reservations r
     where r.item_id = v_item.id
       and r.order_key = v_order_key
       and r.status = 'pending'
     for update;
    if v_reservation.id is null then
      raise exception 'RESERVATION_NOT_FOUND';
    end if;
    if v_reservation.quantity <> p_quantity then
      raise exception 'RESERVATION_QUANTITY_MISMATCH';
    end if;

    v_seq := v_item.ledger_seq + 1;
    v_actor := coalesce(auth.uid(), p_owner);
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      p_owner, v_item.id, v_seq, 'CANCEL_RELEASE', v_order_key, v_order_key, p_channel,
      p_quantity, 0, -p_quantity, 0,
      v_item.on_hand, v_item.reserved - p_quantity, v_item.safety_stock,
      greatest(v_item.on_hand - (v_item.reserved - p_quantity) - v_item.safety_stock, 0),
      '취소로 예약 해제', v_actor
    );
    update sellerpilot_private.inventory_reservations
       set status = 'released',
           released_at = now(),
           updated_at = now()
     where id = v_reservation.id;
    update sellerpilot_private.inventory_items
       set reserved = reserved - p_quantity,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.reserved := v_item.reserved - p_quantity;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      p_owner, 'inventory_cancel_released', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'channel', p_channel,
        'externalOrderId', p_external_order_id,
        'orderLineKey', p_order_line_key,
        'quantity', p_quantity,
        'reservationId', v_reservation.id,
        'sequence', v_seq
      )
    );
  end if;

  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'replayed', v_replayed);
end;
$$;

create or replace function public.sellerpilot_inventory_return_received(
  p_owner uuid,
  p_sku text,
  p_quantity integer,
  p_idempotency_key text,
  p_channel text default null,
  p_external_order_id text default null,
  p_order_line_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item sellerpilot_private.inventory_items%rowtype;
  v_order_key text;
  v_seq bigint;
  v_replayed boolean := false;
  v_actor uuid;
begin
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_idempotency_key := trim(coalesce(p_idempotency_key, ''));
  p_channel := lower(nullif(trim(coalesce(p_channel, '')), ''));
  p_external_order_id := nullif(trim(coalesce(p_external_order_id, '')), '');
  p_order_line_key := nullif(trim(coalesce(p_order_line_key, '')), '');
  if p_sku = ''
     or p_quantity not between 1 and 99999999
     or length(p_idempotency_key) not between 8 and 240
     or (
       p_channel is not null
       and p_channel not in (
         'qoo10', 'shopee', 'lazada', 'coupang', 'elevenst',
         'smartstore', 'ebay', 'temu', 'alibaba', 'one688'
       )
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users u where u.user_id = p_owner
     ) then
    raise exception 'invalid inventory return';
  end if;
  if p_channel is not null and p_external_order_id is not null and p_order_line_key is not null then
    if length(p_external_order_id) not between 1 and 240
       or length(p_order_line_key) not between 1 and 240 then
      raise exception 'invalid inventory return';
    end if;
    v_order_key := p_channel || ':' || p_external_order_id || ':' || p_order_line_key;
  end if;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = p_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'RETURN_RECEIVED'
       and l.idempotency_key = p_idempotency_key
  ) then
    v_replayed := true;
  else
    v_seq := v_item.ledger_seq + 1;
    v_actor := coalesce(auth.uid(), p_owner);
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      p_owner, v_item.id, v_seq, 'RETURN_RECEIVED', p_idempotency_key, v_order_key, p_channel,
      p_quantity, p_quantity, 0, 0,
      v_item.on_hand + p_quantity, v_item.reserved, v_item.safety_stock,
      greatest(v_item.on_hand + p_quantity - v_item.reserved - v_item.safety_stock, 0),
      '검수 후 반품 재입고', v_actor
    );
    update sellerpilot_private.inventory_items
       set on_hand = on_hand + p_quantity,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.on_hand := v_item.on_hand + p_quantity;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      p_owner, 'inventory_return_received', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'quantity', p_quantity,
        'idempotencyKey', p_idempotency_key,
        'sequence', v_seq
      )
    );
  end if;

  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'replayed', v_replayed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role read RPC: channel stock propagation workers reconcile against
-- the central ledger every 15 minutes.
-- ---------------------------------------------------------------------------

create or replace function public.sellerpilot_service_get_inventory(
  p_owner uuid,
  p_sku text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item sellerpilot_private.inventory_items%rowtype;
begin
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  if p_sku = '' then
    raise exception 'invalid inventory sku';
  end if;
  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = p_owner and i.sku = p_sku;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'found', false, 'sku', p_sku);
  end if;
  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'found', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs: 실사 보정(ADJUSTMENT)과 안전재고 변경(SAFETY_STOCK_CHANGE).
-- Owner is derived from auth.uid(); authenticated admins only.
-- ---------------------------------------------------------------------------

create or replace function public.sellerpilot_inventory_adjust(
  p_sku text,
  p_new_on_hand integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_item sellerpilot_private.inventory_items%rowtype;
  v_key text;
  v_seq bigint;
  v_delta integer;
  v_replayed boolean := false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_reason := trim(coalesce(p_reason, ''));
  p_idempotency_key := trim(coalesce(p_idempotency_key, ''));
  if p_sku = ''
     or p_new_on_hand not between 0 and 99999999
     or length(p_reason) not between 1 and 2000 then
    raise exception 'invalid inventory adjustment';
  end if;
  v_key := p_idempotency_key;
  if length(v_key) not between 8 and 240 then
    if v_key <> '' then
      raise exception 'invalid inventory adjustment';
    end if;
    v_key := 'adjust:' || gen_random_uuid()::text;
  end if;

  -- 실사 보정은 입고 이력이 없어도 아이템을 만들 수 있어야 한다(부트스트랩).
  insert into sellerpilot_private.inventory_items (owner_id, sku, product_id)
  select v_owner, p_sku, (
    select p.id
      from sellerpilot_private.products p
     where p.owner_id = v_owner and p.sku = p_sku
     order by p.created_at desc
     limit 1
  )
  on conflict (owner_id, sku) do nothing;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = v_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'ADJUSTMENT'
       and l.idempotency_key = v_key
  ) then
    v_replayed := true;
  else
    if v_item.reserved > p_new_on_hand then
      raise exception 'ADJUSTMENT_BELOW_RESERVED';
    end if;
    v_delta := p_new_on_hand - v_item.on_hand;
    v_seq := v_item.ledger_seq + 1;
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      v_owner, v_item.id, v_seq, 'ADJUSTMENT', v_key, null, null,
      p_new_on_hand, v_delta, 0, 0,
      p_new_on_hand, v_item.reserved, v_item.safety_stock,
      greatest(p_new_on_hand - v_item.reserved - v_item.safety_stock, 0),
      p_reason, v_owner
    );
    update sellerpilot_private.inventory_items
       set on_hand = p_new_on_hand,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.on_hand := p_new_on_hand;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner, 'inventory_adjusted', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'newOnHand', p_new_on_hand,
        'delta', v_delta,
        'reason', p_reason,
        'sequence', v_seq
      )
    );
  end if;

  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'replayed', v_replayed);
end;
$$;

create or replace function public.sellerpilot_inventory_set_safety_stock(
  p_sku text,
  p_safety_stock integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_item sellerpilot_private.inventory_items%rowtype;
  v_key text;
  v_seq bigint;
  v_delta integer;
  v_replayed boolean := false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  p_sku := left(trim(coalesce(p_sku, '')), 240);
  p_idempotency_key := trim(coalesce(p_idempotency_key, ''));
  if p_sku = ''
     or p_safety_stock not between 0 and 99999999 then
    raise exception 'invalid safety stock change';
  end if;
  v_key := p_idempotency_key;
  if length(v_key) not between 8 and 240 then
    if v_key <> '' then
      raise exception 'invalid safety stock change';
    end if;
    v_key := 'safety:' || gen_random_uuid()::text;
  end if;

  select * into v_item
    from sellerpilot_private.inventory_items i
   where i.owner_id = v_owner and i.sku = p_sku
   for update;
  if v_item.id is null then
    raise exception 'inventory item not found';
  end if;

  if exists (
    select 1 from sellerpilot_private.inventory_ledger l
     where l.item_id = v_item.id
       and l.event_type = 'SAFETY_STOCK_CHANGE'
       and l.idempotency_key = v_key
  ) then
    v_replayed := true;
  else
    v_delta := p_safety_stock - v_item.safety_stock;
    v_seq := v_item.ledger_seq + 1;
    insert into sellerpilot_private.inventory_ledger (
      owner_id, item_id, sequence, event_type, idempotency_key, order_key, channel_key,
      quantity, on_hand_delta, reserved_delta, safety_stock_delta,
      on_hand_after, reserved_after, safety_stock_after, available_after,
      reason, actor_id
    ) values (
      v_owner, v_item.id, v_seq, 'SAFETY_STOCK_CHANGE', v_key, null, null,
      p_safety_stock, 0, 0, v_delta,
      v_item.on_hand, v_item.reserved, p_safety_stock,
      greatest(v_item.on_hand - v_item.reserved - p_safety_stock, 0),
      '안전재고 변경', v_owner
    );
    update sellerpilot_private.inventory_items
       set safety_stock = p_safety_stock,
           ledger_seq = v_seq,
           updated_at = now()
     where id = v_item.id;
    v_item.safety_stock := p_safety_stock;
    v_item.ledger_seq := v_seq;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner, 'inventory_safety_stock_changed', 'inventory_item', v_item.id::text,
      jsonb_build_object(
        'sku', p_sku,
        'safetyStock', p_safety_stock,
        'delta', v_delta,
        'sequence', v_seq
      )
    );
  end if;

  return sellerpilot_private.inventory_item_snapshot(v_item)
    || jsonb_build_object('ok', true, 'replayed', v_replayed);
end;
$$;

-- Admin read: item snapshot + pending reservations + recent ledger events.
create or replace function public.sellerpilot_get_inventory_item(p_sku text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not public.sellerpilot_is_admin() then null
    else (
      select jsonb_build_object(
        'itemId', i.id,
        'sku', i.sku,
        'onHand', i.on_hand,
        'reserved', i.reserved,
        'safetyStock', i.safety_stock,
        'available', greatest(i.on_hand - i.reserved - i.safety_stock, 0),
        'sequence', i.ledger_seq,
        'reservations', coalesce((
          select jsonb_agg(pending.event)
            from (
              select jsonb_build_object(
                'reservationId', r.id,
                'orderKey', r.order_key,
                'channel', r.channel_key,
                'externalOrderId', r.external_order_id,
                'orderLineKey', r.order_line_key,
                'quantity', r.quantity,
                'status', r.status,
                'createdAt', r.created_at,
                'confirmedAt', r.confirmed_at,
                'releasedAt', r.released_at
              ) as event
                from sellerpilot_private.inventory_reservations r
               where r.item_id = i.id and r.status = 'pending'
               order by r.created_at desc, r.id desc
            ) pending
        ), '[]'::jsonb),
        'events', coalesce((
          select jsonb_agg(recent.event)
            from (
              select jsonb_build_object(
                'sequence', l.sequence,
                'eventType', l.event_type,
                'idempotencyKey', l.idempotency_key,
                'orderKey', l.order_key,
                'channel', l.channel_key,
                'quantity', l.quantity,
                'onHandDelta', l.on_hand_delta,
                'reservedDelta', l.reserved_delta,
                'safetyStockDelta', l.safety_stock_delta,
                'onHandAfter', l.on_hand_after,
                'reservedAfter', l.reserved_after,
                'safetyStockAfter', l.safety_stock_after,
                'availableAfter', l.available_after,
                'reason', l.reason,
                'occurredAt', l.occurred_at
              ) as event
                from sellerpilot_private.inventory_ledger l
               where l.item_id = i.id
               order by l.sequence desc
               limit 50
            ) recent
        ), '[]'::jsonb)
      )
        from sellerpilot_private.inventory_items i
       where i.owner_id = auth.uid()
         and i.sku = left(trim(coalesce(p_sku, '')), 240)
       limit 1
    )
  end;
$$;

revoke all on function sellerpilot_private.inventory_item_snapshot(sellerpilot_private.inventory_items)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_inventory_receipt(uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_inventory_reserve(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_inventory_confirm(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_inventory_cancel_release(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_inventory_return_received(uuid, text, integer, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_get_inventory(uuid, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_inventory_adjust(text, integer, text, text)
  from public, anon;
revoke all on function public.sellerpilot_inventory_set_safety_stock(text, integer, text)
  from public, anon;
revoke all on function public.sellerpilot_get_inventory_item(text)
  from public, anon;

grant execute on function public.sellerpilot_inventory_receipt(uuid, text, integer, text)
  to service_role;
grant execute on function public.sellerpilot_inventory_reserve(uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.sellerpilot_inventory_confirm(uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.sellerpilot_inventory_cancel_release(uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.sellerpilot_inventory_return_received(uuid, text, integer, text, text, text, text)
  to service_role;
grant execute on function public.sellerpilot_service_get_inventory(uuid, text)
  to service_role;
grant execute on function public.sellerpilot_inventory_adjust(text, integer, text, text)
  to authenticated;
grant execute on function public.sellerpilot_inventory_set_safety_stock(text, integer, text)
  to authenticated;
grant execute on function public.sellerpilot_get_inventory_item(text)
  to authenticated;

commit;
