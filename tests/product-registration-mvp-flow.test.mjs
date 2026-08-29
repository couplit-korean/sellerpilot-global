import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("the primary final-authoring action requires a succeeded first draft and never falls back to manual MVP", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.indexOf("const startAutomation = () =>");
  const end = page.indexOf("const totalPhotoCount =", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const action = page.slice(start, end);

  assert.match(action, /const aiReady = isStudioExecutionReady\(studioWorkerReadiness\)/);
  assert.match(action, /if \(!aiReady\)/);
  assert.match(action, /if \(!firstDraftGenerated[\s\S]*?!isProductResearchJobId\(sourceResearchJobId\)[\s\S]*?!productSourcePhotoSha256Pattern\.test\(sourceResearchPhotoSha256\)[\s\S]*?!sourceResearchLineageReceipt\)/);
  assert.match(action, /setStudioSubmissionMode\("ai"\)/);
  assert.match(action, /핵심 생활 설정샷 6개와 상세페이지 초안을 동시에 제작/);
  assert.doesNotMatch(action, /manualMvp|manual_mvp|competitorResearchBlocksAnalysis/);
});

test("a succeeded research job becomes Studio lineage and changing only the source input invalidates it", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const \[sourceResearchJobId, setSourceResearchJobId\] = useState\(""\)/);
  assert.match(page, /setSourceResearchJobId\(jobId\);\s*setSourceResearchPhotoSha256\(sourcePhotoSha256\);\s*setSourceResearchLineageReceipt\(lineageReceipt\);\s*setFirstDraftGenerated\(true\)/);
  assert.match(page, /if \(key === "researchInput"\) \{\s*setFirstDraftGenerated\(false\);\s*setSourceResearchJobId\(""\);\s*setSourceResearchPhotoSha256\(""\);\s*setSourceResearchLineageReceipt\(""\)/);
  assert.match(page, /const firstDraftReady = firstDraftGenerated[\s\S]*?isProductResearchJobId\(sourceResearchJobId\)[\s\S]*?productSourcePhotoSha256Pattern\.test\(sourceResearchPhotoSha256\)[\s\S]*?Boolean\(sourceResearchLineageReceipt\)/);
  assert.match(page, /sourceResearchJobId=\{sourceResearchJobId\}/);
  assert.match(page, /sourcePhotoFingerprint=\{sourceResearchPhotoSha256\}/);
  assert.match(page, /sourceResearchLineageReceipt=\{sourceResearchLineageReceipt\}/);
});

test("the UI names the human-review and concurrent final-authoring contract without blocking on price research", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /‘최종작성 시작’을 누르면 핵심 생활 설정샷 6개와 상세페이지 초안을 동시에 제작합니다/);
  assert.match(page, /동일상품 가격은 선택 참고 정보이며 제작을 막지 않습니다/);
  assert.match(page, /동일상품 가격은 별도 확인 중\(최종작성 가능\)/);
  assert.match(page, />최종작성 시작</);
  assert.match(page, /disabled=\{!registrationExecutionAvailable \|\| !firstDraftReady \|\| running \|\| researchingProduct \|\| photoSelectionsProcessing \|\| Boolean\(queuedJobId\)\}/);
});
