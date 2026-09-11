-- 테무 CS 읽기는 잡의 credential_binding_context.sellerAccountKey 를 기대값으로
-- 쓰는데, 클레임 페이로드에 그 값이 실리지 않아 항상
-- TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED 로 실패했다.
-- 자격증명에 인증된 seller_account_key 를 클레임에 함께 내려보낸다.
do $patch$
declare
  v_def text;
  v_marker text := '''credential'', d.decrypted_secret::jsonb)';
  v_replacement text := '''credential'', d.decrypted_secret::jsonb, ''seller_account_key'', c.seller_account_key)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sellerpilot_private'
     and p.proname = 'claim_local_channel_executor_read_job';
  if v_def is null then
    raise exception 'read claim function missing';
  end if;
  if strpos(v_def, '''seller_account_key'', c.seller_account_key') > 0 then
    raise notice 'already delivers seller_account_key';
    return;
  end if;
  if strpos(v_def, v_marker) = 0 then
    raise exception 'claim payload marker missing';
  end if;
  execute replace(v_def, v_marker, v_replacement);
end;
$patch$;
