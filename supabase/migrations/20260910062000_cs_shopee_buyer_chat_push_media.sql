-- Proposal only. Central owns production migration allocation and application.
-- Official field source verified 2026-09-10 KST:
-- https://open.shopee.com/push-mechanism/10
-- image: url, thumb_url, thumb_height, thumb_width, file_server_id
-- video: video_url, thumb_url, thumb_height, thumb_width, duration_seconds
-- item: content.shop_id, content.item_id and source_content.item_id
-- Provider references are retained without server-side download or URL synthesis.
begin;

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
