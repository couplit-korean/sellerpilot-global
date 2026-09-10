-- Read-only production function definitions, no operational rows or secrets.
-- Captured to exercise the exact shared-workspace migration precondition.

CREATE OR REPLACE FUNCTION public.sellerpilot_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'sellerpilot_private'
AS $function$
  select exists (
    select 1 from sellerpilot_private.admin_users where user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.sellerpilot_get_operations_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_tickets jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_get_operations_snapshot_pre_reply_gateway_link();
  select coalesce(jsonb_agg(
    ticket_row.value || jsonb_build_object(
      'replyGatewayJobId',
      ticket.reply_gateway_job_id
    ) order by ticket_row.ordinality
  ), '[]'::jsonb)
    into v_tickets
    from jsonb_array_elements(coalesce(v_result->'tickets', '[]'::jsonb))
      with ordinality ticket_row(value, ordinality)
    join sellerpilot_private.support_tickets ticket
      on ticket.id::text = ticket_row.value->>'id';
  return jsonb_set(v_result, '{tickets}', v_tickets, true);
end;
$function$
;
