export const ebayExactExistingQaRecoveryContract =
  "ebay_exact_existing_qa_recovery_v2" as const;

export const ebayExactExistingQaRecoveryArgument =
  "sellerpilotEbayExactExistingQaRecovery" as const;

export const ebayExactExistingQaRecoveryIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "8b2cbfaf-3854-437d-b381-abfd70291354",
  sourceAttemptId: "07b8ced8-fa77-4c22-a708-2ce1ec4e3c77",
  publicListingId: "800551945442",
  market: "US",
  marketplaceId: "EBAY_US",
  marketplaceSku: "QA-20260823-CC-001-US",
  offerId: "244042196011",
  centralSku: "QA-20260823-CC-001",
  currency: "USD",
  priceUsd: 12.9,
  credentialId: "a2593ca0-c2c2-4158-a35b-88aa27b5911a",
  sellerAccountKey: "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f",
});

export type EbayExactExistingQaRecoveryBinding = {
  contract: typeof ebayExactExistingQaRecoveryContract;
  phase: "listing.update";
  productId: string;
  listingId: string;
  sourceAttemptId: string;
  publicListingId: string;
  market: "US";
  marketplaceId: "EBAY_US";
  marketplaceSku: string;
  offerId: string;
  currency: "USD";
  priceUsd: number;
  stock: number;
  credentialId: string;
  sellerAccountKey: string;
  offerIdSource: "immutable_lineage_attestation_v1";
  sellerAccountLineage: "validated_by_service_rpc";
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function exactNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

export function ebayExactExistingQaRecoveryBindingValue(
  value: unknown,
): EbayExactExistingQaRecoveryBinding | null {
  const binding = recordValue(value);
  const stock = Number(binding?.stock);
  const priceUsd = Number(binding?.priceUsd);
  if (!binding
      || Object.keys(binding).length !== 17
      || binding.contract !== ebayExactExistingQaRecoveryContract
      || binding.phase !== "listing.update"
      || binding.productId !== ebayExactExistingQaRecoveryIdentity.productId
      || binding.listingId !== ebayExactExistingQaRecoveryIdentity.listingId
      || binding.sourceAttemptId !== ebayExactExistingQaRecoveryIdentity.sourceAttemptId
      || binding.publicListingId !== ebayExactExistingQaRecoveryIdentity.publicListingId
      || binding.market !== ebayExactExistingQaRecoveryIdentity.market
      || binding.marketplaceId !== ebayExactExistingQaRecoveryIdentity.marketplaceId
      || binding.marketplaceSku !== ebayExactExistingQaRecoveryIdentity.marketplaceSku
      || binding.offerId !== ebayExactExistingQaRecoveryIdentity.offerId
      || binding.currency !== ebayExactExistingQaRecoveryIdentity.currency
      || !Number.isFinite(priceUsd)
      || Math.abs(priceUsd - ebayExactExistingQaRecoveryIdentity.priceUsd) > 0.000_001
      || !Number.isSafeInteger(stock)
      || stock < 1
      || stock > 999_999
      || binding.credentialId !== ebayExactExistingQaRecoveryIdentity.credentialId
      || binding.sellerAccountKey !== ebayExactExistingQaRecoveryIdentity.sellerAccountKey
      || binding.offerIdSource !== "immutable_lineage_attestation_v1"
      || binding.sellerAccountLineage !== "validated_by_service_rpc") {
    return null;
  }
  return { ...binding, priceUsd, stock } as EbayExactExistingQaRecoveryBinding;
}

export function ebayExactExistingQaRecoveryBinding(
  argumentsValue: Record<string, unknown>,
) {
  return ebayExactExistingQaRecoveryBindingValue(
    argumentsValue[ebayExactExistingQaRecoveryArgument],
  );
}

export function bindEbayExactExistingQaRecoveryArguments(
  argumentsValue: Record<string, unknown>,
  bindingValue: unknown,
) {
  const binding = ebayExactExistingQaRecoveryBindingValue(bindingValue);
  if (!binding) {
    throw new Error("EBAY_EXACT_EXISTING_QA_SERVER_CONTEXT_REQUIRED");
  }
  const next = structuredClone(argumentsValue);
  delete next.offerId;
  delete next.providerResourceId;
  return {
    ...next,
    listingId: ebayExactExistingQaRecoveryIdentity.publicListingId,
    sku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    marketplaceId: ebayExactExistingQaRecoveryIdentity.marketplaceId,
    [ebayExactExistingQaRecoveryArgument]: binding,
  };
}

export function ebayExactExistingQaCreateForbidden(input: {
  productId?: string | null;
  market?: string | null;
  targetId?: string | null;
  argumentsValue?: Record<string, unknown> | null;
}) {
  const argumentsValue = input.argumentsValue ?? {};
  const inventoryItem = recordValue(argumentsValue.inventoryItem);
  const inventoryProduct = recordValue(inventoryItem?.product);
  const offer = recordValue(argumentsValue.offer);
  const exactTarget = input.productId === ebayExactExistingQaRecoveryIdentity.productId
    && exactText(input.market).toUpperCase() === ebayExactExistingQaRecoveryIdentity.market
    && exactText(input.targetId).toUpperCase() === ebayExactExistingQaRecoveryIdentity.marketplaceId;
  return exactTarget
    || [
      argumentsValue.sku,
      inventoryItem?.sku,
      inventoryProduct?.mpn,
      offer?.sku,
    ].some((value) => exactText(value) === ebayExactExistingQaRecoveryIdentity.marketplaceSku)
    || [argumentsValue.listingId, argumentsValue.remoteId]
      .some((value) => exactText(value) === ebayExactExistingQaRecoveryIdentity.publicListingId);
}

export function ebayExactExistingQaRecoveryCandidate(input: {
  channel: string;
  listingId?: string | null;
  remoteId?: string | null;
  marketplaceSku?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
  failureClass?: string | null;
}) {
  return input.channel === "ebay"
    && input.listingId === ebayExactExistingQaRecoveryIdentity.listingId
    && input.remoteId === ebayExactExistingQaRecoveryIdentity.publicListingId
    && input.marketplaceSku === ebayExactExistingQaRecoveryIdentity.marketplaceSku
    && input.status === "failed"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown"
    && !input.providerStatus
    && !input.publishedAt
    && input.failureClass === "external_action";
}

export function ebayExactExistingQaCentralProductVerified(
  value: unknown,
  bindingValue: unknown,
) {
  const context = recordValue(value);
  const product = recordValue(context?.product);
  const manualFields = recordValue(context?.manualFields);
  const binding = ebayExactExistingQaRecoveryBindingValue(bindingValue);
  if (!binding) return false;
  const productSku = exactText(product?.sku);
  const manualSku = exactText(manualFields?.sellerSku);
  return product?.id === ebayExactExistingQaRecoveryIdentity.productId
    && productSku === ebayExactExistingQaRecoveryIdentity.centralSku
    && (!manualSku || manualSku === ebayExactExistingQaRecoveryIdentity.centralSku)
    && Number(product?.onHand) === binding.stock
    && product?.status !== "archived";
}

function uniqueHttpsUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const urls = value.map(exactText).filter((url) => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  });
  return new Set(urls).size === urls.length ? urls : [];
}

function imageCount(value: unknown) {
  return (exactText(value).match(/<img\b/giu) ?? []).length;
}

export function assertEbayExactExistingQaUpdateArguments(
  argumentsValue: Record<string, unknown>,
  options: { requirePreparedImages?: boolean } = {},
) {
  const binding = ebayExactExistingQaRecoveryBinding(argumentsValue);
  const inventoryItem = recordValue(argumentsValue.inventoryItem);
  const product = recordValue(inventoryItem?.product);
  const availability = recordValue(inventoryItem?.availability);
  const shipToLocationAvailability = recordValue(
    availability?.shipToLocationAvailability,
  );
  const offer = recordValue(argumentsValue.offer);
  const pricingSummary = recordValue(offer?.pricingSummary);
  const price = recordValue(pricingSummary?.price);
  const requestedPrice = exactNumber(price?.value);
  const title = exactText(product?.title);
  const description = exactText(product?.description);
  const listingDescription = exactText(offer?.listingDescription);
  const urls = uniqueHttpsUrls(product?.imageUrls);
  if (!binding
      || exactText(argumentsValue.listingId) !== binding.publicListingId
      || exactText(argumentsValue.sku) !== binding.marketplaceSku
      || exactText(argumentsValue.marketplaceId).toUpperCase() !== binding.marketplaceId
      || exactText(argumentsValue.offerId)
      || exactText(argumentsValue.providerResourceId)
      || argumentsValue.publicationIntent !== "live"
      || argumentsValue.publicationStateContract !== "verified_remote_state_v1"
      || argumentsValue.publicationExpectedLocale !== "en-US"
      || argumentsValue.publicationExpectedImageCount !== 8
      || inventoryItem?.condition !== "NEW"
      || Number(shipToLocationAvailability?.quantity) !== binding.stock
      || Number(offer?.availableQuantity) !== binding.stock
      || exactText(price?.currency).toUpperCase() !== binding.currency
      || !Number.isFinite(requestedPrice)
      || Math.abs(requestedPrice - binding.priceUsd) > 0.000_001
      || title.length < 2
      || title.length > 80
      || description.length < 20
      || listingDescription.length < 20
      || urls.length < 1
      || urls.length > 12
      || (options.requirePreparedImages !== false && imageCount(description) < 8)
      || (options.requirePreparedImages !== false && imageCount(listingDescription) < 8)
      || argumentsValue.publish === true) {
    throw new Error("EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED");
  }
  return binding;
}
