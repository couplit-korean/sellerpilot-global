-- Add a durable CS message/delivery ledger without mutating an applied
-- migration. Deploy this only with the asynchronous CS reply API after the
-- upload release gate is cleared.

begin;

alter table sellerpilot_private.support_tickets
  add column if not exists provider_status text not null default 'unknown',
  add column if not exists provider_status_updated_at timestamptz,
  add column if not exists latest_inbound_key text,
  add column if not exists provider_context jsonb not null default '{}'::jsonb,
  add column if not exists channel_account_id uuid references sellerpilot_private.channel_credentials(id) on delete set null,
  add column if not exists external_order_reference text,
  add column if not exists ticket_kind text not null default 'conversation',
  add column if not exists last_delivery_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete set null;

update sellerpilot_private.support_tickets t
   set channel_account_id = source_credential_id,
       provider_context = case
         when provider_context = '{}'::jsonb then reply_context
         else provider_context || reply_context
       end,
       provider_status = provider_status,
       provider_status_updated_at = provider_status_updated_at
 where channel_account_id is null
    or provider_context = '{}'::jsonb
    or provider_status = 'unknown';

alter table sellerpilot_private.support_tickets
  drop constraint if exists support_tickets_provider_status_check,
  drop constraint if exists support_tickets_provider_context_check,
  drop constraint if exists support_tickets_ticket_kind_check;

alter table sellerpilot_private.support_tickets
  add constraint support_tickets_provider_status_check
    check (provider_status in ('unknown', 'waiting', 'answered', 'closed')) not valid,
  add constraint support_tickets_provider_context_check
    check (jsonb_typeof(provider_context) = 'object' and octet_length(provider_context::text) <= 64000) not valid,
  add constraint support_tickets_ticket_kind_check
    check (ticket_kind in ('conversation', 'after_sales')) not valid;

alter table sellerpilot_private.support_tickets validate constraint support_tickets_provider_status_check;
alter table sellerpilot_private.support_tickets validate constraint support_tickets_provider_context_check;
alter table sellerpilot_private.support_tickets validate constraint support_tickets_ticket_kind_check;

create index if not exists support_tickets_latest_inbound_idx
  on sellerpilot_private.support_tickets (channel_key, latest_inbound_key)
  where latest_inbound_key is not null;

create index if not exists support_tickets_delivery_job_idx
  on sellerpilot_private.support_tickets (last_delivery_job_id)
  where last_delivery_job_id is not null;

create table if not exists sellerpilot_private.support_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references sellerpilot_private.support_tickets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_key text not null references sellerpilot_private.channels(key),
  inbound_key text not null,
  remote_message_id text,
  sender_role text not null default 'customer' check (sender_role in ('customer', 'seller', 'system')),
  body text not null check (length(body) between 1 and 20000),
  provider_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_context) = 'object' and octet_length(provider_context::text) <= 64000),
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, channel_key, inbound_key)
);

create index if not exists support_inbound_messages_ticket_time_idx
  on sellerpilot_private.support_inbound_messages (ticket_id, received_at desc, id desc);

alter table sellerpilot_private.support_inbound_messages enable row level security;
revoke all on sellerpilot_private.support_inbound_messages from public, anon, authenticated;

create table if not exists sellerpilot_private.support_pending_seller_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  channel_key text not null check (channel_key = 'lazada'),
  external_ticket_id text not null,
  inbound_key text not null,
  remote_message_id text not null,
  body text not null check (length(body) between 1 and 20000),
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_id, channel_key, seller_account_key, inbound_key)
);
alter table sellerpilot_private.support_pending_seller_messages enable row level security;
revoke all on sellerpilot_private.support_pending_seller_messages from public, anon, authenticated;

create table if not exists sellerpilot_private.support_reply_deliveries (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references sellerpilot_private.support_tickets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  gateway_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id) on delete set null,
  channel_key text not null references sellerpilot_private.channels(key),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')),
  reply_fingerprint text not null check (reply_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_request_id text,
  provider_message_id text,
  safe_message text,
  reconciliation_reason text,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledgement_reason text,
  queued_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_reply_deliveries_ticket_time_idx
  on sellerpilot_private.support_reply_deliveries (ticket_id, queued_at desc, id desc);

create index if not exists support_reply_deliveries_attention_idx
  on sellerpilot_private.support_reply_deliveries (updated_at desc)
  where status in ('queued', 'running', 'reconciliation_required');

alter table sellerpilot_private.support_reply_deliveries enable row level security;
revoke all on sellerpilot_private.support_reply_deliveries from public, anon, authenticated;

-- Product Q&A and customer inquiry identifiers must never share a namespace.
update sellerpilot_private.support_tickets t
   set external_ticket_id = 'smartstore:product-qna:' || t.external_ticket_id,
       reply_context = t.reply_context || jsonb_build_object('kind', 'product', 'questionId', t.external_ticket_id),
       provider_context = t.provider_context || jsonb_build_object(
         'kind', 'product', 'namespace', 'product-qna', 'questionId', t.external_ticket_id
       ),
       updated_at = now()
 where t.channel_key = 'smartstore'
   and t.external_ticket_id ~ '^[0-9]+$'
   and not exists (
     select 1 from sellerpilot_private.support_tickets existing
      where existing.owner_id = t.owner_id
        and existing.channel_key = t.channel_key
        and existing.external_ticket_id = 'smartstore:product-qna:' || t.external_ticket_id
   );

create or replace function sellerpilot_private.sync_inquiry_reply_delivery_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
  v_owner_id uuid;
  v_reply_fingerprint text;
  v_provider_request_id text;
  v_delivery_status text;
  v_reconciliation_reason text;
begin
  if new.operation <> 'inquiries.reply' then return new; end if;

  begin
    v_ticket_id := nullif(new.request_payload->>'sellerpilotTicketId', '')::uuid;
  exception when others then
    return new;
  end;
  v_reply_fingerprint := nullif(new.request_payload->>'sellerpilotReplyFingerprint', '');
  if v_ticket_id is null or v_reply_fingerprint !~ '^[0-9a-f]{64}$' then return new; end if;

  select t.owner_id into v_owner_id
    from sellerpilot_private.support_tickets t
   where t.id = v_ticket_id
     and t.channel_key = new.channel
     and not t.demo;
  if v_owner_id is null then return new; end if;

  v_provider_request_id := nullif(new.response_payload#>>'{steps,0,requestId}', '');
  v_delivery_status := case
    when new.status = 'succeeded' and new.response_payload @> '{"ok":true}'::jsonb then 'succeeded'
    when new.status = 'succeeded' and new.response_payload @> '{"ok":false}'::jsonb then 'failed'
    when new.status = 'succeeded' then 'reconciliation_required'
    else new.status
  end;
  v_reconciliation_reason := case
    when v_delivery_status = 'reconciliation_required'
      then left(coalesce(
        nullif(trim(new.error_message), ''),
        'Provider outcome requires reconciliation.'
      ), 500)
    else null
  end;
  insert into sellerpilot_private.support_reply_deliveries (
    ticket_id, owner_id, gateway_job_id, channel_key, status,
    reply_fingerprint, provider_request_id, provider_message_id,
    safe_message, reconciliation_reason, queued_at, started_at,
    completed_at, updated_at
  ) values (
    v_ticket_id,
    v_owner_id,
    new.id,
    new.channel,
    v_delivery_status,
    v_reply_fingerprint,
    v_provider_request_id,
    left(nullif(trim(new.response_payload->>'remoteId'), ''), 240),
    left(nullif(trim(new.response_payload->>'safeMessage'), ''), 1000),
    v_reconciliation_reason,
    new.created_at,
    new.started_at,
    new.completed_at,
    now()
  )
  on conflict (gateway_job_id) do update set
    status = excluded.status,
    provider_request_id = coalesce(excluded.provider_request_id, sellerpilot_private.support_reply_deliveries.provider_request_id),
    provider_message_id = coalesce(excluded.provider_message_id, sellerpilot_private.support_reply_deliveries.provider_message_id),
    safe_message = coalesce(excluded.safe_message, sellerpilot_private.support_reply_deliveries.safe_message),
    reconciliation_reason = excluded.reconciliation_reason,
    started_at = coalesce(excluded.started_at, sellerpilot_private.support_reply_deliveries.started_at),
    completed_at = excluded.completed_at,
    updated_at = now();

  update sellerpilot_private.support_tickets
     set last_delivery_job_id = new.id,
         provider_status = case when v_delivery_status = 'succeeded' then 'answered' else provider_status end,
         provider_status_updated_at = case when v_delivery_status = 'succeeded' then now() else provider_status_updated_at end,
         updated_at = case when status = 'resolved' then updated_at else now() end
   where id = v_ticket_id
     and latest_inbound_key = new.request_payload->>'sellerpilotInboundKey';
  return new;
end;
$$;

drop trigger if exists sync_inquiry_reply_delivery_ledger
  on sellerpilot_private.channel_gateway_jobs;
create trigger sync_inquiry_reply_delivery_ledger
after insert or update of status, response_payload, error_message
on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.sync_inquiry_reply_delivery_ledger();

-- Backfill reply jobs created before this trigger. Invalid legacy metadata is
-- skipped instead of guessed.
insert into sellerpilot_private.support_reply_deliveries (
  ticket_id, owner_id, gateway_job_id, channel_key, status,
  reply_fingerprint, provider_request_id, provider_message_id,
  safe_message, reconciliation_reason, queued_at, started_at,
  completed_at, updated_at
)
select
  t.id,
  t.owner_id,
  j.id,
  j.channel,
  case
    when j.status = 'succeeded' and j.response_payload @> '{"ok":true}'::jsonb then 'succeeded'
    when j.status = 'succeeded' and j.response_payload @> '{"ok":false}'::jsonb then 'failed'
    when j.status = 'succeeded' then 'reconciliation_required'
    else j.status
  end,
  j.request_payload->>'sellerpilotReplyFingerprint',
  nullif(j.response_payload#>>'{steps,0,requestId}', ''),
  left(nullif(trim(j.response_payload->>'remoteId'), ''), 240),
  left(nullif(trim(j.response_payload->>'safeMessage'), ''), 1000),
  case when j.status = 'reconciliation_required'
      or (
        j.status = 'succeeded'
        and not (j.response_payload @> '{"ok":true}'::jsonb)
        and not (j.response_payload @> '{"ok":false}'::jsonb)
      )
    then left(coalesce(nullif(trim(j.error_message), ''), 'Provider outcome requires reconciliation.'), 500)
    else null end,
  j.created_at,
  j.started_at,
  j.completed_at,
  j.updated_at
from sellerpilot_private.channel_gateway_jobs j
join sellerpilot_private.support_tickets t
  on t.id = case
    when coalesce(j.request_payload->>'sellerpilotTicketId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (j.request_payload->>'sellerpilotTicketId')::uuid
    else null
  end
where j.operation = 'inquiries.reply'
  and j.status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')
  and coalesce(j.request_payload->>'sellerpilotReplyFingerprint', '') ~ '^[0-9a-f]{64}$'
on conflict (gateway_job_id) do nothing;

update sellerpilot_private.support_tickets t
   set last_delivery_job_id = (
    select d.gateway_job_id
      from sellerpilot_private.support_reply_deliveries d
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = d.gateway_job_id
     where d.ticket_id = t.id
       and job.request_payload->>'sellerpilotInboundKey' = t.latest_inbound_key
     order by d.queued_at desc, d.id desc
     limit 1
   )
 where t.last_delivery_job_id is null
   and exists (
     select 1
       from sellerpilot_private.support_reply_deliveries d
       join sellerpilot_private.channel_gateway_jobs job
         on job.id = d.gateway_job_id
      where d.ticket_id = t.id
        and job.request_payload->>'sellerpilotInboundKey' = t.latest_inbound_key
   );

create or replace function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not public.sellerpilot_is_admin() then null
    else (
      select jsonb_build_object(
        'id', t.id,
        'external_ticket_id', t.external_ticket_id,
        'channel_key', t.channel_key,
        'status', t.status,
        'provider_status', t.provider_status,
        'provider_context', t.provider_context,
        'reply_context', t.reply_context,
        'latest_inbound_key', t.latest_inbound_key,
        'ticket_kind', t.ticket_kind,
        'order_id', t.order_id,
        'external_order_reference', t.external_order_reference,
        'environment', c.environment,
        'seller_account_key_source', c.seller_account_key_source,
        'seller_account_verified_at', c.seller_account_verified_at
      )
        from sellerpilot_private.support_tickets t
        left join sellerpilot_private.channel_credentials c
          on c.id = coalesce(t.channel_account_id, t.source_credential_id)
         and c.channel = t.channel_key
         and c.created_by = t.owner_id
       where t.id = p_id and not t.demo
       limit 1
    )
  end;
$$;

create or replace function public.sellerpilot_get_inquiry_reply_delivery(
  p_ticket_id uuid,
  p_job_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not public.sellerpilot_is_admin() then null
    else (
      select jsonb_build_object(
        'jobId', d.gateway_job_id,
        'ticketId', d.ticket_id,
        'channel', d.channel_key,
        'inboundKey', job.request_payload->>'sellerpilotInboundKey',
        'status', d.status,
        'safeMessage', d.safe_message,
        'reconciliationReason', d.reconciliation_reason,
        'providerRequestId', d.provider_request_id,
        'providerMessageId', d.provider_message_id,
        'queuedAt', d.queued_at,
        'startedAt', d.started_at,
        'completedAt', d.completed_at,
        'updatedAt', d.updated_at
      )
        from sellerpilot_private.support_reply_deliveries d
        join sellerpilot_private.channel_gateway_jobs job on job.id = d.gateway_job_id
        join sellerpilot_private.support_tickets t on t.id = d.ticket_id
       where d.ticket_id = p_ticket_id
         and (
           (p_job_id is not null and d.gateway_job_id = p_job_id)
           or (p_job_id is null and d.gateway_job_id = t.last_delivery_job_id)
         )
         and not t.demo
       order by d.queued_at desc, d.id desc
       limit 1
    )
  end;
$$;

create or replace function public.sellerpilot_get_cs_workspace_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'tickets', coalesce(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'orderId', t.order_id,
      'externalOrderReference', t.external_order_reference,
      'providerStatus', t.provider_status,
      'providerStatusUpdatedAt', t.provider_status_updated_at,
      'providerContext', t.provider_context,
      'latestInboundKey', t.latest_inbound_key,
      'ticketKind', t.ticket_kind,
      'delivery', case when d.id is null then null else jsonb_build_object(
        'jobId', d.gateway_job_id,
        'ticketId', d.ticket_id,
        'channel', d.channel_key,
        'inboundKey', d.inbound_key,
        'status', d.status,
        'safeMessage', d.safe_message,
        'reconciliationReason', d.reconciliation_reason,
        'providerRequestId', d.provider_request_id,
        'providerMessageId', d.provider_message_id,
        'queuedAt', d.queued_at,
        'startedAt', d.started_at,
        'completedAt', d.completed_at,
        'updatedAt', d.updated_at
      ) end,
      'blockingDelivery', case when blocking.id is null then null else jsonb_build_object(
        'jobId', blocking.gateway_job_id,
        'ticketId', blocking.ticket_id,
        'channel', blocking.channel_key,
        'inboundKey', blocking.inbound_key,
        'status', blocking.status,
        'safeMessage', blocking.safe_message,
        'reconciliationReason', blocking.reconciliation_reason,
        'providerRequestId', blocking.provider_request_id,
        'providerMessageId', blocking.provider_message_id,
        'queuedAt', blocking.queued_at,
        'startedAt', blocking.started_at,
        'completedAt', blocking.completed_at,
        'updatedAt', blocking.updated_at
      ) end
    ) order by t.received_at desc), '[]'::jsonb),
    'summary', jsonb_build_object(
      'queued', (
        select count(*)
          from sellerpilot_private.support_reply_deliveries delivery
          join sellerpilot_private.support_tickets ticket
            on ticket.last_delivery_job_id = delivery.gateway_job_id
         where delivery.status = 'queued'
      ),
      'running', (
        select count(*)
          from sellerpilot_private.support_reply_deliveries delivery
          join sellerpilot_private.support_tickets ticket
            on ticket.last_delivery_job_id = delivery.gateway_job_id
         where delivery.status = 'running'
      ),
      'reconciliationRequired', (
        select count(*)
          from sellerpilot_private.support_reply_deliveries delivery
          join sellerpilot_private.support_tickets ticket
            on ticket.last_delivery_job_id = delivery.gateway_job_id
         where delivery.status = 'reconciliation_required'
           and delivery.acknowledged_at is null
      ),
      'blocking', (
        select count(*)
          from sellerpilot_private.support_reply_deliveries delivery
          join sellerpilot_private.channel_gateway_jobs job on job.id = delivery.gateway_job_id
          join sellerpilot_private.support_tickets ticket on ticket.id = delivery.ticket_id
         where delivery.status in ('queued', 'running', 'reconciliation_required')
           and delivery.acknowledged_at is null
           and job.request_payload->>'sellerpilotInboundKey' is distinct from ticket.latest_inbound_key
      )
    )
  ) into v_result
  from sellerpilot_private.support_tickets t
  left join lateral (
    select delivery.*, job.request_payload->>'sellerpilotInboundKey' as inbound_key
      from sellerpilot_private.support_reply_deliveries delivery
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = delivery.gateway_job_id
     where delivery.ticket_id = t.id
       and delivery.gateway_job_id = t.last_delivery_job_id
       and job.request_payload->>'sellerpilotInboundKey' = t.latest_inbound_key
       and (delivery.status <> 'reconciliation_required' or delivery.acknowledged_at is null)
     limit 1
  ) d on true
  left join lateral (
    select delivery.*, job.request_payload->>'sellerpilotInboundKey' as inbound_key
      from sellerpilot_private.support_reply_deliveries delivery
      join sellerpilot_private.channel_gateway_jobs job on job.id = delivery.gateway_job_id
     where delivery.ticket_id = t.id
       and delivery.status in ('queued', 'running', 'reconciliation_required')
       and delivery.acknowledged_at is null
       and job.request_payload->>'sellerpilotInboundKey' is distinct from t.latest_inbound_key
     order by delivery.queued_at desc, delivery.id desc
     limit 1
  ) blocking on true
  where not t.demo;

  return coalesce(v_result, jsonb_build_object(
    'tickets', '[]'::jsonb,
    'summary', jsonb_build_object('queued', 0, 'running', 0, 'reconciliationRequired', 0)
  ));
end;
$$;

-- Preserve the latest eBay seller/site lineage checks and the existing
-- non-eBay ingest behavior, then add message-level metadata without changing
-- the operator's local workflow state.
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
$$;

-- Bind all future gateway reply deduplication to the exact inbound message
-- cycle. Historical successes for the same conversation remain auditable but
-- cannot consume or conflict with a reply to a newer buyer message.
do $legacy_reply_generation_preflight$
begin
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.operation = 'inquiries.reply'
       and job.status in ('queued', 'running', 'reconciliation_required')
       and nullif(job.request_payload->>'sellerpilotInboundKey', '') is null
  ) then
    raise exception 'active legacy inquiry reply jobs require reconciliation before CS generation rollout';
  end if;
end;
$legacy_reply_generation_preflight$;

do $rewrite_reply_generation$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.sellerpilot_11820_enqueue_reply_unsafe(uuid,text,text,jsonb)',
    'public.sellerpilot_28145800_enqueue_inquiry_reply_unsafe(uuid,text,text,jsonb)'
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature::regprocedure)
      into v_definition;
    v_rewritten := replace(
      v_definition,
      $old$'preparing', 'sending', 'succeeded', 'reconciliation_required'$old$,
      $new$'preparing', 'sending', 'reconciliation_required'$new$
    );
    v_rewritten := replace(
      v_rewritten,
      $old$and j.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
     and ($old$,
      $new$and j.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
     and j.request_payload->>'sellerpilotInboundKey' = v_ticket.latest_inbound_key
     and ($new$
    );
    v_rewritten := replace(
      v_rewritten,
      $old$'sellerpilotTicketId', p_ticket_id,
      'sellerpilotReplyFingerprint', v_reply_fingerprint$old$,
      $new$'sellerpilotTicketId', p_ticket_id,
      'sellerpilotInboundKey', v_ticket.latest_inbound_key,
      'sellerpilotReplyFingerprint', v_reply_fingerprint$new$
    );
    if v_rewritten = v_definition
       or v_rewritten not like '%sellerpilotInboundKey%'
       or v_rewritten like '%' || $needle$'preparing', 'sending', 'succeeded', 'reconciliation_required'$needle$ || '%' then
      raise exception 'inquiry reply generation rewrite contract mismatch: %', v_signature;
    end if;
    execute v_rewritten;
  end loop;
end;
$rewrite_reply_generation$;

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
  v_error text;
  v_inbound_key text;
  v_current_inbound_key text;
  v_current_generation boolean := false;
begin
  if old.operation <> 'inquiries.reply' then return new; end if;
  begin
    v_ticket_id := nullif(new.request_payload->>'sellerpilotTicketId', '')::uuid;
  exception when others then v_ticket_id := null; end;
  v_inbound_key := nullif(new.request_payload->>'sellerpilotInboundKey', '');

  if old.status = 'running'
     and (old.lease_expires_at is null or old.lease_expires_at <= now())
     and old.provider_mutation_started_at is not null
     and new.status in ('queued', 'failed') then
    new.status := 'reconciliation_required';
    new.error_message := 'Inquiry reply worker lease expired; provider outcome requires reconciliation.';
    new.completed_at := now();
  end if;
  if v_ticket_id is null then
    if old.status = 'running' and new.status in ('succeeded', 'failed', 'reconciliation_required') then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply ticket metadata is missing; provider outcome requires reconciliation.';
      new.completed_at := now();
    end if;
    return new;
  end if;
  select t.latest_inbound_key into v_current_inbound_key
    from sellerpilot_private.support_tickets t where t.id = v_ticket_id;
  v_current_generation := found and v_inbound_key is not null
    and v_current_inbound_key is not distinct from v_inbound_key;

  if old.status = 'queued' and new.status = 'running' then
    if not v_current_generation then return new; end if;
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'sending', reply_delivery_error = null, updated_at = now()
     where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key;
    if not found then raise exception 'inquiry reply ticket ledger mismatch'; end if;
    return new;
  end if;

  if new.status = 'failed' then
    if not v_current_generation then return new; end if;
    v_error := left(coalesce(nullif(trim(new.error_message), ''), '판매채널 답변을 전송하지 못했습니다.'), 1000);
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'failed', reply_delivery_error = v_error, updated_at = now()
     where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 and old.status = 'running' then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply reached a terminal provider result but its ticket ledger no longer matches.';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if new.status = 'reconciliation_required' then
    if not v_current_generation then return new; end if;
    v_error := left(coalesce(nullif(trim(new.error_message), ''), '판매채널 답변 접수 여부를 수동 확인해야 합니다.'), 1000);
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'reconciliation_required', reply_delivery_error = v_error, updated_at = now()
     where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key;
    return new;
  end if;

  if old.status = 'running' and new.status = 'succeeded'
     and new.response_payload @> '{"ok":false}'::jsonb then
    if not v_current_generation then return new; end if;
    v_error := left(coalesce(nullif(trim(new.response_payload->>'safeMessage'), ''), nullif(trim(new.error_message), ''), '판매채널에서 답변을 거절했습니다.'), 1000);
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'failed', reply_delivery_error = v_error, updated_at = now()
     where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was rejected remotely but its ticket ledger no longer matches.';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if old.status = 'running' and new.status = 'succeeded'
     and not (new.response_payload @> '{"ok":true}'::jsonb) then
    new.status := 'reconciliation_required';
    new.error_message := 'Inquiry reply completion did not include a trustworthy provider acknowledgement.';
    new.completed_at := now();
    if v_current_generation then
      update sellerpilot_private.support_tickets t
         set reply_delivery_status = 'reconciliation_required',
             reply_delivery_error = '판매채널 답변 결과를 확정할 수 없어 수동 확인이 필요합니다.', updated_at = now()
       where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
         and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key;
    end if;
    return new;
  end if;

  if old.status = 'running' and new.status = 'succeeded'
     and new.response_payload @> '{"ok":true}'::jsonb then
    v_reply := nullif(trim(case when new.channel = 'qoo10'
      then new.request_payload#>>'{arguments,params,contents}'
      else new.request_payload#>>'{arguments,reply}' end), '');
    v_expected_fingerprint := nullif(new.request_payload->>'sellerpilotReplyFingerprint', '');
    if v_reply is not null then
      v_actual_fingerprint := encode(extensions.digest(v_reply, 'sha256'), 'hex');
    end if;
    if v_reply is null or v_expected_fingerprint is null
       or v_actual_fingerprint is distinct from v_expected_fingerprint then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was accepted remotely but its ticket ledger metadata failed integrity validation.';
      new.completed_at := now();
      if v_current_generation then
        update sellerpilot_private.support_tickets t
           set reply_delivery_status = 'reconciliation_required',
               reply_delivery_error = '판매채널 답변은 접수됐으나 내부 원장 무결성을 확인해야 합니다.', updated_at = now()
         where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
           and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key;
      end if;
      return new;
    end if;
    if not v_current_generation then return new; end if;
    update sellerpilot_private.support_tickets t
       set status = 'resolved', reply_draft = left(v_reply, 8000),
           resolved_at = coalesce(t.resolved_at, now()), reply_delivery_status = 'succeeded',
           reply_delivery_error = null, updated_at = now()
     where t.id = v_ticket_id and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel and t.seller_account_key = new.seller_account_key
    returning t.owner_id into v_owner_id;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was accepted remotely but its ticket ledger no longer matches.';
      new.completed_at := now();
      return new;
    end if;
    insert into sellerpilot_private.operation_audit(owner_id, action, entity_type, entity_id, safe_detail)
    values (v_owner_id, 'ticket_reply_delivered', 'support_ticket', v_ticket_id::text,
      jsonb_build_object('channel', new.channel, 'gateway_job_id', new.id, 'inbound_key', v_inbound_key));
  end if;
  return new;
end;
$$;

drop index if exists sellerpilot_private.channel_gateway_jobs_one_terminal_or_active_reply_idx;
create unique index channel_gateway_jobs_one_active_legacy_reply_idx
  on sellerpilot_private.channel_gateway_jobs (
    (request_payload->>'sellerpilotTicketId')
  )
  where operation = 'inquiries.reply'
    and request_payload->>'sellerpilotTicketId' is not null
    and request_payload->>'sellerpilotInboundKey' is null
    and status in ('queued', 'running', 'reconciliation_required');

create unique index channel_gateway_jobs_one_terminal_or_active_reply_generation_idx
  on sellerpilot_private.channel_gateway_jobs (
    (request_payload->>'sellerpilotTicketId'),
    (request_payload->>'sellerpilotInboundKey')
  )
  where operation = 'inquiries.reply'
    and request_payload->>'sellerpilotTicketId' is not null
    and request_payload->>'sellerpilotInboundKey' is not null
    and (
      status in ('queued', 'running', 'reconciliation_required')
      or (status = 'succeeded' and response_payload @> '{"ok":true}'::jsonb)
    );

-- Smartstore product Q&A tickets now use a collision-proof external ID
-- namespace. Keep the provider questionId numeric in the outbound payload,
-- while giving the legacy exact-ticket fence the canonical namespaced ID only
-- inside this transaction.
alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) rename to sellerpilot_31033000_enqueue_inquiry_reply_unsafe;

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
  v_question_id text;
  v_expected_external_ticket_id text;
  v_actual_external_ticket_id text;
  v_delegated_payload jsonb;
  v_job_id uuid;
  v_reply_fingerprint text;
  v_ticket_provider_status text;
  v_ticket_latest_inbound_key text;
begin
  select ticket.provider_status, ticket.latest_inbound_key
    into v_ticket_provider_status, v_ticket_latest_inbound_key
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and ticket.channel_key = p_channel
     and not ticket.demo
   for update;
  if not found then raise exception 'inquiry reply ticket not found'; end if;
  if v_ticket_provider_status <> 'waiting' then
    raise exception 'PROVIDER_INQUIRY_NOT_WAITING';
  end if;
  if nullif(p_request_payload->>'sellerpilotExpectedInboundKey', '') is distinct from v_ticket_latest_inbound_key then
    raise exception 'INQUIRY_CONTEXT_STALE';
  end if;
  if v_ticket_latest_inbound_key is null
     or not exists (
       select 1
         from sellerpilot_private.support_inbound_messages message
        where message.ticket_id = p_ticket_id
          and message.channel_key = p_channel
          and message.inbound_key = v_ticket_latest_inbound_key
          and message.sender_role = 'customer'
     ) then
    raise exception 'INQUIRY_LATEST_MESSAGE_UNBOUND';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.operation = 'inquiries.reply'
       and job.channel = p_channel
       and job.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.request_payload->>'sellerpilotInboundKey' is distinct from v_ticket_latest_inbound_key
  ) or exists (
    select 1
      from sellerpilot_private.support_reply_attempts attempt
     where attempt.ticket_id = p_ticket_id
       and attempt.status in ('preparing', 'sending', 'reconciliation_required')
  ) then
    raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED';
  end if;

  if p_channel <> 'smartstore' then
    return public.sellerpilot_31033000_enqueue_inquiry_reply_unsafe(
      p_ticket_id, p_channel, p_reply_text, p_request_payload
    );
  end if;

  if p_ticket_id is null
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object' then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  v_arguments := p_request_payload->'arguments';
  if (v_arguments ? 'kind' and jsonb_typeof(v_arguments->'kind') <> 'string')
     or coalesce(nullif(v_arguments->>'kind', ''), 'product') not in ('product', 'customer') then
    raise exception 'SMARTSTORE_INQUIRY_REPLY_KIND_INVALID';
  end if;
  v_kind := coalesce(nullif(v_arguments->>'kind', ''), 'product');
  if v_kind <> 'product' then
    v_job_id := public.sellerpilot_31033000_enqueue_inquiry_reply_unsafe(
      p_ticket_id, p_channel, p_reply_text, p_request_payload
    );
    select job.request_payload->>'sellerpilotReplyFingerprint'
      into v_reply_fingerprint
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_job_id
       and job.channel = 'smartstore'
       and job.operation = 'inquiries.reply'
     for update;
    if v_reply_fingerprint is null then raise exception 'inquiry reply ticket ledger mismatch'; end if;
    update sellerpilot_private.channel_gateway_jobs job
       set request_payload = job.request_payload || jsonb_build_object(
         'sellerpilotInboundKey', v_ticket_latest_inbound_key
       ),
           status = job.status
     where job.id = v_job_id;
    return v_job_id;
  end if;

  v_question_id := v_arguments->>'questionId';
  if coalesce(v_question_id, '') !~ '^[1-9][0-9]{0,18}$'
     or v_arguments ? 'inquiryNo' then
    raise exception 'SMARTSTORE_PRODUCT_INQUIRY_REPLY_ID_MISMATCH';
  end if;
  v_expected_external_ticket_id := 'smartstore:product-qna:' || v_question_id;

  select ticket.external_ticket_id
    into v_actual_external_ticket_id
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and ticket.channel_key = 'smartstore'
     and not ticket.demo
   for update;
  if not found then raise exception 'inquiry reply ticket not found'; end if;
  if v_actual_external_ticket_id is distinct from v_expected_external_ticket_id then
    raise exception 'inquiry reply ticket payload mismatch';
  end if;

  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'smartstore'
       and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;

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
       'sellerpilotInboundKey', v_ticket_latest_inbound_key,
       'sellerpilotReplyFingerprint', v_reply_fingerprint
     )
   where job.id = v_job_id
     and job.channel = 'smartstore'
     and job.operation = 'inquiries.reply';
  if not found then raise exception 'inquiry reply ticket ledger mismatch'; end if;

  return v_job_id;
end;
$$;

revoke all on function sellerpilot_private.sync_inquiry_reply_delivery_ledger()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_31033000_enqueue_inquiry_reply_unsafe(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  from public, anon;
revoke all on function public.sellerpilot_get_inquiry_reply_delivery(uuid, uuid)
  from public, anon;
revoke all on function public.sellerpilot_get_cs_workspace_snapshot()
  from public, anon;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  to authenticated;
grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid, uuid)
  to authenticated;
grant execute on function public.sellerpilot_get_cs_workspace_snapshot()
  to authenticated;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  to service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) is
  'Queues exact-bound replies; Smartstore product Q&A stores a namespaced ticket ID while sending the exact numeric provider questionId.';

-- Re-check the inbound generation at the final provider-mutation boundary.
-- A worker may have claimed generation A immediately before generation B was
-- ingested; that stale job must never reach the marketplace write.
create or replace function sellerpilot_private.gateway_job_requires_reconciliation(
  p_operation text,
  p_credential_refresh_in_flight boolean,
  p_prepared_credential_id uuid,
  p_credential_refresh_recovery_vault_id uuid,
  p_oauth_exchange_completed boolean,
  p_provider_mutation_started_at timestamptz
)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_credential_refresh_in_flight, false)
    or p_credential_refresh_recovery_vault_id is not null
    or p_provider_mutation_started_at is not null
    or (p_operation = 'oauth.exchange' and p_prepared_credential_id is not null
      and not coalesce(p_oauth_exchange_completed, false))
    or p_operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update',
      'shipment.acknowledge', 'shipment.confirm'
    )
$$;
revoke all on function sellerpilot_private.gateway_job_requires_reconciliation(
  text,boolean,uuid,uuid,boolean,timestamptz
) from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid)
  rename to sellerpilot_31033000_begin_gateway_provider_mutation_unsafe;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.operation, job.status, job.request_payload, job.provider_mutation_started_at, ticket.latest_inbound_key
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    left join sellerpilot_private.support_tickets ticket
      on ticket.id = case when coalesce(job.request_payload->>'sellerpilotTicketId', '')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (job.request_payload->>'sellerpilotTicketId')::uuid else null end
   where job.id = p_job_id
   for update of job;
  if not found then return false; end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs owned
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = owned.worker_token_id
     where owned.id = p_job_id
       and owned.claim_token = p_claim_token
       and owned.status = 'running'
       and owned.lease_expires_at > clock_timestamp()
       and token.token_hash = p_token_hash
       and token.scope in ('gateway', 'legacy_combined')
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
  ) then raise exception 'invalid worker token' using errcode = '42501'; end if;
  if v_job.operation = 'inquiries.reply' then
    perform 1 from sellerpilot_private.support_tickets ticket
     where ticket.id = (v_job.request_payload->>'sellerpilotTicketId')::uuid for update;
    select ticket.latest_inbound_key into v_job.latest_inbound_key
      from sellerpilot_private.support_tickets ticket
     where ticket.id = (v_job.request_payload->>'sellerpilotTicketId')::uuid;
  end if;
  if v_job.operation = 'inquiries.reply'
     and nullif(v_job.request_payload->>'sellerpilotInboundKey', '')
       is distinct from v_job.latest_inbound_key then
    update sellerpilot_private.channel_gateway_jobs
       set status = case when v_job.provider_mutation_started_at is null then 'cancelled' else 'reconciliation_required' end,
           error_message = 'Inquiry reply generation changed before provider mutation.',
           completed_at = now(), lease_expires_at = null, worker_token_id = null, claim_token = null
     where id = p_job_id and status = 'running';
    return false;
  end if;
  return public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

do $serverless_cs_generation_fence$
begin
  if to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe';
  execute $create$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text, p_job_id uuid, p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path = '' as $fn$
    declare v_job record;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.operation, job.status, job.request_payload, job.provider_mutation_started_at, ticket.latest_inbound_key into v_job
        from sellerpilot_private.channel_gateway_jobs job
        left join sellerpilot_private.support_tickets ticket
          on ticket.id = case when coalesce(job.request_payload->>'sellerpilotTicketId', '')
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (job.request_payload->>'sellerpilotTicketId')::uuid else null end
       where job.id = p_job_id for update of job;
      if not found then return false; end if;
      if not sellerpilot_private.serverless_cs_job_is_owned(p_token_hash, p_job_id, p_claim_token, true) then
        raise exception 'invalid worker token' using errcode = '42501';
      end if;
      if v_job.operation = 'inquiries.reply' then
        perform 1 from sellerpilot_private.support_tickets ticket
         where ticket.id = (v_job.request_payload->>'sellerpilotTicketId')::uuid for update;
        select ticket.latest_inbound_key into v_job.latest_inbound_key
          from sellerpilot_private.support_tickets ticket
         where ticket.id = (v_job.request_payload->>'sellerpilotTicketId')::uuid;
      end if;
      if v_job.operation = 'inquiries.reply'
         and nullif(v_job.request_payload->>'sellerpilotInboundKey', '') is distinct from v_job.latest_inbound_key then
        update sellerpilot_private.channel_gateway_jobs
           set status = case when v_job.provider_mutation_started_at is null then 'cancelled' else 'reconciliation_required' end,
               error_message = 'Inquiry reply generation changed before provider mutation.',
               completed_at = now(), lease_expires_at = null, worker_token_id = null, claim_token = null
         where id = p_job_id and status = 'running';
        return false;
      end if;
      return public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(p_token_hash, p_job_id, p_claim_token);
    end; $fn$
  $create$;
end;
$serverless_cs_generation_fence$;

revoke all on function public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid) to service_role;
revoke all on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public, anon, authenticated;
do $serverless_cs_generation_privileges$
begin
  if to_regprocedure('public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)') is not null then
    execute 'revoke all on function public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid) from public,anon,authenticated,service_role';
    execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) from public,anon,authenticated';
    execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role';
  end if;
end;
$serverless_cs_generation_privileges$;

-- The UI lock is advisory. Enforce the same delivery fence at the canonical
-- ticket mutation RPC so stale tabs and direct authenticated callers cannot
-- mark a remote conversation resolved before provider success is durable.
alter function public.sellerpilot_update_ticket(uuid, text, text)
  rename to sellerpilot_31033000_update_ticket_unsafe;

create function public.sellerpilot_update_ticket(
  p_id uuid,
  p_status text,
  p_reply_draft text,
  p_expected_inbound_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
begin
  if not public.sellerpilot_is_admin()
     or p_status not in ('urgent', 'waiting', 'in_progress', 'resolved') then
    raise exception 'invalid ticket update' using errcode = '42501';
  end if;

  select ticket.*
    into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_id
   for update;
  if not found then return false; end if;
  if nullif(p_expected_inbound_key, '') is distinct from v_ticket.latest_inbound_key then
    raise exception 'INQUIRY_CONTEXT_STALE' using errcode = '55000';
  end if;

  if (
       v_ticket.reply_delivery_status in ('preparing', 'sending')
       and not (
         p_status = 'resolved'
         and v_ticket.provider_status in ('answered', 'closed')
         and exists (
           select 1 from sellerpilot_private.support_reply_deliveries delivery
            where delivery.ticket_id = p_id
              and delivery.status = 'reconciliation_required'
              and delivery.acknowledged_at is null
         )
       )
     ) or exists (
       select 1
         from sellerpilot_private.support_reply_deliveries delivery
        where delivery.ticket_id = p_id
          and delivery.status in ('queued', 'running')
          and delivery.acknowledged_at is null
     )
     or (
       exists (
         select 1 from sellerpilot_private.support_reply_deliveries delivery
          where delivery.ticket_id = p_id and delivery.status = 'reconciliation_required'
            and delivery.acknowledged_at is null
       )
       and not (p_status = 'resolved' and v_ticket.provider_status in ('answered', 'closed'))
     ) then
    raise exception 'CS_DELIVERY_LOCKED' using errcode = '55000';
  end if;

  if p_status = 'resolved' and v_ticket.provider_status in ('answered', 'closed') then
    update sellerpilot_private.support_reply_deliveries delivery
       set acknowledged_at = now(), acknowledged_by = auth.uid(),
           acknowledgement_reason = 'provider_status:' || v_ticket.provider_status,
           updated_at = now()
     where delivery.ticket_id = p_id and delivery.status = 'reconciliation_required'
       and delivery.acknowledged_at is null;
    if found then
      update sellerpilot_private.support_tickets ticket
         set reply_delivery_status = 'never',
             reply_delivery_error = null,
             last_delivery_job_id = null,
             updated_at = now()
       where ticket.id = p_id;
      insert into sellerpilot_private.operation_audit(owner_id, action, entity_type, entity_id, safe_detail)
      values (v_ticket.owner_id, 'cs_delivery_provider_acknowledged', 'support_ticket', p_id::text,
        jsonb_build_object('provider_status', v_ticket.provider_status, 'latest_inbound_key', v_ticket.latest_inbound_key));
    end if;
  end if;

  if p_status = 'resolved'
     and v_ticket.channel_key in ('qoo10', 'lazada', 'coupang', 'smartstore', 'ebay')
     and v_ticket.provider_status not in ('answered', 'closed')
     and not exists (
       select 1
         from sellerpilot_private.support_reply_deliveries delivery
         join sellerpilot_private.channel_gateway_jobs job
           on job.id = delivery.gateway_job_id
          and job.operation = 'inquiries.reply'
          and job.channel = v_ticket.channel_key
          and job.request_payload->>'sellerpilotTicketId' = p_id::text
          and job.request_payload->>'sellerpilotInboundKey' = v_ticket.latest_inbound_key
        where delivery.ticket_id = p_id
          and delivery.gateway_job_id = v_ticket.last_delivery_job_id
          and delivery.status = 'succeeded'
          and job.status = 'succeeded'
          and job.response_payload @> '{"ok":true}'::jsonb
     ) then
    raise exception 'REMOTE_REPLY_SUCCESS_REQUIRED' using errcode = '55000';
  end if;

  return public.sellerpilot_31033000_update_ticket_unsafe(
    p_id, p_status, p_reply_draft
  );
end;
$$;

revoke all on function public.sellerpilot_31033000_update_ticket_unsafe(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_update_ticket(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_update_ticket(uuid, text, text, text)
  to authenticated;

-- Bind AI support drafts to the buyer message that the operator reviewed.
alter function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text)
  rename to sellerpilot_31033000_create_support_reply_job_unsafe;
create function public.sellerpilot_create_support_reply_job(
  p_id uuid, p_ticket_id uuid, p_expected_inbound_key text,
  p_target_locale text, p_tone text default 'polite'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_current_key text; v_job_id uuid;
begin
  select ticket.latest_inbound_key into v_current_key
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id and ticket.owner_id = auth.uid() and not ticket.demo
   for update;
  if not found then raise exception 'support ticket not found'; end if;
  if nullif(p_expected_inbound_key, '') is distinct from v_current_key then
    raise exception 'INQUIRY_CONTEXT_STALE' using errcode = '55000';
  end if;
  v_job_id := public.sellerpilot_31033000_create_support_reply_job_unsafe(
    p_id, p_ticket_id, p_target_locale, p_tone
  );
  update sellerpilot_private.ai_cli_jobs job
     set request_payload = job.request_payload || jsonb_build_object('sellerpilotInboundKey', v_current_key)
   where job.id = v_job_id and job.kind = 'support_reply';
  return v_job_id;
end;
$$;
revoke all on function public.sellerpilot_31033000_create_support_reply_job_unsafe(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  from public,anon;
grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  to authenticated;

alter function public.sellerpilot_complete_ai_job(text,uuid,uuid,text,jsonb,text)
  rename to sellerpilot_31033000_complete_ai_job_unsafe;
create function public.sellerpilot_complete_ai_job(
  p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text,
  p_result_payload jsonb default null, p_error_message text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_job record; v_current_inbound_key text; v_ticket_id uuid;
begin
  select job.kind, job.request_payload into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
   for update;
  if v_job.kind = 'support_reply'
     and coalesce(v_job.request_payload->>'ticket_id', '')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_ticket_id := (v_job.request_payload->>'ticket_id')::uuid;
    select ticket.latest_inbound_key into v_current_inbound_key
      from sellerpilot_private.support_tickets ticket
     where ticket.id = v_ticket_id
     for update;
  end if;
  if v_job.kind = 'support_reply' and p_status = 'succeeded'
     and nullif(v_job.request_payload->>'sellerpilotInboundKey', '')
       is distinct from v_current_inbound_key then
    return public.sellerpilot_31033000_complete_ai_job_unsafe(
      p_token_hash, p_job_id, p_claim_token, 'failed', null,
      '새 고객 메시지가 도착해 이전 문의의 AI 답변 초안을 폐기했습니다.'
    );
  end if;
  return public.sellerpilot_31033000_complete_ai_job_unsafe(
    p_token_hash,p_job_id,p_claim_token,p_status,p_result_payload,p_error_message
  );
end;
$$;
revoke all on function public.sellerpilot_31033000_complete_ai_job_unsafe(text,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_complete_ai_job(text,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_complete_ai_job(text,uuid,uuid,text,jsonb,text)
  to service_role;

-- The worker completion route uses the image-context RPC for every job kind,
-- including support_reply. Route that kind through the same generation CAS;
-- image-producing jobs retain the predecessor's receipt/context semantics.
alter function public.sellerpilot_complete_ai_job_with_image_context(
  text,uuid,uuid,text,jsonb,text,jsonb
) rename to sellerpilot_31033000_complete_ai_job_with_image_context_unsafe;
create function public.sellerpilot_complete_ai_job_with_image_context(
  p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text,
  p_result_payload jsonb default null, p_error_message text default null,
  p_terminal_image_failure_context jsonb default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  select job.kind into v_kind
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id;
  if v_kind = 'support_reply' then
    if p_terminal_image_failure_context is not null then
      raise exception 'terminal image failure context is not allowed for this job kind';
    end if;
    return public.sellerpilot_complete_ai_job(
      p_token_hash, p_job_id, p_claim_token, p_status,
      p_result_payload, p_error_message
    );
  end if;
  return public.sellerpilot_31033000_complete_ai_job_with_image_context_unsafe(
    p_token_hash, p_job_id, p_claim_token, p_status,
    p_result_payload, p_error_message, p_terminal_image_failure_context
  );
end;
$$;
revoke all on function public.sellerpilot_31033000_complete_ai_job_with_image_context_unsafe(
  text,uuid,uuid,text,jsonb,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_complete_ai_job_with_image_context(
  text,uuid,uuid,text,jsonb,text,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_complete_ai_job_with_image_context(
  text,uuid,uuid,text,jsonb,text,jsonb
) to service_role;

-- The original retention routine predates the message and delivery ledgers.
-- Delete CS message bodies and provider identifiers before pruning terminal
-- gateway jobs; the minimal delivery outcome remains auditable after its job
-- foreign key is cleared by ON DELETE SET NULL.
create or replace function public.sellerpilot_prune_personal_data(
  p_completed_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke all on function public.sellerpilot_prune_personal_data(timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_prune_personal_data(timestamptz)
  to service_role;

commit;
