-- Preserve the exact verifier/source lock, but expose its existing mandatory
-- listing/channel/operation predicates to PostgreSQL. Without them every eBay
-- queued-credential rebind evaluated the composite-row matcher across the
-- active queue and exceeded STORE's timeout. The existing active-listing index
-- covers this lookup; no index, trigger, authorization or invariant is removed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare
  target regprocedure := 'sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()'::regprocedure;
  definition text;
  needle text := '     where verifier.id is distinct from old.id';
  replacement text := '     where verifier.listing_id = ''4e5b97be-3fe5-4537-9e26-d36fb36ec1fc''::uuid
       and verifier.channel = ''qoo10''
       and verifier.operation = ''listing.publication.verify''
       and verifier.id is distinct from old.id';
begin
  if (select md5(prosrc) from pg_proc where oid=target)
       is distinct from 'c9a4a0f55e2aa2a170e887dbaec3e20d'
     or (select md5(prosrc) from pg_proc where oid=
       'sellerpilot_private.qoo10_exact_s1_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure)
       is distinct from '4c3ccfb48ecbcd3aec19bc0ea708d4a2' then
    raise exception 'QOO10_VERIFIER_SOURCE_LOOKUP_PREIMAGE_DRIFT';
  end if;
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'QOO10_VERIFIER_SOURCE_LOOKUP_ANCHOR_DRIFT';
  end if;
  execute replace(definition,needle,replacement);
end;
$patch$;
commit;
