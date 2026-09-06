import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("product and category bootstrap requests are bounded, abortable, and latest-request fenced", async () => {
  const [publish, category, targets] = await Promise.all([
    source("../app/product-publish-workbench.tsx"),
    source("../app/category-classification-workbench.tsx"),
    source("../app/channel-target-client.ts"),
  ]);

  assert.match(publish, /publishContextRequestTimeoutMs = 30_000/);
  assert.match(publish, /loadRequestRef\.current\?\.controller\.abort/);
  assert.match(publish, /const isLatestRequest = \(\) => mountedRef\.current/);
  assert.match(publish, /waitForAbortablePromise\(supabase\.auth\.getSession\(\), bounded\.signal\)/);
  assert.match(publish, /finally \{[\s\S]*bounded\.dispose\(\);[\s\S]*setLoading\(false\)/);

  assert.match(category, /categoryBootstrapRequestTimeoutMs = 30_000/);
  assert.match(category, /bootstrapGenerationRef/);
  assert.match(category, /Promise\.allSettled/);
  assert.match(category, /finally \{[\s\S]*bounded\.dispose\(\);[\s\S]*setLoadingCredentials\(false\)/);
  assert.match(category, /setBootstrapVersion\(\(current\) => current \+ 1\)/);

  assert.match(targets, /pendingTargetRequests\.delete\(channel\)/);
  assert.match(targets, /pending\.controller\.signal\.aborted/);
  assert.match(targets, /options\.signal/);
});

test("operations snapshot composes auth, fetch, and body parsing with the bounded coordinator signal", async () => {
  const snapshot = await source("../app/use-operations-snapshot.ts");

  assert.match(snapshot, /operationsSnapshotRequestTimeoutMs = 30_000/);
  assert.match(snapshot, /OPERATIONS_TIMEOUT_RETRY_LIMIT = 2/);
  assert.match(snapshot, /failureMessage.includes\("30초를 초과"\)/);
  assert.match(snapshot, /waitForAbortablePromise\(sessionPromise, init\.signal\)/);
  assert.match(snapshot, /headers\.set\("authorization", `Bearer \$\{accessToken\}`\)/);
  assert.match(snapshot, /createBoundedRequestSignal\([\s\S]*request\.signal/);
  assert.match(snapshot, /signal: bounded\.signal/);
  assert.match(snapshot, /finally \{[\s\S]*bounded\.dispose\(\)/);
});

test("ambiguous AI admission locks and reconciles the original job id before allowing a new UUID", async () => {
  const studio = await source("../app/ai-product-studio.tsx");
  const postIndex = studio.indexOf('fetchJsonWithStudioJobTimeout("/api/ai/product-studio"');
  const persistIndex = studio.lastIndexOf("persistActiveStudioJob(jobId, studioSessionId)", postIndex);
  const lockIndex = studio.lastIndexOf("queuedOwnJobIdRef.current = jobId", postIndex);

  assert.ok(postIndex > 0);
  assert.ok(persistIndex > 0 && persistIndex < postIndex);
  assert.ok(lockIndex > persistIndex && lockIndex < postIndex);
  assert.match(studio, /setSubmissionPhase\("reconciling"\)/);
  assert.match(studio, /monitorOwnStudioJob\(queuedJob, accessToken, true\)/);
  assert.match(studio, /notFoundGraceMs: reconcileAdmission \? studioJobAdmissionGraceMs : 0/);
  assert.match(studio, /if \(response\.status === 404 && Date\.now\(\) < notFoundDeadline\)/);
  assert.match(studio, /if \(error instanceof StudioJobTerminalError\)[\s\S]*releaseOwnJob\(job\.jobId\)/);
  assert.match(studio, /const jobId = queuedOwnJobIdRef\.current/);
  assert.match(studio, /기존 작업 상태 다시 확인/);
  assert.doesNotMatch(studio, /\.finally\(\(\) => \{[\s\S]{0,200}setQueuedOwnJobId/);

  const retryStart = studio.indexOf("const retryOwnJobStatus");
  const retryEnd = studio.indexOf("const regenerateAsset", retryStart);
  const retrySource = studio.slice(retryStart, retryEnd);
  assert.match(retrySource, /queuedOwnJobIdRef\.current/);
  assert.doesNotMatch(retrySource, /crypto\.randomUUID/);
});
