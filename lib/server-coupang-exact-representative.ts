import { createHash } from "node:crypto";

import {
  bindCoupangExactQaApprovedRepresentative,
} from "./channels/coupang-exact-qa-recovery";
import { normalizeMarketplaceImageBytes } from "./channels/marketplace-images";
import {
  type StudioGeneratedAssetEntry,
  validateStoredProductGeneratedAssetPaths,
} from "./studio-result-assets";

const representativeMaxBytes = 10 * 1024 * 1024;

export const coupangExactRepresentativeFailureCodes = [
  "generated_asset_manifest_invalid",
  "square_asset_missing",
  "storage_download_failed",
  "storage_download_size_invalid",
  "storage_signing_failed",
  "storage_read_failed",
  "representative_normalization_failed",
  "representative_binding_invalid",
] as const;

export type CoupangExactRepresentativeFailureCode =
  typeof coupangExactRepresentativeFailureCodes[number];

type StorageDownloadData = {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type StorageResult<T> = { data: T | null; error: unknown };

export type CoupangExactRepresentativeStorage = {
  download(path: string): PromiseLike<StorageResult<StorageDownloadData>>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<StorageResult<{ signedUrl: string }>>;
};

type Result =
  | { ok: true; argumentsValue: Record<string, unknown> }
  | { ok: false; code: CoupangExactRepresentativeFailureCode };

export function coupangExactSquareAssetPath(
  assets: readonly StudioGeneratedAssetEntry[],
) {
  return assets.find(([id]) => id === "square")?.[1] ?? null;
}

export async function bindCoupangExactRepresentativeFromStorage(input: {
  argumentsValue: Record<string, unknown>;
  generatedImagePaths: unknown;
  storage: CoupangExactRepresentativeStorage;
}): Promise<Result> {
  const generatedAssets = validateStoredProductGeneratedAssetPaths(
    input.generatedImagePaths,
  );
  if (!generatedAssets) return { ok: false, code: "generated_asset_manifest_invalid" };
  const sourceObjectPath = coupangExactSquareAssetPath(generatedAssets);
  if (!sourceObjectPath) return { ok: false, code: "square_asset_missing" };

  const [downloaded, signed] = await Promise.allSettled([
    Promise.resolve().then(() => input.storage.download(sourceObjectPath)),
    Promise.resolve().then(() => input.storage.createSignedUrl(sourceObjectPath, 2 * 60 * 60)),
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

  let normalized: Buffer;
  try {
    normalized = await normalizeMarketplaceImageBytes(bytes, "gallery-square");
  } catch {
    return { ok: false, code: "representative_normalization_failed" };
  }
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const contentSha256 = createHash("sha256").update(normalized).digest("hex");
  try {
    return {
      ok: true,
      argumentsValue: bindCoupangExactQaApprovedRepresentative(
        input.argumentsValue,
        {
          signedUrl: signed.value.data.signedUrl,
          sourceObjectPath,
          sourceSha256,
          normalizedObjectPath: `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`,
          contentSha256,
        },
      ),
    };
  } catch {
    return { ok: false, code: "representative_binding_invalid" };
  }
}
