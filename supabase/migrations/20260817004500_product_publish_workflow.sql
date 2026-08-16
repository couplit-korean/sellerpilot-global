-- Connect AI-created products, confirmed channel categories, write attempts, and
-- the listing ledger. Listing writes are prepared by the signed-in admin and
-- completed only by the service role after the remote provider responds.

begin;

alter table sellerpilot_private.product_listings
  add column if not exists operation_attempt_id uuid references sellerpilot_private.channel_operation_attempts(id) on delete set null,
  add column if not exists last_verified_at timestamptz;

create index if not exists product_listings_operation_attempt_idx
  on sellerpilot_private.product_listings (operation_attempt_id)
  where operation_attempt_id is not null;

create index if not exists product_category_assignments_product_channel_idx
  on sellerpilot_private.product_category_assignments (product_id, channel, status)
  where product_id is not null;

create index if not exists products_ai_job_idx
  on sellerpilot_private.products (ai_job_id)
  where ai_job_id is not null;

create index if not exists commerce_orders_product_idx
  on sellerpilot_private.commerce_orders (product_id)
  where product_id is not null;

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
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay')
     or p_operation not in (
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update', 'orders.list', 'orders.get',
       'shipment.acknowledge', 'shipment.confirm'
     )
     or length(trim(p_idempotency_key)) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid channel operation';
  end if;
  if not exists (
    select 1 from sellerpilot_private.channel_credentials c
     where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
  ) then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint
  ) values (
    auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint
  )
  on conflict (owner_id, channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message;
  v_inserted := found;

  if not v_inserted then
    select a.id, a.status, a.request_fingerprint, a.remote_id, a.safe_message
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message
      from sellerpilot_private.channel_operation_attempts a
     where a.owner_id = auth.uid()
       and a.channel = p_channel
       and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key);
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', v_id,
    'status', v_status,
    'duplicate', not v_inserted,
    'remote_id', v_remote_id,
    'safe_message', v_safe_message
  );
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
    'product', jsonb_build_object(
      'id', p.id,
      'externalCode', p.external_code,
      'sku', p.sku,
      'name', p.name,
      'description', p.description,
      'sourceUrl', p.source_url,
      'status', p.status,
      'onHand', p.on_hand,
      'costKrw', p.cost_krw
    ),
    'sourceImagePaths', coalesce(j.request_payload->'image_paths', '[]'::jsonb),
    'generatedImagePaths', coalesce(j.result_payload->'asset_storage_paths', '{}'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'channel', a.channel,
        'environment', a.environment,
        'market', a.market,
        'categoryId', a.category_id,
        'categoryPath', a.category_path,
        'providedAttributes', a.provided_attributes,
        'status', a.status,
        'confirmedAt', a.confirmed_at
      ) order by a.channel, a.market)
        from sellerpilot_private.product_category_assignments a
       where a.owner_id = auth.uid()
         and a.product_id = p.id
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'channel', l.channel_key,
        'remoteId', l.remote_id,
        'status', l.status,
        'currency', l.currency,
        'price', l.price,
        'lastError', l.last_error,
        'updatedAt', l.updated_at
      ) order by l.channel_key)
        from sellerpilot_private.product_listings l
       where l.owner_id = auth.uid()
         and l.product_id = p.id
    ), '[]'::jsonb)
  )
    from sellerpilot_private.products p
    left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
   where public.sellerpilot_is_admin()
     and p.id = p_product_id
     and p.owner_id = auth.uid()
     and not p.demo
$$;

create or replace function public.sellerpilot_prepare_product_listing(
  p_product_id uuid,
  p_channel text,
  p_operation text,
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
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay')
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(trim(coalesce(p_currency, ''))) <> 3
     or p_price < 0 then
    raise exception 'invalid product listing request';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.products p
     where p.id = p_product_id
       and p.owner_id = auth.uid()
       and not p.demo
       and p.status <> 'archived'
  ) then
    raise exception 'product not found';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_credentials c
     where c.channel = p_channel
       and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
  ) then
    raise exception 'active channel credential required';
  end if;
  if p_operation in ('listing.create', 'listing.update') and not exists (
    select 1
      from sellerpilot_private.product_category_assignments a
     where a.owner_id = auth.uid()
       and a.product_id = p_product_id
       and a.channel = p_channel
       and a.status = 'confirmed'
       and a.is_leaf
       and jsonb_array_length(a.missing_required_attributes) = 0
       and a.confirmed_at is not null
  ) then
    raise exception 'confirmed channel category required';
  end if;
  if p_operation = 'listing.stop' and not exists (
    select 1
      from sellerpilot_private.product_listings l
     where l.owner_id = auth.uid()
       and l.product_id = p_product_id
       and l.channel_key = p_channel
       and l.remote_id is not null
  ) then
    raise exception 'remote listing required';
  end if;

  insert into sellerpilot_private.product_listings (
    owner_id, product_id, channel_key, status, currency, price, last_error, updated_at
  ) values (
    auth.uid(), p_product_id, p_channel,
    case when p_operation = 'listing.stop' then 'published' else 'queued' end,
    upper(trim(p_currency)), p_price, null, now()
  )
  on conflict (owner_id, product_id, channel_key) do update set
    status = case
      when p_operation = 'listing.stop' then sellerpilot_private.product_listings.status
      else 'queued'
    end,
    currency = excluded.currency,
    price = excluded.price,
    last_error = null,
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    auth.uid(), 'listing_prepared', 'product_listing', v_id::text,
    jsonb_build_object('product_id', p_product_id, 'channel', p_channel, 'operation', p_operation)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_service_complete_product_listing(
  p_listing_id uuid,
  p_attempt_id uuid,
  p_operation text,
  p_success boolean,
  p_remote_id text,
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
  v_channel text;
  v_updated integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(coalesce(p_remote_id, '')) > 240
     or length(coalesce(p_safe_message, '')) > 1000 then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select l.owner_id, l.product_id, l.channel_key
    into v_owner, v_product, v_channel
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id;
  if v_owner is null or not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.owner_id = v_owner
       and a.channel = v_channel
       and a.operation = p_operation
  ) then
    raise exception 'listing attempt mismatch';
  end if;

  update sellerpilot_private.product_listings
     set status = case
       when not p_success then 'failed'
       when p_operation = 'listing.stop' then 'paused'
       else 'published'
     end,
         remote_id = case
           when p_success and nullif(trim(coalesce(p_remote_id, '')), '') is not null then trim(p_remote_id)
           else remote_id
         end,
         operation_attempt_id = p_attempt_id,
         last_error = case when p_success then null else nullif(trim(coalesce(p_safe_message, '')), '') end,
         published_at = case
           when p_success and p_operation in ('listing.create', 'listing.update') then coalesce(published_at, now())
           else published_at
         end,
         last_verified_at = case when p_success then now() else last_verified_at end,
         updated_at = now()
   where id = p_listing_id;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    update sellerpilot_private.products
       set status = case
         when p_success and p_operation in ('listing.create', 'listing.update') then 'active'
         when p_success and p_operation = 'listing.stop' and not exists (
           select 1 from sellerpilot_private.product_listings l
            where l.product_id = v_product and l.status = 'published'
         ) then 'archived'
         else status
       end,
           updated_at = now()
     where id = v_product;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner,
      case when p_success then 'listing_remote_succeeded' else 'listing_remote_failed' end,
      'product_listing', p_listing_id::text,
      jsonb_build_object(
        'attempt_id', p_attempt_id,
        'operation', p_operation,
        'channel', v_channel,
        'has_remote_id', nullif(trim(coalesce(p_remote_id, '')), '') is not null
      )
    );
  end if;
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
     or p_channel_key not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay')
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

create or replace function public.sellerpilot_list_margin_scenarios(p_limit integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id,
    'name', row.name,
    'channelKey', row.channel_key,
    'inputs', row.inputs,
    'result', row.result,
    'createdAt', row.created_at
  ) order by row.created_at desc), '[]'::jsonb)
  from (
    select s.id, s.name, s.channel_key, s.inputs, s.result, s.created_at
      from sellerpilot_private.margin_scenarios s
     where public.sellerpilot_is_admin()
       and s.owner_id = auth.uid()
     order by s.created_at desc
     limit least(greatest(coalesce(p_limit, 5), 1), 50)
  ) row
$$;

create or replace function public.sellerpilot_delete_margin_scenario(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_deleted integer := 0;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  delete from sellerpilot_private.margin_scenarios
   where id = p_id and owner_id = auth.uid();
  get diagnostics v_deleted = row_count;
  if v_deleted = 1 then
    insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
    values (auth.uid(), 'scenario_deleted', 'margin_scenario', p_id::text, '{}'::jsonb);
  end if;
  return v_deleted = 1;
end;
$$;

revoke all on function public.sellerpilot_prepare_product_listing(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.sellerpilot_prepare_product_listing(uuid, text, text, text, numeric) to authenticated;
revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) from public, anon;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) to authenticated;
revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public, anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;
revoke all on function public.sellerpilot_service_complete_product_listing(uuid, uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_complete_product_listing(uuid, uuid, text, boolean, text, text) to service_role;
revoke all on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) to authenticated;
revoke all on function public.sellerpilot_list_margin_scenarios(integer) from public, anon;
grant execute on function public.sellerpilot_list_margin_scenarios(integer) to authenticated;
revoke all on function public.sellerpilot_delete_margin_scenario(uuid) from public, anon;
grant execute on function public.sellerpilot_delete_margin_scenario(uuid) to authenticated;

commit;
