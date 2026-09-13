-- The real products CHECK and publish-context API use active, never ready.
-- Keep every approval/source/credential/claim check; correct only the product
-- status predicate in the exact reviewed SmartStore functions and predecessors.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $align_state$
declare r record;v_oid oid;v_definition text;v_replaced text;v_count integer;
begin
for r in select * from (values
('public.sp_60910031000_smartstore_snapshot_before_category_source(uuid,uuid,uuid)','755bab31605193572c64420d97eb9157',1),
('public.sellerpilot_service_smartstore_create_category_collect_ctx(uuid,uuid,uuid)','f24aa1ba56e98c4e60587882babd4613',1),
('public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamp with time zone,uuid,integer,text,bigint,text,uuid,timestamp with time zone,jsonb,jsonb)','eb0cbb417964b49adbf5033fa336415d',1),
('public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)','95923d6d2d60bbc7a51d4efbf8d5602e',1),
('public.sellerpilot_service_stage_smartstore_create_transport(text,uuid,uuid,text,text,integer,text)','7fd86006a3936aefae774b88900f0b48',1),
('public.sellerpilot_complete_smartstore_listing_create(text,uuid,uuid,text,text,jsonb)','270ade852753314e5b5489fb4cb19db0',1),
('sellerpilot_private.sp_60910031000_smartstore_source_before_category(uuid,uuid)','edfb7e48c190637711f5c49c5c1d1f68',1),
('sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid)','182b6a7c475546dc212028bf72aec144',1)
) as targets(signature,source_md5,expected_count) loop
v_oid:=to_regprocedure(r.signature);
if v_oid is null or (select md5(prosrc) from pg_proc where oid=v_oid) is distinct from r.source_md5 then
  raise exception 'SMARTSTORE_PRODUCT_STATE_PREIMAGE_DRIFT:%',r.signature;
end if;
v_definition:=pg_get_functiondef(v_oid);
select count(*) into v_count from regexp_matches(v_definition,$pattern$((?:product|v_product)\.status\s*(?:=|<>|is distinct from)\s*)'ready'$pattern$,'g');
if v_count is distinct from r.expected_count then raise exception 'SMARTSTORE_PRODUCT_STATE_REPLACEMENT_DRIFT:%',r.signature;end if;
v_replaced:=regexp_replace(v_definition,$pattern$((?:product|v_product)\.status\s*(?:=|<>|is distinct from)\s*)'ready'$pattern$,$replacement$\1'active'$replacement$,'g');
execute v_replaced;
end loop;
end $align_state$;
notify pgrst,'reload schema';
commit;
