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
  const narrowCover = mediaBody(styles, "(max-width: 319px)");

  assert.match(cover, /body\s*\{[^}]*min-width:\s*0/);
  assert.match(cover, /\.topbar-title\s*\{[^}]*min-width:\s*44px;[^}]*flex:\s*1 1 auto/);
  assert.match(cover, /\.topbar-title > div\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto/);
  assert.match(cover, /\.topbar-actions\s*\{[^}]*min-width:\s*182px;[^}]*flex:\s*0 0 182px/);
  assert.match(cover, /\.topbar-actions \.demo-data-badge\s*\{[^}]*display:\s*grid;[^}]*width:\s*44px;[^}]*min-width:\s*44px/);
  assert.doesNotMatch(cover, /\.topbar-actions \.demo-data-badge\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(cover, /\.topbar-actions \.user-menu\s*\{[^}]*display:\s*none/);
  assert.match(narrowCover, /\.topbar-actions\s*\{[^}]*min-width:\s*136px;[^}]*flex:\s*0 0 136px/);
  assert.match(narrowCover, /\.topbar-actions \.demo-data-badge\s*\{[^}]*display:\s*none/);
  assert.match(narrowCover, /\.topbar-actions\.has-operations-attention\s*\{[^}]*min-width:\s*182px;[^}]*flex-basis:\s*182px/);
  assert.match(narrowCover, /\.topbar-actions \.demo-data-badge\.attention\s*\{[^}]*display:\s*grid/);
  assert.match(narrowCover, /\.topbar-title h1\s*\{[^}]*max-width:\s*none;[^}]*font-size:\s*12px/);
  assert.doesNotMatch(narrowCover, /\.topbar-actions \.user-menu\s*\{[^}]*display:\s*none/);
});

test("cover-screen status, calendar and fixed actions stay reachable", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const cover = mediaBody(styles, "(max-width: 344px)");
  const legacyCover = mediaBody(styles, "(max-width: 319px)");

  assert.match(cover, /\.commerce-service-rail\s*\{[^}]*overflow-x:\s*auto;[^}]*touch-action:\s*pan-x pan-y/);
  assert.match(cover, /\.commerce-service-rail\s*\{[^}]*gap:\s*4px/);
  assert.match(cover, /\.commerce-service-rail strong\s*\{[^}]*min-width:\s*82px/);
  assert.match(cover, /\.commerce-service-rail span:nth-of-type\(4\)\s*\{[^}]*padding-right:\s*4px;[^}]*padding-left:\s*4px/);
  assert.match(cover, /\.commerce-service-rail em\s*\{[^}]*display:\s*inline-flex;[^}]*max-width:\s*220px/);
  assert.match(cover, /\.commerce-service-rail span,\s*\.commerce-service-rail em\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(cover, /\.commerce-service-rail (?:span|em)[^{]*\{[^}]*display:\s*none/);
  assert.match(cover, /\.cs-filter-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(cover, /\.analysis-start-bar\s*\{[^}]*flex-direction:\s*column/);
  assert.match(cover, /\.analysis-start-bar > button\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*44px/);
  assert.match(styles, /\.sales-calendar-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain/);
  assert.match(styles, /\.sales-calendar-weekdays,\s*\.sales-calendar-grid\s*\{[^}]*min-width:\s*var\(--sales-calendar-min-width\);[^}]*grid-template-columns:\s*repeat\(7, minmax\(40px, 1fr\)\)/);
  assert.match(styles, /\.sales-calendar-grid\s*\{[^}]*overflow:\s*visible/);
  assert.match(cover, /\.sales-calendar-panel > \.panel-heading\s*\{[^}]*align-items:\s*stretch;[^}]*flex-direction:\s*column;[^}]*gap:\s*10px/);
  assert.match(cover, /\.sales-calendar-meta\s*\{[^}]*width:\s*100%;[^}]*justify-items:\s*stretch/);
  assert.match(cover, /\.sales-calendar-pager\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 44px/);
  assert.match(cover, /\.mobile-bottom-nav button span\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/);
  assert.match(legacyCover, /\.mobile-push-gate\.browser\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(cover, /\.app-main\.publishing-active > \.mobile-push-gate\.browser\s*\{[^}]*grid-template-columns:\s*36px minmax\(0, 1fr\);[^}]*padding:\s*10px/);
  assert.match(cover, /\.app-main\.publishing-active > \.mobile-push-gate\.browser \.mobile-push-gate-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(cover, /\.app-main\.publishing-active > \.mobile-push-gate\.standalone/);
});

test("Fold registration cards use one column through 344px and keep the 390px two-column contract", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const cover = mediaBody(styles, "(max-width: 344px)");

  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.registration-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(cover, /\.registration-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.ok(344 < 390);
});
