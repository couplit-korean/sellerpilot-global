-- Expose only ledger-backed product readiness facts to the operations UI.
-- Product-specific margin scenarios are linked by UUID; legacy name-only rows
-- remain visible in the calculator but are never attached to a product.

begin;

alter table sellerpilot_private.margin_scenarios
  add column if not exists product_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'margin_scenarios_product_id_fkey'
       and conrelid = 'sellerpilot_private.margin_scenarios'::regclass
  ) then
    alter table sellerpilot_private.margin_scenarios
      add constraint margin_scenarios_product_id_fkey
      foreign key (product_id)
      references sellerpilot_private.products(id)
      on delete set null;
  end if;
end
$$;

create index if not exists margin_scenarios_product_created_idx
  on sellerpilot_private.margin_scenarios (product_id, created_at desc)
  where product_id is not null;

create or replace function public.sellerpilot_save_margin_scenario(
  p_name text,
  p_channel_key text,
  p_inputs jsonb,
  p_result jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_product_id uuid;
  v_product_id_text text := nullif(trim(coalesce(p_inputs->>'productId', '')), '');
begin
  if not public.sellerpilot_is_admin()
     or length(trim(coalesce(p_name, ''))) not between 1 and 120
     or p_channel_key not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or jsonb_typeof(p_inputs) <> 'object'
     or jsonb_typeof(p_result) <> 'object'
     or octet_length(p_inputs::text) > 32768
     or octet_length(p_result::text) > 32768 then
    raise exception 'invalid margin scenario';
  end if;

  if v_product_id_text is not null then
    if v_product_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid margin scenario product';
    end if;
    select product.id
      into v_product_id
      from sellerpilot_private.products product
     where product.id = v_product_id_text::uuid
       and product.status <> 'archived'
       and not product.demo;
    if v_product_id is null then
      raise exception 'margin scenario product not found';
    end if;
  end if;

  insert into sellerpilot_private.margin_scenarios (
    id,
    owner_id,
    product_id,
    name,
    channel_key,
    inputs,
    result
  ) values (
    v_id,
    auth.uid(),
    v_product_id,
    trim(p_name),
    p_channel_key,
    p_inputs,
    p_result
  );

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail
  ) values (
    auth.uid(),
    'scenario_saved',
    'margin_scenario',
    v_id::text,
    jsonb_build_object('channel', p_channel_key, 'product_id', v_product_id)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_list_margin_scenarios(p_limit integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id,
    'productId', row.product_id,
    'name', row.name,
    'channelKey', row.channel_key,
    'inputs', row.inputs,
    'result', row.result,
    'createdAt', row.created_at
  ) order by row.created_at desc), '[]'::jsonb)
  from (
    select scenario.id,
           scenario.product_id,
           scenario.name,
           scenario.channel_key,
           scenario.inputs,
           scenario.result,
           scenario.created_at
      from sellerpilot_private.margin_scenarios scenario
     where public.sellerpilot_is_admin()
     order by scenario.created_at desc, scenario.id desc
     limit least(greatest(coalesce(p_limit, 5), 1), 50)
  ) row
$$;

create or replace function public.sellerpilot_delete_margin_scenario(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scenario_owner uuid;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  delete from sellerpilot_private.margin_scenarios scenario
   where scenario.id = p_id
  returning scenario.owner_id into v_scenario_owner;

  if v_scenario_owner is null then
    return false;
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    auth.uid(),
    'scenario_deleted',
    'margin_scenario',
    p_id::text,
    jsonb_build_object('scenario_owner_id', v_scenario_owner)
  );
  return true;
end;
$$;

create or replace function public.sellerpilot_get_product_readiness_facts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_facts jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'productId', product.id,
      'baseSellingPrice', case
        when jsonb_typeof(product.product_facts->'sellingPrice') = 'number'
         and (product.product_facts->>'sellingPrice')::numeric > 0
          then (product.product_facts->>'sellingPrice')::numeric
        when jsonb_typeof(product.product_facts->'sellingPrice') = 'string'
         and trim(product.product_facts->>'sellingPrice') ~ '^[0-9]+([.][0-9]+)?$'
         and (product.product_facts->>'sellingPrice')::numeric > 0
          then (product.product_facts->>'sellingPrice')::numeric
        else null
      end,
      'baseCurrency', case
        when upper(trim(coalesce(product.product_facts->>'currency', ''))) ~ '^[A-Z]{3}$'
          then upper(trim(product.product_facts->>'currency'))
        else null
      end,
      'categoryHint', nullif(trim(coalesce(product.product_facts->>'categoryHint', '')), ''),
      'confirmedCategories', coalesce(confirmed_category.items, '[]'::jsonb),
      'marginState', case
        when latest_margin.id is null then 'missing'
        when jsonb_typeof(latest_margin.result->'margin') = 'number' then 'calculated'
        else 'invalid'
      end,
      'marginPercent', case
        when jsonb_typeof(latest_margin.result->'margin') = 'number'
          then (latest_margin.result->>'margin')::numeric
        else null
      end,
      'marginChannelKey', latest_margin.channel_key,
      'latestError', case
        when latest_ai.status in ('failed', 'cancelled')
         and (
           latest_listing.status is distinct from 'failed'
           or latest_ai.updated_at >= latest_listing.updated_at
         )
         and latest_ai.kind = 'product_asset_regeneration'
          then '이미지 재제작 실패 · 등록 진행에서 다시 시도해 주세요.'
        when latest_ai.status in ('failed', 'cancelled')
         and (
           latest_listing.status is distinct from 'failed'
           or latest_ai.updated_at >= latest_listing.updated_at
         )
          then 'AI 상품 분석 실패 · 등록 진행에서 다시 시도해 주세요.'
        when latest_listing.status = 'failed' and latest_listing.failure_class = 'external_action'
          then '채널 카테고리·권한 확인이 필요합니다.'
        when latest_listing.status = 'failed'
          then '채널 등록 실패 · 등록 진행에서 다시 시도해 주세요.'
        else null
      end,
      'latestErrorKind', case
        when latest_ai.status in ('failed', 'cancelled')
         and (
           latest_listing.status is distinct from 'failed'
           or latest_ai.updated_at >= latest_listing.updated_at
         ) then 'analysis'
        when latest_listing.status = 'failed' and latest_listing.failure_class = 'external_action' then 'external_action'
        when latest_listing.status = 'failed' then 'listing'
        else null
      end
    ) order by product.updated_at desc, product.id
  ), '[]'::jsonb)
    into v_facts
    from sellerpilot_private.products product
    left join lateral (
      select job.status, job.kind, job.updated_at
        from sellerpilot_private.ai_cli_jobs job
       where job.id = product.ai_job_id
          or job.request_payload->>'source_product_id' = product.id::text
       order by job.updated_at desc, job.created_at desc, job.id desc
       limit 1
    ) latest_ai on true
    left join lateral (
      select listing.status, listing.failure_class, listing.updated_at
        from sellerpilot_private.product_listings listing
       where listing.product_id = product.id
         and listing.owner_id = product.owner_id
       order by listing.updated_at desc, listing.id desc
       limit 1
    ) latest_listing on true
    left join lateral (
      select scenario.id, scenario.channel_key, scenario.result
        from sellerpilot_private.margin_scenarios scenario
       where scenario.product_id = product.id
       order by scenario.created_at desc, scenario.id desc
       limit 1
    ) latest_margin on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'channelKey', assignment.channel,
        'market', assignment.market,
        'categoryId', assignment.category_id,
        'categoryPath', assignment.category_path,
        'confirmedAt', assignment.confirmed_at
      ) order by assignment.channel, assignment.market) as items
        from (
          select distinct on (candidate.channel, candidate.market)
                 candidate.channel,
                 candidate.market,
                 candidate.category_id,
                 candidate.category_path,
                 candidate.confirmed_at
            from sellerpilot_private.product_category_assignments candidate
           where candidate.product_id = product.id
             and candidate.owner_id = product.owner_id
             and candidate.environment = 'production'
             and candidate.status = 'confirmed'
           order by candidate.channel,
                    candidate.market,
                    candidate.confirmed_at desc nulls last,
                    candidate.updated_at desc,
                    candidate.created_at desc,
                    candidate.id desc
        ) assignment
    ) confirmed_category on true
   where not product.demo
     and product.status <> 'archived';

  return v_facts;
end;
$$;

revoke all on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.sellerpilot_save_margin_scenario(text, text, jsonb, jsonb)
  to authenticated;
revoke all on function public.sellerpilot_list_margin_scenarios(integer)
  from public, anon;
grant execute on function public.sellerpilot_list_margin_scenarios(integer)
  to authenticated;
revoke all on function public.sellerpilot_delete_margin_scenario(uuid)
  from public, anon;
grant execute on function public.sellerpilot_delete_margin_scenario(uuid)
  to authenticated;
revoke all on function public.sellerpilot_get_product_readiness_facts()
  from public, anon;
grant execute on function public.sellerpilot_get_product_readiness_facts()
  to authenticated;

commit;
