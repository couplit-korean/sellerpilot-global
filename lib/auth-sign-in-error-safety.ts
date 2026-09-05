const signInMessages = {
  credentials: "아이디 또는 비밀번호를 확인해 주세요.",
  rateLimit: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  service: "로그인 서버가 일시적으로 응답하지 못하고 있습니다. 잠시 후 다시 시도해 주세요.",
  network: "로그인 서버에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.",
  cancelled: "로그인 요청이 중단되었습니다. 로그인 화면에서 다시 진행해 주세요.",
  unknown: "로그인을 완료하지 못했습니다. 문제가 계속되면 관리자에게 문의해 주세요.",
} as const;

const rateLimitCodes = new Set([
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
]);

const networkCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

const fetchFailureMessages = new Set([
  "Failed to fetch", "fetch failed", "Network request failed", "Load failed",
  "NetworkError when attempting to fetch resource.",
]);

function errorField(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Client-safe, side-effect-free classification. Never return upstream text.
 * Supabase auth-js 2.112.3 exposes AuthApiError.code/status and wraps transport
 * failures as AuthRetryableFetchError (status 0 without a response, 5xx for
 * infrastructure responses). AuthInvalidCredentialsError without a code can
 * mean missing input, so its name alone is NOT proof of wrong credentials.
 */
export function getSafeSignInError(error: unknown): string {
  const code = errorField(error, "code");
  const name = errorField(error, "name");
  const status = errorField(error, "status");

  // Infrastructure/rate-limit evidence wins over conflicting credential data.
  if (status === 429 || (typeof code === "string" && rateLimitCodes.has(code))) {
    return signInMessages.rateLimit;
  }
  if (
    (typeof status === "number" && status >= 500 && status <= 599)
    || code === "unexpected_failure"
  ) {
    return signInMessages.service;
  }
  if (
    name === "AuthRetryableFetchError" || name === "RetryableFetchError"
    || name === "NetworkError" || name === "TimeoutError"
    || code === "request_timeout"
    || (typeof code === "string" && networkCodes.has(code))
  ) {
    return signInMessages.network;
  }
  if (name === "AbortError") return signInMessages.cancelled;
  if (code === "invalid_credentials") return signInMessages.credentials;

  // Only exact standard fetch failures are recognized; arbitrary TypeErrors
  // and message strings (including "Invalid login credentials") stay unknown.
  if (name === "TypeError") {
    const message = errorField(error, "message");
    if (typeof message === "string" && fetchFailureMessages.has(message)) {
      return signInMessages.network;
    }
  }
  return signInMessages.unknown;
}
