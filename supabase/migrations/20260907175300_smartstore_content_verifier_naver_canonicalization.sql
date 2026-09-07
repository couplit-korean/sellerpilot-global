-- Naver SmartStore preserves approved detail text and structure while replacing
-- SellerPilot's own data attributes as exact filter comments placed before the
-- affected tags, and decodes two named entities. Remove only those paired forms.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993,907175300);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_html_image_urls(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_repair_detail_html_matches(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'
     ) is null then
    raise exception 'SMARTSTORE_CONTENT_VERIFIER_DEPENDENCY_MISSING'
      using errcode='55000';
  end if;
end;
$dependencies$;

create or replace function sellerpilot_private.smartstore_naver_detail_html_canonical(
  p_html text,p_remote boolean
)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  canonical text := p_html;
  image_role text;
begin
  if coalesce(p_html,'')='' or p_remote is null
     or position('__SELLERPILOT_DETAIL_IMAGE_' in p_html)>0 then
    return null;
  end if;

  if p_remote then
    canonical := pg_catalog.replace(canonical,
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14") --><div',
      '<div');
    foreach image_role in array array[
      'detail-overview','detail-use','detail-contents','detail-routine',
      'detail-material','detail-feature','detail-storage','detail-package'
    ] loop
      canonical := pg_catalog.replace(canonical,
        '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="'||image_role||'") --><section',
        '<section');
    end loop;
    canonical := pg_catalog.replace(
      canonical,
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="story") --><section',
      '<section'
    );
    canonical := pg_catalog.replace(
      canonical,
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-evidence="true") --><p',
      '<p'
    );
  else
    canonical := pg_catalog.replace(canonical,
      '<div data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14"',
      '<div');
    foreach image_role in array array[
      'detail-overview','detail-use','detail-contents','detail-routine',
      'detail-material','detail-feature','detail-storage','detail-package'
    ] loop
      canonical := pg_catalog.replace(canonical,
        '<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="'||image_role||'"',
        '<section');
    end loop;
    canonical := pg_catalog.replace(canonical,
      '<section data-sellerpilot-puck-block="story"','<section');
    canonical := pg_catalog.replace(canonical,
      '<p data-sellerpilot-puck-evidence="true"','<p');
  end if;

  if pg_catalog.strpos(canonical,'<!-- Not Allowed Attribute Filtered')>0
     or pg_catalog.strpos(pg_catalog.lower(canonical),'data-sellerpilot-')>0 then
    return null;
  end if;
  canonical := pg_catalog.regexp_replace(canonical,'&times;','×','gi');
  canonical := pg_catalog.regexp_replace(canonical,'&middot;','·','gi');
  return canonical;
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_naver_detail_html_canonical(text,boolean)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.smartstore_repair_detail_html_matches(
  p_source_html text,p_remote_html text
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  source_html text;
  remote_html text;
  token text;
  image_index integer;
begin
  if jsonb_array_length(sellerpilot_private.smartstore_repair_html_image_urls(p_source_html))<>8
     or jsonb_array_length(sellerpilot_private.smartstore_repair_html_image_urls(p_remote_html))<>8
     or (select count(*) from pg_catalog.regexp_matches(p_source_html,'<img([[:space:]]|>)','gi'))<>8
     or (select count(*) from pg_catalog.regexp_matches(p_remote_html,'<img([[:space:]]|>)','gi'))<>8
  then return false; end if;

  source_html := sellerpilot_private.smartstore_naver_detail_html_canonical(
    p_source_html,false
  );
  remote_html := sellerpilot_private.smartstore_naver_detail_html_canonical(
    p_remote_html,true
  );
  if source_html is null or remote_html is null then return false; end if;

  for image_index in 0..7 loop
    token := '__SELLERPILOT_DETAIL_IMAGE_'||(image_index+1)::text||'__';
    source_html := pg_catalog.regexp_replace(
      source_html,'(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1'||token||E'\\2','i'
    );
    remote_html := pg_catalog.regexp_replace(
      remote_html,'(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1'||token||E'\\2','i'
    );
  end loop;
  return source_html is not distinct from remote_html;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_repair_detail_html_matches(text,text)
  from public, anon, authenticated, service_role;

do $patch_manual_adoption_content_verifier$
declare
  definition text;
  name_before constant text := $before$     or coalesce(expected_channel_name,'') = ''
     or expected_channel_name is distinct from expected_origin_name
     or channel_name is distinct from expected_channel_name$before$;
  name_after constant text := $after$     or coalesce(expected_channel_name,'') = ''
     or channel_name is distinct from expected_channel_name$after$;
  html_before constant text := $before$  normalized_source_detail_html := source_detail_html;
  normalized_remote_detail_html := detail_html;
  for image_index in 0..7 loop
    image_token := '__SELLERPILOT_DETAIL_IMAGE_' || (image_index + 1)::text || '__';
    if position(image_token in normalized_source_detail_html) > 0
       or position(image_token in normalized_remote_detail_html) > 0 then
      raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_TOKEN_COLLISION';
    end if;
    normalized_source_detail_html := regexp_replace(
      normalized_source_detail_html,
      '(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1' || image_token || E'\\2',
      'i'
    );
    normalized_remote_detail_html := regexp_replace(
      normalized_remote_detail_html,
      '(<img[^>]*[[:space:]]src=["''])https://[^"'']+(["''])',
      E'\\1' || image_token || E'\\2',
      'i'
    );
  end loop;
  if normalized_remote_detail_html is distinct from normalized_source_detail_html then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH';
  end if;$before$;
  html_after constant text := $after$  if sellerpilot_private.smartstore_repair_detail_html_matches(
       source_detail_html,detail_html
     ) is not true then
    raise exception 'SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH';
  end if;$after$;
  name_hits integer;
  html_hits integer;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
  );
  select (
    pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,name_before,''))
  )/pg_catalog.length(name_before) into name_hits;
  select (
    pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,html_before,''))
  )/pg_catalog.length(html_before) into html_hits;
  if name_hits<>1 or html_hits<>1
     or pg_catalog.strpos(definition,'smartstore_naver_detail_html_canonical')>0 then
    raise exception 'SMARTSTORE_CONTENT_VERIFIER_PREIMAGE_DRIFT';
  end if;
  definition := pg_catalog.replace(definition,name_before,name_after);
  definition := pg_catalog.replace(definition,html_before,html_after);
  execute definition;

  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'::regprocedure
  );
  if pg_catalog.strpos(definition,'expected_channel_name is distinct from expected_origin_name')>0
     or pg_catalog.strpos(definition,'smartstore_repair_detail_html_matches')=0
     or pg_catalog.strpos(definition,name_after)=0
     or pg_catalog.strpos(definition,html_before)>0 then
    raise exception 'SMARTSTORE_CONTENT_VERIFIER_POSTIMAGE_DRIFT';
  end if;
end;
$patch_manual_adoption_content_verifier$;

do $postcondition$
declare
  canonical_acl text;
  matcher_acl text;
begin
  select coalesce(array_to_string(proacl,','),'') into canonical_acl
  from pg_catalog.pg_proc
  where oid='sellerpilot_private.smartstore_naver_detail_html_canonical(text,boolean)'::regprocedure;
  select coalesce(array_to_string(proacl,','),'') into matcher_acl
  from pg_catalog.pg_proc
  where oid='sellerpilot_private.smartstore_repair_detail_html_matches(text,text)'::regprocedure;
  if canonical_acl~'(anon|authenticated|service_role)='
     or matcher_acl~'(anon|authenticated|service_role)=' then
    raise exception 'SMARTSTORE_CONTENT_VERIFIER_PRIVATE_ACL_INVALID';
  end if;
end;
$postcondition$;

comment on function
  sellerpilot_private.smartstore_naver_detail_html_canonical(text,boolean)
  is 'Removes only the exact SellerPilot attributes inside approved source tags and the exact Naver filtered-attribute comments immediately before their matching tags; preserves every other byte except two observed named entities.';

notify pgrst, 'reload schema';

commit;
