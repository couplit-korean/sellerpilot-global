import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("a rejected background CS completion leaves the worker alive and releases its slot", { timeout: 25_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-job-rejection-"));
  const preload = join(directory, "local-only.mjs");
  await writeFile(preload, `const original = globalThis.fetch;
globalThis.fetch = (url, options) => new URL(url).hostname === '127.0.0.1'
  ? original(url, options) : Promise.resolve(new Response('', { status: 503 }));\n`);
  let claimed = 0;
  const completions = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    response.setHeader("content-type", "application/json");
    if (request.url.endsWith("/elevenst-create-recovery")) {
      response.end(JSON.stringify({ status: "idle" }));
    } else if (request.url.endsWith("/queue-pulse")) {
      response.end(JSON.stringify({ queued: claimed ? 0 : 1, staleRunning: 0 }));
    } else if (request.url.endsWith("/claim")) {
      if (body.mode || claimed) { response.writeHead(204); response.end(); return; }
      claimed += 1;
      response.end(JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        claim_token: "22222222-2222-4222-8222-222222222222",
        channel: "qoo10", operation: "inquiries.list", credential: {},
        request: { arguments: {} },
      }));
    } else if (request.url.endsWith("/heartbeat")) {
      response.end(JSON.stringify({ status: "running" }));
    } else if (request.url.endsWith("/complete")) {
      completions.push(body);
      response.writeHead(400);
      response.end(JSON.stringify({ message: "fixture completion rejected" }));
    } else {
      response.writeHead(400);
      response.end(JSON.stringify({ message: "unexpected fixture request" }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const worker = new URL("../../scripts/ai-cli-worker.mjs", import.meta.url);
  const child = spawn(process.execPath, [
    "--unhandled-rejections=strict", "--import", "tsx", "--import", pathToFileURL(preload).href,
    worker.pathname, "--gateway-only", "--no-scheduler",
  ], {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      SELLERPILOT_URL: `http://127.0.0.1:${server.address().port}`,
      SELLERPILOT_GATEWAY_WORKER_TOKEN: `spw_${"g".repeat(43)}`,
      SELLERPILOT_AI_WORKER_TOKEN: "disabled", SELLERPILOT_SCHEDULER_WORKER_TOKEN: "disabled",
      SELLERPILOT_GATEWAY_WORKER_POLL_MS: "2000",
      SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS: "2000",
      SELLERPILOT_GATEWAY_HEALTH_PORT: "0", SELLERPILOT_GATEWAY_HEALTH_HOST: "127.0.0.1",
      CODEX_BIN: "/not-installed/codex",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (let i = 0; i < 100 && !completions.length && child.exitCode === null; i++) await sleep(100);
    assert.equal(completions.length, 1, stderr);
    await sleep(500);
    assert.equal(child.exitCode, null, `background rejection killed worker: ${stderr}`);
    const port = stdout.match(/Gateway health server · port=(\d+)/)?.[1];
    assert.ok(port, stdout);
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    const health = await response.json();
    assert.equal(health.activeGatewayJobs, 0);
    assert.equal(health.ready, false, "failed completion must not be reported healthy");
    assert.equal(health.lastGatewayStatus, 503);
    assert.equal(completions[0].status, "failed");
    assert.equal(claimed, 1, "the failed result must not repeat provider execution");
    child.kill("SIGTERM");
    assert.deepEqual(await closed, { code: 0, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
