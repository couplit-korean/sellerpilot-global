-- Serialize gateway ledger mutations behind one short transaction-scoped lock
-- and make listing.create reservation + enqueue one atomic database operation.

begin;

create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_attempt_owner_id uuid;
  v_product_owner_id uuid;
  v_market text := upper(trim(coalesce(p_market, '')));
  v_target_id text := trim(coalesce(p_target_id, ''));
  v_listing sellerpilot_private.product_listings%rowtype;
  v_existing_job record;
  v_latest_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_product_id is null
     or p_credential_id is null
     or p_attempt_id is null
     or p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang',
       'elevenst', 'smartstore', 'ebay', 'temu'
     )
     or length(trim(coalesce(p_currency, ''))) <> 3
     or length(v_market) > 80
     or length(v_target_id) > 160
     or p_price < 0
     or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid atomic listing create request';
  end if;
  if p_channel in ('shopee', 'lazada') and v_market !~ '^[A-Z]{2}$' then
    raise exception 'concrete market required';
  end if;
  if p_channel = 'shopee' and v_target_id = '' then
    raise exception 'shop target required';
  end if;

  select p.owner_id
    into v_product_owner_id
    from sellerpilot_private.products p
   where p.id = p_product_id
     and not p.demo
     and p.status <> 'archived';
  if not found
     or not exists (
       select 1
         from sellerpilot_private.admin_users admin_user
        where admin_user.user_id = v_product_owner_id
     ) then
    raise exception 'product not found';
  end if;

  if not exists (
    select 1
      from sellerpilot_private.product_category_assignments assignment
     where assignment.owner_id = v_product_owner_id
       and assignment.product_id = p_product_id
       and assignment.channel = p_channel
       and (p_channel not in ('shopee', 'lazada') or assignment.market = v_market)
       and assignment.status = 'confirmed'
       and assignment.is_leaf
       and jsonb_array_length(assignment.missing_required_attributes) = 0
       and assignment.confirmed_at is not null
  ) then
    raise exception 'confirmed market category required';
  end if;

  insert into sellerpilot_private.product_listings (
    owner_id,
    product_id,
    channel_key,
    market,
    target_id,
    status,
    currency,
    price,
    last_error,
    updated_at
  ) values (
    v_product_owner_id,
    p_product_id,
    p_channel,
    v_market,
    v_target_id,
    'queued',
    upper(trim(p_currency)),
    p_price,
    null,
    now()
  )
  on conflict (owner_id, product_id, channel_key, market, target_id)
  do nothing;

  select listing.*
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.owner_id = v_product_owner_id
     and listing.product_id = p_product_id
     and listing.channel_key = p_channel
     and listing.market = v_market
     and listing.target_id = v_target_id
   for update;
  if not found then raise exception 'product listing not found'; end if;

  select credential.environment, credential.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = p_channel
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > now())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  select attempt.owner_id
    into v_attempt_owner_id
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = p_attempt_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = p_channel
     and attempt.operation = 'listing.create'
     and attempt.request_fingerprint = p_request_fingerprint
     and attempt.status = 'running'
   for update;
  if not found
     or not exists (
       select 1
         from sellerpilot_private.admin_users admin_user
        where admin_user.user_id = v_attempt_owner_id
     ) then
    raise exception 'running listing create operation required';
  end if;

  select job.id, job.attempt_id, job.status, job.error_message
    into v_existing_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = v_listing.id
     and job.operation = 'listing.create'
     and job.status in ('queued', 'running', 'reconciliation_required')
   order by case
       when job.status = 'reconciliation_required' then 0
       when job.status = 'running' then 1
       else 2
     end,
     job.created_at,
     job.id
   for update
   limit 1;

  if found then
    if v_existing_job.attempt_id is distinct from p_attempt_id then
      update sellerpilot_private.channel_operation_attempts attempt
         set status = case
               when v_existing_job.status = 'reconciliation_required'
                 then 'manual_required'
               else 'failed'
             end,
             http_status = 409,
             safe_message = case
               when v_existing_job.status = 'reconciliation_required'
                 then '이 상품의 이전 등록 결과를 판매자센터에서 수동 확인해야 합니다.'
               else '이 상품의 등록 작업이 이미 진행 중이어서 새 원격 호출을 실행하지 않았습니다.'
             end,
             completed_at = now()
       where attempt.id = p_attempt_id
         and attempt.status = 'running';
    end if;

    return jsonb_build_object(
      'status', case
        when v_existing_job.status = 'reconciliation_required'
          then 'reconciliation_required'
        else 'in_progress'
      end,
      'job_id', v_existing_job.id,
      'attempt_id', v_existing_job.attempt_id,
      'conflict_attempt_id', case
        when v_existing_job.attempt_id is distinct from p_attempt_id
          then p_attempt_id
        else null
      end,
      'listing_id', v_listing.id,
      'reused', true
    );
  end if;

  if nullif(trim(coalesce(v_listing.remote_id, '')), '') is not null then
    update sellerpilot_private.channel_operation_attempts attempt
       set status = 'failed',
           http_status = 409,
           safe_message = '이미 게시된 원격 상품이 있어 새 등록 호출을 실행하지 않았습니다.',
           completed_at = now()
     where attempt.id = p_attempt_id
       and attempt.status = 'running';
    return jsonb_build_object(
      'status', 'remote_exists',
      'attempt_id', p_attempt_id,
      'listing_id', v_listing.id,
      'reused', false
    );
  end if;

  if v_listing.failure_class = 'external_action' then
    select job.id
      into v_latest_job_id
      from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = v_listing.id
       and job.operation = 'listing.create'
     order by job.completed_at desc nulls last, job.created_at desc, job.id desc
     limit 1;
    update sellerpilot_private.channel_operation_attempts attempt
       set status = 'manual_required',
           http_status = 409,
           safe_message = '이전 원격 등록 결과를 수동 확인하기 전에는 재등록할 수 없습니다.',
           completed_at = now()
     where attempt.id = p_attempt_id
       and attempt.status = 'running';
    return jsonb_build_object(
      'status', 'manual_required',
      'job_id', v_latest_job_id,
      'attempt_id', p_attempt_id,
      'listing_id', v_listing.id,
      'reused', true
    );
  end if;

  update sellerpilot_private.product_listings listing
     set operation_attempt_id = p_attempt_id,
         status = 'queued',
         currency = upper(trim(p_currency)),
         price = p_price,
         last_error = null,
         failure_class = null,
         updated_at = now()
   where listing.id = v_listing.id;

  insert into sellerpilot_private.channel_gateway_jobs (
    id,
    credential_id,
    attempt_id,
    listing_id,
    channel,
    operation,
    environment,
    request_payload,
    request_fingerprint,
    created_by
  ) values (
    v_job_id,
    p_credential_id,
    p_attempt_id,
    v_listing.id,
    p_channel,
    'listing.create',
    v_environment,
    p_request_payload,
    p_request_fingerprint,
    v_created_by
  );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_attempt_owner_id,
    'listing_prepared',
    'product_listing',
    v_listing.id::text,
    jsonb_build_object(
      'product_id', p_product_id,
      'channel', p_channel,
      'market', v_market,
      'has_target', v_target_id <> '',
      'operation', 'listing.create',
      'gateway_job_id', v_job_id
    )
  );

  return jsonb_build_object(
    'status', 'queued',
    'job_id', v_job_id,
    'attempt_id', p_attempt_id,
    'listing_id', v_listing.id,
    'reused', false
  );
end;
$$;

-- Disable the old authenticated prepare endpoints. A rolling old application
-- must fail before it can mutate a published listing or enter the prepare /
-- enqueue gap. The current app uses the service-only atomic RPC above.
revoke all on function public.sellerpilot_prepare_product_market_listing(
  uuid, text, text, text, text, text, numeric
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_prepare_product_listing(
  uuid, text, text, text, numeric
) from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_11820_enqueue_listing_unsafe;

create function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_operation = 'listing.create' then
    raise exception 'ATOMIC_LISTING_CREATE_REQUIRED';
  end if;
  return public.sellerpilot_11820_enqueue_listing_unsafe(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

alter function public.sellerpilot_service_enqueue_resource_gateway_job(
  uuid, uuid, text, text, jsonb, text, text, text,
  uuid, uuid, uuid, text, text
) rename to sellerpilot_11820_enqueue_resource_unsafe;

create function public.sellerpilot_service_enqueue_resource_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_resource_kind text,
  p_resource_key text,
  p_request_fingerprint text,
  p_listing_id uuid default null,
  p_inventory_item_id uuid default null,
  p_order_id uuid default null,
  p_shipment_carrier text default null,
  p_shipment_tracking text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_enqueue_resource_unsafe(
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload,
    p_resource_kind,
    p_resource_key,
    p_request_fingerprint,
    p_listing_id,
    p_inventory_item_id,
    p_order_id,
    p_shipment_carrier,
    p_shipment_tracking
  );
end;
$$;

alter function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) rename to sellerpilot_11820_enqueue_channel_unsafe;

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
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_enqueue_channel_unsafe(
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) rename to sellerpilot_11820_enqueue_reply_unsafe;

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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_enqueue_reply_unsafe(
    p_ticket_id,
    p_channel,
    p_reply_text,
    p_request_payload
  );
end;
$$;

alter function public.sellerpilot_claim_channel_gateway_job(text, text)
  rename to sellerpilot_11820_claim_gateway_unsafe;

create function public.sellerpilot_claim_channel_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_claim_gateway_unsafe(
    p_token_hash,
    p_worker_version
  );
end;
$$;

alter function public.sellerpilot_touch_channel_gateway_job(text, uuid, uuid, text)
  rename to sellerpilot_11820_touch_gateway_unsafe;

create function public.sellerpilot_touch_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_worker_version text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_touch_gateway_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_worker_version
  );
end;
$$;

alter function public.sellerpilot_service_begin_channel_gateway_completion(
  text, uuid, uuid
) rename to sellerpilot_11820_begin_completion_unsafe;

create function public.sellerpilot_service_begin_channel_gateway_completion(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_begin_completion_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

alter function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) rename to sellerpilot_11820_complete_gateway_unsafe;

create function public.sellerpilot_complete_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_complete_gateway_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_status,
    p_response_payload,
    p_error_message
  );
end;
$$;

alter function public.sellerpilot_service_begin_gateway_credential_refresh(
  text, uuid, uuid
) rename to sellerpilot_11820_begin_refresh_unsafe;

create function public.sellerpilot_service_begin_gateway_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  return public.sellerpilot_11820_begin_refresh_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

alter function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) rename to sellerpilot_11820_prepare_refresh_unsafe;

create function public.sellerpilot_service_prepare_gateway_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_recovery_only boolean default false,
  p_oauth_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_channel text;
  v_job_operation text;
  v_old_subject text;
  v_new_subject text;
  v_identity_version text;
  v_recovery_vault_id uuid;
  v_existing_recovery_vault_id uuid;
  v_existing_recovery_fingerprint text;
  v_refresh_in_flight boolean;
  v_request_fingerprint text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' or p_claim_token is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  perform 1
    from sellerpilot_private.ai_cli_worker_tokens worker_token
   where worker_token.token_hash = p_token_hash
     and worker_token.status = 'active'
     and worker_token.expires_at > now();
  if not found then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select j.channel, j.operation,
         nullif(trim(old_secret.decrypted_secret::jsonb->>'provider_account_subject'), ''),
         j.credential_refresh_recovery_vault_id,
         j.credential_refresh_recovery_fingerprint,
         j.credential_refresh_in_flight
    into v_job_channel, v_job_operation, v_old_subject,
         v_existing_recovery_vault_id, v_existing_recovery_fingerprint,
         v_refresh_in_flight
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets old_secret on old_secret.id = c.vault_secret_id
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = j.worker_token_id
   where j.id = p_job_id
     and j.claim_token = p_claim_token
     and j.status = 'running'
     and j.lease_expires_at > now()
     and worker_token.token_hash = p_token_hash
     and worker_token.status = 'active'
     and worker_token.expires_at > now()
   for update of j;

  if not found then return null; end if;

  -- eBay OAuth exchange and Lazada token refresh can return rotating grants
  -- before the immutable account proof is durably staged. Preserve a
  -- claim-bound snapshot in Vault first; it is never activated without the
  -- subsequent provider identity proof.
  if p_recovery_only and v_job_channel in ('ebay', 'lazada', 'shopee') then
    if (v_job_channel = 'ebay' and v_job_operation <> 'oauth.exchange')
       or p_secret_payload is null
       or jsonb_typeof(p_secret_payload) <> 'object'
       or octet_length(p_secret_payload::text) > 32000
       or p_secret_payload ? 'provider_account_subject'
       or p_secret_payload ? 'provider_account_identity_version'
       or (
         v_job_channel in ('ebay', 'lazada')
         and (
           length(coalesce(p_secret_payload->>'access_token', '')) < 8
           or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
         )
       )
       or (
         v_job_channel = 'ebay'
         and (
           length(coalesce(p_secret_payload->>'client_id', '')) < 3
           or length(coalesce(p_secret_payload->>'client_secret', '')) < 3
         )
       )
       or (
         v_job_channel = 'lazada'
         and (
           length(coalesce(p_secret_payload->>'app_key', '')) < 3
           or length(coalesce(p_secret_payload->>'app_secret', '')) < 3
         )
       )
       or (
         v_job_channel = 'shopee'
         and (
           coalesce(p_secret_payload->>'partner_id', '') !~ '^[0-9]+$'
           or length(coalesce(p_secret_payload->>'partner_key', '')) < 16
           or not (
             (
               coalesce(p_secret_payload->>'main_account_id', '') ~ '^[0-9]+$'
               and length(coalesce(p_secret_payload->>'main_account_access_token', '')) >= 8
               and length(coalesce(p_secret_payload->>'main_account_refresh_token', '')) >= 8
             )
             or (
               coalesce(
                 nullif(p_secret_payload->>'shop_id', ''),
                 nullif(p_secret_payload->>'merchant_id', '')
               ) ~ '^[0-9]+$'
               and length(coalesce(p_secret_payload->>'access_token', '')) >= 8
               and length(coalesce(p_secret_payload->>'refresh_token', '')) >= 8
             )
           )
         )
       )
       or (v_job_channel <> 'shopee' and p_expires_at is null)
       or (p_expires_at is not null and p_expires_at <= now())
       or p_oauth_complete then
      return jsonb_build_object('status', 'invalid');
    end if;

    v_request_fingerprint := encode(extensions.digest(
      jsonb_build_object(
        'payload', p_secret_payload,
        'expires_at', p_expires_at,
        'recovery_only', true
      )::text,
      'sha256'
    ), 'hex');
    if v_existing_recovery_vault_id is not null
       and v_existing_recovery_fingerprint = v_request_fingerprint then
      return jsonb_build_object('status', 'recovery_preserved', 'reused', true);
    end if;
    if not v_refresh_in_flight then
      return jsonb_build_object('status', 'conflict');
    end if;

    select vault.create_secret(
      p_secret_payload::text,
      format('sellerpilot_gateway_recovery_%s_%s_%s', v_job_channel, p_job_id, gen_random_uuid()),
      format(
        'SellerPilot claim-bound %s OAuth recovery snapshot. Never expose outside manual reconciliation.',
        v_job_channel
      )
    ) into v_recovery_vault_id;
    if v_existing_recovery_vault_id is not null then
      delete from vault.secrets where id = v_existing_recovery_vault_id;
    end if;
    update sellerpilot_private.channel_gateway_jobs j
       set credential_refresh_recovery_vault_id = v_recovery_vault_id,
           credential_refresh_recovery_fingerprint = v_request_fingerprint,
           credential_refresh_recovery_staged_at = now(),
           credential_refresh_in_flight = false,
           credential_refresh_started_at = null,
           updated_at = now()
     where j.id = p_job_id;
    return jsonb_build_object('status', 'recovery_preserved', 'reused', false);
  end if;

  if v_job_channel in ('shopee', 'lazada', 'ebay') then
    v_new_subject := nullif(trim(p_secret_payload->>'provider_account_subject'), '');
    v_identity_version := nullif(trim(p_secret_payload->>'provider_account_identity_version'), '');
    if v_identity_version <> 'v1'
       or v_new_subject is null
       or length(v_new_subject) > 2048
       or (v_job_channel = 'shopee' and v_new_subject !~ '^shopee:(main|shop):[0-9]+$')
       or (v_job_channel = 'lazada' and (
         length(v_new_subject) not between 51 and 522
         or v_new_subject !~ '^lazada:v1:[A-Za-z0-9_-]+$'
       ))
       or (v_job_channel = 'ebay' and (
         length(v_new_subject) not between 11 and 522
         or v_new_subject !~ '^ebay:eias:[^[:cntrl:]]+$'
       )) then
      return jsonb_build_object('status', 'invalid');
    end if;

    -- A regular refresh may attest a previously-unattested legacy credential,
    -- but once a provider subject exists it can never switch accounts. A new
    -- OAuth exchange is the only flow allowed to establish a different lineage.
    if v_job_operation <> 'oauth.exchange'
       and v_old_subject is not null
       and v_new_subject is distinct from v_old_subject then
      return jsonb_build_object('status', 'identity_mismatch');
    end if;
  end if;

  return public.sellerpilot_11820_prepare_refresh_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_secret_payload,
    p_expires_at,
    p_recovery_only,
    p_oauth_complete
  );
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

revoke all on function public.sellerpilot_11820_enqueue_listing_unsafe(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_enqueue_resource_unsafe(
  uuid, uuid, text, text, jsonb, text, text, text,
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_enqueue_channel_unsafe(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_enqueue_reply_unsafe(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_claim_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_touch_gateway_unsafe(text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_begin_completion_unsafe(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_complete_gateway_unsafe(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_begin_refresh_unsafe(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_11820_prepare_refresh_unsafe(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;
revoke all on function public.sellerpilot_service_enqueue_resource_gateway_job(
  uuid, uuid, text, text, jsonb, text, text, text,
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_resource_gateway_job(
  uuid, uuid, text, text, jsonb, text, text, text,
  uuid, uuid, uuid, text, text
) to service_role;
revoke all on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) to service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;
revoke all on function public.sellerpilot_claim_channel_gateway_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_channel_gateway_job(text, text)
  to service_role;
revoke all on function public.sellerpilot_touch_channel_gateway_job(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_touch_channel_gateway_job(text, uuid, uuid, text)
  to service_role;
revoke all on function public.sellerpilot_service_begin_channel_gateway_completion(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_channel_gateway_completion(
  text, uuid, uuid
) to service_role;
revoke all on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) to service_role;
revoke all on function public.sellerpilot_service_begin_gateway_credential_refresh(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_credential_refresh(
  text, uuid, uuid
) to service_role;
revoke all on function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) to service_role;

commit;
