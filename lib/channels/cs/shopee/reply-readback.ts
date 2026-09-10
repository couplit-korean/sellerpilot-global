import { createHash } from "node:crypto";
import type { NormalizedChannelInquiry } from "../../../cs/operations/inquiry-contracts";
import type { CsOperationResult } from "../../../cs/operations/contracts";

export const shopeeReplyReadbackContract = "sellerpilot-shopee-reply-readback/1" as const;
export const SHOPEE_REPLY_READBACK_MAX_ATTEMPTS = 3;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

type JsonRecord = Record<string, unknown>;

export type ShopeeReplyReadbackContext = {
  contract: typeof shopeeReplyReadbackContract;
  deliveryId: string;
  sourceJobId: string;
  ticketId: string;
  expectedInboundKey: string;
  expectedReplyFingerprint: string;
  shopId: string;
  commentId: string;
  itemId: string;
  attempt: number;
};

export type ShopeeReplyReadbackVerification = {
  state: "observed" | "delayed" | "missing" | "mismatch" | "incomplete";
  reason:
    | "exact_reply_observed"
    | "exact_reply_not_yet_observed"
    | "exact_reply_missing_after_bound"
    | "reply_body_mismatch"
    | "reply_target_mismatch"
    | "reply_timestamp_unavailable"
    | "provider_result_invalid";
  attempt: number;
  matchingSellerReplies: number;
  replyContentObserved: boolean;
  automaticResendAllowed: false;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

export function shopeeReplyReadbackContext(value: unknown): ShopeeReplyReadbackContext | null {
  const request = record(value);
  const markerValue = request?.sellerpilotShopeeReplyReadback;
  if (markerValue === undefined) return null;
  const marker = record(markerValue);
  const arguments_ = record(request?.arguments);
  const context = {
    contract: marker?.contract,
    deliveryId: text(marker?.deliveryId).toLowerCase(),
    sourceJobId: text(marker?.sourceJobId).toLowerCase(),
    ticketId: text(marker?.ticketId).toLowerCase(),
    expectedInboundKey: text(marker?.expectedInboundKey),
    expectedReplyFingerprint: text(marker?.expectedReplyFingerprint).toLowerCase(),
    shopId: text(marker?.shopId),
    commentId: text(marker?.commentId),
    itemId: text(marker?.itemId),
    attempt: Number(marker?.attempt),
  };
  if (!marker || !arguments_
      || context.contract !== shopeeReplyReadbackContract
      || !uuidPattern.test(context.deliveryId)
      || !uuidPattern.test(context.sourceJobId)
      || !uuidPattern.test(context.ticketId)
      || !/^shopee:[a-f0-9]{64}$/u.test(context.expectedInboundKey)
      || !digestPattern.test(context.expectedReplyFingerprint)
      || !/^[1-9]\d{0,31}$/u.test(context.shopId)
      || !/^[1-9]\d{0,18}$/u.test(context.commentId)
      || !/^[1-9]\d{0,18}$/u.test(context.itemId)
      || !Number.isSafeInteger(context.attempt)
      || context.attempt < 1
      || context.attempt > SHOPEE_REPLY_READBACK_MAX_ATTEMPTS
      || request?.periodicKey !== `inquiries:reply-readback:shopee:${context.deliveryId}:${context.attempt}`
      || arguments_.kind !== "product_review"
      || text(arguments_.shopId) !== context.shopId
      || text(arguments_.commentId) !== context.commentId
      || text(arguments_.itemId) !== context.itemId
      || arguments_.cursor !== ""
      || Number(arguments_.pageSize) !== 100) {
    throw new Error("SHOPEE_REPLY_READBACK_CONTEXT_INVALID");
  }
  return context as ShopeeReplyReadbackContext;
}

function targetMatches(context: ShopeeReplyReadbackContext, inquiry: NormalizedChannelInquiry) {
  const binding = { ...inquiry.providerContext, ...(inquiry.replyContext ?? {}) };
  return text(binding.shopId) === context.shopId
    && text(binding.commentId) === context.commentId
    && text(binding.itemId) === context.itemId
    && inquiry.externalTicketId === `shopee:${context.shopId}:${context.commentId}`;
}

function verification(
  context: ShopeeReplyReadbackContext,
  value: Omit<ShopeeReplyReadbackVerification, "attempt" | "automaticResendAllowed">,
): ShopeeReplyReadbackVerification {
  return { ...value, attempt: context.attempt, automaticResendAllowed: false };
}

export function verifyShopeeReplyReadback(input: {
  context: ShopeeReplyReadbackContext;
  result: CsOperationResult;
  normalizedInquiries: NormalizedChannelInquiry[];
}): ShopeeReplyReadbackVerification {
  const { context, result, normalizedInquiries } = input;
  if (result.channel !== "shopee" || result.operation !== "inquiries.list" || !result.ok
      || result.steps.length < 1 || result.steps.some((step) => !step.ok)) {
    return verification(context, { state: "incomplete", reason: "provider_result_invalid",
      matchingSellerReplies: 0, replyContentObserved: false });
  }
  const wrongTarget = normalizedInquiries.some((inquiry) => {
    const binding = { ...inquiry.providerContext, ...(inquiry.replyContext ?? {}) };
    return text(binding.shopId) !== context.shopId
      || text(binding.commentId) !== context.commentId
      || text(binding.itemId) !== context.itemId;
  });
  if (wrongTarget) {
    return verification(context, { state: "mismatch", reason: "reply_target_mismatch",
      matchingSellerReplies: 0, replyContentObserved: false });
  }
  const exactTarget = normalizedInquiries.filter((inquiry) => targetMatches(context, inquiry));
  const sellerReplies = exactTarget.filter((inquiry) => inquiry.senderRole === "seller");
  const exactReplies = sellerReplies.filter((inquiry) => sha256(inquiry.message) === context.expectedReplyFingerprint);
  if (sellerReplies.length === 1 && exactReplies.length === 1) {
    return verification(context, { state: "observed", reason: "exact_reply_observed",
      matchingSellerReplies: 1, replyContentObserved: true });
  }
  if (sellerReplies.length) {
    return verification(context, { state: "mismatch", reason: "reply_body_mismatch",
      matchingSellerReplies: sellerReplies.length, replyContentObserved: false });
  }
  const unsequencedAnswers = exactTarget.flatMap((inquiry) => {
    const value = inquiry.providerContext.unsequencedAnswers;
    return Array.isArray(value) ? value.flatMap((item) => record(item) ? [record(item)!] : []) : [];
  });
  if (unsequencedAnswers.length) {
    const hasExactBody = unsequencedAnswers.some((answer) => sha256(text(answer.body))
      === context.expectedReplyFingerprint);
    return verification(context, { state: hasExactBody ? "incomplete" : "mismatch",
      reason: hasExactBody ? "reply_timestamp_unavailable" : "reply_body_mismatch",
      matchingSellerReplies: 0, replyContentObserved: false });
  }
  return verification(context, {
    state: context.attempt < SHOPEE_REPLY_READBACK_MAX_ATTEMPTS ? "delayed" : "missing",
    reason: context.attempt < SHOPEE_REPLY_READBACK_MAX_ATTEMPTS
      ? "exact_reply_not_yet_observed"
      : "exact_reply_missing_after_bound",
    matchingSellerReplies: 0,
    replyContentObserved: false,
  });
}

export function shopeeReplyReadbackRpcArguments(input: {
  tokenHash: string;
  jobId: string;
  claimToken: string;
  context: ShopeeReplyReadbackContext;
  verification: ShopeeReplyReadbackVerification;
}) {
  return {
    p_token_hash: input.tokenHash,
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
    p_delivery_id: input.context.deliveryId,
    p_outcome: input.verification,
  };
}
