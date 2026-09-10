import {
  buildElevenstReadonlyWebProjection,
  type ElevenstProviderReadEvidence,
  type ElevenstReadonlySurface,
  type ElevenstStoredReadSnapshot,
} from "./read-model";
import { buildElevenstLimitedAccessProjection } from "./limited-access";

function record(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ELEVENST_WEB_RPC_INVALID:${key}`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, key: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ELEVENST_WEB_RPC_INVALID:${key}`);
  }
  return value;
}

function nullableString(value: unknown, key: string) {
  if (value === null) return null;
  return string(value, key);
}

function number(value: unknown, key: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`ELEVENST_WEB_RPC_INVALID:${key}`);
  }
  return value;
}

function boolean(value: unknown, key: string) {
  if (typeof value !== "boolean") throw new Error(`ELEVENST_WEB_RPC_INVALID:${key}`);
  return value;
}

function providerEvidence(
  value: unknown,
  surface: ElevenstReadonlySurface,
  sellerId: string,
  sellerName: string,
): { provider: ElevenstProviderReadEvidence; stored: ElevenstStoredReadSnapshot } {
  const row = record(value, surface);
  const httpStatusValue = row.httpStatus;
  if (httpStatusValue !== null && (typeof httpStatusValue !== "number" || !Number.isSafeInteger(httpStatusValue))) {
    throw new Error(`ELEVENST_WEB_RPC_INVALID:${surface}.httpStatus`);
  }
  return {
    provider: {
      surface,
      sellerId,
      sellerName,
      checkedAt: string(row.checkedAt, `${surface}.checkedAt`),
      httpStatus: httpStatusValue as number | null,
      accepted: boolean(row.accepted, `${surface}.accepted`),
      resultCode: nullableString(row.resultCode, `${surface}.resultCode`),
      providerRows: number(row.providerRows, `${surface}.providerRows`),
    },
    stored: {
      rowCount: number(row.storedRowCount, `${surface}.storedRowCount`),
      latestReceivedAt: nullableString(row.latestStoredReceivedAt, `${surface}.latestStoredReceivedAt`),
    },
  };
}

export function projectElevenstReadStateRpc(value: unknown) {
  const result = record(value, "root");
  const sellerId = string(result.sellerId, "sellerId");
  const sellerName = string(result.sellerName, "sellerName");
  const credentialId = string(result.credentialId, "credentialId");
  const productQna = providerEvidence(result.productQna, "product_qna", sellerId, sellerName);
  const urgentAlimi = providerEvidence(result.urgentAlimi, "urgent_alimi", sellerId, sellerName);
  return {
    contractVersion: "sellerpilot-elevenst-authenticated-read-state/5" as const,
    credentialId,
    sellerId,
    sellerName,
    productQna: buildElevenstReadonlyWebProjection(productQna),
    urgentAlimi: buildElevenstReadonlyWebProjection(urgentAlimi),
    sellerTalk: buildElevenstLimitedAccessProjection("seller_talk"),
    review: buildElevenstLimitedAccessProjection("review"),
    readOnly: true as const,
  };
}
