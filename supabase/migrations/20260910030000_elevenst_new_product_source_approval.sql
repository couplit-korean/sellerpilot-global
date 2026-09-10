-- Server-owned production and approval boundary for the Elevenst 1346631
-- source ledger. This migration creates no approval rows and calls no provider.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702600);

do $migration$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.elevenst_new_product_server_sources'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_registration_drafts'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create table sellerpilot_private.elevenst_new_product_source_approvals (
  source_id uuid primary key references
    sellerpilot_private.elevenst_new_product_server_sources(id) on delete restrict,
  approval_request_id uuid not null unique,
  actor_id uuid not null references auth.users(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  draft_version bigint not null check (draft_version > 0),
  detail_manifest_digest text not null check (
    detail_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  approval_payload_sha256 text not null check (
    approval_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  approved_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table sellerpilot_private.elevenst_new_product_source_retirements (
  id bigint generated always as identity primary key,
  source_id uuid not null references
    sellerpilot_private.elevenst_new_product_server_sources(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (
    pg_catalog.char_length(pg_catalog.btrim(reason)) between 1 and 500
    and reason !~ '[[:cntrl:]]'
  ),
  retired_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on sellerpilot_private.elevenst_new_product_source_approvals
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.elevenst_new_product_source_retirements
  from public, anon, authenticated, service_role;
revoke all on sequence
  sellerpilot_private.elevenst_new_product_source_retirements_id_seq
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_new_product_source_approval_hash(
  p_payload jsonb
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      coalesce(p_payload, 'null'::jsonb)::text,
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function
  sellerpilot_private.elevenst_new_product_source_approval_hash(jsonb)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_elevenst_new_product_approval_context(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  product_row sellerpilot_private.products%rowtype;
  credential_row sellerpilot_private.channel_credentials%rowtype;
  draft_row sellerpilot_private.product_registration_drafts%rowtype;
  assignment_row sellerpilot_private.product_category_assignments%rowtype;
  source_paths jsonb;
  channel_draft jsonb;
  detail_paths jsonb;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null
     or p_product_id is null
     or p_credential_id is null
     or nullif(pg_catalog.btrim(p_market), '') is null
     or nullif(pg_catalog.btrim(p_target_id), '') is null
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor_id
     ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  select product.* into product_row
    from sellerpilot_private.products product
   where product.id = p_product_id
     and not product.demo
     and product.status <> 'archived';
  if not found then return null; end if;

  select credential.* into credential_row
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.created_by = product_row.owner_id
     and credential.channel = 'elevenst'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.statement_timestamp());
  if not found then return null; end if;

  select assignment.* into assignment_row
    from sellerpilot_private.product_category_assignments assignment
   where assignment.owner_id = product_row.owner_id
     and assignment.product_id = product_row.id
     and assignment.channel = 'elevenst'
     and assignment.environment = 'production'
     and assignment.market = pg_catalog.btrim(p_market)
     and assignment.category_id = '1346631'
     and assignment.status = 'confirmed'
     and assignment.is_leaf
     and assignment.confirmed_at is not null;
  if not found then return null; end if;

  select draft.* into draft_row
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = product_row.owner_id
     and draft.draft_id = product_row.id
     and draft.kind = 'publish'
     and draft.product_id = product_row.id;
  if not found then return null; end if;

  select entry.value into channel_draft
    from pg_catalog.jsonb_each(
      case when pg_catalog.jsonb_typeof(draft_row.data->'channels') = 'object'
        then draft_row.data->'channels' else '{}'::jsonb end
    ) entry
   where entry.key = pg_catalog.array_to_json(array[
       'elevenst', pg_catalog.btrim(p_market), pg_catalog.btrim(p_target_id),
       credential_row.id::text
     ])::text
     and entry.value->>'categoryId' = '1346631';
  if not found then return null; end if;

  if product_row.detail_page_version < 1
     or product_row.on_hand < 1
     or product_row.detail_page_approved_version
       is distinct from product_row.detail_page_version
     or pg_catalog.jsonb_typeof(product_row.detail_page_image_manifest) <> 'object'
     or product_row.detail_page_image_manifest->>'digest'
       !~ '^[a-f0-9]{64}$'
     or pg_catalog.jsonb_typeof(
       product_row.detail_page_image_manifest->'images'
     ) <> 'array'
     or pg_catalog.jsonb_array_length(
       product_row.detail_page_image_manifest->'images'
     ) <> 8
     or coalesce(draft_row.data#>>'{common,price}', '') !~ '^[0-9]+$'
     or coalesce(draft_row.data#>>'{common,quantity}', '') !~ '^[0-9]+$'
     or draft_row.data#>>'{common,fields,productName}'
       is distinct from product_row.name
     or nullif(pg_catalog.btrim(
       draft_row.data#>>'{common,fields,brandName}'
     ), '') is null
     or nullif(pg_catalog.btrim(
       draft_row.data#>>'{common,fields,countryOfOrigin}'
     ), '') is null then
    return null;
  end if;
  if (draft_row.data#>>'{common,price}')::numeric <= 0
     or pg_catalog.mod((draft_row.data#>>'{common,price}')::numeric, 10) <> 0
     or (draft_row.data#>>'{common,price}')::numeric
       <> pg_catalog.trunc((draft_row.data#>>'{common,price}')::numeric)
     or (draft_row.data#>>'{common,quantity}')::numeric
       <> product_row.on_hand then
    return null;
  end if;

  select coalesce(pg_catalog.jsonb_agg(path order by ordinal), '[]'::jsonb)
    into source_paths
    from (
      select item.value #>> '{}' as path, item.ordinality as ordinal
        from sellerpilot_private.ai_cli_jobs job
        cross join lateral pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(job.request_payload->'image_paths') = 'array'
            then job.request_payload->'image_paths' else '[]'::jsonb end
        ) with ordinality item(value, ordinality)
       where job.id = product_row.ai_job_id
         and job.created_by = product_row.owner_id
         and item.value #>> '{}' like product_row.owner_id::text || '/%'
    ) paths;

  select coalesce(
      pg_catalog.jsonb_agg(image.value->>'path' order by image.ordinality),
      '[]'::jsonb
    )
    into detail_paths
    from pg_catalog.jsonb_array_elements(
      product_row.detail_page_image_manifest->'images'
    ) with ordinality image(value, ordinality)
   where nullif(pg_catalog.btrim(image.value->>'path'), '') is not null;
  if coalesce(pg_catalog.jsonb_array_length(source_paths), 0) <> 4
     or coalesce(pg_catalog.jsonb_array_length(detail_paths), 0) <> 8 then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_approval_context_v1',
    'actorId', p_actor_id,
    'ownerId', product_row.owner_id,
    'productId', product_row.id,
    'productUpdatedAt', product_row.updated_at,
    'productRevision', product_row.detail_page_version,
    'productApprovalRevision', product_row.detail_page_approved_version,
    'productName', product_row.name,
    'sellerProductCode', product_row.sku,
    'inventoryQuantity', product_row.on_hand,
    'credentialId', credential_row.id,
    'credentialVersion', credential_row.version,
    'draftVersion', draft_row.version,
    'approvedPriceKrw', (draft_row.data#>>'{common,price}')::integer,
    'approvedQuantity', (draft_row.data#>>'{common,quantity}')::integer,
    'brand', pg_catalog.btrim(
      draft_row.data#>>'{common,fields,brandName}'
    ),
    'countryOfOrigin', pg_catalog.btrim(
      draft_row.data#>>'{common,fields,countryOfOrigin}'
    ),
    'conditionCode', '01',
    'productImagePaths', source_paths,
    'detailImagePaths', detail_paths,
    'detailManifestDigest', product_row.detail_page_image_manifest->>'digest'
  );
end;
$$;

create function public.sellerpilot_service_approve_elevenst_new_product_source(
  p_actor_id uuid,
  p_approval_request_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  existing_approval sellerpilot_private.elevenst_new_product_source_approvals%rowtype;
  payload_hash text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_approval_request_id is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 786432 then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  if coalesce(p_payload->>'credentialVersion', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'productRevision', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'productApprovalRevision', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'draftVersion', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload#>>'{providerProduct,selPrc}', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload#>>'{providerProduct,prdSelQty}', '') !~ '^[0-9]+$'
     or coalesce(p_payload#>>'{sellerReceipt,credentialVersion}', '')
       !~ '^[1-9][0-9]*$'
     or coalesce(p_payload#>>'{policySource,shipping,shippingFeeKrw}', '')
       !~ '^[0-9]+$'
     or coalesce(p_payload->>'policySourceRevision', '') !~ '^[1-9][0-9]*$'
     or coalesce(p_payload->>'policyApprovalRevision', '') !~ '^[1-9][0-9]*$' then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  context_value := public.sellerpilot_service_elevenst_new_product_approval_context(
    p_actor_id, p_product_id, p_credential_id, p_market, p_target_id
  );
  if context_value is null then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONTEXT_STALE'
      using errcode = '40001';
  end if;
  payload_hash := sellerpilot_private.elevenst_new_product_source_approval_hash(
    p_payload
  );

  select approval.* into existing_approval
    from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.approval_request_id = p_approval_request_id;
  if found then
    if existing_approval.actor_id = p_actor_id
       and existing_approval.product_id = p_product_id
       and existing_approval.credential_id = p_credential_id
       and existing_approval.approval_payload_sha256 = payload_hash then
      return pg_catalog.jsonb_build_object(
        'status', 'existing', 'sourceId', existing_approval.source_id,
        'approvalPayloadSha256', payload_hash
      );
    end if;
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_REQUEST_CONFLICT'
      using errcode = '23505';
  end if;

  if p_payload->>'contract'
       is distinct from 'sellerpilot_elevenst_new_product_source_approval_v1'
     or p_payload->>'approvalRequestId'
       is distinct from p_approval_request_id::text
     or p_payload->>'actorId' is distinct from p_actor_id::text
     or p_payload->>'ownerId' is distinct from context_value->>'ownerId'
     or p_payload->>'productId' is distinct from context_value->>'productId'
     or p_payload->>'categoryId' is distinct from '1346631'
     or p_payload->>'credentialId'
       is distinct from context_value->>'credentialId'
     or (p_payload->>'credentialVersion')::integer
       is distinct from (context_value->>'credentialVersion')::integer
     or p_payload->>'productUpdatedAt'
       is distinct from context_value->>'productUpdatedAt'
     or (p_payload->>'productRevision')::bigint
       is distinct from (context_value->>'productRevision')::bigint
     or (p_payload->>'productApprovalRevision')::bigint
       is distinct from (context_value->>'productApprovalRevision')::bigint
     or (p_payload->>'draftVersion')::bigint
       is distinct from (context_value->>'draftVersion')::bigint
     or p_payload->>'detailManifestDigest'
       is distinct from context_value->>'detailManifestDigest'
     or pg_catalog.jsonb_typeof(p_payload->'providerProduct') <> 'object'
     or p_payload#>>'{providerProduct,dispCtgrNo}' is distinct from '1346631'
     or p_payload#>>'{providerProduct,prdNm}'
       is distinct from context_value->>'productName'
     or p_payload#>>'{providerProduct,sellerPrdCd}'
       is distinct from context_value->>'sellerProductCode'
     or (p_payload#>>'{providerProduct,selPrc}')::integer
       is distinct from (context_value->>'approvedPriceKrw')::integer
     or (p_payload#>>'{providerProduct,prdSelQty}')::integer
       is distinct from (context_value->>'approvedQuantity')::integer
     or p_payload#>>'{providerProduct,brand}'
       is distinct from context_value->>'brand'
     or p_payload#>>'{providerProduct,orgnNmVal}'
       is distinct from context_value->>'countryOfOrigin'
     or p_payload#>>'{providerProduct,prdStatCd}'
       is distinct from context_value->>'conditionCode'
     or p_payload->>'providerProductSha256' !~ '^[a-f0-9]{64}$'
     or pg_catalog.jsonb_typeof(p_payload->'notices') <> 'array'
     or pg_catalog.jsonb_array_length(p_payload->'notices') <> 10
     or (select pg_catalog.array_agg(notice.value->>'code' order by notice.ordinality)
           from pg_catalog.jsonb_array_elements(p_payload->'notices')
             with ordinality notice(value, ordinality))
       is distinct from array[
         '176400445','176398001','42154823','23757260','23757095',
         '176312674','23756754','23757245','42155152','23757000'
       ]::text[]
     or p_payload#>>'{sellerReceipt,credentialId}'
       is distinct from context_value->>'credentialId'
     or (p_payload#>>'{sellerReceipt,credentialVersion}')::integer
       is distinct from (context_value->>'credentialVersion')::integer
     or p_payload#>>'{sellerReceipt,sellerIdSha256}'
       is distinct from p_payload#>>'{sellerReceipt,sellerOfficeAccountSha256}'
     or p_payload#>>'{sellerReceipt,sellerIdSha256}' !~ '^[a-f0-9]{64}$'
     or p_payload#>>'{availabilityReceipt,state}' is distinct from 'available'
     or (p_payload#>>'{policySource,shipping,shippingFeeKrw}')::integer
       is distinct from 3000
     or p_payload#>>'{policySource,shipping,deliveryCostBasisCode}'
       is distinct from '02'
     or p_payload#>>'{policySource,shipping,paymentTypeCode}'
       is distinct from '03'
     or coalesce(pg_catalog.jsonb_array_length(
       p_payload#>'{policySource,content,productImageUrls}'
     ), -1) <> 4
     or coalesce(pg_catalog.jsonb_array_length(
       p_payload#>'{policySource,content,detailImageUrls}'
     ), -1) <> 8
     or (p_payload->>'policySourceRevision')::bigint
       is distinct from (context_value->>'draftVersion')::bigint
     or (p_payload->>'policyApprovalRevision')::bigint
       is distinct from (context_value->>'draftVersion')::bigint then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_PAYLOAD_INVALID'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from sellerpilot_private.elevenst_new_product_server_sources source
     where source.product_id = p_product_id
       and source.credential_id = p_credential_id
       and source.status = 'approved'
  ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ALREADY_EXISTS'
      using errcode = '23505';
  end if;

  insert into sellerpilot_private.elevenst_new_product_server_sources (
    owner_id, product_id, category_id, credential_id, credential_version,
    product_updated_at, product_revision, product_approval_revision,
    approved_price_krw, approved_inventory_quantity, provider_product,
    provider_product_sha256, notices, seller_receipt, availability_receipt,
    policy_source, policy_source_revision, policy_approval_revision,
    approved_at, created_by
  ) values (
    (context_value->>'ownerId')::uuid,
    p_product_id,
    '1346631',
    p_credential_id,
    (context_value->>'credentialVersion')::integer,
    (context_value->>'productUpdatedAt')::timestamptz,
    (context_value->>'productRevision')::bigint,
    (context_value->>'productApprovalRevision')::bigint,
    (context_value->>'approvedPriceKrw')::integer,
    (context_value->>'approvedQuantity')::integer,
    p_payload->'providerProduct',
    p_payload->>'providerProductSha256',
    p_payload->'notices',
    p_payload->'sellerReceipt',
    p_payload->'availabilityReceipt',
    p_payload->'policySource',
    (p_payload->>'policySourceRevision')::bigint,
    (p_payload->>'policyApprovalRevision')::bigint,
    pg_catalog.clock_timestamp(),
    (context_value->>'ownerId')::uuid
  ) returning * into source_row;

  insert into sellerpilot_private.elevenst_new_product_source_approvals (
    source_id, approval_request_id, actor_id, owner_id, product_id,
    credential_id, credential_version, draft_version,
    detail_manifest_digest, approval_payload_sha256
  ) values (
    source_row.id, p_approval_request_id, p_actor_id, source_row.owner_id,
    source_row.product_id, source_row.credential_id,
    source_row.credential_version, (context_value->>'draftVersion')::bigint,
    context_value->>'detailManifestDigest', payload_hash
  );

  return pg_catalog.jsonb_build_object(
    'status', 'approved', 'sourceId', source_row.id,
    'approvalPayloadSha256', payload_hash
  );
end;
$$;

create function public.sellerpilot_service_retire_elevenst_new_product_source(
  p_actor_id uuid,
  p_source_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null
     or p_source_id is null
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_reason, '')))
       not between 1 and 500
     or p_reason ~ '[[:cntrl:]]'
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = p_actor_id
     ) then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_RETIRE_ACCESS_DENIED'
      using errcode = '42501';
  end if;

  select source.* into source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id = p_source_id
   for update;
  if not found then return false; end if;
  if source_row.status = 'retired' then return true; end if;

  update sellerpilot_private.elevenst_new_product_server_sources source
     set status = 'retired'
   where source.id = source_row.id;
  insert into sellerpilot_private.elevenst_new_product_source_retirements (
    source_id, actor_id, reason
  ) values (source_row.id, p_actor_id, pg_catalog.btrim(p_reason));
  return true;
end;
$$;

revoke all on function
  public.sellerpilot_service_elevenst_new_product_approval_context(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid, uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_retire_elevenst_new_product_source(
    uuid, uuid, text
  ) from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_elevenst_new_product_approval_context(
    uuid, uuid, uuid, text, text
  ) to service_role;
grant execute on function
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid, uuid, uuid, uuid, text, text, jsonb
  ) to service_role;
grant execute on function
  public.sellerpilot_service_retire_elevenst_new_product_source(
    uuid, uuid, text
  ) to service_role;

commit;
