-- Forward-only r4 hardening for every Elevenst listing.create.
-- This migration does not enqueue or call a provider.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900703900);

do $dependencies$
begin
  if pg_catalog.to_regclass('sellerpilot_private.elevenst_new_product_execution_permits') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_bind_elevenst_new_product_execution(uuid,uuid,uuid,text,text,uuid,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)') is null then
    raise exception 'ELEVENST_R4_DEPENDENCY_MISSING';
  end if;
end;
$dependencies$;

do $one_confirmed$
begin
  if exists(
    select 1
      from sellerpilot_private.product_category_assignments assignment
     where assignment.channel='elevenst'
       and assignment.environment='production'
       and assignment.status='confirmed'
     group by assignment.owner_id,assignment.product_id,assignment.environment,assignment.market
    having count(*)>1
  ) then
    raise exception 'ELEVENST_PRODUCTION_CONFIRMED_CATEGORY_DUPLICATE';
  end if;
end;
$one_confirmed$;

create unique index product_category_assignments_one_elevenst_production_confirmed_
  on sellerpilot_private.product_category_assignments(owner_id,product_id,environment,market)
  where channel='elevenst' and environment='production' and status='confirmed';

alter table sellerpilot_private.elevenst_new_product_execution_permits
  add column final_arguments_sha256 text check(final_arguments_sha256 is null or final_arguments_sha256~'^[a-f0-9]{64}$'),
  add column provider_body_sha256 text check(provider_body_sha256 is null or provider_body_sha256~'^[a-f0-9]{64}$'),
  add column provider_body_bytes integer check(provider_body_bytes is null or provider_body_bytes>0),
  add column credential_fingerprint text check(credential_fingerprint is null or credential_fingerprint~'^[A-F0-9]{12}$'),
  add column vault_secret_id uuid,
  add column api_key_sha256 text check(api_key_sha256 is null or api_key_sha256~'^[a-f0-9]{64}$'),
  add column sealed_at timestamptz,
  add column recovery_claim_token uuid,
  add column recovery_lease_expires_at timestamptz,
  add column recovery_attempt_count integer not null default 0 check(recovery_attempt_count between 0 and 20),
  add column recovery_observation jsonb;

alter table sellerpilot_private.elevenst_new_product_execution_permits
  drop constraint if exists elevenst_new_product_execution_permits_status_check;
alter table sellerpilot_private.elevenst_new_product_execution_permits
  add constraint elevenst_new_product_execution_permits_status_check
  check(status in('bound','sealed','consumed','reconciliation_required','completed'));
do $drop_bound_constraint$
declare constraint_name text;
begin
  select value.conname into constraint_name
    from pg_catalog.pg_constraint value
   where value.conrelid='sellerpilot_private.elevenst_new_product_execution_permits'::pg_catalog.regclass
     and value.contype='c'
     and pg_catalog.pg_get_constraintdef(value.oid) like '%status = ''bound''%consumed_job_id IS NULL%';
  if constraint_name is not null then
    execute pg_catalog.format(
      'alter table sellerpilot_private.elevenst_new_product_execution_permits drop constraint %I',
      constraint_name
    );
  end if;
end;
$drop_bound_constraint$;
alter table sellerpilot_private.elevenst_new_product_execution_permits
  add constraint elevenst_new_product_execution_permits_consumption_check
  check(
    (status in('bound','sealed') and consumed_job_id is null and consumed_claim_token is null and consumed_at is null)
    or (status in('consumed','reconciliation_required','completed') and consumed_job_id is not null and consumed_claim_token is not null and consumed_at is not null)
  );

create function sellerpilot_private.elevenst_execution_source_advisory_lock(p_source_id uuid)
returns void language sql volatile set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellerpilot:elevenst:create:'||p_source_id::text,43000)
  )
$$;

revoke all on function sellerpilot_private.elevenst_execution_source_advisory_lock(uuid)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.elevenst_final_execution_seal(
  p_permit sellerpilot_private.elevenst_new_product_execution_permits
) returns jsonb language sql stable set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_final_execution_seal_v1',
    'permitId',p_permit.permit_id,
    'sourceId',p_permit.source_id,
    'requestFingerprint',p_permit.request_fingerprint,
    'finalArgumentsSha256',p_permit.final_arguments_sha256,
    'providerBodySha256',p_permit.provider_body_sha256,
    'providerBodyBytes',p_permit.provider_body_bytes,
    'credentialId',p_permit.credential_id,
    'credentialVersion',p_permit.credential_version,
    'credentialFingerprint',p_permit.credential_fingerprint,
    'vaultSecretId',p_permit.vault_secret_id,
    'apiKeySha256',p_permit.api_key_sha256,
    'sealedAt',p_permit.sealed_at
  )
$$;

revoke all on function sellerpilot_private.elevenst_final_execution_seal(
  sellerpilot_private.elevenst_new_product_execution_permits
) from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text
) rename to sellerpilot_100430_bind_elevenst_before_advisory;
revoke all on function public.sellerpilot_100430_bind_elevenst_before_advisory(
  uuid,uuid,uuid,text,text,uuid,text,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_bind_elevenst_new_product_execution(
  p_actor_id uuid,p_product_id uuid,p_credential_id uuid,p_market text,p_target_id text,
  p_source_id uuid,p_approval_payload_sha256 text,p_six_kind_digest text,p_request_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(p_source_id);
  return public.sellerpilot_100430_bind_elevenst_before_advisory(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id,p_source_id,
    p_approval_payload_sha256,p_six_kind_digest,p_request_fingerprint
  );
end;
$$;

create function public.sellerpilot_service_seal_elevenst_new_product_final_body(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_binding jsonb,
  p_final_arguments jsonb,
  p_provider_body_sha256 text,
  p_provider_body_bytes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  api_key text;
  arguments_sha text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or not sellerpilot_private.elevenst_jsonb_exact_keys(p_binding,array[
       'contract','permitId','sourceId','approvalPayloadSha256','sixKindDigest','requestFingerprint',
       'ownerId','productId','productRevision','productApprovalRevision','draftVersion','credentialId',
       'credentialVersion','assignmentId','assignmentConfirmedAt','boundAt'])
     or p_binding->>'contract'<>'sellerpilot_elevenst_new_product_execution_binding_v1'
     or pg_catalog.jsonb_typeof(p_final_arguments)<>'object'
     or p_final_arguments ? 'sellerpilotElevenstFinalExecutionSeal'
     or p_provider_body_sha256!~'^[a-f0-9]{64}$'
     or p_provider_body_bytes<1 then
    raise exception 'ELEVENST_FINAL_EXECUTION_SEAL_ACCESS_DENIED' using errcode='42501';
  end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock((p_binding->>'sourceId')::uuid);
  perform 1 from sellerpilot_private.products product
   where product.id=(p_binding->>'productId')::uuid and product.owner_id=(p_binding->>'ownerId')::uuid for update;
  select * into strict credential from sellerpilot_private.channel_credentials value
   where value.id=(p_binding->>'credentialId')::uuid and value.created_by=(p_binding->>'ownerId')::uuid
     and value.version=(p_binding->>'credentialVersion')::integer and value.channel='elevenst'
     and value.environment='production' and value.status='active' for update;
  perform 1 from sellerpilot_private.product_category_assignments assignment
   where assignment.id=(p_binding->>'assignmentId')::uuid and assignment.status='confirmed' for update;
  perform 1 from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id=(p_binding->>'ownerId')::uuid and draft.product_id=(p_binding->>'productId')::uuid
     and draft.kind='publish' and draft.version=(p_binding->>'draftVersion')::bigint for update;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id=(p_binding->>'sourceId')::uuid and source.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.source_id=(p_binding->>'sourceId')::uuid
     and approval.approval_payload_sha256=p_binding->>'approvalPayloadSha256' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_approval_requests request
   where request.source_id=(p_binding->>'sourceId')::uuid and request.status='approved' for update;
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.permit_id=(p_binding->>'permitId')::uuid and value.source_id=(p_binding->>'sourceId')::uuid
     and value.request_fingerprint=p_binding->>'requestFingerprint' for update;
  perform 1 from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id=p_attempt_id and attempt.owner_id=permit.owner_id
     and attempt.credential_id=permit.credential_id and attempt.channel='elevenst'
     and attempt.operation='listing.create' and attempt.status='running'
     and attempt.request_fingerprint=permit.request_fingerprint for update;
  if not found then raise exception 'ELEVENST_FINAL_EXECUTION_ATTEMPT_STALE' using errcode='40001'; end if;
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into api_key
    from vault.decrypted_secrets secret where secret.id=credential.vault_secret_id;
  if api_key!~'^[A-Za-z0-9]{32}$' then
    raise exception 'ELEVENST_FINAL_EXECUTION_SECRET_INVALID' using errcode='40001';
  end if;
  arguments_sha:=pg_catalog.encode(extensions.digest(p_final_arguments::text,'sha256'),'hex');
  if permit.status='sealed' then
    if permit.final_arguments_sha256=arguments_sha and permit.provider_body_sha256=p_provider_body_sha256
       and permit.provider_body_bytes=p_provider_body_bytes and permit.vault_secret_id=credential.vault_secret_id
       and permit.credential_fingerprint=credential.fingerprint
       and permit.api_key_sha256=pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex') then
      return sellerpilot_private.elevenst_final_execution_seal(permit);
    end if;
    raise exception 'ELEVENST_FINAL_EXECUTION_SEAL_REPLAY_DRIFT' using errcode='40001';
  end if;
  if permit.status<>'bound' then raise exception 'ELEVENST_FINAL_EXECUTION_PERMIT_NOT_BOUND' using errcode='40001'; end if;
  update sellerpilot_private.elevenst_new_product_execution_permits value set
    status='sealed',final_arguments_sha256=arguments_sha,provider_body_sha256=p_provider_body_sha256,
    provider_body_bytes=p_provider_body_bytes,credential_fingerprint=credential.fingerprint,
    vault_secret_id=credential.vault_secret_id,
    api_key_sha256=pg_catalog.encode(extensions.digest(api_key,'sha256'),'hex'),
    sealed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id returning * into permit;
  return sellerpilot_private.elevenst_final_execution_seal(permit);
exception when no_data_found or invalid_text_representation or invalid_datetime_format then
  raise exception 'ELEVENST_FINAL_EXECUTION_CONTEXT_STALE' using errcode='40001';
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_100430_begin_gateway_before_final_body;
revoke all on function public.sellerpilot_100430_begin_gateway_before_final_body(text,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from sellerpilot_private.channel_gateway_jobs job
             where job.id=p_job_id and job.channel='elevenst' and job.operation='listing.create') then
    return false;
  end if;
  return public.sellerpilot_100430_begin_gateway_before_final_body(p_token_hash,p_job_id,p_claim_token);
end;
$$;

create function sellerpilot_private.elevenst_begin_final_provider_mutation(
  p_serverless boolean,
  p_token_hash text,p_job_id uuid,p_claim_token uuid,
  p_final_arguments_sha256 text,p_provider_body_sha256 text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  v_source_id uuid;
  seal jsonb;
  current_arguments_sha text;
  current_api_key text;
  started boolean;
begin
  if p_final_arguments_sha256!~'^[a-f0-9]{64}$' or p_provider_body_sha256!~'^[a-f0-9]{64}$' then return false; end if;
  select (value.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,sourceId}')::uuid
    into v_source_id from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id;
  if v_source_id is null then return false; end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(v_source_id);
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=v_source_id;
  perform 1 from sellerpilot_private.products value where value.id=permit.product_id and value.owner_id=permit.owner_id for update;
  perform 1 from sellerpilot_private.channel_credentials value where value.id=permit.credential_id
    and value.version=permit.credential_version and value.status='active'
    and value.vault_secret_id=permit.vault_secret_id and value.fingerprint=permit.credential_fingerprint for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_category_assignments value where value.id=permit.assignment_id
    and value.status='confirmed' for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=permit.owner_id
    and value.product_id=permit.product_id and value.kind='publish' and value.version=permit.draft_version for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=permit.source_id
    and value.status='approved' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_approval_requests value where value.approval_request_id=permit.approval_request_id
    and value.status='approved' for update;
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=v_source_id for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id for update;
  seal:=job.request_payload#>'{arguments,sellerpilotElevenstFinalExecutionSeal}';
  current_arguments_sha:=pg_catalog.encode(extensions.digest(
    ((job.request_payload#>'{arguments}')-'sellerpilotElevenstFinalExecutionSeal')::text,'sha256'),'hex');
  select pg_catalog.btrim(secret.decrypted_secret::jsonb->>'api_key') into current_api_key
    from vault.decrypted_secrets secret where secret.id=permit.vault_secret_id;
  if permit.status<>'sealed' or job.channel<>'elevenst' or job.operation<>'listing.create'
     or job.environment<>'production' or job.status<>'running' or job.claim_token is distinct from p_claim_token
     or job.credential_id<>permit.credential_id or job.created_by<>permit.owner_id
     or job.request_fingerprint is distinct from permit.request_fingerprint
     or not sellerpilot_private.elevenst_jsonb_exact_keys(seal,array[
       'contract','permitId','sourceId','requestFingerprint','finalArgumentsSha256','providerBodySha256',
       'providerBodyBytes','credentialId','credentialVersion','credentialFingerprint','vaultSecretId','apiKeySha256','sealedAt'])
     or seal->>'contract'<>'sellerpilot_elevenst_final_execution_seal_v1'
     or seal->>'permitId'<>permit.permit_id::text or seal->>'sourceId'<>permit.source_id::text
     or seal->>'finalArgumentsSha256'<>permit.final_arguments_sha256
     or seal->>'providerBodySha256'<>permit.provider_body_sha256
     or p_final_arguments_sha256<>permit.final_arguments_sha256
     or p_provider_body_sha256<>permit.provider_body_sha256
     or current_arguments_sha<>permit.final_arguments_sha256
     or pg_catalog.encode(extensions.digest(current_api_key,'sha256'),'hex')<>permit.api_key_sha256 then
    return false;
  end if;
  -- The 31700 predecessor recognizes only its original bound state. Expose it
  -- inside this already advisory-serialized transaction after all r4 hashes
  -- have matched; any failed predecessor is restored to sealed before return.
  update sellerpilot_private.elevenst_new_product_execution_permits value
     set status='bound',updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id and value.status='sealed';
  if p_serverless then
    started:=public.sellerpilot_100430_begin_serverless_before_final_body(
      p_token_hash,p_job_id,p_claim_token
    );
  else
    started:=public.sellerpilot_100430_begin_gateway_before_final_body(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if not coalesce(started,false) then
    update sellerpilot_private.elevenst_new_product_execution_permits value
       set status='sealed',updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id and value.status='bound';
    return false;
  end if;
  update sellerpilot_private.elevenst_new_product_execution_permits value
     set status='consumed',updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id and value.status in('sealed','consumed');
  return found;
exception when no_data_found or invalid_text_representation then return false;
end;
$$;

create function public.sellerpilot_service_begin_elevenst_final_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,
  p_final_arguments_sha256 text,p_provider_body_sha256 text
) returns boolean language sql security definer set search_path='' as $$
  select sellerpilot_private.elevenst_begin_final_provider_mutation(
    false,
    p_token_hash,p_job_id,p_claim_token,p_final_arguments_sha256,p_provider_body_sha256
  )
$$;

do $serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_100430_begin_serverless_before_final_body';
  execute 'revoke all on function public.sellerpilot_100430_begin_serverless_before_final_body(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute $fn$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $body$
    begin
      if exists(select 1 from sellerpilot_private.channel_gateway_jobs job
                 where job.id=p_job_id and job.channel='elevenst' and job.operation='listing.create') then return false; end if;
      return public.sellerpilot_100430_begin_serverless_before_final_body(p_token_hash,p_job_id,p_claim_token);
    end;$body$;
    create function public.sellerpilot_service_begin_serverless_11st_final_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,
      p_final_arguments_sha256 text,p_provider_body_sha256 text
    ) returns boolean language sql security definer set search_path='' as $body$
      select sellerpilot_private.elevenst_begin_final_provider_mutation(
        true,
        p_token_hash,p_job_id,p_claim_token,p_final_arguments_sha256,p_provider_body_sha256
      )
    $body$;
  $fn$;
end;
$serverless$;

create function public.sellerpilot_service_claim_elevenst_create_recovery(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  recovery_token uuid:=pg_catalog.gen_random_uuid();
  candidate_source_id uuid;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope='gateway' and value.status='active'
                   and value.expires_at>pg_catalog.clock_timestamp()) then
    raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
  end if;
  select value.source_id into candidate_source_id
    from sellerpilot_private.elevenst_new_product_execution_permits value
   join sellerpilot_private.channel_gateway_jobs candidate on candidate.id=value.consumed_job_id
   where value.status='reconciliation_required' and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
     and candidate.channel='elevenst' and candidate.operation='listing.create'
   order by value.updated_at limit 1;
  if candidate_source_id is null then return null; end if;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(candidate_source_id);
  select value.* into permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=candidate_source_id and value.status='reconciliation_required'
     and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
  ;
  if not found then return null; end if;
  perform 1 from sellerpilot_private.products value where value.id=permit.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials value where value.id=permit.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments value where value.id=permit.assignment_id for update;
  perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=permit.owner_id
    and value.product_id=permit.product_id and value.kind='publish' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_approval_requests value where value.approval_request_id=permit.approval_request_id for update;
  select value.* into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.source_id=candidate_source_id and value.status='reconciliation_required'
     and value.recovery_attempt_count<20
     and (value.recovery_lease_expires_at is null or value.recovery_lease_expires_at<pg_catalog.clock_timestamp())
   for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value where value.id=permit.consumed_job_id for update;
  update sellerpilot_private.elevenst_new_product_execution_permits value set
    recovery_claim_token=recovery_token,recovery_lease_expires_at=pg_catalog.clock_timestamp()+interval '60 seconds',
    recovery_attempt_count=recovery_attempt_count+1,updated_at=pg_catalog.clock_timestamp()
   where value.permit_id=permit.permit_id;
  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_create_recovery_claim_v1',
    'jobId',job.id,'recoveryToken',recovery_token,'credentialId',permit.credential_id,
    'expectedProduct',job.request_payload#>'{arguments,product}'
  );
exception when no_data_found then
  raise exception 'ELEVENST_CREATE_RECOVERY_ACCESS_DENIED' using errcode='42501';
end;
$$;

create function public.sellerpilot_service_finish_elevenst_create_recovery(
  p_token_hash text,p_job_id uuid,p_recovery_token uuid,p_observation jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  remote_id text:=pg_catalog.btrim(p_observation->>'productNo');
  completed boolean;
begin
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens value
                 where value.token_hash=p_token_hash and value.scope='gateway' and value.status='active'
                   and value.expires_at>pg_catalog.clock_timestamp())
     or not sellerpilot_private.elevenst_jsonb_exact_keys(p_observation,array[
       'contract','outcome','sellerProductCode','productNo','fullOfficialReadback','productMismatches',
       'stockMismatches','providerReadbackUnavailableFields','providerMutationPerformed'])
     or p_observation->>'contract'<>'sellerpilot_elevenst_create_get_only_recovery_v1'
     or p_observation->>'providerMutationPerformed'<>'false' then
    raise exception 'ELEVENST_CREATE_RECOVERY_RESULT_INVALID' using errcode='42501';
  end if;
  select value.* into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.consumed_job_id=p_job_id;
  perform sellerpilot_private.elevenst_execution_source_advisory_lock(permit.source_id);
  perform 1 from sellerpilot_private.products value where value.id=permit.product_id for update;
  perform 1 from sellerpilot_private.channel_credentials value where value.id=permit.credential_id for update;
  perform 1 from sellerpilot_private.product_category_assignments value where value.id=permit.assignment_id for update;
  perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=permit.owner_id
    and value.product_id=permit.product_id and value.kind='publish' for update;
  perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=permit.source_id for update;
  perform 1 from sellerpilot_private.elevenst_new_product_approval_requests value where value.approval_request_id=permit.approval_request_id for update;
  select * into strict permit from sellerpilot_private.elevenst_new_product_execution_permits value
   where value.permit_id=permit.permit_id and value.status='reconciliation_required'
     and value.recovery_claim_token=p_recovery_token and value.recovery_lease_expires_at>=pg_catalog.clock_timestamp() for update;
  select * into strict job from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id for update;
  perform 1 from sellerpilot_private.channel_operation_attempts value where value.id=job.attempt_id for update;
  perform 1 from sellerpilot_private.product_listings value where value.id=job.listing_id for update;
  completed:=p_observation->>'outcome'='unique' and p_observation->>'fullOfficialReadback'='true'
    and remote_id~'^[0-9]{1,20}$';
  if completed then
    update sellerpilot_private.product_listings listing set
      remote_id=remote_id,status='published',last_error=null,
      published_at=coalesce(listing.published_at,pg_catalog.clock_timestamp()),
      last_verified_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
     where listing.id=job.listing_id and listing.owner_id=permit.owner_id
       and listing.product_id=permit.product_id and listing.channel_key='elevenst';
    if not found then raise exception 'ELEVENST_CREATE_RECOVERY_LISTING_MISMATCH' using errcode='40001'; end if;
    update sellerpilot_private.channel_operation_attempts attempt set
      status='succeeded',http_status=200,remote_id=remote_id,
      safe_message='11번가 SellerPrdCd 공식 GET-only 복구 완료',completed_at=pg_catalog.clock_timestamp()
     where attempt.id=job.attempt_id and attempt.status in('running','manual_required');
    update sellerpilot_private.channel_gateway_jobs value set
      status='succeeded',response_payload=pg_catalog.jsonb_build_object(
        'ok',true,'channel','elevenst','operation','listing.create','remoteId',remote_id,
        'recovery',p_observation),error_message=null,completed_at=pg_catalog.clock_timestamp(),
      lease_expires_at=null,worker_token_id=null,claim_token=null,updated_at=pg_catalog.clock_timestamp()
     where value.id=job.id;
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      status='completed',recovery_observation=p_observation,recovery_claim_token=null,
      recovery_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
     where value.permit_id=permit.permit_id;
  else
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      recovery_observation=p_observation,recovery_claim_token=null,recovery_lease_expires_at=null,
      updated_at=pg_catalog.clock_timestamp() where value.permit_id=permit.permit_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'status',case when completed then 'completed' else 'reconciliation_required' end,
    'jobId',job.id,'remoteId',case when completed then remote_id else null end,
    'automaticRetryAllowed',false,'providerMutationPerformed',false
  );
exception when no_data_found then
  raise exception 'ELEVENST_CREATE_RECOVERY_CLAIM_STALE' using errcode='40001';
end;
$$;

-- All generic completion calls serialize with the same source advisory lock.
create function sellerpilot_private.elevenst_full_create_completion_valid(p_result jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_result)='object'
    and p_result->>'ok'='true'
    and p_result->>'channel'='elevenst'
    and p_result->>'operation'='listing.create'
    and p_result->>'remoteId'~'^[0-9]{1,20}$'
    and pg_catalog.jsonb_typeof(p_result->'steps')='array'
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_result->'steps') step
       where step->>'ok'='true'
         and step#>>'{data,sellerpilotFullOfficialReadbackVerified}'='true'
         and step#>>'{data,sellerpilotAdditionalEvidenceRequired}'='false'
    )
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_result->'steps') step
       where step->>'ok'='true'
         and step#>>'{data,sellerpilotFullOfficialStockReadbackVerified}'='true'
    ),false
  )
$$;

revoke all on function sellerpilot_private.elevenst_full_create_completion_valid(jsonb)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_100430_complete_gateway_before_elevenst_lock;
revoke all on function public.sellerpilot_100430_complete_gateway_before_elevenst_lock(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_response_payload jsonb default null,p_error_message text default null,
  p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_source_id uuid;
  v_permit sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  result jsonb;
begin
  select (gateway_job.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,sourceId}')::uuid
    into v_source_id from sellerpilot_private.channel_gateway_jobs gateway_job
   where gateway_job.id=p_job_id and gateway_job.channel='elevenst' and gateway_job.operation='listing.create';
  if v_source_id is not null then
    perform sellerpilot_private.elevenst_execution_source_advisory_lock(v_source_id);
    select * into strict v_permit from sellerpilot_private.elevenst_new_product_execution_permits value
     where value.source_id=v_source_id;
    perform 1 from sellerpilot_private.products value where value.id=v_permit.product_id for update;
    perform 1 from sellerpilot_private.channel_credentials value where value.id=v_permit.credential_id for update;
    perform 1 from sellerpilot_private.product_category_assignments value where value.id=v_permit.assignment_id for update;
    perform 1 from sellerpilot_private.product_registration_drafts value where value.owner_id=v_permit.owner_id
      and value.product_id=v_permit.product_id and value.kind='publish' for update;
    perform 1 from sellerpilot_private.elevenst_new_product_server_sources value where value.id=v_permit.source_id for update;
    perform 1 from sellerpilot_private.elevenst_new_product_source_approvals value where value.source_id=v_permit.source_id for update;
    perform 1 from sellerpilot_private.elevenst_new_product_approval_requests value where value.approval_request_id=v_permit.approval_request_id for update;
    perform 1 from sellerpilot_private.elevenst_new_product_execution_permits value where value.permit_id=v_permit.permit_id for update;
    select * into strict v_job from sellerpilot_private.channel_gateway_jobs value where value.id=p_job_id for update;
    perform 1 from sellerpilot_private.channel_operation_attempts value where value.id=v_job.attempt_id for update;
    perform 1 from sellerpilot_private.product_listings value where value.id=v_job.listing_id for update;
  end if;
  if v_source_id is not null and p_status='succeeded'
     and not sellerpilot_private.elevenst_full_create_completion_valid(p_response_payload) then
    raise exception 'ELEVENST_FULL_CREATE_COMPLETION_EVIDENCE_REQUIRED' using errcode='40001';
  end if;
  result:=public.sellerpilot_100430_complete_gateway_before_elevenst_lock(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
    p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  if v_source_id is not null and result->>'status' in('completed','completed_replay') then
    update sellerpilot_private.elevenst_new_product_execution_permits value set
      status=case when p_status='succeeded' then 'completed' else 'reconciliation_required' end,
      recovery_observation=case when p_status='succeeded' then p_response_payload else value.recovery_observation end,
      updated_at=pg_catalog.clock_timestamp()
     where value.source_id=v_source_id and value.status in('consumed','reconciliation_required');
  end if;
  return result;
end;
$$;

revoke all on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_seal_elevenst_new_product_final_body(uuid,uuid,jsonb,jsonb,text,integer),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_elevenst_final_provider_mutation(text,uuid,uuid,text,text),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb),
  public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_seal_elevenst_new_product_final_body(uuid,uuid,jsonb,jsonb,text,integer),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_elevenst_final_provider_mutation(text,uuid,uuid,text,text),
  public.sellerpilot_service_claim_elevenst_create_recovery(text),
  public.sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb),
  public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)
  to service_role;

do $grant_serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_11st_final_mutation(text,uuid,uuid,text,text)') is not null then
    execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid), public.sellerpilot_service_begin_serverless_11st_final_mutation(text,uuid,uuid,text,text) from public,anon,authenticated,service_role';
    execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid), public.sellerpilot_service_begin_serverless_11st_final_mutation(text,uuid,uuid,text,text) to service_role';
  end if;
end;
$grant_serverless$;

commit;
