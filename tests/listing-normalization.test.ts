import assert from "node:assert/strict";
import test from "node:test";
import { classifyListingFailure } from "../lib/channels/listing-remediation";
import {
  isLazadaBrandEnumerationError,
  lazadaSkuSaleAttributes,
  marketplaceListingCurrency,
  marketplaceListingPrice,
  mergeShopeeRequiredAttributes,
  naverUnitCapacity,
  normalizeEbayAspects,
  normalizeCoupangAttributeValue,
  normalizeLazadaSizeChartImages,
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
  shopeeLanguageSafeText,
} from "../lib/channels/listing-normalization";

test("Lazada retries only the private brand-enumeration rejection", () => {
  assert.equal(isLazadaBrandEnumerationError({ detail: [{ field: "p-20000", code: "CHK_CATPROP_CPV_NOT_ENUM" }] }), true);
  assert.equal(isLazadaBrandEnumerationError({ message: "Attribute value is not included in the dropdown list", field: "brand" }), true);
  assert.equal(isLazadaBrandEnumerationError({ code: "BIZ_CHECK_PROP_REQUIRED", field: "units" }), false);
});

test("KRW channels round positive prices up to the required ten-won unit", () => {
  assert.equal(normalizeTenWonAmount(99_999), 100_000);
  assert.equal(normalizeTenWonAmount("299"), "300");
  assert.equal(marketplaceListingPrice("coupang", 99_999), 100_000);
  assert.equal(marketplaceListingPrice("smartstore", 99_999), 100_000);
  assert.equal(marketplaceListingPrice("lazada", 299), 299);
});

test("global marketplaces derive a realistic local price from the USD base price", () => {
  assert.equal(marketplaceListingPrice("lazada", 99_999, { globalBaseUsdPrice: 12.9, targetCurrency: "MYR" }), 58.05);
  assert.equal(marketplaceListingPrice("shopee", 99_999, { globalBaseUsdPrice: 12.9, targetCurrency: "SGD" }), 16.77);
  assert.equal(marketplaceListingPrice("qoo10", 99_999, { globalBaseUsdPrice: 12.9 }), 1871);
  assert.equal(marketplaceListingPrice("ebay", 99_999, { globalBaseUsdPrice: 12.9 }), 12.9);
  assert.equal(marketplaceListingCurrency("lazada", "myr"), "MYR");
  assert.equal(marketplaceListingCurrency("coupang"), "KRW");
});

test("Coupang numeric attributes inherit the official category unit", () => {
  const metadata = { dataType: "NUMBER", basicUnit: "개", usableUnits: ["개", "박스", "세트"] };
  assert.equal(normalizeCoupangAttributeValue(metadata, "1"), "1개");
  assert.equal(normalizeCoupangAttributeValue(metadata, "2세트"), "2세트");
  assert.equal(normalizeCoupangAttributeValue(metadata, "3팩"), "3개");
  assert.equal(normalizeCoupangAttributeValue(metadata, "상품 상세 참조"), "1개");
});

test("Naver unit-price data follows the official category exception flag", () => {
  assert.deepEqual(naverUnitCapacity(["UNIT_PRICE"]), {
    unitPriceYn: true,
    totalCapacityValue: 500,
    unitCapacity: 100,
    indicationUnit: "g",
  });
  assert.deepEqual(naverUnitCapacity([]), { unitPriceYn: false });
});

test("Shopee local publish metadata fills mandatory enumerations missing from the global tree", () => {
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 7001,
    name: "Sets & Packages Type",
    mandatory: true,
    attribute_value_list: [
      { value_id: 1, name: "Other" },
      { value_id: 2, name: "Eye Makeup Set" },
    ],
  }], "makeup eyeshadow palette cosmetics");
  assert.deepEqual(result.attributes, [{ attribute_id: 7001, attribute_value_list: [{ value_id: 2 }] }]);
  assert.deepEqual(result.unresolved, []);
  assert.match(result.autoFilled[0] ?? "", /Sets & Packages Type/);
});

test("Coupang numeric options prefer an allowed unit over a display-only basic unit", () => {
  assert.equal(normalizeCoupangAttributeValue({
    dataType: "NUMBER",
    basicUnit: "개",
    usableUnits: ["정", "회분"],
  }, "1"), "1정");
});

test("Shopee local publish preserves seller input and exposes mandatory attributes without allowed values", () => {
  const result = mergeShopeeRequiredAttributes([{ attribute_id: 10, attribute_value_list: [{ value_id: 99 }] }], [
    { attribute_id: 10, display_attribute_name: "Brand", is_mandatory: true, attribute_value_list: [{ value_id: 1, display_value_name: "No Brand" }] },
    { attribute_id: 11, display_attribute_name: "Compliance Code", is_mandatory: true, attribute_value_list: [] },
  ], "test product");
  assert.equal(result.attributes.length, 1);
  assert.deepEqual(result.unresolved, ["Compliance Code"]);
});

test("Shopee local publish fills implicit enumerations and free-text dates whose mandatory flag is missing", () => {
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 12,
    display_attribute_name: "Drink Form",
    attribute_value_list: [
      { value_id: 120, display_value_name: "Whole Bean" },
      { value_id: 121, display_value_name: "Ground" },
    ],
  }, {
    attribute_id: 13,
    display_attribute_name: "Expiry Date",
    attribute_value_list: [],
  }], "roasted whole coffee beans", {
    implicitRequired: { "drink form": "Whole Bean", "expiry date": "19/08/2027" },
  });
  assert.deepEqual(result.attributes, [
    { attribute_id: 12, attribute_value_list: [{ value_id: 120 }] },
    { attribute_id: 13, attribute_value_list: [{ value_id: 0, original_value_name: "19/08/2027", value_unit: "" }] },
  ]);
  assert.deepEqual(result.unresolved, []);
  assert.match(result.autoFilled[0] ?? "", /Drink Form: Whole Bean/);
  assert.match(result.autoFilled[1] ?? "", /Expiry Date: 19\/08\/2027/);
});

test("Shopee ignores attributes mandatory only in other markets", () => {
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 100010,
    name: "shelf lifes",
    mandatory: true,
    mandatory_region: ["CO"],
    attribute_value_list: [{ value_id: 593, name: "12 Months" }],
  }], "Lipstick", { marketCode: "SG" });
  assert.deepEqual(result.attributes, []);
  assert.deepEqual(result.unresolved, []);
});

test("Shopee reads market requirements nested in attribute_info", () => {
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 61,
    name: "Expiry Date",
    mandatory: true,
    attribute_info: { mandatory_region: ["MX", "FR"] },
  }], "instant rice", { marketCode: "SG" });

  assert.deepEqual(result.attributes, []);
  assert.deepEqual(result.unresolved, []);
});

test("Shopee fills a category-specific mandatory enumeration even when metadata omits its mandatory flag", () => {
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 100522,
    name: "Bag Set",
    attribute_value_list: [
      { value_id: 1, display_value_name: "Yes" },
      { value_id: 2, display_value_name: "No" },
    ],
  }], "canvas tote bag", { implicitRequired: { "bag set": "No" }, marketCode: "SG" });

  assert.deepEqual(result.attributes, [{
    attribute_id: 100522,
    attribute_value_list: [{ value_id: 2 }],
  }]);
  assert.deepEqual(result.unresolved, []);
});

test("Shopee fills an apparel material requirement even when category metadata omits its mandatory flag", () => {
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 100013,
    name: "Material",
    attribute_value_list: [
      { value_id: 1, display_value_name: "Polyester" },
      { value_id: 2, display_value_name: "Cotton Blend" },
      { value_id: 3, display_value_name: "Cotton" },
    ],
  }, {
    attribute_id: 100014,
    name: "Plus Size",
    attribute_value_list: [
      { value_id: 10, display_value_name: "Yes" },
      { value_id: 11, display_value_name: "No" },
    ],
  }], "multicolor cotton blend t-shirt", {
    implicitRequired: { material: "Cotton Blend", "plus size": "No" },
    marketCode: "SG",
  });

  assert.deepEqual(result.attributes, [
    { attribute_id: 100013, attribute_value_list: [{ value_id: 2 }] },
    { attribute_id: 100014, attribute_value_list: [{ value_id: 11 }] },
  ]);
  assert.deepEqual(result.unresolved, []);
  assert.match(result.autoFilled[0] ?? "", /Material: Cotton Blend/);
  assert.match(result.autoFilled[1] ?? "", /Plus Size: No/);
});

test("eBay item aspects use string arrays and an accepted country enumeration", () => {
  assert.deepEqual(normalizeEbayAspects({
    Brand: "Unbranded",
    Shade: ["Assorted"],
    Empty: "",
    "Country/Region of Manufacture": "대한민국",
  }), {
    Brand: ["Unbranded"],
    Shade: ["Assorted"],
    "Country/Region of Manufacture": ["Korea, South"],
  });
});

test("Lazada migration rewrites images embedded in rich description HTML", () => {
  const source = "https://seller.example/detail.jpg";
  const target = "https://my-live-02.slatic.net/p/detail.jpg";
  const value = { Attributes: { description: `<p>detail</p><img src="${source}">` }, Images: { Image: [source] } };
  assert.deepEqual(replaceMarketplaceImageUrls(value, new Map([[source, target]])), {
    Attributes: { description: `<p>detail</p><img src="${target}">` },
    Images: { Image: [target] },
  });
});

test("Lazada size-chart fields always use a migrated public image URL", () => {
  assert.deepEqual(normalizeLazadaSizeChartImages({
    Attributes: { size_chart: "M: bust 90cm", color: "Blue" },
    Skus: [{ SizeChartImage: "invalid text" }],
  }, "https://my-live-02.slatic.net/p/detail-size.jpg"), {
    Attributes: { size_chart: "https://my-live-02.slatic.net/p/detail-size.jpg", color: "Blue" },
    Skus: [{ SizeChartImage: "https://my-live-02.slatic.net/p/detail-size.jpg" }],
  });
});

test("Lazada copies required color and size sales properties into each SKU", () => {
  assert.deepEqual(lazadaSkuSaleAttributes({
    color_family: "Blue",
    size: "Int:M",
    units: "1",
    dress_type: "Shirt Dresses",
    brand: "No Brand",
  }), { color_family: "Blue", size: "Int:M", units: "1" });
});

test("Shopee replaces an unsupported localized title with a market-safe fallback", () => {
  assert.equal(shopeeLanguageSafeText("Women's Denim Dress", "Fallback"), "Women's Denim Dress");
  assert.equal(
    shopeeLanguageSafeText("[업로드 테스트] 여성 데님 원피스", "Unbranded Dresses Sample Product Not For Sale"),
    "Unbranded Dresses Sample Product Not For Sale",
  );
});

test("an echoed Korean product name containing 이미지 does not misclassify a price error", () => {
  const remediation = classifyListingFailure({
    ok: false,
    channel: "coupang",
    operation: "listing.create",
    safeMessage: "쿠팡 WING listing.create 작업이 원격 오류로 종료됐습니다.",
    steps: [{ name: "listing.create", ok: false, status: 200, data: { message: "옵션([API TEST] 이미지 검증): 판매가는 최소 10원 단위로 입력가능합니다. (1원단위 입력 불가)" } }],
  });
  assert.equal(remediation?.code, "PRICE_OR_ATTRIBUTE_UNIT_REJECTED");
});
