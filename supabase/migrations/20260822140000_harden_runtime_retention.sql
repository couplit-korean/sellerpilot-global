-- Keep terminal channel history by completion time, and make the daily cleanup
-- use a small partial index instead of scanning the active queue.

begin;

create index if not exists channel_gateway_jobs_terminal_completed_idx
  on sellerpilot_private.channel_gateway_jobs (completed_at)
  where status in ('succeeded', 'failed', 'cancelled') and completed_at is not null;

create or replace function public.sellerpilot_service_prune_runtime_noise(
  p_completed_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_gateway_jobs integer := 0;
  v_noop_audits integer := 0;
  v_orphan_product_audits integer := 0;
begin
  if p_completed_before > now() - interval '24 hours' then
    raise exception 'runtime retention window must be at least 24 hours';
  end if;

  delete from sellerpilot_private.channel_gateway_jobs j
   where j.status in ('succeeded', 'failed', 'cancelled')
     and j.completed_at is not null
     and j.completed_at < p_completed_before;
  get diagnostics v_gateway_jobs = row_count;

  delete from sellerpilot_private.operation_audit a
   where a.action in ('channel_orders_synced', 'channel_inquiries_synced')
     and a.created_at < p_completed_before
     and coalesce(nullif(a.safe_detail->>'response_count', '')::integer, 0) = 0;
  get diagnostics v_noop_audits = row_count;

  delete from sellerpilot_private.operation_audit a
   where a.created_at < p_completed_before
     and a.entity_type in ('product', 'product_listing')
     and (
       a.entity_id is null
       or (
         a.entity_type = 'product'
         and not exists (
           select 1 from sellerpilot_private.products p where p.id::text = a.entity_id
         )
       )
       or (
         a.entity_type = 'product_listing'
         and not exists (
           select 1 from sellerpilot_private.product_listings l where l.id::text = a.entity_id
         )
       )
     );
  get diagnostics v_orphan_product_audits = row_count;

  insert into sellerpilot_private.operation_audit (action, entity_type, safe_detail)
  values ('runtime_noise_pruned', 'retention', jsonb_build_object(
    'gateway_jobs_deleted', v_gateway_jobs,
    'noop_audits_deleted', v_noop_audits,
    'orphan_product_audits_deleted', v_orphan_product_audits,
    'cutoff', p_completed_before
  ));

  return jsonb_build_object(
    'gatewayJobsDeleted', v_gateway_jobs,
    'noopAuditsDeleted', v_noop_audits,
    'orphanProductAuditsDeleted', v_orphan_product_audits
  );
end;
$$;

revoke all on function public.sellerpilot_service_prune_runtime_noise(timestamptz)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_prune_runtime_noise(timestamptz)
  to service_role;

commit;
