export const ebayExactExistingQaRecoveryContract =
  "ebay_exact_existing_qa_recovery_v2" as const;

export const ebayExactExistingQaRecoveryArgument =
  "sellerpilotEbayExactExistingQaRecovery" as const;

export const ebayExactNoEffectRetryArgument =
  "sellerpilotEbayExactNoEffectRetry" as const;

export const ebayExactV101ContentContractArgument =
  "sellerpilotEbayExactV101ContentContract" as const;

export const ebayExactV101ContentContract = Object.freeze({
  contract: "ebay_exact_v101_content_contract_v1",
  materialSource: "ABS 플라스틱",
  materialTarget: "ABS Plastic",
  inventoryImageCount: 9,
  detailImageCount: 8,
});

export const ebayExactV101ContentBaseRequestFingerprint =
  "8eeb374c49a1e4ec6a3d95c55e407993d8a5938dbc77d4f0c7d33b290cfd5591";

export const ebayExactV101ContentRequestFingerprint =
  "4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e";

export const ebayExactV101RepresentativeObjectPath =
  "normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg";

export const ebayExactV101RepresentativeSourceObjectPath =
  "results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/thumbnail-square.png";

export const ebayExactV101RepresentativeSourceSha256 =
  "1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753";

export const ebayExactNoEffectRetryMarker = Object.freeze({
  contract: "ebay_exact_no_effect_retry_v1",
  sourceJobId: "08e8cff9-5d7c-4992-b668-6d932aa5ff10",
  sourceAttemptId: "22457f2e-51d8-43c5-bb03-d2c1bb7fe697",
  sourcePermitId: "c2e9f199-f6a7-425f-8668-7eebd5b08bb4",
  sourceRequestFingerprint: "79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc",
  providerErrorId: 25_718,
  providerEffect: "deterministic_rejection_no_effect",
});

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
  sellerAccountKey: "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f",
});

export const ebayExactV101SameSellerCredentialSentinel =
  `sellerpilot-same-seller://${ebayExactExistingQaRecoveryIdentity.sellerAccountKey}`;

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

function exactV101ContentContractValue(value: unknown) {
  const contract = recordValue(value);
  return contract
    && Object.keys(contract).length === 5
    && contract.contract === ebayExactV101ContentContract.contract
    && contract.materialSource === ebayExactV101ContentContract.materialSource
    && contract.materialTarget === ebayExactV101ContentContract.materialTarget
    && contract.inventoryImageCount === ebayExactV101ContentContract.inventoryImageCount
    && contract.detailImageCount === ebayExactV101ContentContract.detailImageCount
      ? contract
      : null;
}

export function ebayExactV101ContentRequestFingerprintForBase(
  baseRequestFingerprint: string,
) {
  if (baseRequestFingerprint !== ebayExactV101ContentBaseRequestFingerprint) {
    throw new Error("EBAY_EXACT_V101_CONTENT_BASE_FINGERPRINT_REQUIRED");
  }
  return ebayExactV101ContentRequestFingerprint;
}

export function bindEbayExactV101ContentContractArguments(
  argumentsValue: Record<string, unknown>,
) {
  if (!ebayExactExistingQaRecoveryBinding(argumentsValue)) {
    throw new Error("EBAY_EXACT_V101_CONTENT_RECOVERY_BINDING_REQUIRED");
  }
  return {
    ...argumentsValue,
    [ebayExactV101ContentContractArgument]: ebayExactV101ContentContract,
  };
}

export function ebayExactV101ContentContractBinding(
  argumentsValue: Record<string, unknown>,
) {
  return exactV101ContentContractValue(
    argumentsValue[ebayExactV101ContentContractArgument],
  );
}

function canonicalUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
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
      || !canonicalUuid(binding.credentialId)
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

function sellerpilotStorageFingerprintUrl(value: unknown) {
  const candidate = exactText(value);
  const storageScheme = "sellerpilot-storage://";
  let objectPath = "";
  if (candidate.startsWith(storageScheme)) {
    objectPath = candidate.slice(storageScheme.length);
  } else {
    try {
      const parsed = new URL(candidate);
      const signedPrefix = "/storage/v1/object/sign/sellerpilot-ai/";
      const publicPrefix = "/storage/v1/object/public/sellerpilot-ai/";
      const prefix = parsed.pathname.startsWith(signedPrefix)
        ? signedPrefix
        : parsed.pathname.startsWith(publicPrefix)
          ? publicPrefix
          : "";
      const signed = prefix === signedPrefix;
      if (parsed.protocol !== "https:"
          || !/^[a-z0-9-]+\.supabase\.(?:co|in)$/u.test(parsed.hostname)
          || parsed.port
          || parsed.username
          || parsed.password
          || parsed.hash
          || !prefix
          || (signed && !parsed.searchParams.get("token"))
          || (!signed && parsed.search)) return null;
      objectPath = decodeURIComponent(parsed.pathname.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return objectPath
    && !objectPath.startsWith("/")
    && !objectPath.includes("..")
    && /^[A-Za-z0-9._/-]+$/u.test(objectPath)
      ? `${storageScheme}${objectPath}`
      : null;
}

/**
 * Removes only expiring storage tokens and the rotating credential UUID from
 * the exact eBay request fingerprint. The transport arguments are cloned and
 * remain untouched; every product, listing, commerce and content field stays
 * inside the canonical request hash.
 */
export function ebayExactV101ArgumentsForFingerprint(
  argumentsValue: Record<string, unknown>,
) {
  const binding = ebayExactExistingQaRecoveryBinding(argumentsValue);
  const assets = recordValue(argumentsValue.sellerpilotAssets);
  const gallery = Array.isArray(assets?.galleryImageUrls)
    ? assets.galleryImageUrls
    : [];
  const approvedGalleryImagePaths = Array.isArray(
    assets?.approvedGalleryImagePaths,
  ) ? assets.approvedGalleryImagePaths : [];
  const approvedGalleryImageSha256s = Array.isArray(
    assets?.approvedGalleryImageSha256s,
  ) ? assets.approvedGalleryImageSha256s : [];
  const stableGallery = gallery.map(sellerpilotStorageFingerprintUrl);
  if (!binding
      || !assets
      || stableGallery.length !== 1
      || stableGallery[0]
        !== `sellerpilot-storage://${ebayExactV101RepresentativeSourceObjectPath}`
      || approvedGalleryImagePaths.length !== 1
      || approvedGalleryImagePaths[0]
        !== ebayExactV101RepresentativeSourceObjectPath
      || approvedGalleryImageSha256s.length !== 1
      || approvedGalleryImageSha256s[0]
        !== ebayExactV101RepresentativeSourceSha256) {
    throw new Error("EBAY_EXACT_V101_FINGERPRINT_PROJECTION_REQUIRED");
  }
  const next = structuredClone(argumentsValue);
  const nextAssets = recordValue(next.sellerpilotAssets);
  const nextBinding = recordValue(next[ebayExactExistingQaRecoveryArgument]);
  if (!nextAssets || !nextBinding) {
    throw new Error("EBAY_EXACT_V101_FINGERPRINT_PROJECTION_REQUIRED");
  }
  next.sellerpilotAssets = {
    ...nextAssets,
    galleryImageUrls: stableGallery,
  };
  next[ebayExactExistingQaRecoveryArgument] = {
    ...nextBinding,
    credentialId: ebayExactV101SameSellerCredentialSentinel,
  };
  return next;
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
    [ebayExactV101ContentContractArgument]: ebayExactV101ContentContract,
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
    && (input.failureClass === "external_action"
      || input.failureClass === "retryable");
}

export function bindEbayExactNoEffectRetryArguments(
  argumentsValue: Record<string, unknown>,
) {
  return {
    ...argumentsValue,
    [ebayExactNoEffectRetryArgument]: ebayExactNoEffectRetryMarker,
  };
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

export function ebayExactV101RepresentativeUrl(value: unknown) {
  const candidate = exactText(value);
  try {
    const parsed = new URL(candidate);
    const prefix = "/storage/v1/object/public/sellerpilot-marketplace/";
    return parsed.protocol === "https:"
      && parsed.pathname.startsWith(prefix)
      && parsed.pathname.slice(prefix.length) === ebayExactV101RepresentativeObjectPath;
  } catch {
    return false;
  }
}

function imageCount(value: unknown) {
  return (exactText(value).match(/<img\b/giu) ?? []).length;
}

function htmlImageUrls(value: unknown) {
  return [...exactText(value).matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/giu,
  )].map((match) => (match[1] ?? match[2] ?? "")
    .replaceAll("&amp;", "&")
    .trim())
    .filter(Boolean);
}

function exactOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function providerTransportImageUrls(argumentsValue: Record<string, unknown>) {
  const assetBinding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const images = Array.isArray(assetBinding?.providerTransportImages)
    ? assetBinding.providerTransportImages
    : [];
  const representative = recordValue(images[0]);
  const urls = images.slice(1)
    .map((image) => exactText(recordValue(image)?.publicUrl));
  const representativeValid = assetBinding?.providerImageSurface === "gallery"
    && images.length === 9
    && representative?.role === "gallery-representative"
    && exactText(representative?.objectPath) === ebayExactV101RepresentativeObjectPath
    && exactText(representative?.contentSha256)
      === ebayExactV101RepresentativeObjectPath.slice("normalized/29/".length, -4)
    && ebayExactV101RepresentativeUrl(representative?.publicUrl)
    && /^results\/[0-9a-f-]+\/claims\/[0-9a-f-]+\/[^/]+\.png$/iu.test(
      exactText(representative?.approvedObjectPath),
    )
    && /^[a-f0-9]{64}$/u.test(exactText(representative?.approvedSourceSha256));
  return representativeValid
    && urls.length === 8
    && urls.every(Boolean)
    && new Set([exactText(representative?.publicUrl), ...urls]).size === 9
    ? urls
    : [];
}

export function ebayExactV101EnglishAspects(value: unknown) {
  const aspects = recordValue(value);
  if (!aspects) {
    throw new Error("EBAY_EXACT_V101_ASPECTS_REQUIRED");
  }
  const entries = Object.entries(aspects);
  if (!entries.length || entries.some(([key, item]) =>
    !/^[\x20-\x7E]+$/u.test(key)
    || !Array.isArray(item)
    || item.length === 0
    || item.some((entry) =>
      typeof entry !== "string"
      || !entry.trim()
      || (!/^[\x20-\x7E]+$/u.test(entry)
        && !(key === "Material"
          && entry === ebayExactV101ContentContract.materialSource))))) {
    throw new Error("EBAY_EXACT_V101_ENGLISH_ASPECT_SHAPE_REQUIRED");
  }
  const material = aspects.Material;
  if (!Array.isArray(material)
      || material.length !== 1
      || (material[0] !== ebayExactV101ContentContract.materialSource
        && material[0] !== ebayExactV101ContentContract.materialTarget)) {
    throw new Error("EBAY_EXACT_V101_MATERIAL_ASPECT_REQUIRED");
  }
  const translated = structuredClone(aspects);
  translated.Material = [ebayExactV101ContentContract.materialTarget];
  return translated;
}

function visibleHtmlText(value: unknown) {
  return exactText(value)
    .replace(/<!--[^]*?-->/gu, " ")
    .replace(/<script\b[^]*?<\/script>/giu, " ")
    .replace(/<style\b[^]*?<\/style>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:nbsp|#160);/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function exactEnglishText(value: unknown) {
  const text = exactText(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return /[a-z]/iu.test(text)
    && !/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

export function assertEbayExactExistingQaUpdateArguments(
  argumentsValue: Record<string, unknown>,
  options: {
    requirePreparedImages?: boolean;
    expectedDetailImageUrls?: readonly string[];
    inventoryDescriptionMode?: "detail_images" | "compact_text";
  } = {},
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
  const expectedDetailImageUrls = options.expectedDetailImageUrls ?? [];
  const compactInventoryDescription =
    options.inventoryDescriptionMode === "compact_text";
  const descriptionImages = htmlImageUrls(description);
  const listingDescriptionImages = htmlImageUrls(listingDescription);
  const translatedAspects = (() => {
    try {
      return ebayExactV101EnglishAspects(product?.aspects);
    } catch {
      return null;
    }
  })();
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
      || !exactEnglishText(title)
      || description.length < 20
      || !exactEnglishText(description)
      || (compactInventoryDescription && description.length > 1_000)
      || listingDescription.length < 20
      || !exactEnglishText(listingDescription)
      || !translatedAspects
      || JSON.stringify(product?.aspects) !== JSON.stringify(translatedAspects)
      || urls.length !== 9
      || !ebayExactV101RepresentativeUrl(urls[0])
      || (compactInventoryDescription && imageCount(description) !== 0)
      || (!compactInventoryDescription
        && options.requirePreparedImages !== false
        && imageCount(description) !== 8)
      || (options.requirePreparedImages !== false && imageCount(listingDescription) !== 8)
      || (expectedDetailImageUrls.length > 0
        && ((!compactInventoryDescription
            && !exactOrderedValues(descriptionImages, expectedDetailImageUrls))
          || !exactOrderedValues(listingDescriptionImages, expectedDetailImageUrls)
          || !exactOrderedValues(urls.slice(1), expectedDetailImageUrls)))
      || argumentsValue.publish === true) {
    throw new Error("EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED");
  }
  return binding;
}

export function ebayExactExistingQaClientBuyerCopySupplied(
  argumentsValue: Record<string, unknown>,
) {
  const inventoryItem = recordValue(argumentsValue.inventoryItem);
  const product = recordValue(inventoryItem?.product);
  const offer = recordValue(argumentsValue.offer);
  const body = recordValue(argumentsValue.body);
  return Boolean(
    exactText(product?.title)
    || visibleHtmlText(product?.description)
    || visibleHtmlText(offer?.listingDescription)
    || visibleHtmlText(body?.listingDescription),
  );
}

/**
 * Exact eBay recovery requests transport commerce values and server-prepared
 * images only. Buyer-facing title/description text is deliberately absent;
 * the provider executor derives it from the immutable offer/inventory GETs.
 */
export function assertEbayExactExistingQaProviderCopyRequest(
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
  const urls = uniqueHttpsUrls(product?.imageUrls);
  const description = exactText(product?.description);
  const listingDescription = exactText(offer?.listingDescription);
  const preparedImagesRequired = options.requirePreparedImages !== false;
  const detailUrls = providerTransportImageUrls(argumentsValue);
  if (!binding
      || !ebayExactV101ContentContractBinding(argumentsValue)
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
      || exactText(product?.title)
      || visibleHtmlText(description)
      || visibleHtmlText(listingDescription)
      || (preparedImagesRequired && detailUrls.length !== 8)
      || (preparedImagesRequired && urls.length !== 9)
      || (preparedImagesRequired && !ebayExactV101RepresentativeUrl(urls[0]))
      || (preparedImagesRequired && !exactOrderedValues(urls.slice(1), detailUrls))
      || (preparedImagesRequired && detailUrls.includes(urls[0] ?? ""))
      || (preparedImagesRequired && imageCount(description) !== 8)
      || (preparedImagesRequired && imageCount(listingDescription) !== 8)
      || argumentsValue.publish === true) {
    throw new Error("EBAY_EXACT_EXISTING_QA_PROVIDER_COPY_REQUEST_REQUIRED");
  }
  return binding;
}
