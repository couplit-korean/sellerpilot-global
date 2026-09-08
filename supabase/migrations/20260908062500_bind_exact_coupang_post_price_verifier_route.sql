-- Add one direct read-only local-executor route type for the exact Coupang
-- post-price verifier. Installation creates no route, job, or provider call.
-- The service RPC binds the route only after release, worker, credential,
-- egress, closed-gate, and protected-job state all match.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 908062500);

do $preflight$
declare
  definition text;
  definition_hash text;
  definition_acl text;
  constraint_definition text;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_access(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_route_is_current(uuid,text,text,uuid,uuid,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_release_gate_is_effective(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_listing_mutation_release_gate_status()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_coupang_post_price_verifier(text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_post_price_verify_runs'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_post_price_verify_receipts'
     ) is null then
    raise exception 'COUPANG_POST_PRICE_ROUTE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_constraintdef(c.oid, true)
    into strict constraint_definition
    from pg_catalog.pg_constraint c
   where c.conrelid =
       'sellerpilot_private.local_channel_executor_routes'::regclass
     and c.contype = 'c'
     and c.conname = 'local_channel_executor_routes_operation_check';
  if constraint_definition is distinct from
       'CHECK (channel = ''coupang''::text AND (operation = ANY (ARRAY[''categories.attributes''::text, ''categories.validate''::text, ''listing.create''::text])) OR channel = ''smartstore''::text AND (operation = ANY (ARRAY[''listing.create''::text, ''listing.update''::text])))'
  then
    raise exception 'COUPANG_POST_PRICE_ROUTE_CONSTRAINT_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid),
         encode(extensions.digest(pg_catalog.pg_get_functiondef(p.oid), 'sha256'), 'hex'),
         coalesce(p.proacl::text, '')
    into strict definition, definition_hash, definition_acl
    from pg_catalog.pg_proc p
   where p.oid =
     'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure;
  if definition_hash is distinct from
       '835e89f37898c7ef411a7831c80ec5d481cc3719ac7a822af0d177be9258743a'
     or definition_acl is distinct from '{postgres=X/postgres}'
     or pg_catalog.strpos(definition, 'listing.publication.verify') <> 0
     or not exists (
       select 1 from pg_catalog.pg_proc p
        where p.oid =
          'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure
          and not p.prosecdef
          and p.provolatile = 'i'
          and p.proconfig = array['search_path=""']::text[]
          and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_ACCESS_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  if (public.sellerpilot_service_listing_mutation_release_gate_status()
       ->>'open')::boolean
     or sellerpilot_private.listing_mutation_release_gate_is_effective('coupang')
     or exists (
       select 1 from sellerpilot_private.local_channel_executor_routes route
        where route.channel = 'coupang'
          and route.operation = 'listing.publication.verify'
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangPostPriceVerification', false)
     )
     or exists (select 1 from
       sellerpilot_private.coupang_exact_post_price_verify_runs)
     or exists (select 1 from
       sellerpilot_private.coupang_exact_post_price_verify_receipts) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_INSTALL_PREIMAGE_REJECTED'
      using errcode = '55000';
  end if;
end
$preflight$;

lock table sellerpilot_private.local_channel_executor_routes
  in share row exclusive mode;
alter table sellerpilot_private.local_channel_executor_routes
  drop constraint local_channel_executor_routes_operation_check;
alter table sellerpilot_private.local_channel_executor_routes
  add constraint local_channel_executor_routes_operation_check check (
    (channel = 'coupang' and operation in (
      'categories.attributes', 'categories.validate', 'listing.create',
      'listing.publication.verify'
    ))
    or (channel = 'smartstore' and operation in (
      'listing.create', 'listing.update'
    ))
  );

create or replace function sellerpilot_private.local_channel_executor_access(
  p_channel text, p_operation text
)
returns text
language sql
immutable
set search_path = ''
as $function$
 select case
 when p_channel = 'coupang' and p_operation in ('categories.attributes','categories.validate','listing.publication.verify') then 'read'
 when p_operation = 'listing.create' and p_channel in ('coupang','smartstore') then 'write'
 when p_channel = 'smartstore' and p_operation = 'listing.update' then 'write'
 else null
 end
$function$;
revoke all on function
sellerpilot_private.local_channel_executor_access(text,text)
from public, anon, authenticated, service_role;

create table sellerpilot_private.coupang_exact_post_price_route_bindings (
  singleton boolean primary key default true check (singleton),
  route_id uuid not null unique
    references sellerpilot_private.local_channel_executor_routes(id)
      on delete restrict,
  release_sha text not null unique check (release_sha ~ '^[a-f0-9]{40}$'),
  worker_version text not null,
  route_snapshot jsonb not null,
  route_snapshot_sha256 text not null
    check (route_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  provider_mutation_performed boolean not null default false
    check (not provider_mutation_performed),
  gateway_job_created boolean not null default false
    check (not gateway_job_created),
  contract text not null check (
    contract = 'coupang_exact_post_price_direct_route_v1'
  ),
  bound_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.coupang_exact_post_price_route_bindings
  enable row level security;
revoke all on sellerpilot_private.coupang_exact_post_price_route_bindings
from public, anon, authenticated, service_role;

create function sellerpilot_private.block_coupang_post_price_route_binding_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_POST_PRICE_ROUTE_BINDING_IMMUTABLE'
    using errcode = '55000';
end
$$;
revoke all on function
sellerpilot_private.block_coupang_post_price_route_binding_change()
from public, anon, authenticated, service_role;
create trigger block_coupang_post_price_route_binding_change
before update or delete
on sellerpilot_private.coupang_exact_post_price_route_bindings
for each row execute function
sellerpilot_private.block_coupang_post_price_route_binding_change();

create function public.sellerpilot_service_bind_exact_coupang_post_price_route(
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  credential sellerpilot_private.channel_credentials%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  predecessor sellerpilot_private.local_channel_executor_routes%rowtype;
  binding sellerpilot_private.coupang_exact_post_price_route_bindings%rowtype;
  route sellerpilot_private.local_channel_executor_routes%rowtype;
  route_id uuid;
  worker_version text;
  route_snapshot jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$' then
    raise exception 'COUPANG_POST_PRICE_ROUTE_RELEASE_INVALID'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908062501);

  select * into binding
    from sellerpilot_private.coupang_exact_post_price_route_bindings
   where singleton
   for share;
  if binding.route_id is not null then
    select * into strict route
      from sellerpilot_private.local_channel_executor_routes
     where id = binding.route_id for share;
    if binding.release_sha is distinct from p_release_sha
       or to_jsonb(route) is distinct from binding.route_snapshot
       or encode(extensions.digest(to_jsonb(route)::text, 'sha256'), 'hex')
          is distinct from binding.route_snapshot_sha256
       or sellerpilot_private.local_channel_executor_route_is_current(
         route.owner_id, route.channel, route.operation, route.credential_id,
         route.worker_token_id, route.release_sha, route.egress_ip_sha256,
         binding.worker_version
       ) is not true then
      raise exception 'COUPANG_POST_PRICE_ROUTE_BINDING_REPLAY_DRIFT'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', binding.contract, 'status', 'ready',
      'routeId', binding.route_id, 'releaseSha', binding.release_sha,
      'reused', true, 'providerMutationPerformed', false,
      'gatewayJobCreated', false
    );
  end if;

  if sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from p_release_sha
     or (public.sellerpilot_service_listing_mutation_release_gate_status()
       ->>'open')::boolean
     or sellerpilot_private.listing_mutation_release_gate_is_effective('coupang')
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.status = 'running' and job.operation like 'listing.%'
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangPostPriceVerification', false)
     )
     or exists (select 1 from
       sellerpilot_private.coupang_exact_post_price_verify_runs)
     or exists (select 1 from
       sellerpilot_private.coupang_exact_post_price_verify_receipts) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_RUNTIME_PREIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid for share;
  select * into strict worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid for share;
  select * into strict predecessor
    from sellerpilot_private.local_channel_executor_routes
   where id = '73e07b05-b3bd-47e4-be92-062d537150e9'::uuid for share;
  worker_version := 'sellerpilot-cli-worker/1.61+' || p_release_sha ||
    '.92b235ca02d';

  if credential.channel is distinct from 'coupang'
     or credential.environment is distinct from 'production'
     or credential.status is distinct from 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= clock_timestamp())
     or credential.last_check_status is distinct from 'passed'
     or credential.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     or worker.scope is distinct from 'gateway'
     or worker.status is distinct from 'active'
     or worker.expires_at <= clock_timestamp()
     or worker.last_seen_at < clock_timestamp() - interval '3 minutes'
     or worker.last_version is distinct from worker_version
     or predecessor.owner_id is distinct from
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or predecessor.channel is distinct from 'coupang'
     or predecessor.operation is distinct from 'listing.create'
     or predecessor.credential_id is distinct from credential.id
     or predecessor.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or predecessor.worker_token_id is distinct from worker.id
     or predecessor.egress_ip_sha256 is distinct from
       '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
     or predecessor.release_sha is distinct from
       'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
     or predecessor.enabled is not true
     or predecessor.approved_by is distinct from
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id =
          '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_IDENTITY_PREIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  if not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
          and job.channel = 'coupang'
          and job.operation = 'listing.create'
          and job.status = 'reconciliation_required'
          and job.attempt_count = 1
          and job.provider_mutation_started_at is not null
          and job.completed_at is not null
     )
     or not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = '36fcb808-a2f1-42b7-a6c9-264d884f25fb'::uuid
          and job.channel = 'coupang'
          and job.operation = 'price.update'
          and job.status = 'succeeded'
          and job.attempt_count = 2
          and job.provider_mutation_started_at is not null
          and job.completed_at is not null
     )
     or not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
          and job.channel = 'coupang'
          and job.operation = 'listing.publication.verify'
          and job.status = 'reconciliation_required'
          and job.attempt_count = 4
          and job.provider_mutation_started_at is null
          and job.completed_at is not null
     ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_PROTECTED_JOB_DRIFT'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from sellerpilot_private.local_channel_executor_routes candidate
     where candidate.owner_id =
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and candidate.channel = 'coupang'
       and candidate.operation = 'listing.publication.verify'
       and candidate.credential_id = credential.id
  ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_ALREADY_EXISTS'
      using errcode = '55000';
  end if;

  route_id := gen_random_uuid();
  insert into sellerpilot_private.local_channel_executor_routes (
    id, owner_id, channel, operation, credential_id, seller_account_key,
    worker_token_id, release_sha, egress_ip_sha256, approved_by, approved_at,
    expires_at, enabled, created_at
  ) values (
    route_id, '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    'coupang', 'listing.publication.verify', credential.id,
    'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd',
    worker.id, p_release_sha,
    '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01',
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    clock_timestamp(), clock_timestamp() + interval '1 hour',
    true, clock_timestamp()
  ) returning * into strict route;
  route_snapshot := to_jsonb(route);

  if sellerpilot_private.local_channel_executor_access(
       route.channel, route.operation
     ) is distinct from 'read'
     or sellerpilot_private.local_channel_executor_route_is_current(
       route.owner_id, route.channel, route.operation, route.credential_id,
       route.worker_token_id, route.release_sha, route.egress_ip_sha256,
       worker_version
     ) is not true then
    raise exception 'COUPANG_POST_PRICE_ROUTE_POSTIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.coupang_exact_post_price_route_bindings (
    singleton, route_id, release_sha, worker_version, route_snapshot,
    route_snapshot_sha256, expires_at, provider_mutation_performed,
    gateway_job_created, contract, bound_at
  ) values (
    true, route.id, route.release_sha, worker_version, route_snapshot,
    encode(extensions.digest(route_snapshot::text, 'sha256'), 'hex'),
    route.expires_at, false, false,
    'coupang_exact_post_price_direct_route_v1', clock_timestamp()
  );
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    route.owner_id, 'coupang_exact_post_price_direct_route_bound',
    'local_channel_executor_route', route.id::text,
    jsonb_build_object(
      'contract', 'coupang_exact_post_price_direct_route_v1',
      'releaseSha', route.release_sha,
      'workerTokenId', route.worker_token_id,
      'credentialId', route.credential_id,
      'providerMutationPerformed', false,
      'gatewayJobCreated', false
    )
  );
  return jsonb_build_object(
    'contract', 'coupang_exact_post_price_direct_route_v1',
    'status', 'ready', 'routeId', route.id,
    'releaseSha', route.release_sha, 'reused', false,
    'providerMutationPerformed', false, 'gatewayJobCreated', false
  );
end
$$;
revoke all on function
public.sellerpilot_service_bind_exact_coupang_post_price_route(text)
from public, anon, authenticated;
grant execute on function
public.sellerpilot_service_bind_exact_coupang_post_price_route(text)
to service_role;

do $postflight$
declare
  definition text;
  binding_acl text;
  constraint_definition text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid, true)
    into strict constraint_definition
    from pg_catalog.pg_constraint c
   where c.conrelid =
       'sellerpilot_private.local_channel_executor_routes'::regclass
     and c.contype = 'c'
     and c.conname = 'local_channel_executor_routes_operation_check';
  if pg_catalog.strpos(
       constraint_definition, '''listing.publication.verify''::text'
     ) = 0
     or sellerpilot_private.local_channel_executor_access(
       'coupang', 'listing.publication.verify'
     ) is distinct from 'read'
     or sellerpilot_private.local_channel_executor_access(
       'smartstore', 'listing.publication.verify'
     ) is not null
     or sellerpilot_private.local_channel_executor_access(
       'coupang', 'listing.create'
     ) is distinct from 'write'
     or exists (
       select 1 from sellerpilot_private.local_channel_executor_routes route
        where route.operation = 'listing.publication.verify'
     )
     or exists (select 1 from
       sellerpilot_private.coupang_exact_post_price_route_bindings)
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangPostPriceVerification', false)
     ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_INSTALL_POSTIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition, 'listing.publication.verify') = 0
     or pg_catalog.strpos(definition, 'then ''read''') = 0
     or not exists (
       select 1 from pg_catalog.pg_proc p
        where p.oid =
          'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure
          and not p.prosecdef
          and p.provolatile = 'i'
          and p.proconfig = array['search_path=""']::text[]
          and coalesce(p.proacl::text, '') = '{postgres=X/postgres}'
          and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_ACCESS_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  select coalesce(p.proacl::text, '') into strict binding_acl
    from pg_catalog.pg_proc p
   where p.oid =
     'public.sellerpilot_service_bind_exact_coupang_post_price_route(text)'::regprocedure;
  if binding_acl is distinct from
       '{postgres=X/postgres,service_role=X/postgres}'
     or not exists (
       select 1 from pg_catalog.pg_proc p
        where p.oid =
          'public.sellerpilot_service_bind_exact_coupang_post_price_route(text)'::regprocedure
          and p.prosecdef
          and p.proconfig @> array['search_path=""','TimeZone=UTC']::text[]
          and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     ) then
    raise exception 'COUPANG_POST_PRICE_ROUTE_BIND_RPC_SECURITY_DRIFT'
      using errcode = '55000';
  end if;
end
$postflight$;

commit;
