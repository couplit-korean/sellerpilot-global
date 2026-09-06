begin;
-- Canonical JSON is independent of jsonb whitespace/key insertion order. ASCII
-- contract keys sort identically to the server; Unicode remains in string values.
create function sellerpilot_private.external_detail_canonical(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
 case jsonb_typeof(v)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||sellerpilot_private.external_detail_canonical(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
 when 'array' then select '['||coalesce(string_agg(sellerpilot_private.external_detail_canonical(value),',' order by ordinal),'')||']' into result from jsonb_array_elements(v)with ordinality a(value,ordinal);
 else result:=v::text;end case;return result;
end$$;
create function sellerpilot_private.external_detail_hash(v jsonb) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(sellerpilot_private.external_detail_canonical(v),'UTF8')),'hex')$$;
create function sellerpilot_private.external_detail_import_is_current(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare r sellerpilot_private.external_detail_imports%rowtype;p sellerpilot_private.products%rowtype;loc text;asset jsonb;i integer:=0;
begin
 select * into r from sellerpilot_private.external_detail_imports where id=p_id;
 select * into p from sellerpilot_private.products where id=r.product_id;
 if r.id is null or r.product_id<>'1ed4acfc-7603-48ec-a638-241131e59358'::uuid or r.status<>'approved' or p.demo or p.status='archived' or r.owner_id is distinct from p.owner_id or p.external_detail_import_id is distinct from r.id or p.updated_at is distinct from r.approved_product_updated_at or p.detail_page_version is distinct from r.approved_detail_version or p.ai_job_id is distinct from (r.payload->>'expectedAiJobId')::uuid or r.request_sha256 is distinct from sellerpilot_private.external_detail_hash(r.payload-'requestSha256') or r.payload->>'requestSha256' is distinct from r.request_sha256 or coalesce(jsonb_array_length(r.payload->'originalEvidence'),0)<1 then return false;end if;
 foreach loc in array array['ko','ja','en'] loop
  if r.payload#>>array['reviewedCopy',loc,'documentSha256'] is distinct from sellerpilot_private.external_detail_hash(r.payload#>array['reviewedCopy',loc,'document']) then return false;end if;
 end loop;
 if jsonb_array_length(r.payload->'assets') is distinct from 8 or jsonb_array_length(r.receipts) is distinct from 8 or (select count(distinct value->>'sourceSha256') from jsonb_array_elements(r.payload->'assets'))<>8 or (select count(distinct value->>'decodedRgbaSha256')from jsonb_array_elements(r.receipts))<>8 then return false;end if;
 for asset in select value from jsonb_array_elements(r.payload->'assets') loop
  if asset->>'storagePath' is distinct from 'external-detail/'||r.owner_id::text||'/'||r.product_id::text||'/'||r.id::text||'/'||(asset->>'assetId')||'/'||(asset->>'sourceSha256')||'.png' or asset->>'sourceSha256' is distinct from r.receipts#>>array[i::text,'sourceSha256'] or asset->>'assetId' is distinct from r.receipts#>>array[i::text,'assetId'] or asset->>'role' is distinct from r.receipts#>>array[i::text,'role'] or coalesce(r.receipts#>>array[i::text,'decodedRgbaSha256'],'') !~ '^[a-f0-9]{64}$' then return false;end if;i:=i+1;
 end loop;return true;
exception when others then return false;
end$$;
create function sellerpilot_private.external_detail_source_manifest(p_source uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;r sellerpilot_private.external_detail_imports%rowtype;b jsonb;images jsonb;canonical text;loc text;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_source;b:=j.request_payload#>'{arguments,sellerpilotExternalDetail}';
 select * into r from sellerpilot_private.external_detail_imports where id=(b->>'importId')::uuid;
 if b is null or not sellerpilot_private.external_detail_import_is_current(r.id) or j.created_by is distinct from r.owner_id or b->>'productId' is distinct from r.product_id::text or b->>'ownerId' is distinct from r.owner_id::text or (b->>'productUpdatedAt')::timestamptz is distinct from r.approved_product_updated_at or split_part(b->>'locale','-',1) is distinct from b->>'language' or b->>'requestSha256' is distinct from r.request_sha256 or b->>'version' is distinct from r.approved_detail_version::text or b->>'channel' is distinct from j.channel or b->>'locale' is distinct from j.request_payload#>>'{arguments,publicationExpectedLocale}' or j.request_fingerprint is distinct from j.request_payload#>>'{arguments,publicationExpectedFingerprint}' then return null;end if;
 foreach loc in array array['ko','ja','en']loop if b#>>array['allLocaleDocumentSha256',loc] is distinct from r.payload#>>array['reviewedCopy',loc,'documentSha256'] then return null;end if;end loop;
 if b->>'documentSha256' is distinct from r.payload#>>array['reviewedCopy',b->>'language','documentSha256'] or b->>'exportSha256' is distinct from sellerpilot_private.external_detail_hash(jsonb_build_object('title',b->'title','html',b->'html','plain',b->'plain','sections',b->'sections')) then return null;end if;
 if b->'imageSha256s' is distinct from (select jsonb_agg(value->'sourceSha256' order by ord)from jsonb_array_elements(r.payload->'assets')with ordinality a(value,ord)) or b->'pixelSha256s' is distinct from (select jsonb_agg(value->'decodedRgbaSha256' order by ord)from jsonb_array_elements(r.receipts)with ordinality a(value,ord)) then return null;end if;
 select jsonb_agg(jsonb_build_object('role',value->>'role','path',value->>'storagePath','sourceSha256',value->>'sourceSha256')order by ord),string_agg((value->>'role')||chr(9)||(value->>'storagePath')||chr(9)||(value->>'sourceSha256'),chr(10) order by ord)into images,canonical from jsonb_array_elements(r.payload->'assets')with ordinality a(value,ord);
 return jsonb_build_object('contract','sellerpilot_detail_image_manifest_v2','algorithm','sha256','digest',encode(sha256(convert_to(canonical,'UTF8')),'hex'),'images',images);
exception when others then return null;
end$$;
-- Existing Studio URL binding is delegated unchanged. External source is validated
-- first, then original lineage is attached atomically to the same normalized refs.
alter function public.sellerpilot_service_bind_marketplace_normalized_asset_urls(uuid,jsonb) rename to sellerpilot_bind_normalized_urls_before_external;
create function public.sellerpilot_service_bind_marketplace_normalized_asset_urls(p_attempt_id uuid,p_assets jsonb)returns boolean language plpgsql security definer set search_path='' as $$
declare asset jsonb;r sellerpilot_private.external_detail_imports%rowtype;sanitized jsonb:='[]';updated integer;
begin
 for asset in select value from jsonb_array_elements(p_assets)loop
  if asset->>'sourceObjectPath' like 'external-detail/%' then
   select i.* into r from sellerpilot_private.external_detail_imports i join sellerpilot_private.channel_operation_attempts a on a.id=p_attempt_id and a.owner_id=i.owner_id where exists(select 1 from jsonb_array_elements(i.payload->'assets')x where x->>'storagePath'=asset->>'sourceObjectPath' and x->>'sourceSha256'=asset->>'sourceSha256');
   if r.id is null or not sellerpilot_private.external_detail_import_is_current(r.id) then raise exception 'EXTERNAL_DETAIL_NORMALIZED_SOURCE_INVALID';end if;
   sanitized:=sanitized||jsonb_build_array(asset-'sourceObjectPath'-'sourceSha256');
  else sanitized:=sanitized||jsonb_build_array(asset);end if;
 end loop;
 perform public.sellerpilot_bind_normalized_urls_before_external(p_attempt_id,sanitized);
 for asset in select value from jsonb_array_elements(p_assets)loop
  if asset->>'sourceObjectPath' like 'external-detail/%' then
   update sellerpilot_private.marketplace_normalized_asset_refs set source_object_path=asset->>'sourceObjectPath',source_content_sha256=asset->>'sourceSha256' where attempt_id=p_attempt_id and object_path=asset->>'objectPath' and (source_object_path is null or source_object_path=asset->>'sourceObjectPath')and(source_content_sha256 is null or source_content_sha256=asset->>'sourceSha256');get diagnostics updated=row_count;
   if updated<>1 then raise exception 'EXTERNAL_DETAIL_NORMALIZED_LINEAGE_CONFLICT';end if;
  end if;
 end loop;return true;
end$$;
create function sellerpilot_private.external_detail_asset_binding_is_current(p_binding jsonb,p_manifest jsonb,p_version bigint,p_attempt uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
declare normalized_binding jsonb;approved jsonb;transport jsonb;item jsonb;reference jsonb;i integer:=0;surface text;
begin
 surface:=p_binding->>'providerImageSurface';approved:=p_binding->'approvedDetailImages';transport:=p_binding->'providerTransportImages';
 if surface not in('detail_content','gallery','buyer_visible')or jsonb_array_length(approved) is distinct from 8 then return false;end if;
 -- Validate all eight approved originals using the unchanged native normalized
 -- ref validator. This temporary validation projection is never saved as a job.
 normalized_binding:=p_binding||jsonb_build_object('providerImageSurface','detail_content','providerTransportImages',approved);
 if not sellerpilot_private.listing_publication_asset_binding_is_current(normalized_binding,p_manifest,p_version,p_attempt)then return false;end if;
 if surface in('detail_content','buyer_visible')then
  if jsonb_array_length(transport) is distinct from 8 then return false;end if;
  if surface='buyer_visible'and not exists(select 1 from sellerpilot_private.channel_gateway_jobs where attempt_id=p_attempt and channel='shopee')then return false;end if;
 else
  -- External detail always transports all eight details, not representative+7.
  if jsonb_array_length(transport) is distinct from 9 or transport#>>'{0,role}' is distinct from 'gallery-representative' then return false;end if;
 end if;
 for item in select value from jsonb_array_elements(transport)loop
  if surface='gallery'and i=0 then
   if not exists(select 1 from sellerpilot_private.marketplace_normalized_asset_refs r join sellerpilot_private.marketplace_normalized_assets a on a.object_path=r.object_path where r.attempt_id=p_attempt and r.object_path=item->>'objectPath'and r.canonical_public_url=item->>'publicUrl'and a.content_sha256=item->>'contentSha256'and r.upload_confirmed_at is not null and a.status='available')or item->>'publicUrl' !~ '^https://[a-z0-9-]+\.supabase\.(co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$' then return false;end if;
  else
   reference:=approved->(case when surface='gallery'then i-1 else i end);
   if item->>'role' is distinct from reference->>'role'or item->>'objectPath'is distinct from reference->>'objectPath'or item->>'contentSha256'is distinct from reference->>'contentSha256'or item->>'publicUrl'is distinct from reference->>'publicUrl'then return false;end if;
  end if;i:=i+1;
 end loop;
 return (select count(distinct value->>'publicUrl')from jsonb_array_elements(transport))=i and (select count(distinct value->>'objectPath')from jsonb_array_elements(transport))=i;
exception when others then return false;
end$$;
revoke all on function sellerpilot_private.external_detail_asset_binding_is_current(jsonb,jsonb,bigint,uuid)from public,anon,authenticated,service_role;

-- No previous special-case Qoo10/11st/Studio verifier is replaced or weakened.
alter function public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid) rename to sellerpilot_verification_source_before_external;
create function public.sellerpilot_service_listing_publication_verification_source(p_token_hash text,p_job_id uuid,p_claim_token uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare source sellerpilot_private.channel_gateway_jobs%rowtype;review sellerpilot_private.listing_publication_reviews%rowtype;verifier sellerpilot_private.channel_gateway_jobs%rowtype;manifest jsonb;
begin
 if p_token_hash is null or p_job_id is null or p_claim_token is null or not sellerpilot_private.serverless_cs_job_is_owned(p_token_hash,p_job_id,p_claim_token,true)then raise exception 'publication verification source ownership required'using errcode='42501';end if;
 select * into verifier from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
 select * into review from sellerpilot_private.listing_publication_reviews where last_job_id=p_job_id;
 select * into source from sellerpilot_private.channel_gateway_jobs where id=review.source_job_id;
 if source.request_payload#>'{arguments,sellerpilotExternalDetail}' is null then return public.sellerpilot_verification_source_before_external(p_token_hash,p_job_id,p_claim_token);end if;
 manifest:=sellerpilot_private.external_detail_source_manifest(source.id);
 if manifest is null or verifier.status<>'running' or verifier.claim_token is distinct from p_claim_token or verifier.operation<>'listing.publication.verify' or verifier.attempt_id is not null or verifier.provider_mutation_started_at is not null or verifier.write_resource_kind is not null or verifier.write_resource_key is not null or review.status<>'verifying' or not sellerpilot_private.listing_publication_review_is_current(review.listing_id) or source.status<>'succeeded' or source.operation not in('listing.create','listing.update') or source.request_fingerprint is distinct from review.expected_fingerprint or not sellerpilot_private.external_detail_asset_binding_is_current(source.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}',manifest,(source.request_payload#>>'{arguments,sellerpilotExternalDetail,version}')::bigint,source.attempt_id) or source.response_payload#>>'{remoteState,evidence,publicationAssetBinding,approvedManifestDigest}' is distinct from manifest->>'digest' or source.response_payload#>>'{remoteState,evidence,publicationAssetBinding,approvedDetailPageVersion}' is distinct from source.request_payload#>>'{arguments,sellerpilotExternalDetail,version}' or source.response_payload#>>'{remoteState,evidence,publicationAssetBinding,contract}' is distinct from 'sellerpilot_provider_asset_binding_v1' or jsonb_array_length(source.response_payload#>'{remoteState,evidence,publicationAssetBinding,providerDetailImageIdentities}') is distinct from 8 then raise exception 'EXTERNAL_DETAIL_VERIFICATION_SOURCE_UNAVAILABLE';end if;
 return jsonb_build_object('contract','listing_publication_verification_source_v1','verificationJobId',verifier.id,'sourceJobId',source.id,'sourceOperation',source.operation,'sourceArguments',source.request_payload->'arguments','sourceResponsePayload',source.response_payload,'sourceFingerprint',source.request_fingerprint,'expectedRemoteId',review.expected_remote_id,'expectedLocale',review.expected_locale,'expectedImageCount',8,'market',review.market,'targetId',review.target_id,'externalDetailSource',source.request_payload#>'{arguments,sellerpilotExternalDetail}');
end$$;
-- Review scheduling and the later commit retain all original identity/deadline/
-- remote-state checks, with additional external source and normalized-byte proof.
alter function sellerpilot_private.listing_publication_review_is_current(uuid)rename to listing_publication_review_current_before_external;
create function sellerpilot_private.listing_publication_review_is_current(p_listing_id uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;m jsonb;
begin
 if not sellerpilot_private.listing_publication_review_current_before_external(p_listing_id)then return false;end if;
 select s.* into j from sellerpilot_private.listing_publication_reviews r join sellerpilot_private.channel_gateway_jobs s on s.id=r.source_job_id where r.listing_id=p_listing_id;
 if j.request_payload#>'{arguments,sellerpilotExternalDetail}' is null then return true;end if;
 m:=sellerpilot_private.external_detail_source_manifest(j.id);
 return m is not null and sellerpilot_private.external_detail_asset_binding_is_current(j.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}',m,(j.request_payload#>>'{arguments,sellerpilotExternalDetail,version}')::bigint,j.attempt_id);
end$$;
revoke all on function sellerpilot_private.external_detail_canonical(jsonb),sellerpilot_private.external_detail_hash(jsonb),sellerpilot_private.external_detail_import_is_current(uuid),sellerpilot_private.external_detail_source_manifest(uuid),sellerpilot_private.listing_publication_review_is_current(uuid),sellerpilot_private.listing_publication_review_current_before_external(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_bind_marketplace_normalized_asset_urls(uuid,jsonb),public.sellerpilot_bind_normalized_urls_before_external(uuid,jsonb),public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid),public.sellerpilot_verification_source_before_external(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_bind_marketplace_normalized_asset_urls(uuid,jsonb),public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)to service_role;
create function sellerpilot_private.guard_external_detail_publication_completion()returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb; source_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
 if new.status='succeeded' and old.status is distinct from 'succeeded' and new.operation='listing.publication.verify' then
  select s.* into source_job from sellerpilot_private.listing_publication_reviews r join sellerpilot_private.channel_gateway_jobs s on s.id=r.source_job_id where r.last_job_id=new.id and s.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null;
  if source_job.id is not null then
   m:=sellerpilot_private.external_detail_source_manifest(source_job.id);
   if m is null or not sellerpilot_private.external_detail_asset_binding_is_current(source_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}',m,(source_job.request_payload#>>'{arguments,sellerpilotExternalDetail,version}')::bigint,source_job.attempt_id)then raise exception 'EXTERNAL_DETAIL_VERIFIER_COMMIT_STALE';end if;
  end if;
 end if;
 if new.status='succeeded' and old.status is distinct from 'succeeded' and new.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null then
  m:=sellerpilot_private.external_detail_source_manifest(old.id);
  if new.response_payload#>>'{remoteState,evidence,publicationAssetBinding,contract}' is distinct from 'sellerpilot_provider_asset_binding_v1' or new.response_payload#>>'{remoteState,evidence,publicationAssetBinding,approvedManifestDigest}' is distinct from m->>'digest' or new.response_payload#>>'{remoteState,evidence,publicationAssetBinding,approvedDetailPageVersion}' is distinct from new.request_payload#>>'{arguments,sellerpilotExternalDetail,version}' or jsonb_array_length(new.response_payload#>'{remoteState,evidence,publicationAssetBinding,providerDetailImageIdentities}') is distinct from 8 or exists(select 1 from jsonb_array_elements_text(new.response_payload#>'{remoteState,evidence,publicationAssetBinding,providerDetailImageIdentities}')x where x ~ '(^blob:|/storage/v1/object/sign/)') then raise exception 'EXTERNAL_DETAIL_PROVIDER_RECEIPT_REQUIRED';end if;
  if m is null or not sellerpilot_private.external_detail_asset_binding_is_current(new.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}',m,(new.request_payload#>>'{arguments,sellerpilotExternalDetail,version}')::bigint,new.attempt_id) then raise exception 'EXTERNAL_DETAIL_COMPLETION_SOURCE_STALE';end if;
 end if;
 return new;
end$$;
revoke all on function sellerpilot_private.guard_external_detail_publication_completion()from public,anon,authenticated,service_role;
create trigger external_detail_completion_source_guard before update of status,response_payload on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_external_detail_publication_completion();

commit;
