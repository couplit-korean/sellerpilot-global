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
    const remote = await input.readVendorItem(input.remoteId);
    const root = record(remote.data.data);
    const data = Object.keys(root).length ? root : remote.data;
    const onSale = strictProviderBoolean(data.onSale);
    const accepted = remoteAccepted(remote);
    if (!accepted || onSale === undefined || input.expected.imageCount !== 0) {
      return {
        vendorItemReadbacks: [{ vendorItemId: input.remoteId, remote }],
        failureCode: "COUPANG_VENDOR_ITEM_STOP_READBACK_UNVERIFIED",
      };
    }
    return {
      vendorItemReadbacks: [{ vendorItemId: input.remoteId, remote }],
      state: buildVerifiedState({
        visibility: onSale ? "live" : "withdrawn",
        providerStatus: `onSale=${String(onSale)}`,
        verifiedAt: input.verifiedAt,
        resources: { vendorItemId: input.remoteId },
        locale,
        fingerprint: input.expected.fingerprint,
        imageCount: 0,
        evidence: {
          identitySource: "vendor_item_inventory_path",
          onSale,
          readbackDigest: sha256({ vendorItemId: input.remoteId, onSale }),
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
  const vendorItemIds = [...new Set(items
    .map((item) => String(item.vendorItemId ?? "").trim())
    .filter(Boolean))];
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
  const anyOnSale = vendorStates.some((state) => state === true);
  const allOffSale = vendorStates.length > 0 && vendorStates.every((state) => state === false);
  const identityVerified = remoteAccepted(sellerProductReadback) && sellerProductId === input.remoteId;
  const requestedVerified = requested !== undefined;

  let visibility: VerifiedListingRemoteState["visibility"] | undefined;
  if (vendorStatesVerified && anyOnSale) visibility = "live";
  else if (status.family === "rejected") visibility = "rejected";
  else if (status.family === "withdrawn") visibility = "withdrawn";
  else if (status.family === "approved" && allOffSale) visibility = "non_public";
  else if (status.family === "approved" && vendorItemIds.length === 0) visibility = undefined;
  else if (status.family === "pending" || requested === true) visibility = "pending_review";
  else if (status.family === "draft" && requested === false && !anyOnSale) visibility = "non_public";

  if (!visibility
      || !identityVerified
      || !requestedVerified
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
