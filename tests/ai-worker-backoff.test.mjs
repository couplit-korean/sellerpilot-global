import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canRunGatewayClaim,
  canRunPeriodicChannelSync,
  isWorkerTokenConfigured,
  WORKER_AUTH_BACKOFF_MS,
  WORKER_TRANSIENT_BACKOFF_MS,
  workerClaimBackoffMs,
  workerFailureBackoffMs,
} from "../scripts/worker-claim-backoff.mjs";

test("worker claim backoff distinguishes authentication and transient failures", () => {
  assert.equal(WORKER_AUTH_BACKOFF_MS, 5 * 60_000);
  assert.equal(WORKER_TRANSIENT_BACKOFF_MS, 60_000);
  assert.equal(workerClaimBackoffMs(401), WORKER_AUTH_BACKOFF_MS);
  assert.equal(workerClaimBackoffMs(503), WORKER_TRANSIENT_BACKOFF_MS);
  assert.equal(workerClaimBackoffMs(500), 0);
  assert.equal(workerFailureBackoffMs(401), WORKER_AUTH_BACKOFF_MS);
  assert.equal(workerFailureBackoffMs(503), WORKER_TRANSIENT_BACKOFF_MS);
  assert.equal(workerFailureBackoffMs(500), WORKER_TRANSIENT_BACKOFF_MS);
});

test("worker scope gates reject missing or malformed dedicated tokens before polling", () => {
  const validToken = `spw_${"a".repeat(43)}`;
  assert.equal(isWorkerTokenConfigured(validToken), true);
  assert.equal(isWorkerTokenConfigured(""), false);
  assert.equal(isWorkerTokenConfigured("spw_short"), false);
  assert.equal(isWorkerTokenConfigured(`spw_${"a".repeat(42)}!`), false);
  assert.equal(isWorkerTokenConfigured(`spw_${"a".repeat(44)}`), false);

  assert.equal(canRunGatewayClaim({
    configured: false,
    activeGatewayJobs: 0,
    maxGatewayConcurrency: 2,
    now: 100,
    claimBackoffUntil: 0,
    authBackoffUntil: 0,
  }), false);
  assert.equal(canRunPeriodicChannelSync({
    once: false,
    gatewayConfigured: true,
    schedulerConfigured: false,
    queueIdle: true,
    activeGatewayJobs: 0,
    now: 100,
    nextPeriodicSyncAt: 0,
    schedulerBackoffUntil: 0,
  }), false);
  assert.equal(canRunPeriodicChannelSync({
    once: false,
    gatewayConfigured: true,
    schedulerConfigured: true,
    queueIdle: false,
    activeGatewayJobs: 0,
    now: 100,
    nextPeriodicSyncAt: 0,
    schedulerBackoffUntil: 0,
  }), false);
});

test("AI worker claim applies the shared backoff without reducing the daemon delay to ten seconds", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");

  assert.match(worker, /let aiClaimBackoffUntil = 0/);
  assert.match(worker, /const backoffMs = workerClaimBackoffMs\(response\.status\)/);
  assert.match(worker, /if \(response\.status === 401\) deferWorkerScope\("ai", response\.status\)/);
  assert.match(worker, /Date\.now\(\) < authBackoffUntil\.ai/);
  assert.match(worker, /Date\.now\(\) < aiClaimBackoffUntil/);
  assert.match(worker, /response\.status === 426[\s\S]*?aiClaimBackoffUntil = Date\.now\(\) \+ 5 \* 60_000/);
  assert.match(worker, /AI 작업자 버전이 오래되었습니다/);
});

test("gateway scheduling is scope-isolated, queue-idle gated, and cannot starve AI claims", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(worker, /SellerPilot Gateway Worker"\) \|\| aiWorkerToken/);
  assert.doesNotMatch(worker, /SellerPilot Scheduler Worker"\) \|\| aiWorkerToken/);
  assert.match(worker, /const aiWorkerConfigured = isWorkerTokenConfigured\(aiWorkerToken\)/);
  assert.match(worker, /const gatewayWorkerConfigured = isWorkerTokenConfigured\(gatewayWorkerToken\)/);
  assert.match(worker, /const schedulerWorkerConfigured = isWorkerTokenConfigured\(schedulerWorkerToken\)/);
  assert.match(worker, /if \(!aiWorkerConfigured\) \{/);
  assert.match(worker, /Worker scopes · ai=\$\{aiWorkerConfigured \? "configured" : "disabled"\}/);
  assert.match(worker, /let gatewayQueueIdle = false/);
  assert.match(worker, /canRunPeriodicChannelSync\([\s\S]{0,300}gatewayConfigured: gatewayWorkerConfigured[\s\S]{0,180}schedulerConfigured: schedulerWorkerConfigured[\s\S]{0,180}queueIdle: gatewayQueueIdle/);
  assert.match(worker, /canRunGatewayClaim\([\s\S]{0,240}configured: gatewayWorkerConfigured/);
  assert.match(worker, /gatewayResponse\.status === 204 && activeGatewayJobs\.size === 0\) gatewayQueueIdle = true/);
  assert.match(worker, /SELLERPILOT_CHANNEL_WORKER_CONCURRENCY \?\? 2/);
  assert.match(worker, /Math\.min\(4,[\s\S]{0,180}: 2\)/);
  assert.match(worker, /deferTransientClaims\(workerScopeForPath\(path\), error\.status\)/);
  assert.match(worker, /catch \(gatewayClaimError\)[\s\S]{0,300}workerFailureBackoffMs\(0\)/);

  const gatewayCapacityWait = worker.indexOf("if (activeGatewayJobs.size >= maxGatewayConcurrency)");
  assert.equal(gatewayCapacityWait, -1);
  const onceGatewayWait = worker.indexOf("if (once && activeGatewayJobs.size >= maxGatewayConcurrency)");
  const aiClaim = worker.indexOf('api("/api/ai/worker/claim"', onceGatewayWait);
  assert.ok(onceGatewayWait >= 0 && aiClaim > onceGatewayWait);
  assert.doesNotMatch(worker.slice(onceGatewayWait, aiClaim), /Promise\.race/);
  assert.doesNotMatch(worker.slice(onceGatewayWait, aiClaim), /catch \(gatewayClaimError\)[\s\S]*?if \(!once\) throw/);
});

test("AI claim route bounds Supabase RPCs and preserves 401 versus 503 semantics", async () => {
  const route = await readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8");

  assert.match(route, /global: \{ fetch: createBoundedSupabaseFetch\(\) \}/);
  assert.match(route, /const status = workerRpcErrorStatus\(error\)/);
  assert.match(route, /workerRpcErrorMessage\(status\)/);
  assert.match(route, /if \(!workerToken\.startsWith\("spw_"\) \|\| workerToken\.length < 24\)[\s\S]*?status: 401/);
  assert.match(route, /if \(!supabaseUrl \|\| !secretKey\)[\s\S]*?workerRpcErrorMessage\(503\)[\s\S]*?status: 503/);
  assert.doesNotMatch(route, /if \(error\) return NextResponse\.json\([^\n]+status: 401/);
  assert.doesNotMatch(route, /!workerToken\.startsWith\("spw_"\) \|\| !supabaseUrl \|\| !secretKey/);
  assert.match(route, /supportsLiveResultUploadAuthorization\(version\)/);
  assert.match(route, /minimumVersion: "sellerpilot-cli-worker\/1\.43"/);
  assert.match(route, /status: 426/);
  assert.ok(
    route.indexOf("supportsLiveResultUploadAuthorization(version)")
      < route.indexOf('serviceClient.rpc("sellerpilot_claim_ai_job"'),
    "obsolete workers must be rejected before claiming a queued job",
  );
});

test("AI claim route compensates every post-claim preparation failure", async () => {
  const route = await readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8");

  assert.match(route, /sellerpilot_service_release_ai_job_claim/);
  assert.match(route, /p_retry_after_seconds: 60/);
  assert.match(route, /sellerpilot_complete_ai_job/);
  assert.match(route, /p_status: "failed"/);
  assert.match(route, /catch \(preparationError\)[\s\S]*?safeReason: "claim_preparation_exception"/);
  assert.equal(route.match(/return preparationFailure\(\{/g)?.length, 9);
  assert.match(route, /safeReason: "invalid_competitor_context"/);
  assert.match(route, /safeReason: "invalid_source_image_provenance"/);
  assert.match(route, /safeReason: "source_image_signing_incomplete"/);
  assert.match(route, /safeReason: "comparison_image_signing_incomplete"/);
  assert.ok(
    route.indexOf('safeReason: "invalid_asset_regeneration_payload"')
      < route.indexOf(".createSignedUrls(sourcePaths, 10 * 60)"),
    "deterministic invalid asset payload must fail before any storage preparation",
  );
  assert.match(route, /if \(!compensated\)[\s\S]*?status: 503/);
});

test("AI claim preparation compensation has an independent terminal failure budget", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260825103015_compensate_unprepared_ai_worker_claims.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /preparation_failure_count integer not null default 0/);
  assert.match(migration, /check \(preparation_failure_count between 0 and 3\)/);
  assert.match(migration, /preparation_failure_count = least\(j\.preparation_failure_count \+ 1, 3\)/);
  assert.match(migration, /status = case when j\.preparation_failure_count \+ 1 >= 3 then 'failed' else 'queued' end/);
  assert.match(migration, /completed_at = case when j\.preparation_failure_count \+ 1 >= 3 then now\(\) else null end/);
  assert.match(migration, /case when v_terminal then 'job_failed' else 'job_retried' end/);
  assert.match(migration, /'preparation_failure_count', v_preparation_failure_count/);
});
