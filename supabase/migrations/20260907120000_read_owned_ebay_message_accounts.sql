-- Native eBay message viewing is owner-scoped. The older administrator-wide
-- credential listing does not establish ownership of private conversations.
create function public.sellerpilot_list_owned_ebay_message_accounts()
returns table (
  id uuid, environment text, version integer,
  seller_account_key text, seller_account_key_source text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return query
    select c.id, c.environment, c.version, c.seller_account_key, c.seller_account_key_source
      from sellerpilot_private.channel_credentials c
     where c.created_by = auth.uid() and c.channel = 'ebay' and c.status = 'active'
       and c.environment in ('sandbox', 'production')
     order by c.environment, c.version desc, c.id;
end;
$$;
revoke all on function public.sellerpilot_list_owned_ebay_message_accounts() from public, anon, service_role;
grant execute on function public.sellerpilot_list_owned_ebay_message_accounts() to authenticated;
notify pgrst, 'reload schema';
