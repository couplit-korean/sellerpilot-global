-- CS-temu-R01: preserve the shared administrator worker model. Authorization
-- remains the exact worker token / job / claim / live lease relationship.
-- Owner equality from the channel proposal is deliberately not introduced.
begin;
do $migration$
declare
  v_signature regprocedure := to_regprocedure('public.sellerpilot_service_requeue_temu_after_sales_detail_v2(text,uuid,uuid,jsonb,integer,integer,integer,integer,integer)');
  v_definition text;
  v_old constant text := 'and token.scope = ''gateway''';
  v_new constant text := 'and token.scope in (''gateway'', ''serverless_cs'')';
begin
  if v_signature is null then
    raise exception 'TEMU_RETRY_SCOPE_PREIMAGE_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(v_signature) into strict v_definition;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1
     or strpos(v_definition, 'job.worker_token_id = v_token_id') = 0
     or strpos(v_definition, 'job.claim_token = p_claim_token') = 0
     or strpos(v_definition, 'job.lease_expires_at > v_now') = 0
     or strpos(v_definition, 'v_job.operation <> ''inquiries.list''') = 0
     or strpos(v_definition, 'v_job.channel <> ''temu''') = 0
     or not exists (
       select 1 from pg_catalog.pg_proc p where p.oid = v_signature
         and p.prosecdef
         and p.proconfig = array['search_path=pg_catalog, public, sellerpilot_private']::text[]
         and p.proowner = 'postgres'::regrole
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
     ) then
    raise exception 'TEMU_RETRY_SCOPE_PREIMAGE_DRIFTED';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;
commit;
