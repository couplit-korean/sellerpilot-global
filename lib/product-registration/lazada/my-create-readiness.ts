import { createHash } from "node:crypto";
import {
  assertLazadaCreateSellerSkuAbsence,
  lazadaCreateSellerSkus,
} from "../../channels/lazada-create-preflight";
import { lazadaCategoryTreeLeaf } from "../../channels/lazada-listing-update";
import {
  lazadaAuthorizationUrl,
  lazadaCountryFromOAuthState,
} from "../../channels/lazada-my-contract";
import {
  assertLazadaKrwMyrPricePolicy,
  type LazadaKrwMyrRateEvidence,
} from "../../channels/lazada-price-policy";
import {
  normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity,
} from "../../channels/provider-account-identity";
import {
  normalizeLazadaListingPublicationReadback,
} from "../../channels/provider-lazada-publication-readback";
import type { RemoteResponse } from "../../channels/protocols";
import {
  assertLazadaActiveSellerLineage,
} from "../../channels/lazada-seller-lineage";
import {
  lazadaMySellerModeEvidenceFromGatewayResult,
  lazadaSellerProfileFromGatewayResult,
} from "./listing-create-context";
import { assertLazadaMyListingCreateContext } from "./listing-create-context";
import { assertLazadaMyCreateMetadata } from "./my-create-contract";
import {
  assertLazadaMyCreateCurrentSource,
  assertLazadaMyCreateOfficialEvidence,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "./my-create-raw-readback";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreateReadinessContract =
  "lazada_my_create_readiness_v1" as const;
export const lazadaMyEnglishContentApprovalContract =
  "lazada_my_english_content_approval_v1" as const;
export const lazadaMyDeliveryPolicyContract =
  "lazada_my_delivery_policy_v1" as const;
export const lazadaMyReturnPolicyContract =
  "lazada_my_return_policy_v1" as const;
export const lazadaMyRequiredCommerceScopes = [
  "Product Management",
  "Product Information",
  "Price Stock",
  "Catalogue",
  "Seller Information",
] as const;

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

function timestamp(value: unknown) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return normalized && Number.isFinite(parsed) ? parsed : null;
}

function accepted(value: unknown) {
  const root = record(value);
  return text(root.code) === "0" && !text(root.error);
}

function productFromArguments(argumentsValue: UnknownRecord) {
  return record(record(record(argumentsValue.request).Request).Product);
}

function skuRows(argumentsValue: UnknownRecord) {
  const value = record(productFromArguments(argumentsValue).Skus).Sku;
  return Array.isArray(value) ? value.map(record) : [];
}

function exactIso(value: unknown) {
  const parsed = timestamp(value);
  return parsed === null ? "" : new Date(parsed).toISOString();
}

function requireFreshEvidence(verifiedAt: unknown, credentialRotatedAt: unknown) {
  const verified = timestamp(verifiedAt);
  const rotated = timestamp(credentialRotatedAt);
  if (verified === null || rotated === null || verified < rotated) {
    throw new Error("LAZADA_MY_CREATE_POLICY_EVIDENCE_STALE");
  }
  return new Date(verified).toISOString();
}

function contentFields(argumentsValue: UnknownRecord) {
  const attributes = record(productFromArguments(argumentsValue).Attributes);
  return {
    name: text(attributes.name),
    description: text(attributes.description),
    shortDescription: text(attributes.short_description),
  };
}

export function lazadaMyEnglishContentSha256(argumentsValue: UnknownRecord) {
  const content = contentFields(argumentsValue);
  return createHash("sha256")
    .update(JSON.stringify([content.name, content.description, content.shortDescription]))
    .digest("hex");
}

function assertEnglishContentApproval(input: {
  argumentsValue: UnknownRecord;
  approval: unknown;
  credentialId: string;
  sellerId: string;
  credentialRotatedAt: string;
}) {
  const approval = record(input.approval);
  const content = contentFields(input.argumentsValue);
  if (!content.name || !content.description
      || approval.contract !== lazadaMyEnglishContentApprovalContract
      || approval.credentialId !== input.credentialId
      || approval.market !== "MY"
      || approval.sellerId !== input.sellerId
      || approval.languageCode !== "en_US"
      || approval.contentSha256 !== lazadaMyEnglishContentSha256(input.argumentsValue)
      || approval.approvedForCreate !== true) {
    throw new Error("LAZADA_MY_ENGLISH_CONTENT_APPROVAL_REQUIRED");
  }
  return requireFreshEvidence(approval.approvedAt, input.credentialRotatedAt);
}

function brandRows(value: unknown) {
  const data = record(record(value).data);
  for (const candidate of [data.module, data.brands, data.items]) {
    if (Array.isArray(candidate)) return candidate.map(record);
  }
  return [];
}

function assertBrandCatalog(argumentsValue: UnknownRecord, response: unknown) {
  if (!accepted(response)) throw new Error("LAZADA_MY_BRAND_CATALOG_REQUIRED");
  const attributes = record(productFromArguments(argumentsValue).Attributes);
  const brand = text(attributes.brand);
  const brandId = text(attributes.brand_id);
  if (!brandId && brand.toLowerCase() === "no brand") return "No Brand";
  if (!/^\d+$/u.test(brandId)) {
    throw new Error("LAZADA_MY_BRAND_ID_REQUIRED");
  }
  const match = brandRows(response).find((row) =>
    text(row.brand_id ?? row.brandId ?? row.id) === brandId);
  if (!match) throw new Error("LAZADA_MY_BRAND_ID_NOT_IN_CATALOG");
  const officialName = text(match.name ?? match.brand_name ?? match.brandName);
  if (brand && officialName && brand !== officialName) {
    throw new Error("LAZADA_MY_BRAND_NAME_MISMATCH");
  }
  return brandId;
}

function enabledDeliveryOptions(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function assertDeliveryAndReturnPolicy(input: {
  argumentsValue: UnknownRecord;
  shipmentProviders: unknown;
  deliveryPolicy: unknown;
  returnPolicy: unknown;
  credentialId: string;
  sellerId: string;
  credentialRotatedAt: string;
}) {
  const delivery = record(input.deliveryPolicy);
  const returns = record(input.returnPolicy);
  const attributes = record(productFromArguments(input.argumentsValue).Attributes);
  const deliveryOption = text(delivery.deliveryOption).toLowerCase();
  const deliveryOptionSof = delivery.deliveryOptionSof === "Yes" ? "Yes"
    : delivery.deliveryOptionSof === "No" ? "No" : "";
  if (!accepted(input.shipmentProviders)
      || delivery.contract !== lazadaMyDeliveryPolicyContract
      || delivery.credentialId !== input.credentialId
      || delivery.market !== "MY"
      || delivery.sellerId !== input.sellerId
      || delivery.approvedForCreate !== true
      || !text(delivery.shipmentProvider)
      || !["economy", "standard", "express"].includes(deliveryOption)
      || !deliveryOptionSof
      || text(attributes.delivery_option_sof) !== deliveryOptionSof) {
    throw new Error("LAZADA_MY_DELIVERY_POLICY_REQUIRED");
  }
  const providers = record(record(input.shipmentProviders).data).shipment_providers;
  const providerRows = Array.isArray(providers) ? providers.map(record) : [];
  const provider = providerRows.find((row) =>
    text(row.name) === text(delivery.shipmentProvider));
  if (!provider
      || !enabledDeliveryOptions(provider.enabled_delivery_options)
        .map((option) => option.toLowerCase())
        .includes(deliveryOption)) {
    throw new Error("LAZADA_MY_SHIPMENT_PROVIDER_MISMATCH");
  }
  if (returns.contract !== lazadaMyReturnPolicyContract
      || returns.credentialId !== input.credentialId
      || returns.market !== "MY"
      || returns.sellerId !== input.sellerId
      || returns.source !== "lazada-seller-center"
      || returns.approvedForCreate !== true
      || !text(returns.returnCondition)) {
    throw new Error("LAZADA_MY_RETURN_POLICY_REQUIRED");
  }
  return {
    shipmentProvider: text(delivery.shipmentProvider),
    deliveryOption,
    deliveryOptionSof,
    deliveryVerifiedAt: requireFreshEvidence(
      delivery.verifiedAt,
      input.credentialRotatedAt,
    ),
    returnVerifiedAt: requireFreshEvidence(
      returns.verifiedAt,
      input.credentialRotatedAt,
    ),
  };
}

function assertSellerSkuLookup(input: {
  lookup: {
    path: string;
    params: Record<string, string>;
    remote: RemoteResponse;
  };
  sellerSkus: string[];
}) {
  const params = input.lookup.params;
  let requested: unknown = null;
  try {
    requested = JSON.parse(params.sku_seller_list ?? "");
  } catch {
    requested = null;
  }
  if (input.lookup.path !== "/products/get"
      || params.filter !== "all"
      || params.options !== "1"
      || params.limit !== "50"
      || params.offset !== "0"
      || !Array.isArray(requested)
      || requested.length !== input.sellerSkus.length
      || requested.some((value, index) => value !== input.sellerSkus[index])) {
    throw new Error("LAZADA_MY_SELLER_SKU_LOOKUP_CONTRACT_INVALID");
  }
  return assertLazadaCreateSellerSkuAbsence(
    input.lookup.remote,
    input.sellerSkus,
  );
}

export type LazadaMyCreateReadinessInput = {
  expected: {
    appKey: string;
    appName: string;
    redirectUri: string;
    credentialId: string;
    sellerId: string;
    shortCode: string;
  };
  commerceApp: {
    appKey: string;
    appName: string;
    status: string;
    authorizationKind: string;
    scopes: string[];
    evidenceSource: string;
    verifiedAt: string;
  };
  authorization: {
    clientId: string;
    redirectUri: string;
    responseType: string;
    country: string;
    state: string;
  };
  callback: {
    clientId: string;
    redirectUri: string;
    country: string;
    state: string;
    credentialId: string;
  };
  scope: {
    uiCredentialId: string;
    routeCredentialId: string;
    workerCredentialId: string;
    operation: string;
    country: string;
    market: string;
  };
  credential: UnknownRecord;
  credentialRotatedAt: string;
  sellerGatewayResult: unknown;
  sellerVerifiedAt: string;
  target: {
    credentialId: string;
    targetId: string;
    shortCode: string;
    marketCode: string;
    locale: string;
    language: string;
    currency: string;
    verifiedAt: string;
  };
  argumentsValue: UnknownRecord;
  category: {
    treeRequest: { path: string; params: Record<string, string> };
    treeResponse: unknown;
    attributesRequest: { path: string; params: Record<string, string> };
    attributesResponse: unknown;
  };
  brandCatalog: unknown;
  sellerSkuLookup: {
    path: string;
    params: Record<string, string>;
    remote: RemoteResponse;
  };
  shipmentProviders: unknown;
  deliveryPolicy: unknown;
  returnPolicy: unknown;
  englishContentApproval: unknown;
  authoritativeRate: LazadaKrwMyrRateEvidence;
  now?: Date;
};

/**
 * Pure, fail-closed audit boundary for the MY CreateProduct journey. This
 * function performs no OAuth exchange, provider request, database mutation or
 * publication. Callers must supply the official read responses as evidence.
 */
export function assertLazadaMyCreateReadiness(
  input: LazadaMyCreateReadinessInput,
) {
  const expected = input.expected;
  const stateCountry = lazadaCountryFromOAuthState(input.authorization.state);
  const authorizationUrl = lazadaAuthorizationUrl({
    appKey: input.authorization.clientId,
    redirectUri: input.authorization.redirectUri,
    state: input.authorization.state,
  });
  if (!expected.appKey || !expected.redirectUri
      || input.authorization.clientId !== expected.appKey
      || input.callback.clientId !== expected.appKey
      || input.authorization.redirectUri !== expected.redirectUri
      || input.callback.redirectUri !== expected.redirectUri
      || input.authorization.responseType !== "code"
      || input.authorization.country !== "my"
      || input.callback.country !== "my"
      || stateCountry !== "my"
      || input.callback.state !== input.authorization.state
      || input.callback.credentialId !== expected.credentialId
      || authorizationUrl.searchParams.get("response_type") !== "code"
      || authorizationUrl.searchParams.get("country") !== "my") {
    throw new Error("LAZADA_MY_OAUTH_BINDING_INVALID");
  }
  const appScopes = new Set(input.commerceApp.scopes.map((scope) => scope.trim()));
  if (!expected.appName
      || input.commerceApp.appKey !== expected.appKey
      || input.commerceApp.appName !== expected.appName
      || input.commerceApp.status !== "Online"
      || input.commerceApp.authorizationKind !== "seller"
      || input.commerceApp.evidenceSource !== "lazada-open-platform-console"
      || !exactIso(input.commerceApp.verifiedAt)
      || lazadaMyRequiredCommerceScopes.some((scope) => !appScopes.has(scope))) {
    throw new Error("LAZADA_MY_COMMERCE_APP_SCOPE_INVALID");
  }
  if (input.scope.uiCredentialId !== expected.credentialId
      || input.scope.routeCredentialId !== expected.credentialId
      || input.scope.workerCredentialId !== expected.credentialId
      || input.scope.operation !== "listing.create"
      || input.scope.country !== "my"
      || input.scope.market !== "MY") {
    throw new Error("LAZADA_MY_CREATE_SCOPE_MISMATCH");
  }

  const identity = normalizeLazadaProviderAccountIdentity(input.credential);
  const storedIdentity = readProviderAccountIdentity(input.credential, "lazada");
  const myStore = identity.countryUserInfo.find((store) => store.country === "my");
  if (!storedIdentity || storedIdentity.subject !== identity.identity.subject
      || identity.accountPlatform !== "seller_center"
      || text(input.credential.app_key) !== expected.appKey
      || text(input.credential.country).toLowerCase() !== "my"
      || myStore?.seller_id !== expected.sellerId
      || myStore.short_code !== expected.shortCode) {
    throw new Error("LAZADA_MY_COMMERCE_CREDENTIAL_IDENTITY_MISMATCH");
  }
  const sellerProfile = lazadaSellerProfileFromGatewayResult(
    input.sellerGatewayResult,
  );
  const sellerModeEvidence = lazadaMySellerModeEvidenceFromGatewayResult({
    result: input.sellerGatewayResult,
    expectedSellerId: expected.sellerId,
    verifiedAt: input.sellerVerifiedAt,
  });
  if (!sellerProfile || !sellerModeEvidence
      || text(sellerProfile.short_code ?? sellerProfile.shortCode) !== expected.shortCode) {
    throw new Error("LAZADA_MY_SHOPS_GET_IDENTITY_MISMATCH");
  }
  assertLazadaActiveSellerLineage({
    credential: input.credential,
    remoteData: sellerProfile,
    country: "my",
    expectedSellerId: expected.sellerId,
  });
  const targetVerifiedAt = requireFreshEvidence(
    input.target.verifiedAt,
    input.credentialRotatedAt,
  );
  if (input.target.credentialId !== expected.credentialId
      || input.target.targetId !== expected.sellerId
      || input.target.shortCode !== expected.shortCode
      || input.target.marketCode !== "MY"
      || input.target.locale !== "ms-MY"
      || input.target.language !== "Bahasa Melayu"
      || input.target.currency !== "MYR") {
    throw new Error("LAZADA_MY_TARGET_IDENTITY_MISMATCH");
  }

  const context = assertLazadaMyListingCreateContext(input.argumentsValue);
  if (context.sellerId !== expected.sellerId
      || context.sellerMode !== sellerModeEvidence.sellerMode
      || timestamp(context.sellerModeVerifiedAt) !== timestamp(sellerModeEvidence.verifiedAt)) {
    throw new Error("LAZADA_MY_CREATE_CONTEXT_SELLER_MISMATCH");
  }
  const categoryId = context.categoryId;
  if (input.category.treeRequest.path !== "/category/tree/get"
      || input.category.treeRequest.params.language_code !== "en_US"
      || input.category.attributesRequest.path !== "/category/attributes/get"
      || input.category.attributesRequest.params.language_code !== "en_US"
      || input.category.attributesRequest.params.primary_category_id !== categoryId
      || !accepted(input.category.treeResponse)
      || !lazadaCategoryTreeLeaf(input.category.treeResponse, categoryId)
      || !accepted(input.category.attributesResponse)) {
    throw new Error("LAZADA_MY_ENGLISH_CATEGORY_CONTRACT_INVALID");
  }
  const metadata = assertLazadaMyCreateMetadata({
    argumentsValue: input.argumentsValue,
    categoryAttributes: input.category.attributesResponse,
    mode: context.sellerMode,
    imageStage: "provider",
  });
  if (metadata.productImageCount !== 8) {
    throw new Error("LAZADA_MY_CREATE_EXACT_EIGHT_IMAGES_REQUIRED");
  }
  const sellerSkus = lazadaCreateSellerSkus(input.argumentsValue);
  const skuAbsence = assertSellerSkuLookup({
    lookup: input.sellerSkuLookup,
    sellerSkus,
  });
  const brand = assertBrandCatalog(input.argumentsValue, input.brandCatalog);
  const pricePolicy = assertLazadaKrwMyrPricePolicy({
    argumentsValue: input.argumentsValue,
    authoritativeRate: input.authoritativeRate,
    priceField: context.sellerMode === "marketplace_ease"
      ? "supply_price"
      : "price",
    now: input.now,
  });
  const englishContentApprovedAt = assertEnglishContentApproval({
    argumentsValue: input.argumentsValue,
    approval: input.englishContentApproval,
    credentialId: expected.credentialId,
    sellerId: expected.sellerId,
    credentialRotatedAt: input.credentialRotatedAt,
  });
  const policy = assertDeliveryAndReturnPolicy({
    argumentsValue: input.argumentsValue,
    shipmentProviders: input.shipmentProviders,
    deliveryPolicy: input.deliveryPolicy,
    returnPolicy: input.returnPolicy,
    credentialId: expected.credentialId,
    sellerId: expected.sellerId,
    credentialRotatedAt: input.credentialRotatedAt,
  });

  return {
    contract: lazadaMyCreateReadinessContract,
    appKey: expected.appKey,
    appName: expected.appName,
    credentialId: expected.credentialId,
    sellerId: expected.sellerId,
    shortCode: expected.shortCode,
    market: "MY" as const,
    country: "my" as const,
    categoryLanguageCode: "en_US" as const,
    publicationLocale: context.locale,
    sellerMode: context.sellerMode,
    targetVerifiedAt,
    englishContentApprovedAt,
    categoryId,
    brand,
    sellerSkus,
    skuAbsence,
    productImageCount: metadata.productImageCount,
    targetPriceMyr: pricePolicy.targetPriceMyr,
    quantity: skuRows(input.argumentsValue).reduce(
      (sum, sku) => sum + Number(text(sku.quantity ?? sku.Quantity)),
      0,
    ),
    ...policy,
  };
}

function productImagesFromArguments(argumentsValue: UnknownRecord) {
  const product = productFromArguments(argumentsValue);
  const images = product.Images ?? product.images;
  const rows = Array.isArray(images)
    ? images
    : record(images).Image ?? record(images).image;
  return Array.isArray(rows) ? rows.map(text).filter(Boolean) : [];
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertLazadaMyCreateCompletion(input: {
  readiness: ReturnType<typeof assertLazadaMyCreateReadiness>;
  argumentsValue: UnknownRecord;
  createResponse?: unknown;
  itemReadback?: unknown;
  verifiedAt: string;
  officialEvidence: unknown;
  claimedCurrentSource: LazadaMyCreateCurrentSourceSnapshot;
  currentSource: LazadaMyCreateCurrentSourceSnapshot;
}) {
  if (input.readiness.contract !== lazadaMyCreateReadinessContract) {
    throw new Error("LAZADA_MY_CREATE_READINESS_REQUIRED");
  }
  if (input.officialEvidence == null) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED");
  }
  assertLazadaMyCreateCurrentSource({
    claimed: input.claimedCurrentSource,
    current: input.currentSource,
  });
  const content = contentFields(input.argumentsValue);
  const bound = assertLazadaMyCreateOfficialEvidence({
    evidence: input.officialEvidence,
    expectedSellerSkus: input.readiness.sellerSkus,
    expectedLocale: "ms-MY",
    expectedImageUrls: productImagesFromArguments(input.argumentsValue),
    expectedName: content.name,
    expectedDescription: content.description,
  });
  if (input.createResponse !== undefined
      && !sameJson(input.createResponse, bound.postBody)) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED");
  }
  if (input.itemReadback !== undefined
      && !sameJson(input.itemReadback, bound.itemBody)) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  }
  const expectedFingerprint = text(
    input.argumentsValue.publicationExpectedFingerprint,
  );
  const readback = normalizeLazadaListingPublicationReadback({
    operation: "listing.create",
    remoteId: bound.itemId,
    remoteData: bound.itemBody,
    mutationArguments: input.argumentsValue,
    market: "MY",
    expectedLocale: "ms-MY",
    expectedFingerprint,
    expectedImageCount: 8,
    verifiedAt: exactIso(input.verifiedAt),
  });
  const expectedVisibility = input.argumentsValue.publicationIntent === "safe_test"
    ? "non_public"
    : input.argumentsValue.publicationIntent === "live"
      ? "live"
      : "";
  const providerStatus = text(readback.providerStatus);
  const rawStatus = (providerStatus.split("|")[0] ?? "").toLowerCase();
  if (!readback.remoteState
      || readback.remoteState.visibility !== expectedVisibility
      || readback.remoteState.resources.itemId !== bound.itemId
      || readback.remoteState.resources.country !== "my"
      || !rawStatus
      || !bound.evidence.itemGetResponseBytes.toLowerCase().includes(rawStatus)) {
    throw new Error("LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE");
  }
  return {
    contract: "lazada_my_create_completion_v1" as const,
    receiptKind: bound.evidence.receiptKind,
    itemId: bound.itemId,
    sellerSkus: bound.skuIdentities.map((row) => row.sellerSku),
    skuIds: bound.skuIdentities.map((row) => row.skuId),
    visibility: readback.remoteState.visibility,
    providerStatus: readback.providerStatus,
    verifiedAt: readback.remoteState.verifiedAt,
    remoteState: readback.remoteState,
    officialEvidence: bound.evidence,
  };
}
