import {
  listingExpectedPublicationLocale,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import { verifyListingUpdateReadback } from "./listing-update";
import {
  lazadaRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

type ListingMutationOperation = "listing.create" | "listing.update" | "listing.stop";
type UnknownRecord = Record<string, unknown>;

export type LazadaPublicationReadbackVerification = {
  remoteState?: VerifiedListingRemoteState;
  providerStatus: string;
  imageCount: number;
  checks: {
    identityVerified: boolean;
    statusVerified: boolean;
    localeVerified: boolean;
    fingerprintVerified: boolean;
    imageCountVerified: boolean;
    contentVerified: boolean;
  };
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function uniqueTexts(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(exactText).filter(Boolean))]
    : [];
}

function lazadaProduct(remoteData: UnknownRecord) {
  const data = recordValue(remoteData.data);
  const item = recordValue(data.item);
  return Object.keys(item).length ? item : data;
}

function lazadaSkus(product: UnknownRecord) {
  const skusRoot = recordValue(product.Skus);
  const raw = product.skus ?? skusRoot.Sku;
  if (Array.isArray(raw)) return raw.map(recordValue);
  const row = recordValue(raw);
  return Object.keys(row).length ? [row] : [];
}

function lazadaImages(product: UnknownRecord) {
  const raw = product.images ?? product.Images;
  if (Array.isArray(raw)) return uniqueTexts(raw);
  const root = recordValue(raw);
  return uniqueTexts(root.Image ?? root.image);
}

function normalizedLazadaStatus(value: unknown) {
  return exactText(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_|_$/gu, "");
}

function lazadaProviderStatuses(product: UnknownRecord, skus: UnknownRecord[]) {
  const statuses = [product.Status, product.status]
    .concat(skus.flatMap((sku) => [sku.Status, sku.status]))
    .map(normalizedLazadaStatus)
    .filter(Boolean);
  const qcStatuses = [product.QcStatus, product.qcStatus, product.qc_status]
    .concat(skus.flatMap((sku) => [sku.QcStatus, sku.qcStatus, sku.qc_status]))
    .map(normalizedLazadaStatus)
    .filter(Boolean);
  return {
    statuses: [...new Set(statuses)],
    qcStatuses: [...new Set(qcStatuses)],
  };
}

function lazadaVisibility(
  statuses: string[],
  qcStatuses: string[],
): VerifiedListingRemoteState["visibility"] | undefined {
  const active = new Set(["ACTIVE", "LIVE", "ONLINE"]);
  const pending = new Set(["PENDING", "PENDING_REVIEW", "PROCESSING", "REVIEWING", "QC_PENDING", "UNDER_REVIEW"]);
  const rejected = new Set(["REJECTED", "QC_REJECTED", "FAILED", "FAILED_REVIEW"]);
  const inactive = new Set(["INACTIVE", "OFFLINE", "DEACTIVATED"]);
  const deleted = new Set(["DELETED", "REMOVED"]);
  // Preserve exposure truth first: one active SKU makes the product buyable
  // even if another SKU is inactive or under review.
  if (statuses.some((status) => active.has(status))) return "live";
  if (qcStatuses.some((status) => rejected.has(status)) || statuses.some((status) => rejected.has(status))) return "rejected";
  if (qcStatuses.some((status) => pending.has(status)) || statuses.some((status) => pending.has(status))) return "pending_review";
  if (statuses.length > 0 && statuses.every((status) => deleted.has(status))) return "withdrawn";
  if (statuses.length > 0 && statuses.every((status) => inactive.has(status) || deleted.has(status))) return "non_public";
  return undefined;
}

function lazadaSkuRows(requestProduct: UnknownRecord) {
  const skusRoot = recordValue(requestProduct.Skus);
  const raw = skusRoot.Sku;
  if (Array.isArray(raw)) return raw.map(recordValue);
  const row = recordValue(raw);
  return Object.keys(row).length ? [row] : [];
}

/**
 * Enforces Lazada's documented active/inactive SKU status at the last boundary
 * before CreateProduct. A verified safe draft with no SKU cannot be created.
 */
export function lazadaListingArgumentsForPublicationIntent(
  argumentsValue: UnknownRecord,
  intent: ListingPublicationIntent,
) {
  const normalized = structuredClone(argumentsValue);
  const request = recordValue(normalized.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  const skus = lazadaSkuRows(product);
  if (!skus.length) throw new Error("LAZADA_VERIFIED_CREATE_SKUS_REQUIRED");
  const Status = intent === "safe_test" ? "inactive" : "active";
  const skusRoot = recordValue(product.Skus);
  skusRoot.Sku = Array.isArray(recordValue(product.Skus).Sku)
    ? skus.map((sku) => ({ ...sku, Status }))
    : { ...skus[0], Status };
  product.Skus = skusRoot;
  requestRoot.Product = product;
  request.Request = requestRoot;
  normalized.request = request;
  return normalized;
}

export function lazadaListingRemoteIdFromArguments(argumentsValue: UnknownRecord) {
  const request = recordValue(argumentsValue.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  return exactText(argumentsValue.itemId || product.ItemId || product.item_id);
}

/**
 * Binds an update/deactivation XML payload to the same authoritative item id
 * that will be used for readback. Lazada's documented UpdateProduct and
 * DeactivateProduct examples both carry Product.ItemId in the payload.
 */
export function lazadaListingArgumentsForRemoteItem(
  argumentsValue: UnknownRecord,
  remoteIdValue: string,
) {
  const remoteId = remoteIdValue.trim();
  if (!remoteId) throw new Error("LAZADA_REMOTE_ITEM_ID_REQUIRED");
  const normalized = structuredClone(argumentsValue);
  const request = recordValue(normalized.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  if (!Object.keys(request).length || !Object.keys(requestRoot).length || !Object.keys(product).length) {
    throw new Error("CHANNEL_ARGUMENT_REQUIRED:request.Request.Product");
  }
  const suppliedItemId = exactText(product.ItemId || product.item_id);
  if (suppliedItemId && suppliedItemId !== remoteId) {
    throw new Error("LAZADA_REMOTE_ITEM_ID_MISMATCH");
  }
  product.ItemId = remoteId;
  delete product.item_id;
  requestRoot.Product = product;
  request.Request = requestRoot;
  normalized.request = request;
  normalized.itemId = remoteId;
  return normalized;
}

/**
 * Converts one authoritative `GetProductItem` response into exact publication
 * evidence. This pure boundary is reusable by read-only pending-review polling.
 */
export function normalizeLazadaListingPublicationReadback(input: {
  operation: ListingMutationOperation;
  remoteId: string;
  remoteData: UnknownRecord;
  mutationArguments: UnknownRecord;
  market: string;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
  verifiedAt?: string;
}): LazadaPublicationReadbackVerification {
  const remoteId = input.remoteId.trim();
  const product = lazadaProduct(input.remoteData);
  const productId = exactText(product.item_id || product.ItemId || product.itemId);
  const skus = lazadaSkus(product);
  const { statuses, qcStatuses } = lazadaProviderStatuses(product, skus);
  const visibility = lazadaVisibility(statuses, qcStatuses);
  const providerStatus = [...statuses, ...qcStatuses.map((status) => `QC:${status}`)].join("|").slice(0, 160);
  const images = lazadaImages(product);
  const imageCount = images.length;
  const identityVerified = Boolean(remoteId && productId === remoteId);
  const statusVerified = Boolean(visibility && providerStatus);
  const market = input.market.trim().toUpperCase();
  const localeVerified = Boolean(
    market
    && listingExpectedPublicationLocale("lazada", market) === input.expectedLocale,
  );
  const imageCountVerified = input.operation === "listing.stop"
    ? input.expectedImageCount === 0
    : input.expectedImageCount === 8 && imageCount === input.expectedImageCount;
  const contentVerification = input.operation === "listing.stop"
    ? { ok: true, mismatches: [] as string[] }
    : verifyListingUpdateReadback("lazada", input.mutationArguments, input.remoteData);
  const contentVerified = contentVerification.ok;
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
    && identityVerified
    && statusVerified
    && localeVerified
    && imageCountVerified
    && contentVerified;
  const checks = {
    identityVerified,
    statusVerified,
    localeVerified,
    fingerprintVerified,
    imageCountVerified,
    contentVerified,
  };
  if (!visibility || !Object.values(checks).every(Boolean)) {
    return { providerStatus, imageCount, checks };
  }

  const skuIds = uniqueTexts(skus.map((sku) => sku.SkuId ?? sku.SkuID ?? sku.sku_id));
  const sellerSkus = uniqueTexts(skus.map((sku) => sku.SellerSku ?? sku.seller_sku));
  const urls = uniqueTexts(skus.map((sku) => sku.Url ?? sku.url));
  return {
    providerStatus,
    imageCount,
    checks,
    remoteState: {
      verified: true,
      visibility,
      providerStatus,
      verifiedAt: input.verifiedAt ?? new Date().toISOString(),
      evidence: {
        version: "lazada_get_product_item_v1",
        ...checks,
        mutableContentMismatchPaths: contentVerification.mismatches.slice(0, 40),
      },
      resources: {
        itemId: remoteId,
        country: market.toLowerCase(),
        ...(skuIds.length ? { skuIds } : {}),
        ...(sellerSkus.length ? { sellerSkus } : {}),
        ...(urls.length ? { urls } : {}),
      },
      locale: input.expectedLocale,
      fingerprint: input.expectedFingerprint,
      imageCount,
    },
  };
}

/** Performs only Lazada's authoritative GetProductItem and normalizes it. */
export async function readLazadaListingPublicationState(input: {
  payload: SecretPayload;
  operation: ListingMutationOperation;
  remoteId: string;
  mutationArguments: UnknownRecord;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
}): Promise<LazadaPublicationReadbackVerification & { remote: RemoteResponse }> {
  const remote = await lazadaRequest({
    payload: input.payload,
    path: "/product/item/get",
    params: { item_id: input.remoteId },
  });
  return {
    remote,
    ...normalizeLazadaListingPublicationReadback({
      operation: input.operation,
      remoteId: input.remoteId,
      remoteData: remote.data,
      mutationArguments: input.mutationArguments,
      market: textValue(input.payload, "country") || exactText(input.mutationArguments.country),
      expectedLocale: input.expectedLocale,
      expectedFingerprint: input.expectedFingerprint,
      expectedImageCount: input.expectedImageCount,
    }),
  };
}
