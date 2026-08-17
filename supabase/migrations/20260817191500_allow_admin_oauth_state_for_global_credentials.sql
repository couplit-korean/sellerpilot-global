-- Channel credentials are shared across registered SellerPilot admins. OAuth
-- state remains owner-bound so only the admin who initiated the flow can claim
-- the callback, even when another admin originally created the credential.

begin;

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
  if p_channel not in ('shopee', 'lazada', 'ebay')
     or p_state_hash !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1
         from sellerpilot_private.admin_users a
        where a.user_id = p_owner_id
     )
     or not exists (
       select 1
         from sellerpilot_private.channel_credentials c
        where c.id = p_credential_id
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

revoke all on function public.sellerpilot_service_store_channel_oauth_state(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_store_channel_oauth_state(uuid, uuid, text, text)
  to service_role;

commit;
