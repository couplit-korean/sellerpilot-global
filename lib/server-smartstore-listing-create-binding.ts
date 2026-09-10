import {
  buildSmartstoreCreateTransport,
  smartstoreCreateBodyBindingSha256,
  smartstoreCreateTransportArgument,
} from "./channels/smartstore-create-transport";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
const credentialFingerprintPattern = /^[a-f0-9]{12}$/iu;

export const smartstoreCreateSourceBindingArgument =
  "sellerpilotSmartstoreCreateSource" as const;
export const smartstoreCreateSourceBindingContract =
  "smartstore_listing_create_source_v1" as const;

export type SmartstoreCreateSourceSnapshot = {
  contract: "smartstore_listing_create_source_snapshot_v1";
  productId: string;
  ownerId: string;
  productUpdatedAt: string;
  detailPageVersion: number;
  approvedDetailPageVersion: number;
  approvedManifestDigest: string;
  sellerManagementCode: string;
  credentialId: string;
  credentialVersion: number;
  credentialFingerprint: string;
  credentialVaultSecretId: string;
  credentialLastRotatedAt: string;
  productName: string;
  salePrice: number;
  stockQuantity: number;
  manualFieldsSha256: string;
};

function sourceSnapshot(value: unknown): SmartstoreCreateSourceSnapshot | null {
  const row = record(value);
  const productId = text(row?.productId).toLowerCase();
  const ownerId = text(row?.ownerId).toLowerCase();
  const productUpdatedAt = text(row?.productUpdatedAt);
  const approvedManifestDigest = text(row?.approvedManifestDigest).toLowerCase();
  const sellerManagementCode = text(row?.sellerManagementCode);
  const credentialId = text(row?.credentialId).toLowerCase();
  const credentialFingerprint = text(row?.credentialFingerprint);
  const credentialVaultSecretId = text(row?.credentialVaultSecretId).toLowerCase();
  const credentialLastRotatedAt = text(row?.credentialLastRotatedAt);
  const productName = text(row?.productName);
  const salePrice = Number(row?.salePrice);
  const stockQuantity = Number(row?.stockQuantity);
  const manualFieldsSha256 = text(row?.manualFieldsSha256).toLowerCase();
  const detailPageVersion = Number(row?.detailPageVersion);
  const approvedDetailPageVersion = Number(row?.approvedDetailPageVersion);
  const credentialVersion = Number(row?.credentialVersion);
  if (row?.contract !== "smartstore_listing_create_source_snapshot_v1"
      || !uuidPattern.test(productId)
      || !uuidPattern.test(ownerId)
      || !uuidPattern.test(credentialId)
      || !uuidPattern.test(credentialVaultSecretId)
      || !Number.isSafeInteger(Date.parse(productUpdatedAt))
      || !Number.isSafeInteger(Date.parse(credentialLastRotatedAt))
      || !Number.isSafeInteger(detailPageVersion)
      || detailPageVersion < 1
      || approvedDetailPageVersion !== detailPageVersion
      || !digestPattern.test(approvedManifestDigest)
      || !sellerManagementCode
      || sellerManagementCode.length > 100
      || !productName
      || productName.length > 100
      || !Number.isSafeInteger(salePrice)
      || salePrice < 10
      || salePrice > 999_999_990
      || salePrice % 10 !== 0
      || !Number.isSafeInteger(stockQuantity)
      || stockQuantity < 0
      || stockQuantity > 99_999_999
      || !digestPattern.test(manualFieldsSha256)
      || !Number.isSafeInteger(credentialVersion)
      || credentialVersion < 1
      || !credentialFingerprintPattern.test(credentialFingerprint)) {
    return null;
  }
  return {
    contract: "smartstore_listing_create_source_snapshot_v1",
    productId,
    ownerId,
    // Preserve PostgreSQL's exact textual timestamp. Date#toISOString would
    // truncate microseconds to milliseconds and make an unchanged source fail
    // the SQL timestamptz equality check at the final provider boundary.
    productUpdatedAt,
    detailPageVersion,
    approvedDetailPageVersion,
    approvedManifestDigest,
    sellerManagementCode,
    credentialId,
    credentialVersion,
    credentialFingerprint,
    credentialVaultSecretId,
    credentialLastRotatedAt,
    productName,
    salePrice,
    stockQuantity,
    manualFieldsSha256,
  };
}

/**
 * Bind a SmartStore CREATE to the selected SellerPilot product before claim.
 * The provider duplicate preflight searches by this exact seller code, so a
 * stale or forged browser draft must not substitute another code and bypass
 * the existing-product fence.
 */
export function bindSmartstoreListingCreateSourceIdentity(input: {
  argumentsValue: Record<string, unknown>;
  publishContext: Record<string, unknown> | null;
  sourceSnapshot: unknown;
  approvedDetail: { version: number; manifest: { digest: string } };
  productId: string;
  credentialId: string;
  market: string;
  targetId: string;
}) {
  const product = record(input.publishContext?.product);
  const manualFields = record(input.publishContext?.manualFields);
  const snapshot = sourceSnapshot(input.sourceSnapshot);
  if (!snapshot) {
    throw new Error("SMARTSTORE_CREATE_SOURCE_SNAPSHOT_INVALID");
  }
  if (!product
      || text(product.id).toLowerCase() !== input.productId.toLowerCase()
      || text(input.publishContext?.ownerId).toLowerCase() !== snapshot.ownerId
      || snapshot.productId !== input.productId.toLowerCase()
      || snapshot.credentialId !== input.credentialId.toLowerCase()
      || text(product.status) !== "ready") {
    throw new Error("SMARTSTORE_CREATE_PRODUCT_NOT_READY");
  }

  const canonicalSellerCode = text(manualFields?.sellerSku) || text(product.sku);
  if (!canonicalSellerCode
      || canonicalSellerCode.length > 100
      || snapshot.sellerManagementCode !== canonicalSellerCode) {
    throw new Error("SMARTSTORE_CREATE_SELLER_CODE_INVALID");
  }
  if (snapshot.detailPageVersion !== input.approvedDetail.version
      || snapshot.approvedDetailPageVersion !== input.approvedDetail.version
      || snapshot.approvedManifestDigest !== input.approvedDetail.manifest.digest) {
    throw new Error("SMARTSTORE_CREATE_SOURCE_REVISION_MISMATCH");
  }

  const body = record(input.argumentsValue.body);
  const originProduct = record(body?.originProduct);
  const detailAttribute = record(originProduct?.detailAttribute);
  const sellerCodeInfo = record(detailAttribute?.sellerCodeInfo);
  const channelProduct = record(body?.smartstoreChannelProduct);
  const canonicalProductName = text(manualFields?.productName) || text(product.name);
  const canonicalSalePrice = Number(manualFields?.sellingPrice);
  const canonicalStockQuantity = Number(manualFields?.stock);
  const productStock = Number(product.onHand);
  if (!canonicalProductName
      || snapshot.productName !== canonicalProductName
      || text(originProduct?.name) !== canonicalProductName
      || text(channelProduct?.channelProductName) !== canonicalProductName
      || !Number.isSafeInteger(canonicalSalePrice)
      || snapshot.salePrice !== canonicalSalePrice
      || Number(originProduct?.salePrice) !== canonicalSalePrice
      || !Number.isSafeInteger(canonicalStockQuantity)
      || snapshot.stockQuantity !== canonicalStockQuantity
      || Number(originProduct?.stockQuantity) !== canonicalStockQuantity
      || (Number.isSafeInteger(productStock)
        && productStock !== canonicalStockQuantity)) {
    throw new Error("SMARTSTORE_CREATE_COMMERCIAL_SOURCE_MISMATCH");
  }
  if (text(sellerCodeInfo?.sellerManagementCode) !== canonicalSellerCode) {
    throw new Error("SMARTSTORE_CREATE_SELLER_CODE_MISMATCH");
  }

  const existing = Array.isArray(input.publishContext?.listings)
    ? input.publishContext.listings.some((value) => {
      const listing = record(value);
      if (!listing || listing.channel !== "smartstore") return false;
      const market = text(listing.market) || "KR";
      const targetId = text(listing.targetId);
      return market === input.market
        && targetId === input.targetId
        && (Boolean(text(listing.remoteId))
          || Boolean(text(listing.publishedAt))
          || ["published", "paused"].includes(text(listing.status)));
    })
    : false;
  if (existing) {
    throw new Error("SMARTSTORE_CREATE_EXISTING_LISTING_REQUIRES_UPDATE");
  }

  const argumentsValue = structuredClone(input.argumentsValue);
  const boundBody = record(argumentsValue.body)!;
  const boundOriginProduct = record(boundBody.originProduct)!;
  const boundDetailAttribute = record(boundOriginProduct.detailAttribute)!;
  const boundSellerCodeInfo = record(boundDetailAttribute.sellerCodeInfo)!;
  boundSellerCodeInfo.sellerManagementCode = canonicalSellerCode;
  boundDetailAttribute.sellerCodeInfo = boundSellerCodeInfo;
  boundOriginProduct.detailAttribute = boundDetailAttribute;
  boundBody.originProduct = boundOriginProduct;
  argumentsValue.body = boundBody;
  argumentsValue[smartstoreCreateSourceBindingArgument] = {
    contract: smartstoreCreateSourceBindingContract,
    productId: snapshot.productId,
    ownerId: snapshot.ownerId,
    productUpdatedAt: snapshot.productUpdatedAt,
    detailPageVersion: snapshot.detailPageVersion,
    approvedDetailPageVersion: snapshot.approvedDetailPageVersion,
    approvedManifestDigest: snapshot.approvedManifestDigest,
    sellerManagementCode: snapshot.sellerManagementCode,
    credentialId: snapshot.credentialId,
    credentialVersion: snapshot.credentialVersion,
    credentialFingerprint: snapshot.credentialFingerprint,
    credentialVaultSecretId: snapshot.credentialVaultSecretId,
    credentialLastRotatedAt: snapshot.credentialLastRotatedAt,
    productName: snapshot.productName,
    salePrice: snapshot.salePrice,
    stockQuantity: snapshot.stockQuantity,
    manualFieldsSha256: snapshot.manualFieldsSha256,
    bodyBindingSha256: smartstoreCreateBodyBindingSha256(boundBody),
  };
  assertSmartstoreCreateSourceMatchesBody({
    source: argumentsValue[smartstoreCreateSourceBindingArgument],
    body: boundBody,
  });
  return argumentsValue;
}

/**
 * Re-check the CREATE body against the durable source binding. One unchanged
 * snapshot may authorize only one title, sale price, and stock quantity.
 */
export function assertSmartstoreCreateSourceMatchesBody(input: {
  source: unknown;
  body: unknown;
}) {
  const source = record(input.source);
  const body = record(input.body);
  const origin = record(body?.originProduct);
  const channel = record(body?.smartstoreChannelProduct);
  const productName = text(source?.productName);
  const salePrice = Number(source?.salePrice);
  const stockQuantity = Number(source?.stockQuantity);
  const bindingSha = text(source?.bodyBindingSha256).toLowerCase();
  if (source?.contract !== smartstoreCreateSourceBindingContract
      || !productName
      || productName.length > 100
      || text(origin?.name) !== productName
      || text(channel?.channelProductName) !== productName
      || !Number.isSafeInteger(salePrice)
      || salePrice < 10
      || salePrice > 999_999_990
      || salePrice % 10 !== 0
      || Number(origin?.salePrice) !== salePrice
      || !Number.isSafeInteger(stockQuantity)
      || stockQuantity < 0
      || stockQuantity > 99_999_999
      || Number(origin?.stockQuantity) !== stockQuantity
      || !digestPattern.test(bindingSha)
      || bindingSha !== smartstoreCreateBodyBindingSha256(body)) {
    throw new Error("SMARTSTORE_CREATE_COMMERCIAL_SOURCE_MISMATCH");
  }
}

/**
 * Freeze the exact CREATE JSON after media bind and refuse a second title,
 * sale price, or stock quantity from the same source snapshot.
 */
export function attachSmartstoreListingCreateExecuteTransport(
  argumentsValue: Record<string, unknown>,
) {
  const body = record(argumentsValue.body);
  if (!body) {
    throw new Error("SMARTSTORE_CREATE_TRANSPORT_BODY_INVALID");
  }
  const next = structuredClone(argumentsValue);
  const boundBody = record(next.body)!;
  next[smartstoreCreateTransportArgument] = buildSmartstoreCreateTransport(boundBody);
  assertSmartstoreCreateSourceMatchesBody({
    source: next[smartstoreCreateSourceBindingArgument],
    body: boundBody,
  });
  return next;
}
