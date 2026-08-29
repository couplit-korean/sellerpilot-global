import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  manualProductIntakeJobRequestSchema,
  studioJobRequestSchema,
} from "../lib/ai-cli-contract";
import { validateVisibleSucceededProductResearchJob } from "../lib/product-studio-lineage";

const studioJobId = "11111111-1111-4111-8111-111111111111";
const researchJobId = "22222222-2222-4222-8222-222222222222";
const sourcePhotoSha256 = "a".repeat(64);
const lineageReceipt = "v1.test-lineage-payload.test-lineage-signature";

function requestPayload() {
  return {
    jobId: studioJobId,
    sourceResearchJobId: researchJobId,
    sourcePhotoFingerprint: sourcePhotoSha256,
    sourceResearchLineageReceipt: lineageReceipt,
    humanReviewConfirmed: true,
    manualFields: {
      researchInput: "판매자 확인 테스트 상품 1개",
      productName: "판매자 확인 테스트 상품",
      sellerSku: "MVP-LINEAGE-001",
      categoryHint: "일반상품",
      brandName: "테스트 브랜드",
      manufacturer: "테스트 제조사",
      countryOfOrigin: "Republic of Korea",
      material: "판매자 확인 소재",
      packageContents: "상품 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 2_000,
      currency: "KRW",
      stock: 1,
      weightKg: 0.5,
      packageLengthCm: 10,
      packageWidthCm: 10,
      packageHeightCm: 10,
      description: "사람이 1차 분석 결과를 확인하고 수정한 상품 설명입니다.",
      productUrl: "",
      imageRightsConfirmed: true,
      productFactsConfirmed: true,
    },
    imagePaths: ["owner/job/input/normalized/0.jpg"],
    imageSpecs: [{
      name: "0.jpg",
      role: "main",
      originalName: "0.png",
      originalBytes: 500_000,
      originalMediaType: "image/png",
      originalPath: "owner/job/input/original/0.source",
      originalWidth: 1_600,
      originalHeight: 900,
      width: 1_200,
      height: 1_200,
      bytes: 400_000,
      mediaType: "image/jpeg",
      fit: "contain",
    }],
  };
}

test("studio request requires a distinct completed product-research job id", () => {
  assert.equal(studioJobRequestSchema.safeParse(requestPayload()).success, true);
  assert.equal(studioJobRequestSchema.safeParse({
    ...requestPayload(),
    humanReviewConfirmed: false,
  }).success, false);
  const unreviewedPayload: Record<string, unknown> = { ...requestPayload() };
  Reflect.deleteProperty(unreviewedPayload, "humanReviewConfirmed");
  assert.equal(studioJobRequestSchema.safeParse(unreviewedPayload).success, false);
  assert.equal(studioJobRequestSchema.safeParse({
    ...requestPayload(),
    sourceResearchJobId: undefined,
  }).success, false);
  assert.equal(studioJobRequestSchema.safeParse({
    ...requestPayload(),
    sourceResearchJobId: studioJobId,
  }).success, false);
  assert.equal(studioJobRequestSchema.safeParse({
    ...requestPayload(),
    sourcePhotoFingerprint: "b".repeat(63),
  }).success, false);
  assert.equal(studioJobRequestSchema.safeParse({
    ...requestPayload(),
    sourceResearchLineageReceipt: "",
  }).success, false);
});

test("manual intake keeps the shared photo contract without requiring AI lineage", () => {
  const manualPayload: Record<string, unknown> = { ...requestPayload() };
  Reflect.deleteProperty(manualPayload, "sourceResearchJobId");
  Reflect.deleteProperty(manualPayload, "humanReviewConfirmed");
  assert.equal(manualProductIntakeJobRequestSchema.safeParse(manualPayload).success, true);
  assert.equal(studioJobRequestSchema.safeParse(manualPayload).success, false);
});

test("source lineage accepts only the exact visible succeeded product-research job", () => {
  assert.deepEqual(validateVisibleSucceededProductResearchJob({
    expectedJobId: researchJobId,
    data: { id: researchJobId, kind: "product_research", status: "succeeded" },
    error: null,
  }), { valid: true });

  for (const [data, error, reason] of [
    [null, { code: "timeout" }, "read_failed"],
    [null, null, "not_visible"],
    [{ id: studioJobId, kind: "product_research", status: "succeeded" }, null, "identity_mismatch"],
    [{ id: researchJobId, kind: "product_studio", status: "succeeded" }, null, "wrong_kind"],
    [{ id: researchJobId, kind: "product_research", status: "running" }, null, "not_succeeded"],
  ] as const) {
    assert.deepEqual(validateVisibleSucceededProductResearchJob({
      expectedJobId: researchJobId,
      data,
      error,
    }), { valid: false, reason });
  }
});

test("product studio route checks lineage before image verification and persists the source id", async () => {
  const route = await readFile(new URL("../app/api/ai/product-studio/route.ts", import.meta.url), "utf8");
  const lineageRead = route.indexOf('p_id: parsed.data.sourceResearchJobId');
  const imageVerification = route.indexOf("const verified = download ? await verifyPreservedStudioImages");
  const enqueue = route.indexOf('p_kind: "product_studio"');

  assert.ok(lineageRead > 0 && lineageRead < imageVerification);
  assert.ok(imageVerification < enqueue);
  assert.match(route, /validateVisibleSucceededProductResearchJob/);
  assert.match(route, /verifyIssuedProductResearchLineageReceipt/);
  assert.match(route, /sha256PreservedStudioOriginalImage/);
  assert.match(route, /uploadedMainSourceSha256 !== parsed\.data\.sourcePhotoFingerprint/);
  assert.match(route, /source_research_job_id: parsed\.data\.sourceResearchJobId/);
  assert.match(route, /source_photo_sha256: parsed\.data\.sourcePhotoFingerprint/);
  assert.match(route, /human_review_confirmation:\s*\{[\s\S]{0,220}first_draft_reviewed: true[\s\S]{0,220}source: "authenticated_admin_request"/);
  assert.match(route, /HUMAN_REVIEW_REQUIRED/);
  assert.match(route, /SOURCE_RESEARCH_REQUIRED/);
  assert.match(route, /SOURCE_PHOTO_MISMATCH/);
  assert.match(route, /cleanupStudioUploadsOnlyWhenJobIsAbsent/);
});
