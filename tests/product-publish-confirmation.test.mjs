import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Qoo10 pause actions use controllable in-app confirmations", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /aria-label="Qoo10 거래대기 전환 최종 확인"/);
  assert.match(source, /aria-label="이전 Qoo10 상품 거래대기 최종 확인"/);
  assert.match(source, />거래대기로 변경</);
  assert.doesNotMatch(source, /원격 상품|실행 검수/);
});

test("market target operations use the credential that discovered those targets", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /setTargetCredentialIds\(\{ shopee: shopeePayload\.credentialId, lazada: lazadaPayload\.credentialId \}\)/);
  assert.match(source, /credentials\.find\(\(item\) => item\.id === credentialId && item\.channel === channel/);
  assert.doesNotMatch(source, /\.filter\(\(item\) => item\.status === "active" && item\.environment === "production"\)\s*\.map\(\(item\) => \[item\.channel, item\]\)/);
});

test("Shopee publishing receives an eventual-consistency timeout budget", async () => {
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const operations = await readFile(new URL("../lib/channels/operations.ts", import.meta.url), "utf8");

  assert.match(workbench, /item_status: "NORMAL"/);
  assert.doesNotMatch(workbench, /item_status: "UNLIST"/);
  assert.match(route, /export const maxDuration = 180/);
  assert.match(route, /channel === "shopee" && operation === "listing\.create" \? 150_000/);
  assert.match(operations, /attempt < 20/);
  assert.match(operations, /publishedItem\(20\)/);
});

test("Lazada variant values are nested under the official SKU saleProp node", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /saleProp: skuSaleAttributes/);
  assert.doesNotMatch(source, /Sku: \[\{ \.\.\.skuSaleAttributes/);
});
