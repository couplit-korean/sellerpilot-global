// A gateway job that throws before it can return a failed provider result was
// recorded with only the wrapper code (for example
// SHIPPING_PROVIDER_EXECUTION_FAILED), so an operator could not tell what the
// provider actually rejected. This module extracts a bounded provider detail
// (the provider's own error code plus a shortened provider message) from the
// caught error and from any provider response envelope that travelled with it.
//
// Conventions reused from the repository:
// - lib/channels/provider-listing-failure.ts: only identifier-shaped provider
//   codes are echoed, everything else is discarded.
// - lib/shipping/execution-shared.ts `safeProviderError`: URLs are collapsed and
//   `key=value` credential fragments are redacted.
// - lib/ai-worker-error-safety.ts: secret material and private runtime paths are
//   never echoed.
//
// The wrapper code stays the prefix so existing matchers keep working and the
// provider detail is appended after a colon:
// `SHIPPING_PROVIDER_EXECUTION_FAILED:<PROVIDER_CODE>:<short provider message>`.
// Tokens, signatures, credentialed URLs and raw payloads are never included.

export const providerFailureCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/u;

const maximumDetailLength = 240;
const maximumProviderMessageLength = 180;

const providerCodeKeys = [
  "error_code",
  "errorCode",
  "errCode",
  "error_number",
  "resultCode",
  "ResultCode",
  "ErrorCode",
  "code",
] as const;

const providerMessageKeys = [
  "error_msg",
  "errorMsg",
  "error_message",
  "errorMessage",
  "message",
  "msg",
  "description",
  "desc",
  "detail",
  "reason",
] as const;

// Provider responses reach a thrown error either nested under one of these keys
// or attached as a property of the Error instance.
const providerEnvelopeKeys = [
  "providerFailure",
  "providerResponse",
  "response",
  "body",
  "data",
  "details",
  "cause",
] as const;

const urlPattern = /https?:\/\/\S+/giu;
// Any credential-shaped assignment is dropped instead of being echoed, so a
// provider message can never carry a token or a signature into the job record.
const secretAssignmentPattern =
  /(?:^|[^A-Za-z0-9_])(?:app[_-]?secret|client[_-]?secret|secret|api[_-]?key|app[_-]?key|access[_-]?token|refresh[_-]?token|authorization|signature|sign|password|passwd|pwd|session[_-]?id|_csrf)\s*[:=]/iu;
const secretValuePattern =
  /(?:^|[^A-Za-z0-9_])(?:bearer\s+[A-Za-z0-9._~+/-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|[a-f0-9]{32,}|[A-Za-z0-9_-]{40,})/iu;
const privateRuntimePattern =
  /(?:\/Users\/|\/private\/|\/var\/folders\/|file:\/\/|node_modules|[A-Za-z]:\\|\bat\s+\S+\s*\()/iu;
// Provider prose is untrusted. A message that is only an error code carries no
// prose at all, so it is kept as the code and never repeated as a message.
const providerErrorTextPattern =
  /(?:원격\s*오류|remote\s+error|provider\s+error|provider\s+rejected)\s*[:·]?\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,39})/iu;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

// The provider's own message is untrusted input. Only a bounded, sanitized
// fragment may be recorded; when anything credential-shaped or runtime-private
// is present the message is dropped entirely.
export function safeProviderFailureMessage(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw.trim()) return "";
  const compact = raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!compact) return "";
  if (privateRuntimePattern.test(compact)) return "";
  // A credentialed URL is removed as a whole, so the query string it carries
  // cannot become the recorded reason.
  const withoutUrls = compact.replace(urlPattern, "[URL]");
  if (secretAssignmentPattern.test(withoutUrls)) return "";
  if (secretValuePattern.test(withoutUrls)) return "";
  return withoutUrls
    .replace(
      /\b(?:key|token|secret|authorization|signature)\s*[:=]\s*\S+/giu,
      "[redacted]",
    )
    .slice(0, maximumProviderMessageLength)
    .trim();
}

function codeToken(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const token = String(value).trim();
  return providerFailureCodePattern.test(token) ? token : "";
}

function providerFactsFromRecord(
  data: Record<string, unknown>,
  depth = 0,
): { code: string; message: string } {
  let code = "";
  for (const key of providerCodeKeys) {
    const token = codeToken(data[key]);
    if (token) {
      code = token;
      break;
    }
  }
  const messages: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    messages.push(value);
  };
  for (const key of providerMessageKeys) push(stringValue(data[key]));
  if (depth >= 2) return { code, message: messages.join(" ") };
  for (const key of providerEnvelopeKeys) {
    const nested = recordValue(data[key]);
    if (!nested) continue;
    const facts = providerFactsFromRecord(nested, depth + 1);
    if (!code && facts.code) code = facts.code;
    if (facts.message) push(facts.message);
  }
  return { code, message: messages.join(" ") };
}

// Normalizes what the wrapper caught into the only two facts that may be
// recorded: the provider error code and a shortened provider message.
export function providerExecutionFailureFacts(value: unknown): {
  code: string;
  message: string;
} {
  if (value === null || value === undefined) return { code: "", message: "" };
  if (typeof value === "string") {
    const facts = providerFactsFromRecord({ message: value });
    return {
      code: facts.code,
      message: safeProviderFailureMessage(facts.message),
    };
  }
  const record = recordValue(value);
  const rawMessage = value instanceof Error ? value.message : "";
  // A structured provider envelope (its own error code and message) is the most
  // valuable fact, so it outranks the transport error and the thrown text. For
  // an Error instance only its own attached properties are read, so the thrown
  // text is never merged with the provider envelope message.
  const envelope = record
    ? value instanceof Error
      ? { ...record, ...(recordValue(value.cause) ? { cause: value.cause } : {}) }
      : record
    : recordValue((value as { cause?: unknown })?.cause)
      ? { cause: (value as { cause: unknown }).cause }
      : {};
  const envelopeFacts = providerFactsFromRecord(envelope);
  const directCode = value instanceof Error
    ? codeToken((value as { code?: unknown }).code)
    : "";
  let code = envelopeFacts.code
    || directCode
    // A thrown error whose whole message is one identifier-shaped token is
    // already a stable code (for example TEMU_CREDENTIALS_MISSING).
    || (providerFailureCodePattern.test(rawMessage.trim()) ? rawMessage.trim() : "");
  let message = envelopeFacts.message || rawMessage;
  // The gateway already records provider rejections as `<code> · <message>`.
  // When such a text is rethrown, keep the code and only the provider prose.
  const embedded = providerErrorTextPattern.exec(rawMessage);
  if (embedded) {
    if (!code) code = embedded[1];
    const remainder = rawMessage
      .slice(embedded.index + embedded[0].length)
      .replace(/^[\s·:,\-–]+/u, "");
    if (remainder) message = remainder;
  }
  // A provider message that is only the code itself adds nothing.
  const safeMessage = safeProviderFailureMessage(message);
  return {
    code,
    message: safeMessage && safeMessage !== code ? safeMessage : "",
  };
}

// `CODE:short message` bounded fragment. Empty when nothing safe was carried.
export function providerExecutionFailureDetail(value: unknown): string {
  const { code, message } = providerExecutionFailureFacts(value);
  return [code, message]
    .filter(Boolean)
    .join(":")
    .slice(0, maximumDetailLength)
    .trim();
}

// Keeps the wrapper code intact as the prefix and appends the provider detail
// of the first candidate that carries one, so a caller that replaced the
// original error (for example with a lease stop failure) can still pass both.
export function providerExecutionFailureError(
  wrapperCode: string,
  ...candidates: unknown[]
): string {
  const wrapper = String(wrapperCode ?? "").trim() || "PROVIDER_EXECUTION_FAILED";
  for (const candidate of candidates) {
    const detail = providerExecutionFailureDetail(candidate);
    if (detail) return `${wrapper}:${detail}`.slice(0, maximumDetailLength + 100);
  }
  return wrapper;
}
