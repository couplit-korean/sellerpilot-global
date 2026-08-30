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
  assert.match(page, /Vercel 고정 egress 설정 필요/);
  assert.match(page, /작업을 접수하거나 자동 재시도하지 않습니다/);
  assert.match(page, /if \(parsedBackfill\) setInquiryHistoryBackfill\(parsedBackfill\)/);
});
