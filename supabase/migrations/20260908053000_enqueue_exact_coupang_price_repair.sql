-- Install one exact, release-attested Coupang price-repair lane.  The lane can
-- create only a price.update for the already-observed vendor item.  It never
-- retries the retained listing.create or GET-only verifier jobs.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072053);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_live_price_drift_adjudications'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_registration_drafts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.local_channel_executor_routes'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'
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
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
  then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create table sellerpilot_private.coupang_exact_price_repair_permits (
  permit_id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid),
  source_attempt_id uuid not null
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict
    check (source_attempt_id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid),
  verifier_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict
    check (verifier_job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid),
  listing_id uuid not null unique
    references sellerpilot_private.product_listings(id) on delete restrict
    check (listing_id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid),
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict
    check (product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid),
  draft_id uuid not null
    check (draft_id = '2e868857-5868-4665-8304-978b431f7f00'::uuid),
  draft_version bigint not null check (draft_version = 13),
  draft_data_sha256 text not null check (draft_data_sha256 ~ '^[a-f0-9]{64}$'),
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict
    check (credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid),
  seller_owner_id uuid not null references auth.users(id) on delete restrict
    check (seller_owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid),
  credential_owner_id uuid not null references auth.users(id) on delete restrict
    check (credential_owner_id = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid),
  seller_account_key text not null check (
    seller_account_key =
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
  ),
  seller_product_id text not null check (seller_product_id = '16375780938'),
  vendor_item_id text not null check (vendor_item_id = '96027942778'),
  sku text not null check (sku = 'AUTO-780720401E2D4E4EA45F'),
  currency text not null check (currency = 'KRW'),
  source_price integer not null check (source_price = 3190),
  observed_price integer not null check (observed_price = 6000),
  desired_price integer not null check (desired_price = 3190),
  observed_stock integer not null check (observed_stock = 1),
  source_request_fingerprint text not null check (
    source_request_fingerprint =
      'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
  ),
  adjudication_sha256 text not null check (adjudication_sha256 ~ '^[a-f0-9]{64}$'),
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (credential_fingerprint ~ '^[A-F0-9]{12}$'),
  credential_verified_at timestamptz not null,
  credential_last_checked_at timestamptz not null,
  source_route_id uuid not null
    references sellerpilot_private.local_channel_executor_routes(id)
    on delete restrict,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict
    check (worker_token_id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid),
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  egress_ip_sha256 text not null check (
    egress_ip_sha256 =
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
  ),
  repair_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id)
    on delete restrict,
  repair_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  request_payload_sha256 text not null check (
    request_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  request_payload_bytes integer not null check (
    request_payload_bytes between 100 and 128000
  ),
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  claim_count integer not null default 0 check (claim_count between 0 and 2),
  recovery_count integer not null default 0 check (recovery_count between 0 and 1),
  recovered_at timestamptz,
  bound_at timestamptz,
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  consumed_at timestamptz,
  contract text not null check (
    contract = 'coupang_exact_price_repair_permit_v1'
  ),
  check (
    (recovery_count = 0 and recovered_at is null)
    or (recovery_count = 1 and recovered_at is not null)
  ),
  check (claim_count <= recovery_count + 1),
  check (
    expires_at > coalesce(recovered_at, armed_at)
    and expires_at <= coalesce(recovered_at, armed_at) + interval '1 hour'
  ),
  check (
    (bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null)
    or (bound_at is not null and bound_worker_token_id = worker_token_id
      and bound_claim_token is not null and claim_count between 1 and 2
      and (consumed_at is null or consumed_at >= bound_at))
  )
);

alter table sellerpilot_private.coupang_exact_price_repair_permits
  enable row level security;
revoke all on sellerpilot_private.coupang_exact_price_repair_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.coupang_exact_price_repair_job_matches(
  job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select job.listing_id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    and job.credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
    and job.attempt_id is not null
    and job.channel = 'coupang'
    and job.operation = 'price.update'
    and job.environment = 'production'
    and job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
    and job.seller_account_key =
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
    and job.write_resource_kind = 'listing_mutation'
    and job.write_resource_key = encode(extensions.digest(
      convert_to('coupang','UTF8') || decode('00','hex')
        || convert_to('listing_mutation','UTF8') || decode('00','hex')
        || convert_to('fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4','UTF8'),
      'sha256'
    ), 'hex')
    and job.request_fingerprint ~ '^[a-f0-9]{64}$'
    and job.request_payload->>'periodicKey' =
      'coupang-exact-price-repair:v1:25adf712-1e9a-432b-8b0d-09cf35a826c5'
    and job.request_payload#>>'{arguments,vendorItemId}' = '96027942778'
    and job.request_payload#>>'{arguments,sellerProductId}' = '16375780938'
    and job.request_payload#>'{arguments,price}' = '3190'::jsonb
    and job.request_payload#>'{arguments,forceSalePriceUpdate}' = 'true'::jsonb
    and job.request_payload#>>'{arguments,currency}' = 'KRW'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,contract}' =
      'coupang_exact_price_repair_v1'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceJobId}' =
      '25adf712-1e9a-432b-8b0d-09cf35a826c5'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceAttemptId}' =
      'd771421b-f408-4f75-addd-03879393fab8'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,verifierJobId}' =
      '86d2cb63-d382-4cc9-8153-654cf7ccec80'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,productId}' =
      '1ed4acfc-7603-48ec-a638-241131e59358'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,draftId}' =
      '2e868857-5868-4665-8304-978b431f7f00'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,draftVersion}' = '13'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,sourceRequestFingerprint}' =
      'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,workerTokenId}' =
      '02955cb4-fa9f-466b-824f-b61f06276190'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,egressIpSha256}' =
      '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
    and job.request_payload#>>'{arguments,sellerpilotCoupangExactPriceRepair,releaseSha}'
      ~ '^[a-f0-9]{40}$'
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_job_matches(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

-- This exception covers only the provider's vendor-item identifier.  Every
-- other generic seller/listing/credential check remains in force.
create function
sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(
  job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.coupang_exact_price_repair_job_matches(job)
    and current_setting(
      'sellerpilot.coupang_exact_price_repair_enqueue', true
    ) = job.id::text
    and job.request_payload#>>'{arguments,vendorItemId}' = '96027942778'
    and job.request_payload#>>'{arguments,sellerProductId}' = '16375780938'
    and exists (
      select 1 from sellerpilot_private.product_listings listing
       where listing.id = job.listing_id
         and listing.remote_id = '16375780938'
         and listing.remote_resources#>>'{resources,vendorItemIds,0}' =
           '96027942778'
         and jsonb_array_length(
           listing.remote_resources#>'{resources,vendorItemIds}'
         ) = 1
    ),
    false
  )
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

do $patch_remote_identity$
declare
  definition text;
  before_fragment constant text := $before$if nullif(trim(coalesce(v_requested_remote_id, '')), '') is null
           or trim(v_requested_remote_id) <> coalesce(v_expected_remote_id, '') then
          raise exception 'gateway listing remote identity mismatch';
        end if;$before$;
  after_fragment constant text := $after$if (
          nullif(trim(coalesce(v_requested_remote_id, '')), '') is null
          or trim(v_requested_remote_id) <> coalesce(v_expected_remote_id, '')
        ) and not sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(new) then
          raise exception 'gateway listing remote identity mismatch';
        end if;$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  ) into strict definition;
  if pg_catalog.strpos(
       definition,
       'coupang_exact_price_repair_insert_identity_allowed'
     ) > 0 then return; end if;
  if pg_catalog.strpos(definition, before_fragment) = 0 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_IDENTITY_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(definition, before_fragment, after_fragment);
end
$patch_remote_identity$;

-- The retained CREATE remains unresolved globally.  Give only this exact
-- price-repair payload a distinct active lineage in the existing unique index.
do $patch_active_lineage_index$
declare
  definition text;
  patched text;
  needle constant text := 'ELSE ''default''::text';
  replacement constant text :=
    'WHEN sellerpilot_private.coupang_exact_price_repair_job_matches(channel_gateway_jobs) THEN ''coupang_exact_price_repair_v1''::text ELSE ''default''::text';
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into strict definition
    from pg_catalog.pg_index
   where indexrelid =
     'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass
     and indisunique and indisvalid and indisready and indislive;
  if pg_catalog.strpos(definition,
       'coupang_exact_price_repair_job_matches') > 0 then return; end if;
  if pg_catalog.strpos(definition,
       'coupang_exact_live_verifier_job_matches') = 0
     or (pg_catalog.length(definition)
       - pg_catalog.length(pg_catalog.replace(definition, needle, '')))
       / pg_catalog.length(needle) <> 1 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_INDEX_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  patched := pg_catalog.replace(definition, needle, replacement);
  drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
  execute patched;
end
$patch_active_lineage_index$;

create function sellerpilot_private.guard_coupang_exact_price_repair_permit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_PERMIT_IMMUTABLE'
      using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    if current_setting(
         'sellerpilot.coupang_exact_price_repair_permit_insert', true
       ) is distinct from new.repair_job_id::text
       or new.claim_count <> 0
       or new.recovery_count <> 0
       or new.recovered_at is not null
       or new.bound_at is not null
       or new.bound_worker_token_id is not null
       or new.bound_claim_token is not null
       or new.consumed_at is not null then
      raise exception 'COUPANG_EXACT_PRICE_REPAIR_PERMIT_INSERT_FORBIDDEN'
        using errcode = '55000';
    end if;
    return new;
  end if;
  if to_jsonb(new) - array[
       'expires_at','claim_count','recovery_count','recovered_at',
       'bound_at','bound_worker_token_id','bound_claim_token','consumed_at'
     ] is distinct from to_jsonb(old) - array[
       'expires_at','claim_count','recovery_count','recovered_at',
       'bound_at','bound_worker_token_id','bound_claim_token','consumed_at'
     ] then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_PERMIT_IDENTITY_IMMUTABLE'
      using errcode = '55000';
  end if;
  if old.bound_at is null and old.consumed_at is null
     and new.bound_at is not null
     and new.bound_worker_token_id = old.worker_token_id
     and new.bound_claim_token is not null
     and new.consumed_at is null
     and new.claim_count = old.claim_count + 1
     and new.claim_count between 1 and 2
     and new.recovery_count = old.recovery_count
     and new.recovered_at is not distinct from old.recovered_at
     and new.expires_at = old.expires_at
     and current_setting(
       'sellerpilot.coupang_exact_price_repair_permit_bind', true
     ) = old.repair_job_id::text then
    return new;
  end if;
  if old.bound_at is not null and old.consumed_at is null
     and new.bound_at = old.bound_at
     and new.bound_worker_token_id = old.bound_worker_token_id
     and new.bound_claim_token = old.bound_claim_token
     and new.consumed_at is not null
     and new.consumed_at >= old.bound_at
     and new.claim_count = old.claim_count
     and new.recovery_count = old.recovery_count
     and new.recovered_at is not distinct from old.recovered_at
     and new.expires_at = old.expires_at
     and current_setting(
       'sellerpilot.coupang_exact_price_repair_permit_consume', true
     ) = old.repair_job_id::text then
    return new;
  end if;
  if old.consumed_at is null
     and old.recovery_count = 0
     and old.recovered_at is null
     and new.bound_at is null
     and new.bound_worker_token_id is null
     and new.bound_claim_token is null
     and new.consumed_at is null
     and new.claim_count = old.claim_count
     and new.recovery_count = 1
     and new.recovered_at is not null
     and new.expires_at > new.recovered_at
     and new.expires_at <= new.recovered_at + interval '1 hour'
     and current_setting(
       'sellerpilot.coupang_exact_price_repair_permit_recover', true
     ) = old.repair_job_id::text
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = old.repair_job_id
          and job.provider_mutation_started_at is null
          and job.completed_at is null
          and job.response_payload is null
          and job.error_message is null
          and (
            (old.bound_at is null
              and old.bound_worker_token_id is null
              and old.bound_claim_token is null
              and old.expires_at <= clock_timestamp()
              and job.status = 'queued'
              and job.worker_token_id is null
              and job.claim_token is null
              and job.lease_expires_at is null
              and job.started_at is null
              and job.attempt_count = old.claim_count)
            or
            (old.bound_at is not null
              and old.bound_worker_token_id = old.worker_token_id
              and old.bound_claim_token is not null
              and job.status = 'running'
              and job.worker_token_id = old.bound_worker_token_id
              and job.claim_token = old.bound_claim_token
              and job.lease_expires_at <= clock_timestamp()
              and job.attempt_count = old.claim_count)
          )
     ) then
    return new;
  end if;
  raise exception 'COUPANG_EXACT_PRICE_REPAIR_PERMIT_TRANSITION_INVALID'
    using errcode = '55000';
end
$$;

create trigger guard_coupang_exact_price_repair_permit
before insert or update or delete
on sellerpilot_private.coupang_exact_price_repair_permits
for each row execute function
sellerpilot_private.guard_coupang_exact_price_repair_permit();

create function sellerpilot_private.guard_coupang_exact_price_repair_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_marked boolean := false;
  new_marked boolean := false;
  preprovider_rearm boolean := false;
begin
  if tg_op <> 'INSERT' then
    old_marked := coalesce((old.request_payload#>'{arguments}')
      ? 'sellerpilotCoupangExactPriceRepair', false);
  end if;
  new_marked := coalesce((new.request_payload#>'{arguments}')
      ? 'sellerpilotCoupangExactPriceRepair', false);
  if not old_marked and not new_marked then return new; end if;
  if tg_op = 'UPDATE' then
    preprovider_rearm := old.status = 'running'
      and new.status = 'queued'
      and current_setting(
        'sellerpilot.coupang_exact_price_repair_job_rearm', true
      ) = old.id::text
      and old.provider_mutation_started_at is null
      and new.provider_mutation_started_at is null
      and old.completed_at is null and new.completed_at is null
      and old.response_payload is null and new.response_payload is null
      and old.error_message is null and new.error_message is null
      and old.worker_token_id is not null
      and old.claim_token is not null
      and old.lease_expires_at <= clock_timestamp()
      and new.worker_token_id is null
      and new.claim_token is null
      and new.lease_expires_at is null
      and new.started_at is null
      and new.attempt_count = old.attempt_count
      and exists (
        select 1
          from sellerpilot_private.coupang_exact_price_repair_permits permit
         where permit.repair_job_id = old.id
           and permit.bound_at is null
           and permit.bound_worker_token_id is null
           and permit.bound_claim_token is null
           and permit.consumed_at is null
           and permit.recovery_count = 1
           and permit.claim_count = old.attempt_count
           and permit.expires_at > clock_timestamp()
      );
  end if;
  if sellerpilot_private.coupang_exact_price_repair_job_matches(new)
       is not true
     or (tg_op = 'INSERT' and current_setting(
       'sellerpilot.coupang_exact_price_repair_enqueue', true
     ) is distinct from new.id::text)
     or (tg_op = 'UPDATE' and (
       not old_marked
       or new.id is distinct from old.id
       or new.credential_id is distinct from old.credential_id
       or new.attempt_id is distinct from old.attempt_id
       or new.listing_id is distinct from old.listing_id
       or new.channel is distinct from old.channel
       or new.operation is distinct from old.operation
       or new.environment is distinct from old.environment
       or new.request_payload is distinct from old.request_payload
       or new.created_by is distinct from old.created_by
       or new.seller_account_key is distinct from old.seller_account_key
       or new.write_resource_kind is distinct from old.write_resource_kind
       or new.write_resource_key is distinct from old.write_resource_key
       or new.request_fingerprint is distinct from old.request_fingerprint
       or (old.status in ('succeeded','failed','cancelled','reconciliation_required')
         and new.status is distinct from old.status)
       or (old.status = 'running' and new.status = 'queued'
         and not preprovider_rearm)
       or (old.provider_mutation_started_at is not null
         and new.provider_mutation_started_at is distinct from
           old.provider_mutation_started_at)
     )) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_JOB_LINEAGE_INVALID'
      using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function
sellerpilot_private.guard_coupang_exact_price_repair_permit(),
sellerpilot_private.guard_coupang_exact_price_repair_job()
from public, anon, authenticated, service_role;

create trigger coupang_exact_price_repair_job_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
sellerpilot_private.guard_coupang_exact_price_repair_job();

create function sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_price_repair_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.repair_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.repair_attempt_id
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
      join sellerpilot_private.products product
        on product.id = permit.product_id
      join sellerpilot_private.product_registration_drafts draft
        on draft.owner_id = permit.seller_owner_id
       and draft.kind = 'publish'
       and draft.draft_id = permit.draft_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
      join sellerpilot_private.local_channel_executor_routes route
        on route.id = permit.source_route_id
      join sellerpilot_private.ai_cli_worker_tokens worker
        on worker.id = permit.worker_token_id
     where permit.repair_job_id = p_job_id
       and permit.expires_at > clock_timestamp()
       and sellerpilot_private.coupang_exact_price_repair_job_matches(job)
       and encode(extensions.digest(job.request_payload::text,'sha256'),'hex')
         = permit.request_payload_sha256
       and octet_length(job.request_payload::text) = permit.request_payload_bytes
       and job.attempt_id = attempt.id
       and job.credential_id = credential.id
       and job.listing_id = listing.id
       and job.seller_account_key = permit.seller_account_key
       and job.credential_refresh_in_flight is false
       and job.credential_refresh_recovery_vault_id is null
       and job.prepared_credential_id is null
       and job.oauth_exchange_completed is false
       and attempt.owner_id = permit.seller_owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.channel = 'coupang'
       and attempt.operation = 'price.update'
       and attempt.status = 'running'
       and attempt.remote_id is null
       and attempt.completed_at is null
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = permit.request_payload_sha256
       and listing.owner_id = permit.seller_owner_id
       and listing.product_id = permit.product_id
       and listing.channel_key = 'coupang'
       and listing.seller_account_key = permit.seller_account_key
       and listing.remote_id = permit.seller_product_id
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.remote_visibility = 'live'
       and listing.remote_resources#>>'{resources,sellerProductId}'
         = permit.seller_product_id
       and listing.remote_resources#>'{resources,vendorItemIds}'
         = jsonb_build_array(permit.vendor_item_id)
       and listing.currency = permit.currency
       and listing.price = permit.desired_price
       and product.owner_id = permit.seller_owner_id
       and product.sku = permit.sku
       and product.on_hand = permit.observed_stock
       and not product.demo
       and product.status <> 'archived'
       and draft.product_id = permit.product_id
       and draft.version = permit.draft_version
       and encode(extensions.digest(draft.data::text,'sha256'),'hex')
         = permit.draft_data_sha256
       and credential.created_by = permit.credential_owner_id
       and credential.channel = 'coupang'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.last_checked_at = permit.credential_last_checked_at
       and credential.last_check_status = 'passed'
       and worker.id = permit.worker_token_id
       and worker.scope = 'gateway'
       and worker.status = 'active'
       and worker.expires_at > clock_timestamp()
       and worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
       and worker.last_version = 'sellerpilot-cli-worker/1.61+'
         || permit.release_sha || '.' || left(permit.egress_ip_sha256,11)
       and route.owner_id = permit.seller_owner_id
       and route.channel = 'coupang'
       and route.operation in (
         'categories.attributes','categories.validate','listing.create'
       )
       and route.credential_id = permit.credential_id
       and route.seller_account_key = permit.seller_account_key
       and route.worker_token_id = permit.worker_token_id
       and route.release_sha = permit.release_sha
       and route.egress_ip_sha256 = permit.egress_ip_sha256
       and route.enabled
       and route.approved_at <= clock_timestamp()
       and route.expires_at > clock_timestamp()
       and sellerpilot_private.local_channel_executor_route_is_current(
         permit.seller_owner_id,route.channel,route.operation,
         permit.credential_id,permit.worker_token_id,permit.release_sha,
         permit.egress_ip_sha256,worker.last_version
       )
       and sellerpilot_private.active_serverless_runtime_release_sha()
         = permit.release_sha
       and sellerpilot_private.listing_mutation_release_gate_is_effective(
         'coupang'
       )
       and sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
         permit.source_job_id
       )
       and not exists (
         select 1
           from sellerpilot_private.coupang_exact_live_verify_receipts receipt
          where receipt.verifier_job_id = permit.verifier_job_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = permit.seller_owner_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = permit.credential_owner_id
       )
       and exists (
         select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = route.approved_by
       )
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)
from public, anon, authenticated, service_role;

create function
sellerpilot_private.coupang_exact_price_repair_local_claim_allowed(
  p_job_id uuid,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_price_repair_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.repair_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.repair_attempt_id
      join sellerpilot_private.local_channel_executor_routes route
        on route.id = permit.source_route_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
      join sellerpilot_private.ai_cli_worker_tokens worker
        on worker.id = permit.worker_token_id
     where permit.repair_job_id = p_job_id
       and sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
         p_job_id
       )
       and permit.credential_id = p_credential_id
       and permit.worker_token_id = p_worker_token_id
       and permit.worker_token_id =
         '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
       and permit.release_sha = p_release_sha
       and permit.egress_ip_sha256 = p_egress_ip_sha256
       and permit.egress_ip_sha256 =
         '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
       and p_worker_version = 'sellerpilot-cli-worker/1.61+'
         || permit.release_sha || '.' || left(permit.egress_ip_sha256, 11)
       and permit.bound_at is null and permit.consumed_at is null
       and permit.claim_count < 2
       and permit.expires_at > clock_timestamp()
       and sellerpilot_private.coupang_exact_price_repair_job_matches(job)
       and job.status = 'queued'
       and job.attempt_count = permit.claim_count
       and job.worker_token_id is null and job.claim_token is null
       and job.lease_expires_at is null and job.started_at is null
       and job.completed_at is null and job.response_payload is null
       and job.error_message is null
       and job.provider_mutation_started_at is null
       and attempt.id = job.attempt_id
       and attempt.status = 'running'
       and attempt.operation = 'price.update'
       and attempt.owner_id = permit.seller_owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = job.request_fingerprint
       and credential.id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
       and credential.channel = 'coupang'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.last_checked_at = permit.credential_last_checked_at
       and credential.last_check_status = 'passed'
       and worker.id = p_worker_token_id
       and worker.scope = 'gateway' and worker.status = 'active'
       and worker.expires_at > clock_timestamp()
       and worker.last_seen_at >= clock_timestamp() - interval '3 minutes'
       and worker.last_version = p_worker_version
       and route.owner_id = permit.seller_owner_id
       and route.channel = 'coupang'
       and route.operation in (
         'categories.attributes','categories.validate','listing.create'
       )
       and route.credential_id = permit.credential_id
       and route.seller_account_key = permit.seller_account_key
       and route.worker_token_id = permit.worker_token_id
       and route.release_sha = permit.release_sha
       and route.egress_ip_sha256 = permit.egress_ip_sha256
       and route.enabled and route.expires_at > clock_timestamp()
       and sellerpilot_private.local_channel_executor_route_is_current(
         permit.seller_owner_id, route.channel, route.operation,
         permit.credential_id, permit.worker_token_id, permit.release_sha,
         permit.egress_ip_sha256, p_worker_version
       )
       and sellerpilot_private.active_serverless_runtime_release_sha()
         = permit.release_sha
       and sellerpilot_private.listing_mutation_release_gate_is_effective(
         'coupang'
       )
       and sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
         permit.source_job_id
       )
       and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex')
         = permit.request_payload_sha256
       and octet_length(job.request_payload::text)
         = permit.request_payload_bytes
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_local_claim_allowed(
  uuid,uuid,uuid,text,text,text
) from public, anon, authenticated, service_role;

alter function sellerpilot_private.local_channel_executor_job_allowed(
  uuid,uuid,uuid,text,text,text
) rename to local_channel_executor_job_allowed_before_coupang_price_repair;

create function sellerpilot_private.local_channel_executor_job_allowed(
  p_job_id uuid,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.coupang_exact_price_repair_local_claim_allowed(
      p_job_id,p_credential_id,p_worker_token_id,p_worker_version,
      p_release_sha,p_egress_ip_sha256
    )
    or sellerpilot_private.local_channel_executor_job_allowed_before_coupang_price_repair(
      p_job_id,p_credential_id,p_worker_token_id,p_worker_version,
      p_release_sha,p_egress_ip_sha256
    ),
    false
  )
$$;

revoke all on function
sellerpilot_private.local_channel_executor_job_allowed(
  uuid,uuid,uuid,text,text,text
),
sellerpilot_private.local_channel_executor_job_allowed_before_coupang_price_repair(
  uuid,uuid,uuid,text,text,text
) from public, anon, authenticated, service_role;

create function sellerpilot_private.bind_coupang_exact_price_repair_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  permit sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
  worker_version text;
begin
  if old.status <> 'queued' or new.status <> 'running'
     or sellerpilot_private.coupang_exact_price_repair_job_matches(new)
       is not true then
    return new;
  end if;
  select candidate.* into strict permit
    from sellerpilot_private.coupang_exact_price_repair_permits candidate
   where candidate.repair_job_id = new.id
   for update;
  worker_version := 'sellerpilot-cli-worker/1.61+' || permit.release_sha
    || '.' || left(permit.egress_ip_sha256, 11);
  if new.worker_token_id is distinct from permit.worker_token_id
     or new.claim_token is null
     or new.attempt_count <> permit.claim_count + 1
     or new.attempt_count not between 1 and 2
     or new.started_at is null or new.lease_expires_at <= clock_timestamp()
     or permit.bound_at is not null or permit.consumed_at is not null
     or permit.expires_at <= clock_timestamp()
     or not sellerpilot_private.local_channel_executor_route_is_current(
       permit.seller_owner_id,
       (select route.channel from sellerpilot_private.local_channel_executor_routes route
         where route.id = permit.source_route_id),
       (select route.operation from sellerpilot_private.local_channel_executor_routes route
         where route.id = permit.source_route_id),
       permit.credential_id,permit.worker_token_id,permit.release_sha,
       permit.egress_ip_sha256,worker_version
     )
     or sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from permit.release_sha
     or sellerpilot_private.listing_mutation_release_gate_is_effective('coupang')
       is not true then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_CLAIM_INVALID'
      using errcode = '55000';
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_price_repair_permit_bind', new.id::text, true
  );
  update sellerpilot_private.coupang_exact_price_repair_permits candidate
     set bound_at = clock_timestamp(),
         bound_worker_token_id = new.worker_token_id,
         bound_claim_token = new.claim_token,
         claim_count = candidate.claim_count + 1
   where candidate.permit_id = permit.permit_id;
  return new;
end
$$;

revoke all on function
sellerpilot_private.bind_coupang_exact_price_repair_claim()
from public, anon, authenticated, service_role;

create trigger bind_coupang_exact_price_repair_claim
after update of status on sellerpilot_private.channel_gateway_jobs
for each row execute function
sellerpilot_private.bind_coupang_exact_price_repair_claim();

create function sellerpilot_private.coupang_exact_price_repair_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.coupang_exact_price_repair_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.repair_job_id
      join sellerpilot_private.local_channel_executor_routes route
        on route.id = permit.source_route_id
     where permit.repair_job_id = p_job_id
       and sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
         p_job_id
       )
       and permit.bound_at is not null
       and permit.bound_worker_token_id = permit.worker_token_id
       and permit.bound_claim_token = p_claim_token
       and permit.consumed_at is null
       and permit.expires_at > clock_timestamp()
       and job.status = 'running'
       and job.claim_token = p_claim_token
       and job.worker_token_id = permit.worker_token_id
       and job.lease_expires_at > clock_timestamp()
       and job.provider_mutation_started_at is null
       and sellerpilot_private.coupang_exact_price_repair_job_matches(job)
       and route.enabled and route.expires_at > clock_timestamp()
       and route.release_sha = permit.release_sha
       and route.egress_ip_sha256 = permit.egress_ip_sha256
       and sellerpilot_private.active_serverless_runtime_release_sha()
         = permit.release_sha
       and sellerpilot_private.listing_mutation_release_gate_is_effective(
         'coupang'
       )
       and sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
         permit.source_job_id
       )
       and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex')
         = permit.request_payload_sha256
  ), false)
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_provider_allowed(uuid,uuid)
from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_begin_gateway_before_coupang_price_repair;

revoke all on function
public.sellerpilot_begin_gateway_before_coupang_price_repair(text,uuid,uuid)
from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_exact boolean;
  started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(1637578093, 8072053);
  select exists (
    select 1 from sellerpilot_private.coupang_exact_price_repair_permits permit
     where permit.repair_job_id = p_job_id
  ) into is_exact;
  if not is_exact then
    return public.sellerpilot_begin_gateway_before_coupang_price_repair(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if sellerpilot_private.coupang_exact_price_repair_provider_allowed(
       p_job_id,p_claim_token
     ) is not true then return false; end if;
  started := public.sellerpilot_begin_gateway_before_coupang_price_repair(
    p_token_hash,p_job_id,p_claim_token
  );
  if not coalesce(started,false) then return false; end if;
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_price_repair_permit_consume',
    p_job_id::text,true
  );
  update sellerpilot_private.coupang_exact_price_repair_permits permit
     set consumed_at = clock_timestamp()
   where permit.repair_job_id = p_job_id
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null;
  if not found then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_PERMIT_CONSUMPTION_FAILED'
      using errcode = '40001';
  end if;
  return true;
end
$$;

revoke all on function
public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function
public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
to service_role;

create function sellerpilot_private.validate_coupang_exact_price_repair_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  permit sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
begin
  if sellerpilot_private.coupang_exact_price_repair_job_matches(new)
       is not true then return null; end if;
  select candidate.* into permit
    from sellerpilot_private.coupang_exact_price_repair_permits candidate
   where candidate.repair_job_id = new.id;
  if permit.permit_id is null
     or permit.repair_attempt_id is distinct from new.attempt_id
     or permit.request_payload_sha256 is distinct from encode(
       extensions.digest(new.request_payload::text, 'sha256'),'hex'
     )
     or permit.request_payload_bytes <> octet_length(new.request_payload::text)
     or (new.status = 'queued' and (
       permit.bound_at is not null or permit.consumed_at is not null
       or new.provider_mutation_started_at is not null
       or new.attempt_count <> permit.claim_count
     ))
     or (new.status = 'running' and new.provider_mutation_started_at is null
       and (permit.bound_at is null or permit.consumed_at is not null
         or new.attempt_count <> permit.claim_count))
     or (new.provider_mutation_started_at is not null and (
       permit.bound_at is null or permit.consumed_at is null
     )) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_DEFERRED_LINEAGE_INVALID'
      using errcode = '55000';
  end if;
  return null;
end
$$;

revoke all on function
sellerpilot_private.validate_coupang_exact_price_repair_job()
from public, anon, authenticated, service_role;

create constraint trigger validate_coupang_exact_price_repair_job
after insert or update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function
sellerpilot_private.validate_coupang_exact_price_repair_job();

create function sellerpilot_private.coupang_exact_price_repair_succeeded(
  job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.coupang_exact_price_repair_job_matches(job)
    and job.status = 'succeeded'
    and job.provider_mutation_started_at is not null
    and job.completed_at is not null
    and job.error_message is null
    and job.response_payload#>'{ok}' = 'true'::jsonb
    and job.response_payload#>>'{channel}' = 'coupang'
    and job.response_payload#>>'{operation}' = 'price.update'
    and job.response_payload#>>'{remoteId}' = '96027942778'
    and jsonb_array_length(case
      when jsonb_typeof(job.response_payload#>'{steps}') = 'array'
        then job.response_payload#>'{steps}'
      else '[]'::jsonb
    end) = 2
    and job.response_payload#>>'{steps,0,name}' = 'price'
    and job.response_payload#>'{steps,0,ok}' = 'true'::jsonb
    and job.response_payload#>>'{steps,1,name}' = 'price-readback'
    and job.response_payload#>'{steps,1,ok}' = 'true'::jsonb
    and job.response_payload#>>'{steps,1,data,sellerpilotVendorItemId}' =
      '96027942778'
    and job.response_payload#>'{steps,1,data,sellerpilotRequestedPrice}' =
      '3190'::jsonb
    and job.response_payload#>'{steps,1,data,sellerpilotObservedPrice}' =
      '3190'::jsonb
    and job.response_payload#>>'{steps,1,data,sellerpilotCurrency}' = 'KRW'
    and job.response_payload#>>'{steps,1,data,sellerpilotVerification}' =
      'COUPANG_VENDOR_ITEM_PRICE_VERIFIED',
    false
  )
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_succeeded(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_exact_coupang_price_repair(
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  draft sellerpilot_private.product_registration_drafts%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  route sellerpilot_private.local_channel_executor_routes%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  existing sellerpilot_private.coupang_exact_price_repair_permits%rowtype;
  existing_job sellerpilot_private.channel_gateway_jobs%rowtype;
  attempt_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  now_at timestamptz := clock_timestamp();
  rearmed boolean := false;
  payload jsonb;
  marker jsonb;
  request_sha text;
  request_bytes integer;
  resource_key text;
  recovery_reason text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')
       <> 'service_role' then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if coalesce(p_release_sha,'') !~ '^[a-f0-9]{40}$' then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_RELEASE_INVALID'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(1637578093, 8072053);
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  select candidate.* into existing
    from sellerpilot_private.coupang_exact_price_repair_permits candidate
   where candidate.source_job_id =
     '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
   for update;
  if existing.permit_id is not null then
    select * into strict existing_job
      from sellerpilot_private.channel_gateway_jobs
     where id = existing.repair_job_id
     for update;
    if existing.release_sha is distinct from p_release_sha
       or sellerpilot_private.coupang_exact_price_repair_job_matches(existing_job)
         is not true
       or encode(extensions.digest(existing_job.request_payload::text,'sha256'),'hex')
         <> existing.request_payload_sha256
       or not exists (
         select 1 from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = existing.repair_attempt_id
            and attempt.operation = 'price.update'
            and attempt.request_fingerprint = existing_job.request_fingerprint
       ) then
      raise exception 'COUPANG_EXACT_PRICE_REPAIR_REPLAY_DRIFT'
        using errcode = '55000';
    end if;

    if existing.consumed_at is null
       and existing_job.provider_mutation_started_at is null
       and (
         (existing_job.status = 'queued'
           and existing.bound_at is null
           and existing_job.worker_token_id is null
           and existing_job.claim_token is null
           and existing_job.lease_expires_at is null
           and existing_job.started_at is null
           and existing_job.attempt_count = existing.claim_count
           and existing.expires_at <= now_at)
         or
         (existing_job.status = 'running'
           and existing.bound_at is not null
           and existing.bound_worker_token_id = existing.worker_token_id
           and existing.bound_claim_token = existing_job.claim_token
           and existing_job.worker_token_id = existing.worker_token_id
           and existing_job.lease_expires_at <= now_at
           and existing_job.completed_at is null
           and existing_job.response_payload is null
           and existing_job.error_message is null
           and existing_job.attempt_count = existing.claim_count)
       ) then
      if existing.recovery_count <> 0 then
        raise exception 'COUPANG_EXACT_PRICE_REPAIR_RECOVERY_EXHAUSTED'
          using errcode = '55000';
      end if;
      recovery_reason := case existing_job.status
        when 'queued' then 'permit_expired_before_claim'
        else 'claim_lease_expired_before_provider'
      end;
      perform pg_catalog.set_config(
        'sellerpilot.coupang_exact_price_repair_permit_recover',
        existing.repair_job_id::text,true
      );
      update sellerpilot_private.coupang_exact_price_repair_permits permit
         set expires_at = now_at + interval '1 hour',
             recovery_count = permit.recovery_count + 1,
             recovered_at = now_at,
             bound_at = null,
             bound_worker_token_id = null,
             bound_claim_token = null
       where permit.permit_id = existing.permit_id
      returning * into strict existing;
      if sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(
           existing.repair_job_id
         ) is not true then
        raise exception 'COUPANG_EXACT_PRICE_REPAIR_RECOVERY_PREIMAGE_REJECTED'
          using errcode = '55000';
      end if;
      if existing_job.status = 'running' then
        perform pg_catalog.set_config(
          'sellerpilot.coupang_exact_price_repair_job_rearm',
          existing.repair_job_id::text,true
        );
        update sellerpilot_private.channel_gateway_jobs job
           set status = 'queued',
               worker_token_id = null,
               claim_token = null,
               lease_expires_at = null,
               started_at = null,
               updated_at = now_at
         where job.id = existing.repair_job_id;
      end if;
      select * into strict existing_job
        from sellerpilot_private.channel_gateway_jobs
       where id = existing.repair_job_id;
      insert into sellerpilot_private.operation_audit(
        owner_id,action,entity_type,entity_id,safe_detail
      ) values (
        existing.seller_owner_id,'coupang_exact_price_repair_rearmed',
        'channel_gateway_job',existing.repair_job_id::text,jsonb_build_object(
          'contract','coupang_exact_price_repair_recovery_v1',
          'reason',recovery_reason,
          'sourceJobId',existing.source_job_id,
          'verifierJobId',existing.verifier_job_id,
          'attemptId',existing.repair_attempt_id,
          'jobId',existing.repair_job_id,
          'claimCount',existing.claim_count,
          'recoveryCount',existing.recovery_count,
          'releaseSha',existing.release_sha,
          'providerMutationStarted',false,
          'permitConsumed',false,
          'providerMutationPerformed',false
        )
      );
      rearmed := true;
    end if;

    if existing.consumed_at is null
       and existing_job.provider_mutation_started_at is null
       and (
         (existing_job.status = 'queued' and existing.expires_at <= now_at)
         or (existing_job.status = 'running'
           and existing_job.lease_expires_at <= now_at)
       ) then
      raise exception 'COUPANG_EXACT_PRICE_REPAIR_RECOVERY_EXHAUSTED'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract','coupang_exact_price_repair_enqueue_v1',
      'status',existing_job.status,
      'attemptId',existing.repair_attempt_id,
      'jobId',existing.repair_job_id,
      'reused',true,
      'rearmed',rearmed,
      'recoveryReason',case when rearmed then recovery_reason else null end,
      'providerMutationStarted',existing_job.provider_mutation_started_at is not null,
      'permitConsumed',existing.consumed_at is not null,
      'providerMutationPerformed',
        existing.consumed_at is not null
        and sellerpilot_private.coupang_exact_price_repair_succeeded(existing_job)
    );
  end if;

  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid for update;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid for share;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid for update;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid for update;
  select * into strict product
    from sellerpilot_private.products
   where id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid for share;
  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid for share;
  select * into strict draft
    from sellerpilot_private.product_registration_drafts
   where owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and kind = 'publish'
     and draft_id = '2e868857-5868-4665-8304-978b431f7f00'::uuid
   for share;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = source_job.id for share;
  select * into strict worker
    from sellerpilot_private.ai_cli_worker_tokens
   where id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid for share;
  select candidate.* into route
    from sellerpilot_private.local_channel_executor_routes candidate
   where candidate.owner_id = listing.owner_id
     and candidate.channel = 'coupang'
     and candidate.operation in (
       'categories.attributes','categories.validate','listing.create'
     )
     and candidate.credential_id = credential.id
     and candidate.seller_account_key = listing.seller_account_key
     and candidate.worker_token_id = worker.id
     and candidate.release_sha = p_release_sha
     and candidate.egress_ip_sha256 =
       '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
     and candidate.enabled
     and candidate.approved_at <= now_at
     and candidate.expires_at > now_at
   order by candidate.approved_at desc,candidate.id desc limit 1 for share;

  if source_job.status <> 'reconciliation_required'
     or source_job.channel <> 'coupang'
     or source_job.operation <> 'listing.create'
     or source_job.attempt_id <> source_attempt.id
     or source_job.listing_id <> listing.id
     or source_job.credential_id <> credential.id
     or source_job.created_by <>
       '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     or source_job.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or source_job.request_fingerprint <>
       'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
     or (source_job.request_payload#>>'{arguments,body,items,0,salePrice}')::integer
       <> 3190
     or source_attempt.status <> 'manual_required'
     or source_attempt.owner_id <> listing.owner_id
     or source_attempt.remote_id <> '16375780938'
     or verifier.status <> 'reconciliation_required'
     or verifier.operation <> 'listing.publication.verify'
     or verifier.listing_id <> listing.id
     or verifier.response_payload#>>'{steps,1,data,data,salePrice}' <> '6000'
     or sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
       source_job.id
     ) is not true
     or adjudication.decision <> 'provider_live_price_drift'
     or adjudication.contract <>
       'coupang_exact_live_price_drift_adjudication_v1'
     or adjudication.remote_id <> '16375780938'
     or adjudication.vendor_item_ids <> '["96027942778"]'::jsonb
     or adjudication.source_price <> 3190
     or adjudication.observed_price <> 6000
     or adjudication.observed_stock <> 1
     or not adjudication.provider_live_verified
     or adjudication.exact_content_verified
     or adjudication.buyer_visible_verified
     or adjudication.provider_mutation_performed
     or listing.owner_id <>
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or listing.product_id <> product.id
     or listing.channel_key <> 'coupang'
     or listing.remote_id <> '16375780938'
     or listing.status <> 'failed'
     or listing.failure_class <> 'external_action'
     or listing.remote_visibility <> 'live'
     or listing.remote_resources#>>'{resources,sellerProductId}' <>
       '16375780938'
     or listing.remote_resources#>'{resources,vendorItemIds}' <>
       '["96027942778"]'::jsonb
     or listing.remote_resources#>>'{verification,sourcePrice}' <> '3190'
     or listing.remote_resources#>>'{verification,observedPrice}' <> '6000'
     or listing.remote_resources#>>'{verification,observedStock}' <> '1'
     or listing.remote_resources#>>'{verification,decision}' <>
       'provider_live_price_drift'
     or listing.currency <> 'KRW' or listing.price <> 3190
     or product.owner_id <> listing.owner_id
     or product.sku <> 'AUTO-780720401E2D4E4EA45F'
     or product.on_hand <> 1 or product.demo or product.status = 'archived'
     or draft.product_id <> product.id or draft.version <> 13
     or jsonb_typeof(draft.data) <> 'object'
     or credential.created_by <> source_job.created_by
     or credential.channel <> 'coupang'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or credential.seller_account_key is distinct from listing.seller_account_key
     or credential.seller_account_key_source not in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     or credential.seller_account_verified_at is null
     or credential.last_checked_at is null
     or credential.last_check_status <> 'passed'
     or (credential.expires_at is not null and credential.expires_at <= now_at)
     or worker.scope <> 'gateway' or worker.status <> 'active'
     or worker.expires_at <= now_at
     or worker.last_seen_at < now_at - interval '3 minutes'
     or worker.last_version <> 'sellerpilot-cli-worker/1.61+'
       || p_release_sha || '.92b235ca02d'
     or route.id is null
     or sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from p_release_sha
     or sellerpilot_private.listing_mutation_release_gate_is_effective('coupang')
       is not true
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = listing.owner_id
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = credential.created_by
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users admin
        where admin.user_id = route.approved_by
     )
     or exists (
       select 1 from sellerpilot_private.coupang_exact_live_verify_receipts receipt
        where receipt.verifier_job_id = verifier.id
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = listing.id
          and active_job.id not in (source_job.id,verifier.id)
          and active_job.operation in (
            'listing.create','listing.update','listing.stop','listing.activate',
            'price.update','inventory.update','listing.lineage.verify',
            'listing.publication.verify'
          )
          and active_job.status in ('queued','running','reconciliation_required')
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs marked_job
        where coalesce((marked_job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangExactPriceRepair',false)
     ) then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_PREIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  if sellerpilot_private.local_channel_executor_route_is_current(
       listing.owner_id,route.channel,route.operation,credential.id,worker.id,
       p_release_sha,route.egress_ip_sha256,worker.last_version
     ) is not true then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_ROUTE_NOT_CURRENT'
      using errcode = '55000';
  end if;

  marker := jsonb_build_object(
    'contract','coupang_exact_price_repair_v1',
    'sourceJobId',source_job.id,
    'sourceAttemptId',source_attempt.id,
    'verifierJobId',verifier.id,
    'productId',product.id,
    'draftId',draft.draft_id,
    'draftVersion',draft.version,
    'sourceRequestFingerprint',source_job.request_fingerprint,
    'sellerProductId','16375780938',
    'vendorItemId','96027942778',
    'observedPrice',6000,
    'desiredPrice',3190,
    'workerTokenId',worker.id,
    'releaseSha',p_release_sha,
    'egressIpSha256',route.egress_ip_sha256,
    'adjudicationSha256',adjudication.adjudication_sha256
  );
  payload := jsonb_build_object(
    'periodicKey',
      'coupang-exact-price-repair:v1:25adf712-1e9a-432b-8b0d-09cf35a826c5',
    'arguments',jsonb_build_object(
      'vendorItemId','96027942778',
      'sellerProductId','16375780938',
      'price',3190,
      'forceSalePriceUpdate',true,
      'currency','KRW',
      'sellerpilotCoupangExactPriceRepair',marker
    )
  );
  request_sha := encode(extensions.digest(payload::text,'sha256'),'hex');
  request_bytes := octet_length(payload::text);
  resource_key := encode(extensions.digest(
    convert_to('coupang','UTF8') || decode('00','hex')
      || convert_to('listing_mutation','UTF8') || decode('00','hex')
      || convert_to(listing.id::text,'UTF8'),
    'sha256'
  ),'hex');

  insert into sellerpilot_private.channel_operation_attempts (
    id,owner_id,credential_id,channel,operation,idempotency_key,
    request_fingerprint,status,gateway_write_required,pre_gateway_retryable,
    seller_account_key,created_at,started_at
  ) values (
    attempt_id,listing.owner_id,credential.id,'coupang','price.update',
    'exact-coupang-price-repair:25adf712-1e9a-432b-8b0d-09cf35a826c5',
    request_sha,'running',true,false,listing.seller_account_key,now_at,now_at
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_price_repair_enqueue',job_id::text,true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,created_by,
    write_resource_kind,write_resource_key,created_at,updated_at
  ) values (
    job_id,credential.id,attempt_id,listing.id,'coupang','price.update',
    'production',payload,'queued',listing.seller_account_key,request_sha,
    credential.created_by,'listing_mutation',resource_key,now_at,now_at
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_price_repair_permit_insert',job_id::text,true
  );
  insert into sellerpilot_private.coupang_exact_price_repair_permits (
    source_job_id,source_attempt_id,verifier_job_id,listing_id,product_id,
    draft_id,draft_version,draft_data_sha256,credential_id,seller_owner_id,
    credential_owner_id,seller_account_key,seller_product_id,vendor_item_id,
    sku,currency,source_price,observed_price,desired_price,observed_stock,
    source_request_fingerprint,adjudication_sha256,credential_version,
    credential_fingerprint,credential_verified_at,
    credential_last_checked_at,source_route_id,worker_token_id,release_sha,
    egress_ip_sha256,repair_attempt_id,repair_job_id,
    request_payload_sha256,request_payload_bytes,armed_at,expires_at,contract
  ) values (
    source_job.id,source_attempt.id,verifier.id,listing.id,product.id,
    draft.draft_id,draft.version,
    encode(extensions.digest(draft.data::text,'sha256'),'hex'),credential.id,
    listing.owner_id,credential.created_by,listing.seller_account_key,
    '16375780938','96027942778',product.sku,'KRW',3190,6000,3190,1,
    source_job.request_fingerprint,adjudication.adjudication_sha256,
    credential.version,credential.fingerprint,
    credential.seller_account_verified_at,credential.last_checked_at,
    route.id,worker.id,p_release_sha,route.egress_ip_sha256,attempt_id,job_id,
    request_sha,request_bytes,now_at,now_at + interval '1 hour',
    'coupang_exact_price_repair_permit_v1'
  );

  insert into sellerpilot_private.operation_audit(
    owner_id,action,entity_type,entity_id,safe_detail
  ) values (
    listing.owner_id,'coupang_exact_price_repair_enqueued',
    'channel_gateway_job',job_id::text,jsonb_build_object(
      'contract','coupang_exact_price_repair_enqueue_v1',
      'sourceJobId',source_job.id,'verifierJobId',verifier.id,
      'listingId',listing.id,'sellerProductId','16375780938',
      'vendorItemId','96027942778','observedPrice',6000,
      'desiredPrice',3190,'releaseSha',p_release_sha,
      'egressIpSha256',route.egress_ip_sha256,
      'requestPayloadSha256',request_sha,
      'providerMutationPerformed',false
    )
  );
  return jsonb_build_object(
    'contract','coupang_exact_price_repair_enqueue_v1',
    'status','queued','attemptId',attempt_id,'jobId',job_id,
    'reused',false,'rearmed',false,
    'providerMutationStarted',false,'permitConsumed',false,
    'providerMutationPerformed',false
  );
end
$$;

revoke all on function
public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)
from public, anon, authenticated;
grant execute on function
public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)
to service_role;

do $postflight$
declare
  index_definition text;
  lineage_definition text;
  local_definition text;
  begin_definition text;
begin
  select pg_catalog.pg_get_indexdef(indexrelid) into strict index_definition
    from pg_catalog.pg_index
   where indexrelid =
     'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  ) into strict lineage_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into strict local_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
  ) into strict begin_definition;
  if pg_catalog.strpos(index_definition,
       'coupang_exact_price_repair_job_matches') = 0
     or pg_catalog.strpos(lineage_definition,
       'coupang_exact_price_repair_insert_identity_allowed') = 0
     or pg_catalog.strpos(local_definition,
       'coupang_exact_price_repair_local_claim_allowed') = 0
     or pg_catalog.strpos(begin_definition,
       'coupang_exact_price_repair_provider_allowed') = 0 then
    raise exception 'COUPANG_EXACT_PRICE_REPAIR_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on table sellerpilot_private.coupang_exact_price_repair_permits is
  'One identity-immutable permit for seller product 16375780938/vendor item 96027942778. Repeated enqueue calls reuse one price.update. One pre-provider lease/expiry recovery may rearm that same job; provider start is never rearmed, and retained CREATE/verifier rows are never retried.';

notify pgrst, 'reload schema';
commit;
