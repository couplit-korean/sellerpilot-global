import { createHash } from "node:crypto";

import {
  bindSmartstoreExactQaApprovedRepresentative,
} from "./channels/smartstore-exact-qa-recovery";
import {
  type StudioGeneratedAssetEntry,
  validateStoredProductGeneratedAssetPaths,
} from "./studio-result-assets";

const smartstoreRepresentativeMaxBytes = 10 * 1024 * 1024;

export const smartstoreExactQaRepresentativeFailureCodes = [
  "generated_asset_manifest_invalid",
  "square_asset_missing",
  "storage_download_failed",
  "storage_download_size_invalid",
  "storage_signing_failed",
  "storage_read_failed",
  "representative_binding_invalid",
] as const;

export type SmartstoreExactQaRepresentativeFailureCode =
  typeof smartstoreExactQaRepresentativeFailureCodes[number];

type StorageDownloadData = {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type StorageResult<T> = {
  data: T | null;
  error: unknown;
};

export type SmartstoreExactQaRepresentativeStorage = {
  download(path: string): PromiseLike<StorageResult<StorageDownloadData>>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<StorageResult<{ signedUrl: string }>>;
};

type SmartstoreExactQaRepresentativeResult =
  | { ok: true; argumentsValue: Record<string, unknown> }
  | { ok: false; code: SmartstoreExactQaRepresentativeFailureCode };

export function smartstoreExactQaSquareAssetPath(
  assets: readonly StudioGeneratedAssetEntry[],
) {
  return assets.find(([id]) => id === "square")?.[1] ?? null;
}

/**
 * Resolves the representative image exclusively from the current product
 * ledger, then binds its exact Storage path and byte digest. Every failure is
 * fail-closed and classified without returning provider credentials, object
 * contents, or raw Storage errors to the browser.
 */
export async function bindSmartstoreExactQaRepresentativeFromStorage(input: {
  argumentsValue: Record<string, unknown>;
  generatedImagePaths: unknown;
  storage: SmartstoreExactQaRepresentativeStorage;
}): Promise<SmartstoreExactQaRepresentativeResult> {
  const generatedAssets = validateStoredProductGeneratedAssetPaths(
    input.generatedImagePaths,
  );
  if (!generatedAssets) {
    return { ok: false, code: "generated_asset_manifest_invalid" };
  }

  const representativePath = smartstoreExactQaSquareAssetPath(generatedAssets);
  if (!representativePath) {
    return { ok: false, code: "square_asset_missing" };
  }

  const [downloaded, signed] = await Promise.allSettled([
    Promise.resolve().then(() => input.storage.download(representativePath)),
    Promise.resolve().then(() => (
      input.storage.createSignedUrl(representativePath, 2 * 60 * 60)
    )),
  ]);
  if (downloaded.status === "rejected"
      || downloaded.value.error
      || !downloaded.value.data) {
    return { ok: false, code: "storage_download_failed" };
  }
  if (!Number.isSafeInteger(downloaded.value.data.size)
      || downloaded.value.data.size < 1
      || downloaded.value.data.size > smartstoreRepresentativeMaxBytes) {
    return { ok: false, code: "storage_download_size_invalid" };
  }
  if (signed.status === "rejected"
      || signed.value.error
      || !signed.value.data?.signedUrl) {
    return { ok: false, code: "storage_signing_failed" };
  }

  let representativeBytes: Buffer;
  try {
    representativeBytes = Buffer.from(await downloaded.value.data.arrayBuffer());
  } catch {
    return { ok: false, code: "storage_read_failed" };
  }
  if (representativeBytes.byteLength !== downloaded.value.data.size
      || representativeBytes.byteLength < 1
      || representativeBytes.byteLength > smartstoreRepresentativeMaxBytes) {
    return { ok: false, code: "storage_download_size_invalid" };
  }

  try {
    return {
      ok: true,
      argumentsValue: bindSmartstoreExactQaApprovedRepresentative(
        input.argumentsValue,
        {
          signedUrl: signed.value.data.signedUrl,
          sourceObjectPath: representativePath,
          sourceSha256: createHash("sha256").update(representativeBytes).digest("hex"),
        },
      ),
    };
  } catch {
    return { ok: false, code: "representative_binding_invalid" };
  }
}
