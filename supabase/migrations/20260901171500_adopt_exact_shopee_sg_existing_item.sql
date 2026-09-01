-- Adopt the already-existing Shopee SG QA item only after a claim-bound,
-- account-scoped provider readback proves its complete identity. This flow
-- never calls listing.create and leaves the item UNLIST/non-public so the
-- ordinary listing.update gateway can make the later approved edit.

begin;

create table sellerpilot_private.shopee_existing_adoption_attestations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  gateway_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  seller_account_key text not null
    check (seller_account_key ~ '^[a-f0-9]{64}$'),
  remote_id text not null check (remote_id = '53717126190'),
  marketplace_sku text not null check (marketplace_sku = 'QA-20260823-CC-001'),
  merchant_id text not null check (merchant_id = '5511564'),
  shop_id text not null check (shop_id = '1719148844'),
  market text not null check (market = 'SG'),
  locale text not null check (locale = 'en-SG'),
  currency text not null check (currency = 'SGD'),
  price numeric(14,2) not null check (price > 0),
  provider_status text not null check (provider_status = 'UNLIST'),
  gallery_image_count integer not null check (gallery_image_count between 1 and 9),
  detail_image_count integer not null check (detail_image_count = 8),
  title_digest text not null check (title_digest ~ '^[a-f0-9]{64}$'),
  description_digest text not null check (description_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid)
);

alter table sellerpilot_private.shopee_existing_adoption_attestations
  enable row level security;
revoke all on table sellerpilot_private.shopee_existing_adoption_attestations
  from public, anon, authenticated, service_role;

create function sellerpilot_private.shopee_sg_existing_adoption_credential_allowed(
  p_credential_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret jsonb;
  v_shop_matches boolean := false;
  v_merchant_matches boolean := false;
begin
  select decrypted.decrypted_secret::jsonb
    into v_secret
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found
     or jsonb_typeof(v_secret) <> 'object'
     or v_secret->>'partner_id' <> '2031489'
     or v_secret->>'provider_account_identity_version' <> 'v1'
     or coalesce(v_secret->>'provider_account_subject', '')
          !~ '^shopee:(main|shop):[0-9]+$' then
    return false;
  end if;

  v_shop_matches := v_secret->>'shop_id' = '1719148844'
    or exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_secret->'shop_ids') = 'array'
            then v_secret->'shop_ids' else '[]'::jsonb end
        ) value
       where value#>>'{}' = '1719148844'
    )
    or exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_secret->'shopee_targets') = 'array'
            then v_secret->'shopee_targets' else '[]'::jsonb end
        ) target
       where target->>'type' = 'shop'
         and target->>'id' = '1719148844'
    );
  v_merchant_matches := v_secret->>'merchant_id' = '5511564'
    or exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_secret->'merchant_ids') = 'array'
            then v_secret->'merchant_ids' else '[]'::jsonb end
        ) value
       where value#>>'{}' = '5511564'
    )
    or exists (
      select 1
        from jsonb_array_elements(
          case when jsonb_typeof(v_secret->'shopee_targets') = 'array'
            then v_secret->'shopee_targets' else '[]'::jsonb end
        ) target
       where target->>'type' = 'merchant'
         and target->>'id' = '5511564'
    );
  return v_shop_matches and v_merchant_matches;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.shopee_sg_existing_adoption_credential_allowed(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_shopee_existing_adoption_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_listing record;
  v_marker text := current_setting(
    'sellerpilot.shopee_existing_adoption', true
  );
begin
  if tg_op <> 'INSERT'
     or v_marker is distinct from new.gateway_job_id::text then
    raise exception 'Shopee existing adoption attestation is immutable';
  end if;
  select job.listing_id, job.credential_id, job.channel, job.environment,
         job.operation, job.status, job.seller_account_key,
         job.request_payload
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.gateway_job_id
   for update;
  select listing.owner_id, listing.product_id, listing.remote_id,
         listing.marketplace_sku, listing.channel_key, listing.market,
         listing.target_id, listing.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = new.listing_id
   for update;
  if not found
     or v_job.operation <> 'listing.lineage.verify'
     or v_job.status <> 'succeeded'
     or v_job.channel <> 'shopee'
     or v_job.environment <> 'production'
     or v_job.listing_id is distinct from new.listing_id
     or v_job.credential_id is distinct from new.credential_id
     or v_job.seller_account_key is distinct from new.seller_account_key
     or v_listing.owner_id is distinct from new.owner_id
     or v_listing.product_id is distinct from new.product_id
     or v_listing.remote_id is distinct from new.remote_id
     or v_listing.marketplace_sku is distinct from new.marketplace_sku
     or v_listing.channel_key <> 'shopee'
     or v_listing.market <> 'SG'
     or v_listing.target_id <> '1719148844'
     or v_listing.seller_account_key is distinct from new.seller_account_key
     or v_job.request_payload#>>'{arguments,sellerpilotShopeeSgExistingAdoption,contract}'
          <> 'sellerpilot_shopee_sg_existing_adoption_v1' then
    raise exception 'exact completed Shopee adoption lineage required';
  end if;
  return new;
end;
$$;

create trigger guard_shopee_existing_adoption_attestation
before insert or update or delete
on sellerpilot_private.shopee_existing_adoption_attestations
for each row execute function
  sellerpilot_private.guard_shopee_existing_adoption_attestation();

revoke all on function
  sellerpilot_private.guard_shopee_existing_adoption_attestation()
  from public, anon, authenticated, service_role;

create function sellerpilot_private.shopee_existing_adoption_projection_allowed(
  p_old jsonb,
  p_new jsonb,
  p_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attestation sellerpilot_private.shopee_existing_adoption_attestations%rowtype;
  v_resources jsonb;
begin
  select attestation.* into v_attestation
    from sellerpilot_private.shopee_existing_adoption_attestations attestation
   where attestation.gateway_job_id = p_job_id;
  if not found then return false; end if;
  v_resources := jsonb_build_object(
    'resources', jsonb_build_object(
      'localItemId', v_attestation.remote_id,
      'shopId', v_attestation.shop_id,
      'merchantId', v_attestation.merchant_id,
      'sku', v_attestation.marketplace_sku
    ),
    'verification', jsonb_build_object(
      'evidenceVersion', 'shopee_existing_adoption_readback_v1',
      'locale', v_attestation.locale,
      'galleryImageCount', v_attestation.gallery_image_count,
      'detailImageCount', v_attestation.detail_image_count,
      'titleDigest', v_attestation.title_digest,
      'descriptionDigest', v_attestation.description_digest
    )
  );
  return p_old->>'id' = v_attestation.listing_id::text
    and p_old->>'product_id' = v_attestation.product_id::text
    and p_old->>'owner_id' = v_attestation.owner_id::text
    and p_old->>'channel_key' = 'shopee'
    and p_old->>'remote_id' = v_attestation.remote_id
    and p_old->>'marketplace_sku' = v_attestation.marketplace_sku
    and p_old->>'market' = v_attestation.market
    and p_old->>'target_id' = v_attestation.shop_id
    and p_old->>'seller_account_key' = v_attestation.seller_account_key
    and p_old->>'status' = 'paused'
    and p_old->>'remote_visibility' = 'unknown'
    and p_new = p_old || jsonb_build_object(
      'currency', v_attestation.currency,
      'price', to_jsonb(v_attestation.price),
      'requested_publication_intent', 'safe_test',
      'remote_visibility', 'non_public',
      'provider_status', v_attestation.provider_status,
      'remote_resources', v_resources,
      'published_at', 'null'::jsonb,
      'last_verified_at', to_jsonb(v_attestation.verified_at),
      'last_error', 'null'::jsonb,
      'failure_class', 'null'::jsonb,
      'updated_at', to_jsonb(v_attestation.verified_at)
    );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.shopee_existing_adoption_projection_allowed(jsonb,jsonb,uuid)
  from public, anon, authenticated, service_role;

do $patch_shopee_adoption_listing_guard$
declare
  v_definition text;
  v_before text;
  v_after text;
  v_branch text := '  if nullif(current_setting(''sellerpilot.shopee_existing_adoption'', true), '''') is not null then
    if not sellerpilot_private.shopee_existing_adoption_projection_allowed(
      to_jsonb(old), to_jsonb(new),
      current_setting(''sellerpilot.shopee_existing_adoption'', true)::uuid
    ) then
      raise exception ''invalid Shopee existing adoption projection'';
    end if;
    return new;
  end if;

';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilot.shopee_existing_adoption') > 0 then
    return;
  end if;
  v_before := 'begin
  if nullif(current_setting(''sellerpilot.elevenst_manual_live_reconciliation'', true), '''') is not null then';
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    v_before := 'begin
  if old.seller_account_key is null';
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'Shopee adoption listing guard preimage drifted'
      using errcode = '55000';
  end if;
  v_after := 'begin
' || v_branch || pg_catalog.substr(v_before, length('begin
') + 1);
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_shopee_adoption_listing_guard$;

create function public.sellerpilot_service_enqueue_shopee_sg_existing_adoption(
  p_actor_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_credential record;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_existing_job record;
  v_listing_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_arguments jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_actor_id is null or not exists (
    select 1 from sellerpilot_private.admin_users admin_user
     where admin_user.user_id = p_actor_id
  ) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_product_id is distinct from
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid then
    return jsonb_build_object(
      'status', 'manual_required', 'reason', 'product_identity_mismatch',
      'reused', true
    );
  end if;
  select product.id, product.owner_id, product.sku
    into v_product
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.sku = 'QA-20260823-CC-001'
     and not product.demo
     and product.status <> 'archived'
   for update;
  if not found then
    return jsonb_build_object(
      'status', 'manual_required', 'reason', 'product_identity_mismatch',
      'reused', true
    );
  end if;

  select credential.id, credential.environment, credential.created_by,
         credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and sellerpilot_private.shopee_sg_existing_adoption_credential_allowed(
       credential.id
     )
   for update;
  if not found or not exists (
    select 1
      from sellerpilot_private.channel_market_targets target
     where target.credential_id = p_credential_id
       and target.owner_id = v_product.owner_id
       and target.channel = 'shopee'
       and target.environment = 'production'
       and target.market_code = 'SG'
       and target.target_id = '1719148844'
       and target.locale = 'en-SG'
       and target.currency = 'SGD'
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'reason', 'credential_target_mismatch',
      'reused', true
    );
  end if;

  if exists (
    select 1 from sellerpilot_private.product_listings listing
     where listing.channel_key = 'shopee'
       and (listing.remote_id = '53717126190'
         or listing.marketplace_sku = 'QA-20260823-CC-001')
       and (listing.product_id <> p_product_id
         or listing.owner_id <> v_product.owner_id
         or listing.market <> 'SG'
         or listing.target_id <> '1719148844')
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'reason', 'remote_identity_conflict',
      'reused', true
    );
  end if;

  select listing.* into v_listing
    from sellerpilot_private.product_listings listing
   where listing.owner_id = v_product.owner_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'shopee'
     and listing.market = 'SG'
     and listing.target_id = '1719148844'
   for update;
  if found then
    v_listing_id := v_listing.id;
    if v_listing.remote_id is distinct from '53717126190'
       or v_listing.marketplace_sku is distinct from 'QA-20260823-CC-001'
       or v_listing.status <> 'paused'
       or v_listing.requested_publication_intent <> 'safe_test'
       or v_listing.seller_account_key is not null and not exists (
         select 1
           from sellerpilot_private.shopee_existing_adoption_attestations attestation
          where attestation.listing_id = v_listing.id
            and attestation.seller_account_key = v_listing.seller_account_key
       ) then
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing.id,
        'reason', 'listing_snapshot_conflict', 'reused', true
      );
    end if;
    if v_listing.seller_account_key is not null then
      if v_listing.seller_account_key = v_credential.seller_account_key
         and v_listing.remote_visibility = 'non_public'
         and v_listing.provider_status = 'UNLIST'
         and v_listing.currency = 'SGD'
         and v_listing.price > 0
         and v_listing.last_verified_at is not null
         and exists (
           select 1
             from sellerpilot_private.provider_listing_lineage_attestations lineage
            where lineage.listing_id = v_listing.id
              and lineage.credential_id = p_credential_id
              and lineage.seller_account_key = v_credential.seller_account_key
         ) then
        return jsonb_build_object(
          'status', 'already_bound', 'listing_id', v_listing.id,
          'reused', true
        );
      end if;
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing.id,
        'reason', 'listing_lineage_conflict', 'reused', true
      );
    end if;
  else
    v_listing_id := gen_random_uuid();
    insert into sellerpilot_private.product_listings (
      id, owner_id, product_id, channel_key, remote_id, marketplace_sku,
      market, target_id, status, currency, price, requested_publication_intent,
      remote_visibility, provider_status, remote_resources, seller_account_key,
      published_at, last_verified_at, last_error, failure_class, updated_at
    ) values (
      v_listing_id, v_product.owner_id, p_product_id, 'shopee',
      '53717126190', 'QA-20260823-CC-001', 'SG', '1719148844',
      'paused', 'SGD', 0, 'safe_test', 'unknown', null, '{}'::jsonb,
      null, null, null, null, null, now()
    );
  end if;

  select job.id, job.status, job.credential_id, job.seller_account_key,
         job.request_payload
    into v_existing_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = v_listing_id
     and job.operation = 'listing.lineage.verify'
     and job.status in ('queued', 'running', 'reconciliation_required')
   order by job.created_at, job.id
   for update
   limit 1;
  if found then
    if v_existing_job.status = 'reconciliation_required'
       or v_existing_job.credential_id is distinct from p_credential_id
       or v_existing_job.seller_account_key is distinct from
            v_credential.seller_account_key
       or v_existing_job.request_payload#>>'{arguments,sellerpilotShopeeSgExistingAdoption,contract}'
            <> 'sellerpilot_shopee_sg_existing_adoption_v1' then
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing_id,
        'job_id', v_existing_job.id, 'reason', 'verification_job_conflict',
        'reused', true
      );
    end if;
    return jsonb_build_object(
      'status', v_existing_job.status, 'listing_id', v_listing_id,
      'job_id', v_existing_job.id, 'reused', true
    );
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = v_listing_id
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update'
       )
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing_id,
      'reason', 'active_listing_write', 'reused', true
    );
  end if;

  v_arguments := jsonb_build_object(
    'expectedRemoteId', '53717126190',
    'market', 'SG',
    'targetId', '1719148844',
    'shopId', '1719148844',
    'sellerpilotShopeeSgExistingAdoption', jsonb_build_object(
      'contract', 'sellerpilot_shopee_sg_existing_adoption_v1',
      'productId', p_product_id,
      'itemId', '53717126190',
      'sku', 'QA-20260823-CC-001',
      'merchantId', '5511564',
      'shopId', '1719148844',
      'market', 'SG',
      'locale', 'en-SG',
      'currency', 'SGD',
      'providerStatus', 'UNLIST',
      'detailImageCount', 8
    )
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key, created_by,
    created_at, updated_at
  ) values (
    v_job_id, p_credential_id, null, v_listing_id, 'shopee',
    'listing.lineage.verify', 'production', jsonb_build_object(
      'sellerpilotLineageVersion', 'provider_listing_readback_v1',
      'arguments', v_arguments
    ), 'queued', v_credential.seller_account_key, v_product.owner_id,
    now(), now()
  );
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_product.owner_id, 'shopee_existing_adoption_queued',
    'product_listing', v_listing_id::text, jsonb_build_object(
      'market', 'SG', 'remote_id', '53717126190',
      'shop_id', '1719148844', 'gateway_job_id', v_job_id,
      'evidence', 'sellerpilot_shopee_sg_existing_adoption_v1'
    )
  );
  return jsonb_build_object(
    'status', 'queued', 'listing_id', v_listing_id,
    'job_id', v_job_id, 'reused', false
  );
exception when unique_violation then
  return jsonb_build_object(
    'status', 'manual_required', 'listing_id', v_listing_id,
    'reason', 'concurrent_adoption_conflict', 'reused', true
  );
end;
$$;

create function public.sellerpilot_service_get_shopee_sg_existing_adoption_status(
  p_actor_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listing sellerpilot_private.product_listings%rowtype;
  v_job record;
begin
  if p_actor_id is null or not exists (
    select 1 from sellerpilot_private.admin_users admin_user
     where admin_user.user_id = p_actor_id
  ) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_product_id is distinct from
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid then
    return jsonb_build_object(
      'status', 'manual_required', 'reason', 'product_identity_mismatch'
    );
  end if;
  select listing.* into v_listing
    from sellerpilot_private.product_listings listing
   where listing.product_id = p_product_id
     and listing.channel_key = 'shopee'
     and listing.market = 'SG'
     and listing.target_id = '1719148844';
  if not found then return jsonb_build_object('status', 'not_started'); end if;
  if v_listing.remote_id <> '53717126190'
     or v_listing.marketplace_sku <> 'QA-20260823-CC-001' then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'reason', 'listing_snapshot_conflict'
    );
  end if;
  if v_listing.seller_account_key is not null
     and v_listing.status = 'paused'
     and v_listing.requested_publication_intent = 'safe_test'
     and v_listing.remote_visibility = 'non_public'
     and v_listing.provider_status = 'UNLIST'
     and v_listing.currency = 'SGD'
     and v_listing.price > 0
     and v_listing.last_verified_at is not null
     and exists (
       select 1
         from sellerpilot_private.shopee_existing_adoption_attestations adoption
         join sellerpilot_private.provider_listing_lineage_attestations lineage
           on lineage.listing_id = adoption.listing_id
          and lineage.gateway_job_id = adoption.gateway_job_id
          and lineage.credential_id = adoption.credential_id
          and lineage.seller_account_key = adoption.seller_account_key
        where adoption.listing_id = v_listing.id
          and adoption.seller_account_key = v_listing.seller_account_key
     ) then
    return jsonb_build_object(
      'status', 'already_bound', 'listing_id', v_listing.id
    );
  end if;
  select job.id, job.status into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = v_listing.id
     and job.operation = 'listing.lineage.verify'
   order by job.created_at desc, job.id desc
   limit 1;
  if found and v_job.status in ('queued', 'running') then
    return jsonb_build_object(
      'status', v_job.status, 'listing_id', v_listing.id,
      'job_id', v_job.id
    );
  end if;
  return jsonb_build_object(
    'status', 'manual_required', 'listing_id', v_listing.id,
    'job_id', case when found then v_job.id else null end,
    'reason', case when found then 'verification_not_bound'
      else 'listing_not_attested' end
  ) - case when found then array[]::text[] else array['job_id'] end;
end;
$$;

alter function public.sellerpilot_complete_listing_lineage_verification(
  text, uuid, uuid, text, jsonb, text
) rename to sellerpilot_09011715_complete_lineage_before_shopee_adoption;

revoke all on function
  public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(
    text, uuid, uuid, text, jsonb, text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_listing_lineage_verification(
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
  v_job record;
  v_marker jsonb;
  v_adoption jsonb;
  v_result jsonb;
  v_verified_at timestamptz;
  v_evidence_digest text;
  v_existing record;
begin
  select job.listing_id, job.credential_id, job.channel, job.environment,
         job.request_payload, job.seller_account_key
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  v_marker := v_job.request_payload
    #>'{arguments,sellerpilotShopeeSgExistingAdoption}';
  v_adoption := p_response_payload->'shopeeAdoption';

  if v_marker is null and v_adoption is not null then
    raise exception 'unexpected Shopee adoption evidence';
  end if;
  if v_marker is not null then
    if v_job.channel <> 'shopee'
       or v_job.environment <> 'production'
       or jsonb_typeof(v_marker) <> 'object'
       or (v_marker - array[
         'contract','productId','itemId','sku','merchantId','shopId','market',
         'locale','currency','providerStatus','detailImageCount'
       ]) <> '{}'::jsonb
       or v_marker->>'contract' <> 'sellerpilot_shopee_sg_existing_adoption_v1'
       or v_marker->>'productId' <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'
       or v_marker->>'itemId' <> '53717126190'
       or v_marker->>'sku' <> 'QA-20260823-CC-001'
       or v_marker->>'merchantId' <> '5511564'
       or v_marker->>'shopId' <> '1719148844'
       or v_marker->>'market' <> 'SG'
       or v_marker->>'locale' <> 'en-SG'
       or v_marker->>'currency' <> 'SGD'
       or v_marker->>'providerStatus' <> 'UNLIST'
       or v_marker->>'detailImageCount' <> '8'
       or not sellerpilot_private.shopee_sg_existing_adoption_credential_allowed(
         v_job.credential_id
       ) then
      raise exception 'Shopee adoption request snapshot mismatch';
    end if;
    if p_status = 'succeeded' and (
      p_response_payload is null
      or jsonb_typeof(v_adoption) <> 'object'
      or (v_adoption - array[
        'contract','itemId','sku','merchantId','shopId','market','locale',
        'currency','price','providerStatus','galleryImageCount',
        'detailImageCount','representativeImageVerified',
        'titleLanguageVerified','descriptionLanguageVerified',
        'titleDigest','descriptionDigest'
      ]) <> '{}'::jsonb
      or v_adoption->>'contract'
           <> 'sellerpilot_shopee_sg_existing_adoption_readback_v1'
      or v_adoption->>'itemId' <> '53717126190'
      or v_adoption->>'sku' <> 'QA-20260823-CC-001'
      or v_adoption->>'merchantId' <> '5511564'
      or v_adoption->>'shopId' <> '1719148844'
      or v_adoption->>'market' <> 'SG'
      or v_adoption->>'locale' <> 'en-SG'
      or v_adoption->>'currency' <> 'SGD'
      or v_adoption->>'providerStatus' <> 'UNLIST'
      or coalesce((v_adoption->>'price')::numeric, 0) <= 0
      or coalesce((v_adoption->>'galleryImageCount')::integer, 0)
           not between 1 and 9
      or v_adoption->>'detailImageCount' <> '8'
      or coalesce((v_adoption->>'representativeImageVerified')::boolean, false)
           is not true
      or coalesce((v_adoption->>'titleLanguageVerified')::boolean, false)
           is not true
      or coalesce((v_adoption->>'descriptionLanguageVerified')::boolean, false)
           is not true
      or coalesce(v_adoption->>'titleDigest', '') !~ '^[a-f0-9]{64}$'
      or coalesce(v_adoption->>'descriptionDigest', '') !~ '^[a-f0-9]{64}$'
    ) then
      raise exception 'Shopee adoption provider evidence mismatch';
    end if;
  end if;

  v_result := public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(
    p_token_hash, p_job_id, p_claim_token, p_status,
    case when v_marker is not null and p_response_payload is not null
      then p_response_payload - 'shopeeAdoption'
      else p_response_payload end,
    p_error_message
  );
  if v_marker is null or p_status <> 'succeeded'
     or v_result->>'status' <> 'bound' then
    return v_result;
  end if;

  select attestation.evidence_digest, attestation.listing_id
    into v_existing
    from sellerpilot_private.shopee_existing_adoption_attestations attestation
   where attestation.gateway_job_id = p_job_id;
  v_evidence_digest := encode(
    extensions.digest((jsonb_build_object(
      'contract', v_adoption->>'contract',
      'listingId', v_job.listing_id,
      'credentialId', v_job.credential_id,
      'gatewayJobId', p_job_id,
      'sellerAccountKey', v_job.seller_account_key,
      'itemId', v_adoption->>'itemId',
      'sku', v_adoption->>'sku',
      'merchantId', v_adoption->>'merchantId',
      'shopId', v_adoption->>'shopId',
      'market', v_adoption->>'market',
      'locale', v_adoption->>'locale',
      'currency', v_adoption->>'currency',
      'price', (v_adoption->>'price')::numeric,
      'providerStatus', v_adoption->>'providerStatus',
      'galleryImageCount', (v_adoption->>'galleryImageCount')::integer,
      'detailImageCount', 8,
      'titleDigest', v_adoption->>'titleDigest',
      'descriptionDigest', v_adoption->>'descriptionDigest'
    ))::text, 'sha256'), 'hex'
  );
  if found then
    if v_existing.evidence_digest is distinct from v_evidence_digest
       or v_existing.listing_id is distinct from v_job.listing_id then
      raise exception 'Shopee adoption completion evidence changed';
    end if;
    return v_result;
  end if;

  v_verified_at := clock_timestamp();
  perform pg_catalog.set_config(
    'sellerpilot.shopee_existing_adoption', p_job_id::text, true
  );
  insert into sellerpilot_private.shopee_existing_adoption_attestations (
    listing_id, product_id, owner_id, credential_id, gateway_job_id,
    seller_account_key, remote_id, marketplace_sku, merchant_id, shop_id,
    market, locale, currency, price, provider_status, gallery_image_count,
    detail_image_count, title_digest, description_digest, evidence_digest,
    verified_at
  ) select
    listing.id, listing.product_id, listing.owner_id, v_job.credential_id,
    p_job_id, listing.seller_account_key, '53717126190',
    'QA-20260823-CC-001', '5511564', '1719148844', 'SG', 'en-SG',
    'SGD', (v_adoption->>'price')::numeric, 'UNLIST',
    (v_adoption->>'galleryImageCount')::integer, 8,
    v_adoption->>'titleDigest', v_adoption->>'descriptionDigest',
    v_evidence_digest, v_verified_at
    from sellerpilot_private.product_listings listing
   where listing.id = v_job.listing_id
     and listing.product_id =
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.channel_key = 'shopee'
     and listing.remote_id = '53717126190'
     and listing.marketplace_sku = 'QA-20260823-CC-001'
     and listing.market = 'SG'
     and listing.target_id = '1719148844'
     and listing.status = 'paused'
     and listing.seller_account_key = v_job.seller_account_key;
  if not found then raise exception 'Shopee adoption listing binding lost'; end if;

  update sellerpilot_private.product_listings listing
     set currency = 'SGD',
         price = (v_adoption->>'price')::numeric,
         requested_publication_intent = 'safe_test',
         remote_visibility = 'non_public',
         provider_status = 'UNLIST',
         remote_resources = jsonb_build_object(
           'resources', jsonb_build_object(
             'localItemId', '53717126190',
             'shopId', '1719148844',
             'merchantId', '5511564',
             'sku', 'QA-20260823-CC-001'
           ),
           'verification', jsonb_build_object(
             'evidenceVersion', 'shopee_existing_adoption_readback_v1',
             'locale', 'en-SG',
             'galleryImageCount',
               (v_adoption->>'galleryImageCount')::integer,
             'detailImageCount', 8,
             'titleDigest', v_adoption->>'titleDigest',
             'descriptionDigest', v_adoption->>'descriptionDigest'
           )
         ),
         published_at = null,
         last_verified_at = v_verified_at,
         last_error = null,
         failure_class = null,
         updated_at = v_verified_at
   where listing.id = v_job.listing_id;
  if not found then raise exception 'Shopee adoption projection lost'; end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) select listing.owner_id, 'shopee_existing_adoption_verified',
      'product_listing', listing.id::text, jsonb_build_object(
        'gateway_job_id', p_job_id,
        'remote_id', '53717126190',
        'market', 'SG',
        'provider_status', 'UNLIST',
        'detail_image_count', 8,
        'evidence_digest', v_evidence_digest
      )
    from sellerpilot_private.product_listings listing
   where listing.id = v_job.listing_id;
  return v_result;
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_shopee_sg_existing_adoption(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_shopee_sg_existing_adoption(uuid,uuid,uuid)
  to service_role;
revoke all on function
  public.sellerpilot_service_get_shopee_sg_existing_adoption_status(uuid,uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_shopee_sg_existing_adoption_status(uuid,uuid)
  to service_role;
revoke all on function
  public.sellerpilot_complete_listing_lineage_verification(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_complete_listing_lineage_verification(
    text,uuid,uuid,text,jsonb,text
  ) to service_role;

comment on function
  public.sellerpilot_service_enqueue_shopee_sg_existing_adoption(uuid,uuid,uuid)
is 'Creates only an account-scoped readback job for Shopee SG item 53717126190; it never creates or updates a remote item.';

commit;
