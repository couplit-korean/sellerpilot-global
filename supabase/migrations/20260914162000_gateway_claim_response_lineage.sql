-- The regular claimant already locks the job and active credential. Return
-- their existing attempt/version/fingerprint so the worker can preserve that
-- exact incarnation. No claim selection, authorization or state change differs.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare
 target regprocedure := 'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure;
 definition text;
 needle text := $old$    'credential_id', j.credential_id,
    'channel', j.channel,$old$;
 replacement text := $new$    'credential_id', j.credential_id,
    'attempt_id', j.attempt_id,
    'credential_version', c.version,
    'credential_fingerprint', c.fingerprint,
    'channel', j.channel,$new$;
begin
 if (select md5(prosrc) from pg_proc where oid=target)
   is distinct from 'e3a32c63b48d6650fff7ec45e4ec1652' then
  raise exception 'GATEWAY_CLAIM_RESPONSE_LINEAGE_PREIMAGE_DRIFT';
 end if;
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'GATEWAY_CLAIM_RESPONSE_LINEAGE_ANCHOR_DRIFT';
 end if;
 execute replace(definition,needle,replacement);
end;
$patch$;
commit;
