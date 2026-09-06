-- Operator-verified 2026-09-04: Shopee category reads and diagnostic.test
-- must run on the Mac whitelist IP. Local 11820 uses
--   queued AND NOT (non-category Shopee OR (serverless-allowed AND in-list))
-- A previous live overlay put Shopee categories into that in-list, so
-- AND NOT excluded the jobs the Mac worker needed. Disable that branch.
-- Also treat diagnostic.test like a category read so 연결 검사 can pass
-- last_check_status and the workbench can show Shopee.
-- Operator-verified 2026-09-04: Mac worker claim returned 204 while Shopee
-- categories were queued because 11820 AND NOT included
-- (serverless_gateway_job_allowed AND exists active serverless_cs token).
-- Vercel CS drain token is active, so that clause excluded every allowed
-- operation including Shopee category reads. Keep that exists-check from
-- blocking local category/diagnostic claims. Do not buy Static IP.

do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old constant text :=
    $old$or (j.channel = 'shopee' and j.operation in ($old$;
  v_new constant text :=
    $new$or (false and j.channel = 'shopee' and j.operation in ($new$;
  v_attr_old constant text :=
    $old$'categories.attributes', 'categories.validate'$old$;
  v_attr_new constant text :=
    $new$'categories.attributes', 'categories.validate', 'diagnostic.test'$new$;
  v_old_count integer;
  v_new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception '11820 claim function is missing';
  end if;

  v_new_count := (
    length(v_definition) - length(replace(v_definition, v_new, ''))
  ) / length(v_new);
  if v_new_count = 1 then
    null;
  else
    v_old_count := (
      length(v_definition) - length(replace(v_definition, v_old, ''))
    ) / length(v_old);
    if v_old_count <> 1 then
      raise exception '11820 Shopee in-list marker count=%', v_old_count;
    end if;
    v_rewritten := replace(v_definition, v_old, v_new);
    execute v_rewritten;
    v_definition := v_rewritten;
  end if;

  if position(v_attr_new in v_definition) = 0 then
    if position(v_attr_old in v_definition) = 0 then
      raise exception '11820 category operation marker missing';
    end if;
    v_definition := replace(v_definition, v_attr_old, v_attr_new);
    execute v_definition;
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if position($$false and serverless_token.scope = 'serverless_cs'$$ in v_definition) = 0
     and position($$serverless_token.scope = 'serverless_cs'$$ in v_definition) > 0 then
    execute replace(
      v_definition,
      $$serverless_token.scope = 'serverless_cs'$$,
      $$false and serverless_token.scope = 'serverless_cs'$$
    );
  end if;
end;
$migration$;
