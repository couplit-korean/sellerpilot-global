import assert from "node:assert/strict";
import test from "node:test";
import { classifyListingFailure } from "../lib/channels/listing-remediation";
import {
  isNonSaleTestListing,
  isLazadaBrandEnumerationError,
  lazadaSkuSaleAttributes,
  marketplaceListingCurrency,
  marketplaceListingDestination,
  marketplaceListingPresentation,
  marketplaceListingPrice,
  mergeShopeeRequiredAttributes,
  naverUnitCapacity,
  normalizeEbayAspects,
  normalizeCoupangAttributeValue,
  normalizeLazadaSizeChartImages,
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
  resolveShopeeGlobalItemId,
  shopeeLanguageSafeText,
  shopeeNeedsShelfLife,
} from "../lib/channels/listing-normalization";

test("test-only titles stay inactive while ordinary customer products are sellable", () => {
  assert.equal(isNonSaleTestListing("[업로드 테스트 · 판매금지] 스킨 토너"), true);
  assert.equal(isNonSaleTestListing("API TEST mug not for sale"), true);
  assert.equal(isNonSaleTestListing("저자극 수분 스킨 토너 200ml"), false);
});

test("listing links and customer labels never present seller-only ids as public URLs", () => {
  assert.equal(marketplaceListingPresentation("qoo10", "1216458662", "일반 상품").url, "https://www.qoo10.jp/g/1216458662");
  assert.equal(marketplaceListingPresentation("ebay", "800533354969", "일반 상품").url, "https://www.ebay.com/itm/800533354969");
  assert.equal(marketplaceListingPresentation("lazada", "14971941210", "일반 상품", "MY").url, "https://www.lazada.com.my/products/i14971941210.html");
  assert.equal(marketplaceListingPresentation("coupang", "16351551544", "일반 상품").url, undefined);
  assert.equal(marketplaceListingPresentation("smartstore", "13666210620", "일반 상품").url, undefined);
  assert.equal(marketplaceListingPresentation("coupang", "1", "[판매금지] 테스트").badge, "테스트 임시저장");
});

test("every published channel has a safe product or seller-center destination", () => {
  assert.deepEqual(marketplaceListingDestination("qoo10", "1216458662", "일반 상품"), {
    url: "https://www.qoo10.jp/g/1216458662",
    label: "상품 페이지",
    kind: "product",
  });
  assert.deepEqual(marketplaceListingDestination("coupang", "16351551544", "일반 상품"), {
    url: "https://wing.coupang.com/vendor-inventory/product/list",
    label: "판매자센터",
    kind: "management",
  });
  assert.equal(marketplaceListingDestination("smartstore", "13666210620", "일반 상품").url, "https://sell.smartstore.naver.com/#/products/origin-product-list");
  assert.equal(marketplaceListingDestination("shopee", "48366301456", "일반 상품", "SG").url, "https://seller.shopee.kr/portal/product/list/all");
  assert.equal(marketplaceListingDestination("temu", "900001", "일반 상품").url, "https://kr.seller.temu.com/home.html");
});

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

test("Shopee stock verification recovers a newly created global item id", () => {
  assert.equal(resolveShopeeGlobalItemId("existing-1", []), "existing-1");
  assert.equal(resolveShopeeGlobalItemId("", [{
    name: "global-item-create",
    data: { response: { global_item_id: 123456789 } },
  }]), "123456789");
  assert.equal(resolveShopeeGlobalItemId(undefined, [{
    name: "global-item-readback",
    data: { response: { global_item_list: [{ global_item_id: "987654321" }] } },
  }]), "987654321");
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

test("Shopee cosmetic toner publishing supplies the API-only shelf-life requirement", () => {
  assert.equal(shopeeNeedsShelfLife(100892, "BRING GREEN facial toner skincare"), true);
  assert.equal(shopeeNeedsShelfLife(999999, "laser printer toner cartridge"), false);
  const result = mergeShopeeRequiredAttributes([], [{
    attribute_id: 100010,
    name: "Shelf Life",
    mandatory: false,
    attribute_value_list: [
      { value_id: 580, name: "6 Months" },
      { value_id: 593, name: "12 Months" },
    ],
  }], "BRING GREEN facial toner skincare", {
    implicitRequired: { "shelf life": "12 Months" },
    marketCode: "SG",
  });
  assert.deepEqual(result.attributes, [{ attribute_id: 100010, attribute_value_list: [{ value_id: 593 }] }]);
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
