-- 11st documents a seller payment-complete order feed at
-- /rest/ordservices/complete/{startTime}/{endTime}. Calls must originate from
-- the registered fixed IP, so only the local gateway worker may execute them.
-- Customer-inquiry sync remains unavailable until 11st exposes a seller API.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_channel_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu'));

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
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or (p_channel = 'elevenst' and p_operation not in ('diagnostic.test', 'orders.list'))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  select c.environment, c.created_by into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id and c.channel = p_channel and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now()) for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_attempt_id is not null and not exists (
    select 1 from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id and a.credential_id = p_credential_id
       and a.channel = p_channel and a.operation = p_operation and a.status = 'running'
  ) then raise exception 'running channel operation required'; end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment,
    p_request_payload, v_created_by
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_service_enqueue_periodic_sync(
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_credential_id uuid;
  v_environment text;
  v_created_by uuid;
  v_existing_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_data_type text;
  v_request_key text;
begin
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in ('orders.list', 'inquiries.list')
     or (p_channel = 'elevenst' and p_operation <> 'orders.list')
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000
     or p_min_interval_minutes not between 1 and 60 then
    raise exception 'invalid periodic channel sync';
  end if;

  perform pg_advisory_xact_lock(hashtext(
    'sellerpilot:periodic-sync:' || p_channel || ':' || p_operation || ':' ||
    left(coalesce(nullif(trim(p_request_payload->>'periodicKey'), ''), md5(p_request_payload::text)), 120)
  ));

  select c.id, c.environment, c.created_by
    into v_credential_id, v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel
     and c.environment = 'production'
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   order by c.version desc
   limit 1;

  if v_credential_id is null then
    return jsonb_build_object('channel', p_channel, 'operation', p_operation, 'status', 'not_connected');
  end if;

  v_request_key := left(coalesce(nullif(trim(p_request_payload->>'periodicKey'), ''), md5(p_request_payload::text)), 120);
  select j.id into v_existing_id
    from sellerpilot_private.channel_gateway_jobs j
   where j.credential_id = v_credential_id
     and j.channel = p_channel
     and j.operation = p_operation
     and left(coalesce(nullif(trim(j.request_payload->>'periodicKey'), ''), md5(j.request_payload::text)), 120) = v_request_key
     and (
       j.status in ('queued', 'running')
       or j.created_at > now() - make_interval(mins => p_min_interval_minutes)
     )
   order by j.created_at desc
   limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', 'already_pending',
      'jobId', v_existing_id
    );
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by
  ) values (
    v_job_id, v_credential_id, null, p_channel, p_operation, v_environment,
    p_request_payload, v_created_by
  );

  v_data_type := case when p_operation = 'orders.list' then 'orders' else 'inquiries' end;
  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status, imported_count,
    last_started_at, last_error, updated_at
  ) values (
    v_created_by, p_channel, v_data_type, 'queued', 0, now(), null, now()
  )
  on conflict (owner_id, channel_key, data_type) do update set
    status = 'queued',
    last_started_at = now(),
    last_error = null,
    updated_at = now();

  return jsonb_build_object(
    'channel', p_channel,
    'operation', p_operation,
    'status', 'queued',
    'jobId', v_job_id
  );
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  to service_role;

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(text, text, jsonb, integer)
  to service_role;

commit;
