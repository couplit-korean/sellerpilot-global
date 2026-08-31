import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
} from "./listing-publication-content";
import { listingPublicationAssetBindingContract } from "./marketplace-images";
import {
  elevenstExactExistingPublicationArgument,
  elevenstExactExistingPublicationContract,
  elevenstExactExistingPublicationIdentity,
} from "./elevenst-exact-existing-identity";

export {
  elevenstExactExistingPublicationArgument,
  elevenstExactExistingPublicationCandidate,
  elevenstExactExistingPublicationContract,
  elevenstExactExistingPublicationIdentity,
} from "./elevenst-exact-existing-identity";

export type ElevenstExactExistingPublicationBinding = {
  contract: typeof elevenstExactExistingPublicationContract;
  productId: string;
  listingId: string;
  credentialId: string;
  remoteId: string;
  sellerSku: string;
  categoryId: string;
  baselineProviderStatus: "105";
  liveProviderStatus: "103";
  priceKrw: 5000;
  stock: 1;
  representativeImageCount: 1;
  sellerAccountLineage: "validated_by_service_rpc";
  trustedSnapshot: "sellerpilot_service_get_elevenst_listing_snapshot";
};

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

function htmlImageUrls(value: unknown) {
  const html = text(value)
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&");
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/giu)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter(Boolean);
}

export function elevenstExactExistingCentralSkuVerified(value: unknown) {
  const context = recordValue(value);
  const product = recordValue(context.product);
  const manualFields = recordValue(context.manualFields);
  const productSku = text(product.sku);
  const manualSku = text(manualFields.sellerSku);
  const expected = elevenstExactExistingPublicationIdentity.sellerSku;
  return (productSku === expected || manualSku === expected)
    && (!productSku || productSku === expected)
    && (!manualSku || manualSku === expected);
}

export function elevenstExactExistingCentralCommerceVerified(value: unknown) {
  const context = recordValue(value);
  const manualFields = recordValue(context.manualFields);
  return text(manualFields.currency).toUpperCase() === elevenstExactExistingPublicationIdentity.currency
    && Number(manualFields.sellingPrice) === elevenstExactExistingPublicationIdentity.priceKrw
    && Number(manualFields.stock) === elevenstExactExistingPublicationIdentity.stock;
}

export function elevenstExactExistingCreateForbidden(input: {
  productId?: string | null;
  argumentsValue?: UnknownRecord | null;
}) {
  if (input.productId === elevenstExactExistingPublicationIdentity.productId) return true;
  const argumentsValue = input.argumentsValue ?? {};
  const product = recordValue(argumentsValue.product);
  return text(argumentsValue.productNo) === elevenstExactExistingPublicationIdentity.remoteId
    || text(product.prdNo) === elevenstExactExistingPublicationIdentity.remoteId
    || text(product.sellerPrdCd) === elevenstExactExistingPublicationIdentity.sellerSku;
}

export function bindElevenstExactExistingPublication(
  argumentsValue: UnknownRecord,
) {
  const identity = elevenstExactExistingPublicationIdentity;
  const binding: ElevenstExactExistingPublicationBinding = {
    contract: elevenstExactExistingPublicationContract,
    productId: identity.productId,
    listingId: identity.listingId,
    credentialId: identity.credentialId,
    remoteId: identity.remoteId,
    sellerSku: identity.sellerSku,
    categoryId: identity.categoryId,
    baselineProviderStatus: identity.baselineProviderStatus,
    liveProviderStatus: identity.liveProviderStatus,
    priceKrw: identity.priceKrw,
    stock: identity.stock,
    representativeImageCount: identity.representativeImageCount,
    sellerAccountLineage: "validated_by_service_rpc",
    trustedSnapshot: "sellerpilot_service_get_elevenst_listing_snapshot",
  };
  return { ...argumentsValue, [elevenstExactExistingPublicationArgument]: binding };
}

export function elevenstExactExistingPublicationBinding(
  argumentsValue: UnknownRecord,
) {
  const binding = recordValue(argumentsValue[elevenstExactExistingPublicationArgument]);
  const identity = elevenstExactExistingPublicationIdentity;
  if (binding.contract !== elevenstExactExistingPublicationContract
      || binding.productId !== identity.productId
      || binding.listingId !== identity.listingId
      || binding.credentialId !== identity.credentialId
      || binding.remoteId !== identity.remoteId
      || binding.sellerSku !== identity.sellerSku
      || binding.categoryId !== identity.categoryId
      || binding.baselineProviderStatus !== identity.baselineProviderStatus
      || binding.liveProviderStatus !== identity.liveProviderStatus
      || binding.priceKrw !== identity.priceKrw
      || binding.stock !== identity.stock
      || binding.representativeImageCount !== identity.representativeImageCount
      || binding.sellerAccountLineage !== "validated_by_service_rpc"
      || binding.trustedSnapshot !== "sellerpilot_service_get_elevenst_listing_snapshot") {
    return null;
  }
  return binding as ElevenstExactExistingPublicationBinding;
}

export function elevenstExactExistingUpdateTarget(argumentsValue: UnknownRecord) {
  const product = recordValue(argumentsValue.product);
  return text(argumentsValue.productNo) === elevenstExactExistingPublicationIdentity.remoteId
    || text(product.prdNo) === elevenstExactExistingPublicationIdentity.remoteId
    || text(product.sellerPrdCd) === elevenstExactExistingPublicationIdentity.sellerSku;
}

function exactApprovedImageUrls(argumentsValue: UnknownRecord) {
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const transport = Array.isArray(binding.providerTransportImages)
    ? binding.providerTransportImages.map(recordValue)
    : [];
  if (binding.contract !== listingPublicationAssetBindingContract
      || binding.providerImageSurface !== "detail_content"
      || transport.length !== elevenstExactExistingPublicationIdentity.detailImageCount) {
    return null;
  }
  const urls = transport.map((image) => text(image.publicUrl));
  return urls.every((url) => url.startsWith("https://")) && new Set(urls).size === urls.length
    ? urls
    : null;
}

function exactRepresentativeImageVerified(value: unknown) {
  const candidate = text(value);
  try {
    const url = new URL(candidate);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function assertElevenstExactExistingUpdate(argumentsValue: UnknownRecord) {
  const identity = elevenstExactExistingPublicationIdentity;
  if (!elevenstExactExistingPublicationBinding(argumentsValue)) {
    throw new Error("ELEVENST_EXACT_EXISTING_SERVER_CONTEXT_REQUIRED");
  }
  const product = recordValue(argumentsValue.product);
  const patch = recordValue(argumentsValue.productPatch);
  const title = text(product.prdNm);
  const detailHtml = text(product.htmlDetail);
  const description = normalizedListingPublicationText(detailHtml);
  const expectedImages = exactApprovedImageUrls(argumentsValue);
  const actualImages = htmlImageUrls(detailHtml);
  if (text(argumentsValue.productNo) !== identity.remoteId
      || argumentsValue.publicationStateContract !== "verified_remote_state_v1"
      || argumentsValue.publicationIntent !== "live"
      || argumentsValue.publicationExpectedLocale !== identity.locale
      || argumentsValue.publicationExpectedImageCount !== identity.detailImageCount
      || !/^[a-f0-9]{64}$/u.test(text(argumentsValue.publicationExpectedFingerprint))
      || text(product.sellerPrdCd) !== identity.sellerSku
      || text(product.dispCtgrNo) !== identity.categoryId
      || text(product.selPrc) !== String(identity.priceKrw)
      || text(product.prdSelQty) !== String(identity.stock)
      || !exactRepresentativeImageVerified(product.prdImage01)
      || text(patch.selPrc) !== String(identity.priceKrw)
      || text(patch.prdSelQty) !== String(identity.stock)
      || !listingPublicationLanguageVerified(identity.locale, title, "title")
      || !listingPublicationLanguageVerified(identity.locale, description, "description")
      || !expectedImages
      || actualImages.length !== identity.detailImageCount
      || actualImages.some((url, index) => url !== expectedImages[index])) {
    throw new Error("ELEVENST_EXACT_EXISTING_UPDATE_INVALID");
  }
}

export function elevenstExactExistingBaselineVerified(productValue: unknown) {
  const product = recordValue(productValue);
  const identity = elevenstExactExistingPublicationIdentity;
  return text(product.prdNo) === identity.remoteId
    && text(product.sellerPrdCd) === identity.sellerSku
    && text(product.dispCtgrNo) === identity.categoryId
    && text(product.selStatCd) === identity.baselineProviderStatus;
}

export function elevenstExactExistingLiveReadbackVerified(
  argumentsValue: UnknownRecord,
  productValue: unknown,
) {
  const product = recordValue(productValue);
  try {
    assertElevenstExactExistingUpdate({ ...argumentsValue, product });
  } catch {
    return false;
  }
  return text(product.selStatCd) === elevenstExactExistingPublicationIdentity.liveProviderStatus;
}

export function elevenstExactExistingStagedReadbackVerified(
  argumentsValue: UnknownRecord,
  productValue: unknown,
) {
  const product = recordValue(productValue);
  try {
    assertElevenstExactExistingUpdate({ ...argumentsValue, product });
  } catch {
    return false;
  }
  return text(product.selStatCd) === elevenstExactExistingPublicationIdentity.baselineProviderStatus;
}
