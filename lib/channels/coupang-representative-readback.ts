import { createHash } from "node:crypto";

import {
  coupangExactQaRecoveryIdentity,
} from "./coupang-exact-qa-recovery";

export type CoupangProviderImageIdentity = {
  imageOrder: number;
  imageType: "REPRESENTATION" | "DETAIL";
  cdnPath: string;
  vendorPath: string;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function imageBasename(value: string) {
  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
  } catch {
    return decodeURIComponent(value.split(/[\\/]/u).at(-1) ?? "");
  }
}

function exactProviderImages(value: unknown): CoupangProviderImageIdentity[] {
  const current = recordValue(value);
  const items = Array.isArray(current.items) ? current.items.map(recordValue) : [];
  const item = items.length === 1 ? items[0] : null;
  const rawImages = item && Array.isArray(item.images)
    ? item.images.map(recordValue)
    : [];
  if (!item
      || exactText(current.sellerProductId)
        !== coupangExactQaRecoveryIdentity.sellerProductId
      || exactText(item.vendorItemId)
        !== coupangExactQaRecoveryIdentity.vendorItemId
      || rawImages.length !== 9) {
    throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_READBACK_INVALID");
  }
  return rawImages.map((image, index) => {
    const imageType = exactText(image.imageType).toUpperCase();
    const cdnPath = exactText(image.cdnPath);
    const vendorPath = exactText(image.vendorPath);
    if (Number(image.imageOrder) !== index
        || imageType !== (index === 0 ? "REPRESENTATION" : "DETAIL")
        || (!cdnPath && !vendorPath)) {
      throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_READBACK_INVALID");
    }
    return {
      imageOrder: index,
      imageType,
      cdnPath,
      vendorPath,
    } as CoupangProviderImageIdentity;
  });
}

function expectedContentDigests(argumentsValue: Record<string, unknown>) {
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const transport = Array.isArray(binding.providerTransportImages)
    ? binding.providerTransportImages.map(recordValue)
    : [];
  const digests = transport.map((image) => exactText(image.contentSha256));
  if (binding.contract !== "sellerpilot_publication_asset_binding_v1"
      || binding.providerImageSurface !== "gallery"
      || digests.length !== 9
      || digests.some((digest) => !/^[a-f0-9]{64}$/u.test(digest))
      || new Set(digests).size !== 9) {
    throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_BINDING_INVALID");
  }
  return digests;
}

export function coupangExactRepresentativePrewriteSnapshot(currentValue: unknown) {
  return exactProviderImages(currentValue);
}

export function coupangProviderImageSnapshotSha256(
  images: CoupangProviderImageIdentity[],
) {
  return createHash("sha256").update(images.map((image) => [
    image.imageOrder,
    image.imageType,
    image.cdnPath,
    image.vendorPath,
  ].join("\u001f")).join("\u001e")).digest("hex");
}

/**
 * Coupang's documented product-query response exposes only imageOrder,
 * imageType, cdnPath and vendorPath. It does not expose an asset id or digest.
 * Success is therefore limited to the exact content-addressed filenames sent
 * by this request. The fresh pre-write snapshot additionally proves that the
 * representative changed and all eight detail identities stayed unchanged.
 */
export function verifyCoupangExactRepresentativeReadback(input: {
  currentValue: unknown;
  prewriteImages: CoupangProviderImageIdentity[];
  argumentsValue: Record<string, unknown>;
}) {
  const postwriteImages = exactProviderImages(input.currentValue);
  const prewriteImages = input.prewriteImages;
  if (prewriteImages.length !== 9) {
    throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_PREWRITE_INVALID");
  }
  const expectedDigests = expectedContentDigests(input.argumentsValue);
  if (!postwriteImages.every((image, index) =>
    imageBasename(image.vendorPath) === `${expectedDigests[index]}.jpg`)) {
    throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_PROVIDER_IDENTITY_UNRESOLVED");
  }
  if (!postwriteImages.slice(1).every((image, index) => {
    const previous = prewriteImages[index + 1];
    return image.imageOrder === previous.imageOrder
      && image.imageType === previous.imageType
      && image.cdnPath === previous.cdnPath
      && image.vendorPath === previous.vendorPath;
  })) {
    throw new Error("COUPANG_EXACT_QA_DETAIL_IDENTITY_DRIFT");
  }
  const expectedRepresentativeBasename = `${expectedDigests[0]}.jpg`;
  const representativeAlreadyExpected =
    imageBasename(prewriteImages[0].vendorPath) === expectedRepresentativeBasename
    && prewriteImages[0].cdnPath.length > 0
    && prewriteImages[0].cdnPath === postwriteImages[0].cdnPath;
  // Coupang documents cdnPath as its authoritative CDN identity, while
  // vendorPath is only the vendor source path that Coupang downloads. A
  // vendorPath-only transition therefore cannot prove that the representative
  // stored by Coupang actually changed.
  const representativeChanged = prewriteImages[0].cdnPath.length > 0
    && postwriteImages[0].cdnPath.length > 0
    && prewriteImages[0].cdnPath !== postwriteImages[0].cdnPath;
  if (!representativeAlreadyExpected && !representativeChanged) {
    throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_NOT_CHANGED");
  }
  return {
    prewriteImages,
    postwriteImages,
    expectedContentSha256s: expectedDigests,
    providerReadbackSnapshotSha256:
      coupangProviderImageSnapshotSha256(postwriteImages),
    providerVendorBasenamesVerified: true,
    providerRepresentativeAlreadyExpected: representativeAlreadyExpected,
    providerRepresentativeChanged: representativeChanged,
    providerDetailImagesPreserved: true,
  };
}
