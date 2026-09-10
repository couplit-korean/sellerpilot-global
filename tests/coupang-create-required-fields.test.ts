import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCoupangGeneralCreateRequiredFields,
  hasValidCoupangProductIdentifier,
  isValidCoupangGtin,
} from "../lib/product-registration/coupang/create-required-fields";

function body(overrides: Record<string, unknown> = {}) {
  return {
    brand: "SellerPilotBrand",
    items: [{
      itemName: "검증 옵션 1",
      externalVendorSku: "SELLERPILOT-SKU-001",
      barcode: "8802259030799",
      emptyBarcode: false,
      emptyBarcodeReason: "",
      modelNo: "",
      maximumBuyCount: 1,
      unitCount: 1,
      attributes: [{
        attributeTypeName: "수량",
        attributeValueName: "1개",
        exposed: "EXPOSED",
      }],
    }],
    ...overrides,
  };
}

test("Coupang general CREATE accepts brand, GTIN and a purchase option", () => {
  assert.doesNotThrow(() => assertCoupangGeneralCreateRequiredFields(body()));
});

test("Coupang general CREATE requires a brand and one real purchase option", () => {
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(body({ brand: "" })),
    /COUPANG_BRAND_REQUIRED_OR_INVALID/,
  );
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(body({ brand: "Seller Pilot(Brand)" })),
    /COUPANG_BRAND_REQUIRED_OR_INVALID/,
  );
  assert.doesNotThrow(() => assertCoupangGeneralCreateRequiredFields(body({
    brand: "Seller Pilot(Brand)",
    brandId: "KR-12345",
  })));
  const missingOption = body();
  (missingOption.items as Array<Record<string, unknown>>)[0].attributes = [{
    attributeTypeName: "검색 필터",
    attributeValueName: "값",
    exposed: "NONE",
  }];
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(missingOption),
    /COUPANG_PURCHASE_OPTION_REQUIRED/,
  );
});

test("Coupang GTIN validation accepts only standard lengths with a valid check digit", () => {
  assert.equal(isValidCoupangGtin("8802259030799"), true);
  assert.equal(isValidCoupangGtin("12345670"), true);
  for (const invalid of [
    "8802259030798",
    "123456789",
    "12345678901",
    "123456789012345",
    "880225903079X",
  ]) assert.equal(isValidCoupangGtin(invalid), false, invalid);
});

test("Coupang no-GTIN CREATE rejects an internal seller SKU disguised as modelNo", () => {
  const missingIdentifier = body();
  Object.assign((missingIdentifier.items as Array<Record<string, unknown>>)[0], {
    barcode: "",
    emptyBarcode: true,
    emptyBarcodeReason: "바코드가 없는 상품",
    modelNo: "SELLERPILOT-SKU-001",
  });
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(missingIdentifier),
    /COUPANG_PRODUCT_IDENTIFIER_CONFIRMATION_REQUIRED/,
  );

  (missingIdentifier.items as Array<Record<string, unknown>>)[0].modelNo = "BRAND-MODEL-2026";
  assert.doesNotThrow(() => assertCoupangGeneralCreateRequiredFields(missingIdentifier));
});

test("Coupang general CREATE enforces current stock and option-name limits", () => {
  const invalidStock = body();
  (invalidStock.items as Array<Record<string, unknown>>)[0].maximumBuyCount = 100_000;
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(invalidStock),
    /COUPANG_CREATE_STOCK_INVALID/,
  );

  const duplicateNames = body();
  const original = (duplicateNames.items as Array<Record<string, unknown>>)[0];
  (duplicateNames.items as Array<Record<string, unknown>>).push({
    ...structuredClone(original),
    externalVendorSku: "SELLERPILOT-SKU-002",
  });
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(duplicateNames),
    /COUPANG_ITEM_NAME_REQUIRED_OR_DUPLICATE/,
  );
});

test("Coupang rejects empty, malformed, missing and duplicate seller SKU items", () => {
  for (const items of [
    [],
    [null],
    ["not-an-item"],
  ]) {
    assert.throws(
      () => assertCoupangGeneralCreateRequiredFields(body({ items })),
      /COUPANG_CREATE_ITEMS_REQUIRED_OR_INVALID/,
    );
  }

  const missingSku = body();
  delete (missingSku.items as Array<Record<string, unknown>>)[0].externalVendorSku;
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(missingSku),
    /COUPANG_SELLER_SKU_REQUIRED_OR_DUPLICATE/,
  );

  const mixedSku = body();
  const valid = (mixedSku.items as Array<Record<string, unknown>>)[0];
  (mixedSku.items as Array<Record<string, unknown>>).push({
    ...structuredClone(valid),
    itemName: "검증 옵션 2",
    externalVendorSku: "",
  });
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(mixedSku),
    /COUPANG_SELLER_SKU_REQUIRED_OR_DUPLICATE/,
  );

  (mixedSku.items as Array<Record<string, unknown>>)[1].externalVendorSku = "SELLERPILOT-SKU-001";
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(mixedSku),
    /COUPANG_SELLER_SKU_REQUIRED_OR_DUPLICATE/,
  );
});

test("Coupang applies identifier and purchase-option requirements to every option", () => {
  const multiple = body();
  const first = (multiple.items as Array<Record<string, unknown>>)[0];
  (multiple.items as Array<Record<string, unknown>>).push({
    ...structuredClone(first),
    itemName: "검증 옵션 2",
    externalVendorSku: "SELLERPILOT-SKU-002",
    barcode: "8802259030798",
    modelNo: "REAL-MODEL-CANNOT-BYPASS-BAD-BARCODE",
  });
  assert.equal(
    hasValidCoupangProductIdentifier((multiple.items as Array<Record<string, unknown>>)[1]),
    false,
  );
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(multiple),
    /COUPANG_PRODUCT_IDENTIFIER_CONFIRMATION_REQUIRED/,
  );

  Object.assign((multiple.items as Array<Record<string, unknown>>)[1], {
    barcode: "",
    emptyBarcode: true,
    emptyBarcodeReason: "제조사 바코드 미부여",
    modelNo: "REAL-BRAND-MODEL-002",
    attributes: [{
      attributeTypeName: "검색필터",
      attributeValueName: "값",
      exposed: "NONE",
    }],
  });
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(multiple),
    /COUPANG_PURCHASE_OPTION_REQUIRED/,
  );
});
