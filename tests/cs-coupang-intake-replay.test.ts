import assert from "node:assert/strict";
import test from "node:test";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync.ts";
import { inquiryReplyObservations } from "../lib/channels/reply-verification.ts";

function result(kind: "product" | "call-center", row: Record<string, unknown>) {
  return {
    ok: true as const,
    channel: "coupang" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: { sellerpilotInquiryKind: kind, data: { content: [row] } },
    }],
    safeMessage: "ok",
  };
}

function byRemoteId(rows: ReturnType<typeof normalizeChannelInquiries>) {
  return new Map(rows.map((row) => [row.remoteMessageId, row]));
}

test("same call-center window is replay-stable while a new re-inquiry adds exactly one event", () => {
  const oldInbound = {
    answerId: 7101,
    answerType: "csAgent",
    needAnswer: false,
    partnerTransferStatus: "answered",
    replyAt: "2026-09-08T09:00:00+09:00",
    content: "이전 합성 전달",
  };
  const oldSeller = {
    answerId: 7102,
    parentAnswerId: 7101,
    answerType: "vendor",
    needAnswer: false,
    partnerTransferStatus: "answered",
    replyAt: "2026-09-08T09:05:00+09:00",
    content: "이전 합성 답변",
  };
  const newInbound = {
    answerId: 7103,
    answerType: "csAgent",
    needAnswer: true,
    partnerTransferStatus: "requestAnswer",
    replyAt: "2026-09-08T09:20:00+09:00",
    content: "새 합성 재문의",
  };
  const base = {
    inquiryId: 6101,
    inquiryStatus: "progress",
    csPartnerCounselingStatus: "requestAnswer",
    itemName: "합성 상품",
    content: "합성 상담",
    inquiryAt: "2026-09-08T08:50:00+09:00",
    orderId: 5101,
  };
  const first = normalizeChannelInquiries("coupang", result("call-center", {
    ...base, replies: [oldSeller, oldInbound],
  }), "2026-09-08T00:00:00.000Z");
  const replay = normalizeChannelInquiries("coupang", result("call-center", {
    ...base, replies: [oldInbound, oldSeller],
  }), "2026-09-08T00:00:00.000Z");
  assert.deepEqual(new Set(first.map((row) => row.inboundKey)), new Set(replay.map((row) => row.inboundKey)));

  const refreshed = normalizeChannelInquiries("coupang", result("call-center", {
    ...base, replies: [newInbound, oldSeller, oldInbound],
  }), "2026-09-08T00:00:00.000Z");
  const firstById = byRemoteId(first);
  const refreshedById = byRemoteId(refreshed);
  for (const [remoteId, row] of firstById) {
    assert.equal(refreshedById.get(remoteId)?.inboundKey, row.inboundKey);
  }
  assert.equal(refreshed.length, first.length + 1);
  assert.equal(refreshed[0]?.externalTicketId, "call-center:6101");
  assert.equal(refreshed[0]?.replyContext.parentAnswerId, "7103");
  assert.equal([...refreshedById.values()].find((row) => row.message === "새 합성 재문의")?.senderRole, "system");
});

test("same product window dedupes old seller history and adds only the late answer", () => {
  const oldAnswer = {
    inquiryCommentId: 8101,
    inquiryCommentAt: "2026-09-08T09:05:00+09:00",
    content: "외부 선답변 합성 본문",
  };
  const lateAnswer = {
    inquiryCommentId: 8102,
    inquiryCommentAt: "2026-09-08T10:05:00+09:00",
    content: "늦은 합성 답변",
  };
  const base = {
    inquiryId: 8001,
    productName: "합성 상품",
    content: "합성 상품 문의",
    inquiryAt: "2026-09-08T09:00:00+09:00",
  };
  const first = normalizeChannelInquiries("coupang", result("product", {
    ...base, commentDtoList: [oldAnswer],
  }), "2026-09-08T00:00:00.000Z");
  const replay = normalizeChannelInquiries("coupang", result("product", {
    ...base, commentDtoList: [oldAnswer],
  }), "2026-09-08T00:00:00.000Z");
  assert.deepEqual(first.map((row) => row.inboundKey), replay.map((row) => row.inboundKey));

  const refreshed = normalizeChannelInquiries("coupang", result("product", {
    ...base, commentDtoList: [oldAnswer, lateAnswer],
  }), "2026-09-08T00:00:00.000Z");
  assert.equal(refreshed.length, first.length + 1);
  const observations = inquiryReplyObservations("coupang", refreshed);
  assert.deepEqual(observations.map((observation) => observation.binding), [
    { kind: "product", inquiryId: "8001", historyOnly: true, answerId: "8101", answerType: "vendor", identitySource: "answer_observation_digest" },
    { kind: "product", inquiryId: "8001", historyOnly: true, answerId: "8102", answerType: "vendor", identitySource: "answer_observation_digest" },
  ]);
});

