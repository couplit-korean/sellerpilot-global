-- Bind every TracX delivery lookup to the credential owner. Provider reference
-- strings are not globally unique across SellerPilot workspaces.

begin;

create index if not exists commerce_orders_owner_tracx_reference_idx
  on sellerpilot_private.commerce_orders (owner_id, logistics_reference)
  where logistics_provider = 'tracx' and logistics_reference is not null;

create index if not exists commerce_orders_owner_tracx_tracking_idx
  on sellerpilot_private.commerce_orders (owner_id, tracking_number)
  where logistics_provider = 'tracx' and tracking_number is not null;

create or replace function public.sellerpilot_service_ingest_tracx_delivery(
  p_credential_id uuid,
  p_event jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_owner uuid;
  v_order_id uuid;
  v_candidate_count integer := 0;
  v_event_key text;
  v_packing text := left(trim(coalesce(p_event->>'PackingNo', '')), 100);
  v_tracking text := left(trim(coalesce(p_event->>'TrackingNo', '')), 100);
  v_reference text := left(trim(coalesce(p_event->>'RefOrderNo', '')), 240);
  v_status text := upper(left(trim(coalesce(p_event->>'StatusCode', '')), 20));
  v_status_desc text := left(trim(coalesce(p_event->>'StatusDesc', '')), 240);
  v_event_at timestamptz;
begin
  if jsonb_typeof(p_event) <> 'object'
     or octet_length(p_event::text) > 16000
     or v_status = ''
     or (v_packing = '' and v_tracking = '' and v_reference = '') then
    raise exception 'invalid TracX delivery event' using errcode = '42501';
  end if;

  select credential.created_by
    into v_event_owner
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'tracx'
     and credential.status in ('active', 'grace')
     and exists (
       select 1
         from sellerpilot_private.admin_users administrator
        where administrator.user_id = credential.created_by
     );
  if v_event_owner is null then
    raise exception 'TracX credential not found' using errcode = '42501';
  end if;

  begin
    v_event_at := nullif(trim(coalesce(p_event->>'Date', '')), '')::timestamptz;
  exception when others then
    v_event_at := null;
  end;

  select count(*)::integer,
         (array_agg(candidate.id order by candidate.updated_at desc, candidate.id))[1]
    into v_candidate_count, v_order_id
    from (
      select orders.id, orders.updated_at
        from sellerpilot_private.commerce_orders orders
       where orders.owner_id = v_event_owner
         and not orders.demo
         and orders.logistics_provider = 'tracx'
         and (
           (v_packing <> '' and orders.logistics_reference = v_packing)
           or (v_tracking <> '' and orders.tracking_number = v_tracking)
           or (v_reference <> '' and orders.logistics_reference = v_reference)
         )
    ) candidate;

  if v_candidate_count <> 1 then
    v_order_id := null;
  end if;

  v_event_key := encode(extensions.digest(concat_ws('|',
    v_packing,
    v_tracking,
    v_reference,
    v_status,
    coalesce(p_event->>'Date', ''),
    coalesce(p_event->>'DeliveryCompanyCode', '')
  ), 'sha256'), 'hex');

  insert into sellerpilot_private.tracx_delivery_events (
    owner_id,
    credential_id,
    event_key,
    packing_no,
    tracking_no,
    reference_order_no,
    delivery_company_code,
    status_code,
    status_desc,
    event_at,
    order_id
  ) values (
    v_event_owner,
    p_credential_id,
    v_event_key,
    nullif(v_packing, ''),
    nullif(v_tracking, ''),
    nullif(v_reference, ''),
    nullif(left(trim(coalesce(p_event->>'DeliveryCompanyCode', '')), 40), ''),
    v_status,
    nullif(v_status_desc, ''),
    v_event_at,
    v_order_id
  ) on conflict (owner_id, event_key) do nothing;

  if v_order_id is not null then
    update sellerpilot_private.commerce_orders orders
       set logistics_reference = coalesce(nullif(v_packing, ''), orders.logistics_reference),
           tracking_number = coalesce(nullif(v_tracking, ''), orders.tracking_number),
           delivery_status_code = v_status,
           delivery_status_desc = nullif(v_status_desc, ''),
           delivery_status_at = coalesce(v_event_at, clock_timestamp()),
           status = case when v_status = 'D4' then 'delivered' else orders.status end,
           delivered_at = case
             when v_status = 'D4'
               then coalesce(orders.delivered_at, v_event_at, clock_timestamp())
             else orders.delivered_at
           end,
           updated_at = clock_timestamp()
     where orders.id = v_order_id
       and orders.owner_id = v_event_owner
       and orders.logistics_provider = 'tracx'
       and (
         orders.delivery_status_at is null
         or coalesce(v_event_at, clock_timestamp()) >= orders.delivery_status_at
       );
  end if;

  return v_order_id is not null;
end;
$$;

revoke all on function public.sellerpilot_service_ingest_tracx_delivery(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_tracx_delivery(uuid, jsonb)
  to service_role;

commit;
