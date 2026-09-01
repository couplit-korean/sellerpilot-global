-- Forward-only recovery for the one exact eBay retry permit that is still
-- unbound on historical credential v99 after the sole provider-certified
-- credential rotated from the now-revoked v100 row to v101. This migration
-- never creates a gateway job, calls eBay, or rotates an OAuth token. It only
-- lets the existing service-role arm RPC move that exact expired permit to
-- v101 and the runtime release supplied by the already-fenced request.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000003);

create function sellerpilot_private.ebay_exact_v101_rotation_is_proved(
  p_credential_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_credential_id =
      'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
    and sellerpilot_private.ebay_exact_current_credential_is_valid(
          p_credential_id,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        )
    and sellerpilot_private.exact_existing_update_release_is_current(
          'ebay', sellerpilot_private.active_serverless_runtime_release_sha()
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
         and product.on_hand = 1
         and product.on_hand = permit.stock
         and not product.demo
         and product.status <> 'archived'
         and attempt.operation = 'listing.update'
         and attempt.request_fingerprint =
               'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
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
         and historical_credential.environment = 'production'
         and historical_credential.status = 'revoked'
         and historical_credential.version = 99
         and historical_credential.fingerprint ~ '^[A-F0-9]{12}$'
         and historical_credential.seller_account_key_source =
               'provider_certified_v1'
         and historical_credential.seller_account_verified_at is not null
         and current_credential.id =
               'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
         and current_credential.environment = 'production'
         and current_credential.status = 'active'
         and current_credential.version = 101
         and current_credential.fingerprint = 'BEEF134012FD'
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
         and permit.credential_version = 99
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
         and permit.release_sha =
               'f51d5147f28949b2ef9d07d1d13ecb404259b260'
         and permit.request_fingerprint =
               'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
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
            where audit.action =
                    'ebay_exact_pre_gateway_v101_credential_rotated'
              and audit.entity_type = 'exact_existing_update_permit'
              and audit.entity_id = permit.permit_id::text
         )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid)
  from public, anon, authenticated, service_role;

do $patch_ebay_v101_retry_availability$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure;
  v_preimage_sha256 constant text :=
    'b5388d573e78fcfb4a752ca878ec005689c2cc14fcf2778e3dc464e8172dd40c';
  v_postimage_sha256 constant text :=
    '327202829188f619271744f99be91246d9be70fd382656b0a4892be4dc91b4bc';
  v_definition text;
  v_prosrc text;
  v_owner oid;
  v_post_owner oid;
  v_anchor constant text := $old$
      )
    ),
    false
  )$old$;
  v_replacement constant text := $new$
      ) or sellerpilot_private.ebay_exact_v101_rotation_is_proved(
        p_credential_id
      )
    ),
    false
  )$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       pg_catalog.encode(
         extensions.digest(v_prosrc, 'sha256'), 'hex'
       ) is distinct from v_preimage_sha256
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
     ) / pg_catalog.length(v_anchor) <> 1
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.ebay_exact_v101_rotation_is_proved('
        ) <> 0
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 's'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'sql'
     )
  )
  then
    raise exception 'eBay v101 retry availability preimage mismatch'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);

  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_postimage_sha256
     or v_post_owner is distinct from v_owner
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition,
           'sellerpilot_private.ebay_exact_v101_rotation_is_proved(',
           ''
         ))
     ) / pg_catalog.length(
       'sellerpilot_private.ebay_exact_v101_rotation_is_proved('
     ) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 's'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'sql'
     )
  then
    raise exception 'eBay v101 retry availability postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_v101_retry_availability$;

do $patch_ebay_v101_permit_transition$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_preimage_sha256 constant text :=
    'cd7cf419254b00848274a78eba3025821d9d98a1da7dc0b72a56aa5c9579536d';
  v_postimage_sha256 constant text :=
    '7ef1164cda06fda7cbda1df47fd5772bc5702fb9c26ae870bb98bfb94004d236';
  v_definition text;
  v_prosrc text;
  v_owner oid;
  v_post_owner oid;
  v_fields_before constant text := $old$
    'credential_last_check_status'
  ];$old$;
  v_fields_after constant text := $new$
    'credential_last_check_status', 'release_sha'
  ];$new$;
  v_transition_anchor constant text := $old$
  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id =
           '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
     and new.credential_id =
           '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid$old$;
  v_transition constant text := $new$
  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id =
           '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
     and new.credential_id =
           'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
     and old.release_sha =
           'f51d5147f28949b2ef9d07d1d13ecb404259b260'
     and sellerpilot_private.exact_existing_update_release_is_current(
           'ebay', new.release_sha
         )
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
     and sellerpilot_private.ebay_exact_v101_rotation_is_proved(
           new.credential_id
         )
     and exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.id = new.credential_id
          and credential.channel = 'ebay'
          and credential.environment = 'production'
          and credential.status = 'active'
          and credential.version = 101
          and credential.fingerprint = 'BEEF134012FD'
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
           'credential_last_check_status', 'release_sha'
         ] is not distinct from
         to_jsonb(old) - array[
           'armed_at', 'expires_at', 'credential_id',
           'credential_version', 'credential_fingerprint',
           'credential_account_source', 'credential_verified_at',
           'credential_expires_at', 'credential_last_checked_at',
           'credential_last_check_status', 'release_sha'
         ]
  then return new; end if;

  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id =
           '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
     and new.credential_id =
           '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_preimage_sha256
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_fields_before, ''
         ))
     ) / pg_catalog.length(v_fields_before) <> 1
     or pg_catalog.strpos(v_definition, v_fields_after) <> 0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_transition_anchor, ''
         ))
     ) / pg_catalog.length(v_transition_anchor) <> 1
     or pg_catalog.strpos(
          v_definition,
          'f78397ec-c387-48ec-b562-64e754d90ac5'
        ) <> 0
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'plpgsql'
     )
  then
    raise exception 'eBay v101 permit transition preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_fields_before, v_fields_after
  );
  v_definition := pg_catalog.replace(
    v_definition, v_transition_anchor, v_transition
  );
  execute v_definition;

  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_postimage_sha256
     or v_post_owner is distinct from v_owner
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_fields_after, ''
         ))
     ) / pg_catalog.length(v_fields_after) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition,
           'f78397ec-c387-48ec-b562-64e754d90ac5',
           ''
         ))
     ) / pg_catalog.length(
       'f78397ec-c387-48ec-b562-64e754d90ac5'
     ) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'plpgsql'
     )
  then
    raise exception 'eBay v101 permit transition postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_v101_permit_transition$;

do $patch_ebay_retry_arm_v101_rotation$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure;
  v_preimage_sha256 constant text :=
    '6d1e06f43ce762917cc936aea0bdbaf1acd157d22804f589e0b92241b771b833';
  v_postimage_sha256 constant text :=
    '24682b20f45912cb2864cb880ba98179110088ec3be6ece49d52442c73129542';
  v_definition text;
  v_prosrc text;
  v_owner oid;
  v_post_owner oid;
  v_anchor constant text := $old$
  if found then
    if v_permit.permit_id =
         '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and v_permit.credential_id =
         '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and p_credential_id =
         '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid$old$;
  v_replacement constant text := $new$
  if found then
    if v_permit.permit_id =
         '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and v_permit.credential_id =
         '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and v_permit.release_sha =
         'f51d5147f28949b2ef9d07d1d13ecb404259b260'
       and v_permit.request_fingerprint =
         'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
       and p_credential_id =
         'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
       and p_request_fingerprint = v_permit.request_fingerprint
       and sellerpilot_private.exact_existing_update_release_is_current(
             'ebay', p_release_sha
           )
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
       and sellerpilot_private.ebay_exact_v101_rotation_is_proved(
             p_credential_id
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
             release_sha = p_release_sha,
             armed_at = v_now,
             expires_at = v_now + interval '5 minutes'
       where permit.permit_id = v_permit.permit_id
         and permit.credential_id = v_permit.credential_id
         and permit.release_sha = v_permit.release_sha
         and permit.request_fingerprint = p_request_fingerprint
         and permit.expires_at <= statement_timestamp()
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.bound_at is null
         and permit.consumed_at is null
         and permit.invalidated_at is null
      returning * into v_permit;
      if not found then
        raise exception 'eBay exact v101 credential rotation lost race'
          using errcode = '55000';
      end if;

      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail, occurred_at
      ) values (
        v_owner_id,
        'ebay_exact_pre_gateway_v101_credential_rotated',
        'exact_existing_update_permit',
        v_permit.permit_id::text,
        jsonb_build_object(
          'contract', 'ebay_exact_pre_gateway_credential_rotation_v2',
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

    if v_permit.permit_id =
         '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and v_permit.credential_id =
         '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and p_credential_id =
         '75853087-d2a8-4f56-9c05-e66fcc65e372'::uuid$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_preimage_sha256
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
     ) / pg_catalog.length(v_anchor) <> 1
     or pg_catalog.strpos(
          v_definition,
          'ebay_exact_pre_gateway_v101_credential_rotated'
        ) <> 0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition,
           'v_now timestamptz := statement_timestamp()',
           ''
         ))
     ) / pg_catalog.length(
       'v_now timestamptz := statement_timestamp()'
     ) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'plpgsql'
     )
  then
    raise exception 'eBay v101 credential rotation arm preimage mismatch'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);

  select pg_catalog.pg_get_functiondef(procedure.oid),
         procedure.prosrc,
         procedure.proowner
    into strict v_definition, v_prosrc, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.encode(
       extensions.digest(v_prosrc, 'sha256'), 'hex'
     ) is distinct from v_postimage_sha256
     or v_post_owner is distinct from v_owner
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition,
           'ebay_exact_pre_gateway_v101_credential_rotated',
           ''
         ))
     ) / pg_catalog.length(
       'ebay_exact_pre_gateway_v101_credential_rotated'
     ) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition,
           'v_now timestamptz := statement_timestamp()',
           ''
         ))
     ) / pg_catalog.length(
       'v_now timestamptz := statement_timestamp()'
     ) <> 1
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and procedure.prosecdef
          and procedure.provolatile = 'v'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'plpgsql'
     )
  then
    raise exception 'eBay v101 credential rotation arm postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_retry_arm_v101_rotation$;

-- Reassert every touched privileged function's ACL after CREATE OR REPLACE.
-- Private helpers and the trigger remain unreachable to API roles; only the
-- service role may invoke the public arm RPC.
revoke all on function
  sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid),
  sellerpilot_private.ebay_exact_no_effect_retry_available(uuid),
  sellerpilot_private.guard_exact_existing_update_permit_transition(),
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) to service_role;

do $ebay_exact_v101_rotation_postimage$
declare
  v_proof_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid)'::regprocedure;
  v_available_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure;
  v_transition_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_arm_signature constant regprocedure :=
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure;
  v_proof_sha256 constant text :=
    '0261afc163ecfa7025b5722836b87acf5c6f65058de9d2c4d34f06d43b3a0771';
  v_available_sha256 constant text :=
    '327202829188f619271744f99be91246d9be70fd382656b0a4892be4dc91b4bc';
  v_transition_sha256 constant text :=
    '7ef1164cda06fda7cbda1df47fd5772bc5702fb9c26ae870bb98bfb94004d236';
  v_arm_sha256 constant text :=
    '24682b20f45912cb2864cb880ba98179110088ec3be6ece49d52442c73129542';
  v_proof_definition text;
  v_available_definition text;
  v_arm_definition text;
  v_transition_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_rotation_is_proved(uuid)'::regprocedure
  ) into v_proof_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_no_effect_retry_available(uuid)'::regprocedure
  ) into v_available_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into v_arm_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into v_transition_definition;

  if (
       select pg_catalog.encode(
                extensions.digest(procedure.prosrc, 'sha256'), 'hex'
              ) is distinct from v_proof_sha256
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_proof_signature
     )
     or (
       select pg_catalog.encode(
                extensions.digest(procedure.prosrc, 'sha256'), 'hex'
              ) is distinct from v_available_sha256
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_available_signature
     )
     or (
       select pg_catalog.encode(
                extensions.digest(procedure.prosrc, 'sha256'), 'hex'
              ) is distinct from v_transition_sha256
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_transition_signature
     )
     or (
       select pg_catalog.encode(
                extensions.digest(procedure.prosrc, 'sha256'), 'hex'
              ) is distinct from v_arm_sha256
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_arm_signature
     )
     or pg_catalog.strpos(v_proof_definition,
       'f78397ec-c387-48ec-b562-64e754d90ac5') = 0
     or pg_catalog.strpos(v_proof_definition,
          'BEEF134012FD') = 0
     or pg_catalog.strpos(v_available_definition,
          'ebay_exact_v101_rotation_is_proved') = 0
     or pg_catalog.strpos(v_arm_definition,
          'ebay_exact_pre_gateway_v101_credential_rotated') = 0
     or pg_catalog.strpos(v_arm_definition,
          'release_sha = p_release_sha') = 0
     or pg_catalog.strpos(v_transition_definition,
          'f78397ec-c387-48ec-b562-64e754d90ac5') = 0
     or pg_catalog.strpos(v_transition_definition,
          '''release_sha''') = 0
     or (
       pg_catalog.length(v_arm_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_arm_definition,
           'v_now timestamptz := statement_timestamp()',
           ''
         ))
     ) / pg_catalog.length(
       'v_now timestamptz := statement_timestamp()'
     ) <> 1
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_proof_signature
          and not (
            procedure.prosecdef
            and procedure.provolatile = 's'
            and procedure.prokind = 'f'
            and procedure.proconfig = array['search_path=""']::text[]
            and language.lanname = 'sql'
          )
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_available_signature
          and not (
            procedure.prosecdef
            and procedure.provolatile = 's'
            and procedure.prokind = 'f'
            and procedure.proconfig = array['search_path=""']::text[]
            and language.lanname = 'sql'
          )
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_transition_signature
          and not (
            procedure.prosecdef
            and procedure.provolatile = 'v'
            and procedure.prokind = 'f'
            and procedure.proconfig = array['search_path=""']::text[]
            and language.lanname = 'plpgsql'
          )
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_arm_signature
          and not (
            procedure.prosecdef
            and procedure.provolatile = 'v'
            and procedure.prokind = 'f'
            and procedure.proconfig = array['search_path=""']::text[]
            and language.lanname = 'plpgsql'
          )
     )
     or exists (
       select 1
         from (values
           (v_proof_signature),
           (v_available_signature),
           (v_transition_signature)
         ) private_function(signature)
        cross join (values
          ('service_role'::name),
          ('authenticated'::name),
          ('anon'::name)
        ) api_role(role_name)
        where pg_catalog.has_function_privilege(
          api_role.role_name, private_function.signature, 'EXECUTE'
        )
     )
     or pg_catalog.has_function_privilege(
          'authenticated', v_arm_signature, 'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon', v_arm_signature, 'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role', v_arm_signature, 'EXECUTE'
        )
  then
    raise exception 'eBay exact v101 credential rotation postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_exact_v101_rotation_postimage$;

notify pgrst, 'reload schema';

commit;
