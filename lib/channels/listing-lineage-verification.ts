import { assertShopeeShopProfileTarget } from "./provider-account-identity";
import { assertLazadaActiveSellerLineage } from "./lazada-seller-lineage";
import {
  shopeeSgExistingAdoptionBinding,
  verifyShopeeSgExistingAdoptionReadback,
  type ShopeeSgExistingAdoptionEvidence,
} from "./shopee-sg-existing-adoption";
import { ebayAsqMarketplaceIdFromSiteCode } from "./ebay-asq";
import {
  ebayRequest,
  ebayTradingRequest,
  ebayTradingXmlEscape,
  ensureEbayAccessToken,
  ensureLazadaAccessToken,
  ensureShopeeAccessToken,
  lazadaRequest,
  qoo10Request,
  readStoredShopeeShopAccessToken,
  shopeeRequest,
  textValue,
  type CredentialRefreshSnapshot,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

export const providerListingReadbackEvidenceVersion = "provider_listing_readback_rebind_v1" as const;

export type ProviderListingLineageChannel = "qoo10" | "shopee" | "lazada" | "ebay";

type VerificationStatus = "verified" | "manual_required";

type SafeVerificationStep = {
  name: string;
  ok: boolean;
  status: number;
  data: Record<string, string | boolean | null>;
};

export type ProviderListingLineageEvidence = {
  expectedRemoteId: string;
  verifiedRemoteId: string | null;
  market: string;
  targetId: string;
  evidenceVersion: typeof providerListingReadbackEvidenceVersion;
  marketplaceSku?: string;
  providerResourceId?: string;
  shopeeAdoption?: ShopeeSgExistingAdoptionEvidence;
  reasonCode?: "EBAY_MARKETPLACE_SKU_MISSING" | "EBAY_OFFER_AMBIGUOUS";
};

export type ProviderListingLineageVerificationResult = {
  ok: true;
  channel: ProviderListingLineageChannel;
  operation: "listing.lineage.verify";
  verificationStatus: VerificationStatus;
  evidence: ProviderListingLineageEvidence;
  steps: SafeVerificationStep[];
  safeMessage: string;
};

type VerificationInput = {
  channel: ProviderListingLineageChannel;
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
  onExternalMutationStart?: () => void | Promise<void>;
  onCredentialRefresh?: (refresh: CredentialRefreshSnapshot) => void | Promise<void>;
};

export type VerificationDependencies = {
  ensureShopeeAccessToken: typeof ensureShopeeAccessToken;
  ensureLazadaAccessToken: typeof ensureLazadaAccessToken;
  ensureEbayAccessToken: typeof ensureEbayAccessToken;
  shopeeRequest: typeof shopeeRequest;
  lazadaRequest: typeof lazadaRequest;
  ebayRequest: typeof ebayRequest;
  ebayTradingRequest: typeof ebayTradingRequest;
  qoo10Request: typeof qoo10Request;
};

const defaultDependencies: VerificationDependencies = {
  ensureShopeeAccessToken,
  ensureLazadaAccessToken,
  ensureEbayAccessToken,
  shopeeRequest,
  lazadaRequest,
  ebayRequest,
  ebayTradingRequest,
  qoo10Request,
};

const safeIdentifierPattern = /^[^\p{Cc}\p{Cf}]{1,240}$/u;

function requiredIdentifier(source: Record<string, unknown>, key: string, maxLength = 240) {
  const value = typeof source[key] === "string" || typeof source[key] === "number"
    ? String(source[key]).trim()
    : "";
  if (!value || value.length > maxLength || !safeIdentifierPattern.test(value)) {
    throw new Error(`LISTING_LINEAGE_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function optionalIdentifier(source: Record<string, unknown>, key: string, maxLength = 240) {
  const value = source[key] === undefined || source[key] === null
    ? ""
    : String(source[key]).trim();
  if (!value) return "";
  if (value.length > maxLength || !safeIdentifierPattern.test(value)) {
    throw new Error(`LISTING_LINEAGE_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function parseArguments(channel: ProviderListingLineageChannel, source: Record<string, unknown>) {
  const expectedRemoteId = requiredIdentifier(source, "expectedRemoteId");
  // The legacy Qoo10 ledger predates market normalization and can contain an
  // empty market. Qoo10's account-scoped item lookup does not use a market or
  // target parameter, so preserve that exact empty snapshot for the DB
  // attestation instead of inventing "JP". Every other provider still
  // requires an explicit market identity.
  const market = channel === "qoo10"
    ? optionalIdentifier(source, "market", 40)
    : requiredIdentifier(source, "market", 40);
  // Legacy Qoo10/eBay listings can legitimately have no channel target. Keep
  // the exact ledger snapshot (including an empty string) in the evidence;
  // Shopee is the only verifier that requires targetId as its account identity.
  const targetId = optionalIdentifier(source, "targetId", 160);
  const marketplaceSku = optionalIdentifier(source, "marketplaceSku", 160);
  const providerResourceId = optionalIdentifier(source, "providerResourceId", 240);

  if (channel === "shopee" && (!/^\d+$/.test(expectedRemoteId) || !/^\d+$/.test(targetId))) {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:shopeeIdentity");
  }
  if (channel === "lazada" && (!/^\d+$/.test(expectedRemoteId) || !/^(my|sg|ph|th|vn|id)$/i.test(market))) {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:lazadaIdentity");
  }
  if (channel === "ebay" && !/^(?:EBAY_)?[A-Z0-9_]+$/.test(market.toUpperCase())) {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:ebayMarket");
  }
  if (channel === "qoo10" && market && market.toUpperCase() !== "JP") {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:qoo10Market");
  }

  return {
    expectedRemoteId,
    market: market.toUpperCase(),
    targetId,
    marketplaceSku,
    providerResourceId,
  };
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function objectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function successfulRemote(remote: RemoteResponse) {
  const error = textValue(remote.data, "error");
  const code = String(remote.data.code ?? "").trim().toUpperCase();
  return remote.response.ok && !error && (!code || ["0", "SUCCESS", "OK"].includes(code));
}

function throwIfTransientProviderReadback(remote: RemoteResponse, step: string) {
  const status = remote.response.status;
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    throw new Error(`LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR:${step}:${status}`);
  }
}

function baseEvidence(
  argumentsValue: ReturnType<typeof parseArguments>,
  includeEbayResources = false,
): ProviderListingLineageEvidence {
  return {
    expectedRemoteId: argumentsValue.expectedRemoteId,
    verifiedRemoteId: null,
    market: argumentsValue.market,
    targetId: argumentsValue.targetId,
    evidenceVersion: providerListingReadbackEvidenceVersion,
    ...(includeEbayResources && argumentsValue.marketplaceSku
      ? { marketplaceSku: argumentsValue.marketplaceSku }
      : {}),
    ...(includeEbayResources && argumentsValue.providerResourceId
      ? { providerResourceId: argumentsValue.providerResourceId }
      : {}),
  };
}

function safeStep(
  name: string,
  remote: RemoteResponse,
  ok: boolean,
  verification: string,
  data: Record<string, string | boolean | null> = {},
): SafeVerificationStep {
  return {
    name,
    ok,
    status: remote.response.status,
    data: { sellerpilotVerification: verification, ...data },
  };
}

function manualResult(
  input: VerificationInput,
  argumentsValue: ReturnType<typeof parseArguments>,
  reasonCode: ProviderListingLineageEvidence["reasonCode"],
  steps: SafeVerificationStep[] = [],
): ProviderListingLineageVerificationResult {
  return {
    ok: true,
    channel: input.channel,
    operation: "listing.lineage.verify",
    verificationStatus: "manual_required",
    evidence: { ...baseEvidence(argumentsValue, input.channel === "ebay"), reasonCode },
    steps,
    safeMessage: "원격 상품 계정을 자동으로 확정할 증거가 부족해 기존 상품 쓰기를 계속 차단했습니다.",
  };
}

async function verifyShopee(
  input: VerificationInput,
  argumentsValue: ReturnType<typeof parseArguments>,
  dependencies: VerificationDependencies,
): Promise<ProviderListingLineageVerificationResult> {
  const adoptionBinding = shopeeSgExistingAdoptionBinding(input.arguments);
  const adoptionPayload = adoptionBinding
    ? readStoredShopeeShopAccessToken(input.payload, argumentsValue.targetId)
    : null;
  if (adoptionBinding && !adoptionPayload) {
    throw new Error("SHOPEE_SG_EXISTING_ADOPTION_FRESH_OAUTH_REQUIRED");
  }
  const ensured = adoptionPayload
    ? { payload: adoptionPayload, refreshed: false as const, credentialExpiresAt: textValue(input.payload, "authorization_expires_at") || null }
    : await dependencies.ensureShopeeAccessToken(
        input.payload,
        input.environment,
        10 * 60 * 1000,
        argumentsValue.targetId,
        input.onExternalMutationStart,
        input.onCredentialRefresh,
        true,
      );
  const shopRemote = await dependencies.shopeeRequest({
    payload: ensured.payload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/shop/get_shop_info",
  });
  throwIfTransientProviderReadback(shopRemote, "shopeeShop");
  if (!successfulRemote(shopRemote)) throw new Error("LISTING_LINEAGE_PROVIDER_READBACK_FAILED:shopeeShop");
  assertShopeeShopProfileTarget(shopRemote.data, argumentsValue.targetId);

  const itemRemote = await dependencies.shopeeRequest({
    payload: ensured.payload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/product/get_item_base_info",
    query: new URLSearchParams({ item_id_list: argumentsValue.expectedRemoteId }),
  });
  const response = objectValue(itemRemote.data.response);
  throwIfTransientProviderReadback(itemRemote, "shopeeItem");
  const itemList = objectArray(response.item_list);
  const itemIdentities = new Set(itemList
    .map((item) => String(item.item_id ?? "").trim())
    .filter(Boolean));
  const matchingItems = itemList
    .filter((item) => String(item.item_id ?? "").trim() === argumentsValue.expectedRemoteId);
  if (!successfulRemote(itemRemote)
      || matchingItems.length !== 1
      || itemIdentities.size !== 1
      || !itemIdentities.has(argumentsValue.expectedRemoteId)) {
    throw new Error("LISTING_LINEAGE_REMOTE_ID_MISMATCH:shopee");
  }

  const adoptionEvidence = adoptionBinding
    ? verifyShopeeSgExistingAdoptionReadback({
        argumentsValue: input.arguments,
        credentialPayload: input.payload,
        shopRemoteData: shopRemote.data,
        itemRemoteData: itemRemote.data,
      })
    : null;
  if (adoptionBinding && !adoptionEvidence) {
    throw new Error("SHOPEE_SG_EXISTING_ADOPTION_READBACK_MISMATCH");
  }

  return {
    ok: true,
    channel: "shopee",
    operation: "listing.lineage.verify",
    verificationStatus: "verified",
    evidence: {
      ...baseEvidence(argumentsValue),
      verifiedRemoteId: argumentsValue.expectedRemoteId,
      ...(adoptionEvidence ? { shopeeAdoption: adoptionEvidence } : {}),
    },
    steps: [
      safeStep("seller-account-readback", shopRemote, true, "SHOPEE_SHOP_ID_VERIFIED", { targetId: argumentsValue.targetId }),
      safeStep("listing-lineage-readback", itemRemote, true, "SHOPEE_ITEM_ID_VERIFIED", { verifiedRemoteId: argumentsValue.expectedRemoteId }),
    ],
    safeMessage: "Shopee 판매점과 원격 상품 식별값을 정확히 재확인했습니다.",
  };
}

function qoo10ItemIdentities(value: unknown, depth = 0, found = new Set<string>()) {
  if (depth > 8 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) qoo10ItemIdentities(item, depth + 1, found);
    return found;
  }
  if (typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["itemcode", "gdno"].includes(key.toLowerCase())
        && (typeof item === "string" || typeof item === "number")) {
      const normalized = String(item).trim();
      if (normalized) found.add(normalized);
    }
    qoo10ItemIdentities(item, depth + 1, found);
  }
  return found;
}

async function verifyQoo10(
  input: VerificationInput,
  argumentsValue: ReturnType<typeof parseArguments>,
  dependencies: VerificationDependencies,
): Promise<ProviderListingLineageVerificationResult> {
  const itemRemote = await dependencies.qoo10Request({
    payload: input.payload,
    service: "ItemsLookup",
    method: "GetItemDetailInfo",
    version: "1.2",
    params: { ItemCode: argumentsValue.expectedRemoteId, SellerCode: "" },
  });
  const resultCode = String(itemRemote.data.ResultCode ?? "").trim();
  throwIfTransientProviderReadback(itemRemote, "qoo10Item");
  const identities = qoo10ItemIdentities(itemRemote.data.ResultObject);
  const verified = itemRemote.response.ok
    && (!resultCode || resultCode === "0")
    && identities.size === 1
    && identities.has(argumentsValue.expectedRemoteId);
  if (!verified) throw new Error("LISTING_LINEAGE_REMOTE_ID_MISMATCH:qoo10");

  return {
    ok: true,
    channel: "qoo10",
    operation: "listing.lineage.verify",
    verificationStatus: "verified",
    evidence: { ...baseEvidence(argumentsValue), verifiedRemoteId: argumentsValue.expectedRemoteId },
    steps: [safeStep("listing-lineage-readback", itemRemote, true, "QOO10_ITEM_CODE_VERIFIED", {
      verifiedRemoteId: argumentsValue.expectedRemoteId,
    })],
    safeMessage: "Qoo10 현재 판매자 API에서 원격 상품 식별값을 정확히 재확인했습니다.",
  };
}

function lazadaItemIds(data: Record<string, unknown>) {
  const found = new Set<string>();
  const topData = objectValue(data.data);
  const resultData = objectValue(objectValue(data.result).data);
  for (const container of [objectValue(topData.item), topData, objectValue(resultData.item), resultData]) {
    const value = container.item_id ?? container.itemId;
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) found.add(normalized);
    }
  }
  return found;
}

async function verifyLazada(
  input: VerificationInput,
  argumentsValue: ReturnType<typeof parseArguments>,
  dependencies: VerificationDependencies,
): Promise<ProviderListingLineageVerificationResult> {
  const ensured = await dependencies.ensureLazadaAccessToken(
    { ...input.payload, country: argumentsValue.market.toLowerCase() },
    72 * 60 * 60 * 1000,
    input.onExternalMutationStart,
    input.onCredentialRefresh,
    true,
  );
  if ((textValue(ensured.payload, "country") || "my").toLowerCase() !== argumentsValue.market.toLowerCase()) {
    throw new Error("LISTING_LINEAGE_MARKET_MISMATCH:lazada");
  }
  const sellerRemote = await dependencies.lazadaRequest({
    payload: ensured.payload,
    path: "/seller/get",
  });
  throwIfTransientProviderReadback(sellerRemote, "lazadaSeller");
  if (!successfulRemote(sellerRemote)) {
    throw new Error("LISTING_LINEAGE_PROVIDER_READBACK_FAILED:lazadaSeller");
  }
  const sellerLineage = assertLazadaActiveSellerLineage({
    credential: ensured.payload,
    remoteData: sellerRemote.data,
    country: argumentsValue.market,
    expectedSellerId: argumentsValue.targetId,
  });
  const itemRemote = await dependencies.lazadaRequest({
    payload: ensured.payload,
    path: "/product/item/get",
    params: { item_id: argumentsValue.expectedRemoteId },
  });
  const itemIdentities = lazadaItemIds(itemRemote.data);
  throwIfTransientProviderReadback(itemRemote, "lazadaItem");
  if (!successfulRemote(itemRemote)
      || itemIdentities.size !== 1
      || !itemIdentities.has(argumentsValue.expectedRemoteId)) {
    throw new Error("LISTING_LINEAGE_REMOTE_ID_MISMATCH:lazada");
  }
  const verifiedRemoteId = argumentsValue.expectedRemoteId;

  if (argumentsValue.marketplaceSku) {
    const data = objectValue(itemRemote.data.data);
    const nested = objectValue(data.item);
    const product = Object.keys(nested).length ? nested : data;
    const skuContainer = objectValue(product.Skus);
    const skus = objectArray(product.skus ?? skuContainer.Sku);
    const exactSkus = skus.filter((sku) =>
      String(sku.SellerSku ?? sku.seller_sku ?? "").trim() === argumentsValue.marketplaceSku);
    const activeStatuses = exactSkus.map((sku) =>
      String(sku.Status ?? sku.status ?? product.Status ?? product.status ?? "")
        .trim()
        .toUpperCase());
    if (skus.length !== 1
        || exactSkus.length !== 1
        || activeStatuses.some((status) => !["ACTIVE", "LIVE", "ONLINE"].includes(status))) {
      throw new Error("LISTING_LINEAGE_REMOTE_LIVE_SKU_MISMATCH:lazada");
    }
  }

  return {
    ok: true,
    channel: "lazada",
    operation: "listing.lineage.verify",
    verificationStatus: "verified",
    evidence: { ...baseEvidence(argumentsValue), verifiedRemoteId },
    steps: [
      safeStep("seller-account-readback", sellerRemote, true, "LAZADA_ACTIVE_SELLER_ID_VERIFIED", {
        market: argumentsValue.market.toLowerCase(),
        targetId: sellerLineage.sellerId,
      }),
      safeStep("listing-lineage-readback", itemRemote, true, "LAZADA_COUNTRY_ITEM_ID_VERIFIED", {
        market: argumentsValue.market.toLowerCase(),
        verifiedRemoteId,
      }),
    ],
    safeMessage: "Lazada 국가와 원격 상품 식별값을 정확히 재확인했습니다.",
  };
}

async function verifyEbay(
  input: VerificationInput,
  argumentsValue: ReturnType<typeof parseArguments>,
  dependencies: VerificationDependencies,
): Promise<ProviderListingLineageVerificationResult> {
  const configuredMarketplaceId = textValue(input.payload, "marketplace_id").trim().toUpperCase();
  const targetMarketplaceId = argumentsValue.targetId.trim().toUpperCase();
  const marketplaceId = targetMarketplaceId.startsWith("EBAY_")
    ? targetMarketplaceId
    : configuredMarketplaceId;
  const ledgerMarket = argumentsValue.market.replace(/^EBAY_/, "");
  if (!/^EBAY_[A-Z0-9_]+$/.test(marketplaceId)
      || marketplaceId.replace(/^EBAY_/, "") !== ledgerMarket) {
    throw new Error("LISTING_LINEAGE_MARKET_MISMATCH:ebay");
  }
  const ensured = await dependencies.ensureEbayAccessToken(
    { ...input.payload, marketplace_id: marketplaceId },
    input.environment,
    5 * 60 * 1000,
    input.onExternalMutationStart,
    input.onCredentialRefresh,
    true,
  );
  const getItemXml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(argumentsValue.expectedRemoteId)}</ItemID><OutputSelector>ItemID</OutputSelector><OutputSelector>SKU</OutputSelector><OutputSelector>Site</OutputSelector></GetItemRequest>`;
  const listingRemote = await dependencies.ebayTradingRequest({
    payload: ensured.payload,
    environment: input.environment,
    callName: "GetItem",
    marketplaceId,
    body: getItemXml,
  });
  throwIfTransientProviderReadback(listingRemote, "ebayTradingGetItem");
  const listingItem = objectValue(listingRemote.data.item);
  const discoveredSku = String(listingItem.sku ?? "").trim();
  let listingMarketplaceId = "";
  try {
    listingMarketplaceId = ebayAsqMarketplaceIdFromSiteCode(listingItem.site);
  } catch {
    // The exact listing site is part of the immutable tuple. An unknown or
    // mismatched site must never fall back to the credential default.
  }
  const listingIdentityVerified = successfulRemote(listingRemote)
    && ["Success", "Warning"].includes(String(listingRemote.data.Ack ?? ""))
    && String(listingItem.itemId ?? "").trim() === argumentsValue.expectedRemoteId
    && listingMarketplaceId === marketplaceId;
  const listingStep = safeStep(
    "listing-id-sku-readback",
    listingRemote,
    listingIdentityVerified && Boolean(discoveredSku),
    listingIdentityVerified && discoveredSku
      ? "EBAY_LISTING_ID_SKU_VERIFIED"
      : "EBAY_LISTING_ID_SKU_UNVERIFIED",
    {
      listingId: argumentsValue.expectedRemoteId,
      marketplaceId,
      marketplaceSkuPresent: Boolean(discoveredSku),
    },
  );
  if (!listingIdentityVerified) {
    throw new Error("LISTING_LINEAGE_REMOTE_ID_MISMATCH:ebayTrading");
  }
  if (!discoveredSku) {
    return manualResult(input, argumentsValue, "EBAY_MARKETPLACE_SKU_MISSING", [listingStep]);
  }
  if (argumentsValue.marketplaceSku && argumentsValue.marketplaceSku !== discoveredSku) {
    throw new Error("LISTING_LINEAGE_MARKETPLACE_SKU_MISMATCH:ebay");
  }
  const marketplaceSku = discoveredSku;
  const searchRemote = await dependencies.ebayRequest({
    payload: ensured.payload,
    environment: input.environment,
    method: "GET",
    path: "/sell/inventory/v1/offer",
    query: new URLSearchParams({ sku: marketplaceSku, limit: "25" }),
  });
  throwIfTransientProviderReadback(searchRemote, "ebayOfferSearch");
  if (!successfulRemote(searchRemote)) throw new Error("LISTING_LINEAGE_PROVIDER_READBACK_FAILED:ebaySearch");
  const exactOffers = objectArray(searchRemote.data.offers).filter((offer) =>
    String(offer.sku ?? "").trim() === marketplaceSku
    && String(offer.marketplaceId ?? "").trim().toUpperCase() === marketplaceId,
  );
  const selected = argumentsValue.providerResourceId
    ? exactOffers.filter((offer) => String(offer.offerId ?? "").trim() === argumentsValue.providerResourceId)
    : exactOffers;
  if (selected.length !== 1) {
    return manualResult(input, argumentsValue, "EBAY_OFFER_AMBIGUOUS", [
      listingStep,
      safeStep("offer-search-readback", searchRemote, true, "EBAY_EXACT_OFFER_NOT_UNIQUE", {
        exactOfferUnique: false,
      }),
    ]);
  }
  const providerResourceId = String(selected[0].offerId ?? "").trim();
  if (!providerResourceId) throw new Error("LISTING_LINEAGE_PROVIDER_RESOURCE_MISSING:ebay");
  const detailRemote = await dependencies.ebayRequest({
    payload: ensured.payload,
    environment: input.environment,
    method: "GET",
    path: `/sell/inventory/v1/offer/${encodeURIComponent(providerResourceId)}`,
  });
  throwIfTransientProviderReadback(detailRemote, "ebayOfferDetail");
  const detailListing = objectValue(detailRemote.data.listing);
  const verifiedRemoteId = String(detailListing.listingId ?? "").trim();
  const detailMatches = successfulRemote(detailRemote)
    && String(detailRemote.data.offerId ?? "").trim() === providerResourceId
    && String(detailRemote.data.sku ?? "").trim() === marketplaceSku
    && String(detailRemote.data.marketplaceId ?? "").trim().toUpperCase() === marketplaceId
    && verifiedRemoteId === argumentsValue.expectedRemoteId
    && String(detailRemote.data.status ?? "").trim().toUpperCase() === "PUBLISHED"
    && String(detailListing.listingStatus ?? "").trim().toUpperCase() === "ACTIVE";
  if (!detailMatches) throw new Error("LISTING_LINEAGE_REMOTE_ID_MISMATCH:ebay");

  const inventoryRemote = await dependencies.ebayRequest({
    payload: ensured.payload,
    environment: input.environment,
    method: "GET",
    path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(marketplaceSku)}`,
  });
  throwIfTransientProviderReadback(inventoryRemote, "ebayInventoryItem");
  if (!successfulRemote(inventoryRemote)) {
    throw new Error("LISTING_LINEAGE_PROVIDER_READBACK_FAILED:ebayInventory");
  }

  return {
    ok: true,
    channel: "ebay",
    operation: "listing.lineage.verify",
    verificationStatus: "verified",
    evidence: {
      ...baseEvidence(argumentsValue),
      verifiedRemoteId,
      marketplaceSku,
      providerResourceId,
    },
    steps: [
      listingStep,
      safeStep("offer-search-readback", searchRemote, true, "EBAY_SKU_OFFER_VERIFIED", {
        marketplaceSku,
        providerResourceId,
      }),
      safeStep("listing-lineage-readback", detailRemote, true, "EBAY_OFFER_LISTING_ID_VERIFIED", {
        verifiedRemoteId,
        providerResourceId,
      }),
      safeStep("inventory-item-lineage-readback", inventoryRemote, true, "EBAY_INVENTORY_SKU_VERIFIED", {
        marketplaceSku,
      }),
    ],
    safeMessage: "eBay SKU·offer·공개 상품 식별값을 정확히 교차 확인했습니다.",
  };
}

export async function executeProviderListingLineageVerification(
  input: VerificationInput,
  dependencies: VerificationDependencies = defaultDependencies,
): Promise<ProviderListingLineageVerificationResult> {
  const argumentsValue = parseArguments(input.channel, input.arguments);
  if (input.channel === "qoo10") return verifyQoo10(input, argumentsValue, dependencies);
  if (input.channel === "shopee") return verifyShopee(input, argumentsValue, dependencies);
  if (input.channel === "lazada") return verifyLazada(input, argumentsValue, dependencies);
  return verifyEbay(input, argumentsValue, dependencies);
}
