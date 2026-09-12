CREATE OR REPLACE FUNCTION public.sellerpilot_310450_enqueue_periodic_sync_unsafe(p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_credential record;
  v_request_key text;
  v_cancelled_job_id uuid;
  v_forward_payload jsonb := p_request_payload;
begin
  if p_channel = 'ebay'
     and p_operation = 'inquiries.list'
     and jsonb_typeof(p_request_payload) = 'object'
     and octet_length(p_request_payload::text) <= 128000
     and p_min_interval_minutes between 1 and 60
     and nullif(trim(p_request_payload->>'periodicKey'), '') is not null then
    v_request_key := left(trim(p_request_payload->>'periodicKey'), 120);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      'sellerpilot:periodic-sync:' || p_channel || ':' || p_operation || ':' ||
      v_request_key
    ));

    select credential.id,
           credential.created_by,
           credential.seller_account_key,
           credential.environment
      into v_credential
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'ebay'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
     order by credential.version desc,
              credential.created_at desc,
              credential.id
     limit 1;

    if v_credential.id is not null then
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'cancelled',
             error_message =
               'EBAY_PERIODIC_INQUIRY_LINEAGE_REBIND_REQUIRED',
             completed_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where job.credential_id = v_credential.id
         and job.channel = 'ebay'
         and job.operation = 'inquiries.list'
         and job.status = 'queued'
         and job.attempt_count = 0
         and job.attempt_id is null
         and job.worker_token_id is null
         and job.claim_token is null
         and job.lease_expires_at is null
         and job.started_at is null
         and job.provider_mutation_started_at is null
         and job.environment = 'production'
         and left(trim(job.request_payload->>'periodicKey'), 120) =
               v_request_key
         and job.seller_account_key is distinct from
               v_credential.seller_account_key
      returning job.id into v_cancelled_job_id;

      if v_cancelled_job_id is not null then
        insert into sellerpilot_private.operation_audit (
          owner_id, action, entity_type, entity_id, safe_detail
        ) values (
          v_credential.created_by,
          'ebay_periodic_inquiry_lineage_rebind',
          'channel_gateway_job',
          v_cancelled_job_id::text,
          jsonb_build_object(
            'channel', 'ebay',
            'operation', 'inquiries.list',
            'reason', 'provider_identity_certified_after_enqueue',
            'periodic', true
          )
        );
      end if;

      -- The predecessor intentionally treats any recently-created terminal
      -- row as a cooldown hit. A newly-cancelled lineage-less row would
      -- therefore still return already_pending for five minutes. Bind the
      -- dedupe generation to the certified seller identity only when no
      -- healthy raw-key cooldown is in force. Provider arguments are
      -- unchanged; periodicKey is internal scheduler metadata.
      if v_cancelled_job_id is not null or not exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
         where job.credential_id = v_credential.id
           and job.channel = 'ebay'
           and job.operation = 'inquiries.list'
           and left(trim(job.request_payload->>'periodicKey'), 120) =
                 v_request_key
           and (
             job.status in ('queued', 'running')
             or job.created_at > clock_timestamp()
                  - make_interval(mins => p_min_interval_minutes)
           )
           and job.error_message is distinct from
                 'EBAY_PERIODIC_INQUIRY_LINEAGE_REBIND_REQUIRED'
      ) then
        v_forward_payload := jsonb_set(
          p_request_payload,
          '{periodicKey}',
          to_jsonb(
            'ebay-inquiries:v1:' || pg_catalog.md5(
              v_request_key || E'\x1f' || v_credential.seller_account_key
            )
          ),
          false
        );
      end if;
    end if;
  end if;

  return public.sellerpilot_310400_enqueue_periodic_sync_unsafe(
    p_channel,
    p_operation,
    v_forward_payload,
    p_min_interval_minutes
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sellerpilot_310400_enqueue_periodic_sync_unsafe(p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_channel in ('coupang', 'smartstore')
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
          and policy.enabled
     ) then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', 'fixed_egress_required',
      'blockedReason', 'STATIC_EGRESS_REQUIRED'
    );
  end if;
  return public.sellerpilot_20260828_enqueue_periodic_sync_before_static_egress_gate(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sellerpilot_service_enqueue_periodic_sync(p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_channel in ('smartstore', 'temu')
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
          and policy.enabled
     ) then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', 'fixed_egress_required',
      'blockedReason', 'STATIC_EGRESS_REQUIRED'
    );
  end if;

  return public.sellerpilot_310450_enqueue_periodic_sync_unsafe(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sellerpilot_enqueue_periodic_sync_without_identity_gate(p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'sellerpilot_private'
AS $function$
declare
  v_credential_id uuid;
  v_environment text;
  v_created_by uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_job_id uuid := gen_random_uuid();
  v_data_type text;
  v_request_key text;
begin
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
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
  select j.id, j.status into v_existing_id, v_existing_status
    from sellerpilot_private.channel_gateway_jobs j
   where j.credential_id = v_credential_id
     and j.channel = p_channel
     and j.operation = p_operation
     and left(coalesce(nullif(trim(j.request_payload->>'periodicKey'), ''), md5(j.request_payload::text)), 120) = v_request_key
     and (
       j.status in ('queued', 'running', 'reconciliation_required')
       or j.created_at > now() - make_interval(mins => p_min_interval_minutes)
     )
   order by
     case when j.status = 'reconciliation_required' then 0 else 1 end,
     j.created_at desc
   limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', case
        when v_existing_status = 'reconciliation_required' then 'reconciliation_required'
        else 'already_pending'
      end,
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
$function$
;
CREATE OR REPLACE FUNCTION public.sellerpilot_20260828_enqueue_periodic_sync_before_static_egress(p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'sellerpilot_private'
AS $function$
declare
  v_credential record;
begin
  if p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang',
       'smartstore', 'ebay', 'temu', 'elevenst'
     )
     or p_operation not in ('orders.list', 'inquiries.list')
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000
     or p_min_interval_minutes not between 1 and 60 then
    raise exception 'invalid periodic channel sync';
  end if;

  if p_channel = 'shopee' and p_operation = 'orders.list' then
    select c.id, c.created_by, c.seller_account_key,
           c.seller_account_key_source, c.seller_account_verified_at
      into v_credential
      from sellerpilot_private.channel_credentials c
     where c.channel = 'shopee'
       and c.environment = 'production'
       and c.status = 'active'
       and (c.expires_at is null or c.expires_at > now())
     order by c.version desc
     limit 1;

    if v_credential.id is not null
       and (
         v_credential.seller_account_key is null
         or v_credential.seller_account_key_source is distinct from 'provider_certified_v1'
         or v_credential.seller_account_verified_at is null
       ) then
      with cancelled_jobs as (
        update sellerpilot_private.channel_gateway_jobs j
           set status = 'cancelled',
               error_message = 'SHOPEE_OAUTH_RECONNECT_REQUIRED',
               completed_at = now(),
               updated_at = now()
         where j.credential_id = v_credential.id
           and j.channel = 'shopee'
           and j.operation = 'orders.list'
           and j.status = 'queued'
           and j.attempt_count = 0
           and j.attempt_id is null
           and nullif(trim(j.request_payload->>'periodicKey'), '') is not null
        returning j.id, j.created_by
      )
      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail
      )
      select cancelled.created_by,
             'shopee_periodic_order_sync_suppressed',
             'channel_gateway_job',
             cancelled.id::text,
             jsonb_build_object(
               'channel', 'shopee',
               'operation', 'orders.list',
               'reason', 'oauth_reconnect_required',
               'periodic', true
             )
        from cancelled_jobs cancelled;

      insert into sellerpilot_private.channel_sync_state (
        owner_id, channel_key, data_type, status, imported_count,
        last_started_at, last_error, updated_at
      ) values (
        v_credential.created_by, 'shopee', 'orders', 'failed', 0,
        null,
        'Shopee OAuth 재연동이 필요합니다. 판매자 계정 확인 전까지 주문 자동 동기화를 중지했습니다.',
        now()
      )
      on conflict (owner_id, channel_key, data_type) do update set
        status = 'failed',
        last_error = excluded.last_error,
        updated_at = now();

      return jsonb_build_object(
        'channel', p_channel,
        'operation', p_operation,
        'status', 'reconnect_required'
      );
    end if;
  end if;

  return public.sellerpilot_enqueue_periodic_sync_without_identity_gate(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$function$
;