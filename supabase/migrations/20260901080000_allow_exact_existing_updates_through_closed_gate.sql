-- Admit one exact existing-listing update for Coupang, 11st, or eBay while
-- the global listing-mutation release gate remains closed. A server route
-- arms a five-minute permit against the current runtime SHA and canonical
-- request fingerprint. The permit is then bound to one newly-created job,
-- one first worker claim, and consumed atomically at the provider boundary.
-- Lazada, generic mutations, Qoo10, and Smartstore retain their own gates.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908000001);

create table sellerpilot_private.exact_existing_update_permits (
  permit_id uuid primary key default gen_random_uuid(),
  channel text not null,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  market text not null,
  target_id text not null,
  remote_id text not null,
  seller_sku text not null,
  provider_resource_id text,
  currency text not null,
  price numeric not null,
  stock integer not null,
  seller_account_key text not null,
  credential_version integer not null,
  credential_fingerprint text not null,
  credential_account_source text not null,
  credential_verified_at timestamptz not null,
  credential_expires_at timestamptz,
  credential_last_checked_at timestamptz,
  credential_last_check_status text,
  snapshot_revision bigint,
  snapshot_payload_sha256 text,
  snapshot_source_job_id uuid
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
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
  constraint exact_existing_update_permit_target_check check (
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
        and credential_id = 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
        and market = 'US' and target_id = 'EBAY_US'
        and remote_id = '800551945442'
        and seller_sku = 'QA-20260823-CC-001-US'
        and provider_resource_id = '244042196011'
        and currency = 'USD' and price = 12.90
        and stock between 1 and 999999
        and credential_version = 92
        and credential_fingerprint = 'B82F3FE28085'
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
  ),
  constraint exact_existing_update_permit_binding_check check (
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

create unique index exact_existing_one_active_update_per_listing
  on sellerpilot_private.exact_existing_update_permits(channel, listing_id)
  where invalidated_at is null;

alter table sellerpilot_private.exact_existing_update_permits
  enable row level security;
revoke all on sellerpilot_private.exact_existing_update_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.exact_existing_update_release_is_current(
  p_channel text,
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_channel in ('coupang', 'elevenst', 'ebay')
    and p_release_sha ~ '^[a-f0-9]{40}$'
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
      p_channel
    ),
    false
  )
$$;

create function sellerpilot_private.exact_existing_update_arguments_valid(
  p_channel text,
  p_arguments jsonb,
  p_release_sha text,
  p_request_fingerprint text,
  p_expected_stock integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_marker jsonb;
  v_assets jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_item jsonb := p_arguments#>'{body,items,0}';
  v_product jsonb := p_arguments->'product';
  v_patch jsonb := p_arguments->'productPatch';
  v_inventory_product jsonb := p_arguments#>'{inventoryItem,product}';
  v_offer jsonb := p_arguments->'offer';
begin
  if p_channel not in ('coupang', 'elevenst', 'ebay')
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_arguments->>'publicationExpectedFingerprint'
          is distinct from p_request_fingerprint
     or p_arguments->>'publicationStateContract'
          is distinct from 'verified_remote_state_v1'
     or p_arguments->>'publicationIntent' is distinct from 'live'
     or (p_arguments->>'publicationExpectedImageCount')::integer <> 8
     or jsonb_typeof(v_assets) is distinct from 'object'
     or v_assets->>'contract'
          is distinct from 'sellerpilot_publication_asset_binding_v1'
     or v_assets->>'providerImageSurface' is distinct from 'detail_content'
     or jsonb_typeof(v_assets->'approvedDetailImages')
          is distinct from 'array'
     or jsonb_array_length(v_assets->'approvedDetailImages') <> 8
     or jsonb_typeof(v_assets->'providerTransportImages')
          is distinct from 'array'
     or jsonb_array_length(v_assets->'providerTransportImages') <> 8
  then return false; end if;

  if p_channel = 'coupang' then
    v_marker := p_arguments->'sellerpilotCoupangExactQaRecovery';
    return p_expected_stock = 1
      and p_arguments->>'publicationExpectedLocale' = 'ko-KR'
      and jsonb_typeof(v_marker) = 'object'
      and v_marker->>'contract' = 'coupang_exact_qa_recovery_v1'
      and v_marker->>'phase' = 'listing.update'
      and v_marker->>'productId' = 'ddccde35-9c58-4856-b673-d7aa27ce4220'
      and v_marker->>'listingId' = '7ffc6e46-3173-4695-9889-5fa1529765f1'
      and v_marker->>'sellerProductId' = '16356981734'
      and v_marker->>'vendorItemId' = '95962393877'
      and v_marker->>'sellerSku' = 'QA-20260823-CC-001'
      and v_marker->>'sellerAccountLineage' = 'validated_by_service_rpc'
      and p_arguments#>>'{body,sellerProductId}' = '16356981734'
      and jsonb_typeof(p_arguments#>'{body,items}') = 'array'
      and jsonb_array_length(p_arguments#>'{body,items}') = 1
      and v_item->>'externalVendorSku' = 'QA-20260823-CC-001'
      and v_item->>'modelNo' = 'QA-20260823-CC-001'
      and (v_item->>'originalPrice')::numeric = 5000
      and (v_item->>'salePrice')::numeric = 5000
      and (v_item->>'maximumBuyCount')::integer = 1;
  elsif p_channel = 'elevenst' then
    v_marker := p_arguments->'sellerpilotElevenstExactExistingPublication';
    return p_expected_stock = 1
      and p_arguments->>'publicationExpectedLocale' = 'ko-KR'
      and jsonb_typeof(v_marker) = 'object'
      and v_marker->>'contract' = 'elevenst_exact_existing_publication_v1'
      and v_marker->>'productId' = 'ddccde35-9c58-4856-b673-d7aa27ce4220'
      and v_marker->>'listingId' = '363f3b81-f364-4f22-af4e-4920199904d0'
      and v_marker->>'credentialId' = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'
      and v_marker->>'remoteId' = '9573255804'
      and v_marker->>'sellerSku' = 'QA-20260823-CC-001'
      and v_marker->>'categoryId' = '1341821'
      and (v_marker->>'priceKrw')::numeric = 5000
      and (v_marker->>'stock')::integer = 1
      and v_marker->>'sellerAccountLineage' = 'validated_by_service_rpc'
      and v_marker->>'trustedSnapshot'
            = 'sellerpilot_service_get_elevenst_listing_snapshot'
      and p_arguments->>'productNo' = '9573255804'
      and jsonb_typeof(v_product) = 'object'
      and v_product->>'sellerPrdCd' = 'QA-20260823-CC-001'
      and v_product->>'dispCtgrNo' = '1341821'
      and v_product->>'selPrc' = '5000'
      and v_product->>'prdSelQty' = '1'
      and v_product->>'prdImage01' ~ '^https://'
      and jsonb_typeof(v_patch) = 'object'
      and v_patch->>'selPrc' = '5000'
      and v_patch->>'prdSelQty' = '1';
  else
    v_marker := p_arguments->'sellerpilotEbayExactExistingQaRecovery';
    return p_expected_stock between 1 and 999999
      and p_arguments->>'publicationExpectedLocale' = 'en-US'
      and jsonb_typeof(v_marker) = 'object'
      and v_marker->>'contract' = 'ebay_exact_existing_qa_recovery_v2'
      and v_marker->>'phase' = 'listing.update'
      and v_marker->>'productId' = 'ddccde35-9c58-4856-b673-d7aa27ce4220'
      and v_marker->>'listingId' = '8b2cbfaf-3854-437d-b381-abfd70291354'
      and v_marker->>'sourceAttemptId' = '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'
      and v_marker->>'publicListingId' = '800551945442'
      and v_marker->>'market' = 'US'
      and v_marker->>'marketplaceId' = 'EBAY_US'
      and v_marker->>'marketplaceSku' = 'QA-20260823-CC-001-US'
      and v_marker->>'offerId' = '244042196011'
      and v_marker->>'currency' = 'USD'
      and (v_marker->>'priceUsd')::numeric = 12.90
      and (v_marker->>'stock')::integer = p_expected_stock
      and v_marker->>'credentialId' = 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'
      and v_marker->>'sellerAccountKey' =
            'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      and v_marker->>'offerIdSource' = 'immutable_lineage_attestation_v1'
      and v_marker->>'sellerAccountLineage' = 'validated_by_service_rpc'
      and p_arguments->>'listingId' = '800551945442'
      and p_arguments->>'sku' = 'QA-20260823-CC-001-US'
      and p_arguments->>'marketplaceId' = 'EBAY_US'
      and nullif(trim(coalesce(p_arguments->>'offerId', '')), '') is null
      and nullif(trim(coalesce(p_arguments->>'providerResourceId', '')), '') is null
      and jsonb_typeof(v_inventory_product) = 'object'
      and nullif(trim(coalesce(v_inventory_product->>'title', '')), '') is null
      and jsonb_typeof(v_inventory_product->'imageUrls') = 'array'
      and jsonb_array_length(v_inventory_product->'imageUrls') = 1
      and p_arguments#>>'{inventoryItem,condition}' = 'NEW'
      and (p_arguments#>>'{inventoryItem,availability,shipToLocationAvailability,quantity}')::integer
            = p_expected_stock
      and (v_offer->>'availableQuantity')::integer = p_expected_stock
      and v_offer#>>'{pricingSummary,price,currency}' = 'USD'
      and (v_offer#>>'{pricingSummary,price,value}')::numeric = 12.90
      and coalesce(p_arguments->>'publish', 'false') <> 'true';
  end if;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.guard_exact_existing_update_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := new.request_payload->'arguments';
  v_exact_surface boolean := false;
begin
  v_exact_surface :=
    (
      new.operation = 'listing.update'
      and (
        (new.channel = 'coupang' and new.listing_id =
          '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid)
        or (new.channel = 'elevenst' and new.listing_id =
          '363f3b81-f364-4f22-af4e-4920199904d0'::uuid)
        or (new.channel = 'ebay' and new.listing_id =
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid)
      )
    )
    or coalesce(v_arguments ? 'sellerpilotCoupangExactQaRecovery', false)
    or coalesce(v_arguments ? 'sellerpilotElevenstExactExistingPublication', false)
    or coalesce(v_arguments ? 'sellerpilotEbayExactExistingQaRecovery', false);
  if not v_exact_surface then return new; end if;

  if not exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = new.id
  ) then
    return new;
  end if;

  if new.channel not in ('coupang', 'elevenst', 'ebay')
     or new.operation is distinct from 'listing.update'
     or new.environment is distinct from 'production'
     or not exists (
       select 1
         from sellerpilot_private.exact_existing_update_permits permit
        where permit.update_job_id = new.id
          and permit.update_attempt_id = new.attempt_id
          and permit.channel = new.channel
          and permit.listing_id = new.listing_id
          and permit.credential_id = new.credential_id
          and permit.seller_account_key = new.seller_account_key
          and permit.request_fingerprint = new.request_fingerprint
          and permit.arguments_sha256 = encode(extensions.digest(
                v_arguments::text, 'sha256'
              ), 'hex')
          and permit.arguments_bytes = octet_length(v_arguments::text)
          and permit.request_payload_sha256 = encode(extensions.digest(
                new.request_payload::text, 'sha256'
              ), 'hex')
          and permit.request_payload_bytes =
                octet_length(new.request_payload::text)
          and permit.invalidated_at is null
          and sellerpilot_private.exact_existing_update_arguments_valid(
                permit.channel, v_arguments, permit.release_sha,
                permit.request_fingerprint, permit.stock
              )
     )
  then
    raise exception 'exact existing update job lineage invalid'
      using errcode = '55000';
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'exact existing update job lineage invalid'
    using errcode = '55000';
end;
$$;

create constraint trigger guard_exact_existing_update_job
after insert or update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function
  sellerpilot_private.guard_exact_existing_update_job();

create function sellerpilot_private.bind_exact_existing_update_claim(
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
     or p_old->>'channel' not in ('coupang', 'elevenst', 'ebay')
     or p_new->>'channel' is distinct from p_old->>'channel'
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

  update sellerpilot_private.exact_existing_update_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = v_worker_token_id,
         bound_claim_token = v_claim_token
   where permit.update_job_id = v_job_id
     and permit.update_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.channel = p_new->>'channel'
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
     and sellerpilot_private.exact_existing_update_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           permit.channel, p_new->'request_payload'->'arguments',
           permit.release_sha, permit.request_fingerprint, permit.stock
         );
  return found;
exception when others then
  return false;
end;
$$;

do $patch_exact_existing_closed_gate_claim$
declare
  v_definition text;
  v_before text := $body$
       or sellerpilot_private.bind_exact_qoo10_localization_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_smartstore_qa_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
  v_after text := $body$
       or sellerpilot_private.bind_exact_qoo10_localization_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_smartstore_qa_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_existing_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition, 'bind_exact_existing_update_claim'
     ) = 0
  then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'exact existing claim patch target not found'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$patch_exact_existing_closed_gate_claim$;

create function sellerpilot_private.exact_existing_update_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.product_id = permit.product_id
       and listing.owner_id = permit.owner_id
       and listing.channel_key = permit.channel
       and listing.market = permit.market
       and listing.target_id = permit.target_id
       and listing.remote_id = permit.remote_id
       and listing.currency = permit.currency
       and listing.price = permit.price
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id
       and product.owner_id = permit.owner_id
       and product.sku = case permit.channel
         when 'ebay' then 'QA-20260823-CC-001'
         else permit.seller_sku
       end
       and product.on_hand = permit.stock
       and not product.demo
       and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
       and credential.channel = permit.channel
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source =
             permit.credential_account_source
       and credential.seller_account_verified_at =
             permit.credential_verified_at
       and credential.expires_at is not distinct from
             permit.credential_expires_at
       and credential.last_checked_at is not distinct from
             permit.credential_last_checked_at
       and credential.last_check_status is not distinct from
             permit.credential_last_check_status
       and (credential.expires_at is null
         or credential.expires_at > statement_timestamp())
      left join sellerpilot_private.elevenst_listing_snapshots snapshot
        on permit.channel = 'elevenst'
       and snapshot.listing_id = permit.listing_id
       and snapshot.credential_id = permit.credential_id
       and snapshot.seller_account_key = permit.seller_account_key
       and snapshot.remote_id = permit.remote_id
     where permit.permit_id = p_permit_id
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_release_is_current(
             permit.channel, permit.release_sha
           )
       and (
         (
           permit.channel = 'coupang'
           and permit.listing_id =
                 '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
           and permit.remote_id = '16356981734'
           and permit.provider_resource_id = '95962393877'
           and permit.seller_sku = 'QA-20260823-CC-001'
           and listing.status = 'failed'
           and (listing.failure_class is null
             or listing.failure_class = 'external_action')
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'unknown'
           and listing.provider_status is null
           and listing.published_at is null
           and permit.credential_account_source =
                 'credential_incarnation_v1'
           and permit.snapshot_revision is null
           and permit.snapshot_payload_sha256 is null
           and permit.snapshot_source_job_id is null
         ) or (
           permit.channel = 'elevenst'
           and permit.listing_id =
                 '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
           and permit.credential_id =
                 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
           and permit.remote_id = '9573255804'
           and permit.seller_sku = 'QA-20260823-CC-001'
           and (listing.marketplace_sku is null
             or listing.marketplace_sku = permit.seller_sku)
           and listing.status = 'failed'
           and listing.failure_class = 'external_action'
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'unknown'
           and (listing.provider_status is null
             or listing.provider_status = '105')
           and listing.published_at is null
           and permit.credential_account_source =
                 'credential_incarnation_v1'
           and snapshot.revision = permit.snapshot_revision
           and snapshot.source_job_id = permit.snapshot_source_job_id
           and encode(extensions.digest(
                 snapshot.product_payload::text, 'sha256'
               ), 'hex') = permit.snapshot_payload_sha256
         ) or (
           permit.channel = 'ebay'
           and permit.listing_id =
                 '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
           and permit.credential_id =
                 'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
           and permit.remote_id = '800551945442'
           and permit.seller_sku = 'QA-20260823-CC-001-US'
           and listing.marketplace_sku = permit.seller_sku
           and listing.provider_resource_id = permit.provider_resource_id
           and listing.status = 'failed'
           and listing.failure_class = 'external_action'
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'unknown'
           and listing.provider_status is null
           and listing.published_at is null
           and permit.credential_version = 92
           and permit.credential_fingerprint = 'B82F3FE28085'
           and permit.credential_account_source = 'provider_certified_v1'
           and permit.snapshot_revision is null
           and permit.snapshot_payload_sha256 is null
           and permit.snapshot_source_job_id is null
         )
       )
  )
$$;

create function sellerpilot_private.guard_exact_existing_update_permit_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mutable_fields constant text[] := array[
    'update_job_id', 'update_attempt_id', 'arguments_sha256',
    'arguments_bytes', 'request_payload_sha256', 'request_payload_bytes',
    'bound_at', 'bound_worker_token_id', 'bound_claim_token', 'consumed_at',
    'invalidated_at', 'invalidation_reason'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'exact existing update permits cannot be deleted'
      using errcode = '55000';
  end if;
  if to_jsonb(new) - v_mutable_fields is distinct from
       to_jsonb(old) - v_mutable_fields
  then
    raise exception 'exact existing update permit identity is immutable'
      using errcode = '55000';
  end if;

  if old.update_job_id is null
     and old.update_attempt_id is null
     and old.bound_at is null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.update_job_id is null
     and new.update_attempt_id is null
     and new.bound_at is null
     and new.consumed_at is null
     and new.invalidated_at is not null
     and new.invalidation_reason = 'expired_before_job'
     and old.expires_at <= statement_timestamp()
     and to_jsonb(new) - array['invalidated_at', 'invalidation_reason']
           is not distinct from
         to_jsonb(old) - array['invalidated_at', 'invalidation_reason']
  then return new; end if;

  if old.update_job_id is null
     and old.update_attempt_id is null
     and old.arguments_sha256 is null
     and old.request_payload_sha256 is null
     and old.bound_at is null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.update_job_id is not null
     and new.update_attempt_id is not null
     and new.arguments_sha256 ~ '^[a-f0-9]{64}$'
     and new.arguments_bytes between 100 and 128000
     and new.request_payload_sha256 ~ '^[a-f0-9]{64}$'
     and new.request_payload_bytes between 100 and 128000
     and new.bound_at is null
     and new.consumed_at is null
     and new.invalidated_at is null
     and new.expires_at > statement_timestamp()
     and to_jsonb(new) - array[
           'update_job_id', 'update_attempt_id', 'arguments_sha256',
           'arguments_bytes', 'request_payload_sha256',
           'request_payload_bytes'
         ] is not distinct from
         to_jsonb(old) - array[
           'update_job_id', 'update_attempt_id', 'arguments_sha256',
           'arguments_bytes', 'request_payload_sha256',
           'request_payload_bytes'
         ]
  then return new; end if;

  if old.update_job_id is not null
     and old.update_attempt_id is not null
     and old.bound_at is null
     and old.bound_worker_token_id is null
     and old.bound_claim_token is null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.update_job_id = old.update_job_id
     and new.update_attempt_id = old.update_attempt_id
     and new.bound_at is not null
     and new.bound_at >= new.armed_at
     and new.bound_at < new.expires_at
     and new.bound_worker_token_id is not null
     and new.bound_claim_token is not null
     and new.consumed_at is null
     and new.invalidated_at is null
     and to_jsonb(new) - array[
           'bound_at', 'bound_worker_token_id', 'bound_claim_token'
         ] is not distinct from
         to_jsonb(old) - array[
           'bound_at', 'bound_worker_token_id', 'bound_claim_token'
         ]
  then return new; end if;

  if old.bound_at is not null
     and old.bound_worker_token_id is not null
     and old.bound_claim_token is not null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.bound_at = old.bound_at
     and new.bound_worker_token_id = old.bound_worker_token_id
     and new.bound_claim_token = old.bound_claim_token
     and new.consumed_at is not null
     and new.consumed_at >= new.bound_at
     and new.consumed_at < new.expires_at
     and new.invalidated_at is null
     and to_jsonb(new) - 'consumed_at' is not distinct from
         to_jsonb(old) - 'consumed_at'
  then return new; end if;

  raise exception 'exact existing update permit transition invalid'
    using errcode = '55000';
end;
$$;

create trigger guard_exact_existing_update_permit_transition
before update or delete
on sellerpilot_private.exact_existing_update_permits
for each row execute function
  sellerpilot_private.guard_exact_existing_update_permit_transition();

create function public.sellerpilot_service_arm_exact_existing_update(
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
  v_identity jsonb;
  v_owner_id uuid;
  v_seller_account_key text;
  v_stock integer;
  v_market text;
  v_target_id text;
  v_credential_version integer;
  v_credential_fingerprint text;
  v_credential_account_source text;
  v_credential_verified_at timestamptz;
  v_credential_expires_at timestamptz;
  v_credential_last_checked_at timestamptz;
  v_credential_last_check_status text;
  v_snapshot_revision bigint;
  v_snapshot_payload_sha256 text;
  v_snapshot_source_job_id uuid;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
  then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  if p_channel not in ('coupang', 'elevenst', 'ebay')
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.exact_existing_update_release_is_current(
       p_channel, p_release_sha
     )
  then
    raise exception 'exact existing update permit identity invalid'
      using errcode = '55000';
  end if;

  select credential.version, credential.fingerprint,
         credential.seller_account_key_source,
         credential.seller_account_verified_at, credential.expires_at,
         credential.last_checked_at, credential.last_check_status
    into v_credential_version, v_credential_fingerprint,
         v_credential_account_source, v_credential_verified_at,
         v_credential_expires_at, v_credential_last_checked_at,
         v_credential_last_check_status
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = p_channel
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version > 0
     and credential.fingerprint ~ '^[A-F0-9]{12}$'
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = case p_channel
       when 'ebay' then 'provider_certified_v1'
       else 'credential_incarnation_v1'
     end
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
   for share of credential;
  if not found then
    raise exception 'exact existing update credential lineage invalid'
      using errcode = '55000';
  end if;
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
  end if;

  if p_channel = 'coupang' then
    if p_listing_id is distinct from
         '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
    then raise exception 'exact existing update permit identity invalid'
      using errcode = '55000'; end if;
    v_identity := public.sellerpilot_service_get_coupang_exact_qa_recovery_identity(
      p_listing_id, p_credential_id,
      'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
      'KR', 'KR', 'listing.update'
    );
    select listing.owner_id, listing.seller_account_key, product.on_hand,
           listing.market, listing.target_id
      into v_owner_id, v_seller_account_key, v_stock, v_market, v_target_id
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product
        on product.id = listing.product_id and product.owner_id = listing.owner_id
     where listing.id = p_listing_id
       and listing.currency = 'KRW' and listing.price = 5000
       and product.on_hand = 1
     for share of listing, product;
    if v_identity->>'contract' is distinct from 'coupang_exact_qa_recovery_v1'
       or v_identity->>'phase' is distinct from 'listing.update'
       or v_market is distinct from 'KR' or v_target_id is distinct from 'KR'
    then raise exception 'exact existing update permit identity invalid'
      using errcode = '55000'; end if;
  elsif p_channel = 'elevenst' then
    if p_listing_id is distinct from
         '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
       or p_credential_id is distinct from
         'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
    then raise exception 'exact existing update permit identity invalid'
      using errcode = '55000'; end if;
    if v_credential_last_checked_at is null
       or v_credential_version is distinct from 2
       or v_credential_last_check_status is distinct from 'passed'
    then raise exception 'exact existing update credential lineage invalid'
      using errcode = '55000'; end if;
    select listing.owner_id, listing.seller_account_key, product.on_hand,
           listing.market, listing.target_id
      into v_owner_id, v_seller_account_key, v_stock, v_market, v_target_id
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product
        on product.id = listing.product_id and product.owner_id = listing.owner_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = p_credential_id
       and credential.channel = 'elevenst'
       and credential.status = 'active'
       and credential.environment = 'production'
       and credential.seller_account_key = listing.seller_account_key
       and credential.seller_account_key_source = 'credential_incarnation_v1'
       and credential.seller_account_verified_at is not null
       and (credential.expires_at is null
         or credential.expires_at > statement_timestamp())
      join sellerpilot_private.elevenst_listing_snapshots snapshot
        on snapshot.listing_id = listing.id
       and snapshot.credential_id = credential.id
       and snapshot.seller_account_key = listing.seller_account_key
       and snapshot.remote_id = listing.remote_id
     where listing.id = p_listing_id
       and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = 'elevenst'
       and listing.remote_id = '9573255804'
       and (listing.marketplace_sku is null
         or listing.marketplace_sku = 'QA-20260823-CC-001')
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
       and (listing.provider_status is null or listing.provider_status = '105')
       and listing.published_at is null
       and listing.currency = 'KRW' and listing.price = 5000
       and listing.market = 'KR' and listing.target_id = 'KR'
       and product.sku = 'QA-20260823-CC-001'
       and product.on_hand = 1 and not product.demo
       and product.status <> 'archived'
     for share of listing, product, credential, snapshot;
    if v_owner_id is null then raise exception
      'exact existing update permit identity invalid' using errcode = '55000';
    end if;
    select snapshot.revision,
           encode(extensions.digest(snapshot.product_payload::text, 'sha256'), 'hex'),
           snapshot.source_job_id
      into v_snapshot_revision, v_snapshot_payload_sha256,
           v_snapshot_source_job_id
      from sellerpilot_private.elevenst_listing_snapshots snapshot
     where snapshot.listing_id = p_listing_id
       and snapshot.credential_id = p_credential_id
       and snapshot.seller_account_key = v_seller_account_key
       and snapshot.remote_id = '9573255804'
       and snapshot.revision > 0
       and snapshot.source_job_id is not null
       and jsonb_typeof(snapshot.product_payload) = 'object'
     for share of snapshot;
    if not found
       or v_snapshot_payload_sha256 !~ '^[a-f0-9]{64}$'
    then raise exception 'exact existing update snapshot lineage invalid'
      using errcode = '55000'; end if;
  else
    if p_listing_id is distinct from
         '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       or p_credential_id is distinct from
         'a2593ca0-c2c2-4158-a35b-88aa27b5911a'::uuid
    then raise exception 'exact existing update permit identity invalid'
      using errcode = '55000'; end if;
    v_identity := public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identity(
      p_listing_id, p_credential_id,
      'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
      'US', 'EBAY_US'
    );
    select listing.owner_id, listing.seller_account_key, product.on_hand,
           listing.market, listing.target_id
      into v_owner_id, v_seller_account_key, v_stock, v_market, v_target_id
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product
        on product.id = listing.product_id and product.owner_id = listing.owner_id
     where listing.id = p_listing_id
     for share of listing, product;
    if v_identity->>'contract' is distinct from
         'ebay_exact_existing_qa_recovery_v2'
       or v_identity->>'sellerAccountKey' is distinct from v_seller_account_key
       or (v_identity->>'stock')::integer is distinct from v_stock
       or v_market is distinct from 'US' or v_target_id is distinct from 'EBAY_US'
    then raise exception 'exact existing update permit identity invalid'
      using errcode = '55000'; end if;
  end if;

  if v_owner_id is distinct from
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or v_seller_account_key !~ '^[a-f0-9]{64}$'
     or v_seller_account_key is distinct from (
       select credential.seller_account_key
         from sellerpilot_private.channel_credentials credential
        where credential.id = p_credential_id
     )
     or v_stock is null
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = p_listing_id
          and (
            job.status in ('queued', 'running', 'reconciliation_required')
            or job.request_payload#>>
                 '{arguments,sellerpilotCoupangExactQaRecovery,contract}' =
                 'coupang_exact_qa_recovery_v1'
            or job.request_payload#>>
                 '{arguments,sellerpilotElevenstExactExistingPublication,contract}' =
                 'elevenst_exact_existing_publication_v1'
            or job.request_payload#>>
                 '{arguments,sellerpilotEbayExactExistingQaRecovery,contract}' =
                 'ebay_exact_existing_qa_recovery_v2'
          )
     )
  then raise exception 'exact existing update permit identity invalid'
    using errcode = '55000'; end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.channel = p_channel
     and permit.listing_id = p_listing_id
     and permit.invalidated_at is null
     and permit.update_job_id is null
     and permit.expires_at <= statement_timestamp();

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.channel = p_channel
     and permit.listing_id = p_listing_id
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.update_job_id is not null
       or v_permit.credential_id is distinct from p_credential_id
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.expires_at <= statement_timestamp()
       or v_permit.credential_version is distinct from v_credential_version
       or v_permit.credential_fingerprint is distinct from
            v_credential_fingerprint
       or v_permit.credential_account_source is distinct from
            v_credential_account_source
       or v_permit.credential_verified_at is distinct from
            v_credential_verified_at
       or v_permit.credential_expires_at is distinct from
            v_credential_expires_at
       or v_permit.credential_last_checked_at is distinct from
            v_credential_last_checked_at
       or v_permit.credential_last_check_status is distinct from
            v_credential_last_check_status
       or v_permit.snapshot_revision is distinct from v_snapshot_revision
       or v_permit.snapshot_payload_sha256 is distinct from
            v_snapshot_payload_sha256
       or v_permit.snapshot_source_job_id is distinct from
            v_snapshot_source_job_id
       or not sellerpilot_private.exact_existing_update_lineage_is_current(
            v_permit.permit_id
          )
    then raise exception 'exact existing update permit conflict'
      using errcode = '55000'; end if;
    return jsonb_build_object(
      'contract', 'exact_existing_update_permit_v1',
      'permitId', v_permit.permit_id, 'channel', v_permit.channel,
      'listingId', v_permit.listing_id, 'releaseSha', v_permit.release_sha,
      'requestFingerprint', v_permit.request_fingerprint,
      'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
      'bound', false, 'reused', true
    );
  end if;

  insert into sellerpilot_private.exact_existing_update_permits (
    channel, listing_id, product_id, credential_id, owner_id, market,
    target_id, remote_id, seller_sku, provider_resource_id, currency,
    price, stock, seller_account_key, credential_version,
    credential_fingerprint, credential_account_source,
    credential_verified_at, credential_expires_at,
    credential_last_checked_at, credential_last_check_status,
    snapshot_revision,
    snapshot_payload_sha256, snapshot_source_job_id, release_sha,
    request_fingerprint, armed_at, expires_at
  ) values (
    p_channel, p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id, v_owner_id, v_market, v_target_id,
    case p_channel when 'coupang' then '16356981734'
      when 'elevenst' then '9573255804' else '800551945442' end,
    case p_channel when 'ebay' then 'QA-20260823-CC-001-US'
      else 'QA-20260823-CC-001' end,
    case p_channel when 'coupang' then '95962393877'
      when 'ebay' then '244042196011' else null end,
    case p_channel when 'ebay' then 'USD' else 'KRW' end,
    case p_channel when 'ebay' then 12.90 else 5000 end,
    v_stock, v_seller_account_key, v_credential_version,
    v_credential_fingerprint, v_credential_account_source,
    v_credential_verified_at, v_credential_expires_at,
    v_credential_last_checked_at, v_credential_last_check_status,
    v_snapshot_revision,
    v_snapshot_payload_sha256, v_snapshot_source_job_id,
    p_release_sha, p_request_fingerprint,
    clock_timestamp(), clock_timestamp() + interval '5 minutes'
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract', 'exact_existing_update_permit_v1',
    'permitId', v_permit.permit_id, 'channel', v_permit.channel,
    'listingId', v_permit.listing_id, 'releaseSha', v_permit.release_sha,
    'requestFingerprint', v_permit.request_fingerprint,
    'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
    'bound', false, 'reused', false
  );
end;
$$;

create function sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
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
    p_channel in ('coupang', 'elevenst', 'ebay')
    and p_operation = 'listing.update'
    and jsonb_typeof(p_request_payload) = 'object'
    and jsonb_typeof(v_arguments) = 'object'
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.channel = p_channel
         and permit.listing_id = p_listing_id
         and permit.credential_id = p_credential_id
         and permit.request_fingerprint = attempt.request_fingerprint
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.arguments_sha256 is null
         and permit.request_payload_sha256 is null
         and permit.bound_at is null
         and permit.consumed_at is null
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
         and sellerpilot_private.exact_existing_update_lineage_is_current(
               permit.permit_id
             )
         and sellerpilot_private.exact_existing_update_arguments_valid(
               permit.channel, v_arguments, permit.release_sha,
               permit.request_fingerprint, permit.stock
             )
       where attempt.id = p_attempt_id
         and attempt.owner_id = permit.owner_id
         and attempt.credential_id = permit.credential_id
         and attempt.channel = permit.channel
         and attempt.operation = 'listing.update'
         and attempt.status = 'running'
         and attempt.seller_account_key = permit.seller_account_key
         and attempt.request_fingerprint = permit.request_fingerprint
         and v_arguments->>'publicationExpectedFingerprint' =
               attempt.request_fingerprint
    ),
    false
  );
exception when others then
  return false;
end;
$$;

do $patch_exact_existing_closed_gate_enqueue$
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
     )
     and not sellerpilot_private.smartstore_exact_qa_enqueue_gate_bypass_allowed(
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
     )
     and not sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
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
         v_definition, 'exact_existing_update_enqueue_gate_bypass_allowed'
       ) > 0
    then continue; end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'exact existing closed-gate enqueue patch target not found: %',
        v_signature using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end loop;
end;
$patch_exact_existing_closed_gate_enqueue$;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sp_09010800_enqueue_before_exact_existing_permit;
revoke all on function public.sp_09010800_enqueue_before_exact_existing_permit(
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
  v_exact_surface boolean := false;
  v_exact_permit_path boolean := false;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  v_exact_surface :=
    (
      p_operation = 'listing.update'
      and (
        (p_channel = 'coupang' and p_listing_id =
          '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid)
        or (p_channel = 'elevenst' and p_listing_id =
          '363f3b81-f364-4f22-af4e-4920199904d0'::uuid)
        or (p_channel = 'ebay' and p_listing_id =
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid)
      )
    )
    or coalesce(v_arguments ? 'sellerpilotCoupangExactQaRecovery', false)
    or coalesce(v_arguments ? 'sellerpilotElevenstExactExistingPublication', false)
    or coalesce(v_arguments ? 'sellerpilotEbayExactExistingQaRecovery', false);

  if v_exact_surface then
    select * into v_permit
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.channel = p_channel
       and permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.invalidated_at is null
       and permit.update_job_id is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_lineage_is_current(
             permit.permit_id
           )
     for update;
    v_exact_permit_path := found;
    if v_exact_permit_path
       and (
         p_channel not in ('coupang', 'elevenst', 'ebay')
       or p_operation is distinct from 'listing.update'
       or not sellerpilot_private.exact_existing_update_lineage_is_current(
            v_permit.permit_id
          )
       or not sellerpilot_private.exact_existing_update_arguments_valid(
            v_permit.channel, v_arguments, v_permit.release_sha,
            v_permit.request_fingerprint, v_permit.stock
          )
       or v_arguments->>'publicationExpectedFingerprint' is distinct from
            v_permit.request_fingerprint
       or not exists (
         select 1
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = p_attempt_id
            and attempt.owner_id = v_permit.owner_id
            and attempt.credential_id = v_permit.credential_id
            and attempt.channel = v_permit.channel
            and attempt.operation = 'listing.update'
            and attempt.status = 'running'
            and attempt.seller_account_key = v_permit.seller_account_key
            and attempt.request_fingerprint = v_permit.request_fingerprint
       )
       )
    then
      raise exception 'exact existing update enqueue identity invalid'
        using errcode = '55000';
    end if;
  end if;

  v_result := public.sp_09010800_enqueue_before_exact_existing_permit(
    p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
    p_request_payload
  );

  if v_exact_permit_path then
    if v_result->>'job_id' is null
       or v_result->>'job_id' !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_result->>'status' is distinct from 'queued'
    then
      raise exception 'exact existing update job not newly queued'
        using errcode = '55000';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;
    update sellerpilot_private.exact_existing_update_permits permit
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
       and sellerpilot_private.exact_existing_update_lineage_is_current(
             permit.permit_id
           )
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.id = v_job_id
            and job.attempt_id = p_attempt_id
            and job.listing_id = permit.listing_id
            and job.credential_id = permit.credential_id
            and job.channel = permit.channel
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
      raise exception 'exact existing update job binding failed'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

create function sellerpilot_private.exact_existing_update_provider_allowed(
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
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.update_job_id
     where permit.update_job_id = p_job_id
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_at is not null
       and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_lineage_is_current(
             permit.permit_id
           )
       and job.status = 'running'
       and job.channel = permit.channel
       and job.channel in ('coupang', 'elevenst', 'ebay')
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.claim_token = p_claim_token
       and job.attempt_count = 1
       and job.started_at is not null
       and job.lease_expires_at > statement_timestamp()
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and job.provider_mutation_started_at is null
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
       and sellerpilot_private.exact_existing_update_arguments_valid(
             permit.channel, job.request_payload->'arguments',
             permit.release_sha, permit.request_fingerprint, permit.stock
           )
  )
$$;

create function sellerpilot_private.consume_exact_existing_update_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.exact_existing_update_permits permit
     set consumed_at = clock_timestamp()
   where permit.update_job_id = p_job_id
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_lineage_is_current(
           permit.permit_id
         )
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = permit.update_job_id
          and job.status = 'running'
          and job.channel = permit.channel
          and job.operation = 'listing.update'
          and job.environment = 'production'
          and job.claim_token = permit.bound_claim_token
          and job.worker_token_id = permit.bound_worker_token_id
          and job.provider_mutation_started_at is not null
          and job.completed_at is null
          and job.response_payload is null
          and job.error_message is null
          and permit.request_payload_sha256 = encode(extensions.digest(
                job.request_payload::text, 'sha256'
              ), 'hex')
     );
  return found;
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_09010800_begin_gateway_before_exact_existing;
revoke all on function public.sp_09010800_begin_gateway_before_exact_existing(
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
  v_exact_permit_path boolean := false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  select exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id
  ) into v_exact_permit_path;
  if v_exact_permit_path then
    if not sellerpilot_private.exact_existing_update_provider_allowed(
      p_job_id, p_claim_token
    ) then return false; end if;
    v_started :=
      public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
        p_token_hash, p_job_id, p_claim_token
      );
    if coalesce(v_started, false)
       and not sellerpilot_private.consume_exact_existing_update_provider(
         p_job_id, p_claim_token
       )
    then
      raise exception 'exact existing update permit consumption failed'
        using errcode = '40001';
    end if;
    return coalesce(v_started, false);
  end if;
  return public.sp_09010800_begin_gateway_before_exact_existing(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_09010800_begin_serverless_before_exact_existing;
revoke all on function
  public.sp_09010800_begin_serverless_before_exact_existing(text, uuid, uuid)
  from public, anon, authenticated, service_role;

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
  v_exact_permit_path boolean := false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  select exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id
  ) into v_exact_permit_path;
  if v_exact_permit_path then
    if not sellerpilot_private.exact_existing_update_provider_allowed(
      p_job_id, p_claim_token
    ) then return false; end if;
    v_started :=
      public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
        p_token_hash, p_job_id, p_claim_token
      );
    if coalesce(v_started, false)
       and not sellerpilot_private.consume_exact_existing_update_provider(
         p_job_id, p_claim_token
       )
    then
      raise exception 'exact existing update permit consumption failed'
        using errcode = '40001';
    end if;
    return coalesce(v_started, false);
  end if;
  return public.sp_09010800_begin_serverless_before_exact_existing(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_release_is_current(text, text),
  sellerpilot_private.exact_existing_update_arguments_valid(
    text, jsonb, text, text, integer
  ),
  sellerpilot_private.guard_exact_existing_update_job(),
  sellerpilot_private.bind_exact_existing_update_claim(jsonb, jsonb),
  sellerpilot_private.exact_existing_update_lineage_is_current(uuid),
  sellerpilot_private.guard_exact_existing_update_permit_transition(),
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ),
  sellerpilot_private.exact_existing_update_provider_allowed(uuid, uuid),
  sellerpilot_private.consume_exact_existing_update_provider(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_arm_exact_existing_update(
    text, uuid, uuid, text, text
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
  public.sellerpilot_service_arm_exact_existing_update(
    text, uuid, uuid, text, text
  ),
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ),
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  )
  to service_role;

do $exact_existing_update_permit_postimage$
declare
  v_signature regprocedure;
  v_definition text;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.exact_existing_update_permits'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_arm_exact_existing_update(text,uuid,uuid,text,text)'
     ) is null
     or not exists (
       select 1
         from pg_catalog.pg_class relation
        where relation.oid =
              'sellerpilot_private.exact_existing_update_permits'::regclass
          and relation.relrowsecurity
     )
     or exists (
       select 1
         from (values
           ('public'::name), ('anon'::name), ('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_table_privilege(
          role.role_name,
          'sellerpilot_private.exact_existing_update_permits',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
     )
     or exists (
       select 1
         from (values
           ('public'::name), ('anon'::name), ('authenticated'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'public.sellerpilot_service_arm_exact_existing_update(text,uuid,uuid,text,text)',
          'EXECUTE'
        )
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_arm_exact_existing_update(text,uuid,uuid,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_namespace namespace
           on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname in (
            'sellerpilot_service_arm_exact_existing_update',
            'sellerpilot_service_enqueue_listing_gateway_job',
            'sellerpilot_service_begin_gateway_provider_mutation',
            'sellerpilot_service_begin_serverless_gateway_provider_mutation'
          )
          and (
            not procedure.prosecdef
            or procedure.proconfig is distinct from
                 array['search_path=""']::text[]
            or pg_catalog.pg_get_userbyid(procedure.proowner)
                 is distinct from current_user
          )
     )
  then
    raise exception 'exact existing update permit postimage invalid'
      using errcode = '55000';
  end if;

  foreach v_signature in array array[
    'public.sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    if pg_catalog.strpos(
         v_definition, 'qoo10_exact_localization_enqueue_gate_bypass_allowed'
       ) = 0
       or pg_catalog.strpos(
         v_definition, 'smartstore_exact_qa_enqueue_gate_bypass_allowed'
       ) = 0
       or pg_catalog.strpos(
         v_definition, 'exact_existing_update_enqueue_gate_bypass_allowed'
       ) = 0
    then
      raise exception 'exact existing enqueue postimage invalid: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition, 'bind_exact_qoo10_localization_update_claim'
     ) = 0
     or pg_catalog.strpos(
       v_definition, 'bind_exact_smartstore_qa_update_claim'
     ) = 0
     or pg_catalog.strpos(
       v_definition, 'bind_exact_existing_update_claim'
     ) = 0
  then
    raise exception 'exact existing claim postimage invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from sellerpilot_private.exact_existing_update_permits
  ) then
    raise exception 'exact existing permit migration synthesized work'
      using errcode = '55000';
  end if;
end;
$exact_existing_update_permit_postimage$;

comment on table sellerpilot_private.exact_existing_update_permits is
  'Five-minute one-use permits for only the exact existing Coupang, 11st, and eBay QA listing updates. Each permit freezes credential and listing lineage, one runtime SHA, one request fingerprint, one first claim, and one provider boundary without opening the general release gate.';

comment on function public.sellerpilot_service_arm_exact_existing_update(
  text, uuid, uuid, text, text
) is
  'Arms one short-lived exact existing-listing update after server-owned channel-specific identity, credential lineage, snapshot, runtime release, and closed-gate checks. Lazada and generic listing mutations are excluded.';

commit;
