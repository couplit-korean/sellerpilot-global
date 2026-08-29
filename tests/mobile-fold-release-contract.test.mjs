import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const stylesUrl = new URL("../app/commerce-ux-refactor.css", import.meta.url);
const pushManagerUrl = new URL("../app/mobile-push-manager.tsx", import.meta.url);
const manifestUrl = new URL("../public/manifest.webmanifest", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);

test("disabled publishing photo inputs expose their reason and block label touch routing", async () => {
  const [page, styles] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(page, /const extraPhotoInputDisabled = extraPhotosProcessing \|\| totalPhotoCount >= 100/);
  assert.match(page, /data-disabled=\{slotDisabled \|\| undefined\}/);
  assert.match(page, /className="option-photo-slot"[^>]*aria-disabled=\{slotDisabled \|\| undefined\}[^>]*title=\{slotDisabledReason \|\| undefined\}/);
  assert.match(page, /className="photo-source-actions compact"[^>]*aria-disabled=\{slotDisabled \|\| undefined\}/);
  assert.match(page, /className="photo-source-actions" aria-label="추가 사진 입력 방식" aria-disabled=\{extraPhotoInputDisabled \|\| undefined\}/);
  assert.match(page, /extraPhotoInputDisabled \? "현재 선택 불가"/);
  assert.match(styles, /\.option-photo-slot\[aria-disabled="true"\],[\s\S]*?\.photo-source-actions\[aria-disabled="true"\] > label\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*\.56;[^}]*pointer-events:\s*none/);
});

test("Fold warnings stay actionable and mobile navigation exposes the current page", async () => {
  const page = await readFile(pageUrl, "utf8");
  const navStart = page.indexOf('<nav className="mobile-bottom-nav"');
  const navEnd = page.indexOf("</nav>", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart, "missing mobile bottom navigation");
  const navigation = page.slice(navStart, navEnd);

  assert.match(page, /const operationsBadgeNeedsAttention = operations\.state === "unavailable" \|\| productReadinessState === "unavailable" \|\| aiRecovery\?\.status === "failed"/);
  assert.match(page, /className=\{`topbar-actions \$\{operationsBadgeNeedsAttention \? "has-operations-attention" : ""\}`\.trim\(\)\}/);
  assert.match(page, /<button type="button" className="demo-data-badge attention"[^>]*aria-label=\{`\$\{operationsBadgeLabel\}: \$\{operationsBadgeDetail\}`\}[^>]*onClick=\{openOperationsAttention\}/);
  assert.equal(navigation.match(/aria-current=\{/g)?.length, 5);
  assert.equal(navigation.match(/\? "page" : undefined/g)?.length, 5);
});

test("publishing-only browser gate compaction leaves the standalone modal contract intact", async () => {
  const [page, pushManager] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(pushManagerUrl, "utf8"),
  ]);

  assert.match(page, /<section className=\{`app-main \$\{view === "publishing" \? "publishing-active" : ""\}`\.trim\(\)\}>/);
  assert.match(pushManager, /className=\{`mobile-push-gate \$\{isStandalone \? "standalone" : "browser"\}`\}/);
  assert.match(pushManager, /aria-modal=\{isStandalone \|\| undefined\}/);
});

test("PWA viewport color and notification renotify options remain standards-safe", async () => {
  const [layout, manifestSource, serviceWorker] = await Promise.all([
    readFile(layoutUrl, "utf8"),
    readFile(manifestUrl, "utf8"),
    readFile(serviceWorkerUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.match(layout, /export const viewport: Viewport = \{[\s\S]*?themeColor:\s*"#0b172a"/);
  assert.equal(manifest.theme_color, "#0b172a");
  assert.match(serviceWorker, /const tag = typeof data\.tag === "string" \? data\.tag\.trim\(\) : ""/);
  assert.match(serviceWorker, /tag:\s*tag \|\| undefined,[\s\S]*?renotify:\s*Boolean\(tag\)/);
  assert.doesNotMatch(serviceWorker, /renotify:\s*true/);
});
