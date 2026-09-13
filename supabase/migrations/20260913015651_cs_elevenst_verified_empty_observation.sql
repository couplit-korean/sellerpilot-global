-- Only the service writer can record this transport-verified empty response.
-- Preserve the provider's 500 code, parser evidence, and all prior observations.
begin;
do $empty_qna$
declare v_source text; v_definition text;
 v_old text := $old$       or coalesce(p_observation->>'resultCode','') not in ('','0','200','210')$old$;
 v_new text := $new$       or coalesce(p_observation->>'resultCode','') not in ('','0','200','210','500')
       or (p_observation->>'resultCode'='500' and v_provider_rows<>0)$new$;
begin
 select prosrc,pg_get_functiondef(oid) into v_source,v_definition from pg_proc
 where oid='public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)'::regprocedure;
 if md5(v_source)<>'366e644522065c8dab08f00e0f510874' then
   raise exception 'ELEVENST_EMPTY_OBSERVATION_PREIMAGE_MISMATCH';
 end if;
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
   raise exception 'ELEVENST_EMPTY_OBSERVATION_ANCHOR_MISMATCH';
 end if;
 execute replace(v_definition,v_old,v_new);
end;
$empty_qna$;
notify pgrst,'reload schema';
commit;
