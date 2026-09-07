-- Keep Shopee category discovery and credential diagnostics on the registered
-- local gateway. These operations require the seller's accepted source IP in
-- the current production setup. The local claimant already admits them, but
-- the serverless claimant can still take them when a retained policy/header
-- combination makes serverless_static_egress_allowed('shopee') true.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900715324);

do $keep_shopee_restricted_operations_local$
declare
  v_definition text;
  v_old constant text := $old$and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )$old$;
  v_new constant text := $new$and not (
       job.channel = 'shopee'
       and job.operation in (
         'categories.list', 'categories.suggest',
         'categories.attributes', 'categories.validate',
         'diagnostic.test'
       )
     )$new$;
  v_old_count integer;
  v_new_count integer;
  v_select_at integer;
  v_order_at integer;
begin
  if to_regprocedure(
       'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'
     ) is null then
    raise exception 'serverless 183000 claimant missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into strict v_definition;

  v_old_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  v_new_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
  ) / pg_catalog.length(v_new);

  -- The two sites are the queued credential rebind and the SKIP LOCKED claim.
  -- Excluding both keeps serverless from changing or owning local-only work.
  if v_old_count = 2 and v_new_count = 0 then
    execute pg_catalog.replace(
      v_definition,
      v_old,
      v_new || E'\n     ' || v_old
    );
  elsif v_old_count <> 2 or v_new_count <> 2 then
    raise exception
      'Shopee local-only 183000 preimage drifted old=% new=%',
      v_old_count, v_new_count
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into strict v_definition;
  v_old_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  v_new_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
  ) / pg_catalog.length(v_new);
  v_select_at := pg_catalog.strpos(v_definition, 'select job.id');
  v_order_at := pg_catalog.strpos(
    pg_catalog.substr(v_definition, v_select_at),
    'order by'
  );

  if v_old_count <> 2
     or v_new_count <> 2
     or v_select_at = 0
     or v_order_at = 0
     or pg_catalog.strpos(v_definition, 'for update of job skip locked') = 0
     or pg_catalog.strpos(
          v_definition,
          $$job.channel is distinct from 'smartstore'$$
        ) = 0
  then
    raise exception
      'Shopee local-only 183000 postimage drifted old=% new=% select=% order=% lock=% smartstore=%',
      v_old_count,
      v_new_count,
      v_select_at,
      v_order_at,
      pg_catalog.strpos(v_definition, 'for update of job skip locked'),
      pg_catalog.strpos(v_definition, $$job.channel is distinct from 'smartstore'$$)
      using errcode = '55000';
  end if;
end;
$keep_shopee_restricted_operations_local$;

revoke all on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;

comment on function
  public.sellerpilot_183000_claim_serverless_gateway_unsafe(text, text) is
  'Innermost serverless claimant; Smartstore and Shopee category/diagnostic jobs remain on the registered local gateway.';

commit;
