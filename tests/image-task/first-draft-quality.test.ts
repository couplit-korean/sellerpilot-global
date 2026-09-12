import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildFirstDraftImageQualityReceipt,
  buildFirstDraftStudioResult,
  firstDraftImageFactsMatchStudioRequest,
  firstDraftImageFactsMatchStudioResult,
  firstDraftImageAssetIds,
  firstDraftImageScenePlanSha256,
  firstDraftImageScenePlansMatchStudioResult,
  validateFirstDraftImageQualityReceipt,
  type FirstDraftImageProductFacts,
} from "../../lib/first-draft-images";
import { resolveProductImageStyleCategory } from "../../lib/ai-image-planning";

function facts(category: string, name = "검증 상품"): FirstDraftImageProductFacts {
  return {
    schemaVersion: 1,
    name,
    category,
    brandName: "검증브랜드",
    manufacturer: null,
    countryOfOrigin: null,
    material: null,
    packageContents: "본품 1개",
    description: "확인된 원본과 판매자 입력에서 확인한 설명입니다.",
    summary: "확인된 원본과 판매자 입력에서 확인한 상품 정보만 사용한 요약입니다.",
    oneLine: "확인된 상품 설명",
    targetCustomer: "",
    features: ["확인된 특징"],
    usage: [],
    cautions: [],
    specifications: [],
    classification: {
      displayName: category,
      verificationStatus: "needs-review",
      evidence: "건강기능식품 여부는 확인 전이므로 추가 확인 상태를 유지합니다.",
      isHealthFunctionalFood: null,
    },
  };
}

test("each supported category keeps six distinct first-draft role plans while uncertain supplements stay conservative", () => {
  const cases = [
    ["일반식품 / 음료", "food-staples"],
    ["화장품 / 스킨케어", "beauty-skincare"],
    ["남성 의류 상의", "men-tops"],
    ["일반 상품", "general-commerce"],
    ["건강기능식품 / 영양제", "general-commerce"],
  ] as const;
  for (const [category, expectedStyle] of cases) {
    const productFacts = facts(category);
    const studioResult = buildFirstDraftStudioResult(productFacts);
    assert.equal(resolveProductImageStyleCategory(studioResult).id, expectedStyle, category);
    const hashes = firstDraftImageAssetIds.map((assetId) => (
      firstDraftImageScenePlanSha256(productFacts, assetId)
    ));
    assert.equal(new Set(hashes).size, firstDraftImageAssetIds.length, category);
  }
});

test("quality receipts bind source, facts, scene role and final bytes and fail closed on mutation", () => {
  const productFacts = facts("일반식품 / 음료", "오트 시리얼");
  const sourcePhotoSha256 = "a".repeat(64);
  const outputSha256 = "b".repeat(64);
  const receipt = buildFirstDraftImageQualityReceipt({
    assetId: "portrait",
    productFacts,
    sourcePhotoSha256,
    sourceForegroundSha256: "c".repeat(64),
    outputSha256,
    visualHash: Buffer.alloc(32, 0x55),
    sourceCompositeVerified: true,
    sourcePixelIdentityVerified: true,
    sceneSemanticVerified: true,
    duplicateVerified: true,
  });
  assert.equal(validateFirstDraftImageQualityReceipt({
    assetId: "portrait",
    productFacts,
    sourcePhotoSha256,
    outputSha256,
    receipt,
  }), true);
  assert.equal(validateFirstDraftImageQualityReceipt({
    assetId: "portrait",
    productFacts,
    sourcePhotoSha256: "d".repeat(64),
    outputSha256,
    receipt,
  }), false);
  assert.equal(validateFirstDraftImageQualityReceipt({
    assetId: "portrait",
    productFacts: facts("화장품 / 스킨케어", "오트 시리얼"),
    sourcePhotoSha256,
    outputSha256,
    receipt,
  }), false);
  assert.equal(validateFirstDraftImageQualityReceipt({
    assetId: "wide",
    productFacts,
    sourcePhotoSha256,
    outputSha256,
    receipt,
  }), false);
  assert.equal(validateFirstDraftImageQualityReceipt({
    assetId: "portrait",
    productFacts,
    sourcePhotoSha256,
    outputSha256: "e".repeat(64),
    receipt,
  }), false);
});

test("second-stage reuse requires the same normalized product facts", () => {
  const productFacts = facts("화장품 / 스킨케어", "보습 크림");
  const result = buildFirstDraftStudioResult(productFacts);
  assert.equal(firstDraftImageFactsMatchStudioResult(productFacts, result), true);
  assert.equal(firstDraftImageFactsMatchStudioResult(productFacts, {
    product: { ...result.product, name: "다른 크림" },
  }), false);
  assert.equal(firstDraftImageFactsMatchStudioResult(productFacts, {
    product: { ...result.product, features: [...result.product.features, "확인되지 않은 효능"] },
  }), false);
  const manualFields = {
    productName: productFacts.name,
    categoryHint: productFacts.category,
    brandName: productFacts.brandName,
    manufacturer: productFacts.manufacturer,
    countryOfOrigin: productFacts.countryOfOrigin,
    material: productFacts.material,
    packageContents: productFacts.packageContents,
    description: productFacts.description,
  };
  assert.equal(firstDraftImageFactsMatchStudioRequest(productFacts, manualFields), true);
  assert.equal(firstDraftImageFactsMatchStudioRequest(productFacts, {
    ...manualFields,
    packageContents: "본품 2개",
  }), false);
  assert.equal(firstDraftImageScenePlansMatchStudioResult(productFacts, result), true);
});

test("the installed worker connects first draft to the final source-composite batch and defers upload until approval", async () => {
  const worker = await readFile(new URL("../../scripts/product-ai-worker.mjs", import.meta.url), "utf8");
  const lane = await readFile(new URL("../../scripts/first-draft-image-lane.mjs", import.meta.url), "utf8");
  assert.match(worker, /generateVerifiedAssets: generateVerifiedFirstDraftAssets/);
  assert.match(worker, /const generateVerifiedFirstDraftCandidate = generateDistinctAsset/);
  assert.match(worker, /await runDeterministicProductImageBatches\(\{/);
  assert.match(worker, /prepareIdentityCutoutsForJob\(/);
  assert.match(worker, /findProductImageBatchSemanticConflict\(/);
  assert.match(worker, /buildFirstDraftImageQualityReceipt\(/);
  assert.match(worker, /loadReusableFirstDraftAssets\(/);
  assert.match(worker, /firstDraftSourceResearchJobId/);
  assert.match(worker, /firstDraftImageScenePlansMatchStudioResult\(/);
  assert.match(worker, /firstDraftImageFactsMatchStudioResult\(/);
  assert.match(worker, /const remainingImagePresets = imagePresets\.filter\(\(preset\) => !reusableFirstDraftAssets\.has\(preset\.id\)\)/);
  assert.match(worker, /existingShots\.push\(reused\.fingerprint\)/);
  assert.match(lane, /Nothing is uploaded until every role has passed the same batch barrier/);
  assert.doesNotMatch(lane, /assets: \[\{ id: spec\.id/);
});

test("the claim producer transmits the verified six-asset reuse contract to the Mac consumer", async () => {
  const claim = await readFile(new URL("../../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../../scripts/product-ai-worker.mjs", import.meta.url), "utf8");
  assert.match(claim, /firstDraftImageFactsMatchStudioRequest\(productFacts\.data, jobRequest\.manual_fields\)/);
  assert.match(claim, /validateFirstDraftImageQualityManifest\(\{/);
  assert.match(claim, /JSON\.stringify\(storedManifest\.data\) !== JSON\.stringify\(requestManifest\.data\)/);
  assert.match(claim, /createSignedUrls\(entries\.map\(\(entry\) => entry\.path\), 60 \* 60\)/);
  assert.match(claim, /firstDraftSourceResearchJobId: sourceResearchJobId/);
  assert.match(claim, /reusableFirstDraftAssets,/);
  assert.match(worker, /job\.request\?\.firstDraftSourceResearchJobId/);
  assert.match(worker, /entry\.digest !== manifest\.data\.assets\[assetId\]\.digest/);
  assert.match(worker, /fingerprint\.digest !== entry\.digest/);
});
