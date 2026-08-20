-- Keep long-running channel synchronization stable while OAuth credentials
-- rotate. Provider diagnostics are metadata about the same authorization and
-- queued read jobs must follow the newly encrypted credential version.

begin;

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

  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = 'ebay' and c.status = 'active'
   for update;
  if not found then raise exception 'active eBay credential not found'; end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:ebay:' || v_environment));
  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = 'ebay' and c.environment = v_environment;

  v_fingerprint := upper(substr(encode(extensions.digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_ebay_%s_v%s_%s', v_environment, v_version, v_id),
    'SellerPilot refreshed eBay OAuth credential. Never expose to browser or logs.'
  ) into v_vault_id;

  update sellerpilot_private.channel_credentials set status = 'revoked', grace_ends_at = now()
   where id = p_credential_id;
  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, status,
    expires_at, rotation_interval_days, warning_days, last_rotated_at,
    last_checked_at, last_check_status, last_check_message, created_by
  )
  select v_id, 'ebay', v_environment, v_version, v_vault_id, v_fingerprint, 'active',
         p_expires_at, c.rotation_interval_days, c.warning_days, now(),
         c.last_checked_at, c.last_check_status, c.last_check_message, v_created_by
    from sellerpilot_private.channel_credentials c where c.id = p_credential_id;

  update sellerpilot_private.channel_gateway_jobs
     set credential_id = v_id, updated_at = now()
   where credential_id = p_credential_id and status = 'queued' and attempt_id is null;

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, 'ebay', v_environment, 'token_refreshed', null,
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint,
      'expires_at', p_expires_at, 'source', 'service_refresh',
      'diagnostic_preserved', true)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_service_refresh_shopee(
  p_credential_id uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null
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
  v_existing_expires_at timestamptz;
  v_fingerprint text;
begin
  if jsonb_typeof(p_secret_payload) <> 'object'
     or (p_secret_payload->>'partner_id') !~ '^[0-9]+$'
     or length(coalesce(p_secret_payload->>'partner_key', '')) < 16
     or (p_secret_payload->>'shop_id') !~ '^[0-9]+$'
     or length(coalesce(p_secret_payload->>'access_token', '')) < 8
     or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
     or octet_length(p_secret_payload::text) > 32000 then
    raise exception 'invalid refreshed credential';
  end if;

  select c.environment, c.created_by, c.expires_at
    into v_environment, v_created_by, v_existing_expires_at
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = 'shopee' and c.status = 'active'
   for update;
  if not found then raise exception 'active Shopee credential not found'; end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:shopee:' || v_environment));
  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = 'shopee' and c.environment = v_environment;

  v_fingerprint := upper(substr(encode(extensions.digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_shopee_%s_v%s_%s', v_environment, v_version, v_id),
    'SellerPilot refreshed Shopee OAuth credential. Never expose to browser or logs.'
  ) into v_vault_id;

  update sellerpilot_private.channel_credentials set status = 'revoked', grace_ends_at = now()
   where id = p_credential_id;
  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, status,
    expires_at, rotation_interval_days, warning_days, last_rotated_at,
    last_checked_at, last_check_status, last_check_message, created_by
  )
  select v_id, 'shopee', v_environment, v_version, v_vault_id, v_fingerprint, 'active',
         coalesce(p_expires_at, v_existing_expires_at), c.rotation_interval_days,
         c.warning_days, now(), c.last_checked_at, c.last_check_status,
         c.last_check_message, v_created_by
    from sellerpilot_private.channel_credentials c where c.id = p_credential_id;

  update sellerpilot_private.channel_gateway_jobs
     set credential_id = v_id, updated_at = now()
   where credential_id = p_credential_id and status = 'queued' and attempt_id is null;

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, 'shopee', v_environment, 'token_refreshed', null,
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint,
      'expires_at', coalesce(p_expires_at, v_existing_expires_at),
      'source', 'service_refresh', 'diagnostic_preserved', true)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_service_refresh_lazada(
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
  if jsonb_typeof(p_secret_payload) <> 'object'
     or length(coalesce(p_secret_payload->>'access_token', '')) < 8
     or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
     or octet_length(p_secret_payload::text) > 32000
     or p_expires_at is null
     or p_expires_at <= now() then
    raise exception 'invalid refreshed credential';
  end if;

  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = 'lazada' and c.status = 'active'
   for update;
  if not found then raise exception 'active Lazada credential not found'; end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:lazada:' || v_environment));
  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = 'lazada' and c.environment = v_environment;

  v_fingerprint := upper(substr(encode(extensions.digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_lazada_%s_v%s_%s', v_environment, v_version, v_id),
    'SellerPilot refreshed Lazada OAuth credential. Never expose to browser or logs.'
  ) into v_vault_id;

  update sellerpilot_private.channel_credentials set status = 'revoked', grace_ends_at = now()
   where id = p_credential_id;
  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, status,
    expires_at, rotation_interval_days, warning_days, last_rotated_at,
    last_checked_at, last_check_status, last_check_message, created_by
  )
  select v_id, 'lazada', v_environment, v_version, v_vault_id, v_fingerprint, 'active',
         p_expires_at, c.rotation_interval_days, c.warning_days, now(),
         c.last_checked_at, c.last_check_status, c.last_check_message, v_created_by
    from sellerpilot_private.channel_credentials c where c.id = p_credential_id;

  update sellerpilot_private.channel_gateway_jobs
     set credential_id = v_id, updated_at = now()
   where credential_id = p_credential_id and status = 'queued' and attempt_id is null;

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, 'lazada', v_environment, 'token_refreshed', null,
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint,
      'expires_at', p_expires_at, 'source', 'service_refresh',
      'diagnostic_preserved', true)
  );
  return v_id;
end;
$$;

-- An authenticated admin ID is part of the target-cache service contract.
-- Validate it instead of silently accepting an unused argument.
create or replace function public.sellerpilot_service_upsert_channel_market_target(
  p_owner_id uuid,
  p_credential_id uuid,
  p_channel text,
  p_target_id text,
  p_display_name text,
  p_market_code text,
  p_locale text,
  p_language text,
  p_currency text,
  p_remote_status text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_environment text;
  v_owner_id uuid;
begin
  if p_owner_id is null or not exists (
    select 1 from sellerpilot_private.admin_users a where a.user_id = p_owner_id
  ) then
    raise exception 'administrator actor required' using errcode = '42501';
  end if;
  if p_channel not in ('shopee', 'lazada')
     or upper(trim(p_market_code)) !~ '^[A-Z]{2}$'
     or upper(trim(p_currency)) !~ '^[A-Z]{3}$'
     or length(trim(coalesce(p_target_id, ''))) > 160
     or length(trim(coalesce(p_display_name, ''))) > 240 then
    raise exception 'invalid channel market target';
  end if;

  select c.environment, c.created_by into v_environment, v_owner_id
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active';
  if v_environment is null or v_owner_id is null then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_market_targets (
    owner_id, credential_id, channel, environment, target_id, display_name,
    market_code, locale, language, currency, remote_status, verified_at, updated_at
  ) values (
    v_owner_id, p_credential_id, p_channel, v_environment,
    left(trim(coalesce(p_target_id, '')), 160), left(trim(coalesce(p_display_name, '')), 240),
    upper(trim(p_market_code)), left(trim(p_locale), 20), left(trim(p_language), 80),
    upper(trim(p_currency)), left(trim(coalesce(p_remote_status, '')), 80), now(), now()
  )
  on conflict (owner_id, channel, environment, market_code, target_id) do update set
    credential_id = excluded.credential_id,
    display_name = excluded.display_name,
    locale = excluded.locale,
    language = excluded.language,
    currency = excluded.currency,
    remote_status = excluded.remote_status,
    verified_at = now(),
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Remove the unused product variable reported by plpgsql_check without
-- changing inventory verification behavior.
create or replace function public.sellerpilot_service_complete_inventory_sync_item(
  p_run_id uuid,p_item_id uuid,p_attempt_id uuid,p_success boolean,
  p_verified_quantity integer,p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid; v_listing uuid; v_channel text; v_requested integer;
  v_total integer; v_succeeded integer; v_failed integer; v_pending integer;
begin
  if p_verified_quantity is not null and p_verified_quantity not between 0 and 99999999 then raise exception 'invalid verified quantity'; end if;
  if length(coalesce(p_safe_message,''))>1000 then raise exception 'safe message too long'; end if;
  select i.owner_id,i.listing_id,i.channel,i.requested_quantity
    into v_owner,v_listing,v_channel,v_requested
    from sellerpilot_private.inventory_sync_items i where i.id=p_item_id and i.run_id=p_run_id for update;
  if v_owner is null or not exists(select 1 from sellerpilot_private.channel_operation_attempts a where a.id=p_attempt_id and a.channel=v_channel and a.operation='inventory.update') then
    raise exception 'inventory sync attempt mismatch';
  end if;
  p_success:=p_success and p_verified_quantity=v_requested;
  update sellerpilot_private.inventory_sync_items set
    status=case when p_success then 'succeeded' else 'failed' end,
    operation_attempt_id=p_attempt_id,safe_message=left(nullif(trim(coalesce(p_safe_message,'')),''),1000),
    completed_at=now(),updated_at=now() where id=p_item_id and status<>'superseded';
  update sellerpilot_private.product_listings set
    inventory_sync_status=case when p_success then 'succeeded' else 'failed' end,
    last_inventory_quantity=case when p_success then p_verified_quantity else last_inventory_quantity end,
    inventory_sync_error=case when p_success then null else left(nullif(trim(coalesce(p_safe_message,'')),''),1000) end,
    last_inventory_synced_at=case when p_success then now() else last_inventory_synced_at end,
    last_verified_at=case when p_success then now() else last_verified_at end,updated_at=now()
   where id=v_listing;
  select count(*),count(*) filter(where status='succeeded'),count(*) filter(where status='failed'),
         count(*) filter(where status in('pending','running'))
    into v_total,v_succeeded,v_failed,v_pending
    from sellerpilot_private.inventory_sync_items where run_id=p_run_id and status<>'superseded';
  update sellerpilot_private.inventory_sync_runs set total_count=v_total,succeeded_count=v_succeeded,failed_count=v_failed,
    status=case when v_pending>0 then 'running' when v_total=0 or v_succeeded=v_total then 'succeeded' when v_succeeded>0 then 'partial' else 'failed' end,
    completed_at=case when v_pending=0 then now() else null end,updated_at=now()
   where id=p_run_id and status<>'superseded';
  insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
  values(v_owner,case when p_success then 'inventory_remote_verified' else 'inventory_remote_failed' end,
    'product_listing',v_listing::text,jsonb_build_object('run_id',p_run_id,'attempt_id',p_attempt_id,'channel',v_channel,'requested_quantity',v_requested,'verified_quantity',p_verified_quantity));
  return true;
end;
$$;

-- Repair any periodic jobs that were queued before an earlier token rotation.
with latest as (
  select distinct on (c.channel, c.environment) c.id, c.channel, c.environment
    from sellerpilot_private.channel_credentials c
   where c.status = 'active' and c.channel in ('shopee','lazada','ebay')
   order by c.channel, c.environment, c.version desc
)
update sellerpilot_private.channel_gateway_jobs j
   set credential_id = latest.id, updated_at = now()
  from sellerpilot_private.channel_credentials old_credential, latest
 where j.credential_id = old_credential.id
   and j.status = 'queued'
   and j.attempt_id is null
   and old_credential.status <> 'active'
   and latest.channel = old_credential.channel
   and latest.environment = old_credential.environment;

revoke all on function public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_refresh_shopee(uuid,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_upsert_channel_market_target(uuid,uuid,text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_complete_inventory_sync_item(uuid,uuid,uuid,boolean,integer,text) from public,anon,authenticated;
revoke all on function public.sellerpilot_get_operations_snapshot_pre_accuracy() from public,anon,authenticated;
grant execute on function public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz) to service_role;
grant execute on function public.sellerpilot_service_refresh_shopee(uuid,jsonb,timestamptz) to service_role;
grant execute on function public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamptz) to service_role;
grant execute on function public.sellerpilot_service_upsert_channel_market_target(uuid,uuid,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.sellerpilot_service_complete_inventory_sync_item(uuid,uuid,uuid,boolean,integer,text) to service_role;

commit;
