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

type AiGatewayFailureOptions = {
  signalAborted?: boolean;
};

const MAX_INSPECTED_RECORDS = 12;
const MAX_LINKED_ERRORS = 3;

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
