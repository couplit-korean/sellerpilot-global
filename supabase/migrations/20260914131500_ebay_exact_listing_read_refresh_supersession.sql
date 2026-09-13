-- One incident, not a reusable recovery endpoint: confirmed refresh of v209
-- replaces only old42f's credential uncertainty. Its inquiry outcome remains
-- reconciliation_required. Existing claim and refresh functions are unchanged.
-- Same refresh token may be reused while valid; no new OAuth consent/scope:
-- https://developer.ebay.com/develop/guides/sell/authorization
-- Existing scheduler resumes normally; this migration enqueues/claims nothing.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)'::regprocedure)
       is distinct from 'c1fb7e1a17930e6d6b5ed390ae3cf6ca'
     or (select md5(prosrc) from pg_proc where oid='public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure)
       is distinct from '805c08c3a73270392247723a31a30015' then
    raise exception 'EBAY_EXACT_READ_REFRESH_PREIMAGE_DRIFT';
  end if;
  if exists(select 1 from pg_proc where proname='sellerpilot_service_store_ebay_exact_listing_refresh') then
    raise exception 'EBAY_EXACT_READ_REFRESH_ALREADY_DEFINED'; end if;
end;
$guard$;

create function public.sellerpilot_service_store_ebay_exact_listing_refresh(
  p_source_credential_id uuid, p_secret_payload jsonb, p_provider_verified_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $body$
declare
  source sellerpilot_private.channel_credentials%rowtype;
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  old_payload jsonb;
  new_id uuid;
  old_role text := coalesce(current_setting('request.jwt.claim.role',true),'');
  n integer;
  rebound_count integer;
begin
  -- Service-role ACL is the same trusted transport used by existing prepare.
  -- Never accept an operator-entered seller ID as GetUser identity evidence.
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sellerpilot:ebay:production'));
  if p_source_credential_id is distinct from '8e43e9e0-2674-41a2-8a62-905afad415c0'::uuid then
    raise exception 'EBAY_EXACT_READ_REFRESH_SOURCE_DRIFT'; end if;
  select * into source from sellerpilot_private.channel_credentials where id=p_source_credential_id for update;
  if source.id is null or source.version <> 209 or source.status <> 'active'
     or source.channel <> 'ebay' or source.environment <> 'production'
     or source.created_by is distinct from '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     or source.seller_account_key is null or source.seller_account_key_source <> 'provider_certified_v1'
     or source.seller_account_verified_at is null
     or exists(select 1 from sellerpilot_private.channel_credentials where channel='ebay' and environment='production' and version>209)
     or exists(select 1 from sellerpilot_private.channel_gateway_jobs where channel='ebay' and environment='production' and status='running')
  then raise exception 'EBAY_EXACT_READ_REFRESH_SOURCE_DRIFT'; end if;
  select * into j from sellerpilot_private.channel_gateway_jobs
   where id='42f87fd2-8583-47c1-85f0-7e3ff436ad4a' for update;
  if j.id is null or j.status <> 'reconciliation_required' or not j.credential_refresh_in_flight
     or j.credential_id is distinct from source.id or j.created_by is distinct from source.created_by
     or j.seller_account_key is distinct from source.seller_account_key
     or j.channel <> 'ebay' or j.environment <> 'production' or j.operation <> 'inquiries.list'
     or j.provider_mutation_started_at is not null or j.prepared_credential_id is not null
     or j.credential_refresh_fingerprint is not null or j.credential_refresh_recovery_vault_id is not null
     or j.claim_token is not null or j.lease_expires_at is not null
     or md5(j.request_payload::text) <> 'b38ca4ed4dc71a8742726af8cda10957'
  then raise exception 'EBAY_EXACT_READ_REFRESH_INCIDENT_DRIFT'; end if;
  perform 1 from sellerpilot_private.channel_gateway_jobs
   where id in ('d49fcf37-32b6-41f5-a822-0f9bc99b51de','1654d17e-2ef7-421d-b90f-6bf0e536e626')
     and status='queued' and credential_id=source.id and created_by=source.created_by
     and channel='ebay' and environment='production' and attempt_count=0
     and started_at is null and completed_at is null and claim_token is null and worker_token_id is null
     and provider_mutation_started_at is null and not credential_refresh_in_flight
     and credential_refresh_recovery_vault_id is null and prepared_credential_id is null
   for update;
  get diagnostics n=row_count;
  if n<>2 then raise exception 'EBAY_EXACT_READ_REFRESH_TARGET_DRIFT'; end if;
  select decrypted_secret::jsonb into old_payload from vault.decrypted_secrets where id=source.vault_secret_id;
  if old_payload is null or jsonb_typeof(p_secret_payload) is distinct from 'object'
     or p_provider_verified_at is null or p_provider_verified_at < clock_timestamp()-interval '10 minutes'
     or p_provider_verified_at > clock_timestamp()+interval '30 seconds'
     or (p_secret_payload - array['access_token','access_token_expires_at','ebay_user_id'])
        is distinct from (old_payload - array['access_token','access_token_expires_at','ebay_user_id'])
     or p_secret_payload->>'provider_account_identity_version' is distinct from 'v1'
     or nullif(p_secret_payload->>'provider_account_subject','') is null
     or length(coalesce(p_secret_payload->>'access_token',''))<8
     or p_secret_payload->>'access_token' is not distinct from old_payload->>'access_token'
     or nullif(p_secret_payload->>'access_token_expires_at','') is null
     or (p_secret_payload->>'access_token_expires_at')::timestamptz <= clock_timestamp()+interval '2 minutes'
     or (p_secret_payload->>'access_token_expires_at')::timestamptz > clock_timestamp()+interval '3 hours'
     or nullif(p_secret_payload->>'refresh_token_expires_at','') is null
     or (p_secret_payload->>'refresh_token_expires_at')::timestamptz <= clock_timestamp()
  then raise exception 'EBAY_EXACT_READ_REFRESH_PROVIDER_PROOF_INVALID'; end if;
  -- Explicit service attestation is transaction-local; the ACL above accepts
  -- only the trusted service just as the normal claim-bound prepare wrapper.
  perform set_config('request.jwt.claim.role','service_role',true);
  select count(*) into rebound_count from sellerpilot_private.channel_gateway_jobs
    where credential_id=source.id and status='queued' and attempt_id is null;
  new_id := public.sellerpilot_service_refresh_ebay(source.id,p_secret_payload,(p_secret_payload->>'refresh_token_expires_at')::timestamptz);
  perform set_config('request.jwt.claim.role',old_role,true);
  perform 1 from sellerpilot_private.channel_credentials where id=new_id and status='active' and version=210
    and seller_account_key=source.seller_account_key and seller_account_key_source='provider_certified_v1'
    and seller_account_verified_at is not null and created_by=source.created_by;
  if not found then raise exception 'EBAY_EXACT_READ_REFRESH_STORED_IDENTITY_MISMATCH'; end if;
  update sellerpilot_private.channel_operation_attempts set credential_id=new_id
    where id='cd5e52d7-2819-48ba-adab-de0e5dbfe9ed' and credential_id=source.id
      and owner_id=source.created_by and channel='ebay' and operation='categories.suggest'
      and status='running' and completed_at is null and seller_account_key=source.seller_account_key;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'EBAY_EXACT_READ_REFRESH_ATTEMPT_DRIFT'; end if;
  update sellerpilot_private.channel_gateway_jobs set credential_id=new_id,updated_at=now()
    where id='d49fcf37-32b6-41f5-a822-0f9bc99b51de' and credential_id=source.id and status='queued';
  get diagnostics n=row_count;
  if n<>1 then raise exception 'EBAY_EXACT_READ_REFRESH_TARGET_DRIFT'; end if;
  insert into sellerpilot_private.credential_audit(credential_id,channel,environment,action,actor_user_id,safe_detail)
    values(new_id,'ebay','production','token_refreshed',null,jsonb_build_object(
      'source','exact_confirmed_refresh_supersession_v1','sourceCredentialId',source.id,
      'supersededRefreshJobId','42f87fd2-8583-47c1-85f0-7e3ff436ad4a',
      'categoryJobId','d49fcf37-32b6-41f5-a822-0f9bc99b51de',
      'diagnosticJobId','1654d17e-2ef7-421d-b90f-6bf0e536e626',
      'providerGetUserVerified',true,'providerVerifiedAt',p_provider_verified_at,
      'oldInquiryOutcome','unconfirmed_preserved','otherQueuedJobs','normal_existing_refresh_rebind',
      'automaticQueuedCredentialRebinds',rebound_count,'forcedProviderJobsStarted',0));
  -- Replace only the obsolete refresh uncertainty. Preserve the inquiry
  -- status, original error, request, and timestamps as unconfirmed.
  update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=false
    where id='42f87fd2-8583-47c1-85f0-7e3ff436ad4a' and credential_id=source.id
      and status='reconciliation_required' and credential_refresh_in_flight
      and provider_mutation_started_at is null and prepared_credential_id is null
      and credential_refresh_recovery_vault_id is null;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'EBAY_EXACT_READ_REFRESH_SUPERSESSION_DRIFT'; end if;
  insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
    values(source.created_by,'ebay_confirmed_refresh_supersession','channel_gateway_job',
      '42f87fd2-8583-47c1-85f0-7e3ff436ad4a',jsonb_build_object(
        'sourceCredentialId',source.id,'confirmedCredentialId',new_id,
        'providerVerifiedAt',p_provider_verified_at,'sameSellerVerified',true,
        'sameRefreshTokenAndScope',true,'credentialOnlySupersession',true,
        'inquiryOutcome','unconfirmed_preserved','providerMutationStarted',false,
        'forcedProviderJobsStarted',0));
  perform 1 from sellerpilot_private.channel_gateway_jobs cat
    join sellerpilot_private.channel_operation_attempts a on a.id=cat.attempt_id
    where cat.id='d49fcf37-32b6-41f5-a822-0f9bc99b51de' and cat.credential_id=new_id
      and cat.status='queued' and cat.operation='categories.suggest'
      and cat.attempt_id='cd5e52d7-2819-48ba-adab-de0e5dbfe9ed'
      and md5(cat.request_payload::text)='da030658def38a3c2939366c1eebafa5'
      and cat.seller_account_key=source.seller_account_key and a.credential_id=new_id
      and a.owner_id=source.created_by and a.seller_account_key=source.seller_account_key;
  if not found then raise exception 'EBAY_EXACT_READ_REFRESH_READBACK_FAILED'; end if;
  perform 1 from sellerpilot_private.channel_gateway_jobs
    where id='1654d17e-2ef7-421d-b90f-6bf0e536e626' and credential_id=new_id
      and status='queued' and operation='diagnostic.test' and attempt_id is null
      and seller_account_key=source.seller_account_key
      and md5(request_payload::text)='99914b932bd37a50b983c5e7c90ae93b';
  if not found then raise exception 'EBAY_EXACT_READ_REFRESH_READBACK_FAILED'; end if;
  return jsonb_build_object('credentialId',new_id,'version',210,
    'categoryJobId','d49fcf37-32b6-41f5-a822-0f9bc99b51de',
    'diagnosticJobId','1654d17e-2ef7-421d-b90f-6bf0e536e626',
    'supersededRefreshJobId','42f87fd2-8583-47c1-85f0-7e3ff436ad4a',
    'automaticQueuedCredentialRebinds',rebound_count,'forcedProviderJobsStarted',0);
end;
$body$;
revoke all on function public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz) to service_role;

commit;
