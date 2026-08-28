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

test("channel write confirmations move focus, close on Escape, and restore their opener", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /confirmationOpenerRef\.current = document\.activeElement/);
  assert.match(source, /querySelector<HTMLButtonElement>\("\.publish-confirm-execute"\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /opener\?\.isConnected[\s\S]*?opener\.focus\(\)/);
  assert.equal((source.match(/aria-modal="true"/g) ?? []).length, 3);
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
  assert.match(listingRuntime, /input\.channel === "coupang" && input\.operation === "listing\.create"/);
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
