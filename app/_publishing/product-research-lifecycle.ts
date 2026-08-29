import { productResearchFailureMessage } from "../../lib/product-research-failure";
import {
  sourcePreservingProductImageSpecSchema,
  type SourcePreservingProductImageSpec,
} from "../../lib/product-intake";

export const productResearchPendingStorageKey = "sellerpilot:product-research-pending:v3";

export type PendingProductResearch = {
  version: 3;
  jobId: string;
  researchInput: string;
  ownerId: string;
  sourcePhotoSha256: string;
  lineageReceipt: string;
  imagePaths: string[];
  imageSpecs: SourcePreservingProductImageSpec[];
  cleanupPaths: string[];
  createdAt: number;
};

const productResearchJobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProductResearchJobId(value: unknown): value is string {
  return typeof value === "string" && productResearchJobIdPattern.test(value);
}

export function pendingProductResearchForOwner(
  value: unknown,
  ownerId: string,
  researchInput: string,
  sourcePhotoSha256: string,
): PendingProductResearch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawImagePaths = Array.isArray(record.imagePaths) ? record.imagePaths : [];
  const rawImageSpecs = Array.isArray(record.imageSpecs) ? record.imageSpecs : [];
  const rawCleanupPaths = Array.isArray(record.cleanupPaths) ? record.cleanupPaths : [];
  // Recovery data is security-sensitive lineage. Never silently filter or
  // reindex malformed entries because that can pair a normalized image with a
  // different original/specification on the next enqueue attempt.
  const imagePaths = rawImagePaths.every(
    (path): path is string => typeof path === "string" && path.length > 0 && path.length <= 400,
  ) ? [...rawImagePaths] : [];
  const parsedImageSpecs = rawImageSpecs.map((spec) => sourcePreservingProductImageSpecSchema.safeParse(spec));
  const imageSpecs = parsedImageSpecs.every((parsed) => parsed.success)
    ? parsedImageSpecs.map((parsed) => parsed.data)
    : [];
  const cleanupPaths = rawCleanupPaths.every(
    (path): path is string => typeof path === "string" && path.length > 0 && path.length <= 400,
  ) ? [...rawCleanupPaths] : [];
  if (record.version !== 3
      || record.ownerId !== ownerId
      || record.researchInput !== researchInput
      || record.sourcePhotoSha256 !== sourcePhotoSha256
      || typeof record.lineageReceipt !== "string"
      || (record.lineageReceipt.length > 0 && (record.lineageReceipt.length < 32 || record.lineageReceipt.length > 2_000))
      || !imagePaths.length
      || imagePaths.length !== imageSpecs.length
      || !cleanupPaths.length
      || typeof record.createdAt !== "number"
      || !Number.isFinite(record.createdAt)
      || record.createdAt <= 0
      || !isProductResearchJobId(record.jobId)) return null;
  return {
    version: 3,
    jobId: record.jobId,
    researchInput,
    ownerId,
    sourcePhotoSha256,
    lineageReceipt: record.lineageReceipt,
    imagePaths,
    imageSpecs,
    cleanupPaths,
    createdAt: record.createdAt,
  };
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
