-- Reassert the current product-detail contract in a forward migration: a
-- product may be out of stock, so zero is valid everywhere the edit RPC
-- validates the inventory snapshot.

begin;

create or replace function public.sellerpilot_update_product_details(p_product_id uuid, p_fields jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_requested_stock integer;
  v_canonical_fields jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fields) <> 'object'
     or octet_length(p_fields::text) > 50000
     or length(trim(coalesce(p_fields->>'productName',''))) not between 2 and 160
     or trim(coalesce(p_fields->>'sellerSku','')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(p_fields->>'categoryHint',''))) not between 2 and 120
     or length(trim(coalesce(p_fields->>'brandName',''))) not between 1 and 120
     or length(trim(coalesce(p_fields->>'manufacturer',''))) not between 1 and 160
     or length(trim(coalesce(p_fields->>'countryOfOrigin',''))) not between 2 and 80
     or length(trim(coalesce(p_fields->>'material',''))) not between 2 and 500
     or length(trim(coalesce(p_fields->>'packageContents',''))) not between 2 and 500
     or coalesce(p_fields->>'condition','') not in ('NEW','USED','REFURBISHED')
     or coalesce(p_fields->>'gtinStatus','') not in ('HAS_GTIN','NO_GTIN')
     or (p_fields->>'gtinStatus' = 'HAS_GTIN' and coalesce(p_fields->>'gtin','') !~ '^[0-9]{8,14}$')
     or (p_fields->>'gtinStatus' = 'NO_GTIN' and coalesce(p_fields->>'gtin','') <> '')
     or length(trim(coalesce(p_fields->>'description',''))) not between 20 and 4000
     or length(trim(coalesce(p_fields->>'researchInput',''))) not between 2 and 12000
     or length(coalesce(p_fields->>'productUrl','')) > 1000
     or (coalesce(p_fields->>'productUrl','') <> '' and p_fields->>'productUrl' !~* '^https?://')
     or coalesce((p_fields->>'sellingPrice')::numeric, 0) <= 0
     or coalesce(p_fields->>'currency','') not in ('KRW','JPY','USD','SGD','MYR','PHP','VND','THB','TWD','BRL','MXN','IDR','EUR')
     or coalesce((p_fields->>'stock')::integer, -1) not between 0 and 999999
     or coalesce((p_fields->>'weightKg')::numeric, 0) <= 0
     or coalesce((p_fields->>'packageLengthCm')::numeric, 0) <= 0
     or coalesce((p_fields->>'packageWidthCm')::numeric, 0) <= 0
     or coalesce((p_fields->>'packageHeightCm')::numeric, 0) <= 0
     or coalesce((p_fields->>'shippingFeeKrw')::numeric, -1) < 0
     or length(coalesce(p_fields->>'shippingRule','')) > 1000
     or length(coalesce(p_fields->>'packagingRule','')) > 1000
     or coalesce((p_fields->>'imageRightsConfirmed')::boolean, false) is not true
     or coalesce((p_fields->>'productFactsConfirmed')::boolean, false) is not true then
    raise exception 'invalid product details';
  end if;

  select * into v_product
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo
   for update;
  if v_product.id is null then return false; end if;

  v_requested_stock := (p_fields->>'stock')::integer;
  if v_requested_stock < v_product.reserved then
    raise exception 'stock below reserved quantity';
  end if;

  v_canonical_fields := jsonb_set(p_fields, '{stock}', to_jsonb(v_product.on_hand), true);
  update sellerpilot_private.products
     set name = trim(p_fields->>'productName'),
         sku = upper(trim(p_fields->>'sellerSku')),
         description = trim(p_fields->>'description'),
         source_url = nullif(trim(p_fields->>'productUrl'), ''),
         product_facts = v_canonical_fields,
         updated_at = now()
   where id = p_product_id;

  insert into sellerpilot_private.operation_audit(owner_id, action, entity_type, entity_id, safe_detail)
  values(auth.uid(), 'product_details_updated', 'product', p_product_id::text,
    jsonb_build_object('sku', upper(trim(p_fields->>'sellerSku')), 'inventory_unchanged', v_product.on_hand,
      'inventory_requested', v_requested_stock));
  return true;
end;
$$;

revoke all on function public.sellerpilot_update_product_details(uuid,jsonb) from public, anon;
grant execute on function public.sellerpilot_update_product_details(uuid,jsonb) to authenticated;

commit;
