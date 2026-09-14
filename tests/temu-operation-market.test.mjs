import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
const start = source.indexOf("function channelOperationMarket(");
const end = source.indexOf("type LegacyQoo10TitleReferenceRepair", start);
assert.ok(start >= 0 && end > start);
const implementation = stripTypeScriptTypes(source.slice(start, end));
const operationMarket = runInNewContext(`${implementation}; channelOperationMarket`);

test("Temu request defaults only its missing operation market to KR", () => {
  assert.equal(operationMarket("temu", undefined), "KR");
  assert.equal(operationMarket("qoo10", undefined), "JP");
  for (const channel of ["coupang", "elevenst", "smartstore", "shopee", "lazada", "ebay"]) {
    assert.equal(operationMarket(channel, undefined), "", channel);
  }
  assert.equal(operationMarket("temu", { marketCode: "MY" }), "MY");
});

test("actual channel request assembly uses the operation market resolver", () => {
  assert.match(source, /const operationMarket = channelOperationMarket\(channel, target\);/u);
  assert.match(source, /market: operationMarket,/u);
});
