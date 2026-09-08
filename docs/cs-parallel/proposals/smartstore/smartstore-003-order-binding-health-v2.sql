-- Proposal only. The coordinator assigns the migration version after review.
begin;

create function public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_owner_id uuid;
  v_active_scope_count integer;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select count(distinct concat_ws('|',credential.created_by::text,credential.seller_account_key))::integer
    into v_active_scope_count
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'smartstore' and credential.environment = 'production'
     and credential.status = 'active' and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > statement_timestamp());
  if v_active_scope_count <> 1 then
    raise exception 'SMARTSTORE_ORDER_BINDING_ACTIVE_SCOPE_INVALID' using errcode = '55000';
  end if;
  select credential.created_by into v_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'smartstore' and credential.environment = 'production'
     and credential.status = 'active' and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
   order by credential.version desc,credential.created_at desc,credential.id limit 1;

  with projected as (
    select case
      when ticket.provider_context->>'kind' = 'product' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status = 'not_applicable'
               and (not (ticket.provider_context ? 'productOrderIds')
                 or (jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
                   and jsonb_array_length(ticket.provider_context->'productOrderIds') = 0))
          then 'not_applicable' else 'contract_mismatch' end
      when ticket.provider_context->>'kind' <> 'customer' then 'contract_mismatch'
      when ticket.provider_context->>'orderReferenceState' = 'exact_product_order' then
        case when jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
               and jsonb_array_length(ticket.provider_context->'productOrderIds') = 1
               and jsonb_typeof(ticket.provider_context->'productOrderIds'->0) = 'string'
               and ticket.provider_context->'productOrderIds'->>0 ~ '^[1-9][0-9]{0,19}$'
               and nullif(trim(ticket.external_order_reference),'') = ticket.provider_context->'productOrderIds'->>0
               and binding.status in ('exact','unmatched','unverified_credential')
          then binding.status else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState' = 'ambiguous_product_orders' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
               and jsonb_array_length(ticket.provider_context->'productOrderIds') > 0
               and not exists (
                 select 1 from jsonb_array_elements(ticket.provider_context->'productOrderIds') item
                  where jsonb_typeof(item) <> 'string'
                     or item#>>'{}' !~ '^[1-9][0-9]{0,19}$'
               )
               and binding.status = 'not_applicable'
          then 'ambiguous_product_orders' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState' = 'invalid_product_order_list' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status = 'not_applicable'
          then 'invalid_product_order_list' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState' = 'unavailable' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status = 'not_applicable'
               and (not (ticket.provider_context ? 'productOrderIds')
                 or (jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
                   and jsonb_array_length(ticket.provider_context->'productOrderIds') = 0))
          then 'not_applicable' else 'contract_mismatch' end
      else 'contract_mismatch'
    end ui_status
    from sellerpilot_private.support_tickets ticket
    join sellerpilot_private.cs_order_bindings binding on binding.ticket_id = ticket.id
    where ticket.owner_id = v_owner_id
      and ticket.channel_key = 'smartstore'
      and binding.channel = 'smartstore'
      and not ticket.demo
  ), grouped as (
    select ui_status status,count(*)::integer count
      from projected group by ui_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel','smartstore','status',status,'count',count
  ) order by status),'[]'::jsonb) into v_groups from grouped;

  return jsonb_build_object(
    'contract','sellerpilot-cs-smartstore-order-binding-health/2',
    'projectionContract','smartstore-cs-order-binding-projection/1',
    'checkedAt',statement_timestamp(),
    'matchingRule','same_owner_channel_exact_product_order_and_credential',
    'automaticOrderLinkState','exact',
    'csCommerceMutationAllowed',false,
    'groups',v_groups
  );
end
$$;

revoke all on function public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
  to authenticated;

commit;
