import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { salesRangeForPreset } from "../app/_dashboard/sales-range-control";
import {
  controllableRegistrationActivityJobId,
  isCancelledRegistrationActivity,
  isRegistrationActivityRunning,
  isRegistrationImageActivity,
  recoverableRegistrationActivityJobId,
  retryableRegistrationActivityJobId,
  registrationActivityDisplayStatusLabel,
  registrationActivityDisplayElapsedSeconds,
  registrationActivityFilterFromValue,
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
import { resolveHydratedProductEditDraft } from "../app/product-edit-draft-fence";
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

test("only active AI activities expose a direct cancellable job id", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  assert.equal(controllableRegistrationActivityJobId(activity(`job:${jobId}`, "분석 중", "analyzing")), jobId);
  assert.equal(controllableRegistrationActivityJobId(activity(`revision:${jobId}`, "수정 중", "analyzing")), jobId);
  assert.equal(controllableRegistrationActivityJobId(activity(`asset:${jobId}`, "재제작 중", "analyzing")), jobId);
  assert.equal(controllableRegistrationActivityJobId(activity(`job:${jobId}`, "게시 중", "publishing")), null);
  assert.equal(controllableRegistrationActivityJobId(activity(`product:${jobId}`, "상품 분석", "analyzing")), null);
});

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

test("image and revision failures use truthful activity-aware labels in cards and notifications", () => {
  const assetFailure = activity("asset:11111111-1111-4111-8111-111111111111", "이미지 실패 상품", "failed");
  const revisionFailure = activity("revision:22222222-2222-4222-8222-222222222222", "수정 실패 상품", "failed");
  const registrationFailure = activity("product:33333333-3333-4333-8333-333333333333", "등록 실패 상품", "failed");

  assert.equal(isRegistrationImageActivity(assetFailure), true);
  assert.equal(isRegistrationImageActivity(revisionFailure), true);
  assert.equal(isRegistrationImageActivity(registrationFailure), false);
  assert.equal(registrationActivityDisplayStatusLabel(assetFailure), "이미지 재제작 실패");
  assert.equal(registrationActivityDisplayStatusLabel(revisionFailure), "상품 수정 작업 실패");
  assert.equal(registrationActivityDisplayStatusLabel(registrationFailure), "재시도 필요");
  assert.deepEqual(registrationActivityNotifications(new Map(), [assetFailure, revisionFailure]), [
    "이미지 실패 상품: 이미지 재제작 실패",
    "수정 실패 상품: 상품 수정 작업 실패",
  ]);
});

test("administrator cancellation is displayed as a resumable stop rather than an error", () => {
  const cancelled = activity("job:44444444-4444-4444-8444-444444444444", "중지 상품", "failed");
  cancelled.productId = null;
  cancelled.channelCount = 0;
  cancelled.message = "관리자가 작업을 취소했습니다.";

  assert.equal(isCancelledRegistrationActivity(cancelled), true);
  assert.equal(registrationActivityDisplayStatusLabel(cancelled), "작업 중지됨");
  assert.deepEqual(registrationActivityProgress(cancelled), {
    percent: 0,
    label: "관리자가 AI 작업을 중지했습니다. 외부 채널 전송은 시작하지 않았으며 기존 입력으로 다시 실행할 수 있습니다.",
  });
  assert.deepEqual(registrationActivityNotifications(new Map(), [cancelled]), ["중지 상품: 작업 중지됨"]);
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
  assert.equal(registrationActivityMatchesFilter(activity("failed", "재시도 상품", "failed"), "failed"), true);
  assert.equal(registrationActivityMatchesFilter(activity("blocked", "권한 상품", "blocked"), "failed"), false);
  assert.equal(registrationActivityMatchesFilter(activity("blocked", "권한 상품", "blocked"), "blocked"), true);
  assert.equal(registrationActivityFilterFromValue("failed"), "failed");
  assert.equal(registrationActivityFilterFromValue("blocked"), "blocked");
  assert.equal(registrationActivityFilterFromValue("attention"), "all");
  assert.equal(registrationActivityDisplayElapsedSeconds(ready), 35);
  assert.equal(registrationChannelStatusLabel("paused"), "중지");
  assert.equal(registrationChannelStatusLabel("scope_excluded"), "제외");
});

test("failed AI cards expose the exact retryable job while only orphan studio jobs need browser recovery", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const orphan = activity(`job:${jobId}`, "실패한 AI 상품", "failed");
  orphan.productId = null;
  assert.equal(recoverableRegistrationActivityJobId(orphan), jobId);
  assert.equal(retryableRegistrationActivityJobId(orphan), jobId);
  assert.equal(recoverableRegistrationActivityJobId({ ...orphan, status: "ready" }), null);
  assert.equal(recoverableRegistrationActivityJobId({ ...orphan, productId: jobId }), null);
  assert.equal(recoverableRegistrationActivityJobId({ ...orphan, id: "job:not-a-uuid" }), null);

  const revision = activity(`revision:${jobId}`, "중지한 상품 수정", "failed");
  const asset = activity(`asset:${jobId}`, "중지한 이미지 재제작", "failed");
  assert.equal(recoverableRegistrationActivityJobId(revision), null);
  assert.equal(recoverableRegistrationActivityJobId(asset), null);
  assert.equal(retryableRegistrationActivityJobId(revision), jobId);
  assert.equal(retryableRegistrationActivityJobId(asset), jobId);
  assert.equal(retryableRegistrationActivityJobId({ ...revision, status: "analyzing" }), null);
  assert.equal(retryableRegistrationActivityJobId({ ...revision, id: `product:${jobId}` }), null);
});

test("registration progress uses terminal channel results and never invents an AI percentage", () => {
  const analyzing = activity("analysis", "분석 상품", "analyzing");
  analyzing.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(analyzing), {
    percent: null,
    label: "AI 분석 단계입니다. 채널 대상이 확정되면 실제 완료 비율을 표시합니다.",
  });

  const imageOperation = activity("asset:11111111-1111-4111-8111-111111111111", "이미지 재제작", "analyzing");
  imageOperation.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(imageOperation), {
    percent: null,
    label: "AI 이미지 작업 진행 중 · 외부 판매채널 자동 게시 없음",
  });

  const ready = activity("ready", "분석 완료 상품", "ready");
  ready.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(ready), {
    percent: 100,
    label: "AI 분석이 완료되었습니다. 채널 등록 대상과 필수 정보를 확인해 주세요.",
  });

  const failed = activity("job:11111111-1111-4111-8111-111111111111", "분석 실패 상품", "failed");
  failed.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(failed), {
    percent: 0,
    label: "AI 분석을 완료하지 못했습니다. 오류를 확인한 뒤 기존 입력으로 다시 시작해 주세요.",
  });

  const failedImageOperation = activity("asset:22222222-2222-4222-8222-222222222222", "이미지 실패 상품", "failed");
  failedImageOperation.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(failedImageOperation), {
    percent: 0,
    label: "AI 이미지 작업을 완료하지 못했습니다. 기존 상품 이미지는 유지됩니다.",
  });

  const blocked = activity("blocked", "권한 대기 상품", "blocked");
  blocked.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(blocked), {
    percent: 0,
    label: "외부 권한 또는 필수값 보완이 필요해 작업이 중단되었습니다.",
  });

  const publishingWithoutChannel = activity("publishing", "채널 없는 등록 상품", "publishing");
  publishingWithoutChannel.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(publishingWithoutChannel), {
    percent: 0,
    label: "채널 등록 대상이 없어 진행률을 표시하지 않습니다.",
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
  const completedImageOperation = activity("revision:done", "완료 상품 수정", "completed");
  completedImageOperation.channelCount = 0;
  assert.deepEqual(registrationActivityProgress(completedImageOperation), {
    percent: 100,
    label: "해당 AI 이미지 작업이 완료됐습니다.",
  });
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
  assert.equal(toastToneForMessage("상품 A: AI 분석 중"), "info");
  assert.equal(toastToneForMessage("상품 B: 채널 등록 중"), "info");
  assert.equal(toastToneForMessage("상품 C: 채널 등록 준비"), "success");
  assert.equal(toastToneForMessage("3개 중 3개 등록 완료"), "success");
  assert.equal(toastToneForMessage("상품 처리 중단"), "warning");
  assert.equal(toastToneForMessage("카테고리 힌트를 입력해 주세요."), "warning");
  assert.equal(toastToneForMessage("대표사진 1장을 먼저 등록해 주세요."), "warning");
});

test("late product detail hydration never replaces an open or dirty edit draft", () => {
  const typedDraft = { productName: "사용자가 입력한 이름" };
  const serverDraft = { productName: "늦게 도착한 서버 이름" };
  assert.strictEqual(resolveHydratedProductEditDraft(typedDraft, serverDraft, { dialogOpen: true, dirty: false }), typedDraft);
  assert.strictEqual(resolveHydratedProductEditDraft(typedDraft, serverDraft, { dialogOpen: false, dirty: true }), typedDraft);
  assert.strictEqual(resolveHydratedProductEditDraft(typedDraft, serverDraft, { dialogOpen: false, dirty: false }), serverDraft);
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
  assert.match(page, /onNavigate\("registration-activity", "failed"\)[^\n]*등록·분석 재시도/);
  assert.match(page, /등록·분석 재시도/);
  assert.match(page, /\["failed", "오류 · 중지", counts\.failed\]/);
  assert.match(page, /대시보드의 등록·분석 재시도 수는 재시도 가능한 채널 대상과 AI 분석 작업 기준입니다/);
  assert.match(page, /상품 상세에서 이미지 재제작/);
  assert.match(page, /상품 상세에서 다시 수정/);
  assert.match(page, /params\.set\("status", nextRegistrationStatus\)/);
  assert.match(page, /registrationActivityFilterFromValue\(params\.get\("status"\) \?\? \(typeof state\.status === "string" \? state\.status : null\)\)/);
  assert.match(operationsSnapshotRoute, /reconcileRegistrationDashboardMetrics\(payload, payload\.registrationActivities/);
  assert.match(page, /activityState === "unavailable"[\s\S]*등록 진행 이력을 불러오지 못했습니다/);
  assert.match(page, /const enqueueScope = createPageAbortScope\(\[productResearchController\.signal\], 30_000/);
  assert.match(page, /signal: enqueueScope\.signal/);
  assert.match(page, /response\.json\(\)\.catch\(\(\) => \(\{ message: "AI 상품정보 요청 응답을 읽지 못했습니다\." \}\)\)[\s\S]{0,100}enqueueScope\.signal/);
  assert.match(page, /response\.json\(\)\.catch\(\(\) => \(\{ message: "AI 상품정보 상태를 읽지 못했습니다\." \}\)\)[\s\S]{0,100}pollScope\.signal/);
  assert.doesNotMatch(page, /AbortSignal\.timeout\(/);
  assert.match(page, /withPromiseTimeout\(new Promise<\{ width: number; height: number \}>[\s\S]*?15_000[\s\S]*?모바일에서 이미지를 읽는 시간이 너무 오래 걸렸습니다/);
  assert.match(page, /settleWithConcurrency\(candidates, 3,/);
  assert.match(page, /모바일 메모리를 보호하며 3장씩 처리/);
  assert.match(page, /for \(const url of objectUrls\) URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(page, /Promise\.allSettled\(selected\.map/);
  assert.match(page, /result\.failed === 0 && result\.reconciliationRequired === 0/);
  assert.doesNotMatch(page, /sellingPrice: current\.sellingPrice > 0 \? current\.sellingPrice : 5000/);
  assert.doesNotMatch(page, /brandName: text\("brandName", "No Brand"\)/);
  assert.doesNotMatch(page, /manufacturer: text\("manufacturer", "공급처 확인 필요"\)/);
  assert.match(page, /imageRightsConfirmed: typeof fields\.imageRightsConfirmed === "boolean" \? fields\.imageRightsConfirmed : false/);
  const researchDraftStart = page.indexOf("const nextIntake: ProductIntakeDraft = {");
  const researchDraftEnd = page.indexOf(
    "researchAppliedValuesRef.current = collectResearchAppliedValues",
    researchDraftStart,
  );
  assert.ok(researchDraftStart >= 0 && researchDraftEnd > researchDraftStart);
  const researchDraft = page.slice(researchDraftStart, researchDraftEnd);
  assert.match(researchDraft, /\.\.\.currentIntake/);
  assert.doesNotMatch(
    researchDraft,
    /\b(?:sellingPrice|stock|weightKg|packageLengthCm|packageWidthCm|packageHeightCm|shippingFeeKrw|shippingRule|packagingRule):/,
  );
  assert.match(page, /텍스트·가격·재고뿐 아니라 원본·대표·역할별 사진을 교체/);
  assert.match(page, /외부 채널에는 자동 게시하지 않습니다/);
  assert.match(page, /disabled=\{remoteListingState !== "ready" \|\| productRevision\?\.status === "pending"/);
  assert.match(page, /resolveHydratedProductEditDraft\(current, incomingEditDraft/);
  assert.match(page, /editDraftDirtyRef\.current = true;[\s\S]{0,120}setEditDraft/);
  assert.match(publishWorkbench, /<select required value=\{context\.manualFields\.packageContents\}/);
  assert.doesNotMatch(publishWorkbench, /판매 구성품[^\n]*<input/);
  assert.match(commerceStyles, /\.registration-filter-strip\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
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
  assert.match(competitorScheduler, /searchCompetitorProviders\([\s\S]{0,120}registry,[\s\S]{0,80}claimed\.query,[\s\S]{0,80}claimed\.aliases/);
  assert.match(competitorScheduler, /sellerpilot_service_complete_competitor_price_refresh/);
  assert.match(page, /status: "searched" \| "unavailable" \| "failed" \| "pending"/);
  assert.match(page, /brave_marketplace_web: "Shopee·Lazada·Temu 웹 검색"/);
  assert.match(page, /competitorProviders\.slice\(0, 4\)/);
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
  assert.match(page, /authenticatedJsonWithDeadline<[\s\S]{0,320}`\/api\/ai\/jobs\/\$\{monitoredJobId\}`[\s\S]{0,180}requestBudgetMs/);
  assert.match(page, /await abortableBrowserDelay\(delayMs, regenerationSignal\)/);
  assert.doesNotMatch(page, /await new Promise\(\(resolve\) => window\.setTimeout\(resolve, 3_000\)\)/);
  assert.match(page, /typeof AbortSignal\.any === "function"/);
  assert.match(page, /fallbackListeners[\s\S]{0,500}removeEventListener\("abort", listener\)/);
  assert.match(page, /enqueueScope\.dispose\(\)/);
  assert.match(page, /waitForAbortablePromise\(createSupabaseClient\(\)\.auth\.getSession\(\), sessionScope\.signal\)/);
  assert.match(page, /\.finally\(\(\) => sessionScope\.dispose\(\)\)/);
  assert.match(page, /if \(researchingProduct\)[\s\S]{0,160}1차 상품정보 확인을 마치거나 중단/);
  assert.match(page, /const competitorResearchBlocksAnalysis = isCompetitorResearchBlockingAnalysis\([\s\S]{0,160}pendingCompetitorBypassConfirmed/);
  assert.match(page, /if \(competitorResearchBlocksAnalysis\)[\s\S]{0,260}동일 상품 가격 확인이 끝난 뒤 상품 분석을 시작/);
  assert.match(page, /disabled=\{running \|\| researchingProduct \|\| photoSelectionsProcessing \|\| competitorResearchBlocksAnalysis \|\| Boolean\(queuedJobId\)\}/);
  assert.match(page, /가격 확인 중/);
  assert.match(page, /가격 없이 계속/);
  assert.match(page, /invalidatedExistingContext = interruptedResearch[\s\S]{0,180}competitorResearchState !== "idle"/);
  assert.match(page, /invalidatedExistingContext && competitorResearchState !== "stale"/);
  assert.match(page, /setCompetitorResearchState\(invalidatedExistingContext \? "stale" : "idle"\)/);
  assert.match(page, /const nextCompetitorRetryPath = buildCompetitorResearchRetryPath\(nextIntake\)/);
  assert.match(page, /const initialCompetitorResearchPath = buildCompetitorResearchRetryPath\([\s\S]{0,120}nextIntake,[\s\S]{0,160}result\.searchQueries\.map/);
  assert.match(page, /runCompetitorResearchPolling\(initialCompetitorResearchPath, \{ items: \[\], providers: \[\] \}\)/);
  assert.doesNotMatch(page, /const competitorQuery = suggestion\.productName/);
  assert.match(page, /clearUnchangedResearchAppliedValues\([\s\S]{0,180}researchAppliedValuesRef\.current/);
  assert.match(page, /researchAppliedValuesRef\.current = collectResearchAppliedValues\(/);
  assert.match(page, /shouldInvalidateCompetitorResearch\(String\(key\), currentIntake\[key\], value\)/);
  assert.match(page, /researchAppliedValuesRef\.current = \{\};[\s\S]{0,600}productResearchGenerationRef\.current \+= 1/);
  const templateStart = page.indexOf("const applyCommerceTemplate =");
  const intakeFieldStart = page.indexOf("const setIntakeField =", templateStart);
  assert.ok(templateStart >= 0 && intakeFieldStart > templateStart);
  const templateBlock = page.slice(templateStart, intakeFieldStart);
  assert.match(templateBlock, /const currentIntake = intakeRef\.current/);
  assert.match(templateBlock, /intakeRef\.current = nextTemplateIntake;\s*setIntake\(nextTemplateIntake\)/);
  assert.doesNotMatch(templateBlock, /setIntake\(\(current\)/);
  const automationStart = page.indexOf("const startAutomation =");
  const automationEnd = page.indexOf("const totalPhotoCount =", automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  const automationBlock = page.slice(automationStart, automationEnd);
  assert.match(automationBlock, /productIntakeSchema\.safeParse\(intakeRef\.current\)/);
  const studioResultStart = page.indexOf("onResultReady={(studioResult, productId, _jobId, submittedIntake) => {");
  const studioResultEnd = page.indexOf("<CategoryClassificationWorkbench", studioResultStart);
  assert.ok(studioResultStart >= 0 && studioResultEnd > studioResultStart);
  const studioResultBlock = page.slice(studioResultStart, studioResultEnd);
  assert.match(studioResultBlock, /Object\.is\(currentIntake\.productName, submittedIntake\.productName\)/);
  assert.match(studioResultBlock, /Object\.is\(currentIntake\.categoryHint, submittedIntake\.categoryHint\)/);
  assert.match(studioResultBlock, /Object\.is\(currentIntake\.description, submittedIntake\.description\)/);
  assert.match(studioResultBlock, /const nextIntake: ProductIntakeDraft = submittedIntake \?/);
  assert.match(studioResultBlock, /: currentIntake;[\s\S]{0,220}researchAppliedValuesRef\.current = collectResearchAppliedValues\([\s\S]{0,420}intakeRef\.current = nextIntake;\s*setIntake\(nextIntake\)/);
  assert.doesNotMatch(studioResultBlock, /setIntake\(\(current\)/);
  assert.match(page, /productResearchInputRef\.current\.trim\(\) !== researchInput/);
  assert.match(page, /competitorResearchControllerRef\.current\?\.abort\(new DOMException\("상품 식별 입력이 변경되었습니다\./);
  assert.match(page, /query: \(intake\.productName \|\| intake\.researchInput\)\.trim\(\)\.slice\(0, 160\)/);
  assert.match(page, /payload\.status === "succeeded"[\s\S]{0,220}throw new ProductResearchTerminalError/);
  assert.match(page, /throw new ProductResearchTerminalError\(payload\.error\)/);
  assert.match(
    await readFile(new URL("../app/api/ai/jobs/[id]/route.ts", import.meta.url), "utf8"),
    /job\.kind === "product_research"[\s\S]{0,180}productResearchFailureMessage\(job\.error\)/,
  );
  assert.match(page, /shouldClearPendingProductResearch\(error\)/);
  assert.match(page, /확인 중단/);
  assert.match(commerceStyles, /\.competitor-retry button \{[^}]*min-height: 44px/);
  assert.match(commerceStyles, /@media \(max-width: 560px\)[\s\S]*?\.competitor-retry button \{ width: 100%; \}/);
});

test("390px registration, CS, preview, and notification surfaces keep their mobile contract", async () => {
  const mobileStyles = await readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8");

  assert.match(mobileStyles, /\.publishing-steps\s*\{[\s\S]{0,180}?display:\s*grid;[\s\S]{0,180}?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[\s\S]{0,180}?overflow-x:\s*visible/);
  assert.match(mobileStyles, /\.publishing-steps li\s*\{[\s\S]{0,80}?min-width:\s*0/);
  assert.match(mobileStyles, /\.upload-panel\s*\{[\s\S]{0,120}?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(mobileStyles, /\.option-photo-grid\s*\{[\s\S]{0,120}?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /\.product-research-input button\s*\{[\s\S]{0,120}?width:\s*100%;[\s\S]{0,80}?max-width:\s*100%/);
  assert.match(mobileStyles, /\.registration-card-grid\s*\{[\s\S]{0,120}?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /\.registration-filter-strip button\s*\{[\s\S]{0,120}?min-height:\s*56px/);
  assert.match(mobileStyles, /\.registration-filter-strip\s*\{[\s\S]{0,80}?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /\.pipeline-list > div\.interactive\s*\{[\s\S]{0,120}?min-height:\s*44px;[\s\S]{0,80}?touch-action:\s*manipulation/);
  assert.match(mobileStyles, /\.remove-photo-button,[\s\S]{0,100}?\.extra-photo-list > div > button\s*\{[\s\S]{0,100}?width:\s*44px;[\s\S]{0,80}?height:\s*44px/);
  assert.match(mobileStyles, /\.ticket-tabs\s*\{[\s\S]{0,100}?height:\s*auto;[\s\S]{0,80}?min-height:\s*44px/);
  assert.match(mobileStyles, /\.cs-workspace\.mobile-conversation-open \.mobile-back\s*\{[\s\S]{0,120}?width:\s*44px;[\s\S]{0,80}?height:\s*44px/);
  assert.match(mobileStyles, /\.detail-preview-scroll\s*\{[\s\S]{0,220}?overflow:\s*visible;[\s\S]{0,100}?touch-action:\s*pan-y/);
  assert.match(mobileStyles, /\.detail-preview-canvas img\s*\{[\s\S]{0,120}?pointer-events:\s*none/);
  assert.match(mobileStyles, /\.notification-popover > div:first-child button\s*\{[\s\S]{0,100}?min-width:\s*44px;[\s\S]{0,80}?min-height:\s*44px/);
  assert.match(mobileStyles, /\.toast\s*\{[\s\S]{0,180}?right:\s*max\(10px,[\s\S]{0,180}?left:\s*max\(10px,[\s\S]{0,100}?width:\s*auto/);
  assert.match(mobileStyles, /\.toast-copy\s*\{[\s\S]{0,80}?min-width:\s*0/);
  assert.match(mobileStyles, /\.toast-copy > b,[\s\S]{0,80}?\.toast-copy > span\s*\{[\s\S]{0,80}?overflow-wrap:\s*anywhere/);
});
