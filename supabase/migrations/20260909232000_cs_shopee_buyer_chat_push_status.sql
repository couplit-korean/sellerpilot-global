-- Proposal only. Central owns allocation and production application.
-- Apply after 20260909221500_cs_shopee_buyer_chat_push_transport.sql.
-- This exposes receipt metadata only to the existing authenticated shared-admin
-- boundary. It does not expose callback URLs, signatures, raw bodies or secrets.
begin;

create function public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1(
  p_credential_id uuid default null,p_shop_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_checked_at timestamptz:=clock_timestamp();
  v_scope record;
  v_shops jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if (p_credential_id is not null and p_shop_id is null)
     or (p_shop_id is not null and p_shop_id !~ '^[1-9][0-9]{0,31}$') then
    raise exception 'SHOPEE_BUYER_CHAT_PUSH_STATUS_SCOPE_INVALID' using errcode='22023';
  end if;

  for v_scope in select capability.owner_id,capability.credential_id,capability.shop_id,
      exists(
        select 1 from sellerpilot_private.channel_credentials credential
         where credential.id=capability.credential_id
           and credential.created_by=capability.owner_id
           and credential.channel='shopee'
           and credential.environment=capability.credential_environment
           and credential.seller_account_key=capability.credential_seller_account_key
           and credential.seller_account_key_source='provider_certified_v1'
           and credential.seller_account_verified_at=
             capability.credential_seller_account_verified_at
           and credential.status in ('active','grace')
           and (credential.expires_at is null
             or credential.expires_at>statement_timestamp())
      ) credential_current,
      exists(
        select 1
          from sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements entitlement
         where entitlement.owner_id=capability.owner_id
           and entitlement.credential_id=capability.credential_id
           and entitlement.shop_id=capability.shop_id
           and entitlement.state='approved' and entitlement.revoked_at is null
           and entitlement.issued_at<=statement_timestamp()
           and entitlement.expires_at>statement_timestamp()
           and entitlement.webhook_event='webchat_push'
           and entitlement.app_type in (
             'original','seller_in_house_system','customer_service'
           )
           and public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
             entitlement.credential_id,entitlement.shop_id,entitlement.entitlement_id
           ) is not null
      ) entitlement_current,
      (
        select max(receipt.received_at)
          from sellerpilot_private.cs_shopee_buyer_chat_push_receipts receipt
         where receipt.owner_id=capability.owner_id
           and receipt.credential_id=capability.credential_id
           and receipt.shop_id=capability.shop_id
      ) last_verified_received_at
    from sellerpilot_private.cs_shopee_buyer_chat_capabilities capability
   where (p_credential_id is null or capability.credential_id=p_credential_id)
     and (p_shop_id is null or capability.shop_id=p_shop_id)
   order by capability.credential_id,capability.shop_id
   limit 8
  loop
    v_shops:=v_shops||jsonb_build_array(jsonb_build_object(
      'credentialId',v_scope.credential_id::text,
      'shopId',v_scope.shop_id,
      'receiverImplemented',true,
      'credentialCurrent',v_scope.credential_current,
      'entitlementCurrent',v_scope.entitlement_current,
      'verifiedReceipt',v_scope.last_verified_received_at is not null,
      'lastVerifiedReceivedAt',case when v_scope.last_verified_received_at is null then null
        else to_char(v_scope.last_verified_received_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'currentConnectionVerified',false
    ));
  end loop;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-buyer-chat-push-status/1',
    'checkedAt',to_char(v_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'receiverImplemented',true,
    'operationalReceive',false,
    'automaticHistoryCollection',false,
    'reply',false,
    'shops',v_shops
  );
end $$;

revoke all on function public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1(uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_shopee_buyer_chat_push_status_v1(uuid,text)
  to authenticated;

commit;
