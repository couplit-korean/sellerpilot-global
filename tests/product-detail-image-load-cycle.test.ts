import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productDetailImageLoadCycleKey } from "../lib/product-detail-image-load-cycle.ts";

const input = {
  productId: "fixture-product", version: 2, savedSource: "studio", selectedSource: "studio",
  assetUrls: { "detail-overview": "https://example.test/old", "detail-care": "https://example.test/care" },
};

test("same-version URL replacement invalidates the previous 8/8 load snapshot", () => {
  const previous = { cycle: productDetailImageLoadCycleKey(input), loaded: 8 };
  const nextCycle = productDetailImageLoadCycleKey({ ...input, assetUrls: { ...input.assetUrls, "detail-overview": "https://example.test/new" } });
  assert.notEqual(previous.cycle, nextCycle);
  assert.equal(previous.cycle === nextCycle ? previous.loaded : 0, 0);
});

test("data-only refresh and asset object ordering preserve the load cycle", () => {
  assert.equal(productDetailImageLoadCycleKey(input), productDetailImageLoadCycleKey({
    ...input, assetUrls: Object.fromEntries(Object.entries(input.assetUrls).reverse()),
  }));
});

test("product, version, source selection and missing URL each invalidate old readiness", () => {
  for (const change of [
    { productId: "another-product" }, { version: 3 }, { savedSource: "external" },
    { selectedSource: "external" }, { assetUrls: {} },
  ]) assert.notEqual(productDetailImageLoadCycleKey(input), productDetailImageLoadCycleKey({ ...input, ...change }));
});

test("saved detail preview binds its remount and state fence to the URL-aware cycle", async () => {
  const source = await readFile(new URL("../app/saved-product-detail-page.tsx", import.meta.url), "utf8");
  assert.match(source, /const detailImageLoadCycle = productDetailImageLoadCycleKey\(\{\s*productId,\s*version: detailPage\?\.version \?\? 0,\s*savedSource,\s*selectedSource,\s*assetUrls,/);
  assert.match(source, /imageLoadSnapshot\.cycle === detailImageLoadCycle/);
  assert.match(source, /key=\{`detail-image-load-\$\{detailImageLoadCycle\}`\}/);
});
