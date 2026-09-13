begin;

-- The current worker maps a returned claim conflict to HTTP 409, while a
-- raised SQL error becomes transient HTTP 503. Keep the fence, stop the retry.
do $$ begin
 if md5(pg_get_functiondef('public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)'::regprocedure))
   is distinct from '878e375944f111d9ac8798e8aee49983' then raise exception 'SHOPEE_REFRESH_TERMINAL_PREIMAGE_DRIFT'; end if;
end $$;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_target_type text, p_target_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-target-refresh-claim/1',
      'status', 'conflict'
    );
  end if;
  return public.sp_60910013000_begin_shopee_refresh_before_create(
    p_token_hash, p_job_id, p_claim_token, p_target_type, p_target_id
  );
exception when sqlstate '55000' then
  -- Convert only our proven non-transient fence rejection. The subtransaction
  -- rolls back the attempted claim replacement; the prior lineage survives.
  if sqlerrm <> 'SHOPEE_PRIOR_REFRESH_RECONCILIATION_REQUIRED' then
    raise;
  end if;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-target-refresh-claim/1',
    'status','conflict',
    'reason','prior_refresh_reconciliation_required'
  );
end
$function$
;
revoke all on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
