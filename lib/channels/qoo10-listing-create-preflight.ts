import { createHash } from "node:crypto";
import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
  parseListingPublicationAssetBinding,
} from "./listing-publication-content";
import type { RemoteResponse, SecretPayload } from "./protocols";

export const qoo10ListingCreateContextContract =
  "sellerpilot_qoo10_listing_create_context_v1" as const;

const qoo10DetailHtmlProviderMaximumBytes = 2_000_000_000;
const qoo10DetailHtmlTransportMaximumBytes = 120_000;
const qoo10PriceMaximum = 999_999_999;
const qoo10QuantityMaximum = 99_999_999;

type UnknownRecord = Record<string, unknown>;

export type Qoo10ListingCreateContext = {
  contract: typeof qoo10ListingCreateContextContract;
  productId: string;
  sku: string;
  sourceCurrency: string;
  sourcePrice: number;
  market: "JP";
  locale: "ja-JP";
  currency: "JPY";
  price: number;
  quantity: number;
};

export type Qoo10ListingCreateExpectation = {
  context: Qoo10ListingCreateContext;
  sellerIdDigest: string;
  testItemCode: string;
  sellerCode: string;
  itemTitle: string;
  categoryCode: string;
  price: number;
  quantity: number;
  shippingNo: string;
  standardImageUrl: string;
  standardImageDigest: string;
  detailImageUrls: string[];
  detailImageDigests: string[];
  detailImageDigest: string;
  publicationAssetDigest: string;
};

export type Qoo10ProviderPreflightStep = {
  name: string;
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
};

export type Qoo10ProviderPreflightResult = {
  ok: boolean;
  steps: Qoo10ProviderPreflightStep[];
  sellerAccountIdentityDigest?: string;
};

export type Qoo10ReadRequest = (input: {
  payload: SecretPayload;
  service: string;
  method: string;
  version?: string;
  params?: Record<string, string>;
}) => Promise<RemoteResponse>;

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function recordText(record: UnknownRecord, names: readonly string[]) {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  const value = Object.entries(record).find(([name]) => normalized.has(name.toLowerCase()))?.[1];
  return exactText(value);
}

function integer(value: unknown, minimum: number, maximum: number) {
  const normalized = exactText(value);
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function positiveAmount(value: unknown, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(exactText(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : null;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function safeCredentialText(payload: SecretPayload, name: string) {
  const value = payload[name];
  return typeof value === "string" ? value.trim() : "";
}

function canonicalNormalizedImage(value: unknown) {
  const text = exactText(value);
  if (!text || text.length > 200) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:"
        || !/^[a-z0-9-]+\.supabase\.(?:co|in)$/u.test(url.hostname)
        || url.port || url.username || url.password || url.search || url.hash) return null;
    const pathname = decodeURIComponent(url.pathname);
    const match = pathname.match(/^\/storage\/v1\/object\/public\/sellerpilot-marketplace\/normalized\/([0-9a-f]{2})\/([0-9a-f]{64})\.jpg$/u);
    if (!match || match[1] !== match[2].slice(0, 2)) return null;
    return { url: url.toString(), digest: match[2] };
  } catch {
    return null;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([a-f0-9]+);/giu, (match, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isSafeInteger(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match;
    })
    .replace(/&#(\d+);/gu, (match, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isSafeInteger(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match;
    })
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

export function qoo10DetailImageUrls(value: unknown) {
  const html = decodeHtml(exactText(value));
  const urls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/giu)) {
    const url = (match[1] ?? match[2] ?? "").trim();
    if (url) urls.push(url);
  }
  return urls;
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseCreateContext(value: unknown): Qoo10ListingCreateContext | null {
  const context = recordValue(value);
  if (!context
      || context.contract !== qoo10ListingCreateContextContract
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(exactText(context.productId))
      || !exactText(context.sku)
      || exactText(context.sku).length > 100
      || !/^[A-Z]{3}$/u.test(exactText(context.sourceCurrency).toUpperCase())
      || context.market !== "JP"
      || context.locale !== "ja-JP"
      || context.currency !== "JPY") return null;
  const sourcePrice = positiveAmount(context.sourcePrice, qoo10PriceMaximum);
  const price = integer(context.price, 1, qoo10PriceMaximum);
  const quantity = integer(context.quantity, 1, qoo10QuantityMaximum);
  if (sourcePrice === null || price === null || quantity === null) return null;
  return {
    contract: qoo10ListingCreateContextContract,
    productId: exactText(context.productId).toLowerCase(),
    sku: exactText(context.sku),
    sourceCurrency: exactText(context.sourceCurrency).toUpperCase(),
    sourcePrice,
    market: "JP",
    locale: "ja-JP",
    currency: "JPY",
    price,
    quantity,
  };
}

export function buildQoo10ListingCreateContext(input: {
  productId: unknown;
  product: unknown;
  manualFields: unknown;
  market: unknown;
  currency: unknown;
  price: unknown;
}) {
  const product = recordValue(input.product);
  const manualFields = recordValue(input.manualFields);
  const productId = exactText(input.productId).toLowerCase();
  if (!product || !manualFields || exactText(product.id).toLowerCase() !== productId) return null;
  return parseCreateContext({
    contract: qoo10ListingCreateContextContract,
    productId,
    sku: product.sku,
    sourceCurrency: manualFields.currency,
    sourcePrice: manualFields.sellingPrice,
    market: exactText(input.market).toUpperCase(),
    locale: "ja-JP",
    currency: exactText(input.currency).toUpperCase(),
    price: input.price,
    quantity: product.onHand,
  });
}

function activeHtmlRejected(html: string) {
  return /<(?:script|iframe|frame|object|embed|form|input|button|textarea|select|option|meta|link|base|svg|math)\b/iu.test(html)
    || /\bon[a-z]+\s*=/iu.test(html)
    || /(?:javascript|data|vbscript)\s*:/iu.test(html);
}

export function qoo10ListingCreateExpectation(input: {
  arguments: Record<string, unknown>;
  payload: SecretPayload;
}): { ok: true; expectation: Qoo10ListingCreateExpectation } | {
  ok: false;
  code: string;
  mismatchFields: string[];
} {
  const context = parseCreateContext(input.arguments.sellerpilotQoo10CreateContext);
  const params = recordValue(input.arguments.params);
  const binding = parseListingPublicationAssetBinding(input.arguments.sellerpilotPublicationAssetBinding);
  const sellerId = safeCredentialText(input.payload, "seller_id");
  const testItemCode = safeCredentialText(input.payload, "test_item_code");
  const sellerIdValid = sellerId.length > 0 && sellerId.length <= 160;
  if (!context || !params || !binding || binding.providerImageSurface !== "detail_content"
      || !sellerIdValid || !/^\d{9,10}$/u.test(testItemCode)) {
    return {
      ok: false,
      code: "QOO10_CREATE_CONTEXT_INVALID",
      mismatchFields: [
        ...(!context ? ["sellerpilotQoo10CreateContext"] : []),
        ...(!params ? ["params"] : []),
        ...(!binding || binding?.providerImageSurface !== "detail_content" ? ["sellerpilotPublicationAssetBinding"] : []),
        ...(!sellerIdValid ? ["credential.seller_id"] : []),
        ...(!/^\d{9,10}$/u.test(testItemCode) ? ["credential.test_item_code"] : []),
      ],
    };
  }

  const sellerCode = recordText(params, ["SellerCode"]);
  const itemTitle = recordText(params, ["ItemTitle"]);
  const categoryCode = recordText(params, ["SecondSubCat"]);
  const itemPrice = integer(recordText(params, ["ItemPrice"]), 1, qoo10PriceMaximum);
  const retailPrice = integer(recordText(params, ["RetailPrice"]), 1, qoo10PriceMaximum);
  const quantity = integer(recordText(params, ["ItemQty"]), 1, qoo10QuantityMaximum);
  const shippingNo = recordText(params, ["ShippingNo"]);
  const standardImage = canonicalNormalizedImage(recordText(params, ["StandardImage"]));
  const html = recordText(params, ["ItemDescription"]);
  const detailImageUrls = qoo10DetailImageUrls(html);
  const boundDetailUrls = binding.providerTransportImages.map((image) => image.publicUrl);
  const boundDetailDigests = binding.providerTransportImages.map((image) => image.contentSha256);
  const htmlImageIdentities = detailImageUrls.map(canonicalNormalizedImage);
  const industrialCode = recordText(params, ["IndustrialCode"]);
  const industrialCodeType = recordText(params, ["IndustrialCodeType"]);
  const productionPlaceType = recordText(params, ["ProductionPlaceType"]);
  const productionPlace = recordText(params, ["ProductionPlace"]);
  const productionPlaceVerified = productionPlaceType === "1"
    ? /^[A-Z][A-Z ]{2,49}$/u.test(productionPlace) && !/^[A-Z]{2}$/u.test(productionPlace)
    : productionPlaceType === "2"
      ? /^[A-Z]{2}$/u.test(productionPlace) && productionPlace !== "JP"
      : productionPlaceType === "3"
        ? productionPlace.length > 0 && productionPlace.length <= 50
          && !/[\p{Cc}\p{Script=Hangul}]/u.test(productionPlace)
        : false;
  const htmlBytes = Buffer.byteLength(html, "utf8");
  const normalizedDescription = normalizedListingPublicationText(html);
  const unsupportedCurrencyParameter = Object.keys(params)
    .some((name) => ["currency", "currencycode", "currencycd"].includes(name.toLowerCase()));
  const mismatches = [
    ...(input.arguments.publicationStateContract === "verified_remote_state_v1" ? [] : ["publicationStateContract"]),
    ...(input.arguments.publicationIntent === "live" ? [] : ["publicationIntent"]),
    ...(input.arguments.publicationExpectedLocale === "ja-JP" ? [] : ["publicationExpectedLocale"]),
    ...(input.arguments.publicationExpectedImageCount === 8 ? [] : ["publicationExpectedImageCount"]),
    ...(/^[a-f0-9]{64}$/u.test(exactText(input.arguments.publicationExpectedFingerprint))
      ? [] : ["publicationExpectedFingerprint"]),
    ...(sellerCode === context.sku && sellerCode.length <= 100 ? [] : ["SellerCode"]),
    ...(categoryCode.match(/^\d{9}$/u) ? [] : ["SecondSubCat"]),
    ...(itemTitle.length > 0 && itemTitle.length <= 100
      && listingPublicationLanguageVerified("ja-JP", itemTitle, "title") ? [] : ["ItemTitle"]),
    ...(params.AudultYN === undefined && recordText(params, ["AdultYN"]) === "N" ? [] : ["AdultYN"]),
    ...(!industrialCode || /^[JKIUEH]$/u.test(industrialCodeType) ? [] : ["IndustrialCodeType"]),
    ...(["1", "2", "3"].includes(productionPlaceType) ? [] : ["ProductionPlaceType"]),
    ...(productionPlaceVerified ? [] : ["ProductionPlace"]),
    ...(itemPrice === context.price ? [] : ["ItemPrice"]),
    ...(!unsupportedCurrencyParameter ? [] : ["QAPI.currencyParameter"]),
    ...(retailPrice !== null && itemPrice !== null && retailPrice >= itemPrice ? [] : ["RetailPrice"]),
    ...(quantity === context.quantity ? [] : ["ItemQty"]),
    ...(/^\d+$/u.test(shippingNo) ? [] : ["ShippingNo"]),
    ...(recordText(params, ["TaxRate"]).match(/^(?:S|10|8|0)$/u) ? [] : ["TaxRate"]),
    ...(recordText(params, ["ExpireDate"]).match(/^\d{4}-\d{2}-\d{2}$/u) ? [] : ["ExpireDate"]),
    ...(recordText(params, ["AvailableDateType"]) === "0" ? [] : ["AvailableDateType"]),
    ...(recordText(params, ["AvailableDateValue"]).match(/^\d{1,3}$/u) ? [] : ["AvailableDateValue"]),
    ...(standardImage ? [] : ["StandardImage"]),
    ...(htmlBytes > 0 && htmlBytes <= qoo10DetailHtmlTransportMaximumBytes
      && htmlBytes <= qoo10DetailHtmlProviderMaximumBytes ? [] : ["ItemDescription.bytes"]),
    ...(!activeHtmlRejected(html) ? [] : ["ItemDescription.activeHtml"]),
    ...(listingPublicationLanguageVerified("ja-JP", normalizedDescription, "description") ? [] : ["ItemDescription.locale"]),
    ...(detailImageUrls.length === 8 && htmlImageIdentities.every(Boolean)
      && sameOrderedValues(detailImageUrls, boundDetailUrls) ? [] : ["ItemDescription.detailImages"]),
    ...(standardImage && !boundDetailDigests.includes(standardImage.digest) ? [] : ["StandardImage.digestIndependence"]),
  ];
  if (mismatches.length || itemPrice === null || quantity === null || !standardImage) {
    return { ok: false, code: "QOO10_CREATE_PREWRITE_MISMATCH", mismatchFields: [...new Set(mismatches)] };
  }
  const detailImageDigest = digest(boundDetailDigests);
  return {
    ok: true,
    expectation: {
      context,
      sellerIdDigest: digest({ sellerId }),
      testItemCode,
      sellerCode,
      itemTitle,
      categoryCode,
      price: itemPrice,
      quantity,
      shippingNo,
      standardImageUrl: standardImage.url,
      standardImageDigest: standardImage.digest,
      detailImageUrls: boundDetailUrls,
      detailImageDigests: boundDetailDigests,
      detailImageDigest,
      publicationAssetDigest: digest({ representative: standardImage.digest, details: boundDetailDigests }),
    },
  };
}

function collectRecords(value: unknown, depth = 0, records: UnknownRecord[] = []) {
  if (depth > 8 || value === null || value === undefined) return records;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, depth + 1, records);
    return records;
  }
  const record = recordValue(value);
  if (!record) return records;
  records.push(record);
  for (const nested of Object.values(record)) collectRecords(nested, depth + 1, records);
  return records;
}

function responseAccepted(remote: RemoteResponse) {
  const code = remote.data.ResultCode ?? remote.data.ErrorCode;
  return remote.response.ok && (code === undefined || code === null || String(code) === "0");
}

function failedRemoteResponse(): RemoteResponse {
  return {
    response: new Response(null, { status: 503 }),
    text: "",
    data: { ResultCode: -9999 },
  };
}

async function settledRead(request: () => Promise<RemoteResponse>) {
  try {
    return await request();
  } catch {
    return failedRemoteResponse();
  }
}

function sellerIdentityVerification(remote: RemoteResponse, expectation: Qoo10ListingCreateExpectation) {
  const matches = collectRecords(remote.data.ResultObject)
    .filter((record) => recordText(record, ["ItemNo", "ItemCode", "GdNo"]) === expectation.testItemCode);
  const uniqueMatches = matches.filter((record, index) => matches.indexOf(record) === index);
  const sellerCode = uniqueMatches.length === 1 ? recordText(uniqueMatches[0], ["SellerCode"]) : "";
  const ok = responseAccepted(remote) && uniqueMatches.length === 1 && Boolean(sellerCode);
  const identityDigest = ok
    ? digest({
        sellerIdDigest: expectation.sellerIdDigest,
        testItemCode: expectation.testItemCode,
        testItemSellerCode: sellerCode,
      })
    : undefined;
  return {
    identityDigest,
    step: {
      name: "qoo10-account-item-identity-preflight",
      ok,
      status: remote.response.status,
      data: {
        sellerpilotVerification: ok
          ? "QOO10_ACCOUNT_BOUND_TEST_ITEM_VERIFIED"
          : "QOO10_ACCOUNT_BOUND_TEST_ITEM_UNVERIFIED",
        configuredSellerIdentityDigest: expectation.sellerIdDigest,
        testItemSuffix: expectation.testItemCode.slice(-6),
        exactItemMatchCount: uniqueMatches.length,
        sellerCodePresent: Boolean(sellerCode),
        ...(identityDigest ? { sellerAccountIdentityDigest: identityDigest } : {}),
      },
    } satisfies Qoo10ProviderPreflightStep,
  };
}

function categoryVerification(remote: RemoteResponse, expectation: Qoo10ListingCreateExpectation) {
  const matches = collectRecords(remote.data.ResultObject)
    .filter((record) => recordText(record, ["CATE_S_CD", "CateSCode", "SecondSubCat"]) === expectation.categoryCode);
  const leafRecords = matches.filter((record) => recordText(record, ["CATE_S_NM", "CateSName", "SecondSubCatName"]));
  const exact = leafRecords.length === 1 ? leafRecords[0] : null;
  const names = exact
    ? ["CATE_L_NM", "CATE_M_NM", "CATE_S_NM"].map((name) => recordText(exact, [name])).filter(Boolean)
    : [];
  const codes = exact
    ? ["CATE_L_CD", "CATE_M_CD", "CATE_S_CD"].map((name) => recordText(exact, [name])).filter(Boolean)
    : [];
  const ok = responseAccepted(remote) && Boolean(exact) && names.length === 3 && codes.length === 3;
  return {
    name: "qoo10-leaf-category-preflight",
    ok,
    status: remote.response.status,
    data: {
      sellerpilotVerification: ok ? "QOO10_LEAF_CATEGORY_VERIFIED" : "QOO10_LEAF_CATEGORY_UNVERIFIED",
      categoryCode: expectation.categoryCode,
      categoryPathDigest: ok ? digest({ codes, names }) : null,
      categoryDepth: names.length,
      exactLeafMatchCount: leafRecords.length,
    },
  } satisfies Qoo10ProviderPreflightStep;
}

function shippingVerification(remote: RemoteResponse, expectation: Qoo10ListingCreateExpectation) {
  const officialFreeShipping = expectation.shippingNo === "0";
  const groups = collectRecords(remote.data.ResultObject)
    .filter((record) => recordText(record, ["ShippingNo", "ShippingNO", "DeliveryGroupNo"]));
  const matches = groups.filter((record) => recordText(record, ["ShippingNo", "ShippingNO", "DeliveryGroupNo"]) === expectation.shippingNo);
  const type = matches.length === 1
    ? recordText(matches[0], ["DeliveryType", "ShippingType", "FeeType"]).toUpperCase()
    : "";
  const ok = responseAccepted(remote)
    && (officialFreeShipping || (matches.length === 1 && /^[XFMWDR]$/u.test(type)));
  return {
    name: "qoo10-shipping-setting-preflight",
    ok,
    status: remote.response.status,
    data: {
      sellerpilotVerification: ok ? "QOO10_SHIPPING_SETTING_VERIFIED" : "QOO10_SHIPPING_SETTING_UNVERIFIED",
      shippingNo: expectation.shippingNo,
      selectionMode: officialFreeShipping ? "official_free_shipping_0" : "seller_delivery_group",
      deliveryGroupCount: groups.length,
      exactShippingMatchCount: matches.length,
      ...(type ? { shippingType: type } : {}),
    },
  } satisfies Qoo10ProviderPreflightStep;
}

export async function runQoo10ListingCreateProviderPreflight(input: {
  payload: SecretPayload;
  expectation: Qoo10ListingCreateExpectation;
  request: Qoo10ReadRequest;
}): Promise<Qoo10ProviderPreflightResult> {
  const [sellerRemote, categoryRemote, shippingRemote] = await Promise.all([
    settledRead(() => input.request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: input.expectation.testItemCode, SellerCode: "" },
    })),
    settledRead(() => input.request({
      payload: input.payload,
      service: "CommonInfoLookup",
      method: "GetCatagoryListAll",
      params: { lang_cd: "JA" },
    })),
    settledRead(() => input.request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetSellerDeliveryGroupInfo",
      params: {},
    })),
  ]);
  const seller = sellerIdentityVerification(sellerRemote, input.expectation);
  const steps = [
    seller.step,
    categoryVerification(categoryRemote, input.expectation),
    shippingVerification(shippingRemote, input.expectation),
  ];
  const ok = steps.every((step) => step.ok) && Boolean(seller.identityDigest);
  return {
    ok,
    steps,
    ...(ok && seller.identityDigest ? { sellerAccountIdentityDigest: seller.identityDigest } : {}),
  };
}

export function qoo10SellerAccountIdentityDigestFromReadback(input: {
  remote: RemoteResponse;
  expectation: Qoo10ListingCreateExpectation;
}) {
  return sellerIdentityVerification(input.remote, input.expectation);
}
