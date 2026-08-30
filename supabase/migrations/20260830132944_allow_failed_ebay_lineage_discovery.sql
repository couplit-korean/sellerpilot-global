begin;

-- A legacy eBay listing can retain an exact successful create ledger and
-- public listingId while its local publication row is marked failed by a later
-- verification boundary. Permit only that narrow production/live shape to
-- enter the existing read-only ItemID discovery flow. All other failed rows
-- keep the original listing_not_verifiable result.
create or replace function sellerpilot_private.failed_ebay_lineage_discovery_allowed(
  p_listing_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.product_listings candidate
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = candidate.operation_attempt_id
       and attempt.owner_id = candidate.owner_id
       and attempt.channel = candidate.channel_key
       and attempt.operation = 'listing.create'
       and attempt.status = 'succeeded'
       and attempt.completed_at is not null
       and nullif(trim(attempt.remote_id), '') = trim(candidate.remote_id)
      join sellerpilot_private.channel_credentials historical_credential
        on historical_credential.id = attempt.credential_id
       and historical_credential.channel = 'ebay'
       and historical_credential.environment = 'production'
     where candidate.id = p_listing_id
       and candidate.channel_key = 'ebay'
       and candidate.status = 'failed'
       and candidate.requested_publication_intent = 'live'
       and candidate.seller_account_key is null
       and candidate.marketplace_sku is null
       and candidate.provider_resource_id is null
       and nullif(trim(candidate.remote_id), '') is not null
       and upper(trim(candidate.target_id)) ~ '^EBAY_[A-Z0-9_]+$'
       and upper(trim(candidate.target_id)) = case
         when upper(trim(candidate.market)) like 'EBAY_%'
           then upper(trim(candidate.market))
         else 'EBAY_' || upper(trim(candidate.market))
       end
       and not exists (
         select 1
           from sellerpilot_private.provider_listing_lineage_attestations attestation
          where attestation.listing_id = candidate.id
       )
       and (
         candidate.remote_resources = '{}'::jsonb
         or (
           jsonb_typeof(candidate.remote_resources->'resources') = 'object'
           and candidate.remote_resources#>>'{resources,listingId}'
                 = candidate.remote_id
           and upper(coalesce(
             candidate.remote_resources#>>'{resources,marketplaceId}', ''
           )) = upper(candidate.target_id)
         )
       )
  );
$$;

revoke all on function
  sellerpilot_private.failed_ebay_lineage_discovery_allowed(uuid)
  from public, anon, authenticated, service_role;

do $patch_failed_ebay_lineage_prepare$
declare
  v_definition text;
  v_before text := $before$
  if v_listing.status not in ('published', 'paused')
     or nullif(trim(coalesce(v_listing.remote_id, '')), '') is null then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'listing_not_verifiable'
    );
  end if;
$before$;
  v_after text := $after$
  if (
       v_listing.status not in ('published', 'paused')
       and not sellerpilot_private.failed_ebay_lineage_discovery_allowed(
         v_listing.id
       )
     )
     or nullif(trim(coalesce(v_listing.remote_id, '')), '') is null then
    return jsonb_build_object(
      'status', 'manual_required', 'listing_id', v_listing.id,
      'channel', v_listing.channel_key, 'market', v_listing.market,
      'reason', 'listing_not_verifiable'
    );
  end if;
$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_prepare_listing_lineage_verification(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'listing lineage status gate not found';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_failed_ebay_lineage_prepare$;

-- Completion keeps every existing claim, lease, credential, seller-account,
-- request-snapshot, and immutable-attestation fence. Its status predicate
-- recognizes only the same failed listing and the server-owned ItemID
-- discovery marker emitted by the already-deployed enqueue RPC.
do $patch_failed_ebay_lineage_completion$
declare
  v_definition text;
  v_before text := $before$
  if not found
     or v_listing.channel_key is distinct from v_job.channel
     or v_listing.status not in ('published', 'paused')
     or v_listing.seller_account_key is not null
$before$;
  v_after text := $after$
  if not found
     or v_listing.channel_key is distinct from v_job.channel
     or (
       v_listing.status not in ('published', 'paused')
       and not (
         v_job.channel = 'ebay'
         and v_listing.status = 'failed'
         and v_job.request_payload#>>'{arguments,discoveryMode}'
               = 'ebay_listing_id_v1'
         and sellerpilot_private.failed_ebay_lineage_discovery_allowed(
           v_listing.id
         )
       )
     )
     or v_listing.seller_account_key is not null
$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_complete_listing_lineage_verification(text,uuid,uuid,text,jsonb,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'listing lineage completion status gate not found';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_failed_ebay_lineage_completion$;

comment on function public.sellerpilot_service_prepare_listing_lineage_verification(uuid) is
  'Prepares exact read-only legacy listing lineage verification; failed rows remain blocked except narrowly matched production/live eBay create ledgers.';

comment on function sellerpilot_private.failed_ebay_lineage_discovery_allowed(uuid) is
  'Private exact predicate for a missing-tuple production/live failed eBay legacy listing; no role has direct execution.';

commit;
