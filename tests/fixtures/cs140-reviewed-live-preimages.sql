-- Exact function definitions from parent readback 2026-09-06T00:23:42.604674Z.
-- Function code only: no credentials, customer rows or provider payloads.

CREATE OR REPLACE FUNCTION public.sellerpilot_prune_personal_data(p_completed_before timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_orders integer := 0;
  v_tickets integer := 0;
  v_inbound_messages integer := 0;
  v_pending_seller_messages integer := 0;
  v_deliveries_redacted integer := 0;
  v_gateway_jobs integer := 0;
begin
  if p_completed_before > now() - interval '7 days' then
    raise exception 'retention window must be at least seven days';
  end if;

  update sellerpilot_private.commerce_orders orders
     set customer_name = '[개인정보 삭제됨]', updated_at = now()
   where not orders.demo
     and orders.status in ('delivered', 'cancelled', 'refunded')
     and orders.updated_at < p_completed_before
     and orders.customer_name <> '[개인정보 삭제됨]';
  get diagnostics v_orders = row_count;

  delete from sellerpilot_private.support_inbound_messages inbound
   using sellerpilot_private.support_tickets ticket
   where inbound.ticket_id = ticket.id
     and not ticket.demo
     and ticket.status = 'resolved'
     and coalesce(ticket.resolved_at, ticket.updated_at) < p_completed_before;
  get diagnostics v_inbound_messages = row_count;

  delete from sellerpilot_private.support_pending_seller_messages pending
   where pending.received_at < p_completed_before;
  get diagnostics v_pending_seller_messages = row_count;

  update sellerpilot_private.support_reply_deliveries delivery
     set provider_request_id = null,
         provider_message_id = null,
         safe_message = null,
         reconciliation_reason = case
           when delivery.status = 'reconciliation_required' then 'Historical provider outcome required reconciliation.'
           else null
         end,
         acknowledgement_reason = case
           when delivery.acknowledged_at is not null then 'historical provider confirmation'
           else null
         end,
         updated_at = now()
    from sellerpilot_private.support_tickets ticket
   where delivery.ticket_id = ticket.id
     and not ticket.demo
     and ticket.status = 'resolved'
     and coalesce(ticket.resolved_at, ticket.updated_at) < p_completed_before
     and (
       delivery.provider_request_id is not null
       or delivery.provider_message_id is not null
       or delivery.safe_message is not null
       or delivery.reconciliation_reason is not null
       or delivery.acknowledgement_reason is not null
     );
  get diagnostics v_deliveries_redacted = row_count;

  update sellerpilot_private.support_tickets ticket
     set customer_name = '[개인정보 삭제됨]',
         subject = '[개인정보 삭제됨]',
         message = '[개인정보 삭제됨]',
         translated_message = null,
         reply_draft = null,
         reply_context = '{}'::jsonb,
         provider_context = '{}'::jsonb,
         external_order_reference = null,
         latest_inbound_key = null,
         updated_at = now()
   where not ticket.demo
     and ticket.status = 'resolved'
     and coalesce(ticket.resolved_at, ticket.updated_at) < p_completed_before
     and (
       ticket.customer_name <> '[개인정보 삭제됨]'
       or ticket.subject <> '[개인정보 삭제됨]'
       or ticket.message <> '[개인정보 삭제됨]'
       or ticket.translated_message is not null
       or ticket.reply_draft is not null
       or ticket.reply_context <> '{}'::jsonb
       or ticket.provider_context <> '{}'::jsonb
       or ticket.external_order_reference is not null
       or ticket.latest_inbound_key is not null
     );
  get diagnostics v_tickets = row_count;

  delete from sellerpilot_private.channel_gateway_jobs job
   where job.status in ('succeeded', 'failed', 'cancelled')
     and coalesce(job.completed_at, job.updated_at) < p_completed_before;
  get diagnostics v_gateway_jobs = row_count;

  insert into sellerpilot_private.operation_audit(action, entity_type, safe_detail)
  values ('personal_data_pruned', 'retention', jsonb_build_object(
    'orders_anonymized', v_orders,
    'tickets_anonymized', v_tickets,
    'inbound_messages_deleted', v_inbound_messages,
    'pending_seller_messages_deleted', v_pending_seller_messages,
    'deliveries_redacted', v_deliveries_redacted,
    'gateway_jobs_deleted', v_gateway_jobs,
    'cutoff', p_completed_before
  ));

  return jsonb_build_object(
    'ordersAnonymized', v_orders,
    'ticketsAnonymized', v_tickets,
    'inboundMessagesDeleted', v_inbound_messages,
    'pendingSellerMessagesDeleted', v_pending_seller_messages,
    'deliveriesRedacted', v_deliveries_redacted,
    'gatewayJobsDeleted', v_gateway_jobs
  );
end;
$function$
;
REVOKE ALL ON FUNCTION public.sellerpilot_prune_personal_data(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sellerpilot_prune_personal_data(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_ingest_inquiries(p_credential_id uuid, p_channel text, p_inquiries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_credential record;
  v_inquiry jsonb;
  v_filtered jsonb := '[]'::jsonb;
  v_non_lazada_seller_events jsonb := '[]'::jsonb;
  v_external_ticket_id text;
  v_parent_message_id text;
  v_question_id text;
  v_inbound_key text;
  v_remote_message_id text;
  v_received_at timestamptz;
  v_ticket_id uuid;
  v_provider_context jsonb;
  v_sender_role text;
  v_count integer;
  v_matching_deletion_id uuid;
  v_matching_deleted_through_at timestamptz;
begin
  if jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = p_channel
     and credential.status in ('active', 'grace');
  if not found then
    raise exception 'active channel credential required';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) <> 'object' then
      v_filtered := v_filtered || jsonb_build_array(v_inquiry);
      continue;
    end if;

    v_external_ticket_id := left(
      trim(coalesce(v_inquiry->>'externalTicketId', '')),
      240
    );

    if p_channel = 'ebay'
       and v_credential.seller_account_key_source = 'provider_certified_v1' then
      v_parent_message_id := trim(coalesce(
        v_inquiry#>>'{replyContext,parentMessageId}',
        v_inquiry#>>'{providerContext,parentMessageId}',
        ''
      ));
      if v_parent_message_id <> '' then
        v_external_ticket_id := sellerpilot_private.ebay_asq_ticket_external_id(
          v_credential.seller_account_key,
          v_parent_message_id
        );
      end if;
    elsif p_channel = 'smartstore'
          and coalesce(
            v_inquiry#>>'{providerContext,kind}',
            v_inquiry#>>'{replyContext,kind}',
            ''
          ) = 'product' then
      v_question_id := coalesce(
        nullif(v_inquiry#>>'{providerContext,questionId}', ''),
        nullif(v_inquiry#>>'{replyContext,questionId}', ''),
        nullif(regexp_replace(v_external_ticket_id, '^smartstore:product-qna:', ''), '')
      );
      if coalesce(v_question_id, '') ~ '^[1-9][0-9]{0,18}$' then
        v_external_ticket_id := 'smartstore:product-qna:' || v_question_id;
      end if;
    end if;

    v_matching_deletion_id := null;
    v_matching_deleted_through_at := null;
    if v_external_ticket_id <> '' then
      select deletion.id, deletion.deleted_through_at
        into v_matching_deletion_id, v_matching_deleted_through_at
        from sellerpilot_private.support_ticket_deletions deletion
       where deletion.owner_id = v_credential.created_by
         and deletion.channel_key = p_channel
         and deletion.external_ticket_fingerprint =
           sellerpilot_private.support_deletion_fingerprint(
             v_credential.created_by,
             p_channel,
             v_external_ticket_id
           );
    end if;

    if v_matching_deletion_id is not null then
      v_inbound_key := left(nullif(trim(v_inquiry->>'inboundKey'), ''), 500);
      v_remote_message_id := left(nullif(trim(v_inquiry->>'remoteMessageId'), ''), 240);
      begin
        v_received_at := nullif(v_inquiry->>'receivedAt', '')::timestamptz;
      exception when others then
        v_received_at := null;
      end;

      if v_received_at is null
         or v_received_at <= v_matching_deleted_through_at
         or (
           v_inbound_key is not null
           and exists (
             select 1
               from sellerpilot_private.support_message_deletions message_deletion
              where message_deletion.deletion_id = v_matching_deletion_id
                and message_deletion.inbound_key_fingerprint =
                  sellerpilot_private.support_deletion_fingerprint(
                    v_credential.created_by,
                    p_channel,
                    v_inbound_key
                  )
           )
         )
         or (
           v_remote_message_id is not null
           and exists (
             select 1
               from sellerpilot_private.support_message_deletions message_deletion
              where message_deletion.deletion_id = v_matching_deletion_id
                and message_deletion.remote_message_fingerprint =
                  sellerpilot_private.support_deletion_fingerprint(
                    v_credential.created_by,
                    p_channel,
                    v_remote_message_id
                  )
           )
         ) then
        continue;
      end if;
    end if;

    if p_channel <> 'lazada'
       and v_inquiry->>'senderRole' in ('seller', 'system') then
      v_non_lazada_seller_events :=
        v_non_lazada_seller_events || jsonb_build_array(v_inquiry);
    else
      v_filtered := v_filtered || jsonb_build_array(v_inquiry);
    end if;
  end loop;

  v_count := public.sellerpilot_0902_ingest_inquiries_unsafe(
    p_credential_id,
    p_channel,
    v_filtered
  );

  -- Public inquiry responses returned by Coupang, Qoo10, and Smartstore are
  -- history, not new customer turns. Persist them after the customer ticket is
  -- present so they cannot replace the actionable latest inbound message.
  for v_inquiry in
    select value from jsonb_array_elements(v_non_lazada_seller_events)
  loop
    v_external_ticket_id := left(
      trim(coalesce(v_inquiry->>'externalTicketId', '')),
      240
    );
    v_inbound_key := left(nullif(trim(v_inquiry->>'inboundKey'), ''), 500);
    v_remote_message_id := left(nullif(trim(v_inquiry->>'remoteMessageId'), ''), 240);
    v_sender_role := v_inquiry->>'senderRole';
    v_provider_context := case
      when jsonb_typeof(v_inquiry->'providerContext') = 'object'
        then v_inquiry->'providerContext'
      else '{}'::jsonb
    end;
    begin
      v_received_at := nullif(v_inquiry->>'receivedAt', '')::timestamptz;
    exception when others then
      v_received_at := null;
    end;

    if p_channel = 'smartstore'
       and coalesce(
         v_inquiry#>>'{providerContext,kind}',
         v_inquiry#>>'{replyContext,kind}',
         ''
       ) = 'product' then
      v_question_id := coalesce(
        nullif(v_inquiry#>>'{providerContext,questionId}', ''),
        nullif(v_inquiry#>>'{replyContext,questionId}', ''),
        nullif(regexp_replace(v_external_ticket_id, '^smartstore:product-qna:', ''), '')
      );
      if coalesce(v_question_id, '') ~ '^[1-9][0-9]{0,18}$' then
        v_external_ticket_id := 'smartstore:product-qna:' || v_question_id;
      end if;
    end if;

    if v_external_ticket_id = ''
       or v_inbound_key is null
       or v_received_at is null
       or v_sender_role not in ('seller', 'system')
       or length(coalesce(v_inquiry->>'message', '')) not between 1 and 20000
       or octet_length(v_provider_context::text) > 64000 then
      continue;
    end if;

    select ticket.id
      into v_ticket_id
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id = v_credential.created_by
       and ticket.channel_key = p_channel
       and ticket.external_ticket_id = v_external_ticket_id
       and ticket.source_credential_id = p_credential_id
       and not ticket.demo
     for update;
    if v_ticket_id is null then
      continue;
    end if;

    insert into sellerpilot_private.support_inbound_messages (
      ticket_id, owner_id, channel_key, inbound_key, remote_message_id,
      sender_role, body, provider_context, received_at, updated_at
    ) values (
      v_ticket_id, v_credential.created_by, p_channel, v_inbound_key,
      v_remote_message_id, v_sender_role, v_inquiry->>'message',
      v_provider_context, v_received_at, clock_timestamp()
    )
    on conflict (owner_id, channel_key, inbound_key) do update set
      body = excluded.body,
      provider_context =
        sellerpilot_private.support_inbound_messages.provider_context
        || excluded.provider_context,
      received_at = sellerpilot_private.support_inbound_messages.received_at,
      updated_at = clock_timestamp();

    if v_sender_role = 'seller' then
      update sellerpilot_private.support_tickets ticket
         set provider_status = 'answered',
             provider_status_updated_at = greatest(
               coalesce(ticket.provider_status_updated_at, '-infinity'::timestamptz),
               v_received_at
             ),
             updated_at = clock_timestamp()
       where ticket.id = v_ticket_id
         and exists (
           select 1
             from sellerpilot_private.support_inbound_messages customer_message
            where customer_message.ticket_id = ticket.id
              and customer_message.inbound_key = ticket.latest_inbound_key
              and customer_message.sender_role = 'customer'
              and v_received_at >= customer_message.received_at
         );
    end if;
  end loop;

  return v_count;
end;
$function$
;
REVOKE ALL ON FUNCTION public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) TO service_role;
