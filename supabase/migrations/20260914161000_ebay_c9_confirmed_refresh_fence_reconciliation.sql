-- Resolve only c9d's obsolete refresh fence using the already stored v211
-- GetUser/refresh evidence. Its inquiry remains reconciliation_required.
-- No provider request, credential rotation, queue change, or claim exception.
begin;
create function public.sellerpilot_service_reconcile_ebay_c9_confirmed_refresh()
returns jsonb
language plpgsql security definer set search_path=''
as $body$
declare
  incident sellerpilot_private.channel_gateway_jobs%rowtype;
  source sellerpilot_private.channel_credentials%rowtype;
  successor sellerpilot_private.channel_credentials%rowtype;
  proof sellerpilot_private.credential_audit%rowtype;
  reconciliation sellerpilot_private.credential_audit%rowtype;
  before_row jsonb;
  after_row jsonb;
  original_payload jsonb;
  current_payload jsonb;
  before_sha text;
  after_sha text;
  verified_at timestamptz;
  changed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sellerpilot:ebay:production'));
  select * into incident from sellerpilot_private.channel_gateway_jobs
    where id='c9d6431c-5418-4649-9542-f30137309bf4' for update;
  select * into source from sellerpilot_private.channel_credentials
    where id='2ba31905-9879-44c4-88be-2204776fa303' for share;
  select * into successor from sellerpilot_private.channel_credentials
    where id='0aca8183-7440-4076-ba0f-679c20259a81' for share;
  select * into proof from sellerpilot_private.credential_audit
    where id=586 and credential_id=successor.id and channel='ebay' and environment='production'
      and action='token_refreshed'
      and safe_detail->>'source'='v210_confirmed_access_store_v1'
      and safe_detail->>'sourceCredentialId'=source.id::text
      and safe_detail->>'preservedIncidentJobId'=incident.id::text
      and safe_detail->'sameSellerGetUserVerified'='true'::jsonb
      and safe_detail->'sameRefreshTokenAndScope'='true'::jsonb;
  if incident.id is null or source.id is null or successor.id is null or proof.id is null then
    raise exception 'EBAY_C9_CONFIRMED_REPLACEMENT_PROOF_REQUIRED';
  end if;
  before_row := to_jsonb(incident);
  before_sha := encode(extensions.digest(before_row::text,'sha256'),'hex');
  select * into reconciliation from sellerpilot_private.credential_audit
    where credential_id=successor.id and channel='ebay' and environment='production'
      and safe_detail->>'source'='c9_confirmed_refresh_fence_superseded_v1';
  if found then
    if incident.credential_refresh_in_flight or incident.credential_refresh_started_at is not null
        or reconciliation.safe_detail->>'incidentJobId' is distinct from incident.id::text
        or reconciliation.safe_detail->>'replacementProofAuditId' is distinct from proof.id::text
        or reconciliation.safe_detail->>'beforeRowSha256' is distinct from proof.safe_detail->>'incidentRowSha256'
        or reconciliation.safe_detail->>'afterRowSha256' is distinct from before_sha then
      raise exception 'EBAY_C9_RECONCILIATION_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('contract','ebay-c9-refresh-fence-reconciliation/1',
      'incidentJobId',incident.id,'credentialId',successor.id,'replayed',true,
      'inquiryStatus',incident.status,'providerCalls',0,'auditId',reconciliation.id);
  end if;
  if before_sha is distinct from proof.safe_detail->>'incidentRowSha256'
      or incident.channel <> 'ebay' or incident.environment <> 'production'
      or incident.operation <> 'inquiries.list' or incident.status <> 'reconciliation_required'
      or incident.error_message is distinct from 'CS_PROVIDER_RESULT_REQUIRES_RECONCILIATION'
      or incident.credential_id is distinct from source.id
      or incident.created_by is distinct from source.created_by
      or incident.seller_account_key is distinct from source.seller_account_key
      or not incident.credential_refresh_in_flight or incident.credential_refresh_started_at is null
      or incident.claim_token is not null or incident.lease_expires_at is not null
      or incident.completed_at is null or incident.completed_at>clock_timestamp()
      or incident.provider_mutation_started_at is not null
      or incident.prepared_credential_id is not null or incident.credential_refresh_fingerprint is not null
      or incident.credential_refresh_prepared_at is not null
      or incident.credential_refresh_recovery_vault_id is not null
      or incident.credential_refresh_recovery_fingerprint is not null
      or incident.credential_refresh_recovery_staged_at is not null
      or incident.oauth_exchange_completed then
    raise exception 'EBAY_C9_INCIDENT_PREIMAGE_CHANGED';
  end if;
  if source.version<>210 or source.status<>'revoked' or successor.version<>211
      or successor.status<>'active' or source.channel<>'ebay' or successor.channel<>source.channel
      or source.environment<>'production' or successor.environment<>source.environment
      or source.created_by is distinct from '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
      or successor.created_by is distinct from source.created_by
      or source.seller_account_key is null or successor.seller_account_key is distinct from source.seller_account_key
      or source.seller_account_key_source<>'provider_certified_v1'
      or successor.seller_account_key_source<>'provider_certified_v1'
      or successor.seller_account_verified_at is null or successor.last_check_status<>'passed'
      or (successor.expires_at is not null and successor.expires_at<=clock_timestamp())
      or exists(select 1 from sellerpilot_private.channel_credentials where channel='ebay' and environment='production' and version>211)
      or exists(select 1 from sellerpilot_private.channel_gateway_jobs where channel='ebay' and environment='production' and status='running') then
    raise exception 'EBAY_C9_CURRENT_CREDENTIAL_DRIFT';
  end if;
  select decrypted_secret::jsonb into original_payload from vault.decrypted_secrets where id=source.vault_secret_id;
  select decrypted_secret::jsonb into current_payload from vault.decrypted_secrets where id=successor.vault_secret_id;
  verified_at := (proof.safe_detail->>'providerVerifiedAt')::timestamptz;
  if original_payload is null or current_payload is null or verified_at is null
      or verified_at<incident.completed_at or verified_at>clock_timestamp()
      or successor.seller_account_verified_at<verified_at
      or nullif(current_payload->>'access_token_expires_at','') is null
      or (current_payload->>'access_token_expires_at')::timestamptz<=clock_timestamp()
      or encode(extensions.digest(current_payload::text,'sha256'),'hex') is distinct from proof.safe_detail->>'payloadSha256'
      or nullif(original_payload->>'provider_account_subject','') is null
      or original_payload->>'provider_account_subject' is distinct from current_payload->>'provider_account_subject'
      or nullif(original_payload->>'refresh_token','') is null
      or original_payload->>'refresh_token' is distinct from current_payload->>'refresh_token'
      or original_payload->'scopes' is distinct from current_payload->'scopes'
      or original_payload->'client_id' is distinct from current_payload->'client_id' then
    raise exception 'EBAY_C9_LIVE_SAME_SELLER_PROOF_INVALID';
  end if;
  -- CHECK requires the timestamp to be cleared with in_flight. Preserve its
  -- original value in the immutable audit below; all other row fields remain.
  update sellerpilot_private.channel_gateway_jobs
    set credential_refresh_in_flight=false,credential_refresh_started_at=null
    where id=incident.id and credential_refresh_in_flight;
  get diagnostics changed = row_count;
  select to_jsonb(j) into after_row from sellerpilot_private.channel_gateway_jobs j where id=incident.id;
  if changed<>1 or (after_row-'credential_refresh_in_flight'-'credential_refresh_started_at')
      is distinct from (before_row-'credential_refresh_in_flight'-'credential_refresh_started_at') then
    raise exception 'EBAY_C9_NON_FENCE_FIELD_CHANGED';
  end if;
  after_sha := encode(extensions.digest(after_row::text,'sha256'),'hex');
  insert into sellerpilot_private.credential_audit(credential_id,channel,environment,action,actor_user_id,safe_detail)
    values(successor.id,'ebay','production','restored',null,jsonb_build_object(
      'source','c9_confirmed_refresh_fence_superseded_v1','incidentJobId',incident.id,
      'sourceCredentialId',source.id,'replacementCredentialId',successor.id,'replacementProofAuditId',proof.id,
      'providerVerifiedAt',verified_at,'beforeRowSha256',before_sha,'afterRowSha256',after_sha,
      'priorRefreshInFlight',true,'priorRefreshStartedAt',incident.credential_refresh_started_at,
      'oldRefreshOutcome','unknown','resolution','superseded_by_verified_current_credential',
      'inquiryStatusPreserved',incident.status,'requestSha256',encode(extensions.digest(incident.request_payload::text,'sha256'),'hex'),
      'responseSha256',encode(extensions.digest(coalesce(incident.response_payload::text,'null'),'sha256'),'hex'),
      'forcedProviderCalls',0,'forcedQueuedJobs',0)) returning * into reconciliation;
  return jsonb_build_object('contract','ebay-c9-refresh-fence-reconciliation/1',
    'incidentJobId',incident.id,'credentialId',successor.id,'replayed',false,
    'inquiryStatus',incident.status,'providerCalls',0,'auditId',reconciliation.id,
    'beforeRowSha256',before_sha,'afterRowSha256',after_sha);
end;
$body$;
revoke all on function public.sellerpilot_service_reconcile_ebay_c9_confirmed_refresh() from public,anon,authenticated;
grant execute on function public.sellerpilot_service_reconcile_ebay_c9_confirmed_refresh() to service_role;
commit;
