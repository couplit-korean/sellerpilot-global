-- Proposal only. Central owns allocation and production application.
-- Official sources verified on 2026-09-10 KST:
-- https://open.shopee.com/developer-guide/18 (raw callback signature/retry contract)
-- https://open.shopee.com/push-mechanism/10 (webchat_push code 10 payload/replay contract)
-- SellerChat list/message endpoint details remain whitelist-gated, so this migration
-- enables signed inbound webchat_push only. It adds no polling or reply action.
begin;

create table sellerpilot_private.cs_shopee_buyer_chat_push_receipts (
  owner_id uuid not null,
  credential_id uuid not null,
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  entitlement_id uuid not null,
  conversation_id text not null
    check (conversation_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  message_id text not null
    check (message_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  request_id text not null
    check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9:_/-]{0,159}$'),
  region text not null check (region ~ '^[A-Z]{2}$'),
  push_timestamp timestamptz not null,
  callback_url_sha256 text not null check (callback_url_sha256 ~ '^[a-f0-9]{64}$'),
  raw_body_sha256 text not null check (raw_body_sha256 ~ '^[a-f0-9]{64}$'),
  authorization_sha256 text not null check (authorization_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,credential_id,shop_id,entitlement_id,conversation_id,message_id),
  foreign key (owner_id,credential_id,shop_id,entitlement_id)
    references sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
      owner_id,credential_id,shop_id,entitlement_id
    ) on delete restrict
);

alter table sellerpilot_private.cs_shopee_buyer_chat_push_receipts enable row level security;
revoke all on sellerpilot_private.cs_shopee_buyer_chat_push_receipts
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_resolve_cs_shopee_buyer_chat_push_transport_v1(
  p_shop_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_count integer;
  v_credential_id uuid;
  v_entitlement_id uuid;
  v_partner_key text;
  v_candidate record;
begin
  if coalesce(p_shop_id,'') !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'SHOPEE_BUYER_CHAT_PUSH_SCOPE_INVALID' using errcode='22023';
  end if;
  for v_candidate in with eligible as (
    select entitlement.credential_id,entitlement.entitlement_id,
      decrypted.decrypted_secret::jsonb payload
      from sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements entitlement
      join sellerpilot_private.channel_credentials credential
        on credential.id=entitlement.credential_id
       and credential.created_by=entitlement.owner_id
       and credential.channel='shopee'
       and credential.environment=entitlement.credential_environment
       and credential.seller_account_key=entitlement.credential_seller_account_key
       and credential.seller_account_key_source='provider_certified_v1'
       and credential.seller_account_verified_at=entitlement.credential_seller_account_verified_at
       and credential.status in ('active','grace')
       and (credential.expires_at is null or credential.expires_at>statement_timestamp())
      join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
     where entitlement.shop_id=p_shop_id
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
  ), valid as (
    select * from eligible
     where jsonb_typeof(payload)='object'
       and length(coalesce(payload->>'partner_key','')) between 16 and 4096
       and (
         payload->>'shop_id'=p_shop_id
         or (jsonb_typeof(payload->'shop_ids')='array'
           and exists(select 1 from jsonb_array_elements_text(payload->'shop_ids') item
             where item=p_shop_id))
       )
  ) select credential_id,entitlement_id,payload->>'partner_key' partner_key
      from valid limit 2
  loop
    v_count:=coalesce(v_count,0)+1;
    v_credential_id:=v_candidate.credential_id;
    v_entitlement_id:=v_candidate.entitlement_id;
    v_partner_key:=v_candidate.partner_key;
  end loop;
  if coalesce(v_count,0)<>1 then return null; end if;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-buyer-chat-push-transport/1',
    'credentialId',v_credential_id::text,
    'entitlementId',v_entitlement_id::text,
    'shopId',p_shop_id,
    'partnerKey',v_partner_key,
    'webhookEvent','webchat_push'
  );
end $$;

create function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_verified_push_v1(
  p_credential_id uuid,p_shop_id text,p_entitlement_id uuid,
  p_evidence jsonb,p_page jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_entitlement sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements%rowtype;
  v_existing sellerpilot_private.cs_shopee_buyer_chat_push_receipts%rowtype;
  v_owner_id uuid;
  v_inserted integer;
  v_push_timestamp timestamptz;
  v_received_at timestamptz;
  v_ingest jsonb;
  v_status text;
begin
  if p_credential_id is null or p_entitlement_id is null
     or coalesce(p_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
     or jsonb_typeof(p_evidence) is distinct from 'object'
     or not (p_evidence ?& array['contract','callbackUrlSha256','rawBodySha256',
       'authorizationSha256','code','requestId','shopId','conversationId','messageId',
       'region','pushTimestamp','receivedAt'])
     or p_evidence - array['contract','callbackUrlSha256','rawBodySha256',
       'authorizationSha256','code','requestId','shopId','conversationId','messageId',
       'region','pushTimestamp','receivedAt']<>'{}'::jsonb
     or p_evidence->>'contract' is distinct from
       'sellerpilot-shopee-buyer-chat-verified-push/1'
     or jsonb_typeof(p_evidence->'code') is distinct from 'number'
     or p_evidence->>'code' is distinct from '10'
     or p_evidence->>'shopId' is distinct from p_shop_id
     or coalesce(p_evidence->>'conversationId','') !~
       '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or coalesce(p_evidence->>'messageId','') !~
       '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or coalesce(p_evidence->>'requestId','') !~
       '^[A-Za-z0-9][A-Za-z0-9:_/-]{0,159}$'
     or coalesce(p_evidence->>'region','') !~ '^[A-Z]{2}$'
     or coalesce(p_evidence->>'callbackUrlSha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_evidence->>'rawBodySha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_evidence->>'authorizationSha256','') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_page) is distinct from 'object'
     or p_page->>'contract' is distinct from
       'sellerpilot-shopee-buyer-chat-normalized-page/1'
     or p_page->>'shopId' is distinct from p_shop_id
     or p_page->>'conversationId' is distinct from p_evidence->>'conversationId'
     or p_page->'inputCursor' is distinct from 'null'::jsonb
     or p_page->'nextCursor' is distinct from 'null'::jsonb
     or p_page->>'pageSize' is distinct from '1'
     or jsonb_typeof(p_page->'messages') is distinct from 'array'
     or jsonb_array_length(p_page->'messages')<>1
     or p_page#>>'{messages,0,conversationId}' is distinct from
       p_evidence->>'conversationId'
     or p_page#>>'{messages,0,messageId}' is distinct from p_evidence->>'messageId' then
    raise exception 'SHOPEE_BUYER_CHAT_VERIFIED_PUSH_INVALID' using errcode='22023';
  end if;
  begin
    v_push_timestamp:=(p_evidence->>'pushTimestamp')::timestamptz;
    v_received_at:=(p_evidence->>'receivedAt')::timestamptz;
  exception when others then
    raise exception 'SHOPEE_BUYER_CHAT_VERIFIED_PUSH_INVALID' using errcode='22023';
  end;
  select entitlement.* into v_entitlement
    from sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements entitlement
   where entitlement.credential_id=p_credential_id
     and entitlement.shop_id=p_shop_id
     and entitlement.entitlement_id=p_entitlement_id
     and entitlement.webhook_event='webchat_push'
     and entitlement.app_type in (
       'original','seller_in_house_system','customer_service'
     )
     and public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
       p_credential_id,p_shop_id,p_entitlement_id
     ) is not null
   for update;
  if not found then
    raise exception 'SHOPEE_BUYER_CHAT_PUSH_ENTITLEMENT_UNAVAILABLE' using errcode='42501';
  end if;
  v_owner_id:=v_entitlement.owner_id;
  v_ingest:=public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(
    v_owner_id,p_credential_id,p_page
  );
  if v_ingest->>'contract' is distinct from 'sellerpilot-shopee-buyer-chat-ingest/1'
     or v_ingest->>'shopId' is distinct from p_shop_id
     or v_ingest->>'conversationId' is distinct from p_evidence->>'conversationId'
     or v_ingest->>'acceptedCount' is distinct from '1'
     or v_ingest->>'reply' is distinct from 'false' then
    raise exception 'SHOPEE_BUYER_CHAT_CANONICAL_RECEIPT_INVALID' using errcode='22023';
  end if;

  insert into sellerpilot_private.cs_shopee_buyer_chat_push_receipts(
    owner_id,credential_id,shop_id,entitlement_id,conversation_id,message_id,
    request_id,region,push_timestamp,callback_url_sha256,raw_body_sha256,
    authorization_sha256,received_at
  ) values(
    v_owner_id,p_credential_id,p_shop_id,p_entitlement_id,
    p_evidence->>'conversationId',p_evidence->>'messageId',p_evidence->>'requestId',
    p_evidence->>'region',v_push_timestamp,p_evidence->>'callbackUrlSha256',
    p_evidence->>'rawBodySha256',p_evidence->>'authorizationSha256',
    v_received_at
  ) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then
    select receipt.* into v_existing
      from sellerpilot_private.cs_shopee_buyer_chat_push_receipts receipt
     where receipt.owner_id=v_owner_id and receipt.credential_id=p_credential_id
       and receipt.shop_id=p_shop_id and receipt.entitlement_id=p_entitlement_id
       and receipt.conversation_id=p_evidence->>'conversationId'
       and receipt.message_id=p_evidence->>'messageId'
     for update;
    if v_existing.raw_body_sha256 is distinct from p_evidence->>'rawBodySha256'
       or v_existing.authorization_sha256 is distinct from p_evidence->>'authorizationSha256'
       or v_existing.callback_url_sha256 is distinct from p_evidence->>'callbackUrlSha256'
       or v_existing.request_id is distinct from p_evidence->>'requestId'
       or v_existing.region is distinct from p_evidence->>'region'
       or v_existing.push_timestamp is distinct from v_push_timestamp then
      raise exception 'SHOPEE_BUYER_CHAT_PUSH_REPLAY_CONFLICT' using errcode='23505';
    end if;
  end if;
  v_status:=case when v_inserted=1 then 'ingested' else 'replayed' end;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-buyer-chat-verified-push-ingest/1',
    'status',v_status,
    'credentialId',p_credential_id::text,'shopId',p_shop_id,
    'conversationId',p_evidence->>'conversationId',
    'messageId',p_evidence->>'messageId','reply',false
  );
end $$;

revoke all on function public.sellerpilot_service_resolve_cs_shopee_buyer_chat_push_transport_v1(text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_resolve_cs_shopee_buyer_chat_push_transport_v1(text)
  to service_role;
revoke all on function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_verified_push_v1(
  uuid,text,uuid,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_verified_push_v1(
  uuid,text,uuid,jsonb,jsonb
) to service_role;

commit;
