begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
-- Competitor observation time is not publication content. Preserve every
-- existing field fence and permit only this additional read-only timestamp.
-- No updated_at rewrite, publication gate opening, or source approval change.
do $guard$ begin
 if md5(pg_get_functiondef('sellerpilot_private.freeze_inflight_external_detail_product()'::regprocedure))<>'4cb992dd0be2fddb2d97c7466141ddb5' then
 raise exception 'COMPETITOR_OBSERVATION_FENCE_PREIMAGE_DRIFT';end if;
end $guard$;
CREATE OR REPLACE FUNCTION sellerpilot_private.freeze_inflight_external_detail_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if old.external_detail_import_id is not null and (to_jsonb(new)-array['updated_at','on_hand','reserved','status','competitor_checked_at']) is distinct from (to_jsonb(old)-array['updated_at','on_hand','reserved','status','competitor_checked_at']) and exists(select 1 from sellerpilot_private.channel_gateway_jobs j where j.status in ('queued','running','reconciliation_required') and j.request_payload#>>'{arguments,sellerpilotExternalDetail,importId}'=old.external_detail_import_id::text) then raise exception 'EXTERNAL_DETAIL_PRODUCT_HAS_INFLIGHT_PUBLICATION';end if;
 return new;
end$function$;

commit;
