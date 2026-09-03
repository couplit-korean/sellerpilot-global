-- Keep the latest failed/no-provider attempt and the last fully verified image
-- preparation attempt as separate evidence. A new exact retry must create its
-- own attempt-scoped refs before the gateway job can be inserted.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000011);

do $ebay_exact_prearm_image_proof$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_attempt_join constant text := $old$         and attempt.channel = listing.channel_key
        join sellerpilot_private.channel_credentials attempt_credential$old$;
  v_attempt_join_with_assets constant text := $new$         and attempt.channel = listing.channel_key
        join sellerpilot_private.channel_operation_attempts asset_attempt
          on asset_attempt.id = 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid
         and asset_attempt.owner_id = listing.owner_id
         and asset_attempt.channel = listing.channel_key
        join sellerpilot_private.channel_credentials attempt_credential$new$;
  v_attempt_state constant text := $old$         and attempt.pre_gateway_retryable
         and attempt.seller_account_key = listing.seller_account_key
         and current_credential.version > 0$old$;
  v_attempt_state_with_assets constant text := $new$         and attempt.pre_gateway_retryable
         and attempt.seller_account_key = listing.seller_account_key
         and asset_attempt.operation = 'listing.update'
         and asset_attempt.request_fingerprint =
               'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
         and asset_attempt.status = 'failed'
         and asset_attempt.http_status = 422
         and asset_attempt.remote_id is null
         and asset_attempt.gateway_write_required
         and asset_attempt.pre_gateway_retryable
         and asset_attempt.seller_account_key = listing.seller_account_key
         and current_credential.version > 0$new$;
  v_retry_job constant text := $old$         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs retry_job
            where retry_job.attempt_id = attempt.id
         )$old$;
  v_retry_job_with_assets constant text := $new$         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs retry_job
            where retry_job.attempt_id = attempt.id
         )
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs asset_job
            where asset_job.attempt_id = asset_attempt.id
         )$new$;
  v_permit_mismatch constant text := $old$         and (
                 permit.credential_id is distinct from p_credential_id
                 or permit.request_fingerprint is distinct from
                      p_request_fingerprint
               )$old$;
  v_asset_lineage constant text := $new$         and (
           select count(*)
             from sellerpilot_private.marketplace_normalized_asset_refs ref
            where ref.attempt_id = asset_attempt.id
              and ref.source_object_path is not null
              and ref.source_content_sha256 is not null
         ) = 8
         and not exists (
           select 1
             from sellerpilot_private.marketplace_normalized_asset_refs ref
            where ref.attempt_id = asset_attempt.id
              and ((ref.source_object_path is null) <>
                   (ref.source_content_sha256 is null))
         )
         and not exists (
           (select ref.object_path, ref.canonical_public_url,
                   ref.source_object_path, ref.source_content_sha256
              from sellerpilot_private.marketplace_normalized_asset_refs ref
             where ref.attempt_id = asset_attempt.id)
           except
           (select ref.object_path, ref.canonical_public_url,
                   ref.source_object_path, ref.source_content_sha256
              from sellerpilot_private.marketplace_normalized_asset_refs ref
             where ref.attempt_id = source_attempt.id)
         )
         and not exists (
           (select ref.object_path, ref.canonical_public_url,
                   ref.source_object_path, ref.source_content_sha256
              from sellerpilot_private.marketplace_normalized_asset_refs ref
             where ref.attempt_id = source_attempt.id)
           except
           (select ref.object_path, ref.canonical_public_url,
                   ref.source_object_path, ref.source_content_sha256
              from sellerpilot_private.marketplace_normalized_asset_refs ref
             where ref.attempt_id = asset_attempt.id)
         )
         and (
                 permit.credential_id is distinct from p_credential_id
                 or permit.request_fingerprint is distinct from
                      p_request_fingerprint
               )$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if pg_catalog.strpos(v_definition, v_attempt_join_with_assets) <> 0
     or pg_catalog.strpos(v_definition, v_attempt_state_with_assets) <> 0
     or pg_catalog.strpos(v_definition, v_retry_job_with_assets) <> 0
     or pg_catalog.strpos(v_definition, v_asset_lineage) <> 0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_attempt_join, ''))
     ) / pg_catalog.length(v_attempt_join) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_attempt_state, ''))
     ) / pg_catalog.length(v_attempt_state) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_retry_job, ''))
     ) / pg_catalog.length(v_retry_job) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_permit_mismatch, ''))
     ) / pg_catalog.length(v_permit_mismatch) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, 'ref.attempt_id = attempt.id', ''
         ))
     ) / pg_catalog.length('ref.attempt_id = attempt.id') <> 2
  then
    raise exception 'eBay exact pre-arm image proof preimage drifted'
      using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(
    v_definition, v_attempt_join, v_attempt_join_with_assets
  );
  v_definition := pg_catalog.replace(
    v_definition, v_attempt_state, v_attempt_state_with_assets
  );
  v_definition := pg_catalog.replace(
    v_definition, v_retry_job, v_retry_job_with_assets
  );
  v_definition := pg_catalog.replace(
    v_definition, 'ref.attempt_id = attempt.id',
    'ref.attempt_id = asset_attempt.id'
  );
  execute pg_catalog.replace(
    v_definition, v_permit_mismatch, v_asset_lineage
  );

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(
          v_definition, '079cd680-47fb-4910-b3d8-27d19356e66e'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'
        ) = 0
     or pg_catalog.strpos(v_definition, 'asset_attempt.status = ''failed''') = 0
     or pg_catalog.strpos(
          v_definition, 'ref.attempt_id = asset_attempt.id'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'ref.attempt_id = attempt.id'
        ) <> 0
     or pg_catalog.strpos(v_definition, 'except') = 0
  then
    raise exception 'eBay exact pre-arm image proof patch failed'
      using errcode = '55000';
  end if;
end;
$ebay_exact_prearm_image_proof$;

-- The public eBay content fence still accepts only the two historical
-- operation-attempt projections. Keep that narrow set and add only the latest
-- proved failed/no-provider projection; the fresh attempt remains p_attempt_id.
do $ebay_exact_latest_listing_projection$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text :=
    'any (array[''22457f2e-51d8-43c5-bb03-d2c1bb7fe697''::uuid,''c9d5b739-4ae7-4596-acbc-06f900a21ba3''::uuid])';
  v_new constant text :=
    'any (array[''22457f2e-51d8-43c5-bb03-d2c1bb7fe697''::uuid,''c9d5b739-4ae7-4596-acbc-06f900a21ba3''::uuid,''079cd680-47fb-4910-b3d8-27d19356e66e''::uuid])';
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if pg_catalog.strpos(v_definition, v_new) <> 0
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 1
  then
    raise exception 'eBay exact latest listing projection preimage drifted'
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
    raise exception 'eBay exact latest listing projection patch failed'
      using errcode = '55000';
  end if;
end;
$ebay_exact_latest_listing_projection$;

create function
  sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
    p_attempt_id uuid,
    p_request_payload jsonb
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_binding jsonb :=
    p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
  v_transport jsonb := v_binding->'providerTransportImages';
  v_details jsonb := v_binding->'approvedDetailImages';
begin
  if jsonb_typeof(p_request_payload) is distinct from 'object'
     or jsonb_typeof(p_request_payload->'arguments') is distinct from 'object'
     or jsonb_typeof(v_binding) is distinct from 'object'
     or jsonb_typeof(v_transport) is distinct from 'array'
     or jsonb_array_length(v_transport) <> 9
     or jsonb_typeof(v_details) is distinct from 'array'
     or jsonb_array_length(v_details) <> 8
     or v_binding->>'contract' is distinct from
          'sellerpilot_publication_asset_binding_v1'
     or v_binding->>'providerImageSurface' is distinct from 'gallery'
     or v_transport#>>'{0,role}' is distinct from 'gallery-representative'
     or v_transport#>>'{0,objectPath}' is distinct from
          'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
     or v_transport#>>'{0,contentSha256}' is distinct from
          '292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a'
     or v_transport#>>'{0,approvedSourceSha256}' is distinct from
          '1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753'
     or v_transport#>>'{0,approvedObjectPath}' !~
          '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
  then
    return false;
  end if;

  if (
       select count(distinct image->>'objectPath') = 9
          and count(distinct image->>'publicUrl') = 9
          and count(distinct image->>'contentSha256') = 9
          and bool_and((image->>'objectPath') =
                'normalized/' || left((image->>'contentSha256'), 2) || '/' ||
                (image->>'contentSha256') || '.jpg')
          and bool_and((image->>'contentSha256') ~ '^[a-f0-9]{64}$')
         from jsonb_array_elements(v_transport) transport(image)
     ) is not true
     or (
       select count(distinct image->>'approvedObjectPath') = 8
          and count(distinct image->>'approvedSourceSha256') = 8
          and count(distinct image->>'role') = 8
          and bool_and((image->>'role') ~ '^detail-[a-z0-9-]+$')
          and bool_and((image->>'approvedObjectPath') ~
                '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$')
          and bool_and((image->>'approvedSourceSha256') ~ '^[a-f0-9]{64}$')
         from jsonb_array_elements(v_details) details(image)
     ) is not true
     or exists (
       select 1
         from jsonb_array_elements(v_details) with ordinality
              detail(image, ordinal)
        where detail.image->>'role' is distinct from
                v_transport#>>array[detail.ordinal::text, 'role']
           or detail.image->>'publicUrl' is distinct from
                v_transport#>>array[detail.ordinal::text, 'publicUrl']
           or detail.image->>'objectPath' is distinct from
                v_transport#>>array[detail.ordinal::text, 'objectPath']
           or detail.image->>'contentSha256' is distinct from
                v_transport#>>array[detail.ordinal::text, 'contentSha256']
           or v_transport#>array[
                detail.ordinal::text, 'approvedObjectPath'
              ] is not null
           or v_transport#>array[
                detail.ordinal::text, 'approvedSourceSha256'
              ] is not null
     )
  then
    return false;
  end if;

  return coalesce(exists (
    select 1
      from sellerpilot_private.channel_operation_attempts attempt
      join sellerpilot_private.product_listings listing
        on listing.id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and listing.owner_id = attempt.owner_id
       and listing.product_id =
             'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = attempt.channel
       and listing.market = 'US'
       and listing.target_id = 'EBAY_US'
       and listing.remote_id = '800551945442'
     where attempt.id = p_attempt_id
       and attempt.channel = 'ebay'
       and attempt.operation = 'listing.update'
       and attempt.request_fingerprint =
             '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
       and attempt.gateway_write_required
       and attempt.seller_account_key = listing.seller_account_key
       and (
         select count(*)
           from sellerpilot_private.marketplace_normalized_asset_refs raw_ref
          where raw_ref.attempt_id = attempt.id
       ) = 9
       and (
         select count(*) = 9
            and count(distinct ref.object_path) = 9
            and count(distinct ref.canonical_public_url) = 9
            and count(*) filter (
                  where ref.source_object_path is not null
                    and ref.source_content_sha256 is not null
                ) = 9
            and count(*) filter (
                  where (ref.source_object_path is null) <>
                        (ref.source_content_sha256 is null)
                ) = 0
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
            and ref.owner_id = listing.owner_id
            and ref.product_id = listing.product_id
            and ref.channel = 'ebay'
            and ref.market = 'US'
            and ref.target_id = 'EBAY_US'
            and ref.upload_confirmed_at is not null
            and ref.canonical_public_url ~
                  '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}[.]jpg$'
            and pg_catalog.right(
                  ref.canonical_public_url,
                  pg_catalog.length(ref.object_path) + 1
                ) = '/' || ref.object_path
       )
       and not exists (
         select 1
           from jsonb_array_elements(v_transport) transport(image)
          where not exists (
            select 1
              from sellerpilot_private.marketplace_normalized_asset_refs ref
              join sellerpilot_private.marketplace_normalized_assets asset
                on asset.object_path = ref.object_path
             where ref.attempt_id = attempt.id
               and ref.object_path = transport.image->>'objectPath'
               and ref.canonical_public_url = transport.image->>'publicUrl'
               and asset.content_sha256 = transport.image->>'contentSha256'
          )
       )
       and exists (
         select 1
           from sellerpilot_private.marketplace_normalized_asset_refs ref
          where ref.attempt_id = attempt.id
            and ref.object_path = v_transport#>>'{0,objectPath}'
            and ref.canonical_public_url = v_transport#>>'{0,publicUrl}'
            and ref.source_object_path =
                  v_transport#>>'{0,approvedObjectPath}'
            and ref.source_content_sha256 =
                  v_transport#>>'{0,approvedSourceSha256}'
       )
       and not exists (
         select 1
           from jsonb_array_elements(v_details) detail(image)
          where not exists (
            select 1
              from sellerpilot_private.marketplace_normalized_asset_refs ref
             where ref.attempt_id = attempt.id
               and ref.object_path = detail.image->>'objectPath'
               and ref.canonical_public_url = detail.image->>'publicUrl'
               and ref.source_object_path =
                     detail.image->>'approvedObjectPath'
               and ref.source_content_sha256 =
                     detail.image->>'approvedSourceSha256'
          )
       )
  ), false);
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
    uuid, jsonb
  ) from public, anon, authenticated, service_role;

alter function
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ) rename to exact_existing_update_enqueue_before_ebay_asset_107000;

create function
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    p_listing_id uuid,
    p_credential_id uuid,
    p_attempt_id uuid,
    p_channel text,
    p_operation text,
    p_request_payload jsonb
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_predecessor_allowed boolean;
begin
  v_predecessor_allowed :=
    sellerpilot_private.exact_existing_update_enqueue_before_ebay_asset_107000(
      p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
      p_request_payload
    );

  if p_channel <> 'ebay'
     or p_request_payload#>>
          '{arguments,sellerpilotEbayExactV101ContentContract,contract}'
          is distinct from 'ebay_exact_v101_content_contract_v1'
  then
    return v_predecessor_allowed;
  end if;

  return coalesce(
    v_predecessor_allowed
    and p_operation = 'listing.update'
    and p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
    and p_request_payload#>>'{arguments,publicationExpectedFingerprint}' =
          '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
    and sellerpilot_private.ebay_exact_current_credential_is_valid(
          p_credential_id,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        )
    and sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
          p_attempt_id, p_request_payload
        )
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
        join sellerpilot_private.product_listings listing
          on listing.id = p_listing_id
         and listing.owner_id = attempt.owner_id
         and listing.product_id =
               'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and listing.channel_key = attempt.channel
         and listing.market = 'US'
         and listing.target_id = 'EBAY_US'
         and listing.remote_id = '800551945442'
        join sellerpilot_private.marketplace_normalized_asset_refs ref
          on ref.attempt_id = attempt.id
         and ref.owner_id = listing.owner_id
         and ref.product_id = listing.product_id
         and ref.channel = 'ebay'
         and ref.market = 'US'
         and ref.target_id = 'EBAY_US'
         and ref.upload_confirmed_at is not null
         and ref.canonical_public_url ~
               '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}[.]jpg$'
         and pg_catalog.right(
               ref.canonical_public_url,
               pg_catalog.length(ref.object_path) + 1
             ) = '/' || ref.object_path
        join sellerpilot_private.marketplace_normalized_assets asset
          on asset.object_path = ref.object_path
         and asset.content_sha256 = pg_catalog.substring(
               ref.object_path,
               '^normalized/[0-9a-f]{2}/([0-9a-f]{64})[.]jpg$'
             )
         and asset.status = 'available'
         and asset.uploaded_at is not null
       where attempt.id = p_attempt_id
         and attempt.credential_id = p_credential_id
         and attempt.channel = 'ebay'
         and attempt.operation = 'listing.update'
         and attempt.status = 'running'
         and attempt.request_fingerprint =
               '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
         and attempt.gateway_write_required
         and attempt.seller_account_key = listing.seller_account_key
       having count(*) = 9
          and count(distinct ref.object_path) = 9
          and count(distinct ref.canonical_public_url) = 9
          and count(*) filter (
                where ref.source_object_path is not null
                  and ref.source_content_sha256 is not null
              ) = 9
          and count(*) filter (
                where (ref.source_object_path is null) <>
                      (ref.source_content_sha256 is null)
              ) = 0
          and count(*) filter (
                where ref.object_path =
                  'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
              ) = 1
    ),
    false
  );
exception when others then
  return false;
end;
$$;

alter function
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)
  rename to exact_existing_update_enqueued_before_ebay_asset_107000;

create function
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
    p_permit_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.permit_id = p_permit_id
       and permit.channel = 'ebay'
       and permit.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and permit.remote_id = '800551945442'
  ) then
    sellerpilot_private.exact_existing_update_enqueued_before_ebay_asset_107000(
      p_permit_id
    )
    and exists (
      select 1
        from sellerpilot_private.exact_existing_update_permits permit
        join sellerpilot_private.channel_gateway_jobs job
          on job.id = permit.update_job_id
         and job.attempt_id = permit.update_attempt_id
         and job.listing_id = permit.listing_id
         and job.credential_id = permit.credential_id
         and job.channel = permit.channel
         and job.operation = 'listing.update'
         and job.request_fingerprint = permit.request_fingerprint
       where permit.permit_id = p_permit_id
         and permit.request_fingerprint =
               '4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e'
         and sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
               job.attempt_id, job.request_payload
             )
    )
  else
    sellerpilot_private.exact_existing_update_enqueued_before_ebay_asset_107000(
      p_permit_id
    )
  end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_enqueue_before_ebay_asset_107000(
    uuid, uuid, uuid, text, text, jsonb
  ),
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ),
  sellerpilot_private.exact_existing_update_enqueued_before_ebay_asset_107000(
    uuid
  ),
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
    uuid
  ) from public, anon, authenticated, service_role;

do $ebay_exact_prearm_image_postimage$
declare
  v_proof text;
  v_enqueue text;
  v_enqueued text;
  v_public_enqueue text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure
  ) into strict v_proof;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into strict v_enqueue;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)'::regprocedure
  ) into strict v_enqueued;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into strict v_public_enqueue;

  if pg_catalog.strpos(v_proof, 'asset_attempt.status = ''failed''') = 0
     or pg_catalog.strpos(v_proof, 'ref.attempt_id = asset_attempt.id') = 0
     or pg_catalog.strpos(v_proof, 'except') = 0
     or pg_catalog.strpos(v_enqueue, 'count(*) = 9') = 0
     or pg_catalog.strpos(v_enqueue, 'count(*) filter') = 0
     or pg_catalog.strpos(
          v_enqueue, 'ebay_exact_v101_fresh_asset_refs_are_current'
        ) = 0
     or pg_catalog.strpos(
          v_enqueued, 'ebay_exact_v101_fresh_asset_refs_are_current'
        ) = 0
     or pg_catalog.strpos(
          v_enqueue,
          'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
        ) = 0
     or pg_catalog.strpos(
          v_public_enqueue,
          '''079cd680-47fb-4910-b3d8-27d19356e66e''::uuid'
        ) = 0
  then
    raise exception 'eBay exact pre-arm image postimage invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      join pg_catalog.aclexplode(coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )) privilege on true
      left join pg_catalog.pg_roles grantee
        on grantee.oid = privilege.grantee
     where namespace.nspname = 'sellerpilot_private'
       and procedure.proname in (
         'ebay_exact_v101_fresh_asset_refs_are_current',
         'exact_existing_update_enqueue_before_ebay_asset_107000',
         'exact_existing_update_enqueue_gate_bypass_allowed',
         'exact_existing_update_enqueued_before_ebay_asset_107000',
         'exact_existing_update_enqueued_lineage_is_current'
       )
       and privilege.privilege_type = 'EXECUTE'
       and coalesce(grantee.rolname, 'PUBLIC') in (
         'PUBLIC', 'anon', 'authenticated', 'service_role'
       )
  ) then
    raise exception 'eBay exact pre-arm image function privilege drift'
      using errcode = '55000';
  end if;
end;
$ebay_exact_prearm_image_postimage$;

comment on function
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ) is
  'Requires a fresh exact-attempt nine-image Storage readback ledger before eBay item 800551945442 can enqueue; all other channels delegate unchanged.';

comment on function
  sellerpilot_private.ebay_exact_v101_fresh_asset_refs_are_current(
    uuid, jsonb
  ) is
  'Requires exact set equality between the fresh eBay attempt ledger and its one representative plus eight approved source-bound payload images.';

commit;
