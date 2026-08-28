import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layerStylesUrl = new URL("../app/interaction-layers.css", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);
const modalHookUrl = new URL("../app/use-modal-interaction.ts", import.meta.url);
const publishingUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);
const credentialCenterUrl = new URL("../app/api-credential-center.tsx", import.meta.url);
const puckEditorUrl = new URL("../app/product-detail-puck.tsx", import.meta.url);
const runtimeCardUrl = new URL("../app/ai-cli-runtime-card.tsx", import.meta.url);
const pushManagerUrl = new URL("../app/mobile-push-manager.tsx", import.meta.url);

function layerValue(styles, name) {
  const match = styles.match(new RegExp(`--layer-${name}:\\s*(\\d+)`));
  assert.ok(match, `missing --layer-${name}`);
  return Number(match[1]);
}

test("280 through 412 pixel viewports share one modal and bottom-lane hierarchy", async () => {
  const styles = await readFile(layerStylesUrl, "utf8");
  for (const width of [280, 320, 344, 390, 412]) {
    assert.ok(width <= 720, `${width}px must use the phone interaction contract`);
  }

  const navigation = layerValue(styles, "mobile-navigation");
  const notice = layerValue(styles, "transient-notice");
  const push = layerValue(styles, "push-prompt");
  const popover = layerValue(styles, "popover");
  const scrim = layerValue(styles, "drawer-scrim");
  const drawer = layerValue(styles, "drawer");
  const modal = layerValue(styles, "modal");
  const editor = layerValue(styles, "editor-modal");
  assert.ok(navigation < notice && notice < push && push < popover);
  assert.ok(popover < scrim && scrim < drawer && drawer < modal && modal < editor);

  assert.match(styles, /body:has\(\.command-overlay,[^}]+\.sidebar\.open\) \.mobile-bottom-nav,[\s\S]*?pointer-events:\s*none/);
  assert.match(styles, /body:has\(\.notification-popover\) \.mobile-bottom-nav,[\s\S]*?body:has\(\.notification-popover\) \.mobile-push-chip[\s\S]*?pointer-events:\s*none/);
  assert.match(styles, /\.sidebar-scrim\s*\{\s*z-index:\s*var\(--layer-drawer-scrim\)/);
  assert.match(styles, /\.sidebar\s*\{\s*z-index:\s*var\(--layer-drawer\)/);
});

test("shipment, account, credential and search actions remain reachable above the mobile keyboard", async () => {
  const [styles, layout] = await Promise.all([
    readFile(layerStylesUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
  ]);

  assert.match(layout, /import type \{ Metadata, Viewport \} from "next"/);
  assert.match(layout, /export const viewport: Viewport = \{[\s\S]*?viewportFit:\s*"cover"[\s\S]*?interactiveWidget:\s*"resizes-visual"/);
  assert.ok(layout.indexOf('import "./interaction-layers.css"') > layout.indexOf('import "./mobile-optimization.css"'));

  assert.match(styles, /\.shipment-dialog-overlay\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.shipment-dialog\s*\{[\s\S]*?max-height:\s*calc\(100dvh[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto;[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.shipment-dialog\.order-detail-dialog\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.shipment-draft-list,[\s\S]*?\.order-detail-ledger\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.shipment-dialog > footer\s*\{[\s\S]*?padding:[^;]+env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.command-dialog,[\s\S]*?\.account-security-dialog,[\s\S]*?\.credential-modal,[\s\S]*?\.product-edit-dialog\s*\{[\s\S]*?max-height:\s*calc\(100dvh/);
  assert.match(styles, /\.credential-modal > footer\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(orientation:\s*landscape\) and \(max-height:\s*520px\)[\s\S]*?max-height:\s*calc\(100dvh - 8px\)/);
});

test("notification content scrolls inside the space above persistent navigation", async () => {
  const [styles, page] = await Promise.all([
    readFile(layerStylesUrl, "utf8"),
    readFile(pageUrl, "utf8"),
  ]);
  assert.match(styles, /\.notification-popover\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?touch-action:\s*pan-y/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*?\.notification-popover\s*\{[\s\S]*?top:\s*calc\(var\(--mobile-header-clearance\) \+ 8px\);[\s\S]*?bottom:\s*calc\(var\(--mobile-nav-clearance, 78px\) \+ 8px\);[\s\S]*?max-height:\s*none/);
  assert.match(styles, /\.app-header-stack:has\(\.notification-popover\)\s*\{[\s\S]*?z-index:\s*var\(--layer-popover\)/);
  assert.match(page, /ref=\{notificationButtonRef\}[\s\S]{0,180}aria-expanded=\{notificationsOpen\}[\s\S]{0,180}aria-controls="sellerpilot-notifications"/);
  assert.doesNotMatch(page, /ref=\{notificationButtonRef\}[^>]*aria-haspopup/);
  assert.match(page, /className="notification-item-open"/);
  assert.match(page, /className="notification-item-dismiss"/);
  assert.doesNotMatch(page, /className="notification-item"[^>]*role="button"/);
  assert.match(page, /event\.key !== "Escape"[\s\S]{0,100}closeNotifications\(true\)/);
});

test("mobile drawer and standalone Android gate share the modal interaction contract", async () => {
  const [page, pushManager] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(pushManagerUrl, "utf8"),
  ]);

  assert.match(page, /useSyncExternalStore\(subscribeToSidebarDrawer, getSidebarDrawerSnapshot, getServerSidebarDrawerSnapshot\)/);
  assert.match(page, /useModalInteraction\(sidebarDrawer && sidebarOpen, sidebarDialogRef,[\s\S]{0,160}initialFocusRef: sidebarCloseButtonRef/);
  assert.match(page, /id="sellerpilot-sidebar"[^>]*ref=\{sidebarDialogRef\}[^>]*role=\{sidebarDrawer && sidebarOpen \? "dialog" : undefined\}/);
  assert.match(page, /aria-hidden=\{sidebarDrawer && !sidebarOpen \|\| undefined\}/);
  assert.match(page, /inert=\{sidebarDrawer && !sidebarOpen \|\| undefined\}/);
  assert.match(page, /aria-controls="sellerpilot-sidebar" aria-expanded=\{sidebarOpen\}/);

  assert.match(pushManager, /useModalInteraction\(standaloneGateOpen, standaloneGateRef, dismissForSession,[\s\S]{0,140}dismissible: !busy,[\s\S]{0,100}initialFocusRef: standaloneGateDismissRef/);
  assert.match(pushManager, /ref=\{standaloneGateRef\} tabIndex=\{-1\}[\s\S]{0,180}role="dialog"[\s\S]{0,120}aria-modal=\{isStandalone \|\| undefined\}/);
  assert.match(pushManager, /ref=\{standaloneGateDismissRef\}[\s\S]{0,180}disabled=\{busy\}/);
});

test("notched standalone iPhones get one safe header inset while ordinary Fold browsers do not", async () => {
  const styles = await readFile(layerStylesUrl, "utf8");

  assert.match(styles, /@media \(max-width: 720px\)\s*\{[\s\S]*?:root\s*\{[\s\S]*?--mobile-header-safe-top:\s*0px;[\s\S]*?--mobile-header-clearance:\s*calc\(var\(--mobile-header-safe-top\) \+ var\(--mobile-service-rail-height\) \+ var\(--mobile-topbar-height\)\)/);
  assert.match(styles, /@media \(max-width: 720px\) and \(display-mode: standalone\)\s*\{[\s\S]*?--mobile-header-safe-top:\s*env\(safe-area-inset-top\);[\s\S]*?\.app-header-stack\s*\{[^}]*padding-top:\s*var\(--mobile-header-safe-top\)/);
  assert.match(styles, /\.puck-editor-modal\s*\{[^}]*grid-template-rows:\s*calc\(58px \+ env\(safe-area-inset-top\)\)/);
  assert.match(styles, /\.puck-editor-body\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
});

test("mobile-only hidden labels and compact controls retain accessible 44px targets", async () => {
  const styles = await readFile(layerStylesUrl, "utf8");

  assert.match(styles, /\.sr-only\s*\{[^}]*position:\s*absolute !important;[^}]*width:\s*1px !important;[^}]*clip-path:\s*inset\(50%\) !important;[^}]*margin:\s*-1px !important/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.sales-calendar-pager > button,[\s\S]*?\.command-input > button,[\s\S]*?\.credential-modal > header > button,[\s\S]*?\.cli-token-reveal button,[\s\S]*?\.bulk-order-bar > button:not\(\.table-action\),[\s\S]*?\.operation-console-meta a\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
  assert.match(styles, /\.notification-popover \.notification-item\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 44px/);
  assert.match(styles, /\.notification-popover \.notification-item > \.notification-item-dismiss\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(styles, /\.sidebar-head > button,[\s\S]*?\.mobile-back,[\s\S]*?\.template-card-grid article > div > button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(styles, /\.product-research-result nav a,[\s\S]*?\.product-link-input button,[\s\S]*?\.product-detail-asset-grid figcaption button,[\s\S]*?\.reply-tool-select,[\s\S]*?\.category-attribute-list select\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /\.main-photo-section:has\(input\[type="file"\]:focus-visible\),[\s\S]*?\.product-revision-extras:has\(input\[type="file"\]:focus-visible\)\s*\{[^}]*outline:\s*3px solid/);
});

test("the embedded detail editor fits a Fold and exposes a semantic save action", async () => {
  const [styles, puckEditor] = await Promise.all([
    readFile(layerStylesUrl, "utf8"),
    readFile(puckEditorUrl, "utf8"),
  ]);

  assert.match(puckEditor, /const productDetailEditorViewports: Viewports = \[\s*\{ width: "100%", height: "auto", label: "현재 화면"/);
  assert.match(puckEditor, /<button\s+type="button"\s+className="puck-editor-publish-action"/);
  assert.match(puckEditor, /overrides=\{\{ headerActions: \(\) => <ProductDetailPublishAction saving=\{saving\} onSave=\{onSave\} \/> \}\}/);
  assert.match(styles, /\.puck-editor-body \[class\*="_PuckLayout_"\]\s*\{[^}]*height:\s*100% !important;[^}]*max-height:\s*100%;[^}]*min-height:\s*0/);
  assert.match(styles, /\.puck-editor-body \[class\*="_ViewportControls-actionsInner_"\]\s*\{[^}]*justify-content:\s*flex-start;[^}]*overflow-x:\s*auto;[^}]*touch-action:\s*pan-x/);
  assert.match(styles, /@media \(max-width: 344px\)[\s\S]*?\.puck-editor-body \[class\*="_PuckCanvas-inner_"\],[\s\S]*?\.puck-editor-body \[class\*="_PuckCanvas-root_"\]\s*\{[^}]*min-width:\s*0/);
});

test("true modals lock scroll, trap focus, close on Escape and restore the opener", async () => {
  const [page, hook, publishing, credentialCenter, puckEditor, runtimeCard] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(modalHookUrl, "utf8"),
    readFile(publishingUrl, "utf8"),
    readFile(credentialCenterUrl, "utf8"),
    readFile(puckEditorUrl, "utf8"),
    readFile(runtimeCardUrl, "utf8"),
  ]);

  assert.match(hook, /acquireModalBodyScrollLock\(document\.body\)/);
  assert.match(hook, /"button:not\(:disabled\)"/);
  assert.match(hook, /"\[contenteditable='true'\]"/);
  assert.match(hook, /modalInteractionStack\.at\(-1\) === interactionToken/);
  assert.match(hook, /event\.key === "Escape" && dismissibleRef\.current/);
  assert.match(hook, /event\.key !== "Tab"/);
  assert.match(hook, /opener\?\.isConnected[\s\S]*?opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /useModalInteraction\(Boolean\(detailOrder\), detailDialogRef/);
  assert.match(page, /useModalInteraction\(fulfillmentOpen, fulfillmentDialogRef/);
  assert.match(page, /useModalInteraction\(searchOpen, searchDialogRef/);
  assert.match(page, /useModalInteraction\(accountOpen, accountDialogRef/);
  assert.match(page, /ref=\{detailDialogRef\} tabIndex=\{-1\}/);
  assert.match(page, /ref=\{fulfillmentDialogRef\} tabIndex=\{-1\}/);
  assert.match(page, /ref=\{searchDialogRef\} tabIndex=\{-1\}/);
  assert.match(page, /ref=\{accountDialogRef\} tabIndex=\{-1\}/);
  assert.match(page, /useModalInteraction\(true, dialogRef, onClose, \{ dismissible: !saving \}\)/);
  assert.match(page, /if \(hasActiveModalInteractionSurface\(\)\) return;[\s\S]{0,80}openSearch\(\)/);
  assert.match(page, /const openSearch = useCallback\(\(\) => \{\s*setNotificationsOpen\(false\)/);
  assert.match(page, /<fieldset className="product-edit-form manual-field-grid" disabled=\{saving\} aria-busy=\{saving\}>/);
  assert.match(page, /<fieldset className="intake-confirmations" disabled=\{saving\} aria-busy=\{saving\}>/);
  assert.match(page, /<fieldset className="shipment-draft-list" disabled=\{fulfilling\} aria-busy=\{fulfilling\}>/);
  assert.equal((credentialCenter.match(/useModalInteraction\(true, dialogRef, onClose/g) ?? []).length, 3);
  assert.equal((credentialCenter.match(/<fieldset className="operation-console-body" disabled=\{running\} aria-busy=\{running\}>/g) ?? []).length, 2);
  assert.match(credentialCenter, /<fieldset className="credential-form-grid" disabled=\{saving\} aria-busy=\{saving\}>/);
  assert.match(credentialCenter, /<fieldset className="rotation-settings" disabled=\{saving\} aria-busy=\{saving\}>/);
  assert.match(puckEditor, /useModalInteraction\(Boolean\(initialData\), dialogRef, onClose, \{ dismissible: !saving, initialFocusRef: closeButtonRef \}\)/);
  assert.match(puckEditor, /className="puck-editor-body" aria-busy=\{saving\} aria-disabled=\{saving \|\| undefined\} inert=\{saving \|\| undefined\}/);
  assert.match(runtimeCard, /useModalInteraction\(tokenRotationConfirming, tokenRotationDialogRef, closeTokenRotationConfirmation/);
  assert.match(runtimeCard, /dialog\.showModal\(\)/);
  assert.match(publishing, /querySelector<HTMLButtonElement>\("\.credential-secondary"\)/);

  for (const [name, source] of [
    ["page", page],
    ["credential center", credentialCenter],
    ["Puck editor", puckEditor],
    ["runtime card", runtimeCard],
  ]) {
    const modalCount = source.match(/aria-modal="true"/g)?.length ?? 0;
    const referencedModalCount = source.match(/<(?:div|section|form|dialog)\b[^>]*\bref=\{[^}]+\}[^>]*\baria-modal="true"/g)?.length ?? 0;
    assert.equal(referencedModalCount, modalCount, `${name} must attach every aria-modal surface to an interaction ref`);
  }
  assert.doesNotMatch(publishing, /className="publish-write-confirmation(?: channel)?"[^>]*aria-modal="true"/);
});
