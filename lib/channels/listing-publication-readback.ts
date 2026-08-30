import { createHash } from "node:crypto";
import {
  listingExpectedPublicationLocale,
  verifiedListingRemoteStateSchema,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import type { RemoteResponse } from "./protocols";

type ListingMutationOperation = "listing.create" | "listing.update" | "listing.stop";

export type ListingPublicationReadbackExpectation = {
  locale: string;
  fingerprint: string;
  imageCount: number;
};

export function listingPublicationReadbackExpectation(
  argumentsValue: Record<string, unknown>,
): ListingPublicationReadbackExpectation | undefined {
  const locale = typeof argumentsValue.publicationExpectedLocale === "string"
    ? argumentsValue.publicationExpectedLocale.trim()
    : "";
  const fingerprint = typeof argumentsValue.publicationExpectedFingerprint === "string"
    ? argumentsValue.publicationExpectedFingerprint.trim()
    : "";
  const imageCount = argumentsValue.publicationExpectedImageCount;
  if (!locale
      || !/^[a-f0-9]{64}$/u.test(fingerprint)
      || !Number.isInteger(imageCount)
      || Number(imageCount) < 0
      || Number(imageCount) > 64) {
    return undefined;
  }
  return { locale, fingerprint, imageCount: Number(imageCount) };
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function remoteAccepted(remote: RemoteResponse) {
  const code = String(remote.data.code ?? "").trim().toUpperCase();
  return remote.response.ok && (!code || ["0", "SUCCESS", "SUCCES", "OK"].includes(code));
}

function strictProviderBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (["TRUE", "Y", "YES"].includes(normalized)) return true;
  if (["FALSE", "N", "NO"].includes(normalized)) return false;
  return undefined;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildVerifiedState(input: {
  visibility: VerifiedListingRemoteState["visibility"];
  providerStatus: string;
  verifiedAt?: string;
  evidence: Record<string, unknown>;
  resources: Record<string, unknown>;
  locale: string;
  fingerprint: string;
  imageCount: number;
}) {
  const parsed = verifiedListingRemoteStateSchema.safeParse({
    verified: true,
    visibility: input.visibility,
    providerStatus: input.providerStatus,
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    evidence: {
      version: "provider_listing_state_v1",
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      imageCountVerified: true,
      ...input.evidence,
    },
    resources: input.resources,
    locale: input.locale,
    fingerprint: input.fingerprint,
    imageCount: input.imageCount,
  });
  return parsed.success ? parsed.data : undefined;
}

function coupangSellerProductData(remote: RemoteResponse) {
  const data = record(remote.data.data);
  return Object.keys(data).length ? data : remote.data;
}

function coupangDetailImageUrls(item: Record<string, unknown>) {
  const urls: string[] = [];
  for (const content of records(item.contents)) {
    if (String(content.contentsType ?? "").trim().toUpperCase() !== "IMAGE") continue;
    for (const detail of records(content.contentDetails)) {
      if (String(detail.detailType ?? "").trim().toUpperCase() !== "IMAGE") continue;
      const url = String(detail.content ?? "").trim();
      if (url) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

function coupangStatusFamily(statusValue: unknown) {
  const status = String(statusValue ?? "").trim();
  const normalized = status.toUpperCase();
  if (!normalized) return { status, family: "unknown" as const };
  if (/(?:승인반려|REJECT)/u.test(normalized)) return { status, family: "rejected" as const };
  if (/(?:상품삭제|DELETED?)/u.test(normalized)) return { status, family: "withdrawn" as const };
  if (/(?:임시저장|TEMP_SAVED|\bSAVED\b|ID_GEN)/u.test(normalized)) return { status, family: "draft" as const };
  if (/(?:승인대기|심사중|APPROVAL_REQUESTED|PENDING|REVIEW)/u.test(normalized)) {
    return { status, family: "pending" as const };
  }
  if (/(?:부분승인완료|승인완료|PARTIAL_APPROVED|APPROVED)/u.test(normalized)) {
    return { status, family: "approved" as const };
  }
  return { status, family: "unknown" as const };
}

export type CoupangListingPublicationReadback = {
  state?: VerifiedListingRemoteState;
  sellerProductReadback?: RemoteResponse;
  vendorItemReadbacks: Array<{ vendorItemId: string; remote: RemoteResponse }>;
  failureCode?: string;
};

/**
 * Performs only authoritative Coupang GETs, then normalizes the exact
 * seller-product and vendor-item state. It is intentionally reusable by a
 * future read-only publication verification operation.
 */
export async function readCoupangListingPublicationState(input: {
  operation: ListingMutationOperation;
  intent?: ListingPublicationIntent;
  remoteId: string;
  expected: ListingPublicationReadbackExpectation;
  expectedStopVendorItemIds?: string[];
  readSellerProduct: (sellerProductId: string) => Promise<RemoteResponse>;
  readVendorItem: (vendorItemId: string) => Promise<RemoteResponse>;
  verifiedAt?: string;
}): Promise<CoupangListingPublicationReadback> {
  const locale = listingExpectedPublicationLocale("coupang", "KR");
  const localeVerified = locale === input.expected.locale;
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expected.fingerprint);
  if (!locale || !localeVerified || !fingerprintVerified) {
    return { vendorItemReadbacks: [], failureCode: "COUPANG_PUBLICATION_EXPECTATION_MISMATCH" };
  }

  if (input.operation === "listing.stop") {
    const sellerProductReadback = await input.readSellerProduct(input.remoteId);
    const sellerProduct = coupangSellerProductData(sellerProductReadback);
    const sellerProductId = String(sellerProduct.sellerProductId ?? "").trim();
    const items = records(sellerProduct.items);
    const rawVendorItemIds = items.map((item) => String(item.vendorItemId ?? "").trim());
    const vendorItemIds = [...new Set(rawVendorItemIds.filter(Boolean))];
    const expectedVendorItemIds = [...new Set(
      (input.expectedStopVendorItemIds ?? vendorItemIds).map((value) => String(value).trim()).filter(Boolean),
    )];
    const everyItemBound = items.length > 0
      && rawVendorItemIds.every(Boolean)
      && vendorItemIds.length === items.length;
    const expectedSetMatches = [...vendorItemIds].sort().join("\u0000")
      === [...expectedVendorItemIds].sort().join("\u0000");
    const vendorItemReadbacks = await Promise.all(vendorItemIds.map(async (vendorItemId) => ({
      vendorItemId,
      remote: await input.readVendorItem(vendorItemId),
    })));
    const vendorStates = vendorItemReadbacks.map(({ remote }) => {
      const root = record(remote.data.data);
      const data = Object.keys(root).length ? root : remote.data;
      return remoteAccepted(remote) ? strictProviderBoolean(data.onSale) : undefined;
    });
    const allOffSale = vendorStates.length === vendorItemIds.length
      && vendorStates.length > 0
      && vendorStates.every((onSale) => onSale === false);
    const identityVerified = remoteAccepted(sellerProductReadback)
      && sellerProductId === input.remoteId
      && everyItemBound
      && expectedSetMatches;
    if (!identityVerified || !allOffSale || input.expected.imageCount !== 0) {
      return {
        sellerProductReadback,
        vendorItemReadbacks,
        failureCode: "COUPANG_VENDOR_ITEM_STOP_READBACK_UNVERIFIED",
      };
    }
    return {
      sellerProductReadback,
      vendorItemReadbacks,
      state: buildVerifiedState({
        visibility: "withdrawn",
        providerStatus: `onSale=${vendorStates.join(",")}`,
        verifiedAt: input.verifiedAt,
        resources: { sellerProductId: input.remoteId, vendorItemIds },
        locale,
        fingerprint: input.expected.fingerprint,
        imageCount: 0,
        evidence: {
          identitySource: "seller_product_and_all_vendor_item_inventory_paths",
          vendorItemCount: vendorItemIds.length,
          vendorItemOnSale: vendorStates,
          readbackDigest: sha256({ sellerProductId, vendorItemIds, vendorStates }),
        },
      }),
    };
  }

  const sellerProductReadback = await input.readSellerProduct(input.remoteId);
  const sellerProduct = coupangSellerProductData(sellerProductReadback);
  const sellerProductId = String(sellerProduct.sellerProductId ?? "").trim();
  const requested = strictProviderBoolean(sellerProduct.requested);
  const status = coupangStatusFamily(
    sellerProduct.statusName
      ?? sellerProduct.approvalStatus
      ?? sellerProduct.status
      ?? sellerProduct.mdId,
  );
  const items = records(sellerProduct.items);
  const detailImageCounts = items.map((item) => coupangDetailImageUrls(item).length);
  const imageCountVerified = detailImageCounts.length > 0
    && detailImageCounts.every((count) => count === input.expected.imageCount);
  const rawVendorItemIds = items.map((item) => String(item.vendorItemId ?? "").trim());
  const vendorItemIds = [...new Set(rawVendorItemIds.filter(Boolean))];
  const everyItemBound = items.length > 0
    && rawVendorItemIds.every(Boolean)
    && vendorItemIds.length === items.length;
  const vendorItemReadbacks = await Promise.all(vendorItemIds.map(async (vendorItemId) => ({
    vendorItemId,
    remote: await input.readVendorItem(vendorItemId),
  })));
  const vendorStates = vendorItemReadbacks.map(({ remote }) => {
    const root = record(remote.data.data);
    const data = Object.keys(root).length ? root : remote.data;
    return remoteAccepted(remote) ? strictProviderBoolean(data.onSale) : undefined;
  });
  const vendorStatesVerified = vendorStates.every((state) => state !== undefined);
  const allOnSale = vendorStates.length > 0 && vendorStates.every((state) => state === true);
  const allOffSale = vendorStates.length > 0 && vendorStates.every((state) => state === false);
  const identityVerified = remoteAccepted(sellerProductReadback) && sellerProductId === input.remoteId;
  const requestedVerified = requested !== undefined;

  let visibility: VerifiedListingRemoteState["visibility"] | undefined;
  if (status.family === "rejected") visibility = "rejected";
  else if (status.family === "withdrawn") visibility = "withdrawn";
  else if (status.family === "approved"
      && requested === true
      && everyItemBound
      && vendorStatesVerified
      && allOnSale) visibility = "live";
  else if (status.family === "approved" && allOffSale) visibility = "non_public";
  else if (status.family === "approved" && vendorItemIds.length === 0) visibility = undefined;
  else if (status.family === "pending" || requested === true) visibility = "pending_review";
  else if (status.family === "draft" && requested === false && !allOnSale) visibility = "non_public";

  if (!visibility
      || !identityVerified
      || !requestedVerified
      || (visibility === "live" && !everyItemBound)
      || !imageCountVerified
      || !vendorStatesVerified) {
    return {
      sellerProductReadback,
      vendorItemReadbacks,
      failureCode: "COUPANG_PUBLICATION_READBACK_UNVERIFIED",
    };
  }

  const providerStatus = `${status.status}|requested=${String(requested)}|onSale=${vendorStates.length ? vendorStates.join(",") : "none"}`;
  return {
    sellerProductReadback,
    vendorItemReadbacks,
    state: buildVerifiedState({
      visibility,
      providerStatus,
      verifiedAt: input.verifiedAt,
      resources: { sellerProductId: input.remoteId, vendorItemIds },
      locale,
      fingerprint: input.expected.fingerprint,
      imageCount: input.expected.imageCount,
      evidence: {
        requested,
        sellerProductStatus: status.status,
        vendorItemCount: vendorItemIds.length,
        vendorItemOnSale: vendorStates,
        detailImageCounts,
        readbackDigest: sha256({
          sellerProductId,
          requested,
          status: status.status,
          vendorItemIds,
          vendorStates,
          detailImageCounts,
        }),
      },
    }),
  };
}

function htmlImageUrls(value: unknown) {
  const html = typeof value === "string" ? value : "";
  const urls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu)) {
    const url = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (url) urls.push(url);
  }
  return [...new Set(urls)];
}

export type SmartstoreListingPublicationReadback = {
  state?: VerifiedListingRemoteState;
  originProductReadback: RemoteResponse;
  channelProductReadback?: RemoteResponse;
  failureCode?: string;
};

/**
 * Performs the official v2 origin-product GET and requires both the origin
 * sale state and SmartStore channel display state before normalizing exposure.
 */
export async function readSmartstoreListingPublicationState(input: {
  operation: ListingMutationOperation;
  intent?: ListingPublicationIntent;
  remoteId: string;
  expected: ListingPublicationReadbackExpectation;
  readOriginProduct: (originProductNo: string) => Promise<RemoteResponse>;
  readChannelProduct?: (channelProductNo: string) => Promise<RemoteResponse>;
  verifiedAt?: string;
}): Promise<SmartstoreListingPublicationReadback> {
  const originProductReadback = await input.readOriginProduct(input.remoteId);
  const locale = listingExpectedPublicationLocale("smartstore", "KR");
  const originProduct = record(originProductReadback.data.originProduct);
  const channelProduct = record(originProductReadback.data.smartstoreChannelProduct);
  const responseOriginProductNo = String(
    originProductReadback.data.originProductNo
      ?? originProduct.originProductNo
      ?? "",
  ).trim();
  const responseChannelProductNo = String(
    originProductReadback.data.smartstoreChannelProductNo
      ?? channelProduct.channelProductNo
      ?? "",
  ).trim();
  const channelProductReadback = responseChannelProductNo && input.readChannelProduct
    ? await input.readChannelProduct(responseChannelProductNo)
    : undefined;
  const authoritativeChannelWrapper = channelProductReadback?.data ?? {};
  const officialSmartstoreChannelProduct = record(authoritativeChannelWrapper.smartstoreChannelProduct);
  const authoritativeChannelProduct = input.readChannelProduct
    ? officialSmartstoreChannelProduct
    : channelProduct;
  const authoritativeChannelProductNo = String(
    authoritativeChannelProduct.channelProductNo
      ?? authoritativeChannelProduct.smartstoreChannelProductNo
      ?? authoritativeChannelWrapper.smartstoreChannelProductNo
      ?? responseChannelProductNo,
  ).trim();
  const authoritativeOriginProductNo = String(
    authoritativeChannelProduct.originProductNo
      ?? authoritativeChannelWrapper.originProductNo
      ?? input.remoteId,
  ).trim();
  const originStatus = String(originProduct.statusType ?? "").trim().toUpperCase();
  const channelStatus = String(
    input.readChannelProduct
      ? (authoritativeChannelProduct.channelProductDisplayStatusType
        ?? authoritativeChannelProduct.displayStatusType
        ?? "")
      : (channelProduct.channelProductDisplayStatusType ?? ""),
  ).trim().toUpperCase();
  const authoritativeChannelTitle = String(
    authoritativeChannelProduct.channelProductName ?? "",
  ).trim();
  const detailImageUrls = htmlImageUrls(originProduct.detailContent);
  const identityVerified = remoteAccepted(originProductReadback)
    && (!responseOriginProductNo || responseOriginProductNo === input.remoteId)
    && Object.keys(originProduct).length > 0
    && (!input.readChannelProduct
      || Boolean(channelProductReadback
        && remoteAccepted(channelProductReadback)
        && Object.keys(officialSmartstoreChannelProduct).length > 0
        && authoritativeChannelProductNo === responseChannelProductNo
        && authoritativeOriginProductNo === input.remoteId
        && authoritativeChannelTitle.length > 0
        && channelStatus.length > 0));
  const localeVerified = locale === input.expected.locale;
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expected.fingerprint);
  const imageCountVerified = input.operation === "listing.stop"
    ? input.expected.imageCount === 0
    : detailImageUrls.length === input.expected.imageCount;

  let visibility: VerifiedListingRemoteState["visibility"] | undefined;
  if (originStatus === "SALE" && channelStatus === "ON") visibility = "live";
  else if (originStatus === "OUTOFSTOCK" && channelStatus === "ON") visibility = "non_public";
  else if (originStatus === "SUSPENSION" || channelStatus === "SUSPENSION") {
    visibility = input.operation === "listing.stop" ? "withdrawn" : "non_public";
  } else if (originStatus === "WAIT" || channelStatus === "WAIT") visibility = "pending_review";
  else if (["UNADMISSION", "REJECTION", "PROHIBITION"].includes(originStatus)) visibility = "rejected";
  else if (["CLOSE", "DELETE"].includes(originStatus)) visibility = "withdrawn";

  if (!visibility
      || !identityVerified
      || !locale
      || !localeVerified
      || !fingerprintVerified
      || !imageCountVerified
      || (input.operation === "listing.stop" && originStatus !== "SUSPENSION")) {
    return {
      originProductReadback,
      ...(channelProductReadback ? { channelProductReadback } : {}),
      failureCode: "SMARTSTORE_PUBLICATION_READBACK_UNVERIFIED",
    };
  }

  const resources: Record<string, unknown> = { originProductNo: input.remoteId };
  if (authoritativeChannelProductNo) resources.smartstoreChannelProductNo = authoritativeChannelProductNo;
  return {
    originProductReadback,
    ...(channelProductReadback ? { channelProductReadback } : {}),
    state: buildVerifiedState({
      visibility,
      providerStatus: `${originStatus}|${channelStatus || "UNKNOWN"}`,
      verifiedAt: input.verifiedAt,
      resources,
      locale,
      fingerprint: input.expected.fingerprint,
      imageCount: input.operation === "listing.stop" ? 0 : detailImageUrls.length,
      evidence: {
        identitySource: responseOriginProductNo ? "origin_product_response" : "origin_product_path",
        originProductStatus: originStatus,
        channelProductDisplayStatus: channelStatus,
        detailImageCount: detailImageUrls.length,
        readbackDigest: sha256({
          originProductNo: input.remoteId,
          responseOriginProductNo,
          responseChannelProductNo,
          authoritativeChannelProductNo,
          authoritativeOriginProductNo,
          originStatus,
          channelStatus,
          detailImageUrls,
        }),
      },
    }),
  };
}

export type EbayListingPublicationReadback = {
  state?: VerifiedListingRemoteState;
  offerReadback: RemoteResponse;
  inventoryItemReadback?: RemoteResponse;
  resolvedRemoteId: string;
  failureCode?: string;
};

/**
 * Performs only eBay Inventory API GETs. getOffer is authoritative for the
 * offer/listing exposure and getInventoryItem binds the offer to its SKU and
 * persisted product images.
 */
export async function readEbayListingPublicationState(input: {
  operation: ListingMutationOperation;
  intent?: ListingPublicationIntent;
  remoteId: string;
  offerId: string;
  expectedSku?: string;
  expectedMarketplaceId?: string;
  expectedListingId?: string;
  expected: ListingPublicationReadbackExpectation;
  readOffer: (offerId: string) => Promise<RemoteResponse>;
  readInventoryItem: (sku: string) => Promise<RemoteResponse>;
  verifiedAt?: string;
}): Promise<EbayListingPublicationReadback> {
  const offerReadback = await input.readOffer(input.offerId);
  const offer = offerReadback.data;
  const responseOfferId = String(offer.offerId ?? "").trim();
  const sku = String(offer.sku ?? "").trim();
  const marketplaceId = String(offer.marketplaceId ?? "").trim().toUpperCase();
  const market = marketplaceId.startsWith("EBAY_") ? marketplaceId.slice(5) : "";
  const locale = market ? listingExpectedPublicationLocale("ebay", market) : undefined;
  const inventoryItemReadback = sku ? await input.readInventoryItem(sku) : undefined;
  const inventoryItem = inventoryItemReadback?.data ?? {};
  const inventoryProduct = record(inventoryItem.product);
  const inventoryImageUrls = Array.isArray(inventoryProduct.imageUrls)
    ? [...new Set(inventoryProduct.imageUrls.map(String).map((value) => value.trim()).filter(Boolean))]
    : [];
  const detailImageUrls = htmlImageUrls(offer.listingDescription);
  const listing = record(offer.listing);
  const listingId = String(listing.listingId ?? "").trim();
  const offerStatus = String(offer.status ?? "").trim().toUpperCase();
  const listingStatus = String(listing.listingStatus ?? "").trim().toUpperCase();
  const expectedRemoteIds = new Set([input.offerId, listingId].filter(Boolean));
  const identityVerified = remoteAccepted(offerReadback)
    && responseOfferId === input.offerId
    && Boolean(sku)
    && Boolean(marketplaceId)
    && expectedRemoteIds.has(input.remoteId)
    && (!input.expectedSku || sku === input.expectedSku)
    && (!input.expectedMarketplaceId
      || marketplaceId === input.expectedMarketplaceId.trim().toUpperCase())
    && (!input.expectedListingId || listingId === input.expectedListingId)
    && Boolean(inventoryItemReadback && remoteAccepted(inventoryItemReadback));
  const localeVerified = Boolean(locale && locale === input.expected.locale);
  const fingerprintVerified = /^[a-f0-9]{64}$/u.test(input.expected.fingerprint);
  const imageCountVerified = input.operation === "listing.stop"
    ? input.expected.imageCount === 0
    : detailImageUrls.length === input.expected.imageCount && inventoryImageUrls.length > 0;

  let visibility: VerifiedListingRemoteState["visibility"] | undefined;
  if (offerStatus === "PUBLISHED" && listingId && listingStatus === "ACTIVE") visibility = "live";
  else if (offerStatus === "PUBLISHED" && listingId) visibility = "pending_review";
  else if (offerStatus === "UNPUBLISHED") {
    visibility = input.operation === "listing.stop" ? "withdrawn" : "non_public";
  }
  const resolvedRemoteId = (input.operation === "listing.create" || input.operation === "listing.update")
      && visibility === "live"
    ? listingId
    : input.remoteId;

  const failureCode = !visibility
    ? "EBAY_PUBLICATION_STATUS_UNVERIFIED"
    : !identityVerified
      ? "EBAY_PUBLICATION_IDENTITY_UNVERIFIED"
      : !locale || !localeVerified
        ? "EBAY_PUBLICATION_LOCALE_UNVERIFIED"
        : !fingerprintVerified
          ? "EBAY_PUBLICATION_FINGERPRINT_UNVERIFIED"
          : !imageCountVerified
            ? "EBAY_PUBLICATION_IMAGE_COUNT_UNVERIFIED"
            : input.operation === "listing.stop" && offerStatus !== "UNPUBLISHED"
              ? "EBAY_PUBLICATION_WITHDRAWAL_UNVERIFIED"
              : undefined;
  if (failureCode) {
    return {
      offerReadback,
      ...(inventoryItemReadback ? { inventoryItemReadback } : {}),
      resolvedRemoteId: input.remoteId,
      failureCode,
    };
  }
  if (!visibility || !locale) {
    return {
      offerReadback,
      ...(inventoryItemReadback ? { inventoryItemReadback } : {}),
      resolvedRemoteId: input.remoteId,
      failureCode: "EBAY_PUBLICATION_READBACK_UNVERIFIED",
    };
  }

  const state = buildVerifiedState({
    visibility,
    providerStatus: `${offerStatus}|${listingStatus || "NONE"}`,
    verifiedAt: input.verifiedAt,
    resources: {
      offerId: input.offerId,
      sku,
      marketplaceId,
      ...(listingId ? { listingId } : {}),
    },
    locale,
    fingerprint: input.expected.fingerprint,
    imageCount: input.operation === "listing.stop" ? 0 : detailImageUrls.length,
    evidence: {
      offerStatus,
      listingStatus: listingStatus || "NONE",
      detailImageCount: detailImageUrls.length,
      inventoryImageCount: inventoryImageUrls.length,
      readbackDigest: sha256({
        offerId: responseOfferId,
        sku,
        marketplaceId,
        offerStatus,
        listingId,
        listingStatus,
        detailImageUrls,
        inventoryImageUrls,
      }),
    },
  });
  return {
    offerReadback,
    inventoryItemReadback,
    resolvedRemoteId,
    state,
    ...(state ? {} : { failureCode: "EBAY_PUBLICATION_STATE_SCHEMA_INVALID" }),
  };
}
