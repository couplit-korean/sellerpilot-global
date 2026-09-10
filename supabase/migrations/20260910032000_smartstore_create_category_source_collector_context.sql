-- Service-only preparation context for the SmartStore CREATE category source
-- collector. The official Naver receipt is fetched after this transaction and
-- the 031000 append RPC re-locks every referenced row to reject TOCTOU drift.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 910032000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamptz,uuid,integer,text,bigint,text,uuid,timestamptz,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.product_category_assignments'
     ) is null then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTOR_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create function public.sellerpilot_service_smartstore_create_category_collect_ctx(
  p_owner_id uuid,
  p_product_id uuid,
  p_credential_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product sellerpilot_private.products%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  assignment_count integer;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_product_id is null or p_credential_id is null then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_NULL'
      using errcode = '22023';
  end if;

  select * into product
    from sellerpilot_private.products candidate
   where candidate.id = p_product_id
   for share;
  if product.id is null
     or product.owner_id is distinct from p_owner_id
     or product.status <> 'ready'
     or product.demo
     or product.updated_at is null
     or product.detail_page_version is null
     or product.detail_page_version < 1
     or product.detail_page_approved_version is distinct from
       product.detail_page_version
     or product.detail_page_image_manifest->>'digest' !~ '^[a-f0-9]{64}$' then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_PRODUCT_NOT_READY'
      using errcode = '55000';
  end if;

  select * into credential
    from sellerpilot_private.channel_credentials candidate
   where candidate.id = p_credential_id
   for share;
  if credential.id is null
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= pg_catalog.clock_timestamp())
     or credential.last_check_status <> 'passed'
     or credential.version is null or credential.version < 1
     or credential.seller_account_key !~ '^[a-f0-9]{64}$'
     or credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     ) then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_CREDENTIAL_NOT_READY'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer into assignment_count
    from sellerpilot_private.product_category_assignments candidate
   where candidate.owner_id = p_owner_id
     and candidate.product_id = p_product_id
     and candidate.channel = 'smartstore'
     and candidate.environment = 'production'
     and candidate.market = 'KR'
     and candidate.status = 'confirmed'
     and candidate.is_leaf
     and length(pg_catalog.btrim(candidate.category_id)) between 1 and 120
     and candidate.updated_at is not null
     and candidate.official_verified_at is not null
     and candidate.confirmed_at is not null
     and pg_catalog.jsonb_typeof(candidate.required_attributes) = 'array'
     and pg_catalog.jsonb_typeof(candidate.provided_attributes) = 'object'
     and pg_catalog.jsonb_typeof(candidate.missing_required_attributes) =
       'array'
     and pg_catalog.jsonb_array_length(
       candidate.missing_required_attributes
     ) = 0;
  if assignment_count <> 1 then
    raise exception 'SMARTSTORE_CATEGORY_SOURCE_COLLECTION_ASSIGNMENT_AMBIGUOUS'
      using errcode = '55000';
  end if;

  select * into assignment
    from sellerpilot_private.product_category_assignments candidate
   where candidate.owner_id = p_owner_id
     and candidate.product_id = p_product_id
     and candidate.channel = 'smartstore'
     and candidate.environment = 'production'
     and candidate.market = 'KR'
     and candidate.status = 'confirmed'
     and candidate.is_leaf
     and length(pg_catalog.btrim(candidate.category_id)) between 1 and 120
     and candidate.updated_at is not null
     and candidate.official_verified_at is not null
     and candidate.confirmed_at is not null
     and pg_catalog.jsonb_typeof(candidate.required_attributes) = 'array'
     and pg_catalog.jsonb_typeof(candidate.provided_attributes) = 'object'
     and pg_catalog.jsonb_typeof(candidate.missing_required_attributes) =
       'array'
     and pg_catalog.jsonb_array_length(
       candidate.missing_required_attributes
     ) = 0
   for share;

  return pg_catalog.jsonb_build_object(
    'contract', 'smartstore_create_category_source_collection_context_v1',
    'ownerId', product.owner_id,
    'productId', product.id,
    'productUpdatedAt', product.updated_at,
    'credentialId', credential.id,
    'credentialVersion', credential.version,
    'sellerAccountKey', credential.seller_account_key,
    'approvedDetailRevision', product.detail_page_version,
    'approvedDetailDigest',
      product.detail_page_image_manifest->>'digest',
    'assignmentId', assignment.id,
    'assignmentUpdatedAt', assignment.updated_at,
    'categoryId', assignment.category_id,
    'providedAttributes', assignment.provided_attributes
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_smartstore_create_category_collect_ctx(
    uuid, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_smartstore_create_category_collect_ctx(
    uuid, uuid, uuid
  ) to service_role;

comment on function
  public.sellerpilot_service_smartstore_create_category_collect_ctx(
    uuid, uuid, uuid
  ) is
  'Returns exact DB facts to the service-only Naver category source collector; 031000 append rechecks every fact after official GETs.';

commit;
