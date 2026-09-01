-- Bind the one exact existing eBay QA update to the current provider-certified
-- credential incarnation instead of a short-lived OAuth access-token row.
-- The listing, offer, marketplace, SKU, seller account and immutable provider
-- lineage remain exact. A credential rotation therefore changes only the
-- credential snapshot stored on the five-minute permit.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908200001);

create function sellerpilot_private.ebay_exact_current_credential_is_valid(
  p_credential_id uuid,
  p_seller_account_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_seller_account_key =
      'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
    and exists (
      select 1
        from sellerpilot_private.channel_credentials credential
       where credential.id = p_credential_id
         and credential.channel = 'ebay'
         and credential.environment = 'production'
         and credential.status = 'active'
         and credential.version > 0
         and credential.fingerprint ~ '^[A-F0-9]{12}$'
         and credential.seller_account_key = p_seller_account_key
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
         and credential.expires_at is not null
         and credential.expires_at > statement_timestamp()
         and credential.last_checked_at is not null
         and credential.last_check_status = 'passed'
         and credential.version = (
           select max(candidate.version)
             from sellerpilot_private.channel_credentials candidate
            where candidate.channel = 'ebay'
              and candidate.environment = 'production'
              and candidate.seller_account_key = p_seller_account_key
         )
         and 1 = (
           select count(*)
             from sellerpilot_private.channel_credentials active_credential
            where active_credential.channel = 'ebay'
              and active_credential.environment = 'production'
              and active_credential.status = 'active'
              and active_credential.seller_account_key = p_seller_account_key
         )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_current_credential_is_valid(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    p_listing_id uuid,
    p_credential_id uuid,
    p_product_id uuid,
    p_market text,
    p_target_id text
  )
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'ebay_exact_existing_qa_recovery_v2',
    'phase', 'listing.update',
    'productId', product.id,
    'listingId', listing.id,
    'sourceAttemptId', listing.operation_attempt_id,
    'publicListingId', listing.remote_id,
    'market', listing.market,
    'marketplaceId', listing.target_id,
    'marketplaceSku', listing.marketplace_sku,
    'offerId', listing.provider_resource_id,
    'currency', listing.currency,
    'priceUsd', listing.price,
    'stock', product.on_hand,
    'credentialId', credential.id,
    'sellerAccountKey', listing.seller_account_key,
    'offerIdSource', 'immutable_lineage_attestation_v1',
    'sellerAccountLineage', 'validated_by_service_rpc'
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
    join sellerpilot_private.provider_listing_lineage_attestations attestation
      on attestation.listing_id = listing.id
    join sellerpilot_private.channel_gateway_jobs lineage_job
      on lineage_job.id = attestation.gateway_job_id
    join sellerpilot_private.channel_credentials lineage_credential
      on lineage_credential.id = attestation.credential_id
   where p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'ebay'
     and listing.remote_id = '800551945442'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.remote_resources = '{}'::jsonb
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.currency = 'USD'
     and listing.price = 12.90
     and listing.operation_attempt_id =
       '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid
     and listing.market = 'US'
     and listing.target_id = 'EBAY_US'
     and trim(coalesce(p_market, '')) = 'US'
     and trim(coalesce(p_target_id, '')) = 'EBAY_US'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand between 1 and 999999
     and not product.demo
     and product.status <> 'archived'
     and listing.seller_account_key =
       'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and credential.seller_account_key = listing.seller_account_key
     and sellerpilot_private.ebay_exact_current_credential_is_valid(
       credential.id, listing.seller_account_key
     )
     and attestation.id = 'fc54f95c-3533-4dbd-820f-cb2dfaf018e7'::uuid
     and attestation.credential_id =
       'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1'::uuid
     and attestation.gateway_job_id =
       'fdff6983-1f08-4f51-a751-bc61b4bf7070'::uuid
     and attestation.channel = 'ebay'
     and attestation.environment = 'production'
     and attestation.seller_account_key = listing.seller_account_key
     and attestation.expected_remote_id = listing.remote_id
     and attestation.verified_remote_id = listing.remote_id
     and attestation.market = listing.market
     and attestation.target_id = listing.target_id
     and attestation.marketplace_sku = listing.marketplace_sku
     and attestation.provider_resource_id = listing.provider_resource_id
     and attestation.evidence_version = 'provider_listing_readback_v1'
     and attestation.evidence_digest =
       '3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a'
     and attestation.verified_at is not null
     and lineage_job.id =
       'fdff6983-1f08-4f51-a751-bc61b4bf7070'::uuid
     and lineage_job.listing_id = listing.id
     and lineage_job.credential_id = attestation.credential_id
     and lineage_job.channel = 'ebay'
     and lineage_job.environment = 'production'
     and lineage_job.operation = 'listing.lineage.verify'
     and lineage_job.status = 'succeeded'
     and lineage_job.seller_account_key = listing.seller_account_key
     and lineage_credential.id =
       'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1'::uuid
     and lineage_credential.channel = 'ebay'
     and lineage_credential.environment = 'production'
     and lineage_credential.status = 'revoked'
     and lineage_credential.version = 84
     and lineage_credential.fingerprint = 'A48BC6BD3D4B'
     and lineage_credential.seller_account_key = listing.seller_account_key
     and lineage_credential.seller_account_key_source = 'provider_certified_v1'
     and lineage_credential.seller_account_verified_at is not null
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
   limit 1;
$$;

revoke all on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

alter table sellerpilot_private.exact_existing_update_permits
  drop constraint exact_existing_update_permit_target_check;
alter table sellerpilot_private.exact_existing_update_permits
  add constraint exact_existing_update_permit_target_check check (
    product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and seller_account_key ~ '^[a-f0-9]{64}$'
    and credential_version > 0
    and credential_fingerprint ~ '^[A-F0-9]{12}$'
    and credential_account_source in (
      'provider_certified_v1', 'credential_incarnation_v1'
    )
    and release_sha ~ '^[a-f0-9]{40}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
    and expires_at > armed_at
    and expires_at <= armed_at + interval '5 minutes'
    and (
      (
        channel = 'coupang'
        and listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
        and market = 'KR' and target_id = 'KR'
        and remote_id = '16356981734'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id = '95962393877'
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_account_source = 'credential_incarnation_v1'
        and snapshot_revision is null
        and snapshot_payload_sha256 is null
        and snapshot_source_job_id is null
      ) or (
        channel = 'elevenst'
        and listing_id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
        and credential_id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
        and market = 'KR' and target_id = 'KR'
        and remote_id = '9573255804'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id is null
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_version = 2
        and credential_account_source = 'credential_incarnation_v1'
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision > 0
        and snapshot_payload_sha256 ~ '^[a-f0-9]{64}$'
        and snapshot_source_job_id is not null
      ) or (
        channel = 'ebay'
        and listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
        and market = 'US' and target_id = 'EBAY_US'
        and remote_id = '800551945442'
        and seller_sku = 'QA-20260823-CC-001-US'
        and provider_resource_id = '244042196011'
        and currency = 'USD' and price = 12.90
        and stock between 1 and 999999
        and credential_account_source = 'provider_certified_v1'
        and credential_expires_at is not null
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision is null
        and snapshot_payload_sha256 is null
        and snapshot_source_job_id is null
        and seller_account_key =
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      )
    )
  );

do $patch_ebay_exact_argument_credential$
declare
  v_definition text;
  v_before text := $old$
      and v_marker->>'credentialId' = 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'$old$;
  v_after text := $new$
      and v_marker->>'credentialId' ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'eBay exact argument credential patch target not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_ebay_exact_argument_credential$;

do $patch_ebay_exact_permit_lineage$
declare
  v_definition text;
  v_identity_before text := $old$
           and permit.credential_id =
                 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
           and permit.remote_id = '800551945442'$old$;
  v_identity_after text := $new$
           and permit.remote_id = '800551945442'$new$;
  v_credential_before text := $old$
           and permit.credential_version = 92
           and permit.credential_fingerprint = 'B82F3FE28085'
           and permit.credential_account_source = 'provider_certified_v1'
           and permit.snapshot_revision is null$old$;
  v_credential_after text := $new$
           and permit.credential_account_source = 'provider_certified_v1'
           and sellerpilot_private.ebay_exact_current_credential_is_valid(
                 permit.credential_id, permit.seller_account_key
               )
           and permit.snapshot_revision is null$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_identity_before) = 0
     or pg_catalog.strpos(v_definition, v_credential_before) = 0
  then
    raise exception 'eBay exact permit lineage patch target not found'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_identity_before, v_identity_after
  );
  v_definition := pg_catalog.replace(
    v_definition, v_credential_before, v_credential_after
  );
  execute v_definition;
end;
$patch_ebay_exact_permit_lineage$;

do $patch_ebay_exact_permit_arm$
declare
  v_definition text;
  v_credential_before text := $old$
  if p_channel = 'ebay'
     and (
       v_credential_version is distinct from 92
       or v_credential_fingerprint is distinct from 'B82F3FE28085'
       or v_credential_expires_at is null
       or v_credential_last_checked_at is null
       or v_credential_last_check_status is distinct from 'passed'
     )
  then
    raise exception 'exact existing update credential lineage invalid'
      using errcode = '55000';
  end if;$old$;
  v_credential_after text := $new$
  if p_channel = 'ebay'
     and not sellerpilot_private.ebay_exact_current_credential_is_valid(
       p_credential_id,
       'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     )
  then
    raise exception 'exact existing update credential lineage invalid'
      using errcode = '55000';
  end if;$new$;
  v_identity_before text := $old$
    if p_listing_id is distinct from
         '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       or p_credential_id is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
    then raise exception 'exact existing update permit identity invalid'$old$;
  v_identity_after text := $new$
    if p_listing_id is distinct from
         '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
    then raise exception 'exact existing update permit identity invalid'$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_exact_existing_update(text,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_credential_before) = 0
     or pg_catalog.strpos(v_definition, v_identity_before) = 0
  then
    raise exception 'eBay exact permit arm patch target not found'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_credential_before, v_credential_after
  );
  v_definition := pg_catalog.replace(
    v_definition, v_identity_before, v_identity_after
  );
  execute v_definition;
end;
$patch_ebay_exact_permit_arm$;

do $patch_ebay_exact_enqueue_credential$
declare
  v_definition text;
  v_request_before text := $old$
       or p_credential_id is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
       or jsonb_typeof(v_marker) is distinct from 'object'$old$;
  v_request_after text := $new$
       or v_marker->>'credentialId' is distinct from p_credential_id::text
       or jsonb_typeof(v_marker) is distinct from 'object'$new$;
  v_marker_before text := $old$
       or v_marker->>'credentialId' is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'$old$;
  v_credential_before text := $old$
       and credential.id =
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
       and credential.id = (v_marker->>'credentialId')::uuid
       and credential.status = 'active'
       and credential.environment = 'production'
       and credential.version = 92
       and credential.fingerprint = 'B82F3FE28085'
       and credential.expires_at > statement_timestamp()
       and (credential.expires_at at time zone 'UTC')::date = date '2028-02-17'
       and credential.last_checked_at is not null
       and credential.last_check_status = 'passed'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
       and attempt.status = 'running'$old$;
  v_credential_after text := $new$
       and credential.id = p_credential_id
       and v_marker->>'credentialId' = p_credential_id::text
       and credential.seller_account_key = listing.seller_account_key
       and sellerpilot_private.ebay_exact_current_credential_is_valid(
         credential.id, listing.seller_account_key
       )
       and attempt.status = 'running'$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_request_before) = 0
     or pg_catalog.strpos(v_definition, v_marker_before) = 0
     or pg_catalog.strpos(v_definition, v_credential_before) = 0
  then
    raise exception 'eBay exact enqueue credential patch target not found'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_request_before, v_request_after
  );
  v_definition := pg_catalog.replace(v_definition, v_marker_before, '');
  v_definition := pg_catalog.replace(
    v_definition, v_credential_before, v_credential_after
  );
  execute v_definition;
end;
$patch_ebay_exact_enqueue_credential$;

revoke all on function
  sellerpilot_private.exact_existing_update_arguments_valid(
    text, jsonb, text, text, integer
  ) from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.exact_existing_update_lineage_is_current(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_arm_exact_existing_update(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_arm_exact_existing_update(
  text, uuid, uuid, text, text
) to service_role;

comment on function
  sellerpilot_private.ebay_exact_current_credential_is_valid(uuid, text)
is
  'Fail-closed eBay exact-update credential fence: one latest active production credential, provider-certified seller lineage, passed verification and a non-expired access token.';
comment on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  )
is
  'Returns the immutable existing eBay listing/offer/SKU tuple only for the one latest valid provider-certified credential incarnation of the same seller account.';

do $ebay_exact_current_credential_postimage$
declare
  v_definitions text;
  v_constraint text;
begin
  select array_to_string(array[
    pg_catalog.pg_get_functiondef(
      'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(uuid,uuid,uuid,text,text)'::regprocedure
    ),
    pg_catalog.pg_get_functiondef(
      'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure
    ),
    pg_catalog.pg_get_functiondef(
      'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure
    ),
    pg_catalog.pg_get_functiondef(
      'public.sellerpilot_service_arm_exact_existing_update(text,uuid,uuid,text,text)'::regprocedure
    ),
    pg_catalog.pg_get_functiondef(
      'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
    )
  ], E'\n') into v_definitions;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into v_constraint
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
         'sellerpilot_private.exact_existing_update_permits'::regclass
     and constraint_row.conname =
         'exact_existing_update_permit_target_check';

  if v_definitions is null
     or v_constraint is null
     or pg_catalog.strpos(
          v_definitions,
          'a2593ca0-c2c2-4158-a35b-88aa27b5911a'
        ) > 0
     or pg_catalog.strpos(v_definitions, 'B82F3FE28085') > 0
     or pg_catalog.strpos(
          v_constraint,
          'a2593ca0-c2c2-4158-a35b-88aa27b5911a'
        ) > 0
     or pg_catalog.strpos(v_constraint, 'B82F3FE28085') > 0
     or pg_catalog.strpos(
          v_definitions, 'ebay_exact_current_credential_is_valid'
        ) = 0
     or pg_catalog.strpos(v_definitions, 'provider_certified_v1') = 0
     or pg_catalog.strpos(v_definitions, '800551945442') = 0
     or pg_catalog.strpos(v_definitions, '244042196011') = 0
     or pg_catalog.strpos(v_definitions, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.has_function_privilege(
          'public',
          'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'service_role',
          'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'public',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
  then
    raise exception 'eBay current credential fence postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_exact_current_credential_postimage$;

commit;
