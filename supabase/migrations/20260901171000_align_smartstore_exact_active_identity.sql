-- The exact Smartstore recovery listing belongs to the active central product.
-- Keep every existing immutable identity fence and change only the stale
-- central lifecycle predicate from draft to active.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $migration$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null
     or position(
       'product.status = ''draft''' in lower(v_definition)
     ) = 0
     or position(
       'product.status = ''active''' in lower(v_definition)
     ) <> 0
     or position(
       '7babb554-48dc-4869-81b1-cd4d435d7b96' in v_definition
     ) = 0
     or position(
       'ddccde35-9c58-4856-b673-d7aa27ce4220' in v_definition
     ) = 0
     or position('13671684696' in v_definition) = 0
     or position('13732202182' in v_definition) = 0
     or position('QA-20260823-CC-001' in v_definition) = 0
     or position(
       'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
       in v_definition
     ) = 0
  then
    raise exception 'Smartstore exact active identity preimage drifted';
  end if;
end;
$migration$;

create or replace function public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'smartstore_exact_qa_recovery_v1',
    'phase', 'listing.update',
    'productId', product.id,
    'listingId', listing.id,
    'originProductNo', listing.remote_id,
    'channelProductNo', '13732202182',
    'centralSku', product.sku,
    'sellerManagementCodeSource', 'provider_readback_required',
    'sellerAccountLineage', 'validated_by_service_rpc'
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
   where p_listing_id = '7babb554-48dc-4869-81b1-cd4d435d7b96'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'smartstore'
     and listing.remote_id = '13671684696'
     and listing.marketplace_sku is null
     and listing.remote_resources = '{}'::jsonb
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.currency = 'KRW'
     and listing.price = 5000
     and product.sku = 'QA-20260823-CC-001'
     and not product.demo
     and product.status = 'active'
     and coalesce(listing.market, '') = trim(coalesce(p_market, ''))
     and coalesce(listing.target_id, '') = trim(coalesce(p_target_id, ''))
     and listing.seller_account_key =
       'fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8'
     and credential.status = 'active'
     and credential.environment = 'production'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and credential.seller_account_key = listing.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = listing.id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   limit 1;
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

comment on function
  public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) is
  'Returns the one active exact Smartstore QA origin/channel tuple. All listing, credential, seller-account, and no-active-job fences remain mandatory.';

do $migration$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null
     or position(
       'product.status = ''active''' in lower(v_definition)
     ) = 0
     or position(
       'product.status = ''draft''' in lower(v_definition)
     ) <> 0
  then
    raise exception 'Smartstore exact active identity postimage drifted';
  end if;
end;
$migration$;

commit;
