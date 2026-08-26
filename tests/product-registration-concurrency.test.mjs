import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one queued product does not serialize another product or channel write", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(studio, /readActiveStudioJobs\(\)/);
  assert.match(studio, /for \(const activeJob of activeJobs\)/);
  assert.match(studio, /void finishStudioJob\(activeJob, accessToken, true\)/);
  assert.match(studio, /shouldDisplayStudioJob\(\{/);
  assert.match(studio, /jobMonitors\.abortAll\(\)/);
  assert.match(studio, /처리되는 동안 다른 상품 등록을 바로 시작할 수 있습니다/);
  assert.match(page, /다른 상품 등록/);
  assert.match(workbench, /Promise\.all\(readyChannels\.map/);
});

test("the same product form cannot enqueue a duplicate while its own job is active", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(studio, /if \(generating \|\| generateInFlightRef\.current\) return/);
  assert.match(studio, /if \(queuedOwnJobId \|\| queuedOwnJobIdRef\.current\)[\s\S]{0,300}onRunningChange\(false\)/);
  assert.match(studio, /setQueuedOwnJobId\(queued\.jobId\)/);
  assert.match(studio, /disabled=\{!mainPhoto \|\| generating \|\| Boolean\(queuedOwnJobId\)\}/);
  assert.match(page, /automationStartInFlightRef\.current = true[\s\S]{0,220}setStudioRequestId/);
  assert.match(page, /onRunningChange=\{\(nextRunning\) => \{[\s\S]{0,180}automationStartInFlightRef\.current = nextRunning/);
});

test("a failed orphan analysis retries only its existing AI job before opening recovery", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("const recoverFailedProductAnalysis");
  const end = page.indexOf("const editExternalActionProduct", start);
  const recovery = page.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(recovery, /studioJobRecoveryStorageValue/);
  assert.match(recovery, /authenticatedOperationsFetch\("\/api\/admin\/ai-jobs"/);
  assert.match(recovery, /JSON\.stringify\(\{ jobId, action: "retry" \}\)/);
  assert.match(recovery, /navigate\("publishing"\)/);
  assert.doesNotMatch(recovery, /channel-operations|listing\.create|listing\.update/);
});
