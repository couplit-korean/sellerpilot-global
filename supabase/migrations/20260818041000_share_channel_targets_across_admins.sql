-- Shop/seller target metadata is non-secret operational data. Credentials stay
-- encrypted, while every SellerPilot administrator can reuse the same verified
-- target cache instead of re-querying providers on every product screen.

begin;

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
  if p_channel not in ('shopee', 'lazada')
     or upper(trim(p_market_code)) !~ '^[A-Z]{2}$'
     or upper(trim(p_currency)) !~ '^[A-Z]{3}$'
     or length(trim(coalesce(p_target_id, ''))) > 160
     or length(trim(coalesce(p_display_name, ''))) > 240 then
    raise exception 'invalid channel market target';
  end if;

  select c.environment, c.created_by into v_environment, v_owner_id
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active';
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

create or replace function public.sellerpilot_list_channel_market_targets(p_channel text)
returns table (
  target_id text,
  display_name text,
  market_code text,
  locale text,
  language text,
  currency text,
  remote_status text,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select t.target_id, t.display_name, t.market_code, t.locale, t.language,
         t.currency, t.remote_status, t.verified_at
    from sellerpilot_private.channel_market_targets t
   where public.sellerpilot_is_admin()
     and t.channel = p_channel
     and t.environment = 'production'
   order by t.market_code, t.display_name
$$;

revoke all on function public.sellerpilot_service_upsert_channel_market_target(uuid, uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_upsert_channel_market_target(uuid, uuid, text, text, text, text, text, text, text, text) to service_role;
revoke all on function public.sellerpilot_list_channel_market_targets(text) from public, anon;
grant execute on function public.sellerpilot_list_channel_market_targets(text) to authenticated;

commit;
