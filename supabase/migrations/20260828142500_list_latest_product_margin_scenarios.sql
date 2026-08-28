-- Expose one authoritative saved margin baseline per product and sales channel.
-- Recent global history remains a separate, backward-compatible RPC.

begin;

create index if not exists margin_scenarios_product_channel_created_idx
  on sellerpilot_private.margin_scenarios (
    product_id,
    channel_key,
    created_at desc,
    id desc
  )
  where product_id is not null;

create or replace function public.sellerpilot_list_latest_margin_scenarios(
  p_product_id uuid default null,
  p_limit integer default 400
)
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
  ) order by row.created_at desc, row.id desc), '[]'::jsonb)
  from (
    select ranked.id,
           ranked.product_id,
           ranked.name,
           ranked.channel_key,
           ranked.inputs,
           ranked.result,
           ranked.created_at
      from (
        select scenario.id,
               scenario.product_id,
               scenario.name,
               scenario.channel_key,
               scenario.inputs,
               scenario.result,
               scenario.created_at,
               row_number() over (
                 partition by scenario.product_id, scenario.channel_key
                 order by scenario.created_at desc, scenario.id desc
               ) as lineage_rank
          from sellerpilot_private.margin_scenarios scenario
          join sellerpilot_private.products product
            on product.id = scenario.product_id
         where public.sellerpilot_is_admin()
           and scenario.product_id is not null
           and (p_product_id is null or scenario.product_id = p_product_id)
           and product.status <> 'archived'
           and not product.demo
      ) ranked
     where ranked.lineage_rank = 1
     order by ranked.created_at desc, ranked.id desc
     limit least(greatest(coalesce(p_limit, 400), 50), 400)
  ) row
$$;

revoke all on function public.sellerpilot_list_latest_margin_scenarios(uuid, integer)
  from public, anon;
grant execute on function public.sellerpilot_list_latest_margin_scenarios(uuid, integer)
  to authenticated;

commit;
