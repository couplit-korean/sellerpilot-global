-- The exact Lazada MY ledger predates the verified target cache and therefore
-- has an empty target_id. A fresh seller OAuth + /seller/get sync can prove one
-- provider-certified MY target, but the 173000 adoption contract required the
-- listing to contain that target before the readback job could be queued.
--
-- Derive the target only from one current certified credential/target pair,
-- then retain it on the listing only when the existing claim-bound seller/get
-- plus item/SKU readback completion returns `bound`. Provider failures and
-- retries restore the empty ledger value in the same transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917390001);

create or replace function sellerpilot_private.exact_lazada_live_adoption_allowed(
  p_listing_id uuid,
  p_channel text,
  p_request_payload jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_channel = 'lazada'
    and coalesce(p_request_payload->>'sellerpilotExactLazadaLiveAdoption', '')
          = 'exact_lazada_live_adoption_v1'
    and p_request_payload->>'sellerpilotLineageVersion'
          = 'provider_listing_readback_v1'
    and p_request_payload#>>'{arguments,expectedRemoteId}' = '14976038919'
    and upper(p_request_payload#>>'{arguments,market}') = 'MY'
    and lower(p_request_payload#>>'{arguments,country}') = 'my'
    and p_request_payload#>>'{arguments,marketplaceSku}'
          = 'QA-20260823-CC-001-MY'
    and p_request_payload#>>'{arguments,targetId}' ~ '^\d+$'
    and exists (
      select 1
        from sellerpilot_private.product_listings listing
        join sellerpilot_private.products product
          on product.id = listing.product_id
         and product.owner_id = listing.owner_id
       where listing.id = p_listing_id
         and listing.id = '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
         and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and listing.channel_key = 'lazada'
         and listing.status = 'failed'
         and listing.failure_class = 'external_action'
         and listing.requested_publication_intent = 'live'
         and listing.remote_id = '14976038919'
         and upper(trim(listing.market)) = 'MY'
         and (
           trim(listing.target_id) = ''
           or trim(listing.target_id)
                = p_request_payload#>>'{arguments,targetId}'
         )
         and listing.remote_visibility = 'unknown'
         and listing.provider_status is null
         and listing.published_at is null
         and listing.seller_account_key is null
         and product.sku = 'QA-20260823-CC-001'
    );
$$;

revoke all on function
  sellerpilot_private.exact_lazada_live_adoption_allowed(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_prepare_exact_lazada_live_adoption(
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
  v_credential_ids uuid[];
  v_target_ids text[];
  v_credential_id uuid;
  v_target_id text;
begin
  select listing.id, listing.owner_id, listing.product_id,
         listing.channel_key, listing.status, listing.failure_class,
         listing.requested_publication_intent, listing.remote_id,
         listing.market, listing.target_id, listing.remote_visibility,
         listing.provider_status, listing.published_at,
         listing.seller_account_key, product.sku
    into v_listing
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
   where listing.id = p_listing_id;

  if not found
     or v_listing.id <> '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
     or v_listing.product_id <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     or v_listing.channel_key <> 'lazada'
     or v_listing.remote_id <> '14976038919'
     or upper(trim(v_listing.market)) <> 'MY'
     or (
       trim(v_listing.target_id) <> ''
       and trim(v_listing.target_id) !~ '^\d+$'
     )
     or v_listing.sku <> 'QA-20260823-CC-001' then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'exact_lazada_identity_mismatch'
    );
  end if;

  if v_listing.seller_account_key is not null then
    return jsonb_build_object(
      'status', 'already_bound', 'listing_id', v_listing.id,
      'channel', 'lazada', 'market', 'MY'
    );
  end if;

  if v_listing.status <> 'failed'
     or v_listing.failure_class <> 'external_action'
     or v_listing.requested_publication_intent <> 'live'
     or v_listing.remote_visibility <> 'unknown'
     or v_listing.provider_status is not null
     or v_listing.published_at is not null then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', 'lazada', 'market', 'MY',
      'reason', 'exact_lazada_state_mismatch'
    );
  end if;

  if exists (
    select 1
      from sellerpilot_private.provider_listing_lineage_attestations attestation
     where attestation.listing_id = v_listing.id
  ) or exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = v_listing.id
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update'
       )
  ) or exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.listing_id = v_listing.id
       and job.operation = 'listing.lineage.verify'
       and job.status = 'reconciliation_required'
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', 'lazada', 'market', 'MY',
      'reason', 'exact_lazada_active_job_or_attestation'
    );
  end if;

  select array_agg(credential.id order by credential.id, target.target_id),
         array_agg(target.target_id order by credential.id, target.target_id)
    into v_credential_ids, v_target_ids
    from sellerpilot_private.channel_credentials credential
    join sellerpilot_private.channel_market_targets target
      on target.owner_id = v_listing.owner_id
     and target.credential_id = credential.id
     and target.channel = 'lazada'
     and target.environment = 'production'
     and target.market_code = 'MY'
     and target.target_id ~ '^\d+$'
     and target.locale = 'ms-MY'
     and target.currency = 'MYR'
     and lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
   where credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.created_by = v_listing.owner_id
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and exists (
       select 1
         from sellerpilot_private.admin_users admin_user
        where admin_user.user_id = credential.created_by
     );

  if coalesce(cardinality(v_credential_ids), 0) <> 1
     or coalesce(cardinality(v_target_ids), 0) <> 1 then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', 'lazada', 'market', 'MY',
      'reason', 'fresh_exact_lazada_credential_target_required'
    );
  end if;
  v_credential_id := v_credential_ids[1];
  v_target_id := v_target_ids[1];

  if trim(v_listing.target_id) <> ''
     and trim(v_listing.target_id) is distinct from v_target_id then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', 'lazada', 'market', 'MY',
      'reason', 'exact_lazada_identity_mismatch'
    );
  end if;

  return jsonb_build_object(
    'status', 'ready', 'listing_id', v_listing.id,
    'credential_id', v_credential_id,
    'channel', 'lazada', 'market', 'MY',
    'target_id', v_target_id
  );
end;
$$;

create or replace function public.sellerpilot_service_enqueue_exact_lazada_live_adoption(
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
  v_target_id text;
  v_unique_pair_count integer;
  v_temporarily_bound_target boolean := false;
  v_job_id uuid := gen_random_uuid();
  v_request jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 149760389);

  v_context := public.sellerpilot_service_prepare_exact_lazada_live_adoption(
    p_listing_id
  );
  if v_context->>'status' <> 'ready' then
    return v_context || jsonb_build_object('reused', true);
  end if;
  if p_credential_id is null
     or (v_context->>'credential_id')::uuid is distinct from p_credential_id then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'credential_snapshot_changed', 'reused', true
    );
  end if;
  v_target_id := v_context->>'target_id';

  select listing.id, listing.owner_id, listing.channel_key,
         listing.remote_id, listing.market, listing.target_id,
         listing.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id
   for update;
  if not found then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'exact_lazada_snapshot_changed', 'reused', true
    );
  end if;

  select credential.id, credential.created_by, credential.channel,
         credential.environment, credential.status,
         credential.expires_at, credential.seller_account_key,
         credential.seller_account_key_source,
         credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
   for update;
  if not found
     or v_listing.seller_account_key is not null
     or v_credential.created_by is distinct from v_listing.owner_id
     or v_credential.channel <> 'lazada'
     or v_credential.status <> 'active'
     or v_credential.environment <> 'production'
     or (v_credential.expires_at is not null
       and v_credential.expires_at <= clock_timestamp())
     or v_credential.seller_account_key is null
     or v_credential.seller_account_key !~ '^[a-f0-9]{64}$'
     or v_credential.seller_account_key_source <> 'provider_certified_v1'
     or v_credential.seller_account_verified_at is null then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'credential_snapshot_changed', 'reused', true
    );
  end if;

  select count(*)::integer
    into v_unique_pair_count
    from sellerpilot_private.channel_credentials credential
    join sellerpilot_private.channel_market_targets target
      on target.owner_id = v_listing.owner_id
     and target.credential_id = credential.id
     and target.channel = 'lazada'
     and target.environment = 'production'
     and target.market_code = 'MY'
     and target.target_id ~ '^\d+$'
     and target.locale = 'ms-MY'
     and target.currency = 'MYR'
     and lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
   where credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.created_by = v_listing.owner_id
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if v_unique_pair_count <> 1 or not exists (
    select 1
      from sellerpilot_private.channel_market_targets target
     where target.owner_id = v_listing.owner_id
       and target.credential_id = p_credential_id
       and target.channel = 'lazada'
       and target.environment = 'production'
       and target.market_code = 'MY'
       and target.target_id = v_target_id
       and target.locale = 'ms-MY'
       and target.currency = 'MYR'
       and lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', p_listing_id,
      'reason', 'credential_snapshot_changed', 'reused', true
    );
  end if;

  select job.id, job.status, job.credential_id, job.seller_account_key
    into v_existing
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = v_listing.id
     and job.operation = 'listing.lineage.verify'
     and job.status in ('queued', 'running', 'reconciliation_required')
   order by job.created_at, job.id
   for update
   limit 1;
  if found then
    if v_existing.status = 'reconciliation_required'
       or v_existing.credential_id is distinct from p_credential_id
       or v_existing.seller_account_key
            is distinct from v_credential.seller_account_key then
      return jsonb_build_object(
        'status', 'manual_required', 'job_id', v_existing.id,
        'listing_id', v_listing.id,
        'reason', 'verification_job_conflict', 'reused', true
      );
    end if;
    return jsonb_build_object(
      'status', v_existing.status, 'job_id', v_existing.id,
      'listing_id', v_listing.id, 'reused', true
    );
  end if;

  v_request := jsonb_build_object(
    'sellerpilotLineageVersion', 'provider_listing_readback_v1',
    'sellerpilotExactLazadaLiveAdoption', 'exact_lazada_live_adoption_v1',
    'arguments', jsonb_build_object(
      'expectedRemoteId', '14976038919',
      'market', 'MY',
      'targetId', v_target_id,
      'country', 'my',
      'marketplaceSku', 'QA-20260823-CC-001-MY'
    )
  );
  if not sellerpilot_private.exact_lazada_live_adoption_allowed(
    v_listing.id, 'lazada', v_request
  ) then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'reason', 'exact_lazada_snapshot_changed', 'reused', true
    );
  end if;

  -- The immutable gateway insert guard compares the request target with the
  -- listing target. Supply the certified target only for that trigger check,
  -- then restore the legacy blank value before this transaction can commit.
  if trim(v_listing.target_id) = '' then
    update sellerpilot_private.product_listings listing
       set target_id = v_target_id
     where listing.id = v_listing.id
       and trim(listing.target_id) = ''
       and listing.seller_account_key is null;
    if not found then
      raise exception 'exact Lazada enqueue target bind race'
        using errcode = '55000';
    end if;
    v_temporarily_bound_target := true;
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key, created_by,
    created_at, updated_at
  ) values (
    v_job_id, p_credential_id, null, v_listing.id, 'lazada',
    'listing.lineage.verify', 'production', v_request, 'queued',
    v_credential.seller_account_key, v_listing.owner_id, now(), now()
  );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id, 'exact_lazada_live_adoption_queued',
    'product_listing', v_listing.id::text,
    jsonb_build_object(
      'channel', 'lazada', 'market', 'MY',
      'remote_id', '14976038919',
      'evidence', 'seller_get_then_exact_item_readback_v1'
    )
  );

  if v_temporarily_bound_target then
    update sellerpilot_private.product_listings listing
       set target_id = ''
     where listing.id = v_listing.id
       and listing.target_id = v_target_id
       and listing.seller_account_key is null;
    if not found then
      raise exception 'exact Lazada enqueue target rollback lost'
        using errcode = '55000';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'queued', 'job_id', v_job_id,
    'listing_id', v_listing.id, 'reused', false
  );
exception when unique_violation then
  select job.id, job.status
    into v_existing
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = p_listing_id
     and job.operation = 'listing.lineage.verify'
     and job.status in ('queued', 'running', 'reconciliation_required')
   order by job.created_at, job.id
   limit 1;
  if found and v_existing.status <> 'reconciliation_required' then
    return jsonb_build_object(
      'status', v_existing.status, 'job_id', v_existing.id,
      'listing_id', p_listing_id, 'reused', true
    );
  end if;
  raise;
end;
$$;

do $verify_lineage_completion_preimage$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure;
  v_owner text;
  v_language text;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
  v_source text;
begin
  select pg_catalog.pg_get_userbyid(proc.proowner), language.lanname,
         proc.provolatile, proc.prosecdef, proc.proconfig, proc.prosrc
    into v_owner, v_language, v_volatility, v_security_definer,
         v_config, v_source
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_language language on language.oid = proc.prolang
   where proc.oid = v_signature;
  if v_owner is distinct from 'postgres'
     or v_language is distinct from 'plpgsql'
     or v_volatility is distinct from 'v'
     or v_security_definer is distinct from true
     or v_config is distinct from array['search_path=""']::text[]
     or pg_catalog.strpos(
          v_source,
          'sellerpilot_09011715_complete_lineage_before_shopee_adoption'
        ) = 0
     or pg_catalog.strpos(v_source, 'sellerpilotShopeeSgExistingAdoption') = 0
     or not pg_catalog.has_function_privilege(
          'service_role', v_signature, 'EXECUTE'
        )
     or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
          'authenticated', v_signature, 'EXECUTE'
        ) then
    raise exception 'listing lineage completion preimage invalid'
      using errcode = '55000';
  end if;
end;
$verify_lineage_completion_preimage$;

alter function public.sellerpilot_complete_listing_lineage_verification(
  text, uuid, uuid, text, jsonb, text
) rename to sellerpilot_09011739_complete_lineage_pre_lazada_target;

revoke all on function
  public.sellerpilot_09011739_complete_lineage_pre_lazada_target(
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
  v_listing record;
  v_marker_present boolean := false;
  v_target_id text;
  v_pair_count integer;
  v_temporarily_bound_target boolean := false;
  v_result jsonb;
begin
  select job.id, job.listing_id, job.credential_id, job.channel,
         job.environment, job.operation, job.request_payload,
         job.seller_account_key, job.created_by
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if found then
    v_marker_present := v_job.request_payload
      ? 'sellerpilotExactLazadaLiveAdoption';
  end if;

  -- A completed claim is already immutable in the predecessor attestation
  -- ledger. Let it perform its normal idempotency and claim-token checks.
  if v_marker_present and exists (
    select 1
      from sellerpilot_private.provider_listing_lineage_attestations attestation
     where attestation.gateway_job_id = p_job_id
  ) then
    return public.sellerpilot_09011739_complete_lineage_pre_lazada_target(
      p_token_hash, p_job_id, p_claim_token, p_status,
      p_response_payload, p_error_message
    );
  end if;

  if v_marker_present then
    v_target_id := v_job.request_payload#>>'{arguments,targetId}';
    select listing.id, listing.owner_id, listing.product_id,
           listing.channel_key, listing.remote_id, listing.status,
           listing.failure_class, listing.requested_publication_intent,
           listing.market, listing.target_id, listing.marketplace_sku,
           listing.remote_visibility, listing.provider_status,
           listing.published_at, listing.seller_account_key,
           product.sku
      into v_listing
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product
        on product.id = listing.product_id
       and product.owner_id = listing.owner_id
     where listing.id = v_job.listing_id
     for update of listing;

    if not found
       or v_job.channel <> 'lazada'
       or v_job.environment <> 'production'
       or v_job.operation <> 'listing.lineage.verify'
       or v_job.request_payload->>'sellerpilotExactLazadaLiveAdoption'
            <> 'exact_lazada_live_adoption_v1'
       or v_job.request_payload->>'sellerpilotLineageVersion'
            <> 'provider_listing_readback_v1'
       or v_job.request_payload#>>'{arguments,expectedRemoteId}'
            <> '14976038919'
       or v_job.request_payload#>>'{arguments,market}' <> 'MY'
       or v_job.request_payload#>>'{arguments,country}' <> 'my'
       or v_job.request_payload#>>'{arguments,marketplaceSku}'
            <> 'QA-20260823-CC-001-MY'
       or v_target_id !~ '^\d+$'
       or v_listing.id <> '42021335-9793-4834-8cd5-b73169fd1f48'::uuid
       or v_listing.product_id
            <> 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       or v_listing.channel_key <> 'lazada'
       or v_listing.remote_id <> '14976038919'
       or v_listing.status <> 'failed'
       or v_listing.failure_class <> 'external_action'
       or v_listing.requested_publication_intent <> 'live'
       or upper(trim(v_listing.market)) <> 'MY'
       or trim(v_listing.target_id) not in ('', v_target_id)
       or v_listing.marketplace_sku is not null
       or v_listing.remote_visibility <> 'unknown'
       or v_listing.provider_status is not null
       or v_listing.published_at is not null
       or v_listing.seller_account_key is not null
       or v_listing.sku <> 'QA-20260823-CC-001'
       or v_job.created_by is distinct from v_listing.owner_id then
      raise exception 'exact Lazada blank-target completion snapshot mismatch'
        using errcode = '55000';
    end if;

    select count(*)::integer
      into v_pair_count
      from sellerpilot_private.channel_credentials credential
      join sellerpilot_private.channel_market_targets target
        on target.owner_id = v_listing.owner_id
       and target.credential_id = credential.id
       and target.channel = 'lazada'
       and target.environment = 'production'
       and target.market_code = 'MY'
       and target.target_id ~ '^\d+$'
       and target.locale = 'ms-MY'
       and target.currency = 'MYR'
       and lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
     where credential.created_by = v_listing.owner_id
       and credential.channel = 'lazada'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null;
    if v_pair_count <> 1 or not exists (
      select 1
        from sellerpilot_private.channel_credentials credential
        join sellerpilot_private.channel_market_targets target
          on target.owner_id = v_listing.owner_id
         and target.credential_id = credential.id
         and target.channel = 'lazada'
         and target.environment = 'production'
         and target.market_code = 'MY'
         and target.target_id = v_target_id
         and target.locale = 'ms-MY'
         and target.currency = 'MYR'
         and lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
       where credential.id = v_job.credential_id
         and credential.created_by = v_listing.owner_id
         and credential.channel = 'lazada'
         and credential.environment = 'production'
         and credential.status = 'active'
         and (credential.expires_at is null
           or credential.expires_at > clock_timestamp())
         and credential.seller_account_key = v_job.seller_account_key
         and credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
    ) then
      raise exception 'exact Lazada certified credential target lost'
        using errcode = '55000';
    end if;

    if trim(v_listing.target_id) = '' then
      update sellerpilot_private.product_listings listing
         set target_id = v_target_id
       where listing.id = v_listing.id
         and trim(listing.target_id) = ''
         and listing.seller_account_key is null;
      if not found then
        raise exception 'exact Lazada target bind race'
          using errcode = '55000';
      end if;
      v_temporarily_bound_target := true;
    end if;
  end if;

  v_result := public.sellerpilot_09011739_complete_lineage_pre_lazada_target(
    p_token_hash, p_job_id, p_claim_token, p_status,
    p_response_payload, p_error_message
  );

  if v_temporarily_bound_target
     and not (
       p_status = 'succeeded'
       and v_result->>'status' = 'bound'
     ) then
    update sellerpilot_private.product_listings listing
       set target_id = ''
     where listing.id = v_listing.id
       and listing.target_id = v_target_id
       and listing.seller_account_key is null;
    if not found then
      raise exception 'exact Lazada unverified target rollback lost'
        using errcode = '55000';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function
  public.sellerpilot_service_prepare_exact_lazada_live_adoption(uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_prepare_exact_lazada_live_adoption(uuid)
  to service_role;

revoke all on function
  public.sellerpilot_service_enqueue_exact_lazada_live_adoption(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_exact_lazada_live_adoption(uuid, uuid)
  to service_role;

revoke all on function
  public.sellerpilot_complete_listing_lineage_verification(
    text, uuid, uuid, text, jsonb, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_complete_listing_lineage_verification(
    text, uuid, uuid, text, jsonb, text
  ) to service_role;

comment on function
  public.sellerpilot_service_prepare_exact_lazada_live_adoption(uuid)
is 'Derives one exact Lazada MY target only from a fresh provider-certified credential and seller/get target cache; performs no provider write.';
comment on function
  public.sellerpilot_service_enqueue_exact_lazada_live_adoption(uuid,uuid)
is 'Queues one exact read-only Lazada seller/get plus item/SKU readback even when the legacy listing target is blank.';
comment on function
  public.sellerpilot_complete_listing_lineage_verification(
    text,uuid,uuid,text,jsonb,text
  ) is 'Completes provider lineage with exact Shopee, Lazada and blank-Lazada-target gates; an inferred Lazada target persists only after bound provider readback.';
comment on function
  sellerpilot_private.exact_lazada_live_adoption_allowed(uuid,text,jsonb)
is 'Private exact predicate allowing the one Lazada MY adoption snapshot before or during its transaction-local verified target binding.';

notify pgrst, 'reload schema';

commit;
