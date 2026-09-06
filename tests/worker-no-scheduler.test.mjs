import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { canRunPeriodicChannelSync, canRunGatewayClaim, isWorkerTokenConfigured } from "../scripts/worker-claim-backoff.mjs";

const source = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
function section(start, end) {
  const left = source.indexOf(start);
  const right = source.indexOf(end, left);
  assert.ok(left >= 0 && right > left);
  return source.slice(left, right);
}
function scopeState(flags, environmentToken = false) {
  const reads = [];
  const keychain = [];
  const env = new Proxy({ SELLERPILOT_URL: "https://control.invalid" }, {
    get(target, name) {
      reads.push(name);
      return environmentToken && name.endsWith("_WORKER_TOKEN") ? `spw_${"x".repeat(43)}` : target[name];
    },
  });
  const state = vm.runInNewContext(`${section('const productOnly =', 'const gatewayPolling =')}\n({ aiWorkerConfigured, gatewayWorkerConfigured, schedulerWorkerConfigured, localRecoveryOnly });`, {
    process: { argv: flags, env, platform: "darwin" },
    execFileSync(_program, args) { keychain.push(args[args.indexOf("-s") + 1]); return `spw_${"x".repeat(43)}`; },
    isWorkerTokenConfigured,
  });
  return { ...state, reads, keychain };
}
const periodic = section("    if (canRunPeriodicChannelSync({", "    if (canRunGatewayClaim({");
async function periodicCalls(state) {
  const calls = [];
  await vm.runInNewContext(`(async () => { ${periodic} })()`, {
    ...state, canRunPeriodicChannelSync, once: false, gatewayQueueIdle: true,
    activeGatewayJobs: new Set(), nextPeriodicSyncAt: 0, authBackoffUntil: { scheduler: 0 },
    periodicSyncMs: 60_000, workerVersion: "fixture", console: { log() {}, error() {} },
    api: async (path) => { calls.push(path); return { ok: true, json: async () => ({ queued: 0, pending: 0 }) }; },
    startPeriodicCompetitorRefresh() { calls.push("competitor-refresh"); }, markWorkerBusy() {},
  });
  return calls;
}

test("gateway --no-scheduler never reads scheduler environment or Keychain and retains gateway scope", () => {
  for (const environmentToken of [false, true]) {
    const state = scopeState(["--gateway-only", "--no-scheduler"], environmentToken);
    assert.equal(state.aiWorkerConfigured, false);
    assert.equal(state.gatewayWorkerConfigured, true);
    assert.equal(state.schedulerWorkerConfigured, false);
    assert.equal(state.localRecoveryOnly, false);
    assert.ok(!state.reads.includes("SELLERPILOT_SCHEDULER_WORKER_TOKEN"));
    assert.ok(!state.keychain.includes("SellerPilot Scheduler Worker"));
    assert.ok(!state.keychain.includes("SellerPilot AI Worker"));
  }
});

test("no-scheduler skips the actual periodic sync, competitor refresh and Kakao block", async () => {
  const state = scopeState(["--gateway-only", "--no-scheduler"]);
  assert.deepEqual(await periodicCalls(state), []);
  assert.equal(canRunGatewayClaim({ configured: state.gatewayWorkerConfigured, activeGatewayJobs: 0,
    maxGatewayConcurrency: 1, now: 1, claimBackoffUntil: 0, authBackoffUntil: 0 }), true);
  const body = section('let gatewayResponse = await api("/api/channel-gateway/worker/claim", {', '        gatewayWorkerHealth?.markGatewayResponse');
  const requests = [];
  await vm.runInNewContext(`(async () => { ${body} })()`, {
    workerVersion: "sellerpilot-cli-worker/1.60", localRecoveryOnly: state.localRecoveryOnly,
    localChannelExecutorAttestation: null, localChannelExecutorClaimMode: "local_channel_executor",
    api: async (path, init) => { requests.push({ path, body: JSON.parse(init.body) }); return { status: 204 }; },
  });
  assert.deepEqual(requests, [{ path: "/api/channel-gateway/worker/claim", body: { version: "sellerpilot-cli-worker/1.60" } }]);
});

test("gateway default behavior remains additive: scheduler and periodic calls are unchanged", async () => {
  const state = scopeState(["--gateway-only"]);
  assert.equal(state.schedulerWorkerConfigured, true);
  assert.ok(state.keychain.includes("SellerPilot Scheduler Worker"));
  assert.deepEqual(await periodicCalls(state), ["/api/internal/channel-sync", "competitor-refresh", "/api/internal/kakao-notifications"]);
});

test("AI-only, product-only and local recovery retain previous scope restrictions", () => {
  for (const flags of [["--ai-only"], ["--product-only"], ["--gateway-only", "--local-recovery-only"]]) {
    const before = scopeState(flags);
    const after = scopeState([...flags, "--no-scheduler"]);
    assert.equal(before.aiWorkerConfigured, after.aiWorkerConfigured);
    assert.equal(before.gatewayWorkerConfigured, after.gatewayWorkerConfigured);
    assert.equal(after.schedulerWorkerConfigured, false);
  }
  const all = scopeState(["--no-scheduler"]);
  assert.equal(all.aiWorkerConfigured, true);
  assert.equal(all.gatewayWorkerConfigured, true);
  assert.equal(all.schedulerWorkerConfigured, false);
});
