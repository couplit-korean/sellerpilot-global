-- Certify the seller lineage of the one Temu credential used by the exact
-- existing-ACTIVE-item adoption. The credential is not rotated, replaced, or
-- revoked: one read-only access-token-info result supplies mallId, and a
-- separate digest-confirmed commit promotes only its relational lineage.

begin;

do $temu_credential_certification_preflight$
declare
  v_later_history boolean := false;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $history$
      select exists (
        select 1
          from supabase_migrations.schema_migrations migration
         where migration.version > '20260901173300'
      )
    $history$ into v_later_history;
  end if;
  if v_later_history then
    raise exception 'Temu credential-certification migration history drifted'
      using errcode = '55000';
  end if;
  if to_regprocedure(
       'public.sellerpilot_service_enqueue_temu_exact_existing_adoption(uuid,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'sellerpilot_private.guard_credential_seller_lineage()'
     ) is null then
    raise exception 'Temu credential-certification preimage missing'
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
    raise exception 'Temu listing jobs must be terminal before certification install'
      using errcode = '55000';
  end if;
end;
$temu_credential_certification_preflight$;

create table sellerpilot_private.temu_exact_credential_certification_reviews (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version bigint not null check (credential_version > 0),
  vault_secret_id uuid not null,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  goods_id text not null check (goods_id = '608570473054515'),
  sku_id text not null check (sku_id = '123896921649274'),
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
      and octet_length(observation::text) <= 32768
    )
  ),
  observation_digest text check (
    observation_digest is null or observation_digest ~ '^[a-f0-9]{64}$'
  ),
  provider_mall_id text check (
    provider_mall_id is null or provider_mall_id ~ '^[1-9][0-9]{0,18}$'
  ),
  certified_seller_account_key text check (
    certified_seller_account_key is null
      or certified_seller_account_key ~ '^[a-f0-9]{64}$'
  ),
  last_error text check (last_error is null or length(last_error) <= 1000),
  observed_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (credential_id),
  check (
    (status in ('queued', 'verifying', 'failed', 'manual_required')
      and observation is null and observation_digest is null
      and provider_mall_id is null and certified_seller_account_key is null
      and observed_at is null and committed_at is null)
    or (status = 'ready' and observation is not null
      and observation_digest is not null and provider_mall_id is not null
      and certified_seller_account_key is not null and observed_at is not null
      and committed_at is null)
    or (status = 'committed' and observation is not null
      and observation_digest is not null and provider_mall_id is not null
      and certified_seller_account_key is not null and observed_at is not null
      and committed_at is not null)
  )
);

alter table sellerpilot_private.temu_exact_credential_certification_reviews
  enable row level security;
revoke all on sellerpilot_private.temu_exact_credential_certification_reviews
  from public, anon, authenticated, service_role;

create function sellerpilot_private.temu_exact_credential_certification_observation(
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_review sellerpilot_private.temu_exact_credential_certification_reviews%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_observation jsonb;
  v_observed_at timestamptz;
  v_scope_count integer;
  v_expected_key text;
begin
  select * into v_review
    from sellerpilot_private.temu_exact_credential_certification_reviews review
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
     or v_job.response_payload ? 'remoteId'
     or jsonb_typeof(v_job.response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(v_job.response_payload->'steps') is distinct from 1
     or v_job.response_payload::text ~*
          '"(accessToken|access_token|app_secret|code)"[[:space:]]*:' then
    return null;
  end if;
  if v_job.request_payload#>'{arguments,sellerpilotReadOnly}'
       is distinct from 'true'::jsonb
     or v_job.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,contract}'
          is distinct from 'temu_exact_credential_certification_v1'
     or v_job.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,reviewId}'
          is distinct from v_review.id::text
     or v_job.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,productId}'
          is distinct from v_review.product_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,credentialId}'
          is distinct from v_review.credential_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,goodsId}'
          is distinct from v_review.goods_id
     or v_job.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,skuId}'
          is distinct from v_review.sku_id
     or (
       select count(*)
         from jsonb_object_keys(
           v_job.request_payload#>'{arguments,sellerpilotTemuCredentialCertification}'
         )
     ) is distinct from 6::bigint then
    return null;
  end if;
  select step->'data'->'sellerpilotTemuCredentialIdentity'
    into v_observation
    from jsonb_array_elements(v_job.response_payload->'steps') step
   where step->>'name' = 'temu-credential-certification-account'
     and step->>'ok' = 'true'
     and step->'data'->>'sellerpilotNoWriteConfirmed' = 'true'
     and step->'data'->>'sellerpilotNoSecretStored' = 'true'
   limit 1;
  if jsonb_typeof(v_observation) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_observation))
          is distinct from 9::bigint
     or v_observation->>'contract' is distinct from
          'temu_exact_credential_identity_observation_v1'
     or v_observation->>'verified' is distinct from 'true'
     or coalesce(v_observation->>'mallId', '') !~ '^[1-9][0-9]{0,18}$'
     or v_observation->>'sellerSubject' is distinct from
          'temu:mall:' || (v_observation->>'mallId')
     or coalesce(v_observation->>'sellerAccountKey', '') !~ '^[a-f0-9]{64}$'
     or coalesce(v_observation->>'apiScopeDigest', '') !~ '^[a-f0-9]{64}$'
     or coalesce(v_observation->>'digest', '') !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  v_expected_key := encode(extensions.digest(
    'temu' || E'\x1f' || 'production' || E'\x1f'
      || (v_observation->>'sellerSubject'),
    'sha256'
  ), 'hex');
  if v_observation->>'sellerAccountKey' is distinct from v_expected_key then
    return null;
  end if;
  begin
    v_observed_at := (v_observation->>'observedAt')::timestamptz;
    v_scope_count := (v_observation->>'apiScopeCount')::integer;
  exception when others then
    return null;
  end;
  if v_observed_at < v_job.started_at
     or v_observed_at > v_job.completed_at + interval '5 minutes'
     or v_observed_at > clock_timestamp() + interval '5 minutes'
     or v_scope_count not between 1 and 2000 then
    return null;
  end if;
  return jsonb_set(
    v_observation,
    '{digest}',
    to_jsonb(encode(
      extensions.digest((v_observation - 'digest')::text, 'sha256'),
      'hex'
    )),
    false
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.temu_exact_credential_certification_observation(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_temu_exact_credential_certification_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_marker text := current_setting(
    'sellerpilot.temu_credential_certification_job', true
  );
  v_commit_marker text := current_setting(
    'sellerpilot.temu_credential_certification_commit', true
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'Temu credential-certification review is immutable';
  end if;
  if tg_op = 'INSERT' then
    if current_setting('sellerpilot.temu_credential_certification_enqueue', true)
         is distinct from new.id::text
       or new.status is distinct from 'queued'
       or new.observation is not null
       or new.observation_digest is not null
       or new.provider_mall_id is not null
       or new.certified_seller_account_key is not null
       or new.observed_at is not null
       or new.committed_at is not null then
      raise exception 'Temu credential-certification enqueue marker required'
        using errcode = '55000';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.product_id is distinct from old.product_id
     or new.credential_id is distinct from old.credential_id
     or new.credential_version is distinct from old.credential_version
     or new.vault_secret_id is distinct from old.vault_secret_id
     or new.seller_account_key is distinct from old.seller_account_key
     or new.goods_id is distinct from old.goods_id
     or new.sku_id is distinct from old.sku_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.job_id is distinct from old.job_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Temu credential-certification identity is immutable';
  end if;
  if v_job_marker = old.job_id::text
     and old.status in ('queued', 'verifying')
     and new.status in ('queued', 'verifying', 'ready', 'failed', 'manual_required')
     and new.committed_at is null
     and (
       (new.status = 'ready' and new.observation is not null
         and new.observation_digest is not null
         and new.provider_mall_id is not null
         and new.certified_seller_account_key is not null
         and new.observed_at is not null)
       or (new.status <> 'ready' and new.observation is null
         and new.observation_digest is null and new.provider_mall_id is null
         and new.certified_seller_account_key is null and new.observed_at is null)
     ) then
    return new;
  end if;
  if v_commit_marker = old.id::text
     and old.status = 'ready'
     and new.status = 'committed'
     and new.observation is not distinct from old.observation
     and new.observation_digest is not distinct from old.observation_digest
     and new.provider_mall_id is not distinct from old.provider_mall_id
     and new.certified_seller_account_key is not distinct from
          old.certified_seller_account_key
     and new.observed_at is not distinct from old.observed_at
     and new.committed_at is not null then
    return new;
  end if;
  raise exception 'Temu credential-certification transition marker required'
    using errcode = '55000';
end;
$$;

create trigger guard_temu_exact_credential_certification_review
before insert or update or delete
on sellerpilot_private.temu_exact_credential_certification_reviews
for each row execute function
  sellerpilot_private.guard_temu_exact_credential_certification_review();

revoke all on function
  sellerpilot_private.guard_temu_exact_credential_certification_review()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_temu_exact_credential_certification_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker jsonb;
begin
  if tg_op = 'DELETE' then
    if old.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,contract}' =
         'temu_exact_credential_certification_v1' then
      raise exception 'Temu credential-certification job is immutable';
    end if;
    return old;
  end if;
  v_marker := new.request_payload#>'{arguments,sellerpilotTemuCredentialCertification}';
  if jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contract' is distinct from
          'temu_exact_credential_certification_v1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if current_setting('sellerpilot.temu_credential_certification_enqueue', true)
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
       or (select count(*) from jsonb_object_keys(v_marker))
            is distinct from 6::bigint
       or not exists (
         select 1
           from sellerpilot_private.products product
          where product.id = (v_marker->>'productId')::uuid
            and product.owner_id = new.created_by
            and product.sku = 'QA-20260823-CC-001'
            and not product.demo
            and product.status <> 'archived'
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
            and credential.seller_account_key_source = 'credential_incarnation_v1'
            and credential.seller_account_verified_at is not null
       ) then
      raise exception 'Temu exact credential-certification job lineage invalid'
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
    raise exception 'Temu exact credential-certification job identity is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_temu_exact_credential_certification_job
before insert or update or delete
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_temu_exact_credential_certification_job();

revoke all on function
  sellerpilot_private.guard_temu_exact_credential_certification_job()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.sync_temu_exact_credential_certification_job()
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
     or new.request_payload#>>'{arguments,sellerpilotTemuCredentialCertification,contract}'
          is distinct from 'temu_exact_credential_certification_v1' then
    return new;
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.temu_credential_certification_job', new.id::text, true
  );
  if new.status = 'running' then
    update sellerpilot_private.temu_exact_credential_certification_reviews review
       set status = 'verifying', updated_at = clock_timestamp()
     where review.job_id = new.id and review.status = 'queued';
  elsif old.status = 'running' and new.status = 'queued' then
    update sellerpilot_private.temu_exact_credential_certification_reviews review
       set status = 'queued',
           last_error = 'Temu access-token-info lease was safely returned.',
           updated_at = clock_timestamp()
     where review.job_id = new.id and review.status = 'verifying';
  elsif new.status in ('succeeded', 'failed', 'reconciliation_required', 'cancelled')
        and new.completed_at is not null then
    v_observation :=
      sellerpilot_private.temu_exact_credential_certification_observation(new.id);
    update sellerpilot_private.temu_exact_credential_certification_reviews review
       set status = case
             when v_observation is not null then 'ready'
             when new.status = 'reconciliation_required' then 'manual_required'
             else 'failed'
           end,
           observation = v_observation,
           observation_digest = v_observation->>'digest',
           provider_mall_id = v_observation->>'mallId',
           certified_seller_account_key = v_observation->>'sellerAccountKey',
           observed_at = case when v_observation is null then null
             else (v_observation->>'observedAt')::timestamptz end,
           last_error = case
             when v_observation is not null then null
             when new.status = 'reconciliation_required'
               then 'Temu account readback needs reconciliation; no provider write or credential rotation was attempted.'
             else 'Temu mallId and access-token-info scope were not provider-verified.'
           end,
           updated_at = clock_timestamp()
     where review.job_id = new.id
       and review.status in ('queued', 'verifying');
  end if;
  return new;
end;
$$;

create trigger sync_temu_exact_credential_certification_job
after insert or update of status
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.sync_temu_exact_credential_certification_job();

revoke all on function
  sellerpilot_private.sync_temu_exact_credential_certification_job()
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.guard_credential_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineage record;
  v_review sellerpilot_private.temu_exact_credential_certification_reviews%rowtype;
  v_marker text := nullif(
    current_setting('sellerpilot.temu_exact_credential_lineage', true), ''
  );
begin
  if tg_op = 'INSERT' then
    select * into v_lineage
      from sellerpilot_private.credential_seller_account_lineage(
        new.channel,
        new.environment,
        new.vault_secret_id
      );
    new.seller_account_key := v_lineage.seller_account_key;
    new.seller_account_key_source := v_lineage.seller_account_key_source;
    new.seller_account_verified_at := v_lineage.seller_account_verified_at;
    return new;
  end if;

  if new.vault_secret_id is distinct from old.vault_secret_id
     or new.channel is distinct from old.channel
     or new.environment is distinct from old.environment
     or new.seller_account_key is distinct from old.seller_account_key
     or new.seller_account_key_source is distinct from old.seller_account_key_source
     or new.seller_account_verified_at is distinct from old.seller_account_verified_at then
    if v_marker is not null
       and (to_jsonb(new) - array[
          'seller_account_key', 'seller_account_key_source',
          'seller_account_verified_at'
       ]::text[]) is not distinct from
       (to_jsonb(old) - array[
          'seller_account_key', 'seller_account_key_source',
          'seller_account_verified_at'
       ]::text[])
       and old.channel = 'temu'
       and old.environment = 'production'
       and old.status = 'active'
       and old.seller_account_key ~ '^[a-f0-9]{64}$'
       and old.seller_account_key_source = 'credential_incarnation_v1'
       and old.seller_account_verified_at is not null
       and new.seller_account_key ~ '^[a-f0-9]{64}$'
       and new.seller_account_key_source = 'provider_certified_v1'
       and new.seller_account_verified_at is not null then
      select * into v_review
        from sellerpilot_private.temu_exact_credential_certification_reviews review
       where review.id::text = v_marker
         and review.credential_id = old.id
         and review.credential_version = old.version
         and review.vault_secret_id = old.vault_secret_id
         and review.seller_account_key = old.seller_account_key
         and review.product_id =
              'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and review.goods_id = '608570473054515'
         and review.sku_id = '123896921649274'
         and review.status = 'ready'
         and review.observed_at >= clock_timestamp() - interval '15 minutes'
         and review.provider_mall_id ~ '^[1-9][0-9]{0,18}$'
         and review.certified_seller_account_key = new.seller_account_key
         and review.observation->>'mallId' = review.provider_mall_id
         and review.observation->>'sellerSubject' =
              'temu:mall:' || review.provider_mall_id
         and review.observation->>'sellerAccountKey' = new.seller_account_key;
      if found
         and new.seller_account_key = encode(extensions.digest(
           'temu' || E'\x1f' || 'production' || E'\x1f'
             || 'temu:mall:' || v_review.provider_mall_id,
           'sha256'
         ), 'hex')
         and new.seller_account_verified_at >= v_review.observed_at
         and new.seller_account_verified_at <= clock_timestamp() + interval '5 minutes'
         and sellerpilot_private.temu_exact_credential_certification_observation(
           v_review.job_id
         ) is not distinct from v_review.observation
         and exists (
           select 1
             from sellerpilot_private.gateway_completion_receipts receipt
            where receipt.job_id = v_review.job_id
         )
         and not exists (
           select 1
             from sellerpilot_private.product_listings listing
            where listing.channel_key = 'temu'
              and listing.seller_account_key = old.seller_account_key
         ) then
        return new;
      end if;
    end if;
    if (to_jsonb(new) - array[
          'seller_account_key',
          'seller_account_key_source',
          'seller_account_verified_at'
        ]::text[])
         is not distinct from
       (to_jsonb(old) - array[
          'seller_account_key',
          'seller_account_key_source',
          'seller_account_verified_at'
        ]::text[])
       and old.seller_account_key is null
       and old.seller_account_key_source = 'legacy_unattested'
       and old.seller_account_verified_at is null then
      select * into v_lineage
        from sellerpilot_private.credential_seller_account_lineage(
          new.channel,
          new.environment,
          new.vault_secret_id
        );
      if v_lineage.seller_account_key ~ '^[a-f0-9]{64}$'
         and v_lineage.seller_account_key_source = 'provider_certified_v1'
         and v_lineage.seller_account_verified_at is not null then
        new.seller_account_key := v_lineage.seller_account_key;
        new.seller_account_key_source := v_lineage.seller_account_key_source;
        new.seller_account_verified_at := v_lineage.seller_account_verified_at;
        return new;
      end if;
    end if;
    raise exception 'credential seller lineage is immutable';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_credential_seller_lineage()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_temu_exact_credential_certification(
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
  v_existing sellerpilot_private.temu_exact_credential_certification_reviews%rowtype;
  v_review_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
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
   for update;
  if not found or not exists (
    select 1 from sellerpilot_private.admin_users admin
     where admin.user_id = p_actor_user_id
  ) then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_EXACT_ADMIN_PRODUCT_REQUIRED'
      using errcode = '42501';
  end if;
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
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_ACTIVE_INCARNATION_REQUIRED'
      using errcode = '55000';
  end if;
  if not sellerpilot_private.serverless_static_egress_allowed('temu') then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_STATIC_EGRESS_REQUIRED'
      using errcode = '55000';
  end if;
  select * into v_existing
    from sellerpilot_private.temu_exact_credential_certification_reviews review
   where review.owner_id = p_actor_user_id
     and review.product_id = p_product_id
     and review.credential_id = p_credential_id
   for update;
  if found then
    return jsonb_build_object(
      'contract', 'temu_exact_credential_certification_v1',
      'status', v_existing.status,
      'reviewId', v_existing.id,
      'jobId', v_existing.job_id,
      'reused', true,
      'observationDigest', v_existing.observation_digest
    );
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'temu'
       and job.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_OTHER_JOB_ACTIVE'
      using errcode = '55000';
  end if;
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'contract', 'temu_exact_credential_certification_v1',
    'reviewId', v_review_id,
    'productId', p_product_id,
    'credentialId', p_credential_id,
    'credentialVersion', v_credential.version,
    'vaultSecretId', v_credential.vault_secret_id,
    'sellerAccountKey', v_credential.seller_account_key,
    'goodsId', '608570473054515',
    'skuId', '123896921649274'
  )::text, 'sha256'), 'hex');
  v_payload := jsonb_build_object(
    'periodicKey', 'temu-credential-certification:' || v_review_id::text,
    'arguments', jsonb_build_object(
      'sellerpilotReadOnly', true,
      'sellerpilotTemuCredentialCertification', jsonb_build_object(
        'contract', 'temu_exact_credential_certification_v1',
        'reviewId', v_review_id,
        'productId', p_product_id,
        'credentialId', p_credential_id,
        'goodsId', '608570473054515',
        'skuId', '123896921649274'
      )
    )
  );
  perform pg_catalog.set_config(
    'sellerpilot.temu_credential_certification_enqueue', v_review_id::text, true
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
  insert into sellerpilot_private.temu_exact_credential_certification_reviews (
    id, owner_id, product_id, credential_id, credential_version,
    vault_secret_id, seller_account_key, goods_id, sku_id,
    request_fingerprint, job_id, status
  ) values (
    v_review_id, p_actor_user_id, p_product_id, p_credential_id,
    v_credential.version, v_credential.vault_secret_id,
    v_credential.seller_account_key, '608570473054515',
    '123896921649274', v_fingerprint, v_job_id, 'queued'
  );
  return jsonb_build_object(
    'contract', 'temu_exact_credential_certification_v1',
    'status', 'queued',
    'reviewId', v_review_id,
    'jobId', v_job_id,
    'reused', false,
    'providerWritePerformed', false,
    'credentialRotated', false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_temu_exact_credential_certification(
    uuid, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_temu_exact_credential_certification(
    uuid, uuid, uuid
  ) to service_role;

create function public.sellerpilot_service_commit_temu_exact_credential_certification(
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
  v_review sellerpilot_private.temu_exact_credential_certification_reviews%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_observation jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select * into v_review
    from sellerpilot_private.temu_exact_credential_certification_reviews review
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
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_FRESH_DIGEST_REQUIRED'
      using errcode = '55000';
  end if;
  v_observation :=
    sellerpilot_private.temu_exact_credential_certification_observation(
      v_review.job_id
    );
  if v_observation is null
     or v_observation is distinct from v_review.observation
     or v_observation->>'digest' is distinct from v_review.observation_digest
     or v_observation->>'mallId' is distinct from v_review.provider_mall_id
     or v_observation->>'sellerAccountKey' is distinct from
          v_review.certified_seller_account_key
     or not exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_review.job_id
     ) then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_OBSERVATION_DRIFTED'
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
     and credential.version = v_review.credential_version
     and credential.vault_secret_id = v_review.vault_secret_id
     and credential.seller_account_key = v_review.seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_CREDENTIAL_DRIFTED'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.channel_key = 'temu'
       and listing.seller_account_key = v_review.seller_account_key
  ) or exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.credential_id = v_review.credential_id
       and job.id <> v_review.job_id
       and job.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_DEPENDENT_LINEAGE_ACTIVE'
      using errcode = '55000';
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.temu_exact_credential_lineage', v_review.id::text, true
  );
  update sellerpilot_private.channel_credentials credential
     set seller_account_key = v_review.certified_seller_account_key,
         seller_account_key_source = 'provider_certified_v1',
         seller_account_verified_at = clock_timestamp()
   where credential.id = v_review.credential_id
     and credential.status = 'active'
     and credential.version = v_review.credential_version
     and credential.vault_secret_id = v_review.vault_secret_id
     and credential.seller_account_key = v_review.seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1';
  if not found then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_COMMIT_RACE'
      using errcode = '40001';
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.temu_credential_certification_commit', v_review.id::text, true
  );
  update sellerpilot_private.temu_exact_credential_certification_reviews review
     set status = 'committed', committed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where review.id = v_review.id and review.status = 'ready';
  if not found then
    raise exception 'TEMU_CREDENTIAL_CERTIFICATION_COMMIT_RACE'
      using errcode = '40001';
  end if;
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    p_actor_user_id, 'temu_credential_provider_identity_certified',
    'channel_credential', v_review.credential_id::text,
    jsonb_build_object(
      'contract', 'temu_exact_credential_certification_v1',
      'productId', p_product_id,
      'reviewId', v_review.id,
      'jobId', v_review.job_id,
      'goodsId', v_review.goods_id,
      'skuId', v_review.sku_id,
      'mallId', v_review.provider_mall_id,
      'observationDigest', v_review.observation_digest,
      'providerWritePerformed', false,
      'credentialRotated', false,
      'vaultSecretChanged', false,
      'credentialStatusChanged', false
    )
  );
  return jsonb_build_object(
    'contract', 'temu_exact_credential_certification_v1',
    'status', 'committed',
    'reviewId', v_review.id,
    'jobId', v_review.job_id,
    'credentialId', v_review.credential_id,
    'providerCertified', true,
    'providerWritePerformed', false,
    'credentialRotated', false,
    'vaultSecretChanged', false,
    'credentialStatus', 'active'
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_commit_temu_exact_credential_certification(
    uuid, uuid, text, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_commit_temu_exact_credential_certification(
    uuid, uuid, text, uuid
  ) to service_role;

create function public.sellerpilot_service_temu_exact_credential_certification_status(
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
  v_review sellerpilot_private.temu_exact_credential_certification_reviews%rowtype;
  v_credential record;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <>
       'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select credential.id, credential.seller_account_key_source,
         credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'temu'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and credential.created_by = p_actor_user_id
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
   order by credential.version desc, credential.created_at desc, credential.id
   limit 1;
  select * into v_review
    from sellerpilot_private.temu_exact_credential_certification_reviews review
   where review.owner_id = p_actor_user_id
     and review.product_id = p_product_id
   order by review.created_at desc, review.id desc
   limit 1;
  return jsonb_build_object(
    'contract', 'temu_exact_credential_certification_v1',
    'credentialId', v_credential.id,
    'providerCertified', v_credential.seller_account_key_source =
      'provider_certified_v1',
    'credentialSource', v_credential.seller_account_key_source,
    'reviewId', v_review.id,
    'jobId', v_review.job_id,
    'status', coalesce(v_review.status,
      case when v_credential.seller_account_key_source = 'provider_certified_v1'
        then 'already_certified' else 'not_started' end),
    'observationDigest', v_review.observation_digest,
    'lastError', v_review.last_error,
    'observedAt', v_review.observed_at,
    'committedAt', v_review.committed_at,
    'staticEgressReady',
      sellerpilot_private.serverless_static_egress_allowed('temu'),
    'runnable', p_product_id =
        'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
      and v_credential.id is not null
      and v_credential.seller_account_key_source = 'credential_incarnation_v1'
      and sellerpilot_private.serverless_static_egress_allowed('temu')
      and (v_review.id is null or v_review.status in ('queued','verifying','ready'))
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_temu_exact_credential_certification_status(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_temu_exact_credential_certification_status(uuid, uuid)
  to service_role;

do $temu_credential_certification_postflight$
declare
  v_guard text;
  v_enqueue text;
  v_commit text;
  v_allowlist text;
  v_completion text;
  v_completion_predecessor text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_credential_seller_lineage()'::regprocedure
  ) into v_guard;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_temu_exact_credential_certification(uuid,uuid,uuid)'::regprocedure
  ) into v_enqueue;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_temu_exact_credential_certification(uuid,uuid,text,uuid)'::regprocedure
  ) into v_commit;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.serverless_gateway_job_allowed(text,text)'::regprocedure
  ) into v_allowlist;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_completion;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_completion_predecessor;
  if position('temu_exact_credential_lineage' in v_guard) = 0
     or position('credential_incarnation_v1' in v_enqueue) = 0
     or position('credentialRotated' in v_commit) = 0
     or position(
       'when p_operation = ''listing.publication.verify'' and p_channel = ''temu'''
       in
       v_allowlist
     ) = 0
     or position(
       'sellerpilot_09011715_complete_lineage_before_shopee_adoption'
       in
       v_completion
     ) = 0
     or position('sellerpilot_shopee_sg_existing_adoption_v1' in v_completion) = 0
     or position(
       'sellerpilot_private.exact_lazada_live_adoption_allowed'
       in
       v_completion_predecessor
     ) = 0
     or has_table_privilege(
       'service_role',
       'sellerpilot_private.temu_exact_credential_certification_reviews',
       'SELECT'
     )
     or not has_function_privilege(
       'service_role',
       'public.sellerpilot_service_enqueue_temu_exact_credential_certification(uuid,uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.sellerpilot_service_commit_temu_exact_credential_certification(uuid,uuid,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'Temu credential-certification postimage invalid'
      using errcode = '55000';
  end if;
end;
$temu_credential_certification_postflight$;

comment on table sellerpilot_private.temu_exact_credential_certification_reviews is
  'Private exact-item evidence for one read-only Temu mallId lineage certification; never stores access tokens or app secrets.';

commit;
