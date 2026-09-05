import { createHash } from "node:crypto";
import {
  coupangRequest,
  ebayRequest,
  ebayTradingRequest,
  ebayTradingXmlEscape,
  elevenstCategoryRequest,
  elevenstOrderRequest,
  elevenstSellerXmlRequest,
  fetchNaverAccessToken,
  lazadaRequest,
  naverRequest,
  qoo10Request,
  readStoredNaverAccessToken,
  shopeeMerchantRequest,
  shopeeRequest,
  temuExactLong,
  temuRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";
import {
  channelCatalog,
  type ActiveChannelKey,
  type ChannelCapabilityKey,
} from "./catalog";
import { qoo10ProductionPlace, qoo10ResultMessage } from "./qoo10";
import {
  normalizeQoo10ListingPublicationReadback,
  type Qoo10PublicationReadbackVerification,
  type Qoo10RollbackRecoveryReadbackExpectation,
} from "./qoo10-listing-publication";
import {
  qoo10S1ActivationArgument,
  qoo10S1ActivationArgumentsValid,
  qoo10S1ActivationBinding,
  qoo10ExactSuccessResultCode,
  verifyQoo10S1ActivationReadback,
} from "./qoo10-listing-activation";
import {
  qoo10DetailImageUrls,
  qoo10ListingCreateExpectation,
  runQoo10ListingCreateProviderPreflight,
  type Qoo10ListingCreateExpectation,
} from "./qoo10-listing-create-preflight";
import {
  qoo10ExactAdoptedLocalizationArgument,
  qoo10ExactAdoptedLocalizationBinding,
  qoo10ExactLocalizationUpdateBinding,
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizedUpdate as qoo10ExactLocalizedUpdateOrThrow,
  qoo10ExactTargetCreateForbidden,
  verifyQoo10ExactCurrentS1Readback,
  verifyQoo10ExactAdoptedLiveReadback,
  type Qoo10ExactLocalizedUpdate,
} from "./qoo10-exact-localization-recovery";
import {
  ebayAsqMarketplaceId,
  ebayAsqMarketplaceIdFromSiteCode,
  type EbayAsqMarketplaceId,
} from "./ebay-asq";
import { assertEbayListingCreateConfiguration } from "./ebay-listing-configuration";
import {
  assertEbayExactExistingQaUpdateArguments,
  assertEbayExactExistingQaProviderCopyRequest,
  ebayExactExistingQaRecoveryBinding,
  ebayExactV101EnglishAspects,
} from "./ebay-exact-existing-qa-recovery";
import { upsertMarketplaceDetailImages } from "./marketplace-images";
import { parseListingPublicationAssetBinding } from "./listing-publication-content";
import { elevenstShippingContractErrorMessage, validateElevenstListingArguments } from "./elevenst-listing";
import { elevenstVerifiedListingRemoteState } from "./elevenst-listing-publication";
import {
  assertElevenstExactExistingUpdate,
  elevenstExactExistingBaselineVerified,
  elevenstExactExistingCreateForbidden,
  elevenstExactExistingLiveReadbackVerified,
  elevenstExactExistingStagedReadbackVerified,
  elevenstExactExistingUpdateTarget,
} from "./elevenst-exact-existing-publication";
import {
  assertCoupangExactQaCurrentProduct,
  assertCoupangExactQaInventoryReadback,
  assertCoupangExactQaUpdateReadback,
  coupangListingUpdateWrite,
} from "./coupang-listing-update";
import {
  assertCoupangExactQaProviderContract,
  coupangExactQaRepresentativeBinding,
  coupangExactQaRecoveryArgument,
  coupangExactQaRecoveryBinding,
  coupangExactQaRecoveryIdentity,
  type CoupangExactQaRecoveryBinding,
} from "./coupang-exact-qa-recovery";
import {
  coupangExactRepresentativePrewriteSnapshot,
  coupangProviderImageSnapshotSha256,
  verifyCoupangExactRepresentativeReadback,
  type CoupangProviderImageIdentity,
} from "./coupang-representative-readback";
import { marketplaceChannelDetailImageCount } from "./marketplace-image-contract";
import {
  elevenstExactExistingUpdateProjectionDigestInput,
  elevenstListingUpdateProjectionDigestInput,
  listingUpdateRemoteIdentity,
  mergeListingUpdatePatch,
  prepareListingUpdateArguments,
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryBinding,
  verifyListingUpdateReadback,
} from "./listing-update";
import {
  listingOperationRequiresVerifiedRemoteState,
  listingOperationUsesPublicationIntent,
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
  listingRemoteStateFulfillsOperation,
  listingRemoteStateMatchesOperation,
  verifiedListingRemoteStateSchema,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import {
  readShopeeListingPublicationState,
  type ShopeePublicationReadbackVerification,
} from "./provider-shopee-publication-readback";
import { shopeeExactGlobalCategoryPath } from "./shopee-category-tree";
import {
  assertShopeeSgExistingContentSource,
  assertShopeeSgExistingInventorySource,
  shopeeSgExistingUpdateBinding,
  verifyShopeeSgExistingContentReadback,
  verifyShopeeSgExistingInventoryReadback,
  verifyShopeeSgExistingUpdatePrewrite,
} from "./shopee-sg-existing-update";
import {
  lazadaListingArgumentsForPublicationIntent,
  lazadaListingArgumentsForRemoteItem,
  lazadaListingRemoteIdFromArguments,
  readLazadaListingPublicationState,
  type LazadaPublicationReadbackVerification,
} from "./provider-lazada-publication-readback";
import {
  listingPublicationReadbackExpectation,
  readCoupangListingPublicationState,
  readEbayListingPublicationState,
  readSmartstoreListingPublicationState,
} from "./listing-publication-readback";
import { executeListingPublicationVerification } from "./listing-publication-verification";
import { uploadChannelNativeImages } from "./native-image-upload";
import {
  normalizeTemuListingPublicationReadback,
  temuActivationBinding,
  temuContainmentDiscoveryBinding,
  temuCreateCorrelationMatches,
  temuExactLongGoodsId,
  temuExactGoodsListArguments,
  temuPublicationExpectedSkus,
} from "./provider-temu-publication-readback";
import {
  normalizeTemuCredentialIdentityObservation,
  normalizeTemuExistingAdoptionObservation,
  temuCredentialCertificationBinding,
  temuExistingAdoptionBinding,
  temuExistingAdoptionExternalGoodsId,
} from "./temu-existing-adoption";
import {
  temuExactExistingUpdateIdentity,
  temuExactExistingUpdateRequest,
} from "./temu-existing-update";
import {
  ebayOrderMatchesShipment,
  ebayOrderPaymentAllowsShipment,
  ebayOrderReadyForShipment,
  ebayShipmentBody,
  ebayShipmentReadback,
} from "./ebay-shipment";

export const channelOperationNames = [
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.activate",
  "listing.publication.verify",
  "price.update",
  "inventory.update",
  "orders.list",
  "orders.get",
  "inquiries.list",
  "inquiries.reply",
  "shipment.acknowledge",
  "shipment.confirm",
] as const;

export type ChannelOperationName = (typeof channelOperationNames)[number];

export const channelOperationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
  "listing.activate": "listingStop",
  "listing.publication.verify": "listingCreate",
  "price.update": "price",
  "inventory.update": "inventory",
  "orders.list": "orders",
  "orders.get": "orders",
  "inquiries.list": "inquiries",
  "inquiries.reply": "inquiries",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};

export const writeChannelOperations = new Set<ChannelOperationName>([
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.activate",
  "price.update",
  "inventory.update",
  "inquiries.reply",
  "shipment.acknowledge",
  "shipment.confirm",
]);

export type ChannelOperationStep = {
  name: string;
  ok: boolean;
  status: number;
  requestId?: string;
  data: Record<string, unknown>;
};

export type ChannelOperationResult = {
  ok: boolean;
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  steps: ChannelOperationStep[];
  remoteId?: string;
  publicUrl?: string;
  publicationIntent?: ListingPublicationIntent;
  publicationStateContract?: typeof listingRemoteStateContractVersion;
  remoteState?: VerifiedListingRemoteState;
  publicationFulfilled?: boolean;
  continuation?: {
    reason: "page_cap_reached";
    arguments: Record<string, unknown>;
  };
  safeMessage: string;
};

type ExecuteInput = {
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  payload: SecretPayload;
  shopeeShopCredential?: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
  providerMutationHooks?: {
    begin: () => Promise<void>;
    assertLeaseHealthy: () => Promise<void>;
    bindCoupangRepresentativePrewrite?: (
      images: CoupangProviderImageIdentity[],
    ) => Promise<{ prewriteSnapshotSha256: string }>;
  };
};

const MAX_PROVIDER_SYNC_PAGES = 20;
const MAX_PROVIDER_SYNC_CONTINUATIONS = 50;
const EBAY_ASQ_ENTRIES_PER_PAGE = 25;
const EBAY_ASQ_GET_ITEM_CONCURRENCY = 4;
const EBAY_LISTING_SITE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const EBAY_LISTING_SITE_CACHE_MAX = 2_000;
const ebayListingSiteCache = new Map<string, { marketplaceId: EbayAsqMarketplaceId; expiresAt: number }>();

function rememberEbayListingSite(cacheKey: string, marketplaceId: EbayAsqMarketplaceId, now = Date.now()) {
  if (ebayListingSiteCache.size >= EBAY_LISTING_SITE_CACHE_MAX) {
    const oldest = ebayListingSiteCache.keys().next().value;
    if (typeof oldest === "string") ebayListingSiteCache.delete(oldest);
  }
  ebayListingSiteCache.set(cacheKey, {
    marketplaceId,
    expiresAt: now + EBAY_LISTING_SITE_CACHE_TTL_MS,
  });
}

function cachedEbayListingSite(cacheKey: string, now: number) {
  const cached = ebayListingSiteCache.get(cacheKey);
  if (!cached) return undefined;
  if (cached.expiresAt <= now) {
    ebayListingSiteCache.delete(cacheKey);
    return undefined;
  }
  return cached.marketplaceId;
}

function boundedPageSize(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function finiteCount(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nestedObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerRecordCount(data: Record<string, unknown>, keys: string[]) {
  for (const value of [data.data, data.response, data.result]) {
    if (Array.isArray(value)) return value.length;
  }
  const roots = [data, nestedObject(data.data), nestedObject(data.response), nestedObject(data.result)];
  for (const root of roots) {
    for (const key of keys) {
      if (Array.isArray(root[key])) return root[key].length;
    }
    const content = nestedObject(root.content);
    for (const key of keys) {
      if (Array.isArray(content[key])) return content[key].length;
    }
  }
  return 0;
}

function objectValue(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (!required) return {};
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

function stringArgument(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!required) return "";
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

function booleanArgument(source: Record<string, unknown>, key: string, fallback = false) {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function integerArgument(source: Record<string, unknown>, key: string, options?: { min?: number; max?: number }) {
  const raw = source[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < (options?.min ?? 0) || value > (options?.max ?? Number.MAX_SAFE_INTEGER)) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function stringMap(source: Record<string, unknown>, key: string, required = false) {
  const value = objectValue(source, key, required);
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
  );
  return Object.fromEntries(entries.map(([name, item]) => [name, String(item)]));
}

function queryParams(source: Record<string, unknown>, key = "query") {
  return new URLSearchParams(stringMap(source, key));
}

function integerQueryArgument(
  query: URLSearchParams,
  key: string,
  options: { fallback: number; min: number; max: number },
) {
  const raw = query.get(key);
  const parsed = raw === null ? options.fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:query.${key}`);
  }
  return parsed;
}

function calendarDateQueryArgument(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim() ?? "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:query.${key}`);
  }
  return value;
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function providerBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return typeof value === "string" && ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

function objectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function lazadaResultData(data: Record<string, unknown>) {
  const providerResult = objectValue(data, "result", false);
  const nestedData = objectValue(providerResult, "data", false);
  return Object.keys(nestedData).length ? nestedData : objectValue(data, "data", false);
}

function lazadaFulfillmentStep(name: string, remote: RemoteResponse, verification: string) {
  const base = step(name, remote);
  const providerResult = objectValue(remote.data, "result", false);
  const providerErrorCode = String(providerResult.error_code ?? "").trim();
  const packages = objectArray(lazadaResultData(remote.data).packages);
  const packageErrors = packages.filter((item) => {
    const itemErrorCode = String(item.item_err_code ?? item.error_code ?? "").trim();
    return itemErrorCode !== "" && itemErrorCode !== "0";
  });
  const accepted = base.ok
    && (providerResult.success === undefined || providerBoolean(providerResult.success))
    && (!providerErrorCode || providerErrorCode === "0")
    && packageErrors.length === 0;
  return {
    ...base,
    ok: accepted,
    data: {
      ...base.data,
      sellerpilotVerification: accepted ? verification : "LAZADA_FULFILLMENT_REJECTED",
    },
  };
}

function requestIdentifier(data: Record<string, unknown>) {
  for (const key of ["request_id", "requestId", "traceId", "rCode"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return undefined;
}

function step(name: string, remote: RemoteResponse): ChannelOperationStep {
  const resultCode = remote.data.ResultCode ?? remote.data.ErrorCode;
  const commonCode = remote.data.code;
  const shopeeError = remote.data.error;
  const temuSuccess = remote.data.success;
  const normalizedCommonCode = commonCode === undefined || commonCode === null ? "" : String(commonCode).toUpperCase();
  const commonCodeAccepted = !normalizedCommonCode
    || ["0", "SUCCESS", "SUCCES", "OK"].includes(normalizedCommonCode)
    || (/^2\d\d$/.test(normalizedCommonCode));
  const providerAccepted =
    (resultCode === undefined || resultCode === null || String(resultCode) === "0") &&
    commonCodeAccepted &&
    (temuSuccess === undefined || temuSuccess === true) &&
    (shopeeError === undefined || shopeeError === null || String(shopeeError) === "");
  return {
    name,
    ok: remote.response.ok && providerAccepted,
    status: remote.response.status,
    requestId: requestIdentifier(remote.data),
    data: remote.data,
  };
}

function inventoryQuantityVerificationStep(
  name: string,
  remote: RemoteResponse,
  expectedQuantity: number,
  actualQuantity: unknown,
): ChannelOperationStep {
  const verifiedStep = step(name, remote);
  const normalizedActual = typeof actualQuantity === "number" ? actualQuantity : Number(actualQuantity);
  const verified = verifiedStep.ok && Number.isFinite(normalizedActual) && normalizedActual === expectedQuantity;
  return {
    ...verifiedStep,
    ok: verified,
    data: {
      ...verifiedStep.data,
      expectedQuantity,
      actualQuantity: Number.isFinite(normalizedActual) ? normalizedActual : null,
      sellerpilotVerification: verified ? "INVENTORY_QUANTITY_VERIFIED" : "INVENTORY_QUANTITY_MISMATCH",
    },
  };
}

type SmartstoreOptionStockExpectation = {
  kind: "combination" | "standard";
  id: string;
  quantity: number;
};

function smartstoreOptionStockExpectations(body: Record<string, unknown>) {
  const optionInfo = objectValue(body, "optionInfo", false);
  const groups = [
    { kind: "combination" as const, values: objectArray(optionInfo.optionCombinations) },
    { kind: "standard" as const, values: objectArray(optionInfo.optionStandards) },
  ];
  const expectations: SmartstoreOptionStockExpectation[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const option of group.values) {
      const id = String(option.id ?? "").trim();
      const quantity = Number(option.stockQuantity);
      const key = `${group.kind}:${id}`;
      if (!id || !Number.isInteger(quantity) || quantity < 0 || quantity > 99_999_999 || seen.has(key)) {
        return [];
      }
      seen.add(key);
      expectations.push({ kind: group.kind, id, quantity });
    }
  }
  return expectations;
}

function smartstoreOptionStockReadbackStep(
  remote: RemoteResponse,
  expectations: SmartstoreOptionStockExpectation[],
): ChannelOperationStep {
  const verifiedStep = step("option-stock-readback", remote);
  const originProduct = objectValue(remote.data, "originProduct", false);
  const detailAttribute = objectValue(originProduct, "detailAttribute", false);
  const optionInfo = objectValue(detailAttribute, "optionInfo", false);
  const actualByKey = new Map<string, number>();
  for (const group of [
    { kind: "combination" as const, values: objectArray(optionInfo.optionCombinations) },
    { kind: "standard" as const, values: objectArray(optionInfo.optionStandards) },
  ]) {
    for (const option of group.values) {
      const id = String(option.id ?? "").trim();
      const quantity = Number(option.stockQuantity);
      if (id && Number.isFinite(quantity)) actualByKey.set(`${group.kind}:${id}`, quantity);
    }
  }
  const mismatches = expectations.filter((expectation) => (
    actualByKey.get(`${expectation.kind}:${expectation.id}`) !== expectation.quantity
  ));
  const verified = verifiedStep.ok && expectations.length > 0 && mismatches.length === 0;
  return {
    ...verifiedStep,
    ok: verified,
    data: {
      ...verifiedStep.data,
      expectedOptionCount: expectations.length,
      verifiedOptionCount: expectations.length - mismatches.length,
      sellerpilotVerification: verified
        ? "INVENTORY_OPTION_QUANTITIES_VERIFIED"
        : "INVENTORY_OPTION_QUANTITIES_MISMATCH",
      sellerpilotMismatchOptionIds: mismatches.slice(0, 40).map((item) => item.id),
    },
  };
}

type EbayListingSiteResolution = {
  itemId: string;
  cacheKey: string;
  marketplaceId: EbayAsqMarketplaceId;
  cacheHit: boolean;
};

type EbayListingSiteFailure = {
  failure: ChannelOperationStep;
};

async function resolveEbayListingSites(
  input: ExecuteInput,
  requestMarketplaceId: EbayAsqMarketplaceId,
  itemIds: string[],
): Promise<{ resolutions: EbayListingSiteResolution[] } | EbayListingSiteFailure> {
  const lookupTime = Date.now();
  const lookups: Array<EbayListingSiteResolution | EbayListingSiteFailure | undefined> = new Array(itemIds.length);
  let nextIndex = 0;
  let stopScheduling = false;
  let requestThrew = false;
  let requestError: unknown;

  const worker = async () => {
    while (!stopScheduling && !requestThrew) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= itemIds.length) return;

      const itemId = itemIds[index];
      const cacheKey = `${input.environment}:${itemId}`;
      const cachedMarketplaceId = cachedEbayListingSite(cacheKey, lookupTime);
      if (cachedMarketplaceId) {
        lookups[index] = {
          itemId,
          cacheKey,
          marketplaceId: cachedMarketplaceId,
          cacheHit: true,
        };
        continue;
      }

      try {
        const itemXml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(itemId)}</ItemID><OutputSelector>ItemID</OutputSelector><OutputSelector>Site</OutputSelector></GetItemRequest>`;
        const itemRemote = await ebayTradingRequest({
          payload: input.payload,
          environment: input.environment,
          callName: "GetItem",
          marketplaceId: requestMarketplaceId,
          body: itemXml,
        });
        const itemStep = step("inquiry-listing-site-readback", itemRemote);
        const providerItem = objectValue(itemRemote.data, "item", false);
        const providerItemId = String(providerItem.itemId ?? "").trim();
        let exactMarketplaceId: EbayAsqMarketplaceId | undefined;
        try {
          exactMarketplaceId = ebayAsqMarketplaceIdFromSiteCode(providerItem.site);
        } catch {
          exactMarketplaceId = undefined;
        }
        if (!itemStep.ok || providerItemId !== itemId || !exactMarketplaceId) {
          lookups[index] = {
            failure: {
              name: "inquiry-listing-site-verification",
              ok: false,
              status: itemStep.status || 422,
              requestId: itemStep.requestId,
              data: { code: "EBAY_ASQ_LISTING_SITE_UNVERIFIED" },
            },
          };
          stopScheduling = true;
          return;
        }
        lookups[index] = {
          itemId,
          cacheKey,
          marketplaceId: exactMarketplaceId,
          cacheHit: false,
        };
      } catch (error) {
        if (!requestThrew) {
          requestThrew = true;
          requestError = error;
        }
        return;
      }
    }
  };

  const workerCount = Math.min(EBAY_ASQ_GET_ITEM_CONCURRENCY, itemIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (requestThrew) throw requestError;

  const failure = lookups.find((lookup): lookup is EbayListingSiteFailure => Boolean(lookup && "failure" in lookup));
  if (failure) return failure;
  const resolutions = lookups.filter((lookup): lookup is EbayListingSiteResolution => Boolean(lookup && "marketplaceId" in lookup));
  if (resolutions.length !== itemIds.length) throw new Error("EBAY_ASQ_LISTING_SITE_LOOKUP_INCOMPLETE");

  // Parallel response timing must not affect cache eviction order or expiry.
  // Commit only after the whole page is verified, in the provider message order.
  for (const resolution of resolutions) {
    if (!resolution.cacheHit) {
      rememberEbayListingSite(resolution.cacheKey, resolution.marketplaceId, lookupTime);
    }
  }
  return { resolutions };
}

function listingUpdateReadbackStep(
  name: string,
  remote: RemoteResponse,
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
): ChannelOperationStep {
  const readbackStep = step(name, remote);
  const verification = verifyListingUpdateReadback(channel, argumentsValue, remote.data);
  readbackStep.ok = readbackStep.ok && verification.ok;
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotVerification: readbackStep.ok ? "LISTING_MUTABLE_FIELDS_VERIFIED" : "LISTING_MUTABLE_FIELDS_MISMATCH",
    sellerpilotMismatchPaths: verification.mismatches.slice(0, 40),
  };
  return readbackStep;
}

function naverOptionalCategoryMetadataStep(name: string, remote: RemoteResponse): ChannelOperationStep {
  const metadataStep = step(name, remote);
  const noMetadataForCategory = remote.response.status === 404
    && String(remote.data.code ?? "").toUpperCase() === "NOT_FOUND";
  if (!noMetadataForCategory) return metadataStep;
  return {
    ...metadataStep,
    ok: true,
    data: { items: [] },
  };
}

function result(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId?: string,
  continuation?: ChannelOperationResult["continuation"],
  verifiedRemoteState?: VerifiedListingRemoteState,
): ChannelOperationResult {
  const providerStepsSucceeded = steps.length > 0 && steps.every((item) => item.ok);
  // A create response is not a durable success until the provider identity is
  // known. Some marketplace APIs can acknowledge the mutation while omitting
  // the identifier from a malformed/delayed response. Treating that response
  // as successful would publish a listing that cannot be updated and, after a
  // retry, can create a duplicate remote product.
  const createIdentityMissing = input.operation === "listing.create"
    && !remoteId?.trim();
  // Direct provider protocol callers that predate the remote-state contract
  // remain parseable for fixture and recovery compatibility. Every new admin
  // listing write injects the contract before enqueueing, so the strict fence
  // is activated whenever the marker is present (including an invalid marker).
  // Gateway completion still rejects a legacy `ok` result without the marker.
  const publicationVerificationRequested = listingOperationRequiresVerifiedRemoteState(input.operation)
    && Object.hasOwn(input.arguments, "publicationStateContract");
  const publicationStateContract = publicationVerificationRequested
      && input.arguments.publicationStateContract === listingRemoteStateContractVersion
    ? listingRemoteStateContractVersion
    : undefined;
  const publicationIntent = listingOperationUsesPublicationIntent(input.operation)
    ? listingPublicationIntentFromArguments(input.arguments)
    : undefined;
  const parsedRemoteState = verifiedListingRemoteStateSchema.safeParse(verifiedRemoteState);
  const remoteState = parsedRemoteState.success ? parsedRemoteState.data : undefined;
  const publicationContractMissing = providerStepsSucceeded
    && !createIdentityMissing
    && publicationVerificationRequested
    && !publicationStateContract;
  const publicationIntentMissing = providerStepsSucceeded
    && !createIdentityMissing
    && publicationVerificationRequested
    && listingOperationUsesPublicationIntent(input.operation)
    && !publicationIntent;
  const publicationStateMissing = providerStepsSucceeded
    && !createIdentityMissing
    && publicationVerificationRequested
    && !remoteState;
  const publicationStateMismatch = Boolean(
    publicationStateContract
    && remoteState
    && !listingRemoteStateMatchesOperation(input.operation, remoteState, publicationIntent),
  );
  const publicationFulfilled = publicationStateContract && remoteState
    ? listingRemoteStateFulfillsOperation(input.operation, remoteState, publicationIntent)
    : undefined;
  const ok = providerStepsSucceeded
    && !createIdentityMissing
    && !publicationContractMissing
    && !publicationIntentMissing
    && !publicationStateMissing
    && !publicationStateMismatch;
  const providerMessage = steps
    .filter((item) => !item.ok)
    .map((item) => {
      const message = input.channel === "qoo10" ? qoo10ResultMessage(item.data) : safeProviderError(item.data);
      return message ? `${item.name}: ${message}` : "";
    })
    .find(Boolean) ?? "";
  return {
    ok,
    channel: input.channel,
    operation: input.operation,
    steps,
    remoteId,
    ...(publicationIntent ? { publicationIntent } : {}),
    ...(publicationStateContract ? { publicationStateContract } : {}),
    ...(remoteState ? { remoteState } : {}),
    ...(publicationFulfilled === undefined ? {} : { publicationFulfilled }),
    ...(ok && continuation ? { continuation } : {}),
    safeMessage: ok
      ? continuation
        ? `${channelCatalog[input.channel].name} ${input.operation} 현재 구간이 정상 응답했고 다음 페이지 구간을 이어서 처리합니다.`
        : `${channelCatalog[input.channel].name} ${input.operation} 작업이 정상 응답했습니다.`
      : createIdentityMissing && providerStepsSucceeded
        ? `${channelCatalog[input.channel].name} 상품 생성 응답은 수신했지만 원격 상품 식별값을 확인할 수 없습니다. 판매자센터 수동 확인이 필요합니다.`
        : publicationContractMissing
          ? `${channelCatalog[input.channel].name} 상품 작업에 검증된 원격 상태 계약이 없어 성공으로 처리하지 않았습니다.`
          : publicationIntentMissing
            ? `${channelCatalog[input.channel].name} 상품 작업의 원장 게시 의도를 확인할 수 없어 성공으로 처리하지 않았습니다.`
        : publicationStateMissing
            ? `${channelCatalog[input.channel].name} 원격 상품 응답은 수신했지만 게시 상태 검증값을 확인할 수 없습니다. 판매자센터 수동 확인이 필요합니다.`
            : publicationStateMismatch
              ? `${channelCatalog[input.channel].name} 원격 상품 가시성이 요청한 작업과 일치하지 않습니다. 판매자센터 수동 확인이 필요합니다.`
        : `${channelCatalog[input.channel].name} ${input.operation} 작업이 원격 오류로 종료됐습니다.${providerMessage ? ` · ${providerMessage}` : ""}`,
  };
}

function paginationResult(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  nextArguments: Record<string, unknown>,
) {
  const depth = finiteCount(input.arguments.sellerpilotPaginationDepth) ?? 0;
  if (depth >= MAX_PROVIDER_SYNC_CONTINUATIONS) {
    return result(input, [...steps, {
      name: "pagination-safety-stop",
      ok: false,
      status: 409,
      data: {
        code: "PROVIDER_PAGINATION_DEPTH_EXCEEDED",
        sellerpilotVerification: "PAGINATION_STOPPED_WITH_REMAINDER",
      },
    }]);
  }
  return result(input, steps, undefined, {
    reason: "page_cap_reached",
    arguments: {
      ...nextArguments,
      sellerpilotPaginationDepth: depth + 1,
    },
  });
}

function paginationSafetyStop(input: ExecuteInput) {
  return result(input, [{
    name: "pagination-safety-stop",
    ok: false,
    status: 409,
    data: {
      code: "PROVIDER_PAGINATION_DEPTH_EXCEEDED",
      sellerpilotVerification: "PAGINATION_STOPPED_WITH_REMAINDER",
    },
  }]);
}

function safeProviderError(data: Record<string, unknown>) {
  const values: string[] = [];
  const keys = new Set([
    "error", "errors", "errorcode", "error_code", "errormsg", "error_msg", "errormessage", "error_message",
    "message", "resultmessage", "authmessage", "msg", "detail", "details", "reason", "failure_reason", "issue", "issues",
    "invalidinputs", "invalid_inputs",
  ]);
  const visit = (value: unknown, depth: number, keyed = false) => {
    if (depth > 6 || values.length >= 16 || value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number") {
      if (keyed && String(value).trim()) values.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, keyed);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z_]/g, "");
      if (keys.has(normalizedKey)) visit(child, depth + 1, true);
      else if (keyed) visit(child, depth + 1, true);
    }
  };
  visit(data, 0);
  return [...new Set(values)]
    .join(" · ")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(key|token|secret|authorization|signature)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function lazadaXmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
}

function lazadaXmlNode(name: string, value: unknown): string {
  // Lazada's category metadata can contain optional attribute keys that are not
  // valid XML element names (for example `Units_(per_Bundle)`). Empty optional
  // values are not part of a create request, so discard them before validating
  // the element name.
  if (value === null || value === undefined || value === "") return "";
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name)) throw new Error("LAZADA_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value)) return value.map((item) => lazadaXmlNode(name, item)).join("");
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => lazadaXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${lazadaXmlEscape(String(value))}</${name}>`;
}

function lazadaPayload(argumentsValue: Record<string, unknown>) {
  const request = argumentsValue.request;
  if (typeof request === "string" && request.trim()) return request.trim();
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const root = Object.entries(request as Record<string, unknown>);
    if (root.length !== 1 || root[0][0] !== "Request") throw new Error("LAZADA_PAYLOAD_ROOT_INVALID");
    return `<?xml version="1.0" encoding="UTF-8"?>${lazadaXmlNode(root[0][0], root[0][1])}`;
  }
  throw new Error("CHANNEL_ARGUMENT_REQUIRED:request");
}

function ensureProviderSupport(channel: ActiveChannelKey, operation: ChannelOperationName) {
  if (["ebay", "temu"].includes(channel) && operation === "shipment.acknowledge") {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  }
  if (operation === "inquiries.reply" && !["qoo10", "lazada", "coupang", "smartstore", "ebay"].includes(channel)) {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  }
  const capability = channelCatalog[channel].capabilities[channelOperationCapabilities[operation]];
  if (capability.mode === "unsupported") throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  if (capability.mode === "vendor_docs_required") throw new Error(`CHANNEL_VENDOR_SPEC_REQUIRED:${operation}`);
}

function hasForbiddenEbayControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x7f
      || (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
}

function ebayTradingTextArgument(
  source: Record<string, unknown>,
  key: string,
  options: { maxLength: number; pattern?: RegExp },
) {
  const value = stringArgument(source, key);
  if (value.length > options.maxLength
      || hasForbiddenEbayControl(value)
      || (options.pattern && !options.pattern.test(value))) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function ebayTradingTimestampArgument(source: Record<string, unknown>, key: string) {
  const value = ebayTradingTextArgument(source, key, { maxLength: 80 });
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  return new Date(timestamp).toISOString();
}

function elevenstXmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
}

function elevenstXmlNode(name: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name)) throw new Error("ELEVENST_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value)) return value.map((item) => elevenstXmlNode(name, item)).join("");
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => elevenstXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${elevenstXmlEscape(String(value))}</${name}>`;
}

function elevenstProductPayload(argumentsValue: Record<string, unknown>) {
  const product = validateElevenstListingArguments(argumentsValue);
  return `<?xml version="1.0" encoding="UTF-8"?>${elevenstXmlNode("Product", product)}`;
}

function elevenstVerifiedStep(name: string, remote: RemoteResponse, verified = true): ChannelOperationStep {
  const remoteStep = step(name, remote);
  const accepted = remote.data.accepted === true && verified;
  return {
    ...remoteStep,
    ok: remoteStep.ok && accepted,
    data: {
      ...remoteStep.data,
      sellerpilotVerification: accepted ? "ELEVENST_RESPONSE_VERIFIED" : "ELEVENST_RESPONSE_UNVERIFIED",
    },
  };
}

function elevenstPrewriteFailureStep(name: string, error: unknown, status = 422): ChannelOperationStep {
  const raw = error instanceof Error ? error.message : "";
  const safeCode = /^ELEVENST_[A-Z0-9_:-]+$/u.test(raw) ? raw : "ELEVENST_PREWRITE_VALIDATION_FAILED";
  return {
    name,
    ok: false,
    status,
    data: {
      error: safeCode,
      ...(elevenstShippingContractErrorMessage(safeCode)
        ? { errorMessage: elevenstShippingContractErrorMessage(safeCode) }
        : {}),
      sellerpilotVerification: "ELEVENST_PREWRITE_REJECTED",
    },
  };
}

function elevenstUnavailableRemote(message: string): RemoteResponse {
  return {
    response: new Response(null, { status: 503 }),
    text: "",
    data: { accepted: false, errorMessage: message },
  };
}

function elevenstPublicationExpectation(input: ExecuteInput) {
  if (input.arguments.publicationStateContract !== listingRemoteStateContractVersion) return null;
  const expectedLocale = typeof input.arguments.publicationExpectedLocale === "string"
    ? input.arguments.publicationExpectedLocale
    : "";
  const expectedFingerprint = typeof input.arguments.publicationExpectedFingerprint === "string"
    ? input.arguments.publicationExpectedFingerprint
    : "";
  const expectedImageCount = typeof input.arguments.publicationExpectedImageCount === "number"
    ? input.arguments.publicationExpectedImageCount
    : Number.NaN;
  return { expectedLocale, expectedFingerprint, expectedImageCount };
}

function elevenstPublicationReadbackStep(
  remote: RemoteResponse,
  remoteState: VerifiedListingRemoteState | null,
): ChannelOperationStep {
  const readbackStep = elevenstVerifiedStep("product-publication-readback", remote, Boolean(remoteState));
  return {
    ...readbackStep,
    data: {
      ...readbackStep.data,
      sellerpilotVerification: readbackStep.ok
        ? "ELEVENST_PUBLICATION_STATE_VERIFIED"
        : "ELEVENST_PUBLICATION_STATE_UNVERIFIED",
      ...(remoteState
        ? {
            sellerpilotRemoteVisibility: remoteState.visibility,
            sellerpilotProviderStatus: remoteState.providerStatus,
            sellerpilotDetailImageCount: remoteState.imageCount,
          }
        : { sellerpilotReconciliationRequired: true }),
    },
  };
}

type ElevenstCategory = {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string;
  depth: number;
  leaf: boolean;
  categoryPath: string;
};

function elevenstCategories(remote: RemoteResponse) {
  return Array.isArray(remote.data.items)
    ? remote.data.items.filter((item): item is ElevenstCategory => Boolean(
      item && typeof item === "object" && !Array.isArray(item)
      && typeof (item as ElevenstCategory).categoryId === "string"
      && typeof (item as ElevenstCategory).categoryName === "string",
    ))
    : [];
}

function elevenstCategoryResult(remote: RemoteResponse, items: ElevenstCategory[], accepted = remote.data.accepted === true): RemoteResponse {
  return {
    response: remote.response,
    text: "",
    data: {
      accepted,
      items,
      totalCount: items.length,
      ...(!accepted ? { errorMessage: "11번가 공식 말단 카테고리로 확인되지 않았습니다." } : {}),
    },
  };
}

function elevenstCategoryScore(query: string, category: ElevenstCategory) {
  const normalizedQuery = query.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const candidate = `${category.categoryPath} ${category.categoryName}`.toLocaleLowerCase();
  const words = [...new Set(normalizedQuery.split(/\s+/).filter((word) => word.length > 1))];
  const matched = words.filter((word) => candidate.includes(word)).length;
  const cableOrganizerBoost = /(케이블|전선|cable|cord)/u.test(normalizedQuery)
    && /(정리|클립|홀더|organizer|clip)/u.test(normalizedQuery)
    && /(케이블|전선).*(정리|클립|홀더)|(?:정리|클립|홀더).*(?:케이블|전선)/u.test(candidate)
    ? 1_000
    : 0;
  const cableClipLeafBoost = /(클립|clip|holder)/u.test(normalizedQuery)
    && /케이블\s*정리소품/u.test(category.categoryName)
    ? 400
    : 0;
  const relevance = cableOrganizerBoost + cableClipLeafBoost + matched * 100 + (candidate.includes(normalizedQuery) ? 500 : 0);
  return relevance > 0 ? relevance + category.depth : 0;
}

async function executeElevenst(input: ExecuteInput) {
  if (input.operation === "listing.create"
      && listingPublicationIntentFromArguments(input.arguments) === "safe_test") {
    return result(input, [elevenstPrewriteFailureStep(
      "safe-test-prewrite-fence",
      new Error("ELEVENST_SAFE_TEST_CREATE_UNSUPPORTED"),
    )]);
  }
  if (input.operation === "listing.create"
      && input.arguments.publicationStateContract === listingRemoteStateContractVersion
      && input.arguments.verificationOnly === true) {
    return result(input, [elevenstPrewriteFailureStep(
      "verification-only-prewrite-fence",
      new Error("ELEVENST_VERIFICATION_ONLY_CREATE_UNSUPPORTED"),
    )]);
  }
  if (input.operation === "categories.list") {
    const parentCategoryId = stringArgument(input.arguments, "categoryId", false);
    const remote = await elevenstCategoryRequest();
    const categories = elevenstCategories(remote);
    const items = parentCategoryId
      ? categories.filter((item) => item.parentCategoryId === parentCategoryId)
      : categories.filter((item) => item.parentCategoryId === "0");
    const narrowed = elevenstCategoryResult(remote, items);
    return result(input, [elevenstVerifiedStep("category-list", narrowed)], parentCategoryId || undefined);
  }
  if (input.operation === "categories.suggest") {
    const query = stringArgument(input.arguments, "query");
    const remote = await elevenstCategoryRequest();
    const items = elevenstCategories(remote)
      .filter((item) => item.leaf)
      .map((item) => ({ item, score: elevenstCategoryScore(query, item) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || right.item.depth - left.item.depth)
      .slice(0, 25)
      .map(({ item, score }) => ({ ...item, confidence: Math.min(0.99, 0.45 + score / 2_000) }));
    const narrowed = elevenstCategoryResult(remote, items, remote.data.accepted === true && items.length > 0);
    return result(input, [elevenstVerifiedStep("category-suggestions", narrowed)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await elevenstCategoryRequest();
    const category = elevenstCategories(remote).find((item) => item.categoryId === categoryId);
    const validLeaf = Boolean(category?.leaf);
    const narrowed = elevenstCategoryResult(remote, category ? [category] : [], remote.data.accepted === true && validLeaf);
    narrowed.data.attributes = [];
    return result(input, [elevenstVerifiedStep(
      input.operation === "categories.attributes" ? "category-attributes" : "category-validation",
      narrowed,
      validLeaf,
    )], categoryId);
  }
  if (input.operation === "listing.create") {
    if (elevenstExactExistingCreateForbidden({ argumentsValue: input.arguments })) {
      return result(input, [elevenstPrewriteFailureStep(
        "product-duplicate-create-fence",
        new Error("ELEVENST_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN"),
      )]);
    }
    let product: Record<string, unknown>;
    try {
      product = validateElevenstListingArguments(input.arguments);
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("product-contract-validation", error)]);
    }
    const sellerProductCode = String(product.sellerPrdCd ?? "").trim();
    const categoryId = String(product.dispCtgrNo ?? "").trim();

    let categoryRemote: RemoteResponse;
    try {
      categoryRemote = await elevenstCategoryRequest();
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("category-validation", error, 503)]);
    }
    const category = elevenstCategories(categoryRemote).find((item) => item.categoryId === categoryId);
    const categoryVerified = categoryRemote.data.accepted === true && category?.leaf === true;
    if (!categoryVerified) {
      const narrowed = elevenstCategoryResult(
        categoryRemote,
        category ? [category] : [],
        false,
      );
      return result(input, [elevenstVerifiedStep("category-validation", narrowed, false)]);
    }

    const findExistingProduct = async () => {
      const remote = await elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `/rest/prodmarketservice/sellerprodcode/${pathSegment(sellerProductCode)}`,
      });
      const productNo = String(remote.data.productNo ?? "").trim();
      if (productNo) return { remote, productNo };
      const resultCode = String(remote.data.resultCode ?? "").trim();
      const lookupRoot = String(remote.data.lookupDocumentRoot ?? "").trim();
      const lookupProducts = Array.isArray(remote.data.products) ? remote.data.products : null;
      const bodyBytes = Number(remote.data.lookupBodyBytes);
      const verifiedEmptyCollection = remote.response.status === 200
        && remote.data.accepted === true
        && /^(?:[A-Za-z_][\w.-]*:)?products$/iu.test(lookupRoot)
        && lookupProducts?.length === 0
        && Number.isSafeInteger(bodyBytes)
        && bodyBytes > 0
        && bodyBytes <= 4_096;
      const notFound = remote.response.status === 404 || resultCode === "404" || verifiedEmptyCollection;
      if (!notFound) {
        const safeResultCode = resultCode.toUpperCase()
          .replace(/[^A-Z0-9]/gu, "_").slice(0, 40) || "NONE";
        const safeRoot = String(remote.data.lookupDocumentRoot ?? "").toUpperCase()
          .replace(/[^A-Z0-9]/gu, "_").slice(0, 40) || "NONE";
        const safeBodyBytes = Number.isSafeInteger(bodyBytes) && bodyBytes >= 0 ? bodyBytes : 0;
        throw new Error(
          `ELEVENST_IDEMPOTENCY_LOOKUP_UNVERIFIED:HTTP_${remote.response.status}:CODE_${safeResultCode}:ROOT_${safeRoot}:BYTES_${safeBodyBytes}`,
        );
      }
      return null;
    };

    let reconciled: Awaited<ReturnType<typeof findExistingProduct>>;
    try {
      reconciled = await findExistingProduct();
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("product-idempotency-read", error, 503)]);
    }
    let createRemote: RemoteResponse;
    let productNo = "";
    let createStep: ChannelOperationStep | null = null;
    let providerCreateAcceptedStep: ChannelOperationStep | null = null;
    if (reconciled) {
      createRemote = reconciled.remote;
      productNo = reconciled.productNo;
      createStep = elevenstVerifiedStep("product-create-reconcile", createRemote, true);
    } else {
      try {
        createRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "POST",
          path: "/rest/prodservices/product",
          body: elevenstProductPayload(input.arguments),
        });
      } catch (error) {
        for (let attempt = 1; attempt <= 3 && !reconciled; attempt += 1) {
          await operationDelay(800 * attempt);
          try {
            reconciled = await findExistingProduct();
          } catch {
            // The create outcome is already uncertain. Keep reconciling with
            // the stable seller product code, but never submit a second POST.
          }
        }
        if (!reconciled) throw error;
        createRemote = reconciled.remote;
        productNo = reconciled.productNo;
        createStep = elevenstVerifiedStep("product-create-reconcile", createRemote, true);
      }
      if (!productNo) productNo = String(createRemote.data.productNo ?? "").trim();
      if (!productNo && createRemote.data.accepted === true) {
        for (let attempt = 1; attempt <= 3 && !reconciled; attempt += 1) {
          await operationDelay(800 * attempt);
          try {
            reconciled = await findExistingProduct();
          } catch {
            // A successful response without productNo is an uncertain create.
            // Lookup failures must not trigger another create request.
          }
        }
        if (reconciled) {
          createRemote = reconciled.remote;
          productNo = reconciled.productNo;
          createStep = elevenstVerifiedStep("product-create-reconcile", createRemote, true);
        }
      }
      if (!createStep) {
        providerCreateAcceptedStep = elevenstVerifiedStep("product-create-accepted", createRemote);
        createStep = elevenstVerifiedStep("product-create", createRemote, Boolean(productNo));
      }
    }
    if (!createStep.ok || !productNo) {
      return result(
        input,
        providerCreateAcceptedStep?.ok && !productNo
          ? [providerCreateAcceptedStep, createStep]
          : [createStep],
      );
    }

    const readExactProduct = () => elevenstSellerXmlRequest({
      payload: input.payload,
      method: "GET",
      path: `/rest/prodmarketservice/prodmarket/${pathSegment(productNo)}`,
    });
    const publicationExpectation = elevenstPublicationExpectation(input);
    let readbackRemote: RemoteResponse | null = null;
    let readbackVerified = false;
    let remoteState: VerifiedListingRemoteState | null = null;
    for (let attempt = 0; attempt < 3 && !readbackVerified; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await readExactProduct();
      } catch {
        readbackRemote = elevenstUnavailableRemote("11번가 상품 생성 후 재조회 응답을 확인하지 못했습니다.");
        continue;
      }
      const readbackProduct = readbackRemote.data.product && typeof readbackRemote.data.product === "object" && !Array.isArray(readbackRemote.data.product)
        ? readbackRemote.data.product as Record<string, unknown>
        : {};
      const identityVerified = readbackRemote.data.accepted === true
        && String(readbackRemote.data.productNo ?? readbackProduct.prdNo ?? "") === productNo
        && String(readbackProduct.sellerPrdCd ?? "") === sellerProductCode;
      remoteState = publicationExpectation
        ? elevenstVerifiedListingRemoteState({
            operation: input.operation,
            remoteId: productNo,
            product: readbackProduct,
            expectedSellerProductCode: sellerProductCode,
            ...publicationExpectation,
          })
        : null;
      readbackVerified = identityVerified && (!publicationExpectation || Boolean(remoteState));
    }
    if (!readbackRemote) throw new Error("ELEVENST_READBACK_MISSING");
    const readbackStep = publicationExpectation
      ? elevenstPublicationReadbackStep(readbackRemote, remoteState)
      : elevenstVerifiedStep("product-readback", readbackRemote, readbackVerified);
    const steps: ChannelOperationStep[] = [createStep, readbackStep];
    if (booleanArgument(input.arguments, "verificationOnly")) {
      let stopRemote: RemoteResponse;
      try {
        stopRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "PUT",
          path: `/rest/prodstatservice/stat/stopdisplay/${pathSegment(productNo)}`,
        });
      } catch {
        stopRemote = elevenstUnavailableRemote("11번가 검증 상품의 전시 중지 응답을 확인하지 못했습니다.");
      }
      steps.push(elevenstVerifiedStep("verification-stop-display", stopRemote));
    }
    const operationResult = result(input, steps, productNo, undefined, remoteState ?? undefined);
    operationResult.publicUrl = `https://www.11st.co.kr/products/${pathSegment(productNo)}`;
    return operationResult;
  }
  if (input.operation === "listing.update") {
    const productNo = pathSegment(stringArgument(input.arguments, "productNo"));
    let product: Record<string, unknown>;
    let snapshotMutableFingerprint: string;
    const exactExistingPublication = elevenstExactExistingUpdateTarget(input.arguments);
    try {
      product = validateElevenstListingArguments(input.arguments);
      if (exactExistingPublication) assertElevenstExactExistingUpdate(input.arguments);
      snapshotMutableFingerprint = stringArgument(input.arguments, "sellerpilotSnapshotMutableFingerprint");
      if (!/^[a-f0-9]{64}$/u.test(snapshotMutableFingerprint)) {
        throw new Error("ELEVENST_UPDATE_SNAPSHOT_FINGERPRINT_INVALID");
      }
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("product-contract-validation", error)]);
    }
    const sellerProductCode = String(product.sellerPrdCd ?? "").trim();
    const readExactProduct = () => elevenstSellerXmlRequest({
      payload: input.payload,
      method: "GET",
      path: `/rest/prodmarketservice/prodmarket/${productNo}`,
    });

    let beforeRemote: RemoteResponse;
    try {
      beforeRemote = await readExactProduct();
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("product-update-preflight", error, 503)], decodeURIComponent(productNo));
    }
    const beforeProduct = beforeRemote.data.product && typeof beforeRemote.data.product === "object" && !Array.isArray(beforeRemote.data.product)
      ? beforeRemote.data.product as Record<string, unknown>
      : {};
    const identityVerified = beforeRemote.data.accepted === true
      && String(beforeRemote.data.productNo ?? beforeProduct.prdNo ?? "") === decodeURIComponent(productNo)
      && String(beforeProduct.sellerPrdCd ?? "") === sellerProductCode;
    const beforeMutableFingerprint = Object.keys(beforeProduct).length
      ? createHash("sha256")
        .update(exactExistingPublication
          ? elevenstExactExistingUpdateProjectionDigestInput(beforeProduct)
          : elevenstListingUpdateProjectionDigestInput(beforeProduct))
        .digest("hex")
      : "";
    const snapshotVerified = beforeMutableFingerprint === snapshotMutableFingerprint;
    const exactBaselineVerified = !exactExistingPublication
      || elevenstExactExistingBaselineVerified(beforeProduct);
    const beforeVerified = identityVerified && snapshotVerified && exactBaselineVerified;
    const beforeStep = elevenstVerifiedStep("product-update-preflight", beforeRemote, beforeVerified);
    beforeStep.data = {
      ...beforeStep.data,
      sellerpilotSnapshotMutableProjectionMatched: snapshotVerified,
      ...(exactExistingPublication
        ? { sellerpilotExactExistingBaselineStatus105Verified: exactBaselineVerified }
        : {}),
      ...((identityVerified && snapshotVerified && !exactBaselineVerified)
        ? {
            error: "ELEVENST_EXACT_EXISTING_BASELINE_STATUS_REQUIRED",
            message: "정확한 기존 11번가 상품이 판매중지 상태 105인지 확인되지 않아 PUT을 시작하지 않았습니다.",
            sellerpilotVerification: "ELEVENST_EXACT_EXISTING_BASELINE_STATUS_REQUIRED",
          }
        : {}),
      ...((identityVerified && !snapshotVerified)
        ? {
            error: "ELEVENST_UPDATE_SNAPSHOT_DRIFT",
            message: "11번가 원격 상품 내용이 마지막 신뢰 스냅샷과 달라 전체 XML 수정을 차단했습니다. 판매자센터 상태를 조정하고 새 신뢰 스냅샷을 만든 뒤 다시 시도해 주세요.",
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification: "ELEVENST_UPDATE_SNAPSHOT_DRIFT",
          }
        : {}),
    };
    if (!beforeStep.ok) return result(input, [beforeStep], decodeURIComponent(productNo));

    const updateRemote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "PUT",
      path: `/rest/prodservices/product/${productNo}`,
      body: elevenstProductPayload(input.arguments),
    });
    const updateVerified = updateRemote.response.status === 200
      && String(updateRemote.data.resultCode ?? "") === "200"
      && String(updateRemote.data.productNo ?? "") === decodeURIComponent(productNo);
    const updateStep = elevenstVerifiedStep("product-update", updateRemote, updateVerified);
    if (updateRemote.response.ok && updateRemote.data.accepted === true) {
      updateStep.data.sellerpilotMutation = "accepted";
    }
    if (!updateStep.ok) return result(input, [beforeStep, updateStep], decodeURIComponent(productNo));

    const publicationExpectation = elevenstPublicationExpectation(input);
    if (exactExistingPublication) {
      let stagedRemote: RemoteResponse | null = null;
      let stagedVerified = false;
      let alreadyLive = false;
      let stagedRemoteState: VerifiedListingRemoteState | null = null;
      for (let attempt = 0; attempt < 3 && !stagedVerified; attempt += 1) {
        if (attempt > 0) await operationDelay(800 * attempt);
        try {
          stagedRemote = await readExactProduct();
        } catch {
          stagedRemote = elevenstUnavailableRemote("11번가 상품 수정 내용의 판매 재개 전 재조회 응답을 확인하지 못했습니다.");
          continue;
        }
        const stagedProduct = stagedRemote.data.product && typeof stagedRemote.data.product === "object" && !Array.isArray(stagedRemote.data.product)
          ? stagedRemote.data.product as Record<string, unknown>
          : {};
        const stagedIdentityVerified = stagedRemote.data.accepted === true
          && String(stagedRemote.data.productNo ?? stagedProduct.prdNo ?? "") === decodeURIComponent(productNo)
          && String(stagedProduct.sellerPrdCd ?? "") === sellerProductCode;
        const stagedContent = verifyListingUpdateReadback("elevenst", input.arguments, stagedRemote.data);
        const exactStaged = elevenstExactExistingStagedReadbackVerified(input.arguments, stagedProduct);
        const exactLive = elevenstExactExistingLiveReadbackVerified(input.arguments, stagedProduct);
        alreadyLive = stagedIdentityVerified && stagedContent.ok && exactLive;
        stagedVerified = stagedIdentityVerified && stagedContent.ok && (exactStaged || exactLive);
        stagedRemoteState = alreadyLive && publicationExpectation
          ? elevenstVerifiedListingRemoteState({
              operation: input.operation,
              remoteId: decodeURIComponent(productNo),
              product: stagedProduct,
              expectedSellerProductCode: sellerProductCode,
              ...publicationExpectation,
            })
          : null;
        stagedRemote.data.sellerpilotMismatches = stagedContent.mismatches.slice(0, 50);
      }
      if (!stagedRemote) throw new Error("ELEVENST_STAGED_READBACK_MISSING");
      const stagedStep = elevenstVerifiedStep(
        alreadyLive ? "listing-readback" : "listing-staged-readback",
        stagedRemote,
        stagedVerified && (!alreadyLive || !publicationExpectation || Boolean(stagedRemoteState)),
      );
      stagedStep.data = {
        ...stagedStep.data,
        sellerpilotMismatches: stagedRemote.data.sellerpilotMismatches,
        sellerpilotExactExistingStagedStatus105Verified: stagedVerified && !alreadyLive,
        sellerpilotExactExistingAlreadyLiveStatus103Verified: stagedVerified && alreadyLive,
      };
      if (alreadyLive && publicationExpectation) {
        stagedStep.data = {
          ...stagedStep.data,
          ...elevenstPublicationReadbackStep(stagedRemote, stagedRemoteState).data,
          sellerpilotMismatches: stagedRemote.data.sellerpilotMismatches,
          sellerpilotExactExistingStagedStatus105Verified: false,
          sellerpilotExactExistingAlreadyLiveStatus103Verified: true,
        };
      }
      if (!stagedStep.ok || alreadyLive) {
        return result(
          input,
          [beforeStep, updateStep, stagedStep],
          decodeURIComponent(productNo),
          undefined,
          stagedRemoteState ?? undefined,
        );
      }

      let restartRemote: RemoteResponse;
      try {
        restartRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "PUT",
          path: `/rest/prodstatservice/stat/restartdisplay/${productNo}`,
        });
      } catch {
        restartRemote = elevenstUnavailableRemote("11번가 판매중지 해제 응답을 확인하지 못했습니다.");
      }
      const restartMessage = String(restartRemote.data.resultMessage ?? "");
      const restartVerified = restartRemote.response.status === 200
        && restartRemote.data.accepted === true
        && String(restartRemote.data.resultCode ?? "") === "200"
        && /\[\s*STAT\s*:\s*103\s*\]/iu.test(restartMessage);
      const restartStep = elevenstVerifiedStep("restart-display", restartRemote, restartVerified);
      if (restartRemote.response.ok && restartRemote.data.accepted === true) {
        restartStep.data.sellerpilotMutation = "accepted";
      }
      if (!restartStep.ok) {
        return result(
          input,
          [beforeStep, updateStep, stagedStep, restartStep],
          decodeURIComponent(productNo),
        );
      }

      let finalRemote: RemoteResponse | null = null;
      let finalVerified = false;
      let finalRemoteState: VerifiedListingRemoteState | null = null;
      for (let attempt = 0; attempt < 3 && !finalVerified; attempt += 1) {
        if (attempt > 0) await operationDelay(800 * attempt);
        try {
          finalRemote = await readExactProduct();
        } catch {
          finalRemote = elevenstUnavailableRemote("11번가 판매중지 해제 후 재조회 응답을 확인하지 못했습니다.");
          continue;
        }
        const finalProduct = finalRemote.data.product && typeof finalRemote.data.product === "object" && !Array.isArray(finalRemote.data.product)
          ? finalRemote.data.product as Record<string, unknown>
          : {};
        const finalIdentityVerified = finalRemote.data.accepted === true
          && String(finalRemote.data.productNo ?? finalProduct.prdNo ?? "") === decodeURIComponent(productNo)
          && String(finalProduct.sellerPrdCd ?? "") === sellerProductCode;
        const finalContent = verifyListingUpdateReadback("elevenst", input.arguments, finalRemote.data);
        finalRemoteState = publicationExpectation
          ? elevenstVerifiedListingRemoteState({
              operation: input.operation,
              remoteId: decodeURIComponent(productNo),
              product: finalProduct,
              expectedSellerProductCode: sellerProductCode,
              ...publicationExpectation,
            })
          : null;
        finalVerified = finalIdentityVerified
          && finalContent.ok
          && elevenstExactExistingLiveReadbackVerified(input.arguments, finalProduct)
          && (!publicationExpectation || Boolean(finalRemoteState));
        finalRemote.data.sellerpilotMismatches = finalContent.mismatches.slice(0, 50);
      }
      if (!finalRemote) throw new Error("ELEVENST_READBACK_MISSING");
      const finalStep = elevenstVerifiedStep("listing-readback", finalRemote, finalVerified);
      if (publicationExpectation) {
        finalStep.data = {
          ...elevenstPublicationReadbackStep(finalRemote, finalRemoteState).data,
          sellerpilotMismatches: finalRemote.data.sellerpilotMismatches,
        };
      }
      return result(
        input,
        [beforeStep, updateStep, stagedStep, restartStep, finalStep],
        decodeURIComponent(productNo),
        undefined,
        finalRemoteState ?? undefined,
      );
    }

    let readbackRemote: RemoteResponse | null = null;
    let readbackVerified = false;
    let remoteState: VerifiedListingRemoteState | null = null;
    for (let attempt = 0; attempt < 3 && !readbackVerified; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await readExactProduct();
      } catch {
        readbackRemote = elevenstUnavailableRemote("11번가 상품 수정 후 재조회 응답을 확인하지 못했습니다.");
        continue;
      }
      const readbackProduct = readbackRemote.data.product && typeof readbackRemote.data.product === "object" && !Array.isArray(readbackRemote.data.product)
        ? readbackRemote.data.product as Record<string, unknown>
        : {};
      const identityVerified = readbackRemote.data.accepted === true
        && String(readbackRemote.data.productNo ?? readbackProduct.prdNo ?? "") === decodeURIComponent(productNo)
        && String(readbackProduct.sellerPrdCd ?? "") === sellerProductCode;
      const contentVerified = verifyListingUpdateReadback("elevenst", input.arguments, readbackRemote.data);
      remoteState = publicationExpectation
        ? elevenstVerifiedListingRemoteState({
            operation: input.operation,
            remoteId: decodeURIComponent(productNo),
            product: readbackProduct,
            expectedSellerProductCode: sellerProductCode,
            ...publicationExpectation,
          })
        : null;
      readbackVerified = identityVerified
        && contentVerified.ok
        && (!exactExistingPublication
          || elevenstExactExistingLiveReadbackVerified(input.arguments, readbackProduct))
        && (!publicationExpectation || Boolean(remoteState));
      readbackRemote.data.sellerpilotMismatches = contentVerified.mismatches.slice(0, 50);
    }
    if (!readbackRemote) throw new Error("ELEVENST_READBACK_MISSING");
    const readbackStep = elevenstVerifiedStep("listing-readback", readbackRemote, readbackVerified);
    if (publicationExpectation) {
      readbackStep.data = {
        ...elevenstPublicationReadbackStep(readbackRemote, remoteState).data,
        sellerpilotMismatches: readbackRemote.data.sellerpilotMismatches,
      };
    }
    return result(
      input,
      [beforeStep, updateStep, readbackStep],
      decodeURIComponent(productNo),
      undefined,
      remoteState ?? undefined,
    );
  }
  if (input.operation === "listing.stop") {
    const productNo = pathSegment(stringArgument(input.arguments, "productNo"));
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "PUT",
      path: `/rest/prodstatservice/stat/stopdisplay/${productNo}`,
    });
    const stopStep = elevenstVerifiedStep("stop-display", remote);
    if (!stopStep.ok) return result(input, [stopStep], decodeURIComponent(productNo));
    const publicationExpectation = elevenstPublicationExpectation(input);
    if (!publicationExpectation) return result(input, [stopStep], decodeURIComponent(productNo));

    let readbackRemote: RemoteResponse | null = null;
    let readbackStep: ChannelOperationStep | null = null;
    let remoteState: VerifiedListingRemoteState | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "GET",
          path: `/rest/prodmarketservice/prodmarket/${productNo}`,
        });
      } catch {
        readbackRemote = elevenstUnavailableRemote("11번가 상품 전시 중지 후 재조회 응답을 확인하지 못했습니다.");
      }
      const readbackProduct = readbackRemote.data.product && typeof readbackRemote.data.product === "object" && !Array.isArray(readbackRemote.data.product)
        ? readbackRemote.data.product as Record<string, unknown>
        : {};
      remoteState = elevenstVerifiedListingRemoteState({
        operation: input.operation,
        remoteId: decodeURIComponent(productNo),
        product: readbackProduct,
        ...publicationExpectation,
      });
      readbackStep = elevenstPublicationReadbackStep(readbackRemote, remoteState);
      if (readbackStep.ok) {
        return result(
          input,
          [stopStep, readbackStep],
          decodeURIComponent(productNo),
          undefined,
          remoteState ?? undefined,
        );
      }
    }
    return result(input, [stopStep, readbackStep!], decodeURIComponent(productNo));
  }
  if (input.operation === "orders.list") {
    const remote = await elevenstOrderRequest({
      payload: input.payload,
      startTime: stringArgument(input.arguments, "startTime"),
      endTime: stringArgument(input.arguments, "endTime"),
    });
    return result(input, [step("orders", remote)]);
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}

function qoo10DetailHtml(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = qoo10DetailHtml(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["itemdetail", "itemdescription", "description"].includes(key.toLowerCase()) && typeof item === "string") {
      return item;
    }
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = qoo10DetailHtml(item, depth + 1);
    if (found) return found;
  }
  return "";
}

function qoo10ImageCount(html: string) {
  return (html.match(/(?:<|&lt;)img\b/gi) ?? []).length;
}

function qoo10SetNewGoodsMainImageContentId(resultObject: unknown, remoteId: string) {
  if (!resultObject || typeof resultObject !== "object" || Array.isArray(resultObject)) return undefined;
  const record = resultObject as Record<string, unknown>;
  const resultRemoteId = typeof record.GdNo === "string" || typeof record.GdNo === "number"
    ? String(record.GdNo).trim()
    : "";
  const rawContentId = record.BIContentsNo;
  const contentId = typeof rawContentId === "string" || typeof rawContentId === "number"
    ? String(rawContentId).trim()
    : "";
  return resultRemoteId === remoteId && /^[1-9]\d{5,19}$/u.test(contentId)
    ? contentId
    : undefined;
}

function qoo10UpdateResponseIdentities(resultObject: unknown) {
  if (!resultObject || typeof resultObject !== "object" || Array.isArray(resultObject)) return [];
  const record = resultObject as Record<string, unknown>;
  return ["GdNo", "ItemCode", "itemCode"].flatMap((alias) => {
    if (!Object.hasOwn(record, alias)) return [];
    const value = record[alias];
    const normalized = typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
    return [{ alias, value: normalized }];
  });
}

function qoo10ExplicitProviderRejection(remote: RemoteResponse) {
  if (!remote.response.ok || !Object.hasOwn(remote.data, "ResultCode")) return false;
  const resultCode = remote.data.ResultCode;
  if (resultCode === undefined || resultCode === null) return false;
  const normalized = String(resultCode).trim();
  return Boolean(normalized) && normalized !== "0";
}

function qoo10UnavailableResponse(message: string): RemoteResponse {
  return {
    response: new Response(null, { status: 503 }),
    text: "",
    data: { ResultMsg: message },
  };
}

function qoo10S1ActivationResponseStep(remote: RemoteResponse) {
  const ownResultCode = Object.hasOwn(remote.data, "ResultCode");
  const resultCode = ownResultCode ? String(remote.data.ResultCode) : "";
  const accepted = remote.response.ok && ownResultCode && resultCode === "0";
  const explicitRejection = remote.response.ok && ownResultCode && /^-?[1-9]\d*$/u.test(resultCode);
  return {
    accepted,
    explicitRejection,
    step: {
      name: "qoo10-s1-activation",
      ok: accepted,
      status: remote.response.status,
      requestId: requestIdentifier(remote.data),
      data: {
        ...remote.data,
        sellerpilotVerification: accepted
          ? "QOO10_S1_ACTIVATION_ACCEPTED"
          : explicitRejection
            ? "QOO10_S1_ACTIVATION_EXPLICITLY_REJECTED"
            : "QOO10_S1_ACTIVATION_OUTCOME_AMBIGUOUS",
        sellerpilotExactResultCodeObserved: ownResultCode ? resultCode : null,
        ...(accepted ? { sellerpilotMutation: "accepted" } : {}),
        ...(explicitRejection ? { sellerpilotNoWriteConfirmed: true } : {}),
        ...(!accepted && !explicitRejection ? { sellerpilotReconciliationRequired: true } : {}),
      },
    } satisfies ChannelOperationStep,
  };
}

function qoo10S1ActivationReadbackStep(input: {
  remote: RemoteResponse;
  arguments: Record<string, unknown>;
  expectedStatus: "S1" | "S2";
  outcomeAmbiguous: boolean;
}) {
  const base = step("qoo10-s1-activation-post-readback", input.remote);
  const verification = verifyQoo10S1ActivationReadback({
    arguments: input.arguments,
    resultObject: input.remote.data.ResultObject,
    expectedStatus: input.expectedStatus,
  });
  const exactProviderSuccess = input.remote.response.ok
    && qoo10ExactSuccessResultCode(input.remote.data);
  const ok = exactProviderSuccess && verification.ok && !input.outcomeAmbiguous;
  return {
    step: {
      ...base,
      ok,
      data: {
        ...base.data,
        sellerpilotVerification: ok
          ? input.expectedStatus === "S2"
            ? "QOO10_S1_ACTIVATION_S2_CONTENT_VERIFIED"
            : "QOO10_S1_ACTIVATION_REJECTION_S1_VERIFIED"
          : "QOO10_S1_ACTIVATION_POST_READBACK_UNVERIFIED",
        sellerpilotExpectedProviderStatus: input.expectedStatus,
        sellerpilotActualProviderStatus: verification.publication.providerStatus || null,
        sellerpilotExactResultCodeVerified: exactProviderSuccess,
        sellerpilotPublicationChecks: verification.publication.checks,
        sellerpilotActivationContentChecks: verification.checks,
        ...(!ok ? { sellerpilotReconciliationRequired: true } : {}),
      },
    } satisfies ChannelOperationStep,
    remoteState: ok ? verification.publication.remoteState : undefined,
  };
}

function qoo10RollbackRecoveryExpectation(
  expectedState: Omit<Qoo10RollbackRecoveryReadbackExpectation, "detailImageUrls">,
  detailHtml: string,
): Qoo10RollbackRecoveryReadbackExpectation {
  return {
    ...expectedState,
    detailImageUrls: qoo10DetailImageUrls(detailHtml),
  };
}

function qoo10VerificationStep(ok: boolean, status: number, imageCount: number): ChannelOperationStep {
  return {
    name: "detail-image-readback",
    ok,
    status,
    data: {
      ResultCode: ok ? 0 : -9999,
      ResultMsg: ok ? "DETAIL_IMAGES_VERIFIED" : "QOO10_DETAIL_IMAGE_READBACK_MISSING",
      detailImageCount: imageCount,
    },
  };
}

function qoo10PublicationExpectation(input: ExecuteInput) {
  if (input.arguments.publicationStateContract !== listingRemoteStateContractVersion) return null;
  const expectedLocale = typeof input.arguments.publicationExpectedLocale === "string"
    ? input.arguments.publicationExpectedLocale
    : "";
  const expectedFingerprint = typeof input.arguments.publicationExpectedFingerprint === "string"
    ? input.arguments.publicationExpectedFingerprint
    : "";
  const expectedImageCount = typeof input.arguments.publicationExpectedImageCount === "number"
    ? input.arguments.publicationExpectedImageCount
    : Number.NaN;
  return { expectedLocale, expectedFingerprint, expectedImageCount };
}

function qoo10PublicationReadbackStep(
  remote: RemoteResponse,
  verification: Qoo10PublicationReadbackVerification,
): ChannelOperationStep {
  const readbackStep = step("GetItemDetailInfo-publication-readback", remote);
  const remoteState = verification.remoteState;
  const verified = readbackStep.ok && Boolean(remoteState);
  const providerResultMessage = qoo10ResultMessage(readbackStep.data);
  return {
    ...readbackStep,
    ok: verified,
    data: {
      ...readbackStep.data,
      ...(!verified
        ? {
            ResultMsg: "QOO10_PUBLICATION_STATE_UNVERIFIED",
            ...(providerResultMessage
              ? { sellerpilotProviderResultMessage: providerResultMessage }
              : {}),
          }
        : {}),
      sellerpilotVerification: verified
        ? "QOO10_PUBLICATION_STATE_VERIFIED"
        : "QOO10_PUBLICATION_STATE_UNVERIFIED",
      providerStatus: verification.providerStatus || null,
      actualImageCount: verification.imageCount,
      sellerpilotPublicationChecks: verification.checks,
      ...(remoteState
        ? {
            sellerpilotRemoteVisibility: remoteState.visibility,
            sellerpilotProviderStatus: remoteState.providerStatus,
            sellerpilotDetailImageCount: remoteState.imageCount,
          }
        : { sellerpilotReconciliationRequired: true }),
    },
  };
}

function qoo10RollbackRecoveryReadbackStep(input: {
  phase: "pre_activation" | "post_activation" | "update_rejection_s1";
  remote: RemoteResponse;
  publication: Qoo10PublicationReadbackVerification;
  mutable: ChannelOperationStep;
  expectedDetailImages: number;
}) {
  const publicationStep = qoo10PublicationReadbackStep(input.remote, input.publication);
  const expectedStatus = input.phase === "post_activation" ? "S2" : "S1";
  const expectedVisibility = input.phase === "post_activation" ? "live" : "non_public";
  const statusVerified = input.publication.providerStatus.trim().toUpperCase() === expectedStatus
    && input.publication.remoteState?.visibility === expectedVisibility;
  const exactImagesVerified = input.expectedDetailImages === marketplaceChannelDetailImageCount
    && input.publication.imageCount === marketplaceChannelDetailImageCount;
  const ok = publicationStep.ok && input.mutable.ok && statusVerified && exactImagesVerified;
  return {
    ...publicationStep,
    name: input.phase === "pre_activation"
      ? "qoo10-rollback-pre-activation-readback"
      : input.phase === "post_activation"
        ? "qoo10-rollback-post-activation-readback"
        : "qoo10-rollback-update-rejection-s1-readback",
    ok,
    data: {
      ...publicationStep.data,
      sellerpilotMutableVerification: input.mutable.data.sellerpilotVerification,
      sellerpilotMismatchPaths: input.mutable.data.sellerpilotMismatchPaths,
      sellerpilotExpectedProviderStatus: expectedStatus,
      sellerpilotExactDetailImageCount: marketplaceChannelDetailImageCount,
      sellerpilotVerification: ok
        ? input.phase === "pre_activation"
          ? "QOO10_ROLLBACK_S1_CONTENT_VERIFIED"
          : input.phase === "post_activation"
            ? "QOO10_ROLLBACK_S2_PUBLICATION_VERIFIED"
            : "QOO10_ROLLBACK_UPDATE_REJECTION_S1_VERIFIED"
        : input.phase === "pre_activation"
          ? "QOO10_ROLLBACK_S1_CONTENT_UNVERIFIED"
          : input.phase === "post_activation"
            ? "QOO10_ROLLBACK_S2_PUBLICATION_UNVERIFIED"
            : "QOO10_ROLLBACK_UPDATE_REJECTION_S1_UNVERIFIED",
      ...(!ok ? { sellerpilotReconciliationRequired: true } : {}),
    },
  } satisfies ChannelOperationStep;
}

function operationDelay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function qoo10InventoryQuantity(value: unknown, itemCode: string, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const records = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    const matching = records.find((item) => String(item.ItemCode ?? item.GdNo ?? "") === itemCode);
    if (matching) return qoo10InventoryQuantity(matching, itemCode, depth + 1);
    for (const item of value) {
      const found = qoo10InventoryQuantity(item, itemCode, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const recordValue = value as Record<string, unknown>;
  for (const key of ["ItemQty", "Qty", "StockQty", "stockQty", "quantity"]) {
    const quantity = recordValue[key];
    if (typeof quantity === "string" || typeof quantity === "number") return quantity;
  }
  for (const nested of Object.values(recordValue)) {
    const found = qoo10InventoryQuantity(nested, itemCode, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

type Qoo10ItemPriceSnapshot = {
  itemCode: string;
  price: number | null;
  quantity: number | null;
  currency: string | null;
};

function qoo10Integer(value: unknown, minimum: number) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function qoo10RecordValue(recordValue: Record<string, unknown>, names: readonly string[]) {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(recordValue)
    .find(([name]) => normalizedNames.has(name.toLowerCase()))?.[1];
}

function qoo10ItemPriceSnapshots(
  value: unknown,
  depth = 0,
  snapshots: Qoo10ItemPriceSnapshot[] = [],
) {
  if (depth > 8 || value === null || value === undefined) return snapshots;
  if (Array.isArray(value)) {
    for (const item of value) qoo10ItemPriceSnapshots(item, depth + 1, snapshots);
    return snapshots;
  }
  if (typeof value !== "object") return snapshots;
  const recordValue = value as Record<string, unknown>;
  const rawItemCode = qoo10RecordValue(recordValue, ["ItemCode"]);
  if (typeof rawItemCode === "string" || typeof rawItemCode === "number") {
    const itemCode = String(rawItemCode).trim();
    if (itemCode) {
      const rawCurrency = qoo10RecordValue(recordValue, ["Currency", "CurrencyCode", "CurrencyCd"]);
      const currency = typeof rawCurrency === "string" && /^[A-Za-z]{3}$/.test(rawCurrency.trim())
        ? rawCurrency.trim().toUpperCase()
        : null;
      snapshots.push({
        itemCode,
        price: qoo10Integer(qoo10RecordValue(recordValue, ["ItemPrice"]), 1),
        quantity: qoo10Integer(qoo10RecordValue(recordValue, ["ItemQty"]), 0),
        currency,
      });
    }
  }
  for (const nested of Object.values(recordValue)) {
    qoo10ItemPriceSnapshots(nested, depth + 1, snapshots);
  }
  return snapshots;
}

function qoo10SingleItemPriceSnapshot(value: unknown) {
  const snapshots = qoo10ItemPriceSnapshots(value);
  return snapshots.length === 1 ? snapshots[0] : null;
}

function qoo10PricePrewriteStep(
  remote: RemoteResponse,
  expectedItemCode: string,
  expectedCurrency: string,
) {
  const readbackStep = step("GetItemDetailInfo-before-price", remote);
  const snapshot = qoo10SingleItemPriceSnapshot(remote.data.ResultObject);
  const verified = readbackStep.ok
    && snapshot?.itemCode === expectedItemCode
    && snapshot.price !== null
    && snapshot.quantity !== null
    && snapshot.currency === expectedCurrency;
  return {
    snapshot,
    step: {
      ...readbackStep,
      ok: verified,
      data: {
        ...readbackStep.data,
        expectedItemCode,
        actualItemCode: snapshot?.itemCode ?? null,
        expectedCurrency,
        actualCurrency: snapshot?.currency ?? null,
        currentPrice: snapshot?.price ?? null,
        preservedQuantity: snapshot?.quantity ?? null,
        sellerpilotVerification: verified
          ? "QOO10_PRICE_PREWRITE_SNAPSHOT_VERIFIED"
          : "QOO10_PRICE_PREWRITE_SNAPSHOT_MISMATCH",
      },
    } satisfies ChannelOperationStep,
  };
}

function qoo10PriceReadbackStep(
  remote: RemoteResponse,
  expected: { itemCode: string; price: number; currency: string },
): ChannelOperationStep {
  const readbackStep = step("GetItemDetailInfo-after-price", remote);
  const snapshot = qoo10SingleItemPriceSnapshot(remote.data.ResultObject);
  const mismatches = [
    ...(snapshot?.itemCode === expected.itemCode ? [] : ["ItemCode"]),
    ...(snapshot?.price === expected.price ? [] : ["ItemPrice"]),
    ...(snapshot?.currency === expected.currency ? [] : ["Currency"]),
  ];
  const verified = readbackStep.ok && mismatches.length === 0;
  return {
    ...readbackStep,
    ok: verified,
    data: {
      ...readbackStep.data,
      expectedItemCode: expected.itemCode,
      actualItemCode: snapshot?.itemCode ?? null,
      expectedPrice: expected.price,
      actualPrice: snapshot?.price ?? null,
      expectedCurrency: expected.currency,
      actualCurrency: snapshot?.currency ?? null,
      sellerpilotMismatchFields: mismatches,
      sellerpilotVerification: verified
        ? "QOO10_PRICE_IDENTITY_CURRENCY_VALUE_VERIFIED"
        : "QOO10_PRICE_IDENTITY_CURRENCY_VALUE_MISMATCH",
      ...(!verified ? { sellerpilotReconciliationRequired: true } : {}),
    },
  };
}

function qoo10PriceUpdateRequest(
  input: ExecuteInput,
  suppliedParams: Record<string, string>,
) {
  const itemCode = suppliedParams.ItemCode || stringArgument(input.arguments, "remoteId", false);
  if (!/^\d{9,10}$/.test(itemCode)) throw new Error("CHANNEL_ARGUMENT_INVALID:ItemCode");

  const rawPrices = [suppliedParams.Price, suppliedParams.ItemPrice, stringArgument(input.arguments, "price", false)]
    .filter((value) => value !== undefined && value !== "");
  const prices = rawPrices.map((value) => qoo10Integer(value, 1));
  if (!prices.length || prices.some((value) => value === null) || new Set(prices).size !== 1) {
    throw new Error("CHANNEL_ARGUMENT_INVALID:Price");
  }
  const price = prices[0]!;

  const currency = (
    stringArgument(input.arguments, "currency", false)
    || suppliedParams.Currency
    || suppliedParams.CurrencyCode
  ).trim().toUpperCase();
  if (currency !== "JPY") throw new Error("CHANNEL_ARGUMENT_INVALID:currency");
  return { itemCode, price, currency };
}

async function executeQoo10(input: ExecuteInput) {
  const suppliedParams = stringMap(input.arguments, "params");
  if (["categories.list", "categories.suggest", "categories.attributes", "categories.validate"].includes(input.operation)) {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "CommonInfoLookup",
      method: "GetCatagoryListAll",
      params: { ...suppliedParams, lang_cd: "JA" },
    });
    const categoryStep = step("GetCatagoryListAll", remote);
    if (input.operation === "categories.list" || input.operation === "categories.suggest") {
      return result(input, [categoryStep]);
    }

    const categoryId = stringArgument(input.arguments, "categoryId");
    const rows = Array.isArray(remote.data.ResultObject)
      ? remote.data.ResultObject.filter((value): value is Record<string, unknown> => Boolean(
        value && typeof value === "object" && !Array.isArray(value),
      ))
      : [];
    const matches = rows.filter((row) => String(row.CATE_S_CD ?? "").trim() === categoryId);
    const exactLeaf = matches.length === 1
      && ["CATE_L_CD", "CATE_L_NM", "CATE_M_CD", "CATE_M_NM", "CATE_S_CD", "CATE_S_NM"]
        .every((key) => String(matches[0]?.[key] ?? "").trim());
    const verified = categoryStep.ok && /^\d{9}$/u.test(categoryId) && exactLeaf;
    return result(input, [{
      ...categoryStep,
      ok: verified,
      data: {
        ...categoryStep.data,
        ResultObject: matches,
        sellerpilotVerification: verified
          ? "QOO10_EXACT_JA_LEAF_CATEGORY_VERIFIED"
          : "QOO10_EXACT_JA_LEAF_CATEGORY_UNVERIFIED",
        categoryId,
        exactLeafMatchCount: matches.length,
      },
    }], categoryId);
  }
  if (input.operation === "listing.create"
      && qoo10ExactTargetCreateForbidden(input.arguments)) {
    return result(input, [{
      name: "qoo10-exact-duplicate-create-fence",
      ok: false,
      status: 409,
      data: {
        ResultCode: -9999,
        ResultMsg: "QOO10_EXACT_DUPLICATE_CREATE_FORBIDDEN",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
        sellerpilotNoWriteConfirmed: true,
      },
    }]);
  }
  const activationMarkerSupplied = Object.hasOwn(input.arguments, qoo10S1ActivationArgument);
  const activationBinding = qoo10S1ActivationBinding(input.arguments);
  if (activationMarkerSupplied !== (input.operation === "listing.activate")
      || (input.operation === "listing.activate"
        && (!activationBinding || !qoo10S1ActivationArgumentsValid(input.arguments)))) {
    return result(input, [{
      name: "qoo10-s1-activation-prewrite-fence",
      ok: false,
      status: 422,
      data: {
        ResultCode: -9999,
        ResultMsg: "QOO10_S1_ACTIVATION_CONTEXT_INVALID",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
        sellerpilotNoWriteConfirmed: true,
      },
    }], activationBinding?.remoteId ?? suppliedParams.ItemCode);
  }
  if (input.operation === "listing.activate" && activationBinding) {
    // This dedicated recovery operation deliberately starts at the mutation.
    // The server-owned verifier binding proves the preceding S1 readback; a
    // preflight GET here would reopen a race between verification and write.
    let activationRemote: RemoteResponse;
    try {
      activationRemote = await qoo10Request({
        payload: input.payload,
        service: "ItemsBasic",
        method: "EditGoodsStatus",
        params: { ItemCode: activationBinding.remoteId, Status: "2" },
      });
    } catch {
      activationRemote = qoo10UnavailableResponse("QOO10_S1_ACTIVATION_RESPONSE_UNAVAILABLE");
    }
    const activation = qoo10S1ActivationResponseStep(activationRemote);

    // Never repeat EditGoodsStatus automatically. One read-only observation is
    // the only call allowed after the single activation attempt.
    let readbackRemote: RemoteResponse;
    try {
      readbackRemote = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: {
          ItemCode: activationBinding.remoteId,
          SellerCode: activationBinding.expectedSellerCode ?? "",
        },
      });
    } catch {
      readbackRemote = qoo10UnavailableResponse("QOO10_S1_ACTIVATION_POST_READBACK_UNAVAILABLE");
    }
    const postReadback = qoo10S1ActivationReadbackStep({
      remote: readbackRemote,
      arguments: input.arguments,
      expectedStatus: activation.accepted ? "S2" : "S1",
      outcomeAmbiguous: !activation.accepted && !activation.explicitRejection,
    });
    const verifiedTerminalRemoteState = (activation.accepted || activation.explicitRejection)
      && postReadback.step.ok
      ? postReadback.remoteState
      : undefined;
    return result(
      input,
      [activation.step, postReadback.step],
      activationBinding.remoteId,
      undefined,
      verifiedTerminalRemoteState,
    );
  }
  if (input.operation === "listing.create"
      && listingPublicationIntentFromArguments(input.arguments) === "safe_test") {
    return result(input, [{
      name: "safe-test-prewrite-fence",
      ok: false,
      status: 422,
      data: {
        ResultCode: -9999,
        ResultMsg: "QOO10_SAFE_TEST_CREATE_UNSUPPORTED",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
      },
    }]);
  }
  if (input.operation === "listing.stop" && suppliedParams.Status !== "1") {
    return result(input, [{
      name: "stop-status-prewrite-fence",
      ok: false,
      status: 422,
      data: {
        ResultCode: -9002,
        ResultMsg: "QOO10_STOP_REQUIRES_ON_QUEUE_STATUS_1",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
      },
    }], suppliedParams.ItemCode);
  }
  const rollbackRecoveryMarkerSupplied = Object.hasOwn(
    input.arguments,
    qoo10RollbackUpdateRecoveryArgument,
  );
  const rollbackRecovery = qoo10RollbackUpdateRecoveryBinding(input.arguments);
  const exactLocalizationMarkerSupplied = Object.hasOwn(
    input.arguments,
    qoo10ExactLocalizationUpdateArgument,
  );
  const exactLocalizationBinding = qoo10ExactLocalizationUpdateBinding(
    input.arguments,
  );
  const exactAdoptedMarkerSupplied = Object.hasOwn(
    input.arguments,
    qoo10ExactAdoptedLocalizationArgument,
  );
  const exactAdoptedBinding = qoo10ExactAdoptedLocalizationBinding(
    input.arguments,
  );
  if (exactLocalizationMarkerSupplied && (
    input.operation !== "listing.update"
    || !exactLocalizationBinding
  )) {
    return result(input, [{
      name: "qoo10-exact-localization-prewrite-fence",
      ok: false,
      status: 422,
      data: {
        ResultCode: -9999,
        ResultMsg: "QOO10_EXACT_LOCALIZED_UPDATE_INVALID",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
        sellerpilotNoWriteConfirmed: true,
      },
    }], suppliedParams.ItemCode);
  }
  if (exactAdoptedMarkerSupplied && (
    input.operation !== "listing.update"
    || !exactLocalizationBinding
    || !exactAdoptedBinding
  )) {
    return result(input, [{
      name: "qoo10-exact-adopted-localization-prewrite-fence",
      ok: false,
      status: 422,
      data: {
        ResultCode: -9999,
        ResultMsg: "QOO10_EXACT_ADOPTED_LOCALIZATION_CONTEXT_INVALID",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
        sellerpilotNoWriteConfirmed: true,
      },
    }], suppliedParams.ItemCode);
  }
  const updateRecovery = rollbackRecovery ?? (exactLocalizationBinding ? {
    status: "allowed" as const,
    contract: "qoo10_create_rollback_confirmation_v1" as const,
    listingId: qoo10ExactLocalizationRecoveryIdentity.listingId,
    remoteId: qoo10ExactLocalizationRecoveryIdentity.remoteId,
    providerStatus: "S1" as const,
    sourceJobId: "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    expectedState: {
      categoryCode: qoo10ExactLocalizationRecoveryIdentity.categoryCode,
      retailPriceJpy: qoo10ExactLocalizationRecoveryIdentity.priceJpy,
      sellPriceJpy: qoo10ExactLocalizationRecoveryIdentity.priceJpy,
      quantity: qoo10ExactLocalizationRecoveryIdentity.quantity,
      shippingNo: qoo10ExactLocalizationRecoveryIdentity.shippingNo,
      biContentsNo: qoo10ExactLocalizationRecoveryIdentity.representativeImageContentId,
    },
  } : null);
  const rollbackRecoveryReadbackExpectation = updateRecovery
    ? qoo10RollbackRecoveryExpectation(
        updateRecovery.expectedState,
        suppliedParams.ItemDescription ?? "",
      )
    : null;
  if (rollbackRecoveryMarkerSupplied && (
    input.operation !== "listing.update"
    || !rollbackRecovery
    || rollbackRecovery.remoteId !== suppliedParams.ItemCode
    || !["1", "2", "3"].includes(suppliedParams.ProductionPlaceType ?? "")
    || !(suppliedParams.ProductionPlace ?? "").trim()
    || Object.hasOwn(suppliedParams, "StandardImage")
    || qoo10ImageCount(suppliedParams.ItemDescription ?? "") !== marketplaceChannelDetailImageCount
    || rollbackRecoveryReadbackExpectation?.detailImageUrls.length !== marketplaceChannelDetailImageCount
    || input.arguments.publicationStateContract !== listingRemoteStateContractVersion
    || listingPublicationIntentFromArguments(input.arguments) !== "live"
    || input.arguments.publicationExpectedLocale !== "ja-JP"
    || typeof input.arguments.publicationExpectedFingerprint !== "string"
    || !/^[a-f0-9]{64}$/u.test(input.arguments.publicationExpectedFingerprint)
    || input.arguments.publicationExpectedImageCount !== marketplaceChannelDetailImageCount
  )) {
    return result(input, [{
      name: "qoo10-rollback-recovery-prewrite-fence",
      ok: false,
      status: 422,
      data: {
        ResultCode: -9999,
        ResultMsg: "QOO10_ROLLBACK_RECOVERY_CONTEXT_INVALID",
        sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
      },
    }], suppliedParams.ItemCode);
  }
  let exactLocalizedUpdate: Qoo10ExactLocalizedUpdate | null = null;
  const exactPrewriteSteps: ChannelOperationStep[] = [];
  if (exactLocalizationBinding
      && updateRecovery?.remoteId === qoo10ExactLocalizationRecoveryIdentity.remoteId) {
    try {
      exactLocalizedUpdate = qoo10ExactLocalizedUpdateOrThrow(
        input.arguments,
        updateRecovery.remoteId,
        true,
      );
      if (!exactLocalizedUpdate) throw new Error("QOO10_EXACT_LOCALIZED_UPDATE_INVALID");
    } catch {
      return result(input, [{
        name: "qoo10-exact-localization-prewrite-fence",
        ok: false,
        status: 422,
        data: {
          ResultCode: -9999,
          ResultMsg: "QOO10_EXACT_LOCALIZED_UPDATE_INVALID",
          sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
          sellerpilotNoWriteConfirmed: true,
        },
      }], updateRecovery.remoteId);
    }
    const currentRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: {
        ItemCode: updateRecovery.remoteId,
        SellerCode: suppliedParams.SellerCode ?? "",
      },
    });
    const currentVerification = exactAdoptedBinding
      ? verifyQoo10ExactAdoptedLiveReadback({
          resultObject: currentRemote.data.ResultObject,
          expectedDetailImageUrls: exactLocalizedUpdate?.detailImageUrls ?? [],
          expectedDetailHtml: exactLocalizedUpdate.detailHtml,
          phase: "prewrite",
        })
      : verifyQoo10ExactCurrentS1Readback({
          resultObject: currentRemote.data.ResultObject,
          expectedDetailImageUrls: exactLocalizedUpdate?.detailImageUrls ?? [],
        });
    const currentStep = step(
      exactAdoptedBinding
        ? "qoo10-exact-adopted-live-prewrite-readback"
        : "qoo10-exact-current-s1-prewrite-readback",
      currentRemote,
    );
    currentStep.ok = currentStep.ok
      && qoo10ExactSuccessResultCode(currentRemote.data)
      && currentVerification.ok;
    currentStep.data = {
      ...currentStep.data,
      sellerpilotVerification: currentStep.ok
        ? exactAdoptedBinding
          ? "QOO10_EXACT_ADOPTED_S2_CONTAMINATION_AND_SURFACES_VERIFIED"
          : "QOO10_EXACT_CURRENT_S1_AND_IMAGES_VERIFIED"
        : exactAdoptedBinding
          ? "QOO10_EXACT_ADOPTED_S2_PREWRITE_MISMATCH"
          : "QOO10_EXACT_CURRENT_S1_OR_IMAGES_MISMATCH",
      sellerpilotExactCurrentChecks: currentVerification.checks,
      sellerpilotActualProviderStatus: currentVerification.providerStatus || null,
      sellerpilotExpectedDetailImageCount: 8,
      ...(!currentStep.ok ? { sellerpilotNoWriteConfirmed: true } : {}),
    };
    exactPrewriteSteps.push(currentStep);
    if (!currentStep.ok) return result(input, exactPrewriteSteps, updateRecovery.remoteId);
  }
  if (exactAdoptedBinding && exactLocalizedUpdate) {
    const publicationExpectation = qoo10PublicationExpectation(input);
    if (!publicationExpectation || Object.hasOwn(suppliedParams, "StandardImage")) {
      return result(input, [{
        name: "qoo10-exact-adopted-localization-content-only-fence",
        ok: false,
        status: 422,
        data: {
          ResultCode: -9999,
          ResultMsg: "QOO10_EXACT_ADOPTED_LOCALIZATION_CONTENT_ONLY_REQUIRED",
          sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
          sellerpilotNoWriteConfirmed: true,
        },
      }], updateRecovery?.remoteId);
    }
    let detailRemote: RemoteResponse;
    try {
      detailRemote = await qoo10Request({
        payload: input.payload,
        service: "ItemsContents",
        method: "EditGoodsContents",
        version: "1.0",
        params: {
          ItemCode: qoo10ExactLocalizationRecoveryIdentity.remoteId,
          SellerCode: "",
          Contents: exactLocalizedUpdate.detailHtml,
        },
      });
    } catch {
      detailRemote = qoo10UnavailableResponse(
        "QOO10_EXACT_ADOPTED_LOCALIZATION_RESPONSE_UNAVAILABLE",
      );
    }
    const detailStep = step("EditGoodsContents", detailRemote);
    const explicitRejection = qoo10ExplicitProviderRejection(detailRemote);
    detailStep.ok = detailStep.ok && qoo10ExactSuccessResultCode(detailRemote.data);
    detailStep.data = {
      ...detailStep.data,
      sellerpilotVerification: detailStep.ok
        ? "QOO10_EXACT_ADOPTED_LOCALIZATION_ACCEPTED"
        : explicitRejection
          ? "QOO10_EXACT_ADOPTED_LOCALIZATION_EXPLICITLY_REJECTED"
          : "QOO10_EXACT_ADOPTED_LOCALIZATION_OUTCOME_AMBIGUOUS",
      ...(explicitRejection ? { sellerpilotNoWriteConfirmed: true } : {}),
      ...(!detailStep.ok && !explicitRejection
        ? { sellerpilotReconciliationRequired: true }
        : {}),
    };

    let postReadbackStep: ChannelOperationStep | null = null;
    let verifiedRemoteState: VerifiedListingRemoteState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      let readback: RemoteResponse;
      try {
        readback = await qoo10Request({
          payload: input.payload,
          service: "ItemsLookup",
          method: "GetItemDetailInfo",
          version: "1.2",
          params: {
            ItemCode: qoo10ExactLocalizationRecoveryIdentity.remoteId,
            SellerCode: qoo10ExactLocalizationRecoveryIdentity.sellerSku,
          },
        });
      } catch {
        readback = qoo10UnavailableResponse(
          "QOO10_EXACT_ADOPTED_LOCALIZATION_POST_READBACK_UNAVAILABLE",
        );
      }
      const exactReadback = verifyQoo10ExactAdoptedLiveReadback({
        resultObject: readback.data.ResultObject,
        expectedDetailImageUrls: exactLocalizedUpdate.detailImageUrls,
        expectedDetailHtml: exactLocalizedUpdate.detailHtml,
        phase: "postwrite",
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: "listing.update",
        remoteId: qoo10ExactLocalizationRecoveryIdentity.remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: qoo10ExactLocalizationRecoveryIdentity.sellerSku,
        expectedRecovery: rollbackRecoveryReadbackExpectation!,
        ...publicationExpectation,
      });
      const publicationStep = qoo10PublicationReadbackStep(readback, publication);
      const ok = publicationStep.ok
        && exactReadback.ok
        && publication.providerStatus.trim().toUpperCase() === "S2"
        && publication.remoteState?.visibility === "live";
      postReadbackStep = {
        ...publicationStep,
        name: "qoo10-exact-adopted-localization-postwrite-readback",
        ok,
        data: {
          ...publicationStep.data,
          sellerpilotExactAdoptedChecks: exactReadback.checks,
          sellerpilotVerification: ok
            ? "QOO10_EXACT_ADOPTED_S2_LOCALIZATION_VERIFIED"
            : "QOO10_EXACT_ADOPTED_S2_LOCALIZATION_UNVERIFIED",
          ...(!ok && !explicitRejection
            ? { sellerpilotReconciliationRequired: true }
            : {}),
        },
      };
      if (ok && publication.remoteState) {
        detailStep.ok = true;
        detailStep.data = {
          ...detailStep.data,
          sellerpilotVerification: "QOO10_EXACT_ADOPTED_LOCALIZATION_CONFIRMED_BY_READBACK",
        };
        verifiedRemoteState = publication.remoteState;
        break;
      }
    }
    return result(
      input,
      [...exactPrewriteSteps, detailStep, postReadbackStep!],
      qoo10ExactLocalizationRecoveryIdentity.remoteId,
      undefined,
      verifiedRemoteState,
    );
  }
  let strictCreateExpectation: Qoo10ListingCreateExpectation | null = null;
  let sellerAccountIdentityDigest = "";
  let createPreflightSteps: ChannelOperationStep[] = exactPrewriteSteps;
  if (input.operation === "listing.create"
      && input.arguments.publicationStateContract === listingRemoteStateContractVersion) {
    const localPreflight = qoo10ListingCreateExpectation({
      arguments: input.arguments,
      payload: input.payload,
    });
    if (!localPreflight.ok) {
      return result(input, [{
        name: "qoo10-create-contract-preflight",
        ok: false,
        status: 422,
        data: {
          ResultCode: -9999,
          ResultMsg: localPreflight.code,
          sellerpilotVerification: "QOO10_CREATE_CONTRACT_UNVERIFIED",
          sellerpilotMismatchFields: localPreflight.mismatchFields,
        },
      }]);
    }
    strictCreateExpectation = localPreflight.expectation;
    const providerPreflight = await runQoo10ListingCreateProviderPreflight({
      payload: input.payload,
      expectation: strictCreateExpectation,
      request: qoo10Request,
    });
    createPreflightSteps = [{
      name: "qoo10-create-contract-preflight",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        ResultMsg: "QOO10_CREATE_CONTRACT_VERIFIED",
        sellerpilotVerification: "QOO10_CREATE_CONTRACT_VERIFIED",
        market: strictCreateExpectation.context.market,
        locale: strictCreateExpectation.context.locale,
        sourceCurrency: strictCreateExpectation.context.sourceCurrency,
        sourcePrice: strictCreateExpectation.context.sourcePrice,
        currency: strictCreateExpectation.context.currency,
        price: strictCreateExpectation.price,
        quantity: strictCreateExpectation.quantity,
        categoryCode: strictCreateExpectation.categoryCode,
        shippingNo: strictCreateExpectation.shippingNo,
        representativeImageDigest: strictCreateExpectation.standardImageDigest,
        detailImageDigest: strictCreateExpectation.detailImageDigest,
        publicationAssetDigest: strictCreateExpectation.publicationAssetDigest,
        detailImageCount: strictCreateExpectation.detailImageUrls.length,
        providerDetailHtmlMaximumBytes: 2_000_000_000,
        sellerpilotTransportMaximumBytes: 120_000,
      },
    }, ...providerPreflight.steps];
    if (!providerPreflight.ok || !providerPreflight.sellerAccountIdentityDigest) {
      return result(input, createPreflightSteps);
    }
    sellerAccountIdentityDigest = providerPreflight.sellerAccountIdentityDigest;
  }
  const inventoryQuantity = input.operation === "inventory.update"
    ? integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 })
    : null;
  const params = input.operation === "inventory.update"
    ? {
      ...suppliedParams,
      ItemCode: suppliedParams.ItemCode || stringArgument(input.arguments, "remoteId", false),
      Qty: String(inventoryQuantity),
    }
    : suppliedParams;
  if (input.operation === "inventory.update") delete params.ItemQty;
  if (params.ProductionPlace) params.ProductionPlace = qoo10ProductionPlace(params.ProductionPlace);
  const map: Partial<Record<ChannelOperationName, { service: string; method: string; version?: string }>> = {
    "listing.create": { service: "ItemsBasic", method: "SetNewGoods", version: "1.1" },
    "listing.update": { service: "ItemsBasic", method: "UpdateGoods" },
    "listing.stop": { service: "ItemsBasic", method: "EditGoodsStatus" },
    "price.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "inventory.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "orders.list": { service: "ShippingBasic", method: "GetShippingInfo_v3" },
    "inquiries.list": { service: "CSCenter", method: "GetInquiryMessage" },
    "inquiries.reply": { service: "CSCenter", method: "SetInquiryMessage" },
    "shipment.confirm": { service: "ShippingBasic", method: "SetSendingInfo" },
  };
  if (input.operation === "orders.get") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "GetShippingInfo_v3",
      params,
    });
    return result(input, [step("shipping-info", remote)]);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "SetSellerCheckYN_V2",
      params,
    });
    return result(input, [step("seller-check", remote)]);
  }
  if (input.operation === "price.update") {
    const request = qoo10PriceUpdateRequest(input, suppliedParams);
    const beforeRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: request.itemCode, SellerCode: "" },
    });
    const before = qoo10PricePrewriteStep(beforeRemote, request.itemCode, request.currency);
    if (!before.step.ok || before.snapshot?.quantity === null || before.snapshot?.quantity === undefined) {
      return result(input, [before.step], request.itemCode);
    }

    // The current QAPI contract names these fields Price and Qty. Preserve the
    // exact pre-write quantity so a price-only action cannot silently reset
    // inventory through SetGoodsPriceQty's documented Qty default.
    const updateRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsOrder",
      method: "SetGoodsPriceQty",
      params: {
        ItemCode: request.itemCode,
        Price: String(request.price),
        Qty: String(before.snapshot.quantity),
      },
    });
    const updateStep = step("SetGoodsPriceQty", updateRemote);
    if (!updateStep.ok) return result(input, [before.step, updateStep], request.itemCode);

    // QAPI warns that the public product page can take up to ten minutes to
    // reflect a change. A single bounded serverless request cannot turn a
    // missing immediate readback into success; the release gate remains closed
    // until an explicit-currency terminal readback contract exists.
    const afterRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: request.itemCode, SellerCode: "" },
    });
    return result(input, [
      before.step,
      updateStep,
      qoo10PriceReadbackStep(afterRemote, request),
    ], request.itemCode);
  }
  const definition = map[input.operation];
  if (!definition) throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const remote = await qoo10Request({ payload: input.payload, ...definition, params });
  const createStep = step(definition.method, remote);
  const resultObject = remote.data.ResultObject;
  const responseIdentities = qoo10UpdateResponseIdentities(resultObject);
  const responseRemoteId = typeof resultObject === "string" || typeof resultObject === "number"
    ? String(resultObject)
    : resultObject && typeof resultObject === "object" && !Array.isArray(resultObject)
      ? ["GdNo", "ItemCode", "itemCode"]
        .map((key) => (resultObject as Record<string, unknown>)[key])
        .find((value): value is string | number => typeof value === "string" || typeof value === "number")
        ?.toString()
      : undefined;
  const responseIdentityMismatch = Boolean(updateRecovery
    && responseIdentities.length > 0
    && (new Set(responseIdentities.map((identity) => identity.value)).size !== 1
      || responseIdentities.some((identity) => !identity.value
        || identity.value !== updateRecovery.remoteId
        || identity.value !== params.ItemCode)));
  if (updateRecovery && responseIdentityMismatch) {
    return result(input, [
      ...createPreflightSteps,
      createStep,
      {
        name: "qoo10-rollback-update-response-identity-mismatch",
        ok: false,
        status: remote.response.status,
        requestId: createStep.requestId,
        data: {
          ...remote.data,
          ResultMsg: "QOO10_ROLLBACK_UPDATE_RESPONSE_IDENTITY_MISMATCH",
          sellerpilotProviderResultMessage: qoo10ResultMessage(remote.data) || null,
          sellerpilotVerification: "QOO10_ROLLBACK_UPDATE_RESPONSE_IDENTITY_MISMATCH",
          sellerpilotExpectedRemoteId: updateRecovery.remoteId,
          sellerpilotExpectedItemCode: params.ItemCode,
          sellerpilotResponseIdentities: Object.fromEntries(
            responseIdentities.map((identity) => [identity.alias, identity.value || null]),
          ),
          sellerpilotReconciliationRequired: true,
        },
      },
    ], updateRecovery.remoteId);
  }
  const remoteId = updateRecovery?.remoteId ?? responseRemoteId
    ?? (input.operation === "listing.update" || input.operation === "listing.stop" ? params.ItemCode : undefined);
  const expectedRepresentativeImageContentId = input.operation === "listing.create" && remoteId
    ? qoo10SetNewGoodsMainImageContentId(resultObject, remoteId)
    : undefined;
  if (input.operation === "inventory.update") {
    const itemCode = params.ItemCode;
    if (!createStep.ok) return result(input, [createStep], itemCode || remoteId);
    let lastVerification: ChannelOperationStep | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: itemCode, SellerCode: params.SellerCode ?? "" },
      });
      lastVerification = inventoryQuantityVerificationStep(
        "GetItemDetailInfo",
        readback,
        inventoryQuantity ?? 0,
        qoo10InventoryQuantity(readback.data.ResultObject, itemCode),
      );
      if (lastVerification.ok) return result(input, [createStep, lastVerification], itemCode || remoteId);
    }
    return result(input, [createStep, lastVerification!], itemCode || remoteId);
  }
  if (input.operation === "listing.stop") {
    if (!createStep.ok || !remoteId) return result(input, [createStep], remoteId);
    const expectation = qoo10PublicationExpectation(input);
    if (!expectation) return result(input, [createStep], remoteId);
    let lastReadbackStep: ChannelOperationStep | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      let readback: RemoteResponse;
      try {
        readback = await qoo10Request({
          payload: input.payload,
          service: "ItemsLookup",
          method: "GetItemDetailInfo",
          version: "1.2",
          params: { ItemCode: remoteId, SellerCode: params.SellerCode ?? "" },
        });
      } catch {
        readback = {
          response: new Response(null, { status: 503 }),
          text: "",
          data: { ResultCode: -9999, ResultMsg: "QOO10_PUBLICATION_READBACK_UNAVAILABLE" },
        };
      }
      const verification = normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        ...expectation,
      });
      const remoteState = verification.remoteState;
      lastReadbackStep = qoo10PublicationReadbackStep(readback, verification);
      if (lastReadbackStep.ok) {
        return result(input, [createStep, lastReadbackStep], remoteId, undefined, remoteState);
      }
    }
    return result(input, [createStep, lastReadbackStep!], remoteId);
  }
  const publicationExpectation = qoo10PublicationExpectation(input);
  if (updateRecovery
      && rollbackRecoveryReadbackExpectation
      && publicationExpectation
      && qoo10ExplicitProviderRejection(remote)) {
    let rejectionReadbackStep: ChannelOperationStep | null = null;
    let rejectionRemoteState: VerifiedListingRemoteState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: updateRecovery.remoteId, SellerCode: params.SellerCode ?? "" },
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: "listing.update",
        remoteId: updateRecovery.remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        expectedRecovery: rollbackRecoveryReadbackExpectation,
        ...publicationExpectation,
      });
      const mutable = listingUpdateReadbackStep(
        "qoo10-rollback-update-rejection-mutable-readback",
        readback,
        input.channel,
        input.arguments,
      );
      rejectionReadbackStep = qoo10RollbackRecoveryReadbackStep({
        phase: "update_rejection_s1",
        remote: readback,
        publication,
        mutable,
        expectedDetailImages: rollbackRecoveryReadbackExpectation.detailImageUrls.length,
      });
      if (rejectionReadbackStep.ok && publication.remoteState) {
        rejectionRemoteState = publication.remoteState;
        break;
      }
    }
    return result(input, [
      ...createPreflightSteps,
      createStep,
      rejectionReadbackStep!,
    ], updateRecovery.remoteId, undefined, rejectionRemoteState);
  }
  if ((input.operation !== "listing.create" && input.operation !== "listing.update") || !createStep.ok || !remoteId) {
    return result(input, [...createPreflightSteps, createStep], remoteId);
  }

  // SetNewGoods accepts ItemDescription, but Qoo10 exposes a dedicated
  // EditGoodsContents method for the public product-detail surface. Persist the
  // same verified HTML through that method before treating the create as done.
  const detailHtml = params.ItemDescription ?? "";
  const expectedDetailImages = qoo10ImageCount(detailHtml);
  const minimumExpectedDetailImages = input.arguments.sellerpilotContentMode === "manual_mvp"
    ? 1
    : marketplaceChannelDetailImageCount;
  const detailUpdate = await qoo10Request({
    payload: input.payload,
    service: "ItemsContents",
    method: "EditGoodsContents",
    version: "1.0",
    params: { ItemCode: remoteId, SellerCode: "", Contents: detailHtml },
  });
  const detailUpdateStep = step("EditGoodsContents", detailUpdate);
  let readbackStatus = 422;
  let readbackImageCount = 0;
  let readbackAccepted = false;
  let updateReadbackStep: ChannelOperationStep | null = null;
  if (updateRecovery) {
    if (!detailUpdateStep.ok || !publicationExpectation) {
      return result(input, [
        ...createPreflightSteps,
        createStep,
        detailUpdateStep,
      ], remoteId);
    }
    // Keep the confirmed S1 item non-public while validating the just-written
    // content. Only an exact mutable-field and eight-image S1 readback may
    // cross the separate activation mutation.
    let preActivationStep: ChannelOperationStep | null = null;
    let preActivationRemoteState: VerifiedListingRemoteState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: remoteId, SellerCode: params.SellerCode ?? "" },
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        expectedRecovery: rollbackRecoveryReadbackExpectation!,
        ...publicationExpectation!,
      });
      const mutable = listingUpdateReadbackStep(
        "qoo10-rollback-pre-activation-mutable-readback",
        readback,
        input.channel,
        input.arguments,
      );
      preActivationStep = qoo10RollbackRecoveryReadbackStep({
        phase: "pre_activation",
        remote: readback,
        publication,
        mutable,
        expectedDetailImages,
      });
      if (preActivationStep.ok) {
        preActivationRemoteState = publication.remoteState;
        break;
      }
    }
    if (!preActivationStep?.ok) {
      return result(input, [
        ...createPreflightSteps,
        createStep,
        detailUpdateStep,
        preActivationStep!,
      ], remoteId);
    }

    // This one exact product remains S1 after the corrected update. A fresh
    // verifier must bind the observed localized copy before root opens the
    // separate, single-use listing.activate permit in the final release.
    if (exactLocalizedUpdate) {
      return result(input, [
        ...createPreflightSteps,
        createStep,
        detailUpdateStep,
        preActivationStep,
      ], remoteId, undefined, preActivationRemoteState);
    }

    const activation = await qoo10Request({
      payload: input.payload,
      service: "ItemsBasic",
      method: "EditGoodsStatus",
      params: { ItemCode: remoteId, Status: "2" },
    });
    const activationStep = step("qoo10-rollback-recovery-activate", activation);
    if (!activationStep.ok) {
      return result(input, [
        ...createPreflightSteps,
        createStep,
        detailUpdateStep,
        preActivationStep,
        activationStep,
      ], remoteId);
    }

    let postActivationStep: ChannelOperationStep | null = null;
    let activatedRemoteState: VerifiedListingRemoteState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: remoteId, SellerCode: params.SellerCode ?? "" },
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        expectedRecovery: rollbackRecoveryReadbackExpectation!,
        ...publicationExpectation!,
      });
      const mutable = listingUpdateReadbackStep(
        "qoo10-rollback-post-activation-mutable-readback",
        readback,
        input.channel,
        input.arguments,
      );
      postActivationStep = qoo10RollbackRecoveryReadbackStep({
        phase: "post_activation",
        remote: readback,
        publication,
        mutable,
        expectedDetailImages,
      });
      if (postActivationStep.ok && publication.remoteState) {
        activatedRemoteState = publication.remoteState;
        break;
      }
    }
    return result(input, [
      ...createPreflightSteps,
      createStep,
      detailUpdateStep,
      preActivationStep,
      activationStep,
      postActivationStep!,
    ], remoteId, undefined, activatedRemoteState);
  }
  for (let attempt = 0; detailUpdateStep.ok && attempt < 4; attempt += 1) {
    if (attempt > 0) await operationDelay(750 * attempt);
    const readback = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: remoteId, SellerCode: "" },
    });
    const readbackStep = step("GetItemDetailInfo", readback);
    readbackStatus = readbackStep.status;
    readbackAccepted = readbackStep.ok;
    readbackImageCount = qoo10ImageCount(qoo10DetailHtml(readback.data.ResultObject));
    const publicationVerification = publicationExpectation
      ? normalizeQoo10ListingPublicationReadback({
          operation: input.operation,
          remoteId,
          resultObject: readback.data.ResultObject,
          expectedSellerCode: params.SellerCode || undefined,
          ...(strictCreateExpectation
            ? {
                expectedCreate: strictCreateExpectation,
                expectedSellerAccountIdentityDigest: sellerAccountIdentityDigest,
                ...(expectedRepresentativeImageContentId
                  ? { expectedRepresentativeImageContentId }
                  : {}),
              }
            : {}),
          ...publicationExpectation,
        })
      : null;
    const remoteState = publicationVerification?.remoteState;
    const publicationReadbackStep = publicationVerification
      ? qoo10PublicationReadbackStep(readback, publicationVerification)
      : null;
    if (
      readbackStep.ok
      && expectedDetailImages >= minimumExpectedDetailImages
      && readbackImageCount >= expectedDetailImages
      && (!publicationReadbackStep || publicationReadbackStep.ok)
    ) {
      if (input.operation === "listing.update") {
        updateReadbackStep = listingUpdateReadbackStep("detail-image-readback", readback, input.channel, input.arguments);
        updateReadbackStep.ok = updateReadbackStep.ok && readbackImageCount >= expectedDetailImages;
        updateReadbackStep.data = { ...updateReadbackStep.data, detailImageCount: readbackImageCount };
        if (!updateReadbackStep.ok) continue;
        return result(
          input,
          [...createPreflightSteps, createStep, detailUpdateStep, updateReadbackStep, ...(publicationReadbackStep ? [publicationReadbackStep] : [])],
          remoteId,
          undefined,
          remoteState,
        );
      }
      return result(
        input,
        [
          ...createPreflightSteps,
          createStep,
          detailUpdateStep,
          qoo10VerificationStep(true, readbackStatus, readbackImageCount),
          ...(publicationReadbackStep ? [publicationReadbackStep] : []),
        ],
        remoteId,
        undefined,
        remoteState,
      );
    }
    if (publicationReadbackStep && !publicationReadbackStep.ok) updateReadbackStep = publicationReadbackStep;
  }

  if (input.operation === "listing.update") {
    updateReadbackStep ??= {
      ...qoo10VerificationStep(false, readbackStatus, readbackImageCount),
      data: {
        ...qoo10VerificationStep(false, readbackStatus, readbackImageCount).data,
        sellerpilotVerification: "LISTING_MUTABLE_FIELDS_MISMATCH",
      },
    };
    return result(input, [
      ...createPreflightSteps,
      createStep,
      detailUpdateStep,
      updateReadbackStep,
    ], remoteId);
  }

  // A create response is not sufficient: Qoo10 can accept the item while
  // omitting its long detail HTML. Pause that incomplete remote item so it
  // cannot remain orderable, and report a failed verification to the ledger.
  const rollback = await qoo10Request({
    payload: input.payload,
    service: "ItemsBasic",
    method: "EditGoodsStatus",
    params: { ItemCode: remoteId, Status: "1" },
  });
  const detailImagesVerified = readbackAccepted
    && expectedDetailImages >= minimumExpectedDetailImages
    && readbackImageCount >= expectedDetailImages;
  return result(input, [
    ...createPreflightSteps,
    createStep,
    detailUpdateStep,
    qoo10VerificationStep(detailImagesVerified, readbackStatus, readbackImageCount),
    ...(updateReadbackStep ? [updateReadbackStep] : []),
    step("rollback-missing-detail", rollback),
  ], remoteId);
}

function shopeeResponseId(data: Record<string, unknown>, key: string) {
  const response = data.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const value = (response as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function verifiedPublicationArguments(input: ExecuteInput) {
  return {
    expectedLocale: stringArgument(input.arguments, "publicationExpectedLocale"),
    expectedFingerprint: stringArgument(input.arguments, "publicationExpectedFingerprint"),
    expectedImageCount: integerArgument(input.arguments, "publicationExpectedImageCount", { min: 0, max: 64 }),
  };
}

function applyShopeePublicationVerification(
  readbackStep: ChannelOperationStep,
  verification: ShopeePublicationReadbackVerification,
) {
  readbackStep.ok = readbackStep.ok && Boolean(verification.remoteState);
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotPublicationVerification: verification.remoteState
      ? "SHOPEE_PUBLICATION_STATE_VERIFIED"
      : "SHOPEE_PUBLICATION_STATE_UNVERIFIED",
    providerStatus: verification.providerStatus,
    actualImageCount: verification.imageCount,
    sellerpilotPublicationChecks: verification.checks,
  };
  return readbackStep;
}

function applyLazadaPublicationVerification(
  readbackStep: ChannelOperationStep,
  verification: LazadaPublicationReadbackVerification,
) {
  readbackStep.ok = readbackStep.ok && Boolean(verification.remoteState);
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotPublicationVerification: verification.remoteState
      ? "LAZADA_PUBLICATION_STATE_VERIFIED"
      : "LAZADA_PUBLICATION_STATE_UNVERIFIED",
    providerStatus: verification.providerStatus,
    actualImageCount: verification.imageCount,
    sellerpilotPublicationChecks: verification.checks,
  };
  return readbackStep;
}

function shopeeOrderPageWithCredentialIdentity(
  remote: RemoteResponse,
  payload: SecretPayload,
): RemoteResponse {
  const shopId = textValue(payload, "shop_id");
  if (!/^[1-9][0-9]{0,31}$/.test(shopId)) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_SHOP_ID_INVALID");
  }
  const merchantId = textValue(payload, "merchant_id");
  if (merchantId && !/^[1-9][0-9]{0,31}$/.test(merchantId)) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_MERCHANT_ID_INVALID");
  }
  const providerIdentityVersion = textValue(payload, "provider_account_identity_version");
  const providerSubject = textValue(payload, "provider_account_subject");
  const mainAccountId = textValue(payload, "main_account_id");
  const targetIds = (key: "shop_ids" | "merchant_ids") => Array.isArray(payload[key])
    ? payload[key].map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const targets = objectArray(payload.shopee_targets);
  const mainIdentity = providerIdentityVersion === "v1"
    && /^[1-9][0-9]{0,31}$/.test(mainAccountId)
    && providerSubject === `shopee:main:${mainAccountId}`;
  if (providerIdentityVersion || providerSubject) {
    const directShopIdentity = providerIdentityVersion === "v1"
      && providerSubject === `shopee:shop:${shopId}`;
    const mainShopAuthorized = mainIdentity
      && targetIds("shop_ids").includes(shopId)
      && targets.some((target) => target.type === "shop" && String(target.id ?? "").trim() === shopId);
    if (!directShopIdentity && !mainShopAuthorized) {
      throw new Error("SHOPEE_ORDER_CREDENTIAL_LINEAGE_MISMATCH");
    }
  }
  if (merchantId && (!mainIdentity
      || !targetIds("merchant_ids").includes(merchantId)
      || !targets.some((target) => target.type === "merchant" && String(target.id ?? "").trim() === merchantId))) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_MERCHANT_LINEAGE_MISMATCH");
  }

  const response = nestedObject(remote.data.response);
  const pageShopIds = [remote.data.shop_id, remote.data.shopId, response.shop_id, response.shopId]
    .concat(objectArray(response.order_list).flatMap((order) => [order.shop_id, order.shopId]))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (pageShopIds.some((value) => value !== shopId)) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_LINEAGE_MISMATCH");
  }

  return {
    ...remote,
    data: {
      ...remote.data,
      sellerpilotProviderContext: {
        shopId,
        ...(merchantId ? { merchantId } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Channel-native image upload (Shopee media_space, Lazada MigrateImage /
// UploadImage). The normalization pipeline leaves public Supabase URLs in
// arguments.imageUrls; before a listing.create write these URLs are migrated
// into the channel's own media space and the resulting native references are
// injected back into the request payload. When native upload is not possible
// (no source URLs, missing credentials, missing target structure) or fails,
// the existing URL injection is preserved and the original arguments are used
// unchanged.
// ---------------------------------------------------------------------------

function nativeImageSourceUrls(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function shopeeBodyHasNativeImageIds(body: Record<string, unknown>) {
  const image = objectValue(body, "image", false);
  return Array.isArray(image.image_id_list)
    && image.image_id_list.some((value) => String(value ?? "").trim());
}

async function prepareShopeeNativeImageBody(input: ExecuteInput): Promise<Record<string, unknown>> {
  const body = objectValue(input.arguments, "body");
  // The provider-listing runtime may already have populated native image ids
  // (for example inside the serverless gateway worker). Re-uploading would
  // orphan those assets and renumber the gallery, so keep them as-is.
  if (shopeeBodyHasNativeImageIds(body)) return body;
  if (!nativeImageSourceUrls(input.arguments.imageUrls).length) return body;
  try {
    const uploaded = await uploadChannelNativeImages({
      channel: "shopee",
      payload: input.payload,
      environment: input.environment,
      argumentsValue: input.arguments,
    });
    if (!uploaded.ok) return body;
    return objectValue(uploaded.argumentsValue, "body");
  } catch {
    return body;
  }
}

function lazadaRequestHasNativeImages(argumentsValue: Record<string, unknown>) {
  const request = objectValue(argumentsValue, "request", false);
  const requestRoot = objectValue(request, "Request", false);
  const product = objectValue(requestRoot, "Product", false);
  const images = objectValue(product, "Images", false);
  const listing = Array.isArray(images.Image)
    ? images.Image.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  return listing.length > 0 && listing.every((url) => url.includes("slatic.net"));
}

async function prepareLazadaNativeImageArguments(
  input: ExecuteInput,
  argumentsValue: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // The provider-listing runtime migrates Lazada gallery/SKU/description
  // images into slatic.net media space before execution reaches this point.
  if (lazadaRequestHasNativeImages(argumentsValue)) return argumentsValue;
  if (!nativeImageSourceUrls(argumentsValue.imageUrls).length) return argumentsValue;
  try {
    const uploaded = await uploadChannelNativeImages({
      channel: "lazada",
      payload: input.payload,
      environment: input.environment,
      argumentsValue,
    });
    return uploaded.ok ? uploaded.argumentsValue : argumentsValue;
  } catch {
    return argumentsValue;
  }
}

async function executeShopee(input: ExecuteInput) {
  const globalProduct = booleanArgument(input.arguments, "globalProduct");
  const publicationIntent = listingPublicationIntentFromArguments(input.arguments);
  const verifiedPublicationRequested = input.arguments.publicationStateContract === listingRemoteStateContractVersion;
  if (verifiedPublicationRequested
      && input.operation === "listing.create"
      && publicationIntent === "safe_test"
      && !globalProduct) {
    throw new Error("SHOPEE_SAFE_TEST_REQUIRES_GLOBAL_PUBLISH");
  }
  if (globalProduct && (input.operation === "categories.list" || input.operation === "categories.suggest")) {
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("global-categories", remote)]);
  }
  if (globalProduct && input.operation === "categories.attributes") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list")) query.set("category_id_list", categoryId);
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_attribute_tree",
      query,
    });
    return result(input, [step("global-category-attribute-tree", remote)], categoryId);
  }
  if (globalProduct && input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const categoryQuery = queryParams(input.arguments);
    categoryQuery.delete("category_id");
    categoryQuery.delete("category_id_list");
    if (!categoryQuery.has("language")) categoryQuery.set("language", "en");
    const attributeQuery = new URLSearchParams(categoryQuery);
    attributeQuery.set("category_id_list", categoryId);
    const [categoryRemote, attributeRemote] = await Promise.all([
      shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_category",
        query: categoryQuery,
      }),
      shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_attribute_tree",
        query: attributeQuery,
      }),
    ]);
    const exactPath = shopeeExactGlobalCategoryPath(categoryRemote.data, categoryId);
    const categoryStep = step("global-category-exact-leaf", categoryRemote);
    categoryStep.ok = categoryStep.ok && Boolean(exactPath);
    categoryStep.data = {
      ...categoryStep.data,
      sellerpilotVerification: categoryStep.ok
        ? "SHOPEE_EXACT_GLOBAL_LEAF_CATEGORY_VERIFIED"
        : "SHOPEE_EXACT_GLOBAL_LEAF_CATEGORY_UNVERIFIED",
      categoryId,
      categoryPathIds: exactPath?.ids ?? [],
      categoryPath: exactPath?.names ?? [],
      exactLeafMatchCount: exactPath ? 1 : 0,
    };
    return result(input, [
      categoryStep,
      step("global-category-attribute-tree", attributeRemote),
    ], categoryId);
  }
  if (globalProduct && input.operation === "listing.create") {
    let globalItemId = stringArgument(input.arguments, "globalItemId", false);
    const steps: ChannelOperationStep[] = [];
    const suppliedPublish = objectValue(input.arguments, "publish", false);
    if (verifiedPublicationRequested && (!publicationIntent || !Object.keys(suppliedPublish).length)) {
      throw new Error("SHOPEE_VERIFIED_PUBLISH_ARGUMENTS_REQUIRED");
    }
    const publish = structuredClone(suppliedPublish);
    const publishItem = objectValue(publish, "item", false);
    if (publicationIntent && Object.keys(publish).length) {
      publish.item = {
        ...publishItem,
        item_status: publicationIntent === "safe_test" ? "UNLIST" : "NORMAL",
      };
    }
    const finalLocalReadback = (localItemId: string) => result(input, steps, localItemId);
    if (!globalItemId) {
      const createRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/add_global_item",
        body: objectValue(input.arguments, "body"),
      });
      const createStep = step("global-item-create", createRemote);
      globalItemId = shopeeResponseId(createRemote.data, "global_item_id") ?? "";
      steps.push(createStep);
      if (!createStep.ok || !globalItemId) return result(input, steps, globalItemId || undefined);
    }

    const readbackRemote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_global_item_info",
      query: new URLSearchParams({ global_item_id_list: globalItemId }),
    });
    steps.push(step("global-item-readback", readbackRemote));
    const publishedItem = async (maxAttempts = 1) => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3_000));
        const remote = await shopeeMerchantRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/global_product/get_published_list",
          query: new URLSearchParams({ global_item_id: globalItemId }),
        });
        const publishedStep = step(attempt === 0 ? "published-item-readback" : `published-item-readback-${attempt + 1}`, remote);
        steps.push(publishedStep);
        const response = remote.data.response;
        const rows = response && typeof response === "object" && !Array.isArray(response)
          && Array.isArray((response as Record<string, unknown>).published_item)
          ? (response as { published_item: unknown[] }).published_item
          : [];
        const requestedShopId = String(publish.shop_id ?? "");
        const row = rows.find((item) => item && typeof item === "object" && !Array.isArray(item)
          && (!requestedShopId || String((item as Record<string, unknown>).shop_id ?? "") === requestedShopId)) as Record<string, unknown> | undefined;
        const itemId = row?.item_id;
        if (typeof itemId === "string" || typeof itemId === "number") return { itemId: String(itemId), ok: publishedStep.ok };
        if (!publishedStep.ok) return { itemId: "", ok: false };
      }
      return { itemId: "", ok: true };
    };
    if (booleanArgument(input.arguments, "recoverPublished")) {
      const published = await publishedItem();
      return published.itemId
        ? finalLocalReadback(published.itemId)
        : result(input, steps, globalItemId);
    }
    let publishTaskId = stringArgument(input.arguments, "publishTaskId", false);
    if (!publishTaskId) {
      if (!Object.keys(publish).length) return result(input, steps, globalItemId);
      const publishRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/create_publish_task",
        body: { ...publish, global_item_id: Number(globalItemId) },
      });
      const publishStep = step("publish-task-create", publishRemote);
      steps.push(publishStep);
      publishTaskId = shopeeResponseId(publishRemote.data, "publish_task_id") ?? "";
      if (!publishStep.ok || !publishTaskId) {
        const alreadyPublished = String(publishRemote.data.message ?? "").toLowerCase().includes("published this global item");
        if (!alreadyPublished) return result(input, steps, globalItemId);
        const published = await publishedItem();
        if (published.ok && published.itemId) publishStep.ok = true;
        return result(input, steps, published.itemId || globalItemId);
      }
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const taskRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_publish_task_result",
        query: new URLSearchParams({ publish_task_id: publishTaskId }),
      });
      const taskStep = step(`publish-task-result-${attempt + 1}`, taskRemote);
      const transientNotFound = String(taskRemote.data.message ?? "").toLowerCase().includes("task not found");
      if (transientNotFound && attempt < 5) continue;
      const response = taskRemote.data.response;
      const responseRecord = response && typeof response === "object" && !Array.isArray(response)
        ? response as Record<string, unknown>
        : {};
      const status = String(responseRecord.publish_status ?? responseRecord.status ?? "").toUpperCase();
      if (["FAILED", "FAIL"].includes(status)) taskStep.ok = false;
      const terminal = ["SUCCESS", "FAILED", "FAIL", "COMPLETED", "DONE"].includes(status);
      if (terminal || !taskStep.ok || attempt === 5) {
        if (!terminal && taskStep.ok) taskStep.ok = false;
        steps.push(taskStep);
        break;
      }
    }
    const published = await publishedItem(4);
    if (published.ok && published.itemId) {
      for (const item of steps) if (item.name.startsWith("publish-task-result-")) item.ok = true;
    }
    return published.itemId
      ? finalLocalReadback(published.itemId)
      : result(input, steps, globalItemId);
  }
  if (input.operation === "categories.list" || input.operation === "categories.suggest") {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list")) query.set("category_id_list", categoryId);
    const treeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_attribute_tree",
      query,
    });
    const treeStep = step("category-attribute-tree", treeRemote);
    if (treeStep.ok) return result(input, [treeStep], categoryId);
    const error = String(treeRemote.data.error ?? "");
    if (!new Set(["api_suspended", "error_not_found", "wrong_path"]).has(error)) {
      return result(input, [treeStep], categoryId);
    }
    query.delete("category_id_list");
    query.set("category_id", categoryId);
    const legacyRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_attributes",
      query,
    });
    return result(input, [step("category-attributes-compatibility", legacyRemote)], categoryId);
  }
  if (input.operation === "inventory.update") {
    const exactExisting = shopeeSgExistingUpdateBinding(input.arguments, "inventory")
      ? assertShopeeSgExistingInventorySource(input.arguments)
      : null;
    const suppliedBody = input.arguments.body ? objectValue(input.arguments, "body") : null;
    const itemId = suppliedBody
      ? String(suppliedBody.item_id ?? suppliedBody.itemId ?? "").trim()
      : stringArgument(input.arguments, "itemId");
    if (!itemId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:itemId");
    const suppliedStockList = suppliedBody && Array.isArray(suppliedBody.stock_list)
      ? suppliedBody.stock_list as Array<Record<string, unknown>>
      : [];
    const suppliedQuantity = suppliedStockList
      .flatMap((stock) => Array.isArray(stock.seller_stock) ? stock.seller_stock as Array<Record<string, unknown>> : [])
      .map((stock) => stock.stock)
      .find((value) => Number.isInteger(Number(value)));
    const quantity = suppliedQuantity === undefined
      ? integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 })
      : Number(suppliedQuantity);
    const steps: ChannelOperationStep[] = [];
    if (exactExisting) {
      const [shopRemote, itemRemote] = await Promise.all([
        shopeeRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/shop/get_shop_info",
        }),
        shopeeRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/product/get_item_base_info",
          query: new URLSearchParams({ item_id_list: exactExisting.itemId }),
        }),
      ]);
      const exactPreflightStep = step("shopee-sg-existing-inventory-prewrite", itemRemote);
      exactPreflightStep.ok = exactPreflightStep.ok
        && shopRemote.response.ok
        && !shopRemote.data.error
        && verifyShopeeSgExistingUpdatePrewrite({
          argumentsValue: input.arguments,
          credentialPayload: input.payload,
          shopRemoteData: shopRemote.data,
          itemRemoteData: itemRemote.data,
          phase: "inventory",
        });
      exactPreflightStep.data = {
        ...exactPreflightStep.data,
        sellerpilotVerification: exactPreflightStep.ok
          ? "SHOPEE_SG_EXISTING_INVENTORY_PREWRITE_VERIFIED"
          : "SHOPEE_SG_EXISTING_INVENTORY_PREWRITE_MISMATCH",
      };
      steps.push(exactPreflightStep);
      if (!exactPreflightStep.ok) return result(input, steps, itemId);
      if (!input.providerMutationHooks) {
        return result(input, [...steps, {
          name: "shopee-sg-existing-inventory-provider-boundary",
          ok: false,
          status: 409,
          data: {
            sellerpilotNoWriteConfirmed: true,
            sellerpilotVerification: "SHOPEE_SG_EXISTING_INVENTORY_PROVIDER_BOUNDARY_REQUIRED",
          },
        }], itemId);
      }
    }
    let writeBody = suppliedBody;
    if (!writeBody) {
      const modelsRemote = await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_model_list",
        query: new URLSearchParams({ item_id: itemId }),
      });
      const modelsStep = step("inventory-models", modelsRemote);
      steps.push(modelsStep);
      if (!modelsStep.ok) return result(input, steps, itemId);
      const response = objectValue(modelsRemote.data, "response", false);
      const modelList = Array.isArray(response.model) ? response.model.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
      const stockList = modelList.length
        ? modelList.map((model) => ({ model_id: Number(model.model_id), seller_stock: [{ stock: quantity }] }))
        : [{ model_id: 0, seller_stock: [{ stock: quantity }] }];
      writeBody = { item_id: Number(itemId), stock_list: stockList };
    }
    if (exactExisting) {
      await input.providerMutationHooks!.assertLeaseHealthy();
      await input.providerMutationHooks!.begin();
      await input.providerMutationHooks!.assertLeaseHealthy();
    }
    const writeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/api/v2/product/update_stock",
      body: writeBody,
    });
    const writeStep = step("inventory.update", writeRemote);
    steps.push(writeStep);
    if (!writeStep.ok) return result(input, steps, itemId);
    const readback = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_item_base_info",
      query: new URLSearchParams({ item_id_list: itemId }),
    });
    const response = objectValue(readback.data, "response", false);
    const itemList = Array.isArray(response.item_list) ? response.item_list as Array<Record<string, unknown>> : [];
    const item = itemList.find((candidate) => String(candidate.item_id ?? "") === itemId) ?? itemList[0] ?? {};
    const stockInfo = objectValue(item, "stock_info_v2", false);
    const summaryInfo = objectValue(stockInfo, "summary_info", false);
    const readbackStep = inventoryQuantityVerificationStep(
      "inventory-readback",
      readback,
      quantity,
      summaryInfo.total_available_stock,
    );
    if (exactExisting) {
      const exactEvidence = verifyShopeeSgExistingInventoryReadback({
        argumentsValue: input.arguments,
        remoteData: readback.data,
      });
      readbackStep.ok = readbackStep.ok && Boolean(exactEvidence);
      readbackStep.data = {
        ...readbackStep.data,
        ...(exactEvidence ? { sellerpilotShopeeSgExistingReadback: exactEvidence } : {}),
      };
    }
    steps.push(readbackStep);
    return result(input, steps, itemId);
  }
  if (input.operation === "listing.update") {
    const exactExisting = shopeeSgExistingUpdateBinding(input.arguments, "content")
      ? assertShopeeSgExistingContentSource(input.arguments)
      : null;
    const localItemId = stringArgument(input.arguments, "localItemId");
    const body = objectValue(input.arguments, "body");
    if (String(body.item_id ?? "") !== localItemId) throw new Error("SHOPEE_LOCAL_ITEM_ID_MISMATCH");
    const readLocalItem = () => shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_item_base_info",
      query: new URLSearchParams({ item_id_list: localItemId }),
    });
    const [preflightRemote, shopRemote] = exactExisting
      ? await Promise.all([
          readLocalItem(),
          shopeeRequest({
            payload: input.payload,
            environment: input.environment,
            method: "GET",
            path: "/api/v2/shop/get_shop_info",
          }),
        ])
      : [await readLocalItem(), null];
    const preflightStep = step("local-item-preflight", preflightRemote);
    const preflightResponse = objectValue(preflightRemote.data, "response", false);
    const preflightItems = Array.isArray(preflightResponse.item_list)
      ? preflightResponse.item_list as Array<Record<string, unknown>>
      : [];
    const localIdentityVerified = preflightItems.some((item) => String(item.item_id ?? "") === localItemId);
    preflightStep.ok = preflightStep.ok && localIdentityVerified;
    if (exactExisting) {
      preflightStep.ok = preflightStep.ok
        && Boolean(shopRemote?.response.ok)
        && !shopRemote?.data.error
        && verifyShopeeSgExistingUpdatePrewrite({
          argumentsValue: input.arguments,
          credentialPayload: input.payload,
          shopRemoteData: shopRemote?.data ?? {},
          itemRemoteData: preflightRemote.data,
          phase: "content",
        });
    }
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok ? "SHOPEE_LOCAL_ITEM_ID_VERIFIED" : "SHOPEE_LOCAL_ITEM_ID_NOT_FOUND",
    };
    if (!preflightStep.ok) return result(input, [preflightStep], localItemId);

    const writeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/api/v2/product/update_item",
      body,
    });
    const writeStep = step("listing.update", writeRemote);
    if (!writeStep.ok) return result(input, [preflightStep, writeStep], localItemId);
    if (verifiedPublicationRequested) {
      const verification = await readShopeeListingPublicationState({
        payload: input.payload,
        environment: input.environment,
        operation: input.operation,
        remoteId: localItemId,
        mutationArguments: input.arguments,
        ...verifiedPublicationArguments(input),
      });
      const readbackStep = applyShopeePublicationVerification(
        listingUpdateReadbackStep("listing-readback", verification.remote, input.channel, input.arguments),
        verification,
      );
      if (exactExisting) {
        const exactEvidence = verifyShopeeSgExistingContentReadback({
          argumentsValue: input.arguments,
          remoteData: verification.remote.data,
        });
        readbackStep.ok = readbackStep.ok && Boolean(exactEvidence);
        readbackStep.data = {
          ...readbackStep.data,
          ...(exactEvidence ? { sellerpilotShopeeSgExistingReadback: exactEvidence } : {}),
        };
      }
      return result(input, [preflightStep, writeStep, readbackStep], localItemId, undefined, verification.remoteState);
    }
    const readbackRemote = await readLocalItem();
    const readbackStep = listingUpdateReadbackStep("listing-readback", readbackRemote, input.channel, input.arguments);
    return result(input, [preflightStep, writeStep, readbackStep], localItemId);
  }
  const writePaths: Partial<Record<ChannelOperationName, string>> = {
    "listing.create": "/api/v2/product/add_item",
    "listing.stop": "/api/v2/product/unlist_item",
    "price.update": "/api/v2/product/update_price",
    "inventory.update": "/api/v2/product/update_stock",
    "shipment.confirm": "/api/v2/logistics/ship_order",
  };
  const writePath = writePaths[input.operation];
  if (writePath) {
    const body = input.operation === "listing.create"
      ? await prepareShopeeNativeImageBody(input)
      : objectValue(input.arguments, "body");
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: writePath,
      body,
    });
    const responseRemoteId = shopeeResponseId(remote.data, input.operation === "listing.create" ? "item_id" : "request_id");
    const requestedItemId = input.operation === "listing.stop"
      ? String(body.item_id ?? "").trim()
      : "";
    const remoteId = requestedItemId || responseRemoteId;
    const writeStep = step(input.operation, remote);
    if ((input.operation === "listing.create" || input.operation === "listing.stop")
        && writeStep.ok
        && remoteId
        && verifiedPublicationRequested) {
      const verification = await readShopeeListingPublicationState({
        payload: input.payload,
        environment: input.environment,
        operation: input.operation,
        remoteId,
        mutationArguments: input.arguments,
        ...verifiedPublicationArguments(input),
      });
      const readbackStep = applyShopeePublicationVerification(
        step("listing-readback", verification.remote),
        verification,
      );
      return result(input, [writeStep, readbackStep], remoteId, undefined, verification.remoteState);
    }
    if (input.operation === "listing.create" && writeStep.ok && remoteId) {
      const readback = await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_item_base_info",
        query: new URLSearchParams({ item_id_list: remoteId }),
      });
      const readbackStep = step("listing-readback", readback);
      const response = objectValue(readback.data, "response", false);
      const itemList = Array.isArray(response.item_list) ? response.item_list as Array<Record<string, unknown>> : [];
      readbackStep.ok = readbackStep.ok && itemList.some((item) => String(item.item_id ?? "") === remoteId);
      return result(input, [writeStep, readbackStep], remoteId);
    }
    return result(input, [writeStep], remoteId);
  }
  if (input.operation === "orders.list") {
    const baseQuery = queryParams(input.arguments);
    const steps: ChannelOperationStep[] = [];
    let cursor = baseQuery.get("cursor")?.trim() ?? "";
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const query = new URLSearchParams(baseQuery);
      if (cursor) query.set("cursor", cursor);
      else query.delete("cursor");
      const remote = shopeeOrderPageWithCredentialIdentity(await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/order/get_order_list",
        query,
      }), input.payload);
      const pageStep = step(pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok) break;
      const responseData = nestedObject(remote.data.response);
      const pageOrders = objectArray(responseData.order_list);
      const nextCursor = String(responseData.next_cursor ?? "").trim();
      if (!providerBoolean(responseData.more) || pageOrders.length === 0 || !nextCursor || nextCursor === cursor) break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: { ...stringMap(input.arguments, "query"), cursor: nextCursor },
        });
      }
      cursor = nextCursor;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const query = queryParams(input.arguments);
    if (!query.has("order_sn_list")) query.set("order_sn_list", stringArgument(input.arguments, "orderSn"));
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/order/get_order_detail",
      query,
    });
    return result(input, [step("order", remote)], stringArgument(input.arguments, "orderSn", false) || undefined);
  }
  const remote = await shopeeRequest({
    payload: input.payload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/logistics/get_shipping_parameter",
    query: queryParams(input.arguments),
  });
  return result(input, [step("shipping-parameter", remote)]);
}

async function executeLazada(input: ExecuteInput) {
  const query = stringMap(input.arguments, "queryParams");
  const publicationIntent = listingPublicationIntentFromArguments(input.arguments);
  const verifiedPublicationRequested = input.arguments.publicationStateContract === listingRemoteStateContractVersion;
  if (input.operation === "categories.suggest") {
    const params = { ...query, product_name: stringArgument(input.arguments, "query") };
    const treeParams: Record<string, string> = {};
    if (query.language_code) treeParams.language_code = query.language_code;
    const [remote, tree] = await Promise.all([
      lazadaRequest({ payload: input.payload, path: "/product/category/suggestion/get", params }),
      lazadaRequest({ payload: input.payload, path: "/category/tree/get", params: treeParams }),
    ]);
    return result(input, [step("category-suggestion", remote), step("category-tree", tree)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const params = { ...query, primary_category_id: stringArgument(input.arguments, "categoryId") };
    const remote = await lazadaRequest({ payload: input.payload, path: "/category/attributes/get", params });
    return result(input, [step("category-attributes", remote)], params.primary_category_id);
  }
  const pathMap: Partial<Record<ChannelOperationName, string>> = {
    "categories.list": "/category/tree/get",
    "listing.create": "/product/create",
    "listing.update": "/product/update",
    "listing.stop": "/product/deactivate",
    "price.update": "/product/price_quantity/update",
    "inventory.update": "/product/price_quantity/update",
  };
  if (input.operation === "orders.list") {
    const limit = boundedPageSize(query.limit, 50, 100);
    const offset = Math.max(0, finiteCount(query.offset) ?? 0);
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/orders/get",
      params: { ...query, limit: String(limit), offset: String(offset) },
    });
    const orderStep = step("orders", remote);
    if (!orderStep.ok) return result(input, [orderStep]);
    const responseData = objectValue(remote.data, "data", false);
    const orders = objectArray(responseData.orders);
    const actionableOrders = orders.filter((order) => {
      const statusText = (Array.isArray(order.statuses) ? order.statuses.join(" ") : String(order.status ?? "")).toLocaleLowerCase();
      const terminal = /(?:^|[\s_-])(?:cancelled?|refunded?|returned?|shipped|delivered|completed?)(?:$|[\s_-])/i.test(statusText);
      return !terminal && stringArgument(order, "order_id", false);
    });
    const detailSteps: ChannelOperationStep[] = [];
    for (let offset = 0; offset < actionableOrders.length; offset += 5) {
      const batch = actionableOrders.slice(offset, offset + 5);
      const remotes = await Promise.all(batch.map(async (order) => {
        const orderId = stringArgument(order, "order_id");
        const detail = await lazadaRequest({ payload: input.payload, path: "/order/items/get", params: { order_id: orderId } });
        return step(`order-items:${orderId}`, detail);
      }));
      detailSteps.push(...remotes);
    }
    const completedSteps = [orderStep, ...detailSteps];
    const total = finiteCount(responseData.countTotal ?? responseData.total_count ?? responseData.totalCount);
    const nextOffset = offset + orders.length;
    const hasMore = orders.length > 0 && (
      total !== null ? nextOffset < total : orders.length === limit
    );
    return hasMore
      ? paginationResult(input, completedSteps, {
          ...input.arguments,
          queryParams: { ...query, limit: String(limit), offset: String(nextOffset) },
        })
      : result(input, completedSteps);
  }
  if (input.operation === "orders.get") {
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/get",
      params: { ...query, order_id: stringArgument(input.arguments, "orderId") },
    });
    return result(input, [step("order", remote)]);
  }
  if (input.operation === "inquiries.list") {
    if (input.arguments.bootstrap !== true) throw new Error("CHANNEL_ARGUMENT_REQUIRED:bootstrap");
    const pageSize = input.arguments.pageSize === undefined
      ? 20
      : integerArgument(input.arguments, "pageSize", { min: 1, max: 20 });
    const sessionLimit = input.arguments.sessionLimit === undefined
      ? 100
      : integerArgument(input.arguments, "sessionLimit", { min: 1, max: 100 });
    const messageLimit = input.arguments.messageLimit === undefined
      ? 100
      : integerArgument(input.arguments, "messageLimit", { min: 20, max: 100 });
    const startTime = input.arguments.startTime === undefined
      ? Date.now()
      : integerArgument(input.arguments, "startTime", { min: 1 });
    const steps: ChannelOperationStep[] = [];
    const sessions: Record<string, unknown>[] = [];
    let nextStartTime = String(startTime);
    let lastSessionId = "";

    while (sessions.length < sessionLimit) {
      const params: Record<string, string> = {
        start_time: nextStartTime,
        page_size: String(Math.min(pageSize, sessionLimit - sessions.length)),
      };
      if (lastSessionId) params.last_session_id = lastSessionId;
      const remote = await lazadaRequest({ payload: input.payload, path: "/im/session/list", params });
      const sessionStep = step(`inquiries-session-list:${steps.length + 1}`, remote);
      steps.push(sessionStep);
      if (!sessionStep.ok) return result(input, steps);
      const responseData = objectValue(remote.data, "data", false);
      const pageSessions = Array.isArray(responseData.session_list)
        ? responseData.session_list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : [];
      sessions.push(...pageSessions);
      if (!providerBoolean(responseData.has_more) || pageSessions.length === 0) break;
      const candidateStartTime = String(responseData.next_start_time ?? "").trim();
      const candidateLastSessionId = String(responseData.last_session_id ?? "").trim();
      if (!candidateStartTime || !candidateLastSessionId
        || (candidateStartTime === nextStartTime && candidateLastSessionId === lastSessionId)) break;
      nextStartTime = candidateStartTime;
      lastSessionId = candidateLastSessionId;
    }

    for (let offset = 0; offset < sessions.length; offset += 5) {
      const batch = sessions.slice(offset, offset + 5);
      const remotes = await Promise.all(batch.map(async (session) => {
        const sessionId = String(session.session_id ?? "").trim();
        if (!sessionId) return [];
        const sessionSteps: ChannelOperationStep[] = [];
        let messageStartTime = String(startTime);
        let lastMessageId = "";
        let receivedMessages = 0;
        while (receivedMessages < messageLimit) {
          const params: Record<string, string> = {
            session_id: sessionId,
            start_time: messageStartTime,
            page_size: String(Math.min(20, messageLimit - receivedMessages)),
          };
          if (lastMessageId) params.last_message_id = lastMessageId;
          const remote = await lazadaRequest({ payload: input.payload, path: "/im/message/list", params });
          remote.data = { ...remote.data, sellerpilotSession: session };
          const messageStep = step(`inquiries-message:${sessionId}:${sessionSteps.length + 1}`, remote);
          sessionSteps.push(messageStep);
          if (!messageStep.ok) break;
          const responseData = objectValue(remote.data, "data", false);
          const pageMessages = Array.isArray(responseData.message_list) ? responseData.message_list : [];
          receivedMessages += pageMessages.length;
          if (!providerBoolean(responseData.has_more) || pageMessages.length === 0) break;
          const candidateStartTime = String(responseData.next_start_time ?? "").trim();
          const candidateLastMessageId = String(responseData.last_message_id ?? "").trim();
          if (!candidateStartTime || !candidateLastMessageId
            || (candidateStartTime === messageStartTime && candidateLastMessageId === lastMessageId)) break;
          messageStartTime = candidateStartTime;
          lastMessageId = candidateLastMessageId;
        }
        return sessionSteps;
      }));
      steps.push(...remotes.flat());
    }
    return result(input, steps);
  }
  if (input.operation === "inquiries.reply") {
    const sessionId = stringArgument(input.arguments, "sessionId");
    const reply = stringArgument(input.arguments, "reply");
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/im/message/send",
      method: "POST",
      params: { template_id: "1", session_id: sessionId, txt: reply },
    });
    return result(input, [step("inquiry-reply", remote)], sessionId);
  }
  if (input.operation === "shipment.acknowledge") {
    const packRequest = objectValue(input.arguments, "packReq");
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { ...query, packReq: JSON.stringify(packRequest) },
    });
    return result(input, [lazadaFulfillmentStep("pack", remote, "LAZADA_PACKAGE_CREATED")]);
  }
  if (input.operation === "shipment.confirm") {
    const orderId = stringArgument(input.arguments, "orderId");
    const carrierCode = stringArgument(input.arguments, "carrierCode");
    const providerContext = objectValue(input.arguments, "providerContext");
    const contextOrderId = stringArgument(providerContext, "orderId");
    if (contextOrderId !== orderId) throw new Error("CHANNEL_ARGUMENT_INVALID:providerContext.orderId");
    const orderItemIds = Array.isArray(providerContext.orderItemIds)
      ? [...new Set(providerContext.orderItemIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 100)
      : [];
    if (!orderItemIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.orderItemIds");
    const deliveryType = stringArgument(providerContext, "deliveryType");
    const providerRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/shipment/providers/get",
      method: "POST",
      params: {
        getShipmentProvidersReq: JSON.stringify({
          orders: [{ order_id: orderId, order_item_ids: orderItemIds }],
        }),
      },
    });
    const providerStep = lazadaFulfillmentStep("shipment-providers", providerRemote, "LAZADA_SHIPMENT_PROVIDERS_VERIFIED");
    if (!providerStep.ok) return result(input, [providerStep]);
    const providerData = lazadaResultData(providerRemote.data);
    const shipmentProviders = objectArray(providerData.shipment_providers);
    const normalizedCarrierCode = carrierCode.toLowerCase();
    const selectedProvider = shipmentProviders.find((provider) =>
      [provider.provider_code, provider.name].some((value) => String(value ?? "").trim().toLowerCase() === normalizedCarrierCode));
    if (!selectedProvider) throw new Error("CHANNEL_ARGUMENT_INVALID:carrierCode");
    const shipmentProviderCode = stringArgument(selectedProvider, "provider_code");
    const shippingAllocateType = stringArgument(providerData, "shipping_allocate_type");
    const packReq = {
      pack_order_list: [{ order_id: orderId, order_item_list: orderItemIds }],
      delivery_type: deliveryType,
      shipment_provider_code: shipmentProviderCode,
      shipping_allocate_type: shippingAllocateType,
    };
    const packRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { packReq: JSON.stringify(packReq) },
    });
    const packPackages = objectArray(lazadaResultData(packRemote.data).packages);
    const packageIds = [...new Set(packPackages.map((item) => stringArgument(item, "package_id", false)).filter(Boolean))];
    const basePackStep = lazadaFulfillmentStep("pack", packRemote, "LAZADA_PACKAGE_CREATED");
    const packStep: ChannelOperationStep = packageIds.length
      ? basePackStep
      : {
          ...basePackStep,
          ok: false,
          data: { ...basePackStep.data, sellerpilotVerification: "LAZADA_PACKAGE_ID_MISSING" },
        };
    if (!packStep.ok) return result(input, [providerStep, packStep]);
    const readyRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/package/rts",
      method: "POST",
      params: { readyToShipReq: JSON.stringify({ packages: packageIds.map((package_id) => ({ package_id })) }) },
    });
    const readyStep = lazadaFulfillmentStep("ready-to-ship", readyRemote, "LAZADA_READY_TO_SHIP_CONFIRMED");
    const trackingNumber = packPackages.map((item) => stringArgument(item, "tracking_number", false)).find(Boolean);
    return result(input, [providerStep, packStep, readyStep], trackingNumber ?? packageIds[0]);
  }
  if (input.operation === "inventory.update" && !input.arguments.request) {
    const itemId = stringArgument(input.arguments, "itemId");
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const readback = await lazadaRequest({ payload: input.payload, path: "/product/item/get", params: { item_id: itemId } });
    const readbackStep = step("inventory-item-readback", readback);
    if (!readbackStep.ok) return result(input, [readbackStep], itemId);
    const data = objectValue(readback.data, "data", false);
    const product = objectValue(data, "item", false);
    const skusContainer = product.Skus && typeof product.Skus === "object" && !Array.isArray(product.Skus)
      ? product.Skus as Record<string, unknown>
      : data.Skus && typeof data.Skus === "object" && !Array.isArray(data.Skus)
        ? data.Skus as Record<string, unknown>
        : {};
    const rawSkuValue = skusContainer.Sku ?? data.skus;
    const skuRoot = rawSkuValue && typeof rawSkuValue === "object" && !Array.isArray(rawSkuValue)
      ? rawSkuValue as Record<string, unknown>
      : {};
    const rawSkus = Array.isArray(rawSkuValue)
      ? rawSkuValue.filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : Object.keys(skuRoot).length ? [skuRoot] : [];
    const skuIds = rawSkus
      .map((sku) => String(sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId ?? "").trim())
      .filter(Boolean);
    if (!skuIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:skuId");
    const request = { Request: { Product: { Skus: { Sku: skuIds.map((skuId) => ({ SkuId: skuId, Quantity: quantity })) } } } };
    const write = await lazadaRequest({ payload: input.payload, path: "/product/price_quantity/update", method: "POST", params: { ...query, payload: lazadaPayload({ request }) } });
    const writeStep = step("inventory.update", write);
    if (!writeStep.ok) return result(input, [readbackStep, writeStep], itemId);
    const verificationRemote = await lazadaRequest({ payload: input.payload, path: "/product/item/get", params: { item_id: itemId } });
    const verificationData = objectValue(verificationRemote.data, "data", false);
    const verificationProduct = objectValue(verificationData, "item", false);
    const verificationSkusContainer = verificationProduct.Skus && typeof verificationProduct.Skus === "object" && !Array.isArray(verificationProduct.Skus)
      ? verificationProduct.Skus as Record<string, unknown>
      : verificationData.Skus && typeof verificationData.Skus === "object" && !Array.isArray(verificationData.Skus)
        ? verificationData.Skus as Record<string, unknown>
        : {};
    const verificationSkuValue = verificationSkusContainer.Sku ?? verificationData.skus;
    const verificationSkus = Array.isArray(verificationSkuValue)
      ? verificationSkuValue.filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : verificationSkuValue && typeof verificationSkuValue === "object" && !Array.isArray(verificationSkuValue)
        ? [verificationSkuValue as Record<string, unknown>]
        : [];
    const matchingQuantities = verificationSkus
      .filter((sku) => skuIds.includes(String(sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId ?? "").trim()))
      .map((sku) => Number(sku.Quantity ?? sku.quantity));
    const verifiedQuantity = matchingQuantities.length > 0 && matchingQuantities.every((value) => value === quantity)
      ? quantity
      : Number.NaN;
    const verificationStep = inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verifiedQuantity);
    return result(input, [readbackStep, writeStep, verificationStep], itemId);
  }
  const path = pathMap[input.operation];
  if (!path) throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const write = writeChannelOperations.has(input.operation);
  let effectiveArguments = input.arguments;
  if (input.operation === "listing.create") {
    effectiveArguments = await prepareLazadaNativeImageArguments(input, effectiveArguments);
  }
  if (verifiedPublicationRequested && input.operation === "listing.create") {
    if (!publicationIntent) throw new Error("LAZADA_PUBLICATION_INTENT_REQUIRED");
    effectiveArguments = lazadaListingArgumentsForPublicationIntent(effectiveArguments, publicationIntent);
  }
  if (verifiedPublicationRequested && (input.operation === "listing.update" || input.operation === "listing.stop")) {
    const requestedRemoteId = lazadaListingRemoteIdFromArguments(input.arguments);
    effectiveArguments = lazadaListingArgumentsForRemoteItem(input.arguments, requestedRemoteId);
  }
  const params = write ? { ...query, payload: lazadaPayload(effectiveArguments) } : query;
  const remote = await lazadaRequest({ payload: input.payload, path, method: write ? "POST" : "GET", params });
  const dataValue = remote.data.data;
  const responseRemoteId = dataValue && typeof dataValue === "object" && !Array.isArray(dataValue) && "item_id" in dataValue
    ? String((dataValue as Record<string, unknown>).item_id)
    : undefined;
  const requestedItemId = input.operation === "listing.update" || input.operation === "listing.stop"
    ? lazadaListingRemoteIdFromArguments(effectiveArguments)
    : "";
  const remoteId = requestedItemId || responseRemoteId;
  const writeStep = step(path, remote);
  if (verifiedPublicationRequested && requestedItemId && responseRemoteId && requestedItemId !== responseRemoteId) {
    writeStep.ok = false;
    writeStep.data = {
      ...writeStep.data,
      sellerpilotPublicationVerification: "LAZADA_MUTATION_ITEM_ID_MISMATCH",
    };
  }
  if ((input.operation === "listing.create" || input.operation === "listing.update" || input.operation === "listing.stop")
      && writeStep.ok
      && remoteId
      && verifiedPublicationRequested) {
    const verification = await readLazadaListingPublicationState({
      payload: input.payload,
      operation: input.operation,
      remoteId,
      mutationArguments: effectiveArguments,
      ...verifiedPublicationArguments(input),
    });
    const readbackStep = input.operation === "listing.update"
      ? listingUpdateReadbackStep("listing-readback", verification.remote, input.channel, effectiveArguments)
      : step("listing-readback", verification.remote);
    applyLazadaPublicationVerification(readbackStep, verification);
    return result(input, [writeStep, readbackStep], remoteId, undefined, verification.remoteState);
  }
  if ((input.operation === "listing.create" || input.operation === "listing.update") && writeStep.ok && remoteId) {
    const readback = await lazadaRequest({
      payload: input.payload,
      path: "/product/item/get",
      params: { item_id: remoteId },
    });
    const readbackStep = input.operation === "listing.update"
      ? listingUpdateReadbackStep("listing-readback", readback, input.channel, effectiveArguments)
      : step("listing-readback", readback);
    const readbackData = objectValue(readback.data, "data", false);
    const readbackItem = objectValue(readbackData, "item", false);
    const readbackId = readbackItem.item_id ?? readbackItem.itemId ?? readbackData.item_id ?? readbackData.itemId;
    readbackStep.ok = readbackStep.ok && String(readbackId ?? "") === remoteId;
    return result(input, [writeStep, readbackStep], remoteId);
  }
  return result(input, [writeStep], remoteId);
}

function listingPublicationReadbackRequested(input: ExecuteInput) {
  return listingOperationRequiresVerifiedRemoteState(input.operation)
    && input.arguments.publicationStateContract === listingRemoteStateContractVersion;
}

function publicationStateVerificationStep(
  channel: ActiveChannelKey,
  state: VerifiedListingRemoteState | undefined,
  failureCode: string | undefined,
): ChannelOperationStep {
  return {
    name: "publication-state-verification",
    ok: Boolean(state),
    status: state ? 200 : 422,
    data: state
      ? {
          sellerpilotVerification: "VERIFIED_REMOTE_PUBLICATION_STATE",
          visibility: state.visibility,
          providerStatus: state.providerStatus,
          imageCount: state.imageCount,
        }
      : {
          sellerpilotVerification: "REMOTE_PUBLICATION_STATE_UNVERIFIED",
          code: failureCode ?? `${channel.toUpperCase()}_PUBLICATION_READBACK_UNVERIFIED`,
        },
  };
}

async function coupangListingResultWithPublicationReadback(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId: string,
  expectedStopVendorItemIds?: string[],
  exactRecovery?: CoupangExactQaRecoveryBinding | null,
) {
  if (!listingPublicationReadbackRequested(input) || steps.some((item) => !item.ok)) {
    return result(input, steps, remoteId);
  }
  const expected = listingPublicationReadbackExpectation(input.arguments);
  if (!expected) {
    return result(input, [
      ...steps,
      publicationStateVerificationStep(input.channel, undefined, "COUPANG_PUBLICATION_EXPECTATION_MISSING"),
    ], remoteId);
  }
  const readback = await readCoupangListingPublicationState({
    operation: input.operation as "listing.create" | "listing.update" | "listing.stop",
    intent: listingPublicationIntentFromArguments(input.arguments),
    remoteId,
    expected,
    ...(expectedStopVendorItemIds ? { expectedStopVendorItemIds } : {}),
    readSellerProduct: (sellerProductId) => coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${pathSegment(sellerProductId)}`,
    }),
    readVendorItem: (vendorItemId) => coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${pathSegment(vendorItemId)}/inventories`,
    }),
  });
  const readbackSteps: ChannelOperationStep[] = [];
  if (readback.sellerProductReadback) {
    readbackSteps.push(step("seller-product-publication-readback", readback.sellerProductReadback));
  }
  readback.vendorItemReadbacks.forEach(({ vendorItemId, remote }, index) => {
    const vendorStep = step(`vendor-item-publication-readback:${index + 1}`, remote);
    vendorStep.data = {
      ...vendorStep.data,
      sellerpilotVendorItemId: vendorItemId,
    };
    readbackSteps.push(vendorStep);
  });
  if (exactRecovery?.phase === "listing.update") {
    const commerceReadback = readback.vendorItemReadbacks.find(({ vendorItemId }) =>
      vendorItemId === exactRecovery.vendorItemId);
    const commerceStep: ChannelOperationStep = commerceReadback
      ? step("coupang-exact-commerce-readback", commerceReadback.remote)
      : {
          name: "coupang-exact-commerce-readback",
          ok: false,
          status: 422,
          data: {},
        };
    if (commerceStep.ok && commerceReadback) {
      try {
        const sellerProduct = readback.sellerProductReadback
          ? assertCoupangExactQaCurrentProduct(
              objectValue(readback.sellerProductReadback.data, "data", false),
              exactRecovery,
            )
          : null;
        assertCoupangExactQaInventoryReadback(
          objectValue(commerceReadback.remote.data, "data", false),
          exactRecovery,
          {
            requestedVendorItemId: commerceReadback.vendorItemId,
            authoritativeVendorItemId: String(sellerProduct?.item.vendorItemId ?? ""),
          },
        );
      } catch {
        commerceStep.ok = false;
      }
    }
    commerceStep.data = {
      ...commerceStep.data,
      sellerpilotVerification: commerceStep.ok
        ? "COUPANG_EXACT_QA_COMMERCE_VERIFIED"
        : "COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH",
    };
    readbackSteps.push(commerceStep);
  }
  readbackSteps.push(publicationStateVerificationStep(input.channel, readback.state, readback.failureCode));
  return result(input, [...steps, ...readbackSteps], remoteId, undefined, readback.state);
}

async function executeCoupang(input: ExecuteInput) {
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  const sellerProductsPath = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
  if (input.operation === "categories.list") {
    // Coupang requires a display category code in the path. Code 0 returns the
    // first depth, and a returned code can be passed back to fetch its children.
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId", false) || "0");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}`,
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.suggest") {
    const body = objectValue(input.arguments, "body", false);
    const productName = stringArgument(input.arguments, "query", false) || stringArgument(body, "productName");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: "/v2/providers/openapi/apis/api/v1/categorization/predict",
      body: { ...body, productName },
    });
    return result(input, [step("category-suggestion", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId"));
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${categoryId}`,
    });
    return result(input, [step("category-metadata", remote)], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId"));
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}/status`,
    });
    return result(input, [step("category-status", remote)], categoryId);
  }
  if (input.operation === "listing.update") {
    const exactRecovery = coupangExactQaRecoveryBinding(input.arguments, "listing.update");
    if (Object.hasOwn(input.arguments, coupangExactQaRecoveryArgument) && !exactRecovery) {
      throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
    }
    if (exactRecovery) {
      assertCoupangExactQaProviderContract(input.arguments, "listing.update", {
        sanitizedUpdate: true,
      });
    }
    const patchBody = objectValue(input.arguments, "body");
    const remoteId = String(patchBody.sellerProductId ?? "").trim();
    if (!remoteId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:sellerProductId");
    const readProduct = () => coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
    });
    const preflightRemote = await readProduct();
    const preflightStep = step("listing-update-preflight", preflightRemote);
    const currentBody = objectValue(preflightRemote.data, "data", false);
    preflightStep.ok = preflightStep.ok && String(currentBody.sellerProductId ?? "") === remoteId;
    let exactCurrentProduct: ReturnType<typeof assertCoupangExactQaCurrentProduct> | null = null;
    if (preflightStep.ok && exactRecovery) {
      try {
        exactCurrentProduct = assertCoupangExactQaCurrentProduct(currentBody, exactRecovery);
      } catch {
        preflightStep.ok = false;
      }
    }
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok ? "COUPANG_EXISTING_LISTING_VERIFIED" : "COUPANG_EXISTING_LISTING_MISMATCH",
    };
    if (!preflightStep.ok) return result(input, [preflightStep], remoteId);

    const preflightSteps = [preflightStep];
    if (exactRecovery) {
      const commerceRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${pathSegment(exactRecovery.vendorItemId)}/inventories`,
      });
      const commerceStep = step("listing-update-commerce-preflight", commerceRemote);
      if (commerceStep.ok) {
        try {
          assertCoupangExactQaInventoryReadback(
            objectValue(commerceRemote.data, "data", false),
            exactRecovery,
            {
              requestedVendorItemId: exactRecovery.vendorItemId,
              authoritativeVendorItemId: String(exactCurrentProduct?.item.vendorItemId ?? ""),
            },
          );
        } catch {
          commerceStep.ok = false;
        }
      }
      commerceStep.data = {
        ...commerceStep.data,
        sellerpilotVerification: commerceStep.ok
          ? "COUPANG_EXACT_QA_COMMERCE_VERIFIED"
          : "COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH",
      };
      preflightSteps.push(commerceStep);
      if (!commerceStep.ok) return result(input, preflightSteps, remoteId);
    }

    const coupangUpdate = coupangListingUpdateWrite(currentBody, patchBody);
    const mergedBody = coupangUpdate.body;
    mergedBody.vendorId = vendorId;
    mergedBody.sellerProductId = patchBody.sellerProductId;
    if (listingPublicationReadbackRequested(input)) {
      mergedBody.requested = listingPublicationIntentFromArguments(input.arguments) === "live";
    }
    if (exactRecovery) {
      const documentStep: ChannelOperationStep = {
        name: "listing-update-document-preflight",
        ok: true,
        status: 200,
        data: {},
      };
      try {
        assertCoupangExactQaUpdateReadback(mergedBody, exactRecovery);
      } catch {
        documentStep.ok = false;
        documentStep.status = 422;
      }
      documentStep.data = {
        sellerpilotVerification: documentStep.ok
          ? "COUPANG_EXACT_QA_UPDATE_DOCUMENT_VERIFIED"
          : "COUPANG_EXACT_QA_UPDATE_DOCUMENT_MISMATCH",
      };
      preflightSteps.push(documentStep);
      if (!documentStep.ok) return result(input, preflightSteps, remoteId);
    }
    let exactPrewriteImages: CoupangProviderImageIdentity[] | null = null;
    let exactPrewriteSnapshotSha256 = "";
    if (exactRecovery) {
      const hooks = input.providerMutationHooks;
      if (!hooks?.bindCoupangRepresentativePrewrite) {
        throw new Error("COUPANG_EXACT_QA_PROVIDER_BOUNDARY_REQUIRED");
      }
      exactPrewriteImages = coupangExactRepresentativePrewriteSnapshot(currentBody);
      await hooks.assertLeaseHealthy();
      const boundPrewrite = await hooks.bindCoupangRepresentativePrewrite(
        exactPrewriteImages,
      );
      exactPrewriteSnapshotSha256 = boundPrewrite.prewriteSnapshotSha256;
      if (exactPrewriteSnapshotSha256 !==
          coupangProviderImageSnapshotSha256(exactPrewriteImages)) {
        throw new Error("COUPANG_EXACT_QA_PREWRITE_BINDING_FAILED");
      }
      await hooks.assertLeaseHealthy();
      await hooks.begin();
      await hooks.assertLeaseHealthy();
    }
    const writeRemote = await coupangRequest({
      payload: input.payload,
      method: "PUT",
      path: sellerProductsPath,
      body: mergedBody,
    });
    const writeStep = step("listing.update", writeRemote);
    if (!writeStep.ok) return result(input, [...preflightSteps, writeStep], remoteId);
    const readbackRemote = await readProduct();
    const readbackStep = listingUpdateReadbackStep("listing-readback", readbackRemote, input.channel, {
      ...input.arguments,
      body: coupangUpdate.effectivePatch,
    });
    const readbackBody = objectValue(readbackRemote.data, "data", false);
    readbackStep.ok = readbackStep.ok && String(readbackBody.sellerProductId ?? "") === remoteId;
    if (readbackStep.ok && exactRecovery) {
      try {
        assertCoupangExactQaUpdateReadback(readbackBody, exactRecovery, {
          providerReadback: true,
        });
        const representative = coupangExactQaRepresentativeBinding(input.arguments);
        if (!representative || !exactPrewriteImages) {
          throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_INVALID");
        }
        const providerIdentity = verifyCoupangExactRepresentativeReadback({
          currentValue: readbackBody,
          prewriteImages: exactPrewriteImages,
          argumentsValue: input.arguments,
        });
        readbackStep.data = {
          ...readbackStep.data,
          sellerpilotCoupangExactRepresentativeReadback: {
            contract: "coupang_exact_qa_representative_readback_v1",
            sellerProductId: exactRecovery.sellerProductId,
            vendorItemId: exactRecovery.vendorItemId,
            role: representative.role,
            sourceBucket: representative.sourceBucket,
            sourceObjectPath: representative.sourceObjectPath,
            sourceSha256: representative.sourceSha256,
            normalizedObjectPath: representative.normalizedObjectPath,
            contentSha256: representative.contentSha256,
            representativeImageCount: 1,
            detailImageCount: 8,
            remoteGalleryVerified: true,
            providerPrewriteSnapshotSha256: exactPrewriteSnapshotSha256,
            ...providerIdentity,
          },
        };
      } catch {
        readbackStep.ok = false;
        readbackStep.data = {
          ...readbackStep.data,
          sellerpilotVerification: "COUPANG_EXACT_QA_UPDATE_READBACK_MISMATCH",
        };
      }
    }
    return coupangListingResultWithPublicationReadback(
      input,
      [...preflightSteps, writeStep, readbackStep],
      remoteId,
      undefined,
      exactRecovery,
    );
  }
  if (input.operation === "listing.create") {
    const body: Record<string, unknown> = { ...objectValue(input.arguments, "body"), vendorId };
    if (listingPublicationReadbackRequested(input)) {
      body.requested = listingPublicationIntentFromArguments(input.arguments) === "live";
    }
    const resumeRemoteId = stringArgument(input.arguments, "resumeRemoteId", false);
    const writeRemote = resumeRemoteId ? null : await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: sellerProductsPath,
      body,
    });
    const responseId = writeRemote && (typeof writeRemote.data.data === "number" || typeof writeRemote.data.data === "string")
      ? String(writeRemote.data.data)
      : undefined;
    const requestedId = typeof body.sellerProductId === "number" || typeof body.sellerProductId === "string" ? String(body.sellerProductId) : undefined;
    const remoteId = resumeRemoteId || responseId || requestedId;
    const writeStep: ChannelOperationStep = writeRemote
      ? step(input.operation, writeRemote)
      : { name: "listing.resume", ok: Boolean(remoteId), status: 200, data: { sellerProductId: remoteId, resumed: true } };
    if (!writeStep.ok || !remoteId) return result(input, [writeStep], remoteId);
    let readbackRemote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
    });
    const verifyReadback = (name: string) => {
      const readbackStep = step(name, readbackRemote);
      const stateValues: unknown[] = [];
      let readbackId: unknown;
      let requested: unknown;
      const inspect = (value: unknown, depth = 0) => {
        if (depth > 5 || !value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach((item) => inspect(item, depth + 1));
          return;
        }
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
          if (readbackId === undefined && key === "sellerProductId") readbackId = item;
          if (requested === undefined && key === "requested") requested = item;
          if (/^(?:mdId|status|statusName|requested|approvalStatus)$/i.test(key)) stateValues.push(item);
          inspect(item, depth + 1);
        }
      };
      inspect(readbackRemote.data);
      const stateIndicators = stateValues
        .filter((value) => value !== undefined && value !== null && String(value).length > 0)
        .map(String)
        .join(" ")
        .toUpperCase();
      const identityMatches = readbackId !== undefined && String(readbackId) === remoteId;
      const saved = /(TEMP_SAVED|\bSAVED\b)/.test(stateIndicators);
      const approvalObserved = requested === true
        || (stateIndicators.length > 0 && !saved && !/ID_GEN/.test(stateIndicators));
      const providerAndIdentityOk = readbackStep.ok && identityMatches;
      readbackStep.ok = providerAndIdentityOk && (body.requested !== true || approvalObserved);
      return { readbackStep, providerAndIdentityOk, approvalObserved, saved };
    };
    let initialReadback = verifyReadback("listing-readback");
    if (body.requested !== true || initialReadback.approvalObserved) {
      initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk;
      return coupangListingResultWithPublicationReadback(input, [writeStep, initialReadback.readbackStep], remoteId);
    }

    // Coupang can return ID_GEN for several seconds after a successful create.
    // Approval during that window is rejected even though the same readback soon
    // transitions to SAVED, so wait for the documented temporary-save state.
    for (let attempt = 0; attempt < 8 && !initialReadback.saved; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      readbackRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
      });
      initialReadback = verifyReadback("listing-readback");
      if (initialReadback.approvalObserved) break;
    }
    if (initialReadback.approvalObserved) {
      initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk;
      return coupangListingResultWithPublicationReadback(input, [writeStep, initialReadback.readbackStep], remoteId);
    }
    initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk && initialReadback.saved;
    if (!initialReadback.readbackStep.ok) {
      return result(input, [writeStep, initialReadback.readbackStep], remoteId);
    }

    const approvalRemote = await coupangRequest({
      payload: input.payload,
      method: "PUT",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}/approvals`,
    });
    const approvalStep = step("listing-approval-request", approvalRemote);
    let approvalReadback = initialReadback;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      readbackRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
      });
      approvalReadback = verifyReadback("listing-approval-readback");
      if (approvalReadback.approvalObserved) {
        approvalReadback.readbackStep.ok = approvalReadback.providerAndIdentityOk;
        break;
      }
    }
    if (approvalReadback.readbackStep.ok) {
      initialReadback.readbackStep.ok = true;
      approvalStep.ok = true;
    }
    return coupangListingResultWithPublicationReadback(
      input,
      [writeStep, initialReadback.readbackStep, approvalStep, approvalReadback.readbackStep],
      remoteId,
    );
  }
  if (input.operation === "listing.stop") {
    const exactRecovery = coupangExactQaRecoveryBinding(input.arguments, "listing.stop");
    if (Object.hasOwn(input.arguments, coupangExactQaRecoveryArgument) && !exactRecovery) {
      throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
    }
    if (exactRecovery) {
      assertCoupangExactQaProviderContract(input.arguments, "listing.stop");
    }
    const sellerProductId = stringArgument(input.arguments, "sellerProductId");
    const suppliedVendorItemId = stringArgument(input.arguments, "vendorItemId", false);
    const preflightRemote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(sellerProductId)}`,
    });
    const preflightStep = step("listing-stop-preflight", preflightRemote);
    const sellerProduct = objectValue(preflightRemote.data, "data", false);
    const items = objectArray(sellerProduct.items);
    const rawVendorItemIds = items.map((item) => String(item.vendorItemId ?? "").trim());
    const vendorItemIds = [...new Set(rawVendorItemIds.filter(Boolean))];
    preflightStep.ok = preflightStep.ok
      && String(sellerProduct.sellerProductId ?? "").trim() === sellerProductId
      && items.length > 0
      && rawVendorItemIds.every(Boolean)
      && vendorItemIds.length === items.length
      && (!suppliedVendorItemId || vendorItemIds.includes(suppliedVendorItemId));
    if (preflightStep.ok && exactRecovery) {
      try {
        assertCoupangExactQaCurrentProduct(sellerProduct, exactRecovery);
        preflightStep.ok = sellerProductId === coupangExactQaRecoveryIdentity.sellerProductId
          && suppliedVendorItemId === coupangExactQaRecoveryIdentity.vendorItemId
          && stringArgument(input.arguments, "sellerSku") === coupangExactQaRecoveryIdentity.sellerSku
          && vendorItemIds.length === 1
          && vendorItemIds[0] === coupangExactQaRecoveryIdentity.vendorItemId;
      } catch {
        preflightStep.ok = false;
      }
    }
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok
        ? "COUPANG_ALL_VENDOR_ITEMS_BOUND"
        : "COUPANG_VENDOR_ITEM_SET_UNVERIFIED",
      vendorItemIds,
    };
    if (!preflightStep.ok) return result(input, [preflightStep], sellerProductId);
    const steps = [preflightStep];
    for (const [index, vendorItemId] of vendorItemIds.entries()) {
      const remote = await coupangRequest({
        payload: input.payload,
        method: "PUT",
        path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/sales/stop`,
      });
      steps.push(step(`sales-stop:${index + 1}`, remote));
    }
    return coupangListingResultWithPublicationReadback(
      input,
      steps,
      sellerProductId,
      vendorItemIds,
    );
  }
  if (input.operation === "price.update") {
    const vendorItemId = pathSegment(stringArgument(input.arguments, "vendorItemId"));
    const price = integerArgument(input.arguments, "price", { min: 10 });
    if (price % 10 !== 0) throw new Error("CHANNEL_ARGUMENT_INVALID:price_must_be_10_won_unit");
    const query = new URLSearchParams({ forceSalePriceUpdate: String(booleanArgument(input.arguments, "forceSalePriceUpdate")) });
    const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/prices/${price}`, query });
    return result(input, [step("price", remote)], vendorItemId);
  }
  if (input.operation === "inventory.update") {
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const suppliedVendorItemId = stringArgument(input.arguments, "vendorItemId", false);
    let vendorItemIds = suppliedVendorItemId ? [suppliedVendorItemId] : [];
    const steps: ChannelOperationStep[] = [];
    const sellerProductId = stringArgument(input.arguments, "sellerProductId", false);
    if (!vendorItemIds.length && sellerProductId) {
      const readback = await coupangRequest({ payload: input.payload, method: "GET", path: `${sellerProductsPath}/${pathSegment(sellerProductId)}` });
      const readbackStep = step("inventory-item-readback", readback);
      steps.push(readbackStep);
      if (!readbackStep.ok) return result(input, steps, sellerProductId);
      const data = readback.data.data && typeof readback.data.data === "object" && !Array.isArray(readback.data.data)
        ? readback.data.data as Record<string, unknown>
        : readback.data;
      const items = Array.isArray(data.items) ? data.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
      vendorItemIds = items.map((item) => String(item.vendorItemId ?? "").trim()).filter(Boolean);
    }
    if (!vendorItemIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:vendorItemId");
    for (const vendorItemId of vendorItemIds) {
      const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/quantities/${quantity}` });
      const writeStep = step("quantity", remote);
      steps.push(writeStep);
      if (!writeStep.ok) continue;
      const verificationRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/inventories`,
      });
      const verificationData = verificationRemote.data.data && typeof verificationRemote.data.data === "object" && !Array.isArray(verificationRemote.data.data)
        ? verificationRemote.data.data as Record<string, unknown>
        : verificationRemote.data;
      steps.push(inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verificationData.amountInStock ?? verificationData.quantity));
    }
    return result(input, steps, sellerProductId || vendorItemIds[0]);
  }
  const orderBase = `/v2/providers/openapi/apis/api/v5/vendors/${pathSegment(vendorId)}`;
  if (input.operation === "inquiries.list") {
    const baseQuery = queryParams(input.arguments);
    baseQuery.set("vendorId", vendorId);
    const kind = stringArgument(input.arguments, "kind", false);
    const path = kind === "call-center" ? `${orderBase}/callCenterInquiries` : `${orderBase}/onlineInquiries`;
    const pageSize = boundedPageSize(baseQuery.get("pageSize"), kind === "call-center" ? 30 : 50, 50);
    const pageNum = Math.max(1, finiteCount(baseQuery.get("pageNum")) ?? 1);
    // One complete provider page is the durable serverless unit. A successful
    // full page advances through the existing atomic continuation contract.
    const query = new URLSearchParams(baseQuery);
    query.set("pageNum", String(pageNum));
    query.set("pageSize", String(pageSize));
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path, query });
    const inquiryStep = step("inquiries", remote);
    inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: kind || "product" };
    const steps = [inquiryStep];
    if (!inquiryStep.ok) return result(input, steps);
    const count = providerRecordCount(remote.data, ["content", "inquiries", "onlineInquiries", "callCenterInquiries"]);
    const data = nestedObject(remote.data.data);
    const pagination = nestedObject(data.pagination);
    const totalPages = finiteCount(pagination.totalPages ?? data.totalPages ?? remote.data.totalPages);
    if (count === 0 || count < pageSize || (totalPages !== null && pageNum >= totalPages)) {
      return result(input, steps);
    }
    return paginationResult(input, steps, {
      ...input.arguments,
      query: { ...stringMap(input.arguments, "query"), pageNum: pageNum + 1, pageSize },
    });
  }
  if (input.operation === "inquiries.reply") {
    const inquiryId = pathSegment(stringArgument(input.arguments, "inquiryId"));
    const kind = stringArgument(input.arguments, "kind");
    const replyBy = textValue(input.payload, "requested_by");
    if (!replyBy) throw new Error("COUPANG_WING_USER_ID_MISSING");
    if (kind !== "product" && kind !== "call-center") throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    const reply = stringArgument(input.arguments, "reply");
    const body = kind === "call-center"
      ? {
          vendorId,
          inquiryId: decodeURIComponent(inquiryId),
          content: reply,
          replyBy,
          parentAnswerId: pathSegment(stringArgument(input.arguments, "parentAnswerId")),
        }
      : { content: reply, vendorId, replyBy };
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/${kind === "call-center" ? "callCenterInquiries" : "onlineInquiries"}/${inquiryId}/replies`,
      body,
    });
    return result(input, [step("inquiry-reply", remote)], decodeURIComponent(inquiryId));
  }
  if (input.operation === "orders.list") {
    const kind = stringArgument(input.arguments, "kind", false);
    const path = kind === "cancellations"
      ? `/v2/providers/openapi/apis/api/v6/vendors/${pathSegment(vendorId)}/returnRequests`
      : `${orderBase}/ordersheets`;
    const baseQuery = queryParams(input.arguments);
    const steps: ChannelOperationStep[] = [];
    let nextToken = baseQuery.get("nextToken")?.trim() ?? "";
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const query = new URLSearchParams(baseQuery);
      if (nextToken) query.set("nextToken", nextToken);
      else query.delete("nextToken");
      const remote = await coupangRequest({ payload: input.payload, method: "GET", path, query });
      const orderStep = step(pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`, remote);
      steps.push(orderStep);
      if (!orderStep.ok) break;
      const responseData = nestedObject(remote.data.data);
      const candidate = String(remote.data.nextToken ?? responseData.nextToken ?? "").trim();
      if (!candidate || candidate === nextToken) break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: { ...stringMap(input.arguments, "query"), nextToken: candidate },
        });
      }
      nextToken = candidate;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const shipmentBoxId = pathSegment(stringArgument(input.arguments, "shipmentBoxId"));
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path: `${orderBase}/ordersheets/${shipmentBoxId}` });
    return result(input, [step("order", remote)], shipmentBoxId);
  }
  if (input.operation === "shipment.acknowledge") {
    const shipmentBoxIds = input.arguments.shipmentBoxIds;
    if (!Array.isArray(shipmentBoxIds) || shipmentBoxIds.length < 1 || shipmentBoxIds.length > 50) throw new Error("CHANNEL_ARGUMENT_INVALID:shipmentBoxIds");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "PATCH",
      path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/ordersheets/acknowledgement`,
      body: { vendorId, shipmentBoxIds },
    });
    return result(input, [step("acknowledgement", remote)]);
  }
  const body = { ...objectValue(input.arguments, "body"), vendorId };
  const remote = await coupangRequest({
    payload: input.payload,
    method: "POST",
    path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/orders/invoices`,
    body,
  });
  return result(input, [step("invoice", remote)]);
}

function smartstoreBodyForPublicationIntent(
  input: ExecuteInput,
  bodyValue: Record<string, unknown>,
) {
  if (!listingPublicationReadbackRequested(input)) return bodyValue;
  const publicationIntent = listingPublicationIntentFromArguments(input.arguments);
  if (!publicationIntent) return bodyValue;
  const body = structuredClone(bodyValue);
  const originProduct = objectValue(body, "originProduct", false);
  const smartstoreChannelProduct = objectValue(body, "smartstoreChannelProduct", false);
  originProduct.statusType = publicationIntent === "live" ? "SALE" : "SUSPENSION";
  smartstoreChannelProduct.channelProductDisplayStatusType = publicationIntent === "live" ? "ON" : "SUSPENSION";
  body.originProduct = originProduct;
  body.smartstoreChannelProduct = smartstoreChannelProduct;
  return body;
}

async function smartstoreListingResultWithPublicationReadback(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId: string,
  readOriginProduct: (originProductNo: string) => Promise<RemoteResponse>,
  readChannelProduct: (channelProductNo: string) => Promise<RemoteResponse>,
) {
  if (!listingPublicationReadbackRequested(input) || steps.some((item) => !item.ok)) {
    return result(input, steps, remoteId);
  }
  const expected = listingPublicationReadbackExpectation(input.arguments);
  if (!expected) {
    return result(input, [
      ...steps,
      publicationStateVerificationStep(input.channel, undefined, "SMARTSTORE_PUBLICATION_EXPECTATION_MISSING"),
    ], remoteId);
  }
  const readback = await readSmartstoreListingPublicationState({
    operation: input.operation as "listing.create" | "listing.update" | "listing.stop",
    intent: listingPublicationIntentFromArguments(input.arguments),
    remoteId,
    expected,
    readOriginProduct,
    readChannelProduct,
  });
  return result(input, [
    ...steps,
    step("origin-product-publication-readback", readback.originProductReadback),
    ...(readback.channelProductReadback
      ? [step("channel-product-publication-readback", readback.channelProductReadback)]
      : []),
    publicationStateVerificationStep(input.channel, readback.state, readback.failureCode),
  ], remoteId, undefined, readback.state);
}

async function executeSmartstore(input: ExecuteInput) {
  const storedAccessToken = readStoredNaverAccessToken(input.payload);
  let token = storedAccessToken
    ? { accessToken: storedAccessToken }
    : await fetchNaverAccessToken(input.payload);
  const request = async (requestInput: Omit<Parameters<typeof naverRequest>[0], "accessToken">) => {
    let remote = await naverRequest({ ...requestInput, accessToken: token.accessToken });
    if (remote.response.status === 401 && textValue(remote.data, "code") === "GW.AUTHN") {
      token = await fetchNaverAccessToken(input.payload);
      remote = await naverRequest({ ...requestInput, accessToken: token.accessToken });
    }
    return remote;
  };
  if (input.operation === "categories.list") {
    const categoryId = stringArgument(input.arguments, "categoryId", false);
    const query = new URLSearchParams();
    if (booleanArgument(input.arguments, "leafOnly", true)) query.set("last", "true");
    const remote = categoryId
      ? await request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` })
      : await request({ method: "GET", path: "/v1/categories", query });
    return result(input, [step("category", remote)], categoryId || undefined);
  }
  if (input.operation === "categories.suggest") {
    const remote = await request({ method: "GET", path: "/v1/categories", query: new URLSearchParams({ last: "true" }) });
    return result(input, [step("category-tree", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = new URLSearchParams({ categoryId });
    const [category, attributes, values, options] = await Promise.all([
      request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` }),
      request({ method: "GET", path: "/v1/product-attributes/attributes", query }),
      request({ method: "GET", path: "/v1/product-attributes/attribute-values", query }),
      request({ method: "GET", path: "/v1/options/standard-options", query }),
    ]);
    return result(input, [
      step("category", category),
      naverOptionalCategoryMetadataStep("attributes", attributes),
      naverOptionalCategoryMetadataStep("attribute-values", values),
      naverOptionalCategoryMetadataStep("standard-options", options),
    ], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` });
    return result(input, [step("category-validation", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const body = smartstoreBodyForPublicationIntent(input, objectValue(input.arguments, "body"));
    const originProduct = objectValue(body, "originProduct", false);
    const detailAttribute = objectValue(originProduct, "detailAttribute", false);
    const sellerCodeInfo = objectValue(detailAttribute, "sellerCodeInfo", false);
    const sellerManagementCode = textValue(sellerCodeInfo, "sellerManagementCode");
    if (sellerManagementCode) {
      const searchRemote = await request({
        method: "POST",
        path: "/v1/products/search",
        body: {
          searchKeywordType: "SELLER_CODE",
          sellerManagementCode,
          page: 1,
          size: 50,
          orderType: "NO",
        },
      });
      const contents: unknown[] = Array.isArray(searchRemote.data.contents) ? searchRemote.data.contents : [];
      const existing = contents.find((item: unknown) => {
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        const channelProducts: unknown[] = Array.isArray(record.channelProducts) ? record.channelProducts : [];
        return channelProducts.some((channelProduct: unknown) => channelProduct && typeof channelProduct === "object" && (channelProduct as Record<string, unknown>).sellerManagementCode === sellerManagementCode);
      });
      const existingOriginProductNo = existing && typeof existing === "object" ? (existing as Record<string, unknown>).originProductNo : undefined;
      if (existingOriginProductNo !== undefined) {
        const remoteId = String(existingOriginProductNo);
        const searchStep = step("product-reconcile", searchRemote);
        const updateRemote = await request({ method: "PUT", path: `/v2/products/origin-products/${pathSegment(remoteId)}`, body });
        const updateStep = step("product-update", updateRemote);
        if (!updateStep.ok) return result(input, [searchStep, updateStep], remoteId);
        const readbackRemote = await request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(remoteId)}` });
        const readbackStep = step("product-readback", readbackRemote);
        readbackStep.ok = readbackStep.ok && Boolean(readbackRemote.data.originProduct && typeof readbackRemote.data.originProduct === "object");
        return smartstoreListingResultWithPublicationReadback(
          input,
          [searchStep, updateStep, readbackStep],
          remoteId,
          (originProductNo) => request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(originProductNo)}` }),
          (channelProductNo) => request({ method: "GET", path: `/v2/products/channel-products/${pathSegment(channelProductNo)}` }),
        );
      }
    }
    const createRemote = await request({ method: "POST", path: "/v2/products", body });
    const remoteId = createRemote.data.originProductNo === undefined ? undefined : String(createRemote.data.originProductNo);
    const steps = [step("product-create", createRemote)];
    if (!steps[0].ok || !remoteId) return result(input, steps, remoteId);
    const readbackRemote = await request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(remoteId)}` });
    const readbackStep = step("product-readback", readbackRemote);
    readbackStep.ok = readbackStep.ok && Boolean(readbackRemote.data.originProduct && typeof readbackRemote.data.originProduct === "object");
    steps.push(readbackStep);
    return smartstoreListingResultWithPublicationReadback(
      input,
      steps,
      remoteId,
      (originProductNo) => request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(originProductNo)}` }),
      (channelProductNo) => request({ method: "GET", path: `/v2/products/channel-products/${pathSegment(channelProductNo)}` }),
    );
  }
  if (input.operation === "listing.update") {
    const remoteId = stringArgument(input.arguments, "originProductNo");
    const originProductNo = pathSegment(remoteId);
    const patchBody = objectValue(input.arguments, "body");
    const readProduct = () => request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
    const preflightRemote = await readProduct();
    const preflightStep = step("product-update-preflight", preflightRemote);
    const currentOriginProduct = objectValue(preflightRemote.data, "originProduct", false);
    const embeddedChannelProduct = objectValue(preflightRemote.data, "smartstoreChannelProduct", false);
    const responseOriginProductNo = String(
      preflightRemote.data.originProductNo ?? currentOriginProduct.originProductNo ?? "",
    ).trim();
    const responseChannelProductNo = String(
      preflightRemote.data.smartstoreChannelProductNo
        ?? embeddedChannelProduct.channelProductNo
        ?? "",
    ).trim();
    preflightStep.ok = preflightStep.ok
      && Object.keys(currentOriginProduct).length > 0
      && (!responseOriginProductNo || responseOriginProductNo === remoteId)
      && Boolean(responseChannelProductNo);
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok ? "SMARTSTORE_EXISTING_PRODUCT_VERIFIED" : "SMARTSTORE_EXISTING_PRODUCT_MISSING",
      sellerpilotOriginProductNo: responseOriginProductNo || remoteId,
      ...(responseChannelProductNo
        ? { sellerpilotChannelProductNo: responseChannelProductNo }
        : {}),
    };
    if (!preflightStep.ok) return result(input, [preflightStep], remoteId);
    const channelPreflightRemote = await request({
      method: "GET",
      path: `/v2/products/channel-products/${pathSegment(responseChannelProductNo)}`,
    });
    const channelPreflightStep = step("channel-product-update-preflight", channelPreflightRemote);
    const currentChannelProduct = objectValue(
      channelPreflightRemote.data,
      "smartstoreChannelProduct",
      false,
    );
    const authoritativeChannelProductNo = String(
      currentChannelProduct.channelProductNo
        ?? currentChannelProduct.smartstoreChannelProductNo
        ?? channelPreflightRemote.data.smartstoreChannelProductNo
        ?? "",
    ).trim();
    const authoritativeOriginProductNo = String(
      currentChannelProduct.originProductNo
        ?? channelPreflightRemote.data.originProductNo
        ?? "",
    ).trim();
    channelPreflightStep.ok = channelPreflightStep.ok
      && Object.keys(currentChannelProduct).length > 0
      && authoritativeChannelProductNo === responseChannelProductNo
      && authoritativeOriginProductNo === remoteId;
    channelPreflightStep.data = {
      ...channelPreflightStep.data,
      sellerpilotVerification: channelPreflightStep.ok
        ? "SMARTSTORE_CHANNEL_PRODUCT_VERIFIED"
        : "SMARTSTORE_CHANNEL_PRODUCT_MISMATCH",
    };
    if (!channelPreflightStep.ok) {
      return result(input, [preflightStep, channelPreflightStep], remoteId);
    }
    const currentBody = {
      originProduct: currentOriginProduct,
      smartstoreChannelProduct: currentChannelProduct,
    };
    const mergedBody = smartstoreBodyForPublicationIntent(
      input,
      mergeListingUpdatePatch(currentBody, patchBody) as Record<string, unknown>,
    );
    const remote = await request({ method: "PUT", path: `/v2/products/origin-products/${originProductNo}`, body: mergedBody });
    const updateStep = step("product-update", remote);
    if (!updateStep.ok) return result(input, [preflightStep, channelPreflightStep, updateStep], remoteId);
    const readbackRemote = await readProduct();
    const readbackStep = listingUpdateReadbackStep("product-readback", readbackRemote, input.channel, input.arguments);
    return smartstoreListingResultWithPublicationReadback(
      input,
      [preflightStep, channelPreflightStep, updateStep, readbackStep],
      remoteId,
      (originProductId) => request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(originProductId)}` }),
      (channelProductNo) => request({ method: "GET", path: `/v2/products/channel-products/${pathSegment(channelProductNo)}` }),
    );
  }
  if (input.operation === "listing.stop") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await request({
      method: "PUT",
      path: `/v1/products/origin-products/${originProductNo}/change-status`,
      body: { ...objectValue(input.arguments, "body", false), statusType: "SUSPENSION" },
    });
    return smartstoreListingResultWithPublicationReadback(
      input,
      [step("status-stop", remote)],
      decodeURIComponent(originProductNo),
      (originProductId) => request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(originProductId)}` }),
      (channelProductNo) => request({ method: "GET", path: `/v2/products/channel-products/${pathSegment(channelProductNo)}` }),
    );
  }
  if (input.operation === "price.update") {
    const remote = await request({ method: "PUT", path: "/v1/products/origin-products/bulk-update", body: objectValue(input.arguments, "body") });
    return result(input, [step("bulk-price", remote)]);
  }
  if (input.operation === "inventory.update") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    if (stringArgument(input.arguments, "mode", false) === "origin-product" || !input.arguments.body) {
      const readback = await request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
      const readbackStep = step("inventory-item-readback", readback);
      if (!readbackStep.ok) return result(input, [readbackStep], decodeURIComponent(originProductNo));
      const originProduct = objectValue(readback.data, "originProduct", false);
      if (!Object.keys(originProduct).length) return result(input, [{ ...readbackStep, ok: false }], decodeURIComponent(originProductNo));
      const body = {
        ...readback.data,
        originProduct: { ...originProduct, stockQuantity: quantity },
      };
      const writeRemote = await request({ method: "PUT", path: `/v2/products/origin-products/${originProductNo}`, body });
      const writeStep = step("origin-product-stock", writeRemote);
      if (!writeStep.ok) return result(input, [readbackStep, writeStep], decodeURIComponent(originProductNo));
      const verificationRemote = await request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
      const verificationProduct = objectValue(verificationRemote.data, "originProduct", false);
      return result(input, [
        readbackStep,
        writeStep,
        inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verificationProduct.stockQuantity),
      ], decodeURIComponent(originProductNo));
    }
    const body = objectValue(input.arguments, "body");
    const expectations = smartstoreOptionStockExpectations(body);
    if (!expectations.length) {
      return result(input, [{
        name: "option-stock-preflight",
        ok: false,
        status: 400,
        data: { sellerpilotVerification: "INVENTORY_OPTION_EXPECTATIONS_INVALID" },
      }], decodeURIComponent(originProductNo));
    }
    const remote = await request({ method: "PUT", path: `/v1/products/origin-products/${originProductNo}/option-stock`, body });
    const writeStep = step("option-stock", remote);
    if (!writeStep.ok) return result(input, [writeStep], decodeURIComponent(originProductNo));
    const readbackRemote = await request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
    return result(input, [
      writeStep,
      smartstoreOptionStockReadbackStep(readbackRemote, expectations),
    ], decodeURIComponent(originProductNo));
  }
  if (input.operation === "orders.list") {
    const baseQuery = queryParams(input.arguments);
    const steps: ChannelOperationStep[] = [];
    let moreFrom = baseQuery.get("lastChangedFrom")?.trim() ?? "";
    let moreSequence = baseQuery.get("moreSequence")?.trim() ?? "";
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const query = new URLSearchParams(baseQuery);
      if (moreFrom) query.set("lastChangedFrom", moreFrom);
      if (moreSequence) query.set("moreSequence", moreSequence);
      const remote = await request({ method: "GET", path: "/v1/pay-order/seller/product-orders/last-changed-statuses", query });
      const orderStep = step(pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`, remote);
      steps.push(orderStep);
      if (!orderStep.ok) break;
      const root = Object.keys(nestedObject(remote.data.data)).length ? nestedObject(remote.data.data) : remote.data;
      const more = nestedObject(root.more);
      const nextFrom = String(more.moreFrom ?? root.moreFrom ?? "").trim();
      const nextSequence = String(more.moreSequence ?? root.moreSequence ?? "").trim();
      if (!nextFrom || !nextSequence || (nextFrom === moreFrom && nextSequence === moreSequence)) break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: {
            ...stringMap(input.arguments, "query"),
            lastChangedFrom: nextFrom,
            moreSequence: nextSequence,
          },
        });
      }
      moreFrom = nextFrom;
      moreSequence = nextSequence;
    }
    return result(input, steps);
  }
  if (input.operation === "inquiries.list") {
    const kind = stringArgument(input.arguments, "kind", false) || "product";
    if (kind !== "product" && kind !== "customer") {
      throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    }
    const baseQuery = queryParams(input.arguments);
    if (kind === "customer") {
      const page = integerQueryArgument(baseQuery, "page", { fallback: 1, min: 1, max: 1_000_000 });
      const pageSize = integerQueryArgument(baseQuery, "size", { fallback: 10, min: 10, max: 200 });
      const startSearchDate = calendarDateQueryArgument(baseQuery, "startSearchDate");
      const endSearchDate = calendarDateQueryArgument(baseQuery, "endSearchDate");
      if (startSearchDate > endSearchDate) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:query.inquiryTimeRange");
      }
      const answeredValue = baseQuery.get("answered");
      const answered = answeredValue?.trim().toLowerCase();
      if (answeredValue !== null && answered !== "true" && answered !== "false") {
        throw new Error("CHANNEL_ARGUMENT_INVALID:query.answered");
      }
      const query = new URLSearchParams({
        page: String(page),
        size: String(pageSize),
        startSearchDate,
        endSearchDate,
      });
      if (answered) query.set("answered", answered);
      const remote = await request({ method: "GET", path: "/v1/pay-user/inquiries", query });
      const inquiryStep = step("inquiries", remote);
      inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: "customer" };
      const steps = [inquiryStep];
      if (!inquiryStep.ok) return result(input, steps);
      const count = providerRecordCount(remote.data, ["content"]);
      const totalPages = finiteCount(remote.data.totalPages);
      if (count === 0 || count < pageSize || (totalPages !== null && page >= totalPages)) {
        return result(input, steps);
      }
      return paginationResult(input, steps, {
        ...input.arguments,
        kind: "customer",
        query: {
          page: page + 1,
          size: pageSize,
          startSearchDate,
          endSearchDate,
          ...(answered ? { answered } : {}),
        },
      });
    }

    const pageSize = boundedPageSize(baseQuery.get("size"), 100, 100);
    const page = Math.max(1, finiteCount(baseQuery.get("page")) ?? 1);
    // Keep token exchange plus Q&A retrieval bounded to one provider page;
    // callers that need a full sync follow the returned durable continuation.
    const query = new URLSearchParams(baseQuery);
    query.set("page", String(page));
    query.set("size", String(pageSize));
    const remote = await request({ method: "GET", path: "/v1/contents/qnas", query });
    const inquiryStep = step("inquiries", remote);
    inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: "product" };
    const steps = [inquiryStep];
    if (!inquiryStep.ok) return result(input, steps);
    const count = providerRecordCount(remote.data, ["contents", "content", "qnas"]);
    const root = Object.keys(nestedObject(remote.data.data)).length ? nestedObject(remote.data.data) : remote.data;
    const totalPages = finiteCount(root.totalPages);
    if (count === 0 || count < pageSize || (totalPages !== null && page >= totalPages)) {
      return result(input, steps);
    }
    return paginationResult(input, steps, {
      ...input.arguments,
      kind: "product",
      query: { ...stringMap(input.arguments, "query"), page: page + 1, size: pageSize },
    });
  }
  if (input.operation === "inquiries.reply") {
    const kind = stringArgument(input.arguments, "kind", false) || "product";
    if (kind === "customer") {
      const inquiryNo = stringArgument(input.arguments, "inquiryNo");
      if (!/^[1-9]\d{0,18}$/.test(inquiryNo)) throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryNo");
      const reply = stringArgument(input.arguments, "reply");
      const answerTemplateId = stringArgument(input.arguments, "answerTemplateId", false);
      const remote = await request({
        method: "POST",
        path: `/v1/pay-merchant/inquiries/${pathSegment(inquiryNo)}/answer`,
        body: {
          answerComment: reply,
          ...(answerTemplateId ? { answerTemplateId } : {}),
        },
      });
      const replyStep = step("inquiry-reply", remote);
      replyStep.data = {
        ...replyStep.data,
        sellerpilotInquiryKind: "customer",
        sellerpilotVerification: replyStep.ok
          ? "SMARTSTORE_CUSTOMER_INQUIRY_REPLY_HTTP_ACK"
          : "SMARTSTORE_CUSTOMER_INQUIRY_REPLY_REJECTED",
      };
      return result(input, [replyStep], inquiryNo);
    }
    if (kind !== "product") throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    const questionId = pathSegment(stringArgument(input.arguments, "questionId"));
    const remote = await request({
      method: "PUT",
      path: `/v1/contents/qnas/${questionId}`,
      body: { answerContent: stringArgument(input.arguments, "reply") },
    });
    const replyStep = step("inquiry-reply", remote);
    replyStep.data = { ...replyStep.data, sellerpilotInquiryKind: "product" };
    return result(input, [replyStep], decodeURIComponent(questionId));
  }
  if (input.operation === "orders.get") {
    const productOrderId = stringArgument(input.arguments, "productOrderId");
    const remote = await request({
      method: "POST",
      path: "/v1/pay-order/seller/product-orders/query",
      body: { productOrderIds: [productOrderId], quantityClaimCompatibility: true },
    });
    return result(input, [step("order", remote)], productOrderId);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await request({ method: "POST", path: "/v1/pay-order/seller/product-orders/confirm", body: objectValue(input.arguments, "body") });
    return result(input, [step("confirm", remote)]);
  }
  const remote = await request({ method: "POST", path: "/v1/pay-order/seller/product-orders/dispatch", body: objectValue(input.arguments, "body") });
  return result(input, [step("dispatch", remote)]);
}

function temuResultObject(data: Record<string, unknown>) {
  const value = data.result;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function temuResultRecords(data: Record<string, unknown>, ...keys: string[]) {
  const direct = data.result;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  const root = direct && typeof direct === "object" && !Array.isArray(direct)
    ? direct as Record<string, unknown>
    : {};
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
}

function normalizedTemuCarrier(value: unknown) {
  return String(value ?? "").trim().toLocaleUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function temuCarrierAliases(carrierCode: string) {
  const aliases: Record<string, string[]> = {
    CJGLS: ["CJ대한통운", "CJLOGISTICS"],
    HANJIN: ["한진", "HANJIN"],
    LOTTE: ["롯데", "LOTTE"],
    LOGEN: ["로젠", "LOGEN"],
    POST: ["우체국", "KOREAPOST"],
    EPOST: ["우체국", "KOREAPOST"],
  };
  return [carrierCode, ...(aliases[carrierCode.toLocaleUpperCase()] ?? [])]
    .map(normalizedTemuCarrier)
    .filter(Boolean);
}

function temuGoodsMatch(value: unknown, remoteId: string, externalGoodsId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return String(item.goodsId ?? "") === remoteId
    && [item.outGoodsSn, item.externalGoodsId].some((candidate) => String(candidate ?? "") === externalGoodsId);
}

function temuExternalIdentityConflict(remote: RemoteResponse) {
  const providerText = JSON.stringify(remote.data).toLowerCase();
  return remote.response.status === 409
    || /external.?goods.?id[\s\S]{0,120}(?:already.?exists|duplicate)/u.test(providerText)
    || /(?:already.?exists|duplicate)[\s\S]{0,120}external.?goods.?id/u.test(providerText);
}

function temuStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

async function executeTemu(input: ExecuteInput) {
  if (input.operation === "listing.publication.verify") {
    const certification = temuCredentialCertificationBinding(input.arguments);
    if (certification) {
      const accountRemote = await temuRequest({
        payload: input.payload,
        type: "bg.open.accesstoken.info.get",
        arguments: {},
      });
      const accountTransport = step("temu-credential-certification-account", accountRemote);
      const identity = accountTransport.ok
        ? normalizeTemuCredentialIdentityObservation(accountRemote.data)
        : null;
      const accountStep: ChannelOperationStep = {
        name: "temu-credential-certification-account",
        ok: Boolean(identity),
        status: identity ? 200 : accountTransport.status,
        ...(accountTransport.requestId ? { requestId: accountTransport.requestId } : {}),
        data: {
          sellerpilotVerification: identity
            ? "TEMU_CREDENTIAL_PROVIDER_IDENTITY_VERIFIED"
            : "TEMU_CREDENTIAL_PROVIDER_IDENTITY_UNVERIFIED",
          sellerpilotNoWriteConfirmed: true,
          sellerpilotNoSecretStored: true,
          ...(identity ? { sellerpilotTemuCredentialIdentity: identity } : {}),
        },
      };
      return result(input, [accountStep]);
    }
    const adoption = temuExistingAdoptionBinding(input.arguments);
    if (adoption) {
      const [detailRemote, statusRemote, stockRemote] = await Promise.all([
        temuRequest({
          payload: input.payload,
          type: "bg.local.goods.detail.query",
          arguments: { goodsId: temuExactLong(adoption.goodsId), versionQueryType: 1, language: "ko" },
        }),
        temuRequest({
          payload: input.payload,
          type: "bg.local.goods.publish.status.get",
          arguments: { goodsIdList: [temuExactLong(adoption.goodsId)] },
        }),
        temuRequest({
          payload: input.payload,
          type: "temu.local.goods.sku.stock.query",
          arguments: { goodsId: temuExactLong(adoption.goodsId) },
        }),
      ]);
      const detailStep = step("temu-existing-adoption-detail", detailRemote);
      const statusStep = step("temu-existing-adoption-status", statusRemote);
      const stockStep = step("temu-existing-adoption-stock", stockRemote);
      const externalGoodsId = detailStep.ok
        ? temuExistingAdoptionExternalGoodsId(detailRemote.data)
        : null;
      if (!detailStep.ok || !statusStep.ok || !stockStep.ok || !externalGoodsId) {
        return result(input, [detailStep, statusStep, stockStep, {
          name: "temu-existing-adoption-identity-fence",
          ok: false,
          status: 422,
          data: {
            sellerpilotVerification: "TEMU_EXISTING_ADOPTION_REMOTE_IDENTITY_UNVERIFIED",
            sellerpilotNoWriteConfirmed: true,
          },
        }], adoption.goodsId);
      }
      const listRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.list.retrieve",
        arguments: temuExactGoodsListArguments(externalGoodsId),
      });
      const listStep = step("temu-existing-adoption-list", listRemote);
      const observation = listStep.ok
        ? normalizeTemuExistingAdoptionObservation({
            binding: adoption,
            listData: listRemote.data,
            publishStatusData: statusRemote.data,
            detailData: detailRemote.data,
            stockData: stockRemote.data,
          })
        : null;
      const verificationStep: ChannelOperationStep = {
        name: "temu-existing-adoption-observation",
        ok: Boolean(observation),
        status: observation ? 200 : 422,
        data: {
          sellerpilotVerification: observation
            ? "TEMU_EXISTING_ACTIVE_OBSERVATION_VERIFIED"
            : "TEMU_EXISTING_ACTIVE_OBSERVATION_MISMATCH",
          sellerpilotNoWriteConfirmed: true,
          ...(observation ? { sellerpilotTemuExistingAdoptionObservation: observation } : {}),
        },
      };
      return result(
        input,
        [detailStep, statusStep, stockStep, listStep, verificationStep],
        adoption.goodsId,
      );
    }
    const discovery = temuContainmentDiscoveryBinding(input.arguments);
    if (!discovery || input.arguments.sellerpilotReadOnly !== true) {
      return result(input, [{
        name: "temu-containment-discovery-fence",
        ok: false,
        status: 422,
        data: {
          sellerpilotVerification: "TEMU_CONTAINMENT_DISCOVERY_CONTEXT_INVALID",
          sellerpilotNoWriteConfirmed: true,
        },
      }]);
    }
    const remote = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(discovery.externalGoodsId),
    });
    const discoveryStep = step("temu-containment-external-id-discovery", remote);
    const goods = temuResultObject(remote.data).goodsList;
    const matches = Array.isArray(goods)
      ? goods.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const record = item as Record<string, unknown>;
        return [record.outGoodsSn, record.externalGoodsId]
          .some((candidate) => String(candidate ?? "") === discovery.externalGoodsId);
      }) as Record<string, unknown>[]
      : [];
    const recoveredGoodsId = matches.length === 1
      ? temuExactLongGoodsId(matches[0]?.goodsId)
      : null;
    const exactOutcome = matches.length === 0 || (matches.length === 1 && Boolean(recoveredGoodsId));
    discoveryStep.ok = discoveryStep.ok && exactOutcome;
    discoveryStep.data = {
      ...discoveryStep.data,
      sellerpilotVerification: matches.length === 0
        ? "TEMU_CONTAINMENT_DISCOVERY_NOT_VISIBLE_YET"
        : recoveredGoodsId
          ? "TEMU_CONTAINMENT_DISCOVERY_EXACT_ONE"
          : "TEMU_CONTAINMENT_DISCOVERY_COLLISION_OR_INVALID_ID",
      sellerpilotReadOnly: true,
      sellerpilotExternalGoodsId: discovery.externalGoodsId,
      sellerpilotMatchingGoodsCount: matches.length,
      ...(recoveredGoodsId ? { sellerpilotRecoveredGoodsId: recoveredGoodsId } : {}),
      ...(!exactOutcome ? { sellerpilotReconciliationRequired: true } : {}),
    };
    return result(input, [discoveryStep], recoveredGoodsId ?? undefined);
  }
  if (input.operation === "categories.list" || input.operation === "categories.suggest" || input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const goodsName = stringArgument(input.arguments, "goodsName", false)
      || stringArgument(input.arguments, "query", false)
      || stringArgument(input.arguments, "categoryId", false);
    if (!goodsName) throw new Error("CHANNEL_ARGUMENT_REQUIRED:goodsName");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.category.recommend",
      arguments: {
        goodsName,
        ...(stringArgument(input.arguments, "description", false) ? { description: stringArgument(input.arguments, "description", false) } : {}),
        ...(stringArgument(input.arguments, "imageUrl", false) ? { imageUrl: stringArgument(input.arguments, "imageUrl", false) } : {}),
      },
    });
    const categoryId = temuResultObject(remote.data).catId;
    return result(input, [step("category-recommend", remote)], categoryId === undefined ? undefined : String(categoryId));
  }
  if (input.operation === "listing.update") {
    const update = temuExactExistingUpdateRequest(input.arguments);
    const expectedFingerprint = stringArgument(
      input.arguments,
      "publicationExpectedFingerprint",
      false,
    );
    const exactInput = Boolean(
      update
      && input.arguments.publicationStateContract === listingRemoteStateContractVersion
      && listingPublicationIntentFromArguments(input.arguments) === "live"
      && input.arguments.publicationExpectedLocale === "ko-KR"
      && Number(input.arguments.publicationExpectedImageCount) === marketplaceChannelDetailImageCount
      && /^[a-f0-9]{64}$/u.test(expectedFingerprint),
    );
    if (!exactInput || !update) {
      return result(input, [{
        name: "temu-exact-existing-update-prewrite-fence",
        ok: false,
        status: 422,
        data: {
          sellerpilotVerification: "TEMU_EXACT_EXISTING_UPDATE_CONTEXT_INVALID",
          sellerpilotNoWriteConfirmed: true,
        },
      }]);
    }

    const readExact = async () => {
      const [list, status, detail, stock] = await Promise.all([
        temuRequest({
          payload: input.payload,
          type: "temu.local.goods.list.retrieve",
          arguments: temuExactGoodsListArguments(update.binding.externalGoodsId),
        }),
        temuRequest({
          payload: input.payload,
          type: "bg.local.goods.publish.status.get",
          arguments: { goodsIdList: [temuExactLong(update.binding.goodsId)] },
        }),
        temuRequest({
          payload: input.payload,
          type: "bg.local.goods.detail.query",
          arguments: {
            goodsId: temuExactLong(update.binding.goodsId),
            versionQueryType: 1,
            language: "ko",
          },
        }),
        temuRequest({
          payload: input.payload,
          type: "temu.local.goods.sku.stock.query",
          arguments: { goodsId: temuExactLong(update.binding.goodsId) },
        }),
      ]);
      return { list, status, detail, stock };
    };

    const tokenInfo = await temuRequest({
      payload: input.payload,
      type: "bg.open.accesstoken.info.get",
      arguments: {},
    });
    const tokenTransport = step("temu-exact-update-current-credential", tokenInfo);
    const tokenIdentity = tokenTransport.ok
      ? normalizeTemuCredentialIdentityObservation(tokenInfo.data)
      : null;
    const tokenInfoResult = temuResultObject(tokenInfo.data);
    const rawScopes = Array.isArray(tokenInfoResult.apiScopeList)
      ? tokenInfoResult.apiScopeList
      : [];
    const scopes = rawScopes.map((scope) => typeof scope === "string" ? scope.trim() : "");
    const credentialVerified = Boolean(tokenIdentity)
      && tokenIdentity?.sellerAccountKey === update.binding.sellerAccountKey
      && scopes.length === rawScopes.length
      && scopes.every(Boolean)
      && new Set(scopes).size === scopes.length
      && scopes.includes(temuExactExistingUpdateIdentity.providerOperation);
    const credentialStep: ChannelOperationStep = {
      name: "temu-exact-update-current-credential",
      ok: credentialVerified,
      status: credentialVerified ? 200 : 422,
      data: {
        sellerpilotVerification: credentialVerified
          ? "TEMU_CURRENT_TOKEN_SELLER_AND_PARTIAL_UPDATE_SCOPE_VERIFIED"
          : "TEMU_CURRENT_TOKEN_SELLER_OR_PARTIAL_UPDATE_SCOPE_UNVERIFIED",
        sellerpilotNoWriteConfirmed: true,
      },
    };
    if (!credentialVerified) return result(input, [credentialStep], update.binding.goodsId);

    const pre = await readExact();
    const preSteps = [
      credentialStep,
      step("temu-exact-update-pre-list", pre.list),
      step("temu-exact-update-pre-status", pre.status),
      step("temu-exact-update-pre-detail", pre.detail),
      step("temu-exact-update-pre-stock", pre.stock),
    ];
    const preReadback = normalizeTemuListingPublicationReadback({
      operation: "listing.update",
      intent: "live",
      remoteId: update.binding.goodsId,
      externalGoodsId: update.binding.externalGoodsId,
      listData: pre.list.data,
      publishStatusData: pre.status.data,
      detailData: pre.detail.data,
      stockData: pre.stock.data,
      expectedLocale: temuExactExistingUpdateIdentity.locale,
      expectedFingerprint,
      expectedRepresentativeImages: update.expectedRepresentativeImages,
      expectedDetailImages: update.expectedDetailImages,
      requestedLanguage: "ko",
      expectedGoodsName: update.providerArguments.goodsName,
      expectedGoodsDesc: update.providerArguments.goodsDesc,
      expectedBulletPoints: update.providerArguments.bulletPoints,
      expectedSkus: update.expectedSkus,
      requireExactActiveStatus: true,
    });
    const preChecks = preReadback.checks;
    const preflightOk = preSteps.every((entry) => entry.ok)
      && preReadback.visibility === "live"
      && preReadback.providerStatus === "statusName=ACTIVE;goodsStatus=ACTIVE"
      && preChecks.identityVerified
      && preChecks.statusVerified
      && preChecks.representativeImageVerified
      && preChecks.imageCountVerified
      && preChecks.imageOrderVerified
      && preChecks.skuIdentityVerified
      && preChecks.priceVerified
      && preChecks.stockVerified
      && preChecks.goodsIdVerified
      && preChecks.externalGoodsIdVerified;
    const preflightStep: ChannelOperationStep = {
      name: "temu-exact-existing-update-preflight",
      ok: preflightOk,
      status: preflightOk ? 200 : 422,
      data: {
        sellerpilotVerification: preflightOk
          ? "TEMU_EXACT_ACTIVE_COMMERCE_AND_ASSETS_VERIFIED"
          : "TEMU_EXACT_ACTIVE_COMMERCE_OR_ASSETS_MISMATCH",
        sellerpilotPublicationChecks: preChecks,
        sellerpilotRemoteVisibility: preReadback.visibility,
        sellerpilotNoWriteConfirmed: true,
      },
    };
    if (!preflightOk) return result(input, [...preSteps, preflightStep], update.binding.goodsId);

    if (!input.providerMutationHooks) {
      return result(input, [preflightStep, {
        name: "temu-exact-existing-update-provider-boundary",
        ok: false,
        status: 409,
        data: {
          sellerpilotVerification: "TEMU_EXACT_UPDATE_PROVIDER_BOUNDARY_REQUIRED",
          sellerpilotNoWriteConfirmed: true,
        },
      }], update.binding.goodsId);
    }
    await input.providerMutationHooks.assertLeaseHealthy();
    await input.providerMutationHooks.begin();
    await input.providerMutationHooks.assertLeaseHealthy();

    // The official partial-update contract is deliberately used here. Images,
    // price, stock, SKU identity, and sale state are immutable in this action
    // and were independently verified above. There is exactly one provider
    // mutation; any ambiguous transport outcome is quarantined by the gateway.
    const updateRemote = await temuRequest({
      payload: input.payload,
      type: temuExactExistingUpdateIdentity.providerOperation,
      arguments: {
        ...update.providerArguments,
        goodsId: temuExactLong(update.binding.goodsId),
      },
    });
    const updateStep = step("temu-exact-content-partial-update", updateRemote);

    const post = await readExact();
    const postTransportSteps = [
      step("temu-exact-update-post-list", post.list),
      step("temu-exact-update-post-status", post.status),
      step("temu-exact-update-post-detail", post.detail),
      step("temu-exact-update-post-stock", post.stock),
    ];
    const postReadback = normalizeTemuListingPublicationReadback({
      operation: "listing.update",
      intent: "live",
      remoteId: update.binding.goodsId,
      externalGoodsId: update.binding.externalGoodsId,
      listData: post.list.data,
      publishStatusData: post.status.data,
      detailData: post.detail.data,
      stockData: post.stock.data,
      expectedLocale: temuExactExistingUpdateIdentity.locale,
      expectedFingerprint,
      expectedRepresentativeImages: update.expectedRepresentativeImages,
      expectedDetailImages: update.expectedDetailImages,
      requestedLanguage: "ko",
      expectedGoodsName: update.providerArguments.goodsName,
      expectedGoodsDesc: update.providerArguments.goodsDesc,
      expectedBulletPoints: update.providerArguments.bulletPoints,
      expectedSkus: update.expectedSkus,
      requireExactActiveStatus: true,
    });
    const postOk = updateStep.ok
      && postTransportSteps.every((entry) => entry.ok)
      && Boolean(postReadback.remoteState)
      && postReadback.visibility === "live"
      && postReadback.providerStatus === preReadback.providerStatus
      && postReadback.providerStatus === "statusName=ACTIVE;goodsStatus=ACTIVE";
    const postStep: ChannelOperationStep = {
      name: "temu-exact-existing-update-post-readback",
      ok: postOk,
      status: postOk ? 200 : 422,
      data: {
        sellerpilotVerification: postOk
          ? "TEMU_EXACT_CONTENT_UPDATE_AND_LIVE_STATE_VERIFIED"
          : "TEMU_EXACT_CONTENT_UPDATE_READBACK_UNVERIFIED",
        sellerpilotPublicationChecks: postReadback.checks,
        sellerpilotRemoteVisibility: postReadback.visibility,
        sellerpilotProviderStatus: postReadback.providerStatus,
        ...(!postOk ? { sellerpilotReconciliationRequired: true } : {}),
      },
    };
    return result(
      input,
      [preflightStep, updateStep, ...postTransportSteps, postStep],
      update.binding.goodsId,
      undefined,
      postReadback.remoteState,
    );
  }
  if (input.operation === "listing.activate") {
    const activation = temuActivationBinding(input.arguments);
    const body = objectValue(input.arguments, "body", false);
    const goodsBasic = objectValue(body, "goodsBasic", false);
    const expectedRepresentativeImages = temuStringArray(goodsBasic.goodsCarouselImage);
    const expectedDetailImages = temuStringArray(goodsBasic.detailImage);
    const expectedBulletPoints = temuStringArray(goodsBasic.bulletPoints);
    const expectedSkus = temuPublicationExpectedSkus(body);
    const expectedLocale = stringArgument(input.arguments, "publicationExpectedLocale", false);
    const expectedFingerprint = stringArgument(input.arguments, "publicationExpectedFingerprint", false);
    const expectedImageCount = Number(input.arguments.publicationExpectedImageCount);
    const exactLeafCategoryId = stringArgument(goodsBasic, "extCatName", false);
    const shippingTemplate = stringArgument(goodsBasic, "costTemplate", false);
    const exactInput = Boolean(
      activation
      && input.arguments.publicationStateContract === listingRemoteStateContractVersion
      && listingPublicationIntentFromArguments(input.arguments) === "live"
      && expectedLocale === "ko-KR"
      && body.language === "ko"
      && /^[a-f0-9]{64}$/u.test(expectedFingerprint)
      && expectedImageCount === marketplaceChannelDetailImageCount
      && /^[1-9]\d*$/u.test(exactLeafCategoryId)
      && Boolean(shippingTemplate)
      && shippingTemplate.length <= 500
      && !/\p{Cc}/u.test(shippingTemplate)
      && expectedRepresentativeImages.length === 1
      && /^https:\/\//u.test(expectedRepresentativeImages[0])
      && !expectedDetailImages.includes(expectedRepresentativeImages[0])
      && expectedDetailImages.length === marketplaceChannelDetailImageCount
      && new Set(expectedDetailImages).size === marketplaceChannelDetailImageCount
      && expectedDetailImages.every((url) => /^https:\/\//u.test(url))
      && Boolean(expectedSkus)
    );
    if (!exactInput || !activation) {
      return result(input, [{
        name: "temu-activation-prewrite-fence",
        ok: false,
        status: 422,
        data: {
          sellerpilotVerification: "TEMU_ACTIVATION_CONTEXT_INVALID",
          sellerpilotNoWriteConfirmed: true,
        },
      }]);
    }

    const preList = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(activation.externalGoodsId),
    });
    const preStatus = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [temuExactLong(activation.exactGoodsId)] },
    });
    const preDetail = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId), versionQueryType: 1, language: "ko" },
    });
    const preStock = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.sku.stock.query",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId) },
    });
    const prePublication = normalizeTemuListingPublicationReadback({
      operation: "listing.create",
      intent: "safe_test",
      remoteId: activation.goodsId,
      externalGoodsId: activation.externalGoodsId,
      listData: preList.data,
      publishStatusData: preStatus.data,
      detailData: preDetail.data,
      expectedLocale,
      expectedFingerprint,
      expectedRepresentativeImages,
      expectedDetailImages,
      requestedLanguage: "ko",
      expectedGoodsName: stringArgument(goodsBasic, "goodsName", false),
      expectedGoodsDesc: stringArgument(goodsBasic, "goodsDesc", false),
      expectedBulletPoints,
      expectedSkus: expectedSkus!,
      stockData: preStock.data,
    });
    const preListStep = step("temu-activation-pre-list", preList);
    const preStatusStep = step("temu-activation-pre-status", preStatus);
    const preDetailStep = step("temu-activation-pre-detail", preDetail);
    const preStockStep = step("temu-activation-pre-stock", preStock);
    const preflightStep: ChannelOperationStep = {
      name: "temu-activation-non-public-preflight",
      ok: Boolean(preListStep.ok
        && preStatusStep.ok
        && preDetailStep.ok
        && preStockStep.ok
        && prePublication.remoteState
        && ["non_public", "withdrawn"].includes(prePublication.remoteState.visibility)),
      status: prePublication.remoteState ? 200 : 422,
      data: {
        sellerpilotVerification: prePublication.remoteState
          ? "TEMU_EXACT_NON_PUBLIC_ACTIVATION_SOURCE_VERIFIED"
          : "TEMU_EXACT_NON_PUBLIC_ACTIVATION_SOURCE_UNVERIFIED",
        sellerpilotPublicationChecks: prePublication.checks,
        sellerpilotRemoteVisibility: prePublication.visibility,
      },
    };
    if (!preflightStep.ok) return result(input, [preflightStep], activation.goodsId);

    if (!input.providerMutationHooks) {
      return result(input, [preflightStep, {
        name: "temu-activation-provider-boundary",
        ok: false,
        status: 409,
        data: {
          sellerpilotNoWriteConfirmed: true,
          sellerpilotVerification: "TEMU_ACTIVATION_PROVIDER_BOUNDARY_REQUIRED",
        },
      }], activation.goodsId);
    }
    await input.providerMutationHooks.assertLeaseHealthy();
    await input.providerMutationHooks.begin();
    await input.providerMutationHooks.assertLeaseHealthy();

    const activateRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.sale.status.set",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId), onsale: 1, operationType: 1 },
    });
    const activateStep = step("goods-activate", activateRemote);

    const postList = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(activation.externalGoodsId),
    });
    const postStatus = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [temuExactLong(activation.exactGoodsId)] },
    });
    const postDetail = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId), versionQueryType: 1, language: "ko" },
    });
    const postStock = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.sku.stock.query",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId) },
    });
    const postPublication = normalizeTemuListingPublicationReadback({
      operation: "listing.create",
      intent: "live",
      remoteId: activation.goodsId,
      externalGoodsId: activation.externalGoodsId,
      listData: postList.data,
      publishStatusData: postStatus.data,
      detailData: postDetail.data,
      expectedLocale,
      expectedFingerprint,
      expectedRepresentativeImages,
      expectedDetailImages,
      requestedLanguage: "ko",
      expectedGoodsName: stringArgument(goodsBasic, "goodsName", false),
      expectedGoodsDesc: stringArgument(goodsBasic, "goodsDesc", false),
      expectedBulletPoints,
      expectedSkus: expectedSkus!,
      stockData: postStock.data,
    });
    const postListStep = step("temu-activation-post-list", postList);
    const postStatusStep = step("temu-activation-post-status", postStatus);
    const postDetailStep = step("temu-activation-post-detail", postDetail);
    const postStockStep = step("temu-activation-post-stock", postStock);
    const postStep: ChannelOperationStep = {
      name: "temu-activation-post-readback",
      ok: Boolean(postListStep.ok
        && postStatusStep.ok
        && postDetailStep.ok
        && postStockStep.ok
        && postPublication.remoteState),
      status: postPublication.remoteState ? 200 : 422,
      data: {
        sellerpilotVerification: postPublication.remoteState
          ? "TEMU_ACTIVATION_LIVE_OR_PENDING_VERIFIED"
          : "TEMU_ACTIVATION_STATE_UNVERIFIED",
        sellerpilotPublicationChecks: postPublication.checks,
        sellerpilotRemoteVisibility: postPublication.visibility,
        sellerpilotProviderStatus: postPublication.providerStatus,
        ...(!postPublication.remoteState ? { sellerpilotReconciliationRequired: true } : {}),
      },
    };
    return result(
      input,
      [preflightStep, activateStep, postStockStep, postStep],
      activation.goodsId,
      undefined,
      postPublication.remoteState,
    );
  }
  if (input.operation === "listing.create") {
    const body = objectValue(input.arguments, "body");
    const goodsBasic = objectValue(body, "goodsBasic");
    const externalGoodsId = stringArgument(goodsBasic, "externalGoodsId");
    const strictPublication = input.arguments.publicationStateContract === listingRemoteStateContractVersion;
    const publicationIntent = listingPublicationIntentFromArguments(input.arguments);
    const expectedLocale = stringArgument(input.arguments, "publicationExpectedLocale", false);
    const expectedFingerprint = stringArgument(input.arguments, "publicationExpectedFingerprint", false);
    const expectedImageCount = Number(input.arguments.publicationExpectedImageCount);
    const expectedRepresentativeImages = temuStringArray(goodsBasic.goodsCarouselImage);
    const expectedDetailImages = temuStringArray(goodsBasic.detailImage);
    const expectedBulletPoints = temuStringArray(goodsBasic.bulletPoints);
    const expectedSkus = temuPublicationExpectedSkus(body);
    if (strictPublication) {
      const providerLanguage = String(body.language ?? goodsBasic.language ?? "")
        .trim()
        .replaceAll("_", "-")
        .toLowerCase();
      const exactLeafCategoryId = stringArgument(goodsBasic, "extCatName", false);
      const shippingTemplate = stringArgument(goodsBasic, "costTemplate", false);
      const exactPublicationInput = Boolean(
        publicationIntent
        && expectedLocale === "ko-KR"
        && (providerLanguage === "ko" || providerLanguage === "ko-kr")
        && /^[a-f0-9]{64}$/u.test(expectedFingerprint)
        && input.arguments.publicationExpectedImageCount === marketplaceChannelDetailImageCount
        && /^[1-9]\d*$/u.test(exactLeafCategoryId)
        && Boolean(shippingTemplate)
        && shippingTemplate.length <= 500
        && !/\p{Cc}/u.test(shippingTemplate)
        && !/^(?:server_managed|unknown|n\/a|미확인|확인 필요)$/iu.test(shippingTemplate)
        && expectedRepresentativeImages.length === 1
        && /^https:\/\//u.test(expectedRepresentativeImages[0])
        && !expectedDetailImages.includes(expectedRepresentativeImages[0])
        && expectedDetailImages.length === marketplaceChannelDetailImageCount
        && new Set(expectedDetailImages).size === marketplaceChannelDetailImageCount
        && expectedDetailImages.every((url) => /^https:\/\//u.test(url))
        && temuCreateCorrelationMatches(input.arguments, externalGoodsId)
        && Boolean(expectedSkus)
      );
      if (!exactPublicationInput) {
        return result(input, [{
          name: "publication-prewrite",
          ok: false,
          status: 422,
          data: {
            error: "TEMU_PUBLICATION_PREWRITE_INVALID",
            sellerpilotVerification: "TEMU_PUBLICATION_PREWRITE_REJECTED",
          },
        }]);
      }
    }
    const steps: ChannelOperationStep[] = [];
    const preflightRemote = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(externalGoodsId),
    });
    const preflightStep = step("goods-create-external-id-preflight", preflightRemote);
    const preflightGoods = temuResultObject(preflightRemote.data).goodsList;
    const preflightListVerified = Array.isArray(preflightGoods);
    const preflightEmpty = preflightListVerified && preflightGoods.length === 0;
    preflightStep.ok = preflightStep.ok && preflightEmpty;
    preflightStep.data = {
      ...preflightStep.data,
      ...(preflightListVerified && !preflightEmpty
        ? { sellerpilotReconciliationRequired: true }
        : {}),
      observedGoodsCount: preflightListVerified ? preflightGoods.length : undefined,
      sellerpilotVerification: preflightEmpty
        ? "TEMU_EXTERNAL_ID_AVAILABLE"
        : preflightListVerified
          ? "TEMU_EXTERNAL_ID_ALREADY_EXISTS"
          : "TEMU_EXTERNAL_ID_PREFLIGHT_UNVERIFIED",
    };
    steps.push(preflightStep);
    if (!preflightStep.ok) return result(input, steps);

    let createRemote: RemoteResponse | null = null;
    let createTransportUncertain = false;
    try {
      createRemote = await temuRequest({ payload: input.payload, type: "temu.local.goods.v3.add", arguments: body });
    } catch {
      // A network timeout after the provider accepted the create is not proof
      // that no product exists. Reconcile by the immutable externalGoodsId and
      // never issue a second create from this execution.
      createTransportUncertain = true;
    }
    const created = createRemote ? temuResultObject(createRemote.data) : {};
    let remoteId = temuExactLongGoodsId(created.goodsId) ?? "";
    const createStep = createRemote ? step("goods-v3-add", createRemote) : null;
    if (createStep?.ok && remoteId) {
      steps.push(createStep);
    } else {
      if (createStep) {
        if (!createStep.ok && createRemote && temuExternalIdentityConflict(createRemote)) {
          createStep.data = {
            ...createStep.data,
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification: "TEMU_EXTERNAL_ID_COLLISION_MANUAL_RECONCILIATION",
          };
        }
        steps.push(createStep);
      }
      // A definite provider rejection must never be converted into ownership of
      // a pre-existing product with the same external ID. In particular, a
      // duplicate response is a manual reconciliation case, not permission to
      // look up and off-shelf someone else's existing listing.
      const recoveryAllowed = preflightEmpty
        && temuCreateCorrelationMatches(input.arguments, externalGoodsId)
        && (createTransportUncertain || createStep?.ok === true);
      if (!recoveryAllowed) {
        if (createTransportUncertain) {
          steps.push({
            name: "goods-v3-add",
            ok: false,
            status: 408,
            data: {
              sellerpilotReconciliationRequired: true,
              sellerpilotVerification: "TEMU_CREATE_TRANSPORT_UNCERTAIN_WITHOUT_LINEAGE",
            },
          });
        }
        return result(input, steps);
      }
      // Preserve a provider-accepted create marker even if the response omitted
      // goodsId. If lookup recovery also misses, the gateway must quarantine
      // this create instead of treating it as safely retryable.
      // A successful Temu create can outlive a gateway timeout. Retrying the same
      // external ID would otherwise fail as a duplicate, so recover the existing
      // product and continue the same status/image verification path.
      const reconcileRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.list.retrieve",
        arguments: temuExactGoodsListArguments(externalGoodsId),
      });
      const reconcileGoods = temuResultObject(reconcileRemote.data).goodsList;
      const matchingGoods = Array.isArray(reconcileGoods)
        ? reconcileGoods.filter((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const record = item as Record<string, unknown>;
          return [record.outGoodsSn, record.externalGoodsId].some((candidate) => String(candidate ?? "") === externalGoodsId);
        }) as Record<string, unknown>[]
        : [];
      const existing = matchingGoods.length === 1 ? matchingGoods[0] : undefined;
      remoteId = temuExactLongGoodsId(existing?.goodsId) ?? "";
      const reconcileStep = step("goods-reconcile", reconcileRemote);
      reconcileStep.ok = reconcileStep.ok && matchingGoods.length === 1 && Boolean(remoteId);
      reconcileStep.data = {
        ...reconcileStep.data,
        recoveredGoodsId: remoteId || undefined,
        matchingGoodsCount: matchingGoods.length,
        createStatus: createRemote?.response.status,
        createTransportUncertain,
        ...(!remoteId || matchingGoods.length !== 1 ? { sellerpilotReconciliationRequired: true } : {}),
        sellerpilotVerification: remoteId ? "EXISTING_GOODS_RECOVERED" : "TEMU_GOODS_RECONCILE_MISSING",
      };
      steps.push(reconcileStep);
      if (!reconcileStep.ok || !remoteId) return result(input, steps, remoteId || undefined);
    }

    if (!remoteId) {
      steps.push({
        name: "goods-id-exact-long-verification",
        ok: false,
        status: 422,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification: "TEMU_GOODS_ID_NOT_EXACT_LONG",
        },
      });
      return result(input, steps);
    }

    // safe_test is a containment operation. As soon as the immutable provider
    // identity is known, request off-shelf before any fallible list/status/detail
    // readback. A later eventual-consistency miss therefore cannot leave a
    // provider-accepted create untreated or be reported as successful.
    if (strictPublication && publicationIntent === "safe_test") {
      let offShelfRemote: RemoteResponse;
      try {
        offShelfRemote = await temuRequest({
          payload: input.payload,
          type: "bg.local.goods.sale.status.set",
          arguments: { goodsId: temuExactLong(remoteId), onsale: 0, operationType: 1 },
        });
      } catch {
        steps.push({
          name: "goods-safe-test-off-shelf",
          ok: false,
          status: 408,
          data: {
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification: "TEMU_SAFE_TEST_OFF_SHELF_TRANSPORT_UNCERTAIN",
            sellerpilotKnownGoodsId: remoteId,
            sellerpilotKnownExternalGoodsId: externalGoodsId,
          },
        });
        return result(input, steps, remoteId);
      }
      const offShelfStep = step("goods-safe-test-off-shelf", offShelfRemote);
      steps.push(offShelfStep);
      if (!offShelfStep.ok) return result(input, steps, remoteId);
    }

    let readbackRemote: RemoteResponse;
    try {
      readbackRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.list.retrieve",
        arguments: temuExactGoodsListArguments(externalGoodsId),
      });
    } catch {
      steps.push({
        name: "goods-readback",
        ok: false,
        status: 408,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification: "TEMU_POST_CREATE_LIST_TRANSPORT_UNCERTAIN",
          sellerpilotKnownGoodsId: remoteId,
          sellerpilotKnownExternalGoodsId: externalGoodsId,
        },
      });
      return result(input, steps, remoteId);
    }
    const readbackStep = step(
      strictPublication && publicationIntent === "safe_test"
        ? "goods-safe-test-off-shelf-readback"
        : "goods-readback",
      readbackRemote,
    );
    const goodsList = temuResultObject(readbackRemote.data).goodsList;
    const matched = Array.isArray(goodsList) && goodsList.some((item) => temuGoodsMatch(item, remoteId, externalGoodsId));
    readbackStep.ok = readbackStep.ok && matched;
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotVerification: matched ? "EXTERNAL_ID_VERIFIED" : "TEMU_EXTERNAL_ID_READBACK_MISSING",
    };
    steps.push(readbackStep);
    if (!readbackStep.ok) return result(input, steps, remoteId);
    const finalListReadbackRemote = readbackRemote;

    let publishStatusRemote: RemoteResponse;
    try {
      publishStatusRemote = await temuRequest({
        payload: input.payload,
        type: "bg.local.goods.publish.status.get",
        arguments: { goodsIdList: [temuExactLong(remoteId)] },
      });
    } catch {
      steps.push({
        name: "goods-publish-status",
        ok: false,
        status: 408,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification: "TEMU_POST_CREATE_STATUS_TRANSPORT_UNCERTAIN",
          sellerpilotKnownGoodsId: remoteId,
          sellerpilotKnownExternalGoodsId: externalGoodsId,
        },
      });
      return result(input, steps, remoteId);
    }
    const publishStatusStep = step("goods-publish-status", publishStatusRemote);
    const publishStatuses = temuResultObject(publishStatusRemote.data).goodsPublishStatusList;
    const publishStatus = Array.isArray(publishStatuses)
      ? publishStatuses.find((item) => item && typeof item === "object" && !Array.isArray(item)
        && String((item as Record<string, unknown>).goodsId ?? "") === remoteId) as Record<string, unknown> | undefined
      : undefined;
    publishStatusStep.ok = publishStatusStep.ok && Boolean(publishStatus);
    publishStatusStep.data = {
      ...publishStatusStep.data,
      remoteGoodsStatus: publishStatus?.status,
      remoteGoodsSubStatus: publishStatus?.subStatus,
      sellerpilotVerification: publishStatus ? "PUBLISH_STATUS_VERIFIED" : "TEMU_PUBLISH_STATUS_MISSING",
    };
    steps.push(publishStatusStep);
    if (!publishStatusStep.ok) return result(input, steps, remoteId);

    let detailRemote: RemoteResponse;
    try {
      detailRemote = await temuRequest({
        payload: input.payload,
        type: "bg.local.goods.detail.query",
        arguments: { goodsId: temuExactLong(remoteId), versionQueryType: 1, language: "ko" },
      });
    } catch {
      steps.push({
        name: "goods-detail-image-readback",
        ok: false,
        status: 408,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification: "TEMU_POST_CREATE_DETAIL_TRANSPORT_UNCERTAIN",
          sellerpilotKnownGoodsId: remoteId,
          sellerpilotKnownExternalGoodsId: externalGoodsId,
        },
      });
      return result(input, steps, remoteId);
    }
    let stockRemote: RemoteResponse | null = null;
    if (strictPublication) {
      try {
        stockRemote = await temuRequest({
          payload: input.payload,
          type: "temu.local.goods.sku.stock.query",
          arguments: { goodsId: temuExactLong(remoteId) },
        });
      } catch {
        steps.push({
          name: "goods-sku-stock-readback",
          ok: false,
          status: 408,
          data: {
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification: "TEMU_POST_CREATE_STOCK_TRANSPORT_UNCERTAIN",
            sellerpilotKnownGoodsId: remoteId,
            sellerpilotKnownExternalGoodsId: externalGoodsId,
          },
        });
        return result(input, steps, remoteId);
      }
    }
    const detailStep = step("goods-detail-image-readback", detailRemote);
    const detail = temuResultObject(detailRemote.data);
    const gallery = objectValue(detail, "goodsGallery", false);
    const expectedCarouselImageCount = temuStringArray(goodsBasic.goodsCarouselImage).length;
    const expectedDetailImageCount = temuStringArray(goodsBasic.detailImage).length;
    const actualCarouselImageCount = temuStringArray(gallery.goodsCarouselImage).length;
    const actualDetailImageCount = temuStringArray(gallery.detailImage).length;
    const detailMatches = String(detail.goodsId ?? "") === remoteId;
    const imagesMatch = strictPublication
      ? expectedImageCount === marketplaceChannelDetailImageCount
        && expectedRepresentativeImages.length === 1
        && actualCarouselImageCount === 1
        && temuStringArray(gallery.goodsCarouselImage)[0] === expectedRepresentativeImages[0]
        && expectedDetailImageCount === marketplaceChannelDetailImageCount
        && actualDetailImageCount === marketplaceChannelDetailImageCount
        && temuStringArray(gallery.detailImage).every((url, index) => url === expectedDetailImages[index])
      : actualCarouselImageCount >= expectedCarouselImageCount
        && actualDetailImageCount >= expectedDetailImageCount;
    const publication = strictPublication
      ? normalizeTemuListingPublicationReadback({
          operation: "listing.create",
          intent: publicationIntent,
          remoteId,
          externalGoodsId,
          listData: finalListReadbackRemote.data,
          publishStatusData: publishStatusRemote.data,
          detailData: detailRemote.data,
          expectedLocale,
          expectedFingerprint,
          expectedRepresentativeImages,
          expectedDetailImages,
          requestedLanguage: "ko",
          expectedGoodsName: stringArgument(goodsBasic, "goodsName", false),
          expectedGoodsDesc: stringArgument(goodsBasic, "goodsDesc", false),
          expectedBulletPoints,
          expectedSkus: expectedSkus!,
          stockData: stockRemote!.data,
        })
      : null;
    if (stockRemote) {
      const stockStep = step("goods-sku-stock-readback", stockRemote);
      stockStep.ok = stockStep.ok && Boolean(publication?.checks.stockVerified);
      stockStep.data = {
        ...stockStep.data,
        sellerpilotVerification: publication?.checks.stockVerified
          ? "TEMU_SKU_STOCK_VERIFIED"
          : "TEMU_SKU_STOCK_MISMATCH",
      };
      steps.push(stockStep);
    }
    detailStep.ok = detailStep.ok && detailMatches && imagesMatch;
    if (strictPublication) detailStep.ok = detailStep.ok && Boolean(publication?.remoteState);
    detailStep.data = {
      ...detailStep.data,
      expectedCarouselImageCount,
      actualCarouselImageCount,
      expectedDetailImageCount,
      actualDetailImageCount,
      ...(publication ? {
          sellerpilotPublicationChecks: publication.checks,
          sellerpilotRemoteVisibility: publication.visibility,
          sellerpilotProviderStatus: publication.providerStatus,
        } : {}),
      sellerpilotVerification: detailStep.ok
        ? "IMAGES_VERIFIED"
        : publication && !publication.checks.skuIdentityVerified
          ? "TEMU_SKU_IDENTITY_READBACK_MISMATCH"
          : publication && !publication.checks.priceVerified
            ? "TEMU_PRICE_READBACK_MISMATCH"
            : publication && !publication.checks.stockVerified
              ? "TEMU_STOCK_READBACK_MISMATCH"
              : "TEMU_IMAGE_READBACK_MISSING",
    };
    steps.push(detailStep);
    return result(input, steps, remoteId, undefined, publication?.remoteState);
  }
  if (input.operation === "price.update") {
    const goodsId = integerArgument(input.arguments, "goodsId", { min: 1 });
    const goodsIdText = String(goodsId);
    const skuId = integerArgument(input.arguments, "skuId", { min: 1 });
    const skuIdText = String(skuId);
    const price = integerArgument(input.arguments, "price", { min: 1 });
    const currency = stringArgument(input.arguments, "currency", false) || "KRW";
    const reason = stringArgument(input.arguments, "reason", false);
    const rejectSkuPricing = booleanArgument(input.arguments, "rejectSkuPricing");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.priceorder.change.sku.price",
      arguments: {
        goodsId,
        changeSkuPriceDTOList: [{
          ...(reason ? { reason } : {}),
          skuChangePriceBaseDTOList: [{
            skuId,
            newSupplierPrice: { amount: String(price), currency },
          }],
        }],
        ...(rejectSkuPricing ? { rejectSkuPricing: true } : {}),
      },
    });
    const priceStep = step("goods-price", remote);
    // The price-change response is the provider's per-SKU acceptance report.
    // Temu has no readback for a single pending price order, so verify from
    // successSkuList and fail closed when the SKU is reported as failed. A
    // "has not changed" rejection means the SKU already carries the requested
    // price, which is the idempotent retry outcome and counts as verified.
    const providerResult = temuResultObject(remote.data);
    const successSkus = Array.isArray(providerResult.successSkuList)
      ? providerResult.successSkuList.map((item) => String(item ?? "")).filter(Boolean)
      : [];
    const failedSkus = Array.isArray(providerResult.failedSkuList)
      ? providerResult.failedSkuList.map((item) => String(item ?? "")).filter(Boolean)
      : [];
    const failureReasons = providerResult.failedSkuReasonMap && typeof providerResult.failedSkuReasonMap === "object" && !Array.isArray(providerResult.failedSkuReasonMap)
      ? providerResult.failedSkuReasonMap as Record<string, unknown>
      : {};
    const priceAlreadySet = failedSkus.includes(skuIdText)
      && /has not changed/i.test(String(failureReasons[skuIdText] ?? ""));
    const verified = priceStep.ok && (successSkus.includes(skuIdText) || priceAlreadySet);
    const rejectionReasons = failedSkus
      .map((sku) => String(failureReasons[sku] ?? "").trim())
      .filter(Boolean)
      .join(" · ");
    priceStep.ok = verified;
    priceStep.data = {
      ...priceStep.data,
      reason: rejectionReasons || undefined,
      requestedSkuId: skuIdText,
      remoteSuccessSkuList: successSkus,
      remoteFailedSkuList: failedSkus,
      sellerpilotVerification: verified ? "SKU_PRICE_VERIFIED" : "TEMU_SKU_PRICE_REJECTED",
    };
    return result(input, [priceStep], goodsIdText);
  }
  if (input.operation === "listing.stop") {
    const goodsId = stringArgument(input.arguments, "goodsId");
    const strictPublication = input.arguments.publicationStateContract === listingRemoteStateContractVersion;
    const externalGoodsId = stringArgument(input.arguments, "externalGoodsId", !strictPublication ? false : true);
    const exactGoodsId = temuExactLongGoodsId(goodsId);
    if (exactGoodsId === null) {
      return result(input, [{
        name: "goods-id-exact-long-verification",
        ok: false,
        status: 422,
        data: { sellerpilotVerification: "TEMU_GOODS_ID_NOT_EXACT_LONG" },
      }]);
    }
    const remote = await temuRequest({ payload: input.payload, type: "bg.local.goods.sale.status.set", arguments: { goodsId: temuExactLong(exactGoodsId), onsale: 0, operationType: 1 } });
    const steps: ChannelOperationStep[] = [step("goods-off-shelf", remote)];
    if (!steps[0].ok || !strictPublication) return result(input, steps, goodsId);
    const listRemote = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(externalGoodsId),
    });
    const listStep = step("goods-off-shelf-list-readback", listRemote);
    steps.push(listStep);
    const statusRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [temuExactLong(exactGoodsId)] },
    });
    const statusStep = step("goods-off-shelf-status-readback", statusRemote);
    steps.push(statusStep);
    const detailRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(exactGoodsId), versionQueryType: 1, language: "ko" },
    });
    const publication = normalizeTemuListingPublicationReadback({
      operation: "listing.stop",
      remoteId: goodsId,
      externalGoodsId,
      listData: listRemote.data,
      publishStatusData: statusRemote.data,
      detailData: detailRemote.data,
      expectedLocale: stringArgument(input.arguments, "publicationExpectedLocale", false),
      expectedFingerprint: stringArgument(input.arguments, "publicationExpectedFingerprint", false),
      expectedRepresentativeImages: [],
      expectedDetailImages: [],
      requestedLanguage: "ko",
    });
    const detailStep = step("goods-off-shelf-detail-readback", detailRemote);
    detailStep.ok = detailStep.ok && Boolean(publication.remoteState);
    detailStep.data = {
      ...detailStep.data,
      sellerpilotPublicationChecks: publication.checks,
      sellerpilotRemoteVisibility: publication.visibility,
      sellerpilotProviderStatus: publication.providerStatus,
      sellerpilotVerification: publication.remoteState
        ? "TEMU_OFF_SHELF_REVERIFIED"
        : "TEMU_OFF_SHELF_UNVERIFIED",
    };
    steps.push(detailStep);
    return result(input, steps, goodsId, undefined, publication.remoteState);
  }
  if (input.operation === "inventory.update") {
    const goodsId = stringArgument(input.arguments, "goodsId", false);
    const exactGoodsId = temuExactLongGoodsId(goodsId);
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const steps: ChannelOperationStep[] = [];
    if (!exactGoodsId) {
      return result(input, [{
        name: "inventory-exact-long-prewrite",
        ok: false,
        status: 422,
        data: {
          sellerpilotNoWriteConfirmed: true,
          sellerpilotVerification: "TEMU_INVENTORY_GOODS_ID_NOT_EXACT_LONG",
        },
      }]);
    }
    const detail = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(exactGoodsId), versionQueryType: 1 },
    });
    const detailStep = step("inventory-item-readback", detail);
    steps.push(detailStep);
    if (!detailStep.ok) return result(input, steps, goodsId);
    const detailData = temuResultObject(detail.data);
    const skus = Array.isArray(detailData.skuList)
      ? detailData.skuList.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
    const exactSkuIds = skus.map((sku) => temuExactLongGoodsId(sku.skuId ?? sku.goodsSkuId));
    if (exactSkuIds.length === 0
        || exactSkuIds.some((skuId) => !skuId)
        || new Set(exactSkuIds).size !== exactSkuIds.length) {
      steps.push({
        name: "inventory-sku-exact-long-prewrite",
        ok: false,
        status: 422,
        data: {
          sellerpilotNoWriteConfirmed: true,
          sellerpilotVerification: "TEMU_INVENTORY_SKU_ID_NOT_EXACT_LONG",
        },
      });
      return result(input, steps, goodsId);
    }
    const body = {
      goodsId: temuExactLong(exactGoodsId),
      skuStockList: exactSkuIds.map((skuId) => ({
        skuId: temuExactLong(skuId!),
        stockQuantity: quantity,
      })),
    };
    const remote = await temuRequest({ payload: input.payload, type: "bg.local.goods.stock.edit", arguments: body });
    const responseGoodsId = temuResultObject(remote.data).goodsId;
    const writeStep = step("goods-stock", remote);
    steps.push(writeStep);
    if (!writeStep.ok || !goodsId) return result(input, steps, responseGoodsId === undefined ? goodsId || undefined : String(responseGoodsId));
    const verificationRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(exactGoodsId), versionQueryType: 1 },
    });
    const verificationData = temuResultObject(verificationRemote.data);
    const verificationSkus = Array.isArray(verificationData.skuList)
      ? verificationData.skuList.filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : [];
    const verificationSkuIds = verificationSkus.map((sku) => temuExactLongGoodsId(sku.skuId ?? sku.goodsSkuId));
    const quantities = verificationSkus.map((sku) => Number(sku.stockQuantity ?? sku.quantity));
    const exactSkuOrderVerified = verificationSkuIds.length === exactSkuIds.length
      && verificationSkuIds.every((skuId, index) => skuId === exactSkuIds[index]);
    const verifiedQuantity = exactSkuOrderVerified
      && quantities.length === exactSkuIds.length
      && quantities.every((value) => value === quantity)
      ? quantity
      : Number.NaN;
    steps.push(inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verifiedQuantity));
    return result(input, steps, responseGoodsId === undefined ? goodsId : String(responseGoodsId));
  }
  if (input.operation === "orders.list") {
    const pageSize = Math.max(1, Math.min(100, Number(input.arguments.pageSize) || 100));
    let pageNumber = Math.max(1, Number(input.arguments.pageNumber) || 1);
    const providerArguments = Object.fromEntries(
      Object.entries(input.arguments).filter(([key]) => key !== "sellerpilotPaginationDepth"),
    );
    const steps: ChannelOperationStep[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const remote = await temuRequest({
        payload: input.payload,
        type: "bg.order.list.v2.get",
        arguments: { ...providerArguments, pageNumber, pageSize },
      });
      const pageStep = step(pageIndex === 0 ? "orders" : `orders:${pageNumber}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok || temuResultRecords(remote.data, "pageItems").length < pageSize) break;
      const nextPageNumber = pageNumber + 1;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, { ...input.arguments, pageNumber: nextPageNumber, pageSize });
      }
      pageNumber = nextPageNumber;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const parentOrderSn = stringArgument(input.arguments, "parentOrderSn", false)
      || stringArgument(input.arguments, "orderId");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.order.list.v2.get",
      arguments: { pageNumber: 1, pageSize: 10, parentOrderSnList: [parentOrderSn] },
    });
    return result(input, [step("order", remote)], parentOrderSn);
  }
  if (input.operation === "inquiries.list") {
    const pageSize = Math.max(1, Math.min(200, Number(input.arguments.pageSize) || 200));
    let pageNo = Math.max(1, Number(input.arguments.pageNo) || 1);
    const providerArguments = Object.fromEntries(
      Object.entries(input.arguments).filter(([key]) => key !== "sellerpilotPaginationDepth"),
    );
    const steps: ChannelOperationStep[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const remote = await temuRequest({
        payload: input.payload,
        type: "bg.aftersales.parentaftersales.list.get",
        arguments: { ...providerArguments, pageNo, pageSize },
      });
      const pageStep = step(pageIndex === 0 ? "inquiries" : `inquiries:${pageNo}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok || temuResultRecords(remote.data, "data").length < pageSize) break;
      const nextPageNo = pageNo + 1;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, { ...input.arguments, pageNo: nextPageNo, pageSize });
      }
      pageNo = nextPageNo;
    }
    return result(input, steps);
  }
  if (input.operation === "shipment.confirm") {
    const parentOrderSn = stringArgument(input.arguments, "parentOrderSn");
    const carrierCode = stringArgument(input.arguments, "carrierCode");
    const trackingNumber = stringArgument(input.arguments, "trackingNumber");
    const providerContext = objectValue(input.arguments, "providerContext");
    const contextParentOrderSn = stringArgument(providerContext, "parentOrderSn");
    if (contextParentOrderSn !== parentOrderSn) throw new Error("CHANNEL_ARGUMENT_INVALID:providerContext.parentOrderSn");
    const orderItems = Array.isArray(providerContext.orderItems)
      ? providerContext.orderItems.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, 100)
      : [];
    const sendItems = orderItems.map((item) => ({
      parentOrderSn,
      orderSn: stringArgument(item, "orderSn"),
      ...(stringArgument(item, "goodsId", false) ? { goodsId: stringArgument(item, "goodsId", false) } : {}),
      ...(stringArgument(item, "skuId", false) ? { skuId: stringArgument(item, "skuId", false) } : {}),
      quantity: integerArgument(item, "quantity", { min: 1, max: 999_999 }),
    }));
    if (!sendItems.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.orderItems");

    const preflightRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.get",
      arguments: { parentOrderSn, orderSn: sendItems[0].orderSn },
    });
    const existingShipment = temuResultRecords(preflightRemote.data, "shipmentInfoDTO")
      .some((item) => String(item.trackingNumber ?? "").trim() === trackingNumber);
    if (existingShipment) {
      const existingStep = step("shipment-existing-readback", preflightRemote);
      existingStep.ok = existingStep.ok && existingShipment;
      existingStep.data = { ...existingStep.data, sellerpilotVerification: "EXISTING_SHIPMENT_VERIFIED" };
      return result(input, [existingStep], parentOrderSn);
    }

    const warehouseRemote = await temuRequest({ payload: input.payload, type: "bg.logistics.warehouse.list.get", arguments: {} });
    const warehouseStep = step("shipping-warehouses", warehouseRemote);
    const warehouses = temuResultRecords(warehouseRemote.data, "warehouseList");
    const preferredWarehouseId = stringArgument(providerContext, "inventoryDeductionWarehouseId", false);
    const warehouse = warehouses.find((item) => preferredWarehouseId && String(item.warehouseId ?? "") === preferredWarehouseId)
      ?? warehouses.find((item) => item.defaultWarehouse === true || Number(item.defaultWarehouse) === 1)
      ?? warehouses[0];
    const warehouseId = String(warehouse?.warehouseId ?? "").trim();
    warehouseStep.ok = warehouseStep.ok && Boolean(warehouseId);
    warehouseStep.data = {
      ...warehouseStep.data,
      sellerpilotVerification: warehouseId ? "SHIPPING_WAREHOUSE_SELECTED" : "TEMU_SHIPPING_WAREHOUSE_MISSING",
    };
    if (!warehouseStep.ok) return result(input, [warehouseStep], parentOrderSn);

    const regionIdText = stringArgument(providerContext, "regionId", false)
      || String(warehouse?.regionId1 ?? warehouse?.regionId ?? "").trim();
    if (!regionIdText) throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.regionId");
    const regionId = /^\d+$/.test(regionIdText) ? Number(regionIdText) : regionIdText;
    const carriersRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.companies.get",
      arguments: { regionId },
    });
    const carriersStep = step("shipping-carriers", carriersRemote);
    const requestedAliases = temuCarrierAliases(carrierCode);
    const carrier = temuResultRecords(carriersRemote.data, "logisticsServiceProviderList", "companyList")
      .find((item) => {
        if (String(item.logisticsServiceProviderId ?? "") === carrierCode) return true;
        const remoteNames = [item.logisticsServiceProviderName, item.logisticsBrandName]
          .map(normalizedTemuCarrier)
          .filter(Boolean);
        return requestedAliases.some((alias) => remoteNames.some((name) => name === alias || name.includes(alias) || alias.includes(name)));
      });
    const carrierIdText = String(carrier?.logisticsServiceProviderId ?? "").trim();
    carriersStep.ok = carriersStep.ok && Boolean(carrierIdText);
    carriersStep.data = {
      ...carriersStep.data,
      sellerpilotVerification: carrierIdText ? "SHIPPING_CARRIER_MATCHED" : "TEMU_SHIPPING_CARRIER_UNMATCHED",
    };
    if (!carriersStep.ok) return result(input, [warehouseStep, carriersStep], parentOrderSn);
    const carrierId = /^\d+$/.test(carrierIdText) ? Number(carrierIdText) : carrierIdText;

    const confirmRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.confirm",
      arguments: {
        sendType: 0,
        sendRequestList: [{
          carrierId,
          trackingNumber,
          selfShippingWarehouseId: /^\d+$/.test(warehouseId) ? Number(warehouseId) : warehouseId,
          orderSendInfoList: sendItems,
        }],
      },
    });
    const confirmStep = step("shipment-confirm", confirmRemote);
    if (!confirmStep.ok) return result(input, [warehouseStep, carriersStep, confirmStep], parentOrderSn);
    const readbackRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.get",
      arguments: { parentOrderSn, orderSn: sendItems[0].orderSn },
    });
    const verified = temuResultRecords(readbackRemote.data, "shipmentInfoDTO")
      .some((item) => String(item.trackingNumber ?? "").trim() === trackingNumber);
    const readbackStep = step("shipment-readback", readbackRemote);
    readbackStep.ok = readbackStep.ok && verified;
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotVerification: verified ? "TRACKING_NUMBER_VERIFIED" : "TEMU_TRACKING_READBACK_MISMATCH",
    };
    return result(input, [warehouseStep, carriersStep, confirmStep, readbackStep], parentOrderSn);
  }
  if (input.operation === "shipment.acknowledge") {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}

async function ebayListingResultWithPublicationReadback(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId: string,
  offerId: string,
) {
  if (!listingPublicationReadbackRequested(input) || steps.some((item) => !item.ok)) {
    return result(input, steps, remoteId);
  }
  const expected = listingPublicationReadbackExpectation(input.arguments);
  if (!expected) {
    return result(input, [
      ...steps,
      publicationStateVerificationStep(input.channel, undefined, "EBAY_PUBLICATION_EXPECTATION_MISSING"),
    ], remoteId);
  }
  const readback = await readEbayListingPublicationState({
    operation: input.operation as "listing.create" | "listing.update" | "listing.stop",
    intent: listingPublicationIntentFromArguments(input.arguments),
    remoteId,
    offerId,
    expectedSku: typeof input.arguments.sku === "string" ? input.arguments.sku : undefined,
    expectedMarketplaceId: typeof input.arguments.marketplaceId === "string"
      ? input.arguments.marketplaceId
      : undefined,
    expectedListingId: typeof input.arguments.listingId === "string"
      ? input.arguments.listingId
      : undefined,
    expected,
    readOffer: (readbackOfferId) => ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/offer/${pathSegment(readbackOfferId)}`,
    }),
    readInventoryItem: (sku) => ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${pathSegment(sku)}`,
    }),
  });
  const readbackSteps: ChannelOperationStep[] = [step("offer-publication-readback", readback.offerReadback)];
  if (readback.inventoryItemReadback) {
    readbackSteps.push(step("inventory-item-publication-readback", readback.inventoryItemReadback));
  }
  if (input.operation === "listing.update" && readback.inventoryItemReadback) {
    const mutableReadback = verifyListingUpdateReadback("ebay", input.arguments, {
      offer: readback.offerReadback.data,
      inventoryItem: readback.inventoryItemReadback.data,
    });
    const httpVerified = readback.offerReadback.response.ok
      && readback.inventoryItemReadback.response.ok;
    readbackSteps.push({
      name: "listing-update-content-readback",
      ok: httpVerified && mutableReadback.ok,
      status: readback.offerReadback.response.ok
        ? readback.inventoryItemReadback.response.status
        : readback.offerReadback.response.status,
      data: {
        sellerpilotVerification: httpVerified && mutableReadback.ok
          ? "LISTING_MUTABLE_FIELDS_VERIFIED"
          : "LISTING_MUTABLE_FIELDS_MISMATCH",
        sellerpilotMismatchPaths: mutableReadback.mismatches.slice(0, 40),
      },
    });
  }
  readbackSteps.push(publicationStateVerificationStep(input.channel, readback.state, readback.failureCode));
  return result(
    input,
    [...steps, ...readbackSteps],
    readback.resolvedRemoteId,
    undefined,
    readback.state,
  );
}

function ebayProviderDescriptionWithoutImages(value: unknown) {
  return String(value ?? "")
    .replace(/<img\b[^>]*>/giu, "")
    .trim();
}

function ebayCompactInventoryDescription(...providerValues: unknown[]) {
  for (const providerValue of providerValues) {
    const compact = ebayProviderDescriptionWithoutImages(providerValue)
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]*>/gu, " ")
      .replace(/&nbsp;|&#160;/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&quot;|&#34;/giu, '"')
      .replace(/&#39;|&apos;/giu, "'")
      .replace(/\s+/gu, " ")
      .trim();
    if (!compact) continue;
    if (compact.length <= 1_000) return compact;
    const bounded = compact.slice(0, 1_000);
    const lastSpace = bounded.lastIndexOf(" ");
    return (lastSpace >= 800 ? bounded.slice(0, lastSpace) : bounded).trim();
  }
  throw new Error("EBAY_EXACT_EXISTING_QA_PROVIDER_DESCRIPTION_REQUIRED");
}

function ebayExactProviderCopyArguments(input: {
  sourceArguments: Record<string, unknown>;
  currentOffer: Record<string, unknown>;
  currentInventoryItem: Record<string, unknown>;
  requestedOffer: Record<string, unknown>;
  requestedInventoryItem: Record<string, unknown>;
}) {
  const publicationBinding = parseListingPublicationAssetBinding(
    input.sourceArguments.sellerpilotPublicationAssetBinding,
  );
  if (!publicationBinding
      || publicationBinding.providerImageSurface !== "gallery"
      || publicationBinding.providerTransportImages.length !== 9
      || publicationBinding.providerTransportImages[0]?.role !== "gallery-representative") {
    throw new Error("EBAY_EXACT_EXISTING_QA_APPROVED_DETAIL_BINDING_REQUIRED");
  }
  const detailUrls = publicationBinding.providerTransportImages
    .slice(1)
    .map((image) => image.publicUrl);
  const detailRoles = publicationBinding.providerTransportImages
    .slice(1)
    .map((image) => image.role);
  const detailAltTexts = detailRoles.map((_, index) =>
    `Cable organizer product detail image ${index + 1}`);
  const currentProduct = objectValue(input.currentInventoryItem, "product");
  const requestedProduct = objectValue(input.requestedInventoryItem, "product");
  const requestedImageUrls = Array.isArray(requestedProduct.imageUrls)
    ? requestedProduct.imageUrls
    : [];
  const representativeImageUrl = String(requestedImageUrls[0] ?? "").trim();
  const inventoryImageUrls = [representativeImageUrl, ...detailUrls];
  if (!representativeImageUrl
      || inventoryImageUrls.length !== 9
      || new Set(inventoryImageUrls).size !== 9
      || requestedImageUrls.length !== inventoryImageUrls.length
      || !requestedImageUrls.every(
        (value, index) => String(value).trim() === inventoryImageUrls[index],
      )) {
    throw new Error("EBAY_EXACT_V101_NINE_IMAGES_REQUIRED");
  }
  const aspects = ebayExactV101EnglishAspects(currentProduct.aspects);
  // The Inventory API limits product.description to 1-4000 characters. Detail
  // image HTML belongs to the offer surface. Keep a conservative 1000-character
  // inventory copy derived only from immutable provider GET values.
  const description = ebayCompactInventoryDescription(
    currentProduct.description,
    input.currentOffer.listingDescription,
    currentProduct.title,
  );
  const listingDescription = upsertMarketplaceDetailImages(
    ebayProviderDescriptionWithoutImages(input.currentOffer.listingDescription),
    detailUrls,
    detailAltTexts,
    detailRoles,
  );
  const inventoryBody = mergeListingUpdatePatch(input.currentInventoryItem, {
    condition: input.requestedInventoryItem.condition,
    availability: input.requestedInventoryItem.availability,
    product: {
      imageUrls: inventoryImageUrls,
      description,
      aspects,
    },
  }) as Record<string, unknown>;
  const offerBody = mergeListingUpdatePatch(input.currentOffer, {
    availableQuantity: input.requestedOffer.availableQuantity,
    pricingSummary: input.requestedOffer.pricingSummary,
    listingDescription,
  }) as Record<string, unknown>;
  const readbackArguments = {
    ...input.sourceArguments,
    // Both eBay endpoints use full-replacement semantics. Carry every
    // allowlisted provider GET field into the final subset readback so a 204
    // response cannot hide a dropped policy, location, schedule, package, or
    // inventory field.
    inventoryItem: structuredClone(inventoryBody),
    offer: structuredClone(offerBody),
  };
  assertEbayExactExistingQaUpdateArguments(readbackArguments, {
    expectedDetailImageUrls: detailUrls,
    inventoryDescriptionMode: "compact_text",
  });
  return { inventoryBody, offerBody, readbackArguments };
}

async function executeEbayShipment(input: ExecuteInput) {
  const orderId = stringArgument(input.arguments, "orderId");
  const body = ebayShipmentBody(objectValue(input.arguments, "body"));
  const orderPath = `/sell/fulfillment/v1/order/${pathSegment(orderId)}`;
  const shipmentPath = `${orderPath}/shipping_fulfillment`;
  const steps: ChannelOperationStep[] = [];
  const failureStep = (name: string, code: string, status: number, reconciliationRequired = false): ChannelOperationStep => ({
    name,
    ok: false,
    status,
    data: { code, ...(reconciliationRequired ? { sellerpilotReconciliationRequired: true } : {}) },
  });
  const read = (path: string) => ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path });
  const noProviderErrors = (remote: RemoteResponse) => !Object.hasOwn(remote.data, "errors")
    || (Array.isArray(remote.data.errors) && remote.data.errors.length === 0);

  let orderRemote: RemoteResponse;
  try {
    orderRemote = await read(orderPath);
  } catch {
    return result(input, [failureStep("shipment-order-preflight", "EBAY_SHIPMENT_ORDER_UNAVAILABLE", 503)], orderId);
  }
  const orderStep = step("shipment-order-preflight", orderRemote);
  orderStep.ok = orderStep.ok && noProviderErrors(orderRemote) && ebayOrderMatchesShipment(orderRemote.data, orderId, body);
  // The fulfillment gateway only needs verified identifiers, never customer
  // addresses or buyer details from this order response.
  orderStep.data = { code: orderStep.ok ? "EBAY_SHIPMENT_ORDER_VERIFIED" : "EBAY_SHIPMENT_ORDER_MISMATCH" };
  steps.push(orderStep);
  if (!orderStep.ok) return result(input, steps, orderId);
  if (!ebayOrderPaymentAllowsShipment(orderRemote.data)) {
    return result(input, [...steps, failureStep("shipment-order-status", "EBAY_SHIPMENT_ORDER_NOT_READY", 409)], orderId);
  }

  let existingRemote: RemoteResponse;
  try {
    existingRemote = await read(shipmentPath);
  } catch {
    return result(input, [...steps, failureStep("shipment-existing-readback", "EBAY_SHIPMENT_EXISTING_UNAVAILABLE", 503)], orderId);
  }
  const existing = ebayShipmentReadback(existingRemote.data, body);
  const existingStep = step("shipment-existing-readback", existingRemote);
  existingStep.ok = existingStep.ok && noProviderErrors(existingRemote) && existing.valid;
  existingStep.data = { code: existingStep.ok ? "EBAY_SHIPMENT_EXISTING_VERIFIED" : "EBAY_SHIPMENT_EXISTING_INVALID" };
  steps.push(existingStep);
  if (!existingStep.ok) return result(input, steps, orderId);
  if (!existing.empty) {
    existingStep.ok = existing.verified;
    existingStep.data = existing.verified
      ? { code: "EBAY_SHIPMENT_ALREADY_VERIFIED", fulfillmentId: existing.fulfillmentId }
      : { code: "EBAY_SHIPMENT_EXISTING_CONFLICT", sellerpilotReconciliationRequired: true };
    return result(input, steps, orderId);
  }
  if (!ebayOrderReadyForShipment(orderRemote.data)) {
    return result(input, [...steps, failureStep("shipment-order-status", "EBAY_SHIPMENT_ORDER_NOT_READY", 409)], orderId);
  }

  // At most four 15-second calls fit inside the fulfillment route's 70-second
  // operation window. Never retry POST. A lost response keeps a mutation step
  // so gateway completion requires reconciliation if the one GET cannot prove it.
  let writeStep: ChannelOperationStep;
  try {
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: shipmentPath,
      body,
    });
    writeStep = step("shipping-fulfillment", remote);
    writeStep.ok = writeStep.ok && remote.response.status === 201 && noProviderErrors(remote);
    if (!writeStep.ok && remote.response.status !== 408 && remote.response.status < 500 && !remote.response.ok) {
      return result(input, [...steps, writeStep], orderId);
    }
    if (!writeStep.ok) writeStep.data = { ...writeStep.data, sellerpilotReconciliationRequired: true };
  } catch {
    writeStep = failureStep("shipping-fulfillment", "EBAY_SHIPMENT_WRITE_UNCERTAIN", 503, true);
  }
  steps.push(writeStep);

  let readbackRemote: RemoteResponse;
  try {
    readbackRemote = await read(shipmentPath);
  } catch {
    return result(input, [...steps, failureStep("shipment-readback", "EBAY_SHIPMENT_READBACK_UNAVAILABLE", 503, true)], orderId);
  }
  const readback = ebayShipmentReadback(readbackRemote.data, body);
  const readbackStep = step("shipment-readback", readbackRemote);
  readbackStep.ok = readbackStep.ok && noProviderErrors(readbackRemote) && readback.verified;
  readbackStep.data = readbackStep.ok
    ? { code: "EBAY_SHIPMENT_READBACK_VERIFIED", fulfillmentId: readback.fulfillmentId }
    : { code: "EBAY_SHIPMENT_READBACK_MISMATCH", sellerpilotReconciliationRequired: true };
  if (readbackStep.ok && !writeStep.ok) {
    // Exact remote recovery also resolves a lost POST response; it does not
    // issue another mutation or infer success merely from HTTP acceptance.
    writeStep.ok = true;
    writeStep.data = { code: "EBAY_SHIPMENT_WRITE_RECOVERED", sellerpilotMutation: "accepted" };
  }
  return result(input, [...steps, readbackStep], orderId);
}

async function executeEbay(input: ExecuteInput) {
  if (input.operation === "categories.list") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}` });
    return result(input, [step("taxonomy", remote)], categoryTreeId);
  }
  if (input.operation === "categories.suggest") {
    let categoryTreeId = stringArgument(input.arguments, "categoryTreeId", false);
    const marketplaceId = stringArgument(input.arguments, "marketplaceId", false) || textValue(input.payload, "marketplace_id") || "EBAY_US";
    const steps: ChannelOperationStep[] = [];
    if (!categoryTreeId) {
      const tree = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/commerce/taxonomy/v1/get_default_category_tree_id", query: new URLSearchParams({ marketplace_id: marketplaceId }) });
      steps.push(step("default-category-tree", tree));
      if (!tree.response.ok) return result(input, steps);
      categoryTreeId = String(tree.data.categoryTreeId ?? "");
    }
    if (!categoryTreeId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:categoryTreeId");
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${pathSegment(categoryTreeId)}/get_category_suggestions`, query: new URLSearchParams({ q: stringArgument(input.arguments, "query") }) });
    steps.push(step("category-suggestions", remote));
    return result(input, steps, categoryTreeId);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category`, query: new URLSearchParams({ category_id: categoryId }) });
    return result(input, [step("category-aspects", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    assertEbayListingCreateConfiguration(input.arguments);
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const inventoryItem = objectValue(input.arguments, "inventoryItem");
    const offer = structuredClone(objectValue(input.arguments, "offer"));
    const marketplaceId = String(offer.marketplaceId ?? "").trim();
    if (!marketplaceId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:offer.marketplaceId");
    const shouldPublish = listingPublicationReadbackRequested(input)
      ? listingPublicationIntentFromArguments(input.arguments) === "live"
      : booleanArgument(input.arguments, "publish");
    // eBay rejects an offer when its SKU differs from the Inventory Item URL
    // even if both values are otherwise valid. Enforce this invariant at the
    // channel boundary as a final guard for manually edited or legacy drafts.
    offer.sku = sku;
    const steps: ChannelOperationStep[] = [];
    const inventoryProduct = inventoryItem.product && typeof inventoryItem.product === "object" && !Array.isArray(inventoryItem.product)
      ? inventoryItem.product as Record<string, unknown>
      : {};
    const expectedImageUrls = Array.isArray(inventoryProduct.imageUrls)
      ? [...new Set(inventoryProduct.imageUrls.map(String).map((value) => value.trim()).filter(Boolean))]
      : [];
    if (!expectedImageUrls.length) throw new Error("EBAY_IMAGE_REQUIRED");
    const expectedDescriptionImages = (String(offer.listingDescription ?? "").match(/<img\b/gi) ?? []).length;
    const verifiedReadbackStep = (
      name: string,
      remote: RemoteResponse,
      expectedImageCount: number,
      actualImageCount: number,
    ): ChannelOperationStep => {
      const remoteStep = step(name, remote);
      const verified = remoteStep.ok && actualImageCount >= expectedImageCount;
      return {
        ...remoteStep,
        ok: verified,
        data: {
          ...remoteStep.data,
          expectedImageCount,
          actualImageCount,
          sellerpilotVerification: verified ? "IMAGES_VERIFIED" : "EBAY_IMAGE_READBACK_MISSING",
        },
      };
    };
    const itemRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/inventory_item/${sku}`, body: inventoryItem });
    steps.push(step("inventory-item", itemRemote));
    if (!itemRemote.response.ok) return result(input, steps, sku);
    const itemReadback = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/inventory/v1/inventory_item/${sku}` });
    const readbackProduct = itemReadback.data.product && typeof itemReadback.data.product === "object" && !Array.isArray(itemReadback.data.product)
      ? itemReadback.data.product as Record<string, unknown>
      : {};
    const actualImageCount = Array.isArray(readbackProduct.imageUrls)
      ? new Set(readbackProduct.imageUrls.map(String).map((value) => value.trim()).filter(Boolean)).size
      : 0;
    const inventoryImageStep = verifiedReadbackStep("inventory-image-readback", itemReadback, expectedImageUrls.length, actualImageCount);
    steps.push(inventoryImageStep);
    if (!inventoryImageStep.ok) return result(input, steps, sku);
    const offerRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: "/sell/inventory/v1/offer", body: offer });
    let offerId = offerRemote.data.offerId === undefined ? undefined : String(offerRemote.data.offerId);
    const offerStep = step("offer", offerRemote);
    if (offerStep.ok) steps.push(offerStep);
    if (offerStep.ok && offerId) {
      // The accepted provider step was recorded above together with its durable
      // offer identity.
    } else {
      // A timed-out create call may still have persisted the offer remotely. eBay
      // also rejects a second offer for the same SKU, so reconcile by SKU before
      // deciding that the retry failed.
      const reconcileRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/sell/inventory/v1/offer",
        query: new URLSearchParams({ sku: decodeURIComponent(sku), limit: "25" }),
      });
      const offers = Array.isArray(reconcileRemote.data.offers)
        ? reconcileRemote.data.offers as Array<Record<string, unknown>>
        : [];
      const existing = offers.find((candidate) =>
        String(candidate.marketplaceId ?? "") === marketplaceId
        && String(candidate.format ?? "") === String(offer.format ?? "FIXED_PRICE"),
      ) ?? offers.find((candidate) => String(candidate.marketplaceId ?? "") === marketplaceId) ?? offers[0];
      offerId = existing?.offerId === undefined ? undefined : String(existing.offerId);
      const reconcileStep = step("offer-reconcile", reconcileRemote);
      reconcileStep.ok = reconcileStep.ok && Boolean(offerId);
      reconcileStep.data = {
        ...reconcileStep.data,
        recoveredOfferId: offerId,
        createStatus: offerRemote.response.status,
        sellerpilotVerification: offerId ? "EXISTING_OFFER_RECOVERED" : "EBAY_OFFER_RECONCILE_MISSING",
      };
      steps.push(reconcileStep);
      if (!reconcileStep.ok || !offerId) {
        // A locally known SKU is not an eBay offer/listing identity. In the
        // accepted-without-offerId case, leave remoteId empty so completion
        // records an unresolved external action rather than a false identity.
        return result(input, steps, offerStep.ok ? undefined : sku);
      }
      const updateRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "PUT",
        path: `/sell/inventory/v1/offer/${pathSegment(offerId)}`,
        body: offer,
      });
      const updateStep = step("offer-update-after-reconcile", updateRemote);
      steps.push(updateStep);
      if (!updateStep.ok) return result(input, steps, offerId);
    }
    let publishedListingId = "";
    if (offerId) {
      const offerReadback = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/inventory/v1/offer/${pathSegment(offerId)}` });
      const actualDescriptionImages = (String(offerReadback.data.listingDescription ?? "").match(/<img\b/gi) ?? []).length;
      const offerReadbackStep = expectedDescriptionImages > 0
        ? verifiedReadbackStep("offer-detail-image-readback", offerReadback, expectedDescriptionImages, actualDescriptionImages)
        : step("offer-readback", offerReadback);
      steps.push(offerReadbackStep);
      if (!offerReadbackStep.ok) return result(input, steps, offerId);
      const listing = offerReadback.data.listing && typeof offerReadback.data.listing === "object" && !Array.isArray(offerReadback.data.listing)
        ? offerReadback.data.listing as Record<string, unknown>
        : {};
      if (String(offerReadback.data.status ?? "").toUpperCase() === "PUBLISHED") {
        publishedListingId = String(listing.listingId ?? "").trim();
      }
    }
    if (offerId && shouldPublish && !publishedListingId) {
      const publishRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/inventory/v1/offer/${pathSegment(offerId)}/publish` });
      const publishStep = step("publish", publishRemote);
      steps.push(publishStep);
      const listingId = publishRemote.data.listingId === undefined ? undefined : String(publishRemote.data.listingId);
      if (!publishStep.ok) return result(input, steps, listingId ?? offerId);
      return ebayListingResultWithPublicationReadback(input, steps, listingId ?? offerId, offerId);
    }
    const finalRemoteId = publishedListingId || offerId || sku;
    return offerId
      ? ebayListingResultWithPublicationReadback(input, steps, finalRemoteId, offerId)
      : result(input, steps, finalRemoteId);
  }
  if (input.operation === "listing.update") {
    const exactRecovery = ebayExactExistingQaRecoveryBinding(input.arguments);
    if (exactRecovery) assertEbayExactExistingQaProviderCopyRequest(input.arguments);
    const listingId = stringArgument(input.arguments, "listingId");
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const decodedSku = decodeURIComponent(sku);
    const marketplaceId = ebayAsqMarketplaceId(input.arguments.marketplaceId);
    const requestedOffer = input.arguments.offer === undefined
      ? {}
      : objectValue(input.arguments, "offer");
    const requestedInventoryItem = input.arguments.inventoryItem === undefined
      ? {}
      : objectValue(input.arguments, "inventoryItem");
    if (!Object.keys(requestedOffer).length && !Object.keys(requestedInventoryItem).length) {
      throw new Error("EBAY_LISTING_UPDATE_CONTENT_REQUIRED");
    }

    const steps: ChannelOperationStep[] = [];
    let decodedOfferId = exactRecovery ? "" : stringArgument(input.arguments, "offerId");
    if (exactRecovery) {
      const discoveryRead = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/sell/inventory/v1/offer",
        query: new URLSearchParams({
          sku: decodedSku,
          marketplace_id: marketplaceId,
          limit: "25",
        }),
      });
      const offers = Array.isArray(discoveryRead.data.offers)
        ? discoveryRead.data.offers.filter((value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value))
        : [];
      const publicIdentityOffers = offers.filter((candidate) => {
        const candidateListing = candidate.listing
          && typeof candidate.listing === "object"
          && !Array.isArray(candidate.listing)
          ? candidate.listing as Record<string, unknown>
          : {};
        return String(candidate.sku ?? "").trim() === decodedSku
          && String(candidate.marketplaceId ?? "").trim().toUpperCase() === marketplaceId
          && String(candidate.status ?? "").trim().toUpperCase() === "PUBLISHED"
          && String(candidateListing.listingId ?? "").trim() === listingId
          && String(candidateListing.listingStatus ?? "").trim().toUpperCase() === "ACTIVE"
          && Boolean(String(candidate.offerId ?? "").trim());
      });
      const exactOffers = publicIdentityOffers.filter((candidate) =>
        String(candidate.offerId ?? "").trim() === exactRecovery.offerId);
      const discoveryStep = step("offer-update-discovery-readback", discoveryRead);
      discoveryStep.ok = discoveryStep.ok
        && publicIdentityOffers.length === 1
        && exactOffers.length === 1;
      discoveryStep.data = {
        ...discoveryStep.data,
        sellerpilotVerification: discoveryStep.ok
          ? "EBAY_EXACT_OFFER_DISCOVERED"
          : "EBAY_EXACT_OFFER_DISCOVERY_MISMATCH",
        exactOfferCount: exactOffers.length,
        publicIdentityOfferCount: publicIdentityOffers.length,
      };
      steps.push(discoveryStep);
      if (!discoveryStep.ok) return result(input, steps, listingId);
      decodedOfferId = exactRecovery.offerId;
    }
    const offerId = pathSegment(decodedOfferId);

    const offerRead = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/offer/${offerId}`,
    });
    const inventoryRead = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${sku}`,
    });
    const listing = offerRead.data.listing && typeof offerRead.data.listing === "object" && !Array.isArray(offerRead.data.listing)
      ? offerRead.data.listing as Record<string, unknown>
      : {};
    const identityVerified = offerRead.response.ok
      && inventoryRead.response.ok
      && String(offerRead.data.offerId ?? "").trim() === decodedOfferId
      && String(offerRead.data.sku ?? "").trim() === decodedSku
      && String(offerRead.data.marketplaceId ?? "").trim().toUpperCase() === marketplaceId
      && String(offerRead.data.status ?? "").trim().toUpperCase() === "PUBLISHED"
      && String(listing.listingId ?? "").trim() === listingId
      && String(listing.listingStatus ?? "").trim().toUpperCase() === "ACTIVE";
    const offerPreflight = step("offer-update-preflight-readback", offerRead);
    offerPreflight.ok = offerPreflight.ok && identityVerified;
    offerPreflight.data = {
      ...offerPreflight.data,
      sellerpilotVerification: identityVerified
        ? "EBAY_IMMUTABLE_LISTING_IDENTITY_VERIFIED"
        : "EBAY_IMMUTABLE_LISTING_IDENTITY_MISMATCH",
    };
    const inventoryPreflight = step("inventory-item-update-preflight-readback", inventoryRead);
    inventoryPreflight.ok = inventoryPreflight.ok && identityVerified;
    steps.push(offerPreflight, inventoryPreflight);
    if (!identityVerified) return result(input, steps, listingId);

    const offerWritableFields = [
      "availableQuantity", "categoryId", "charity", "extendedProducerResponsibility",
      "format", "hideBuyerDetails", "includeCatalogProductDetails", "listingDescription",
      "listingDuration", "listingPolicies", "listingStartDate", "lotSize", "merchantLocationKey",
      "pricingSummary", "quantityLimitPerBuyer", "regulatory", "secondaryCategoryId",
      "sku", "storeCategoryNames", "tax",
    ] as const;
    const currentOffer = Object.fromEntries(offerWritableFields.flatMap((key) =>
      offerRead.data[key] === undefined ? [] : [[key, structuredClone(offerRead.data[key])]]));
    const inventoryWritableFields = [
      "availability", "condition", "conditionDescription", "packageWeightAndSize", "product",
    ] as const;
    const currentInventoryItem = Object.fromEntries(inventoryWritableFields.flatMap((key) =>
      inventoryRead.data[key] === undefined ? [] : [[key, structuredClone(inventoryRead.data[key])]]));
    const exactPrepared = exactRecovery
      ? ebayExactProviderCopyArguments({
          sourceArguments: input.arguments,
          currentOffer,
          currentInventoryItem,
          requestedOffer,
          requestedInventoryItem,
        })
      : null;
    const offerBody = exactPrepared?.offerBody
      ?? mergeListingUpdatePatch(currentOffer, requestedOffer) as Record<string, unknown>;
    offerBody.sku = decodedSku;
    offerBody.marketplaceId = marketplaceId;
    const inventoryBody = exactPrepared?.inventoryBody
      ?? mergeListingUpdatePatch(
        currentInventoryItem,
        requestedInventoryItem,
      ) as Record<string, unknown>;

    if (Object.keys(requestedOffer).length) {
      assertEbayListingCreateConfiguration({ offer: offerBody });
    }
    if (exactRecovery) {
      if (!input.providerMutationHooks) {
        throw new Error("EBAY_EXACT_EXISTING_QA_PROVIDER_MUTATION_HOOKS_REQUIRED");
      }
      await input.providerMutationHooks.assertLeaseHealthy();
      await input.providerMutationHooks.begin();
      await input.providerMutationHooks.assertLeaseHealthy();
    }

    if (Object.keys(requestedInventoryItem).length) {
      const inventoryRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "PUT",
        path: `/sell/inventory/v1/inventory_item/${sku}`,
        body: inventoryBody,
      });
      const inventoryStep = step("inventory-item-update", inventoryRemote);
      steps.push(inventoryStep);
      if (!inventoryStep.ok) return result(input, steps, listingId);
    }
    if (Object.keys(requestedOffer).length) {
      const offerRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "PUT",
        path: `/sell/inventory/v1/offer/${offerId}`,
        body: offerBody,
      });
      const offerStep = step("offer-update", offerRemote);
      steps.push(offerStep);
      if (!offerStep.ok) return result(input, steps, listingId);
    }
    return ebayListingResultWithPublicationReadback(
      exactPrepared ? { ...input, arguments: exactPrepared.readbackArguments } : input,
      steps,
      listingId,
      decodedOfferId,
    );
  }
  if (input.operation === "listing.stop") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/inventory/v1/offer/${offerId}/withdraw` });
    return ebayListingResultWithPublicationReadback(
      input,
      [step("offer-withdraw", remote)],
      decodeURIComponent(offerId),
      decodeURIComponent(offerId),
    );
  }
  if (input.operation === "price.update") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/offer/${offerId}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("offer-price", remote)], offerId);
  }
  if (input.operation === "inventory.update") {
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const decodedSku = decodeURIComponent(sku);
    const bulkBody = input.arguments.body ? objectValue(input.arguments, "body") : {
      requests: [{
        sku: decodedSku,
        shipToLocationAvailability: { quantity },
      }],
    };
    const writeRemote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/sell/inventory/v1/bulk_update_price_quantity",
      body: bulkBody,
    });
    const writeStep = step("bulk-inventory", writeRemote);
    if (!writeStep.ok) return result(input, [writeStep], decodedSku);
    const readback = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/inventory/v1/inventory_item/${sku}` });
    const availability = objectValue(readback.data, "availability", false);
    const shipToLocationAvailability = objectValue(availability, "shipToLocationAvailability", false);
    return result(input, [
      writeStep,
      inventoryQuantityVerificationStep("inventory-readback", readback, quantity, shipToLocationAvailability.quantity),
    ], decodedSku);
  }
  if (input.operation === "inquiries.list") {
    const marketplaceId = ebayAsqMarketplaceId(input.arguments.marketplaceId);
    const startCreationTime = ebayTradingTimestampArgument(input.arguments, "startCreationTime");
    const endCreationTime = ebayTradingTimestampArgument(input.arguments, "endCreationTime");
    const startTimestamp = Date.parse(startCreationTime);
    const endTimestamp = Date.parse(endCreationTime);
    if (startTimestamp >= endTimestamp || endTimestamp - startTimestamp > 31 * 86_400_000) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryTimeRange");
    }
    const requestedEntriesPerPage = integerArgument(input.arguments, "entriesPerPage", { min: 25, max: 200 });
    if (![25, 50, 100, 200].includes(requestedEntriesPerPage)) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:entriesPerPage");
    }
    // A 25-message page is the smallest provider-supported size. One provider
    // page per gateway job keeps the read inside the serverless budget; the
    // next page is continued atomically by the gateway completion transaction.
    const entriesPerPage = EBAY_ASQ_ENTRIES_PER_PAGE;
    const pageNumber = integerArgument(input.arguments, "pageNumber", { min: 1, max: 1_000_000 });
    const requestXml = `<?xml version="1.0" encoding="utf-8"?><GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><MailMessageType>AskSellerQuestion</MailMessageType><StartCreationTime>${ebayTradingXmlEscape(startCreationTime)}</StartCreationTime><EndCreationTime>${ebayTradingXmlEscape(endCreationTime)}</EndCreationTime><Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination></GetMemberMessagesRequest>`;
    const remote = await ebayTradingRequest({
      payload: input.payload,
      environment: input.environment,
      callName: "GetMemberMessages",
      marketplaceId,
      body: requestXml,
    });
    const providerInquiryStep = step("inquiries", remote);
    if (!providerInquiryStep.ok) return result(input, [providerInquiryStep]);

    const messages = objectArray(remote.data.memberMessages);
    const itemIds = messages.map((message) => String(message.itemId ?? "").trim());
    if (itemIds.some((itemId) => !/^[1-9]\d{0,18}$/.test(itemId))) {
      return result(input, [{
        name: "inquiry-listing-site-verification",
        ok: false,
        status: 422,
        data: { code: "EBAY_ASQ_ITEM_ID_UNVERIFIED" },
      }]);
    }

    const uniqueItemIds = [...new Set(itemIds)];
    const siteLookup = await resolveEbayListingSites(input, marketplaceId, uniqueItemIds);
    if ("failure" in siteLookup) return result(input, [siteLookup.failure]);
    const pageSites = new Map(siteLookup.resolutions.map((resolution) => [resolution.itemId, resolution.marketplaceId]));
    const exactMessages = messages.map((message, index) => {
      const exactMarketplaceId = pageSites.get(itemIds[index]);
      if (!exactMarketplaceId) throw new Error("EBAY_ASQ_LISTING_SITE_LOOKUP_INCOMPLETE");
      return { ...message, marketplaceId: exactMarketplaceId };
    });
    const exactPageRemote = {
      ...remote,
      data: { ...remote.data, memberMessages: exactMessages },
    } satisfies RemoteResponse;
    const steps: ChannelOperationStep[] = [
      step("inquiries", exactPageRemote),
      {
        name: "inquiry-listing-sites:1",
        ok: true,
        status: 200,
        data: {
          verifiedItemCount: uniqueItemIds.length,
          sellerpilotVerification: "EBAY_ASQ_LISTING_SITES_VERIFIED",
        },
      },
    ];
    const pagination = objectValue(remote.data, "paginationResult", false);
    const totalPages = finiteCount(pagination.totalNumberOfPages);
    const hasMore = remote.data.hasMoreItems === true || (totalPages !== null && pageNumber < totalPages);
    if (!hasMore || messages.length === 0) return result(input, steps);
    return paginationResult(input, steps, {
      ...input.arguments,
      pageNumber: pageNumber + 1,
      entriesPerPage,
    });
  }
  if (input.operation === "inquiries.reply") {
    const marketplaceId = ebayAsqMarketplaceId(input.arguments.marketplaceId);
    const itemId = ebayTradingTextArgument(input.arguments, "itemId", { maxLength: 19, pattern: /^[1-9]\d{0,18}$/ });
    const parentMessageId = ebayTradingTextArgument(input.arguments, "parentMessageId", { maxLength: 230 });
    const recipientId = ebayTradingTextArgument(input.arguments, "recipientId", { maxLength: 240 });
    const reply = ebayTradingTextArgument(input.arguments, "reply", { maxLength: 2_000 });
    const requestXml = `<?xml version="1.0" encoding="utf-8"?><AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(itemId)}</ItemID><MemberMessage><Body>${ebayTradingXmlEscape(reply)}</Body><DisplayToPublic>false</DisplayToPublic><ParentMessageID>${ebayTradingXmlEscape(parentMessageId)}</ParentMessageID><RecipientID>${ebayTradingXmlEscape(recipientId)}</RecipientID></MemberMessage></AddMemberMessageRTQRequest>`;
    const remote = await ebayTradingRequest({
      payload: input.payload,
      environment: input.environment,
      callName: "AddMemberMessageRTQ",
      marketplaceId,
      body: requestXml,
    });
    return result(input, [step("inquiry-reply", remote)], parentMessageId);
  }
  if (input.operation === "orders.list") {
    const baseQuery = queryParams(input.arguments);
    const limit = boundedPageSize(baseQuery.get("limit"), 50, 200);
    let offset = Math.max(0, finiteCount(baseQuery.get("offset")) ?? 0);
    const steps: ChannelOperationStep[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const query = new URLSearchParams(baseQuery);
      query.set("limit", String(limit));
      query.set("offset", String(offset));
      const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/fulfillment/v1/order", query });
      const orderStep = step(pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`, remote);
      steps.push(orderStep);
      if (!orderStep.ok) break;
      const pageOrders = objectArray(remote.data.orders);
      const total = finiteCount(remote.data.total);
      const nextUrl = typeof remote.data.next === "string" ? remote.data.next : "";
      if (pageOrders.length === 0 || pageOrders.length < limit || (total !== null && offset + pageOrders.length >= total)) break;
      let nextOffset = offset + pageOrders.length;
      if (nextUrl) {
        try {
          nextOffset = finiteCount(new URL(nextUrl).searchParams.get("offset")) ?? nextOffset;
        } catch {
          // Provider links are advisory; the documented numeric offset remains authoritative.
        }
      }
      if (nextOffset <= offset) break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: { ...stringMap(input.arguments, "query"), limit, offset: nextOffset },
        });
      }
      offset = nextOffset;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const orderId = pathSegment(stringArgument(input.arguments, "orderId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/fulfillment/v1/order/${orderId}` });
    return result(input, [step("order", remote)], orderId);
  }
  if (input.operation === "shipment.confirm") return executeEbayShipment(input);
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}

export async function executeChannelOperation(input: ExecuteInput): Promise<ChannelOperationResult> {
  ensureProviderSupport(input.channel, input.operation);
  if (input.channel === "qoo10"
      && Object.hasOwn(input.arguments, qoo10S1ActivationArgument)
      && input.operation !== "listing.activate") {
    return executeQoo10(input);
  }
  if (input.operation === "listing.publication.verify"
      && input.channel === "temu"
      && (temuCredentialCertificationBinding(input.arguments)
        || temuExistingAdoptionBinding(input.arguments)
        || temuContainmentDiscoveryBinding(input.arguments))) {
    return executeTemu(input);
  }
  if (input.operation === "listing.publication.verify") {
    const verification = await executeListingPublicationVerification({
      ...input,
      channel: input.channel,
      operation: input.operation,
      ...(input.shopeeShopCredential
        ? { shopeeShopCredential: input.shopeeShopCredential }
        : {}),
    });
    return result(
      input,
      verification.steps,
      verification.remoteId,
      undefined,
      verification.remoteState,
    );
  }
  if (input.channel === "coupang"
      && (input.operation === "listing.update" || input.operation === "listing.stop")
      && Object.hasOwn(input.arguments, coupangExactQaRecoveryArgument)) {
    assertCoupangExactQaProviderContract(input.arguments, input.operation);
  }
  const requestedPublicationIntent = listingPublicationIntentFromArguments(input.arguments);
  const requestedPublicationStateContract = input.arguments.publicationStateContract === listingRemoteStateContractVersion
    ? listingRemoteStateContractVersion
    : undefined;
  const requestedPublicationExpectedFingerprint = typeof input.arguments.publicationExpectedFingerprint === "string"
      && /^[a-f0-9]{64}$/u.test(input.arguments.publicationExpectedFingerprint)
    ? input.arguments.publicationExpectedFingerprint
    : undefined;
  const requestedPublicationExpectedLocale = typeof input.arguments.publicationExpectedLocale === "string"
    ? input.arguments.publicationExpectedLocale
    : undefined;
  const requestedPublicationExpectedImageCount = typeof input.arguments.publicationExpectedImageCount === "number"
      && Number.isInteger(input.arguments.publicationExpectedImageCount)
    ? input.arguments.publicationExpectedImageCount
    : undefined;
  if (input.channel === "ebay"
      && input.operation === "listing.update"
      && ebayExactExistingQaRecoveryBinding(input.arguments)) {
    assertEbayExactExistingQaProviderCopyRequest(input.arguments);
  }
  const safeInput = input.operation === "listing.update"
    ? {
      ...input,
      arguments: {
        ...prepareListingUpdateArguments(input.channel, input.arguments, {
          status: "published",
          remoteId: listingUpdateRemoteIdentity(input.channel, input.arguments),
        }),
        ...(input.channel === "ebay"
          ? {
              offerId: input.arguments.offerId,
              sku: input.arguments.sku,
              marketplaceId: input.arguments.marketplaceId,
            }
          : {}),
        ...(requestedPublicationIntent ? { publicationIntent: requestedPublicationIntent } : {}),
        ...(requestedPublicationStateContract ? { publicationStateContract: requestedPublicationStateContract } : {}),
        ...(requestedPublicationExpectedFingerprint
          ? { publicationExpectedFingerprint: requestedPublicationExpectedFingerprint }
          : {}),
        ...(requestedPublicationExpectedLocale
          ? { publicationExpectedLocale: requestedPublicationExpectedLocale }
          : {}),
        ...(requestedPublicationExpectedImageCount === undefined
          ? {}
          : { publicationExpectedImageCount: requestedPublicationExpectedImageCount }),
      },
    }
    : input;
  const safeArguments: Record<string, unknown> = safeInput.arguments;
  if ((safeInput.operation === "orders.list" || safeInput.operation === "inquiries.list")
      && (finiteCount(safeArguments.sellerpilotPaginationDepth) ?? 0) >= MAX_PROVIDER_SYNC_CONTINUATIONS) {
    return paginationSafetyStop(safeInput);
  }
  if (safeInput.channel === "qoo10") return executeQoo10(safeInput);
  if (safeInput.channel === "shopee") return executeShopee(safeInput);
  if (safeInput.channel === "lazada") return executeLazada(safeInput);
  if (safeInput.channel === "coupang") return executeCoupang(safeInput);
  if (safeInput.channel === "elevenst") return executeElevenst(safeInput);
  if (safeInput.channel === "smartstore") return executeSmartstore(safeInput);
  if (safeInput.channel === "ebay") return executeEbay(safeInput);
  if (safeInput.channel === "temu") return executeTemu(safeInput);
  throw new Error("CHANNEL_OPERATION_UNSUPPORTED");
}
