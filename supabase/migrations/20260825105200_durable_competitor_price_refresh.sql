-- Make periodic competitor-price collection resumable and single-owner.
-- A scheduler claim fences direct providers, while the local 11st gateway
-- reuses an exact queued/running/recently-succeeded read after response loss.

begin;

create table if not exists sellerpilot_private.competitor_price_refresh_claims (
  product_id uuid primary key references sellerpilot_private.products(id) on delete cascade,
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_attempted_at timestamptz not null default clock_timestamp(),
  gateway_job_id uuid references sellerpilot_private.channel_gateway_jobs(id) on delete set null,
  gateway_periodic_key text,
  constraint competitor_price_refresh_claims_lease_check
    check (
      (claim_token is null and claimed_at is null and lease_expires_at is null)
      or (claim_token is not null and claimed_at is not null and lease_expires_at is not null and lease_expires_at > claimed_at)
    ),
  constraint competitor_price_refresh_claims_gateway_check
    check (
      (
        gateway_job_id is null
        and (gateway_periodic_key is null or gateway_periodic_key ~ '^competitor:v1:[0-9a-f]{64}$')
      )
      or (
        gateway_job_id is not null
        and gateway_periodic_key is not null
        and gateway_periodic_key ~ '^competitor:v1:[0-9a-f]{64}$'
      )
    )
);

create index if not exists competitor_price_refresh_claims_lease_idx
  on sellerpilot_private.competitor_price_refresh_claims (lease_expires_at)
  where claim_token is not null;

alter table sellerpilot_private.competitor_price_refresh_claims enable row level security;
revoke all on sellerpilot_private.competitor_price_refresh_claims from public, anon, authenticated;

create or replace function public.sellerpilot_service_claim_due_competitor_products(
  p_limit integer default 1,
  p_lease_seconds integer default 90
)
returns table(product_id uuid, query text, aliases jsonb, claim_token uuid)
language sql
security definer
set search_path = ''
as $$
  with candidates as materialized (
    select p.id as product_id,
           coalesce(nullif(p.competitor_query, ''), p.name) as query,
           coalesce(a.aliases, '[]'::jsonb) as aliases
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
      left join sellerpilot_private.competitor_price_refresh_claims refresh_state
        on refresh_state.product_id = p.id
      left join sellerpilot_private.channel_gateway_jobs resume_job
        on resume_job.id = refresh_state.gateway_job_id
      left join lateral (
        select jsonb_agg(v.title order by v.first_position) as aliases
          from (
            select left(trim(item.value->>'title'), 160) as title,
                   min(item.ordinality) as first_position
              from jsonb_array_elements(coalesce(j.result_payload->'localizedListings', '[]'::jsonb))
                with ordinality as item(value, ordinality)
             where length(trim(coalesce(item.value->>'title', ''))) between 2 and 160
             group by left(trim(item.value->>'title'), 160)
             order by min(item.ordinality)
             limit 12
          ) v
      ) a on true
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
      product_id, claim_token, claimed_at, lease_expires_at, last_attempted_at
    )
    select c.product_id,
           gen_random_uuid(),
           clock_timestamp(),
           clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 300))),
           clock_timestamp()
      from candidates c
    on conflict (product_id) do update
      set claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at,
          lease_expires_at = excluded.lease_expires_at,
          last_attempted_at = excluded.last_attempted_at
      where sellerpilot_private.competitor_price_refresh_claims.claim_token is null
         or sellerpilot_private.competitor_price_refresh_claims.lease_expires_at <= clock_timestamp()
    returning sellerpilot_private.competitor_price_refresh_claims.product_id,
              sellerpilot_private.competitor_price_refresh_claims.claim_token
  )
  select c.product_id, c.query, c.aliases, claimed.claim_token
    from candidates c
    join claimed using (product_id)
   order by c.product_id
$$;

create or replace function public.sellerpilot_service_complete_competitor_price_refresh(
  p_product_id uuid,
  p_claim_token uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Claim and completion both lock product before refresh state. Keeping one
  -- global lock order prevents an expiry/reclaim from deadlocking completion.
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

  select public.sellerpilot_service_record_competitor_prices(p_product_id, p_items)
    into v_count;

  update sellerpilot_private.competitor_price_refresh_claims c
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token;
  return v_count;
end;
$$;

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
  update sellerpilot_private.competitor_price_refresh_claims c
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token;
  return found;
end;
$$;

create unique index if not exists channel_gateway_jobs_competitor_active_dedupe_idx
  on sellerpilot_private.channel_gateway_jobs (
    credential_id,
    (request_payload->>'periodicKey')
  )
  where operation = 'competitor.search'
    and status in ('queued', 'running')
    and nullif(request_payload->>'periodicKey', '') is not null;

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

  select coalesce(jsonb_agg(to_jsonb(trim(item.value #>> '{}')) order by item.ordinality), '[]'::jsonb)
    into v_aliases
    from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb))
      with ordinality as item(value, ordinality);

  v_base_payload := jsonb_build_object(
    'primary', trim(p_primary),
    'aliases', v_aliases,
    'displayPerQuery', p_display_per_query
  );
  v_periodic_key := 'competitor:v1:' || encode(extensions.digest(v_base_payload::text, 'sha256'), 'hex');
  v_payload := v_base_payload || jsonb_build_object('periodicKey', v_periodic_key);

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'elevenst'
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > clock_timestamp())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_product_id is not null then
    perform 1
      from sellerpilot_private.competitor_price_refresh_claims refresh_state
     where refresh_state.product_id = p_product_id
       and refresh_state.claim_token = p_claim_token
     for update;
    if not found then raise exception 'active competitor refresh claim required'; end if;

    select j.id
      into v_existing_id
      from sellerpilot_private.competitor_price_refresh_claims refresh_state
      join sellerpilot_private.channel_gateway_jobs j
        on j.id = refresh_state.gateway_job_id
     where refresh_state.product_id = p_product_id
       and refresh_state.claim_token = p_claim_token
       and refresh_state.gateway_periodic_key = v_periodic_key
       and j.credential_id = p_credential_id
       and j.channel = 'elevenst'
       and j.operation = 'competitor.search'
       and j.request_payload->>'periodicKey' = v_periodic_key
       and (
         j.status in ('queued', 'running')
         or (
           j.status = 'succeeded'
           and j.completed_at >= clock_timestamp() - interval '30 minutes'
           and j.response_payload->>'ok' = 'true'
           and j.response_payload->>'channel' = 'elevenst'
           and j.response_payload->>'operation' = 'competitor.search'
           and jsonb_typeof(j.response_payload->'items') = 'array'
         )
       )
     limit 1;
    if found then return v_existing_id; end if;
  end if;

  select j.id
    into v_existing_id
    from sellerpilot_private.channel_gateway_jobs j
   where j.credential_id = p_credential_id
     and j.channel = 'elevenst'
     and j.operation = 'competitor.search'
     and j.attempt_id is null
     and (
       j.request_payload->>'periodicKey' = v_periodic_key
       or j.request_payload = v_base_payload
     )
     and (
       j.status in ('queued', 'running')
       or (
         j.status = 'succeeded'
         and j.completed_at >= clock_timestamp() - interval '30 minutes'
         and j.response_payload->>'ok' = 'true'
         and j.response_payload->>'channel' = 'elevenst'
         and j.response_payload->>'operation' = 'competitor.search'
         and jsonb_typeof(j.response_payload->'items') = 'array'
       )
     )
   order by case j.status when 'succeeded' then 0 when 'running' then 1 else 2 end,
            j.completed_at desc nulls last,
            j.created_at desc,
            j.id
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
       and refresh_state.claim_token = p_claim_token;
    if not found then raise exception 'active competitor refresh claim required'; end if;
  end if;
  return v_existing_id;
end;
$$;

revoke all on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_claim_due_competitor_products(integer, integer)
  to service_role;
revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb)
  to service_role;
revoke all on function public.sellerpilot_service_release_competitor_price_refresh(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_release_competitor_price_refresh(uuid, uuid)
  to service_role;
revoke all on function public.sellerpilot_enqueue_competitor_search_job(uuid, text, jsonb, integer, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_competitor_search_job(uuid, text, jsonb, integer, uuid, uuid)
  to service_role;

commit;
