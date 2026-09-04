-- Follow-up to 20260905003000. Do not rewrite that applied history.
-- Verifier 457b4481-0a66-4a76-89a0-884087d0c22e is terminal
-- reconciliation_required with no provider mutation. Mutable GET checks only
-- failed keyword/promotion against the update payload. The live GET kept the
-- original create PromotionName and a token subset of the original create
-- Keyword. Do not enqueue a new verifier or rewrite the verifier job.
-- A server-owned read-only GET payload may record one observation and arm the
-- one-use activation permit in the same transaction. The 2-minute permit
-- window is unchanged. Source jobs are not rewritten.
-- Fresh GET must prove every publicationChecks-critical field against the
-- current create/update jobs. Do not trust the stale verifier response.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500142);

create function sellerpilot_private.qoo10_shipping_s1_create_keyword_contains_remote(
  p_create_keyword text,
  p_remote_keyword text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_create_keyword <> ''
    and p_remote_keyword <> ''
    and not exists (
      select 1
        from unnest(pg_catalog.string_to_array(p_create_keyword, ',')) token
       where token = '' or token <> pg_catalog.btrim(token)
    )
    and not exists (
      select 1
        from unnest(pg_catalog.string_to_array(p_remote_keyword, ',')) token
       where token = '' or token <> pg_catalog.btrim(token)
    )
    and (
      select count(*)
        from unnest(pg_catalog.string_to_array(p_create_keyword, ',')) token
    ) = (
      select count(distinct token)
        from unnest(pg_catalog.string_to_array(p_create_keyword, ',')) token
    )
    and (
      select count(*)
        from unnest(pg_catalog.string_to_array(p_remote_keyword, ',')) token
    ) = (
      select count(distinct token)
        from unnest(pg_catalog.string_to_array(p_remote_keyword, ',')) token
    )
    and not exists (
      select 1
        from unnest(pg_catalog.string_to_array(p_remote_keyword, ',')) remote_token
       where not exists (
         select 1
           from unnest(pg_catalog.string_to_array(p_create_keyword, ',')) create_token
          where create_token = remote_token
       )
    )
$$;

create function sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
  p_item jsonb,
  p_create_arguments jsonb,
  p_update_arguments jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_create_params jsonb := p_create_arguments->'params';
  v_update_params jsonb := p_update_arguments->'params';
  v_recovery jsonb :=
    p_update_arguments#>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState}';
  v_remote_html text := coalesce(
    p_item->>'ItemDetail', p_item->>'ItemDescription', p_item->>'Description', ''
  );
  v_update_html text := coalesce(v_update_params->>'ItemDescription', '');
  v_remote_images jsonb;
  v_update_images jsonb;
  v_retail text := coalesce(p_item->>'RetailPrice', '');
  v_sell text := coalesce(p_item->>'SellPrice', p_item->>'ItemPrice', '');
  v_quantity text := coalesce(
    p_item->>'ItemQty', p_item->>'Qty', p_item->>'StockQty', ''
  );
  v_bi text := v_recovery->>'biContentsNo';
begin
  v_remote_images := sellerpilot_private.qoo10_exact_detail_image_urls(v_remote_html);
  v_update_images := sellerpilot_private.qoo10_exact_detail_image_urls(v_update_html);
  return jsonb_typeof(p_item) = 'object'
    and jsonb_typeof(v_create_params) = 'object'
    and jsonb_typeof(v_update_params) = 'object'
    and jsonb_typeof(v_recovery) = 'object'
    and v_update_params->>'ShippingNo' = '0'
    and v_recovery->>'shippingNo' = '0'
    and p_update_arguments->>'publicationExpectedLocale' = 'ja-JP'
    and p_update_arguments->>'publicationExpectedFingerprint' ~ '^[a-f0-9]{64}$'
    and p_update_arguments->'publicationExpectedImageCount' = to_jsonb(8)
    and (v_update_params->>'ItemTitle' || v_remote_html) ~ '[ぁ-んァ-ン]'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ItemCode','ItemNo','GdNo']
        )
    and coalesce(p_item->>'ItemCode', p_item->>'ItemNo', p_item->>'GdNo', '')
          = '1217536689'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ItemStatus','Status']
        )
    and upper(coalesce(p_item->>'ItemStatus', p_item->>'Status', '')) = 'S1'
    and sellerpilot_private.qoo10_exact_aliases_consistent(p_item, array['ItemTitle'])
    and coalesce(p_item->>'ItemTitle', '') = v_update_params->>'ItemTitle'
    and coalesce(p_item->>'ItemTitle', '') <> ''
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['Keyword','Keywords']
        )
    and sellerpilot_private.qoo10_shipping_s1_create_keyword_contains_remote(
          v_create_params->>'Keyword',
          coalesce(p_item->>'Keyword', p_item->>'Keywords', '')
        )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['PromotionName','PromotionNm']
        )
    and coalesce(p_item->>'PromotionName', p_item->>'PromotionNm', '') =
          v_create_params->>'PromotionName'
    and coalesce(p_item->>'PromotionName', p_item->>'PromotionNm', '') <> ''
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['IndustrialCode','barcode','gtin']
        )
    and coalesce(
          p_item->>'IndustrialCode', p_item->>'barcode', p_item->>'gtin', ''
        ) = coalesce(v_update_params->>'IndustrialCode', '')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ItemDetail','ItemDescription','Description']
        )
    and v_remote_html <> ''
    and v_update_html <> ''
    and (
      v_remote_html = v_update_html
      or v_remote_html =
           sellerpilot_private.qoo10_canonical_provider_detail_html(v_update_html)
    )
    and v_remote_images = v_update_images
    and jsonb_array_length(v_remote_images) = 8
    and (
      select count(*) = 8
             and count(distinct image.value) = 8
             and bool_and(
               jsonb_typeof(image.value) = 'string'
               and image.value#>>'{}' ~ '^https://[^[:space:]#]+$'
             )
        from jsonb_array_elements(v_remote_images) image(value)
    )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,
          array['SecondSubCat','SecondSubCatCd','CategoryCode','CateSCode']
        )
    and coalesce(
          p_item->>'SecondSubCat', p_item->>'SecondSubCatCd',
          p_item->>'CategoryCode', p_item->>'CateSCode', ''
        ) = v_recovery->>'categoryCode'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['RetailPrice']
        )
    and v_retail ~ '^[0-9]+(?:[.]0+)?$'
    and v_retail::numeric = (v_recovery->>'retailPriceJpy')::numeric
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['SellPrice','ItemPrice']
        )
    and v_sell ~ '^[0-9]+(?:[.]0+)?$'
    and v_sell::numeric = (v_recovery->>'sellPriceJpy')::numeric
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ItemQty','Qty','StockQty']
        )
    and v_quantity ~ '^[0-9]+$'
    and v_quantity::numeric = (v_recovery->>'quantity')::numeric
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ShippingNo','ShippingNO','DeliveryGroupNo']
        )
    and coalesce(
          p_item->>'ShippingNo', p_item->>'ShippingNO',
          p_item->>'DeliveryGroupNo', ''
        ) = '806971'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['BIContentsNo','BiContentsNo','BIContentsNO']
        )
    and not exists (
      select 1
        from jsonb_each(p_item) field
       where lower(field.key) in (
               lower('BIContentsNo'), lower('BiContentsNo'), lower('BIContentsNO')
             )
         and not (
           jsonb_typeof(field.value) in ('string','number')
           and case
             when field.value#>>'{}' ~ '^[0-9]+$' then
               (field.value#>>'{}')::numeric = v_bi::numeric
             else false
           end
         )
    )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ImageUrl','StandardImage','MainImageUrl']
        )
    and coalesce(p_item->>'ImageUrl', '') <> ''
    and sellerpilot_private.qoo10_exact_representative_image_matches(
          p_item->>'ImageUrl',
          v_bi
        )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ProductionPlaceType','OriginType']
        )
    and coalesce(
          p_item->>'ProductionPlaceType', p_item->>'OriginType', ''
        ) = coalesce(v_update_params->>'ProductionPlaceType', '')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['ProductionPlace','Origin','OriginCode']
        )
    and coalesce(
          p_item->>'ProductionPlace', p_item->>'Origin',
          p_item->>'OriginCode', ''
        ) = coalesce(v_update_params->>'ProductionPlace', '')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item, array['AdultYN','AdultYn','AdultFlag']
        )
    and upper(coalesce(
          p_item->>'AdultYN', p_item->>'AdultYn', p_item->>'AdultFlag', ''
        )) = upper(coalesce(v_update_params->>'AdultYN', ''))
    and (
      coalesce(v_update_params->>'SellerCode', '') = ''
      or coalesce(p_item->>'SellerCode', '') = v_update_params->>'SellerCode'
    );
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_direct_reverify_expectation_valid(
  p_expectation jsonb,
  p_update_arguments jsonb,
  p_create_arguments jsonb,
  p_item jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_expected_state jsonb := p_expectation->'expectedState';
  v_source_state jsonb :=
    p_update_arguments#>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState}';
  v_params jsonb := p_update_arguments->'params';
  v_create_params jsonb := p_create_arguments->'params';
  v_source_detail_images jsonb :=
    sellerpilot_private.qoo10_exact_detail_image_urls(
      p_update_arguments#>>'{params,ItemDescription}'
    );
  v_item_html text := coalesce(
    p_item->>'ItemDetail', p_item->>'ItemDescription', p_item->>'Description', ''
  );
  v_top_keys integer;
  v_state_keys integer;
begin
  if v_params->>'ShippingNo' is distinct from '0'
     or v_source_state->>'shippingNo' is distinct from '0'
  then
    return false;
  end if;
  select count(*) into v_top_keys from jsonb_object_keys(p_expectation);
  select count(*) into v_state_keys from jsonb_object_keys(v_expected_state);
  return jsonb_typeof(p_expectation) = 'object'
    and jsonb_typeof(v_expected_state) = 'object'
    and jsonb_typeof(p_item) = 'object'
    and v_top_keys = case
      when nullif(v_params->>'SellerCode', '') is null then 7 else 8 end
    and v_state_keys = 9
    and v_expected_state->>'categoryCode' = v_source_state->>'categoryCode'
    and jsonb_typeof(v_expected_state->'retailPriceJpy') = 'number'
    and (v_expected_state->>'retailPriceJpy')::numeric =
          (v_source_state->>'retailPriceJpy')::numeric
    and jsonb_typeof(v_expected_state->'sellPriceJpy') = 'number'
    and (v_expected_state->>'sellPriceJpy')::numeric =
          (v_source_state->>'sellPriceJpy')::numeric
    and jsonb_typeof(v_expected_state->'quantity') = 'number'
    and (v_expected_state->>'quantity')::numeric =
          (v_source_state->>'quantity')::numeric
    and v_expected_state->>'shippingNo' = '806971'
    and jsonb_typeof(v_expected_state->'biContentsNo') = 'number'
    and (v_expected_state->>'biContentsNo')::numeric =
          (v_source_state->>'biContentsNo')::numeric
    and v_expected_state->>'originType' = v_params->>'ProductionPlaceType'
    and v_expected_state->>'originCode' = v_params->>'ProductionPlace'
    and v_expected_state->>'adultYn' = v_params->>'AdultYN'
    and p_expectation->>'expectedTitle' = v_params->>'ItemTitle'
    and p_expectation->>'expectedTitle' = p_item->>'ItemTitle'
    and p_expectation->>'expectedKeyword' =
          coalesce(p_item->>'Keyword', p_item->>'Keywords', '')
    and sellerpilot_private.qoo10_shipping_s1_create_keyword_contains_remote(
          v_create_params->>'Keyword',
          p_expectation->>'expectedKeyword'
        )
    and p_expectation->>'expectedPromotionName' =
          coalesce(v_create_params->>'PromotionName', '')
    and p_expectation->>'expectedPromotionName' =
          coalesce(p_item->>'PromotionName', p_item->>'PromotionNm', '')
    and p_expectation->>'expectedIndustrialCode' =
          coalesce(v_params->>'IndustrialCode', '')
    and (
      p_expectation->>'expectedDetailHtmlSha256' = encode(
        extensions.digest(v_params->>'ItemDescription', 'sha256'), 'hex'
      )
      or p_expectation->>'expectedDetailHtmlSha256' = encode(
        extensions.digest(
          sellerpilot_private.qoo10_canonical_provider_detail_html(
            v_params->>'ItemDescription'
          ),
          'sha256'
        ),
        'hex'
      )
    )
    and p_expectation->'expectedDetailImageUrls' = v_source_detail_images
    and p_expectation->'expectedDetailImageUrls' =
          sellerpilot_private.qoo10_exact_detail_image_urls(v_item_html)
    and jsonb_array_length(p_expectation->'expectedDetailImageUrls') = 8
    and (
      select count(*) = 8
             and count(distinct image.value) = 8
             and bool_and(
               jsonb_typeof(image.value) = 'string'
               and image.value#>>'{}' ~ '^https://[^[:space:]#]+$'
             )
        from jsonb_array_elements(
          p_expectation->'expectedDetailImageUrls'
        ) image(value)
    )
    and (
      nullif(v_params->>'SellerCode', '') is null
      or (
        p_expectation->>'expectedSellerCode' = v_params->>'SellerCode'
        and coalesce(p_item->>'SellerCode', '') = v_params->>'SellerCode'
      )
    );
exception when others then
  return false;
end;
$$;

create function public.sellerpilot_service_record_qoo10_shipping_s1_direct_reverify(
  p_verifier_job_id uuid,
  p_release_sha text,
  p_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_run sellerpilot_private.qoo10_shipping_s1_verifier_runs%rowtype;
  v_create sellerpilot_private.channel_gateway_jobs%rowtype;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_item jsonb;
  v_count integer;
  v_verified_at timestamptz;
  v_response jsonb;
  v_expectation jsonb;
  v_detail_images jsonb;
  v_job_id uuid := gen_random_uuid();
  v_attempt_id uuid := gen_random_uuid();
  v_arguments jsonb;
  v_marker jsonb;
  v_payload jsonb;
  v_request_sha text;
  v_resource_key text;
  v_seller_code text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
  if p_verifier_job_id is distinct from
       '457b4481-0a66-4a76-89a0-884087d0c22e'::uuid
     or not sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
  then
    raise exception 'exact Qoo10 shipping S1 direct reverify preconditions are not met'
      using errcode = '55000';
  end if;

  select * into v_run
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs
   where verifier_job_id = p_verifier_job_id;
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs
   where id = p_verifier_job_id;
  if v_run.verifier_job_id is null
     or v_job.id is null
     or v_job.status is distinct from 'reconciliation_required'
     or v_job.provider_mutation_started_at is not null
     or v_job.credential_refresh_in_flight
     or not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(v_job)
     or exists (
       select 1 from sellerpilot_private.qoo10_shipping_s1_observations
        where verifier_job_id = p_verifier_job_id
     )
     or exists (
       select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits
        where invalidated_at is null
     )
  then
    raise exception 'exact Qoo10 shipping S1 verifier is not eligible for direct reverify'
      using errcode = '55000';
  end if;

  if jsonb_typeof(p_readback) is distinct from 'object'
     or p_readback->>'ResultCode' is distinct from '0'
  then
    raise exception 'exact Qoo10 shipping S1 direct reverify readback is not ResultCode 0'
      using errcode = '55000';
  end if;
  select count(distinct coalesce(item->>'ItemCode', item->>'GdNo', item->>'ItemNo'))
    into v_count
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(p_readback->'ResultObject', p_readback), '1217536689'
    ) item;
  if v_count is distinct from 1 then
    raise exception 'exact Qoo10 shipping S1 direct reverify item is not unique'
      using errcode = '55000';
  end if;
  select item into v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(p_readback->'ResultObject', p_readback), '1217536689'
    ) item;

  select * into strict v_create
    from sellerpilot_private.channel_gateway_jobs
   where id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid;
  select * into strict v_update
    from sellerpilot_private.channel_gateway_jobs
   where id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;
  if not sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
    v_item,
    v_create.request_payload->'arguments',
    v_update.request_payload->'arguments'
  ) then
    raise exception 'exact Qoo10 shipping S1 GET did not retain create metadata'
      using errcode = '55000';
  end if;

  v_detail_images := sellerpilot_private.qoo10_exact_detail_image_urls(
    v_update.request_payload#>>'{arguments,params,ItemDescription}'
  );
  if jsonb_typeof(v_detail_images) is distinct from 'array'
     or jsonb_array_length(v_detail_images) is distinct from 8
  then
    raise exception 'exact Qoo10 shipping S1 detail image evidence is not current'
      using errcode = '55000';
  end if;
  v_seller_code := nullif(v_update.request_payload#>>'{arguments,params,SellerCode}', '');
  v_expectation := jsonb_strip_nulls(jsonb_build_object(
    'expectedState', jsonb_build_object(
      'categoryCode', v_update.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,categoryCode}',
      'retailPriceJpy', (v_update.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,retailPriceJpy}')::numeric,
      'sellPriceJpy', (v_update.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}')::numeric,
      'quantity', (v_update.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}')::numeric,
      'shippingNo', '806971',
      'biContentsNo', (v_update.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,biContentsNo}')::numeric,
      'originType', v_update.request_payload#>>'{arguments,params,ProductionPlaceType}',
      'originCode', v_update.request_payload#>>'{arguments,params,ProductionPlace}',
      'adultYn', v_update.request_payload#>>'{arguments,params,AdultYN}'
    ),
    'expectedTitle', v_item->>'ItemTitle',
    'expectedKeyword', v_item->>'Keyword',
    'expectedPromotionName', v_item->>'PromotionName',
    'expectedIndustrialCode', coalesce(
      v_update.request_payload#>>'{arguments,params,IndustrialCode}', ''
    ),
    'expectedDetailHtmlSha256', encode(
      extensions.digest(
        v_update.request_payload#>>'{arguments,params,ItemDescription}',
        'sha256'
      ),
      'hex'
    ),
    'expectedDetailImageUrls', v_detail_images,
    'expectedSellerCode', v_seller_code
  ));
  if not sellerpilot_private.qoo10_shipping_s1_direct_reverify_expectation_valid(
    v_expectation,
    v_update.request_payload->'arguments',
    v_create.request_payload->'arguments',
    v_item
  ) then
    raise exception 'exact Qoo10 shipping S1 direct reverify expectation is not valid'
      using errcode = '55000';
  end if;

  v_verified_at := clock_timestamp();
  v_response := jsonb_build_object(
    'ok', true,
    'ResultCode', '0',
    'ResultObject', v_item,
    'sellerpilotDirectReverify', 'qoo10_shipping_s1_direct_reverify_v1'
  );
  if octet_length(v_response::text) < 100 then
    raise exception 'exact Qoo10 shipping S1 direct reverify receipt is too small'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_shipping_s1_observations (
    verifier_job_id, source_observation_id, create_job_id, update_job_id,
    listing_id, remote_id, release_sha, verifier_response_sha256,
    verifier_response_bytes, activation_expectation, provider_status,
    remote_visibility, verified_at, verifier_completed_at, contract
  ) values (
    v_job.id, v_run.source_observation_id, v_run.create_job_id, v_run.update_job_id,
    v_run.listing_id, v_run.remote_id, v_run.release_sha,
    encode(extensions.digest(v_response::text, 'sha256'), 'hex'),
    octet_length(v_response::text), v_expectation, 'S1', 'non_public',
    v_verified_at, v_verified_at, 'qoo10_shipping_s1_observation_v1'
  );

  v_marker := jsonb_set(
    v_expectation || jsonb_build_object(
      'status', 'allowed',
      'contract', 'qoo10_s1_activation_v1',
      'listingId', v_run.listing_id,
      'remoteId', v_run.remote_id,
      'providerStatus', 'S1',
      'sourceJobId', v_run.update_job_id,
      'verifierJobId', v_run.verifier_job_id,
      'verifierResponseSha256', encode(extensions.digest(v_response::text, 'sha256'), 'hex'),
      'verifierCompletedAt', v_verified_at
    ),
    '{expectedState,shippingNo}',
    '"806971"'::jsonb,
    true
  );
  v_arguments := jsonb_set(
    coalesce(v_update.request_payload->'arguments', '{}'::jsonb),
    '{sellerpilotQoo10S1Activation}', v_marker, true
  );
  v_arguments := jsonb_set(
    v_arguments,
    '{sellerpilotQoo10ShippingS1Activation}',
    jsonb_build_object(
      'status', 'allowed',
      'contract', 'qoo10_shipping_s1_activation_v1',
      'listingId', v_run.listing_id,
      'remoteId', v_run.remote_id,
      'createJobId', v_run.create_job_id,
      'updateJobId', v_run.update_job_id,
      'verifierJobId', v_run.verifier_job_id
    ),
    true
  );
  if v_arguments#>>'{params,ShippingNo}' is distinct from '0' then
    raise exception 'exact Qoo10 shipping S1 activation source ShippingNo is not the stored selector'
      using errcode = '55000';
  end if;
  v_arguments := jsonb_set(v_arguments, '{params,ShippingNo}', '"806971"'::jsonb, true);
  v_arguments := jsonb_set(v_arguments, '{params,Keyword}', to_jsonb(v_item->>'Keyword'), true);
  v_arguments := jsonb_set(
    v_arguments, '{params,PromotionName}', to_jsonb(v_item->>'PromotionName'), true
  );
  v_payload := jsonb_build_object('arguments', v_arguments);
  v_request_sha := encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
  v_resource_key := encode(extensions.digest(
    'qoo10-shipping-s1-activation:' || v_run.update_job_id::text || ':' ||
      v_run.verifier_job_id::text || ':' || v_run.remote_id,
    'sha256'
  ), 'hex');

  insert into sellerpilot_private.channel_operation_attempts (
    id, owner_id, credential_id, channel, operation, idempotency_key,
    request_fingerprint, status, started_at, seller_account_key,
    gateway_write_required, pre_gateway_retryable
  ) values (
    v_attempt_id, v_run.owner_id, v_run.credential_id, 'qoo10', 'listing.activate',
    'qoo10-shipping-s1-activate:' || v_run.update_job_id::text || ':' ||
      v_run.verifier_job_id::text,
    v_request_sha, 'running', clock_timestamp(), v_run.seller_account_key, true, false
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_shipping_s1_activation_enqueue', v_job_id::text, true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation, environment,
    request_payload, status, seller_account_key, request_fingerprint,
    write_resource_kind, write_resource_key, created_by, created_at, updated_at
  ) values (
    v_job_id, v_run.credential_id, v_attempt_id, v_run.listing_id, 'qoo10',
    'listing.activate', 'production', v_payload, 'queued', v_run.seller_account_key,
    v_request_sha, 'listing_mutation', v_resource_key,
    v_update.created_by, clock_timestamp(), clock_timestamp()
  );
  insert into sellerpilot_private.qoo10_shipping_s1_activation_permits (
    activation_job_id, activation_attempt_id, verifier_job_id, create_job_id,
    update_job_id, listing_id, credential_id, owner_id, remote_id,
    seller_account_key, release_sha, activation_request_sha256,
    activation_request_bytes, write_resource_key, contract, armed_at, expires_at
  ) values (
    v_job_id, v_attempt_id, v_run.verifier_job_id, v_run.create_job_id,
    v_run.update_job_id, v_run.listing_id, v_run.credential_id, v_run.owner_id,
    v_run.remote_id, v_run.seller_account_key, p_release_sha, v_request_sha,
    octet_length(v_payload::text), v_resource_key,
    'qoo10_shipping_s1_activation_permit_v1', v_verified_at,
    v_verified_at + interval '2 minutes'
  );

  return jsonb_build_object(
    'contract', 'qoo10_shipping_s1_direct_reverify_v1',
    'createJobId', v_run.create_job_id,
    'updateJobId', v_run.update_job_id,
    'verifierJobId', v_run.verifier_job_id,
    'activationJobId', v_job_id,
    'activationAttemptId', v_attempt_id,
    'expectedShippingNo', '806971',
    'sourceJobRewritten', false,
    'verifierRewritten', false,
    'expiresAt', v_verified_at + interval '2 minutes'
  );
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_shipping_s1_create_keyword_contains_remote(text, text)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.qoo10_shipping_s1_direct_reverify_expectation_valid(jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_record_qoo10_shipping_s1_direct_reverify(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_record_qoo10_shipping_s1_direct_reverify(uuid, text, jsonb)
  to service_role;

comment on function
  public.sellerpilot_service_record_qoo10_shipping_s1_direct_reverify(uuid, text, jsonb) is
  'Records one shipping S1 observation from a fresh GET and arms the one-use activation permit without rewriting the verifier job.';

commit;
