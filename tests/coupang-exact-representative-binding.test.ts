import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import {
  bindCoupangExactQaApprovedRepresentative,
  bindCoupangExactQaRecoveryArguments,
  coupangExactQaArgumentsForFingerprint,
  coupangExactQaRepresentativeBinding,
} from "../lib/channels/coupang-exact-qa-recovery";
import { normalizeMarketplaceImageBytes } from "../lib/channels/marketplace-images";
import {
  bindCoupangExactRepresentativeFromStorage,
} from "../lib/server-coupang-exact-representative";
import { createHash } from "node:crypto";

const jobId = "10000000-0000-4000-8000-000000000001";
const claimId = "10000000-0000-4000-8000-000000000002";
const squarePath = `results/${jobId}/claims/${claimId}/thumbnail-square.png`;

function generatedPaths() {
  return Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
    asset.id,
    `results/${jobId}/claims/${claimId}/${asset.file}`,
  ]));
}

function argumentsValue() {
  return bindCoupangExactQaRecoveryArguments({
    sellerpilotAssets: {
      galleryImageUrls: ["https://attacker.example/representative.jpg"],
      detailImageUrls: Array.from({ length: 8 }, (_, index) =>
        `https://cdn.example/detail-${index + 1}.jpg`),
    },
    body: { sellerProductId: 16356981734, items: [{}] },
  }, "listing.update");
}

test("server storage binding replaces arbitrary gallery input and binds source plus normalized digests", async () => {
  const bytes = await sharp({
    create: { width: 48, height: 32, channels: 3, background: "#335577" },
  }).png().toBuffer();
  const normalized = await normalizeMarketplaceImageBytes(bytes, "gallery-square");
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const contentSha256 = createHash("sha256").update(normalized).digest("hex");
  const signedUrl = `https://sellerpilot.supabase.co/storage/v1/object/sign/sellerpilot-ai/${squarePath}?token=signed`;
  const result = await bindCoupangExactRepresentativeFromStorage({
    argumentsValue: argumentsValue(),
    generatedImagePaths: generatedPaths(),
    storage: {
      download: async (path) => ({
        data: path === squarePath
          ? { size: bytes.byteLength, arrayBuffer: async () => bytes }
          : null,
        error: null,
      }),
      createSignedUrl: async () => ({ data: { signedUrl }, error: null }),
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const binding = coupangExactQaRepresentativeBinding(result.argumentsValue);
  assert.deepEqual(binding, {
    contract: "coupang_exact_qa_representative_v1",
    role: "gallery-representative",
    sourceBucket: "sellerpilot-ai",
    sourceObjectPath: squarePath,
    sourceSha256,
    normalizedObjectPath: `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`,
    contentSha256,
  });
  assert.deepEqual(
    (result.argumentsValue.sellerpilotAssets as Record<string, unknown>).galleryImageUrls,
    [signedUrl],
  );
  const fingerprintArguments = coupangExactQaArgumentsForFingerprint(
    result.argumentsValue,
  );
  assert.deepEqual(
    (fingerprintArguments.sellerpilotAssets as Record<string, unknown>).galleryImageUrls,
    [`sellerpilot-storage://${squarePath}`],
  );
});

test("near-match paths, external signed hosts, and normalized digest drift fail closed", () => {
  const base = {
    signedUrl: `https://sellerpilot.supabase.co/storage/v1/object/sign/sellerpilot-ai/${squarePath}?token=signed`,
    sourceObjectPath: squarePath,
    sourceSha256: "a".repeat(64),
    normalizedObjectPath: `normalized/bb/${"b".repeat(64)}.jpg`,
    contentSha256: "b".repeat(64),
  };
  for (const changed of [
    { sourceObjectPath: squarePath.replace("thumbnail-square.png", "hero.png") },
    { signedUrl: `https://attacker.example/storage/v1/object/sign/sellerpilot-ai/${squarePath}?token=signed` },
    { normalizedObjectPath: `normalized/cc/${"b".repeat(64)}.jpg` },
    { sourceSha256: "A".repeat(64) },
  ]) {
    assert.throws(
      () => bindCoupangExactQaApprovedRepresentative(
        argumentsValue(),
        { ...base, ...changed },
      ),
      /COUPANG_EXACT_QA_REPRESENTATIVE_INVALID/,
    );
  }
});
