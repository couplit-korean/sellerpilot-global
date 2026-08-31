-- Admit one exact Smartstore existing-listing update through the otherwise
-- closed publication gate. The permit is armed by the authenticated admin
-- route, bound atomically to one newly queued job and one first worker claim,
-- and consumed immediately before the first provider mutation. No generic
-- Smartstore mutation is opened by this migration.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

create table sellerpilot_private.smartstore_exact_qa_update_permits (
  permit_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  origin_product_no text not null,
  channel_product_no text not null,
  seller_account_key text not null,
  release_sha text not null,
  request_fingerprint text not null,
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  update_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  update_attempt_id uuid unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  arguments_sha256 text,
  arguments_bytes integer,
  request_payload_sha256 text,
  request_payload_bytes integer,
  bound_at timestamptz,
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint smartstore_exact_qa_update_permit_target_check check (
    listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and origin_product_no = '13671684696'
    and channel_product_no = '13732202182'
    and seller_account_key =
      'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
    and release_sha ~ '^[a-f0-9]{40}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
    and expires_at > armed_at
    and expires_at <= armed_at + interval '5 minutes'
  ),
  constraint smartstore_exact_qa_update_permit_binding_check check (
    (
      invalidated_at is null and invalidation_reason is null
      and (
        (
          update_job_id is null and update_attempt_id is null
          and arguments_sha256 is null and arguments_bytes is null
          and request_payload_sha256 is null and request_payload_bytes is null
          and bound_at is null and bound_worker_token_id is null
          and bound_claim_token is null and consumed_at is null
        ) or (
          update_job_id is not null and update_attempt_id is not null
          and arguments_sha256 ~ '^[a-f0-9]{64}$'
          and arguments_bytes between 100 and 128000
          and request_payload_sha256 ~ '^[a-f0-9]{64}$'
          and request_payload_bytes between 100 and 128000
          and (
            (
              bound_at is null and bound_worker_token_id is null
              and bound_claim_token is null and consumed_at is null
            ) or (
              bound_at is not null and bound_worker_token_id is not null
              and bound_claim_token is not null
              and (consumed_at is null or consumed_at >= bound_at)
            )
          )
        )
      )
    ) or (
      invalidated_at is not null
      and invalidation_reason = 'expired_before_job'
      and update_job_id is null and update_attempt_id is null
      and arguments_sha256 is null and arguments_bytes is null
      and request_payload_sha256 is null and request_payload_bytes is null
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
    )
  )
);

create unique index smartstore_exact_qa_one_active_update_per_listing
  on sellerpilot_private.smartstore_exact_qa_update_permits(listing_id)
  where invalidated_at is null;

alter table sellerpilot_private.smartstore_exact_qa_update_permits
  enable row level security;
revoke all on sellerpilot_private.smartstore_exact_qa_update_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_exact_qa_release_is_current(
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_release_sha ~ '^[a-f0-9]{40}$'
    and sellerpilot_private.active_serverless_runtime_release_sha()
          = p_release_sha
    and exists (
      select 1
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
         and not gate.is_open
         and gate.opened_at is null
         and gate.opened_release_sha is null
         and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective(
      'smartstore'
    ),
    false
  )
$$;

create function sellerpilot_private.smartstore_exact_qa_html_image_urls(
  p_html text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_urls jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(pg_catalog.btrim(
           pg_catalog.replace(
             coalesce(matches[1], matches[2], matches[3]),
             '&amp;', '&'
           )
         )) order by ordinal), '[]'::jsonb)
    into v_urls
    from pg_catalog.regexp_matches(
      p_html,
      '<img[[:>:]][^>]*[[:<:]]src[[:>:]][[:space:]]*=[[:space:]]*(?:"([^"]+)"|''([^'']+)''|([^[:space:]>]+))',
      'gi'
    ) with ordinality as found(matches, ordinal)
   where pg_catalog.btrim(coalesce(matches[1], matches[2], matches[3])) <> '';
  return v_urls;
exception when others then
  return '[]'::jsonb;
end;
$$;

create function sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
  p_arguments jsonb,
  p_release_sha text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_marker jsonb := p_arguments->'sellerpilotSmartstoreExactQaRecovery';
  v_body jsonb := p_arguments->'body';
  v_origin jsonb := v_body->'originProduct';
  v_channel_product jsonb := v_body->'smartstoreChannelProduct';
  v_binding jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_approved jsonb := v_binding->'approvedDetailImages';
  v_transport jsonb := v_binding->'providerTransportImages';
  v_detail_urls jsonb;
  v_image_urls jsonb := p_arguments->'imageUrls';
  v_title text := coalesce(v_origin->>'name', '');
  v_channel_title text := coalesce(v_channel_product->>'channelProductName', '');
  v_description text := coalesce(v_origin->>'detailContent', '');
  v_image_count integer;
  v_image_unique_count integer;
  v_transport_count integer;
  v_transport_unique_count integer;
  v_approved_count integer;
  v_approved_unique_count integer;
  v_index integer;
  v_transport_item jsonb;
  v_approved_item jsonb;
begin
  if p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or jsonb_typeof(v_marker) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_marker)) <> 9
     or jsonb_typeof(v_body) is distinct from 'object'
     or jsonb_typeof(v_origin) is distinct from 'object'
     or jsonb_typeof(v_channel_product) is distinct from 'object'
     or jsonb_typeof(v_binding) is distinct from 'object'
     or jsonb_typeof(v_approved) is distinct from 'array'
     or jsonb_typeof(v_transport) is distinct from 'array'
     or jsonb_typeof(v_image_urls) is distinct from 'array'
  then return false; end if;

  v_detail_urls := sellerpilot_private.smartstore_exact_qa_html_image_urls(
    v_description
  );

  select count(*), count(distinct image.value#>>'{}')
    into v_image_count, v_image_unique_count
    from jsonb_array_elements(v_image_urls) as image(value);
  select count(*), count(distinct image.value->>'publicUrl')
    into v_transport_count, v_transport_unique_count
    from jsonb_array_elements(v_transport) as image(value);
  select count(*), count(distinct image.value->>'publicUrl')
    into v_approved_count, v_approved_unique_count
    from jsonb_array_elements(v_approved) as image(value);

  if v_image_count <> 9
     or v_image_unique_count <> 9
     or v_transport_count <> 9
     or v_transport_unique_count <> 9
     or v_approved_count <> 8
     or v_approved_unique_count <> 8
     or jsonb_array_length(v_detail_urls) <> 8
     or v_image_urls->>0 !~
          '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[a-f0-9]{2}/[a-f0-9]{64}[.]jpg$'
     or (v_transport->0->>'role') is distinct from 'gallery-representative'
     or (v_transport->0->>'publicUrl') is distinct from (v_image_urls->>0)
     or (v_transport->0->>'contentSha256') !~ '^[a-f0-9]{64}$'
     or (v_transport->0->>'objectPath') is distinct from
          'normalized/' || left((v_transport->0->>'contentSha256'), 2)
          || '/' || (v_transport->0->>'contentSha256') || '.jpg'
     or (v_transport->0->>'approvedObjectPath') !~
          '^results/[0-9a-f-]+/claims/[0-9a-f-]+/square[.]png$'
     or (v_transport->0->>'approvedSourceSha256') !~ '^[a-f0-9]{64}$'
  then return false; end if;

  for v_index in 0..7 loop
    v_transport_item := v_transport->(v_index + 1);
    v_approved_item := v_approved->v_index;
    if jsonb_typeof(v_transport_item) is distinct from 'object'
       or jsonb_typeof(v_approved_item) is distinct from 'object'
       or v_transport_item->>'role' is distinct from
            v_approved_item->>'role'
       or v_transport_item->>'publicUrl' is distinct from
            v_approved_item->>'publicUrl'
       or v_transport_item->>'objectPath' is distinct from
            v_approved_item->>'objectPath'
       or v_transport_item->>'contentSha256' is distinct from
            v_approved_item->>'contentSha256'
       or v_transport_item->>'role' !~ '^detail-[a-z0-9-]+$'
       or v_transport_item->>'contentSha256' !~ '^[a-f0-9]{64}$'
       or v_transport_item->>'objectPath' is distinct from
            'normalized/' || left((v_transport_item->>'contentSha256'), 2)
            || '/' || (v_transport_item->>'contentSha256') || '.jpg'
       or v_transport_item->>'publicUrl' !~
            '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[a-f0-9]{2}/[a-f0-9]{64}[.]jpg$'
       or v_approved_item->>'approvedObjectPath' !~
            '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
       or v_approved_item->>'approvedSourceSha256' !~ '^[a-f0-9]{64}$'
       or v_detail_urls->>v_index is distinct from
            v_transport_item->>'publicUrl'
       or v_image_urls->>(v_index + 1) is distinct from
            v_transport_item->>'publicUrl'
    then return false; end if;
  end loop;

  return v_marker->>'contract' is not distinct from
          'smartstore_exact_qa_recovery_v1'
    and v_marker->>'phase' is not distinct from 'listing.update'
    and v_marker->>'productId' is not distinct from
          'ddccde35-9c58-4856-b673-d7aa27ce4220'
    and v_marker->>'listingId' is not distinct from
          '7babb554-48dc-4869-81b1-cd4d435d7b96'
    and v_marker->>'originProductNo' is not distinct from '13671684696'
    and v_marker->>'channelProductNo' is not distinct from '13732202182'
    and v_marker->>'centralSku' is not distinct from 'QA-20260823-CC-001'
    and v_marker->>'sellerManagementCodeSource' is not distinct from
          'provider_readback_required'
    and v_marker->>'sellerAccountLineage' is not distinct from
          'validated_by_service_rpc'
    and p_arguments->>'originProductNo' is not distinct from '13671684696'
    and v_origin#>>'{detailAttribute,sellerCodeInfo,sellerManagementCode}'
          is not distinct from 'QA-20260823-CC-001'
    and v_origin->>'salePrice' is not distinct from '5000'
    and coalesce(v_origin->>'stockQuantity', '') ~ '^[1-9][0-9]{0,7}$'
    and length(pg_catalog.btrim(v_title)) between 2 and 100
    and length(pg_catalog.btrim(v_channel_title)) between 2 and 100
    and length(pg_catalog.btrim(v_description)) >= 20
    and v_title ~ '[가-힣]'
    and v_channel_title ~ '[가-힣]'
    and v_description ~ '[가-힣]'
    and p_arguments->>'publicationIntent' is not distinct from 'live'
    and p_arguments->>'publicationStateContract' is not distinct from
          'verified_remote_state_v1'
    and p_arguments->>'publicationExpectedLocale' is not distinct from 'ko-KR'
    and p_arguments->>'publicationExpectedImageCount' is not distinct from '8'
    and p_arguments->>'publicationExpectedFingerprint' ~ '^[a-f0-9]{64}$'
    and v_binding->>'contract' is not distinct from
          'sellerpilot_publication_asset_binding_v1'
    and v_binding->>'providerImageSurface' is not distinct from 'gallery'
    and (v_binding->>'approvedDetailPageVersion') ~ '^[1-9][0-9]*$'
    and v_binding->>'approvedManifestDigest' ~ '^[a-f0-9]{64}$';
exception when others then
  return false;
end;
$$;

create function public.sellerpilot_service_arm_exact_smartstore_qa_update(
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
  v_permit sellerpilot_private.smartstore_exact_qa_update_permits%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_listing_id is distinct from
       '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     or p_credential_id is distinct from
       '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.smartstore_exact_qa_release_is_current(
       p_release_sha
     )
     or not exists (
       select 1
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
          and product.sku = 'QA-20260823-CC-001'
          and not product.demo
          and listing.channel_key = 'smartstore'
          and listing.remote_id = '13671684696'
          and listing.marketplace_sku is null
          and listing.remote_resources = '{}'::jsonb
          and listing.status = 'failed'
          and listing.failure_class = 'external_action'
          and listing.requested_publication_intent = 'live'
          and listing.remote_visibility = 'unknown'
          and listing.provider_status is null
          and listing.published_at is null
          and listing.currency = 'KRW'
          and listing.price = 5000
          and listing.seller_account_key =
                'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
          and credential.status = 'active'
          and credential.environment = 'production'
          and credential.seller_account_key_source in (
            'provider_certified_v1', 'credential_incarnation_v1'
          )
          and credential.seller_account_verified_at is not null
          and (credential.expires_at is null
            or credential.expires_at > statement_timestamp())
     )
     or not exists (
       select 1
         from sellerpilot_private.product_category_assignments assignment
        where assignment.owner_id =
              '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and assignment.product_id =
              'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
          and assignment.channel = 'smartstore'
          and assignment.environment = 'production'
          and assignment.category_id = '50001578'
          and assignment.is_leaf
          and assignment.status = 'confirmed'
          and assignment.official_verified_at is not null
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = p_listing_id
          and (
            job.status in ('queued', 'running', 'reconciliation_required')
            or job.request_payload#>>
                 '{arguments,sellerpilotSmartstoreExactQaRecovery,contract}' =
                 'smartstore_exact_qa_recovery_v1'
          )
     )
  then
    raise exception 'exact Smartstore QA update permit identity invalid'
      using errcode = '55000';
  end if;

  update sellerpilot_private.smartstore_exact_qa_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.listing_id = p_listing_id
     and permit.invalidated_at is null
     and permit.update_job_id is null
     and permit.expires_at <= statement_timestamp();

  select * into v_permit
    from sellerpilot_private.smartstore_exact_qa_update_permits permit
   where permit.listing_id = p_listing_id
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.update_job_id is not null
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.expires_at <= statement_timestamp()
    then
      raise exception 'exact Smartstore QA update permit conflict'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', 'smartstore_exact_qa_update_permit_v1',
      'permitId', v_permit.permit_id,
      'listingId', v_permit.listing_id,
      'releaseSha', v_permit.release_sha,
      'requestFingerprint', v_permit.request_fingerprint,
      'armedAt', v_permit.armed_at,
      'expiresAt', v_permit.expires_at,
      'bound', false,
      'reused', true
    );
  end if;

  insert into sellerpilot_private.smartstore_exact_qa_update_permits (
    listing_id, product_id, credential_id, owner_id, origin_product_no,
    channel_product_no, seller_account_key, release_sha,
    request_fingerprint, armed_at, expires_at
  ) values (
    p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '13671684696',
    '13732202182',
    'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8',
    p_release_sha,
    p_request_fingerprint,
    clock_timestamp(),
    clock_timestamp() + interval '5 minutes'
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract', 'smartstore_exact_qa_update_permit_v1',
    'permitId', v_permit.permit_id,
    'listingId', v_permit.listing_id,
    'releaseSha', v_permit.release_sha,
    'requestFingerprint', v_permit.request_fingerprint,
    'armedAt', v_permit.armed_at,
    'expiresAt', v_permit.expires_at,
    'bound', false,
    'reused', false
  );
end;
$$;

create function sellerpilot_private.smartstore_exact_qa_enqueue_gate_bypass_allowed(
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
  v_arguments jsonb := p_request_payload->'arguments';
begin
  return coalesce(
    p_listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
    and p_credential_id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
    and p_channel = 'smartstore'
    and p_operation = 'listing.update'
    and jsonb_typeof(p_request_payload) = 'object'
    and jsonb_typeof(v_arguments) = 'object'
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
        join sellerpilot_private.smartstore_exact_qa_update_permits permit
          on permit.listing_id = p_listing_id
         and permit.product_id =
               'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and permit.credential_id = p_credential_id
         and permit.owner_id =
               '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and permit.origin_product_no = '13671684696'
         and permit.channel_product_no = '13732202182'
         and permit.seller_account_key =
               'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
         and permit.request_fingerprint = attempt.request_fingerprint
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.arguments_sha256 is null
         and permit.request_payload_sha256 is null
         and permit.bound_at is null
         and permit.consumed_at is null
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
         and sellerpilot_private.smartstore_exact_qa_release_is_current(
               permit.release_sha
             )
         and sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
               v_arguments, permit.release_sha
             )
       where attempt.id = p_attempt_id
         and attempt.owner_id = permit.owner_id
         and attempt.credential_id = p_credential_id
         and attempt.channel = 'smartstore'
         and attempt.operation = 'listing.update'
         and attempt.status = 'running'
         and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
         and v_arguments->>'publicationExpectedFingerprint' =
               attempt.request_fingerprint
    ),
    false
  );
exception when others then
  return false;
end;
$$;

do $patch_exact_smartstore_closed_gate_enqueue$
declare
  v_signature regprocedure;
  v_definition text;
  v_before text := $body$
     and not sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
       p_listing_id,
       p_credential_id,
       p_attempt_id,
       p_channel,
       p_operation,
       p_request_payload
     )$body$;
  v_after text := $body$
     and not sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
       p_listing_id,
       p_credential_id,
       p_attempt_id,
       p_channel,
       p_operation,
       p_request_payload
     )
     and not sellerpilot_private.smartstore_exact_qa_enqueue_gate_bypass_allowed(
       p_listing_id,
       p_credential_id,
       p_attempt_id,
       p_channel,
       p_operation,
       p_request_payload
     )$body$;
begin
  foreach v_signature in array array[
    'public.sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    if pg_catalog.strpos(
         v_definition,
         'smartstore_exact_qa_enqueue_gate_bypass_allowed'
       ) > 0 then
      continue;
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'exact Smartstore closed-gate enqueue patch target not found: %',
        v_signature using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end loop;
end;
$patch_exact_smartstore_closed_gate_enqueue$;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sp_09010535_enqueue_before_smartstore_permit;
revoke all on function public.sp_09010535_enqueue_before_smartstore_permit(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_marker jsonb :=
    p_request_payload#>'{arguments,sellerpilotSmartstoreExactQaRecovery}';
  v_permit sellerpilot_private.smartstore_exact_qa_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     or v_marker is not null
  then
    select * into v_permit
      from sellerpilot_private.smartstore_exact_qa_update_permits permit
     where permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.invalidated_at is null
       and permit.update_job_id is null
       and permit.expires_at > statement_timestamp()
     for update;
    if not found
       or p_listing_id is distinct from
            '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
       or p_credential_id is distinct from
            '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
       or p_channel is distinct from 'smartstore'
       or p_operation is distinct from 'listing.update'
       or not sellerpilot_private.smartstore_exact_qa_release_is_current(
            v_permit.release_sha
          )
       or not sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
            v_arguments, v_permit.release_sha
          )
       or v_arguments->>'publicationExpectedFingerprint' is distinct from
            v_permit.request_fingerprint
       or not exists (
         select 1
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = p_attempt_id
            and attempt.owner_id = v_permit.owner_id
            and attempt.credential_id = p_credential_id
            and attempt.channel = 'smartstore'
            and attempt.operation = 'listing.update'
            and attempt.status = 'running'
            and attempt.request_fingerprint = v_permit.request_fingerprint
       )
    then
      raise exception 'exact Smartstore QA update enqueue identity invalid'
        using errcode = '55000';
    end if;
  end if;

  v_result := public.sp_09010535_enqueue_before_smartstore_permit(
    p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
    p_request_payload
  );

  if v_marker is not null then
    if v_result->>'job_id' is null
       or v_result->>'job_id' !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_result->>'status' is distinct from 'queued'
    then
      raise exception 'exact Smartstore QA update job not newly queued'
        using errcode = '55000';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;
    update sellerpilot_private.smartstore_exact_qa_update_permits permit
       set update_job_id = v_job_id,
           update_attempt_id = p_attempt_id,
           arguments_sha256 = encode(
             extensions.digest(v_arguments::text, 'sha256'), 'hex'
           ),
           arguments_bytes = octet_length(v_arguments::text),
           request_payload_sha256 = encode(
             extensions.digest(p_request_payload::text, 'sha256'), 'hex'
           ),
           request_payload_bytes = octet_length(p_request_payload::text)
     where permit.permit_id = v_permit.permit_id
       and permit.update_job_id is null
       and permit.update_attempt_id is null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.id = v_job_id
            and job.attempt_id = p_attempt_id
            and job.listing_id = p_listing_id
            and job.credential_id = p_credential_id
            and job.channel = 'smartstore'
            and job.operation = 'listing.update'
            and job.environment = 'production'
            and job.status = 'queued'
            and job.attempt_count = 0
            and job.seller_account_key = permit.seller_account_key
            and job.request_fingerprint = permit.request_fingerprint
            and job.request_payload = p_request_payload
            and job.provider_mutation_started_at is null
            and job.response_payload is null
            and job.completed_at is null
       );
    if not found then
      raise exception 'exact Smartstore QA update job binding failed'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

create function sellerpilot_private.guard_smartstore_exact_qa_update_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker jsonb :=
    new.request_payload#>'{arguments,sellerpilotSmartstoreExactQaRecovery}';
begin
  if new.listing_id is distinct from
       '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     and v_marker is null
  then return new; end if;
  if new.listing_id is distinct from
       '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     or new.credential_id is distinct from
       '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
     or new.channel is distinct from 'smartstore'
     or new.operation is distinct from 'listing.update'
     or new.environment is distinct from 'production'
     or new.seller_account_key is distinct from
       'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
     or not exists (
       select 1
         from sellerpilot_private.smartstore_exact_qa_update_permits permit
        where permit.update_job_id = new.id
          and permit.update_attempt_id = new.attempt_id
          and permit.listing_id = new.listing_id
          and permit.credential_id = new.credential_id
          and permit.seller_account_key = new.seller_account_key
          and permit.request_fingerprint = new.request_fingerprint
          and permit.arguments_sha256 = encode(extensions.digest(
                (new.request_payload->'arguments')::text, 'sha256'
              ), 'hex')
          and permit.arguments_bytes = octet_length(
                (new.request_payload->'arguments')::text
              )
          and permit.request_payload_sha256 = encode(extensions.digest(
                new.request_payload::text, 'sha256'
              ), 'hex')
          and permit.request_payload_bytes =
                octet_length(new.request_payload::text)
          and permit.invalidated_at is null
          and sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
                new.request_payload->'arguments', permit.release_sha
              )
     )
  then
    raise exception 'exact Smartstore QA update job lineage invalid'
      using errcode = '55000';
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'exact Smartstore QA update job lineage invalid'
    using errcode = '55000';
end;
$$;

create constraint trigger guard_smartstore_exact_qa_update_job
after insert or update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function
  sellerpilot_private.guard_smartstore_exact_qa_update_job();

create function sellerpilot_private.bind_exact_smartstore_qa_update_claim(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_claim_token uuid;
  v_worker_token_id uuid;
begin
  if jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object'
  then return false; end if;
  v_job_id := (p_old->>'id')::uuid;
  v_claim_token := (p_new->>'claim_token')::uuid;
  v_worker_token_id := (p_new->>'worker_token_id')::uuid;
  if p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' is distinct from 'queued'
     or p_new->>'status' is distinct from 'running'
     or p_old->>'channel' is distinct from 'smartstore'
     or p_new->>'channel' is distinct from 'smartstore'
     or p_old->>'operation' is distinct from 'listing.update'
     or p_new->>'operation' is distinct from 'listing.update'
     or (p_old->>'attempt_count')::integer is distinct from 0
     or (p_new->>'attempt_count')::integer is distinct from 1
     or p_old->'worker_token_id' is distinct from 'null'::jsonb
     or p_old->'claim_token' is distinct from 'null'::jsonb
     or p_old->'lease_expires_at' is distinct from 'null'::jsonb
     or p_old->'started_at' is distinct from 'null'::jsonb
     or p_old->'completed_at' is distinct from 'null'::jsonb
     or p_old->'response_payload' is distinct from 'null'::jsonb
     or p_old->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'completed_at' is distinct from 'null'::jsonb
     or p_new->'response_payload' is distinct from 'null'::jsonb
     or p_new->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'error_message' is distinct from 'null'::jsonb
     or (p_new->>'started_at')::timestamptz is null
     or (p_new->>'lease_expires_at')::timestamptz <= statement_timestamp()
     or (p_new->>'lease_expires_at')::timestamptz >
          statement_timestamp() + interval '16 minutes'
     or p_new-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
        is distinct from
        p_old-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
  then return false; end if;

  update sellerpilot_private.smartstore_exact_qa_update_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = v_worker_token_id,
         bound_claim_token = v_claim_token
   where permit.update_job_id = v_job_id
     and permit.update_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.listing_id = (p_new->>'listing_id')::uuid
     and permit.credential_id = (p_new->>'credential_id')::uuid
     and permit.seller_account_key = p_new->>'seller_account_key'
     and permit.request_fingerprint = p_new->>'request_fingerprint'
     and permit.request_payload_sha256 = encode(extensions.digest(
           (p_new->'request_payload')::text, 'sha256'
         ), 'hex')
     and permit.request_payload_bytes = octet_length(
           (p_new->'request_payload')::text
         )
     and permit.invalidated_at is null
     and permit.consumed_at is null
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.expires_at > statement_timestamp()
     and sellerpilot_private.smartstore_exact_qa_release_is_current(
           permit.release_sha
         )
     and sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
           p_new->'request_payload'->'arguments', permit.release_sha
         );
  return found;
exception when others then
  return false;
end;
$$;

do $patch_exact_smartstore_closed_gate_claim$
declare
  v_definition text;
  v_before text := $body$
       or sellerpilot_private.bind_exact_qoo10_localization_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
  v_after text := $body$
       or sellerpilot_private.bind_exact_qoo10_localization_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_smartstore_qa_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition, 'bind_exact_smartstore_qa_update_claim'
     ) = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'exact Smartstore claim patch target not found'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$patch_exact_smartstore_closed_gate_claim$;

create function sellerpilot_private.exact_smartstore_qa_update_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.smartstore_exact_qa_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.update_job_id
     where permit.update_job_id = p_job_id
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_at is not null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and job.status = 'running'
       and job.channel = 'smartstore'
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.claim_token = p_claim_token
       and job.attempt_count = 1
       and job.started_at is not null
       and job.lease_expires_at > statement_timestamp()
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and job.attempt_id = permit.update_attempt_id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and permit.arguments_sha256 = encode(extensions.digest(
             (job.request_payload->'arguments')::text, 'sha256'
           ), 'hex')
       and permit.arguments_bytes = octet_length(
             (job.request_payload->'arguments')::text
           )
       and permit.request_payload_sha256 = encode(extensions.digest(
             job.request_payload::text, 'sha256'
           ), 'hex')
       and permit.request_payload_bytes = octet_length(job.request_payload::text)
       and sellerpilot_private.smartstore_exact_qa_release_is_current(
             permit.release_sha
           )
       and sellerpilot_private.smartstore_exact_qa_update_arguments_valid(
             job.request_payload->'arguments', permit.release_sha
           )
       and (
         (job.provider_mutation_started_at is null and permit.consumed_at is null)
         or (
           job.provider_mutation_started_at is not null
           and permit.consumed_at is not null
           and permit.consumed_at >= job.provider_mutation_started_at
         )
       )
  )
$$;

create function sellerpilot_private.consume_exact_smartstore_qa_update_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.smartstore_exact_qa_update_permits permit
     set consumed_at = clock_timestamp()
   where permit.update_job_id = p_job_id
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = permit.update_job_id
          and job.status = 'running'
          and job.claim_token = permit.bound_claim_token
          and job.worker_token_id = permit.bound_worker_token_id
          and job.provider_mutation_started_at is not null
          and job.completed_at is null
          and job.response_payload is null
     );
  if found then return true; end if;
  return exists (
    select 1
      from sellerpilot_private.smartstore_exact_qa_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.update_job_id
     where permit.update_job_id = p_job_id
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.consumed_at is not null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and job.status = 'running'
       and job.claim_token = p_claim_token
       and job.provider_mutation_started_at is not null
       and permit.consumed_at >= job.provider_mutation_started_at
       and job.completed_at is null
       and job.response_payload is null
  );
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_09010535_begin_gateway_before_smartstore;
revoke all on function public.sp_09010535_begin_gateway_before_smartstore(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exact boolean := false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
      and job.credential_id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
      and job.channel = 'smartstore'
      and job.operation = 'listing.update'
      and job.request_payload#>>
            '{arguments,sellerpilotSmartstoreExactQaRecovery,contract}' =
            'smartstore_exact_qa_recovery_v1'
    into v_exact
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if coalesce(v_exact, false) then
    if not sellerpilot_private.exact_smartstore_qa_update_provider_allowed(
      p_job_id, p_claim_token
    ) then return false; end if;
    v_started := public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
      p_token_hash, p_job_id, p_claim_token
    );
    if coalesce(v_started, false)
       and not sellerpilot_private.consume_exact_smartstore_qa_update_provider(
         p_job_id, p_claim_token
       )
    then
      raise exception 'exact Smartstore QA update permit consumption failed'
        using errcode = '40001';
    end if;
    return coalesce(v_started, false);
  end if;
  return public.sp_09010535_begin_gateway_before_smartstore(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_09010535_begin_serverless_before_smartstore;
revoke all on function public.sp_09010535_begin_serverless_before_smartstore(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exact boolean := false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
      and job.credential_id = '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
      and job.channel = 'smartstore'
      and job.operation = 'listing.update'
      and job.request_payload#>>
            '{arguments,sellerpilotSmartstoreExactQaRecovery,contract}' =
            'smartstore_exact_qa_recovery_v1'
    into v_exact
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if coalesce(v_exact, false) then
    if not sellerpilot_private.exact_smartstore_qa_update_provider_allowed(
      p_job_id, p_claim_token
    ) then return false; end if;
    v_started :=
      public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
        p_token_hash, p_job_id, p_claim_token
      );
    if coalesce(v_started, false)
       and not sellerpilot_private.consume_exact_smartstore_qa_update_provider(
         p_job_id, p_claim_token
       )
    then
      raise exception 'exact Smartstore QA update permit consumption failed'
        using errcode = '40001';
    end if;
    return coalesce(v_started, false);
  end if;
  return public.sp_09010535_begin_serverless_before_smartstore(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_exact_qa_release_is_current(text),
  sellerpilot_private.smartstore_exact_qa_html_image_urls(text),
  sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb, text),
  sellerpilot_private.smartstore_exact_qa_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ),
  sellerpilot_private.guard_smartstore_exact_qa_update_job(),
  sellerpilot_private.bind_exact_smartstore_qa_update_claim(jsonb, jsonb),
  sellerpilot_private.exact_smartstore_qa_update_provider_allowed(uuid, uuid),
  sellerpilot_private.consume_exact_smartstore_qa_update_provider(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_arm_exact_smartstore_qa_update(
    uuid, uuid, text, text
  ),
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ),
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  )
  from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_arm_exact_smartstore_qa_update(
    uuid, uuid, text, text
  ),
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ),
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  )
  to service_role;

do $smartstore_exact_qa_permit_postimage$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.smartstore_exact_qa_update_permits'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_arm_exact_smartstore_qa_update(uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.bind_exact_smartstore_qa_update_claim(jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_smartstore_qa_update_provider_allowed(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.consume_exact_smartstore_qa_update_provider(uuid,uuid)'
     ) is null
     or exists (
       select 1
         from (values
           ('public'::name), ('anon'::name), ('authenticated'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'public.sellerpilot_service_arm_exact_smartstore_qa_update(uuid,uuid,text,text)',
          'EXECUTE'
        )
     )
     or exists (
       select 1
         from (values
           ('public'::name), ('anon'::name), ('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)',
          'EXECUTE'
        )
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_arm_exact_smartstore_qa_update(uuid,uuid,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_namespace namespace
           on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname in (
            'sellerpilot_service_arm_exact_smartstore_qa_update',
            'sellerpilot_service_enqueue_listing_gateway_job',
            'sellerpilot_service_begin_gateway_provider_mutation',
            'sellerpilot_service_begin_serverless_gateway_provider_mutation'
          )
          and (
            not procedure.prosecdef
            or pg_catalog.pg_get_userbyid(procedure.proowner)
                 is distinct from current_user
          )
     )
  then
    raise exception 'exact Smartstore QA update permit postimage invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from sellerpilot_private.smartstore_exact_qa_update_permits
  ) then
    raise exception 'exact Smartstore QA permit migration synthesized work'
      using errcode = '55000';
  end if;
end;
$smartstore_exact_qa_permit_postimage$;

comment on table sellerpilot_private.smartstore_exact_qa_update_permits is
  'Five-minute, one-use permit for exactly one existing Smartstore QA listing update. It is bound to one request fingerprint, first worker claim and provider-mutation boundary; it never opens the generic publication gate.';

comment on function public.sellerpilot_service_arm_exact_smartstore_qa_update(
  uuid, uuid, text, text
) is
  'Arms one short-lived exact Smartstore QA update after server-owned listing, credential, category, release and closed-gate checks.';

commit;
