-- Preserve the original refresh timestamp in audit evidence before satisfying
-- the existing flight CHECK. Inquiry started_at/status/error are not changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare
  target regprocedure:='public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)'::regprocedure;
  definition text;
  needle text;
  replacement text;
begin
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from 'c8face602aebf60da821a0de58a9039a' then
    raise exception 'EBAY_EXACT_FLIGHT_PREIMAGE_DRIFT'; end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid='sellerpilot_private.channel_gateway_jobs'::regclass
        and conname='channel_gateway_jobs_credential_refresh_flight_check')
     is distinct from 'CHECK ((credential_refresh_in_flight = (credential_refresh_started_at IS NOT NULL)))' then
    raise exception 'EBAY_EXACT_FLIGHT_CHECK_DRIFT'; end if;
  definition:=pg_get_functiondef(target);
  needle:='''providerVerifiedAt'',p_provider_verified_at';
  replacement:=needle||',''supersededRefreshStartedAt'',j.credential_refresh_started_at';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
    raise exception 'EBAY_EXACT_FLIGHT_AUDIT_ANCHOR_DRIFT'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='set credential_refresh_in_flight=false
    where id=''42f87fd2-8583-47c1-85f0-7e3ff436ad4a'' and credential_id=source.id';
  replacement:='set credential_refresh_in_flight=false,credential_refresh_started_at=null
    where id=''42f87fd2-8583-47c1-85f0-7e3ff436ad4a'' and credential_id=source.id';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'EBAY_EXACT_FLIGHT_UPDATE_ANCHOR_DRIFT'; end if;
  execute replace(definition,needle,replacement);
end;
$patch$;
commit;
