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

test("market target operations use the credential that discovered those targets", async () => {
  const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(source, /setTargetCredentialIds\(\{ shopee: shopeePayload\.credentialId, lazada: lazadaPayload\.credentialId \}\)/);
  assert.match(source, /credentials\.find\(\(item\) => item\.id === credentialId && item\.channel === channel/);
  assert.doesNotMatch(source, /\.filter\(\(item\) => item\.status === "active" && item\.environment === "production"\)\s*\.map\(\(item\) => \[item\.channel, item\]\)/);
});
