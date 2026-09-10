import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { completeCsClaim } = await import("../lib/cs/operations/complete.ts");
const { completeCsWorker } = await import("../lib/cs/operations/worker-completion.ts");

const JOB_ID = "72000000-0000-4000-8000-000000000001";
const SOURCE_JOB_ID = "72000000-0000-4000-8000-000000000002";
const DELIVERY_ID = "72000000-0000-4000-8000-000000000003";
const TICKET_ID = "72000000-0000-4000-8000-000000000004";
const CREDENTIAL_ID = "72000000-0000-4000-8000-000000000005";
const CLAIM_TOKEN = "72000000-0000-4000-8000-000000000006";
const TOKEN_HASH = "7".repeat(64);
const INBOUND_KEY = `smartstore:${"8".repeat(64)}`;
const REPLY_FINGERPRINT = "9".repeat(64);

function readbackJob() {
  return {
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel: "smartstore" as const,
    operation: "inquiries.list" as const,
    environment: "production" as const,
    request: {
      periodicKey: `inquiries:reply-readback:smartstore:${DELIVERY_ID}`,
      arguments: {
        kind: "product",
        questionId: "424242",
        query: {
          fromDate: "2026-09-09T09:55:00.000+09:00",
          toDate: "2026-09-09T10:05:00.000+09:00",
          answered: true,
          page: 1,
          size: 100,
        },
      },
      sellerpilotSmartstoreReplyReadback: {
        contract: "sellerpilot-smartstore-reply-readback/1",
        sourceJobId: SOURCE_JOB_ID,
        deliveryId: DELIVERY_ID,
        ticketId: TICKET_ID,
        kind: "product",
        providerTicketId: "424242",
        expectedInboundKey: INBOUND_KEY,
        expectedReplyFingerprint: REPLY_FINGERPRINT,
      },
    },
    credential: {
      client_id: "private-client",
      client_secret: "private-secret",
      account_id: "account-a",
      token_type: "SELLER",
    },
    attempt_count: 1,
    normalization_timestamp: "2026-09-09T01:03:00.000Z",
  };
}

function providerResult() {
  return {
    ok: true,
    channel: "smartstore" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotInquiryKind: "product",
        contents: [{
          questionId: 424242,
          question: "구매자 문의 원본",
          productName: "상품",
          maskedWriterId: "buyer***",
          answered: true,
          createDate: "2026-09-09T10:00:00+09:00",
          answers: [{
            answer: "판매자 답변",
            answerId: 7001,
            createDate: "2026-09-09T10:02:00+09:00",
          }],
        }],
      },
    }],
    safeMessage: "readback complete",
  };
}

test("runtime completes the read-only job, observes replies, then records exact SmartStore evidence", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const dependencies = {
    rpc: async (name: string, arguments_: Record<string, unknown>) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return { data: {
          status: "running", channel: "smartstore", operation: "inquiries.list",
          normalization_timestamp: "2026-09-09T01:03:00.000Z",
        }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_observe_inquiry_replies_v1") {
        const observations = arguments_.p_observations as unknown[];
        return { data: {
          contract: "sellerpilot-reply-observation-result/1",
          received: observations.length, stored: observations.length,
          matched: observations.length, unmatched: 0, ambiguous: 0,
        }, error: null };
      }
      if (name === "sellerpilot_service_record_smartstore_reply_readback_v1") {
        return { data: {
          contract: "sellerpilot-smartstore-reply-readback-result/1",
          deliveryId: DELIVERY_ID,
          state: "verified",
          reason: "exact_reply_observed",
          automaticResendAllowed: false,
        }, error: null };
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
        return { data: {
          contract: "sellerpilot-cs-credential-binding/1", status: "recorded",
        }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  };

  assert.equal(await completeCsClaim(
    dependencies, TOKEN_HASH, readbackJob(),
    { status: "succeeded", result: providerResult() },
  ), "completed");
  const completion = calls.find(call =>
    call.name === "sellerpilot_service_complete_serverless_cs_transaction")!;
  assert.deepEqual(completion.arguments_.p_normalized_inquiries, []);
  const observeIndex = calls.findIndex(call =>
    call.name === "sellerpilot_service_observe_inquiry_replies_v1");
  const readbackIndex = calls.findIndex(call =>
    call.name === "sellerpilot_service_record_smartstore_reply_readback_v1");
  assert.ok(observeIndex > 0);
  assert.ok(readbackIndex > observeIndex);
  assert.deepEqual(calls[readbackIndex]?.arguments_, {
    p_token_hash: TOKEN_HASH,
    p_job_id: JOB_ID,
    p_claim_token: CLAIM_TOKEN,
  });
});

test("runtime records a failed exact read without observations and reports reconciliation", async () => {
  const calls: string[] = [];
  const dependencies = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return { data: {
          status: "running", channel: "smartstore", operation: "inquiries.list",
          normalization_timestamp: "2026-09-09T01:03:00.000Z",
        }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_record_smartstore_reply_readback_v1") {
        return { data: {
          contract: "sellerpilot-smartstore-reply-readback-result/1",
          deliveryId: DELIVERY_ID,
          state: "failed",
          reason: "provider_read_failed",
          automaticResendAllowed: false,
        }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  };
  assert.equal(await completeCsClaim(
    dependencies, TOKEN_HASH, readbackJob(),
    { status: "failed", error: "provider read failed" },
  ), "completed_reconciliation");
  assert.equal(calls.includes("sellerpilot_service_observe_inquiry_replies_v1"), false);
  assert.equal(calls.at(-1), "sellerpilot_service_record_smartstore_reply_readback_v1");
});

function workerService(calls: Array<{ name: string; arguments_: Record<string, unknown> }>, state = "verified") {
  return { rpc: async (name: string, arguments_: Record<string, unknown>) => {
    calls.push({ name, arguments_ });
    if (name === "sellerpilot_service_complete_gateway_transaction") {
      return { data: { status: "completed" }, error: null };
    }
    if (name === "sellerpilot_service_observe_inquiry_replies_v1") {
      const observations = arguments_.p_observations as unknown[];
      return { data: {
        contract: "sellerpilot-reply-observation-result/1",
        received: observations.length, stored: observations.length,
        matched: observations.length, unmatched: 0, ambiguous: 0,
      }, error: null };
    }
    if (name === "sellerpilot_service_record_smartstore_reply_readback_v1") {
      return { data: {
        contract: "sellerpilot-smartstore-reply-readback-result/1",
        deliveryId: DELIVERY_ID,
        state,
        automaticResendAllowed: false,
      }, error: null };
    }
    if (name === "sellerpilot_service_record_cs_history_page_v1") {
      return { data: {
        contract: "cs_history_coverage_v1", status: "ignored", jobId: JOB_ID,
      }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  } };
}

test("external worker suppresses the old inbound row and records exact account, generation, and body evidence", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const job = readbackJob();
  const response = await completeCsWorker({
    serviceClient: workerService(calls) as never,
    tokenHash: TOKEN_HASH,
    job,
    completion: {
      jobId: JOB_ID, claimToken: CLAIM_TOKEN,
      status: "succeeded", result: providerResult(),
    },
  });
  assert.equal(response.status, 200);
  const completion = calls.find(call =>
    call.name === "sellerpilot_service_complete_gateway_transaction")!;
  assert.deepEqual(completion.arguments_.p_normalized_inquiries, []);
  const observation = calls.find(call =>
    call.name === "sellerpilot_service_observe_inquiry_replies_v1")!;
  assert.equal(observation.arguments_.p_credential_id, CREDENTIAL_ID);
  const serialized = JSON.stringify(observation.arguments_.p_observations);
  assert.match(serialized, /424242/);
  assert.match(serialized, /판매자 답변/);
  const observeIndex = calls.indexOf(observation);
  const readbackIndex = calls.findIndex(call =>
    call.name === "sellerpilot_service_record_smartstore_reply_readback_v1");
  assert.ok(readbackIndex > observeIndex);
  assert.deepEqual(calls[readbackIndex]?.arguments_, {
    p_token_hash: TOKEN_HASH, p_job_id: JOB_ID, p_claim_token: CLAIM_TOKEN,
  });
});

test("external worker failed read and completion replay both keep readback fail-closed", async () => {
  const failedCalls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const failed = await completeCsWorker({
    serviceClient: workerService(failedCalls, "failed") as never,
    tokenHash: TOKEN_HASH,
    job: readbackJob(),
    completion: {
      jobId: JOB_ID, claimToken: CLAIM_TOKEN,
      status: "failed", error: "provider read failed",
    },
  });
  assert.equal(failed.status, 200);
  assert.equal(failedCalls.some(call =>
    call.name === "sellerpilot_service_observe_inquiry_replies_v1"), false);
  assert.equal(failedCalls.at(-1)?.name,
    "sellerpilot_service_record_smartstore_reply_readback_v1");

  const replayCalls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const serviceClient = workerService(replayCalls);
  for (let replay = 0; replay < 2; replay += 1) {
    const response = await completeCsWorker({
      serviceClient: serviceClient as never,
      tokenHash: TOKEN_HASH,
      job: readbackJob(),
      completion: {
        jobId: JOB_ID, claimToken: CLAIM_TOKEN,
        status: "succeeded", result: providerResult(),
      },
    });
    assert.equal(response.status, 200);
  }
  assert.equal(replayCalls.filter(call =>
    call.name === "sellerpilot_service_record_smartstore_reply_readback_v1").length, 2);
});
