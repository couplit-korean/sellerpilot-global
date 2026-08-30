-- Temu inquiry reads can run only from the attested Vercel fixed-egress path.
-- Reject new periodic reads while the database rollout policy is disabled so
-- manual sync never reports a job that no eligible worker can claim.

begin;

alter function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) rename to sellerpilot_310450_enqueue_periodic_sync_unsafe;

revoke all on function
  public.sellerpilot_310450_enqueue_periodic_sync_unsafe(
    text, text, jsonb, integer
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_periodic_sync(
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel = 'temu'
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = 'temu'
          and policy.enabled
     ) then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', 'fixed_egress_required',
      'blockedReason', 'STATIC_EGRESS_REQUIRED'
    );
  end if;

  return public.sellerpilot_310450_enqueue_periodic_sync_unsafe(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) to service_role;

comment on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) is
  'Queues bounded periodic reads and refuses Temu inquiry work until fixed egress is enabled.';

commit;
