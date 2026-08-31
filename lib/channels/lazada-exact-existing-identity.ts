export const lazadaExactExistingPublicationIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "42021335-9793-4834-8cd5-b73169fd1f48",
  remoteId: "14976038919",
  centralSku: "QA-20260823-CC-001",
  market: "MY",
  country: "my",
  locale: "ms-MY",
  sourceCurrency: "KRW",
  sourcePriceKrw: 5_000,
  targetCurrency: "MYR",
  stock: 1,
  detailImageCount: 8,
});

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function requestedSellerSkus(argumentsValue: UnknownRecord) {
  const request = recordValue(argumentsValue.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  const skus = recordValue(product.Skus);
  const raw = Array.isArray(skus.Sku) ? skus.Sku : skus.Sku ? [skus.Sku] : [];
  return raw.map(recordValue)
    .map((sku) => text(sku.SellerSku ?? sku.seller_sku))
    .filter(Boolean);
}

/**
 * This fence is deliberately broader than the still-unattested remote
 * SellerSku. The exact central product and item are known to exist in Lazada
 * MY, so neither the central SKU nor its MY publication form may be sent to
 * CreateProduct while seller lineage is being certified.
 */
export function lazadaExactExistingCreateForbidden(input: {
  productId?: string | null;
  market?: string | null;
  argumentsValue?: UnknownRecord | null;
}) {
  const identity = lazadaExactExistingPublicationIdentity;
  const argumentsValue = input.argumentsValue ?? {};
  const market = text(input.market || argumentsValue.country).toLowerCase();
  if (market && market !== identity.country) return false;
  if (input.productId === identity.productId) return true;
  if (text(argumentsValue.itemId) === identity.remoteId) return true;
  const skus = requestedSellerSkus(argumentsValue);
  return skus.some((sellerSku) => (
    sellerSku === identity.centralSku || sellerSku === `${identity.centralSku}-${identity.market}`
  ));
}

export function lazadaExactExistingPublicationCandidate(input: {
  channel: string;
  listingId?: string | null;
  remoteId?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
  failureClass?: string | null;
}) {
  const identity = lazadaExactExistingPublicationIdentity;
  return input.channel === "lazada"
    && input.listingId === identity.listingId
    && input.remoteId === identity.remoteId
    && input.status === "failed"
    && input.failureClass === "external_action"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown"
    && !input.providerStatus
    && !input.publishedAt;
}

export function lazadaExactExistingCentralSkuVerified(value: unknown) {
  const context = recordValue(value);
  const product = recordValue(context.product);
  const manualFields = recordValue(context.manualFields);
  const productSku = text(product.sku);
  const manualSku = text(manualFields.sellerSku);
  const expected = lazadaExactExistingPublicationIdentity.centralSku;
  return (productSku === expected || manualSku === expected)
    && (!productSku || productSku === expected)
    && (!manualSku || manualSku === expected);
}
