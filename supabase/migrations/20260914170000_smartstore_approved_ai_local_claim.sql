-- SmartStore cloud execution remains disabled after the existing IP rejection.
-- Let the already approved Mac route claim ordinary approved AI CREATE jobs,
-- without impersonating an external import or changing the queued request.
-- Apply with the separately reviewed shared-admin source/transport migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='25s';
do $preimages$
begin
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure) is distinct from '345ac378330c2ace15732c1f0aec82d1'
 or (select md5(prosrc) from pg_proc where oid='sellerpilot_private.local_channel_executor_route_is_current(uuid,text,text,uuid,uuid,text,text,text)'::regprocedure) is distinct from 'fdef34f70f1a74e537b66c62c59cc8ef'
 or (select md5(prosrc) from pg_proc where oid='public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure) is distinct from '4256af45bff711948f2ac8ba9383aeb6'
 or (select md5(prosrc) from pg_proc where oid='public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure) is distinct from '4f756d776a5f4193e55daa89cec9a853'
 then raise exception 'SMARTSTORE_AI_LOCAL_CLAIM_PREIMAGE_DRIFT';end if;
 perform pg_advisory_xact_lock(193674993,821065042);
 perform 1 from sellerpilot_private.serverless_static_egress_policy where channel='smartstore' for update;
 if (select md5(to_jsonb(p)::text) from sellerpilot_private.serverless_static_egress_policy p where channel='smartstore') is distinct from '06bffa575fb51b52c9dfcd72072ef1fc'
 then raise exception 'SMARTSTORE_AI_LOCAL_POLICY_DRIFT';end if;
 -- This selects the existing local routes. Cloud is already unconditionally
 -- excluded; no additional marketplace or operation gains an approval.
 update sellerpilot_private.serverless_static_egress_policy set enabled=false,updated_at=clock_timestamp() where channel='smartstore';
end $preimages$;

create function sellerpilot_private.smartstore_approved_ai_local_claim_allowed(
 p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
) returns boolean language plpgsql stable security definer set search_path='' as $body$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;
 a sellerpilot_private.channel_operation_attempts%rowtype;
 l sellerpilot_private.product_listings%rowtype;
 p sellerpilot_private.products%rowtype;
 source jsonb;snapshot jsonb;binding jsonb;transport jsonb;body jsonb;field text;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job_id and credential_id=p_credential_id;
 if j.id is null or j.channel<>'smartstore' or j.operation<>'listing.create' or j.environment<>'production'
 or j.status<>'queued' or j.attempt_count<>0 or j.started_at is not null or j.completed_at is not null
 or j.worker_token_id is not null or j.claim_token is not null or j.lease_expires_at is not null
 or j.provider_mutation_started_at is not null or j.response_payload is not null
 or j.credential_refresh_in_flight is distinct from false or j.credential_refresh_recovery_vault_id is not null
 or j.prepared_credential_id is not null or j.oauth_exchange_completed is distinct from false
 or j.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null
 or j.request_payload#>>'{arguments,publicationIntent}' is distinct from 'live'
 or j.request_payload#>>'{arguments,publicationStateContract}' is distinct from 'verified_remote_state_v1'
 or j.request_payload#>>'{arguments,publicationExpectedLocale}' is distinct from 'ko-KR'
 or j.request_payload#>'{arguments,publicationExpectedImageCount}' is distinct from '8'::jsonb
 then return false;end if;
 select * into a from sellerpilot_private.channel_operation_attempts where id=j.attempt_id;
 select * into l from sellerpilot_private.product_listings where id=j.listing_id;
 select * into p from sellerpilot_private.products where id=l.product_id;
 if a.id is null or a.status<>'running' or a.remote_id is not null
 or a.credential_id is distinct from j.credential_id or a.channel is distinct from j.channel or a.operation is distinct from j.operation
 or a.seller_account_key is distinct from j.seller_account_key or a.request_fingerprint is distinct from j.request_fingerprint
 or l.id is null or l.owner_id is distinct from a.owner_id or l.operation_attempt_id is distinct from a.id
 or l.channel_key is distinct from j.channel or l.status<>'queued' or l.remote_id is not null or l.published_at is not null
 or (l.seller_account_key is not null and l.seller_account_key is distinct from j.seller_account_key)
 or p.id is null or p.owner_id is distinct from a.owner_id or p.external_detail_import_id is not null
 or not coalesce(p.status in('draft','active'),false) or p.demo
 or not exists(select 1 from sellerpilot_private.ai_cli_jobs ai where ai.id=p.ai_job_id and ai.kind='product_studio' and ai.status='succeeded')
 or not exists(select 1 from sellerpilot_private.channel_credentials c where c.id=j.credential_id and c.channel=j.channel and c.environment=j.environment
 and c.created_by=j.created_by and c.seller_account_key=j.seller_account_key and c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null)
 or not exists(select 1 from sellerpilot_private.admin_users where user_id=a.owner_id)
 or not sellerpilot_private.local_channel_executor_route_is_current(a.owner_id,j.channel,j.operation,j.credential_id,p_worker_token_id,p_release_sha,p_egress_ip_sha256,p_worker_version)
 then return false;end if;
 -- Reuse the official source snapshot as a read-only preclaim check. The
 -- source CAS, final transport bytes and duplicate preflight still run before
 -- the real provider write under their existing contracts.
 snapshot:=public.sellerpilot_service_smartstore_create_source_snapshot(a.owner_id,p.id,j.credential_id);
 source:=j.request_payload#>'{arguments,sellerpilotSmartstoreCreateSource}';
 if snapshot is null or snapshot->>'contract' is distinct from 'smartstore_listing_create_source_snapshot_v1'
 or source->>'contract' is distinct from 'smartstore_listing_create_source_v1'
 or coalesce(source->>'bodyBindingSha256','')!~'^[a-f0-9]{64}$'
 then return false;end if;
 foreach field in array array['ownerId','productId','salePrice','productName','credentialId','stockQuantity','productUpdatedAt','credentialVersion','detailPageVersion','manualFieldsSha256','sellerManagementCode','credentialFingerprint','approvedManifestDigest','credentialLastRotatedAt','credentialVaultSecretId','approvedDetailPageVersion'] loop
  if source->field is null or source->field is distinct from snapshot->field then return false;end if;
 end loop;
 binding:=j.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
 if binding->>'contract' is distinct from 'sellerpilot_publication_asset_binding_v1'
 or binding->>'approvedManifestDigest' is distinct from source->>'approvedManifestDigest'
 or binding->'approvedDetailPageVersion' is distinct from source->'approvedDetailPageVersion'
 or p.detail_page_image_manifest->>'contract' is distinct from 'sellerpilot_detail_image_manifest_v2'
 or jsonb_typeof(p.detail_page_image_manifest->'images') is distinct from 'array' or jsonb_array_length(p.detail_page_image_manifest->'images')<>8
 or jsonb_typeof(binding->'approvedDetailImages') is distinct from 'array' or jsonb_array_length(binding->'approvedDetailImages')<>8
 or exists(select 1 from generate_series(0,7) i where
 p.detail_page_image_manifest#>>array['images',i::text,'role'] is distinct from binding#>>array['approvedDetailImages',i::text,'role']
 or p.detail_page_image_manifest#>>array['images',i::text,'path'] is distinct from binding#>>array['approvedDetailImages',i::text,'approvedObjectPath']
 or p.detail_page_image_manifest#>>array['images',i::text,'sourceSha256'] is distinct from binding#>>array['approvedDetailImages',i::text,'approvedSourceSha256'])
 then return false;end if;
 body:=j.request_payload#>'{arguments,body}';transport:=j.request_payload#>'{arguments,sellerpilotSmartstoreCreateTransport}';
 if jsonb_typeof(body) is distinct from 'object' or transport->>'contract' is distinct from 'smartstore_create_transport_v1'
 or coalesce(transport->>'bodySha256','')!~'^[a-f0-9]{64}$'
 or encode(extensions.digest(transport->>'bodyText','sha256'),'hex') is distinct from transport->>'bodySha256'
 or octet_length(transport->>'bodyText') is distinct from (transport->>'bodyByteLength')::integer
 or (transport->>'bodyByteLength')::integer not between 2 and 1048576
 or (transport->>'bodyText')::jsonb is distinct from body
 or body#>>'{originProduct,name}' is distinct from source->>'productName'
 or body#>>'{smartstoreChannelProduct,channelProductName}' is distinct from source->>'productName'
 or body#>'{originProduct,salePrice}' is distinct from source->'salePrice'
 or body#>'{originProduct,stockQuantity}' is distinct from source->'stockQuantity'
 or body#>>'{originProduct,detailAttribute,sellerCodeInfo,sellerManagementCode}' is distinct from source->>'sellerManagementCode'
 then return false;end if;
 return true;
exception when others then return false;
end $body$;
revoke all on function sellerpilot_private.smartstore_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;

do $dispatch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure);
 needle:=$old$begin
  if exists(select 1 from sellerpilot_private.channel_gateway_jobs where id=p_job_id and channel='shopee' and operation='shops.get') then$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'SMARTSTORE_AI_LOCAL_DISPATCH_ANCHOR_DRIFT';end if;
 execute replace(definition,needle,$new$begin
  if sellerpilot_private.smartstore_approved_ai_local_claim_allowed(p_job_id,p_credential_id,p_worker_token_id,p_worker_version,p_release_sha,p_egress_ip_sha256) then return true;end if;
  if exists(select 1 from sellerpilot_private.channel_gateway_jobs where id=p_job_id and channel='shopee' and operation='shops.get') then$new$);
end $dispatch$;
notify pgrst,'reload schema';
commit;
