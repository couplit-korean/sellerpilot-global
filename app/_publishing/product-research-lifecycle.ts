import { productResearchFailureMessage } from "../../lib/product-research-failure";

export const productResearchPendingStorageKey = "sellerpilot:product-research-pending:v1";

export type PendingProductResearch = {
  jobId: string;
  researchInput: string;
  ownerId: string;
};

const productResearchJobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProductResearchJobId(value: unknown): value is string {
  return typeof value === "string" && productResearchJobIdPattern.test(value);
}

export function pendingProductResearchForOwner(
  value: unknown,
  ownerId: string,
  researchInput: string,
): PendingProductResearch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.ownerId !== ownerId
      || record.researchInput !== researchInput
      || !isProductResearchJobId(record.jobId)) return null;
  return { jobId: record.jobId, researchInput, ownerId };
}

export class ProductResearchNotFoundError extends Error {
  constructor() {
    super("요청한 AI 상품정보 작업을 찾지 못했습니다.");
    this.name = "ProductResearchNotFoundError";
  }
}

export class ProductResearchTerminalError extends Error {
  constructor(message?: string | null) {
    super(productResearchFailureMessage(message));
    this.name = "ProductResearchTerminalError";
  }
}

export function shouldClearPendingProductResearch(error: unknown) {
  return error instanceof ProductResearchNotFoundError
    || error instanceof ProductResearchTerminalError;
}

const unresolvedResearchValue = /(?:확인\s*필요|미확인|알\s*수\s*없|unknown|not\s+provided|n\/?a|no\s+brand)/i;

export function confirmedProductResearchValue(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && !unresolvedResearchValue.test(normalized) ? normalized : "";
}
