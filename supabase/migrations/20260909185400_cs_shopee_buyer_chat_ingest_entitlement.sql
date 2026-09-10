-- Proposal only. Central owns the migration timestamp and integration.
-- Apply after 20260909165247_cs_shopee_buyer_chat_read_ledger.sql.
-- This adds no provider URL, automatic read, webhook receiver or reply path.
begin;

create table sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements (
  entitlement_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  state text not null check (state in ('approved','revoked')),
  entitlement_revision text not null
    check (entitlement_revision ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  contract_revision text not null
    check (contract_revision ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  contract_source_url text not null
    check (contract_source_url ~ '^https://open[.]shopee[.](com|cn)/'),
  contract_verified_at timestamptz not null,
  app_type text not null check (app_type ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  app_approved_at timestamptz not null,
  webhook_event text not null
    check (webhook_event ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  webhook_verified_at timestamptz not null,
  capability_evidence_sha256 text not null
    check (capability_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  credential_environment text not null
    check (credential_environment in ('production','sandbox')),
  credential_seller_account_key text not null
    check (credential_seller_account_key ~ '^[a-f0-9]{64}$'),
  credential_seller_account_verified_at timestamptz not null,
  shop_binding_sha256 text not null check (shop_binding_sha256 ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, credential_id, shop_id, entitlement_id),
  check (expires_at > issued_at),
  check ((state='approved' and revoked_at is null)
    or (state='revoked' and revoked_at is not null))
);

create table sellerpilot_private.cs_shopee_buyer_chat_ingest_progress (
  owner_id uuid not null,
  credential_id uuid not null,
  shop_id text not null,
  entitlement_id uuid not null,
  conversation_id text not null
    check (conversation_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  committed_cursor text check (committed_cursor is null or length(committed_cursor) between 1 and 512),
  last_input_cursor text check (last_input_cursor is null or length(last_input_cursor) between 1 and 512),
  last_next_cursor text check (last_next_cursor is null or length(last_next_cursor) between 1 and 512),
  last_page_sha256 text check (last_page_sha256 is null or last_page_sha256 ~ '^[a-f0-9]{64}$'),
  last_accepted_count integer check (last_accepted_count is null or last_accepted_count between 0 and 100),
  committed_at timestamptz,
  primary key (owner_id, credential_id, shop_id, entitlement_id, conversation_id),
  foreign key (owner_id, credential_id, shop_id, entitlement_id)
    references sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements(
      owner_id, credential_id, shop_id, entitlement_id
    ) on delete restrict
);

alter table sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements enable row level security;
alter table sellerpilot_private.cs_shopee_buyer_chat_ingest_progress enable row level security;
revoke all on sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements
  from public,anon,authenticated,service_role;
revoke all on sellerpilot_private.cs_shopee_buyer_chat_ingest_progress
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
  p_credential_id uuid, p_shop_id text, p_entitlement_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_entitlement sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements%rowtype;
begin
  if p_credential_id is null or p_entitlement_id is null
     or coalesce(p_shop_id,'') !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'SHOPEE_BUYER_CHAT_ENTITLEMENT_INPUT_INVALID' using errcode='22023';
  end if;
  select entitlement.* into v_entitlement
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
    join sellerpilot_private.cs_shopee_buyer_chat_capabilities capability
      on capability.owner_id=entitlement.owner_id
     and capability.credential_id=entitlement.credential_id
     and capability.shop_id=entitlement.shop_id
     and capability.state='approved'
     and capability.contract_revision=entitlement.contract_revision
     and capability.contract_source_url=entitlement.contract_source_url
     and capability.contract_verified_at=entitlement.contract_verified_at
     and capability.app_approved_at=entitlement.app_approved_at
     and capability.webhook_verified_at=entitlement.webhook_verified_at
     and capability.evidence_sha256=entitlement.capability_evidence_sha256
     and capability.credential_environment=entitlement.credential_environment
     and capability.credential_seller_account_key=entitlement.credential_seller_account_key
     and capability.credential_seller_account_verified_at=
       entitlement.credential_seller_account_verified_at
     and capability.shop_binding_sha256=entitlement.shop_binding_sha256
   where entitlement.credential_id=p_credential_id
     and entitlement.shop_id=p_shop_id
     and entitlement.entitlement_id=p_entitlement_id
     and entitlement.state='approved'
     and entitlement.revoked_at is null
     and entitlement.issued_at<=statement_timestamp()
     and entitlement.expires_at>statement_timestamp();
  if not found then return null; end if;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-buyer-chat-ingest-entitlement/1',
    'entitlementId',v_entitlement.entitlement_id::text,
    'credentialId',v_entitlement.credential_id::text,
    'shopId',v_entitlement.shop_id,
    'expiresAt',to_char(v_entitlement.expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'permissionEvidence',jsonb_build_object(
      'configuredKeys',true,
      'contractDocument',jsonb_build_object(
        'module','sellerchat','revision',v_entitlement.contract_revision,
        'sourceUrl',v_entitlement.contract_source_url,
        'verifiedAt',to_char(v_entitlement.contract_verified_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'conversationListApproved',true,'messageHistoryApproved',true
      ),
      'appApproval',jsonb_build_object(
        'state','approved','appType',v_entitlement.app_type,
        'approvedAt',to_char(v_entitlement.app_approved_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      'webhookApproval',jsonb_build_object(
        'state','approved','event',v_entitlement.webhook_event,
        'verifiedAt',to_char(v_entitlement.webhook_verified_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
  );
end $$;

create function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(
  p_credential_id uuid, p_shop_id text, p_entitlement_id uuid, p_page jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_entitlement sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements%rowtype;
  v_progress sellerpilot_private.cs_shopee_buyer_chat_ingest_progress%rowtype;
  v_owner_id uuid; v_conversation_id text; v_input_cursor text; v_next_cursor text;
  v_page_sha text; v_ingest jsonb; v_accepted integer;
begin
  if p_credential_id is null or p_entitlement_id is null
     or coalesce(p_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
     or jsonb_typeof(p_page) is distinct from 'object'
     or p_page->>'contract' is distinct from 'sellerpilot-shopee-buyer-chat-normalized-page/1'
     or p_page->>'shopId' is distinct from p_shop_id
     or coalesce(p_page->>'conversationId','') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or jsonb_typeof(p_page->'inputCursor') not in ('string','null')
     or jsonb_typeof(p_page->'nextCursor') not in ('string','null') then
    raise exception 'SHOPEE_BUYER_CHAT_AUTHORIZED_INGEST_INVALID' using errcode='22023';
  end if;
  v_conversation_id:=p_page->>'conversationId';
  v_input_cursor:=case when p_page->'inputCursor'='null'::jsonb
    then null else p_page->>'inputCursor' end;
  v_next_cursor:=case when p_page->'nextCursor'='null'::jsonb
    then null else p_page->>'nextCursor' end;
  if length(coalesce(v_input_cursor,''))>512 or length(coalesce(v_next_cursor,''))>512 then
    raise exception 'SHOPEE_BUYER_CHAT_AUTHORIZED_INGEST_INVALID' using errcode='22023';
  end if;

  select entitlement.* into v_entitlement
    from sellerpilot_private.cs_shopee_buyer_chat_ingest_entitlements entitlement
   where entitlement.credential_id=p_credential_id
     and entitlement.shop_id=p_shop_id
     and entitlement.entitlement_id=p_entitlement_id
     and entitlement.state='approved' and entitlement.revoked_at is null
     and entitlement.issued_at<=statement_timestamp()
     and entitlement.expires_at>statement_timestamp()
     and public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
       p_credential_id,p_shop_id,p_entitlement_id
     ) is not null
   for update;
  if not found then
    raise exception 'SHOPEE_BUYER_CHAT_ENTITLEMENT_UNAVAILABLE' using errcode='42501';
  end if;
  v_owner_id:=v_entitlement.owner_id;
  v_page_sha:=encode(extensions.digest(p_page::text,'sha256'),'hex');

  insert into sellerpilot_private.cs_shopee_buyer_chat_ingest_progress(
    owner_id,credential_id,shop_id,entitlement_id,conversation_id
  ) values(v_owner_id,p_credential_id,p_shop_id,p_entitlement_id,v_conversation_id)
  on conflict do nothing;
  select progress.* into v_progress
    from sellerpilot_private.cs_shopee_buyer_chat_ingest_progress progress
   where progress.owner_id=v_owner_id and progress.credential_id=p_credential_id
     and progress.shop_id=p_shop_id and progress.entitlement_id=p_entitlement_id
     and progress.conversation_id=v_conversation_id
   for update;

  if v_progress.last_page_sha256=v_page_sha
     and v_progress.last_input_cursor is not distinct from v_input_cursor
     and v_progress.last_next_cursor is not distinct from v_next_cursor then
    return jsonb_build_object(
      'contract','sellerpilot-shopee-buyer-chat-authorized-ingest/1',
      'status','replayed','credentialId',p_credential_id::text,'shopId',p_shop_id,
      'conversationId',v_conversation_id,'acceptedCount',v_progress.last_accepted_count,
      'committedCursor',v_progress.committed_cursor,'reply',false
    );
  end if;
  if v_progress.committed_cursor is distinct from v_input_cursor then
    raise exception 'SHOPEE_BUYER_CHAT_CONTINUATION_MISMATCH' using errcode='40001';
  end if;

  v_ingest:=public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(
    v_owner_id,p_credential_id,p_page
  );
  v_accepted:=(v_ingest->>'acceptedCount')::integer;
  update sellerpilot_private.cs_shopee_buyer_chat_ingest_progress set
    committed_cursor=v_next_cursor,last_input_cursor=v_input_cursor,
    last_next_cursor=v_next_cursor,last_page_sha256=v_page_sha,
    last_accepted_count=v_accepted,committed_at=clock_timestamp()
   where owner_id=v_owner_id and credential_id=p_credential_id
     and shop_id=p_shop_id and entitlement_id=p_entitlement_id
     and conversation_id=v_conversation_id;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-buyer-chat-authorized-ingest/1',
    'status','ingested','credentialId',p_credential_id::text,'shopId',p_shop_id,
    'conversationId',v_conversation_id,'acceptedCount',v_accepted,
    'committedCursor',v_next_cursor,'reply',false
  );
end $$;

revoke all on function public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
  uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
  uuid,text,uuid
) to service_role;
revoke all on function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(
  uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1(
  uuid,text,uuid,jsonb
) to service_role;
commit;
