import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  ebayCaseDisputeGatewayPlan,
  validateEbayCaseDisputeGatewayResult,
} from "../lib/channels/cs/ebay/case-dispute-gateway";
import { executeChannelOperation, type ChannelOperationResult } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const jobId = "10000000-0000-4000-8000-000000000001";
const claimToken = "20000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000001";
const continuationJobId = "40000000-0000-4000-8000-000000000001";
const gatewayTokenHash = "worker-token-hash";
const workerToken = `spw_${"x".repeat(40)}`;

function rootArguments() {
  const root = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[0];
  return {
    periodicKey: root.periodicKey,
    arguments: {
      ...root.arguments,
      collectionRootJobId: jobId,
      collectionPlanKey: root.periodicKey,
    },
  };
}

function paymentArguments() {
  const root = ebayCaseDisputeGatewayPlan(new Date("2026-09-08T13:00:00.000Z")).jobs[2];
  return {
    periodicKey: root.periodicKey,
    arguments: {
      ...root.arguments,
      collectionRootJobId: jobId,
      collectionPlanKey: root.periodicKey,
    },
  };
}

async function firstWindowResult() {
  const request = rootArguments();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      members: [],
      paginationOutput: { limit: 25, offset: 0, totalEntries: 0 },
      totalNumberOfCases: 0,
    });
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      environment: "production",
      payload: {
        access_token: "fixture-token",
        marketplace_id: "EBAY_US",
        ebay_user_id: "fixture-seller",
        provider_account_identity_version: "v1",
        provider_account_subject: "ebay:eias:fixtureSellerEiasToken01",
      },
      arguments: request.arguments,
    });
    validateEbayCaseDisputeGatewayResult({ arguments: request.arguments, result });
    assert.ok(result.continuation);
    return result;
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function unavailablePaymentResult() {
  const request = paymentArguments();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      environment: "production",
      payload: {
        access_token: "fixture-token",
        marketplace_id: "EBAY_US",
        ebay_user_id: "fixture-seller",
        provider_account_identity_version: "v1",
        provider_account_subject: "ebay:eias:fixtureSellerEiasToken01",
      },
      arguments: request.arguments,
    });
    validateEbayCaseDisputeGatewayResult({ arguments: request.arguments, result });
    assert.equal(result.ok, false);
    assert.equal(result.continuation, undefined);
    return result;
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function ledgerReceipt() {
  return {
    contract: "sellerpilot-ebay-case-dispute-gateway-record/1",
    jobId,
    resourceKind: "resolution_case",
    status: "recorded",
    observedCount: 0,
    insertedCount: 0,
  };
}

test("in-process serverless completion records the dedicated page before generic completion creates its child", async () => {
  const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway");
  const result = await firstWindowResult();
  const request = rootArguments();
  const events: string[] = [];
  let claimCount = 0;
  let genericPayload: Record<string, unknown> | null = null;
  const response = await runOneServerlessCsGatewayJob({
    heartbeatIntervalMs: 60_000,
    rpc: async (name, arguments_ = {}) => {
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claimCount += 1;
        return { data: claimCount === 1 ? {
          id: jobId,
          claim_token: claimToken,
          credential_id: credentialId,
          channel: "ebay",
          operation: "inquiries.list",
          environment: "production",
          request,
          credential: {
            access_token: "fixture-token",
            marketplace_id: "EBAY_US",
            ebay_user_id: "fixture-seller",
            provider_account_identity_version: "v1",
            provider_account_subject: "ebay:eias:fixtureSellerEiasToken01",
          },
          attempt_count: 1,
        } : null, error: null };
      }
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") return { data: {
        contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0,
      }, error: null };
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
        status: "running", channel: "ebay", operation: "inquiries.list",
        normalization_timestamp: "2026-09-08T13:01:00.000Z",
      }, error: null };
      if (name === "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2") {
        events.push("dedicated-ledger");
        assert.deepEqual(arguments_.p_continuation_arguments, result.continuation?.arguments);
        return { data: ledgerReceipt(), error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        events.push("generic-completion-child");
        genericPayload = arguments_;
        return { data: { status: "completed", continuationJobId }, error: null };
      }
      return { data: null, error: { code: `unexpected:${name}` } };
    },
    executeProvider: async () => result,
  }, gatewayTokenHash);
  assert.equal(response.status, 200);
  assert.deepEqual(events, ["dedicated-ledger", "generic-completion-child"]);
  assert.deepEqual(genericPayload?.p_response_payload, result,
    "the dedicated envelope reaches generic completion instead of a fabricated zero-inquiry envelope");
  assert.equal(genericPayload?.p_normalized_inquiries, null);
});

test("external worker completion POST records the dedicated page before generic completion creates its child", async () => {
  const result = await firstWindowResult();
  const request = rootArguments();
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const events: string[] = [];
  let genericBody: Record<string, unknown> | null = null;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    process.env.SUPABASE_SECRET_KEY = "service-secret";
    globalThis.fetch = async (input, init) => {
      const fetchRequest = input instanceof Request ? input : new Request(input, init);
      const rpcName = new URL(fetchRequest.url).pathname.split("/").at(-1);
      const body = await fetchRequest.clone().json() as Record<string, unknown>;
      if (rpcName === "sellerpilot_service_gateway_completion_context") return Response.json({
        status: "running",
        channel: "ebay",
        operation: "inquiries.list",
        credential_id: credentialId,
        request,
        normalization_timestamp: "2026-09-08T13:01:00.000Z",
      });
      if (rpcName === "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2") {
        events.push("dedicated-ledger");
        assert.deepEqual(body.p_continuation_arguments, result.continuation?.arguments);
        return Response.json(ledgerReceipt());
      }
      if (rpcName === "sellerpilot_service_complete_gateway_transaction") {
        events.push("generic-completion-child");
        genericBody = body;
        return Response.json({ status: "completed", continuationJobId });
      }
      return Response.json({ message: `unexpected:${rpcName}` }, { status: 500 });
    };
    const { POST } = await import("../app/api/channel-gateway/worker/complete/route");
    const response = await POST(new Request("https://sellerpilot.example/api/channel-gateway/worker/complete", {
      method: "POST",
      headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        jobId,
        claimToken,
        status: "succeeded",
        result: result as ChannelOperationResult,
      }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(events, ["dedicated-ledger", "generic-completion-child"]);
    assert.deepEqual(genericBody?.p_response_payload, JSON.parse(JSON.stringify(result)));
    assert.equal(genericBody?.p_normalized_inquiries, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});

test("unavailable dedicated evidence survives both completion entrypoints without becoming zero inquiries", async () => {
  const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway");
  const result = await unavailablePaymentResult();
  const request = paymentArguments();
  const inProcessEvents: string[] = [];
  let claimCount = 0;
  let inProcessCompletion: Record<string, unknown> | null = null;
  const inProcessResponse = await runOneServerlessCsGatewayJob({
    heartbeatIntervalMs: 60_000,
    rpc: async (name, arguments_ = {}) => {
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claimCount += 1;
        return { data: claimCount === 1 ? {
          id: jobId, claim_token: claimToken, credential_id: credentialId,
          channel: "ebay", operation: "inquiries.list", environment: "production",
          request,
          credential: { access_token: "fixture-token", marketplace_id: "EBAY_US" },
          attempt_count: 1,
        } : null, error: null };
      }
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") return { data: {
        contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0,
      }, error: null };
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
        status: "running", channel: "ebay", operation: "inquiries.list",
        normalization_timestamp: "2026-09-08T13:01:00.000Z",
      }, error: null };
      if (name === "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2") {
        inProcessEvents.push("dedicated-ledger");
        return { data: { ...ledgerReceipt(), resourceKind: "payment_dispute", status: "not_available_blocked" }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        inProcessEvents.push("generic-failed-completion");
        inProcessCompletion = arguments_;
        return { data: { status: "completed", continuationJobId: null }, error: null };
      }
      return { data: null, error: { code: `unexpected:${name}` } };
    },
    executeProvider: async () => result,
  }, gatewayTokenHash);
  assert.equal(inProcessResponse.status, 200);
  assert.deepEqual(inProcessEvents, ["dedicated-ledger", "generic-failed-completion"]);
  assert.equal(inProcessCompletion?.p_status, "failed");
  assert.deepEqual(inProcessCompletion?.p_response_payload, result);
  assert.equal(inProcessCompletion?.p_normalized_inquiries, null);

  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const externalEvents: string[] = [];
  let externalCompletion: Record<string, unknown> | null = null;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    process.env.SUPABASE_SECRET_KEY = "service-secret";
    globalThis.fetch = async (input, init) => {
      const fetchRequest = input instanceof Request ? input : new Request(input, init);
      const rpcName = new URL(fetchRequest.url).pathname.split("/").at(-1);
      const body = await fetchRequest.clone().json() as Record<string, unknown>;
      if (rpcName === "sellerpilot_service_gateway_completion_context") return Response.json({
        status: "running", channel: "ebay", operation: "inquiries.list",
        credential_id: credentialId, request,
        normalization_timestamp: "2026-09-08T13:01:00.000Z",
      });
      if (rpcName === "sellerpilot_service_record_ebay_case_dispute_gateway_page_v2") {
        externalEvents.push("dedicated-ledger");
        return Response.json({ ...ledgerReceipt(), resourceKind: "payment_dispute", status: "not_available_blocked" });
      }
      if (rpcName === "sellerpilot_service_complete_gateway_transaction") {
        externalEvents.push("generic-failed-completion");
        externalCompletion = body;
        return Response.json({ status: "completed", continuationJobId: null });
      }
      return Response.json({ message: `unexpected:${rpcName}` }, { status: 500 });
    };
    const { POST } = await import("../app/api/channel-gateway/worker/complete/route");
    const response = await POST(new Request("https://sellerpilot.example/api/channel-gateway/worker/complete", {
      method: "POST",
      headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId, claimToken, status: "failed", error: result.safeMessage, result }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(externalEvents, ["dedicated-ledger", "generic-failed-completion"]);
    assert.equal(externalCompletion?.p_status, "failed");
    assert.deepEqual(externalCompletion?.p_response_payload, JSON.parse(JSON.stringify(result)));
    assert.equal(externalCompletion?.p_normalized_inquiries, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});
