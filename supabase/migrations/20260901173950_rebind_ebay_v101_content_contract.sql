-- Forward-only rebind for the exact eBay v101 content correction. The prior
-- 173700 permit was fingerprinted before the final buyer-visible Material and
-- nine-image contracts existed. This migration never creates a gateway job or
-- calls eBay. It binds that one still-unconsumed permit to the new request,
-- strengthens both database content fences, and leaves the global gate closed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000004);

create function sellerpilot_private.ebay_exact_v101_content_arguments_valid(
  p_arguments jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_arguments) = 'object'
    and p_arguments->>'publicationExpectedFingerprint' =
          'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
    and jsonb_typeof(
          p_arguments->'sellerpilotEbayExactV101ContentContract'
        ) = 'object'
    and p_arguments#>>'{sellerpilotEbayExactV101ContentContract,contract}' =
          'ebay_exact_v101_content_contract_v1'
    and p_arguments#>>'{sellerpilotEbayExactV101ContentContract,materialSource}' =
          'ABS 플라스틱'
    and p_arguments#>>'{sellerpilotEbayExactV101ContentContract,materialTarget}' =
          'ABS Plastic'
    and p_arguments#>>'{sellerpilotEbayExactV101ContentContract,inventoryImageCount}' = '9'
    and p_arguments#>>'{sellerpilotEbayExactV101ContentContract,detailImageCount}' = '8'
    and (
      select count(*)
        from jsonb_object_keys(
          p_arguments->'sellerpilotEbayExactV101ContentContract'
        )
    ) = 5
    and jsonb_typeof(
          p_arguments#>'{inventoryItem,product,imageUrls}'
        ) = 'array'
    and jsonb_array_length(
          p_arguments#>'{inventoryItem,product,imageUrls}'
        ) = 9
    and p_arguments#>>'{inventoryItem,product,imageUrls,0}' ~
          '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a[.]jpg$'
    and (
      select count(distinct image_url)
        from jsonb_array_elements_text(
          p_arguments#>'{inventoryItem,product,imageUrls}'
        ) as images(image_url)
    ) = 9
    and jsonb_typeof(p_arguments->'sellerpilotPublicationAssetBinding') =
          'object'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,contract}' =
          'sellerpilot_publication_asset_binding_v1'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerImageSurface}' =
          'gallery'
    and jsonb_typeof(
          p_arguments#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'
        ) = 'array'
    and jsonb_array_length(
          p_arguments#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'
        ) = 8
    and jsonb_typeof(
          p_arguments#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'
        ) = 'array'
    and jsonb_array_length(
          p_arguments#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'
        ) = 9
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,role}' =
          'gallery-representative'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,publicUrl}' =
          p_arguments#>>'{inventoryItem,product,imageUrls,0}'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,objectPath}' =
          'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,contentSha256}' =
          '292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedObjectPath}' ~
          '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
    and p_arguments#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,approvedSourceSha256}' ~
          '^[a-f0-9]{64}$'
    and not exists (
      select 1
        from jsonb_array_elements(
          p_arguments#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'
        ) with ordinality as transport(image, position)
       where p_arguments#>>array[
               'inventoryItem', 'product', 'imageUrls',
               (transport.position - 1)::text
             ] is distinct from pg_catalog.jsonb_extract_path_text(
               transport.image::jsonb, 'publicUrl'
             )
          or pg_catalog.jsonb_extract_path_text(
               transport.image::jsonb, 'publicUrl'
             ) !~ '^https://'
          or pg_catalog.jsonb_extract_path_text(
               transport.image::jsonb, 'contentSha256'
             ) !~ '^[a-f0-9]{64}$'
          or pg_catalog.jsonb_extract_path_text(
               transport.image::jsonb, 'objectPath'
             ) is distinct from
               'normalized/' ||
               left(pg_catalog.jsonb_extract_path_text(
                 transport.image::jsonb, 'contentSha256'
               ), 2) || '/' ||
               pg_catalog.jsonb_extract_path_text(
                 transport.image::jsonb, 'contentSha256'
               ) || '.jpg'
          or (
            transport.position > 1
            and (
              pg_catalog.jsonb_extract_path_text(
                transport.image::jsonb, 'role'
              ) is distinct from
                   p_arguments#>>array[
                     'sellerpilotPublicationAssetBinding',
                     'approvedDetailImages', (transport.position - 2)::text,
                     'role'
                   ]
              or pg_catalog.jsonb_extract_path_text(
                   transport.image::jsonb, 'publicUrl'
                 ) is distinct from
                   p_arguments#>>array[
                     'sellerpilotPublicationAssetBinding',
                     'approvedDetailImages', (transport.position - 2)::text,
                     'publicUrl'
                   ]
              or pg_catalog.jsonb_extract_path_text(
                   transport.image::jsonb, 'objectPath'
                 ) is distinct from
                   p_arguments#>>array[
                     'sellerpilotPublicationAssetBinding',
                     'approvedDetailImages', (transport.position - 2)::text,
                     'objectPath'
                   ]
              or pg_catalog.jsonb_extract_path_text(
                   transport.image::jsonb, 'contentSha256'
                 ) is distinct from
                   p_arguments#>>array[
                     'sellerpilotPublicationAssetBinding',
                     'approvedDetailImages', (transport.position - 2)::text,
                     'contentSha256'
                   ]
              or p_arguments#>>array[
                   'sellerpilotPublicationAssetBinding',
                   'approvedDetailImages', (transport.position - 2)::text,
                   'approvedObjectPath'
                 ] !~
                   '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
              or p_arguments#>>array[
                   'sellerpilotPublicationAssetBinding',
                   'approvedDetailImages', (transport.position - 2)::text,
                   'approvedSourceSha256'
                 ] !~ '^[a-f0-9]{64}$'
            )
          )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)
  from public, anon, authenticated, service_role;

do $patch_exact_ebay_v101_argument_contract$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_surface_anchor constant text := $old$
     or v_assets->>'providerImageSurface' is distinct from 'detail_content'
     or jsonb_typeof(v_assets->'approvedDetailImages')
          is distinct from 'array'$old$;
  v_surface_replacement constant text := $new$
     or (
       p_channel = 'ebay'
       and v_assets->>'providerImageSurface' is distinct from 'gallery'
     )
     or (
       p_channel <> 'ebay'
       and v_assets->>'providerImageSurface' is distinct from 'detail_content'
     )
     or jsonb_typeof(v_assets->'approvedDetailImages')
          is distinct from 'array'$new$;
  v_transport_count_anchor constant text := $old$
     or jsonb_array_length(v_assets->'providerTransportImages') <> 8$old$;
  v_transport_count_replacement constant text := $new$
     or jsonb_array_length(v_assets->'providerTransportImages') <>
          (case when p_channel = 'ebay' then 9 else 8 end)$new$;
  v_anchor constant text := $old$
      and jsonb_typeof(v_inventory_product->'imageUrls') = 'array'
      and jsonb_array_length(v_inventory_product->'imageUrls') = 1
      and p_arguments#>>'{inventoryItem,condition}' = 'NEW'$old$;
  v_replacement constant text := $new$
      and p_request_fingerprint =
            'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
      and sellerpilot_private.ebay_exact_v101_content_arguments_valid(
            p_arguments
          )
      and p_arguments#>>'{inventoryItem,condition}' = 'NEW'$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       (
         pg_catalog.length(v_definition)
         - pg_catalog.length(pg_catalog.replace(
             v_definition, v_surface_anchor, ''
           ))
       ) / pg_catalog.length(v_surface_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_transport_count_anchor, ''
         ))
     ) / pg_catalog.length(v_transport_count_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
     ) / pg_catalog.length(v_anchor) <> 1
     or pg_catalog.strpos(
          v_definition, 'sellerpilotEbayExactV101ContentContract'
        ) <> 0
  )
  then
    raise exception 'eBay v101 argument contract preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_surface_anchor, v_surface_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_transport_count_anchor, v_transport_count_replacement
  );
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_v101_content_arguments_valid'
        ) = 0
     or pg_catalog.strpos(v_definition, 'jsonb_array_length') = 0
     or pg_catalog.strpos(
          v_definition, 'case when p_channel = ''ebay'' then 9 else 8 end'
        ) = 0
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_language language
           on language.oid = procedure.prolang
        where procedure.oid = v_signature
          and not procedure.prosecdef
          and procedure.provolatile = 'i'
          and procedure.prokind = 'f'
          and procedure.proconfig = array['search_path=""']::text[]
          and language.lanname = 'plpgsql'
     )
  then
    raise exception 'eBay v101 argument contract postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_exact_ebay_v101_argument_contract$;

do $patch_exact_ebay_v101_enqueue_contract$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_locale_anchor constant text := $old$
       or p_request_payload#>>'{arguments,publicationExpectedImageCount}' is distinct from
         '8'
       or p_request_payload#>>'{arguments,inventoryItem,condition}' is distinct from
         'NEW'$old$;
  v_locale_replacement constant text := $new$
       or p_request_payload#>>'{arguments,publicationExpectedImageCount}' is distinct from
         '8'
       or not sellerpilot_private.ebay_exact_v101_content_arguments_valid(
            p_request_payload->'arguments'
          )
       or p_request_payload#>>'{arguments,inventoryItem,condition}' is distinct from
         'NEW'$new$;
  v_image_anchor constant text := $old$
    if v_image_count <> 1
       or v_unique_image_count <> 1
       or not v_all_https then$old$;
  v_image_replacement constant text := $new$
    if p_request_payload#>>'{arguments,inventoryItem,product,imageUrls,0}' !~
         '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a[.]jpg$'
       or v_image_count <> 9
       or v_unique_image_count <> 9
       or not v_all_https then$new$;
  v_surface_anchor constant text := $old$
       or p_request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,providerImageSurface}' is distinct from
         'detail_content'$old$;
  v_surface_replacement constant text := $new$
       or p_request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,providerImageSurface}' is distinct from
         'gallery'$new$;
  v_transport_count_anchor constant text := $old$
       or jsonb_array_length(
         p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
       ) <> 8$old$;
  v_transport_count_replacement constant text := $new$
       or jsonb_array_length(
         p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
       ) <> 9$new$;
  v_detail_scan_anchor constant text := $old$
      from jsonb_array_elements(
        p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
      ) as detail_images(image);$old$;
  v_detail_scan_replacement constant text := $new$
      from jsonb_array_elements(
        p_request_payload#>'{arguments,sellerpilotPublicationAssetBinding,providerTransportImages}'
      ) with ordinality as detail_images(image, position)
     where detail_images.position > 1;$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if (
       (
         pg_catalog.length(v_definition)
         - pg_catalog.length(pg_catalog.replace(
             v_definition, v_locale_anchor, ''
           ))
     ) / pg_catalog.length(v_locale_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_image_anchor, ''
         ))
     ) / pg_catalog.length(v_image_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_surface_anchor, ''
         ))
     ) / pg_catalog.length(v_surface_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_transport_count_anchor, ''
         ))
     ) / pg_catalog.length(v_transport_count_anchor) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_detail_scan_anchor, ''
         ))
     ) / pg_catalog.length(v_detail_scan_anchor) <> 1
     or pg_catalog.strpos(
          v_definition, 'sellerpilotEbayExactV101ContentContract'
        ) <> 0
  )
  then
    raise exception 'eBay v101 enqueue contract preimage mismatch'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition, v_locale_anchor, v_locale_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_image_anchor, v_image_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_surface_anchor, v_surface_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_transport_count_anchor, v_transport_count_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition, v_detail_scan_anchor, v_detail_scan_replacement
  );
  execute v_definition;

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_v101_content_arguments_valid'
        ) = 0
     or pg_catalog.strpos(v_definition, 'v_image_count <> 9') = 0
     or pg_catalog.strpos(v_definition, 'detail_images.position > 1') = 0
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
    raise exception 'eBay v101 enqueue contract postimage mismatch'
      using errcode = '55000';
  end if;
end;
$patch_exact_ebay_v101_enqueue_contract$;

create function sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
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
    p_credential_id = 'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
    and p_request_fingerprint =
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
         and current_credential.seller_account_key = listing.seller_account_key
       where listing.id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
         and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and listing.channel_key = 'ebay'
         and listing.status = 'failed'
         and listing.failure_class = 'retryable'
         and listing.operation_attempt_id = attempt.id
         and listing.remote_id = '800551945442'
         and listing.market = 'US' and listing.target_id = 'EBAY_US'
         and listing.marketplace_sku = 'QA-20260823-CC-001-US'
         and listing.provider_resource_id = '244042196011'
         and listing.currency = 'USD' and listing.price = 12.90
         and listing.requested_publication_intent = 'live'
         and listing.seller_account_key =
               'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
         and product.sku = 'QA-20260823-CC-001'
         and product.on_hand = permit.stock
         and product.on_hand between 1 and 999999
         and not product.demo and product.status <> 'archived'
         and attempt.operation = 'listing.update'
         and attempt.request_fingerprint =
               'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
         and attempt.status = 'failed' and attempt.http_status = 422
         and attempt.remote_id is null
         and attempt.gateway_write_required and attempt.pre_gateway_retryable
         and current_credential.environment = 'production'
         and current_credential.status = 'active'
         and current_credential.version = 101
         and current_credential.fingerprint = 'BEEF134012FD'
         and current_credential.seller_account_key_source = 'provider_certified_v1'
         and current_credential.seller_account_verified_at is not null
         and current_credential.expires_at > statement_timestamp()
         and current_credential.last_checked_at is not null
         and current_credential.last_check_status = 'passed'
         and permit.channel = 'ebay'
         and permit.market = 'US' and permit.target_id = 'EBAY_US'
         and permit.remote_id = '800551945442'
         and permit.seller_sku = 'QA-20260823-CC-001-US'
         and permit.provider_resource_id = '244042196011'
         and permit.currency = 'USD' and permit.price = 12.90
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
         and permit.update_job_id is null and permit.update_attempt_id is null
         and permit.arguments_sha256 is null and permit.arguments_bytes is null
         and permit.request_payload_sha256 is null
         and permit.request_payload_bytes is null
         and permit.bound_at is null and permit.bound_worker_token_id is null
         and permit.bound_claim_token is null and permit.consumed_at is null
         and permit.invalidated_at is null and permit.invalidation_reason is null
         and permit.expires_at <= statement_timestamp()
         and source_job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and source_job.attempt_id = source_attempt.id
         and source_job.listing_id = listing.id
         and source_job.channel = 'ebay'
         and source_job.operation = 'listing.update'
         and source_job.environment = 'production'
         and source_job.status = 'succeeded'
         and source_job.response_payload->>'ok' = 'false'
         and source_job.response_payload#>>'{steps,3,data,errors,0,errorId}' = '25718'
         and not jsonb_path_exists(
               source_job.response_payload,
               '$.steps[*] ? (@.name == "offer-update")'
             )
         and source_attempt.id = '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
         and source_attempt.status = 'failed'
         and source_attempt.http_status = 400
         and source_attempt.remote_id = '800551945442'
         and source_attempt.gateway_write_required
         and not source_attempt.pre_gateway_retryable
         and source_permit.update_job_id = source_job.id
         and source_permit.update_attempt_id = source_attempt.id
         and source_permit.bound_at is not null
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
              and ref.market = 'US' and ref.target_id = 'EBAY_US'
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
              and ref.market = 'US' and ref.target_id = 'EBAY_US'
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
                    'ebay_exact_v101_content_contract_rearmed'
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

do $patch_exact_ebay_v101_permit_transition$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_anchor constant text := E'begin\n';
  v_transition constant text := $new$begin
  if old.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.request_fingerprint =
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
     and new.request_fingerprint = old.request_fingerprint
     and old.credential_id in (
           '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid,
           'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
         )
     and new.credential_id = 'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
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
          and credential.seller_account_key_source = 'provider_certified_v1'
          and credential.seller_account_verified_at = new.credential_verified_at
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
  if (
       (
         pg_catalog.length(v_definition)
         - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
     ) / pg_catalog.length(v_anchor) <> 1
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_v101_content_contract_rearmed'
        ) <> 0
  )
  then
    raise exception 'eBay v101 permit transition preimage mismatch'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_transition);

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;
  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(
          v_definition,
          'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
        ) = 0
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
$patch_exact_ebay_v101_permit_transition$;

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
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917000004);

  if p_channel is distinct from 'ebay'
     or p_listing_id is distinct from
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or p_credential_id is distinct from
          'f78397ec-c387-48ec-b562-64e754d90ac5'::uuid
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint is distinct from
          'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
     or not sellerpilot_private.exact_existing_update_release_is_current(
          'ebay', p_release_sha
        )
  then
    raise exception 'eBay v101 content retry identity invalid'
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
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = 101
     and credential.fingerprint = 'BEEF134012FD'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.expires_at > statement_timestamp()
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
   for share of listing, credential;
  if not found then
    raise exception 'eBay v101 content retry credential invalid'
      using errcode = '55000';
  end if;

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and permit.channel = 'ebay'
     and permit.listing_id = p_listing_id
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
    raise exception 'eBay v101 content retry permit unavailable'
      using errcode = '55000';
  end if;

  if v_permit.expires_at > statement_timestamp() then
    if v_permit.credential_id is distinct from p_credential_id
       or v_permit.release_sha is distinct from p_release_sha
       or not exists (
         select 1
           from sellerpilot_private.operation_audit audit
          where audit.action = 'ebay_exact_v101_content_contract_rearmed'
            and audit.entity_type = 'exact_existing_update_permit'
            and audit.entity_id = v_permit.permit_id::text
       )
    then
      raise exception 'eBay v101 content retry permit identity mismatch'
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
    raise exception 'eBay v101 content retry proof invalid'
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
     and permit.request_fingerprint = p_request_fingerprint
     and permit.expires_at <= statement_timestamp()
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.bound_at is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
  returning * into v_permit;
  if not found then
    raise exception 'eBay v101 content retry rearm lost race'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    v_owner_id,
    'ebay_exact_v101_content_contract_rearmed',
    'exact_existing_update_permit',
    v_permit.permit_id::text,
    jsonb_build_object(
      'contract', 'ebay_exact_v101_content_contract_v1',
      'listingId', p_listing_id,
      'attemptSourceId', 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid,
      'permitId', v_permit.permit_id,
      'credentialId', p_credential_id,
      'credentialVersion', v_version,
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
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_arm_ebay_no_effect_retry(
    text, uuid, uuid, text, text
  ) to service_role;

do $rebind_existing_exact_ebay_v101_permit$
declare
  v_owner_id uuid;
  v_rows integer;
begin
  if not exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
  ) then
    return;
  end if;

  select permit.owner_id into v_owner_id
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and permit.channel = 'ebay'
     and permit.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and permit.request_fingerprint =
           'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
     and permit.update_job_id is null and permit.update_attempt_id is null
     and permit.arguments_sha256 is null and permit.arguments_bytes is null
     and permit.request_payload_sha256 is null
     and permit.request_payload_bytes is null
     and permit.bound_at is null and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null and permit.consumed_at is null
     and permit.invalidated_at is null and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp()
   for update;
  if not found then
    raise exception 'eBay v101 content permit preimage unavailable'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and job.operation in ('listing.create', 'listing.update', 'listing.stop')
       and job.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'eBay v101 content permit cannot rebind with unsafe job'
      using errcode = '55000';
  end if;

  alter table sellerpilot_private.exact_existing_update_permits
    disable trigger guard_exact_existing_update_permit_transition;
  update sellerpilot_private.exact_existing_update_permits permit
     set request_fingerprint =
           'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
   where permit.permit_id = '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid
     and permit.request_fingerprint =
           'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2'
     and permit.update_job_id is null and permit.update_attempt_id is null
     and permit.arguments_sha256 is null and permit.arguments_bytes is null
     and permit.request_payload_sha256 is null
     and permit.request_payload_bytes is null
     and permit.bound_at is null and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null and permit.consumed_at is null
     and permit.invalidated_at is null and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp();
  get diagnostics v_rows = row_count;
  alter table sellerpilot_private.exact_existing_update_permits
    enable trigger guard_exact_existing_update_permit_transition;
  if v_rows <> 1 then
    raise exception 'eBay v101 content permit rebind lost race'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner_id,
    'ebay_exact_v101_content_contract_rebound',
    'exact_existing_update_permit',
    '7ae83178-d335-4b7e-8e35-2f55e905bbde',
    jsonb_build_object(
      'contract', 'ebay_exact_v101_content_contract_v1',
      'listingId', '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid,
      'permitId', '7ae83178-d335-4b7e-8e35-2f55e905bbde'::uuid,
      'baseRequestFingerprint',
        'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2',
      'requestFingerprint',
        'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231',
      'material', 'ABS Plastic',
      'inventoryImageCount', 9,
      'detailImageCount', 8,
      'gatewayJobCount', 0,
      'providerMutationCount', 0
    )
  );
end;
$rebind_existing_exact_ebay_v101_permit$;

do $ebay_exact_v101_content_postimage$
declare
  v_contract_definition text;
  v_arguments_definition text;
  v_enqueue_definition text;
  v_transition_definition text;
  v_arm_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)'::regprocedure
  ) into v_contract_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure
  ) into v_arguments_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
  ) into v_transition_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into v_arm_definition;

  if pg_catalog.strpos(v_contract_definition,
       'ebay_exact_v101_content_contract_v1') = 0
     or pg_catalog.strpos(v_contract_definition,
          'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
        ) = 0
     or pg_catalog.strpos(v_contract_definition,
          'gallery-representative') = 0
     or pg_catalog.strpos(v_arguments_definition,
          'ebay_exact_v101_content_arguments_valid') = 0
     or pg_catalog.strpos(v_enqueue_definition,
          'v_image_count <> 9') = 0
     or pg_catalog.strpos(v_enqueue_definition,
          'detail_images.position > 1') = 0
     or pg_catalog.strpos(v_enqueue_definition,
          'ebay_exact_v101_content_arguments_valid') = 0
     or pg_catalog.strpos(v_transition_definition,
          'bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231'
        ) = 0
     or pg_catalog.strpos(v_arm_definition,
          'ebay_exact_v101_content_contract_rearmed') = 0
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'execute'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'execute'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'execute'
        )
  then
    raise exception 'eBay v101 content contract postimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_v101_content_postimage$;

comment on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) is
  'Arms only the exact eBay item 800551945442 content correction on active credential v101, new request fingerprint, English Material, gallery nine and detail eight; it never calls the provider.';

commit;
