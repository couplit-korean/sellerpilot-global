-- Durable, one-time OAuth state verification for cross-tab channel callbacks.
-- Only a SHA-256 digest is stored. The plaintext state remains in the browser URL/cookie.

begin;

create table if not exists sellerpilot_private.channel_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  channel text not null check (channel in ('shopee', 'lazada', 'ebay')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists channel_oauth_states_expiry_idx
  on sellerpilot_private.channel_oauth_states (expires_at)
  where consumed_at is null;

alter table sellerpilot_private.channel_oauth_states enable row level security;
revoke all on sellerpilot_private.channel_oauth_states from public, anon, authenticated;

create or replace function public.sellerpilot_service_store_channel_oauth_state(
  p_owner_id uuid,
  p_credential_id uuid,
  p_channel text,
  p_state_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_channel not in ('shopee', 'lazada', 'ebay')
     or p_state_hash !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1
         from sellerpilot_private.channel_credentials c
        where c.id = p_credential_id
          and c.created_by = p_owner_id
          and c.channel = p_channel
          and c.status = 'active'
     ) then
    raise exception 'invalid oauth state request';
  end if;

  delete from sellerpilot_private.channel_oauth_states
   where expires_at < now() - interval '1 day';

  insert into sellerpilot_private.channel_oauth_states (
    state_hash, owner_id, credential_id, channel, expires_at
  ) values (
    p_state_hash, p_owner_id, p_credential_id, p_channel, now() + interval '10 minutes'
  );
  return true;
end;
$$;

create or replace function public.sellerpilot_service_claim_channel_oauth_state(
  p_owner_id uuid,
  p_channel text,
  p_state_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_credential_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_channel not in ('shopee', 'lazada', 'ebay') or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid oauth state claim';
  end if;

  update sellerpilot_private.channel_oauth_states
     set consumed_at = now()
   where state_hash = p_state_hash
     and owner_id = p_owner_id
     and channel = p_channel
     and consumed_at is null
     and expires_at > now()
  returning credential_id into v_credential_id;

  return v_credential_id;
end;
$$;

revoke all on function public.sellerpilot_service_store_channel_oauth_state(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_channel_oauth_state(uuid, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_store_channel_oauth_state(uuid, uuid, text, text) to service_role;
grant execute on function public.sellerpilot_service_claim_channel_oauth_state(uuid, text, text) to service_role;

commit;
