-- Resolve one uncertain Qoo10 localization write only after an independent,
-- provider-backed read-only observation proves that every material field is
-- byte/value identical to the prewrite snapshot. Any missing, partial, or
-- mismatched evidence leaves the source reconciliation_required.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 901082000);

do $qoo10_no_effect_history_fence$
declare
  v_history_table regclass;
begin
  v_history_table := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if exists (
      select 1 from supabase_migrations.schema_migrations migration
       where migration.version = '20260901083000'
         and migration.name is distinct from
               'reconcile_exact_qoo10_uncertain_no_remote_effect'
    ) then
      raise exception 'exact Qoo10 no-effect migration history drifted'
        using errcode = '55000';
    end if;
  end if;
end;
$qoo10_no_effect_history_fence$;

lock table sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.channel_operation_attempts,
  sellerpilot_private.product_listings,
  sellerpilot_private.qoo10_exact_localization_update_permits
  in share row exclusive mode;

create table sellerpilot_private.qoo10_exact_no_effect_verifier_runs (
  verifier_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  remote_id text not null,
  seller_account_key text not null,
  source_request_sha256 text not null,
  source_request_bytes integer not null,
  source_response_sha256 text not null,
  source_response_bytes integer not null,
  source_request_fingerprint text not null,
  release_sha text not null,
  contract text not null,
  queued_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_no_effect_verifier_run_target_check check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id = '1217336970'
    and seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and source_request_sha256 ~ '^[a-f0-9]{64}$'
    and source_response_sha256 ~ '^[a-f0-9]{64}$'
    and source_request_fingerprint ~ '^[a-f0-9]{64}$'
    and release_sha ~ '^[a-f0-9]{40}$'
    and source_request_bytes between 100 and 128000
    and source_response_bytes between 100 and 2000000
    and contract = 'qoo10_exact_no_remote_effect_verifier_v1'
  )
);

alter table sellerpilot_private.qoo10_exact_no_effect_verifier_runs
  enable row level security;
revoke all on sellerpilot_private.qoo10_exact_no_effect_verifier_runs
  from public, anon, authenticated, service_role;

create table sellerpilot_private.qoo10_exact_no_effect_reconciliations (
  source_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  verifier_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  listing_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  owner_id uuid not null,
  remote_id text not null,
  seller_account_key text not null,
  source_request_sha256 text not null,
  source_response_sha256 text not null,
  verifier_response_sha256 text not null,
  prewrite_snapshot jsonb not null,
  current_snapshot jsonb not null,
  snapshot_sha256 text not null,
  resolution text not null,
  provider_call_replayed boolean not null,
  reconciled_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_no_effect_reconciliation_target_check check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id = '1217336970'
    and seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and source_request_sha256 ~ '^[a-f0-9]{64}$'
    and source_response_sha256 ~ '^[a-f0-9]{64}$'
    and verifier_response_sha256 ~ '^[a-f0-9]{64}$'
    and snapshot_sha256 ~ '^[a-f0-9]{64}$'
    and prewrite_snapshot = current_snapshot
    and prewrite_snapshot->>'snapshotSha256' = snapshot_sha256
    and resolution = 'no_remote_effect'
    and not provider_call_replayed
  )
);

alter table sellerpilot_private.qoo10_exact_no_effect_reconciliations
  enable row level security;
revoke all on sellerpilot_private.qoo10_exact_no_effect_reconciliations
  from public, anon, authenticated, service_role;

create trigger block_qoo10_exact_no_effect_verifier_run_change
before update or delete
on sellerpilot_private.qoo10_exact_no_effect_verifier_runs
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();

create trigger block_qoo10_exact_no_effect_reconciliation_change
before update or delete
on sellerpilot_private.qoo10_exact_no_effect_reconciliations
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();

create function sellerpilot_private.qoo10_exact_no_effect_items(
  p_value jsonb,
  p_depth integer default 0
)
returns setof jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_child jsonb;
  v_identities text[];
begin
  if p_value is null or p_depth > 8 then return; end if;
  if jsonb_typeof(p_value) = 'object' then
    select pg_catalog.array_agg(pg_catalog.btrim(p_value->>alias) order by alias)
      into v_identities
      from unnest(array['GdNo','ItemCode','ItemNo']) alias
     where p_value ? alias
       and pg_catalog.btrim(coalesce(p_value->>alias,'')) <> '';
    if coalesce(pg_catalog.cardinality(v_identities),0) > 0
       and not exists (
         select 1 from unnest(v_identities) identity
          where identity is distinct from '1217336970'
       )
    then
      return next p_value;
    end if;
    for v_child in select value from jsonb_each(p_value) loop
      return query select *
        from sellerpilot_private.qoo10_exact_no_effect_items(
          v_child,p_depth+1
        );
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      return query select *
        from sellerpilot_private.qoo10_exact_no_effect_items(
          v_child,p_depth+1
        );
    end loop;
  end if;
end;
$$;

create function sellerpilot_private.qoo10_exact_no_effect_alias_value(
  p_item jsonb,
  p_aliases text[]
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_values text[];
begin
  if jsonb_typeof(p_item) is distinct from 'object'
     or p_aliases is null
     or pg_catalog.cardinality(p_aliases) = 0
  then return null; end if;
  select pg_catalog.array_agg(distinct pg_catalog.btrim(p_item->>alias))
    into v_values
    from unnest(p_aliases) alias
   where p_item ? alias
     and jsonb_typeof(p_item->alias) in ('string','number')
     and pg_catalog.btrim(coalesce(p_item->>alias,'')) <> '';
  if coalesce(pg_catalog.cardinality(v_values),0) <> 1 then return null; end if;
  return v_values[1];
end;
$$;

create function sellerpilot_private.qoo10_exact_no_effect_snapshot(
  p_result_object jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_candidate jsonb;
  v_count integer := 0;
  v_remote_id text;
  v_title text;
  v_seller_sku text;
  v_status text;
  v_retail_raw text;
  v_sell_raw text;
  v_quantity_raw text;
  v_retail numeric;
  v_sell numeric;
  v_quantity numeric;
  v_representative text;
  v_detail_html text;
  v_images jsonb;
  v_core jsonb;
  v_snapshot_sha text;
begin
  for v_candidate in
    select * from sellerpilot_private.qoo10_exact_no_effect_items(p_result_object)
  loop
    v_count := v_count + 1;
    v_item := v_candidate;
  end loop;
  if v_count <> 1 then return null; end if;

  v_remote_id := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['ItemNo','ItemCode','GdNo']
  );
  v_title := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['ItemTitle']
  );
  v_seller_sku := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['SellerCode']
  );
  v_status := pg_catalog.upper(
    sellerpilot_private.qoo10_exact_no_effect_alias_value(
      v_item,array['ItemStatus','Status']
    )
  );
  if v_status = '1' then v_status := 'S1'; end if;
  v_retail_raw := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['RetailPrice']
  );
  v_sell_raw := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['SellPrice','ItemPrice']
  );
  v_quantity_raw := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['ItemQty','Qty','StockQty']
  );
  v_representative := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['ImageUrl','StandardImage','MainImageUrl']
  );
  v_detail_html := sellerpilot_private.qoo10_exact_no_effect_alias_value(
    v_item,array['ItemDetail','ItemDescription','Description']
  );

  if v_retail_raw !~ '^[0-9]+(?:[.][0]+)?$'
     or v_sell_raw !~ '^[0-9]+(?:[.][0]+)?$'
     or v_quantity_raw !~ '^[0-9]+(?:[.][0]+)?$'
  then return null; end if;
  v_retail := v_retail_raw::numeric;
  v_sell := v_sell_raw::numeric;
  v_quantity := v_quantity_raw::numeric;
  v_images := sellerpilot_private.qoo10_exact_detail_image_urls(v_detail_html);

  if v_remote_id is distinct from '1217336970'
     or v_title is distinct from '貼り付け式ケーブル整理クリップ6個セット'
     or v_seller_sku is distinct from 'QA-20260823-CC-001'
     or v_status is distinct from 'S1'
     or v_retail <> 1871
     or v_sell <> 1871
     or v_quantity <> 1
     or v_representative is null
     or v_representative !~
          '^https://gd[.]image-qoo10[.]jp/li/963/402/8461402963(?:[.]g(?:_[a-z0-9-]+)*)?[.]jpg$'
     or v_detail_html is null
     or pg_catalog.octet_length(v_detail_html) < 100
     or jsonb_typeof(v_images) is distinct from 'array'
     or jsonb_array_length(v_images) <> 8
     or (
       select count(distinct image.value) <> 8
           or bool_or(
             jsonb_typeof(image.value) is distinct from 'string'
             or image.value#>>'{}' !~ '^https://[^[:space:]#]+$'
           )
         from jsonb_array_elements(v_images) image(value)
     )
  then return null; end if;

  v_core := jsonb_build_object(
    'remoteId',v_remote_id,
    'title',v_title,
    'titleSha256',encode(extensions.digest(v_title,'sha256'),'hex'),
    'sellerSku',v_seller_sku,
    'providerStatus',v_status,
    'retailPriceJpy',v_retail,
    'sellPriceJpy',v_sell,
    'quantity',v_quantity,
    'representativeImageSha256',
      encode(extensions.digest(v_representative,'sha256'),'hex'),
    'representativeImageBytes',pg_catalog.octet_length(v_representative),
    'detailHtmlSha256',
      encode(extensions.digest(v_detail_html,'sha256'),'hex'),
    'detailHtmlBytes',pg_catalog.octet_length(v_detail_html),
    'detailImageUrls',v_images,
    'detailImagesSha256',
      encode(extensions.digest(v_images::text,'sha256'),'hex')
  );
  v_snapshot_sha := encode(extensions.digest(v_core::text,'sha256'),'hex');
  return v_core || jsonb_build_object('snapshotSha256',v_snapshot_sha);
exception when others then
  return null;
end;
$$;

create function sellerpilot_private.qoo10_exact_no_effect_snapshots_identical(
  p_prewrite_result_object jsonb,
  p_current_result_object jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.qoo10_exact_no_effect_snapshot(
      p_prewrite_result_object
    ) is not null
    and sellerpilot_private.qoo10_exact_no_effect_snapshot(
      p_prewrite_result_object
    ) = sellerpilot_private.qoo10_exact_no_effect_snapshot(
      p_current_result_object
    ),
    false
  )
$$;

create function sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
  p_source_job_id uuid,
  p_arguments jsonb,
  p_release_sha text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_params jsonb := p_arguments->'params';
  v_marker jsonb := p_arguments->'sellerpilotQoo10ExactLocalization';
  v_v2 boolean;
begin
  if p_source_job_id is null
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or jsonb_typeof(v_params) is distinct from 'object'
  then return false; end if;
  v_v2 := jsonb_typeof(v_marker) = 'object'
    and v_marker->>'status' is not distinct from 'allowed'
    and v_marker->>'contract' is not distinct from
          'qoo10_exact_localization_update_v2'
    and v_marker->>'productId' is not distinct from
          'ddccde35-9c58-4856-b673-d7aa27ce4220'
    and v_marker->>'listingId' is not distinct from
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
    and v_marker->>'credentialId' is not distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'
    and v_marker->>'remoteId' is not distinct from '1217336970'
    and v_marker->>'sellerSku' is not distinct from 'QA-20260823-CC-001'
    and v_marker->>'releaseSha' is not distinct from p_release_sha;
  return (v_v2 or p_source_job_id =
            'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid)
    and v_params->>'ItemCode' is not distinct from '1217336970'
    and v_params->>'SellerCode' is not distinct from 'QA-20260823-CC-001'
    and v_params->>'RetailPrice' is not distinct from '1871'
    and v_params->>'ItemPrice' is not distinct from '1871'
    and v_params->>'ItemQty' is not distinct from '1'
    and p_arguments->>'publicationIntent' is not distinct from 'live'
    and p_arguments->>'publicationStateContract' is not distinct from
          'verified_remote_state_v1'
    and p_arguments->>'publicationExpectedLocale' is not distinct from 'ja-JP'
    and p_arguments->>'publicationExpectedFingerprint' ~ '^[a-f0-9]{64}$'
    and p_arguments->>'publicationExpectedImageCount' is not distinct from '8';
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_no_effect_items(jsonb,integer),
  sellerpilot_private.qoo10_exact_no_effect_alias_value(jsonb,text[]),
  sellerpilot_private.qoo10_exact_no_effect_snapshot(jsonb),
  sellerpilot_private.qoo10_exact_no_effect_snapshots_identical(jsonb,jsonb),
  sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(uuid,jsonb,text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.guard_qoo10_exact_no_effect_verifier_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract text;
begin
  if tg_op = 'INSERT' then
    v_contract := new.request_payload#>>
      '{arguments,sellerpilotQoo10NoEffectReconciliation}';
    if v_contract is null then return new; end if;
    if current_setting(
         'sellerpilot.qoo10_no_effect_verifier_enqueue',true
       ) is distinct from new.id::text
       or new.listing_id is distinct from
            '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       or new.credential_id is distinct from
            '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       or new.created_by is distinct from
            '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
       or new.channel is distinct from 'qoo10'
       or new.operation is distinct from 'listing.publication.verify'
       or new.environment is distinct from 'production'
       or new.status is distinct from 'queued'
       or new.attempt_id is not null
       or new.attempt_count <> 0
       or new.provider_mutation_started_at is not null
       or new.seller_account_key is distinct from
            '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       or v_contract is distinct from
            'qoo10_exact_no_remote_effect_verifier_v1'
       or new.request_payload#>'{arguments,sellerpilotReadOnly}'
            is distinct from 'true'::jsonb
       or new.request_payload#>>'{arguments,publicationReviewId}'
            is distinct from '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       or new.request_payload#>>'{arguments,remoteId}'
            is distinct from '1217336970'
       or new.request_payload#>>'{arguments,publicationExpectedLocale}'
            is distinct from 'ja-JP'
       or new.request_payload#>>'{arguments,publicationExpectedImageCount}'
            is distinct from '8'
       or new.request_payload#>>'{arguments,publicationReviewSourceJobId}'
            !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or new.request_fingerprint !~ '^[a-f0-9]{64}$'
    then
      raise exception 'exact Qoo10 no-effect verifier job invalid'
        using errcode = '55000';
    end if;
    return new;
  end if;

  v_contract := old.request_payload#>>
    '{arguments,sellerpilotQoo10NoEffectReconciliation}';
  if v_contract is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    raise exception 'exact Qoo10 no-effect verifier job is immutable'
      using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.listing_id is distinct from old.listing_id
     or new.credential_id is distinct from old.credential_id
     or new.attempt_id is distinct from old.attempt_id
     or new.created_by is distinct from old.created_by
     or new.channel is distinct from old.channel
     or new.operation is distinct from old.operation
     or new.environment is distinct from old.environment
     or new.request_payload is distinct from old.request_payload
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.seller_account_key is distinct from old.seller_account_key
     or new.write_resource_kind is distinct from old.write_resource_kind
     or new.write_resource_key is distinct from old.write_resource_key
     or new.provider_mutation_started_at is not null
  then
    raise exception 'exact Qoo10 no-effect verifier lineage is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_qoo10_exact_no_effect_verifier_job
before insert or update or delete
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_qoo10_exact_no_effect_verifier_job();

revoke all on function
  sellerpilot_private.guard_qoo10_exact_no_effect_verifier_job()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_exact_qoo10_no_effect_verifier(
  p_source_job_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing record;
  v_job_id uuid := gen_random_uuid();
  v_arguments jsonb;
  v_payload jsonb;
  v_request_sha text;
  v_prewrite jsonb;
  v_is_v2 boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,901082000);
  if p_source_job_id is null
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
  then
    raise exception 'exact Qoo10 no-effect verifier identity invalid'
      using errcode = '55000';
  end if;

  select * into v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = p_source_job_id
   for update;
  if not found then
    raise exception 'exact Qoo10 uncertain source missing'
      using errcode = '55000';
  end if;
  v_prewrite := sellerpilot_private.qoo10_exact_no_effect_snapshot(
    v_source.response_payload#>'{steps,0,data,ResultObject}'
  );
  v_is_v2 := v_source.request_payload#>>
    '{arguments,sellerpilotQoo10ExactLocalization,contract}' =
      'qoo10_exact_localization_update_v2';

  if v_source.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_source.credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_source.created_by is distinct from
       '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     or v_source.channel is distinct from 'qoo10'
     or v_source.operation is distinct from 'listing.update'
     or v_source.environment is distinct from 'production'
     or v_source.status is distinct from 'reconciliation_required'
     or v_source.seller_account_key is distinct from
       '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or v_source.attempt_id is null
     or v_source.attempt_count <> 1
     or v_source.provider_mutation_started_at is null
     or v_source.completed_at is null
     or jsonb_typeof(v_source.response_payload) is distinct from 'object'
     or jsonb_typeof(v_source.response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(v_source.response_payload->'steps') < 1
     or v_source.response_payload#>>'{steps,0,name}' is distinct from
          'qoo10-exact-current-s1-prewrite-readback'
     or v_source.response_payload#>>'{steps,0,ok}' is distinct from 'true'
     or v_source.response_payload#>>'{steps,0,status}' !~ '^2[0-9][0-9]$'
     or v_source.response_payload#>>'{steps,0,data,ResultCode}'
          is distinct from '0'
     or v_prewrite is null
     or not sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
          v_source.id,v_source.request_payload->'arguments',p_release_sha
        )
     or (
       select count(*) from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_source.id
     ) <> 1
     or not exists (
       select 1
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = v_source.attempt_id
          and attempt.owner_id =
                '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and attempt.credential_id = v_source.credential_id
          and attempt.channel = 'qoo10'
          and attempt.operation = 'listing.update'
          and attempt.status = 'manual_required'
          and attempt.remote_id = '1217336970'
          and attempt.request_fingerprint = v_source.request_fingerprint
          and attempt.gateway_write_required
          and not attempt.pre_gateway_retryable
     )
     or not exists (
       select 1
         from sellerpilot_private.product_listings listing
         join sellerpilot_private.products product
           on product.id = listing.product_id
         join sellerpilot_private.channel_credentials credential
           on credential.id = v_source.credential_id
        where listing.id = v_source.listing_id
          and listing.owner_id =
                '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and listing.product_id =
                'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
          and listing.channel_key = 'qoo10'
          and listing.market = 'JP'
          and listing.target_id = ''
          and listing.remote_id = '1217336970'
          and listing.status = 'failed'
          and listing.failure_class = 'external_action'
          and listing.requested_publication_intent = 'live'
          and listing.remote_visibility = 'unknown'
          and listing.seller_account_key = v_source.seller_account_key
          and product.owner_id = listing.owner_id
          and not product.demo
          and product.status is distinct from 'archived'
          and credential.channel = 'qoo10'
          and credential.environment = 'production'
          and credential.status = 'active'
          and credential.seller_account_key = v_source.seller_account_key
     )
     or (v_is_v2 and not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_update_permits permit
        where permit.update_job_id = v_source.id
          and permit.update_attempt_id = v_source.attempt_id
          and permit.listing_id = v_source.listing_id
          and permit.credential_id = v_source.credential_id
          and permit.request_fingerprint = v_source.request_fingerprint
          and permit.bound_at is not null
          and permit.consumed_at is not null
          and permit.invalidated_at is null
     ))
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs later_job
        where later_job.listing_id = v_source.listing_id
          and later_job.created_at > v_source.created_at
          and later_job.operation in (
            'listing.create','listing.update','listing.stop','listing.activate',
            'price.update','inventory.update'
          )
     )
  then
    raise exception 'exact Qoo10 uncertain source evidence incomplete'
      using errcode = '55000';
  end if;

  select run.verifier_job_id,job.status
    into v_existing
    from sellerpilot_private.qoo10_exact_no_effect_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = run.verifier_job_id
   where run.source_job_id = v_source.id;
  if found then
    return jsonb_build_object(
      'contract','qoo10_exact_no_remote_effect_verifier_v1',
      'sourceJobId',v_source.id,
      'verifierJobId',v_existing.verifier_job_id,
      'status',v_existing.status,
      'reused',true
    );
  end if;

  v_arguments := jsonb_build_object(
    'publicationReviewId',v_source.listing_id,
    'publicationReviewSourceJobId',v_source.id,
    'publicationReviewCheck',1,
    'sellerpilotReadOnly',true,
    'sellerpilotQoo10NoEffectReconciliation',
      'qoo10_exact_no_remote_effect_verifier_v1',
    'remoteId','1217336970',
    'market','JP',
    'targetId','',
    'publicationIntent','live',
    'publicationStateContract','verified_remote_state_v1',
    'publicationExpectedLocale','ja-JP',
    'publicationExpectedFingerprint',
      v_source.request_payload#>>'{arguments,publicationExpectedFingerprint}',
    'publicationExpectedImageCount',8
  );
  v_payload := jsonb_build_object(
    'periodicKey','qoo10-no-effect:' || v_source.id::text,
    'arguments',v_arguments
  );
  v_request_sha := encode(extensions.digest(v_payload::text,'sha256'),'hex');

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_no_effect_verifier_enqueue',v_job_id::text,true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,
    created_by,created_at,updated_at
  ) values (
    v_job_id,v_source.credential_id,null,v_source.listing_id,
    'qoo10','listing.publication.verify','production',v_payload,'queued',
    v_source.seller_account_key,v_request_sha,v_source.created_by,
    clock_timestamp(),clock_timestamp()
  );

  insert into sellerpilot_private.qoo10_exact_no_effect_verifier_runs (
    verifier_job_id,source_job_id,source_attempt_id,listing_id,product_id,
    credential_id,owner_id,remote_id,seller_account_key,
    source_request_sha256,source_request_bytes,source_response_sha256,
    source_response_bytes,source_request_fingerprint,release_sha,contract,
    queued_at
  ) values (
    v_job_id,v_source.id,v_source.attempt_id,v_source.listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    v_source.credential_id,'768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '1217336970',v_source.seller_account_key,
    encode(extensions.digest(v_source.request_payload::text,'sha256'),'hex'),
    octet_length(v_source.request_payload::text),
    encode(extensions.digest(v_source.response_payload::text,'sha256'),'hex'),
    octet_length(v_source.response_payload::text),v_source.request_fingerprint,
    p_release_sha,'qoo10_exact_no_remote_effect_verifier_v1',
    clock_timestamp()
  );

  return jsonb_build_object(
    'contract','qoo10_exact_no_remote_effect_verifier_v1',
    'sourceJobId',v_source.id,
    'verifierJobId',v_job_id,
    'status','queued',
    'reused',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_exact_qoo10_no_effect_verifier(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_exact_qoo10_no_effect_verifier(uuid,text)
  to service_role;

alter function public.sellerpilot_service_listing_publication_verification_source(
  text,uuid,uuid
) rename to sellerpilot_082000_listing_publication_source_before_qoo10_no_effect;
revoke all on function
  public.sellerpilot_082000_listing_publication_source_before_qoo10_no_effect(
    text,uuid,uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_listing_publication_verification_source(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
begin
  if p_token_hash is null or p_job_id is null or p_claim_token is null
     or not sellerpilot_private.serverless_cs_job_is_owned(
       p_token_hash,p_job_id,p_claim_token,true
     )
  then
    raise exception 'publication verification source ownership required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'contract','listing_publication_verification_source_v1',
           'verificationJobId',verifier.id,
           'sourceJobId',source.id,
           'sourceOperation',source.operation,
           'sourceArguments',source.request_payload->'arguments',
           'sourceResponsePayload',source.response_payload,
           'sourceFingerprint',source.request_payload#>>
             '{arguments,publicationExpectedFingerprint}',
           'expectedRemoteId','1217336970',
           'expectedLocale','ja-JP',
           'expectedImageCount',8,
           'market','JP',
           'targetId',''
         ) into v_source
    from sellerpilot_private.qoo10_exact_no_effect_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = run.verifier_job_id
    join sellerpilot_private.channel_gateway_jobs source
      on source.id = run.source_job_id
   where run.verifier_job_id is not distinct from p_job_id
     and run.contract = 'qoo10_exact_no_remote_effect_verifier_v1'
     and verifier.status = 'running'
     and verifier.claim_token is not distinct from p_claim_token
     and verifier.operation = 'listing.publication.verify'
     and verifier.provider_mutation_started_at is null
     and verifier.request_payload#>'{arguments,sellerpilotReadOnly}' =
           'true'::jsonb
     and verifier.request_payload#>>
           '{arguments,sellerpilotQoo10NoEffectReconciliation}' =
           'qoo10_exact_no_remote_effect_verifier_v1'
     and source.status = 'reconciliation_required'
     and source.request_fingerprint = run.source_request_fingerprint
     and octet_length(source.request_payload::text) = run.source_request_bytes
     and encode(extensions.digest(source.request_payload::text,'sha256'),'hex') =
           run.source_request_sha256
     and octet_length(source.response_payload::text) = run.source_response_bytes
     and encode(extensions.digest(source.response_payload::text,'sha256'),'hex') =
           run.source_response_sha256
     and sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
           source.id,source.request_payload->'arguments',run.release_sha
         )
     and sellerpilot_private.qoo10_exact_no_effect_snapshot(
           source.response_payload#>'{steps,0,data,ResultObject}'
         ) is not null;
  if v_source is not null then return v_source; end if;
  return public.sellerpilot_082000_listing_publication_source_before_qoo10_no_effect(
    p_token_hash,p_job_id,p_claim_token
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_listing_publication_verification_source(
    text,uuid,uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_listing_publication_verification_source(
    text,uuid,uuid
  ) to service_role;

alter table sellerpilot_private.qoo10_exact_localization_update_permits
  drop constraint qoo10_exact_localization_update_permit_binding_check;
alter table sellerpilot_private.qoo10_exact_localization_update_permits
  add constraint qoo10_exact_localization_update_permit_binding_check check (
    (
      invalidated_at is null and invalidation_reason is null
      and (
        (
          update_job_id is null and update_attempt_id is null
          and arguments_sha256 is null and arguments_bytes is null
          and request_payload_sha256 is null and request_payload_bytes is null
          and bound_at is null and bound_worker_token_id is null
          and bound_claim_token is null and consumed_at is null
        ) or (
          update_job_id is not null and update_attempt_id is not null
          and arguments_sha256 ~ '^[a-f0-9]{64}$'
          and arguments_bytes between 100 and 128000
          and request_payload_sha256 ~ '^[a-f0-9]{64}$'
          and request_payload_bytes between 100 and 128000
          and (
            (
              bound_at is null and bound_worker_token_id is null
              and bound_claim_token is null and consumed_at is null
            ) or (
              bound_at is not null and bound_worker_token_id is not null
              and bound_claim_token is not null
              and (consumed_at is null or consumed_at >= bound_at)
            )
          )
        )
      )
    ) or (
      invalidated_at is not null and invalidation_reason = 'expired_before_job'
      and update_job_id is null and update_attempt_id is null
      and arguments_sha256 is null and arguments_bytes is null
      and request_payload_sha256 is null and request_payload_bytes is null
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
    ) or (
      invalidated_at is not null
      and invalidation_reason = 'no_remote_effect_verified'
      and update_job_id is not null and update_attempt_id is not null
      and arguments_sha256 ~ '^[a-f0-9]{64}$'
      and arguments_bytes between 100 and 128000
      and request_payload_sha256 ~ '^[a-f0-9]{64}$'
      and request_payload_bytes between 100 and 128000
      and bound_at is not null and bound_worker_token_id is not null
      and bound_claim_token is not null and consumed_at is not null
      and consumed_at >= bound_at and invalidated_at >= consumed_at
    )
  );

create or replace function sellerpilot_private.guard_qoo10_exact_localization_update_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_marker jsonb:=new.request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
begin
  if tg_op = 'UPDATE'
     and old.status = 'reconciliation_required'
     and new.status = 'failed'
     and current_setting(
           'sellerpilot.qoo10_no_effect_reconcile_source',true
         ) is not distinct from old.id::text
     and to_jsonb(new) - array['status','error_message','updated_at']
           is not distinct from
         to_jsonb(old) - array['status','error_message','updated_at']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
        where evidence.source_job_id = old.id
          and evidence.source_attempt_id = old.attempt_id
          and evidence.listing_id = old.listing_id
          and evidence.credential_id = old.credential_id
          and evidence.remote_id = '1217336970'
          and evidence.resolution = 'no_remote_effect'
          and not evidence.provider_call_replayed
     )
  then
    return new;
  end if;
  if new.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and v_marker is null
  then return new; end if;
  if new.operation is distinct from 'listing.update' and v_marker is null then
    return new;
  end if;
  if new.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or new.credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or new.channel is distinct from 'qoo10'
     or new.operation is distinct from 'listing.update'
     or new.environment is distinct from 'production'
     or new.seller_account_key is distinct from
       '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_update_permits permit
        where permit.update_job_id=new.id
          and permit.update_attempt_id=new.attempt_id
          and permit.listing_id=new.listing_id
          and permit.credential_id=new.credential_id
          and permit.seller_account_key=new.seller_account_key
          and permit.release_sha=v_marker->>'releaseSha'
          and permit.request_fingerprint=new.request_fingerprint
          and permit.arguments_sha256=encode(extensions.digest(
                (new.request_payload->'arguments')::text,'sha256'
              ),'hex')
          and permit.arguments_bytes=octet_length(
                (new.request_payload->'arguments')::text
              )
          and permit.request_payload_sha256=encode(extensions.digest(
                new.request_payload::text,'sha256'
              ),'hex')
          and permit.request_payload_bytes=octet_length(new.request_payload::text)
          and permit.invalidated_at is null
          and sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
                new.request_payload->'arguments',permit.release_sha
              )
     )
  then
    raise exception 'exact Qoo10 localization update job lineage invalid'
      using errcode='55000';
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'exact Qoo10 localization update job lineage invalid'
    using errcode='55000';
end;
$$;

create function public.sellerpilot_service_reconcile_exact_qoo10_no_remote_effect(
  p_source_job_id uuid,
  p_verifier_job_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run sellerpilot_private.qoo10_exact_no_effect_verifier_runs%rowtype;
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing sellerpilot_private.qoo10_exact_no_effect_reconciliations%rowtype;
  v_prewrite jsonb;
  v_current jsonb;
  v_source_request_sha text;
  v_source_response_sha text;
  v_verifier_response_sha text;
  v_is_v2 boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,901082000);
  if p_source_job_id is null
     or p_verifier_job_id is null
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
  then
    raise exception 'exact Qoo10 no-effect reconciliation identity invalid'
      using errcode = '55000';
  end if;

  select * into v_existing
    from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
   where evidence.source_job_id = p_source_job_id;
  if found then
    if v_existing.verifier_job_id is distinct from p_verifier_job_id
       or v_existing.resolution is distinct from 'no_remote_effect'
       or v_existing.prewrite_snapshot is distinct from
            v_existing.current_snapshot
       or not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs source
          where source.id = p_source_job_id and source.status = 'failed'
       )
    then
      raise exception 'exact Qoo10 no-effect reconciliation replay conflict'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract','qoo10_exact_no_remote_effect_reconciliation_v1',
      'sourceJobId',p_source_job_id,
      'verifierJobId',p_verifier_job_id,
      'resolution','no_remote_effect',
      'sourceStatus','failed',
      'localizationPermitReady',true,
      'activationStillRequiresFreshS1Verifier',true,
      'reused',true
    );
  end if;

  select * into v_run
    from sellerpilot_private.qoo10_exact_no_effect_verifier_runs run
   where run.source_job_id = p_source_job_id
     and run.verifier_job_id = p_verifier_job_id
   for update;
  if not found
     or v_run.release_sha is distinct from p_release_sha
     or v_run.contract is distinct from
          'qoo10_exact_no_remote_effect_verifier_v1'
  then
    raise exception 'exact Qoo10 no-effect verifier run missing'
      using errcode = '55000';
  end if;

  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = p_source_job_id
   for update;
  select * into strict v_verifier
    from sellerpilot_private.channel_gateway_jobs verifier
   where verifier.id = p_verifier_job_id
   for update;

  v_source_request_sha := encode(
    extensions.digest(v_source.request_payload::text,'sha256'),'hex'
  );
  v_source_response_sha := encode(
    extensions.digest(v_source.response_payload::text,'sha256'),'hex'
  );
  v_verifier_response_sha := encode(
    extensions.digest(v_verifier.response_payload::text,'sha256'),'hex'
  );
  v_prewrite := sellerpilot_private.qoo10_exact_no_effect_snapshot(
    v_source.response_payload#>'{steps,0,data,ResultObject}'
  );
  v_current := sellerpilot_private.qoo10_exact_no_effect_snapshot(
    v_verifier.response_payload#>'{steps,0,data,ResultObject}'
  );
  v_is_v2 := v_source.request_payload#>>
    '{arguments,sellerpilotQoo10ExactLocalization,contract}' =
      'qoo10_exact_localization_update_v2';

  if v_source.listing_id is distinct from v_run.listing_id
     or v_source.credential_id is distinct from v_run.credential_id
     or v_source.attempt_id is distinct from v_run.source_attempt_id
     or v_source.channel is distinct from 'qoo10'
     or v_source.operation is distinct from 'listing.update'
     or v_source.environment is distinct from 'production'
     or v_source.status is distinct from 'reconciliation_required'
     or v_source.seller_account_key is distinct from v_run.seller_account_key
     or v_source.request_fingerprint is distinct from
          v_run.source_request_fingerprint
     or v_source.attempt_count <> 1
     or v_source.provider_mutation_started_at is null
     or v_source.completed_at is null
     or v_source_request_sha is distinct from v_run.source_request_sha256
     or v_source_response_sha is distinct from v_run.source_response_sha256
     or octet_length(v_source.request_payload::text) is distinct from
          v_run.source_request_bytes
     or octet_length(v_source.response_payload::text) is distinct from
          v_run.source_response_bytes
     or not sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
          v_source.id,v_source.request_payload->'arguments',p_release_sha
        )
     or v_source.response_payload#>>'{steps,0,name}' is distinct from
          'qoo10-exact-current-s1-prewrite-readback'
     or v_source.response_payload#>>'{steps,0,ok}' is distinct from 'true'
     or v_source.response_payload#>>'{steps,0,status}' !~ '^2[0-9][0-9]$'
     or v_source.response_payload#>>'{steps,0,data,ResultCode}'
          is distinct from '0'
  then
    raise exception 'exact Qoo10 source evidence drifted'
      using errcode = '55000';
  end if;

  if v_verifier.id is distinct from v_run.verifier_job_id
     or v_verifier.listing_id is distinct from v_run.listing_id
     or v_verifier.credential_id is distinct from v_run.credential_id
     or v_verifier.attempt_id is not null
     or v_verifier.channel is distinct from 'qoo10'
     or v_verifier.operation is distinct from 'listing.publication.verify'
     or v_verifier.environment is distinct from 'production'
     or v_verifier.status is distinct from 'failed'
     or v_verifier.seller_account_key is distinct from v_run.seller_account_key
     or v_verifier.provider_mutation_started_at is not null
     or v_verifier.completed_at is null
     or v_verifier.request_payload#>'{arguments,sellerpilotReadOnly}'
          is distinct from 'true'::jsonb
     or v_verifier.request_payload#>>
          '{arguments,sellerpilotQoo10NoEffectReconciliation}'
          is distinct from 'qoo10_exact_no_remote_effect_verifier_v1'
     or v_verifier.request_payload#>>'{arguments,publicationReviewSourceJobId}'
          is distinct from v_source.id::text
     or v_verifier.response_payload->>'ok' is distinct from 'false'
     or v_verifier.response_payload->>'publicationFulfilled'
          is distinct from 'false'
     or jsonb_typeof(v_verifier.response_payload->'steps')
          is distinct from 'array'
     or jsonb_array_length(v_verifier.response_payload->'steps') <> 1
     or v_verifier.response_payload#>>'{steps,0,name}' is distinct from
          'GetItemDetailInfo-publication-reverification'
     or v_verifier.response_payload#>>'{steps,0,ok}' is distinct from 'true'
     or v_verifier.response_payload#>>'{steps,0,status}' !~ '^2[0-9][0-9]$'
     or v_verifier.response_payload#>>'{steps,0,data,ResultCode}'
          is distinct from '0'
     or (
       select count(*) from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_verifier.id
     ) <> 1
  then
    raise exception 'exact Qoo10 current readback evidence incomplete'
      using errcode = '55000';
  end if;

  if v_prewrite is null or v_current is null then
    raise exception 'exact Qoo10 snapshot field missing'
      using errcode = '55000';
  end if;
  if not sellerpilot_private.qoo10_exact_no_effect_snapshots_identical(
       v_source.response_payload#>'{steps,0,data,ResultObject}',
       v_verifier.response_payload#>'{steps,0,data,ResultObject}'
     )
     or v_prewrite is distinct from v_current
  then
    raise exception 'exact Qoo10 current readback differs from prewrite snapshot'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs later_job
     where later_job.listing_id = v_source.listing_id
       and later_job.created_at > v_source.created_at
       and later_job.id is distinct from v_verifier.id
       and later_job.operation in (
         'listing.create','listing.update','listing.stop','listing.activate',
         'price.update','inventory.update'
       )
  ) then
    raise exception 'exact Qoo10 later mutation prevents no-effect attribution'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_exact_no_effect_reconciliations (
    source_job_id,source_attempt_id,verifier_job_id,listing_id,product_id,
    credential_id,owner_id,remote_id,seller_account_key,source_request_sha256,
    source_response_sha256,verifier_response_sha256,prewrite_snapshot,
    current_snapshot,snapshot_sha256,resolution,provider_call_replayed,
    reconciled_at
  ) values (
    v_source.id,v_source.attempt_id,v_verifier.id,v_run.listing_id,
    v_run.product_id,v_run.credential_id,v_run.owner_id,v_run.remote_id,
    v_run.seller_account_key,v_source_request_sha,v_source_response_sha,
    v_verifier_response_sha,v_prewrite,v_current,
    v_prewrite->>'snapshotSha256','no_remote_effect',false,clock_timestamp()
  );

  if v_is_v2 then
    update sellerpilot_private.qoo10_exact_localization_update_permits permit
       set invalidated_at=clock_timestamp(),
           invalidation_reason='no_remote_effect_verified'
     where permit.update_job_id=v_source.id
       and permit.update_attempt_id=v_source.attempt_id
       and permit.invalidated_at is null
       and permit.bound_at is not null
       and permit.consumed_at is not null;
    if not found then
      raise exception 'exact Qoo10 consumed localization permit missing'
        using errcode = '55000';
    end if;
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_no_effect_reconcile_source',v_source.id::text,true
  );
  update sellerpilot_private.channel_gateway_jobs source
     set status='failed',
         error_message=
           'QOO10_NO_REMOTE_EFFECT_VERIFIED: provider prewrite/current snapshots are identical; one new exact localization permit may be armed.',
         updated_at=clock_timestamp()
   where source.id=v_source.id
     and source.status='reconciliation_required';
  if not found then
    raise exception 'exact Qoo10 source reconciliation transition failed'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status='failed',
         http_status=409,
         safe_message=
           'Qoo10 원격 변경 없음 검증 완료 · 새 현지화 수정 1회만 허용'
   where attempt.id=v_source.attempt_id
     and attempt.status='manual_required';
  if not found then
    raise exception 'exact Qoo10 attempt reconciliation transition failed'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,action,entity_type,entity_id,safe_detail
  ) values (
    v_run.owner_id,'qoo10_exact_no_remote_effect_reconciled',
    'product_listing',v_run.listing_id::text,
    jsonb_build_object(
      'source_job_id',v_source.id,
      'verifier_job_id',v_verifier.id,
      'remote_id',v_run.remote_id,
      'snapshot_sha256',v_prewrite->>'snapshotSha256',
      'provider_call_replayed',false
    )
  );

  return jsonb_build_object(
    'contract','qoo10_exact_no_remote_effect_reconciliation_v1',
    'sourceJobId',v_source.id,
    'verifierJobId',v_verifier.id,
    'resolution','no_remote_effect',
    'sourceStatus','failed',
    'snapshotSha256',v_prewrite->>'snapshotSha256',
    'localizationPermitReady',true,
    'activationStillRequiresFreshS1Verifier',true,
    'reused',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_reconcile_exact_qoo10_no_remote_effect(
    uuid,uuid,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_reconcile_exact_qoo10_no_remote_effect(
    uuid,uuid,text
  ) to service_role;

create or replace function public.sellerpilot_service_arm_exact_qoo10_localization_update(
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
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  if p_listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or p_credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(
       p_release_sha
     )
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_source_retirements retirement
        where retirement.source_job_id =
              'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
          and retirement.source_attempt_id =
              '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
          and retirement.listing_id = p_listing_id
          and retirement.remote_id = '1217336970'
          and retirement.replacement_contract =
                'qoo10_exact_localization_update_v2'
          and not retirement.provider_call_replayed
     )
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
        where evidence.listing_id = p_listing_id
          and evidence.product_id =
                'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
          and evidence.credential_id = p_credential_id
          and evidence.remote_id = '1217336970'
          and evidence.resolution = 'no_remote_effect'
          and evidence.prewrite_snapshot = evidence.current_snapshot
          and not evidence.provider_call_replayed
          and exists (
            select 1
              from sellerpilot_private.channel_gateway_jobs source
             where source.id = evidence.source_job_id
               and source.status = 'failed'
          )
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs source
        where source.listing_id = p_listing_id
          and source.channel is not distinct from 'qoo10'
          and source.operation is not distinct from 'listing.update'
          and source.request_payload#>>
                '{arguments,sellerpilotQoo10ExactLocalization,contract}' =
                'qoo10_exact_localization_update_v2'
          and not exists (
            select 1
              from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
             where evidence.source_job_id = source.id
               and evidence.resolution = 'no_remote_effect'
               and evidence.prewrite_snapshot = evidence.current_snapshot
               and not evidence.provider_call_replayed
          )
     )
  then
    raise exception 'exact Qoo10 localization update permit identity invalid'
      using errcode='55000';
  end if;

  update sellerpilot_private.qoo10_exact_localization_update_permits permit
     set invalidated_at=clock_timestamp(),
         invalidation_reason='expired_before_job'
   where permit.listing_id=p_listing_id
     and permit.invalidated_at is null
     and permit.update_job_id is null
     and permit.expires_at <= statement_timestamp();

  select * into v_permit
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.listing_id=p_listing_id
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.update_job_id is not null
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.expires_at <= statement_timestamp()
    then
      raise exception 'exact Qoo10 localization update permit conflict'
        using errcode='55000';
    end if;
    return jsonb_build_object(
      'contract','qoo10_exact_localization_update_permit_v2',
      'permitId',v_permit.permit_id,
      'listingId',v_permit.listing_id,
      'releaseSha',v_permit.release_sha,
      'requestFingerprint',v_permit.request_fingerprint,
      'armedAt',v_permit.armed_at,
      'expiresAt',v_permit.expires_at,
      'bound',false,
      'reused',true
    );
  end if;

  insert into sellerpilot_private.qoo10_exact_localization_update_permits (
    source_job_id,listing_id,product_id,credential_id,owner_id,remote_id,
    seller_account_key,release_sha,request_fingerprint,armed_at,expires_at
  ) values (
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
    p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '1217336970',
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46',
    p_release_sha,p_request_fingerprint,clock_timestamp(),
    clock_timestamp()+interval '5 minutes'
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract','qoo10_exact_localization_update_permit_v2',
    'permitId',v_permit.permit_id,
    'listingId',v_permit.listing_id,
    'releaseSha',v_permit.release_sha,
    'requestFingerprint',v_permit.request_fingerprint,
    'armedAt',v_permit.armed_at,
    'expiresAt',v_permit.expires_at,
    'bound',false,
    'reused',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_arm_exact_qoo10_localization_update(
    uuid,uuid,text,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_arm_exact_qoo10_localization_update(
    uuid,uuid,text,text
  ) to service_role;

alter function public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(
  uuid,text
) rename to sellerpilot_082000_enqueue_qoo10_activation_before_no_effect;
revoke all on function
  public.sellerpilot_082000_enqueue_qoo10_activation_before_no_effect(uuid,text)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(
  p_verifier_job_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,901082000);
  if not exists (
    select 1
      from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
     where evidence.listing_id =
           '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and evidence.product_id =
           'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and evidence.remote_id = '1217336970'
       and evidence.resolution = 'no_remote_effect'
       and evidence.prewrite_snapshot = evidence.current_snapshot
       and not evidence.provider_call_replayed
  ) then
    raise exception 'exact Qoo10 no-effect reconciliation required before activation'
      using errcode = '55000';
  end if;
  return public.sellerpilot_082000_enqueue_qoo10_activation_before_no_effect(
    p_verifier_job_id,p_release_sha
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(
    uuid,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(
    uuid,text
  ) to service_role;

do $qoo10_no_effect_postimage$
declare
  v_enqueue regprocedure := pg_catalog.to_regprocedure(
    'public.sellerpilot_service_enqueue_exact_qoo10_no_effect_verifier(uuid,text)'
  );
  v_reconcile regprocedure := pg_catalog.to_regprocedure(
    'public.sellerpilot_service_reconcile_exact_qoo10_no_remote_effect(uuid,uuid,text)'
  );
  v_arm_definition text;
  v_activation_definition text;
begin
  if v_enqueue is null or v_reconcile is null
     or 2 <> (
       select count(*)
         from pg_catalog.pg_proc procedure
        where procedure.oid in (v_enqueue,v_reconcile)
          and procedure.prosecdef
          and procedure.proconfig = array['search_path=""']::text[]
     )
  then
    raise exception 'exact Qoo10 no-effect service boundary missing'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_exact_qoo10_localization_update(uuid,uuid,text,text)'::regprocedure
  ) into v_arm_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(uuid,text)'::regprocedure
  ) into v_activation_definition;
  if pg_catalog.strpos(v_arm_definition,
       'qoo10_exact_no_effect_reconciliations') = 0
     or pg_catalog.strpos(v_activation_definition,
       'qoo10_exact_no_effect_reconciliations') = 0
  then
    raise exception 'exact Qoo10 downstream permits are not no-effect gated'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from (values
      ('public'::name),('anon'::name),('authenticated'::name)
    ) role(role_name)
    cross join (values (v_enqueue),(v_reconcile)) function(oid)
     where pg_catalog.has_function_privilege(
       role.role_name,function.oid,'EXECUTE'
     )
  ) then
    raise exception 'exact Qoo10 no-effect public ACL drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_no_effect_postimage$;

comment on table sellerpilot_private.qoo10_exact_no_effect_reconciliations is
  'Immutable exact-item proof that Qoo10 ItemCode 1217336970 had no remote effect: every required prewrite/current field and fingerprint matched before the uncertain job was failed.';
comment on function
  public.sellerpilot_service_reconcile_exact_qoo10_no_remote_effect(
    uuid,uuid,text
  ) is
  'Fail-closed exact Qoo10 no_remote_effect adjudicator. Missing, partial, or mismatched title, SKU, S1 status, prices, stock, representative image, detail HTML, or ordered eight-image evidence leaves reconciliation_required.';

commit;
