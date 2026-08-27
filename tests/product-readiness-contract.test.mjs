import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260828001000_expose_product_readiness_facts.sql",
  import.meta.url,
);

test("product readiness migration uses explicit product lineage and shared-admin guards", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const saveFunction = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_save_margin_scenario"),
    migration.indexOf("create or replace function public.sellerpilot_list_margin_scenarios"),
  );

  assert.match(migration, /add column if not exists product_id uuid/);
  assert.match(migration, /foreign key \(product_id\)[\s\S]*references sellerpilot_private\.products\(id\)/);
  assert.match(migration, /margin_scenarios_product_created_idx/);
  assert.match(saveFunction, /if not public\.sellerpilot_is_admin\(\)/);
  assert.match(saveFunction, /p_inputs->>'productId'/);
  assert.match(saveFunction, /where product\.id = v_product_id_text::uuid[\s\S]*product\.status <> 'archived'[\s\S]*not product\.demo/);
  assert.doesNotMatch(saveFunction, /product\.name|ilike|owner_id = auth\.uid\(\)/i);
  assert.match(migration, /'productId', row\.product_id/);
  assert.doesNotMatch(migration, /scenario\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /delete from sellerpilot_private\.margin_scenarios scenario[\s\S]{0,120}where scenario\.id = p_id[\s\S]{0,120}returning scenario\.owner_id/);
  assert.match(migration, /'scenario_owner_id', v_scenario_owner/);
  assert.match(migration, /candidate\.status = 'confirmed'/);
  assert.match(migration, /candidate\.environment = 'production'/);
  assert.match(migration, /listing\.owner_id = product\.owner_id/);
  assert.match(migration, /candidate\.owner_id = product\.owner_id/);
  assert.match(migration, /select distinct on \(candidate\.channel, candidate\.market\)/);
  assert.match(migration, /candidate\.confirmed_at desc nulls last[\s\S]{0,160}candidate\.updated_at desc[\s\S]{0,160}candidate\.id desc/);
  assert.match(migration, /where scenario\.product_id = product\.id[\s\S]{0,120}order by scenario\.created_at desc/);
  assert.match(migration, /latest_ai\.updated_at >= latest_listing\.updated_at/);
  assert.doesNotMatch(migration, /error_message[\s\S]{0,120}'latestError'/);
  assert.match(migration, /create or replace function public\.sellerpilot_get_product_readiness_facts\(\)/);
  assert.doesNotMatch(migration, /alter function public\.sellerpilot_get_operations_snapshot|create function public\.sellerpilot_get_operations_snapshot/);
});

test("isolated product readiness read self-heals without blocking or wrapping the core snapshot", async () => {
  const [route, snapshotRoute, hook] = await Promise.all([
    readFile(new URL("../app/api/operations/product-readiness/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/snapshot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/use-operations-snapshot.ts", import.meta.url), "utf8"),
  ]);
  const recoveryCall = route.indexOf('"sellerpilot_service_expire_stale_ai_jobs"');
  const readinessRead = route.indexOf('"sellerpilot_get_product_readiness_facts"');

  assert.ok(recoveryCall > 0 && recoveryCall < readinessRead);
  assert.match(route, /STALE_AI_QUEUED_TIMEOUT_MS = 24 \* 60 \* 60_000/);
  assert.match(route, /p_queued_before: new Date\(Date\.now\(\) - STALE_AI_QUEUED_TIMEOUT_MS\)\.toISOString\(\)/);
  assert.match(route, /p_limit: STALE_AI_RECOVERY_LIMIT/);
  assert.match(route, /status: !shouldRecoverStaleAi \? "checking" : recoveryError \? "failed" : "passed"/);
  assert.match(route, /장기 AI 분석 작업의 자동 정리 상태를 확인하지 못했습니다/);
  assert.match(route, /marginScenarioState: marginScenariosUnavailable \? "unavailable" : "ready"/);
  assert.match(route, /"cache-control": "no-store, max-age=0"/);
  assert.match(route, /searchParams\.get\("recoverStale"\) !== "0"/);
  assert.match(route, /factsUnavailable = Boolean\(factsError\) \|\| !Array\.isArray\(facts\)/);
  assert.doesNotMatch(route, /support|inquir|ticket|reply/i);
  assert.doesNotMatch(snapshotRoute, /sellerpilot_service_expire_stale_ai_jobs|sellerpilot_get_product_readiness_facts/);
  assert.ok(hook.indexOf("const readinessPromise") < hook.indexOf("/api/operations/snapshot?"));
  assert.ok(hook.indexOf("setData(baseData)") < hook.indexOf("await readinessPromise"));
  assert.match(hook, /mergeProductReadiness\(baseData, readiness\)/);
  assert.match(hook, /marginScenarioState: "unavailable"/);
  assert.match(hook, /marginScenarios: readiness\.marginScenarioState === "ready"[\s\S]{0,140}snapshot\.marginScenarios/);
  assert.match(hook, /STALE_AI_RECOVERY_INTERVAL_MS = 5 \* 60_000/);
  assert.match(hook, /recoverStale=\$\{shouldRecoverStaleAi \? "1" : "0"\}/);
  assert.match(hook, /carryForwardProductReadiness\(payload, lastGoodDataRef\.current\)/);
  assert.match(hook, /factsByProductId\.get\(product\.id\) \?\? product/);
  assert.match(hook, /parseProductReadinessResponse/);
  assert.match(hook, /category\.categoryPath\.every\(\(part\) => typeof part === "string"\)/);
});

test("product list, detail, and calculator label only ledger-backed values", async () => {
  const [page, calculator, snapshotTypes, mobileStyles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/use-operations-snapshot.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  ]);

  assert.match(snapshotTypes, /baseSellingPrice: number \| null/);
  assert.match(snapshotTypes, /confirmedCategories: Array/);
  assert.match(snapshotTypes, /latestErrorKind: "analysis" \| "listing" \| "external_action" \| null/);
  assert.match(snapshotTypes, /marginState: "calculated" \| "missing" \| "invalid"/);
  assert.match(page, /기준 판매가 \{formatBaseSellingPrice\(product\)\}/);
  assert.match(page, /통화 미입력/);
  assert.match(page, /상품 직접 계산 마진 \{productMarginLabel\(product\)\}/);
  assert.match(page, /상품군 힌트 \{product\.categoryHint \?\? "미입력"\}/);
  assert.match(page, /채널 확정 카테고리/);
  assert.match(page, /채널 순마진 추정 안 함/);
  assert.match(page, /product\.latestError \? <small[^>]*role="status"/);
  assert.match(page, /장기 AI 분석 \$\{aiRecovery\.expiredCount\}건 자동 종료/);
  assert.match(page, /key: `ai-recovery:expired:\$\{aiRecovery\.checkedAt\}:\$\{aiRecovery\.expiredCount\}`/);
  assert.match(page, /productReadinessState === "unavailable"/);
  assert.match(page, /marginState === "missing"\) return "미계산"/);
  assert.match(page, /marginState === "invalid"[\s\S]{0,100}return "계산 불가"/);
  assert.match(calculator, /<select id="margin-product-id"/);
  assert.match(calculator, /가격 미입력 · \$\{product\.baseCurrency\}/);
  assert.match(calculator, /inputs: \{ \.\.\.form, productId: selectedProduct\.id/);
  assert.match(calculator, /scenarioState === "unavailable"[\s\S]{0,220}저장된 계산 이력을 불러오지 못했습니다/);
  assert.doesNotMatch(calculator, /setProductName|margin-product-name/);
  assert.match(mobileStyles, /\.margin-product-field input,[\s\S]{0,80}\.margin-product-field select[\s\S]{0,180}min-height: 44px/);
  assert.match(mobileStyles, /\.margin-product-field select \{[\s\S]{0,160}-webkit-appearance: none;[\s\S]{0,80}appearance: none;/);
  assert.match(mobileStyles, /\.margin-product-field > small[\s\S]{0,220}overflow-wrap: anywhere;[\s\S]{0,80}white-space: normal;/);
  assert.match(mobileStyles, /@media \(max-width: 900px\)[\s\S]*?\.product-table tbody tr[\s\S]*?min-height: 116px/);
  assert.match(mobileStyles, /\.product-table \.product-cell small[\s\S]*?overflow-wrap: anywhere[\s\S]*?white-space: normal/);
  assert.match(mobileStyles, /@media \(max-width: 390px\)[\s\S]*?\.product-table[\s\S]*?min-width: 760px/);
  assert.match(mobileStyles, /\.product-table \.product-list-error[\s\S]*?color: #b42318/);
  assert.match(page, /activity\.elapsedSeconds < LONG_ANALYSIS_SECONDS/);
  assert.match(page, /장기 분석 진행 중 · 작업자 연결됨/);
  assert.match(page, /장기 대기 · AI 작업자 확인 필요/);
  assert.match(page, /실제 lease를 읽을 수 없어 완료 여부는 추정하지 않습니다/);
  assert.match(mobileStyles, /@media \(max-width: 390px\)[\s\S]*?\.registration-status\.long-analysis-connected,[\s\S]*?min-height: 44px/);
  assert.match(mobileStyles, /@media \(max-width: 720px\)[\s\S]*?\.product-detail-ledger dd[\s\S]*?overflow-wrap: anywhere[\s\S]*?white-space: normal/);
});

test("page request scopes provide mobile AbortSignal fallback and deterministic cleanup", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /typeof AbortSignal\.any === "function"/);
  assert.match(page, /const fallbackController = new AbortController\(\)/);
  assert.match(page, /source\.removeEventListener\("abort", listener\)/);
  assert.match(page, /globalThis\.clearTimeout\(timeoutId\)/);
  assert.doesNotMatch(page, /AbortSignal\.timeout\(/);
  assert.match(page, /const pollScope = createPageAbortScope\(\[signal\], 15_000/);
  assert.match(page, /const enqueueScope = createPageAbortScope\(\[productResearchController\.signal\], 30_000/);
  assert.match(page, /finally \{[\s\S]{0,100}enqueueScope\.dispose\(\)/);
});
