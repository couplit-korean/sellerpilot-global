import assert from "node:assert/strict";
import test from "node:test";
import { WorkerRequestTerminalError } from "../../scripts/worker-lifecycle-retry.mjs";
import { processCsGatewayJob } from "../../scripts/cs-gateway-job.mjs";
import { createCsDraftRpc, csDraftRequestBackoffMs, csWorkerFailureCategory, runCsDraftJob } from "../../scripts/cs-draft-worker.mjs";

const job = {
  id: "10000000-0000-4000-8000-000000000001",
  claim_token: "10000000-0000-4000-8000-000000000002",
  channel: "qoo10",
  operation: "inquiries.reply",
  request: { arguments: {} },
  credential: {},
};
const noop = async () => {};
const immediate = async () => {};
const draftRequest = { ticket_id: "00000000-0000-4000-8000-000000000001", sellerpilotInboundKey: "generation1", channel: "temu", target_locale: "ko-KR", tone: "polite", subject: "Fixture", message: "배송 확인", order: null };
const draftJob = { id: "00000000-0000-4000-8000-000000000101", claim_token: "00000000-0000-4000-8000-000000000201", request: draftRequest };
const draftResult = { mode: "support-reply", targetLocale: "ko-KR", draft: "문의해 주셔서 감사합니다. 확인 후 안내드리겠습니다.", sourceSummary: "문의 원문", cautions: [] };

function httpError(status, message = "fixture") {
  const error = new Error(message);
  error.status = status;
  return error;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("CS gateway keeps the lease and replays only the identical provider result after completion 503", async () => {
  const payloads = [];
  let attempts = 0;
  let stopped = 0;
  await processCsGatewayJob(job, {
    createGatewayHeartbeat: () => ({ start: noop, assertHealthy: noop, stop: async () => { stopped += 1; } }),
    reserveProviderRequest: noop,
    executeProvider: async () => ({
      ok: false,
      channel: "qoo10",
      operation: "inquiries.reply",
      steps: [{ name: "setinquirymessage", ok: false, status: 503, data: { sellerpilotMutation: "accepted" } }],
      safeMessage: "remote status unknown",
    }),
    persistWorkerCompletion: async (_path, payload) => {
      payloads.push(structuredClone(payload));
      attempts += 1;
      if (attempts === 1) throw new WorkerRequestTerminalError("temporary", { status: 503, reconciliation: true });
      return new Response("{}");
    },
  });
  assert.equal(stopped, 1);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(payloads[0].status, "reconciliation_required");
});

test("CS gateway replays the exact completion even when post-commit heartbeat reports conflict", async () => {
  const payloads = [];
  await processCsGatewayJob(job, {
    createGatewayHeartbeat: () => ({
      start: noop,
      assertHealthy: async () => {
        if (payloads.length >= 1) throw new WorkerRequestTerminalError("already completed", { status: 409, reconciliation: true });
      },
      stop: noop,
    }),
    reserveProviderRequest: noop,
    executeProvider: async () => ({
      ok: false,
      channel: "qoo10",
      operation: "inquiries.reply",
      steps: [{ name: "setinquirymessage", ok: false, status: 503, data: { sellerpilotMutation: "accepted" } }],
      safeMessage: "remote status unknown",
    }),
    persistWorkerCompletion: async (_path, payload) => {
      payloads.push(structuredClone(payload));
      if (payloads.length === 1) throw new WorkerRequestTerminalError("response lost", { status: 503, reconciliation: true });
      return new Response("{}");
    },
  });
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], payloads[1]);
});

test("CS draft renews its lease between transient completion failures without regenerating", async () => {
  let generated = 0;
  let heartbeats = 0;
  let completions = 0;
  const outcome = await runCsDraftJob(draftJob, {
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
    rpc: async body => {
      if (body.action === "heartbeat") { heartbeats += 1; return true; }
      completions += 1;
      if (completions === 1) { const error = new Error("temporary"); error.status = 503; throw error; }
      return { status: "replayed" };
    },
  });
  assert.deepEqual(outcome, { status: "replayed" });
  assert.equal(generated, 1);
  assert.equal(completions, 2);
  assert.equal(heartbeats, 2);
});

test("CS draft recovers committed completion with a lost response followed by heartbeat 409", async () => {
  let generated = 0;
  let completions = 0;
  let heartbeats = 0;
  const payloads = [];
  const outcome = await runCsDraftJob(draftJob, {
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
    rpc: async body => {
      if (body.action === "heartbeat") {
        heartbeats += 1;
        if (heartbeats > 1) throw httpError(409, "already completed");
        return true;
      }
      completions += 1;
      payloads.push(structuredClone(body));
      if (completions === 1) throw httpError(503, "committed but response lost");
      return { status: "replayed" };
    },
  });
  assert.deepEqual(outcome, { status: "replayed" });
  assert.equal(generated, 1);
  assert.equal(completions, 2);
  assert.deepEqual(payloads[0], payloads[1]);
});

test("production CS RPC wrapper normalizes raw fetch failure and replays the committed completion", async () => {
  let generated = 0;
  let heartbeats = 0;
  let completions = 0;
  const completionPayloads = [];
  const rpc = createCsDraftRpc({
    baseUrl: "https://sellerpilot-global.vercel.app",
    token: "spw_fixture_identity_1234567890",
    requestTimeoutMs: 100,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "heartbeat") {
        heartbeats += 1;
        if (heartbeats === 2) throw new TypeError("fetch failed");
        return jsonResponse({ status: "running" });
      }
      completions += 1;
      completionPayloads.push(structuredClone(body));
      if (completions === 1) return jsonResponse({ message: "CS 작업 원장 요청을 완료하지 못했습니다." }, 503);
      return jsonResponse({ status: "replayed" });
    },
  });
  const outcome = await runCsDraftJob(draftJob, {
    rpc,
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
  });
  assert.deepEqual(outcome, { status: "replayed" });
  assert.equal(generated, 1);
  assert.equal(heartbeats, 2);
  assert.equal(completions, 2);
  assert.deepEqual(completionPayloads[0], completionPayloads[1]);
});

test("production CS RPC wrapper distinguishes individual request timeout and replays unchanged completion", async () => {
  let generated = 0;
  let heartbeats = 0;
  let completions = 0;
  const completionPayloads = [];
  const rpc = createCsDraftRpc({
    baseUrl: "https://sellerpilot-global.vercel.app",
    token: "spw_fixture_identity_1234567890",
    requestTimeoutMs: 5,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "heartbeat") {
        heartbeats += 1;
        if (heartbeats === 2) {
          return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
        }
        return jsonResponse({ status: "running" });
      }
      completions += 1;
      completionPayloads.push(structuredClone(body));
      if (completions === 1) return jsonResponse({ message: "CS 작업 원장 요청을 완료하지 못했습니다." }, 503);
      return jsonResponse({ status: "replayed" });
    },
  });
  const outcome = await runCsDraftJob(draftJob, {
    rpc,
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
  });
  assert.deepEqual(outcome, { status: "replayed" });
  assert.equal(generated, 1);
  assert.equal(heartbeats, 2);
  assert.equal(completions, 2);
  assert.deepEqual(completionPayloads[0], completionPayloads[1]);
});

test("production CS RPC wrapper preserves explicit caller cancellation", async () => {
  const caller = new AbortController();
  const stopped = new Error("fixture stop");
  let generated = 0;
  const rpc = createCsDraftRpc({
    baseUrl: "https://sellerpilot-global.vercel.app",
    token: "spw_fixture_identity_1234567890",
    requestTimeoutMs: 1_000,
    fetchImpl: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })),
  });
  setTimeout(() => caller.abort(stopped), 5);
  await assert.rejects(runCsDraftJob(draftJob, {
    rpc,
    signal: caller.signal,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
  }), error => error === stopped);
  assert.equal(generated, 0);
});

test("CS draft job-wide deadline remains terminal and never persists a completion", async () => {
  let completions = 0;
  await assert.rejects(runCsDraftJob(draftJob, {
    overallTimeoutMs: 5,
    heartbeatMs: 60_000,
    completionDelay: immediate,
    rpc: async body => { if (body.action === "complete") completions += 1; return true; },
    generate: async (_request, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  }), error => error?.name === "TimeoutError");
  assert.equal(completions, 0);
});

test("production CS RPC wrapper keeps initial lease conflict terminal", async () => {
  let generated = 0;
  const rpc = createCsDraftRpc({
    baseUrl: "https://sellerpilot-global.vercel.app",
    token: "spw_fixture_identity_1234567890",
    fetchImpl: async () => jsonResponse({ status: "lease_lost" }, 409),
  });
  await assert.rejects(runCsDraftJob(draftJob, {
    rpc,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
  }), error => error?.status === 409 && error?.phase === "heartbeat");
  assert.equal(generated, 0);
});

test("CS draft does not retry an unknown completion error", async () => {
  let generated = 0;
  let completions = 0;
  await assert.rejects(runCsDraftJob(draftJob, {
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
    rpc: async body => {
      if (body.action === "heartbeat") return true;
      completions += 1;
      throw new Error("fixture unknown completion error");
    },
  }), /fixture unknown completion error/u);
  assert.equal(generated, 1);
  assert.equal(completions, 1);
});

test("CS draft retries an uncommitted 503 and consecutive 5xx without regeneration", async () => {
  let generated = 0;
  let completions = 0;
  const payloads = [];
  const outcome = await runCsDraftJob(draftJob, {
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
    rpc: async body => {
      if (body.action === "heartbeat") return true;
      completions += 1;
      payloads.push(structuredClone(body));
      if (completions <= 3) throw httpError(completions === 1 ? 503 : 502);
      return { status: "completed" };
    },
  });
  assert.deepEqual(outcome, { status: "completed" });
  assert.equal(generated, 1);
  assert.equal(completions, 4);
  assert.ok(payloads.every(payload => JSON.stringify(payload) === JSON.stringify(payloads[0])));
});

test("CS draft distinguishes another claim token from an idempotent completion replay", async () => {
  let generated = 0;
  let completions = 0;
  await assert.rejects(runCsDraftJob(draftJob, {
    heartbeatMs: 60_000,
    completionDelay: immediate,
    generate: async () => { generated += 1; return draftResult; },
    rpc: async body => {
      if (body.action === "heartbeat") {
        if (completions > 0) throw httpError(409, "not running");
        return true;
      }
      completions += 1;
      if (completions === 1) throw httpError(503, "response uncertain");
      throw httpError(409, "different claim token");
    },
  }), error => error?.status === 409);
  assert.equal(generated, 1);
  assert.equal(completions, 2);
});

test("CS draft aborts on actual lease loss before completion and persists nothing", async () => {
  let heartbeats = 0;
  let completions = 0;
  await assert.rejects(runCsDraftJob(draftJob, {
    heartbeatMs: 5,
    completionDelay: immediate,
    rpc: async body => {
      if (body.action === "heartbeat") {
        heartbeats += 1;
        if (heartbeats > 1) throw httpError(409, "lease lost");
        return true;
      }
      completions += 1;
      return { status: "completed" };
    },
    generate: async (_request, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  }), error => error?.status === 409);
  assert.equal(completions, 0);
});

test("CS draft classifies fixed server errors without logging response bodies", () => {
  assert.equal(csWorkerFailureCategory(503, "CS 작업자 연결 설정이 필요합니다."), "server_configuration");
  assert.equal(csWorkerFailureCategory(503, "CS 작업 원장 요청을 완료하지 못했습니다."), "ledger_rpc");
  assert.equal(csWorkerFailureCategory(401, "ignored"), "worker_identity");
  assert.deepEqual([1, 2, 3, 6, 20].map(csDraftRequestBackoffMs), [15_000, 30_000, 60_000, 300_000, 300_000]);
});
