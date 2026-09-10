-- Forward-only r6 hardening for Elevenst approved assets and GET-only CREATE recovery.
-- This migration never enqueues a job and never calls the provider.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900704450);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_category_assignments_one_elevenst_production_confirmed_'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)'
     ) is null then
    raise exception 'ELEVENST_R6_DEPENDENCY_MISSING';
  end if;
end;
$dependencies$;

-- PostgreSQL stored the two r3/r4 identifiers after silent 63-byte truncation.
-- Rename those exact catalog names; never refer to the misleading source spellings.
alter function public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(
  uuid,uuid,uuid,text,text
) rename to sellerpilot_100445_11st_source_readback_pre_cas;

alter index sellerpilot_private.product_category_assignments_one_elevenst_production_confirmed_
  rename to product_cat_one_11st_prod_confirmed_uidx;

revoke all on function public.sellerpilot_100445_11st_source_readback_pre_cas(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_service_elevenst_new_product_source_readback(
  p_actor_id uuid,p_product_id uuid,p_credential_id uuid,p_market text,p_target_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; permit_status text;
begin
  result:=public.sellerpilot_100445_11st_source_readback_pre_cas(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
  if result is null then return null; end if;
  select permit.status into permit_status
    from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.source_id=(result->>'sourceId')::uuid;
  if found and permit_status in('consumed','reconciliation_required') then return null; end if;
  return result;
end;
$$;

-- Require server-read object byte identities on every newly approved image source.
alter function public.sellerpilot_service_approve_elevenst_new_product_source(
  uuid,uuid,uuid,uuid,text,text,jsonb
) rename to sellerpilot_100445_11st_approve_before_object_bytes;
revoke all on function public.sellerpilot_100445_11st_approve_before_object_bytes(
  uuid,uuid,uuid,uuid,text,text,jsonb
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_approve_elevenst_new_product_source(
  p_actor_id uuid,p_approval_request_id uuid,p_product_id uuid,p_credential_id uuid,
  p_market text,p_target_id text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  request_row sellerpilot_private.elevenst_new_product_approval_requests%rowtype;
  old_payload jsonb;
  result jsonb;
  full_hash text;
  receipts jsonb:=p_payload#>'{policySource,content,objectReceipts}';
  product_paths jsonb:=p_payload#>'{policySource,content,productImagePaths}';
  detail_paths jsonb:=p_payload#>'{policySource,content,detailImagePaths}';
  detail_bucket text:=p_payload#>>'{policySource,content,detailImageBucket}';
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or pg_catalog.jsonb_typeof(p_payload)<>'object'
     or pg_catalog.jsonb_typeof(receipts)<>'array'
     or pg_catalog.jsonb_array_length(receipts)<>12
     or not sellerpilot_private.elevenst_jsonb_exact_keys(
       p_payload#>'{policySource,content}',array[
         'htmlDetailTemplate','htmlDetailTemplateSha256','productImageBucket',
         'detailImageBucket','productImagePaths','detailImagePaths','imagePathsSha256',
         'objectReceipts','objectReceiptsSha256'])
     or p_payload#>>'{policySource,content,objectReceiptsSha256}' is distinct from
       sellerpilot_private.elevenst_canonical_sha256(receipts)
     or exists(
       select 1
         from pg_catalog.jsonb_array_elements(receipts) with ordinality receipt(value,ordinality)
        where not sellerpilot_private.elevenst_jsonb_exact_keys(
          receipt.value,array['bucket','path','bytesSha256','contentLength','contentType'])
          or receipt.value->>'bytesSha256'!~'^[a-f0-9]{64}$'
          or receipt.value->>'contentLength'!~'^[1-9][0-9]*$'
          or receipt.value->>'contentType'!~'^image/[a-z0-9.+-]+$'
          or receipt.value->>'bucket' is distinct from case
            when receipt.ordinality<=4 then 'sellerpilot-ai' else detail_bucket end
          or receipt.value->>'path' is distinct from case
            when receipt.ordinality<=4 then product_paths->>(receipt.ordinality::integer-1)
            else detail_paths->>(receipt.ordinality::integer-5) end
     ) then
    raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_EVIDENCE_INVALID' using errcode='22023';
  end if;
  full_hash:=sellerpilot_private.elevenst_new_product_source_approval_hash(p_payload);
  select request.* into strict request_row
    from sellerpilot_private.elevenst_new_product_approval_requests request
   where request.approval_request_id=p_approval_request_id for update;
  if request_row.status='approved' then
    if request_row.actor_id=p_actor_id and request_row.product_id=p_product_id
       and request_row.credential_id=p_credential_id
       and request_row.approval_payload_sha256=full_hash then
      return pg_catalog.jsonb_build_object(
        'status','existing','sourceId',request_row.source_id,
        'approvalPayloadSha256',full_hash);
    end if;
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_REQUEST_CONFLICT' using errcode='23505';
  end if;
  old_payload:=pg_catalog.jsonb_set(
    p_payload #- '{policySource,content,objectReceipts}'
              #- '{policySource,content,objectReceiptsSha256}',
    '{policySource,content,imagePathsSha256}',
    pg_catalog.to_jsonb(sellerpilot_private.elevenst_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'productImagePaths',product_paths,'detailImagePaths',detail_paths))),
    false);
  result:=public.sellerpilot_100445_11st_approve_before_object_bytes(
    p_actor_id,p_approval_request_id,p_product_id,p_credential_id,p_market,p_target_id,old_payload);
  if result->>'status'<>'approved' then
    raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_APPROVAL_CONFLICT' using errcode='40001';
  end if;
  update sellerpilot_private.elevenst_new_product_server_sources source
     set policy_source=p_payload->'policySource'
   where source.id=(result->>'sourceId')::uuid and source.owner_id=p_actor_id;
  if not found then raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_SOURCE_STALE' using errcode='40001'; end if;
  update sellerpilot_private.elevenst_new_product_source_approvals approval
     set approval_payload_sha256=full_hash
   where approval.source_id=(result->>'sourceId')::uuid
     and approval.approval_request_id=p_approval_request_id;
  if not found then raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_APPROVAL_STALE' using errcode='40001'; end if;
  update sellerpilot_private.elevenst_new_product_approval_requests request
     set approval_payload_sha256=full_hash,updated_at=pg_catalog.clock_timestamp()
   where request.approval_request_id=p_approval_request_id
     and request.source_id=(result->>'sourceId')::uuid;
  if not found then raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_REQUEST_STALE' using errcode='40001'; end if;
  return result||pg_catalog.jsonb_build_object('approvalPayloadSha256',full_hash);
exception when no_data_found then
  raise exception 'ELEVENST_APPROVED_ASSET_OBJECT_REQUEST_STALE' using errcode='40001';
end;
$$;

create or replace function public.sellerpilot_service_claim_elevenst_create_recovery(
  p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  api_key text;
  recovery_token uuid:=pg_catalog.gen_random_uuid();
  candidate_source_id uuid;
  current_source jsonb;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope in('gateway','serverless_cs')
                   and value.status='active' and value.expires_at>pg_catalog.clock_timestamp()) then
    raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
  end if;
  select value.source_id into candidate_source_id
    from sellerpilot_private.elevenst_new_product_execution_permits value
    join sellerpilot_private.channel_gateway_jobs candidate on candidate.id=value.consumed_job_id
   where value.status='reconciliation_required' and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null
       or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
     and candidate.channel='elevenst' and candidate.operation='listing.create'
     and candidate.status='reconciliation_required'
   order by value.updated_at limit 1;
  if candidate_source_id is null then return null; end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(candidate_source_id);
  select * into strict permit
    from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=candidate_source_id and value.status='reconciliation_required'
     and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null
       or value.recovery_lease_expires_at<pg_catalog.clock_timestamp()) for update;
  perform 1 from sellerpilot_private.products value
   where value.id=permit.product_id and value.owner_id=permit.owner_id for update;
  select * into strict credential from sellerpilot_private.channel_credentials value
   where value.id=permit.credential_id and value.created_by=permit.owner_id
     and value.version=permit.credential_version and value.channel='elevenst'
     and value.environment='production' and value.status='active'
     and (value.expires_at is null or value.expires_at>pg_catalog.clock_timestamp()) for update;
  perform 1 from sellerpilot_private.product_category_assignments value
   where value.id=permit.assignment_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.channel='elevenst'
     and value.environment='production' and value.market=permit.market
     and value.category_id='1346631' and value.status='confirmed'
     and value.is_leaf and value.confirmed_at=permit.assignment_confirmed_at for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.product_registration_drafts value
   where value.owner_id=permit.owner_id and value.product_id=permit.product_id
     and value.kind='publish' and value.version=permit.draft_version for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value
   where value.id=permit.source_id and value.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value
   where value.source_id=permit.source_id
     and value.approval_payload_sha256=permit.approval_payload_sha256 for update;
  perform 1 from sellerpilot_private.elevenst_new_product_approval_requests value
   where value.approval_request_id=permit.approval_request_id
     and value.source_id=permit.source_id and value.status='approved' for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value
   where value.id=permit.consumed_job_id and value.attempt_id is not null
     and value.listing_id is not null and value.channel='elevenst'
     and value.operation='listing.create' and value.environment='production'
     and value.status='reconciliation_required' and value.credential_id=permit.credential_id
     and value.created_by=permit.owner_id
     and value.request_fingerprint=permit.request_fingerprint for update;
  current_source:=public.sellerpilot_100445_11st_source_readback_pre_cas(
    permit.owner_id,permit.product_id,permit.credential_id,permit.market,permit.target_id);
  if current_source is null or current_source->>'sourceId'<>permit.source_id::text
     or current_source->>'sixKindDigest'<>permit.six_kind_digest
     or current_source->>'approvalPayloadSha256'<>permit.approval_payload_sha256 then
    raise no_data_found;
  end if;
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into api_key
    from vault.decrypted_secrets secret where secret.id=credential.vault_secret_id;
  if api_key!~'^[A-Za-z0-9]{32}$' then raise no_data_found; end if;
  update sellerpilot_private.elevenst_new_product_execution_permits value set
    recovery_claim_token=recovery_token,
    recovery_lease_expires_at=pg_catalog.clock_timestamp()+interval '60 seconds',
    recovery_attempt_count=recovery_attempt_count+1,updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id;
  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_create_recovery_claim_v1',
    'jobId',job.id,'recoveryToken',recovery_token,
    'credentialId',credential.id,'credentialVersion',credential.version,
    'credentialFingerprint',credential.fingerprint,'vaultSecretId',credential.vault_secret_id,
    'expectedApiKeySha256',pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex'),
    'expectedProduct',job.request_payload#>'{arguments,product}',
    'credential',pg_catalog.jsonb_build_object('api_key',api_key));
exception when no_data_found then
  raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
end;
$$;

create or replace function public.sellerpilot_service_finish_elevenst_create_recovery(
  p_token_hash text,p_job_id uuid,p_recovery_token uuid,p_observation jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  source sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  current_source jsonb;
  seal jsonb;
  api_key text;
  remote_id text:=pg_catalog.btrim(p_observation->>'productNo');
  seller_code text;
  observed_at timestamptz;
  reads jsonb:=p_observation->'providerReads';
  completed boolean:=false;
  changed_rows integer;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope in('gateway','serverless_cs')
                   and value.status='active' and value.expires_at>pg_catalog.clock_timestamp())
     or not sellerpilot_private.elevenst_jsonb_exact_keys(p_observation,array[
       'contract','outcome','sellerProductCode','productNo','fullOfficialReadback',
       'productMismatches','stockMismatches','providerReadbackUnavailableFields',
       'providerMutationPerformed','credentialEvidence','authoritativeSnapshot',
       'providerReads','observedAt'])
     or p_observation->>'contract'<>'sellerpilot_elevenst_create_get_only_recovery_v2'
     or p_observation->>'providerMutationPerformed'<>'false'
     or p_observation->>'outcome' not in('unique','absent','ambiguous','unavailable')
     or not sellerpilot_private.elevenst_jsonb_exact_keys(
       p_observation->'credentialEvidence',array[
         'credentialId','credentialVersion','credentialFingerprint','vaultSecretId','apiKeySha256'])
     or not sellerpilot_private.elevenst_jsonb_exact_keys(
       p_observation->'authoritativeSnapshot',array[
         'categoryId','priceKrw','stockQuantity','titleSha256',
         'productImagesSha256','detailHtmlSha256']) then
    raise exception 'ELEVENST_CREATE_RECOVERY_RESULT_INVALID' using errcode='42501';
  end if;
  select * into strict permit
    from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.consumed_job_id=p_job_id;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(permit.source_id);
  perform 1 from sellerpilot_private.products value
   where value.id=permit.product_id and value.owner_id=permit.owner_id for update;
  select * into strict credential from sellerpilot_private.channel_credentials value
   where value.id=permit.credential_id and value.created_by=permit.owner_id
     and value.version=permit.credential_version and value.channel='elevenst'
     and value.environment='production' and value.status='active'
     and value.fingerprint=permit.credential_fingerprint
     and value.vault_secret_id=permit.vault_secret_id
     and (value.expires_at is null or value.expires_at>pg_catalog.clock_timestamp()) for update;
  perform 1 from sellerpilot_private.product_category_assignments value
   where value.id=permit.assignment_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.channel='elevenst'
     and value.environment='production' and value.market=permit.market
     and value.category_id='1346631' and value.status='confirmed'
     and value.is_leaf and value.confirmed_at=permit.assignment_confirmed_at for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.product_registration_drafts value
   where value.owner_id=permit.owner_id and value.product_id=permit.product_id
     and value.kind='publish' and value.version=permit.draft_version for update;
  if not found then raise no_data_found; end if;
  select * into strict source from sellerpilot_private.elevenst_new_product_server_sources value
   where value.id=permit.source_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.credential_id=permit.credential_id
     and value.credential_version=permit.credential_version
     and value.product_revision=permit.product_revision
     and value.product_approval_revision=permit.product_approval_revision
     and value.category_id='1346631' and value.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value
   where value.source_id=permit.source_id and value.approval_request_id=permit.approval_request_id
     and value.owner_id=permit.owner_id and value.product_id=permit.product_id
     and value.credential_id=permit.credential_id and value.credential_version=permit.credential_version
     and value.draft_version=permit.draft_version
     and value.approval_payload_sha256=permit.approval_payload_sha256 for update;
  if not found then raise no_data_found; end if;
  perform 1 from sellerpilot_private.elevenst_new_product_approval_requests value
   where value.approval_request_id=permit.approval_request_id
     and value.source_id=permit.source_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.credential_id=permit.credential_id
     and value.credential_version=permit.credential_version and value.status='approved'
     and value.approval_payload_sha256=permit.approval_payload_sha256 for update;
  if not found then raise no_data_found; end if;
  select * into strict permit
    from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.permit_id=permit.permit_id and value.status='reconciliation_required'
     and value.recovery_claim_token=p_recovery_token
     and value.recovery_lease_expires_at>=pg_catalog.clock_timestamp() for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value
   where value.id=p_job_id and value.attempt_id is not null and value.listing_id is not null
     and value.channel='elevenst' and value.operation='listing.create'
     and value.environment='production' and value.status='reconciliation_required'
     and value.credential_id=permit.credential_id and value.created_by=permit.owner_id
     and value.request_fingerprint=permit.request_fingerprint for update;
  select * into strict attempt from sellerpilot_private.channel_operation_attempts value
   where value.id=job.attempt_id and value.owner_id=permit.owner_id
     and value.credential_id=permit.credential_id and value.channel='elevenst'
     and value.operation='listing.create' and value.status in('running','manual_required')
     and value.request_fingerprint=permit.request_fingerprint and value.remote_id is null for update;
  select * into strict listing from sellerpilot_private.product_listings value
   where value.id=job.listing_id and value.owner_id=permit.owner_id
     and value.product_id=permit.product_id and value.channel_key='elevenst'
     and value.remote_id is null for update;
  current_source:=public.sellerpilot_100445_11st_source_readback_pre_cas(
    permit.owner_id,permit.product_id,permit.credential_id,permit.market,permit.target_id);
  if current_source is null or current_source->>'sourceId'<>permit.source_id::text
     or current_source->>'ownerId'<>permit.owner_id::text
     or current_source->>'productId'<>permit.product_id::text
     or current_source->>'credentialId'<>permit.credential_id::text
     or (current_source->>'credentialVersion')::integer<>permit.credential_version
     or (current_source->>'productRevision')::bigint<>permit.product_revision
     or (current_source->>'productApprovalRevision')::bigint<>permit.product_approval_revision
     or (current_source->>'draftVersion')::bigint<>permit.draft_version
     or current_source->>'approvalPayloadSha256'<>permit.approval_payload_sha256
     or current_source->>'sixKindDigest'<>permit.six_kind_digest then raise no_data_found; end if;
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into api_key
    from vault.decrypted_secrets secret where secret.id=credential.vault_secret_id;
  seal:=job.request_payload#>'{arguments,sellerpilotElevenstFinalExecutionSeal}';
  seller_code:=pg_catalog.btrim(job.request_payload#>>'{arguments,product,sellerPrdCd}');
  begin observed_at:=(p_observation->>'observedAt')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'ELEVENST_CREATE_RECOVERY_RESULT_INVALID' using errcode='42501'; end;
  if api_key!~'^[A-Za-z0-9]{32}$'
     or pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex')<>permit.api_key_sha256
     or not sellerpilot_private.elevenst_jsonb_exact_keys(seal,array[
       'contract','permitId','sourceId','requestFingerprint','finalArgumentsSha256',
       'providerBodySha256','providerBodyBytes','credentialId','credentialVersion',
       'credentialFingerprint','vaultSecretId','apiKeySha256','sealedAt'])
     or seal->>'contract'<>'sellerpilot_elevenst_final_execution_seal_v1'
     or seal->>'permitId'<>permit.permit_id::text or seal->>'sourceId'<>permit.source_id::text
     or seal->>'requestFingerprint'<>permit.request_fingerprint
     or seal->>'finalArgumentsSha256'<>permit.final_arguments_sha256
     or seal->>'providerBodySha256'<>permit.provider_body_sha256
     or seal->>'credentialId'<>permit.credential_id::text
     or (seal->>'credentialVersion')::integer<>permit.credential_version
     or seal->>'credentialFingerprint'<>permit.credential_fingerprint
     or seal->>'vaultSecretId'<>permit.vault_secret_id::text
     or seal->>'apiKeySha256'<>permit.api_key_sha256
     or pg_catalog.encode(extensions.digest(
       ((job.request_payload#>'arguments')-'sellerpilotElevenstFinalExecutionSeal')::text,
       'sha256'),'hex')<>permit.final_arguments_sha256
     or p_observation->>'sellerProductCode'<>seller_code
     or p_observation#>>'{credentialEvidence,credentialId}'<>credential.id::text
     or (p_observation#>>'{credentialEvidence,credentialVersion}')::integer<>credential.version
     or p_observation#>>'{credentialEvidence,credentialFingerprint}'<>credential.fingerprint
     or p_observation#>>'{credentialEvidence,vaultSecretId}'<>credential.vault_secret_id::text
     or p_observation#>>'{credentialEvidence,apiKeySha256}'<>permit.api_key_sha256
     or p_observation#>>'{authoritativeSnapshot,categoryId}'<>
       job.request_payload#>>'{arguments,product,dispCtgrNo}'
     or (p_observation#>>'{authoritativeSnapshot,priceKrw}')::numeric<>
       (job.request_payload#>>'{arguments,product,selPrc}')::numeric
     or (p_observation#>>'{authoritativeSnapshot,stockQuantity}')::numeric<>
       (job.request_payload#>>'{arguments,product,prdSelQty}')::numeric
     or p_observation#>>'{authoritativeSnapshot,titleSha256}'<>pg_catalog.encode(
       extensions.digest(job.request_payload#>>'{arguments,product,prdNm}','sha256'),'hex')
     or p_observation#>>'{authoritativeSnapshot,productImagesSha256}'<>pg_catalog.encode(
       extensions.digest(pg_catalog.concat_ws(E'\n',
         job.request_payload#>>'{arguments,product,prdImage01}',
         job.request_payload#>>'{arguments,product,prdImage02}',
         job.request_payload#>>'{arguments,product,prdImage03}',
         job.request_payload#>>'{arguments,product,prdImage04}'),'sha256'),'hex')
     or p_observation#>>'{authoritativeSnapshot,detailHtmlSha256}'<>pg_catalog.encode(
       extensions.digest(job.request_payload#>>'{arguments,product,htmlDetail}','sha256'),'hex')
     or observed_at<permit.updated_at-interval '2 seconds'
     or observed_at>pg_catalog.clock_timestamp()+interval '5 seconds' then
    raise exception 'ELEVENST_CREATE_RECOVERY_CONTEXT_STALE' using errcode='40001';
  end if;
  completed:=p_observation->>'outcome'='unique'
    and p_observation->>'fullOfficialReadback'='true'
    and remote_id~'^[0-9]{1,20}$'
    and p_observation->'productMismatches'='[]'::jsonb
    and p_observation->'stockMismatches'='[]'::jsonb
    and p_observation->'providerReadbackUnavailableFields'='[]'::jsonb
    and pg_catalog.jsonb_typeof(reads)='array' and pg_catalog.jsonb_array_length(reads)=4
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(reads) with ordinality reading(value,ordinality)
       where not sellerpilot_private.elevenst_jsonb_exact_keys(reading.value,array[
         'kind','method','requestBytesSha256','responseBodySha256','responseBodyBytes',
         'httpStatus','accepted'])
         or reading.value->>'kind' is distinct from
           (array['seller-product-code','seller-product-identity','product','stock'])[reading.ordinality::integer]
         or reading.value->>'method'<>'GET' or reading.value->>'accepted'<>'true'
         or reading.value->>'httpStatus'<>'200'
         or reading.value->>'responseBodyBytes'!~'^[1-9][0-9]*$'
         or reading.value->>'responseBodySha256'!~'^[a-f0-9]{64}$'
         or reading.value->>'requestBytesSha256'<>pg_catalog.encode(extensions.digest(
           'GET'||E'\n'||case reading.ordinality
             when 1 then '/rest/prodmarketservice/sellerprodcode/'||seller_code
             when 2 then '/rest/prodmarketservice/prodmarket/'||remote_id
             when 3 then '/rest/prodmarketservice/prodmarket/'||remote_id
             when 4 then '/rest/prodmarketservice/prodmarket/stck/'||remote_id end||E'\n',
           'sha256'),'hex')
    );
  if completed then
    update sellerpilot_private.product_listings value set
      remote_id=remote_id,status='published',last_error=null,
      published_at=coalesce(value.published_at,pg_catalog.clock_timestamp()),
      last_verified_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
     where value.id=listing.id and value.remote_id is null;
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_LISTING_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.channel_operation_attempts value set
      status='succeeded',http_status=200,remote_id=remote_id,
      safe_message='11번가 SellerPrdCd 공식 GET-only 복구 완료',
      completed_at=pg_catalog.clock_timestamp()
     where value.id=attempt.id and value.status in('running','manual_required')
       and value.remote_id is null;
    get diagnostics changed_rows=row_count;
    if changed_rows<>1 then raise exception 'ELEVENST_CREATE_RECOVERY_ATTEMPT_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.channel_gateway_jobs value set
      status='succeeded',response_payload=pg_catalog.jsonb_build_object(
        'ok',true,'channel','elevenst','operation','listing.create','remoteId',remote_id,
        'recovery',p_observation),error_message=null,completed_at=pg_catalog.clock_timestamp(),
      lease_expires_at=null,worker_token_id=null,claim_token=null,updated_at=pg_catalog.clock_timestamp()
     where value.id=job.id and value.status='reconciliation_required';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_JOB_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      status='completed',recovery_observation=p_observation,recovery_claim_token=null,
      recovery_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id and value.status='reconciliation_required';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_PERMIT_MISMATCH' using errcode='40001'; end if;
  else
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      recovery_observation=p_observation,recovery_claim_token=null,
      recovery_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id and value.status='reconciliation_required';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_PERMIT_MISMATCH' using errcode='40001'; end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'status',case when completed then 'completed' else 'reconciliation_required' end,
    'jobId',job.id,'remoteId',case when completed then remote_id else null end,
    'automaticRetryAllowed',false,'providerMutationPerformed',false);
exception when no_data_found or invalid_text_representation then
  raise exception 'ELEVENST_CREATE_RECOVERY_CLAIM_STALE' using errcode='40001';
end;
$$;

revoke all on function public.sellerpilot_service_elevenst_new_product_source_readback(
  uuid,uuid,uuid,text,text),
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid,uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_elevenst_new_product_source_readback(
  uuid,uuid,uuid,text,text),
  public.sellerpilot_service_approve_elevenst_new_product_source(
    uuid,uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)
  to service_role;

commit;
