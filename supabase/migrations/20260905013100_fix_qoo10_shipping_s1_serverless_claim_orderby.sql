-- Follow-up to 20260905003000. Do not rewrite that applied history.
-- 03000 injected the shipping S1 activation exclusion immediately before
-- `for update of job skip locked`. Live 183000 has that lock clause after
-- ORDER BY job.id, so the patch became `ORDER BY job.id AND NOT (...)`.
-- Postgres 42804: uuid AND boolean. Every serverless claim fails, so the
-- queued shipping S1 verifier stays unclaimed. Local 11820 already excludes the verifier and keeps
-- its AND NOT in the WHERE clause. Remove only the 183000 ORDER BY boolean.
-- listing.publication.verify remains serverless_cs-allowed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500131);

do $qoo10_shipping_s1_serverless_orderby_42804$
declare
  v_definition text;
  v_bad text := $body$and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(job)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)
     )
   for update of job skip locked$body$;
  v_lock text := 'for update of job skip locked';
  v_hits integer;
begin
  if to_regprocedure(
       'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'
     ) is null then
    raise exception 'exact Qoo10 shipping S1 183000 claimant missing'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_bad) = 0
     and pg_catalog.strpos(
           v_definition,
           'qoo10_shipping_s1_activation_job_matches(job)'
         ) = 0
     and pg_catalog.strpos(v_definition, v_lock) > 0
  then
    return;
  end if;
  v_hits := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_bad, '')))
    / pg_catalog.length(v_bad);
  if v_hits <> 1
     or pg_catalog.strpos(v_definition, v_lock) = 0
     or pg_catalog.strpos(
          v_definition,
          'sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)'
        ) = 0
  then
    raise exception 'exact Qoo10 shipping S1 183000 ORDER BY 42804 patch target not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_bad, v_lock);
  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
       ),
       v_bad
     ) > 0
  then
    raise exception 'exact Qoo10 shipping S1 183000 ORDER BY 42804 patch did not apply'
      using errcode = '55000';
  end if;
end;
$qoo10_shipping_s1_serverless_orderby_42804$;

comment on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text) is
  'Innermost serverless_cs claimant; shipping S1 activation exclusion must stay out of ORDER BY to avoid uuid AND boolean 42804.';

commit;
