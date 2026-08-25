-- Bind every marketplace inquiry reply to the credential lineage that
-- collected the customer message. Existing unbound tickets remain visible but
-- cannot be sent until a fresh provider sync proves their source credential.

begin;

alter table sellerpilot_private.support_tickets
  add column if not exists source_credential_id uuid,
  add column if not exists seller_account_key text,
  add column if not exists reply_context jsonb not null default '{}'::jsonb,
  add column if not exists reply_gateway_job_id uuid;

alter table sellerpilot_private.support_tickets
  drop constraint if exists support_tickets_source_lineage_check;
alter table sellerpilot_private.support_tickets
  add constraint support_tickets_source_lineage_check check (
    (source_credential_id is null and seller_account_key is null)
    or (
      source_credential_id is not null
      and seller_account_key ~ '^[a-f0-9]{64}$'
    )
  );
alter table sellerpilot_private.support_tickets
  drop constraint if exists support_tickets_reply_context_check;
alter table sellerpilot_private.support_tickets
  add constraint support_tickets_reply_context_check check (
    jsonb_typeof(reply_context) = 'object'
    and octet_length(reply_context::text) <= 8192
  );
alter table sellerpilot_private.support_tickets
  drop constraint if exists support_tickets_single_reply_ledger_check;
alter table sellerpilot_private.support_tickets
  add constraint support_tickets_single_reply_ledger_check check (
    not (
      reply_operation_attempt_id is not null
      and reply_gateway_job_id is not null
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'support_tickets_source_credential_fkey'
       and conrelid = 'sellerpilot_private.support_tickets'::regclass
  ) then
    alter table sellerpilot_private.support_tickets
      add constraint support_tickets_source_credential_fkey
      foreign key (source_credential_id)
      references sellerpilot_private.channel_credentials(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'support_tickets_reply_gateway_job_fkey'
       and conrelid = 'sellerpilot_private.support_tickets'::regclass
  ) then
    alter table sellerpilot_private.support_tickets
      add constraint support_tickets_reply_gateway_job_fkey
      foreign key (reply_gateway_job_id)
      references sellerpilot_private.channel_gateway_jobs(id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists support_tickets_one_reply_gateway_job_idx
  on sellerpilot_private.support_tickets (reply_gateway_job_id)
  where reply_gateway_job_id is not null;

do $$
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation = 'inquiries.reply'
       and j.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'active inquiry reply jobs must drain before account-lineage rollout';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation = 'inquiries.reply'
       and (
         j.status = 'reconciliation_required'
         or (j.status = 'succeeded' and j.response_payload @> '{"ok":true}'::jsonb)
       )
  ) then
    -- The pre-lineage gateway selected the latest channel credential and did
    -- not prove a ticket/account binding. Never infer that a historical remote
    -- acknowledgement belongs to the ticket named in mutable request metadata.
    raise exception 'historical inquiry reply jobs require manual reconciliation';
  end if;
  if exists (
    select 1
      from sellerpilot_private.support_reply_attempts legacy
     where legacy.status in ('preparing', 'sending', 'reconciliation_required')
  ) then
    raise exception 'active legacy inquiry replies require manual reconciliation';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation = 'inquiries.reply'
       and j.request_payload->>'sellerpilotTicketId' is not null
       and (
         j.status in ('queued', 'running', 'reconciliation_required')
         or (j.status = 'succeeded' and j.response_payload @> '{"ok":true}'::jsonb)
       )
     group by j.request_payload->>'sellerpilotTicketId'
    having count(*) > 1
  ) then
    raise exception 'duplicate inquiry reply jobs require manual reconciliation';
  end if;
  if exists (
    select 1
      from sellerpilot_private.support_reply_attempts legacy
      join sellerpilot_private.channel_gateway_jobs gateway
        on gateway.request_payload->>'sellerpilotTicketId' = legacy.ticket_id::text
     where legacy.status in ('preparing', 'sending', 'reconciliation_required', 'succeeded')
       and (
         gateway.status in ('queued', 'running', 'reconciliation_required')
         or (gateway.status = 'succeeded' and gateway.response_payload @> '{"ok":true}'::jsonb)
       )
  ) then
    raise exception 'legacy and gateway inquiry reply ledgers require manual reconciliation';
  end if;
end
$$;

create or replace function sellerpilot_private.guard_support_ticket_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
begin
  if tg_op = 'UPDATE'
     and old.seller_account_key is not null
     and new.seller_account_key is distinct from old.seller_account_key then
    raise exception 'support ticket seller lineage is immutable';
  end if;

  if new.source_credential_id is null then
    if new.seller_account_key is not null then
      raise exception 'support ticket credential lineage is incomplete';
    end if;
    return new;
  end if;

  select c.id, c.channel, c.created_by, c.seller_account_key,
         c.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = new.source_credential_id;
  if not found
     or v_credential.channel <> new.channel_key
     or v_credential.created_by <> new.owner_id
     or v_credential.seller_account_key is null
     or v_credential.seller_account_key_source not in ('provider_certified_v1', 'credential_incarnation_v1')
     or (
       new.channel_key = 'lazada'
       and v_credential.seller_account_key_source <> 'provider_certified_v1'
     )
     or v_credential.seller_account_key is distinct from new.seller_account_key then
    raise exception 'support ticket credential lineage mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_support_ticket_seller_lineage
  on sellerpilot_private.support_tickets;
create trigger guard_support_ticket_seller_lineage
before insert or update of source_credential_id, seller_account_key, owner_id, channel_key
on sellerpilot_private.support_tickets
for each row execute function sellerpilot_private.guard_support_ticket_seller_lineage();

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

    select t.seller_account_key
      into v_existing_key
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
      case when v_status = 'resolved' then now() else null end,
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
          then coalesce(sellerpilot_private.support_tickets.resolved_at, now())
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

create or replace function public.sellerpilot_get_ticket_reply_dispatch_context(p_id uuid)
returns table(
  id uuid,
  external_ticket_id text,
  channel_key text,
  status text,
  reply_context jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.external_ticket_id, t.channel_key, t.status, t.reply_context
    from sellerpilot_private.support_tickets t
   where auth.uid() is not null
     and public.sellerpilot_is_admin()
     and t.id = p_id
     and not t.demo
   limit 1
$$;

alter function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) rename to sellerpilot_enqueue_channel_gateway_job_pre_dedicated_reply;

create function public.sellerpilot_enqueue_channel_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_operation = 'inquiries.reply' then
    raise exception 'DEDICATED_INQUIRY_REPLY_ENQUEUE_REQUIRED';
  end if;
  return public.sellerpilot_enqueue_channel_gateway_job_pre_dedicated_reply(
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
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
  v_expected_ticket text;
  v_parent_answer_id text;
begin
  if p_channel not in ('qoo10', 'lazada', 'coupang', 'smartstore')
     or v_reply is null
     or length(v_reply) > 4000
     or (p_channel = 'coupang' and length(v_reply) not between 2 and 1000)
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  if p_channel = 'lazada' then
    perform public.sellerpilot_service_sweep_stale_lazada_replies();
  end if;

  select t.* into v_ticket
    from sellerpilot_private.support_tickets t
   where t.id = p_ticket_id
     and not t.demo
   for update;
  if not found or v_ticket.channel_key <> p_channel then
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
     or v_source_credential.channel <> p_channel
     or v_source_credential.created_by <> v_ticket.owner_id
     or v_source_credential.seller_account_key_source not in ('provider_certified_v1', 'credential_incarnation_v1')
     or (
       p_channel = 'lazada'
       and v_source_credential.seller_account_key_source <> 'provider_certified_v1'
     )
     or v_source_credential.seller_account_key is distinct from v_ticket.seller_account_key then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  v_payload_reply := nullif(trim(case
    when p_channel = 'qoo10'
      then p_request_payload#>>'{arguments,params,contents}'
    else p_request_payload#>>'{arguments,reply}'
  end), '');
  if v_payload_reply is distinct from v_reply then
    raise exception 'inquiry reply payload mismatch';
  end if;

  v_expected_ticket := case p_channel
    when 'qoo10' then format(
      'qoo10:%s:%s:%s',
      upper(coalesce(p_request_payload#>>'{arguments,params,inq_type}', '')),
      coalesce(p_request_payload#>>'{arguments,params,question_no}', ''),
      coalesce(p_request_payload#>>'{arguments,params,seq_no}', '')
    )
    when 'lazada' then
      'lazada-im:' || coalesce(p_request_payload#>>'{arguments,sessionId}', '')
    when 'coupang' then
      coalesce(p_request_payload#>>'{arguments,kind}', '')
        || ':' || coalesce(p_request_payload#>>'{arguments,inquiryId}', '')
    when 'smartstore' then
      coalesce(p_request_payload#>>'{arguments,questionId}', '')
  end;
  if v_expected_ticket is distinct from v_ticket.external_ticket_id then
    raise exception 'inquiry reply ticket payload mismatch';
  end if;

  if p_channel = 'coupang'
     and p_request_payload#>>'{arguments,kind}' = 'call-center' then
    v_parent_answer_id := p_request_payload#>>'{arguments,parentAnswerId}';
    if coalesce(v_parent_answer_id, '') !~ '^[1-9][0-9]*$'
       or v_parent_answer_id is distinct from v_ticket.reply_context->>'parentAnswerId' then
      raise exception 'inquiry reply parent answer mismatch';
    end if;
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
   where c.channel = p_channel
     and c.environment = v_source_credential.environment
     and c.created_by = v_ticket.owner_id
     and c.seller_account_key = v_ticket.seller_account_key
     and c.seller_account_key_source in ('provider_certified_v1', 'credential_incarnation_v1')
     and (p_channel <> 'lazada' or c.seller_account_key_source = 'provider_certified_v1')
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
    p_channel,
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
begin
  if old.operation <> 'inquiries.reply' then return new; end if;

  begin
    v_ticket_id := nullif(new.request_payload->>'sellerpilotTicketId', '')::uuid;
  exception when others then
    v_ticket_id := null;
  end;

  if old.status = 'running'
     and (old.lease_expires_at is null or old.lease_expires_at <= now())
     and new.status in ('queued', 'failed') then
    new.status := 'reconciliation_required';
    new.error_message := 'Inquiry reply worker lease expired; provider outcome requires reconciliation.';
    new.completed_at := now();
  end if;

  if v_ticket_id is null then
    if old.status = 'running'
       and new.status in ('succeeded', 'failed', 'reconciliation_required') then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply ticket metadata is missing; provider outcome requires reconciliation.';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if old.status = 'queued' and new.status = 'running' then
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'sending',
           reply_delivery_error = null,
           updated_at = now()
     where t.id = v_ticket_id
       and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel
       and t.seller_account_key = new.seller_account_key;
    if not found then raise exception 'inquiry reply ticket ledger mismatch'; end if;
    return new;
  end if;

  if new.status = 'failed' then
    v_error := left(coalesce(
      nullif(trim(new.error_message), ''),
      '판매채널 답변을 전송하지 못했습니다.'
    ), 1000);
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'failed',
           reply_delivery_error = v_error,
           updated_at = now()
     where t.id = v_ticket_id
       and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel
       and t.seller_account_key = new.seller_account_key;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 and old.status = 'running' then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply reached a terminal provider result but its ticket ledger no longer matches.';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if new.status = 'reconciliation_required' then
    v_error := left(coalesce(
      nullif(trim(new.error_message), ''),
      '판매채널 답변 접수 여부를 수동 확인해야 합니다.'
    ), 1000);
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'reconciliation_required',
           reply_delivery_error = v_error,
           updated_at = now()
     where t.id = v_ticket_id
       and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel
       and t.seller_account_key = new.seller_account_key;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      new.error_message := 'Inquiry reply requires reconciliation and its ticket ledger no longer matches.';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if old.status = 'running'
     and new.status = 'succeeded'
     and new.response_payload @> '{"ok":false}'::jsonb then
    v_error := left(coalesce(
      nullif(trim(new.response_payload->>'safeMessage'), ''),
      nullif(trim(new.error_message), ''),
      '판매채널에서 답변을 거절했습니다.'
    ), 1000);
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'failed',
           reply_delivery_error = v_error,
           updated_at = now()
     where t.id = v_ticket_id
       and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel
       and t.seller_account_key = new.seller_account_key;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was rejected remotely but its ticket ledger no longer matches.';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if old.status = 'running'
     and new.status = 'succeeded'
     and not (new.response_payload @> '{"ok":true}'::jsonb) then
    new.status := 'reconciliation_required';
    new.error_message := 'Inquiry reply completion did not include a trustworthy provider acknowledgement.';
    new.completed_at := now();
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'reconciliation_required',
           reply_delivery_error = '판매채널 답변 결과를 확정할 수 없어 수동 확인이 필요합니다.',
           updated_at = now()
     where t.id = v_ticket_id
       and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel
       and t.seller_account_key = new.seller_account_key;
    return new;
  end if;

  if old.status = 'running'
     and new.status = 'succeeded'
     and new.response_payload @> '{"ok":true}'::jsonb then
    v_reply := nullif(trim(case
      when new.channel = 'qoo10'
        then new.request_payload#>>'{arguments,params,contents}'
      else new.request_payload#>>'{arguments,reply}'
    end), '');
    v_expected_fingerprint := nullif(
      new.request_payload->>'sellerpilotReplyFingerprint',
      ''
    );
    if v_reply is not null then
      v_actual_fingerprint := encode(
        extensions.digest(v_reply, 'sha256'),
        'hex'
      );
    end if;

    if v_reply is null
       or v_expected_fingerprint is null
       or v_actual_fingerprint is distinct from v_expected_fingerprint then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was accepted remotely but its ticket ledger metadata failed integrity validation.';
      new.completed_at := now();
      update sellerpilot_private.support_tickets t
         set reply_delivery_status = 'reconciliation_required',
             reply_delivery_error = '판매채널 답변은 접수됐으나 내부 원장 무결성을 확인해야 합니다.',
             updated_at = now()
       where t.id = v_ticket_id
         and t.reply_gateway_job_id = new.id
         and t.channel_key = new.channel
         and t.seller_account_key = new.seller_account_key;
      return new;
    end if;

    update sellerpilot_private.support_tickets t
       set status = 'resolved',
           reply_draft = left(v_reply, 8000),
           resolved_at = coalesce(t.resolved_at, now()),
           reply_delivery_status = 'succeeded',
           reply_delivery_error = null,
           updated_at = now()
     where t.id = v_ticket_id
       and t.reply_gateway_job_id = new.id
       and t.channel_key = new.channel
       and t.seller_account_key = new.seller_account_key
    returning t.owner_id into v_owner_id;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      new.status := 'reconciliation_required';
      new.error_message := 'Inquiry reply was accepted remotely but its ticket ledger no longer matches.';
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

create unique index if not exists channel_gateway_jobs_one_terminal_or_active_reply_idx
  on sellerpilot_private.channel_gateway_jobs (
    (request_payload->>'sellerpilotTicketId')
  )
  where operation = 'inquiries.reply'
    and request_payload->>'sellerpilotTicketId' is not null
    and (
      status in ('queued', 'running', 'reconciliation_required')
      or (status = 'succeeded' and response_payload @> '{"ok":true}'::jsonb)
    );

alter function public.sellerpilot_get_operations_snapshot()
  rename to sellerpilot_get_operations_snapshot_pre_reply_gateway_link;

create function public.sellerpilot_get_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_tickets jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_get_operations_snapshot_pre_reply_gateway_link();
  select coalesce(jsonb_agg(
    ticket_row.value || jsonb_build_object(
      'replyGatewayJobId',
      ticket.reply_gateway_job_id
    ) order by ticket_row.ordinality
  ), '[]'::jsonb)
    into v_tickets
    from jsonb_array_elements(coalesce(v_result->'tickets', '[]'::jsonb))
      with ordinality ticket_row(value, ordinality)
    join sellerpilot_private.support_tickets ticket
      on ticket.id::text = ticket_row.value->>'id';
  return jsonb_set(v_result, '{tickets}', v_tickets, true);
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job_pre_dedicated_reply(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) to service_role;

revoke all on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
  to service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;
revoke all on function public.sellerpilot_get_ticket_reply_dispatch_context(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_ticket_reply_dispatch_context(uuid)
  to authenticated;
revoke all on function public.sellerpilot_get_operations_snapshot()
  from public, anon;
grant execute on function public.sellerpilot_get_operations_snapshot()
  to authenticated;
revoke all on function public.sellerpilot_service_claim_lazada_reply(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_begin_lazada_reply(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_complete_lazada_reply(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.guard_support_ticket_seller_lineage()
  from public, anon, authenticated;
revoke all on function sellerpilot_private.guard_and_finalize_inquiry_reply_job()
  from public, anon, authenticated;

commit;
