do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sellerpilot_11820_claim_gateway_unsafe';
  if v_def is null then
    raise exception 'claim function missing';
  end if;
  if strpos(v_def, '''seller_account_key'', c.seller_account_key') > 0 then
    raise notice 'already sends seller_account_key';
    return;
  end if;
  v_def := regexp_replace(
    v_def,
    '''credential'',\s*d\.decrypted_secret::jsonb\s*\)',
    '''credential'', d.decrypted_secret::jsonb, ''seller_account_key'', c.seller_account_key)',
    'g'
  );
  execute v_def;
end;
$patch$;
