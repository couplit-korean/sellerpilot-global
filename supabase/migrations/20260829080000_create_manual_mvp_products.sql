-- Create a draft product directly from seller-confirmed facts and preserved
-- source photographs. Manual intake shares the durable job ledger for lineage
-- and idempotency, but never enters or inflates the AI worker runtime.

begin;

alter table sellerpilot_private.ai_cli_jobs
  drop constraint if exists ai_cli_jobs_kind_check;
alter table sellerpilot_private.ai_cli_jobs
  add constraint ai_cli_jobs_kind_check check (
    kind in (
      'product_studio',
      'product_research',
      'support_reply',
      'product_asset_regeneration',
      'manual_product'
    )
  ) not valid;
alter table sellerpilot_private.ai_cli_jobs
  validate constraint ai_cli_jobs_kind_check;

create or replace function public.sellerpilot_create_manual_product_v1(
  p_id uuid,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_manual jsonb;
  v_existing_job sellerpilot_private.ai_cli_jobs%rowtype;
  v_job_exists boolean := false;
  v_product_id uuid;
  v_image_count integer;
  v_stock integer;
begin
  if v_actor_id is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_id is null
     or jsonb_typeof(p_request_payload) is distinct from 'object'
     or pg_catalog.octet_length(p_request_payload::text) > 131072 then
    raise exception 'invalid manual product payload' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:manual-product:' || p_id::text)
  );

  select job.*
    into v_existing_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id
   for update;
  v_job_exists := found;

  if v_job_exists then
    if v_existing_job.created_by is distinct from v_actor_id then
      raise exception 'manual product request belongs to another owner'
        using errcode = '42501';
    end if;
    if v_existing_job.kind is distinct from 'manual_product'
       or v_existing_job.request_payload is distinct from p_request_payload
       or v_existing_job.status is distinct from 'succeeded'
       or v_existing_job.result_payload is distinct from '{"mode":"manual_mvp"}'::jsonb
       or v_existing_job.error_message is not null
       or v_existing_job.attempt_count <> 0
       or v_existing_job.preparation_failure_count <> 0
       or v_existing_job.worker_token_id is not null
       or v_existing_job.claim_token is not null
       or v_existing_job.lease_expires_at is not null
       or v_existing_job.started_at is not null
       or v_existing_job.completed_at is null then
      raise exception 'manual product request idempotency mismatch'
        using errcode = '22023';
    end if;

    select product.id
      into v_product_id
      from sellerpilot_private.products product
     where product.ai_job_id = p_id
       and product.owner_id = v_actor_id
       and not product.demo;
    if found then
      return v_product_id;
    end if;
  end if;

  if exists (
    select 1
      from sellerpilot_private.products product
     where product.ai_job_id = p_id
       and (product.owner_id is distinct from v_actor_id or product.demo)
  ) then
    raise exception 'manual product lineage ownership mismatch'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_request_payload) payload_key
     where payload_key not in (
       'description', 'product_url', 'research_input', 'manual_fields',
       'competitor_context', 'image_paths', 'image_specs'
     )
  )
     or not (p_request_payload ?& array[
       'description', 'product_url', 'research_input', 'manual_fields',
       'image_paths', 'image_specs'
     ])
     or jsonb_typeof(p_request_payload->'description') is distinct from 'string'
     or jsonb_typeof(p_request_payload->'product_url') is distinct from 'string'
     or jsonb_typeof(p_request_payload->'research_input') is distinct from 'string'
     or jsonb_typeof(p_request_payload->'manual_fields') is distinct from 'object'
     or jsonb_typeof(p_request_payload->'image_paths') is distinct from 'array'
     or jsonb_typeof(p_request_payload->'image_specs') is distinct from 'array'
     or (
       p_request_payload ? 'competitor_context'
       and jsonb_typeof(p_request_payload->'competitor_context') is distinct from 'object'
     ) then
    raise exception 'invalid manual product payload shape' using errcode = '22023';
  end if;

  v_manual := p_request_payload->'manual_fields';

  if exists (
    select 1
      from jsonb_object_keys(v_manual) manual_key
     where manual_key not in (
       'researchInput', 'productName', 'sellerSku', 'categoryHint',
       'brandName', 'manufacturer', 'countryOfOrigin', 'material',
       'packageContents', 'condition', 'gtinStatus', 'gtin',
       'sellingPrice', 'currency', 'stock', 'weightKg',
       'packageLengthCm', 'packageWidthCm', 'packageHeightCm',
       'shippingFeeKrw', 'shippingRule', 'packagingRule', 'description',
       'productUrl', 'imageRightsConfirmed', 'productFactsConfirmed'
     )
  )
     or not (v_manual ?& array[
       'researchInput', 'productName', 'sellerSku', 'categoryHint',
       'brandName', 'manufacturer', 'countryOfOrigin', 'material',
       'packageContents', 'condition', 'gtinStatus', 'gtin',
       'sellingPrice', 'currency', 'stock', 'weightKg',
       'packageLengthCm', 'packageWidthCm', 'packageHeightCm',
       'shippingFeeKrw', 'shippingRule', 'packagingRule', 'description',
       'productUrl', 'imageRightsConfirmed', 'productFactsConfirmed'
     ])
     or exists (
       select 1
         from jsonb_each(v_manual) field(key, value)
        where (
          field.key in (
            'researchInput', 'productName', 'sellerSku', 'categoryHint',
            'brandName', 'manufacturer', 'countryOfOrigin', 'material',
            'packageContents', 'condition', 'gtinStatus', 'gtin', 'currency',
            'shippingRule', 'packagingRule', 'description', 'productUrl'
          )
          and jsonb_typeof(field.value) is distinct from 'string'
        ) or (
          field.key in (
            'sellingPrice', 'stock', 'weightKg', 'packageLengthCm',
            'packageWidthCm', 'packageHeightCm', 'shippingFeeKrw'
          )
          and jsonb_typeof(field.value) is distinct from 'number'
        ) or (
          field.key in ('imageRightsConfirmed', 'productFactsConfirmed')
          and jsonb_typeof(field.value) is distinct from 'boolean'
        )
     ) then
    raise exception 'invalid manual product fields' using errcode = '22023';
  end if;

  if length(trim(v_manual->>'researchInput')) not between 2 and 12000
     or length(trim(v_manual->>'productName')) not between 2 and 160
     or trim(v_manual->>'sellerSku') !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(v_manual->>'categoryHint')) not between 2 and 120
     or length(trim(v_manual->>'brandName')) not between 1 and 120
     or length(trim(v_manual->>'manufacturer')) not between 1 and 160
     or length(trim(v_manual->>'countryOfOrigin')) not between 2 and 80
     or length(trim(v_manual->>'material')) not between 2 and 500
     or length(trim(v_manual->>'packageContents')) not between 2 and 500
     or v_manual->>'condition' not in ('NEW', 'USED', 'REFURBISHED')
     or v_manual->>'gtinStatus' not in ('HAS_GTIN', 'NO_GTIN')
     or (
       v_manual->>'gtinStatus' = 'HAS_GTIN'
       and v_manual->>'gtin' !~ '^[0-9]{8,14}$'
     )
     or (
       v_manual->>'gtinStatus' = 'NO_GTIN'
       and v_manual->>'gtin' <> ''
     )
     or (v_manual->>'sellingPrice')::numeric <= 0
     or v_manual->>'currency' not in (
       'KRW', 'JPY', 'USD', 'SGD', 'MYR', 'PHP', 'VND', 'THB',
       'TWD', 'BRL', 'MXN', 'IDR', 'EUR'
     )
     or (v_manual->>'stock')::numeric <> pg_catalog.trunc((v_manual->>'stock')::numeric)
     or (v_manual->>'stock')::numeric not between 1 and 999999
     or (v_manual->>'weightKg')::numeric <= 0
     or (v_manual->>'weightKg')::numeric > 1000
     or (v_manual->>'packageLengthCm')::numeric <= 0
     or (v_manual->>'packageLengthCm')::numeric > 10000
     or (v_manual->>'packageWidthCm')::numeric <= 0
     or (v_manual->>'packageWidthCm')::numeric > 10000
     or (v_manual->>'packageHeightCm')::numeric <= 0
     or (v_manual->>'packageHeightCm')::numeric > 10000
     or (v_manual->>'shippingFeeKrw')::numeric not between 0 and 100000000
     or length(v_manual->>'shippingRule') > 1000
     or length(v_manual->>'packagingRule') > 1000
     or length(trim(v_manual->>'description')) not between 20 and 4000
     or length(trim(v_manual->>'productUrl')) > 1000
     or (
       v_manual->>'productUrl' <> ''
       and v_manual->>'productUrl' !~* '^https?://'
     )
     or (v_manual->'imageRightsConfirmed')::boolean is not true
     or (v_manual->'productFactsConfirmed')::boolean is not true
     or v_manual->>'researchInput' is distinct from trim(v_manual->>'researchInput')
     or v_manual->>'productName' is distinct from trim(v_manual->>'productName')
     or v_manual->>'sellerSku' is distinct from trim(v_manual->>'sellerSku')
     or v_manual->>'categoryHint' is distinct from trim(v_manual->>'categoryHint')
     or v_manual->>'brandName' is distinct from trim(v_manual->>'brandName')
     or v_manual->>'manufacturer' is distinct from trim(v_manual->>'manufacturer')
     or v_manual->>'countryOfOrigin' is distinct from trim(v_manual->>'countryOfOrigin')
     or v_manual->>'material' is distinct from trim(v_manual->>'material')
     or v_manual->>'packageContents' is distinct from trim(v_manual->>'packageContents')
     or v_manual->>'shippingRule' is distinct from trim(v_manual->>'shippingRule')
     or v_manual->>'packagingRule' is distinct from trim(v_manual->>'packagingRule')
     or v_manual->>'description' is distinct from trim(v_manual->>'description')
     or v_manual->>'productUrl' is distinct from trim(v_manual->>'productUrl')
     or concat_ws(' ',
       v_manual->>'brandName',
       v_manual->>'manufacturer',
       v_manual->>'countryOfOrigin',
       v_manual->>'material',
       v_manual->>'packageContents'
     ) ~* '(확인[[:space:]]*필요|미확인|알[[:space:]]*수[[:space:]]*없|unknown|not[[:space:]]+provided|n/?a)'
     or p_request_payload->>'description' is distinct from v_manual->>'description'
     or p_request_payload->>'product_url' is distinct from v_manual->>'productUrl'
     or p_request_payload->>'research_input' is distinct from v_manual->>'researchInput' then
    raise exception 'invalid manual product field values' using errcode = '22023';
  end if;

  if p_request_payload ? 'competitor_context' then
    if pg_catalog.octet_length((p_request_payload->'competitor_context')::text) > 65536
       or exists (
         select 1
           from jsonb_object_keys(p_request_payload->'competitor_context') context_key
          where context_key not in ('query', 'providerStatuses', 'candidates')
       )
       or not ((p_request_payload->'competitor_context') ?& array[
         'query', 'providerStatuses', 'candidates'
       ])
       or jsonb_typeof(p_request_payload->'competitor_context'->'query') is distinct from 'string'
       or jsonb_typeof(p_request_payload->'competitor_context'->'providerStatuses') is distinct from 'array'
       or jsonb_typeof(p_request_payload->'competitor_context'->'candidates') is distinct from 'array' then
      raise exception 'invalid competitor context' using errcode = '22023';
    end if;

    if length(trim(p_request_payload->'competitor_context'->>'query')) not between 1 and 160
       or p_request_payload->'competitor_context'->>'query' ~ '[<>]'
       or jsonb_array_length(p_request_payload->'competitor_context'->'providerStatuses') > 4
       or jsonb_array_length(p_request_payload->'competitor_context'->'candidates') > 24
       or exists (
         select 1
           from jsonb_array_elements(
             p_request_payload->'competitor_context'->'providerStatuses'
           ) provider_status
          where jsonb_typeof(provider_status) is distinct from 'object'
             or exists (
               select 1 from jsonb_object_keys(provider_status) status_key
                where status_key not in ('provider', 'status', 'count', 'marketplaces')
             )
             or not (provider_status ?& array['provider', 'status', 'count', 'marketplaces'])
             or jsonb_typeof(provider_status->'provider') is distinct from 'string'
             or jsonb_typeof(provider_status->'status') is distinct from 'string'
             or jsonb_typeof(provider_status->'count') is distinct from 'number'
             or jsonb_typeof(provider_status->'marketplaces') is distinct from 'array'
             or provider_status->>'provider' not in (
               'naver_shopping', 'elevenst_product_search', 'ebay_browse',
               'brave_marketplace_web'
             )
             or provider_status->>'status' not in (
               'searched', 'unavailable', 'failed', 'pending'
             )
             or (provider_status->>'count')::numeric
                  <> pg_catalog.trunc((provider_status->>'count')::numeric)
             or (provider_status->>'count')::numeric not between 0 and 100000
             or jsonb_array_length(provider_status->'marketplaces') > 9
             or exists (
               select 1 from jsonb_array_elements(provider_status->'marketplaces') marketplace
                where jsonb_typeof(marketplace) is distinct from 'string'
                   or marketplace #>> '{}' not in (
                     'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
                     'lazada', 'ebay', 'temu', 'other'
                   )
             )
       )
       or exists (
         select 1
           from jsonb_array_elements(
             p_request_payload->'competitor_context'->'candidates'
           ) candidate
          where jsonb_typeof(candidate) is distinct from 'object'
             or exists (
               select 1 from jsonb_object_keys(candidate) candidate_key
                where candidate_key not in (
                  'provider', 'marketplace', 'externalId', 'title', 'url',
                  'mallName', 'price', 'currency', 'verifiedSameProduct'
                )
             )
             or not (candidate ?& array[
               'provider', 'marketplace', 'externalId', 'title', 'url',
               'mallName', 'price', 'currency', 'verifiedSameProduct'
             ])
             or jsonb_typeof(candidate->'provider') is distinct from 'string'
             or jsonb_typeof(candidate->'marketplace') is distinct from 'string'
             or jsonb_typeof(candidate->'externalId') is distinct from 'string'
             or jsonb_typeof(candidate->'title') is distinct from 'string'
             or jsonb_typeof(candidate->'url') is distinct from 'string'
             or jsonb_typeof(candidate->'mallName') is distinct from 'string'
             or jsonb_typeof(candidate->'price') is distinct from 'number'
             or jsonb_typeof(candidate->'currency') is distinct from 'string'
             or jsonb_typeof(candidate->'verifiedSameProduct') is distinct from 'boolean'
             or candidate->>'provider' not in (
               'naver_shopping', 'elevenst_product_search', 'ebay_browse',
               'brave_marketplace_web'
             )
             or candidate->>'marketplace' not in (
               'smartstore', 'coupang', 'elevenst', 'qoo10', 'shopee',
               'lazada', 'ebay', 'temu', 'other'
             )
             or length(trim(candidate->>'externalId')) not between 1 and 500
             or length(trim(candidate->>'title')) not between 1 and 1000
             or length(trim(candidate->>'mallName')) not between 1 and 240
             or concat_ws(' ', candidate->>'externalId', candidate->>'title', candidate->>'mallName') ~ '[<>]'
             or length(candidate->>'url') not between 1 and 1000
             or candidate->>'url' !~ '^https://[^[:space:]]+$'
             or (candidate->>'price')::numeric <= 0
             or (candidate->>'price')::numeric > 1000000000000
             or candidate->>'currency' !~ '^[A-Z]{3}$'
             or (candidate->'verifiedSameProduct')::boolean is not true
       ) then
      raise exception 'invalid competitor context values' using errcode = '22023';
    end if;
  end if;

  v_image_count := jsonb_array_length(p_request_payload->'image_paths');
  if v_image_count not between 1 and 100
     or jsonb_array_length(p_request_payload->'image_specs') <> v_image_count
     or p_request_payload->'image_specs'->0->>'role' is distinct from 'main'
     or exists (
       select 1
         from jsonb_array_elements(p_request_payload->'image_paths')
                with ordinality path(value, ordinal)
        where jsonb_typeof(path.value) is distinct from 'string'
           or path.value #>> '{}' is distinct from (
             v_actor_id::text || '/' || p_id::text || '/input/'
             || pg_catalog.lpad(path.ordinal::text, 3, '0') || '.jpg'
           )
     )
     or exists (
       select 1
         from jsonb_array_elements(p_request_payload->'image_specs')
                with ordinality spec(value, ordinal)
        where jsonb_typeof(spec.value) is distinct from 'object'
           or exists (
             select 1 from jsonb_object_keys(spec.value) spec_key
              where spec_key not in (
                'name', 'role', 'originalWidth', 'originalHeight', 'width',
                'height', 'bytes', 'mediaType', 'fit', 'originalName',
                'originalBytes', 'originalMediaType', 'originalPath'
              )
           )
           or not (spec.value ?& array[
             'name', 'role', 'originalWidth', 'originalHeight', 'width',
             'height', 'bytes', 'mediaType', 'fit', 'originalName',
             'originalBytes', 'originalMediaType', 'originalPath'
           ])
           or exists (
             select 1 from jsonb_each(spec.value) spec_field(key, field_value)
              where (
                spec_field.key in (
                  'name', 'role', 'mediaType', 'fit', 'originalName',
                  'originalMediaType', 'originalPath'
                )
                and jsonb_typeof(spec_field.field_value) is distinct from 'string'
              ) or (
                spec_field.key in (
                  'originalWidth', 'originalHeight', 'width', 'height',
                  'bytes', 'originalBytes'
                )
                and jsonb_typeof(spec_field.field_value) is distinct from 'number'
              )
           )
     ) then
    raise exception 'invalid manual product images' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_request_payload->'image_specs')
             with ordinality spec(value, ordinal)
     where length(trim(spec.value->>'name')) not between 1 and 240
        or length(trim(spec.value->>'role')) not between 1 and 40
        or (spec.value->>'originalWidth')::numeric
             <> pg_catalog.trunc((spec.value->>'originalWidth')::numeric)
        or (spec.value->>'originalHeight')::numeric
             <> pg_catalog.trunc((spec.value->>'originalHeight')::numeric)
        or (spec.value->>'width')::numeric <> 1200
        or (spec.value->>'height')::numeric <> 1200
        or (spec.value->>'bytes')::numeric
             <> pg_catalog.trunc((spec.value->>'bytes')::numeric)
        or (spec.value->>'originalBytes')::numeric
             <> pg_catalog.trunc((spec.value->>'originalBytes')::numeric)
        or (spec.value->>'originalWidth')::numeric not between 600 and 50000
        or (spec.value->>'originalHeight')::numeric not between 600 and 50000
        or (spec.value->>'originalWidth')::numeric
             * (spec.value->>'originalHeight')::numeric > 16000000
        or (spec.value->>'bytes')::numeric not between 1 and 3145728
        or spec.value->>'mediaType' is distinct from 'image/jpeg'
        or spec.value->>'fit' is distinct from 'contain'
        or length(trim(spec.value->>'originalName')) not between 1 and 240
        or (spec.value->>'originalBytes')::numeric not between 1 and 20971520
        or spec.value->>'originalMediaType' not in (
          'image/jpeg', 'image/png', 'image/webp'
        )
        or spec.value->>'originalPath' is distinct from (
          v_actor_id::text || '/' || p_id::text || '/original/'
          || pg_catalog.lpad(spec.ordinal::text, 3, '0') || '.source'
        )
  )
     or (
       select sum((spec->>'originalBytes')::numeric)
         from jsonb_array_elements(p_request_payload->'image_specs') spec
     ) > 209715200 then
    raise exception 'invalid manual product image values' using errcode = '22023';
  end if;

  if exists (
    select expected.name
      from (
        select path #>> '{}' as name
          from jsonb_array_elements(p_request_payload->'image_paths') path
        union all
        select spec->>'originalPath' as name
          from jsonb_array_elements(p_request_payload->'image_specs') spec
      ) expected
     where not exists (
       select 1
         from storage.objects stored
        where stored.bucket_id = 'sellerpilot-ai'
          and stored.name = expected.name
     )
  ) then
    raise exception 'manual product image object not found' using errcode = 'P0002';
  end if;

  v_stock := (v_manual->>'stock')::integer;

  if not v_job_exists then
    insert into sellerpilot_private.ai_cli_jobs (
      id, kind, status, request_payload, result_payload, error_message,
      attempt_count, preparation_failure_count, worker_token_id, claim_token,
      lease_expires_at, created_by, started_at, completed_at, updated_at
    ) values (
      p_id, 'manual_product', 'succeeded', p_request_payload,
      '{"mode":"manual_mvp"}'::jsonb, null,
      0, 0, null, null, null, v_actor_id, null, clock_timestamp(),
      clock_timestamp()
    );
  end if;

  insert into sellerpilot_private.products (
    id, owner_id, external_code, sku, name, description, source_url,
    ai_job_id, status, on_hand, reorder_point, product_facts, demo
  ) values (
    gen_random_uuid(),
    v_actor_id,
    'SP-MAN-' || pg_catalog.upper(pg_catalog.replace(p_id::text, '-', '')),
    pg_catalog.upper(v_manual->>'sellerSku'),
    v_manual->>'productName',
    v_manual->>'description',
    nullif(v_manual->>'productUrl', ''),
    p_id,
    'draft',
    v_stock,
    10,
    v_manual,
    false
  )
  on conflict (owner_id, ai_job_id) do nothing;

  select product.id
    into v_product_id
    from sellerpilot_private.products product
   where product.ai_job_id = p_id
     and product.owner_id = v_actor_id
     and not product.demo;
  if not found then
    raise exception 'manual product was not created' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from sellerpilot_private.operation_audit audit
     where audit.owner_id = v_actor_id
       and audit.action = 'manual_product_created'
       and audit.entity_type = 'product'
       and audit.entity_id = v_product_id::text
       and audit.safe_detail->>'job_id' = p_id::text
  ) then
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_actor_id,
      'manual_product_created',
      'product',
      v_product_id::text,
      jsonb_build_object(
        'job_id', p_id,
        'mode', 'manual_mvp',
        'seller_sku', v_manual->>'sellerSku',
        'image_count', v_image_count
      )
    );
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.sellerpilot_create_manual_product_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_create_manual_product_v1(uuid, jsonb)
  to authenticated;

-- A manual ledger row is terminal so existing readiness and activity readers
-- see a ready product, but it must never be represented as AI throughput.
create or replace function public.sellerpilot_ai_runtime_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'worker', (
      select jsonb_build_object(
        'label', token.label,
        'fingerprint', token.fingerprint,
        'scope', token.scope,
        'expires_at', token.expires_at,
        'last_seen_at', token.last_seen_at,
        'last_version', token.last_version
      )
      from sellerpilot_private.ai_cli_worker_tokens token
      where token.status = 'active'
        and token.expires_at > clock_timestamp()
        and token.scope in ('ai', 'legacy_combined')
      order by case when token.scope = 'ai' then 0 else 1 end,
               token.created_at desc
      limit 1
    ),
    'workers', coalesce((
      select jsonb_object_agg(worker.scope, worker.snapshot)
      from (
        select distinct on (token.scope)
          token.scope,
          jsonb_build_object(
            'label', token.label,
            'fingerprint', token.fingerprint,
            'expires_at', token.expires_at,
            'last_seen_at', token.last_seen_at,
            'last_version', token.last_version
          ) as snapshot
        from sellerpilot_private.ai_cli_worker_tokens token
        where token.status = 'active'
          and token.expires_at > clock_timestamp()
        order by token.scope, token.created_at desc
      ) worker
    ), '{}'::jsonb),
    'queued', (
      select count(*)
        from sellerpilot_private.ai_cli_jobs
       where status = 'queued'
         and kind <> 'manual_product'
    ),
    'running', (
      select count(*)
        from sellerpilot_private.ai_cli_jobs
       where status = 'running'
         and kind <> 'manual_product'
    ),
    'succeeded_today', (
      select count(*)
        from sellerpilot_private.ai_cli_jobs
       where status = 'succeeded'
         and kind <> 'manual_product'
         and completed_at >= date_trunc('day', clock_timestamp())
    ),
    'failed_today', (
      select count(*)
        from sellerpilot_private.ai_cli_jobs
       where status = 'failed'
         and kind <> 'manual_product'
         and completed_at >= date_trunc('day', clock_timestamp())
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_ai_runtime_status()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_ai_runtime_status()
  to authenticated;

-- Preserve the current publish-context chain and add content mode only after
-- checking the exact product/job owner and terminal result lineage.
do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_get_product_publish_context_pre_content_mode(uuid)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.sellerpilot_get_product_publish_context(uuid)'
    ) is null then
      raise exception 'product publish context function not found';
    end if;
    alter function public.sellerpilot_get_product_publish_context(uuid)
      rename to sellerpilot_get_product_publish_context_pre_content_mode;
  end if;
end;
$migration$;

create or replace function public.sellerpilot_get_product_publish_context(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_content_mode text;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  v_result := public.sellerpilot_get_product_publish_context_pre_content_mode(
    p_product_id
  );
  if v_result is null then
    return null;
  end if;

  select case
           when job.kind = 'manual_product'
            and job.status = 'succeeded'
            and job.result_payload = '{"mode":"manual_mvp"}'::jsonb
            and job.attempt_count = 0
            and job.worker_token_id is null
            and job.claim_token is null
            and job.lease_expires_at is null
             then 'manual_mvp'
           when job.kind = 'product_studio'
            and job.status = 'succeeded'
            and job.result_payload->>'mode' = 'cli'
             then 'ai_generated'
           else null
         end
    into v_content_mode
    from sellerpilot_private.products product
    join sellerpilot_private.ai_cli_jobs job
      on job.id = product.ai_job_id
     and job.created_by = product.owner_id
   where product.id = p_product_id
     and not product.demo
     and product.status <> 'archived';

  if v_content_mode is null then
    raise exception 'PRODUCT_CONTENT_LINEAGE_UNVERIFIED' using errcode = 'P0002';
  end if;

  return jsonb_set(
    v_result,
    '{contentMode}',
    to_jsonb(v_content_mode),
    true
  );
end;
$$;

revoke all on function
  public.sellerpilot_get_product_publish_context_pre_content_mode(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_get_product_publish_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;

commit;
