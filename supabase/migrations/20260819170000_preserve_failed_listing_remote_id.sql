-- Preserve a provider-created identifier when the final verification fails.
-- Failed listings are never included in inventory sync, but keeping the id lets
-- the next confirmed retry resume the same remote object instead of creating a
-- duplicate (notably Shopee GlobalProduct's asynchronous publish flow).

begin;
update sellerpilot_private.product_listings l
   set remote_id = trim(a.remote_id),
       updated_at = now()
  from sellerpilot_private.channel_operation_attempts a
 where l.operation_attempt_id = a.id
   and l.status = 'failed'
   and nullif(trim(coalesce(l.remote_id, '')), '') is null
   and nullif(trim(coalesce(a.remote_id, '')), '') is not null;
create or replace function public.sellerpilot_service_complete_product_listing(
  p_listing_id uuid,
  p_attempt_id uuid,
  p_operation text,
  p_success boolean,
  p_remote_id text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
  v_product uuid;
  v_channel text;
  v_updated integer := 0;
begin
  if p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or length(coalesce(p_remote_id, '')) > 240
     or length(coalesce(p_safe_message, '')) > 1000 then
    raise exception 'invalid listing completion request';
  end if;

  select l.owner_id, l.product_id, l.channel_key
    into v_owner, v_product, v_channel
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id;
  if v_owner is null or not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.owner_id = v_owner
       and a.channel = v_channel
       and a.operation = p_operation
  ) then
    raise exception 'listing attempt mismatch';
  end if;

  update sellerpilot_private.product_listings
     set status = case
       when not p_success then 'failed'
       when p_operation = 'listing.stop' then 'paused'
       else 'published'
     end,
         remote_id = case
           when nullif(trim(coalesce(p_remote_id, '')), '') is not null then trim(p_remote_id)
           else remote_id
         end,
         operation_attempt_id = p_attempt_id,
         last_error = case when p_success then null else nullif(trim(coalesce(p_safe_message, '')), '') end,
         published_at = case
           when p_success and p_operation in ('listing.create', 'listing.update') then coalesce(published_at, now())
           else published_at
         end,
         last_verified_at = case when p_success then now() else last_verified_at end,
         updated_at = now()
   where id = p_listing_id;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    update sellerpilot_private.products
       set status = case
         when p_success and p_operation in ('listing.create', 'listing.update') then 'active'
         when p_success and p_operation = 'listing.stop' and not exists (
           select 1 from sellerpilot_private.product_listings l
            where l.product_id = v_product and l.status = 'published'
         ) then 'archived'
         else status
       end,
           updated_at = now()
     where id = v_product;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner,
      case when p_success then 'listing_remote_succeeded' else 'listing_remote_failed' end,
      'product_listing', p_listing_id::text,
      jsonb_build_object(
        'attempt_id', p_attempt_id,
        'operation', p_operation,
        'channel', v_channel,
        'has_remote_id', nullif(trim(coalesce(p_remote_id, '')), '') is not null
      )
    );
  end if;
  return v_updated = 1;
end;
$$;
revoke all on function public.sellerpilot_service_complete_product_listing(uuid, uuid, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_complete_product_listing(uuid, uuid, text, boolean, text, text)
  to service_role;
commit;
