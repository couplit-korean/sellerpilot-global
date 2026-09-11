-- Repin the fixed-IP CS and order read routes to the active runtime release.
--
-- Why: sellerpilot_private.local_channel_executor_route_is_current compares the
-- route release_sha with active_serverless_runtime_release_sha() and requires
-- expires_at > now(). After a Production deploy both values usually go stale, and
-- then no worker may claim the Mac-lane reads. On 2026-09-11 every CS read stalled
-- for exactly this reason (routes pinned to 54170455 with an expired window while
-- Production served 128a9ead). Re-pinning is an operational step, so keep it in a
-- tiny callable function instead of hand-editing rows.
begin;

create or replace function sellerpilot_private.repin_fixed_ip_read_routes(
  p_ttl interval default interval '7 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release text := sellerpilot_private.active_serverless_runtime_release_sha();
  v_count integer;
begin
  if v_release is null then
    raise exception 'ACTIVE_SERVERLESS_RELEASE_REQUIRED' using errcode = '55000';
  end if;
  if p_ttl is null or p_ttl <= interval '0 seconds' then
    raise exception 'REPIN_TTL_REQUIRED' using errcode = '22023';
  end if;
  update sellerpilot_private.local_channel_executor_routes
     set release_sha = v_release,
         approved_at = clock_timestamp(),
         expires_at = clock_timestamp() + p_ttl,
         enabled = true
   where operation in ('orders.list', 'inquiries.list')
     and worker_token_id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function sellerpilot_private.repin_fixed_ip_read_routes(interval)
  from public, anon, authenticated;
grant usage on schema sellerpilot_private to service_role;
grant execute on function sellerpilot_private.repin_fixed_ip_read_routes(interval)
  to service_role;

commit;
