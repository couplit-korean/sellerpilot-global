-- An idempotent retry must remain bound to the run created for that key.
-- Reading the latest run for the product can otherwise expose a newer
-- generation's tasks to an older request.

begin;

create or replace function public.sellerpilot_get_inventory_sync_run(
  p_product_id uuid,
  p_run_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.sellerpilot_is_admin() then null else (
    select jsonb_build_object(
      'runId', r.id,
      'status', r.status,
      'requestedOnHand', r.requested_on_hand,
      'availableQuantity', r.available_quantity,
      'totalCount', r.total_count,
      'succeededCount', r.succeeded_count,
      'failedCount', r.failed_count,
      'createdAt', r.created_at,
      'completedAt', r.completed_at,
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'listingId', i.listing_id,
          'channel', i.channel,
          'market', i.market,
          'targetId', i.target_id,
          'remoteId', i.remote_id,
          'quantity', i.requested_quantity,
          'status', i.status,
          'safeMessage', i.safe_message,
          'attemptId', i.operation_attempt_id,
          'completedAt', i.completed_at
        ) order by i.channel, i.market, i.target_id)
          from sellerpilot_private.inventory_sync_items i
         where i.run_id = r.id
      ), '[]'::jsonb)
    )
      from sellerpilot_private.inventory_sync_runs r
     where r.id = p_run_id
       and r.product_id = p_product_id
  ) end
$$;

create or replace function public.sellerpilot_start_inventory_sync(
  p_product_id uuid,
  p_on_hand integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_run_id uuid;
  v_reserved integer;
  v_reorder_point integer;
  v_available integer;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_on_hand not between 0 and 99999999
     or length(trim(coalesce(p_idempotency_key, ''))) not between 16 and 160 then
    raise exception 'invalid inventory sync request';
  end if;

  select p.owner_id, p.reserved, p.reorder_point
    into v_owner, v_reserved, v_reorder_point
    from sellerpilot_private.products p
   where p.id = p_product_id
     and not p.demo
     and p.status <> 'archived'
   for update;
  if v_owner is null then raise exception 'product not found'; end if;
  if p_on_hand < v_reserved then
    raise exception 'on hand cannot be below reserved inventory';
  end if;

  select r.id
    into v_run_id
    from sellerpilot_private.inventory_sync_runs r
   where r.owner_id = v_owner
     and r.idempotency_key = trim(p_idempotency_key);
  if v_run_id is not null then
    if not exists (
      select 1
        from sellerpilot_private.inventory_sync_runs r
       where r.id = v_run_id
         and r.owner_id = v_owner
         and r.product_id = p_product_id
         and r.requested_on_hand = p_on_hand
    ) then
      raise exception 'idempotency key payload mismatch';
    end if;
    return public.sellerpilot_get_inventory_sync_run(p_product_id, v_run_id);
  end if;

  update sellerpilot_private.inventory_sync_items
     set status = 'superseded', completed_at = now(), updated_at = now()
   where owner_id = v_owner
     and product_id = p_product_id
     and status in ('pending', 'running');
  update sellerpilot_private.inventory_sync_runs
     set status = 'superseded', completed_at = now(), updated_at = now()
   where owner_id = v_owner
     and product_id = p_product_id
     and status in ('pending', 'running');

  v_available := p_on_hand - v_reserved;
  update sellerpilot_private.products
     set on_hand = p_on_hand,
         status = case
           when v_available = 0 then 'out_of_stock'
           when v_available <= v_reorder_point then 'low_stock'
           else 'active'
         end,
         updated_at = now()
   where id = p_product_id;

  insert into sellerpilot_private.inventory_sync_runs (
    owner_id, product_id, idempotency_key, requested_on_hand, available_quantity
  ) values (
    v_owner, p_product_id, trim(p_idempotency_key), p_on_hand, v_available
  )
  returning id into v_run_id;

  insert into sellerpilot_private.inventory_sync_items (
    run_id, owner_id, product_id, listing_id, channel, market, target_id,
    remote_id, requested_quantity
  )
  select v_run_id, v_owner, p_product_id, l.id, l.channel_key, l.market,
         l.target_id, l.remote_id, v_available
    from sellerpilot_private.product_listings l
   where l.owner_id = v_owner
     and l.product_id = p_product_id
     and l.status = 'published'
     and nullif(trim(coalesce(l.remote_id, '')), '') is not null
     and l.channel_key <> 'elevenst';

  update sellerpilot_private.product_listings l
     set inventory_sync_status = 'pending',
         inventory_sync_error = null,
         updated_at = now()
   where l.id in (
     select i.listing_id
       from sellerpilot_private.inventory_sync_items i
      where i.run_id = v_run_id
   );

  update sellerpilot_private.inventory_sync_runs r
     set total_count = (
           select count(*)
             from sellerpilot_private.inventory_sync_items i
            where i.run_id = v_run_id
         ),
         status = case when exists (
           select 1
             from sellerpilot_private.inventory_sync_items i
            where i.run_id = v_run_id
         ) then 'running' else 'succeeded' end,
         completed_at = case when exists (
           select 1
             from sellerpilot_private.inventory_sync_items i
            where i.run_id = v_run_id
         ) then null else now() end,
         updated_at = now()
   where r.id = v_run_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_actor,
    'inventory_sync_started',
    'product',
    p_product_id::text,
    jsonb_build_object(
      'run_id', v_run_id,
      'product_owner', v_owner,
      'requested_on_hand', p_on_hand,
      'available_quantity', v_available
    )
  );

  return public.sellerpilot_get_inventory_sync_run(p_product_id, v_run_id);
end;
$$;

revoke all on function public.sellerpilot_get_inventory_sync_run(uuid, uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_inventory_sync_run(uuid, uuid)
  to authenticated;
revoke all on function public.sellerpilot_start_inventory_sync(uuid, integer, text)
  from public, anon;
grant execute on function public.sellerpilot_start_inventory_sync(uuid, integer, text)
  to authenticated;

commit;
