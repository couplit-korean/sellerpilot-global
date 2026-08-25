-- Fence marketplace inquiry replies against duplicate delivery. A ticket row is
-- the serialization point, and the gateway completion atomically resolves the
-- internal ticket only after the provider result is durably recorded.

begin;

create or replace function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  p_ticket_id uuid,
  p_channel text,
  p_reply_text text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_credential_id uuid;
  v_environment text;
  v_created_by uuid;
  v_existing record;
  v_id uuid := gen_random_uuid();
  v_reply text := nullif(trim(p_reply_text), '');
  v_payload_reply text;
  v_reply_fingerprint text;
begin
  if p_channel not in ('qoo10', 'lazada', 'coupang', 'smartstore')
     or v_reply is null
     or length(v_reply) > 4000
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  v_payload_reply := nullif(trim(case
    when p_channel = 'qoo10' then p_request_payload#>>'{arguments,params,contents}'
    else p_request_payload#>>'{arguments,reply}'
  end), '');
  if v_payload_reply is distinct from v_reply then
    raise exception 'inquiry reply payload mismatch';
  end if;

  v_reply_fingerprint := encode(
    extensions.digest(v_reply, 'sha256'),
    'hex'
  );

  select t.* into v_ticket
    from sellerpilot_private.support_tickets t
   where t.id = p_ticket_id
     and not t.demo
   for update;
  if not found or v_ticket.channel_key <> p_channel then
    raise exception 'inquiry reply ticket not found';
  end if;

  -- The ticket lock makes identical concurrent HTTP requests converge on one
  -- gateway job. A different draft cannot overtake an in-flight, delivered, or
  -- ambiguous reply for the same customer inquiry.
  select j.id,
         j.request_payload->>'sellerpilotReplyFingerprint' as reply_fingerprint
    into v_existing
    from sellerpilot_private.channel_gateway_jobs j
   where j.operation = 'inquiries.reply'
     and j.channel = p_channel
     and j.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
     and (
       j.status in ('queued', 'running', 'reconciliation_required')
       or (j.status = 'succeeded' and j.response_payload @> '{"ok":true}'::jsonb)
     )
   order by case
       when j.status = 'reconciliation_required' then 0
       when j.status in ('queued', 'running') then 1
       else 2
     end,
     j.created_at desc,
     j.id desc
   limit 1;
  if found then
    if v_existing.reply_fingerprint is distinct from v_reply_fingerprint then
      raise exception 'INQUIRY_REPLY_CONFLICT';
    end if;
    return v_existing.id;
  end if;

  if v_ticket.status = 'resolved' then
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  select c.id, c.environment, c.created_by
    into v_credential_id, v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel
     and c.environment = 'production'
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   order by c.version desc, c.created_at desc, c.id
   for update
   limit 1;
  if not found then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id,
    credential_id,
    attempt_id,
    channel,
    operation,
    environment,
    request_payload,
    created_by
  ) values (
    v_id,
    v_credential_id,
    null,
    p_channel,
    'inquiries.reply',
    v_environment,
    p_request_payload || jsonb_build_object(
      'sellerpilotTicketId', p_ticket_id,
      'sellerpilotReplyFingerprint', v_reply_fingerprint
    ),
    v_created_by
  );

  return v_id;
end;
$$;

create or replace function sellerpilot_private.gateway_external_write_observed(
  p_operation text,
  p_response_payload jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_response_payload->>'ok')::boolean, false) = false
  and p_operation in (
    'listing.create', 'listing.update', 'listing.stop', 'price.update',
    'inventory.update', 'inquiries.reply', 'shipment.acknowledge', 'shipment.confirm'
  )
  and exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_response_payload->'steps') = 'array' then p_response_payload->'steps'
        else '[]'::jsonb
      end
    ) step
    where (
      coalesce((step->>'ok')::boolean, false) = true
      or (
        coalesce(step->>'status', '') ~ '^[0-9]{3}$'
        and (
          (step->>'status')::integer = 408
          or (step->>'status')::integer between 500 and 599
        )
      )
    )
    and case p_operation
      when 'listing.create' then
        lower(coalesce(step->>'name', '')) in (
          'product-create', 'product-create-accepted', 'product-create-reconcile',
          'global-item-create', 'global-item-readback', 'publish-task-create',
          'published-item-readback', 'listing.create', '/product/create',
          'listing.resume', 'product-reconcile', 'goods-v3-add',
          'goods-reconcile', 'setnewgoods', 'offer', 'offer-reconcile',
          'publish', 'listing-image-upload'
        )
        or lower(coalesce(step->>'name', '')) like 'published-item-readback-%'
      when 'listing.update' then
        lower(coalesce(step->>'name', '')) in (
          'updategoods', 'editgoodscontents', 'listing.update', '/product/update',
          'product-update', 'offer-update', 'listing-image-upload'
        )
      when 'listing.stop' then
        lower(coalesce(step->>'name', '')) in (
          'stop-display', 'editgoodsstatus', 'listing.stop', '/product/deactivate',
          'sales-stop', 'status-stop', 'goods-off-shelf', 'offer-withdraw'
        )
      when 'price.update' then
        lower(coalesce(step->>'name', '')) in (
          'setgoodspriceqty', 'price.update', '/product/price_quantity/update',
          'price', 'bulk-price', 'offer-price'
        )
      when 'inventory.update' then
        lower(coalesce(step->>'name', '')) in (
          'setgoodspriceqty', 'inventory.update', '/product/price_quantity/update',
          'quantity', 'origin-product-stock', 'option-stock', 'goods-stock',
          'bulk-inventory'
        )
      when 'inquiries.reply' then
        lower(coalesce(step->>'name', '')) in (
          'inquiry-reply', 'setinquirymessage', 'cscenter.setinquirymessage'
        )
      when 'shipment.acknowledge' then
        lower(coalesce(step->>'name', '')) in (
          'seller-check', 'pack', 'acknowledgement', 'confirm'
        )
      when 'shipment.confirm' then
        lower(coalesce(step->>'name', '')) in (
          'setsendinginfo', 'shipment.confirm', 'pack', 'ready-to-ship',
          'invoice', 'dispatch', 'shipment-confirm', 'shipping-fulfillment'
        )
      else false
    end
  );
$$;

create or replace function sellerpilot_private.guard_and_finalize_inquiry_reply_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
  v_reply text;
  v_expected_fingerprint text;
  v_actual_fingerprint text;
  v_updated integer;
  v_owner_id uuid;
begin
  if old.operation = 'inquiries.reply'
     and old.status = 'running'
     and (old.lease_expires_at is null or old.lease_expires_at <= now())
     and new.status in ('queued', 'failed') then
    new.status := 'reconciliation_required';
    new.error_message := 'Inquiry reply worker lease expired; provider outcome requires reconciliation.';
    new.completed_at := now();
  end if;

  if old.operation = 'inquiries.reply'
     and old.status = 'running'
     and new.status = 'succeeded'
     and new.response_payload @> '{"ok":true}'::jsonb then
    begin
      v_ticket_id := nullif(new.request_payload->>'sellerpilotTicketId', '')::uuid;
    exception when others then
      v_ticket_id := null;
    end;
    v_reply := nullif(trim(case
      when new.channel = 'qoo10' then new.request_payload#>>'{arguments,params,contents}'
      else new.request_payload#>>'{arguments,reply}'
    end), '');
    v_expected_fingerprint := nullif(new.request_payload->>'sellerpilotReplyFingerprint', '');
    if v_reply is not null then
      v_actual_fingerprint := encode(
        extensions.digest(v_reply, 'sha256'),
        'hex'
      );
    end if;

    if v_ticket_id is null
       or v_reply is null
       or v_expected_fingerprint is null
       or v_actual_fingerprint is distinct from v_expected_fingerprint then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was accepted remotely but its ticket ledger metadata failed integrity validation.';
      new.completed_at := now();
      return new;
    end if;

    update sellerpilot_private.support_tickets t
       set status = 'resolved',
           reply_draft = left(v_reply, 8000),
           resolved_at = coalesce(t.resolved_at, now()),
           updated_at = now()
     where t.id = v_ticket_id
       and t.channel_key = new.channel
       and not t.demo
    returning t.owner_id into v_owner_id;
    get diagnostics v_updated = row_count;

    if v_updated <> 1 then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was accepted remotely but its ticket ledger could not be resolved.';
      new.completed_at := now();
      return new;
    end if;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner_id,
      'ticket_reply_delivered',
      'support_ticket',
      v_ticket_id::text,
      jsonb_build_object('channel', new.channel, 'gateway_job_id', new.id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists guard_and_finalize_inquiry_reply_job
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_and_finalize_inquiry_reply_job
before update of status on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.guard_and_finalize_inquiry_reply_job();

revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid, text, text, jsonb)
  to service_role;

revoke all on function sellerpilot_private.gateway_external_write_observed(text, jsonb)
  from public, anon, authenticated;
revoke all on function sellerpilot_private.guard_and_finalize_inquiry_reply_job()
  from public, anon, authenticated;

commit;
