import { createHash } from "node:crypto";
import {
  listingPublicationLanguageVerified,
  parseListingPublicationAssetBinding,
} from "./listing-publication-content";
import {
  shopeeExactGlobalCategoryPath,
  shopeeSgCableClipCategory,
  type ShopeeExactCategoryPath,
} from "./shopee-category-tree";

export {
  shopeeExactGlobalCategoryPath,
  shopeeGlobalLeafCategoryPaths,
  shopeeSgCableClipCategory,
  type ShopeeExactCategoryPath,
} from "./shopee-category-tree";

type UnknownRecord = Record<string, unknown>;

export const shopeeSgListingCreateContextContract =
  "sellerpilot_shopee_sg_listing_create_context_v1" as const;
export const shopeeSgPreparedCreateEvidenceContract =
  "sellerpilot_shopee_sg_prepared_create_evidence_v1" as const;

export const shopeeSgExactCreateIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  sku: "QA-20260823-CC-001",
  merchantId: "5511564",
  shopId: "1719148844",
  market: "SG",
});

export const coinbaseExchangeRateDocumentationUrl =
  "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates";
const coinbaseKrwExchangeRateEndpoint =
  "https://api.coinbase.com/v2/exchange-rates?currency=KRW";

export type ShopeeKrwSgdUsdRateEvidence = {
  krwPerSgd: number;
  krwPerUsd: number;
  fetchedAt: string;
  asOf: string;
  source: "Coinbase Data API";
  sourceUrl: typeof coinbaseExchangeRateDocumentationUrl;
  frequency: "minute-market";
};

export type ShopeeSgListingCreateContext = {
  contract: typeof shopeeSgListingCreateContextContract;
  productId: string;
  sku: string;
  sourceCurrency: "KRW";
  sourcePriceKrw: number;
  market: "SG";
  locale: "en-SG";
  targetId: string;
  targetCurrency: "SGD";
  targetPriceSgd: number;
  globalCurrency: "USD";
  globalPriceUsd: number;
  quantity: number;
  categoryId: string;
  categoryPath: string[];
  categoryConfirmedAt: string;
  rate: ShopeeKrwSgdUsdRateEvidence;
};

export type ShopeeSgListingCreateExpectation = {
  context: ShopeeSgListingCreateContext;
  representativeImageDigest: string;
  detailImageDigests: string[];
  publicationAssetDigest: string;
};

export type ShopeeSgPreparedCreateEvidence = {
  contract: typeof shopeeSgPreparedCreateEvidenceContract;
  expectationDigest: string;
  providerGlobalCategoryPath: ShopeeExactCategoryPath;
  providerLocalCategoryId: string;
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

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(exactText(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 999_999_999
    ? parsed
    : null;
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(exactText(value));
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 99_999_999
    ? parsed
    : null;
}

function exactIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalizedMoney(value: number) {
  return Math.ceil(value * 100) / 100;
}

export function shopeeSgdPriceFromKrw(sourcePriceKrw: number, krwPerSgd: number) {
  if (!Number.isFinite(sourcePriceKrw) || sourcePriceKrw <= 0
      || !Number.isFinite(krwPerSgd) || krwPerSgd <= 0) return null;
  return normalizedMoney(sourcePriceKrw / krwPerSgd);
}

export function shopeeUsdPriceFromKrw(sourcePriceKrw: number, krwPerUsd: number) {
  if (!Number.isFinite(sourcePriceKrw) || sourcePriceKrw <= 0
      || !Number.isFinite(krwPerUsd) || krwPerUsd <= 0) return null;
  return normalizedMoney(sourcePriceKrw / krwPerUsd);
}

function parseRateEvidence(value: unknown): ShopeeKrwSgdUsdRateEvidence | null {
  const rate = recordValue(value);
  const krwPerSgd = finitePositive(rate.krwPerSgd);
  const krwPerUsd = finitePositive(rate.krwPerUsd);
  const fetchedAt = exactIsoDate(rate.fetchedAt);
  const asOf = exactIsoDate(rate.asOf);
  if (krwPerSgd === null || krwPerUsd === null || !fetchedAt || !asOf
      || rate.source !== "Coinbase Data API"
      || rate.sourceUrl !== coinbaseExchangeRateDocumentationUrl
      || rate.frequency !== "minute-market") return null;
  return {
    krwPerSgd,
    krwPerUsd,
    fetchedAt,
    asOf,
    source: "Coinbase Data API",
    sourceUrl: coinbaseExchangeRateDocumentationUrl,
    frequency: "minute-market",
  };
}

export function shopeeSgListingCreateContextFromArguments(
  argumentsValue: UnknownRecord,
): ShopeeSgListingCreateContext | null {
  const value = recordValue(argumentsValue.sellerpilotShopeeSgCreateContext);
  const productId = exactText(value.productId).toLowerCase();
  const sku = exactText(value.sku);
  const sourcePriceKrw = finitePositive(value.sourcePriceKrw);
  const targetPriceSgd = finitePositive(value.targetPriceSgd);
  const globalPriceUsd = finitePositive(value.globalPriceUsd);
  const quantity = positiveInteger(value.quantity);
  const targetId = exactText(value.targetId);
  const categoryId = exactText(value.categoryId);
  const categoryPath = Array.isArray(value.categoryPath)
    ? value.categoryPath.map(exactText).filter(Boolean)
    : [];
  const categoryConfirmedAt = exactIsoDate(value.categoryConfirmedAt);
  const rate = parseRateEvidence(value.rate);
  if (value.contract !== shopeeSgListingCreateContextContract
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(productId)
      || !sku || sku.length > 100
      || value.sourceCurrency !== "KRW"
      || value.market !== "SG"
      || value.locale !== "en-SG"
      || !/^[1-9][0-9]{0,31}$/u.test(targetId)
      || value.targetCurrency !== "SGD"
      || value.globalCurrency !== "USD"
      || !/^[1-9][0-9]{0,31}$/u.test(categoryId)
      || categoryPath.length < 2 || categoryPath.length > 12
      || new Set(categoryPath).size !== categoryPath.length
      || !categoryConfirmedAt || !rate
      || sourcePriceKrw === null || targetPriceSgd === null
      || globalPriceUsd === null || quantity === null) return null;
  const declaredSgd = shopeeSgdPriceFromKrw(sourcePriceKrw, rate.krwPerSgd);
  const declaredUsd = shopeeUsdPriceFromKrw(sourcePriceKrw, rate.krwPerUsd);
  if (declaredSgd === null || declaredUsd === null
      || Math.abs(declaredSgd - targetPriceSgd) > 0.000_001
      || Math.abs(declaredUsd - globalPriceUsd) > 0.000_001) return null;
  const exactCreateSignalled = productId === shopeeSgExactCreateIdentity.productId
    || sku === shopeeSgExactCreateIdentity.sku;
  if (exactCreateSignalled && (
    productId !== shopeeSgExactCreateIdentity.productId
    || sku !== shopeeSgExactCreateIdentity.sku
    || targetId !== shopeeSgExactCreateIdentity.shopId
    || sourcePriceKrw !== 5_000
    || quantity !== 1
    || categoryId !== shopeeSgCableClipCategory.id
    || !sameOrderedValues(categoryPath, shopeeSgCableClipCategory.path)
  )) return null;
  return {
    contract: shopeeSgListingCreateContextContract,
    productId,
    sku,
    sourceCurrency: "KRW",
    sourcePriceKrw,
    market: "SG",
    locale: "en-SG",
    targetId,
    targetCurrency: "SGD",
    targetPriceSgd,
    globalCurrency: "USD",
    globalPriceUsd,
    quantity,
    categoryId,
    categoryPath,
    categoryConfirmedAt,
    rate,
  };
}

/**
 * Binds the exact QA create to the provider-selected merchant and shop
 * credentials. Request arguments cannot select a different provider account:
 * those identifiers are read only from the credentials selected by the
 * gateway immediately before provider access.
 */
export function assertShopeeSgExactCreateProviderBinding(input: {
  expectation: ShopeeSgListingCreateExpectation;
  merchantCredential: UnknownRecord;
  shopCredential: UnknownRecord;
}) {
  const { context } = input.expectation;
  const exactCreateSignalled = context.productId === shopeeSgExactCreateIdentity.productId
    || context.sku === shopeeSgExactCreateIdentity.sku;
  if (!exactCreateSignalled) return null;
  if (context.productId !== shopeeSgExactCreateIdentity.productId
      || context.sku !== shopeeSgExactCreateIdentity.sku
      || context.market !== shopeeSgExactCreateIdentity.market
      || context.targetId !== shopeeSgExactCreateIdentity.shopId
      || exactText(input.merchantCredential.merchant_id)
        !== shopeeSgExactCreateIdentity.merchantId
      || exactText(input.shopCredential.shop_id) !== shopeeSgExactCreateIdentity.shopId) {
    throw new Error("SHOPEE_SG_EXACT_CREATE_PROVIDER_BINDING_MISMATCH");
  }
  return shopeeSgExactCreateIdentity;
}

export function shopeeSgExactCreateRequested(argumentsValue: UnknownRecord) {
  const context = recordValue(argumentsValue.sellerpilotShopeeSgCreateContext);
  const body = recordValue(argumentsValue.body);
  const publish = recordValue(argumentsValue.publish);
  const item = recordValue(publish.item);
  return exactText(context.productId).toLowerCase() === shopeeSgExactCreateIdentity.productId
    || [context.sku, body.global_item_sku, item.item_sku]
      .some((value) => exactText(value) === shopeeSgExactCreateIdentity.sku);
}

/**
 * Detects an SG CREATE target from every server/provider-owned argument shape.
 * Any SG signal enables the strict contract so a missing or conflicting legacy
 * `country` field cannot downgrade an SG publication to the generic path.
 */
export function shopeeSgListingCreateRequested(argumentsValue: UnknownRecord) {
  const publish = recordValue(argumentsValue.publish);
  const context = recordValue(argumentsValue.sellerpilotShopeeSgCreateContext);
  const marketSignals = [
    argumentsValue.country,
    argumentsValue.market,
    argumentsValue.shop_region,
    argumentsValue.shopRegion,
    publish.shop_region,
    context.market,
  ];
  const localeSignals = [
    argumentsValue.publicationExpectedLocale,
    argumentsValue.locale,
    publish.locale,
    context.locale,
  ];
  const currencySignals = [
    argumentsValue.currency,
    argumentsValue.targetCurrency,
    publish.currency,
    context.targetCurrency,
  ];
  return marketSignals.some((value) => exactText(value).toUpperCase() === "SG")
    || localeSignals.some((value) => exactText(value).toLowerCase() === "en-sg")
    || currencySignals.some((value) => exactText(value).toUpperCase() === "SGD");
}

export async function loadAuthoritativeKrwSgdUsdRate(input: {
  signal: AbortSignal;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<ShopeeKrwSgdUsdRateEvidence> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(coinbaseKrwExchangeRateEndpoint, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(8_000)]),
  });
  const data = recordValue(recordValue(await response.json().catch(() => null)).data);
  const rates = recordValue(data.rates);
  const sgdPerKrw = finitePositive(rates.SGD);
  const usdPerKrw = finitePositive(rates.USD);
  if (!response.ok || data.currency !== "KRW" || sgdPerKrw === null || usdPerKrw === null) {
    throw new Error("SHOPEE_KRW_SGD_RATE_UNAVAILABLE");
  }
  const fetchedAt = (input.now ?? new Date()).toISOString();
  const asOf = exactIsoDate(response.headers.get("last-modified")) ?? fetchedAt;
  return {
    krwPerSgd: Number((1 / sgdPerKrw).toFixed(6)),
    krwPerUsd: Number((1 / usdPerKrw).toFixed(6)),
    fetchedAt,
    asOf,
    source: "Coinbase Data API",
    sourceUrl: coinbaseExchangeRateDocumentationUrl,
    frequency: "minute-market",
  };
}

export function buildShopeeSgListingCreateContext(input: {
  productId: unknown;
  product: unknown;
  manualFields: unknown;
  assignments: unknown;
  market: unknown;
  targetId: unknown;
  currency: unknown;
  rate: ShopeeKrwSgdUsdRateEvidence;
}) {
  const productId = exactText(input.productId).toLowerCase();
  const product = recordValue(input.product);
  const manual = recordValue(input.manualFields);
  const assignments = Array.isArray(input.assignments)
    ? input.assignments.map(recordValue).filter((row) => row.channel === "shopee"
      && exactText(row.market).toUpperCase() === "SG"
      && row.status === "confirmed")
    : [];
  if (exactText(product.id).toLowerCase() !== productId || assignments.length !== 1) return null;
  const assignment = assignments[0];
  const categoryPath = Array.isArray(assignment.categoryPath)
    ? assignment.categoryPath.map(exactText).filter(Boolean)
    : [];
  const rate = parseRateEvidence(input.rate);
  const sourcePriceKrw = finitePositive(manual.sellingPrice);
  const quantity = positiveInteger(product.onHand ?? manual.stock);
  if (!rate || sourcePriceKrw === null || quantity === null) return null;
  const targetPriceSgd = shopeeSgdPriceFromKrw(sourcePriceKrw, rate.krwPerSgd);
  const globalPriceUsd = shopeeUsdPriceFromKrw(sourcePriceKrw, rate.krwPerUsd);
  if (targetPriceSgd === null || globalPriceUsd === null) return null;
  return shopeeSgListingCreateContextFromArguments({
    sellerpilotShopeeSgCreateContext: {
      contract: shopeeSgListingCreateContextContract,
      productId,
      sku: product.sku,
      sourceCurrency: exactText(manual.currency).toUpperCase(),
      sourcePriceKrw,
      market: exactText(input.market).toUpperCase(),
      locale: "en-SG",
      targetId: exactText(input.targetId),
      targetCurrency: exactText(input.currency).toUpperCase(),
      targetPriceSgd,
      globalCurrency: "USD",
      globalPriceUsd,
      quantity,
      categoryId: assignment.categoryId,
      categoryPath,
      categoryConfirmedAt: assignment.confirmedAt,
      rate,
    },
  });
}

export function bindShopeeSgListingCreateArguments(
  argumentsValue: UnknownRecord,
  context: ShopeeSgListingCreateContext,
) {
  const next = structuredClone(argumentsValue);
  const body = recordValue(next.body);
  const publish = recordValue(next.publish);
  const item = recordValue(publish.item);
  next.globalProduct = true;
  next.country = "sg";
  next.shopId = context.targetId;
  next.sellerpilotShopeeSgCreateContext = context;
  next.body = {
    ...body,
    category_id: Number(context.categoryId),
    global_item_sku: context.sku,
    original_price: context.globalPriceUsd,
    normal_stock: context.quantity,
    seller_stock: [{ stock: context.quantity }],
  };
  next.publish = {
    ...publish,
    shop_id: Number(context.targetId),
    shop_region: "SG",
    item: {
      ...item,
      category_id: Number(context.categoryId),
      item_sku: context.sku,
      original_price: context.targetPriceSgd,
      normal_stock: context.quantity,
      seller_stock: [{ stock: context.quantity }],
    },
  };
  return next;
}

export function shopeeSgArgumentsForFingerprint(argumentsValue: UnknownRecord) {
  const next = structuredClone(argumentsValue);
  const context = recordValue(next.sellerpilotShopeeSgCreateContext);
  const rate = recordValue(context.rate);
  if (Object.keys(rate).length) {
    context.rate = {
      ...rate,
      fetchedAt: "sellerpilot-exchange-rate://request-time",
      asOf: "sellerpilot-exchange-rate://provider-time",
    };
  }
  return next;
}

function normalizedImage(value: unknown) {
  const text = exactText(value);
  try {
    const url = new URL(text);
    const match = decodeURIComponent(url.pathname).match(
      /^\/storage\/v1\/object\/public\/sellerpilot-marketplace\/(normalized\/([0-9a-f]{2})\/([0-9a-f]{64})\.jpg)$/u,
    );
    if (url.protocol !== "https:" || url.username || url.password || url.port
        || url.search || url.hash || !match || match[2] !== match[3].slice(0, 2)) return null;
    return { url: url.toString(), digest: match[3] };
  } catch {
    return null;
  }
}

function requestedStock(value: UnknownRecord) {
  const sellerStock = Array.isArray(value.seller_stock)
    ? recordValue(value.seller_stock[0])
    : {};
  return positiveInteger(sellerStock.stock ?? value.normal_stock);
}

export function shopeeSgListingCreateExpectation(
  argumentsValue: UnknownRecord,
): { ok: true; expectation: ShopeeSgListingCreateExpectation } | {
  ok: false;
  code: string;
  mismatchFields: string[];
} {
  const context = shopeeSgListingCreateContextFromArguments(argumentsValue);
  const body = recordValue(argumentsValue.body);
  const publish = recordValue(argumentsValue.publish);
  const item = recordValue(publish.item);
  const binding = parseListingPublicationAssetBinding(argumentsValue.sellerpilotPublicationAssetBinding);
  const imageUrls = Array.isArray(argumentsValue.imageUrls)
    ? argumentsValue.imageUrls.map(normalizedImage)
    : [];
  const details = binding?.providerTransportImages ?? [];
  const representative = imageUrls[0];
  const expectedDetailUrls = details.map((image) => image.publicUrl);
  const actualDetailUrls = imageUrls.slice(1).map((image) => image?.url ?? "");
  const itemName = exactText(item.item_name);
  const description = exactText(item.description);
  const mismatches = [
    ...(!context ? ["sellerpilotShopeeSgCreateContext"] : []),
    ...(argumentsValue.globalProduct === true ? [] : ["globalProduct"]),
    ...(exactText(argumentsValue.country).toLowerCase() === "sg" ? [] : ["country"]),
    ...(argumentsValue.publicationStateContract === "verified_remote_state_v1" ? [] : ["publicationStateContract"]),
    ...(argumentsValue.publicationIntent === "live" ? [] : ["publicationIntent"]),
    ...(argumentsValue.publicationExpectedLocale === "en-SG" ? [] : ["publicationExpectedLocale"]),
    ...(argumentsValue.publicationExpectedImageCount === 8 ? [] : ["publicationExpectedImageCount"]),
    ...(/^[a-f0-9]{64}$/u.test(exactText(argumentsValue.publicationExpectedFingerprint)) ? [] : ["publicationExpectedFingerprint"]),
    ...(!binding || binding.providerImageSurface !== "buyer_visible" ? ["sellerpilotPublicationAssetBinding"] : []),
    ...(imageUrls.length === 9 && imageUrls.every(Boolean) ? [] : ["imageUrls"]),
    ...(details.length === 8 && sameOrderedValues(actualDetailUrls, expectedDetailUrls) ? [] : ["detailImageUrls"]),
    ...(representative && !details.some((image) => image.contentSha256 === representative.digest)
      && new Set(imageUrls.map((image) => image?.digest)).size === 9 ? [] : ["representativeImage"]),
    ...(context && Number(body.category_id) === Number(context.categoryId) ? [] : ["body.category_id"]),
    ...(context && exactText(body.global_item_sku) === context.sku ? [] : ["body.global_item_sku"]),
    ...(context && finitePositive(body.original_price) === context.globalPriceUsd ? [] : ["body.original_price"]),
    ...(context && requestedStock(body) === context.quantity ? [] : ["body.stock"]),
    ...(context && exactText(publish.shop_id) === context.targetId ? [] : ["publish.shop_id"]),
    ...(exactText(publish.shop_region).toUpperCase() === "SG" ? [] : ["publish.shop_region"]),
    ...(context && Number(item.category_id) === Number(context.categoryId) ? [] : ["publish.item.category_id"]),
    ...(context && exactText(item.item_sku) === context.sku ? [] : ["publish.item.item_sku"]),
    ...(context && finitePositive(item.original_price) === context.targetPriceSgd ? [] : ["publish.item.original_price"]),
    ...(context && requestedStock(item) === context.quantity ? [] : ["publish.item.stock"]),
    ...(itemName && itemName.length <= 120
      && listingPublicationLanguageVerified("en-SG", itemName, "title") ? [] : ["publish.item.item_name"]),
    ...(description && description.length <= 3_000
      && listingPublicationLanguageVerified("en-SG", description, "description") ? [] : ["publish.item.description"]),
  ];
  if (mismatches.length || !context || !binding || !representative) {
    return { ok: false, code: "SHOPEE_SG_CREATE_PREWRITE_MISMATCH", mismatchFields: [...new Set(mismatches)] };
  }
  const detailImageDigests = details.map((image) => image.contentSha256);
  return {
    ok: true,
    expectation: {
      context,
      representativeImageDigest: representative.digest,
      detailImageDigests,
      publicationAssetDigest: digest({
        representative: representative.digest,
        details: detailImageDigests,
      }),
    },
  };
}

function shopeeSgExpectationDigest(expectation: ShopeeSgListingCreateExpectation) {
  return digest({
    context: expectation.context,
    representativeImageDigest: expectation.representativeImageDigest,
    detailImageDigests: expectation.detailImageDigests,
    publicationAssetDigest: expectation.publicationAssetDigest,
  });
}

export function buildShopeeSgPreparedCreateEvidence(input: {
  expectation: ShopeeSgListingCreateExpectation;
  providerGlobalCategoryPath: ShopeeExactCategoryPath;
  providerLocalCategoryId: string;
}): ShopeeSgPreparedCreateEvidence {
  return {
    contract: shopeeSgPreparedCreateEvidenceContract,
    expectationDigest: shopeeSgExpectationDigest(input.expectation),
    providerGlobalCategoryPath: structuredClone(input.providerGlobalCategoryPath),
    providerLocalCategoryId: input.providerLocalCategoryId,
  };
}

export function shopeeSgPreparedCreateExpectation(
  argumentsValue: UnknownRecord,
): { ok: true; expectation: ShopeeSgListingCreateExpectation } | {
  ok: false;
  code: string;
  mismatchFields: string[];
} {
  const context = shopeeSgListingCreateContextFromArguments(argumentsValue);
  const evidence = recordValue(argumentsValue.sellerpilotShopeeSgPreparedCreateEvidence);
  const evidencePath = recordValue(evidence.providerGlobalCategoryPath);
  const providerPath = recordValue(argumentsValue.sellerpilotProviderGlobalCategoryPath);
  const providerLocalCategoryId = exactText(argumentsValue.sellerpilotProviderLocalCategoryId);
  if (!context) {
    return {
      ok: false,
      code: "SHOPEE_SG_PREPARED_CREATE_EVIDENCE_INVALID",
      mismatchFields: ["sellerpilotShopeeSgCreateContext"],
    };
  }
  const reconstructed = structuredClone(argumentsValue);
  const publish = recordValue(reconstructed.publish);
  const item = recordValue(publish.item);
  reconstructed.publish = {
    ...publish,
    item: {
      ...item,
      category_id: Number(context.categoryId),
      item_sku: context.sku,
      normal_stock: context.quantity,
      seller_stock: [{ stock: context.quantity }],
    },
  };
  const parsed = shopeeSgListingCreateExpectation(reconstructed);
  const mismatches = [
    ...(!parsed.ok ? parsed.mismatchFields : []),
    ...(evidence.contract === shopeeSgPreparedCreateEvidenceContract ? [] : ["preparedEvidence.contract"]),
    ...(parsed.ok && exactText(evidence.expectationDigest) === shopeeSgExpectationDigest(parsed.expectation)
      ? [] : ["preparedEvidence.expectationDigest"]),
    ...(sameOrderedValues(
      Array.isArray(evidencePath.ids) ? evidencePath.ids.map(exactText).filter(Boolean) : [],
      Array.isArray(providerPath.ids) ? providerPath.ids.map(exactText).filter(Boolean) : [],
    ) ? [] : ["preparedEvidence.providerGlobalCategoryPath.ids"]),
    ...(sameOrderedValues(
      Array.isArray(evidencePath.names) ? evidencePath.names.map(exactText).filter(Boolean) : [],
      Array.isArray(providerPath.names) ? providerPath.names.map(exactText).filter(Boolean) : [],
    ) ? [] : ["preparedEvidence.providerGlobalCategoryPath.names"]),
    ...(exactText(evidencePath.leafId) === context.categoryId
      && exactText(providerPath.leafId) === context.categoryId
      ? [] : ["preparedEvidence.providerGlobalCategoryPath.leafId"]),
    ...(exactText(evidence.providerLocalCategoryId) === providerLocalCategoryId
      && /^[1-9][0-9]{0,31}$/u.test(providerLocalCategoryId)
      ? [] : ["preparedEvidence.providerLocalCategoryId"]),
  ];
  if (mismatches.length || !parsed.ok) {
    return {
      ok: false,
      code: "SHOPEE_SG_PREPARED_CREATE_EVIDENCE_INVALID",
      mismatchFields: [...new Set(mismatches)],
    };
  }
  return parsed;
}

export function assertShopeeSgCurrentPrice(input: {
  expectation: ShopeeSgListingCreateExpectation;
  authoritativeRate: ShopeeKrwSgdUsdRateEvidence;
  now?: Date;
}) {
  const { context } = input.expectation;
  const nowMs = (input.now ?? new Date()).getTime();
  const fetchedAtMs = new Date(context.rate.fetchedAt).getTime();
  if (fetchedAtMs > nowMs + 60_000 || nowMs - fetchedAtMs > 10 * 60 * 1_000) {
    throw new Error("SHOPEE_KRW_SGD_RATE_STALE");
  }
  const currentSgdValue = context.targetPriceSgd * input.authoritativeRate.krwPerSgd;
  const currentUsdValue = context.globalPriceUsd * input.authoritativeRate.krwPerUsd;
  const allowedKrwDrift = Math.max(1, context.sourcePriceKrw * 0.01);
  if (Math.abs(currentSgdValue - context.sourcePriceKrw) > allowedKrwDrift
      || Math.abs(currentUsdValue - context.sourcePriceKrw) > allowedKrwDrift) {
    throw new Error("SHOPEE_KRW_SGD_AUTHORITATIVE_RATE_MISMATCH");
  }
  return context;
}

export function shopeeSgExpectedCategoryPathVerified(
  remoteData: unknown,
  context: ShopeeSgListingCreateContext,
) {
  const path = shopeeExactGlobalCategoryPath(remoteData, context.categoryId);
  if (!path || !sameOrderedValues(path.names, context.categoryPath)) return null;
  if (context.sku === shopeeSgExactCreateIdentity.sku
      && (!sameOrderedValues(path.ids, shopeeSgCableClipCategory.ids)
        || !sameOrderedValues(path.names, shopeeSgCableClipCategory.path))) return null;
  return path;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function exactItem(value: unknown, listKey: string, idKey: string, id: string) {
  const response = recordValue(recordValue(value).response);
  const rows = arrayRecords(response[listKey]);
  const matches = rows.filter((row) => exactText(row[idKey]) === id);
  return matches.length === 1 ? matches[0] : null;
}

function exactMoney(value: unknown) {
  const amount = finitePositive(value);
  return amount === null ? null : normalizedMoney(amount);
}

function itemPrice(item: UnknownRecord) {
  const priceInfo = recordValue(item.price_info);
  return exactMoney(item.original_price ?? priceInfo.original_price ?? priceInfo.current_price);
}

function itemStock(item: UnknownRecord) {
  const stockInfo = recordValue(item.stock_info_v2);
  const summary = recordValue(stockInfo.summary_info);
  const direct = positiveInteger(summary.total_available_stock ?? item.normal_stock);
  if (direct !== null) return direct;
  const stockRows = arrayRecords(item.stock_info);
  if (!stockRows.length) return null;
  const values = stockRows.map((row) => positiveInteger(row.normal_stock));
  return values.every((value) => value !== null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
}

export function verifyShopeeSgListingCreateReadback(input: {
  argumentsValue: UnknownRecord;
  globalItemId: string;
  localItemId: string;
  shopId: string;
  localTransportVerified: boolean;
  globalRemoteData: UnknownRecord;
  publishedRemoteData: UnknownRecord;
  localRemoteData: UnknownRecord;
}) {
  const parsed = shopeeSgPreparedCreateExpectation(input.argumentsValue);
  if (!parsed.ok) {
    return {
      ok: false,
      checks: {
        requestVerified: false,
        localTransportVerified: input.localTransportVerified,
      },
    };
  }
  const context = parsed.expectation.context;
  const globalItem = exactItem(input.globalRemoteData, "global_item_list", "global_item_id", input.globalItemId);
  const localItem = exactItem(input.localRemoteData, "item_list", "item_id", input.localItemId);
  const publishedResponse = recordValue(recordValue(input.publishedRemoteData).response);
  const publishedItems = arrayRecords(publishedResponse.published_item);
  const links = publishedItems.filter((row) => exactText(row.shop_id) === input.shopId
    && exactText(row.item_id) === input.localItemId);
  const localCategoryId = exactText(input.argumentsValue.sellerpilotProviderLocalCategoryId);
  const checks = {
    requestVerified: true,
    localTransportVerified: input.localTransportVerified,
    shopVerified: input.shopId === context.targetId,
    linkageVerified: links.length === 1,
    globalIdentityVerified: Boolean(globalItem),
    globalCategoryVerified: Number(globalItem?.category_id) === Number(context.categoryId),
    globalSkuVerified: exactText(globalItem?.global_item_sku ?? globalItem?.item_sku) === context.sku,
    globalPriceVerified: itemPrice(globalItem ?? {}) === context.globalPriceUsd,
    globalStockVerified: itemStock(globalItem ?? {}) === context.quantity,
    localIdentityVerified: Boolean(localItem),
    localCategoryVerified: Boolean(localCategoryId)
      && Number(localItem?.category_id) === Number(localCategoryId),
    localSkuVerified: exactText(localItem?.item_sku ?? localItem?.seller_sku) === context.sku,
    localPriceVerified: itemPrice(localItem ?? {}) === context.targetPriceSgd,
    localStockVerified: itemStock(localItem ?? {}) === context.quantity,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    context,
    publicationAssetDigest: parsed.expectation.publicationAssetDigest,
  };
}
