import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const aiGatewayRuntimeVerificationCookieName = "sellerpilot_ai_gateway_verified";
export const aiGatewayRuntimeVerificationSuccessTtlMs = 10 * 60_000;
export const aiGatewayRuntimeVerificationFailureTtlMs = 2 * 60_000;

const verificationVersion = 1;
const maximumClockSkewMs = 30_000;
const maximumCookieValueLength = 1_024;

const safeFailureCodes = new Set([
  "authentication_error",
  "billing_required",
  "customer_verification_required",
  "failed_dependency",
  "forbidden",
  "internal_server_error",
  "invalid_request_error",
  "model_not_found",
  "no_output",
  "rate_limit_exceeded",
  "response_error",
  "timeout_error",
  "unknown",
] as const);

export type AiGatewayRuntimeVerificationFailureCode =
  | "authentication_error"
  | "billing_required"
  | "customer_verification_required"
  | "failed_dependency"
  | "forbidden"
  | "internal_server_error"
  | "invalid_request_error"
  | "model_not_found"
  | "no_output"
  | "rate_limit_exceeded"
  | "response_error"
  | "timeout_error"
  | "unknown";

export type AiGatewayRuntimeVerification = {
  status: "unverified" | "verified" | "failed";
  code: AiGatewayRuntimeVerificationFailureCode | null;
  checkedAt: string | null;
  expiresAt: string | null;
};

type StoredVerification = {
  v: 1;
  s: "verified" | "failed";
  c: AiGatewayRuntimeVerificationFailureCode | null;
  i: number;
  e: number;
  x: string;
};

type VerificationOptions = {
  secret: string;
  context: string;
  nowMs?: number;
};

function unverified(): AiGatewayRuntimeVerification {
  return { status: "unverified", code: null, checkedAt: null, expiresAt: null };
}

function contextFingerprint(context: string) {
  return createHash("sha256").update(context).digest("base64url").slice(0, 22);
}

function signingKey(secret: string) {
  return createHash("sha256").update(`sellerpilot-ai-gateway-verification-v1:${secret}`).digest();
}

function signature(unsignedValue: string, secret: string) {
  return createHmac("sha256", signingKey(secret)).update(unsignedValue).digest("base64url");
}

function normalizedFailureCode(value: unknown): AiGatewayRuntimeVerificationFailureCode {
  return typeof value === "string" && safeFailureCodes.has(value as AiGatewayRuntimeVerificationFailureCode)
    ? value as AiGatewayRuntimeVerificationFailureCode
    : "unknown";
}

function validOptions(options: VerificationOptions) {
  return options.secret.length >= 32 && options.context.length >= 1 && options.context.length <= 512;
}

export function sealAiGatewayRuntimeVerification(
  result: { ok: boolean; code?: unknown },
  options: VerificationOptions,
) {
  if (!validOptions(options)) return null;
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || nowMs < 0) return null;
  const status = result.ok ? "verified" : "failed";
  const ttlMs = result.ok
    ? aiGatewayRuntimeVerificationSuccessTtlMs
    : aiGatewayRuntimeVerificationFailureTtlMs;
  const payload: StoredVerification = {
    v: verificationVersion,
    s: status,
    c: result.ok ? null : normalizedFailureCode(result.code),
    i: Math.floor(nowMs),
    e: Math.floor(nowMs + ttlMs),
    x: contextFingerprint(options.context),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const unsignedValue = `v1.${encoded}`;
  return {
    value: `${unsignedValue}.${signature(unsignedValue, options.secret)}`,
    maxAgeSeconds: Math.floor(ttlMs / 1_000),
    expiresAt: new Date(payload.e).toISOString(),
  };
}

function cookieValue(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    if (item.slice(0, separator).trim() !== aiGatewayRuntimeVerificationCookieName) continue;
    return item.slice(separator + 1).trim();
  }
  return "";
}

function parseStoredVerification(value: string): StoredVerification | null {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<StoredVerification>;
    const keys = Object.keys(candidate).sort().join(",");
    if (keys !== "c,e,i,s,v,x"
        || candidate.v !== verificationVersion
        || (candidate.s !== "verified" && candidate.s !== "failed")
        || typeof candidate.i !== "number"
        || typeof candidate.e !== "number"
        || typeof candidate.x !== "string") return null;
    if (candidate.s === "verified" && candidate.c !== null) return null;
    if (candidate.s === "failed"
        && (typeof candidate.c !== "string"
          || !safeFailureCodes.has(candidate.c as AiGatewayRuntimeVerificationFailureCode))) return null;
    return candidate as StoredVerification;
  } catch {
    return null;
  }
}

export function readAiGatewayRuntimeVerification(
  cookieHeader: string | null | undefined,
  options: VerificationOptions,
): AiGatewayRuntimeVerification {
  if (!validOptions(options)) return unverified();
  const value = cookieValue(cookieHeader);
  if (!value || value.length > maximumCookieValueLength) return unverified();
  const parts = value.split(".");
  if (parts.length !== 3) return unverified();
  const unsignedValue = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signature(unsignedValue, options.secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return unverified();

  const stored = parseStoredVerification(value);
  const nowMs = options.nowMs ?? Date.now();
  if (!stored
      || !Number.isFinite(nowMs)
      || stored.x !== contextFingerprint(options.context)
      || stored.i > nowMs + maximumClockSkewMs
      || stored.e <= nowMs
      || stored.e <= stored.i) return unverified();
  const maximumTtl = stored.s === "verified"
    ? aiGatewayRuntimeVerificationSuccessTtlMs
    : aiGatewayRuntimeVerificationFailureTtlMs;
  if (stored.e - stored.i > maximumTtl) return unverified();
  return {
    status: stored.s,
    code: stored.c,
    checkedAt: new Date(stored.i).toISOString(),
    expiresAt: new Date(stored.e).toISOString(),
  };
}
