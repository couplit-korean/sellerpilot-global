import assert from "node:assert/strict";
import test from "node:test";

import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  bindSmartstoreExactQaRepresentativeFromStorage,
  smartstoreExactQaSquareAssetPath,
  type SmartstoreExactQaRepresentativeStorage,
} from "../lib/server-smartstore-exact-representative";
import { validateStoredProductGeneratedAssetPaths } from "../lib/studio-result-assets";

const jobId = "11111111-1111-4111-8111-111111111111";
const claimId = "22222222-2222-4222-8222-222222222222";
const representativePath =
  `results/${jobId}/claims/${claimId}/thumbnail-square.png`;
const representativeBytes = new Blob(["approved representative"], {
  type: "image/png",
});
const signedUrl =
  `https://sellerpilot.supabase.co/storage/v1/object/sign/sellerpilot-ai/${representativePath}?token=signed`;

function generatedImagePaths() {
  return Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
    asset.id,
    `results/${jobId}/claims/${claimId}/${asset.file}`,
  ]));
}

function exactArguments() {
  return {
    sellerpilotAssets: {
      galleryImageUrls: ["https://attacker.invalid/browser-candidate.png"],
      detailImageUrls: ["https://example.invalid/detail.png"],
    },
  };
}

function storage(overrides: Partial<SmartstoreExactQaRepresentativeStorage> = {}) {
  const value: SmartstoreExactQaRepresentativeStorage = {
    download: async (path) => ({
      data: path === representativePath ? representativeBytes : null,
      error: path === representativePath ? null : new Error("not found"),
    }),
    createSignedUrl: async (path, expiresIn) => ({
      data: path === representativePath && expiresIn === 7_200 ? { signedUrl } : null,
      error: path === representativePath && expiresIn === 7_200
        ? null
        : new Error("not signed"),
    }),
    ...overrides,
  };
  return value;
}

test("Smartstore exact representative resolves the canonical thumbnail-square asset", async () => {
  const generated = validateStoredProductGeneratedAssetPaths(generatedImagePaths());
  assert.ok(generated);
  assert.equal(smartstoreExactQaSquareAssetPath(generated), representativePath);

  const result = await bindSmartstoreExactQaRepresentativeFromStorage({
    argumentsValue: exactArguments(),
    generatedImagePaths: generatedImagePaths(),
    storage: storage(),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const assets = result.argumentsValue.sellerpilotAssets as Record<string, unknown>;
  assert.deepEqual(assets.galleryImageUrls, [signedUrl]);
  assert.deepEqual(assets.approvedGalleryImagePaths, [representativePath]);
  assert.deepEqual(
    assets.approvedGalleryImageSha256s,
    ["adde6cd3dcb1cfd6ced2dd2f021c5472886baa71c012629c7f3894e297e72098"],
  );
});

test("Smartstore exact representative rejects an invalid ledger before Storage", async () => {
  let storageCalls = 0;
  const neverStorage = storage({
    download: async () => {
      storageCalls += 1;
      throw new Error("must not download");
    },
    createSignedUrl: async () => {
      storageCalls += 1;
      throw new Error("must not sign");
    },
  });
  const paths = generatedImagePaths();
  paths.square = paths.square.replace("thumbnail-square.png", "square.png");
  const result = await bindSmartstoreExactQaRepresentativeFromStorage({
    argumentsValue: exactArguments(),
    generatedImagePaths: paths,
    storage: neverStorage,
  });
  assert.deepEqual(result, {
    ok: false,
    code: "generated_asset_manifest_invalid",
  });
  assert.equal(storageCalls, 0);
  assert.equal(smartstoreExactQaSquareAssetPath([]), null);
});

test("Smartstore exact representative classifies download, size, signing, and read failures", async () => {
  const cases: Array<[
    string,
    SmartstoreExactQaRepresentativeStorage,
    string,
  ]> = [
    [
      "download",
      storage({
        download: async () => ({ data: null, error: new Error("download failed") }),
      }),
      "storage_download_failed",
    ],
    [
      "download synchronous throw",
      storage({
        download: () => { throw new Error("download failed synchronously"); },
      }),
      "storage_download_failed",
    ],
    [
      "empty",
      storage({
        download: async () => ({ data: new Blob([]), error: null }),
      }),
      "storage_download_size_invalid",
    ],
    [
      "oversize",
      storage({
        download: async () => ({
          data: {
            size: 10 * 1024 * 1024 + 1,
            arrayBuffer: async () => new ArrayBuffer(0),
          },
          error: null,
        }),
      }),
      "storage_download_size_invalid",
    ],
    [
      "signing",
      storage({
        createSignedUrl: async () => ({ data: null, error: new Error("sign failed") }),
      }),
      "storage_signing_failed",
    ],
    [
      "signing synchronous throw",
      storage({
        createSignedUrl: () => { throw new Error("sign failed synchronously"); },
      }),
      "storage_signing_failed",
    ],
    [
      "read",
      storage({
        download: async () => ({
          data: {
            size: 10,
            arrayBuffer: async () => { throw new Error("read failed"); },
          },
          error: null,
        }),
      }),
      "storage_read_failed",
    ],
    [
      "size changed while reading",
      storage({
        download: async () => ({
          data: {
            size: 100,
            arrayBuffer: async () => new ArrayBuffer(1),
          },
          error: null,
        }),
      }),
      "storage_download_size_invalid",
    ],
  ];
  for (const [name, fakeStorage, expectedCode] of cases) {
    const result = await bindSmartstoreExactQaRepresentativeFromStorage({
      argumentsValue: exactArguments(),
      generatedImagePaths: generatedImagePaths(),
      storage: fakeStorage,
    });
    assert.deepEqual(result, { ok: false, code: expectedCode }, name);
  }
});

test("Smartstore exact representative keeps the signed URL and binding fences closed", async () => {
  const result = await bindSmartstoreExactQaRepresentativeFromStorage({
    argumentsValue: exactArguments(),
    generatedImagePaths: generatedImagePaths(),
    storage: storage({
      createSignedUrl: async () => ({
        data: { signedUrl: "https://attacker.invalid/representative.png?token=forged" },
        error: null,
      }),
    }),
  });
  assert.deepEqual(result, {
    ok: false,
    code: "representative_binding_invalid",
  });
});
