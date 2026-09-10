-- Integration-owned forward migration proposal. Do not apply from the Coupang
-- worktree. Scope replyable Coupang ticket/message identities by the certified
-- vendor lineage while retaining the provider-native ID for reads and replies.
begin;

do $migration$
begin
  if to_regclass('sellerpilot_private.support_tickets') is null
     or to_regclass('sellerpilot_private.support_inbound_messages') is null
     or to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_get_ticket_reply_context_v2(uuid)') is null
     or to_regprocedure('public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)') is null then
    raise exception 'COUPANG_VENDOR_TICKET_IDENTITY_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('sellerpilot_private.coupang_ticket_external_id_v1(text,text)') is not null
     or to_regprocedure('public.sellerpilot_09195500_ingest_before_coupang_vendor_identity(uuid,text,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_09195500_get_ticket_reply_context_v2_unsafe(uuid)') is not null then
    raise exception 'COUPANG_VENDOR_TICKET_IDENTITY_ALREADY_EXISTS';
  end if;
end
$migration$;

create function sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path=''
as $$
  select p_value ~ '^(product|call-center):[1-9][0-9]{0,19}$'
$$;

create function sellerpilot_private.coupang_ticket_external_id_v1(
  p_seller_account_key text,
  p_provider_external_ticket_id text
)
returns text
language plpgsql
immutable
strict
set search_path=''
as $$
begin
  if p_seller_account_key !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(
       p_provider_external_ticket_id
     ) then
    raise exception 'COUPANG_TICKET_IDENTITY_INVALID';
  end if;
  return 'coupang:account:' || encode(extensions.digest(
    concat_ws(chr(31), 'coupang-ticket-v1', p_seller_account_key,
      p_provider_external_ticket_id), 'sha256'
  ), 'hex');
end
$$;

create function sellerpilot_private.coupang_ticket_inbound_key_v1(
  p_seller_account_key text,
  p_provider_inbound_key text
)
returns text
language plpgsql
immutable
strict
set search_path=''
as $$
begin
  if p_seller_account_key !~ '^[a-f0-9]{64}$'
     or nullif(trim(p_provider_inbound_key), '') is null then
    raise exception 'COUPANG_INBOUND_IDENTITY_INVALID';
  end if;
  return 'coupang:' || encode(extensions.digest(
    concat_ws(chr(31), 'coupang-inbound-v1', p_seller_account_key,
      trim(p_provider_inbound_key)), 'sha256'
  ), 'hex');
end
$$;

revoke all on function sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(text)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.coupang_ticket_external_id_v1(text,text)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.coupang_ticket_inbound_key_v1(text,text)
  from public,anon,authenticated,service_role;

-- Preserve the accepted Lazada and Elevenst account-scoped indexes while
-- excluding Coupang from the remaining channel-global active constraint.
do $$
declare v_definition text;
begin
  select indexdef into v_definition from pg_indexes
   where schemaname='sellerpilot_private'
     and indexname='channel_credentials_one_active_other_cs_idx';
  if v_definition is null
     or to_regclass('sellerpilot_private.channel_credentials_one_active_lazada_account_idx') is null
     or to_regclass('sellerpilot_private.channel_credentials_one_active_lazada_pending_owner_idx') is null
     or to_regclass('sellerpilot_private.channel_credentials_elevenst_active_account_idx') is null then
    raise exception 'COUPANG_MULTI_ACCOUNT_CURRENT_CENTRAL_INDEX_REQUIRED';
  end if;
  drop index sellerpilot_private.channel_credentials_one_active_other_cs_idx;
end $$;
create unique index channel_credentials_one_active_other_cs_idx
  on sellerpilot_private.channel_credentials(channel,environment)
  where status='active' and channel not in ('lazada','elevenst','smartstore','qoo10','coupang');
create unique index channel_credentials_one_active_coupang_vendor_idx
  on sellerpilot_private.channel_credentials(
    created_by,channel,environment,seller_account_key
  )
  where status='active' and channel='coupang'
    and seller_account_key is not null;

alter table sellerpilot_private.support_tickets
  add column if not exists provider_external_ticket_id text;

-- Bound legacy rows have enough certified lineage to migrate without guessing.
-- Unbound legacy rows keep their old storage ID, remain visible to administrators,
-- and stay non-replyable until a fresh credential-scoped ingest proves ownership.
create temporary table coupang_ticket_identity_backfill on commit drop as
select ticket.id as ticket_id,
       ticket.external_ticket_id as provider_external_ticket_id,
       sellerpilot_private.coupang_ticket_external_id_v1(
         ticket.seller_account_key, ticket.external_ticket_id
       ) as scoped_external_ticket_id,
       ticket.seller_account_key,
       ticket.latest_inbound_key as old_latest_inbound_key,
       case when ticket.latest_inbound_key is null then null else
         sellerpilot_private.coupang_ticket_inbound_key_v1(
           ticket.seller_account_key, ticket.latest_inbound_key
         ) end as new_latest_inbound_key
  from sellerpilot_private.support_tickets ticket
  join sellerpilot_private.channel_credentials credential
    on credential.id = ticket.source_credential_id
   and credential.created_by = ticket.owner_id
   and credential.channel = ticket.channel_key
   and credential.seller_account_key = ticket.seller_account_key
 where ticket.channel_key = 'coupang'
   and sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(
     ticket.external_ticket_id
   );

update sellerpilot_private.support_inbound_messages message
   set inbound_key = sellerpilot_private.coupang_ticket_inbound_key_v1(
         backfill.seller_account_key, message.inbound_key
       ),
       provider_context = message.provider_context || jsonb_build_object(
         'nativeExternalTicketId', backfill.provider_external_ticket_id
       ),
       updated_at = now()
  from coupang_ticket_identity_backfill backfill
 where message.ticket_id = backfill.ticket_id
   and message.owner_id = (
     select ticket.owner_id from sellerpilot_private.support_tickets ticket
      where ticket.id = backfill.ticket_id
   )
   and message.channel_key = 'coupang';

update sellerpilot_private.support_tickets ticket
   set provider_external_ticket_id = backfill.provider_external_ticket_id,
       external_ticket_id = backfill.scoped_external_ticket_id,
       latest_inbound_key = backfill.new_latest_inbound_key,
       provider_context = ticket.provider_context || jsonb_build_object(
         'nativeExternalTicketId', backfill.provider_external_ticket_id
       ),
       updated_at = now()
  from coupang_ticket_identity_backfill backfill
 where ticket.id = backfill.ticket_id;

update sellerpilot_private.support_tickets ticket
   set provider_external_ticket_id = ticket.external_ticket_id
 where ticket.channel_key = 'coupang'
   and ticket.provider_external_ticket_id is null
   and sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(
     ticket.external_ticket_id
   );

alter table sellerpilot_private.support_tickets
  drop constraint if exists support_tickets_coupang_vendor_identity_check;
alter table sellerpilot_private.support_tickets
  add constraint support_tickets_coupang_vendor_identity_check check (
    channel_key <> 'coupang'
    or provider_external_ticket_id is null
    or not sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(
      provider_external_ticket_id
    )
    or (
      source_credential_id is null
      and seller_account_key is null
      and external_ticket_id = provider_external_ticket_id
    )
    or (
      source_credential_id is not null
      and seller_account_key ~ '^[a-f0-9]{64}$'
      and external_ticket_id = sellerpilot_private.coupang_ticket_external_id_v1(
        seller_account_key, provider_external_ticket_id
      )
    )
  ) not valid;
alter table sellerpilot_private.support_tickets
  validate constraint support_tickets_coupang_vendor_identity_check;

create unique index support_tickets_coupang_vendor_provider_ticket_idx
  on sellerpilot_private.support_tickets(
    owner_id, seller_account_key, provider_external_ticket_id
  )
  where channel_key = 'coupang'
    and provider_external_ticket_id is not null
    and seller_account_key is not null;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_09195500_ingest_before_coupang_vendor_identity;

create function public.sellerpilot_service_ingest_inquiries(
  p_credential_id uuid,
  p_channel text,
  p_inquiries jsonb
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credential record;
  v_inquiry jsonb;
  v_sanitized jsonb := '[]'::jsonb;
  v_context jsonb;
  v_kind text;
  v_inquiry_id text;
  v_provider_external_ticket_id text;
  v_provider_inbound_key text;
  v_scoped_external_ticket_id text;
  v_count integer;
begin
  if p_channel <> 'coupang'
     or not exists (
       select 1 from jsonb_array_elements(
         case when jsonb_typeof(p_inquiries)='array' then p_inquiries else '[]'::jsonb end
       ) inquiry
       where inquiry#>>'{providerContext,kind}' in ('product','call-center')
     ) then
    return public.sellerpilot_09195500_ingest_before_coupang_vendor_identity(
      p_credential_id, p_channel, p_inquiries
    );
  end if;
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select credential.id, credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'coupang'
     and credential.status in ('active','grace')
   for update;
  if not found then raise exception 'active channel credential required'; end if;
  if v_credential.seller_account_key !~ '^[a-f0-9]{64}$'
     or v_credential.seller_account_key_source not in (
       'provider_certified_v1','credential_incarnation_v1'
     ) then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or jsonb_typeof(v_inquiry->'providerContext') is distinct from 'object' then
      raise exception 'COUPANG_TICKET_IDENTITY_INVALID';
    end if;
    v_context := v_inquiry->'providerContext';
    v_kind := coalesce(v_context->>'kind','');
    v_inquiry_id := coalesce(v_context->>'inquiryId','');
    v_provider_external_ticket_id := coalesce(v_inquiry->>'externalTicketId','');
    v_provider_inbound_key := coalesce(v_inquiry->>'inboundKey','');
    if v_kind not in ('product','call-center')
       or v_inquiry_id !~ '^[1-9][0-9]{0,19}$'
       or v_provider_external_ticket_id is distinct from v_kind || ':' || v_inquiry_id
       or coalesce(v_context->>'nativeExternalTicketId', v_provider_external_ticket_id)
          is distinct from v_provider_external_ticket_id
       or nullif(trim(v_provider_inbound_key),'') is null then
      raise exception 'COUPANG_TICKET_IDENTITY_INVALID';
    end if;
    v_scoped_external_ticket_id := sellerpilot_private.coupang_ticket_external_id_v1(
      v_credential.seller_account_key, v_provider_external_ticket_id
    );
    v_sanitized := v_sanitized || jsonb_build_array(
      jsonb_set(
        jsonb_set(
          jsonb_set(v_inquiry, '{externalTicketId}',
            to_jsonb(v_scoped_external_ticket_id), true),
          '{inboundKey}',
          to_jsonb(sellerpilot_private.coupang_ticket_inbound_key_v1(
            v_credential.seller_account_key, v_provider_inbound_key
          )), true
        ),
        '{providerContext}',
        v_context || jsonb_build_object(
          'nativeExternalTicketId', v_provider_external_ticket_id
        ), true
      )
    );
  end loop;

  v_count := public.sellerpilot_09195500_ingest_before_coupang_vendor_identity(
    p_credential_id, p_channel, v_sanitized
  );

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    v_provider_external_ticket_id := v_inquiry->>'externalTicketId';
    v_scoped_external_ticket_id := sellerpilot_private.coupang_ticket_external_id_v1(
      v_credential.seller_account_key, v_provider_external_ticket_id
    );
    update sellerpilot_private.support_tickets ticket
       set provider_external_ticket_id = v_provider_external_ticket_id,
           provider_context = ticket.provider_context || jsonb_build_object(
             'nativeExternalTicketId', v_provider_external_ticket_id
           ),
           updated_at = now()
     where ticket.owner_id = v_credential.created_by
       and ticket.channel_key = 'coupang'
       and ticket.external_ticket_id = v_scoped_external_ticket_id
       and ticket.source_credential_id = p_credential_id
       and ticket.seller_account_key = v_credential.seller_account_key
       and not ticket.demo;
    if not found then raise exception 'COUPANG_TICKET_IDENTITY_PERSIST_FAILED'; end if;
  end loop;
  return v_count;
end
$$;

revoke all on function public.sellerpilot_09195500_ingest_before_coupang_vendor_identity(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

create function public.sellerpilot_get_coupang_ticket_by_provider_identity_v1(
  p_credential_id uuid,
  p_provider_external_ticket_id text
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else (
    select jsonb_build_object(
      'id', ticket.id,
      'external_ticket_id', ticket.provider_external_ticket_id,
      'channel_key', ticket.channel_key,
      'source_credential_id', ticket.source_credential_id,
      'seller_account_key', ticket.seller_account_key,
      'latest_inbound_key', ticket.latest_inbound_key,
      'provider_context', ticket.provider_context
    )
      from sellerpilot_private.channel_credentials credential
      join sellerpilot_private.support_tickets ticket
        on ticket.owner_id = credential.created_by
       and ticket.channel_key = credential.channel
       and ticket.source_credential_id = credential.id
       and ticket.seller_account_key = credential.seller_account_key
       and ticket.provider_external_ticket_id = p_provider_external_ticket_id
       and ticket.external_ticket_id = sellerpilot_private.coupang_ticket_external_id_v1(
         credential.seller_account_key, ticket.provider_external_ticket_id
       )
     where credential.id = p_credential_id
       and credential.channel = 'coupang'
       and credential.status in ('active','grace')
       and credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
       and not ticket.demo
     limit 1
  ) end
$$;
revoke all on function public.sellerpilot_get_coupang_ticket_by_provider_identity_v1(uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_coupang_ticket_by_provider_identity_v1(uuid,text)
  to authenticated;

alter function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  rename to sellerpilot_09195500_get_ticket_reply_context_v2_unsafe;

create function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_ticket record;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  v_result := public.sellerpilot_09195500_get_ticket_reply_context_v2_unsafe(p_id);
  if v_result is null or v_result->>'channel_key' <> 'coupang' then return v_result; end if;
  select ticket.provider_external_ticket_id, ticket.external_ticket_id,
         ticket.owner_id, ticket.source_credential_id, ticket.seller_account_key,
         credential.id as credential_id
    into v_ticket
    from sellerpilot_private.support_tickets ticket
    join sellerpilot_private.channel_credentials credential
      on credential.id = ticket.source_credential_id
     and credential.created_by = ticket.owner_id
     and credential.channel = ticket.channel_key
     and credential.seller_account_key = ticket.seller_account_key
     and credential.status in ('active','grace')
   where ticket.id = p_id and not ticket.demo;
  if not found then return null; end if;
  if sellerpilot_private.coupang_provider_ticket_id_is_valid_v1(
       v_ticket.provider_external_ticket_id
     ) then
    if v_ticket.external_ticket_id is distinct from
       sellerpilot_private.coupang_ticket_external_id_v1(
         v_ticket.seller_account_key, v_ticket.provider_external_ticket_id
       ) then return null; end if;
    return jsonb_set(v_result, '{external_ticket_id}',
      to_jsonb(v_ticket.provider_external_ticket_id), true);
  end if;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_09195500_get_ticket_reply_context_v2_unsafe(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  to authenticated;

-- CONT-07 product reply readback is already installed in current central. Its
-- source trigger must compare the provider-native ID after the storage ID is
-- account scoped; continuation children remain bound by the immutable ticket.
do $product_readback_compat$
declare
  v_definition text;
  v_before constant text :=
    'and external_ticket_id=''product:''||v_inquiry_id and not demo for update';
  v_after constant text :=
    'and coalesce(provider_external_ticket_id,external_ticket_id)=''product:''||v_inquiry_id and not demo for update';
begin
  if to_regprocedure(
    'sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()'
  ) is null then
    raise exception 'COUPANG_PRODUCT_READBACK_CURRENT_CENTRAL_REQUIRED';
  end if;
  v_definition := pg_get_functiondef(
    'sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()'::regprocedure
  );
  if strpos(v_definition,v_before)=0 or strpos(v_definition,v_after)>0 then
    raise exception 'COUPANG_PRODUCT_READBACK_NATIVE_ID_PREIMAGE_MISMATCH';
  end if;
  execute replace(v_definition,v_before,v_after);
end
$product_readback_compat$;

-- The canonical reply-observation ledger receives provider-native ticket IDs
-- from normalized readback evidence. Match those against the explicit native
-- column after Coupang storage identity becomes account scoped.
do $reply_observation_compat$
declare
  v_definition text;
  v_before constant text :=
    'and (ticket.external_ticket_id=v_observation->>''externalTicketId''';
  v_after constant text :=
    'and (coalesce(ticket.provider_external_ticket_id,ticket.external_ticket_id)=v_observation->>''externalTicketId''';
begin
  v_definition := pg_get_functiondef(
    'public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)'::regprocedure
  );
  if strpos(v_definition,v_before)=0 or strpos(v_definition,v_after)>0 then
    raise exception 'COUPANG_REPLY_OBSERVATION_NATIVE_ID_PREIMAGE_MISMATCH';
  end if;
  execute replace(v_definition,v_before,v_after);
end
$reply_observation_compat$;

notify pgrst,'reload schema';
commit;
