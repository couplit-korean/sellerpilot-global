import { createHash } from "node:crypto";

import type { StudioGeneratedAssetEntry } from "./studio-result-assets";
import { validateStoredProductGeneratedAssetPaths } from "./studio-result-assets";

const representativeMaxBytes = 10 * 1024 * 1024;

type StorageDownloadData = {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type StorageResult<T> = { data: T | null; error: unknown };

export type ShopeeSgExactRepresentativeStorage = {
  download(path: string): PromiseLike<StorageResult<StorageDownloadData>>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<StorageResult<{ signedUrl: string }>>;
};

export type ShopeeSgExactRepresentativeFailureCode =
  | "generated_asset_manifest_invalid"
  | "square_asset_missing"
  | "storage_download_failed"
  | "storage_download_size_invalid"
  | "storage_signing_failed"
  | "storage_read_failed"
  | "representative_binding_invalid";

export function shopeeSgExactSquareAssetPath(
  assets: readonly StudioGeneratedAssetEntry[],
) {
  return assets.find(([id]) => id === "square")?.[1] ?? null;
}

/**
 * Replaces every browser-supplied representative image with the current
 * product ledger's approved square asset and binds both its Storage path and
 * byte digest before marketplace normalization.
 */
export async function bindShopeeSgExactRepresentativeFromStorage(input: {
  argumentsValue: Record<string, unknown>;
  generatedImagePaths: unknown;
  storage: ShopeeSgExactRepresentativeStorage;
}): Promise<
  | { ok: true; argumentsValue: Record<string, unknown> }
  | { ok: false; code: ShopeeSgExactRepresentativeFailureCode }
> {
  const generatedAssets = validateStoredProductGeneratedAssetPaths(
    input.generatedImagePaths,
  );
  if (!generatedAssets) {
    return { ok: false, code: "generated_asset_manifest_invalid" };
  }
  const representativePath = shopeeSgExactSquareAssetPath(generatedAssets);
  if (!representativePath) return { ok: false, code: "square_asset_missing" };

  const [downloaded, signed] = await Promise.allSettled([
    Promise.resolve().then(() => input.storage.download(representativePath)),
    Promise.resolve().then(() => input.storage.createSignedUrl(representativePath, 2 * 60 * 60)),
  ]);
  if (downloaded.status === "rejected" || downloaded.value.error || !downloaded.value.data) {
    return { ok: false, code: "storage_download_failed" };
  }
  if (!Number.isSafeInteger(downloaded.value.data.size)
      || downloaded.value.data.size < 1
      || downloaded.value.data.size > representativeMaxBytes) {
    return { ok: false, code: "storage_download_size_invalid" };
  }
  if (signed.status === "rejected" || signed.value.error || !signed.value.data?.signedUrl) {
    return { ok: false, code: "storage_signing_failed" };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await downloaded.value.data.arrayBuffer());
  } catch {
    return { ok: false, code: "storage_read_failed" };
  }
  if (bytes.byteLength !== downloaded.value.data.size
      || bytes.byteLength < 1
      || bytes.byteLength > representativeMaxBytes) {
    return { ok: false, code: "storage_download_size_invalid" };
  }

  const assets = input.argumentsValue.sellerpilotAssets;
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) {
    return { ok: false, code: "representative_binding_invalid" };
  }
  return {
    ok: true,
    argumentsValue: {
      ...input.argumentsValue,
      sellerpilotAssets: {
        ...assets,
        galleryImageUrls: [signed.value.data.signedUrl],
        approvedGalleryImagePaths: [representativePath],
        approvedGalleryImageSha256s: [
          createHash("sha256").update(bytes).digest("hex"),
        ],
      },
    },
  };
}
