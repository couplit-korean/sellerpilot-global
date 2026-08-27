import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const mobileStylesUrl = new URL("../app/mobile-optimization.css", import.meta.url);

test("registration keeps product research before required seller fields and uses the shared sale dropdown", async () => {
  const page = await readFile(pageUrl, "utf8");
  const researchPanelIndex = page.indexOf('className={`product-research-panel');
  const requiredSellerFieldsIndex = page.indexOf('className="product-context-section required-product-intake"');

  assert.notEqual(researchPanelIndex, -1);
  assert.notEqual(requiredSellerFieldsIndex, -1);
  assert.ok(researchPanelIndex < requiredSellerFieldsIndex);
  assert.match(page, /<span>판매 구성 <i>필수<\/i><\/span><select required value=\{intake\.packageContents\}/);
  assert.match(page, /<span>판매 구성<\/span><select value=\{draft\.packageContents\}/);
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
});
