-- Every marketplace mutation is bound to the remote resource before a worker
-- can call the provider. A changed payload or idempotency key cannot bypass an
-- in-flight or provider-uncertain write, and terminal worker completion updates
-- the channel attempt plus inventory/order ledgers in the same transaction.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists write_resource_kind text,
  add column if not exists write_resource_key text,
  add column if not exists request_fingerprint text,
  add column if not exists inventory_item_id uuid,
  add column if not exists order_id uuid,
  add column if not exists shipment_carrier text,
  add column if not exists shipment_tracking text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'channel_gateway_jobs_inventory_item_fkey'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_inventory_item_fkey
      foreign key (inventory_item_id)
      references sellerpilot_private.inventory_sync_items(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'channel_gateway_jobs_order_fkey'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_order_fkey
      foreign key (order_id)
      references sellerpilot_private.commerce_orders(id)
      on delete restrict;
  end if;
end
$$;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_write_resource_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_write_resource_check check (
    (
      write_resource_kind is null
      and write_resource_key is null
      and request_fingerprint is null
      and inventory_item_id is null
      and order_id is null
      and shipment_carrier is null
      and shipment_tracking is null
    ) or (
      write_resource_kind in ('listing_mutation', 'order_shipment')
      and write_resource_key ~ '^[a-f0-9]{64}$'
      and request_fingerprint ~ '^[a-f0-9]{64}$'
      and (shipment_carrier is null or length(shipment_carrier) between 1 and 40)
      and (shipment_tracking is null or length(shipment_tracking) <= 100)
    )
  );

-- Old non-listing writes do not carry a resource identity. Applying the new
-- fence while one is queued, running, or unresolved would permit a changed
-- payload to race it, so rollout must drain/reconcile them first.
do $$
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation in (
       'price.update', 'inventory.update',
       'shipment.acknowledge', 'shipment.confirm'
     )
       and j.status in ('queued', 'running', 'reconciliation_required')
       and j.write_resource_key is null
  ) then
    raise exception 'legacy non-listing gateway writes must drain before resource-fence rollout';
  end if;
end
$$;

create unique index if not exists channel_gateway_jobs_one_active_write_resource_idx
  on sellerpilot_private.channel_gateway_jobs (write_resource_key)
  where write_resource_key is not null
    and status in ('queued', 'running', 'reconciliation_required');

create unique index if not exists channel_gateway_jobs_one_active_listing_resource_idx
  on sellerpilot_private.channel_gateway_jobs (listing_id)
  where listing_id is not null
    and operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update'
    )
    and status in ('queued', 'running', 'reconciliation_required');

create unique index if not exists channel_gateway_jobs_one_active_order_shipment_idx
  on sellerpilot_private.channel_gateway_jobs (order_id)
  where order_id is not null
    and operation in ('shipment.acknowledge', 'shipment.confirm')
    and status in ('queued', 'running', 'reconciliation_required');

alter table sellerpilot_private.inventory_sync_items
  drop constraint if exists inventory_sync_items_status_check;
alter table sellerpilot_private.inventory_sync_items
  add constraint inventory_sync_items_status_check
  check (status in ('pending', 'running', 'succeeded', 'failed', 'superseded', 'reconciliation_required'));

alter table sellerpilot_private.inventory_sync_runs
  drop constraint if exists inventory_sync_runs_status_check;
alter table sellerpilot_private.inventory_sync_runs
  add constraint inventory_sync_runs_status_check
  check (status in ('pending', 'running', 'succeeded', 'partial', 'failed', 'superseded', 'reconciliation_required'));

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_inventory_sync_status_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_inventory_sync_status_check
  check (inventory_sync_status in ('never', 'pending', 'succeeded', 'failed', 'reconciliation_required'));

alter table sellerpilot_private.commerce_orders
  add column if not exists shipment_write_status text not null default 'never',
  add column if not exists shipment_operation_attempt_id uuid,
  add column if not exists shipment_request_fingerprint text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'commerce_orders_shipment_attempt_fkey'
       and conrelid = 'sellerpilot_private.commerce_orders'::regclass
  ) then
    alter table sellerpilot_private.commerce_orders
      add constraint commerce_orders_shipment_attempt_fkey
      foreign key (shipment_operation_attempt_id)
      references sellerpilot_private.channel_operation_attempts(id)
      on delete set null;
  end if;
end
$$;

alter table sellerpilot_private.commerce_orders
  drop constraint if exists commerce_orders_shipment_write_status_check;
alter table sellerpilot_private.commerce_orders
  add constraint commerce_orders_shipment_write_status_check
  check (shipment_write_status in ('never', 'pending', 'succeeded', 'failed', 'reconciliation_required'));

alter table sellerpilot_private.commerce_orders
  drop constraint if exists commerce_orders_shipment_request_fingerprint_check;
alter table sellerpilot_private.commerce_orders
  add constraint commerce_orders_shipment_request_fingerprint_check
  check (shipment_request_fingerprint is null or shipment_request_fingerprint ~ '^[a-f0-9]{64}$');

-- A legacy non-listing attempt may still be inside a direct provider call.
-- It has no durable remote-resource identity, so merely marking the attempt
-- manual cannot stop a changed idempotency key from writing the same listing
-- or order again. Rollout therefore fails closed until old traffic is drained
-- and operators confirm that no such attempt remains running.
do $$
begin
  if exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.status = 'running'
       and not a.gateway_write_required
       and a.operation in (
         'price.update', 'inventory.update',
         'shipment.acknowledge', 'shipment.confirm'
       )
  ) then
    raise exception 'legacy direct marketplace writes must drain before resource-fence rollout';
  end if;
end
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
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_fingerprint text;
  v_remote_id text;
  v_safe_message text;
  v_gateway_write_required boolean := false;
  v_inserted boolean := false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in (
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or length(trim(p_idempotency_key)) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid channel operation';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_credentials c
     where c.id = p_credential_id
       and c.channel = p_channel
       and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
  ) then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint,
    gateway_write_required
  ) values (
    auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint,
    p_operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
    )
  )
  on conflict (channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message;
  v_inserted := found;

  if not v_inserted then
    select a.id, a.status, a.request_fingerprint, a.remote_id, a.safe_message,
           a.gateway_write_required
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message,
           v_gateway_write_required
      from sellerpilot_private.channel_operation_attempts a
     where a.channel = p_channel
       and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key)
     for update;
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;

    if v_status = 'running'
       and v_gateway_write_required
       and p_operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
       )
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs j
          where j.attempt_id = v_id
       ) then
      update sellerpilot_private.channel_operation_attempts a
         set owner_id = auth.uid(),
             credential_id = p_credential_id,
             started_at = now()
       where a.id = v_id;
      v_inserted := true;
    elsif v_status = 'failed'
       and p_operation in ('listing.create', 'listing.update', 'listing.stop')
       and v_remote_id is null
       and v_safe_message = '상품·카테고리·채널 연결 사전조건을 충족하지 못했습니다.'
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs j
          where j.attempt_id = v_id
       ) then
      update sellerpilot_private.channel_operation_attempts a
         set owner_id = auth.uid(),
             credential_id = p_credential_id,
             status = 'running',
             http_status = null,
             remote_id = null,
             safe_message = null,
             gateway_write_required = true,
             started_at = now(),
             completed_at = null
       where a.id = v_id;
      v_status := 'running';
      v_remote_id := null;
      v_safe_message := null;
      v_inserted := true;
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

create or replace function public.sellerpilot_service_enqueue_resource_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_resource_kind text,
  p_resource_key text,
  p_request_fingerprint text,
  p_listing_id uuid default null,
  p_inventory_item_id uuid default null,
  p_order_id uuid default null,
  p_shipment_carrier text default null,
  p_shipment_tracking text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_existing_job_id uuid;
  v_existing_attempt_id uuid;
  v_existing_status text;
  v_listing record;
  v_item record;
  v_order record;
begin
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in ('price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm')
     or p_resource_kind not in ('listing_mutation', 'order_shipment')
     or (p_operation in ('price.update', 'inventory.update') and p_resource_kind <> 'listing_mutation')
     or (p_operation in ('shipment.acknowledge', 'shipment.confirm') and p_resource_kind <> 'order_shipment')
     or coalesce(p_resource_key, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000
     or (p_shipment_carrier is not null and length(trim(p_shipment_carrier)) not between 1 and 40)
     or (p_shipment_tracking is not null and length(trim(p_shipment_tracking)) > 100) then
    raise exception 'invalid resource-bound gateway job';
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  perform 1
    from sellerpilot_private.channel_operation_attempts a
   where a.id = p_attempt_id
     and a.credential_id = p_credential_id
     and a.channel = p_channel
     and a.operation = p_operation
     and a.request_fingerprint = p_request_fingerprint
     and a.status = 'running'
   for update;
  if not found then raise exception 'running channel operation required'; end if;

  if p_listing_id is not null then
    select l.id, l.channel_key into v_listing
      from sellerpilot_private.product_listings l
     where l.id = p_listing_id and l.channel_key = p_channel
     for update;
    if not found then raise exception 'listing resource mismatch'; end if;
  end if;

  if p_inventory_item_id is not null then
    select i.id, i.run_id, i.listing_id, i.channel, i.status
      into v_item
      from sellerpilot_private.inventory_sync_items i
     where i.id = p_inventory_item_id
     for update;
    if not found then raise exception 'inventory resource mismatch'; end if;
    if p_operation <> 'inventory.update'
       or v_item.channel <> p_channel
       or v_item.status not in ('pending', 'running')
       or p_listing_id is null
       or v_item.listing_id <> p_listing_id then
      raise exception 'inventory resource mismatch';
    end if;
  end if;

  if p_order_id is not null then
    select o.id, o.channel_key, o.status, o.demo
      into v_order
      from sellerpilot_private.commerce_orders o
     where o.id = p_order_id
     for update;
    if not found then raise exception 'order shipment resource mismatch'; end if;
    if p_operation not in ('shipment.acknowledge', 'shipment.confirm')
       or v_order.channel_key <> p_channel
       or v_order.demo
       or v_order.status not in ('paid', 'ready_to_ship')
       or p_shipment_carrier is null then
      raise exception 'order shipment resource mismatch';
    end if;
  end if;

  select j.id, j.attempt_id, j.status
    into v_existing_job_id, v_existing_attempt_id, v_existing_status
    from sellerpilot_private.channel_gateway_jobs j
   where j.write_resource_key = p_resource_key
     and j.status in ('queued', 'running', 'reconciliation_required')
   order by case when j.status = 'reconciliation_required' then 0 when j.status = 'running' then 1 else 2 end,
            j.created_at,
            j.id
   for update
   limit 1;

  if v_existing_job_id is not null then
    if v_existing_attempt_id is distinct from p_attempt_id then
      update sellerpilot_private.channel_operation_attempts a
         set status = case when v_existing_status = 'reconciliation_required' then 'manual_required' else 'failed' end,
             http_status = 409,
             safe_message = case
               when v_existing_status = 'reconciliation_required'
                 then '같은 원격 대상의 이전 작업 결과를 수동 확인하기 전에는 새 요청을 실행할 수 없습니다.'
               else '같은 원격 대상의 작업이 이미 진행 중이어서 새 요청을 실행하지 않았습니다.'
             end,
             completed_at = now()
       where a.id = p_attempt_id and a.status = 'running';
    end if;
    return jsonb_build_object(
      'status', case when v_existing_status = 'reconciliation_required' then 'reconciliation_required' else 'in_progress' end,
      'job_id', v_existing_job_id,
      'attempt_id', v_existing_attempt_id,
      'reused', true
    );
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by, listing_id,
    write_resource_kind, write_resource_key, request_fingerprint,
    inventory_item_id, order_id, shipment_carrier, shipment_tracking
  ) values (
    v_job_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment,
    p_request_payload, v_created_by, p_listing_id,
    p_resource_kind, p_resource_key, p_request_fingerprint,
    p_inventory_item_id, p_order_id, nullif(trim(p_shipment_carrier), ''), nullif(trim(p_shipment_tracking), '')
  );

  if p_inventory_item_id is not null then
    update sellerpilot_private.inventory_sync_items
       set status = 'running',
           operation_attempt_id = p_attempt_id,
           safe_message = null,
           updated_at = now()
     where id = p_inventory_item_id;
    update sellerpilot_private.product_listings
       set inventory_sync_status = 'pending',
           inventory_sync_error = null,
           updated_at = now()
     where id = p_listing_id;
  end if;

  if p_order_id is not null then
    update sellerpilot_private.commerce_orders
       set shipment_write_status = 'pending',
           shipment_operation_attempt_id = p_attempt_id,
           shipment_request_fingerprint = p_request_fingerprint,
           shipping_carrier = trim(p_shipment_carrier),
           last_shipment_error = null,
           updated_at = now()
     where id = p_order_id;
  end if;

  return jsonb_build_object(
    'status', 'queued',
    'job_id', v_job_id,
    'attempt_id', p_attempt_id,
    'reused', false
  );
end;
$$;

-- The general queue is read/sync-only. All provider writes must use either
-- the listing-bound or resource-bound service RPC.
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
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_oauth_fingerprint text;
  v_oauth_vault_id uuid;
  v_existing record;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'orders.list', 'orders.get', 'inquiries.list'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or (p_channel = 'ebay' and p_operation not in (
       'oauth.exchange', 'diagnostic.test', 'categories.list', 'categories.suggest',
       'categories.attributes', 'categories.validate', 'orders.list', 'orders.get'
     ))
     or (p_operation = 'oauth.exchange' and (
       p_channel not in ('shopee', 'lazada', 'ebay')
       or p_attempt_id is not null
       or nullif(trim(p_request_payload->>'code'), '') is null
       or length(p_request_payload->>'code') > 8000
     ))
     or (p_operation = 'competitor.search' and (p_channel <> 'elevenst' or p_attempt_id is not null))
     or (p_channel = 'elevenst' and p_operation not in (
       'diagnostic.test', 'competitor.search', 'categories.list', 'categories.suggest',
       'categories.attributes', 'categories.validate', 'orders.list'
     ))
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  if p_operation = 'oauth.exchange' then
    v_oauth_fingerprint := encode(
      extensions.digest(
        jsonb_build_object(
          'channel', p_channel,
          'code', trim(p_request_payload->>'code')
        )::text,
        'sha256'
      ),
      'hex'
    );

    select j.id
      into v_existing
      from sellerpilot_private.channel_gateway_jobs j
     where j.oauth_source_credential_id = p_credential_id
       and j.oauth_request_fingerprint = v_oauth_fingerprint
       and j.channel = p_channel
       and j.operation = 'oauth.exchange'
     limit 1;
    if found then return v_existing.id; end if;
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then
    -- A successful exchange rotates the credential before the callback HTTP
    -- response is necessarily delivered. Re-check the immutable source id so
    -- an exact callback replay can still observe that terminal job.
    if p_operation = 'oauth.exchange' then
      select j.id
        into v_existing
        from sellerpilot_private.channel_gateway_jobs j
       where j.oauth_source_credential_id = p_credential_id
         and j.oauth_request_fingerprint = v_oauth_fingerprint
         and j.channel = p_channel
         and j.operation = 'oauth.exchange'
       limit 1;
      if found then return v_existing.id; end if;
    end if;
    raise exception 'active channel credential required';
  end if;

  if p_operation = 'oauth.exchange' then
    -- The credential row lock serializes callbacks. A repeated delivery of
    -- the same authorization grant reuses its exact job; a different grant
    -- cannot overtake an unresolved exchange for the same credential.
    select j.id, j.status, j.oauth_request_fingerprint
      into v_existing
      from sellerpilot_private.channel_gateway_jobs j
     where j.oauth_source_credential_id = p_credential_id
       and j.operation = 'oauth.exchange'
       and j.channel = p_channel
       and j.oauth_request_fingerprint = v_oauth_fingerprint
     limit 1;
    if found then return v_existing.id; end if;

    select j.id, j.status, j.oauth_request_fingerprint
      into v_existing
      from sellerpilot_private.channel_gateway_jobs j
     where j.oauth_source_credential_id = p_credential_id
       and j.operation = 'oauth.exchange'
       and j.channel = p_channel
       and j.status in ('queued', 'running', 'reconciliation_required')
     order by case when j.status = 'reconciliation_required' then 0 else 1 end,
              j.created_at,
              j.id
     limit 1;
    if found then raise exception 'unresolved OAuth exchange already exists'; end if;

    select vault.create_secret(
      p_request_payload::text,
      format('sellerpilot_gateway_oauth_%s_%s', v_id, gen_random_uuid()),
      'SellerPilot claim-bound OAuth request. Never expose outside the gateway worker.'
    ) into v_oauth_vault_id;
  end if;

  if p_attempt_id is not null and not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.credential_id = p_credential_id
       and a.channel = p_channel
       and a.operation = p_operation
       and a.status = 'running'
  ) then
    raise exception 'running channel operation required';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, oauth_request_vault_id, oauth_request_fingerprint,
    oauth_source_credential_id, created_by
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment,
    case when p_operation = 'oauth.exchange'
      then jsonb_build_object('vaultBacked', true)
      else p_request_payload
    end,
    v_oauth_vault_id,
    v_oauth_fingerprint,
    case when p_operation = 'oauth.exchange' then p_credential_id else null end,
    v_created_by
  );
  return v_id;
end;
$$;

create or replace function sellerpilot_private.reconcile_gateway_resource_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_ok boolean := false;
  v_safe_message text;
  v_http_status integer := 422;
  v_item record;
  v_total integer;
  v_succeeded integer;
  v_failed integer;
  v_pending integer;
  v_reconciliation integer;
  v_tracking text;
begin
  if new.status not in ('succeeded', 'failed', 'reconciliation_required')
     or new.status is not distinct from old.status then
    return new;
  end if;

  v_provider_ok := new.status = 'succeeded'
    and coalesce(new.response_payload->>'ok', 'false') = 'true';
  v_safe_message := left(coalesce(
    case when new.status = 'reconciliation_required'
      then nullif(trim(new.error_message), '')
      else nullif(trim(new.response_payload->>'safeMessage'), '')
    end,
    nullif(trim(new.response_payload->>'safeMessage'), ''),
    nullif(trim(new.error_message), ''),
    case
      when new.status = 'reconciliation_required' then 'Provider outcome requires reconciliation.'
      when v_provider_ok then 'Channel operation completed.'
      else 'Channel operation failed.'
    end
  ), 500);

  select coalesce((step->>'status')::integer, 422)
    into v_http_status
    from jsonb_array_elements(
      case when jsonb_typeof(new.response_payload->'steps') = 'array'
        then new.response_payload->'steps' else '[]'::jsonb end
    ) step
   where coalesce(step->>'ok', 'false') <> 'true'
     and coalesce(step->>'status', '') ~ '^[0-9]{1,3}$'
   limit 1;
  v_http_status := case
    when new.status = 'reconciliation_required' then 409
    when v_provider_ok then 200
    else coalesce(v_http_status, 422)
  end;

  if new.attempt_id is not null
     and new.operation not in ('listing.create', 'listing.update', 'listing.stop') then
    update sellerpilot_private.channel_operation_attempts a
       set status = case
             when new.status = 'reconciliation_required' then 'manual_required'
             when v_provider_ok then 'succeeded'
             else 'failed'
           end,
           http_status = v_http_status,
           remote_id = coalesce(nullif(left(trim(new.response_payload->>'remoteId'), 240), ''), a.remote_id),
           safe_message = v_safe_message,
           completed_at = now()
     where a.id = new.attempt_id
       and a.status in ('running', 'failed');
  end if;

  if new.inventory_item_id is not null then
    select i.id, i.run_id, i.listing_id, i.owner_id, i.requested_quantity, i.status
      into v_item
      from sellerpilot_private.inventory_sync_items i
     where i.id = new.inventory_item_id
     for update;
    if found and v_item.status <> 'superseded' then
      update sellerpilot_private.inventory_sync_items
         set status = case
               when new.status = 'reconciliation_required' then 'reconciliation_required'
               when v_provider_ok then 'succeeded'
               else 'failed'
             end,
             operation_attempt_id = new.attempt_id,
             safe_message = v_safe_message,
             completed_at = case when new.status = 'reconciliation_required' then null else now() end,
             updated_at = now()
       where id = v_item.id;

      update sellerpilot_private.product_listings
         set inventory_sync_status = case
               when new.status = 'reconciliation_required' then 'reconciliation_required'
               when v_provider_ok then 'succeeded'
               else 'failed'
             end,
             last_inventory_quantity = case when v_provider_ok then v_item.requested_quantity else last_inventory_quantity end,
             inventory_sync_error = case when v_provider_ok then null else v_safe_message end,
             last_inventory_synced_at = case when v_provider_ok then now() else last_inventory_synced_at end,
             last_verified_at = case when v_provider_ok then now() else last_verified_at end,
             updated_at = now()
       where id = v_item.listing_id;

      select count(*),
             count(*) filter (where status = 'succeeded'),
             count(*) filter (where status = 'failed'),
             count(*) filter (where status in ('pending', 'running')),
             count(*) filter (where status = 'reconciliation_required')
        into v_total, v_succeeded, v_failed, v_pending, v_reconciliation
        from sellerpilot_private.inventory_sync_items
       where run_id = v_item.run_id and status <> 'superseded';

      update sellerpilot_private.inventory_sync_runs
         set total_count = v_total,
             succeeded_count = v_succeeded,
             failed_count = v_failed,
             status = case
               when v_reconciliation > 0 then 'reconciliation_required'
               when v_pending > 0 then 'running'
               when v_total = 0 or v_succeeded = v_total then 'succeeded'
               when v_succeeded > 0 then 'partial'
               else 'failed'
             end,
             completed_at = case when v_pending = 0 and v_reconciliation = 0 then now() else null end,
             updated_at = now()
       where id = v_item.run_id and status <> 'superseded';

      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail
      ) values (
        v_item.owner_id,
        case
          when new.status = 'reconciliation_required' then 'inventory_remote_reconciliation_required'
          when v_provider_ok then 'inventory_remote_verified'
          else 'inventory_remote_failed'
        end,
        'product_listing',
        v_item.listing_id::text,
        jsonb_build_object('job_id', new.id, 'attempt_id', new.attempt_id, 'requested_quantity', v_item.requested_quantity)
      );
    end if;
  end if;

  if new.order_id is not null then
    v_tracking := case
      when new.channel = 'lazada' and nullif(trim(new.response_payload->>'remoteId'), '') is not null
        then left(trim(new.response_payload->>'remoteId'), 100)
      else nullif(left(trim(coalesce(new.shipment_tracking, '')), 100), '')
    end;
    update sellerpilot_private.commerce_orders o
       set shipment_write_status = case
             when new.status = 'reconciliation_required' then 'reconciliation_required'
             when v_provider_ok then 'succeeded'
             else 'failed'
           end,
           shipment_operation_attempt_id = new.attempt_id,
           shipment_request_fingerprint = new.request_fingerprint,
           shipping_carrier = coalesce(new.shipment_carrier, o.shipping_carrier),
           tracking_number = case when v_provider_ok then coalesce(v_tracking, o.tracking_number) else o.tracking_number end,
           status = case when v_provider_ok and new.operation = 'shipment.confirm' then 'shipped' else o.status end,
           shipped_at = case when v_provider_ok and new.operation = 'shipment.confirm' then coalesce(o.shipped_at, now()) else o.shipped_at end,
           last_shipment_at = now(),
           last_shipment_error = case when v_provider_ok then null else v_safe_message end,
           updated_at = now()
     where o.id = new.order_id;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    )
    select o.owner_id,
           case
             when new.status = 'reconciliation_required' then 'shipment_reconciliation_required'
             when v_provider_ok then 'shipment_confirmed'
             else 'shipment_failed'
           end,
           'order',
           o.id::text,
           jsonb_build_object('job_id', new.id, 'attempt_id', new.attempt_id, 'channel', new.channel)
      from sellerpilot_private.commerce_orders o
     where o.id = new.order_id;
  end if;

  return new;
end;
$$;

drop trigger if exists reconcile_gateway_resource_terminal
  on sellerpilot_private.channel_gateway_jobs;
create trigger reconcile_gateway_resource_terminal
after update of status on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.reconcile_gateway_resource_terminal();

create or replace function sellerpilot_private.guard_inventory_write_generation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
      from sellerpilot_private.inventory_sync_items i
     where i.product_id = new.product_id
       and i.status = 'reconciliation_required'
  ) or exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.product_listings l on l.id = j.listing_id
     where l.product_id = new.product_id
       and j.operation = 'inventory.update'
       and j.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'inventory remote write must complete or reconcile before a new generation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_inventory_write_generation
  on sellerpilot_private.inventory_sync_runs;
create trigger guard_inventory_write_generation
before insert on sellerpilot_private.inventory_sync_runs
for each row
execute function sellerpilot_private.guard_inventory_write_generation();

create or replace function sellerpilot_private.guard_inventory_item_supersede()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'superseded'
     and old.status in ('pending', 'running', 'reconciliation_required')
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs j
        where j.listing_id = old.listing_id
          and j.operation = 'inventory.update'
          and j.status in ('queued', 'running', 'reconciliation_required')
     ) then
    raise exception 'active inventory gateway write cannot be superseded';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_inventory_item_supersede
  on sellerpilot_private.inventory_sync_items;
create trigger guard_inventory_item_supersede
before update of status on sellerpilot_private.inventory_sync_items
for each row
execute function sellerpilot_private.guard_inventory_item_supersede();

create or replace function public.sellerpilot_service_fail_inventory_sync_item_prewrite(
  p_run_id uuid,
  p_item_id uuid,
  p_attempt_id uuid,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_total integer;
  v_succeeded integer;
  v_failed integer;
  v_pending integer;
begin
  if length(trim(coalesce(p_safe_message, ''))) not between 1 and 1000 then
    raise exception 'invalid inventory prewrite failure';
  end if;
  select i.id, i.run_id, i.listing_id, i.owner_id, i.status
    into v_item
    from sellerpilot_private.inventory_sync_items i
   where i.id = p_item_id and i.run_id = p_run_id
   for update;
  if not found or v_item.status not in ('pending', 'running') then return false; end if;
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs j
     where j.inventory_item_id = p_item_id
  ) then
    return false;
  end if;
  if p_attempt_id is not null and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.operation = 'inventory.update'
  ) then
    return false;
  end if;

  update sellerpilot_private.inventory_sync_items
     set status = 'failed',
         operation_attempt_id = p_attempt_id,
         safe_message = left(trim(p_safe_message), 1000),
         completed_at = now(),
         updated_at = now()
   where id = p_item_id;
  update sellerpilot_private.product_listings
     set inventory_sync_status = 'failed',
         inventory_sync_error = left(trim(p_safe_message), 1000),
         updated_at = now()
   where id = v_item.listing_id;

  select count(*),
         count(*) filter (where status = 'succeeded'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status in ('pending', 'running'))
    into v_total, v_succeeded, v_failed, v_pending
    from sellerpilot_private.inventory_sync_items
   where run_id = p_run_id and status <> 'superseded';
  update sellerpilot_private.inventory_sync_runs
     set total_count = v_total,
         succeeded_count = v_succeeded,
         failed_count = v_failed,
         status = case
           when v_pending > 0 then 'running'
           when v_total = 0 or v_succeeded = v_total then 'succeeded'
           when v_succeeded > 0 then 'partial'
           else 'failed'
         end,
         completed_at = case when v_pending = 0 then now() else null end,
         updated_at = now()
   where id = p_run_id and status <> 'superseded';
  return true;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_resource_gateway_job(
  uuid, uuid, text, text, jsonb, text, text, text, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_resource_gateway_job(
  uuid, uuid, text, text, jsonb, text, text, text, uuid, uuid, uuid, text, text
) to service_role;
revoke all on function public.sellerpilot_service_fail_inventory_sync_item_prewrite(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_fail_inventory_sync_item_prewrite(uuid, uuid, uuid, text)
  to service_role;
revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  to service_role;
revoke all on function sellerpilot_private.reconcile_gateway_resource_terminal()
  from public, anon, authenticated;

commit;
