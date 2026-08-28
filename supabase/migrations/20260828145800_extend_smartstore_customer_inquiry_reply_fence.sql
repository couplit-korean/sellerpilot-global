-- Extend the existing Smartstore product-Q&A reply fence to the official
-- customer-inquiry family. Product questions keep their historical numeric
-- questionId identity. Customer inquiries use an explicitly tagged numeric
-- inquiryNo and the disjoint external identity customer:<inquiryNo>.

begin;

alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) rename to sellerpilot_28145800_enqueue_inquiry_reply_unsafe;

create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
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
  v_arguments jsonb;
  v_kind text;
  v_provider_id text;
  v_expected_external_ticket_id text;
  v_actual_external_ticket_id text;
  v_delegated_payload jsonb;
  v_job_id uuid;
  v_reply_fingerprint text;
begin
  if p_channel <> 'smartstore' then
    return public.sellerpilot_28145800_enqueue_inquiry_reply_unsafe(
      p_ticket_id,
      p_channel,
      p_reply_text,
      p_request_payload
    );
  end if;

  if p_ticket_id is null
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object' then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  v_arguments := p_request_payload->'arguments';
  v_kind := case
    when v_arguments ? 'kind' then v_arguments->>'kind'
    else 'product'
  end;

  if v_kind = 'customer' then
    v_provider_id := v_arguments->>'inquiryNo';
    if coalesce(v_provider_id, '') !~ '^[1-9][0-9]*$'
       or v_arguments ? 'questionId' then
      raise exception 'SMARTSTORE_CUSTOMER_INQUIRY_REPLY_ID_MISMATCH';
    end if;
    v_expected_external_ticket_id := 'customer:' || v_provider_id;
  elsif v_kind = 'product' then
    v_provider_id := v_arguments->>'questionId';
    if coalesce(v_provider_id, '') !~ '^[1-9][0-9]*$'
       or v_arguments ? 'inquiryNo' then
      raise exception 'SMARTSTORE_PRODUCT_INQUIRY_REPLY_ID_MISMATCH';
    end if;
    v_expected_external_ticket_id := v_provider_id;
  else
    raise exception 'SMARTSTORE_INQUIRY_REPLY_KIND_INVALID';
  end if;

  select ticket.external_ticket_id
    into v_actual_external_ticket_id
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and ticket.channel_key = 'smartstore'
     and not ticket.demo
   for update;
  if not found then
    raise exception 'inquiry reply ticket not found';
  end if;
  if v_actual_external_ticket_id is distinct from
       v_expected_external_ticket_id then
    raise exception 'inquiry reply ticket payload mismatch';
  end if;

  if v_kind = 'product' then
    return public.sellerpilot_28145800_enqueue_inquiry_reply_unsafe(
      p_ticket_id,
      p_channel,
      p_reply_text,
      p_request_payload
    );
  end if;

  -- The preceding implementation has all credential, seller-account,
  -- duplicate, reply-fingerprint, and ticket-ledger fences we still need. Give
  -- only that implementation a transaction-local synthetic questionId so its
  -- historical external-ticket equality check can run unchanged, then restore
  -- the exact customer-inquiry provider payload before the job is visible.
  v_delegated_payload := jsonb_set(
    p_request_payload,
    '{arguments,questionId}',
    to_jsonb(v_expected_external_ticket_id),
    true
  );
  v_job_id := public.sellerpilot_28145800_enqueue_inquiry_reply_unsafe(
    p_ticket_id,
    p_channel,
    p_reply_text,
    v_delegated_payload
  );

  select job.request_payload->>'sellerpilotReplyFingerprint'
    into v_reply_fingerprint
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_job_id
     and job.channel = 'smartstore'
     and job.operation = 'inquiries.reply'
   for update;
  if v_reply_fingerprint is null then
    raise exception 'inquiry reply ticket ledger mismatch';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set request_payload = p_request_payload || jsonb_build_object(
           'sellerpilotTicketId', p_ticket_id,
           'sellerpilotReplyFingerprint', v_reply_fingerprint
         )
   where job.id = v_job_id
     and job.channel = 'smartstore'
     and job.operation = 'inquiries.reply';
  if not found then
    raise exception 'inquiry reply ticket ledger mismatch';
  end if;

  return v_job_id;
end;
$$;

revoke all on function public.sellerpilot_28145800_enqueue_inquiry_reply_unsafe(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) is
  'Queues exact-bound marketplace replies; Smartstore product questionId and customer inquiryNo identities are disjoint and numeric.';

commit;
