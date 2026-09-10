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
  -- Fresh source replay can retain the fixed-egress channel list in the
  -- published inner claimant after later priority rewrites. Production reached
  -- a separate operator overlay with the `j` in-list. Accept only the stable
  -- fixed-egress marker; 232000 later replaces both histories with the same
  -- captured, operator-verified full definition.
  v_published_predecessor constant text :=
    $published$j.channel in ('coupang', 'smartstore', 'elevenst', 'temu')$published$;
  v_attr_old constant text :=
    $old$'categories.attributes', 'categories.validate'$old$;
  v_attr_new constant text :=
    $new$'categories.attributes', 'categories.validate', 'diagnostic.test'$new$;
  v_old_count integer;
  v_new_count integer;
  v_published_predecessor_count integer;
  v_attr_old_count integer;
  v_attr_new_count integer;
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
  v_old_count := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);
  v_published_predecessor_count := (
    length(v_definition) - length(replace(
      v_definition,
      v_published_predecessor,
      ''
    ))
  ) / length(v_published_predecessor);
  v_attr_new_count := (
    length(v_definition) - length(replace(v_definition, v_attr_new, ''))
  ) / length(v_attr_new);
  -- v_attr_old is a prefix of v_attr_new, so count only bare old markers.
  v_attr_old_count := (
    (length(v_definition) - length(replace(v_definition, v_attr_old, '')))
      / length(v_attr_old)
  ) - v_attr_new_count;

  if v_old_count = 0
     and v_new_count = 0
     and v_published_predecessor_count = 1
     and v_attr_old_count = 0
     and v_attr_new_count = 0 then
    -- No operator-only markers exist in a fresh replay. Keep the exact
    -- published source until the canonical 232000 snapshot.
    null;
  elsif v_old_count = 1
        and v_new_count = 0
        and v_published_predecessor_count = 0
        and v_attr_old_count = 3
        and v_attr_new_count = 0 then
    v_rewritten := replace(v_definition, v_old, v_new);
    v_rewritten := replace(v_rewritten, v_attr_old, v_attr_new);
    execute v_rewritten;
    v_definition := v_rewritten;
  elsif v_old_count = 0
        and v_new_count = 1
        and v_published_predecessor_count = 0
        and v_attr_old_count = 0
        and v_attr_new_count = 3 then
    null;
  else
    raise exception
      '11820 Shopee marker cardinality drift old=%, new=%, published=%, attr_old=%, attr_new=%',
      v_old_count,
      v_new_count,
      v_published_predecessor_count,
      v_attr_old_count,
      v_attr_new_count;
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
