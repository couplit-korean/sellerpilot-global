-- Bind Shopee orders to the exact provider-certified credential target used
-- for their read, and keep shipment acknowledgement/preflight distinct from
-- the final shipment confirmation ledger transition.

begin;

do $$
begin
  if to_regprocedure(
    'public.sellerpilot_270827_ingest_orders_without_shopee_lineage(uuid,text,jsonb)'
  ) is null then
    if to_regprocedure('public.sellerpilot_service_ingest_orders(uuid,text,jsonb)') is null then
      raise exception 'sellerpilot order ingest prerequisite is missing';
    end if;
    alter function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
      rename to sellerpilot_270827_ingest_orders_without_shopee_lineage;
  end if;
end;
$$;

revoke all on function public.sellerpilot_270827_ingest_orders_without_shopee_lineage(
  uuid,text,jsonb
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_ingest_orders(
  p_credential_id uuid,
  p_channel text,
  p_orders jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_secret jsonb;
  v_subject text;
  v_shop_id text;
  v_merchant_id text;
  v_order jsonb;
  v_context jsonb;
  v_existing_context jsonb;
  v_external_order_id text;
  v_enriched_orders jsonb := '[]'::jsonb;
  v_count integer;
begin
  if p_channel <> 'shopee' then
    return public.sellerpilot_270827_ingest_orders_without_shopee_lineage(
      p_credential_id,
      p_channel,
      p_orders
    );
  end if;

  if jsonb_typeof(p_orders) <> 'array'
     or jsonb_array_length(p_orders) > 500
     or octet_length(p_orders::text) > 1000000 then
    raise exception 'invalid normalized orders';
  end if;
  if jsonb_array_length(p_orders) = 0 then
    return public.sellerpilot_270827_ingest_orders_without_shopee_lineage(
      p_credential_id,
      p_channel,
      p_orders
    );
  end if;

  select credential.id, credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source,
         credential.seller_account_verified_at,
         decrypted.decrypted_secret
    into v_credential
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.status in ('active', 'grace')
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'provider-certified Shopee credential required';
  end if;

  begin
    v_secret := v_credential.decrypted_secret::jsonb;
  exception when invalid_text_representation then
    raise exception 'invalid Shopee credential payload';
  end;
  v_subject := nullif(trim(v_secret->>'provider_account_subject'), '');
  v_shop_id := nullif(trim(v_secret->>'shop_id'), '');
  if coalesce(v_secret->>'provider_account_identity_version', '') <> 'v1'
     or v_shop_id is null
     or v_shop_id !~ '^[1-9][0-9]{0,31}$'
     or (
       v_subject <> 'shopee:shop:' || v_shop_id
       and not (
         v_subject = 'shopee:main:' || coalesce(v_secret->>'main_account_id', '')
         and coalesce(v_secret->>'main_account_id', '') ~ '^[1-9][0-9]{0,31}$'
         and exists (
           select 1
             from jsonb_array_elements(
               case when jsonb_typeof(v_secret->'shop_ids') = 'array'
                 then v_secret->'shop_ids' else '[]'::jsonb end
             ) shop
            where trim(shop #>> '{}') = v_shop_id
         )
         and exists (
           select 1
             from jsonb_array_elements(
               case when jsonb_typeof(v_secret->'shopee_targets') = 'array'
                 then v_secret->'shopee_targets' else '[]'::jsonb end
             ) target
            where target->>'type' = 'shop'
              and trim(target->>'id') = v_shop_id
         )
       )
     ) then
    raise exception 'Shopee credential shop lineage is invalid';
  end if;

  v_merchant_id := nullif(trim(v_secret->>'merchant_id'), '');
  if v_merchant_id is not null and (
       v_subject !~ '^shopee:main:[1-9][0-9]{0,31}$'
       or v_merchant_id !~ '^[1-9][0-9]{0,31}$'
       or not exists (
         select 1
           from jsonb_array_elements(
             case when jsonb_typeof(v_secret->'merchant_ids') = 'array'
               then v_secret->'merchant_ids' else '[]'::jsonb end
           ) merchant
          where trim(merchant #>> '{}') = v_merchant_id
       )
       or not exists (
         select 1
           from jsonb_array_elements(
             case when jsonb_typeof(v_secret->'shopee_targets') = 'array'
               then v_secret->'shopee_targets' else '[]'::jsonb end
           ) target
          where target->>'type' = 'merchant'
            and trim(target->>'id') = v_merchant_id
       )
     ) then
    -- A shop-scoped order read never inherits an unverified merchant target.
    v_merchant_id := null;
  end if;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    if v_order ? 'providerContext'
       and jsonb_typeof(v_order->'providerContext') <> 'object' then
      raise exception 'Shopee order provider context is invalid';
    end if;
    v_context := coalesce(v_order->'providerContext', '{}'::jsonb);
    if nullif(trim(v_context->>'shopId'), '') is not null
       and trim(v_context->>'shopId') <> v_shop_id then
      raise exception 'Shopee order shop lineage mismatch';
    end if;
    if nullif(trim(v_context->>'merchantId'), '') is not null
       and trim(v_context->>'merchantId') <> coalesce(v_merchant_id, '') then
      raise exception 'Shopee order merchant lineage mismatch';
    end if;
    if nullif(trim(v_context->>'sourceCredentialId'), '') is not null
       and trim(v_context->>'sourceCredentialId') <> p_credential_id::text then
      raise exception 'Shopee order source credential mismatch';
    end if;
    if nullif(trim(v_context->>'sellerAccountKey'), '') is not null
       and trim(v_context->>'sellerAccountKey') <> v_credential.seller_account_key then
      raise exception 'Shopee order seller lineage mismatch';
    end if;

    v_external_order_id := left(trim(coalesce(v_order->>'externalOrderId', '')), 240);
    if v_external_order_id <> '' then
      select orders.provider_context
        into v_existing_context
        from sellerpilot_private.commerce_orders orders
       where orders.owner_id = v_credential.created_by
         and orders.channel_key = 'shopee'
         and orders.external_order_id = v_external_order_id
         and not orders.demo
       for update;
      if found and (
           (
             nullif(trim(v_existing_context->>'sellerAccountKey'), '') is not null
             and trim(v_existing_context->>'sellerAccountKey') <> v_credential.seller_account_key
           )
           or (
             nullif(trim(v_existing_context->>'shopId'), '') is not null
             and trim(v_existing_context->>'shopId') <> v_shop_id
           )
         ) then
        raise exception 'Shopee existing order credential lineage mismatch';
      end if;
    end if;

    v_context := v_context || jsonb_build_object(
      'shopId', v_shop_id,
      'sourceCredentialId', p_credential_id,
      'sellerAccountKey', v_credential.seller_account_key
    );
    if v_merchant_id is not null then
      v_context := v_context || jsonb_build_object('merchantId', v_merchant_id);
    else
      v_context := v_context - 'merchantId';
    end if;
    v_enriched_orders := v_enriched_orders || jsonb_build_array(
      jsonb_set(v_order, '{providerContext}', v_context, true)
    );
  end loop;

  v_count := public.sellerpilot_270827_ingest_orders_without_shopee_lineage(
    p_credential_id,
    p_channel,
    v_enriched_orders
  );

  -- Persist the lineage in this wrapper as well. This deliberately does not
  -- depend on the historical ingest wrapper retaining its post-upsert hook.
  for v_order in select value from jsonb_array_elements(v_enriched_orders) loop
    v_external_order_id := left(trim(coalesce(v_order->>'externalOrderId', '')), 240);
    if v_external_order_id <> '' then
      update sellerpilot_private.commerce_orders orders
         set provider_context = v_order->'providerContext',
             last_seen_at = now(),
             updated_at = now()
       where orders.owner_id = v_credential.created_by
         and orders.channel_key = 'shopee'
         and orders.external_order_id = v_external_order_id
         and not orders.demo;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  to service_role;

create or replace function sellerpilot_private.guard_shopee_shipment_order_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_order record;
  v_source_credential_id uuid;
  v_requested_shop_id text;
  v_requested_order_id text;
begin
  if new.channel <> 'shopee'
     or new.operation not in ('shipment.acknowledge', 'shipment.confirm') then
    return new;
  end if;

  select credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = new.credential_id
     and credential.channel = 'shopee';
  select orders.owner_id, orders.external_order_id, orders.provider_context
    into v_order
    from sellerpilot_private.commerce_orders orders
   where orders.id = new.order_id
     and orders.channel_key = 'shopee'
     and not orders.demo
   for update;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> 'provider_certified_v1'
     or v_order.owner_id is null
     or v_order.owner_id <> v_credential.created_by
     or nullif(trim(v_order.provider_context->>'sellerAccountKey'), '')
          is distinct from v_credential.seller_account_key
     or nullif(trim(v_order.provider_context->>'shopId'), '') is null
     or nullif(trim(v_order.provider_context->>'orderSn'), '')
          is distinct from v_order.external_order_id then
    raise exception 'Shopee shipment order credential lineage mismatch';
  end if;

  begin
    v_source_credential_id := (v_order.provider_context->>'sourceCredentialId')::uuid;
  exception when invalid_text_representation then
    raise exception 'Shopee shipment source credential lineage is invalid';
  end;
  if not exists (
    select 1
      from sellerpilot_private.channel_credentials source_credential
     where source_credential.id = v_source_credential_id
       and source_credential.channel = 'shopee'
       and source_credential.created_by = v_order.owner_id
       and source_credential.seller_account_key = v_credential.seller_account_key
       and source_credential.seller_account_key_source = 'provider_certified_v1'
  ) then
    raise exception 'Shopee shipment source credential lineage mismatch';
  end if;

  v_requested_shop_id := nullif(trim(new.request_payload#>>'{arguments,shopId}'), '');
  v_requested_order_id := coalesce(
    nullif(trim(new.request_payload#>>'{arguments,query,order_sn}'), ''),
    nullif(trim(new.request_payload#>>'{arguments,body,order_sn}'), '')
  );
  if v_requested_shop_id is distinct from trim(v_order.provider_context->>'shopId')
     or v_requested_order_id is distinct from v_order.external_order_id then
    raise exception 'Shopee shipment request order lineage mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_shopee_shipment_order_lineage
  on sellerpilot_private.channel_gateway_jobs;
create trigger guard_shopee_shipment_order_lineage
before insert on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_shopee_shipment_order_lineage();

create or replace function sellerpilot_private.reconcile_gateway_shipment_ack_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_ok boolean := false;
  v_safe_message text;
  v_http_status integer := 422;
begin
  if new.operation <> 'shipment.acknowledge'
     or new.status not in ('succeeded', 'failed', 'reconciliation_required')
     or new.status is not distinct from old.status then
    return new;
  end if;

  v_provider_ok := new.status = 'succeeded'
    and coalesce(new.response_payload->>'ok', 'false') = 'true';
  v_safe_message := left(coalesce(
    case when new.status = 'reconciliation_required'
      then nullif(trim(new.error_message), '')
      else nullif(trim(new.response_payload->>'safeMessage'), '')
    end,
    nullif(trim(new.error_message), ''),
    case
      when new.status = 'reconciliation_required' then 'Provider acknowledgement requires reconciliation.'
      when v_provider_ok then 'Shipment acknowledgement completed.'
      else 'Shipment acknowledgement failed.'
    end
  ), 500);

  select coalesce((step->>'status')::integer, 422)
    into v_http_status
    from jsonb_array_elements(
      case when jsonb_typeof(new.response_payload->'steps') = 'array'
        then new.response_payload->'steps' else '[]'::jsonb end
    ) step
   where coalesce(step->>'ok', 'false') <> 'true'
     and coalesce(step->>'status', '') ~ '^[0-9]{1,3}$'
   limit 1;
  v_http_status := case
    when new.status = 'reconciliation_required' then 409
    when v_provider_ok then 200
    else coalesce(v_http_status, 422)
  end;

  if new.attempt_id is not null then
    update sellerpilot_private.channel_operation_attempts attempt
       set status = case
             when new.status = 'reconciliation_required' then 'manual_required'
             when v_provider_ok then 'succeeded'
             else 'failed'
           end,
           http_status = v_http_status,
           remote_id = coalesce(
             nullif(left(trim(new.response_payload->>'remoteId'), 240), ''),
             attempt.remote_id
           ),
           safe_message = v_safe_message,
           completed_at = now()
     where attempt.id = new.attempt_id
       and attempt.status in ('running', 'failed');
  end if;

  update sellerpilot_private.commerce_orders orders
     set shipment_write_status = case
           when v_provider_ok then orders.shipment_write_status
           when new.status = 'reconciliation_required' then 'reconciliation_required'
           else 'failed'
         end,
         shipment_operation_attempt_id = new.attempt_id,
         shipment_request_fingerprint = new.request_fingerprint,
         last_shipment_error = case when v_provider_ok then null else v_safe_message end,
         updated_at = now()
   where orders.id = new.order_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  )
  select orders.owner_id,
         case
           when new.status = 'reconciliation_required'
             then 'shipment_acknowledge_reconciliation_required'
           when not v_provider_ok then 'shipment_acknowledge_failed'
           when new.channel = 'shopee' then 'shipment_preflight_verified'
           else 'shipment_acknowledged'
         end,
         'order',
         orders.id::text,
         jsonb_build_object(
           'job_id', new.id,
           'attempt_id', new.attempt_id,
           'channel', new.channel,
           'final_shipment_confirmation', false
         )
    from sellerpilot_private.commerce_orders orders
   where orders.id = new.order_id;

  return new;
end;
$$;

drop trigger if exists reconcile_gateway_resource_terminal
  on sellerpilot_private.channel_gateway_jobs;
create trigger reconcile_gateway_resource_terminal
after update of status on sellerpilot_private.channel_gateway_jobs
for each row
when (new.operation <> 'shipment.acknowledge')
execute function sellerpilot_private.reconcile_gateway_resource_terminal();

drop trigger if exists reconcile_gateway_shipment_ack_terminal
  on sellerpilot_private.channel_gateway_jobs;
create trigger reconcile_gateway_shipment_ack_terminal
after update of status on sellerpilot_private.channel_gateway_jobs
for each row
when (new.operation = 'shipment.acknowledge')
execute function sellerpilot_private.reconcile_gateway_shipment_ack_terminal();

revoke all on function sellerpilot_private.guard_shopee_shipment_order_lineage()
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.reconcile_gateway_shipment_ack_terminal()
  from public, anon, authenticated, service_role;

commit;
