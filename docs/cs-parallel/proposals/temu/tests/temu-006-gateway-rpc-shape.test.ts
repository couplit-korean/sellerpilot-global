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

const {
  deriveServerlessCsGatewayCredentials,
  runOneServerlessCsGatewayJob,
} = await import("../../../../../lib/channels/serverless-gateway");

const CRON_SECRET = "temu-gateway-response-loss-fixture";
const JOB_ID = "10000000-0000-4000-8000-00000000c001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-00000000c002";
const CREDENTIAL_ID = "30000000-0000-4000-8000-00000000c003";
const REQUEUE_RPC = "sellerpilot_service_requeue_temu_after_sales_detail_v2";

const firstSummary = {
  parentAfterSalesSn: "AFTER-1",
  parentOrderSn: "ORDER-1",
  afterSalesStatusGroup: 1,
  operateExpireTimeMs: null,
  availableOperateList: [1],
  returnDeliveryType: null,
  parentAfterSalesStatus: 1,
  updateAt: 1_788_000_000,
  afterSalesType: 2,
  createAt: 1_787_000_000,
};
const failedSummary = {
  ...firstSummary,
  parentAfterSalesSn: "AFTER-2",
  parentOrderSn: "ORDER-2",
};
const retryArguments = {
  kind: "after_sales",
  includeDetails: true,
  pageNo: 1,
  pageSize: 200,
  updateAtStart: 1_787_000_000,
  updateAtEnd: 1_788_000_000,
  retryReplayQueue: [firstSummary],
  detailQueue: [failedSummary],
  sellerpilotTemuDetailRetryCount: 1,
};
const retryContinuation = {
  reason: "retryable_read_failure" as const,
  arguments: retryArguments,
  retryCount: 1,
  retryAfterSeconds: 5,
  deferredCount: 1,
  replayCount: 1,
  providerStatus: 503,
};
const receipt = {
  contract: "temu-after-sales-detail-retry-v2",
  status: "deferred",
  retryCount: 1,
  retryAfterSeconds: 5,
  deferredCount: 1,
  replayCount: 1,
  failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED",
  replayed: true,
};
const claimedJob = {
  id: JOB_ID,
  claim_token: CLAIM_TOKEN,
  credential_id: CREDENTIAL_ID,
  channel: "temu",
  operation: "inquiries.list",
  environment: "sandbox",
  request: { arguments: retryArguments },
  credential: {
    app_key: "fixture-app-key",
    app_secret: "fixture-app-secret",
    access_token: "fixture-access-token",
  },
  attempt_count: 2,
};
const providerFailure = {
  ok: false,
  channel: "temu",
  operation: "inquiries.list",
  steps: [{ name: "inquiries", ok: false, status: 503, data: {} }],
  retryContinuation,
  safeMessage: "Temu detail read failed",
};

type RpcCall = { name: string; arguments: Record<string, unknown> };
type FirstRetryFailure = "throw" | "returned_error";

function gatewayTokenHash() {
  return deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash;
}

function rpcFixture(
  calls: RpcCall[],
  firstRetryFailure: FirstRetryFailure | "missing_schema",
) {
  let claimed = false;
  let requeues = 0;
  return async (name: string, arguments_: Record<string, unknown> = {}) => {
    calls.push({ name, arguments: structuredClone(arguments_) });
    if (name === "sellerpilot_claim_serverless_gateway_job") {
      if (claimed) return { data: null, error: null };
      claimed = true;
      return { data: claimedJob, error: null };
    }
    if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
      return {
        data: {
          contract: "sellerpilot-provider-rate-budget/1",
          status: "reserved",
          retryAfterSeconds: 0,
        },
        error: null,
      };
    }
    if (name === "sellerpilot_touch_serverless_cs_job") {
      return { data: "running", error: null };
    }
    if (name === REQUEUE_RPC) {
      requeues += 1;
      if (firstRetryFailure === "missing_schema") {
        return { data: null, error: { code: "PGRST202" } };
      }
      if (requeues === 1 && firstRetryFailure === "throw") {
        throw new Error("fixture response lost after commit");
      }
      if (requeues === 1 && firstRetryFailure === "returned_error") {
        return { data: null, error: { code: "transport_error" } };
      }
      return { data: receipt, error: null };
    }
    if (name === "sellerpilot_service_serverless_cs_completion_context") {
      return {
        data: {
          status: "running",
          channel: "temu",
          operation: "inquiries.list",
          normalization_timestamp: "2026-09-08T00:00:00.000Z",
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
      return { data: { status: "completed" }, error: null };
    }
    return { data: null, error: { code: "unexpected_rpc" } };
  };
}

for (const firstRetryFailure of ["throw", "returned_error"] as const) {
  test(`gateway exact-replays a ${firstRetryFailure} response-loss shape once`, async () => {
    const calls: RpcCall[] = [];
    const response = await runOneServerlessCsGatewayJob({
      staticEgressChannels: ["temu"],
      rpc: rpcFixture(calls, firstRetryFailure),
      executeProvider: async () => providerFailure,
      logError: () => {},
    }, gatewayTokenHash());

    const body = await response.json();
    assert.equal(response.status, 503, JSON.stringify({ body, calls }));
    assert.deepEqual(body, {
      ok: false,
      status: "failed",
      claimed: 1,
      processed: 0,
      deferred: 1,
      retryScheduled: true,
      retryState: "provider_read_failed",
      retryReceiptReplayed: true,
      jobId: JOB_ID,
      channel: "temu",
      operation: "inquiries.list",
      providerStatus: 503,
      retryCount: 1,
      retryAfterSeconds: 5,
      deferredCount: 1,
      replayCount: 1,
    });
    const requeues = calls.filter((call) => call.name === REQUEUE_RPC);
    assert.equal(requeues.length, 2);
    assert.deepEqual(requeues[1]?.arguments, requeues[0]?.arguments);
    assert.deepEqual(requeues[0]?.arguments, {
      p_token_hash: gatewayTokenHash(),
      p_job_id: JOB_ID,
      p_claim_token: CLAIM_TOKEN,
      p_retry_arguments: retryArguments,
      p_retry_count: 1,
      p_retry_after_seconds: 5,
      p_deferred_count: 1,
      p_replay_count: 1,
      p_provider_status: 503,
    });
    assert.equal(calls.some((call) =>
      call.name === "sellerpilot_service_complete_serverless_cs_transaction"), false);
  });
}

test("gateway preserves an explicit missing retry schema failure without replay", async () => {
  const calls: RpcCall[] = [];
  const response = await runOneServerlessCsGatewayJob({
    staticEgressChannels: ["temu"],
    rpc: rpcFixture(calls, "missing_schema"),
    executeProvider: async () => providerFailure,
    logError: () => {},
  }, gatewayTokenHash());

  const body = await response.json() as { status: string };
  assert.equal(response.status, 200, JSON.stringify({ body, calls }));
  assert.equal(body.status, "failed");
  assert.equal(calls.filter((call) => call.name === REQUEUE_RPC).length, 1);
  const completion = calls.find((call) =>
    call.name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(
    completion?.arguments.p_error_message,
    "TEMU_AFTER_SALES_DETAIL_RETRY_SCHEMA_NOT_READY",
  );
});
