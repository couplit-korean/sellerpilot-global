import { createHash } from "node:crypto";
import {
  normalizeQoo10ListingPublicationReadback,
  type Qoo10PublicationReadbackVerification,
  type Qoo10RollbackRecoveryReadbackExpectation,
} from "./qoo10-listing-publication";
import { qoo10DetailImageUrls } from "./qoo10-listing-create-preflight";
import {
  verifiedListingRemoteStateSchema,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
} from "./listing-publication-content";

export const qoo10S1ActivationContract = "qoo10_s1_activation_v1" as const;
export const qoo10S1ActivationArgument = "sellerpilotQoo10S1Activation" as const;

export function qoo10ExactSuccessResultCode(data: Record<string, unknown>) {
  return Object.hasOwn(data, "ResultCode")
    && String(data.ResultCode) === "0";
}

/**
 * Qoo10 rewrites HTML heading elements to paragraph elements when it stores an
 * item detail page. Keep the comparison deliberately narrow: no whitespace,
 * attribute, text, URL, or other tag normalization is allowed.
 */
export function qoo10CanonicalProviderDetailHtml(value: string) {
  return value.replace(/<(\/?)h[1-6](?=[\t\n\f\r />])/giu, "<$1p");
}

export function qoo10ProviderDetailHtmlEquivalent(source: string, remote: string) {
  return Boolean(source) && Boolean(remote)
    && (source === remote || qoo10CanonicalProviderDetailHtml(source) === remote);
}

function qoo10SourceDetailHtmlMatchesProviderDigest(value: string, expectedSha256: string) {
  return digest(value) === expectedSha256
    || digest(qoo10CanonicalProviderDetailHtml(value)) === expectedSha256;
}

export type Qoo10S1ActivationBinding = {
  status: "allowed";
  contract: typeof qoo10S1ActivationContract;
  listingId: string;
  remoteId: string;
  providerStatus: "S1";
  sourceJobId: string;
  verifierJobId: string;
  verifierResponseSha256: string;
  verifierCompletedAt: string;
  expectedState: {
    categoryCode: string;
    retailPriceJpy: number;
    sellPriceJpy: number;
    quantity: number;
    shippingNo: string;
    biContentsNo: number;
    originType: "1" | "2" | "3";
    originCode: string;
    adultYn: "Y" | "N";
  };
  expectedTitle: string;
  expectedKeyword: string;
  expectedPromotionName: string;
  expectedIndustrialCode: string;
  expectedDetailHtmlSha256: string;
  expectedDetailImageUrls: string[];
  expectedSellerCode?: string;
};

type ActivationArguments = Record<string, unknown>;

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function exactString(value: unknown, pattern: RegExp, maximum = 2_000_000) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && pattern.test(value);
}

function uuid(value: unknown) {
  return exactString(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu, 36);
}

function sha256(value: unknown) {
  return exactString(value, /^[a-f0-9]{64}$/u, 64);
}

function positiveInteger(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && !url.hash;
  } catch {
    return false;
  }
}

function isoTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 80) return false;
  const match = value.match(
    /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u,
  );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

export function qoo10S1ActivationBinding(argumentsValue: ActivationArguments): Qoo10S1ActivationBinding | null {
  const marker = recordValue(argumentsValue[qoo10S1ActivationArgument]);
  if (!marker || !exactKeys(marker, [
    "status", "contract", "listingId", "remoteId", "providerStatus", "sourceJobId",
    "verifierJobId", "verifierResponseSha256", "verifierCompletedAt", "expectedState",
    "expectedTitle", "expectedKeyword", "expectedPromotionName", "expectedIndustrialCode",
    "expectedDetailHtmlSha256", "expectedDetailImageUrls",
  ], ["expectedSellerCode"])) return null;

  const expected = recordValue(marker.expectedState);
  const images = marker.expectedDetailImageUrls;
  if (!expected || !exactKeys(expected, [
    "categoryCode", "retailPriceJpy", "sellPriceJpy", "quantity", "shippingNo", "biContentsNo",
    "originType", "originCode", "adultYn",
  ])) return null;
  if (marker.status !== "allowed"
      || marker.contract !== qoo10S1ActivationContract
      || marker.providerStatus !== "S1"
      || !uuid(marker.listingId)
      || !uuid(marker.sourceJobId)
      || !uuid(marker.verifierJobId)
      || !exactString(marker.remoteId, /^\d{9,10}$/u, 10)
      || !sha256(marker.verifierResponseSha256)
      || !isoTimestamp(marker.verifierCompletedAt)
      || !exactString(expected.categoryCode, /^\d{9}$/u, 9)
      || !positiveInteger(expected.retailPriceJpy, 999_999_999)
      || !positiveInteger(expected.sellPriceJpy, 999_999_999)
      || Number(expected.sellPriceJpy) > Number(expected.retailPriceJpy)
      || !positiveInteger(expected.quantity, 99_999_999)
      || !exactString(expected.shippingNo, /^\d{1,20}$/u, 20)
      || !positiveInteger(expected.biContentsNo, Number.MAX_SAFE_INTEGER)
      || Number(expected.biContentsNo) < 100_000
      || !["1", "2", "3"].includes(String(expected.originType))
      || !exactString(expected.originCode, /^[A-Za-z0-9_-]{1,80}$/u, 80)
      || !["Y", "N"].includes(String(expected.adultYn))
      || !exactString(marker.expectedTitle, /^.{1,100}$/u, 100)
      || typeof marker.expectedKeyword !== "string"
      || marker.expectedKeyword.length > 500
      || typeof marker.expectedPromotionName !== "string"
      || marker.expectedPromotionName.length > 100
      || typeof marker.expectedIndustrialCode !== "string"
      || marker.expectedIndustrialCode.length > 100
      || !sha256(marker.expectedDetailHtmlSha256)
      || !Array.isArray(images)
      || images.length !== 8
      || new Set(images).size !== images.length
      || !images.every(safeHttpsUrl)
      || (marker.expectedSellerCode !== undefined
        && !exactString(marker.expectedSellerCode, /^.{1,100}$/u, 100))) return null;
  return structuredClone(marker) as Qoo10S1ActivationBinding;
}

function exactText(record: Record<string, unknown>, names: readonly string[]) {
  const aliases = new Set(names.map((name) => name.toLowerCase()));
  const value = Object.entries(record).find(([name]) => aliases.has(name.toLowerCase()))?.[1];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function aliasesConsistent(record: Record<string, unknown>, aliases: readonly string[]) {
  const normalized = new Set(aliases.map((alias) => alias.toLowerCase()));
  const values = Object.entries(record)
    .filter(([key]) => normalized.has(key.toLowerCase()))
    .map(([, value]) => typeof value === "string" || typeof value === "number"
      ? String(value)
      : "");
  return values.length <= 1 || new Set(values).size === 1;
}

function presentAliasValues(record: Record<string, unknown>, aliases: readonly string[]) {
  const normalized = new Set(aliases.map((alias) => alias.toLowerCase()));
  return Object.entries(record)
    .filter(([key]) => normalized.has(key.toLowerCase()))
    .map(([, value]) => value);
}

function optionalExactIntegerAliases(
  record: Record<string, unknown>,
  aliases: readonly string[],
  expected: number,
) {
  const values = presentAliasValues(record, aliases);
  return values.every((value) => typeof value === "number"
    ? Number.isSafeInteger(value) && value === expected
    : typeof value === "string" && value === String(expected));
}

function exactTextAliases(
  record: Record<string, unknown>,
  aliases: readonly string[],
  expected: string,
) {
  const values = presentAliasValues(record, aliases);
  if (values.length === 0) return expected === "";
  return values.every((value) => (typeof value === "string" || typeof value === "number")
    && String(value) === expected);
}

function exactJpyIntegerAliases(
  record: Record<string, unknown>,
  aliases: readonly string[],
  expected: number,
) {
  const values = presentAliasValues(record, aliases);
  if (values.length === 0) return false;
  return values.every((value) => {
    const text = typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
    if (!/^\d+(?:\.0+)?$/u.test(text)) return false;
    const parsed = Number(text.split(".", 1)[0]);
    return Number.isSafeInteger(parsed) && parsed === expected;
  });
}

function qoo10RepresentativeImageMatchesContentId(value: unknown, expectedContentId: number) {
  if (typeof value !== "string" || value.length > 2_000) return false;
  const contentId = String(expectedContentId);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:"
        || url.hostname !== "gd.image-qoo10.jp"
        || url.port
        || url.username
        || url.password
        || url.search
        || url.hash) return false;
    const match = url.pathname.match(
      /^\/li\/(\d{3})\/(\d{3})\/([1-9]\d{5,19})(?:\.g(?:_[a-z0-9-]+)*)?\.jpg$/u,
    );
    return Boolean(match
      && match[3] === contentId
      && match[1] === contentId.slice(-3)
      && match[2] === contentId.slice(-6, -3));
  } catch {
    return false;
  }
}

function optionalRepresentativeImageAliasesMatch(
  record: Record<string, unknown>,
  expectedContentId: number,
) {
  const values = presentAliasValues(record, ["StandardImage", "ImageUrl", "MainImageUrl"]);
  return values.every((value) => qoo10RepresentativeImageMatchesContentId(value, expectedContentId));
}

export function qoo10CriticalReadbackAliasesConsistent(record: Record<string, unknown>) {
  return [
    ["ItemStatus", "Status"],
    ["SellerCode"],
    ["SecondSubCat", "SecondSubCatCd", "CategoryCode", "CateSCode"],
    ["ItemTitle"],
    ["Keyword", "Keywords"],
    ["PromotionName", "PromotionNm"],
    ["IndustrialCode", "barcode", "gtin"],
    ["ItemDetail", "ItemDescription", "Description"],
    ["ShippingNo", "ShippingNO", "DeliveryGroupNo"],
    ["SellPrice", "ItemPrice"],
    ["RetailPrice"],
    ["ItemQty", "Qty", "StockQty"],
    ["BIContentsNo", "BiContentsNo", "BIContentsNO"],
    ["ImageUrl", "StandardImage", "MainImageUrl"],
    ["ProductionPlaceType", "OriginType"],
    ["ProductionPlace", "Origin", "OriginCode"],
    ["AdultYN", "AdultYn", "AdultFlag"],
  ].every((aliases) => aliasesConsistent(record, aliases));
}

function matchingItems(value: unknown, remoteId: string, depth = 0, found: Record<string, unknown>[] = []) {
  if (depth > 7 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) matchingItems(item, remoteId, depth + 1, found);
    return found;
  }
  const record = recordValue(value);
  if (!record) return found;
  const identities = ["ItemNo", "ItemCode", "GdNo"]
    .filter((alias) => Object.hasOwn(record, alias))
    .map((alias) => exactText(record, [alias]));
  if (identities.length > 0 && identities.every((identity) => identity === remoteId)) found.push(record);
  for (const nested of Object.values(record)) matchingItems(nested, remoteId, depth + 1, found);
  return found;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function qoo10ExactRecoveryContentRemoteState(input: {
  remoteState: VerifiedListingRemoteState;
  title: string;
  keyword: string;
  detailHtml: string;
  detailImageUrls: readonly string[];
  sourceJobId: string;
  sourceOperation: "listing.update";
}) {
  const normalizedDescription = normalizedListingPublicationText(input.detailHtml);
  const titleLanguageVerified = listingPublicationLanguageVerified("ja-JP", input.title, "title");
  const descriptionLanguageVerified = listingPublicationLanguageVerified(
    "ja-JP",
    normalizedDescription,
    "description",
  );
  if (!titleLanguageVerified || !descriptionLanguageVerified) return undefined;
  const contentDigest = digest(input.detailHtml);
  const imageDigest = digest(JSON.stringify(input.detailImageUrls));
  const remoteProjectionDigest = digest(JSON.stringify({
    title: input.title,
    keyword: input.keyword,
    detailHtml: input.detailHtml,
    detailImageUrls: input.detailImageUrls,
  }));
  const parsed = verifiedListingRemoteStateSchema.safeParse({
    ...input.remoteState,
    evidence: {
      ...input.remoteState.evidence,
      sourceJobId: input.sourceJobId,
      sourceOperation: input.sourceOperation,
      sourceFingerprintVerified: true,
      sourceContentVerified: true,
      contentVerified: true,
      titleVerified: true,
      descriptionVerified: true,
      titleLanguageVerified,
      descriptionLanguageVerified,
      languageContentVerified: titleLanguageVerified && descriptionLanguageVerified,
      detailImageCountVerified: true,
      contentDigestVerified: true,
      representativeImageVerified: true,
      providerBodyDetailImagesVerified: true,
      fingerprintBinding: "source_request_fingerprint_v1",
      sourceContentDigest: contentDigest,
      remoteContentDigest: contentDigest,
      sourceImageDigest: imageDigest,
      remoteImageDigest: imageDigest,
      remoteProjectionDigest,
      providerImageSurface: "detail_content",
      providerImageContract: "approved_detail_content_exact_8",
    },
  });
  return parsed.success ? parsed.data : undefined;
}

export function qoo10ProviderKeywordMatches(
  sourceKeyword: string,
  providerKeyword: string,
  exactTitle: string,
) {
  if (providerKeyword === sourceKeyword) return true;
  const title = exactTitle.trim();
  if (!title
      || sourceKeyword !== sourceKeyword.trim()
      || providerKeyword !== providerKeyword.trim()) return false;
  const sourceTerms = sourceKeyword.split(",").map((term) => term.trim());
  const providerTerms = providerKeyword.split(",").map((term) => term.trim());
  if (sourceTerms.some((term) => !term)
      || providerTerms.some((term) => !term)
      || sourceTerms.join(",") !== sourceKeyword
      || providerTerms.join(",") !== providerKeyword) return false;
  const titleIndexes = sourceTerms
    .map((term, index) => term === title ? index : -1)
    .filter((index) => index >= 0);
  return titleIndexes.length === 1
    && titleIndexes[0] === 0
    && providerTerms.length === sourceTerms.length - 1
    && providerKeyword === sourceTerms.slice(1).join(",");
}

function activationRecoveryExpectation(binding: Qoo10S1ActivationBinding): Qoo10RollbackRecoveryReadbackExpectation {
  return {
    categoryCode: binding.expectedState.categoryCode,
    retailPriceJpy: binding.expectedState.retailPriceJpy,
    sellPriceJpy: binding.expectedState.sellPriceJpy,
    quantity: binding.expectedState.quantity,
    shippingNo: binding.expectedState.shippingNo,
    biContentsNo: binding.expectedState.biContentsNo,
    detailImageUrls: binding.expectedDetailImageUrls,
  };
}

export function qoo10S1ActivationArgumentsValid(argumentsValue: ActivationArguments) {
  const binding = qoo10S1ActivationBinding(argumentsValue);
  const params = recordValue(argumentsValue.params);
  if (!binding || !params) return false;
  const detailHtml = typeof params.ItemDescription === "string" ? params.ItemDescription : "";
  const sellerCode = typeof params.SellerCode === "string" ? params.SellerCode : "";
  const keyword = typeof params.Keyword === "string" ? params.Keyword : "";
  return params.ItemCode === binding.remoteId
    && params.SecondSubCat === binding.expectedState.categoryCode
    && optionalExactIntegerAliases(params, ["RetailPrice"], binding.expectedState.retailPriceJpy)
    && Object.hasOwn(params, "RetailPrice")
    && optionalExactIntegerAliases(
      params,
      ["ItemPrice", "SellPrice"],
      binding.expectedState.sellPriceJpy,
    )
    && optionalExactIntegerAliases(
      params,
      ["ItemQty", "Qty", "StockQty"],
      binding.expectedState.quantity,
    )
    && optionalExactIntegerAliases(params, ["BIContentsNo"], binding.expectedState.biContentsNo)
    && optionalRepresentativeImageAliasesMatch(params, binding.expectedState.biContentsNo)
    && String(params.ShippingNo ?? "") === binding.expectedState.shippingNo
    && params.ItemTitle === binding.expectedTitle
    && qoo10ProviderKeywordMatches(keyword, binding.expectedKeyword, binding.expectedTitle)
    && exactTextAliases(
      params,
      ["PromotionName", "PromotionNm"],
      binding.expectedPromotionName,
    )
    && exactTextAliases(
      params,
      ["IndustrialCode", "barcode", "gtin"],
      binding.expectedIndustrialCode,
    )
    && params.ProductionPlaceType === binding.expectedState.originType
    && params.ProductionPlace === binding.expectedState.originCode
    && params.AdultYN === binding.expectedState.adultYn
    && qoo10SourceDetailHtmlMatchesProviderDigest(
      detailHtml,
      binding.expectedDetailHtmlSha256,
    )
    && qoo10DetailImageUrls(detailHtml).length === 8
    && qoo10DetailImageUrls(detailHtml).every((url, index) => url === binding.expectedDetailImageUrls[index])
    && (!binding.expectedSellerCode || sellerCode === binding.expectedSellerCode)
    && argumentsValue.publicationStateContract === "verified_remote_state_v1"
    && argumentsValue.publicationIntent === "live"
    && argumentsValue.publicationExpectedLocale === "ja-JP"
    && sha256(argumentsValue.publicationExpectedFingerprint)
    && argumentsValue.publicationExpectedImageCount === 8;
}

export function verifyQoo10S1ActivationReadback(input: {
  arguments: ActivationArguments;
  resultObject: unknown;
  expectedStatus: "S1" | "S2";
  verifiedAt?: Date;
}): {
  ok: boolean;
  publication: Qoo10PublicationReadbackVerification;
  checks: Record<string, boolean>;
} {
  const binding = qoo10S1ActivationBinding(input.arguments);
  if (!binding) {
    return {
      ok: false,
      publication: { providerStatus: "", imageCount: 0, checks: {
        identityVerified: false, statusVerified: false, sellerCodeVerified: false,
        localeVerified: false, fingerprintVerified: false, imageCountVerified: false,
        sellerAccountIdentityVerified: false, categoryVerified: false, titleVerified: false,
        shippingVerified: false, priceQuantityVerified: false, representativeImageVerified: false,
        detailImageDigestVerified: false,
      } },
      checks: { markerVerified: false },
    };
  }
  const publication = normalizeQoo10ListingPublicationReadback({
    operation: "listing.activate",
    remoteId: binding.remoteId,
    resultObject: input.resultObject,
    expectedLocale: String(input.arguments.publicationExpectedLocale ?? ""),
    expectedFingerprint: String(input.arguments.publicationExpectedFingerprint ?? ""),
    expectedImageCount: Number(input.arguments.publicationExpectedImageCount),
    ...(binding.expectedSellerCode ? { expectedSellerCode: binding.expectedSellerCode } : {}),
    expectedRecovery: activationRecoveryExpectation(binding),
    ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}),
  });
  const matches = matchingItems(input.resultObject, binding.remoteId);
  const item = matches.length === 1 ? matches[0] : {};
  const detailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const remoteKeyword = exactText(item, ["Keyword", "Keywords"]);
  const actualDetailImageUrls = qoo10DetailImageUrls(detailHtml);
  const checks = {
    markerVerified: true,
    uniqueExactItemVerified: matches.length === 1,
    criticalAliasesConsistent: matches.length === 1
      && qoo10CriticalReadbackAliasesConsistent(item),
    providerStatusVerified: exactText(item, ["ItemStatus", "Status"]) === input.expectedStatus,
    visibilityVerified: input.expectedStatus === "S2"
      ? publication.remoteState?.visibility === "live"
      : publication.remoteState?.visibility === "non_public",
    titleVerified: exactText(item, ["ItemTitle"]) === binding.expectedTitle,
    keywordVerified: remoteKeyword === binding.expectedKeyword,
    promotionNameVerified: exactText(item, ["PromotionName", "PromotionNm"])
      === binding.expectedPromotionName,
    industrialCodeVerified: exactText(item, ["IndustrialCode", "barcode", "gtin"])
      === binding.expectedIndustrialCode,
    detailHtmlDigestVerified: digest(detailHtml) === binding.expectedDetailHtmlSha256,
    detailImageUrlsVerified: actualDetailImageUrls.length === 8
      && actualDetailImageUrls.every((url, index) => url === binding.expectedDetailImageUrls[index]),
    sellerCodeVerified: !binding.expectedSellerCode
      || exactText(item, ["SellerCode"]) === binding.expectedSellerCode,
    categoryVerified: exactText(
      item,
      ["SecondSubCat", "SecondSubCatCd", "CategoryCode", "CateSCode"],
    ) === binding.expectedState.categoryCode,
    retailPriceVerified: exactJpyIntegerAliases(
      item,
      ["RetailPrice"],
      binding.expectedState.retailPriceJpy,
    ),
    sellPriceVerified: exactJpyIntegerAliases(
      item,
      ["SellPrice", "ItemPrice"],
      binding.expectedState.sellPriceJpy,
    ),
    quantityVerified: exactText(item, ["ItemQty", "Qty", "StockQty"])
      === String(binding.expectedState.quantity),
    biContentsNoVerified: optionalExactIntegerAliases(
      item,
      ["BIContentsNo", "BiContentsNo", "BIContentsNO"],
      binding.expectedState.biContentsNo,
    ),
    shippingVerified: exactText(item, ["ShippingNo", "ShippingNO", "DeliveryGroupNo"])
      === binding.expectedState.shippingNo,
    representativeImageVerified: qoo10RepresentativeImageMatchesContentId(
      exactText(item, ["ImageUrl", "StandardImage", "MainImageUrl"]),
      binding.expectedState.biContentsNo,
    ),
    originTypeVerified: exactText(item, ["ProductionPlaceType", "OriginType"]) === binding.expectedState.originType,
    originCodeVerified: exactText(item, ["ProductionPlace", "Origin", "OriginCode"]) === binding.expectedState.originCode,
    adultYnVerified: exactText(item, ["AdultYN", "AdultYn", "AdultFlag"]) === binding.expectedState.adultYn,
  };
  const checksVerified = Object.values(checks).every(Boolean);
  const boundRemoteState = publication.remoteState && checksVerified
    ? qoo10ExactRecoveryContentRemoteState({
        remoteState: publication.remoteState,
        title: binding.expectedTitle,
        keyword: remoteKeyword,
        detailHtml,
        detailImageUrls: actualDetailImageUrls,
        sourceJobId: binding.sourceJobId,
        sourceOperation: "listing.update",
      })
    : undefined;
  return {
    ok: Boolean(boundRemoteState),
    publication: {
      ...publication,
      ...(boundRemoteState ? { remoteState: boundRemoteState } : { remoteState: undefined }),
    },
    checks,
  };
}
