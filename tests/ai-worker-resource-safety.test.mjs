import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../scripts/ai-cli-worker.mjs", import.meta.url);
const claimRouteUrl = new URL("../app/api/ai/worker/claim/route.ts", import.meta.url);
const completionRouteUrl = new URL("../app/api/ai/worker/complete/route.ts", import.meta.url);
const jobsRouteUrl = new URL("../app/api/admin/ai-jobs/route.ts", import.meta.url);
const operationsSnapshotRouteUrl = new URL("../app/api/operations/snapshot/route.ts", import.meta.url);
const marketplaceImagesUrl = new URL("../lib/channels/marketplace-images.ts", import.meta.url);
const maintenanceRouteUrl = new URL("../app/api/internal/maintenance/route.ts", import.meta.url);

test("AI worker dispatches support replies, sanitizes failures, and preserves uploaded assets across ambiguous completion", async () => {
  const [source, claimRoute, completionRoute, jobsRoute, operationsSnapshotRoute] = await Promise.all([
    readFile(workerUrl, "utf8"),
    readFile(claimRouteUrl, "utf8"),
    readFile(completionRouteUrl, "utf8"),
    readFile(jobsRouteUrl, "utf8"),
    readFile(operationsSnapshotRouteUrl, "utf8"),
  ]);
  assert.match(source, /job\.kind === "support_reply"[\s\S]{0,900}draftSupportReply/);
  assert.match(source, /--output-schema", supportReplySchemaPath/);
  assert.match(source, /completionPersistenceStarted = true;[\s\S]{0,180}persistWorkerCompletion/);
  assert.match(source, /const preserveRemoteState = completionPersistenceStarted/);
  assert.match(source, /const message = sellerSafeAiJobFailure\(effectiveError\)/);
  assert.match(completionRoute, /p_error_message: completion\.status === "failed" \? sellerSafeAiJobFailure\(completion\.error\) : null/);
  assert.match(jobsRoute, /error_message: row\.error_message \? sellerSafeAiJobFailure\(row\.error_message\) : null/);
  assert.match(operationsSnapshotRoute, /message: isAiActivity && row\.message \? sellerSafeAiJobFailure\(row\.message\) : row\.message/);
  assert.match(claimRoute, /sellerpilot_service_stage_ai_result_uploads/);
  assert.match(claimRoute, /p_job_id: jobId/);
  assert.match(claimRoute, /p_claim_token: claimToken/);
  assert.ok(
    claimRoute.indexOf("const stagingFailure = await stageResultUploads(assetPaths.map")
      < claimRoute.indexOf("resultUploads: assetPaths.map"),
    "result destinations must be staged before the worker receives upload metadata",
  );
  assert.doesNotMatch(claimRoute, /createSignedUploadUrl/);
  assert.doesNotMatch(claimRoute, /token: upload\.token/);
});

test("Codex subprocess output and termination are bounded", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /const codexOutputLimitBytes = 1024 \* 1024/);
  assert.match(source, /appendBoundedOutput/);
  assert.match(source, /child\.kill\("SIGTERM"\)/);
  assert.match(source, /child\.kill\("SIGKILL"\)/);
  assert.ok(source.indexOf("child.kill(\"SIGKILL\")") < source.indexOf("child.once(\"close\""));
});

test("Codex subprocesses use a bounded FIFO gate and measure timeout only after dequeue", async () => {
  const source = await readFile(workerUrl, "utf8");
  const runStart = source.indexOf("async function runCodex(");
  const runEnd = source.indexOf("\nconst loginStatus", runStart);
  const runCodex = source.slice(runStart, runEnd);

  assert.match(source, /SELLERPILOT_IMAGE_TIMEOUT_MS \?\? 20 \* 60_000/);
  assert.match(source, /SELLERPILOT_ANALYSIS_TIMEOUT_MS \?\? 12 \* 60_000/);
  assert.match(source, /SELLERPILOT_STUDIO_MASTER_TIMEOUT_MS \?\? 25 \* 60_000/);
  assert.match(source, /SELLERPILOT_STUDIO_LOCALIZED_TIMEOUT_MS \?\? 12 \* 60_000/);
  assert.match(source, /stage: "support-reply" \}\);/);
  assert.match(source, /stage: "studio-master"/);
  assert.match(source, /createStudioMasterInvocationBudget\(\s*studioMasterTimeoutMs,\s*codexTerminationGraceMs/);
  assert.match(source, /studioMasterTimeoutMs = Math\.min\(\s*25 \* 60_000/);
  assert.match(source, /timeoutMs: studioLocalizedTimeoutMs/);
  assert.match(source, /SELLERPILOT_CODEX_CONCURRENCY \?\? 2/);
  assert.match(source, /const codexConcurrencyLimit = Math\.min\(4, Math\.max\(1,/);
  assert.match(runCodex, /const queuedAt = Date\.now\(\)/);
  assert.match(runCodex, /codexExecutionGate\.run/);
  assert.match(runCodex, /codexExecutionGate\.run[\s\S]+if \(jobId\) await touchJob\(jobId, claimToken\)/);
  assert.ok(
    runCodex.indexOf("codexExecutionGate.run") < runCodex.indexOf("if (jobId) await touchJob(jobId, claimToken)"),
    "ownership must be checked after the FIFO slot is granted",
  );
  assert.match(runCodex, /leaseSignal\?\.aborted/);
  assert.match(runCodex, /\[Codex 시작\][^\n]+\$\{stage\}[^\n]+wait=\$\{queueWaitMs\}ms/);
  assert.ok(
    runCodex.indexOf("codexExecutionGate.run") < runCodex.indexOf("const timeoutTimer = setTimeout"),
    "queue wait must happen before the subprocess timeout starts",
  );
  assert.doesNotMatch(runCodex, /console\.(?:log|error)\([^\n]*(?:args|stdout|stderr|codexEnv)/);
});

test("worker tokens are selected by endpoint scope without exposing token values", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /SELLERPILOT_AI_WORKER_TOKEN/);
  assert.match(source, /SELLERPILOT_GATEWAY_WORKER_TOKEN/);
  assert.match(source, /SELLERPILOT_SCHEDULER_WORKER_TOKEN/);
  assert.match(source, /path\.startsWith\("\/api\/channel-gateway\/"\)/);
  assert.match(source, /path\.startsWith\("\/api\/internal\/"\)/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:aiWorkerToken|gatewayWorkerToken|schedulerWorkerToken)/);
});

test("studio claim forwards only validated bounded competitor evidence", async () => {
  const source = await readFile(claimRouteUrl, "utf8");
  assert.match(source, /studioCompetitorContextSchema\.safeParse\(rawCompetitorContext\)/);
  assert.match(source, /safeReason: "invalid_competitor_context"/);
  assert.match(source, /competitorContext: parsedCompetitorContext\.data/);
});

test("marketplace image fetch pins DNS and streams through a byte cap", async () => {
  const source = await readFile(marketplaceImagesUrl, "utf8");
  assert.match(source, /hostname: target\.address/);
  assert.match(source, /servername: isIP\(target\.hostname\)/);
  assert.match(source, /collectBoundedMarketplaceImage\(response\)/);
  const downloadBody = source.match(/export async function downloadMarketplaceImage[\s\S]*?\n}\n\nasync function downloadImage/)?.[0] ?? "";
  assert.doesNotMatch(downloadBody, /arrayBuffer\(/);
});

test("maintenance uses a durable storage cleanup claim before reporting success", async () => {
  const source = await readFile(maintenanceRouteUrl, "utf8");
  assert.match(source, /sellerpilot_service_claim_ai_storage_cleanup/);
  assert.match(source, /sellerpilot_service_complete_ai_storage_cleanup/);
  assert.match(source, /p_removed_paths: removedPaths/);
  assert.match(source, /status: 502/);
  assert.ok(
    source.indexOf("sellerpilot_prune_ai_jobs")
      < source.indexOf("cleanupPrunedAiStorage(serviceClient)"),
  );
});
