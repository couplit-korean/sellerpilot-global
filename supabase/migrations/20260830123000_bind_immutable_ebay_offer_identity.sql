begin;

-- eBay has two provider identities for one public listing: Inventory offerId
-- and the public listingId. The latter is already product_listings.remote_id;
-- keep the former as a first-class immutable value instead of relying on the
-- replaceable remote publication evidence envelope.
alter table sellerpilot_private.product_listings
  add column if not exists provider_resource_id text;

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_provider_resource_id_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_provider_resource_id_check check (
    provider_resource_id is null
    or (
      channel_key = 'ebay'
      and length(trim(provider_resource_id)) between 1 and 240
      and provider_resource_id !~ '[[:cntrl:]]'
    )
  );

-- Only immutable, claim-bound lineage attestations are accepted as migration
-- evidence. Mutable historical job payloads and remote_resources are never
-- used to guess an offer identity.
update sellerpilot_private.product_listings listing
   set provider_resource_id = attestation.provider_resource_id
  from sellerpilot_private.provider_listing_lineage_attestations attestation
 where listing.id = attestation.listing_id
   and listing.channel_key = 'ebay'
   and listing.provider_resource_id is null
   and listing.remote_id = attestation.expected_remote_id
   and attestation.expected_remote_id = attestation.verified_remote_id
   and listing.market = attestation.market
   and listing.target_id = attestation.target_id
   and listing.marketplace_sku = attestation.marketplace_sku
   and listing.seller_account_key = attestation.seller_account_key
   and nullif(trim(attestation.provider_resource_id), '') is not null;

create or replace function sellerpilot_private.guard_immutable_ebay_offer_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := nullif(current_setting(
    'sellerpilot.provider_listing_lineage_rebind', true
  ), '');
  v_resources jsonb;
begin
  if old.provider_resource_id is not null
     and (
       new.provider_resource_id is distinct from old.provider_resource_id
       or new.remote_id is distinct from old.remote_id
       or new.market is distinct from old.market
       or new.target_id is distinct from old.target_id
       or new.marketplace_sku is distinct from old.marketplace_sku
     ) then
    raise exception 'immutable ebay listing identity cannot change';
  end if;

  if old.provider_resource_id is null
     and new.provider_resource_id is not null then
    if old.channel_key <> 'ebay'
       or not exists (
         select 1
           from sellerpilot_private.provider_listing_lineage_attestations attestation
           join sellerpilot_private.channel_gateway_jobs job
             on job.id = attestation.gateway_job_id
          where attestation.listing_id = old.id
            and attestation.gateway_job_id::text = v_marker
            and attestation.expected_remote_id = trim(new.remote_id)
            and attestation.verified_remote_id = trim(new.remote_id)
            and attestation.market = new.market
            and attestation.target_id = new.target_id
            and attestation.marketplace_sku = trim(new.marketplace_sku)
            and attestation.provider_resource_id = trim(new.provider_resource_id)
            and job.listing_id = old.id
            and job.channel = 'ebay'
            and job.operation = 'listing.lineage.verify'
            and job.status = 'running'
            and job.claim_token is not null
            and job.lease_expires_at > clock_timestamp()
       ) then
      raise exception 'verified ebay offer identity binding required';
    end if;
  end if;

  if new.channel_key = 'ebay'
     and new.provider_resource_id is not null
     and (
       old.provider_resource_id is null
       or new.remote_resources is distinct from old.remote_resources
     )
     and new.remote_resources <> '{}'::jsonb then
    v_resources := new.remote_resources->'resources';
    if jsonb_typeof(v_resources) <> 'object'
       or v_resources->>'offerId' is distinct from new.provider_resource_id
       or v_resources->>'listingId' is distinct from new.remote_id
       or v_resources->>'sku' is distinct from new.marketplace_sku
       or upper(coalesce(v_resources->>'marketplaceId', ''))
            is distinct from upper(coalesce(new.target_id, '')) then
      raise exception 'verified ebay remote resources must preserve immutable identity';
    end if;
  end if;
  return new;
exception when invalid_text_representation then
  raise exception 'verified ebay offer identity binding required';
end;
$$;

drop trigger if exists guard_immutable_ebay_offer_identity
  on sellerpilot_private.product_listings;
create trigger guard_immutable_ebay_offer_identity
before update on sellerpilot_private.product_listings
for each row execute function
  sellerpilot_private.guard_immutable_ebay_offer_identity();

revoke all on function
  sellerpilot_private.guard_immutable_ebay_offer_identity()
  from public, anon, authenticated, service_role;

-- The legacy SKU guard originally required the SKU to exist before the
-- read-only verifier ran. Permit the ItemID discovery mode only after the same
-- claim-bound job inserted an immutable attestation with the discovered SKU.
create or replace function sellerpilot_private.guard_verified_ebay_listing_sku_recovery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting(
    'sellerpilot.provider_listing_lineage_rebind', true
  );
begin
  if old.channel_key <> 'ebay'
     or old.marketplace_sku is not null
     or new.marketplace_sku is null
     or new.marketplace_sku is not distinct from old.marketplace_sku then
    return new;
  end if;
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id::text = v_marker
       and job.id = (
         nullif(current_setting('sellerpilot.provider_listing_lineage_rebind', true), '')
       )::uuid
       and job.listing_id = old.id
       and job.channel = 'ebay'
       and job.operation = 'listing.lineage.verify'
       and job.status = 'running'
       and job.claim_token is not null
       and job.lease_expires_at > clock_timestamp()
       and (
         nullif(trim(job.request_payload#>>'{arguments,marketplaceSku}'), '')
           = trim(new.marketplace_sku)
         or (
           job.request_payload#>>'{arguments,discoveryMode}'
             = 'ebay_listing_id_v1'
           and exists (
             select 1
               from sellerpilot_private.provider_listing_lineage_attestations attestation
              where attestation.gateway_job_id = job.id
                and attestation.listing_id = old.id
                and attestation.marketplace_sku = trim(new.marketplace_sku)
           )
         )
       )
  ) then
    raise exception 'verified ebay marketplace sku recovery required';
  end if;
  return new;
exception when invalid_text_representation then
  raise exception 'verified ebay marketplace sku recovery required';
end;
$$;

revoke all on function
  sellerpilot_private.guard_verified_ebay_listing_sku_recovery()
  from public, anon, authenticated, service_role;

-- Permit the existing read-only lineage job to discover an eBay SKU from the
-- immutable public listingId instead of forcing a manual guess.
do $patch_ebay_lineage_prepare$
declare
  v_definition text;
  v_before text := $before$
    if v_ebay_sku is null then
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing.id,
        'channel', v_listing.channel_key, 'market', v_listing.market,
        'reason', 'ebay_marketplace_sku_missing'
      );
    end if;
$before$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_prepare_listing_lineage_verification(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'ebay lineage prepare SKU gate not found';
  end if;
  execute pg_catalog.replace(v_definition, v_before, E'\n');
end;
$patch_ebay_lineage_prepare$;

do $patch_ebay_lineage_enqueue$
declare
  v_definition text;
  v_before text := $before$
    if v_ebay_sku is null then
      return jsonb_build_object(
        'status', 'manual_required', 'listing_id', v_listing.id,
        'reason', 'ebay_marketplace_sku_missing', 'reused', true
      );
    end if;
    v_arguments := v_arguments || jsonb_build_object(
      'marketplaceSku', v_ebay_sku
    );
$before$;
  v_after text := $after$
    if v_ebay_sku is null then
      v_arguments := v_arguments || jsonb_build_object(
        'discoveryMode', 'ebay_listing_id_v1'
      );
    else
      v_arguments := v_arguments || jsonb_build_object(
        'marketplaceSku', v_ebay_sku
      );
    end if;
$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_lineage_verification(uuid,uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'ebay lineage enqueue SKU gate not found';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_ebay_lineage_enqueue$;

-- Extend the exact completion atomically: discovery requests accept the SKU
-- only from normalized successful provider evidence, insert the immutable
-- attestation first, and then bind SKU + offerId before binding seller lineage.
do $patch_ebay_lineage_completion$
declare
  v_definition text;
  v_before text;
  v_after text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_definition;

  v_before := '  v_marketplace_sku text;';
  v_after := '  v_marketplace_sku text;' || E'\n' ||
    '  v_ebay_discovery boolean := false;';
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'lineage completion declaration not found';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);

  v_before := $before$
  v_marketplace_sku := nullif(trim(
    v_job.request_payload#>>'{arguments,marketplaceSku}'
  ), '');
$before$;
  v_after := $after$
  v_marketplace_sku := nullif(trim(
    v_job.request_payload#>>'{arguments,marketplaceSku}'
  ), '');
  v_ebay_discovery := v_job.channel = 'ebay'
    and v_job.request_payload#>>'{arguments,discoveryMode}'
          = 'ebay_listing_id_v1'
    and v_marketplace_sku is null;
$after$;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'lineage completion SKU snapshot not found';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);

  v_before := $before$
     or (
       v_job.channel = 'ebay'
       and (
         v_marketplace_sku is null
         or (
           v_listing.marketplace_sku is not null
           and trim(v_listing.marketplace_sku) <> v_marketplace_sku
         )
       )
     ) then
$before$;
  v_after := $after$
     or (
       v_job.channel = 'ebay'
       and not (
         (
           v_ebay_discovery
           and v_listing.marketplace_sku is null
         )
         or (
           not v_ebay_discovery
           and v_marketplace_sku is not null
           and (
             v_listing.marketplace_sku is null
             or trim(v_listing.marketplace_sku) = v_marketplace_sku
           )
         )
       )
     ) then
$after$;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'lineage completion eBay snapshot predicate not found';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);

  v_before := $before$
  if v_job.channel = 'ebay' then
    if nullif(trim(p_response_payload->>'marketplaceSku'), '')
         is distinct from v_marketplace_sku
$before$;
  v_after := $after$
  if v_job.channel = 'ebay' then
    if v_ebay_discovery then
      v_marketplace_sku := nullif(trim(
        p_response_payload->>'marketplaceSku'
      ), '');
    end if;
    if nullif(trim(p_response_payload->>'marketplaceSku'), '')
         is distinct from v_marketplace_sku
$after$;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'lineage completion eBay evidence predicate not found';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);

  v_before := $before$
  if v_job.channel = 'ebay' and v_listing.marketplace_sku is null then
    update sellerpilot_private.product_listings listing
       set marketplace_sku = v_marketplace_sku
     where listing.id = v_listing.id;
  end if;

  insert into sellerpilot_private.provider_listing_lineage_attestations (
$before$;
  v_after := $after$
  insert into sellerpilot_private.provider_listing_lineage_attestations (
$after$;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'lineage completion pre-attestation SKU update not found';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);

  v_before := $before$
  -- The unchanged 11830 product-listing guard rechecks the immutable
  -- attestation through verified_static_listing_lineage_key. Only the seller
  -- key changes in this statement.
$before$;
  v_after := $after$
  if v_job.channel = 'ebay' then
    update sellerpilot_private.product_listings listing
       set marketplace_sku = v_marketplace_sku,
           provider_resource_id = v_verified_resource_id
     where listing.id = v_listing.id
       and (
         listing.marketplace_sku is null
         or trim(listing.marketplace_sku) = v_marketplace_sku
       )
       and (
         listing.provider_resource_id is null
         or trim(listing.provider_resource_id) = v_verified_resource_id
       );
    if not found then
      raise exception 'ebay immutable identity binding lost';
    end if;
  end if;

  -- The unchanged 11830 product-listing guard rechecks the immutable
  -- attestation through verified_static_listing_lineage_key. Only the seller
  -- key changes in this statement.
$after$;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'lineage completion seller binding marker not found';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_before, v_after);

  execute v_definition;
end;
$patch_ebay_lineage_completion$;

-- Server-only identity resolver. UPDATE callers receive one immutable tuple
-- only when listing, credential, attestation, marketplace, and seller lineage
-- all agree. No mutable browser payload is trusted for offerId or SKU.
create or replace function public.sellerpilot_service_get_ebay_listing_update_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity record;
begin
  select listing.remote_id as listing_id,
         listing.marketplace_sku as sku,
         listing.provider_resource_id as offer_id,
         listing.target_id as marketplace_id
    into v_identity
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.provider_listing_lineage_attestations attestation
      on attestation.listing_id = listing.id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = 'ebay'
   where listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'ebay'
     and listing.market = trim(coalesce(p_market, ''))
     and listing.target_id = trim(coalesce(p_target_id, ''))
     and listing.requested_publication_intent = 'live'
     and listing.status in ('published', 'paused', 'failed')
     and nullif(trim(listing.remote_id), '') is not null
     and nullif(trim(listing.marketplace_sku), '') is not null
     and nullif(trim(listing.provider_resource_id), '') is not null
     and upper(listing.target_id) ~ '^EBAY_[A-Z0-9_]+$'
     and listing.seller_account_key is not null
     and credential.environment = attestation.environment
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.seller_account_key = listing.seller_account_key
     and attestation.credential_id = credential.id
     and attestation.channel = 'ebay'
     and attestation.seller_account_key = listing.seller_account_key
     and attestation.expected_remote_id = listing.remote_id
     and attestation.verified_remote_id = listing.remote_id
     and attestation.market = listing.market
     and attestation.target_id = listing.target_id
     and attestation.marketplace_sku = listing.marketplace_sku
     and attestation.provider_resource_id = listing.provider_resource_id
     and (
       listing.remote_resources = '{}'::jsonb
       or (
         jsonb_typeof(listing.remote_resources->'resources') = 'object'
         and listing.remote_resources#>>'{resources,offerId}' = listing.provider_resource_id
         and listing.remote_resources#>>'{resources,listingId}' = listing.remote_id
         and listing.remote_resources#>>'{resources,sku}' = listing.marketplace_sku
         and upper(coalesce(
           listing.remote_resources#>>'{resources,marketplaceId}', ''
         )) = upper(listing.target_id)
       )
     );
  if not found then
    return jsonb_build_object('status', 'identity_unverified');
  end if;
  return jsonb_build_object(
    'status', 'allowed',
    'contract', 'ebay_listing_identity_v1',
    'offerId', v_identity.offer_id,
    'sku', v_identity.sku,
    'listingId', v_identity.listing_id,
    'marketplaceId', upper(v_identity.marketplace_id)
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_ebay_listing_update_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_ebay_listing_update_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

comment on column sellerpilot_private.product_listings.provider_resource_id is
  'Immutable provider sub-resource identity; currently the attested eBay Inventory offerId.';

commit;
