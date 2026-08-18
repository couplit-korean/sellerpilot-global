import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplaceListingCurrency,
  marketplaceListingPrice,
  normalizeCoupangAttributeValue,
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
} from "../lib/channels/listing-normalization";
import { classifyListingFailure } from "../lib/channels/listing-remediation";

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
