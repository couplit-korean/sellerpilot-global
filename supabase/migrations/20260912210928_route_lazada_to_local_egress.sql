begin;
set local lock_timeout='2s';set local statement_timeout='15s';
-- 2026-09-12 live orders API rejected Vercel's source IP. The registered Mac
-- route is the execution path. Existing local attestation and write approvals
-- still apply; this does not enable any queued provider mutation.
do $guard$ begin
 if md5(pg_get_functiondef('sellerpilot_private.serverless_gateway_job_allowed(text,text)'::regprocedure))
 is distinct from 'cd637b171b149cb559a9a67da69ed6b7' then raise exception 'LAZADA_SERVERLESS_POLICY_PREIMAGE_CHANGED';end if;
end $guard$;
CREATE OR REPLACE FUNCTION sellerpilot_private.serverless_gateway_job_allowed(p_channel text, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_channel <> 'lazada' and ((
    p_channel = 'coupang'
    and p_operation = 'listing.lineage.verify'
  ) or sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(
    p_channel,
    p_operation
  )
  )
$function$;
revoke all on function sellerpilot_private.serverless_gateway_job_allowed(text,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
