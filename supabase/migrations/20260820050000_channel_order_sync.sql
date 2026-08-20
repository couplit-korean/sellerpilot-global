-- Persist normalized marketplace orders and expose honest per-channel sync health.

begin;

create table if not exists sellerpilot_private.channel_sync_state (
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_key text not null references sellerpilot_private.channels(key),
  data_type text not null check (data_type in ('orders', 'inquiries')),
  status text not null default 'never' check (status in ('never', 'queued', 'running', 'passed', 'failed', 'unsupported')),
  imported_count integer not null default 0 check (imported_count >= 0),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, channel_key, data_type)
);

create index if not exists channel_sync_state_owner_time_idx
  on sellerpilot_private.channel_sync_state (owner_id, updated_at desc);

alter table sellerpilot_private.channel_sync_state enable row level security;
revoke all on sellerpilot_private.channel_sync_state from public, anon, authenticated;

create or replace function public.sellerpilot_service_mark_channel_sync(
  p_credential_id uuid,
  p_channel text,
  p_data_type text,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
begin
  if p_data_type not in ('orders', 'inquiries')
     or p_status not in ('queued', 'running', 'failed', 'unsupported')
     or length(coalesce(p_error, '')) > 500 then
    raise exception 'invalid channel sync state';
  end if;

  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel;
  if v_owner is null then raise exception 'channel credential not found'; end if;

  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status, last_started_at, last_error, updated_at
  ) values (
    v_owner, p_channel, p_data_type, p_status,
    case when p_status in ('queued', 'running') then now() else null end,
    nullif(left(coalesce(p_error, ''), 500), ''), now()
  )
  on conflict (owner_id, channel_key, data_type) do update set
    status = excluded.status,
    last_started_at = case when excluded.status in ('queued', 'running') then now() else sellerpilot_private.channel_sync_state.last_started_at end,
    last_error = excluded.last_error,
    updated_at = now();
  return true;
end;
$$;

create or replace function public.sellerpilot_service_ingest_orders(
  p_credential_id uuid,
  p_channel text,
  p_orders jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
  v_order jsonb;
  v_count integer := 0;
  v_ledger_count integer := 0;
  v_external_id text;
  v_status text;
begin
  if jsonb_typeof(p_orders) <> 'array'
     or jsonb_array_length(p_orders) > 500
     or octet_length(p_orders::text) > 1000000 then
    raise exception 'invalid normalized orders';
  end if;

  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status in ('active', 'grace');
  if v_owner is null then raise exception 'active channel credential required'; end if;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    v_external_id := left(trim(coalesce(v_order->>'externalOrderId', '')), 240);
    v_status := coalesce(v_order->>'status', 'paid');
    if v_external_id = '' or v_status not in ('paid', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'refunded') then
      continue;
    end if;

    insert into sellerpilot_private.commerce_orders (
      owner_id, external_order_id, channel_key, customer_name, product_name,
      quantity, amount, currency, amount_krw, status, ordered_at, demo, updated_at
    ) values (
      v_owner,
      v_external_id,
      p_channel,
      left(coalesce(nullif(trim(v_order->>'customerName'), ''), '마켓 구매자'), 240),
      left(coalesce(nullif(trim(v_order->>'productName'), ''), '주문 상품'), 500),
      greatest(1, least(999999, coalesce((v_order->>'quantity')::integer, 1))),
      greatest(0, coalesce((v_order->>'amount')::numeric, 0)),
      upper(left(coalesce(nullif(trim(v_order->>'currency'), ''), 'KRW'), 3)),
      greatest(0, coalesce((v_order->>'amountKrw')::numeric, 0)),
      v_status,
      coalesce((v_order->>'orderedAt')::timestamptz, now()),
      false,
      now()
    )
    on conflict (owner_id, channel_key, external_order_id) do update set
      customer_name = excluded.customer_name,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      amount = excluded.amount,
      currency = excluded.currency,
      amount_krw = excluded.amount_krw,
      status = excluded.status,
      ordered_at = excluded.ordered_at,
      demo = false,
      updated_at = now();
    v_count := v_count + 1;
  end loop;

  select count(*) into v_ledger_count
    from sellerpilot_private.commerce_orders o
   where o.owner_id = v_owner
     and o.channel_key = p_channel
     and not o.demo;

  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status, imported_count,
    last_started_at, last_succeeded_at, last_error, updated_at
  ) values (
    v_owner, p_channel, 'orders', 'passed', v_ledger_count, now(), now(), null, now()
  )
  on conflict (owner_id, channel_key, data_type) do update set
    status = 'passed',
    imported_count = excluded.imported_count,
    last_succeeded_at = now(),
    last_error = null,
    updated_at = now();

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, safe_detail)
  values (v_owner, 'channel_orders_synced', 'channel', jsonb_build_object(
    'channel', p_channel,
    'response_count', v_count,
    'ledger_count', v_ledger_count
  ));
  return v_count;
end;
$$;

create or replace function public.sellerpilot_get_channel_sync_status()
returns table (
  channel_key text,
  data_type text,
  status text,
  imported_count integer,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return query
  select s.channel_key, s.data_type, s.status, s.imported_count,
         s.last_started_at, s.last_succeeded_at, s.last_error, s.updated_at
    from sellerpilot_private.channel_sync_state s
   where s.owner_id = auth.uid()
   order by s.channel_key, s.data_type;
end;
$$;

revoke all on function public.sellerpilot_service_mark_channel_sync(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_ingest_orders(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.sellerpilot_get_channel_sync_status() from public, anon;
grant execute on function public.sellerpilot_service_mark_channel_sync(uuid, text, text, text, text) to service_role;
grant execute on function public.sellerpilot_service_ingest_orders(uuid, text, jsonb) to service_role;
grant execute on function public.sellerpilot_get_channel_sync_status() to authenticated;

commit;
