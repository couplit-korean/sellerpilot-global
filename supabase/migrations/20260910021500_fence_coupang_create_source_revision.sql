-- Refuse a Coupang CREATE provider boundary unless the complete server-owned
-- input revision and current credential incarnation still match.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.product_listings') is null
     or to_regclass('sellerpilot_private.products') is null then
    raise exception 'COUPANG_CREATE_SOURCE_REVISION_PREIMAGE_REQUIRED';
  end if;
  if to_regprocedure('sellerpilot_private.guard_coupang_create_source_revision()') is not null then
    raise exception 'COUPANG_CREATE_SOURCE_REVISION_ALREADY_DEFINED';
  end if;
end $$;

create function sellerpilot_private.guard_coupang_create_source_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  binding jsonb;
  source jsonb;
  official_read jsonb;
  credential sellerpilot_private.channel_credentials%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
begin
  if new.channel <> 'coupang'
     or new.operation <> 'listing.create'
     or old.provider_mutation_started_at is not null
     or new.provider_mutation_started_at is null then
    return new;
  end if;

  binding := new.request_payload#>'{arguments,sellerpilotCoupangCreateSourceRevision}';
  source := binding->'productSource';
  official_read := binding->'officialReadEvidence';
  select row.* into credential
    from sellerpilot_private.channel_credentials row
   where row.id = new.credential_id
     and row.channel = 'coupang'
     and row.environment = new.environment
     and row.status = 'active'
     and (row.expires_at is null or row.expires_at > pg_catalog.clock_timestamp())
   for key share;
  select row.* into listing
    from sellerpilot_private.product_listings row
   where row.id = new.listing_id
     and row.channel_key = 'coupang'
     and row.operation_attempt_id = new.attempt_id
     and row.owner_id = new.created_by
   for key share;
  if found then
    select row.* into product
      from sellerpilot_private.products row
     where row.id = listing.product_id
       and row.owner_id = listing.owner_id
       and not row.demo
       and row.status <> 'archived'
     for key share;
  end if;

  if jsonb_typeof(binding) is distinct from 'object'
     or binding->>'contract' is distinct from 'sellerpilot_coupang_create_source_revision_v1'
     or binding->>'productId' is distinct from product.id::text
     or jsonb_typeof(source) is distinct from 'object'
     or source->>'sku' is distinct from product.sku
     or source->>'name' is distinct from product.name
     or coalesce(source->>'onHand', '') !~ '^[0-9]+$'
     or (source->>'onHand')::integer is distinct from product.on_hand
     or coalesce(source->>'costKrw', '') !~ '^[0-9]+(?:\.[0-9]+)?$'
     or (source->>'costKrw')::numeric is distinct from product.cost_krw
     or coalesce(binding->>'detailPageVersion', '') !~ '^[1-9][0-9]*$'
     or (binding->>'detailPageVersion')::integer is distinct from product.detail_page_version
     or product.detail_page_approved_version is distinct from product.detail_page_version
     or binding->>'approvedManifestDigest' is distinct from product.detail_page_image_manifest->>'digest'
     or jsonb_typeof(official_read) is distinct from 'object'
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(official_read)) <> 9
     or official_read->>'contract' is distinct from 'sellerpilot_coupang_create_official_read_evidence_v1'
     or official_read->>'environment' is distinct from new.environment
     or coalesce(official_read->>'displayCategoryCode', '') !~ '^[1-9][0-9]*$'
     or official_read->>'displayCategoryCode'
       is distinct from new.request_payload#>>'{arguments,body,displayCategoryCode}'
     or coalesce(official_read->>'observedAt', '')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     or (case when coalesce(official_read->>'observedAt', '')
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
       then ((official_read->>'observedAt')::timestamptz
         < pg_catalog.clock_timestamp() - interval '5 minutes'
         or (official_read->>'observedAt')::timestamptz
         > pg_catalog.clock_timestamp() + interval '5 seconds')
       else true end)
     or coalesce(official_read->>'categoryMetadataSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read->>'categoryStatusSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read->>'outboundShippingPlacesSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read->>'returnCentersSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(official_read->>'evidenceSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(binding->>'productSourceSha256', '') !~ '^[a-f0-9]{64}$'
     or coalesce(binding->>'sourceRevisionSha256', '') !~ '^[a-f0-9]{64}$'
     or binding->>'credentialId' is distinct from credential.id::text
     or coalesce(binding->>'credentialVersion', '') !~ '^[1-9][0-9]*$'
     or (binding->>'credentialVersion')::integer is distinct from credential.version
     or binding->>'credentialFingerprint' is distinct from credential.fingerprint
     or binding->>'credentialEnvironment' is distinct from credential.environment
     or coalesce(binding->>'credentialSellerIdentitySha256', '') !~ '^[a-f0-9]{64}$'
     or binding->>'market' is distinct from pg_catalog.upper(listing.market)
     or binding->>'targetId' is distinct from listing.target_id
     or new.request_fingerprint is null
     or new.request_fingerprint !~ '^[a-f0-9]{64}$'
     or new.request_payload#>>'{arguments,publicationExpectedFingerprint}'
       is distinct from new.request_fingerprint then
    raise exception 'COUPANG_CREATE_SOURCE_REVISION_MISMATCH'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger channel_gateway_jobs_coupang_create_source_revision_guard
before update of provider_mutation_started_at
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_coupang_create_source_revision();

revoke all on function sellerpilot_private.guard_coupang_create_source_revision()
  from public, anon, authenticated, service_role;

comment on function sellerpilot_private.guard_coupang_create_source_revision() is
  'At the first Coupang CREATE provider boundary, rechecks one server-owned category/options/notices/commerce/shipping/approved-image/source-product/current-credential revision.';

commit;
