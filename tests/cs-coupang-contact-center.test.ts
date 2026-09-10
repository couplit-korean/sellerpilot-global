import assert from "node:assert/strict";
import test from "node:test";
import { coupangContactCenterReplyTarget } from "../lib/channels/cs/coupang/contact-center.ts";
import { executeChannelOperation } from "../lib/channels/operations.ts";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync.ts";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols.ts";
import { inquiryReplyObservations } from "../lib/channels/reply-verification.ts";

const payload = {
  access_key: "fixture-access",
  secret_key: "fixture-secret",
  vendor_id: "A00012345",
};

const oldSellerReply = {
  answerId: 4102,
  answerType: "vendor",
  needAnswer: false,
  partnerTransferStatus: "answered",
  replyAt: "2026-09-08T09:10:00+09:00",
  content: "이전 판매자 답변",
};

const newInbound = {
  answerId: 4103,
  answerType: "csAgent",
  needAnswer: true,
  partnerTransferStatus: "requestAnswer",
  replyAt: "2026-09-08T09:20:00+09:00",
  content: "새로 전달된 문의",
};

function inquiry(replies: Record<string, unknown>[]) {
  return {
    inquiryId: 3101,
    inquiryStatus: "progress",
    csPartnerCounselingStatus: "requestAnswer",
    itemName: "익명 상품",
    content: "상담 이력",
    inquiryAt: "2026-09-08T09:00:00+09:00",
    orderId: 2101,
    replies,
  };
}

test("Coupang contact-center target follows the newest inbound, not provider array order", () => {
  const forward = coupangContactCenterReplyTarget(inquiry([oldSellerReply, newInbound]));
  const reverse = coupangContactCenterReplyTarget(inquiry([newInbound, oldSellerReply]));
  assert.deepEqual(reverse, forward);
  assert.deepEqual(forward, {
    state: "ready",
    latestInboundAnswerId: "4103",
    latestInboundAt: "2026-09-08T09:20:00+09:00",
    parentAnswerId: "4103",
  });
});

test("Coupang contact-center target fails closed for multiple parents, stale parents and closed inquiries", () => {
  const secondActionable = {
    ...newInbound,
    answerId: 4104,
    replyAt: "2026-09-08T09:30:00+09:00",
  };
  assert.equal(
    coupangContactCenterReplyTarget(inquiry([newInbound, secondActionable])).state,
    "ambiguous_actionable_parent",
  );

  const laterInboundNotRequestingAnswer = {
    ...newInbound,
    answerId: 4104,
    needAnswer: false,
    partnerTransferStatus: "none",
    replyAt: "2026-09-08T09:30:00+09:00",
  };
  assert.equal(
    coupangContactCenterReplyTarget(inquiry([newInbound, laterInboundNotRequestingAnswer])).state,
    "latest_inbound_mismatch",
  );

  assert.equal(coupangContactCenterReplyTarget({
    ...inquiry([newInbound]),
    inquiryStatus: "complete",
  }).state, "not_replyable");

  const laterSellerReply = {
    ...oldSellerReply,
    answerId: 4105,
    replyAt: "2026-09-08T09:21:00+09:00",
  };
  assert.equal(
    coupangContactCenterReplyTarget(inquiry([newInbound, laterSellerReply])).state,
    "seller_reply_after_inbound",
  );

  const undatedNewInbound = {
    ...newInbound,
    answerId: 4106,
    needAnswer: false,
    partnerTransferStatus: "none",
    replyAt: "invalid-provider-time",
  };
  assert.equal(
    coupangContactCenterReplyTarget(inquiry([newInbound, undatedNewInbound])).state,
    "reply_sequence_unresolved",
  );

  const undatedSellerReply = {
    ...oldSellerReply,
    answerId: 4107,
    replyAt: "",
  };
  assert.equal(
    coupangContactCenterReplyTarget(inquiry([newInbound, undatedSellerReply])).state,
    "reply_sequence_unresolved",
  );
});

test("Coupang contact-center normalization binds the exact latest inbound parent only", () => {
  const result = {
    ok: true as const,
    channel: "coupang" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotInquiryKind: "call-center",
        data: { content: [inquiry([newInbound, oldSellerReply])] },
      },
    }],
    safeMessage: "ok",
  };
  const normalized = normalizeChannelInquiries("coupang", result, "2026-09-08T00:00:00.000Z");
  const ticket = normalized[0];
  assert.equal(ticket?.externalTicketId, "call-center:3101");
  assert.equal(ticket?.externalOrderReference, "2101");
  assert.deepEqual(ticket?.replyContext, {
    parentAnswerId: "4103",
    latestInboundAnswerId: "4103",
    latestInboundAt: "2026-09-08T09:20:00+09:00",
  });
  assert.equal(ticket?.providerContext.replyTargetState, "ready");
});

test("Coupang single-inquiry readback uses the documented vendor-bound GET and normalizes one row", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return Response.json({ code: 200, message: "OK", data: inquiry([newInbound, oldSellerReply]) });
  };
  try {
    const result = await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.list",
      payload,
      arguments: { kind: "call-center-detail", inquiryId: 3101 },
      environment: "production",
    }));
    assert.equal(result.ok, true);
    assert.match(new URL(calledUrl).pathname, /\/v5\/vendors\/callCenterInquiries\/3101$/u);
    assert.equal(new URL(calledUrl).search, "");
    assert.equal(result.steps[0]?.data.sellerpilotReadMode, "call-center-detail");
    const normalized = normalizeChannelInquiries("coupang", result, "2026-09-08T00:00:00.000Z");
    assert.equal(normalized[0]?.externalTicketId, "call-center:3101");
    assert.equal(normalized[0]?.replyContext.parentAnswerId, "4103");
    await assert.rejects(runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.list",
      payload,
      arguments: { kind: "call-center-detail", inquiryId: "wrong-vendor" },
      environment: "production",
    })), /CHANNEL_ARGUMENT_INVALID:inquiryId/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang call-center detail readback produces an exact common reply observation", () => {
  const sellerReply = {
    answerId: 4104,
    parentAnswerId: 4103,
    answerType: "vendor",
    needAnswer: false,
    partnerTransferStatus: "answered",
    replyAt: "2026-09-08T09:25:00+09:00",
    content: "승인된 답변 본문",
  };
  const result = {
    ok: true as const,
    channel: "coupang" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotInquiryKind: "call-center",
        sellerpilotReadMode: "call-center-detail",
        data: inquiry([newInbound, sellerReply]),
      },
    }],
    safeMessage: "ok",
  };
  const normalized = normalizeChannelInquiries("coupang", result, "2026-09-08T00:00:00.000Z");
  const observations = inquiryReplyObservations("coupang", normalized);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.externalTicketId, "call-center:3101");
  assert.equal(observations[0]?.body, "승인된 답변 본문");
  assert.equal(observations[0]?.replyFingerprint.length, 64);
  assert.deepEqual(observations[0]?.binding, {
    kind: "call-center",
    inquiryId: "3101",
    historyOnly: true,
    answerId: "4104",
    parentAnswerId: "4103",
    answerType: "vendor",
    identitySource: "answer_observation_digest",
  });
});

test("Coupang seller history never inherits a newer actionable parent", () => {
  const oldInbound = {
    answerId: 4101,
    answerType: "csAgent",
    needAnswer: false,
    partnerTransferStatus: "answered",
    replyAt: "2026-09-08T09:00:00+09:00",
    content: "이전 전달 문의",
  };
  const boundOldSellerReply = { ...oldSellerReply, parentAnswerId: 4101 };
  const result = {
    ok: true as const,
    channel: "coupang" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotInquiryKind: "call-center",
        sellerpilotReadMode: "call-center-detail",
        data: inquiry([newInbound, boundOldSellerReply, oldInbound]),
      },
    }],
    safeMessage: "ok",
  };
  const normalized = normalizeChannelInquiries("coupang", result, "2026-09-08T00:00:00.000Z");
  assert.equal(normalized[0]?.replyContext.parentAnswerId, "4103");
  const observations = inquiryReplyObservations("coupang", normalized);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.binding.parentAnswerId, "4101");
  assert.notEqual(observations[0]?.binding.parentAnswerId, normalized[0]?.replyContext.parentAnswerId);
});

test("Coupang call-center observation without provider parent stays unbound", () => {
  const result = {
    ok: true as const,
    channel: "coupang" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotInquiryKind: "call-center",
        sellerpilotReadMode: "call-center-detail",
        data: inquiry([newInbound, oldSellerReply]),
      },
    }],
    safeMessage: "ok",
  };
  const observations = inquiryReplyObservations(
    "coupang",
    normalizeChannelInquiries("coupang", result, "2026-09-08T00:00:00.000Z"),
  );
  assert.equal(observations.length, 1);
  assert.equal(Object.hasOwn(observations[0]?.binding ?? {}, "parentAnswerId"), false);
});

test("Coupang contact-center list never exceeds the documented 30-row page cap", async () => {
  const originalFetch = globalThis.fetch;
  let pageSize = "";
  globalThis.fetch = async (input) => {
    pageSize = new URL(String(input)).searchParams.get("pageSize") ?? "";
    return Response.json({ code: 200, message: "OK", data: { content: [], pagination: { totalPages: 0 } } });
  };
  try {
    await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "call-center",
        query: {
          inquiryStartAt: "2026-09-02",
          inquiryEndAt: "2026-09-08",
          partnerCounselingStatus: "NONE",
          pageNum: 1,
          pageSize: 50,
        },
      },
      environment: "production",
    }));
    assert.equal(pageSize, "30");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
