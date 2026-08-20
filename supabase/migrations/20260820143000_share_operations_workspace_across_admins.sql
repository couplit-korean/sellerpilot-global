-- SellerPilot is one shared operations workspace. Channel credentials were
-- already shared between approved administrators, but the operational snapshot
-- still filtered products, orders, inquiries and sync state by the administrator
-- who originally created each row. That made real Coupang orders disappear when
-- a different approved administrator signed in.

begin;

create or replace function public.sellerpilot_get_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generatedAt', now(),
    'channels', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb)
      from sellerpilot_private.channels c
    ),
    'channelMetrics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'channelKey', c.key,
        'channelCode', c.code,
        'name', c.name,
        'market', c.market,
        'color', c.color,
        'channelStatus', c.status,
        'credentialStatus', coalesce(cr.status, 'missing'),
        'credentialExpiresAt', cr.expires_at,
        'productCount', coalesce(pm.product_count, 0),
        'publishedCount', coalesce(pm.published_count, 0),
        'sold30d', coalesce(pm.sold_30d, 0),
        'revenue30dKrw', coalesce(pm.revenue_30d_krw, 0),
        'orderCount', coalesce(om.order_count, 0),
        'readyToShipCount', coalesce(om.ready_to_ship_count, 0),
        'openTicketCount', coalesce(tm.open_ticket_count, 0),
        'failedAttemptCount', coalesce(am.failed_attempt_count, 0),
        'lastOperationAt', am.last_operation_at
      ) order by c.sort_order), '[]'::jsonb)
      from sellerpilot_private.channels c
      left join lateral (
        select cc.status, cc.expires_at
        from sellerpilot_private.channel_credentials cc
        where cc.channel = c.key and cc.environment = 'production' and cc.status = 'active'
        order by cc.version desc
        limit 1
      ) cr on true
      left join lateral (
        select count(distinct pl.product_id)::integer product_count,
               count(*) filter (where pl.status = 'published')::integer published_count,
               coalesce(sum(pl.sold_30d), 0)::integer sold_30d,
               coalesce(sum(pl.revenue_30d_krw), 0) revenue_30d_krw
        from sellerpilot_private.product_listings pl
        join sellerpilot_private.products p on p.id = pl.product_id
        where pl.channel_key = c.key and not p.demo
      ) pm on true
      left join lateral (
        select count(*)::integer order_count,
               count(*) filter (where o.status = 'ready_to_ship')::integer ready_to_ship_count
        from sellerpilot_private.commerce_orders o
        where o.channel_key = c.key and not o.demo
      ) om on true
      left join lateral (
        select count(*) filter (where t.status <> 'resolved')::integer open_ticket_count
        from sellerpilot_private.support_tickets t
        where t.channel_key = c.key and not t.demo
      ) tm on true
      left join lateral (
        select count(*) filter (where a.status in ('failed', 'manual_required'))::integer failed_attempt_count,
               max(a.started_at) last_operation_at
        from sellerpilot_private.channel_operation_attempts a
        where a.channel = c.key
      ) am on true
      where c.status <> 'disabled'
    ),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'externalCode', p.external_code, 'sku', p.sku, 'name', p.name,
        'description', p.description, 'sourceUrl', p.source_url, 'imageUrl', p.image_url,
        'aiHeroPath', coalesce(aj.result_payload->'asset_storage_paths'->>'hero', aj.result_payload->>'hero_storage_path'),
        'status', p.status, 'onHand', p.on_hand, 'reserved', p.reserved,
        'available', p.on_hand - p.reserved, 'costKrw', p.cost_krw,
        'sold30d', coalesce(l.sold, 0), 'revenue30dKrw', coalesce(l.revenue, 0),
        'listingChannels', coalesce(l.channel_codes, '[]'::jsonb), 'demo', false,
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
        where pl.product_id = p.id and pl.owner_id = p.owner_id and pl.status = 'published'
      ) l on true
      where p.status <> 'archived' and not p.demo
    ),
    'orders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'externalOrderId', o.external_order_id, 'channelKey', o.channel_key,
        'channelCode', c.code, 'customerName', o.customer_name, 'productName', o.product_name,
        'quantity', o.quantity, 'amount', o.amount, 'currency', o.currency,
        'amountKrw', o.amount_krw, 'status', o.status, 'orderedAt', o.ordered_at,
        'updatedAt', o.updated_at, 'demo', false
      ) order by o.ordered_at desc), '[]'::jsonb)
      from sellerpilot_private.commerce_orders o
      join sellerpilot_private.channels c on c.key = o.channel_key
      where not o.demo
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'externalTicketId', t.external_ticket_id, 'channelKey', t.channel_key,
        'channelCode', c.code, 'customerName', t.customer_name, 'subject', t.subject,
        'message', t.message, 'translatedMessage', t.translated_message,
        'replyDraft', t.reply_draft, 'status', t.status, 'priority', t.priority,
        'receivedAt', t.received_at, 'updatedAt', t.updated_at, 'demo', false
      ) order by t.priority, t.received_at desc), '[]'::jsonb)
      from sellerpilot_private.support_tickets t
      join sellerpilot_private.channels c on c.key = t.channel_key
      where not t.demo
    ),
    'pipeline', jsonb_build_object(
      'aiRunning', (select count(*) from sellerpilot_private.ai_cli_jobs where status in ('queued', 'claimed', 'running')),
      'listingQueued', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.status in ('draft', 'queued') and not p.demo),
      'listingPublished', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.status = 'published' and not p.demo),
      'listingFailed', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.status = 'failed' and not p.demo)
    ),
    'summary', jsonb_build_object(
      'revenue30dKrw', coalesce((select sum(pl.revenue_30d_krw) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where not p.demo), 0),
      'sold30d', coalesce((select sum(pl.sold_30d) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where not p.demo), 0),
      'orderCount', (select count(*) from sellerpilot_private.commerce_orders where not demo),
      'paidOrderCount', (select count(*) from sellerpilot_private.commerce_orders where status = 'paid' and not demo),
      'readyToShipCount', (select count(*) from sellerpilot_private.commerce_orders where status = 'ready_to_ship' and not demo),
      'openTicketCount', (select count(*) from sellerpilot_private.support_tickets where status <> 'resolved' and not demo),
      'lowStockCount', (select count(*) from sellerpilot_private.products where on_hand - reserved <= reorder_point and status <> 'archived' and not demo),
      'productCount', (select count(*) from sellerpilot_private.products where status <> 'archived' and not demo),
      'registrationErrorCount', (select count(*) from sellerpilot_private.product_listings pl join sellerpilot_private.products p on p.id = pl.product_id where pl.status = 'failed' and not p.demo),
      'activeCredentialCount', (select count(*) from sellerpilot_private.channel_credentials where status = 'active' and environment = 'production' and (expires_at is null or expires_at > now()))
    )
  ) into v_result;

  return v_result;
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
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select s.channel_key, s.data_type, s.status, s.imported_count,
         s.last_started_at, s.last_succeeded_at, s.last_error, s.updated_at
    from sellerpilot_private.channel_sync_state s
    join sellerpilot_private.channel_credentials c
      on c.created_by = s.owner_id
     and c.channel = s.channel_key
     and c.environment = 'production'
     and c.status = 'active'
   where public.sellerpilot_is_admin()
   order by s.channel_key, s.data_type
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
  update sellerpilot_private.commerce_orders
     set status = p_status,
         shipped_at = case when p_status = 'shipped' then coalesce(shipped_at, now()) else shipped_at end,
         updated_at = now()
   where id = p_id;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
    values (auth.uid(), 'status_updated', 'order', p_id::text, jsonb_build_object('status', p_status));
  end if;
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
  update sellerpilot_private.support_tickets
     set status = p_status,
         reply_draft = left(nullif(trim(p_reply_draft), ''), 8000),
         resolved_at = case when p_status = 'resolved' then now() else null end,
         updated_at = now()
   where id = p_id;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
    values (auth.uid(), 'ticket_updated', 'support_ticket', p_id::text,
      jsonb_build_object('status', p_status, 'has_reply', nullif(trim(p_reply_draft), '') is not null));
  end if;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select jsonb_build_object(
    'ownerId', p.owner_id,
    'product', jsonb_build_object(
      'id', p.id, 'externalCode', p.external_code, 'sku', p.sku,
      'name', p.name, 'description', p.description, 'sourceUrl', p.source_url,
      'status', p.status, 'onHand', p.on_hand, 'costKrw', p.cost_krw
    ),
    'manualFields', coalesce(j.request_payload->'manual_fields', '{}'::jsonb),
    'imageSpecs', coalesce(j.request_payload->'image_specs', '[]'::jsonb),
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
      where a.owner_id = p.owner_id and a.product_id = p.id
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'channel', l.channel_key, 'market', l.market, 'targetId', l.target_id,
        'remoteId', l.remote_id, 'status', l.status, 'currency', l.currency,
        'price', l.price, 'lastError', l.last_error, 'updatedAt', l.updated_at
      ) order by l.channel_key, l.market, l.target_id)
      from sellerpilot_private.product_listings l
      where l.owner_id = p.owner_id and l.product_id = p.id
    ), '[]'::jsonb)
  )
  from sellerpilot_private.products p
  left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
  where public.sellerpilot_is_admin() and p.id = p_product_id and not p.demo
$$;

create or replace function public.sellerpilot_save_product_category_assignment(
  p_product_id uuid,
  p_source_ref text,
  p_product_name text,
  p_channel text,
  p_environment text,
  p_market text,
  p_category_id text,
  p_category_path text[],
  p_is_leaf boolean,
  p_confidence numeric,
  p_classification_source text,
  p_required_attributes jsonb,
  p_provided_attributes jsonb,
  p_official_metadata jsonb,
  p_confirm boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_owner_id uuid := auth.uid();
  v_missing jsonb := '[]'::jsonb;
  v_verified_at timestamptz := now();
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_environment not in ('sandbox', 'production')
     or length(trim(coalesce(p_source_ref, ''))) not between 1 and 160
     or length(trim(coalesce(p_product_name, ''))) not between 1 and 500
     or length(trim(coalesce(p_category_id, ''))) not between 1 and 120
     or p_confidence not between 0 and 1
     or p_classification_source not in ('channel_recommendation', 'official_tree_search', 'seller_selected')
     or jsonb_typeof(p_required_attributes) <> 'array'
     or jsonb_typeof(p_provided_attributes) <> 'object'
     or jsonb_typeof(p_official_metadata) <> 'object' then raise exception 'invalid category assignment'; end if;
  if p_product_id is not null then
    select p.owner_id into v_owner_id
      from sellerpilot_private.products p
     where p.id = p_product_id and not p.demo and p.status <> 'archived';
    if v_owner_id is null then raise exception 'product not found'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(a->>'id', a->>'name'),
    'name', coalesce(a->>'name', a->>'id'))), '[]'::jsonb) into v_missing
    from jsonb_array_elements(p_required_attributes) a
   where coalesce((a->>'required')::boolean, false)
     and not (p_provided_attributes ? coalesce(a->>'id', a->>'name'));
  if p_confirm and (not p_is_leaf or jsonb_array_length(v_missing) > 0) then
    raise exception 'category confirmation requires an active leaf and every required attribute';
  end if;
  insert into sellerpilot_private.product_category_assignments (
    owner_id, product_id, source_ref, product_name, channel, environment, market,
    category_id, category_path, is_leaf, confidence, classification_source,
    required_attributes, provided_attributes, missing_required_attributes,
    official_metadata, status, official_verified_at, confirmed_at
  ) values (
    v_owner_id, p_product_id, trim(p_source_ref), trim(p_product_name), p_channel,
    p_environment, coalesce(trim(p_market), ''), trim(p_category_id), coalesce(p_category_path, '{}'),
    p_is_leaf, p_confidence, p_classification_source, p_required_attributes,
    p_provided_attributes, v_missing, p_official_metadata,
    case when p_confirm then 'confirmed' else 'pending' end, v_verified_at,
    case when p_confirm then v_verified_at else null end
  ) on conflict (owner_id, source_ref, channel, environment, market) do update set
    product_id = excluded.product_id, product_name = excluded.product_name,
    category_id = excluded.category_id, category_path = excluded.category_path,
    is_leaf = excluded.is_leaf, confidence = excluded.confidence,
    classification_source = excluded.classification_source,
    required_attributes = excluded.required_attributes,
    provided_attributes = excluded.provided_attributes,
    missing_required_attributes = excluded.missing_required_attributes,
    official_metadata = excluded.official_metadata, status = excluded.status,
    official_verified_at = excluded.official_verified_at, confirmed_at = excluded.confirmed_at,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

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
  v_owner_id uuid;
  v_market text := upper(trim(coalesce(p_market, '')));
  v_target_id text := trim(coalesce(p_target_id, ''));
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(trim(coalesce(p_currency, ''))) <> 3 or length(v_market) > 80
     or length(v_target_id) > 160 or p_price < 0 then raise exception 'invalid product listing request'; end if;
  if p_channel in ('shopee', 'lazada') and v_market !~ '^[A-Z]{2}$' then raise exception 'concrete market required'; end if;
  if p_channel = 'shopee' and v_target_id = '' then raise exception 'shop target required'; end if;
  select p.owner_id into v_owner_id
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo and p.status <> 'archived';
  if v_owner_id is null then raise exception 'product not found'; end if;
  if not exists (select 1 from sellerpilot_private.channel_credentials c where c.channel = p_channel
    and c.status = 'active' and (c.expires_at is null or c.expires_at > now())) then raise exception 'active channel credential required'; end if;
  if p_operation in ('listing.create', 'listing.update') and not exists (
    select 1 from sellerpilot_private.product_category_assignments a
     where a.owner_id = v_owner_id and a.product_id = p_product_id and a.channel = p_channel
       and (p_channel not in ('shopee', 'lazada') or a.market = v_market)
       and a.status = 'confirmed' and a.is_leaf
       and jsonb_array_length(a.missing_required_attributes) = 0 and a.confirmed_at is not null
  ) then raise exception 'confirmed market category required'; end if;
  if p_operation = 'listing.stop' and not exists (select 1 from sellerpilot_private.product_listings l
    where l.owner_id = v_owner_id and l.product_id = p_product_id and l.channel_key = p_channel
      and l.market = v_market and l.target_id = v_target_id and l.remote_id is not null) then raise exception 'remote market listing required'; end if;
  insert into sellerpilot_private.product_listings (
    owner_id, product_id, channel_key, market, target_id, status, currency, price, last_error, updated_at
  ) values (
    v_owner_id, p_product_id, p_channel, v_market, v_target_id,
    case when p_operation = 'listing.stop' then 'published' else 'queued' end,
    upper(trim(p_currency)), p_price, null, now()
  ) on conflict (owner_id, product_id, channel_key, market, target_id) do update set
    status = case when p_operation = 'listing.stop' then sellerpilot_private.product_listings.status else 'queued' end,
    currency = excluded.currency, price = excluded.price, last_error = null, updated_at = now()
  returning id into v_id;
  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'listing_prepared', 'product_listing', v_id::text,
    jsonb_build_object('product_id', p_product_id, 'channel', p_channel, 'market', v_market,
      'has_target', v_target_id <> '', 'operation', p_operation));
  return v_id;
end;
$$;

create unique index if not exists channel_operation_attempts_global_idempotency_idx
  on sellerpilot_private.channel_operation_attempts (channel, operation, idempotency_key);

create or replace function public.sellerpilot_claim_channel_operation(
  p_credential_id uuid,
  p_channel text,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_status text;
  v_fingerprint text;
  v_remote_id text;
  v_safe_message text;
  v_inserted boolean := false;
begin
  if not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_operation not in (
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'shipment.acknowledge', 'shipment.confirm'
     )
     or length(trim(p_idempotency_key)) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid channel operation'; end if;
  if not exists (select 1 from sellerpilot_private.channel_credentials c
    where c.id = p_credential_id and c.channel = p_channel and c.status = 'active') then raise exception 'active channel credential required'; end if;
  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint
  ) values (auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint)
  on conflict (channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message;
  v_inserted := found;
  if not v_inserted then
    select a.id, a.status, a.request_fingerprint, a.remote_id, a.safe_message
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message
      from sellerpilot_private.channel_operation_attempts a
     where a.channel = p_channel and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key);
    if v_fingerprint <> p_request_fingerprint then raise exception 'idempotency key payload mismatch'; end if;
  end if;
  return jsonb_build_object('attempt_id', v_id, 'status', v_status, 'duplicate', not v_inserted,
    'remote_id', v_remote_id, 'safe_message', v_safe_message);
end;
$$;

create or replace function public.sellerpilot_list_published_product_destinations()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'productId', l.product_id,
    'channelKey', l.channel_key,
    'channelCode', c.code,
    'remoteId', l.remote_id,
    'market', l.market,
    'targetId', l.target_id
  ) order by l.product_id, c.sort_order, l.market, l.target_id), '[]'::jsonb)
    from sellerpilot_private.product_listings l
    join sellerpilot_private.products p on p.id = l.product_id and p.owner_id = l.owner_id
    join sellerpilot_private.channels c on c.key = l.channel_key
   where public.sellerpilot_is_admin()
     and l.status = 'published'
     and nullif(trim(coalesce(l.remote_id, '')), '') is not null
     and p.status <> 'archived'
     and not p.demo
$$;

revoke all on function public.sellerpilot_get_operations_snapshot() from public, anon;
revoke all on function public.sellerpilot_get_channel_sync_status() from public, anon;
revoke all on function public.sellerpilot_update_order_status(uuid, text) from public, anon;
revoke all on function public.sellerpilot_update_ticket(uuid, text, text) from public, anon;
revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public, anon;
revoke all on function public.sellerpilot_save_product_category_assignment(uuid, text, text, text, text, text, text, text[], boolean, numeric, text, jsonb, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.sellerpilot_prepare_product_market_listing(uuid, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) from public, anon;
revoke all on function public.sellerpilot_list_published_product_destinations() from public, anon;

grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;
grant execute on function public.sellerpilot_get_channel_sync_status() to authenticated;
grant execute on function public.sellerpilot_update_order_status(uuid, text) to authenticated;
grant execute on function public.sellerpilot_update_ticket(uuid, text, text) to authenticated;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;
grant execute on function public.sellerpilot_save_product_category_assignment(uuid, text, text, text, text, text, text, text[], boolean, numeric, text, jsonb, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.sellerpilot_prepare_product_market_listing(uuid, text, text, text, text, text, numeric) to authenticated;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) to authenticated;
grant execute on function public.sellerpilot_list_published_product_destinations() to authenticated;

commit;
