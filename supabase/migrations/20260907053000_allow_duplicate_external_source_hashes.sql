-- One source image can be stored under more than one distinct owned object
-- path. Preserve path ownership and complete path/evidence binding without
-- requiring the byte hash itself to be globally unique across those paths.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900705300);

do $migration$
begin
  if pg_catalog.to_regprocedure(
    'sellerpilot_private.external_detail_approval_source_is_valid(uuid)'
  ) is null then
    raise exception 'EXTERNAL_DETAIL_APPROVAL_SOURCE_VALIDATOR_MISSING';
  end if;
end;
$migration$;

create or replace function sellerpilot_private.external_detail_approval_source_is_valid(
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

-- 20260907052000 replaced these functions after the shared-admin correction
-- in 20260906204000. Restore ownership through the operation attempt and its
-- credential creator; the gateway job creator is not the product owner in a
-- shared-admin workspace.
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
     or not exists (
       select 1
       from sellerpilot_private.channel_operation_attempts attempt
       join sellerpilot_private.channel_credentials credential
         on credential.id = attempt.credential_id
       where attempt.id = job.attempt_id
         and attempt.owner_id = external_import.owner_id
         and attempt.credential_id = job.credential_id
         and attempt.channel = job.channel
         and attempt.operation = job.operation
         and credential.created_by = job.created_by
     )
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
     or external_import.owner_id is distinct from product.owner_id
     or not exists (
       select 1
       from sellerpilot_private.channel_operation_attempts attempt
       join sellerpilot_private.channel_credentials credential
         on credential.id = attempt.credential_id
       where attempt.id = new.attempt_id
         and attempt.owner_id = product.owner_id
         and attempt.credential_id = new.credential_id
         and attempt.channel = new.channel
         and attempt.operation = new.operation
         and credential.created_by = new.created_by
     )
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
  sellerpilot_private.external_detail_approval_source_is_valid(uuid),
  sellerpilot_private.external_detail_source_manifest(uuid),
  sellerpilot_private.guard_external_detail_gateway_source()
from public, anon, authenticated, service_role;

commit;
