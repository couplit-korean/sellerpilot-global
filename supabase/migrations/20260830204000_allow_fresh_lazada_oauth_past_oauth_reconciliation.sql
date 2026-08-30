-- One legacy Lazada OAuth exchange reached its credential/provider boundary,
-- completed reconciliation_required, scrubbed its one-time authorization
-- grant, and staged no replacement credential. Keeping that uncertainty is
-- correct, but globally blocking every later seller authorization makes the
-- account unrecoverable.
--
-- Extend the existing fresh-authorization exception without reusing or
-- mutating the older job. Exactly one newer, unclaimed, Vault-backed OAuth job
-- may pass exactly one safe blocker. The older blocker is cancelled only by
-- the existing success trigger after the newer job activates a distinct,
-- provider-certified credential. Any failure or incomplete certification
-- leaves the older reconciliation row unchanged.

begin;

create function sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
  p_source_credential_id uuid,
  p_owner_id uuid,
  p_environment text,
  p_new_oauth_fingerprint text,
  p_new_created_at timestamptz
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select blocker.id
    from sellerpilot_private.channel_gateway_jobs blocker
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id = blocker.id
   where p_source_credential_id is not null
     and p_owner_id is not null
     and p_environment = 'production'
     and p_new_oauth_fingerprint ~ '^[a-f0-9]{64}$'
     and p_new_created_at > clock_timestamp() - interval '25 minutes'
     and p_new_created_at <= clock_timestamp() + interval '1 minute'
     and blocker.credential_id = p_source_credential_id
     and blocker.oauth_source_credential_id = p_source_credential_id
     and blocker.created_by = p_owner_id
     and blocker.channel = 'lazada'
     and blocker.environment = p_environment
     and blocker.status = 'reconciliation_required'
     and blocker.operation = 'oauth.exchange'
     and blocker.error_message is not null
     and (
       blocker.error_message in (
         'serverless_cs_execution_failed',
         'serverless_cs_runtime_timeout'
       )
       or blocker.error_message ~
         '^LAZADA_OAUTH_PROVIDER_FAILURE:(SYSTEM|ISV|ISP|HTTP_4XX|HTTP_5XX|INVALID_RESPONSE):(INCOMPLETE_SIGNATURE|INVALID_SIGNATURE|INVALID_TIMESTAMP|INVALID_APP_KEY|INVALID_CODE|INVALID_AUTHORIZATION_CODE|ILLEGAL_ACCESS_TOKEN|MISSING_PARAMETER|INVALID_PARAMETER|API_CALL_LIMIT|MISSING_TOKEN_FIELDS|UNRECOGNIZED|5|6|30|500|501|901|1000)$'
     )
     and blocker.attempt_count = 1
     and blocker.attempt_id is null
     and blocker.listing_id is null
     and blocker.worker_token_id is null
     and blocker.claim_token is null
     and blocker.lease_expires_at is null
     and blocker.started_at is not null
     and blocker.completed_at is not null
     and blocker.created_at <= blocker.started_at
     and blocker.credential_refresh_in_flight
     and blocker.credential_refresh_started_at is not null
     and blocker.started_at <= blocker.credential_refresh_started_at
     and blocker.credential_refresh_started_at <= blocker.completed_at
     and blocker.completed_at < p_new_created_at
     and blocker.updated_at >= blocker.completed_at
     and blocker.prepared_credential_id is null
     and blocker.credential_refresh_fingerprint is null
     and blocker.credential_refresh_prepared_at is null
     and blocker.credential_refresh_recovery_vault_id is null
     and blocker.credential_refresh_recovery_fingerprint is null
     and blocker.credential_refresh_recovery_staged_at is null
     and blocker.oauth_request_vault_id is null
     and blocker.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
     and blocker.oauth_request_fingerprint is distinct from
           p_new_oauth_fingerprint
     and not blocker.oauth_exchange_completed
     and blocker.provider_mutation_started_at is null
     and blocker.response_payload is null
     and blocker.write_resource_kind is null
     and blocker.write_resource_key is null
     and blocker.request_fingerprint is null
     and blocker.inventory_item_id is null
     and blocker.order_id is null
     and blocker.shipment_carrier is null
     and blocker.shipment_tracking is null
     and blocker.request_payload = jsonb_build_object('vaultBacked', true)
     and receipt.completion_fingerprint ~ '^[a-f0-9]{64}$'
     and receipt.completion_fingerprint =
           sellerpilot_private.gateway_completion_fingerprint(
             'reconciliation_required',
             null,
             blocker.error_message,
             null,
             null,
             null,
             null
           )
     and receipt.created_at >= blocker.completed_at
     and receipt.created_at <= clock_timestamp() + interval '1 minute'
     and (
       (
         blocker.oauth_provider_call_started_at is not null
         and blocker.credential_refresh_started_at <=
               blocker.oauth_provider_call_started_at
         and blocker.oauth_provider_call_started_at <= blocker.completed_at
       )
       or (
         blocker.id = 'faee01e1-2d68-4f99-951c-15684822fc43'::uuid
         and blocker.oauth_provider_call_started_at is null
         and blocker.error_message = 'serverless_cs_execution_failed'
       )
     )
     and (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs unresolved
        where unresolved.channel = 'lazada'
          and unresolved.environment = p_environment
          and unresolved.status = 'reconciliation_required'
     ) = 1
   order by blocker.id
   limit 1;
$$;

revoke all on function
  sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
    uuid, uuid, text, text, timestamptz
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.safe_lazada_oauth_reauthorization_source_identity(
  p_source_credential_id uuid,
  p_owner_id uuid,
  p_blocker_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_credentials source_credential
     where source_credential.id = p_source_credential_id
       and source_credential.channel = 'lazada'
       and source_credential.environment = 'production'
       and source_credential.created_by = p_owner_id
       and (
         (
           source_credential.seller_account_key ~ '^[a-f0-9]{64}$'
           and source_credential.seller_account_key_source =
                 'provider_certified_v1'
           and source_credential.seller_account_verified_at is not null
         )
         or (
           p_blocker_job_id =
             'faee01e1-2d68-4f99-951c-15684822fc43'::uuid
           and source_credential.seller_account_key is null
           and source_credential.seller_account_key_source =
                 'legacy_unattested'
           and source_credential.seller_account_verified_at is null
           and exists (
             select 1
               from sellerpilot_private.channel_gateway_jobs blocker
              where blocker.id = p_blocker_job_id
                and blocker.credential_id = source_credential.id
                and blocker.oauth_source_credential_id = source_credential.id
                and blocker.created_by = p_owner_id
                and blocker.channel = 'lazada'
                and blocker.environment = 'production'
                and blocker.operation = 'oauth.exchange'
                and blocker.status = 'reconciliation_required'
           )
         )
       )
  );
$$;

revoke all on function
  sellerpilot_private.safe_lazada_oauth_reauthorization_source_identity(
    uuid, uuid, uuid
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.safe_lazada_read_refresh_reauthorization_blocker(
  p_source_credential_id uuid,
  p_owner_id uuid,
  p_environment text,
  p_new_created_at timestamptz
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select blocker.id
    from sellerpilot_private.channel_gateway_jobs blocker
    join sellerpilot_private.channel_credentials source_credential
      on source_credential.id = p_source_credential_id
     and source_credential.channel = blocker.channel
     and source_credential.environment = blocker.environment
     and source_credential.created_by = p_owner_id
   where p_source_credential_id is not null
     and p_owner_id is not null
     and p_environment = 'production'
     and p_new_created_at > clock_timestamp() - interval '25 minutes'
     and p_new_created_at <= clock_timestamp() + interval '1 minute'
     and blocker.credential_id = p_source_credential_id
     and blocker.channel = 'lazada'
     and blocker.environment = p_environment
     and blocker.created_by = p_owner_id
     and blocker.status = 'reconciliation_required'
     and blocker.operation in (
       'diagnostic.test',
       'categories.list',
       'categories.suggest',
       'categories.attributes',
       'categories.validate',
       'orders.list',
       'orders.get',
       'inquiries.list',
       'shops.get'
     )
     and blocker.error_message = 'serverless_cs_execution_failed'
     and blocker.attempt_count between 1 and 6
     and blocker.attempt_id is null
     and blocker.listing_id is null
     and blocker.worker_token_id is null
     and blocker.claim_token is null
     and blocker.lease_expires_at is null
     and blocker.started_at is not null
     and blocker.completed_at is not null
     and blocker.created_at <= blocker.started_at
     and blocker.credential_refresh_in_flight
     and blocker.credential_refresh_started_at is not null
     and blocker.started_at <= blocker.credential_refresh_started_at
     and blocker.credential_refresh_started_at <= blocker.completed_at
     and blocker.completed_at < p_new_created_at
     and blocker.updated_at >= blocker.completed_at
     and blocker.prepared_credential_id is null
     and blocker.credential_refresh_fingerprint is null
     and blocker.credential_refresh_prepared_at is null
     and blocker.credential_refresh_recovery_vault_id is null
     and blocker.credential_refresh_recovery_fingerprint is null
     and blocker.credential_refresh_recovery_staged_at is null
     and blocker.oauth_request_vault_id is null
     and blocker.oauth_request_fingerprint is null
     and blocker.oauth_source_credential_id is null
     and not blocker.oauth_exchange_completed
     and blocker.oauth_provider_call_started_at is null
     and blocker.provider_mutation_started_at is null
     and blocker.response_payload is null
     and (
       blocker.seller_account_key is null
       or (
         source_credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and source_credential.seller_account_key_source =
               'provider_certified_v1'
         and source_credential.seller_account_verified_at is not null
         and blocker.seller_account_key =
               source_credential.seller_account_key
       )
     )
     and blocker.write_resource_kind is null
     and blocker.write_resource_key is null
     and blocker.request_fingerprint is null
     and blocker.inventory_item_id is null
     and blocker.order_id is null
     and blocker.shipment_carrier is null
     and blocker.shipment_tracking is null
     and jsonb_typeof(blocker.request_payload) = 'object'
     and (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs unresolved
        where unresolved.channel = 'lazada'
          and unresolved.environment = p_environment
          and unresolved.status = 'reconciliation_required'
     ) = 1
   order by blocker.id
   limit 1;
$$;

revoke all on function
  sellerpilot_private.safe_lazada_read_refresh_reauthorization_blocker(
    uuid, uuid, text, timestamptz
  ) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.safe_lazada_oauth_refresh_blocker(
  p_oauth_job_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with oauth_lineage as (
    select oauth.id,
           oauth.oauth_source_credential_id,
           oauth.environment,
           oauth.created_by,
           oauth.created_at,
           oauth.oauth_request_fingerprint
      from sellerpilot_private.channel_gateway_jobs oauth
     where oauth.id = p_oauth_job_id
       and oauth.channel = 'lazada'
       and oauth.environment = 'production'
       and oauth.operation = 'oauth.exchange'
       and oauth.oauth_source_credential_id is not null
       and oauth.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
  ), eligible_read_blockers as (
    select sellerpilot_private.safe_lazada_read_refresh_reauthorization_blocker(
             oauth.oauth_source_credential_id,
             oauth.created_by,
             oauth.environment,
             oauth.created_at
           ) as id
      from oauth_lineage oauth
  ), eligible_oauth_blockers as (
    select sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
             oauth.oauth_source_credential_id,
             oauth.created_by,
             oauth.environment,
             oauth.oauth_request_fingerprint,
             oauth.created_at
           ) as id
      from oauth_lineage oauth
  ), eligible_blockers as (
    select read_blocker.id
      from eligible_read_blockers read_blocker
     where read_blocker.id is not null
    union all
    select oauth_blocker.id
      from eligible_oauth_blockers oauth_blocker
     where oauth_blocker.id is not null
  )
  select (pg_catalog.array_agg(eligible.id order by eligible.id))[1]
    from eligible_blockers eligible
   having count(*) = 1
      and (
        select count(*)
          from sellerpilot_private.channel_gateway_jobs unresolved
          join oauth_lineage oauth on true
         where unresolved.channel = 'lazada'
           and unresolved.environment = oauth.environment
           and unresolved.status = 'reconciliation_required'
      ) = 1;
$$;

revoke all on function
  sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) rename to sellerpilot_204000_enqueue_channel_gateway_unsafe;

revoke all on function
  public.sellerpilot_204000_enqueue_channel_gateway_unsafe(
    uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

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
declare
  v_id uuid := gen_random_uuid();
  v_created_at timestamptz := clock_timestamp();
  v_code text;
  v_country text;
  v_oauth_request jsonb;
  v_oauth_fingerprint text;
  v_oauth_vault_id uuid;
  v_existing_id uuid;
  v_blocker_job_id uuid;
  v_read_blocker_job_id uuid;
  v_source_credential sellerpilot_private.channel_credentials%rowtype;
begin
  -- Every non-Lazada-OAuth request keeps the previously deployed enqueue path
  -- byte-for-byte. Invalid or unexpectedly shaped OAuth input also delegates
  -- to that path, which remains the authoritative validator.
  if p_channel is distinct from 'lazada'
     or p_operation is distinct from 'oauth.exchange'
     or p_attempt_id is not null
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'code') <> 'string'
     or p_request_payload - 'code' - 'country' <> '{}'::jsonb
     or (
       p_request_payload ? 'country'
       and jsonb_typeof(p_request_payload->'country') <> 'string'
     ) then
    return public.sellerpilot_204000_enqueue_channel_gateway_unsafe(
      p_credential_id,
      p_attempt_id,
      p_channel,
      p_operation,
      p_request_payload
    );
  end if;

  v_code := nullif(trim(p_request_payload->>'code'), '');
  v_country := nullif(lower(trim(p_request_payload->>'country')), '');
  if v_code is null
     or length(v_code) < 8
     or length(v_code) > 8000
     or (v_country is not null and v_country not in (
       'my', 'sg', 'ph', 'th', 'vn', 'id'
     )) then
    return public.sellerpilot_204000_enqueue_channel_gateway_unsafe(
      p_credential_id,
      p_attempt_id,
      p_channel,
      p_operation,
      p_request_payload
    );
  end if;

  v_oauth_request := jsonb_build_object('code', v_code)
    || case when v_country is null then '{}'::jsonb
         else jsonb_build_object('country', v_country)
       end;
  v_oauth_fingerprint := encode(extensions.digest(
    jsonb_build_object('channel', 'lazada', 'code', v_code)::text,
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:lazada:production')
  );
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;
  lock table sellerpilot_private.channel_credentials
    in share row exclusive mode;
  lock table vault.secrets in share row exclusive mode;
  lock table sellerpilot_private.gateway_completion_receipts
    in share row exclusive mode;

  -- An exact callback replay always resolves to its original terminal job.
  -- It never creates a second Vault grant or reuses the scrubbed code.
  select existing.id
    into v_existing_id
    from sellerpilot_private.channel_gateway_jobs existing
   where existing.oauth_source_credential_id = p_credential_id
     and existing.oauth_request_fingerprint = v_oauth_fingerprint
     and existing.channel = 'lazada'
     and existing.environment = 'production'
     and existing.operation = 'oauth.exchange'
   order by existing.created_at, existing.id
   limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  select source_credential.*
    into v_source_credential
    from sellerpilot_private.channel_credentials source_credential
   where source_credential.id = p_credential_id
     and source_credential.channel = 'lazada'
     and source_credential.environment = 'production'
     and source_credential.status = 'active'
     and (
       source_credential.expires_at is null
       or source_credential.expires_at > v_created_at
     )
   for update;
  if not found then
    raise exception 'active channel credential required';
  end if;

  v_read_blocker_job_id :=
    sellerpilot_private.safe_lazada_read_refresh_reauthorization_blocker(
      p_credential_id,
      v_source_credential.created_by,
      'production',
      v_created_at
    );
  v_blocker_job_id :=
    sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
      p_credential_id,
      v_source_credential.created_by,
      'production',
      v_oauth_fingerprint,
      v_created_at
    );
  if v_blocker_job_id is null then
    if v_read_blocker_job_id is not null
       and not (
         v_source_credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and v_source_credential.seller_account_key_source =
               'provider_certified_v1'
         and v_source_credential.seller_account_verified_at is not null
       ) then
      raise exception
        'provider-certified Lazada source identity required for read-refresh reauthorization'
        using errcode = '42501';
    end if;
    return public.sellerpilot_204000_enqueue_channel_gateway_unsafe(
      p_credential_id,
      p_attempt_id,
      p_channel,
      p_operation,
      p_request_payload
    );
  end if;
  if not sellerpilot_private.safe_lazada_oauth_reauthorization_source_identity(
    p_credential_id,
    v_source_credential.created_by,
    v_blocker_job_id
  ) then
    return public.sellerpilot_204000_enqueue_channel_gateway_unsafe(
      p_credential_id,
      p_attempt_id,
      p_channel,
      p_operation,
      p_request_payload
    );
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs other_oauth
     where other_oauth.oauth_source_credential_id = p_credential_id
       and other_oauth.channel = 'lazada'
       and other_oauth.environment = 'production'
       and other_oauth.operation = 'oauth.exchange'
       and other_oauth.status in (
         'queued', 'running', 'reconciliation_required'
       )
       and other_oauth.id <> v_blocker_job_id
  ) then
    raise exception 'unresolved OAuth exchange already exists';
  end if;

  select vault.create_secret(
    v_oauth_request::text,
    format(
      'sellerpilot_gateway_oauth_%s_%s',
      v_id,
      gen_random_uuid()
    ),
    'SellerPilot claim-bound Lazada OAuth reauthorization. Never expose outside the gateway worker.'
  ) into v_oauth_vault_id;
  if v_oauth_vault_id is null then
    raise exception 'Lazada OAuth Vault request could not be created';
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
    seller_account_key,
    created_by,
    created_at,
    updated_at
  ) values (
    v_id,
    p_credential_id,
    null,
    'lazada',
    'oauth.exchange',
    'production',
    jsonb_build_object('vaultBacked', true),
    v_oauth_vault_id,
    v_oauth_fingerprint,
    p_credential_id,
    v_source_credential.seller_account_key,
    v_source_credential.created_by,
    v_created_at,
    v_created_at
  );

  if sellerpilot_private.safe_lazada_oauth_refresh_blocker(v_id)
       is distinct from v_blocker_job_id then
    raise exception 'safe Lazada OAuth reauthorization lineage changed'
      using errcode = '40001';
  end if;
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) to service_role;

-- Re-check the complete candidate, Vault grant and source credential. The one
-- selected blocker is ignored by the other-OAuth fence; every second queued,
-- running or reconciliation-required exchange still fails closed.
create or replace function sellerpilot_private.safe_lazada_oauth_claim_blocker(
  p_oauth_job_id uuid
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select sellerpilot_private.safe_lazada_oauth_refresh_blocker(oauth.id)
    from sellerpilot_private.channel_gateway_jobs oauth
    join sellerpilot_private.channel_credentials source_credential
      on source_credential.id = oauth.credential_id
     and source_credential.id = oauth.oauth_source_credential_id
     and source_credential.channel = 'lazada'
     and source_credential.environment = 'production'
     and source_credential.status = 'active'
     and (
       source_credential.expires_at is null
       or source_credential.expires_at > clock_timestamp()
     )
    join vault.secrets oauth_secret
      on oauth_secret.id = oauth.oauth_request_vault_id
     and pg_catalog.left(
           oauth_secret.name,
           pg_catalog.length(
             'sellerpilot_gateway_oauth_' || oauth.id::text || '_'
           )
         ) = 'sellerpilot_gateway_oauth_' || oauth.id::text || '_'
     and pg_catalog.length(oauth_secret.name) =
           pg_catalog.length(
             'sellerpilot_gateway_oauth_' || oauth.id::text || '_'
           ) + 36
     and pg_catalog.right(oauth_secret.name, 36) ~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    join vault.decrypted_secrets oauth_request
      on oauth_request.id = oauth.oauth_request_vault_id
   where oauth.id = p_oauth_job_id
     and oauth.channel = 'lazada'
     and oauth.environment = 'production'
     and oauth.operation = 'oauth.exchange'
     and oauth.status = 'queued'
     and oauth.created_at > clock_timestamp() - interval '25 minutes'
     and oauth.created_at <= clock_timestamp() + interval '1 minute'
     and oauth.updated_at >= oauth.created_at
     and oauth.request_payload = jsonb_build_object('vaultBacked', true)
     and oauth.attempt_count = 0
     and oauth.attempt_id is null
     and oauth.listing_id is null
     and oauth.worker_token_id is null
     and oauth.claim_token is null
     and oauth.lease_expires_at is null
     and oauth.started_at is null
     and oauth.completed_at is null
     and oauth.error_message is null
     and oauth.response_payload is null
     and oauth.oauth_request_vault_id is not null
     and oauth.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
     and oauth.oauth_source_credential_id = oauth.credential_id
     and not oauth.oauth_exchange_completed
     and not oauth.credential_refresh_in_flight
     and oauth.credential_refresh_started_at is null
     and oauth.prepared_credential_id is null
     and oauth.credential_refresh_fingerprint is null
     and oauth.credential_refresh_prepared_at is null
     and oauth.credential_refresh_recovery_vault_id is null
     and oauth.credential_refresh_recovery_fingerprint is null
     and oauth.credential_refresh_recovery_staged_at is null
     and oauth.oauth_provider_call_started_at is null
     and oauth.provider_mutation_started_at is null
     and oauth.seller_account_key is not distinct from
           source_credential.seller_account_key
     and oauth.created_by = source_credential.created_by
     and sellerpilot_private.safe_lazada_oauth_reauthorization_source_identity(
           source_credential.id,
           oauth.created_by,
           sellerpilot_private.safe_lazada_oauth_refresh_blocker(oauth.id)
         )
     and oauth.write_resource_kind is null
     and oauth.write_resource_key is null
     and oauth.request_fingerprint is null
     and oauth.inventory_item_id is null
     and oauth.order_id is null
     and oauth.shipment_carrier is null
     and oauth.shipment_tracking is null
     and jsonb_typeof(oauth_request.decrypted_secret::jsonb) = 'object'
     and (
       (
         select pg_catalog.array_agg(secret_key.key order by secret_key.key)
           from jsonb_object_keys(oauth_request.decrypted_secret::jsonb)
                as secret_key(key)
       ) = array['code']::text[]
       or (
         select pg_catalog.array_agg(secret_key.key order by secret_key.key)
           from jsonb_object_keys(oauth_request.decrypted_secret::jsonb)
                as secret_key(key)
       ) = array['code', 'country']::text[]
     )
     and jsonb_typeof(oauth_request.decrypted_secret::jsonb->'code') = 'string'
     and length(trim(oauth_request.decrypted_secret::jsonb->>'code'))
           between 8 and 8000
     and (
       not (oauth_request.decrypted_secret::jsonb ? 'country')
       or (
         jsonb_typeof(oauth_request.decrypted_secret::jsonb->'country') =
           'string'
         and lower(oauth_request.decrypted_secret::jsonb->>'country') in (
           'my', 'sg', 'ph', 'th', 'vn', 'id'
         )
       )
     )
     and encode(extensions.digest(
       jsonb_build_object(
         'channel', 'lazada',
         'code', trim(oauth_request.decrypted_secret::jsonb->>'code')
       )::text,
       'sha256'
     ), 'hex') = oauth.oauth_request_fingerprint
     and sellerpilot_private.safe_lazada_oauth_refresh_blocker(oauth.id)
           is not null
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running
        where running.channel = 'lazada'
          and running.environment = 'production'
          and running.status = 'running'
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_oauth
        where other_oauth.oauth_source_credential_id = oauth.credential_id
          and other_oauth.channel = 'lazada'
          and other_oauth.environment = 'production'
          and other_oauth.operation = 'oauth.exchange'
          and other_oauth.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and other_oauth.id <> oauth.id
          and other_oauth.id is distinct from
                sellerpilot_private.safe_lazada_oauth_refresh_blocker(oauth.id)
     )
     and (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs secret_reference
        where secret_reference.oauth_request_vault_id =
                oauth.oauth_request_vault_id
           or secret_reference.credential_refresh_recovery_vault_id =
                oauth.oauth_request_vault_id
     ) = 1
     and not exists (
       select 1
         from sellerpilot_private.channel_credentials credential_reference
        where credential_reference.vault_secret_id = oauth.oauth_request_vault_id
     );
$$;

revoke all on function
  sellerpilot_private.safe_lazada_oauth_claim_blocker(uuid)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_claim_serverless_gateway_job(text, text)
  rename to sellerpilot_204000_claim_serverless_gateway_unsafe;

revoke all on function
  public.sellerpilot_204000_claim_serverless_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_claim_serverless_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oauth_job_id uuid;
begin
  if not exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.scope = 'serverless_cs'
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
  ) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- Keep ordinary channel drains on the deployed parallel claimant without
  -- taking any global, Lazada, table or receipt fence. This broad lookup is
  -- intentionally looser than the exact helper so malformed Vault names or
  -- receipt evidence still enter the fenced branch. If a normal enqueue races
  -- this empty lookup, the delegated claimant performs its own post-lock exact
  -- checks before disclosing the grant.
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs oauth
     where oauth.channel = 'lazada'
       and oauth.environment = 'production'
       and oauth.operation = 'oauth.exchange'
       and oauth.status = 'queued'
       and oauth.created_at > clock_timestamp() - interval '25 minutes'
       and oauth.created_at <= clock_timestamp() + interval '1 minute'
  ) then
    return public.sellerpilot_204000_claim_serverless_gateway_unsafe(
      p_token_hash,
      p_worker_version
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:lazada:production')
  );
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;
  lock table sellerpilot_private.channel_credentials
    in share row exclusive mode;
  lock table vault.secrets in share row exclusive mode;
  lock table sellerpilot_private.gateway_completion_receipts
    in share row exclusive mode;

  -- Select only after the enqueue and direct-maintenance lineage fences. A
  -- candidate cannot appear, nor can its receipt be repaired or invalidated,
  -- between an empty lookup and delegation to the deployed claimant.
  select oauth.id
    into v_oauth_job_id
    from sellerpilot_private.channel_gateway_jobs oauth
   where oauth.channel = 'lazada'
     and oauth.environment = 'production'
     and oauth.operation = 'oauth.exchange'
     and oauth.status = 'queued'
     and oauth.created_at > clock_timestamp() - interval '25 minutes'
     and sellerpilot_private.safe_lazada_oauth_claim_blocker(oauth.id)
           is not null
   order by oauth.created_at, oauth.id
   limit 1;

  if v_oauth_job_id is null then
    return public.sellerpilot_204000_claim_serverless_gateway_unsafe(
      p_token_hash,
      p_worker_version
    );
  end if;

  -- The deployed claimant rechecks the full candidate after these fences and
  -- performs the actual ownership transition. Re-entering the advisory/table
  -- locks in the same transaction is intentional and keeps all unrelated
  -- claim behavior delegated unchanged.
  return public.sellerpilot_204000_claim_serverless_gateway_unsafe(
    p_token_hash,
    p_worker_version
  );
end;
$$;

revoke all on function public.sellerpilot_claim_serverless_gateway_job(
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_serverless_gateway_job(
  text, text
) to service_role;

create or replace function sellerpilot_private.supersede_safe_lazada_refresh_after_oauth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocker_job_id uuid;
  v_blocker_operation text;
  v_source_credential sellerpilot_private.channel_credentials%rowtype;
  v_active_credential sellerpilot_private.channel_credentials%rowtype;
  v_superseded_at timestamptz;
  v_source_identity_certified boolean;
begin
  -- This subtransaction is intentionally best effort. An audit or blocker
  -- mismatch rolls its cancellation back without changing the already
  -- provider-certified replacement or hiding the older uncertainty.
  begin
    if old.status is distinct from 'running'
       or old.status is not distinct from new.status
       or new.status <> 'succeeded'
       or new.channel <> 'lazada'
       or new.environment <> 'production'
       or new.operation <> 'oauth.exchange'
       or not new.oauth_exchange_completed
       or new.prepared_credential_id is null
       or new.prepared_credential_id is distinct from new.credential_id
       or new.credential_refresh_prepared_at is null
       or new.credential_refresh_in_flight
       or new.credential_refresh_started_at is not null
       or new.credential_refresh_recovery_vault_id is not null
       or new.credential_refresh_recovery_fingerprint is not null
       or new.credential_refresh_recovery_staged_at is not null
       or new.oauth_provider_call_started_at is null
       or new.started_at is null
       or new.completed_at is null
       or new.started_at > new.oauth_provider_call_started_at
       or new.oauth_provider_call_started_at >
            new.credential_refresh_prepared_at
       or new.credential_refresh_prepared_at > new.completed_at
       or new.oauth_provider_call_started_at > new.completed_at
       or new.provider_mutation_started_at is not null
       or new.oauth_source_credential_id is null
       or new.oauth_source_credential_id = new.credential_id
       or new.response_payload is null
       or jsonb_typeof(new.response_payload->'ok') is distinct from 'boolean'
       or not coalesce((new.response_payload->>'ok')::boolean, false)
       or new.response_payload->>'channel' is distinct from 'lazada'
       or new.response_payload->>'operation' is distinct from 'oauth.exchange' then
      return new;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('sellerpilot:lazada:production')
    );
    lock table sellerpilot_private.channel_gateway_jobs
      in share row exclusive mode;
    lock table sellerpilot_private.channel_credentials
      in share row exclusive mode;
    lock table vault.secrets in share row exclusive mode;
    lock table sellerpilot_private.gateway_completion_receipts
      in share row exclusive mode;

    v_blocker_job_id :=
      sellerpilot_private.safe_lazada_oauth_refresh_blocker(new.id);
    if v_blocker_job_id is null then return new; end if;

    select source_credential.*
      into v_source_credential
      from sellerpilot_private.channel_credentials source_credential
     where source_credential.id = new.oauth_source_credential_id
       and source_credential.channel = 'lazada'
       and source_credential.environment = 'production'
       and source_credential.status = 'revoked'
       and source_credential.created_by = new.created_by
     for update;
    if not found then return new; end if;
    if not sellerpilot_private.safe_lazada_oauth_reauthorization_source_identity(
      v_source_credential.id,
      new.created_by,
      v_blocker_job_id
    ) then
      return new;
    end if;
    v_source_identity_certified :=
      v_source_credential.seller_account_key ~ '^[a-f0-9]{64}$'
      and v_source_credential.seller_account_key_source =
            'provider_certified_v1'
      and v_source_credential.seller_account_verified_at is not null;
    if (
      v_source_identity_certified
      and new.seller_account_key is distinct from
            v_source_credential.seller_account_key
    ) or (
      not v_source_identity_certified
      and new.seller_account_key is not null
    ) then
      return new;
    end if;

    select active_credential.*
      into v_active_credential
      from sellerpilot_private.channel_credentials active_credential
     where active_credential.id = new.credential_id
       and active_credential.id = new.prepared_credential_id
       and active_credential.channel = 'lazada'
       and active_credential.environment = 'production'
       and active_credential.status = 'active'
       and active_credential.version > v_source_credential.version
       and active_credential.created_by = v_source_credential.created_by
       and active_credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and (
         not v_source_identity_certified
         or active_credential.seller_account_key =
              v_source_credential.seller_account_key
       )
       and active_credential.seller_account_key_source =
             'provider_certified_v1'
       and active_credential.seller_account_verified_at is not null
       and (
         active_credential.expires_at is null
         or active_credential.expires_at > clock_timestamp()
       )
     for update;
    if not found then return new; end if;

    perform sellerpilot_private.discard_stale_unclaimed_lazada_oauth(
      new.oauth_source_credential_id,
      new.oauth_request_fingerprint
    );

    v_blocker_job_id :=
      sellerpilot_private.safe_lazada_oauth_refresh_blocker(new.id);
    if v_blocker_job_id is null then return new; end if;

    select blocker.operation
      into v_blocker_operation
      from sellerpilot_private.channel_gateway_jobs blocker
     where blocker.id = v_blocker_job_id
       and blocker.status = 'reconciliation_required'
     for update;
    if not found
       or sellerpilot_private.safe_lazada_oauth_refresh_blocker(new.id)
            is distinct from v_blocker_job_id then
      return new;
    end if;

    v_superseded_at := clock_timestamp();
    update sellerpilot_private.channel_gateway_jobs blocker
       set status = 'cancelled',
           error_message = case
             when v_blocker_operation = 'oauth.exchange' then
               'LAZADA_OAUTH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH'
             else
               'LAZADA_REFRESH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH'
           end,
           credential_refresh_in_flight = false,
           credential_refresh_started_at = null,
           updated_at = v_superseded_at
     where blocker.id = v_blocker_job_id
       and blocker.status = 'reconciliation_required'
       and blocker.credential_id = new.oauth_source_credential_id
       and blocker.credential_refresh_in_flight
       and blocker.credential_refresh_started_at is not null
       and blocker.prepared_credential_id is null
       and blocker.credential_refresh_recovery_vault_id is null
       and blocker.provider_mutation_started_at is null
       and sellerpilot_private.safe_lazada_oauth_refresh_blocker(new.id) =
             v_blocker_job_id;
    if not found then return new; end if;

    insert into sellerpilot_private.operation_audit (
      owner_id,
      action,
      entity_type,
      entity_id,
      safe_detail,
      occurred_at
    ) values (
      new.created_by,
      case
        when v_blocker_operation = 'oauth.exchange' then
          'lazada_oauth_reconciliation_superseded_by_certified_oauth'
        else
          'lazada_refresh_reconciliation_superseded_by_certified_oauth'
      end,
      'channel_gateway_job',
      v_blocker_job_id::text,
      jsonb_build_object(
        'channel', 'lazada',
        'environment', 'production',
        'reason', case
          when v_blocker_operation = 'oauth.exchange' then
            'new_provider_certified_oauth_replaced_uncertain_oauth_exchange'
          else
            'provider_certified_oauth_replaced_uncertain_read_refresh'
        end,
        'oauth_job_id', new.id,
        'blocker_job_id', v_blocker_job_id,
        'blocker_operation', v_blocker_operation,
        'credential_only_supersession', true,
        'legacy_source_identity_exception',
          not v_source_identity_certified,
        'identity_continuity_verified', v_source_identity_certified,
        'listing_identity_relinked', false,
        'blocker_provider_call_marker_present', (
          select blocker.oauth_provider_call_started_at is not null
            from sellerpilot_private.channel_gateway_jobs blocker
           where blocker.id = v_blocker_job_id
        ),
        'provider_mutation_started', false,
        'prepared_credential_absent_on_blocker', true,
        'recovery_credential_absent_on_blocker', true,
        'oauth_provider_certified', true
      ),
      v_superseded_at
    );
  exception when others then
    return new;
  end;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.supersede_safe_lazada_refresh_after_oauth()
  from public, anon, authenticated, service_role;

comment on function
  sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid) is
  'Returns one exact safe read-refresh or OAuth-exchange reconciliation blocker for a newer Vault-backed Lazada seller authorization; never exposes the grant or provider response.';

commit;
