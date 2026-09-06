-- Exact 11st cookie-product recovery after an uncertain listing.create POST.
-- Schema and RPCs only. This migration does not GET the provider, does not
-- POST, does not rewrite job b9faa28e, and does not apply a live listing bind.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

create table sellerpilot_private.elevenst_cookie_create_get_observations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null check (
    product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
  ) references sellerpilot_private.products(id) on delete restrict,
  listing_id uuid not null check (
    listing_id = '61b343f8-2e61-42a8-8a45-750f8b834edc'::uuid
  ) references sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null check (
    source_job_id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid
  ) references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null check (
    source_attempt_id = 'd1300c6b-410e-47be-a93f-0e2ba7d4bbf6'::uuid
  ) references sellerpilot_private.channel_operation_attempts(id)
    on delete restrict,
  credential_id uuid not null check (
    credential_id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
  ) references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_sku text not null check (seller_sku = 'AUTO-780720401E2D4E4EA45F'),
  remote_id text not null check (remote_id = '9598600918'),
  lookup_http_status integer not null check (lookup_http_status = 200),
  prodmarket_http_status integer not null check (prodmarket_http_status = 200),
  prodmarket_accepted boolean not null check (prodmarket_accepted),
  seller_prd_cd_matched boolean not null check (seller_prd_cd_matched),
  observed_sel_stat_cd text,
  recorded_at timestamptz not null default clock_timestamp(),
  bound_at timestamptz,
  constraint elevenst_cookie_create_get_observations_source_job_key
    unique (source_job_id)
);

alter table sellerpilot_private.elevenst_cookie_create_get_observations
  enable row level security;
revoke all on sellerpilot_private.elevenst_cookie_create_get_observations
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_cookie_create_jobs_are_current()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid;
  if v_job.id is null then return false; end if;
  if v_job.listing_id is null then return false; end if;
  select listing.* into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_job.listing_id;
  if v_listing.id is null then return false; end if;
  return v_job.channel is not distinct from 'elevenst'
    and v_job.operation is not distinct from 'listing.create'
    and v_job.environment is not distinct from 'production'
    and v_job.status is not distinct from 'reconciliation_required'
    and v_job.provider_mutation_started_at is not null
    and v_job.credential_id is not distinct from
          'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
    and v_job.attempt_id is not distinct from
          'd1300c6b-410e-47be-a93f-0e2ba7d4bbf6'::uuid
    and v_job.listing_id is not distinct from
          '61b343f8-2e61-42a8-8a45-750f8b834edc'::uuid
    and v_job.request_payload#>>'{arguments,product,sellerPrdCd}'
          is not distinct from 'AUTO-780720401E2D4E4EA45F'
    and coalesce(v_job.response_payload->>'remoteId', '') = ''
    and v_listing.id is not distinct from
          '61b343f8-2e61-42a8-8a45-750f8b834edc'::uuid
    and v_listing.product_id is not distinct from
          '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
    and v_listing.channel_key is not distinct from 'elevenst'
    and v_listing.status is not distinct from 'failed'
    and v_listing.failure_class is not distinct from 'external_action'
    and v_listing.remote_visibility is not distinct from 'unknown'
    and coalesce(v_listing.market, '') = ''
    and coalesce(v_listing.target_id, '') = ''
    and v_listing.operation_attempt_id is not distinct from v_job.attempt_id
    and (
      v_listing.remote_id is null
      or v_listing.remote_id is not distinct from '9598600918'
    )
    and (
      v_listing.marketplace_sku is null
      or v_listing.marketplace_sku is not distinct from
           'AUTO-780720401E2D4E4EA45F'
    );
end;
$$;

revoke all on function
  sellerpilot_private.elevenst_cookie_create_jobs_are_current()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_cookie_create_resources(
  p_observation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'elevenst_cookie_create_get_only_v1',
    'resources', jsonb_build_object(
      'remoteId', observation.remote_id,
      'sellerSku', observation.seller_sku
    ),
    'verification', jsonb_build_object(
      'identityVerified', true,
      'sourceJobId', observation.source_job_id,
      'sourceAttemptId', observation.source_attempt_id,
      'lookupHttpStatus', observation.lookup_http_status,
      'prodmarketHttpStatus', observation.prodmarket_http_status,
      'sellerProductCodeMatched', observation.seller_prd_cd_matched,
      'observedSelStatCd', observation.observed_sel_stat_cd,
      'providerWritePerformed', false,
      'sourceJobRewritten', false,
      'recordedAt', observation.recorded_at
    )
  )
    from sellerpilot_private.elevenst_cookie_create_get_observations observation
   where observation.id = p_observation_id
$$;

revoke all on function
  sellerpilot_private.elevenst_cookie_create_resources(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_cookie_create_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_listing_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_observation sellerpilot_private.elevenst_cookie_create_get_observations%rowtype;
  v_resources jsonb;
begin
  if jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object'
     or p_listing_id is distinct from
          '61b343f8-2e61-42a8-8a45-750f8b834edc'::uuid
     or p_old->>'id' <> p_listing_id::text
     or p_new->>'id' <> p_listing_id::text
     or not sellerpilot_private.elevenst_cookie_create_jobs_are_current()
  then
    return false;
  end if;

  select observation.* into v_observation
    from sellerpilot_private.elevenst_cookie_create_get_observations observation
   where observation.listing_id = p_listing_id
     and observation.source_job_id =
       'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid
     and observation.remote_id = '9598600918'
     and observation.seller_sku = 'AUTO-780720401E2D4E4EA45F'
     and observation.seller_prd_cd_matched
     and observation.prodmarket_accepted;
  if not found then return false; end if;

  v_resources := sellerpilot_private.elevenst_cookie_create_resources(
    v_observation.id
  );
  if jsonb_typeof(v_resources) <> 'object' then return false; end if;

  return p_old->>'channel_key' = 'elevenst'
    and p_old->>'product_id' = '1ed4acfc-7603-48ec-a638-241131e59358'
    and (p_old->>'remote_id' is null or p_old->>'remote_id' = '9598600918')
    and p_new = p_old || jsonb_build_object(
      'remote_id', '9598600918',
      'marketplace_sku', 'AUTO-780720401E2D4E4EA45F',
      'last_verified_at', to_jsonb(v_observation.recorded_at),
      'remote_resources', v_resources,
      'updated_at', p_new->'updated_at'
    );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.elevenst_cookie_create_listing_update_allowed(
    jsonb, jsonb, uuid
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_elevenst_cookie_create_source_job_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid then
      raise exception 'exact 11st cookie create source job receipt is immutable'
        using errcode = '55000';
    end if;
    return old;
  end if;
  if old.id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid then
    raise exception 'exact 11st cookie create source job receipt is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_elevenst_cookie_create_source_job_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_elevenst_cookie_create_source_job_immutable
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_elevenst_cookie_create_source_job_immutable
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_elevenst_cookie_create_source_job_immutable();

do $patch_listing_guard$
declare
  v_definition text;
  v_marker text := E'\nbegin\n';
  v_at integer;
  v_branch text := $branch$  if nullif(current_setting('sellerpilot.elevenst_cookie_create_get_bind', true), '') is not null then
    if not sellerpilot_private.elevenst_cookie_create_listing_update_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting('sellerpilot.elevenst_cookie_create_get_bind', true)::uuid
    ) then
      raise exception 'invalid exact 11st cookie create GET bind';
    end if;
    return new;
  end if;

$branch$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if v_definition is null then
    return;
  end if;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.elevenst_cookie_create_get_bind'
     ) > 0 then
    return;
  end if;
  v_at := pg_catalog.strpos(v_definition, v_marker);
  if v_at = 0 then
    raise exception '11st cookie create listing guard preimage drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.substr(v_definition, 1, v_at - 1)
    || v_marker
    || v_branch
    || pg_catalog.substr(v_definition, v_at + length(v_marker));
end;
$patch_listing_guard$;

create function public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_observation sellerpilot_private.elevenst_cookie_create_get_observations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
     or p_product_id is distinct from
          '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
  then
    raise exception 'exact 11st cookie create recovery status denied'
      using errcode = '42501';
  end if;
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid;
  select observation.* into v_observation
    from sellerpilot_private.elevenst_cookie_create_get_observations observation
   where observation.source_job_id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid;
  return jsonb_build_object(
    'contract', 'elevenst_cookie_create_get_only_v1',
    'productId', p_product_id,
    'sourceJobId', 'b9faa28e-a73f-4457-bb34-d643cf9a9a74',
    'current', sellerpilot_private.elevenst_cookie_create_jobs_are_current(),
    'listingId', v_job.listing_id,
    'listingRemoteId', (
      select listing.remote_id
        from sellerpilot_private.product_listings listing
       where listing.id = v_job.listing_id
    ),
    'observationId', v_observation.id,
    'bound', v_observation.bound_at is not null,
    'sourceJobRewritten', false
  );
end;
$$;

create function public.sellerpilot_service_record_elevenst_cookie_create_observation(
  p_product_id uuid,
  p_remote_id text,
  p_seller_sku text,
  p_lookup_http_status integer,
  p_prodmarket_http_status integer,
  p_prodmarket_accepted boolean,
  p_seller_prd_cd_matched boolean,
  p_observed_sel_stat_cd text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
  then
    raise exception 'exact 11st cookie create observation denied'
      using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 959860091);
  if p_product_id is distinct from '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
     or p_remote_id is distinct from '9598600918'
     or p_seller_sku is distinct from 'AUTO-780720401E2D4E4EA45F'
     or p_lookup_http_status is distinct from 200
     or p_prodmarket_http_status is distinct from 200
     or p_prodmarket_accepted is distinct from true
     or p_seller_prd_cd_matched is distinct from true
     or not sellerpilot_private.elevenst_cookie_create_jobs_are_current()
  then
    raise exception 'exact 11st cookie create GET observation is not current'
      using errcode = '55000';
  end if;
  select job.* into strict v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid;
  select observation.id into v_existing
    from sellerpilot_private.elevenst_cookie_create_get_observations observation
   where observation.source_job_id = v_job.id
     and observation.remote_id = '9598600918';
  if v_existing is not null then return v_existing; end if;
  insert into sellerpilot_private.elevenst_cookie_create_get_observations (
    product_id, listing_id, source_job_id, source_attempt_id, credential_id,
    seller_sku, remote_id, lookup_http_status, prodmarket_http_status,
    prodmarket_accepted, seller_prd_cd_matched, observed_sel_stat_cd
  ) values (
    p_product_id, v_job.listing_id, v_job.id, v_job.attempt_id,
    v_job.credential_id, p_seller_sku, p_remote_id, p_lookup_http_status,
    p_prodmarket_http_status, p_prodmarket_accepted, p_seller_prd_cd_matched,
    nullif(p_observed_sel_stat_cd, '')
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.sellerpilot_service_bind_elevenst_cookie_create_observation(
  p_observation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observation sellerpilot_private.elevenst_cookie_create_get_observations%rowtype;
  v_resources jsonb;
  v_updated integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '')
       is distinct from 'service_role'
  then
    raise exception 'exact 11st cookie create bind denied'
      using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 959860091);
  if not sellerpilot_private.elevenst_cookie_create_jobs_are_current() then
    raise exception 'exact 11st cookie create GET bind is not current'
      using errcode = '55000';
  end if;
  select observation.* into strict v_observation
    from sellerpilot_private.elevenst_cookie_create_get_observations observation
   where observation.id = p_observation_id
     and observation.source_job_id =
       'b9faa28e-a73f-4457-bb34-d643cf9a9a74'::uuid
     and observation.remote_id = '9598600918';
  v_resources := sellerpilot_private.elevenst_cookie_create_resources(
    v_observation.id
  );
  perform pg_catalog.set_config(
    'sellerpilot.elevenst_cookie_create_get_bind',
    v_observation.listing_id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set remote_id = '9598600918',
         marketplace_sku = 'AUTO-780720401E2D4E4EA45F',
         remote_resources = v_resources,
         last_verified_at = v_observation.recorded_at,
         updated_at = clock_timestamp()
   where listing.id = v_observation.listing_id
     and listing.id = '61b343f8-2e61-42a8-8a45-750f8b834edc'::uuid
     and listing.product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
     and listing.channel_key = 'elevenst'
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.remote_visibility = 'unknown'
     and (
       listing.remote_id is null
       or listing.remote_id = '9598600918'
     );
  get diagnostics v_updated = row_count;
  perform pg_catalog.set_config(
    'sellerpilot.elevenst_cookie_create_get_bind',
    '',
    true
  );
  if v_updated <> 1 then
    raise exception 'exact 11st cookie create GET bind projection failed'
      using errcode = '55000';
  end if;
  update sellerpilot_private.elevenst_cookie_create_get_observations observation
     set bound_at = coalesce(observation.bound_at, v_observation.recorded_at)
   where observation.id = v_observation.id;
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  )
  select listing.owner_id,
         'elevenst_cookie_create_get_bound',
         'product_listing',
         listing.id::text,
         jsonb_build_object(
           'contract', 'elevenst_cookie_create_get_only_v1',
           'productId', listing.product_id,
           'listingId', listing.id,
           'sourceJobId', v_observation.source_job_id,
           'sourceAttemptId', v_observation.source_attempt_id,
           'remoteId', '9598600918',
           'sellerSku', 'AUTO-780720401E2D4E4EA45F',
           'providerWritePerformed', false,
           'sourceJobRewritten', false,
           'observationId', v_observation.id
         )
    from sellerpilot_private.product_listings listing
   where listing.id = v_observation.listing_id;
  return true;
end;
$$;

revoke all on function
  public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)
  from public, anon, authenticated;
revoke all on function
  public.sellerpilot_service_record_elevenst_cookie_create_observation(
    uuid, text, text, integer, integer, boolean, boolean, text
  ) from public, anon, authenticated;
revoke all on function
  public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)
  to service_role;
grant execute on function
  public.sellerpilot_service_record_elevenst_cookie_create_observation(
    uuid, text, text, integer, integer, boolean, boolean, text
  ) to service_role;
grant execute on function
  public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)
  to service_role;

commit;
