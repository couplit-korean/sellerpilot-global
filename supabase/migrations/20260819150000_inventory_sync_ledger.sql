-- Keep one authoritative product quantity synchronized with every published
-- marketplace listing. A run snapshots its target listings so retries never
-- silently skip or add channels midway through a write.

begin;

alter table sellerpilot_private.product_listings
  add column if not exists last_inventory_quantity integer check (last_inventory_quantity is null or last_inventory_quantity >= 0),
  add column if not exists inventory_sync_status text not null default 'never'
    check (inventory_sync_status in ('never', 'pending', 'succeeded', 'failed')),
  add column if not exists inventory_sync_error text,
  add column if not exists last_inventory_synced_at timestamptz;

create table sellerpilot_private.inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 16 and 160),
  requested_on_hand integer not null check (requested_on_hand between 0 and 99999999),
  available_quantity integer not null check (available_quantity between 0 and 99999999),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'partial', 'failed', 'superseded')),
  total_count integer not null default 0 check (total_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create table sellerpilot_private.inventory_sync_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references sellerpilot_private.inventory_sync_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete cascade,
  channel text not null check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')),
  market text not null default '',
  target_id text not null default '',
  remote_id text not null check (length(remote_id) between 1 and 240),
  requested_quantity integer not null check (requested_quantity between 0 and 99999999),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'superseded')),
  operation_attempt_id uuid references sellerpilot_private.channel_operation_attempts(id) on delete set null,
  safe_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (run_id, listing_id)
);

create index inventory_sync_runs_product_idx
  on sellerpilot_private.inventory_sync_runs (owner_id, product_id, created_at desc);
create index inventory_sync_items_run_status_idx
  on sellerpilot_private.inventory_sync_items (run_id, status, channel);

alter table sellerpilot_private.inventory_sync_runs enable row level security;
alter table sellerpilot_private.inventory_sync_items enable row level security;
revoke all on sellerpilot_private.inventory_sync_runs from public, anon, authenticated;
revoke all on sellerpilot_private.inventory_sync_items from public, anon, authenticated;

create or replace function public.sellerpilot_get_inventory_sync(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select case when not public.sellerpilot_is_admin() then null else (
    select jsonb_build_object(
      'runId', r.id, 'status', r.status, 'requestedOnHand', r.requested_on_hand,
      'availableQuantity', r.available_quantity, 'totalCount', r.total_count,
      'succeededCount', r.succeeded_count, 'failedCount', r.failed_count,
      'createdAt', r.created_at, 'completedAt', r.completed_at,
      'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'listingId', i.listing_id, 'channel', i.channel,
        'market', i.market, 'targetId', i.target_id, 'remoteId', i.remote_id,
        'quantity', i.requested_quantity, 'status', i.status, 'safeMessage', i.safe_message,
        'attemptId', i.operation_attempt_id, 'completedAt', i.completed_at
      ) order by i.channel, i.market, i.target_id) from sellerpilot_private.inventory_sync_items i where i.run_id = r.id), '[]'::jsonb)
    )
      from sellerpilot_private.inventory_sync_runs r
     where r.owner_id = auth.uid() and r.product_id = p_product_id
     order by r.created_at desc limit 1
  ) end
$$;

create or replace function public.sellerpilot_start_inventory_sync(
  p_product_id uuid,
  p_on_hand integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid := auth.uid();
  v_run_id uuid;
  v_reserved integer;
  v_reorder_point integer;
  v_available integer;
  v_status text;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_on_hand not between 0 and 99999999
     or length(trim(coalesce(p_idempotency_key, ''))) not between 16 and 160 then
    raise exception 'invalid inventory sync request';
  end if;

  select p.reserved, p.reorder_point
    into v_reserved, v_reorder_point
    from sellerpilot_private.products p
   where p.id = p_product_id and p.owner_id = v_owner and not p.demo and p.status <> 'archived'
   for update;
  if v_reserved is null then raise exception 'product not found'; end if;
  if p_on_hand < v_reserved then raise exception 'on hand cannot be below reserved inventory'; end if;

  select r.id, r.status
    into v_run_id, v_status
    from sellerpilot_private.inventory_sync_runs r
   where r.owner_id = v_owner and r.idempotency_key = trim(p_idempotency_key);
  if v_run_id is not null then
    if not exists (
      select 1 from sellerpilot_private.inventory_sync_runs r
       where r.id = v_run_id and r.product_id = p_product_id and r.requested_on_hand = p_on_hand
    ) then raise exception 'idempotency key payload mismatch'; end if;
    return (
      select jsonb_build_object(
        'runId', r.id, 'status', r.status, 'requestedOnHand', r.requested_on_hand,
        'availableQuantity', r.available_quantity, 'totalCount', r.total_count,
        'succeededCount', r.succeeded_count, 'failedCount', r.failed_count,
        'tasks', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'listingId', i.listing_id, 'channel', i.channel,
          'market', i.market, 'targetId', i.target_id, 'remoteId', i.remote_id,
          'quantity', i.requested_quantity, 'status', i.status, 'safeMessage', i.safe_message
        ) order by i.channel, i.market, i.target_id) from sellerpilot_private.inventory_sync_items i where i.run_id = r.id), '[]'::jsonb)
      ) from sellerpilot_private.inventory_sync_runs r where r.id = v_run_id
    );
  end if;

  update sellerpilot_private.inventory_sync_items i
     set status = 'superseded', completed_at = now(), updated_at = now()
   where i.owner_id = v_owner and i.product_id = p_product_id and i.status in ('pending', 'running');
  update sellerpilot_private.inventory_sync_runs r
     set status = 'superseded', completed_at = now(), updated_at = now()
   where r.owner_id = v_owner and r.product_id = p_product_id and r.status in ('pending', 'running');

  v_available := p_on_hand - v_reserved;
  update sellerpilot_private.products
     set on_hand = p_on_hand,
         status = case when v_available = 0 then 'out_of_stock'
                       when v_available <= v_reorder_point then 'low_stock'
                       else 'active' end,
         updated_at = now()
   where id = p_product_id;

  insert into sellerpilot_private.inventory_sync_runs (
    owner_id, product_id, idempotency_key, requested_on_hand, available_quantity
  ) values (v_owner, p_product_id, trim(p_idempotency_key), p_on_hand, v_available)
  returning id into v_run_id;

  insert into sellerpilot_private.inventory_sync_items (
    run_id, owner_id, product_id, listing_id, channel, market, target_id,
    remote_id, requested_quantity
  )
  select v_run_id, v_owner, p_product_id, l.id, l.channel_key, l.market, l.target_id,
         l.remote_id, v_available
    from sellerpilot_private.product_listings l
   where l.owner_id = v_owner and l.product_id = p_product_id
     and l.status = 'published' and nullif(trim(coalesce(l.remote_id, '')), '') is not null;

  update sellerpilot_private.product_listings l
     set inventory_sync_status = 'pending', inventory_sync_error = null, updated_at = now()
   where l.id in (select i.listing_id from sellerpilot_private.inventory_sync_items i where i.run_id = v_run_id);

  update sellerpilot_private.inventory_sync_runs r
     set total_count = (select count(*) from sellerpilot_private.inventory_sync_items i where i.run_id = v_run_id),
         status = case when exists (select 1 from sellerpilot_private.inventory_sync_items i where i.run_id = v_run_id) then 'running' else 'failed' end,
         completed_at = case when exists (select 1 from sellerpilot_private.inventory_sync_items i where i.run_id = v_run_id) then null else now() end,
         updated_at = now()
   where r.id = v_run_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (v_owner, 'inventory_sync_started', 'product', p_product_id::text,
    jsonb_build_object('run_id', v_run_id, 'requested_on_hand', p_on_hand, 'available_quantity', v_available));

  return public.sellerpilot_get_inventory_sync(p_product_id);
end;
$$;

create or replace function public.sellerpilot_service_complete_inventory_sync_item(
  p_run_id uuid,
  p_item_id uuid,
  p_attempt_id uuid,
  p_success boolean,
  p_verified_quantity integer,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
  v_product uuid;
  v_listing uuid;
  v_channel text;
  v_requested integer;
  v_total integer;
  v_succeeded integer;
  v_failed integer;
  v_pending integer;
begin
  if p_verified_quantity is not null and p_verified_quantity not between 0 and 99999999 then
    raise exception 'invalid verified quantity';
  end if;
  if length(coalesce(p_safe_message, '')) > 1000 then raise exception 'safe message too long'; end if;

  select i.owner_id, i.product_id, i.listing_id, i.channel, i.requested_quantity
    into v_owner, v_product, v_listing, v_channel, v_requested
    from sellerpilot_private.inventory_sync_items i
   where i.id = p_item_id and i.run_id = p_run_id
   for update;
  if v_owner is null or not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.owner_id = v_owner and a.channel = v_channel
       and a.operation = 'inventory.update'
  ) then raise exception 'inventory sync attempt mismatch'; end if;

  p_success := p_success and p_verified_quantity = v_requested;
  update sellerpilot_private.inventory_sync_items
     set status = case when p_success then 'succeeded' else 'failed' end,
         operation_attempt_id = p_attempt_id,
         safe_message = left(nullif(trim(coalesce(p_safe_message, '')), ''), 1000),
         completed_at = now(), updated_at = now()
   where id = p_item_id and status <> 'superseded';

  update sellerpilot_private.product_listings
     set inventory_sync_status = case when p_success then 'succeeded' else 'failed' end,
         last_inventory_quantity = case when p_success then p_verified_quantity else last_inventory_quantity end,
         inventory_sync_error = case when p_success then null else left(nullif(trim(coalesce(p_safe_message, '')), ''), 1000) end,
         last_inventory_synced_at = case when p_success then now() else last_inventory_synced_at end,
         last_verified_at = case when p_success then now() else last_verified_at end,
         updated_at = now()
   where id = v_listing;

  select count(*), count(*) filter (where status = 'succeeded'), count(*) filter (where status = 'failed'),
         count(*) filter (where status in ('pending', 'running'))
    into v_total, v_succeeded, v_failed, v_pending
    from sellerpilot_private.inventory_sync_items where run_id = p_run_id and status <> 'superseded';
  update sellerpilot_private.inventory_sync_runs
     set total_count = v_total, succeeded_count = v_succeeded, failed_count = v_failed,
         status = case when v_pending > 0 then 'running'
                       when v_total > 0 and v_succeeded = v_total then 'succeeded'
                       when v_succeeded > 0 then 'partial' else 'failed' end,
         completed_at = case when v_pending = 0 then now() else null end,
         updated_at = now()
   where id = p_run_id and status <> 'superseded';

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (v_owner, case when p_success then 'inventory_remote_verified' else 'inventory_remote_failed' end,
    'product_listing', v_listing::text,
    jsonb_build_object('run_id', p_run_id, 'attempt_id', p_attempt_id, 'channel', v_channel,
      'requested_quantity', v_requested, 'verified_quantity', p_verified_quantity));
  return true;
end;
$$;

revoke all on function public.sellerpilot_start_inventory_sync(uuid, integer, text) from public, anon;
revoke all on function public.sellerpilot_get_inventory_sync(uuid) from public, anon;
revoke all on function public.sellerpilot_service_complete_inventory_sync_item(uuid, uuid, uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_start_inventory_sync(uuid, integer, text) to authenticated;
grant execute on function public.sellerpilot_get_inventory_sync(uuid) to authenticated;
grant execute on function public.sellerpilot_service_complete_inventory_sync_item(uuid, uuid, uuid, boolean, integer, text) to service_role;

commit;
