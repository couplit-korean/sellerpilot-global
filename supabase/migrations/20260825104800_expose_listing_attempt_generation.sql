-- Expose the last listing-operation attempt as a retry generation. The UI can
-- keep the same idempotency key across a lost response, while a confirmed
-- retryable failure advances to a new attempt. Provider-uncertain listings stay
-- fenced by failure_class='external_action'.

begin;

alter table sellerpilot_private.channel_operation_attempts
  add column if not exists gateway_write_required boolean not null default false;

-- A category/credential race can fail after the attempt is claimed but before
-- a listing row or gateway job exists. That exact failure is proven pre-write,
-- so the same idempotency key may safely revive its attempt after a reload.
-- Every provider-returned failure and every attempt with any gateway job stays
-- immutable; those retries advance through operationAttemptId in the UI.
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
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_fingerprint text;
  v_remote_id text;
  v_safe_message text;
  v_gateway_write_required boolean := false;
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
       and (c.expires_at is null or c.expires_at > now())
  ) then
    raise exception 'active channel credential required';
  end if;

  insert into sellerpilot_private.channel_operation_attempts (
    owner_id, credential_id, channel, operation, idempotency_key, request_fingerprint,
    gateway_write_required
  ) values (
    auth.uid(), p_credential_id, p_channel, p_operation, trim(p_idempotency_key), p_request_fingerprint,
    p_operation in ('listing.create', 'listing.update', 'listing.stop')
  )
  on conflict (channel, operation, idempotency_key) do nothing
  returning id, status, request_fingerprint, remote_id, safe_message
    into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message;
  v_inserted := found;

  if not v_inserted then
    select a.id, a.status, a.request_fingerprint, a.remote_id, a.safe_message,
           a.gateway_write_required
      into v_id, v_status, v_fingerprint, v_remote_id, v_safe_message,
           v_gateway_write_required
      from sellerpilot_private.channel_operation_attempts a
     where a.channel = p_channel
       and a.operation = p_operation
       and a.idempotency_key = trim(p_idempotency_key)
     for update;
    if v_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;

    -- A current-version listing attempt cannot reach a marketplace before its
    -- gateway job is inserted. If a request/response disappears in that narrow
    -- window, another exact request may resume the same attempt; concurrent
    -- resumes still serialize on the listing row and reuse one gateway job.
    -- Legacy attempts keep the default false marker and are never inferred safe.
    if v_status = 'running'
       and v_gateway_write_required
       and p_operation in ('listing.create', 'listing.update', 'listing.stop')
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs j
          where j.attempt_id = v_id
       ) then
      update sellerpilot_private.channel_operation_attempts a
         set owner_id = auth.uid(),
             credential_id = p_credential_id,
             started_at = now()
       where a.id = v_id;
      v_inserted := true;
    elsif v_status = 'failed'
       and p_operation in ('listing.create', 'listing.update', 'listing.stop')
       and v_remote_id is null
       and v_safe_message = '상품·카테고리·채널 연결 사전조건을 충족하지 못했습니다.'
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs j
          where j.attempt_id = v_id
       ) then
      update sellerpilot_private.channel_operation_attempts a
         set owner_id = auth.uid(),
             credential_id = p_credential_id,
             status = 'running',
             http_status = null,
             remote_id = null,
             safe_message = null,
             gateway_write_required = true,
             started_at = now(),
             completed_at = null
       where a.id = v_id;
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

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
  v_listings jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  v_result := public.sellerpilot_get_product_publish_context_pre_published_identity(p_product_id);
  if v_result is null then return null; end if;

  select coalesce(
    jsonb_agg(
      entry.value || jsonb_build_object(
        'publishedAt', listing.published_at,
        'operationAttemptId', listing.operation_attempt_id
      )
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
    into v_listings
    from jsonb_array_elements(coalesce(v_result->'listings', '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    left join sellerpilot_private.product_listings listing
      on listing.id::text = entry.value->>'id';

  return jsonb_set(v_result, '{listings}', v_listings, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_publish_context(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;
revoke all on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.sellerpilot_claim_channel_operation(uuid, text, text, text, text)
  to authenticated;

commit;
