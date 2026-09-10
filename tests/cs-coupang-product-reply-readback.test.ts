import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executeCsOperation } from "../lib/cs/operations/execute";
import {
  evaluateCoupangProductReplyReadback,
  parseCoupangProductReplyReadbackArguments,
} from "../lib/channels/cs/coupang/product-reply-readback";

const sourceJobId = "00000000-0000-4000-8000-000000000101";
const ticketId = "00000000-0000-4000-8000-000000000102";
const answer = "확인된 답변입니다.";
const fingerprint = createHash("sha256").update(answer).digest("hex");

function args(attempt = 0) {
  return {
    kind: "product-reply-readback",
    inquiryId: "3101",
    sourceJobId,
    ticketId,
    expectedInboundKey: `coupang:${"a".repeat(64)}`,
    expectedReplyFingerprint: fingerprint,
    sellerpilotCoupangReadbackAttempt: attempt,
    query: {
      answeredType: "ALL",
      inquiryStartAt: "2025-01-12",
      inquiryEndAt: "2025-01-18",
      pageNum: 1,
      pageSize: 50,
    },
  };
}

function providerStep(status: number, data: Record<string, unknown>) {
  return { name: "inquiries", ok: status === 200, status, data };
}

test("old product inquiry readback keeps its frozen seven-day window and observes exact reply", async () => {
  const originalFetch = globalThis.fetch;
  let called = "";
  globalThis.fetch = async (input) => {
    called = String(input);
    return Response.json({ code: "200", data: { content: [{
      inquiryId: 3101,
      content: "오래된 질문",
      inquiryAt: "2025-01-15T08:00:00+09:00",
      commentDtoList: [{ inquiryCommentId: 9, inquiryId: 3101, content: answer,
        inquiryCommentAt: "2026-09-09T12:30:00+09:00" }],
    }], pagination: { currentPage: 1, totalPages: 1, totalElements: 1, countPerPage: 50 } } });
  };
  try {
    const result = await executeCsOperation({
      channel: "coupang", operation: "inquiries.list", environment: "production",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: args(),
    });
    const url = new URL(called);
    assert.equal(url.pathname, "/v2/providers/openapi/apis/api/v5/vendors/A00012345/onlineInquiries");
    assert.equal(url.searchParams.get("answeredType"), "ALL");
    assert.equal(url.searchParams.get("inquiryStartAt"), "2025-01-12");
    assert.equal(url.searchParams.get("inquiryEndAt"), "2025-01-18");
    assert.equal(url.searchParams.get("pageSize"), "50");
    assert.equal(url.searchParams.has("parentAnswerId"), false);
    assert.equal(result.ok, true);
    assert.equal(result.retryContinuation, undefined);
    assert.equal(result.steps[0]?.data.sellerpilotProductReplyReadback &&
      (result.steps[0].data.sellerpilotProductReplyReadback as Record<string, unknown>).status, "observed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transport failure creates only two bounded read-only retries", () => {
  const first = evaluateCoupangProductReplyReadback({
    arguments_: args(), parsed: parseCoupangProductReplyReadbackArguments(args()),
    providerStep: providerStep(0, { code: "transport_error" }),
  });
  assert.deepEqual({ count: first.retryContinuation?.retryCount, delay: first.retryContinuation?.retryAfterSeconds },
    { count: 1, delay: 15 });
  assert.equal(first.retryContinuation?.arguments.kind, "product-reply-readback");

  const secondArgs = args(1);
  const second = evaluateCoupangProductReplyReadback({
    arguments_: secondArgs, parsed: parseCoupangProductReplyReadbackArguments(secondArgs),
    providerStep: providerStep(503, { code: "unavailable" }),
  });
  assert.deepEqual({ count: second.retryContinuation?.retryCount, delay: second.retryContinuation?.retryAfterSeconds },
    { count: 2, delay: 60 });

  const lastArgs = args(2);
  const last = evaluateCoupangProductReplyReadback({
    arguments_: lastArgs, parsed: parseCoupangProductReplyReadbackArguments(lastArgs),
    providerStep: providerStep(503, { code: "unavailable" }),
  });
  assert.equal(last.retryContinuation, undefined);
  assert.equal(last.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
  assert.equal(last.steps.some((step) => step.name === "inquiry-reply"), false);
});

test("missing answer retries from page one while parentAnswerId ambiguity reconciles", () => {
  const first = evaluateCoupangProductReplyReadback({
    arguments_: args(), parsed: parseCoupangProductReplyReadbackArguments(args()),
    providerStep: providerStep(200, { data: { content: [{ inquiryId: 3101, content: "질문", commentDtoList: [] }],
      pagination: { currentPage: 1, totalPages: 1 } } }),
  });
  assert.equal(first.retryContinuation?.providerStatus, 404);
  assert.equal((first.retryContinuation?.arguments.query as Record<string, unknown>).pageNum, 1);

  const ambiguous = evaluateCoupangProductReplyReadback({
    arguments_: args(), parsed: parseCoupangProductReplyReadbackArguments(args()),
    providerStep: providerStep(200, { data: { content: [{ inquiryId: 3101, content: "질문",
      parentAnswerId: 55, commentDtoList: [] }], pagination: { totalPages: 1 } } }),
  });
  assert.equal(ambiguous.retryContinuation, undefined);
  assert.equal(ambiguous.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
  assert.throws(() => parseCoupangProductReplyReadbackArguments({ ...args(), parentAnswerId: "55" }),
    /PARENT_ANSWER_AMBIGUOUS/u);
});

test("pagination stays inside the frozen window and is capped at fifty pages", () => {
  const decision = evaluateCoupangProductReplyReadback({
    arguments_: args(), parsed: parseCoupangProductReplyReadbackArguments(args()),
    providerStep: providerStep(200, { data: { content: [], pagination: { currentPage: 1, totalPages: 3 } } }),
  });
  assert.equal((decision.continuationArguments?.query as Record<string, unknown>).pageNum, 2);
  assert.equal((decision.continuationArguments?.query as Record<string, unknown>).inquiryStartAt, "2025-01-12");
  assert.equal(decision.retryContinuation, undefined);
  for (const attempt of [0, 1, 2]) {
    const finalPageArguments = {
      ...args(attempt),
      query: { ...args(attempt).query, pageNum: 50 },
    };
    const finalPage = evaluateCoupangProductReplyReadback({
      arguments_: finalPageArguments,
      parsed: parseCoupangProductReplyReadbackArguments(finalPageArguments),
      providerStep: providerStep(200, { data: { content: [], pagination: { currentPage: 50, totalPages: 500 } } }),
    });
    assert.equal(finalPage.continuationArguments, undefined);
    assert.equal(finalPage.retryContinuation?.retryCount, attempt < 2 ? attempt + 1 : undefined);
    if (attempt < 2) {
      assert.equal((finalPage.retryContinuation?.arguments.query as Record<string, unknown>).pageNum, 1);
    } else {
      assert.equal(finalPage.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
    }
  }
  assert.throws(() => parseCoupangProductReplyReadbackArguments({
    ...args(),query:{...args().query,pageNum:51},
  }),/ARGUMENT_INVALID/u);
});
