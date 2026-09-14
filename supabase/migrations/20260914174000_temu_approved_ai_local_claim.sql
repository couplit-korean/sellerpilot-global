-- Admit approved AI Temu CREATE only through the already approved Mac route.
-- This adds a read-only preclaim predicate. It does not authorize a new route,
-- change any queue/source/approval row, or replace the final provider-write CAS.
begin;
set local lock_timeout='5s';
set local statement_timeout='25s';
do $preimages$ begin
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure) is distinct from 'd92426bf88f3799b44d668818b1d45f6' then raise exception 'TEMU_AI_LOCAL_PREIMAGE_DRIFT:local_channel_executor_job_allowed';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_private.local_channel_executor_route_is_current(uuid,text,text,uuid,uuid,text,text,text)'::regprocedure) is distinct from 'fdef34f70f1a74e537b66c62c59cc8ef' then raise exception 'TEMU_AI_LOCAL_PREIMAGE_DRIFT:local_channel_executor_route_is_current';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_private.temu_create_evidence_valid(jsonb,uuid,text,uuid,integer,text,text,text,text,text,text,text,text)'::regprocedure) is distinct from '84cba2ba9495ffba94784dd15e5d34f1' then raise exception 'TEMU_AI_LOCAL_PREIMAGE_DRIFT:temu_create_evidence_valid';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_private.temu_create_source_provider_allowed(uuid,uuid)'::regprocedure) is distinct from 'e303805a72ae410f120b0fb47cca66db' then raise exception 'TEMU_AI_LOCAL_PREIMAGE_DRIFT:temu_create_source_provider_allowed';end if;
 if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_service_read_temu_verified_create_app_gate_v1(uuid,uuid,uuid)'::regprocedure) is distinct from '1666ad9856ca6555295c8399913845ba' then raise exception 'TEMU_AI_LOCAL_PREIMAGE_DRIFT:sellerpilot_service_read_temu_verified_create_app_gate_v1';end if;
 if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_service_read_temu_create_authoritative_source_v1(uuid,uuid,uuid,text)'::regprocedure) is distinct from '2794bfea77b6c25d88aabe39a30254f9' then raise exception 'TEMU_AI_LOCAL_PREIMAGE_DRIFT:sellerpilot_service_read_temu_create_authoritative_source_v1';end if;
end $preimages$;

create function sellerpilot_private.temu_approved_ai_local_claim_allowed(
 p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
) returns boolean language plpgsql stable security definer set search_path='' as $body$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;
 a sellerpilot_private.channel_operation_attempts%rowtype;
 l sellerpilot_private.product_listings%rowtype;
 p sellerpilot_private.products%rowtype;
 c sellerpilot_private.channel_credentials%rowtype;
 s sellerpilot_private.temu_create_authoritative_sources%rowtype;
 source jsonb;snapshot jsonb;binding jsonb;app_gate jsonb;field text;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job_id and credential_id=p_credential_id;
 if j.id is null or j.channel<>'temu' or j.operation<>'listing.create' or j.environment<>'production'
 or j.status<>'queued' or j.attempt_count<>0 or j.started_at is not null or j.completed_at is not null
 or j.worker_token_id is not null or j.claim_token is not null or j.lease_expires_at is not null
 or j.provider_mutation_started_at is not null or j.response_payload is not null
 or j.credential_refresh_in_flight is distinct from false or j.credential_refresh_recovery_vault_id is not null
 or j.prepared_credential_id is not null or j.oauth_exchange_completed is distinct from false
 or j.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null
 or j.request_payload#>>'{arguments,publicationIntent}' is distinct from 'live'
 or j.request_payload#>>'{arguments,publicationStateContract}' is distinct from 'verified_remote_state_v1'
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
 or not exists(select 1 from sellerpilot_private.channel_credentials credential where credential.id=j.credential_id and credential.channel=j.channel and credential.environment=j.environment
 and credential.created_by=j.created_by and credential.seller_account_key=j.seller_account_key and credential.seller_account_key_source='provider_certified_v1' and credential.seller_account_verified_at is not null)
 or not exists(select 1 from sellerpilot_private.admin_users where user_id=a.owner_id)
 or not sellerpilot_private.local_channel_executor_route_is_current(a.owner_id,j.channel,j.operation,j.credential_id,p_worker_token_id,p_release_sha,p_egress_ip_sha256,p_worker_version)
 then return false;end if;
 -- Reuse the existing service-only current-source and collector readers.
 -- Final normalized body/asset recording occurs after claim and its existing
 -- provider mutation fence remains authoritative; never mark it complete here.
 source:=j.request_payload#>'{arguments,sellerpilotTemuAuthoritativeSource}';
 if source->>'contract' is distinct from 'temu_create_authoritative_source_binding_v1' then return false;end if;
 snapshot:=public.sellerpilot_service_read_temu_create_authoritative_source_v1(a.owner_id,p.id,j.credential_id,j.request_fingerprint);
 app_gate:=public.sellerpilot_service_read_temu_verified_create_app_gate_v1(a.owner_id,p.id,j.credential_id);
 if snapshot->>'contract' is distinct from 'temu_create_authoritative_source_read_v1' or snapshot->>'status' is distinct from 'ready'
 or app_gate->>'contract' is distinct from 'temu_verified_create_app_gate_v1' or app_gate->>'status' is distinct from 'allowed'
 then return false;end if;
 foreach field in array array['sourceId','sourceRevision','evidenceSha256','requestFingerprint','productRevisionFingerprint'] loop
  if source->field is null or source->field is distinct from snapshot->field then return false;end if;
 end loop;
 select * into s from sellerpilot_private.temu_create_authoritative_sources where id=(source->>'sourceId')::uuid;
 select * into c from sellerpilot_private.channel_credentials where id=j.credential_id;
 if s.id is null or c.id is null or s.owner_id is distinct from a.owner_id or s.owner_id is distinct from j.created_by
 or s.product_id is distinct from p.id or s.credential_id is distinct from c.id
 or s.product_updated_at is distinct from p.updated_at or s.request_fingerprint is distinct from j.request_fingerprint
 or s.credential_version is distinct from c.version or s.credential_fingerprint is distinct from c.fingerprint
 or c.created_by is distinct from s.owner_id or s.expires_at<=clock_timestamp()
 or s.collector_attestation_id::text is distinct from app_gate->>'collectorAttestationId'
 or s.partner_account_subject is distinct from app_gate->>'partnerAccountSubject'
 or s.evidence#>>'{app,appId}' is distinct from app_gate->>'appId'
 or sellerpilot_private.temu_create_evidence_valid(s.evidence,s.product_id,s.product_revision_fingerprint,s.credential_id,
   s.credential_version,s.partner_account_subject,s.token_identity_subject,s.mall_id,s.region_id,s.request_fingerprint,
   s.category_plan_sha256,s.category_request_sha256,s.category_response_sha256) is not true
 then return false;end if;
 binding:=j.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
 if binding->>'contract' is distinct from 'sellerpilot_publication_asset_binding_v1'
 or p.detail_page_version is null or p.detail_page_version<1
 or p.detail_page_approved_version is distinct from p.detail_page_version
 or binding->>'approvedDetailPageVersion' is distinct from p.detail_page_approved_version::text
 or binding->>'approvedManifestDigest' is distinct from p.detail_page_image_manifest->>'digest'
 or coalesce(binding->>'approvedManifestDigest','')!~'^[a-f0-9]{64}$'
 or p.detail_page_image_manifest->>'contract' is distinct from 'sellerpilot_detail_image_manifest_v2'
 or jsonb_typeof(p.detail_page_image_manifest->'images') is distinct from 'array' or jsonb_array_length(p.detail_page_image_manifest->'images')<>8
 or jsonb_typeof(binding->'approvedDetailImages') is distinct from 'array' or jsonb_array_length(binding->'approvedDetailImages')<>8
 or exists(select 1 from generate_series(0,7) i where
 p.detail_page_image_manifest#>>array['images',i::text,'role'] is distinct from binding#>>array['approvedDetailImages',i::text,'role']
 or p.detail_page_image_manifest#>>array['images',i::text,'path'] is distinct from binding#>>array['approvedDetailImages',i::text,'approvedObjectPath']
 or p.detail_page_image_manifest#>>array['images',i::text,'sourceSha256'] is distinct from binding#>>array['approvedDetailImages',i::text,'approvedSourceSha256'])
 then return false;end if;
 return true;
exception when others then return false;
end $body$;
revoke all on function sellerpilot_private.temu_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;

do $dispatch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure);
 needle:=$old$begin
  if sellerpilot_private.smartstore_approved_ai_local_claim_allowed$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'TEMU_AI_LOCAL_DISPATCH_ANCHOR_DRIFT';end if;
 execute replace(definition,needle,$new$begin
  if sellerpilot_private.temu_approved_ai_local_claim_allowed(p_job_id,p_credential_id,p_worker_token_id,p_worker_version,p_release_sha,p_egress_ip_sha256) then return true;end if;
  if sellerpilot_private.smartstore_approved_ai_local_claim_allowed$new$);
end $dispatch$;
notify pgrst,'reload schema';
commit;
