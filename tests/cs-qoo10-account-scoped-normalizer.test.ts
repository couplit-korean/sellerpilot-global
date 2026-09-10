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

const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync.ts");
const { prepareQoo10Reply } = await import("../lib/channels/cs/qoo10/reply-guard.ts");

const ownerId = "00000000-0000-4000-8000-000000000001";
const credentialA = "00000000-0000-4000-8000-000000000002";
const credentialB = "00000000-0000-4000-8000-000000000003";

function providerResult(sequenceNo = "701") {
  return {
    ok: true,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "GetInquiryMessage",
      ok: true,
      status: 200,
      data: { ResultCode: 0, ResultObject: [{
        INQ_TYPE: "MSG",
        QUESTION_NO: "700",
        SEQ_NO: sequenceNo,
        CONTENTS: "fixture question",
        STATUS: "S1",
        INQ_DT: "20260909010000",
      }] },
    }],
    safeMessage: "fixture only",
  };
}

function normalized(sellerAccountKey: string, sourceCredentialId: string, sequenceNo = "701") {
  return normalizeChannelInquiries("qoo10", providerResult(sequenceNo), "2026-09-09T01:01:00.000Z", {
    qoo10Identity: {
      account: { ownerId, sellerAccountKey, environment: "production" },
      sourceCredentialId,
    },
  })[0]!;
}

test("same provider question is isolated between two seller accounts in the common normalizer", () => {
  const first = normalized("a".repeat(64), credentialA);
  const second = normalized("b".repeat(64), credentialB);
  assert.equal(first.providerContext.providerExternalTicketId, "qoo10:v2:MSG:700");
  assert.equal(second.providerContext.providerExternalTicketId, "qoo10:v2:MSG:700");
  assert.notEqual(first.externalTicketId, second.externalTicketId);
  assert.notEqual(first.inboundKey, second.inboundKey);
  assert.match(first.externalTicketId, /^qoo10:conversation:[a-f0-9]{64}$/u);
  assert.match(first.inboundKey, /^qoo10:inbound:[a-f0-9]{64}$/u);
});

test("credential rotation within one seller account preserves storage and inbound identities", () => {
  const before = normalized("a".repeat(64), credentialA);
  const after = normalized("a".repeat(64), credentialB);
  assert.equal(after.externalTicketId, before.externalTicketId);
  assert.equal(after.inboundKey, before.inboundKey);
});

test("next sequence stays in one account-scoped conversation and fences stale reply selection", () => {
  const oldSequence = normalized("a".repeat(64), credentialA, "701");
  const newSequence = normalized("a".repeat(64), credentialB, "702");
  assert.equal(newSequence.externalTicketId, oldSequence.externalTicketId);
  assert.notEqual(newSequence.inboundKey, oldSequence.inboundKey);
  assert.deepEqual(prepareQoo10Reply({
    externalTicketId: newSequence.externalTicketId,
    replyText: "new target reply",
    replyContext: newSequence.replyContext,
    providerContext: newSequence.providerContext,
    selectedInboundKey: newSequence.inboundKey,
    latestInboundKey: newSequence.inboundKey,
    approved: true,
  }).params, {
    inq_type: "MSG", question_no: "700", seq_no: "702", contents: "new target reply",
  });
  assert.throws(() => prepareQoo10Reply({
    externalTicketId: oldSequence.externalTicketId,
    replyText: "stale target reply",
    replyContext: oldSequence.replyContext,
    providerContext: oldSequence.providerContext,
    selectedInboundKey: oldSequence.inboundKey,
    latestInboundKey: newSequence.inboundKey,
    approved: true,
  }), /QOO10_REPLY_STALE_TARGET/u);
});

test("same provider claim is isolated by account while credential rotation preserves its lineage", () => {
  const claimResult = {
    ok: true,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: [{ name: "GetClaimInfo_V3", ok: true, status: 200, data: {
      sellerpilotInquiryKind: "claim",
      ResultCode: 0,
      ResultObject: [{
        claimStatus: "4", requestDate: "20260909010000",
        orderNo: "901234567890", reason: "fixture claim",
      }],
    } }],
    safeMessage: "fixture only",
  };
  const claim = (sellerAccountKey: string, sourceCredentialId: string) => normalizeChannelInquiries(
    "qoo10", claimResult, "2026-09-09T01:01:00.000Z", {
      qoo10Identity: {
        account: { ownerId, sellerAccountKey, environment: "production" },
        sourceCredentialId,
      },
    },
  )[0]!;
  const first = claim("a".repeat(64), credentialA);
  const rotated = claim("a".repeat(64), credentialB);
  const otherAccount = claim("b".repeat(64), credentialB);
  assert.match(first.externalTicketId, /^qoo10:claim-conversation:[a-f0-9]{64}$/u);
  assert.match(first.inboundKey, /^qoo10:claim-inbound:[a-f0-9]{64}$/u);
  assert.equal(rotated.externalTicketId, first.externalTicketId);
  assert.equal(rotated.inboundKey, first.inboundKey);
  assert.notEqual(otherAccount.externalTicketId, first.externalTicketId);
  assert.notEqual(otherAccount.inboundKey, first.inboundKey);
  assert.deepEqual(first.providerContext.legacyExternalTicketIds, [
    "qoo10:claim:901234567890:20260908160000",
  ]);
});

test("account-scoped ticket remains replyable through its exact provider and legacy aliases", () => {
  const inquiry = normalized("a".repeat(64), credentialA);
  const prepared = prepareQoo10Reply({
    externalTicketId: inquiry.externalTicketId,
    replyText: "fixture reply",
    replyContext: inquiry.replyContext,
    providerContext: inquiry.providerContext,
    selectedInboundKey: inquiry.inboundKey,
    latestInboundKey: inquiry.inboundKey,
    approved: true,
  });
  assert.equal(prepared.compatibility.ticketIdentity, "account-scoped-v2");
  assert.deepEqual(prepared.params, {
    inq_type: "MSG",
    question_no: "700",
    seq_no: "701",
    contents: "fixture reply",
  });
  assert.throws(() => prepareQoo10Reply({
    externalTicketId: inquiry.externalTicketId,
    replyText: "fixture reply",
    replyContext: inquiry.replyContext,
    providerContext: inquiry.providerContext,
    selectedInboundKey: `qoo10:inbound:${"f".repeat(64)}`,
    latestInboundKey: `qoo10:inbound:${"f".repeat(64)}`,
    approved: true,
  }), /QOO10_REPLY_TARGET_INVALID/u);
});
