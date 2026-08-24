begin;
create or replace function public.sellerpilot_service_complete_inventory_sync_item(
  p_run_id uuid,
  p_item_id uuid,
  p_attempt_id uuid,
  p_success boolean,
  p_verified_quantity integer,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_listing uuid;
  v_channel text;
  v_requested integer;
  v_total integer;
  v_succeeded integer;
  v_failed integer;
  v_pending integer;
begin
  if p_verified_quantity is not null and p_verified_quantity not between 0 and 99999999 then
    raise exception 'invalid verified quantity';
  end if;
  if length(coalesce(p_safe_message, '')) > 1000 then
    raise exception 'safe message too long';
  end if;

  select i.owner_id, i.listing_id, i.channel, i.requested_quantity
    into v_owner, v_listing, v_channel, v_requested
    from sellerpilot_private.inventory_sync_items i
   where i.id = p_item_id and i.run_id = p_run_id
   for update;

  if v_owner is null then raise exception 'inventory sync item not found'; end if;
  if p_success and p_attempt_id is null then raise exception 'successful inventory sync requires an attempt'; end if;
  if p_attempt_id is not null and not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.channel = v_channel
       and a.operation = 'inventory.update'
  ) then
    raise exception 'inventory sync attempt mismatch';
  end if;

  p_success := p_success and p_verified_quantity = v_requested;
  update sellerpilot_private.inventory_sync_items
     set status = case when p_success then 'succeeded' else 'failed' end,
         operation_attempt_id = p_attempt_id,
         safe_message = left(nullif(trim(coalesce(p_safe_message, '')), ''), 1000),
         completed_at = now(),
         updated_at = now()
   where id = p_item_id and status <> 'superseded';

  update sellerpilot_private.product_listings
     set inventory_sync_status = case when p_success then 'succeeded' else 'failed' end,
         last_inventory_quantity = case when p_success then p_verified_quantity else last_inventory_quantity end,
         inventory_sync_error = case when p_success then null else left(nullif(trim(coalesce(p_safe_message, '')), ''), 1000) end,
         last_inventory_synced_at = case when p_success then now() else last_inventory_synced_at end,
         last_verified_at = case when p_success then now() else last_verified_at end,
         updated_at = now()
   where id = v_listing;

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
         status = case when v_pending > 0 then 'running'
                       when v_total = 0 or v_succeeded = v_total then 'succeeded'
                       when v_succeeded > 0 then 'partial'
                       else 'failed' end,
         completed_at = case when v_pending = 0 then now() else null end,
         updated_at = now()
   where id = p_run_id and status <> 'superseded';

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner,
    case when p_success then 'inventory_remote_verified' else 'inventory_remote_failed' end,
    'product_listing',
    v_listing::text,
    jsonb_build_object(
      'run_id', p_run_id,
      'attempt_id', p_attempt_id,
      'channel', v_channel,
      'requested_quantity', v_requested,
      'verified_quantity', p_verified_quantity
    )
  );
  return true;
end;
$$;
revoke all on function public.sellerpilot_service_complete_inventory_sync_item(uuid, uuid, uuid, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_complete_inventory_sync_item(uuid, uuid, uuid, boolean, integer, text)
  to service_role;
commit;

