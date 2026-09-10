import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedProductRegistrationManualFields,
  productRegistrationSourceFingerprint,
} from "../lib/product-registration/source-fingerprint";

function context() {
  return {
    product: { sku: "SKU-1", name: "상품", description: "설명" },
    manualFields: {
      stock: 3,
      currency: "krw",
      sellingPrice: 12_000,
      sellerSku: "SKU-1",
      productName: "상품",
    },
    detailPage: { version: 2 },
    assignments: [{
      channel: "coupang",
      market: "KR",
      categoryId: "123",
      providedAttributes: { 색상: "빨강", 재질: "면" },
    }],
  };
}

test("source fingerprint is stable across object key and assignment order", () => {
  const first = context();
  const second = {
    ...context(),
    manualFields: {
      productName: "상품",
      sellerSku: "SKU-1",
      sellingPrice: 12_000,
      currency: "krw",
      stock: 3,
    },
    assignments: [...context().assignments].reverse().map((assignment) => ({
      ...assignment,
      providedAttributes: { 재질: "면", 색상: "빨강" },
    })),
  };
  assert.equal(productRegistrationSourceFingerprint(first), productRegistrationSourceFingerprint(second));
  assert.deepEqual(
    normalizedProductRegistrationManualFields(first),
    normalizedProductRegistrationManualFields(second),
  );
});

test("source fingerprint changes when a registration source value changes", () => {
  const first = context();
  const second = context();
  second.manualFields.stock = 4;
  assert.notEqual(productRegistrationSourceFingerprint(first), productRegistrationSourceFingerprint(second));
});
