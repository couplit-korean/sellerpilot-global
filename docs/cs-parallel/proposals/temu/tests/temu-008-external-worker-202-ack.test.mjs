import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const integrationRoot = process.env.TEMU_ACCEPTANCE_ROOT
  ? path.resolve(process.env.TEMU_ACCEPTANCE_ROOT)
  : path.resolve(new URL("../../../../../", import.meta.url).pathname);
const lifecyclePath = path.join(integrationRoot, "scripts/worker-lifecycle-retry.mjs");
const workerPath = path.join(integrationRoot, "scripts/ai-cli-worker.mjs");
const {
  requestWithTransientRetry,
  GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
} = await import(pathToFileURL(lifecyclePath).href);
const workerSource = await readFile(workerPath, "utf8");

test("external worker accepts Temu retry HTTP 202 exactly once without treating provider read as success", async () => {
  let requests = 0;
  let delays = 0;
  const response = await requestWithTransientRetry({
    request: async () => {
      requests += 1;
      return Response.json({
        completionStatus: "retry_scheduled",
        jobCompleted: false,
        providerReadSucceeded: false,
        retryScheduled: true,
        retryReceiptReplayed: false,
        retryCount: 1,
        retryAfterSeconds: 5,
      }, {
        status: 202,
        headers: { "retry-after": "5" },
      });
    },
    delay: async () => {
      delays += 1;
      throw new Error("HTTP 202 must not enter transient completion retry");
    },
    graceMs: GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    terminalStatuses: [401, 409],
    label: "Temu channel completion",
  });

  assert.equal(requests, 1);
  assert.equal(delays, 0);
  assert.equal(response.status, 202);
  assert.equal(response.ok, true);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    completionStatus: "retry_scheduled",
    jobCompleted: false,
    providerReadSucceeded: false,
    retryScheduled: true,
    retryReceiptReplayed: false,
    retryCount: 1,
    retryAfterSeconds: 5,
  });

  const persistStart = workerSource.indexOf("async function persistWorkerCompletion");
  const persistEnd = workerSource.indexOf("const codexOutputLimitBytes", persistStart);
  const persistSource = workerSource.slice(persistStart, persistEnd);
  assert.match(persistSource, /return await requestWithTransientRetry/);
  assert.match(persistSource, /terminalStatuses: \[401, 409\]/);

  const gatewayStart = workerSource.indexOf("async function processGatewayJob");
  const gatewayEnd = workerSource.indexOf("async function runWorkerLoop", gatewayStart);
  const gatewaySource = workerSource.slice(gatewayStart, gatewayEnd);
  assert.match(gatewaySource, /completionStatus === "failed"[\s\S]*job\.channel === "temu"[\s\S]*retryContinuation/);
  assert.match(gatewaySource, /if \(result\.ok\) console\.log/);
  assert.match(gatewaySource, /else console\.error/);
});
