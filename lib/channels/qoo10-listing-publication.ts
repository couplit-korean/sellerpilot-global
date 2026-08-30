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
  verifiedAt?: Date;
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

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Converts one authoritative ItemsLookup.GetItemDetailInfo response into the
 * publication ledger contract. The helper performs no provider mutation, so a
 * later read-only reconciliation operation can reuse the same boundary.
 */
export function qoo10VerifiedListingRemoteState(
  input: Qoo10ListingReadbackInput,
): VerifiedListingRemoteState | null {
  if (!/^\d{9,10}$/u.test(input.remoteId)
      || input.expectedLocale !== "ja-JP"
      || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
      || !Number.isInteger(input.expectedImageCount)
      || input.expectedImageCount < 0
      || input.expectedImageCount > 64
      || (input.expectedCreate && !/^[a-f0-9]{64}$/u.test(input.expectedSellerAccountIdentityDigest ?? ""))) {
    return null;
  }
  const matches = matchingItems(input.resultObject, input.remoteId);
  if (matches.length !== 1) return null;
  const item = matches[0];
  const itemStatus = exactText(item, ["ItemStatus", "Status"]);
  const visibility = visibilityForStatus(itemStatus);
  const sellerCode = exactText(item, ["SellerCode"]);
  if (!visibility || (input.expectedSellerCode && sellerCode !== input.expectedSellerCode)) return null;

  const detailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const itemTitle = exactText(item, ["ItemTitle"]);
  const imageCount = detailImageCount(detailHtml);
  const localeVerified = japaneseLocaleVerified(`${itemTitle}\n${detailHtml}`);
  const imageCountVerified = input.expectedImageCount === 0 || imageCount === input.expectedImageCount;
  const strict = input.expectedCreate;
  const categoryVerified = !strict
    || exactText(item, ["SecondSubCat", "SecondSubCatCd", "CategoryCode", "CateSCode"]) === strict.categoryCode;
  const titleVerified = !strict || itemTitle === strict.itemTitle;
  const shippingVerified = !strict
    || exactText(item, ["ShippingNo", "DeliveryGroupNo"]) === strict.shippingNo;
  const priceQuantityVerified = !strict
    || (exactInteger(item, ["ItemPrice", "SellPrice"]) === strict.price
      && exactInteger(item, ["ItemQty", "Qty", "StockQty"]) === strict.quantity);
  const standardImageUrl = exactText(item, ["ImageUrl", "StandardImage", "MainImageUrl"]);
  const representativeImageVerified = !strict || standardImageUrl === strict.standardImageUrl;
  const detailImageUrls = qoo10DetailImageUrls(detailHtml);
  const detailImageDigestVerified = !strict
    || sameOrderedValues(detailImageUrls, strict.detailImageUrls);
  const strictProjectionVerified = categoryVerified
    && titleVerified
    && shippingVerified
    && priceQuantityVerified
    && representativeImageVerified
    && detailImageDigestVerified;
  if (!localeVerified || !imageCountVerified || !strictProjectionVerified) return null;

  const candidate = {
    verified: true,
    visibility,
    providerStatus: itemStatus,
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
    evidence: {
      version: strict ? "qoo10_get_item_detail_create_v2" : "qoo10_get_item_detail_v1",
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
            detailImageDigestVerified: true,
            detailImageDigest: strict.detailImageDigest,
            publicationAssetDigestVerified: true,
            publicationAssetDigest: strict.publicationAssetDigest,
            detailImageUrlsVerified: true,
            officialMarket: "JP",
            officialCurrencySemantics: "JPY",
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
          }
        : {}),
    },
    locale: input.expectedLocale,
    fingerprint: input.expectedFingerprint,
    imageCount,
  } satisfies VerifiedListingRemoteState;
  const parsed = verifiedListingRemoteStateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
