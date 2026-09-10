-- Restore the approved-administrator contract of the single shared operations
-- workspace (20260820143000). Creator IDs remain ledger provenance, not the
-- current operator's access boundary. No membership, credential or row is changed.
-- The historical "owned" RPC name is retained for the already deployed client.
begin;
do $$
declare
  v_signature text; v_hash text; v_old text; v_new text;
  v_source text; v_definition text;
begin
  if (select encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') from pg_proc p
      where p.oid=to_regprocedure('public.sellerpilot_is_admin()')
        and p.prosecdef and p.proowner='postgres'::regrole)
      is distinct from '46867f0998ac5b1d3f02f000c50c6c2303ea7b7a35e527801543889b65209de5'
     or (select encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') from pg_proc p
      where p.oid=to_regprocedure('public.sellerpilot_get_operations_snapshot()')
        and p.prosecdef and p.proowner='postgres'::regrole)
      is distinct from 'd4b9810f5764028913fa038af36b73def1c1ad562cbd8a625e0443b73e90eab9' then
    raise exception 'CS_SHARED_WORKSPACE_POLICY_REVIEW_REQUIRED';
  end if;

  for v_signature,v_hash,v_old,v_new in select * from (values
    ('public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)',
     '6bda888ceeca429fa278bfc36bad10cefacf9ac8a5d1798e96ce62dc849be8bc',
     'where t.id=p_ticket_id and t.owner_id=auth.uid() and not t.demo;',
     'where t.id=p_ticket_id and not t.demo;'),
    ('public.sellerpilot_search_cs_archive(text,text,text,date,date,integer,timestamptz,uuid,timestamptz)',
     '09f48a309be2e684d623dfae71e52b331bd9d662354f5a07e5f30bfd7913b725',
     'where t.owner_id=auth.uid() and not t.demo and t.updated_at<=v_as_of',
     'where not t.demo and t.updated_at<=v_as_of'),
    ('public.sellerpilot_list_owned_ebay_message_accounts()',
     '9d429ec8300d4b9d33823f067771b04c713d301bfe92ffc0a8563558c8c52492',
     'where c.created_by = auth.uid() and c.channel = ''ebay'' and c.status = ''active''',
     'where c.channel = ''ebay'' and c.status = ''active''')
  ) as changes(signature,hash,old_text,new_text)
  loop
    select p.prosrc,pg_get_functiondef(p.oid) into v_source,v_definition
      from pg_proc p
     where p.oid=to_regprocedure(v_signature)
       and p.prosecdef and p.proowner='postgres'::regrole
       and p.proconfig=array['search_path=""']::text[]
       and has_function_privilege('authenticated',p.oid,'EXECUTE')
       and not has_function_privilege('anon',p.oid,'EXECUTE')
       and not has_function_privilege('service_role',p.oid,'EXECUTE');
    if v_source is null or encode(sha256(convert_to(v_source,'UTF8')),'hex')<>v_hash
       or (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old)<>1 then
      raise exception 'CS_SHARED_READ_PREIMAGE_REVIEW_REQUIRED';
    end if;
    -- Keep exact ticket-owner-channel and outbound job bindings intact. Only
    -- the top-level creator filter changes; anonymous/nonmember checks remain.
    v_definition:=replace(v_definition,v_old,v_new);
    v_definition:=replace(v_definition,
      'auth.uid() is null or not public.sellerpilot_is_admin()',
      'auth.uid() is null or public.sellerpilot_is_admin() is distinct from true');
    execute v_definition;
  end loop;
end $$;
comment on function public.sellerpilot_list_owned_ebay_message_accounts() is
 'Compatibility name: active eBay accounts visible to approved administrators of the shared operations workspace; no credential secrets. Not a creator-only lookup.';
notify pgrst,'reload schema';
commit;
