export const AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE =
  "Vercel AI Gateway 계정 확인·결제수단 확인 필요: 운영 담당자가 Vercel에서 계정 확인과 결제수단 상태를 완료한 뒤 다시 실행해 주세요.";

export type AiGatewayFailureReason =
  | "gateway_customer_verification_required"
  | "gateway_authentication_error"
  | "gateway_billing_required"
  | "gateway_forbidden"
  | "gateway_model_not_found"
  | "gateway_rate_limited"
  | "gateway_timeout"
  | "gateway_request_failed"
  | "gateway_result_invalid"
  | "runtime_timeout";

export type AiGatewayFailureOptions = {
  signalAborted?: boolean;
  nowMs?: number;
};

export type AiGatewayLimitKind =
  | "account_or_credit_limit"
  | "free_tier_limit"
  | "provider_request_rate_limit"
  | "provider_token_rate_limit"
  | "provider_image_rate_limit"
  | "provider_rate_limit"
  | "concurrency_limit"
  | "unknown_rate_limit";

export type AiGatewayFailureDiagnostic = {
  reason: AiGatewayFailureReason;
  httpStatus?: number;
  limitKind?: AiGatewayLimitKind;
  retryAfterMs?: number;
  generationId?: string;
  requestId?: string;
  upstreamProviderAttempted?: boolean;
};

const MAX_INSPECTED_RECORDS = 12;
const MAX_LINKED_ERRORS = 3;
const MAX_DIAGNOSTIC_RETRY_AFTER_MS = 15 * 60_000;
const MAX_DIAGNOSTIC_IDENTIFIER_LENGTH = 160;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 2_000;

const accountLimitCodes = new Set([
  "billing_required",
  "credit_balance_exhausted",
  "insufficient_quota",
  "organization_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "project_spend_limit_exceeded",
]);

const concurrencyLimitCodes = new Set([
  "concurrency_limit",
  "concurrency_limit_exceeded",
  "concurrent_requests_limit_exceeded",
]);

const requestRateLimitCodes = new Set([
  "request_rate_limit_exceeded",
  "requests_per_minute",
  "rpm",
]);

const tokenRateLimitCodes = new Set([
  "token_rate_limit_exceeded",
  "tokens_per_minute",
  "tpm",
]);

const imageRateLimitCodes = new Set([
  "image_rate_limit_exceeded",
  "images_per_minute",
  "ipm",
]);

function errorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function linkedErrors(record: Record<string, unknown>) {
  const linked: unknown[] = [];
  // Follow only documented AI SDK/provider error linkage. Never traverse
  // arbitrary object properties, messages, response bodies, prompts, or URLs.
  if (record.cause != null) linked.push(record.cause);
  if (record.data != null) linked.push(record.data);
  if (record.error != null) linked.push(record.error);
  if (record.lastError != null) linked.push(record.lastError);
  if (Array.isArray(record.errors)) {
    linked.push(...record.errors.slice(-MAX_LINKED_ERRORS).reverse());
  }
  return linked;
}

function boundedErrorRecords(error: unknown) {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const records: Record<string, unknown>[] = [];
  while (queue.length > 0 && records.length < MAX_INSPECTED_RECORDS) {
    const candidate = queue.shift();
    if (candidate == null || seen.has(candidate)) continue;
    seen.add(candidate);
    const record = errorRecord(candidate);
    if (!record) continue;
    records.push(record);
    queue.push(...linkedErrors(record));
  }
  return records;
}

function safeHttpStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function safeDiagnosticIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length >= 1
    && normalized.length <= MAX_DIAGNOSTIC_IDENTIFIER_LENGTH
    && /^[A-Za-z0-9._:/=-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function normalizedSignalCode(value: unknown) {
  if (typeof value !== "string" || value.length > 160) return null;
  const normalized = value.trim().toLocaleLowerCase().replaceAll(/[-\s]+/g, "_");
  return /^[a-z0-9_]+$/.test(normalized) ? normalized : null;
}

function explicitSignalCodes(records: readonly Record<string, unknown>[]) {
  const codes = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizedSignalCode(value);
    if (normalized) codes.add(normalized);
  };
  for (const record of records) {
    add(record.type);
    add(record.code);
    add(record.name);
    if (typeof record.param === "string") {
      add(record.param);
      continue;
    }
    const param = errorRecord(record.param);
    if (!param) continue;
    add(param.type);
    add(param.code);
    add(param.name);
  }
  return codes;
}

function boundedDiagnosticMessages(records: readonly Record<string, unknown>[]) {
  const messages: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || value.length < 1 || value.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH) return;
    messages.push(value.toLocaleLowerCase());
  };
  for (const record of records) {
    add(record.message);
    const param = errorRecord(record.param);
    if (param) {
      add(param.message);
      add(param.error);
    }
  }
  return messages;
}

function hasFreeTierLimitEvidence(messages: readonly string[]) {
  return messages.some((message) => (
    message.includes("free credits temporarily have rate limits")
    || message.includes("free tier users do not have access")
    || (message.includes("free credits")
      && message.includes("paid credits")
      && (message.includes("rate limit") || message.includes("restricted access")))
  ));
}

function responseHeader(
  records: readonly Record<string, unknown>[],
  names: readonly string[],
) {
  const expected = new Set(names.map((name) => name.toLocaleLowerCase()));
  for (const record of records) {
    const candidate = record.responseHeaders;
    if (candidate instanceof Headers) {
      for (const name of expected) {
        const value = candidate.get(name);
        if (value != null) return value;
      }
      continue;
    }
    const headers = errorRecord(candidate);
    if (!headers) continue;
    for (const [name, value] of Object.entries(headers).slice(0, 100)) {
      if (expected.has(name.toLocaleLowerCase()) && typeof value === "string") return value;
    }
  }
  return undefined;
}

function boundedRetryAfterMs(
  records: readonly Record<string, unknown>[],
  nowMs: number,
) {
  const bounded = (value: number) => Number.isFinite(value) && value >= 0
    ? Math.min(MAX_DIAGNOSTIC_RETRY_AFTER_MS, Math.ceil(value))
    : undefined;
  const retryAfterMs = responseHeader(records, ["retry-after-ms"]);
  if (retryAfterMs && /^\d{1,12}(?:\.\d{1,3})?$/.test(retryAfterMs.trim())) {
    return bounded(Number(retryAfterMs));
  }
  const retryAfter = responseHeader(records, ["retry-after"]);
  if (!retryAfter) return undefined;
  const normalized = retryAfter.trim();
  if (/^\d{1,12}(?:\.\d{1,3})?$/.test(normalized)) {
    return bounded(Number(normalized) * 1_000);
  }
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? bounded(Math.max(0, retryAt - nowMs)) : undefined;
}

function gatewayMetadataRecords(records: readonly Record<string, unknown>[]) {
  return records.flatMap((record) => {
    const metadata = errorRecord(record.providerMetadata);
    const gateway = errorRecord(metadata?.gateway);
    return gateway ? [gateway] : [];
  });
}

function providerAttemptEvidence(records: readonly Record<string, unknown>[]) {
  let upstreamProviderAttempted: boolean | undefined;
  let providerRateLimited = false;
  const attempts: Record<string, unknown>[] = [];
  for (const gateway of gatewayMetadataRecords(records)) {
    const routing = errorRecord(gateway.routing);
    if (!routing) continue;
    const totalAttemptCount = routing.totalProviderAttemptCount;
    if (typeof totalAttemptCount === "number" && Number.isInteger(totalAttemptCount) && totalAttemptCount >= 0) {
      upstreamProviderAttempted = totalAttemptCount > 0 ? true : upstreamProviderAttempted ?? false;
    }
    const modelAttempts = Array.isArray(routing.modelAttempts) ? routing.modelAttempts.slice(0, 20) : [];
    for (const modelAttempt of modelAttempts) {
      const modelRecord = errorRecord(modelAttempt);
      if (!modelRecord) continue;
      const providerAttemptCount = modelRecord.providerAttemptCount;
      if (typeof providerAttemptCount === "number" && Number.isInteger(providerAttemptCount)
          && providerAttemptCount >= 0) {
        upstreamProviderAttempted = providerAttemptCount > 0 ? true : upstreamProviderAttempted ?? false;
      }
      const providerAttempts = Array.isArray(modelRecord.providerAttempts)
        ? modelRecord.providerAttempts.slice(0, 20)
        : [];
      if (providerAttempts.length) upstreamProviderAttempted = true;
      for (const providerAttempt of providerAttempts) {
        const providerRecord = errorRecord(providerAttempt);
        if (!providerRecord) continue;
        attempts.push(providerRecord);
        const providerError = errorRecord(providerRecord.error);
        if (providerError) attempts.push(providerError);
      }
    }
  }
  const attemptCodes = explicitSignalCodes(attempts);
  providerRateLimited = attempts.some((attempt) => (
    safeHttpStatus(attempt.statusCode) === 429 || safeHttpStatus(attempt.status) === 429
  )) || attemptCodes.has("rate_limit_exceeded");
  return { upstreamProviderAttempted, providerRateLimited };
}

function hasRateDimensionHeader(
  records: readonly Record<string, unknown>[],
  dimension: "requests" | "tokens" | "images",
) {
  for (const record of records) {
    const headers = errorRecord(record.responseHeaders);
    if (!headers) continue;
    if (Object.keys(headers).slice(0, 100).some((name) => {
      const normalized = name.toLocaleLowerCase();
      return normalized.startsWith("x-ratelimit-") && normalized.includes(dimension);
    })) return true;
  }
  return false;
}

function gatewayLimitKind(input: {
  reason: AiGatewayFailureReason;
  httpStatus?: number;
  records: readonly Record<string, unknown>[];
  codes: ReadonlySet<string>;
  upstreamProviderAttempted?: boolean;
  providerRateLimited: boolean;
}): AiGatewayLimitKind | undefined {
  const messages = boundedDiagnosticMessages(input.records);
  if (hasFreeTierLimitEvidence(messages)) return "free_tier_limit";
  if (input.httpStatus === 402 || [...accountLimitCodes].some((code) => input.codes.has(code))) {
    return "account_or_credit_limit";
  }
  if ([...concurrencyLimitCodes].some((code) => input.codes.has(code))) {
    return "concurrency_limit";
  }
  if ([...requestRateLimitCodes].some((code) => input.codes.has(code))
      || (input.upstreamProviderAttempted === true
        && hasRateDimensionHeader(input.records, "requests"))) {
    return "provider_request_rate_limit";
  }
  if ([...tokenRateLimitCodes].some((code) => input.codes.has(code))
      || (input.upstreamProviderAttempted === true
        && hasRateDimensionHeader(input.records, "tokens"))) {
    return "provider_token_rate_limit";
  }
  if ([...imageRateLimitCodes].some((code) => input.codes.has(code))
      || (input.upstreamProviderAttempted === true
        && hasRateDimensionHeader(input.records, "images"))) {
    return "provider_image_rate_limit";
  }
  if (input.providerRateLimited) return "provider_rate_limit";
  return input.reason === "gateway_rate_limited" ? "unknown_rate_limit" : undefined;
}

function customerVerificationRequired(record: Record<string, unknown>) {
  const data = errorRecord(record.data);
  const providerError = errorRecord(data?.error);
  return record.type === "customer_verification_required"
    || data?.type === "customer_verification_required"
    || providerError?.type === "customer_verification_required";
}

function mappedReason(record: Record<string, unknown>): AiGatewayFailureReason | null {
  switch (record.name) {
    case "GatewayAuthenticationError": return "gateway_authentication_error";
    // ai@6 can redact GatewayAuthenticationError to this generic name in
    // production. It is emitted by the Gateway authentication wrapper.
    case "GatewayError": return "gateway_authentication_error";
    case "GatewayForbiddenError": return "gateway_forbidden";
    case "GatewayModelNotFoundError": return "gateway_model_not_found";
    case "GatewayRateLimitError": return "gateway_rate_limited";
    case "GatewayTimeoutError": return "gateway_timeout";
    case "AI_NoObjectGeneratedError":
    case "NoObjectGeneratedError": return "gateway_result_invalid";
  }

  const statusCode = typeof record.statusCode === "number" && Number.isInteger(record.statusCode)
    ? record.statusCode
    : null;
  switch (statusCode) {
    case 401: return "gateway_authentication_error";
    case 402: return "gateway_billing_required";
    case 403: return "gateway_forbidden";
    case 404: return "gateway_model_not_found";
    case 408:
    case 504: return "gateway_timeout";
    case 429: return "gateway_rate_limited";
    default: return null;
  }
}

export function classifyAiGatewayFailure(
  error: unknown,
  options: AiGatewayFailureOptions = {},
): AiGatewayFailureReason {
  const records = boundedErrorRecords(error);

  // Vercel returns this as a nested provider payload, commonly alongside a
  // generic 403. It must win over all broader status/name classifications.
  if (records.some(customerVerificationRequired)) {
    return "gateway_customer_verification_required";
  }
  if (options.signalAborted) return "runtime_timeout";

  for (const record of records) {
    const reason = mappedReason(record);
    if (reason) return reason;
  }
  return "gateway_request_failed";
}

export function inspectAiGatewayFailure(
  error: unknown,
  options: AiGatewayFailureOptions = {},
): AiGatewayFailureDiagnostic {
  const records = boundedErrorRecords(error);
  const reason = classifyAiGatewayFailure(error, options);
  const httpStatus = records.flatMap((record) => {
    const status = safeHttpStatus(record.statusCode);
    return status == null ? [] : [status];
  })[0];
  const codes = explicitSignalCodes(records);
  const providerEvidence = providerAttemptEvidence(records);
  const metadata = gatewayMetadataRecords(records);
  const generationId = [
    ...records.map((record) => record.generationId),
    ...metadata.map((record) => record.generationId),
  ].map(safeDiagnosticIdentifier).find((value) => value != null);
  const requestId = [
    responseHeader(records, ["x-request-id"]),
    responseHeader(records, ["x-vercel-id", "x-vercel-request-id"]),
    ...records.map((record) => record.requestId),
    ...metadata.map((record) => record.requestId),
  ].map(safeDiagnosticIdentifier).find((value) => value != null);
  const nowMs = typeof options.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  const retryAfterMs = boundedRetryAfterMs(records, nowMs);
  const limitKind = gatewayLimitKind({
    reason,
    httpStatus,
    records,
    codes,
    ...providerEvidence,
  });
  return {
    reason,
    ...(httpStatus == null ? {} : { httpStatus }),
    ...(limitKind == null ? {} : { limitKind }),
    ...(retryAfterMs == null ? {} : { retryAfterMs }),
    ...(generationId == null ? {} : { generationId }),
    ...(requestId == null ? {} : { requestId }),
    ...(providerEvidence.upstreamProviderAttempted == null
      ? {}
      : { upstreamProviderAttempted: providerEvidence.upstreamProviderAttempted }),
  };
}
