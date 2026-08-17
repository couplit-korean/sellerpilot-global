-- A remote stop is an operational pause, not deletion. Keep products editable
-- so a bad category or payload can be corrected and published again.

begin;

do $$
declare
  v_definition text;
  v_before text := 'then ''archived''';
  v_after text := 'then ''draft''';
begin
  select pg_get_functiondef('public.sellerpilot_service_complete_product_listing(uuid,uuid,text,boolean,text,text)'::regprocedure)
    into v_definition;
  if position(v_after in v_definition) > 0 then return; end if;
  if position(v_before in v_definition) = 0 then
    raise exception 'sellerpilot stopped product status branch not found';
  end if;
  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$$;

commit;
