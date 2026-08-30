-- Recover the exact production Lazada MY order-read that was quarantined
-- after the provider rotated its token but returned an incomplete account
-- identity. The rotated grant is already preserved in Vault. Never retry the
-- refresh and never infer a seller from user input: a live, claim-bound worker
-- may prove the preserved token only with Lazada's read-only /seller/get API.
-- The claim also cancels one separately fingerprinted, never-claimed stale read
-- that blocks this credential, and records enough audit state to reclaim this
-- exact snapshot if its pre-prepare read lease expires.

begin;

create function public.sellerpilot_service_claim_exact_lazada_recovery(
  p_token_hash text,
  p_job_id uuid,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_job_id constant uuid := '5ac7a12f-94d5-451f-bd47-3b07d86c21b8';
  v_expected_stale_job_id constant uuid := 'ad891738-693a-44e4-b0bc-f19539b6e980';
  v_expected_source_credential_id constant uuid := 'e54fa95d-ddfd-414f-82e9-636a0d9ab07c';
  v_expected_stale_request_sha256 constant text :=
    'a8d59a7fdd78fa570a68150e3ea3dfba4c3d5ba8e24d9458a818e15db38400c9';
  v_expected_stale_created_at constant timestamptz :=
    '2026-08-25T12:55:20.426414Z'::timestamptz;
  v_reaper_error constant text :=
    'Gateway write lease expired; provider outcome requires reconciliation.';
  v_token_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_owner_id uuid;
  v_source_credential_id uuid;
  v_prior_error text;
  v_recovery_fingerprint text;
  v_recovery_secret jsonb;
  v_recovery_expires_at timestamptz;
  v_stale_job record;
  v_cleanup_at timestamptz;
  v_result jsonb;
begin
  if p_job_id is distinct from v_expected_job_id
     or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid exact Lazada recovery request'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'gateway'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- Lock and validate every durable fact that makes this one recovery safe.
  -- The original operation is read-only, no provider write boundary was
  -- crossed, the active source remains version 5, and the snapshot is still
  -- the exact one attached to the quarantined job.
  select job.created_by,
         job.credential_id,
         job.error_message,
         job.credential_refresh_recovery_fingerprint,
         recovery_secret.decrypted_secret::jsonb
    into v_owner_id,
         v_source_credential_id,
         v_prior_error,
         v_recovery_fingerprint,
         v_recovery_secret
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join vault.decrypted_secrets active_secret
      on active_secret.id = credential.vault_secret_id
    join vault.decrypted_secrets recovery_secret
      on recovery_secret.id = job.credential_refresh_recovery_vault_id
    join vault.secrets recovery_secret_record
      on recovery_secret_record.id = job.credential_refresh_recovery_vault_id
   where job.id = v_expected_job_id
     and job.channel = 'lazada'
     and job.environment = 'production'
     and job.operation = 'orders.list'
     and job.status = 'reconciliation_required'
     and job.attempt_id is null
     and job.listing_id is null
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.completed_at is not null
     and job.prepared_credential_id is null
     and job.credential_refresh_fingerprint is null
     and job.credential_refresh_prepared_at is null
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_recovery_vault_id is not null
     and job.credential_refresh_recovery_fingerprint ~ '^[a-f0-9]{64}$'
     and job.credential_refresh_recovery_staged_at is not null
     and not job.oauth_exchange_completed
     and job.oauth_request_vault_id is null
     and job.oauth_request_fingerprint is null
     and job.oauth_source_credential_id is null
     and job.provider_mutation_started_at is null
     and job.response_payload is null
     and (
       job.error_message = 'LAZADA_ACCOUNT_IDENTITY_INVALID'
       or (
         job.error_message = v_reaper_error
         and exists (
           select 1
             from sellerpilot_private.operation_audit claim_audit
            where claim_audit.owner_id = job.created_by
              and claim_audit.action = 'lazada_credential_recovery_claimed'
              and claim_audit.entity_type = 'channel_gateway_job'
              and claim_audit.entity_id = job.id::text
              and claim_audit.safe_detail->>'recovery_snapshot_sha256'
                    = job.credential_refresh_recovery_fingerprint
              and claim_audit.safe_detail->>'provider_mutation_started' = 'false'
              and claim_audit.occurred_at >= job.credential_refresh_recovery_staged_at
              and claim_audit.occurred_at <= job.completed_at
         )
       )
     )
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.id = v_expected_source_credential_id
     and credential.version = 5
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key is null
     and credential.seller_account_key_source = 'legacy_unattested'
     and credential.seller_account_verified_at is null
     and credential.fingerprint = upper(substr(encode(
           extensions.digest(active_secret.decrypted_secret::jsonb::text, 'sha256'),
           'hex'
         ), 1, 12))
     and jsonb_typeof(active_secret.decrypted_secret::jsonb) = 'object'
     and jsonb_typeof(recovery_secret.decrypted_secret::jsonb) = 'object'
     and length(coalesce(recovery_secret.decrypted_secret::jsonb->>'access_token', '')) >= 8
     and length(coalesce(recovery_secret.decrypted_secret::jsonb->>'refresh_token', '')) >= 8
     and recovery_secret.decrypted_secret::jsonb->>'app_key'
           = active_secret.decrypted_secret::jsonb->>'app_key'
     and recovery_secret.decrypted_secret::jsonb->>'app_secret'
           = active_secret.decrypted_secret::jsonb->>'app_secret'
     and not (recovery_secret.decrypted_secret::jsonb ? 'provider_account_subject')
     and not (recovery_secret.decrypted_secret::jsonb ? 'provider_account_identity_version')
     and recovery_secret_record.name like
           'sellerpilot_gateway_recovery_lazada_' || v_expected_job_id::text || '_%'
     and lower(coalesce(
           nullif(recovery_secret.decrypted_secret::jsonb->>'country', ''),
           nullif(active_secret.decrypted_secret::jsonb->>'country', ''),
           'my'
         )) = 'my'
     and not exists (
       select 1
         from sellerpilot_private.channel_credentials other_active
        where other_active.channel = 'lazada'
          and other_active.environment = 'production'
          and other_active.status = 'active'
          and other_active.id <> credential.id
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_credentials newer_credential
        where newer_credential.channel = 'lazada'
          and newer_credential.environment = 'production'
          and newer_credential.version > 5
     )
   for update of job, credential;
  if not found then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  -- The job reference alone is not sufficient proof: bind it to the exact
  -- payload/expiry fingerprint produced when this claim staged the snapshot.
  begin
    v_recovery_expires_at :=
      (v_recovery_secret->>'refresh_token_expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('status', 'state_mismatch');
  end;
  if v_recovery_expires_at is null
     or v_recovery_expires_at <= clock_timestamp()
     or v_recovery_fingerprint is distinct from encode(extensions.digest(
       jsonb_build_object(
         'payload', v_recovery_secret,
         'expires_at', v_recovery_expires_at,
         'recovery_only', true
       )::text,
       'sha256'
     ), 'hex') then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  -- Observe every unrelated active row before changing the exact stale one.
  -- A third queued/running Lazada job must leave both exact jobs and the audit
  -- ledger byte-for-byte unchanged.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs active_job
     where active_job.channel = 'lazada'
       and active_job.environment = 'production'
       and active_job.status in ('queued', 'running')
       and active_job.id not in (v_expected_job_id, v_expected_stale_job_id)
  ) then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  -- One independently queued read for this same legacy credential predates the
  -- quarantined recovery. It cannot be rebound safely during rotation because
  -- its old queue slot blocks the exact recovery claim. Cancel only that one
  -- immutable, never-claimed, provider-read-only row. Its request body is not
  -- copied into this migration; the canonical jsonb digest and top-level shape
  -- are the fence. A committed cancellation is replayed only through its audit.
  select stale.*,
         encode(extensions.digest(stale.request_payload::text, 'sha256'), 'hex')
           as exact_request_sha256,
         (
           select pg_catalog.array_agg(request_key.key order by request_key.key)
             from jsonb_object_keys(stale.request_payload) as request_key(key)
         ) as exact_request_keys
    into v_stale_job
    from sellerpilot_private.channel_gateway_jobs stale
   where stale.id = v_expected_stale_job_id
   for update of stale;
  if not found then
    return jsonb_build_object('status', 'state_mismatch');
  end if;
  if v_stale_job.credential_id is distinct from v_expected_source_credential_id
     or v_stale_job.credential_id is distinct from v_source_credential_id
     or v_stale_job.created_by is distinct from v_owner_id
     or v_stale_job.channel is distinct from 'lazada'
     or v_stale_job.environment is distinct from 'production'
     or v_stale_job.operation is distinct from 'orders.list'
     or v_stale_job.attempt_count is distinct from 0
     or v_stale_job.attempt_id is not null
     or v_stale_job.listing_id is not null
     or v_stale_job.worker_token_id is not null
     or v_stale_job.claim_token is not null
     or v_stale_job.lease_expires_at is not null
     or v_stale_job.started_at is not null
     or v_stale_job.response_payload is not null
     or v_stale_job.seller_account_key is not null
     or v_stale_job.write_resource_kind is not null
     or v_stale_job.write_resource_key is not null
     or v_stale_job.request_fingerprint is not null
     or v_stale_job.inventory_item_id is not null
     or v_stale_job.order_id is not null
     or v_stale_job.shipment_carrier is not null
     or v_stale_job.shipment_tracking is not null
     or v_stale_job.prepared_credential_id is not null
     or v_stale_job.credential_refresh_fingerprint is not null
     or v_stale_job.credential_refresh_prepared_at is not null
     or v_stale_job.credential_refresh_in_flight
     or v_stale_job.credential_refresh_started_at is not null
     or v_stale_job.credential_refresh_recovery_vault_id is not null
     or v_stale_job.credential_refresh_recovery_fingerprint is not null
     or v_stale_job.credential_refresh_recovery_staged_at is not null
     or v_stale_job.oauth_exchange_completed
     or v_stale_job.oauth_request_vault_id is not null
     or v_stale_job.oauth_request_fingerprint is not null
     or v_stale_job.oauth_source_credential_id is not null
     or v_stale_job.provider_mutation_started_at is not null
     or v_stale_job.created_at is distinct from v_expected_stale_created_at
     or v_stale_job.exact_request_sha256 is distinct from v_expected_stale_request_sha256
     or v_stale_job.exact_request_keys is distinct from
          array['arguments', 'periodicKey']::text[] then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  if v_stale_job.status = 'queued' then
    if v_stale_job.updated_at is distinct from v_expected_stale_created_at
       or v_stale_job.completed_at is not null
       or v_stale_job.error_message is not null then
      return jsonb_build_object('status', 'state_mismatch');
    end if;

    v_cleanup_at := clock_timestamp();
    update sellerpilot_private.channel_gateway_jobs stale
       set status = 'cancelled',
           completed_at = v_cleanup_at,
           error_message = 'LAZADA_EXACT_STALE_READ_CANCELLED_FOR_CREDENTIAL_RECOVERY',
           updated_at = v_cleanup_at
     where stale.id = v_expected_stale_job_id
       and stale.status = 'queued'
       and stale.updated_at = v_expected_stale_created_at
       and stale.provider_mutation_started_at is null;
    if not found then
      return jsonb_build_object('status', 'state_mismatch');
    end if;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail, occurred_at
    ) values (
      v_owner_id,
      'lazada_exact_stale_read_cancelled',
      'channel_gateway_job',
      v_expected_stale_job_id::text,
      jsonb_build_object(
        'channel', 'lazada',
        'operation', 'orders.list',
        'source_job_id', v_expected_job_id,
        'source_credential_id', v_expected_source_credential_id,
        'request_sha256', v_expected_stale_request_sha256,
        'provider_call_started', false,
        'provider_mutation_started', false
      ),
      v_cleanup_at
    );
  elsif v_stale_job.status = 'cancelled' then
    if v_stale_job.error_message is distinct from
         'LAZADA_EXACT_STALE_READ_CANCELLED_FOR_CREDENTIAL_RECOVERY'
       or v_stale_job.completed_at is null
       or v_stale_job.updated_at is distinct from v_stale_job.completed_at
       or not exists (
         select 1
           from sellerpilot_private.operation_audit cleanup_audit
          where cleanup_audit.owner_id = v_owner_id
            and cleanup_audit.action = 'lazada_exact_stale_read_cancelled'
            and cleanup_audit.entity_type = 'channel_gateway_job'
            and cleanup_audit.entity_id = v_expected_stale_job_id::text
            and cleanup_audit.safe_detail->>'source_job_id' = v_expected_job_id::text
            and cleanup_audit.safe_detail->>'source_credential_id'
                  = v_expected_source_credential_id::text
            and cleanup_audit.safe_detail->>'request_sha256'
                  = v_expected_stale_request_sha256
            and cleanup_audit.safe_detail->>'provider_call_started' = 'false'
            and cleanup_audit.safe_detail->>'provider_mutation_started' = 'false'
            and cleanup_audit.occurred_at >= v_stale_job.completed_at
       ) then
      return jsonb_build_object('status', 'state_mismatch');
    end if;
  else
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  -- Close the narrow race with a concurrent enqueue that did not participate
  -- in this recovery advisory lock. Raising SPC02 enters the exception handler
  -- below, which rolls this function block (including cleanup/audit) back.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs active_job
     where active_job.channel = 'lazada'
       and active_job.environment = 'production'
       and active_job.status in ('queued', 'running')
       and active_job.id <> v_expected_job_id
  ) then
    raise exception 'exact Lazada active work changed during recovery'
      using errcode = 'SPC02';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(
           coalesce(nullif(trim(p_worker_version), ''), 'lazada-recovery/unknown'),
           80
         )
   where token.id = v_token_id;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         lease_expires_at = clock_timestamp() + interval '5 minutes',
         started_at = coalesce(job.started_at, clock_timestamp()),
         completed_at = null,
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_expected_job_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner_id,
    'lazada_credential_recovery_claimed',
    'channel_gateway_job',
    v_expected_job_id::text,
    jsonb_build_object(
      'channel', 'lazada',
      'operation', 'orders.list',
      'recovery_snapshot_sha256', v_recovery_fingerprint,
      'retry_after_lease_expiry', v_prior_error = v_reaper_error,
      'provider_mutation_started', false
    )
  );

  select jsonb_build_object(
    'status', 'claimed',
    'id', job.id,
    'claim_token', job.claim_token,
    'channel', job.channel,
    'operation', job.operation,
    'environment', job.environment,
    'request', job.request_payload,
    'credential', recovery_secret.decrypted_secret::jsonb
  )
    into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join vault.decrypted_secrets recovery_secret
      on recovery_secret.id = job.credential_refresh_recovery_vault_id
   where job.id = v_expected_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = v_claim_token
     and job.lease_expires_at > clock_timestamp();

  if v_result is null then
    raise exception 'exact Lazada recovery snapshot unavailable';
  end if;
  return v_result;
exception when sqlstate 'SPC02' then
  return jsonb_build_object('status', 'state_mismatch');
end;
$$;

create function public.sellerpilot_service_prepare_exact_lazada_recovery(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_read jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_job_id constant uuid := '5ac7a12f-94d5-451f-bd47-3b07d86c21b8';
  v_recovery_vault_id uuid;
  v_active_fingerprint text;
  v_recovery_fingerprint text;
  v_recovery_name text;
  v_active_secret jsonb;
  v_recovery_secret jsonb;
  v_provider_data jsonb;
  v_country_user jsonb;
  v_country text;
  v_seller_id text;
  v_user_id text;
  v_short_code text;
  v_provider_seller_id text;
  v_provider_short_code text;
  v_subject_source text;
  v_subject text;
  v_final_payload jsonb;
  v_expires_at timestamptz;
  v_prepared jsonb;
  v_prepared_credential_id uuid;
begin
  if p_job_id is distinct from v_expected_job_id
     or p_claim_token is null
     or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid exact Lazada recovery request'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);

  select job.credential_refresh_recovery_vault_id,
         credential.fingerprint,
         job.credential_refresh_recovery_fingerprint,
         recovery_secret_record.name,
         active_secret.decrypted_secret::jsonb,
         recovery_secret.decrypted_secret::jsonb
    into v_recovery_vault_id,
         v_active_fingerprint,
         v_recovery_fingerprint,
         v_recovery_name,
         v_active_secret,
         v_recovery_secret
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join vault.decrypted_secrets active_secret
      on active_secret.id = credential.vault_secret_id
    join vault.decrypted_secrets recovery_secret
      on recovery_secret.id = job.credential_refresh_recovery_vault_id
    join vault.secrets recovery_secret_record
      on recovery_secret_record.id = job.credential_refresh_recovery_vault_id
   where job.id = v_expected_job_id
     and job.channel = 'lazada'
     and job.environment = 'production'
     and job.operation = 'orders.list'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and job.prepared_credential_id is null
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_recovery_vault_id is not null
     and job.provider_mutation_started_at is null
     and worker_token.token_hash = p_token_hash
     and worker_token.scope = 'gateway'
     and worker_token.status = 'active'
     and worker_token.expires_at > clock_timestamp()
     and credential.version = 5
     and credential.status = 'active'
     and credential.seller_account_key is null
     and credential.seller_account_key_source = 'legacy_unattested'
     and credential.seller_account_verified_at is null
   for update of job, credential;
  if not found then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  begin
    v_expires_at := (v_recovery_secret->>'refresh_token_expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('status', 'identity_invalid');
  end;
  if v_expires_at is null
     or v_expires_at <= clock_timestamp()
     or v_active_fingerprint is distinct from upper(substr(encode(
       extensions.digest(v_active_secret::text, 'sha256'), 'hex'
     ), 1, 12))
     or coalesce(v_recovery_name, '') not like
       'sellerpilot_gateway_recovery_lazada_' || v_expected_job_id::text || '_%'
     or v_recovery_fingerprint is distinct from encode(extensions.digest(
       jsonb_build_object(
         'payload', v_recovery_secret,
         'expires_at', v_expires_at,
         'recovery_only', true
       )::text,
       'sha256'
     ), 'hex') then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  if p_provider_read is null
     or jsonb_typeof(p_provider_read) <> 'object'
     or octet_length(p_provider_read::text) > 32000
     or coalesce(p_provider_read->>'code', '') <> '0'
     or nullif(trim(coalesce(p_provider_read->>'error', '')), '') is not null
     or jsonb_typeof(p_provider_read->'data') <> 'object' then
    return jsonb_build_object('status', 'identity_invalid');
  end if;
  v_provider_data := p_provider_read->'data';
  v_provider_seller_id := nullif(trim(v_provider_data->>'seller_id'), '');
  v_provider_short_code := upper(nullif(trim(v_provider_data->>'short_code'), ''));
  if v_provider_seller_id is null
     or v_provider_seller_id !~ '^[1-9][0-9]{0,31}$'
     or v_provider_short_code is null
     or v_provider_short_code !~ '^[A-Z0-9_-]{1,64}$'
     or lower(coalesce(nullif(trim(v_provider_data->>'status'), ''), 'active')) <> 'active'
     or (
       v_provider_data ? 'is_active'
       and lower(coalesce(v_provider_data->>'is_active', '')) not in ('true', '1')
     ) then
    return jsonb_build_object('status', 'identity_invalid');
  end if;

  if jsonb_typeof(v_active_secret) <> 'object'
     or jsonb_typeof(v_recovery_secret) <> 'object'
     or v_recovery_secret ? 'provider_account_subject'
     or v_recovery_secret ? 'provider_account_identity_version'
     or length(coalesce(v_recovery_secret->>'access_token', '')) < 8
     or length(coalesce(v_recovery_secret->>'refresh_token', '')) < 8
     or v_recovery_secret->>'app_key' is distinct from v_active_secret->>'app_key'
     or v_recovery_secret->>'app_secret' is distinct from v_active_secret->>'app_secret'
     or lower(coalesce(nullif(v_recovery_secret->>'account_platform', ''), 'seller_center')) <> 'seller_center'
     or jsonb_typeof(v_recovery_secret->'country_user_info') <> 'array'
     or jsonb_array_length(v_recovery_secret->'country_user_info') <> 1 then
    return jsonb_build_object('status', 'identity_invalid');
  end if;

  v_country := lower(coalesce(
    nullif(v_recovery_secret->>'country', ''),
    nullif(v_active_secret->>'country', ''),
    'my'
  ));
  if v_country <> 'my'
     or (
       nullif(v_recovery_secret->>'country', '') is not null
       and lower(v_recovery_secret->>'country') <> 'my'
     )
     or (
       nullif(v_active_secret->>'country', '') is not null
       and lower(v_active_secret->>'country') <> 'my'
     ) then
    return jsonb_build_object('status', 'identity_mismatch');
  end if;

  v_country_user := v_recovery_secret->'country_user_info'->0;
  if jsonb_typeof(v_country_user) <> 'object' then
    return jsonb_build_object('status', 'identity_invalid');
  end if;
  v_seller_id := nullif(trim(v_country_user->>'seller_id'), '');
  v_user_id := nullif(trim(v_country_user->>'user_id'), '');
  v_short_code := upper(nullif(trim(v_country_user->>'short_code'), ''));
  if lower(coalesce(v_country_user->>'country', '')) <> v_country
     or v_seller_id is null
     or v_seller_id !~ '^[1-9][0-9]{0,31}$'
     or v_user_id is null
     or v_user_id !~ '^[1-9][0-9]{0,31}$'
     or (
       v_short_code is not null
       and v_short_code !~ '^[A-Z0-9_-]{1,64}$'
     ) then
    return jsonb_build_object('status', 'identity_invalid');
  end if;
  if v_seller_id is distinct from v_provider_seller_id
     or (
       v_short_code is not null
       and v_short_code is distinct from v_provider_short_code
     ) then
    return jsonb_build_object('status', 'identity_mismatch');
  end if;
  -- short_code is optional in older token payloads and is not part of the
  -- immutable subject tuple. When absent, accept it only from this same
  -- claim-bound GetSeller response; a present snapshot value must match.
  v_short_code := v_provider_short_code;

  -- Match normalizeLazadaProviderAccountIdentity(): JSON.stringify of the
  -- sorted [accountPlatform, [[country,sellerId,userId]]] tuple, base64url.
  -- All fields are tightly restricted above, so removing JSON whitespace is
  -- unambiguous and produces the same canonical bytes as the TypeScript path.
  v_subject_source := regexp_replace(
    jsonb_build_array(
      'seller_center',
      jsonb_build_array(jsonb_build_array(v_country, v_seller_id, v_user_id))
    )::text,
    '[[:space:]]+',
    '',
    'g'
  );
  v_subject := 'lazada:v1:' || regexp_replace(
    translate(
      encode(convert_to(v_subject_source, 'UTF8'), 'base64'),
      '+/',
      '-_'
    ),
    '[=[:space:]]+',
    '',
    'g'
  );
  if length(v_subject) not between 51 and 522
     or v_subject !~ '^lazada:v1:[A-Za-z0-9_-]+$' then
    return jsonb_build_object('status', 'identity_invalid');
  end if;

  v_final_payload := v_recovery_secret || jsonb_build_object(
    'country', v_country,
    'account_platform', 'seller_center',
    'country_user_info', jsonb_build_array(jsonb_build_object(
      'country', v_country,
      'seller_id', v_seller_id,
      'user_id', v_user_id,
      'short_code', v_short_code
    )),
    'provider_account_identity_version', 'v1',
    'provider_account_subject', v_subject
  );

  -- This marker exists only inside the same transaction as preparation. Any
  -- exception rolls it back together with credential rotation and Vault
  -- cleanup, leaving the recovery snapshot referenced by the job.
  update sellerpilot_private.channel_gateway_jobs job
     set credential_refresh_in_flight = true,
         credential_refresh_started_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = v_expected_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.credential_refresh_recovery_vault_id = v_recovery_vault_id
     and not job.credential_refresh_in_flight
     and job.provider_mutation_started_at is null;
  if not found then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  v_prepared := public.sellerpilot_service_prepare_gateway_credential_refresh(
    p_token_hash,
    v_expected_job_id,
    p_claim_token,
    v_final_payload,
    v_expires_at,
    false,
    false
  );
  if coalesce(v_prepared->>'status', '') <> 'prepared' then
    raise exception 'exact Lazada recovery preparation failed';
  end if;
  begin
    v_prepared_credential_id := (v_prepared->>'credential_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'exact Lazada recovery credential identity invalid';
  end;

  update sellerpilot_private.channel_credentials credential
     set last_checked_at = clock_timestamp(),
         last_check_status = 'passed',
         last_check_message = 'Lazada MY seller identity verified by claim-bound read-only recovery.'
   where credential.id = v_prepared_credential_id
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = 6
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'exact Lazada recovered credential certification failed';
  end if;

  return jsonb_build_object(
    'status', 'prepared',
    'credentialId', v_prepared_credential_id
  );
end;
$$;

create function public.sellerpilot_service_abort_exact_lazada_recovery(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_job_id constant uuid := '5ac7a12f-94d5-451f-bd47-3b07d86c21b8';
  v_owner_id uuid;
  v_updated integer;
begin
  if p_job_id is distinct from v_expected_job_id
     or p_claim_token is null
     or p_reason is null
     or p_reason not in (
       'provider_read_transient',
       'snapshot_rejected',
       'identity_invalid',
       'identity_mismatch'
     ) then
    raise exception 'invalid exact Lazada recovery abort';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);
  select job.created_by
    into v_owner_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
   where job.id = v_expected_job_id
     and job.channel = 'lazada'
     and job.environment = 'production'
     and job.operation = 'orders.list'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and job.prepared_credential_id is null
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_recovery_vault_id is not null
     and job.provider_mutation_started_at is null
     and worker_token.token_hash = p_token_hash
     and worker_token.scope = 'gateway'
     and worker_token.status = 'active'
     and worker_token.expires_at > clock_timestamp()
   for update of job;
  if not found then return false; end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'reconciliation_required',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         error_message = case
           when p_reason = 'provider_read_transient'
             then 'LAZADA_ACCOUNT_IDENTITY_INVALID'
           when p_reason = 'snapshot_rejected'
             then 'LAZADA_RECOVERY_SNAPSHOT_REJECTED'
           else 'LAZADA_RECOVERY_ACCOUNT_IDENTITY_MISMATCH'
         end,
         updated_at = clock_timestamp()
   where job.id = v_expected_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.credential_refresh_recovery_vault_id is not null
     and job.provider_mutation_started_at is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner_id,
    'lazada_credential_recovery_preserved',
    'channel_gateway_job',
    v_expected_job_id::text,
    jsonb_build_object(
      'channel', 'lazada',
      'operation', 'orders.list',
      'reason', p_reason,
      'recovery_snapshot_preserved', true,
      'provider_mutation_started', false
    )
  );
  return true;
end;
$$;

create function public.sellerpilot_service_finish_exact_lazada_recovery(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_job_id constant uuid := '5ac7a12f-94d5-451f-bd47-3b07d86c21b8';
  v_job record;
  v_replacement_id uuid;
begin
  if p_job_id is distinct from v_expected_job_id
     or p_claim_token is null then
    raise exception 'invalid exact Lazada recovery finish';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);
  select job.id,
         job.created_by,
         job.request_payload,
         job.credential_id,
         credential.seller_account_key
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.id = job.prepared_credential_id
    join sellerpilot_private.channel_credentials source_credential
      on source_credential.channel = 'lazada'
     and source_credential.environment = 'production'
     and source_credential.version = 5
    join vault.decrypted_secrets credential_secret
      on credential_secret.id = credential.vault_secret_id
   where job.id = v_expected_job_id
     and job.channel = 'lazada'
     and job.environment = 'production'
     and job.operation = 'orders.list'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_recovery_vault_id is null
     and job.credential_refresh_recovery_fingerprint is null
     and job.credential_refresh_recovery_staged_at is null
     and job.provider_mutation_started_at is null
     and worker_token.token_hash = p_token_hash
     and worker_token.scope = 'gateway'
     and worker_token.status = 'active'
     and worker_token.expires_at > clock_timestamp()
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.version = 6
     and credential.status = 'active'
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.last_check_status = 'passed'
     and credential.last_checked_at >= job.credential_refresh_prepared_at
     and credential_secret.decrypted_secret::jsonb->>'provider_account_identity_version' = 'v1'
     and credential_secret.decrypted_secret::jsonb->>'provider_account_subject'
           ~ '^lazada:v1:[A-Za-z0-9_-]+$'
     and source_credential.status = 'revoked'
   for update of job, credential;
  if not found then
    return jsonb_build_object('status', 'state_mismatch');
  end if;

  -- Close the poisoned active row before inserting its replacement. The
  -- active-periodic-read unique index covers the same credential/key; doing
  -- both in this transaction keeps the handoff atomic without disabling it.
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         error_message = 'LAZADA_CREDENTIAL_RECOVERED_READ_REQUEUED',
         updated_at = clock_timestamp()
   where job.id = v_expected_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.provider_mutation_started_at is null;
  if not found then
    raise exception 'exact Lazada recovery ownership lost';
  end if;

  select replacement.id
    into v_replacement_id
    from sellerpilot_private.channel_gateway_jobs replacement
   where replacement.id <> v_expected_job_id
     and replacement.credential_id = v_job.credential_id
     and replacement.channel = 'lazada'
     and replacement.environment = 'production'
     and replacement.operation = 'orders.list'
     and replacement.status in ('queued', 'running')
     and replacement.seller_account_key = v_job.seller_account_key
     and left(coalesce(
           nullif(trim(replacement.request_payload->>'periodicKey'), ''),
           md5(replacement.request_payload::text)
         ), 120) = left(coalesce(
           nullif(trim(v_job.request_payload->>'periodicKey'), ''),
           md5(v_job.request_payload::text)
         ), 120)
   order by replacement.created_at, replacement.id
   limit 1;

  if v_replacement_id is null then
    v_replacement_id := gen_random_uuid();
    insert into sellerpilot_private.channel_gateway_jobs (
      id, credential_id, attempt_id, channel, operation, environment,
      request_payload, created_by
    ) values (
      v_replacement_id,
      v_job.credential_id,
      null,
      'lazada',
      'orders.list',
      'production',
      v_job.request_payload || jsonb_build_object(
        'credentialRecoverySourceJobId', v_expected_job_id
      ),
      v_job.created_by
    );
  end if;

  insert into sellerpilot_private.channel_sync_state (
    owner_id, channel_key, data_type, status, imported_count,
    last_started_at, last_error, updated_at
  ) values (
    v_job.created_by, 'lazada', 'orders', 'queued', 0,
    clock_timestamp(), null, clock_timestamp()
  )
  on conflict (owner_id, channel_key, data_type) do update set
    status = 'queued',
    last_started_at = excluded.last_started_at,
    last_error = null,
    updated_at = excluded.updated_at;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_job.created_by,
    'lazada_credential_recovery_requeued',
    'channel_gateway_job',
    v_expected_job_id::text,
    jsonb_build_object(
      'channel', 'lazada',
      'operation', 'orders.list',
      'replacement_job_id', v_replacement_id,
      'source_credential_version', 5,
      'prepared_credential_version', 6,
      'provider_identity_verified', true,
      'provider_mutation_started', false
    )
  );

  return jsonb_build_object(
    'status', 'requeued',
    'replacementJobId', v_replacement_id
  );
end;
$$;

revoke all on function public.sellerpilot_service_claim_exact_lazada_recovery(
  text, uuid, text
) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_prepare_exact_lazada_recovery(
  text, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_abort_exact_lazada_recovery(
  text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.sellerpilot_service_finish_exact_lazada_recovery(
  text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.sellerpilot_service_claim_exact_lazada_recovery(
  text, uuid, text
) to service_role;
grant execute on function public.sellerpilot_service_prepare_exact_lazada_recovery(
  text, uuid, uuid, jsonb
) to service_role;
grant execute on function public.sellerpilot_service_abort_exact_lazada_recovery(
  text, uuid, uuid, text
) to service_role;
grant execute on function public.sellerpilot_service_finish_exact_lazada_recovery(
  text, uuid, uuid
) to service_role;

comment on function public.sellerpilot_service_claim_exact_lazada_recovery(
  text, uuid, text
) is 'Cancels only fingerprinted stale read ad891738, then claims only recovery job 5ac7a12f after exact no-provider-write, Vault-snapshot, and lease-reclaim checks.';
comment on function public.sellerpilot_service_prepare_exact_lazada_recovery(
  text, uuid, uuid, jsonb
) is 'Matches a claim-bound GET /seller/get response to the exact recovery Vault snapshot before atomic Lazada credential certification.';
comment on function public.sellerpilot_service_abort_exact_lazada_recovery(
  text, uuid, uuid, text
) is 'Returns the exact Lazada recovery claim to reconciliation without deleting or releasing its Vault snapshot.';
comment on function public.sellerpilot_service_finish_exact_lazada_recovery(
  text, uuid, uuid
) is 'Cancels only the poisoned read and enqueues one fresh read after exact prepared credential certification and no provider mutation.';

commit;
