import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Qoo10 pause actions use controllable in-app confirmations", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /aria-label="Qoo10 거래대기 전환 최종 확인"/);
  assert.match(source, /aria-label="이전 Qoo10 상품 거래대기 최종 확인"/);
  assert.match(source, /Qoo10 거래대기 전환 실행/);
  assert.match(source, /이전 상품 거래대기 실행/);
});

test("channel write confirmations move focus, close on Escape, and restore their opener", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /confirmationOpenerRef\.current = document\.activeElement/);
  assert.match(source, /querySelector<HTMLButtonElement>\("\.publish-confirm-execute"\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /opener\?\.isConnected[\s\S]*?opener\.focus\(\)/);
  assert.equal((source.match(/aria-modal="true"/g) ?? []).length, 4);
});

test("Coupang listing preflight never creates an unconfirmed shipping place", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");

  assert.match(worker, /COUPANG_USABLE_OUTBOUND_CENTER_MISSING/);
  assert.doesNotMatch(worker, /shippingPlaceName: "SellerPilot API 출고지"/);
  assert.doesNotMatch(worker, /COUPANG_OUTBOUND_CREATE_FAILED/);
  assert.match(worker, /job\.channel === "coupang" && job\.operation === "listing\.create"/);
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
