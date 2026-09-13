begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
-- A claim hydrator runs after the lease UPDATE in the same outer RPC.
-- VOLATILE gives each internal SELECT a fresh snapshot of that write.
-- Ownership checks, identities, leases, credentials and ACLs are unchanged.
do $guard$ begin
 if md5(pg_get_functiondef('sellerpilot_private.hydrate_lazada_im_recovery_claim(jsonb)'::regprocedure))<>'76ea62bd49090a3a65ee1c9c27ec9b90'
 or md5(pg_get_functiondef('sellerpilot_private.hydrate_temu_local_cs_claim(jsonb)'::regprocedure))<>'f03af92198c2c72c2125013f77c3c7fa' then
  raise exception 'LOCAL_CLAIM_VISIBILITY_PREIMAGE_DRIFT';end if;
end $guard$;
alter function sellerpilot_private.hydrate_lazada_im_recovery_claim(jsonb) volatile;
alter function sellerpilot_private.hydrate_temu_local_cs_claim(jsonb) volatile;
notify pgrst,'reload schema';
commit;
