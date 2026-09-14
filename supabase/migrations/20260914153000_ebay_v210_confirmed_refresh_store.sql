-- One reviewed incident: persist a new, provider-confirmed access token for
-- v210 after c9d's credential STORE timed out. eBay permits reusing a valid
-- refresh token: https://developer.ebay.com/develop/guides/sell/authorization
-- This does NOT resolve the old inquiry, clear its refresh fence, enqueue work,
-- change claim predicates, or grant/renew any local route.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid =
      'public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamptz)'::regprocedure)
      is distinct from 'c1fb7e1a17930e6d6b5ed390ae3cf6ca' then
    raise exception 'EBAY_V210_REFRESH_PREIMAGE_DRIFT';
  end if;
  if to_regprocedure('public.sellerpilot_service_store_ebay_v210_confirmed_refresh(uuid,jsonb,timestamptz)') is not null then
    raise exception 'EBAY_V210_REFRESH_ALREADY_DEFINED';
  end if;
end;
$guard$;

create function public.sellerpilot_service_store_ebay_v210_confirmed_refresh(
  p_source_credential_id uuid, p_secret_payload jsonb, p_provider_verified_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = '' set statement_timeout = '25s' as $body$
declare
  source sellerpilot_private.channel_credentials%rowtype;
  incident sellerpilot_private.channel_gateway_jobs%rowtype;
  successor sellerpilot_private.channel_credentials%rowtype;
  old_payload jsonb;
  stored_payload jsonb;
  incident_before jsonb;
  existing_audit record;
  new_id uuid;
  payload_digest text;
  incident_digest text;
  rebound_ids uuid[];
  rebound_count integer;
  old_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sellerpilot:ebay:production'));
  if p_source_credential_id is distinct from '2ba31905-9879-44c4-88be-2204776fa303'::uuid then
    raise exception 'EBAY_V210_REFRESH_SOURCE_DRIFT';
  end if;
  select * into source from sellerpilot_private.channel_credentials
    where id = p_source_credential_id for update;
  if source.id is null or source.version <> 210
      or source.channel <> 'ebay' or source.environment <> 'production'
      or source.created_by is distinct from '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
      or source.seller_account_key is null or source.seller_account_key_source <> 'provider_certified_v1'
      or source.seller_account_verified_at is null then
    raise exception 'EBAY_V210_REFRESH_SOURCE_DRIFT';
  end if;
  select * into incident from sellerpilot_private.channel_gateway_jobs
    where id = 'c9d6431c-5418-4649-9542-f30137309bf4' for update;
  if incident.id is null or incident.credential_id is distinct from source.id
      or incident.created_by is distinct from source.created_by
      or incident.seller_account_key is distinct from source.seller_account_key
      or incident.channel <> 'ebay' or incident.environment <> 'production'
      or incident.operation <> 'inquiries.list' or incident.status <> 'reconciliation_required'
      or incident.error_message is distinct from 'CS_PROVIDER_RESULT_REQUIRES_RECONCILIATION'
      or not incident.credential_refresh_in_flight
      or incident.credential_refresh_started_at is distinct from '2026-09-14T01:56:42.694693Z'::timestamptz
      or incident.provider_mutation_started_at is not null
      or incident.prepared_credential_id is not null or incident.credential_refresh_fingerprint is not null
      or incident.credential_refresh_prepared_at is not null
      or incident.credential_refresh_recovery_vault_id is not null
      or incident.credential_refresh_recovery_fingerprint is not null
      or incident.credential_refresh_recovery_staged_at is not null
      or incident.claim_token is not null or incident.lease_expires_at is not null
      or incident.started_at is distinct from '2026-09-14T01:56:41.468146Z'::timestamptz
      or incident.completed_at is distinct from '2026-09-14T02:06:52.436412Z'::timestamptz
      or md5(incident.request_payload::text) <> '10bb6baa8897c779e1ad67dfad50bfe8' then
    raise exception 'EBAY_V210_REFRESH_INCIDENT_DRIFT';
  end if;
  incident_before := to_jsonb(incident);
  incident_digest := encode(extensions.digest(incident_before::text, 'sha256'), 'hex');
  select decrypted_secret::jsonb into old_payload from vault.decrypted_secrets
    where id = source.vault_secret_id;
  -- The trusted operator obtains GetUser/EIAS before calling this service-only
  -- RPC. Display-name changes are allowed; application, refresh token, scopes,
  -- EIAS identity and every other stored field must remain exactly unchanged.
  if old_payload is null or jsonb_typeof(p_secret_payload) is distinct from 'object'
      or octet_length(p_secret_payload::text) > 32000
      or p_provider_verified_at is null
      or p_provider_verified_at < clock_timestamp() - interval '10 minutes'
      or p_provider_verified_at > clock_timestamp() + interval '30 seconds'
      or (p_secret_payload - array['access_token','access_token_expires_at','ebay_user_id'])
         is distinct from (old_payload - array['access_token','access_token_expires_at','ebay_user_id'])
      or p_secret_payload->>'provider_account_identity_version' is distinct from 'v1'
      or coalesce(p_secret_payload->>'provider_account_subject', '') not like 'ebay:eias:%'
      or jsonb_typeof(p_secret_payload->'access_token') is distinct from 'string'
      or length(coalesce(p_secret_payload->>'access_token','')) < 8
      or p_secret_payload->>'access_token' is not distinct from old_payload->>'access_token'
      or jsonb_typeof(p_secret_payload->'ebay_user_id') is distinct from 'string'
      or nullif(btrim(p_secret_payload->>'ebay_user_id'), '') is null
      or nullif(p_secret_payload->>'access_token_expires_at','') is null
      or (p_secret_payload->>'access_token_expires_at')::timestamptz <= clock_timestamp() + interval '2 minutes'
      or (p_secret_payload->>'access_token_expires_at')::timestamptz > clock_timestamp() + interval '3 hours'
      or nullif(p_secret_payload->>'refresh_token_expires_at','') is null
      or (p_secret_payload->>'refresh_token_expires_at')::timestamptz <= clock_timestamp() then
    raise exception 'EBAY_V210_REFRESH_PROVIDER_PROOF_INVALID';
  end if;
  payload_digest := encode(extensions.digest(p_secret_payload::text, 'sha256'), 'hex');

  -- A lost STORE response may be replayed only with the exact same payload and
  -- original proof timestamp. No new Vault write, queued-job update or refresh.
  select credential_id, safe_detail into existing_audit
    from sellerpilot_private.credential_audit
    where channel='ebay' and environment='production'
      and safe_detail->>'source'='v210_confirmed_access_store_v1'
      and safe_detail->>'sourceCredentialId'=source.id::text;
  if found then
    select * into successor from sellerpilot_private.channel_credentials
      where id=existing_audit.credential_id;
    select decrypted_secret::jsonb into stored_payload from vault.decrypted_secrets
      where id=successor.vault_secret_id;
    if source.status <> 'revoked' or successor.version <> 211 or successor.status <> 'active'
        or successor.channel <> 'ebay' or successor.environment <> 'production'
        or successor.created_by is distinct from source.created_by
        or successor.seller_account_key is distinct from source.seller_account_key
        or successor.seller_account_key_source <> 'provider_certified_v1'
        or successor.seller_account_verified_at is null
        or stored_payload is distinct from p_secret_payload
        or existing_audit.safe_detail->>'payloadSha256' is distinct from payload_digest
        or (existing_audit.safe_detail->>'providerVerifiedAt')::timestamptz is distinct from p_provider_verified_at
        or existing_audit.safe_detail->>'incidentRowSha256' is distinct from incident_digest then
      raise exception 'EBAY_V210_REFRESH_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('credentialId',successor.id,'version',211,'sourceCredentialId',source.id,
      'preservedIncidentJobId',incident.id,'incidentPreserved',true,'replayed',true,
      'automaticQueuedCredentialRebinds',(existing_audit.safe_detail->>'automaticQueuedCredentialRebinds')::integer,
      'inheritedLocalRoutes',0,'forcedProviderJobsStarted',0);
  end if;
  if source.status <> 'active'
      or exists(select 1 from sellerpilot_private.channel_credentials where channel='ebay' and environment='production' and version>210)
      or exists(select 1 from sellerpilot_private.channel_gateway_jobs where channel='ebay' and environment='production' and status='running')
      or exists(select 1 from sellerpilot_private.local_channel_executor_routes where credential_id=source.id) then
    raise exception 'EBAY_V210_REFRESH_SOURCE_DRIFT';
  end if;
  -- Preserve the underlying routine's existing automatic retarget contract.
  -- Attempt-bound and uncertain jobs are excluded. This does not claim them.
  select coalesce(array_agg(id),array[]::uuid[]) into rebound_ids
    from sellerpilot_private.channel_gateway_jobs
    where credential_id=source.id and status='queued' and attempt_id is null;
  rebound_count := cardinality(rebound_ids);
  perform set_config('request.jwt.claim.role','service_role',true);
  new_id := public.sellerpilot_service_refresh_ebay(source.id,p_secret_payload,
    (p_secret_payload->>'refresh_token_expires_at')::timestamptz);
  perform set_config('request.jwt.claim.role',old_role,true);
  select * into successor from sellerpilot_private.channel_credentials where id=new_id;
  if successor.id is null or successor.status <> 'active' or successor.version <> 211
      or successor.created_by is distinct from source.created_by
      or successor.seller_account_key is distinct from source.seller_account_key
      or successor.seller_account_key_source <> 'provider_certified_v1'
      or successor.seller_account_verified_at is null
      or (select to_jsonb(j) from sellerpilot_private.channel_gateway_jobs j where id=incident.id) is distinct from incident_before
      or exists(select 1 from sellerpilot_private.channel_gateway_jobs where id=any(rebound_ids) and (credential_id<>new_id or status<>'queued' or attempt_id is not null)) then
    raise exception 'EBAY_V210_REFRESH_READBACK_FAILED';
  end if;
  insert into sellerpilot_private.credential_audit(credential_id,channel,environment,action,actor_user_id,safe_detail)
    values(new_id,'ebay','production','token_refreshed',null,jsonb_build_object(
      'source','v210_confirmed_access_store_v1','sourceCredentialId',source.id,
      'preservedIncidentJobId',incident.id,'incidentRowSha256',incident_digest,
      'payloadSha256',payload_digest,'providerVerifiedAt',p_provider_verified_at,
      'sameSellerGetUserVerified',true,'sameRefreshTokenAndScope',true,
      'automaticQueuedCredentialRebinds',rebound_count,'inheritedLocalRoutes',0,'forcedProviderJobsStarted',0));
  return jsonb_build_object('credentialId',new_id,'version',211,'sourceCredentialId',source.id,
    'preservedIncidentJobId',incident.id,'incidentPreserved',true,'replayed',false,
    'automaticQueuedCredentialRebinds',rebound_count,'inheritedLocalRoutes',0,'forcedProviderJobsStarted',0);
end;
$body$;
revoke all on function public.sellerpilot_service_store_ebay_v210_confirmed_refresh(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_store_ebay_v210_confirmed_refresh(uuid,jsonb,timestamptz) to service_role;
commit;
