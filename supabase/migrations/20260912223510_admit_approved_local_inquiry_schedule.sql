-- An already approved Mac read route can accept scheduled inquiry jobs even
-- when Vercel static egress is disabled. Actual claim still verifies worker,
-- release, account, IP and request scope. No cloud policy or write route changes.
begin;
do $guard$ begin
 if md5(pg_get_functiondef('public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)'::regprocedure))
    is distinct from '6153979a9b52a1776ed8bf5e904c6a81' then raise exception 'LOCAL_INQUIRY_SCHEDULE_PREIMAGE_CHANGED';end if;
end $guard$;
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
     )
     and not exists (
       select 1 from sellerpilot_private.local_channel_executor_routes r
       join sellerpilot_private.channel_credentials c on c.id=r.credential_id
         and c.channel=r.channel and c.created_by=r.owner_id
         and c.seller_account_key=r.seller_account_key
         and c.status='active' and c.environment='production'
         and (c.expires_at is null or c.expires_at>clock_timestamp())
       join sellerpilot_private.ai_cli_worker_tokens t on t.id=r.worker_token_id
         and t.status='active' and t.scope='gateway' and t.expires_at>clock_timestamp()
       where r.channel=p_channel and r.operation=p_operation and r.enabled
         and r.approved_by is not null and r.approved_at is not null
         and (r.expires_at is null or r.expires_at>clock_timestamp())
         and r.release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
         and r.egress_ip_sha256 ~ '^[a-f0-9]{64}$'
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
notify pgrst,'reload schema';
commit;
