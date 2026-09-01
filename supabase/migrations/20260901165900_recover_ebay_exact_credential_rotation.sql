-- Forward-only recovery for the one exact eBay retry permit whose immutable
-- pre-gateway attempt was recorded with credential v99 before OAuth rotated
-- to the sole active provider-certified credential v100. The historical
-- attempt remains unchanged. A later explicit arm call may rotate only the
-- still-unbound permit snapshot and reopen its five-minute enqueue window.
-- This migration never enqueues a gateway job or calls the provider.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000002);

create or replace function
  sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
    p_credential_id uuid,
    p_release_sha text,
    p_request_fingerprint text
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_credential_id =
      '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid
    and p_request_fingerprint =
      'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
    and sellerpilot_private.exact_existing_update_release_is_current(
          'ebay', p_release_sha
        )
    and sellerpilot_private.ebay_exact_current_credential_is_valid(
          p_credential_id,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        )
    and exists (
      select 1
        from sellerpilot_private.product_listings listing
        join sellerpilot_private.products product
          on product.id = listing.product_id
         and product.owner_id = listing.owner_id
        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id =
               'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid
         and attempt.owner_id = listing.owner_id
         and attempt.credential_id =
               '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
         and attempt.channel = listing.channel_key
        join sellerpilot_private.channel_credentials historical_credential
          on historical_credential.id = attempt.credential_id
         and historical_credential.channel = listing.channel_key
         and historical_credential.seller_account_key =
               listing.seller_account_key
        join sellerpilot_private.channel_credentials current_credential
          on current_credential.id = p_credential_id
         and current_credential.channel = listing.channel_key
         and current_credential.seller_account_key =
               listing.seller_account_key
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.permit_id =
               '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
         and permit.listing_id = listing.id
         and permit.product_id = listing.product_id
         and permit.owner_id = listing.owner_id
         and permit.credential_id = historical_credential.id
        join sellerpilot_private.channel_gateway_jobs source_job
          on source_job.id = permit.retry_source_job_id
        join sellerpilot_private.channel_operation_attempts source_attempt
          on source_attempt.id = permit.retry_source_attempt_id
        join sellerpilot_private.exact_existing_update_permits source_permit
          on source_permit.permit_id = permit.retry_source_permit_id
       where listing.id =
               '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
         and listing.owner_id =
               '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and listing.product_id =
               'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and listing.channel_key = 'ebay'
         and listing.status = 'failed'
         and listing.failure_class = 'retryable'
         and listing.operation_attempt_id = attempt.id
         and listing.remote_id = '800551945442'
         and listing.market = 'US'
         and listing.target_id = 'EBAY_US'
         and listing.marketplace_sku = 'QA-20260823-CC-001-US'
         and listing.provider_resource_id = '244042196011'
         and listing.remote_resources = '{}'::jsonb
         and listing.currency = 'USD'
         and listing.price = 12.90
         and listing.requested_publication_intent = 'live'
         and listing.remote_visibility = 'unknown'
         and listing.provider_status is null
         and listing.published_at is null
         and listing.seller_account_key =
               'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
         and product.sku = 'QA-20260823-CC-001'
         and product.on_hand = permit.stock
         and product.on_hand between 1 and 999999
         and not product.demo
         and product.status <> 'archived'
         and attempt.operation = 'listing.update'
         and attempt.request_fingerprint = p_request_fingerprint
         and attempt.status = 'failed'
         and attempt.http_status = 422
         and attempt.remote_id is null
         and attempt.gateway_write_required
         and attempt.pre_gateway_retryable
         and attempt.completed_at >=
               '2026-09-01 09:03:06+00'::timestamptz
         and attempt.completed_at <
               '2026-09-01 09:03:07+00'::timestamptz
         and attempt.seller_account_key = listing.seller_account_key
         and historical_credential.id =
               '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
         and historical_credential.environment = 'production'
         and historical_credential.version = 99
         and historical_credential.fingerprint ~ '^[A-F0-9]{12}$'
         and historical_credential.seller_account_key_source =
               'provider_certified_v1'
         and historical_credential.seller_account_verified_at is not null
         and current_credential.id =
               '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid
         and current_credential.environment = 'production'
         and current_credential.status = 'active'
         and current_credential.version = 100
         and current_credential.fingerprint ~ '^[A-F0-9]{12}$'
         and current_credential.seller_account_key_source =
               'provider_certified_v1'
         and current_credential.seller_account_verified_at is not null
         and current_credential.expires_at > statement_timestamp()
         and current_credential.last_checked_at is not null
         and current_credential.last_check_status = 'passed'
         and permit.channel = 'ebay'
         and permit.market = 'US'
         and permit.target_id = 'EBAY_US'
         and permit.remote_id = '800551945442'
         and permit.seller_sku = 'QA-20260823-CC-001-US'
         and permit.provider_resource_id = '244042196011'
         and permit.currency = 'USD'
         and permit.price = 12.90
         and permit.seller_account_key = listing.seller_account_key
         and permit.credential_version = historical_credential.version
         and permit.credential_fingerprint = historical_credential.fingerprint
         and permit.credential_account_source =
               historical_credential.seller_account_key_source
         and permit.credential_verified_at =
               historical_credential.seller_account_verified_at
         and permit.credential_expires_at is not distinct from
               historical_credential.expires_at
         and permit.credential_last_checked_at is not distinct from
               historical_credential.last_checked_at
         and permit.credential_last_check_status is not distinct from
               historical_credential.last_check_status
         and permit.release_sha = p_release_sha
         and permit.request_fingerprint = p_request_fingerprint
         and permit.retry_source_job_id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and permit.retry_source_attempt_id =
               '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
         and permit.retry_source_permit_id =
               'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
         and permit.retry_source_response_sha256 = encode(
               extensions.digest(source_job.response_payload::text, 'sha256'),
               'hex'
             )
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.arguments_sha256 is null
         and permit.arguments_bytes is null
         and permit.request_payload_sha256 is null
         and permit.request_payload_bytes is null
         and permit.bound_at is null
         and permit.bound_worker_token_id is null
         and permit.bound_claim_token is null
         and permit.consumed_at is null
         and permit.invalidated_at is null
         and permit.invalidation_reason is null
         and permit.expires_at <= statement_timestamp()
         and source_job.id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and source_job.attempt_id = source_attempt.id
         and source_job.listing_id = listing.id
         and source_job.credential_id = historical_credential.id
         and source_job.channel = 'ebay'
         and source_job.operation = 'listing.update'
         and source_job.environment = 'production'
         and source_job.status = 'succeeded'
         and source_job.response_payload->>'ok' = 'false'
         and source_job.response_payload#>>
               '{steps,3,data,errors,0,errorId}' = '25718'
         and not jsonb_path_exists(
               source_job.response_payload,
               '$.steps[*] ? (@.name == "offer-update")'
             )
         and source_attempt.id =
               '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
         and source_attempt.credential_id = historical_credential.id
         and source_attempt.status = 'failed'
         and source_attempt.http_status = 400
         and source_attempt.remote_id = '800551945442'
         and source_attempt.gateway_write_required
         and not source_attempt.pre_gateway_retryable
         and source_permit.update_job_id = source_job.id
         and source_permit.update_attempt_id = source_attempt.id
         and source_permit.credential_id = historical_credential.id
         and source_permit.bound_at is not null
         and source_permit.bound_worker_token_id is not null
         and source_permit.bound_claim_token is not null
         and source_permit.consumed_at is not null
         and source_permit.invalidated_at is not null
         and source_permit.invalidation_reason =
               'ebay_deterministic_no_effect_400'
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs retry_job
            where retry_job.attempt_id = attempt.id
         )
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs active_job
            where active_job.listing_id = listing.id
              and active_job.operation in (
                'listing.create', 'listing.update', 'listing.stop'
              )
              and active_job.status in (
                'queued', 'running', 'reconciliation_required'
              )
         )
         and exists (
           select 1
             from sellerpilot_private.marketplace_normalized_asset_refs ref
             join sellerpilot_private.marketplace_normalized_assets asset
               on asset.object_path = ref.object_path
            where ref.attempt_id = attempt.id
              and ref.owner_id = listing.owner_id
              and ref.product_id = listing.product_id
              and ref.channel = 'ebay'
              and ref.market = 'US'
              and ref.target_id = 'EBAY_US'
              and ref.upload_confirmed_at is not null
              and ref.canonical_public_url is not null
              and ref.canonical_public_url ~
                    '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}[.]jpg$'
              and asset.status = 'available'
              and asset.uploaded_at is not null
            having count(*) = 13
               and count(distinct ref.object_path) = 13
               and count(distinct ref.canonical_public_url) = 13
         )
         and not exists (
           select 1
             from sellerpilot_private.operation_audit audit
            where audit.action in (
                    'ebay_exact_pre_gateway_credential_rotated',
                    'ebay_exact_pre_gateway_retry_rearmed'
                  )
              and audit.entity_type = 'exact_existing_update_permit'
              and audit.entity_id = permit.permit_id::text
         )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
    uuid, text, text
  ) from public, anon, authenticated, service_role;

-- Admit the historical-permit proof to the existing availability fence while
-- still requiring the requested credential to be the sole current eBay row.
do $patch_ebay_rotated_retry_availability$
declare
  v_definition text;
  v_anchor constant text := $old$
      )
    ),
    false
  )$old$;
  v_replacement constant text := $new$
      ) or exists (
        select 1
          from sellerpilot_private.exact_existing_update_permits retry
         where retry.permit_id =
               '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
           and sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
                 p_credential_id,
                 retry.release_sha,
                 retry.request_fingerprint
               )
      )
    ),
    false
  )$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure
  ) into v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor) <> 1
  then
    raise exception 'eBay credential rotation availability patch target missing'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
end;
$patch_ebay_rotated_retry_availability$;

-- Open one transition that changes only the exact expired permit's credential
-- snapshot plus its five-minute timestamps. Every generic permit transition
-- continues to compare all credential fields unchanged.
do $patch_ebay_rotated_permit_transition$
declare
  v_definition text;
  v_fields_before constant text := $old$
    'invalidated_at', 'invalidation_reason', 'armed_at', 'expires_at'
  ];$old$;
  v_fields_after constant text := $new$
    'invalidated_at', 'invalidation_reason', 'armed_at', 'expires_at',
    'credential_id', 'credential_version', 'credential_fingerprint',
    'credential_account_source', 'credential_verified_at',
    'credential_expires_at', 'credential_last_checked_at',
    'credential_last_check_status'
  ];$new$;
  v_transition_anchor constant text := $old$
  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid$old$;
  v_transition constant text := $new$
  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id =
           '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
     and new.credential_id =
           '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid
     and old.release_sha = new.release_sha
     and old.request_fingerprint = new.request_fingerprint
     and old.request_fingerprint =
           'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
     and old.update_job_id is null and old.update_attempt_id is null
     and old.arguments_sha256 is null and old.arguments_bytes is null
     and old.request_payload_sha256 is null
     and old.request_payload_bytes is null
     and old.bound_at is null and old.bound_worker_token_id is null
     and old.bound_claim_token is null and old.consumed_at is null
     and old.invalidated_at is null and old.invalidation_reason is null
     and old.expires_at <= statement_timestamp()
     and new.armed_at = statement_timestamp()
     and new.expires_at = new.armed_at + interval '5 minutes'
     and sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
           new.credential_id, old.release_sha, old.request_fingerprint
         )
     and exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.id = new.credential_id
          and credential.channel = 'ebay'
          and credential.environment = 'production'
          and credential.status = 'active'
          and credential.version = 100
          and credential.seller_account_key = old.seller_account_key
          and credential.seller_account_key_source =
                'provider_certified_v1'
          and credential.seller_account_verified_at =
                new.credential_verified_at
          and credential.expires_at is not distinct from
                new.credential_expires_at
          and credential.last_checked_at is not distinct from
                new.credential_last_checked_at
          and credential.last_check_status is not distinct from
                new.credential_last_check_status
          and credential.version = new.credential_version
          and credential.fingerprint = new.credential_fingerprint
          and credential.seller_account_key_source =
                new.credential_account_source
          and sellerpilot_private.ebay_exact_current_credential_is_valid(
                credential.id, old.seller_account_key
              )
     )
     and to_jsonb(new) - array[
           'armed_at', 'expires_at', 'credential_id',
           'credential_version', 'credential_fingerprint',
           'credential_account_source', 'credential_verified_at',
           'credential_expires_at', 'credential_last_checked_at',
           'credential_last_check_status'
         ] is not distinct from
         to_jsonb(old) - array[
           'armed_at', 'expires_at', 'credential_id',
           'credential_version', 'credential_fingerprint',
           'credential_account_source', 'credential_verified_at',
           'credential_expires_at', 'credential_last_checked_at',
           'credential_last_check_status'
         ]
  then return new; end if;

  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_fields_before) = 0
     or pg_catalog.strpos(v_definition, v_transition_anchor) = 0
  then
    raise exception 'eBay credential rotation permit transition patch target missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_fields_before, v_fields_after
  );
  v_definition := pg_catalog.replace(
    v_definition, v_transition_anchor, v_transition
  );
  execute v_definition;
end;
$patch_ebay_rotated_permit_transition$;

-- Rotate and rearm only when the explicit arm RPC is called. The failed c9
-- attempt and the deterministic 25718 source rows remain historical evidence.
do $patch_ebay_retry_arm_credential_rotation$
declare
  v_definition text;
  v_anchor constant text := $old$
  if found then
    if v_permit.credential_id is distinct from p_credential_id$old$;
  v_replacement constant text := $new$
  if found then
    if v_permit.permit_id =
         '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and v_permit.credential_id =
         '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and p_credential_id =
         '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid
       and v_permit.release_sha = p_release_sha
       and v_permit.request_fingerprint = p_request_fingerprint
       and v_permit.expires_at <= statement_timestamp()
       and v_permit.update_job_id is null
       and v_permit.update_attempt_id is null
       and v_permit.arguments_sha256 is null
       and v_permit.arguments_bytes is null
       and v_permit.request_payload_sha256 is null
       and v_permit.request_payload_bytes is null
       and v_permit.bound_at is null
       and v_permit.bound_worker_token_id is null
       and v_permit.bound_claim_token is null
       and v_permit.consumed_at is null
       and v_permit.invalidated_at is null
       and v_permit.invalidation_reason is null
       and sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
             p_credential_id, p_release_sha, p_request_fingerprint
           )
    then
      update sellerpilot_private.exact_existing_update_permits permit
         set credential_id = p_credential_id,
             credential_version = v_version,
             credential_fingerprint = v_fingerprint,
             credential_account_source = v_account_source,
             credential_verified_at = v_verified_at,
             credential_expires_at = v_expires_at,
             credential_last_checked_at = v_last_checked_at,
             credential_last_check_status = v_last_check_status,
             armed_at = v_now,
             expires_at = v_now + interval '5 minutes'
       where permit.permit_id = v_permit.permit_id
         and permit.credential_id = v_permit.credential_id
         and permit.release_sha = p_release_sha
         and permit.request_fingerprint = p_request_fingerprint
         and permit.expires_at <= statement_timestamp()
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.bound_at is null
         and permit.consumed_at is null
         and permit.invalidated_at is null
      returning * into v_permit;
      if not found then
        raise exception 'eBay exact credential rotation lost race'
          using errcode = '55000';
      end if;

      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail, occurred_at
      ) values (
        v_owner_id,
        'ebay_exact_pre_gateway_credential_rotated',
        'exact_existing_update_permit',
        v_permit.permit_id::text,
        jsonb_build_object(
          'contract', 'ebay_exact_pre_gateway_credential_rotation_v1',
          'listingId', p_listing_id,
          'attemptId', 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid,
          'permitId', v_permit.permit_id,
          'historicalCredentialId',
            '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid,
          'currentCredentialId', p_credential_id,
          'currentCredentialVersion', v_version,
          'requestFingerprint', p_request_fingerprint,
          'releaseSha', p_release_sha,
          'assetRefCount', 13,
          'gatewayJobCount', 0,
          'providerMutationCount', 0,
          'autoRetry', false,
          'oldJobReused', false
        ),
        v_now
      );

      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail, occurred_at
      ) values (
        v_owner_id,
        'ebay_exact_pre_gateway_retry_rearmed',
        'exact_existing_update_permit',
        v_permit.permit_id::text,
        jsonb_build_object(
          'contract', 'ebay_exact_pre_gateway_retry_rearm_v1',
          'listingId', p_listing_id,
          'attemptId', 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid,
          'permitId', v_permit.permit_id,
          'requestFingerprint', p_request_fingerprint,
          'releaseSha', p_release_sha,
          'credentialId', p_credential_id,
          'assetRefCount', 13,
          'gatewayJobCount', 0,
          'providerMutationCount', 0,
          'autoRetry', false,
          'oldJobReused', false
        ),
        v_now
      );

      return jsonb_build_object(
        'contract', 'exact_existing_update_permit_v1',
        'permitId', v_permit.permit_id, 'channel', v_permit.channel,
        'listingId', v_permit.listing_id,
        'releaseSha', v_permit.release_sha,
        'requestFingerprint', v_permit.request_fingerprint,
        'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
        'bound', false, 'reused', true, 'rearmed', true,
        'credentialRotated', true
      );
    end if;

    if v_permit.credential_id is distinct from p_credential_id$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_anchor) = 0 then
    raise exception 'eBay credential rotation arm patch target missing'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
end;
$patch_ebay_retry_arm_credential_rotation$;

do $ebay_exact_credential_rotation_postimage$
declare
  v_failure_definition text;
  v_available_definition text;
  v_arm_definition text;
  v_transition_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(uuid,text,text)'::regprocedure
  ) into v_failure_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure
  ) into v_available_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into v_arm_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into v_transition_definition;

  if pg_catalog.strpos(v_failure_definition,
       '9e7de791-e6e6-4255-8d61-5a1f9576d797') = 0
     or pg_catalog.strpos(v_failure_definition,
          '75853087-d2a8-4f56-9c05-e66fcc65e372') = 0
     or pg_catalog.strpos(v_failure_definition,
          'historical_credential.version') = 0
     or pg_catalog.strpos(v_available_definition,
          'ebay_exact_pre_gateway_failure_is_proved') = 0
     or pg_catalog.strpos(v_arm_definition,
          'ebay_exact_pre_gateway_credential_rotated') = 0
     or pg_catalog.strpos(v_arm_definition,
          'credentialRotated') = 0
     or pg_catalog.strpos(v_transition_definition,
          '75853087-d2a8-4f56-9c05-e66fcc65e372') = 0
     or pg_catalog.has_function_privilege(
          'service_role',
          'sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        )
  then
    raise exception 'eBay exact credential rotation postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_exact_credential_rotation_postimage$;

notify pgrst, 'reload schema';

commit;
