-- Product badges represent live remote listings only. Failed or draft rows stay
-- visible in the pipeline/error counters but must not be rendered as channels
-- where the product is currently published.

begin;

do $$
declare
  v_definition text;
  v_before text := 'where pl.product_id = p.id and pl.owner_id = v_user';
  v_after text := 'where pl.product_id = p.id and pl.owner_id = v_user and pl.status = ''published''';
begin
  select pg_get_functiondef('public.sellerpilot_get_operations_snapshot()'::regprocedure)
    into v_definition;

  if position(v_after in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception 'sellerpilot snapshot listing badge query not found';
  end if;

  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$$;

commit;
