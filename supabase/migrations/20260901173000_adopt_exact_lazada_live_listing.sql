begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- This predicate admits exactly one failed Lazada MY ledger into the existing
-- read-only lineage completion path. It never changes publication state and
-- requires the server-owned request marker plus every immutable remote key.
create function sellerpilot_private.exact_lazada_live_adoption_allowed(
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
         and trim(listing.target_id) = p_request_payload#>>'{arguments,targetId}'
         and trim(listing.target_id) ~ '^\d+$'
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

create function public.sellerpilot_service_prepare_exact_lazada_live_adoption(
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
  v_credential_id uuid;
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
     or trim(v_listing.target_id) !~ '^\d+$'
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

  select array_agg(credential.id order by credential.id)
    into v_credential_ids
    from sellerpilot_private.channel_credentials credential
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
     )
     and exists (
       select 1
         from sellerpilot_private.channel_market_targets target
        where target.owner_id = v_listing.owner_id
          and target.credential_id = credential.id
          and target.channel = 'lazada'
          and target.environment = 'production'
          and target.market_code = 'MY'
          and target.target_id = trim(v_listing.target_id)
          and target.locale = 'ms-MY'
          and target.currency = 'MYR'
          and lower(trim(target.remote_status)) in ('active', 'live', 'enabled')
     );

  if coalesce(cardinality(v_credential_ids), 0) <> 1 then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', 'lazada', 'market', 'MY',
      'reason', 'fresh_exact_lazada_credential_target_required'
    );
  end if;
  v_credential_id := v_credential_ids[1];

  return jsonb_build_object(
    'status', 'ready', 'listing_id', v_listing.id,
    'credential_id', v_credential_id,
    'channel', 'lazada', 'market', 'MY',
    'target_id', trim(v_listing.target_id)
  );
end;
$$;

create function public.sellerpilot_service_enqueue_exact_lazada_live_adoption(
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

  select listing.id, listing.owner_id, listing.channel_key,
         listing.remote_id, listing.market, listing.target_id,
         listing.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id
   for update;
  select credential.id, credential.environment, credential.status,
         credential.expires_at, credential.seller_account_key,
         credential.seller_account_key_source,
         credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
   for update;

  if not found
     or v_listing.seller_account_key is not null
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
      'targetId', trim(v_listing.target_id),
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

-- Extend the existing completion gate without weakening any claim, lease,
-- credential, target-cache, request-snapshot or attestation check.
do $patch_exact_lazada_live_adoption_completion$
declare
  v_definition text;
  v_target regprocedure :=
    'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure;
  v_before text := $before$
         and sellerpilot_private.failed_ebay_lineage_discovery_allowed(
           v_listing.id
         )
       )
     )
     or v_listing.seller_account_key is not null
$before$;
  v_after text := $after$
         and sellerpilot_private.failed_ebay_lineage_discovery_allowed(
           v_listing.id
         )
       )
       and not sellerpilot_private.exact_lazada_live_adoption_allowed(
         v_listing.id,
         v_job.channel,
         v_job.request_payload
       )
     )
     or v_listing.seller_account_key is not null
$after$;
begin
  select pg_catalog.pg_get_functiondef(
    v_target
  ) into v_definition;
  -- A clean replay applies the Shopee 171500 wrapper before this migration,
  -- while production applied this Lazada migration before the pending Shopee
  -- wrapper. Patch the exact predecessor in the former order; the forward
  -- 173100 merger verifies both orders after they converge.
  if pg_catalog.strpos(v_definition, v_before) = 0
     and pg_catalog.strpos(
       v_definition,
       'sellerpilot_09011715_complete_lineage_before_shopee_adoption'
     ) > 0 then
    v_target :=
      'public.sellerpilot_09011715_complete_lineage_before_shopee_adoption(text,uuid,uuid,text,jsonb,text)'::regprocedure;
    select pg_catalog.pg_get_functiondef(v_target) into v_definition;
  end if;
  if pg_catalog.strpos(v_definition, v_after) > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'exact Lazada lineage completion status gate not found';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_exact_lazada_live_adoption_completion$;

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

comment on function public.sellerpilot_service_prepare_exact_lazada_live_adoption(uuid) is
  'Fail-closed preparation for one exact failed Lazada MY live-listing read-only seller and item lineage adoption.';
comment on function public.sellerpilot_service_enqueue_exact_lazada_live_adoption(uuid, uuid) is
  'Queues one exact read-only Lazada MY seller/get plus item/SKU lineage verification; performs no provider write.';
comment on function sellerpilot_private.exact_lazada_live_adoption_allowed(uuid, text, jsonb) is
  'Private exact predicate for the one Lazada MY live-listing adoption request; no role has direct execution.';

commit;
