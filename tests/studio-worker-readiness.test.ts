import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveStudioWorkerReadiness,
  studioWorkerHeartbeatFreshnessMs,
} from "../lib/studio-worker-readiness";

const nowMs = Date.parse("2026-08-28T12:00:00.000Z");

function status(lastSeenAt: string | null, scope: "ai" | "legacy_combined" = "ai") {
  return {
    workers: {
      [scope]: {
        label: "must-not-leak",
        fingerprint: "SECRET-FINGERPRINT",
        last_seen_at: lastSeenAt,
      },
    },
  };
}

test("studio admission accepts only a fresh exact AI-scope heartbeat and returns no worker metadata", () => {
  // The worker's normal idle poll can reach 30 seconds plus jitter and a claim
  // request itself is bounded at 30 seconds. Admission must not flap during
  // that healthy interval.
  assert.ok(studioWorkerHeartbeatFreshnessMs > 61_000);
  const ready = resolveStudioWorkerReadiness(status(new Date(nowMs - 5_000).toISOString()), { nowMs });
  assert.equal(ready.available, true);
  assert.equal(ready.reason, "ready");
  assert.doesNotMatch(JSON.stringify(ready), /must-not-leak|SECRET-FINGERPRINT/);

  assert.equal(resolveStudioWorkerReadiness(
    status(new Date(nowMs - studioWorkerHeartbeatFreshnessMs).toISOString()),
    { nowMs },
  ).reason, "heartbeat_stale");
  assert.equal(resolveStudioWorkerReadiness(status(null), { nowMs }).reason, "heartbeat_missing");
  assert.equal(resolveStudioWorkerReadiness(
    status(new Date(nowMs - 1_000).toISOString(), "legacy_combined"),
    { nowMs },
  ).reason, "worker_missing");
  assert.equal(resolveStudioWorkerReadiness(null, { nowMs, statusAvailable: false }).reason, "status_unavailable");
});

test("product studio route and clients fail closed without turning explicit worker absence into reconciliation polling", async () => {
  const [route, regenerateRoute, revisionRoute, readinessServer, studio, page] = await Promise.all([
    readFile(new URL("../app/api/ai/product-studio/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/product-studio/regenerate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/revision/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-product-studio-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  const readinessCheck = route.indexOf("enqueueGuard.readiness = await readServerProductStudioReadiness(admin)");
  const enqueueCall = route.indexOf('admin.userClient.rpc("sellerpilot_create_ai_job"');
  assert.ok(readinessCheck > 0 && readinessCheck < enqueueCall);
  assert.match(route, /code: "AI_WORKER_UNAVAILABLE"[\s\S]{0,180}workerAvailable: false/);
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.doesNotMatch(route, /fingerprint|token_hash|last_seen_at/);
  assert.match(readinessServer, /sellerpilot_ai_runtime_status/);
  assert.match(readinessServer, /getVercelOidcToken/);
  assert.match(readinessServer, /AI_GATEWAY_API_KEY/);
  assert.doesNotMatch(readinessServer, /process\.env\.VERCEL_OIDC_TOKEN/);
  assert.match(readinessServer, /x-vercel-oidc-token/);
  assert.match(readinessServer, /SELLERPILOT_AI_WORKER_TOKEN/);
  assert.match(readinessServer, /snapshot\.scope !== "ai"/);
  assert.match(readinessServer, /"configuration_missing"/);
  assert.match(readinessServer, /"token_missing_or_expired"/);
  assert.match(readinessServer, /"token_mismatch"/);
  assert.doesNotMatch(readinessServer, /message\.includes/);
  assert.match(regenerateRoute, /readServerProductStudioReadiness\(admin\)[\s\S]{0,260}code: "AI_WORKER_UNAVAILABLE"[\s\S]{0,220}status: 503/);
  assert.ok(
    revisionRoute.indexOf("const readiness = await readServerProductStudioReadiness(admin)")
      < revisionRoute.indexOf('admin.userClient.rpc("sellerpilot_create_product_revision_job"'),
  );
  assert.match(revisionRoute, /code: "AI_WORKER_UNAVAILABLE"[\s\S]{0,220}cleanupPending: !cleaned[\s\S]{0,220}status: 503/);
  assert.match(route, /after\(wakeServerProductStudioAfterResponse\)/);
  assert.match(regenerateRoute, /after\(wakeServerProductStudioAfterResponse\)/);
  assert.match(revisionRoute, /after\(wakeServerProductStudioAfterResponse\)/);

  const terminalWorkerRejection = studio.indexOf('queued.code === "AI_WORKER_UNAVAILABLE"');
  const ambiguousAdmission = studio.indexOf("const ambiguousResponse");
  assert.ok(terminalWorkerRejection > 0 && terminalWorkerRejection < ambiguousAdmission);
  assert.match(studio, /workerReadiness\?\.available !== true/);
  assert.match(studio, /workerReadiness\?\.available !== false[\s\S]{0,140}submissionPhase !== "monitoring"[\s\S]{0,180}jobMonitors\.abortAll/);
  assert.match(page, /authenticatedFetch\("\/api\/ai\/product-studio"/);
  assert.match(page, /disabled=\{!studioWorkerAvailable \|\| running/);
  assert.match(page, /서버 AI 연결 필요/);
});

test("product research identifies the Vercel OIDC server path without erasing legacy CLI compatibility", async () => {
  const [route, page, runtime] = await Promise.all([
    readFile(new URL("../app/api/ai/product-research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-product-research.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /mode: "server-research"/);
  assert.match(route, /Vercel 서버 AI가 상품 링크와 설명을 조사/);
  assert.match(runtime, /Output\.object\(\{ schema: serverProductResearchResultSchema \}\)/);
  assert.match(page, /researchResult\.mode === "server-research" \? "Vercel OIDC 서버 AI 상세정보 반영 완료" : "기존 AI 상세정보 반영 완료"/);
  assert.doesNotMatch(page, /이미지·CLI 조사·판매자 확인값/);
  assert.doesNotMatch(page, /"로컬 CLI 상세정보 반영 완료"/);
});
