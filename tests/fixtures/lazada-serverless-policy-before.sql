CREATE OR REPLACE FUNCTION sellerpilot_private.serverless_gateway_job_allowed(p_channel text, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (
    p_channel = 'coupang'
    and p_operation = 'listing.lineage.verify'
  ) or sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(
    p_channel,
    p_operation
  )
$function$
