-- Rotate only the three already-attested Coupang local-executor routes from
-- a78cc371 to f0b9af0. The runtime and worker must already be on f0b9af0.
-- This migration does not open the Coupang mutation gate or touch any job,
-- listing, credential, worker, seller, egress, approval, or expiry value.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908052500);

do $preflight$
declare
  matched_route_count integer;
  exact_id_count integer;
  enabled_identity_count integer;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  route_definition text;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_release_gate_is_effective(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_route_is_current(uuid,text,text,uuid,uuid,text,text,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.local_channel_executor_routes'
     ) is null
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;

  route_definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_route_is_current(uuid,text,text,uuid,uuid,text,text,text)'::regprocedure
  );
  if pg_catalog.strpos(
       route_definition,
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) = 0
     or pg_catalog.strpos(
       route_definition,
       'sellerpilot_private.listing_mutation_release_gate_is_effective('
     ) = 0
     or pg_catalog.strpos(
       route_definition,
       'sellerpilot_private.local_channel_executor_access('
     ) = 0
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_CURRENT_PREDICATE_DRIFT'
      using errcode = '55000';
  end if;

  if sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from 'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_RUNTIME_NOT_ACTIVE'
      using errcode = '55000';
  end if;

  select * into strict worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
   for share;

  if worker.scope is distinct from 'gateway'
     or worker.status is distinct from 'active'
     or worker.expires_at <= clock_timestamp()
     or worker.last_seen_at < clock_timestamp() - interval '3 minutes'
     or worker.last_version is distinct from
       'sellerpilot-cli-worker/1.61+f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca.92b235ca02d'
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = worker.created_by
     )
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_WORKER_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
   for share;

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
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = credential.created_by
     )
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_CREDENTIAL_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  perform route.id
    from sellerpilot_private.local_channel_executor_routes route
   where route.id in (
     'fd27ffd0-59d3-45af-9315-e435a14d27cb'::uuid,
     '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid,
     'b23cb3cd-5a04-4000-8218-a914d2b22461'::uuid
   )
   order by route.id
   for update;

  select count(*) into exact_id_count
    from sellerpilot_private.local_channel_executor_routes route
   where route.id in (
     'fd27ffd0-59d3-45af-9315-e435a14d27cb'::uuid,
     '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid,
     'b23cb3cd-5a04-4000-8218-a914d2b22461'::uuid
   );

  select count(*) into matched_route_count
    from (
      values
        ('fd27ffd0-59d3-45af-9315-e435a14d27cb'::uuid,
         'categories.attributes'::text),
        ('01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid,
         'categories.validate'::text),
        ('b23cb3cd-5a04-4000-8218-a914d2b22461'::uuid,
         'listing.create'::text)
    ) expected(id, operation)
    join sellerpilot_private.local_channel_executor_routes route
      on route.id = expected.id
     and route.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and route.channel = 'coupang'
     and route.operation = expected.operation
     and route.credential_id = credential.id
     and route.seller_account_key =
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     and route.worker_token_id = worker.id
     and route.release_sha = 'a78cc371969f4954db4bcfa986d7494631e84cfb'
     and route.egress_ip_sha256 =
       '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
     and route.enabled
     and route.approved_at <= clock_timestamp()
     and route.expires_at > clock_timestamp()
     and exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = route.owner_id
     )
     and exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = route.approved_by
     );

  select count(*) into enabled_identity_count
    from sellerpilot_private.local_channel_executor_routes route
   where route.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and route.channel = 'coupang'
     and route.operation in (
       'categories.attributes', 'categories.validate', 'listing.create'
     )
     and route.credential_id = credential.id
     and route.enabled;

  if exact_id_count <> 3
     or matched_route_count <> 3
     or enabled_identity_count <> 3
     or exists (
       select 1
         from sellerpilot_private.local_channel_executor_routes route
        where route.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and route.channel = 'coupang'
          and route.operation in (
            'categories.attributes', 'categories.validate', 'listing.create'
          )
          and route.credential_id = credential.id
          and route.release_sha =
            'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
     )
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.worker_token_id = worker.id
       and job.status = 'running'
  ) then
    raise exception 'COUPANG_EXACT_ROUTE_F0_WORKER_NOT_DRAINED'
      using errcode = '55000';
  end if;
end;
$preflight$;

create table sellerpilot_private.coupang_exact_route_f0_rotations (
  singleton boolean primary key default true check (singleton),
  route_ids jsonb not null check (
    route_ids = '[
      "fd27ffd0-59d3-45af-9315-e435a14d27cb",
      "01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8",
      "b23cb3cd-5a04-4000-8218-a914d2b22461"
    ]'::jsonb
  ),
  prior_routes jsonb not null,
  prior_routes_sha256 text not null check (prior_routes_sha256 ~ '^[a-f0-9]{64}$'),
  rotated_routes jsonb not null,
  rotated_routes_sha256 text not null check (rotated_routes_sha256 ~ '^[a-f0-9]{64}$'),
  prior_release_sha text not null check (
    prior_release_sha = 'a78cc371969f4954db4bcfa986d7494631e84cfb'
  ),
  active_release_sha text not null check (
    active_release_sha = 'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
  ),
  worker_token_id uuid not null check (
    worker_token_id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
  ),
  egress_ip_sha256 text not null check (
    egress_ip_sha256 =
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
  ),
  gate_effective_at_rotation boolean not null,
  provider_mutation_performed boolean not null default false check (
    provider_mutation_performed is false
  ),
  rotated_at timestamptz not null default clock_timestamp(),
  contract text not null check (
    contract = 'coupang_exact_route_f0_rotation_v1'
  )
);

alter table sellerpilot_private.coupang_exact_route_f0_rotations
  enable row level security;
revoke all on sellerpilot_private.coupang_exact_route_f0_rotations
  from public, anon, authenticated, service_role;

create function sellerpilot_private.block_coupang_exact_route_f0_rotation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_EXACT_ROUTE_F0_ROTATION_IMMUTABLE'
    using errcode = '55000';
end
$$;

revoke all on function
  sellerpilot_private.block_coupang_exact_route_f0_rotation_change()
  from public, anon, authenticated, service_role;

create trigger block_coupang_exact_route_f0_rotation_change
before update or delete
on sellerpilot_private.coupang_exact_route_f0_rotations
for each row execute function
  sellerpilot_private.block_coupang_exact_route_f0_rotation_change();

do $rotate$
declare
  prior_snapshot jsonb;
  rotated_snapshot jsonb;
  updated_count integer;
  gate_effective boolean;
  operation text;
  route_current boolean;
  expected_current boolean;
begin
  select jsonb_agg(to_jsonb(route) order by route.operation)
    into strict prior_snapshot
    from sellerpilot_private.local_channel_executor_routes route
   where route.id in (
     'fd27ffd0-59d3-45af-9315-e435a14d27cb'::uuid,
     '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid,
     'b23cb3cd-5a04-4000-8218-a914d2b22461'::uuid
   );

  update sellerpilot_private.local_channel_executor_routes route
     set release_sha = 'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
   where route.id in (
     'fd27ffd0-59d3-45af-9315-e435a14d27cb'::uuid,
     '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid,
     'b23cb3cd-5a04-4000-8218-a914d2b22461'::uuid
   )
     and route.release_sha = 'a78cc371969f4954db4bcfa986d7494631e84cfb';
  get diagnostics updated_count = row_count;
  if updated_count <> 3 then
    raise exception 'COUPANG_EXACT_ROUTE_F0_UPDATE_COUNT_DRIFT'
      using errcode = '55000';
  end if;

  select jsonb_agg(to_jsonb(route) order by route.operation)
    into strict rotated_snapshot
    from sellerpilot_private.local_channel_executor_routes route
   where route.id in (
     'fd27ffd0-59d3-45af-9315-e435a14d27cb'::uuid,
     '01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8'::uuid,
     'b23cb3cd-5a04-4000-8218-a914d2b22461'::uuid
   );

  if exists (
    select 1
      from jsonb_array_elements(prior_snapshot) before_row
      join jsonb_array_elements(rotated_snapshot) after_row
        on after_row->>'id' = before_row->>'id'
     where (before_row - 'release_sha') is distinct from
           (after_row - 'release_sha')
        or before_row->>'release_sha' is distinct from
           'a78cc371969f4954db4bcfa986d7494631e84cfb'
        or after_row->>'release_sha' is distinct from
           'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
  )
  or jsonb_array_length(prior_snapshot) <> 3
  or jsonb_array_length(rotated_snapshot) <> 3
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  gate_effective := coalesce(
    sellerpilot_private.listing_mutation_release_gate_is_effective('coupang'),
    false
  );

  foreach operation in array array[
    'categories.attributes', 'categories.validate', 'listing.create'
  ] loop
    route_current := sellerpilot_private.local_channel_executor_route_is_current(
      '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
      'coupang', operation,
      '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid,
      '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
      'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca',
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01',
      'sellerpilot-cli-worker/1.61+f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca.92b235ca02d'
    );
    expected_current := case
      when operation = 'listing.create' then gate_effective
      else true
    end;
    if route_current is distinct from expected_current then
      raise exception 'COUPANG_EXACT_ROUTE_F0_CURRENT_READBACK_DRIFT'
        using errcode = '55000';
    end if;
  end loop;

  insert into sellerpilot_private.coupang_exact_route_f0_rotations (
    singleton, route_ids, prior_routes, prior_routes_sha256,
    rotated_routes, rotated_routes_sha256, prior_release_sha,
    active_release_sha, worker_token_id, egress_ip_sha256,
    gate_effective_at_rotation, provider_mutation_performed, contract
  ) values (
    true,
    '[
      "fd27ffd0-59d3-45af-9315-e435a14d27cb",
      "01ae9ad5-bf9d-4cfe-b900-c5ad332e28d8",
      "b23cb3cd-5a04-4000-8218-a914d2b22461"
    ]'::jsonb,
    prior_snapshot,
    encode(extensions.digest(prior_snapshot::text, 'sha256'), 'hex'),
    rotated_snapshot,
    encode(extensions.digest(rotated_snapshot::text, 'sha256'), 'hex'),
    'a78cc371969f4954db4bcfa986d7494631e84cfb',
    'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca',
    '02955cb4-fa9f-466b-824f-b61f06276190',
    '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01',
    gate_effective,
    false,
    'coupang_exact_route_f0_rotation_v1'
  );

  if sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from 'f0b9af0df9e3a01f1efaeb8bf886bb87879a56ca'
     or (select count(*)
           from sellerpilot_private.coupang_exact_route_f0_rotations) <> 1
  then
    raise exception 'COUPANG_EXACT_ROUTE_F0_FINAL_READBACK_DRIFT'
      using errcode = '55000';
  end if;
end;
$rotate$;

comment on table sellerpilot_private.coupang_exact_route_f0_rotations is
  'Immutable record of the exact three-route Coupang local-executor release rotation from a78cc371 to f0b9af0; records no provider mutation and does not open the mutation gate.';

commit;
