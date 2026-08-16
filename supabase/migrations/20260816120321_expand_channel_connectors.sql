-- Expand the credential control plane to every active SellerPilot sales channel.
-- Secrets remain in Vault and are available only through service-role RPCs.

begin;

alter table sellerpilot_private.channel_credentials
  drop constraint if exists channel_credentials_channel_check;

alter table sellerpilot_private.channel_credentials
  add constraint channel_credentials_channel_check
  check (channel in ('qoo10', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay'));

update sellerpilot_private.channels
   set status = 'auth_required', updated_at = now()
 where key in ('coupang', 'elevenst', 'smartstore', 'ebay')
   and status = 'planned';

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
  if p_channel not in ('qoo10', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay') then
    raise exception 'unsupported channel';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'unsupported environment';
  end if;
  if p_rotation_interval_days not between 1 and 365 or p_warning_days not between 1 and 180 or p_grace_days not between 0 and 30 then
    raise exception 'invalid rotation schedule';
  end if;
  if jsonb_typeof(p_secret_payload) <> 'object' or p_secret_payload = '{}'::jsonb or length(p_secret_payload::text) > 32000 then
    raise exception 'invalid secret payload';
  end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:' || p_channel || ':' || p_environment));
  select c.id into v_previous_id
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment and c.status = 'active'
   for update;

  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment;

  v_fingerprint := upper(substr(encode(digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
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
    v_id, p_channel, p_environment, v_version, v_vault_id, v_fingerprint,
    p_expires_at, p_rotation_interval_days, p_warning_days, v_now, auth.uid()
  );

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, p_channel, p_environment,
    case when v_previous_id is null then 'created' else 'rotated' end,
    auth.uid(),
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint, 'expires_at', p_expires_at, 'grace_days', p_grace_days)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_service_refresh_ebay(
  p_credential_id uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz
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
  v_environment text;
  v_created_by uuid;
  v_fingerprint text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_secret_payload) <> 'object'
     or length(coalesce(p_secret_payload->>'access_token', '')) < 8
     or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
     or length(coalesce(p_secret_payload->>'client_id', '')) < 3
     or length(coalesce(p_secret_payload->>'client_secret', '')) < 3
     or octet_length(p_secret_payload::text) > 32000
     or p_expires_at is null
     or p_expires_at <= now() then
    raise exception 'invalid refreshed credential';
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'ebay'
     and c.status = 'active'
   for update;
  if not found then raise exception 'active eBay credential not found'; end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:ebay:' || v_environment));
  select coalesce(max(c.version), 0) + 1
    into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = 'ebay' and c.environment = v_environment;

  v_fingerprint := upper(substr(encode(digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_ebay_%s_v%s_%s', v_environment, v_version, v_id),
    'SellerPilot refreshed eBay OAuth credential. Never expose to browser or logs.'
  ) into v_vault_id;

  update sellerpilot_private.channel_credentials
     set status = 'revoked', grace_ends_at = now()
   where id = p_credential_id;

  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, status,
    expires_at, rotation_interval_days, warning_days, last_rotated_at, created_by
  )
  select v_id, 'ebay', v_environment, v_version, v_vault_id, v_fingerprint, 'active',
         p_expires_at, c.rotation_interval_days, c.warning_days, now(), v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id;

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, 'ebay', v_environment, 'token_refreshed', null,
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint, 'expires_at', p_expires_at, 'source', 'service_refresh')
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
declare
  v_result jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay')
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
   where c.channel = p_channel
     and c.environment = p_environment
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   limit 1;

  return v_result;
end;
$$;

create table if not exists sellerpilot_private.channel_operation_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  channel text not null check (channel in ('qoo10', 'lazada', 'coupang', 'smartstore', 'ebay')),
  operation text not null check (operation in (
    'categories.list', 'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'shipment.acknowledge', 'shipment.confirm'
  )),
  idempotency_key text not null check (length(idempotency_key) between 16 and 160),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'manual_required')),
  http_status integer,
  remote_id text,
  safe_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_id, channel, operation, idempotency_key)
);

create index if not exists channel_operation_attempts_owner_time_idx
  on sellerpilot_private.channel_operation_attempts (owner_id, started_at desc);

alter table sellerpilot_private.channel_operation_attempts enable row level security;
revoke all on sellerpilot_private.channel_operation_attempts from public, anon, authenticated;

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
  v_inserted boolean := false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'lazada', 'coupang', 'smartstore', 'ebay')
     or p_operation not in (
       'categories.list', 'listing.create', 'listing.update', 'listing.stop',
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
  returning id, status, request_fingerprint into v_id, v_status, v_fingerprint;
  v_inserted := found;

  if not v_inserted then
    select a.id, a.status, a.request_fingerprint
      into v_id, v_status, v_fingerprint
      from sellerpilot_private.channel_operation_attempts a
     where a.owner_id = auth.uid()
       and a.channel = p_channel
       and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key);
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;
  end if;

  return jsonb_build_object('attempt_id', v_id, 'status', v_status, 'duplicate', not v_inserted);
end;
$$;

create or replace function public.sellerpilot_service_complete_channel_operation(
  p_attempt_id uuid,
  p_status text,
  p_http_status integer,
  p_remote_id text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_updated integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed', 'manual_required') then
    raise exception 'invalid operation status';
  end if;
  update sellerpilot_private.channel_operation_attempts
     set status = p_status,
         http_status = p_http_status,
         remote_id = left(nullif(trim(p_remote_id), ''), 200),
         safe_message = left(nullif(trim(p_safe_message), ''), 1000),
         completed_at = now()
   where id = p_attempt_id and status = 'running';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) from public, anon;
grant execute on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) to authenticated;
revoke all on function public.sellerpilot_service_refresh_ebay(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_refresh_ebay(uuid, jsonb, timestamptz) to service_role;
revoke all on function public.sellerpilot_get_active_credential_secret(text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_get_active_credential_secret(text, text) to service_role;
revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) from public, anon;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text) to authenticated;
revoke all on function public.sellerpilot_service_complete_channel_operation(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_complete_channel_operation(uuid, text, integer, text, text) to service_role;

commit;
