import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplaceGlobalBasePriceMissing,
  marketplaceListingCurrency,
  marketplaceListingPrice,
  mergeShopeeRequiredAttributes,
  normalizeEbayAspects,
  normalizeCoupangAttributeValue,
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
} from "../lib/channels/listing-normalization";
import { blockingListingRequirements } from "../lib/channels/listing-preflight";
import { classifyListingFailure } from "../lib/channels/listing-remediation";

test("KRW channels round positive prices up to the required ten-won unit", () => {
  assert.equal(normalizeTenWonAmount(99_999), 100_000);
  assert.equal(normalizeTenWonAmount("299"), "300");
  assert.equal(marketplaceListingPrice("coupang", 99_999), 100_000);
  assert.equal(marketplaceListingPrice("elevenst", 99_999, { globalBaseUsdPrice: 12.9 }), 100_000);
  assert.equal(marketplaceListingPrice("smartstore", 99_999), 100_000);
  assert.equal(marketplaceListingPrice("temu", 3_000), 3_000);
});

test("missing or invalid USD input never becomes the domestic amount in a foreign currency", () => {
  for (const channel of ["qoo10", "shopee", "lazada", "ebay"] as const) {
    for (const globalBaseUsdPrice of [undefined, 0, -1, Number.NaN, Infinity, -Infinity]) {
      assert.equal(marketplaceGlobalBasePriceMissing(channel, globalBaseUsdPrice), true);
      assert.equal(marketplaceListingPrice(channel, 3_000, { globalBaseUsdPrice }), 0);
    }
  }
  for (const channel of ["coupang", "elevenst", "smartstore", "temu"] as const) {
    assert.equal(marketplaceGlobalBasePriceMissing(channel, 0), false);
    assert.equal(marketplaceListingPrice(channel, 3_000, { globalBaseUsdPrice: 0 }), 3_000);
  }
});

test("an unpriced eBay draft is blocked while an explicit USD price passes the price requirement", () => {
  const draft = (globalBaseUsdPrice: number) => ({ offer: { pricingSummary: { price: {
    currency: "USD", value: String(marketplaceListingPrice("ebay", 3_000, { globalBaseUsdPrice })),
  } } } });
  assert.ok(blockingListingRequirements("ebay", draft(0)).some(item => item.key === "price"));
  assert.ok(!blockingListingRequirements("ebay", draft(2.25)).some(item => item.key === "price"));
  // Existing eBay content updates preserve provider pricing instead of writing
  // this draft field; zero must not acquire a new free-listing meaning.
  assert.ok(!blockingListingRequirements("ebay", draft(0), "listing.update").some(item => item.key === "price"));
});

test("global marketplaces use the existing reference conversion only with an explicit USD base", () => {
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
  assert.equal(normalizeCoupangAttributeValue(metadata, "3장"), "3개");
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

test("Shopee local publish preserves seller input and exposes mandatory attributes without allowed values", () => {
  const result = mergeShopeeRequiredAttributes([{ attribute_id: 10, attribute_value_list: [{ value_id: 99 }] }], [
    { attribute_id: 10, display_attribute_name: "Brand", is_mandatory: true, attribute_value_list: [{ value_id: 1, display_value_name: "No Brand" }] },
    { attribute_id: 11, display_attribute_name: "Compliance Code", is_mandatory: true, attribute_value_list: [] },
  ], "test product");
  assert.equal(result.attributes.length, 1);
  assert.deepEqual(result.unresolved, ["Compliance Code"]);
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
