-- Final one-shot execution fence for an approved Elevenst 1346631 CREATE.
-- No provider call or source row is created by this migration.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702700);

do $migration$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_elevenst_new_product_source_readback(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regclass('sellerpilot_private.channel_gateway_jobs') is null then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CAS_DEPENDENCY_MISSING';
  end if;
end;
$migration$;

create table sellerpilot_private.elevenst_new_product_execution_permits (
  permit_id uuid primary key default pg_catalog.gen_random_uuid(),
  source_id uuid not null unique references
    sellerpilot_private.elevenst_new_product_server_sources(id) on delete restrict,
  approval_request_id uuid not null unique references
    sellerpilot_private.elevenst_new_product_approval_requests(approval_request_id) on delete restrict,
  approval_payload_sha256 text not null check (approval_payload_sha256 ~ '^[a-f0-9]{64}$'),
  six_kind_digest text not null check (six_kind_digest ~ '^[a-f0-9]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  product_revision bigint not null check (product_revision > 0),
  product_approval_revision bigint not null check (product_approval_revision > 0),
  draft_version bigint not null check (draft_version > 0),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  assignment_id uuid not null references sellerpilot_private.product_category_assignments(id) on delete restrict,
  assignment_confirmed_at timestamptz not null,
  market text not null,
  target_id text not null,
  status text not null default 'bound' check (status in ('bound','consumed','reconciliation_required')),
  bound_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  consumed_claim_token uuid,
  consumed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (product_revision = product_approval_revision),
  check ((consumed_job_id is null) = (consumed_claim_token is null)),
  check ((consumed_job_id is null) = (consumed_at is null)),
  check ((status = 'bound') = (consumed_job_id is null))
);

revoke all on sellerpilot_private.elevenst_new_product_execution_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_new_product_execution_binding(
  p_permit sellerpilot_private.elevenst_new_product_execution_permits
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'contract','sellerpilot_elevenst_new_product_execution_binding_v1',
    'permitId',p_permit.permit_id,
    'sourceId',p_permit.source_id,
    'approvalPayloadSha256',p_permit.approval_payload_sha256,
    'sixKindDigest',p_permit.six_kind_digest,
    'requestFingerprint',p_permit.request_fingerprint,
    'ownerId',p_permit.owner_id,
    'productId',p_permit.product_id,
    'productRevision',p_permit.product_revision,
    'productApprovalRevision',p_permit.product_approval_revision,
    'draftVersion',p_permit.draft_version,
    'credentialId',p_permit.credential_id,
    'credentialVersion',p_permit.credential_version,
    'assignmentId',p_permit.assignment_id,
    'assignmentConfirmedAt',p_permit.assignment_confirmed_at,
    'boundAt',p_permit.bound_at
  )
$$;

revoke all on function sellerpilot_private.elevenst_new_product_execution_binding(
  sellerpilot_private.elevenst_new_product_execution_permits
) from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_current_six_kind_digest(
  p_source sellerpilot_private.elevenst_new_product_server_sources
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare source_values jsonb;
begin
  source_values := pg_catalog.jsonb_build_object(
    'product', public.sellerpilot_service_elevenst_new_product_source(
      'product',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'credential', public.sellerpilot_service_elevenst_new_product_source(
      'credential',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'notices', public.sellerpilot_service_elevenst_new_product_source(
      'notices',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'seller', public.sellerpilot_service_elevenst_new_product_source(
      'seller',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'availability', public.sellerpilot_service_elevenst_new_product_source(
      'availability',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version),
    'policy', public.sellerpilot_service_elevenst_new_product_source(
      'policy',p_source.owner_id,p_source.product_id,'1346631',p_source.credential_id,p_source.credential_version)
  );
  if exists(select 1 from pg_catalog.jsonb_each(source_values) item
            where item.value='null'::jsonb or item.value->>'current' is distinct from 'true') then
    return null;
  end if;
  return pg_catalog.encode(extensions.digest(source_values::text,'sha256'),'hex');
end;
$$;

revoke all on function sellerpilot_private.elevenst_current_six_kind_digest(
  sellerpilot_private.elevenst_new_product_server_sources
) from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_elevenst_new_product_source_readback(
  uuid,uuid,uuid,text,text
) rename to sellerpilot_100317_elevenst_source_readback_before_execution_ca;
revoke all on function public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_elevenst_new_product_source_readback(
  p_actor_id uuid,p_product_id uuid,p_credential_id uuid,p_market text,p_target_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; permit_status text;
begin
  result:=public.sellerpilot_100317_elevenst_source_readback_before_execution_ca(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
  if result is null then return null; end if;
  select permit.status into permit_status
    from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.source_id=(result->>'sourceId')::uuid;
  if found and permit_status in ('consumed','reconciliation_required') then return null; end if;
  return result;
end;
$$;

create function public.sellerpilot_service_bind_elevenst_new_product_execution(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text,
  p_source_id uuid,
  p_approval_payload_sha256 text,
  p_six_kind_digest text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  approval_row sellerpilot_private.elevenst_new_product_source_approvals%rowtype;
  request_row sellerpilot_private.elevenst_new_product_approval_requests%rowtype;
  assignment_row sellerpilot_private.product_category_assignments%rowtype;
  permit_row sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  current_digest text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim()
     or p_actor_id is null or p_product_id is null or p_credential_id is null or p_source_id is null
     or p_approval_payload_sha256 !~ '^[a-f0-9]{64}$'
     or p_six_kind_digest !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_BIND_ACCESS_DENIED' using errcode='42501';
  end if;
  context_value := public.sellerpilot_service_elevenst_new_product_approval_context(
    p_actor_id,p_product_id,p_credential_id,p_market,p_target_id);
  if context_value is null then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONTEXT_STALE' using errcode='40001';
  end if;
  perform 1 from sellerpilot_private.products product
   where product.id=p_product_id and product.owner_id=(context_value->>'ownerId')::uuid for update;
  perform 1 from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.version=(context_value->>'credentialVersion')::integer
     and credential.status='active' and credential.channel='elevenst' and credential.environment='production' for update;
  select assignment.* into strict assignment_row
    from sellerpilot_private.product_category_assignments assignment
   where assignment.owner_id=(context_value->>'ownerId')::uuid and assignment.product_id=p_product_id
     and assignment.channel='elevenst' and assignment.environment='production'
     and assignment.market=pg_catalog.btrim(p_market) and assignment.category_id='1346631'
     and assignment.status='confirmed' and assignment.is_leaf and assignment.confirmed_at is not null
   for update;
  perform 1 from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id=(context_value->>'ownerId')::uuid and draft.product_id=p_product_id
     and draft.kind='publish' and draft.version=(context_value->>'draftVersion')::bigint for update;
  select source.* into strict source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id=p_source_id and source.owner_id=(context_value->>'ownerId')::uuid
     and source.product_id=p_product_id and source.category_id='1346631'
     and source.credential_id=p_credential_id
     and source.credential_version=(context_value->>'credentialVersion')::integer
     and source.product_updated_at=(context_value->>'productUpdatedAt')::timestamptz
     and source.product_revision=(context_value->>'productRevision')::bigint
     and source.product_approval_revision=(context_value->>'productApprovalRevision')::bigint
     and source.status='approved' for update;
  select approval.* into strict approval_row
    from sellerpilot_private.elevenst_new_product_source_approvals approval
   where approval.source_id=p_source_id and approval.approval_payload_sha256=p_approval_payload_sha256
     and approval.draft_version=(context_value->>'draftVersion')::bigint for update;
  select request.* into strict request_row
    from sellerpilot_private.elevenst_new_product_approval_requests request
   where request.approval_request_id=approval_row.approval_request_id
     and request.source_id=p_source_id and request.status='approved'
     and request.approval_payload_sha256=p_approval_payload_sha256 for update;
  if (source_row.availability_receipt->>'observedAt')::timestamptz
       < pg_catalog.clock_timestamp()-interval '10 minutes' then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_AVAILABILITY_STALE' using errcode='40001';
  end if;
  current_digest := sellerpilot_private.elevenst_current_six_kind_digest(source_row);
  if current_digest is null or current_digest is distinct from p_six_kind_digest then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_SOURCE_STALE' using errcode='40001';
  end if;
  select permit.* into permit_row
    from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.source_id=p_source_id for update;
  if found then
    if permit_row.status='bound' and permit_row.request_fingerprint=p_request_fingerprint
       and permit_row.six_kind_digest=p_six_kind_digest then
      return sellerpilot_private.elevenst_new_product_execution_binding(permit_row);
    end if;
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_REPLAY_REQUIRES_RECONCILIATION' using errcode='40001';
  end if;
  insert into sellerpilot_private.elevenst_new_product_execution_permits(
    source_id,approval_request_id,approval_payload_sha256,six_kind_digest,request_fingerprint,
    actor_id,owner_id,product_id,product_revision,product_approval_revision,draft_version,
    credential_id,credential_version,assignment_id,assignment_confirmed_at,market,target_id
  ) values(
    source_row.id,approval_row.approval_request_id,approval_row.approval_payload_sha256,current_digest,
    p_request_fingerprint,p_actor_id,source_row.owner_id,source_row.product_id,source_row.product_revision,
    source_row.product_approval_revision,approval_row.draft_version,source_row.credential_id,
    source_row.credential_version,assignment_row.id,assignment_row.confirmed_at,
    pg_catalog.btrim(p_market),pg_catalog.btrim(p_target_id)
  ) returning * into permit_row;
  return sellerpilot_private.elevenst_new_product_execution_binding(permit_row);
exception
  when no_data_found or invalid_text_representation or invalid_datetime_format then
    raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONTEXT_STALE'
      using errcode='40001';
end;
$$;

create function sellerpilot_private.elevenst_new_product_job_source_current(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row sellerpilot_private.channel_gateway_jobs%rowtype;
  permit_row sellerpilot_private.elevenst_new_product_execution_permits%rowtype;
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  binding jsonb;
  current_digest text;
begin
  select job.* into job_row from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id for update;
  if not found or job_row.channel<>'elevenst' or job_row.operation<>'listing.create'
     or job_row.environment<>'production'
     or job_row.status<>'running' or job_row.claim_token is distinct from p_claim_token then return false; end if;
  binding:=job_row.request_payload#>'{arguments,sellerpilotElevenstExecutionBinding}';
  if not sellerpilot_private.elevenst_jsonb_exact_keys(binding,array[
       'contract','permitId','sourceId','approvalPayloadSha256','sixKindDigest','requestFingerprint',
       'ownerId','productId','productRevision','productApprovalRevision','draftVersion','credentialId',
       'credentialVersion','assignmentId','assignmentConfirmedAt','boundAt'])
     or binding->>'contract'<>'sellerpilot_elevenst_new_product_execution_binding_v1' then return false; end if;
  select permit.* into permit_row from sellerpilot_private.elevenst_new_product_execution_permits permit
   where permit.permit_id=(binding->>'permitId')::uuid and permit.status='bound' for update;
  if not found or permit_row.source_id::text<>binding->>'sourceId'
     or permit_row.approval_payload_sha256<>binding->>'approvalPayloadSha256'
     or permit_row.six_kind_digest<>binding->>'sixKindDigest'
     or permit_row.request_fingerprint<>binding->>'requestFingerprint'
     or permit_row.owner_id::text<>binding->>'ownerId' or permit_row.product_id::text<>binding->>'productId'
     or permit_row.product_revision::text<>binding->>'productRevision'
     or permit_row.product_approval_revision::text<>binding->>'productApprovalRevision'
     or permit_row.draft_version::text<>binding->>'draftVersion'
     or permit_row.credential_id::text<>binding->>'credentialId'
     or permit_row.credential_version::text<>binding->>'credentialVersion'
     or permit_row.assignment_id::text<>binding->>'assignmentId'
     or permit_row.assignment_confirmed_at is distinct from (binding->>'assignmentConfirmedAt')::timestamptz
     or permit_row.bound_at is distinct from (binding->>'boundAt')::timestamptz
     or job_row.credential_id<>permit_row.credential_id
     or job_row.created_by<>permit_row.owner_id
     or job_row.request_fingerprint is distinct from permit_row.request_fingerprint
     then return false; end if;
  perform 1 from sellerpilot_private.products product where product.id=permit_row.product_id
    and product.owner_id=permit_row.owner_id and product.updated_at=(select product_updated_at from sellerpilot_private.elevenst_new_product_server_sources where id=permit_row.source_id)
    and product.detail_page_version=permit_row.product_revision
    and product.detail_page_approved_version=permit_row.product_approval_revision for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.channel_credentials credential where credential.id=permit_row.credential_id
    and credential.created_by=permit_row.owner_id and credential.version=permit_row.credential_version
    and credential.channel='elevenst' and credential.environment='production' and credential.status='active' for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_category_assignments assignment where assignment.id=permit_row.assignment_id
    and assignment.owner_id=permit_row.owner_id and assignment.product_id=permit_row.product_id
    and assignment.channel='elevenst' and assignment.environment='production' and assignment.market=permit_row.market
    and assignment.category_id='1346631' and assignment.status='confirmed' and assignment.is_leaf
    and assignment.confirmed_at=permit_row.assignment_confirmed_at for update;
  if not found then return false; end if;
  perform 1 from sellerpilot_private.product_registration_drafts draft where draft.owner_id=permit_row.owner_id
    and draft.product_id=permit_row.product_id and draft.kind='publish' and draft.version=permit_row.draft_version for update;
  if not found then return false; end if;
  select source.* into strict source_row from sellerpilot_private.elevenst_new_product_server_sources source
   where source.id=permit_row.source_id and source.status='approved' for update;
  if (source_row.availability_receipt->>'observedAt')::timestamptz
       < pg_catalog.clock_timestamp()-interval '10 minutes' then return false; end if;
  current_digest:=sellerpilot_private.elevenst_current_six_kind_digest(source_row);
  return current_digest is not null and current_digest=permit_row.six_kind_digest;
exception when invalid_text_representation or invalid_datetime_format or no_data_found then return false;
end;
$$;

revoke all on function sellerpilot_private.elevenst_new_product_job_source_current(uuid,uuid)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_100317_begin_gateway_before_elevenst_source;
revoke all on function public.sellerpilot_100317_begin_gateway_before_elevenst_source(text,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare is_elevenst_create boolean; started boolean;
begin
  select channel='elevenst' and operation='listing.create' into is_elevenst_create
    from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
  if not coalesce(is_elevenst_create,false) then
    return public.sellerpilot_100317_begin_gateway_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
  end if;
  if not sellerpilot_private.elevenst_new_product_job_source_current(p_job_id,p_claim_token) then return false; end if;
  started:=public.sellerpilot_100317_begin_gateway_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
  if not coalesce(started,false) then return false; end if;
  update sellerpilot_private.elevenst_new_product_execution_permits permit
     set status='consumed',consumed_job_id=p_job_id,consumed_claim_token=p_claim_token,
         consumed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
   where permit.permit_id=(select (job.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,permitId}')::uuid
                             from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id)
     and permit.status='bound' and permit.consumed_job_id is null;
  if not found then raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONSUMPTION_FAILED' using errcode='40001'; end if;
  return true;
end;
$$;

do $serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_100317_begin_serverless_before_elevenst_source';
  execute 'revoke all on function public.sellerpilot_100317_begin_serverless_before_elevenst_source(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute $fn$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path='' as $body$
    declare is_elevenst_create boolean; started boolean;
    begin
      select channel='elevenst' and operation='listing.create' into is_elevenst_create
        from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
      if not coalesce(is_elevenst_create,false) then
        return public.sellerpilot_100317_begin_serverless_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
      end if;
      if not sellerpilot_private.elevenst_new_product_job_source_current(p_job_id,p_claim_token) then return false; end if;
      started:=public.sellerpilot_100317_begin_serverless_before_elevenst_source(p_token_hash,p_job_id,p_claim_token);
      if not coalesce(started,false) then return false; end if;
      update sellerpilot_private.elevenst_new_product_execution_permits permit
         set status='consumed',consumed_job_id=p_job_id,consumed_claim_token=p_claim_token,
             consumed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
       where permit.permit_id=(select (job.request_payload#>>'{arguments,sellerpilotElevenstExecutionBinding,permitId}')::uuid
                                 from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id)
         and permit.status='bound' and permit.consumed_job_id is null;
      if not found then raise exception 'ELEVENST_NEW_PRODUCT_EXECUTION_CONSUMPTION_FAILED' using errcode='40001'; end if;
      return true;
    end;$body$
  $fn$;
end;
$serverless$;

create function sellerpilot_private.elevenst_execution_reconciliation_convergence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.channel='elevenst' and new.operation='listing.create'
     and new.status='reconciliation_required' and old.status is distinct from new.status then
    update sellerpilot_private.elevenst_new_product_execution_permits permit
       set status='reconciliation_required',updated_at=pg_catalog.clock_timestamp()
     where permit.consumed_job_id=new.id and permit.status='consumed';
  end if;
  return new;
end;
$$;
revoke all on function sellerpilot_private.elevenst_execution_reconciliation_convergence()
  from public,anon,authenticated,service_role;
create trigger elevenst_execution_reconciliation_convergence
after update of status on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.elevenst_execution_reconciliation_convergence();

revoke all on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_elevenst_new_product_source_readback(uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_bind_elevenst_new_product_execution(
  uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.sellerpilot_service_elevenst_new_product_source_readback(uuid,uuid,uuid,text,text),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

do $grant_serverless$
begin
  if pg_catalog.to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is not null then
    execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) from public,anon,authenticated,service_role';
    execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role';
  end if;
end;
$grant_serverless$;

commit;
