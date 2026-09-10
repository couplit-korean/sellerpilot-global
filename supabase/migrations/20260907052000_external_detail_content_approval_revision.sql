-- Bind external-detail approval to immutable customer-facing content instead
-- of the products.updated_at bookkeeping clock. Existing approved assets and
-- documents are reviewed in place; this migration never rewrites them.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900705200);

do $migration$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_hash(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.request_has_unambiguous_service_role_claim()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_external_detail_import(text,uuid,uuid,uuid,jsonb)'
     ) is null then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_REVISION_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create table sellerpilot_private.external_detail_approval_revisions (
  import_id uuid not null
    references sellerpilot_private.external_detail_imports(id),
  revision bigint not null check (revision > 0),
  product_id uuid not null
    references sellerpilot_private.products(id),
  owner_id uuid not null references auth.users(id),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_snapshot jsonb not null check (
    jsonb_typeof(content_snapshot) = 'object'
    and content_snapshot->>'contract' = 'sellerpilot_external_detail_content_v1'
    and octet_length(content_snapshot::text) <= 2097152
  ),
  detail_version bigint not null check (detail_version > 0),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  reason text not null check (reason in ('initial_approval','content_rebind')),
  previous_revision bigint check (previous_revision is null or previous_revision > 0),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  legacy_approved_product_updated_at timestamptz not null,
  primary key (import_id, revision),
  unique (import_id, revision, content_sha256),
  check (
    (revision = 1 and previous_revision is null)
    or (revision > 1 and previous_revision = revision - 1)
  )
);

create index external_detail_approval_revisions_product_idx
  on sellerpilot_private.external_detail_approval_revisions
  (product_id, revision desc);

alter table sellerpilot_private.external_detail_approval_revisions
  enable row level security;

revoke all on sellerpilot_private.external_detail_approval_revisions
  from public, anon, authenticated, service_role;

create function sellerpilot_private.external_detail_approval_content_snapshot(
  p_product uuid,
  p_import uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'sellerpilot_external_detail_content_v1',
    'productId', product.id,
    'ownerId', product.owner_id,
    'importId', external_import.id,
    'requestSha256', external_import.request_sha256,
    'detailVersion', product.detail_page_version,
    'product', jsonb_build_object(
      'externalCode', product.external_code,
      'sku', product.sku,
      'name', product.name,
      'description', product.description,
      'sourceUrl', product.source_url,
      'imageUrl', product.image_url,
      'aiJobId', product.ai_job_id,
      'productFacts', coalesce(product.product_facts, '{}'::jsonb) - 'stock',
      'detailPageData', product.detail_page_data,
      'detailPageApprovedVersion', product.detail_page_approved_version,
      'detailPageImageManifest', product.detail_page_image_manifest
    ),
    'sourceJob', jsonb_build_object(
      'id', source_job.id,
      'manualFields',
        coalesce(source_job.request_payload->'manual_fields', '{}'::jsonb) - 'stock',
      'imagePaths',
        coalesce(source_job.request_payload->'image_paths', '[]'::jsonb),
      'imageSpecs',
        coalesce(source_job.request_payload->'image_specs', '[]'::jsonb)
    ),
    'approval', jsonb_build_object(
      'reviewedCopy', external_import.payload->'reviewedCopy',
      'assets', external_import.payload->'assets',
      'receipts', external_import.receipts,
      'originalEvidence', external_import.payload->'originalEvidence'
    )
  )
  from sellerpilot_private.products product
  join sellerpilot_private.external_detail_imports external_import
    on external_import.id = p_import
   and external_import.product_id = product.id
   and external_import.owner_id = product.owner_id
  join sellerpilot_private.ai_cli_jobs source_job
    on source_job.id = product.ai_job_id
   and source_job.created_by = product.owner_id
  where product.id = p_product
    and product.external_detail_import_id = external_import.id
$$;

create function sellerpilot_private.external_detail_approval_source_is_valid(
  p_import uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  external_import sellerpilot_private.external_detail_imports%rowtype;
  product sellerpilot_private.products%rowtype;
  source_job sellerpilot_private.ai_cli_jobs%rowtype;
  locale text;
  asset jsonb;
  evidence jsonb;
  source_path text;
  asset_index integer := 0;
begin
  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = p_import;

  select * into product
  from sellerpilot_private.products
  where id = external_import.product_id;

  select * into source_job
  from sellerpilot_private.ai_cli_jobs
  where id = product.ai_job_id;

  if external_import.id is null
     or external_import.status <> 'approved'
     or product.demo
     or product.status = 'archived'
     or external_import.owner_id is distinct from product.owner_id
     or product.external_detail_import_id is distinct from external_import.id
     or product.detail_page_version is distinct from
       external_import.approved_detail_version
     or product.ai_job_id is distinct from
       (external_import.payload->>'expectedAiJobId')::uuid
     or source_job.id is distinct from product.ai_job_id
     or source_job.created_by is distinct from product.owner_id
     or external_import.request_sha256 is distinct from
       sellerpilot_private.external_detail_hash(
         external_import.payload - 'requestSha256'
       )
     or external_import.payload->>'requestSha256' is distinct from
       external_import.request_sha256
     or jsonb_typeof(external_import.payload->'originalEvidence')
       is distinct from 'array'
     or jsonb_array_length(external_import.payload->'originalEvidence') < 1
     or jsonb_typeof(source_job.request_payload->'image_paths')
       is distinct from 'array'
     or jsonb_array_length(source_job.request_payload->'image_paths') < 1
     or jsonb_array_length(external_import.payload->'originalEvidence')
       is distinct from
       jsonb_array_length(source_job.request_payload->'image_paths')
     or jsonb_typeof(external_import.payload->'assets')
       is distinct from 'array'
     or jsonb_array_length(external_import.payload->'assets') is distinct from 8
     or jsonb_typeof(external_import.receipts) is distinct from 'array'
     or jsonb_array_length(external_import.receipts) is distinct from 8 then
    return false;
  end if;

  foreach locale in array array['ko','ja','en'] loop
    if external_import.payload#>>array[
         'reviewedCopy', locale, 'documentSha256'
       ] is distinct from sellerpilot_private.external_detail_hash(
         external_import.payload#>array['reviewedCopy', locale, 'document']
       ) then
      return false;
    end if;
  end loop;

  if sellerpilot_private.external_detail_hash(product.detail_page_data)
       is distinct from
       external_import.payload#>>'{reviewedCopy,ko,documentSha256}'
     or (
       select count(distinct value->>'path')
       from jsonb_array_elements(
         external_import.payload->'originalEvidence'
       )
     ) is distinct from
       jsonb_array_length(external_import.payload->'originalEvidence')
     or (
       select count(distinct value->>'sha256')
       from jsonb_array_elements(
         external_import.payload->'originalEvidence'
       )
     ) is distinct from
       jsonb_array_length(external_import.payload->'originalEvidence')
     or (
       select count(distinct value->>'assetId')
       from jsonb_array_elements(external_import.payload->'assets')
     ) is distinct from 8
     or (
       select count(distinct value->>'role')
       from jsonb_array_elements(external_import.payload->'assets')
     ) is distinct from 8
     or (
       select count(distinct value->>'sourceSha256')
       from jsonb_array_elements(external_import.payload->'assets')
     ) is distinct from 8
     or (
       select count(distinct value->>'decodedRgbaSha256')
       from jsonb_array_elements(external_import.receipts)
     ) is distinct from 8 then
    return false;
  end if;

  for asset in
    select value
    from jsonb_array_elements(external_import.payload->'assets')
  loop
    if asset->>'storagePath' is distinct from
         'external-detail/' || external_import.owner_id::text || '/' ||
         external_import.product_id::text || '/' || external_import.id::text ||
         '/' || (asset->>'assetId') || '/' ||
         (asset->>'sourceSha256') || '.png'
       or coalesce(asset->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
       or external_import.receipts#>>array[asset_index::text,'assetId']
         is distinct from asset->>'assetId'
       or external_import.receipts#>>array[asset_index::text,'role']
         is distinct from asset->>'role'
       or external_import.receipts#>>array[asset_index::text,'sourceSha256']
         is distinct from asset->>'sourceSha256'
       or external_import.receipts#>>array[asset_index::text,'byteLength']
         is distinct from asset->>'byteLength'
       or coalesce(
         external_import.receipts#>>array[
           asset_index::text, 'decodedRgbaSha256'
         ], ''
       ) !~ '^[a-f0-9]{64}$'
       or external_import.receipts#>>array[asset_index::text,'verification']
         is distinct from 'bytes_only_not_approved' then
      return false;
    end if;
    asset_index := asset_index + 1;
  end loop;

  for evidence in
    select value
    from jsonb_array_elements(external_import.payload->'originalEvidence')
  loop
    if coalesce(evidence->>'path','') not like
         external_import.owner_id::text || '/%'
       or evidence->>'path' like '%..%'
       or coalesce(evidence->>'sha256','') !~ '^[a-f0-9]{64}$'
       or not exists (
         select 1
         from jsonb_array_elements_text(
           source_job.request_payload->'image_paths'
         ) source(value)
         where source.value = evidence->>'path'
       )
       or not exists (
         select 1
         from jsonb_array_elements_text(
           external_import.payload#>'{source,referenceSha256s}'
         ) source_hash(value)
         where source_hash.value = evidence->>'sha256'
       ) then
      return false;
    end if;
  end loop;

  for source_path in
    select value
    from jsonb_array_elements_text(source_job.request_payload->'image_paths')
  loop
    if source_path not like external_import.owner_id::text || '/%'
       or source_path like '%..%'
       or not exists (
         select 1
         from jsonb_array_elements(
           external_import.payload->'originalEvidence'
         ) original(value)
         where original.value->>'path' = source_path
       ) then
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.external_detail_approval_revision_is_current(
  p_import_id uuid,
  p_revision bigint,
  p_content_sha256 text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  approval sellerpilot_private.external_detail_approval_revisions%rowtype;
  snapshot jsonb;
begin
  if p_revision is null
     or p_revision < 1
     or coalesce(p_content_sha256,'') !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  select * into approval
  from sellerpilot_private.external_detail_approval_revisions
  where import_id = p_import_id
    and revision = p_revision
    and content_sha256 = p_content_sha256;

  if approval.import_id is null
     or exists (
       select 1
       from sellerpilot_private.external_detail_approval_revisions newer
       where newer.import_id = p_import_id
         and newer.revision > approval.revision
     )
     or not sellerpilot_private.external_detail_approval_source_is_valid(
       p_import_id
     ) then
    return false;
  end if;

  snapshot := sellerpilot_private.external_detail_approval_content_snapshot(
    approval.product_id,
    approval.import_id
  );

  return snapshot is not null
    and snapshot is not distinct from approval.content_snapshot
    and sellerpilot_private.external_detail_hash(snapshot)
      = approval.content_sha256
    and snapshot->>'requestSha256' = approval.request_sha256
    and (snapshot->>'detailVersion')::bigint = approval.detail_version;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.prevent_external_detail_approval_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'EXTERNAL_DETAIL_APPROVAL_REVISION_IMMUTABLE';
end;
$$;

create trigger external_detail_approval_revision_immutable
before update or delete
on sellerpilot_private.external_detail_approval_revisions
for each row execute function
  sellerpilot_private.prevent_external_detail_approval_revision_mutation();

create function sellerpilot_private.record_initial_external_detail_approval_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  content_sha256 text;
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved' then
    if not sellerpilot_private.external_detail_approval_source_is_valid(new.id)
       then
      raise exception 'EXTERNAL_DETAIL_APPROVAL_SOURCE_INVALID';
    end if;
    snapshot := sellerpilot_private.external_detail_approval_content_snapshot(
      new.product_id,
      new.id
    );
    content_sha256 := sellerpilot_private.external_detail_hash(snapshot);
    insert into sellerpilot_private.external_detail_approval_revisions (
      import_id, revision, product_id, owner_id, content_sha256,
      content_snapshot, detail_version, request_sha256, reason,
      previous_revision, reviewed_by, legacy_approved_product_updated_at
    ) values (
      new.id, 1, new.product_id, new.owner_id, content_sha256,
      snapshot, new.approved_detail_version, new.request_sha256,
      'initial_approval', null, new.owner_id,
      new.approved_product_updated_at
    );
  end if;
  return new;
end;
$$;

create trigger external_detail_initial_approval_revision
after update of status
on sellerpilot_private.external_detail_imports
for each row execute function
  sellerpilot_private.record_initial_external_detail_approval_revision();

create function public.sellerpilot_service_rebind_external_detail_approval(
  p_actor uuid,
  p_product uuid,
  p_import uuid,
  p_expected_revision bigint,
  p_expected_content_sha256 text,
  p_expected_request_sha256 text,
  p_review_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product sellerpilot_private.products%rowtype;
  external_import sellerpilot_private.external_detail_imports%rowtype;
  latest sellerpilot_private.external_detail_approval_revisions%rowtype;
  inserted sellerpilot_private.external_detail_approval_revisions%rowtype;
  snapshot jsonb;
  content_sha256 text;
  next_revision bigint;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_REVISION_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if p_review_confirmed is distinct from true
     or coalesce(p_expected_content_sha256,'') !~ '^[a-f0-9]{64}$'
     or coalesce(p_expected_request_sha256,'') !~ '^[a-f0-9]{64}$'
     or p_expected_revision is null
     or p_expected_revision < 0 then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_REVIEW_REQUIRED';
  end if;
  if not exists (
    select 1 from sellerpilot_private.admin_users
    where user_id = p_actor
  ) then
    raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED' using errcode = '42501';
  end if;

  select * into product
  from sellerpilot_private.products
  where id = p_product
    and owner_id = p_actor
    and not demo
    and status <> 'archived'
  for update;
  if not found then
    raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED' using errcode = '42501';
  end if;

  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = p_import
    and product_id = product.id
    and owner_id = product.owner_id
  for update;
  if not found then
    raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED' using errcode = '42501';
  end if;

  if not sellerpilot_private.external_detail_approval_source_is_valid(
       external_import.id
     )
     or external_import.request_sha256 is distinct from
       p_expected_request_sha256 then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_SOURCE_INVALID';
  end if;

  snapshot := sellerpilot_private.external_detail_approval_content_snapshot(
    product.id,
    external_import.id
  );
  content_sha256 := sellerpilot_private.external_detail_hash(snapshot);
  if content_sha256 is distinct from p_expected_content_sha256 then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_CONTENT_CONFLICT';
  end if;

  select * into latest
  from sellerpilot_private.external_detail_approval_revisions
  where import_id = external_import.id
  order by revision desc
  limit 1
  for update;

  if latest.import_id is not null
     and latest.content_sha256 = content_sha256
     and latest.content_snapshot is not distinct from snapshot
     and latest.request_sha256 = external_import.request_sha256
     and p_expected_revision in (latest.revision, latest.revision - 1) then
    return jsonb_build_object(
      'importId', latest.import_id,
      'productId', latest.product_id,
      'revision', latest.revision,
      'contentSha256', latest.content_sha256,
      'detailVersion', latest.detail_version,
      'requestSha256', latest.request_sha256,
      'reason', latest.reason,
      'reviewedAt', latest.reviewed_at
    );
  end if;

  if coalesce(latest.revision, 0) is distinct from p_expected_revision then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_REVISION_CONFLICT';
  end if;

  next_revision := coalesce(latest.revision, 0) + 1;
  insert into sellerpilot_private.external_detail_approval_revisions (
    import_id, revision, product_id, owner_id, content_sha256,
    content_snapshot, detail_version, request_sha256, reason,
    previous_revision, reviewed_by, legacy_approved_product_updated_at
  ) values (
    external_import.id, next_revision, product.id, product.owner_id,
    content_sha256, snapshot, product.detail_page_version,
    external_import.request_sha256, 'content_rebind', latest.revision,
    p_actor, external_import.approved_product_updated_at
  ) returning * into inserted;

  insert into sellerpilot_private.external_detail_import_audit (
    import_id, actor_id, event, evidence
  ) values (
    external_import.id,
    p_actor,
    'content_rebind',
    jsonb_build_object(
      'revision', inserted.revision,
      'previousRevision', inserted.previous_revision,
      'contentSha256', inserted.content_sha256,
      'requestSha256', inserted.request_sha256,
      'detailVersion', inserted.detail_version,
      'reviewConfirmed', true
    )
  );

  return jsonb_build_object(
    'importId', inserted.import_id,
    'productId', inserted.product_id,
    'revision', inserted.revision,
    'contentSha256', inserted.content_sha256,
    'detailVersion', inserted.detail_version,
    'requestSha256', inserted.request_sha256,
    'reason', inserted.reason,
    'reviewedAt', inserted.reviewed_at
  );
end;
$$;

create function public.sellerpilot_service_get_external_detail_publish_context(
  p_actor uuid,
  p_product uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  product sellerpilot_private.products%rowtype;
  external_import sellerpilot_private.external_detail_imports%rowtype;
  approval sellerpilot_private.external_detail_approval_revisions%rowtype;
  source_job jsonb;
  revision_current boolean := false;
  legacy_current boolean := false;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_REVISION_ACCESS_DENIED'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from sellerpilot_private.admin_users where user_id = p_actor
  ) then
    raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED' using errcode = '42501';
  end if;

  select * into product
  from sellerpilot_private.products
  where id = p_product
    and owner_id = p_actor
    and not demo
    and status <> 'archived';
  if not found then
    raise exception 'EXTERNAL_DETAIL_OWNER_REQUIRED' using errcode = '42501';
  end if;

  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = product.external_detail_import_id
    and product_id = product.id
    and owner_id = product.owner_id;

  select * into approval
  from sellerpilot_private.external_detail_approval_revisions
  where import_id = external_import.id
  order by revision desc
  limit 1;

  if approval.import_id is not null then
    revision_current :=
      sellerpilot_private.external_detail_approval_revision_is_current(
        approval.import_id,
        approval.revision,
        approval.content_sha256
      );
  else
    legacy_current :=
      sellerpilot_private.external_detail_approval_source_is_valid(
        external_import.id
      )
      and external_import.approved_product_updated_at
        is not distinct from product.updated_at;
  end if;

  if external_import.id is null
     or not (revision_current or legacy_current) then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_MISMATCH';
  end if;

  select jsonb_build_object(
    'id', job.id,
    'createdBy', job.created_by,
    'status', job.status,
    'kind', job.kind,
    'requestPayload', job.request_payload,
    'resultPayload', job.result_payload
  ) into source_job
  from sellerpilot_private.ai_cli_jobs job
  where job.id = product.ai_job_id
    and job.created_by = product.owner_id;

  if source_job is null then
    raise exception 'EXTERNAL_DETAIL_SOURCE_JOB_OWNER_MISMATCH';
  end if;

  return jsonb_build_object(
    'contract', 'sellerpilot_external_detail_publish_read_v1',
    'productRow', to_jsonb(product),
    'sourceJob', source_job,
    'externalDetailImport',
      to_jsonb(external_import) || jsonb_build_object(
        'current', true,
        'approvalRevision', approval.revision,
        'contentSha256', approval.content_sha256
      ),
    'approvalRevision', case when approval.import_id is null then null else
      jsonb_build_object(
        'revision', approval.revision,
        'contentSha256', approval.content_sha256,
        'detailVersion', approval.detail_version,
        'requestSha256', approval.request_sha256,
        'reason', approval.reason,
        'reviewedAt', approval.reviewed_at
      ) end,
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(category) order by category.channel, category.market)
      from sellerpilot_private.product_category_assignments category
      where category.product_id = product.id
        and category.owner_id = product.owner_id
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(to_jsonb(listing) order by
        listing.channel_key, listing.market, listing.target_id)
      from sellerpilot_private.product_listings listing
      where listing.product_id = product.id
        and listing.owner_id = product.owner_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Downstream normalized-asset and publication-review checks consume this
-- helper. Revision-backed imports use the immutable commitment; untouched
-- legacy approvals retain the original timestamp fence.
create or replace function sellerpilot_private.external_detail_import_is_current(
  p_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  external_import sellerpilot_private.external_detail_imports%rowtype;
  product sellerpilot_private.products%rowtype;
  approval sellerpilot_private.external_detail_approval_revisions%rowtype;
begin
  select * into external_import
  from sellerpilot_private.external_detail_imports where id = p_id;
  select * into product
  from sellerpilot_private.products where id = external_import.product_id;
  select * into approval
  from sellerpilot_private.external_detail_approval_revisions
  where import_id = external_import.id
  order by revision desc limit 1;

  if approval.import_id is not null then
    return sellerpilot_private.external_detail_approval_revision_is_current(
      approval.import_id,
      approval.revision,
      approval.content_sha256
    );
  end if;

  return sellerpilot_private.external_detail_approval_source_is_valid(
      external_import.id
    )
    and external_import.approved_product_updated_at
      is not distinct from product.updated_at;
exception when others then
  return false;
end;
$$;

create or replace function sellerpilot_private.external_detail_source_manifest(
  p_source uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  external_import sellerpilot_private.external_detail_imports%rowtype;
  binding jsonb;
  images jsonb;
  canonical text;
  locale text;
  uses_revision boolean;
begin
  select * into job
  from sellerpilot_private.channel_gateway_jobs where id = p_source;
  binding := job.request_payload#>'{arguments,sellerpilotExternalDetail}';
  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = (binding->>'importId')::uuid;

  uses_revision := binding ? 'approvalRevision'
    or binding ? 'contentSha256';
  if binding is null
     or job.created_by is distinct from external_import.owner_id
     or binding->>'productId' is distinct from
       external_import.product_id::text
     or binding->>'ownerId' is distinct from external_import.owner_id::text
     or (binding->>'productUpdatedAt')::timestamptz is distinct from
       external_import.approved_product_updated_at
     or split_part(binding->>'locale','-',1) is distinct from
       binding->>'language'
     or binding->>'requestSha256' is distinct from
       external_import.request_sha256
     or binding->>'version' is distinct from
       external_import.approved_detail_version::text
     or binding->>'channel' is distinct from job.channel
     or binding->>'locale' is distinct from
       job.request_payload#>>'{arguments,publicationExpectedLocale}'
     or job.request_fingerprint is distinct from
       job.request_payload#>>'{arguments,publicationExpectedFingerprint}' then
    return null;
  end if;

  if uses_revision then
    if not (binding ? 'approvalRevision')
       or not (binding ? 'contentSha256')
       or not sellerpilot_private.external_detail_approval_revision_is_current(
         external_import.id,
         (binding->>'approvalRevision')::bigint,
         binding->>'contentSha256'
       ) then
      return null;
    end if;
  elsif exists (
      select 1
      from sellerpilot_private.external_detail_approval_revisions revision
      where revision.import_id = external_import.id
    )
    or not sellerpilot_private.external_detail_import_is_current(
      external_import.id
    ) then
    return null;
  end if;

  foreach locale in array array['ko','ja','en'] loop
    if binding#>>array['allLocaleDocumentSha256',locale]
         is distinct from external_import.payload#>>array[
           'reviewedCopy',locale,'documentSha256'
         ] then
      return null;
    end if;
  end loop;

  if binding->>'documentSha256' is distinct from
       external_import.payload#>>array[
         'reviewedCopy',binding->>'language','documentSha256'
       ]
     or binding->>'exportSha256' is distinct from
       sellerpilot_private.external_detail_hash(jsonb_build_object(
         'title',binding->'title',
         'html',binding->'html',
         'plain',binding->'plain',
         'sections',binding->'sections'
       ))
     or binding->'imageSha256s' is distinct from (
       select jsonb_agg(value->'sourceSha256' order by ordinal)
       from jsonb_array_elements(external_import.payload->'assets')
       with ordinality asset(value,ordinal)
     )
     or binding->'pixelSha256s' is distinct from (
       select jsonb_agg(value->'decodedRgbaSha256' order by ordinal)
       from jsonb_array_elements(external_import.receipts)
       with ordinality receipt(value,ordinal)
     ) then
    return null;
  end if;

  select jsonb_agg(jsonb_build_object(
      'role',value->>'role',
      'path',value->>'storagePath',
      'sourceSha256',value->>'sourceSha256'
    ) order by ordinal),
    string_agg(
      (value->>'role') || chr(9) || (value->>'storagePath') || chr(9) ||
      (value->>'sourceSha256'),
      chr(10) order by ordinal
    )
  into images, canonical
  from jsonb_array_elements(external_import.payload->'assets')
  with ordinality asset(value,ordinal);

  return jsonb_build_object(
    'contract','sellerpilot_detail_image_manifest_v2',
    'algorithm','sha256',
    'digest',encode(sha256(convert_to(canonical,'UTF8')),'hex'),
    'images',images
  );
exception when others then
  return null;
end;
$$;

create or replace function sellerpilot_private.guard_external_detail_gateway_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  binding jsonb;
  external_import sellerpilot_private.external_detail_imports%rowtype;
  product sellerpilot_private.products%rowtype;
  image jsonb;
  image_index integer := 0;
  uses_revision boolean;
begin
  binding := new.request_payload#>'{arguments,sellerpilotExternalDetail}';
  if tg_op = 'UPDATE'
     and old.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null
     and binding is distinct from
       old.request_payload#>'{arguments,sellerpilotExternalDetail}' then
    raise exception 'EXTERNAL_DETAIL_JOB_BINDING_IMMUTABLE';
  end if;
  if binding is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.status not in ('queued','running')
     and new.provider_mutation_started_at is not distinct from
       old.provider_mutation_started_at then
    return new;
  end if;
  if new.operation not in ('listing.create','listing.update','listing.activate')
    then
    raise exception 'EXTERNAL_DETAIL_OPERATION_INVALID';
  end if;

  select * into product
  from sellerpilot_private.products
  where id = (binding->>'productId')::uuid
  for update;
  select * into external_import
  from sellerpilot_private.external_detail_imports
  where id = product.external_detail_import_id;

  if external_import.id is null
     or external_import.id::text is distinct from binding->>'importId'
     or external_import.owner_id is distinct from new.created_by
     or external_import.status <> 'approved'
     or external_import.approved_detail_version is distinct from
       product.detail_page_version
     or product.ai_job_id is distinct from
       (external_import.payload->>'expectedAiJobId')::uuid
     or external_import.request_sha256 is distinct from
       binding->>'requestSha256'
     or external_import.approved_detail_version::text is distinct from
       binding->>'version'
     or (binding->>'productUpdatedAt')::timestamptz is distinct from
       external_import.approved_product_updated_at
     or new.channel is distinct from binding->>'channel' then
    raise exception 'EXTERNAL_DETAIL_JOB_SOURCE_STALE';
  end if;

  uses_revision := binding ? 'approvalRevision'
    or binding ? 'contentSha256';
  if uses_revision then
    if not (binding ? 'approvalRevision')
       or not (binding ? 'contentSha256')
       or not sellerpilot_private.external_detail_approval_revision_is_current(
         external_import.id,
         (binding->>'approvalRevision')::bigint,
         binding->>'contentSha256'
       ) then
      raise exception 'EXTERNAL_DETAIL_JOB_SOURCE_STALE';
    end if;
  elsif exists (
      select 1
      from sellerpilot_private.external_detail_approval_revisions revision
      where revision.import_id = external_import.id
    )
    or external_import.approved_product_updated_at
      is distinct from product.updated_at then
    raise exception 'EXTERNAL_DETAIL_JOB_SOURCE_STALE';
  end if;

  if coalesce(binding->>'language','') not in ('ko','ja','en')
     or nullif(binding->>'locale','') is null
     or external_import.payload#>>array[
       'reviewedCopy',binding->>'language','documentSha256'
     ] is distinct from binding->>'documentSha256'
     or binding->>'locale' is distinct from
       new.request_payload#>>'{arguments,publicationExpectedLocale}' then
    raise exception 'EXTERNAL_DETAIL_JOB_LOCALE_INVALID';
  end if;

  for image in
    select value from jsonb_array_elements(external_import.payload->'assets')
  loop
    if image->>'sourceSha256' is distinct from
         binding#>>array['imageSha256s',image_index::text]
       or external_import.receipts#>>array[
         image_index::text,'decodedRgbaSha256'
       ] is distinct from
         binding#>>array['pixelSha256s',image_index::text] then
      raise exception 'EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH';
    end if;
    image_index := image_index + 1;
  end loop;

  if image_index <> 8
     or jsonb_array_length(binding->'imageSha256s') is distinct from 8
     or jsonb_array_length(binding->'pixelSha256s') is distinct from 8 then
    raise exception 'EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.external_detail_approval_content_snapshot(uuid,uuid),
  sellerpilot_private.external_detail_approval_source_is_valid(uuid),
  sellerpilot_private.external_detail_approval_revision_is_current(uuid,bigint,text),
  sellerpilot_private.prevent_external_detail_approval_revision_mutation(),
  sellerpilot_private.record_initial_external_detail_approval_revision(),
  sellerpilot_private.external_detail_import_is_current(uuid),
  sellerpilot_private.external_detail_source_manifest(uuid),
  sellerpilot_private.guard_external_detail_gateway_source()
from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_rebind_external_detail_approval(
    uuid,uuid,uuid,bigint,text,text,boolean
  ),
  public.sellerpilot_service_get_external_detail_publish_context(uuid,uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_rebind_external_detail_approval(
    uuid,uuid,uuid,bigint,text,text,boolean
  ),
  public.sellerpilot_service_get_external_detail_publish_context(uuid,uuid)
to service_role;

commit;
