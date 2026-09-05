-- Bounded opt-in bridge: products remains the ONLY quantity authority.
-- This is NOT order-event cutover. No automatic bootstrap or external stock write.
-- Bound items reject native ledger mutations; products.on_hand changes append an
-- ADJUSTMENT and mirror counters atomically. Reserved must stay zero until a
-- separately reviewed order-line reservation cutover exists. No keys are inferred.
begin;

-- Verified directly from the live catalog, not a rewritten historical fixture.
-- The existing remote-generation guard must remain installed and unchanged.
do $operational_guard_preimage$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('sellerpilot_private.guard_inventory_write_generation()')
      and pg_catalog.md5(p.prosrc) = '67f6f545198ab0a7e1e2e57473cc9e5c'
      and exists (select 1 from pg_catalog.pg_trigger t where t.tgfoid=p.oid
        and t.tgrelid='sellerpilot_private.inventory_sync_runs'::regclass
        and t.tgtype=7 and t.tgenabled='O' and not t.tgisinternal)
  ) then
    raise exception 'INVENTORY_OPERATIONAL_GUARD_PREIMAGE_MISMATCH' using errcode='55000';
  end if;
end;
$operational_guard_preimage$;

create table sellerpilot_private.inventory_product_bindings (
  product_id uuid primary key references sellerpilot_private.products(id) on delete restrict,
  item_id uuid not null unique references sellerpilot_private.inventory_items(id) on delete restrict,
  owner_id uuid not null references auth.users(id),
  sku text not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_on_hand integer not null check (source_on_hand between 0 and 99999999),
  source_reserved integer not null check (source_reserved = 0),
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  unique (owner_id, sku)
);
alter table sellerpilot_private.inventory_product_bindings enable row level security;
revoke all on sellerpilot_private.inventory_product_bindings from public, anon, authenticated, service_role;

create function sellerpilot_private.inventory_product_source_fingerprint(p sellerpilot_private.products)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p.id, p.owner_id, p.sku, p.on_hand, p.reserved,
      p.demo, p.status, p.updated_at at time zone 'UTC')::text, 'UTF8')), 'hex')
$$;
revoke all on function sellerpilot_private.inventory_product_source_fingerprint(sellerpilot_private.products)
  from public, anon, authenticated, service_role;

-- Read-only source proposal. Caller must preserve these exact values for bootstrap.
create function public.sellerpilot_service_inventory_bootstrap_source(p_product_id uuid, p_owner uuid, p_sku text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p sellerpilot_private.products%rowtype;
begin
  select * into p from sellerpilot_private.products where id = p_product_id;
  if p.id is null or p.owner_id is distinct from p_owner or p.sku is distinct from p_sku
     or p.demo or p.status = 'archived' then
    raise exception 'INVENTORY_SOURCE_IDENTITY_MISMATCH' using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object('productId',p.id,'ownerId',p.owner_id,'sku',p.sku,
    'onHand',p.on_hand,'reserved',p.reserved,'sourceFingerprint',
    sellerpilot_private.inventory_product_source_fingerprint(p));
end;
$$;

create function public.sellerpilot_service_bootstrap_product_inventory(
  p_product_id uuid, p_owner uuid, p_sku text, p_source_fingerprint text,
  p_expected_on_hand integer, p_expected_reserved integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p sellerpilot_private.products%rowtype;
  i sellerpilot_private.inventory_items%rowtype;
  b sellerpilot_private.inventory_product_bindings%rowtype;
begin
  -- All writers of a bound product take product -> item locks in this order.
  select * into p from sellerpilot_private.products where id = p_product_id for update;
  if p.id is null or p.owner_id is distinct from p_owner or p.sku is distinct from p_sku
     or p.demo or p.status = 'archived'
     or not exists (select 1 from sellerpilot_private.admin_users where user_id = p_owner)
     or p_source_fingerprint is null or p_source_fingerprint !~ '^[0-9a-f]{64}$'
     or p_expected_on_hand is null or p_expected_on_hand not between 0 and 99999999
     or p_expected_reserved is distinct from 0 then
    raise exception 'INVENTORY_BOOTSTRAP_INVALID_SOURCE' using errcode = '22023';
  end if;
  -- Product locking alone cannot freeze an already queued gateway worker or a
  -- status UPDATE without a product lock. Freeze all predicate-bearing tables
  -- through commit, including INSERT phantoms and listing rebindings. NOWAIT
  -- fails closed on any concurrent writer rather than inverting its lock order.
  -- This is deliberately conservative/global and limited to explicit bootstrap.
  lock table sellerpilot_private.inventory_sync_runs,
    sellerpilot_private.inventory_sync_items,
    sellerpilot_private.channel_gateway_jobs,
    sellerpilot_private.product_listings,
    sellerpilot_private.commerce_orders in share mode nowait;
  if exists (select 1 from sellerpilot_private.inventory_sync_runs r
       where r.product_id=p.id and r.status in ('pending','running','reconciliation_required'))
     or exists (select 1 from sellerpilot_private.inventory_sync_items s
       where s.product_id=p.id and s.status in ('pending','running','reconciliation_required'))
     or exists (select 1 from sellerpilot_private.channel_gateway_jobs j
       join sellerpilot_private.product_listings l on l.id=j.listing_id
       -- operations.ts writeChannelOperations + gateway.ts listing resource branch.
       -- listing.update carries Lazada SKU quantity; price.update can submit a
       -- full offer/price-quantity document. stop/activate change availability.
       -- listing.stop covers deactivate/withdraw; no listing.remove operation exists.
       where l.product_id=p.id and j.operation in (
         'listing.create','listing.update','listing.stop','listing.activate','price.update','inventory.update'
       ) and j.status in ('queued','running','reconciliation_required')) then
    raise exception 'INVENTORY_BOOTSTRAP_REQUIRES_RECONCILIATION' using errcode='22023';
  end if;
  select * into b from sellerpilot_private.inventory_product_bindings where product_id = p.id;
  if b.product_id is not null then
    select * into i from sellerpilot_private.inventory_items where id = b.item_id for update;
    if b.owner_id is distinct from p_owner or b.sku is distinct from p_sku
       or b.source_fingerprint is distinct from p_source_fingerprint
       or b.source_on_hand is distinct from p_expected_on_hand
       or b.source_reserved is distinct from p_expected_reserved
       or i.product_id is distinct from p.id or i.owner_id is distinct from p.owner_id
       or i.sku is distinct from p.sku or i.on_hand is distinct from p.on_hand
       or i.reserved is distinct from p.reserved or i.reserved <> 0 or i.safety_stock <> 0
       or i.ledger_seq <> b.revision + 1
       or exists (select 1 from sellerpilot_private.inventory_reservations where item_id = i.id)
       or (select count(*) from sellerpilot_private.inventory_ledger where item_id = i.id) <> i.ledger_seq then
      raise exception 'INVENTORY_BOOTSTRAP_REPLAY_CONFLICT' using errcode = '22023';
    end if;
    return sellerpilot_private.inventory_item_snapshot(i) || pg_catalog.jsonb_build_object('replayed',true,'authority','products');
  end if;
  if sellerpilot_private.inventory_product_source_fingerprint(p) is distinct from p_source_fingerprint
     or p.on_hand is distinct from p_expected_on_hand or p.reserved is distinct from p_expected_reserved then
    raise exception 'INVENTORY_SOURCE_CHANGED' using errcode = '22023';
  end if;
  -- Never synthesize reservation lineage or silently adopt a pre-existing ledger.
  if exists (select 1 from sellerpilot_private.inventory_items where (owner_id = p.owner_id and sku = p.sku) or product_id = p.id)
     or exists (select 1 from sellerpilot_private.commerce_orders where product_id = p.id and not demo and status not in ('cancelled','refunded')) then
    raise exception 'INVENTORY_BOOTSTRAP_REQUIRES_RECONCILIATION' using errcode = '22023';
  end if;
  insert into sellerpilot_private.inventory_items(owner_id,sku,product_id,on_hand,reserved,safety_stock,ledger_seq)
    values(p.owner_id,p.sku,p.id,p.on_hand,0,0,1) returning * into i;
  insert into sellerpilot_private.inventory_ledger(owner_id,item_id,sequence,event_type,idempotency_key,
    quantity,on_hand_delta,reserved_delta,safety_stock_delta,on_hand_after,reserved_after,safety_stock_after,available_after,reason,actor_id)
    values(p.owner_id,i.id,1,'ADJUSTMENT','products-bootstrap:' || p.id::text,p.on_hand,p.on_hand,0,0,p.on_hand,0,0,p.on_hand,
      'Exact products authority bootstrap',p.owner_id);
  insert into sellerpilot_private.inventory_product_bindings(product_id,item_id,owner_id,sku,source_fingerprint,source_on_hand,source_reserved)
    values(p.id,i.id,p.owner_id,p.sku,p_source_fingerprint,p.on_hand,0);
  return sellerpilot_private.inventory_item_snapshot(i) || pg_catalog.jsonb_build_object('replayed',false,'authority','products');
end;
$$;

-- A custom GUC is NOT used as authorization. Only the nested product trigger
-- can write a bound ledger, and its proposed counters/key must match the source.
create function sellerpilot_private.guard_product_bound_inventory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b sellerpilot_private.inventory_product_bindings%rowtype; p sellerpilot_private.products%rowtype; v_item uuid; v_old_item uuid;
begin
  if TG_TABLE_NAME = 'inventory_items' then
    if TG_OP = 'DELETE' then v_item := OLD.id; else v_item := NEW.id; end if;
  else
    if TG_OP = 'DELETE' then v_item := OLD.item_id; else v_item := NEW.item_id; end if;
  end if;
  if TG_OP = 'UPDATE' then
    if TG_TABLE_NAME = 'inventory_items' then v_old_item := OLD.id; else v_old_item := OLD.item_id; end if;
  end if;
  select * into b from sellerpilot_private.inventory_product_bindings
    where item_id = v_item or item_id = v_old_item order by product_id limit 1;
  if b.product_id is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and v_item is distinct from v_old_item)
     or TG_TABLE_NAME = 'inventory_reservations' or pg_catalog.pg_trigger_depth() <> 2 then
    raise exception 'INVENTORY_PRODUCTS_AUTHORITY_REQUIRED' using errcode = '22023';
  end if;
  select * into p from sellerpilot_private.products where id = b.product_id;
  if TG_TABLE_NAME = 'inventory_ledger' then
    if TG_OP <> 'INSERT' or NEW.event_type <> 'ADJUSTMENT'
       or NEW.idempotency_key <> 'products-mirror:' || p.id::text || ':' || b.revision::text
       or NEW.sequence <> b.revision + 1 or NEW.owner_id <> b.owner_id
       or NEW.quantity <> p.on_hand or NEW.on_hand_after <> p.on_hand
       or NEW.reserved_after <> 0 or NEW.safety_stock_after <> 0
       or NEW.order_key is not null or NEW.channel_key is not null then
      raise exception 'INVENTORY_PRODUCTS_MIRROR_MISMATCH' using errcode = '22023';
    end if;
  else
    if TG_OP <> 'UPDATE' or NEW.product_id is distinct from p.id or NEW.owner_id is distinct from b.owner_id
       or NEW.sku is distinct from b.sku or NEW.on_hand is distinct from p.on_hand
       or NEW.reserved <> 0 or NEW.safety_stock <> 0 or NEW.ledger_seq <> b.revision + 1 then
      raise exception 'INVENTORY_PRODUCTS_MIRROR_MISMATCH' using errcode = '22023';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger guard_product_bound_inventory before insert or update or delete on sellerpilot_private.inventory_ledger
  for each row execute function sellerpilot_private.guard_product_bound_inventory();
create trigger guard_product_bound_inventory before insert or update or delete on sellerpilot_private.inventory_reservations
  for each row execute function sellerpilot_private.guard_product_bound_inventory();
create trigger guard_product_bound_inventory before update or delete on sellerpilot_private.inventory_items
  for each row execute function sellerpilot_private.guard_product_bound_inventory();

create function sellerpilot_private.mirror_product_authoritative_inventory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b sellerpilot_private.inventory_product_bindings%rowtype; i sellerpilot_private.inventory_items%rowtype;
begin
  select * into b from sellerpilot_private.inventory_product_bindings where product_id = OLD.id;
  if b.product_id is null then return NEW; end if;
  if NEW.id is distinct from OLD.id or NEW.owner_id is distinct from OLD.owner_id or NEW.sku is distinct from OLD.sku
     or NEW.reserved is distinct from 0 or NEW.on_hand is null or NEW.on_hand not between 0 and 99999999 then
    raise exception 'INVENTORY_BOUND_PRODUCT_IDENTITY_OR_RESERVED_CHANGED' using errcode = '22023';
  end if;
  select * into i from sellerpilot_private.inventory_items where id = b.item_id for update;
  if i.product_id is distinct from OLD.id or i.owner_id is distinct from OLD.owner_id or i.sku is distinct from OLD.sku
     or i.on_hand is distinct from OLD.on_hand or i.reserved is distinct from 0 or i.safety_stock <> 0
     or i.ledger_seq <> b.revision + 1 then
    raise exception 'INVENTORY_PRODUCTS_MIRROR_DRIFT' using errcode = '22023';
  end if;
  if NEW.on_hand is not distinct from OLD.on_hand then return NEW; end if;
  update sellerpilot_private.inventory_product_bindings set revision = revision + 1 where product_id = b.product_id returning * into b;
  insert into sellerpilot_private.inventory_ledger(owner_id,item_id,sequence,event_type,idempotency_key,quantity,
    on_hand_delta,reserved_delta,safety_stock_delta,on_hand_after,reserved_after,safety_stock_after,available_after,reason,actor_id)
    values(b.owner_id,b.item_id,b.revision+1,'ADJUSTMENT','products-mirror:' || b.product_id::text || ':' || b.revision::text,
      NEW.on_hand,NEW.on_hand-OLD.on_hand,0,0,NEW.on_hand,0,0,NEW.on_hand,'Products authoritative stock change',b.owner_id);
  update sellerpilot_private.inventory_items set on_hand = NEW.on_hand, ledger_seq = b.revision + 1, updated_at = now() where id = b.item_id;
  return NEW;
end;
$$;
create trigger mirror_product_authoritative_inventory after update on sellerpilot_private.products
  for each row execute function sellerpilot_private.mirror_product_authoritative_inventory();

revoke all on function sellerpilot_private.guard_product_bound_inventory() from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.mirror_product_authoritative_inventory() from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_inventory_bootstrap_source(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_bootstrap_product_inventory(uuid,uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_inventory_bootstrap_source(uuid,uuid,text) to service_role;
grant execute on function public.sellerpilot_service_bootstrap_product_inventory(uuid,uuid,text,text,integer,integer) to service_role;
commit;
