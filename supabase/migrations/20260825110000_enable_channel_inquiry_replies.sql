-- Allow the fixed-egress worker to send replies for marketplace channels whose
-- public seller APIs expose a reply operation. Preserve the hardened OAuth
-- replay/Vault handling already present in the production gateway function.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_operation_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'inquiries.list', 'inquiries.reply', 'shipment.acknowledge', 'shipment.confirm'
  )) not valid;

create or replace function public.sellerpilot_enqueue_channel_gateway_job(
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
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_oauth_fingerprint text;
  v_oauth_vault_id uuid;
  v_existing record;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'orders.list', 'orders.get', 'inquiries.list', 'inquiries.reply'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or (p_operation = 'inquiries.reply' and p_channel not in ('lazada', 'coupang', 'smartstore'))
     or (p_channel = 'ebay' and p_operation not in (
       'oauth.exchange', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'orders.list', 'orders.get'
     ))
     or (p_operation = 'oauth.exchange' and (
       p_channel not in ('shopee', 'lazada', 'ebay')
       or p_attempt_id is not null
       or nullif(trim(p_request_payload->>'code'), '') is null
       or length(p_request_payload->>'code') > 8000
     ))
     or (p_operation = 'competitor.search' and (p_channel <> 'elevenst' or p_attempt_id is not null))
     or (p_channel = 'elevenst' and p_operation not in (
       'diagnostic.test', 'competitor.search',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'orders.list'
     ))
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  if p_operation = 'oauth.exchange' then
    v_oauth_fingerprint := encode(
      extensions.digest(
        jsonb_build_object(
          'channel', p_channel,
          'code', trim(p_request_payload->>'code')
        )::text,
        'sha256'
      ),
      'hex'
    );

    select j.id
      into v_existing
      from sellerpilot_private.channel_gateway_jobs j
     where j.oauth_source_credential_id = p_credential_id
       and j.oauth_request_fingerprint = v_oauth_fingerprint
       and j.channel = p_channel
       and j.operation = 'oauth.exchange'
     limit 1;
    if found then
      return v_existing.id;
    end if;
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;

  if not found then
    -- A successful exchange rotates the credential before the callback HTTP
    -- response is necessarily delivered. Re-check the immutable source id so
    -- an exact callback replay can still observe that terminal job.
    if p_operation = 'oauth.exchange' then
      select j.id
        into v_existing
        from sellerpilot_private.channel_gateway_jobs j
       where j.oauth_source_credential_id = p_credential_id
         and j.oauth_request_fingerprint = v_oauth_fingerprint
         and j.channel = p_channel
         and j.operation = 'oauth.exchange'
       limit 1;
      if found then
        return v_existing.id;
      end if;
    end if;
    raise exception 'active channel credential required';
  end if;

  if p_operation = 'oauth.exchange' then
    -- The credential row lock serializes callbacks. A repeated delivery of
    -- the same authorization grant reuses its exact job; a different grant
    -- cannot overtake an unresolved exchange for the same credential.
    select j.id, j.status, j.oauth_request_fingerprint
      into v_existing
      from sellerpilot_private.channel_gateway_jobs j
     where j.oauth_source_credential_id = p_credential_id
       and j.operation = 'oauth.exchange'
       and j.channel = p_channel
       and j.oauth_request_fingerprint = v_oauth_fingerprint
     limit 1;
    if found then
      return v_existing.id;
    end if;

    select j.id, j.status, j.oauth_request_fingerprint
      into v_existing
      from sellerpilot_private.channel_gateway_jobs j
     where j.oauth_source_credential_id = p_credential_id
       and j.operation = 'oauth.exchange'
       and j.channel = p_channel
       and j.status in ('queued', 'running', 'reconciliation_required')
     order by case when j.status = 'reconciliation_required' then 0 else 1 end,
              j.created_at,
              j.id
     limit 1;
    if found then
      raise exception 'unresolved OAuth exchange already exists';
    end if;

    select vault.create_secret(
      p_request_payload::text,
      format('sellerpilot_gateway_oauth_%s_%s', v_id, gen_random_uuid()),
      'SellerPilot claim-bound OAuth request. Never expose outside the gateway worker.'
    ) into v_oauth_vault_id;
  end if;

  if p_attempt_id is not null and not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.credential_id = p_credential_id
       and a.channel = p_channel
       and a.operation = p_operation
       and a.status = 'running'
  ) then
    raise exception 'running channel operation required';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id,
    credential_id,
    attempt_id,
    channel,
    operation,
    environment,
    request_payload,
    oauth_request_vault_id,
    oauth_request_fingerprint,
    oauth_source_credential_id,
    created_by
  ) values (
    v_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    v_environment,
    case when p_operation = 'oauth.exchange'
      then jsonb_build_object('vaultBacked', true)
      else p_request_payload
    end,
    v_oauth_vault_id,
    v_oauth_fingerprint,
    case when p_operation = 'oauth.exchange' then p_credential_id else null end,
    v_created_by
  );

  return v_id;
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  to service_role;

commit;
