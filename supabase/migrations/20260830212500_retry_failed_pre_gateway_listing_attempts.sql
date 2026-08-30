-- Listing image preparation happens after the idempotency attempt is claimed
-- but before the durable gateway job is reserved. Persist that exact boundary
-- on the attempt so a transient Storage/DNS failure can safely resume without
-- inferring safety from gateway-job rows that may later be pruned.

begin;

alter table sellerpilot_private.channel_operation_attempts
  add column if not exists pre_gateway_retryable boolean not null default false;

alter table sellerpilot_private.channel_operation_attempts
  drop constraint if exists channel_operation_attempts_pre_gateway_retryable_check;
alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_pre_gateway_retryable_check
  check (
    not pre_gateway_retryable
    or (
      gateway_write_required
      and operation in ('listing.create', 'listing.update', 'listing.stop')
      and status = 'failed'
      and remote_id is null
    )
  );

-- Preserve the live failure that triggered this rollout. Runtime pruning keeps
-- terminal gateway jobs for at least 24 hours, so the six-hour bound plus the
-- no-job test proves these timeout rows have not crossed the provider boundary.
-- The older exact precondition message was already the canonical safe-revival
-- contract and remains eligible regardless of age.
update sellerpilot_private.channel_operation_attempts attempt
   set pre_gateway_retryable = true
 where attempt.status = 'failed'
   and attempt.gateway_write_required
   and attempt.operation in ('listing.create', 'listing.update', 'listing.stop')
   and attempt.remote_id is null
   and not exists (
     select 1
       from sellerpilot_private.channel_gateway_jobs job
      where job.attempt_id = attempt.id
   )
   and (
     attempt.safe_message = '상품·카테고리·채널 연결 사전조건을 충족하지 못했습니다.'
     or (
       attempt.safe_message = '판매채널 응답 제한시간(15초)을 초과했습니다.'
       and attempt.completed_at >= clock_timestamp() - interval '6 hours'
     )
   );

create or replace function public.sellerpilot_service_fail_pre_gateway_channel_operation(
  p_attempt_id uuid,
  p_http_status integer,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated uuid;
begin
  if p_attempt_id is null
     or p_http_status not between 400 and 599
     or length(trim(coalesce(p_safe_message, ''))) not between 1 and 1000 then
    raise exception 'invalid pre-gateway channel failure';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed',
         http_status = p_http_status,
         remote_id = null,
         safe_message = trim(p_safe_message),
         completed_at = clock_timestamp(),
         pre_gateway_retryable = true
   where attempt.id = p_attempt_id
     and attempt.status = 'running'
     and attempt.gateway_write_required
     and attempt.operation in ('listing.create', 'listing.update', 'listing.stop')
     and attempt.remote_id is null
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = attempt.id
     )
  returning attempt.id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on function public.sellerpilot_service_fail_pre_gateway_channel_operation(
  uuid, integer, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_fail_pre_gateway_channel_operation(
  uuid, integer, text
) to service_role;

comment on function public.sellerpilot_service_fail_pre_gateway_channel_operation(
  uuid, integer, text
) is 'Marks a current listing attempt retryable only while no durable gateway job or remote id exists.';

-- 301000 wraps the predecessor to replay verified publication intent and
-- remote-state evidence for succeeded duplicates. Replace only that
-- predecessor; never replace the canonical wrapper.
create or replace function public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
  p_credential_id uuid,
  p_channel text,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_fingerprint text;
  v_remote_id text;
  v_safe_message text;
  v_gateway_write_required boolean := false;
  v_pre_gateway_retryable boolean := false;
  v_inserted boolean := false;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in (
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or length(trim(p_idempotency_key)) not between 16 and 160
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid channel operation';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.id = p_credential_id
       and credential.channel = p_channel
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > now())
  ) then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key,
    request_fingerprint, gateway_write_required, pre_gateway_retryable
  ) values (
    auth.uid(), p_credential_id, p_channel, p_operation,
    trim(p_idempotency_key), p_request_fingerprint,
    p_operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update',
      'shipment.acknowledge', 'shipment.confirm'
    ),
    false
  )
  on conflict (channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message,
            gateway_write_required, pre_gateway_retryable
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message,
         v_gateway_write_required, v_pre_gateway_retryable;
  v_inserted := found;

  if not v_inserted then
    select attempt.id, attempt.status, attempt.request_fingerprint,
           attempt.remote_id, attempt.safe_message,
           attempt.gateway_write_required, attempt.pre_gateway_retryable
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message,
           v_gateway_write_required, v_pre_gateway_retryable
      from sellerpilot_private.channel_operation_attempts attempt
     where attempt.channel = p_channel
       and attempt.operation = p_operation
       and attempt.idempotency_key = trim(p_idempotency_key)
     for update;
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;

    if v_status = 'running'
       and v_gateway_write_required
       and p_operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update',
         'shipment.acknowledge', 'shipment.confirm'
       )
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.attempt_id = v_id
       ) then
      update sellerpilot_private.channel_operation_attempts attempt
         set owner_id = auth.uid(),
             credential_id = p_credential_id,
             pre_gateway_retryable = false,
             started_at = now()
       where attempt.id = v_id;
      v_inserted := true;
    elsif v_status = 'failed'
       and (
         v_pre_gateway_retryable
         or v_safe_message = '상품·카테고리·채널 연결 사전조건을 충족하지 못했습니다.'
       )
       and p_operation in ('listing.create', 'listing.update', 'listing.stop')
       and v_remote_id is null
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.attempt_id = v_id
       ) then
      update sellerpilot_private.channel_operation_attempts attempt
         set owner_id = auth.uid(),
             credential_id = p_credential_id,
             status = 'running',
             http_status = null,
             remote_id = null,
             safe_message = null,
             gateway_write_required = true,
             pre_gateway_retryable = false,
             started_at = now(),
             completed_at = null
       where attempt.id = v_id;
      v_status := 'running';
      v_remote_id := null;
      v_safe_message := null;
      v_inserted := true;
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', v_id,
    'status', v_status,
    'duplicate', not v_inserted,
    'remote_id', v_remote_id,
    'safe_message', v_safe_message
  );
end;
$$;

revoke all on function public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
  uuid, text, text, text, text
) from public, anon, authenticated, service_role;

comment on function public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
  uuid, text, text, text, text
) is 'Pre-remote-state channel claim with a durable provider-boundary retry marker for listing attempts.';

commit;
