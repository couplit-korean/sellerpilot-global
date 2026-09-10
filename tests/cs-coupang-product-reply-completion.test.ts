import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ProviderJob } from "../lib/channels/provider-execution-contract";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export default {}" }
      : nextResolve(specifier, context);
  },
});
const { completeCsClaim } = await import("../lib/cs/operations/complete");
const { completeCsWorker, completeCsWorkerRetry } = await import("../lib/cs/operations/worker-completion");
const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway");

const jobId = "00000000-0000-4000-8000-000000000201";
const claimToken = "00000000-0000-4000-8000-000000000202";
const credentialId = "00000000-0000-4000-8000-000000000203";
const sourceJobId = "00000000-0000-4000-8000-000000000204";
const ticketId = "00000000-0000-4000-8000-000000000205";
const body = "구매자에게 확인된 답변";
const fingerprint = createHash("sha256").update(body).digest("hex");

const arguments_ = {
  kind: "product-reply-readback", inquiryId: "3101", sourceJobId, ticketId,
  expectedInboundKey: `coupang:${"a".repeat(64)}`,
  expectedReplyFingerprint: fingerprint,
  sellerpilotCoupangReadbackAttempt: 0,
  query: { answeredType: "ALL", inquiryStartAt: "2025-01-12", inquiryEndAt: "2025-01-18", pageNum: 1, pageSize: 50 },
};
const result = {
  ok: true as const,
  channel: "coupang" as const,
  operation: "inquiries.list" as const,
  steps: [{ name: "inquiries", ok: true, status: 200, data: {
    sellerpilotInquiryKind: "product",
    sellerpilotProductReplyReadback: {
      contract: "sellerpilot-coupang-product-reply-readback/1",status: "observed",
      inquiryId: "3101",sourceJobId,ticketId,expectedInboundKey: arguments_.expectedInboundKey,
      expectedReplyFingerprint: fingerprint,attempt: 0,
    },
    data: { content: [{ inquiryId: 9999, content: "다른 구매자 질문", inquiryAt: "2025-01-15T08:00:00+09:00",
      commentDtoList: [{ inquiryCommentId: 8, inquiryId: 9999, content: "다른 판매자 답변",
        inquiryCommentAt: "2026-09-09T12:29:00+09:00" }] },
    { inquiryId: 3101, content: "오래된 질문", inquiryAt: "2025-01-15T08:00:00+09:00",
      commentDtoList: [{ inquiryCommentId: 9, inquiryId: 3101, content: body,
        inquiryCommentAt: "2026-09-09T12:30:00+09:00" }] }],
      pagination: { currentPage: 1, totalPages: 1, totalElements: 1, countPerPage: 50 } },
  } }],
  safeMessage: "쿠팡 답변 조회 완료",
};

const providerJob: ProviderJob = {
  id: jobId, claim_token: claimToken, credential_id: credentialId,
  channel: "coupang", operation: "inquiries.list", environment: "production",
  request: { periodicKey: `inquiries:product-reply-readback:${sourceJobId}`, arguments: arguments_ },
  credential: {}, attempt_count: 1,
};

function rpcResult(name: string) {
  if (name.includes("completion_context")) return {
    status: "running", channel: "coupang", operation: "inquiries.list",
    normalization_timestamp: "2026-09-09T03:35:00.000Z",
  };
  if (name.includes("complete_")) return { status: "completed" };
  if (name === "sellerpilot_service_observe_inquiry_replies_v1") return {
    contract: "sellerpilot-reply-observation-result/1", received: 1, stored: 1,
    matched: 1, unmatched: 0, ambiguous: 0,
  };
  if (name === "sellerpilot_service_record_cs_history_page_v1") return {
    contract: "cs_history_coverage_v1", status: "completed", jobId,
  };
  return null;
}

test("serverless completion sends the exact product reply into delivery observation once", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const status = await completeCsClaim({ rpc: async (name, args = {}) => {
    calls.push({ name, args });
    return { data: rpcResult(name), error: null };
  } }, "token-hash", providerJob, { status: "succeeded", result });
  assert.equal(status, "completed");
  const observations = calls.filter((call) => call.name === "sellerpilot_service_observe_inquiry_replies_v1");
  assert.equal(observations.length, 1);
  const rows = observations[0]!.args.p_observations as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.replyFingerprint, fingerprint);
  assert.deepEqual(rows[0]?.binding, { kind: "product", inquiryId: "3101", historyOnly: true,
    answerId: "9", answerType: "vendor", identitySource: "answer_observation_digest" });
  const completion = calls.find((call) => call.name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.deepEqual(completion?.args.p_normalized_inquiries, []);
  assert.match(JSON.stringify(completion?.args.p_response_payload), /sellerpilot-coupang-product-reply-readback-evidence\/1/u);
  assert.doesNotMatch(JSON.stringify(completion?.args.p_response_payload), /다른 구매자 질문|다른 판매자 답변/u);
});

test("worker completion sends the same exact product reply into delivery observation once", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  const serviceClient = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: rpcResult(name), error: null };
  } };
  const response = await completeCsWorker({
    serviceClient: serviceClient as never,
    tokenHash: "token-hash",
    job: { ...providerJob, normalization_timestamp: "2026-09-09T03:35:00.000Z" },
    completion: { jobId, claimToken, status: "succeeded", result },
  });
  assert.equal(response.status, 200);
  const observations = calls.filter((call) => call.name === "sellerpilot_service_observe_inquiry_replies_v1");
  assert.equal(observations.length, 1);
  const rows = observations[0]!.args?.p_observations as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.replyFingerprint, fingerprint);
  assert.equal((rows[0]?.binding as Record<string, unknown>).inquiryId, "3101");
  assert.equal(calls.some((call) => call.name.includes("reply") && call.name.includes("requeue")), false);
  const completion = calls.find((call) => call.name === "sellerpilot_service_complete_gateway_transaction");
  assert.deepEqual(completion?.args?.p_normalized_inquiries, []);
  assert.match(JSON.stringify(completion?.args?.p_response_payload), /sellerpilot-coupang-product-reply-readback-evidence\/1/u);
  assert.doesNotMatch(JSON.stringify(completion?.args?.p_response_payload), /다른 구매자 질문|다른 판매자 답변/u);
});

const retryContinuation = {
  reason: "retryable_read_failure" as const,
  arguments: { ...arguments_, sellerpilotCoupangReadbackAttempt: 1 },
  retryCount: 1,
  retryAfterSeconds: 15,
  deferredCount: 1,
  replayCount: 0,
  providerStatus: 503,
};

test("worker retry entrypoint schedules the exact Coupang read job and never completes it", async () => {
  const calls: string[] = [];
  const response = await completeCsWorkerRetry({ rpc: async (name: string) => {
    calls.push(name);
    return { data: { contract: "sellerpilot-coupang-product-reply-readback-retry/1",
      status: "deferred", retryCount: 1, retryAfterSeconds: 15,
      failureCode: "COUPANG_PRODUCT_REPLY_READBACK_PENDING", replayed: false }, error: null };
  } } as never, "token-hash", {
    jobId, claimToken, status: "failed", error: "pending",
    result: { ...result, ok: false, steps: [{ name: "inquiries", ok: false, status: 503, data: {} }] },
    retryContinuation,
  });
  assert.equal(response?.status, 202);
  assert.deepEqual(calls, ["sellerpilot_service_requeue_coupang_product_reply_readback_v1"]);
});

test("serverless retry entrypoint schedules Coupang readback without generic completion", async () => {
  const calls: string[] = [];
  let claims=0;
  const response = await runOneServerlessCsGatewayJob({
    staticEgressChannels: ["coupang"],
    rpc: async (name) => {
      calls.push(name);
      if (name === "sellerpilot_claim_serverless_gateway_job") return { data: claims++ === 0 ? providerJob : null, error: null };
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") return { data: {
        contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0 }, error: null };
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_requeue_coupang_product_reply_readback_v1") return { data: {
        contract: "sellerpilot-coupang-product-reply-readback-retry/1", status: "deferred",
        retryCount: 1, retryAfterSeconds: 15,
        failureCode: "COUPANG_PRODUCT_REPLY_READBACK_PENDING", replayed: false }, error: null };
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async () => ({
      ...result, ok: false,
      steps: [{ name: "inquiries", ok: false, status: 503, data: {} }],
      retryContinuation,
    }),
  }, "token-hash");
  assert.equal(response.status, 503);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.retryScheduled, true);
  assert.equal(payload.retryState, "reply_readback_pending");
  assert.equal(calls.filter((name) => name === "sellerpilot_service_requeue_coupang_product_reply_readback_v1").length, 1);
  assert.equal(calls.some((name) => name.includes("complete_serverless_cs_transaction")), false);
});
