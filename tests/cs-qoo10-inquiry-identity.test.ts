import assert from "node:assert/strict";
import test from "node:test";
import {
  groupQoo10InquiryConversationIdentities,
  qoo10InquiryMessageIdentity,
} from "../lib/channels/cs/qoo10/inquiry-identity.ts";
import { prepareQoo10Reply } from "../lib/channels/cs/qoo10/reply-guard.ts";

const account = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  sellerAccountKey: "a".repeat(64),
  environment: "production" as const,
};
const credential = "00000000-0000-4000-8000-000000000002";

function message(sequenceNo: string, overrides: Record<string, unknown> = {}) {
  return {
    account,
    sourceCredentialId: credential,
    inquiryType: "MSG" as const,
    questionNo: "700",
    sequenceNo,
    ...overrides,
  };
}

test("Qoo10 groups multiple sequences for one question while preserving each inbound identity", () => {
  const conversations = groupQoo10InquiryConversationIdentities([
    message("702"),
    message("701"),
  ]);
  assert.equal(conversations.length, 1);
  const conversation = conversations[0]!;
  assert.equal(conversation.externalTicketId, "qoo10:v2:MSG:700");
  assert.equal(conversation.ticketIdentityVersion, "qoo10-thread-v2");
  assert.deepEqual(conversation.messages.map((entry) => entry.sequenceNo), ["701", "702"]);
  assert.deepEqual(conversation.messages.map((entry) => entry.remoteMessageId), ["701", "702"]);
  assert.equal(new Set(conversation.messages.map((entry) => entry.accountScopedInboundKey)).size, 2);
  assert.equal(new Set(conversation.messages.map((entry) => entry.messageIdentityDigest)).size, 2);
  assert.deepEqual(conversation.legacyExternalTicketIds, [
    "qoo10:MSG:700:701",
    "qoo10:MSG:700:702",
  ]);
});

test("Qoo10 duplicate observation of one sequence does not erase a different sequence", () => {
  const conversations = groupQoo10InquiryConversationIdentities([
    message("701"),
    message("701"),
    message("702"),
  ]);
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0]!.messages.length, 2);
  assert.deepEqual(conversations[0]!.messages.map((entry) => entry.sequenceNo), ["701", "702"]);
});

test("Qoo10 keeps the same provider question isolated between seller accounts", () => {
  const secondAccount = { ...account, sellerAccountKey: "b".repeat(64) };
  const conversations = groupQoo10InquiryConversationIdentities([
    message("701"),
    message("701", { account: secondAccount }),
  ]);
  assert.equal(conversations.length, 2);
  assert.equal(new Set(conversations.map((entry) => entry.externalTicketId)).size, 1);
  assert.equal(new Set(conversations.map((entry) => entry.accountScopedConversationKey)).size, 2);
  assert.equal(new Set(conversations.map((entry) => entry.account.accountIdentityDigest)).size, 2);
});

test("Qoo10 credential rotation preserves account conversation and message identity", () => {
  const rotatedCredential = "00000000-0000-4000-8000-000000000003";
  const before = qoo10InquiryMessageIdentity(message("701"));
  const after = qoo10InquiryMessageIdentity(message("701", { sourceCredentialId: rotatedCredential }));
  assert.equal(after.accountScopedConversationKey, before.accountScopedConversationKey);
  assert.equal(after.accountScopedInboundKey, before.accountScopedInboundKey);
  assert.notEqual(after.sourceCredentialId, before.sourceCredentialId);
});

test("Qoo10 sequence reuse across questions remains two conversations and two inbound messages", () => {
  const conversations = groupQoo10InquiryConversationIdentities([
    message("701", { questionNo: "700" }),
    message("701", { questionNo: "800" }),
  ]);
  assert.equal(conversations.length, 2);
  assert.equal(new Set(conversations.map((entry) => entry.externalTicketId)).size, 2);
  assert.equal(new Set(conversations.flatMap((entry) => entry.messages.map((message_) => message_.accountScopedInboundKey))).size, 2);
});

test("Qoo10 identity contract rejects missing account scope and invalid provider identity", () => {
  assert.throws(() => qoo10InquiryMessageIdentity(message("701", {
    account: { ...account, sellerAccountKey: "not-a-key" },
  })), /QOO10_INQUIRY_ACCOUNT_IDENTITY_INVALID/u);
  assert.throws(() => qoo10InquiryMessageIdentity(message("bad")), /QOO10_INQUIRY_MESSAGE_IDENTITY_INVALID/u);
  assert.throws(() => qoo10InquiryMessageIdentity(message("701", {
    sourceCredentialId: "not-a-uuid",
  })), /QOO10_INQUIRY_MESSAGE_IDENTITY_INVALID/u);
});

test("Qoo10 account-scoped ticket keeps the exact legacy reply target readable", () => {
  const identity = qoo10InquiryMessageIdentity(message("701"));
  const prepared = prepareQoo10Reply({
    externalTicketId: identity.accountScopedConversationKey,
    replyText: "확인했습니다.",
    replyContext: {
      inquiryType: identity.inquiryType,
      questionNo: identity.questionNo,
      sequenceNo: identity.sequenceNo,
      legacyExternalTicketId: identity.legacyExternalTicketId,
    },
    providerContext: {
      inquiryType: identity.inquiryType,
      questionNo: identity.questionNo,
      sequenceNo: identity.sequenceNo,
      processingStatus: "S1",
      providerExternalTicketId: identity.externalTicketId,
      ticketIdentityVersion: identity.ticketIdentityVersion,
      accountIdentityDigest: identity.account.accountIdentityDigest,
      conversationIdentityDigest: identity.conversationIdentityDigest,
      messageIdentityDigest: identity.messageIdentityDigest,
      legacyExternalTicketIds: [identity.legacyExternalTicketId],
    },
    selectedInboundKey: identity.accountScopedInboundKey,
    latestInboundKey: identity.accountScopedInboundKey,
    approved: true,
  });
  assert.equal(prepared.compatibility.ticketIdentity, "account-scoped-v2");
  assert.deepEqual(prepared.params, {
    inq_type: "MSG",
    question_no: "700",
    seq_no: "701",
    contents: "확인했습니다.",
  });
});

test("Qoo10 account-scoped reply rejects another account message digest", () => {
  const first = qoo10InquiryMessageIdentity(message("701"));
  const other = qoo10InquiryMessageIdentity(message("701", {
    account: { ...account, sellerAccountKey: "b".repeat(64) },
  }));
  assert.throws(() => prepareQoo10Reply({
    externalTicketId: first.accountScopedConversationKey,
    replyText: "확인했습니다.",
    replyContext: {
      inquiryType: first.inquiryType,
      questionNo: first.questionNo,
      sequenceNo: first.sequenceNo,
      legacyExternalTicketId: first.legacyExternalTicketId,
    },
    providerContext: {
      inquiryType: first.inquiryType,
      questionNo: first.questionNo,
      sequenceNo: first.sequenceNo,
      processingStatus: "S1",
      providerExternalTicketId: first.externalTicketId,
      ticketIdentityVersion: first.ticketIdentityVersion,
      accountIdentityDigest: first.account.accountIdentityDigest,
      conversationIdentityDigest: first.conversationIdentityDigest,
      messageIdentityDigest: first.messageIdentityDigest,
      legacyExternalTicketIds: [first.legacyExternalTicketId],
    },
    selectedInboundKey: other.accountScopedInboundKey,
    latestInboundKey: other.accountScopedInboundKey,
    approved: true,
  }), /QOO10_REPLY_TARGET_INVALID/u);
});
