-- Keep TracX/SmartShip credentials separate from selling-channel operations,
-- while reusing the audited Vault control plane. Persist only safe delivery
-- event metadata; customer addresses remain in the provider and private order
-- context and are never copied into webhook logs.

begin;

alter table sellerpilot_private.channel_credentials
  drop constraint if exists channel_credentials_channel_check;
alter table sellerpilot_private.channel_credentials
  add constraint channel_credentials_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu', 'tracx'));

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
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu', 'tracx')
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
  select c.id into v_previous_id
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment and c.status = 'active'
   for update;
  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment;
  v_fingerprint := upper(substr(encode(extensions.digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_%s_%s_v%s_%s', p_channel, p_environment, v_version, v_id),
    'SellerPilot provider credential. Never expose to browser or logs.'
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
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu', 'tracx')
     or p_environment not in ('sandbox', 'production') then
    raise exception 'unsupported credential selector';
  end if;
  select jsonb_build_object(
    'credential_id', c.id,
    'expires_at', c.expires_at,
    'secret_payload', d.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.channel = p_channel and c.environment = p_environment and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   limit 1;
  return v_result;
end;
$$;

alter table sellerpilot_private.commerce_orders
  add column if not exists logistics_provider text,
  add column if not exists logistics_reference text,
  add column if not exists delivery_status_code text,
  add column if not exists delivery_status_desc text,
  add column if not exists delivery_status_at timestamptz;

create table if not exists sellerpilot_private.tracx_delivery_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  event_key text not null,
  packing_no text,
  tracking_no text,
  reference_order_no text,
  delivery_company_code text,
  status_code text not null,
  status_desc text,
  event_at timestamptz,
  order_id uuid references sellerpilot_private.commerce_orders(id) on delete set null,
  received_at timestamptz not null default now(),
  unique (owner_id, event_key)
);

create index if not exists tracx_delivery_events_owner_time_idx
  on sellerpilot_private.tracx_delivery_events (owner_id, received_at desc);
create index if not exists tracx_delivery_events_tracking_idx
  on sellerpilot_private.tracx_delivery_events (owner_id, tracking_no, received_at desc);

create table if not exists sellerpilot_private.logistics_operation_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  provider text not null check (provider = 'tracx'),
  operation text not null check (operation in (
    'orders.list', 'orders.get', 'orders.cancel', 'returns.list',
    'tracking.get', 'shipping.get', 'inquiries.list', 'inquiries.get', 'inquiries.reply'
  )),
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  remote_code text,
  safe_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_id, provider, idempotency_key)
);

create index if not exists logistics_operation_attempts_owner_time_idx
  on sellerpilot_private.logistics_operation_attempts (owner_id, created_at desc);

alter table sellerpilot_private.tracx_delivery_events enable row level security;
alter table sellerpilot_private.logistics_operation_attempts enable row level security;
revoke all on sellerpilot_private.tracx_delivery_events from public, anon, authenticated;
revoke all on sellerpilot_private.logistics_operation_attempts from public, anon, authenticated;

create or replace function public.sellerpilot_claim_tracx_operation(
  p_credential_id uuid,
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
  v_owner uuid;
  v_existing sellerpilot_private.logistics_operation_attempts%rowtype;
begin
  if not public.sellerpilot_is_admin()
     or p_operation not in (
       'orders.list', 'orders.get', 'orders.cancel', 'returns.list',
       'tracking.get', 'shipping.get', 'inquiries.list', 'inquiries.get', 'inquiries.reply'
     )
     or length(trim(coalesce(p_idempotency_key, ''))) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid logistics operation claim' using errcode = '42501';
  end if;
  perform 1
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = 'tracx' and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now());
  if not found then
    raise exception 'active TracX credential required' using errcode = '42501';
  end if;
  -- SellerPilot intentionally exposes one shared operations workspace to all
  -- approved administrators. Keep the credential global, while recording the
  -- administrator who actually initiated this operation as its audit owner.
  v_owner := auth.uid();

  select * into v_existing
    from sellerpilot_private.logistics_operation_attempts a
   where a.owner_id = v_owner and a.provider = 'tracx'
     and a.idempotency_key = trim(p_idempotency_key);
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key reused with different request';
    end if;
    return jsonb_build_object(
      'attempt_id', v_existing.id,
      'duplicate', true,
      'status', v_existing.status,
      'safe_message', v_existing.safe_message,
      'remote_code', v_existing.remote_code
    );
  end if;

  insert into sellerpilot_private.logistics_operation_attempts (
    owner_id, credential_id, provider, operation, idempotency_key, request_fingerprint
  ) values (
    v_owner, p_credential_id, 'tracx', p_operation, trim(p_idempotency_key), p_request_fingerprint
  ) returning id into v_id;
  return jsonb_build_object('attempt_id', v_id, 'duplicate', false, 'status', 'running');
end;
$$;

create or replace function public.sellerpilot_service_complete_tracx_operation(
  p_attempt_id uuid,
  p_success boolean,
  p_remote_code text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_updated integer;
begin
  if length(coalesce(p_remote_code, '')) > 80
     or length(coalesce(p_safe_message, '')) > 500 then
    raise exception 'invalid logistics completion' using errcode = '42501';
  end if;
  update sellerpilot_private.logistics_operation_attempts
     set status = case when p_success then 'succeeded' else 'failed' end,
         remote_code = nullif(left(coalesce(p_remote_code, ''), 80), ''),
         safe_message = left(coalesce(p_safe_message, ''), 500),
         completed_at = now()
   where id = p_attempt_id and status = 'running';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_service_ingest_tracx_delivery(
  p_credential_id uuid,
  p_event jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
  v_order_id uuid;
  v_event_key text;
  v_tracking text := left(trim(coalesce(p_event->>'TrackingNo', '')), 100);
  v_reference text := left(trim(coalesce(p_event->>'RefOrderNo', '')), 240);
  v_status text := upper(left(trim(coalesce(p_event->>'StatusCode', '')), 20));
  v_status_desc text := left(trim(coalesce(p_event->>'StatusDesc', '')), 240);
  v_event_at timestamptz;
begin
  if jsonb_typeof(p_event) <> 'object'
     or octet_length(p_event::text) > 16000
     or v_status = ''
     or (v_tracking = '' and v_reference = '') then
    raise exception 'invalid TracX delivery event' using errcode = '42501';
  end if;
  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = 'tracx' and c.status in ('active', 'grace');
  if v_owner is null then raise exception 'TracX credential not found'; end if;
  begin
    v_event_at := nullif(trim(coalesce(p_event->>'Date', '')), '')::timestamptz;
  exception when others then
    v_event_at := null;
  end;

  select o.id into v_order_id
    from sellerpilot_private.commerce_orders o
   where o.owner_id = v_owner and not o.demo
     and ((v_reference <> '' and o.external_order_id = v_reference)
       or (v_tracking <> '' and o.tracking_number = v_tracking))
   order by case when v_reference <> '' and o.external_order_id = v_reference then 0 else 1 end,
            o.updated_at desc
   limit 1;

  v_event_key := encode(extensions.digest(concat_ws('|',
    coalesce(p_event->>'PackingNo', ''), v_tracking, v_reference, v_status,
    coalesce(p_event->>'Date', ''), coalesce(p_event->>'DeliveryCompanyCode', '')
  ), 'sha256'), 'hex');

  insert into sellerpilot_private.tracx_delivery_events (
    owner_id, credential_id, event_key, packing_no, tracking_no, reference_order_no,
    delivery_company_code, status_code, status_desc, event_at, order_id
  ) values (
    v_owner, p_credential_id, v_event_key,
    nullif(left(trim(coalesce(p_event->>'PackingNo', '')), 100), ''), nullif(v_tracking, ''),
    nullif(v_reference, ''), nullif(left(trim(coalesce(p_event->>'DeliveryCompanyCode', '')), 40), ''),
    v_status, nullif(v_status_desc, ''), v_event_at, v_order_id
  ) on conflict (owner_id, event_key) do nothing;

  if v_order_id is not null then
    update sellerpilot_private.commerce_orders
       set logistics_provider = 'tracx',
           logistics_reference = coalesce(nullif(left(trim(coalesce(p_event->>'PackingNo', '')), 100), ''), logistics_reference),
           tracking_number = coalesce(nullif(v_tracking, ''), tracking_number),
           delivery_status_code = v_status,
           delivery_status_desc = nullif(v_status_desc, ''),
           delivery_status_at = coalesce(v_event_at, now()),
           status = case when v_status = 'D4' then 'delivered' else status end,
           delivered_at = case when v_status = 'D4' then coalesce(delivered_at, v_event_at, now()) else delivered_at end,
           updated_at = now()
     where id = v_order_id
       and (delivery_status_at is null or coalesce(v_event_at, now()) >= delivery_status_at);
  end if;
  return v_order_id is not null;
end;
$$;

revoke all on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) from public, anon;
revoke all on function public.sellerpilot_get_active_credential_secret(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_claim_tracx_operation(uuid, text, text, text) from public, anon;
revoke all on function public.sellerpilot_service_complete_tracx_operation(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_ingest_tracx_delivery(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) to authenticated;
grant execute on function public.sellerpilot_get_active_credential_secret(text, text) to service_role;
grant execute on function public.sellerpilot_claim_tracx_operation(uuid, text, text, text) to authenticated;
grant execute on function public.sellerpilot_service_complete_tracx_operation(uuid, boolean, text, text) to service_role;
grant execute on function public.sellerpilot_service_ingest_tracx_delivery(uuid, jsonb) to service_role;

commit;
