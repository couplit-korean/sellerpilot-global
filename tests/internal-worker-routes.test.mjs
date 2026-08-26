import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrls = {
  channelSync: new URL("../app/api/internal/channel-sync/route.ts", import.meta.url),
  competitorPrices: new URL("../app/api/internal/competitor-prices/route.ts", import.meta.url),
  kakaoNotifications: new URL("../app/api/internal/kakao-notifications/route.ts", import.meta.url),
  maintenance: new URL("../app/api/internal/maintenance/route.ts", import.meta.url),
  kakaoLibrary: new URL("../lib/kakao.ts", import.meta.url),
};

function routeMethodSource(source, method, nextMethod) {
  const start = source.indexOf(`export async function ${method}`);
  const end = nextMethod ? source.indexOf(`export async function ${nextMethod}`, start + 1) : source.length;
  assert.ok(start >= 0, `${method} handler is missing`);
  assert.ok(end > start, `${method} handler boundary is missing`);
  return source.slice(start, end);
}

function assertBoundedSupabaseAndSeparatedAuth(source) {
  assert.match(source, /global: \{ fetch: createBoundedSupabaseFetch\([^)]*\) \}/);

  const get = routeMethodSource(source, "GET", "POST");
  const missingCron = get.indexOf("if (!cronSecret)");
  const badCronAuth = get.indexOf("authorization") >= 0
    ? get.indexOf("authorization", missingCron + 1)
    : get.indexOf("request.headers.get(\"authorization\")", missingCron + 1);
  assert.ok(missingCron >= 0 && badCronAuth > missingCron, "missing cron config must be checked before caller auth");
  assert.match(get, /if \(!cronSecret\)[\s\S]{0,220}status: 503/);
  assert.match(get, /Bearer \$\{cronSecret\}[\s\S]{0,220}status: 401/);
  assert.match(get, /if \(!serviceClient\)[\s\S]{0,220}status: 503/);

  const post = routeMethodSource(source, "POST");
  const malformedToken = post.indexOf("workerToken.length < 24");
  const clientCreation = post.indexOf("const serviceClient = serverClient()");
  assert.ok(malformedToken >= 0 && clientCreation > malformedToken, "malformed token must be rejected before server configuration is evaluated");
  assert.match(post, /workerToken\.length < 24[\s\S]{0,220}status: 401/);
  assert.match(post, /if \(!serviceClient\)[\s\S]{0,220}status: 503/);
  assert.match(post, /if \(error\)[\s\S]{0,320}status: 503/);
  assert.match(post, /if \(validationData !== true\)[\s\S]{0,220}status: 401/);
  assert.match(post, /RPC threw[\s\S]{0,220}status: 503/);
  assert.doesNotMatch(post, /!workerToken\.startsWith\("spw_"\)[^\n]+!serviceClient/);
  assert.doesNotMatch(post, /if \(error \|\| data !== true\)/);
}

test("periodic channel sync preserves idempotent partial results and surfaces database-wide enqueue outages", async () => {
  const source = await readFile(routeUrls.channelSync, "utf8");
  assertBoundedSupabaseAndSeparatedAuth(source);

  assert.match(source, /sellerpilot_service_enqueue_periodic_sync/);
  assert.match(source, /if \(error\) return \{ channel, operation, status: "failed", infrastructureFailure: true \}/);
  assert.match(source, /catch \{[\s\S]{0,180}infrastructureFailure: true/);
  assert.match(source, /status !== "queued" && status !== "already_pending" && status !== "not_connected" && status !== "reconnect_required"/);
  assert.match(source, /const reconnectRequired = results\.filter\(\(result\) => result\.status === "reconnect_required"\)\.length/);
  assert.match(source, /ok: failed === 0 && reconnectRequired === 0/);
  assert.match(source, /const databaseWideFailure = results\.length > 0 && infrastructureFailures === results\.length/);
  assert.match(source, /status: databaseWideFailure \? 503 : infrastructureFailures > 0 \? 207 : 200/);
});

test("competitor scheduler bounds one durable claim and preserves pending gateway work", async () => {
  const source = await readFile(routeUrls.competitorPrices, "utf8");
  assertBoundedSupabaseAndSeparatedAuth(source);

  assert.match(source, /const COMPETITOR_RPC_TIMEOUT_MS = 5_000/);
  assert.match(source, /const COMPETITOR_CLAIM_BATCH_SIZE = 1/);
  assert.match(source, /const COMPETITOR_PROVIDER_BUDGET_MS = 32_000/);
  assert.match(source, /sellerpilot_service_claim_due_competitor_products/);
  assert.match(source, /p_limit: COMPETITOR_CLAIM_BATCH_SIZE/);
  assert.doesNotMatch(source, /p_limit:\s*(?:[2-9]|[1-9][0-9]+)/);
  assert.match(source, /sellerpilot_service_complete_competitor_price_refresh/);
  assert.match(source, /p_providers: searched\.providers/);
  assert.match(source, /sellerpilot_service_release_competitor_price_refresh/);
  assert.doesNotMatch(source, /sellerpilot_service_due_competitor_products/);
  assert.doesNotMatch(source, /sellerpilot_service_record_competitor_prices/);
  assert.match(source, /competitor due-products RPC failed[\s\S]{0,240}status: 503/);
  assert.match(source, /if \(!Array\.isArray\(dueData\)\)[\s\S]{0,260}status: 503/);
  assert.match(source, /saveError \|\| !Number\.isFinite\(savedCount\) \|\| savedCount < 0/);
  assert.match(source, /if \(searched\.pending\)[\s\S]{0,260}pending: true/);
  assert.match(source, /status: infrastructureFailures > 0 \? 503 : pending \? 202 : results\.some\(\(item\) => !item\.ok\) \? 207 : 200/);
});

test("Kakao scheduler owns each delivery through a non-repeating send and reconciliation lifecycle", async () => {
  const source = await readFile(routeUrls.kakaoNotifications, "utf8");
  const kakaoLibrary = await readFile(routeUrls.kakaoLibrary, "utf8");
  assertBoundedSupabaseAndSeparatedAuth(source);

  assert.match(source, /data: enqueued, error: enqueueError/);
  assert.match(source, /enqueueError \|\| typeof enqueued !== "number"/);
  assert.match(source, /kakao summary enqueue RPC failed[\s\S]{0,260}status: 503/);
  assert.doesNotMatch(source, /^\s*await serviceClient\.rpc\("sellerpilot_service_enqueue_kakao_summaries"\);$/m);
  assert.match(source, /const KAKAO_SUPABASE_TIMEOUT_MS = 3_000/);
  assert.match(source, /const KAKAO_CLAIM_BATCH_SIZE = 1/);
  assert.match(source, /createBoundedSupabaseFetch\(KAKAO_SUPABASE_TIMEOUT_MS\)/);
  assert.match(source, /p_limit: KAKAO_CLAIM_BATCH_SIZE/);
  assert.doesNotMatch(source, /p_limit:\s*(?:[2-9]|[1-9][0-9]+)/);
  assert.match(source, /p_lease_seconds: KAKAO_CLAIM_LEASE_SECONDS/);
  assert.match(source, /if \(!Array\.isArray\(claimData\)\)[\s\S]{0,260}status: 503/);
  assert.match(source, /typeof item\.claim_token === "string"[\s\S]{0,120}UUID_PATTERN\.test\(item\.claim_token\)/);
  assert.match(source, /sellerpilot_service_begin_kakao_notification_refresh/);
  assert.match(source, /sellerpilot_service_stage_kakao_notification_refresh/);
  assert.match(source, /sellerpilot_service_finish_kakao_notification_preparation/);
  assert.doesNotMatch(source, /sellerpilot_service_store_kakao_integration/);
  assert.match(source, /const preparedSecretsByOwner = new Map<string, PreparedSecretResult>\(\)/);
  assert.match(source, /if \(!preparedSecret\)[\s\S]+preparedSecretsByOwner\.set\(row\.owner_id, preparedSecret\)/);
  assert.equal([...source.matchAll(/refreshKakaoToken\(secret\)/g)].length, 1);
  const beginRefresh = source.indexOf("sellerpilot_service_begin_kakao_notification_refresh");
  const remoteRefresh = source.indexOf("refreshKakaoToken(secret)");
  const stageRefresh = source.indexOf("sellerpilot_service_stage_kakao_notification_refresh");
  const beginSend = source.indexOf("sellerpilot_service_begin_kakao_notification_send");
  const remoteSend = source.indexOf("await sendKakaoMemo");
  const completion = source.indexOf("sellerpilot_service_complete_kakao_notification", remoteSend);
  assert.ok(
    beginRefresh >= 0
    && remoteRefresh > beginRefresh
    && stageRefresh > remoteRefresh
    && beginSend > stageRefresh
    && remoteSend > beginSend
    && completion > remoteSend,
  );
  assert.match(source, /LIFECYCLE_RPC_RETRY_DELAYS_MS = \[0, 125\]/);
  assert.match(source, /rejected \? "failed" : "reconciliation_required"/);
  assert.match(source, /sendRejected \? "failed" : "reconciliation_required"/);
  assert.doesNotMatch(source, /p_success:/);
  assert.match(source, /completionPersistenceUncertain/);
  assert.match(source, /reconciliationRequired/);
  assert.match(source, /status: infrastructureFailures > 0 \? 503 : failed \? 207 : 200/);

  assert.match(kakaoLibrary, /const KAKAO_HTTP_TIMEOUT_MS = 15_000/);
  assert.match(kakaoLibrary, /async function kakaoFetch[\s\S]+signal: AbortSignal\.timeout\(KAKAO_HTTP_TIMEOUT_MS\)/);
  assert.equal(
    [...kakaoLibrary.matchAll(/await kakaoFetch\(/g)].length,
    4,
  );
});

test("maintenance sweeps ambiguous Kakao sends into reconciliation instead of retrying them", async () => {
  const source = await readFile(routeUrls.maintenance, "utf8");
  assert.match(source, /sellerpilot_service_sweep_stale_kakao_notifications/);
  assert.match(source, /sellerpilot_service_sweep_stale_tracx_mutations/);
  assert.match(source, /sellerpilot_service_sweep_stale_lazada_replies/);
  assert.match(source, /kakaoSweepError/);
  assert.match(source, /tracxSweepError/);
  assert.match(source, /lazadaReplySweepError/);
  assert.match(source, /kakaoReconciliationRequired/);
  assert.match(source, /p_operation: "diagnostic\.test"/);
  assert.match(source, /queueRefreshIfNeeded\(serviceClient, "shopee"\)/);
  assert.match(source, /queueRefreshIfNeeded\(serviceClient, "lazada"\)/);
  assert.match(source, /queueRefreshIfNeeded\(serviceClient, "ebay"\)/);
  assert.doesNotMatch(source, /sellerpilot_service_refresh_(?:shopee|lazada|ebay)/);
  assert.doesNotMatch(source, /exchange(?:Shopee|Lazada|Ebay)OAuthToken/);
});
