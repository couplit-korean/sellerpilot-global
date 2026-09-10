-- Service-only, exact source ledger for an Elevenst processed-food CREATE.
-- This migration creates no operating approval rows and performs no provider work.

begin;

create table sellerpilot_private.elevenst_new_product_server_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  category_id text not null check (category_id = '1346631'),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  product_updated_at timestamptz not null,
  product_revision bigint not null check (product_revision > 0),
  product_approval_revision bigint not null check (product_approval_revision > 0),
  approved_price_krw integer not null check (approved_price_krw > 0),
  approved_inventory_quantity integer not null check (approved_inventory_quantity >= 0),
  provider_product jsonb not null check (
    jsonb_typeof(provider_product) = 'object'
    and octet_length(provider_product::text) <= 262144
    and provider_product->>'dispCtgrNo' = '1346631'
    and nullif(btrim(provider_product->>'prdNm'), '') is not null
    and nullif(btrim(provider_product->>'sellerPrdCd'), '') is not null
    and provider_product->>'selPrc' ~ '^[0-9]+$'
    and provider_product->>'prdSelQty' ~ '^[0-9]+$'
    and not (provider_product ? 'ProductNotification')
  ),
  provider_product_sha256 text not null check (provider_product_sha256 ~ '^[a-f0-9]{64}$'),
  notices jsonb not null check (
    jsonb_typeof(notices) = 'array'
    and jsonb_array_length(notices) = 10
    and octet_length(notices::text) <= 131072
  ),
  seller_receipt jsonb not null check (
    jsonb_typeof(seller_receipt) = 'object'
    and octet_length(seller_receipt::text) <= 8192
  ),
  availability_receipt jsonb not null check (
    jsonb_typeof(availability_receipt) = 'object'
    and octet_length(availability_receipt::text) <= 8192
  ),
  policy_source jsonb not null check (
    jsonb_typeof(policy_source) = 'object'
    and octet_length(policy_source::text) <= 262144
  ),
  policy_source_revision bigint not null check (policy_source_revision > 0),
  policy_approval_revision bigint not null check (policy_approval_revision > 0),
  approved_at timestamptz not null,
  status text not null default 'approved' check (status in ('approved', 'retired')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (owner_id = created_by),
  check (product_approval_revision = product_revision),
  check ((provider_product->>'selPrc')::numeric = approved_price_krw),
  check ((provider_product->>'prdSelQty')::numeric = approved_inventory_quantity)
);

create unique index elevenst_new_product_one_approved_source_idx
  on sellerpilot_private.elevenst_new_product_server_sources(product_id, credential_id)
  where status = 'approved';

create index elevenst_new_product_source_lookup_idx
  on sellerpilot_private.elevenst_new_product_server_sources(
    owner_id, product_id, category_id, credential_id, credential_version,
    product_revision, product_approval_revision
  );

revoke all on sellerpilot_private.elevenst_new_product_server_sources
  from public, anon, authenticated, service_role;

create function sellerpilot_private.prevent_elevenst_new_product_source_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_DELETE_FORBIDDEN';
  end if;
  if old.status = 'approved'
     and new.status = 'retired'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'ELEVENST_NEW_PRODUCT_SOURCE_IMMUTABLE';
end;
$$;

create trigger elevenst_new_product_source_immutable
before update or delete on sellerpilot_private.elevenst_new_product_server_sources
for each row execute function sellerpilot_private.prevent_elevenst_new_product_source_mutation();

create function public.sellerpilot_service_elevenst_new_product_source(
  p_kind text,
  p_owner_id uuid,
  p_product_id uuid,
  p_category_id text,
  p_credential_id uuid,
  p_credential_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row sellerpilot_private.elevenst_new_product_server_sources%rowtype;
  product_row sellerpilot_private.products%rowtype;
  credential_row sellerpilot_private.channel_credentials%rowtype;
begin
  if p_kind not in ('product', 'credential', 'notices', 'seller', 'availability', 'policy')
     or p_owner_id is null
     or p_product_id is null
     or p_category_id is distinct from '1346631'
     or p_credential_id is null
     or p_credential_version is null
     or p_credential_version < 1 then
    return null;
  end if;

  select * into product_row
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = p_owner_id
     and not product.demo
     and product.status <> 'archived';
  if not found then return null; end if;

  select * into credential_row
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.created_by = p_owner_id
     and credential.channel = 'elevenst'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = p_credential_version
     and (credential.expires_at is null or credential.expires_at > clock_timestamp());
  if not found then return null; end if;

  select * into source_row
    from sellerpilot_private.elevenst_new_product_server_sources source
   where source.owner_id = p_owner_id
     and source.product_id = p_product_id
     and source.category_id = p_category_id
     and source.credential_id = p_credential_id
     and source.credential_version = p_credential_version
     and source.status = 'approved'
     and source.product_updated_at = product_row.updated_at
     and source.product_revision = product_row.detail_page_version
     and source.product_approval_revision = product_row.detail_page_approved_version
     and product_row.detail_page_version > 0
     and product_row.detail_page_approved_version = product_row.detail_page_version
     and source.approved_at <= clock_timestamp()
     and source.provider_product->>'prdNm' = product_row.name
     and source.provider_product->>'sellerPrdCd' = product_row.sku
     and (source.provider_product->>'prdSelQty')::integer = product_row.on_hand
     and source.approved_inventory_quantity = product_row.on_hand;
  if not found then return null; end if;

  if p_kind = 'product' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_server_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'categoryId', source_row.category_id,
      'revision', source_row.product_revision,
      'approvalRevision', source_row.product_approval_revision,
      'providerProduct', source_row.provider_product,
      'providerProductSha256', source_row.provider_product_sha256
    );
  elsif p_kind = 'credential' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_credential_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'credentialId', credential_row.id,
      'credentialVersion', credential_row.version,
      'channel', credential_row.channel,
      'environment', credential_row.environment,
      'status', credential_row.status
    );
  elsif p_kind = 'notices' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_notice_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'categoryId', source_row.category_id,
      'productRevision', source_row.product_revision,
      'notices', source_row.notices
    );
  elsif p_kind = 'seller' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_seller_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'credentialId', source_row.credential_id,
      'credentialVersion', source_row.credential_version,
      'receipt', source_row.seller_receipt
    );
  elsif p_kind = 'availability' then
    return jsonb_build_object(
      'contract', 'sellerpilot_elevenst_new_product_availability_source_v1',
      'current', true,
      'ownerId', source_row.owner_id,
      'productId', source_row.product_id,
      'credentialId', source_row.credential_id,
      'credentialVersion', source_row.credential_version,
      'receipt', source_row.availability_receipt
    );
  end if;

  return source_row.policy_source || jsonb_build_object(
    'contract', 'sellerpilot_elevenst_new_product_policy_source_v1',
    'current', true,
    'ownerId', source_row.owner_id,
    'productId', source_row.product_id,
    'categoryId', source_row.category_id,
    'productRevision', source_row.product_revision,
    'sourceRevision', source_row.policy_source_revision,
    'approvalRevision', source_row.policy_approval_revision,
    'approvedAt', source_row.approved_at
  );
end;
$$;

revoke all on function public.sellerpilot_service_elevenst_new_product_source(
  text, uuid, uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_elevenst_new_product_source(
  text, uuid, uuid, text, uuid, integer
) to service_role;

commit;
