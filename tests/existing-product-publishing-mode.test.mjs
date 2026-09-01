import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("기존 상품의 채널 수정은 신규상품 0% 입력 대신 저장 원장 workbench로 이어진다", async () => {
  const source = await readFile(pageUrl, "utf8");
  const publishingStart = source.indexOf("function PublishingPage");
  const publishingEnd = source.indexOf("type ShipmentInput", publishingStart);
  assert.ok(publishingStart >= 0 && publishingEnd > publishingStart, "PublishingPage source boundary");
  const publishing = source.slice(publishingStart, publishingEnd);

  assert.match(publishing, /const existingProductEdit = Boolean\(initialProduct\?\.id\)/);
  assert.match(publishing, /aria-label=\{existingProductEdit \? "채널 상품 수정 단계" : "상품 등록 단계"\}/);
  assert.match(publishing, /existingProductEdit && initialProduct \? <section className="panel publishing-parallel-banner" aria-label="기존 상품 채널 수정 안내"/);
  assert.match(publishing, /저장된 원장과 승인 이미지가 일치하는지 읽은 뒤에만 채널별 실행 버튼이 열립니다/);

  const newProductGuard = publishing.indexOf("{!existingProductEdit && <>");
  const newProductIntake = publishing.indexOf('<section className="publishing-layout">', newProductGuard);
  const aiStudio = publishing.indexOf("<AiProductStudio", newProductIntake);
  const guardEnd = publishing.indexOf("</>}\n      <section className=\"publishing-stage-panel\" aria-label=\"3단계 카테고리와 채널 등록\"", aiStudio);
  const publishWorkbench = publishing.indexOf("<ProductPublishWorkbench", guardEnd);
  assert.ok(newProductGuard >= 0, "existing product guard exists");
  assert.ok(newProductIntake > newProductGuard, "new-product intake is guarded");
  assert.ok(aiStudio > newProductIntake && aiStudio < guardEnd, "AI generation is guarded with the new-product intake");
  assert.ok(publishWorkbench > guardEnd, "channel workbench remains reachable for existing products");
  assert.match(publishing.slice(guardEnd, publishWorkbench), /hidden=\{!existingProductEdit && activeStage !== 3\}/);
  assert.match(publishing.slice(publishWorkbench, publishWorkbench + 260), /productId=\{resolvedProductId\}/);
  assert.match(publishing, /id="channel-product-edit-workbench"/);
});

test("상품 상세의 채널 수정 라우팅은 정확한 productId를 계속 전달한다", async () => {
  const source = await readFile(pageUrl, "utf8");

  assert.match(source, /setPublishingProduct\(\{ id: product\.sourceId, name: product\.name \}\)/);
  assert.match(source, /\?view=publishing&productId=\$\{encodeURIComponent\(product\.sourceId\)\}/);
  assert.match(source, /pushState\(\{ view: "publishing", workspaceScope: workspaceRouteScope, productId: product\.sourceId \}/);
  assert.match(source, /initialProduct=\{publishingProduct\}/);
  assert.match(source, /resolvedProductId = analyzedProductId \?\? initialProduct\?\.id \?\? null/);
});
