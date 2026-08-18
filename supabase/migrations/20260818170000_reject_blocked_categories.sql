-- Stop deterministic marketplace category-permission failures from being retried.
-- The category must be re-selected and confirmed after the seller obtains
-- permission or chooses another accurate, allowed leaf category.

begin;

create or replace function public.sellerpilot_service_reject_category_assignment(
  p_product_id uuid,
  p_channel text,
  p_market text,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_updated integer := 0;
begin
  if p_product_id is null
     or p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or length(trim(coalesce(p_market, ''))) > 80
     or p_reason_code !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update sellerpilot_private.product_category_assignments a
     set status = 'rejected',
         confirmed_at = null,
         official_metadata = a.official_metadata || jsonb_build_object(
           'lastListingFailureCode', p_reason_code,
           'lastListingFailureAt', now()
         ),
         updated_at = now()
   where a.product_id = p_product_id
     and a.channel = p_channel
     and (coalesce(trim(p_market), '') = '' or a.market = trim(p_market))
     and a.status = 'confirmed';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.sellerpilot_service_reject_category_assignment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reject_category_assignment(uuid, text, text, text) to service_role;

with blocked as (
  select distinct pl.product_id, pl.channel_key, coalesce(pl.market, '') as market
    from sellerpilot_private.product_listings pl
    left join sellerpilot_private.channel_gateway_jobs j
      on j.attempt_id = pl.operation_attempt_id
   where pl.status = 'failed'
     and (
       coalesce(pl.last_error, '') ~* 'not authori[sz]ed to sell|do not have permission to list|NO_AUTHORITY|RESTRICTED_CATEGORY|판매자 계정에 허용되지 않은 카테고리'
       or coalesce(j.response_payload::text, '') ~* 'not authori[sz]ed to sell|do not have permission to list|NO_AUTHORITY|RESTRICTED_CATEGORY'
     )
)
update sellerpilot_private.product_category_assignments a
   set status = 'rejected',
       confirmed_at = null,
       official_metadata = a.official_metadata || jsonb_build_object(
         'lastListingFailureCode', 'CATEGORY_PERMISSION_REQUIRED',
         'lastListingFailureAt', now()
       ),
       updated_at = now()
  from blocked b
 where a.product_id = b.product_id
   and a.channel = b.channel_key
   and (b.market = '' or a.market = b.market)
   and a.status = 'confirmed';

with blocked as (
  select distinct pl.id
    from sellerpilot_private.product_listings pl
    left join sellerpilot_private.channel_gateway_jobs j
      on j.attempt_id = pl.operation_attempt_id
   where pl.status = 'failed'
     and (
       coalesce(pl.last_error, '') ~* 'not authori[sz]ed to sell|do not have permission to list|NO_AUTHORITY|RESTRICTED_CATEGORY|판매자 계정에 허용되지 않은 카테고리'
       or coalesce(j.response_payload::text, '') ~* 'not authori[sz]ed to sell|do not have permission to list|NO_AUTHORITY|RESTRICTED_CATEGORY'
     )
)
update sellerpilot_private.product_listings pl
   set last_error = '판매자 계정에 허용되지 않은 카테고리입니다. 권한이 있는 정확한 말단 카테고리를 다시 확정해야 합니다.',
       updated_at = now()
  from blocked b
 where pl.id = b.id;

commit;
