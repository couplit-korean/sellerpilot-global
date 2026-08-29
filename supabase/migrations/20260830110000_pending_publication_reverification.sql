-- Turn provider-side pending review into a durable, read-only verification
-- lifecycle. A verifier job can observe remote state but can never cross the
-- listing provider-mutation fence. Publication remains fail-closed until all
-- seven adapters and this rechecker are explicitly attested for one release.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_operation_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'listing.lineage.verify', 'listing.publication.verify',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'inquiries.list', 'inquiries.reply', 'shipment.acknowledge', 'shipment.confirm'
  )) not valid;

-- A publication verifier carries the immutable content fingerprint while all
-- provider write-resource columns stay null. No other read may smuggle a
-- write fingerprint through this exception.
alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_write_resource_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_write_resource_check check (
    (
      write_resource_kind is null
      and write_resource_key is null
      and request_fingerprint is null
      and inventory_item_id is null
      and order_id is null
      and shipment_carrier is null
      and shipment_tracking is null
    ) or (
      operation = 'listing.publication.verify'
      and write_resource_kind is null
      and write_resource_key is null
      and request_fingerprint ~ '^[a-f0-9]{64}$'
      and inventory_item_id is null
      and order_id is null
      and shipment_carrier is null
      and shipment_tracking is null
    ) or (
      write_resource_kind in ('listing_mutation', 'order_shipment')
      and write_resource_key ~ '^[a-f0-9]{64}$'
      and request_fingerprint ~ '^[a-f0-9]{64}$'
      and (shipment_carrier is null or length(shipment_carrier) between 1 and 40)
      and (shipment_tracking is null or length(shipment_tracking) <= 100)
    )
  );

create table sellerpilot_private.listing_publication_reviews (
  listing_id uuid primary key references
    sellerpilot_private.product_listings(id) on delete restrict,
  owner_id uuid not null,
  product_id uuid not null references
    sellerpilot_private.products(id) on delete restrict,
  source_job_id uuid not null unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  channel text not null check (channel in (
    'qoo10', 'shopee', 'lazada', 'coupang',
    'elevenst', 'smartstore', 'ebay'
  )),
  environment text not null check (environment in ('sandbox', 'production')),
  market text not null check (length(market) <= 80),
  target_id text not null check (length(target_id) <= 160),
  expected_remote_id text not null
    check (length(trim(expected_remote_id)) between 1 and 240),
  expected_locale text not null
    check (expected_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  expected_fingerprint text not null check (expected_fingerprint ~ '^[a-f0-9]{64}$'),
  expected_image_count integer not null check (expected_image_count = 8),
  marketplace_sku text check (
    marketplace_sku is null or length(trim(marketplace_sku)) between 1 and 240
  ),
  status text not null default 'pending' check (status in (
    'pending', 'queued', 'verifying', 'live', 'rejected',
    'withdrawn', 'non_public', 'manual_required'
  )),
  next_check_at timestamptz,
  deadline_at timestamptz not null,
  check_count integer not null default 0 check (check_count between 0 and 8),
  last_job_id uuid unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  remote_state jsonb check (
    remote_state is null or (
      jsonb_typeof(remote_state) = 'object'
      and octet_length(remote_state::text) <= 65536
    )
  ),
  public_url text check (public_url is null or length(public_url) <= 1000),
  last_error text check (last_error is null or length(last_error) <= 1000),
  last_verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'pending' and next_check_at is not null)
    or (status in ('queued', 'verifying') and last_job_id is not null and next_check_at is null)
    or (status in ('live', 'rejected', 'withdrawn', 'non_public', 'manual_required') and next_check_at is null)
  ),
  check (deadline_at > created_at)
);

create index listing_publication_reviews_due_idx
  on sellerpilot_private.listing_publication_reviews
    (next_check_at, deadline_at, listing_id)
  where status = 'pending';
create index listing_publication_reviews_active_idx
  on sellerpilot_private.listing_publication_reviews
    (channel, environment, status, updated_at);

alter table sellerpilot_private.listing_publication_reviews enable row level security;
revoke all on sellerpilot_private.listing_publication_reviews
  from public, anon, authenticated, service_role;

create table sellerpilot_private.listing_publication_adapter_release (
  channel text primary key check (channel in (
    'qoo10', 'shopee', 'lazada', 'coupang',
    'elevenst', 'smartstore', 'ebay'
  )),
  adapter_ready boolean not null default false,
  contract_version text,
  release_sha text,
  verified_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (adapter_ready and contract_version = 'verified_remote_state_v1'
      and release_sha ~ '^[a-f0-9]{40}$' and verified_at is not null)
    or (not adapter_ready and contract_version is null
      and release_sha is null and verified_at is null)
  )
);

create table sellerpilot_private.listing_publication_rechecker_release (
  singleton boolean primary key default true check (singleton),
  rechecker_ready boolean not null default false,
  release_sha text,
  verified_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (rechecker_ready and release_sha ~ '^[a-f0-9]{40}$' and verified_at is not null)
    or (not rechecker_ready and release_sha is null and verified_at is null)
  )
);

alter table sellerpilot_private.listing_publication_adapter_release enable row level security;
alter table sellerpilot_private.listing_publication_rechecker_release enable row level security;
revoke all on sellerpilot_private.listing_publication_adapter_release
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.listing_publication_rechecker_release
  from public, anon, authenticated, service_role;

insert into sellerpilot_private.listing_publication_adapter_release (channel)
values ('qoo10'), ('shopee'), ('lazada'), ('coupang'),
       ('elevenst'), ('smartstore'), ('ebay');
insert into sellerpilot_private.listing_publication_rechecker_release (singleton)
values (true);

-- A deployment change invalidates an already-open listing gate. Persist the
-- exact release that opened it so an attestation for a different deployment
-- can atomically close the gate before another provider mutation begins.
alter table sellerpilot_private.listing_mutation_release_gate
  add column opened_release_sha text;
update sellerpilot_private.listing_mutation_release_gate gate
   set is_open = false,
       opened_at = null,
       opened_release_sha = null,
       updated_at = clock_timestamp()
 where gate.singleton;
alter table sellerpilot_private.listing_mutation_release_gate
  add constraint listing_mutation_release_gate_release_check check (
    (
      is_open
      and opened_at is not null
      and opened_release_sha ~ '^[a-f0-9]{40}$'
    ) or (
      not is_open
      and opened_at is null
      and opened_release_sha is null
    )
  );

-- No write and no other listing read may overlap the exact listing verifier.
drop index if exists
  sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (listing_id)
  where listing_id is not null
    and operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update',
      'listing.lineage.verify', 'listing.publication.verify'
    )
    and status in ('queued', 'running', 'reconciliation_required');

drop index if exists
  sellerpilot_private.channel_gateway_jobs_serverless_gateway_queue_idx;
create index channel_gateway_jobs_serverless_gateway_queue_idx
  on sellerpilot_private.channel_gateway_jobs (created_at, id)
  where status = 'queued'
    and channel in (
      'qoo10', 'shopee', 'lazada', 'coupang',
      'elevenst', 'temu', 'smartstore', 'ebay'
    )
    and operation in (
      'diagnostic.test',
      'categories.list', 'categories.suggest',
      'categories.attributes', 'categories.validate',
      'orders.list', 'orders.get', 'inquiries.list', 'inquiries.reply',
      'shops.get', 'competitor.search', 'listing.lineage.verify',
      'listing.publication.verify',
      'listing.create', 'listing.update', 'listing.stop',
      'inventory.update', 'shipment.acknowledge', 'shipment.confirm',
      'oauth.exchange'
    );

create or replace function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_operation
    when 'diagnostic.test' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.list' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.suggest' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.attributes' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.validate' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'orders.list' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'orders.get' then p_channel in (
      'qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'inquiries.list' then p_channel in (
      'qoo10','lazada','coupang','temu','smartstore','ebay')
    when 'inquiries.reply' then p_channel in (
      'qoo10','lazada','coupang','smartstore','ebay')
    when 'shops.get' then p_channel in ('shopee','lazada')
    when 'competitor.search' then p_channel = 'elevenst'
    when 'listing.lineage.verify' then p_channel in ('qoo10','shopee','lazada','ebay')
    when 'listing.publication.verify' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay')
    when 'listing.create' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'listing.update' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','smartstore')
    when 'listing.stop' then p_channel in (
      'qoo10','shopee','lazada','coupang','elevenst','temu','smartstore')
    when 'inventory.update' then p_channel in (
      'qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'shipment.acknowledge' then p_channel in (
      'qoo10','shopee','lazada','coupang','smartstore')
    when 'shipment.confirm' then p_channel in (
      'qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'oauth.exchange' then p_channel in ('shopee','lazada','ebay')
    else false
  end;
$$;

revoke all on function
  sellerpilot_private.serverless_gateway_job_allowed(text, text)
  from public, anon, authenticated, service_role;

-- Review rows are writable only from an exact source completion, an exact
-- verifier job transition, or the scheduler acting through that same source.
create function sellerpilot_private.guard_listing_publication_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_marker text := current_setting(
    'sellerpilot.publication_review_source_job', true
  );
  v_job_marker text := current_setting(
    'sellerpilot.publication_review_job', true
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'listing publication review is immutable';
  end if;

  if v_source_marker = new.source_job_id::text and exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = new.source_job_id
       and job.listing_id = new.listing_id
       and job.attempt_id = new.source_attempt_id
       and job.credential_id = new.credential_id
       and job.channel = new.channel
       and job.environment = new.environment
       and job.seller_account_key = new.seller_account_key
       and job.operation in ('listing.create', 'listing.update')
       and job.status = 'succeeded'
       and job.response_payload#>>'{remoteState,visibility}' = 'pending_review'
       and job.response_payload->>'publicationIntent' = 'live'
  ) then
    return new;
  end if;

  if v_job_marker <> ''
     and v_job_marker = coalesce(new.last_job_id, new.source_job_id)::text
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = coalesce(new.last_job_id, new.source_job_id)
          and job.listing_id = new.listing_id
          and job.channel = new.channel
          and job.environment = new.environment
          and job.seller_account_key = new.seller_account_key
          and job.operation in (
            'listing.create', 'listing.update', 'listing.publication.verify'
          )
     )
     and (tg_op = 'INSERT' or old.listing_id = new.listing_id)
     and (tg_op = 'INSERT' or old.owner_id = new.owner_id)
     and (tg_op = 'INSERT' or old.product_id = new.product_id) then
    return new;
  end if;

  raise exception 'verified listing publication review transition required';
end;
$$;

create trigger guard_listing_publication_review
before insert or update or delete
on sellerpilot_private.listing_publication_reviews
for each row execute function
  sellerpilot_private.guard_listing_publication_review();

revoke all on function sellerpilot_private.guard_listing_publication_review()
  from public, anon, authenticated, service_role;

-- This predicate is the only extra branch added to the existing seller-lineage
-- trigger. It compares the complete OLD/NEW rows and the already-transitioned
-- private review, so a transaction marker cannot authorize an arbitrary edit.
create function sellerpilot_private.listing_publication_review_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_job_marker text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_job record;
  v_state jsonb;
  v_visibility text;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_remote_resources jsonb;
  v_expected jsonb;
begin
  if coalesce(p_job_marker, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_old->>'id' is distinct from p_new->>'id' then
    return false;
  end if;

  select review.*
    into v_review
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = (p_old->>'id')::uuid
     and coalesce(review.last_job_id, review.source_job_id)::text = p_job_marker;
  if not found then return false; end if;

  select job.id, job.listing_id, job.channel, job.environment,
         job.seller_account_key, job.operation, job.status
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_marker::uuid;
  if not found
     or v_job.listing_id is distinct from v_review.listing_id
     or v_job.channel is distinct from v_review.channel
     or v_job.environment is distinct from v_review.environment
     or v_job.seller_account_key is distinct from v_review.seller_account_key
     or v_job.operation not in (
       'listing.create', 'listing.update', 'listing.publication.verify'
     ) then
    return false;
  end if;

  if v_review.status = 'manual_required' then
    v_expected := p_old || jsonb_build_object(
      'status', 'failed',
      'last_error', to_jsonb(v_review.last_error),
      'failure_class', 'external_action',
      'updated_at', p_new->'updated_at'
    );
    return p_new = v_expected;
  end if;

  if v_review.status not in (
       'pending', 'live', 'rejected', 'withdrawn', 'non_public'
     ) or jsonb_typeof(v_review.remote_state) <> 'object' then
    return false;
  end if;
  v_state := v_review.remote_state;
  v_visibility := v_state->>'visibility';
  begin
    v_verified_at := nullif(v_state->>'verifiedAt', '')::timestamptz;
    v_created_at := nullif(v_state->>'createdAt', '')::timestamptz;
  exception when others then
    return false;
  end;
  if v_verified_at is null
     or v_visibility is distinct from (case v_review.status
       when 'pending' then 'pending_review'
       when 'non_public' then 'non_public'
       else v_review.status
     end) then
    return false;
  end if;

  v_remote_resources := jsonb_build_object(
    'resources', v_state->'resources',
    'verification', jsonb_build_object(
      'verifiedAt', v_state->'verifiedAt',
      'evidence', v_state->'evidence',
      'locale', v_state->>'locale',
      'fingerprint', v_state->>'fingerprint',
      'imageCount', (v_state->>'imageCount')::integer
    )
  );

  v_expected := p_old || jsonb_build_object(
    'status', case when v_review.status = 'live' then 'published'
                   when v_review.status = 'rejected' then 'failed'
                   else 'paused' end,
    'remote_visibility', v_visibility,
    'provider_status', v_state->>'providerStatus',
    'remote_resources', v_remote_resources,
    'remote_created_at', to_jsonb(coalesce(
      v_created_at,
      nullif(p_old->>'remote_created_at', '')::timestamptz
    )),
    'published_at', case when v_review.status = 'live'
      then to_jsonb(coalesce(
        nullif(p_old->>'published_at', '')::timestamptz,
        v_verified_at
      )) else 'null'::jsonb end,
    'last_verified_at', to_jsonb(v_verified_at),
    'public_url', to_jsonb(case when v_review.status = 'live'
      then v_review.public_url else null end),
    'last_error', to_jsonb(v_review.last_error),
    'failure_class', to_jsonb(case
      when v_review.status in ('rejected', 'withdrawn', 'non_public')
        then 'external_action' else null end),
    'updated_at', p_new->'updated_at'
  );
  return p_new = v_expected;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.listing_publication_review_update_allowed(jsonb, jsonb, text)
  from public, anon, authenticated, service_role;

do $guard_patch$
declare
  v_definition text;
  v_before text := 'begin
  if current_setting(''sellerpilot.remote_publication_backfill'', true)';
  v_after text := 'begin
  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then
    if not sellerpilot_private.listing_publication_review_update_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.publication_review_apply'', true)
    ) then
      raise exception ''invalid listing publication review update'';
    end if;
    return new;
  end if;

  if current_setting(''sellerpilot.remote_publication_backfill'', true)';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilot.publication_review_apply') = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'product listing seller lineage review entry not found';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$guard_patch$;

-- Register a review only after the existing completion wrapper has accepted an
-- exact live-intent pending_review readback for the source mutation.
create function sellerpilot_private.register_pending_listing_publication_review(
  p_source_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_listing record;
  v_arguments jsonb;
  v_expected_image_count integer;
begin
  select job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_source_job_id
     and job.operation in ('listing.create', 'listing.update')
     and job.status = 'succeeded'
     and job.attempt_id is not null
     and job.listing_id is not null
     and job.response_payload->>'publicationStateContract'
           = 'verified_remote_state_v1'
     and job.response_payload->>'publicationIntent' = 'live'
     and job.response_payload#>>'{remoteState,visibility}' = 'pending_review'
     and job.response_payload#>>'{remoteState,verified}' = 'true'
   for update;
  if not found then return false; end if;

  select listing.*
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_job.listing_id
     and listing.operation_attempt_id = v_job.attempt_id
     and listing.channel_key = v_job.channel
     and listing.seller_account_key = v_job.seller_account_key
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'pending_review'
     and listing.status = 'paused'
     and listing.remote_id = v_job.response_payload->>'remoteId'
   for update;
  if not found then
    raise exception 'pending publication source listing drifted';
  end if;

  v_arguments := v_job.request_payload->'arguments';
  begin
    v_expected_image_count := (
      v_arguments->>'publicationExpectedImageCount'
    )::integer;
  exception when others then
    raise exception 'pending publication source expectations invalid';
  end;
  if jsonb_typeof(v_arguments) <> 'object'
     or v_job.channel not in (
       'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay'
     )
     or v_job.seller_account_key !~ '^[a-f0-9]{64}$'
     or v_arguments->>'publicationStateContract' <> 'verified_remote_state_v1'
     or v_arguments->>'publicationIntent' <> 'live'
     or v_arguments->>'publicationExpectedLocale' !~
          '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
     or v_arguments->>'publicationExpectedFingerprint' !~ '^[a-f0-9]{64}$'
     or v_expected_image_count <> 8
     or v_job.request_fingerprint is distinct from
          v_arguments->>'publicationExpectedFingerprint'
     or v_listing.remote_resources#>>'{verification,fingerprint}' is distinct from
          v_arguments->>'publicationExpectedFingerprint'
     or coalesce(
          (v_listing.remote_resources#>>'{verification,imageCount}')::integer,
          -1
        ) <> v_expected_image_count then
    raise exception 'pending publication source expectations invalid';
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.publication_review_source_job', v_job.id::text, true
  );
  insert into sellerpilot_private.listing_publication_reviews (
    listing_id, owner_id, product_id, source_job_id, source_attempt_id,
    credential_id, seller_account_key, channel, environment, market,
    target_id, expected_remote_id, expected_locale,
    expected_fingerprint, expected_image_count, marketplace_sku,
    status, next_check_at, deadline_at, check_count, last_job_id,
    remote_state, public_url, last_error, last_verified_at,
    created_at, updated_at
  ) values (
    v_listing.id, v_listing.owner_id, v_listing.product_id,
    v_job.id, v_job.attempt_id, v_job.credential_id,
    v_job.seller_account_key, v_job.channel, v_job.environment,
    v_listing.market, v_listing.target_id, trim(v_listing.remote_id),
    v_arguments->>'publicationExpectedLocale',
    v_arguments->>'publicationExpectedFingerprint',
    v_expected_image_count, v_listing.marketplace_sku,
    'pending', clock_timestamp() + interval '2 minutes',
    clock_timestamp() + interval '60 minutes', 0, null,
    v_job.response_payload->'remoteState', null, null,
    (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,
    clock_timestamp(), clock_timestamp()
  )
  on conflict (listing_id) do update
    set source_job_id = excluded.source_job_id,
        source_attempt_id = excluded.source_attempt_id,
        credential_id = excluded.credential_id,
        seller_account_key = excluded.seller_account_key,
        channel = excluded.channel,
        environment = excluded.environment,
        market = excluded.market,
        target_id = excluded.target_id,
        expected_remote_id = excluded.expected_remote_id,
        expected_locale = excluded.expected_locale,
        expected_fingerprint = excluded.expected_fingerprint,
        expected_image_count = excluded.expected_image_count,
        marketplace_sku = excluded.marketplace_sku,
        status = 'pending',
        next_check_at = excluded.next_check_at,
        deadline_at = excluded.deadline_at,
        check_count = 0,
        last_job_id = null,
        remote_state = excluded.remote_state,
        public_url = null,
        last_error = null,
        last_verified_at = excluded.last_verified_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id, 'listing_publication_review_scheduled',
    'product_listing', v_listing.id::text,
    jsonb_build_object(
      'channel', v_listing.channel_key,
      'market', v_listing.market,
      'sourceJobId', v_job.id,
      'contract', 'pending_publication_recheck_v1'
    )
  );
  return true;
end;
$$;

revoke all on function
  sellerpilot_private.register_pending_listing_publication_review(uuid)
  from public, anon, authenticated, service_role;

-- Reconstruct only an unambiguous, already-verified source that predates this
-- migration. Zero or multiple candidates remain fail-closed and receive an
-- operator-visible audit entry instead of being guessed into the lifecycle.
do $pending_review_backfill$
declare
  v_listing record;
  v_registered boolean;
begin
  for v_listing in
    select listing.id,
           listing.owner_id,
           listing.channel_key,
           listing.market,
           candidate.candidate_count,
           candidate.source_job_id
      from sellerpilot_private.product_listings listing
      left join lateral (
        select count(*)::integer as candidate_count,
               (array_agg(job.id order by job.completed_at desc, job.id))[1]
                 as source_job_id
          from sellerpilot_private.channel_gateway_jobs job
         where job.listing_id = listing.id
           and job.attempt_id = listing.operation_attempt_id
           and job.channel = listing.channel_key
           and job.seller_account_key = listing.seller_account_key
           and job.operation in ('listing.create', 'listing.update')
           and job.status = 'succeeded'
           and job.response_payload->>'publicationStateContract'
                 = 'verified_remote_state_v1'
           and job.response_payload->>'publicationIntent' = 'live'
           and job.response_payload#>>'{remoteState,visibility}'
                 = 'pending_review'
           and job.response_payload#>>'{remoteState,verified}' = 'true'
      ) candidate on true
     where listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'pending_review'
  loop
    v_registered := false;
    if v_listing.candidate_count = 1 then
      begin
        v_registered :=
          sellerpilot_private.register_pending_listing_publication_review(
            v_listing.source_job_id
          );
      exception when others then
        v_registered := false;
      end;
    end if;
    if not coalesce(v_registered, false) then
      insert into sellerpilot_private.operation_audit (
        owner_id, action, entity_type, entity_id, safe_detail
      ) values (
        v_listing.owner_id,
        'listing_publication_review_backfill_required',
        'product_listing',
        v_listing.id::text,
        jsonb_build_object(
          'channel', v_listing.channel_key,
          'market', v_listing.market,
          'candidateCount', coalesce(v_listing.candidate_count, 0),
          'contract', 'pending_publication_recheck_v1'
        )
      );
    end if;
  end loop;
end;
$pending_review_backfill$;

create function sellerpilot_private.apply_listing_publication_review_to_listing(
  p_listing_id uuid,
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_state jsonb;
  v_visibility text;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_remote_resources jsonb;
begin
  select review.*
    into v_review
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = p_listing_id
     and coalesce(review.last_job_id, review.source_job_id) = p_job_id
   for share;
  if not found then return false; end if;

  perform pg_catalog.set_config(
    'sellerpilot.publication_review_apply', p_job_id::text, true
  );
  if v_review.status = 'manual_required' then
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           last_error = v_review.last_error,
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    return found;
  end if;

  v_state := v_review.remote_state;
  v_visibility := v_state->>'visibility';
  v_verified_at := (v_state->>'verifiedAt')::timestamptz;
  begin
    v_created_at := nullif(v_state->>'createdAt', '')::timestamptz;
  exception when others then
    v_created_at := null;
  end;
  v_remote_resources := jsonb_build_object(
    'resources', v_state->'resources',
    'verification', jsonb_build_object(
      'verifiedAt', v_state->'verifiedAt',
      'evidence', v_state->'evidence',
      'locale', v_state->>'locale',
      'fingerprint', v_state->>'fingerprint',
      'imageCount', (v_state->>'imageCount')::integer
    )
  );
  update sellerpilot_private.product_listings listing
     set status = case when v_review.status = 'live' then 'published'
                       when v_review.status = 'rejected' then 'failed'
                       else 'paused' end,
         remote_visibility = v_visibility,
         provider_status = v_state->>'providerStatus',
         remote_resources = v_remote_resources,
         remote_created_at = coalesce(v_created_at, listing.remote_created_at),
         published_at = case when v_review.status = 'live'
           then coalesce(listing.published_at, v_verified_at) else null end,
         last_verified_at = v_verified_at,
         public_url = case when v_review.status = 'live'
           then v_review.public_url else null end,
         last_error = v_review.last_error,
         failure_class = case
           when v_review.status in ('rejected', 'withdrawn', 'non_public')
             then 'external_action' else null end,
         updated_at = clock_timestamp()
   where listing.id = p_listing_id;
  if not found then return false; end if;

  if v_review.status = 'live' then
    update sellerpilot_private.products product
       set status = 'active', updated_at = clock_timestamp()
     where product.id = v_review.product_id;
  end if;
  return true;
end;
$$;

revoke all on function
  sellerpilot_private.apply_listing_publication_review_to_listing(uuid, uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.mark_listing_publication_review_manual(
  p_listing_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_marker_job_id uuid;
begin
  select review.*
    into v_review
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = p_listing_id
   for update;
  if not found or v_review.status not in ('pending', 'queued', 'verifying') then
    return false;
  end if;
  v_marker_job_id := coalesce(v_review.last_job_id, v_review.source_job_id);
  perform pg_catalog.set_config(
    'sellerpilot.publication_review_job', v_marker_job_id::text, true
  );
  update sellerpilot_private.listing_publication_reviews review
     set status = 'manual_required',
         next_check_at = null,
         last_error = left(coalesce(nullif(trim(p_error), ''),
           '원격 게시 상태를 제한 시간 안에 확정하지 못했습니다.'), 1000),
         updated_at = clock_timestamp()
   where review.listing_id = p_listing_id;
  perform sellerpilot_private.apply_listing_publication_review_to_listing(
    p_listing_id, v_marker_job_id
  );
  return true;
end;
$$;

revoke all on function
  sellerpilot_private.mark_listing_publication_review_manual(uuid, text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.apply_listing_publication_verifier_completion(
  p_job_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_review record;
  v_listing record;
  v_arguments jsonb;
  v_response jsonb;
  v_state jsonb;
  v_visibility text;
  v_provider_status text;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_image_count integer;
  v_publication_fulfilled boolean;
  v_state_valid boolean := false;
  v_source_drift boolean := false;
  v_next_status text;
  v_next_check_at timestamptz;
  v_error text;
  v_public_url text;
  v_requires_reconciliation boolean := false;
begin
  select job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.operation = 'listing.publication.verify'
     and job.status in ('succeeded', 'failed', 'reconciliation_required')
   for update;
  if not found then
    raise exception 'terminal publication verifier job required';
  end if;

  select review.*
    into v_review
    from sellerpilot_private.listing_publication_reviews review
   where review.last_job_id = v_job.id
     and review.listing_id = v_job.listing_id
     and review.status in ('queued', 'verifying')
   for update;
  if not found then return 'review_completion_replayed'; end if;

  select listing.*
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_review.listing_id
   for update;
  if not found then raise exception 'publication review listing missing'; end if;

  v_arguments := v_job.request_payload->'arguments';
  v_response := v_job.response_payload;
  v_state := v_response->'remoteState';
  v_source_drift := v_listing.owner_id is distinct from v_review.owner_id
    or v_listing.product_id is distinct from v_review.product_id
    or v_listing.operation_attempt_id is distinct from v_review.source_attempt_id
    or v_listing.channel_key is distinct from v_review.channel
    or v_listing.seller_account_key is distinct from v_review.seller_account_key
    or trim(coalesce(v_listing.remote_id, '')) is distinct from v_review.expected_remote_id
    or v_listing.market is distinct from v_review.market
    or v_listing.target_id is distinct from v_review.target_id
    or v_listing.marketplace_sku is distinct from v_review.marketplace_sku
    or v_listing.requested_publication_intent <> 'live'
    or v_listing.remote_visibility <> 'pending_review'
    or v_listing.status <> 'paused'
    or v_listing.remote_resources#>>'{verification,fingerprint}'
         is distinct from v_review.expected_fingerprint
    or v_listing.remote_resources#>>'{verification,locale}'
         is distinct from v_review.expected_locale
    or not case
      when v_listing.remote_resources#>>'{verification,imageCount}'
             ~ '^[0-9]{1,2}$'
        then (v_listing.remote_resources#>>'{verification,imageCount}')::integer
               = v_review.expected_image_count
      else false
    end
    or v_job.credential_id is distinct from v_review.credential_id
    or v_job.attempt_id is not null
    or v_job.write_resource_kind is not null
    or v_job.write_resource_key is not null
    or v_job.provider_mutation_started_at is not null
    or v_job.channel is distinct from v_review.channel
    or v_job.environment is distinct from v_review.environment
    or v_job.seller_account_key is distinct from v_review.seller_account_key
    or v_job.request_fingerprint is distinct from v_review.expected_fingerprint
    or v_arguments->>'publicationReviewId' is distinct from v_review.listing_id::text
    or v_arguments->>'publicationReviewSourceJobId' is distinct from v_review.source_job_id::text
    or v_arguments->>'publicationReviewCheck' is distinct from v_review.check_count::text
    or v_arguments->>'sellerpilotReadOnly' <> 'true'
    or v_arguments->>'remoteId' is distinct from v_review.expected_remote_id
    or v_arguments->>'market' is distinct from v_review.market
    or v_arguments->>'targetId' is distinct from v_review.target_id
    or v_arguments->>'publicationIntent' <> 'live'
    or v_arguments->>'publicationStateContract' <> 'verified_remote_state_v1'
    or v_arguments->>'publicationExpectedLocale' is distinct from v_review.expected_locale
    or v_arguments->>'publicationExpectedFingerprint' is distinct from v_review.expected_fingerprint
    or v_arguments->>'publicationExpectedImageCount'
         is distinct from v_review.expected_image_count::text
    or not exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs source_job
        join sellerpilot_private.channel_operation_attempts source_attempt
          on source_attempt.id = source_job.attempt_id
       where source_job.id = v_review.source_job_id
         and source_job.listing_id = v_review.listing_id
         and source_job.attempt_id = v_review.source_attempt_id
         and source_job.credential_id = source_attempt.credential_id
         and source_job.channel = v_review.channel
         and source_job.environment = v_review.environment
         and source_job.seller_account_key = v_review.seller_account_key
         and source_job.request_fingerprint = v_review.expected_fingerprint
         and source_job.operation in ('listing.create', 'listing.update')
         and source_job.status = 'succeeded'
         and source_job.response_payload->>'publicationStateContract'
               = 'verified_remote_state_v1'
         and source_job.response_payload->>'publicationIntent' = 'live'
         and source_job.response_payload->>'remoteId'
               = v_review.expected_remote_id
         and source_job.response_payload#>>'{remoteState,visibility}'
               = 'pending_review'
         and source_job.response_payload#>>'{remoteState,verified}' = 'true'
         and source_job.request_payload#>>'{arguments,publicationStateContract}'
               = 'verified_remote_state_v1'
         and source_job.request_payload#>>'{arguments,publicationIntent}' = 'live'
         and source_job.request_payload#>>'{arguments,publicationExpectedLocale}'
               = v_review.expected_locale
         and source_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
               = v_review.expected_fingerprint
         and source_job.request_payload#>>'{arguments,publicationExpectedImageCount}'
               = v_review.expected_image_count::text
         and source_attempt.owner_id = v_review.owner_id
         and source_attempt.channel = v_review.channel
         and source_attempt.operation = source_job.operation
         and source_attempt.status = 'succeeded'
         and source_attempt.request_fingerprint = v_review.expected_fingerprint
         and source_attempt.remote_id = v_review.expected_remote_id
         and source_attempt.seller_account_key = v_review.seller_account_key
    );

  if not v_source_drift
     and v_job.status = 'succeeded'
     and jsonb_typeof(v_response) = 'object'
     and jsonb_typeof(v_response->'ok') = 'boolean'
     and coalesce((v_response->>'ok')::boolean, false)
     and v_response->>'channel' = v_review.channel
     and v_response->>'operation' = 'listing.publication.verify'
     and v_response->>'publicationStateContract' = 'verified_remote_state_v1'
     and v_response->>'publicationIntent' = 'live'
     and v_response->>'remoteId' = v_review.expected_remote_id
     and jsonb_typeof(v_state) = 'object' then
    v_visibility := v_state->>'visibility';
    v_provider_status := nullif(trim(coalesce(v_state->>'providerStatus', '')), '');
    v_public_url := nullif(trim(coalesce(v_response->>'publicUrl', '')), '');
    begin
      v_verified_at := nullif(v_state->>'verifiedAt', '')::timestamptz;
      v_created_at := nullif(v_state->>'createdAt', '')::timestamptz;
      v_image_count := (v_state->>'imageCount')::integer;
      v_publication_fulfilled := (v_response->>'publicationFulfilled')::boolean;
    exception when others then
      v_verified_at := null;
      v_created_at := null;
      v_image_count := null;
      v_publication_fulfilled := null;
    end;
    v_state_valid := v_state->>'verified' = 'true'
      and v_visibility in ('non_public','pending_review','live','withdrawn','rejected')
      and v_provider_status is not null
      and length(v_provider_status) <= 160
      and v_provider_status !~ '[[:cntrl:]]'
      and v_verified_at is not null
      and v_job.started_at is not null
      and v_verified_at >= v_job.started_at
      and v_verified_at <= clock_timestamp() + interval '5 minutes'
      and jsonb_typeof(v_state->'evidence') = 'object'
      and v_state->'evidence' <> '{}'::jsonb
      and octet_length((v_state->'evidence')::text) <= 32768
      and v_state#>>'{evidence,identityVerified}' = 'true'
      and v_state#>>'{evidence,statusVerified}' = 'true'
      and v_state#>>'{evidence,localeVerified}' = 'true'
      and v_state#>>'{evidence,fingerprintVerified}' = 'true'
      and v_state#>>'{evidence,imageCountVerified}' = 'true'
      and jsonb_typeof(v_state->'resources') = 'object'
      and v_state->'resources' <> '{}'::jsonb
      and octet_length((v_state->'resources')::text) <= 32768
      and sellerpilot_private.jsonb_contains_exact_scalar(
        v_state->'resources', v_review.expected_remote_id
      )
      and v_state->>'locale' = v_review.expected_locale
      and v_state->>'fingerprint' = v_review.expected_fingerprint
      and v_image_count = v_review.expected_image_count
      and v_publication_fulfilled is not distinct from (v_visibility = 'live')
      and (v_visibility = 'live' or v_public_url is null)
      and (v_public_url is null or length(v_public_url) <= 1000);
  end if;

  if v_source_drift then
    v_next_status := 'manual_required';
    v_error := '재검증 중 상품·판매자 계정 또는 원격 식별값이 변경되어 수동 확인이 필요합니다.';
  elsif v_state_valid and v_visibility = 'live' then
    v_next_status := 'live';
  elsif v_state_valid and v_visibility = 'rejected' then
    v_next_status := 'rejected';
    v_error := '판매채널이 상품 등록을 거절한 상태로 확인됐습니다.';
  elsif v_state_valid and v_visibility = 'withdrawn' then
    v_next_status := 'withdrawn';
    v_error := '판매채널에서 상품이 철회된 상태로 확인됐습니다.';
  elsif v_state_valid and v_visibility = 'non_public' then
    v_next_status := 'non_public';
    v_error := '판매채널에서 상품이 비공개 상태로 확인됐습니다.';
  elsif v_state_valid and v_visibility = 'pending_review'
        and v_review.check_count < 8
        and clock_timestamp() < v_review.deadline_at then
    v_next_status := 'pending';
    v_next_check_at := least(
      v_review.deadline_at,
      clock_timestamp() + case
        when v_review.check_count <= 1 then interval '2 minutes'
        when v_review.check_count = 2 then interval '5 minutes'
        else interval '10 minutes'
      end
    );
  else
    if v_job.status = 'reconciliation_required' then
      v_requires_reconciliation := sellerpilot_private.gateway_job_requires_reconciliation(
        v_job.operation,
        v_job.credential_refresh_in_flight,
        v_job.prepared_credential_id,
        v_job.credential_refresh_recovery_vault_id,
        v_job.oauth_exchange_completed,
        v_job.provider_mutation_started_at
      );
      if not v_requires_reconciliation then
        update sellerpilot_private.channel_gateway_jobs job
           set status = 'failed',
               error_message = 'publication_readback_retryable',
               updated_at = clock_timestamp()
         where job.id = v_job.id
           and job.status = 'reconciliation_required';
      end if;
    end if;
    if v_requires_reconciliation
       or v_review.check_count >= 8
       or clock_timestamp() >= v_review.deadline_at then
      v_next_status := 'manual_required';
      v_error := case when v_requires_reconciliation
        then '인증 갱신 상태를 확정하지 못해 원격 게시 상태를 수동 확인해야 합니다.'
        else '원격 게시 상태를 제한 시간 안에 확정하지 못했습니다.' end;
    else
      v_next_status := 'pending';
      v_next_check_at := least(
        v_review.deadline_at,
        clock_timestamp() + case
          when v_review.check_count <= 1 then interval '2 minutes'
          when v_review.check_count = 2 then interval '5 minutes'
          else interval '10 minutes'
        end
      );
    end if;
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.publication_review_job', v_job.id::text, true
  );
  update sellerpilot_private.listing_publication_reviews review
     set status = v_next_status,
         next_check_at = v_next_check_at,
         remote_state = case when v_state_valid then v_state else review.remote_state end,
         public_url = case when v_state_valid and v_visibility = 'live'
           then v_public_url else null end,
         last_error = v_error,
         last_verified_at = case when v_state_valid
           then v_verified_at else review.last_verified_at end,
         updated_at = clock_timestamp()
   where review.listing_id = v_review.listing_id;

  if v_next_status in (
    'pending','live','rejected','withdrawn','non_public','manual_required'
  ) then
    perform sellerpilot_private.apply_listing_publication_review_to_listing(
      v_review.listing_id, v_job.id
    );
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_review.owner_id, 'listing_publication_review_transitioned',
    'product_listing', v_review.listing_id::text,
    jsonb_build_object(
      'channel', v_review.channel,
      'market', v_review.market,
      'jobId', v_job.id,
      'checkCount', v_review.check_count,
      'status', v_next_status,
      'visibility', case when v_state_valid then v_visibility else null end
    )
  );
  return v_next_status;
end;
$$;

revoke all on function
  sellerpilot_private.apply_listing_publication_verifier_completion(uuid)
  from public, anon, authenticated, service_role;

-- Keep the review's queued/running phase in lockstep with lease recovery. A
-- verifier lease can expire and requeue without creating a second job.
create function sellerpilot_private.sync_listing_publication_review_job_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.operation <> 'listing.publication.verify'
     or new.status not in (
       'queued', 'running', 'succeeded', 'failed', 'reconciliation_required'
     ) then
    return new;
  end if;

  -- A normal completion wrapper applies the review after its gateway update,
  -- but a lease reaper can terminate the job without passing that wrapper.
  -- Recover that terminal path here. The depth guard prevents the deliberate
  -- reconciliation-to-failed downgrade inside the apply function recursing.
  if new.status in ('succeeded', 'failed', 'reconciliation_required') then
    if pg_trigger_depth() = 1 and exists (
      select 1
        from sellerpilot_private.listing_publication_reviews review
       where review.last_job_id = new.id
         and review.listing_id = new.listing_id
         and review.status in ('queued', 'verifying')
    ) then
      perform sellerpilot_private.apply_listing_publication_verifier_completion(
        new.id
      );
    end if;
    return new;
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.publication_review_job', new.id::text, true
  );
  update sellerpilot_private.listing_publication_reviews review
     set status = case when new.status = 'running' then 'verifying' else 'queued' end,
         next_check_at = null,
         updated_at = clock_timestamp()
   where review.last_job_id = new.id
     and review.listing_id = new.listing_id
     and review.status in ('queued', 'verifying');
  return new;
end;
$$;

create trigger sync_listing_publication_review_job_status
after insert or update of status
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.sync_listing_publication_review_job_status();

revoke all on function
  sellerpilot_private.sync_listing_publication_review_job_status()
  from public, anon, authenticated, service_role;

-- The scheduler enqueues only bounded readbacks. Missing credentials or fixed
-- egress remain pending until the deadline, then become explicit manual work.
create function public.sellerpilot_service_enqueue_due_listing_publication_verifications(
  p_limit integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_credential record;
  v_job_id uuid;
  v_arguments jsonb;
  v_queued integer := 0;
  v_deferred integer := 0;
  v_manual integer := 0;
begin
  if p_limit not between 1 and 50 then
    raise exception 'invalid publication review enqueue limit';
  end if;

  for v_review in
    select review.*
      from sellerpilot_private.listing_publication_reviews review
     where review.deadline_at <= clock_timestamp()
       and (
         review.status = 'pending'
         or (
           review.status = 'queued'
           and exists (
             select 1
               from sellerpilot_private.channel_gateway_jobs job
              where job.id = review.last_job_id
                and job.status = 'queued'
           )
         )
       )
     order by review.deadline_at, review.listing_id
     for update skip locked
     limit p_limit
  loop
    if v_review.status = 'queued' then
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'cancelled',
             error_message = 'publication_review_deadline_exceeded',
             completed_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where job.id = v_review.last_job_id
         and job.status = 'queued';
    end if;
    if sellerpilot_private.mark_listing_publication_review_manual(
      v_review.listing_id,
      '원격 게시 상태를 제한 시간 안에 확정하지 못했습니다.'
    ) then
      v_manual := v_manual + 1;
    end if;
  end loop;

  for v_review in
    select review.*
      from sellerpilot_private.listing_publication_reviews review
     where review.status = 'pending'
       and review.next_check_at <= clock_timestamp()
       and review.deadline_at > clock_timestamp()
     order by review.next_check_at, review.listing_id
     for update skip locked
     limit greatest(p_limit - v_manual, 0)
  loop
    select credential.id, credential.environment,
           credential.seller_account_key,
           credential.seller_account_key_source,
           credential.seller_account_verified_at
      into v_credential
      from sellerpilot_private.channel_credentials credential
     where credential.channel = v_review.channel
       and credential.environment = v_review.environment
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.seller_account_key = v_review.seller_account_key
     order by credential.version desc, credential.created_at desc, credential.id
     limit 1;

    if not found
       or not exists (
         select 1
           from sellerpilot_private.listing_publication_adapter_release adapter
           join sellerpilot_private.listing_publication_rechecker_release rechecker
             on rechecker.singleton
            and rechecker.rechecker_ready
            and rechecker.release_sha = adapter.release_sha
          where adapter.channel = v_review.channel
            and adapter.adapter_ready
       )
       or (v_review.channel in ('coupang','smartstore','elevenst')
         and not sellerpilot_private.serverless_static_egress_allowed(v_review.channel))
       or (v_review.channel = 'ebay' and (
         v_credential.seller_account_key_source <> 'provider_certified_v1'
         or v_credential.seller_account_verified_at is null
       )) then
      perform pg_catalog.set_config(
        'sellerpilot.publication_review_job',
        coalesce(v_review.last_job_id, v_review.source_job_id)::text,
        true
      );
      update sellerpilot_private.listing_publication_reviews review
         set next_check_at = least(
               review.deadline_at,
               clock_timestamp() + interval '5 minutes'
             ),
             updated_at = clock_timestamp()
       where review.listing_id = v_review.listing_id
         and review.status = 'pending';
      v_deferred := v_deferred + 1;
      continue;
    end if;

    v_job_id := gen_random_uuid();
    v_arguments := jsonb_build_object(
      'publicationReviewId', v_review.listing_id,
      'publicationReviewSourceJobId', v_review.source_job_id,
      'publicationReviewCheck', v_review.check_count + 1,
      'sellerpilotReadOnly', true,
      'remoteId', v_review.expected_remote_id,
      'market', v_review.market,
      'targetId', v_review.target_id,
      'publicationIntent', 'live',
      'publicationStateContract', 'verified_remote_state_v1',
      'publicationExpectedLocale', v_review.expected_locale,
      'publicationExpectedFingerprint', v_review.expected_fingerprint,
      'publicationExpectedImageCount', v_review.expected_image_count,
      'remoteResources', (
        select listing.remote_resources->'resources'
          from sellerpilot_private.product_listings listing
         where listing.id = v_review.listing_id
      )
    );
    if v_review.channel = 'shopee' then
      v_arguments := v_arguments || jsonb_build_object('shopId', v_review.target_id);
    elsif v_review.channel = 'lazada' then
      v_arguments := v_arguments || jsonb_build_object('country', lower(v_review.market));
    elsif v_review.channel = 'ebay' then
      v_arguments := v_arguments || jsonb_build_object(
        'marketplaceId', upper(v_review.market),
        'marketplaceSku', v_review.marketplace_sku
      );
    end if;

    insert into sellerpilot_private.channel_gateway_jobs (
      id, credential_id, attempt_id, listing_id, channel, operation,
      environment, request_payload, status, seller_account_key,
      request_fingerprint, created_by, created_at, updated_at
    ) values (
      v_job_id, v_credential.id, null, v_review.listing_id,
      v_review.channel, 'listing.publication.verify', v_review.environment,
      jsonb_build_object(
        'periodicKey', 'listing-publication:' || v_review.listing_id::text,
        'arguments', v_arguments
      ),
      'queued', v_review.seller_account_key,
      v_review.expected_fingerprint, v_review.owner_id,
      clock_timestamp(), clock_timestamp()
    );

    perform pg_catalog.set_config(
      'sellerpilot.publication_review_job', v_job_id::text, true
    );
    update sellerpilot_private.listing_publication_reviews review
       set credential_id = v_credential.id,
           status = 'queued',
           next_check_at = null,
           check_count = review.check_count + 1,
           last_job_id = v_job_id,
           last_error = null,
           updated_at = clock_timestamp()
     where review.listing_id = v_review.listing_id
       and review.status = 'pending';
    if not found then
      raise exception 'publication review enqueue ownership changed'
        using errcode = '40001';
    end if;
    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object(
    'contract', 'pending_publication_recheck_v1',
    'queued', v_queued,
    'deferred', v_deferred,
    'manualRequired', v_manual,
    'pending', (
      select count(*)::integer
        from sellerpilot_private.listing_publication_reviews review
       where review.status in ('pending','queued','verifying')
    )
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_due_listing_publication_verifications(integer)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_due_listing_publication_verifications(integer)
  to service_role;

-- The exact verifier job start is the freshness boundary. Unlike a listing
-- mutation there is deliberately no provider_mutation_started_at value.
alter function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) rename to sellerpilot_301100_gateway_completion_context_pre_publication_review;

revoke all on function
  public.sellerpilot_301100_gateway_completion_context_pre_publication_review(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_started_at timestamptz;
begin
  v_context := public.sellerpilot_301100_gateway_completion_context_pre_publication_review(
    p_token_hash, p_job_id, p_claim_token
  );
  if v_context is null
     or v_context->>'operation' <> 'listing.publication.verify' then
    return v_context;
  end if;
  select job.started_at
    into v_started_at
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.operation = 'listing.publication.verify';
  if not found or v_started_at is null then return null; end if;
  return v_context || jsonb_build_object(
    'publication_verification_boundary', v_started_at
  );
end;
$$;

revoke all on function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) to service_role;

-- Wrap the already-atomic generic completion. Source registration and verifier
-- application therefore commit or roll back with the transport ledger.
alter function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) rename to sellerpilot_301100_complete_gateway_pre_publication_review;

revoke all on function
  public.sellerpilot_301100_complete_gateway_pre_publication_review(
    text, uuid, uuid, text, jsonb, text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text;
  v_completed boolean;
begin
  select job.operation
    into v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token;

  v_completed := public.sellerpilot_301100_complete_gateway_pre_publication_review(
    p_token_hash, p_job_id, p_claim_token, p_status,
    p_response_payload, p_error_message
  );
  if v_completed is not true or v_operation is null then return v_completed; end if;

  if v_operation in ('listing.create', 'listing.update') then
    perform sellerpilot_private.register_pending_listing_publication_review(
      p_job_id
    );
  elsif v_operation = 'listing.publication.verify' then
    perform sellerpilot_private.apply_listing_publication_verifier_completion(
      p_job_id
    );
  end if;
  return true;
end;
$$;

revoke all on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) to service_role;

create function sellerpilot_private.safe_listing_publication_timestamp(
  p_value text
)
returns timestamptz
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

-- One predicate owns the exact-source invariant used by both status reporting
-- and the release gate. This intentionally validates the immutable source
-- mutation, the current listing, and the most recent read-only verifier.
create function sellerpilot_private.listing_publication_review_is_current(
  p_listing_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.listing_publication_reviews review
        on review.listing_id = listing.id
      join sellerpilot_private.channel_gateway_jobs source_job
        on source_job.id = review.source_job_id
      join sellerpilot_private.channel_operation_attempts source_attempt
        on source_attempt.id = review.source_attempt_id
      left join sellerpilot_private.channel_gateway_jobs last_job
        on last_job.id = review.last_job_id
     where listing.id = p_listing_id
       and listing.owner_id = review.owner_id
       and listing.product_id = review.product_id
       and listing.operation_attempt_id = review.source_attempt_id
       and listing.channel_key = review.channel
       and listing.market = review.market
       and listing.target_id = review.target_id
       and trim(coalesce(listing.remote_id, '')) = review.expected_remote_id
       and listing.seller_account_key = review.seller_account_key
       and listing.marketplace_sku is not distinct from review.marketplace_sku
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'pending_review'
       and listing.status = 'paused'
       and listing.remote_resources#>>'{verification,locale}' = review.expected_locale
       and listing.remote_resources#>>'{verification,fingerprint}'
             = review.expected_fingerprint
       and case
         when listing.remote_resources#>>'{verification,imageCount}'
                ~ '^[0-9]{1,2}$'
           then (listing.remote_resources#>>'{verification,imageCount}')::integer
                  = review.expected_image_count
         else false
       end
       and review.status in ('pending', 'queued', 'verifying')
       and review.deadline_at > statement_timestamp()
       and source_job.listing_id = review.listing_id
       and source_job.attempt_id = review.source_attempt_id
       and source_job.credential_id = source_attempt.credential_id
       and source_job.channel = review.channel
       and source_job.environment = review.environment
       and source_job.seller_account_key = review.seller_account_key
       and source_job.request_fingerprint = review.expected_fingerprint
       and source_job.operation in ('listing.create', 'listing.update')
       and source_job.status = 'succeeded'
       and source_job.completed_at is not null
       and source_job.response_payload->>'publicationStateContract'
             = 'verified_remote_state_v1'
       and source_job.response_payload->>'publicationIntent' = 'live'
       and source_job.response_payload->>'remoteId' = review.expected_remote_id
       and source_job.response_payload#>>'{remoteState,visibility}'
             = 'pending_review'
       and source_job.response_payload#>>'{remoteState,verified}' = 'true'
       and source_job.response_payload#>>'{remoteState,locale}'
             = review.expected_locale
       and source_job.response_payload#>>'{remoteState,fingerprint}'
             = review.expected_fingerprint
       and case
         when source_job.response_payload#>>'{remoteState,imageCount}'
                ~ '^[0-9]{1,2}$'
           then (source_job.response_payload#>>'{remoteState,imageCount}')::integer
                  = review.expected_image_count
         else false
       end
       and source_job.response_payload->>'publicationFulfilled' = 'false'
       and source_job.request_payload#>>'{arguments,publicationStateContract}'
             = 'verified_remote_state_v1'
       and source_job.request_payload#>>'{arguments,publicationIntent}' = 'live'
       and source_job.request_payload#>>'{arguments,publicationExpectedLocale}'
             = review.expected_locale
       and source_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
             = review.expected_fingerprint
       and source_job.request_payload#>>'{arguments,publicationExpectedImageCount}'
             = review.expected_image_count::text
       and source_attempt.owner_id = review.owner_id
       and source_attempt.credential_id = source_job.credential_id
       and source_attempt.channel = review.channel
       and source_attempt.operation = source_job.operation
       and source_attempt.status = 'succeeded'
       and source_attempt.request_fingerprint = review.expected_fingerprint
       and source_attempt.remote_id = review.expected_remote_id
       and source_attempt.seller_account_key = review.seller_account_key
       and source_attempt.completed_at is not null
       and (
         review.last_job_id is null
         or (
           last_job.id = review.last_job_id
           and last_job.attempt_id is null
           and last_job.listing_id = review.listing_id
           and last_job.credential_id = review.credential_id
           and last_job.channel = review.channel
           and last_job.environment = review.environment
           and last_job.seller_account_key = review.seller_account_key
           and last_job.operation = 'listing.publication.verify'
           and last_job.request_fingerprint = review.expected_fingerprint
           and last_job.write_resource_kind is null
           and last_job.write_resource_key is null
           and last_job.provider_mutation_started_at is null
           and last_job.request_payload#>>'{arguments,publicationReviewId}'
                 = review.listing_id::text
           and last_job.request_payload#>>'{arguments,publicationReviewSourceJobId}'
                 = review.source_job_id::text
           and last_job.request_payload#>>'{arguments,publicationReviewCheck}'
                 = review.check_count::text
           and last_job.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
           and last_job.request_payload#>>'{arguments,remoteId}'
                 = review.expected_remote_id
           and last_job.request_payload#>>'{arguments,market}' = review.market
           and last_job.request_payload#>>'{arguments,targetId}' = review.target_id
           and last_job.request_payload#>>'{arguments,publicationIntent}' = 'live'
           and last_job.request_payload#>>'{arguments,publicationStateContract}'
                 = 'verified_remote_state_v1'
           and last_job.request_payload#>>'{arguments,publicationExpectedLocale}'
                 = review.expected_locale
           and last_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
                 = review.expected_fingerprint
           and last_job.request_payload#>>'{arguments,publicationExpectedImageCount}'
                 = review.expected_image_count::text
         )
       )
       and case review.status
         when 'pending' then
           review.next_check_at is not null
           and (
             (review.check_count = 0 and review.last_job_id is null)
             or (
               review.check_count between 1 and 8
               and review.last_job_id is not null
               and last_job.status in ('succeeded', 'failed')
               and last_job.completed_at is not null
               and last_job.lease_expires_at is null
               and (
                 last_job.status = 'failed'
                 or (
                   last_job.response_payload->>'ok' = 'true'
                   and last_job.response_payload->>'channel' = review.channel
                   and last_job.response_payload->>'operation'
                         = 'listing.publication.verify'
                   and last_job.response_payload->>'publicationStateContract'
                         = 'verified_remote_state_v1'
                   and last_job.response_payload->>'publicationIntent' = 'live'
                   and last_job.response_payload->>'remoteId'
                         = review.expected_remote_id
                   and last_job.response_payload#>>'{remoteState,verified}' = 'true'
                   and last_job.response_payload#>>'{remoteState,visibility}'
                         = 'pending_review'
                   and last_job.response_payload#>>'{remoteState,locale}'
                         = review.expected_locale
                   and last_job.response_payload#>>'{remoteState,fingerprint}'
                         = review.expected_fingerprint
                   and case
                     when last_job.response_payload#>>'{remoteState,imageCount}'
                            ~ '^[0-9]{1,2}$'
                       then (last_job.response_payload#>>'{remoteState,imageCount}')::integer
                              = review.expected_image_count
                     else false
                   end
                   and last_job.response_payload->>'publicationFulfilled' = 'false'
                   and last_job.started_at is not null
                   and sellerpilot_private.safe_listing_publication_timestamp(
                         last_job.response_payload#>>'{remoteState,verifiedAt}'
                       ) >= last_job.started_at
                   and sellerpilot_private.safe_listing_publication_timestamp(
                         last_job.response_payload#>>'{remoteState,verifiedAt}'
                       ) <= statement_timestamp() + interval '5 minutes'
                 )
               )
             )
           )
         when 'queued' then
           review.check_count between 1 and 8
           and review.next_check_at is null
           and review.last_job_id is not null
           and last_job.status = 'queued'
           and last_job.claim_token is null
           and last_job.lease_expires_at is null
         when 'verifying' then
           review.check_count between 1 and 8
           and review.next_check_at is null
           and review.last_job_id is not null
           and last_job.status = 'running'
           and last_job.worker_token_id is not null
           and last_job.claim_token is not null
           and last_job.lease_expires_at > statement_timestamp()
         else false
       end
  );
$$;

create function sellerpilot_private.listing_publication_review_violation_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from (
      select listing.id
        from sellerpilot_private.product_listings listing
       where listing.requested_publication_intent = 'live'
         and listing.remote_visibility = 'pending_review'
         and not sellerpilot_private.listing_publication_review_is_current(
           listing.id
         )
      union all
      select review.listing_id
        from sellerpilot_private.listing_publication_reviews review
        join sellerpilot_private.product_listings listing
          on listing.id = review.listing_id
       where review.status in ('pending', 'queued', 'verifying')
         and not (
           listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'pending_review'
         )
    ) violation;
$$;

create function sellerpilot_private.attested_listing_publication_release_sha()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with adapters as (
    select count(*)::integer as ready_count,
           min(release.release_sha) as minimum_sha,
           max(release.release_sha) as maximum_sha
      from sellerpilot_private.listing_publication_adapter_release release
     where release.adapter_ready
  )
  select case
    when adapters.ready_count = 7
     and adapters.minimum_sha = adapters.maximum_sha
     and rechecker.rechecker_ready
     and rechecker.release_sha = adapters.minimum_sha
      then adapters.minimum_sha
    else null
  end
    from adapters
    join sellerpilot_private.listing_publication_rechecker_release rechecker
      on rechecker.singleton;
$$;

create function sellerpilot_private.active_serverless_runtime_release_sha()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (
      select count(*) filter (where job.active)::integer
        from cron.job job
       where job.jobname in (
         'sellerpilot-serverless-cs-wake-v1',
         'sellerpilot-product-research-v1',
         'sellerpilot-channel-sync-v1',
         'sellerpilot-competitor-prices-v1',
         'sellerpilot-kakao-notifications-v1',
         'sellerpilot-maintenance-v1'
       )
    ) = 6 then receipt.release_id
    else null
  end
    from sellerpilot_private.serverless_runtime_canary_receipts receipt
   where receipt.consumed_at is not null
   order by receipt.consumed_at desc, receipt.id desc
   limit 1;
$$;

create function sellerpilot_private.listing_mutation_release_gate_is_effective()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    gate.is_open
    and gate.opened_release_sha
          = sellerpilot_private.attested_listing_publication_release_sha()
    and gate.opened_release_sha
          = sellerpilot_private.active_serverless_runtime_release_sha()
    and sellerpilot_private.listing_publication_review_violation_count() = 0,
    false
  )
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton;
$$;

revoke all on function
  sellerpilot_private.safe_listing_publication_timestamp(text)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.listing_publication_review_is_current(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.listing_publication_review_violation_count()
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.attested_listing_publication_release_sha()
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.active_serverless_runtime_release_sha()
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.listing_mutation_release_gate_is_effective()
  from public, anon, authenticated, service_role;

-- Every listing-write boundary evaluates the effective gate, not just the
-- stored boolean. Deadline expiry or source drift therefore blocks new work
-- immediately even before an operator explicitly closes the row.
create or replace function sellerpilot_private.block_closed_listing_mutation_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'queued'
     and new.status = 'running'
     and (
       old.operation in ('listing.create', 'listing.update', 'listing.stop')
       or new.operation in ('listing.create', 'listing.update', 'listing.stop')
     )
     and not sellerpilot_private.listing_mutation_release_gate_is_effective()
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.sellerpilot_service_begin_gateway_provider_mutation(
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
  v_operation text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.operation
    into v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;
  if v_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective()
  then
    return false;
  end if;
  return public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

do $serverless_effective_gate$
begin
  if to_regprocedure(
    'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
  ) is null then
    return;
  end if;
  execute $create$
    create or replace function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid
    )
    returns boolean
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    declare
      v_operation text;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.operation
        into v_operation
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id;
      if not found then return false; end if;
      if v_operation in ('listing.create', 'listing.update', 'listing.stop')
         and not sellerpilot_private.listing_mutation_release_gate_is_effective()
      then
        return false;
      end if;
      return public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
        p_token_hash,
        p_job_id,
        p_claim_token
      );
    end;
    $function$
  $create$;
  execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) to service_role';
end;
$serverless_effective_gate$;

create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if not sellerpilot_private.listing_mutation_release_gate_is_effective() then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_300950_reserve_listing_before_release_gate(
    p_product_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_market,
    p_target_id,
    p_currency,
    p_price,
    p_request_fingerprint,
    p_request_payload
  );
end;
$$;

create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective()
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_300950_enqueue_listing_before_release_gate(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

revoke all on function
  sellerpilot_private.block_closed_listing_mutation_claim()
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid)
  to service_role;
revoke all on function
  public.sellerpilot_service_reserve_and_enqueue_listing_create(
    uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_reserve_and_enqueue_listing_create(
    uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
  ) to service_role;
revoke all on function
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ) to service_role;

create function public.sellerpilot_service_set_listing_publication_adapter_ready(
  p_channel text,
  p_ready boolean,
  p_release_sha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row sellerpilot_private.listing_publication_adapter_release%rowtype;
begin
  if p_channel not in (
       'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay'
     ) or p_ready is null
     or (p_ready and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$') then
    raise exception 'invalid listing publication adapter attestation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  update sellerpilot_private.listing_publication_adapter_release release
     set adapter_ready = p_ready,
         contract_version = case when p_ready then 'verified_remote_state_v1' else null end,
         release_sha = case when p_ready then p_release_sha else null end,
         verified_at = case when p_ready then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where release.channel = p_channel
   returning release.* into v_row;
  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = false,
         opened_at = null,
         opened_release_sha = null,
         updated_at = clock_timestamp()
   where gate.singleton
     and gate.is_open
     and (
       not p_ready
       or gate.opened_release_sha is distinct from p_release_sha
     );
  return jsonb_build_object(
    'channel', v_row.channel, 'ready', v_row.adapter_ready,
    'contract', v_row.contract_version, 'releaseSha', v_row.release_sha,
    'verifiedAt', v_row.verified_at
  );
end;
$$;

create function public.sellerpilot_service_set_listing_publication_rechecker_ready(
  p_ready boolean,
  p_release_sha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row sellerpilot_private.listing_publication_rechecker_release%rowtype;
begin
  if p_ready is null
     or (p_ready and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$') then
    raise exception 'invalid listing publication rechecker attestation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  update sellerpilot_private.listing_publication_rechecker_release release
     set rechecker_ready = p_ready,
         release_sha = case when p_ready then p_release_sha else null end,
         verified_at = case when p_ready then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where release.singleton
   returning release.* into v_row;
  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = false,
         opened_at = null,
         opened_release_sha = null,
         updated_at = clock_timestamp()
   where gate.singleton
     and gate.is_open
     and (
       not p_ready
       or gate.opened_release_sha is distinct from p_release_sha
     );
  return jsonb_build_object(
    'ready', v_row.rechecker_ready, 'releaseSha', v_row.release_sha,
    'verifiedAt', v_row.verified_at
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_set_listing_publication_adapter_ready(text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_set_listing_publication_adapter_ready(text, boolean, text)
  to service_role;
revoke all on function
  public.sellerpilot_service_set_listing_publication_rechecker_ready(boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_set_listing_publication_rechecker_ready(boolean, text)
  to service_role;

-- Extend the closed mutation gate. Opening now requires seven adapter
-- attestations, the durable rechecker attestation, and no orphan pending row.
alter function public.sellerpilot_service_listing_mutation_release_gate_status()
  rename to sellerpilot_301100_listing_gate_status_pre_publication_review;
revoke all on function
  public.sellerpilot_301100_listing_gate_status_pre_publication_review()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_listing_mutation_release_gate_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sellerpilot_301100_listing_gate_status_pre_publication_review()
    || jsonb_build_object(
      'publicationRecheckerReady', coalesce((
        select release.rechecker_ready
          from sellerpilot_private.listing_publication_rechecker_release release
         where release.singleton
      ), false),
      'publicationAdaptersReady', (
        select count(*)::integer
          from sellerpilot_private.listing_publication_adapter_release release
         where release.adapter_ready
      ),
      'attestedRelease',
        sellerpilot_private.attested_listing_publication_release_sha(),
      'activeRuntimeRelease',
        sellerpilot_private.active_serverless_runtime_release_sha(),
      'openedRelease', (
        select gate.opened_release_sha
          from sellerpilot_private.listing_mutation_release_gate gate
         where gate.singleton
      ),
      'publicationReleaseConsistent',
        sellerpilot_private.attested_listing_publication_release_sha()
          is not null,
      'runtimeReleaseMatches',
        coalesce(
          sellerpilot_private.active_serverless_runtime_release_sha()
            = sellerpilot_private.attested_listing_publication_release_sha(),
          false
        ),
      'orphanPendingReviews',
        sellerpilot_private.listing_publication_review_violation_count(),
      'effectiveOpen',
        sellerpilot_private.listing_mutation_release_gate_is_effective()
    );
$$;

revoke all on function
  public.sellerpilot_service_listing_mutation_release_gate_status()
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_listing_mutation_release_gate_status()
  to service_role;

alter function public.sellerpilot_service_set_listing_mutation_release_gate(boolean)
  rename to sellerpilot_301100_set_listing_gate_pre_publication_review;
revoke all on function
  public.sellerpilot_301100_set_listing_gate_pre_publication_review(boolean)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_set_listing_mutation_release_gate(
  p_open boolean,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans integer;
  v_attested_release text;
  v_active_runtime_release text;
  v_queued_or_running integer;
  v_reconciliation_required integer;
begin
  if p_open is null then
    raise exception 'listing mutation release-gate state required'
      using errcode = '22004';
  end if;
  if p_open and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$' then
    raise exception 'exact listing publication release required'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  perform 1
    from sellerpilot_private.listing_publication_adapter_release release
   order by release.channel
   for update;
  perform 1
    from sellerpilot_private.listing_publication_rechecker_release release
   where release.singleton
   for update;
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  if p_open then
    v_attested_release :=
      sellerpilot_private.attested_listing_publication_release_sha();
    if v_attested_release is null
       or v_attested_release is distinct from p_release_sha then
      raise exception 'all publication components must attest the exact release'
        using errcode = '55000';
    end if;
    v_active_runtime_release :=
      sellerpilot_private.active_serverless_runtime_release_sha();
    if v_active_runtime_release is null
       or v_active_runtime_release is distinct from p_release_sha then
      raise exception 'active serverless runtime must match the exact release'
        using errcode = '55000';
    end if;
    v_orphans :=
      sellerpilot_private.listing_publication_review_violation_count();
    if v_orphans <> 0 then
      raise exception 'orphan pending publication reviews must be resolved'
        using errcode = '55000';
    end if;
  end if;

  select count(*) filter (
           where job.status in ('queued', 'running')
         )::integer,
         count(*) filter (
           where job.status = 'reconciliation_required'
         )::integer
    into v_queued_or_running, v_reconciliation_required
    from sellerpilot_private.channel_gateway_jobs job
   where job.operation in ('listing.create', 'listing.update', 'listing.stop');
  if p_open and v_queued_or_running <> 0 then
    raise exception
      'listing mutation jobs must drain before release-gate activation'
      using errcode = '55000';
  end if;
  if p_open and v_reconciliation_required <> 0 then
    raise exception
      'listing mutation reconciliations must be resolved before release-gate activation'
      using errcode = '55000';
  end if;

  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = p_open,
         opened_at = case when p_open then clock_timestamp() else null end,
         opened_release_sha = case when p_open then p_release_sha else null end,
         updated_at = clock_timestamp()
   where gate.singleton;
  if not found then
    raise exception 'listing mutation release-gate state missing'
      using errcode = '55000';
  end if;

  return public.sellerpilot_service_listing_mutation_release_gate_status();
end;
$$;

revoke all on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean, text)
  to service_role;

-- Preserve a close-only compatibility signature. Opening without naming the
-- exact deployed SHA is deliberately impossible.
create function public.sellerpilot_service_set_listing_mutation_release_gate(
  p_open boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_open then
    raise exception 'exact listing publication release required'
      using errcode = '22023';
  end if;
  return public.sellerpilot_service_set_listing_mutation_release_gate(
    false,
    null::text
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean)
  to service_role;

comment on table sellerpilot_private.listing_publication_reviews is
  'Durable exact-source lifecycle for read-only rechecks of provider pending_review states.';
comment on function
  public.sellerpilot_service_enqueue_due_listing_publication_verifications(integer) is
  'Queues bounded listing.publication.verify reads without opening a provider mutation fence.';

commit;
