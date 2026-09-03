-- Let the exact eBay atomic transaction cross the existing-update lineage
-- fence after it has rebound the frozen v108 permit to the current credential.
-- This migration changes no permit, attempt, listing, job, or provider state.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000013);

create function
  sellerpilot_private.ebay_exact_atomic_rearmed_permit_is_current(
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
      from sellerpilot_private.ebay_exact_atomic_recovery_markers marker
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.permit_id = marker.permit_id
       and permit.listing_id = marker.listing_id
       and permit.product_id = marker.product_id
       and permit.owner_id = marker.owner_id
      join sellerpilot_private.product_listings listing
        on listing.id = marker.listing_id
       and listing.owner_id = marker.owner_id
       and listing.product_id = marker.product_id
      join sellerpilot_private.products product
        on product.id = marker.product_id
       and product.owner_id = marker.owner_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = marker.failed_attempt_id
       and attempt.owner_id = marker.owner_id
      join sellerpilot_private.channel_credentials source_credential
        on source_credential.id = marker.credential_id
       and source_credential.channel = 'ebay'
       and source_credential.environment = 'production'
       and source_credential.seller_account_key = marker.seller_account_key
      join sellerpilot_private.channel_credentials current_credential
        on current_credential.id = permit.credential_id
       and current_credential.channel = 'ebay'
       and current_credential.environment = 'production'
       and current_credential.seller_account_key = marker.seller_account_key
     where marker.marker_id =
             'a04ed967-a129-43d4-8ce8-af6657af5ef0'::uuid
       and p_permit_id = marker.permit_id
       and marker.permit_id =
             '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
       and marker.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and marker.product_id =
             'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and marker.owner_id =
             '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and marker.failed_attempt_id =
             '3ffaf977-3950-4a74-af02-16b4cd930ac9'::uuid
       and marker.credential_id =
             '16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea'::uuid
       and marker.source_release_sha =
             '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76'
       and marker.request_fingerprint =
             '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
       and marker.seller_account_key =
             'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
       and listing.channel_key = 'ebay'
       and listing.status = 'failed'
       and listing.failure_class = 'retryable'
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
       and listing.seller_account_key = marker.seller_account_key
       and product.sku = 'QA-20260823-CC-001'
       and product.on_hand = 1 and not product.demo
       and product.status <> 'archived'
       and attempt.credential_id = current_credential.id
       and attempt.channel = 'ebay'
       and attempt.operation = 'listing.update'
       and attempt.status = 'running'
       and attempt.http_status is null and attempt.remote_id is null
       and attempt.gateway_write_required and not attempt.pre_gateway_retryable
       and attempt.request_fingerprint = marker.request_fingerprint
       and attempt.seller_account_key = marker.seller_account_key
       and attempt.started_at > marker.failed_completed_at
       and attempt.started_at <= statement_timestamp()
       and attempt.completed_at is null
       and source_credential.status = 'revoked'
       and source_credential.version = 108
       and source_credential.seller_account_key_source =
             'provider_certified_v1'
       and source_credential.seller_account_verified_at is not null
       and current_credential.status = 'active'
       and current_credential.version > source_credential.version
       and current_credential.seller_account_key_source =
             'provider_certified_v1'
       and current_credential.seller_account_verified_at is not null
       and sellerpilot_private.ebay_exact_current_credential_is_valid(
             current_credential.id, marker.seller_account_key
           )
       and permit.channel = 'ebay'
       and permit.remote_id = '800551945442'
       and permit.provider_resource_id = '244042196011'
       and permit.seller_sku = 'QA-20260823-CC-001-US'
       and permit.market = 'US' and permit.target_id = 'EBAY_US'
       and permit.currency = 'USD' and permit.price = 12.90
       and permit.stock = 1
       and permit.seller_account_key = marker.seller_account_key
       and permit.credential_id = current_credential.id
       and permit.credential_id <> marker.credential_id
       and permit.credential_version = current_credential.version
       and permit.credential_fingerprint = current_credential.fingerprint
       and permit.credential_account_source =
             current_credential.seller_account_key_source
       and permit.credential_verified_at =
             current_credential.seller_account_verified_at
       and permit.credential_expires_at is not distinct from
             current_credential.expires_at
       and permit.credential_last_checked_at is not distinct from
             current_credential.last_checked_at
       and permit.credential_last_check_status is not distinct from
             current_credential.last_check_status
       and permit.release_sha <> marker.source_release_sha
       and permit.release_sha ~ '^[a-f0-9]{40}$'
       and sellerpilot_private.exact_existing_update_release_is_current(
             'ebay', permit.release_sha
           )
       and permit.request_fingerprint = marker.request_fingerprint
       and permit.armed_at > marker.failed_completed_at
       and permit.armed_at <= statement_timestamp()
       and permit.expires_at = permit.armed_at + interval '5 minutes'
       and permit.expires_at > statement_timestamp()
       and permit.retry_source_job_id =
             '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
       and permit.retry_source_attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and permit.retry_source_permit_id =
             'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
       and permit.update_job_id is null and permit.update_attempt_id is null
       and permit.arguments_sha256 is null and permit.arguments_bytes is null
       and permit.request_payload_sha256 is null
       and permit.request_payload_bytes is null
       and permit.bound_at is null
       and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null
       and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.invalidation_reason is null
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
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
  sellerpilot_private.ebay_exact_atomic_rearmed_permit_is_current(uuid)
  from public, anon, authenticated, service_role;

do $patch_ebay_atomic_rearmed_lineage$
declare
  v_signature regprocedure :=
    'sellerpilot_private.exact_existing_update_lineage_before_temu_173960(uuid)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text := $old$and sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(
                     permit.permit_id
                   )$old$;
  v_new constant text := $new$and (
                 sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(
                   permit.permit_id
                 )
                 or sellerpilot_private.ebay_exact_atomic_rearmed_permit_is_current(
                   permit.permit_id
                 )
               )$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old) <> 1
  then
    raise exception 'eBay atomic rearmed lineage patch preimage drifted'
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_old) <> 0
     or pg_catalog.strpos(v_definition, v_new) = 0
  then
    raise exception 'eBay atomic rearmed lineage patch failed'
      using errcode = '55000';
  end if;
end;
$patch_ebay_atomic_rearmed_lineage$;

do $ebay_atomic_rearmed_lineage_postimage$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_atomic_rearmed_permit_is_current(uuid)'
     ) is null
     or pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(
            'sellerpilot_private.exact_existing_update_lineage_before_temu_173960(uuid)'::regprocedure
          ),
          'ebay_exact_atomic_rearmed_permit_is_current'
        ) = 0
  then
    raise exception 'eBay atomic rearmed lineage postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_atomic_rearmed_lineage_postimage$;

commit;
