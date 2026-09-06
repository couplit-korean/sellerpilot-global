-- Exact parent-captured CS dependencies. Function code/catalog only, no live rows.
-- This overlays the bounded historical CS fixture; it does not replay production history.
create table sellerpilot_private.support_ticket_deletions(
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  channel_key text not null,
  external_ticket_fingerprint text not null,
  deleted_through_at timestamp with time zone not null,
  deleted_at timestamp with time zone default clock_timestamp() not null,
  deleted_by uuid,
  delete_count integer default 1 not null
);
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_channel_key_fkey FOREIGN KEY (channel_key) REFERENCES sellerpilot_private.channels(key);
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_delete_count_check CHECK ((delete_count > 0));
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_external_ticket_fingerprint_check CHECK ((external_ticket_fingerprint ~ '^[a-f0-9]{64}$'::text));
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_owner_id_channel_key_external_tick_key UNIQUE (owner_id, channel_key, external_ticket_fingerprint);
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table sellerpilot_private.support_ticket_deletions add constraint support_ticket_deletions_pkey PRIMARY KEY (id);
create table sellerpilot_private.support_message_deletions(
  deletion_id uuid not null,
  inbound_key_fingerprint text not null,
  remote_message_fingerprint text,
  deleted_at timestamp with time zone default clock_timestamp() not null
);
alter table sellerpilot_private.support_message_deletions add constraint support_message_deletions_deletion_id_fkey FOREIGN KEY (deletion_id) REFERENCES sellerpilot_private.support_ticket_deletions(id) ON DELETE CASCADE;
alter table sellerpilot_private.support_message_deletions add constraint support_message_deletions_inbound_key_fingerprint_check CHECK ((inbound_key_fingerprint ~ '^[a-f0-9]{64}$'::text));
alter table sellerpilot_private.support_message_deletions add constraint support_message_deletions_pkey PRIMARY KEY (deletion_id, inbound_key_fingerprint);
alter table sellerpilot_private.support_message_deletions add constraint support_message_deletions_remote_message_fingerprint_check CHECK (((remote_message_fingerprint IS NULL) OR (remote_message_fingerprint ~ '^[a-f0-9]{64}$'::text)));

-- Parent prosrc MD5 d3329d1c2c396ff786c4029d706a77cc
CREATE OR REPLACE FUNCTION public.sellerpilot_0902_ingest_inquiries_unsafe(p_credential_id uuid, p_channel text, p_inquiries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_credential record;
  v_owner uuid;
  v_seller_account_key text;
  v_seller_account_key_source text;
  v_inquiry jsonb;
  v_sanitized jsonb := '[]'::jsonb;
  v_seller_events jsonb := '[]'::jsonb;
  v_ledger_inquiries jsonb := '[]'::jsonb;
  v_external_id text;
  v_external_id_raw text;
  v_storage_external_id text;
  v_item_id text;
  v_item_id_raw text;
  v_parent_message_id text;
  v_parent_message_id_raw text;
  v_recipient_id text;
  v_recipient_id_raw text;
  v_marketplace_id text;
  v_marketplace_id_raw text;
  v_reply_context jsonb;
  v_existing_reply_context jsonb;
  v_provider_context jsonb;
  v_provider_status text;
  v_ticket_kind text;
  v_inbound_key text;
  v_remote_message_id text;
  v_external_order_reference text;
  v_received_at timestamptz;
  v_ticket_id uuid;
  v_question_id text;
  v_count integer;
  v_state_inquiry jsonb;
  v_state_external_id text;
  v_operator_states jsonb := '{}'::jsonb;
  v_existing_operator_state jsonb;
  v_existing_operator_status text;
  v_existing_operator_priority integer;
  v_existing_operator_resolved_at timestamptz;
  v_is_new_inbound boolean;
  v_existing_inbound_received_at timestamptz;
  v_has_current_delivery_success boolean;
  v_current_received_at timestamptz;
  v_should_advance boolean;
  v_pending record;
begin
  if jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  if p_channel = 'ebay' then
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
    v_owner := v_credential.created_by;

    for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
      if jsonb_typeof(v_inquiry) <> 'object' then
        v_sanitized := v_sanitized || jsonb_build_array(v_inquiry);
        continue;
      end if;
      if nullif(trim(coalesce(v_inquiry->>'inboundKey', '')), '') is null
         and nullif(trim(coalesce(v_inquiry->>'remoteMessageId', '')), '') is null then
        continue;
      end if;

      v_external_id_raw := coalesce(v_inquiry->>'externalTicketId', '');
      v_external_id := left(trim(v_external_id_raw), 240);
      v_item_id_raw := coalesce(v_inquiry#>>'{replyContext,itemId}', '');
      v_item_id := trim(v_item_id_raw);
      v_parent_message_id_raw := coalesce(v_inquiry#>>'{replyContext,parentMessageId}', '');
      v_parent_message_id := trim(v_parent_message_id_raw);
      v_recipient_id_raw := coalesce(v_inquiry#>>'{replyContext,recipientId}', '');
      v_recipient_id := trim(v_recipient_id_raw);
      v_marketplace_id_raw := coalesce(v_inquiry#>>'{replyContext,marketplaceId}', '');
      v_marketplace_id := upper(trim(v_marketplace_id_raw));

      v_reply_context := case
        when jsonb_typeof(v_inquiry->'replyContext') = 'object'
          and v_external_id_raw = v_external_id
          and v_item_id_raw = v_item_id
          and v_parent_message_id_raw = v_parent_message_id
          and v_recipient_id_raw = v_recipient_id
          and v_marketplace_id_raw = v_marketplace_id
          and v_item_id ~ '^[1-9][0-9]{0,18}$'
          and length(v_parent_message_id) between 1 and 230
          and v_parent_message_id ~ '^[^[:cntrl:]]+$'
          and length(v_recipient_id) between 1 and 240
          and v_recipient_id ~ '^[^[:cntrl:]]+$'
          and v_marketplace_id in (
            'EBAY_US', 'EBAY_CA', 'EBAY_CA_FR', 'EBAY_GB', 'EBAY_AU', 'EBAY_AT',
            'EBAY_BE_FR', 'EBAY_BE_NL', 'EBAY_FR', 'EBAY_DE', 'EBAY_IT', 'EBAY_NL',
            'EBAY_ES', 'EBAY_CH', 'EBAY_HK', 'EBAY_IE', 'EBAY_IN', 'EBAY_MY',
            'EBAY_PH', 'EBAY_PL', 'EBAY_SG'
          )
          and v_external_id = 'ebay:' || v_parent_message_id
        then jsonb_build_object(
          'itemId', v_item_id,
          'parentMessageId', v_parent_message_id,
          'recipientId', v_recipient_id,
          'marketplaceId', v_marketplace_id
        )
        else '{}'::jsonb
      end;

      if v_reply_context = '{}'::jsonb then continue; end if;
      v_storage_external_id := sellerpilot_private.ebay_asq_ticket_external_id(
        v_credential.seller_account_key,
        v_parent_message_id
      );

      select t.reply_context
        into v_existing_reply_context
        from sellerpilot_private.support_tickets t
       where t.owner_id = v_credential.created_by
         and t.channel_key = 'ebay'
         and t.external_ticket_id = v_storage_external_id
       for update;

      if found and v_existing_reply_context <> '{}'::jsonb then
        if v_existing_reply_context ? 'marketplaceId' then
          if v_reply_context is distinct from v_existing_reply_context then
            raise exception 'INQUIRY_REPLY_CONTEXT_MISMATCH';
          end if;
        elsif (v_reply_context - 'marketplaceId') is distinct from v_existing_reply_context then
          raise exception 'INQUIRY_REPLY_CONTEXT_MISMATCH';
        end if;
      end if;

      v_sanitized := v_sanitized || jsonb_build_array(
        jsonb_set(
          jsonb_set(v_inquiry, '{replyContext}', v_reply_context, true),
          '{externalTicketId}',
          to_jsonb(v_storage_external_id),
          true
        )
      );
    end loop;

    -- The legacy ingester refreshes provider fields but also overwrites the
    -- operator's workflow status and priority. Capture those local fields
    -- before invoking it so message ingestion cannot silently reset work.
    for v_state_inquiry in select value from jsonb_array_elements(v_sanitized) loop
      if jsonb_typeof(v_state_inquiry) <> 'object' then continue; end if;
      v_state_external_id := left(trim(coalesce(v_state_inquiry->>'externalTicketId', '')), 240);
      if v_state_external_id = '' then continue; end if;
      select jsonb_build_object(
        'status', t.status,
        'priority', t.priority,
        'resolvedAt', t.resolved_at,
        'latestInboundKey', t.latest_inbound_key,
        'customerName', t.customer_name,
        'subject', t.subject,
        'message', t.message,
        'receivedAt', t.received_at,
        'replyContext', t.reply_context,
        'providerContext', t.provider_context,
        'providerStatus', t.provider_status,
        'providerStatusUpdatedAt', t.provider_status_updated_at,
        'externalOrderReference', t.external_order_reference,
        'ticketKind', t.ticket_kind
      )
        into v_existing_operator_state
        from sellerpilot_private.support_tickets t
       where t.owner_id = v_credential.created_by
         and t.channel_key = 'ebay'
         and t.external_ticket_id = v_state_external_id
         and not t.demo
       for update;
      if found then
        v_operator_states := v_operator_states || jsonb_build_object(
          v_state_external_id,
          v_existing_operator_state
        );
      end if;
    end loop;

    v_count := public.sellerpilot_28141000_ingest_inquiries_unsafe(
      p_credential_id,
      p_channel,
      v_sanitized
    );

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
    v_ledger_inquiries := v_sanitized;
  else
    select c.created_by, c.seller_account_key, c.seller_account_key_source
      into v_owner, v_seller_account_key, v_seller_account_key_source
      from sellerpilot_private.channel_credentials c
     where c.id = p_credential_id
       and c.channel = p_channel
       and c.status in ('active', 'grace');
    if v_owner is null then raise exception 'active channel credential required'; end if;

    v_sanitized := '[]'::jsonb;
    for v_state_inquiry in select value from jsonb_array_elements(p_inquiries) loop
      if jsonb_typeof(v_state_inquiry) <> 'object'
         or (
           nullif(trim(coalesce(v_state_inquiry->>'inboundKey', '')), '') is null
           and nullif(trim(coalesce(v_state_inquiry->>'remoteMessageId', '')), '') is null
         ) then continue; end if;
      if p_channel = 'lazada' and v_state_inquiry->>'senderRole' = 'seller' then
        v_seller_events := v_seller_events || jsonb_build_array(v_state_inquiry);
        continue;
      end if;
      if p_channel = 'smartstore'
         and jsonb_typeof(v_state_inquiry) = 'object'
         and coalesce(
           v_state_inquiry#>>'{providerContext,kind}',
           v_state_inquiry#>>'{replyContext,kind}',
           ''
         ) = 'product' then
        v_question_id := coalesce(
          nullif(v_state_inquiry#>>'{providerContext,questionId}', ''),
          nullif(v_state_inquiry#>>'{replyContext,questionId}', ''),
          nullif(regexp_replace(coalesce(v_state_inquiry->>'externalTicketId', ''), '^smartstore:product-qna:', ''), '')
        );
        if coalesce(v_question_id, '') !~ '^[1-9][0-9]{0,18}$' then continue; end if;
        v_state_inquiry := jsonb_set(
          v_state_inquiry,
          '{externalTicketId}',
          to_jsonb('smartstore:product-qna:' || v_question_id),
          true
        );
      end if;
      v_sanitized := v_sanitized || jsonb_build_array(v_state_inquiry);
    end loop;

    for v_state_inquiry in select value from jsonb_array_elements(v_sanitized) loop
      if jsonb_typeof(v_state_inquiry) <> 'object' then continue; end if;
      v_state_external_id := left(trim(coalesce(v_state_inquiry->>'externalTicketId', '')), 240);
      if v_state_external_id = '' then continue; end if;
      select jsonb_build_object(
        'status', t.status,
        'priority', t.priority,
        'resolvedAt', t.resolved_at,
        'latestInboundKey', t.latest_inbound_key,
        'customerName', t.customer_name,
        'subject', t.subject,
        'message', t.message,
        'receivedAt', t.received_at,
        'replyContext', t.reply_context,
        'providerContext', t.provider_context,
        'providerStatus', t.provider_status,
        'providerStatusUpdatedAt', t.provider_status_updated_at,
        'externalOrderReference', t.external_order_reference,
        'ticketKind', t.ticket_kind
      )
        into v_existing_operator_state
        from sellerpilot_private.support_tickets t
       where t.owner_id = v_owner
         and t.channel_key = p_channel
         and t.external_ticket_id = v_state_external_id
         and not t.demo
       for update;
      if found then
        v_operator_states := v_operator_states || jsonb_build_object(
          v_state_external_id,
          v_existing_operator_state
        );
      end if;
    end loop;

    v_count := public.sellerpilot_28141000_ingest_inquiries_unsafe(
      p_credential_id,
      p_channel,
      v_sanitized
    );
    v_ledger_inquiries := v_sanitized;
  end if;

  for v_inquiry in select value from jsonb_array_elements(v_ledger_inquiries) loop
    if jsonb_typeof(v_inquiry) <> 'object' then continue; end if;
    v_external_id := left(trim(coalesce(v_inquiry->>'externalTicketId', '')), 240);
    v_provider_status := coalesce(
      nullif(v_inquiry->>'providerStatus', ''),
      case when v_inquiry->>'status' = 'resolved' then 'answered' else 'waiting' end
    );
    v_ticket_kind := coalesce(nullif(v_inquiry->>'ticketKind', ''), 'conversation');
    v_provider_context := case
      when jsonb_typeof(v_inquiry->'providerContext') = 'object' then v_inquiry->'providerContext'
      when jsonb_typeof(v_inquiry->'replyContext') = 'object' then v_inquiry->'replyContext'
      else '{}'::jsonb
    end;
    v_remote_message_id := left(nullif(trim(v_inquiry->>'remoteMessageId'), ''), 240);
    v_external_order_reference := left(nullif(trim(v_inquiry->>'externalOrderReference'), ''), 240);
    begin
      v_received_at := coalesce(nullif(v_inquiry->>'receivedAt', '')::timestamptz, clock_timestamp());
    exception when others then
      continue;
    end;
    v_inbound_key := left(nullif(trim(v_inquiry->>'inboundKey'), ''), 500);
    if v_inbound_key is null then
      v_inbound_key := p_channel || ':' || encode(extensions.digest(
        case when v_remote_message_id is not null
          then concat_ws(E'\x1f', 'v2', p_channel, v_external_id, v_remote_message_id)
          else null
        end,
        'sha256'
      ), 'hex');
    end if;

    if v_external_id = ''
       or v_inbound_key is null
       or v_provider_status not in ('waiting', 'answered', 'closed')
       or v_ticket_kind not in ('conversation', 'after_sales')
       or jsonb_typeof(v_provider_context) <> 'object'
       or octet_length(v_provider_context::text) > 64000
       or length(coalesce(v_inquiry->>'message', '')) not between 1 and 20000 then
      continue;
    end if;

    v_existing_operator_state := v_operator_states -> v_external_id;
    v_existing_operator_status := nullif(v_existing_operator_state->>'status', '');
    v_existing_operator_priority := nullif(v_existing_operator_state->>'priority', '')::integer;
    v_existing_operator_resolved_at := nullif(v_existing_operator_state->>'resolvedAt', '')::timestamptz;
    select m.received_at
      into v_existing_inbound_received_at
      from sellerpilot_private.support_inbound_messages m
     where m.owner_id = v_owner
       and m.channel_key = p_channel
       and m.inbound_key = v_inbound_key;
    v_is_new_inbound := not found;
    -- A provider can replay the same immutable message identity with a later
    -- normalization timestamp. The first durable observation owns ordering;
    -- otherwise an old A replay could move the current ticket backwards from B.
    if not v_is_new_inbound then
      v_received_at := v_existing_inbound_received_at;
    end if;

    select t.id, current_message.received_at
      into v_ticket_id, v_current_received_at
      from sellerpilot_private.support_tickets t
      left join sellerpilot_private.support_inbound_messages current_message
        on current_message.ticket_id = t.id
       and current_message.inbound_key = t.latest_inbound_key
     where t.owner_id = v_owner
       and t.channel_key = p_channel
       and t.external_ticket_id = v_external_id
       and t.source_credential_id = p_credential_id
       and not t.demo
     for update of t;
    if v_ticket_id is null then continue; end if;
    select exists (
      select 1
        from sellerpilot_private.support_reply_deliveries delivery
        join sellerpilot_private.channel_gateway_jobs job
          on job.id = delivery.gateway_job_id
         and job.operation = 'inquiries.reply'
         and job.request_payload->>'sellerpilotTicketId' = v_ticket_id::text
         and job.request_payload->>'sellerpilotInboundKey' = v_inbound_key
       where delivery.ticket_id = v_ticket_id
         and delivery.status = 'succeeded'
         and job.status = 'succeeded'
         and job.response_payload @> '{"ok":true}'::jsonb
    ) into v_has_current_delivery_success;
    v_should_advance := v_current_received_at is null
      or v_received_at > v_current_received_at
      or (v_received_at = v_current_received_at and v_inbound_key >= coalesce(v_existing_operator_state->>'latestInboundKey', ''))
      or v_inbound_key = coalesce(v_existing_operator_state->>'latestInboundKey', '');

    update sellerpilot_private.support_tickets t
       set provider_status = case
             when not v_is_new_inbound
              and v_provider_status = 'waiting'
              and v_has_current_delivery_success then 'answered'
             else v_provider_status
           end,
           provider_status_updated_at = case
             when not v_is_new_inbound
              and v_provider_status = 'waiting'
              and v_has_current_delivery_success
               then coalesce(nullif(v_existing_operator_state->>'providerStatusUpdatedAt', '')::timestamptz, t.provider_status_updated_at)
             else now()
           end,
           latest_inbound_key = v_inbound_key,
           provider_context = t.provider_context || v_provider_context,
           channel_account_id = p_credential_id,
           external_order_reference = coalesce(v_external_order_reference, t.external_order_reference),
           ticket_kind = v_ticket_kind,
           status = case
             when v_existing_operator_state is null then t.status
             when v_existing_operator_status = 'resolved'
              and v_is_new_inbound
              and v_provider_status = 'waiting' then 'waiting'
             else v_existing_operator_status
           end,
           priority = coalesce(v_existing_operator_priority, t.priority),
           resolved_at = case
             when v_existing_operator_state is null then t.resolved_at
             when v_existing_operator_status = 'resolved'
              and v_is_new_inbound
              and v_provider_status = 'waiting' then null
             else v_existing_operator_resolved_at
           end,
           reply_draft = case
             when v_existing_operator_state is not null
              and v_is_new_inbound
              and (v_existing_operator_state->>'latestInboundKey') is distinct from v_inbound_key then null
             else t.reply_draft
           end,
           reply_delivery_status = case
             when v_existing_operator_state is not null
              and v_is_new_inbound
              and (v_existing_operator_state->>'latestInboundKey') is distinct from v_inbound_key then 'never'
             else t.reply_delivery_status
           end,
           reply_delivery_error = case
             when v_existing_operator_state is not null
              and v_is_new_inbound
              and (v_existing_operator_state->>'latestInboundKey') is distinct from v_inbound_key then null
             else t.reply_delivery_error
           end,
           reply_gateway_job_id = case
             when v_existing_operator_state is not null
              and v_is_new_inbound
              and (v_existing_operator_state->>'latestInboundKey') is distinct from v_inbound_key then null
             else t.reply_gateway_job_id
           end,
           reply_operation_attempt_id = case
             when v_existing_operator_state is not null
              and v_is_new_inbound
              and (v_existing_operator_state->>'latestInboundKey') is distinct from v_inbound_key then null
             else t.reply_operation_attempt_id
           end,
           last_delivery_job_id = case
             when v_existing_operator_state is not null
              and v_is_new_inbound
              and (v_existing_operator_state->>'latestInboundKey') is distinct from v_inbound_key then null
             else t.last_delivery_job_id
           end,
           updated_at = now()
     where t.id = v_ticket_id
       and v_should_advance;

    if not v_should_advance and v_existing_operator_state is not null then
      update sellerpilot_private.support_tickets t
         set customer_name = v_existing_operator_state->>'customerName',
             subject = v_existing_operator_state->>'subject',
             message = v_existing_operator_state->>'message',
             received_at = (v_existing_operator_state->>'receivedAt')::timestamptz,
             reply_context = coalesce(v_existing_operator_state->'replyContext', '{}'::jsonb),
             provider_context = coalesce(v_existing_operator_state->'providerContext', '{}'::jsonb),
             provider_status = coalesce(v_existing_operator_state->>'providerStatus', 'unknown'),
             provider_status_updated_at = nullif(v_existing_operator_state->>'providerStatusUpdatedAt', '')::timestamptz,
             external_order_reference = nullif(v_existing_operator_state->>'externalOrderReference', ''),
             ticket_kind = coalesce(v_existing_operator_state->>'ticketKind', 'conversation'),
             status = v_existing_operator_status,
             priority = v_existing_operator_priority,
             resolved_at = v_existing_operator_resolved_at
       where t.id = v_ticket_id;
    end if;

    insert into sellerpilot_private.support_inbound_messages (
      ticket_id, owner_id, channel_key, inbound_key, remote_message_id,
      sender_role, body, provider_context, received_at, updated_at
    ) values (
      v_ticket_id,
      v_owner,
      p_channel,
      v_inbound_key,
      v_remote_message_id,
      'customer',
      v_inquiry->>'message',
      v_provider_context,
      v_received_at,
      now()
    )
    on conflict (owner_id, channel_key, inbound_key) do update set
      remote_message_id = coalesce(excluded.remote_message_id, sellerpilot_private.support_inbound_messages.remote_message_id),
      body = excluded.body,
      provider_context = sellerpilot_private.support_inbound_messages.provider_context || excluded.provider_context,
      received_at = sellerpilot_private.support_inbound_messages.received_at,
      updated_at = now();
  end loop;

  if p_channel = 'lazada' then
    for v_inquiry in select value from jsonb_array_elements(v_seller_events) loop
      v_external_id := left(trim(coalesce(v_inquiry->>'externalTicketId', '')), 240);
      v_remote_message_id := left(nullif(trim(v_inquiry->>'remoteMessageId'), ''), 240);
      begin
        v_received_at := nullif(v_inquiry->>'receivedAt', '')::timestamptz;
      exception when others then continue; end;
      if v_external_id = '' or v_remote_message_id is null or v_received_at is null
         or length(coalesce(v_inquiry->>'message', '')) not between 1 and 20000 then continue; end if;
      select t.id into v_ticket_id
        from sellerpilot_private.support_tickets t
       where t.owner_id = v_owner and t.channel_key = 'lazada'
         and t.external_ticket_id = v_external_id
         and t.source_credential_id = p_credential_id and not t.demo
       for update;
      v_inbound_key := 'lazada:' || encode(extensions.digest(
        concat_ws(E'\x1f', 'v2', 'lazada', v_external_id, v_remote_message_id), 'sha256'
      ), 'hex');
      if v_ticket_id is null then
        if v_seller_account_key is null
           or v_seller_account_key_source <> 'provider_certified_v1' then
          raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
        end if;
        insert into sellerpilot_private.support_pending_seller_messages(
          owner_id, credential_id, seller_account_key, channel_key, external_ticket_id, inbound_key,
          remote_message_id, body, received_at
        ) values (
          v_owner, p_credential_id, v_seller_account_key, 'lazada', v_external_id, v_inbound_key,
          v_remote_message_id, v_inquiry->>'message', v_received_at
        ) on conflict (owner_id, channel_key, seller_account_key, inbound_key) do update set
          body = excluded.body;
        continue;
      end if;
      insert into sellerpilot_private.support_inbound_messages(
        ticket_id, owner_id, channel_key, inbound_key, remote_message_id,
        sender_role, body, provider_context, received_at, updated_at
      ) values (
        v_ticket_id, v_owner, 'lazada', v_inbound_key, v_remote_message_id,
        'seller', v_inquiry->>'message', '{}'::jsonb, v_received_at, now()
      ) on conflict (owner_id, channel_key, inbound_key) do update set
        body = excluded.body, received_at = sellerpilot_private.support_inbound_messages.received_at, updated_at = now();
      update sellerpilot_private.support_tickets t
         set provider_status = 'answered', provider_status_updated_at = now(), updated_at = now()
       where t.id = v_ticket_id
         and exists (
           select 1 from sellerpilot_private.support_inbound_messages buyer
            where buyer.ticket_id = t.id and buyer.inbound_key = t.latest_inbound_key
              and buyer.sender_role = 'customer' and v_received_at >= buyer.received_at
         );
    end loop;

    for v_pending in
      select pending.*, ticket.id as ticket_id
        from sellerpilot_private.support_pending_seller_messages pending
        join sellerpilot_private.support_tickets ticket
          on ticket.owner_id = pending.owner_id
         and ticket.channel_key = pending.channel_key
         and ticket.external_ticket_id = pending.external_ticket_id
        join sellerpilot_private.channel_credentials ticket_credential
          on ticket_credential.id = ticket.source_credential_id
         and ticket_credential.created_by = ticket.owner_id
         and ticket_credential.channel = ticket.channel_key
         and ticket_credential.seller_account_key = pending.seller_account_key
         and ticket_credential.seller_account_key_source = 'provider_certified_v1'
       where pending.owner_id = v_owner
         and pending.seller_account_key = v_seller_account_key
         and v_seller_account_key_source = 'provider_certified_v1'
       for update of pending, ticket
    loop
      insert into sellerpilot_private.support_inbound_messages(
        ticket_id, owner_id, channel_key, inbound_key, remote_message_id,
        sender_role, body, provider_context, received_at, updated_at
      ) values (
        v_pending.ticket_id, v_pending.owner_id, 'lazada', v_pending.inbound_key,
        v_pending.remote_message_id, 'seller', v_pending.body, '{}'::jsonb,
        v_pending.received_at, now()
      ) on conflict (owner_id, channel_key, inbound_key) do nothing;
      update sellerpilot_private.support_tickets ticket
         set provider_status = 'answered', provider_status_updated_at = now(), updated_at = now()
       where ticket.id = v_pending.ticket_id
         and exists (
           select 1 from sellerpilot_private.support_inbound_messages buyer
            where buyer.ticket_id = ticket.id and buyer.inbound_key = ticket.latest_inbound_key
              and buyer.sender_role = 'customer' and v_pending.received_at >= buyer.received_at
         );
      delete from sellerpilot_private.support_pending_seller_messages where id = v_pending.id;
    end loop;
  end if;

  return v_count;
end;
$function$
;
revoke all on function public.sellerpilot_0902_ingest_inquiries_unsafe(uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Parent prosrc MD5 d8e07d2f9c82149f92f05bb6cffcaffe
CREATE OR REPLACE FUNCTION sellerpilot_private.support_deletion_fingerprint(p_owner_id uuid, p_channel text, p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select encode(
    extensions.digest(
      p_owner_id::text || chr(31) || p_channel || chr(31) || p_value,
      'sha256'
    ),
    'hex'
  )
$function$
;
revoke all on function sellerpilot_private.support_deletion_fingerprint(uuid,text,text) from public,anon,authenticated,service_role;
