-- Observe and bind one already-ACTIVE Temu QA item without ever issuing a
-- create, update, stop, or activation request. The only admitted remote tuple
-- is goods 608570473054515 / SKU 123896921649274 for the exact cable-clip QA
-- product. A fresh provider-certified readback is kept separate from the
-- explicit digest-confirmed internal adoption.

begin;

do $temu_existing_adoption_preflight$
declare
  v_later_history boolean := false;
  v_allowed_definition text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $history$
      select exists (
          select 1
            from supabase_migrations.schema_migrations migration
           where migration.version > '20260901173200'
        )
    $history$ into v_later_history;
  end if;
  if v_later_history then
    raise exception 'Temu existing-adoption migration history drifted'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.serverless_gateway_job_allowed(text,text)'::regprocedure
  ) into v_allowed_definition;
  if v_allowed_definition is null
     or position(
       'when p_operation = ''listing.publication.verify'' and p_channel = ''temu'''
       in v_allowed_definition
     ) = 0
     or to_regprocedure(
       'sellerpilot_private.serverless_static_egress_allowed(text)'
     ) is null then
    raise exception 'Temu existing-adoption executable preimage drifted'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'temu'
       and job.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'listing.activate', 'listing.publication.verify'
       )
       and job.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'Temu listing jobs must be terminal before adoption install'
      using errcode = '55000';
  end if;
end;
$temu_existing_adoption_preflight$;

create table sellerpilot_private.temu_exact_existing_adoption_reviews (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  goods_id text not null check (goods_id = '608570473054515'),
  sku_id text not null check (sku_id = '123896921649274'),
  approved_manifest_digest text not null
    check (approved_manifest_digest ~ '^[a-f0-9]{64}$'),
  request_fingerprint text not null unique
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  job_id uuid not null unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  status text not null check (status in (
    'queued', 'verifying', 'ready', 'failed', 'manual_required', 'committed'
  )),
  observation jsonb check (
    observation is null or (
      jsonb_typeof(observation) = 'object'
      and octet_length(observation::text) <= 131072
    )
  ),
  observation_digest text check (
    observation_digest is null or observation_digest ~ '^[a-f0-9]{64}$'
  ),
  last_error text check (last_error is null or length(last_error) <= 1000),
  observed_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, product_id),
  check (
    (status in ('queued', 'verifying', 'failed', 'manual_required')
      and committed_at is null)
    or (status = 'ready' and observation is not null
      and observation_digest is not null and observed_at is not null
      and committed_at is null)
    or (status = 'committed' and observation is not null
      and observation_digest is not null and observed_at is not null
      and committed_at is not null)
  )
);

create unique index temu_exact_existing_adoption_one_remote
  on sellerpilot_private.temu_exact_existing_adoption_reviews(
    seller_account_key, goods_id
  );

alter table sellerpilot_private.temu_exact_existing_adoption_reviews
  enable row level security;
revoke all on sellerpilot_private.temu_exact_existing_adoption_reviews
  from public, anon, authenticated, service_role;

create function sellerpilot_private.temu_exact_existing_adoption_observation(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review sellerpilot_private.temu_exact_existing_adoption_reviews%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_observation jsonb;
  v_observed_at timestamptz;
  v_step_count integer;
  v_price numeric;
  v_stock integer;
begin
  select * into v_review
    from sellerpilot_private.temu_exact_existing_adoption_reviews review
   where review.job_id = p_job_id;
  if not found then return null; end if;
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found
     or v_job.channel is distinct from 'temu'
     or v_job.operation is distinct from 'listing.publication.verify'
     or v_job.environment is distinct from 'production'
     or v_job.status is distinct from 'succeeded'
     or v_job.completed_at is null
     or v_job.started_at is null
     or v_job.listing_id is not null
     or v_job.attempt_id is not null
     or v_job.credential_id is distinct from v_review.credential_id
     or v_job.created_by is distinct from v_review.owner_id
     or v_job.seller_account_key is distinct from v_review.seller_account_key
     or v_job.request_fingerprint is distinct from v_review.request_fingerprint
     or v_job.provider_mutation_started_at is not null
     or v_job.credential_refresh_in_flight is distinct from false
     or v_job.response_payload->>'ok' is distinct from 'true'
     or v_job.response_payload->>'channel' is distinct from 'temu'
     or v_job.response_payload->>'operation' is distinct from
          'listing.publication.verify'
     or v_job.response_payload->>'remoteId' is distinct from v_review.goods_id
     or jsonb_typeof(v_job.response_payload->'steps') is distinct from 'array' then
    return null;
  end if;

  if v_job.request_payload#>'{arguments,sellerpilotReadOnly}'
       is distinct from 'true'::jsonb
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,contract}'
          is distinct from 'temu_exact_existing_active_adoption_v1'
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,reviewId}'
          is distinct from v_review.id::text
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,productId}'
          is distinct from v_review.product_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,credentialId}'
          is distinct from v_review.credential_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,goodsId}'
          is distinct from v_review.goods_id
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,skuId}'
          is distinct from v_review.sku_id
     or v_job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,approvedManifestDigest}'
          is distinct from v_review.approved_manifest_digest
     or (
       select count(*)
         from jsonb_object_keys(
           v_job.request_payload#>'{arguments,sellerpilotTemuExistingAdoption}'
         )
     ) is distinct from 7::bigint then
    return null;
  end if;

  select count(*)::integer
    into v_step_count
    from jsonb_array_elements(v_job.response_payload->'steps') step;
  select step->'data'->'sellerpilotTemuExistingAdoptionObservation'
    into v_observation
    from jsonb_array_elements(v_job.response_payload->'steps') step
   where step->>'name' = 'temu-existing-adoption-observation'
   limit 1;
  if v_step_count is distinct from 5
     or exists (
       select 1
         from jsonb_array_elements(v_job.response_payload->'steps') step
        where step->>'ok' is distinct from 'true'
           or step->'data' ? 'sellerpilotMutation'
     )
     or (
       select count(*)
         from jsonb_array_elements(v_job.response_payload->'steps') step
        where step->>'name' = 'temu-existing-adoption-observation'
     ) is distinct from 1::bigint
     or jsonb_typeof(v_observation) is distinct from 'object'
     or v_observation->>'contract' is distinct from
          'temu_exact_existing_active_observation_v1'
     or v_observation->>'verified' is distinct from 'true'
     or v_observation->>'goodsId' is distinct from v_review.goods_id
     or v_observation->>'skuId' is distinct from v_review.sku_id
     or v_observation->>'visibility' is distinct from 'live'
     or v_observation->>'locale' is distinct from 'ko-KR'
     or v_observation->>'currency' is distinct from 'KRW'
     or coalesce(v_observation->>'providerStatus', '') = ''
     or length(v_observation->>'providerStatus') > 160
     or v_observation->>'providerStatus' ~ '[[:cntrl:]]'
     or nullif(trim(v_observation->>'externalGoodsId'), '') is null
     or length(v_observation->>'externalGoodsId') > 128
     or v_observation->>'externalGoodsId' ~ '[[:cntrl:]]'
     or nullif(trim(v_observation->>'externalSkuId'), '') is null
     or length(v_observation->>'externalSkuId') > 128
     or v_observation->>'externalSkuId' ~ '[[:cntrl:]]'
     or coalesce(v_observation->>'digest', '') !~ '^[a-f0-9]{64}$'
     or nullif(trim(v_observation->>'goodsName'), '') is null
     or length(v_observation->>'goodsName') > 500
     or v_observation->>'goodsName' !~ '[가-힣]'
     or nullif(trim(v_observation->>'goodsDesc'), '') is null
     or length(v_observation->>'goodsDesc') > 20000
     or (v_observation->>'goodsDesc') || ' ' ||
          coalesce(v_observation->'bulletPoints', '[]'::jsonb)::text !~ '[가-힣]'
     or jsonb_typeof(v_observation->'bulletPoints') is distinct from 'array'
     or jsonb_typeof(v_observation->'representativeImages') is distinct from 'array'
     or jsonb_typeof(v_observation->'detailImages') is distinct from 'array' then
    return null;
  end if;
  if jsonb_array_length(v_observation->'bulletPoints') not between 1 and 10
     or jsonb_array_length(v_observation->'representativeImages') is distinct from 1
     or jsonb_array_length(v_observation->'detailImages') is distinct from 8
     or (
       select count(distinct image.value)
         from jsonb_array_elements_text(v_observation->'detailImages') image(value)
     ) is distinct from 8::bigint
     or exists (
       select 1
         from jsonb_array_elements_text(
           (v_observation->'representativeImages') ||
           (v_observation->'detailImages')
         ) image(value)
        where image.value !~ '^https://'
           or length(image.value) > 2048
           or image.value ~ '[[:cntrl:]]'
     )
     or exists (
       select 1
         from jsonb_array_elements_text(v_observation->'detailImages') detail(value)
        where detail.value = v_observation#>>'{representativeImages,0}'
     ) then
    return null;
  end if;

  begin
    v_observed_at := (v_observation->>'observedAt')::timestamptz;
    v_price := (v_observation->>'price')::numeric;
    v_stock := (v_observation->>'stock')::integer;
  exception when others then
    return null;
  end;
  if v_observed_at < v_job.started_at
     or v_observed_at > v_job.completed_at + interval '5 minutes'
     or v_observed_at > clock_timestamp() + interval '5 minutes'
     or v_price <= 0
     or v_price > 999999999999.99
     or v_stock < 0
     or v_stock > 999999999 then
    return null;
  end if;
  -- The worker digest is only transport evidence. Recompute the digest from
  -- PostgreSQL's canonical jsonb text before it becomes the confirmation key.
  v_observation := jsonb_set(
    v_observation,
    '{digest}',
    to_jsonb(encode(
      extensions.digest((v_observation - 'digest')::text, 'sha256'),
      'hex'
    )),
    false
  );
  return v_observation;
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.temu_exact_existing_adoption_observation(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_temu_exact_existing_adoption_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_marker text := current_setting(
    'sellerpilot.temu_existing_adoption_job', true
  );
  v_commit_marker text := current_setting(
    'sellerpilot.temu_existing_adoption_commit', true
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'Temu existing-adoption review is immutable';
  end if;
  if tg_op = 'INSERT' then
    if current_setting('sellerpilot.temu_existing_adoption_enqueue', true)
         is distinct from new.id::text
       or new.status is distinct from 'queued'
       or new.observation is not null
       or new.observation_digest is not null
       or new.observed_at is not null
       or new.committed_at is not null then
      raise exception 'Temu existing-adoption enqueue marker required'
        using errcode = '55000';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.product_id is distinct from old.product_id
     or new.credential_id is distinct from old.credential_id
     or new.seller_account_key is distinct from old.seller_account_key
     or new.goods_id is distinct from old.goods_id
     or new.sku_id is distinct from old.sku_id
     or new.approved_manifest_digest is distinct from old.approved_manifest_digest
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.job_id is distinct from old.job_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Temu existing-adoption identity is immutable';
  end if;
  if v_job_marker = old.job_id::text
     and old.status in ('queued', 'verifying')
     and new.status in ('queued', 'verifying', 'ready', 'failed', 'manual_required')
     and new.committed_at is null then
    return new;
  end if;
  if v_commit_marker = old.id::text
     and old.status = 'ready'
     and new.status = 'committed'
     and new.observation is not distinct from old.observation
     and new.observation_digest is not distinct from old.observation_digest
     and new.observed_at is not distinct from old.observed_at
     and new.committed_at is not null then
    return new;
  end if;
  raise exception 'Temu existing-adoption transition marker required'
    using errcode = '55000';
end;
$$;

create trigger guard_temu_exact_existing_adoption_review
before insert or update or delete
on sellerpilot_private.temu_exact_existing_adoption_reviews
for each row execute function
  sellerpilot_private.guard_temu_exact_existing_adoption_review();

revoke all on function
  sellerpilot_private.guard_temu_exact_existing_adoption_review()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_temu_exact_existing_adoption_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker jsonb;
begin
  if tg_op = 'DELETE' then
    if old.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,contract}' =
         'temu_exact_existing_active_adoption_v1' then
      raise exception 'Temu existing-adoption observation job is immutable';
    end if;
    return old;
  end if;
  v_marker := new.request_payload#>'{arguments,sellerpilotTemuExistingAdoption}';
  if jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contract' is distinct from
          'temu_exact_existing_active_adoption_v1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if current_setting('sellerpilot.temu_existing_adoption_enqueue', true)
         is distinct from v_marker->>'reviewId'
       or new.channel is distinct from 'temu'
       or new.operation is distinct from 'listing.publication.verify'
       or new.environment is distinct from 'production'
       or new.status is distinct from 'queued'
       or new.attempt_count is distinct from 0
       or new.listing_id is not null
       or new.attempt_id is not null
       or new.provider_mutation_started_at is not null
       or new.write_resource_kind is not null
       or new.write_resource_key is not null
       or new.request_fingerprint !~ '^[a-f0-9]{64}$'
       or new.request_payload#>'{arguments,sellerpilotReadOnly}'
            is distinct from 'true'::jsonb
       or v_marker->>'productId' is distinct from
            'ddccde35-9c58-4856-b673-d7aa27ce4220'
       or v_marker->>'credentialId' is distinct from new.credential_id::text
       or v_marker->>'goodsId' is distinct from '608570473054515'
       or v_marker->>'skuId' is distinct from '123896921649274'
       or coalesce(v_marker->>'approvedManifestDigest', '') !~ '^[a-f0-9]{64}$'
       or (select count(*) from jsonb_object_keys(v_marker)) is distinct from 7::bigint
       or not exists (
         select 1
           from sellerpilot_private.products product
          where product.id = (v_marker->>'productId')::uuid
            and product.owner_id = new.created_by
            and product.sku = 'QA-20260823-CC-001'
            and not product.demo
            and product.status <> 'archived'
            and product.detail_page_approved_version is not null
            and product.detail_page_version = product.detail_page_approved_version
            and product.detail_page_image_manifest->>'contract' =
                 'sellerpilot_detail_image_manifest_v2'
            and product.detail_page_image_manifest->>'algorithm' = 'sha256'
            and product.detail_page_image_manifest->>'digest' =
                 v_marker->>'approvedManifestDigest'
            and jsonb_typeof(
              product.detail_page_image_manifest->'images'
            ) = 'array'
            and jsonb_array_length(
              product.detail_page_image_manifest->'images'
            ) = 8
       )
       or not exists (
         select 1
           from sellerpilot_private.channel_credentials credential
          where credential.id = new.credential_id
            and credential.channel = 'temu'
            and credential.environment = 'production'
            and credential.status = 'active'
            and (credential.expires_at is null
              or credential.expires_at > statement_timestamp())
            and credential.created_by = new.created_by
            and credential.seller_account_key = new.seller_account_key
            and credential.seller_account_key_source = 'provider_certified_v1'
            and credential.seller_account_verified_at is not null
       ) then
      raise exception 'Temu exact existing-adoption observation lineage invalid'
        using errcode = '55000';
    end if;
    return new;
  end if;
  if new.credential_id is distinct from old.credential_id
     or new.attempt_id is distinct from old.attempt_id
     or new.listing_id is distinct from old.listing_id
     or new.channel is distinct from old.channel
     or new.operation is distinct from old.operation
     or new.environment is distinct from old.environment
     or new.request_payload is distinct from old.request_payload
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.seller_account_key is distinct from old.seller_account_key
     or new.created_by is distinct from old.created_by
     or new.provider_mutation_started_at is not null then
    raise exception 'Temu exact existing-adoption job identity is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_temu_exact_existing_adoption_job
before insert or update or delete
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_temu_exact_existing_adoption_job();

revoke all on function
  sellerpilot_private.guard_temu_exact_existing_adoption_job()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.sync_temu_exact_existing_adoption_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observation jsonb;
begin
  if new.channel is distinct from 'temu'
     or new.operation is distinct from 'listing.publication.verify'
     or new.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,contract}'
          is distinct from 'temu_exact_existing_active_adoption_v1' then
    return new;
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.temu_existing_adoption_job', new.id::text, true
  );
  if new.status = 'running' then
    update sellerpilot_private.temu_exact_existing_adoption_reviews review
       set status = 'verifying', updated_at = clock_timestamp()
     where review.job_id = new.id and review.status = 'queued';
  elsif old.status = 'running' and new.status = 'queued' then
    update sellerpilot_private.temu_exact_existing_adoption_reviews review
       set status = 'queued',
           last_error = 'Temu read-only observation lease was safely returned.',
           updated_at = clock_timestamp()
     where review.job_id = new.id and review.status = 'verifying';
  elsif new.status in ('succeeded', 'failed', 'reconciliation_required', 'cancelled')
        and new.completed_at is not null then
    v_observation :=
      sellerpilot_private.temu_exact_existing_adoption_observation(new.id);
    update sellerpilot_private.temu_exact_existing_adoption_reviews review
       set status = case
             when v_observation is not null then 'ready'
             when new.status = 'reconciliation_required' then 'manual_required'
             else 'failed'
           end,
           observation = v_observation,
           observation_digest = v_observation->>'digest',
           observed_at = case when v_observation is null then null
             else (v_observation->>'observedAt')::timestamptz end,
           last_error = case
             when v_observation is not null then null
             when new.status = 'reconciliation_required'
               then 'Temu read-only result needs manual reconciliation; no provider write was attempted.'
             else 'Fresh Temu identity, ACTIVE status, Korean content, KRW commerce, single SKU, and 1+8 images were not all verified.'
           end,
           updated_at = clock_timestamp()
     where review.job_id = new.id
       and review.status in ('queued', 'verifying');
  end if;
  return new;
end;
$$;

create trigger sync_temu_exact_existing_adoption_job
after insert or update of status
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.sync_temu_exact_existing_adoption_job();

revoke all on function
  sellerpilot_private.sync_temu_exact_existing_adoption_job()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_temu_exact_existing_adoption(
  p_product_id uuid,
  p_credential_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing sellerpilot_private.temu_exact_existing_adoption_reviews%rowtype;
  v_review_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
  v_manifest_digest text;
  v_fingerprint text;
  v_payload jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select * into v_product
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and product.owner_id = p_actor_user_id
     and product.sku = 'QA-20260823-CC-001'
     and not product.demo
     and product.status <> 'archived'
     and product.detail_page_approved_version is not null
     and product.detail_page_version = product.detail_page_approved_version
     and product.detail_page_image_manifest->>'contract' =
          'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'algorithm' = 'sha256'
     and coalesce(product.detail_page_image_manifest->>'digest', '') ~
          '^[a-f0-9]{64}$'
     and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
     and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
     and (
       select count(distinct image.value->>'role')
         from jsonb_array_elements(
           product.detail_page_image_manifest->'images'
         ) image(value)
     ) = 8
   for update;
  if not found then
    raise exception 'TEMU_EXISTING_ADOPTION_APPROVED_PRODUCT_REQUIRED'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.admin_users admin
     where admin.user_id = p_actor_user_id
  ) then
    raise exception 'TEMU_EXISTING_ADOPTION_ADMIN_REQUIRED'
      using errcode = '42501';
  end if;
  v_manifest_digest := v_product.detail_page_image_manifest->>'digest';

  select * into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and credential.created_by = p_actor_user_id
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    raise exception 'TEMU_EXISTING_ADOPTION_PROVIDER_CERTIFIED_CREDENTIAL_REQUIRED'
      using errcode = '55000';
  end if;
  if not sellerpilot_private.serverless_static_egress_allowed('temu') then
    raise exception 'TEMU_EXISTING_ADOPTION_STATIC_EGRESS_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.owner_id = p_actor_user_id
       and listing.channel_key = 'temu'
       and (
         listing.product_id = p_product_id
         or listing.remote_id = '608570473054515'
         or listing.remote_resources#>>'{resources,goodsId}' =
              '608570473054515'
       )
  ) then
    raise exception 'TEMU_EXISTING_ADOPTION_LISTING_ALREADY_BOUND'
      using errcode = '23505';
  end if;

  select * into v_existing
    from sellerpilot_private.temu_exact_existing_adoption_reviews review
   where review.owner_id = p_actor_user_id
     and review.product_id = p_product_id
   for update;
  if found then
    return jsonb_build_object(
      'contract', 'temu_exact_existing_active_adoption_v1',
      'status', v_existing.status,
      'reviewId', v_existing.id,
      'jobId', v_existing.job_id,
      'reused', true,
      'observationDigest', v_existing.observation_digest,
      'observation', v_existing.observation
    );
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'temu'
       and job.status in ('queued', 'running', 'reconciliation_required')
       and (
         job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,productId}' =
              p_product_id::text
         or job.request_payload#>>'{arguments,sellerpilotTemuExistingAdoption,goodsId}' =
              '608570473054515'
       )
  ) then
    raise exception 'TEMU_EXISTING_ADOPTION_OBSERVATION_ALREADY_ACTIVE'
      using errcode = '55000';
  end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'contract', 'temu_exact_existing_active_adoption_v1',
    'reviewId', v_review_id,
    'productId', p_product_id,
    'credentialId', p_credential_id,
    'sellerAccountKey', v_credential.seller_account_key,
    'goodsId', '608570473054515',
    'skuId', '123896921649274',
    'manifestDigest', v_manifest_digest
  )::text, 'sha256'), 'hex');
  v_payload := jsonb_build_object(
    'periodicKey', 'temu-existing-adoption:' || v_review_id::text,
    'arguments', jsonb_build_object(
      'sellerpilotReadOnly', true,
      'sellerpilotTemuExistingAdoption', jsonb_build_object(
        'contract', 'temu_exact_existing_active_adoption_v1',
        'reviewId', v_review_id,
        'productId', p_product_id,
        'credentialId', p_credential_id,
        'goodsId', '608570473054515',
        'skuId', '123896921649274',
        'approvedManifestDigest', v_manifest_digest
      )
    )
  );
  perform pg_catalog.set_config(
    'sellerpilot.temu_existing_adoption_enqueue', v_review_id::text, true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key,
    request_fingerprint, created_by, created_at, updated_at
  ) values (
    v_job_id, p_credential_id, null, null, 'temu',
    'listing.publication.verify', 'production', v_payload, 'queued',
    v_credential.seller_account_key, v_fingerprint, p_actor_user_id,
    clock_timestamp(), clock_timestamp()
  );
  insert into sellerpilot_private.temu_exact_existing_adoption_reviews (
    id, owner_id, product_id, credential_id, seller_account_key,
    goods_id, sku_id, approved_manifest_digest, request_fingerprint,
    job_id, status
  ) values (
    v_review_id, p_actor_user_id, p_product_id, p_credential_id,
    v_credential.seller_account_key, '608570473054515',
    '123896921649274', v_manifest_digest, v_fingerprint, v_job_id, 'queued'
  );
  return jsonb_build_object(
    'contract', 'temu_exact_existing_active_adoption_v1',
    'status', 'queued',
    'reviewId', v_review_id,
    'jobId', v_job_id,
    'reused', false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_temu_exact_existing_adoption(
    uuid, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_temu_exact_existing_adoption(
    uuid, uuid, uuid
  ) to service_role;

create function public.sellerpilot_service_commit_temu_exact_existing_adoption(
  p_product_id uuid,
  p_review_id uuid,
  p_observation_digest text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review sellerpilot_private.temu_exact_existing_adoption_reviews%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_observation jsonb;
  v_listing_id uuid := gen_random_uuid();
  v_price numeric;
  v_stock integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select * into v_review
    from sellerpilot_private.temu_exact_existing_adoption_reviews review
   where review.id = p_review_id
     and review.product_id = p_product_id
     and review.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and review.owner_id = p_actor_user_id
     and review.goods_id = '608570473054515'
     and review.sku_id = '123896921649274'
   for update;
  if not found
     or v_review.status <> 'ready'
     or v_review.observation_digest is distinct from
          lower(trim(coalesce(p_observation_digest, '')))
     or v_review.observed_at is null
     or v_review.observed_at < clock_timestamp() - interval '15 minutes' then
    raise exception 'TEMU_EXISTING_ADOPTION_FRESH_DIGEST_CONFIRMATION_REQUIRED'
      using errcode = '55000';
  end if;
  v_observation :=
    sellerpilot_private.temu_exact_existing_adoption_observation(
      v_review.job_id
    );
  if v_observation is null
     or v_observation is distinct from v_review.observation
     or v_observation->>'digest' is distinct from v_review.observation_digest
     or not exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_review.job_id
     ) then
    raise exception 'TEMU_EXISTING_ADOPTION_OBSERVATION_DRIFTED'
      using errcode = '55000';
  end if;

  select * into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_review.credential_id
     and credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and credential.created_by = p_actor_user_id
     and credential.seller_account_key = v_review.seller_account_key
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    raise exception 'TEMU_EXISTING_ADOPTION_PROVIDER_CERTIFIED_CREDENTIAL_REQUIRED'
      using errcode = '55000';
  end if;

  select * into v_product
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = p_actor_user_id
     and product.sku = 'QA-20260823-CC-001'
     and not product.demo
     and product.status <> 'archived'
     and product.detail_page_approved_version is not null
     and product.detail_page_version = product.detail_page_approved_version
     and product.detail_page_image_manifest->>'contract' =
          'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'algorithm' = 'sha256'
     and product.detail_page_image_manifest->>'digest' =
          v_review.approved_manifest_digest
     and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
     and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
   for update;
  if not found then
    raise exception 'TEMU_EXISTING_ADOPTION_APPROVED_PRODUCT_DRIFTED'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.owner_id = p_actor_user_id
       and listing.channel_key = 'temu'
       and (
         listing.product_id = p_product_id
         or listing.remote_id = v_review.goods_id
         or listing.remote_resources#>>'{resources,goodsId}' = v_review.goods_id
       )
  ) then
    raise exception 'TEMU_EXISTING_ADOPTION_LISTING_ALREADY_BOUND'
      using errcode = '23505';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'temu'
       and job.id <> v_review.job_id
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'listing.activate', 'listing.publication.verify'
       )
  ) then
    raise exception 'TEMU_EXISTING_ADOPTION_OTHER_JOB_ACTIVE'
      using errcode = '55000';
  end if;
  begin
    v_price := (v_observation->>'price')::numeric;
    v_stock := (v_observation->>'stock')::integer;
  exception when others then
    raise exception 'TEMU_EXISTING_ADOPTION_COMMERCE_INVALID'
      using errcode = '55000';
  end;

  insert into sellerpilot_private.product_listings (
    id, owner_id, product_id, channel_key, market, target_id,
    remote_id, marketplace_sku, status, currency, price,
    requested_publication_intent, remote_visibility, provider_status,
    remote_resources, seller_account_key, last_verified_at,
    published_at, last_error, failure_class, updated_at
  ) values (
    v_listing_id, p_actor_user_id, p_product_id, 'temu', 'KR', 'KR',
    v_review.goods_id, v_observation->>'externalSkuId', 'published',
    'KRW', v_price, 'live', 'live', v_observation->>'providerStatus',
    jsonb_build_object(
      'resources', jsonb_build_object(
        'goodsId', v_review.goods_id,
        'skuId', v_review.sku_id,
        'externalGoodsId', v_observation->>'externalGoodsId',
        'externalSkuId', v_observation->>'externalSkuId'
      ),
      'verification', jsonb_build_object(
        'contract', 'temu_exact_existing_active_adoption_v1',
        'reviewId', v_review.id,
        'jobId', v_review.job_id,
        'observationDigest', v_review.observation_digest,
        'observedAt', v_observation->>'observedAt',
        'locale', 'ko-KR',
        'currency', 'KRW',
        'price', v_observation->>'price',
        'stock', v_stock,
        'representativeImageCount', 1,
        'detailImageCount', 8,
        'readOnlyProviderObservation', true
      )
    ),
    v_review.seller_account_key, v_review.observed_at,
    v_review.observed_at, null, null, clock_timestamp()
  );

  perform pg_catalog.set_config(
    'sellerpilot.temu_existing_adoption_commit', v_review.id::text, true
  );
  update sellerpilot_private.temu_exact_existing_adoption_reviews review
     set status = 'committed',
         committed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where review.id = v_review.id and review.status = 'ready';
  if not found then
    raise exception 'TEMU_EXISTING_ADOPTION_COMMIT_RACE'
      using errcode = '40001';
  end if;
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    p_actor_user_id, 'temu_existing_listing_adopted', 'product_listing',
    v_listing_id::text,
    jsonb_build_object(
      'contract', 'temu_exact_existing_active_adoption_v1',
      'productId', p_product_id,
      'reviewId', v_review.id,
      'jobId', v_review.job_id,
      'goodsId', v_review.goods_id,
      'skuId', v_review.sku_id,
      'observationDigest', v_review.observation_digest,
      'providerWritePerformed', false
    )
  );
  return jsonb_build_object(
    'contract', 'temu_exact_existing_active_adoption_v1',
    'status', 'committed',
    'listingId', v_listing_id,
    'reviewId', v_review.id,
    'jobId', v_review.job_id,
    'remoteId', v_review.goods_id,
    'providerWritePerformed', false,
    'verifiedLocale', 'ko-KR',
    'verifiedCurrency', 'KRW',
    'verifiedPrice', v_observation->>'price',
    'verifiedStock', v_stock,
    'verifiedImageCount', 8
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_commit_temu_exact_existing_adoption(
    uuid, uuid, text, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_commit_temu_exact_existing_adoption(
    uuid, uuid, text, uuid
  ) to service_role;

create function public.sellerpilot_service_temu_exact_existing_adoption_status(
  p_product_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_review sellerpilot_private.temu_exact_existing_adoption_reviews%rowtype;
  v_credential record;
  v_product_ready boolean;
  v_listing_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select exists (
    select 1
      from sellerpilot_private.products product
     where product.id = p_product_id
       and product.id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and product.owner_id = p_actor_user_id
       and product.sku = 'QA-20260823-CC-001'
       and not product.demo
       and product.status <> 'archived'
       and product.detail_page_approved_version is not null
       and product.detail_page_version = product.detail_page_approved_version
       and product.detail_page_image_manifest->>'contract' =
            'sellerpilot_detail_image_manifest_v2'
       and product.detail_page_image_manifest->>'algorithm' = 'sha256'
       and coalesce(product.detail_page_image_manifest->>'digest', '') ~
            '^[a-f0-9]{64}$'
       and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
       and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
  ) into v_product_ready;
  select credential.id, credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and credential.created_by = p_actor_user_id
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
   order by credential.version desc, credential.created_at desc, credential.id
   limit 1;
  select listing.id into v_listing_id
    from sellerpilot_private.product_listings listing
   where listing.owner_id = p_actor_user_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'temu'
   limit 1;
  select * into v_review
    from sellerpilot_private.temu_exact_existing_adoption_reviews review
   where review.owner_id = p_actor_user_id
     and review.product_id = p_product_id;
  return jsonb_build_object(
    'contract', 'temu_exact_existing_active_adoption_v1',
    'exactProduct', p_product_id =
      'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'productReady', coalesce(v_product_ready, false),
    'providerCertifiedCredentialReady', v_credential.id is not null,
    'credentialId', v_credential.id,
    'staticEgressReady',
      sellerpilot_private.serverless_static_egress_allowed('temu'),
    'goodsId', '608570473054515',
    'skuId', '123896921649274',
    'listingId', v_listing_id,
    'reviewId', v_review.id,
    'jobId', v_review.job_id,
    'status', coalesce(v_review.status,
      case when v_listing_id is not null then 'already_bound' else 'not_started' end),
    'observationDigest', v_review.observation_digest,
    'observation', v_review.observation,
    'lastError', v_review.last_error,
    'observedAt', v_review.observed_at,
    'committedAt', v_review.committed_at,
    'runnable', coalesce(v_product_ready, false)
      and v_credential.id is not null
      and sellerpilot_private.serverless_static_egress_allowed('temu')
      and v_listing_id is null
      and (v_review.id is null or v_review.status in ('queued','verifying','ready'))
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_temu_exact_existing_adoption_status(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_temu_exact_existing_adoption_status(uuid, uuid)
  to service_role;

do $temu_existing_adoption_postflight$
declare
  v_enqueue_definition text;
  v_commit_definition text;
  v_observation_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_temu_exact_existing_adoption(uuid,uuid,uuid)'::regprocedure
  ) into v_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_temu_exact_existing_adoption(uuid,uuid,text,uuid)'::regprocedure
  ) into v_commit_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.temu_exact_existing_adoption_observation(uuid)'::regprocedure
  ) into v_observation_definition;
  if v_enqueue_definition is null
     or position('608570473054515' in v_enqueue_definition) = 0
     or position('123896921649274' in v_enqueue_definition) = 0
     or position('provider_certified_v1' in v_enqueue_definition) = 0
     or position('serverless_static_egress_allowed' in v_enqueue_definition) = 0
     or v_commit_definition is null
     or position('providerWritePerformed' in v_commit_definition) = 0
     or v_observation_definition is null
     or position('temu-existing-adoption-observation' in v_observation_definition) = 0
     or not has_function_privilege(
       'service_role',
       'public.sellerpilot_service_enqueue_temu_exact_existing_adoption(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.sellerpilot_service_enqueue_temu_exact_existing_adoption(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'Temu existing-adoption executable postimage failed'
      using errcode = '55000';
  end if;
end;
$temu_existing_adoption_postflight$;

comment on table
  sellerpilot_private.temu_exact_existing_adoption_reviews is
  'Two-phase read-only observation and explicit digest-confirmed binding for one exact already-ACTIVE Temu QA item; it never authorizes a provider create or update.';
comment on function
  public.sellerpilot_service_enqueue_temu_exact_existing_adoption(
    uuid, uuid, uuid
  ) is
  'Queues one exact provider-certified, static-egress, read-only observation for Temu goods 608570473054515 / SKU 123896921649274.';
comment on function
  public.sellerpilot_service_commit_temu_exact_existing_adoption(
    uuid, uuid, text, uuid
  ) is
  'Binds the exact Temu item internally only after the administrator repeats the fresh observation digest; performs zero provider writes.';

commit;
