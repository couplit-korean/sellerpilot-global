import { createHash } from "node:crypto";
import {
  verifiedListingRemoteStateSchema,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";

type UnknownRecord = Record<string, unknown>;

export type TemuPublicationReadbackOperation =
  | "listing.create"
  | "listing.stop"
  | "listing.publication.verify";

export type TemuPublicationReadbackVerification = {
  remoteState?: VerifiedListingRemoteState;
  providerStatus: string;
  visibility?: VerifiedListingRemoteState["visibility"];
  representativeImages: string[];
  detailImages: string[];
  checks: {
    identityVerified: boolean;
    statusVerified: boolean;
    localeVerified: boolean;
    fingerprintVerified: boolean;
    representativeImageVerified: boolean;
    imageCountVerified: boolean;
    imageOrderVerified: boolean;
    contentVerified: boolean;
    skuIdentityVerified: boolean;
    priceVerified: boolean;
    stockVerified: boolean;
    goodsIdVerified: boolean;
    externalGoodsIdVerified: boolean;
  };
};

export type TemuPublicationExpectedSku = {
  externalSkuId: string;
  quantity: number;
  basePrice: {
    amount: string;
    currency: string;
  };
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export type TemuImmutableListingIdentity = {
  goodsId: string;
  externalGoodsId: string;
};

export const temuCreateCorrelationContract = "temu_create_attempt_external_id_v1" as const;
export const temuActivationContract = "temu_verified_non_public_activation_v1" as const;
export const temuContainmentDiscoveryContract = "temu_safe_test_containment_discovery_v1" as const;
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function bindTemuCreateAttemptIdentity(input: {
  argumentsValue: Record<string, unknown>;
  productId: string;
  canonicalSellerSku: string;
  market: string;
  targetId: string;
  idempotencyKey: string;
}) {
  const sanitizedArguments = structuredClone(input.argumentsValue);
  delete sanitizedArguments.sellerpilotTemuActivation;
  delete sanitizedArguments.sellerpilotTemuContainment;
  const sourceSku = input.canonicalSellerSku.trim().slice(0, 128);
  const body = recordValue(sanitizedArguments.body);
  const goodsBasic = recordValue(body.goodsBasic);
  const skuList = Array.isArray(body.skuList)
    ? body.skuList.map(recordValue).filter((item) => Object.keys(item).length > 0)
    : [];
  if (!sourceSku
      || exactText(goodsBasic.externalGoodsId) !== sourceSku
      || skuList.length === 0
      || skuList.some((sku) => exactText(sku.externalSkuId) !== sourceSku)) {
    throw new Error("TEMU_CREATE_SOURCE_IDENTITY_MISMATCH");
  }
  const scopeFingerprint = createHash("sha256").update(JSON.stringify({
    contract: temuCreateCorrelationContract,
    productId: input.productId,
    sourceSku,
    market: input.market.trim().toUpperCase(),
    targetId: input.targetId.trim(),
    idempotencyKey: input.idempotencyKey,
  }), "utf8").digest("hex");
  const productPrefix = input.productId.replace(/[^a-f0-9]/giu, "").slice(0, 12).toUpperCase();
  if (productPrefix.length !== 12) throw new Error("TEMU_CREATE_SOURCE_IDENTITY_MISMATCH");
  const externalGoodsId = `SP-${productPrefix}-${scopeFingerprint.slice(0, 32).toUpperCase()}`;
  return {
    ...sanitizedArguments,
    body: {
      ...structuredClone(body),
      goodsBasic: {
        ...structuredClone(goodsBasic),
        externalGoodsId,
      },
      skuList: skuList.map((sku, index) => ({
        ...structuredClone(sku),
        externalSkuId: `${externalGoodsId}-${String(index + 1).padStart(2, "0")}`,
      })),
    },
    sellerpilotTemuCreateCorrelation: {
      version: temuCreateCorrelationContract,
      sourceSellerSku: sourceSku,
      externalGoodsId,
      scopeFingerprint,
      skuCount: skuList.length,
    },
  };
}

export function temuCreateCorrelationMatches(
  argumentsValue: Record<string, unknown>,
  externalGoodsId: string,
) {
  const correlation = recordValue(argumentsValue.sellerpilotTemuCreateCorrelation);
  return correlation.version === temuCreateCorrelationContract
    && Boolean(exactText(correlation.sourceSellerSku))
    && exactText(correlation.sourceSellerSku).length <= 128
    && !/\p{Cc}/u.test(exactText(correlation.sourceSellerSku))
    && exactText(correlation.externalGoodsId) === externalGoodsId
    && /^[a-f0-9]{64}$/u.test(exactText(correlation.scopeFingerprint))
    && Number.isSafeInteger(Number(correlation.skuCount))
    && Number(correlation.skuCount) > 0;
}

export function temuActivationBinding(argumentsValue: Record<string, unknown>) {
  const marker = recordValue(argumentsValue.sellerpilotTemuActivation);
  const body = recordValue(argumentsValue.body);
  const goodsBasic = recordValue(body.goodsBasic);
  const goodsId = exactText(argumentsValue.goodsId);
  const externalGoodsId = exactText(argumentsValue.externalGoodsId);
  const exactGoodsId = temuExactLongGoodsId(argumentsValue.goodsId);
  const sourceJobId = exactText(marker.sourceJobId);
  const listingId = exactText(marker.listingId);
  const activationFingerprint = exactText(marker.activationFingerprint);
  if (marker.version !== temuActivationContract
      || exactGoodsId === null
      || exactGoodsId !== goodsId
      || !externalGoodsId
      || exactText(goodsBasic.externalGoodsId) !== externalGoodsId
      || !canonicalUuidPattern.test(sourceJobId)
      || !canonicalUuidPattern.test(listingId)
      || !/^[a-f0-9]{64}$/u.test(activationFingerprint)
      || exactText(marker.goodsId) !== goodsId
      || exactText(marker.externalGoodsId) !== externalGoodsId) {
    return null;
  }
  return {
    goodsId,
    exactGoodsId,
    externalGoodsId,
    sourceJobId,
    listingId,
    activationFingerprint,
  };
}

export function temuContainmentDiscoveryBinding(argumentsValue: Record<string, unknown>) {
  const marker = recordValue(argumentsValue.sellerpilotTemuContainmentDiscovery);
  const sourceJobId = exactText(marker.sourceJobId);
  const sourceAttemptId = exactText(marker.sourceAttemptId);
  const listingId = exactText(marker.listingId);
  const credentialId = exactText(marker.credentialId);
  const externalGoodsId = exactText(marker.externalGoodsId);
  const discoveryFingerprint = exactText(marker.discoveryFingerprint);
  if (marker.version !== temuContainmentDiscoveryContract
      || !canonicalUuidPattern.test(sourceJobId)
      || !canonicalUuidPattern.test(sourceAttemptId)
      || !canonicalUuidPattern.test(listingId)
      || !canonicalUuidPattern.test(credentialId)
      || !externalGoodsId
      || externalGoodsId.length > 128
      || /\p{Cc}/u.test(externalGoodsId)
      || !/^[a-f0-9]{64}$/u.test(discoveryFingerprint)) {
    return null;
  }
  return {
    sourceJobId,
    sourceAttemptId,
    listingId,
    credentialId,
    externalGoodsId,
    discoveryFingerprint,
  };
}

export function temuExactGoodsListArguments(externalGoodsId: string) {
  const exactExternalGoodsId = externalGoodsId.trim();
  if (!exactExternalGoodsId || exactExternalGoodsId.length > 128 || /\p{Cc}/u.test(exactExternalGoodsId)) {
    throw new Error("TEMU_EXTERNAL_GOODS_ID_INVALID");
  }
  return {
    outGoodsSnList: [exactExternalGoodsId],
    pageSize: 25,
    goodsSearchType: "ALL",
  };
}

export function temuSafeNumericGoodsId(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return null;
  const text = exactText(value);
  if (!/^[1-9]\d*$/u.test(text)) return null;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) && numeric > 0 && String(numeric) === text
    ? numeric
    : null;
}

export function temuExactLongGoodsId(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = exactText(value);
  if (!/^[1-9]\d{0,18}$/u.test(text)) return null;
  try {
    return BigInt(text) <= BigInt("9223372036854775807") ? text : null;
  } catch {
    return null;
  }
}

/**
 * Reads the immutable Temu identity from the canonical publish-context ledger
 * shape. The public context exposes `product_listings.remote_resources` as the
 * `remoteResources` wrapper, while provider IDs live under its `resources`
 * member. Flattened/browser-supplied lookalikes intentionally fail closed.
 */
export function temuImmutableListingIdentityFromPublishContext(
  listing: unknown,
  requestedRemoteId: string,
): TemuImmutableListingIdentity | null {
  const exactListing = recordValue(listing);
  const remoteResources = recordValue(exactListing.remoteResources);
  const providerResources = recordValue(remoteResources.resources);
  const rawGoodsId = providerResources.goodsId;
  const goodsId = exactText(rawGoodsId);
  const externalGoodsId = exactText(providerResources.externalGoodsId);
  const exactGoodsId = temuExactLongGoodsId(rawGoodsId);
  if (goodsId !== requestedRemoteId.trim()
      || exactGoodsId === null
      || exactGoodsId !== goodsId
      || !externalGoodsId
      || externalGoodsId.length > 128
      || /\p{Cc}/u.test(externalGoodsId)) {
    return null;
  }
  return { goodsId, externalGoodsId };
}

function firstText(record: UnknownRecord, names: readonly string[]) {
  for (const name of names) {
    const direct = exactText(record[name]);
    if (direct) return direct;
    const entry = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
    const value = entry ? exactText(entry[1]) : "";
    if (value) return value;
  }
  return "";
}

function resultRecord(value: UnknownRecord) {
  const result = recordValue(value.result);
  if (Object.keys(result).length) return result;
  const data = recordValue(value.data);
  return Object.keys(data).length ? data : value;
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.map(recordValue).filter((row) => Object.keys(row).length) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(exactText).filter(Boolean) : [];
}

function exactStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function canonicalMoneyAmount(value: unknown) {
  const text = exactText(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text)) return "";
  const [integer, fraction = ""] = text.split(".");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  const normalizedInteger = BigInt(integer).toString();
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function exactNonNegativeInteger(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return null;
  const text = exactText(value);
  if (!/^(?:0|[1-9]\d*)$/u.test(text)) return null;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) && numeric >= 0 && String(numeric) === text
    ? numeric
    : null;
}

function canonicalMoney(value: unknown) {
  const money = recordValue(value);
  const amount = canonicalMoneyAmount(money.amount);
  const currency = exactText(money.currency).toUpperCase();
  return amount && amount !== "0" && /^[A-Z]{3}$/u.test(currency)
    ? { amount, currency }
    : null;
}

/**
 * Extracts the immutable commerce contract from the exact V3 create body.
 * Temu echoes `externalSkuId` as `outSkuSn`, V3 `basePrice` as the detail
 * response's retail price, and regular inventory through the dedicated stock
 * query. Any incomplete or duplicate source SKU fails closed before a write.
 */
export function temuPublicationExpectedSkus(bodyValue: unknown): TemuPublicationExpectedSku[] | null {
  const body = recordValue(bodyValue);
  const skus = recordArray(body.skuList);
  if (skus.length === 0) return null;
  const normalized = skus.map((sku) => {
    const externalSkuId = exactText(sku.externalSkuId);
    const quantity = exactNonNegativeInteger(sku.quantity);
    const basePrice = canonicalMoney(recordValue(sku.price).basePrice);
    return externalSkuId
      && externalSkuId.length <= 128
      && !/\p{Cc}/u.test(externalSkuId)
      && quantity !== null
      && basePrice
      ? { externalSkuId, quantity, basePrice }
      : null;
  });
  if (normalized.some((sku) => !sku)) return null;
  const exact = normalized.filter((sku): sku is TemuPublicationExpectedSku => Boolean(sku));
  return new Set(exact.map((sku) => sku.externalSkuId)).size === exact.length ? exact : null;
}

function exactRemoteRetailPrice(sku: UnknownRecord) {
  const nestedPrice = recordValue(sku.price);
  const candidates = [nestedPrice.retailPrice, sku.retailPrice]
    .map(canonicalMoney)
    .filter((value): value is NonNullable<ReturnType<typeof canonicalMoney>> => Boolean(value));
  if (candidates.length === 0) return null;
  return candidates.every((candidate) => candidate.amount === candidates[0].amount
      && candidate.currency === candidates[0].currency)
    ? candidates[0]
    : null;
}

function temuCommerceReadbackChecks(input: {
  remoteId: string;
  detail: UnknownRecord;
  stockData: UnknownRecord;
  expectedSkus: TemuPublicationExpectedSku[];
}) {
  const detailSkus = recordArray(input.detail.skuList);
  const detailMatches = input.expectedSkus.map((expected) => {
    const matches = detailSkus.filter((sku) => exactText(sku.outSkuSn) === expected.externalSkuId);
    const sku = matches.length === 1 ? matches[0] : null;
    const skuId = sku ? temuExactLongGoodsId(sku.skuId) : null;
    return { expected, sku, skuId, price: sku ? exactRemoteRetailPrice(sku) : null };
  });
  const skuIdentityVerified = detailSkus.length === input.expectedSkus.length
    && detailMatches.every((match) => Boolean(match.sku && match.skuId));
  const priceVerified = skuIdentityVerified && detailMatches.every((match) =>
    match.price?.amount === match.expected.basePrice.amount
    && match.price.currency === match.expected.basePrice.currency);

  const stockRoot = resultRecord(input.stockData);
  const goodsStocks = recordArray(stockRoot.stockList).filter((item) =>
    firstText(item, ["goodsId"]) === input.remoteId);
  const skuStocks = goodsStocks.length === 1
    ? recordArray(goodsStocks[0].skuStockInfoList)
    : [];
  const stockVerified = skuIdentityVerified
    && goodsStocks.length === 1
    && skuStocks.length === input.expectedSkus.length
    && detailMatches.every((match) => {
      const matches = skuStocks.filter((stock) =>
        temuExactLongGoodsId(stock.skuId) === match.skuId
        && exactText(stock.outSkuSn) === match.expected.externalSkuId);
      if (matches.length !== 1) return false;
      return exactNonNegativeInteger(recordValue(matches[0].selfOrdinaryStock).stock)
        === match.expected.quantity;
    });
  return { skuIdentityVerified, priceVerified, stockVerified };
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalizedStatus(value: unknown) {
  return exactText(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_|_$/gu, "");
}

function explicitSaleStates(...records: UnknownRecord[]) {
  const observed = new Set<"on" | "off">();
  const aliases = ["onsale", "onSale", "isOnSale", "saleStatus", "sale_status"];
  for (const record of records) {
    for (const alias of aliases) {
      const entry = Object.entries(record).find(([key]) => key.toLowerCase() === alias.toLowerCase());
      if (!entry) continue;
      const value = entry[1];
      if (value === true || value === 1 || ["1", "TRUE", "ON", "ON_SALE", "ONLINE"].includes(normalizedStatus(value))) {
        observed.add("on");
      }
      if (value === false || value === 0 || ["0", "FALSE", "OFF", "OFF_SHELF", "OFF_SALE", "OFFLINE"].includes(normalizedStatus(value))) {
        observed.add("off");
      }
    }
  }
  return observed;
}

function temuVisibility(
  listItem: UnknownRecord,
  statusItem: UnknownRecord,
  detail: UnknownRecord,
): VerifiedListingRemoteState["visibility"] | undefined {
  const saleStates = explicitSaleStates(listItem, statusItem, detail, recordValue(detail.goodsBasic));

  const statuses = [
    statusItem.statusName,
    statusItem.statusDesc,
    statusItem.publishStatus,
    statusItem.publishStatusName,
    statusItem.subStatusName,
    listItem.goodsShowStatus,
    listItem.goodsShowSubStatus,
    listItem.goodsStatus,
    listItem.status4VO,
    listItem.subStatus4VO,
    detail.goodsShowStatus,
    detail.goodsShowSubStatus,
  ].map(normalizedStatus).filter(Boolean);
  const rejected = new Set([
    "REJECTED", "REVIEW_REJECTED", "AUDIT_REJECTED", "FAILED", "PUBLISH_FAILED", "BLOCKED",
  ]);
  const pending = new Set([
    "PENDING", "PENDING_REVIEW", "UNDER_REVIEW", "REVIEWING", "PROCESSING", "AUDITING", "IN_AUDIT",
  ]);
  const live = new Set([
    "LIVE", "PUBLISHED", "ON_SALE", "ONLINE", "ACTIVE",
  ]);
  const nonPublic = new Set([
    "OFF_SHELF", "OFF_SALE", "OFFLINE", "INACTIVE", "SUSPENDED", "UNPUBLISHED",
  ]);
  const withdrawn = new Set(["WITHDRAWN", "DELETED", "REMOVED"]);
  const statusLive = statuses.some((status) => live.has(status));
  const statusNonPublic = statuses.some((status) => nonPublic.has(status) || withdrawn.has(status));
  const onEvidence = saleStates.has("on") || statusLive;
  const offEvidence = saleStates.has("off") || statusNonPublic;
  if (onEvidence && offEvidence) return undefined;
  if (statuses.some((status) => rejected.has(status))) return "rejected";
  if (saleStates.has("off")) return "non_public";
  if (statuses.some((status) => pending.has(status))) return "pending_review";
  if (saleStates.has("on") && statuses.length === 0) return "live";
  if (statuses.length > 0 && statuses.every((status) => live.has(status))) return "live";
  if (statuses.length > 0 && statuses.every((status) => withdrawn.has(status))) return "withdrawn";
  if (statuses.length > 0 && statuses.every((status) => nonPublic.has(status) || withdrawn.has(status))) {
    return "non_public";
  }

  // Numeric-only status pairs have not yet been bound to a sanitized real
  // provider response or an official Temu contract in this repository. Do not
  // infer visibility from synthetic numbers: explicit sale-state or textual
  // provider evidence is required until production readback evidence is
  // reviewed and versioned.
  return undefined;
}

function normalizedTemuLocale(detail: UnknownRecord) {
  const goodsBasic = recordValue(detail.goodsBasic);
  const value = firstText(detail, ["locale", "language", "languageCode"])
    || firstText(goodsBasic, ["locale", "language", "languageCode"]);
  const normalized = value.replaceAll("_", "-").toLowerCase();
  return normalized === "ko" || normalized === "ko-kr" ? "ko-KR" : "";
}

function temuDetailImages(detail: UnknownRecord) {
  const gallery = recordValue(detail.goodsGallery);
  const goodsBasic = recordValue(detail.goodsBasic);
  return stringArray(
    gallery.detailImage
      ?? gallery.detailImages
      ?? goodsBasic.detailImage
      ?? goodsBasic.detailImages
      ?? detail.detailImage
      ?? detail.detailImages,
  );
}

function temuRepresentativeImages(detail: UnknownRecord) {
  const gallery = recordValue(detail.goodsGallery);
  const goodsBasic = recordValue(detail.goodsBasic);
  return stringArray(
    gallery.goodsCarouselImage
      ?? gallery.goodsCarouselImages
      ?? goodsBasic.goodsCarouselImage
      ?? goodsBasic.goodsCarouselImages
      ?? detail.goodsCarouselImage
      ?? detail.goodsCarouselImages,
  );
}

function temuProviderStatus(statusItem: UnknownRecord, listItem: UnknownRecord) {
  const fields = [
    ["status", statusItem.status],
    ["subStatus", statusItem.subStatus],
    ["statusName", statusItem.statusName ?? statusItem.publishStatusName],
    ["goodsShowSubStatus", listItem.goodsShowSubStatus],
    ["goodsStatus", listItem.goodsStatus],
    ["status4VO", listItem.status4VO],
    ["subStatus4VO", listItem.subStatus4VO],
  ] as const;
  const parts = fields
    .map(([name, value]) => [name, exactText(value)] as const)
    .filter((entry) => entry[1])
    .map(([name, value]) => `${name}=${value}`);
  return parts.join(";").slice(0, 160);
}

/**
 * Converts Temu's independent list/status/detail readbacks into the strict
 * SellerPilot publication ledger contract. Unknown provider states, missing
 * locale, identity drift, and any 7/9/reordered/duplicate detail-image set all
 * fail closed.
 */
export function normalizeTemuListingPublicationReadback(input: {
  operation: TemuPublicationReadbackOperation;
  intent?: ListingPublicationIntent;
  remoteId: string;
  externalGoodsId: string;
  listData: UnknownRecord;
  publishStatusData: UnknownRecord;
  detailData: UnknownRecord;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedRepresentativeImages: string[];
  expectedDetailImages: string[];
  requestedLanguage?: string;
  expectedGoodsName?: string;
  expectedGoodsDesc?: string;
  expectedBulletPoints?: string[];
  expectedSkus?: TemuPublicationExpectedSku[];
  stockData?: UnknownRecord;
  verifiedAt?: Date;
}): TemuPublicationReadbackVerification {
  const remoteId = input.remoteId.trim();
  const externalGoodsId = input.externalGoodsId.trim();
  const listRoot = resultRecord(input.listData);
  const statusRoot = resultRecord(input.publishStatusData);
  const detail = resultRecord(input.detailData);
  const listItem = recordArray(listRoot.goodsList).find((row) =>
    firstText(row, ["goodsId"]) === remoteId
    && firstText(row, ["outGoodsSn", "externalGoodsId"]) === externalGoodsId) ?? {};
  const statusItem = recordArray(statusRoot.goodsPublishStatusList).find((row) =>
    firstText(row, ["goodsId"]) === remoteId) ?? {};
  const detailGoodsId = firstText(detail, ["goodsId"])
    || firstText(recordValue(detail.goodsBasic), ["goodsId"]);
  const detailExternalGoodsId = firstText(detail, ["outGoodsSn", "externalGoodsId"])
    || firstText(recordValue(detail.goodsBasic), ["outGoodsSn", "externalGoodsId"]);
  const goodsIdVerified = Boolean(remoteId
    && firstText(listItem, ["goodsId"]) === remoteId
    && firstText(statusItem, ["goodsId"]) === remoteId
    && detailGoodsId === remoteId);
  const externalGoodsIdVerified = Boolean(externalGoodsId
    && firstText(listItem, ["outGoodsSn", "externalGoodsId"]) === externalGoodsId
    && (!detailExternalGoodsId || detailExternalGoodsId === externalGoodsId));
  const identityVerified = goodsIdVerified && externalGoodsIdVerified;
  const visibility = temuVisibility(listItem, statusItem, detail);
  const providerStatus = temuProviderStatus(statusItem, listItem);
  const statusVerified = Boolean(visibility && providerStatus);
  const requestedLanguage = exactText(input.requestedLanguage).replaceAll("_", "-").toLowerCase();
  const responseLocale = normalizedTemuLocale(detail);
  // detail.query does not promise to echo the request language. The locale
  // evidence is therefore the server-bound `language: ko` request together
  // with an exact Korean source-content readback, not a synthetic response
  // locale field.
  const locale = requestedLanguage === "ko" || requestedLanguage === "ko-kr"
    ? "ko-KR"
    : responseLocale;
  const detailGoodsBasic = recordValue(detail.goodsBasic);
  const remoteGoodsName = firstText(detail, ["goodsName"])
    || firstText(detailGoodsBasic, ["goodsName"]);
  const remoteGoodsDesc = firstText(detail, ["goodsDesc"])
    || firstText(detailGoodsBasic, ["goodsDesc"]);
  const remoteBulletPoints = exactStringArray(
    detail.bulletPoints ?? detailGoodsBasic.bulletPoints,
  );
  const expectedGoodsName = exactText(input.expectedGoodsName);
  const expectedGoodsDesc = exactText(input.expectedGoodsDesc);
  const expectedBulletPoints = exactStringArray(input.expectedBulletPoints);
  const exactImageOperation = input.operation !== "listing.stop";
  const contentVerified = exactImageOperation
    ? Boolean(expectedGoodsName
      && expectedGoodsDesc
      && expectedBulletPoints.length > 0
      && remoteGoodsName === expectedGoodsName
      && remoteGoodsDesc === expectedGoodsDesc
      && sameOrderedValues(remoteBulletPoints, expectedBulletPoints))
    : true;
  const localeVerified = input.expectedLocale === "ko-KR"
    && locale === input.expectedLocale
    && contentVerified;
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
    && contentVerified;
  const representativeImages = temuRepresentativeImages(detail);
  const detailImages = temuDetailImages(detail);
  const expectedRepresentativeImagesValid = exactImageOperation
    ? input.expectedRepresentativeImages.length === 1
      && new Set(input.expectedRepresentativeImages).size === 1
      && input.expectedRepresentativeImages.every((url) => /^https:\/\//u.test(url))
      && !input.expectedRepresentativeImages.some((url) => input.expectedDetailImages.includes(url))
    : input.expectedRepresentativeImages.length === 0;
  const representativeImageVerified = exactImageOperation
    ? expectedRepresentativeImagesValid
      && representativeImages.length === 1
      && sameOrderedValues(input.expectedRepresentativeImages, representativeImages)
    : true;
  const expectedImagesValid = exactImageOperation
    ? input.expectedDetailImages.length === 8
      && new Set(input.expectedDetailImages).size === 8
      && input.expectedDetailImages.every((url) => /^https:\/\//u.test(url))
    : input.expectedDetailImages.length === 0;
  const imageCountVerified = exactImageOperation
    ? expectedImagesValid && detailImages.length === 8 && new Set(detailImages).size === 8
    : true;
  const imageOrderVerified = exactImageOperation
    ? imageCountVerified && sameOrderedValues(input.expectedDetailImages, detailImages)
    : true;
  const commerceChecks = exactImageOperation && input.expectedSkus?.length && input.stockData
    ? temuCommerceReadbackChecks({
        remoteId,
        detail,
        stockData: input.stockData,
        expectedSkus: input.expectedSkus,
      })
    : {
        skuIdentityVerified: !exactImageOperation,
        priceVerified: !exactImageOperation,
        stockVerified: !exactImageOperation,
      };
  const checks = {
    identityVerified,
    statusVerified,
    localeVerified,
    fingerprintVerified,
    representativeImageVerified,
    imageCountVerified,
    imageOrderVerified,
    contentVerified,
    ...commerceChecks,
    goodsIdVerified,
    externalGoodsIdVerified,
  };
  const visibilityMatchesOperation = input.operation === "listing.publication.verify"
    ? Boolean(visibility)
    : input.operation === "listing.stop"
      ? visibility === "non_public" || visibility === "withdrawn"
      : input.intent === "safe_test"
      ? visibility === "non_public" || visibility === "withdrawn"
      : input.intent === "live"
        ? visibility === "live" || visibility === "pending_review"
        : false;
  if (!Object.values(checks).every(Boolean) || !visibility || !visibilityMatchesOperation) {
    return { providerStatus, visibility, representativeImages, detailImages, checks };
  }

  const candidate = verifiedListingRemoteStateSchema.safeParse({
    verified: true,
    visibility,
    providerStatus,
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
    evidence: {
      version: exactImageOperation
        ? "temu_list_status_detail_stock_v3"
        : "temu_list_status_detail_v1",
      readbackMethods: exactImageOperation
        ? [
            "temu.local.goods.list.retrieve",
            "bg.local.goods.publish.status.get",
            "bg.local.goods.detail.query",
            "temu.local.goods.sku.stock.query",
          ]
        : [
            "temu.local.goods.list.retrieve",
            "bg.local.goods.publish.status.get",
            "bg.local.goods.detail.query",
          ],
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      representativeImageVerified: true,
      imageCountVerified: true,
      imageOrderVerified: true,
      contentVerified: true,
      skuIdentityVerified: true,
      priceVerified: true,
      stockVerified: true,
      goodsIdVerified: true,
      externalGoodsIdVerified: true,
      observedRepresentativeImageCount: representativeImages.length,
      representativeImageDigest: sha256(representativeImages),
      observedDetailImageCount: detailImages.length,
      orderedDetailImageDigest: sha256(detailImages),
      observedSkuCount: recordArray(detail.skuList).length,
    },
    resources: {
      goodsId: remoteId,
      externalGoodsId,
    },
    locale,
    fingerprint: input.expectedFingerprint,
    imageCount: exactImageOperation ? detailImages.length : 0,
  });
  return {
    ...(candidate.success ? { remoteState: candidate.data } : {}),
    providerStatus,
    visibility,
    representativeImages,
    detailImages,
    checks,
  };
}
