-- Durable storage for the Puck detail-page editor (국내형 세로 상세).
-- One edited detail document per product, reached only through audited admin RPCs.
-- Kept in the private schema with row-level security so the JSON document is never
-- readable from the client storage API and follows the same audit boundary as the
-- rest of the operations data plane.

begin;

create table if not exists sellerpilot_private.product_detail_data (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  detail_data jsonb not null
    check (jsonb_typeof(detail_data) = 'object' and octet_length(detail_data::text) <= 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, product_id)
);

create index if not exists product_detail_data_product_idx
  on sellerpilot_private.product_detail_data (product_id);

alter table sellerpilot_private.product_detail_data enable row level security;
revoke all on sellerpilot_private.product_detail_data from public, anon, authenticated;

-- Read the saved Puck document for a product. Admins share the operations
-- workspace, so the guard is the admin check rather than a per-owner fence;
-- owner_id remains on the row for cascade deletion and audit attribution.
create or replace function public.sellerpilot_get_product_detail_data(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select case
    when auth.uid() is null or not public.sellerpilot_is_admin() then null
    else (
      select d.detail_data
        from sellerpilot_private.product_detail_data d
       where d.product_id = p_product_id
       limit 1
    )
  end;
$$;

-- Idempotent upsert keyed on (owner_id, product_id). The document must be a JSON
-- object whose `content` is an array; otherwise the row is rejected before any
-- write. Ownership is copied from the product so a shared-workspace edit still
-- cascades with the owning account.
create or replace function public.sellerpilot_upsert_product_detail_data(
  p_product_id uuid,
  p_detail_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_product sellerpilot_private.products%rowtype;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_detail_data) <> 'object'
     or not (p_detail_data ? 'content')
     or jsonb_typeof(p_detail_data->'content') <> 'array'
     or octet_length(p_detail_data::text) > 1000000 then
    raise exception 'invalid product detail data';
  end if;

  select * into v_product
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo
   for update;
  if v_product.id is null then return false; end if;

  insert into sellerpilot_private.product_detail_data (owner_id, product_id, detail_data, updated_at)
  values (v_product.owner_id, p_product_id, p_detail_data, now())
  on conflict (owner_id, product_id) do update set
    detail_data = excluded.detail_data,
    updated_at = now();

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (
    auth.uid(),
    'product_detail_data_upserted',
    'product',
    p_product_id::text,
    jsonb_build_object('block_count', jsonb_array_length(p_detail_data->'content'))
  );
  return true;
end;
$$;

revoke all on function public.sellerpilot_get_product_detail_data(uuid)
  from public, anon;
revoke all on function public.sellerpilot_upsert_product_detail_data(uuid, jsonb)
  from public, anon;

grant execute on function public.sellerpilot_get_product_detail_data(uuid)
  to authenticated;
grant execute on function public.sellerpilot_upsert_product_detail_data(uuid, jsonb)
  to authenticated;

commit;
