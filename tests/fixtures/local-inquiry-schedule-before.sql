CREATE OR REPLACE FUNCTION public.sellerpilot_service_enqueue_periodic_sync(p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_channel in ('smartstore', 'temu')
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
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
$function$
;