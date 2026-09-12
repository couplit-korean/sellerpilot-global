import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  applyCsDraftLaunchAgentTransition,
  buildCsDraftLaunchAgentPlist,
  CS_DRAFT_WORKER_LABEL,
  decideCsDraftLaunchAgentInstall,
  parseLaunchAgentState,
} from "../../scripts/cs-draft-worker-launch-agent.mjs";

const runner = new URL("../../deploy/channel-gateway-runner.sh", import.meta.url);

function runnerFixture(root, extra = {}) {
  const worker = join(root, "dev", "sellerpilot-worker");
  mkdirSync(worker, { recursive: true });
  return {
    HOME: root,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    SELLERPILOT_URL: "https://sellerpilot-global.vercel.app",
    SELLERPILOT_NODE_BIN: process.execPath,
    SELLERPILOT_WORKER_DIR: worker,
    SELLERPILOT_WORKER_HEALTH_URL: "http://127.0.0.1:9/healthz",
    SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR: join(root, "supervisor.lock"),
    SELLERPILOT_GATEWAY_RELEASE_FILE: join(root, "missing-release"),
    ...extra,
  };
}

async function waitFor(check, label, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function stopFixtureProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    delay(1_000).then(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Fixture already exited. */ } }),
  ]);
}

function spawnRunner(env) {
  return spawn("/bin/bash", [runner.pathname], { env, detached: true, stdio: "ignore" });
}

test("gateway supervisor shell is valid and requires an explicit control-plane URL", () => {
  execFileSync("/bin/bash", ["-n", runner.pathname]);
  const result = spawnSync("/bin/bash", [runner.pathname], {
    encoding: "utf8",
    env: { HOME: mkdtempSync(join(tmpdir(), "sellerpilot-runner-missing-url-")), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SELLERPILOT_URL is required/u);
});

test("gateway supervisor kernel lock closes the pre-owner publication race and releases on death", async () => {
  const root = mkdtempSync(join(tmpdir(), "sellerpilot-runner-lock-"));
  let first;
  let replacement;
  try {
    const locked = join(root, "first-locked");
    const env = runnerFixture(root, {
      SELLERPILOT_SUPERVISOR_TEST_MODE: "1",
      SELLERPILOT_SUPERVISOR_TEST_LOCKED_FILE: locked,
      SELLERPILOT_SUPERVISOR_TEST_OWNER_DELAY_SECONDS: "2",
    });
    first = spawnRunner(env);
    await waitFor(() => existsSync(locked), "first kernel lock");
    assert.equal(existsSync(join(env.SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR, "owner")), false);
    const second = spawnSync("/bin/bash", [runner.pathname], {
      encoding: "utf8",
      env: { ...env, SELLERPILOT_SUPERVISOR_TEST_LOCKED_FILE: join(root, "second-locked"), SELLERPILOT_SUPERVISOR_TEST_OWNER_DELAY_SECONDS: "0" },
    });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /supervisor already running/u);
    assert.equal(first.exitCode, null);

    // Kill the first process while it is deliberately delayed before owner
    // metadata publication. The kernel lock must be released immediately.
    await stopFixtureProcess(first);
    replacement = spawnRunner({ ...env, SELLERPILOT_SUPERVISOR_TEST_LOCKED_FILE: join(root, "replacement-locked"), SELLERPILOT_SUPERVISOR_TEST_OWNER_DELAY_SECONDS: "0" });
    await waitFor(() => existsSync(join(env.SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR, "owner")), "replacement owner");
    assert.equal(replacement.exitCode, null);
    const source = readFileSync(runner, "utf8");
    assert.match(source, /HEALTH_URL%\/readyz\}\/healthz/u);
  } finally {
    if (first) await stopFixtureProcess(first);
    if (replacement) await stopFixtureProcess(replacement);
    rmSync(root, { recursive: true, force: true });
  }
});

test("gateway supervisor serializes concurrent stale recovery and reclaims an abandoned legacy initializer", async () => {
  const root = mkdtempSync(join(tmpdir(), "sellerpilot-runner-stale-"));
  const env = runnerFixture(root, { SELLERPILOT_SUPERVISOR_LEGACY_INIT_GRACE_SECONDS: "1" });
  const lock = env.SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR;
  mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 10_000);
  utimesSync(lock, old, old);
  const contenders = [spawnRunner(env), spawnRunner(env)];
  try {
    await waitFor(() => contenders.filter(child => child.exitCode === null).length === 1, "one stale-lock winner");
    assert.equal(contenders.filter(child => child.exitCode === null).length, 1);
    await waitFor(() => existsSync(join(lock, "owner")), "stale recovery owner");
  } finally {
    await Promise.all(contenders.map(stopFixtureProcess));
    rmSync(root, { recursive: true, force: true });
  }
});

test("gateway supervisor preserves a fresh legacy initializer with no PID", () => {
  const root = mkdtempSync(join(tmpdir(), "sellerpilot-runner-initializing-"));
  const env = runnerFixture(root, { SELLERPILOT_SUPERVISOR_LEGACY_INIT_GRACE_SECONDS: "30" });
  const lock = env.SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR;
  mkdirSync(lock, { recursive: true });
  try {
    const result = spawnSync("/bin/bash", [runner.pathname], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /legacy supervisor lock is still initializing/u);
    assert.equal(existsSync(join(lock, "owner")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gateway supervisor treats a live unrelated legacy PID as reuse and never signals it", async () => {
  const root = mkdtempSync(join(tmpdir(), "sellerpilot-runner-pid-reuse-"));
  const env = runnerFixture(root);
  const lock = env.SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR;
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "pid"), `${process.pid}\n`);
  const child = spawnRunner(env);
  try {
    await waitFor(() => existsSync(join(lock, "owner")), "PID reuse replacement owner");
    assert.doesNotThrow(() => process.kill(process.pid, 0));
    assert.equal(child.exitCode, null);
  } finally {
    await stopFixtureProcess(child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("CS draft LaunchAgent is isolated from product AI and carries no token", () => {
  const plist = buildCsDraftLaunchAgentPlist({
    nodePath: "/node22/bin/node",
    installedRuntimeRoot: "/runtime",
    sellerpilotUrl: "https://sellerpilot-global.vercel.app",
    logsRoot: "/logs",
  });
  assert.match(plist, new RegExp(CS_DRAFT_WORKER_LABEL));
  assert.match(plist, /scripts\/cs-draft-worker\.mjs/u);
  assert.match(plist, /SELLERPILOT_URL/u);
  assert.doesNotMatch(plist, /SELLERPILOT_(?:AI_)?WORKER_TOKEN/u);
  assert.doesNotMatch(plist, /product-ai-worker|ai-cli-worker/u);
});

test("CS draft LaunchAgent install is an idempotent no-op and defers loaded changes", async () => {
  const running = parseLaunchAgentState("state = running\npid = 4242\n");
  assert.deepEqual(decideCsDraftLaunchAgentInstall({ previousPlist: "same", nextPlist: "same", launchState: running }), { action: "noop", reason: "unchanged-loaded" });
  assert.deepEqual(decideCsDraftLaunchAgentInstall({ previousPlist: "old", nextPlist: "new", launchState: running }), { action: "defer", reason: "running" });
  assert.deepEqual(decideCsDraftLaunchAgentInstall({ previousPlist: "old", nextPlist: "new", launchState: { loaded: true, state: "unknown", pid: null } }), { action: "defer", reason: "loaded-state-unknown" });
  const calls = [];
  await assert.rejects(applyCsDraftLaunchAgentTransition({
    decision: { action: "defer", reason: "running" },
    commandRunner: (...args) => calls.push(args),
    domain: "gui/501",
    targetPlistPath: "/tmp/cs.plist",
    replacePlist: async () => calls.push(["replace"]),
  }), /install deferred: running/u);
  assert.deepEqual(calls, []);
});

test("CS draft LaunchAgent installs only when the label is confirmed unloaded and never uses kickstart -k", async () => {
  const decision = decideCsDraftLaunchAgentInstall({ previousPlist: "old", nextPlist: "new", launchState: parseLaunchAgentState("") });
  assert.deepEqual(decision, { action: "install", reason: "confirmed-unloaded" });
  const calls = [];
  const changed = await applyCsDraftLaunchAgentTransition({
    decision,
    commandRunner: (program, args) => calls.push([program, args]),
    domain: "gui/501",
    targetPlistPath: "/tmp/cs.plist",
    replacePlist: async () => calls.push(["replace"]),
  });
  assert.equal(changed, true);
  assert.deepEqual(calls, [
    ["replace"],
    ["/bin/launchctl", ["bootstrap", "gui/501", "/tmp/cs.plist"]],
    ["/bin/launchctl", ["kickstart", `gui/501/${CS_DRAFT_WORKER_LABEL}`]],
  ]);
  assert.equal(calls.flat(2).includes("-k"), false);
});
