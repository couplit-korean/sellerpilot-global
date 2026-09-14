-- Elevenst approved processed-food category propagation. Existing approvals/permits remain immutable.
-- Official 1009792 (사이다) joins the existing 1346631 (비스켓); no other category is enabled.
-- Bind every draft, provider payload, six-kind digest and execution/recovery check to its selected category.
begin;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$sellerpilot_private.elevenst_current_six_kind_digest(sellerpilot_private.elevenst_new_product_server_sources)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='476696ef043f8a5704513565fabbe12b';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$p_source.product_id,'1346631',p_source.credential_id$old$,'')))/length($old$p_source.product_id,'1346631',p_source.credential_id$old$) <> 6
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$p_source.product_id,'1346631',p_source.credential_id$old$,$new$p_source.product_id,p_source.category_id,p_source.credential_id$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$sellerpilot_private.elevenst_new_product_job_source_current(uuid,uuid)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='2adea87dcdffb37ede9ad8e127164434';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$assignment.category_id='1346631'$old$,'')))/length($old$assignment.category_id='1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$assignment.category_id='1346631'$old$,$new$assignment.category_id=(select category_id from sellerpilot_private.elevenst_new_product_server_sources where id=permit_row.source_id)$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_100430_bind_elevenst_before_advisory(uuid,uuid,uuid,text,text,uuid,text,text,text)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='90ffc6972dd82cdbdc6a5c8f554c9c4b';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$assignment.category_id='1346631'$old$,'')))/length($old$assignment.category_id='1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$assignment.category_id='1346631'$old$,$new$assignment.category_id=context_value->>'categoryId'$new$);

 if (length(source)-length(replace(source,$old$source.category_id='1346631'$old$,'')))/length($old$source.category_id='1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 2',signature; end if;
 source:=replace(source,$old$source.category_id='1346631'$old$,$new$source.category_id=context_value->>'categoryId'$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_100445_11st_source_readback_pre_cas(uuid,uuid,uuid,text,text)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='b71ae9c02191114ee1004bab945cb836';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$source.category_id = '1346631'$old$,'')))/length($old$source.category_id = '1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$source.category_id = '1346631'$old$,$new$source.category_id = context_value->>'categoryId'$new$);

 if (length(source)-length(replace(source,$old$source_row.product_id, '1346631',$old$,'')))/length($old$source_row.product_id, '1346631',$old$) <> 6
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 2',signature; end if;
 source:=replace(source,$old$source_row.product_id, '1346631',$old$,$new$source_row.product_id, source_row.category_id,$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_service_elevenst_new_product_source(text,uuid,uuid,text,uuid,integer)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='cab1e7cd43651504d8a202ddd2bd76c9';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$p_category_id is distinct from '1346631'$old$,'')))/length($old$p_category_id is distinct from '1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$p_category_id is distinct from '1346631'$old$,$new$(p_category_id is null or p_category_id not in ('1346631','1009792'))$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_service_elevenst_new_product_approval_context(uuid,uuid,uuid,text,text)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='bfb20f9e290f9adaa8267ee3577d285c';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$assignment.category_id = '1346631'$old$,'')))/length($old$assignment.category_id = '1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$assignment.category_id = '1346631'$old$,$new$assignment.category_id in ('1346631','1009792')$new$);

 if (length(source)-length(replace(source,$old$entry.value->>'categoryId' = '1346631'$old$,'')))/length($old$entry.value->>'categoryId' = '1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 2',signature; end if;
 source:=replace(source,$old$entry.value->>'categoryId' = '1346631'$old$,$new$entry.value->>'categoryId' = assignment_row.category_id$new$);

 if (length(source)-length(replace(source,$old$'productId', product_row.id,$old$,'')))/length($old$'productId', product_row.id,$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 3',signature; end if;
 source:=replace(source,$old$'productId', product_row.id,$old$,$new$'productId', product_row.id,
    'categoryId', assignment_row.category_id,$new$);

 if (length(source)-length(replace(source,$old$  detail_paths jsonb;$old$,'')))/length($old$  detail_paths jsonb;$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 4',signature; end if;
 source:=replace(source,$old$  detail_paths jsonb;$old$,$new$  detail_paths jsonb;
  studio_result jsonb;
  manifest_input text;
  legacy_approved_source boolean;$new$);

 if (length(source)-length(replace(source,$old$  select coalesce(pg_catalog.jsonb_agg(path order by ordinal), '[]'::jsonb)
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
    ) paths;$old$,'')))/length($old$  select coalesce(pg_catalog.jsonb_agg(path order by ordinal), '[]'::jsonb)
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
    ) paths;$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 5',signature; end if;
 source:=replace(source,$old$  select coalesce(pg_catalog.jsonb_agg(path order by ordinal), '[]'::jsonb)
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
    ) paths;$old$,$new$  -- Preserve already-approved biscuit source hashes for historical readback only.
  -- New approvals for both supported categories select verified processed assets.
  select exists(select 1 from sellerpilot_private.elevenst_new_product_server_sources s
    where s.owner_id=product_row.owner_id and s.product_id=product_row.id
      and s.category_id='1346631' and assignment_row.category_id='1346631'
      and s.credential_id=credential_row.id and s.credential_version=credential_row.version
      and s.status='approved' and s.product_updated_at=product_row.updated_at
      and s.product_revision=product_row.detail_page_version
      and s.product_approval_revision=product_row.detail_page_approved_version
      and jsonb_array_length(s.policy_source#>'{content,productImagePaths}')=4
      and not exists(select 1 from jsonb_array_elements_text(s.policy_source#>'{content,productImagePaths}') p(path)
        where p.path not like product_row.owner_id::text||'/%')) into legacy_approved_source;
  if legacy_approved_source then
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
  else
    select j.result_payload into studio_result from sellerpilot_private.ai_cli_jobs j
      where j.id=product_row.ai_job_id and j.created_by=product_row.owner_id
        and j.kind='product_studio' and j.status='succeeded';
    if not found
      or product_row.detail_page_image_manifest->>'contract' is distinct from 'sellerpilot_detail_image_manifest_v2'
      or product_row.detail_page_image_manifest->>'algorithm' is distinct from 'sha256'
      or jsonb_typeof(studio_result->'asset_storage_paths') is distinct from 'object'
      or jsonb_typeof(studio_result->'asset_storage_sha256s') is distinct from 'object'
    then return null; end if;
    if (select count(*) from jsonb_object_keys(studio_result->'asset_storage_paths'))<>16
      or (select count(*) from jsonb_object_keys(studio_result->'asset_storage_sha256s'))<>16
      or exists(select 1 from jsonb_each_text(studio_result->'asset_storage_paths') p
        where coalesce(studio_result->'asset_storage_sha256s'->>p.key,'') !~ '^[a-f0-9]{64}$')
      or (select count(distinct i->>'role') from jsonb_array_elements(product_row.detail_page_image_manifest->'images') i)<>8
      or (select count(distinct i->>'path') from jsonb_array_elements(product_row.detail_page_image_manifest->'images') i)<>8
      or (select count(distinct split_part(i->>'path','/',4)) from jsonb_array_elements(product_row.detail_page_image_manifest->'images') i)<>1
      or exists(select 1 from jsonb_array_elements(product_row.detail_page_image_manifest->'images') i
        where coalesce(i->>'role','') not in ('detail-overview','detail-feature','detail-use','detail-dimensions',
          'detail-material','detail-contents','detail-package','detail-care','detail-routine','detail-storage','detail-scale','detail-context')
          or coalesce(i->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
          or coalesce(i->>'path','') !~ ('^results/'||product_row.ai_job_id::text||'/claims/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z-]+[.]png$')
          or studio_result->'asset_storage_paths'->>(i->>'role') is distinct from i->>'path'
          or studio_result->'asset_storage_sha256s'->>(i->>'role') is distinct from i->>'sourceSha256'
          or not exists(select 1 from storage.objects o where o.bucket_id='sellerpilot-ai' and o.name=i->>'path'))
    then return null; end if;
    select string_agg((i->>'role')||chr(9)||(i->>'path')||chr(9)||(i->>'sourceSha256'),chr(10) order by n)
      into manifest_input from jsonb_array_elements(product_row.detail_page_image_manifest->'images') with ordinality a(i,n);
    if encode(sha256(convert_to(manifest_input,'UTF8')),'hex') is distinct from product_row.detail_page_image_manifest->>'digest'
    then return null; end if;
    select jsonb_agg(i->>'path' order by n) into source_paths
      from jsonb_array_elements(product_row.detail_page_image_manifest->'images') with ordinality a(i,n) where n<=4;
  end if;$new$);

 if (length(source)-length(replace(source,$old$  source_paths jsonb;$old$,'')))/length($old$  source_paths jsonb;$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 6',signature; end if;
 source:=replace(source,$old$  source_paths jsonb;$old$,$new$  source_paths jsonb;
  product_sha256s jsonb;
  detail_sha256s jsonb;$new$);

 if (length(source)-length(replace(source,$old$  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_approval_context_v1',$old$,'')))/length($old$  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_approval_context_v1',$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 7',signature; end if;
 source:=replace(source,$old$  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_approval_context_v1',$old$,$new$  if legacy_approved_source then
    select jsonb_agg(r.value->>'bytesSha256' order by r.n) filter(where r.n<=4),
           jsonb_agg(r.value->>'bytesSha256' order by r.n) filter(where r.n>4)
      into product_sha256s,detail_sha256s
      from sellerpilot_private.elevenst_new_product_server_sources s
      cross join lateral jsonb_array_elements(s.policy_source#>'{content,objectReceipts}') with ordinality r(value,n)
      where s.owner_id=product_row.owner_id and s.product_id=product_row.id
        and s.category_id='1346631' and s.credential_id=credential_row.id
        and s.credential_version=credential_row.version and s.status='approved'
        and s.product_updated_at=product_row.updated_at
        and s.product_revision=product_row.detail_page_version
        and s.product_approval_revision=product_row.detail_page_approved_version;
  else
    select jsonb_agg(i->>'sourceSha256' order by n) filter(where n<=4),
           jsonb_agg(i->>'sourceSha256' order by n)
      into product_sha256s,detail_sha256s
      from jsonb_array_elements(product_row.detail_page_image_manifest->'images') with ordinality a(i,n);
  end if;
  if coalesce(jsonb_array_length(product_sha256s),0)<>4 or coalesce(jsonb_array_length(detail_sha256s),0)<>8
    or exists(select 1 from jsonb_array_elements_text(product_sha256s||detail_sha256s) d(sha) where coalesce(d.sha,'')!~'^[a-f0-9]{64}$')
  then return null;end if;
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_approval_context_v1',$new$);

 if (length(source)-length(replace(source,$old$'productImagePaths', source_paths,$old$,'')))/length($old$'productImagePaths', source_paths,$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 8',signature; end if;
 source:=replace(source,$old$'productImagePaths', source_paths,$old$,$new$'productImagePaths', source_paths,
    'productImageSha256s', product_sha256s,
    'detailImageSha256s', detail_sha256s,$new$);

 if (length(source)-length(replace(source,$old$or nullif(pg_catalog.btrim(p_target_id), '') is null$old$,'')))/length($old$or nullif(pg_catalog.btrim(p_target_id), '') is null$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 9',signature; end if;
 source:=replace(source,$old$or nullif(pg_catalog.btrim(p_target_id), '') is null$old$,$new$or p_target_id is null
     or (pg_catalog.btrim(p_target_id)='' and pg_catalog.btrim(p_market)<>'KR')$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_100445_11st_approve_before_object_bytes(uuid,uuid,uuid,uuid,text,text,jsonb)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='2074b84c306df27fbcb4ca65d8f7f069';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$p_payload->>'categoryId' is distinct from '1346631'$old$,'')))/length($old$p_payload->>'categoryId' is distinct from '1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$p_payload->>'categoryId' is distinct from '1346631'$old$,$new$p_payload->>'categoryId' is distinct from context_value->>'categoryId'$new$);

 if (length(source)-length(replace(source,$old$p_payload#>>'{providerProduct,dispCtgrNo}' is distinct from '1346631'$old$,'')))/length($old$p_payload#>>'{providerProduct,dispCtgrNo}' is distinct from '1346631'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 2',signature; end if;
 source:=replace(source,$old$p_payload#>>'{providerProduct,dispCtgrNo}' is distinct from '1346631'$old$,$new$p_payload#>>'{providerProduct,dispCtgrNo}' is distinct from context_value->>'categoryId'$new$);

 if (length(source)-length(replace(source,$old$    p_product_id,
    '1346631',$old$,'')))/length($old$    p_product_id,
    '1346631',$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 3',signature; end if;
 source:=replace(source,$old$    p_product_id,
    '1346631',$old$,$new$    p_product_id,
    context_value->>'categoryId',$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='5fd322f6b5db56ad3d7e5004cc33e3cb';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$value.category_id='1346631' and value.status='confirmed'$old$,'')))/length($old$value.category_id='1346631' and value.status='confirmed'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$value.category_id='1346631' and value.status='confirmed'$old$,$new$value.category_id=(select category_id from sellerpilot_private.elevenst_new_product_server_sources where id=permit.source_id) and value.status='confirmed'$new$);

 if (length(source)-length(replace(source,$old$value.category_id='1346631' and value.status='approved'$old$,'')))/length($old$value.category_id='1346631' and value.status='approved'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 2',signature; end if;
 source:=replace(source,$old$value.category_id='1346631' and value.status='approved'$old$,$new$value.category_id=(select category_id from sellerpilot_private.product_category_assignments where id=permit.assignment_id) and value.status='approved'$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_service_claim_elevenst_create_recovery(text)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='e67496c11b10f87e43830eedee84a37d';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$value.category_id='1346631' and value.status='confirmed'$old$,'')))/length($old$value.category_id='1346631' and value.status='confirmed'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$value.category_id='1346631' and value.status='confirmed'$old$,$new$value.category_id=(select category_id from sellerpilot_private.elevenst_new_product_server_sources where id=permit.source_id) and value.status='confirmed'$new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Preserve the existing body, ownership and ACL; refuse a changed production preimage.
do $patch$
declare source text; original text; signature text := $sig$public.sellerpilot_service_approve_elevenst_new_product_source(uuid,uuid,uuid,uuid,text,text,jsonb)$sig$;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=signature::regprocedure
   and md5(p.prosrc)='728e926ef1367cb0ecb4b39b42e0f97a';
 if source is null then raise exception 'ELEVENST_CIDER_PREIMAGE_DRIFT: %',signature; end if;
 original:=source;

 if (length(source)-length(replace(source,$old$    or coalesce(receipt.value->>'contentLength','')!~'^[1-9][0-9]*$'$old$,'')))/length($old$    or coalesce(receipt.value->>'contentLength','')!~'^[1-9][0-9]*$'$old$) <> 1
 then raise exception 'ELEVENST_CIDER_ANCHOR_DRIFT: % step 1',signature; end if;
 source:=replace(source,$old$    or coalesce(receipt.value->>'contentLength','')!~'^[1-9][0-9]*$'$old$,$new$    or receipt.value->>'bytesSha256' is distinct from case when receipt.ordinality<=4
       then (context_value->'productImageSha256s')->>(receipt.ordinality::integer-1)
       else (context_value->'detailImageSha256s')->>(receipt.ordinality::integer-5) end
    or coalesce(receipt.value->>'contentLength','')!~'^[1-9][0-9]*$' $new$);

 if source=original then raise exception 'ELEVENST_CIDER_NO_CHANGE: %',signature;end if;
 execute source;
end $patch$;

-- Extend only the approved source category pair; bind the JSON category to its row.
do $checks$
declare actual text;
begin

 select pg_get_constraintdef(oid) into actual from pg_constraint where conrelid='sellerpilot_private.elevenst_new_product_server_sources'::regclass and conname='elevenst_new_product_server_sources_category_id_check';
 if actual is distinct from $before$CHECK ((category_id = '1346631'::text))$before$ then raise exception 'ELEVENST_CIDER_CHECK_DRIFT:elevenst_new_product_server_sources_category_id_check'; end if;
 alter table sellerpilot_private.elevenst_new_product_server_sources drop constraint elevenst_new_product_server_sources_category_id_check;
 alter table sellerpilot_private.elevenst_new_product_server_sources add constraint elevenst_new_product_server_sources_category_id_check CHECK ((category_id = ANY (ARRAY['1346631'::text,'1009792'::text])));

 select pg_get_constraintdef(oid) into actual from pg_constraint where conrelid='sellerpilot_private.elevenst_new_product_server_sources'::regclass and conname='elevenst_new_product_server_sources_provider_product_check';
 if actual is distinct from $before$CHECK (((jsonb_typeof(provider_product) = 'object'::text) AND (octet_length((provider_product)::text) <= 262144) AND ((provider_product ->> 'dispCtgrNo'::text) = '1346631'::text) AND (NULLIF(btrim((provider_product ->> 'prdNm'::text)), ''::text) IS NOT NULL) AND (NULLIF(btrim((provider_product ->> 'sellerPrdCd'::text)), ''::text) IS NOT NULL) AND ((provider_product ->> 'selPrc'::text) ~ '^[0-9]+$'::text) AND ((provider_product ->> 'prdSelQty'::text) ~ '^[0-9]+$'::text) AND (NOT (provider_product ? 'ProductNotification'::text))))$before$ then raise exception 'ELEVENST_CIDER_CHECK_DRIFT:elevenst_new_product_server_sources_provider_product_check'; end if;
 alter table sellerpilot_private.elevenst_new_product_server_sources drop constraint elevenst_new_product_server_sources_provider_product_check;
 alter table sellerpilot_private.elevenst_new_product_server_sources add constraint elevenst_new_product_server_sources_provider_product_check CHECK (((jsonb_typeof(provider_product) = 'object'::text) AND (octet_length((provider_product)::text) <= 262144) AND ((provider_product ->> 'dispCtgrNo'::text) IS NOT DISTINCT FROM category_id) AND (NULLIF(btrim((provider_product ->> 'prdNm'::text)), ''::text) IS NOT NULL) AND (NULLIF(btrim((provider_product ->> 'sellerPrdCd'::text)), ''::text) IS NOT NULL) AND ((provider_product ->> 'selPrc'::text) ~ '^[0-9]+$'::text) AND ((provider_product ->> 'prdSelQty'::text) ~ '^[0-9]+$'::text) AND (NOT (provider_product ? 'ProductNotification'::text))));

end $checks$;

commit;
