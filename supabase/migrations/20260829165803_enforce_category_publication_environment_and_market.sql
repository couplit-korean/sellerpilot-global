-- Bind every atomic listing.create to the exact credential environment and
-- concrete marketplace category that was officially confirmed. Keep the
-- previous ledger implementation private behind a same-transaction guard so
-- this forward migration does not duplicate or fork its retry semantics.

begin;

alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_165803_reserve_and_enqueue_listing_unsafe;

revoke all on function public.sellerpilot_165803_reserve_and_enqueue_listing_unsafe(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_owner_id uuid;
  v_environment text;
  v_market text := upper(trim(coalesce(p_market, '')));
begin
  -- Serialize this guard with the underlying reservation/enqueue transaction.
  -- The delegated implementation takes the same xact lock again, which is
  -- re-entrant for this transaction and leaves no check/write gap.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_channel in ('shopee', 'lazada', 'ebay')
     and v_market !~ '^[A-Z]{2}$' then
    raise exception 'concrete market required';
  end if;

  select product.owner_id
    into v_product_owner_id
    from sellerpilot_private.products product
   where product.id = p_product_id
     and not product.demo
     and product.status <> 'archived'
   for key share;
  if not found then raise exception 'product not found'; end if;

  select credential.environment
    into v_environment
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = p_channel
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > now())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  perform 1
    from sellerpilot_private.product_category_assignments assignment
   where assignment.owner_id = v_product_owner_id
     and assignment.product_id = p_product_id
     and assignment.channel = p_channel
     and assignment.environment = v_environment
     and (
       p_channel not in ('shopee', 'lazada', 'ebay')
       or assignment.market = v_market
     )
     and assignment.status = 'confirmed'
     and assignment.is_leaf
     and jsonb_array_length(assignment.missing_required_attributes) = 0
     and assignment.confirmed_at is not null
   for key share;
  if not found then raise exception 'confirmed market category required'; end if;

  return public.sellerpilot_165803_reserve_and_enqueue_listing_unsafe(
    p_product_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_market,
    p_target_id,
    p_currency,
    p_price,
    p_request_fingerprint,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

commit;
