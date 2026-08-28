import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the integrated dashboard exposes compact live product price, margin, category and error facts", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /className="panel dashboard-product-readiness"/);
  assert.match(page, /상품별 가격 · 마진 · 카테고리 · 오류/);
  assert.match(page, /formatBaseSellingPrice\(product\)/);
  assert.match(page, /productMarginLabel\(product\)/);
  assert.match(page, /function dashboardProductCategoryLabel\(product:[\s\S]{0,500}category\.categoryPath\.map\(\(part\) => part\.trim\(\)\)\.filter\(Boolean\)\.join\(" › "\) \|\| category\.categoryId\.trim\(\)[\s\S]{0,200}return confirmedCategory \|\| product\.categoryHint \|\| "미입력"/);
  assert.match(page, /<small>상품군<\/small><b>\{dashboardProductCategoryLabel\(product\)\}<\/b>/);
  assert.doesNotMatch(page, /<small>상품군<\/small><b>\{product\.categoryHint \?\? "미입력"\}<\/b>/);
  assert.match(page, /product\.latestError \?\?/);
  assert.match(page, /\{operationsAvailable \? readinessProducts\.length > 0 \?/);
  assert.match(page, /실상품 원장을 확인 중/);
});

test("the live product summary remains legible at 390, 344 and 330 CSS pixels", async () => {
  const css = await readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 390px\)[\s\S]*?\.dashboard-product-readiness-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 344px\)[\s\S]*?\.dashboard-product-readiness-card\s*\{[^}]*padding:\s*10px/);
  assert.match(css, /@media \(max-width: 330px\)[\s\S]*?\.dashboard-product-readiness-facts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
