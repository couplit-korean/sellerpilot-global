-- Replace the planned 11st slot in the active application with Temu while
-- keeping historical 11st rows readable. Route Naver and Temu calls through
-- the authenticated Mac worker used for fixed-IP channel integrations.

begin;

alter table sellerpilot_private.channels drop constraint if exists channels_key_check;
alter table sellerpilot_private.channels add constraint channels_key_check
  check (key in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu', 'alibaba', 'one688'));

insert into sellerpilot_private.channels (key, name, market, code, color, status, sort_order)
values ('temu', 'Temu Korea', '대한민국', 'T', '#ff5a00', 'auth_required', 65)
on conflict (key) do update set name = excluded.name, market = excluded.market,
  code = excluded.code, color = excluded.color, status = excluded.status,
  sort_order = excluded.sort_order, updated_at = now();

alter table sellerpilot_private.channel_credentials drop constraint if exists channel_credentials_channel_check;
alter table sellerpilot_private.channel_credentials add constraint channel_credentials_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu'));

alter table sellerpilot_private.channel_operation_attempts drop constraint if exists channel_operation_attempts_channel_check;
alter table sellerpilot_private.channel_operation_attempts add constraint channel_operation_attempts_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu'));

alter table sellerpilot_private.product_category_assignments drop constraint if exists product_category_assignments_channel_check;
alter table sellerpilot_private.product_category_assignments add constraint product_category_assignments_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu'));

alter table sellerpilot_private.channel_gateway_jobs drop constraint if exists channel_gateway_jobs_channel_check;
alter table sellerpilot_private.channel_gateway_jobs add constraint channel_gateway_jobs_channel_check
  check (channel in ('shopee', 'lazada', 'coupang', 'smartstore', 'temu'));

create or replace function public.sellerpilot_rotate_credential(
  p_channel text,
  p_environment text,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_rotation_interval_days integer default 90,
  p_warning_days integer default 30,
  p_grace_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare
  v_id uuid := gen_random_uuid();
  v_vault_id uuid;
  v_version integer;
  v_previous_id uuid;
  v_now timestamptz := now();
  v_fingerprint text;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_environment not in ('sandbox', 'production')
     or p_rotation_interval_days not between 1 and 365
     or p_warning_days not between 1 and 180
     or p_grace_days not between 0 and 30
     or jsonb_typeof(p_secret_payload) <> 'object'
     or p_secret_payload = '{}'::jsonb
     or octet_length(p_secret_payload::text) > 32000 then
    raise exception 'invalid credential rotation';
  end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:' || p_channel || ':' || p_environment));
  select c.id into v_previous_id from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment and c.status = 'active'
   for update;
  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment;
  v_fingerprint := upper(substr(encode(extensions.digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_%s_%s_v%s_%s', p_channel, p_environment, v_version, v_id),
    'SellerPilot channel credential. Never expose to browser or logs.'
  ) into v_vault_id;

  if v_previous_id is not null then
    update sellerpilot_private.channel_credentials
       set status = case when p_grace_days = 0 then 'revoked' else 'grace' end,
           grace_ends_at = case when p_grace_days = 0 then v_now else v_now + make_interval(days => p_grace_days) end
     where id = v_previous_id;
  end if;
  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, expires_at,
    rotation_interval_days, warning_days, last_rotated_at, created_by
  ) values (
    v_id, p_channel, p_environment, v_version, v_vault_id, v_fingerprint, p_expires_at,
    p_rotation_interval_days, p_warning_days, v_now, auth.uid()
  );
  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, p_channel, p_environment, case when v_previous_id is null then 'created' else 'rotated' end,
    auth.uid(), jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint,
      'expires_at', p_expires_at, 'grace_days', p_grace_days)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_get_active_credential_secret(
  p_channel text,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare v_result jsonb;
begin
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_environment not in ('sandbox', 'production') then
    raise exception 'unsupported credential selector';
  end if;
  select jsonb_build_object('credential_id', c.id, 'expires_at', c.expires_at,
    'secret_payload', d.decrypted_secret::jsonb) into v_result
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.channel = p_channel and c.environment = p_environment and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   limit 1;
  return v_result;
end;
$$;

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
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_operation not in (
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'shipment.acknowledge', 'shipment.confirm'
     )
     or length(trim(p_idempotency_key)) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid channel operation';
  end if;
  if not exists (select 1 from sellerpilot_private.channel_credentials c
    where c.id = p_credential_id and c.channel = p_channel and c.status = 'active') then
    raise exception 'active channel credential required';
  end if;
  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint
  ) values (auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint)
  on conflict (owner_id, channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message;
  v_inserted := found;
  if not v_inserted then
    select a.id, a.status, a.request_fingerprint, a.remote_id, a.safe_message
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message
      from sellerpilot_private.channel_operation_attempts a
     where a.owner_id = auth.uid() and a.channel = p_channel and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key);
    if v_fingerprint <> p_request_fingerprint then raise exception 'idempotency key payload mismatch'; end if;
  end if;
  return jsonb_build_object('attempt_id', v_id, 'status', v_status, 'duplicate', not v_inserted,
    'remote_id', v_remote_id, 'safe_message', v_safe_message);
end;
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
  if p_product_id is not null and not exists (select 1 from sellerpilot_private.products p
    where p.id = p_product_id and p.owner_id = auth.uid()) then raise exception 'product not found'; end if;
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
    auth.uid(), p_product_id, trim(p_source_ref), trim(p_product_name), p_channel,
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
  if not exists (select 1 from sellerpilot_private.products p where p.id = p_product_id
    and p.owner_id = auth.uid() and not p.demo and p.status <> 'archived') then raise exception 'product not found'; end if;
  if not exists (select 1 from sellerpilot_private.channel_credentials c where c.channel = p_channel
    and c.status = 'active' and (c.expires_at is null or c.expires_at > now())) then raise exception 'active channel credential required'; end if;
  if p_operation in ('listing.create', 'listing.update') and not exists (
    select 1 from sellerpilot_private.product_category_assignments a
     where a.owner_id = auth.uid() and a.product_id = p_product_id and a.channel = p_channel
       and (p_channel not in ('shopee', 'lazada') or a.market = v_market)
       and a.status = 'confirmed' and a.is_leaf
       and jsonb_array_length(a.missing_required_attributes) = 0 and a.confirmed_at is not null
  ) then raise exception 'confirmed market category required'; end if;
  if p_operation = 'listing.stop' and not exists (select 1 from sellerpilot_private.product_listings l
    where l.owner_id = auth.uid() and l.product_id = p_product_id and l.channel_key = p_channel
      and l.market = v_market and l.target_id = v_target_id and l.remote_id is not null) then raise exception 'remote market listing required'; end if;
  insert into sellerpilot_private.product_listings (
    owner_id, product_id, channel_key, market, target_id, status, currency, price, last_error, updated_at
  ) values (
    auth.uid(), p_product_id, p_channel, v_market, v_target_id,
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
  if not public.sellerpilot_is_admin() or length(trim(coalesce(p_name, ''))) not between 1 and 120
     or p_channel_key not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
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

create or replace function public.sellerpilot_enqueue_channel_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang', 'smartstore', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'shipment.acknowledge', 'shipment.confirm'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then raise exception 'invalid channel gateway job'; end if;
  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now()) for update;
  if not found then raise exception 'active channel credential required'; end if;
  if p_attempt_id is not null and not exists (select 1 from sellerpilot_private.channel_operation_attempts a
    where a.id = p_attempt_id and a.credential_id = p_credential_id and a.channel = p_channel
      and a.operation = p_operation and a.status = 'running') then raise exception 'running channel operation required'; end if;
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment, request_payload, created_by
  ) values (v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment, p_request_payload, v_created_by);
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) from public, anon;
grant execute on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) to authenticated;
revoke all on function public.sellerpilot_get_active_credential_secret(text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_get_active_credential_secret(text, text) to service_role;
revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) from public, anon;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) to authenticated;
revoke all on function public.sellerpilot_save_product_category_assignment(uuid, text, text, text, text, text, text, text[], boolean, numeric, text, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.sellerpilot_save_product_category_assignment(uuid, text, text, text, text, text, text, text[], boolean, numeric, text, jsonb, jsonb, jsonb, boolean) to authenticated;
revoke all on function public.sellerpilot_prepare_product_market_listing(uuid, text, text, text, text, text, numeric) from public, anon;
grant execute on function public.sellerpilot_prepare_product_market_listing(uuid, text, text, text, text, text, numeric) to authenticated;
revoke all on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb) to authenticated;
revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) to service_role;

commit;
