import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createGatewayWorkerHealth,
  resolveGatewayHealthPort,
  resolveGatewayPolling,
  resolveGatewayReadinessStaleMs,
  startGatewayWorkerHealthServer,
} from "../scripts/persistent-worker-health.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = resolve(projectRoot, "scripts/ai-cli-worker.mjs");

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return server.address();
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function runWorkerOnce(environment) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", workerPath, "--gateway-only", "--once"],
      {
        cwd: projectRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`gateway-only worker timed out\nstdout=${stdout}\nstderr=${stderr}`));
    }, 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

test("gateway-only health port and stale-window configuration fail closed", () => {
  assert.equal(resolveGatewayHealthPort({ once: true, environment: {} }), null);
  assert.equal(resolveGatewayHealthPort({ environment: {} }), 8080);
  assert.equal(resolveGatewayHealthPort({ environment: { PORT: "9090" } }), 9090);
  assert.throws(
    () => resolveGatewayHealthPort({ environment: { SELLERPILOT_GATEWAY_HEALTH_PORT: "invalid" } }),
    /integer between 0 and 65535/,
  );
  assert.equal(resolveGatewayReadinessStaleMs({}), 180_000);
  assert.equal(
    resolveGatewayReadinessStaleMs({ SELLERPILOT_GATEWAY_READINESS_STALE_MS: "60000" }),
    60_000,
  );
  assert.throws(
    () => resolveGatewayReadinessStaleMs({ SELLERPILOT_GATEWAY_READINESS_STALE_MS: "59999" }),
    /integer between 60000 and 3600000/,
  );
  assert.deepEqual(resolveGatewayPolling({}), { pollMs: 5_000, maxIdlePollMs: 30_000 });
  assert.deepEqual(resolveGatewayPolling({
    SELLERPILOT_GATEWAY_WORKER_POLL_MS: "4000",
    SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS: "12000",
  }), { pollMs: 4_000, maxIdlePollMs: 12_000 });
  assert.throws(
    () => resolveGatewayPolling({
      SELLERPILOT_GATEWAY_WORKER_POLL_MS: "5000",
      SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS: "4000",
    }),
    /must be greater than or equal/,
  );
});

test("gateway-only liveness stays safe while readiness follows queue connectivity", async () => {
  let now = Date.UTC(2026, 7, 28, 6, 0, 0);
  const health = createGatewayWorkerHealth({
    version: "sellerpilot-cli-worker/test",
    gatewayConfigured: true,
    schedulerConfigured: false,
    staleAfterMs: 1_000,
    now: () => now,
  });
  const running = await startGatewayWorkerHealthServer({
    health,
    port: 0,
    host: "127.0.0.1",
  });
  assert.ok(running);
  const port = running.address.port;

  try {
    let response = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).ready, false);

    health.markLoop();
    health.markGatewayResponse(204);
    health.setActiveGatewayJobs(2);
    response = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(response.status, 200);
    const ready = await response.json();
    assert.equal(ready.ready, true);
    assert.equal(ready.activeGatewayJobs, 2);
    assert.deepEqual(ready.configuredScopes, { gateway: true, scheduler: false });
    assert.deepEqual(ready.capabilities, {
      gatewayQueue: true,
      periodicChannelSync: false,
    });
    assert.equal(JSON.stringify(ready).includes("token"), false);

    now += 1_001;
    response = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(response.status, 503);

    response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).healthy, true);

    health.markGatewayResponse(401);
    response = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(response.status, 503);

    health.markGatewayResponse(204);
    health.markStopping();
    response = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, "stopping");
  } finally {
    await running.close();
  }
});

test("gateway-only once claims the gateway without AI token or local Codex tools", async () => {
  const requests = [];
  const gatewayToken = `spw_${"g".repeat(43)}`;
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.writeHead(204);
    response.end();
  });
  const address = await listen(server);

  try {
    const result = await runWorkerOnce({
      ...process.env,
      SELLERPILOT_URL: `http://127.0.0.1:${address.port}`,
      SELLERPILOT_AI_WORKER_TOKEN: "disabled",
      SELLERPILOT_GATEWAY_WORKER_TOKEN: gatewayToken,
      SELLERPILOT_SCHEDULER_WORKER_TOKEN: "disabled",
      SELLERPILOT_TEMU_EGRESS_IPS: "8.8.8.8",
      SELLERPILOT_GATEWAY_HEALTH_PORT: "",
      PORT: "",
      CODEX_BIN: "/not-installed/codex",
    });

    assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /mode=gateway-only/);
    assert.match(result.stdout, /channel gateway worker 종료/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /codex-image|CLI 작업자 토큰/);
    assert.deepEqual(requests, [{
      method: "POST",
      url: "/api/channel-gateway/worker/claim",
      authorization: `Bearer ${gatewayToken}`,
    }]);
  } finally {
    await closeServer(server);
  }
});

test("gateway-only deployment assets keep secrets external and require a persistent supervisor", async () => {
  const [worker, packageJson, dockerfile, service, documentation] = await Promise.all([
    readFile(workerPath, "utf8"),
    readFile(resolve(projectRoot, "package.json"), "utf8"),
    readFile(resolve(projectRoot, "deploy/channel-gateway-worker.Dockerfile"), "utf8"),
    readFile(resolve(projectRoot, "deploy/sellerpilot-channel-gateway-worker.service.example"), "utf8"),
    readFile(resolve(projectRoot, "docs/channel-gateway-worker.md"), "utf8"),
  ]);

  assert.match(worker, /const gatewayOnly = process\.argv\.includes\("--gateway-only"\)/);
  assert.match(worker, /gatewayOnly && !process\.env\.SELLERPILOT_URL\?\.trim\(\)/);
  assert.match(worker, /if \(gatewayOnly && !gatewayWorkerConfigured\)/);
  assert.match(worker, /if \(!gatewayOnly\) \{\s*if \(!aiWorkerConfigured\)/);
  assert.match(worker, /if \(!gatewayOnly\) \{\s*await access\(codexBin\)/);
  assert.match(worker, /if \(gatewayOnly\) \{\s*if \(once\) break;\s*await waitForIdleWork\(\);\s*continue;/);
  assert.match(packageJson, /"gateway:worker": "node --import tsx scripts\/ai-cli-worker\.mjs --gateway-only"/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.doesNotMatch(dockerfile, /SELLERPILOT_(?:GATEWAY|SCHEDULER)_WORKER_TOKEN=/);
  assert.match(service, /Restart=always/);
  assert.match(service, /EnvironmentFile=\/etc\/sellerpilot\/channel-gateway\.env/);
  assert.doesNotMatch(service, /spw_[A-Za-z0-9_-]+/);
  assert.match(documentation, /not the daemon\s+host/);
  assert.match(documentation, /20260828141000_enable_ebay_asq_inquiry_reply_lineage\.sql/);
  assert.match(documentation, /Do not report remote\s+CS as complete/);
});
