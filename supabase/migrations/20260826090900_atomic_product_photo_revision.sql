-- Replace a product's source and generated images through a fenced AI revision.
-- The existing product/listing identities stay untouched, no marketplace write
-- is enqueued, and the previous assets enter delayed cleanup only in the same
-- transaction that commits the new revision.

begin;

create table sellerpilot_private.product_ai_revisions (
  job_id uuid primary key references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
  product_id uuid not null references sellerpilot_private.products(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  base_ai_job_id uuid references sellerpilot_private.ai_cli_jobs(id) on delete set null,
  base_product_updated_at timestamptz not null,
  base_product_edit_fingerprint text not null
    check (base_product_edit_fingerprint ~ '^[0-9a-f]{32}$'),
  previous_ai_job_id uuid references sellerpilot_private.ai_cli_jobs(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'failed', 'cancelled')),
  previous_detail_page_data jsonb check (
    previous_detail_page_data is null
    or (
      jsonb_typeof(previous_detail_page_data) = 'object'
      and octet_length(previous_detail_page_data::text) <= 262144
    )
  ),
  previous_detail_page_version bigint not null default 0 check (previous_detail_page_version >= 0),
  previous_detail_page_updated_at timestamptz,
  retain_previous_assets_until timestamptz,
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create unique index product_ai_revisions_one_pending_idx
  on sellerpilot_private.product_ai_revisions(product_id)
  where status = 'pending';
create index product_ai_revisions_product_time_idx
  on sellerpilot_private.product_ai_revisions(product_id, created_at desc);
create index product_ai_revisions_owner_time_idx
  on sellerpilot_private.product_ai_revisions(owner_id, created_at desc);
create index product_ai_revisions_actor_time_idx
  on sellerpilot_private.product_ai_revisions(actor_user_id, created_at desc);
create index product_ai_revisions_base_job_idx
  on sellerpilot_private.product_ai_revisions(base_ai_job_id)
  where base_ai_job_id is not null;
create index product_ai_revisions_previous_job_idx
  on sellerpilot_private.product_ai_revisions(previous_ai_job_id)
  where previous_ai_job_id is not null;

alter table sellerpilot_private.product_ai_revisions enable row level security;
revoke all on sellerpilot_private.product_ai_revisions
  from public, anon, authenticated, service_role;

create table sellerpilot_private.product_ai_revision_abandoned_jobs (
  job_id uuid primary key,
  product_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index product_ai_revision_abandoned_actor_idx
  on sellerpilot_private.product_ai_revision_abandoned_jobs(actor_user_id);
alter table sellerpilot_private.product_ai_revision_abandoned_jobs enable row level security;
revoke all on sellerpilot_private.product_ai_revision_abandoned_jobs
  from public, anon, authenticated, service_role;

create function public.sellerpilot_create_product_revision_job(
  p_id uuid,
  p_product_id uuid,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_product sellerpilot_private.products%rowtype;
  v_manual jsonb := p_request_payload->'manual_fields';
  v_image_count integer;
  v_payload jsonb;
begin
  if v_actor_id is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_id is null
     or p_product_id is null
     or jsonb_typeof(p_request_payload) is distinct from 'object'
     or octet_length(p_request_payload::text) > 131072
     or jsonb_typeof(p_request_payload->'image_paths') is distinct from 'array'
     or jsonb_array_length(p_request_payload->'image_paths') not between 1 and 100
     or jsonb_typeof(p_request_payload->'image_specs') is distinct from 'array'
     or jsonb_array_length(p_request_payload->'image_specs')
          <> jsonb_array_length(p_request_payload->'image_paths')
     or jsonb_typeof(v_manual) is distinct from 'object'
     or length(trim(coalesce(v_manual->>'researchInput', ''))) not between 2 and 12000
     or length(trim(coalesce(v_manual->>'productName', ''))) not between 2 and 160
     or trim(coalesce(v_manual->>'sellerSku', '')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(v_manual->>'categoryHint', ''))) not between 2 and 120
     or length(trim(coalesce(v_manual->>'brandName', ''))) not between 1 and 120
     or length(trim(coalesce(v_manual->>'manufacturer', ''))) not between 1 and 160
     or length(trim(coalesce(v_manual->>'countryOfOrigin', ''))) not between 2 and 80
     or length(trim(coalesce(v_manual->>'material', ''))) not between 2 and 500
     or length(trim(coalesce(v_manual->>'packageContents', ''))) not between 2 and 500
     or coalesce(v_manual->>'condition', '') not in ('NEW', 'USED', 'REFURBISHED')
     or coalesce(v_manual->>'gtinStatus', '') not in ('HAS_GTIN', 'NO_GTIN')
     or (
       v_manual->>'gtinStatus' = 'HAS_GTIN'
       and coalesce(v_manual->>'gtin', '') !~ '^[0-9]{8,14}$'
     )
     or (
       v_manual->>'gtinStatus' = 'NO_GTIN'
       and coalesce(v_manual->>'gtin', '') <> ''
     )
     or length(trim(coalesce(v_manual->>'description', ''))) not between 20 and 4000
     or length(coalesce(v_manual->>'productUrl', '')) > 1000
     or (
       coalesce(v_manual->>'productUrl', '') <> ''
       and v_manual->>'productUrl' !~* '^https?://'
     )
     or jsonb_typeof(v_manual->'sellingPrice') is distinct from 'number'
     or (v_manual->>'sellingPrice')::numeric <= 0
     or coalesce(v_manual->>'currency', '') not in (
       'KRW', 'JPY', 'USD', 'SGD', 'MYR', 'PHP', 'VND', 'THB',
       'TWD', 'BRL', 'MXN', 'IDR', 'EUR'
     )
     or jsonb_typeof(v_manual->'stock') is distinct from 'number'
     or (v_manual->>'stock')::integer not between 0 and 999999
     or jsonb_typeof(v_manual->'weightKg') is distinct from 'number'
     or (v_manual->>'weightKg')::numeric <= 0
     or jsonb_typeof(v_manual->'packageLengthCm') is distinct from 'number'
     or (v_manual->>'packageLengthCm')::numeric <= 0
     or jsonb_typeof(v_manual->'packageWidthCm') is distinct from 'number'
     or (v_manual->>'packageWidthCm')::numeric <= 0
     or jsonb_typeof(v_manual->'packageHeightCm') is distinct from 'number'
     or (v_manual->>'packageHeightCm')::numeric <= 0
     or coalesce((v_manual->>'shippingFeeKrw')::numeric, -1) < 0
     or length(coalesce(v_manual->>'shippingRule', '')) > 1000
     or length(coalesce(v_manual->>'packagingRule', '')) > 1000
     or coalesce((v_manual->>'imageRightsConfirmed')::boolean, false) is not true
     or coalesce((v_manual->>'productFactsConfirmed')::boolean, false) is not true then
    raise exception 'invalid product revision payload';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:product-revision:' || p_id::text)
  );
  if exists (
    select 1 from sellerpilot_private.product_ai_revision_abandoned_jobs abandoned
     where abandoned.job_id = p_id
  ) then
    raise exception 'PRODUCT_REVISION_JOB_ABANDONED' using errcode = '23505';
  end if;

  v_image_count := jsonb_array_length(p_request_payload->'image_paths');
  if p_request_payload->'image_specs'->0->>'role' is distinct from 'main'
     or exists (
       select 1
         from jsonb_array_elements(p_request_payload->'image_paths') path
        where jsonb_typeof(path) is distinct from 'string'
           or length(path #>> '{}') not between 1 and 400
           or path #>> '{}' !~ (
             '^' || v_actor_id::text || '/' || p_id::text
             || '/input/[0-9]{3}\.jpg$'
           )
           or path #>> '{}' ~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
     )
     or (
       select count(*) from jsonb_array_elements_text(p_request_payload->'image_paths')
     ) <> (
       select count(distinct path)
         from jsonb_array_elements_text(p_request_payload->'image_paths') path
     )
     or exists (
       select 1
         from jsonb_array_elements(p_request_payload->'image_specs') spec
        where jsonb_typeof(spec) is distinct from 'object'
           or length(trim(coalesce(spec->>'name', ''))) not between 1 and 240
           or length(trim(coalesce(spec->>'role', ''))) not between 1 and 40
           or coalesce((spec->>'originalWidth')::integer, 0) not between 1 and 50000
           or coalesce((spec->>'originalHeight')::integer, 0) not between 1 and 50000
           or coalesce((spec->>'width')::integer, 0) <> 1200
           or coalesce((spec->>'height')::integer, 0) <> 1200
           or coalesce((spec->>'bytes')::integer, 0) not between 1 and 3145728
           or spec->>'mediaType' is distinct from 'image/jpeg'
           or spec->>'fit' is distinct from 'contain'
     ) then
    raise exception 'invalid product revision images';
  end if;

  select product.* into v_product
   from sellerpilot_private.products product
   where product.id = p_product_id
     and not product.demo
     and product.status <> 'archived'
   for update;
  if not found then
    raise exception 'PRODUCT_REVISION_PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_payload := p_request_payload || jsonb_build_object(
    'revision_product_id', p_product_id,
    'revision_base_ai_job_id', v_product.ai_job_id,
    'revision_base_product_updated_at', v_product.updated_at,
    'revision_mode', 'replace_product_assets',
    'auto_publish', false
  );
  if exists (
    select 1
      from sellerpilot_private.product_ai_revisions revision
      join sellerpilot_private.ai_cli_jobs job on job.id = revision.job_id
     where revision.job_id = p_id
       and revision.product_id = p_product_id
       and revision.actor_user_id = v_actor_id
       and revision.status in ('pending', 'applied')
       and job.kind = 'product_studio'
       and job.created_by = v_actor_id
       and (
         job.request_payload
           - 'revision_product_id'
           - 'revision_base_ai_job_id'
           - 'revision_base_product_updated_at'
           - 'revision_mode'
           - 'auto_publish'
       ) = p_request_payload
  ) then
    return p_id;
  end if;
  if exists (
    select 1 from sellerpilot_private.ai_cli_jobs job where job.id = p_id
  ) then
    raise exception 'PRODUCT_REVISION_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  if exists (
    select 1
      from sellerpilot_private.product_ai_revisions revision
     where revision.product_id = p_product_id
       and revision.status = 'pending'
  ) then
    raise exception 'PRODUCT_REVISION_ALREADY_PENDING' using errcode = '23505';
  end if;
  if exists (
    select 1
      from sellerpilot_private.products other_product
     where other_product.owner_id = v_product.owner_id
       and other_product.id <> p_product_id
       and other_product.sku = upper(trim(v_manual->>'sellerSku'))
  ) then
    raise exception 'PRODUCT_REVISION_DUPLICATE_SKU' using errcode = '23505';
  end if;

  insert into sellerpilot_private.ai_cli_jobs (
    id, kind, request_payload, created_by
  ) values (
    p_id, 'product_studio', v_payload, v_actor_id
  );
  insert into sellerpilot_private.product_ai_revisions (
    job_id, product_id, owner_id, actor_user_id, base_ai_job_id,
    base_product_updated_at, base_product_edit_fingerprint
  ) values (
    p_id, p_product_id, v_product.owner_id, v_actor_id, v_product.ai_job_id,
    v_product.updated_at,
    md5(jsonb_build_object(
      'name', v_product.name,
      'sku', v_product.sku,
      'description', v_product.description,
      'source_url', v_product.source_url,
      'product_facts_without_stock', coalesce(v_product.product_facts, '{}'::jsonb) - 'stock',
      'detail_page_data', v_product.detail_page_data,
      'detail_page_version', v_product.detail_page_version,
      'detail_page_updated_at', v_product.detail_page_updated_at
    )::text)
  );
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, job_id, safe_detail
  ) values (
    'job_queued', v_actor_id, p_id,
    jsonb_build_object(
      'kind', 'product_studio',
      'mode', 'product_revision',
      'image_count', v_image_count,
      'product_id', p_product_id,
      'auto_publish', false
    )
  );
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_product.owner_id, 'product_revision_queued', 'product', p_product_id::text,
    jsonb_build_object(
      'job_id', p_id,
      'base_ai_job_id', v_product.ai_job_id,
      'image_count', v_image_count,
      'actor_user_id', v_actor_id,
      'auto_publish', false
    )
  );
  return p_id;
end;
$$;

create function public.sellerpilot_abandon_uncreated_product_revision_job(
  p_product_id uuid,
  p_job_id uuid,
  p_image_paths jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_product_id is null or p_job_id is null
     or jsonb_typeof(p_image_paths) is distinct from 'array'
     or jsonb_array_length(p_image_paths) not between 1 and 100
     or exists (
       select 1
         from jsonb_array_elements_text(p_image_paths) with ordinality path(object_path, position)
        where path.object_path <> (
          v_actor_id::text || '/' || p_job_id::text || '/input/'
          || lpad(path.position::text, 3, '0') || '.jpg'
        )
     )
     or not exists (
    select 1 from sellerpilot_private.products product
     where product.id = p_product_id and not product.demo
  ) then
    raise exception 'PRODUCT_REVISION_PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:product-revision:' || p_job_id::text)
  );
  if exists (
    select 1 from sellerpilot_private.ai_cli_jobs job where job.id = p_job_id
  ) or exists (
    select 1 from sellerpilot_private.product_ai_revisions revision
     where revision.job_id = p_job_id
  ) then
    return false;
  end if;
  insert into sellerpilot_private.product_ai_revision_abandoned_jobs (
    job_id, product_id, actor_user_id
  ) values (
    p_job_id, p_product_id, v_actor_id
  ) on conflict (job_id) do nothing;
  insert into sellerpilot_private.ai_storage_cleanup_queue (
    bucket, object_path, available_at, last_error
  )
  select 'sellerpilot-ai', path.object_path, clock_timestamp(),
         'unconfirmed_product_revision_upload'
    from jsonb_array_elements_text(p_image_paths) path(object_path)
  on conflict (bucket, object_path) do update
    set available_at = least(
          sellerpilot_private.ai_storage_cleanup_queue.available_at,
          excluded.available_at
        ),
        last_error = excluded.last_error,
        updated_at = clock_timestamp();
  return true;
end;
$$;

create function sellerpilot_private.apply_product_ai_revision(
  p_job_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision sellerpilot_private.product_ai_revisions%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_product_id uuid;
  v_manual jsonb;
  v_previous_job_id uuid;
  v_listing_count integer;
  v_retain_until timestamptz := clock_timestamp() + interval '30 days';
  v_canonical_fields jsonb;
begin
  select revision.product_id into v_product_id
   from sellerpilot_private.product_ai_revisions revision
   where revision.job_id = p_job_id
     and revision.actor_user_id = p_actor_user_id;
  if not found then
    raise exception 'PRODUCT_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select product.* into v_product
   from sellerpilot_private.products product
   where product.id = v_product_id
     and not product.demo
     and product.status <> 'archived'
   for update;
  if not found then
    raise exception 'PRODUCT_REVISION_PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Keep the same product -> revision lock order as the enqueue function so a
  -- completion racing with the next edit cannot deadlock on inverse locks.
  select revision.* into v_revision
   from sellerpilot_private.product_ai_revisions revision
   where revision.job_id = p_job_id
     and revision.actor_user_id = p_actor_user_id
     and revision.product_id = v_product.id
   for update;
  if not found then
    raise exception 'PRODUCT_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_revision.status = 'applied' then
    if v_product.ai_job_id = p_job_id then return v_revision.product_id; end if;
    raise exception 'PRODUCT_REVISION_APPLIED_STATE_MISMATCH';
  end if;
  if v_revision.status <> 'pending' then
    raise exception 'PRODUCT_REVISION_NOT_PENDING';
  end if;

  select job.request_payload->'manual_fields' into v_manual
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.kind = 'product_studio'
     and job.created_by = p_actor_user_id
     and job.status = 'succeeded';
  if jsonb_typeof(v_manual) is distinct from 'object' then
    raise exception 'PRODUCT_REVISION_RESULT_NOT_READY';
  end if;
  if v_product.owner_id <> v_revision.owner_id
     or v_product.ai_job_id is distinct from v_revision.base_ai_job_id
     or md5(jsonb_build_object(
       'name', v_product.name,
       'sku', v_product.sku,
       'description', v_product.description,
       'source_url', v_product.source_url,
       'product_facts_without_stock', coalesce(v_product.product_facts, '{}'::jsonb) - 'stock',
       'detail_page_data', v_product.detail_page_data,
       'detail_page_version', v_product.detail_page_version,
       'detail_page_updated_at', v_product.detail_page_updated_at
     )::text) <> v_revision.base_product_edit_fingerprint then
    update sellerpilot_private.product_ai_revisions revision
       set status = 'failed',
           failure_reason = '상품 정보가 사진 수정 접수 후 변경되어 이전 수정값으로 덮어쓰지 않았습니다.',
           updated_at = clock_timestamp()
     where revision.job_id = p_job_id;
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_product.owner_id, 'product_revision_fence_blocked', 'product', v_product.id::text,
      jsonb_build_object(
        'job_id', p_job_id,
        'actor_user_id', p_actor_user_id,
        'base_ai_job_id', v_revision.base_ai_job_id,
        'current_ai_job_id', v_product.ai_job_id,
        'base_product_updated_at', v_revision.base_product_updated_at,
        'current_product_updated_at', v_product.updated_at,
        'product_unchanged', true,
        'auto_publish', false
      )
    );
    return null;
  end if;
  if exists (
    select 1
      from sellerpilot_private.products other_product
     where other_product.owner_id = v_product.owner_id
       and other_product.id <> v_product.id
       and other_product.sku = upper(trim(v_manual->>'sellerSku'))
  ) then
    update sellerpilot_private.product_ai_revisions revision
       set status = 'failed',
           failure_reason = '다른 상품에서 사용 중인 판매자 SKU라 리비전을 적용하지 않았습니다.',
           updated_at = clock_timestamp()
     where revision.job_id = p_job_id;
    return null;
  end if;

  v_previous_job_id := v_product.ai_job_id;
  v_canonical_fields := jsonb_set(
    v_manual,
    '{stock}',
    to_jsonb(v_product.on_hand),
    true
  );
  select count(*) into v_listing_count
    from sellerpilot_private.product_listings listing
   where listing.product_id = v_product.id;

  update sellerpilot_private.products product
     set name = trim(v_manual->>'productName'),
         sku = upper(trim(v_manual->>'sellerSku')),
         description = trim(v_manual->>'description'),
         source_url = nullif(trim(v_manual->>'productUrl'), ''),
         ai_job_id = p_job_id,
         product_facts = v_canonical_fields,
         detail_page_data = null,
         detail_page_version = 0,
         detail_page_updated_at = null,
         updated_at = clock_timestamp()
   where product.id = v_product.id;

  update sellerpilot_private.product_ai_revisions revision
     set status = 'applied',
         previous_ai_job_id = v_previous_job_id,
         previous_detail_page_data = v_product.detail_page_data,
         previous_detail_page_version = v_product.detail_page_version,
         previous_detail_page_updated_at = v_product.detail_page_updated_at,
         retain_previous_assets_until = case
           when v_previous_job_id is null then null else v_retain_until
         end,
         applied_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where revision.job_id = p_job_id;

  if v_previous_job_id is not null then
    insert into sellerpilot_private.ai_storage_cleanup_queue (
      bucket, object_path, available_at, last_error
    )
    select
      'sellerpilot-ai', retained_path.object_path, v_retain_until,
      'superseded_product_revision_retention'
      from (
        select input_path as object_path
          from sellerpilot_private.ai_cli_jobs previous_job
          cross join lateral jsonb_array_elements_text(
            case
              when jsonb_typeof(previous_job.request_payload->'image_paths') = 'array'
                then previous_job.request_payload->'image_paths'
              else '[]'::jsonb
            end
          ) input_path
         where previous_job.id = v_previous_job_id
        union
        select generated_path as object_path
          from sellerpilot_private.ai_cli_jobs previous_job
          cross join lateral jsonb_each_text(
            case
              when jsonb_typeof(previous_job.result_payload->'asset_storage_paths') = 'object'
                then previous_job.result_payload->'asset_storage_paths'
              else '{}'::jsonb
            end
          ) generated_asset(asset_id, generated_path)
         where previous_job.id = v_previous_job_id
      ) retained_path
     where length(retained_path.object_path) between 1 and 1000
       and retained_path.object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
       and retained_path.object_path ~ '^((results/)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/input/))'
    on conflict (bucket, object_path) do update
      set available_at = greatest(
            sellerpilot_private.ai_storage_cleanup_queue.available_at,
            excluded.available_at
          ),
          last_error = excluded.last_error,
          updated_at = clock_timestamp();
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_product.owner_id, 'product_revision_applied', 'product', v_product.id::text,
    jsonb_build_object(
      'job_id', p_job_id,
      'previous_ai_job_id', v_previous_job_id,
      'actor_user_id', p_actor_user_id,
      'listing_count_preserved', v_listing_count,
      'product_id_preserved', true,
      'auto_publish', false,
      'remote_sku_or_option_mutation', false,
      'previous_asset_retention_days', case when v_previous_job_id is null then 0 else 30 end
    )
  );
  return v_product.id;
end;
$$;

create or replace function sellerpilot_private.reconcile_product_after_ai_success()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'product_studio'
     or old.status is not distinct from new.status then
    return new;
  end if;

  if new.request_payload ? 'revision_product_id' then
    if new.status = 'succeeded' then
      -- Deliberately do not swallow errors here. The AI success transition and
      -- product rebind must either commit together or both roll back.
      perform sellerpilot_private.apply_product_ai_revision(new.id, new.created_by);
    elsif new.status in ('failed', 'cancelled') then
      update sellerpilot_private.product_ai_revisions revision
         set status = new.status,
             failure_reason = case
               when new.status = 'cancelled' then '상품 사진 수정 작업이 취소되어 기존 상품을 유지했습니다.'
               else left(coalesce(new.error_message, 'AI 상품 사진 수정 작업을 완료하지 못했습니다.'), 500)
             end,
             updated_at = clock_timestamp()
       where revision.job_id = new.id
         and revision.status = 'pending';
    end if;
    return new;
  end if;

  if new.status = 'succeeded' then
    begin
      perform sellerpilot_private.reconcile_product_from_ai(new.id, new.created_by);
    exception
      when unique_violation then
        insert into sellerpilot_private.operation_audit(
          owner_id, action, entity_type, entity_id, safe_detail
        ) values (
          new.created_by, 'product_reconciliation_blocked', 'ai_job', new.id::text,
          jsonb_build_object('job_id', new.id, 'reason', 'duplicate_seller_sku')
        );
      when others then
        insert into sellerpilot_private.operation_audit(
          owner_id, action, entity_type, entity_id, safe_detail
        ) values (
          new.created_by, 'product_reconciliation_pending', 'ai_job', new.id::text,
          jsonb_build_object(
            'job_id', new.id,
            'reason', 'database_reconciliation_error',
            'sqlstate', sqlstate
          )
        );
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_product_after_ai_success
  on sellerpilot_private.ai_cli_jobs;
create trigger reconcile_product_after_ai_success
after update of status on sellerpilot_private.ai_cli_jobs
for each row
when (
  new.kind = 'product_studio'
  and old.status is distinct from new.status
)
execute function sellerpilot_private.reconcile_product_after_ai_success();

-- A superseded revision receives its own 30-day asset-retention lease. Do not
-- prune its source job (or a regeneration derived from it) while that lease is
-- active; otherwise the generic prune return value could make callers treat a
-- deliberately retained object as immediately removable.
create or replace function public.sellerpilot_prune_ai_jobs(
  p_completed_before timestamptz,
  p_limit integer default 200
)
returns table (job_id uuid, input_paths text[], result_paths text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_completed_before > clock_timestamp() - interval '7 days' then
    raise exception 'retention window must be at least seven days';
  end if;
  return query
  with candidates as (
    select job.id,
           array(
             select jsonb_array_elements_text(
               case
                 when job.request_payload->'image_paths' is null then '[]'::jsonb
                 when jsonb_typeof(job.request_payload->'image_paths') = 'array'
                   then job.request_payload->'image_paths'
                 else '["__invalid_image_paths__"]'::jsonb
               end
             )
           ) as inputs,
           array(
             select value
               from jsonb_each_text(
                 case
                   when job.result_payload->'asset_storage_paths' is null then '{}'::jsonb
                   when jsonb_typeof(job.result_payload->'asset_storage_paths') = 'object'
                     then job.result_payload->'asset_storage_paths'
                   else '{"__invalid__":"__invalid_asset_storage_paths__"}'::jsonb
                 end
               )
             union all
             select nullif(job.result_payload->>'hero_storage_path', '')
              where nullif(job.result_payload->>'hero_storage_path', '') is not null
             union all
             select staging.object_path
               from sellerpilot_private.ai_result_upload_staging staging
              where staging.job_id = job.id
           ) as generated_paths
      from sellerpilot_private.ai_cli_jobs job
     where job.status in ('succeeded', 'failed', 'cancelled')
       and coalesce(job.completed_at, job.updated_at) < p_completed_before
       and not exists (
         select 1
           from sellerpilot_private.products product
          where product.ai_job_id = job.id
             or (
               job.kind = 'product_asset_regeneration'
               and product.ai_job_id::text = job.request_payload->>'source_job_id'
             )
       )
       and not exists (
         select 1
           from sellerpilot_private.product_ai_revisions revision
          where revision.retain_previous_assets_until > clock_timestamp()
            and (
              revision.base_ai_job_id = job.id
              or revision.previous_ai_job_id = job.id
              or (
                job.kind = 'product_asset_regeneration'
                and coalesce(revision.previous_ai_job_id, revision.base_ai_job_id)::text
                    = job.request_payload->>'source_job_id'
              )
            )
       )
  ), validated as (
    select candidates.*
      from candidates
     where not exists (
       select 1
         from unnest(
           coalesce(candidates.inputs, array[]::text[])
           || coalesce(candidates.generated_paths, array[]::text[])
         ) as path(object_path)
        where nullif(trim(path.object_path), '') is not null
          and not (
            length(path.object_path) <= 1000
            and path.object_path ~ '^((results/)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/input/))'
            and path.object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
          )
     )
  ), selected as (
    select validated.id, validated.inputs, validated.generated_paths
      from validated
      join sellerpilot_private.ai_cli_jobs job on job.id = validated.id
     order by coalesce(job.completed_at, job.updated_at), job.id
     for update of job skip locked
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ), enqueued as (
    insert into sellerpilot_private.ai_storage_cleanup_queue (bucket, object_path)
    select 'sellerpilot-ai', path.object_path
      from selected
      cross join lateral unnest(
        coalesce(selected.inputs, array[]::text[])
        || coalesce(selected.generated_paths, array[]::text[])
      ) as path(object_path)
     where nullif(trim(path.object_path), '') is not null
       and length(path.object_path) <= 1000
       and path.object_path ~ '^((results/)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/input/))'
       and path.object_path !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]])'
    on conflict (bucket, object_path) do nothing
    returning id
  ), audited as (
    insert into sellerpilot_private.ai_cli_audit (action, safe_detail)
    select 'job_pruned', jsonb_build_object(
      'job_id', selected.id,
      'input_count', coalesce(cardinality(selected.inputs), 0),
      'result_count', coalesce(cardinality(selected.generated_paths), 0),
      'cleanup_queued', coalesce(cardinality(selected.inputs), 0)
        + coalesce(cardinality(selected.generated_paths), 0) > 0
    ) from selected
    returning id as audit_id
  ), deleted as (
    delete from sellerpilot_private.ai_cli_jobs job
    using selected
    where job.id = selected.id
      and (select count(*) from enqueued) >= 0
      and (select count(*) from audited) >= 0
    returning job.id
  )
  select selected.id, selected.inputs, selected.generated_paths
    from selected
    join deleted on deleted.id = selected.id;
end;
$$;

alter function public.sellerpilot_retry_ai_job(uuid)
  rename to sellerpilot_retry_ai_job_pre_product_revision;
create function public.sellerpilot_retry_ai_job(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision_product_id uuid;
  v_revision sellerpilot_private.product_ai_revisions%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_job_created_by uuid;
  v_job_kind text;
  v_updated integer;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select job.created_by, job.kind
    into v_job_created_by, v_job_kind
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id;
  if not found
     or (v_job_created_by <> auth.uid() and v_job_kind <> 'product_studio') then
    return false;
  end if;
  select revision.product_id into v_revision_product_id
    from sellerpilot_private.product_ai_revisions revision
   where revision.job_id = p_id;
  if found then
    select product.* into v_product
      from sellerpilot_private.products product
     where product.id = v_revision_product_id
       and not product.demo
       and product.status <> 'archived'
     for update;
    if not found then return false; end if;
    select revision.* into v_revision
      from sellerpilot_private.product_ai_revisions revision
     where revision.job_id = p_id
       and revision.product_id = v_product.id
     for update;
    if v_revision.status not in ('failed', 'cancelled') then return false; end if;
    if v_product.owner_id <> v_revision.owner_id
       or v_product.ai_job_id is distinct from v_revision.base_ai_job_id
       or md5(jsonb_build_object(
         'name', v_product.name,
         'sku', v_product.sku,
         'description', v_product.description,
         'source_url', v_product.source_url,
         'product_facts_without_stock', coalesce(v_product.product_facts, '{}'::jsonb) - 'stock',
         'detail_page_data', v_product.detail_page_data,
         'detail_page_version', v_product.detail_page_version,
         'detail_page_updated_at', v_product.detail_page_updated_at
       )::text) <> v_revision.base_product_edit_fingerprint then
      raise exception 'PRODUCT_REVISION_BASE_CHANGED';
    end if;
    update sellerpilot_private.product_ai_revisions revision
       set status = 'pending', failure_reason = null, updated_at = clock_timestamp()
     where revision.job_id = p_id;
  end if;

  update sellerpilot_private.ai_cli_jobs job
     set status = 'queued',
         result_payload = null,
         error_message = null,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         attempt_count = 0,
         preparation_failure_count = 0,
         available_at = clock_timestamp(),
         started_at = null,
         completed_at = null,
         updated_at = clock_timestamp()
   where job.id = p_id
     and job.status in ('failed', 'cancelled')
     and (job.created_by = auth.uid() or job.kind = 'product_studio');
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    if v_revision_product_id is not null then
      update sellerpilot_private.product_ai_revisions revision
         set status = v_revision.status,
             failure_reason = v_revision.failure_reason,
             updated_at = clock_timestamp()
       where revision.job_id = p_id;
    end if;
    return false;
  end if;
  delete from sellerpilot_private.ai_job_completion_receipts receipt
   where receipt.job_id = p_id;
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, job_id, safe_detail
  ) values (
    'job_retried', auth.uid(), p_id,
    jsonb_build_object(
      'source', 'admin_ui',
      'shared_admin_retry', v_job_created_by <> auth.uid(),
      'product_revision', v_revision_product_id is not null
    )
  );
  return true;
end;
$$;

alter function public.sellerpilot_create_product_from_ai_v2(uuid)
  rename to sellerpilot_create_product_from_ai_v2_pre_revision;
create function public.sellerpilot_create_product_from_ai_v2(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_job_created_by uuid;
  v_job_kind text;
  v_job_status text;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select revision.product_id into v_product_id
    from sellerpilot_private.product_ai_revisions revision
   where revision.job_id = p_job_id
     and revision.status = 'applied';
  if found then return v_product_id; end if;
  if exists (
    select 1 from sellerpilot_private.product_ai_revisions revision
     where revision.job_id = p_job_id
  ) then
    raise exception 'PRODUCT_REVISION_NOT_APPLIED';
  end if;

  -- Registration activity is shared by administrators. Lock and validate the
  -- exact product-studio job, then reconcile it for its original owner rather
  -- than substituting the administrator who clicked recovery.
  select job.created_by, job.kind, job.status
    into v_job_created_by, v_job_kind, v_job_status
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
   for update;
  if not found or v_job_kind <> 'product_studio' then
    raise exception 'AI_PRODUCT_STUDIO_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_job_status <> 'succeeded' then
    raise exception 'AI_PRODUCT_STUDIO_JOB_NOT_READY';
  end if;
  select product.id into v_product_id
    from sellerpilot_private.products product
   where product.ai_job_id = p_job_id
     and product.owner_id = v_job_created_by
   limit 1;
  if found then return v_product_id; end if;
  select revision.product_id into v_product_id
    from sellerpilot_private.product_ai_revisions revision
    join sellerpilot_private.products product on product.id = revision.product_id
   where revision.status = 'applied'
     and revision.owner_id = v_job_created_by
     and product.owner_id = v_job_created_by
     and (
       revision.base_ai_job_id = p_job_id
       or revision.previous_ai_job_id = p_job_id
     )
   order by revision.applied_at desc nulls last
   limit 1;
  if found then return v_product_id; end if;
  return sellerpilot_private.reconcile_product_from_ai(
    p_job_id,
    v_job_created_by
  );
end;
$$;

-- The activity ledger is intentionally shared between approved admins, but
-- only product-studio jobs can be read across admin accounts. Other AI job
-- kinds keep their creator-only boundary. request_payload is not returned, so
-- source-upload paths and product prompts are not exposed by this RPC.
create or replace function public.sellerpilot_get_ai_job(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', job.id,
    'kind', job.kind,
    'status', job.status,
    'result', job.result_payload,
    'error', job.error_message,
    'attempt_count', job.attempt_count,
    'created_at', job.created_at,
    'started_at', job.started_at,
    'completed_at', job.completed_at,
    'updated_at', job.updated_at
  ) into v_result
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id
     and (job.created_by = auth.uid() or job.kind = 'product_studio');
  return v_result;
end;
$$;

create function public.sellerpilot_get_product_revision_state(
  p_product_id uuid,
  p_job_id uuid default null
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
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from sellerpilot_private.products product
     where product.id = p_product_id
       and not product.demo
  ) then return null; end if;

  select jsonb_build_object(
    'jobId', revision.job_id,
    'productId', revision.product_id,
    'status', revision.status,
    'jobStatus', job.status,
    'error', case
      when revision.failure_reason is not null then revision.failure_reason
      when job.status in ('failed', 'cancelled') then left(job.error_message, 500)
      else null
    end,
    'createdAt', revision.created_at,
    'appliedAt', revision.applied_at,
    'autoPublish', false,
    'remoteSkuOrOptionMutation', false
  ) into v_result
    from sellerpilot_private.product_ai_revisions revision
    join sellerpilot_private.ai_cli_jobs job on job.id = revision.job_id
   where revision.product_id = p_product_id
     and (p_job_id is null or revision.job_id = p_job_id)
   order by revision.created_at desc
   limit 1;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_create_product_revision_job(uuid, uuid, jsonb)
  from public, anon;
revoke all on function public.sellerpilot_abandon_uncreated_product_revision_job(uuid, uuid, jsonb)
  from public, anon;
revoke all on function sellerpilot_private.apply_product_ai_revision(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_retry_ai_job_pre_product_revision(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_retry_ai_job(uuid)
  from public, anon;
revoke all on function public.sellerpilot_create_product_from_ai_v2_pre_revision(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_create_product_from_ai_v2(uuid)
  from public, anon;
revoke all on function public.sellerpilot_get_ai_job(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_get_product_revision_state(uuid, uuid)
  from public, anon;

grant execute on function public.sellerpilot_create_product_revision_job(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.sellerpilot_abandon_uncreated_product_revision_job(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.sellerpilot_retry_ai_job(uuid)
  to authenticated;
grant execute on function public.sellerpilot_create_product_from_ai_v2(uuid)
  to authenticated;
grant execute on function public.sellerpilot_get_ai_job(uuid)
  to authenticated;
grant execute on function public.sellerpilot_get_product_revision_state(uuid, uuid)
  to authenticated;

commit;
