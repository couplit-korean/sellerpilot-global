import assert from "node:assert/strict";
import test from "node:test";
import {
  hasProviderReplyAcceptance,
  inquiryReplyObservations,
  replyAcceptanceMarker,
} from "../lib/channels/reply-verification";
import type { ChannelOperationResult } from "../lib/channels/operations";
import type { NormalizedChannelInquiry } from "../lib/channels/inquiry-sync";

test("provider acceptance requires one exact trusted marker", () => {
  const result: ChannelOperationResult = {
    ok: true, channel: "lazada", operation: "inquiries.reply", remoteId: "session-1",
    safeMessage: "accepted", steps: [{ name: "inquiry-reply", ok: true, status: 200, data: {
      sellerpilotReplyAcceptance: replyAcceptanceMarker("lazada", "im", { sessionId: "session-1" }),
    } }],
  };
  assert.equal(hasProviderReplyAcceptance(result), true);
  assert.equal(hasProviderReplyAcceptance({ ...result, steps: [...result.steps, result.steps[0]] }), false);
  assert.equal(hasProviderReplyAcceptance({ ...result, steps: [{ ...result.steps[0], data: {} }] }), false);
  assert.equal(hasProviderReplyAcceptance({ ...result, channel: "shopee" }), false);
});

function inquiry(overrides: Partial<NormalizedChannelInquiry>): NormalizedChannelInquiry {
  return {
    externalTicketId: "customer:701", customerName: "customer", subject: "subject",
    message: "  exact reply\n", status: "resolved", priority: 3,
    receivedAt: "2026-09-08T00:01:00.000Z", remoteMessageId: "answer-702",
    senderRole: "seller", inboundKey: `smartstore:${"a".repeat(64)}`,
    providerStatus: "answered", providerContext: { kind: "customer", inquiryNo: "701" },
    replyContext: { kind: "customer", inquiryNo: "701" }, ticketKind: "conversation",
    ...overrides,
  };
}

test("seller observations retain body evidence and derive exact channel bindings", () => {
  const observations = inquiryReplyObservations("smartstore", [
    inquiry({}),
    inquiry({ senderRole: "customer", remoteMessageId: "customer-message" }),
  ]);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].body, "  exact reply\n");
  assert.equal(observations[0].replyFingerprint.length, 64);
  assert.deepEqual(observations[0].binding, { kind: "customer", inquiryNo: "701" });

  const lazada = inquiryReplyObservations("lazada", [inquiry({
    externalTicketId: "lazada-im:session-9", inboundKey: `lazada:${"b".repeat(64)}`,
    providerContext: { templateId: 1 }, replyContext: undefined,
  })]);
  assert.equal(lazada[0].binding.sessionId, "session-9");
});

test("undated, oversized and foreign-channel observations cannot become readback evidence", () => {
  assert.deepEqual(inquiryReplyObservations("smartstore", [inquiry({ receivedAt: "" })]), []);
  assert.deepEqual(inquiryReplyObservations("smartstore", [inquiry({ message: "x".repeat(20_001) })]), []);
  assert.deepEqual(inquiryReplyObservations("smartstore", [inquiry({ inboundKey: `coupang:${"c".repeat(64)}` })]), []);
});
