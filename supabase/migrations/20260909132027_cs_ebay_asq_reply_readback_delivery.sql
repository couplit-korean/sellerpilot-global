-- Persist an eBay ASQ reply observation only when the same completion payload
-- carries the exact pre/post GetMemberMessages response delta. AddMemberMessageRTQ
-- acknowledgement alone remains provider_accepted. The immutable job and its
-- original inbound row own delivery evidence; a newer inbound may advance the
-- mutable ticket but must not erase the already-sent reply or be auto-resolved.
begin;

create or replace function sellerpilot_private.validate_ebay_asq_reply_observation_v1(
  p_channel text,
  p_operation text,
  p_status text,
  p_response_payload jsonb,
  p_request_payload jsonb,
  p_provider_mutation_started_at timestamptz,
  p_credential_id uuid,
  p_seller_account_key text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker jsonb;
  v_acceptance jsonb;
  v_arguments jsonb;
  v_observed_at timestamptz;
  v_baseline_count integer;
  v_observed_count integer;
  v_expected_binding_digest text;
  v_ticket_id uuid;
  v_inbound_message_id uuid;
begin
  if p_channel <> 'ebay'
     or p_operation <> 'inquiries.reply'
     or p_status <> 'succeeded' then
    return null;
  end if;

  v_marker := p_response_payload#>'{steps,0,data,sellerpilotReplyReadback}';
  if v_marker is null then
    return null;
  end if;
  v_acceptance := p_response_payload#>'{steps,0,data,sellerpilotReplyAcceptance}';
  v_arguments := p_request_payload->'arguments';

  if jsonb_typeof(v_marker) is distinct from 'object'
     or jsonb_typeof(v_marker->'observedAt') is distinct from 'string'
     or jsonb_typeof(v_marker->'baselineResponseCount') is distinct from 'number'
     or jsonb_typeof(v_marker->'observedResponseCount') is distinct from 'number' then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_INVALID' using errcode = '22023';
  end if;

  begin
    v_observed_at := (v_marker->>'observedAt')::timestamptz;
    v_baseline_count := (v_marker->>'baselineResponseCount')::integer;
    v_observed_count := (v_marker->>'observedResponseCount')::integer;
    v_ticket_id := (p_request_payload->>'sellerpilotTicketId')::uuid;
  exception when others then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_INVALID' using errcode = '22023';
  end;

  if p_provider_mutation_started_at is null
     or p_response_payload->>'ok' is distinct from 'true'
     or jsonb_typeof(p_response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(p_response_payload->'steps') <> 1
     or p_response_payload#>>'{steps,0,name}' is distinct from 'inquiry-reply'
     or p_response_payload#>>'{steps,0,ok}' is distinct from 'true'
     or v_marker->>'contract' is distinct from 'sellerpilot-ebay-asq-reply-readback/1'
     or v_marker->>'level' is distinct from 'provider_observed'
     or v_marker->>'bindingDigest' !~ '^[a-f0-9]{64}$'
     or v_marker->>'replyBodyDigest' !~ '^[a-f0-9]{64}$'
     or v_observed_at is null
     or not pg_catalog.isfinite(v_observed_at)
     or v_baseline_count is null
     or v_baseline_count not between 0 and 99
     or v_observed_count is null
     or v_observed_count not between 1 and 100
     or v_observed_count <> v_baseline_count + 1
     or v_observed_at < p_provider_mutation_started_at - interval '5 minutes'
     or v_observed_at > clock_timestamp() + interval '5 minutes'
     or jsonb_typeof(v_marker->'providerAnswerId') is distinct from 'null'
     or jsonb_typeof(v_marker->'providerAnswerOccurredAt') is distinct from 'null'
     or jsonb_typeof(v_acceptance) is distinct from 'object'
     or v_acceptance->>'contract' is distinct from 'sellerpilot-reply-acceptance/1'
     or v_acceptance->>'level' is distinct from 'provider_accepted'
     or v_acceptance->>'channel' is distinct from 'ebay'
     or v_acceptance->>'kind' is distinct from 'asq'
     or v_acceptance->>'bindingDigest' is distinct from v_marker->>'bindingDigest'
     or jsonb_typeof(v_arguments) is distinct from 'object'
     or coalesce(v_arguments->>'itemId','') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(v_arguments->>'marketplaceId','') !~ '^EBAY_[A-Z_]{2,20}$'
     or length(coalesce(v_arguments->>'parentMessageId','')) not between 1 and 230
     or length(coalesce(v_arguments->>'recipientId','')) not between 1 and 240
     or v_marker->>'replyBodyDigest' is distinct from p_request_payload->>'sellerpilotReplyFingerprint'
     or coalesce(p_seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or coalesce(p_request_payload->>'sellerpilotInboundKey','') not like 'ebay:%'
     or length(coalesce(p_request_payload->>'sellerpilotInboundKey','')) > 500
     or v_ticket_id is null then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_INVALID' using errcode = '22023';
  end if;

  v_expected_binding_digest := encode(
    extensions.digest(
      '{"itemId":' || to_json(v_arguments->>'itemId')::text
      || ',"marketplaceId":' || to_json(v_arguments->>'marketplaceId')::text
      || ',"parentMessageId":' || to_json(v_arguments->>'parentMessageId')::text
      || ',"recipientId":' || to_json(v_arguments->>'recipientId')::text
      || '}',
      'sha256'
    ),
    'hex'
  );
  if v_marker->>'bindingDigest' is distinct from v_expected_binding_digest then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_BINDING_INVALID' using errcode = '22023';
  end if;

  select inbound.id
    into v_inbound_message_id
    from sellerpilot_private.support_tickets ticket
    join sellerpilot_private.support_inbound_messages inbound
      on inbound.ticket_id = ticket.id
     and inbound.owner_id = ticket.owner_id
     and inbound.channel_key = ticket.channel_key
     and inbound.inbound_key = p_request_payload->>'sellerpilotInboundKey'
   where ticket.id = v_ticket_id
     and ticket.channel_key = 'ebay'
     and not ticket.demo
     and ticket.owner_id = p_created_by
     and ticket.source_credential_id = p_credential_id
     and ticket.seller_account_key = p_seller_account_key
     and inbound.sender_role = 'customer'
     and inbound.remote_message_id = v_arguments->>'parentMessageId'
     and case
       when inbound.provider_context ?| array['itemId','parentMessageId','recipientId','marketplaceId']
         then inbound.provider_context->>'itemId' = v_arguments->>'itemId'
          and inbound.provider_context->>'parentMessageId' = v_arguments->>'parentMessageId'
          and inbound.provider_context->>'recipientId' = v_arguments->>'recipientId'
          and inbound.provider_context->>'marketplaceId' = v_arguments->>'marketplaceId'
       else true
     end
   for update of ticket,inbound;
  if not found then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'marker',v_marker,
    'ticketId',v_ticket_id,
    'inboundMessageId',v_inbound_message_id,
    'observedAt',v_observed_at
  );
end
$$;

revoke all on function sellerpilot_private.validate_ebay_asq_reply_observation_v1(
  text,text,text,jsonb,jsonb,timestamptz,uuid,text,uuid
) from public,anon,authenticated,service_role;

create or replace function sellerpilot_private.validate_ebay_asq_reply_completion_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform sellerpilot_private.validate_ebay_asq_reply_observation_v1(
    new.channel,new.operation,new.status,new.response_payload,new.request_payload,
    new.provider_mutation_started_at,new.credential_id,new.seller_account_key,new.created_by
  );
  return new;
end
$$;

revoke all on function sellerpilot_private.validate_ebay_asq_reply_completion_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists validate_ebay_asq_reply_completion_v1
  on sellerpilot_private.channel_gateway_jobs;
create trigger validate_ebay_asq_reply_completion_v1
before insert or update of status,response_payload,error_message
on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.validate_ebay_asq_reply_completion_v1();

create or replace function sellerpilot_private.observe_ebay_asq_reply_delivery_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_validated jsonb;
  v_marker jsonb;
  v_arguments jsonb;
  v_observed_at timestamptz;
  v_delivery_id uuid;
  v_ticket_id uuid;
  v_inbound_message_id uuid;
  v_updated integer;
begin
  v_validated := sellerpilot_private.validate_ebay_asq_reply_observation_v1(
    new.channel,new.operation,new.status,new.response_payload,new.request_payload,
    new.provider_mutation_started_at,new.credential_id,new.seller_account_key,new.created_by
  );
  if v_validated is null then return new; end if;
  v_marker := v_validated->'marker';
  v_arguments := new.request_payload->'arguments';
  v_observed_at := (v_validated->>'observedAt')::timestamptz;
  v_ticket_id := (v_validated->>'ticketId')::uuid;
  v_inbound_message_id := (v_validated->>'inboundMessageId')::uuid;

  select delivery.id,delivery.ticket_id
    into v_delivery_id,v_ticket_id
    from sellerpilot_private.support_reply_deliveries delivery
    join sellerpilot_private.support_tickets ticket on ticket.id=delivery.ticket_id
    join sellerpilot_private.support_inbound_messages inbound
      on inbound.id = v_inbound_message_id
     and inbound.ticket_id = ticket.id
     and inbound.owner_id = delivery.owner_id
     and inbound.channel_key = delivery.channel_key
     and inbound.inbound_key = new.request_payload->>'sellerpilotInboundKey'
   where delivery.gateway_job_id = new.id
     and delivery.channel_key = 'ebay'
     and delivery.ticket_id = v_ticket_id
     and delivery.owner_id = ticket.owner_id
     and delivery.reply_fingerprint = v_marker->>'replyBodyDigest'
     and ticket.channel_key = 'ebay'
     and not ticket.demo
     and ticket.owner_id = new.created_by
     and ticket.source_credential_id = new.credential_id
     and ticket.seller_account_key = new.seller_account_key
     and inbound.sender_role = 'customer'
     and inbound.remote_message_id = v_arguments->>'parentMessageId'
   for update;
  if not found then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_DELIVERY_MISSING' using errcode = '40001';
  end if;

  update sellerpilot_private.support_reply_deliveries delivery
     set status = 'succeeded',
         verification_status = 'remote_observed',
         verification_contract = 'sellerpilot-ebay-asq-reply-readback/1',
         remote_observed_at = v_observed_at,
         provider_message_id = null,
         reconciliation_reason = null,
         updated_at = clock_timestamp()
   where delivery.id = v_delivery_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'EBAY_ASQ_REPLY_OBSERVATION_DELIVERY_AMBIGUOUS' using errcode = '40001';
  end if;

  update sellerpilot_private.support_tickets ticket
     set status = 'resolved',
         provider_status = 'answered',
         provider_status_updated_at = clock_timestamp(),
         reply_delivery_status = 'succeeded',
         reply_delivery_error = null,
         resolved_at = coalesce(ticket.resolved_at,v_observed_at),
         updated_at = clock_timestamp()
   where ticket.id = v_ticket_id
     and ticket.channel_key = 'ebay'
     and ticket.latest_inbound_key = new.request_payload->>'sellerpilotInboundKey'
     and ticket.reply_context->>'itemId' = v_arguments->>'itemId'
     and ticket.reply_context->>'parentMessageId' = v_arguments->>'parentMessageId'
     and ticket.reply_context->>'recipientId' = v_arguments->>'recipientId'
     and ticket.reply_context->>'marketplaceId' = v_arguments->>'marketplaceId';
  return new;
end
$$;

revoke all on function sellerpilot_private.observe_ebay_asq_reply_delivery_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists zz_observe_ebay_asq_reply_delivery_v1
  on sellerpilot_private.channel_gateway_jobs;
create trigger zz_observe_ebay_asq_reply_delivery_v1
after insert or update of status,response_payload,error_message
on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.observe_ebay_asq_reply_delivery_v1();

comment on function sellerpilot_private.observe_ebay_asq_reply_delivery_v1() is
  'Completion-transaction eBay ASQ response-delta persistence. No provider reply ID or answer timestamp is invented.';

commit;
