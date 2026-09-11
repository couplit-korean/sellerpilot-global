import type { ChannelOperationStep } from "./operation-step";

// Lazada and Smartstore product writes failed with a generic safe message
// because neither channel mapped the provider transport outcome to a stable
// verification code. This module classifies a provider create/update rejection
// from facts that are actually present in the provider response (HTTP status,
// provider error code, provider error message) and returns a stable code plus a
// short Korean seller-facing message. It never invents a classification: an
// outcome that cannot be classified falls back to a generic code that carries
// the provider status.

export type ProviderListingFailureChannel = "lazada" | "smartstore";

export type ProviderListingFailureOperation = "listing.create" | "listing.update";

export type ProviderListingFailureClassification =
  | "auth_rejected"
  | "permission_denied"
  | "rate_limited"
  | "validation_rejected"
  | "conflict"
  | "provider_unavailable"
  | "unclassified";

export type ProviderListingFailureCode =
  | "LAZADA_LISTING_AUTH_REJECTED"
  | "LAZADA_LISTING_PERMISSION_DENIED"
  | "LAZADA_LISTING_RATE_LIMITED"
  | "LAZADA_LISTING_VALIDATION_REJECTED"
  | "LAZADA_LISTING_CONFLICT"
  | "LAZADA_LISTING_PROVIDER_UNAVAILABLE"
  | "SMARTSTORE_LISTING_AUTH_REJECTED"
  | "SMARTSTORE_LISTING_PERMISSION_DENIED"
  | "SMARTSTORE_LISTING_RATE_LIMITED"
  | "SMARTSTORE_LISTING_VALIDATION_REJECTED"
  | "SMARTSTORE_LISTING_CONFLICT"
  | "SMARTSTORE_LISTING_PROVIDER_UNAVAILABLE"
  | `${"LAZADA_LISTING" | "SMARTSTORE_LISTING"}_PROVIDER_ERROR_HTTP_${string}`;

export type ProviderListingFailure = {
  channel: ProviderListingFailureChannel;
  operation: ProviderListingFailureOperation;
  classification: ProviderListingFailureClassification;
  code: ProviderListingFailureCode;
  message: string;
  providerStatus: number;
  providerCode: string;
};

export type ProviderListingFailureInput = {
  channel: ProviderListingFailureChannel;
  operation: ProviderListingFailureOperation;
  status: unknown;
  data: unknown;
};

const channelContract = {
  lazada: {
    name: "Lazada",
    codePrefix: "LAZADA_LISTING",
    codes: {
      auth_rejected: "LAZADA_LISTING_AUTH_REJECTED",
      permission_denied: "LAZADA_LISTING_PERMISSION_DENIED",
      rate_limited: "LAZADA_LISTING_RATE_LIMITED",
      validation_rejected: "LAZADA_LISTING_VALIDATION_REJECTED",
      conflict: "LAZADA_LISTING_CONFLICT",
      provider_unavailable: "LAZADA_LISTING_PROVIDER_UNAVAILABLE",
    },
  },
  smartstore: {
    name: "스마트스토어",
    codePrefix: "SMARTSTORE_LISTING",
    codes: {
      auth_rejected: "SMARTSTORE_LISTING_AUTH_REJECTED",
      permission_denied: "SMARTSTORE_LISTING_PERMISSION_DENIED",
      rate_limited: "SMARTSTORE_LISTING_RATE_LIMITED",
      validation_rejected: "SMARTSTORE_LISTING_VALIDATION_REJECTED",
      conflict: "SMARTSTORE_LISTING_CONFLICT",
      provider_unavailable: "SMARTSTORE_LISTING_PROVIDER_UNAVAILABLE",
    },
  },
} as const;

const operationLabel: Record<ProviderListingFailureOperation, string> = {
  "listing.create": "상품 등록",
  "listing.update": "상품 수정",
};

// Provider error codes are opaque tokens. Anything that is not a short
// identifier-shaped token (URLs, prose, `token=...` fragments, signatures) is
// discarded instead of being echoed back to the seller.
const providerCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/u;

const providerCodeKeys = [
  "code",
  "error",
  "error_code",
  "errorCode",
  "errCode",
  "resultCode",
  "ResultCode",
  "ErrorCode",
] as const;

const providerMessageKeys = [
  "message",
  "msg",
  "error_description",
  "errorMessage",
  "error_message",
  "detail",
  "description",
  "reason",
] as const;

const rateLimitedPattern =
  /(rate[_ -]?limit|too many requests|frequency exceeds|exceed(s|ed)? the (?:api )?call limit|api call limit|throttl)/iu;
const authRejectedPattern =
  /(authn|unauthori[sz]ed|invalid[ _-]?(?:access[ _-]?)?token|illegal[ _-]?access[ _-]?token|access[ _-]?token[ _-]?expired|token[ _-]?expired|invalid[ _-]?app[ _-]?key|invalid[ _-]?(?:request[ _-]?)?signature|incomplete[ _-]?signature|invalid[ _-]?timestamp|login is invalid|authentication failed)/iu;
const permissionDeniedPattern =
  /(authz|forbidden|no[ _-]?authority|not[ _-]?authori[sz]ed|permission denied|insufficient[ _-]?permission|access denied)/iu;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerStatusValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999
    ? value
    : 0;
}

function providerCodeValue(data: Record<string, unknown>) {
  for (const key of providerCodeKeys) {
    const value = data[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const token = String(value).trim();
    if (providerCodePattern.test(token)) return token;
  }
  return "";
}

// Classification-only text. It is never echoed into the seller-facing code or
// message, so no provider prose can leak through this helper.
function providerMessageText(data: Record<string, unknown>) {
  const values: string[] = [];
  for (const key of providerMessageKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
  }
  return values.join(" ").slice(0, 400);
}

function classifyFailure(input: {
  status: number;
  providerCode: string;
  providerMessage: string;
}): ProviderListingFailureClassification {
  const hints = `${input.providerCode} ${input.providerMessage}`;
  if (input.status === 429 || rateLimitedPattern.test(hints)) return "rate_limited";
  if (input.status === 401 || authRejectedPattern.test(hints)) return "auth_rejected";
  if (input.status === 403 || permissionDeniedPattern.test(hints)) return "permission_denied";
  if (input.status === 400 || input.status === 422) return "validation_rejected";
  if (input.status === 409) return "conflict";
  if (input.status === 408 || input.status === 425 || (input.status >= 500 && input.status <= 599)) {
    return "provider_unavailable";
  }
  return "unclassified";
}

function failureSentence(input: {
  classification: ProviderListingFailureClassification;
  channelName: string;
  label: string;
  statusLabel: string;
}) {
  switch (input.classification) {
    case "auth_rejected":
      return `${input.channelName} ${input.label} 요청이 판매채널 인증 거부로 실패했습니다 (HTTP ${input.statusLabel}). 연결 키와 액세스 토큰 상태를 확인해 주세요.`;
    case "permission_denied":
      return `${input.channelName} ${input.label} 권한이 거부됐습니다 (HTTP ${input.statusLabel}). 판매자 계정의 API 권한과 카테고리 판매 권한을 확인해 주세요.`;
    case "rate_limited":
      return `${input.channelName} 호출 한도에 도달해 ${input.label}을 실행하지 못했습니다 (HTTP ${input.statusLabel}). 잠시 후 같은 작업을 다시 실행해 주세요.`;
    case "validation_rejected":
      return `${input.channelName}이 ${input.label} 요청값을 거부했습니다 (HTTP ${input.statusLabel}). 채널이 요구하는 필수값과 카테고리 속성을 확인해 주세요.`;
    case "conflict":
      return `${input.channelName}에 같은 상품 식별값이 이미 존재합니다 (HTTP ${input.statusLabel}). 기존 상품 연결·수정 절차가 필요합니다.`;
    case "provider_unavailable":
      return `${input.channelName}이 응답하지 않아 ${input.label} 결과를 확인할 수 없습니다 (HTTP ${input.statusLabel}). 판매자센터에서 원격 상태를 확인한 뒤 다시 시도해 주세요.`;
    default:
      return `${input.channelName} ${input.label}이 원격 오류로 실패했습니다 (HTTP ${input.statusLabel}). 분류할 수 있는 공급자 오류 코드가 없습니다.`;
  }
}

export function normalizeProviderListingFailure(
  input: ProviderListingFailureInput,
): ProviderListingFailure {
  const contract = channelContract[input.channel];
  const data = recordValue(input.data);
  const providerStatus = providerStatusValue(input.status);
  const providerCode = providerCodeValue(data);
  const classification = classifyFailure({
    status: providerStatus,
    providerCode,
    providerMessage: providerMessageText(data),
  });
  const code: ProviderListingFailureCode = classification === "unclassified"
    ? `${contract.codePrefix}_PROVIDER_ERROR_HTTP_${providerStatus > 0 ? String(providerStatus) : "UNKNOWN"}`
    : contract.codes[classification];
  const statusLabel = providerStatus > 0 ? String(providerStatus) : "UNKNOWN";
  const sentence = failureSentence({
    classification,
    channelName: contract.name,
    label: operationLabel[input.operation],
    statusLabel,
  });
  return {
    channel: input.channel,
    operation: input.operation,
    classification,
    code,
    // The stable code is part of the seller-facing reason so the operation
    // attempt and listing failure record carry it, not only the step payload.
    message: `${code} · ${sentence}${providerCode ? ` · 공급자 코드 ${providerCode}` : ""}`,
    providerStatus,
    providerCode,
  };
}

// Step annotation merged into the step data the operation result already
// returns. `sellerpilotVerification` is the same surface other channels use,
// and `sellerpilotVerificationMessage` is the key `safeProviderError` reads so
// the reason reaches the operation attempt and listing failure record.
export function providerListingFailureStepData(
  failure: ProviderListingFailure,
): Record<string, unknown> {
  return {
    sellerpilotVerification: failure.code,
    sellerpilotVerificationMessage: failure.message,
    sellerpilotProviderFailure: {
      channel: failure.channel,
      operation: failure.operation,
      classification: failure.classification,
      providerStatus: failure.providerStatus,
      providerCode: failure.providerCode || null,
    },
  };
}

export function annotateProviderListingFailureStep(
  step: ChannelOperationStep,
  input: {
    channel: ProviderListingFailureChannel;
    operation: ProviderListingFailureOperation;
  },
): ChannelOperationStep {
  if (step.ok) return step;
  const failure = normalizeProviderListingFailure({
    channel: input.channel,
    operation: input.operation,
    status: step.status,
    data: step.data,
  });
  return {
    ...step,
    data: { ...step.data, ...providerListingFailureStepData(failure) },
  };
}
