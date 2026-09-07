import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const publishWorkbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("the detail-page action requires six first-stage images plus explicit human review", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.indexOf("const startAutomation = () =>");
  const end = page.indexOf("const totalPhotoCount =", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const action = page.slice(start, end);

  assert.match(action, /const aiReady = isStudioExecutionReady\(studioWorkerReadiness\)/);
  assert.match(action, /if \(!aiReady\)/);
  assert.match(action, /if \(!firstDraftGenerated[\s\S]*?!isProductResearchJobId\(sourceResearchJobId\)[\s\S]*?!productSourcePhotoSha256Pattern\.test\(sourceResearchPhotoSha256\)[\s\S]*?!sourceResearchLineageReceipt[\s\S]*?firstDraftImages\.length !== coreFirstDraftAssetIds\.length\)/);
  assert.match(action, /if \(!firstDraftReviewed\)/);
  assert.match(action, /setStudioSubmissionMode\("ai"\)/);
  assert.match(action, /검토한 1차 정보와 이미지 6개를 바탕으로 상세페이지와 후속 자산을 제작/);
  assert.doesNotMatch(action, /manualMvp|manual_mvp|competitorResearchBlocksAnalysis/);
});

test("a succeeded research job becomes Studio lineage and changing only the source input invalidates it", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const \[sourceResearchJobId, setSourceResearchJobId\] = useState\(""\)/);
  assert.match(page, /setSourceResearchJobId\(jobId\);\s*setSourceResearchPhotoSha256\(sourcePhotoSha256\);\s*setSourceResearchLineageReceipt\(lineageReceipt\);\s*setFirstDraftGenerated\(true\)/);
  assert.match(page, /setFirstDraftImages\(generatedFirstDraftImages\)/);
  assert.match(page, /setFirstDraftReviewed\(false\)/);
  assert.match(page, /if \(key === "researchInput"\) \{\s*setFirstDraftGenerated\(false\);\s*setSourceResearchJobId\(""\);\s*setSourceResearchPhotoSha256\(""\);\s*setSourceResearchLineageReceipt\(""\)/);
  assert.match(page, /const firstDraftContentReady = firstDraftGenerated[\s\S]*?firstDraftImages\.length === coreFirstDraftAssetIds\.length/);
  assert.match(page, /const firstDraftReady = firstDraftContentReady && firstDraftReviewed/);
  assert.match(page, /sourceResearchJobId=\{sourceResearchJobId\}/);
  assert.match(page, /sourcePhotoFingerprint=\{sourceResearchPhotoSha256\}/);
  assert.match(page, /sourceResearchLineageReceipt=\{sourceResearchLineageReceipt\}/);
});

test("the UI names first-stage concurrency, human review, detail authoring, then upload", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /1차 생성에서 상품정보와 핵심 이미지 6개를 동시에 준비합니다/);
  assert.match(page, /상세페이지가 완료된 뒤에만 채널 업로드 단계가 열립니다/);
  assert.match(page, /동일상품 가격은 별도 확인 중/);
  assert.match(page, />상세페이지 제작 시작</);
  assert.match(page, /disabled=\{!registrationExecutionAvailable \|\| !firstDraftReady \|\| running \|\| researchingProduct \|\| recoveringProductResearch \|\| photoSelectionsProcessing \|\| Boolean\(queuedJobId\)\}/);
});

test("first-stage upload sends only the current main photo and approval follows editable seller fields", async () => {
  const page = await readFile(pageUrl, "utf8");
  const firstStageStart = page.indexOf("const researchProductInformation = async () =>");
  const firstStageEnd = page.indexOf("const selectSlotPhoto", firstStageStart);
  const firstStage = page.slice(firstStageStart, firstStageEnd);
  assert.match(firstStage, /const sourcePhotos = \[sourceMainPhoto\];\s*const uploaded = await optimizeAndUploadStudioPhotos\(\s*sourcePhotos,/);
  assert.doesNotMatch(firstStage, /const sourcePhotos = \[sourceMainPhoto, \.\.\.Object\.values\(slotPhotos\), \.\.\.extraPhotos\]/);

  const sellerFields = page.indexOf('className="product-context-section required-product-intake"');
  const approval = page.indexOf('className="first-draft-review"', sellerFields);
  const detailAction = page.indexOf('className={`analysis-start-bar', approval);
  assert.ok(sellerFields >= 0 && approval > sellerFields && detailAction > approval);
  assert.match(page.slice(approval, detailAction), /위 판매자 필수 입력값을 실물 기준으로 수정/);
});

test("editing a newly generated product closes its stale channel handoff without closing initialProduct edit", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /const closeGeneratedProductRegistration = useCallback\(\(\) => \{\s*if \(initialProduct\?\.id\) return;\s*setAnalyzedProductId\(null\);\s*\}, \[initialProduct\?\.id, setAnalyzedProductId\]\)/);

  const templateStart = page.indexOf("const applyCommerceTemplate =");
  const intakeStart = page.indexOf("const setIntakeField =", templateStart);
  const intakeEnd = page.indexOf("const toPhoto =", intakeStart);
  assert.match(page.slice(templateStart, intakeStart), /if \(firstDraftGenerated\) \{\s*setFirstDraftReviewed\(false\);\s*closeGeneratedProductRegistration\(\)/);
  assert.match(page.slice(intakeStart, intakeEnd), /if \(firstDraftGenerated\) \{\s*setFirstDraftReviewed\(false\);\s*closeGeneratedProductRegistration\(\)/);
  assert.ok((page.match(/closeGeneratedProductRegistration\(\)/g) ?? []).length >= 4);
});

test("single and bulk channel writes fail closed until the complete image package exists", async () => {
  const workbench = await readFile(publishWorkbenchUrl, "utf8");
  assert.match(workbench, /const approvedDetailPageReady = Boolean\(context[\s\S]*?context\.detailPage\?\.version === context\.detailPage\?\.approvedVersion[\s\S]*?image\.id === entry\.role && image\.path === entry\.path/);
  assert.match(workbench, /const imagePackageReady = Boolean\(context[\s\S]*?!manualMvp[\s\S]*?marketplaceThumbnailCount >= marketplaceMinimumThumbnailCount[\s\S]*?approvedDetailPageReady/);
  assert.ok((workbench.match(/if \(!imagePackageReady\) \{\s*notify\(imagePackageBlockedMessage\);\s*return(?: false)?;/g) ?? []).length >= 2);
  assert.match(workbench, /className="publish-bulk-execute" disabled=\{bulkRunning \|\| bulkConfirming \|\| !imagePackageReady \|\| studioBlocked\}/);
  assert.match(workbench, /className=\{`publish-execute\$\{remoteUpdate \? " product-edit-remote-action" : ""\}`\}[\s\S]*?disabled=\{!imagePackageReady \|\| studioBlocked \|\| !credential/);
  assert.match(workbench, /채널 업로드 이미지 미완료 · 대표 \$\{marketplaceThumbnailCount\}\/\$\{marketplaceMinimumThumbnailCount\}장 · 승인 상세 \$\{approvedDetailManifest\?\.images\.length \?\? 0\}\/\$\{marketplaceChannelDetailImageCount\}장/);
  assert.match(workbench, /단일·일괄 채널 전송을 모두 차단합니다/);
});
