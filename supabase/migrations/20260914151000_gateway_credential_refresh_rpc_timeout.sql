-- PostgREST hoists function statement_timeout into the request transaction.
-- The existing credential-refresh worker has a 30s HTTP bound. Give only its
-- already-fenced credential staging RPC 25s; retain role defaults, lock timeout,
-- body, ACL, identity checks and idempotent storage semantics.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $guard$
begin
 if not exists(select 1 from pg_proc where oid='public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)'::regprocedure
   and md5(prosrc)='2c91ae65ec286c65e84bfde805c3c0d5'
   and proconfig=ARRAY['search_path=""']::text[]
   and proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 then raise exception 'GATEWAY_REFRESH_TIMEOUT_PREIMAGE_DRIFT';end if;
end $guard$;
alter function public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean) set statement_timeout='25s';
notify pgrst,'reload schema';
commit;
