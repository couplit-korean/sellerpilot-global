import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";

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
} = await import("../lib/channels/serverless-gateway");
const { gatewayWorkerCompletionSchema } = await import("../lib/channels/gateway-contract");

const CRON_SECRET = "elevenst-read-observation-test-secret";
const JOB_ID = "10000000-0000-4000-8000-000000000011";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000011";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000011";

const job = {
  id: JOB_ID,
  claim_token: CLAIM_TOKEN,
  credential_id: CREDENTIAL_ID,
  channel: "elevenst" as const,
  operation: "inquiries.list" as const,
  environment: "sandbox" as const,
  request: {
    arguments: {
      kind: "product_qna",
      startDate: "20260902",
      endDate: "20260908",
      answerStatus: "00",
    },
  },
  credential: { api_key: "test-only-elevenst-key" },
  attempt_count: 1,
};

function productQnaBusinessError(): ChannelOperationResult {
  return {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: false,
      status: 200,
      data: {
        accepted: false,
        resultCode: "500",
        productQnas: [],
        sellerpilotInquiryKind: "product_qna",
      },
    }],
    safeMessage: "11st Product Q&A business error.",
  };
}

type RpcCall = { name: string; arguments: Record<string, unknown> };

function rpcFixture(
  calls: RpcCall[],
  observationResponses: Array<{ data: unknown; error: unknown }> = [{
    data: { contract: "sellerpilot-elevenst-cs-read-record/1" },
    error: null,
  }],
) {
  let claimCount = 0;
  let observationCount = 0;
  return async (name: string, arguments_: Record<string, unknown> = {}) => {
    calls.push({ name, arguments: structuredClone(arguments_) });
    if (name === "sellerpilot_claim_serverless_gateway_job") {
      claimCount += 1;
      return { data: claimCount === 1 ? job : null, error: null };
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
    if (name === "sellerpilot_service_serverless_cs_completion_context") {
      return {
        data: {
          status: "running",
          channel: "elevenst",
          operation: "inquiries.list",
          normalization_timestamp: "2026-09-08T08:00:00.000Z",
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
      return { data: { status: "completed" }, error: null };
    }
    if (name === "sellerpilot_service_record_elevenst_cs_read_v1") {
      const response = observationResponses[Math.min(observationCount, observationResponses.length - 1)]!;
      observationCount += 1;
      return response;
    }
    return { data: null, error: { code: "unexpected_rpc" } };
  };
}

function observationCalls(calls: RpcCall[]) {
  return calls.filter(({ name }) => name === "sellerpilot_service_record_elevenst_cs_read_v1");
}

function completionCalls(calls: RpcCall[]) {
  return calls.filter(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
}

test("11st runOne preserves a Product Q&A business failure as a body-free read observation", async () => {
  const calls: RpcCall[] = [];
  const response = await runOneServerlessCsGatewayJob({
    staticEgressChannels: ["elevenst"],
    rpc: rpcFixture(calls),
    executeProvider: async () => productQnaBusinessError(),
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "failed");
  assert.equal(completionCalls(calls).length, 1);
  assert.equal(completionCalls(calls)[0]?.arguments.p_status, "failed");
  assert.deepEqual(completionCalls(calls)[0]?.arguments.p_response_payload, {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries-normalized",
      ok: false,
      status: 200,
      data: {
        sellerpilotMarker: "normalized_inquiries_v1",
        normalizedInquiryCount: 0,
        providerStepCount: 1,
      },
    }],
    safeMessage: "문의 동기화 결과를 정규화해 저장했습니다.",
  });
  assert.equal(observationCalls(calls).length, 1);
  const recorded = observationCalls(calls)[0]?.arguments;
  assert.deepEqual(recorded?.p_inquiries, []);
  const observation = recorded?.p_observation as Record<string, unknown>;
  const { evidenceSha256, ...safeObservation } = observation;
  assert.match(String(evidenceSha256), /^[a-f0-9]{64}$/u);
  assert.deepEqual(safeObservation, {
    surface: "product_qna",
    sellerId: "couplit",
    sellerName: "커플릿",
    scopeStart: "20260902",
    scopeEnd: "20260908",
    statusFilter: "00",
    checkedAt: "2026-09-08T08:00:00.000Z",
    httpStatus: 200,
    accepted: false,
    resultCode: "500",
    providerRows: 0,
    parserMarker: null,
    parseIncomplete: false,
  });
  assert.doesNotMatch(JSON.stringify(recorded), /test-only-elevenst-key/u);
});

test("11st runOne does not invent provider read evidence for a transport exception", async () => {
  const calls: RpcCall[] = [];
  const response = await runOneServerlessCsGatewayJob({
    staticEgressChannels: ["elevenst"],
    rpc: rpcFixture(calls),
    executeProvider: async () => {
      throw new Error("fetch failed");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "failed");
  assert.equal(completionCalls(calls).length, 1);
  assert.equal(observationCalls(calls).length, 0);
});

test("11st runOne retries a lost observation RPC response after durable job completion", async () => {
  const calls: RpcCall[] = [];
  const response = await runOneServerlessCsGatewayJob({
    staticEgressChannels: ["elevenst"],
    rpc: rpcFixture(calls, [
      { data: null, error: { code: "response_lost_after_commit" } },
      { data: { contract: "sellerpilot-elevenst-cs-read-record/1" }, error: null },
    ]),
    executeProvider: async () => productQnaBusinessError(),
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "failed");
  assert.equal(completionCalls(calls).length, 1);
  assert.equal(observationCalls(calls).length, 2);
  assert.deepEqual(observationCalls(calls)[0]?.arguments, observationCalls(calls)[1]?.arguments);
});

test("failed completion evidence is accepted only for the exact 11st inquiry read", () => {
  const exact = {
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "failed",
    error: "provider business failure",
    result: productQnaBusinessError(),
  };
  assert.equal(gatewayWorkerCompletionSchema.safeParse(exact).success, true);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...exact,
    result: { ...productQnaBusinessError(), channel: "qoo10" },
  }).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...exact,
    result: { ...productQnaBusinessError(), ok: true },
  }).success, false);
});
