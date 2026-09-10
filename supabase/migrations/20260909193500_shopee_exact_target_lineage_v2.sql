-- Exact Shopee target cache/read contract. The v1 list/upsert RPCs remain
-- unchanged so existing callers can move to this credential-bound contract.

begin;

create function public.sellerpilot_get_active_credential_secret_v2(
  p_channel text,
  p_environment text default 'production'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'contract_version', 2,
    'credential_id', c.id,
    'credential_version', c.version,
    'expires_at', c.expires_at,
    'secret_payload', d.decrypted_secret::jsonb
  )
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.channel = p_channel
     and c.environment = p_environment
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > pg_catalog.clock_timestamp())
     and p_channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu', 'tracx')
     and p_environment in ('sandbox', 'production')
   limit 1
$$;

create function public.sellerpilot_list_channel_market_targets_v2(p_channel text)
returns table (
  target_id text,
  display_name text,
  market_code text,
  locale text,
  language text,
  currency text,
  remote_status text,
  verified_at timestamptz,
  credential_id uuid,
  credential_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.target_id, t.display_name, t.market_code, t.locale, t.language,
         t.currency, t.remote_status, t.verified_at, t.credential_id,
         c.version as credential_version
    from sellerpilot_private.channel_market_targets t
    join sellerpilot_private.channel_credentials c on c.id = t.credential_id
   where public.sellerpilot_is_admin()
     and t.channel = p_channel
     and t.environment = 'production'
     and p_channel in ('shopee', 'lazada')
   order by t.market_code, t.display_name, t.target_id
$$;

create function public.sellerpilot_service_upsert_shopee_market_target_v2(
  p_owner_id uuid,
  p_expected_credential_id uuid,
  p_expected_credential_version integer,
  p_target_id text,
  p_display_name text,
  p_market_code text,
  p_locale text,
  p_language text,
  p_currency text,
  p_remote_status text,
  p_provider_subject text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_record_id uuid;
  v_credential_owner_id uuid;
  v_vault_secret_id uuid;
  v_secret_payload jsonb;
  v_target jsonb;
  v_target_count integer;
  v_access_expires_at timestamptz;
begin
  if p_owner_id is null
     or not exists (
       select 1 from sellerpilot_private.admin_users a where a.user_id = p_owner_id
     )
     or p_expected_credential_id is null
     or p_expected_credential_version is null
     or p_expected_credential_version < 1
     or coalesce(pg_catalog.btrim(p_target_id), '') !~ '^[1-9][0-9]{0,31}$'
     or pg_catalog.upper(pg_catalog.btrim(coalesce(p_market_code, ''))) <> 'SG'
     or pg_catalog.btrim(coalesce(p_locale, '')) <> 'en-SG'
     or pg_catalog.btrim(coalesce(p_language, '')) <> 'English'
     or pg_catalog.upper(pg_catalog.btrim(coalesce(p_currency, ''))) <> 'SGD'
     or length(pg_catalog.btrim(coalesce(p_display_name, ''))) not between 1 and 240
     or length(pg_catalog.btrim(coalesce(p_remote_status, ''))) > 80
     or coalesce(pg_catalog.btrim(p_provider_subject), '') !~ '^shopee:(main|shop):[1-9][0-9]{0,31}$'
     or p_observed_at is null
     or p_observed_at < pg_catalog.clock_timestamp() - interval '10 minutes'
     or p_observed_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'SHOPEE_EXACT_TARGET_METADATA_INVALID' using errcode = '22023';
  end if;

  -- Coordinate with credential rotation and then lock the exact active row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sellerpilot:shopee:production'));
  select c.created_by, c.vault_secret_id
    into v_credential_owner_id, v_vault_secret_id
    from sellerpilot_private.channel_credentials c
   where c.id = p_expected_credential_id
     and c.channel = 'shopee'
     and c.environment = 'production'
     and c.status = 'active'
     and c.version = p_expected_credential_version
     and (c.expires_at is null or c.expires_at > pg_catalog.clock_timestamp() + interval '10 minutes')
   for update;
  if not found then
    raise exception 'SHOPEE_EXACT_TARGET_CREDENTIAL_CHANGED' using errcode = '40001';
  end if;

  select d.decrypted_secret::jsonb
    into v_secret_payload
    from vault.decrypted_secrets d
   where d.id = v_vault_secret_id;
  if v_secret_payload is null
     or v_secret_payload ->> 'provider_account_identity_version' is distinct from 'v1'
     or v_secret_payload ->> 'provider_account_subject' is distinct from pg_catalog.btrim(p_provider_subject) then
    raise exception 'SHOPEE_EXACT_TARGET_IDENTITY_MISMATCH' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_target_count
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(v_secret_payload -> 'shopee_targets') = 'array'
        then v_secret_payload -> 'shopee_targets'
        else '[]'::jsonb
      end
    ) entry(value)
   where value ->> 'type' = 'shop'
     and value ->> 'id' = pg_catalog.btrim(p_target_id);
  if v_target_count <> 1 then
    raise exception 'SHOPEE_EXACT_TARGET_NOT_AUTHORIZED' using errcode = '22023';
  end if;
  select value
    into v_target
    from pg_catalog.jsonb_array_elements(v_secret_payload -> 'shopee_targets') entry(value)
   where value ->> 'type' = 'shop'
     and value ->> 'id' = pg_catalog.btrim(p_target_id)
   limit 1;

  begin
    v_access_expires_at := (v_target ->> 'access_token_expires_at')::timestamptz;
  exception when others then
    raise exception 'SHOPEE_EXACT_TARGET_ACCESS_NOT_FRESH' using errcode = '22023';
  end;
  if v_access_expires_at is null
     or v_access_expires_at <= pg_catalog.clock_timestamp() + interval '10 minutes' then
    raise exception 'SHOPEE_EXACT_TARGET_ACCESS_NOT_FRESH' using errcode = '22023';
  end if;

  insert into sellerpilot_private.channel_market_targets (
    owner_id, credential_id, channel, environment, target_id, display_name,
    market_code, locale, language, currency, remote_status, verified_at, updated_at
  ) values (
    v_credential_owner_id, p_expected_credential_id, 'shopee', 'production',
    pg_catalog.btrim(p_target_id), pg_catalog.btrim(p_display_name), 'SG',
    'en-SG', 'English', 'SGD', pg_catalog.btrim(coalesce(p_remote_status, '')),
    p_observed_at, pg_catalog.clock_timestamp()
  )
  on conflict (owner_id, channel, environment, market_code, target_id) do update set
    credential_id = excluded.credential_id,
    display_name = excluded.display_name,
    locale = excluded.locale,
    language = excluded.language,
    currency = excluded.currency,
    remote_status = excluded.remote_status,
    verified_at = excluded.verified_at,
    updated_at = pg_catalog.clock_timestamp()
  returning id into v_target_record_id;

  return pg_catalog.jsonb_build_object(
    'contractVersion', 2,
    'targetRecordId', v_target_record_id,
    'credentialId', p_expected_credential_id,
    'credentialVersion', p_expected_credential_version,
    'targetId', pg_catalog.btrim(p_target_id),
    'marketCode', 'SG',
    'verifiedAt', p_observed_at
  );
end;
$$;

revoke all on function public.sellerpilot_get_active_credential_secret_v2(text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_get_active_credential_secret_v2(text, text) to service_role;

revoke all on function public.sellerpilot_list_channel_market_targets_v2(text) from public, anon, service_role;
grant execute on function public.sellerpilot_list_channel_market_targets_v2(text) to authenticated;

revoke all on function public.sellerpilot_service_upsert_shopee_market_target_v2(uuid, uuid, integer, text, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_upsert_shopee_market_target_v2(uuid, uuid, integer, text, text, text, text, text, text, text, text, timestamptz) to service_role;

commit;
