-- Seal both the image-prepared gateway transmission and the exact Coupang
-- provider body. The provider-mutation timestamp and final body seal are
-- committed by one service-only transaction immediately before POST.
begin;

-- R8 selected the requested category correctly but counted only rows with the
-- same category id. A product must have exactly one current valid confirmed
-- Coupang category across the owner/product/environment tuple.
create function sellerpilot_private.guard_coupang_snapshot_one_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assignment_count integer;
begin
  select pg_catalog.count(*) into assignment_count
    from sellerpilot_private.product_category_assignments assignment
   where assignment.owner_id=new.owner_id
     and assignment.product_id=new.product_id
     and assignment.channel='coupang'
     and assignment.environment=new.environment
     and assignment.status='confirmed' and assignment.is_leaf
     and assignment.confirmed_at is not null
     and assignment.official_verified_at is not null
     and pg_catalog.jsonb_typeof(assignment.missing_required_attributes)='array'
     and pg_catalog.jsonb_array_length(assignment.missing_required_attributes)=0;
  if assignment_count<>1 then
    raise exception 'COUPANG_CREATE_OFFICIAL_SOURCE_CATEGORY_INVALID'
      using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function sellerpilot_private.guard_coupang_snapshot_one_category()
  from public,anon,authenticated,service_role;
create trigger coupang_create_snapshot_one_category_guard
before insert on sellerpilot_private.coupang_create_official_source_snapshots
for each row execute function sellerpilot_private.guard_coupang_snapshot_one_category();

create function sellerpilot_private.coupang_create_body_without_transport(p_body jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select (coalesce(p_body, '{}'::jsonb) - 'items') || pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(item.value - array['images','contents'] order by item.ordinal)
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(p_body->'items') = 'array'
          then p_body->'items' else '[]'::jsonb end
      ) with ordinality item(value, ordinal)
    ), '[]'::jsonb)
  )
$$;

create function sellerpilot_private.coupang_create_transport_identity(p_body jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'externalVendorSku', item.value->'externalVendorSku',
      'images', item.value->'images',
      'contents', item.value->'contents'
    ) order by item.ordinal)
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_body->'items') = 'array'
        then p_body->'items' else '[]'::jsonb end
    ) with ordinality item(value, ordinal)
  ), '[]'::jsonb)
$$;

create function sellerpilot_private.coupang_create_provider_source_identity(p_body jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'displayCategoryCode',p_body->'displayCategoryCode',
    'sellerProductName',p_body->'sellerProductName',
    'displayProductName',p_body->'displayProductName',
    'brand',p_body->'brand',
    'deliveryMethod',p_body->'deliveryMethod',
    'items',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'externalVendorSku',item.value->'externalVendorSku',
        'itemName',item.value->'itemName',
        'barcode',item.value->'barcode',
        'emptyBarcode',item.value->'emptyBarcode',
        'emptyBarcodeReason',item.value->'emptyBarcodeReason',
        'modelNo',item.value->'modelNo',
        'salePrice',item.value->'salePrice',
        'originalPrice',item.value->'originalPrice',
        'maximumBuyCount',item.value->'maximumBuyCount',
        'maximumBuyForPerson',item.value->'maximumBuyForPerson',
        'unitCount',item.value->'unitCount',
        'outboundShippingTimeDay',item.value->'outboundShippingTimeDay',
        'images',item.value->'images','contents',item.value->'contents'
      ) order by item.ordinal)
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(p_body->'items')='array'
          then p_body->'items' else '[]'::jsonb end
      ) with ordinality item(value,ordinal)
    ),'[]'::jsonb)
  )
$$;

create table sellerpilot_private.coupang_create_transmissions (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references sellerpilot_private.coupang_create_official_source_snapshots(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  source_snapshot_digest_sha256 text not null check (source_snapshot_digest_sha256 ~ '^[a-f0-9]{64}$'),
  transmission_body jsonb not null check (pg_catalog.jsonb_typeof(transmission_body) = 'object'),
  transmission_body_sha256 text not null check (transmission_body_sha256 ~ '^[a-f0-9]{64}$'),
  publication_asset_binding jsonb not null check (pg_catalog.jsonb_typeof(publication_asset_binding) = 'object'),
  transmission_digest_sha256 text not null check (transmission_digest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  unique (attempt_id)
);
alter table sellerpilot_private.coupang_create_transmissions enable row level security;
revoke all on sellerpilot_private.coupang_create_transmissions from public, anon, authenticated, service_role;

create table sellerpilot_private.coupang_create_provider_body_seals (
  id uuid primary key default gen_random_uuid(),
  transmission_id uuid not null references sellerpilot_private.coupang_create_transmissions(id) on delete restrict,
  source_snapshot_id uuid not null references sellerpilot_private.coupang_create_official_source_snapshots(id) on delete restrict,
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  listing_id uuid not null references sellerpilot_private.product_listings(id) on delete restrict,
  attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  claim_token uuid not null,
  credential_vault_secret_id uuid not null,
  credential_secret_sha256 text not null check (credential_secret_sha256 ~ '^[a-f0-9]{64}$'),
  provider_body jsonb not null check (pg_catalog.jsonb_typeof(provider_body) = 'object'),
  provider_body_sha256 text not null check (provider_body_sha256 ~ '^[a-f0-9]{64}$'),
  sealed_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (job_id)
);
alter table sellerpilot_private.coupang_create_provider_body_seals enable row level security;
revoke all on sellerpilot_private.coupang_create_provider_body_seals from public, anon, authenticated, service_role;

create function sellerpilot_private.reject_coupang_create_boundary_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'COUPANG_CREATE_BOUNDARY_IMMUTABLE' using errcode = '23514';
end;
$$;
create trigger coupang_create_transmissions_immutable before update or delete
on sellerpilot_private.coupang_create_transmissions for each row
execute function sellerpilot_private.reject_coupang_create_boundary_mutation();
create trigger coupang_create_provider_body_seals_immutable before update or delete
on sellerpilot_private.coupang_create_provider_body_seals for each row
execute function sellerpilot_private.reject_coupang_create_boundary_mutation();

create function public.sellerpilot_service_record_coupang_create_transmission(
  p_owner_id uuid, p_product_id uuid, p_credential_id uuid,
  p_attempt_id uuid, p_arguments jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  snapshot sellerpilot_private.coupang_create_official_source_snapshots%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  source_binding jsonb := p_arguments->'sellerpilotCoupangCreateSourceRevision';
  asset_binding jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  body jsonb := p_arguments->'body';
  body_sha text;
  transmission_digest text;
  transmission_id uuid := gen_random_uuid();
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     or not exists (select 1 from sellerpilot_private.admin_users a where a.user_id = p_owner_id)
     or pg_catalog.jsonb_typeof(body) is distinct from 'object'
     or asset_binding->>'contract' is distinct from 'sellerpilot_publication_asset_binding_v1' then
    raise exception 'COUPANG_CREATE_TRANSMISSION_INVALID' using errcode = '23514';
  end if;
  select s.* into snapshot from sellerpilot_private.coupang_create_official_source_snapshots s
   where s.id = (source_binding->>'officialReadSnapshotId')::uuid
     and s.snapshot_digest_sha256 = source_binding->>'officialReadSnapshotDigestSha256'
     and s.owner_id = p_owner_id and s.product_id = p_product_id
     and s.credential_id = p_credential_id and s.expires_at > pg_catalog.clock_timestamp()
   for key share;
  if not found then raise exception 'COUPANG_CREATE_TRANSMISSION_SOURCE_MISMATCH' using errcode = '23514'; end if;
  select a.* into attempt from sellerpilot_private.channel_operation_attempts a
   where a.id = p_attempt_id and a.owner_id = p_owner_id
     and a.credential_id = p_credential_id and a.channel = 'coupang'
     and a.operation = 'listing.create' and a.status = 'running' for key share;
  if not found
     or sellerpilot_private.coupang_create_body_without_transport(snapshot.source_provider_body)
        is distinct from sellerpilot_private.coupang_create_body_without_transport(body)
     or asset_binding->>'approvedManifestDigest'
        is distinct from snapshot.source_detail#>>'{imageManifest,digest}'
     or pg_catalog.jsonb_array_length(
          sellerpilot_private.coupang_create_transport_identity(body)) = 0 then
    raise exception 'COUPANG_CREATE_TRANSMISSION_SOURCE_MISMATCH' using errcode = '23514';
  end if;
  body_sha := sellerpilot_private.coupang_create_official_sha256(body);
  transmission_digest := sellerpilot_private.coupang_create_official_sha256(
    pg_catalog.jsonb_build_object(
      'contract','sellerpilot_coupang_create_transmission_v1',
      'sourceSnapshotId',snapshot.id,'sourceSnapshotDigestSha256',snapshot.snapshot_digest_sha256,
      'attemptId',p_attempt_id,'body',body,'bodySha256',body_sha,
      'publicationAssetBinding',asset_binding));
  insert into sellerpilot_private.coupang_create_transmissions(
    id,source_snapshot_id,owner_id,product_id,credential_id,attempt_id,
    source_snapshot_digest_sha256,transmission_body,transmission_body_sha256,
    publication_asset_binding,transmission_digest_sha256,expires_at
  ) values (
    transmission_id,snapshot.id,p_owner_id,p_product_id,p_credential_id,p_attempt_id,
    snapshot.snapshot_digest_sha256,body,body_sha,asset_binding,transmission_digest,
    least(snapshot.expires_at,pg_catalog.clock_timestamp()+interval '5 minutes'));
  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_coupang_create_transmission_v1',
    'transmissionId',transmission_id,'attemptId',p_attempt_id,
    'sourceSnapshotId',snapshot.id,
    'sourceSnapshotDigestSha256',snapshot.snapshot_digest_sha256,
    'transmissionBodySha256',body_sha,
    'transmissionDigestSha256',transmission_digest);
exception when invalid_text_representation then
  raise exception 'COUPANG_CREATE_TRANSMISSION_INVALID' using errcode = '23514';
end;
$$;

-- The old r8 trigger compared the pre-image body with the queued body. Replace
-- it with a guard that requires a private exact-body seal created in the same
-- transaction as the mutation timestamp.
drop trigger if exists channel_gateway_jobs_coupang_create_official_source_guard
on sellerpilot_private.channel_gateway_jobs;
create or replace function sellerpilot_private.guard_coupang_create_official_sources()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  seal sellerpilot_private.coupang_create_provider_body_seals%rowtype;
  transmission sellerpilot_private.coupang_create_transmissions%rowtype;
  snapshot sellerpilot_private.coupang_create_official_source_snapshots%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  secret jsonb;
begin
  if new.channel <> 'coupang' or new.operation <> 'listing.create'
     or old.provider_mutation_started_at is not null
     or new.provider_mutation_started_at is null then return new; end if;
  select s.* into seal from sellerpilot_private.coupang_create_provider_body_seals s
   where s.job_id = new.id and s.claim_token = new.claim_token for key share;
  if not found then raise exception 'COUPANG_CREATE_PROVIDER_BODY_SEAL_REQUIRED' using errcode = '23514'; end if;
  select t.* into transmission from sellerpilot_private.coupang_create_transmissions t
   where t.id = seal.transmission_id and t.expires_at > pg_catalog.clock_timestamp() for key share;
  select s.* into snapshot from sellerpilot_private.coupang_create_official_source_snapshots s
   where s.id = seal.source_snapshot_id and s.expires_at > pg_catalog.clock_timestamp() for key share;
  select c.* into credential from sellerpilot_private.channel_credentials c
   where c.id = new.credential_id and c.status = 'active' and c.vault_secret_id is not null
     and (c.expires_at is null or c.expires_at > pg_catalog.clock_timestamp()) for key share;
  select d.decrypted_secret::jsonb into secret from vault.decrypted_secrets d
   where d.id = credential.vault_secret_id;
  if transmission.id is null or snapshot.id is null or credential.id is null or secret is null
     or seal.listing_id is distinct from new.listing_id
     or seal.attempt_id is distinct from new.attempt_id
     or seal.credential_id is distinct from new.credential_id
     or transmission.attempt_id is distinct from new.attempt_id
     or transmission.source_snapshot_id is distinct from snapshot.id
     or transmission.source_snapshot_digest_sha256 is distinct from snapshot.snapshot_digest_sha256
     or seal.credential_vault_secret_id is distinct from credential.vault_secret_id
     or seal.credential_secret_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(secret)
     or seal.provider_body_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(seal.provider_body)
     or new.request_payload#>'{arguments,sellerpilotCoupangCreateTransmission}' is distinct from
          pg_catalog.jsonb_build_object(
            'contract','sellerpilot_coupang_create_transmission_v1',
            'transmissionId',transmission.id,'attemptId',transmission.attempt_id,
            'sourceSnapshotId',snapshot.id,
            'sourceSnapshotDigestSha256',snapshot.snapshot_digest_sha256,
            'transmissionBodySha256',transmission.transmission_body_sha256,
            'transmissionDigestSha256',transmission.transmission_digest_sha256)
  then raise exception 'COUPANG_CREATE_PROVIDER_BODY_SEAL_MISMATCH' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger channel_gateway_jobs_coupang_create_official_source_guard
before update on sellerpilot_private.channel_gateway_jobs for each row
execute function sellerpilot_private.guard_coupang_create_official_sources();

create function public.sellerpilot_service_begin_coupang_create_provider_mutation(
  p_token_hash text, p_job_id uuid, p_claim_token uuid, p_provider_body jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  transmission sellerpilot_private.coupang_create_transmissions%rowtype;
  snapshot sellerpilot_private.coupang_create_official_source_snapshots%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  product sellerpilot_private.products%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  secret jsonb;
  binding jsonb;
  body_sha text;
  transmission_digest text;
  current_product jsonb;
  current_category jsonb;
  current_detail jsonb;
  current_credential jsonb;
  current_components jsonb;
  provider_components jsonb;
  expected_provider_body jsonb;
  expected_requested boolean;
  assignment_count integer;
  worker_scope text;
  started boolean;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     or pg_catalog.jsonb_typeof(p_provider_body) is distinct from 'object' then
    raise exception 'COUPANG_CREATE_PROVIDER_BODY_INVALID' using errcode = '42501';
  end if;
  select j.* into job from sellerpilot_private.channel_gateway_jobs j
   where j.id=p_job_id and j.claim_token=p_claim_token and j.channel='coupang'
     and j.operation='listing.create' and j.status='running'
     and j.lease_expires_at>pg_catalog.clock_timestamp() for update;
  if not found then return false; end if;
  binding := job.request_payload#>'{arguments,sellerpilotCoupangCreateTransmission}';
  select t.* into transmission from sellerpilot_private.coupang_create_transmissions t
   where t.id=(binding->>'transmissionId')::uuid and t.attempt_id=job.attempt_id
     and t.credential_id=job.credential_id and t.expires_at>pg_catalog.clock_timestamp() for key share;
  if not found
     or transmission.transmission_body is distinct from job.request_payload#>'{arguments,body}'
     or transmission.publication_asset_binding is distinct from
          job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
     or binding is distinct from pg_catalog.jsonb_build_object(
          'contract','sellerpilot_coupang_create_transmission_v1',
          'transmissionId',transmission.id,'attemptId',transmission.attempt_id,
          'sourceSnapshotId',transmission.source_snapshot_id,
          'sourceSnapshotDigestSha256',transmission.source_snapshot_digest_sha256,
          'transmissionBodySha256',transmission.transmission_body_sha256,
          'transmissionDigestSha256',transmission.transmission_digest_sha256)
     or transmission.transmission_body_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(job.request_payload#>'{arguments,body}') then
    raise exception 'COUPANG_CREATE_TRANSMISSION_MISMATCH' using errcode = '23514';
  end if;
  select s.* into snapshot from sellerpilot_private.coupang_create_official_source_snapshots s
   where s.id=transmission.source_snapshot_id and s.expires_at>pg_catalog.clock_timestamp() for key share;
  select c.* into credential from sellerpilot_private.channel_credentials c
   where c.id=job.credential_id and c.channel='coupang' and c.environment=job.environment
     and c.status='active' and c.vault_secret_id is not null
     and (c.expires_at is null or c.expires_at>pg_catalog.clock_timestamp()) for key share;
  select d.decrypted_secret::jsonb into secret from vault.decrypted_secrets d
   where d.id=credential.vault_secret_id;
  select p.* into product from sellerpilot_private.products p
   where p.id=snapshot.product_id and p.owner_id=snapshot.owner_id
     and not p.demo and p.status<>'archived' for key share;
  select pg_catalog.count(*) into assignment_count
    from sellerpilot_private.product_category_assignments a
   where a.owner_id=snapshot.owner_id and a.product_id=snapshot.product_id
     and a.channel='coupang' and a.environment=snapshot.environment
     and a.status='confirmed'
     and a.is_leaf and a.confirmed_at is not null
     and a.official_verified_at is not null
     and pg_catalog.jsonb_typeof(a.missing_required_attributes)='array'
     and pg_catalog.jsonb_array_length(a.missing_required_attributes)=0;
  select a.* into assignment from sellerpilot_private.product_category_assignments a
   where a.id=snapshot.category_assignment_id and a.owner_id=snapshot.owner_id
     and a.product_id=snapshot.product_id and a.channel='coupang'
     and a.environment=snapshot.environment and a.category_id=snapshot.category_id
     and a.status='confirmed' and a.is_leaf and a.confirmed_at is not null
     and a.official_verified_at is not null
     and pg_catalog.jsonb_typeof(a.missing_required_attributes)='array'
     and pg_catalog.jsonb_array_length(a.missing_required_attributes)=0 for key share;
  select l.* into listing from sellerpilot_private.product_listings l
   where l.id=job.listing_id and l.owner_id=snapshot.owner_id
     and l.product_id=snapshot.product_id and l.channel_key='coupang'
     and l.operation_attempt_id=job.attempt_id for key share;
  current_product := pg_catalog.jsonb_build_object(
    'id',product.id,'ownerId',product.owner_id,'sku',product.sku,
    'name',product.name,'onHand',product.on_hand,'costKrw',product.cost_krw,
    'productFacts',product.product_facts,'status',product.status,
    'updatedAt',product.updated_at);
  current_category := pg_catalog.jsonb_build_object(
    'id',assignment.id,'ownerId',assignment.owner_id,'productId',assignment.product_id,
    'channel',assignment.channel,'environment',assignment.environment,
    'market',assignment.market,'categoryId',assignment.category_id,
    'categoryPath',assignment.category_path,'isLeaf',assignment.is_leaf,
    'classificationSource',assignment.classification_source,
    'requiredAttributes',assignment.required_attributes,
    'providedAttributes',assignment.provided_attributes,
    'missingRequiredAttributes',assignment.missing_required_attributes,
    'officialMetadata',assignment.official_metadata,'status',assignment.status,
    'officialVerifiedAt',assignment.official_verified_at,
    'confirmedAt',assignment.confirmed_at,'updatedAt',assignment.updated_at);
  current_detail := pg_catalog.jsonb_build_object(
    'data',product.detail_page_data,'version',product.detail_page_version,
    'approvedVersion',product.detail_page_approved_version,
    'imageManifest',product.detail_page_image_manifest,
    'updatedAt',product.detail_page_updated_at);
  current_credential := pg_catalog.jsonb_build_object(
    'id',credential.id,'channel',credential.channel,
    'environment',credential.environment,'version',credential.version,
    'fingerprint',credential.fingerprint,'vaultSecretId',credential.vault_secret_id,
    'status',credential.status,'expiresAt',credential.expires_at,
    'sellerAccountKey',credential.seller_account_key,
    'sellerAccountKeySource',credential.seller_account_key_source,
    'sellerAccountVerifiedAt',credential.seller_account_verified_at);
  current_components := sellerpilot_private.coupang_create_official_request_components(
    pg_catalog.jsonb_set(
      job.request_payload->'arguments','{body}',
      sellerpilot_private.coupang_create_body_without_transport(
        job.request_payload#>'{arguments,body}'),true));
  provider_components := sellerpilot_private.coupang_create_official_request_components(
    pg_catalog.jsonb_set(
      job.request_payload->'arguments','{body}',
      sellerpilot_private.coupang_create_body_without_transport(p_provider_body),true));
  if job.request_payload#>>'{arguments,publicationStateContract}'=
       'verified_remote_state_v1' then
    if job.request_payload#>>'{arguments,publicationIntent}' not in ('live','safe_test') then
      raise exception 'COUPANG_CREATE_PROVIDER_BODY_SOURCE_MISMATCH'
        using errcode='23514';
    end if;
    expected_requested :=
      job.request_payload#>>'{arguments,publicationIntent}'='live';
  elsif p_provider_body ? 'requested' then
    raise exception 'COUPANG_CREATE_PROVIDER_BODY_SOURCE_MISMATCH'
      using errcode='23514';
  end if;
  expected_provider_body := transmission.transmission_body
    || pg_catalog.jsonb_build_object(
      'vendorId',secret->>'vendor_id')
    || case when expected_requested is null then '{}'::jsonb
         else pg_catalog.jsonb_build_object('requested',expected_requested) end;
  transmission_digest := sellerpilot_private.coupang_create_official_sha256(
    pg_catalog.jsonb_build_object(
      'contract','sellerpilot_coupang_create_transmission_v1',
      'sourceSnapshotId',snapshot.id,
      'sourceSnapshotDigestSha256',snapshot.snapshot_digest_sha256,
      'attemptId',transmission.attempt_id,
      'body',transmission.transmission_body,
      'bodySha256',transmission.transmission_body_sha256,
      'publicationAssetBinding',transmission.publication_asset_binding));
  if snapshot.id is null or credential.id is null or secret is null
     or product.id is null or assignment.id is null or listing.id is null
     or assignment_count<>1
     or job.created_by is distinct from snapshot.owner_id
     or transmission.owner_id is distinct from snapshot.owner_id
     or transmission.product_id is distinct from snapshot.product_id
     or transmission.credential_id is distinct from snapshot.credential_id
     or transmission.source_snapshot_digest_sha256 is distinct from
          snapshot.snapshot_digest_sha256
     or snapshot.source_product is distinct from current_product
     or snapshot.source_detail is distinct from current_detail
     or snapshot.source_category is distinct from current_category
     or snapshot.source_credential is distinct from current_credential
     or snapshot.source_components is distinct from current_components
     or current_components is distinct from provider_components
     or expected_provider_body is distinct from p_provider_body
     or snapshot.provider_body_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(snapshot.source_provider_body)
     or transmission.transmission_digest_sha256 is distinct from transmission_digest
     or snapshot.snapshot_digest_sha256 is distinct from
          sellerpilot_private.coupang_create_official_snapshot_digest_r8(
            snapshot.owner_id,snapshot.product_id,snapshot.credential_id,
            snapshot.category_assignment_id,current_product,current_category,
            current_detail,current_credential,current_components,
            snapshot.source_provider_body,snapshot.provider_body_sha256,
            credential.vault_secret_id,
            sellerpilot_private.coupang_create_official_sha256(secret),
            snapshot.official_read_snapshot_payload)
     or snapshot.official_read_snapshot_payload->>'contract' is distinct from
          'sellerpilot_coupang_create_official_read_snapshot_payload_v1'
     or snapshot.official_read_snapshot_payload->'officialReadEvidence' is distinct from
          snapshot.official_read_evidence
     or snapshot.official_read_evidence->>'evidenceSha256' is distinct from
          sellerpilot_private.coupang_create_official_sha256(
            snapshot.official_read_evidence-'evidenceSha256')
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
     or snapshot.evidence_revision_sha256 is distinct from
          snapshot.official_read_evidence->>'evidenceSha256'
     or snapshot.category_metadata_sha256 is distinct from
          snapshot.official_read_evidence->>'categoryMetadataSha256'
     or snapshot.category_status_sha256 is distinct from
          snapshot.official_read_evidence->>'categoryStatusSha256'
     or snapshot.outbound_shipping_places_sha256 is distinct from
          snapshot.official_read_evidence->>'outboundShippingPlacesSha256'
     or snapshot.return_centers_sha256 is distinct from
          snapshot.official_read_evidence->>'returnCentersSha256'
     or snapshot.credential_vault_secret_id is distinct from credential.vault_secret_id
     or snapshot.credential_secret_sha256 is distinct from
          sellerpilot_private.coupang_create_official_sha256(secret)
     or p_provider_body->>'vendorId' is distinct from secret->>'vendor_id'
     or p_provider_body->>'vendorUserId' is distinct from secret->>'requested_by'
     or p_provider_body->>'displayCategoryCode' is distinct from snapshot.category_id
     or sellerpilot_private.coupang_create_provider_source_identity(p_provider_body)
        is distinct from
          sellerpilot_private.coupang_create_provider_source_identity(transmission.transmission_body)
     or sellerpilot_private.coupang_create_transport_identity(p_provider_body)
        is distinct from sellerpilot_private.coupang_create_transport_identity(transmission.transmission_body)
  then raise exception 'COUPANG_CREATE_PROVIDER_BODY_SOURCE_MISMATCH' using errcode = '23514'; end if;
  perform sellerpilot_private.assert_coupang_create_official_semantics(
    pg_catalog.jsonb_build_object('body',p_provider_body),
    snapshot.official_read_snapshot_payload->'normalizedReads');
  body_sha := sellerpilot_private.coupang_create_official_sha256(p_provider_body);
  insert into sellerpilot_private.coupang_create_provider_body_seals(
    transmission_id,source_snapshot_id,job_id,listing_id,attempt_id,credential_id,
    claim_token,credential_vault_secret_id,credential_secret_sha256,
    provider_body,provider_body_sha256
  ) values (
    transmission.id,snapshot.id,job.id,job.listing_id,job.attempt_id,job.credential_id,
    job.claim_token,credential.vault_secret_id,
    sellerpilot_private.coupang_create_official_sha256(secret),p_provider_body,body_sha)
  on conflict (job_id) do nothing;
  if not exists (select 1 from sellerpilot_private.coupang_create_provider_body_seals s
      where s.job_id=job.id and s.claim_token=job.claim_token
        and s.provider_body_sha256=body_sha and s.provider_body=p_provider_body) then
    raise exception 'COUPANG_CREATE_PROVIDER_BODY_SEAL_CONFLICT' using errcode = '23514';
  end if;
  select token.scope into worker_scope
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.id=job.worker_token_id and token.token_hash=p_token_hash
     and token.scope in ('gateway','serverless_cs')
     and token.status='active'
     and token.expires_at>pg_catalog.clock_timestamp();
  if worker_scope is null then
    raise exception 'COUPANG_CREATE_PROVIDER_MUTATION_NOT_STARTED'
      using errcode='40001';
  end if;
  if job.provider_mutation_started_at is not null then return true; end if;
  if worker_scope='gateway' then
    started := public.sellerpilot_service_begin_gateway_provider_mutation(
      p_token_hash,p_job_id,p_claim_token);
  else
    started := public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash,p_job_id,p_claim_token);
  end if;
  if not coalesce(started,false) then
    raise exception 'COUPANG_CREATE_PROVIDER_MUTATION_NOT_STARTED' using errcode = '40001';
  end if;
  return true;
exception when invalid_text_representation then
  raise exception 'COUPANG_CREATE_PROVIDER_BODY_INVALID' using errcode = '23514';
end;
$$;

revoke all on function public.sellerpilot_service_record_coupang_create_transmission(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_record_coupang_create_transmission(uuid,uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.sellerpilot_service_begin_coupang_create_provider_mutation(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_begin_coupang_create_provider_mutation(text,uuid,uuid,jsonb) to service_role;
revoke all on function sellerpilot_private.coupang_create_body_without_transport(jsonb) from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.coupang_create_transport_identity(jsonb) from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.coupang_create_provider_source_identity(jsonb) from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.reject_coupang_create_boundary_mutation() from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.guard_coupang_create_official_sources() from public,anon,authenticated,service_role;

comment on function public.sellerpilot_service_begin_coupang_create_provider_mutation(text,uuid,uuid,jsonb) is
  'Atomically seals the exact final Coupang CREATE body and crosses the provider mutation boundary immediately before POST.';
commit;
