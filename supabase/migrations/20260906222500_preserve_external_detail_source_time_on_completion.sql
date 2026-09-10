-- Preserve external-detail source time only in gateway completion bookkeeping.
-- Exact live preimages: 2026-09-06; no product/import rows or approval timestamps are rewritten.
-- Source/content edits outside these two status-only UPDATEs retain their existing invalidation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $source_time_0$
declare
  target regprocedure := pg_catalog.to_regprocedure('sellerpilot_private.apply_verified_remote_listing_completion(uuid,uuid,text,text,text,jsonb,text)');
  definition text; patched text; source_hash text; definition_hash text;
  old_statement constant text := $old$update sellerpilot_private.products product
     set status = case
           when exists (
             select 1
               from sellerpilot_private.product_listings live_listing
              where live_listing.product_id = product.id
                and live_listing.requested_publication_intent = 'live'
                and live_listing.remote_visibility = 'live'
                and live_listing.published_at is not null
           ) then 'active'
           when product.status = 'active' then 'draft'
           when p_prior_product_status = 'active' then 'draft'
           else product.status
         end,
         updated_at = clock_timestamp()
   where product.id = v_listing.product_id;$old$;
  new_statement constant text := $new$update sellerpilot_private.products product
     set status = case
           when exists (
             select 1
               from sellerpilot_private.product_listings live_listing
              where live_listing.product_id = product.id
                and live_listing.requested_publication_intent = 'live'
                and live_listing.remote_visibility = 'live'
                and live_listing.published_at is not null
           ) then 'active'
           when product.status = 'active' then 'draft'
           when p_prior_product_status = 'active' then 'draft'
           else product.status
         end,
         updated_at = case when product.external_detail_import_id is not null then product.updated_at else clock_timestamp() end
   where product.id = v_listing.product_id;$new$;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if target is null then raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_FUNCTION_MISSING'; end if;
  select pg_catalog.md5(prosrc), pg_catalog.pg_get_functiondef(oid)
    into source_hash, definition from pg_catalog.pg_proc where oid = target;
  definition_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(definition, 'UTF8')), 'hex');
  if source_hash = 'e60d369fd7622189e641096fce20d061' and definition_hash = '5b36361a5494e3cc04721979e7b89311afe6685f7fef71773dc1c83c7932800c' then return; end if;
  if source_hash is distinct from '00f2ed7e65763f98b46229a897e07837' or definition_hash is distinct from 'bf37f59a4c6e0fd8d56303ced950e0dbab9493c6bc07b8a3c6f0c7a8f6084034' then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_SOURCE_DRIFT';
  end if;
  if (length(definition) - length(pg_catalog.replace(definition, old_statement, ''))) / length(old_statement) <> 1 then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_TARGET_DRIFT';
  end if;
  patched := pg_catalog.replace(definition, old_statement, new_statement);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(patched, 'UTF8')), 'hex') <> '5b36361a5494e3cc04721979e7b89311afe6685f7fef71773dc1c83c7932800c' then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_PATCH_MISMATCH';
  end if;
  execute patched;
  select pg_catalog.md5(prosrc), pg_catalog.pg_get_functiondef(oid)
    into source_hash, definition from pg_catalog.pg_proc where oid = target;
  if source_hash is distinct from 'e60d369fd7622189e641096fce20d061'
     or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(definition, 'UTF8')), 'hex') <> '5b36361a5494e3cc04721979e7b89311afe6685f7fef71773dc1c83c7932800c' then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_READBACK_MISMATCH';
  end if;
end
$source_time_0$;

do $source_time_1$
declare
  target regprocedure := pg_catalog.to_regprocedure('public.sellerpilot_11820_complete_gateway_unsafe(text,uuid,uuid,text,jsonb,text)');
  definition text; patched text; source_hash text; definition_hash text;
  old_statement constant text := $old$update sellerpilot_private.products p
       set status = 'active', updated_at = now()
     where p.id = v_product_id;$old$;
  new_statement constant text := $new$update sellerpilot_private.products p
       set status = 'active', updated_at = case when p.external_detail_import_id is not null then p.updated_at else now() end
     where p.id = v_product_id;$new$;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if target is null then raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_FUNCTION_MISSING'; end if;
  select pg_catalog.md5(prosrc), pg_catalog.pg_get_functiondef(oid)
    into source_hash, definition from pg_catalog.pg_proc where oid = target;
  definition_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(definition, 'UTF8')), 'hex');
  if source_hash = 'd47a1c134a92061a6cfbc2c63698f868' and definition_hash = '85bd3deafa5c4153f924863d3dba4cf1cd52b6bd18ab01ada8acae7287411fe9' then return; end if;
  if source_hash is distinct from '19fa8a75c97d100498d60a4624071f53' or definition_hash is distinct from '5c9eb558f39121de23b082fe25eff0c62004905c8221b4a0fc53eb1384b1996c' then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_SOURCE_DRIFT';
  end if;
  if (length(definition) - length(pg_catalog.replace(definition, old_statement, ''))) / length(old_statement) <> 1 then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_TARGET_DRIFT';
  end if;
  patched := pg_catalog.replace(definition, old_statement, new_statement);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(patched, 'UTF8')), 'hex') <> '85bd3deafa5c4153f924863d3dba4cf1cd52b6bd18ab01ada8acae7287411fe9' then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_PATCH_MISMATCH';
  end if;
  execute patched;
  select pg_catalog.md5(prosrc), pg_catalog.pg_get_functiondef(oid)
    into source_hash, definition from pg_catalog.pg_proc where oid = target;
  if source_hash is distinct from 'd47a1c134a92061a6cfbc2c63698f868'
     or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(definition, 'UTF8')), 'hex') <> '85bd3deafa5c4153f924863d3dba4cf1cd52b6bd18ab01ada8acae7287411fe9' then
    raise exception 'EXTERNAL_DETAIL_SOURCE_TIME_READBACK_MISMATCH';
  end if;
end
$source_time_1$;

commit;
