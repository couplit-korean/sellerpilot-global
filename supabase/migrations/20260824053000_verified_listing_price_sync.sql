begin;
create or replace function public.sellerpilot_service_finalize_listing_price(
  p_product_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing_id uuid;
  v_owner_id uuid;
  v_updated integer := 0;
begin
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay', 'temu')
     or length(trim(coalesce(p_market, ''))) > 80
     or length(trim(coalesce(p_target_id, ''))) > 160
     or length(trim(coalesce(p_currency, ''))) <> 3
     or p_price <= 0 then
    raise exception 'invalid verified listing price';
  end if;

  select l.id, l.owner_id
    into v_listing_id, v_owner_id
    from sellerpilot_private.product_listings l
   where l.product_id = p_product_id
     and l.channel_key = p_channel
     and l.market = trim(coalesce(p_market, ''))
     and l.target_id = trim(coalesce(p_target_id, ''))
     and l.status = 'published'
     and l.remote_id is not null;

  if v_listing_id is null or not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.channel = p_channel
       and a.operation = 'price.update'
       and a.status = 'succeeded'
  ) then
    raise exception 'verified price attempt mismatch';
  end if;

  update sellerpilot_private.product_listings
     set currency = upper(trim(p_currency)),
         price = p_price,
         operation_attempt_id = p_attempt_id,
         last_verified_at = now(),
         last_error = null,
         updated_at = now()
   where id = v_listing_id;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    insert into sellerpilot_private.operation_audit (
      owner_id, action, entity_type, entity_id, safe_detail
    ) values (
      v_owner_id,
      'listing_price_verified',
      'product_listing',
      v_listing_id::text,
      jsonb_build_object(
        'attempt_id', p_attempt_id,
        'channel', p_channel,
        'market', trim(coalesce(p_market, '')),
        'currency', upper(trim(p_currency)),
        'price', p_price
      )
    );
  end if;

  return v_updated = 1;
end;
$$;
revoke all on function public.sellerpilot_service_finalize_listing_price(uuid, text, text, text, text, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_finalize_listing_price(uuid, text, text, text, text, numeric, uuid)
  to service_role;
commit;

