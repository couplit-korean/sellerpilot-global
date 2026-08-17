-- Track one remote listing per channel market and seller target. A single
-- Shopee credential can own many country shops, so channel-only uniqueness
-- would overwrite successful listings from the other shops.

begin;

alter table sellerpilot_private.product_listings
  add column market text not null default '' check (length(market) <= 80),
  add column target_id text not null default '' check (length(target_id) <= 160);

alter table sellerpilot_private.product_listings
  drop constraint product_listings_owner_id_product_id_channel_key_key;

alter table sellerpilot_private.product_listings
  add constraint product_listings_owner_product_channel_market_target_key
  unique (owner_id, product_id, channel_key, market, target_id);

create index product_listings_market_target_idx
  on sellerpilot_private.product_listings (owner_id, channel_key, market, target_id, updated_at desc);

create or replace function public.sellerpilot_prepare_product_market_listing(
  p_product_id uuid,
  p_channel text,
  p_operation text,
  p_market text default '',
  p_target_id text default '',
  p_currency text default 'KRW',
  p_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_market text := upper(trim(coalesce(p_market, '')));
  v_target_id text := trim(coalesce(p_target_id, ''));
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay')
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(trim(coalesce(p_currency, ''))) <> 3
     or length(v_market) > 80
     or length(v_target_id) > 160
     or p_price < 0 then
    raise exception 'invalid product listing request';
  end if;
  if p_channel in ('shopee', 'lazada') and v_market !~ '^[A-Z]{2}$' then
    raise exception 'concrete market required';
  end if;
  if p_channel = 'shopee' and v_target_id = '' then
    raise exception 'shop target required';
  end if;
  if not exists (
    select 1 from sellerpilot_private.products p
     where p.id = p_product_id and p.owner_id = auth.uid()
       and not p.demo and p.status <> 'archived'
  ) then raise exception 'product not found'; end if;
  if not exists (
    select 1 from sellerpilot_private.channel_credentials c
     where c.channel = p_channel and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
  ) then raise exception 'active channel credential required'; end if;
  if p_operation in ('listing.create', 'listing.update') and not exists (
    select 1 from sellerpilot_private.product_category_assignments a
     where a.owner_id = auth.uid() and a.product_id = p_product_id
       and a.channel = p_channel
       and (p_channel not in ('shopee', 'lazada') or a.market = v_market)
       and a.status = 'confirmed' and a.is_leaf
       and jsonb_array_length(a.missing_required_attributes) = 0
       and a.confirmed_at is not null
  ) then raise exception 'confirmed market category required'; end if;
  if p_operation = 'listing.stop' and not exists (
    select 1 from sellerpilot_private.product_listings l
     where l.owner_id = auth.uid() and l.product_id = p_product_id
       and l.channel_key = p_channel and l.market = v_market
       and l.target_id = v_target_id and l.remote_id is not null
  ) then raise exception 'remote market listing required'; end if;

  insert into sellerpilot_private.product_listings (
    owner_id, product_id, channel_key, market, target_id, status,
    currency, price, last_error, updated_at
  ) values (
    auth.uid(), p_product_id, p_channel, v_market, v_target_id,
    case when p_operation = 'listing.stop' then 'published' else 'queued' end,
    upper(trim(p_currency)), p_price, null, now()
  )
  on conflict (owner_id, product_id, channel_key, market, target_id) do update set
    status = case when p_operation = 'listing.stop' then sellerpilot_private.product_listings.status else 'queued' end,
    currency = excluded.currency,
    price = excluded.price,
    last_error = null,
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'listing_prepared', 'product_listing', v_id::text,
    jsonb_build_object('product_id', p_product_id, 'channel', p_channel, 'market', v_market, 'has_target', v_target_id <> '', 'operation', p_operation));
  return v_id;
end;
$$;

create or replace function public.sellerpilot_prepare_product_listing(
  p_product_id uuid,
  p_channel text,
  p_operation text,
  p_currency text default 'KRW',
  p_price numeric default 0
)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.sellerpilot_prepare_product_market_listing(
    p_product_id, p_channel, p_operation, '', '', p_currency, p_price
  )
$$;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select jsonb_build_object(
    'product', jsonb_build_object(
      'id', p.id, 'externalCode', p.external_code, 'sku', p.sku,
      'name', p.name, 'description', p.description, 'sourceUrl', p.source_url,
      'status', p.status, 'onHand', p.on_hand, 'costKrw', p.cost_krw
    ),
    'sourceImagePaths', coalesce(j.request_payload->'image_paths', '[]'::jsonb),
    'generatedImagePaths', coalesce(j.result_payload->'asset_storage_paths', '{}'::jsonb),
    'localizedListings', coalesce(j.result_payload->'localizedListings', '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'channel', a.channel, 'environment', a.environment,
        'market', a.market, 'categoryId', a.category_id, 'categoryPath', a.category_path,
        'providedAttributes', a.provided_attributes, 'status', a.status, 'confirmedAt', a.confirmed_at
      ) order by a.channel, a.market)
      from sellerpilot_private.product_category_assignments a
      where a.owner_id = auth.uid() and a.product_id = p.id
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'channel', l.channel_key, 'market', l.market, 'targetId', l.target_id,
        'remoteId', l.remote_id, 'status', l.status, 'currency', l.currency,
        'price', l.price, 'lastError', l.last_error, 'updatedAt', l.updated_at
      ) order by l.channel_key, l.market, l.target_id)
      from sellerpilot_private.product_listings l
      where l.owner_id = auth.uid() and l.product_id = p.id
    ), '[]'::jsonb)
  )
  from sellerpilot_private.products p
  left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
  where public.sellerpilot_is_admin() and p.id = p_product_id
    and p.owner_id = auth.uid() and not p.demo
$$;

revoke all on function public.sellerpilot_prepare_product_market_listing(uuid, text, text, text, text, text, numeric) from public, anon;
grant execute on function public.sellerpilot_prepare_product_market_listing(uuid, text, text, text, text, text, numeric) to authenticated;

commit;
