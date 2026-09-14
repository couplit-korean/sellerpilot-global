import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { inquiryHistorySyncRequests } = await import("../lib/channels/sync-arguments.ts");
const { completeCsClaim } = await import("../lib/cs/operations/complete.ts");
const { completeCsWorker } = await import("../lib/cs/operations/worker-completion.ts");
const { isQoo10HistoryEvidenceConflict } = await import("../lib/channels/cs/qoo10/history-completion-error.ts");
const { processCsGatewayJob } = await import("../scripts/cs-gateway-job.mjs");
const { requestWithTransientRetry } = await import("../scripts/worker-lifecycle-retry.mjs");

const JOB_ID = "10000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";

function identityContext() {
  return {
    contract: "sellerpilot-qoo10-inquiry-identity-context/1",
    ownerId: "40000000-0000-4000-8000-000000000001",
    sellerAccountKey: "b".repeat(64),
    environment: "sandbox",
    sourceCredentialId: CREDENTIAL_ID,
  };
}

function historyResult(total: number) {
  return {
    ok: true,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "GetInquiryMessage",
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: [], TotalCount: total },
    }],
    safeMessage: "fixture only",
  };
}

function historyJob(request: ReturnType<typeof inquiryHistorySyncRequests>[number]) {
  return {
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    environment: "sandbox" as const,
    request,
    credential: { api_key: "fixture-only" },
    attempt_count: 1,
  };
}

test("actual repair scheduler emits 30 disjoint Qoo10 days and four windows per day", () => {
  const requests = inquiryHistorySyncRequests("qoo10", new Date("2026-09-09T00:01:00.000Z"), 30);
  assert.equal(requests.length, 120);
  assert.equal(new Set(requests.map((request) => request.periodicKey)).size, 120);
  assert.equal(requests.filter((request) => request.periodicKey.includes(":20260811000000:20260811235959")).length, 4);
  assert.equal(requests.filter((request) => request.periodicKey.includes(":20260909000000:20260909235959")).length, 4);
  assert.ok(requests.every((request) => request.arguments.sellerpilotHistoryWindow));
});

test("actual completion persists provider-total mismatch and its stable hourly resume work", async () => {
  const request = inquiryHistorySyncRequests("qoo10", new Date("2026-09-09T00:01:00.000Z"), 30)[116]!;
  const job = historyJob(request);
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const outcome = await completeCsClaim({
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments: arguments_ });
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return { data: { status: "running", channel: "qoo10", operation: "inquiries.list", normalization_timestamp: "2026-09-09T00:02:00.000Z" }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") {
        return { data: identityContext(), error: null };
      }
      if (name === "sellerpilot_service_record_qoo10_history_window_v1") {
        const completion = arguments_.p_completion as Record<string, unknown>;
        return { data: {
          contract: "sellerpilot-qoo10-history-window-record/1",
          status: "recorded",
          jobId: JOB_ID,
          windowKey: completion.windowKey,
          completionState: completion.state,
          refinementCount: (completion.refinementRequests as unknown[]).length,
        }, error: null };
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
        return { data: { contract: "sellerpilot-cs-credential-binding/1", status: "recorded" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  }, "a".repeat(64), job, { status: "succeeded", result: historyResult(5) });

  assert.equal(outcome, "completed");
  const completionCall = calls.find((call) => call.name === "sellerpilot_service_complete_serverless_cs_transaction");
  const historyCall = calls.find((call) => call.name === "sellerpilot_service_record_qoo10_history_window_v1");
  assert.ok(completionCall);
  assert.ok(historyCall);
  assert.ok(calls.indexOf(completionCall) < calls.indexOf(historyCall));
  const completion = historyCall.arguments.p_completion as {
    state: string;
    coverage: { completeness: { reason: string } };
    refinementRequests: Array<{ periodicKey: string; arguments: Record<string, unknown> }>;
  };
  assert.equal(completion.state, "refining");
  assert.equal(completion.coverage.completeness.reason, "provider_total_mismatch");
  assert.equal(completion.refinementRequests.length, 24);
  assert.equal(new Set(completion.refinementRequests.map((child) => child.periodicKey)).size, 24);
  assert.equal(calls.some((call) => call.name === "sellerpilot_service_record_cs_history_page_v1"), false);
});

test("a failed history-ledger write is retried after gateway completion replay", async () => {
  const request = inquiryHistorySyncRequests("qoo10", new Date("2026-09-09T00:01:00.000Z"), 30)[117]!;
  const job = historyJob(request);
  let pass = 0;
  let recordAttempts = 0;
  const dependencies = {
    rpc: async (name: string, arguments_: Record<string, unknown> = {}) => {
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return { data: { status: pass === 0 ? "running" : "completed_replay", channel: "qoo10", operation: "inquiries.list", normalization_timestamp: "2026-09-09T00:02:00.000Z" }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: pass === 0 ? "completed" : "completed_replay" }, error: null };
      }
      if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") {
        return { data: identityContext(), error: null };
      }
      if (name === "sellerpilot_service_record_qoo10_history_window_v1") {
        recordAttempts += 1;
        if (pass === 0) return { data: null, error: { code: "temporary" } };
        const completion = arguments_.p_completion as Record<string, unknown>;
        return { data: {
          contract: "sellerpilot-qoo10-history-window-record/1",
          status: "recorded",
          jobId: JOB_ID,
          windowKey: completion.windowKey,
          completionState: completion.state,
          refinementCount: (completion.refinementRequests as unknown[]).length,
        }, error: null };
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
        return { data: { contract: "sellerpilot-cs-credential-binding/1", status: "recorded" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  };

  assert.equal(await completeCsClaim(dependencies, "a".repeat(64), job, { status: "succeeded", result: historyResult(0) }), "unavailable");
  pass = 1;
  assert.equal(await completeCsClaim(dependencies, "a".repeat(64), job, { status: "succeeded", result: historyResult(0) }), "completed");
  assert.equal(recordAttempts, 2);
});

test("external worker completion uses the same dedicated Qoo10 history receipt", async () => {
  const request = inquiryHistorySyncRequests("qoo10", new Date("2026-09-09T00:01:00.000Z"), 30)[118]!;
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const serviceClient = {
    rpc: async (name: string, arguments_: Record<string, unknown> = {}) => {
      calls.push({ name, arguments: arguments_ });
      if (name === "sellerpilot_service_complete_gateway_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") {
        return { data: identityContext(), error: null };
      }
      if (name === "sellerpilot_service_record_qoo10_history_window_v1") {
        const completion = arguments_.p_completion as Record<string, unknown>;
        return { data: {
          contract: "sellerpilot-qoo10-history-window-record/1",
          status: "recorded",
          jobId: JOB_ID,
          windowKey: completion.windowKey,
          completionState: completion.state,
          refinementCount: (completion.refinementRequests as unknown[]).length,
        }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  };
  const response = await completeCsWorker({
    serviceClient: serviceClient as never,
    tokenHash: "a".repeat(64),
    job: {
      ...historyJob(request),
      normalization_timestamp: "2026-09-09T00:02:00.000Z",
    },
    completion: {
      jobId: JOB_ID,
      claimToken: CLAIM_TOKEN,
      status: "succeeded",
      result: historyResult(7),
    },
  });

  assert.equal(response.status, 200);
  const historyCall = calls.find((call) => call.name === "sellerpilot_service_record_qoo10_history_window_v1");
  assert.ok(historyCall);
  const completion = historyCall.arguments.p_completion as { state: string; refinementRequests: unknown[] };
  assert.equal(completion.state, "refining");
  assert.equal(completion.refinementRequests.length, 24);
  assert.equal(calls.some((call) => call.name === "sellerpilot_service_record_cs_history_page_v1"), false);
});

test("only the exact Qoo10 evidence conflict is permanent, including the legacy SQLSTATE", () => {
  for (const code of ["PT409", "40001"]) assert.equal(isQoo10HistoryEvidenceConflict({ code, message: "QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH" }), true);
  for (const error of [null, { code: "40001", message: "serialization failure" }, { code: "PT409", message: "OTHER_CONFLICT" }, { code: "57014", message: "QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH" }]) {
    assert.equal(isQoo10HistoryEvidenceConflict(error), false);
  }
});

test("Qoo10 permanent history conflict returns 409 and drains the actual worker after one completion, without provider replay", async () => {
  for (const code of ["PT409", "40001"]) {
    const request = inquiryHistorySyncRequests("qoo10", new Date("2026-09-09T00:01:00Z"), 30)[116]!;
    const job = { ...historyJob(request), normalization_timestamp: "2026-09-09T00:02:00Z" };
    let providerCalls = 0;
    let completionCalls = 0;
    let historyCalls = 0;
    let stopped = 0;
    const serviceClient = { rpc: async (name: string) => {
      if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") return { data: identityContext(), error: null };
      if (name === "sellerpilot_service_complete_gateway_transaction") return { data: { status: "completed_replay" }, error: null };
      if (name === "sellerpilot_service_record_qoo10_history_window_v1") {
        historyCalls += 1;
        return { data: null, error: { code, message: "QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH" } };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    } };
    await processCsGatewayJob(job, {
      createGatewayHeartbeat: () => ({ start: async () => {}, assertHealthy: async () => {}, stop: async () => { stopped += 1; } }),
      reserveProviderRequest: async () => {},
      executeProvider: async () => { providerCalls += 1; return historyResult(0); },
      persistWorkerCompletion: async (_path: string, completion: unknown) => requestWithTransientRetry({
        request: async () => {
          completionCalls += 1;
          const response = await completeCsWorker({ serviceClient: serviceClient as never, tokenHash: "a".repeat(64), job, completion: completion as never });
          assert.equal(response.status, 409);
          assert.equal((await response.clone().json()).code, "QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH");
          return response;
        },
        delay: async () => { assert.fail("Permanent conflict must not enter retry delay"); },
        graceMs: 600_000,
        terminalStatuses: [401, 409],
        label: "fixture Qoo10 completion",
      }),
    });
    assert.equal(providerCalls, 1);
    assert.equal(completionCalls, 1);
    assert.equal(historyCalls, 1);
    assert.equal(stopped, 1);
  }
});
