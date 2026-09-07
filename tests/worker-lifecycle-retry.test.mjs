import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_HEARTBEAT_INTERVAL_MS,
  AI_HEARTBEAT_TRANSIENT_GRACE_MS,
  GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
  requestWithTransientRetry,
  WORKER_COMPLETION_TRANSIENT_GRACE_MS,
  WorkerRequestTerminalError,
} from "../scripts/worker-lifecycle-retry.mjs";

function fakeClock() {
  let value = 0;
  return {
    now: () => value,
    delay: async (ms) => { value += ms; },
  };
}

test("worker lifecycle retry windows stay below the database leases", () => {
  assert.equal(AI_HEARTBEAT_INTERVAL_MS, 20_000);
  assert.equal(AI_HEARTBEAT_TRANSIENT_GRACE_MS, 2 * 60_000);
  assert.equal(GATEWAY_COMPLETION_TRANSIENT_GRACE_MS, 10 * 60_000);
  assert.ok(AI_HEARTBEAT_TRANSIENT_GRACE_MS < 15 * 60_000);
  assert.ok(WORKER_COMPLETION_TRANSIENT_GRACE_MS < 15 * 60_000);
  assert.ok(GATEWAY_COMPLETION_TRANSIENT_GRACE_MS < 15 * 60_000);
});

test("transient 5xx and transport loss retry before returning the successful response", async () => {
  const clock = fakeClock();
  const responses = [
    new Response(null, { status: 503 }),
    null,
    new Response(null, { status: 200 }),
  ];
  const attempts = [];
  const response = await requestWithTransientRetry({
    request: async () => {
      const next = responses.shift();
      if (!next) throw new Error("response lost");
      return next;
    },
    delay: clock.delay,
    graceMs: 30_000,
    terminalStatuses: [401, 409],
    label: "completion",
    now: clock.now,
    onTransient: (attempt) => attempts.push(attempt),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(attempts.map((attempt) => attempt.waitMs), [2_000, 4_000]);
});

for (const status of [401, 409]) {
  test(`terminal completion HTTP ${status} is not retried`, async () => {
    const clock = fakeClock();
    let requests = 0;
    await assert.rejects(
      requestWithTransientRetry({
        request: async () => {
          requests += 1;
          return new Response(null, { status });
        },
        delay: clock.delay,
        graceMs: 30_000,
        terminalStatuses: [401, 409],
        label: "completion",
        now: clock.now,
      }),
      (error) => error instanceof WorkerRequestTerminalError
        && error.status === status
        && error.reconciliation === (status === 409),
    );
    assert.equal(requests, 1);
  });
}

test("provider fence HTTP 412 is a pre-provider failure, not terminal ownership loss", async () => {
  const clock = fakeClock();
  let requests = 0;
  await assert.rejects(
    requestWithTransientRetry({
      request: async () => {
        requests += 1;
        return new Response(null, { status: 412 });
      },
      delay: clock.delay,
      graceMs: 30_000,
      terminalStatuses: [401, 409],
      label: "provider mutation fence",
      now: clock.now,
    }),
    (error) => error instanceof Error
      && !(error instanceof WorkerRequestTerminalError)
      && /HTTP 412/.test(error.message),
  );
  assert.equal(requests, 1);
});

test("missing heartbeat job HTTP 404 is terminal and is not retried", async () => {
  const clock = fakeClock();
  let requests = 0;
  await assert.rejects(
    requestWithTransientRetry({
      request: async () => {
        requests += 1;
        return new Response(null, { status: 404 });
      },
      delay: clock.delay,
      graceMs: 30_000,
      terminalStatuses: [401, 404],
      label: "heartbeat",
      now: clock.now,
    }),
    (error) => error instanceof WorkerRequestTerminalError && error.status === 404,
  );
  assert.equal(requests, 1);
});

test("continuous transient failures stop inside the configured grace window", async () => {
  const clock = fakeClock();
  let requests = 0;
  await assert.rejects(
    requestWithTransientRetry({
      request: async () => {
        requests += 1;
        return new Response(null, { status: 503 });
      },
      delay: clock.delay,
      graceMs: 3_000,
      terminalStatuses: [401, 404],
      label: "heartbeat",
      now: clock.now,
    }),
    (error) => error instanceof WorkerRequestTerminalError
      && error.status === 503
      && error.reconciliation === true,
  );
  assert.equal(requests, 3);
  assert.equal(clock.now(), 3_000);
});

test("worker uses lifecycle retry for heartbeat and both completion endpoints", async () => {
  const source = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");

  assert.match(source, /const workerVersion = "sellerpilot-cli-worker\/1\.60"/);
  assert.match(source, /runVisionCutoutWithTransientRetry\(\{[\s\S]*signal: leaseSignal/);
  assert.match(source, /\[원본 픽셀 보호 재시도\] mode=\$\{retryMode\} attempt=\$\{attempt\}/);
  assert.match(source, /const aiOnly = process\.argv\.includes\("--ai-only"\)/);
  assert.match(source, /const gatewayWorkerToken = aiOnly \? "" : loadWorkerToken/);
  assert.match(source, /const schedulerWorkerToken = \(aiOnly \|\| localRecoveryOnly\) \? "" : loadWorkerToken/);
  assert.match(source, /SELLERPILOT_STUDIO_MASTER_TIMEOUT_MS \?\? 35 \* 60_000/);
  assert.match(source, /SELLERPILOT_STUDIO_LOCALIZED_TIMEOUT_MS \?\? 12 \* 60_000/);
  assert.match(source, /stage: "studio-master-repair"/);
  assert.match(source, /stage: `studio-localized\$\{repairSuffix\}:\$\{chunkIndex \+ 1\}`/);
  assert.match(source, /stage: "studio-master-repair-2"/);
  assert.match(source, /if \(jobId\) await touchJob\(jobId, claimToken\)/);
  assert.match(source, /graceMs: AI_HEARTBEAT_TRANSIENT_GRACE_MS/);
  assert.match(source, /terminalStatuses: \[401, 404, 409\]/);
  assert.match(source, /payload\.status !== "running"[^\n]+JobCancelledError/);
  assert.match(source, /AI_HEARTBEAT_INTERVAL_MS/);
  assert.match(source, /const requestBody = JSON\.stringify\(payload\)/);
  assert.match(source, /request: \(\) => api\(path, \{ method: "POST", body: requestBody \}\)/);
  assert.ok((source.match(/persistWorkerCompletion\(\s*"\/api\/ai\/worker\/complete"/g) ?? []).length >= 4);
  assert.ok((source.match(/persistWorkerCompletion\(\s*"\/api\/channel-gateway\/worker\/complete"/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /api\("\/api\/(?:ai|channel-gateway)\/worker\/complete"/);
  assert.match(source, /leaseStateUncertain[\s\S]*effectiveError instanceof WorkerRequestTerminalError[\s\S]*effectiveError instanceof JobCancelledError/);
  const aiProcessStart = source.indexOf("async function processJob(job)");
  const gatewayProcessStart = source.indexOf("async function processGatewayJob(job)");
  const aiProcess = source.slice(aiProcessStart, gatewayProcessStart);
  assert.match(aiProcess, /await jobHeartbeat\.start\(\)/);
  assert.ok((aiProcess.match(/await assertJobLeaseHealthy\(\)/g) ?? []).length >= 7);
  assert.ok((aiProcess.match(/uploadAiResultAsset/g) ?? []).length >= 2);
  assert.match(source, /api\("\/api\/ai\/worker\/result-upload-authorize"/);
  assert.match(source, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
  assert.match(source, /authorizeAiResultUpload[\s\S]*uploadToSignedUrl/);
  assert.doesNotMatch(aiProcess, /upload\.token/);
  assert.match(aiProcess, /await assertJobLeaseHealthy\(\);[\s\S]*await stopJobHeartbeat\(\);[\s\S]*persistWorkerCompletion/);
  assert.match(source, /createLeaseBoundedStorageFetch\(jobHeartbeat\.signal\)/);
});

test("gateway worker heartbeats for the full provider lifecycle and preserves state after ownership loss", async () => {
  const [source, listingRuntime, oauthRuntime] = await Promise.all([
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/provider-listing-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/provider-oauth-runtime.ts", import.meta.url), "utf8"),
  ]);
  const gatewayProcessStart = source.indexOf("async function processGatewayJob(job)");
  const gatewayProcessEnd = source.indexOf("console.log(`SellerPilot ChatGPT CLI worker 시작", gatewayProcessStart);
  const gatewayProcess = source.slice(gatewayProcessStart, gatewayProcessEnd);
  const finalCompletion = gatewayProcess.indexOf('"/api/channel-gateway/worker/complete"');

  assert.match(source, /api\("\/api\/channel-gateway\/worker\/heartbeat"/);
  assert.match(source, /graceMs: AI_HEARTBEAT_TRANSIENT_GRACE_MS/);
  assert.match(source, /terminalStatuses: \[401, 404, 409\]/);
  assert.match(source, /setInterval\(scheduleTouch, AI_HEARTBEAT_INTERVAL_MS\)/);
  assert.match(gatewayProcess, /await gatewayHeartbeat\.start\(\)/);
  assert.match(gatewayProcess, /if \(job\.channel === "temu"\) \{\s*throw new Error\("TEMU_SERVERLESS_ONLY:/);
  assert.ok(gatewayProcess.indexOf("TEMU_SERVERLESS_ONLY") < gatewayProcess.indexOf("let result;"));
  assert.doesNotMatch(source, /api\.ipify\.org|checkip\.amazonaws\.com|SELLERPILOT_TEMU_EGRESS_IPS|SellerPilot Temu Egress IPs/);
  assert.ok((gatewayProcess.match(/await assertGatewayLeaseHealthy\(\)/g) ?? []).length >= 10);
  assert.match(gatewayProcess, /prepareMarketplaceListingArguments\(\{[\s\S]*assertLeaseHealthy: assertGatewayLeaseHealthy[\s\S]*beginProviderMutation: markExternalWriteStarted/);
  assert.match(listingRuntime, /prepareShopeeGlobalListing\(input\)[\s\S]*mediaMutationObserved: true/);
  assert.match(listingRuntime, /await input\.hooks\.assertLeaseHealthy\(\);[\s\S]*await input\.hooks\.beginProviderMutation\(\);[\s\S]*await fetch/);
  assert.match(listingRuntime, /assertPublicReferenceUrl\(imageUrl, \{ signal: input\.signal \}\)[\s\S]*await input\.hooks\.beginProviderMutation\(\)[\s\S]*lazadaRequest/);
  assert.match(gatewayProcess, /await assertGatewayLeaseHealthy\(\);[\s\S]*await stopGatewayHeartbeat\(\);[\s\S]*persistWorkerCompletion/);
  assert.ok(finalCompletion > gatewayProcess.indexOf("await stopGatewayHeartbeat()"));
  assert.match(gatewayProcess, /effectiveError = heartbeatError/);
  assert.match(gatewayProcess, /effectiveError instanceof WorkerRequestTerminalError[\s\S]*\[채널 상태 보존\]/);
  assert.match(gatewayProcess, /const markExternalWriteStarted = async \(\) => \{[\s\S]*"\/api\/channel-gateway\/worker\/begin-mutation"[\s\S]*await assertGatewayLeaseHealthy\(\);[\s\S]*externalWriteStarted = true/);
  const activationContextFence = gatewayProcess.indexOf("const activationArgumentsAreRecord");
  const credentialPreparation = gatewayProcess.indexOf('if (job.channel === "shopee")', activationContextFence);
  const providerMutationFence = gatewayProcess.indexOf("await markExternalWriteStarted();", credentialPreparation);
  assert.ok(activationContextFence > 0);
  assert.ok(credentialPreparation > activationContextFence);
  assert.ok(providerMutationFence > credentialPreparation);
  assert.match(
    gatewayProcess.slice(activationContextFence, credentialPreparation),
    /activationMarkerSupplied !== \(job\.operation === "listing\.activate"\)[\s\S]*job\.channel !== "qoo10"[\s\S]*qoo10S1ActivationArgumentsValid\(operationArguments\)[\s\S]*QOO10_S1_ACTIVATION_SERVER_CONTEXT_REQUIRED/,
  );
  assert.match(gatewayProcess, /if \(writeChannelOperations\.has\(job\.operation\)\) \{[\s\S]*await markExternalWriteStarted\(\);[\s\S]*executeChannelOperation/);
  assert.doesNotMatch(gatewayProcess, /externalWriteStarted \|\|= writeChannelOperations\.has\(job\.operation\)/);
  assert.match(gatewayProcess, /status: "reconciliation_required"/);
  assert.match(gatewayProcess, /"\/api\/channel-gateway\/worker\/credential-refresh"/);
  assert.match(gatewayProcess, /action: "begin"[\s\S]*action: "stage"/);
  assert.match(gatewayProcess, /credentialRefresh = refresh;[\s\S]*await persistWorkerCompletion[\s\S]*credentialMutationInFlight = false/);
  assert.match(gatewayProcess, /reconciliation_required"[\s\S]*credentialRefresh \? \{ credentialRefresh \}/);
  assert.match(gatewayProcess, /!credentialMutationInFlight && credentialRefresh/);
  assert.match(gatewayProcess, /markExternalMutationStarted/);
  assert.match(gatewayProcess, /executeProviderOAuthExchange\(job, \{[\s\S]*beginCredentialMutation: markExternalMutationStarted[\s\S]*stageCredentialRefresh: rememberCredentialRefresh/);
  assert.match(oauthRuntime, /async function exchangeEbayOAuth\([\s\S]*await beginCredentialMutation\(hooks\);[\s\S]*exchangeEbayOAuthToken[\s\S]*recoveryOnly: true[\s\S]*fetchEbayTradingUserIdentity[\s\S]*oauthComplete: true/);
  assert.match(oauthRuntime, /if \(job\.channel === "ebay"\)[\s\S]*exchangeEbayOAuth/);
  assert.match(gatewayProcess, /terminalOwnershipLoss[\s\S]*\[401, 404, 409\]/);
  assert.match(gatewayProcess, /else if \(effectiveError instanceof WorkerRequestTerminalError\)[\s\S]*else \{[\s\S]*status: "failed"/);
  assert.ok((gatewayProcess.match(/GATEWAY_COMPLETION_TRANSIENT_GRACE_MS/g) ?? []).length >= 2);
});

test("Temu has no local Mac egress setup command or keychain status path", async () => {
  const [packageJson, installer] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install-ai-worker-launch-agent.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(packageJson, /ai:worker:temu-egress|configure-temu-egress/);
  assert.doesNotMatch(installer, /Temu Egress IPs|Temu 작업자 허용 IP|keychainTemuEgressIps/);
});

test("live QA script cannot rotate OAuth credentials outside the gateway", async () => {
  const source = await readFile(new URL("../scripts/live-channel-operation.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /\bensure(?:Shopee|Lazada|Ebay)(?:Merchant)?AccessToken\b/);
  assert.doesNotMatch(source, /\bexchange(?:Shopee|Lazada|Ebay)OAuthToken\b/);
  assert.match(source, /LIVE_EXCHANGE_SHOPEE_CODE[\s\S]*Direct OAuth code exchange is disabled/);
  assert.match(source, /LIVE_BOOTSTRAP_SHOPEE_MERCHANT[\s\S]*Direct merchant token bootstrap is disabled/);
  assert.doesNotMatch(source, /sellerpilot_service_refresh_shopee/);
  assert.match(source, /Direct QA reads never rotate OAuth tokens/);
});
