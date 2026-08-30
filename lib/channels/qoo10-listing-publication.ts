import {
  verifiedListingRemoteStateSchema,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import {
  qoo10DetailImageUrls,
  type Qoo10ListingCreateExpectation,
} from "./qoo10-listing-create-preflight";

export type Qoo10ListingReadbackOperation = "listing.create" | "listing.update" | "listing.stop";

type Qoo10ListingReadbackInput = {
  operation: Qoo10ListingReadbackOperation;
  remoteId: string;
  resultObject: unknown;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
  expectedSellerCode?: string;
  expectedCreate?: Qoo10ListingCreateExpectation;
  expectedSellerAccountIdentityDigest?: string;
  expectedRepresentativeImageContentId?: string;
  expectedRecovery?: Qoo10RollbackRecoveryReadbackExpectation;
  verifiedAt?: Date;
};

/**
 * Server-owned expectation for the one bounded Qoo10 S1 rollback recovery.
 * Unlike the ordinary update projection, this contract also binds immutable
 * commerce fields and the provider-hosted representative image before S2 may
 * be requested.
 */
export type Qoo10RollbackRecoveryReadbackExpectation = {
  categoryCode: string;
  retailPriceJpy: number;
  sellPriceJpy: number;
  quantity: number;
  shippingNo: string;
  biContentsNo: number;
  detailImageUrls: readonly string[];
};

export type Qoo10PublicationReadbackChecks = {
  identityVerified: boolean;
  statusVerified: boolean;
  sellerCodeVerified: boolean;
  localeVerified: boolean;
  fingerprintVerified: boolean;
  imageCountVerified: boolean;
  sellerAccountIdentityVerified: boolean;
  categoryVerified: boolean;
  titleVerified: boolean;
  shippingVerified: boolean;
  priceQuantityVerified: boolean;
  representativeImageVerified: boolean;
  detailImageDigestVerified: boolean;
  recoveryExpectationVerified?: boolean;
  retailPriceVerified?: boolean;
  sellPriceVerified?: boolean;
  quantityVerified?: boolean;
  confirmedBiCdnImageVerified?: boolean;
  detailImageUrlsVerified?: boolean;
};

export type Qoo10PublicationReadbackVerification = {
  remoteState?: VerifiedListingRemoteState;
  providerStatus: string;
  imageCount: number;
  checks: Qoo10PublicationReadbackChecks;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(record: Record<string, unknown>, names: readonly string[]) {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  const value = Object.entries(record).find(([name]) => expected.has(name.toLowerCase()))?.[1];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function matchingItems(value: unknown, remoteId: string, depth = 0, found: Record<string, unknown>[] = []) {
  if (depth > 7 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) matchingItems(item, remoteId, depth + 1, found);
    return found;
  }
  const record = recordValue(value);
  if (!record) return found;
  if (exactText(record, ["ItemNo", "ItemCode", "GdNo"]) === remoteId) found.push(record);
  for (const nested of Object.values(record)) matchingItems(nested, remoteId, depth + 1, found);
  return found;
}

function detailImageCount(html: string) {
  const decoded = html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  return (decoded.match(/<img\b[^>]*\bsrc\s*=\s*(?:["'][^"']+["']|[^\s>]+)/giu) ?? []).length;
}

function japaneseLocaleVerified(value: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)
    || /\blang\s*=\s*["']?ja(?:-JP)?\b/iu.test(value);
}

function visibilityForStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "S2" || normalized === "2") return "live" as const;
  if (normalized === "S0" || normalized === "0") return "pending_review" as const;
  if (normalized === "S1" || normalized === "1") return "non_public" as const;
  if (normalized === "S3" || normalized === "3") return "withdrawn" as const;
  if (["S5", "5", "S8", "8"].includes(normalized)) return "rejected" as const;
  return null;
}

function exactInteger(record: Record<string, unknown>, names: readonly string[]) {
  const value = exactText(record, names);
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function exactJpyInteger(record: Record<string, unknown>, names: readonly string[]) {
  const value = exactText(record, names);
  // GetItemDetailInfo can serialize whole-JPY prices as fixed-point strings
  // (for example, "1871.0000"). Accept only an all-zero fractional suffix;
  // quantities and every non-price field keep their stricter representation.
  if (!/^\d+(?:\.0+)?$/u.test(value)) return null;
  const parsed = Number(value.split(".", 1)[0]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validRecoveryDetailImageUrl(value: string) {
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

function validRollbackRecoveryExpectation(
  value: Qoo10RollbackRecoveryReadbackExpectation,
  expectedImageCount: number,
) {
  return /^\d{9}$/u.test(value.categoryCode)
    && Number.isSafeInteger(value.retailPriceJpy)
    && value.retailPriceJpy >= 1
    && value.retailPriceJpy <= 999_999_999
    && Number.isSafeInteger(value.sellPriceJpy)
    && value.sellPriceJpy >= 1
    && value.sellPriceJpy <= value.retailPriceJpy
    && Number.isSafeInteger(value.quantity)
    && value.quantity >= 1
    && value.quantity <= 99_999_999
    && /^\d{1,20}$/u.test(value.shippingNo)
    && Number.isSafeInteger(value.biContentsNo)
    && value.biContentsNo >= 100_000
    && value.detailImageUrls.length === expectedImageCount
    && value.detailImageUrls.length > 0
    && value.detailImageUrls.length <= 64
    && new Set(value.detailImageUrls).size === value.detailImageUrls.length
    && value.detailImageUrls.every(validRecoveryDetailImageUrl);
}

type Qoo10RepresentativeImageBinding =
  | "source_url_literal"
  | "set_new_goods_bi_contents_no";

function qoo10RepresentativeImageBinding(input: {
  remoteImageUrl: string;
  sourceImageUrl: string;
  expectedContentId?: string;
}): Qoo10RepresentativeImageBinding | null {
  if (input.remoteImageUrl === input.sourceImageUrl) return "source_url_literal";

  const contentId = input.expectedContentId?.trim() ?? "";
  if (!/^[1-9]\d{5,19}$/u.test(contentId)) return null;

  try {
    const url = new URL(input.remoteImageUrl);
    if (url.protocol !== "https:"
        || url.hostname !== "gd.image-qoo10.jp"
        || url.port
        || url.username
        || url.password
        || url.search
        || url.hash) return null;

    const match = url.pathname.match(
      /^\/li\/(\d{3})\/(\d{3})\/([1-9]\d{5,19})(?:\.g(?:_[a-z0-9-]+)*)?\.jpg$/u,
    );
    if (!match || match[3] !== contentId) return null;
    if (match[1] !== contentId.slice(-3) || match[2] !== contentId.slice(-6, -3)) return null;
    return "set_new_goods_bi_contents_no";
  } catch {
    return null;
  }
}

/**
 * Converts one authoritative ItemsLookup.GetItemDetailInfo response into both
 * field-level diagnostics and the publication ledger contract. The helper
 * performs no provider mutation, so create failure handling and a later
 * read-only reconciliation operation can persist the same exact evidence.
 */
export function normalizeQoo10ListingPublicationReadback(
  input: Qoo10ListingReadbackInput,
): Qoo10PublicationReadbackVerification {
  const remoteIdFormatVerified = /^\d{9,10}$/u.test(input.remoteId);
  const expectedLocaleVerified = input.expectedLocale === "ja-JP";
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expectedFingerprint);
  const expectedImageCountVerified = Number.isInteger(input.expectedImageCount)
    && input.expectedImageCount >= 0
    && input.expectedImageCount <= 64;
  const strict = input.expectedCreate;
  const recovery = input.expectedRecovery;
  const recoveryExpectationVerified = !recovery
    || (input.operation === "listing.update"
      && expectedImageCountVerified
      && validRollbackRecoveryExpectation(recovery, input.expectedImageCount));
  const sellerAccountIdentityVerified = !strict
    || /^[a-f0-9]{64}$/u.test(input.expectedSellerAccountIdentityDigest ?? "");
  const matches = remoteIdFormatVerified
    ? matchingItems(input.resultObject, input.remoteId)
    : [];
  const identityVerified = remoteIdFormatVerified && matches.length === 1;
  const item = identityVerified ? matches[0] : {};
  const itemStatus = exactText(item, ["ItemStatus", "Status"]);
  const visibility = visibilityForStatus(itemStatus);
  const sellerCode = exactText(item, ["SellerCode"]);
  const detailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const itemTitle = exactText(item, ["ItemTitle"]);
  const imageCount = detailImageCount(detailHtml);
  const statusVerified = Boolean(visibility);
  const sellerCodeVerified = !input.expectedSellerCode || sellerCode === input.expectedSellerCode;
  const localeVerified = expectedLocaleVerified
    && japaneseLocaleVerified(`${itemTitle}\n${detailHtml}`);
  const imageCountVerified = expectedImageCountVerified
    && (input.expectedImageCount === 0 || imageCount === input.expectedImageCount);
  const categoryCode = exactText(item, ["SecondSubCat", "SecondSubCatCd", "CategoryCode", "CateSCode"]);
  const categoryVerified = (!strict || categoryCode === strict.categoryCode)
    && (!recovery || (recoveryExpectationVerified && categoryCode === recovery.categoryCode));
  const titleVerified = !strict || itemTitle === strict.itemTitle;
  const shippingNo = exactText(item, ["ShippingNo", "ShippingNO", "DeliveryGroupNo"]);
  const shippingVerified = (!strict || shippingNo === strict.shippingNo)
    && (!recovery || (recoveryExpectationVerified && shippingNo === recovery.shippingNo));
  const sellPrice = exactJpyInteger(item, ["SellPrice", "ItemPrice"]);
  const retailPrice = exactJpyInteger(item, ["RetailPrice"]);
  const quantity = exactInteger(item, ["ItemQty", "Qty", "StockQty"]);
  const retailPriceVerified = !recovery
    || (recoveryExpectationVerified && retailPrice === recovery.retailPriceJpy);
  const sellPriceVerified = !recovery
    || (recoveryExpectationVerified && sellPrice === recovery.sellPriceJpy);
  const quantityVerified = !recovery
    || (recoveryExpectationVerified && quantity === recovery.quantity);
  const priceQuantityVerified = (!strict || (sellPrice === strict.price && quantity === strict.quantity))
    && retailPriceVerified
    && sellPriceVerified
    && quantityVerified;
  const standardImageUrl = exactText(item, ["ImageUrl", "StandardImage", "MainImageUrl"]);
  const representativeImageBinding = strict
    ? qoo10RepresentativeImageBinding({
        remoteImageUrl: standardImageUrl,
        sourceImageUrl: strict.standardImageUrl,
        ...(input.operation === "listing.create" && input.expectedRepresentativeImageContentId
          ? { expectedContentId: input.expectedRepresentativeImageContentId }
          : {}),
      })
    : null;
  const confirmedBiCdnImageVerified = !recovery
    || (recoveryExpectationVerified
      && qoo10RepresentativeImageBinding({
        remoteImageUrl: standardImageUrl,
        sourceImageUrl: "",
        expectedContentId: String(recovery.biContentsNo),
      }) === "set_new_goods_bi_contents_no");
  const representativeImageVerified = (!strict || Boolean(representativeImageBinding))
    && confirmedBiCdnImageVerified;
  const detailImageUrls = qoo10DetailImageUrls(detailHtml);
  const detailImageUrlsVerified = !recovery
    || (recoveryExpectationVerified && sameOrderedValues(detailImageUrls, recovery.detailImageUrls));
  const detailImageDigestVerified = (!strict || sameOrderedValues(detailImageUrls, strict.detailImageUrls))
    && detailImageUrlsVerified;
  const strictProjectionVerified = categoryVerified
    && titleVerified
    && shippingVerified
    && priceQuantityVerified
    && representativeImageVerified
    && detailImageDigestVerified;
  const checks = {
    identityVerified,
    statusVerified,
    sellerCodeVerified,
    localeVerified,
    fingerprintVerified,
    imageCountVerified,
    sellerAccountIdentityVerified,
    categoryVerified,
    titleVerified,
    shippingVerified,
    priceQuantityVerified,
    representativeImageVerified,
    detailImageDigestVerified,
    ...(recovery
      ? {
          recoveryExpectationVerified,
          retailPriceVerified,
          sellPriceVerified,
          quantityVerified,
          confirmedBiCdnImageVerified,
          detailImageUrlsVerified,
        }
      : {}),
  } satisfies Qoo10PublicationReadbackChecks;
  if (!Object.values(checks).every(Boolean) || !strictProjectionVerified || !visibility) {
    return { providerStatus: itemStatus, imageCount, checks };
  }

  const candidate = {
    verified: true,
    visibility,
    providerStatus: itemStatus,
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
    evidence: {
      version: strict
        ? "qoo10_get_item_detail_create_v3"
        : recovery
          ? "qoo10_get_item_detail_rollback_recovery_v1"
          : "qoo10_get_item_detail_v1",
      readbackMethod: "ItemsLookup.GetItemDetailInfo",
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      imageCountVerified: true,
      detailImageCount: imageCount,
      ...(strict
        ? {
            sellerAccountIdentityDigest: input.expectedSellerAccountIdentityDigest,
            categoryVerified: true,
            titleVerified: true,
            shippingVerified: true,
            priceQuantityVerified: true,
            currencyVerified: strict.context.currency === "JPY",
            priceSemanticsVerified: strict.context.market === "JP"
              && strict.context.currency === "JPY"
              && /^[A-Z]{3}$/u.test(strict.context.sourceCurrency)
              && strict.context.sourcePrice > 0,
            sourceCurrency: strict.context.sourceCurrency,
            sourcePrice: strict.context.sourcePrice,
            qapiPriceJpy: strict.price,
            representativeImageVerified: true,
            representativeImageDigest: strict.standardImageDigest,
            representativeImageBinding,
            representativeImageBindingVerified: true,
            ...(representativeImageBinding === "source_url_literal"
              ? { representativeImageSourceUrlLiteralVerified: true }
              : { representativeImageContentIdVerified: true }),
            detailImageDigestVerified: true,
            detailImageDigest: strict.detailImageDigest,
            publicationAssetDigestVerified: true,
            publicationAssetDigest: strict.publicationAssetDigest,
            detailImageUrlsVerified: true,
            officialMarket: "JP",
            officialCurrencySemantics: "JPY",
          }
        : {}),
      ...(recovery
        ? {
            recoveryExpectationVerified: true,
            categoryVerified: true,
            retailPriceVerified: true,
            sellPriceVerified: true,
            quantityVerified: true,
            shippingVerified: true,
            representativeImageVerified: true,
            representativeImageBinding: "set_new_goods_bi_contents_no",
            representativeImageBindingVerified: true,
            representativeImageContentIdVerified: true,
            detailImageDigestVerified: true,
            detailImageUrlsVerified: true,
            qapiRetailPriceJpy: recovery.retailPriceJpy,
            qapiSellPriceJpy: recovery.sellPriceJpy,
            qapiQuantity: recovery.quantity,
          }
        : {}),
    },
    resources: {
      itemCode: input.remoteId,
      ...(sellerCode ? { sellerCode } : {}),
      market: "JP",
      ...(strict
        ? {
            categoryCode: strict.categoryCode,
            shippingNo: strict.shippingNo,
            standardImageDigest: strict.standardImageDigest,
            representativeImageBinding,
            ...(representativeImageBinding === "set_new_goods_bi_contents_no"
              ? { qoo10MainImageContentId: input.expectedRepresentativeImageContentId }
              : {}),
          }
        : {}),
      ...(recovery
        ? {
            categoryCode: recovery.categoryCode,
            shippingNo: recovery.shippingNo,
            qoo10MainImageContentId: String(recovery.biContentsNo),
            representativeImageBinding: "set_new_goods_bi_contents_no",
          }
        : {}),
    },
    locale: input.expectedLocale,
    fingerprint: input.expectedFingerprint,
    imageCount,
  } satisfies VerifiedListingRemoteState;
  const parsed = verifiedListingRemoteStateSchema.safeParse(candidate);
  return {
    providerStatus: itemStatus,
    imageCount,
    checks,
    ...(parsed.success ? { remoteState: parsed.data } : {}),
  };
}

/** Backwards-compatible verified-state projection for existing callers. */
export function qoo10VerifiedListingRemoteState(
  input: Qoo10ListingReadbackInput,
): VerifiedListingRemoteState | null {
  return normalizeQoo10ListingPublicationReadback(input).remoteState ?? null;
}
