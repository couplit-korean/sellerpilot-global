-- A read-only Lazada job can become reconciliation_required after its token
-- refresh started but before any refreshed credential was staged. That
-- uncertainty must continue to fence ordinary work, but it must not prevent a
-- newer, seller-authorized OAuth grant from replacing the uncertain grant.
--
-- The exception below is deliberately narrow. It applies only to an unclaimed
-- production Lazada OAuth job backed by its exact Vault request and only when
-- there is exactly one older, terminal, read-only refresh uncertainty with no
-- prepared/recovery credential and no provider mutation marker. The older row
-- remains untouched unless the OAuth job later succeeds with a newly active,
-- provider-certified credential.

begin;

create function sellerpilot_private.discard_stale_unclaimed_lazada_oauth(
  p_source_credential_id uuid,
  p_preserved_fingerprint text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale record;
  v_discarded_at timestamptz;
  v_deleted integer;
begin
  -- Callers hold the serialized gateway and Lazada credential locks. Refuse
  -- ambiguous cleanup rather than choosing between multiple ledger rows.
  if (
    select count(*)
      from sellerpilot_private.channel_gateway_jobs job
     where job.oauth_source_credential_id = p_source_credential_id
       and job.channel = 'lazada'
       and job.environment = 'production'
       and job.operation = 'oauth.exchange'
       and job.status = 'queued'
       and job.created_at <= clock_timestamp() - interval '25 minutes'
       and (
         p_preserved_fingerprint is null
         or job.oauth_request_fingerprint is distinct from
              p_preserved_fingerprint
       )
  ) > 1 then
    return 0;
  end if;

  lock table vault.secrets in share row exclusive mode;

  select job.id,
         job.created_by,
         job.oauth_request_vault_id,
         job.oauth_request_fingerprint,
         job.created_at
    into v_stale
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials source_credential
      on source_credential.id = job.oauth_source_credential_id
     and source_credential.id = p_source_credential_id
     and source_credential.channel = 'lazada'
     and source_credential.environment = 'production'
     and source_credential.created_by = job.created_by
    join vault.secrets secret
      on secret.id = job.oauth_request_vault_id
     and pg_catalog.left(
           secret.name,
           pg_catalog.length(
             'sellerpilot_gateway_oauth_' || job.id::text || '_'
           )
         ) = 'sellerpilot_gateway_oauth_' || job.id::text || '_'
     and pg_catalog.length(secret.name) =
           pg_catalog.length(
             'sellerpilot_gateway_oauth_' || job.id::text || '_'
           ) + 36
     and pg_catalog.right(secret.name, 36) ~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    join vault.decrypted_secrets oauth_request
      on oauth_request.id = job.oauth_request_vault_id
   where job.channel = 'lazada'
     and job.environment = 'production'
     and job.operation = 'oauth.exchange'
     and job.status = 'queued'
     and job.request_payload = jsonb_build_object('vaultBacked', true)
     and job.attempt_count = 0
     and job.attempt_id is null
     and job.listing_id is null
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.started_at is null
     and job.completed_at is null
     and job.error_message is null
     and job.response_payload is null
     and job.created_at <= clock_timestamp() - interval '25 minutes'
     and job.updated_at >= job.created_at
     and job.oauth_request_vault_id is not null
     and job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
     and job.oauth_source_credential_id = p_source_credential_id
     and not job.oauth_exchange_completed
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.prepared_credential_id is null
     and job.credential_refresh_fingerprint is null
     and job.credential_refresh_prepared_at is null
     and job.credential_refresh_recovery_vault_id is null
     and job.credential_refresh_recovery_fingerprint is null
     and job.credential_refresh_recovery_staged_at is null
     and job.provider_mutation_started_at is null
     and job.write_resource_kind is null
     and job.write_resource_key is null
     and job.request_fingerprint is null
     and job.inventory_item_id is null
     and job.order_id is null
     and job.shipment_carrier is null
     and job.shipment_tracking is null
     and (
       p_preserved_fingerprint is null
       or job.oauth_request_fingerprint is distinct from
            p_preserved_fingerprint
     )
     and jsonb_typeof(oauth_request.decrypted_secret::jsonb) = 'object'
     and (
       select pg_catalog.array_agg(secret_key.key order by secret_key.key)
         from jsonb_object_keys(oauth_request.decrypted_secret::jsonb)
              as secret_key(key)
     ) = array['code']::text[]
     and length(trim(oauth_request.decrypted_secret::jsonb->>'code')) >= 8
     and encode(extensions.digest(
       jsonb_build_object(
         'channel', 'lazada',
         'code', trim(oauth_request.decrypted_secret::jsonb->>'code')
       )::text,
       'sha256'
     ), 'hex') = job.oauth_request_fingerprint
     and (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs reference_job
        where reference_job.oauth_request_vault_id =
                job.oauth_request_vault_id
           or reference_job.credential_refresh_recovery_vault_id =
                job.oauth_request_vault_id
     ) = 1
     and not exists (
       select 1
         from sellerpilot_private.channel_credentials credential_reference
        where credential_reference.vault_secret_id = job.oauth_request_vault_id
     )
   order by job.created_at, job.id
   for update of job
   limit 1;
  if not found then return 0; end if;

  v_discarded_at := clock_timestamp();
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = 'LAZADA_OAUTH_CODE_DISCARDED_OUTSIDE_SAFE_WINDOW',
         oauth_request_vault_id = null,
         completed_at = v_discarded_at,
         updated_at = v_discarded_at
   where job.id = v_stale.id
     and job.status = 'queued'
     and job.attempt_count = 0
     and job.oauth_request_vault_id = v_stale.oauth_request_vault_id
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.started_at is null
     and job.provider_mutation_started_at is null;
  if not found then return 0; end if;

  delete from vault.secrets secret
   where secret.id = v_stale.oauth_request_vault_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'stale Lazada OAuth Vault cleanup failed';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail,
    occurred_at
  ) values (
    v_stale.created_by,
    'lazada_stale_unclaimed_oauth_discarded',
    'channel_gateway_job',
    v_stale.id::text,
    jsonb_build_object(
      'channel', 'lazada',
      'environment', 'production',
      'reason', 'oauth_code_outside_25_minute_claim_window',
      'source_credential_id', p_source_credential_id,
      'oauth_job_id', v_stale.id,
      'oauth_request_fingerprint', v_stale.oauth_request_fingerprint,
      'oauth_created_at', v_stale.created_at,
      'provider_call_started', false,
      'provider_mutation_started', false,
      'credential_rotation_started', false,
      'oauth_code_discarded', true,
      'superseded_by_different_authorization',
        p_preserved_fingerprint is not null
    ),
    v_discarded_at
  );
  return 1;
end;
$$;

revoke all on function
  sellerpilot_private.discard_stale_unclaimed_lazada_oauth(uuid, text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.safe_lazada_oauth_refresh_blocker(
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
           oauth.created_at
      from sellerpilot_private.channel_gateway_jobs oauth
     where oauth.id = p_oauth_job_id
       and oauth.channel = 'lazada'
       and oauth.environment = 'production'
       and oauth.operation = 'oauth.exchange'
       and oauth.oauth_source_credential_id is not null
       and oauth.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
  ), eligible_blockers as (
    select blocker.id
      from oauth_lineage oauth
      join sellerpilot_private.channel_gateway_jobs blocker
        on blocker.credential_id = oauth.oauth_source_credential_id
       and blocker.channel = 'lazada'
       and blocker.environment = oauth.environment
       and blocker.created_by = oauth.created_by
     where blocker.status = 'reconciliation_required'
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
       and blocker.completed_at < oauth.created_at
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
       and blocker.provider_mutation_started_at is null
       and blocker.response_payload is null
       and blocker.seller_account_key is null
       and blocker.write_resource_kind is null
       and blocker.write_resource_key is null
       and blocker.request_fingerprint is null
       and blocker.inventory_item_id is null
       and blocker.order_id is null
       and blocker.shipment_carrier is null
       and blocker.shipment_tracking is null
       and jsonb_typeof(blocker.request_payload) = 'object'
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

-- Return the one safe read-refresh blocker only when every immutable OAuth
-- claim fact is still exact. The claimant evaluates this both before and after
-- its advisory/table fences, so privileged direct maintenance cannot turn a
-- previously valid candidate into a different authorization between lookup
-- and provider credential disclosure.
create function sellerpilot_private.safe_lazada_oauth_claim_blocker(
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
     and oauth.provider_mutation_started_at is null
     and oauth.seller_account_key is not distinct from
           source_credential.seller_account_key
     and oauth.created_by = source_credential.created_by
     and oauth.write_resource_kind is null
     and oauth.write_resource_key is null
     and oauth.request_fingerprint is null
     and oauth.inventory_item_id is null
     and oauth.order_id is null
     and oauth.shipment_carrier is null
     and oauth.shipment_tracking is null
     and jsonb_typeof(oauth_request.decrypted_secret::jsonb) = 'object'
     and (
       select pg_catalog.array_agg(secret_key.key order by secret_key.key)
         from jsonb_object_keys(oauth_request.decrypted_secret::jsonb)
              as secret_key(key)
     ) = array['code']::text[]
     and length(trim(oauth_request.decrypted_secret::jsonb->>'code')) >= 8
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

-- A later seller authorization must not be rejected forever by an expired,
-- never-claimed callback. Discard only a different old grant after its 25
-- minute claim window and then delegate unchanged to the serialized enqueue.
alter function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) rename to sellerpilot_183000_enqueue_channel_gateway_unsafe;

revoke all on function
  public.sellerpilot_183000_enqueue_channel_gateway_unsafe(
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
  v_fingerprint text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_channel = 'lazada'
     and p_operation = 'oauth.exchange'
     and p_attempt_id is null
     and jsonb_typeof(p_request_payload) = 'object'
     and nullif(trim(p_request_payload->>'code'), '') is not null
     and length(p_request_payload->>'code') <= 8000 then
    v_fingerprint := encode(extensions.digest(
      jsonb_build_object(
        'channel', 'lazada',
        'code', trim(p_request_payload->>'code')
      )::text,
      'sha256'
    ), 'hex');
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('sellerpilot:lazada:production')
    );
    perform sellerpilot_private.discard_stale_unclaimed_lazada_oauth(
      p_credential_id,
      v_fingerprint
    );
  end if;
  return public.sellerpilot_183000_enqueue_channel_gateway_unsafe(
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(
  uuid, uuid, text, text, jsonb
) to service_role;

alter function public.sellerpilot_claim_serverless_gateway_job(text, text)
  rename to sellerpilot_183000_claim_serverless_gateway_unsafe;

revoke all on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text)
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
  v_token_id uuid;
  v_oauth_job_id uuid;
  v_blocker_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
  v_updated integer;
begin
  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for share;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- Never hand an authorization code to the provider after the bounded claim
  -- window. This also releases the enqueue replay fence for a later reauth.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs stale
     where stale.channel = 'lazada'
       and stale.environment = 'production'
       and stale.operation = 'oauth.exchange'
       and stale.status = 'queued'
       and stale.attempt_count = 0
       and stale.created_at <= clock_timestamp() - interval '25 minutes'
  ) then
    -- Cleanup is opportunistic. A malformed or multiply ambiguous stale
    -- Lazada row must keep Lazada OAuth fail-closed, but it must never starve
    -- unrelated Qoo10/Shopee/eBay work that the legacy claimant can safely
    -- advance. The nested block rolls back a partial cleanup on error and then
    -- delegates to the unchanged channel-scoped reconciliation fences below.
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('sellerpilot:lazada:production')
      );
      perform sellerpilot_private.discard_stale_unclaimed_lazada_oauth(
        stale.oauth_source_credential_id,
        null
      )
        from sellerpilot_private.channel_gateway_jobs stale
       where stale.channel = 'lazada'
         and stale.environment = 'production'
         and stale.operation = 'oauth.exchange'
         and stale.status = 'queued'
         and stale.attempt_count = 0
         and stale.created_at <= clock_timestamp() - interval '25 minutes'
       order by stale.created_at, stale.id
       limit 1;
    exception when others then
      null;
    end;
  end if;

  -- Locate only a job whose immutable OAuth lineage has exactly one safe
  -- blocker. The existing claimant remains authoritative for every other job.
  select oauth.id
    into v_oauth_job_id
    from sellerpilot_private.channel_gateway_jobs oauth
   where oauth.channel = 'lazada'
     and oauth.environment = 'production'
     and oauth.operation = 'oauth.exchange'
     and oauth.status = 'queued'
     and oauth.created_at > clock_timestamp() - interval '25 minutes'
     and oauth.created_at <= clock_timestamp() + interval '1 minute'
     and sellerpilot_private.safe_lazada_oauth_claim_blocker(oauth.id)
           is not null
   order by oauth.created_at, oauth.id
   limit 1;

  if v_oauth_job_id is null then
    return public.sellerpilot_183000_claim_serverless_gateway_unsafe(
      p_token_hash,
      p_worker_version
    );
  end if;

  -- Match the gateway completion/enqueue lock first and the Lazada credential
  -- rotation lock second. The row locks then protect the exact candidate and
  -- its older blocker through credential disclosure and claim ownership.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:lazada:production')
  );

  -- Match the privileged recovery lock order used by the previous Lazada
  -- repair. These short-lived table fences cover direct maintenance paths that
  -- do not participate in the advisory locks, including Vault rename/delete.
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;
  lock table sellerpilot_private.channel_credentials
    in share row exclusive mode;
  lock table vault.secrets
    in share row exclusive mode;

  -- Re-evaluate the complete immutable OAuth predicate after every fence and
  -- lock the exact OAuth/source rows before exposing either secret.
  select sellerpilot_private.safe_lazada_oauth_claim_blocker(oauth.id)
    into v_blocker_job_id
    from sellerpilot_private.channel_gateway_jobs oauth
    join sellerpilot_private.channel_credentials source_credential
      on source_credential.id = oauth.credential_id
     and source_credential.id = oauth.oauth_source_credential_id
   where oauth.id = v_oauth_job_id
     and sellerpilot_private.safe_lazada_oauth_claim_blocker(oauth.id)
           is not null
   for update of oauth
   for share of source_credential;
  if v_blocker_job_id is null then
    return null;
  end if;

  perform 1
    from sellerpilot_private.channel_gateway_jobs blocker
   where blocker.id = v_blocker_job_id
     and blocker.status = 'reconciliation_required'
   for update;
  if not found
     or sellerpilot_private.safe_lazada_oauth_refresh_blocker(v_oauth_job_id)
          is distinct from v_blocker_job_id then
    return null;
  end if;

  v_claim_token := gen_random_uuid();
  begin
    update sellerpilot_private.channel_gateway_jobs oauth
       set status = 'running',
           worker_token_id = v_token_id,
           claim_token = v_claim_token,
           attempt_count = 1,
           lease_expires_at = clock_timestamp() + interval '15 minutes',
           started_at = clock_timestamp(),
           error_message = null,
           updated_at = clock_timestamp()
     where oauth.id = v_oauth_job_id
       and oauth.status = 'queued'
       and oauth.attempt_count = 0
       and oauth.worker_token_id is null
       and oauth.claim_token is null
       and oauth.lease_expires_at is null
       and oauth.provider_mutation_started_at is null
       and oauth.oauth_request_vault_id is not null
       and oauth.created_at > clock_timestamp() - interval '25 minutes'
       and sellerpilot_private.safe_lazada_oauth_claim_blocker(oauth.id) =
             v_blocker_job_id;
    get diagnostics v_updated = row_count;
  exception when sqlstate 'SPC02' then
    v_updated := 0;
  end;

  if v_updated <> 1 then
    return null;
  end if;

  select jsonb_build_object(
    'id', oauth.id,
    'claim_token', oauth.claim_token,
    'credential_id', oauth.credential_id,
    'channel', oauth.channel,
    'operation', oauth.operation,
    'environment', oauth.environment,
    'request', oauth_request.decrypted_secret::jsonb,
    'attempt_count', oauth.attempt_count,
    'credential', credential_secret.decrypted_secret::jsonb
  )
    into v_result
    from sellerpilot_private.channel_gateway_jobs oauth
    join sellerpilot_private.channel_credentials credential
      on credential.id = oauth.credential_id
     and credential.id = oauth.oauth_source_credential_id
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > clock_timestamp()
     )
    join vault.decrypted_secrets credential_secret
      on credential_secret.id = credential.vault_secret_id
    join vault.decrypted_secrets oauth_request
      on oauth_request.id = oauth.oauth_request_vault_id
   where oauth.id = v_oauth_job_id
     and oauth.status = 'running'
     and oauth.worker_token_id = v_token_id
     and oauth.claim_token = v_claim_token
     and oauth.lease_expires_at > clock_timestamp()
     and sellerpilot_private.safe_lazada_oauth_refresh_blocker(oauth.id) =
           v_blocker_job_id;

  if v_result is null then
    raise exception 'safe Lazada OAuth claim material became unavailable'
      using errcode = '40001';
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_claim_serverless_gateway_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_serverless_gateway_job(text, text)
  to service_role;

comment on function public.sellerpilot_claim_serverless_gateway_job(text, text)
  is 'Claims the bounded serverless queue; only a newer Vault-backed Lazada OAuth grant may pass one exact safe read-only refresh reconciliation.';

create function sellerpilot_private.supersede_safe_lazada_refresh_after_oauth()
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
begin
  -- A failure in this best-effort reconciliation cleanup must not turn a
  -- provider-certified OAuth success into another uncertain exchange. The
  -- nested block is atomic: on any unexpected error its update and audit both
  -- roll back, while the older blocker remains reconciliation_required.
  begin
    if old.status is not distinct from new.status
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
       or new.provider_mutation_started_at is not null
       or new.oauth_source_credential_id is null
       or new.oauth_source_credential_id = new.credential_id
       or new.response_payload is null
       or jsonb_typeof(new.response_payload->'ok') <> 'boolean'
       or not coalesce((new.response_payload->>'ok')::boolean, false)
       or new.response_payload->>'channel' <> 'lazada'
       or new.response_payload->>'operation' <> 'oauth.exchange' then
      return new;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('sellerpilot:lazada:production')
    );

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
       and active_credential.seller_account_key_source =
             'provider_certified_v1'
       and active_credential.seller_account_verified_at is not null
       and (
         active_credential.expires_at is null
         or active_credential.expires_at > clock_timestamp()
       )
     for update;
    if not found then return new; end if;

    -- Defensive cleanup for any older, never-executed callback that predates
    -- this certified grant. Ordinarily the unique OAuth replay fence means
    -- there is none; if an exact stale row exists, its Vault secret cannot
    -- outlive the successful replacement.
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
           error_message =
             'LAZADA_REFRESH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH',
           credential_refresh_in_flight = false,
           credential_refresh_started_at = null,
           updated_at = v_superseded_at
     where blocker.id = v_blocker_job_id
       and blocker.status = 'reconciliation_required'
       and blocker.error_message = 'serverless_cs_execution_failed'
       and blocker.credential_id = new.oauth_source_credential_id
       and blocker.credential_refresh_in_flight
       and blocker.credential_refresh_started_at is not null
       and blocker.prepared_credential_id is null
       and blocker.credential_refresh_recovery_vault_id is null
       and blocker.provider_mutation_started_at is null;
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
      'lazada_refresh_reconciliation_superseded_by_certified_oauth',
      'channel_gateway_job',
      v_blocker_job_id::text,
      jsonb_build_object(
        'channel', 'lazada',
        'environment', 'production',
        'reason', 'provider_certified_oauth_replaced_uncertain_read_refresh',
        'oauth_job_id', new.id,
        'blocker_job_id', v_blocker_job_id,
        'blocker_operation', v_blocker_operation,
        'source_credential_id', new.oauth_source_credential_id,
        'replacement_credential_id', new.credential_id,
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

drop trigger if exists supersede_safe_lazada_refresh_after_oauth
  on sellerpilot_private.channel_gateway_jobs;
create trigger supersede_safe_lazada_refresh_after_oauth
after update of status on sellerpilot_private.channel_gateway_jobs
for each row
when (
  old.status is distinct from new.status
  and new.status = 'succeeded'
  and new.channel = 'lazada'
  and new.environment = 'production'
  and new.operation = 'oauth.exchange'
)
execute function
  sellerpilot_private.supersede_safe_lazada_refresh_after_oauth();

commit;
