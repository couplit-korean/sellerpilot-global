import { createHash } from "node:crypto";

import {
  ebayExactV101RepresentativeSourceObjectPath,
} from "./channels/ebay-exact-existing-qa-recovery";
import {
  type StudioGeneratedAssetEntry,
  validateStoredProductGeneratedAssetPaths,
} from "./studio-result-assets";

const representativeMaxBytes = 10 * 1024 * 1024;
const signedUrlTtlSeconds = 2 * 60 * 60;

export const ebayExactRepresentativeFailureCodes = [
  "generated_asset_manifest_invalid",
  "square_asset_missing",
  "storage_download_failed",
  "storage_download_size_invalid",
  "storage_signing_failed",
  "storage_read_failed",
  "representative_binding_invalid",
] as const;

export type EbayExactRepresentativeFailureCode =
  typeof ebayExactRepresentativeFailureCodes[number];

type StorageDownloadData = {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type StorageResult<T> = { data: T | null; error: unknown };

export type EbayExactRepresentativeStorage = {
  download(path: string): PromiseLike<StorageResult<StorageDownloadData>>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<StorageResult<{ signedUrl: string }>>;
};

type Result =
  | { ok: true; argumentsValue: Record<string, unknown> }
  | { ok: false; code: EbayExactRepresentativeFailureCode };

export function ebayExactSquareAssetPath(
  assets: readonly StudioGeneratedAssetEntry[],
) {
  return assets.find(([id]) => id === "square")?.[1] ?? null;
}

function exactSignedStorageUrl(value: unknown, sourceObjectPath: string) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9-]+\.supabase\.(?:co|in)$/u.test(url.hostname)
      && !url.port
      && !url.username
      && !url.password
      && !url.hash
      && decodeURIComponent(url.pathname)
        === `/storage/v1/object/sign/sellerpilot-ai/${sourceObjectPath}`
      && Boolean(url.searchParams.get("token"));
  } catch {
    return false;
  }
}

/**
 * Replaces every client gallery candidate with the current product ledger's
 * approved square source. The source bytes are read from private Storage and
 * hashed by the server, so neither the path nor digest is browser-controlled.
 */
export async function bindEbayExactRepresentativeFromStorage(input: {
  argumentsValue: Record<string, unknown>;
  generatedImagePaths: unknown;
  storage: EbayExactRepresentativeStorage;
}): Promise<Result> {
  const generatedAssets = validateStoredProductGeneratedAssetPaths(
    input.generatedImagePaths,
  );
  if (!generatedAssets) {
    return { ok: false, code: "generated_asset_manifest_invalid" };
  }
  const sourceObjectPath = ebayExactSquareAssetPath(generatedAssets);
  if (!sourceObjectPath) return { ok: false, code: "square_asset_missing" };
  if (sourceObjectPath !== ebayExactV101RepresentativeSourceObjectPath) {
    return { ok: false, code: "representative_binding_invalid" };
  }

  const [downloaded, signed] = await Promise.allSettled([
    Promise.resolve().then(() => input.storage.download(sourceObjectPath)),
    Promise.resolve().then(() => (
      input.storage.createSignedUrl(sourceObjectPath, signedUrlTtlSeconds)
    )),
  ]);
  if (downloaded.status === "rejected"
      || downloaded.value.error
      || !downloaded.value.data) {
    return { ok: false, code: "storage_download_failed" };
  }
  if (!Number.isSafeInteger(downloaded.value.data.size)
      || downloaded.value.data.size < 1
      || downloaded.value.data.size > representativeMaxBytes) {
    return { ok: false, code: "storage_download_size_invalid" };
  }
  if (signed.status === "rejected"
      || signed.value.error
      || !signed.value.data?.signedUrl) {
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
  const signedUrl = signed.value.data.signedUrl;
  if (!assets
      || typeof assets !== "object"
      || Array.isArray(assets)
      || !exactSignedStorageUrl(signedUrl, sourceObjectPath)) {
    return { ok: false, code: "representative_binding_invalid" };
  }
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    ok: true,
    argumentsValue: {
      ...input.argumentsValue,
      sellerpilotAssets: {
        ...assets,
        galleryImageUrls: [signedUrl],
        approvedGalleryImagePaths: [sourceObjectPath],
        approvedGalleryImageSha256s: [sourceSha256],
      },
    },
  };
}
