import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const mobileStylesUrl = new URL("../app/mobile-optimization.css", import.meta.url);
const commerceStylesUrl = new URL("../app/commerce-ux-refactor.css", import.meta.url);

test("registration keeps product research before required seller fields and uses the shared sale dropdown", async () => {
  const page = await readFile(pageUrl, "utf8");
  const researchPanelIndex = page.indexOf('className={`product-research-panel');
  const requiredSellerFieldsIndex = page.indexOf('className="product-context-section required-product-intake"');

  assert.notEqual(researchPanelIndex, -1);
  assert.notEqual(requiredSellerFieldsIndex, -1);
  assert.ok(researchPanelIndex < requiredSellerFieldsIndex);
  assert.match(page, /<span>판매 구성 <i>필수<\/i><\/span><select required value=\{intake\.packageContents\}/);
  assert.match(page, /<span>판매 구성<\/span><select[^>]*value=\{draft\.packageContents\}/);
  assert.equal(page.match(/productSaleConfigurations\.map\(/g)?.length, 2);
});

test("notification popover closes only on an outside pointer or Escape and cleans up both listeners", async () => {
  const page = await readFile(pageUrl, "utf8");
  const effectStart = page.indexOf("const closeOnOutside = (event: PointerEvent)");
  const effectEnd = page.indexOf("}, [notificationsOpen]);", effectStart);
  assert.notEqual(effectStart, -1);
  assert.notEqual(effectEnd, -1);
  const effect = page.slice(effectStart, effectEnd);

  assert.match(effect, /notificationRef\.current && !notificationRef\.current\.contains\(event\.target as Node\)\) setNotificationsOpen\(false\)/);
  assert.match(effect, /event\.key === "Escape"\) setNotificationsOpen\(false\)/);
  assert.match(effect, /document\.addEventListener\("pointerdown", closeOnOutside, true\)/);
  assert.match(effect, /document\.removeEventListener\("pointerdown", closeOnOutside, true\)/);
  assert.match(effect, /document\.addEventListener\("keydown", closeOnEscape\)/);
  assert.match(effect, /document\.removeEventListener\("keydown", closeOnEscape\)/);
  assert.match(page, /className="notification-wrap" ref=\{notificationRef\}/);
  assert.match(page, /aria-label="알림" aria-expanded=\{notificationsOpen\}/);
});

test("the same narrow registration and preview contract covers both target phone widths", async () => {
  const mobileStyles = await readFile(mobileStylesUrl, "utf8");
  for (const width of [390, 412]) assert.ok(width <= 720);

  assert.match(mobileStyles, /@media \(max-width: 720px\)[\s\S]*?\.registration-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /@media \(max-width: 720px\)[\s\S]*?\.registration-card > footer\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /\.registration-card > footer > button\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*44px/);
  assert.match(mobileStyles, /\.detail-preview-scroll\s*\{[^}]*overflow:\s*visible;[^}]*touch-action:\s*pan-y/);
  assert.match(mobileStyles, /\.detail-preview-canvas img\s*\{[^}]*pointer-events:\s*none/);
  assert.match(mobileStyles, /@media \(max-width: 720px\)[\s\S]*?\.registration-status\.long-analysis-connected,[\s\S]*?\.registration-status\.long-analysis-attention\s*\{[^}]*width:\s*100%;[^}]*white-space:\s*normal/);
});

test("mobile product analysis visibly waits for an in-flight competitor lookup without deadlocking unavailable results", async () => {
  const page = await readFile(pageUrl, "utf8");
  const mobileStyles = await readFile(mobileStylesUrl, "utf8");
  const commerceStyles = await readFile(commerceStylesUrl, "utf8");

  assert.match(page, /const competitorResearchBlocksAnalysis = isCompetitorResearchBlockingAnalysis\([\s\S]{0,160}pendingCompetitorBypassConfirmed/);
  assert.match(page, /if \(competitorResearchBlocksAnalysis\) \{[\s\S]{0,260}동일 상품 가격 확인이 끝난 뒤 상품 분석을 시작/);
  assert.match(page, /disabled=\{running \|\| researchingProduct \|\| photoSelectionsProcessing \|\| competitorResearchBlocksAnalysis \|\| Boolean\(queuedJobId\)\}/);
  assert.match(page, /동일상품 가격 확인 대기/);
  assert.match(page, /가격 확인 중/);
  assert.match(page, /가격 없이 계속/);
  assert.match(page, /setPendingCompetitorBypassConfirmed\(true\)/);
  assert.match(page, /setCompetitorResearchState\(invalidatedExistingContext \? "stale" : "idle"\)/);
  assert.match(page, /상품 식별정보가 변경되었습니다/);
  assert.match(commerceStyles, /@media \(max-width: 560px\)[\s\S]*?\.competitor-retry-actions\s*\{[^}]*width:\s*100%;[^}]*flex-direction:\s*column/);
  assert.match(commerceStyles, /@media \(max-width: 720px\)[\s\S]*?\.analysis-start-bar\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileStyles, /@media \(max-width: 720px\)[\s\S]*?\.analysis-start-bar\s*\{[^}]*bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileStyles, /\.upload-panel\.panel\s*\{[^}]*overflow:\s*visible/);
  assert.match(page, /AI 작업 큐에서 계속 처리되므로 다른 상품을 바로 올릴 수 있습니다/);
  assert.doesNotMatch(page, /서버에서 계속 처리되므로/);
});
