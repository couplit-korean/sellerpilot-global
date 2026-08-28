import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const calendarUrl = new URL("../app/_dashboard/revenue-calendar.tsx", import.meta.url);
const mobileStylesUrl = new URL("../app/mobile-optimization.css", import.meta.url);
const interactionStylesUrl = new URL("../app/interaction-layers.css", import.meta.url);

test("product toolbar actions are an overlay with complete keyboard and collision behavior", async () => {
  const [page, styles, interactionStyles] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(mobileStylesUrl, "utf8"),
    readFile(interactionStylesUrl, "utf8"),
  ]);

  assert.match(page, /const actionsMenuRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /const actionsButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(page, /actionsMenuRef\.current && !actionsMenuRef\.current\.contains\(event\.target as Node\)/);
  assert.match(page, /document\.addEventListener\("pointerdown", closeOnOutside, true\)/);
  assert.match(page, /document\.removeEventListener\("pointerdown", closeOnOutside, true\)/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /actionsButtonRef\.current\?\.focus\(\)/);
  assert.match(page, /querySelector<HTMLButtonElement>\('\[role="menuitem"\]'\)\?\.focus/);
  assert.match(page, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(page, /aria-haspopup="menu"/);
  assert.match(page, /aria-controls="product-toolbar-menu"/);
  assert.match(page, /id="product-toolbar-menu" role="menu" tabIndex=\{-1\} aria-label="상품 추가 작업"/);
  assert.match(styles, /\.toolbar-menu\s*\{[^}]*position:\s*relative/);
  assert.match(styles, /\.toolbar-menu-popover\s*\{[^}]*position:\s*absolute;[^}]*min-width:\s*184px/);
  assert.match(styles, /\.toolbar-menu-popover > button\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.toolbar-menu-popover\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*calc\(var\(--mobile-nav-clearance, 78px\) \+ 8px\)/);
  assert.match(interactionStyles, /\.toolbar-menu-popover\s*\{[^}]*z-index:\s*var\(--layer-popover\) !important/);
  assert.match(interactionStyles, /body:has\(\.toolbar-menu-popover\) \.toast,[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none/);
});

test("revenue calendar weekdays and dates move in one Fold-safe viewport", async () => {
  const [calendar, styles] = await Promise.all([
    readFile(calendarUrl, "utf8"),
    readFile(mobileStylesUrl, "utf8"),
  ]);

  const scrollStart = calendar.indexOf('className="sales-calendar-scroll"');
  const weekdayStart = calendar.indexOf('className="sales-calendar-weekdays"', scrollStart);
  const gridStart = calendar.indexOf('className="sales-calendar-grid"', weekdayStart);
  assert.ok(scrollStart >= 0 && weekdayStart > scrollStart && gridStart > weekdayStart);
  assert.match(calendar, /className="sales-calendar-scroll" role="region" aria-label="요일과 날짜별 실매출 달력"/);
  assert.match(styles, /\.sales-calendar-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(styles, /\.sales-calendar-weekdays,\s*\.sales-calendar-grid\s*\{[^}]*width:\s*max\(100%, var\(--sales-calendar-min-width\)\);[^}]*min-width:\s*var\(--sales-calendar-min-width\)/);
});

test("narrow ledgers preserve one identity edge while 280, 320 and 344px covers can reveal data", async () => {
  const [styles, interactionStyles] = await Promise.all([
    readFile(mobileStylesUrl, "utf8"),
    readFile(interactionStylesUrl, "utf8"),
  ]);

  for (const width of [280, 320, 344]) assert.ok(width <= 344);

  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.product-table th:first-child,[\s\S]*?position:\s*sticky;[\s\S]*?left:\s*0/);
  assert.match(styles, /\.product-table \.product-cell\s*\{[^}]*min-width:\s*min\(300px, calc\(100vw - 88px\)\)/);
  assert.match(styles, /\.order-table th:nth-child\(2\),\s*\.order-table td:nth-child\(2\)\s*\{[^}]*position:\s*sticky;[^}]*left:\s*48px/);
  assert.match(styles, /\.order-table th:last-child,[\s\S]*?\.margin-table td:last-child\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0/);
  assert.match(styles, /\.data-table \.table-action\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(interactionStyles, /@media \(max-width: 344px\)[\s\S]*?\.order-table th:nth-child\(2\),[\s\S]*?\.margin-table td:last-child\s*\{[^}]*position:\s*static;[^}]*right:\s*auto;[^}]*left:\s*auto;[^}]*box-shadow:\s*none/);
});

test("unstyled access, margin and studio states now have mobile-safe hierarchy", async () => {
  const styles = await readFile(mobileStylesUrl, "utf8");

  assert.match(styles, /\.login-submit\s*\{[^}]*min-height:\s*48px;[^}]*touch-action:\s*manipulation/);
  assert.match(styles, /\.margin-manual-fee-warning\s*\{[^}]*min-height:\s*44px;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.studio-empty-preview\s*\{[^}]*min-height:\s*320px;[^}]*text-align:\s*center/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.studio-empty-preview\s*\{[^}]*min-height:\s*240px/);
});
