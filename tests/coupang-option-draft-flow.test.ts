import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments } from "../app/product-publish-workbench";
import {
  applyRegistrationPatches,
  registrationPatches,
  setRegistrationValue,
} from "../lib/channel-registration-form";
import { assertCoupangGeneralCreateRequiredFields } from "../lib/product-registration/coupang/create-required-fields";
import { compileCoupangOptionItems } from "../lib/product-registration/coupang/option-items";
import { executeCoupang } from "../lib/product-registration/channels/coupang";

const packageFields = { weight: 0.4, length: 20, width: 15, height: 8 };

function context(gtinStatus: "HAS_GTIN" | "NO_GTIN"):
  Parameters<typeof buildChannelArguments>[1] {
  return {
    product: {
      id: "1ed4acfc-7603-48ec-a638-241131e59358",
      externalCode: "COUPANG-OPTION-FLOW",
      sku: "COUPANG-OPTION-FLOW",
      name: "SellerPilot 옵션 검증 상품",
      description: "상품 등록 입력 저장 복원 검증",
      sourceUrl: null,
      status: "ready",
    },
    manualFields: {
      productName: "SellerPilot 옵션 검증 상품",
      description: "상품 등록 입력 저장 복원 검증",
      sellerSku: "COUPANG-OPTION-FLOW",
      categoryHint: "검증 카테고리",
      brandName: "SellerPilotBrand",
      manufacturer: "SellerPilot",
      countryOfOrigin: "대한민국",
      material: "검증 소재",
      packageContents: "상품 1개",
      condition: "NEW",
      gtinStatus,
      gtin: gtinStatus === "HAS_GTIN" ? "8802259030799" : "",
      sellingPrice: 10_000,
      currency: "KRW",
      stock: 2,
      shippingFeeKrw: 3_000,
      shippingRule: "판매자 확인 주문 기준 2영업일 출고",
      packagingRule: "완충재 포장",
      weightKg: 0.4,
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 8,
    },
    assignments: [{
      channel: "coupang",
      market: "KR",
      categoryId: "59631",
      categoryPath: ["검증", "카테고리"],
      providedAttributes: { 수량: "1개" },
      requiredAttributes: [],
      officialMetadata: {},
      status: "confirmed",
      confirmedAt: "2026-09-09T00:00:00.000Z",
    }],
    imageSpecs: [],
    listings: [],
    sourceImages: [{ path: "original.jpg", url: "https://example.com/original.jpg" }],
    generatedImages: [],
    localizedListings: [],
    detailData: null,
    contentMode: "manual_mvp",
  };
}

function baseDraft(gtinStatus: "HAS_GTIN" | "NO_GTIN") {
  const draft = buildChannelArguments(
    "coupang",
    context(gtinStatus),
    10_000,
    2,
    undefined,
    packageFields,
    10,
  ) as Record<string, unknown>;
  draft.sellerpilotCoupangBaseSku = "COUPANG-OPTION-FLOW";
  return draft;
}

test("single-option draft keeps GTIN, purchase values, SKU and unit count through compile", () => {
  const base = baseDraft("HAS_GTIN");
  const body = compileCoupangOptionItems(base.body as Record<string, unknown>, []);
  const item = (body.items as Array<Record<string, unknown>>)[0];
  assert.equal(body.brand, "SellerPilotBrand");
  assert.equal(item.externalVendorSku, "COUPANG-OPTION-FLOW");
  assert.equal(item.barcode, "8802259030799");
  assert.equal(item.modelNo, "", "the internal seller SKU must never be sent as a model number");
  assert.equal(item.unitCount, 1);
  assert.deepEqual(item.attributes, [{ attributeTypeName: "수량", attributeValueName: "1개" }]);
});

test("NO_GTIN automatic SKU-as-model default is cleared instead of being presented as valid", () => {
  const base = baseDraft("NO_GTIN");
  const body = compileCoupangOptionItems(base.body as Record<string, unknown>, []);
  const item = (body.items as Array<Record<string, unknown>>)[0];
  assert.equal(item.externalVendorSku, "COUPANG-OPTION-FLOW");
  assert.equal(item.modelNo, "");
  assert.throws(
    () => assertCoupangGeneralCreateRequiredFields(body),
    /COUPANG_PRODUCT_IDENTIFIER_CONFIRMATION_REQUIRED/,
  );
});

test("two seller option rows survive patch save/restore and compile into exact provider items", () => {
  const before = baseDraft("NO_GTIN");
  const optionRows = [{
    skuSuffix: "RED-M",
    itemName: "SellerPilot 옵션 검증 상품 빨강 M",
    barcode: "",
    modelNo: "MODEL-RED-M",
    emptyBarcodeReason: "제조사 바코드 미부여",
    salePrice: 10_000,
    stock: 2,
    unitCount: 1,
    purchaseOptions: [{ name: "색상", value: "빨강" }, { name: "사이즈", value: "M" }],
  }, {
    skuSuffix: "BLUE-L",
    itemName: "SellerPilot 옵션 검증 상품 파랑 L",
    barcode: "12345670",
    modelNo: "",
    emptyBarcodeReason: "",
    salePrice: 11_000,
    stock: 3,
    unitCount: 1,
    purchaseOptions: [{ name: "색상", value: "파랑" }, { name: "사이즈", value: "L" }],
  }];
  const edited = setRegistrationValue(before, ["facts", "coupangOptionRows"], optionRows);
  const savedPatches = registrationPatches(before, edited);
  const regenerated = baseDraft("NO_GTIN");
  const restored = applyRegistrationPatches(regenerated, savedPatches);
  assert.deepEqual((restored.facts as Record<string, unknown>).coupangOptionRows, optionRows);

  const compiled = compileCoupangOptionItems(
    restored.body as Record<string, unknown>,
    (restored.facts as Record<string, unknown>).coupangOptionRows,
    restored.sellerpilotCoupangBaseSku,
  );
  assert.doesNotThrow(() => assertCoupangGeneralCreateRequiredFields(compiled));
  const items = compiled.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.externalVendorSku), [
    "COUPANG-OPTION-FLOW-RED-M",
    "COUPANG-OPTION-FLOW-BLUE-L",
  ]);
  assert.deepEqual(items.map((item) => [item.salePrice, item.maximumBuyCount, item.unitCount]), [
    [10_000, 2, 1],
    [11_000, 3, 1],
  ]);
  assert.deepEqual((items[0].attributes as Array<Record<string, unknown>>).slice(-2), [
    { attributeTypeName: "색상", attributeValueName: "빨강", exposed: "EXPOSED" },
    { attributeTypeName: "사이즈", attributeValueName: "M", exposed: "EXPOSED" },
  ]);
  assert.equal(items[0].modelNo, "MODEL-RED-M");
  assert.equal(items[1].barcode, "12345670");

  const preparedItems = compiled.items as Array<Record<string, unknown>>;
  preparedItems[0].images = [{ vendorPath: "https://example.com/red.jpg" }];
  preparedItems[0].sellerpilotMetadataMarker = "RED";
  preparedItems[1].images = [{ vendorPath: "https://example.com/blue.jpg" }];
  preparedItems[1].sellerpilotMetadataMarker = "BLUE";
  const repeated = compileCoupangOptionItems(
    compiled,
    optionRows,
    restored.sellerpilotCoupangBaseSku,
  );
  const repeatedItems = repeated.items as Array<Record<string, unknown>>;
  assert.deepEqual(repeatedItems.map((item) => item.images), [
    [{ vendorPath: "https://example.com/red.jpg" }],
    [{ vendorPath: "https://example.com/blue.jpg" }],
  ]);
  assert.deepEqual(repeatedItems.map((item) => item.sellerpilotMetadataMarker), ["RED", "BLUE"]);
  assert.deepEqual(repeated, compiled, "provider preparation and executor can compile idempotently");
});

test("base SKU ending in the selected suffix is never shortened by inference", () => {
  const draft = baseDraft("HAS_GTIN");
  const body = draft.body as { items: Array<Record<string, unknown>> };
  body.items[0].externalVendorSku = "CP-RED-M";
  const rows = [{
    skuSuffix: "RED-M",
    itemName: "접미사 충돌 검증 옵션",
    barcode: "8802259030799",
    modelNo: "",
    emptyBarcodeReason: "",
    salePrice: 10_000,
    stock: 2,
    unitCount: 1,
    purchaseOptions: [{ name: "색상", value: "빨강" }],
  }];
  const compiled = compileCoupangOptionItems(draft.body as Record<string, unknown>, rows, "CP-RED-M");
  assert.equal((compiled.items as Array<Record<string, unknown>>)[0].externalVendorSku, "CP-RED-M-RED-M");
  assert.deepEqual(compileCoupangOptionItems(compiled, rows, "CP-RED-M"), compiled);
});

test("malformed option facts and coercible nonnumeric values fail before provider access", async () => {
  const draft = baseDraft("HAS_GTIN");
  const validRow = {
    skuSuffix: "ONE",
    itemName: "검증 옵션",
    barcode: "8802259030799",
    modelNo: "",
    emptyBarcodeReason: "",
    salePrice: 10_000,
    stock: 2,
    unitCount: 1,
    purchaseOptions: [{ name: "색상", value: "빨강" }],
  };
  for (const [field, invalid] of [["salePrice", true], ["stock", false], ["unitCount", {}]] as const) {
    assert.throws(
      () => compileCoupangOptionItems(
        draft.body as Record<string, unknown>,
        [{ ...validRow, [field]: invalid }],
        draft.sellerpilotCoupangBaseSku,
      ),
      /COUPANG_OPTION_PRICE_STOCK_UNIT_INVALID/,
    );
  }

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ code: "SUCCESS" });
  };
  try {
    await assert.rejects(executeCoupang({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00098765", access_key: "access", secret_key: "secret" },
      arguments: { ...draft, facts: { coupangOptionRows: true } },
      environment: "production",
    }), /COUPANG_OPTION_ROWS_INVALID/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
