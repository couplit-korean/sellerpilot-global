import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export const temuExistingAdoptionContract = "temu_exact_existing_active_adoption_v1" as const;
export const temuCredentialCertificationContract = "temu_exact_credential_certification_v1" as const;

const temuCredentialCertificationRequiredScope = "bg.open.accesstoken.info.get";

export const temuExistingAdoptionIdentity = {
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  sourceSellerSku: "QA-20260823-CC-001",
  goodsId: "608570473054515",
  skuId: "123896921649274",
  market: "KR",
  targetId: "KR",
} as const;

export type TemuExistingAdoptionBinding = {
  contract: typeof temuExistingAdoptionContract;
  reviewId: string;
  productId: typeof temuExistingAdoptionIdentity.productId;
  credentialId: string;
  goodsId: typeof temuExistingAdoptionIdentity.goodsId;
  skuId: typeof temuExistingAdoptionIdentity.skuId;
  approvedManifestDigest: string;
};

export type TemuCredentialCertificationBinding = {
  contract: typeof temuCredentialCertificationContract;
  reviewId: string;
  productId: typeof temuExistingAdoptionIdentity.productId;
  credentialId: string;
  goodsId: typeof temuExistingAdoptionIdentity.goodsId;
  skuId: typeof temuExistingAdoptionIdentity.skuId;
};

export type TemuCredentialIdentityObservation = {
  contract: "temu_exact_credential_identity_observation_v1";
  verified: true;
  mallId: string;
  sellerSubject: string;
  sellerAccountKey: string;
  apiScopeDigest: string;
  apiScopeCount: number;
  observedAt: string;
  digest: string;
};

export type TemuExistingAdoptionObservation = {
  contract: "temu_exact_existing_active_observation_v1";
  verified: true;
  goodsId: string;
  skuId: string;
  externalGoodsId: string;
  externalSkuId: string;
  providerStatus: string;
  visibility: "live";
  locale: "ko-KR";
  currency: "KRW";
  price: string;
  stock: number;
  goodsName: string;
  goodsDesc: string;
  bulletPoints: string[];
  representativeImages: string[];
  detailImages: string[];
  observedAt: string;
  digest: string;
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function resultRecord(value: UnknownRecord) {
  const result = recordValue(value.result);
  if (Object.keys(result).length) return result;
  const data = recordValue(value.data);
  return Object.keys(data).length ? data : value;
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map(recordValue).filter((entry) => Object.keys(entry).length > 0)
    : [];
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function exactLong(value: unknown) {
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

function firstText(value: UnknownRecord, names: readonly string[]) {
  for (const name of names) {
    const direct = exactText(value[name]);
    if (direct) return direct;
    const entry = Object.entries(value).find(([key]) => key.toLowerCase() === name.toLowerCase());
    const nested = entry ? exactText(entry[1]) : "";
    if (nested) return nested;
  }
  return "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean)
    : [];
}

function normalizedStatus(value: unknown) {
  return exactText(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_|_$/gu, "");
}

function exactMoney(value: unknown) {
  const price = recordValue(value);
  const amount = exactText(price.amount);
  const currency = exactText(price.currency).toUpperCase();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(amount) || !/^[A-Z]{3}$/u.test(currency)) return null;
  const [integer, fraction = ""] = amount.split(".");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  const normalizedAmount = normalizedFraction
    ? `${BigInt(integer).toString()}.${normalizedFraction}`
    : BigInt(integer).toString();
  return normalizedAmount === "0" ? null : { amount: normalizedAmount, currency };
}

function exactStock(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return null;
  const text = exactText(value);
  if (!/^(?:0|[1-9]\d*)$/u.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 && String(number) === text ? number : null;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactUuid(value: unknown) {
  const text = exactText(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text)
    ? text
    : "";
}

export function temuExistingAdoptionBinding(argumentsValue: Record<string, unknown>) {
  const marker = recordValue(argumentsValue.sellerpilotTemuExistingAdoption);
  const keys = Object.keys(marker).sort();
  const expectedKeys = [
    "approvedManifestDigest",
    "contract",
    "credentialId",
    "goodsId",
    "productId",
    "reviewId",
    "skuId",
  ].sort();
  const reviewId = exactUuid(marker.reviewId);
  const credentialId = exactUuid(marker.credentialId);
  const productId = exactUuid(marker.productId);
  const approvedManifestDigest = exactText(marker.approvedManifestDigest);
  if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])
      || marker.contract !== temuExistingAdoptionContract
      || !reviewId
      || !credentialId
      || productId !== temuExistingAdoptionIdentity.productId
      || exactLong(marker.goodsId) !== temuExistingAdoptionIdentity.goodsId
      || exactLong(marker.skuId) !== temuExistingAdoptionIdentity.skuId
      || !/^[a-f0-9]{64}$/u.test(approvedManifestDigest)
      || argumentsValue.sellerpilotReadOnly !== true) {
    return null;
  }
  return {
    contract: temuExistingAdoptionContract,
    reviewId,
    productId: temuExistingAdoptionIdentity.productId,
    credentialId,
    goodsId: temuExistingAdoptionIdentity.goodsId,
    skuId: temuExistingAdoptionIdentity.skuId,
    approvedManifestDigest,
  } satisfies TemuExistingAdoptionBinding;
}

export function temuCredentialCertificationBinding(argumentsValue: Record<string, unknown>) {
  const marker = recordValue(argumentsValue.sellerpilotTemuCredentialCertification);
  const keys = Object.keys(marker).sort();
  const expectedKeys = [
    "contract",
    "credentialId",
    "goodsId",
    "productId",
    "reviewId",
    "skuId",
  ].sort();
  const reviewId = exactUuid(marker.reviewId);
  const credentialId = exactUuid(marker.credentialId);
  const productId = exactUuid(marker.productId);
  if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])
      || marker.contract !== temuCredentialCertificationContract
      || !reviewId
      || !credentialId
      || productId !== temuExistingAdoptionIdentity.productId
      || exactLong(marker.goodsId) !== temuExistingAdoptionIdentity.goodsId
      || exactLong(marker.skuId) !== temuExistingAdoptionIdentity.skuId
      || argumentsValue.sellerpilotReadOnly !== true) {
    return null;
  }
  return {
    contract: temuCredentialCertificationContract,
    reviewId,
    productId: temuExistingAdoptionIdentity.productId,
    credentialId,
    goodsId: temuExistingAdoptionIdentity.goodsId,
    skuId: temuExistingAdoptionIdentity.skuId,
  } satisfies TemuCredentialCertificationBinding;
}

export function normalizeTemuCredentialIdentityObservation(
  accessTokenInfoData: UnknownRecord,
  observedAt = new Date(),
): TemuCredentialIdentityObservation | null {
  const result = resultRecord(accessTokenInfoData);
  const mallId = exactLong(result.mallId);
  if (!mallId) return null;
  const rawScopes = result.apiScopeList;
  if (!Array.isArray(rawScopes) || rawScopes.length < 1 || rawScopes.length > 2_000) return null;
  const scopes = rawScopes.map((scope) => exactText(scope));
  if (scopes.some((scope) => !scope || scope.length > 256 || /\p{Cc}/u.test(scope))) return null;
  const uniqueScopes = [...new Set(scopes)].sort();
  if (uniqueScopes.length !== scopes.length
      || !uniqueScopes.includes(temuCredentialCertificationRequiredScope)) return null;
  const sellerSubject = `temu:mall:${mallId}`;
  const sellerAccountKey = createHash("sha256")
    .update(`temu\u001fproduction\u001f${sellerSubject}`, "utf8")
    .digest("hex");
  const canonical = {
    contract: "temu_exact_credential_identity_observation_v1" as const,
    mallId,
    sellerSubject,
    sellerAccountKey,
    apiScopeDigest: sha256(uniqueScopes),
    apiScopeCount: uniqueScopes.length,
    observedAt: observedAt.toISOString(),
  };
  return {
    ...canonical,
    verified: true,
    digest: sha256(canonical),
  };
}

export function temuExistingAdoptionExternalGoodsId(detailData: UnknownRecord) {
  const detail = resultRecord(detailData);
  const goodsBasic = recordValue(detail.goodsBasic);
  const goodsId = firstText(detail, ["goodsId"]) || firstText(goodsBasic, ["goodsId"]);
  const externalGoodsId = firstText(detail, ["outGoodsSn", "externalGoodsId"])
    || firstText(goodsBasic, ["outGoodsSn", "externalGoodsId"]);
  return exactLong(goodsId) === temuExistingAdoptionIdentity.goodsId
      && externalGoodsId
      && externalGoodsId.length <= 128
      && !/\p{Cc}/u.test(externalGoodsId)
    ? externalGoodsId
    : null;
}

export function normalizeTemuExistingAdoptionObservation(input: {
  binding: TemuExistingAdoptionBinding;
  listData: UnknownRecord;
  publishStatusData: UnknownRecord;
  detailData: UnknownRecord;
  stockData: UnknownRecord;
  observedAt?: Date;
}): TemuExistingAdoptionObservation | null {
  const listRoot = resultRecord(input.listData);
  const statusRoot = resultRecord(input.publishStatusData);
  const detail = resultRecord(input.detailData);
  const detailGoodsBasic = recordValue(detail.goodsBasic);
  const stockRoot = resultRecord(input.stockData);
  const goodsId = input.binding.goodsId;
  const skuId = input.binding.skuId;
  const detailGoodsId = firstText(detail, ["goodsId"]) || firstText(detailGoodsBasic, ["goodsId"]);
  const externalGoodsId = temuExistingAdoptionExternalGoodsId(input.detailData);
  if (!externalGoodsId || exactLong(detailGoodsId) !== goodsId) return null;

  const listMatches = records(listRoot.goodsList).filter((entry) =>
    exactLong(firstText(entry, ["goodsId"])) === goodsId
    && firstText(entry, ["outGoodsSn", "externalGoodsId"]) === externalGoodsId);
  const statusMatches = records(statusRoot.goodsPublishStatusList).filter((entry) =>
    exactLong(firstText(entry, ["goodsId"])) === goodsId);
  if (listMatches.length !== 1 || statusMatches.length !== 1) return null;

  const detailSkus = records(detail.skuList);
  const skuMatches = detailSkus.filter((entry) => exactLong(entry.skuId) === skuId);
  if (detailSkus.length !== 1 || skuMatches.length !== 1) return null;
  const detailSku = skuMatches[0];
  const externalSkuId = firstText(detailSku, ["outSkuSn", "externalSkuId"]);
  if (!externalSkuId || externalSkuId.length > 128 || /\p{Cc}/u.test(externalSkuId)) return null;

  const stockGoods = records(stockRoot.stockList).filter((entry) =>
    exactLong(firstText(entry, ["goodsId"])) === goodsId);
  const stockSkus = stockGoods.length === 1 ? records(stockGoods[0].skuStockInfoList) : [];
  const stockMatches = stockSkus.filter((entry) =>
    exactLong(entry.skuId) === skuId
    && firstText(entry, ["outSkuSn", "externalSkuId"]) === externalSkuId);
  if (stockGoods.length !== 1 || stockSkus.length !== 1 || stockMatches.length !== 1) return null;
  const stock = exactStock(recordValue(stockMatches[0].selfOrdinaryStock).stock);
  if (stock === null) return null;

  const priceCandidates = [recordValue(detailSku.price).retailPrice, detailSku.retailPrice]
    .map(exactMoney)
    .filter((entry): entry is NonNullable<ReturnType<typeof exactMoney>> => Boolean(entry));
  if (priceCandidates.length === 0
      || priceCandidates.some((entry) => entry.amount !== priceCandidates[0].amount
        || entry.currency !== priceCandidates[0].currency)
      || priceCandidates[0].currency !== "KRW") return null;

  const goodsName = firstText(detail, ["goodsName"]) || firstText(detailGoodsBasic, ["goodsName"]);
  const goodsDesc = firstText(detail, ["goodsDesc"]) || firstText(detailGoodsBasic, ["goodsDesc"]);
  const bulletPoints = stringArray(detail.bulletPoints ?? detailGoodsBasic.bulletPoints);
  if (!goodsName || goodsName.length > 500 || /\p{Cc}/u.test(goodsName)
      || !goodsDesc || goodsDesc.length > 20_000 || /\p{Cc}/u.test(goodsDesc)
      || bulletPoints.length < 1 || bulletPoints.length > 10
      || bulletPoints.some((entry) => entry.length > 700 || /\p{Cc}/u.test(entry))
      || !/[가-힣]/u.test(goodsName)
      || !/[가-힣]/u.test(`${goodsDesc} ${bulletPoints.join(" ")}`)) return null;

  const localeValue = firstText(detail, ["locale", "language", "languageCode"])
    || firstText(detailGoodsBasic, ["locale", "language", "languageCode"]);
  const normalizedLocale = localeValue.replaceAll("_", "-").toLowerCase();
  if (normalizedLocale && normalizedLocale !== "ko" && normalizedLocale !== "ko-kr") return null;

  const gallery = recordValue(detail.goodsGallery);
  const representativeImages = stringArray(
    gallery.goodsCarouselImage
      ?? gallery.goodsCarouselImages
      ?? detailGoodsBasic.goodsCarouselImage
      ?? detailGoodsBasic.goodsCarouselImages
      ?? detail.goodsCarouselImage
      ?? detail.goodsCarouselImages,
  );
  const detailImages = stringArray(
    gallery.detailImage
      ?? gallery.detailImages
      ?? detailGoodsBasic.detailImage
      ?? detailGoodsBasic.detailImages
      ?? detail.detailImage
      ?? detail.detailImages,
  );
  if (representativeImages.length !== 1
      || detailImages.length !== 8
      || new Set(detailImages).size !== 8
      || detailImages.includes(representativeImages[0])
      || [...representativeImages, ...detailImages].some((url) =>
        !/^https:\/\//u.test(url) || url.length > 2048 || /\p{Cc}/u.test(url))) return null;

  const statusFields = [
    statusMatches[0].status,
    statusMatches[0].subStatus,
    statusMatches[0].statusName,
    statusMatches[0].publishStatusName,
    listMatches[0].goodsShowSubStatus,
    listMatches[0].goodsStatus,
    listMatches[0].status4VO,
    listMatches[0].subStatus4VO,
  ].map(normalizedStatus).filter(Boolean);
  const saleFields = [
    listMatches[0].onsale,
    listMatches[0].onSale,
    statusMatches[0].onsale,
    statusMatches[0].onSale,
    detail.onsale,
    detail.onSale,
    detailGoodsBasic.onsale,
    detailGoodsBasic.onSale,
  ];
  const liveStatuses = new Set(["ACTIVE", "LIVE", "PUBLISHED", "ON_SALE", "ONLINE"]);
  const blockedStatuses = new Set([
    "REJECTED", "REVIEW_REJECTED", "AUDIT_REJECTED", "FAILED", "BLOCKED",
    "PENDING", "PENDING_REVIEW", "UNDER_REVIEW", "REVIEWING", "PROCESSING",
    "OFF_SHELF", "OFF_SALE", "OFFLINE", "INACTIVE", "SUSPENDED", "UNPUBLISHED",
    "WITHDRAWN", "DELETED", "REMOVED",
  ]);
  const explicitOn = saleFields.some((value) => value === true || value === 1
    || ["1", "TRUE", "ON", "ON_SALE", "ONLINE"].includes(normalizedStatus(value)));
  const explicitOff = saleFields.some((value) => value === false || value === 0
    || ["0", "FALSE", "OFF", "OFF_SHELF", "OFF_SALE", "OFFLINE"].includes(normalizedStatus(value)));
  if (explicitOff
      || statusFields.some((value) => blockedStatuses.has(value))
      || (!explicitOn && !statusFields.some((value) => liveStatuses.has(value)))) return null;
  const providerStatus = statusFields.map((value, index) => `${index}:${value}`).join(";").slice(0, 160)
    || "ACTIVE";

  const observedAt = (input.observedAt ?? new Date()).toISOString();
  const canonical = {
    contract: "temu_exact_existing_active_observation_v1" as const,
    goodsId,
    skuId,
    externalGoodsId,
    externalSkuId,
    providerStatus,
    visibility: "live" as const,
    locale: "ko-KR" as const,
    currency: "KRW" as const,
    price: priceCandidates[0].amount,
    stock,
    goodsName,
    goodsDesc,
    bulletPoints,
    representativeImages,
    detailImages,
    observedAt,
  };
  return {
    ...canonical,
    verified: true,
    digest: sha256(canonical),
  };
}
