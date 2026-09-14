-- Official SmartStore RANGE leaves may omit exactly one endpoint (e.g. <=50 kcal or >=1000 ml).
-- Retain finite numeric selection, interval order, available-endpoint units,
-- ID ownership, matching-count, required selection and all unknown-field guards.
-- Accept only the three observed optional annotation fields with explicit types.
-- No source, credential, assignment, job or provider mutation is performed.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

do $open_range$
declare source text;
begin
 select pg_get_functiondef(oid) into source from pg_proc where oid='sellerpilot_private.smartstore_category_source_range_contains(text,jsonb)'::regprocedure and md5(prosrc)='fea4f3ff88a002bc41e70dacbf1875d5';
 if source is null then raise exception 'SMARTSTORE_OPEN_RANGE_PREIMAGE_DRIFT:sellerpilot_private.smartstore_category_source_range_contains';end if;

 if (length(source)-length(replace(source,$old$     or coalesce(p_value->>'minAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'
     or coalesce(p_value->>'maxAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'$old$,'')))/length($old$     or coalesce(p_value->>'minAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'
     or coalesce(p_value->>'maxAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.smartstore_category_source_range_contains:1';end if;
 source:=replace(source,$old$     or coalesce(p_value->>'minAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'
     or coalesce(p_value->>'maxAttributeValue', '')
       !~ '^\d+(?:\.\d+)?$'$old$,$new$     or (p_value->>'minAttributeValue' is null and p_value->>'maxAttributeValue' is null)
     or (p_value->>'minAttributeValue' is not null and p_value->>'minAttributeValue' !~ '^\d+(?:\.\d+)?$')
     or (p_value->>'maxAttributeValue' is not null and p_value->>'maxAttributeValue' !~ '^\d+(?:\.\d+)?$')$new$);

 if (length(source)-length(replace(source,$old$if part::numeric < minimum or part::numeric > maximum then$old$,'')))/length($old$if part::numeric < minimum or part::numeric > maximum then$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.smartstore_category_source_range_contains:2';end if;
 source:=replace(source,$old$if part::numeric < minimum or part::numeric > maximum then$old$,$new$if (minimum is not null and part::numeric < minimum)
       or (maximum is not null and part::numeric > maximum) then$new$);

 execute source;
end $open_range$;

do $open_range$
declare source text;
begin
 select pg_get_functiondef(oid) into source from pg_proc where oid='sellerpilot_private.sp_60910035500_category_payload_before_documented_fields(text,jsonb,jsonb)'::regprocedure and md5(prosrc)='1eca4331278ab8a59f38f6b3329c928c';
 if source is null then raise exception 'SMARTSTORE_OPEN_RANGE_PREIMAGE_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields';end if;

 if (length(source)-length(replace(source,$old$       or pg_catalog.jsonb_typeof(
         value_row->'minAttributeValue'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(value_row->>'minAttributeValue'), '') is null$old$,'')))/length($old$       or pg_catalog.jsonb_typeof(
         value_row->'minAttributeValue'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(value_row->>'minAttributeValue'), '') is null$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:1';end if;
 source:=replace(source,$old$       or pg_catalog.jsonb_typeof(
         value_row->'minAttributeValue'
       ) is distinct from 'string'
       or nullif(pg_catalog.btrim(value_row->>'minAttributeValue'), '') is null$old$,$new$       -- A missing lower bound is documented only for RANGE values. Enumerated
       -- values still require their existing nonempty minimum/display value.
       or (value_row->>'minAttributeValue' is null and not exists (
         select 1 from jsonb_array_elements(p_official_readback->'attributes') a
          where a->>'attributeSeq'=attribute_seq and a->>'attributeClassificationType'='RANGE'))
       or (value_row->>'minAttributeValue' is not null and (
         pg_catalog.jsonb_typeof(value_row->'minAttributeValue') is distinct from 'string'
         or nullif(pg_catalog.btrim(value_row->>'minAttributeValue'), '') is null))$new$);

 if (length(source)-length(replace(source,$old$         coalesce(value_row->>'minAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or coalesce(value_row->>'maxAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'$old$,'')))/length($old$         coalesce(value_row->>'minAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or coalesce(value_row->>'maxAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:2';end if;
 source:=replace(source,$old$         coalesce(value_row->>'minAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'
         or coalesce(value_row->>'maxAttributeValue', '')
           !~ '^\d+(?:\.\d+)?$'$old$,$new$         (value_row->>'minAttributeValue' is null and value_row->>'maxAttributeValue' is null)
         or (value_row->>'minAttributeValue' is not null and value_row->>'minAttributeValue' !~ '^\d+(?:\.\d+)?$')
         or (value_row->>'maxAttributeValue' is not null and value_row->>'maxAttributeValue' !~ '^\d+(?:\.\d+)?$')$new$);

 if (length(source)-length(replace(source,$old$         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is null$old$,'')))/length($old$         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is null$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:3';end if;
 source:=replace(source,$old$         nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is null
         or nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is null$old$,$new$         (value_row->>'minAttributeValue' is not null and nullif(pg_catalog.btrim(
           value_row->>'minAttributeValueUnitCode'
         ), '') is null)
         or (value_row->>'maxAttributeValue' is not null and nullif(pg_catalog.btrim(
           value_row->>'maxAttributeValueUnitCode'
         ), '') is null)$new$);

 if (length(source)-length(replace(source,$old$       or (attribute_row ? 'mandatory'
         and pg_catalog.jsonb_typeof(attribute_row->'mandatory') <> 'boolean')$old$,'')))/length($old$       or (attribute_row ? 'mandatory'
         and pg_catalog.jsonb_typeof(attribute_row->'mandatory') <> 'boolean')$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:4';end if;
 source:=replace(source,$old$       or (attribute_row ? 'mandatory'
         and pg_catalog.jsonb_typeof(attribute_row->'mandatory') <> 'boolean')$old$,$new$       or (attribute_row ? 'mandatory'
         and pg_catalog.jsonb_typeof(attribute_row->'mandatory') <> 'boolean')
       or (attribute_row ? 'attributeTypeCodeName' and (
         jsonb_typeof(attribute_row->'attributeTypeCodeName') is distinct from 'string'
         or nullif(btrim(attribute_row->>'attributeTypeCodeName'),'') is null))
       or (attribute_row ? 'attributeClassificationCodeName' and (
         jsonb_typeof(attribute_row->'attributeClassificationCodeName') is distinct from 'string'
         or nullif(btrim(attribute_row->>'attributeClassificationCodeName'),'') is null))$new$);

 if (length(source)-length(replace(source,$old$'attributeValueMaxMatchingCount', 'required', 'mandatory'$old$,'')))/length($old$'attributeValueMaxMatchingCount', 'required', 'mandatory'$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:5';end if;
 source:=replace(source,$old$'attributeValueMaxMatchingCount', 'required', 'mandatory'$old$,$new$'attributeValueMaxMatchingCount', 'required', 'mandatory',
           'attributeTypeCodeName', 'attributeClassificationCodeName'$new$);

 if (length(source)-length(replace(source,$old$       or (value_row ? 'attributeValueName'$old$,'')))/length($old$       or (value_row ? 'attributeValueName'$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:6';end if;
 source:=replace(source,$old$       or (value_row ? 'attributeValueName'$old$,$new$       or (value_row ? 'exposureOrder' and (
         jsonb_typeof(value_row->'exposureOrder') is distinct from 'number'
         or coalesce(value_row->>'exposureOrder','') !~ '^\d+$'
         or (value_row->>'exposureOrder')::numeric>2147483647))
       or (value_row ? 'attributeValueName'$new$);

 if (length(source)-length(replace(source,$old$'attributeSeq', 'attributeValueSeq', 'attributeValueName',$old$,'')))/length($old$'attributeSeq', 'attributeValueSeq', 'attributeValueName',$old$)<>1 then
 raise exception 'SMARTSTORE_OPEN_RANGE_ANCHOR_DRIFT:sellerpilot_private.sp_60910035500_category_payload_before_documented_fields:7';end if;
 source:=replace(source,$old$'attributeSeq', 'attributeValueSeq', 'attributeValueName',$old$,$new$'attributeSeq', 'attributeValueSeq', 'attributeValueName', 'exposureOrder',$new$);

 execute source;
end $open_range$;

notify pgrst,'reload schema';
commit;
