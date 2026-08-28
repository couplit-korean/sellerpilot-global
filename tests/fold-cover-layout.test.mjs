import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesUrl = new URL("../app/mobile-optimization.css", import.meta.url);

function mediaBody(styles, query) {
  const marker = `@media ${query}`;
  const start = styles.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);

  const openingBrace = styles.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return styles.slice(openingBrace + 1, index);
  }
  throw new Error(`unterminated ${marker}`);
}

test("Galaxy Fold cover widths compact the header without removing controls", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const cover = mediaBody(styles, "(max-width: 344px)");

  assert.match(cover, /body\s*\{[^}]*min-width:\s*0/);
  assert.match(cover, /\.topbar-title\s*\{[^}]*min-width:\s*44px;[^}]*flex:\s*1 1 auto/);
  assert.match(cover, /\.topbar-title > div\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto/);
  assert.match(cover, /\.topbar-actions\s*\{[^}]*min-width:\s*182px;[^}]*flex:\s*0 0 182px/);
  assert.match(cover, /\.topbar-actions \.demo-data-badge\s*\{[^}]*display:\s*grid;[^}]*width:\s*44px;[^}]*min-width:\s*44px/);
  assert.doesNotMatch(cover, /\.topbar-actions \.demo-data-badge\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(cover, /\.topbar-actions \.user-menu\s*\{[^}]*display:\s*none/);
});

test("cover-screen status, calendar and fixed actions stay reachable", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const cover = mediaBody(styles, "(max-width: 344px)");
  const legacyCover = mediaBody(styles, "(max-width: 319px)");

  assert.match(cover, /\.commerce-service-rail\s*\{[^}]*overflow-x:\s*auto;[^}]*touch-action:\s*pan-x pan-y/);
  assert.match(cover, /\.cs-filter-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(cover, /\.analysis-start-bar\s*\{[^}]*flex-direction:\s*column/);
  assert.match(cover, /\.analysis-start-bar > button\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*44px/);
  assert.match(cover, /\.sales-calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(40px, 1fr\)\);[^}]*overflow-x:\s*auto/);
  assert.match(cover, /\.mobile-bottom-nav button span\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/);
  assert.match(legacyCover, /\.mobile-push-gate\.browser\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("Fold overrides do not replace the established 390px two-column registration contract", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const cover = mediaBody(styles, "(max-width: 344px)");

  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.registration-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(cover, /\.registration-card-grid\s*\{/);
  assert.ok(344 < 390);
});
