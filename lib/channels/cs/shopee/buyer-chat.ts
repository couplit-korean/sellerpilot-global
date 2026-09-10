import { createHash } from "node:crypto";

export const SHOPEE_BUYER_CHAT_PAGE_SIZE = 100;

export type ShopeeBuyerChatPermissionEvidence = {
  configuredKeys: boolean;
  contractDocument?: {
    module: "sellerchat";
    revision: string;
    sourceUrl: string;
    verifiedAt: string;
    conversationListApproved: true;
    messageHistoryApproved: true;
  };
  appApproval?: {
    state: "approved";
    appType: string;
    approvedAt: string;
  };
  webhookApproval?: {
    state: "approved";
    event: string;
    verifiedAt: string;
  };
};

export type ShopeeBuyerChatReadiness = {
  state: "permission_pending" | "read_only_ready";
  reason: "contract_permission_unverified" | "app_approval_unverified"
    | "webhook_permission_unverified" | "approved_read_only";
  receive: boolean;
  history: boolean;
  reply: false;
};

export type AuthorizedShopeeBuyerChatMessage = {
  conversationId: string;
  messageId: string;
  senderRole: "buyer" | "seller" | "system";
  body: string;
  sentAt: string;
  orderSn?: string | null;
  itemId?: string | null;
  attachmentCount?: number;
};

export type AuthorizedShopeeBuyerChatPage = {
  contract: "sellerpilot-shopee-buyer-chat-authorized-page/1";
  shopId: string;
  conversationId: string;
  inputCursor: string | null;
  nextCursor: string | null;
  pageSize: number;
  messages: AuthorizedShopeeBuyerChatMessage[];
};

export type NormalizedShopeeBuyerChatMessage = {
  shopId: string;
  conversationId: string;
  messageId: string;
  identityDigest: string;
  senderRole: "buyer" | "seller" | "system";
  body: string;
  bodyFingerprint: string;
  sentAt: string;
  orderSn: string | null;
  itemId: string | null;
  attachmentCount: number;
};

const exactId = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u;
const exactShopId = /^[1-9]\d{0,31}$/u;
const exactItemId = /^[1-9]\d{0,31}$/u;
const exactOrderSn = /^[A-Za-z0-9_-]{1,80}$/u;

function validInstant(value: string) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactIdentifier(value: unknown, expression: RegExp): value is string {
  return typeof value === "string" && expression.test(value);
}

function boundedCursor(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value.length >= 1 && value.length <= 512;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function shopeeBuyerChatReadiness(
  evidence: ShopeeBuyerChatPermissionEvidence,
): ShopeeBuyerChatReadiness {
  // Configured partner keys prove neither SellerChat document access nor app
  // approval. They are deliberately not a readiness input beyond audit display.
  if (!record(evidence) || typeof evidence.configuredKeys !== "boolean"
      || !record(evidence.contractDocument)
      || evidence.contractDocument.module !== "sellerchat"
      || evidence.contractDocument.conversationListApproved !== true
      || evidence.contractDocument.messageHistoryApproved !== true
      || !exactIdentifier(evidence.contractDocument.revision, exactId)
      || typeof evidence.contractDocument.sourceUrl !== "string"
      || !/^https:\/\/open\.shopee\.(?:com|cn)\//u.test(evidence.contractDocument.sourceUrl)
      || !validInstant(evidence.contractDocument.verifiedAt as string)) {
    return { state: "permission_pending", reason: "contract_permission_unverified",
      receive: false, history: false, reply: false };
  }
  if (!record(evidence.appApproval) || evidence.appApproval.state !== "approved"
      || !exactIdentifier(evidence.appApproval.appType, exactId)
      || !validInstant(evidence.appApproval.approvedAt as string)) {
    return { state: "permission_pending", reason: "app_approval_unverified",
      receive: false, history: false, reply: false };
  }
  if (!record(evidence.webhookApproval) || evidence.webhookApproval.state !== "approved"
      || !exactIdentifier(evidence.webhookApproval.event, exactId)
      || !validInstant(evidence.webhookApproval.verifiedAt as string)) {
    return { state: "permission_pending", reason: "webhook_permission_unverified",
      receive: false, history: false, reply: false };
  }
  return { state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, reply: false };
}

export function normalizeAuthorizedShopeeBuyerChatPage(input: {
  evidence: ShopeeBuyerChatPermissionEvidence;
  expectedShopId: string;
  page: AuthorizedShopeeBuyerChatPage;
}) {
  const readiness = shopeeBuyerChatReadiness(input.evidence);
  if (readiness.state !== "read_only_ready") {
    throw new Error(`SHOPEE_BUYER_CHAT_PERMISSION_PENDING:${readiness.reason}`);
  }
  const { page } = input;
  if (!record(page)
      || page.contract !== "sellerpilot-shopee-buyer-chat-authorized-page/1"
      || !exactIdentifier(input.expectedShopId, exactShopId)
      || !exactIdentifier(page.shopId, exactShopId)
      || page.shopId !== input.expectedShopId
      || !exactIdentifier(page.conversationId, exactId)
      || !Number.isInteger(page.pageSize) || page.pageSize < 1
      || page.pageSize > SHOPEE_BUYER_CHAT_PAGE_SIZE
      || !Array.isArray(page.messages)
      || page.messages.length > page.pageSize
      || !boundedCursor(page.inputCursor)
      || !boundedCursor(page.nextCursor)
      || page.nextCursor !== null && (page.nextCursor === page.inputCursor || page.messages.length === 0)) {
    throw new Error("SHOPEE_BUYER_CHAT_PAGE_INVALID");
  }

  const seen = new Set<string>();
  const messages: NormalizedShopeeBuyerChatMessage[] = page.messages.map((message) => {
    if (!record(message)
        || !exactIdentifier(message.conversationId, exactId)
        || message.conversationId !== page.conversationId
        || !exactIdentifier(message.messageId, exactId)
        || typeof message.senderRole !== "string"
        || !["buyer", "seller", "system"].includes(message.senderRole)
        || typeof message.body !== "string"
        || !validInstant(message.sentAt as string)) {
      throw new Error("SHOPEE_BUYER_CHAT_MESSAGE_INVALID");
    }
    const body = message.body.trim();
    const sentAt = new Date(message.sentAt as string).toISOString();
    const orderSn = message.orderSn ?? null;
    const itemId = message.itemId ?? null;
    const attachmentCount = message.attachmentCount ?? 0;
    if (!body || body.length > 4_000
        || orderSn !== null && !exactIdentifier(orderSn, exactOrderSn)
        || itemId !== null && !exactIdentifier(itemId, exactItemId)
        || !Number.isInteger(attachmentCount) || attachmentCount < 0 || attachmentCount > 20) {
      throw new Error("SHOPEE_BUYER_CHAT_MESSAGE_INVALID");
    }
    const exactIdentity = `${page.shopId}\n${page.conversationId}\n${message.messageId}`;
    const identityDigest = sha256(exactIdentity);
    if (seen.has(identityDigest)) throw new Error("SHOPEE_BUYER_CHAT_MESSAGE_DUPLICATE");
    seen.add(identityDigest);
    return {
      shopId: page.shopId,
      conversationId: page.conversationId,
      messageId: message.messageId,
      identityDigest,
      senderRole: message.senderRole,
      body,
      bodyFingerprint: sha256(body),
      sentAt,
      orderSn,
      itemId,
      attachmentCount,
    };
  });

  return {
    readiness,
    messages,
    continuation: page.nextCursor === null ? null : {
      shopId: page.shopId,
      conversationId: page.conversationId,
      cursor: page.nextCursor,
      pageSize: page.pageSize,
    },
    storageRows: messages.map((message) => ({
      ...message,
      evidenceDigest: sha256([
        message.identityDigest,
        message.bodyFingerprint,
        message.senderRole,
        message.sentAt,
        message.orderSn ?? "",
        message.itemId ?? "",
        String(message.attachmentCount),
      ].join("\n")),
    })),
  };
}
