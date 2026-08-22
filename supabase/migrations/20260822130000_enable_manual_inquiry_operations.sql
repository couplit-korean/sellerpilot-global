-- Keep the manual operation ledger aligned with the gateway operations that
-- already support customer-inquiry collection. Periodic inquiry jobs bypass
-- this ledger, but administrator-triggered read verification requires it.

begin;

alter table sellerpilot_private.channel_operation_attempts
  drop constraint if exists channel_operation_attempts_operation_check;

alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_operation_check
  check (operation in (
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get', 'inquiries.list',
    'shipment.acknowledge', 'shipment.confirm'
  ));

create or replace function public.sellerpilot_claim_channel_operation(
  p_credential_id uuid,
  p_channel text,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid;
  v_status text;
  v_fingerprint text;
  v_remote_id text;
  v_safe_message text;
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
      from sellerpilot_private.channel_credentials c
     where c.id = p_credential_id
       and c.channel = p_channel
       and c.status = 'active'
  ) then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint
  ) values (
    auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint
  )
  on conflict (channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message;
  v_inserted := found;

  if not v_inserted then
    select a.id, a.status, a.request_fingerprint, a.remote_id, a.safe_message
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message
      from sellerpilot_private.channel_operation_attempts a
     where a.channel = p_channel
       and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key);
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
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

revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text)
  to authenticated;

commit;
