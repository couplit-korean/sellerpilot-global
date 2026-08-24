-- Registration activity, complete product editing, and channel-aware
-- competitor price observations for the shared SellerPilot workspace.

begin;

alter table sellerpilot_private.products
  add column if not exists product_facts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(product_facts) = 'object' and octet_length(product_facts::text) <= 50000);

update sellerpilot_private.products p
   set product_facts = j.request_payload->'manual_fields'
  from sellerpilot_private.ai_cli_jobs j
 where p.ai_job_id = j.id
   and p.product_facts = '{}'::jsonb
   and jsonb_typeof(j.request_payload->'manual_fields') = 'object';

alter table sellerpilot_private.competitor_price_observations
  add column if not exists marketplace text not null default 'other'
    check (marketplace in ('smartstore','coupang','elevenst','qoo10','shopee','lazada','ebay','temu','other'));

update sellerpilot_private.competitor_price_observations
   set marketplace = case
     when mall_name ~* '(네이버|스마트스토어|smart.?store)' or product_url ~* 'naver\.com' then 'smartstore'
     when mall_name ~* '쿠팡|coupang' or product_url ~* 'coupang\.com' then 'coupang'
     when mall_name ~* '11번가|11st' or product_url ~* '11st\.co\.kr' then 'elevenst'
     when mall_name ~* 'qoo10' or product_url ~* 'qoo10\.' then 'qoo10'
     when mall_name ~* 'shopee' or product_url ~* 'shopee\.' then 'shopee'
     when mall_name ~* 'lazada' or product_url ~* 'lazada\.' then 'lazada'
     when mall_name ~* 'ebay' or product_url ~* 'ebay\.' then 'ebay'
     when mall_name ~* 'temu' or product_url ~* 'temu\.' then 'temu'
     else 'other'
   end;

create index if not exists competitor_prices_product_market_checked_idx
  on sellerpilot_private.competitor_price_observations (product_id, marketplace, checked_at desc, price);

alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_product_edit;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
  v_facts jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_get_product_publish_context_pre_product_edit(p_product_id);
  if v_result is null then return null; end if;
  select p.product_facts into v_facts
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo;
  return jsonb_set(
    v_result,
    '{manualFields}',
    case when coalesce(v_facts, '{}'::jsonb) <> '{}'::jsonb then v_facts else coalesce(v_result->'manualFields', '{}'::jsonb) end,
    true
  );
end;
$$;

revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public, anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;

create or replace function public.sellerpilot_update_product_details(p_product_id uuid, p_fields jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_stock integer;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fields) <> 'object'
     or octet_length(p_fields::text) > 50000
     or length(trim(coalesce(p_fields->>'productName',''))) not between 2 and 160
     or trim(coalesce(p_fields->>'sellerSku','')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(p_fields->>'categoryHint',''))) not between 2 and 120
     or length(trim(coalesce(p_fields->>'brandName',''))) not between 1 and 120
     or length(trim(coalesce(p_fields->>'manufacturer',''))) not between 1 and 160
     or length(trim(coalesce(p_fields->>'countryOfOrigin',''))) not between 2 and 80
     or length(trim(coalesce(p_fields->>'material',''))) not between 2 and 500
     or length(trim(coalesce(p_fields->>'packageContents',''))) not between 2 and 500
     or coalesce(p_fields->>'condition','') not in ('NEW','USED','REFURBISHED')
     or coalesce(p_fields->>'gtinStatus','') not in ('HAS_GTIN','NO_GTIN')
     or (p_fields->>'gtinStatus' = 'HAS_GTIN' and coalesce(p_fields->>'gtin','') !~ '^[0-9]{8,14}$')
     or (p_fields->>'gtinStatus' = 'NO_GTIN' and coalesce(p_fields->>'gtin','') <> '')
     or length(trim(coalesce(p_fields->>'description',''))) not between 20 and 4000
     or length(trim(coalesce(p_fields->>'researchInput',''))) not between 2 and 12000
     or length(coalesce(p_fields->>'productUrl','')) > 1000
     or (coalesce(p_fields->>'productUrl','') <> '' and p_fields->>'productUrl' !~* '^https?://')
     or coalesce((p_fields->>'sellingPrice')::numeric, 0) <= 0
     or coalesce(p_fields->>'currency','') not in ('KRW','JPY','USD','SGD','MYR','PHP','VND','THB','TWD','BRL','MXN','IDR','EUR')
     or coalesce((p_fields->>'stock')::integer, 0) not between 1 and 999999
     or coalesce((p_fields->>'weightKg')::numeric, 0) <= 0
     or coalesce((p_fields->>'packageLengthCm')::numeric, 0) <= 0
     or coalesce((p_fields->>'packageWidthCm')::numeric, 0) <= 0
     or coalesce((p_fields->>'packageHeightCm')::numeric, 0) <= 0
     or coalesce((p_fields->>'shippingFeeKrw')::numeric, -1) < 0
     or length(coalesce(p_fields->>'shippingRule','')) > 1000
     or length(coalesce(p_fields->>'packagingRule','')) > 1000
     or coalesce((p_fields->>'imageRightsConfirmed')::boolean, false) is not true
     or coalesce((p_fields->>'productFactsConfirmed')::boolean, false) is not true then
    raise exception 'invalid product details';
  end if;

  select * into v_product
    from sellerpilot_private.products p
   where p.id = p_product_id and not p.demo
   for update;
  if v_product.id is null then return false; end if;
  v_stock := (p_fields->>'stock')::integer;
  if v_stock < v_product.reserved then
    raise exception 'stock below reserved quantity';
  end if;

  update sellerpilot_private.products
     set name = trim(p_fields->>'productName'),
         sku = upper(trim(p_fields->>'sellerSku')),
         description = trim(p_fields->>'description'),
         source_url = nullif(trim(p_fields->>'productUrl'), ''),
         on_hand = v_stock,
         product_facts = p_fields,
         updated_at = now()
   where id = p_product_id;

  if v_product.ai_job_id is not null then
    update sellerpilot_private.ai_cli_jobs
       set request_payload = jsonb_set(request_payload, '{manual_fields}', p_fields, true),
           updated_at = now()
     where id = v_product.ai_job_id;
  end if;

  insert into sellerpilot_private.operation_audit(owner_id, action, entity_type, entity_id, safe_detail)
  values(auth.uid(), 'product_details_updated', 'product', p_product_id::text,
    jsonb_build_object('sku', upper(trim(p_fields->>'sellerSku')), 'stock', v_stock));
  return true;
end;
$$;

revoke all on function public.sellerpilot_update_product_details(uuid,jsonb) from public, anon;
grant execute on function public.sellerpilot_update_product_details(uuid,jsonb) to authenticated;

create or replace function public.sellerpilot_list_registration_activity(p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 300));
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return coalesce((
    with product_cards as (
      select
        'product:' || p.id::text as activity_id,
        p.id as product_id,
        p.name as product_name,
        p.external_code as product_code,
        p.sku,
        case
          when coalesce(l.blocked_count,0) > 0 then 'blocked'
          when coalesce(l.failed_count,0) > 0 then 'failed'
          when coalesce(l.running_count,0) > 0 then 'publishing'
          when coalesce(l.total_count,0) > 0 and l.published_count = l.total_count then 'completed'
          when j.status in ('failed','cancelled') then 'failed'
          when j.status in ('queued','claimed','running') then 'analyzing'
          when j.status = 'succeeded' then 'ready'
          else 'ready'
        end as status,
        coalesce(j.created_at, l.started_at, p.updated_at) as started_at,
        greatest(p.updated_at, coalesce(j.updated_at,p.updated_at), coalesce(l.updated_at,p.updated_at)) as updated_at,
        case
          when (coalesce(l.total_count,0) > 0 and l.published_count = l.total_count) or coalesce(l.failed_count,0) > 0 or j.status in ('failed','cancelled')
            then greatest(coalesce(j.completed_at,j.updated_at,p.updated_at),coalesce(l.completed_at,l.updated_at,p.updated_at))
          else null
        end as completed_at,
        coalesce(l.channels,'[]'::jsonb) as channels,
        coalesce(l.total_count,0) as channel_count,
        coalesce(l.published_count,0) as published_count,
        coalesce(l.failed_count,0) as failed_count,
        coalesce(l.blocked_count,0) as blocked_count,
        left(coalesce(l.last_message,j.error_message,''),1000) as message
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
      left join lateral (
        select
          count(*)::integer as total_count,
          count(*) filter (where pl.status = 'published')::integer as published_count,
          count(*) filter (where pl.status = 'failed' and coalesce(pl.failure_class,'retryable') <> 'external_action')::integer as failed_count,
          count(*) filter (where pl.status = 'failed' and pl.failure_class = 'external_action')::integer as blocked_count,
          count(*) filter (where pl.status in ('draft','queued'))::integer as running_count,
          min(coalesce(a.started_at,pl.updated_at)) as started_at,
          max(pl.updated_at) as updated_at,
          max(a.completed_at) as completed_at,
          (array_agg(coalesce(pl.last_error,a.safe_message) order by pl.updated_at desc) filter (where coalesce(pl.last_error,a.safe_message) is not null))[1] as last_message,
          jsonb_agg(jsonb_build_object(
            'channel',pl.channel_key,'channelCode',c.code,'channelName',c.name,'market',pl.market,
            'status',pl.status,'message',coalesce(pl.last_error,a.safe_message,''),'updatedAt',pl.updated_at
          ) order by c.sort_order,pl.market,pl.target_id) as channels
        from sellerpilot_private.product_listings pl
        join sellerpilot_private.channels c on c.key = pl.channel_key
        left join sellerpilot_private.channel_operation_attempts a on a.id = pl.operation_attempt_id
        where pl.product_id = p.id
      ) l on true
      where p.status <> 'archived' and not p.demo and (p.ai_job_id is not null or coalesce(l.total_count,0) > 0)
    ), orphan_jobs as (
      select
        'job:' || j.id::text as activity_id,
        null::uuid as product_id,
        left(coalesce(nullif(j.request_payload->'manual_fields'->>'productName',''),nullif(j.request_payload->>'research_input',''),'상품 분석'),160) as product_name,
        'AI-' || upper(left(j.id::text,8)) as product_code,
        coalesce(j.request_payload->'manual_fields'->>'sellerSku','') as sku,
        case when j.status in ('queued','claimed','running') then 'analyzing' when j.status = 'succeeded' then 'ready' else 'failed' end as status,
        j.created_at as started_at,
        j.updated_at,
        j.completed_at,
        '[]'::jsonb as channels,
        0 as channel_count,
        0 as published_count,
        case when j.status in ('failed','cancelled') then 1 else 0 end as failed_count,
        0 as blocked_count,
        left(coalesce(j.error_message,''),1000) as message
      from sellerpilot_private.ai_cli_jobs j
      where j.kind in ('product_studio','product_research')
        and not exists(select 1 from sellerpilot_private.products p where p.ai_job_id = j.id)
    ), cards as (
      select * from product_cards
      union all
      select * from orphan_jobs
    )
    select jsonb_agg(jsonb_build_object(
      'id',activity_id,'productId',product_id,'productName',product_name,'productCode',product_code,'sku',sku,
      'status',status,'startedAt',started_at,'updatedAt',updated_at,'completedAt',completed_at,
      'elapsedSeconds',greatest(0,extract(epoch from (coalesce(completed_at,now())-started_at))::bigint),
      'channelCount',channel_count,'publishedCount',published_count,'failedCount',failed_count,'blockedCount',blocked_count,
      'channels',channels,'message',message
    ) order by updated_at desc)
    from (select * from cards order by updated_at desc limit v_limit) limited
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sellerpilot_list_registration_activity(integer) from public, anon;
grant execute on function public.sellerpilot_list_registration_activity(integer) to authenticated;

create or replace function public.sellerpilot_service_record_competitor_prices(p_product_id uuid,p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v jsonb; v_count integer:=0; v_external text; v_marketplace text;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>30 then raise exception 'invalid competitor prices'; end if;
  if not exists(select 1 from sellerpilot_private.products where id=p_product_id and status<>'archived' and competitor_monitor_enabled) then return 0; end if;
  for v in select value from jsonb_array_elements(p_items) loop
    v_external:=left(coalesce(nullif(trim(v->>'externalId'),''),md5(coalesce(v->>'url',''))),500);
    v_marketplace:=coalesce(nullif(v->>'marketplace',''),'other');
    if v_marketplace not in ('smartstore','coupang','elevenst','qoo10','shopee','lazada','ebay','temu','other') then v_marketplace:='other'; end if;
    if coalesce((v->>'price')::numeric,-1)<0 then continue; end if;
    insert into sellerpilot_private.competitor_price_observations(product_id,provider,external_id,title,product_url,image_url,mall_name,marketplace,price,currency,checked_at)
    values(p_product_id,'naver_shopping',v_external,left(coalesce(v->>'title','상품'),1000),left(coalesce(v->>'url',''),4000),nullif(left(coalesce(v->>'imageUrl',''),4000),''),left(coalesce(v->>'mallName',''),240),v_marketplace,(v->>'price')::numeric,'KRW',now())
    on conflict(product_id,provider,external_id) do update set title=excluded.title,product_url=excluded.product_url,image_url=excluded.image_url,mall_name=excluded.mall_name,marketplace=excluded.marketplace,price=excluded.price,checked_at=now();
    v_count:=v_count+1;
  end loop;
  update sellerpilot_private.products set competitor_checked_at=now() where id=p_product_id;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_competitor_prices(uuid,jsonb) to service_role;

alter function public.sellerpilot_get_product_operations_v2(uuid)
  rename to sellerpilot_get_product_operations_v2_pre_competitor_channels;

create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
  v_result := public.sellerpilot_get_product_operations_v2_pre_competitor_channels(p_product_id);
  if v_result is null then return null; end if;
  return jsonb_set(v_result,'{competitorPrices}',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',ranked.id,'title',ranked.title,'url',ranked.product_url,'imageUrl',ranked.image_url,
      'mallName',ranked.mall_name,'marketplace',ranked.marketplace,'price',ranked.price,
      'currency',ranked.currency,'checkedAt',ranked.checked_at
    ) order by ranked.marketplace,ranked.price,ranked.checked_at desc)
    from (
      select cp.*,row_number() over(partition by cp.marketplace order by cp.checked_at desc,cp.price,cp.id) as market_rank
      from sellerpilot_private.competitor_price_observations cp
      where cp.product_id=p_product_id
    ) ranked
    where ranked.market_rank<=3
  ),'[]'::jsonb),true);
end;
$$;

revoke all on function public.sellerpilot_get_product_operations_v2(uuid) from public,anon;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid) to authenticated;

commit;
