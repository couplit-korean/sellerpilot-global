import { createHash } from "node:crypto";
import {
  canonicalProductDetailImageManifestInput,
  inspectProductDetailImageDocument,
  isProductDetailImageRole,
  parseProductDetailImageManifest,
  productDetailImageCount,
  productDetailImageManifestContract,
  type ProductDetailImageManifest,
  type ProductDetailImageManifestEntry,
  type ProductDetailImagePathEntry,
} from "./product-detail-image-manifest";
import { validateStoredProductGeneratedAssetPaths } from "./studio-result-assets";
import { inspectStudioResultQuality } from "./studio-result-quality";

type ApprovedProductDetailManifest = {
  version: number;
  manifest: ProductDetailImageManifest;
};

type ApprovedProductDetailManifestResult =
  | { ok: true; value: ApprovedProductDetailManifest }
  | { ok: false; code: string };

export type ProductDetailDocumentAssetPathsResult =
  | { ok: true; value: ProductDetailImagePathEntry[] }
  | { ok: false; code: string };

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function resolveProductDetailDocumentAssetPaths(
  document: unknown,
  generatedImagePaths: unknown,
): ProductDetailDocumentAssetPathsResult {
  const inspection = inspectProductDetailImageDocument(document);
  if (!inspection.ok) return { ok: false, code: inspection.code };
  const generated = validateStoredProductGeneratedAssetPaths(generatedImagePaths);
  if (!generated) return { ok: false, code: "DETAIL_PAGE_GENERATED_PATHS_INVALID" };
  const generatedByRole = new Map<string, string>(generated);
  const paths = new Set<string>();
  const images: ProductDetailImagePathEntry[] = [];
  for (const image of inspection.images) {
    const path = generatedByRole.get(image.role);
    if (!path || paths.has(path)) {
      return { ok: false, code: "DETAIL_PAGE_ASSETS_UNRESOLVED" };
    }
    paths.add(path);
    images.push({ role: image.role, path });
  }
  return { ok: true, value: images };
}

export function approvedProductDetailManifestFromPublishContext(
  context: Record<string, unknown>,
): ApprovedProductDetailManifestResult {
  // Approval binds exact bytes, not production quality. Historical emergency
  // catalog/copy results must not become publishable merely by saving them.
  if (inspectStudioResultQuality(context.studioResult).blockedForPublication) {
    return { ok: false, code: "STUDIO_DEGRADED_RESULT_REGENERATION_REQUIRED" };
  }
  const detailPage = recordValue(context.detailPage);
  const version = Number(detailPage?.version);
  const approvedVersion = Number(detailPage?.approvedVersion);
  const manifest = parseProductDetailImageManifest(detailPage?.imageManifest);
  if (!Number.isSafeInteger(version) || version < 1 || approvedVersion !== version || !manifest) {
    return { ok: false, code: "DETAIL_PAGE_APPROVAL_REQUIRED" };
  }

  const documentAssets = resolveProductDetailDocumentAssetPaths(
    detailPage?.data,
    context.generatedImagePaths,
  );
  if (!documentAssets.ok) return documentAssets;
  const roles = new Set<string>();
  const paths = new Set<string>();
  const images: ProductDetailImageManifestEntry[] = [];
  for (const [index, entry] of manifest.images.entries()) {
    const { role, path, sourceSha256 } = entry;
    const documentEntry = documentAssets.value[index];
    if (documentEntry?.role !== role
        || documentEntry.path !== path
        || roles.has(role)
        || paths.has(path)) {
      return { ok: false, code: "DETAIL_PAGE_MANIFEST_PATH_MISMATCH" };
    }
    roles.add(role);
    paths.add(path);
    images.push({ role, path, sourceSha256 });
  }
  if (roles.size !== productDetailImageCount || paths.size !== productDetailImageCount) {
    return { ok: false, code: "DETAIL_PAGE_MANIFEST_INVALID" };
  }
  const digest = createHash("sha256")
    .update(canonicalProductDetailImageManifestInput(images), "utf8")
    .digest("hex");
  if (digest !== manifest.digest) {
    return { ok: false, code: "DETAIL_PAGE_MANIFEST_DIGEST_MISMATCH" };
  }
  return {
    ok: true,
    value: {
      version,
      manifest: {
        contract: productDetailImageManifestContract,
        algorithm: "sha256",
        digest,
        images,
      },
    },
  };
}

function stripClientImageTokens(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{SELLERPILOT_IMAGE:detail-[a-z-]+\}\}/g, "");
  }
  if (Array.isArray(value)) return value.map(stripClientImageTokens);
  const record = recordValue(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, stripClientImageTokens(item)]),
  );
}

export function bindMarketplaceArgumentsToApprovedDetailManifest(
  argumentsValue: Record<string, unknown>,
  approved: ApprovedProductDetailManifest,
  signedUrls: readonly string[],
) {
  if (signedUrls.length !== productDetailImageCount
      || signedUrls.some((url) => !url.startsWith("https://"))
      || new Set(signedUrls).size !== productDetailImageCount) {
    throw new Error("DETAIL_PAGE_MANIFEST_SIGNING_FAILED");
  }
  const next = stripClientImageTokens(structuredClone(argumentsValue)) as Record<string, unknown>;
  const assets = recordValue(next.sellerpilotAssets);
  if (!assets) throw new Error("DETAIL_PAGE_MARKETPLACE_ASSETS_REQUIRED");

  const rawSections = Array.isArray(assets.localizedDetailSections)
    ? assets.localizedDetailSections.map(recordValue)
    : [];
  if (rawSections.length !== productDetailImageCount || rawSections.some((section) => !section)) {
    throw new Error("DETAIL_PAGE_LOCALIZED_SECTIONS_INVALID");
  }
  const roles = approved.manifest.images.map((entry) => entry.role);
  const remainingRoles = new Set(roles);
  const sectionsInput = rawSections as Record<string, unknown>[];
  const assigned = new Map<number, ProductDetailImageManifestEntry["role"]>();
  sectionsInput.forEach((section, index) => {
    const requestedRole = typeof section?.imageAsset === "string" ? section.imageAsset : "";
    if (isProductDetailImageRole(requestedRole) && remainingRoles.has(requestedRole)) {
      assigned.set(index, requestedRole);
      remainingRoles.delete(requestedRole);
    }
  });
  const fallbackRoles = [...remainingRoles];
  sectionsInput.forEach((_section, index) => {
    // Preserve matched roles without consuming a role needed by a later
    // unmatched section, including its localized alternative text.
    if (assigned.has(index)) return;
    const fallbackRole = fallbackRoles.shift();
    if (fallbackRole) assigned.set(index, fallbackRole);
  });
  const sections: Record<string, unknown>[] = sectionsInput.map((section, index) => ({
    ...section,
    imageAsset: assigned.get(index),
  }));
  const sectionByRole = new Map(sections.map((section) => [section.imageAsset, section]));
  const altTexts = roles.map((role, index) => {
    const alt = sectionByRole.get(role)?.imageAltText;
    return typeof alt === "string" && alt.trim()
      ? alt.trim()
      : `상품 상세 이미지 ${index + 1}`;
  });

  next.sellerpilotAssets = {
    ...assets,
    ...(Array.isArray(assets.approvedGalleryImagePaths)
      && assets.approvedGalleryImagePaths.length === 1
      ? {
          galleryImageUrls: [
            `sellerpilot-storage://${String(assets.approvedGalleryImagePaths[0])}`,
          ],
        }
      : {}),
    contentMode: "ai_generated",
    detailAssetMode: "dedicated",
    detailImageUrls: [...signedUrls],
    detailImageRoles: roles,
    approvedDetailImagePaths: approved.manifest.images.map((entry) => entry.path),
    approvedDetailImageSha256s: approved.manifest.images.map((entry) => entry.sourceSha256),
    detailImageAltTexts: altTexts,
    localizedDetailSections: sections,
    approvedDetailPageVersion: approved.version,
    detailImageManifestDigest: approved.manifest.digest,
  };
  delete next.sellerpilotContentMode;
  return next;
}

export function marketplaceArgumentsForApprovedDetailFingerprint(
  argumentsValue: Record<string, unknown>,
  approved: ApprovedProductDetailManifest,
) {
  const next = structuredClone(argumentsValue);
  const assets = recordValue(next.sellerpilotAssets);
  if (!assets) throw new Error("DETAIL_PAGE_MARKETPLACE_ASSETS_REQUIRED");
  next.sellerpilotAssets = {
    ...assets,
    detailImageUrls: approved.manifest.images.map((entry) => `sellerpilot-storage://${entry.path}`),
    detailImageRoles: approved.manifest.images.map((entry) => entry.role),
    approvedDetailImagePaths: approved.manifest.images.map((entry) => entry.path),
    approvedDetailImageSha256s: approved.manifest.images.map((entry) => entry.sourceSha256),
    approvedDetailPageVersion: approved.version,
    detailImageManifestDigest: approved.manifest.digest,
  };
  return next;
}
