import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Qoo10 pause actions use controllable in-app confirmations", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /aria-label="Qoo10 거래대기 전환 최종 확인"/);
  assert.match(source, /Qoo10 거래대기 전환 실행/);
  assert.doesNotMatch(source, /이전 Qoo10 상품 거래대기|이전 상품 거래대기 실행/);
  assert.match(source, /qoo10StopConfirming\.remoteId === listing\.remoteId/);
});

test("inline channel write confirmations move focus without claiming modal isolation", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /confirmationOpenerRef\.current = document\.activeElement/);
  assert.match(source, /querySelector<HTMLButtonElement>\("\.credential-secondary"\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /opener\?\.isConnected[\s\S]*?opener\.focus\(\)/);
  assert.equal((source.match(/className="publish-write-confirmation(?: channel)?" role="alertdialog"/g) ?? []).length, 4);
  assert.equal((source.match(/className="publish-write-confirmation(?: channel)?"[^>]*aria-modal="true"/g) ?? []).length, 0);
});

test("Temu contained QA has one explicit immutable final activation confirmation", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /listing\.requestedPublicationIntent === "safe_test"/);
  assert.match(source, /\["non_public", "withdrawn"\]\.includes\(listing\.remoteVisibility/);
  assert.match(source, /aria-label="Temu 최종 공개 승격 확인"/);
  assert.match(source, /operation: "listing\.activate"/);
  assert.match(source, /resourceListingId: listing\.id/);
  assert.match(source, /payload\.publicationFulfilled !== true[\s\S]*?payload\.remoteState\?\.visibility !== "live"/);
  assert.match(source, /phase: "pending_review"/);
  assert.match(source, /const temuActivationLocked = result\.operation === "listing\.activate"/);
  assert.doesNotMatch(source, /temuActivationLedgerEligible[\s\S]{0,180}disabled=\{[^}]*\["queued", "running", "pending_review", "blocked", "succeeded"\]\.includes\(result\.phase\)/);
  assert.match(source, /Temu 실제 판매 공개 승격 실행/);
});

test("FINAL registration binds live intent and serializes provider writes", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /const publicationIntent = operation === "listing\.create"[\s\S]*?"live" as const/);
  assert.match(source, /const mutationContract = \{[\s\S]*?publicationIntent,/);
  assert.match(source, /body: JSON\.stringify\(\{[\s\S]*?channel,[\s\S]*?operation,[\s\S]*?publicationIntent,[\s\S]*?idempotencyKey: `listing:/);
  assert.match(source, /executeChannelWritesSequentially\([\s\S]*?readyChannels,[\s\S]*?executeChannel\(channel/);
  assert.doesNotMatch(source, /Promise\.all\(readyChannels\.map\([\s\S]*?executeChannel/);
  assert.match(source, /확인 후 순차 실행/);
  assert.match(source, /판매중지 readback이 확인된 Temu QA는 공개 게시 성공으로 집계하지 않습니다/);
});

test("HTTP 202 publication review is visible and cannot fall through as success", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /isPublicationPendingReviewResponse\(response\.status, payload\)[\s\S]*?phase: "pending_review"/);
  assert.match(source, /심사 대기 · 공개 게시 성공 0건/);
  assert.match(source, /return false;[\s\S]*?response\.status === 202 && payload\.inProgress === true/);
  assert.match(source, /result\.phase === "pending_review"/);
});

test("create and content update both require all eight localized detail images", async () => {
  const source = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");

  assert.match(source, /expectedPublicationImageCount = operation === "listing\.create"/);
  assert.match(source, /\|\| operation === "listing\.update"/);
  assert.match(source, /\|\| operation === "listing\.activate"[\s\S]*?marketplaceChannelDetailImageCount/);
});

test("Coupang listing preflight never creates an unconfirmed shipping place", async () => {
  const [worker, listingRuntime] = await Promise.all([
    readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/provider-listing-runtime.ts", import.meta.url), "utf8"),
  ]);

  assert.match(listingRuntime, /COUPANG_USABLE_OUTBOUND_CENTER_MISSING/);
  assert.doesNotMatch(`${worker}\n${listingRuntime}`, /shippingPlaceName: "SellerPilot API 출고지"/);
  assert.doesNotMatch(`${worker}\n${listingRuntime}`, /COUPANG_OUTBOUND_CREATE_FAILED/);
  assert.match(worker, /prepareMarketplaceListingArguments\(\{/);
  assert.match(
    listingRuntime,
    /input\.channel === "coupang" && \(input\.operation === "listing\.create"/,
  );
  assert.match(
    listingRuntime,
    /\|\| coupangExactQaRecoveryBinding\(input\.arguments, "listing\.update"\)\)/,
  );
});

test("eBay market listings use one market-specific SKU for inventory and offer", async () => {
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
  const operations = await readFile(new URL("../lib/channels/operations.ts", import.meta.url), "utf8");

  assert.match(workbench, /sku: marketSku,[\s\S]*?offer: \{ sku: marketSku,/);
  assert.match(operations, /const offer = structuredClone[\s\S]*?offer\.sku = sku;/);
});

test("Lazada listings publish active with localized package content", async () => {
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(workbench, /package_content: title\.slice\(0, 255\), Status: "active"/);
  assert.doesNotMatch(workbench, /Status: "inactive"/);
});

test("eBay material aspects translate common Korean source values to English", async () => {
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(workbench, /"세라믹": "Ceramic"/);
  assert.match(workbench, /Material: englishEbayMaterial\(assignment\?\.providedAttributes\.Material \|\| manual\.material\)/);
});

test("listing image normalization binds every uploaded asset to its claimed attempt and product", async () => {
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const lifecycleBindings = route.match(/prepareMarketplaceImages\(serviceClient, channel, effectiveArguments, \{[\s\S]{0,220}?attemptId,[\s\S]{0,220}?productId: parsed\.data\.productId![\s\S]{0,220}?market: parsed\.data\.market,[\s\S]{0,220}?targetId: parsed\.data\.targetId,[\s\S]{0,80}?\}\)/g) ?? [];
  assert.equal(lifecycleBindings.length, 2);
});
