import { createHash } from "node:crypto";
import type { ChannelOperationStep } from "../../operation-step";
import type { CsOperationResult, CsRetryContinuation } from "../../../cs/operations/contracts";

import {
  COUPANG_READBACK_RETRY_DELAYS as RETRY_DELAYS,
  COUPANG_READBACK_RETRYABLE_STATUSES as RETRYABLE,
  parseCoupangProductReplyReadbackArguments,
  type CoupangProductReplyReadbackArguments,
} from "../../gateway-readback-contract";
export {
  parseCoupangProductReplyReadbackArguments,
  isCoupangProductReplyReadbackRetry,
  type CoupangProductReplyReadbackArguments,
} from "../../gateway-readback-contract";

type ReadbackDecision = {
  steps: ChannelOperationStep[];
  continuationArguments?: Record<string, unknown>;
  retryContinuation?: CsRetryContinuation;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function coupangProductReplyReadbackQuery(arguments_: CoupangProductReplyReadbackArguments) {
  return new URLSearchParams({
    answeredType: "ALL",
    inquiryStartAt: arguments_.inquiryStartAt,
    inquiryEndAt: arguments_.inquiryEndAt,
    pageNum: String(arguments_.pageNum),
    pageSize: "50",
  });
}

function reconciliationStep(code: string): ChannelOperationStep {
  return {
    name: "coupang-product-reply-readback-reconciliation",
    ok: false,
    status: 409,
    data: { code, sellerpilotReconciliationRequired: true },
  };
}

export function coupangProductReplyReadbackPreflight(arguments_: Record<string, unknown>):
  | { parsed: CoupangProductReplyReadbackArguments }
  | { decision: ReadbackDecision } {
  try {
    return { parsed: parseCoupangProductReplyReadbackArguments(arguments_) };
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "COUPANG_PRODUCT_REPLY_READBACK_ARGUMENT_INVALID";
    return { decision: { steps: [reconciliationStep(code)] } };
  }
}

function retryDecision(
  arguments_: Record<string, unknown>,
  parsed: CoupangProductReplyReadbackArguments,
  steps: ChannelOperationStep[],
  providerStatus: number,
): ReadbackDecision {
  if (parsed.attempt >= RETRY_DELAYS.length) {
    return {
      steps: [...steps, reconciliationStep("COUPANG_PRODUCT_REPLY_READBACK_EXHAUSTED")],
    };
  }
  const retryCount = parsed.attempt + 1;
  const retryArguments = {
    ...arguments_,
    sellerpilotCoupangReadbackAttempt: retryCount,
    query: {
      ...record(arguments_.query),
      pageNum: 1,
      pageSize: 50,
      answeredType: "ALL",
      inquiryStartAt: parsed.inquiryStartAt,
      inquiryEndAt: parsed.inquiryEndAt,
    },
  };
  return {
    steps,
    retryContinuation: {
      reason: "retryable_read_failure",
      arguments: retryArguments,
      retryCount,
      retryAfterSeconds: RETRY_DELAYS[parsed.attempt]!,
      deferredCount: 1,
      replayCount: 0,
      providerStatus,
    },
  };
}

export function evaluateCoupangProductReplyReadback({
  arguments_, parsed, providerStep,
}: {
  arguments_: Record<string, unknown>;
  parsed: CoupangProductReplyReadbackArguments;
  providerStep: ChannelOperationStep;
}): ReadbackDecision {
  if (!providerStep.ok) {
    if (!RETRYABLE.has(providerStep.status)) return { steps: [providerStep] };
    return retryDecision(arguments_, parsed, [providerStep], providerStep.status);
  }
  const payload = record(providerStep.data.data);
  const rows = Array.isArray(providerStep.data.data)
    ? providerStep.data.data
    : Array.isArray(payload?.content) ? payload.content : [];
  const exactRows = rows.filter((item) => {
    const row = record(item);
    return row && String(row.inquiryId ?? "") === parsed.inquiryId;
  }).map((item) => record(item)!);
  if (exactRows.length > 1) {
    return { steps: [providerStep, reconciliationStep("COUPANG_PRODUCT_REPLY_READBACK_QUESTION_AMBIGUOUS")] };
  }
  const row = exactRows[0];
  const comments = row && Array.isArray(row.commentDtoList) ? row.commentDtoList : [];
  if ((row && row.parentAnswerId !== undefined && row.parentAnswerId !== null)
      || comments.some((comment) => {
        const value = record(comment);
        return value && value.parentAnswerId !== undefined && value.parentAnswerId !== null;
      })) {
    return { steps: [providerStep, reconciliationStep("COUPANG_PRODUCT_REPLY_READBACK_PARENT_ANSWER_AMBIGUOUS")] };
  }
  const matches = comments.filter((comment) => {
    const value = record(comment);
    if (!value || String(value.inquiryId ?? "") !== parsed.inquiryId
        || typeof value.content !== "string") return false;
    return createHash("sha256").update(value.content.trim()).digest("hex")
      === parsed.expectedReplyFingerprint;
  });
  if (matches.length > 1) {
    return { steps: [providerStep, reconciliationStep("COUPANG_PRODUCT_REPLY_READBACK_REPLY_AMBIGUOUS")] };
  }
  if (matches.length === 1) {
    providerStep.data = {
      ...providerStep.data,
      sellerpilotProductReplyReadback: {
        contract: "sellerpilot-coupang-product-reply-readback/1",
        status: "observed",
        inquiryId: parsed.inquiryId,
        sourceJobId: parsed.sourceJobId,
        ticketId: parsed.ticketId,
        expectedInboundKey: parsed.expectedInboundKey,
        expectedReplyFingerprint: parsed.expectedReplyFingerprint,
        attempt: parsed.attempt,
      },
    };
    return { steps: [providerStep] };
  }
  const pagination = record(payload?.pagination);
  const totalPages = Number(pagination?.totalPages ?? 1);
  if (Number.isSafeInteger(totalPages) && totalPages > parsed.pageNum && parsed.pageNum < 50) {
    return {
      steps: [providerStep],
      continuationArguments: {
        ...arguments_,
        query: { ...record(arguments_.query), pageNum: parsed.pageNum + 1, pageSize: 50 },
      },
    };
  }
  const notObserved: ChannelOperationStep = {
    name: "coupang-product-reply-readback-not-observed",
    ok: false,
    status: 404,
    data: { code: "COUPANG_PRODUCT_REPLY_NOT_OBSERVED" },
  };
  return retryDecision(arguments_, parsed, [providerStep, notObserved], 404);
}

export function coupangProductReplyReadbackContext(request: unknown) {
  const envelope = record(request);
  const arguments_ = record(envelope?.arguments);
  if (arguments_?.kind !== "product-reply-readback") return null;
  return parseCoupangProductReplyReadbackArguments(arguments_);
}

type ReadbackInquiryEvidence = {
  externalTicketId: string;
  senderRole?: string;
  message: string;
  providerContext?: Record<string, unknown>;
};

export function exactCoupangProductReplyReadbackEvidence<T extends ReadbackInquiryEvidence>(
  context: CoupangProductReplyReadbackArguments,
  result: { steps: Array<{ data: Record<string, unknown> }> },
  inquiries: T[],
) {
  const marker = result.steps
    .map((item) => record(item.data.sellerpilotProductReplyReadback))
    .find((value) => value?.status === "observed") ?? null;
  if (marker && (
    marker.contract !== "sellerpilot-coupang-product-reply-readback/1"
    || marker.inquiryId !== context.inquiryId
    || marker.sourceJobId !== context.sourceJobId
    || marker.ticketId !== context.ticketId
    || marker.expectedInboundKey !== context.expectedInboundKey
    || marker.expectedReplyFingerprint !== context.expectedReplyFingerprint
  )) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_EVIDENCE_SCOPE_CHANGED");
  }
  const exact = inquiries.filter((inquiry) =>
    inquiry.externalTicketId === `product:${context.inquiryId}`
    && inquiry.senderRole === "seller"
    && inquiry.providerContext?.historyOnly === true
    && createHash("sha256").update(inquiry.message.trim()).digest("hex")
      === context.expectedReplyFingerprint);
  if ((marker && exact.length !== 1) || (!marker && exact.length !== 0)) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_EVIDENCE_AMBIGUOUS");
  }
  return exact;
}

export function sanitizedCoupangProductReplyReadbackResult(
  context: CoupangProductReplyReadbackArguments,
  result: CsOperationResult,
  observedReplyCount: number,
): CsOperationResult {
  return {
    ok: result.ok,
    channel: "coupang",
    operation: "inquiries.list",
    steps: [{
      name: "coupang-product-reply-readback-evidence",
      ok: result.ok,
      status: result.steps.at(-1)?.status ?? 200,
      data: {
        sellerpilotMarker: "sellerpilot-coupang-product-reply-readback-evidence/1",
        sourceJobId: context.sourceJobId,
        ticketId: context.ticketId,
        inquiryId: context.inquiryId,
        attempt: context.attempt,
        pageNum: context.pageNum,
        observedReplyCount,
        providerStepCount: result.steps.length,
      },
    }],
    ...(result.continuation ? { continuation: result.continuation } : {}),
    safeMessage: "쿠팡 상품문의 답변 재조회 증거를 범위 제한해 저장했습니다.",
  };
}

