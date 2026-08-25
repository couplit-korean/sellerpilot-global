-- Treat every successfully searched provider as a replaceable catalog
-- snapshot. Failed providers retain their last known result for at most seven
-- days, while stale observations never remain visible indefinitely.

begin;

create or replace function public.sellerpilot_service_complete_competitor_price_refresh(
  p_product_id uuid,
  p_claim_token uuid,
  p_items jsonb,
  p_providers jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_provider text;
begin
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 30
     or jsonb_typeof(p_providers) <> 'array'
     or jsonb_array_length(p_providers) > 3
     or exists (
       select 1
         from jsonb_array_elements(p_providers) provider(value)
        where jsonb_typeof(provider.value) <> 'object'
           or coalesce(provider.value->>'provider', '') not in ('naver_shopping', 'elevenst_product_search', 'ebay_browse')
           or coalesce(provider.value->>'status', '') not in ('searched', 'unavailable', 'failed', 'pending')
     ) then
    raise exception 'invalid competitor refresh snapshot';
  end if;

  perform 1
    from sellerpilot_private.products p
   where p.id = p_product_id
   for update;
  if not found then return -1; end if;

  perform 1
    from sellerpilot_private.competitor_price_refresh_claims c
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token
   for update;
  if not found then return -1; end if;

  for v_provider in
    select distinct provider.value->>'provider'
      from jsonb_array_elements(p_providers) provider(value)
     where provider.value->>'status' = 'searched'
  loop
    delete from sellerpilot_private.competitor_price_observations observation
     where observation.product_id = p_product_id
       and observation.provider = v_provider
       and not exists (
         select 1
           from jsonb_array_elements(p_items) item(value)
          where coalesce(nullif(item.value->>'provider', ''), 'naver_shopping') = v_provider
            and left(
              coalesce(
                nullif(trim(item.value->>'externalId'), ''),
                md5(coalesce(item.value->>'url', ''))
              ),
              500
            ) = observation.external_id
       );
  end loop;

  delete from sellerpilot_private.competitor_price_observations observation
   where observation.product_id = p_product_id
     and observation.provider <> 'manual'
     and observation.checked_at < now() - interval '7 days';

  select public.sellerpilot_service_record_competitor_prices(p_product_id, p_items)
    into v_count;

  update sellerpilot_private.competitor_price_refresh_claims c
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         gateway_job_id = null,
         gateway_periodic_key = null
   where c.product_id = p_product_id
     and c.claim_token = p_claim_token;
  return v_count;
end;
$$;

-- The former three-argument overload cannot distinguish a provider that was
-- searched and returned zero matches from a provider that failed or stayed
-- pending. Leaving it executable would let a stale service worker bypass both
-- provider snapshot replacement and the seven-day retention fence. The current
-- application sends p_providers, so remove the ambiguous overload fail-closed.
revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
drop function if exists public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb);

revoke all on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_competitor_price_refresh(uuid, uuid, jsonb, jsonb)
  to service_role;

alter function public.sellerpilot_get_product_operations_v2(uuid)
  rename to sellerpilot_get_product_operations_v2_pre_freshness;

revoke all on function public.sellerpilot_get_product_operations_v2_pre_freshness(uuid)
  from public, anon, authenticated;

create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_prices jsonb;
begin
  v_result := public.sellerpilot_get_product_operations_v2_pre_freshness(p_product_id);
  if v_result is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'title', ranked.title,
    'url', ranked.product_url,
    'imageUrl', ranked.image_url,
    'mallName', ranked.mall_name,
    'marketplace', ranked.marketplace,
    'price', ranked.price,
    'currency', ranked.currency,
    'checkedAt', ranked.checked_at
  ) order by ranked.marketplace, ranked.price, ranked.checked_at desc), '[]'::jsonb)
    into v_prices
    from (
      select cp.*,
             row_number() over(
               partition by cp.marketplace
               order by (cp.provider = 'manual') desc, cp.checked_at desc, cp.price, cp.id
             ) as market_rank
        from sellerpilot_private.competitor_price_observations cp
       where cp.product_id = p_product_id
         and (cp.provider = 'manual' or cp.checked_at >= now() - interval '7 days')
    ) ranked
   where ranked.market_rank <= 3;

  return jsonb_set(v_result, '{competitorPrices}', v_prices, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_operations_v2(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_product_operations_v2(uuid)
  to authenticated;

commit;
