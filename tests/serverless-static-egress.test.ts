import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasServerlessStaticEgressFor,
  parseServerlessStaticEgressChannels,
  serverlessStaticEgressHeaderValue,
} from "../lib/channels/serverless-static-egress";

test("serverless static egress is disabled by default and on unknown values", () => {
  assert.deepEqual(parseServerlessStaticEgressChannels(undefined), []);
  assert.deepEqual(parseServerlessStaticEgressChannels(""), []);
  assert.deepEqual(parseServerlessStaticEgressChannels("coupang,unknown"), []);
});

test("serverless static egress accepts only explicit supported channels", () => {
  const configured = parseServerlessStaticEgressChannels("temu, shopee, smartstore, elevenst, coupang");
  assert.deepEqual(configured, ["coupang", "smartstore", "elevenst", "temu", "shopee"]);
  assert.equal(
    hasServerlessStaticEgressFor(configured, ["coupang", "smartstore", "elevenst", "temu", "shopee"]),
    true,
  );
  assert.equal(
    serverlessStaticEgressHeaderValue(configured),
    "coupang,smartstore,elevenst,temu,shopee",
  );
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
  assert.match(route, /Temu·쿠팡·스마트스토어 문의 조회에는 Vercel 고정 egress 설정이 필요합니다/);
  assert.match(route, /fixedEgressRequired \? \{ blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED \} : \{\}/);
  assert.match(page, /Vercel 고정 egress 설정 필요/);
  assert.match(page, /작업을 접수하거나 자동 재시도하지 않습니다/);
  assert.match(page, /if \(parsedBackfill\) setInquiryHistoryBackfill\(parsedBackfill\)/);
});
