-- Consolidated non-CS release integrity changes. Keep the provider outcome that produced each durable competitor-price
-- snapshot. Price rows alone cannot distinguish a searched provider with zero
-- matches from a provider that was unavailable or failed.

begin;

-- A scheduled reaper must not depend on another worker claiming a job. This
-- marker was introduced by a later serverless-CS migration, so keep the final
-- consolidated migration independently replayable as well.
alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists provider_mutation_started_at timestamptz;

create index if not exists channel_gateway_jobs_expired_lease_idx
  on sellerpilot_private.channel_gateway_jobs (lease_expires_at, id)
  where status = 'running' and lease_expires_at is not null;

-- A nominal read operation is not safe to retry once durable state proves that
-- a credential refresh or provider mutation crossed its external side-effect
-- boundary. Keep this predicate shared by stale recovery and the activation
-- fence so an inconsistent operation label cannot hide uncertain provider work.
create or replace function sellerpilot_private.gateway_job_requires_reconciliation(
  p_operation text,
  p_credential_refresh_in_flight boolean,
  p_prepared_credential_id uuid,
  p_credential_refresh_recovery_vault_id uuid,
  p_oauth_exchange_completed boolean,
  p_provider_mutation_started_at timestamptz
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_credential_refresh_in_flight, false)
    or p_credential_refresh_recovery_vault_id is not null
    or p_provider_mutation_started_at is not null
    or (
      p_operation = 'oauth.exchange'
      and p_prepared_credential_id is not null
      and not coalesce(p_oauth_exchange_completed, false)
    )
    or p_operation in (
      'listing.create', 'listing.update', 'listing.stop',
      'price.update', 'inventory.update', 'inquiries.reply',
      'shipment.acknowledge', 'shipment.confirm'
    )
$$;

revoke all on function sellerpilot_private.gateway_job_requires_reconciliation(
  text, boolean, uuid, uuid, boolean, timestamptz
) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.valid_competitor_provider_snapshot(
  p_providers jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_providers is null
      or jsonb_typeof(p_providers) <> 'array'
      or jsonb_array_length(p_providers) not between 1 and 4
    then false
    else
      not exists (
        select 1
          from jsonb_array_elements(p_providers) provider(value)
         where case
           when jsonb_typeof(provider.value) <> 'object' then true
           else
             (
               select array_agg(key order by key)
                 from jsonb_object_keys(provider.value) key
             ) is distinct from array['count', 'marketplaces', 'provider', 'status']::text[]
             or jsonb_typeof(provider.value->'provider') <> 'string'
             or provider.value->>'provider' not in (
               'naver_shopping',
               'elevenst_product_search',
               'ebay_browse',
               'brave_marketplace_web'
             )
             or jsonb_typeof(provider.value->'status') <> 'string'
             or provider.value->>'status' not in ('searched', 'unavailable', 'failed')
             or jsonb_typeof(provider.value->'count') <> 'number'
             or coalesce(provider.value->>'count', '') !~ '^\d{1,6}$'
             or case
                  when coalesce(provider.value->>'count', '') ~ '^\d{1,6}$'
                    then (provider.value->>'count')::integer not between 0 and 100000
                      or (
                        provider.value->>'status' in ('unavailable', 'failed')
                        and (provider.value->>'count')::integer <> 0
                      )
                  else true
                end
             or jsonb_typeof(provider.value->'marketplaces') <> 'array'
             or case
                  when jsonb_typeof(provider.value->'marketplaces') <> 'array' then true
                  else
                    jsonb_array_length(provider.value->'marketplaces') not between 1 and 5
                    or exists (
                      select 1
                        from jsonb_array_elements(provider.value->'marketplaces') marketplace(value)
                       where jsonb_typeof(marketplace.value) <> 'string'
                          or marketplace.value #>> '{}' not in (
                            'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
                            'lazada', 'ebay', 'temu', 'other'
                          )
                    )
                    or (
                      select count(*) <> count(distinct marketplace.value #>> '{}')
                        from jsonb_array_elements(provider.value->'marketplaces') marketplace(value)
                    )
                    or case provider.value->>'provider'
                         when 'naver_shopping' then not (
                           provider.value->'marketplaces' @> '["smartstore","coupang","elevenst","qoo10","other"]'::jsonb
                           and provider.value->'marketplaces' <@ '["smartstore","coupang","elevenst","qoo10","other"]'::jsonb
                         )
                         when 'elevenst_product_search' then
                           provider.value->'marketplaces' <> '["elevenst"]'::jsonb
                         when 'ebay_browse' then
                           provider.value->'marketplaces' <> '["ebay"]'::jsonb
                         when 'brave_marketplace_web' then not (
                           provider.value->'marketplaces' @> '["shopee","lazada","temu"]'::jsonb
                           and provider.value->'marketplaces' <@ '["shopee","lazada","temu"]'::jsonb
                         )
                         else true
                       end
                end
           end
      )
      and (
        select count(*) = count(distinct provider.value->>'provider')
          from jsonb_array_elements(p_providers) provider(value)
      )
  end
$$;

revoke all on function sellerpilot_private.valid_competitor_provider_snapshot(jsonb)
  from public, anon, authenticated, service_role;

alter table sellerpilot_private.competitor_price_refresh_claims
  add column latest_providers jsonb not null default '[]'::jsonb,
  add column providers_fetched_at timestamptz,
  add constraint competitor_price_refresh_claims_provider_snapshot_check
    check (
      (
        latest_providers = '[]'::jsonb
        and providers_fetched_at is null
      )
      or (
        sellerpilot_private.valid_competitor_provider_snapshot(latest_providers)
        and providers_fetched_at is not null
      )
    );

comment on column sellerpilot_private.competitor_price_refresh_claims.latest_providers is
  'Latest successfully completed, claim-fenced competitor provider outcome snapshot.';
comment on column sellerpilot_private.competitor_price_refresh_claims.providers_fetched_at is
  'Database completion time paired atomically with latest_providers.';

alter table sellerpilot_private.competitor_price_refresh_claims enable row level security;
revoke all on sellerpilot_private.competitor_price_refresh_claims
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_complete_competitor_price_refresh(
  p_product_id uuid,
  p_claim_token uuid,
  p_items jsonb,
  p_providers jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_provider text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  if jsonb_array_length(p_items) > 30
     or not sellerpilot_private.valid_competitor_provider_snapshot(p_providers) then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  if (
       jsonb_array_length(p_items) = 0
       and exists (
         select 1
           from jsonb_array_elements(p_providers) provider(value)
          where provider.value->>'status' = 'searched'
            and provider.value->>'count' <> '0'
       )
     ) or exists (
       select 1
         from jsonb_array_elements(p_items) item(value)
        where jsonb_typeof(item.value) <> 'object'
           or coalesce(item.value->>'provider', '') not in (
             'naver_shopping',
             'elevenst_product_search',
             'ebay_browse',
             'brave_marketplace_web'
           )
           or not exists (
             select 1
               from jsonb_array_elements(p_providers) provider(value)
              where provider.value->>'provider' = item.value->>'provider'
                and provider.value->>'status' = 'searched'
                and provider.value->>'count' <> '0'
           )
     ) then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  -- Claim and completion both lock product before refresh state. Persisting the
  -- provider snapshot in the same locked update prevents an expired worker
  -- from replacing the latest provider truth after another worker reclaims it.
  perform 1
    from sellerpilot_private.products p
   where p.id = p_product_id
   for update;
  if not found then return -1; end if;

  perform 1
    from sellerpilot_private.competitor_price_refresh_claims c
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token
   for update;
  if not found then return -1; end if;

  for v_provider in
    select distinct provider.value->>'provider'
      from jsonb_array_elements(p_providers) provider(value)
     where provider.value->>'status' = 'searched'
  loop
    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = p_product_id
       and observation.provider = v_provider
       and not exists (
         select 1
           from jsonb_array_elements(p_items) item(value)
          where coalesce(nullif(item.value->>'provider', ''), 'naver_shopping') = v_provider
            and left(
              coalesce(
                nullif(trim(item.value->>'externalId'), ''),
                md5(coalesce(item.value->>'url', ''))
              ),
              500
            ) = observation.external_id
       );
  end loop;

  delete from sellerpilot_private.competitor_price_observations observation
   where observation.product_id = p_product_id
     and observation.provider <> 'manual'
     and observation.checked_at < now() - interval '7 days';

  select public.sellerpilot_service_record_competitor_prices(p_product_id, p_items)
    into v_count;

  update sellerpilot_private.competitor_price_refresh_claims c
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null,
         latest_providers = p_providers,
         providers_fetched_at = clock_timestamp()
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  to service_role;

alter function public.sellerpilot_get_product_operations_v2(uuid)
  rename to sellerpilot_get_product_operations_v2_pre_provider_state;

revoke all on function public.sellerpilot_get_product_operations_v2_pre_provider_state(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_prices jsonb;
  v_providers jsonb;
  v_providers_fetched_at timestamptz;
begin
  v_result := public.sellerpilot_get_product_operations_v2_pre_provider_state(p_product_id);
  if v_result is null then return null; end if;

  select c.latest_providers, c.providers_fetched_at
    into v_providers, v_providers_fetched_at
    from sellerpilot_private.competitor_price_refresh_claims c
   where c.product_id = p_product_id;

  select coalesce(
           jsonb_agg(
             price_item.value || jsonb_build_object(
               'provider', observation.provider,
               'preserved', case
                 when observation.provider = 'manual' then false
                 when observation.provider is null then true
                 else not exists (
                   select 1
                     from jsonb_array_elements(coalesce(v_providers, '[]'::jsonb)) provider(value)
                    where provider.value->>'provider' = observation.provider
                      and provider.value->>'status' = 'searched'
                 )
               end
             )
             order by price_item.ordinality
           ),
           '[]'::jsonb
         )
    into v_prices
    from jsonb_array_elements(coalesce(v_result->'competitorPrices', '[]'::jsonb))
      with ordinality price_item(value, ordinality)
    left join sellerpilot_private.competitor_price_observations observation
      on observation.product_id = p_product_id
     and observation.id::text = price_item.value->>'id';

  v_result := jsonb_set(v_result, '{competitorPrices}', v_prices, true);

  return v_result || jsonb_build_object(
    'competitorProviders', coalesce(v_providers, '[]'::jsonb),
    'competitorProvidersFetchedAt', v_providers_fetched_at
  );
end;
$$;

revoke all on function public.sellerpilot_get_product_operations_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid)
  to authenticated;

-- BEGIN:stale-channel-gateway-reaper
create or replace function public.sellerpilot_service_reap_stale_channel_gateway_jobs(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job record;
  v_status text;
  v_message text;
  v_retried integer := 0;
  v_failed integer := 0;
  v_reconciliation_required integer := 0;
  v_oauth_completed integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid stale gateway recovery limit';
  end if;

  -- Multiple maintenance invocations must not sweep the same stale lease, and
  -- none should wait behind another reaper. Claim/completion concurrency relies
  -- on row fences and is intentionally independent from this lock.
  -- Use a reaper-only key. The gateway completion/lineage transaction key is
  -- deliberately different, so even the one claimant that wins this try-lock
  -- cannot make a live completion wait behind stale-lease housekeeping.
  if not pg_catalog.pg_try_advisory_xact_lock(193674993, 821065043) then
    return jsonb_build_object(
      'retried', 0,
      'failed', 0,
      'reconciliationRequired', 0,
      'oauthCompleted', 0,
      'total', 0
    );
  end if;

  for v_job in
    select job.id,
           job.credential_id,
           job.attempt_id,
           job.channel,
           job.operation,
           job.attempt_count,
           job.response_payload,
           job.oauth_request_vault_id,
           job.oauth_exchange_completed,
           job.credential_refresh_in_flight,
           job.prepared_credential_id,
           job.credential_refresh_recovery_vault_id,
           job.provider_mutation_started_at
      from sellerpilot_private.channel_gateway_jobs job
     where job.status = 'running'
       and job.lease_expires_at is not null
       and job.lease_expires_at <= v_now
     order by job.lease_expires_at, job.id
     for update skip locked
     limit p_limit
  loop
    if v_job.oauth_exchange_completed and not v_job.credential_refresh_in_flight then
      v_status := 'succeeded';
      v_message := null;
      v_oauth_completed := v_oauth_completed + 1;
    elsif sellerpilot_private.gateway_job_requires_reconciliation(
      v_job.operation,
      v_job.credential_refresh_in_flight,
      v_job.prepared_credential_id,
      v_job.credential_refresh_recovery_vault_id,
      v_job.oauth_exchange_completed,
      v_job.provider_mutation_started_at
    ) then
      v_status := 'reconciliation_required';
      v_message := 'Gateway write lease expired; provider outcome requires reconciliation.';
      v_reconciliation_required := v_reconciliation_required + 1;
    elsif v_job.attempt_count >= 4 then
      v_status := 'failed';
      v_message := 'Channel worker lease expired four times.';
      v_failed := v_failed + 1;
    else
      v_status := 'queued';
      v_message := null;
      v_retried := v_retried + 1;
    end if;

    update sellerpilot_private.channel_gateway_jobs job
       set status = v_status,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = case when v_status = 'queued' then null else v_now end,
           error_message = v_message,
           response_payload = case
             when v_status = 'succeeded' then coalesce(
               v_job.response_payload,
               jsonb_build_object(
                 'ok', true,
                 'channel', v_job.channel,
                 'operation', 'oauth.exchange',
                 'safeMessage', 'OAuth credential was durably staged before worker completion was interrupted.'
               )
             )
             else job.response_payload
           end,
           updated_at = v_now
     where job.id = v_job.id
       and job.status = 'running'
       and job.lease_expires_at is not null
       and job.lease_expires_at <= v_now;

    if v_status <> 'queued' and v_job.oauth_request_vault_id is not null then
      delete from vault.secrets secret where secret.id = v_job.oauth_request_vault_id;
      update sellerpilot_private.channel_gateway_jobs job
         set oauth_request_vault_id = null,
             updated_at = v_now
       where job.id = v_job.id;
    end if;

    if v_status in ('failed', 'reconciliation_required') and v_job.attempt_id is not null then
      update sellerpilot_private.channel_operation_attempts attempt
         set status = case when v_status = 'reconciliation_required' then 'manual_required' else 'failed' end,
             http_status = case when v_status = 'reconciliation_required' then 409 else 503 end,
             safe_message = v_message,
             completed_at = v_now
       where attempt.id = v_job.attempt_id
         and attempt.status in ('running', 'failed', 'manual_required');
    end if;

    if v_status = 'reconciliation_required'
       and v_job.operation in ('listing.create', 'listing.update', 'listing.stop')
       and v_job.attempt_id is not null then
      update sellerpilot_private.product_listings listing
         set status = 'failed',
             last_error = v_message,
             failure_class = 'external_action',
             updated_at = v_now
       where listing.operation_attempt_id = v_job.attempt_id;
    end if;

    if v_status in ('failed', 'reconciliation_required')
       and v_job.operation in ('orders.list', 'inquiries.list') then
      perform public.sellerpilot_service_mark_channel_sync(
        v_job.credential_id,
        v_job.channel,
        case when v_job.operation = 'orders.list' then 'orders' else 'inquiries' end,
        'failed',
        v_message
      );
    end if;
  end loop;

  return jsonb_build_object(
    'retried', v_retried,
    'failed', v_failed,
    'reconciliationRequired', v_reconciliation_required,
    'oauthCompleted', v_oauth_completed,
    'total', v_retried + v_failed + v_reconciliation_required + v_oauth_completed
  );
end;
$$;

revoke all on function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  to service_role;
-- END:stale-channel-gateway-reaper

-- BEGIN:bounded-serverless-channel-gateway
-- Keep the Vercel worker's database authority narrower than the generic
-- gateway queue. This matrix mirrors the operations that have a durable remote
-- identity/readback contract; price.update and every undocumented channel pair
-- remain fail-closed.
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
    when 'diagnostic.test' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'categories.list' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'categories.suggest' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'categories.attributes' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'categories.validate' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'orders.list' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'orders.get' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'temu', 'smartstore', 'ebay'
      )
    when 'inquiries.list' then
      p_channel in ('qoo10', 'lazada', 'coupang', 'temu', 'smartstore', 'ebay')
    when 'inquiries.reply' then
      p_channel in ('qoo10', 'lazada', 'coupang', 'smartstore', 'ebay')
    when 'shops.get' then
      p_channel in ('shopee', 'lazada')
    when 'competitor.search' then
      p_channel = 'elevenst'
    when 'listing.lineage.verify' then
      p_channel in ('qoo10', 'shopee', 'lazada', 'ebay')
    when 'listing.create' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore', 'ebay'
      )
    when 'listing.update' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore'
      )
    when 'listing.stop' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'temu', 'smartstore'
      )
    when 'inventory.update' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang', 'temu', 'smartstore', 'ebay'
      )
    when 'shipment.acknowledge' then
      p_channel in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore')
    when 'shipment.confirm' then
      p_channel in (
        'qoo10', 'shopee', 'lazada', 'coupang', 'temu', 'smartstore', 'ebay'
      )
    when 'oauth.exchange' then
      p_channel in ('shopee', 'lazada', 'ebay')
    else false
  end;
$$;

revoke all on function sellerpilot_private.serverless_gateway_job_allowed(text, text)
  from public, anon, authenticated, service_role;

-- Coupang, Smartstore, 11st, and Temu all have provider-side IP allowlists.
-- A database rollout never proves that the current Vercel project owns an
-- approved static address, so new rows start disabled.
create table if not exists sellerpilot_private.serverless_static_egress_policy (
  channel text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.serverless_static_egress_policy
  enable row level security;
revoke all on sellerpilot_private.serverless_static_egress_policy
  from public, anon, authenticated, service_role;

alter table sellerpilot_private.serverless_static_egress_policy
  drop constraint if exists serverless_static_egress_policy_channel_check;
alter table sellerpilot_private.serverless_static_egress_policy
  add constraint serverless_static_egress_policy_channel_check
  check (channel in ('coupang', 'smartstore', 'elevenst', 'temu'));

insert into sellerpilot_private.serverless_static_egress_policy (channel, enabled)
values
  ('coupang', false),
  ('smartstore', false),
  ('elevenst', false),
  ('temu', false)
on conflict (channel) do nothing;

create or replace function sellerpilot_private.serverless_static_egress_allowed(
  p_channel text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with request_header as (
    select lower(trim(coalesce(
      nullif(
        coalesce(
          nullif(current_setting('request.headers', true), ''),
          '{}'
        )::jsonb ->> 'x-sellerpilot-static-egress-channels',
        ''
      ),
      ''
    ))) as value
  ), entries as (
    select trim(entry) as channel
      from request_header,
           lateral unnest(regexp_split_to_array(request_header.value, '\s*,\s*')) entry
     where request_header.value <> ''
  )
  select coalesce(
    p_channel in ('coupang', 'smartstore', 'elevenst', 'temu')
    and exists (
      select 1
        from sellerpilot_private.serverless_static_egress_policy policy
       where policy.channel = p_channel
         and policy.enabled
    )
    and exists (select 1 from entries where entries.channel = p_channel)
    and not exists (
      select 1
        from entries
       where entries.channel not in ('coupang', 'smartstore', 'elevenst', 'temu')
          or entries.channel = ''
    ),
    false
  );
$$;

revoke all on function sellerpilot_private.serverless_static_egress_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_serverless_static_egress_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'coupang', coalesce(bool_or(policy.enabled) filter (where policy.channel = 'coupang'), false),
    'smartstore', coalesce(bool_or(policy.enabled) filter (where policy.channel = 'smartstore'), false),
    'elevenst', coalesce(bool_or(policy.enabled) filter (where policy.channel = 'elevenst'), false),
    'temu', coalesce(bool_or(policy.enabled) filter (where policy.channel = 'temu'), false)
  )
  from sellerpilot_private.serverless_static_egress_policy policy;
$$;

revoke all on function public.sellerpilot_service_serverless_static_egress_status()
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_serverless_static_egress_status()
  to service_role;

-- OAuth credentials are committed through the Vault-backed refresh path, never
-- through the ordinary gateway response ledger. Keep this table-level fence in
-- addition to the runtime projection so generic and serverless completion
-- callers cannot persist a credential-shaped object, including under a nested
-- or newly introduced key. A narrow metadata allowlist also protects direct
-- service migrations and the row written before an HTTP completion reply is
-- returned to the worker.
create or replace function sellerpilot_private.sanitize_oauth_gateway_response_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok jsonb;
  v_safe_message text;
  v_expires_at text;
begin
  if new.operation <> 'oauth.exchange' or new.response_payload is null then
    return new;
  end if;

  v_ok := case
    when jsonb_typeof(new.response_payload->'ok') = 'boolean'
      then new.response_payload->'ok'
    else 'false'::jsonb
  end;
  v_safe_message := case
    when jsonb_typeof(new.response_payload->'safeMessage') = 'string'
      then left(new.response_payload->>'safeMessage', 1000)
    else null
  end;
  v_expires_at := case
    when jsonb_typeof(new.response_payload->'expiresAt') = 'string'
      then left(new.response_payload->>'expiresAt', 64)
    else null
  end;

  new.response_payload := jsonb_strip_nulls(jsonb_build_object(
    'ok', v_ok,
    'channel', new.channel,
    'operation', new.operation,
    'safeMessage', v_safe_message,
    'expiresAt', v_expires_at
  ));
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.sanitize_oauth_gateway_response_payload()
  from public, anon, authenticated, service_role;

drop trigger if exists sellerpilot_sanitize_oauth_gateway_response_payload
  on sellerpilot_private.channel_gateway_jobs;
create trigger sellerpilot_sanitize_oauth_gateway_response_payload
before insert or update of operation, response_payload
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.sanitize_oauth_gateway_response_payload();

-- Scrub any response produced between the provider-runtime rollout and this
-- database fence. Credential rotation already has its own Vault copy.
update sellerpilot_private.channel_gateway_jobs job
   set response_payload = job.response_payload
 where job.operation = 'oauth.exchange'
   and job.response_payload is not null;

drop index if exists sellerpilot_private.channel_gateway_jobs_serverless_cs_queue_idx;
create index if not exists channel_gateway_jobs_serverless_gateway_queue_idx
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
      'listing.create', 'listing.update', 'listing.stop',
      'inventory.update', 'shipment.acknowledge', 'shipment.confirm',
      'oauth.exchange'
    );

-- Coupang schedules nine bounded read jobs per five-minute window. A single
-- running slot can drain only five at the one-minute wake cadence, so permit
-- exactly two provider-read leases while keeping every mutation, OAuth,
-- diagnostic, and every other channel fully serialized. A short transaction-
-- scoped lock makes the count check race-free across credential rotations; it
-- never spans the remote provider request.
drop index if exists
  sellerpilot_private.channel_gateway_jobs_one_running_per_credential_idx;
create unique index if not exists
  channel_gateway_jobs_one_running_mutation_scope_idx
  on sellerpilot_private.channel_gateway_jobs (channel, environment)
  where status = 'running'
    and not (
      channel = 'coupang'
      and operation in ('orders.list', 'inquiries.list')
    );
create index if not exists channel_gateway_jobs_running_scope_idx
  on sellerpilot_private.channel_gateway_jobs
    (channel, environment, operation, id)
  where status = 'running';

create or replace function
  sellerpilot_private.guard_channel_gateway_running_parallelism()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_running integer;
  v_mutating integer;
begin
  if new.status <> 'running'
     or (
       tg_op = 'UPDATE'
       and old.status = 'running'
       and old.channel = new.channel
       and old.environment = new.environment
       and old.operation = new.operation
     ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    193674995,
    pg_catalog.hashtext(new.channel || ':' || new.environment)
  );

  select count(*),
         count(*) filter (where running.operation not in (
           'orders.list', 'inquiries.list'
         ))
    into v_running, v_mutating
    from sellerpilot_private.channel_gateway_jobs running
   where running.channel = new.channel
     and running.environment = new.environment
     and running.status = 'running'
     and running.id <> new.id;

  if new.channel = 'coupang'
     and new.operation in ('orders.list', 'inquiries.list') then
    if v_running >= 2 or v_mutating > 0 then
      raise exception using
        errcode = 'SPC02',
        message = 'Coupang read concurrency limit reached';
    end if;
  elsif v_running > 0 then
    raise exception using
      errcode = 'SPC02',
      message = 'channel gateway running operation already exists';
  end if;

  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_channel_gateway_running_parallelism()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_channel_gateway_running_parallelism
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_channel_gateway_running_parallelism
before insert or update of status, credential_id, channel, environment, operation
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_channel_gateway_running_parallelism();

-- Existing touch, credential-refresh, and completion wrappers all delegate to
-- the generic atomic implementation after this exact ownership check. Widening
-- the helper therefore preserves the proven claim-token and live-lease fence.
create or replace function sellerpilot_private.serverless_cs_job_is_owned(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_require_live_lease boolean default true
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
      join sellerpilot_private.channel_gateway_jobs job
        on job.worker_token_id = token.id
     where token.token_hash = p_token_hash
       and token.scope = 'serverless_cs'
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and job.id = p_job_id
       and job.claim_token = p_claim_token
       and sellerpilot_private.serverless_gateway_job_allowed(
         job.channel,
         job.operation
       )
       and (
         not p_require_live_lease
         or (
           job.status = 'running'
           and job.lease_expires_at > clock_timestamp()
         )
       )
  );
$$;

create or replace function sellerpilot_private.worker_token_may_complete_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and (
         token.scope = 'gateway'
         or (
           token.scope = 'serverless_cs'
           and (
             exists (
               select 1
                 from sellerpilot_private.channel_gateway_jobs job
                where job.id = p_job_id
                  and job.worker_token_id = token.id
                  and job.claim_token = p_claim_token
                  and sellerpilot_private.serverless_gateway_job_allowed(
                    job.channel,
                    job.operation
                  )
             )
             or exists (
               select 1
                 from sellerpilot_private.gateway_completion_receipts receipt
                 join sellerpilot_private.channel_gateway_jobs job
                   on job.id = receipt.job_id
                where receipt.job_id = p_job_id
                  and receipt.worker_token_id = token.id
                  and receipt.claim_token = p_claim_token
                  and sellerpilot_private.serverless_gateway_job_allowed(
                    job.channel,
                    job.operation
                  )
             )
           )
         )
       )
  );
$$;

revoke all on function sellerpilot_private.serverless_cs_job_is_owned(
  text, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.worker_token_may_complete_gateway_job(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_claim_serverless_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
  v_coupang_reads_waiting boolean := false;
  v_coupang_read_environment text;
  v_coupang_read_slot integer := 0;
  v_updated integer := 0;
begin
  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for share;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- Opportunistically recover expired leases before applying the running-job
  -- fence below. The reaper uses pg_try_advisory_xact_lock, so exactly one
  -- concurrent claimant does the bounded sweep while every loser continues
  -- immediately to SKIP LOCKED claiming. Reads are safely requeued; an expired
  -- provider mutation keeps the existing reconciliation-required rule.
  perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);

  -- The Vercel drain starts several independent claim transactions at once.
  -- Two non-blocking transaction slots let two Coupang reads advance in the
  -- same wake without allowing every concurrent claimant to race through the
  -- running-count predicate. While a read wave is queued, claimants that miss
  -- both slots simply consider other channels; Coupang mutations wait for the
  -- bounded read wave to empty and retain their single-writer fence.
  select queued_read.environment
    into v_coupang_read_environment
    from sellerpilot_private.channel_gateway_jobs queued_read
    join sellerpilot_private.channel_credentials queued_credential
      on queued_credential.id = queued_read.credential_id
     and queued_credential.channel = queued_read.channel
     and queued_credential.status = 'active'
     and (
       queued_credential.expires_at is null
       or queued_credential.expires_at > clock_timestamp()
     )
   where queued_read.status = 'queued'
     and queued_read.channel = 'coupang'
     and queued_read.operation in ('orders.list', 'inquiries.list')
     and queued_read.seller_account_key is not distinct from
           queued_credential.seller_account_key
     and sellerpilot_private.serverless_static_egress_allowed('coupang')
   order by queued_read.created_at, queued_read.id
   limit 1;
  v_coupang_reads_waiting := v_coupang_read_environment is not null;

  if v_coupang_reads_waiting then
    if pg_catalog.pg_try_advisory_xact_lock(
      193674996,
      pg_catalog.hashtext(
        'coupang:' || v_coupang_read_environment || ':read-slot-1'
      )
    ) then
      v_coupang_read_slot := 1;
    elsif pg_catalog.pg_try_advisory_xact_lock(
      193674996,
      pg_catalog.hashtext(
        'coupang:' || v_coupang_read_environment || ':read-slot-2'
      )
    ) then
      v_coupang_read_slot := 2;
    end if;
  end if;

  -- FOR SHARE keeps concurrent claimers compatible while preventing token
  -- revocation from racing credential disclosure. The first immediate touch
  -- records worker version/last-seen. Scheduled maintenance remains a second
  -- recovery path and never serializes this SKIP LOCKED claim path.

  -- Rebind only queued work to an active credential for the exact same seller.
  -- A live provider call always keeps the credential incarnation it claimed.
  update sellerpilot_private.channel_gateway_jobs job
     set credential_id = active_credential.id,
         updated_at = clock_timestamp()
    from sellerpilot_private.channel_credentials old_credential,
         sellerpilot_private.channel_credentials active_credential
   where job.credential_id = old_credential.id
     and job.status = 'queued'
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
     and old_credential.status <> 'active'
     and active_credential.channel = old_credential.channel
     and active_credential.environment = old_credential.environment
     and active_credential.status = 'active'
     and (active_credential.expires_at is null
       or active_credential.expires_at > clock_timestamp())
     and active_credential.seller_account_key is not distinct from
           job.seller_account_key
     and active_credential.id <> old_credential.id;

  select job.id
    into v_job_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = job.channel
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
   where job.status = 'queued'
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
     and (
       job.channel not in ('coupang', 'smartstore', 'elevenst', 'temu')
       or sellerpilot_private.serverless_static_egress_allowed(job.channel)
     )
     and job.seller_account_key is not distinct from
           credential.seller_account_key
     and (
       job.channel <> 'ebay'
       or job.operation = 'oauth.exchange'
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )
     and (
       (
         job.channel = 'coupang'
         and job.operation in ('orders.list', 'inquiries.list')
         and job.environment = v_coupang_read_environment
         and v_coupang_read_slot > 0
         and (
           select count(*)
             from sellerpilot_private.channel_gateway_jobs running
            where running.channel = credential.channel
              and running.environment = credential.environment
              and running.status = 'running'
         ) < 2
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs running
            where running.channel = credential.channel
              and running.environment = credential.environment
              and running.status = 'running'
              and running.operation not in ('orders.list', 'inquiries.list')
         )
       )
       or (
         not (
           job.channel = 'coupang'
           and job.operation in ('orders.list', 'inquiries.list')
         )
         and (
           job.channel <> 'coupang'
           or not v_coupang_reads_waiting
           or job.environment is distinct from v_coupang_read_environment
         )
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs running
            where running.channel = credential.channel
              and running.environment = credential.environment
              and running.status = 'running'
         )
       )
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs unresolved
         join sellerpilot_private.channel_credentials unresolved_credential
           on unresolved_credential.id = unresolved.credential_id
        where unresolved_credential.channel = credential.channel
          and unresolved_credential.environment = credential.environment
          and unresolved.status = 'reconciliation_required'
          and (
            unresolved.credential_refresh_in_flight
            or unresolved.credential_refresh_recovery_vault_id is not null
            or (
              unresolved.operation = 'oauth.exchange'
              and unresolved.prepared_credential_id is not null
              and not unresolved.oauth_exchange_completed
            )
          )
     )
     and not (
       job.channel = 'ebay'
       and job.operation = 'inquiries.reply'
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs recent_job
           cross join lateral jsonb_array_elements(
             case
               when jsonb_typeof(recent_job.response_payload->'steps') = 'array'
                 then recent_job.response_payload->'steps'
               else '[]'::jsonb
             end
           ) provider_step
          where recent_job.channel = 'ebay'
            and recent_job.operation = 'inquiries.reply'
            and recent_job.environment = job.environment
            and recent_job.seller_account_key = job.seller_account_key
            and recent_job.completed_at >= clock_timestamp() - interval '100 seconds'
            and (
              provider_step->>'status' = '429'
              or exists (
                select 1
                  from jsonb_array_elements(
                    case
                      when jsonb_typeof(provider_step#>'{data,errors}') = 'array'
                        then provider_step#>'{data,errors}'
                      else '[]'::jsonb
                    end
                  ) provider_error
                 where provider_error->>'errorCode' = '518'
              )
            )
       )
     )
   order by
     case when job.prepared_credential_id is null then 1 else 0 end,
     case when job.attempt_id is null then 1 else 0 end,
     case
       when job.operation = 'inquiries.reply' then 0
       when coalesce(job.request_payload->>'periodicKey', '') like 'inquiries:history:%'
         or nullif(job.request_payload #>> '{arguments,sellerpilotHistoryRunId}', '') is not null
         then 2
       else 1
     end,
     job.created_at,
     job.id
   for update of job skip locked
   for share of credential
   limit 1;
  if v_job_id is null then
    return null;
  end if;

  v_claim_token := gen_random_uuid();
  begin
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'running',
           worker_token_id = v_token_id,
           claim_token = v_claim_token,
           attempt_count = job.attempt_count + 1,
           lease_expires_at = clock_timestamp() + interval '15 minutes',
           started_at = coalesce(job.started_at, clock_timestamp()),
           error_message = null,
           updated_at = clock_timestamp()
     where job.id = v_job_id;
    get diagnostics v_updated = row_count;
  exception
    -- A concurrent claimant may have filled the channel slot after this
    -- transaction evaluated its snapshot. This is ordinary empty-capacity,
    -- not a worker/database failure; every unrelated SQL error still escapes.
    when sqlstate 'SPC02' then
      return null;
  end;
  if v_updated <> 1 then
    return null;
  end if;

  select jsonb_build_object(
    'id', job.id,
    'claim_token', job.claim_token,
    'credential_id', job.credential_id,
    'channel', job.channel,
    'operation', job.operation,
    'environment', job.environment,
    'request', case
      when job.operation = 'oauth.exchange'
        then oauth_request.decrypted_secret::jsonb
      else job.request_payload
    end,
    'attempt_count', job.attempt_count,
    'credential', credential_secret.decrypted_secret::jsonb
  )
    into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join vault.decrypted_secrets credential_secret
      on credential_secret.id = credential.vault_secret_id
    left join vault.decrypted_secrets oauth_request
      on oauth_request.id = job.oauth_request_vault_id
   where job.id = v_job_id
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and (
       job.operation <> 'oauth.exchange'
       or oauth_request.decrypted_secret is not null
     );

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed',
           error_message = 'Active credential or OAuth request could not be decrypted.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where job.id = v_job_id;

    delete from vault.secrets secret
     using sellerpilot_private.channel_gateway_jobs job
     where secret.id = job.oauth_request_vault_id
       and job.id = v_job_id
       and job.oauth_request_vault_id is not null;
    update sellerpilot_private.channel_gateway_jobs job
       set oauth_request_vault_id = null,
           updated_at = clock_timestamp()
     where job.id = v_job_id
       and job.oauth_request_vault_id is not null;
  end if;

  return v_result;
end;
$$;

-- A code-first rollout calls the new RPC and falls back to the existing narrow
-- CS claimant while this migration is still pending. Never widen that old
-- claimant in-place: an older Vercel runtime would otherwise claim a non-CS
-- job that its TypeScript allowlist cannot execute. Only reduced migration
-- fixtures without the dedicated runtime need a compatibility definition.
do $migration$
begin
  if to_regprocedure(
    'public.sellerpilot_claim_serverless_cs_job(text,text)'
  ) is null then
    execute $create$
      create function public.sellerpilot_claim_serverless_cs_job(
        p_token_hash text,
        p_worker_version text default null
      )
      returns jsonb
      language sql
      security definer
      set search_path = ''
      as $function$
        select public.sellerpilot_claim_serverless_gateway_job(
          p_token_hash,
          p_worker_version
        )
      $function$
    $create$;
  end if;
end;
$migration$;

create or replace function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
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
  v_started boolean;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    return false;
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at = coalesce(
           job.provider_mutation_started_at,
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id = p_job_id
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
     and job.operation in (
       'listing.create', 'listing.update', 'listing.stop',
       'inventory.update', 'inquiries.reply',
       'shipment.acknowledge', 'shipment.confirm'
     )
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
  returning true into v_started;

  return coalesce(v_started, false);
end;
$$;

create or replace function public.sellerpilot_service_begin_serverless_cs_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    p_token_hash,
    p_job_id,
    p_claim_token
  )
$$;

-- When the bounded serverless token is healthy, non-fixed channels hand work
-- to it. Fixed-egress channels never fall back to an unattested local/default
-- process, including when the serverless token is expired or absent.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_base constant text := $base$where j.status = 'queued'
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running$base$;
  v_old constant text := $old$and not (
       (
         j.channel in ('coupang', 'smartstore')
         and j.operation in ('inquiries.list', 'inquiries.reply')
       )
       or (
         j.channel in ('qoo10', 'ebay')
         and j.operation in ('inquiries.list', 'inquiries.reply')
         and exists (
           select 1
             from sellerpilot_private.ai_cli_worker_tokens serverless_token
            where serverless_token.scope = 'serverless_cs'
              and serverless_token.status = 'active'
         )
       )
     )$old$;
  v_new constant text := $new$and not (
       (
         j.channel in ('coupang', 'smartstore', 'elevenst', 'temu')
         and sellerpilot_private.serverless_gateway_job_allowed(
           j.channel,
           j.operation
         )
       )
       or (
         sellerpilot_private.serverless_gateway_job_allowed(
           j.channel,
           j.operation
         )
         and exists (
           select 1
             from sellerpilot_private.ai_cli_worker_tokens serverless_token
            where serverless_token.scope = 'serverless_cs'
              and serverless_token.status = 'active'
              and serverless_token.expires_at > clock_timestamp()
         )
       )
     )$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if position('serverless_gateway_job_allowed' in v_definition) > 0 then
    return;
  elsif (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old) = 1 then
    v_rewritten := replace(v_definition, v_old, v_new);
  elsif (
    length(v_definition) - length(replace(v_definition, v_base, ''))
  ) / length(v_base) = 1 then
    v_rewritten := replace(
      v_definition,
      v_base,
      format('where j.status = ''queued''%s     %s%s', chr(10), v_new, chr(10))
        || '     and not exists (' || chr(10)
        || '       select 1' || chr(10)
        || '         from sellerpilot_private.channel_gateway_jobs running'
    );
  else
    raise exception 'expected one generic serverless handoff insertion point';
  end if;
  if v_rewritten = v_definition
     or position('serverless_gateway_job_allowed' in v_rewritten) = 0 then
    raise exception 'generic serverless handoff guard rewrite failed';
  end if;
  execute v_rewritten;
end;
$migration$;

revoke all on function public.sellerpilot_claim_serverless_gateway_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_serverless_gateway_job(text, text)
  to service_role;
revoke all on function public.sellerpilot_claim_serverless_cs_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_serverless_cs_job(text, text)
  to service_role;

revoke all on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) to service_role;
revoke all on function
  public.sellerpilot_service_begin_serverless_cs_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_serverless_cs_provider_mutation(
    text, uuid, uuid
  ) to service_role;

comment on function public.sellerpilot_claim_serverless_gateway_job(text, text) is
  'Claims one exact allowlisted channel operation for the bounded Vercel gateway, with Vault-backed OAuth and fixed-egress fences.';
comment on function public.sellerpilot_claim_serverless_cs_job(text, text) is
  'Compatibility claimant retained for the previously released bounded CS runtime.';
-- END:bounded-serverless-channel-gateway

-- BEGIN:marketplace-normalized-asset-retention
-- Marketplace payloads use content-addressed JPEGs. Keep upload intent durable
-- before the Storage write, then retain only assets referenced by the latest
-- successful listing image mutation (plus uncertain/in-flight attempts).
-- Cleanup remains a claim/complete queue so a Storage outage never loses the
-- database evidence required for a later retry.
create table if not exists sellerpilot_private.marketplace_normalized_assets (
  object_path text primary key,
  content_sha256 text not null unique check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'reserved'
    check (status in ('reserved', 'available', 'cleanup_running')),
  uploaded_at timestamptz,
  cleanup_after timestamptz not null default
    (clock_timestamp() + interval '30 days'),
  cleanup_claim_token uuid,
  cleanup_lease_expires_at timestamptz,
  cleanup_attempt_count integer not null default 0
    check (cleanup_attempt_count between 0 and 20),
  last_error text check (last_error is null or length(last_error) <= 180),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    object_path = 'normalized/' || left(content_sha256, 2) || '/'
      || content_sha256 || '.jpg'
  ),
  check (
    (status = 'cleanup_running'
      and cleanup_claim_token is not null
      and cleanup_lease_expires_at is not null)
    or
    (status in ('reserved', 'available')
      and cleanup_claim_token is null
      and cleanup_lease_expires_at is null)
  )
);

create table if not exists sellerpilot_private.marketplace_normalized_asset_refs (
  id uuid primary key default gen_random_uuid(),
  object_path text not null references
    sellerpilot_private.marketplace_normalized_assets(object_path)
    on delete cascade,
  attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id)
    on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id)
    on delete cascade,
  channel text not null check (channel in (
    'qoo10', 'shopee', 'lazada', 'coupang',
    'elevenst', 'temu', 'smartstore', 'ebay'
  )),
  market text not null default '' check (length(market) <= 80),
  target_id text not null default '' check (length(target_id) <= 160),
  upload_confirmed_at timestamptz,
  retained_by_listing boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (attempt_id, object_path)
);

create index if not exists marketplace_normalized_assets_cleanup_idx
  on sellerpilot_private.marketplace_normalized_assets
    (cleanup_after, created_at, object_path)
  where status in ('reserved', 'available');
create index if not exists marketplace_normalized_assets_lease_idx
  on sellerpilot_private.marketplace_normalized_assets
    (cleanup_lease_expires_at)
  where status = 'cleanup_running';
create index if not exists marketplace_normalized_asset_refs_scope_idx
  on sellerpilot_private.marketplace_normalized_asset_refs
    (product_id, channel, market, target_id, retained_by_listing);
create index if not exists marketplace_normalized_asset_refs_attempt_idx
  on sellerpilot_private.marketplace_normalized_asset_refs (attempt_id);
create index if not exists marketplace_normalized_asset_refs_object_idx
  on sellerpilot_private.marketplace_normalized_asset_refs (object_path);
create index if not exists marketplace_normalized_asset_refs_owner_idx
  on sellerpilot_private.marketplace_normalized_asset_refs (owner_id);

alter table sellerpilot_private.marketplace_normalized_assets
  enable row level security;
alter table sellerpilot_private.marketplace_normalized_asset_refs
  enable row level security;
revoke all on sellerpilot_private.marketplace_normalized_assets
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.marketplace_normalized_asset_refs
  from public, anon, authenticated, service_role;

create or replace function
  public.sellerpilot_service_register_marketplace_normalized_asset_refs(
    p_attempt_id uuid,
    p_product_id uuid,
    p_channel text,
    p_market text,
    p_target_id text,
    p_paths text[]
  )
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_market text := upper(trim(coalesce(p_market, '')));
  v_target_id text := trim(coalesce(p_target_id, ''));
  v_path text;
  v_digest text;
  v_ordered_paths text[];
begin
  if p_attempt_id is null
     or p_product_id is null
     or p_channel not in (
       'qoo10', 'shopee', 'lazada', 'coupang',
       'elevenst', 'temu', 'smartstore', 'ebay'
     )
     or length(v_market) > 80
     or length(v_target_id) > 160
     or coalesce(cardinality(p_paths), 0) not between 1 and 32
     or (select count(*) from unnest(p_paths) path) <>
        (select count(distinct path) from unnest(p_paths) path)
     or exists (
       select 1
         from unnest(p_paths) path
        where path is null
           or path !~ '^normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
           or split_part(path, '/', 2) <> left(
             substring(path from '^normalized/[0-9a-f]{2}/([0-9a-f]{64})\.jpg$'),
             2
           )
     ) then
    raise exception 'invalid marketplace normalized asset reservation';
  end if;

  select attempt.*
    into v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = p_attempt_id
     and attempt.channel = p_channel
     and attempt.operation in ('listing.create', 'listing.update')
     and attempt.status = 'running'
   for share;
  if not found
     or not exists (
       select 1
         from sellerpilot_private.products product
        where product.id = p_product_id
          and product.owner_id = v_attempt.owner_id
          and not product.demo
          and product.status <> 'archived'
     ) then
    raise exception 'running listing image attempt required';
  end if;

  if v_attempt.operation = 'listing.update'
     and not exists (
       select 1
         from sellerpilot_private.product_listings listing
        where listing.owner_id = v_attempt.owner_id
          and listing.product_id = p_product_id
          and listing.channel_key = p_channel
          and listing.market = v_market
          and listing.target_id = v_target_id
     ) then
    raise exception 'matching listing image scope required';
  end if;

  select array_agg(path order by path)
    into v_ordered_paths
    from unnest(p_paths) path;

  -- Content-addressed paths can be shared across attempts. Always acquire
  -- their row locks in the same order so concurrent multi-image products do
  -- not form an inverted lock cycle.
  foreach v_path in array v_ordered_paths loop
    v_digest := substring(
      v_path from '^normalized/[0-9a-f]{2}/([0-9a-f]{64})\.jpg$'
    );

    insert into sellerpilot_private.marketplace_normalized_assets (
      object_path, content_sha256
    ) values (v_path, v_digest)
    on conflict (object_path) do nothing;

    update sellerpilot_private.marketplace_normalized_assets asset
       set cleanup_after = greatest(
             asset.cleanup_after,
             clock_timestamp() + interval '30 days'
           ),
           last_error = null,
           updated_at = clock_timestamp()
     where asset.object_path = v_path
       and asset.content_sha256 = v_digest
       and asset.status <> 'cleanup_running';
    if not found then
      raise exception 'marketplace normalized asset cleanup in progress';
    end if;

    insert into sellerpilot_private.marketplace_normalized_asset_refs (
      object_path, attempt_id, owner_id, product_id,
      channel, market, target_id
    ) values (
      v_path, p_attempt_id, v_attempt.owner_id, p_product_id,
      p_channel, v_market, v_target_id
    )
    on conflict (attempt_id, object_path) do nothing;

    if not exists (
      select 1
        from sellerpilot_private.marketplace_normalized_asset_refs ref
       where ref.attempt_id = p_attempt_id
         and ref.object_path = v_path
         and ref.owner_id = v_attempt.owner_id
         and ref.product_id = p_product_id
         and ref.channel = p_channel
         and ref.market = v_market
         and ref.target_id = v_target_id
    ) then
      raise exception 'marketplace normalized asset reference mismatch';
    end if;
  end loop;

  return true;
end;
$$;

create or replace function
  public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded(
    p_attempt_id uuid,
    p_paths text[]
  )
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected integer := coalesce(cardinality(p_paths), 0);
  v_updated integer;
begin
  if p_attempt_id is null
     or v_expected not between 1 and 32
     or (select count(*) from unnest(p_paths) path) <>
        (select count(distinct path) from unnest(p_paths) path)
     or exists (
       select 1 from unnest(p_paths) path
        where path is null
           or path !~ '^normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
     )
     or not exists (
       select 1
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = p_attempt_id
          and attempt.operation in ('listing.create', 'listing.update')
          and attempt.status = 'running'
     ) then
    raise exception 'invalid marketplace normalized asset upload';
  end if;

  update sellerpilot_private.marketplace_normalized_asset_refs ref
     set upload_confirmed_at = coalesce(
           ref.upload_confirmed_at,
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
   where ref.attempt_id = p_attempt_id
     and ref.object_path = any(p_paths);
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'marketplace normalized asset reservation required';
  end if;

  update sellerpilot_private.marketplace_normalized_assets asset
     set status = 'available',
         uploaded_at = coalesce(asset.uploaded_at, clock_timestamp()),
         cleanup_after = greatest(
           asset.cleanup_after,
           clock_timestamp() + interval '30 days'
         ),
         last_error = null,
         updated_at = clock_timestamp()
   where asset.object_path = any(p_paths)
     and asset.status = 'reserved';

  if (
    select count(*)
      from sellerpilot_private.marketplace_normalized_assets asset
     where asset.object_path = any(p_paths)
       and asset.status = 'available'
  ) <> v_expected then
    raise exception 'marketplace normalized asset upload state mismatch';
  end if;

  return true;
end;
$$;

-- Flip retained refs only after a create/update reaches the published ledger.
-- A later failed update leaves the previous refs current; a successful stop
-- also leaves them protected because the paused remote listing still renders
-- the same images.
create or replace function
  sellerpilot_private.retain_current_marketplace_normalized_asset_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_operation text;
  v_attempt_status text;
begin
  if new.operation_attempt_id is null or new.status <> 'published' then
    return new;
  end if;

  select attempt.operation, attempt.status
    into v_operation, v_attempt_status
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = new.operation_attempt_id;
  if v_operation not in ('listing.create', 'listing.update')
     or v_attempt_status <> 'succeeded' then
    return new;
  end if;

  update sellerpilot_private.marketplace_normalized_asset_refs ref
     set retained_by_listing = (
           ref.attempt_id = new.operation_attempt_id
           and ref.upload_confirmed_at is not null
         ),
         updated_at = clock_timestamp()
   where ref.product_id = new.product_id
     and ref.channel = new.channel_key
     and ref.market = new.market
     and ref.target_id = new.target_id
     and ref.retained_by_listing is distinct from (
       ref.attempt_id = new.operation_attempt_id
       and ref.upload_confirmed_at is not null
     );
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.retain_current_marketplace_normalized_asset_refs()
  from public, anon, authenticated, service_role;

drop trigger if exists sellerpilot_retain_marketplace_normalized_assets
  on sellerpilot_private.product_listings;
create trigger sellerpilot_retain_marketplace_normalized_assets
after insert or update of status, operation_attempt_id
on sellerpilot_private.product_listings
for each row execute function
  sellerpilot_private.retain_current_marketplace_normalized_asset_refs();

create or replace function
  public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(
    p_limit integer default 200,
    p_lease_seconds integer default 120
  )
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_lease_seconds integer := least(
    greatest(coalesce(p_lease_seconds, 120), 30),
    900
  );
  v_claim_token uuid := gen_random_uuid();
  v_paths jsonb;
begin
  update sellerpilot_private.marketplace_normalized_assets asset
     set status = case when asset.uploaded_at is null
           then 'reserved' else 'available' end,
         cleanup_claim_token = null,
         cleanup_lease_expires_at = null,
         cleanup_after = clock_timestamp(),
         last_error = coalesce(asset.last_error, 'cleanup_lease_expired'),
         updated_at = clock_timestamp()
   where asset.status = 'cleanup_running'
     and asset.cleanup_lease_expires_at <= clock_timestamp();

  with selected as (
    select asset.object_path
      from sellerpilot_private.marketplace_normalized_assets asset
     where asset.status in ('reserved', 'available')
       and asset.cleanup_after <= clock_timestamp()
       and not exists (
         select 1
           from sellerpilot_private.marketplace_normalized_asset_refs ref
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id = ref.attempt_id
          where ref.object_path = asset.object_path
            and attempt.status in ('running', 'manual_required')
       )
       and not exists (
         select 1
           from sellerpilot_private.marketplace_normalized_asset_refs ref
           join sellerpilot_private.products product
             on product.id = ref.product_id
            and product.status <> 'archived'
           join sellerpilot_private.product_listings listing
             on listing.owner_id = ref.owner_id
            and listing.product_id = ref.product_id
            and listing.channel_key = ref.channel
            and listing.market = ref.market
            and listing.target_id = ref.target_id
          where ref.object_path = asset.object_path
            and ref.retained_by_listing
            and ref.upload_confirmed_at is not null
            and (
              listing.status in ('queued', 'published', 'paused')
              or (
                listing.status = 'failed'
                and nullif(trim(coalesce(listing.remote_id, '')), '') is not null
              )
            )
       )
     order by asset.object_path
     for update of asset skip locked
     limit v_limit
  ), claimed as (
    update sellerpilot_private.marketplace_normalized_assets asset
       set status = 'cleanup_running',
           cleanup_claim_token = v_claim_token,
           cleanup_lease_expires_at = clock_timestamp()
             + make_interval(secs => v_lease_seconds),
           cleanup_attempt_count = least(
             asset.cleanup_attempt_count + 1,
             20
           ),
           updated_at = clock_timestamp()
      from selected
     where asset.object_path = selected.object_path
    returning asset.object_path
  )
  select jsonb_agg(claimed.object_path order by claimed.object_path)
    into v_paths
    from claimed;

  if v_paths is null then return null; end if;
  return jsonb_build_object(
    'claimToken', v_claim_token,
    'bucket', 'sellerpilot-marketplace',
    'paths', v_paths
  );
end;
$$;

create or replace function
  public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
    p_claim_token uuid,
    p_removed_paths text[],
    p_error text default null
  )
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer := 0;
  v_requeued integer := 0;
begin
  if p_claim_token is null
     or coalesce(cardinality(p_removed_paths), 0) > 500
     or exists (
       select 1
         from unnest(coalesce(p_removed_paths, array[]::text[])) path
        where path is null
           or path !~ '^normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
     ) then
    raise exception 'invalid marketplace normalized asset cleanup completion';
  end if;

  delete from sellerpilot_private.marketplace_normalized_assets asset
   where asset.status = 'cleanup_running'
     and asset.cleanup_claim_token = p_claim_token
     and asset.object_path = any(
       coalesce(p_removed_paths, array[]::text[])
     );
  get diagnostics v_removed = row_count;

  update sellerpilot_private.marketplace_normalized_assets asset
     set status = case when asset.uploaded_at is null
           then 'reserved' else 'available' end,
         cleanup_claim_token = null,
         cleanup_lease_expires_at = null,
         cleanup_after = clock_timestamp() + make_interval(
           secs => least(
             900,
             greatest(30, asset.cleanup_attempt_count * 30)
           )
         ),
         last_error = left(coalesce(
           nullif(trim(p_error), ''),
           'storage_remove_incomplete'
         ), 180),
         updated_at = clock_timestamp()
   where asset.status = 'cleanup_running'
     and asset.cleanup_claim_token = p_claim_token;
  get diagnostics v_requeued = row_count;

  return jsonb_build_object('removed', v_removed, 'requeued', v_requeued);
end;
$$;

revoke all on function
  public.sellerpilot_service_register_marketplace_normalized_asset_refs(
    uuid, uuid, text, text, text, text[]
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_register_marketplace_normalized_asset_refs(
    uuid, uuid, text, text, text, text[]
  ) to service_role;
revoke all on function
  public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded(
    uuid, text[]
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded(
    uuid, text[]
  ) to service_role;
revoke all on function
  public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(
    integer, integer
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(
    integer, integer
  ) to service_role;
revoke all on function
  public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
    uuid, text[], text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
    uuid, text[], text
  ) to service_role;
-- END:marketplace-normalized-asset-retention

-- BEGIN:push-delivery-lease-fence
-- Web Push delivery used to move directly from pending to sending without a
-- claim token or lease. A terminated Vercel invocation therefore left the row
-- stuck forever, while blindly retrying it could notify the same device twice.
-- Keep the legacy one-argument claimant rolling-compatible, but mark those
-- claims as provider-started immediately. The two-argument claimant is the new
-- prepare/begin/finish protocol and can safely retry only before begin succeeds.
alter table sellerpilot_private.push_notification_deliveries
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claim_protocol text,
  add column if not exists provider_send_started_at timestamptz,
  add column if not exists reconciliation_required_at timestamptz;

alter table sellerpilot_private.push_notification_deliveries
  drop constraint if exists push_notification_deliveries_status_check;
alter table sellerpilot_private.push_notification_deliveries
  drop constraint if exists push_notification_deliveries_claim_lifecycle_check;

-- A pre-migration sending row may already have reached the push provider. It
-- cannot be truthfully retried, so close it as uncertain before installing the
-- new lifecycle constraint.
update sellerpilot_private.push_notification_deliveries delivery
   set status = 'reconciliation_required',
       claim_token = null,
       lease_expires_at = null,
       claim_protocol = null,
       provider_send_started_at = coalesce(
         delivery.provider_send_started_at,
         delivery.updated_at,
         delivery.created_at
       ),
       reconciliation_required_at = clock_timestamp(),
       last_error = left(coalesce(
         nullif(trim(delivery.last_error), ''),
         'Push delivery was already sending during the lease-fence rollout; provider outcome requires reconciliation.'
       ), 300),
       updated_at = clock_timestamp()
 where delivery.status = 'sending';

alter table sellerpilot_private.push_notification_deliveries
  add constraint push_notification_deliveries_status_check
    check (status in (
      'pending', 'preparing', 'sending', 'sent', 'failed',
      'reconciliation_required'
    )) not valid;
alter table sellerpilot_private.push_notification_deliveries
  validate constraint push_notification_deliveries_status_check;

alter table sellerpilot_private.push_notification_deliveries
  add constraint push_notification_deliveries_claim_lifecycle_check check (
    (
      status = 'preparing'
      and claim_token is not null
      and lease_expires_at is not null
      and claim_protocol = 'fenced_v2'
      and provider_send_started_at is null
      and reconciliation_required_at is null
    )
    or (
      status = 'sending'
      and claim_token is not null
      and lease_expires_at is not null
      and claim_protocol in ('legacy_v1', 'fenced_v2')
      and provider_send_started_at is not null
      and reconciliation_required_at is null
    )
    or (
      status not in ('preparing', 'sending')
      and claim_token is null
      and lease_expires_at is null
      and claim_protocol is null
      and (
        (status = 'reconciliation_required' and reconciliation_required_at is not null)
        or
        (status <> 'reconciliation_required' and reconciliation_required_at is null)
      )
    )
  ) not valid;
alter table sellerpilot_private.push_notification_deliveries
  validate constraint push_notification_deliveries_claim_lifecycle_check;

create index if not exists push_notification_deliveries_expired_lease_idx
  on sellerpilot_private.push_notification_deliveries (lease_expires_at, id)
  where status in ('preparing', 'sending')
    and lease_expires_at is not null;

-- Compatibility claimant for an already-running Vercel deployment. Because
-- that runtime has no begin call, claiming must conservatively mean the remote
-- send may start. Its failures and lease expiry are therefore never retried.
create or replace function public.sellerpilot_service_claim_push_deliveries(
  p_limit integer default 25
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  event_type text,
  title text,
  body text,
  target_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Daily maintenance is the durable fallback, while active dispatch traffic
  -- should not leave an expired lease blocked until the next day.
  perform public.sellerpilot_service_reap_stale_push_deliveries(25);

  return query
  with candidates as (
    select delivery.id
      from sellerpilot_private.push_notification_deliveries delivery
      join sellerpilot_private.push_subscriptions subscription
        on subscription.id = delivery.subscription_id
       and subscription.enabled
     where delivery.status in ('pending', 'failed')
       and delivery.next_attempt_at <= clock_timestamp()
       and delivery.attempt_count < 5
     order by delivery.created_at, delivery.id
     for update of delivery skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update sellerpilot_private.push_notification_deliveries delivery
       set status = 'sending',
           attempt_count = delivery.attempt_count + 1,
           claim_token = gen_random_uuid(),
           lease_expires_at = clock_timestamp() + interval '2 minutes',
           claim_protocol = 'legacy_v1',
           provider_send_started_at = clock_timestamp(),
           reconciliation_required_at = null,
           last_error = null,
           updated_at = clock_timestamp()
      from candidates candidate
     where delivery.id = candidate.id
    returning delivery.id, delivery.subscription_id,
              delivery.notification_id
  )
  select claimed.id, subscription.id, subscription.endpoint,
         subscription.p256dh, subscription.auth_secret,
         notification.event_type, notification.title, notification.body,
         notification.target_url
    from claimed
    join sellerpilot_private.push_subscriptions subscription
      on subscription.id = claimed.subscription_id
    join sellerpilot_private.push_notification_outbox notification
      on notification.id = claimed.notification_id;
end;
$$;

-- Fenced claimant used by the new runtime. The additional required lease
-- argument avoids PostgREST overload ambiguity with the legacy one-argument
-- function while keeping the public RPC name stable.
create or replace function public.sellerpilot_service_claim_push_deliveries(
  p_limit integer,
  p_lease_seconds integer
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  event_type text,
  title text,
  body text,
  target_url text,
  claim_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception 'invalid push delivery claim';
  end if;

  perform public.sellerpilot_service_reap_stale_push_deliveries(25);

  return query
  with candidates as (
    select delivery.id
      from sellerpilot_private.push_notification_deliveries delivery
      join sellerpilot_private.push_subscriptions subscription
        on subscription.id = delivery.subscription_id
       and subscription.enabled
     where delivery.status in ('pending', 'failed')
       and delivery.next_attempt_at <= clock_timestamp()
       and delivery.attempt_count < 5
     order by delivery.created_at, delivery.id
     for update of delivery skip locked
     limit p_limit
  ), claimed as (
    update sellerpilot_private.push_notification_deliveries delivery
       set status = 'preparing',
           attempt_count = delivery.attempt_count + 1,
           claim_token = gen_random_uuid(),
           lease_expires_at = clock_timestamp()
             + make_interval(secs => p_lease_seconds),
           claim_protocol = 'fenced_v2',
           provider_send_started_at = null,
           reconciliation_required_at = null,
           last_error = null,
           updated_at = clock_timestamp()
      from candidates candidate
     where delivery.id = candidate.id
    returning delivery.id, delivery.subscription_id,
              delivery.notification_id, delivery.claim_token,
              delivery.lease_expires_at
  )
  select claimed.id, subscription.id, subscription.endpoint,
         subscription.p256dh, subscription.auth_secret,
         notification.event_type, notification.title, notification.body,
         notification.target_url, claimed.claim_token,
         claimed.lease_expires_at
    from claimed
    join sellerpilot_private.push_subscriptions subscription
      on subscription.id = claimed.subscription_id
    join sellerpilot_private.push_notification_outbox notification
      on notification.id = claimed.notification_id;
end;
$$;

create or replace function public.sellerpilot_service_begin_push_delivery(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  if p_delivery_id is null or p_claim_token is null then return false; end if;

  update sellerpilot_private.push_notification_deliveries delivery
     set status = 'sending',
         provider_send_started_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where delivery.id = p_delivery_id
     and delivery.status = 'preparing'
     and delivery.claim_protocol = 'fenced_v2'
     and delivery.claim_token = p_claim_token
     and delivery.lease_expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_service_finish_push_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery sellerpilot_private.push_notification_deliveries%rowtype;
  v_effective_status text;
  v_subscription_id uuid;
begin
  if p_delivery_id is null or p_claim_token is null
     or p_status not in (
       'sent', 'failed', 'gone', 'reconciliation_required'
     ) then
    raise exception 'invalid push result';
  end if;

  select delivery.*
    into v_delivery
    from sellerpilot_private.push_notification_deliveries delivery
   where delivery.id = p_delivery_id
     and delivery.claim_token = p_claim_token
     and delivery.status in ('preparing', 'sending')
   for update;
  if not found then return false; end if;

  -- A fenced sender must durably begin before reporting a provider success or
  -- an expired subscription. A pre-send failure is safe to retry.
  if v_delivery.status = 'preparing'
     and p_status in ('sent', 'gone') then
    return false;
  end if;

  v_effective_status := case
    when p_status = 'sent' then 'sent'
    when p_status = 'gone' then 'failed'
    when p_status = 'reconciliation_required' then 'reconciliation_required'
    when v_delivery.status = 'sending'
         and v_delivery.lease_expires_at <= clock_timestamp()
      then 'reconciliation_required'
    else 'failed'
  end;
  v_subscription_id := v_delivery.subscription_id;

  update sellerpilot_private.push_notification_deliveries delivery
     set status = v_effective_status,
         claim_token = null,
         lease_expires_at = null,
         claim_protocol = null,
         provider_send_started_at = case
           when v_effective_status in ('sent', 'reconciliation_required')
             then delivery.provider_send_started_at
           else null
         end,
         reconciliation_required_at = case
           when v_effective_status = 'reconciliation_required'
             then clock_timestamp()
           else null
         end,
         sent_at = case
           when v_effective_status = 'sent' then clock_timestamp()
           else null
         end,
         next_attempt_at = case
           when v_effective_status = 'failed' and p_status <> 'gone'
             then clock_timestamp() + interval '5 minutes'
           else delivery.next_attempt_at
         end,
         last_error = case
           when v_effective_status = 'sent' then null
           when v_effective_status = 'reconciliation_required' then left(
             coalesce(
               nullif(trim(p_error), ''),
               'Push provider outcome is unknown; automatic resend is blocked.'
             ),
             300
           )
           else left(coalesce(
             nullif(trim(p_error), ''),
             'push delivery failed'
           ), 300)
         end,
         updated_at = clock_timestamp()
   where delivery.id = p_delivery_id
     and delivery.claim_token = p_claim_token;

  if p_status = 'gone' then
    update sellerpilot_private.push_subscriptions subscription
       set enabled = false,
           updated_at = clock_timestamp()
     where subscription.id = v_subscription_id;
  end if;
  return true;
end;
$$;

-- Rolling compatibility completion. A legacy runtime has no claim token and
-- may already have contacted the provider; its generic failure is therefore
-- uncertain rather than retryable. Sent and gone remain truthful terminals.
create or replace function public.sellerpilot_service_finish_push_delivery(
  p_delivery_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_token uuid;
begin
  if p_status not in ('sent', 'failed', 'gone') then
    raise exception 'invalid push result';
  end if;

  select delivery.claim_token
    into v_claim_token
    from sellerpilot_private.push_notification_deliveries delivery
   where delivery.id = p_delivery_id
     and delivery.status = 'sending'
     and delivery.claim_protocol = 'legacy_v1'
     and delivery.claim_token is not null
   for update;
  if v_claim_token is null then return false; end if;

  return public.sellerpilot_service_finish_push_delivery(
    p_delivery_id,
    v_claim_token,
    case when p_status = 'failed'
      then 'reconciliation_required'
      else p_status
    end,
    p_error
  );
end;
$$;

create or replace function public.sellerpilot_service_reap_stale_push_deliveries(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retried integer := 0;
  v_reconciliation_required integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid stale push delivery recovery limit';
  end if;

  with selected as (
    select delivery.id,
           (
             delivery.status = 'preparing'
             and delivery.provider_send_started_at is null
           ) as safe_to_retry
      from sellerpilot_private.push_notification_deliveries delivery
     where delivery.status in ('preparing', 'sending')
       and delivery.lease_expires_at is not null
       and delivery.lease_expires_at <= clock_timestamp()
     order by delivery.lease_expires_at, delivery.id
     for update skip locked
     limit p_limit
  ), recovered as (
    update sellerpilot_private.push_notification_deliveries delivery
       set status = case
             when selected.safe_to_retry then 'failed'
             else 'reconciliation_required'
           end,
           claim_token = null,
           lease_expires_at = null,
           claim_protocol = null,
           provider_send_started_at = case
             when selected.safe_to_retry then null
             else delivery.provider_send_started_at
           end,
           reconciliation_required_at = case
             when selected.safe_to_retry then null
             else clock_timestamp()
           end,
           next_attempt_at = case
             when selected.safe_to_retry then clock_timestamp()
             else delivery.next_attempt_at
           end,
           last_error = case
             when selected.safe_to_retry
               then 'Push delivery lease expired before provider send; retry is safe.'
             else 'Push provider outcome is unknown after delivery lease expiry; automatic resend is blocked.'
           end,
           updated_at = clock_timestamp()
      from selected
     where delivery.id = selected.id
    returning selected.safe_to_retry
  )
  select count(*) filter (where recovered.safe_to_retry)::integer,
         count(*) filter (where not recovered.safe_to_retry)::integer
    into v_retried, v_reconciliation_required
    from recovered;

  return jsonb_build_object(
    'retried', coalesce(v_retried, 0),
    'reconciliationRequired', coalesce(v_reconciliation_required, 0),
    'total', coalesce(v_retried, 0) + coalesce(v_reconciliation_required, 0)
  );
end;
$$;

revoke all on function public.sellerpilot_service_claim_push_deliveries(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_claim_push_deliveries(integer)
  to service_role;
revoke all on function public.sellerpilot_service_claim_push_deliveries(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_claim_push_deliveries(integer, integer)
  to service_role;
revoke all on function public.sellerpilot_service_begin_push_delivery(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_push_delivery(uuid, uuid)
  to service_role;
revoke all on function public.sellerpilot_service_finish_push_delivery(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_finish_push_delivery(uuid, uuid, text, text)
  to service_role;
revoke all on function public.sellerpilot_service_finish_push_delivery(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_finish_push_delivery(uuid, text, text)
  to service_role;
revoke all on function public.sellerpilot_service_reap_stale_push_deliveries(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_reap_stale_push_deliveries(integer)
  to service_role;
-- END:push-delivery-lease-fence

-- The server product-research route has an immediate post-enqueue wake and a
-- Supabase recovery schedule. Keep the local AI worker focused on generated
-- product assets so it cannot race that server-owned model and cost boundary.
create or replace function public.sellerpilot_claim_product_ai_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
  v_context jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'ai'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where token.id = v_token_id;

  update sellerpilot_private.ai_cli_jobs job
     set status = case when job.attempt_count >= 3 then 'failed' else 'queued' end,
         error_message = case
           when job.attempt_count >= 3 then 'CLI worker lease expired three times.'
           else job.error_message
         end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = case
           when job.attempt_count >= 3 then job.available_at
           else clock_timestamp()
         end,
         completed_at = case
           when job.attempt_count >= 3 then clock_timestamp()
           else job.completed_at
         end,
         updated_at = clock_timestamp()
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running'
     and job.lease_expires_at < clock_timestamp();

  select job.id
    into v_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'queued'
     and job.available_at <= clock_timestamp()
   order by job.available_at, job.created_at
   for update skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.ai_cli_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         available_at = clock_timestamp(),
         started_at = coalesce(job.started_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.status = 'queued';
  if not found then
    raise exception 'product AI job claim lost its row lock';
  end if;

  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, job_id, safe_detail
  ) values (
    'job_claimed',
    v_token_id,
    v_job_id,
    jsonb_build_object(
      'worker_version', left(coalesce(p_worker_version, ''), 80),
      'claim_scope', 'product'
    )
  );

  select jsonb_build_object(
           'id', job.id,
           'claim_token', job.claim_token,
           'kind', job.kind,
           'request', job.request_payload,
           'attempt_count', job.attempt_count,
           'claim_scope', 'product'
         ),
         job.terminal_image_failure_context
    into v_result, v_context
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = v_claim_token;
  if not found then
    raise exception 'claimed product AI job ownership mismatch';
  end if;
  if v_context is not null then
    v_result := v_result || jsonb_build_object(
      'terminal_image_failure_context', v_context
    );
  end if;
  return v_result;
end;
$$;

revoke all on function
  public.sellerpilot_claim_product_ai_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_product_ai_job(text, text)
  to service_role;
comment on function public.sellerpilot_claim_product_ai_job(text, text) is
  'Claims product studio and asset-regeneration jobs; product research is server-owned.';

-- BEGIN:hobby-safe-internal-schedules
-- Keep Vercel Cron empty and run all six periodic runtime routes from
-- Supabase Cron. The database stores only the existing HMAC-derived wake
-- bearer, never the raw Vercel CRON_SECRET. Every schedule is installed
-- inactive and is activated together with the gateway wake only after the
-- production no-work canaries succeed.

-- Correct the earlier wake classifier: only an authentication/route contract
-- error is permanent. Rate limits, request timeouts, 5xx responses and
-- transport failures are retryable, with a five-minute 429 backoff so one
-- transient provider response cannot either pause or hammer the scheduler.
create or replace function sellerpilot_private.reconcile_serverless_cs_wakeups()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivered integer := 0;
  v_retryable integer := 0;
  v_permanent integer := 0;
  v_stale integer := 0;
begin
  with resolved as (
    update sellerpilot_private.serverless_cs_wake_requests wake
       set outcome = case
             when response.status_code between 200 and 299 then 'delivered'
             when response.status_code in (401, 403, 404, 405, 410) then 'permanent_failure'
             else 'retryable_failure'
           end,
           http_status = response.status_code,
           timed_out = coalesce(response.timed_out, false),
           safe_error_code = case
             when response.status_code between 200 and 299 then null
             when response.status_code in (401, 403) then 'wake_auth_rejected'
             when response.status_code = 404 then 'wake_route_not_found'
             when response.status_code = 405 then 'wake_method_not_allowed'
             when response.status_code = 410 then 'wake_route_gone'
             when response.status_code = 408 then 'wake_request_timeout'
             when response.status_code = 425 then 'wake_too_early'
             when response.status_code = 429 then 'wake_rate_limited'
             when coalesce(response.timed_out, false) then 'network_timeout'
             when response.error_msg is not null then 'network_transport_error'
             when response.status_code is null then 'network_response_missing'
             when response.status_code >= 500 then 'upstream_5xx'
             else 'upstream_retryable'
           end,
           resolved_at = clock_timestamp()
      from net._http_response response
     where wake.request_id = response.id
       and wake.outcome = 'queued'
    returning wake.request_id, wake.outcome
  ), deleted_responses as (
    delete from net._http_response response
     using resolved
     where response.id = resolved.request_id
    returning response.id
  )
  select
    count(*) filter (where resolved.outcome = 'delivered')::integer,
    count(*) filter (where resolved.outcome = 'retryable_failure')::integer,
    count(*) filter (where resolved.outcome = 'permanent_failure')::integer
    into v_delivered, v_retryable, v_permanent
    from resolved;

  with stale as (
    update sellerpilot_private.serverless_cs_wake_requests wake
       set outcome = 'retryable_failure',
           timed_out = true,
           safe_error_code = 'network_response_expired',
           resolved_at = clock_timestamp()
     where wake.outcome = 'queued'
       and wake.requested_at < clock_timestamp() - interval '6 minutes'
    returning wake.request_id
  )
  select count(*)::integer into v_stale from stale;

  return jsonb_build_object(
    'delivered', coalesce(v_delivered, 0),
    'retryableFailures', coalesce(v_retryable, 0) + coalesce(v_stale, 0),
    'permanentFailures', coalesce(v_permanent, 0)
  );
end;
$$;

create or replace function sellerpilot_private.schedule_serverless_cs_wakeup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wake_secret text;
  v_request_id bigint;
  v_latest_outcome text;
  v_latest_error text;
  v_latest_requested_at timestamptz;
  v_retry_after interval;
  v_cron_job_id bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);
  perform sellerpilot_private.reconcile_serverless_cs_wakeups();

  delete from sellerpilot_private.serverless_cs_wake_requests wake
   where wake.outcome <> 'queued'
     and wake.requested_at < clock_timestamp() - interval '30 days';

  select job.jobid
    into v_cron_job_id
    from cron.job job
   where job.jobname = 'sellerpilot-serverless-cs-wake-v1'
   limit 1;
  if v_cron_job_id is not null then
    delete from cron.job_run_details run
     where run.jobid = v_cron_job_id
       and run.end_time < clock_timestamp() - interval '7 days';
  end if;

  if exists (
    select 1 from sellerpilot_private.serverless_cs_wake_requests wake
     where wake.outcome = 'queued'
  ) then
    return null;
  end if;

  select wake.outcome, wake.safe_error_code, wake.requested_at
    into v_latest_outcome, v_latest_error, v_latest_requested_at
    from sellerpilot_private.serverless_cs_wake_requests wake
   order by wake.requested_at desc, wake.request_id desc
   limit 1;

  if v_latest_outcome = 'permanent_failure' then
    if v_cron_job_id is not null then
      perform cron.alter_job(job_id := v_cron_job_id, active := false);
    end if;
    return null;
  end if;
  if v_latest_outcome = 'retryable_failure' then
    v_retry_after := case
      when v_latest_error = 'wake_rate_limited' then interval '5 minutes'
      else interval '1 minute'
    end;
    if v_latest_requested_at > clock_timestamp() - v_retry_after then
      return null;
    end if;
  end if;

  select decrypted.decrypted_secret
    into v_wake_secret
    from vault.secrets secret
    join vault.decrypted_secrets decrypted on decrypted.id = secret.id
   where secret.name = 'sellerpilot_serverless_cs_wake_v1'
   order by secret.created_at desc, secret.id
   limit 1;
  if coalesce(v_wake_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    if v_cron_job_id is not null then
      perform cron.alter_job(job_id := v_cron_job_id, active := false);
    end if;
    raise warning 'serverless CS wake secret unavailable; scheduler paused';
    return null;
  end if;

  select net.http_post(
    url := 'https://sellerpilot-global.vercel.app/api/internal/channel-gateway-drain',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_wake_secret,
      'Content-Type', 'application/json',
      'User-Agent', 'SellerPilot-Supabase-Cron/2',
      'X-SellerPilot-Wake-Version', 'serverless_runtime_v2'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  ) into v_request_id;

  insert into sellerpilot_private.serverless_cs_wake_requests (
    request_id, requested_at
  ) values (
    v_request_id, clock_timestamp()
  );
  return v_request_id;
end;
$$;

revoke all on function sellerpilot_private.reconcile_serverless_cs_wakeups()
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.schedule_serverless_cs_wakeup()
  from public, anon, authenticated, service_role;

create table if not exists sellerpilot_private.internal_schedule_requests (
  request_id bigint primary key,
  route_key text not null check (
    route_key in (
      'product_research', 'channel_sync', 'competitor_prices',
      'kakao_notifications', 'maintenance'
    )
  ),
  requested_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  outcome text not null default 'queued' check (
    outcome in (
      'queued', 'delivered', 'transient_failure', 'permanent_failure',
      'permanent_failure_acknowledged'
    )
  ),
  http_status integer,
  timed_out boolean,
  safe_error_code text,
  check (
    (outcome = 'queued' and resolved_at is null)
    or (outcome <> 'queued' and resolved_at is not null)
  )
);

create index if not exists internal_schedule_requests_route_latest_idx
  on sellerpilot_private.internal_schedule_requests (
    route_key, requested_at desc, request_id desc
  );

alter table sellerpilot_private.internal_schedule_requests enable row level security;
revoke all on sellerpilot_private.internal_schedule_requests
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.reconcile_internal_schedule_requests(
  p_route_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_route_key is not null
     and p_route_key not in (
       'product_research', 'channel_sync', 'competitor_prices',
       'kakao_notifications', 'maintenance'
     ) then
    raise exception 'invalid internal schedule route';
  end if;

  update sellerpilot_private.internal_schedule_requests request
     set outcome = case
           when response.status_code between 200 and 299 then 'delivered'
           when response.status_code in (401, 403, 404, 405, 410) then 'permanent_failure'
           else 'transient_failure'
         end,
         resolved_at = clock_timestamp(),
         http_status = response.status_code,
         timed_out = coalesce(response.timed_out, false),
         safe_error_code = case
           when response.status_code between 200 and 299 then null
           when response.status_code in (401, 403) then 'schedule_auth_rejected'
           when response.status_code = 404 then 'schedule_route_missing'
           when response.status_code = 405 then 'schedule_method_not_allowed'
           when response.status_code = 410 then 'schedule_route_gone'
           when response.status_code = 408 then 'schedule_request_timeout'
           when response.status_code = 425 then 'schedule_too_early'
           when response.status_code = 429 then 'schedule_rate_limited'
           when coalesce(response.timed_out, false) then 'schedule_timeout'
           when response.status_code >= 500 then 'schedule_upstream_unavailable'
           when response.error_msg is not null then 'schedule_transport_failed'
           else 'schedule_invalid_response'
         end
    from net._http_response response
   where request.request_id = response.id
     and request.outcome = 'queued'
     and (p_route_key is null or request.route_key = p_route_key);

  delete from net._http_response response
   using sellerpilot_private.internal_schedule_requests request
   where response.id = request.request_id
     and request.outcome <> 'queued'
     and (p_route_key is null or request.route_key = p_route_key);

  -- pg_net has a bounded under-five-minute request timeout. A response that is
  -- still absent ten minutes later cannot still be executing, so release the
  -- overlap guard without copying provider messages or response bodies.
  update sellerpilot_private.internal_schedule_requests request
     set outcome = 'transient_failure',
         resolved_at = clock_timestamp(),
         timed_out = true,
         safe_error_code = 'schedule_response_missing'
   where request.outcome = 'queued'
     and request.requested_at < clock_timestamp() - interval '10 minutes'
     and (p_route_key is null or request.route_key = p_route_key)
     and not exists (
       select 1 from net._http_response response
        where response.id = request.request_id
     );
end;
$$;

create or replace function sellerpilot_private.schedule_internal_route(
  p_route_key text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bearer text;
  v_cron_job_id bigint;
  v_job_name text;
  v_latest_error text;
  v_latest_outcome text;
  v_latest_requested_at timestamptz;
  v_retry_after interval;
  v_request_id bigint;
  v_url text;
begin
  if p_route_key not in (
    'product_research', 'channel_sync', 'competitor_prices',
    'kakao_notifications', 'maintenance'
  ) then
    raise exception 'invalid internal schedule route';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    case p_route_key
      when 'product_research' then 821065051
      when 'channel_sync' then 821065052
      when 'competitor_prices' then 821065053
      when 'kakao_notifications' then 821065054
      else 821065055
    end
  );
  perform sellerpilot_private.reconcile_internal_schedule_requests(p_route_key);

  delete from sellerpilot_private.internal_schedule_requests request
   where request.route_key = p_route_key
     and request.outcome <> 'queued'
     and request.requested_at < clock_timestamp() - interval '30 days';

  v_job_name := case p_route_key
    when 'product_research' then 'sellerpilot-product-research-v1'
    when 'channel_sync' then 'sellerpilot-channel-sync-v1'
    when 'competitor_prices' then 'sellerpilot-competitor-prices-v1'
    when 'kakao_notifications' then 'sellerpilot-kakao-notifications-v1'
    else 'sellerpilot-maintenance-v1'
  end;
  v_url := case p_route_key
    when 'product_research' then
      'https://sellerpilot-global.vercel.app/api/internal/product-research'
    when 'channel_sync' then
      'https://sellerpilot-global.vercel.app/api/internal/channel-sync'
    when 'competitor_prices' then
      'https://sellerpilot-global.vercel.app/api/internal/competitor-prices'
    when 'kakao_notifications' then
      'https://sellerpilot-global.vercel.app/api/internal/kakao-notifications'
    else
      'https://sellerpilot-global.vercel.app/api/internal/maintenance'
  end;

  select job.jobid
    into v_cron_job_id
    from cron.job job
   where job.jobname = v_job_name
   limit 1;
  if v_cron_job_id is null then
    raise warning 'internal schedule is not installed: %', p_route_key;
    return null;
  end if;

  delete from cron.job_run_details run
   where run.jobid = v_cron_job_id
     and run.end_time < clock_timestamp() - interval '7 days';

  if exists (
    select 1
      from sellerpilot_private.internal_schedule_requests request
     where request.route_key = p_route_key
       and request.outcome = 'queued'
  ) then
    return null;
  end if;

  select request.outcome, request.safe_error_code, request.requested_at
    into v_latest_outcome, v_latest_error, v_latest_requested_at
    from sellerpilot_private.internal_schedule_requests request
   where request.route_key = p_route_key
   order by request.requested_at desc, request.request_id desc
   limit 1;
  if v_latest_outcome = 'permanent_failure' then
    perform cron.alter_job(job_id := v_cron_job_id, active := false);
    return null;
  end if;
  if v_latest_outcome = 'transient_failure' then
    v_retry_after := case
      when v_latest_error = 'schedule_rate_limited' then interval '5 minutes'
      else interval '1 minute'
    end;
    if v_latest_requested_at > clock_timestamp() - v_retry_after then
      return null;
    end if;
  end if;

  select decrypted.decrypted_secret
    into v_bearer
    from vault.secrets secret
    join vault.decrypted_secrets decrypted on decrypted.id = secret.id
   where secret.name = 'sellerpilot_serverless_cs_wake_v1'
   order by secret.created_at desc, secret.id
   limit 1;
  if coalesce(v_bearer, '') !~ '^[A-Za-z0-9_-]{43}$' then
    perform cron.alter_job(job_id := v_cron_job_id, active := false);
    raise warning 'internal schedule bearer unavailable; scheduler paused: %', p_route_key;
    return null;
  end if;

  select net.http_get(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_bearer,
      'User-Agent', 'SellerPilot-Supabase-Cron/2',
      'X-SellerPilot-Schedule-Version', 'internal_schedule_v1'
    ),
    timeout_milliseconds := 285000
  ) into v_request_id;

  insert into sellerpilot_private.internal_schedule_requests (
    request_id, route_key, requested_at
  ) values (
    v_request_id, p_route_key, clock_timestamp()
  );
  return v_request_id;
end;
$$;

revoke all on function
  sellerpilot_private.reconcile_internal_schedule_requests(text)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.schedule_internal_route(text)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'sellerpilot-product-research-v1',
  '*/5 * * * *',
  $$select sellerpilot_private.schedule_internal_route('product_research');$$
);
select cron.schedule(
  'sellerpilot-channel-sync-v1',
  '1-59/5 * * * *',
  $$select sellerpilot_private.schedule_internal_route('channel_sync');$$
);
select cron.schedule(
  'sellerpilot-competitor-prices-v1',
  '3-59/5 * * * *',
  $$select sellerpilot_private.schedule_internal_route('competitor_prices');$$
);
select cron.schedule(
  'sellerpilot-kakao-notifications-v1',
  '4-59/5 * * * *',
  $$select sellerpilot_private.schedule_internal_route('kakao_notifications');$$
);
select cron.schedule(
  'sellerpilot-maintenance-v1',
  '17 18 * * *',
  $$select sellerpilot_private.schedule_internal_route('maintenance');$$
);

-- Applying the release cannot start any marketplace read or write. The
-- bootstrap script reactivates all six schedules only after the deployed
-- gateway and five internal routes return their no-work canary responses in
-- the same process.
select cron.alter_job(job_id := job.jobid, active := false)
  from cron.job job
 where job.jobname in (
   'sellerpilot-serverless-cs-wake-v1',
   'sellerpilot-product-research-v1',
   'sellerpilot-channel-sync-v1',
   'sellerpilot-competitor-prices-v1',
   'sellerpilot-kakao-notifications-v1',
   'sellerpilot-maintenance-v1'
 );

create table if not exists sellerpilot_private.serverless_runtime_canary_receipts (
  id uuid primary key default gen_random_uuid(),
  release_id text not null check (release_id ~ '^[0-9a-f]{40}$'),
  version text not null default 'serverless_runtime_v2' check (
    version = 'serverless_runtime_v2'
  ),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (
    clock_timestamp() + interval '10 minutes'
  ),
  passed_at timestamptz,
  consumed_at timestamptz,
  check (expires_at > created_at),
  check (passed_at is null or passed_at >= created_at),
  check (consumed_at is null or (passed_at is not null and consumed_at >= passed_at))
);

alter table sellerpilot_private.serverless_runtime_canary_receipts
  enable row level security;
revoke all on sellerpilot_private.serverless_runtime_canary_receipts
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_begin_serverless_runtime_canary(
  p_release_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_configured_count integer;
  v_receipt_id uuid;
begin
  if coalesce(p_release_id, '') !~ '^[0-9a-f]{40}$' then
    raise exception 'exact release id required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065060);
  select count(*)::integer,
         count(*) filter (where job.active)::integer
    into v_configured_count, v_active_count
    from cron.job job
   where job.jobname in (
     'sellerpilot-serverless-cs-wake-v1',
     'sellerpilot-product-research-v1',
     'sellerpilot-channel-sync-v1',
     'sellerpilot-competitor-prices-v1',
     'sellerpilot-kakao-notifications-v1',
     'sellerpilot-maintenance-v1'
   );
  if v_configured_count <> 6 or v_active_count <> 0 then
    raise exception 'all serverless runtime schedules must be installed and inactive'
      using errcode = '55000';
  end if;
  delete from sellerpilot_private.serverless_runtime_canary_receipts receipt
   where receipt.expires_at < clock_timestamp() - interval '1 day';
  insert into sellerpilot_private.serverless_runtime_canary_receipts (release_id)
  values (p_release_id)
  returning id into v_receipt_id;
  return v_receipt_id;
end;
$$;

create or replace function public.sellerpilot_service_complete_serverless_runtime_canary(
  p_receipt_id uuid,
  p_release_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed boolean;
begin
  if p_receipt_id is null or coalesce(p_release_id, '') !~ '^[0-9a-f]{40}$' then
    return false;
  end if;
  update sellerpilot_private.serverless_runtime_canary_receipts receipt
     set passed_at = coalesce(receipt.passed_at, clock_timestamp())
   where receipt.id = p_receipt_id
     and receipt.release_id = p_release_id
     and receipt.passed_at is null
     and receipt.consumed_at is null
     and receipt.expires_at > clock_timestamp()
  returning true into v_completed;
  return coalesce(v_completed, false);
end;
$$;

create or replace function sellerpilot_private.set_serverless_runtime_schedules_active(
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_configured_count integer;
  v_has_bearer boolean;
begin
  if p_active is null then
    raise exception 'scheduler state required';
  end if;

  select count(*)::integer,
         count(*) filter (where job.active)::integer
    into v_configured_count, v_active_count
    from cron.job job
   where job.jobname in (
     'sellerpilot-serverless-cs-wake-v1',
     'sellerpilot-product-research-v1',
     'sellerpilot-channel-sync-v1',
     'sellerpilot-competitor-prices-v1',
     'sellerpilot-kakao-notifications-v1',
     'sellerpilot-maintenance-v1'
   );

  if p_active and v_configured_count <> 6 then
    raise exception 'serverless runtime schedules are not installed'
      using errcode = '55000';
  end if;

  select exists (
    select 1
      from vault.secrets secret
      join vault.decrypted_secrets decrypted on decrypted.id = secret.id
     where secret.name = 'sellerpilot_serverless_cs_wake_v1'
       and decrypted.decrypted_secret ~ '^[A-Za-z0-9_-]{43}$'
  ) into v_has_bearer;
  if p_active and not v_has_bearer then
    raise exception 'serverless runtime bearer is not configured'
      using errcode = '55000';
  end if;

  if p_active then
    update sellerpilot_private.serverless_cs_wake_requests request
       set outcome = 'permanent_failure_acknowledged'
     where request.outcome = 'permanent_failure';
    update sellerpilot_private.internal_schedule_requests request
       set outcome = 'permanent_failure_acknowledged'
     where request.outcome = 'permanent_failure';
  end if;

  perform cron.alter_job(job_id := job.jobid, active := p_active)
    from cron.job job
   where job.jobname in (
     'sellerpilot-serverless-cs-wake-v1',
     'sellerpilot-product-research-v1',
     'sellerpilot-channel-sync-v1',
     'sellerpilot-competitor-prices-v1',
     'sellerpilot-kakao-notifications-v1',
     'sellerpilot-maintenance-v1'
   );

  select count(*) filter (where job.active)::integer
    into v_active_count
    from cron.job job
   where job.jobname in (
     'sellerpilot-serverless-cs-wake-v1',
     'sellerpilot-product-research-v1',
     'sellerpilot-channel-sync-v1',
     'sellerpilot-competitor-prices-v1',
     'sellerpilot-kakao-notifications-v1',
     'sellerpilot-maintenance-v1'
   );

  return jsonb_build_object(
    'configured', v_configured_count = 6,
    'version', 'serverless_runtime_v2',
    'active', v_active_count = 6,
    'scheduleCount', v_configured_count
  );
end;
$$;

create or replace function public.sellerpilot_service_set_serverless_cs_wakeup_active(
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_active is null then
    raise exception 'scheduler state required';
  end if;
  if p_active then
    raise exception 'a fresh production canary receipt is required for activation'
      using errcode = '55000';
  end if;
  return sellerpilot_private.set_serverless_runtime_schedules_active(false);
end;
$$;

create or replace function public.sellerpilot_service_activate_serverless_runtime(
  p_canary_receipt_id uuid,
  p_release_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt sellerpilot_private.serverless_runtime_canary_receipts%rowtype;
  v_result jsonb;
  v_unsafe_pending_mutations integer;
begin
  if p_canary_receipt_id is null or coalesce(p_release_id, '') !~ '^[0-9a-f]{40}$' then
    raise exception 'production canary receipt required'
      using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065060);
  lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
  select receipt.*
    into v_receipt
    from sellerpilot_private.serverless_runtime_canary_receipts receipt
   where receipt.id = p_canary_receipt_id
     and receipt.release_id = p_release_id
   for update;
  if not found
     or v_receipt.passed_at is null
     or v_receipt.consumed_at is not null
     or v_receipt.expires_at <= clock_timestamp() then
    raise exception 'fresh completed production canary receipt required'
      using errcode = '55000';
  end if;

  select count(*)::integer
    into v_unsafe_pending_mutations
    from sellerpilot_private.channel_gateway_jobs job
   where job.status in ('queued', 'running')
     and (
       job.operation in (
         'listing.create', 'listing.update', 'listing.stop', 'price.update',
         'inventory.update', 'shipment.acknowledge', 'shipment.confirm',
         'inquiries.reply', 'oauth.exchange'
       )
       or sellerpilot_private.gateway_job_requires_reconciliation(
         job.operation,
         job.credential_refresh_in_flight,
         job.prepared_credential_id,
         job.credential_refresh_recovery_vault_id,
         job.oauth_exchange_completed,
         job.provider_mutation_started_at
       )
     );
  if v_unsafe_pending_mutations <> 0 then
    raise exception 'pending marketplace mutations require explicit operator review'
      using errcode = '55000';
  end if;

  v_result := sellerpilot_private.set_serverless_runtime_schedules_active(true);
  update sellerpilot_private.serverless_runtime_canary_receipts receipt
     set consumed_at = clock_timestamp()
   where receipt.id = p_canary_receipt_id
     and receipt.consumed_at is null;
  return v_result || jsonb_build_object(
    'canaryReceiptConsumed', true,
    'activeRelease', p_release_id,
    'unsafePendingMutations', 0
  );
end;
$$;

create or replace function public.sellerpilot_service_serverless_cs_wakeup_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_active_release text;
  v_active_count integer;
  v_configured_count integer;
  v_internal jsonb;
  v_last_wake jsonb;
  v_reconciliation_required integer;
  v_reconciliation_required_mutations integer;
  v_unsafe_pending_mutations integer;
begin
  select count(*)::integer,
         count(*) filter (where job.active)::integer
    into v_configured_count, v_active_count
    from cron.job job
   where job.jobname in (
     'sellerpilot-serverless-cs-wake-v1',
     'sellerpilot-product-research-v1',
     'sellerpilot-channel-sync-v1',
     'sellerpilot-competitor-prices-v1',
     'sellerpilot-kakao-notifications-v1',
     'sellerpilot-maintenance-v1'
   );

  select count(*) filter (
           where job.status in ('queued', 'running')
             and (
               job.operation in (
                 'listing.create', 'listing.update', 'listing.stop', 'price.update',
                 'inventory.update', 'shipment.acknowledge', 'shipment.confirm',
                 'inquiries.reply', 'oauth.exchange'
               )
               or sellerpilot_private.gateway_job_requires_reconciliation(
                 job.operation,
                 job.credential_refresh_in_flight,
                 job.prepared_credential_id,
                 job.credential_refresh_recovery_vault_id,
                 job.oauth_exchange_completed,
                 job.provider_mutation_started_at
               )
             )
         )::integer,
         count(*) filter (where job.status = 'reconciliation_required')::integer,
         count(*) filter (
           where job.status = 'reconciliation_required'
             and (
               job.operation in (
                 'listing.create', 'listing.update', 'listing.stop', 'price.update',
                 'inventory.update', 'shipment.acknowledge', 'shipment.confirm',
                 'inquiries.reply', 'oauth.exchange'
               )
               or sellerpilot_private.gateway_job_requires_reconciliation(
                 job.operation,
                 job.credential_refresh_in_flight,
                 job.prepared_credential_id,
                 job.credential_refresh_recovery_vault_id,
                 job.oauth_exchange_completed,
                 job.provider_mutation_started_at
               )
             )
         )::integer
    into v_unsafe_pending_mutations,
         v_reconciliation_required,
         v_reconciliation_required_mutations
    from sellerpilot_private.channel_gateway_jobs job;

  if v_active_count = 6 then
    select receipt.release_id
      into v_active_release
      from sellerpilot_private.serverless_runtime_canary_receipts receipt
     where receipt.consumed_at is not null
     order by receipt.consumed_at desc, receipt.id desc
     limit 1;
  end if;

  select case when wake.request_id is null then null else jsonb_build_object(
           'requestedAt', wake.requested_at,
           'resolvedAt', wake.resolved_at,
           'outcome', wake.outcome,
           'httpStatus', wake.http_status,
           'timedOut', wake.timed_out,
           'safeErrorCode', wake.safe_error_code
         ) end
    into v_last_wake
    from (values (true)) singleton(present)
    left join lateral (
      select request.request_id, request.requested_at, request.resolved_at,
             request.outcome, request.http_status, request.timed_out,
             request.safe_error_code
        from sellerpilot_private.serverless_cs_wake_requests request
       order by request.requested_at desc, request.request_id desc
       limit 1
    ) wake on true;

  select coalesce(jsonb_object_agg(
           route.route_key,
           jsonb_build_object(
             'configured', job.jobid is not null,
             'active', coalesce(job.active, false),
             'lastOutcome', latest.outcome,
             'lastHttpStatus', latest.http_status,
             'lastRequestedAt', latest.requested_at
           )
         ), '{}'::jsonb)
    into v_internal
    from (values
      ('product_research', 'sellerpilot-product-research-v1'),
      ('channel_sync', 'sellerpilot-channel-sync-v1'),
      ('competitor_prices', 'sellerpilot-competitor-prices-v1'),
      ('kakao_notifications', 'sellerpilot-kakao-notifications-v1'),
      ('maintenance', 'sellerpilot-maintenance-v1')
    ) route(route_key, job_name)
    left join cron.job job on job.jobname = route.job_name
    left join lateral (
      select request.outcome, request.http_status, request.requested_at
        from sellerpilot_private.internal_schedule_requests request
       where request.route_key = route.route_key
       order by request.requested_at desc, request.request_id desc
       limit 1
    ) latest on true;

  return jsonb_build_object(
    'configured', v_configured_count = 6,
    'version', 'serverless_runtime_v2',
    'active', v_active_count = 6,
    'scheduleCount', v_configured_count,
    'activeRelease', v_active_release,
    'unsafePendingMutations', coalesce(v_unsafe_pending_mutations, 0),
    'reconciliationRequired', coalesce(v_reconciliation_required, 0),
    'reconciliationRequiredMutations', coalesce(v_reconciliation_required_mutations, 0),
    'lastWake', v_last_wake,
    'internalSchedules', v_internal
  );
end;
$$;

revoke all on function sellerpilot_private.set_serverless_runtime_schedules_active(boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_begin_serverless_runtime_canary(text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_serverless_runtime_canary(text)
  to service_role;
revoke all on function
  public.sellerpilot_service_complete_serverless_runtime_canary(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_complete_serverless_runtime_canary(uuid, text)
  to service_role;
revoke all on function
  public.sellerpilot_service_set_serverless_cs_wakeup_active(boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_set_serverless_cs_wakeup_active(boolean)
  to service_role;
revoke all on function public.sellerpilot_service_activate_serverless_runtime(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_activate_serverless_runtime(uuid, text)
  to service_role;
revoke all on function public.sellerpilot_service_serverless_cs_wakeup_status()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_serverless_cs_wakeup_status()
  to service_role;

comment on table sellerpilot_private.internal_schedule_requests is
  'Secret-free pg_net ledger for Supabase-owned internal route schedules.';
comment on function sellerpilot_private.schedule_internal_route(text) is
  'Invokes one fixed Vercel internal route with the Vault HMAC bearer; cron commands contain no secret.';
-- END:hobby-safe-internal-schedules

-- BEGIN:strict-worker-scope-final-fence
-- Production has not applied the earlier standalone legacy-scope retirement.
-- Install the same terminal boundary in this final, not-yet-applied migration.
-- The rotation lock serializes token-set activation. ACCESS EXCLUSIVE waits
-- out token-authenticated transactions and prevents a new legacy claim without
-- crossing the gateway completion lock's independent acquisition order.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
lock table sellerpilot_private.ai_cli_worker_tokens in access exclusive mode;

do $strict_worker_scope$
declare
  v_now timestamptz := clock_timestamp();
  v_ai_job record;
  v_gateway_job record;
  v_status text;
  v_message text;
begin
  -- A product worker may already have uploaded partial output. Requeuing it
  -- would duplicate generation and storage work, so stop it terminally and
  -- leave an explicit, user-retryable failure instead of accepting a late
  -- completion from the retired combined credential.
  for v_ai_job in
    select job.id, job.worker_token_id
      from sellerpilot_private.ai_cli_jobs job
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = job.worker_token_id
     where token.scope = 'legacy_combined'
       and job.status = 'running'
     order by job.id
     for update of job
  loop
    update sellerpilot_private.ai_cli_jobs job
       set status = 'failed',
           error_message = 'Legacy combined worker retired during release; retry this AI job explicitly.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = v_now,
           updated_at = v_now
     where job.id = v_ai_job.id
       and job.status = 'running';

    insert into sellerpilot_private.ai_cli_audit (
      action, worker_token_id, job_id, safe_detail
    ) values (
      'job_failed',
      v_ai_job.worker_token_id,
      v_ai_job.id,
      jsonb_build_object('reason', 'legacy_combined_release_retirement')
    );
  end loop;

  -- Gateway reads that provably have not crossed a provider-mutation boundary
  -- are safe to requeue. Writes and uncertain refreshes are quarantined for
  -- reconciliation; a durably completed OAuth rotation remains succeeded.
  for v_gateway_job in
    select job.id,
           job.credential_id,
           job.attempt_id,
           job.channel,
           job.operation,
           job.attempt_count,
           job.response_payload,
           job.oauth_request_vault_id,
           job.oauth_exchange_completed,
           job.credential_refresh_in_flight,
           job.prepared_credential_id,
           job.credential_refresh_recovery_vault_id,
           job.provider_mutation_started_at
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = job.worker_token_id
     where token.scope = 'legacy_combined'
       and job.status = 'running'
     order by job.id
     for update of job
  loop
    if v_gateway_job.oauth_exchange_completed
       and not v_gateway_job.credential_refresh_in_flight then
      v_status := 'succeeded';
      v_message := null;
    elsif sellerpilot_private.gateway_job_requires_reconciliation(
      v_gateway_job.operation,
      v_gateway_job.credential_refresh_in_flight,
      v_gateway_job.prepared_credential_id,
      v_gateway_job.credential_refresh_recovery_vault_id,
      v_gateway_job.oauth_exchange_completed,
      v_gateway_job.provider_mutation_started_at
    ) then
      v_status := 'reconciliation_required';
      v_message := 'Legacy combined worker retired with provider outcome unresolved; manual reconciliation required.';
    elsif v_gateway_job.attempt_count >= 4 then
      v_status := 'failed';
      v_message := 'Legacy combined worker retired after the gateway retry limit was reached.';
    else
      v_status := 'queued';
      v_message := null;
    end if;

    update sellerpilot_private.channel_gateway_jobs job
       set status = v_status,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = case when v_status = 'queued' then null else v_now end,
           error_message = v_message,
           response_payload = case
             when v_status = 'succeeded' then coalesce(
               v_gateway_job.response_payload,
               jsonb_build_object(
                 'ok', true,
                 'channel', v_gateway_job.channel,
                 'operation', 'oauth.exchange',
                 'safeMessage', 'OAuth credential was durably staged before legacy worker retirement.'
               )
             )
             else job.response_payload
           end,
           updated_at = v_now
     where job.id = v_gateway_job.id
       and job.status = 'running';

    if v_status <> 'queued'
       and v_gateway_job.oauth_request_vault_id is not null then
      delete from vault.secrets secret
       where secret.id = v_gateway_job.oauth_request_vault_id;
      update sellerpilot_private.channel_gateway_jobs job
         set oauth_request_vault_id = null,
             updated_at = v_now
       where job.id = v_gateway_job.id;
    end if;

    if v_status in ('failed', 'reconciliation_required')
       and v_gateway_job.attempt_id is not null then
      update sellerpilot_private.channel_operation_attempts attempt
         set status = case
               when v_status = 'reconciliation_required' then 'manual_required'
               else 'failed'
             end,
             http_status = case
               when v_status = 'reconciliation_required' then 409
               else 503
             end,
             safe_message = v_message,
             completed_at = v_now
       where attempt.id = v_gateway_job.attempt_id
         and attempt.status in ('running', 'failed', 'manual_required');
    end if;

    if v_status = 'reconciliation_required'
       and v_gateway_job.operation in (
         'listing.create', 'listing.update', 'listing.stop'
       )
       and v_gateway_job.attempt_id is not null then
      update sellerpilot_private.product_listings listing
         set status = 'failed',
             last_error = v_message,
             failure_class = 'external_action',
             updated_at = v_now
       where listing.operation_attempt_id = v_gateway_job.attempt_id;
    end if;

    if v_status in ('failed', 'reconciliation_required')
       and v_gateway_job.operation in ('orders.list', 'inquiries.list') then
      perform public.sellerpilot_service_mark_channel_sync(
        v_gateway_job.credential_id,
        v_gateway_job.channel,
        case
          when v_gateway_job.operation = 'orders.list' then 'orders'
          else 'inquiries'
        end,
        'failed',
        v_message
      );
    end if;
  end loop;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked',
           revoked_at = coalesce(token.revoked_at, v_now)
     where token.scope = 'legacy_combined'
       and token.status <> 'revoked'
     returning token.id, token.scope
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, safe_detail
  )
  select
    'token_revoked',
    revoked.id,
    jsonb_build_object(
      'reason', 'legacy_combined_release_retirement',
      'scope', revoked.scope
    )
  from revoked;
end;
$strict_worker_scope$;

alter table sellerpilot_private.ai_cli_worker_tokens
  drop constraint if exists ai_cli_worker_tokens_no_active_legacy_combined_check;

alter table sellerpilot_private.ai_cli_worker_tokens
  add constraint ai_cli_worker_tokens_no_active_legacy_combined_check
  check (scope <> 'legacy_combined' or status <> 'active') not valid;

alter table sellerpilot_private.ai_cli_worker_tokens
  validate constraint ai_cli_worker_tokens_no_active_legacy_combined_check;

-- Every capability lookup is exact after the legacy rows are terminal. The
-- historical rows remain for audit lineage but can never authenticate again.
create or replace function sellerpilot_private.worker_token_has_scope(
  p_token_hash text,
  p_scope text,
  p_require_active boolean default true
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_scope in ('ai', 'gateway', 'scheduler'), false)
     and exists (
       select 1
         from sellerpilot_private.ai_cli_worker_tokens token
        where token.token_hash = p_token_hash
          and token.scope = p_scope
          and (
            not p_require_active
            or (
              token.status = 'active'
              and token.expires_at > clock_timestamp()
            )
          )
     )
$$;

revoke all on function sellerpilot_private.worker_token_has_scope(
  text, text, boolean
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_validate_worker_token(
  p_token_hash text,
  p_worker_version text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where token.token_hash = p_token_hash
     and token.scope = 'scheduler'
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_service_validate_worker_token(
  text, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_validate_worker_token(
  text, text
) to service_role;

comment on function sellerpilot_private.worker_token_has_scope(
  text, text, boolean
) is 'Checks one exact worker capability; legacy_combined never satisfies a scope.';
comment on function public.sellerpilot_service_validate_worker_token(text, text)
  is 'Records liveness only for an exact active scheduler-scope token.';
-- END:strict-worker-scope-final-fence

commit;
