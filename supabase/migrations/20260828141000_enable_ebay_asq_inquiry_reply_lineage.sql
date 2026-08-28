-- Enable eBay Ask Seller a Question replies without weakening the existing
-- four-channel inquiry delivery fence. eBay reply routing is accepted only
-- from provider-certified account lineage and exact GetMemberMessages fields.

begin;

alter function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  rename to sellerpilot_28141000_ingest_inquiries_unsafe;

create function public.sellerpilot_service_ingest_inquiries(
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
  v_sanitized jsonb := '[]'::jsonb;
  v_external_id text;
  v_external_id_raw text;
  v_item_id text;
  v_item_id_raw text;
  v_parent_message_id text;
  v_parent_message_id_raw text;
  v_recipient_id text;
  v_recipient_id_raw text;
  v_reply_context jsonb;
  v_existing_reply_context jsonb;
  v_count integer;
begin
  if p_channel <> 'ebay' then
    return public.sellerpilot_28141000_ingest_inquiries_unsafe(
      p_credential_id,
      p_channel,
      p_inquiries
    );
  end if;

  if jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  -- Serialize the eBay context check with reply enqueue. A parent message can
  -- never be rebound to another listing or recipient between these steps.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select c.id, c.created_by, c.seller_account_key,
         c.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'ebay'
     and c.status in ('active', 'grace')
   for update;
  if not found then
    raise exception 'active channel credential required';
  end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> 'provider_certified_v1' then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) <> 'object' then
      v_sanitized := v_sanitized || jsonb_build_array(v_inquiry);
      continue;
    end if;

    v_external_id_raw := coalesce(v_inquiry->>'externalTicketId', '');
    v_external_id := left(trim(v_external_id_raw), 240);
    v_item_id_raw := coalesce(v_inquiry#>>'{replyContext,itemId}', '');
    v_item_id := trim(v_item_id_raw);
    v_parent_message_id_raw := coalesce(
      v_inquiry#>>'{replyContext,parentMessageId}',
      ''
    );
    v_parent_message_id := trim(v_parent_message_id_raw);
    v_recipient_id_raw := coalesce(
      v_inquiry#>>'{replyContext,recipientId}',
      ''
    );
    v_recipient_id := trim(v_recipient_id_raw);

    v_reply_context := case
      when jsonb_typeof(v_inquiry->'replyContext') = 'object'
        and v_external_id_raw = v_external_id
        and v_item_id_raw = v_item_id
        and v_parent_message_id_raw = v_parent_message_id
        and v_recipient_id_raw = v_recipient_id
        and v_item_id ~ '^[1-9][0-9]{0,18}$'
        and length(v_parent_message_id) between 1 and 230
        and v_parent_message_id ~ '^[^[:cntrl:]]+$'
        and length(v_recipient_id) between 1 and 240
        and v_recipient_id ~ '^[^[:cntrl:]]+$'
        and v_external_id = 'ebay:' || v_parent_message_id
      then jsonb_build_object(
        'itemId', v_item_id,
        'parentMessageId', v_parent_message_id,
        'recipientId', v_recipient_id
      )
      else '{}'::jsonb
    end;

    select t.reply_context
      into v_existing_reply_context
      from sellerpilot_private.support_tickets t
     where t.owner_id = v_credential.created_by
       and t.channel_key = 'ebay'
       and t.external_ticket_id = v_external_id
     for update;

    if found and v_existing_reply_context <> '{}'::jsonb then
      if v_reply_context = '{}'::jsonb then
        -- A partial or stale read must not erase an already-certified route.
        v_reply_context := v_existing_reply_context;
      elsif v_reply_context is distinct from v_existing_reply_context then
        raise exception 'INQUIRY_REPLY_CONTEXT_MISMATCH';
      end if;
    end if;

    v_sanitized := v_sanitized || jsonb_build_array(
      jsonb_set(v_inquiry, '{replyContext}', v_reply_context, true)
    );
  end loop;

  v_count := public.sellerpilot_28141000_ingest_inquiries_unsafe(
    p_credential_id,
    p_channel,
    v_sanitized
  );

  -- The pre-eBay implementation intentionally reduced every non-Coupang
  -- reply context to an empty object. Restore only the exact sanitized eBay
  -- route, in the same transaction and under the same advisory lock.
  for v_inquiry in select value from jsonb_array_elements(v_sanitized) loop
    if jsonb_typeof(v_inquiry) <> 'object' then continue; end if;
    v_external_id := left(trim(coalesce(v_inquiry->>'externalTicketId', '')), 240);
    v_reply_context := coalesce(v_inquiry->'replyContext', '{}'::jsonb);
    if jsonb_typeof(v_reply_context) = 'object'
       and v_reply_context <> '{}'::jsonb
       and coalesce(v_inquiry->>'status', 'waiting') in ('waiting', 'resolved') then
      update sellerpilot_private.support_tickets t
         set reply_context = v_reply_context,
             updated_at = now()
       where t.owner_id = v_credential.created_by
         and t.channel_key = 'ebay'
         and t.external_ticket_id = v_external_id
         and t.source_credential_id = p_credential_id
         and t.seller_account_key = v_credential.seller_account_key
         and not t.demo;
      if not found then
        raise exception 'INQUIRY_REPLY_CONTEXT_PERSIST_FAILED';
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

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
  v_source_credential record;
  v_credential_id uuid;
  v_environment text;
  v_created_by uuid;
  v_existing record;
  v_legacy record;
  v_id uuid := gen_random_uuid();
  v_reply text := nullif(trim(p_reply_text), '');
  v_payload_reply text;
  v_reply_fingerprint text;
  v_item_id text;
  v_parent_message_id text;
  v_recipient_id text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  -- The already-hardened implementation remains authoritative for Qoo10,
  -- Lazada, Coupang, and Smartstore.
  if p_channel <> 'ebay' then
    return public.sellerpilot_11820_enqueue_reply_unsafe(
      p_ticket_id,
      p_channel,
      p_reply_text,
      p_request_payload
    );
  end if;

  if v_reply is null
     or length(v_reply) > 2000
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  select t.* into v_ticket
    from sellerpilot_private.support_tickets t
   where t.id = p_ticket_id
     and not t.demo
   for update;
  if not found or v_ticket.channel_key <> 'ebay' then
    raise exception 'inquiry reply ticket not found';
  end if;
  if v_ticket.source_credential_id is null
     or v_ticket.seller_account_key is null then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  select c.id, c.channel, c.environment, c.created_by, c.seller_account_key,
         c.seller_account_key_source
    into v_source_credential
    from sellerpilot_private.channel_credentials c
   where c.id = v_ticket.source_credential_id;
  if not found
     or v_source_credential.channel <> 'ebay'
     or v_source_credential.created_by <> v_ticket.owner_id
     or v_source_credential.seller_account_key_source <> 'provider_certified_v1'
     or v_source_credential.seller_account_key is distinct from v_ticket.seller_account_key then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;
  if v_source_credential.environment <> 'sandbox' then
    raise exception 'EBAY_ASQ_RELEASE_VERIFICATION_REQUIRED';
  end if;

  v_payload_reply := nullif(trim(p_request_payload#>>'{arguments,reply}'), '');
  if v_payload_reply is distinct from v_reply then
    raise exception 'inquiry reply payload mismatch';
  end if;

  v_item_id := p_request_payload#>>'{arguments,itemId}';
  v_parent_message_id := p_request_payload#>>'{arguments,parentMessageId}';
  v_recipient_id := p_request_payload#>>'{arguments,recipientId}';

  if coalesce(v_item_id, '') !~ '^[1-9][0-9]{0,18}$'
     or length(coalesce(v_parent_message_id, '')) not between 1 and 230
     or coalesce(v_parent_message_id, '') !~ '^[^[:cntrl:]]+$'
     or length(coalesce(v_recipient_id, '')) not between 1 and 240
     or coalesce(v_recipient_id, '') !~ '^[^[:cntrl:]]+$'
     or v_ticket.external_ticket_id is distinct from 'ebay:' || v_parent_message_id
     or v_item_id is distinct from v_ticket.reply_context->>'itemId'
     or v_parent_message_id is distinct from v_ticket.reply_context->>'parentMessageId'
     or v_recipient_id is distinct from v_ticket.reply_context->>'recipientId' then
    raise exception 'inquiry reply eBay ASQ context mismatch';
  end if;

  select a.id, a.status, a.reply_fingerprint
    into v_legacy
    from sellerpilot_private.support_reply_attempts a
   where a.ticket_id = p_ticket_id
     and a.status in (
       'preparing', 'sending', 'succeeded', 'reconciliation_required'
     )
   order by case
       when a.status = 'reconciliation_required' then 0
       when a.status = 'sending' then 1
       when a.status = 'preparing' then 2
       else 3
     end,
     a.created_at desc
   limit 1;
  if found then
    if v_legacy.status in ('sending', 'reconciliation_required') then
      raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED';
    end if;
    if v_legacy.status = 'preparing' then
      raise exception 'INQUIRY_REPLY_LEGACY_IN_PROGRESS';
    end if;
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  v_reply_fingerprint := encode(
    extensions.digest(v_reply, 'sha256'),
    'hex'
  );

  select j.id, j.status,
         j.request_payload->>'sellerpilotReplyFingerprint' as reply_fingerprint
    into v_existing
    from sellerpilot_private.channel_gateway_jobs j
   where j.operation = 'inquiries.reply'
     and j.channel = 'ebay'
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
    update sellerpilot_private.support_tickets t
       set reply_gateway_job_id = v_existing.id,
           reply_delivery_status = case v_existing.status
             when 'queued' then 'preparing'
             when 'running' then 'sending'
             when 'reconciliation_required' then 'reconciliation_required'
             else 'succeeded'
           end,
           reply_delivery_error = case
             when v_existing.status = 'reconciliation_required'
               then '판매채널 답변 접수 여부를 수동 확인해야 합니다.'
             else null
           end,
           reply_operation_attempt_id = null,
           updated_at = now()
     where t.id = p_ticket_id;
    return v_existing.id;
  end if;

  if v_ticket.status = 'resolved' then
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  select c.id, c.environment, c.created_by
    into v_credential_id, v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.channel = 'ebay'
     and c.environment = 'sandbox'
     and c.environment = v_source_credential.environment
     and c.created_by = v_ticket.owner_id
     and c.seller_account_key = v_ticket.seller_account_key
     and c.seller_account_key_source = 'provider_certified_v1'
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   order by (c.id = v_ticket.source_credential_id) desc,
            c.version desc,
            c.created_at desc,
            c.id
   for update
   limit 1;
  if not found then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
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
    'ebay',
    'inquiries.reply',
    v_environment,
    p_request_payload || jsonb_build_object(
      'sellerpilotTicketId', p_ticket_id,
      'sellerpilotReplyFingerprint', v_reply_fingerprint
    ),
    v_created_by
  );

  update sellerpilot_private.support_tickets t
     set reply_delivery_status = 'preparing',
         reply_delivery_error = null,
         reply_operation_attempt_id = null,
         reply_gateway_job_id = v_id,
         updated_at = now()
   where t.id = p_ticket_id
     and t.seller_account_key = v_ticket.seller_account_key;
  if not found then
    raise exception 'inquiry reply ticket ledger mismatch';
  end if;

  return v_id;
end;
$$;

revoke all on function public.sellerpilot_28141000_ingest_inquiries_unsafe(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) to service_role;

revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

commit;
