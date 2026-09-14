-- Exact legacy placeholder correction only. No provider request is made.
-- v2/Vault/history stay intact; v3 must pass the existing pending diagnostic.
begin;
create function public.sellerpilot_service_prepare_elevenst_couplit_successor(
  p_expected_credential_sha256 text,
  p_expected_payload_sha256 text,
  p_expected_claim_sha256 text,
  p_expected_routes_sha256 text,
  p_official_seller_evidence_sha256 text,
  p_observed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $body$
declare
  old_credential sellerpilot_private.channel_credentials%rowtype;
  old_claim sellerpilot_private.elevenst_credential_identity_claims%rowtype;
  before_credential jsonb; before_claim jsonb; before_routes jsonb;
  before_jobs jsonb; before_binding jsonb; after_value jsonb;
  old_payload jsonb; next_payload jsonb; read_payload jsonb;
  new_id uuid := gen_random_uuid(); new_vault_id uuid; new_key text;
  v_fingerprint text; seller_digest text; audit_id bigint;
begin
  if p_expected_credential_sha256 is null or p_expected_payload_sha256 is null
    or p_expected_claim_sha256 is null or p_expected_routes_sha256 is null
    or p_official_seller_evidence_sha256 is null
    or exists(select 1 from unnest(array[p_expected_credential_sha256,p_expected_payload_sha256,
      p_expected_claim_sha256,p_expected_routes_sha256,p_official_seller_evidence_sha256]) h
      where h !~ '^[a-f0-9]{64}$')
    or p_observed_at is null or p_observed_at > clock_timestamp()
    or p_observed_at < clock_timestamp()-interval '4 hours' then
    raise exception 'ELEVENST_PLACEHOLDER_EXACT_EVIDENCE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(193674993,821065042);
  perform pg_advisory_xact_lock(hashtext('sellerpilot:elevenst:production'));
  select * into old_credential from sellerpilot_private.channel_credentials
    where id='b2dd0ff7-4420-495f-aead-a45857fb3bfe' for update;
  select * into old_claim from sellerpilot_private.elevenst_credential_identity_claims
    where credential_id=old_credential.id for update;
  if old_credential.id is null or old_credential.channel<>'elevenst'
    or old_credential.environment<>'production' or old_credential.version<>2
    or old_credential.status<>'active'
    or old_credential.created_by<>'768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'
    or old_credential.seller_account_key_source<>'credential_incarnation_v1'
    or old_credential.seller_account_key !~ '^[a-f0-9]{64}$'
    or old_credential.seller_account_verified_at is null
    or old_credential.last_check_status is distinct from 'passed'
    or (old_credential.expires_at is not null and old_credential.expires_at<=clock_timestamp())
    or old_claim.credential_id is null or old_claim.lifecycle_state<>'active'
    or old_claim.created_by is distinct from old_credential.created_by
    or old_claim.environment<>'production'
    or old_claim.seller_account_key is distinct from old_credential.seller_account_key
    or exists(select 1 from sellerpilot_private.channel_credentials where channel='elevenst'
      and environment='production' and version>=3) then
    raise exception 'ELEVENST_PLACEHOLDER_SOURCE_CHANGED';
  end if;
  before_credential:=to_jsonb(old_credential); before_claim:=to_jsonb(old_claim);
  select decrypted_secret::jsonb into strict old_payload from vault.decrypted_secrets
    where id=old_credential.vault_secret_id;
  if encode(extensions.digest(before_credential::text,'sha256'),'hex')<>p_expected_credential_sha256
    or encode(extensions.digest(before_claim::text,'sha256'),'hex')<>p_expected_claim_sha256
    or encode(extensions.digest(old_payload::text,'sha256'),'hex')<>p_expected_payload_sha256
    or old_payload->>'seller_id' is distinct from 'sample'
    or coalesce(old_payload->>'api_key','') !~ '^[A-Za-z0-9]{32}$'
    or old_claim.seller_id_digest is distinct from sellerpilot_private.elevenst_seller_id_digest(old_credential.vault_secret_id) then
    raise exception 'ELEVENST_PLACEHOLDER_PREIMAGE_CHANGED';
  end if;
  seller_digest:=encode(extensions.digest(convert_to('elevenst'||chr(31)||'couplit','UTF8'),'sha256'),'hex');
  if exists(select 1 from sellerpilot_private.elevenst_credential_identity_claims
      where environment='production' and lifecycle_state in('pending','active') and seller_id_digest=seller_digest)
    or exists(select 1 from sellerpilot_private.channel_gateway_jobs where credential_id=old_credential.id
      and (status='running' or claim_token is not null or credential_refresh_in_flight
        or credential_refresh_recovery_vault_id is not null or prepared_credential_id is not null
        or (status='queued' and operation in('listing.create','listing.update','listing.stop'))))
    or exists(select 1 from sellerpilot_private.elevenst_new_product_server_sources where credential_id=old_credential.id)
    or exists(select 1 from sellerpilot_private.elevenst_new_product_source_approvals where credential_id=old_credential.id)
    or exists(select 1 from sellerpilot_private.channel_catalog_items where credential_id=old_credential.id and present) then
    raise exception 'ELEVENST_PLACEHOLDER_DEPENDENT_WORK_REQUIRES_REVIEW';
  end if;
  perform 1 from sellerpilot_private.local_channel_executor_routes where credential_id=old_credential.id for update;
  select jsonb_agg(to_jsonb(r) order by id) into before_routes
    from sellerpilot_private.local_channel_executor_routes r where credential_id=old_credential.id;
  if jsonb_array_length(coalesce(before_routes,'[]'))<>7
    or encode(extensions.digest(before_routes::text,'sha256'),'hex')<>p_expected_routes_sha256
    or exists(select 1 from sellerpilot_private.local_channel_executor_routes r where credential_id=old_credential.id
      and (not enabled or expires_at<=clock_timestamp() or channel<>'elevenst'
        or seller_account_key is distinct from old_credential.seller_account_key
        or id not in('a81a3f1d-b697-4372-b7d2-952565fe136c','805c4101-14fb-47ca-b7f3-6a1eec5183d7',
          '3ced3218-2746-4932-a385-9d2875788b9f','bd18a58d-52cf-4d97-8bc7-6457e468d8f2',
          '5dca216d-e5c3-4780-b6cf-a214565da64f','b6e62dd7-7573-40e3-bc90-1bec93fbdaa1',
          '35e2888e-9798-4f03-968e-783aaaf798f5'))) then
    raise exception 'ELEVENST_PLACEHOLDER_ROUTES_CHANGED';
  end if;
  perform 1 from sellerpilot_private.cs_credential_capability_bindings where credential_id=old_credential.id for update;
  select jsonb_agg(to_jsonb(b) order by id) into before_binding
    from sellerpilot_private.cs_credential_capability_bindings b where credential_id=old_credential.id;
  if (select count(*) from sellerpilot_private.cs_credential_capability_bindings
      where credential_id=old_credential.id and status='active')<>1
    or not exists(select 1 from sellerpilot_private.cs_credential_capability_bindings
      where id='dd1970ca-ca6d-4b60-814e-7ce066aff4eb' and credential_id=old_credential.id and status='active') then
    raise exception 'ELEVENST_PLACEHOLDER_CS_BINDING_CHANGED';
  end if;
  select coalesce(jsonb_agg(to_jsonb(j) order by id),'[]') into before_jobs
    from sellerpilot_private.channel_gateway_jobs j where credential_id=old_credential.id;
  next_payload:=old_payload||jsonb_build_object('seller_id','couplit');
  if (next_payload-'seller_id') is distinct from (old_payload-'seller_id') then
    raise exception 'ELEVENST_PLACEHOLDER_API_KEY_CHANGED';
  end if;
  -- Same canonical algorithm as the existing exact rotation RPC.
  v_fingerprint:=upper(substr(encode(extensions.digest(next_payload::text,'sha256'),'hex'),1,12));
  select vault.create_secret(next_payload::text,
    format('sellerpilot_elevenst_production_v3_%s',new_id),
    'Exact administrator-observed seller metadata correction; API key unchanged.') into new_vault_id;
  update sellerpilot_private.channel_credentials set status='revoked',grace_ends_at=clock_timestamp()
    where id=old_credential.id;
  -- The installed status trigger revokes the old claim and CS capability.
  perform set_config('sellerpilot.elevenst_credential_rotation_source',old_credential.id::text,true);
  insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
    rotation_interval_days,warning_days,last_rotated_at,created_by
  ) values(new_id,'elevenst','production',3,new_vault_id,v_fingerprint,'pending',old_credential.expires_at,
    old_credential.rotation_interval_days,old_credential.warning_days,clock_timestamp(),old_credential.created_by)
    returning seller_account_key into new_key;
  perform set_config('sellerpilot.elevenst_credential_rotation_source','',true);
  if new_key is distinct from old_credential.seller_account_key then
    raise exception 'ELEVENST_PLACEHOLDER_LINEAGE_CHANGED';
  end if;
  insert into sellerpilot_private.elevenst_credential_identity_claims(
    credential_id,environment,seller_id_digest,seller_account_key,lifecycle_state,created_by
  ) values(new_id,'production',seller_digest,new_key,'pending',old_credential.created_by);
  update sellerpilot_private.local_channel_executor_routes set credential_id=new_id where credential_id=old_credential.id;

  select to_jsonb(c) into after_value from sellerpilot_private.channel_credentials c where id=old_credential.id;
  if (after_value-array['status','grace_ends_at']) is distinct from (before_credential-array['status','grace_ends_at'])
    or (select to_jsonb(c)-'lifecycle_state' from sellerpilot_private.elevenst_credential_identity_claims c where credential_id=old_credential.id)
      is distinct from (before_claim-'lifecycle_state')
    or (select coalesce(jsonb_agg(to_jsonb(j) order by id),'[]') from sellerpilot_private.channel_gateway_jobs j where credential_id=old_credential.id)
      is distinct from before_jobs
    or (select jsonb_agg(to_jsonb(r)||jsonb_build_object('credential_id',old_credential.id) order by id)
      from sellerpilot_private.local_channel_executor_routes r where credential_id=new_id) is distinct from before_routes
    or exists(select 1 from sellerpilot_private.cs_credential_capability_bindings where credential_id=new_id)
    or (select jsonb_agg(to_jsonb(b)-array['status','updated_at'] order by id)
      from sellerpilot_private.cs_credential_capability_bindings b where credential_id=old_credential.id)
      is distinct from (select jsonb_agg(v-array['status','updated_at'] order by v->>'id') from jsonb_array_elements(before_binding) v)
    or exists(select 1 from sellerpilot_private.cs_credential_capability_bindings where credential_id=old_credential.id and status='active') then
    raise exception 'ELEVENST_PLACEHOLDER_UNEXPECTED_SIDE_EFFECT';
  end if;
  select decrypted_secret::jsonb into strict read_payload from vault.decrypted_secrets where id=new_vault_id;
  if read_payload is distinct from next_payload
    or (select decrypted_secret::jsonb from vault.decrypted_secrets where id=old_credential.vault_secret_id) is distinct from old_payload
    or not exists(select 1 from sellerpilot_private.channel_credentials where id=new_id and version=3 and status='pending'
      and created_by=old_credential.created_by and last_check_status is null and last_checked_at is null
      and fingerprint=upper(substr(encode(extensions.digest(read_payload::text,'sha256'),'hex'),1,12))) then
    raise exception 'ELEVENST_PLACEHOLDER_VAULT_OR_VERIFICATION_CHANGED';
  end if;
  insert into sellerpilot_private.credential_audit(credential_id,channel,environment,action,actor_user_id,safe_detail)
  values(new_id,'elevenst','production','rotated',old_credential.created_by,jsonb_build_object(
    'source','elevenst_sample_to_couplit_pending_successor_v1','previousCredentialId',old_credential.id,
    'previousVersion',2,'version',3,'previousCredential',before_credential,'previousIdentityClaim',before_claim,
    'previousCredentialSha256',p_expected_credential_sha256,'previousPayloadSha256',p_expected_payload_sha256,
    'nextPayloadSha256',encode(extensions.digest(read_payload::text,'sha256'),'hex'),
    'previousRoutesSha256',p_expected_routes_sha256,'preservedJobsSha256',encode(extensions.digest(before_jobs::text,'sha256'),'hex'),
    'officialSellerEvidenceSha256',p_official_seller_evidence_sha256,'officialSellerObservedAt',p_observed_at,
    'apiKeyUnchanged',true,'identityEvidence','admin_claim_v1','status','pending',
    'requiresFreshDiagnostic',true,'oldActiveCsBindingsRevoked',1,'copiedCsBindings',0,
    'inheritedRoutes',7,'forcedProviderCalls',0,'enqueuedJobs',0)) returning id into audit_id;
  return jsonb_build_object('credentialId',new_id,'version',3,'status','pending','auditId',audit_id,
    'oldCredentialId',old_credential.id,'oldStatus','revoked','inheritedRoutes',7,
    'requiresFreshDiagnostic',true,'oldActiveCsBindingsRevoked',1);
end;
$body$;
revoke all on function public.sellerpilot_service_prepare_elevenst_couplit_successor(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_prepare_elevenst_couplit_successor(text,text,text,text,text,timestamptz) to service_role;
commit;
