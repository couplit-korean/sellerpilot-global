-- Proposal-only integration patch. Do not apply from the channel worktree.
-- A provider-accepted Coupang contact-center reply creates exactly one
-- read-only child job in the same transaction as its delivery-ledger update.

begin;

create table sellerpilot_private.coupang_reply_readback_links (
  source_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  delivery_id uuid not null unique
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  child_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  ticket_id uuid not null
    references sellerpilot_private.support_tickets(id) on delete restrict,
  inquiry_id text not null check (inquiry_id ~ '^[1-9][0-9]*$'),
  parent_answer_id text not null check (parent_answer_id ~ '^[1-9][0-9]*$'),
  expected_inbound_key text not null
    check (expected_inbound_key ~ '^coupang:[a-f0-9]{64}$'),
  expected_reply_fingerprint text not null
    check (expected_reply_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.coupang_reply_readback_links enable row level security;
revoke all on sellerpilot_private.coupang_reply_readback_links
  from public, anon, authenticated, service_role;

create function sellerpilot_private.enqueue_coupang_reply_readback_after_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_child_job_id uuid := gen_random_uuid();
  v_inquiry_id text;
  v_parent_answer_id text;
  v_inbound_key text;
begin
  if new.channel_key <> 'coupang'
     or new.status <> 'succeeded'
     or new.verification_status <> 'provider_accepted' then
    return new;
  end if;

  -- The delivery row and source job are both locked by the enclosing gateway
  -- completion transaction. Replayed completion callbacks therefore observe
  -- the same unique link rather than creating another child.
  if exists (
    select 1
      from sellerpilot_private.coupang_reply_readback_links link
     where link.source_job_id = new.gateway_job_id
  ) then
    return new;
  end if;

  select job.* into v_source
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.gateway_job_id
   for update;
  if not found
     or v_source.channel <> 'coupang'
     or v_source.operation <> 'inquiries.reply'
     or v_source.status <> 'succeeded' then
    raise exception 'COUPANG_REPLY_READBACK_SOURCE_INVALID' using errcode = '23514';
  end if;
  -- A missing request kind must not inherit the call-center acceptance kind
  -- through SQL's three-valued comparison. Product replies are intentionally
  -- outside this trigger; malformed/missing kinds fail the completion.
  if v_source.request_payload#>>'{arguments,kind}' is null then
    raise exception 'COUPANG_REPLY_READBACK_SOURCE_INVALID' using errcode = '23514';
  end if;
  if v_source.request_payload#>>'{arguments,kind}' <> 'call-center' then
    return new;
  end if;
  if v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,contract}'
          is distinct from 'sellerpilot-reply-acceptance/1'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,level}'
          is distinct from 'provider_accepted'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,channel}'
          is distinct from 'coupang'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,kind}'
          is distinct from 'call-center' then
    raise exception 'COUPANG_REPLY_READBACK_SOURCE_INVALID' using errcode = '23514';
  end if;

  v_inquiry_id := nullif(v_source.request_payload#>>'{arguments,inquiryId}', '');
  v_parent_answer_id := nullif(v_source.request_payload#>>'{arguments,parentAnswerId}', '');
  v_inbound_key := coalesce(
    nullif(v_source.request_payload->>'sellerpilotInboundKey', ''),
    nullif(v_source.request_payload->>'sellerpilotExpectedInboundKey', '')
  );
  if coalesce(v_inquiry_id, '') !~ '^[1-9][0-9]*$'
     or coalesce(v_parent_answer_id, '') !~ '^[1-9][0-9]*$'
     or coalesce(v_inbound_key, '') !~ '^coupang:[a-f0-9]{64}$'
     or new.reply_fingerprint is distinct from
          v_source.request_payload->>'sellerpilotReplyFingerprint' then
    raise exception 'COUPANG_REPLY_READBACK_BINDING_INVALID' using errcode = '23514';
  end if;

  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id = new.ticket_id
     and ticket.channel_key = 'coupang'
     and ticket.external_ticket_id = 'call-center:' || v_inquiry_id
     and not ticket.demo
   for update;
  if not found then
    raise exception 'COUPANG_REPLY_READBACK_TICKET_INVALID' using errcode = '23514';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_source.credential_id
     and credential.channel = 'coupang'
     and credential.environment = 'production'
     and credential.environment = v_source.environment
     and credential.status in ('active', 'grace')
     and credential.created_by = v_ticket.owner_id
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
   for share;
  if not found
     or v_source.created_by is distinct from v_ticket.owner_id
     or v_ticket.source_credential_id is distinct from v_source.credential_id
     or coalesce(v_source.seller_account_key, '') !~ '^[a-f0-9]{64}$'
     or v_ticket.seller_account_key is distinct from v_source.seller_account_key
     or v_credential.seller_account_key is distinct from v_source.seller_account_key then
    raise exception 'COUPANG_REPLY_READBACK_CREDENTIAL_INVALID' using errcode = '23514';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by, seller_account_key
  ) values (
    v_child_job_id,
    v_source.credential_id,
    null,
    'coupang',
    'inquiries.list',
    v_source.environment,
    jsonb_build_object(
      'periodicKey', 'inquiries:reply-readback:' || v_source.id::text,
      'arguments', jsonb_build_object(
        'kind', 'call-center-detail',
        'inquiryId', v_inquiry_id
      ),
      'sellerpilotReplyReadback', jsonb_build_object(
        'contract', 'sellerpilot-coupang-reply-readback/1',
        'sourceJobId', v_source.id,
        'ticketId', v_ticket.id,
        'expectedInboundKey', v_inbound_key,
        'expectedReplyFingerprint', new.reply_fingerprint,
        'expectedParentAnswerId', v_parent_answer_id
      )
    ),
    v_source.created_by,
    v_source.seller_account_key
  );

  insert into sellerpilot_private.coupang_reply_readback_links (
    source_job_id, delivery_id, child_job_id, credential_id, ticket_id,
    inquiry_id, parent_answer_id, expected_inbound_key,
    expected_reply_fingerprint
  ) values (
    v_source.id, new.id, v_child_job_id, v_source.credential_id, v_ticket.id,
    v_inquiry_id, v_parent_answer_id, v_inbound_key, new.reply_fingerprint
  );
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.enqueue_coupang_reply_readback_after_acceptance()
  from public, anon, authenticated, service_role;

create trigger enqueue_coupang_reply_readback_after_acceptance
after insert or update of status, verification_status
on sellerpilot_private.support_reply_deliveries
for each row execute function
  sellerpilot_private.enqueue_coupang_reply_readback_after_acceptance();

commit;
