-- A newly prepared product legitimately stays draft while its approved detail,
-- owner, credential, confirmed category and execution lineage are verified.
-- Correct only the eight reviewed product-state predicates. No product state,
-- category source, approval, job, permit, credential or provider data is changed.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $draft_state$
declare r record;v_oid oid;source text;
begin
for r in select * from (values
($sig$sellerpilot_private.sp_60910031000_smartstore_source_before_category(uuid,uuid)$sig$,'1a8937602f2ee7c50add3176f8004639',$old$product.status = 'active'$old$,$new$product.status in ('draft','active')$new$),
($sig$sellerpilot_private.smartstore_category_source_current_json(uuid,uuid,uuid)$sig$,'6e9c3520e4842d3e57471d008718afc9',$old$product.status = 'active'$old$,$new$product.status in ('draft','active')$new$),
($sig$public.sellerpilot_service_smartstore_create_category_collect_ctx(uuid,uuid,uuid)$sig$,'83aaa112ba0616f0ed14b264e9bbc8c1',$old$product.status <> 'active'$old$,$new$not coalesce(product.status in ('draft','active'),false)$new$),
($sig$public.sellerpilot_service_smartstore_create_source_snapshot(uuid,uuid,uuid)$sig$,'cdd2b5efc398d42ea241f3cd505f2456',$old$product.status = 'active'$old$,$new$product.status in ('draft','active')$new$),
($sig$public.sellerpilot_service_stage_smartstore_create_transport(text,uuid,uuid,text,text,integer,text)$sig$,'74d9778b770a8aca20999068a7d05eea',$old$product.status is distinct from 'active'$old$,$new$not coalesce(product.status in ('draft','active'),false)$new$),
($sig$public.sellerpilot_complete_smartstore_listing_create(text,uuid,uuid,text,text,jsonb)$sig$,'db4aa1d861969067390789c3cc290400',$old$product.status is distinct from 'active'$old$,$new$not coalesce(product.status in ('draft','active'),false)$new$),
($sig$public.sp_60910031000_smartstore_snapshot_before_category_source(uuid,uuid,uuid)$sig$,'273437fe8569875cd2c40ecc1a58114e',$old$product.status = 'active'$old$,$new$product.status in ('draft','active')$new$),
($sig$public.sellerpilot_service_append_smartstore_create_category_source(uuid,uuid,timestamp with time zone,uuid,integer,text,bigint,text,uuid,timestamp with time zone,jsonb,jsonb)$sig$,'d70226e38d60efe415828c69b170bdec',$old$product.status <> 'active'$old$,$new$not coalesce(product.status in ('draft','active'),false)$new$)
) as targets(signature,source_md5,old_predicate,new_predicate) loop
 v_oid:=to_regprocedure(r.signature);
 if v_oid is null or (select md5(prosrc) from pg_proc where oid=v_oid) is distinct from r.source_md5
 then raise exception 'SMARTSTORE_DRAFT_STATE_PREIMAGE_DRIFT:%',r.signature;end if;
 source:=pg_get_functiondef(v_oid);
 if (length(source)-length(replace(source,r.old_predicate,'')))/length(r.old_predicate)<>1
 then raise exception 'SMARTSTORE_DRAFT_STATE_PREDICATE_DRIFT:%',r.signature;end if;
 execute replace(source,r.old_predicate,r.new_predicate);
end loop;
end $draft_state$;
notify pgrst,'reload schema';
commit;
