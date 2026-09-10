-- Repair baseline provenance is split across two arrays in the production
-- publication binding. providerTransportImages identifies the normalized
-- bytes sent to SmartStore, while approvedDetailImages carries the immutable
-- approved source path and digest. Bind the arrays by exact detail ordinal and
-- identity before using approved provenance; do not require duplicated source
-- fields on providerTransportImages.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907175000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)'
     ) is null then
    raise exception 'SMARTSTORE_REPAIR_TRANSPORT_PROVENANCE_RECORDER_MISSING'
      using errcode = '55000';
  end if;
end;
$dependencies$;

do $patch_recorder$
declare
  definition text;
  declaration_before constant text := $old$  asset_binding jsonb;
  transport jsonb;
  transport_item jsonb;
  source_html text;$old$;
  declaration_after constant text := $new$  asset_binding jsonb;
  approved_images jsonb;
  approved_item jsonb;
  transport jsonb;
  transport_item jsonb;
  source_html text;$new$;
  assignment_before constant text := $old$  asset_binding := source_job.request_payload
    #>'{arguments,sellerpilotPublicationAssetBinding}';
  transport := asset_binding->'providerTransportImages';$old$;
  assignment_after constant text := $new$  asset_binding := source_job.request_payload
    #>'{arguments,sellerpilotPublicationAssetBinding}';
  approved_images := asset_binding->'approvedDetailImages';
  transport := asset_binding->'providerTransportImages';$new$;
  loop_before constant text := $old$  if asset_binding->>'providerImageSurface' = 'gallery' then
    if jsonb_array_length(transport) is distinct from 9 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
    end if;
  elsif jsonb_array_length(transport) is distinct from 8 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
  end if;
  for image_index in 0..7 loop
    transport_item := transport->(
      image_index + case when asset_binding->>'providerImageSurface'='gallery' then 1 else 0 end
    );
    if transport_item->>'publicUrl' is distinct from source_urls->>image_index
       or transport_item->>'contentSha256' !~ '^[a-f0-9]{64}$'
       or transport_item->>'objectPath' is distinct from
         'normalized/' || left(transport_item->>'contentSha256',2) || '/'
           || (transport_item->>'contentSha256') || '.jpg'
       or not exists (
         select 1
         from sellerpilot_private.marketplace_normalized_asset_refs ref
         join sellerpilot_private.marketplace_normalized_assets asset
           on asset.object_path=ref.object_path
         where ref.attempt_id=source_attempt.id
           and ref.object_path=transport_item->>'objectPath'
           and ref.canonical_public_url=transport_item->>'publicUrl'
           and ref.source_object_path=transport_item->>'approvedObjectPath'
           and ref.source_content_sha256=transport_item->>'approvedSourceSha256'
           and ref.upload_confirmed_at is not null
           and asset.status='available'
           and asset.content_sha256=transport_item->>'contentSha256'
       ) then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
    end if;
    select ordinality::integer-1,remote_pixels->>(ordinality::integer-1)
    into remote_ordinal,remote_pixel
    from jsonb_array_elements_text(remote_urls) with ordinality remote(value,ordinality)
    where remote.value = source_urls->>image_index;
    if remote_ordinal is null or remote_pixel !~ '^[a-f0-9]{64}$' then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_PIXEL_INVALID';
    end if;
    transport_images := transport_images || jsonb_build_array(jsonb_build_object(
      'index',image_index,
      'url',transport_item->>'publicUrl',
      'objectPath',transport_item->>'objectPath',
      'contentSha256',transport_item->>'contentSha256',
      'approvedObjectPath',transport_item->>'approvedObjectPath',
      'approvedSourceSha256',transport_item->>'approvedSourceSha256',
      'decodedRgbaSha256',remote_pixel
    ));
  end loop;$old$;
  loop_after constant text := $new$  if jsonb_typeof(approved_images) is distinct from 'array'
     or jsonb_array_length(approved_images) is distinct from 8 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
  end if;
  if asset_binding->>'providerImageSurface' = 'gallery' then
    if jsonb_array_length(transport) is distinct from 9 then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
    end if;
  elsif jsonb_array_length(transport) is distinct from 8 then
    raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
  end if;
  for image_index in 0..7 loop
    approved_item := approved_images->image_index;
    transport_item := transport->(
      image_index + case when asset_binding->>'providerImageSurface'='gallery' then 1 else 0 end
    );
    if jsonb_typeof(approved_item) is distinct from 'object'
       or transport_item->>'role' is distinct from approved_item->>'role'
       or transport_item->>'publicUrl' is distinct from approved_item->>'publicUrl'
       or transport_item->>'objectPath' is distinct from approved_item->>'objectPath'
       or transport_item->>'contentSha256' is distinct from approved_item->>'contentSha256'
       or transport_item->>'publicUrl' is distinct from source_urls->>image_index
       or transport_item->>'contentSha256' !~ '^[a-f0-9]{64}$'
       or transport_item->>'objectPath' is distinct from
         'normalized/' || left(transport_item->>'contentSha256',2) || '/'
           || (transport_item->>'contentSha256') || '.jpg'
       or not exists (
         select 1
         from sellerpilot_private.marketplace_normalized_asset_refs ref
         join sellerpilot_private.marketplace_normalized_assets asset
           on asset.object_path=ref.object_path
         where ref.attempt_id=source_attempt.id
           and ref.object_path=transport_item->>'objectPath'
           and ref.canonical_public_url=transport_item->>'publicUrl'
           and ref.source_object_path=approved_item->>'approvedObjectPath'
           and ref.source_content_sha256=approved_item->>'approvedSourceSha256'
           and ref.upload_confirmed_at is not null
           and asset.status='available'
           and asset.content_sha256=transport_item->>'contentSha256'
       ) then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_INVALID';
    end if;
    select ordinality::integer-1,remote_pixels->>(ordinality::integer-1)
    into remote_ordinal,remote_pixel
    from jsonb_array_elements_text(remote_urls) with ordinality remote(value,ordinality)
    where remote.value = source_urls->>image_index;
    if remote_ordinal is null or remote_pixel !~ '^[a-f0-9]{64}$' then
      raise exception 'SMARTSTORE_EXISTING_CONTENT_REPAIR_TRANSPORT_PIXEL_INVALID';
    end if;
    transport_images := transport_images || jsonb_build_array(jsonb_build_object(
      'index',image_index,
      'url',transport_item->>'publicUrl',
      'objectPath',transport_item->>'objectPath',
      'contentSha256',transport_item->>'contentSha256',
      'approvedObjectPath',approved_item->>'approvedObjectPath',
      'approvedSourceSha256',approved_item->>'approvedSourceSha256',
      'decodedRgbaSha256',remote_pixel
    ));
  end loop;$new$;
  declaration_hits integer;
  assignment_hits integer;
  loop_hits integer;
begin
  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)'::regprocedure
  );
  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition,declaration_before,''))
  ) / pg_catalog.length(declaration_before) into declaration_hits;
  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition,assignment_before,''))
  ) / pg_catalog.length(assignment_before) into assignment_hits;
  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition,loop_before,''))
  ) / pg_catalog.length(loop_before) into loop_hits;
  if declaration_hits <> 1
     or assignment_hits <> 1
     or loop_hits <> 1
     or pg_catalog.strpos(definition,'approved_images :=') <> 0 then
    raise exception 'SMARTSTORE_REPAIR_TRANSPORT_PROVENANCE_PREIMAGE_DRIFT';
  end if;

  definition := pg_catalog.replace(definition,declaration_before,declaration_after);
  definition := pg_catalog.replace(definition,assignment_before,assignment_after);
  definition := pg_catalog.replace(definition,loop_before,loop_after);
  execute definition;

  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)'::regprocedure
  );
  if pg_catalog.strpos(definition,declaration_before) <> 0
     or pg_catalog.strpos(definition,assignment_before) <> 0
     or pg_catalog.strpos(definition,loop_before) <> 0
     or pg_catalog.strpos(definition,'approved_images := asset_binding->''approvedDetailImages''') = 0
     or pg_catalog.strpos(
       definition,
       'transport_item->>''role'' is distinct from approved_item->>''role'''
     ) = 0
     or pg_catalog.strpos(
       definition,
       'ref.source_object_path=approved_item->>''approvedObjectPath'''
     ) = 0
     or pg_catalog.strpos(
       definition,
       '''approvedObjectPath'',approved_item->>''approvedObjectPath'''
     ) = 0
     or pg_catalog.strpos(
       definition,
       'ref.source_object_path=transport_item->>''approvedObjectPath'''
     ) <> 0 then
    raise exception 'SMARTSTORE_REPAIR_TRANSPORT_PROVENANCE_POSTIMAGE_DRIFT';
  end if;
end;
$patch_recorder$;

do $verify$
begin
  if not pg_catalog.has_function_privilege(
       'postgres',
       'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)',
       'EXECUTE'
     ) then
    raise exception 'SMARTSTORE_REPAIR_TRANSPORT_PROVENANCE_PRIVILEGE_DRIFT';
  end if;
end;
$verify$;

comment on function
  sellerpilot_private.record_smartstore_existing_remote_repair_baseline(text,uuid,uuid,jsonb,text,text)
  is 'Records a SmartStore repair-required baseline after exact readback identity, approved-detail provenance and normalized transport bytes are bound by detail ordinal. Provider transport rows need not duplicate approved source fields.';

commit;
