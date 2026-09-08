begin;

create or replace function sellerpilot_private.cs_snapshot()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_workspace jsonb;
  v_tickets jsonb;
  v_sync jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  -- Preserve channel-specific reply/readback guards from the CS delivery ledger.
  v_workspace := public.sellerpilot_get_cs_workspace_snapshot();
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'externalTicketId', t.external_ticket_id,
      'channelKey', t.channel_key, 'channelCode', c.code,
      'customerName', t.customer_name, 'subject', t.subject,
      'message', t.message, 'translatedMessage', t.translated_message,
      'replyDraft', t.reply_draft, 'status', t.status, 'priority', t.priority,
      'receivedAt', t.received_at, 'updatedAt', t.updated_at, 'demo', false,
      'replyDeliveryStatus', t.reply_delivery_status,
      'replyDeliveryError', t.reply_delivery_error,
      'replyOperationAttemptId', t.reply_operation_attempt_id,
      'replyGatewayJobId', t.last_delivery_job_id,
      'orderId', t.order_id,
      'externalOrderReference', t.external_order_reference,
      'providerStatus', t.provider_status,
      'providerContext', t.provider_context,
      'latestInboundKey', t.latest_inbound_key,
      'ticketKind', t.ticket_kind
    ) || coalesce(ledger.value, '{}'::jsonb)
    order by t.received_at desc, t.id desc
  ), '[]'::jsonb) into v_tickets
  from sellerpilot_private.support_tickets t
  join sellerpilot_private.channels c on c.key = t.channel_key
  left join lateral (
    select value from jsonb_array_elements(coalesce(v_workspace->'tickets', '[]'::jsonb))
    where value->>'ticketId' = t.id::text
  ) ledger on true
  where not t.demo;
  -- Shared administrators can read the same workspace. Credential ownership
  -- remains bound in existing CS mutations; auth.uid() is not the seller ID.
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel_key', s.channel_key, 'data_type', s.data_type, 'status', s.status,
    'imported_count', s.imported_count, 'last_started_at', s.last_started_at,
    'last_succeeded_at', s.last_succeeded_at, 'last_error', s.last_error,
    'updated_at', s.updated_at
  )), '[]'::jsonb) into v_sync
  from sellerpilot_private.channel_sync_state s where s.data_type = 'inquiries';
  return jsonb_build_object(
    'contract', 'sellerpilot-cs-snapshot/1', 'generatedAt', statement_timestamp(),
    'tickets', v_tickets, 'syncStatus', v_sync,
    'deliverySummary', coalesce(v_workspace->'summary', '{}'::jsonb)
  );
end;
$$;
revoke all on function sellerpilot_private.cs_snapshot() from public, anon;
revoke all on function sellerpilot_private.cs_snapshot() from authenticated;

create or replace function public.sellerpilot_get_cs_snapshot()
returns jsonb language sql stable security definer set search_path = ''
as $$ select sellerpilot_private.cs_snapshot(); $$;
revoke all on function public.sellerpilot_get_cs_snapshot() from public, anon;
grant execute on function public.sellerpilot_get_cs_snapshot() to authenticated;

commit;
