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

export const lazadaExactExistingSellerSku =
  `${lazadaExactExistingPublicationIdentity.centralSku}-${lazadaExactExistingPublicationIdentity.market}` as const;

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

function exactNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function uniqueHttpsUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const urls = value.map(text).filter((url) => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  });
  return urls.length === new Set(urls).size ? urls : [];
}

export function lazadaExactExistingUpdateTarget(argumentsValue: UnknownRecord) {
  const request = recordValue(argumentsValue.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  return text(argumentsValue.itemId || product.ItemId || product.item_id)
    === lazadaExactExistingPublicationIdentity.remoteId;
}

/**
 * The exact legacy MY item is allowed to use the generic update runtime only
 * after its server-side listing/credential lineage gate has succeeded. This
 * second, provider-adjacent fence keeps every operator-controlled commerce,
 * localization and containment value exact before even a read-only Lazada
 * request or image migration starts.
 */
export function assertLazadaExactExistingUpdateArguments(
  argumentsValue: UnknownRecord,
) {
  if (!lazadaExactExistingUpdateTarget(argumentsValue)) return;

  const identity = lazadaExactExistingPublicationIdentity;
  const request = recordValue(argumentsValue.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  const skuRoot = recordValue(product.Skus);
  const skus = Array.isArray(skuRoot.Sku)
    ? skuRoot.Sku.map(recordValue)
    : [];
  const sku = skus[0] ?? {};
  const policy = recordValue(argumentsValue.sellerpilotLazadaPricePolicy);
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const transportRows = Array.isArray(binding.providerTransportImages)
    ? binding.providerTransportImages.map(recordValue)
    : [];
  const detailUrls = transportRows.map((row) => text(row.publicUrl)).filter(Boolean);
  const assets = recordValue(argumentsValue.sellerpilotAssets);
  const galleryUrls = uniqueHttpsUrls(assets.galleryImageUrls);
  const sourceUrls = uniqueHttpsUrls(argumentsValue.imageUrls);
  const representative = galleryUrls[0] ?? "";
  const requestedPrice = exactNumber(sku.price ?? sku.Price);
  const policyPrice = exactNumber(policy.targetPriceMyr);

  if (text(argumentsValue.country).toLowerCase() !== identity.country
      || argumentsValue.publicationStateContract !== "verified_remote_state_v1"
      || argumentsValue.publicationIntent !== "safe_test"
      || argumentsValue.publicationExpectedLocale !== identity.locale
      || Number(argumentsValue.publicationExpectedImageCount) !== identity.detailImageCount
      || policy.contract !== "lazada_krw_myr_reference_price_v1"
      || policy.sourceCurrency !== identity.sourceCurrency
      || exactNumber(policy.sourcePriceKrw) !== identity.sourcePriceKrw
      || policy.targetCurrency !== identity.targetCurrency
      || !Number.isFinite(policyPrice)
      || !Number.isFinite(requestedPrice)
      || Math.abs(requestedPrice - policyPrice) > 0.000_001
      || skus.length !== 1
      || text(sku.SellerSku ?? sku.seller_sku) !== lazadaExactExistingSellerSku
      || exactNumber(sku.quantity ?? sku.Quantity) !== identity.stock
      || text(sku.Status ?? sku.status).toLowerCase() !== "inactive"
      || !/^\d+$/u.test(text(product.PrimaryCategory ?? product.primary_category))
      || binding.contract !== "sellerpilot_publication_asset_binding_v1"
      || binding.providerImageSurface !== "detail_content"
      || detailUrls.length !== identity.detailImageCount
      || new Set(detailUrls).size !== identity.detailImageCount
      || !representative
      || detailUrls.includes(representative)
      || sourceUrls.length !== identity.detailImageCount + 1
      || !sourceUrls.includes(representative)
      || detailUrls.some((url) => !sourceUrls.includes(url))) {
    throw new Error("LAZADA_EXACT_EXISTING_CONTENT_CONTRACT_REQUIRED");
  }
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
