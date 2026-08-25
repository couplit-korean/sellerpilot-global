begin;

-- A failed remote update must remain distinguishable from a failed first
-- create. The listing ledger already preserves both remote_id and published_at;
-- expose that immutable publication evidence to the update workbench.
alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_published_identity;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_result jsonb;
  v_listings jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  v_result := public.sellerpilot_get_product_publish_context_pre_published_identity(p_product_id);
  if v_result is null then return null; end if;

  select coalesce(
    jsonb_agg(
      entry.value || jsonb_build_object('publishedAt', listing.published_at)
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
    into v_listings
    from jsonb_array_elements(coalesce(v_result->'listings', '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    left join sellerpilot_private.product_listings listing
      on listing.id::text = entry.value->>'id';

  return jsonb_set(v_result, '{listings}', v_listings, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_publish_context_pre_published_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public, anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;

commit;
