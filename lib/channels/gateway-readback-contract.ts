// Shared gateway payload validation. No CS executor or channel adapter dependencies.
export type GatewayReadRetryContinuation = {
  reason: "retryable_read_failure";
  arguments: Record<string, unknown>;
  retryCount: number;
  retryAfterSeconds: number;
  deferredCount: number;
  replayCount: number;
  providerStatus: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const POSITIVE_ID = /^[1-9]\d*$/u;
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const COUPANG_READBACK_RETRY_DELAYS = [15, 60] as const;
export const COUPANG_READBACK_RETRYABLE_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export type CoupangProductReplyReadbackArguments = {
  inquiryId: string;
  expectedReplyFingerprint: string;
  expectedInboundKey: string;
  sourceJobId: string;
  ticketId: string;
  inquiryStartAt: string;
  inquiryEndAt: string;
  pageNum: number;
  attempt: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_ARGUMENT_INVALID");
  }
  return parsed;
}

function exactString(value: unknown, expression: RegExp) {
  if (typeof value !== "string" || !expression.test(value)) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_ARGUMENT_INVALID");
  }
  return value;
}

export function parseCoupangProductReplyReadbackArguments(
  arguments_: Record<string, unknown>,
): CoupangProductReplyReadbackArguments {
  if (arguments_.kind !== "product-reply-readback"
      || "parentAnswerId" in arguments_
      || "expectedParentAnswerId" in arguments_) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_PARENT_ANSWER_AMBIGUOUS");
  }
  const query = record(arguments_.query);
  if (!query || query.answeredType !== "ALL" || query.pageSize !== 50) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_ARGUMENT_INVALID");
  }
  const inquiryStartAt = exactString(query.inquiryStartAt, DATE);
  const inquiryEndAt = exactString(query.inquiryEndAt, DATE);
  const start = Date.parse(`${inquiryStartAt}T00:00:00Z`);
  const end = Date.parse(`${inquiryEndAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start
      || end - start > 6 * 86_400_000) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_WINDOW_INVALID");
  }
  const attempt = arguments_.sellerpilotCoupangReadbackAttempt === undefined
    ? 0
    : Number(arguments_.sellerpilotCoupangReadbackAttempt);
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 2) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_ARGUMENT_INVALID");
  }
  return {
    inquiryId: exactString(arguments_.inquiryId, POSITIVE_ID),
    expectedReplyFingerprint: exactString(arguments_.expectedReplyFingerprint, HASH),
    expectedInboundKey: exactString(arguments_.expectedInboundKey, /^coupang:[a-f0-9]{64}$/u),
    sourceJobId: exactString(arguments_.sourceJobId, UUID),
    ticketId: exactString(arguments_.ticketId, UUID),
    inquiryStartAt,
    inquiryEndAt,
    pageNum: positiveInteger(query.pageNum, 1, 50),
    attempt,
  };
}

export function isCoupangProductReplyReadbackRetry(value: GatewayReadRetryContinuation) {
  const arguments_ = value.arguments;
  try {
    const parsed = parseCoupangProductReplyReadbackArguments(arguments_);
    return value.reason === "retryable_read_failure"
      && parsed.attempt === value.retryCount
      && value.retryCount >= 1 && value.retryCount <= 2
      && value.retryAfterSeconds === COUPANG_READBACK_RETRY_DELAYS[value.retryCount - 1]
      && value.deferredCount === 1
      && value.replayCount === 0
      && (COUPANG_READBACK_RETRYABLE_STATUSES.has(value.providerStatus) || value.providerStatus === 404);
  } catch {
    return false;
  }
}
