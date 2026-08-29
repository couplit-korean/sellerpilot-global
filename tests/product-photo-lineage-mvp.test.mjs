import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, studio, researchRoute, studioRoute, lifecycle] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/ai/product-research/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/ai/product-studio/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/_publishing/product-research-lifecycle.ts", import.meta.url), "utf8"),
]);

test("first-draft generation requires and hashes the exact current main photo", () => {
  const research = page.slice(page.indexOf("const researchProductInformation = async"), page.indexOf("const selectSlotPhoto = async"));
  assert.match(research, /if \(!sourceMainPhoto\)/);
  assert.match(page, /crypto\.subtle\.digest\("SHA-256", await file\.arrayBuffer\(\)\)/);
  assert.match(research, /mainPhotoRef\.current\?\.file !== sourceMainPhoto\.file/);
  assert.match(research, /sourcePhotoFingerprint: sourcePhotoSha256/);
  assert.match(page, /!mainPhoto \|\| photoSelectionsProcessing/);
});

test("pending research v2 resumes only with the exact photo hash and signed receipt", () => {
  assert.match(lifecycle, /product-research-pending:v2/);
  assert.match(lifecycle, /record\.sourcePhotoSha256 !== sourcePhotoSha256/);
  assert.match(lifecycle, /typeof record\.lineageReceipt !== "string"/);
  assert.match(page, /setSourceResearchPhotoSha256\(sourcePhotoSha256\)/);
  assert.match(page, /setSourceResearchLineageReceipt\(lineageReceipt\)/);
  assert.match(page, /1차 분석 접수 응답이 유실되어 사진 연결 증명을 확인할 수 없습니다/);
  assert.match(page, /setSourceResearchPhotoSha256\(""\)/);
  assert.match(page, /setSourceResearchLineageReceipt\(""\)/);
});

test("the research route persists the photo hash and returns a receipt only after enqueue succeeds", () => {
  const creation = researchRoute.indexOf("createProductResearchJobWithLegacyFallback");
  const errorGuard = researchRoute.indexOf("if (error)", creation);
  const receiptIssuance = researchRoute.indexOf("issueProductResearchLineageReceipt({", errorGuard);
  const successResponse = researchRoute.indexOf("lineageReceipt,", receiptIssuance);
  assert.ok(creation > 0
    && errorGuard > creation
    && receiptIssuance > errorGuard
    && successResponse > receiptIssuance);
  assert.match(researchRoute, /issueProductResearchLineageReceipt/);
  assert.match(researchRoute, /sourcePhotoSha256: parsed\.data\.sourcePhotoFingerprint/);
});

test("final authoring sends and verifies signed lineage plus the re-hashed uploaded original", () => {
  assert.match(studio, /sourcePhotoFingerprint: normalizedSourcePhotoFingerprint/);
  assert.match(studio, /sourceResearchLineageReceipt: normalizedSourceResearchLineageReceipt/);
  const visibleRead = studioRoute.indexOf("validateVisibleSucceededProductResearchJob");
  const receiptVerification = studioRoute.indexOf("verifyIssuedProductResearchLineageReceipt", visibleRead + 1);
  const uploadVerification = studioRoute.indexOf("verifyPreservedStudioImages", receiptVerification + 1);
  const uploadedHash = studioRoute.indexOf("sha256PreservedStudioOriginalImage", uploadVerification + 1);
  const enqueue = studioRoute.indexOf('p_kind: "product_studio"', uploadedHash);
  assert.ok(visibleRead > 0 && receiptVerification > visibleRead);
  assert.ok(uploadVerification > receiptVerification && uploadedHash > uploadVerification && enqueue > uploadedHash);
  assert.match(studioRoute, /uploadedMainSourceSha256 !== parsed\.data\.sourcePhotoFingerprint/);
});
