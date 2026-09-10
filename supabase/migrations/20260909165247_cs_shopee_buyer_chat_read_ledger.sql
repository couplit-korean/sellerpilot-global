-- Proposal only. Central must allocate the production migration version.
-- This does not name or call a Shopee SellerChat endpoint. It stores only a
-- centrally authorized, already-normalized read page after three independent
-- approval facts exist. Configured API keys are deliberately not evidence.
begin;

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
commit;
