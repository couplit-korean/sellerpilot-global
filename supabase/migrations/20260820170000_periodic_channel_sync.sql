-- Queue read-only order and inquiry polling from Vercel Cron while keeping all
-- marketplace credentials inside Vault. The existing Mac worker performs the
-- remote calls from the approved egress IP, then the ingestion triggers create
-- purchase and shipping push notifications.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_channel_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu'));

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
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or p_operation not in ('orders.list', 'inquiries.list')
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

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(text, text, jsonb, integer)
  to service_role;

commit;
