-- Recover one exact eBay listing.update whose second UI attempt failed before
-- a durable gateway job existed. The existing retry permit was never bound or
-- consumed; its 13 normalized image references were uploaded and URL-bound.
-- Rearming is limited to that permit, attempt, fingerprint, release and the
-- current provider-certified credential. No provider job is retried here.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000001);

create function
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
    p_request_fingerprint =
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
         and attempt.credential_id = p_credential_id
         and attempt.channel = listing.channel_key
        join sellerpilot_private.channel_credentials credential
          on credential.id = p_credential_id
         and credential.channel = listing.channel_key
         and credential.seller_account_key = listing.seller_account_key
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.permit_id =
               '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
         and permit.listing_id = listing.id
         and permit.product_id = listing.product_id
         and permit.owner_id = listing.owner_id
         and permit.credential_id = credential.id
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
         and permit.channel = 'ebay'
         and permit.market = 'US'
         and permit.target_id = 'EBAY_US'
         and permit.remote_id = '800551945442'
         and permit.seller_sku = 'QA-20260823-CC-001-US'
         and permit.provider_resource_id = '244042196011'
         and permit.currency = 'USD'
         and permit.price = 12.90
         and permit.seller_account_key = listing.seller_account_key
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
         and source_attempt.status = 'failed'
         and source_attempt.http_status = 400
         and source_attempt.remote_id = '800551945442'
         and source_attempt.gateway_write_required
         and not source_attempt.pre_gateway_retryable
         and source_permit.update_job_id = source_job.id
         and source_permit.update_attempt_id = source_attempt.id
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
            where audit.action = 'ebay_exact_pre_gateway_retry_rearmed'
              and audit.entity_type = 'exact_existing_update_permit'
              and audit.entity_id = permit.permit_id::text
         )
    ),
    false
  )
$$;

create function
  sellerpilot_private.ebay_exact_pre_gateway_rearm_is_proved(
    p_permit_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.operation_audit audit
        on audit.action = 'ebay_exact_pre_gateway_retry_rearmed'
       and audit.entity_type = 'exact_existing_update_permit'
       and audit.entity_id = permit.permit_id::text
       and audit.occurred_at = permit.armed_at
     where permit.permit_id = p_permit_id
       and permit.permit_id =
             '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and permit.channel = 'ebay'
       and permit.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and permit.credential_id =
             (audit.safe_detail->>'credentialId')::uuid
       and permit.release_sha = audit.safe_detail->>'releaseSha'
       and permit.request_fingerprint =
             'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
       and audit.safe_detail->>'contract' =
             'ebay_exact_pre_gateway_retry_rearm_v1'
       and audit.safe_detail->>'listingId' = permit.listing_id::text
       and audit.safe_detail->>'attemptId' =
             'c9d5b739-4ae7-4596-acbc-06f900a21ba3'
       and audit.safe_detail->>'permitId' = permit.permit_id::text
       and audit.safe_detail->>'requestFingerprint' =
             permit.request_fingerprint
       and audit.safe_detail->>'releaseSha' = permit.release_sha
       and audit.safe_detail->>'assetRefCount' = '13'
       and audit.safe_detail->>'gatewayJobCount' = '0'
       and audit.safe_detail->>'providerMutationCount' = '0'
       and audit.safe_detail->>'autoRetry' = 'false'
       and audit.safe_detail->>'oldJobReused' = 'false'
       and (
         select count(*)
           from pg_catalog.jsonb_object_keys(audit.safe_detail)
       ) = 12
  ), false)
$$;

revoke all on function
  sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
    uuid, text, text
  ),
  sellerpilot_private.ebay_exact_pre_gateway_rearm_is_proved(uuid)
  from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.ebay_exact_no_effect_retry_available(
    p_credential_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.ebay_exact_current_credential_is_valid(
      p_credential_id,
      'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
    )
    and not exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs active_job
       where active_job.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
         and active_job.operation in (
           'listing.create', 'listing.update', 'listing.stop'
         )
         and active_job.status in (
           'queued', 'running', 'reconciliation_required'
         )
    )
    and (
      (
        sellerpilot_private.ebay_exact_no_effect_source_is_proved()
        and (
          not exists (
            select 1
              from sellerpilot_private.exact_existing_update_permits retry
             where retry.retry_source_job_id =
                   '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
          ) or exists (
            select 1
              from sellerpilot_private.exact_existing_update_permits retry
             where retry.retry_source_job_id =
                   '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
               and retry.credential_id = p_credential_id
               and retry.invalidated_at is null
               and retry.update_job_id is null
               and retry.update_attempt_id is null
               and retry.bound_at is null
               and retry.consumed_at is null
               and retry.expires_at > statement_timestamp()
               and sellerpilot_private.exact_existing_update_release_is_current(
                     'ebay', retry.release_sha
                   )
          )
        )
      ) or exists (
        select 1
          from sellerpilot_private.exact_existing_update_permits retry
         where retry.permit_id =
               '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
           and retry.credential_id = p_credential_id
           and retry.retry_source_job_id =
                 '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
           and retry.request_fingerprint =
                 'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
           and retry.invalidated_at is null
           and retry.update_job_id is null
           and retry.update_attempt_id is null
           and retry.bound_at is null
           and retry.consumed_at is null
           and sellerpilot_private.exact_existing_update_release_is_current(
                 'ebay', retry.release_sha
               )
           and (
             sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
               retry.credential_id,
               retry.release_sha,
               retry.request_fingerprint
             ) or (
               retry.expires_at > statement_timestamp()
               and sellerpilot_private.ebay_exact_pre_gateway_rearm_is_proved(
                     retry.permit_id
                   )
             )
           )
      )
    ),
    false
  )
$$;

create or replace function
  sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(
    p_permit_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
        from sellerpilot_private.exact_existing_update_permits permit
       where permit.permit_id = p_permit_id
         and permit.channel = 'ebay'
         and permit.listing_id =
               '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
         and permit.retry_source_job_id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and permit.retry_source_attempt_id =
               '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
         and permit.retry_source_permit_id =
               'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
         and permit.retry_source_response_sha256 = encode(
               extensions.digest((
                 select source_job.response_payload::text
                   from sellerpilot_private.channel_gateway_jobs source_job
                  where source_job.id = permit.retry_source_job_id
               ), 'sha256'), 'hex'
             )
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
         and (
           sellerpilot_private.ebay_exact_no_effect_source_is_proved()
           or sellerpilot_private.ebay_exact_pre_gateway_rearm_is_proved(
                permit.permit_id
              )
         )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_no_effect_retry_available(uuid),
  sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(uuid)
  from public, anon, authenticated, service_role;

-- Permit only one exact expired/unbound permit transition back into its
-- five-minute arm window. All generic permit transitions remain unchanged.
do $patch_ebay_pre_gateway_permit_transition$
declare
  v_definition text;
  v_fields_before text := $old$
    'invalidated_at', 'invalidation_reason'
  ];$old$;
  v_fields_after text := $new$
    'invalidated_at', 'invalidation_reason', 'armed_at', 'expires_at'
  ];$new$;
  v_transition_anchor text := $old$
  if old.update_job_id is null
     and old.update_attempt_id is null
     and old.arguments_sha256 is null$old$;
  v_transition text := $new$
  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id = new.credential_id
     and old.release_sha = new.release_sha
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
           old.credential_id, old.release_sha, old.request_fingerprint
         )
     and to_jsonb(new) - array['armed_at', 'expires_at']
           is not distinct from
         to_jsonb(old) - array['armed_at', 'expires_at']
  then return new; end if;

  if old.update_job_id is null
     and old.update_attempt_id is null
     and old.arguments_sha256 is null$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_fields_before) = 0
     or pg_catalog.strpos(v_definition, v_transition_anchor) = 0
  then
    raise exception 'eBay pre-gateway permit transition patch target missing'
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
$patch_ebay_pre_gateway_permit_transition$;

-- The exact identity continues to preserve the immutable 07b lineage marker,
-- but the listing ledger may now point at the proved c9 pre-gateway attempt.
do $patch_ebay_pre_gateway_identity_and_enqueue_lineage$
declare
  v_definition text;
  v_old_attempt constant text :=
    '''22457f2e-51d8-43c5-bb03-d2c1bb7fe697''::uuid';
  v_attempts constant text :=
    'any (array['
    || '''22457f2e-51d8-43c5-bb03-d2c1bb7fe697''::uuid,'
    || '''c9d5b739-4ae7-4596-acbc-06f900a21ba3''::uuid])';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_attempt, ''))
  ) / pg_catalog.length(v_old_attempt) <> 1 then
    raise exception 'eBay pre-gateway identity patch target missing'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old_attempt, v_attempts);

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_attempt, ''))
  ) / pg_catalog.length(v_old_attempt) <> 1 then
    raise exception 'eBay pre-gateway enqueue lineage patch target missing'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old_attempt, v_attempts);
end;
$patch_ebay_pre_gateway_identity_and_enqueue_lineage$;

-- PostgreSQL has jsonb_array_length but no jsonb_object_length. The previous
-- wrapper compiled because PL/pgSQL resolved the call only at execution time.
do $patch_ebay_retry_marker_key_count$
declare
  v_definition text;
  v_before constant text := 'jsonb_object_length(v_retry) <> 7';
  v_after constant text :=
    '(select count(*) from pg_catalog.jsonb_object_keys(v_retry)) <> 7';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'eBay retry marker key-count patch target missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);
  if pg_catalog.strpos(v_definition, 'jsonb_object_length') > 0 then
    raise exception 'eBay retry marker key-count patch incomplete'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$patch_ebay_retry_marker_key_count$;

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
  v_stock integer;
  v_version integer;
  v_fingerprint text;
  v_account_source text;
  v_verified_at timestamptz;
  v_expires_at timestamptz;
  v_last_checked_at timestamptz;
  v_last_check_status text;
  v_source_response_sha256 text;
  v_now timestamptz := statement_timestamp();
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
  then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917000001);

  if p_channel is distinct from 'ebay'
     or p_listing_id is distinct from
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint =
          '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
     or not sellerpilot_private.exact_existing_update_release_is_current(
          'ebay', p_release_sha
        )
     or not sellerpilot_private.ebay_exact_no_effect_retry_available(
          p_credential_id
        )
  then
    raise exception 'eBay deterministic no-effect retry identity invalid'
      using errcode = '55000';
  end if;

  select listing.owner_id, product.on_hand,
         credential.version, credential.fingerprint,
         credential.seller_account_key_source,
         credential.seller_account_verified_at, credential.expires_at,
         credential.last_checked_at, credential.last_check_status
    into v_owner_id, v_stock, v_version, v_fingerprint,
         v_account_source, v_verified_at, v_expires_at,
         v_last_checked_at, v_last_check_status
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
   where listing.id = p_listing_id
     and listing.owner_id =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and listing.product_id =
           'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.operation_attempt_id in (
           '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid,
           'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid
         )
     and listing.remote_id = '800551945442'
     and listing.market = 'US' and listing.target_id = 'EBAY_US'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.currency = 'USD' and listing.price = 12.90
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null and listing.published_at is null
     and listing.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand between 1 and 999999
     and not product.demo and product.status <> 'archived'
     and sellerpilot_private.ebay_exact_current_credential_is_valid(
           credential.id, listing.seller_account_key
         )
   for share of listing, product, credential;
  if not found then
    raise exception 'eBay deterministic no-effect retry identity invalid'
      using errcode = '55000';
  end if;

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.retry_source_job_id =
         '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
   for update;
  if found then
    if v_permit.credential_id is distinct from p_credential_id
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.update_job_id is not null
       or v_permit.update_attempt_id is not null
       or v_permit.bound_at is not null
       or v_permit.bound_worker_token_id is not null
       or v_permit.bound_claim_token is not null
       or v_permit.consumed_at is not null
       or v_permit.invalidated_at is not null
       or v_permit.invalidation_reason is not null
    then
      raise exception 'eBay deterministic no-effect retry already consumed'
        using errcode = '55000';
    end if;

    if v_permit.expires_at <= statement_timestamp() then
      if v_permit.permit_id is distinct from
           '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
         or not sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(
           p_credential_id, p_release_sha, p_request_fingerprint
         )
      then
        raise exception 'eBay deterministic no-effect retry already expired'
          using errcode = '55000';
      end if;

      update sellerpilot_private.exact_existing_update_permits permit
         set armed_at = v_now,
             expires_at = v_now + interval '5 minutes'
       where permit.permit_id = v_permit.permit_id
         and permit.credential_id = p_credential_id
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
        raise exception 'eBay exact pre-gateway permit rearm lost race'
          using errcode = '55000';
      end if;

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
        'bound', false, 'reused', true, 'rearmed', true
      );
    end if;

    return jsonb_build_object(
      'contract', 'exact_existing_update_permit_v1',
      'permitId', v_permit.permit_id, 'channel', v_permit.channel,
      'listingId', v_permit.listing_id,
      'releaseSha', v_permit.release_sha,
      'requestFingerprint', v_permit.request_fingerprint,
      'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
      'bound', false, 'reused', true, 'rearmed', false
    );
  end if;

  -- Preserve the original first-arm path. It is reachable only while the
  -- deterministic 25718 source proof still owns the listing pointer.
  select encode(extensions.digest(job.response_payload::text, 'sha256'), 'hex')
    into v_source_response_sha256
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = v_now,
         invalidation_reason = 'ebay_deterministic_no_effect_400'
   where permit.permit_id =
         'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.consumed_at is not null;
  if not found then
    raise exception 'eBay deterministic no-effect source permit unavailable'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.exact_existing_update_permits (
    channel, listing_id, product_id, credential_id, owner_id,
    market, target_id, remote_id, seller_sku, provider_resource_id,
    currency, price, stock, seller_account_key,
    credential_version, credential_fingerprint,
    credential_account_source, credential_verified_at,
    credential_expires_at, credential_last_checked_at,
    credential_last_check_status, snapshot_revision,
    snapshot_payload_sha256, snapshot_source_job_id,
    release_sha, request_fingerprint, armed_at, expires_at,
    retry_source_job_id, retry_source_attempt_id,
    retry_source_permit_id, retry_source_response_sha256
  ) values (
    'ebay', p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id, v_owner_id, 'US', 'EBAY_US', '800551945442',
    'QA-20260823-CC-001-US', '244042196011', 'USD', 12.90,
    v_stock,
    'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f',
    v_version, v_fingerprint, v_account_source, v_verified_at,
    v_expires_at, v_last_checked_at, v_last_check_status,
    null, null, null, p_release_sha, p_request_fingerprint,
    v_now, v_now + interval '5 minutes',
    '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid,
    '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid,
    'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid,
    v_source_response_sha256
  ) returning * into v_permit;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    v_owner_id,
    'ebay_deterministic_no_effect_retry_armed',
    'exact_existing_update_permit',
    v_permit.permit_id::text,
    jsonb_build_object(
      'contract', 'ebay_exact_no_effect_retry_v1',
      'listingId', p_listing_id,
      'sourceJobId', v_permit.retry_source_job_id,
      'sourceAttemptId', v_permit.retry_source_attempt_id,
      'sourcePermitId', v_permit.retry_source_permit_id,
      'sourceHttpStatus', 400,
      'sourceProviderErrorId', 25718,
      'sourceProviderEffect', 'deterministic_rejection_no_effect',
      'replacementPermitId', v_permit.permit_id,
      'requestFingerprint', p_request_fingerprint,
      'releaseSha', p_release_sha,
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
    'bound', false, 'reused', false, 'rearmed', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) to service_role;

do $ebay_pre_gateway_retry_postimage$
declare
  v_arm_definition text;
  v_enqueue_definition text;
  v_identity_definition text;
  v_transition_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into v_arm_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_identity_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into v_transition_definition;

  if pg_catalog.strpos(v_arm_definition,
       'c9d5b739-4ae7-4596-acbc-06f900a21ba3') = 0
     or pg_catalog.strpos(v_arm_definition,
          'ebay_exact_pre_gateway_retry_rearmed') = 0
     or pg_catalog.strpos(v_arm_definition,
          '7ae83178-d335-4b7e-8e35-2f55e905bbde') = 0
     or pg_catalog.strpos(v_enqueue_definition,
          'pg_catalog.jsonb_object_keys(v_retry)') = 0
     or pg_catalog.strpos(v_enqueue_definition,
          'jsonb_object_length') > 0
     or pg_catalog.strpos(v_identity_definition,
          'sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit') = 0
     or pg_catalog.strpos(v_transition_definition,
          'ebay_exact_pre_gateway_failure_is_proved') = 0
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
     or pg_catalog.has_function_privilege(
          'service_role',
          'sellerpilot_private.ebay_exact_pre_gateway_failure_is_proved(uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'service_role',
          'sellerpilot_private.ebay_exact_pre_gateway_rearm_is_proved(uuid)',
          'EXECUTE'
        )
  then
    raise exception 'eBay exact pre-gateway retry postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_pre_gateway_retry_postimage$;

notify pgrst, 'reload schema';

commit;
