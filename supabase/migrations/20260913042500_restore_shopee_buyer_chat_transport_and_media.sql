-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_cs_shopee_buyer_chat_media_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_cs_shopee_buyer_chat_media_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_cs_shopee_buyer_chat_push_status_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_cs_shopee_buyer_chat_push_status_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_cs_shopee_buyer_chat_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_cs_shopee_buyer_chat_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_ingest_cs_shopee_buyer_chat_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_ingest_cs_shopee_buyer_chat_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_ingest_cs_shopee_buyer_chat_verified_push_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_ingest_cs_shopee_buyer_chat_verified_push_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_ingest_shopee_buyer_chat_media_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_ingest_shopee_buyer_chat_media_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_ingest_shopee_buyer_chat_push_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_ingest_shopee_buyer_chat_push_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_shopee_chat_entitlement_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_shopee_chat_entitlement_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_resolve_cs_shopee_buyer_chat_push_transport_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_resolve_cs_shopee_buyer_chat_push_transport_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_resolve_shopee_buyer_chat_push_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_resolve_shopee_buyer_chat_push_v1';end if;
end $recovery_guard$;
-- Reviewed source: 20260909165247_cs_shopee_buyer_chat_read_ledger.sql
-- Source SHA256: d6e984b26fd4f2e052edaadd1579ef18fa3c9fd6eef9fd623ab094baaba4350a
-- Proposal only. Central must allocate the production migration version.
-- This does not name or call a Shopee SellerChat endpoint. It stores only a
-- centrally authorized, already-normalized read page after three independent
-- approval facts exist. Configured API keys are deliberately not evidence.
create table sellerpilot_private.cs_shopee_buyer_chat_capabilities (
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  state text not null default 'permission_pending'
    check (state in ('permission_pending','approved')),
  contract_revision text check (contract_revision is null or contract_revision ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  contract_source_url text check (contract_source_url is null or contract_source_url ~ '^https://open[.]shopee[.](com|cn)/'),
  contract_verified_at timestamptz,
  app_approved_at timestamptz,
  webhook_verified_at timestamptz,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  credential_environment text check (
    credential_environment is null or credential_environment in ('production','sandbox')
  ),
  credential_seller_account_key text check (
    credential_seller_account_key is null or credential_seller_account_key ~ '^[a-f0-9]{64}$'
  ),
  credential_seller_account_verified_at timestamptz,
  shop_binding_sha256 text check (
    shop_binding_sha256 is null or shop_binding_sha256 ~ '^[a-f0-9]{64}$'
  ),
  checked_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, credential_id, shop_id),
  check (state <> 'approved' or (
    contract_revision is not null and contract_source_url is not null
    and contract_verified_at is not null and app_approved_at is not null
    and webhook_verified_at is not null and evidence_sha256 is not null
    and credential_environment is not null and credential_seller_account_key is not null
    and credential_seller_account_verified_at is not null
    and shop_binding_sha256 is not null
  ))
);

create table sellerpilot_private.cs_shopee_buyer_chat_messages (
  owner_id uuid not null,
  credential_id uuid not null,
  shop_id text not null,
  conversation_id text not null check (conversation_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  message_id text not null check (message_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  sender_role text not null check (sender_role in ('buyer','seller','system')),
  body text not null check (length(body) between 1 and 4000),
  body_fingerprint text not null check (body_fingerprint ~ '^[a-f0-9]{64}$'),
  sent_at timestamptz not null,
  order_sn text check (order_sn is null or order_sn ~ '^[A-Za-z0-9_-]{1,80}$'),
  item_id text check (item_id is null or item_id ~ '^[1-9][0-9]{0,31}$'),
  attachment_count integer not null check (attachment_count between 0 and 20),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, credential_id, shop_id, conversation_id, message_id),
  unique (owner_id, credential_id, identity_digest),
  foreign key (owner_id, credential_id, shop_id)
    references sellerpilot_private.cs_shopee_buyer_chat_capabilities(owner_id, credential_id, shop_id)
    on delete restrict
);

alter table sellerpilot_private.cs_shopee_buyer_chat_capabilities enable row level security;
alter table sellerpilot_private.cs_shopee_buyer_chat_messages enable row level security;
revoke all on sellerpilot_private.cs_shopee_buyer_chat_capabilities
  from public, anon, authenticated, service_role;
revoke all on sellerpilot_private.cs_shopee_buyer_chat_messages
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(
  p_owner_id uuid, p_credential_id uuid, p_page jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_capability sellerpilot_private.cs_shopee_buyer_chat_capabilities%rowtype;
  v_message jsonb; v_existing sellerpilot_private.cs_shopee_buyer_chat_messages%rowtype;
  v_count integer; v_shop_id text; v_conversation_id text; v_sent_at timestamptz;
  v_identity text; v_body_sha text; v_evidence_sha text;
begin
  if p_owner_id is null or p_credential_id is null or jsonb_typeof(p_page) is distinct from 'object'
     or not (p_page ?& array['contract','shopId','conversationId','inputCursor','nextCursor','pageSize','messages'])
     or p_page - array['contract','shopId','conversationId','inputCursor','nextCursor','pageSize','messages'] <> '{}'::jsonb
     or jsonb_typeof(p_page->'contract') is distinct from 'string'
     or p_page->>'contract' is distinct from 'sellerpilot-shopee-buyer-chat-normalized-page/1'
     or jsonb_typeof(p_page->'pageSize') is distinct from 'number'
     or jsonb_typeof(p_page->'messages') is distinct from 'array' then
    raise exception 'SHOPEE_BUYER_CHAT_PAGE_INVALID' using errcode='22023';
  end if;
  begin v_count := (p_page->>'pageSize')::integer;
  exception when others then raise exception 'SHOPEE_BUYER_CHAT_PAGE_INVALID' using errcode='22023'; end;
  v_shop_id := p_page->>'shopId'; v_conversation_id := p_page->>'conversationId';
  if coalesce(v_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(v_conversation_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or v_count not between 1 and 100 or jsonb_array_length(p_page->'messages') > v_count
     or (p_page->'inputCursor' <> 'null'::jsonb and
       (jsonb_typeof(p_page->'inputCursor') <> 'string' or length(p_page->>'inputCursor') not between 1 and 512))
     or (p_page->'nextCursor' <> 'null'::jsonb and
       (jsonb_typeof(p_page->'nextCursor') <> 'string' or length(p_page->>'nextCursor') not between 1 and 512))
     or (p_page->'nextCursor' <> 'null'::jsonb and
       (p_page->>'nextCursor'=p_page->>'inputCursor' or jsonb_array_length(p_page->'messages')=0)) then
    raise exception 'SHOPEE_BUYER_CHAT_PAGE_INVALID' using errcode='22023';
  end if;

  select capability.* into v_capability
    from sellerpilot_private.cs_shopee_buyer_chat_capabilities capability
    join sellerpilot_private.channel_credentials credential
     on credential.id=capability.credential_id and credential.created_by=capability.owner_id
     and credential.channel='shopee' and credential.status in ('active','grace')
     and (credential.expires_at is null or credential.expires_at>statement_timestamp())
     and credential.environment=capability.credential_environment
     and credential.seller_account_key=capability.credential_seller_account_key
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at=capability.credential_seller_account_verified_at
   where capability.owner_id=p_owner_id and capability.credential_id=p_credential_id
     and capability.shop_id=v_shop_id and capability.state='approved'
     and capability.contract_revision is not null and capability.contract_source_url is not null
     and capability.contract_verified_at is not null and capability.app_approved_at is not null
     and capability.webhook_verified_at is not null and capability.evidence_sha256 is not null
     and capability.shop_binding_sha256=encode(extensions.digest(
       'sellerpilot-shopee-buyer-chat-shop-binding/1'||E'\n'||capability.credential_id::text||E'\n'||
       capability.credential_seller_account_key||E'\n'||capability.credential_environment||E'\n'||
       capability.shop_id,'sha256'),'hex')
   for update of capability;
  if not found then raise exception 'SHOPEE_BUYER_CHAT_PERMISSION_PENDING' using errcode='42501'; end if;

  for v_message in select value from jsonb_array_elements(p_page->'messages') loop
    if jsonb_typeof(v_message) is distinct from 'object'
       or not (v_message ?& array['shopId','conversationId','messageId','identityDigest','senderRole',
         'body','bodyFingerprint','sentAt','orderSn','itemId','attachmentCount','evidenceDigest'])
       or v_message - array['shopId','conversationId','messageId','identityDigest','senderRole',
         'body','bodyFingerprint','sentAt','orderSn','itemId','attachmentCount','evidenceDigest'] <> '{}'::jsonb
       or jsonb_typeof(v_message->'shopId') is distinct from 'string'
       or v_message->>'shopId' is distinct from v_shop_id
       or jsonb_typeof(v_message->'conversationId') is distinct from 'string'
       or v_message->>'conversationId' is distinct from v_conversation_id
       or jsonb_typeof(v_message->'messageId') is distinct from 'string'
       or coalesce(v_message->>'messageId','') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       or jsonb_typeof(v_message->'senderRole') is distinct from 'string'
       or v_message->>'senderRole' not in ('buyer','seller','system')
       or jsonb_typeof(v_message->'body') is distinct from 'string'
       or length(coalesce(v_message->>'body','')) not between 1 and 4000
       or jsonb_typeof(v_message->'sentAt') is distinct from 'string'
       or jsonb_typeof(v_message->'attachmentCount') is distinct from 'number'
       or jsonb_typeof(v_message->'orderSn') not in ('string','null')
       or jsonb_typeof(v_message->'itemId') not in ('string','null')
       or (v_message->'orderSn' <> 'null'::jsonb and coalesce(v_message->>'orderSn','') !~ '^[A-Za-z0-9_-]{1,80}$')
       or (v_message->'itemId' <> 'null'::jsonb and coalesce(v_message->>'itemId','') !~ '^[1-9][0-9]{0,31}$') then
      raise exception 'SHOPEE_BUYER_CHAT_MESSAGE_INVALID' using errcode='22023';
    end if;
    begin
      v_sent_at := (v_message->>'sentAt')::timestamptz;
      v_count := (v_message->>'attachmentCount')::integer;
    exception when others then raise exception 'SHOPEE_BUYER_CHAT_MESSAGE_INVALID' using errcode='22023'; end;
    if v_count not between 0 and 20 then raise exception 'SHOPEE_BUYER_CHAT_MESSAGE_INVALID' using errcode='22023'; end if;
    v_identity := encode(extensions.digest(v_shop_id||E'\n'||v_conversation_id||E'\n'||(v_message->>'messageId'),'sha256'),'hex');
    v_body_sha := encode(extensions.digest(v_message->>'body','sha256'),'hex');
    v_evidence_sha := encode(extensions.digest(v_identity||E'\n'||v_body_sha||E'\n'||(v_message->>'senderRole')||E'\n'||
      (v_message->>'sentAt')||E'\n'||coalesce(v_message->>'orderSn','')||E'\n'||coalesce(v_message->>'itemId','')||E'\n'||v_count::text,'sha256'),'hex');
    if v_message->>'identityDigest' is distinct from v_identity
       or v_message->>'bodyFingerprint' is distinct from v_body_sha
       or v_message->>'evidenceDigest' is distinct from v_evidence_sha then
      raise exception 'SHOPEE_BUYER_CHAT_EVIDENCE_INVALID' using errcode='23514';
    end if;

    insert into sellerpilot_private.cs_shopee_buyer_chat_messages(
      owner_id,credential_id,shop_id,conversation_id,message_id,identity_digest,sender_role,
      body,body_fingerprint,sent_at,order_sn,item_id,attachment_count,evidence_sha256
    ) values (p_owner_id,p_credential_id,v_shop_id,v_conversation_id,v_message->>'messageId',
      v_identity,v_message->>'senderRole',v_message->>'body',v_body_sha,v_sent_at,
      nullif(v_message->>'orderSn',''),nullif(v_message->>'itemId',''),v_count,v_evidence_sha)
    on conflict (owner_id,credential_id,shop_id,conversation_id,message_id) do nothing;
    if not found then
      select message.* into v_existing from sellerpilot_private.cs_shopee_buyer_chat_messages message
       where message.owner_id=p_owner_id and message.credential_id=p_credential_id
         and message.shop_id=v_shop_id and message.conversation_id=v_conversation_id
         and message.message_id=v_message->>'messageId';
      if v_existing.identity_digest<>v_identity or v_existing.sender_role<>v_message->>'senderRole'
         or v_existing.body_fingerprint<>v_body_sha or v_existing.sent_at<>v_sent_at
         or v_existing.order_sn is distinct from nullif(v_message->>'orderSn','')
         or v_existing.item_id is distinct from nullif(v_message->>'itemId','')
         or v_existing.attachment_count<>v_count or v_existing.evidence_sha256<>v_evidence_sha then
        raise exception 'SHOPEE_BUYER_CHAT_IDENTITY_CONFLICT' using errcode='23505';
      end if;
    end if;
  end loop;
  return jsonb_build_object('contract','sellerpilot-shopee-buyer-chat-ingest/1',
    'shopId',v_shop_id,'conversationId',v_conversation_id,
    'acceptedCount',jsonb_array_length(p_page->'messages'),'reply',false);
end $$;

create function public.sellerpilot_read_cs_shopee_buyer_chat_v1(
  p_credential_id uuid default null, p_shop_id text default null,
  p_conversation_id text default null, p_cursor text default null,
  p_limit integer default 100
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid(); v_checked_at timestamptz := clock_timestamp();
  v_capability sellerpilot_private.cs_shopee_buyer_chat_capabilities%rowtype;
  v_shops jsonb := '[]'::jsonb; v_messages jsonb; v_next text; v_count integer;
  v_candidate_count integer; v_cursor jsonb; v_cursor_at timestamptz;
  v_cursor_conversation text; v_cursor_message text; v_runtime_ready boolean;
  v_any_ready boolean := false; v_any_stored boolean := false;
  v_reason text := 'contract_permission_unverified';
begin
  if v_actor_id is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or (p_credential_id is not null and p_shop_id is null)
     or (p_conversation_id is not null and p_shop_id is null)
     or (p_shop_id is not null and p_shop_id !~ '^[1-9][0-9]{0,31}$')
     or (p_conversation_id is not null and p_conversation_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$')
     or length(coalesce(p_cursor,''))>1024
     or (p_cursor is not null and (p_credential_id is null or p_shop_id is null)) then
    raise exception 'SHOPEE_BUYER_CHAT_READ_INVALID' using errcode='22023';
  end if;
  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
      v_cursor_at := (v_cursor->>'sentAt')::timestamptz;
      v_cursor_conversation := v_cursor->>'conversationId';
      v_cursor_message := v_cursor->>'messageId';
    exception when others then
      raise exception 'SHOPEE_BUYER_CHAT_CURSOR_INVALID' using errcode='22023';
    end;
    if jsonb_typeof(v_cursor) is distinct from 'object'
       or not (v_cursor ?& array['contract','credentialId','shopId','conversationScope',
         'shopBinding','sentAt','conversationId','messageId'])
       or v_cursor - array['contract','credentialId','shopId','conversationScope',
         'shopBinding','sentAt','conversationId','messageId'] <> '{}'::jsonb
       or jsonb_typeof(v_cursor->'contract') is distinct from 'string'
       or v_cursor->>'contract' is distinct from 'sellerpilot-shopee-buyer-chat-cursor/2'
       or jsonb_typeof(v_cursor->'credentialId') is distinct from 'string'
       or jsonb_typeof(v_cursor->'shopId') is distinct from 'string'
       or jsonb_typeof(v_cursor->'shopBinding') is distinct from 'string'
       or jsonb_typeof(v_cursor->'sentAt') is distinct from 'string'
       or jsonb_typeof(v_cursor->'conversationId') is distinct from 'string'
       or jsonb_typeof(v_cursor->'messageId') is distinct from 'string'
       or jsonb_typeof(v_cursor->'conversationScope') not in ('string','null')
       or v_cursor->>'credentialId' is distinct from p_credential_id::text
       or v_cursor->>'shopId' is distinct from p_shop_id
       or v_cursor->>'conversationScope' is distinct from p_conversation_id
       or v_cursor->>'shopBinding' !~ '^[a-f0-9]{64}$'
       or v_cursor_conversation !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       or v_cursor_message !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       or p_cursor is distinct from replace(encode(convert_to(v_cursor::text,'UTF8'),'base64'),E'\n','') then
      raise exception 'SHOPEE_BUYER_CHAT_CURSOR_INVALID' using errcode='22023';
    end if;
  end if;

  for v_capability in select capability.*
    from sellerpilot_private.cs_shopee_buyer_chat_capabilities capability
   where (p_credential_id is null or capability.credential_id=p_credential_id)
     and (p_shop_id is null or capability.shop_id=p_shop_id)
   order by capability.credential_id,capability.shop_id limit 8 loop
    v_runtime_ready := v_capability.state='approved'
      and v_capability.contract_revision is not null
      and v_capability.contract_source_url is not null
      and v_capability.contract_verified_at is not null
      and v_capability.app_approved_at is not null
      and v_capability.webhook_verified_at is not null
      and v_capability.evidence_sha256 is not null
      and exists (
        select 1 from sellerpilot_private.channel_credentials credential
         where credential.id=v_capability.credential_id
           and credential.created_by=v_capability.owner_id
           and credential.channel='shopee'
           and credential.environment=v_capability.credential_environment
           and credential.seller_account_key=v_capability.credential_seller_account_key
           and credential.seller_account_key_source='provider_certified_v1'
           and credential.seller_account_verified_at=v_capability.credential_seller_account_verified_at
           and credential.status in ('active','grace')
           and (credential.expires_at is null or credential.expires_at>statement_timestamp())
           and v_capability.shop_binding_sha256=encode(extensions.digest(
             'sellerpilot-shopee-buyer-chat-shop-binding/1'||E'\n'||credential.id::text||E'\n'||
             credential.seller_account_key||E'\n'||credential.environment||E'\n'||
             v_capability.shop_id,'sha256'),'hex')
      );
    if v_runtime_ready then
      v_any_ready := true; v_reason := 'approved_read_only';
    elsif v_capability.state='approved' then
      v_reason := 'credential_unavailable';
    elsif v_capability.contract_revision is not null and v_capability.contract_verified_at is not null then
      v_reason := case when v_capability.app_approved_at is null then 'app_approval_unverified'
        else 'webhook_permission_unverified' end;
    end if;
    if p_cursor is not null
       and v_cursor->>'shopBinding' is distinct from v_capability.shop_binding_sha256 then
      raise exception 'SHOPEE_BUYER_CHAT_CURSOR_SCOPE_CHANGED' using errcode='22023';
    end if;

    select count(distinct message.conversation_id)::integer into v_count
      from sellerpilot_private.cs_shopee_buyer_chat_messages message
     where message.owner_id=v_capability.owner_id
       and message.credential_id=v_capability.credential_id
       and message.shop_id=v_capability.shop_id
       and (p_conversation_id is null or message.conversation_id=p_conversation_id);
    v_any_stored := v_any_stored or v_count>0;
    with page as (
      select message.* from sellerpilot_private.cs_shopee_buyer_chat_messages message
       where message.owner_id=v_capability.owner_id
         and message.credential_id=v_capability.credential_id
         and message.shop_id=v_capability.shop_id
         and (p_conversation_id is null or message.conversation_id=p_conversation_id)
         and (p_cursor is null or (message.sent_at,message.conversation_id,message.message_id)
           <(v_cursor_at,v_cursor_conversation,v_cursor_message))
       order by message.sent_at desc,message.conversation_id desc,message.message_id desc
       limit p_limit+1
    ), visible as (
      select * from page
       order by sent_at desc,conversation_id desc,message_id desc limit p_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object('shopId',shop_id,'conversationId',conversation_id,
      'messageId',message_id,'identityDigest',identity_digest,'senderRole',sender_role,'body',body,
      'bodyFingerprint',body_fingerprint,'sentAt',to_char(sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'orderSn',order_sn,'itemId',item_id,'attachmentCount',attachment_count)
      order by sent_at desc,conversation_id desc,message_id desc),'[]'::jsonb),
      (select count(*)::integer from page),
      case when (select count(*) from page)>p_limit then
        (select replace(encode(convert_to(jsonb_build_object(
          'contract','sellerpilot-shopee-buyer-chat-cursor/2',
          'credentialId',v_capability.credential_id::text,
          'shopId',v_capability.shop_id,
          'conversationScope',p_conversation_id,
          'shopBinding',v_capability.shop_binding_sha256,
          'sentAt',to_char(sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'conversationId',conversation_id,'messageId',message_id
        )::text,'UTF8'),'base64'),E'\n','')
          from visible order by sent_at,conversation_id,message_id limit 1) else null end
      into v_messages,v_candidate_count,v_next from visible;
    v_shops := v_shops || jsonb_build_array(jsonb_build_object(
      'credentialId',v_capability.credential_id::text,'shopId',v_capability.shop_id,
      'state',case when v_runtime_ready then 'read_only_ready' else 'permission_pending' end,
      'runtimeReady',v_runtime_ready,'storedHistory',v_count>0,
      'conversationCount',v_count,'messages',v_messages,'nextCursor',v_next));
  end loop;
  return jsonb_build_object('contract','sellerpilot-shopee-buyer-chat-read/2',
    'checkedAt',to_char(v_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'state',case when v_any_ready then 'read_only_ready' else 'permission_pending' end,
    'reason',case when v_any_ready then 'approved_read_only' else v_reason end,
    'receive',v_any_ready,'history',v_any_ready,'storedHistory',v_any_stored,
    'reply',false,'shops',v_shops);
end $$;

revoke all on function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1(uuid,uuid,jsonb)
  to service_role;
revoke all on function public.sellerpilot_read_cs_shopee_buyer_chat_v1(uuid,text,text,text,integer)
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_shopee_buyer_chat_v1(uuid,text,text,text,integer)
  to authenticated;

-- Reviewed source: 20260909185400_cs_shopee_buyer_chat_ingest_entitlement.sql
-- Source SHA256: daa0f725fd5ebfcb9830f432d2ee46e86c14292a334d9466df7ca5ef372930ae
-- Proposal only. Central owns the migration timestamp and integration.
-- Apply after 20260909165247_cs_shopee_buyer_chat_read_ledger.sql.
-- This adds no provider URL, automatic read, webhook receiver or reply path.
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

-- Reviewed source: 20260909221500_cs_shopee_buyer_chat_push_transport.sql
-- Source SHA256: 27ba9c491cb38241f38168a5bd714c1c942c680cfd3709a651366abbb66cc081
-- Proposal only. Central owns allocation and production application.
-- Official sources verified on 2026-09-10 KST:
-- https://open.shopee.com/developer-guide/18 (raw callback signature/retry contract)
-- https://open.shopee.com/push-mechanism/10 (webchat_push code 10 payload/replay contract)
-- SellerChat list/message endpoint details remain whitelist-gated, so this migration
-- enables signed inbound webchat_push only. It adds no polling or reply action.
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


-- Reviewed source: 20260909232000_cs_shopee_buyer_chat_push_status.sql
-- Source SHA256: bfa093651c5007d2ee9b59d3e566d433014caa030112a699f341f9c483a432d1
-- Proposal only. Central owns allocation and production application.
-- Apply after 20260909221500_cs_shopee_buyer_chat_push_transport.sql.
-- This exposes receipt metadata only to the existing authenticated shared-admin
-- boundary. It does not expose callback URLs, signatures, raw bodies or secrets.
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


-- Reviewed source: 20260910062000_cs_shopee_buyer_chat_push_media.sql
-- Source SHA256: e27d66a9861b4c51046c0d9649a80a77ac90ff2e077a0eee204dc333f77efc64
-- Proposal only. Central owns production migration allocation and application.
-- Official field source verified 2026-09-10 KST:
-- https://open.shopee.com/push-mechanism/10
-- image: url, thumb_url, thumb_height, thumb_width, file_server_id
-- video: video_url, thumb_url, thumb_height, thumb_width, duration_seconds
-- item: content.shop_id, content.item_id and source_content.item_id
-- Provider references are retained without server-side download or URL synthesis.
create table sellerpilot_private.cs_shopee_buyer_chat_message_media (
  owner_id uuid not null,
  credential_id uuid not null,
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  conversation_id text not null
    check (conversation_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  message_id text not null
    check (message_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'),
  media_type text not null check (media_type in ('image','video','item')),
  image_url text,
  video_reference text,
  thumbnail_reference text,
  thumbnail_width integer,
  thumbnail_height integer,
  file_server_id text,
  duration_seconds integer,
  item_shop_id text,
  item_id text,
  source_item_id text,
  descriptor_sha256 text not null check (descriptor_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,credential_id,shop_id,conversation_id,message_id),
  foreign key (owner_id,credential_id,shop_id,conversation_id,message_id)
    references sellerpilot_private.cs_shopee_buyer_chat_messages(
      owner_id,credential_id,shop_id,conversation_id,message_id
    ) on delete restrict,
  check (
    (media_type='image'
      and image_url is not null and video_reference is null
      and thumbnail_reference is not null
      and thumbnail_width between 1 and 20000 and thumbnail_height between 1 and 20000
      and file_server_id ~ '^[0-9]{1,32}$' and duration_seconds is null
      and item_shop_id is null and item_id is null and source_item_id is null)
    or
    (media_type='video'
      and image_url is null and video_reference is not null
      and thumbnail_reference is not null
      and thumbnail_width between 1 and 20000 and thumbnail_height between 1 and 20000
      and file_server_id is null and duration_seconds between 1 and 86400
      and item_shop_id is null and item_id is null and source_item_id is null)
    or
    (media_type='item'
      and image_url is null and video_reference is null and thumbnail_reference is null
      and thumbnail_width is null and thumbnail_height is null
      and file_server_id is null and duration_seconds is null
      and item_shop_id ~ '^[1-9][0-9]{0,31}$'
      and item_id ~ '^[1-9][0-9]{0,31}$'
      and source_item_id ~ '^[1-9][0-9]{0,31}$')
  )
);

alter table sellerpilot_private.cs_shopee_buyer_chat_message_media enable row level security;
revoke all on sellerpilot_private.cs_shopee_buyer_chat_message_media
  from public,anon,authenticated,service_role;

-- The accepted ingest and transport migrations used three identifiers longer
-- than PostgreSQL's 63-byte limit. These short service-only wrappers are the
-- PostgREST entrypoints;
-- their SQL bodies resolve the already-created, server-truncated functions.
create function public.sellerpilot_service_read_shopee_chat_entitlement_v1(
  p_credential_id uuid,p_shop_id text,p_entitlement_id uuid
) returns jsonb language sql security definer set search_path='' as $$
  select public.sellerpilot_service_read_cs_shopee_buyer_chat_ingest_entitlement_v1(
    p_credential_id,p_shop_id,p_entitlement_id
  )
$$;

create function public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1(
  p_shop_id text
) returns jsonb language sql security definer set search_path='' as $$
  select public.sellerpilot_service_resolve_cs_shopee_buyer_chat_push_transport_v1(p_shop_id)
$$;

create function public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(
  p_credential_id uuid,p_shop_id text,p_entitlement_id uuid,
  p_evidence jsonb,p_page jsonb
) returns jsonb language sql security definer set search_path='' as $$
  select public.sellerpilot_service_ingest_cs_shopee_buyer_chat_verified_push_v1(
    p_credential_id,p_shop_id,p_entitlement_id,p_evidence,p_page
  )
$$;

create function public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(
  p_credential_id uuid,p_shop_id text,p_entitlement_id uuid,
  p_evidence jsonb,p_page jsonb,p_media jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_receipt jsonb;
  v_owner_id uuid;
  v_existing sellerpilot_private.cs_shopee_buyer_chat_message_media%rowtype;
  v_inserted integer;
  v_type text;
  v_image_url text;
  v_video_reference text;
  v_thumbnail_reference text;
  v_thumbnail_width integer;
  v_thumbnail_height integer;
  v_file_server_id text;
  v_duration_seconds integer;
  v_item_shop_id text;
  v_item_id text;
  v_source_item_id text;
  v_descriptor text;
  v_expected_body text;
begin
  if jsonb_typeof(p_media) is distinct from 'object'
     or jsonb_typeof(p_media->'type') is distinct from 'string'
     or jsonb_typeof(p_media->'descriptorDigest') is distinct from 'string'
     or coalesce(p_media->>'descriptorDigest','') !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
  end if;
  v_type:=p_media->>'type';
  begin
    if v_type='image' then
      if not (p_media ?& array['type','imageUrl','thumbnailReference','thumbnailWidth',
           'thumbnailHeight','fileServerId','descriptorDigest'])
         or p_media-array['type','imageUrl','thumbnailReference','thumbnailWidth',
           'thumbnailHeight','fileServerId','descriptorDigest']<>'{}'::jsonb
         or jsonb_typeof(p_media->'imageUrl') is distinct from 'string'
         or length(p_media->>'imageUrl') not between 1 and 2048
         or p_media->>'imageUrl' !~ '^https://cf[.]shopee[.](sg|com[.]my|co[.]th|vn|co[.]id|ph|com[.]br|jp|kr|com[.]hk|cn)/file/[A-Za-z0-9._~%/-]+$'
         or position('..' in p_media->>'imageUrl')>0
         or jsonb_typeof(p_media->'thumbnailReference') is distinct from 'string'
         or length(p_media->>'thumbnailReference') not between 1 and 2048
         or p_media->>'thumbnailReference' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
         or jsonb_typeof(p_media->'thumbnailWidth') is distinct from 'number'
         or jsonb_typeof(p_media->'thumbnailHeight') is distinct from 'number'
         or jsonb_typeof(p_media->'fileServerId') is distinct from 'string'
         or p_media->>'fileServerId' !~ '^[0-9]{1,32}$' then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
      end if;
      v_image_url:=p_media->>'imageUrl';
      v_expected_body:='Shopee 이미지 첨부';
      v_thumbnail_reference:=p_media->>'thumbnailReference';
      v_thumbnail_width:=(p_media->>'thumbnailWidth')::integer;
      v_thumbnail_height:=(p_media->>'thumbnailHeight')::integer;
      v_file_server_id:=p_media->>'fileServerId';
      if v_thumbnail_width not between 1 and 20000
         or v_thumbnail_height not between 1 and 20000 then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
      end if;
      v_descriptor:=encode(extensions.digest('image'||E'\n'||v_image_url||E'\n'||
        v_thumbnail_reference||E'\n'||v_thumbnail_width::text||E'\n'||
        v_thumbnail_height::text||E'\n'||v_file_server_id,'sha256'),'hex');
    elsif v_type='video' then
      if not (p_media ?& array['type','videoReference','thumbnailReference','thumbnailWidth',
           'thumbnailHeight','durationSeconds','descriptorDigest'])
         or p_media-array['type','videoReference','thumbnailReference','thumbnailWidth',
           'thumbnailHeight','durationSeconds','descriptorDigest']<>'{}'::jsonb
         or jsonb_typeof(p_media->'videoReference') is distinct from 'string'
         or length(p_media->>'videoReference') not between 1 and 2048
         or p_media->>'videoReference' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
         or jsonb_typeof(p_media->'thumbnailReference') is distinct from 'string'
         or length(p_media->>'thumbnailReference') not between 1 and 2048
         or p_media->>'thumbnailReference' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
         or jsonb_typeof(p_media->'thumbnailWidth') is distinct from 'number'
         or jsonb_typeof(p_media->'thumbnailHeight') is distinct from 'number'
         or jsonb_typeof(p_media->'durationSeconds') is distinct from 'number' then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
      end if;
      v_video_reference:=p_media->>'videoReference';
      v_expected_body:='Shopee 동영상 첨부';
      v_thumbnail_reference:=p_media->>'thumbnailReference';
      v_thumbnail_width:=(p_media->>'thumbnailWidth')::integer;
      v_thumbnail_height:=(p_media->>'thumbnailHeight')::integer;
      v_duration_seconds:=(p_media->>'durationSeconds')::integer;
      if v_thumbnail_width not between 1 and 20000
         or v_thumbnail_height not between 1 and 20000
         or v_duration_seconds not between 1 and 86400 then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
      end if;
      v_descriptor:=encode(extensions.digest('video'||E'\n'||v_video_reference||E'\n'||
        v_thumbnail_reference||E'\n'||v_thumbnail_width::text||E'\n'||
        v_thumbnail_height::text||E'\n'||v_duration_seconds::text,'sha256'),'hex');
    elsif v_type='item' then
      if not (p_media ?& array['type','itemShopId','itemId','sourceItemId','descriptorDigest'])
         or p_media-array['type','itemShopId','itemId','sourceItemId','descriptorDigest']<>'{}'::jsonb
         or jsonb_typeof(p_media->'itemShopId') is distinct from 'string'
         or jsonb_typeof(p_media->'itemId') is distinct from 'string'
         or jsonb_typeof(p_media->'sourceItemId') is distinct from 'string'
         or p_media->>'itemShopId' !~ '^[1-9][0-9]{0,31}$'
         or p_media->>'itemId' !~ '^[1-9][0-9]{0,31}$'
         or p_media->>'sourceItemId' !~ '^[1-9][0-9]{0,31}$' then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
      end if;
      v_item_shop_id:=p_media->>'itemShopId';
      v_expected_body:='Shopee 상품 정보';
      v_item_id:=p_media->>'itemId';
      v_source_item_id:=p_media->>'sourceItemId';
      v_descriptor:=encode(extensions.digest('item'||E'\n'||v_item_shop_id||E'\n'||
        v_item_id||E'\n'||v_source_item_id,'sha256'),'hex');
    else
      raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'SHOPEE_BUYER_CHAT_MEDIA_INVALID' using errcode='22023';
  end;
  if v_descriptor is distinct from p_media->>'descriptorDigest' then
    raise exception 'SHOPEE_BUYER_CHAT_MEDIA_EVIDENCE_INVALID' using errcode='23514';
  end if;
  if p_page#>>'{messages,0,attachmentCount}' is distinct from '1'
     or p_page#>>'{messages,0,body}' is distinct from v_expected_body
     or (v_type='item' and p_page#>>'{messages,0,itemId}' is distinct from v_item_id)
     or (v_type<>'item' and p_page#>'{messages,0,itemId}' is distinct from 'null'::jsonb) then
    raise exception 'SHOPEE_BUYER_CHAT_MEDIA_PAGE_MISMATCH' using errcode='22023';
  end if;

  v_receipt:=public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(
    p_credential_id,p_shop_id,p_entitlement_id,p_evidence,p_page
  );
  select receipt.owner_id into v_owner_id
    from sellerpilot_private.cs_shopee_buyer_chat_push_receipts receipt
   where receipt.credential_id=p_credential_id and receipt.shop_id=p_shop_id
     and receipt.entitlement_id=p_entitlement_id
     and receipt.conversation_id=p_evidence->>'conversationId'
     and receipt.message_id=p_evidence->>'messageId';
  if not found then
    raise exception 'SHOPEE_BUYER_CHAT_MEDIA_RECEIPT_MISSING' using errcode='22023';
  end if;
  insert into sellerpilot_private.cs_shopee_buyer_chat_message_media(
    owner_id,credential_id,shop_id,conversation_id,message_id,media_type,
    image_url,video_reference,thumbnail_reference,thumbnail_width,thumbnail_height,
    file_server_id,duration_seconds,item_shop_id,item_id,source_item_id,descriptor_sha256
  ) values(
    v_owner_id,p_credential_id,p_shop_id,p_evidence->>'conversationId',
    p_evidence->>'messageId',v_type,v_image_url,v_video_reference,v_thumbnail_reference,
    v_thumbnail_width,v_thumbnail_height,v_file_server_id,v_duration_seconds,
    v_item_shop_id,v_item_id,v_source_item_id,v_descriptor
  ) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then
    select media.* into v_existing
      from sellerpilot_private.cs_shopee_buyer_chat_message_media media
     where media.owner_id=v_owner_id and media.credential_id=p_credential_id
       and media.shop_id=p_shop_id and media.conversation_id=p_evidence->>'conversationId'
       and media.message_id=p_evidence->>'messageId'
     for update;
    if v_existing.media_type is distinct from v_type
       or v_existing.image_url is distinct from v_image_url
       or v_existing.video_reference is distinct from v_video_reference
       or v_existing.thumbnail_reference is distinct from v_thumbnail_reference
       or v_existing.thumbnail_width is distinct from v_thumbnail_width
       or v_existing.thumbnail_height is distinct from v_thumbnail_height
       or v_existing.file_server_id is distinct from v_file_server_id
       or v_existing.duration_seconds is distinct from v_duration_seconds
       or v_existing.item_shop_id is distinct from v_item_shop_id
       or v_existing.item_id is distinct from v_item_id
       or v_existing.source_item_id is distinct from v_source_item_id
       or v_existing.descriptor_sha256 is distinct from v_descriptor then
      raise exception 'SHOPEE_BUYER_CHAT_MEDIA_REPLAY_CONFLICT' using errcode='23505';
    end if;
  end if;
  return v_receipt;
end $$;

create function public.sellerpilot_read_cs_shopee_buyer_chat_media_v1(
  p_scopes jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor_id uuid:=auth.uid();
  v_checked_at timestamptz:=clock_timestamp();
  v_scope jsonb;
  v_identity jsonb;
  v_credential_id uuid;
  v_shop_id text;
  v_key text;
  v_seen text[]:='{}'::text[];
  v_records jsonb:='[]'::jsonb;
begin
  if v_actor_id is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if jsonb_typeof(p_scopes) is distinct from 'array' or jsonb_array_length(p_scopes)>8 then
    raise exception 'SHOPEE_BUYER_CHAT_MEDIA_SCOPE_INVALID' using errcode='22023';
  end if;
  for v_scope in select value from jsonb_array_elements(p_scopes) loop
    if jsonb_typeof(v_scope) is distinct from 'object'
       or not (v_scope ?& array['credentialId','shopId','messages'])
       or v_scope-array['credentialId','shopId','messages']<>'{}'::jsonb
       or jsonb_typeof(v_scope->'credentialId') is distinct from 'string'
       or jsonb_typeof(v_scope->'shopId') is distinct from 'string'
       or coalesce(v_scope->>'shopId','') !~ '^[1-9][0-9]{0,31}$'
       or jsonb_typeof(v_scope->'messages') is distinct from 'array'
       or jsonb_array_length(v_scope->'messages')>100 then
      raise exception 'SHOPEE_BUYER_CHAT_MEDIA_SCOPE_INVALID' using errcode='22023';
    end if;
    begin v_credential_id:=(v_scope->>'credentialId')::uuid;
    exception when others then
      raise exception 'SHOPEE_BUYER_CHAT_MEDIA_SCOPE_INVALID' using errcode='22023';
    end;
    v_shop_id:=v_scope->>'shopId';
    for v_identity in select value from jsonb_array_elements(v_scope->'messages') loop
      if jsonb_typeof(v_identity) is distinct from 'object'
         or not (v_identity ?& array['conversationId','messageId'])
         or v_identity-array['conversationId','messageId']<>'{}'::jsonb
         or jsonb_typeof(v_identity->'conversationId') is distinct from 'string'
         or jsonb_typeof(v_identity->'messageId') is distinct from 'string'
         or coalesce(v_identity->>'conversationId','') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
         or coalesce(v_identity->>'messageId','') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$' then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_SCOPE_INVALID' using errcode='22023';
      end if;
      v_key:=v_credential_id::text||E'\n'||v_shop_id||E'\n'||
        (v_identity->>'conversationId')||E'\n'||(v_identity->>'messageId');
      if v_key=any(v_seen) then
        raise exception 'SHOPEE_BUYER_CHAT_MEDIA_SCOPE_INVALID' using errcode='22023';
      end if;
      v_seen:=array_append(v_seen,v_key);
    end loop;
    v_records:=v_records||coalesce((
      select jsonb_agg(jsonb_build_object(
        'credentialId',media.credential_id::text,'shopId',media.shop_id,
        'conversationId',media.conversation_id,'messageId',media.message_id,
        'media',case media.media_type
          when 'image' then jsonb_build_object(
            'type','image','imageUrl',media.image_url,
            'thumbnailReference',media.thumbnail_reference,
            'thumbnailWidth',media.thumbnail_width,'thumbnailHeight',media.thumbnail_height,
            'fileServerId',media.file_server_id)
          when 'video' then jsonb_build_object(
            'type','video','videoReference',media.video_reference,
            'thumbnailReference',media.thumbnail_reference,
            'thumbnailWidth',media.thumbnail_width,'thumbnailHeight',media.thumbnail_height,
            'durationSeconds',media.duration_seconds)
          else jsonb_build_object(
            'type','item','itemShopId',media.item_shop_id,'itemId',media.item_id,
            'sourceItemId',media.source_item_id)
        end
      ) order by media.conversation_id,media.message_id)
      from sellerpilot_private.cs_shopee_buyer_chat_message_media media
      join jsonb_array_elements(v_scope->'messages') requested on
        requested->>'conversationId'=media.conversation_id
        and requested->>'messageId'=media.message_id
     where media.credential_id=v_credential_id and media.shop_id=v_shop_id
    ),'[]'::jsonb);
  end loop;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-buyer-chat-media-read/1',
    'checkedAt',to_char(v_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'records',v_records
  );
end $$;

revoke all on function public.sellerpilot_service_read_shopee_chat_entitlement_v1(
  uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_read_shopee_chat_entitlement_v1(
  uuid,text,uuid
) to service_role;
revoke all on function public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1(text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_resolve_shopee_buyer_chat_push_v1(text)
  to service_role;
revoke all on function public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(
  uuid,text,uuid,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_shopee_buyer_chat_push_v1(
  uuid,text,uuid,jsonb,jsonb
) to service_role;
revoke all on function public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(
  uuid,text,uuid,jsonb,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_shopee_buyer_chat_media_v1(
  uuid,text,uuid,jsonb,jsonb,jsonb
) to service_role;
revoke all on function public.sellerpilot_read_cs_shopee_buyer_chat_media_v1(jsonb)
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_shopee_buyer_chat_media_v1(jsonb)
  to authenticated;


commit;
