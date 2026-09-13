import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildFirstDraftImageQualityManifest,
  buildFirstDraftImageQualityReceipt,
  firstDraftImageAssetIds,
  firstDraftImageQualityManifestSchema,
  firstDraftImageQualityReceiptSchema,
  firstDraftImageReceiptReviewProfile,
  validateFirstDraftImageQualityManifest,
  validateFirstDraftImageQualityReceipt,
  type FirstDraftImageAssetId,
  type FirstDraftImageProductFacts,
} from "../../lib/first-draft-images";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sourcePhotoSha256 = hash("original photograph");
const productFacts: FirstDraftImageProductFacts = {
  schemaVersion: 1, name: "나랑드사이다 제로 500 ml", category: "식품 > 음료 > 탄산음료",
  brandName: "나랑드사이다", manufacturer: "동아오츠카(주)", countryOfOrigin: "대한민국",
  material: "사진에서 확인된 원재료", packageContents: "상품 1개",
  description: "사진에서 확인된 나랑드사이다 제로 500 ml 상품입니다.",
  summary: "원본 사진에서 확인한 상품명과 용량을 바탕으로 작성한 상품 설명입니다.",
  oneLine: "나랑드사이다 제로 500 ml", targetCustomer: "", features: ["500 ml 용기"],
  usage: [], cautions: [], specifications: [],
  classification: { displayName: "탄산음료", verificationStatus: "needs-review", evidence: "원본 사진에 근거해 상품 분류를 확인하는 중입니다.", isHealthFunctionalFood: null },
};

function receiptInput(assetId: FirstDraftImageAssetId) {
  return {
    assetId, productFacts, sourcePhotoSha256,
    sourceForegroundSha256: hash("verified foreground"),
    outputSha256: hash(`composite:${assetId}`), visualHash: Buffer.from(hash(`visual:${assetId}`), "hex"),
    sourceCompositeVerified: true, sourcePixelIdentityVerified: true,
    sceneSemanticVerified: true, duplicateVerified: true,
  };
}

function preparedInput(assetId: FirstDraftImageAssetId) {
  return { ...receiptInput(assetId), reviewProfile: "prepared-detail-v1" as const,
    batchReviewProfile: "prepared-detail-v1" as const,
    backgroundEvidence: { sha256: hash(`background:${assetId}`), bytes: 10000,
      observedNonMerchandiseProps: ["visible-window-frame"] },
  };
}

test("prepared detail receipts bind the explicit generation and batch policy and real background evidence", () => {
  const input = preparedInput("portrait");
  const receipt = buildFirstDraftImageQualityReceipt(input);
  assert.equal(receipt.version, 2);
  assert.equal(firstDraftImageReceiptReviewProfile(receipt), "prepared-detail-v1");
  assert.equal(validateFirstDraftImageQualityReceipt({ ...input, receipt }), true);
  assert.equal(validateFirstDraftImageQualityReceipt({ ...input, sourcePhotoSha256: hash("other source"), receipt }), false);
  assert.equal(validateFirstDraftImageQualityReceipt({ ...input, assetId: "wide", receipt }), false);
  assert.equal(validateFirstDraftImageQualityReceipt({ ...input, outputSha256: hash("different image"), receipt }), false);
  assert.equal(firstDraftImageQualityReceiptSchema.safeParse({ ...receipt, reviewProfile: undefined }).success, false);
  assert.equal(firstDraftImageQualityReceiptSchema.safeParse({ ...receipt, batchReviewProfile: "full-studio-v1" }).success, false);
  assert.equal(firstDraftImageQualityReceiptSchema.safeParse({ ...receipt, backgroundEvidence: undefined }).success, false);
  assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, batchReviewProfile: undefined }));
  assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, backgroundEvidence: undefined }));
  assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, reviewProfile: undefined }));
  assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, reviewProfile: "catalog-scenes" as never }));
  for (const field of ["sourceCompositeVerified", "sourcePixelIdentityVerified", "sceneSemanticVerified", "duplicateVerified"] as const) {
    assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, [field]: false }), field);
  }
  assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, backgroundEvidence: { ...input.backgroundEvidence, bytes: 0 } }));
  assert.throws(() => buildFirstDraftImageQualityReceipt({ ...input, backgroundEvidence: { ...input.backgroundEvidence, observedNonMerchandiseProps: ["same", "same"] } }));
});

test("a prepared receipt cannot masquerade as legacy full-studio by deleting its policy fields", () => {
  const input = preparedInput("portrait");
  const prepared = buildFirstDraftImageQualityReceipt(input);
  assert.equal(prepared.version, 2);
  if (prepared.version !== 2) throw new Error("expected prepared receipt");
  const { reviewProfile, batchReviewProfile, backgroundEvidence, ...common } = prepared;
  const downgraded = { ...common, version: 1 };
  assert.equal(validateFirstDraftImageQualityReceipt({ ...input, receipt: downgraded }), false);
  const legacy = buildFirstDraftImageQualityReceipt(receiptInput("portrait"));
  assert.equal(legacy.version, 1);
  assert.equal(firstDraftImageReceiptReviewProfile(legacy), "full-studio-v1");
  assert.equal(validateFirstDraftImageQualityReceipt({ ...input, receipt: legacy }), true);
  assert.notEqual(legacy.scenePlanSha256, prepared.scenePlanSha256);
  assert.equal(firstDraftImageQualityReceiptSchema.safeParse({ ...legacy, reviewProfile }).success, false);
});

test("eight-role manifests preserve prepared image digests and reject mixed batch policies", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const verifiedAssets = Object.fromEntries(firstDraftImageAssetIds.map((assetId) => {
    const input = preparedInput(assetId);
    return [assetId, { digest: input.outputSha256, verification: buildFirstDraftImageQualityReceipt(input) }];
  }));
  const manifest = buildFirstDraftImageQualityManifest({ jobId, productFacts, sourcePhotoSha256, verifiedAssets });
  assert.ok(manifest);
  const assetDigests = Object.fromEntries(firstDraftImageAssetIds.map((id) => [id, verifiedAssets[id].digest])) as Record<FirstDraftImageAssetId, string>;
  assert.equal(validateFirstDraftImageQualityManifest({ jobId, productFacts, sourcePhotoSha256, assetDigests, manifest }), true);
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.assets).map(([id, asset]) => [id, asset.digest])), assetDigests);
  const receipt = manifest.assets.portrait.verification;
  assert.equal(receipt.version, 2);
  if (receipt.version === 2) assert.deepEqual(receipt.backgroundEvidence.observedNonMerchandiseProps, ["visible-window-frame"]);
  const legacy = buildFirstDraftImageQualityReceipt(receiptInput("portrait"));
  assert.equal(buildFirstDraftImageQualityManifest({ jobId, productFacts, sourcePhotoSha256,
    verifiedAssets: { ...verifiedAssets, portrait: { digest: legacy.outputSha256, verification: legacy } },
  }), null);
  assert.equal(firstDraftImageQualityManifestSchema.safeParse({ ...manifest,
    assets: { ...manifest.assets, portrait: { digest: legacy.outputSha256, verification: legacy } },
  }).success, false);
});
