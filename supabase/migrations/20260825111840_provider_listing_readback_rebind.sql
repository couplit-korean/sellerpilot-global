-- Rebind legacy OAuth listings only after an account-scoped, read-only
-- provider readback proves the exact remote listing identity. The attestation
-- ledger is immutable; historical attempts, credentials, and gateway rows are
-- never rewritten to manufacture lineage.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_operation_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop', 'listing.lineage.verify',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'inquiries.list', 'inquiries.reply', 'shipment.acknowledge', 'shipment.confirm'
  )) not valid;

create table sellerpilot_private.provider_listing_lineage_attestations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique
    references sellerpilot_private.product_listings(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  gateway_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  channel text not null check (channel in ('qoo10', 'shopee', 'lazada', 'ebay')),
  environment text not null check (environment in ('sandbox', 'production')),
  expected_remote_id text not null check (length(trim(expected_remote_id)) between 1 and 240),
  verified_remote_id text not null check (length(trim(verified_remote_id)) between 1 and 240),
  market text not null check (length(market) <= 80),
  target_id text not null check (length(target_id) <= 160),
  marketplace_sku text check (
    marketplace_sku is null or length(trim(marketplace_sku)) between 1 and 240
  ),
  provider_resource_id text check (
    provider_resource_id is null or length(trim(provider_resource_id)) between 1 and 240
  ),
  evidence_version text not null check (evidence_version = 'provider_listing_readback_v1'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  completion_claim_token_hash text not null
    check (completion_claim_token_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expected_remote_id = verified_remote_id),
  check (
    (channel = 'ebay' and marketplace_sku is not null and provider_resource_id is not null)
    or (channel <> 'ebay' and marketplace_sku is null and provider_resource_id is null)
  )
);

alter table sellerpilot_private.provider_listing_lineage_attestations
  enable row level security;
revoke all on table sellerpilot_private.provider_listing_lineage_attestations
  from public, anon, authenticated, service_role;

-- A lineage readback and any write against the same listing can never be live
-- together. This also folds duplicate verification requests into one job.
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (listing_id)
  where listing_id is not null
    and operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update', 'listing.lineage.verify'
    )
    and status in ('queued', 'running', 'reconciliation_required');

create or replace function sellerpilot_private.guard_provider_listing_lineage_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_marker text := current_setting(
    'sellerpilot.provider_listing_lineage_rebind',
    true
  );
begin
  if tg_op <> 'INSERT' then
    raise exception 'provider listing lineage attestation is immutable';
  end if;
  if v_marker is distinct from new.gateway_job_id::text then
    raise exception 'provider listing lineage attestation requires verified completion';
  end if;

  select j.id, j.listing_id, j.credential_id, j.channel, j.environment,
         j.operation, j.status, j.seller_account_key, j.claim_token,
         j.lease_expires_at
    into v_job
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = new.gateway_job_id
   for update;
  if not found
     or v_job.operation <> 'listing.lineage.verify'
     or v_job.status <> 'running'
     or v_job.claim_token is null
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= clock_timestamp()
     or v_job.listing_id is distinct from new.listing_id
     or v_job.credential_id is distinct from new.credential_id
     or v_job.channel is distinct from new.channel
     or v_job.environment is distinct from new.environment
     or v_job.seller_account_key is distinct from new.seller_account_key then
    raise exception 'live exact lineage verification job required';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_provider_listing_lineage_attestation
  on sellerpilot_private.provider_listing_lineage_attestations;
create trigger guard_provider_listing_lineage_attestation
before insert or update or delete
on sellerpilot_private.provider_listing_lineage_attestations
for each row execute function
  sellerpilot_private.guard_provider_listing_lineage_attestation();

revoke all on function
  sellerpilot_private.guard_provider_listing_lineage_attestation()
  from public, anon, authenticated, service_role;

-- The generic gateway completion RPC must never be able to mark a lineage
-- verification terminal. Only the exact, claim-bound completion RPC below is
-- allowed to do so. An expired read-only lease may still return to the queue.
create or replace function sellerpilot_private.guard_listing_lineage_verification_job_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting(
    'sellerpilot.provider_listing_lineage_rebind',
    true
  );
  v_refreshed_credential record;
begin
  if old.operation <> 'listing.lineage.verify' then
    return new;
  end if;
  if new.operation is distinct from old.operation
     or new.listing_id is distinct from old.listing_id
     or new.channel is distinct from old.channel
     or new.environment is distinct from old.environment
     or new.seller_account_key is distinct from old.seller_account_key then
    raise exception 'lineage verification job snapshot is immutable';
  end if;
  if new.credential_id is distinct from old.credential_id then
    select credential.seller_account_key,
           credential.seller_account_key_source,
           credential.seller_account_verified_at,
           credential.channel,
           credential.environment,
           credential.status
      into v_refreshed_credential
      from sellerpilot_private.channel_credentials credential
     where credential.id = new.credential_id;
    if not (
         (
           old.status = 'running'
           and new.status = 'running'
           and new.prepared_credential_id is not distinct from new.credential_id
         )
         or (
           old.status = 'queued'
           and new.status = 'queued'
           and new.prepared_credential_id is not distinct from old.prepared_credential_id
         )
       )
       or not found
       or v_refreshed_credential.status <> 'active'
       or v_refreshed_credential.channel is distinct from old.channel
       or v_refreshed_credential.environment is distinct from old.environment
       or v_refreshed_credential.seller_account_key_source <> 'provider_certified_v1'
       or v_refreshed_credential.seller_account_verified_at is null
       or v_refreshed_credential.seller_account_key is distinct from old.seller_account_key then
      raise exception 'lineage verification credential refresh mismatch';
    end if;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'queued' and new.status = 'running' then
    return new;
  end if;
  if old.status = 'running'
     and new.status in ('queued', 'failed')
     and old.lease_expires_at is not null
     and old.lease_expires_at <= clock_timestamp()
     and new.claim_token is null
     and new.worker_token_id is null then
    return new;
  end if;
  if old.status = 'running'
     and new.status = 'reconciliation_required'
     and old.lease_expires_at is not null
     and old.lease_expires_at <= clock_timestamp()
     and (
       old.credential_refresh_in_flight
       or old.credential_refresh_recovery_vault_id is not null
     )
     and new.claim_token is null
     and new.worker_token_id is null then
    return new;
  end if;
  if v_marker = old.id::text then
    return new;
  end if;
  raise exception 'dedicated lineage verification completion required';
end;
$$;

drop trigger if exists guard_listing_lineage_verification_job_completion
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_listing_lineage_verification_job_completion
before update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_listing_lineage_verification_job_completion();

revoke all on function
  sellerpilot_private.guard_listing_lineage_verification_job_completion()
  from public, anon, authenticated, service_role;

-- The legacy claim lifecycle already requeues expired read-only work, but a
-- recovery-only token snapshot on this new operation predates that lifecycle's
-- operation vocabulary. Fence it before delegating to the unchanged claim
-- implementation so a possibly rotated refresh token is never retried.
alter function public.sellerpilot_claim_channel_gateway_job(text, text)
  rename to sellerpilot_11840_claim_gateway_unsafe;

create function public.sellerpilot_claim_channel_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'reconciliation_required',
         error_message = 'Credential refresh state requires manual reconciliation.',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where job.operation = 'listing.lineage.verify'
     and job.status = 'running'
     and (job.lease_expires_at is null or job.lease_expires_at <= clock_timestamp())
     and (
       job.credential_refresh_in_flight
       or job.credential_refresh_recovery_vault_id is not null
     );
  return public.sellerpilot_11840_claim_gateway_unsafe(
    p_token_hash,
    p_worker_version
  );
end;
$$;

revoke all on function
  public.sellerpilot_11840_claim_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_claim_channel_gateway_job(text, text)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_claim_channel_gateway_job(text, text)
  to service_role;

-- eBay legacy rows can recover a missing SKU only from the exact historical
-- create job that produced the listing's public remote ID. Any ambiguity is a
-- manual-reconciliation outcome, never a guessed SKU.
create or replace function sellerpilot_private.verified_legacy_ebay_listing_sku(
  p_listing_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with exact_skus as materialized (
    select distinct nullif(trim(j.request_payload#>>'{arguments,sku}'), '') as sku
      from sellerpilot_private.product_listings l
      join sellerpilot_private.channel_gateway_jobs j
        on j.attempt_id = l.operation_attempt_id
       and (j.listing_id is null or j.listing_id = l.id)
     where l.id = p_listing_id
       and l.channel_key = 'ebay'
       and j.channel = 'ebay'
       and j.operation = 'listing.create'
       and j.status = 'succeeded'
       and nullif(trim(j.response_payload->>'remoteId'), '') = trim(l.remote_id)
       and nullif(trim(j.request_payload#>>'{arguments,sku}'), '') is not null
  )
  select min(sku) from exact_skus
  having count(*) = 1
$$;

create or replace function sellerpilot_private.verified_legacy_ebay_provider_resource_id(
  p_listing_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with exact_resources as materialized (
    select distinct nullif(trim(coalesce(
             step#>>'{data,offerId}',
             step#>>'{data,recoveredOfferId}'
           )), '') as resource_id
      from sellerpilot_private.product_listings l
      join sellerpilot_private.channel_gateway_jobs j
        on j.attempt_id = l.operation_attempt_id
       and (j.listing_id is null or j.listing_id = l.id)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(j.response_payload->'steps') = 'array'
          then j.response_payload->'steps' else '[]'::jsonb end
      ) step
     where l.id = p_listing_id
       and l.channel_key = 'ebay'
       and j.channel = 'ebay'
       and j.operation = 'listing.create'
       and j.status = 'succeeded'
       and nullif(trim(j.response_payload->>'remoteId'), '') = trim(l.remote_id)
       and nullif(trim(coalesce(
             step#>>'{data,offerId}',
             step#>>'{data,recoveredOfferId}'
           )), '') is not null
  )
  select min(resource_id) from exact_resources
  having count(*) = 1
$$;

revoke all on function
  sellerpilot_private.verified_legacy_ebay_listing_sku(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.verified_legacy_ebay_provider_resource_id(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the 20260825111830 static backfill proof. The additional branch is
-- reachable only after the immutable provider attestation has been inserted
-- by the dedicated live-claim completion transaction.
create or replace function sellerpilot_private.verified_static_listing_lineage_key(
  p_listing_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider_key text;
  v_marker text := current_setting(
    'sellerpilot.provider_listing_lineage_rebind',
    true
  );
begin
  if nullif(v_marker, '') is not null then
    select attestation.seller_account_key
      into v_provider_key
      from sellerpilot_private.provider_listing_lineage_attestations attestation
     where attestation.listing_id = p_listing_id
       and attestation.gateway_job_id::text = v_marker
       and attestation.evidence_version = 'provider_listing_readback_v1'
       and attestation.expected_remote_id = attestation.verified_remote_id;
    if found then return v_provider_key; end if;
  end if;

  return (
    with exact_candidates as materialized (
      select c.seller_account_key,
             j.id as job_id,
             l.id as listing_id,
             l.operation_attempt_id
        from sellerpilot_private.product_listings l
        join sellerpilot_private.channel_operation_attempts a
          on a.id = l.operation_attempt_id
        join sellerpilot_private.channel_credentials c
          on c.id = a.credential_id
         and c.channel = a.channel
        join sellerpilot_private.channel_gateway_jobs j
          on j.attempt_id = a.id
         and j.credential_id = a.credential_id
         and j.channel = a.channel
         and j.environment = c.environment
       where l.id = p_listing_id
         and l.status = 'published'
         and l.seller_account_key is null
         and l.channel_key in ('coupang', 'elevenst', 'qoo10', 'smartstore')
         and l.channel_key = a.channel
         and a.operation = 'listing.create'
         and a.status = 'succeeded'
         and a.seller_account_key is null
         and nullif(trim(l.remote_id), '') is not null
         and nullif(trim(a.remote_id), '') = trim(l.remote_id)
         and c.seller_account_key is not null
         and c.seller_account_key ~ '^[a-f0-9]{64}$'
         and c.seller_account_key_source = 'credential_incarnation_v1'
         and c.seller_account_verified_at is not null
         and j.operation = 'listing.create'
         and j.status = 'succeeded'
         and j.seller_account_key is null
         and (j.listing_id is null or j.listing_id = l.id)
         and (j.request_fingerprint is null
           or j.request_fingerprint = a.request_fingerprint)
         and nullif(trim(j.response_payload->>'remoteId'), '') = trim(l.remote_id)
         and sellerpilot_private.gateway_listing_create_readback_verified(
           l.channel_key,
           j.response_payload
         )
    ), unambiguous_candidates as (
      select candidate.*
        from exact_candidates candidate
       where not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs other_job
          where other_job.id <> candidate.job_id
            and other_job.operation = 'listing.create'
            and other_job.status = 'succeeded'
            and (
              other_job.attempt_id = candidate.operation_attempt_id
              or other_job.listing_id = candidate.listing_id
            )
       )
    )
    select min(candidate.seller_account_key)
      from unambiguous_candidates candidate
    having count(*) = 1
       and count(distinct candidate.seller_account_key) = 1
  );
end;
$$;

revoke all on function
  sellerpilot_private.verified_static_listing_lineage_key(uuid)
  from public, anon, authenticated, service_role;

-- Prevent even a privileged direct update from filling an eBay SKU outside
-- the exact verification transaction. The normal 11800/11830 listing lineage
-- guard remains installed and performs the final null-to-current-key proof.
create or replace function sellerpilot_private.guard_verified_ebay_listing_sku_recovery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting(
    'sellerpilot.provider_listing_lineage_rebind',
    true
  );
begin
  if old.channel_key <> 'ebay'
     or old.marketplace_sku is not null
     or new.marketplace_sku is null
     or new.marketplace_sku is not distinct from old.marketplace_sku then
    return new;
  end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id::text = v_marker
       and job.id = (
         nullif(current_setting('sellerpilot.provider_listing_lineage_rebind', true), '')
       )::uuid
       and job.listing_id = old.id
       and job.channel = 'ebay'
       and job.operation = 'listing.lineage.verify'
       and job.status = 'running'
       and job.claim_token is not null
       and job.lease_expires_at > clock_timestamp()
       and nullif(trim(job.request_payload#>>'{arguments,marketplaceSku}'), '') =
           trim(new.marketplace_sku)
  ) then
    raise exception 'verified ebay marketplace sku recovery required';
  end if;
  return new;
exception when invalid_text_representation then
  raise exception 'verified ebay marketplace sku recovery required';
end;
$$;

drop trigger if exists guard_verified_ebay_listing_sku_recovery
  on sellerpilot_private.product_listings;
create trigger guard_verified_ebay_listing_sku_recovery
before update on sellerpilot_private.product_listings
for each row execute function
  sellerpilot_private.guard_verified_ebay_listing_sku_recovery();

revoke all on function
  sellerpilot_private.guard_verified_ebay_listing_sku_recovery()
  from public, anon, authenticated, service_role;

-- Supabase sb_secret_* requests assume the service_role database role but do
-- not populate the legacy request.jwt.claim.role GUC. The explicit EXECUTE
-- grants at the end of this migration are therefore the authorization
-- boundary for these SECURITY DEFINER RPCs.
create or replace function public.sellerpilot_service_prepare_listing_lineage_verification(
  p_listing_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listing record;
  v_environment text;
  v_credential record;
  v_ebay_sku text;
begin
  if p_listing_id is null then
    return jsonb_build_object('status', 'manual_required', 'reason', 'listing_not_found');
  end if;

  select l.id, l.owner_id, l.channel_key, l.status, l.remote_id,
         l.market, l.target_id, l.marketplace_sku, l.operation_attempt_id,
         l.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id;
  if not found then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'listing_not_found'
    );
  end if;
  if v_listing.seller_account_key is not null then
    return jsonb_build_object(
      'status', 'already_bound', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market
    );
  end if;
  if v_listing.channel_key not in ('qoo10', 'shopee', 'lazada', 'ebay') then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'unsupported_channel'
    );
  end if;
  if v_listing.status not in ('published', 'paused')
     or nullif(trim(coalesce(v_listing.remote_id, '')), '') is null then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'listing_not_verifiable'
    );
  end if;
  if exists (
    select 1
      from sellerpilot_private.provider_listing_lineage_attestations a
     where a.listing_id = v_listing.id
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'attestation_state_conflict'
    );
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.listing_id = v_listing.id
       and j.status in ('queued', 'running', 'reconciliation_required')
       and j.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update'
       )
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'active_listing_write'
    );
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.listing_id = v_listing.id
       and j.operation = 'listing.lineage.verify'
       and j.status = 'reconciliation_required'
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'verification_job_conflict'
    );
  end if;

  select historical_credential.environment
    into v_environment
    from sellerpilot_private.channel_operation_attempts attempt
    join sellerpilot_private.channel_credentials historical_credential
      on historical_credential.id = attempt.credential_id
     and historical_credential.channel = attempt.channel
   where attempt.id = v_listing.operation_attempt_id
     and attempt.channel = v_listing.channel_key
     and attempt.operation = 'listing.create'
     and nullif(trim(attempt.remote_id), '') = trim(v_listing.remote_id);
  if not found then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'historical_environment_missing'
    );
  end if;

  select c.id, c.environment, c.seller_account_key,
         c.seller_account_key_source, c.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.channel = v_listing.channel_key
     and c.environment = v_environment
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > clock_timestamp())
     and c.seller_account_key is not null
     and c.seller_account_key_source = (case
       when v_listing.channel_key = 'qoo10'
         then 'credential_incarnation_v1'
       else 'provider_certified_v1'
     end)
     and c.seller_account_verified_at is not null
     and exists (
       select 1
         from sellerpilot_private.admin_users admin_user
        where admin_user.user_id = c.created_by
     );
  if not found then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'provider_credential_unavailable'
    );
  end if;

  if v_listing.channel_key in ('shopee', 'lazada') and not exists (
    select 1
      from sellerpilot_private.channel_market_targets target
     where target.credential_id = v_credential.id
       and target.channel = v_listing.channel_key
       and target.environment = v_environment
       and target.market_code = upper(trim(v_listing.market))
       and target.target_id = trim(v_listing.target_id)
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'credential_target_mismatch'
    );
  end if;

  if v_listing.channel_key = 'ebay' then
    v_ebay_sku := coalesce(
      nullif(trim(v_listing.marketplace_sku), ''),
      sellerpilot_private.verified_legacy_ebay_listing_sku(v_listing.id)
    );
    if v_ebay_sku is null then
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing.id,
        'channel', v_listing.channel_key, 'market', v_listing.market,
        'reason', 'ebay_marketplace_sku_missing'
      );
    end if;
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'listing_id', v_listing.id,
    'credential_id', v_credential.id,
    'channel', v_listing.channel_key,
    'market', v_listing.market,
    'target_id', v_listing.target_id
  );
end;
$$;

create or replace function public.sellerpilot_service_enqueue_listing_lineage_verification(
  p_listing_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_listing record;
  v_credential record;
  v_existing record;
  v_job_id uuid := gen_random_uuid();
  v_ebay_sku text;
  v_provider_resource_id text;
  v_arguments jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  v_context := public.sellerpilot_service_prepare_listing_lineage_verification(
    p_listing_id
  );
  if v_context->>'status' <> 'ready' then
    return v_context || jsonb_build_object('reused', true);
  end if;
  if p_credential_id is null
     or (v_context->>'credential_id')::uuid is distinct from p_credential_id then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'channel', v_context->>'channel', 'market', v_context->>'market',
      'reason', 'credential_snapshot_changed', 'reused', true
    );
  end if;

  select l.id, l.owner_id, l.channel_key, l.status, l.remote_id,
         l.market, l.target_id, l.marketplace_sku, l.operation_attempt_id,
         l.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id
   for update;

  select c.id, c.channel, c.environment, c.status, c.expires_at,
         c.created_by, c.seller_account_key, c.seller_account_key_source,
         c.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
   for update;

  if not found
     or v_listing.seller_account_key is not null
     or v_listing.channel_key is distinct from v_credential.channel
     or v_credential.status <> 'active'
     or (v_credential.expires_at is not null
       and v_credential.expires_at <= clock_timestamp())
     or v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> (case
       when v_listing.channel_key = 'qoo10'
         then 'credential_incarnation_v1'
       else 'provider_certified_v1'
     end)
     or v_credential.seller_account_verified_at is null then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'credential_snapshot_changed', 'reused', true
    );
  end if;

  select j.id, j.status, j.credential_id, j.seller_account_key
    into v_existing
    from sellerpilot_private.channel_gateway_jobs j
   where j.listing_id = v_listing.id
     and j.operation = 'listing.lineage.verify'
     and j.status in ('queued', 'running', 'reconciliation_required')
   order by j.created_at, j.id
   for update
   limit 1;
  if found then
    if v_existing.status = 'reconciliation_required'
       or (
         v_existing.credential_id is distinct from p_credential_id
         and v_existing.seller_account_key
           is distinct from v_credential.seller_account_key
       ) then
      return jsonb_build_object(
        'status', 'manual_required', 'job_id', v_existing.id,
        'listing_id', v_listing.id, 'reason', 'verification_job_conflict',
        'reused', true
      );
    end if;
    return jsonb_build_object(
      'status', v_existing.status, 'job_id', v_existing.id,
      'listing_id', v_listing.id, 'reused', true
    );
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.listing_id = v_listing.id
       and j.status in ('queued', 'running', 'reconciliation_required')
       and j.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update'
       )
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'reason', 'active_listing_write', 'reused', true
    );
  end if;

  v_arguments := jsonb_build_object(
    'expectedRemoteId', trim(v_listing.remote_id),
    'market', v_listing.market,
    'targetId', v_listing.target_id
  );
  if v_listing.channel_key = 'shopee' then
    v_arguments := v_arguments || jsonb_build_object(
      'shopId', v_listing.target_id
    );
  elsif v_listing.channel_key = 'lazada' then
    v_arguments := v_arguments || jsonb_build_object(
      'country', lower(v_listing.market)
    );
  elsif v_listing.channel_key = 'ebay' then
    v_ebay_sku := coalesce(
      nullif(trim(v_listing.marketplace_sku), ''),
      sellerpilot_private.verified_legacy_ebay_listing_sku(v_listing.id)
    );
    v_provider_resource_id :=
      sellerpilot_private.verified_legacy_ebay_provider_resource_id(v_listing.id);
    if v_ebay_sku is null then
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing.id,
        'reason', 'ebay_marketplace_sku_missing', 'reused', true
      );
    end if;
    v_arguments := v_arguments || jsonb_build_object(
      'marketplaceSku', v_ebay_sku
    );
    if v_provider_resource_id is not null then
      v_arguments := v_arguments || jsonb_build_object(
        'providerResourceId', v_provider_resource_id
      );
    end if;
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key, created_by,
    created_at, updated_at
  ) values (
    v_job_id, p_credential_id, null, v_listing.id, v_listing.channel_key,
    'listing.lineage.verify', v_credential.environment,
    jsonb_build_object(
      'sellerpilotLineageVersion', 'provider_listing_readback_v1',
      'arguments', v_arguments
    ),
    'queued', v_credential.seller_account_key, v_listing.owner_id,
    now(), now()
  );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id, 'listing_lineage_verification_queued',
    'product_listing', v_listing.id::text,
    jsonb_build_object(
      'channel', v_listing.channel_key,
      'market', v_listing.market,
      'evidence', 'provider_listing_readback_v1'
    )
  );

  return jsonb_build_object(
    'status', 'queued', 'job_id', v_job_id,
    'listing_id', v_listing.id, 'reused', false
  );
exception when unique_violation then
  select j.id, j.status, j.credential_id, j.seller_account_key
    into v_existing
    from sellerpilot_private.channel_gateway_jobs j
   where j.listing_id = p_listing_id
     and j.status in ('queued', 'running', 'reconciliation_required')
     and j.operation = 'listing.lineage.verify'
   order by j.created_at, j.id
   limit 1;
  if found then
    if v_existing.status = 'reconciliation_required'
       or (
         v_existing.credential_id is distinct from p_credential_id
         and v_existing.seller_account_key
           is distinct from v_credential.seller_account_key
       ) then
      return jsonb_build_object(
        'status', 'manual_required', 'job_id', v_existing.id,
        'listing_id', p_listing_id, 'reason', 'verification_job_conflict',
        'reused', true
      );
    end if;
    return jsonb_build_object(
      'status', v_existing.status, 'job_id', v_existing.id,
      'listing_id', p_listing_id, 'reused', true
    );
  end if;
  raise;
end;
$$;

create or replace function public.sellerpilot_complete_listing_lineage_verification(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_token_id uuid;
  v_job record;
  v_listing record;
  v_credential record;
  v_attestation record;
  v_expected_remote_id text;
  v_market text;
  v_target_id text;
  v_marketplace_sku text;
  v_expected_resource_id text;
  v_verified_resource_id text;
  v_evidence jsonb;
  v_evidence_digest text;
  v_claim_hash text;
  v_failure_reason text;
  v_terminal_status text;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null
     or p_status not in ('succeeded', 'failed', 'retryable') then
    raise exception 'invalid lineage verification completion' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select token.id
    into v_worker_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if not found then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  v_claim_hash := encode(
    extensions.digest(p_claim_token::text, 'sha256'),
    'hex'
  );
  select attestation.id, attestation.listing_id,
         attestation.completion_claim_token_hash
    into v_attestation
    from sellerpilot_private.provider_listing_lineage_attestations attestation
   where attestation.gateway_job_id = p_job_id;
  if found then
    if v_attestation.completion_claim_token_hash = v_claim_hash then
      return jsonb_build_object(
        'status', 'bound', 'job_id', p_job_id,
        'listing_id', v_attestation.listing_id, 'reused', true
      );
    end if;
    raise exception 'lineage verification completion claim mismatch';
  end if;

  select j.id, j.listing_id, j.credential_id, j.channel, j.environment,
         j.operation, j.status, j.request_payload, j.seller_account_key,
         j.worker_token_id, j.claim_token, j.lease_expires_at,
         j.attempt_count, j.prepared_credential_id,
         j.credential_refresh_in_flight,
         j.credential_refresh_recovery_vault_id
    into v_job
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id
   for update;
  if not found
     or v_job.operation <> 'listing.lineage.verify'
     or v_job.status <> 'running'
     or v_job.worker_token_id is distinct from v_worker_token_id
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object(
      'status', 'lease_lost', 'job_id', p_job_id, 'reused', true
    );
  end if;

  -- Token refresh is prepared by the existing claim-bound Vault workflow
  -- before this RPC runs. A half-staged or recovery-only refresh is not safe
  -- to retry as an ordinary read: preserve its state and fence the credential
  -- for manual reconciliation. A fully prepared refresh is allowed only when
  -- the job now points at that prepared credential; the seller-key equality is
  -- rechecked below before any listing mutation.
  if v_job.credential_refresh_in_flight
     or v_job.credential_refresh_recovery_vault_id is not null then
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',
      v_job.id::text,
      true
    );
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'reconciliation_required',
           response_payload = null,
           error_message = 'Credential refresh state requires manual reconciliation.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = now(),
           updated_at = now()
     where job.id = v_job.id;
    return jsonb_build_object(
      'status', 'manual_required', 'job_id', v_job.id,
      'listing_id', v_job.listing_id,
      'reason', 'credential_refresh_reconciliation_required',
      'reused', false
    );
  end if;
  if v_job.prepared_credential_id is not null
     and v_job.prepared_credential_id is distinct from v_job.credential_id then
    raise exception 'prepared credential snapshot mismatch';
  end if;

  select l.id, l.owner_id, l.channel_key, l.status, l.remote_id,
         l.market, l.target_id, l.marketplace_sku, l.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings l
   where l.id = v_job.listing_id
   for update;
  select c.id, c.channel, c.environment, c.status, c.expires_at,
         c.seller_account_key, c.seller_account_key_source,
         c.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = v_job.credential_id
   for update;

  if not found
     or v_listing.channel_key is distinct from v_job.channel
     or v_listing.status not in ('published', 'paused')
     or v_listing.seller_account_key is not null
     or nullif(trim(v_listing.remote_id), '') is null
     or v_credential.channel is distinct from v_job.channel
     or v_credential.environment is distinct from v_job.environment
     or v_credential.status <> 'active'
     or (v_credential.expires_at is not null
       and v_credential.expires_at <= clock_timestamp())
     or v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> (case
       when v_job.channel = 'qoo10'
         then 'credential_incarnation_v1'
       else 'provider_certified_v1'
     end)
     or v_credential.seller_account_verified_at is null
     or v_job.seller_account_key is distinct from v_credential.seller_account_key
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_job
        where other_job.id <> v_job.id
          and other_job.listing_id = v_listing.id
          and other_job.status in ('queued', 'running', 'reconciliation_required')
          and other_job.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'price.update', 'inventory.update', 'listing.lineage.verify'
          )
     ) then
    raise exception 'lineage verification snapshot changed';
  end if;

  v_expected_remote_id := nullif(trim(
    v_job.request_payload#>>'{arguments,expectedRemoteId}'
  ), '');
  v_market := v_job.request_payload#>>'{arguments,market}';
  v_target_id := v_job.request_payload#>>'{arguments,targetId}';
  v_marketplace_sku := nullif(trim(
    v_job.request_payload#>>'{arguments,marketplaceSku}'
  ), '');
  v_expected_resource_id := nullif(trim(
    v_job.request_payload#>>'{arguments,providerResourceId}'
  ), '');

  if v_job.request_payload->>'sellerpilotLineageVersion'
       <> 'provider_listing_readback_v1'
     or v_expected_remote_id is distinct from trim(v_listing.remote_id)
     or v_market is distinct from v_listing.market
     or v_target_id is distinct from v_listing.target_id
     or (
       v_job.channel = 'shopee'
       and v_job.request_payload#>>'{arguments,shopId}'
         is distinct from v_listing.target_id
     )
     or (
       v_job.channel = 'lazada'
       and lower(v_job.request_payload#>>'{arguments,country}')
         is distinct from lower(v_listing.market)
     )
     or (
       v_job.channel in ('shopee', 'lazada')
       and not exists (
         select 1
           from sellerpilot_private.channel_market_targets target
          where target.credential_id = v_credential.id
            and target.channel = v_job.channel
            and target.environment = v_job.environment
            and target.market_code = upper(trim(v_listing.market))
            and target.target_id = trim(v_listing.target_id)
       )
     )
     or (
       v_job.channel = 'ebay'
       and (
         v_marketplace_sku is null
         or (
           v_listing.marketplace_sku is not null
           and trim(v_listing.marketplace_sku) <> v_marketplace_sku
         )
       )
     ) then
    raise exception 'lineage verification request snapshot mismatch';
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.provider_listing_lineage_rebind',
    v_job.id::text,
    true
  );

  if p_status = 'retryable' then
    v_terminal_status := case when v_job.attempt_count >= 4
      then 'failed' else 'queued' end;
    update sellerpilot_private.channel_gateway_jobs job
       set status = v_terminal_status,
           response_payload = null,
           error_message = case when v_terminal_status = 'failed'
             then 'Provider listing readback retry limit reached.'
             else 'Provider listing readback will be retried.' end,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = case when v_terminal_status = 'failed'
             then now() else null end,
           updated_at = now()
     where job.id = v_job.id;
    return jsonb_build_object(
      'status', case when v_terminal_status = 'queued'
        then 'queued' else 'manual_required' end,
      'job_id', v_job.id, 'listing_id', v_listing.id,
      'reason', case when v_terminal_status = 'failed'
        then 'provider_retry_exhausted' else 'provider_retry_queued' end,
      'reused', false
    );
  end if;

  if p_status = 'failed' then
    if p_response_payload is null
       or jsonb_typeof(p_response_payload) <> 'object'
       or (p_response_payload - array[
         'ok', 'channel', 'operation', 'evidenceVersion', 'reason'
       ]) <> '{}'::jsonb
       or coalesce((p_response_payload->>'ok')::boolean, true)
       or p_response_payload->>'channel' is distinct from v_job.channel
       or p_response_payload->>'operation' <> 'listing.lineage.verify'
       or p_response_payload->>'evidenceVersion'
            <> 'provider_listing_readback_v1'
       or p_response_payload->>'reason' not in (
         'provider_not_found', 'provider_identity_mismatch',
         'remote_id_mismatch', 'market_mismatch', 'target_mismatch',
         'marketplace_sku_missing', 'marketplace_sku_mismatch',
         'provider_resource_ambiguous', 'provider_resource_missing',
         'legacy_main_reconnect_required', 'provider_readback_rejected'
       ) then
      raise exception 'invalid normalized lineage verification failure';
    end if;
    v_failure_reason := p_response_payload->>'reason';
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed',
           response_payload = jsonb_build_object(
             'ok', false,
             'channel', v_job.channel,
             'operation', 'listing.lineage.verify',
             'evidenceVersion', 'provider_listing_readback_v1',
             'reason', v_failure_reason
           ),
           error_message = 'Exact provider listing readback requires manual review.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = now(),
           updated_at = now()
     where job.id = v_job.id;
    return jsonb_build_object(
      'status', 'manual_required', 'job_id', v_job.id,
      'listing_id', v_listing.id, 'reason', v_failure_reason,
      'reused', false
    );
  end if;

  if p_response_payload is null
     or jsonb_typeof(p_response_payload) <> 'object'
     or (p_response_payload - array[
       'ok', 'channel', 'operation', 'evidenceVersion',
       'expectedRemoteId', 'verifiedRemoteId', 'market', 'targetId',
       'verification', 'marketplaceSku', 'providerResourceId'
     ]) <> '{}'::jsonb
     or not coalesce((p_response_payload->>'ok')::boolean, false)
     or p_response_payload->>'channel' is distinct from v_job.channel
     or p_response_payload->>'operation' <> 'listing.lineage.verify'
     or p_response_payload->>'evidenceVersion'
          <> 'provider_listing_readback_v1'
     or p_response_payload->>'verification' <> 'exact_provider_readback'
     or nullif(trim(p_response_payload->>'expectedRemoteId'), '')
          is distinct from v_expected_remote_id
     or nullif(trim(p_response_payload->>'verifiedRemoteId'), '')
          is distinct from v_expected_remote_id
     or p_response_payload->>'market' is distinct from v_listing.market
     or p_response_payload->>'targetId' is distinct from v_listing.target_id then
    raise exception 'normalized provider listing evidence mismatch';
  end if;

  if v_job.channel = 'ebay' then
    if nullif(trim(p_response_payload->>'marketplaceSku'), '')
         is distinct from v_marketplace_sku
       or nullif(trim(p_response_payload->>'providerResourceId'), '') is null
       or length(trim(p_response_payload->>'providerResourceId')) > 240
       or (
         v_expected_resource_id is not null
         and trim(p_response_payload->>'providerResourceId')
           <> v_expected_resource_id
       ) then
      raise exception 'normalized ebay provider listing evidence mismatch';
    end if;
    v_verified_resource_id := trim(
      p_response_payload->>'providerResourceId'
    );
  elsif p_response_payload ? 'marketplaceSku'
     or p_response_payload ? 'providerResourceId' then
    raise exception 'unexpected provider listing resource evidence';
  end if;

  v_evidence := jsonb_build_object(
    'listing_id', v_listing.id,
    'credential_id', v_credential.id,
    'gateway_job_id', v_job.id,
    'seller_account_key', v_credential.seller_account_key,
    'channel', v_job.channel,
    'environment', v_job.environment,
    'expected_remote_id', v_expected_remote_id,
    'verified_remote_id', v_expected_remote_id,
    'market', v_listing.market,
    'target_id', v_listing.target_id,
    'marketplace_sku', case when v_job.channel = 'ebay'
      then v_marketplace_sku else null end,
    'provider_resource_id', case when v_job.channel = 'ebay'
      then v_verified_resource_id else null end,
    'evidence_version', 'provider_listing_readback_v1'
  );
  v_evidence_digest := encode(
    extensions.digest(v_evidence::text, 'sha256'),
    'hex'
  );

  if v_job.channel = 'ebay' and v_listing.marketplace_sku is null then
    update sellerpilot_private.product_listings listing
       set marketplace_sku = v_marketplace_sku
     where listing.id = v_listing.id;
  end if;

  insert into sellerpilot_private.provider_listing_lineage_attestations (
    listing_id, credential_id, gateway_job_id, seller_account_key,
    channel, environment, expected_remote_id, verified_remote_id,
    market, target_id, marketplace_sku, provider_resource_id,
    evidence_version, evidence_digest, completion_claim_token_hash,
    verified_at
  ) values (
    v_listing.id, v_credential.id, v_job.id,
    v_credential.seller_account_key, v_job.channel, v_job.environment,
    v_expected_remote_id, v_expected_remote_id, v_listing.market,
    v_listing.target_id,
    case when v_job.channel = 'ebay' then v_marketplace_sku else null end,
    case when v_job.channel = 'ebay' then v_verified_resource_id else null end,
    'provider_listing_readback_v1', v_evidence_digest, v_claim_hash,
    clock_timestamp()
  );

  -- The unchanged 11830 product-listing guard rechecks the immutable
  -- attestation through verified_static_listing_lineage_key. Only the seller
  -- key changes in this statement.
  perform pg_catalog.set_config(
    'sellerpilot.static_listing_lineage_backfill',
    'verified-v1',
    true
  );
  update sellerpilot_private.product_listings listing
     set seller_account_key = v_credential.seller_account_key
   where listing.id = v_listing.id
     and listing.seller_account_key is null;
  if not found then
    raise exception 'listing lineage binding lost';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'succeeded',
         response_payload = jsonb_build_object(
           'ok', true,
           'channel', v_job.channel,
           'operation', 'listing.lineage.verify',
           'evidenceVersion', 'provider_listing_readback_v1',
           'expectedRemoteId', v_expected_remote_id,
           'verifiedRemoteId', v_expected_remote_id,
           'market', v_listing.market,
           'targetId', v_listing.target_id,
           'verification', 'exact_provider_readback',
           'marketplaceSku', case when v_job.channel = 'ebay'
             then v_marketplace_sku else null end,
           'providerResourceId', case when v_job.channel = 'ebay'
             then v_verified_resource_id else null end
         ) - case when v_job.channel = 'ebay'
           then array[]::text[]
           else array['marketplaceSku', 'providerResourceId'] end,
         error_message = null,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where job.id = v_job.id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id, 'listing_lineage_provider_verified',
    'product_listing', v_listing.id::text,
    jsonb_build_object(
      'channel', v_job.channel,
      'market', v_listing.market,
      'gateway_job_id', v_job.id,
      'evidence', 'provider_listing_readback_v1'
    )
  );

  return jsonb_build_object(
    'status', 'bound', 'job_id', v_job.id,
    'listing_id', v_listing.id, 'reused', false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_prepare_listing_lineage_verification(uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_prepare_listing_lineage_verification(uuid)
  to service_role;

revoke all on function
  public.sellerpilot_service_enqueue_listing_lineage_verification(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_listing_lineage_verification(uuid, uuid)
  to service_role;

revoke all on function
  public.sellerpilot_complete_listing_lineage_verification(
    text, uuid, uuid, text, jsonb, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_complete_listing_lineage_verification(
    text, uuid, uuid, text, jsonb, text
  ) to service_role;

commit;
