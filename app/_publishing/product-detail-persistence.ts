import {
  inspectProductDetailImageDocument,
  productDetailAssetReferencePrefix,
  productDetailRoleFromAssetReference,
} from "../../lib/product-detail-image-manifest";

export { productDetailAssetReferencePrefix };

type PuckBlockLike = {
  type: string;
  props: Record<string, unknown>;
};

export type PersistablePuckData = {
  root: Record<string, unknown>;
  content: PuckBlockLike[];
};

export type PersistedProductDetailPage<T extends PersistablePuckData = PersistablePuckData> = {
  data: T;
  version: number;
  updatedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePersistedProductDetailPage<T extends PersistablePuckData = PersistablePuckData>(
  value: unknown,
): PersistedProductDetailPage<T> | null {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.root) || !Array.isArray(value.data.content)) return null;
  const version = typeof value.version === "number" ? value.version : Number(value.version);
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return {
    data: value.data as T,
    version,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function mapImageUrl<T extends PersistablePuckData>(
  data: T,
  mapper: (imageUrl: string) => string,
): T {
  return {
    ...data,
    root: { ...data.root },
    content: data.content.map((block) => {
      const imageUrl = block.props.imageUrl;
      if (typeof imageUrl !== "string" || !imageUrl) {
        return { ...block, props: { ...block.props } };
      }
      return { ...block, props: { ...block.props, imageUrl: mapper(imageUrl) } };
    }),
  };
}

export function makeProductDetailPersistable<T extends PersistablePuckData>(
  data: T,
  assetUrls: Record<string, string>,
) {
  const assetByUrl = new Map(
    Object.entries(assetUrls)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
      .map(([assetId, url]) => [url, assetId]),
  );
  return mapImageUrl(data, (imageUrl) => {
    const assetId = assetByUrl.get(imageUrl);
    return assetId ? `${productDetailAssetReferencePrefix}${assetId}` : imageUrl;
  });
}

export function makeValidatedProductDetailPersistable<T extends PersistablePuckData>(
  data: T,
  assetUrls: Record<string, string>,
) {
  const persistable = makeProductDetailPersistable(data, assetUrls);
  const inspection = inspectProductDetailImageDocument(persistable);
  if (!inspection.ok) throw new Error(inspection.message);
  const resolvedUrls = inspection.images.map((image) => assetUrls[image.role]?.trim() ?? "");
  if (resolvedUrls.some((url) => !url.startsWith("https://"))
      || new Set(resolvedUrls).size !== inspection.images.length) {
    throw new Error("상세 이미지 8장의 현재 운영 접근 경로를 모두 확인해 주세요.");
  }
  return persistable;
}

export function resolveProductDetailAssets<T extends PersistablePuckData>(
  data: T,
  assetUrls: Record<string, string>,
) {
  return {
    ...data,
    root: { ...data.root },
    content: data.content.map((block) => {
      const imageUrl = block.props.imageUrl;
      const assetId = typeof imageUrl === "string" && imageUrl.startsWith(productDetailAssetReferencePrefix)
        ? imageUrl.slice(productDetailAssetReferencePrefix.length)
        : "";
      if (!assetId) return { ...block, props: { ...block.props } };
      const role = productDetailRoleFromAssetReference(imageUrl);
      return {
        ...block,
        props: {
          ...block.props,
          ...(role ? { imageRole: role } : {}),
          imageUrl: assetUrls[assetId] ?? "",
        },
      };
    }),
  };
}
