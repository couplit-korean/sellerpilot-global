-- Forward-only replacement of the exact eBay content-retry credential fence.
-- The request remains bound to listing 800551945442 / offer 244042196011,
-- while the credential is resolved from the sole current provider-certified
-- production row for the already-attested seller account. The currently
-- observed row is v103 bb42910f-68ce-4662-8867-28fad2c7a858, but no credential
-- UUID, version, or fingerprint is embedded in the runtime contract.
--
-- This migration never arms a permit, enqueues a job, or calls eBay.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000005);

do $ebay_exact_current_credential_preimage$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_exact_existing_update_permit_transition()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'
     ) is null
  then
    raise exception 'eBay current-credential content retry preimage missing'
      using errcode = '55000';
  end if;
end;
$ebay_exact_current_credential_preimage$;

create or replace function
  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
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
    p_request_fingerprint =
      'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
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
          on attempt.id = 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid
         and attempt.owner_id = listing.owner_id
         and attempt.channel = listing.channel_key
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
         and permit.listing_id = listing.id
         and permit.product_id = listing.product_id
         and permit.owner_id = listing.owner_id
        join sellerpilot_private.channel_gateway_jobs source_job
          on source_job.id = permit.retry_source_job_id
        join sellerpilot_private.channel_operation_attempts source_attempt
          on source_attempt.id = permit.retry_source_attempt_id
        join sellerpilot_private.exact_existing_update_permits source_permit
          on source_permit.permit_id = permit.retry_source_permit_id
        join sellerpilot_private.channel_credentials current_credential
          on current_credential.id = p_credential_id
         and current_credential.channel = listing.channel_key
         and current_credential.environment = 'production'
         and current_credential.status = 'active'
         and current_credential.seller_account_key =
               listing.seller_account_key
       where listing.id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
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
         and attempt.seller_account_key = listing.seller_account_key
         and current_credential.version > 0
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
         and source_job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and source_job.attempt_id = source_attempt.id
         and source_job.listing_id = listing.id
         and source_job.credential_id = source_attempt.credential_id
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
         and source_attempt.status = 'failed'
         and source_attempt.http_status = 400
         and source_attempt.remote_id = '800551945442'
         and source_attempt.gateway_write_required
         and not source_attempt.pre_gateway_retryable
         and source_permit.update_job_id = source_job.id
         and source_permit.update_attempt_id = source_attempt.id
         and source_permit.credential_id = source_attempt.credential_id
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
              and asset.status = 'available'
              and asset.uploaded_at is not null
            having count(*) = 13
               and count(distinct ref.object_path) = 13
               and count(distinct ref.canonical_public_url) = 13
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
              and ref.object_path =
                    'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
              and ref.canonical_public_url ~
                    '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a[.]jpg$'
              and ref.upload_confirmed_at is not null
              and asset.status = 'available'
              and asset.uploaded_at is not null
         )
         and not exists (
           select 1
             from sellerpilot_private.operation_audit audit
            where audit.action =
                    'ebay_exact_current_content_contract_rearmed'
              and audit.entity_type = 'exact_existing_update_permit'
              and audit.entity_id = permit.permit_id::text
         )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
    uuid, text, text
  ) from public, anon, authenticated, service_role;

do $patch_ebay_current_content_permit_transition$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_content_start integer;
  v_content_end integer;
  v_rotation_start integer;
  v_rotation_end integer;
  v_tail text;
  v_end_marker constant text := E'  then return new; end if;\n\n';
  v_prior_content_start constant text := $old$  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.request_fingerprint =
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'$old$;
  v_prior_rotation_start constant text := $old$  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id =
           '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
     and new.credential_id =
           'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
     and old.release_sha =
           'f51d5147f28949b2ef9d07d1d13ecb404259b260'$old$;
  v_transition constant text := $new$  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.request_fingerprint =
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
     and new.request_fingerprint = old.request_fingerprint
     and new.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and sellerpilot_private.exact_existing_update_release_is_current(
           'ebay', new.release_sha
         )
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
     and sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
           new.credential_id, new.release_sha, new.request_fingerprint
         )
     and exists (
       select 1
         from sellerpilot_private.channel_credentials credential
        where credential.id = new.credential_id
          and credential.channel = 'ebay'
          and credential.environment = 'production'
          and credential.status = 'active'
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

$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if pg_catalog.strpos(
       v_definition, 'ebay_exact_current_content_contract_rearmed'
     ) <> 0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_prior_content_start, ''
         ))
     ) / pg_catalog.length(v_prior_content_start) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_prior_rotation_start, ''
         ))
     ) / pg_catalog.length(v_prior_rotation_start) <> 1
  then
    raise exception 'eBay current credential permit transition preimage mismatch'
      using errcode = '55000';
  end if;

  -- Replace the deployed v101 content branch rather than prepending a second
  -- path. Keeping both would let a future accidental v101 reactivation bypass
  -- the current-credential helper.
  v_content_start := pg_catalog.strpos(
    v_definition, v_prior_content_start
  );
  v_tail := pg_catalog.substr(v_definition, v_content_start);
  v_content_end := pg_catalog.strpos(v_tail, v_end_marker);
  if v_content_start = 0 or v_content_end = 0 then
    raise exception 'eBay v101 content transition boundary missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.substr(v_definition, 1, v_content_start - 1)
    || v_transition
    || pg_catalog.substr(
         v_tail, v_content_end + pg_catalog.length(v_end_marker)
       );

  -- The older base-fingerprint v101 rotation branch is obsolete after the
  -- content-fingerprint rebind. Remove it so the final trigger contains no
  -- path that recognizes the revoked credential incarnation.
  v_rotation_start := pg_catalog.strpos(
    v_definition, v_prior_rotation_start
  );
  v_tail := pg_catalog.substr(v_definition, v_rotation_start);
  v_rotation_end := pg_catalog.strpos(v_tail, v_end_marker);
  if v_rotation_start = 0 or v_rotation_end = 0 then
    raise exception 'eBay v101 rotation transition boundary missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.substr(v_definition, 1, v_rotation_start - 1)
    || pg_catalog.substr(
         v_tail, v_rotation_end + pg_catalog.length(v_end_marker)
       );
  execute v_definition;

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_current_credential_is_valid'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'f78397ec-c387-48ec-b562-64e754d90ac5'
        ) <> 0
     or pg_catalog.strpos(v_definition, 'BEEF134012FD') <> 0
     or pg_catalog.strpos(
          v_definition, 'credential.version = 101'
        ) <> 0
  then
    raise exception 'eBay current credential permit transition postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_ebay_current_content_permit_transition$;

create or replace function public.sellerpilot_service_arm_ebay_no_effect_retry(
  p_channel text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_version integer;
  v_fingerprint text;
  v_account_source text;
  v_verified_at timestamptz;
  v_credential_expires_at timestamptz;
  v_last_checked_at timestamptz;
  v_last_check_status text;
  v_now timestamptz := statement_timestamp();
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
  then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917000005);

  if p_channel is distinct from 'ebay'
     or p_listing_id is distinct from
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint is distinct from
          'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
     or not sellerpilot_private.exact_existing_update_release_is_current(
          'ebay', p_release_sha
        )
     or not sellerpilot_private.ebay_exact_current_credential_is_valid(
          p_credential_id,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        )
  then
    raise exception 'eBay current content retry identity invalid'
      using errcode = '55000';
  end if;

  select listing.owner_id, credential.version, credential.fingerprint,
         credential.seller_account_key_source,
         credential.seller_account_verified_at, credential.expires_at,
         credential.last_checked_at, credential.last_check_status
    into v_owner_id, v_version, v_fingerprint, v_account_source,
         v_verified_at, v_credential_expires_at,
         v_last_checked_at, v_last_check_status
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
   where listing.id = p_listing_id
     and listing.channel_key = 'ebay'
     and listing.remote_id = '800551945442'
     and listing.market = 'US'
     and listing.target_id = 'EBAY_US'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.currency = 'USD'
     and listing.price = 12.90
     and listing.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version > 0
     and credential.fingerprint ~ '^[A-F0-9]{12}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.expires_at > statement_timestamp()
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
   for share of listing, credential;
  if not found then
    raise exception 'eBay current content retry credential invalid'
      using errcode = '55000';
  end if;

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and permit.channel = 'ebay'
     and permit.listing_id = p_listing_id
     and permit.remote_id = '800551945442'
     and permit.provider_resource_id = '244042196011'
     and permit.request_fingerprint = p_request_fingerprint
   for update;
  if not found
     or v_permit.update_job_id is not null
     or v_permit.update_attempt_id is not null
     or v_permit.bound_at is not null
     or v_permit.bound_worker_token_id is not null
     or v_permit.bound_claim_token is not null
     or v_permit.consumed_at is not null
     or v_permit.invalidated_at is not null
     or v_permit.invalidation_reason is not null
  then
    raise exception 'eBay current content retry permit unavailable'
      using errcode = '55000';
  end if;

  if v_permit.expires_at > statement_timestamp() then
    if v_permit.credential_id is distinct from p_credential_id
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.credential_version is distinct from v_version
       or v_permit.credential_fingerprint is distinct from v_fingerprint
       or not sellerpilot_private.ebay_exact_current_credential_is_valid(
            v_permit.credential_id, v_permit.seller_account_key
          )
       or not exists (
         select 1
           from sellerpilot_private.operation_audit audit
          where audit.action =
                  'ebay_exact_current_content_contract_rearmed'
            and audit.entity_type = 'exact_existing_update_permit'
            and audit.entity_id = v_permit.permit_id::text
       )
    then
      raise exception 'eBay current content retry permit identity mismatch'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', 'exact_existing_update_permit_v1',
      'permitId', v_permit.permit_id, 'channel', v_permit.channel,
      'listingId', v_permit.listing_id,
      'releaseSha', v_permit.release_sha,
      'requestFingerprint', v_permit.request_fingerprint,
      'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
      'bound', false, 'reused', true, 'rearmed', false,
      'credentialRotated', false, 'contentContractRebound', true
    );
  end if;

  if not sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
           p_credential_id, p_release_sha, p_request_fingerprint
         )
  then
    raise exception 'eBay current content retry proof invalid'
      using errcode = '55000';
  end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set credential_id = p_credential_id,
         credential_version = v_version,
         credential_fingerprint = v_fingerprint,
         credential_account_source = v_account_source,
         credential_verified_at = v_verified_at,
         credential_expires_at = v_credential_expires_at,
         credential_last_checked_at = v_last_checked_at,
         credential_last_check_status = v_last_check_status,
         release_sha = p_release_sha,
         armed_at = v_now,
         expires_at = v_now + interval '5 minutes'
   where permit.permit_id = v_permit.permit_id
     and permit.channel = 'ebay'
     and permit.listing_id = p_listing_id
     and permit.remote_id = '800551945442'
     and permit.provider_resource_id = '244042196011'
     and permit.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and permit.request_fingerprint = p_request_fingerprint
     and permit.expires_at <= statement_timestamp()
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
  returning * into v_permit;
  if not found then
    raise exception 'eBay current content retry rearm lost race'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    v_owner_id,
    'ebay_exact_current_content_contract_rearmed',
    'exact_existing_update_permit',
    v_permit.permit_id::text,
    jsonb_build_object(
      'contract', 'ebay_exact_v101_content_contract_v1',
      'listingId', p_listing_id,
      'publicListingId', '800551945442',
      'offerId', '244042196011',
      'permitId', v_permit.permit_id,
      'credentialId', p_credential_id,
      'credentialVersion', v_version,
      'credentialFingerprint', v_fingerprint,
      'sellerAccountKey', v_permit.seller_account_key,
      'requestFingerprint', p_request_fingerprint,
      'releaseSha', p_release_sha,
      'material', 'ABS Plastic',
      'inventoryImageCount', 9,
      'detailImageCount', 8,
      'gatewayJobCount', 0,
      'providerMutationCount', 0,
      'autoRetry', false
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
    'credentialRotated', true, 'contentContractRebound', true
  );
end;
$$;

revoke all on function
  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
    uuid, text, text
  ),
  sellerpilot_private.guard_exact_existing_update_permit_transition(),
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) to service_role;

do $ebay_exact_current_credential_postimage$
declare
  v_proof text;
  v_guard text;
  v_arm text;
  v_lineage text;
  v_lineage_before_lazada text;
  v_lineage_before_temu text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure
  ) into strict v_proof;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into strict v_guard;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into strict v_arm;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure
  ) into strict v_lineage;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_lineage_before_lazada_173980(uuid)'::regprocedure
  ) into strict v_lineage_before_lazada;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_lineage_before_temu_173960(uuid)'::regprocedure
  ) into strict v_lineage_before_temu;

  if pg_catalog.strpos(v_proof, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_proof, '800551945442') = 0
     or pg_catalog.strpos(v_proof, '244042196011') = 0
     or pg_catalog.strpos(v_guard, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_arm, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(
          v_arm, 'ebay_exact_current_content_contract_rearmed'
        ) = 0
     or pg_catalog.strpos(
          v_lineage, 'exact_existing_update_lineage_before_lazada_173980'
        ) = 0
     or pg_catalog.strpos(
          v_lineage_before_lazada,
          'exact_existing_update_lineage_before_temu_173960'
        ) = 0
     or pg_catalog.strpos(
          v_lineage_before_temu, 'ebay_exact_current_credential_is_valid'
        ) = 0
     or pg_catalog.strpos(v_proof, 'f78397ec-c387-48ec-b562-64e754d90ac5') <> 0
     or pg_catalog.strpos(v_proof, 'BEEF134012FD') <> 0
     or pg_catalog.strpos(v_arm, 'f78397ec-c387-48ec-b562-64e754d90ac5') <> 0
     or pg_catalog.strpos(v_arm, 'BEEF134012FD') <> 0
  then
    raise exception 'eBay current credential content retry postimage invalid'
      using errcode = '55000', detail = jsonb_build_object(
        'proofCurrent', pg_catalog.strpos(
          v_proof, 'ebay_exact_current_credential_is_valid'
        ),
        'proofListing', pg_catalog.strpos(v_proof, '800551945442'),
        'proofOffer', pg_catalog.strpos(v_proof, '244042196011'),
        'guardCurrent', pg_catalog.strpos(
          v_guard, 'ebay_exact_current_credential_is_valid'
        ),
        'armCurrent', pg_catalog.strpos(
          v_arm, 'ebay_exact_current_credential_is_valid'
        ),
        'armAudit', pg_catalog.strpos(
          v_arm, 'ebay_exact_current_content_contract_rearmed'
        ),
        'lineageTopFallback', pg_catalog.strpos(
          v_lineage, 'exact_existing_update_lineage_before_lazada_173980'
        ),
        'lineageLazadaFallback', pg_catalog.strpos(
          v_lineage_before_lazada,
          'exact_existing_update_lineage_before_temu_173960'
        ),
        'lineageEbayCurrent', pg_catalog.strpos(
          v_lineage_before_temu, 'ebay_exact_current_credential_is_valid'
        ),
        'proofOldUuid', pg_catalog.strpos(
          v_proof, 'f78397ec-c387-48ec-b562-64e754d90ac5'
        ),
        'proofOldFingerprint', pg_catalog.strpos(v_proof, 'BEEF134012FD'),
        'armOldUuid', pg_catalog.strpos(
          v_arm, 'f78397ec-c387-48ec-b562-64e754d90ac5'
        ),
        'armOldFingerprint', pg_catalog.strpos(v_arm, 'BEEF134012FD')
      )::text;
  end if;
end;
$ebay_exact_current_credential_postimage$;

comment on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) is
  'Arms only the exact eBay item 800551945442 / offer 244042196011 content retry on the sole current provider-certified credential for the verified seller lineage; it never calls the provider.';

commit;
