-- Reject changed stock effects behind an existing inventory idempotency key.
-- Source preimages: 20260903100000_inventory_ledger.sql, exact pg_proc.prosrc MD5.
-- Ambiguous ':' references, partial return references, and composite keys over
-- 240 characters are rejected before row locks/writes. Existing keys and rows
-- are never rewritten; historical ambiguous inputs fail closed even on retry.
-- Only reserve / return_received are changed. No stock backfill, order wiring,
-- ACL grant, table change or products mirror is performed by this migration.
-- A changed/missing/already-patched body or unsafe execution metadata aborts
-- the entire transaction. The release owner must compare live definitions first.
begin;

do $patch_reserve$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.sellerpilot_inventory_reserve(uuid,text,text,text,text,integer)');
  v_before pg_catalog.pg_proc%rowtype;
  v_after pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_body text;
  v_input_anchor constant text := $input_anchor$  select * into v_item
    from sellerpilot_private.inventory_items i$input_anchor$;
  v_input_guard constant text := $input_guard$  -- inventory reference preflight begin
  if p_quantity is null then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  if pg_catalog.strpos(coalesce(p_external_order_id, ''), ':') > 0
     or pg_catalog.strpos(coalesce(p_order_line_key, ''), ':') > 0
     or (v_order_key is not null and length(v_order_key) not between 8 and 240) then
    raise exception 'INVALID_ORDER_REFERENCE' using errcode = '22023';
  end if;
  -- inventory reference preflight end
$input_guard$;
  v_anchor constant text := $anchor$    v_replayed := true;$anchor$;
  v_replacement constant text := $replacement$    if exists (
      select 1 from sellerpilot_private.inventory_ledger l
       where l.item_id = v_item.id
         and l.event_type = 'SALE_PENDING'
         and l.idempotency_key = v_order_key
         and (l.quantity is distinct from p_quantity
           or l.order_key is distinct from v_order_key
           or l.channel_key is distinct from p_channel)
    ) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    v_replayed := true;$replacement$;
begin
  select * into v_before from pg_catalog.pg_proc where oid = v_oid;
  if v_oid is null
     or pg_catalog.md5(v_before.prosrc) is distinct from '99a6cf343eabafa12445c07055c3fd19'
     or not v_before.prosecdef
     or v_before.prolang <> (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
     or v_before.proconfig is distinct from array['search_path=""']::text[]
     or v_before.prorettype <> 'jsonb'::regtype
     or v_before.provolatile <> 'v'
     or v_before.proisstrict
     or v_before.proretset
     or v_before.pronargdefaults <> 0
     or pg_catalog.pg_get_function_arguments(v_oid) is distinct from
       'p_owner uuid, p_sku text, p_channel text, p_external_order_id text, p_order_line_key text, p_quantity integer'
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'inventory reserve preimage or execution contract mismatch' using errcode = '55000';
  end if;
  if (length(v_before.prosrc) - length(replace(v_before.prosrc, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'inventory reserve patch anchor mismatch' using errcode = '55000';
  end if;
  if (length(v_before.prosrc) - length(replace(v_before.prosrc, v_input_anchor, ''))) / length(v_input_anchor) <> 1 then
    raise exception 'inventory reserve input anchor mismatch' using errcode = '55000';
  end if;
  v_body := replace(v_before.prosrc, v_anchor, v_replacement);
  v_body := replace(v_body, v_input_anchor, v_input_guard || v_input_anchor);
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  execute replace(v_definition, v_before.prosrc, v_body);
  select * into v_after from pg_catalog.pg_proc where oid = v_oid;
  if v_after.prosrc is distinct from v_body
     or v_after.proacl is distinct from v_before.proacl
     or v_after.proowner is distinct from v_before.proowner
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proargdefaults is distinct from v_before.proargdefaults then
    raise exception 'inventory reserve patch postcondition mismatch' using errcode = '55000';
  end if;
end;
$patch_reserve$;

do $patch_return_received$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.sellerpilot_inventory_return_received(uuid,text,integer,text,text,text,text)');
  v_before pg_catalog.pg_proc%rowtype;
  v_after pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_body text;
  v_input_anchor constant text := $input_anchor$  select * into v_item
    from sellerpilot_private.inventory_items i$input_anchor$;
  v_input_guard constant text := $input_guard$  -- inventory reference preflight begin
  if p_quantity is null then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  if pg_catalog.num_nonnulls(p_channel, p_external_order_id, p_order_line_key) not in (0, 3) then
    raise exception 'INVALID_ORDER_REFERENCE' using errcode = '22023';
  end if;
  if pg_catalog.strpos(coalesce(p_external_order_id, ''), ':') > 0
     or pg_catalog.strpos(coalesce(p_order_line_key, ''), ':') > 0
     or (v_order_key is not null and length(v_order_key) not between 8 and 240) then
    raise exception 'INVALID_ORDER_REFERENCE' using errcode = '22023';
  end if;
  -- inventory reference preflight end
$input_guard$;
  v_anchor constant text := $anchor$    v_replayed := true;$anchor$;
  v_replacement constant text := $replacement$    if exists (
      select 1 from sellerpilot_private.inventory_ledger l
       where l.item_id = v_item.id
         and l.event_type = 'RETURN_RECEIVED'
         and l.idempotency_key = p_idempotency_key
         and (l.quantity is distinct from p_quantity
           or l.order_key is distinct from v_order_key
           or l.channel_key is distinct from p_channel)
    ) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    v_replayed := true;$replacement$;
begin
  select * into v_before from pg_catalog.pg_proc where oid = v_oid;
  if v_oid is null
     or pg_catalog.md5(v_before.prosrc) is distinct from '529ede0b37736f731b5b67f76d64c583'
     or not v_before.prosecdef
     or v_before.prolang <> (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
     or v_before.proconfig is distinct from array['search_path=""']::text[]
     or v_before.prorettype <> 'jsonb'::regtype
     or v_before.provolatile <> 'v'
     or v_before.proisstrict
     or v_before.proretset
     or v_before.pronargdefaults <> 3
     or pg_catalog.pg_get_function_arguments(v_oid) is distinct from
       'p_owner uuid, p_sku text, p_quantity integer, p_idempotency_key text, p_channel text DEFAULT NULL::text, p_external_order_id text DEFAULT NULL::text, p_order_line_key text DEFAULT NULL::text'
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'inventory return_received preimage or execution contract mismatch' using errcode = '55000';
  end if;
  if (length(v_before.prosrc) - length(replace(v_before.prosrc, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'inventory return_received patch anchor mismatch' using errcode = '55000';
  end if;
  if (length(v_before.prosrc) - length(replace(v_before.prosrc, v_input_anchor, ''))) / length(v_input_anchor) <> 1 then
    raise exception 'inventory return_received input anchor mismatch' using errcode = '55000';
  end if;
  v_body := replace(v_before.prosrc, v_anchor, v_replacement);
  v_body := replace(v_body, v_input_anchor, v_input_guard || v_input_anchor);
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  execute replace(v_definition, v_before.prosrc, v_body);
  select * into v_after from pg_catalog.pg_proc where oid = v_oid;
  if v_after.prosrc is distinct from v_body
     or v_after.proacl is distinct from v_before.proacl
     or v_after.proowner is distinct from v_before.proowner
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proargdefaults is distinct from v_before.proargdefaults then
    raise exception 'inventory return_received patch postcondition mismatch' using errcode = '55000';
  end if;
end;
$patch_return_received$;

commit;
