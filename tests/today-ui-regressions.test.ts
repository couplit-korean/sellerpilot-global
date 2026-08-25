import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { salesRangeForPreset } from "../app/_dashboard/sales-range-control";
import {
  isRegistrationActivityRunning,
  registrationActivityDisplayElapsedSeconds,
  registrationActivityMatchesFilter,
  registrationActivityNotificationTransition,
  registrationActivityNotifications,
  registrationActivityProgress,
  registrationActivityStatusMap,
  registrationChannelStatusLabel,
  type RegistrationActivity,
} from "../app/_registration/registration-status";
import { appendToast, toastDurationMs, toastToneForMessage } from "../app/_notifications/use-toast-queue";
import { operationEventNotifications, operationEventState, type OperationEventSnapshot } from "../app/_notifications/operation-event-notifications";
import { normalizeProductSaleConfiguration, productSaleConfigurations } from "../lib/product-sale-configuration";
import { productEditSchema } from "../lib/product-intake";
import { withPromiseTimeout } from "../lib/promise-timeout";
import { safeRelativeReturnPath } from "../lib/safe-relative-return-path";

function activity(id: string, productName: string, status: RegistrationActivity["status"]): RegistrationActivity {
  return {
    id,
    productId: id,
    productName,
    productCode: id,
    sku: id,
    status,
    startedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    completedAt: null,
    elapsedSeconds: 0,
    channelCount: 1,
    publishedCount: 0,
    failedCount: 0,
    blockedCount: 0,
    channels: [],
    message: "",
  };
}

function cssMediaBody(source: string, condition: string) {
  const marker = `@media ${condition}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS media query: ${condition}`);
  const openingBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  assert.fail(`unclosed CSS media query: ${condition}`);
}

test("sale configuration has one shared dropdown contract", () => {
  assert.deepEqual(productSaleConfigurations, [
    { value: "상품 1개", label: "1개" },
    { value: "상품 1+1", label: "1+1" },
  ]);
  assert.equal(normalizeProductSaleConfiguration("본품 1 + 1 세트"), "상품 1+1");
  assert.equal(normalizeProductSaleConfiguration("상품 1개"), "상품 1개");
  assert.equal(normalizeProductSaleConfiguration("본품 1개"), "상품 1개");
  assert.equal(normalizeProductSaleConfiguration("머그컵 1개"), "상품 1개");
  assert.equal(normalizeProductSaleConfiguration("상품 2개"), "");
  assert.equal(normalizeProductSaleConfiguration("상품 11개"), "");
});

test("dashboard range presets stay in one feature module", () => {
  const now = new Date(2026, 7, 25, 12, 0, 0);
  assert.deepEqual(salesRangeForPreset("day", now), { preset: "day", from: "2026-08-25", to: "2026-08-25" });
  assert.deepEqual(salesRangeForPreset("week", now), { preset: "week", from: "2026-08-19", to: "2026-08-25" });
  assert.deepEqual(salesRangeForPreset("month", now), { preset: "month", from: "2026-08-01", to: "2026-08-25" });
  assert.deepEqual(salesRangeForPreset("year", now), { preset: "year", from: "2026-01-01", to: "2026-08-25" });
});

test("every new or changed registration event is queued once after initial hydration", () => {
  const initial = [activity("one", "상품 A", "analyzing"), activity("two", "상품 B", "ready")];
  assert.deepEqual(registrationActivityNotifications(null, initial), []);
  const previous = registrationActivityStatusMap(initial);
  const next = [activity("one", "상품 A", "completed"), activity("two", "상품 B", "failed"), activity("three", "상품 C", "publishing")];
  assert.deepEqual(registrationActivityNotifications(previous, next), [
    "상품 A: 등록 완료",
    "상품 B: 재시도 필요",
    "상품 C: 채널 등록 중",
  ]);
});

test("every per-channel registration transition is notified while the aggregate stays publishing", () => {
  const initial = activity("one", "상품 A", "publishing");
  initial.channels = [{
    channel: "elevenst",
    channelCode: "11",
    channelName: "11번가",
    market: "KR",
    status: "queued",
    message: "",
    updatedAt: initial.updatedAt,
  }];
  const previous = registrationActivityStatusMap([initial]);
  const next = structuredClone(initial);
  next.channels[0]!.status = "published";

  assert.deepEqual(registrationActivityNotifications(previous, [next]), [
    "상품 A · 11번가 · KR: 완료",
  ]);
});

test("registration history outage preserves its notification baseline across recovery", () => {
  const initial = [activity("one", "상품 A", "publishing"), activity("two", "상품 B", "ready")];
  const hydrated = registrationActivityNotificationTransition(null, initial, "ready");
  assert.deepEqual(hydrated.messages, []);

  const unavailable = registrationActivityNotificationTransition(hydrated.statuses, [], "unavailable");
  assert.deepEqual(unavailable.messages, []);
  assert.strictEqual(unavailable.statuses, hydrated.statuses);

  const recovered = registrationActivityNotificationTransition(unavailable.statuses, initial, "ready");
  assert.deepEqual(recovered.messages, []);
  const changed = registrationActivityNotificationTransition(recovered.statuses, [
    activity("one", "상품 A", "completed"),
    activity("two", "상품 B", "ready"),
  ], "ready");
  assert.deepEqual(changed.messages, ["상품 A: 등록 완료"]);
});

test("ready registration cards are completed analysis drafts, not running work", () => {
  const ready = activity("ready", "분석 완료 상품", "ready");
  ready.updatedAt = "2026-08-25T00:00:35.000Z";
  ready.elapsedSeconds = 99_999;

  assert.equal(isRegistrationActivityRunning("analyzing"), true);
  assert.equal(isRegistrationActivityRunning("publishing"), true);
  assert.equal(isRegistrationActivityRunning("ready"), false);
  assert.equal(registrationActivityMatchesFilter(ready, "active"), false);
  assert.equal(registrationActivityMatchesFilter(ready, "ready"), true);
  assert.equal(registrationActivityDisplayElapsedSeconds(ready), 35);
  assert.equal(registrationChannelStatusLabel("paused"), "중지");
  assert.equal(registrationChannelStatusLabel("scope_excluded"), "제외");
});

test("registration progress uses terminal channel results and never invents an AI percentage", () => {
  const analyzing = activity("analysis", "분석 상품", "analyzing");
  analyzing.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(analyzing), {
    percent: null,
    label: "AI 분석 단계입니다. 채널 대상이 확정되면 실제 완료 비율을 표시합니다.",
  });

  const publishing = activity("publish", "등록 상품", "publishing");
  publishing.channelCount = 8;
  publishing.publishedCount = 2;
  publishing.failedCount = 1;
  publishing.blockedCount = 1;
  assert.deepEqual(registrationActivityProgress(publishing), {
    percent: 50,
    label: "8개 채널 중 4개 처리 결과를 확인했습니다.",
  });
  assert.equal(registrationActivityProgress(activity("done", "완료 상품", "completed")).percent, 100);
});

test("relative return paths cannot escape the SellerPilot origin", () => {
  assert.equal(safeRelativeReturnPath("/products?tab=active#one"), "/products?tab=active#one");
  assert.equal(safeRelativeReturnPath("//evil.example/path"), "/");
  assert.equal(safeRelativeReturnPath("/\\evil.example/path"), "/");
  assert.equal(safeRelativeReturnPath("/%2F%2Fevil.example/path"), "/");
  assert.equal(safeRelativeReturnPath("/%5Cevil.example/path"), "/");
  assert.equal(safeRelativeReturnPath("https://evil.example/path"), "/");
  assert.equal(safeRelativeReturnPath("/%E0%A4%A"), "/");
  assert.equal(safeRelativeReturnPath("/callback", new Set(["/callback"])), "/");
});

test("toast queue preserves separate events for two seconds instead of replacing them", () => {
  const first = appendToast([], "첫 이벤트", 1);
  const second = appendToast(first, "둘째 이벤트", 2);
  assert.deepEqual(second, [{ id: 1, message: "첫 이벤트" }, { id: 2, message: "둘째 이벤트" }]);
  assert.deepEqual(appendToast(second, "둘째 이벤트", 3), [
    { id: 1, message: "첫 이벤트" },
    { id: 2, message: "둘째 이벤트" },
    { id: 3, message: "둘째 이벤트" },
  ]);
  assert.equal(toastDurationMs, 2_000);
  assert.equal(toastToneForMessage("채널 등록 오류"), "error");
  assert.equal(toastToneForMessage("외부 권한 확인 필요"), "warning");
  assert.equal(toastToneForMessage("새 주문: Qoo10 123"), "info");
});

test("order, delivery, CS, and synchronization events all enter the notification queue", () => {
  const initial: OperationEventSnapshot = {
    orders: [{ id: "order-1", externalOrderId: "O-1", channelKey: "lazada", status: "paid" }],
    tickets: [{ id: "ticket-1", externalTicketId: "T-1", channelKey: "qoo10", status: "waiting" }],
    syncStatus: [{ channel_key: "shopee", data_type: "orders", status: "running" }],
  };
  assert.deepEqual(operationEventNotifications(null, initial), []);
  const next: OperationEventSnapshot = {
    orders: [
      { id: "order-1", externalOrderId: "O-1", channelKey: "lazada", status: "shipped" },
      { id: "order-2", externalOrderId: "O-2", channelKey: "elevenst", status: "paid" },
    ],
    tickets: [{ id: "ticket-1", externalTicketId: "T-1", channelKey: "qoo10", status: "resolved" }],
    syncStatus: [{ channel_key: "shopee", data_type: "orders", status: "passed" }],
  };
  assert.deepEqual(operationEventNotifications(operationEventState(initial), next), [
    "주문 상태 변경: lazada O-1 · 배송 중",
    "새 주문: elevenst O-2 · 결제 완료",
    "CS 상태 변경: qoo10 T-1 · 처리 완료",
    "shopee 주문 동기화 완료",
  ]);
});

test("product edit preserves sold-out stock and bounded promises cannot hang forever", async () => {
  const soldOut = productEditSchema.safeParse({
    researchInput: "https://example.com/product",
    productName: "품절 상품",
    sellerSku: "SOLD-OUT-1",
    categoryHint: "일반 상품",
    brandName: "No Brand",
    manufacturer: "공급처",
    countryOfOrigin: "대한민국",
    material: "제품 소재 정보",
    packageContents: "상품 1개",
    condition: "NEW",
    gtinStatus: "NO_GTIN",
    gtin: "",
    sellingPrice: 1000,
    currency: "KRW",
    stock: 0,
    weightKg: 0.1,
    packageLengthCm: 1,
    packageWidthCm: 1,
    packageHeightCm: 1,
    shippingFeeKrw: 0,
    shippingRule: "",
    packagingRule: "",
    description: "품절 상태를 유지한 채 다른 상품정보만 안전하게 수정하는 테스트 설명입니다.",
    productUrl: "https://example.com/product",
    imageRightsConfirmed: true,
    productFactsConfirmed: true,
  });
  assert.equal(soldOut.success, true);
  const unresolved = productEditSchema.safeParse({
    ...soldOut.data!,
    manufacturer: "공급처 확인 필요",
  });
  assert.equal(unresolved.success, false);
  await assert.rejects(withPromiseTimeout(new Promise(() => undefined), 1, "제한시간"), /제한시간/);
});

test("today dashboard routes and tablet overflow fix remain wired", async () => {
  const [page, publishWorkbench, mobileStyles, commerceStyles, studio, competitorScheduler, operationsSnapshotRoute, mobilePushManager] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
    readFile(new URL("../app/commerce-ux-refactor.css", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/competitor-prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/snapshot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-push-manager.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /onNavigate\("registration-activity"\)[^\n]*채널 등록 실패/);
  assert.match(page, /activityState === "unavailable"[\s\S]*등록 진행 이력을 불러오지 못했습니다/);
  assert.match(page, /signal: AbortSignal\.any\(\[productResearchController\.signal, AbortSignal\.timeout\(30_000\)\]\)/);
  assert.match(page, /withPromiseTimeout\(new Promise<\{ width: number; height: number \}>[\s\S]*?15_000[\s\S]*?모바일에서 이미지를 읽는 시간이 너무 오래 걸렸습니다/);
  assert.match(page, /settleWithConcurrency\(selected, 3,/);
  assert.match(page, /모바일 메모리를 보호하며 3장씩 처리/);
  assert.match(page, /for \(const url of objectUrls\) URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(page, /Promise\.allSettled\(selected\.map/);
  assert.match(page, /result\.failed === 0 && result\.reconciliationRequired === 0/);
  assert.doesNotMatch(page, /sellingPrice: current\.sellingPrice > 0 \? current\.sellingPrice : 5000/);
  assert.doesNotMatch(page, /brandName: text\("brandName", "No Brand"\)/);
  assert.doesNotMatch(page, /manufacturer: text\("manufacturer", "공급처 확인 필요"\)/);
  assert.match(page, /imageRightsConfirmed: typeof fields\.imageRightsConfirmed === "boolean" \? fields\.imageRightsConfirmed : false/);
  assert.match(page, /stock: current\.stock,[\s\S]{0,180}weightKg: current\.weightKg/);
  assert.match(page, /수정값은 중앙 상품 원장에 저장되며, 재고 변경은 연결된 채널에도 동기화/);
  assert.match(publishWorkbench, /<select required value=\{context\.manualFields\.packageContents\}/);
  assert.doesNotMatch(publishWorkbench, /판매 구성품[^\n]*<input/);
  assert.match(mobileStyles, /@media \(min-width: 901px\) and \(max-width: 1200px\)[\s\S]*?\.overview-toolbar[\s\S]*?flex-direction: column/);
  const narrowFixedSidebarMedia = cssMediaBody(mobileStyles, "(min-width: 901px) and (max-width: 1080px)");
  assert.match(narrowFixedSidebarMedia, /\.page-stack > \*,[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%/);
  assert.match(narrowFixedSidebarMedia, /\.daily-briefing,[\s\S]*?\.studio-workspace[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(narrowFixedSidebarMedia, /\.metric-grid,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(narrowFixedSidebarMedia, /\.dashboard-main-grid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(narrowFixedSidebarMedia, /\.commerce-service-rail[\s\S]*?overflow-x: auto/);
  const fixedSidebarLayout = (viewport: number) => viewport <= 900 ? "mobile" : viewport <= 1080 ? "narrow" : "wide";
  assert.deepEqual([900, 901, 1048, 1097, 1200].map(fixedSidebarLayout), ["mobile", "narrow", "narrow", "wide", "wide"]);
  assert.equal(1048 - 224 - 44, 780);
  assert.equal(1097 - 224 - 44 >= 780, true);
  assert.equal(1200 - 224 - 44 >= 780, true);
  assert.doesNotMatch(mobileStyles, /@media \(max-width: 360px\)[\s\S]*?\.user-menu\s*\{\s*display:\s*none/);
  assert.match(mobileStyles, /\.mobile-push-page-spacer[\s\S]*?height: 220px/);
  assert.match(mobilePushManager, /mobilePushDismissedKey/);
  assert.match(mobilePushManager, /sessionStorage\.setItem\(mobilePushDismissedKey, "1"\)/);
  assert.match(mobilePushManager, /className="mobile-push-gate-dismiss"[\s\S]*?나중에/);
  assert.match(mobilePushManager, /className="mobile-push-page-spacer"/);
  assert.match(studio, /fetchJsonWithStudioJobTimeout\([\s\S]*?lifecycleController\.signal, 30_000/);
  assert.match(studio, /controller\.abort\(new DOMException\("요청 제한시간을 초과했습니다\.", "TimeoutError"\)\)/);
  assert.doesNotMatch(studio, /onRunningChange\(true\)[\s\S]{0,900}activeJobs/);
  assert.match(studio, /shouldDisplayStudioJob\(\{[\s\S]*?displayJobId: displayJobId\.current/);
  assert.doesNotMatch(studio, /recovered \? displayRecoveredResult/);
  assert.match(studio, /productResponse\.status === 409 && productPayload\.code === "DUPLICATE_SELLER_SKU"/);
  assert.match(operationsSnapshotRoute, /mutationError\.code === "23505"/);
  assert.match(competitorScheduler, /searchCompetitorProviders\([\s\S]{0,120}registry,[\s\S]{0,80}product\.query,[\s\S]{0,80}product\.aliases/);
  assert.match(competitorScheduler, /sellerpilot_service_complete_competitor_price_refresh/);
  assert.match(page, /status: "searched" \| "unavailable" \| "failed" \| "pending"/);
  assert.match(page, /provider\.status === "pending" \? "조회 진행 중"/);
  assert.match(page, /competitorResearchControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /pollCompetitorResearch/);
  assert.match(page, /maxAttempts: 3/);
  assert.match(page, /runCompetitorResearchPolling\(competitorResearchRetryInput/);
  assert.match(page, /competitorResearchControllerRef\.current !== competitorController/);
  assert.match(page, /가격 다시 확인/);
  assert.match(page, /PRODUCT_RESEARCH_PENDING_KEY/);
  assert.match(page, /productResearchControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /detailRegenerationControllerRef = useRef<AbortController \| null>\(null\)/);
  assert.match(page, /detailRegenerationControllerRef\.current\?\.abort\(new DOMException\("상품 상세 화면이 닫혔습니다\.", "AbortError"\)\)/);
  assert.match(page, /authenticatedFetch\(`\/api\/ai\/jobs\/\$\{queued\.jobId\}`, \{ signal: controller\.signal \}\)/);
  assert.match(page, /await abortableBrowserDelay\(3_000, controller\.signal\)/);
  assert.doesNotMatch(page, /await new Promise\(\(resolve\) => window\.setTimeout\(resolve, 3_000\)\)/);
  assert.match(page, /AbortSignal\.any\(\[productResearchController\.signal, AbortSignal\.timeout\(30_000\)\]\)/);
  assert.match(page, /waitForAbortablePromise\(createSupabaseClient\(\)\.auth\.getSession\(\), sessionSignal\)/);
  assert.match(page, /if \(researchingProduct\)[\s\S]{0,160}1차 상품정보 확인을 마치거나 중단/);
  assert.match(page, /disabled=\{running \|\| researchingProduct \|\| Boolean\(queuedJobId\)\}/);
  assert.match(page, /payload\.status === "succeeded"[\s\S]{0,220}throw new ProductResearchTerminalError/);
  assert.match(page, /throw new ProductResearchTerminalError\(payload\.error\)/);
  assert.match(page, /shouldClearPendingProductResearch\(error\)/);
  assert.match(page, /확인 중단/);
  assert.match(commerceStyles, /\.competitor-retry button \{[^}]*min-height: 44px/);
  assert.match(commerceStyles, /@media \(max-width: 560px\)[\s\S]*?\.competitor-retry button \{ width: 100%; \}/);
});

test("390px registration, CS, preview, and notification surfaces keep their mobile contract", async () => {
  const mobileStyles = await readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8");

  assert.match(mobileStyles, /\.upload-panel\s*\{[\s\S]{0,120}?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(mobileStyles, /\.option-photo-grid\s*\{[\s\S]{0,120}?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /\.product-research-input button\s*\{[\s\S]{0,120}?width:\s*100%;[\s\S]{0,80}?max-width:\s*100%/);
  assert.match(mobileStyles, /\.registration-card-grid\s*\{[\s\S]{0,120}?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /\.registration-filter-strip button\s*\{[\s\S]{0,120}?min-height:\s*56px/);
  assert.match(mobileStyles, /\.pipeline-list > div\.interactive\s*\{[\s\S]{0,120}?min-height:\s*44px;[\s\S]{0,80}?touch-action:\s*manipulation/);
  assert.match(mobileStyles, /\.remove-photo-button,[\s\S]{0,100}?\.extra-photo-list > div > button\s*\{[\s\S]{0,100}?width:\s*44px;[\s\S]{0,80}?height:\s*44px/);
  assert.match(mobileStyles, /\.ticket-tabs\s*\{[\s\S]{0,100}?height:\s*auto;[\s\S]{0,80}?min-height:\s*44px/);
  assert.match(mobileStyles, /\.cs-workspace\.mobile-conversation-open \.mobile-back\s*\{[\s\S]{0,120}?width:\s*44px;[\s\S]{0,80}?height:\s*44px/);
  assert.match(mobileStyles, /\.detail-preview-scroll\s*\{[\s\S]{0,220}?overflow:\s*visible;[\s\S]{0,100}?touch-action:\s*pan-y/);
  assert.match(mobileStyles, /\.detail-preview-canvas img\s*\{[\s\S]{0,120}?pointer-events:\s*none/);
  assert.match(mobileStyles, /\.notification-popover > div:first-child button\s*\{[\s\S]{0,100}?min-width:\s*44px;[\s\S]{0,80}?min-height:\s*44px/);
  assert.match(mobileStyles, /\.toast\s*\{[\s\S]{0,180}?right:\s*max\(10px,[\s\S]{0,180}?left:\s*max\(10px,[\s\S]{0,100}?width:\s*auto/);
});
