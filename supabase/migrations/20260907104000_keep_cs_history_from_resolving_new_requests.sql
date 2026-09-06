-- A returned historical answer does not supersede the provider's current
-- unanswered state. Preserve ordinary events; opt-in snapshots are history only.
begin;
do $$
declare v_source text; v_definition text;
begin
 select p.prosrc,pg_get_functiondef(p.oid) into v_source,v_definition
 from pg_proc p where p.oid=to_regprocedure('public.sellerpilot_202609051400_ingest_inquiries(uuid,text,jsonb)')
  and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not has_function_privilege('service_role',p.oid,'EXECUTE');
 if v_source is null or encode(sha256(convert_to(v_source,'UTF8')),'hex')<>'e077db4075c02ac2d4801a2c21da9d496e3fce938c8b054d9f522ee5a12f469c'
  or (length(v_source)-length(replace(v_source,'if v_sender_role = ''seller'' then','')))/length('if v_sender_role = ''seller'' then')<>1 then
  raise exception 'CS_HISTORY_INGEST_PREIMAGE_REVIEW_REQUIRED';
 end if;
 v_definition:=replace(v_definition,'if v_sender_role = ''seller'' then',
  'if v_sender_role = ''seller'' and coalesce(v_inquiry#>>''{providerContext,historyOnly}'',''false'') <> ''true'' then');
 execute v_definition;
end $$;
notify pgrst,'reload schema';
commit;
