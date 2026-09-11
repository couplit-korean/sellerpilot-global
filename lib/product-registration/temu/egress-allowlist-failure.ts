import {
  egressIpSha256,
  observedLocalEgressSha256,
} from "../../channels/local-channel-executor";

// Temu answers `errorCode 5000003 NOT_IN_IP_WHITE_LIST` when the calling egress
// IP is not registered in the seller console. That outcome is not an identity,
// scope, or credential problem, so it must not be reported as one. This module
// classifies only facts that are present in the provider response (HTTP status,
// provider error code, provider error message) and never echoes provider prose,
// the raw source IP, or any credential value.
export const temuEgressIpNotAllowlistedCode =
  "TEMU_EGRESS_IP_NOT_ALLOWLISTED" as const;

export const temuEgressAllowlistProviderErrorCode = "5000003" as const;

// Operator console for the Temu app IP allowlist, same page the operator UI
// contract already points at.
export const temuEgressAllowlistConsoleUrl =
  "https://partner.temu.com/app/app-mgmt/ip-allowlist" as const;

const digestPattern = /^[a-f0-9]{64}$/u;
const providerCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/u;
// Classification-only. The matched text is never copied into a code or message.
const allowlistMessagePattern =
  /(?:not[ _-]?in[ _-]?ip[ _-]?white[ _-]?list|ip[ _-]?white[ _-]?list|ip[ _-]?allow[ _-]?list)/iu;

export type TemuEgressFingerprint = {
  sha256: string | null;
  // Operator-facing short form. Same 11 hex characters the local worker prints
  // in its `sellerpilot-cli-worker/1.61+<release>.<egress prefix>` version.
  prefix: string | null;
};

const emptyFingerprint: TemuEgressFingerprint = { sha256: null, prefix: null };

export function temuEgressFingerprintFromSha256(
  value: unknown,
): TemuEgressFingerprint {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
  return digestPattern.test(normalized)
    ? { sha256: normalized, prefix: normalized.slice(0, 11) }
    : emptyFingerprint;
}

export function temuEgressFingerprintFromObservedIp(
  value: unknown,
): TemuEgressFingerprint {
  return temuEgressFingerprintFromSha256(egressIpSha256(value));
}

// Resolution order: an explicit fingerprint, then an already-computed digest,
// then an explicit source IP, then the egress the local operator worker
// observed for this process. When none of those exist the fingerprint stays
// explicitly null instead of being invented.
export function resolveTemuEgressFingerprint(
  value: unknown,
): TemuEgressFingerprint {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const explicit = temuEgressFingerprintFromSha256(
      (value as { sha256?: unknown }).sha256,
    );
    if (explicit.sha256) return explicit;
  } else if (typeof value === "string") {
    // A caller may hand over an already-computed digest instead of a raw address.
    const digest = temuEgressFingerprintFromSha256(value);
    if (digest.sha256) return digest;
    const observed = temuEgressFingerprintFromObservedIp(value);
    if (observed.sha256) return observed;
  }
  return temuEgressFingerprintFromSha256(observedLocalEgressSha256());
}

const providerCodeKeys = [
  "errorCode",
  "error_code",
  "errCode",
  "code",
  "resultCode",
] as const;

const providerMessageKeys = [
  "errorMsg",
  "error_msg",
  "errorMessage",
  "error_message",
  "message",
  "msg",
  "description",
] as const;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerCodeToken(data: Record<string, unknown>) {
  for (const key of providerCodeKeys) {
    const value = data[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const token = String(value).trim();
    if (providerCodePattern.test(token)) return token;
  }
  return null;
}

function providerMessageText(data: Record<string, unknown>) {
  const values: string[] = [];
  for (const key of providerMessageKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
  }
  return values.join(" ").slice(0, 400);
}

export type TemuEgressAllowlistEvidence = {
  notAllowlisted: boolean;
  providerErrorCode: string | null;
  code: typeof temuEgressIpNotAllowlistedCode | null;
  message: string | null;
  egress: TemuEgressFingerprint;
};

export function temuEgressAllowlistMessage(egress: unknown): string {
  const resolved = resolveTemuEgressFingerprint(egress);
  const fingerprint = resolved.prefix
    ? `현재 egress sha256 prefix ${resolved.prefix}`
    : "이 경로에서 관측한 egress sha256 없음";
  return [
    temuEgressIpNotAllowlistedCode,
    "·",
    "Temu가 현재 송신 IP를 허용 목록에서 거부했습니다",
    `(errorCode ${temuEgressAllowlistProviderErrorCode} NOT_IN_IP_WHITE_LIST, ${fingerprint}).`,
    "Temu 파트너 콘솔 IP allowlist에 현재 채널 egress IP를 등록한 뒤 다시 시도해 주세요.",
    `(${temuEgressAllowlistConsoleUrl})`,
  ].join(" ");
}

export function classifyTemuEgressAllowlistFailure(input: {
  status?: unknown;
  data: unknown;
  egress?: unknown;
}): TemuEgressAllowlistEvidence {
  const data = recordValue(input.data);
  const providerErrorCode = providerCodeToken(data);
  const providerMessage = providerMessageText(data);
  const notAllowlisted = providerErrorCode === temuEgressAllowlistProviderErrorCode
    || allowlistMessagePattern.test(`${providerErrorCode ?? ""} ${providerMessage}`);
  const egress = resolveTemuEgressFingerprint(input.egress);
  if (!notAllowlisted) {
    return {
      notAllowlisted: false,
      providerErrorCode,
      code: null,
      message: null,
      egress,
    };
  }
  return {
    notAllowlisted: true,
    providerErrorCode,
    code: temuEgressIpNotAllowlistedCode,
    message: temuEgressAllowlistMessage(egress),
    egress,
  };
}

// Shared failure type for both the identity attestation and the authoritative
// provider read path so the same stable code, egress fingerprint and Korean
// operator message reach the existing failure surfaces.
export class TemuEgressIpNotAllowlistedError extends Error {
  readonly code = temuEgressIpNotAllowlistedCode;
  readonly providerErrorCode: string | null;
  readonly egressSha256: string | null;
  readonly egressSha256Prefix: string | null;

  constructor(input: {
    providerErrorCode?: string | null;
    egress?: unknown;
  } = {}) {
    const egress = resolveTemuEgressFingerprint(input.egress);
    super(temuEgressAllowlistMessage(egress));
    this.name = "TemuEgressIpNotAllowlistedError";
    this.providerErrorCode = input.providerErrorCode ?? null;
    this.egressSha256 = egress.sha256;
    this.egressSha256Prefix = egress.prefix;
  }
}

export function isTemuEgressIpNotAllowlistedError(
  value: unknown,
): value is TemuEgressIpNotAllowlistedError {
  return value instanceof TemuEgressIpNotAllowlistedError;
}

export function temuEgressAllowlistStepData(
  evidence: TemuEgressAllowlistEvidence,
): Record<string, unknown> {
  if (!evidence.notAllowlisted) return {};
  return {
    sellerpilotTemuProviderErrorCode: evidence.providerErrorCode,
    sellerpilotTemuEgressSha256: evidence.egress.sha256,
    sellerpilotTemuEgressSha256Prefix: evidence.egress.prefix,
    sellerpilotTemuEgressAllowlistUrl: temuEgressAllowlistConsoleUrl,
  };
}
