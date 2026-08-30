-- The exact preserved Lazada grant proved unusable because its token response
-- omitted country_user_info. The later seller-authorized OAuth code remained
-- unclaimed until less than five minutes of its provider lifetime remained, so
-- it is no longer safe to release into the inactive runtime. Discard only these
-- two exact Vault snapshots after proving that no provider call, mutation, or
-- credential rotation occurred. A new authorization will be requested only
-- after the exact deployed runtime is active.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $discard_exact_rejected_lazada_recovery$
declare
  v_recovery_job_id constant uuid :=
    '5ac7a12f-94d5-451f-bd47-3b07d86c21b8'::uuid;
  v_fresh_oauth_job_id constant uuid :=
    '705b572c-1e08-4f56-a74a-bc1fb53175ae'::uuid;
  v_source_credential_id constant uuid :=
    'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid;
  v_recovery_vault_id constant uuid :=
    '312705aa-9a16-4c2e-bc3a-32e743ec41e6'::uuid;
  v_oauth_vault_id constant uuid :=
    'd5462aa4-bc3d-4258-8f6a-e0b19d6cef79'::uuid;
  v_recovery_request_sha256 constant text :=
    'ba9a002eeee680dc5224aff75a3797f2c0e643b21f8433768c7684db11adf8c5';
  v_oauth_request_sha256 constant text :=
    '80195afdac6cc858bc28a90503910ef16f1ae1cfd80e906a3206e8d5192b475d';
  v_recovery_created_at constant timestamptz :=
    '2026-08-25T12:54:05.823863Z'::timestamptz;
  v_recovery_started_at constant timestamptz :=
    '2026-08-25T12:54:41.356793Z'::timestamptz;
  v_recovery_rejected_at constant timestamptz :=
    '2026-08-30T07:42:13.312764Z'::timestamptz;
  v_oauth_created_at constant timestamptz :=
    '2026-08-30T07:49:58.027035Z'::timestamptz;
  v_recovery_terminal_error constant text :=
    'LAZADA_REJECTED_RECOVERY_DISCARDED_FOR_REAUTHORIZATION';
  v_oauth_terminal_error constant text :=
    'LAZADA_OAUTH_CODE_DISCARDED_OUTSIDE_SAFE_WINDOW';
  v_recovery_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_oauth_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_source_credential sellerpilot_private.channel_credentials%rowtype;
  v_recovery_vault_name text;
  v_recovery_secret jsonb;
  v_recovery_expires_at timestamptz;
  v_recovery_snapshot_sha256 text;
  v_oauth_vault_name text;
  v_oauth_secret jsonb;
  v_oauth_fingerprint text;
  v_oauth_payload_type text;
  v_oauth_payload_keys text[];
  v_oauth_code_present boolean;
  v_cleanup_at timestamptz;
  v_deleted integer;
begin
  -- Match the exact recovery, generic gateway enqueue/claim, and credential
  -- rotation serialization order. Short table locks also fence privileged
  -- direct writes that do not pass through those public functions.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:lazada:production')
  );
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;
  lock table sellerpilot_private.channel_credentials
    in share row exclusive mode;
  -- Hosted Supabase grants postgres SELECT and DELETE, but not UPDATE, on
  -- vault.secrets. A table lock preserves the exact verify/delete fence
  -- without requiring the UPDATE privilege that SELECT ... FOR UPDATE needs.
  lock table vault.secrets
    in share row exclusive mode;

  select job.*
    into v_recovery_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_recovery_job_id
   for update;
  if not found then
    return;
  end if;

  select job.*
    into v_oauth_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_fresh_oauth_job_id
   for update;
  if not found then
    raise exception 'observed Lazada OAuth exchange is unavailable';
  end if;

  select credential.*
    into v_source_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_source_credential_id
   for update;
  if not found then
    raise exception 'exact Lazada source credential is unavailable';
  end if;

  -- Supabase does not replay an applied migration, but keep the operation
  -- idempotent for local/bootstrap databases and reject a partial terminal row.
  if v_recovery_job.status = 'cancelled' then
    if v_recovery_job.channel is distinct from 'lazada'
       or v_recovery_job.environment is distinct from 'production'
       or v_recovery_job.operation is distinct from 'orders.list'
       or v_recovery_job.credential_id is distinct from v_source_credential_id
       or v_recovery_job.created_by is distinct from v_oauth_job.created_by
       or v_recovery_job.created_by is distinct from
         v_source_credential.created_by
       or v_recovery_job.attempt_count is distinct from 1
       or v_recovery_job.attempt_id is not null
       or v_recovery_job.listing_id is not null
       or v_recovery_job.created_at is distinct from v_recovery_created_at
       or v_recovery_job.started_at is distinct from v_recovery_started_at
       or v_recovery_job.error_message is distinct from
         v_recovery_terminal_error
       or v_recovery_job.credential_refresh_recovery_vault_id is not null
       or v_recovery_job.credential_refresh_recovery_fingerprint is not null
       or v_recovery_job.credential_refresh_recovery_staged_at is not null
       or v_recovery_job.credential_refresh_in_flight is distinct from false
       or v_recovery_job.credential_refresh_started_at is not null
       or v_recovery_job.prepared_credential_id is not null
       or v_recovery_job.credential_refresh_fingerprint is not null
       or v_recovery_job.credential_refresh_prepared_at is not null
       or v_recovery_job.oauth_request_vault_id is not null
       or v_recovery_job.oauth_request_fingerprint is not null
       or v_recovery_job.oauth_source_credential_id is not null
       or v_recovery_job.oauth_exchange_completed is distinct from false
       or v_recovery_job.provider_mutation_started_at is not null
       or v_recovery_job.worker_token_id is not null
       or v_recovery_job.claim_token is not null
       or v_recovery_job.lease_expires_at is not null
       or v_recovery_job.response_payload is not null
       or v_recovery_job.seller_account_key is not null
       or v_recovery_job.write_resource_kind is not null
       or v_recovery_job.write_resource_key is not null
       or v_recovery_job.request_fingerprint is not null
       or v_recovery_job.inventory_item_id is not null
       or v_recovery_job.order_id is not null
       or v_recovery_job.shipment_carrier is not null
       or v_recovery_job.shipment_tracking is not null
       or v_recovery_job.completed_at is null
       or v_recovery_job.updated_at is distinct from
         v_recovery_job.completed_at
       or encode(extensions.digest(
         v_recovery_job.request_payload::text,
         'sha256'
       ), 'hex') is distinct from v_recovery_request_sha256
       or exists (
         select 1 from vault.secrets secret
          where secret.id = v_recovery_vault_id
       )
       or v_oauth_job.channel is distinct from 'lazada'
       or v_oauth_job.environment is distinct from 'production'
       or v_oauth_job.operation is distinct from 'oauth.exchange'
       or v_oauth_job.status is distinct from 'cancelled'
       or v_oauth_job.error_message is distinct from v_oauth_terminal_error
       or v_oauth_job.attempt_count is distinct from 0
       or v_oauth_job.credential_id is distinct from v_source_credential_id
       or v_oauth_job.attempt_id is not null
       or v_oauth_job.listing_id is not null
       or v_oauth_job.started_at is not null
       or v_oauth_job.created_at is distinct from v_oauth_created_at
       or v_oauth_job.oauth_request_vault_id is not null
       or not coalesce(
         v_oauth_job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$',
         false
       )
       or v_oauth_job.oauth_source_credential_id is distinct from
         v_source_credential_id
       or v_oauth_job.oauth_exchange_completed is distinct from false
       or v_oauth_job.credential_refresh_in_flight is distinct from false
       or v_oauth_job.credential_refresh_started_at is not null
       or v_oauth_job.prepared_credential_id is not null
       or v_oauth_job.credential_refresh_fingerprint is not null
       or v_oauth_job.credential_refresh_prepared_at is not null
       or v_oauth_job.credential_refresh_recovery_vault_id is not null
       or v_oauth_job.credential_refresh_recovery_fingerprint is not null
       or v_oauth_job.credential_refresh_recovery_staged_at is not null
       or v_oauth_job.provider_mutation_started_at is not null
       or v_oauth_job.worker_token_id is not null
       or v_oauth_job.claim_token is not null
       or v_oauth_job.lease_expires_at is not null
       or v_oauth_job.response_payload is not null
       or v_oauth_job.seller_account_key is not null
       or v_oauth_job.write_resource_kind is not null
       or v_oauth_job.write_resource_key is not null
       or v_oauth_job.request_fingerprint is not null
       or v_oauth_job.inventory_item_id is not null
       or v_oauth_job.order_id is not null
       or v_oauth_job.shipment_carrier is not null
       or v_oauth_job.shipment_tracking is not null
       or v_oauth_job.completed_at is null
       or v_oauth_job.completed_at is distinct from
         v_recovery_job.completed_at
       or v_oauth_job.updated_at is distinct from v_oauth_job.completed_at
       or encode(extensions.digest(
         v_oauth_job.request_payload::text,
         'sha256'
       ), 'hex') is distinct from v_oauth_request_sha256
       or exists (
         select 1 from vault.secrets secret
          where secret.id = v_oauth_vault_id
       )
       or (
         select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.owner_id = v_recovery_job.created_by
            and audit.action =
              'lazada_rejected_recovery_discarded_for_reauthorization'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_recovery_job_id::text
       ) <> 1
       or (
         select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.owner_id = v_recovery_job.created_by
            and audit.action =
              'lazada_rejected_recovery_discarded_for_reauthorization'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_recovery_job_id::text
            and audit.safe_detail->>'channel' = 'lazada'
            and audit.safe_detail->>'operation' = 'orders.list'
            and audit.safe_detail->>'reason' =
              'runtime_first_seller_reauthorization'
            and audit.safe_detail->>'fresh_oauth_job_id' =
              v_fresh_oauth_job_id::text
            and audit.safe_detail->>'source_credential_id' =
              v_source_credential_id::text
            and audit.safe_detail->>'recovery_vault_id' =
              v_recovery_vault_id::text
            and audit.safe_detail->>'discarded_oauth_vault_id' =
              v_oauth_vault_id::text
            and audit.safe_detail->>'recovery_job_request_sha256' =
              v_recovery_request_sha256
            and audit.safe_detail->>'fresh_oauth_job_request_sha256' =
              v_oauth_request_sha256
            and coalesce(
              audit.safe_detail->>'recovery_snapshot_sha256',
              ''
            ) ~ '^[a-f0-9]{64}$'
            and audit.safe_detail->>'recovery_snapshot_sha256' = (
              select claimed.safe_detail->>'recovery_snapshot_sha256'
                from sellerpilot_private.operation_audit claimed
               where claimed.owner_id = v_recovery_job.created_by
                 and claimed.action = 'lazada_credential_recovery_claimed'
                 and claimed.entity_type = 'channel_gateway_job'
                 and claimed.entity_id = v_recovery_job_id::text
               order by claimed.occurred_at desc, claimed.id desc
               limit 1
            )
            and coalesce(
              audit.safe_detail->>'fresh_oauth_fingerprint',
              ''
            ) ~ '^[a-f0-9]{64}$'
            and audit.safe_detail->>'fresh_oauth_fingerprint' = (
              select oauth_job.oauth_request_fingerprint
                from sellerpilot_private.channel_gateway_jobs oauth_job
               where oauth_job.id = v_fresh_oauth_job_id
            )
            and audit.safe_detail->>'provider_call_started_during_cleanup' =
              'false'
            and audit.safe_detail->>'provider_mutation_started' = 'false'
            and audit.safe_detail->>'credential_rotated_during_cleanup' =
              'false'
            and audit.safe_detail->>'recovery_snapshot_discarded' = 'true'
            and audit.safe_detail->>'oauth_code_discarded' = 'true'
            and audit.safe_detail->>'oauth_code_sent_to_provider' = 'false'
            and (
              select count(*)
                from jsonb_object_keys(audit.safe_detail)
            ) = 17
            and audit.occurred_at = v_recovery_job.completed_at
       ) <> 1
       or (
         select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.owner_id = v_oauth_job.created_by
            and audit.action =
              'lazada_oauth_discarded_outside_safe_window'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_fresh_oauth_job_id::text
       ) <> 1
       or (
         select count(*)
           from sellerpilot_private.operation_audit audit
          where audit.owner_id = v_oauth_job.created_by
            and audit.action =
              'lazada_oauth_discarded_outside_safe_window'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_fresh_oauth_job_id::text
            and audit.safe_detail->>'channel' = 'lazada'
            and audit.safe_detail->>'operation' = 'oauth.exchange'
            and audit.safe_detail->>'reason' =
              'runtime_inactive_outside_safe_window'
            and audit.safe_detail->>'source_credential_id' =
              v_source_credential_id::text
            and audit.safe_detail->>'oauth_vault_id' =
              v_oauth_vault_id::text
            and audit.safe_detail->>'oauth_job_request_sha256' =
              v_oauth_request_sha256
            and audit.safe_detail->>'oauth_fingerprint' =
              v_oauth_job.oauth_request_fingerprint
            and audit.safe_detail->>'safe_window_minutes' = '25'
            and audit.safe_detail->>'oauth_code_sent_to_provider' = 'false'
            and audit.safe_detail->>'provider_mutation_started' = 'false'
            and audit.safe_detail->>'credential_rotated' = 'false'
            and (
              select count(*)
                from jsonb_object_keys(audit.safe_detail)
            ) = 11
            and audit.occurred_at = v_oauth_job.completed_at
       ) <> 1 then
      raise exception
        'exact Lazada cleanup no longer matches terminal evidence';
    end if;
    return;
  end if;

  select secret.name,
         decrypted.decrypted_secret::jsonb
    into v_recovery_vault_name,
         v_recovery_secret
    from vault.secrets secret
   join vault.decrypted_secrets decrypted on decrypted.id = secret.id
   where secret.id = v_recovery_vault_id;
  if not found then
    raise exception 'exact Lazada recovery Vault snapshot is unavailable';
  end if;

  select secret.name,
         decrypted.decrypted_secret::jsonb,
         jsonb_typeof(decrypted.decrypted_secret::jsonb),
         (
           select pg_catalog.array_agg(payload_key.key order by payload_key.key)
             from jsonb_object_keys(decrypted.decrypted_secret::jsonb)
                  as payload_key(key)
         ),
         length(coalesce(decrypted.decrypted_secret::jsonb->>'code', '')) >= 8
    into v_oauth_vault_name,
         v_oauth_secret,
         v_oauth_payload_type,
         v_oauth_payload_keys,
         v_oauth_code_present
    from vault.secrets secret
    join vault.decrypted_secrets decrypted on decrypted.id = secret.id
   where secret.id = v_oauth_job.oauth_request_vault_id;
  if not found then
    raise exception 'fresh Lazada OAuth code is unavailable';
  end if;

  begin
    v_recovery_expires_at :=
      (v_recovery_secret->>'refresh_token_expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'exact Lazada recovery snapshot expiry is invalid';
  end;
  v_recovery_snapshot_sha256 := encode(extensions.digest(
    jsonb_build_object(
      'payload', v_recovery_secret,
      'expires_at', v_recovery_expires_at,
      'recovery_only', true
    )::text,
    'sha256'
  ), 'hex');
  v_oauth_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'channel', 'lazada',
      'code', trim(v_oauth_secret->>'code')
    )::text,
    'sha256'
  ), 'hex');

  if v_recovery_job.channel is distinct from 'lazada'
     or v_recovery_job.environment is distinct from 'production'
     or v_recovery_job.operation is distinct from 'orders.list'
     or v_recovery_job.status is distinct from 'reconciliation_required'
     or v_recovery_job.error_message is distinct from
       'LAZADA_RECOVERY_SNAPSHOT_REJECTED'
     or v_recovery_job.attempt_count is distinct from 1
     or v_recovery_job.credential_id is distinct from v_source_credential_id
     or v_recovery_job.attempt_id is not null
     or v_recovery_job.listing_id is not null
     or v_recovery_job.worker_token_id is not null
     or v_recovery_job.claim_token is not null
     or v_recovery_job.lease_expires_at is not null
     or v_recovery_job.prepared_credential_id is not null
     or v_recovery_job.credential_refresh_fingerprint is not null
     or v_recovery_job.credential_refresh_prepared_at is not null
     or v_recovery_job.credential_refresh_in_flight is distinct from false
     or v_recovery_job.credential_refresh_started_at is not null
     or v_recovery_job.credential_refresh_recovery_vault_id is distinct from
       v_recovery_vault_id
     or not coalesce(
       v_recovery_job.credential_refresh_recovery_fingerprint
         ~ '^[a-f0-9]{64}$',
       false
     )
     or v_recovery_job.credential_refresh_recovery_staged_at is null
     or v_recovery_job.oauth_request_vault_id is not null
     or v_recovery_job.oauth_request_fingerprint is not null
     or v_recovery_job.oauth_source_credential_id is not null
     or v_recovery_job.oauth_exchange_completed is distinct from false
     or v_recovery_job.provider_mutation_started_at is not null
     or v_recovery_job.response_payload is not null
     or v_recovery_job.seller_account_key is not null
     or v_recovery_job.write_resource_kind is not null
     or v_recovery_job.write_resource_key is not null
     or v_recovery_job.request_fingerprint is not null
     or v_recovery_job.inventory_item_id is not null
     or v_recovery_job.order_id is not null
     or v_recovery_job.shipment_carrier is not null
     or v_recovery_job.shipment_tracking is not null
     or v_recovery_job.created_at is distinct from v_recovery_created_at
     or v_recovery_job.started_at is distinct from v_recovery_started_at
     or v_recovery_job.completed_at is distinct from v_recovery_rejected_at
     or v_recovery_job.updated_at is distinct from v_recovery_rejected_at
     or encode(extensions.digest(
       v_recovery_job.request_payload::text,
       'sha256'
     ), 'hex') is distinct from v_recovery_request_sha256
     or (
       select pg_catalog.array_agg(request_key.key order by request_key.key)
         from jsonb_object_keys(v_recovery_job.request_payload)
              as request_key(key)
     ) is distinct from array['arguments']::text[]
     or v_recovery_vault_name not like
       'sellerpilot_gateway_recovery_lazada_' ||
       v_recovery_job_id::text || '_%'
     or jsonb_typeof(v_recovery_secret) is distinct from 'object'
     or length(coalesce(v_recovery_secret->>'access_token', '')) < 8
     or length(coalesce(v_recovery_secret->>'refresh_token', '')) < 8
     or v_recovery_expires_at is null
     or v_recovery_snapshot_sha256 is distinct from
       v_recovery_job.credential_refresh_recovery_fingerprint then
    raise exception
      'observed Lazada recovery no longer matches exact rejected evidence';
  end if;

  if v_oauth_job.channel is distinct from 'lazada'
     or v_oauth_job.environment is distinct from 'production'
     or v_oauth_job.operation is distinct from 'oauth.exchange'
     or v_oauth_job.status is distinct from 'queued'
     or v_oauth_job.error_message is not null
     or v_oauth_job.attempt_count is distinct from 0
     or v_oauth_job.credential_id is distinct from v_source_credential_id
     or v_oauth_job.attempt_id is not null
     or v_oauth_job.listing_id is not null
     or v_oauth_job.worker_token_id is not null
     or v_oauth_job.claim_token is not null
     or v_oauth_job.lease_expires_at is not null
     or v_oauth_job.started_at is not null
     or v_oauth_job.completed_at is not null
     or v_oauth_job.prepared_credential_id is not null
     or v_oauth_job.credential_refresh_fingerprint is not null
     or v_oauth_job.credential_refresh_prepared_at is not null
     or v_oauth_job.credential_refresh_in_flight is distinct from false
     or v_oauth_job.credential_refresh_started_at is not null
     or v_oauth_job.credential_refresh_recovery_vault_id is not null
     or v_oauth_job.credential_refresh_recovery_fingerprint is not null
     or v_oauth_job.credential_refresh_recovery_staged_at is not null
     or v_oauth_job.oauth_request_vault_id is distinct from v_oauth_vault_id
     or not coalesce(v_oauth_job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$', false)
     or v_oauth_job.oauth_source_credential_id is distinct from
       v_source_credential_id
     or v_oauth_job.oauth_exchange_completed is distinct from false
     or v_oauth_job.provider_mutation_started_at is not null
     or v_oauth_job.response_payload is not null
     or v_oauth_job.seller_account_key is not null
     or v_oauth_job.write_resource_kind is not null
     or v_oauth_job.write_resource_key is not null
     or v_oauth_job.request_fingerprint is not null
     or v_oauth_job.inventory_item_id is not null
     or v_oauth_job.order_id is not null
     or v_oauth_job.shipment_carrier is not null
     or v_oauth_job.shipment_tracking is not null
     or v_oauth_job.created_at is distinct from v_oauth_created_at
     or v_oauth_job.updated_at is distinct from v_oauth_created_at
     or clock_timestamp() < v_oauth_created_at + interval '25 minutes'
     or encode(extensions.digest(
       v_oauth_job.request_payload::text,
       'sha256'
     ), 'hex') is distinct from v_oauth_request_sha256
     or (
       select pg_catalog.array_agg(request_key.key order by request_key.key)
         from jsonb_object_keys(v_oauth_job.request_payload)
              as request_key(key)
     ) is distinct from array['vaultBacked']::text[]
     or v_oauth_vault_name not like
       'sellerpilot_gateway_oauth_' || v_fresh_oauth_job_id::text || '_%'
     or v_oauth_payload_type is distinct from 'object'
     or v_oauth_payload_keys is distinct from array['code']::text[]
     or v_oauth_code_present is distinct from true
     or v_oauth_fingerprint is distinct from
       v_oauth_job.oauth_request_fingerprint then
    raise exception
      'observed Lazada OAuth exchange no longer matches exact unclaimed evidence';
  end if;

  if v_source_credential.channel is distinct from 'lazada'
     or v_source_credential.environment is distinct from 'production'
     or v_source_credential.version is distinct from 5
     or v_source_credential.status is distinct from 'active'
     or (
       v_source_credential.expires_at is not null
       and v_source_credential.expires_at <= clock_timestamp()
     )
     or v_source_credential.seller_account_key is not null
     or v_source_credential.seller_account_key_source is distinct from
       'legacy_unattested'
     or v_source_credential.seller_account_verified_at is not null
     or v_recovery_job.created_by is distinct from v_oauth_job.created_by
     or v_recovery_job.created_by is distinct from
       v_source_credential.created_by
     or exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.channel = 'lazada'
          and credential.environment = 'production'
          and credential.status = 'active'
          and credential.id <> v_source_credential_id
     )
     or exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.channel = 'lazada'
          and credential.environment = 'production'
          and credential.version > 5
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.channel = 'lazada'
          and active_job.environment = 'production'
          and active_job.status in ('queued', 'running')
          and active_job.id <> v_fresh_oauth_job_id
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs unresolved
        where unresolved.channel = 'lazada'
          and unresolved.environment = 'production'
          and unresolved.status = 'reconciliation_required'
          and unresolved.id <> v_recovery_job_id
          and (
            unresolved.credential_refresh_in_flight
            or unresolved.credential_refresh_recovery_vault_id is not null
            or (
              unresolved.operation = 'oauth.exchange'
              and unresolved.prepared_credential_id is not null
              and not unresolved.oauth_exchange_completed
            )
          )
     )
     or (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs reference_job
        where reference_job.credential_refresh_recovery_vault_id =
          v_recovery_vault_id
           or reference_job.oauth_request_vault_id = v_recovery_vault_id
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.vault_secret_id = v_recovery_vault_id
     )
     or (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs reference_job
        where reference_job.credential_refresh_recovery_vault_id =
          v_oauth_vault_id
           or reference_job.oauth_request_vault_id = v_oauth_vault_id
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.vault_secret_id = v_oauth_vault_id
     )
     or (
       select count(*)
         from sellerpilot_private.operation_audit audit
        where audit.owner_id = v_recovery_job.created_by
          and audit.action = 'lazada_credential_recovery_claimed'
          and audit.entity_type = 'channel_gateway_job'
          and audit.entity_id = v_recovery_job_id::text
          and audit.safe_detail->>'recovery_snapshot_sha256' =
            v_recovery_snapshot_sha256
          and audit.safe_detail->>'provider_mutation_started' = 'false'
     ) <> 1
     or (
       select count(*)
         from sellerpilot_private.operation_audit audit
        where audit.owner_id = v_recovery_job.created_by
          and audit.action = 'lazada_credential_recovery_preserved'
          and audit.entity_type = 'channel_gateway_job'
          and audit.entity_id = v_recovery_job_id::text
          and audit.safe_detail->>'reason' = 'snapshot_rejected'
          and audit.safe_detail->>'recovery_snapshot_preserved' = 'true'
          and audit.safe_detail->>'provider_mutation_started' = 'false'
     ) <> 1 then
    raise exception
      'Lazada rejected recovery cleanup evidence is incomplete';
  end if;

  v_cleanup_at := clock_timestamp();
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = v_recovery_terminal_error,
         credential_refresh_recovery_vault_id = null,
         credential_refresh_recovery_fingerprint = null,
         credential_refresh_recovery_staged_at = null,
         completed_at = v_cleanup_at,
         updated_at = v_cleanup_at
   where job.id = v_recovery_job_id
     and job.status = 'reconciliation_required'
     and job.error_message = 'LAZADA_RECOVERY_SNAPSHOT_REJECTED'
     and job.credential_refresh_recovery_vault_id = v_recovery_vault_id
     and job.provider_mutation_started_at is null;
  if not found then
    raise exception 'exact Lazada rejected recovery ownership changed';
  end if;

  delete from vault.secrets secret
   where secret.id = v_recovery_vault_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'exact Lazada rejected recovery Vault cleanup failed';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = v_oauth_terminal_error,
         oauth_request_vault_id = null,
         completed_at = v_cleanup_at,
         updated_at = v_cleanup_at
   where job.id = v_fresh_oauth_job_id
     and job.status = 'queued'
     and job.attempt_count = 0
     and job.oauth_request_vault_id = v_oauth_vault_id
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.provider_mutation_started_at is null;
  if not found then
    raise exception 'exact Lazada OAuth cleanup ownership changed';
  end if;

  delete from vault.secrets secret
   where secret.id = v_oauth_vault_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'exact Lazada OAuth Vault cleanup failed';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail,
    occurred_at
  ) values (
    v_recovery_job.created_by,
    'lazada_rejected_recovery_discarded_for_reauthorization',
    'channel_gateway_job',
    v_recovery_job_id::text,
    jsonb_build_object(
      'channel', 'lazada',
      'operation', 'orders.list',
      'reason', 'runtime_first_seller_reauthorization',
      'fresh_oauth_job_id', v_fresh_oauth_job_id,
      'source_credential_id', v_source_credential_id,
      'recovery_vault_id', v_recovery_vault_id,
      'discarded_oauth_vault_id', v_oauth_vault_id,
      'recovery_job_request_sha256', v_recovery_request_sha256,
      'fresh_oauth_job_request_sha256', v_oauth_request_sha256,
      'recovery_snapshot_sha256', v_recovery_snapshot_sha256,
      'fresh_oauth_fingerprint', v_oauth_fingerprint,
      'provider_call_started_during_cleanup', false,
      'provider_mutation_started', false,
      'credential_rotated_during_cleanup', false,
      'recovery_snapshot_discarded', true,
      'oauth_code_discarded', true,
      'oauth_code_sent_to_provider', false
    ),
    v_cleanup_at
  ), (
    v_oauth_job.created_by,
    'lazada_oauth_discarded_outside_safe_window',
    'channel_gateway_job',
    v_fresh_oauth_job_id::text,
    jsonb_build_object(
      'channel', 'lazada',
      'operation', 'oauth.exchange',
      'reason', 'runtime_inactive_outside_safe_window',
      'source_credential_id', v_source_credential_id,
      'oauth_vault_id', v_oauth_vault_id,
      'oauth_job_request_sha256', v_oauth_request_sha256,
      'oauth_fingerprint', v_oauth_fingerprint,
      'safe_window_minutes', 25,
      'oauth_code_sent_to_provider', false,
      'provider_mutation_started', false,
      'credential_rotated', false
    ),
    v_cleanup_at
  );
end;
$discard_exact_rejected_lazada_recovery$;

commit;
