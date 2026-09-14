import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments } from "../app/product-publish-workbench";

function context(): Parameters<typeof buildChannelArguments>[1] {
  return {
    product: { id: "brand-fixture", externalCode: "BRAND", sku: "BRAND", name: "Fixture beverage", description: "Fixture description", sourceUrl: null, status: "ready" },
    manualFields: { productName: "Fixture beverage", description: "Fixture description", sellerSku: "BRAND", categoryHint: "Beverages", brandName: "Unverified manual spelling", manufacturer: "Fixture manufacturer", countryOfOrigin: "KR", material: "", packageContents: "500ml bottle", condition: "NEW", gtinStatus: "NO_GTIN", gtin: "", sellingPrice: 3000, currency: "KRW", stock: 10, shippingFeeKrw: 3000, shippingRule: "", packagingRule: "", weightKg: 0.6, packageLengthCm: 8, packageWidthCm: 8, packageHeightCm: 25 },
    contentMode: "manual_mvp", imageSpecs: [], assignments: [{ channel: "lazada", market: "MY", categoryId: "fixture-category", categoryPath: ["Beverages"], providedAttributes: { brand: "fixture-official-id", flavour: "Original" }, status: "confirmed", confirmedAt: "2026-09-14T00:00:00Z" }], listings: [], sourceImages: [{ path: "fixture.jpg", url: "https://example.com/fixture.jpg" }], generatedImages: [], localizedListings: [], detailData: null,
  };
}
function attributes(input: ReturnType<typeof context>) {
  const draft = buildChannelArguments("lazada", input, 3000, 10, undefined, { weight: 0.6, length: 8, width: 8, height: 25 }, 2);
  return (draft as { request: { Request: { Product: { Attributes: Record<string, unknown> } } } }).request.Request.Product.Attributes;
}

test("Lazada confirmed category brand survives manual spelling and preserves other selected attributes", () => {
  const input = context();
  const before = structuredClone(input);
  const result = attributes(input);
  assert.equal(result.brand, "fixture-official-id");
  assert.equal(result.flavour, "Original");
  assert.deepEqual(input, before);
});

test("Lazada manual registration retains its existing brand when no confirmed category brand is supplied", () => {
  for (const value of [undefined, "", "   "]) {
    const input = context();
    if (value === undefined) delete input.assignments[0].providedAttributes.brand;
    else input.assignments[0].providedAttributes.brand = value;
    assert.equal(attributes(input).brand, input.manualFields.brandName);
  }
  const input = context();
  input.assignments[0].status = "draft";
  assert.equal(attributes(input).brand, input.manualFields.brandName);
});
