-- Admit one content-only update of the already adopted Temu ACTIVE item.
-- The only provider write is bg.local.goods.partial.update for goodsName,
-- goodsDesc, and bulletPoints. Images, price, stock, SKU identity, and sale
-- state are immutable preconditions and mandatory post-readback evidence.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917396001);
select pg_catalog.pg_advisory_xact_lock(193674993, 908000001);

lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
lock table sellerpilot_private.channel_operation_attempts in share row exclusive mode;
lock table sellerpilot_private.product_listings in share row exclusive mode;
lock table sellerpilot_private.exact_existing_update_permits in share row exclusive mode;

do $temu_exact_update_preflight$
declare
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'::regprocedure,
    'sellerpilot_private.exact_existing_update_release_is_current(text,text)'::regprocedure,
    'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure,
    'sellerpilot_private.serverless_gateway_job_allowed(text,text)'::regprocedure,
    'sellerpilot_private.temu_server_owned_listing_update_allowed(jsonb,jsonb,text)'::regprocedure,
    'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure,
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    if not exists (
      select 1
        from pg_catalog.pg_proc procedure
       where procedure.oid = v_signature
         and procedure.proconfig = array['search_path=""']::text[]
    ) then
      raise exception 'Temu exact update function preimage invalid: %', v_signature
        using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'temu'
       and job.operation in (
         'listing.create', 'listing.update', 'listing.stop', 'listing.activate'
       )
       and job.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'Temu exact update requires no competing listing job'
      using errcode = '55000';
  end if;
end;
$temu_exact_update_preflight$;

alter table sellerpilot_private.exact_existing_update_permits
  drop constraint exact_existing_update_permit_target_check;
alter table sellerpilot_private.exact_existing_update_permits
  add constraint exact_existing_update_permit_target_check check (
    product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and seller_account_key ~ '^[a-f0-9]{64}$'
    and credential_version > 0
    and credential_fingerprint ~ '^[A-F0-9]{12}$'
    and credential_account_source in (
      'provider_certified_v1', 'credential_incarnation_v1'
    )
    and release_sha ~ '^[a-f0-9]{40}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
    and expires_at > armed_at
    and expires_at <= armed_at + interval '5 minutes'
    and (
      (
        channel = 'coupang'
        and listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
        and market = 'KR' and target_id = 'KR'
        and remote_id = '16356981734'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id = '95962393877'
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_account_source = 'credential_incarnation_v1'
        and snapshot_revision is null
        and snapshot_payload_sha256 is null
        and snapshot_source_job_id is null
      ) or (
        channel = 'elevenst'
        and listing_id = '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
        and credential_id = 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
        and market = 'KR' and target_id = 'KR'
        and remote_id = '9573255804'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id is null
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_version = 2
        and credential_account_source = 'credential_incarnation_v1'
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision > 0
        and snapshot_payload_sha256 ~ '^[a-f0-9]{64}$'
        and snapshot_source_job_id is not null
      ) or (
        channel = 'ebay'
        and listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
        and market = 'US' and target_id = 'EBAY_US'
        and remote_id = '800551945442'
        and seller_sku = 'QA-20260823-CC-001-US'
        and provider_resource_id = '244042196011'
        and currency = 'USD' and price = 12.90
        and stock between 1 and 999999
        and credential_account_source = 'provider_certified_v1'
        and credential_expires_at is not null
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision is null
        and snapshot_payload_sha256 is null
        and snapshot_source_job_id is null
        and seller_account_key =
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
      ) or (
        channel = 'temu'
        and market = 'KR' and target_id = 'KR'
        and remote_id = '608570473054515'
        and seller_sku = 'QA-20260823-CC-001'
        and provider_resource_id = '123896921649274'
        and currency = 'KRW' and price = 5000 and stock = 1
        and credential_account_source = 'provider_certified_v1'
        and credential_expires_at is not null
        and credential_last_checked_at is not null
        and credential_last_check_status = 'passed'
        and snapshot_revision > 0
        and snapshot_payload_sha256 ~ '^[a-f0-9]{64}$'
        and snapshot_source_job_id is not null
      )
    )
  );

create function sellerpilot_private.temu_exact_update_arguments_valid(
  p_arguments jsonb,
  p_release_sha text,
  p_request_fingerprint text,
  p_expected_stock integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_marker jsonb := p_arguments->'sellerpilotTemuExactExistingUpdate';
  v_partial jsonb := p_arguments->'sellerpilotTemuPartialUpdate';
  v_assets jsonb := p_arguments->'sellerpilotPublicationAssetBinding';
  v_preserved jsonb := p_arguments->'sellerpilotTemuExactPreservedAssets';
  v_goods jsonb := p_arguments#>'{body,goodsBasic}';
  v_sku jsonb := p_arguments#>'{body,skuList,0}';
  v_representative jsonb := p_arguments#>'{body,goodsBasic,goodsCarouselImage}';
  v_details jsonb := p_arguments#>'{body,goodsBasic,detailImage}';
  v_bullets jsonb := p_arguments#>'{body,goodsBasic,bulletPoints}';
begin
  return coalesce(
    jsonb_typeof(p_arguments) = 'object'
    and p_release_sha ~ '^[a-f0-9]{40}$'
    and p_request_fingerprint ~ '^[a-f0-9]{64}$'
    and p_expected_stock = 1
    and p_arguments->>'publicationExpectedFingerprint' = p_request_fingerprint
    and p_arguments->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_arguments->>'publicationIntent' = 'live'
    and p_arguments->>'publicationExpectedLocale' = 'ko-KR'
    and (p_arguments->>'publicationExpectedImageCount')::integer = 8
    and p_arguments->>'goodsId' = '608570473054515'
    and nullif(trim(p_arguments->>'externalGoodsId'), '') is not null
    and jsonb_typeof(v_marker) = 'object'
    and (select count(*) from jsonb_object_keys(v_marker)) = 11
    and v_marker->>'contract' = 'temu_exact_existing_active_content_update_v1'
    and v_marker->>'productId' = 'ddccde35-9c58-4856-b673-d7aa27ce4220'
    and v_marker->>'goodsId' = '608570473054515'
    and v_marker->>'skuId' = '123896921649274'
    and v_marker->>'listingId' ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and v_marker->>'credentialId' ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and v_marker->>'externalGoodsId' = p_arguments->>'externalGoodsId'
    and nullif(trim(v_marker->>'externalSkuId'), '') is not null
    and v_marker->>'sellerAccountKey' ~ '^[a-f0-9]{64}$'
    and v_marker->>'approvedManifestDigest' ~ '^[a-f0-9]{64}$'
    and v_marker->>'releaseSha' = p_release_sha
    and jsonb_typeof(v_partial) = 'object'
    and (select count(*) from jsonb_object_keys(v_partial)) = 3
    and v_partial->>'operation' = 'bg.local.goods.partial.update'
    and v_partial->'mutableFields' =
          '["goodsName","goodsDesc","bulletPoints"]'::jsonb
    and v_partial->>'contentDigest' = encode(extensions.digest(
          (v_goods->>'goodsName') || chr(31) ||
          (v_goods->>'goodsDesc') || chr(31) ||
          coalesce((
            select string_agg(value, chr(30) order by ordinal)
              from jsonb_array_elements_text(v_bullets)
                     with ordinality as bullet(value, ordinal)
          ), ''),
          'sha256'
        ), 'hex')
    and p_arguments#>>'{body,language}' = 'ko'
    and jsonb_typeof(v_goods) = 'object'
    and v_goods->>'externalGoodsId' = p_arguments->>'externalGoodsId'
    and nullif(trim(v_goods->>'goodsName'), '') is not null
    and v_goods->>'goodsName' = trim(v_goods->>'goodsName')
    and length(v_goods->>'goodsName') <= 500
    and v_goods->>'goodsName' ~ '[가-힣]'
    and v_goods->>'goodsName' !~* '(unknown|tbd|n/?a|미확인|확인[[:space:]]*필요)'
    and v_goods->>'goodsName' !~ '[[:cntrl:]]'
    and nullif(trim(v_goods->>'goodsDesc'), '') is not null
    and v_goods->>'goodsDesc' = trim(v_goods->>'goodsDesc')
    and length(v_goods->>'goodsDesc') <= 10000
    and v_goods->>'goodsDesc' ~ '[가-힣]'
    and v_goods->>'goodsDesc' !~* '(unknown|tbd|n/?a|미확인|확인[[:space:]]*필요)'
    and v_goods->>'goodsDesc' !~ '[[:cntrl:]]'
    and jsonb_typeof(v_bullets) = 'array'
    and jsonb_array_length(v_bullets) between 1 and 10
    and (select count(distinct value) from jsonb_array_elements_text(v_bullets)) =
          jsonb_array_length(v_bullets)
    and not exists (
      select 1 from jsonb_array_elements_text(v_bullets) as bullet(value)
       where value <> trim(value) or value = '' or length(value) > 500
          or value ~ '[[:cntrl:]]'
          or value !~ '[가-힣]'
          or value ~* '(unknown|tbd|n/?a|미확인|확인[[:space:]]*필요)'
    )
    and jsonb_typeof(v_representative) = 'array'
    and jsonb_array_length(v_representative) = 1
    and jsonb_typeof(v_details) = 'array'
    and jsonb_array_length(v_details) = 8
    and (select count(distinct value) from jsonb_array_elements_text(v_details)) = 8
    and not (v_details ? (v_representative->>0))
    and (select bool_and(value ~ '^https://') from jsonb_array_elements_text(v_representative))
    and (select bool_and(value ~ '^https://') from jsonb_array_elements_text(v_details))
    and jsonb_typeof(p_arguments#>'{body,skuList}') = 'array'
    and jsonb_array_length(p_arguments#>'{body,skuList}') = 1
    and v_sku->>'externalSkuId' = v_marker->>'externalSkuId'
    and (v_sku->>'quantity')::integer = 1
    and v_sku#>>'{price,basePrice,currency}' = 'KRW'
    and (v_sku#>>'{price,basePrice,amount}')::numeric = 5000
    and jsonb_typeof(v_assets) = 'object'
    and v_assets->>'contract' = 'sellerpilot_publication_asset_binding_v1'
    and v_assets->>'providerImageSurface' = 'detail_content'
    and v_assets->>'approvedManifestDigest' =
          v_marker->>'approvedManifestDigest'
    and jsonb_typeof(v_assets->'approvedDetailImages') = 'array'
    and jsonb_array_length(v_assets->'approvedDetailImages') = 8
    and jsonb_typeof(v_assets->'providerTransportImages') = 'array'
    and jsonb_array_length(v_assets->'providerTransportImages') = 8
    and jsonb_typeof(v_preserved) = 'object'
    and (select count(*) from jsonb_object_keys(v_preserved)) = 3
    and v_preserved->>'contract' = 'temu_exact_preserved_assets_v1'
    and jsonb_typeof(v_preserved->'representativeImage') = 'object'
    and (select count(*) from jsonb_object_keys(v_preserved->'representativeImage')) = 6
    and v_preserved#>>'{representativeImage,role}' = 'gallery-representative'
    and v_preserved#>>'{representativeImage,sourceKind}' = 'normalized_output'
    and v_preserved#>>'{representativeImage,publicUrl}' = v_representative->>0
    and v_preserved#>>'{representativeImage,sourceSha256}' =
          v_preserved#>>'{representativeImage,contentSha256}'
    and v_preserved#>>'{representativeImage,contentSha256}' ~ '^[a-f0-9]{64}$'
    and v_preserved#>>'{representativeImage,objectPath}' =
          'normalized/' || left(v_preserved#>>'{representativeImage,contentSha256}', 2)
          || '/' || (v_preserved#>>'{representativeImage,contentSha256}') || '.jpg'
    and strpos(
          v_preserved#>>'{representativeImage,publicUrl}',
          '/' || (v_preserved#>>'{representativeImage,objectPath}')
        ) > 0
    and jsonb_typeof(v_preserved->'detailImages') = 'array'
    and jsonb_array_length(v_preserved->'detailImages') = 8
    and not exists (
      select 1
        from jsonb_array_elements(v_preserved->'detailImages')
               with ordinality preserved(image, ordinal)
       where jsonb_typeof(preserved.image) <> 'object'
          or (select count(*) from jsonb_object_keys(preserved.image)) <> 6
          or preserved.image->>'publicUrl' <>
               v_details->>((preserved.ordinal - 1)::integer)
          or preserved.image->>'role' <>
               v_assets#>>array['approvedDetailImages',(preserved.ordinal - 1)::text,'role']
          or preserved.image->>'publicUrl' <>
               v_assets#>>array['approvedDetailImages',(preserved.ordinal - 1)::text,'publicUrl']
          or preserved.image->>'approvedObjectPath' <>
               v_assets#>>array['approvedDetailImages',(preserved.ordinal - 1)::text,'approvedObjectPath']
          or preserved.image->>'approvedSourceSha256' <>
               v_assets#>>array['approvedDetailImages',(preserved.ordinal - 1)::text,'approvedSourceSha256']
          or preserved.image->>'objectPath' <>
               v_assets#>>array['approvedDetailImages',(preserved.ordinal - 1)::text,'objectPath']
          or preserved.image->>'contentSha256' <>
               v_assets#>>array['approvedDetailImages',(preserved.ordinal - 1)::text,'contentSha256']
          or preserved.image->>'role' <>
               v_assets#>>array['providerTransportImages',(preserved.ordinal - 1)::text,'role']
          or preserved.image->>'publicUrl' <>
               v_assets#>>array['providerTransportImages',(preserved.ordinal - 1)::text,'publicUrl']
          or preserved.image->>'objectPath' <>
               v_assets#>>array['providerTransportImages',(preserved.ordinal - 1)::text,'objectPath']
          or preserved.image->>'contentSha256' <>
               v_assets#>>array['providerTransportImages',(preserved.ordinal - 1)::text,'contentSha256']
          or preserved.image->>'approvedObjectPath' !~
               '^results/[0-9a-f-]+/claims/[0-9a-f-]+/[^/]+[.]png$'
          or preserved.image->>'approvedSourceSha256' !~ '^[a-f0-9]{64}$'
          or preserved.image->>'contentSha256' !~ '^[a-f0-9]{64}$'
          or preserved.image->>'objectPath' <>
               'normalized/' || left(preserved.image->>'contentSha256', 2)
               || '/' || (preserved.image->>'contentSha256') || '.jpg'
          or strpos(
               preserved.image->>'publicUrl',
               '/' || (preserved.image->>'objectPath')
             ) <= 0
    )
    and (select count(distinct image->>'role')
           from jsonb_array_elements(v_preserved->'detailImages') image) = 8
    and (select count(distinct image->>'approvedObjectPath')
           from jsonb_array_elements(v_preserved->'detailImages') image) = 8
    and (select count(distinct image->>'approvedSourceSha256')
           from jsonb_array_elements(v_preserved->'detailImages') image) = 8
    and (select count(distinct image->>'contentSha256')
           from jsonb_array_elements(v_preserved->'detailImages') image) = 8,
    false
  );
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.temu_exact_update_arguments_valid(
  jsonb, text, text, integer
) from public, anon, authenticated, service_role;

do $install_temu_exact_helper_wrappers$
declare
  v_definition text;
  v_signature regprocedure;
  v_source_name text;
  v_predecessor_name text;
  v_row record;
begin
  for v_row in
    select * from (values
    (
      'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)',
      'exact_existing_update_arguments_valid',
      'exact_existing_update_arguments_before_temu_173960'
    ),
    (
      'sellerpilot_private.exact_existing_update_release_is_current(text,text)',
      'exact_existing_update_release_is_current',
      'exact_existing_update_release_before_temu_173960'
    ),
    (
      'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)',
      'exact_existing_update_lineage_is_current',
      'exact_existing_update_lineage_before_temu_173960'
    ),
    (
      'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)',
      'exact_existing_update_enqueued_lineage_is_current',
      'exact_existing_update_enqueued_before_temu_173960'
    ),
    (
      'sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(uuid,uuid,uuid,text,text,jsonb)',
      'exact_existing_update_enqueue_gate_bypass_allowed',
      'exact_existing_update_enqueue_before_temu_173960'
    ),
    (
      'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)',
      'bind_exact_existing_update_claim',
      'bind_exact_existing_update_claim_before_temu_173960'
    ),
    (
      'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)',
      'exact_existing_update_provider_allowed',
      'exact_existing_update_provider_before_temu_173960'
    ),
    (
      'sellerpilot_private.serverless_gateway_job_allowed(text,text)',
      'serverless_gateway_job_allowed',
      'serverless_gateway_job_allowed_before_temu_173960'
    ),
    (
      'sellerpilot_private.temu_server_owned_listing_update_allowed(jsonb,jsonb,text)',
      'temu_server_owned_listing_update_allowed',
      'temu_listing_update_allowed_before_exact_173960'
    )) as source(signature, source_name, predecessor_name)
  loop
    v_signature := pg_catalog.to_regprocedure(v_row.signature);
    v_source_name := v_row.source_name;
    v_predecessor_name := v_row.predecessor_name;
    if v_signature is null then
      raise exception 'Temu exact helper missing: %', v_row.signature
        using errcode = '55000';
    end if;
    select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
    if (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_definition,
          'sellerpilot_private.' || v_source_name || '(',
          ''
        ))
    ) / pg_catalog.length('sellerpilot_private.' || v_source_name || '(') <> 1
    then
      raise exception 'Temu exact helper copy preimage drifted: %', v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      v_definition,
      'sellerpilot_private.' || v_source_name || '(',
      'sellerpilot_private.' || v_predecessor_name || '('
    );
  end loop;
end;
$install_temu_exact_helper_wrappers$;

revoke all on function
  sellerpilot_private.exact_existing_update_arguments_before_temu_173960(
    text, jsonb, text, text, integer
  ),
  sellerpilot_private.exact_existing_update_release_before_temu_173960(
    text, text
  ),
  sellerpilot_private.exact_existing_update_lineage_before_temu_173960(uuid),
  sellerpilot_private.exact_existing_update_enqueued_before_temu_173960(uuid),
  sellerpilot_private.exact_existing_update_enqueue_before_temu_173960(
    uuid, uuid, uuid, text, text, jsonb
  ),
  sellerpilot_private.bind_exact_existing_update_claim_before_temu_173960(
    jsonb, jsonb
  ),
  sellerpilot_private.exact_existing_update_provider_before_temu_173960(
    uuid, uuid
  ),
  sellerpilot_private.serverless_gateway_job_allowed_before_temu_173960(
    text, text
  ),
  sellerpilot_private.temu_listing_update_allowed_before_exact_173960(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.exact_existing_update_arguments_valid(
  p_channel text,
  p_arguments jsonb,
  p_release_sha text,
  p_request_fingerprint text,
  p_expected_stock integer
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when p_channel = 'temu' then
    sellerpilot_private.temu_exact_update_arguments_valid(
      p_arguments, p_release_sha, p_request_fingerprint, p_expected_stock
    )
  else sellerpilot_private.exact_existing_update_arguments_before_temu_173960(
    p_channel, p_arguments, p_release_sha, p_request_fingerprint,
    p_expected_stock
  ) end
$$;

create or replace function sellerpilot_private.exact_existing_update_release_is_current(
  p_channel text,
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_channel = 'temu' then coalesce(
    p_release_sha ~ '^[a-f0-9]{40}$'
    and sellerpilot_private.active_serverless_runtime_release_sha() = p_release_sha
    and exists (
      select 1 from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton and not gate.is_open
         and gate.opened_at is null and gate.opened_release_sha is null
         and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective('temu'),
    false
  ) else sellerpilot_private.exact_existing_update_release_before_temu_173960(
    p_channel, p_release_sha
  ) end
$$;

create or replace function sellerpilot_private.exact_existing_update_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.permit_id = p_permit_id and permit.channel = 'temu'
  ) then exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.owner_id = permit.owner_id
       and listing.product_id = permit.product_id
       and listing.channel_key = 'temu'
       and listing.market = permit.market and listing.target_id = permit.target_id
       and listing.remote_id = permit.remote_id
       and listing.marketplace_sku =
             listing.remote_resources#>>'{resources,externalSkuId}'
       and listing.currency = permit.currency and listing.price = permit.price
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id and product.owner_id = permit.owner_id
       and product.sku = permit.seller_sku and product.on_hand = permit.stock
       and not product.demo and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id and credential.channel = 'temu'
       and credential.environment = 'production' and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.expires_at is not distinct from permit.credential_expires_at
       and credential.last_checked_at is not distinct from permit.credential_last_checked_at
       and credential.last_check_status is not distinct from permit.credential_last_check_status
       and credential.expires_at > statement_timestamp()
     where permit.permit_id = p_permit_id
       and permit.channel = 'temu'
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and permit.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and permit.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and permit.remote_id = '608570473054515'
       and permit.provider_resource_id = '123896921649274'
       and permit.currency = 'KRW' and permit.price = 5000 and permit.stock = 1
       and permit.snapshot_revision = product.detail_page_version
       and permit.snapshot_payload_sha256 =
             product.detail_page_image_manifest->>'digest'
       and permit.snapshot_source_job_id::text =
             listing.remote_resources#>>'{verification,jobId}'
       and product.detail_page_version = product.detail_page_approved_version
       and product.detail_page_image_manifest->>'contract' =
             'sellerpilot_detail_image_manifest_v2'
       and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
       and listing.status = 'published'
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'live'
       and listing.remote_resources#>>'{resources,goodsId}' = permit.remote_id
       and listing.remote_resources#>>'{resources,skuId}' = permit.provider_resource_id
       and nullif(listing.remote_resources#>>'{resources,externalGoodsId}', '') is not null
       and nullif(listing.remote_resources#>>'{resources,externalSkuId}', '') is not null
       and sellerpilot_private.exact_existing_update_release_is_current(
             'temu', permit.release_sha
           )
  ) else sellerpilot_private.exact_existing_update_lineage_before_temu_173960(
    p_permit_id
  ) end
$$;

create or replace function sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.permit_id = p_permit_id and permit.channel = 'temu'
  ) then exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.owner_id = permit.owner_id
       and listing.product_id = permit.product_id
       and listing.channel_key = 'temu'
       and listing.market = permit.market and listing.target_id = permit.target_id
       and listing.remote_id = permit.remote_id
       and listing.marketplace_sku =
             listing.remote_resources#>>'{resources,externalSkuId}'
       and listing.currency = permit.currency and listing.price = permit.price
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id and product.owner_id = permit.owner_id
       and product.sku = permit.seller_sku and product.on_hand = permit.stock
       and not product.demo and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id and credential.channel = 'temu'
       and credential.environment = 'production' and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at = permit.credential_verified_at
       and credential.expires_at is not distinct from permit.credential_expires_at
       and credential.last_checked_at is not distinct from permit.credential_last_checked_at
       and credential.last_check_status is not distinct from permit.credential_last_check_status
       and credential.expires_at > statement_timestamp()
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = listing.operation_attempt_id
       and attempt.owner_id = permit.owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.channel = 'temu' and attempt.operation = 'listing.update'
       and attempt.status = 'running'
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = permit.request_fingerprint
      join sellerpilot_private.channel_gateway_jobs job
        on job.attempt_id = attempt.id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.channel = 'temu' and job.operation = 'listing.update'
       and job.environment = 'production' and job.status in ('queued','running')
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and job.completed_at is null and job.response_payload is null
       and job.error_message is null
     where permit.permit_id = p_permit_id
       and permit.channel = 'temu'
       and permit.invalidated_at is null and permit.expires_at > statement_timestamp()
       and permit.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and permit.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and permit.remote_id = '608570473054515'
       and permit.provider_resource_id = '123896921649274'
       and permit.currency = 'KRW' and permit.price = 5000 and permit.stock = 1
       and permit.snapshot_revision = product.detail_page_version
       and permit.snapshot_payload_sha256 =
             product.detail_page_image_manifest->>'digest'
       and permit.snapshot_source_job_id::text =
             listing.remote_resources#>>'{verification,jobId}'
       and product.detail_page_version = product.detail_page_approved_version
       and product.detail_page_image_manifest->>'contract' =
             'sellerpilot_detail_image_manifest_v2'
       and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
       and listing.status = 'queued' and listing.failure_class is null
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'live'
       and listing.provider_status is not null and listing.published_at is not null
       and listing.remote_resources#>>'{resources,goodsId}' = permit.remote_id
       and listing.remote_resources#>>'{resources,skuId}' = permit.provider_resource_id
       and job.request_payload#>>'{arguments,sellerpilotTemuExactExistingUpdate,listingId}' =
             permit.listing_id::text
       and job.request_payload#>>'{arguments,sellerpilotTemuExactExistingUpdate,credentialId}' =
             permit.credential_id::text
       and job.request_payload#>>'{arguments,sellerpilotTemuExactExistingUpdate,approvedManifestDigest}' =
             permit.snapshot_payload_sha256
       and sellerpilot_private.temu_exact_update_arguments_valid(
             job.request_payload->'arguments', permit.release_sha,
             permit.request_fingerprint, permit.stock
           )
       and not exists (
         select 1
           from jsonb_array_elements(product.detail_page_image_manifest->'images')
                  with ordinality manifest(image, ordinal)
          where manifest.image->>'role' <>
                job.request_payload#>>array[
                  'arguments','sellerpilotPublicationAssetBinding',
                  'approvedDetailImages',(manifest.ordinal - 1)::text,'role'
                ]
             or manifest.image->>'path' <>
                job.request_payload#>>array[
                  'arguments','sellerpilotPublicationAssetBinding',
                  'approvedDetailImages',(manifest.ordinal - 1)::text,'approvedObjectPath'
                ]
             or manifest.image->>'sourceSha256' <>
                job.request_payload#>>array[
                  'arguments','sellerpilotPublicationAssetBinding',
                  'approvedDetailImages',(manifest.ordinal - 1)::text,'approvedSourceSha256'
                ]
       )
       and sellerpilot_private.exact_existing_update_release_is_current(
             'temu', permit.release_sha
           )
       and exists (
         select 1 from sellerpilot_private.serverless_static_egress_policy policy
          where policy.channel = 'temu' and policy.enabled
       )
       and (
         (permit.update_job_id is null and permit.update_attempt_id is null)
         or (permit.update_job_id = job.id and permit.update_attempt_id = attempt.id)
       )
  ) else sellerpilot_private.exact_existing_update_enqueued_before_temu_173960(
    p_permit_id
  ) end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_get_temu_exact_update_id(
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
  v_result jsonb;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'temu' and policy.enabled
  ) then
    return null;
  end if;
  select jsonb_build_object(
    'contract', 'temu_exact_existing_update_identity_v1',
    'productId', product.id,
    'listingId', listing.id,
    'credentialId', credential.id,
    'goodsId', listing.remote_id,
    'skuId', listing.remote_resources#>>'{resources,skuId}',
    'externalGoodsId', listing.remote_resources#>>'{resources,externalGoodsId}',
    'externalSkuId', listing.remote_resources#>>'{resources,externalSkuId}',
    'sellerAccountKey', listing.seller_account_key,
    'approvedManifestDigest', product.detail_page_image_manifest->>'digest'
  ) into v_result
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
   where listing.id = p_listing_id
     and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and listing.product_id = p_product_id
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.channel_key = 'temu'
     and listing.market = p_market and p_market = 'KR'
     and listing.target_id = p_target_id and p_target_id = 'KR'
     and listing.remote_id = '608570473054515'
     and listing.marketplace_sku =
           listing.remote_resources#>>'{resources,externalSkuId}'
     and listing.status = 'published'
     and listing.currency = 'KRW' and listing.price = 5000
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'live'
     and listing.provider_status is not null
     and listing.last_verified_at is not null
     and listing.published_at is not null
     and listing.failure_class is null and listing.last_error is null
     and listing.seller_account_key ~ '^[a-f0-9]{64}$'
     and listing.remote_resources#>>'{resources,goodsId}' = '608570473054515'
     and listing.remote_resources#>>'{resources,skuId}' = '123896921649274'
     and nullif(listing.remote_resources#>>'{resources,externalGoodsId}', '') is not null
     and nullif(listing.remote_resources#>>'{resources,externalSkuId}', '') is not null
     and listing.remote_resources#>>'{verification,contract}' =
           'temu_exact_existing_active_adoption_v1'
     and listing.remote_resources#>>'{verification,locale}' = 'ko-KR'
     and listing.remote_resources#>>'{verification,currency}' = 'KRW'
     and (listing.remote_resources#>>'{verification,price}')::numeric = 5000
     and (listing.remote_resources#>>'{verification,stock}')::integer = 1
     and (listing.remote_resources#>>'{verification,representativeImageCount}')::integer = 1
     and (listing.remote_resources#>>'{verification,detailImageCount}')::integer = 8
     and listing.remote_resources#>>'{verification,readOnlyProviderObservation}' = 'true'
     and coalesce(listing.remote_resources#>>'{verification,jobId}', '') ~
           '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1 and not product.demo
     and product.status <> 'archived'
     and product.detail_page_version = product.detail_page_approved_version
     and product.detail_page_version > 0
     and product.detail_page_image_manifest->>'contract' =
           'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'algorithm' = 'sha256'
     and product.detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
     and jsonb_typeof(product.detail_page_image_manifest->'images') = 'array'
     and jsonb_array_length(product.detail_page_image_manifest->'images') = 8
     and (
       select count(distinct image->>'path')
         from jsonb_array_elements(product.detail_page_image_manifest->'images') image
     ) = 8
     and (
       select count(distinct image->>'sourceSha256')
         from jsonb_array_elements(product.detail_page_image_manifest->'images') image
     ) = 8
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version > 0
     and credential.fingerprint ~ '^[A-F0-9]{12}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.expires_at > statement_timestamp()
     and credential.last_checked_at is not null
     and credential.last_check_status = 'passed'
     and not exists (
       select 1 from sellerpilot_private.channel_credentials competing
        where competing.channel = 'temu'
          and competing.environment = 'production'
          and competing.status = 'active'
          and competing.id <> credential.id
     )
     and not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.channel = 'temu'
          and job.listing_id = listing.id
          and job.operation in (
            'listing.create', 'listing.update', 'listing.stop', 'listing.activate'
          )
          and job.status in ('queued', 'running', 'reconciliation_required')
     )
   limit 1;
  return v_result;
exception when others then
  return null;
end;
$$;

revoke all on function public.sellerpilot_service_get_temu_exact_update_id(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_get_temu_exact_update_id(
  uuid, uuid, uuid, text, text
) to service_role;

create function public.sellerpilot_service_arm_temu_exact_update(
  p_channel text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'temu' and policy.enabled
  ) then
    raise exception 'Temu exact update static egress unavailable'
      using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917396001);
  if p_channel is distinct from 'temu'
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.exact_existing_update_release_is_current(
       'temu', p_release_sha
     ) then
    raise exception 'Temu exact update permit identity invalid'
      using errcode = '55000';
  end if;
  v_identity := public.sellerpilot_service_get_temu_exact_update_id(
    p_listing_id, p_credential_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid, 'KR', 'KR'
  );
  if v_identity->>'contract' is distinct from
       'temu_exact_existing_update_identity_v1' then
    raise exception 'Temu exact update lineage invalid' using errcode = '55000';
  end if;
  select * into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id for share;
  select * into strict v_product
    from sellerpilot_private.products product
   where product.id = v_listing.product_id for share;
  select * into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id for share;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.channel = 'temu'
     and permit.listing_id = p_listing_id
     and permit.update_job_id is null
     and permit.invalidated_at is null
     and permit.expires_at <= v_now;

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.channel = 'temu'
     and permit.listing_id = p_listing_id
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.credential_id = p_credential_id
       and v_permit.release_sha = p_release_sha
       and v_permit.request_fingerprint = p_request_fingerprint
       and v_permit.update_job_id is null
       and v_permit.bound_at is null
       and v_permit.consumed_at is null
       and v_permit.expires_at > v_now then
      return jsonb_build_object(
        'contract', 'exact_existing_update_permit_v1',
        'permitId', v_permit.permit_id, 'channel', 'temu',
        'listingId', v_permit.listing_id, 'releaseSha', v_permit.release_sha,
        'requestFingerprint', v_permit.request_fingerprint,
        'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
        'bound', false, 'reused', true
      );
    end if;
    raise exception 'Temu exact update already has a different active permit'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.exact_existing_update_permits (
    channel, listing_id, product_id, credential_id, owner_id,
    market, target_id, remote_id, seller_sku, provider_resource_id,
    currency, price, stock, seller_account_key,
    credential_version, credential_fingerprint,
    credential_account_source, credential_verified_at,
    credential_expires_at, credential_last_checked_at,
    credential_last_check_status, snapshot_revision,
    snapshot_payload_sha256, snapshot_source_job_id,
    release_sha, request_fingerprint, armed_at, expires_at
  ) values (
    'temu', v_listing.id, v_product.id, v_credential.id, v_listing.owner_id,
    'KR', 'KR', '608570473054515', 'QA-20260823-CC-001',
    '123896921649274', 'KRW', 5000, 1, v_listing.seller_account_key,
    v_credential.version, v_credential.fingerprint,
    v_credential.seller_account_key_source,
    v_credential.seller_account_verified_at, v_credential.expires_at,
    v_credential.last_checked_at, v_credential.last_check_status,
    v_product.detail_page_version,
    v_product.detail_page_image_manifest->>'digest',
    (v_listing.remote_resources#>>'{verification,jobId}')::uuid,
    p_release_sha, p_request_fingerprint, v_now, v_now + interval '5 minutes'
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract', 'exact_existing_update_permit_v1',
    'permitId', v_permit.permit_id, 'channel', 'temu',
    'listingId', v_permit.listing_id, 'releaseSha', v_permit.release_sha,
    'requestFingerprint', v_permit.request_fingerprint,
    'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
    'bound', false, 'reused', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_arm_temu_exact_update(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_arm_temu_exact_update(
  text, uuid, uuid, text, text
) to service_role;

create or replace function sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
begin
  if p_channel <> 'temu' then
    return sellerpilot_private.exact_existing_update_enqueue_before_temu_173960(
      p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
      p_request_payload
    );
  end if;
  return coalesce(
    p_operation = 'listing.update'
    and jsonb_typeof(p_request_payload) = 'object'
    and jsonb_typeof(v_arguments) = 'object'
    and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,contract}' =
          'temu_exact_existing_active_content_update_v1'
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.channel = 'temu'
         and permit.listing_id = p_listing_id
         and permit.credential_id = p_credential_id
         and permit.request_fingerprint = attempt.request_fingerprint
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
         and permit.snapshot_payload_sha256 =
               v_arguments#>>'{sellerpilotTemuExactExistingUpdate,approvedManifestDigest}'
         and sellerpilot_private.exact_existing_update_lineage_is_current(
               permit.permit_id
             )
         and sellerpilot_private.exact_existing_update_arguments_valid(
               'temu', v_arguments, permit.release_sha,
               permit.request_fingerprint, permit.stock
             )
        join sellerpilot_private.product_listings listing
          on listing.id = permit.listing_id
         and listing.remote_resources#>>'{resources,externalGoodsId}' =
               v_arguments#>>'{sellerpilotTemuExactExistingUpdate,externalGoodsId}'
         and listing.remote_resources#>>'{resources,externalSkuId}' =
               v_arguments#>>'{sellerpilotTemuExactExistingUpdate,externalSkuId}'
       where attempt.id = p_attempt_id
         and attempt.owner_id = permit.owner_id
         and attempt.credential_id = permit.credential_id
         and attempt.channel = 'temu'
         and attempt.operation = 'listing.update'
         and attempt.status = 'running'
         and attempt.seller_account_key = permit.seller_account_key
         and attempt.request_fingerprint = permit.request_fingerprint
         and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,listingId}' =
               permit.listing_id::text
         and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,credentialId}' =
               permit.credential_id::text
         and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,sellerAccountKey}' =
               permit.seller_account_key
    ),
    false
  );
exception when others then
  return false;
end;
$$;

create or replace function sellerpilot_private.bind_exact_existing_update_claim(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_old->>'channel' <> 'temu' then
    return sellerpilot_private.bind_exact_existing_update_claim_before_temu_173960(
      p_old, p_new
    );
  end if;
  if jsonb_typeof(p_old) <> 'object' or jsonb_typeof(p_new) <> 'object'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' <> 'queued' or p_new->>'status' <> 'running'
     or p_new->>'channel' <> 'temu'
     or p_old->>'operation' <> 'listing.update'
     or p_new->>'operation' <> 'listing.update'
     or (p_old->>'attempt_count')::integer <> 0
     or (p_new->>'attempt_count')::integer <> 1
     or p_old->'worker_token_id' <> 'null'::jsonb
     or p_old->'claim_token' <> 'null'::jsonb
     or p_old->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'worker_token_id' = 'null'::jsonb
     or p_new->'claim_token' = 'null'::jsonb
     or p_new->'completed_at' <> 'null'::jsonb
     or p_new->'response_payload' <> 'null'::jsonb
     or p_new->'error_message' <> 'null'::jsonb
     or (p_new->>'lease_expires_at')::timestamptz <= statement_timestamp()
     or p_new-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
        is distinct from
        p_old-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
  then return false; end if;
  v_job_id := (p_new->>'id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = (p_new->>'worker_token_id')::uuid,
         bound_claim_token = (p_new->>'claim_token')::uuid
   where permit.update_job_id = v_job_id
     and permit.update_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.channel = 'temu'
     and permit.listing_id = (p_new->>'listing_id')::uuid
     and permit.credential_id = (p_new->>'credential_id')::uuid
     and permit.seller_account_key = p_new->>'seller_account_key'
     and permit.request_fingerprint = p_new->>'request_fingerprint'
     and permit.request_payload_sha256 = encode(extensions.digest(
           (p_new->'request_payload')::text, 'sha256'
         ), 'hex')
     and permit.request_payload_bytes = octet_length(
           (p_new->'request_payload')::text
         )
     and permit.snapshot_payload_sha256 = p_new#>>
           '{request_payload,arguments,sellerpilotTemuExactExistingUpdate,approvedManifestDigest}'
     and permit.invalidated_at is null and permit.consumed_at is null
     and permit.bound_at is null and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           'temu', p_new->'request_payload'->'arguments', permit.release_sha,
           permit.request_fingerprint, permit.stock
         );
  return found;
exception when others then
  return false;
end;
$$;

create or replace function sellerpilot_private.exact_existing_update_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id and permit.channel = 'temu'
  ) then exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.update_job_id
     where permit.update_job_id = p_job_id
       and permit.channel = 'temu'
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_at is not null and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
             permit.permit_id
           )
       and job.status = 'running' and job.channel = 'temu'
       and job.operation = 'listing.update' and job.environment = 'production'
       and job.claim_token = p_claim_token and job.attempt_count = 1
       and job.started_at is not null
       and job.lease_expires_at > statement_timestamp()
       and job.completed_at is null and job.response_payload is null
       and job.error_message is null
       and job.provider_mutation_started_at is null
       and job.attempt_id = permit.update_attempt_id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and permit.arguments_sha256 = encode(extensions.digest(
             (job.request_payload->'arguments')::text, 'sha256'
           ), 'hex')
       and permit.request_payload_sha256 = encode(extensions.digest(
             job.request_payload::text, 'sha256'
           ), 'hex')
       and permit.snapshot_payload_sha256 = job.request_payload#>>
             '{arguments,sellerpilotTemuExactExistingUpdate,approvedManifestDigest}'
       and job.request_payload#>>
             '{arguments,sellerpilotTemuExactExistingUpdate,listingId}' =
             permit.listing_id::text
       and job.request_payload#>>
             '{arguments,sellerpilotTemuExactExistingUpdate,credentialId}' =
             permit.credential_id::text
       and job.request_payload#>>
             '{arguments,sellerpilotTemuExactExistingUpdate,sellerAccountKey}' =
             permit.seller_account_key
       and sellerpilot_private.exact_existing_update_arguments_valid(
             'temu', job.request_payload->'arguments', permit.release_sha,
             permit.request_fingerprint, permit.stock
           )
  ) else sellerpilot_private.exact_existing_update_provider_before_temu_173960(
    p_job_id, p_claim_token
  ) end
$$;

create or replace function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_channel = 'temu' and p_operation = 'listing.update' then true
    else sellerpilot_private.serverless_gateway_job_allowed_before_temu_173960(
      p_channel, p_operation
    )
  end
$$;

revoke all on function
  sellerpilot_private.exact_existing_update_arguments_valid(
    text, jsonb, text, text, integer
  ),
  sellerpilot_private.exact_existing_update_release_is_current(text, text),
  sellerpilot_private.exact_existing_update_lineage_is_current(uuid),
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid),
  sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ),
  sellerpilot_private.bind_exact_existing_update_claim(jsonb, jsonb),
  sellerpilot_private.exact_existing_update_provider_allowed(uuid, uuid),
  sellerpilot_private.serverless_gateway_job_allowed(text, text)
  from public, anon, authenticated, service_role;

do $patch_temu_exact_enqueue_and_job_guard$
declare
  v_signature regprocedure;
  v_definition text;
  v_marker_anchor constant text :=
    'or coalesce(v_arguments ? ''sellerpilotEbayExactExistingQaRecovery'', false);';
  v_marker_replacement constant text :=
    'or coalesce(v_arguments ? ''sellerpilotEbayExactExistingQaRecovery'', false)'
    || E'\n    or coalesce(v_arguments ? ''sellerpilotTemuExactExistingUpdate'', false);';
  v_channel_anchor text;
  v_channel_replacement text;
begin
  foreach v_signature in array array[
    'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
    if (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_marker_anchor, ''))
    ) / pg_catalog.length(v_marker_anchor) <> 1 then
      raise exception 'Temu exact marker patch preimage drifted: %', v_signature
        using errcode = '55000';
    end if;
    v_definition := pg_catalog.replace(
      v_definition, v_marker_anchor, v_marker_replacement
    );
    v_channel_anchor :=
      'v_job.channel not in (''coupang'', ''elevenst'', ''ebay'')';
    v_channel_replacement :=
      'v_job.channel not in (''coupang'', ''elevenst'', ''ebay'', ''temu'')';
    if (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_channel_anchor, ''))
    ) / pg_catalog.length(v_channel_anchor) <> 1 then
      raise exception 'Temu exact channel patch preimage drifted: %', v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      v_definition, v_channel_anchor, v_channel_replacement
    );
  end loop;
end;
$patch_temu_exact_enqueue_and_job_guard$;

do $copy_listing_enqueue_before_temu_exact$
declare
  v_definition text;
  v_anchor constant text :=
    'public.sellerpilot_service_enqueue_listing_gateway_job(';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'Temu exact enqueue wrapper preimage drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition, v_anchor,
    'public.sellerpilot_173960_enqueue_before_temu_exact('
  );
end;
$copy_listing_enqueue_before_temu_exact$;

revoke all on function public.sellerpilot_173960_enqueue_before_temu_exact(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  if p_channel <> 'temu'
     or p_operation <> 'listing.update'
     or v_arguments#>>'{sellerpilotTemuExactExistingUpdate,contract}' <>
          'temu_exact_existing_active_content_update_v1'
  then
    return public.sellerpilot_173960_enqueue_before_temu_exact(
      p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
      p_request_payload
    );
  end if;
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917396001);
  select * into strict v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.channel = 'temu'
     and permit.listing_id = p_listing_id
     and permit.credential_id = p_credential_id
     and permit.update_job_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and permit.snapshot_payload_sha256 = v_arguments#>>
           '{sellerpilotTemuExactExistingUpdate,approvedManifestDigest}'
     and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,listingId}' =
           permit.listing_id::text
     and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,credentialId}' =
           permit.credential_id::text
     and v_arguments#>>'{sellerpilotTemuExactExistingUpdate,sellerAccountKey}' =
           permit.seller_account_key
     and exists (
       select 1 from sellerpilot_private.product_listings listing
        where listing.id = permit.listing_id
          and listing.remote_resources#>>'{resources,externalGoodsId}' =
                v_arguments#>>'{sellerpilotTemuExactExistingUpdate,externalGoodsId}'
          and listing.remote_resources#>>'{resources,externalSkuId}' =
                v_arguments#>>'{sellerpilotTemuExactExistingUpdate,externalSkuId}'
     )
     and sellerpilot_private.exact_existing_update_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           'temu', v_arguments, permit.release_sha,
           permit.request_fingerprint, permit.stock
         )
     and exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = p_attempt_id
          and attempt.owner_id = permit.owner_id
          and attempt.credential_id = permit.credential_id
          and attempt.channel = 'temu'
          and attempt.operation = 'listing.update'
          and attempt.status = 'running'
          and attempt.seller_account_key = permit.seller_account_key
          and attempt.request_fingerprint = permit.request_fingerprint
     )
   for update;
  v_result := public.sellerpilot_173960_enqueue_before_temu_exact(
    p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
    p_request_payload
  );
  if coalesce(v_result->>'job_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_result->>'status' <> 'queued' then
    raise exception 'Temu exact update job not newly queued'
      using errcode = '55000';
  end if;
  v_job_id := (v_result->>'job_id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set update_job_id = v_job_id,
         update_attempt_id = p_attempt_id,
         arguments_sha256 = encode(
           extensions.digest(v_arguments::text, 'sha256'), 'hex'
         ),
         arguments_bytes = octet_length(v_arguments::text),
         request_payload_sha256 = encode(
           extensions.digest(p_request_payload::text, 'sha256'), 'hex'
         ),
         request_payload_bytes = octet_length(p_request_payload::text)
   where permit.permit_id = v_permit.permit_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = v_job_id and job.attempt_id = p_attempt_id
          and job.listing_id = permit.listing_id
          and job.credential_id = permit.credential_id
          and job.channel = 'temu' and job.operation = 'listing.update'
          and job.environment = 'production' and job.status = 'queued'
          and job.attempt_count = 0
          and job.seller_account_key = permit.seller_account_key
          and job.request_fingerprint = permit.request_fingerprint
          and job.request_payload = p_request_payload
          and job.provider_mutation_started_at is null
          and job.response_payload is null and job.completed_at is null
     );
  if not found then
    raise exception 'Temu exact update job binding failed' using errcode = '55000';
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

do $copy_temu_remote_resources_predecessor$
declare
  v_definition text;
  v_anchor constant text :=
    'sellerpilot_private.temu_remote_resources_from_job(';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.temu_remote_resources_from_job(uuid)'::regprocedure
  ) into strict v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'Temu remote resources preimage drifted' using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition,
    v_anchor,
    'sellerpilot_private.temu_remote_resources_before_exact_173960('
  );
end;
$copy_temu_remote_resources_predecessor$;

revoke all on function
  sellerpilot_private.temu_remote_resources_before_exact_173960(uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.temu_remote_resources_from_job(
  p_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = p_job_id and permit.channel = 'temu'
  ) then (
    select jsonb_build_object(
      'resources', jsonb_build_object(
        'goodsId', job.response_payload#>>'{remoteState,resources,goodsId}',
        'skuId', job.response_payload#>>'{remoteState,resources,skuId}',
        'externalGoodsId', job.response_payload#>>
          '{remoteState,resources,externalGoodsId}',
        'externalSkuId', job.response_payload#>>
          '{remoteState,resources,externalSkuId}'
      ),
      'verification', jsonb_build_object(
        'contract', 'temu_exact_existing_active_content_update_v1',
        'jobId', job.id,
        'verifiedAt', job.response_payload#>>'{remoteState,verifiedAt}',
        'evidence', job.response_payload#>'{remoteState,evidence}',
        'locale', job.response_payload#>>'{remoteState,locale}',
        'fingerprint', job.response_payload#>>'{remoteState,fingerprint}',
        'imageCount', (job.response_payload#>>'{remoteState,imageCount}')::integer,
        'currency', 'KRW', 'price', 5000, 'stock', 1,
        'representativeImageCount', 1, 'detailImageCount', 8
      )
    ) from sellerpilot_private.channel_gateway_jobs job where job.id = p_job_id
  ) else sellerpilot_private.temu_remote_resources_before_exact_173960(p_job_id)
  end
$$;

revoke all on function sellerpilot_private.temu_remote_resources_from_job(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.temu_exact_update_response_valid(
  p_job_id uuid,
  p_response jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_verified_at timestamptz;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.update_job_id = job.id
     and permit.channel = 'temu'
     and permit.consumed_at is not null
     and (
       (job.status = 'running'
         and permit.bound_worker_token_id = job.worker_token_id
         and permit.bound_claim_token = job.claim_token)
       or (job.status = 'succeeded' and exists (
         select 1
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = job.id
            and receipt.worker_token_id = permit.bound_worker_token_id
            and receipt.claim_token = permit.bound_claim_token
       ))
     )
   where job.id = p_job_id
     and job.channel = 'temu' and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.provider_mutation_started_at is not null
     and (
       (job.status = 'running' and job.completed_at is null
         and job.response_payload is null)
       or (job.status = 'succeeded' and job.completed_at is not null
         and job.response_payload = p_response)
     );
  if not found or jsonb_typeof(p_response) <> 'object' then return false; end if;
  begin
    v_verified_at := (p_response#>>'{remoteState,verifiedAt}')::timestamptz;
  exception when others then return false; end;
  return p_response->>'ok' = 'true'
    and p_response->>'channel' = 'temu'
    and p_response->>'operation' = 'listing.update'
    and p_response->>'publicationIntent' = 'live'
    and (
      p_response->>'publicationFulfilled' = 'true'
      or v_job.status = 'succeeded'
    )
    and p_response->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_response->>'remoteId' = '608570473054515'
    and p_response#>>'{remoteState,verified}' = 'true'
    and (
      p_response#>>'{remoteState,visibility}' = 'live'
      or (
        v_job.status = 'succeeded'
        and p_response#>>'{remoteState,visibility}' = 'pending_review'
        and p_response#>>'{remoteState,evidence,providerObservedVisibility}' =
              'live'
      )
    )
    and p_response#>>'{remoteState,providerStatus}' =
          'statusName=ACTIVE;goodsStatus=ACTIVE'
    and p_response#>>'{remoteState,locale}' = 'ko-KR'
    and p_response#>>'{remoteState,fingerprint}' = v_job.request_fingerprint
    and p_response#>>'{remoteState,resources,goodsId}' = '608570473054515'
    and p_response#>>'{remoteState,resources,skuId}' = '123896921649274'
    and p_response#>>'{remoteState,resources,externalGoodsId}' =
          v_job.request_payload#>>
            '{arguments,sellerpilotTemuExactExistingUpdate,externalGoodsId}'
    and p_response#>>'{remoteState,resources,externalSkuId}' =
          v_job.request_payload#>>
            '{arguments,sellerpilotTemuExactExistingUpdate,externalSkuId}'
    and p_response#>>'{remoteState,imageCount}' = '8'
    and p_response#>>'{remoteState,evidence,version}' =
          'temu_list_status_detail_stock_v3'
    and p_response#>'{remoteState,evidence,readbackMethods}' =
          '["temu.local.goods.list.retrieve","bg.local.goods.publish.status.get","bg.local.goods.detail.query","temu.local.goods.sku.stock.query"]'::jsonb
    and not exists (
      select 1 from (values
        ('identityVerified'), ('statusVerified'), ('localeVerified'),
        ('fingerprintVerified'), ('representativeImageVerified'),
        ('imageCountVerified'), ('imageOrderVerified'), ('contentVerified'),
        ('skuIdentityVerified'), ('priceVerified'), ('stockVerified'),
        ('goodsIdVerified'), ('externalGoodsIdVerified')
      ) expected(key)
      where p_response#>>array['remoteState','evidence',expected.key] <> 'true'
    )
    and p_response#>>'{remoteState,evidence,contentDigest}' =
          v_job.request_payload#>>
            '{arguments,sellerpilotTemuPartialUpdate,contentDigest}'
    and p_response#>>'{remoteState,evidence,observedRepresentativeImageCount}' = '1'
    and p_response#>>'{remoteState,evidence,representativeImageDigest}' = (
      select encode(extensions.digest(
        '[' || string_agg(
          pg_catalog.to_json(image_url)::text, ',' order by ordinal
        ) || ']', 'sha256'
      ), 'hex')
        from jsonb_array_elements_text(
          v_job.request_payload#>'{arguments,body,goodsBasic,goodsCarouselImage}'
        ) with ordinality as representative(image_url, ordinal)
    )
    and p_response#>>'{remoteState,evidence,observedDetailImageCount}' = '8'
    and p_response#>>'{remoteState,evidence,orderedDetailImageDigest}' = (
      select encode(extensions.digest(
        '[' || string_agg(
          pg_catalog.to_json(image_url)::text, ',' order by ordinal
        ) || ']', 'sha256'
      ), 'hex')
        from jsonb_array_elements_text(
          v_job.request_payload#>'{arguments,body,goodsBasic,detailImage}'
        ) with ordinality as detail(image_url, ordinal)
    )
    and p_response#>>'{remoteState,evidence,observedSkuCount}' = '1'
    and v_verified_at >= v_job.provider_mutation_started_at
    and v_verified_at <= clock_timestamp() + interval '5 minutes';
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.temu_exact_update_response_valid(uuid,jsonb)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.temu_server_owned_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_job_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
  v_allowed text[] := array[
    'remote_id', 'status', 'requested_publication_intent', 'remote_visibility',
    'provider_status', 'remote_resources', 'remote_created_at', 'published_at',
    'last_verified_at', 'last_error', 'failure_class', 'operation_attempt_id',
    'updated_at'
  ];
begin
  if p_job_id !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id::uuid;
  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.update_job_id = v_job.id and permit.channel = 'temu';
  if not found then
    return sellerpilot_private.temu_listing_update_allowed_before_exact_173960(
      p_old, p_new, p_job_id
    );
  end if;
  if jsonb_typeof(p_old) <> 'object' or jsonb_typeof(p_new) <> 'object'
     or v_job.channel <> 'temu' or v_job.operation <> 'listing.update'
     or v_job.status not in ('succeeded', 'failed', 'reconciliation_required')
     or v_job.completed_at is null
     or (p_new - v_allowed) is distinct from (p_old - v_allowed)
     or p_new->>'id' is distinct from v_job.listing_id::text
     or p_new->>'seller_account_key' is distinct from v_job.seller_account_key
     or p_new->>'remote_id' <> '608570473054515'
     or p_new->>'requested_publication_intent' <> 'live'
     or p_new->>'operation_attempt_id' <> v_job.attempt_id::text
     or p_new#>>'{remote_resources,resources,goodsId}' <>
          '608570473054515'
     or p_new#>>'{remote_resources,resources,skuId}' <>
          '123896921649274'
     or p_new#>>'{remote_resources,resources,externalGoodsId}' <>
          v_job.request_payload#>>
            '{arguments,sellerpilotTemuExactExistingUpdate,externalGoodsId}'
     or p_new#>>'{remote_resources,resources,externalSkuId}' <>
          v_job.request_payload#>>
            '{arguments,sellerpilotTemuExactExistingUpdate,externalSkuId}'
  then return false; end if;
  if v_job.status = 'succeeded' then
    return sellerpilot_private.temu_exact_update_response_valid(
        v_job.id, v_job.response_payload
      )
      and v_permit.consumed_at is not null
      and p_new->>'status' = 'published'
      and p_new->>'remote_visibility' = 'live'
      and p_new->>'provider_status' =
            'statusName=ACTIVE;goodsStatus=ACTIVE'
      and p_new->'last_error' = 'null'::jsonb
      and p_new->'failure_class' = 'null'::jsonb;
  end if;
  return p_new->>'status' = 'failed'
    and p_new->>'failure_class' = 'external_action'
    and p_new->'last_error' <> 'null'::jsonb;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.temu_server_owned_listing_update_allowed(jsonb,jsonb,text)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_173960_complete_before_temu_exact;

revoke all on function public.sellerpilot_173960_complete_before_temu_exact(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_exact boolean := false;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  select exists (
       select 1
         from sellerpilot_private.exact_existing_update_permits permit
        where permit.update_job_id = p_job_id and permit.channel = 'temu'
     ) into v_exact;
  if p_status = 'succeeded'
     and v_exact
     and not sellerpilot_private.temu_exact_update_response_valid(
       p_job_id, p_response_payload
     )
  then
    raise exception 'invalid exact Temu update completion attestation'
      using errcode = '55000';
  end if;
  v_result := public.sellerpilot_173960_complete_before_temu_exact(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    p_error_message,p_credential_refresh,p_normalized_orders,
    p_normalized_inquiries,p_diagnostic
  );
  if v_exact and v_result->>'status' in ('completed','completed_replay') then
    select * into v_job
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = p_job_id and job.status = 'succeeded';
    if found then
      if not sellerpilot_private.temu_exact_update_response_valid(
        p_job_id, v_job.response_payload
      ) then
        raise exception 'persisted exact Temu update attestation invalid'
          using errcode = '55000';
      end if;
      perform pg_catalog.set_config(
        'sellerpilot.temu_publication_apply', p_job_id::text, true
      );
      update sellerpilot_private.product_listings listing
         set remote_id = '608570473054515',
             status = 'published',
             requested_publication_intent = 'live',
             remote_visibility = 'live',
             provider_status =
               v_job.response_payload#>>'{remoteState,providerStatus}',
             remote_resources =
               sellerpilot_private.temu_remote_resources_from_job(p_job_id),
             published_at = coalesce(
               listing.published_at,
               (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz
             ),
             last_verified_at =
               (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,
             last_error = null,
             failure_class = null,
             operation_attempt_id = v_job.attempt_id,
             updated_at = clock_timestamp()
       where listing.id = v_job.listing_id;
      if not found then
        raise exception 'exact Temu update listing projection failed'
          using errcode = '55000';
      end if;
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

do $temu_exact_update_postimage$
declare
  v_name text;
  v_definition text;
  v_signature regprocedure;
begin
  foreach v_name in array array[
    'sellerpilot_service_get_temu_exact_update_id',
    'sellerpilot_service_arm_temu_exact_update'
  ] loop
    if octet_length(v_name) > 63 then
      raise exception 'Temu public RPC exceeds PostgreSQL identifier limit'
        using errcode = '55000';
    end if;
  end loop;
  if not sellerpilot_private.serverless_gateway_job_allowed(
       'temu', 'listing.update'
     )
     or sellerpilot_private.temu_exact_update_arguments_valid(
          '{}'::jsonb, repeat('a', 40), repeat('b', 64), 1
        )
     or exists (
       select 1
         from (values
           ('public'::name), ('anon'::name), ('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'sellerpilot_private.temu_exact_update_arguments_valid(jsonb,text,text,integer)',
          'EXECUTE'
        )
     )
  then
    raise exception 'Temu exact private fence postimage invalid'
      using errcode = '55000';
  end if;

  foreach v_signature in array array[
    'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)'::regprocedure,
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure,
    'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'::regprocedure
  ] loop
    if exists (
      select 1 from (values
        ('public'::name), ('anon'::name), ('authenticated'::name),
        ('service_role'::name)
      ) role(role_name)
      where pg_catalog.has_function_privilege(
        role.role_name, v_signature, 'EXECUTE'
      )
    ) then
      raise exception 'Temu enqueued-lineage private ACL postimage invalid'
        using errcode = '55000';
    end if;
    select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
    if v_signature::text not like
         '%exact_existing_update_enqueued_lineage_is_current%'
       and (
         pg_catalog.strpos(
           v_definition,
           'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current('
         ) = 0
         or pg_catalog.strpos(
           v_definition,
           'sellerpilot_private.exact_existing_update_lineage_is_current('
         ) > 0
       )
    then
      raise exception 'Temu enqueued-lineage consumer postimage invalid'
        using errcode = '55000';
    end if;
  end loop;

  if exists (
    select 1 from (values
      ('public'::name), ('anon'::name), ('authenticated'::name),
      ('service_role'::name)
    ) role(role_name)
    where pg_catalog.has_function_privilege(
      role.role_name,
      'sellerpilot_private.temu_exact_update_response_valid(uuid,jsonb)'::regprocedure,
      'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      role.role_name,
      'public.sellerpilot_173960_complete_before_temu_exact(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
      'EXECUTE'
    )
  ) then
    raise exception 'Temu exact completion private ACL postimage invalid'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.temu_exact_update_response_valid(uuid,jsonb)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition, 'gateway_completion_receipts') = 0
     or pg_catalog.strpos(v_definition, 'contentDigest') = 0
     or pg_catalog.strpos(v_definition, 'representativeImageDigest') = 0
     or pg_catalog.strpos(v_definition, 'orderedDetailImageDigest') = 0
  then
    raise exception 'Temu exact completion attestation postimage invalid'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.temu_exact_update_response_valid('
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'public.sellerpilot_173960_complete_before_temu_exact('
     ) = 0
     or not exists (
       select 1 from pg_catalog.pg_proc procedure
        where procedure.oid =
          'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
          and procedure.prosecdef
          and procedure.proconfig = array['search_path=""']::text[]
          and not pg_catalog.has_function_privilege('public',procedure.oid,'EXECUTE')
          and not pg_catalog.has_function_privilege('anon',procedure.oid,'EXECUTE')
          and not pg_catalog.has_function_privilege('authenticated',procedure.oid,'EXECUTE')
          and pg_catalog.has_function_privilege('service_role',procedure.oid,'EXECUTE')
     )
  then
    raise exception 'Temu exact completion wrapper postimage invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname in (
         'sellerpilot_service_get_temu_exact_update_id',
         'sellerpilot_service_arm_temu_exact_update'
       )
       and (
         not procedure.prosecdef
         or procedure.proconfig is distinct from array['search_path=""']::text[]
         or pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
       )
  ) or (
    select count(*) from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'sellerpilot_service_get_temu_exact_update_id',
        'sellerpilot_service_arm_temu_exact_update'
      )
  ) <> 2 then
    raise exception 'Temu exact public RPC ACL postimage invalid'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilotTemuExactExistingUpdate') = 0
     or pg_catalog.strpos(
          v_definition,
          'v_job.channel not in (''coupang'', ''elevenst'', ''ebay'', ''temu'')'
        ) = 0 then
    raise exception 'Temu exact job guard postimage invalid'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into strict v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilotTemuExactExistingUpdate') = 0
     or pg_catalog.strpos(
          v_definition,
          'public.sellerpilot_173960_enqueue_before_temu_exact'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.exact_existing_update_lineage_is_current('
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current('
        ) = 0
     or pg_catalog.strpos(v_definition, 'Temu exact update job binding failed') = 0
  then
    raise exception 'Temu exact enqueue postimage invalid'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
           'sellerpilot_private.exact_existing_update_permits'::regclass
       and constraint_row.conname = 'exact_existing_update_permit_target_check'
       and constraint_row.convalidated
       and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
             '%608570473054515%'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
             '%123896921649274%'
  ) then
    raise exception 'Temu exact permit target postimage invalid'
      using errcode = '55000';
  end if;
end;
$temu_exact_update_postimage$;

comment on function public.sellerpilot_service_get_temu_exact_update_id(
  uuid, uuid, uuid, text, text
) is 'Returns only the provider-certified lineage of exact ACTIVE Temu goods 608570473054515 for a service-role update request.';
comment on function public.sellerpilot_service_arm_temu_exact_update(
  text, uuid, uuid, text, text
) is 'Arms one five-minute, current-runtime, exact-listing permit for a content-only Temu partial update; it does not call Temu.';

commit;
