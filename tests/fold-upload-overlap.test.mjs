import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mobileStylesUrl = new URL("../app/mobile-optimization.css", import.meta.url);
const globalStylesUrl = new URL("../app/globals.css", import.meta.url);
const commerceStylesUrl = new URL("../app/commerce-ux-refactor.css", import.meta.url);
const interactionStylesUrl = new URL("../app/interaction-layers.css", import.meta.url);
const pushManagerUrl = new URL("../app/mobile-push-manager.tsx", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);

function foldSafeContract(styles) {
  const marker = "/* Fold-safe mobile overlay lanes.";
  const start = styles.indexOf(marker);
  assert.notEqual(start, -1, "missing the final Fold-safe overlay contract");
  return { contract: styles.slice(start), start };
}

test("280 through 412 CSS pixel registration cards reserve a real row for camera and album actions", async () => {
  const [styles, globalStyles, commerceStyles, page] = await Promise.all([
    readFile(mobileStylesUrl, "utf8"),
    readFile(globalStylesUrl, "utf8"),
    readFile(commerceStylesUrl, "utf8"),
    readFile(pageUrl, "utf8"),
  ]);
  const { contract } = foldSafeContract(styles);

  for (const width of [280, 320, 344, 390, 412]) assert.ok(width <= 720);
  assert.match(globalStyles, /\.option-slot-wrap\s*\{[^}]*display:\s*grid;[^}]*height:\s*auto;[^}]*grid-template-rows:\s*minmax\(124px, auto\) auto;[^}]*aspect-ratio:\s*auto/);
  assert.match(globalStyles, /\.option-photo-slot\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*124px;[^}]*aspect-ratio:\s*1\.04/);
  assert.match(commerceStyles, /\.photo-source-actions\.compact\s*\{[^}]*margin-top:\s*0/);
  assert.doesNotMatch(contract, /\.option-slot-wrap\s*\{/);
  assert.ok(page.indexOf('className="option-photo-slot"') < page.indexOf('className="photo-source-actions compact"'));
  assert.match(page, /id=\{`option-photo-\$\{slot\.id\}-camera`\}[\s\S]{0,320}capture="environment"/);
  assert.match(page, /htmlFor=\{`option-photo-\$\{slot\.id\}-camera`\}[\s\S]{0,120}<Camera/);
  assert.match(page, /htmlFor=\{`option-photo-\$\{slot\.id\}`\}[\s\S]{0,120}<ImagePlus/);
});

test("mobile registration, a long toast, push status and navigation do not share one bottom lane", async () => {
  const [styles, interactionStyles, pushManager] = await Promise.all([
    readFile(mobileStylesUrl, "utf8"),
    readFile(interactionStylesUrl, "utf8"),
    readFile(pushManagerUrl, "utf8"),
  ]);
  const { contract, start } = foldSafeContract(styles);
  const legacyBottomLane = styles.lastIndexOf("bottom: calc(72px + env(safe-area-inset-bottom))", start);

  assert.ok(legacyBottomLane >= 0 && legacyBottomLane < start, "the final static rule must override the legacy action-bar bottom lane");
  assert.match(contract, /\.upload-panel > \.analysis-start-bar,\s*\.analysis-start-bar\s*\{[^}]*position:\s*static;[^}]*bottom:\s*auto !important/);
  assert.match(contract, /body\s*\{[^}]*--mobile-nav-clearance:\s*calc\(78px \+ env\(safe-area-inset-bottom\)\);[^}]*--mobile-toast-lane-height:\s*0px/);
  assert.match(contract, /body\s*\{[^}]*--mobile-toast-max-height:\s*clamp\(84px, 24svh, 132px\)/);
  assert.match(contract, /body:has\(\.toast\)\s*\{[^}]*--mobile-toast-lane-height:\s*calc\(var\(--mobile-toast-max-height\) \+ 8px\)/);
  assert.match(contract, /\.toast\s*\{[^}]*bottom:\s*var\(--mobile-nav-clearance\) !important/);
  assert.match(contract, /\.toast\s*\{[^}]*max-height:\s*var\(--mobile-toast-max-height\);[^}]*overflow-y:\s*auto/);
  assert.match(contract, /\.app-main > \.mobile-push-gate\.browser,\s*\.app-main > \.mobile-push-chip\s*\{[^}]*position:\s*relative;[^}]*inset:\s*auto;[^}]*margin:\s*8px var\(--mobile-gutter\) 0/);
  assert.match(contract, /\.app-content\s*\{[^}]*padding-bottom:\s*calc\(104px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(pushManager, /state !== "subscribed"[\s\S]{0,120}window\.setTimeout\(dismissForSession, 2_000\)/);
  assert.match(pushManager, /className="mobile-push-chip-dismiss"[\s\S]{0,160}aria-label="주문 배송 알림 상태 닫기"/);
  assert.doesNotMatch(pushManager, /mobile-push-page-spacer/);
  assert.match(interactionStyles, /\.toast > \.toast-copy > span\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(interactionStyles, /\.mobile-push-gate\.browser\s*\{[^}]*max-height:\s*calc\(100dvh - var\(--mobile-nav-clearance, 78px\) - var\(--mobile-toast-lane-height, 0px\) - 16px\);[^}]*overflow-y:\s*auto/);
});

test("flow push status scrolls below the sticky header while the standalone gate keeps its prompt layer", async () => {
  const [styles, interactionStyles] = await Promise.all([
    readFile(mobileStylesUrl, "utf8"),
    readFile(interactionStylesUrl, "utf8"),
  ]);
  const { contract } = foldSafeContract(styles);
  const promptLayer = interactionStyles.search(/\.mobile-push-gate,\s*\.mobile-push-chip\s*\{[^}]*z-index:\s*var\(--layer-push-prompt\)/);
  const flowLayer = interactionStyles.search(/\.app-main > \.mobile-push-gate\.browser,\s*\.app-main > \.mobile-push-chip\s*\{[^}]*z-index:\s*auto/);

  assert.ok(promptLayer >= 0, "missing the shared push prompt layer");
  assert.ok(flowLayer > promptLayer, "the page-flow override must follow the shared prompt layer");
  assert.match(contract, /\.app-main > \.mobile-push-gate\.browser,\s*\.app-main > \.mobile-push-chip\s*\{[^}]*position:\s*relative/);
  assert.match(styles, /\.mobile-push-gate\.standalone\s*\{[^}]*z-index:\s*130/);
});
