import { classifyElevenstQnaResponse } from "../../../channels/cs/elevenst/contracts";

export type ElevenstReadonlySurface = "product_qna" | "urgent_alimi";

export type ElevenstProviderReadEvidence = {
  surface: ElevenstReadonlySurface;
  sellerId: string;
  sellerName: string;
  checkedAt: string;
  httpStatus: number | null;
  accepted: boolean;
  resultCode: string | null;
  providerRows: number;
};

export type ElevenstStoredReadSnapshot = {
  rowCount: number;
  latestReceivedAt: string | null;
};

export type ElevenstReadonlyWebProjection = {
  contractVersion: "sellerpilot-elevenst-readonly-web-projection/1";
  surface: ElevenstReadonlySurface;
  providerState:
    | "ready"
    | "empty"
    | "business_error"
    | "authorization_error"
    | "provider_unavailable"
    | "unverified_failure";
  remoteCount: number | null;
  storedCount: number;
  storedHistoryState: "current" | "preserved_unverified";
  emptyConfirmed: boolean;
  replyEnabled: false;
  checkedAt: string;
  latestStoredReceivedAt: string | null;
  message: string;
};

const SELLER_ID = "couplit";
const SELLER_NAME = "커플릿";

function nonNegativeInteger(value: number, key: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ELEVENST_READ_MODEL_INVALID:${key}`);
  }
  return value;
}

function isoTimestamp(value: string, key: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error(`ELEVENST_READ_MODEL_INVALID:${key}`);
  }
  return value;
}

function classifyAlimi(input: ElevenstProviderReadEvidence) {
  if (input.httpStatus === 200 && input.accepted && input.resultCode === "0") {
    return input.providerRows === 0 ? "accepted_empty" : "accepted_rows";
  }
  if (input.httpStatus === 200 && input.resultCode && input.resultCode !== "0") {
    return "business_error";
  }
  if (input.httpStatus === 401 || input.httpStatus === 403) return "authorization_error";
  if (input.httpStatus !== null && input.httpStatus >= 500) return "provider_unavailable";
  return "unverified_failure";
}

export function buildElevenstReadonlyWebProjection(input: {
  provider: ElevenstProviderReadEvidence;
  stored: ElevenstStoredReadSnapshot;
}): ElevenstReadonlyWebProjection {
  if (input.provider.sellerId !== SELLER_ID || input.provider.sellerName !== SELLER_NAME) {
    throw new Error("ELEVENST_READ_MODEL_SELLER_SCOPE_MISMATCH");
  }
  const checkedAt = isoTimestamp(input.provider.checkedAt, "checkedAt");
  const latestStoredReceivedAt = input.stored.latestReceivedAt === null
    ? null
    : isoTimestamp(input.stored.latestReceivedAt, "latestReceivedAt");
  const storedCount = nonNegativeInteger(input.stored.rowCount, "stored.rowCount");
  const providerRows = nonNegativeInteger(input.provider.providerRows, "provider.providerRows");
  const classification = input.provider.surface === "product_qna"
    ? classifyElevenstQnaResponse({ ...input.provider, providerRows })
    : classifyAlimi({ ...input.provider, providerRows });

  if (classification === "accepted_empty" || classification === "accepted_rows") {
    const empty = classification === "accepted_empty";
    return {
      contractVersion: "sellerpilot-elevenst-readonly-web-projection/1",
      surface: input.provider.surface,
      providerState: empty ? "empty" : "ready",
      remoteCount: providerRows,
      storedCount,
      storedHistoryState: "current",
      emptyConfirmed: empty,
      replyEnabled: false,
      checkedAt,
      latestStoredReceivedAt,
      message: empty
        ? "11번가 원격 조회가 정상 완료되었으며 이 조회 범위의 결과는 0건입니다."
        : `11번가 원격 조회 ${providerRows}건을 읽기 전용으로 확인했습니다.`,
    };
  }

  const messages = {
    business_error: "11번가가 업무 오류를 반환했습니다. 원격 0건으로 표시하지 않습니다.",
    authorization_error: "11번가 인증 또는 허용 IP를 확인해야 합니다. 원격 0건으로 표시하지 않습니다.",
    provider_unavailable: "11번가 원격 서비스 응답을 확인하지 못했습니다. 원격 0건으로 표시하지 않습니다.",
    unverified_failure: "11번가 원격 응답을 완료 상태로 검증하지 못했습니다. 원격 0건으로 표시하지 않습니다.",
  } as const;
  return {
    contractVersion: "sellerpilot-elevenst-readonly-web-projection/1",
    surface: input.provider.surface,
    providerState: classification,
    remoteCount: null,
    storedCount,
    storedHistoryState: "preserved_unverified",
    emptyConfirmed: false,
    replyEnabled: false,
    checkedAt,
    latestStoredReceivedAt,
    message: messages[classification],
  };
}
