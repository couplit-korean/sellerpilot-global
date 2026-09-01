import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  databaseServerlessStaticEgressAllows,
  hasServerlessStaticEgressFor,
  parseServerlessStaticEgressChannels,
  serverlessStaticEgressHeaderValue,
} from "../lib/channels/serverless-static-egress";

test("database static egress requires an exact true policy value", () => {
  assert.equal(databaseServerlessStaticEgressAllows({ elevenst: true }, "elevenst"), true);
  assert.equal(databaseServerlessStaticEgressAllows({ elevenst: false }, "elevenst"), false);
  assert.equal(databaseServerlessStaticEgressAllows({ elevenst: "true" }, "elevenst"), false);
  assert.equal(databaseServerlessStaticEgressAllows([{ elevenst: true }], "elevenst"), false);
  assert.equal(databaseServerlessStaticEgressAllows(null, "elevenst"), false);
});

test("serverless static egress is disabled by default and on unknown values", () => {
  assert.deepEqual(parseServerlessStaticEgressChannels(undefined), []);
  assert.deepEqual(parseServerlessStaticEgressChannels(""), []);
  assert.deepEqual(parseServerlessStaticEgressChannels("coupang,unknown"), []);
});

test("serverless static egress accepts only explicit supported channels", () => {
  const configured = parseServerlessStaticEgressChannels("temu, shopee, elevenst, smartstore, coupang");
  assert.deepEqual(configured, ["coupang", "smartstore", "elevenst", "temu", "shopee"]);
  assert.equal(
    hasServerlessStaticEgressFor(configured, ["coupang", "smartstore", "elevenst", "temu", "shopee"]),
    true,
  );
  assert.equal(
    serverlessStaticEgressHeaderValue(configured),
    "coupang,smartstore,elevenst,temu,shopee",
  );
  assert.deepEqual(parseServerlessStaticEgressChannels("smartstore"), ["smartstore"]);
});

test("Smartstore forward migration releases only Smartstore from static egress", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260831145000_release_smartstore_from_static_egress.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /when p_channel = 'smartstore' then true/);
  assert.match(migration, /p_channel in \('coupang', 'elevenst', 'temu', 'shopee'\)/);
  assert.match(migration, /to_regclass\('supabase_migrations\.schema_migrations'\)/);
  assert.match(migration, /migration\.version >= '20260831143000'/);
  assert.match(migration, /migration\.name = 'ebay_exact_existing_qa_recovery_fence'/);
  assert.match(migration, /Smartstore non-static egress executable preimage drifted/);
  assert.match(migration, /p_channel = 'smartstore' and p_operation = 'inquiries\.list'/);
  assert.match(migration, /if p_channel = 'coupang'[\s\S]*STATIC_EGRESS_REQUIRED/);
  assert.match(migration, /SMARTSTORE_NONSTATIC_EGRESS_V1/);
  const combinedHistoryGate = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_start_inquiry_history_backfill"),
    migration.indexOf("-- Migration-local executable postimage proof"),
  );
  assert.match(combinedHistoryGate, /policy\.channel = 'coupang'[\s\S]*STATIC_EGRESS_REQUIRED/);
  assert.doesNotMatch(combinedHistoryGate, /policy\.channel = 'smartstore'/);
  assert.match(
    migration,
    /sellerpilot_service_serverless_static_egress_status\(\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*to service_role/,
  );
  assert.match(
    migration,
    /sellerpilot_service_enqueue_periodic_sync\([\s\S]*from public, anon, authenticated, service_role[\s\S]*to service_role/,
  );
  assert.match(migration, /serverless_static_egress_allowed\('smartstore'\)[\s\S]*is distinct from true/);
  assert.match(migration, /serverless_static_egress_allowed\('coupang'\)[\s\S]*is distinct from false/);
  assert.match(migration, /v_policy_postimage is distinct from current_setting/);
  assert.doesNotMatch(
    migration,
    /(?:update|delete from) sellerpilot_private\.serverless_static_egress_policy/i,
  );
  assert.doesNotMatch(
    migration,
    /insert into sellerpilot_private\.serverless_static_egress_policy/i,
  );
});

test("Smartstore corrective migration restores fixed egress without enabling policy", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260901120000_restore_smartstore_static_egress_fence.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /p_channel in \('coupang', 'smartstore', 'elevenst', 'temu', 'shopee'\)/);
  assert.match(migration, /p_channel in \('smartstore', 'temu'\)[\s\S]*status', 'fixed_egress_required'/);
  assert.match(migration, /p_channel in \('coupang', 'smartstore'\)[\s\S]*STATIC_EGRESS_REQUIRED/);
  assert.match(migration, /SMARTSTORE_STATIC_EGRESS_RESTORED_V1/);
  assert.match(migration, /where job\.channel = 'smartstore'[\s\S]*job\.operation in \('inquiries\.list', 'inquiries\.reply'\)/);
  assert.doesNotMatch(migration, /set enabled\s*=\s*true/i);
});

test("Smartstore replies and channel writes fail before enqueue without both runtime and DB attestation", async () => {
  const [replyRoute, operationRoute] = await Promise.all([
    readFile(new URL("../app/api/admin/cs/reply/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(replyRoute, /channel === "coupang" \|\| channel === "smartstore"/);
  assert.match(replyRoute, /sellerpilot_service_serverless_static_egress_status/);
  assert.match(replyRoute, /databasePolicy\?\.\[channel\] !== true/);
  assert.match(operationRoute, /if \(channel === "smartstore"\)/);
  assert.match(operationRoute, /hasServerlessStaticEgressFor\([\s\S]*?\["smartstore"\]/);
  assert.match(operationRoute, /databasePolicy\.smartstore !== true/);
  assert.match(operationRoute, /mode: "static_egress_required"/);
  assert.match(operationRoute, /mode: "serverless_worker_required"/);
});

test("Shopee static egress migration preserves prior flags and closes both claim paths", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260830200000_require_static_egress_for_shopee.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /values \('shopee', false\)[\s\S]*on conflict \(channel\) do nothing/);
  assert.match(migration, /p_channel in \('coupang', 'smartstore', 'elevenst', 'temu', 'shopee'\)/);
  assert.match(migration, /'shopee', coalesce\(bool_or\(policy\.enabled\)/);
  assert.match(migration, /sellerpilot_183000_claim_serverless_gateway_unsafe/);
  assert.match(migration, /job\.channel not in \('coupang', 'smartstore', 'elevenst', 'temu', 'shopee'\)/);
  assert.match(migration, /sellerpilot_11820_claim_gateway_unsafe/);
  assert.match(
    migration,
    /j\.channel = 'shopee'[\s\S]*serverless_gateway_job_allowed\([\s\S]*j\.channel in \('coupang', 'smartstore', 'elevenst', 'temu'\)/,
  );
  assert.equal((migration.match(/v_old_count = 0 and v_new_count = 1/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /update sellerpilot_private\.serverless_static_egress_policy[\s\S]*shopee/i);
});

test("Shopee OAuth and channel operations fail before enqueue when runtime readiness is unavailable", async () => {
  const [oauthRoute, channelOperationsRoute] = await Promise.all([
    readFile(
      new URL("../app/api/admin/channel-credentials/shopee/authorize/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(oauthRoute, /async function shopeeStaticEgressReady[\s\S]*sellerpilot_service_serverless_static_egress_status/);
  assert.match(oauthRoute, /async function shopeeGatewayWorkerReady[\s\S]*sellerpilot_service_serverless_cs_wakeup_status/);
  assert.match(oauthRoute, /hasServerlessStaticEgressFor\(configuredServerlessStaticEgressChannels\(\), \["shopee"\]\)/);
  assert.match(oauthRoute, /databaseServerlessStaticEgressAllows\(data, "shopee"\)/);
  assert.match(oauthRoute, /runtimeState\.configured === true[\s\S]*runtimeState\.active === true/);
  assert.match(oauthRoute, /if \(oauthCode\) {[\s\S]*shopeeOAuthGatewayBlocked\(serviceClient/);
  assert.match(oauthRoute, /if \(parsed\.data\.startOAuth\) {[\s\S]*shopeeOAuthGatewayBlocked\(serviceClient/);
  assert.match(oauthRoute, /blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED/);
  assert.match(oauthRoute, /blockedReason: "SERVERLESS_WORKER_REQUIRED"/);
  assert.ok(
    oauthRoute.indexOf("const blocked = await shopeeOAuthGatewayBlocked")
      < oauthRoute.indexOf("exchangeOAuthViaChannelGateway({"),
  );
  assert.match(channelOperationsRoute, /const staticEgressChannel = channel === "shopee"/);
  assert.match(channelOperationsRoute, /databasePolicy\[staticEgressChannel\] !== true/);
  assert.ok(
    channelOperationsRoute.indexOf("const staticEgressChannel")
      < channelOperationsRoute.indexOf("executeViaChannelGateway({"),
  );
});

test("Temu periodic inquiry gate composes after the eBay wrapper with closed predecessor ACL", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260831045000_gate_temu_periodic_inquiry_static_egress.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /rename to sellerpilot_310450_enqueue_periodic_sync_unsafe/);
  assert.match(migration, /p_channel = 'temu'[\s\S]*p_operation = 'inquiries\.list'/);
  assert.match(migration, /from sellerpilot_private\.serverless_static_egress_policy policy/);
  assert.match(migration, /'status', 'fixed_egress_required'[\s\S]*'blockedReason', 'STATIC_EGRESS_REQUIRED'/);
  assert.match(migration, /return public\.sellerpilot_310450_enqueue_periodic_sync_unsafe/);
  assert.match(
    migration,
    /sellerpilot_310450_enqueue_periodic_sync_unsafe\([\s\S]*?from public, anon, authenticated, service_role/,
  );
  assert.match(migration, /sellerpilot_service_enqueue_periodic_sync\([\s\S]*?to service_role/);
  assert.doesNotMatch(migration, /update sellerpilot_private\.serverless_static_egress_policy/i);
});

test("manual sync and the 30-day UI disclose static egress blocking without local fallback", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("../app/api/operations/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /status === "fixed_egress_required"/);
  assert.match(route, /staticEgressReady: false/);
  assert.match(route, /blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED/);
  assert.match(route, /status: "blocked"/);
  assert.match(route, /queuedJobs: 0/);
  assert.match(route, /서버 스케줄러에서 처리합니다/);
  assert.doesNotMatch(route, /로컬 스케줄러에서 처리합니다/);
  const inquiryFlow = route.slice(
    route.indexOf("const inquiryResults"),
    route.indexOf("const push ="),
  );
  const unsupportedBranch = inquiryFlow.indexOf("if (!requests.length)");
  const temuEgressGate = inquiryFlow.indexOf('channel === "temu" && !hasServerlessStaticEgressFor');
  const inquiryEnqueue = inquiryFlow.indexOf('p_operation: "inquiries.list"');
  assert.ok(unsupportedBranch >= 0 && unsupportedBranch < temuEgressGate);
  assert.ok(temuEgressGate < inquiryEnqueue);
  assert.match(inquiryFlow, /hasServerlessStaticEgressFor\(staticEgressChannels, \["temu"\]\)/);
  assert.match(inquiryFlow, /status: "fixed_egress_required" as const,[\s\S]*queuedJobs: 0,[\s\S]*pendingJobs: 0/);
  assert.match(route, /Temu·쿠팡·스마트스토어 조회에는 판매채널에 등록된 Vercel 고정 egress 설정이 필요합니다/);
  assert.match(
    route,
    /쿠팡·스마트스토어 문의 조회에는 각 판매채널에 등록된 Vercel 고정 egress 설정이 필요합니다[\s\S]*두 채널의 30일 작업/,
  );
  assert.match(route, /fixedEgressRequired \? \{ blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED \} : \{\}/);
  assert.match(page, /Vercel 고정 egress 설정 필요/);
  assert.match(page, /작업을 접수하거나 자동 재시도하지 않습니다/);
  assert.match(page, /if \(parsedBackfill\) setInquiryHistoryBackfill\(parsedBackfill\)/);
});
