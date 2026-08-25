-- A provider read model can lag immediately after a successful inquiry reply.
-- Preserve the exact local delivery proof so a stale `waiting` readback cannot
-- reopen a ticket that the gateway already resolved atomically.

begin;

create or replace function public.sellerpilot_service_ingest_inquiries(
  p_credential_id uuid,
  p_channel text,
  p_inquiries jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_inquiry jsonb;
  v_count integer := 0;
  v_ledger_count integer := 0;
  v_external_id text;
  v_status text;
  v_existing_key text;
  v_existing_resolved_at timestamptz;
  v_preserve_resolution boolean;
  v_reply_context jsonb;
begin
  if jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select c.id, c.channel, c.environment, c.created_by, c.status,
         c.seller_account_key, c.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status in ('active', 'grace')
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source not in ('provider_certified_v1', 'credential_incarnation_v1')
     or (
       p_channel = 'lazada'
       and v_credential.seller_account_key_source <> 'provider_certified_v1'
     ) then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    v_external_id := left(trim(coalesce(v_inquiry->>'externalTicketId', '')), 240);
    v_status := coalesce(v_inquiry->>'status', 'waiting');
    if v_external_id = '' or v_status not in ('waiting', 'resolved') then continue; end if;

    v_reply_context := case
      when p_channel = 'coupang'
        and jsonb_typeof(v_inquiry->'replyContext') = 'object'
        and coalesce(v_inquiry#>>'{replyContext,parentAnswerId}', '') ~ '^[1-9][0-9]*$'
      then jsonb_build_object(
        'parentAnswerId',
        v_inquiry#>>'{replyContext,parentAnswerId}'
      )
      else '{}'::jsonb
    end;

    select t.seller_account_key,
           t.resolved_at,
           (
             t.reply_delivery_status = 'succeeded'
             or exists (
               select 1
                 from sellerpilot_private.channel_gateway_jobs gateway
                where gateway.id = t.reply_gateway_job_id
                  and gateway.operation = 'inquiries.reply'
                  and gateway.channel = t.channel_key
                  and gateway.status = 'succeeded'
                  and gateway.response_payload @> '{"ok":true}'::jsonb
                  and gateway.request_payload->>'sellerpilotTicketId' = t.id::text
                  and gateway.seller_account_key = t.seller_account_key
             )
           )
      into v_existing_key, v_existing_resolved_at, v_preserve_resolution
      from sellerpilot_private.support_tickets t
     where t.owner_id = v_credential.created_by
       and t.channel_key = p_channel
       and t.external_ticket_id = v_external_id
     for update;
    if found
       and v_existing_key is not null
       and v_existing_key is distinct from v_credential.seller_account_key then
      raise exception 'INQUIRY_SELLER_LINEAGE_MISMATCH';
    end if;

    -- Provider `resolved` remains authoritative. A stale provider `waiting`
    -- state is overridden only by an already durable local delivery proof.
    if v_status = 'waiting' and coalesce(v_preserve_resolution, false) then
      v_status := 'resolved';
    end if;

    insert into sellerpilot_private.support_tickets (
      owner_id, external_ticket_id, channel_key, customer_name, subject, message,
      status, priority, received_at, resolved_at, demo, updated_at,
      source_credential_id, seller_account_key, reply_context
    ) values (
      v_credential.created_by,
      v_external_id,
      p_channel,
      left(coalesce(nullif(trim(v_inquiry->>'customerName'), ''), '마켓 고객'), 240),
      left(coalesce(nullif(trim(v_inquiry->>'subject'), ''), '고객 문의'), 500),
      left(coalesce(nullif(trim(v_inquiry->>'message'), ''), '문의 내용 없음'), 20000),
      v_status,
      greatest(1, least(5, coalesce((v_inquiry->>'priority')::integer, 3))),
      coalesce((v_inquiry->>'receivedAt')::timestamptz, now()),
      case
        when v_status = 'resolved' then coalesce(v_existing_resolved_at, now())
        else null
      end,
      false,
      now(),
      p_credential_id,
      v_credential.seller_account_key,
      v_reply_context
    )
    on conflict (owner_id, channel_key, external_ticket_id) do update set
      customer_name = excluded.customer_name,
      subject = excluded.subject,
      message = excluded.message,
      status = excluded.status,
      priority = excluded.priority,
      received_at = excluded.received_at,
      resolved_at = case
        when excluded.status = 'resolved'
          then coalesce(sellerpilot_private.support_tickets.resolved_at, excluded.resolved_at, now())
        else null
      end,
      demo = false,
      source_credential_id = excluded.source_credential_id,
      seller_account_key = coalesce(
        sellerpilot_private.support_tickets.seller_account_key,
        excluded.seller_account_key
      ),
      reply_context = excluded.reply_context,
      updated_at = now();
    v_count := v_count + 1;
  end loop;

  select count(*) into v_ledger_count
    from sellerpilot_private.support_tickets t
   where t.owner_id = v_credential.created_by
     and t.channel_key = p_channel
     and not t.demo;

  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status, imported_count,
    last_started_at, last_succeeded_at, last_error, updated_at
  ) values (
    v_credential.created_by, p_channel, 'inquiries', 'passed',
    v_ledger_count, now(), now(), null, now()
  )
  on conflict (owner_id, channel_key, data_type) do update set
    status = 'passed',
    imported_count = excluded.imported_count,
    last_succeeded_at = now(),
    last_error = null,
    updated_at = now();

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, safe_detail
  ) values (
    v_credential.created_by,
    'channel_inquiries_synced',
    'channel',
    jsonb_build_object(
      'channel', p_channel,
      'response_count', v_count,
      'ledger_count', v_ledger_count
    )
  );
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  to service_role;

commit;
