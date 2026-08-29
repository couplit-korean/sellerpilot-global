import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("first-stage 5xx handling clears only definite cleaned pre-enqueue failures", () => {
  assert.match(page, /type ProductResearchEnqueuePayload = \{[\s\S]*?code\?: string;[\s\S]*?reconciliationRequired\?: boolean;[\s\S]*?cleanupPending\?: boolean;/);
  assert.match(page, /definitiveProductResearchPreEnqueueFailureCodes = new Set\(\[[\s\S]*?"AI_WORKER_UNAVAILABLE"[\s\S]*?"PRODUCT_RESEARCH_LINEAGE_UNAVAILABLE"[\s\S]*?"PRODUCT_RESEARCH_PREFLIGHT_UNAVAILABLE"[\s\S]*?"PRODUCT_RESEARCH_ENQUEUE_FAILED"/);
  assert.match(page, /function productResearchPendingDisposition\([\s\S]*?payload\.reconciliationRequired === true \|\| payload\.cleanupPending === true\) return "preserve";[\s\S]*?payload\.cleanupPending === false[\s\S]*?definitiveProductResearchPreEnqueueFailureCodes\.has\(payload\.code\)\) return "clear";[\s\S]*?return "preserve";/);

  const fiveHundredHandler = page.match(/if \(response\.status >= 500\) \{[\s\S]*?\n {10}\}/)?.[0] ?? "";
  assert.match(fiveHundredHandler, /productResearchPendingDisposition\(response\.status, queued\) === "clear"/);
  assert.match(fiveHundredHandler, /window\.sessionStorage\.removeItem\(productResearchPendingStorageKey\)/);
  assert.match(fiveHundredHandler, /임시 업로드 정리도 완료/);
  assert.match(fiveHundredHandler, /접수 여부가 불명확하거나 임시 업로드 정리가 남아/);
  assert.doesNotMatch(page, /response\.status === 408 \|\| response\.status === 425 \|\| response\.status === 429 \|\| response\.status >= 500/);
});

test("first-stage uploads only the main photo while supporting photos invalidate review only", () => {
  assert.match(page, /const sourcePhotos = \[sourceMainPhoto\];[\s\S]*?optimizeAndUploadStudioPhotos\(\s*sourcePhotos,/);
  assert.doesNotMatch(page, /selectProductResearchSourcePhotos/);

  const supportingEffect = page.match(/useEffect\(\(\) => \{\s*const nextSelections = \[\.\.\.Object\.values\(slotPhotos\), \.\.\.extraPhotos\][\s\S]*?\}, \[closeGeneratedProductRegistration, extraPhotos, firstDraftGenerated, notify, slotPhotos\]\);/)?.[0] ?? "";
  assert.match(supportingEffect, /if \(!changed \|\| !firstDraftGenerated\) return;/);
  assert.match(supportingEffect, /setFirstDraftReviewed\(false\)/);
  assert.match(supportingEffect, /closeGeneratedProductRegistration\(\)/);
  assert.doesNotMatch(supportingEffect, /setFirstDraftGenerated\(false\)|setSourceResearchJobId\(""\)|setSourceResearchLineageReceipt\(""\)|setResearchResult\(null\)|removeItem\(productResearchPendingStorageKey\)/);
  assert.match(page, /invalidatedExistingContext = window\.sessionStorage\.getItem\(productResearchPendingStorageKey\) !== null/);
});

test("first-stage photo copy states the main-only contract honestly", () => {
  assert.match(page, /대표사진 1장과 판매페이지·모델명·카톡 설명으로 정보와 이미지 6개를 동시에 만듭니다/);
  assert.match(page, /상세페이지 제작 단계의 OCR·상품 근거에 사용합니다/);
  assert.match(page, /최대 100장 보관 · 1차는 대표사진 1장 · 추가 사진은 상세페이지 제작에 사용/);
  assert.match(page, /1차 입력 \{mainPhoto \? 1 : 0\}장/);
});
