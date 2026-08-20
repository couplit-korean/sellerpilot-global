-- Persist normalized customer inquiries and allow the fixed-IP gateway to
-- execute the read-only inquiry collectors.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_operation_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get', 'inquiries.list',
    'shipment.acknowledge', 'shipment.confirm'
  ));

create or replace function public.sellerpilot_enqueue_channel_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang', 'smartstore', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now()) for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_attempt_id is not null and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.credential_id = p_credential_id
       and a.channel = p_channel and a.operation = p_operation and a.status = 'running'
  ) then raise exception 'running channel operation required'; end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment, request_payload, created_by
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment, p_request_payload, v_created_by
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_service_ingest_inquiries(
  p_credential_id uuid,
  p_channel text,
  p_inquiries jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_owner uuid;
  v_inquiry jsonb;
  v_count integer := 0;
  v_ledger_count integer := 0;
  v_external_id text;
  v_status text;
begin
  if jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select c.created_by into v_owner
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status in ('active', 'grace');
  if v_owner is null then raise exception 'active channel credential required'; end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    v_external_id := left(trim(coalesce(v_inquiry->>'externalTicketId', '')), 240);
    v_status := coalesce(v_inquiry->>'status', 'waiting');
    if v_external_id = '' or v_status not in ('waiting', 'resolved') then continue; end if;

    insert into sellerpilot_private.support_tickets (
      owner_id, external_ticket_id, channel_key, customer_name, subject, message,
      status, priority, received_at, resolved_at, demo, updated_at
    ) values (
      v_owner,
      v_external_id,
      p_channel,
      left(coalesce(nullif(trim(v_inquiry->>'customerName'), ''), '마켓 고객'), 240),
      left(coalesce(nullif(trim(v_inquiry->>'subject'), ''), '고객 문의'), 500),
      left(coalesce(nullif(trim(v_inquiry->>'message'), ''), '문의 내용 없음'), 20000),
      v_status,
      greatest(1, least(5, coalesce((v_inquiry->>'priority')::integer, 3))),
      coalesce((v_inquiry->>'receivedAt')::timestamptz, now()),
      case when v_status = 'resolved' then now() else null end,
      false,
      now()
    )
    on conflict (owner_id, channel_key, external_ticket_id) do update set
      customer_name = excluded.customer_name,
      subject = excluded.subject,
      message = excluded.message,
      status = excluded.status,
      priority = excluded.priority,
      received_at = excluded.received_at,
      resolved_at = case when excluded.status = 'resolved' then coalesce(sellerpilot_private.support_tickets.resolved_at, now()) else null end,
      demo = false,
      updated_at = now();
    v_count := v_count + 1;
  end loop;

  select count(*) into v_ledger_count
    from sellerpilot_private.support_tickets t
   where t.owner_id = v_owner
     and t.channel_key = p_channel
     and not t.demo;

  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status, imported_count,
    last_started_at, last_succeeded_at, last_error, updated_at
  ) values (
    v_owner, p_channel, 'inquiries', 'passed', v_ledger_count, now(), now(), null, now()
  )
  on conflict (owner_id, channel_key, data_type) do update set
    status = 'passed', imported_count = excluded.imported_count,
    last_succeeded_at = now(), last_error = null, updated_at = now();

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, safe_detail)
  values (v_owner, 'channel_inquiries_synced', 'channel', jsonb_build_object(
    'channel', p_channel,
    'response_count', v_count,
    'ledger_count', v_ledger_count
  ));
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb) to service_role;

commit;
