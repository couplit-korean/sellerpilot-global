-- Fence direct logistics and CS message mutations before the provider call.
-- A transport timeout or response-ledger failure is provider-uncertain and is
-- quarantined instead of becoming an ordinary retryable failure.

begin;

alter table sellerpilot_private.logistics_operation_attempts
  add column if not exists resource_key text,
  add column if not exists mutation_started_at timestamptz,
  add column if not exists reconciliation_required_at timestamptz;

alter table sellerpilot_private.logistics_operation_attempts
  drop constraint if exists logistics_operation_attempts_status_check;
alter table sellerpilot_private.logistics_operation_attempts
  add constraint logistics_operation_attempts_status_check
  check (status in ('running', 'succeeded', 'failed', 'reconciliation_required'));
alter table sellerpilot_private.logistics_operation_attempts
  drop constraint if exists logistics_operation_attempts_resource_key_check;
alter table sellerpilot_private.logistics_operation_attempts
  add constraint logistics_operation_attempts_resource_key_check check (
    (operation not in ('orders.cancel', 'inquiries.reply')
      and resource_key is null and mutation_started_at is null and reconciliation_required_at is null)
    or
    (operation in ('orders.cancel', 'inquiries.reply')
      and resource_key ~ '^[a-f0-9]{64}$')
    or
    -- Historical terminal rows predate the resource identity. They remain
    -- immutable evidence but can never be resumed through the current claim.
    (operation in ('orders.cancel', 'inquiries.reply')
      and resource_key is null
      and status in ('succeeded', 'failed', 'reconciliation_required')
      and mutation_started_at is null)
  ) not valid;

-- A legacy running write may already have reached TracX. It has no durable
-- pre-call marker, so quarantine it instead of inferring that it is safe.
update sellerpilot_private.logistics_operation_attempts
   set status = 'reconciliation_required',
       safe_message = '이전 버전 SmartShip 원격 쓰기의 결과를 수동 확인해야 합니다.',
       reconciliation_required_at = now(),
       completed_at = null
 where operation in ('orders.cancel', 'inquiries.reply')
   and status = 'running'
   and resource_key is null;

alter table sellerpilot_private.logistics_operation_attempts
  validate constraint logistics_operation_attempts_resource_key_check;

create unique index if not exists logistics_attempts_one_unresolved_resource_idx
  on sellerpilot_private.logistics_operation_attempts (resource_key)
  where resource_key is not null
    and status in ('running', 'reconciliation_required');

create or replace function public.sellerpilot_service_sweep_stale_tracx_mutations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prewrite integer := 0;
  v_uncertain integer := 0;
begin
  update sellerpilot_private.logistics_operation_attempts
     set status = 'failed',
         remote_code = 'PREWRITE_EXPIRED',
         safe_message = 'SmartShip 호출 전 중단된 작업입니다. 새 요청으로 다시 실행할 수 있습니다.',
         completed_at = now()
   where operation in ('orders.cancel', 'inquiries.reply')
     and status = 'running'
     and mutation_started_at is null
     and created_at < now() - interval '5 minutes';
  get diagnostics v_prewrite = row_count;

  update sellerpilot_private.logistics_operation_attempts
     set status = 'reconciliation_required',
         remote_code = 'PROVIDER_OUTCOME_UNKNOWN',
         safe_message = 'SmartShip 요청 접수 여부를 확정할 수 없어 수동 확인이 필요합니다.',
         reconciliation_required_at = now(),
         completed_at = null
   where operation in ('orders.cancel', 'inquiries.reply')
     and status = 'running'
     and mutation_started_at is not null
     and mutation_started_at < now() - interval '2 minutes';
  get diagnostics v_uncertain = row_count;

  return jsonb_build_object('prewrite_failed', v_prewrite, 'reconciliation_required', v_uncertain);
end;
$$;

create or replace function public.sellerpilot_service_claim_tracx_mutation(
  p_actor_id uuid,
  p_credential_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_resource_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_fingerprint text;
  v_existing_message text;
  v_existing_code text;
begin
  if p_actor_id is null
     or not exists (select 1 from sellerpilot_private.admin_users a where a.user_id = p_actor_id)
     or p_operation not in ('orders.cancel', 'inquiries.reply')
     or length(trim(coalesce(p_idempotency_key, ''))) not between 16 and 160
     or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_resource_key, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid TracX mutation claim';
  end if;
  perform public.sellerpilot_service_sweep_stale_tracx_mutations();

  perform 1
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'tracx'
     and c.environment = 'production'
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then raise exception 'active TracX credential required'; end if;

  select a.id, a.status, a.request_fingerprint, a.safe_message, a.remote_code
    into v_existing_id, v_existing_status, v_existing_fingerprint, v_existing_message, v_existing_code
    from sellerpilot_private.logistics_operation_attempts a
   where a.provider = 'tracx'
     and a.owner_id = p_actor_id
     and a.idempotency_key = trim(p_idempotency_key)
   for update;
  if found then
    if v_existing_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key reused with different request';
    end if;
    return jsonb_build_object(
      'attempt_id', v_existing_id, 'duplicate', true, 'status', v_existing_status,
      'safe_message', v_existing_message, 'remote_code', v_existing_code
    );
  end if;

  select a.id, a.status, a.safe_message, a.remote_code
    into v_existing_id, v_existing_status, v_existing_message, v_existing_code
    from sellerpilot_private.logistics_operation_attempts a
   where a.resource_key = p_resource_key
     and a.status in ('running', 'reconciliation_required')
   order by case when a.status = 'reconciliation_required' then 0 else 1 end, a.created_at
   for update
   limit 1;
  if found then
    return jsonb_build_object(
      'attempt_id', v_existing_id, 'duplicate', true, 'resource_conflict', true,
      'status', v_existing_status, 'safe_message', coalesce(v_existing_message,
        '같은 SmartShip 원격 대상의 이전 작업이 완료되거나 조정될 때까지 재실행할 수 없습니다.'),
      'remote_code', v_existing_code
    );
  end if;

  insert into sellerpilot_private.logistics_operation_attempts (
    owner_id, credential_id, provider, operation, idempotency_key,
    request_fingerprint, resource_key
  ) values (
    p_actor_id, p_credential_id, 'tracx', p_operation, trim(p_idempotency_key),
    p_request_fingerprint, p_resource_key
  ) returning id into v_id;
  return jsonb_build_object('attempt_id', v_id, 'duplicate', false, 'status', 'running');
end;
$$;

create or replace function public.sellerpilot_service_begin_tracx_mutation(
  p_attempt_id uuid,
  p_request_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
begin
  update sellerpilot_private.logistics_operation_attempts
     set mutation_started_at = now()
   where id = p_attempt_id
     and operation in ('orders.cancel', 'inquiries.reply')
     and status = 'running'
     and mutation_started_at is null
     and request_fingerprint = p_request_fingerprint;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_service_complete_tracx_mutation(
  p_attempt_id uuid,
  p_request_fingerprint text,
  p_outcome text,
  p_remote_code text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
begin
  if p_outcome not in ('succeeded', 'failed', 'reconciliation_required')
     or length(coalesce(p_remote_code, '')) > 80
     or length(coalesce(p_safe_message, '')) not between 1 and 500 then
    raise exception 'invalid TracX mutation completion';
  end if;
  update sellerpilot_private.logistics_operation_attempts
     set status = p_outcome,
         remote_code = nullif(left(coalesce(p_remote_code, ''), 80), ''),
         safe_message = left(p_safe_message, 500),
         reconciliation_required_at = case when p_outcome = 'reconciliation_required' then now() else null end,
         completed_at = case when p_outcome = 'reconciliation_required' then null else now() end
   where id = p_attempt_id
     and operation in ('orders.cancel', 'inquiries.reply')
     and status = 'running'
     and request_fingerprint = p_request_fingerprint
     and (p_outcome = 'failed' or mutation_started_at is not null);
  get diagnostics v_updated = row_count;
  if v_updated = 1 then return true; end if;
  return exists (
    select 1 from sellerpilot_private.logistics_operation_attempts a
     where a.id = p_attempt_id
       and a.request_fingerprint = p_request_fingerprint
       and a.status = p_outcome
  );
end;
$$;

alter table sellerpilot_private.support_tickets
  add column if not exists reply_delivery_status text not null default 'never',
  add column if not exists reply_delivery_error text,
  add column if not exists reply_operation_attempt_id uuid;
alter table sellerpilot_private.support_tickets
  drop constraint if exists support_tickets_reply_delivery_status_check;
alter table sellerpilot_private.support_tickets
  add constraint support_tickets_reply_delivery_status_check
  check (reply_delivery_status in ('never', 'preparing', 'sending', 'succeeded', 'failed', 'reconciliation_required'));

create table if not exists sellerpilot_private.support_reply_attempts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references sellerpilot_private.support_tickets(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel = 'lazada'),
  reply_fingerprint text not null check (reply_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'preparing'
    check (status in ('preparing', 'sending', 'succeeded', 'failed', 'reconciliation_required')),
  safe_message text,
  created_at timestamptz not null default now(),
  mutation_started_at timestamptz,
  completed_at timestamptz,
  reconciliation_required_at timestamptz,
  unique (ticket_id, reply_fingerprint)
);
create unique index if not exists support_reply_attempts_one_unresolved_ticket_idx
  on sellerpilot_private.support_reply_attempts (ticket_id)
  where status in ('preparing', 'sending', 'reconciliation_required');
create index if not exists support_reply_attempts_owner_time_idx
  on sellerpilot_private.support_reply_attempts (owner_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'support_tickets_reply_operation_attempt_fkey'
       and conrelid = 'sellerpilot_private.support_tickets'::regclass
  ) then
    alter table sellerpilot_private.support_tickets
      add constraint support_tickets_reply_operation_attempt_fkey
      foreign key (reply_operation_attempt_id)
      references sellerpilot_private.support_reply_attempts(id)
      on delete set null;
  end if;
end
$$;

alter table sellerpilot_private.support_reply_attempts enable row level security;
revoke all on sellerpilot_private.support_reply_attempts from public, anon, authenticated;

alter function public.sellerpilot_get_operations_snapshot()
  rename to sellerpilot_get_operations_snapshot_pre_reply_delivery;

create or replace function public.sellerpilot_get_operations_snapshot()
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
  v_result := public.sellerpilot_get_operations_snapshot_pre_reply_delivery();
  select coalesce(jsonb_agg(
    ticket_row.value || jsonb_build_object(
      'replyDeliveryStatus', ticket.reply_delivery_status,
      'replyDeliveryError', ticket.reply_delivery_error,
      'replyOperationAttemptId', ticket.reply_operation_attempt_id
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

revoke all on function public.sellerpilot_get_operations_snapshot() from public, anon;
grant execute on function public.sellerpilot_get_operations_snapshot() to authenticated;

create or replace function public.sellerpilot_service_sweep_stale_lazada_replies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preparing integer := 0;
  v_sending integer := 0;
begin
  with expired as (
    update sellerpilot_private.support_reply_attempts
       set status = 'failed',
           safe_message = 'Lazada 호출 전 중단된 답변 작업입니다. 다시 전송할 수 있습니다.',
           completed_at = now()
     where status = 'preparing' and created_at < now() - interval '5 minutes'
     returning id, ticket_id
  ), ticket_updates as (
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'failed',
           reply_delivery_error = 'Lazada 호출 전 중단된 답변 작업입니다.',
           updated_at = now()
      from expired e where t.id = e.ticket_id and t.reply_operation_attempt_id = e.id
    returning 1
  ) select count(*) into v_preparing from expired;

  with expired as (
    update sellerpilot_private.support_reply_attempts
       set status = 'reconciliation_required',
           safe_message = 'Lazada 답변 접수 여부를 확정할 수 없어 수동 확인이 필요합니다.',
           reconciliation_required_at = now(),
           completed_at = null
     where status = 'sending' and mutation_started_at < now() - interval '2 minutes'
     returning id, ticket_id
  ), ticket_updates as (
    update sellerpilot_private.support_tickets t
       set reply_delivery_status = 'reconciliation_required',
           reply_delivery_error = 'Lazada 답변 접수 여부를 수동 확인해야 합니다.',
           updated_at = now()
      from expired e where t.id = e.ticket_id and t.reply_operation_attempt_id = e.id
    returning 1
  ) select count(*) into v_sending from expired;

  return jsonb_build_object('preparing_failed', v_preparing, 'reconciliation_required', v_sending);
end;
$$;

create or replace function public.sellerpilot_service_claim_lazada_reply(
  p_actor_id uuid,
  p_ticket_id uuid,
  p_reply_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
  v_id uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_message text;
begin
  if p_actor_id is null
     or not exists (select 1 from sellerpilot_private.admin_users a where a.user_id = p_actor_id)
     or coalesce(p_reply_fingerprint, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid Lazada reply claim';
  end if;
  perform public.sellerpilot_service_sweep_stale_lazada_replies();

  select t.id, t.owner_id, t.channel_key, t.status, t.demo
    into v_ticket
    from sellerpilot_private.support_tickets t
   where t.id = p_ticket_id
   for update;
  if not found then raise exception 'support ticket not found'; end if;

  select a.id, a.status, a.safe_message
    into v_existing_id, v_existing_status, v_existing_message
    from sellerpilot_private.support_reply_attempts a
   where a.ticket_id = p_ticket_id and a.reply_fingerprint = p_reply_fingerprint
   for update;
  if found then
    return jsonb_build_object(
      'attempt_id', v_existing_id, 'duplicate', true, 'status', v_existing_status,
      'safe_message', v_existing_message
    );
  end if;

  if v_ticket.channel_key <> 'lazada' or v_ticket.demo or v_ticket.status = 'resolved' then
    raise exception 'Lazada reply ticket is not writable';
  end if;

  select a.id, a.status, a.safe_message
    into v_existing_id, v_existing_status, v_existing_message
    from sellerpilot_private.support_reply_attempts a
   where a.ticket_id = p_ticket_id
     and a.status in ('preparing', 'sending', 'reconciliation_required')
   order by case when a.status = 'reconciliation_required' then 0 when a.status = 'sending' then 1 else 2 end,
            a.created_at
   for update
   limit 1;
  if found then
    return jsonb_build_object(
      'attempt_id', v_existing_id, 'duplicate', true, 'reply_conflict', true,
      'status', v_existing_status,
      'safe_message', coalesce(v_existing_message, '이 문의의 이전 답변 작업이 완료되거나 조정될 때까지 재전송할 수 없습니다.')
    );
  end if;

  insert into sellerpilot_private.support_reply_attempts (
    ticket_id, owner_id, channel, reply_fingerprint
  ) values (
    p_ticket_id, p_actor_id, 'lazada', p_reply_fingerprint
  ) returning id into v_id;
  update sellerpilot_private.support_tickets
     set reply_delivery_status = 'preparing',
         reply_delivery_error = null,
         reply_operation_attempt_id = v_id,
         updated_at = now()
   where id = p_ticket_id;
  return jsonb_build_object('attempt_id', v_id, 'duplicate', false, 'status', 'preparing');
end;
$$;

create or replace function public.sellerpilot_service_begin_lazada_reply(
  p_attempt_id uuid,
  p_reply_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ticket_id uuid;
begin
  update sellerpilot_private.support_reply_attempts
     set status = 'sending', mutation_started_at = now()
   where id = p_attempt_id
     and reply_fingerprint = p_reply_fingerprint
     and status = 'preparing'
  returning ticket_id into v_ticket_id;
  if v_ticket_id is null then return false; end if;
  update sellerpilot_private.support_tickets
     set reply_delivery_status = 'sending', updated_at = now()
   where id = v_ticket_id and reply_operation_attempt_id = p_attempt_id;
  return true;
end;
$$;

create or replace function public.sellerpilot_service_complete_lazada_reply(
  p_attempt_id uuid,
  p_reply_fingerprint text,
  p_outcome text,
  p_reply text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
  v_status text;
begin
  if p_outcome not in ('succeeded', 'failed', 'reconciliation_required')
     or length(trim(coalesce(p_safe_message, ''))) not between 1 and 500
     or (p_outcome = 'succeeded' and (
       length(trim(coalesce(p_reply, ''))) not between 1 and 4000
       or encode(extensions.digest(trim(p_reply), 'sha256'), 'hex') <> p_reply_fingerprint
     )) then
    raise exception 'invalid Lazada reply completion';
  end if;

  update sellerpilot_private.support_reply_attempts
     set status = p_outcome,
         safe_message = left(trim(p_safe_message), 500),
         completed_at = case when p_outcome = 'reconciliation_required' then null else now() end,
         reconciliation_required_at = case when p_outcome = 'reconciliation_required' then now() else null end
   where id = p_attempt_id
     and reply_fingerprint = p_reply_fingerprint
     and status in ('preparing', 'sending')
     and (p_outcome = 'failed' or mutation_started_at is not null)
  returning ticket_id, status into v_ticket_id, v_status;

  if v_ticket_id is null then
    return exists (
      select 1 from sellerpilot_private.support_reply_attempts a
       where a.id = p_attempt_id
         and a.reply_fingerprint = p_reply_fingerprint
         and a.status = p_outcome
    );
  end if;

  update sellerpilot_private.support_tickets
     set status = case when p_outcome = 'succeeded' then 'resolved' else status end,
         reply_draft = case when p_outcome = 'succeeded' then left(trim(p_reply), 4000) else reply_draft end,
         resolved_at = case when p_outcome = 'succeeded' then now() else resolved_at end,
         reply_delivery_status = p_outcome,
         reply_delivery_error = case when p_outcome = 'succeeded' then null else left(trim(p_safe_message), 500) end,
         updated_at = now()
   where id = v_ticket_id and reply_operation_attempt_id = p_attempt_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  )
  select t.owner_id,
         case
           when p_outcome = 'succeeded' then 'lazada_reply_sent'
           when p_outcome = 'reconciliation_required' then 'lazada_reply_reconciliation_required'
           else 'lazada_reply_failed'
         end,
         'support_ticket', t.id::text,
         jsonb_build_object('attempt_id', p_attempt_id, 'outcome', p_outcome)
    from sellerpilot_private.support_tickets t where t.id = v_ticket_id;
  return true;
end;
$$;

revoke all on function public.sellerpilot_service_sweep_stale_tracx_mutations()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_tracx_mutation(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_tracx_mutation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_tracx_mutation(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_sweep_stale_lazada_replies()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_lazada_reply(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_lazada_reply(uuid, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_lazada_reply(uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.sellerpilot_service_sweep_stale_tracx_mutations() to service_role;
grant execute on function public.sellerpilot_service_claim_tracx_mutation(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.sellerpilot_service_begin_tracx_mutation(uuid, text) to service_role;
grant execute on function public.sellerpilot_service_complete_tracx_mutation(uuid, text, text, text, text) to service_role;
grant execute on function public.sellerpilot_service_sweep_stale_lazada_replies() to service_role;
grant execute on function public.sellerpilot_service_claim_lazada_reply(uuid, uuid, text) to service_role;
grant execute on function public.sellerpilot_service_begin_lazada_reply(uuid, text) to service_role;
grant execute on function public.sellerpilot_service_complete_lazada_reply(uuid, text, text, text, text) to service_role;

commit;
