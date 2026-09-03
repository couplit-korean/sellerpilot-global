import { createHash } from "node:crypto";

import {
  listingExpectedPublicationLocale,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import { verifyListingUpdateReadback } from "./listing-update";
import {
  lazadaPrimaryCategory,
  lazadaUpdateCommerceReadbackVerified,
} from "./lazada-listing-update";
import {
  lazadaExactExistingSellerSku,
  lazadaExactExistingUpdateRequest,
} from "./lazada-exact-existing-identity";
import { listingPublicationLanguageVerified } from "./listing-publication-content";
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
    categoryVerified: boolean;
    commerceVerified: boolean;
    contentVerified: boolean;
  };
};

type LazadaContentVerificationMode = "mutation_arguments" | "immutable_source_readback";

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

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value: string) {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
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

function sameOrderedTexts(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function lazadaImmutableRemoteAssetsVerified(
  sourceRemoteData: UnknownRecord,
  currentRemoteData: UnknownRecord,
) {
  const sourceProduct = lazadaProduct(sourceRemoteData);
  const currentProduct = lazadaProduct(currentRemoteData);
  const sourceGallery = lazadaImages(sourceProduct);
  const currentGallery = lazadaImages(currentProduct);
  if (sourceGallery.length !== 8 || !sameOrderedTexts(sourceGallery, currentGallery)) return false;

  const sourceSkus = lazadaSkus(sourceProduct);
  const currentSkus = lazadaSkus(currentProduct);
  if (!sourceSkus.length || sourceSkus.length !== currentSkus.length) return false;
  const sourceSellerSkus = sourceSkus.map((sku) => exactText(sku.SellerSku ?? sku.seller_sku));
  if (sourceSellerSkus.some((sellerSku) => !sellerSku)
    || new Set(sourceSellerSkus).size !== sourceSkus.length) return false;
  const currentBySellerSku = new Map(currentSkus.map((sku) => [
    exactText(sku.SellerSku ?? sku.seller_sku),
    sku,
  ]));
  if (currentBySellerSku.size !== currentSkus.length || currentBySellerSku.has("")) return false;
  return sourceSkus.every((sourceSku) => {
    const sellerSku = exactText(sourceSku.SellerSku ?? sourceSku.seller_sku);
    const currentSku = currentBySellerSku.get(sellerSku);
    return Boolean(sellerSku && currentSku
      && sameOrderedTexts(lazadaImages(sourceSku), lazadaImages(currentSku)));
  });
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

function lazadaExplicitSkuStatuses(skus: UnknownRecord[]) {
  return skus.map((sku) => normalizedLazadaStatus(sku.Status ?? sku.status));
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
  // QC is the authoritative publication gate. An active SKU cannot be
  // attested as live while the provider still reports review or rejection.
  if (qcStatuses.some((status) => rejected.has(status)) || statuses.some((status) => rejected.has(status))) return "rejected";
  if (qcStatuses.some((status) => pending.has(status)) || statuses.some((status) => pending.has(status))) return "pending_review";
  if (statuses.length > 0 && statuses.every((status) => active.has(status))) return "live";
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
  contentVerificationMode?: LazadaContentVerificationMode;
  immutableSourceRemoteData?: UnknownRecord;
  verifiedAt?: string;
}): LazadaPublicationReadbackVerification {
  const remoteId = input.remoteId.trim();
  const product = lazadaProduct(input.remoteData);
  const productId = exactText(product.item_id || product.ItemId || product.itemId);
  const skus = lazadaSkus(product);
  const request = recordValue(input.mutationArguments.request);
  const requestRoot = recordValue(request.Request);
  const requestProduct = recordValue(requestRoot.Product);
  const expectedSellerSkus = uniqueTexts([
    ...lazadaSkuRows(requestProduct).map((sku) => sku.SellerSku ?? sku.seller_sku),
    ...(Array.isArray(input.mutationArguments.sellerpilotExpectedSellerSkus)
      ? input.mutationArguments.sellerpilotExpectedSellerSkus
      : []),
  ]);
  const remoteSellerSkus = uniqueTexts(skus.map((sku) => sku.SellerSku ?? sku.seller_sku));
  const remoteSkuIds = uniqueTexts(skus.map((sku) => sku.SkuId ?? sku.SkuID ?? sku.sku_id));
  const exactSkuIdentity = input.operation === "listing.stop"
    ? true
    : expectedSellerSkus.length > 0
      && expectedSellerSkus.length === remoteSellerSkus.length
      && expectedSellerSkus.every((sellerSku) => remoteSellerSkus.includes(sellerSku))
      && remoteSkuIds.length === skus.length;
  const { statuses, qcStatuses } = lazadaProviderStatuses(product, skus);
  const skuStatuses = lazadaExplicitSkuStatuses(skus);
  const provisionalVisibility = lazadaVisibility(statuses, qcStatuses);
  const completeSkuStatuses = skus.length > 0
    && skuStatuses.length === skus.length
    && skuStatuses.every(Boolean);
  const visibility = provisionalVisibility === "live"
    ? completeSkuStatuses && skuStatuses.every((status) => ["ACTIVE", "LIVE", "ONLINE"].includes(status))
      ? "live"
      : undefined
    : provisionalVisibility === "non_public"
      ? completeSkuStatuses && skuStatuses.every((status) => ["INACTIVE", "OFFLINE", "DEACTIVATED", "DELETED", "REMOVED"].includes(status))
        ? "non_public"
        : undefined
      : provisionalVisibility === "withdrawn"
        ? completeSkuStatuses && skuStatuses.every((status) => ["DELETED", "REMOVED"].includes(status))
          ? "withdrawn"
          : undefined
        : provisionalVisibility;
  const providerStatus = [...statuses, ...qcStatuses.map((status) => `QC:${status}`)].join("|").slice(0, 160);
  const images = lazadaImages(product);
  const imageCount = images.length;
  const expectedCategory = lazadaPrimaryCategory(requestProduct);
  const remoteCategory = lazadaPrimaryCategory(product);
  const categoryVerified = input.operation === "listing.stop"
    ? true
    : Boolean(expectedCategory && expectedCategory === remoteCategory);
  const commerceVerified = input.operation === "listing.stop"
    ? true
    : lazadaUpdateCommerceReadbackVerified(input.mutationArguments, input.remoteData);
  const identityVerified = Boolean(remoteId && productId === remoteId && exactSkuIdentity);
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
    : input.contentVerificationMode === "immutable_source_readback"
      ? lazadaImmutableRemoteAssetsVerified(
          recordValue(input.immutableSourceRemoteData),
          input.remoteData,
        )
        ? { ok: true, mismatches: [] as string[] }
        : { ok: false, mismatches: ["immutableRemoteAssets"] }
    : verifyListingUpdateReadback("lazada", input.mutationArguments, input.remoteData);
  const contentVerified = contentVerification.ok;
  const exactBinding = input.operation === "listing.update"
    ? lazadaExactExistingUpdateRequest(input.mutationArguments)
    : null;
  const exactPreflight = recordValue(input.mutationArguments.sellerpilotLazadaUpdatePreflight);
  const remoteSku = skus.length === 1 ? skus[0] : {};
  const remoteSkuId = exactText(remoteSku.SkuId ?? remoteSku.SkuID ?? remoteSku.sku_id);
  const remoteSellerSku = exactText(remoteSku.SellerSku ?? remoteSku.seller_sku);
  const remotePrice = Number(remoteSku.price ?? remoteSku.Price);
  const remoteStock = Number(remoteSku.quantity ?? remoteSku.Quantity);
  const attributes = recordValue(product.Attributes ?? product.attributes);
  const title = exactText(attributes.name ?? attributes.Name ?? product.name);
  const description = exactText(
    attributes.description ?? attributes.Description ?? product.description,
  );
  const providerRepresentative = exactText(
    input.mutationArguments.sellerpilotProviderRepresentativeImageUrl,
  );
  const providerDetails = uniqueTexts(
    input.mutationArguments.sellerpilotProviderDetailImageUrls,
  );
  const exactStatusesVerified = statuses.length > 0
    && statuses.every((status) => ["ACTIVE", "LIVE", "ONLINE"].includes(status))
    && skuStatuses.length === 1
    && ["ACTIVE", "LIVE", "ONLINE"].includes(skuStatuses[0] ?? "");
  const exactReadbackVerified = !exactBinding || Boolean(
    exactBinding.itemId === remoteId
    && remoteSellerSku === lazadaExactExistingSellerSku
    && /^\d+$/u.test(remoteSkuId)
    && remoteSkuId === exactText(exactPreflight.skuId)
    && exactText(exactPreflight.itemId) === remoteId
    && exactText(exactPreflight.sellerSku) === lazadaExactExistingSellerSku
    && exactText(exactPreflight.country) === "my"
    && exactText(exactPreflight.providerStatus)
    && exactStatusesVerified
    && Number.isFinite(remotePrice)
    && Number(remotePrice.toFixed(2)) === Number(Number(exactPreflight.price).toFixed(2))
    && remoteStock === 1
    && providerRepresentative
    && providerDetails.length === 8
    && new Set([providerRepresentative, ...providerDetails]).size === 9
    && images.length === 8
    && images[0] === providerRepresentative
    && providerDetails.every((url) => description.includes(url))
    && listingPublicationLanguageVerified("ms-MY", title, "title")
    && listingPublicationLanguageVerified("ms-MY", description, "description")
  );
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
    && identityVerified
    && statusVerified
    && localeVerified
    && imageCountVerified
    && categoryVerified
    && commerceVerified
    && contentVerified
    && exactReadbackVerified;
  const checks = {
    identityVerified,
    statusVerified,
    localeVerified,
    fingerprintVerified,
    imageCountVerified,
    categoryVerified,
    commerceVerified,
    contentVerified,
  };
  if (!visibility || !Object.values(checks).every(Boolean)) {
    return { providerStatus, imageCount, checks };
  }

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
        version: exactBinding
          ? "lazada_exact_my_update_readback_v1"
          : "lazada_get_product_item_v1",
        contentVerificationMode: input.contentVerificationMode ?? "mutation_arguments",
        ...checks,
        ...(exactBinding ? {
          sellerSkuVerified: true,
          skuIdVerified: true,
          preflightSkuId: exactText(exactPreflight.skuId),
          priceVerified: true,
          stockVerified: true,
          activeStatusVerified: true,
          titleLanguageVerified: true,
          descriptionLanguageVerified: true,
          representativeImageVerified: true,
          detailImagesVerified: true,
          categoryAttributesVerified: true,
          observedRepresentativeImageCount: 1,
          observedDetailImageCount: 8,
          representativeImageDigest: sha256([providerRepresentative]),
          orderedDetailImageDigest: sha256(providerDetails),
          titleDigest: sha256Text(title),
          descriptionDigest: sha256Text(description),
        } : {}),
        mutableContentMismatchPaths: contentVerification.mismatches.slice(0, 40),
      },
      resources: {
        itemId: remoteId,
        country: market.toLowerCase(),
        ...(exactBinding ? {
          skuId: remoteSkuId,
          sellerSku: remoteSellerSku,
          currency: "MYR",
          price: Number(remotePrice.toFixed(2)),
          stock: remoteStock,
          representativeImageUrl: providerRepresentative,
          detailImageUrls: providerDetails,
        } : {}),
        ...(remoteCategory ? { categoryId: remoteCategory } : {}),
        ...(remoteSkuIds.length ? { skuIds: remoteSkuIds } : {}),
        ...(remoteSellerSkus.length ? { sellerSkus: remoteSellerSkus } : {}),
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
  contentVerificationMode?: LazadaContentVerificationMode;
  immutableSourceRemoteData?: UnknownRecord;
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
      contentVerificationMode: input.contentVerificationMode,
      immutableSourceRemoteData: input.immutableSourceRemoteData,
    }),
  };
}
