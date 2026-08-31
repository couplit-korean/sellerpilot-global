-- Fence every competitor refresh to the exact product identity, query, and
-- localized aliases observed when the lease was claimed. Product identity
-- edits revoke old work and remove its v3 projection before it can be reused.

begin;

create or replace function sellerpilot_private.competitor_aliases_from_result_payload(
  p_result_payload jsonb
)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(alias.title order by alias.first_position)
      from (
        select left(trim(item.value->>'title'), 160) as title,
               min(item.ordinality) as first_position
          from jsonb_array_elements(
            case
              when jsonb_typeof(p_result_payload->'localizedListings') = 'array'
                then p_result_payload->'localizedListings'
              else '[]'::jsonb
            end
          ) with ordinality as item(value, ordinality)
         where length(trim(coalesce(item.value->>'title', ''))) between 2 and 160
         group by left(trim(item.value->>'title'), 160)
         order by min(item.ordinality)
         limit 12
      ) alias
  ), '[]'::jsonb)
$$;

revoke all on function sellerpilot_private.competitor_aliases_from_result_payload(jsonb)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.competitor_aliases_from_ai_job(
  p_ai_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sellerpilot_private.competitor_aliases_from_result_payload(job.result_payload)
      from sellerpilot_private.ai_cli_jobs job
     where job.id = p_ai_job_id
  ), '[]'::jsonb)
$$;

revoke all on function sellerpilot_private.competitor_aliases_from_ai_job(uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.competitor_refresh_input_fingerprint(
  p_identity jsonb,
  p_query text,
  p_aliases jsonb
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(extensions.digest(jsonb_build_object(
    'identity', coalesce(p_identity, '{}'::jsonb),
    'query', coalesce(p_query, ''),
    'aliases', coalesce(p_aliases, '[]'::jsonb)
  )::text, 'sha256'), 'hex')
$$;

revoke all on function sellerpilot_private.competitor_refresh_input_fingerprint(jsonb, text, jsonb)
  from public, anon, authenticated, service_role;

alter table sellerpilot_private.competitor_price_refresh_claims
  add column identity_fingerprint text;

-- Existing active work predates this lineage value and cannot be certified by
-- backfill. Cancel it instead of guessing which product identity it observed.
update sellerpilot_private.competitor_price_refresh_claims
   set claim_token = null,
       claimed_at = null,
       lease_expires_at = null,
       gateway_job_id = null,
       gateway_periodic_key = null,
       latest_providers = '[]'::jsonb,
       providers_fetched_at = null,
       identity_fingerprint = null;

-- Existing v3 rows have no claim-time identity evidence. Preserve manual/v2
-- references and the append-only review ledger, but force v3 recollection.
update sellerpilot_private.products product
   set competitor_checked_at = null
 where exists (
         select 1
           from sellerpilot_private.competitor_price_refresh_claims refresh_state
          where refresh_state.product_id = product.id
       )
    or exists (
         select 1
           from sellerpilot_private.competitor_price_observations observation
          where observation.product_id = product.id
            and observation.matcher_version = 'strict-2026-08-31-v3'
       );

delete from sellerpilot_private.competitor_price_observations observation
 where observation.matcher_version = 'strict-2026-08-31-v3';

alter table sellerpilot_private.competitor_price_refresh_claims
  add constraint competitor_price_refresh_claims_identity_fingerprint_check
  check (
    (claim_token is null and identity_fingerprint is null)
    or (
      claim_token is not null
      and identity_fingerprint is not null
      and identity_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );

comment on column sellerpilot_private.competitor_price_refresh_claims.identity_fingerprint is
  'SHA-256 of the claim-time normalized product identity, exact retrieval query, and localized aliases; present only while a claim is active.';

create or replace function sellerpilot_private.invalidate_competitor_lineage_on_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_fingerprint text;
  v_new_fingerprint text;
begin
  v_old_fingerprint := sellerpilot_private.competitor_refresh_input_fingerprint(
    sellerpilot_private.competitor_identity_from_product(old.name, old.product_facts),
    coalesce(nullif(old.competitor_query, ''), old.name),
    sellerpilot_private.competitor_aliases_from_ai_job(old.ai_job_id)
  );
  v_new_fingerprint := sellerpilot_private.competitor_refresh_input_fingerprint(
    sellerpilot_private.competitor_identity_from_product(new.name, new.product_facts),
    coalesce(nullif(new.competitor_query, ''), new.name),
    sellerpilot_private.competitor_aliases_from_ai_job(new.ai_job_id)
  );

  if v_old_fingerprint is distinct from v_new_fingerprint
     or old.competitor_monitor_enabled is distinct from new.competitor_monitor_enabled
     or (old.status <> 'archived' and new.status = 'archived') then
    new.competitor_checked_at := null;

    update sellerpilot_private.competitor_price_refresh_claims refresh_state
       set claim_token = null,
           claimed_at = null,
           lease_expires_at = null,
           gateway_job_id = null,
           gateway_periodic_key = null,
           latest_providers = '[]'::jsonb,
           providers_fetched_at = null,
           identity_fingerprint = null
     where refresh_state.product_id = old.id;

    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = old.id
       and observation.matcher_version = 'strict-2026-08-31-v3';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.invalidate_competitor_lineage_on_product_change()
  from public, anon, authenticated, service_role;

create trigger products_competitor_identity_lineage_fence
before update of name, product_facts, competitor_query, competitor_monitor_enabled, ai_job_id, status
on sellerpilot_private.products
for each row execute function sellerpilot_private.invalidate_competitor_lineage_on_product_change();

-- localizedListings is mutable independently of products.ai_job_id. When its
-- effective alias set changes, invalidate every linked product after the AI row
-- update. A concurrent completion may finish first, but this trigger then
-- removes that projection before the alias-changing transaction can commit.
create or replace function sellerpilot_private.invalidate_competitor_lineage_on_ai_alias_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  if sellerpilot_private.competitor_aliases_from_result_payload(old.result_payload)
     is not distinct from
     sellerpilot_private.competitor_aliases_from_result_payload(new.result_payload) then
    return new;
  end if;

  for v_product_id in
    select product.id
      from sellerpilot_private.products product
     where product.ai_job_id = new.id
     order by product.id
     for update
  loop
    update sellerpilot_private.products product
       set competitor_checked_at = null
     where product.id = v_product_id;

    update sellerpilot_private.competitor_price_refresh_claims refresh_state
       set claim_token = null,
           claimed_at = null,
           lease_expires_at = null,
           gateway_job_id = null,
           gateway_periodic_key = null,
           latest_providers = '[]'::jsonb,
           providers_fetched_at = null,
           identity_fingerprint = null
     where refresh_state.product_id = v_product_id;

    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = v_product_id
       and observation.matcher_version = 'strict-2026-08-31-v3';
  end loop;
  return new;
end;
$$;

revoke all on function sellerpilot_private.invalidate_competitor_lineage_on_ai_alias_change()
  from public, anon, authenticated, service_role;

create trigger ai_cli_jobs_competitor_alias_lineage_fence
after update of result_payload on sellerpilot_private.ai_cli_jobs
for each row execute function sellerpilot_private.invalidate_competitor_lineage_on_ai_alias_change();

create or replace function public.sellerpilot_service_claim_due_competitor_products(
  p_limit integer default 1,
  p_lease_seconds integer default 90
)
returns table(product_id uuid, query text, aliases jsonb, claim_token uuid, identity jsonb)
language sql
security definer
set search_path = ''
as $$
  with candidates as materialized (
    select p.id as product_id,
           claim_input.query,
           claim_input.aliases,
           claim_input.identity,
           sellerpilot_private.competitor_refresh_input_fingerprint(
             claim_input.identity,
             claim_input.query,
             claim_input.aliases
           ) as identity_fingerprint
      from sellerpilot_private.products p
      cross join lateral (
        select coalesce(nullif(p.competitor_query, ''), p.name) as query,
               sellerpilot_private.competitor_aliases_from_ai_job(p.ai_job_id) as aliases,
               sellerpilot_private.competitor_identity_from_product(p.name, p.product_facts) as identity
      ) claim_input
      left join sellerpilot_private.competitor_price_refresh_claims refresh_state
        on refresh_state.product_id = p.id
      left join sellerpilot_private.channel_gateway_jobs resume_job
        on resume_job.id = refresh_state.gateway_job_id
     where not p.demo
       and p.status <> 'archived'
       and p.competitor_monitor_enabled
       and (p.competitor_checked_at is null or p.competitor_checked_at <= clock_timestamp() - interval '30 minutes')
       and (refresh_state.claim_token is null or refresh_state.lease_expires_at <= clock_timestamp())
     order by case
                when resume_job.status = 'succeeded'
                 and resume_job.completed_at >= clock_timestamp() - interval '30 minutes'
                 and resume_job.response_payload->>'ok' = 'true'
                 and resume_job.response_payload->>'channel' = 'elevenst'
                 and resume_job.response_payload->>'operation' = 'competitor.search'
                 and jsonb_typeof(resume_job.response_payload->'items') = 'array'
                then 0 else 1
              end,
              refresh_state.last_attempted_at nulls first,
              p.competitor_checked_at nulls first,
              p.updated_at desc,
              p.id
     for update of p skip locked
     limit greatest(1, least(coalesce(p_limit, 1), 3))
  ), claimed as (
    insert into sellerpilot_private.competitor_price_refresh_claims (
      product_id, claim_token, claimed_at, lease_expires_at, last_attempted_at,
      identity_fingerprint
    )
    select candidate.product_id,
           gen_random_uuid(),
           clock_timestamp(),
           clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 300))),
           clock_timestamp(),
           candidate.identity_fingerprint
      from candidates candidate
    on conflict (product_id) do update
      set claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at,
          lease_expires_at = excluded.lease_expires_at,
          last_attempted_at = excluded.last_attempted_at,
          identity_fingerprint = excluded.identity_fingerprint
      where sellerpilot_private.competitor_price_refresh_claims.claim_token is null
         or sellerpilot_private.competitor_price_refresh_claims.lease_expires_at <= clock_timestamp()
    returning sellerpilot_private.competitor_price_refresh_claims.product_id,
              sellerpilot_private.competitor_price_refresh_claims.claim_token
  )
  select candidate.product_id, candidate.query, candidate.aliases,
         claimed.claim_token, candidate.identity
    from candidates candidate
    join claimed using (product_id)
   order by candidate.product_id
$$;

revoke all on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  to service_role;

-- A valid claim token must not be usable to enqueue a different search. Bind
-- the gateway payload to the same query, aliases, and product identity that
-- produced the active claim fingerprint.
create or replace function public.sellerpilot_enqueue_competitor_search_job(
  p_credential_id uuid,
  p_primary text,
  p_aliases jsonb,
  p_display_per_query integer default 30,
  p_product_id uuid default null,
  p_claim_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_aliases jsonb;
  v_base_payload jsonb;
  v_payload jsonb;
  v_periodic_key text;
  v_existing_id uuid;
  v_expected_query text;
  v_expected_aliases jsonb;
  v_expected_fingerprint text;
begin
  if length(trim(coalesce(p_primary, ''))) not between 2 and 160
     or jsonb_typeof(coalesce(p_aliases, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_aliases, '[]'::jsonb)) > 12
     or coalesce(p_display_per_query, 0) not between 1 and 30
     or (p_product_id is null) <> (p_claim_token is null)
     or exists (
       select 1
         from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb)) item(value)
        where jsonb_typeof(item.value) <> 'string'
           or length(trim(item.value #>> '{}')) not between 2 and 160
     ) then
    raise exception 'invalid competitor search job';
  end if;

  select coalesce(
           jsonb_agg(to_jsonb(trim(item.value #>> '{}')) order by item.ordinality),
           '[]'::jsonb
         )
    into v_aliases
    from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb))
      with ordinality as item(value, ordinality);

  if p_product_id is not null then
    select coalesce(nullif(product.competitor_query, ''), product.name),
           sellerpilot_private.competitor_aliases_from_ai_job(product.ai_job_id),
           sellerpilot_private.competitor_refresh_input_fingerprint(
             sellerpilot_private.competitor_identity_from_product(product.name, product.product_facts),
             coalesce(nullif(product.competitor_query, ''), product.name),
             sellerpilot_private.competitor_aliases_from_ai_job(product.ai_job_id)
           )
      into v_expected_query, v_expected_aliases, v_expected_fingerprint
      from sellerpilot_private.products product
     where product.id = p_product_id
       and product.status <> 'archived'
       and product.competitor_monitor_enabled
     for update;
    if not found
       or trim(p_primary) is distinct from v_expected_query
       or v_aliases is distinct from v_expected_aliases then
      raise exception 'competitor search input changed';
    end if;

    perform 1
      from sellerpilot_private.competitor_price_refresh_claims refresh_state
     where refresh_state.product_id = p_product_id
       and refresh_state.claim_token = p_claim_token
       and refresh_state.lease_expires_at > clock_timestamp()
       and refresh_state.identity_fingerprint = v_expected_fingerprint
     for update;
    if not found then raise exception 'active competitor refresh claim required'; end if;
  end if;

  v_base_payload := jsonb_build_object(
    'primary', trim(p_primary),
    'aliases', v_aliases,
    'displayPerQuery', p_display_per_query
  );
  v_periodic_key := 'competitor:v1:' || encode(extensions.digest(v_base_payload::text, 'sha256'), 'hex');
  v_payload := v_base_payload || jsonb_build_object('periodicKey', v_periodic_key);

  select credential.environment, credential.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_product_id is not null then
    select job.id
      into v_existing_id
      from sellerpilot_private.competitor_price_refresh_claims refresh_state
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = refresh_state.gateway_job_id
     where refresh_state.product_id = p_product_id
       and refresh_state.claim_token = p_claim_token
       and refresh_state.identity_fingerprint = v_expected_fingerprint
       and refresh_state.gateway_periodic_key = v_periodic_key
       and job.credential_id = p_credential_id
       and job.channel = 'elevenst'
       and job.operation = 'competitor.search'
       and job.request_payload->>'periodicKey' = v_periodic_key
       and (
         job.status in ('queued', 'running')
         or (
           job.status = 'succeeded'
           and job.completed_at >= clock_timestamp() - interval '30 minutes'
           and job.response_payload->>'ok' = 'true'
           and job.response_payload->>'channel' = 'elevenst'
           and job.response_payload->>'operation' = 'competitor.search'
           and jsonb_typeof(job.response_payload->'items') = 'array'
         )
       )
     limit 1;
    if found then return v_existing_id; end if;
  end if;

  select job.id
    into v_existing_id
    from sellerpilot_private.channel_gateway_jobs job
   where job.credential_id = p_credential_id
     and job.channel = 'elevenst'
     and job.operation = 'competitor.search'
     and job.attempt_id is null
     and (
       job.request_payload->>'periodicKey' = v_periodic_key
       or job.request_payload = v_base_payload
     )
     and (
       job.status in ('queued', 'running')
       or (
         job.status = 'succeeded'
         and job.completed_at >= clock_timestamp() - interval '30 minutes'
         and job.response_payload->>'ok' = 'true'
         and job.response_payload->>'channel' = 'elevenst'
         and job.response_payload->>'operation' = 'competitor.search'
         and jsonb_typeof(job.response_payload->'items') = 'array'
       )
     )
   order by case job.status when 'succeeded' then 0 when 'running' then 1 else 2 end,
            job.completed_at desc nulls last,
            job.created_at desc,
            job.id
   limit 1;

  if not found then
    insert into sellerpilot_private.channel_gateway_jobs (
      id, credential_id, attempt_id, channel, operation, environment,
      request_payload, created_by
    ) values (
      v_id, p_credential_id, null, 'elevenst', 'competitor.search', v_environment,
      v_payload, v_created_by
    );
    v_existing_id := v_id;
  end if;

  if p_product_id is not null then
    update sellerpilot_private.competitor_price_refresh_claims refresh_state
       set gateway_job_id = v_existing_id,
           gateway_periodic_key = v_periodic_key
     where refresh_state.product_id = p_product_id
       and refresh_state.claim_token = p_claim_token
       and refresh_state.lease_expires_at > clock_timestamp()
       and refresh_state.identity_fingerprint = v_expected_fingerprint;
    if not found then raise exception 'active competitor refresh claim required'; end if;
  end if;
  return v_existing_id;
end;
$$;

revoke all on function public.sellerpilot_enqueue_competitor_search_job(uuid, text, jsonb, integer, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_competitor_search_job(uuid, text, jsonb, integer, uuid, uuid)
  to service_role;

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
  v_current_identity_fingerprint text;
  v_claim_identity_fingerprint text;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 30
     or not coalesce(sellerpilot_private.valid_competitor_provider_snapshot(p_providers), false)
     or exists (
       select 1
         from jsonb_array_elements(p_items) item(value)
        where jsonb_typeof(item.value) <> 'object'
           or item.value->>'matcherVersion' not in (
             'strict-2026-08-28-v2', 'strict-2026-08-31-v3'
           )
           or (
             item.value->>'matcherVersion' = 'strict-2026-08-31-v3'
             and not coalesce(sellerpilot_private.valid_competitor_v3_item(item.value), false)
           )
           or not exists (
             select 1
               from jsonb_array_elements(p_providers) provider(value)
              where provider.value->>'provider' = item.value->>'provider'
                and provider.value->>'status' = 'searched'
                and provider.value->>'count' <> '0'
           )
           or (
             item.value->>'matcherVersion' = 'strict-2026-08-31-v3'
             and exists (
               select 1
                 from jsonb_array_elements(item.value->'provenance') source(value)
                where not exists (
                  select 1
                    from jsonb_array_elements(p_providers) provider(value)
                   where provider.value->>'provider' = source.value->>'provider'
                     and provider.value->>'status' = 'searched'
                     and provider.value->>'count' <> '0'
                )
             )
           )
     )
     or (
       jsonb_array_length(p_items) = 0
       and exists (
         select 1
           from jsonb_array_elements(p_providers) provider(value)
          where provider.value->>'status' = 'searched'
            and provider.value->>'count' <> '0'
       )
     ) then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  select sellerpilot_private.competitor_refresh_input_fingerprint(
           sellerpilot_private.competitor_identity_from_product(product.name, product.product_facts),
           coalesce(nullif(product.competitor_query, ''), product.name),
           sellerpilot_private.competitor_aliases_from_ai_job(product.ai_job_id)
         )
    into v_current_identity_fingerprint
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.status <> 'archived'
     and product.competitor_monitor_enabled
   for update;
  if not found then return -1; end if;

  select refresh_state.identity_fingerprint
    into v_claim_identity_fingerprint
    from sellerpilot_private.competitor_price_refresh_claims refresh_state
   where refresh_state.product_id = p_product_id
     and refresh_state.claim_token = p_claim_token
     and refresh_state.lease_expires_at > clock_timestamp()
   for update;
  if not found then return -1; end if;

  if v_claim_identity_fingerprint is distinct from v_current_identity_fingerprint then
    update sellerpilot_private.competitor_price_refresh_claims refresh_state
       set claim_token = null,
           claimed_at = null,
           lease_expires_at = null,
           gateway_job_id = null,
           gateway_periodic_key = null,
           latest_providers = '[]'::jsonb,
           providers_fetched_at = null,
           identity_fingerprint = null
     where refresh_state.product_id = p_product_id
       and refresh_state.claim_token = p_claim_token;
    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = p_product_id
       and observation.matcher_version = 'strict-2026-08-31-v3';
    update sellerpilot_private.products product
       set competitor_checked_at = null
     where product.id = p_product_id;
    return -1;
  end if;

  for v_provider in
    select provider.value->>'provider'
      from jsonb_array_elements(p_providers) provider(value)
     where provider.value->>'status' = 'searched'
  loop
    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = p_product_id
       and observation.matcher_version = 'strict-2026-08-31-v3'
       and observation.provider = v_provider;
  end loop;

  delete from sellerpilot_private.competitor_price_observations observation
   where observation.product_id = p_product_id
     and observation.matcher_version = 'strict-2026-08-31-v3'
     and observation.provider <> 'manual'
     and observation.checked_at < clock_timestamp() - interval '7 days';

  select sellerpilot_private.record_competitor_prices(p_product_id, p_items, true)
    into v_count;

  update sellerpilot_private.competitor_price_refresh_claims refresh_state
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null,
         latest_providers = p_providers,
         providers_fetched_at = clock_timestamp(),
         identity_fingerprint = null
   where refresh_state.product_id = p_product_id
     and refresh_state.claim_token = p_claim_token
     and refresh_state.identity_fingerprint = v_current_identity_fingerprint;
  if not found then return -1; end if;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  to service_role;

create or replace function public.sellerpilot_service_release_competitor_price_refresh(
  p_product_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.competitor_price_refresh_claims refresh_state
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null,
         identity_fingerprint = null
   where refresh_state.product_id = p_product_id
     and refresh_state.claim_token = p_claim_token;
  return found;
end;
$$;

revoke all on function public.sellerpilot_service_release_competitor_price_refresh(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_release_competitor_price_refresh(uuid, uuid)
  to service_role;

commit;
