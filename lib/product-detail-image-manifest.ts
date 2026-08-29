import {
  aiDetailAssetIds,
  type AiDetailAssetId,
} from "./ai-generated-assets";
import { marketplaceChannelDetailImageCount } from "./channels/marketplace-image-contract";

export const productDetailAssetReferencePrefix = "sellerpilot-asset://";
export const productDetailImageManifestContract = "sellerpilot_detail_image_manifest_v1";
export const productDetailImageCount = marketplaceChannelDetailImageCount;

export const defaultProductDetailImageRoles = [
  "detail-overview",
  "detail-feature",
  "detail-use",
  "detail-package",
  "detail-routine",
  "detail-dimensions",
  "detail-contents",
  "detail-care",
] as const satisfies readonly AiDetailAssetId[];

export type ProductDetailImageManifestEntry = {
  role: AiDetailAssetId;
  path: string;
};

export type ProductDetailImageManifest = {
  contract: typeof productDetailImageManifestContract;
  algorithm: "sha256";
  digest: string;
  images: ProductDetailImageManifestEntry[];
};

export type ProductDetailImageDocumentEntry = {
  role: AiDetailAssetId;
  alt: string;
  blockId: string;
};

export type ProductDetailImageDocumentInspection =
  | { ok: true; images: ProductDetailImageDocumentEntry[] }
  | { ok: false; code: string; message: string };

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isProductDetailImageRole(value: unknown): value is AiDetailAssetId {
  return typeof value === "string"
    && (aiDetailAssetIds as readonly string[]).includes(value);
}

export function productDetailRoleFromAssetReference(value: unknown): AiDetailAssetId | null {
  if (typeof value !== "string" || !value.startsWith(productDetailAssetReferencePrefix)) return null;
  const role = value.slice(productDetailAssetReferencePrefix.length);
  return isProductDetailImageRole(role) ? role : null;
}

export function inspectProductDetailImageDocument(value: unknown): ProductDetailImageDocumentInspection {
  const data = recordValue(value);
  if (!data || !recordValue(data.root) || !Array.isArray(data.content)) {
    return { ok: false, code: "DETAIL_PAGE_DOCUMENT_INVALID", message: "상세페이지 문서 형식을 확인해 주세요." };
  }

  const imageBlocks = data.content.filter((block) => recordValue(block) && block.type === "ImageStoryBlock");
  if (imageBlocks.length !== productDetailImageCount) {
    return {
      ok: false,
      code: "DETAIL_PAGE_IMAGE_COUNT_INVALID",
      message: `히어로를 제외한 상세 이미지는 정확히 ${productDetailImageCount}장이어야 합니다.`,
    };
  }

  const images: ProductDetailImageDocumentEntry[] = [];
  const roles = new Set<AiDetailAssetId>();
  for (const block of imageBlocks) {
    const props = recordValue(block.props);
    const role = productDetailRoleFromAssetReference(props?.imageUrl);
    const alt = typeof props?.imageAlt === "string" ? props.imageAlt.trim() : "";
    const blockId = typeof props?.id === "string" ? props.id.trim() : "";
    const declaredRole = props?.imageRole;
    if (!role) {
      return {
        ok: false,
        code: "DETAIL_PAGE_IMAGE_REFERENCE_INVALID",
        message: "상세 이미지는 운영 자산 역할(sellerpilot-asset://detail-*)로 저장해야 합니다.",
      };
    }
    if (declaredRole !== undefined && declaredRole !== role) {
      return {
        ok: false,
        code: "DETAIL_PAGE_IMAGE_ROLE_MISMATCH",
        message: "상세 이미지 역할과 운영 자산 참조가 서로 일치해야 합니다.",
      };
    }
    if (!blockId || blockId.length > 120) {
      return { ok: false, code: "DETAIL_PAGE_IMAGE_BLOCK_ID_INVALID", message: "상세 이미지 블록 ID를 확인해 주세요." };
    }
    if (!alt || alt.length > 180) {
      return {
        ok: false,
        code: "DETAIL_PAGE_IMAGE_ALT_INVALID",
        message: "상세 이미지 8장 각각에 180자 이하의 대체텍스트가 필요합니다.",
      };
    }
    if (roles.has(role)) {
      return {
        ok: false,
        code: "DETAIL_PAGE_IMAGE_ROLE_DUPLICATED",
        message: "상세 이미지 8장은 서로 다른 역할이어야 합니다.",
      };
    }
    roles.add(role);
    images.push({ role, alt, blockId });
  }
  return { ok: true, images };
}

function validLocalizedRoleSelection(value: unknown): AiDetailAssetId[] | null {
  if (!Array.isArray(value) || value.length !== productDetailImageCount) return null;
  const roles = value.map((section) => recordValue(section)?.imageAsset);
  if (!roles.every(isProductDetailImageRole)) return null;
  const unique = [...new Set(roles as AiDetailAssetId[])];
  return unique.length === productDetailImageCount ? unique : null;
}

export function localizedProductDetailImageRoles(value: unknown): AiDetailAssetId[] {
  if (!Array.isArray(value)) return [...defaultProductDetailImageRoles];
  const listings = value
    .map(recordValue)
    .filter((listing): listing is Record<string, unknown> => Boolean(listing));
  const preferred = [
    ...listings.filter((listing) => listing.channel === "coupang" && listing.market === "KR"),
    ...listings.filter((listing) => listing.channel === "smartstore" && listing.market === "KR"),
    ...listings,
  ];
  for (const listing of preferred) {
    const roles = validLocalizedRoleSelection(listing.detailSections);
    if (roles) return roles;
  }
  return [...defaultProductDetailImageRoles];
}

export function canonicalProductDetailImageManifestInput(entries: readonly ProductDetailImageManifestEntry[]) {
  return entries.map((entry) => `${entry.role}\t${entry.path}`).join("\n");
}

export function parseProductDetailImageManifest(value: unknown): ProductDetailImageManifest | null {
  const manifest = recordValue(value);
  if (manifest?.contract !== productDetailImageManifestContract
      || manifest.algorithm !== "sha256"
      || typeof manifest.digest !== "string"
      || !/^[a-f0-9]{64}$/.test(manifest.digest)
      || !Array.isArray(manifest.images)
      || manifest.images.length !== productDetailImageCount) return null;
  const roles = new Set<AiDetailAssetId>();
  const paths = new Set<string>();
  const images: ProductDetailImageManifestEntry[] = [];
  for (const rawEntry of manifest.images) {
    const entry = recordValue(rawEntry);
    const role = entry?.role;
    const path = entry?.path;
    if (!isProductDetailImageRole(role)
        || typeof path !== "string"
        || !path
        || roles.has(role)
        || paths.has(path)) return null;
    roles.add(role);
    paths.add(path);
    images.push({ role, path });
  }
  return {
    contract: productDetailImageManifestContract,
    algorithm: "sha256",
    digest: manifest.digest,
    images,
  };
}
