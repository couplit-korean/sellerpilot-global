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
  const configured = parseServerlessStaticEgressChannels("temu, smartstore, elevenst, coupang");
  assert.deepEqual(configured, ["coupang", "smartstore", "elevenst", "temu"]);
  assert.equal(
    hasServerlessStaticEgressFor(configured, ["coupang", "smartstore", "elevenst", "temu"]),
    true,
  );
  assert.equal(
    serverlessStaticEgressHeaderValue(configured),
    "coupang,smartstore,elevenst,temu",
  );
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
