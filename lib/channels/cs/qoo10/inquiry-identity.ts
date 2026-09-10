import { createHash } from "node:crypto";
import { qoo10InquiryTypes, type Qoo10InquiryType } from "./contracts.ts";

export const qoo10InquiryIdentityContract = Object.freeze({
  accountVersion: "sellerpilot-qoo10-account-v1" as const,
  ticketVersion: "qoo10-thread-v2" as const,
  messageVersion: "qoo10-message-v2" as const,
});

export type Qoo10InquiryAccountIdentity = {
  ownerId: string;
  sellerAccountKey: string;
  environment: "sandbox" | "production";
};

export type Qoo10InquiryMessageIdentityInput = {
  account: Qoo10InquiryAccountIdentity;
  sourceCredentialId: string;
  inquiryType: Qoo10InquiryType;
  questionNo: string;
  sequenceNo: string;
};

export type Qoo10ClaimIdentityInput = {
  account: Qoo10InquiryAccountIdentity;
  sourceCredentialId: string;
  orderNo: string;
  requestDateKey: string;
  providerRevision: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACCOUNT_KEY_RE = /^[0-9a-f]{64}$/u;
const NUMBER_RE = /^\d{1,40}$/u;

function digest(...parts: string[]) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function normalizeAccount(input: Qoo10InquiryAccountIdentity) {
  const ownerId = input.ownerId.toLowerCase();
  const sellerAccountKey = input.sellerAccountKey.toLowerCase();
  if (!UUID_RE.test(ownerId)
      || !ACCOUNT_KEY_RE.test(sellerAccountKey)
      || !["sandbox", "production"].includes(input.environment)) {
    throw new Error("QOO10_INQUIRY_ACCOUNT_IDENTITY_INVALID");
  }
  const accountIdentityDigest = digest(
    qoo10InquiryIdentityContract.accountVersion,
    ownerId,
    sellerAccountKey,
    input.environment,
  );
  return Object.freeze({
    contractVersion: qoo10InquiryIdentityContract.accountVersion,
    ownerId,
    sellerAccountKey,
    environment: input.environment,
    accountIdentityDigest,
  });
}

export function qoo10InquiryMessageIdentity(input: Qoo10InquiryMessageIdentityInput) {
  const account = normalizeAccount(input.account);
  const sourceCredentialId = input.sourceCredentialId.toLowerCase();
  const inquiryType = String(input.inquiryType).trim().toUpperCase();
  const questionNo = String(input.questionNo).trim();
  const sequenceNo = String(input.sequenceNo).trim();
  if (!UUID_RE.test(sourceCredentialId)
      || !qoo10InquiryTypes.includes(inquiryType as Qoo10InquiryType)
      || !NUMBER_RE.test(questionNo)
      || !NUMBER_RE.test(sequenceNo)) {
    throw new Error("QOO10_INQUIRY_MESSAGE_IDENTITY_INVALID");
  }

  const externalTicketId = `qoo10:v2:${inquiryType}:${questionNo}`;
  const remoteMessageId = sequenceNo;
  const legacyExternalTicketId = `qoo10:${inquiryType}:${questionNo}:${sequenceNo}`;
  const conversationIdentityDigest = digest(
    qoo10InquiryIdentityContract.ticketVersion,
    account.accountIdentityDigest,
    inquiryType,
    questionNo,
  );
  const messageIdentityDigest = digest(
    qoo10InquiryIdentityContract.messageVersion,
    conversationIdentityDigest,
    sequenceNo,
  );
  return Object.freeze({
    ticketIdentityVersion: qoo10InquiryIdentityContract.ticketVersion,
    messageIdentityVersion: qoo10InquiryIdentityContract.messageVersion,
    account,
    sourceCredentialId,
    inquiryType: inquiryType as Qoo10InquiryType,
    questionNo,
    sequenceNo,
    externalTicketId,
    remoteMessageId,
    legacyExternalTicketId,
    accountScopedConversationKey: `qoo10:conversation:${conversationIdentityDigest}`,
    accountScopedInboundKey: `qoo10:inbound:${messageIdentityDigest}`,
    conversationIdentityDigest,
    messageIdentityDigest,
  });
}

export function qoo10ClaimIdentity(input: Qoo10ClaimIdentityInput) {
  const account = normalizeAccount(input.account);
  const sourceCredentialId = input.sourceCredentialId.toLowerCase();
  const orderNo = String(input.orderNo).trim();
  const requestDateKey = String(input.requestDateKey).trim();
  const providerRevision = String(input.providerRevision).trim().toLowerCase();
  if (!UUID_RE.test(sourceCredentialId)
      || !/^[1-9]\d{0,19}$/u.test(orderNo)
      || !/^\d{14}$/u.test(requestDateKey)
      || !ACCOUNT_KEY_RE.test(providerRevision)) {
    throw new Error("QOO10_CLAIM_IDENTITY_INVALID");
  }

  const legacyExternalTicketId = `qoo10:claim:${orderNo}:${requestDateKey}`;
  const conversationIdentityDigest = digest(
    "qoo10-claim-v1",
    account.accountIdentityDigest,
    orderNo,
    requestDateKey,
  );
  const messageIdentityDigest = digest(
    "qoo10-claim-revision-v1",
    conversationIdentityDigest,
    providerRevision,
  );
  return Object.freeze({
    ticketIdentityVersion: "qoo10-claim-v1" as const,
    messageIdentityVersion: "qoo10-claim-revision-v1" as const,
    account,
    sourceCredentialId,
    orderNo,
    requestDateKey,
    providerRevision,
    externalTicketId: legacyExternalTicketId,
    legacyExternalTicketId,
    accountScopedConversationKey: `qoo10:claim-conversation:${conversationIdentityDigest}`,
    accountScopedInboundKey: `qoo10:claim-inbound:${messageIdentityDigest}`,
    conversationIdentityDigest,
    messageIdentityDigest,
  });
}

export function groupQoo10InquiryConversationIdentities(
  inputs: readonly Qoo10InquiryMessageIdentityInput[],
) {
  const conversations = new Map<string, {
    externalTicketId: string;
    accountScopedConversationKey: string;
    conversationIdentityDigest: string;
    account: ReturnType<typeof normalizeAccount>;
    inquiryType: Qoo10InquiryType;
    questionNo: string;
    messages: Map<string, ReturnType<typeof qoo10InquiryMessageIdentity>>;
  }>();

  for (const input of inputs) {
    const message = qoo10InquiryMessageIdentity(input);
    const existing = conversations.get(message.accountScopedConversationKey);
    const conversation = existing ?? {
      externalTicketId: message.externalTicketId,
      accountScopedConversationKey: message.accountScopedConversationKey,
      conversationIdentityDigest: message.conversationIdentityDigest,
      account: message.account,
      inquiryType: message.inquiryType,
      questionNo: message.questionNo,
      messages: new Map(),
    };
    conversation.messages.set(message.messageIdentityDigest, message);
    conversations.set(message.accountScopedConversationKey, conversation);
  }

  return [...conversations.values()]
    .map((conversation) => {
      const messages = [...conversation.messages.values()].sort((left, right) => {
        const bySequence = BigInt(left.sequenceNo) < BigInt(right.sequenceNo) ? -1
          : BigInt(left.sequenceNo) > BigInt(right.sequenceNo) ? 1 : 0;
        return bySequence || left.sourceCredentialId.localeCompare(right.sourceCredentialId);
      });
      return Object.freeze({
        ticketIdentityVersion: qoo10InquiryIdentityContract.ticketVersion,
        externalTicketId: conversation.externalTicketId,
        accountScopedConversationKey: conversation.accountScopedConversationKey,
        conversationIdentityDigest: conversation.conversationIdentityDigest,
        account: conversation.account,
        inquiryType: conversation.inquiryType,
        questionNo: conversation.questionNo,
        legacyExternalTicketIds: Object.freeze(messages.map((message) => message.legacyExternalTicketId)),
        messages: Object.freeze(messages),
      });
    })
    .sort((left, right) => left.accountScopedConversationKey.localeCompare(right.accountScopedConversationKey));
}
