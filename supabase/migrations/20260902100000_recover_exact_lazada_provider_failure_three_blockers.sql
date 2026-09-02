-- A fresh, single-call Lazada authorization returned a typed provider ISV
-- failure after the provider-call boundary.  The one-time code must never be
-- replayed, while the row must remain immutable until a different seller
-- authorization produces a provider-certified credential and a later,
-- claim-bound MY seller readback.  This exception is fixed to the two legacy
-- blockers plus that one failed OAuth job; it creates no OAuth job, token,
-- credential, provider call, target or listing permit.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 902100000);

do $verify_lazada_three_blocker_preimage$
declare
  v_oauth_source text;
  v_refresh_source text;
  v_proof_source text;
begin
  select procedure.prosrc into v_oauth_source
    from pg_catalog.pg_proc procedure
   where procedure.oid =
     'sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(uuid,uuid,text,text,timestamp with time zone)'::regprocedure
     and procedure.prosecdef
     and procedure.provolatile = 's'
     and procedure.proconfig is not distinct from array['search_path=""']::text[];
  select procedure.prosrc into v_refresh_source
    from pg_catalog.pg_proc procedure
   where procedure.oid =
     'sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)'::regprocedure
     and procedure.prosecdef
     and procedure.provolatile = 's'
     and procedure.proconfig is not distinct from array['search_path=""']::text[];
  select procedure.prosrc into v_proof_source
    from pg_catalog.pg_proc procedure
   where procedure.oid =
     'sellerpilot_private.exact_lazada_dual_readback_proof(uuid)'::regprocedure
     and procedure.prosecdef
     and procedure.provolatile = 's'
     and procedure.proconfig is not distinct from array['search_path=""']::text[];

  if v_oauth_source is null
     or pg_catalog.strpos(v_oauth_source,
          'safe_lazada_exact_dual_oauth_exchange_blocker') = 0
     or v_refresh_source is null
     or pg_catalog.strpos(v_refresh_source,
          'safe_lazada_exact_dual_oauth_refresh_blocker') = 0
     or v_proof_source is null
     or pg_catalog.strpos(v_proof_source,
          'lazada_exact_dual_blockers_intact') = 0 then
    raise exception 'Lazada three-blocker function preimage mismatch'
      using errcode = '55000';
  end if;
end;
$verify_lazada_three_blocker_preimage$;

create function sellerpilot_private.lazada_exact_three_blockers_intact(
  p_source_credential_id uuid,
  p_owner_id uuid,
  p_environment text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_source_credential_id =
           'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
    and p_owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and p_environment = 'production'
    and (
      select pg_catalog.array_agg(job.id order by job.id)
        from sellerpilot_private.channel_gateway_jobs job
       where job.channel = 'lazada'
         and job.environment = 'production'
         and job.status = 'reconciliation_required'
    ) = array[
      'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
      'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid,
      'faee01e1-2d68-4f99-951c-15684822fc43'::uuid
    ]
    and exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs blocker
        join sellerpilot_private.gateway_completion_receipts receipt
          on receipt.job_id = blocker.id
       where blocker.id =
               'faee01e1-2d68-4f99-951c-15684822fc43'::uuid
         and blocker.credential_id = p_source_credential_id
         and blocker.oauth_source_credential_id = p_source_credential_id
         and blocker.created_by = p_owner_id
         and blocker.channel = 'lazada'
         and blocker.environment = p_environment
         and blocker.operation = 'oauth.exchange'
         and blocker.status = 'reconciliation_required'
         and blocker.error_message = 'serverless_cs_execution_failed'
         and blocker.attempt_count = 1
         and blocker.attempt_id is null
         and blocker.listing_id is null
         and blocker.worker_token_id is null
         and blocker.claim_token is null
         and blocker.lease_expires_at is null
         and blocker.started_at =
               '2026-08-30 10:24:04.769695+00'::timestamptz
         and blocker.credential_refresh_started_at =
               '2026-08-30 10:24:05.519322+00'::timestamptz
         and blocker.completed_at =
               '2026-08-30 10:24:07.333213+00'::timestamptz
         and blocker.updated_at = blocker.completed_at
         and blocker.credential_refresh_in_flight
         and blocker.prepared_credential_id is null
         and blocker.credential_refresh_fingerprint is null
         and blocker.credential_refresh_prepared_at is null
         and blocker.credential_refresh_recovery_vault_id is null
         and blocker.credential_refresh_recovery_fingerprint is null
         and blocker.credential_refresh_recovery_staged_at is null
         and blocker.oauth_request_vault_id is null
         and blocker.oauth_request_fingerprint =
               '8a0f1f27e3b168ace4dd70a416b898caa92ef5ac4725fc08e1ea798fb28a6bfa'
         and not blocker.oauth_exchange_completed
         and blocker.oauth_provider_call_started_at is null
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
         and blocker.request_payload = jsonb_build_object('vaultBacked', true)
         and receipt.completion_fingerprint =
               '00d682385677bf3f888e8b565f1c3530049b58d1cf0f55d3023bfcbfbbb65fc8'
         and receipt.completion_fingerprint =
               sellerpilot_private.gateway_completion_fingerprint(
                 'reconciliation_required', null,
                 'serverless_cs_execution_failed', null, null, null, null
               )
         and receipt.created_at =
               '2026-08-30 10:24:07.470146+00'::timestamptz
    )
    and exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs blocker
        join sellerpilot_private.gateway_completion_receipts receipt
          on receipt.job_id = blocker.id
       where blocker.id =
               'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid
         and blocker.credential_id = p_source_credential_id
         and blocker.oauth_source_credential_id is null
         and blocker.created_by = p_owner_id
         and blocker.channel = 'lazada'
         and blocker.environment = p_environment
         and blocker.operation = 'orders.list'
         and blocker.status = 'reconciliation_required'
         and blocker.error_message = 'serverless_cs_execution_failed'
         and blocker.attempt_count = 1
         and blocker.attempt_id is null
         and blocker.listing_id is null
         and blocker.worker_token_id is null
         and blocker.claim_token is null
         and blocker.lease_expires_at is null
         and blocker.started_at =
               '2026-08-30 09:16:03.961623+00'::timestamptz
         and blocker.credential_refresh_started_at =
               '2026-08-30 09:16:05.208278+00'::timestamptz
         and blocker.completed_at =
               '2026-08-30 09:16:06.920132+00'::timestamptz
         and blocker.updated_at = blocker.completed_at
         and blocker.credential_refresh_in_flight
         and blocker.prepared_credential_id is null
         and blocker.credential_refresh_fingerprint is null
         and blocker.credential_refresh_prepared_at is null
         and blocker.credential_refresh_recovery_vault_id is null
         and blocker.credential_refresh_recovery_fingerprint is null
         and blocker.credential_refresh_recovery_staged_at is null
         and blocker.oauth_request_vault_id is null
         and blocker.oauth_request_fingerprint is null
         and not blocker.oauth_exchange_completed
         and blocker.oauth_provider_call_started_at is null
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
         and blocker.request_payload = jsonb_build_object(
           'arguments', jsonb_build_object(
             'queryParams', jsonb_build_object(
               'limit', '50',
               'created_after', '2026-08-16T09:16:01.458Z',
               'sort_direction', 'DESC'
             )
           ),
           'periodicKey', 'orders'
         )
         and receipt.completion_fingerprint =
               '00d682385677bf3f888e8b565f1c3530049b58d1cf0f55d3023bfcbfbbb65fc8'
         and receipt.completion_fingerprint =
               sellerpilot_private.gateway_completion_fingerprint(
                 'reconciliation_required', null,
                 'serverless_cs_execution_failed', null, null, null, null
               )
         and receipt.created_at =
               '2026-08-30 09:16:07.032446+00'::timestamptz
    )
    and exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs blocker
        join sellerpilot_private.gateway_completion_receipts receipt
          on receipt.job_id = blocker.id
       where blocker.id =
               'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
         and blocker.credential_id = p_source_credential_id
         and blocker.oauth_source_credential_id = p_source_credential_id
         and blocker.created_by = p_owner_id
         and blocker.channel = 'lazada'
         and blocker.environment = p_environment
         and blocker.operation = 'oauth.exchange'
         and blocker.status = 'reconciliation_required'
         and blocker.error_message =
               'LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED'
         and blocker.attempt_count = 1
         and blocker.attempt_id is null
         and blocker.listing_id is null
         and blocker.worker_token_id is null
         and blocker.claim_token is null
         and blocker.lease_expires_at is null
         and blocker.created_at =
               '2026-09-02 01:10:22.458355+00'::timestamptz
         and blocker.started_at =
               '2026-09-02 01:11:06.769536+00'::timestamptz
         and blocker.credential_refresh_started_at =
               '2026-09-02 01:11:14.013743+00'::timestamptz
         and blocker.oauth_provider_call_started_at =
               '2026-09-02 01:11:14.3005+00'::timestamptz
         and blocker.completed_at =
               '2026-09-02 01:11:15.504797+00'::timestamptz
         and blocker.updated_at = blocker.completed_at
         and blocker.credential_refresh_in_flight
         and blocker.prepared_credential_id is null
         and blocker.credential_refresh_fingerprint is null
         and blocker.credential_refresh_prepared_at is null
         and blocker.credential_refresh_recovery_vault_id is null
         and blocker.credential_refresh_recovery_fingerprint is null
         and blocker.credential_refresh_recovery_staged_at is null
         and blocker.oauth_request_vault_id is null
         and blocker.oauth_request_fingerprint =
               '663295c1520473aa753929d06e9e791e59b2059a73c706355086e52762b81681'
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
         and blocker.request_payload = jsonb_build_object('vaultBacked', true)
         and receipt.completion_fingerprint =
               'bfd9d9e768f23c0073eb656d24f1f2785a0904cdb62a98c0b465b63b0fc69198'
         and receipt.completion_fingerprint =
               sellerpilot_private.gateway_completion_fingerprint(
                 'reconciliation_required', null,
                 'LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED',
                 null, null, null, null
               )
         and receipt.created_at =
               '2026-09-02 01:11:15.728629+00'::timestamptz
    );
$$;

revoke all on function
  sellerpilot_private.lazada_exact_three_blockers_intact(uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function
  sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(
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
  select 'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
   where p_source_credential_id =
           'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
     and p_owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and p_environment = 'production'
     and p_new_oauth_fingerprint ~ '^[a-f0-9]{64}$'
     and p_new_oauth_fingerprint <>
           '8a0f1f27e3b168ace4dd70a416b898caa92ef5ac4725fc08e1ea798fb28a6bfa'
     and p_new_oauth_fingerprint is distinct from (
       select failed.oauth_request_fingerprint
         from sellerpilot_private.channel_gateway_jobs failed
        where failed.id =
          'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
     and p_new_created_at > clock_timestamp() - interval '25 minutes'
     and p_new_created_at <= clock_timestamp() + interval '1 minute'
     and sellerpilot_private.lazada_exact_three_blockers_intact(
           p_source_credential_id, p_owner_id, p_environment
         )
     and exists (
       select 1
         from sellerpilot_private.channel_credentials source_credential
        where source_credential.id = p_source_credential_id
          and source_credential.created_by = p_owner_id
          and source_credential.channel = 'lazada'
          and source_credential.environment = 'production'
          and source_credential.version = 5
          and source_credential.status = 'active'
          and (
            source_credential.expires_at is null
            or source_credential.expires_at > p_new_created_at
          )
          and source_credential.seller_account_key is null
          and source_credential.seller_account_key_source =
                'legacy_unattested'
          and source_credential.seller_account_verified_at is null
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_oauth
        where other_oauth.channel = 'lazada'
          and other_oauth.environment = 'production'
          and other_oauth.operation = 'oauth.exchange'
          and other_oauth.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and other_oauth.id not in (
            'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
            'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
          )
          and not (
            other_oauth.oauth_source_credential_id = p_source_credential_id
            and other_oauth.oauth_request_fingerprint =
                  p_new_oauth_fingerprint
            and other_oauth.created_at = p_new_created_at
          )
     )
     and (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs current_oauth
        where current_oauth.channel = 'lazada'
          and current_oauth.environment = 'production'
          and current_oauth.operation = 'oauth.exchange'
          and current_oauth.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and current_oauth.id not in (
            'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
            'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
          )
          and current_oauth.oauth_source_credential_id =
                p_source_credential_id
          and current_oauth.oauth_request_fingerprint =
                p_new_oauth_fingerprint
          and current_oauth.created_at = p_new_created_at
     ) <= 1;
$$;

revoke all on function
  sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(
    uuid,uuid,text,text,timestamptz
  ) from public, anon, authenticated, service_role;

alter function
  sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
    uuid,uuid,text,text,timestamptz
  ) rename to sellerpilot_0209021000_oauth_blocker_pre_three;

revoke all on function
  sellerpilot_private.sellerpilot_0209021000_oauth_blocker_pre_three(
    uuid,uuid,text,text,timestamptz
  ) from public, anon, authenticated, service_role;

create function
  sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
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
  select coalesce(
    sellerpilot_private.sellerpilot_0209021000_oauth_blocker_pre_three(
      p_source_credential_id, p_owner_id, p_environment,
      p_new_oauth_fingerprint, p_new_created_at
    ),
    sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(
      p_source_credential_id, p_owner_id, p_environment,
      p_new_oauth_fingerprint, p_new_created_at
    )
  );
$$;

revoke all on function
  sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
    uuid,uuid,text,text,timestamptz
  ) from public, anon, authenticated, service_role;

create function
  sellerpilot_private.safe_lazada_exact_three_oauth_refresh_blocker(
    p_oauth_job_id uuid
  )
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(
           oauth.oauth_source_credential_id,
           oauth.created_by,
           oauth.environment,
           oauth.oauth_request_fingerprint,
           oauth.created_at
         )
    from sellerpilot_private.channel_gateway_jobs oauth
   where oauth.id = p_oauth_job_id
     and oauth.credential_id =
           'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
     and oauth.oauth_source_credential_id = oauth.credential_id
     and oauth.created_by =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and oauth.channel = 'lazada'
     and oauth.environment = 'production'
     and oauth.operation = 'oauth.exchange'
     and oauth.status in ('queued', 'running')
     and oauth.created_at > clock_timestamp() - interval '25 minutes'
     and oauth.created_at <= clock_timestamp() + interval '1 minute'
     and oauth.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
     and oauth.oauth_request_fingerprint is distinct from (
       select failed.oauth_request_fingerprint
         from sellerpilot_private.channel_gateway_jobs failed
        where failed.id =
          'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_oauth
        where other_oauth.channel = 'lazada'
          and other_oauth.environment = 'production'
          and other_oauth.operation = 'oauth.exchange'
          and other_oauth.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and other_oauth.id not in (
            oauth.id,
            'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
            'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
          )
     );
$$;

revoke all on function
  sellerpilot_private.safe_lazada_exact_three_oauth_refresh_blocker(uuid)
  from public, anon, authenticated, service_role;

alter function sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)
  rename to sellerpilot_0209021000_refresh_blocker_pre_three;

revoke all on function
  sellerpilot_private.sellerpilot_0209021000_refresh_blocker_pre_three(uuid)
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
  select coalesce(
    sellerpilot_private.sellerpilot_0209021000_refresh_blocker_pre_three(
      p_oauth_job_id
    ),
    sellerpilot_private.safe_lazada_exact_three_oauth_refresh_blocker(
      p_oauth_job_id
    )
  );
$$;

revoke all on function
  sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.exact_lazada_three_readback_proof(
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target sellerpilot_private.channel_market_targets%rowtype;
  v_source sellerpilot_private.channel_credentials%rowtype;
  v_active sellerpilot_private.channel_credentials%rowtype;
  v_failed sellerpilot_private.channel_gateway_jobs%rowtype;
  v_oauth sellerpilot_private.channel_gateway_jobs%rowtype;
  v_seller_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_secret jsonb;
  v_subject text;
  v_expected_subject text;
  v_canonical_stores text;
  v_expected_key text;
  v_store_count integer;
  v_country_count integer;
  v_my_count integer;
  v_my_seller_id text;
  v_my_user_id text;
  v_step jsonb;
  v_seller jsonb;
  v_readback_seller_id text;
  v_readback_status text;
begin
  select target.* into v_target
    from sellerpilot_private.channel_market_targets target
   where target.id = p_target_id
     and target.owner_id =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and target.channel = 'lazada'
     and target.environment = 'production'
     and target.market_code = 'MY'
     and target.target_id = '200100300'
     and target.locale = 'ms-MY'
     and target.currency = 'MYR'
     and (
       nullif(trim(target.remote_status), '') is null
       or lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
     )
     and target.verified_at is not null
     and target.verified_at <= clock_timestamp() + interval '1 minute';
  if not found then return null; end if;

  if not sellerpilot_private.lazada_exact_three_blockers_intact(
    'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    'production'
  ) then return null; end if;

  select failed.* into v_failed
    from sellerpilot_private.channel_gateway_jobs failed
   where failed.id =
         'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid;
  if not found then return null; end if;

  select credential.* into v_source
    from sellerpilot_private.channel_credentials credential
   where credential.id =
           'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
     and credential.created_by =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.version = 5
     and credential.status = 'revoked'
     and credential.seller_account_key is null
     and credential.seller_account_key_source = 'legacy_unattested'
     and credential.seller_account_verified_at is null;
  if not found then return null; end if;

  select credential.* into v_active
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_target.credential_id
     and credential.created_by = v_target.owner_id
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.version > 5
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > clock_timestamp()
     )
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found or (
    select count(*)
      from sellerpilot_private.channel_credentials active_credential
     where active_credential.created_by = v_target.owner_id
       and active_credential.channel = 'lazada'
       and active_credential.environment = 'production'
       and active_credential.status = 'active'
  ) <> 1 then return null; end if;

  select decrypted.decrypted_secret::jsonb into v_secret
    from vault.decrypted_secrets decrypted
   where decrypted.id = v_active.vault_secret_id;
  if v_secret is null
     or coalesce(lower(trim(v_secret->>'country')), '') <> 'my'
     or coalesce(lower(trim(v_secret->>'account_platform')), '') <>
          'seller_center'
     or coalesce(v_secret->>'provider_account_identity_version', '') <> 'v1'
     or length(coalesce(v_secret->>'provider_account_subject', ''))
          not between 50 and 522
     or coalesce(v_secret->>'provider_account_subject', '') !~
          '^lazada:v1:[A-Za-z0-9_-]+$'
     or jsonb_typeof(v_secret->'country_user_info') <> 'array'
     or jsonb_array_length(v_secret->'country_user_info') = 0
     or length(coalesce(v_secret->>'access_token', '')) < 8
     or length(coalesce(v_secret->>'refresh_token', '')) < 8 then
    return null;
  end if;
  v_subject := v_secret->>'provider_account_subject';
  v_expected_key := encode(extensions.digest(
    'lazada' || E'\x1f' || 'production' || E'\x1f' || v_subject,
    'sha256'
  ), 'hex');
  if v_expected_key is distinct from v_active.seller_account_key then
    return null;
  end if;

  select count(*)::integer,
         count(distinct lower(trim(store->>'country')))::integer,
         count(*) filter (
           where lower(trim(store->>'country')) = 'my'
         )::integer,
         min(store->>'seller_id') filter (
           where lower(trim(store->>'country')) = 'my'
         ),
         min(store->>'user_id') filter (
           where lower(trim(store->>'country')) = 'my'
         )
    into v_store_count, v_country_count, v_my_count,
         v_my_seller_id, v_my_user_id
    from jsonb_array_elements(v_secret->'country_user_info') store
   where jsonb_typeof(store) = 'object'
     and lower(trim(store->>'country')) in ('id','my','ph','sg','th','vn')
     and store->>'seller_id' ~ '^[1-9][0-9]{0,31}$'
     and store->>'user_id' ~ '^[1-9][0-9]{0,31}$'
     and (
       nullif(trim(store->>'short_code'), '') is null
       or upper(trim(store->>'short_code')) ~ '^[A-Z0-9_-]{1,64}$'
     );
  if v_store_count <> jsonb_array_length(v_secret->'country_user_info')
     or v_country_count <> v_store_count
     or v_my_count <> 1
     or v_my_seller_id <> v_target.target_id
     or v_my_seller_id <> '200100300'
     or v_my_user_id !~ '^[1-9][0-9]{0,31}$' then
    return null;
  end if;

  select string_agg(
           pg_catalog.format(
             '["%s","%s","%s"]',
             lower(trim(store->>'country')),
             store->>'seller_id',
             store->>'user_id'
           ),
           ',' order by lower(trim(store->>'country')),
                        store->>'seller_id', store->>'user_id'
         )
    into v_canonical_stores
    from jsonb_array_elements(v_secret->'country_user_info') store;
  v_expected_subject := 'lazada:v1:' || pg_catalog.translate(
    pg_catalog.rtrim(
      pg_catalog.replace(
        pg_catalog.encode(
          pg_catalog.convert_to(
            '["seller_center",[' || v_canonical_stores || ']]',
            'UTF8'
          ),
          'base64'
        ),
        E'\n',
        ''
      ),
      '='
    ),
    '+/',
    '-_'
  );
  if v_subject is distinct from v_expected_subject then return null; end if;

  with candidates as materialized (
    select job.*
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.gateway_completion_receipts receipt
        on receipt.job_id = job.id
       and receipt.claim_token = job.claim_token
       and receipt.worker_token_id = job.worker_token_id
     where job.oauth_source_credential_id = v_source.id
       and job.credential_id = v_active.id
       and job.prepared_credential_id = v_active.id
       and job.created_by = v_target.owner_id
       and job.channel = 'lazada'
       and job.environment = 'production'
       and job.operation = 'oauth.exchange'
       and job.status = 'succeeded'
       and job.error_message is null
       and job.attempt_count = 1
       and job.attempt_id is null
       and job.listing_id is null
       and job.worker_token_id is not null
       and job.claim_token is not null
       and job.lease_expires_at is null
       and job.created_at > v_failed.completed_at
       and job.created_at > clock_timestamp() - interval '25 minutes'
       and job.created_at <= clock_timestamp() + interval '1 minute'
       and job.started_at is not null
       and job.oauth_provider_call_started_at is not null
       and job.credential_refresh_prepared_at is not null
       and job.completed_at is not null
       and job.updated_at >= job.completed_at
       and job.completed_at <= clock_timestamp() + interval '1 minute'
       and job.started_at <= job.oauth_provider_call_started_at
       and job.oauth_provider_call_started_at <=
             job.credential_refresh_prepared_at
       and job.credential_refresh_prepared_at <= job.completed_at
       and job.oauth_exchange_completed
       and not job.credential_refresh_in_flight
       and job.credential_refresh_started_at is null
       and job.credential_refresh_fingerprint ~ '^[a-f0-9]{64}$'
       and job.credential_refresh_recovery_vault_id is null
       and job.credential_refresh_recovery_fingerprint is null
       and job.credential_refresh_recovery_staged_at is null
       and job.oauth_request_vault_id is null
       and job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
       and job.oauth_request_fingerprint is distinct from
             v_failed.oauth_request_fingerprint
       and job.request_payload = jsonb_build_object('vaultBacked', true)
       and job.provider_mutation_started_at is null
       and job.seller_account_key is null
       and coalesce((job.response_payload->>'ok')::boolean, false)
       and job.response_payload->>'channel' = 'lazada'
       and job.response_payload->>'operation' = 'oauth.exchange'
       and receipt.completion_fingerprint ~ '^[a-f0-9]{64}$'
       and receipt.created_at >= job.completed_at
       and receipt.created_at <= clock_timestamp() + interval '1 minute'
  )
  select candidate.* into v_oauth
    from candidates candidate
   where (select count(*) from candidates) = 1;
  if not found
     or v_active.seller_account_verified_at <
          v_oauth.credential_refresh_prepared_at
     or v_active.seller_account_verified_at > v_oauth.completed_at
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_oauth
        where other_oauth.channel = 'lazada'
          and other_oauth.environment = 'production'
          and other_oauth.operation = 'oauth.exchange'
          and other_oauth.status in (
            'queued', 'running', 'reconciliation_required'
          )
          and other_oauth.id not in (
            'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
            'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
          )
     ) then return null; end if;

  with candidates as materialized (
    select job.*
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.gateway_completion_receipts receipt
        on receipt.job_id = job.id
       and receipt.claim_token = job.claim_token
       and receipt.worker_token_id = job.worker_token_id
     where job.credential_id = v_active.id
       and job.created_by = v_target.owner_id
       and job.channel = 'lazada'
       and job.environment = 'production'
       and job.operation = 'shops.get'
       and job.status = 'succeeded'
       and job.error_message is null
       and job.attempt_count = 1
       and job.attempt_id is null
       and job.listing_id is null
       and job.worker_token_id is not null
       and job.claim_token is not null
       and job.lease_expires_at is null
       and job.started_at is not null
       and job.seller_account_key = v_active.seller_account_key
       and job.request_payload = jsonb_build_object('country', 'my')
       and job.created_at >= v_oauth.completed_at
       and job.started_at >= job.created_at
       and job.completed_at is not null
       and job.completed_at >= job.started_at
       and job.updated_at >= job.completed_at
       and job.completed_at <= clock_timestamp() + interval '1 minute'
       and not job.credential_refresh_in_flight
       and job.credential_refresh_started_at is null
       and job.prepared_credential_id is null
       and job.credential_refresh_fingerprint is null
       and job.credential_refresh_prepared_at is null
       and job.credential_refresh_recovery_vault_id is null
       and job.credential_refresh_recovery_fingerprint is null
       and job.credential_refresh_recovery_staged_at is null
       and job.oauth_request_vault_id is null
       and job.oauth_request_fingerprint is null
       and job.oauth_source_credential_id is null
       and not job.oauth_exchange_completed
       and job.oauth_provider_call_started_at is null
       and job.provider_mutation_started_at is null
       and job.response_payload->>'ok' = 'true'
       and job.response_payload->>'channel' = 'lazada'
       and job.response_payload->>'operation' = 'shops.get'
       and jsonb_typeof(job.response_payload->'steps') = 'array'
       and jsonb_array_length(job.response_payload->'steps') = 1
       and receipt.completion_fingerprint =
             sellerpilot_private.gateway_completion_fingerprint(
               'succeeded', job.response_payload, null,
               null, null, null, null
             )
       and receipt.created_at >= job.completed_at
       and receipt.created_at <= clock_timestamp() + interval '1 minute'
  )
  select candidate.* into v_seller_job
    from candidates candidate
   where (select count(*) from candidates) = 1;
  if not found or v_target.verified_at < v_seller_job.completed_at then
    return null;
  end if;

  v_step := v_seller_job.response_payload#>'{steps,0}';
  if coalesce(v_step->>'name', '') <> 'seller-info'
     or coalesce(v_step->>'ok', '') <> 'true'
     or coalesce((v_step->>'status')::integer, 0) not between 200 and 299 then
    return null;
  end if;
  v_seller := case
    when jsonb_typeof(v_step#>'{data,data}') = 'object'
      then v_step#>'{data,data}'
    when jsonb_typeof(v_step#>'{data,result,data}') = 'object'
      then v_step#>'{data,result,data}'
    when jsonb_typeof(v_step->'data') = 'object'
      then v_step->'data'
    else '{}'::jsonb
  end;
  v_readback_seller_id := trim(coalesce(
    v_seller->>'seller_id', v_seller->>'sellerId', v_seller->>'id', ''
  ));
  v_readback_status := lower(trim(coalesce(
    v_seller->>'is_active', v_seller->>'isActive',
    v_seller->>'status', v_seller->>'seller_status', ''
  )));
  if v_readback_seller_id <> v_my_seller_id
     or v_readback_seller_id <> v_target.target_id
     or v_readback_status not in (
       'true', '1', 'yes', 'active', 'enabled'
     ) then return null; end if;

  return jsonb_build_object(
    'sourceCredentialId', v_source.id,
    'activeCredentialId', v_active.id,
    'oauthJobId', v_oauth.id,
    'sellerReadbackJobId', v_seller_job.id,
    'targetRowId', v_target.id,
    'sellerId', v_target.target_id
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.exact_lazada_three_readback_proof(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_exact_lazada_failed_oauth_blocker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := coalesce(current_setting(
    'sellerpilot.exact_lazada_three_blocker_supersession', true
  ), '');
begin
  if old.id <>
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE'
     or v_marker !~
       '^v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or old.status <> 'reconciliation_required'
     or new.status <> 'cancelled'
     or new.error_message <>
       'LAZADA_PROVIDER_FAILURE_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
     or new.credential_refresh_in_flight
     or new.credential_refresh_started_at is not null
     or new.updated_at <= old.updated_at
     or (to_jsonb(new) - array[
           'status', 'error_message', 'credential_refresh_in_flight',
           'credential_refresh_started_at', 'updated_at'
         ]::text[]) is distinct from
        (to_jsonb(old) - array[
           'status', 'error_message', 'credential_refresh_in_flight',
           'credential_refresh_started_at', 'updated_at'
         ]::text[]) then
    raise exception 'exact failed Lazada OAuth blocker is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_exact_lazada_failed_oauth_blocker()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_exact_lazada_failed_oauth_blocker
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_exact_lazada_failed_oauth_blocker
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_exact_lazada_failed_oauth_blocker();

create function
  sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proof jsonb;
  v_superseded_at timestamptz;
  v_updated integer;
begin
  if new.owner_id <>
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or new.channel <> 'lazada'
     or new.environment <> 'production'
     or new.market_code <> 'MY'
     or new.target_id <> '200100300' then
    return new;
  end if;

  begin
    perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('sellerpilot:lazada:production')
    );
    perform 1
      from sellerpilot_private.channel_gateway_jobs blocker
     where blocker.id in (
       'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
       'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
     order by blocker.id
     for update;
    perform 1
      from sellerpilot_private.channel_credentials credential
     where credential.id in (
       'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid,
       new.credential_id
     )
     order by credential.id
     for update;

    v_proof := sellerpilot_private.exact_lazada_three_readback_proof(new.id);
    if v_proof is null then return new; end if;
    perform set_config(
      'sellerpilot.exact_lazada_dual_blocker_supersession',
      'v1:' || (v_proof->>'activeCredentialId'),
      true
    );
    perform set_config(
      'sellerpilot.exact_lazada_three_blocker_supersession',
      'v1:' || (v_proof->>'activeCredentialId'),
      true
    );
    v_superseded_at := clock_timestamp();
    update sellerpilot_private.channel_gateway_jobs blocker
       set status = 'cancelled',
           error_message = case blocker.id
             when 'faee01e1-2d68-4f99-951c-15684822fc43'::uuid then
               'LAZADA_OAUTH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
             when 'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid then
               'LAZADA_REFRESH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
             else
               'LAZADA_PROVIDER_FAILURE_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH_AND_SELLER_READBACK'
           end,
           credential_refresh_in_flight = false,
           credential_refresh_started_at = null,
           updated_at = v_superseded_at
     where blocker.id in (
       'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
       'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
       and blocker.status = 'reconciliation_required'
       and blocker.credential_id =
             'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid
       and blocker.credential_refresh_in_flight;
    get diagnostics v_updated = row_count;
    if v_updated <> 3 then
      raise exception 'exact Lazada three-blocker supersession lost'
        using errcode = '55000';
    end if;

    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail, occurred_at
    )
    select
      '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
      case blocker.id
        when 'faee01e1-2d68-4f99-951c-15684822fc43'::uuid then
          'lazada_oauth_reconciliation_superseded_after_seller_readback'
        when 'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid then
          'lazada_refresh_reconciliation_superseded_after_seller_readback'
        else
          'lazada_provider_failure_reconciliation_superseded_after_seller_readback'
      end,
      'channel_gateway_job', blocker.id::text,
      jsonb_build_object(
        'channel', 'lazada',
        'environment', 'production',
        'source_credential_id',
          'e54fa95d-ddfd-414f-82e9-636a0d9ab07c'::uuid,
        'active_credential_id', v_proof->>'activeCredentialId',
        'oauth_job_id', v_proof->>'oauthJobId',
        'seller_readback_job_id', v_proof->>'sellerReadbackJobId',
        'target_row_id', new.id,
        'market', 'MY',
        'seller_id', '200100300',
        'failed_oauth_job_id',
          'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid,
        'failed_oauth_code_replayed', false,
        'provider_call_replayed', false,
        'listing_permit_created', false,
        'superseded_after_provider_certified_oauth', true,
        'superseded_after_active_seller_readback', true
      ),
      v_superseded_at
      from sellerpilot_private.channel_gateway_jobs blocker
     where blocker.id in (
       'faee01e1-2d68-4f99-951c-15684822fc43'::uuid,
       'a976573f-a150-4061-a1c6-5e8e4880ba2b'::uuid,
       'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
     )
     order by blocker.id;
  exception when others then
    return new;
  end;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback()
  from public, anon, authenticated, service_role;

drop trigger if exists supersede_exact_lazada_three_blockers_after_readback
  on sellerpilot_private.channel_market_targets;
create trigger supersede_exact_lazada_three_blockers_after_readback
after insert or update on sellerpilot_private.channel_market_targets
for each row execute function
  sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback();

do $verify_lazada_three_blocker_postimage$
declare
  v_signature regprocedure;
  v_trigger_count integer;
begin
  foreach v_signature in array array[
    'sellerpilot_private.lazada_exact_three_blockers_intact(uuid,uuid,text)'::regprocedure,
    'sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(uuid,uuid,text,text,timestamp with time zone)'::regprocedure,
    'sellerpilot_private.sellerpilot_0209021000_oauth_blocker_pre_three(uuid,uuid,text,text,timestamp with time zone)'::regprocedure,
    'sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(uuid,uuid,text,text,timestamp with time zone)'::regprocedure,
    'sellerpilot_private.safe_lazada_exact_three_oauth_refresh_blocker(uuid)'::regprocedure,
    'sellerpilot_private.sellerpilot_0209021000_refresh_blocker_pre_three(uuid)'::regprocedure,
    'sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)'::regprocedure,
    'sellerpilot_private.exact_lazada_three_readback_proof(uuid)'::regprocedure,
    'sellerpilot_private.guard_exact_lazada_failed_oauth_blocker()'::regprocedure,
    'sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback()'::regprocedure
  ] loop
    if not exists (
      select 1
        from pg_catalog.pg_proc procedure
       where procedure.oid = v_signature
         and procedure.prosecdef
         and procedure.proconfig is not distinct from
               array['search_path=""']::text[]
    )
       or pg_catalog.has_function_privilege(
            'anon', v_signature::oid, 'EXECUTE'
          )
       or pg_catalog.has_function_privilege(
            'authenticated', v_signature::oid, 'EXECUTE'
          )
       or pg_catalog.has_function_privilege(
            'service_role', v_signature::oid, 'EXECUTE'
          ) then
      raise exception 'Lazada three-blocker function postimage mismatch'
        using errcode = '55000', detail = v_signature::text;
    end if;
  end loop;

  select count(*)::integer into v_trigger_count
    from pg_catalog.pg_trigger installed_trigger
   where not installed_trigger.tgisinternal
     and installed_trigger.tgenabled = 'O'
     and (
       (
         installed_trigger.tgrelid =
           'sellerpilot_private.channel_gateway_jobs'::regclass
         and installed_trigger.tgname =
               'guard_exact_lazada_failed_oauth_blocker'
         and installed_trigger.tgfoid =
           'sellerpilot_private.guard_exact_lazada_failed_oauth_blocker()'::regprocedure
       )
       or (
         installed_trigger.tgrelid =
           'sellerpilot_private.channel_market_targets'::regclass
         and installed_trigger.tgname =
               'supersede_exact_lazada_three_blockers_after_readback'
         and installed_trigger.tgfoid =
           'sellerpilot_private.supersede_exact_lazada_three_blockers_after_readback()'::regprocedure
       )
     );
  if v_trigger_count <> 2 then
    raise exception 'Lazada three-blocker trigger postimage mismatch'
      using errcode = '55000';
  end if;
end;
$verify_lazada_three_blocker_postimage$;

comment on function
  sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)
is 'Preserves all earlier Lazada OAuth fences and admits one different fresh grant only through the exact legacy v5 three-blocker recovery.';
comment on function
  sellerpilot_private.exact_lazada_three_readback_proof(uuid)
is 'Returns opaque identifiers only after a different provider-certified OAuth and later claim-bound active MY seller/get readback prove exact three-blocker supersession.';

commit;
