-- Registered-IP reads use the already-approved Mac executor. A cloud claim
-- must not race that executor and intermittently hit a different source IP.
-- Listing/reply/shipment write eligibility stays with its existing gate.
begin;
do $guard$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('sellerpilot_private.serverless_gateway_job_allowed(text,text)')
   and md5(prosrc)='faeb31734a225a960af2156e69fd3acf') then raise exception 'REGISTERED_EGRESS_POLICY_PREIMAGE_CHANGED';end if;
end $guard$;
CREATE OR REPLACE FUNCTION sellerpilot_private.serverless_gateway_job_allowed(p_channel text, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not (p_channel in ('coupang','smartstore','elevenst','shopee','lazada','temu')
    and p_operation in ('diagnostic.test','orders.list','inquiries.list'))
    and p_channel <> 'lazada' and ((
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
