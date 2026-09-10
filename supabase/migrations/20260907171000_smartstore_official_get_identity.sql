-- Align the verified SmartStore adoption commit with the current official v2
-- GET response schemas. Product numbers are established by one complete
-- SELLER_CODE search result and the exact GET paths. The GET bodies do not
-- promise number echoes, so absent echoes are accepted while any supplied
-- echo must match. Both GETs must still describe the same live product.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907171000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'
     ) is null then
    raise exception 'SMARTSTORE_OFFICIAL_GET_IDENTITY_COMMIT_MISSING'
      using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_manual_adoption_official_identity(jsonb,text)'
     ) is not null then
    raise exception 'SMARTSTORE_OFFICIAL_GET_IDENTITY_HELPER_ALREADY_EXISTS'
      using errcode = '55000';
  end if;
end;
$dependencies$;

create function sellerpilot_private.smartstore_manual_adoption_official_identity(
  p_readback jsonb,
  p_seller_sku text
)
returns table(origin_product_no text, channel_product_no text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  search_response jsonb := p_readback#>'{searchReadback,response}';
  origin_response jsonb := p_readback#>'{originReadback,response}';
  channel_response jsonb := p_readback#>'{channelReadback,response}';
  origin_product jsonb := p_readback#>'{originReadback,response,originProduct}';
  embedded_channel jsonb := p_readback#>'{originReadback,response,smartstoreChannelProduct}';
  channel_origin_product jsonb := p_readback#>'{channelReadback,response,originProduct}';
  channel_product jsonb := p_readback#>'{channelReadback,response,smartstoreChannelProduct}';
  matched_entry jsonb;
  matched_channel jsonb;
  resolved_origin_no text;
  resolved_channel_no text;
  match_count integer;
  origin_optional_image_urls jsonb;
  channel_optional_image_urls jsonb;
begin
  if coalesce(trim(p_seller_sku),'') = ''
     or jsonb_typeof(search_response) is distinct from 'object'
     or jsonb_typeof(search_response->'contents') is distinct from 'array'
     or jsonb_typeof(search_response->'page') is distinct from 'number'
     or jsonb_typeof(search_response->'size') is distinct from 'number'
     or jsonb_typeof(search_response->'totalElements') is distinct from 'number'
     or jsonb_typeof(search_response->'totalPages') is distinct from 'number'
     or jsonb_typeof(search_response->'first') is distinct from 'boolean'
     or jsonb_typeof(search_response->'last') is distinct from 'boolean' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INVALID';
  end if;
  if (search_response->>'page')::integer <> 1
     or (search_response->>'size')::integer <> 50
     or (search_response->>'totalElements')::integer
       <> jsonb_array_length(search_response->'contents')
     or (search_response->>'totalPages')::integer <> 1
     or search_response->'first' is distinct from 'true'::jsonb
     or search_response->'last' is distinct from 'true'::jsonb then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INCOMPLETE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(search_response->'contents') entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
       or jsonb_typeof(entry.value->'channelProducts') is distinct from 'array'
  ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INVALID';
  end if;

  select count(*)::integer into match_count
  from jsonb_array_elements(search_response->'contents') entry(value)
  cross join lateral jsonb_array_elements(entry.value->'channelProducts') channel(value)
  where channel.value->>'sellerManagementCode' = p_seller_sku;
  if match_count <> 1 then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS';
  end if;
  select entry.value,channel.value into matched_entry,matched_channel
  from jsonb_array_elements(search_response->'contents') entry(value)
  cross join lateral jsonb_array_elements(entry.value->'channelProducts') channel(value)
  where channel.value->>'sellerManagementCode' = p_seller_sku;

  resolved_origin_no := trim(coalesce(matched_entry->>'originProductNo',''));
  resolved_channel_no := trim(coalesce(
    matched_channel->>'channelProductNo',''
  ));
  if resolved_origin_no !~ '^[1-9][0-9]{5,19}$'
     or resolved_channel_no !~ '^[1-9][0-9]{5,19}$'
     or (
       matched_channel ? 'channelProductNo'
       and trim(coalesce(matched_channel->>'channelProductNo',''))
         is distinct from resolved_channel_no
     )
     or (
       matched_channel ? 'smartstoreChannelProductNo'
       and trim(coalesce(matched_channel->>'smartstoreChannelProductNo',''))
         is distinct from resolved_channel_no
     )
     or (
       matched_channel ? 'originProductNo'
       and trim(coalesce(matched_channel->>'originProductNo',''))
         is distinct from resolved_origin_no
     ) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS';
  end if;

  if jsonb_typeof(origin_product) is distinct from 'object'
     or jsonb_typeof(channel_origin_product) is distinct from 'object'
     or jsonb_typeof(channel_product) is distinct from 'object'
     or p_readback#>>'{originReadback,path}'
       is distinct from '/v2/products/origin-products/' || resolved_origin_no
     or p_readback#>>'{channelReadback,path}'
       is distinct from '/v2/products/channel-products/' || resolved_channel_no
     or origin_product#>>'{detailAttribute,sellerCodeInfo,sellerManagementCode}'
       is distinct from p_seller_sku
     or channel_origin_product#>>'{detailAttribute,sellerCodeInfo,sellerManagementCode}'
       is distinct from p_seller_sku
     or origin_product->>'statusType' is distinct from 'SALE'
     or channel_origin_product->>'statusType' is distinct from 'SALE'
     or channel_product->>'channelProductDisplayStatusType' is distinct from 'ON' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID';
  end if;

  -- Official response schemas omit these IDs. When an implementation adds an
  -- echo, reject null, empty, malformed, or cross-product values instead of
  -- allowing a lower-priority coalesce value to hide the disagreement.
  if (origin_response ? 'originProductNo'
        and trim(coalesce(origin_response->>'originProductNo',''))
          is distinct from resolved_origin_no)
     or (origin_product ? 'originProductNo'
        and trim(coalesce(origin_product->>'originProductNo',''))
          is distinct from resolved_origin_no)
     or (origin_response ? 'smartstoreChannelProductNo'
        and trim(coalesce(origin_response->>'smartstoreChannelProductNo',''))
          is distinct from resolved_channel_no)
     or (origin_response ? 'channelProductNo'
        and trim(coalesce(origin_response->>'channelProductNo',''))
          is distinct from resolved_channel_no)
     or (coalesce(embedded_channel ? 'channelProductNo',false)
        and trim(coalesce(embedded_channel->>'channelProductNo',''))
          is distinct from resolved_channel_no)
     or (coalesce(embedded_channel ? 'smartstoreChannelProductNo',false)
        and trim(coalesce(embedded_channel->>'smartstoreChannelProductNo',''))
          is distinct from resolved_channel_no)
     or (coalesce(embedded_channel ? 'originProductNo',false)
        and trim(coalesce(embedded_channel->>'originProductNo',''))
          is distinct from resolved_origin_no)
     or (channel_response ? 'smartstoreChannelProductNo'
        and trim(coalesce(channel_response->>'smartstoreChannelProductNo',''))
          is distinct from resolved_channel_no)
     or (channel_response ? 'channelProductNo'
        and trim(coalesce(channel_response->>'channelProductNo',''))
          is distinct from resolved_channel_no)
     or (channel_product ? 'channelProductNo'
        and trim(coalesce(channel_product->>'channelProductNo',''))
          is distinct from resolved_channel_no)
     or (channel_product ? 'smartstoreChannelProductNo'
        and trim(coalesce(channel_product->>'smartstoreChannelProductNo',''))
          is distinct from resolved_channel_no)
     or (channel_response ? 'originProductNo'
        and trim(coalesce(channel_response->>'originProductNo',''))
          is distinct from resolved_origin_no)
     or (channel_origin_product ? 'originProductNo'
        and trim(coalesce(channel_origin_product->>'originProductNo',''))
          is distinct from resolved_origin_no)
     or (channel_product ? 'originProductNo'
        and trim(coalesce(channel_product->>'originProductNo',''))
          is distinct from resolved_origin_no) then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID';
  end if;

  if channel_origin_product->'name' is distinct from origin_product->'name'
     or channel_origin_product->'salePrice' is distinct from origin_product->'salePrice'
     or channel_origin_product->'stockQuantity' is distinct from origin_product->'stockQuantity'
     or channel_origin_product->'detailContent' is distinct from origin_product->'detailContent'
     or coalesce(origin_product#>>'{images,representativeImage,url}','') = ''
     or channel_origin_product#>>'{images,representativeImage,url}'
       is distinct from origin_product#>>'{images,representativeImage,url}'
     or jsonb_typeof(origin_product#>'{images,optionalImages}') is distinct from 'array'
     or jsonb_typeof(channel_origin_product#>'{images,optionalImages}') is distinct from 'array' then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH';
  end if;
  select coalesce(jsonb_agg(image.value->'url' order by image.ordinal),'[]'::jsonb)
  into origin_optional_image_urls
  from jsonb_array_elements(origin_product#>'{images,optionalImages}')
    with ordinality image(value,ordinal);
  select coalesce(jsonb_agg(image.value->'url' order by image.ordinal),'[]'::jsonb)
  into channel_optional_image_urls
  from jsonb_array_elements(channel_origin_product#>'{images,optionalImages}')
    with ordinality image(value,ordinal);
  if channel_optional_image_urls is distinct from origin_optional_image_urls then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH';
  end if;

  return query select resolved_origin_no,resolved_channel_no;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_official_identity(jsonb,text)
  from public, anon, authenticated, service_role;

do $patch_commit$
declare
  definition text;
  old_fragment constant text := $old$
  origin_no := trim(coalesce(origin_response->>'originProductNo',origin_product->>'originProductNo',''));
  channel_no := trim(coalesce(
    origin_response->>'smartstoreChannelProductNo',embedded_channel->>'channelProductNo',''
  ));
  if origin_no !~ '^[0-9]+$' or channel_no !~ '^[0-9]+$'
     or p_readback#>>'{originReadback,path}'
       is distinct from '/v2/products/origin-products/' || origin_no
     or p_readback#>>'{channelReadback,path}'
       is distinct from '/v2/products/channel-products/' || channel_no
     or coalesce(channel_product->>'channelProductNo',channel_product->>'smartstoreChannelProductNo')
       is distinct from channel_no
     or coalesce(channel_product->>'originProductNo',channel_response->>'originProductNo')
       is distinct from origin_no
     or origin_product->>'statusType' <> 'SALE'
     or channel_product->>'channelProductDisplayStatusType' <> 'ON'
     or origin_product#>>'{detailAttribute,sellerCodeInfo,sellerManagementCode}'
       is distinct from seller_sku then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID';
  end if;
$old$;
  new_fragment constant text := $new$
  select identity.origin_product_no,identity.channel_product_no
  into origin_no,channel_no
  from sellerpilot_private.smartstore_manual_adoption_official_identity(
    p_readback,seller_sku
  ) identity;
$new$;
  old_hits integer;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
  );
  select (
    pg_catalog.length(definition)
      - pg_catalog.length(pg_catalog.replace(definition,old_fragment,''))
  ) / pg_catalog.length(old_fragment) into old_hits;
  if old_hits <> 1
     or pg_catalog.strpos(
       definition,'smartstore_manual_adoption_official_identity'
     ) <> 0 then
    raise exception 'SMARTSTORE_OFFICIAL_GET_IDENTITY_PREIMAGE_DRIFT';
  end if;
  definition := pg_catalog.replace(definition,old_fragment,new_fragment);
  execute definition;

  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
  );
  if pg_catalog.strpos(
       definition,'smartstore_manual_adoption_official_identity'
     ) = 0
     or pg_catalog.strpos(definition,old_fragment) <> 0
     or pg_catalog.strpos(definition,'SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH') = 0
     or pg_catalog.strpos(definition,'SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID') = 0 then
    raise exception 'SMARTSTORE_OFFICIAL_GET_IDENTITY_POSTIMAGE_DRIFT';
  end if;
end;
$patch_commit$;

comment on function
  sellerpilot_private.smartstore_manual_adoption_official_identity(jsonb,text)
  is 'Resolves the exact SmartStore product-number pair from one complete SELLER_CODE result, binds exact official GET paths, accepts absent undocumented GET ID echoes, rejects conflicting supplied echoes, and cross-checks both GET product bodies.';

notify pgrst, 'reload schema';

commit;
