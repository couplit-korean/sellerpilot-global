-- Enforce a 30-day post-purpose retention boundary for marketplace personal data.
-- Order totals and non-personal audit facts remain available after direct
-- identifiers and free-text support content are erased.

begin;

create or replace function public.sellerpilot_prune_personal_data(
  p_completed_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_orders integer := 0;
  v_tickets integer := 0;
  v_gateway_jobs integer := 0;
begin
  if p_completed_before > now() - interval '7 days' then
    raise exception 'retention window must be at least seven days';
  end if;

  update sellerpilot_private.commerce_orders o
     set customer_name = '[개인정보 삭제됨]',
         updated_at = now()
   where not o.demo
     and o.status in ('delivered', 'cancelled', 'refunded')
     and o.updated_at < p_completed_before
     and o.customer_name <> '[개인정보 삭제됨]';
  get diagnostics v_orders = row_count;

  update sellerpilot_private.support_tickets t
     set customer_name = '[개인정보 삭제됨]',
         message = '[개인정보 삭제됨]',
         translated_message = null,
         reply_draft = null,
         updated_at = now()
   where not t.demo
     and t.status = 'resolved'
     and t.updated_at < p_completed_before
     and (t.customer_name <> '[개인정보 삭제됨]' or t.message <> '[개인정보 삭제됨]');
  get diagnostics v_tickets = row_count;

  delete from sellerpilot_private.channel_gateway_jobs j
   where j.status in ('succeeded', 'failed', 'cancelled')
     and coalesce(j.completed_at, j.updated_at) < p_completed_before;
  get diagnostics v_gateway_jobs = row_count;

  insert into sellerpilot_private.operation_audit (action, entity_type, safe_detail)
  values ('personal_data_pruned', 'retention', jsonb_build_object(
    'orders_anonymized', v_orders,
    'tickets_anonymized', v_tickets,
    'gateway_jobs_deleted', v_gateway_jobs,
    'cutoff', p_completed_before
  ));

  return jsonb_build_object(
    'ordersAnonymized', v_orders,
    'ticketsAnonymized', v_tickets,
    'gatewayJobsDeleted', v_gateway_jobs
  );
end;
$$;

revoke all on function public.sellerpilot_prune_personal_data(timestamptz) from public, anon, authenticated;
grant execute on function public.sellerpilot_prune_personal_data(timestamptz) to service_role;

commit;
