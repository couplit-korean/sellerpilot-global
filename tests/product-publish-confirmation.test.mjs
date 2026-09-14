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
