begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
-- Live FROM_EBAY notices omit recipientUsername. Preserve null and retain member identity guards.
do $patch$
declare body text:=pg_get_functiondef('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'::regprocedure);
begin
 if md5(body)<>'121dc63723e6429d622f88de035fda7b' or array_length(string_to_array(body,$before$or coalesce(v_context->>'recipientUsername','')='' then$before$),1)<>2 then
  raise exception 'EBAY_RECIPIENT_PREIMAGE_DRIFT';end if;
 execute replace(body,$before$or coalesce(v_context->>'recipientUsername','')='' then$before$,$after$or (v_conversation_type='FROM_MEMBERS' and coalesce(v_context->>'recipientUsername','')='') then$after$);
end $patch$;
notify pgrst,'reload schema';
commit;
