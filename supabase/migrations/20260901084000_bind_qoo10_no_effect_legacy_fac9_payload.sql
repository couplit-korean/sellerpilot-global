-- The historical fac9 Qoo10 update predates the v2 localization payload: its
-- exact immutable request intentionally omits ItemPrice, ItemQty, and may omit
-- SellerCode. Bind that legacy shape to its known request/response digests and
-- rollback expectation while retaining the stricter v2 branch.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 901084000);

do $qoo10_no_effect_legacy_history_fence$
declare
  v_history_table regclass;
begin
  v_history_table := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if exists (
      select 1
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260901084000'
         and migration.name is distinct from
               'bind_qoo10_no_effect_legacy_fac9_payload'
    ) then
      raise exception 'exact Qoo10 legacy no-effect migration history drifted'
        using errcode = '55000';
    end if;
  end if;
end;
$qoo10_no_effect_legacy_history_fence$;

create or replace function sellerpilot_private.qoo10_exact_no_effect_alias_value(
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
  select pg_catalog.array_agg(distinct p_item->>alias)
    into v_values
    from unnest(p_aliases) alias
   where p_item ? alias
     and jsonb_typeof(p_item->alias) in ('string','number')
     and pg_catalog.btrim(coalesce(p_item->>alias,'')) <> '';
  if coalesce(pg_catalog.cardinality(v_values),0) <> 1 then return null; end if;
  return v_values[1];
end;
$$;

create or replace function sellerpilot_private.qoo10_exact_no_effect_snapshot(
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
     or v_title is null
     or pg_catalog.octet_length(v_title) not between 1 and 2000
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

create or replace function
sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
  p_source_job_id uuid,
  p_arguments jsonb,
  p_release_sha text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_params jsonb := p_arguments->'params';
  v_marker jsonb := p_arguments->'sellerpilotQoo10ExactLocalization';
  v_recovery jsonb := p_arguments->'sellerpilotQoo10RollbackUpdateRecovery';
  v_expected jsonb := v_recovery->'expectedState';
  v_legacy boolean;
  v_v2 boolean;
begin
  if p_source_job_id is null
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or jsonb_typeof(v_params) is distinct from 'object'
  then return false; end if;

  v_legacy := p_source_job_id =
      'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs source
       where source.id = p_source_job_id
         and source.request_payload->'arguments' is not distinct from p_arguments
         and pg_catalog.octet_length(source.request_payload::text) = 23555
         and encode(
               extensions.digest(source.request_payload::text,'sha256'),'hex'
             ) =
             'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
         and pg_catalog.octet_length(source.response_payload::text) = 16669
         and encode(
               extensions.digest(source.response_payload::text,'sha256'),'hex'
             ) =
             'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
    )
    and jsonb_typeof(v_recovery) = 'object'
    and jsonb_typeof(v_expected) = 'object'
    and v_recovery->>'status' is not distinct from 'allowed'
    and v_recovery->>'contract' is not distinct from
          'qoo10_create_rollback_confirmation_v1'
    and v_recovery->>'listingId' is not distinct from
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
    and v_recovery->>'remoteId' is not distinct from '1217336970'
    and v_recovery->>'providerStatus' is not distinct from 'S1'
    and v_expected->>'categoryCode' is not distinct from '320000542'
    and v_expected->>'retailPriceJpy' is not distinct from '1871'
    and v_expected->>'sellPriceJpy' is not distinct from '1871'
    and v_expected->>'quantity' is not distinct from '1'
    and v_expected->>'shippingNo' is not distinct from '806971'
    and v_expected->>'biContentsNo' is not distinct from '8461402963'
    and v_params->>'SecondSubCat' is not distinct from '320000542'
    and v_params->>'ProductionPlaceType' is not distinct from '2'
    and v_params->>'ProductionPlace' is not distinct from 'CN'
    and v_params->>'ShippingNo' is not distinct from '806971'
    and v_params->>'AdultYN' is not distinct from 'N'
    and not (v_params ? 'ItemPrice')
    and not (v_params ? 'ItemQty')
    and (
      not (v_params ? 'SellerCode')
      or v_params->>'SellerCode' is not distinct from 'QA-20260823-CC-001'
    );

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
    and v_marker->>'releaseSha' is not distinct from p_release_sha
    and v_params->>'SellerCode' is not distinct from 'QA-20260823-CC-001'
    and v_params->>'ItemPrice' is not distinct from '1871'
    and v_params->>'ItemQty' is not distinct from '1';

  return (v_legacy or v_v2)
    and v_params->>'ItemCode' is not distinct from '1217336970'
    and v_params->>'RetailPrice' is not distinct from '1871'
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
  sellerpilot_private.qoo10_exact_no_effect_alias_value(jsonb,text[]),
  sellerpilot_private.qoo10_exact_no_effect_snapshot(jsonb),
  sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(uuid,jsonb,text)
  from public, anon, authenticated, service_role;

do $qoo10_no_effect_legacy_postimage$
declare
  v_proc regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(uuid,jsonb,text)'
  );
  v_alias_proc regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.qoo10_exact_no_effect_alias_value(jsonb,text[])'
  );
  v_snapshot_proc regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.qoo10_exact_no_effect_snapshot(jsonb)'
  );
  v_definition text;
  v_snapshot_definition text;
begin
  if v_proc is null or v_alias_proc is null or v_snapshot_proc is null then
    raise exception 'exact Qoo10 legacy no-effect validator missing'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(v_proc) into v_definition;
  select pg_catalog.pg_get_functiondef(v_snapshot_proc)
    into v_snapshot_definition;
  if not exists (
       select 1
         from pg_catalog.pg_proc procedure
        where procedure.oid = v_proc
          and procedure.provolatile = 's'
          and not procedure.prosecdef
          and procedure.proconfig = array['search_path=""']::text[]
     )
     or 2 <> (
       select count(*)
         from pg_catalog.pg_proc procedure
        where procedure.oid in (v_alias_proc,v_snapshot_proc)
          and procedure.provolatile = 'i'
          and not procedure.prosecdef
          and procedure.proconfig = array['search_path=""']::text[]
     )
     or pg_catalog.strpos(v_definition,
          'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d') = 0
     or pg_catalog.strpos(v_definition,
          'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768') = 0
     or pg_catalog.strpos(v_definition,
          'qoo10_create_rollback_confirmation_v1') = 0
     or pg_catalog.strpos(v_snapshot_definition,
          '貼り付け式ケーブル整理クリップ6個セット') <> 0
  then
    raise exception 'exact Qoo10 legacy no-effect validator postimage drifted'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from (values ('public'::name),('anon'::name),('authenticated'::name)) role(role_name)
      cross join (values (v_alias_proc),(v_snapshot_proc),(v_proc)) function(oid)
     where pg_catalog.has_function_privilege(role.role_name,function.oid,'EXECUTE')
  ) then
    raise exception 'exact Qoo10 legacy no-effect validator ACL drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_no_effect_legacy_postimage$;

comment on function
  sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(uuid,jsonb,text)
is
  'Exact source validator: fac9 is accepted only with its immutable legacy request/response digests, absent ItemPrice/ItemQty, and exact rollback expected state; v2 remains strict.';

commit;
