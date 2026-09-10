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
