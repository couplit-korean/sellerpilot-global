begin;

create or replace function public.sellerpilot_update_product_details(p_product_id uuid, p_fields jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_requested_stock integer;
  v_canonical_fields jsonb;
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
     or coalesce((p_fields->>'stock')::integer, -1) not between 0 and 999999
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

  v_requested_stock := (p_fields->>'stock')::integer;
  if v_requested_stock < v_product.reserved then
    raise exception 'stock below reserved quantity';
  end if;

  -- Inventory is authoritative in products.on_hand and may only be changed by
  -- the audited inventory workflow. A general detail edit must never revive a
  -- stale product_facts.stock value or rewrite the immutable AI job request.
  v_canonical_fields := jsonb_set(p_fields, '{stock}', to_jsonb(v_product.on_hand), true);
  update sellerpilot_private.products
     set name = trim(p_fields->>'productName'),
         sku = upper(trim(p_fields->>'sellerSku')),
         description = trim(p_fields->>'description'),
         source_url = nullif(trim(p_fields->>'productUrl'), ''),
         product_facts = v_canonical_fields,
         updated_at = now()
   where id = p_product_id;

  insert into sellerpilot_private.operation_audit(owner_id, action, entity_type, entity_id, safe_detail)
  values(auth.uid(), 'product_details_updated', 'product', p_product_id::text,
    jsonb_build_object('sku', upper(trim(p_fields->>'sellerSku')), 'inventory_unchanged', v_product.on_hand,
      'inventory_requested', v_requested_stock));
  return true;
end;
$$;

revoke all on function public.sellerpilot_update_product_details(uuid,jsonb) from public, anon;
grant execute on function public.sellerpilot_update_product_details(uuid,jsonb) to authenticated;

create or replace function sellerpilot_private.sync_product_fact_stock()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  new.product_facts := jsonb_set(coalesce(new.product_facts, '{}'::jsonb), '{stock}', to_jsonb(new.on_hand), true);
  return new;
end;
$$;

revoke all on function sellerpilot_private.sync_product_fact_stock() from public, anon, authenticated;

drop trigger if exists sync_product_fact_stock on sellerpilot_private.products;
create trigger sync_product_fact_stock
before update of on_hand on sellerpilot_private.products
for each row
when (old.on_hand is distinct from new.on_hand)
execute function sellerpilot_private.sync_product_fact_stock();

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
          -- A remaining queued channel means the registration is still active,
          -- even if another channel has already failed or needs permission.
          when coalesce(l.running_count,0) > 0 then 'publishing'
          when coalesce(l.blocked_count,0) > 0 then 'blocked'
          when coalesce(l.failed_count,0) > 0 then 'failed'
          when coalesce(l.total_count,0) > 0 and l.published_count = l.total_count then 'completed'
          when j.status in ('failed','cancelled') then 'failed'
          when j.status in ('queued','claimed','running') then 'analyzing'
          when j.status = 'succeeded' then 'ready'
          else 'ready'
        end as status,
        coalesce(j.created_at, l.started_at, p.updated_at) as started_at,
        greatest(p.updated_at, coalesce(j.updated_at,p.updated_at), coalesce(l.updated_at,p.updated_at)) as updated_at,
        case
          when coalesce(l.total_count,0) > 0
            and coalesce(l.published_count,0) + coalesce(l.failed_count,0) + coalesce(l.blocked_count,0) = l.total_count
            then greatest(coalesce(j.completed_at,j.updated_at,p.updated_at),coalesce(l.completed_at,l.updated_at,p.updated_at))
          when coalesce(l.total_count,0) = 0 and j.status in ('failed','cancelled')
            then coalesce(j.completed_at,j.updated_at,p.updated_at)
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

drop function if exists public.sellerpilot_service_due_competitor_products(integer);
create function public.sellerpilot_service_due_competitor_products(p_limit integer default 50)
returns table(product_id uuid, query text, aliases jsonb)
language sql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select p.id,
         coalesce(nullif(p.competitor_query,''),p.name),
         coalesce(a.aliases,'[]'::jsonb)
    from sellerpilot_private.products p
    left join sellerpilot_private.ai_cli_jobs j on j.id=p.ai_job_id
    left join lateral (
      select jsonb_agg(v.title order by v.first_position) as aliases
        from (
          select left(trim(item.value->>'title'),160) as title,min(item.ordinality) as first_position
            from jsonb_array_elements(coalesce(j.result_payload->'localizedListings','[]'::jsonb))
              with ordinality as item(value,ordinality)
           where length(trim(coalesce(item.value->>'title',''))) between 2 and 160
           group by left(trim(item.value->>'title'),160)
           order by min(item.ordinality)
           limit 12
        ) v
    ) a on true
   where not p.demo and p.status <> 'archived' and p.competitor_monitor_enabled
     and (p.competitor_checked_at is null or p.competitor_checked_at <= now()-interval '30 minutes')
   order by p.competitor_checked_at nulls first,p.updated_at desc
   limit greatest(1,least(coalesce(p_limit,50),100))
$$;

revoke all on function public.sellerpilot_service_due_competitor_products(integer) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_due_competitor_products(integer) to service_role;

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

create or replace function sellerpilot_private.reconcile_product_from_ai(p_job_id uuid,p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid:=gen_random_uuid();
  v_suffix text:=upper(substr(replace(p_job_id::text,'-',''),1,10));
  v_manual jsonb;
begin
  select j.request_payload->'manual_fields'
    into v_manual
    from sellerpilot_private.ai_cli_jobs j
   where j.id=p_job_id and j.kind='product_studio' and j.created_by=p_owner_id and j.status='succeeded';
  if jsonb_typeof(v_manual)<>'object'
     or length(trim(coalesce(v_manual->>'productName',''))) not between 2 and 160
     or trim(coalesce(v_manual->>'sellerSku','')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(v_manual->>'description',''))) not between 20 and 4000
     or (coalesce(v_manual->>'productUrl','')<>'' and v_manual->>'productUrl' !~* '^https?://')
     or coalesce(v_manual->>'productFactsConfirmed','false')<>'true'
     or coalesce((v_manual->>'stock')::integer,-1) not between 0 and 999999 then
    raise exception 'invalid required product intake';
  end if;

  insert into sellerpilot_private.products(
    id,owner_id,external_code,sku,name,description,source_url,ai_job_id,status,on_hand,reorder_point,product_facts,demo
  ) values(
    v_id,p_owner_id,'SP-AI-'||v_suffix,upper(trim(v_manual->>'sellerSku')),
    trim(v_manual->>'productName'),trim(v_manual->>'description'),nullif(trim(v_manual->>'productUrl'),''),
    p_job_id,'draft',(v_manual->>'stock')::integer,10,v_manual,false
  )
  on conflict(owner_id,ai_job_id) do update
    set ai_job_id=excluded.ai_job_id
  returning id into v_id;

  if not exists(
    select 1 from sellerpilot_private.operation_audit a
     where a.owner_id=p_owner_id and a.action='product_created_from_required_intake'
       and a.entity_id=v_id::text and a.safe_detail->>'job_id'=p_job_id::text
  ) then
    insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
    values(p_owner_id,'product_created_from_required_intake','product',v_id::text,
      jsonb_build_object('job_id',p_job_id,'seller_sku',v_manual->>'sellerSku','source','ai_completion_reconciler'));
  end if;
  return v_id;
end;
$$;

revoke all on function sellerpilot_private.reconcile_product_from_ai(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function sellerpilot_private.reconcile_product_after_ai_success()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  begin
    perform sellerpilot_private.reconcile_product_from_ai(new.id,new.created_by);
  exception
    when unique_violation then
      -- Product reconciliation must never roll back a completed AI job or make
      -- the worker delete valid generated assets. A duplicate seller SKU needs
      -- explicit operator resolution rather than an implicit product merge.
      insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
      values(new.created_by,'product_reconciliation_blocked','ai_job',new.id::text,
        jsonb_build_object('job_id',new.id,'reason','duplicate_seller_sku'));
    when others then
      insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
      values(new.created_by,'product_reconciliation_pending','ai_job',new.id::text,
        jsonb_build_object('job_id',new.id,'reason','database_reconciliation_error','sqlstate',sqlstate));
  end;
  return new;
end;
$$;

revoke all on function sellerpilot_private.reconcile_product_after_ai_success() from public,anon,authenticated,service_role;

drop trigger if exists reconcile_product_after_ai_success on sellerpilot_private.ai_cli_jobs;
create trigger reconcile_product_after_ai_success
after update of status on sellerpilot_private.ai_cli_jobs
for each row
when (new.kind='product_studio' and new.status='succeeded' and old.status is distinct from new.status)
execute function sellerpilot_private.reconcile_product_after_ai_success();

create or replace function public.sellerpilot_create_product_from_ai_v2(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  return sellerpilot_private.reconcile_product_from_ai(p_job_id,auth.uid());
end;
$$;

revoke all on function public.sellerpilot_create_product_from_ai_v2(uuid) from public,anon;
grant execute on function public.sellerpilot_create_product_from_ai_v2(uuid) to authenticated;

do $$
declare v_job record;
begin
  for v_job in
    select j.id,j.created_by from sellerpilot_private.ai_cli_jobs j
     where j.kind='product_studio' and j.status='succeeded'
       and not exists(select 1 from sellerpilot_private.products p where p.owner_id=j.created_by and p.ai_job_id=j.id)
  loop
    begin
      perform sellerpilot_private.reconcile_product_from_ai(v_job.id,v_job.created_by);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

commit;
