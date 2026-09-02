-- Freeze the exact release-62bd eBay pre-gateway failure and expose one
-- service-role-only atomic recovery transaction. The generic arm/proof
-- functions are intentionally unchanged, and this migration never calls eBay.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000012);

do $atomic_preimage$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_release_is_current(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(uuid,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_exact_existing_update_permit_transition()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'
     ) is null
  then
    raise exception 'eBay exact atomic recovery preimage missing'
      using errcode = '55000';
  end if;
end;
$atomic_preimage$;

create table sellerpilot_private.ebay_exact_atomic_recovery_markers (
  marker_id uuid primary key,
  owner_id uuid not null,
  product_id uuid not null,
  listing_id uuid not null,
  failed_attempt_id uuid not null,
  credential_id uuid not null,
  permit_id uuid not null,
  source_release_sha text not null,
  request_fingerprint text not null,
  seller_account_key text not null,
  failed_started_at timestamptz not null,
  failed_completed_at timestamptz not null,
  permit_armed_at timestamptz not null,
  permit_expires_at timestamptz not null,
  reference_set jsonb not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint ebay_exact_atomic_recovery_marker_exact check (
    marker_id = 'a04ed967-a129-43d4-8ce8-af6657af5ef0'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
    and failed_attempt_id = '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid
    and credential_id = '16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea'::uuid
    and permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
    and source_release_sha =
          '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76'
    and request_fingerprint =
          '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
    and seller_account_key =
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
    and failed_started_at =
          '2026-09-02 06:26:46.362671+00'::timestamptz
    and failed_completed_at =
          '2026-09-02 06:26:54.769797+00'::timestamptz
    and permit_armed_at =
          '2026-09-02 06:26:46.052592+00'::timestamptz
    and permit_expires_at =
          '2026-09-02 06:31:46.052592+00'::timestamptz
    and jsonb_typeof(reference_set) = 'array'
    and jsonb_array_length(reference_set) = 9
  )
);

alter table sellerpilot_private.ebay_exact_atomic_recovery_markers
  enable row level security;
revoke all on table sellerpilot_private.ebay_exact_atomic_recovery_markers
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_ebay_exact_atomic_recovery_marker()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'eBay exact atomic recovery marker is append-only'
    using errcode = '55000';
end;
$$;

revoke all on function
  sellerpilot_private.guard_ebay_exact_atomic_recovery_marker()
  from public, anon, authenticated, service_role;

create trigger guard_ebay_exact_atomic_recovery_marker
before update or delete on sellerpilot_private.ebay_exact_atomic_recovery_markers
for each row execute function
  sellerpilot_private.guard_ebay_exact_atomic_recovery_marker();

do $freeze_atomic_snapshot$
declare
  v_reference_set jsonb;
begin
  -- Empty/test installations have no production recovery target.
  if not exists (
    select 1 from sellerpilot_private.product_listings listing
     where listing.id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
  ) then return; end if;

  select jsonb_agg(
           jsonb_build_object(
             'objectPath', ref.object_path,
             'publicUrl', ref.canonical_public_url,
             'contentSha256', asset.content_sha256,
             'sourceObjectPath', ref.source_object_path,
             'sourceContentSha256', ref.source_content_sha256
           ) order by ref.object_path
         )
    into v_reference_set
    from sellerpilot_private.marketplace_normalized_asset_refs ref
    join sellerpilot_private.marketplace_normalized_assets asset
      on asset.object_path = ref.object_path
     and asset.content_sha256 = pg_catalog.substring(
           ref.object_path,
           '^normalized/[0-9a-f]{2}/([0-9a-f]{64})[.]jpg$'
         )
     and asset.status = 'available'
     and asset.uploaded_at is not null
   where ref.attempt_id = '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid
     and ref.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and ref.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and ref.channel = 'ebay' and ref.market = 'US'
     and ref.target_id = 'EBAY_US'
     and ref.upload_confirmed_at is not null
     and ref.source_object_path is not null
     and ref.source_content_sha256 is not null
     and ref.canonical_public_url ~
           '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}[.]jpg$'
     and pg_catalog.right(
           ref.canonical_public_url,
           pg_catalog.length(ref.object_path) + 1
         ) = '/' || ref.object_path;

  if jsonb_typeof(v_reference_set) is distinct from 'array'
     or jsonb_array_length(v_reference_set) <> 9
     or (select count(*)
           from sellerpilot_private.marketplace_normalized_asset_refs ref
          where ref.attempt_id =
                '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid) <> 9
     or (select count(distinct entry->>'objectPath')
           from jsonb_array_elements(v_reference_set) entry) <> 9
     or (select count(distinct entry->>'publicUrl')
           from jsonb_array_elements(v_reference_set) entry) <> 9
     or (select count(distinct entry->>'contentSha256')
           from jsonb_array_elements(v_reference_set) entry) <> 9
     or not exists (
       select 1 from jsonb_array_elements(v_reference_set) entry
        where entry->>'objectPath' =
          'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
     )
  then
    raise exception 'eBay exact atomic recovery nine-ref snapshot invalid'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product
        on product.id = listing.product_id
       and product.owner_id = listing.owner_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid
       and attempt.owner_id = listing.owner_id
       and attempt.channel = listing.channel_key
      join sellerpilot_private.channel_credentials credential
        on credential.id = '16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea'::uuid
       and credential.channel = listing.channel_key
       and credential.seller_account_key = listing.seller_account_key
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and permit.listing_id = listing.id
       and permit.product_id = listing.product_id
       and permit.owner_id = listing.owner_id
     where listing.id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = 'ebay'
       and listing.status = 'failed' and listing.failure_class = 'retryable'
       and listing.operation_attempt_id =
             '079cd680-47fb-4910-b3d8-27d19356e66e'::uuid
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
       and product.sku = 'QA-20260823-CC-001' and product.on_hand = 1
       and not product.demo and product.status <> 'archived'
       and attempt.credential_id = credential.id
       and attempt.operation = 'listing.update'
       and attempt.status = 'failed' and attempt.http_status = 422
       and attempt.remote_id is null and attempt.gateway_write_required
       and attempt.pre_gateway_retryable
       and attempt.request_fingerprint =
             '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
       and attempt.seller_account_key = listing.seller_account_key
       and attempt.started_at =
             '2026-09-02 06:26:46.362671+00'::timestamptz
       and attempt.completed_at =
             '2026-09-02 06:26:54.769797+00'::timestamptz
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
       and sellerpilot_private.ebay_exact_current_credential_is_valid(
             credential.id, listing.seller_account_key
           )
       and permit.channel = 'ebay' and permit.market = 'US'
       and permit.target_id = 'EBAY_US' and permit.remote_id = '800551945442'
       and permit.seller_sku = 'QA-20260823-CC-001-US'
       and permit.provider_resource_id = '244042196011'
       and permit.currency = 'USD' and permit.price = 12.90
       and permit.stock = 1
       and permit.seller_account_key = listing.seller_account_key
       and permit.credential_id = credential.id
       and permit.release_sha =
             '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76'
       and permit.request_fingerprint = attempt.request_fingerprint
       and permit.armed_at =
             '2026-09-02 06:26:46.052592+00'::timestamptz
       and permit.expires_at =
             '2026-09-02 06:31:46.052592+00'::timestamptz
       and permit.retry_source_attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and permit.update_job_id is null and permit.update_attempt_id is null
       and permit.arguments_sha256 is null and permit.arguments_bytes is null
       and permit.request_payload_sha256 is null
       and permit.request_payload_bytes is null
       and permit.bound_at is null and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null and permit.consumed_at is null
       and permit.invalidated_at is null and permit.invalidation_reason is null
       and not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs job
          where job.attempt_id = attempt.id
       )
  ) then
    raise exception 'eBay exact atomic recovery production snapshot drifted'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.ebay_exact_atomic_recovery_markers (
    marker_id, owner_id, product_id, listing_id, failed_attempt_id,
    credential_id, permit_id, source_release_sha, request_fingerprint,
    seller_account_key, failed_started_at, failed_completed_at,
    permit_armed_at, permit_expires_at, reference_set
  ) values (
    'a04ed967-a129-43d4-8ce8-af6657af5ef0',
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
    'ddccde35-9c58-4856-b673-d7aa27ce4220',
    '8b2cbfaf-3854-437d-b381-abfd70291354',
    '3ffaf977-3950-4a74-af02-16b4cd930ac9',
    '16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea',
    '7ae83178-d335-4b7e-8e35-2f55e905bbde',
    '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76',
    '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e',
    'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f',
    '2026-09-02 06:26:46.362671+00',
    '2026-09-02 06:26:54.769797+00',
    '2026-09-02 06:26:46.052592+00',
    '2026-09-02 06:31:46.052592+00',
    v_reference_set
  );
end;
$freeze_atomic_snapshot$;

create function sellerpilot_private.ebay_exact_atomic_recovery_state_is_current(
  p_credential_id uuid,
  p_release_sha text,
  p_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.ebay_exact_atomic_recovery_markers marker
      join sellerpilot_private.product_listings listing
        on listing.id = marker.listing_id
       and listing.owner_id = marker.owner_id
       and listing.product_id = marker.product_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = marker.failed_attempt_id
       and attempt.owner_id = marker.owner_id
       and attempt.channel = listing.channel_key
      join sellerpilot_private.channel_credentials credential
        on credential.id = p_credential_id
       and credential.id = marker.credential_id
       and credential.channel = listing.channel_key
       and credential.seller_account_key = marker.seller_account_key
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.permit_id = marker.permit_id
       and permit.listing_id = marker.listing_id
       and permit.product_id = marker.product_id
       and permit.owner_id = marker.owner_id
     where marker.marker_id =
             'a04ed967-a129-43d4-8ce8-af6657af5ef0'::uuid
       and p_attempt_id = marker.failed_attempt_id
       and p_release_sha ~ '^[a-f0-9]{40}$'
       and sellerpilot_private.exact_existing_update_release_is_current(
             'ebay', p_release_sha
           )
       and sellerpilot_private.ebay_exact_current_credential_is_valid(
             p_credential_id, marker.seller_account_key
           )
       and listing.channel_key = 'ebay'
       and listing.status = 'failed' and listing.failure_class = 'retryable'
       and listing.operation_attempt_id =
             '079cd680-47fb-4910-b3d8-27d19356e66e'::uuid
       and listing.remote_id = '800551945442'
       and listing.market = 'US' and listing.target_id = 'EBAY_US'
       and listing.marketplace_sku = 'QA-20260823-CC-001-US'
       and listing.provider_resource_id = '244042196011'
       and listing.currency = 'USD' and listing.price = 12.90
       and listing.seller_account_key = marker.seller_account_key
       and credential.environment = 'production' and credential.status = 'active'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
       and attempt.credential_id = p_credential_id
       and attempt.operation = 'listing.update' and attempt.status = 'running'
       and attempt.http_status is null and attempt.remote_id is null
       and attempt.gateway_write_required and not attempt.pre_gateway_retryable
       and attempt.request_fingerprint = marker.request_fingerprint
       and attempt.seller_account_key = marker.seller_account_key
       and attempt.started_at > marker.failed_completed_at
       and attempt.started_at <= statement_timestamp()
       and attempt.completed_at is null
       and permit.channel = 'ebay' and permit.remote_id = '800551945442'
       and permit.provider_resource_id = '244042196011'
       and permit.credential_id = marker.credential_id
       and permit.release_sha = marker.source_release_sha
       and permit.request_fingerprint = marker.request_fingerprint
       and permit.armed_at = marker.permit_armed_at
       and permit.expires_at = marker.permit_expires_at
       and permit.expires_at <= statement_timestamp()
       and permit.retry_source_attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and permit.update_job_id is null and permit.update_attempt_id is null
       and permit.arguments_sha256 is null and permit.arguments_bytes is null
       and permit.request_payload_sha256 is null
       and permit.request_payload_bytes is null
       and permit.bound_at is null and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null and permit.consumed_at is null
       and permit.invalidated_at is null and permit.invalidation_reason is null
       and not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs job
          where job.attempt_id = attempt.id
       )
       and marker.reference_set = (
         select jsonb_agg(
                  jsonb_build_object(
                    'objectPath', ref.object_path,
                    'publicUrl', ref.canonical_public_url,
                    'contentSha256', asset.content_sha256,
                    'sourceObjectPath', ref.source_object_path,
                    'sourceContentSha256', ref.source_content_sha256
                  ) order by ref.object_path
                )
           from sellerpilot_private.marketplace_normalized_asset_refs ref
           join sellerpilot_private.marketplace_normalized_assets asset
             on asset.object_path = ref.object_path
            and asset.content_sha256 = pg_catalog.substring(
                  ref.object_path,
                  '^normalized/[0-9a-f]{2}/([0-9a-f]{64})[.]jpg$'
                )
            and asset.status = 'available'
            and asset.uploaded_at is not null
          where ref.attempt_id = attempt.id
            and ref.owner_id = marker.owner_id
            and ref.product_id = marker.product_id
            and ref.channel = 'ebay' and ref.market = 'US'
            and ref.target_id = 'EBAY_US'
            and ref.upload_confirmed_at is not null
            and ref.source_object_path is not null
            and ref.source_content_sha256 is not null
            and ref.canonical_public_url ~
                  '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}[.]jpg$'
            and pg_catalog.right(
                  ref.canonical_public_url,
                  pg_catalog.length(ref.object_path) + 1
                ) = '/' || ref.object_path
       )
       and (select count(*)
              from sellerpilot_private.marketplace_normalized_asset_refs ref
             where ref.attempt_id = attempt.id) = 9
  ), false)
$$;

revoke all on function
  sellerpilot_private.ebay_exact_atomic_recovery_state_is_current(
    uuid, text, uuid
  ) from public, anon, authenticated, service_role;

-- Insert one exact exception immediately after DELETE rejection and before the
-- predecessor's generic immutable-identity check. The predecessor deliberately
-- excludes release/credential/armed fields from its mutable list, so inserting
-- at its final RAISE would make this exact rearm unreachable.
do $patch_atomic_permit_transition$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_anchor constant text := $old$  if tg_op = 'DELETE' then
    raise exception 'exact existing update permits cannot be deleted'
      using errcode = '55000';
  end if;
  if to_jsonb(new) - v_mutable_fields is distinct from$old$;
  v_branch constant text := $new$  if tg_op = 'DELETE' then
    raise exception 'exact existing update permits cannot be deleted'
      using errcode = '55000';
  end if;

  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.credential_id = '16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea'::uuid
     and old.release_sha = '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76'
     and old.request_fingerprint =
           '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
     and old.armed_at = '2026-09-02 06:26:46.052592+00'::timestamptz
     and old.expires_at = '2026-09-02 06:31:46.052592+00'::timestamptz
     and old.expires_at <= statement_timestamp()
     and old.update_job_id is null and old.update_attempt_id is null
     and old.arguments_sha256 is null and old.arguments_bytes is null
     and old.request_payload_sha256 is null
     and old.request_payload_bytes is null
     and old.bound_at is null and old.bound_worker_token_id is null
     and old.bound_claim_token is null and old.consumed_at is null
     and old.invalidated_at is null and old.invalidation_reason is null
     and new.credential_id = old.credential_id
     and new.request_fingerprint = old.request_fingerprint
     and sellerpilot_private.exact_existing_update_release_is_current(
           'ebay', new.release_sha
         )
     and new.armed_at = statement_timestamp()
     and new.expires_at = new.armed_at + interval '5 minutes'
     and sellerpilot_private.ebay_exact_atomic_recovery_state_is_current(
           new.credential_id, new.release_sha,
           '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid
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

  if to_jsonb(new) - v_mutable_fields is distinct from$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure where procedure.oid = v_signature;
  if pg_catalog.strpos(v_definition, 'ebay_exact_atomic_recovery_state_is_current') <> 0
     or (pg_catalog.length(v_definition)
         - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
        / pg_catalog.length(v_anchor) <> 1
  then raise exception 'eBay exact atomic permit guard preimage drifted'
    using errcode = '55000'; end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_branch);
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition,
          'ebay_exact_atomic_recovery_state_is_current') = 0
     or pg_catalog.strpos(v_definition, v_anchor) <> 0
  then raise exception 'eBay exact atomic permit guard patch failed'
    using errcode = '55000'; end if;
end;
$patch_atomic_permit_transition$;

create function public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_release_sha text,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_enqueue jsonb;
  v_job_id uuid;
  v_existing_job_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917000005);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917000012);

  if p_listing_id is distinct from
       '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or p_credential_id is distinct from
       '16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea'::uuid
     or p_attempt_id is distinct from
       '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid
     or p_request_fingerprint is distinct from
       '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or jsonb_typeof(p_request_payload) is distinct from 'object'
     or p_request_payload#>>'{arguments,publicationExpectedFingerprint}'
          is distinct from p_request_fingerprint
     or p_request_payload#>>
          '{arguments,sellerpilotEbayExactV101ContentContract,contract}'
          is distinct from 'ebay_exact_v101_content_contract_v1'
  then raise exception 'eBay exact atomic recovery request invalid'
    using errcode = '55000'; end if;

  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'ebay' and credential.environment = 'production'
     and credential.status = 'active'
     and credential.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.expires_at > v_now
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
   for share;

  -- A response-loss or concurrent-equivalent caller must converge on the
  -- already-bound job. This branch intentionally runs before the fresh-state
  -- helper because that helper requires a claim-revived attempt with no job.
  select job.id
    into v_existing_job_id
    from sellerpilot_private.ebay_exact_atomic_recovery_markers marker
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = marker.failed_attempt_id
     and attempt.owner_id = marker.owner_id
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = marker.permit_id
     and permit.listing_id = marker.listing_id
     and permit.product_id = marker.product_id
     and permit.owner_id = marker.owner_id
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = permit.update_job_id
     and job.attempt_id = permit.update_attempt_id
   where marker.marker_id =
           'a04ed967-a129-43d4-8ce8-af6657af5ef0'::uuid
     and marker.failed_attempt_id = p_attempt_id
     and marker.listing_id = p_listing_id
     and marker.credential_id = p_credential_id
     and marker.request_fingerprint = p_request_fingerprint
     and marker.source_release_sha =
           '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76'
     and marker.seller_account_key = v_credential.seller_account_key
     and attempt.credential_id = p_credential_id
     and attempt.channel = 'ebay' and attempt.operation = 'listing.update'
     and attempt.status = 'running' and attempt.http_status is null
     and attempt.remote_id is null and attempt.gateway_write_required
     and not attempt.pre_gateway_retryable
     and attempt.request_fingerprint = p_request_fingerprint
     and attempt.seller_account_key = marker.seller_account_key
     and attempt.started_at > marker.failed_completed_at
     and attempt.completed_at is null
     and permit.credential_id = p_credential_id
     and permit.release_sha = p_release_sha
     and permit.request_fingerprint = p_request_fingerprint
     and permit.update_attempt_id = p_attempt_id
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and job.listing_id = p_listing_id
     and job.credential_id = p_credential_id
     and job.channel = 'ebay' and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.status in ('queued', 'running')
     and job.seller_account_key = marker.seller_account_key
     and job.request_fingerprint = p_request_fingerprint
     and job.request_payload = p_request_payload
     and job.completed_at is null and job.response_payload is null
     and job.error_message is null
     and (
       (job.status = 'queued'
         and job.provider_mutation_started_at is null
         and permit.bound_at is null
         and permit.bound_worker_token_id is null
         and permit.bound_claim_token is null
         and permit.consumed_at is null)
       or
       (job.status = 'running'
         and permit.bound_at is not null
         and permit.bound_worker_token_id = job.worker_token_id
         and permit.bound_claim_token = job.claim_token
         and job.worker_token_id is not null
         and job.claim_token is not null
         and (
           (job.provider_mutation_started_at is null
             and permit.consumed_at is null)
           or
           (job.provider_mutation_started_at is not null
             and permit.consumed_at >= job.provider_mutation_started_at)
         ))
     )
     and sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
           p_attempt_id, p_request_payload
         )
     and marker.reference_set = (
       select jsonb_agg(
                jsonb_build_object(
                  'objectPath', ref.object_path,
                  'publicUrl', ref.canonical_public_url,
                  'contentSha256', asset.content_sha256,
                  'sourceObjectPath', ref.source_object_path,
                  'sourceContentSha256', ref.source_content_sha256
                ) order by ref.object_path
              )
         from sellerpilot_private.marketplace_normalized_asset_refs ref
         join sellerpilot_private.marketplace_normalized_assets asset
           on asset.object_path = ref.object_path
          and asset.content_sha256 = pg_catalog.substring(
                ref.object_path,
                '^normalized/[0-9a-f]{2}/([0-9a-f]{64})[.]jpg$'
              )
          and asset.status = 'available'
          and asset.uploaded_at is not null
        where ref.attempt_id = p_attempt_id
          and ref.owner_id = marker.owner_id
          and ref.product_id = marker.product_id
          and ref.channel = 'ebay' and ref.market = 'US'
          and ref.target_id = 'EBAY_US'
          and ref.upload_confirmed_at is not null
          and ref.source_object_path is not null
          and ref.source_content_sha256 is not null
          and ref.canonical_public_url ~
                '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}[.]jpg$'
          and pg_catalog.right(
                ref.canonical_public_url,
                pg_catalog.length(ref.object_path) + 1
              ) = '/' || ref.object_path
     )
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
   limit 1;

  if v_existing_job_id is not null then
    return jsonb_build_object(
      'contract', 'ebay_exact_v101_atomic_enqueue_v1',
      'status', 'in_progress', 'jobId', v_existing_job_id,
      'attemptId', p_attempt_id, 'listingId', p_listing_id,
      'reused', true, 'releaseSha', p_release_sha,
      'requestFingerprint', p_request_fingerprint
    );
  end if;

  if not sellerpilot_private.ebay_exact_atomic_recovery_state_is_current(
       p_credential_id, p_release_sha, p_attempt_id
     )
     or not sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
       p_attempt_id, p_request_payload
     )
  then raise exception 'eBay exact atomic fresh recovery state invalid'
    using errcode = '55000'; end if;

  select permit.* into strict v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and permit.listing_id = p_listing_id
     and permit.credential_id = p_credential_id
     and permit.release_sha =
           '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76'
     and permit.request_fingerprint = p_request_fingerprint
     and permit.update_job_id is null and permit.update_attempt_id is null
     and permit.bound_at is null and permit.consumed_at is null
     and permit.invalidated_at is null and permit.expires_at <= v_now
   for update;

  update sellerpilot_private.exact_existing_update_permits permit
     set credential_id = p_credential_id,
         credential_version = v_credential.version,
         credential_fingerprint = v_credential.fingerprint,
         credential_account_source = v_credential.seller_account_key_source,
         credential_verified_at = v_credential.seller_account_verified_at,
         credential_expires_at = v_credential.expires_at,
         credential_last_checked_at = v_credential.last_checked_at,
         credential_last_check_status = v_credential.last_check_status,
         release_sha = p_release_sha,
         armed_at = v_now,
         expires_at = v_now + interval '5 minutes'
   where permit.permit_id = v_permit.permit_id
     and permit.release_sha = v_permit.release_sha
     and permit.armed_at = v_permit.armed_at
     and permit.expires_at = v_permit.expires_at
     and permit.update_job_id is null and permit.update_attempt_id is null
     and permit.bound_at is null and permit.consumed_at is null
     and permit.invalidated_at is null;
  if not found then raise exception 'eBay exact atomic permit rearm lost race'
    using errcode = '55000'; end if;

  v_enqueue := public.sellerpilot_service_enqueue_listing_gateway_job(
    p_listing_id, p_credential_id, p_attempt_id, 'ebay',
    'listing.update', p_request_payload
  );
  if coalesce(v_enqueue->>'job_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_enqueue->>'attempt_id' is distinct from p_attempt_id::text
     or v_enqueue->>'status' is distinct from 'queued'
     or coalesce((v_enqueue->>'reused')::boolean, false)
  then raise exception 'eBay exact atomic job not newly queued'
    using errcode = '55000'; end if;
  v_job_id := (v_enqueue->>'job_id')::uuid;

  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.update_job_id = job.id
       and permit.update_attempt_id = job.attempt_id
     where job.id = v_job_id and job.attempt_id = p_attempt_id
       and job.listing_id = p_listing_id
       and job.credential_id = p_credential_id
       and job.channel = 'ebay' and job.operation = 'listing.update'
       and job.environment = 'production' and job.status = 'queued'
       and job.attempt_count = 0
       and job.request_fingerprint = p_request_fingerprint
       and job.request_payload = p_request_payload
       and job.provider_mutation_started_at is null
       and job.response_payload is null and job.completed_at is null
       and permit.permit_id = v_permit.permit_id
       and permit.release_sha = p_release_sha
       and permit.credential_id = p_credential_id
       and permit.request_fingerprint = p_request_fingerprint
       and permit.armed_at = v_now
       and permit.expires_at = v_now + interval '5 minutes'
       and permit.bound_at is null and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null and permit.consumed_at is null
       and permit.invalidated_at is null
       and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
             permit.permit_id
           )
  ) then raise exception 'eBay exact atomic permit/job binding invalid'
    using errcode = '55000'; end if;

  return jsonb_build_object(
    'contract', 'ebay_exact_v101_atomic_enqueue_v1',
    'status', 'queued', 'jobId', v_job_id,
    'attemptId', p_attempt_id, 'listingId', p_listing_id,
    'reused', false, 'releaseSha', p_release_sha,
    'requestFingerprint', p_request_fingerprint
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(
    uuid, uuid, uuid, text, text, jsonb
  ) to service_role;

do $atomic_postimage$
declare
  v_rpc text;
  v_guard text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into strict v_rpc;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into strict v_guard;
  if pg_catalog.strpos(v_rpc, '3ffaf977-3950-4a74-af02-16b4cd930ac9') = 0
     or pg_catalog.strpos(v_rpc,
          'ebay_exact_v101_fresh_asset_refs_are_current') = 0
     or pg_catalog.strpos(v_rpc,
          'sellerpilot_service_enqueue_listing_gateway_job') = 0
     or pg_catalog.strpos(v_rpc,
          'exact_existing_update_enqueued_lineage_is_current') = 0
     or pg_catalog.strpos(v_guard,
          'ebay_exact_atomic_recovery_state_is_current') = 0
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
  then raise exception 'eBay exact atomic recovery postimage invalid'
    using errcode = '55000'; end if;
end;
$atomic_postimage$;

comment on table sellerpilot_private.ebay_exact_atomic_recovery_markers is
  'Append-only exact evidence for release-62bd attempt 3ffa before its claim revival.';
comment on function
  public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(
    uuid, uuid, uuid, text, text, jsonb
  ) is
  'Atomically rearms and enqueues only the marker-bound revived eBay v101 attempt after nine-image payload verification.';

commit;
