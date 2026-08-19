-- Reuse categories that this seller has already confirmed or published for the
-- same kind of product. Results stay owner-scoped and are revalidated against
-- the current marketplace API before they can be confirmed again.

begin;

create or replace function public.sellerpilot_list_category_learning(
  p_channel text,
  p_environment text,
  p_market text
)
returns table (
  product_name text,
  category_id text,
  category_path text[],
  assignment_status text,
  listing_success boolean,
  permission_blocked boolean,
  confirmed_at timestamptz,
  published_at timestamptz,
  blocked_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select
    a.product_name,
    a.category_id,
    a.category_path,
    a.status,
    coalesce(l.listing_success, false),
    coalesce(a.official_metadata->>'lastListingFailureCode', '') = 'CATEGORY_PERMISSION_REQUIRED',
    a.confirmed_at,
    l.published_at,
    case
      when coalesce(a.official_metadata->>'lastListingFailureCode', '') = 'CATEGORY_PERMISSION_REQUIRED'
        then nullif(a.official_metadata->>'lastListingFailureAt', '')::timestamptz
      else null
    end,
    a.updated_at
  from sellerpilot_private.product_category_assignments a
  left join lateral (
    select
      bool_or(pl.remote_id is not null and pl.published_at is not null) as listing_success,
      max(pl.published_at) as published_at
    from sellerpilot_private.product_listings pl
    where pl.owner_id = a.owner_id
      and pl.product_id = a.product_id
      and pl.channel_key = a.channel
      and (
        a.channel not in ('shopee', 'lazada')
        or upper(coalesce(pl.market, '')) = upper(coalesce(a.market, ''))
      )
  ) l on true
  where public.sellerpilot_is_admin()
    and a.owner_id = auth.uid()
    and a.channel = p_channel
    and a.environment = p_environment
    and upper(coalesce(a.market, '')) = upper(trim(coalesce(p_market, '')))
    and a.status in ('confirmed', 'rejected')
  order by coalesce(l.published_at, a.confirmed_at, a.updated_at) desc
  limit 300
$$;

revoke all on function public.sellerpilot_list_category_learning(text, text, text) from public, anon;
grant execute on function public.sellerpilot_list_category_learning(text, text, text) to authenticated;

commit;
