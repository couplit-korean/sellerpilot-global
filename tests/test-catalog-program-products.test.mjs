import assert from "node:assert/strict";
import test from "node:test";
import { testCatalogProgramProducts } from "../scripts/test-catalog-program-products.mjs";

test("test program is exactly six categories at 5,000 KRW and stock one", () => {
  assert.equal(testCatalogProgramProducts.length, 6);
  assert.deepEqual(
    testCatalogProgramProducts.map((product) => product.category),
    ["cosmetics", "beauty-tools", "food", "clothing", "toys", "health-supplement"],
  );
  for (const product of testCatalogProgramProducts) {
    assert.equal(product.sellingPrice, 5000);
    assert.equal(product.currency, "KRW");
    assert.equal(product.stock, 1);
    assert.equal(product.productFactsConfirmed, false);
    assert.equal(product.requiresProductFacts, true);
    assert.match(product.productName, /^\[API TEST · 판매금지\]/u);
  }
});
