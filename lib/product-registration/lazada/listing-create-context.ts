type UnknownRecord = Record<string, unknown>;

export const lazadaMyListingCreateContextContract =
  "lazada_my_listing_create_context_v1" as const;

export type LazadaMySellerMode = "standard" | "marketplace_ease";

export const lazadaMySellerModeEvidenceContract =
  "lazada_my_seller_mode_evidence_v1" as const;

export type LazadaMySellerModeEvidence = {
  contract: typeof lazadaMySellerModeEvidenceContract;
  market: "MY";
  sellerId: string;
  sellerMode: LazadaMySellerMode;
  verifiedAt: string;
  evidenceSource: "lazada-open-platform-seller-get";
};

export type LazadaMyListingCreateContext = {
  contract: typeof lazadaMyListingCreateContextContract;
  productId: string;
  sellerSku: string;
  sourceCurrency: "KRW";
  sourcePriceKrw: number;
  market: "MY";
  locale: "ms-MY";
  sellerId: string;
  targetCurrency: "MYR";
  targetPriceMyr: number;
  quantity: number;
  categoryId: string;
  categoryConfirmedAt: string;
  sellerMode: LazadaMySellerMode;
  sellerModeVerifiedAt: string;
  sellerModeEvidenceSource:
    | "lazada-seller-center"
    | "lazada-open-platform-support"
    | "lazada-open-platform-seller-get";
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function uuid(value: unknown) {
  const normalized = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(normalized)
    ? normalized
    : "";
}

function timestamp(value: unknown) {
  const normalized = text(value);
  const parsed = new Date(normalized);
  return normalized && !Number.isNaN(parsed.getTime())
    ? parsed.toISOString()
    : "";
}

function positiveAmount(value: unknown, precision: number) {
  const normalized = text(value);
  const parsed = Number(normalized);
  return new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`, "u").test(normalized)
    && Number.isFinite(parsed)
    && parsed > 0
    && parsed <= 999_999_999
    ? parsed
    : null;
}

function quantity(value: unknown) {
  const normalized = text(value);
  const parsed = Number(normalized);
  return /^\d+$/u.test(normalized)
    && Number.isSafeInteger(parsed)
    && parsed >= 0
    && parsed <= 99_999_999
    ? parsed
    : null;
}

function sellerSku(value: unknown) {
  const normalized = text(value);
  return normalized
    && normalized.length <= 100
    && !/["*^~<>/|\p{Cc}]/u.test(normalized)
    ? normalized
    : "";
}

function sellerMode(value: unknown): LazadaMySellerMode | null {
  return value === "standard" || value === "marketplace_ease" ? value : null;
}

function evidenceSource(value: unknown) {
  return value === "lazada-seller-center"
    || value === "lazada-open-platform-support"
    || value === "lazada-open-platform-seller-get"
    ? value
    : null;
}

export function parseLazadaMySellerModeEvidence(
  value: unknown,
): LazadaMySellerModeEvidence | null {
  const source = record(value);
  const normalizedSellerMode = sellerMode(source.sellerMode);
  const sellerId = text(source.sellerId);
  const verifiedAt = timestamp(source.verifiedAt);
  if (source.contract !== lazadaMySellerModeEvidenceContract
      || source.market !== "MY"
      || !/^\d+$/u.test(sellerId)
      || !normalizedSellerMode
      || !verifiedAt
      || source.evidenceSource !== "lazada-open-platform-seller-get") {
    return null;
  }
  return {
    contract: lazadaMySellerModeEvidenceContract,
    market: "MY",
    sellerId,
    sellerMode: normalizedSellerMode,
    verifiedAt,
    evidenceSource: "lazada-open-platform-seller-get",
  };
}

export function lazadaMySellerModeEvidenceFromProfile(input: {
  profile: unknown;
  expectedSellerId: unknown;
  verifiedAt: unknown;
}): LazadaMySellerModeEvidence | null {
  const profile = record(input.profile);
  const sellerId = text(profile.seller_id ?? profile.sellerId);
  const expectedSellerId = text(input.expectedSellerId);
  const officialMode = profile.marketplaceEaseMode === true
      || profile.marketplaceEaseMode === "true"
    ? "marketplace_ease"
    : profile.marketplaceEaseMode === false
        || profile.marketplaceEaseMode === "false"
      ? "standard"
      : null;
  if (!/^\d+$/u.test(expectedSellerId)
      || sellerId !== expectedSellerId
      || !officialMode) {
    return null;
  }
  return parseLazadaMySellerModeEvidence({
    contract: lazadaMySellerModeEvidenceContract,
    market: "MY",
    sellerId,
    sellerMode: officialMode,
    verifiedAt: input.verifiedAt,
    evidenceSource: "lazada-open-platform-seller-get",
  });
}

export function lazadaSellerProfileFromGatewayResult(result: unknown) {
  const root = record(result);
  const steps = Array.isArray(root.steps) ? root.steps : [];
  const first = record(steps[0]);
  const data = record(first.data);
  const nestedData = record(data.data);
  if (root.ok !== true
      || root.channel !== "lazada"
      || root.operation !== "shops.get"
      || steps.length !== 1
      || first.name !== "seller-info"
      || first.ok !== true
      || typeof first.status !== "number"
      || !Number.isInteger(first.status)
      || first.status < 200
      || first.status >= 300
      || text(data.code) !== "0"
      || (data.error !== undefined && data.error !== null && data.error !== "")
      || !Object.keys(nestedData).length) {
    return null;
  }
  return nestedData;
}

export function lazadaMySellerModeEvidenceFromGatewayResult(input: {
  result: unknown;
  expectedSellerId: unknown;
  verifiedAt: unknown;
}) {
  const profile = lazadaSellerProfileFromGatewayResult(input.result);
  if (!profile) return null;
  return lazadaMySellerModeEvidenceFromProfile({
    profile,
    expectedSellerId: input.expectedSellerId,
    verifiedAt: input.verifiedAt,
  });
}

export function parseLazadaMyListingCreateContext(
  value: unknown,
): LazadaMyListingCreateContext | null {
  const source = record(value);
  const productId = uuid(source.productId);
  const normalizedSellerSku = sellerSku(source.sellerSku);
  const sourcePriceKrw = positiveAmount(source.sourcePriceKrw, 2);
  const normalizedSellerMode = sellerMode(source.sellerMode);
  const targetPriceMyr = positiveAmount(
    source.targetPriceMyr,
    normalizedSellerMode === "marketplace_ease" ? 3 : 2,
  );
  const normalizedQuantity = quantity(source.quantity);
  const categoryId = text(source.categoryId);
  const sellerId = text(source.sellerId);
  const categoryConfirmedAt = timestamp(source.categoryConfirmedAt);
  const sellerModeVerifiedAt = timestamp(source.sellerModeVerifiedAt);
  const normalizedEvidenceSource = evidenceSource(source.sellerModeEvidenceSource);
  if (source.contract !== lazadaMyListingCreateContextContract
      || !productId
      || !normalizedSellerSku
      || source.sourceCurrency !== "KRW"
      || source.market !== "MY"
      || source.locale !== "ms-MY"
      || !/^\d+$/u.test(sellerId)
      || source.targetCurrency !== "MYR"
      || sourcePriceKrw === null
      || targetPriceMyr === null
      || normalizedQuantity === null
      || !/^\d+$/u.test(categoryId)
      || !categoryConfirmedAt
      || !normalizedSellerMode
      || !sellerModeVerifiedAt
      || !normalizedEvidenceSource) {
    return null;
  }
  return {
    contract: lazadaMyListingCreateContextContract,
    productId,
    sellerSku: normalizedSellerSku,
    sourceCurrency: "KRW",
    sourcePriceKrw,
    market: "MY",
    locale: "ms-MY",
    sellerId,
    targetCurrency: "MYR",
    targetPriceMyr,
    quantity: normalizedQuantity,
    categoryId,
    categoryConfirmedAt,
    sellerMode: normalizedSellerMode,
    sellerModeVerifiedAt,
    sellerModeEvidenceSource: normalizedEvidenceSource,
  };
}

export function buildLazadaMyListingCreateContext(input: {
  productId: unknown;
  product: unknown;
  manualFields: unknown;
  assignments: unknown;
  market: unknown;
  sellerId: unknown;
  currency: unknown;
  price: unknown;
  sellerModeEvidence: unknown;
}) {
  const productId = uuid(input.productId);
  const product = record(input.product);
  const manualFields = record(input.manualFields);
  const productSku = sellerSku(product.sku);
  const manualSku = sellerSku(manualFields.sellerSku);
  const productQuantity = quantity(product.onHand);
  const manualQuantity = quantity(manualFields.stock);
  const assignments = Array.isArray(input.assignments)
    ? input.assignments.map(record).filter((row) =>
      row.channel === "lazada"
      && text(row.environment).toLowerCase() === "production"
      && text(row.market).toUpperCase() === "MY"
      && row.status === "confirmed")
    : [];
  if (!productId
      || uuid(product.id) !== productId
      || !productSku
      || productSku !== manualSku
      || productQuantity === null
      || manualQuantity !== productQuantity
      || assignments.length !== 1) {
    return null;
  }
  const assignment = assignments[0];
  const officialMetadata = record(assignment.officialMetadata);
  const verifiedSellerMode = parseLazadaMySellerModeEvidence(input.sellerModeEvidence);
  if (!verifiedSellerMode
      || verifiedSellerMode.sellerId !== text(input.sellerId)
      || (officialMetadata.sellerMode !== undefined
        && officialMetadata.sellerMode !== verifiedSellerMode.sellerMode)) {
    return null;
  }
  return parseLazadaMyListingCreateContext({
    contract: lazadaMyListingCreateContextContract,
    productId,
    sellerSku: productSku,
    sourceCurrency: text(manualFields.currency).toUpperCase(),
    sourcePriceKrw: manualFields.sellingPrice,
    market: text(input.market).toUpperCase(),
    locale: "ms-MY",
    sellerId: input.sellerId,
    targetCurrency: text(input.currency).toUpperCase(),
    targetPriceMyr: input.price,
    quantity: productQuantity,
    categoryId: assignment.categoryId,
    categoryConfirmedAt: assignment.confirmedAt,
    sellerMode: verifiedSellerMode.sellerMode,
    sellerModeVerifiedAt: verifiedSellerMode.verifiedAt,
    sellerModeEvidenceSource: verifiedSellerMode.evidenceSource,
  });
}

function productFromArguments(value: UnknownRecord) {
  return record(record(record(value.request).Request).Product);
}

function skuRows(product: UnknownRecord) {
  const rows = record(product.Skus).Sku;
  return Array.isArray(rows) ? rows.map(record) : [];
}

export function bindLazadaMyListingCreateContext(
  argumentsValue: UnknownRecord,
  contextValue: LazadaMyListingCreateContext,
) {
  const context = parseLazadaMyListingCreateContext(contextValue);
  if (!context) throw new Error("LAZADA_MY_CREATE_CONTEXT_INVALID");
  const next = structuredClone(argumentsValue);
  const product = productFromArguments(next);
  const skus = skuRows(product);
  if (!Object.keys(product).length || skus.length !== 1) {
    throw new Error("LAZADA_MY_CREATE_SINGLE_CANONICAL_SKU_REQUIRED");
  }
  const sku = skus[0];
  product.PrimaryCategory = context.categoryId;
  sku.SellerSku = context.sellerSku;
  sku.quantity = String(context.quantity);
  delete sku.Quantity;
  delete sku.special_price;
  delete sku.SpecialPrice;
  delete sku.special_from_date;
  delete sku.special_to_date;
  if (context.sellerMode === "standard") {
    sku.price = String(context.targetPriceMyr);
    delete sku.Price;
    delete sku.supply_price;
    delete sku.SupplyPrice;
  } else {
    sku.supply_price = String(context.targetPriceMyr);
    delete sku.SupplyPrice;
    delete sku.price;
    delete sku.Price;
  }
  next.country = "my";
  next.sellerpilotExpectedSellerId = context.sellerId;
  next.sellerpilotExpectedPrimaryCategory = context.categoryId;
  next.sellerpilotLazadaMyCreateContext = context;
  return next;
}

export function assertLazadaMyListingCreateContext(
  argumentsValue: UnknownRecord,
) {
  const context = parseLazadaMyListingCreateContext(
    argumentsValue.sellerpilotLazadaMyCreateContext,
  );
  if (!context
      || argumentsValue.country !== "my"
      || argumentsValue.sellerpilotExpectedSellerId !== context.sellerId
      || argumentsValue.sellerpilotExpectedPrimaryCategory !== context.categoryId) {
    throw new Error("LAZADA_MY_CREATE_CONTEXT_INVALID");
  }
  const product = productFromArguments(argumentsValue);
  const skus = skuRows(product);
  if (text(product.PrimaryCategory) !== context.categoryId || skus.length !== 1) {
    throw new Error("LAZADA_MY_CREATE_CONTEXT_MISMATCH");
  }
  const sku = skus[0];
  const requestedPrice = context.sellerMode === "standard"
    ? positiveAmount(sku.price ?? sku.Price, 2)
    : positiveAmount(sku.supply_price ?? sku.SupplyPrice, 3);
  if (sellerSku(sku.SellerSku) !== context.sellerSku
      || quantity(sku.quantity ?? sku.Quantity) !== context.quantity
      || requestedPrice !== context.targetPriceMyr
      || (context.sellerMode === "standard"
        ? sku.supply_price !== undefined || sku.SupplyPrice !== undefined
        : sku.price !== undefined || sku.Price !== undefined
          || sku.special_price !== undefined || sku.SpecialPrice !== undefined)) {
    throw new Error("LAZADA_MY_CREATE_CONTEXT_MISMATCH");
  }
  return context;
}
