-- Authorization codes expire while the ordinary history backlog is draining.
-- Keep all deployed eligibility, seller, lease, credential and mutation guards;
-- prioritize OAuth after exact Qoo10 activation permits, before ordinary reads.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $migration$
declare
  v_oid regprocedure := 'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure;
  v_source text;
  v_definition text;
  v_needle text := 'case when job.prepared_credential_id is null then 1 else 0 end,';
begin
  select prosrc into v_source from pg_proc where oid=v_oid;
  if md5(v_source) is distinct from 'e800a7ea6de35a4c808c8397ad662f52'
     or (length(v_source)-length(replace(v_source,v_needle,'')))/length(v_needle)<>1 then
    raise exception 'OAUTH_CLAIM_PRIORITY_PREIMAGE_DRIFT';
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  v_definition:=replace(v_definition,v_needle,
    'case when job.operation = ''oauth.exchange'' then 0 else 1 end, '||v_needle);
  execute v_definition;
end $migration$;
notify pgrst,'reload schema';
commit;
