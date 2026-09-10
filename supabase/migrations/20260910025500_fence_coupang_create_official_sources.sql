-- Persist the exact durable and official sources used to enqueue a Coupang
-- listing.create, then compare them again at the first provider boundary.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.product_listings') is null
     or to_regclass('sellerpilot_private.products') is null
     or to_regclass('sellerpilot_private.product_category_assignments') is null
     or to_regclass('sellerpilot_private.admin_users') is null
     or to_regprocedure('sellerpilot_private.guard_coupang_create_source_revision()') is null then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_PREIMAGE_REQUIRED';
  end if;
  if to_regclass('sellerpilot_private.coupang_create_official_source_snapshots') is not null then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_ALREADY_DEFINED';
  end if;
end $$;

-- Matches the recursively sorted canonical JSON used by the TS evidence
-- builder. This is only needed for the TS-owned evidenceSha256 contract.
create function sellerpilot_private.coupang_create_official_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'array' then
      select '[' || coalesce(pg_catalog.string_agg(
        sellerpilot_private.coupang_create_official_canonical_json(item.value),
        ',' order by item.ordinal
      ), '') || ']'
        into result
        from pg_catalog.jsonb_array_elements(p_value)
             with ordinality item(value, ordinal);
      return result;
    when 'object' then
      select '{' || coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(entry.key)::text || ':' ||
          sellerpilot_private.coupang_create_official_canonical_json(entry.value),
        ',' order by entry.key collate "C"
      ), '') || '}'
        into result
        from pg_catalog.jsonb_each(p_value) entry(key, value);
      return result;
    else
      return p_value::text;
  end case;
end;
$$;

create function sellerpilot_private.coupang_create_official_sha256(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(
    sellerpilot_private.coupang_create_official_canonical_json(p_value),
    'sha256'
  ), 'hex')
$$;

create function sellerpilot_private.coupang_create_official_request_components(
  p_arguments jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'category', pg_catalog.jsonb_build_object(
      'displayCategoryCode', p_arguments#>'{body,displayCategoryCode}'
    ),
    'options', coalesce((
      select pg_catalog.jsonb_agg(
        item.value - array['notices', 'certifications', 'outboundShippingTimeDay']
        order by item.ordinal
      )
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(p_arguments#>'{body,items}') = 'array'
            then p_arguments#>'{body,items}' else '[]'::jsonb end
        ) with ordinality item(value, ordinal)
    ), '[]'::jsonb),
    'notices', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'externalVendorSku', item.value->'externalVendorSku',
        'notices', item.value->'notices',
        'certifications', item.value->'certifications'
      ) order by item.ordinal)
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(p_arguments#>'{body,items}') = 'array'
            then p_arguments#>'{body,items}' else '[]'::jsonb end
        ) with ordinality item(value, ordinal)
    ), '[]'::jsonb),
    'shipping', pg_catalog.jsonb_build_object(
      'outboundShippingPlaceCode', p_arguments#>'{body,outboundShippingPlaceCode}',
      'deliveryMethod', p_arguments#>'{body,deliveryMethod}',
      'deliveryCompanyCode', p_arguments#>'{body,deliveryCompanyCode}',
      'deliveryChargeType', p_arguments#>'{body,deliveryChargeType}',
      'deliveryCharge', p_arguments#>'{body,deliveryCharge}',
      'freeShipOverAmount', p_arguments#>'{body,freeShipOverAmount}',
      'deliveryChargeOnReturn', p_arguments#>'{body,deliveryChargeOnReturn}',
      'remoteAreaDeliverable', p_arguments#>'{body,remoteAreaDeliverable}',
      'unionDeliveryType', p_arguments#>'{body,unionDeliveryType}',
      'outboundShippingTimeDays', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'externalVendorSku', item.value->'externalVendorSku',
          'outboundShippingTimeDay', item.value->'outboundShippingTimeDay'
        ) order by item.ordinal)
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(p_arguments#>'{body,items}') = 'array'
              then p_arguments#>'{body,items}' else '[]'::jsonb end
          ) with ordinality item(value, ordinal)
      ), '[]'::jsonb),
      'source', p_arguments#>'{sellerpilotAssets,shipping}'
    ),
    'return', pg_catalog.jsonb_build_object(
      'returnCenterCode', p_arguments#>'{body,returnCenterCode}',
      'returnCharge', p_arguments#>'{body,returnCharge}',
      'returnChargeName', p_arguments#>'{body,returnChargeName}',
      'companyContactNumber', p_arguments#>'{body,companyContactNumber}',
      'returnZipCode', p_arguments#>'{body,returnZipCode}',
      'returnAddress', p_arguments#>'{body,returnAddress}',
      'returnAddressDetail', p_arguments#>'{body,returnAddressDetail}'
    )
  )
$$;

create table sellerpilot_private.coupang_create_official_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (length(credential_fingerprint) between 1 and 512),
  environment text not null check (environment in ('sandbox', 'production')),
  category_assignment_id uuid not null,
  category_id text not null check (category_id ~ '^[1-9][0-9]*$'),
  source_product jsonb not null check (pg_catalog.jsonb_typeof(source_product) = 'object'),
  source_category jsonb not null check (pg_catalog.jsonb_typeof(source_category) = 'object'),
  source_detail jsonb not null check (pg_catalog.jsonb_typeof(source_detail) = 'object'),
  source_credential jsonb not null check (pg_catalog.jsonb_typeof(source_credential) = 'object'),
  source_components jsonb not null check (pg_catalog.jsonb_typeof(source_components) = 'object'),
  official_read_snapshot_payload jsonb not null check (
    pg_catalog.jsonb_typeof(official_read_snapshot_payload) = 'object'
    and official_read_snapshot_payload->>'contract' =
      'sellerpilot_coupang_create_official_read_snapshot_payload_v1'
  ),
  official_read_evidence jsonb not null check (
    pg_catalog.jsonb_typeof(official_read_evidence) = 'object'
    and official_read_evidence->>'contract' =
      'sellerpilot_coupang_create_official_read_evidence_v1'
  ),
  category_metadata_sha256 text not null check (category_metadata_sha256 ~ '^[a-f0-9]{64}$'),
  category_status_sha256 text not null check (category_status_sha256 ~ '^[a-f0-9]{64}$'),
  outbound_shipping_places_sha256 text not null check (outbound_shipping_places_sha256 ~ '^[a-f0-9]{64}$'),
  return_centers_sha256 text not null check (return_centers_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_revision_sha256 text not null check (evidence_revision_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_digest_sha256 text not null check (snapshot_digest_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at - observed_at = interval '5 minutes')
);
create index coupang_create_official_source_snapshots_expiry_idx
  on sellerpilot_private.coupang_create_official_source_snapshots (expires_at);
revoke all on sellerpilot_private.coupang_create_official_source_snapshots
  from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_create_official_snapshot_digest(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_category_assignment_id uuid,
  p_product jsonb,
  p_category jsonb,
  p_detail jsonb,
  p_credential jsonb,
  p_components jsonb,
  p_official_read_snapshot_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_coupang_create_official_source_snapshot_v1',
    'ownerId', p_owner_id,
    'productId', p_product_id,
    'credentialId', p_credential_id,
    'categoryAssignmentId', p_category_assignment_id,
    'sourceProduct', p_product,
    'sourceCategory', p_category,
    'sourceDetail', p_detail,
    'sourceCredential', p_credential,
    'sourceComponents', p_components,
    'officialReadSnapshotPayload', p_official_read_snapshot_payload
  )::text, 'sha256'), 'hex')
$$;

create function public.sellerpilot_service_record_coupang_create_official_source_snapshot(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_arguments jsonb,
  p_official_read_snapshot_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  official_read_evidence jsonb;
  normalized_reads jsonb;
  evidence_core jsonb;
  source_product jsonb;
  source_category jsonb;
  source_detail jsonb;
  source_credential jsonb;
  source_components jsonb;
  snapshot_id uuid := gen_random_uuid();
  snapshot_digest text;
  observed_at timestamptz;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     or p_owner_id is null
     or not exists (
       select 1 from sellerpilot_private.admin_users admin_user
        where admin_user.user_id = p_owner_id
     ) then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_arguments) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_official_read_snapshot_payload) is distinct from 'object'
     or pg_catalog.octet_length(p_official_read_snapshot_payload::text) > 512000
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_official_read_snapshot_payload)) <> 3
     or p_official_read_snapshot_payload->>'contract' is distinct from
          'sellerpilot_coupang_create_official_read_snapshot_payload_v1'
     or pg_catalog.jsonb_typeof(p_official_read_snapshot_payload->'officialReadEvidence') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_official_read_snapshot_payload->'normalizedReads') is distinct from 'object'
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(
          p_official_read_snapshot_payload->'normalizedReads')) <> 4
     or not (p_official_read_snapshot_payload->'normalizedReads'
          ?& array['categoryMetadata','categoryStatus','outboundShippingPlaces','returnCenters']) then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_INVALID' using errcode = '22023';
  end if;
  official_read_evidence := p_official_read_snapshot_payload->'officialReadEvidence';
  normalized_reads := p_official_read_snapshot_payload->'normalizedReads';
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(official_read_evidence)) <> 9
     or official_read_evidence->>'contract' is distinct from
          'sellerpilot_coupang_create_official_read_evidence_v1'
     or coalesce(official_read_evidence->>'displayCategoryCode', '') !~ '^[1-9][0-9]*$'
     or official_read_evidence->>'displayCategoryCode' is distinct from
          p_arguments#>>'{body,displayCategoryCode}'
     or official_read_evidence->>'environment' not in ('sandbox', 'production')
     or coalesce(official_read_evidence->>'observedAt', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     or coalesce(official_read_evidence->>'categoryMetadataSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read_evidence->>'categoryStatusSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read_evidence->>'outboundShippingPlacesSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read_evidence->>'returnCentersSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read_evidence->>'evidenceSha256', '') !~ '^[a-f0-9]{64}$'
     or official_read_evidence->>'categoryMetadataSha256' is distinct from
          sellerpilot_private.coupang_create_official_sha256(normalized_reads->'categoryMetadata')
     or official_read_evidence->>'categoryStatusSha256' is distinct from
          sellerpilot_private.coupang_create_official_sha256(normalized_reads->'categoryStatus')
     or official_read_evidence->>'outboundShippingPlacesSha256' is distinct from
          sellerpilot_private.coupang_create_official_sha256(normalized_reads->'outboundShippingPlaces')
     or official_read_evidence->>'returnCentersSha256' is distinct from
          sellerpilot_private.coupang_create_official_sha256(normalized_reads->'returnCenters') then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_INVALID' using errcode = '22023';
  end if;
  begin
    observed_at := (official_read_evidence->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_INVALID' using errcode = '22023';
  end;
  if observed_at < pg_catalog.clock_timestamp() - interval '5 minutes'
     or observed_at > pg_catalog.clock_timestamp() + interval '5 seconds' then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_STALE' using errcode = '23514';
  end if;
  evidence_core := official_read_evidence - 'evidenceSha256';
  if official_read_evidence->>'evidenceSha256' is distinct from
       sellerpilot_private.coupang_create_official_sha256(evidence_core) then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_EVIDENCE_MISMATCH' using errcode = '23514';
  end if;

  select row.* into product from sellerpilot_private.products row
   where row.id = p_product_id and row.owner_id = p_owner_id
     and not row.demo and row.status <> 'archived' for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_PRODUCT_INVALID' using errcode = '23514'; end if;
  select row.* into credential from sellerpilot_private.channel_credentials row
     where row.id = p_credential_id and row.channel = 'coupang'
     and row.environment = official_read_evidence->>'environment'
     and row.status = 'active'
     and (row.expires_at is null or row.expires_at > pg_catalog.clock_timestamp())
   for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_CREDENTIAL_INVALID' using errcode = '23514'; end if;
  select row.* into assignment
    from sellerpilot_private.product_category_assignments row
   where row.owner_id = p_owner_id and row.product_id = p_product_id
     and row.channel = 'coupang' and row.environment = credential.environment
     and row.category_id = official_read_evidence->>'displayCategoryCode'
     and row.status = 'confirmed' and row.is_leaf
     and row.confirmed_at is not null and row.official_verified_at is not null
     and pg_catalog.jsonb_typeof(row.missing_required_attributes) = 'array'
     and pg_catalog.jsonb_array_length(row.missing_required_attributes) = 0
   order by row.updated_at desc, row.id
   limit 1 for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_CATEGORY_INVALID' using errcode = '23514'; end if;

  source_product := pg_catalog.jsonb_build_object(
    'id', product.id, 'ownerId', product.owner_id, 'sku', product.sku,
    'name', product.name, 'onHand', product.on_hand, 'costKrw', product.cost_krw,
    'productFacts', product.product_facts, 'status', product.status,
    'updatedAt', product.updated_at);
  source_category := pg_catalog.jsonb_build_object(
    'id', assignment.id, 'ownerId', assignment.owner_id, 'productId', assignment.product_id,
    'channel', assignment.channel, 'environment', assignment.environment,
    'market', assignment.market, 'categoryId', assignment.category_id,
    'categoryPath', assignment.category_path, 'isLeaf', assignment.is_leaf,
    'classificationSource', assignment.classification_source,
    'requiredAttributes', assignment.required_attributes,
    'providedAttributes', assignment.provided_attributes,
    'missingRequiredAttributes', assignment.missing_required_attributes,
    'officialMetadata', assignment.official_metadata, 'status', assignment.status,
    'officialVerifiedAt', assignment.official_verified_at,
    'confirmedAt', assignment.confirmed_at, 'updatedAt', assignment.updated_at);
  source_detail := pg_catalog.jsonb_build_object(
    'data', product.detail_page_data, 'version', product.detail_page_version,
    'approvedVersion', product.detail_page_approved_version,
    'imageManifest', product.detail_page_image_manifest,
    'updatedAt', product.detail_page_updated_at);
  source_credential := pg_catalog.jsonb_build_object(
    'id', credential.id, 'channel', credential.channel,
    'environment', credential.environment, 'version', credential.version,
    'fingerprint', credential.fingerprint, 'status', credential.status,
    'expiresAt', credential.expires_at,
    'sellerAccountKey', credential.seller_account_key,
    'sellerAccountKeySource', credential.seller_account_key_source,
    'sellerAccountVerifiedAt', credential.seller_account_verified_at);
  source_components := sellerpilot_private.coupang_create_official_request_components(p_arguments);
  snapshot_digest := sellerpilot_private.coupang_create_official_snapshot_digest(
    p_owner_id, p_product_id, credential.id, assignment.id,
    source_product, source_category, source_detail, source_credential,
    source_components, p_official_read_snapshot_payload);

  insert into sellerpilot_private.coupang_create_official_source_snapshots (
    id, owner_id, product_id, credential_id, credential_version,
    credential_fingerprint, environment, category_assignment_id, category_id,
    source_product, source_category, source_detail, source_credential,
    source_components, official_read_snapshot_payload, official_read_evidence,
    category_metadata_sha256, category_status_sha256,
    outbound_shipping_places_sha256, return_centers_sha256,
    evidence_revision_sha256, snapshot_digest_sha256, observed_at, expires_at
  ) values (
    snapshot_id, p_owner_id, p_product_id, credential.id, credential.version,
    credential.fingerprint, credential.environment, assignment.id, assignment.category_id,
    source_product, source_category, source_detail, source_credential,
    source_components, p_official_read_snapshot_payload, official_read_evidence,
    official_read_evidence->>'categoryMetadataSha256',
    official_read_evidence->>'categoryStatusSha256',
    official_read_evidence->>'outboundShippingPlacesSha256',
    official_read_evidence->>'returnCentersSha256',
    official_read_evidence->>'evidenceSha256', snapshot_digest,
    observed_at, observed_at + interval '5 minutes');
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_coupang_create_official_source_snapshot_v1',
    'snapshotId', snapshot_id, 'snapshotDigestSha256', snapshot_digest);
end;
$$;

revoke all on function public.sellerpilot_service_record_coupang_create_official_source_snapshot(
  uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_coupang_create_official_source_snapshot(
  uuid, uuid, uuid, jsonb, jsonb
) to service_role;

create function sellerpilot_private.guard_coupang_create_official_snapshot_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_IMMUTABLE' using errcode = '23514';
end;
$$;
create trigger coupang_create_official_source_snapshots_immutable
before update or delete on sellerpilot_private.coupang_create_official_source_snapshots
for each row execute function sellerpilot_private.guard_coupang_create_official_snapshot_immutable();

create function sellerpilot_private.guard_coupang_create_official_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  binding jsonb;
  snapshot sellerpilot_private.coupang_create_official_source_snapshots%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  current_product jsonb;
  current_category jsonb;
  current_detail jsonb;
  current_credential jsonb;
  current_components jsonb;
begin
  if new.channel <> 'coupang' or new.operation <> 'listing.create'
     or old.provider_mutation_started_at is not null
     or new.provider_mutation_started_at is null then return new; end if;
  binding := new.request_payload#>'{arguments,sellerpilotCoupangCreateSourceRevision}';
  if coalesce(binding->>'officialReadSnapshotId', '')
       !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
     or coalesce(binding->>'officialReadSnapshotDigestSha256', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514';
  end if;
  select row.* into snapshot
    from sellerpilot_private.coupang_create_official_source_snapshots row
   where row.id = (binding->>'officialReadSnapshotId')::uuid for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514'; end if;
  select row.* into listing from sellerpilot_private.product_listings row
   where row.id = new.listing_id and row.owner_id = snapshot.owner_id
     and row.product_id = snapshot.product_id and row.channel_key = 'coupang'
     and row.operation_attempt_id = new.attempt_id for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514'; end if;
  select row.* into product from sellerpilot_private.products row
   where row.id = snapshot.product_id and row.owner_id = snapshot.owner_id
     and not row.demo and row.status <> 'archived' for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514'; end if;
  select row.* into credential from sellerpilot_private.channel_credentials row
   where row.id = snapshot.credential_id and row.channel = 'coupang'
     and row.environment = snapshot.environment and row.status = 'active'
     and (row.expires_at is null or row.expires_at > pg_catalog.clock_timestamp())
   for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514'; end if;
  select row.* into assignment from sellerpilot_private.product_category_assignments row
   where row.id = snapshot.category_assignment_id and row.owner_id = snapshot.owner_id
     and row.product_id = snapshot.product_id and row.channel = 'coupang'
     and row.environment = snapshot.environment and row.category_id = snapshot.category_id
     and row.status = 'confirmed' and row.is_leaf and row.confirmed_at is not null
     and row.official_verified_at is not null
     and pg_catalog.jsonb_typeof(row.missing_required_attributes) = 'array'
     and pg_catalog.jsonb_array_length(row.missing_required_attributes) = 0
   for key share;
  if not found then raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514'; end if;

  current_product := pg_catalog.jsonb_build_object(
    'id', product.id, 'ownerId', product.owner_id, 'sku', product.sku,
    'name', product.name, 'onHand', product.on_hand, 'costKrw', product.cost_krw,
    'productFacts', product.product_facts, 'status', product.status,
    'updatedAt', product.updated_at);
  current_category := pg_catalog.jsonb_build_object(
    'id', assignment.id, 'ownerId', assignment.owner_id, 'productId', assignment.product_id,
    'channel', assignment.channel, 'environment', assignment.environment,
    'market', assignment.market, 'categoryId', assignment.category_id,
    'categoryPath', assignment.category_path, 'isLeaf', assignment.is_leaf,
    'classificationSource', assignment.classification_source,
    'requiredAttributes', assignment.required_attributes,
    'providedAttributes', assignment.provided_attributes,
    'missingRequiredAttributes', assignment.missing_required_attributes,
    'officialMetadata', assignment.official_metadata, 'status', assignment.status,
    'officialVerifiedAt', assignment.official_verified_at,
    'confirmedAt', assignment.confirmed_at, 'updatedAt', assignment.updated_at);
  current_detail := pg_catalog.jsonb_build_object(
    'data', product.detail_page_data, 'version', product.detail_page_version,
    'approvedVersion', product.detail_page_approved_version,
    'imageManifest', product.detail_page_image_manifest,
    'updatedAt', product.detail_page_updated_at);
  current_credential := pg_catalog.jsonb_build_object(
    'id', credential.id, 'channel', credential.channel,
    'environment', credential.environment, 'version', credential.version,
    'fingerprint', credential.fingerprint, 'status', credential.status,
    'expiresAt', credential.expires_at,
    'sellerAccountKey', credential.seller_account_key,
    'sellerAccountKeySource', credential.seller_account_key_source,
    'sellerAccountVerifiedAt', credential.seller_account_verified_at);
  current_components := sellerpilot_private.coupang_create_official_request_components(
    new.request_payload->'arguments');

  if snapshot.owner_id is distinct from new.created_by
     or snapshot.credential_id is distinct from new.credential_id
     or snapshot.environment is distinct from new.environment
     or new.status is distinct from 'running'
     or new.claim_token is null
     or new.lease_expires_at is null
     or new.lease_expires_at <= pg_catalog.clock_timestamp()
     or binding->>'productId' is distinct from snapshot.product_id::text
     or binding->'officialReadEvidence' is distinct from snapshot.official_read_evidence
     or binding->>'officialReadSnapshotDigestSha256' is distinct from snapshot.snapshot_digest_sha256
     or new.request_payload#>>'{arguments,body,displayCategoryCode}' is distinct from snapshot.category_id
     or snapshot.expires_at <= pg_catalog.clock_timestamp()
     or snapshot.source_product is distinct from current_product
     or snapshot.source_category is distinct from current_category
     or snapshot.source_detail is distinct from current_detail
     or snapshot.source_credential is distinct from current_credential
     or snapshot.source_components is distinct from current_components
     or snapshot.official_read_snapshot_payload->>'contract' is distinct from
          'sellerpilot_coupang_create_official_read_snapshot_payload_v1'
     or snapshot.official_read_snapshot_payload->'officialReadEvidence' is distinct from
          snapshot.official_read_evidence
     or snapshot.official_read_evidence->>'evidenceSha256' is distinct from
          sellerpilot_private.coupang_create_official_sha256(
            snapshot.official_read_evidence - 'evidenceSha256')
     or snapshot.category_metadata_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(
            snapshot.official_read_snapshot_payload#>'{normalizedReads,categoryMetadata}')
     or snapshot.category_status_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(
            snapshot.official_read_snapshot_payload#>'{normalizedReads,categoryStatus}')
     or snapshot.outbound_shipping_places_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(
            snapshot.official_read_snapshot_payload#>'{normalizedReads,outboundShippingPlaces}')
     or snapshot.return_centers_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(
            snapshot.official_read_snapshot_payload#>'{normalizedReads,returnCenters}')
     or snapshot.snapshot_digest_sha256 is distinct from
       sellerpilot_private.coupang_create_official_snapshot_digest(
         snapshot.owner_id, snapshot.product_id, snapshot.credential_id,
         snapshot.category_assignment_id, current_product, current_category,
         current_detail, current_credential, current_components,
         snapshot.official_read_snapshot_payload)
     or snapshot.evidence_revision_sha256 is distinct from
          snapshot.official_read_evidence->>'evidenceSha256'
     or snapshot.category_metadata_sha256 is distinct from
          snapshot.official_read_evidence->>'categoryMetadataSha256'
     or snapshot.category_status_sha256 is distinct from
          snapshot.official_read_evidence->>'categoryStatusSha256'
     or snapshot.outbound_shipping_places_sha256 is distinct from
          snapshot.official_read_evidence->>'outboundShippingPlacesSha256'
     or snapshot.return_centers_sha256 is distinct from
          snapshot.official_read_evidence->>'returnCentersSha256' then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger channel_gateway_jobs_coupang_create_official_source_guard
before update of provider_mutation_started_at on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_coupang_create_official_sources();

revoke all on function sellerpilot_private.coupang_create_official_canonical_json(jsonb) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.coupang_create_official_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.coupang_create_official_request_components(jsonb) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.coupang_create_official_snapshot_digest(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.guard_coupang_create_official_snapshot_immutable() from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.guard_coupang_create_official_sources() from public, anon, authenticated, service_role;

comment on table sellerpilot_private.coupang_create_official_source_snapshots is
  'Immutable five-minute Coupang CREATE official evidence plus exact durable source and request-component CAS.';
comment on function public.sellerpilot_service_record_coupang_create_official_source_snapshot(uuid,uuid,uuid,jsonb,jsonb) is
  'Service-only snapshot recorder. Returns snapshotId and snapshotDigestSha256 for the server-owned CREATE binding.';
commit;
