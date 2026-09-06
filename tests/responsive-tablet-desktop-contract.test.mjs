import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mobileCss, workbenchCss, platformCss] = await Promise.all([
  readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  readFile(new URL("../app/product-publish-workbench.css", import.meta.url), "utf8"),
  readFile(new URL("../app/platform-usage-page.module.css", import.meta.url), "utf8"),
]);

test("large phones keep the global search action reachable", () => {
  assert.match(
    mobileCss,
    /@media \(min-width: 481px\) and \(max-width: 720px\)[\s\S]*?\.topbar-actions \.global-search \{[\s\S]*?display: inline-flex;[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/,
  );
});

test("tablet product ledgers retain table semantics with a bounded horizontal pan", () => {
  assert.match(
    mobileCss,
    /@media \(min-width: 721px\) and \(max-width: 900px\)[\s\S]*?\.product-table \{[\s\S]*?min-width: 760px;[\s\S]*?\.product-table \.product-cell \{[\s\S]*?min-width: 280px;/,
  );
  const tabletSuffix = mobileCss.slice(mobileCss.lastIndexOf("/* Keep the native table semantics on tablets"));
  assert.doesNotMatch(tabletSuffix, /\.product-table(?:,|\s*\{)[\s\S]*?display: block;/);
});

test("compact desktop grids fail soft before their intrinsic widths clip", () => {
  assert.match(
    mobileCss,
    /@media \(min-width: 901px\) and \(max-width: 1080px\)[\s\S]*?\.daily-briefing,[\s\S]*?\.studio-workspace \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    mobileCss,
    /@media \(min-width: 1081px\) and \(max-width: 1366px\)[\s\S]*?\.daily-briefing \{[\s\S]*?grid-template-columns: minmax\(260px, \.8fr\) minmax\(520px, 1\.4fr\);/,
  );
  assert.match(
    mobileCss,
    /@media \(min-width: 1181px\)[\s\S]*?\.order-summary-grid \{[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/,
  );
});

test("status rail and tablet support grids remain reachable", () => {
  const releaseQa = mobileCss.slice(mobileCss.lastIndexOf("/* Release QA:"));
  assert.match(
    releaseQa,
    /@media \(min-width: 901px\)[\s\S]*?\.commerce-service-rail \{[\s\S]*?overflow-x: auto;[\s\S]*?scrollbar-width: thin;[\s\S]*?::-webkit-scrollbar \{[\s\S]*?height: 4px;/,
  );
  assert.match(
    workbenchCss,
    /@media \(min-width: 601px\) and \(max-width: 900px\)[\s\S]*?\.product-edit-handoff ol \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    platformCss,
    /@media \(max-width: 900px\)[\s\S]*?\.apiGrid \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
});
