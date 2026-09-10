import "server-only";

import { createHash } from "node:crypto";
import {
  temuBuyerChatSourceAdapterResultSchema,
  temuBuyerChatSourceReceiptSchema,
  temuBuyerChatSourceStatusSchema,
  type TemuBuyerChatSourceAdapterResult,
  type TemuBuyerChatSourceStatus,
} from "./buyer-chat-source-contract";
import {
  temuCsReadiness,
  type TemuBuyerChatExpectedContext,
} from "./runtime-readiness";

function unique(values: string[]) {
  return [...new Set(values)];
}

function sourceStatus(
  expected: TemuBuyerChatExpectedContext,
  providerEnablementBlockers: string[],
): TemuBuyerChatSourceStatus {
  return temuBuyerChatSourceStatusSchema.parse({
    contract: "sellerpilot-temu-buyer-chat-source-status/1",
    checkedAt: expected.now,
    credentialId: expected.credentialId,
    sellerAccountKey: expected.sellerAccountKey,
    environment: expected.environment,
    sourceAdapterImplemented: true,
    currentAssignmentLocalImplementationComplete: true,
    localState: "implemented_fail_closed",
    providerState: "unsupported",
    officialContractVerified: false,
    verifiedSourceReceiptAccepted: false,
    providerFetchPerformed: false,
    rawAccepted: false,
    canonicalPromotionAllowed: false,
    canonicalPromotionPerformed: false,
    canonicalInquiry: null,
    receive: false,
    history: false,
    reply: false,
    readback: false,
    localBlockers: [],
    providerEnablementBlockers: unique(providerEnablementBlockers),
    sourceBlockers: unique([
      ...providerEnablementBlockers,
      "TEMU_BUYER_CHAT_VERIFIED_SOURCE_RECEIPT_REQUIRED",
      "TEMU_BUYER_CHAT_OFFICIAL_API_CONTRACT_UNAVAILABLE",
      "TEMU_BUYER_CHAT_SOURCE_UNSUPPORTED",
    ]),
  });
}

/**
 * Reports the implemented local boundary separately from provider enablement.
 * Readiness evidence is evaluated, but it cannot become a message receipt.
 */
export function temuBuyerChatSourceStatus(
  readinessEvidence: unknown,
  expected: TemuBuyerChatExpectedContext,
): TemuBuyerChatSourceStatus {
  return sourceStatus(
    expected,
    temuCsReadiness("buyer_chat", readinessEvidence, expected).blockers,
  );
}

/**
 * Fail-closed raw source adapter. Until Temu publishes a reviewed Buyer Chat
 * payload/signature contract and a mapper is installed, even a structurally
 * plausible receipt can never emit a canonical inquiry.
 */
export function adaptTemuBuyerChatSource(input: {
  rawBody: unknown;
  verifiedReceipt: unknown;
  expected: TemuBuyerChatExpectedContext;
}): TemuBuyerChatSourceAdapterResult {
  const rawBody = typeof input.rawBody === "string" ? input.rawBody : "";
  const rawBytes = Buffer.byteLength(rawBody, "utf8");
  const rawValid = rawBytes > 0 && rawBytes <= 256_000;
  const rawSha256 = rawValid
    ? createHash("sha256").update(rawBody, "utf8").digest("hex")
    : null;
  const receiptProvided = input.verifiedReceipt !== null && input.verifiedReceipt !== undefined;
  const receipt = temuBuyerChatSourceReceiptSchema.safeParse(input.verifiedReceipt);
  const receiptEvidence = receipt.success
    && receipt.data.evidence
    && typeof receipt.data.evidence === "object"
    && !Array.isArray(receipt.data.evidence)
    ? receipt.data.evidence as Record<string, unknown>
    : null;
  const receiptBindingMatched = receipt.success
    && rawSha256 !== null
    && receipt.data.rawSha256 === rawSha256
    && receipt.data.credentialId === input.expected.credentialId
    && receipt.data.sellerAccountKey === input.expected.sellerAccountKey
    && receipt.data.environment === input.expected.environment
    && receipt.data.region === input.expected.expectedRegion
    && receipt.data.observedAt === receiptEvidence?.observedAt
    && receipt.data.expiresAt === receiptEvidence?.expiresAt;
  const readiness = temuCsReadiness("buyer_chat", receiptEvidence, input.expected);
  const providerBlockers = [...readiness.blockers];
  if (!rawValid) providerBlockers.push("TEMU_BUYER_CHAT_RAW_BODY_INVALID");
  if (receiptProvided && !receipt.success) {
    providerBlockers.push("TEMU_BUYER_CHAT_VERIFIED_SOURCE_RECEIPT_INVALID");
  }
  else if (!receiptBindingMatched) providerBlockers.push("TEMU_BUYER_CHAT_SOURCE_RECEIPT_BINDING_MISMATCH");

  return temuBuyerChatSourceAdapterResultSchema.parse({
    contract: "sellerpilot-temu-buyer-chat-source-adapter-result/1",
    status: sourceStatus(input.expected, providerBlockers),
    rawSha256,
    rawBytes: Math.min(rawBytes, 256_000),
    receiptStructurallyValid: receipt.success,
    receiptRawBindingMatched: receiptBindingMatched,
  });
}
