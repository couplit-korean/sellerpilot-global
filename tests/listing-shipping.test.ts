import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments, buildSynchronizedDraftMap, inspectWorkbenchListingDraft, normalizeManualFields } from "../app/product-publish-workbench";
import { activeChannelKeys, type ActiveChannelKey } from "../lib/channels/catalog";
import {
  assertListingShippingReady,
  listingShippingAmount,
  listingShippingDraftSource,
  listingShippingRequirements,
  smartstoreShippingDraft,
  validatedCoupangShippingFees,
  validatedSmartstoreShippingInfo,
} from "../lib/channels/listing-shipping";

type Context = Parameters<typeof buildChannelArguments>[1];
function context(): Context {
  return {
    product: { id: "shipping-product", externalCode: "SHIPPING", sku: "SHIPPING", name: "배송 검증 상품", description: "배송 정책 검증 상품 설명", sourceUrl: null, status: "ready" },
    manualFields: {
      productName: "배송 검증 상품", description: "배송 정책 검증 상품 설명", sellerSku: "SHIPPING", categoryHint: "생활용품", brandName: "확인 브랜드", manufacturer: "확인 제조사", countryOfOrigin: "대한민국", material: "실리콘", packageContents: "상품 1개", condition: "NEW", gtinStatus: "NO_GTIN", gtin: "", sellingPrice: 10_000, currency: "KRW", stock: 3,
      shippingFeeKrw: 3_500, shippingRule: "  5만원 이상 무료\n제주 추가 3천원  ", packagingRule: "에어캡 두 겹 + 박스",
      weightKg: 0.2, packageLengthCm: 10, packageWidthCm: 8, packageHeightCm: 4,
    },
    contentMode: "manual_mvp", imageSpecs: [], assignments: [], listings: [], sourceImages: [{ path: "product.jpg", url: "https://images.example.com/product.jpg" }], generatedImages: [], localizedListings: [], detailData: null,
  };
}

function draft(channel: ActiveChannelKey, input = context()) {
  return buildChannelArguments(channel, input, 10_000, 3, undefined, { weight: 0.2, length: 10, width: 8, height: 4 }, 10) as Record<string, unknown>;
}

test("publish context normalization and all eight create drafts preserve fee and both raw rules", () => {
  const input = context();
  input.manualFields = normalizeManualFields(input);
  assert.equal(input.manualFields.shippingFeeKrw, 3_500);
  assert.equal(input.manualFields.shippingRule, context().manualFields.shippingRule);
  assert.equal(input.manualFields.packagingRule, context().manualFields.packagingRule);
  for (const channel of activeChannelKeys) {
    const result = draft(channel, input);
    const shipping = (result.sellerpilotAssets as { shipping: Record<string, unknown> }).shipping;
    assert.equal(shipping.shippingFeeKrw, 3_500, channel);
    assert.equal(shipping.shippingRule, context().manualFields.shippingRule, channel);
    assert.equal(shipping.packagingRule, context().manualFields.packagingRule, channel);
    const required = inspectWorkbenchListingDraft(channel, result);
    assert.ok(required.some((item) => item.key === "shipping-shippingRule" && item.status === "manual"), channel);
    assert.ok(required.some((item) => item.key === "shipping-packagingRule" && item.status === "manual"), channel);
  }
});

test("missing or malformed fees remain unknown and cannot become a free Coupang listing", () => {
  for (const amount of [undefined, null, "", " ", NaN, Infinity, -1, 3_500.5, true]) {
    assert.equal(listingShippingAmount(amount), null);
  }
  const input = context();
  delete input.manualFields.shippingFeeKrw;
  input.manualFields = normalizeManualFields(input);
  assert.equal(input.manualFields.shippingFeeKrw, null);
  const result = draft("coupang", input);
  assert.equal((result.body as Record<string, unknown>).deliveryChargeType, "");
  assert.equal((result.body as Record<string, unknown>).deliveryCharge, null);
  assert.throws(() => assertListingShippingReady("coupang", result, "listing.create"), /shipping-source-fee/);
  assert.equal(listingShippingAmount(0), 0);
  assert.equal(listingShippingAmount("3500"), 3_500);
});

test("Coupang and Smartstore drafts carry the entered fee in official provider fields", () => {
  const coupang = draft("coupang").body as Record<string, unknown>;
  assert.equal(coupang.deliveryChargeType, "NOT_FREE");
  assert.equal(coupang.deliveryCharge, 3_500);
  const smartstore = draft("smartstore").body as { originProduct: { deliveryInfo: ReturnType<typeof smartstoreShippingDraft> } };
  assert.equal(smartstore.originProduct.deliveryInfo.deliveryFee.deliveryFeeType, "PAID");
  assert.equal(smartstore.originProduct.deliveryInfo.deliveryFee.baseFee, 3_500);
  assert.equal(smartstore.originProduct.deliveryInfo.claimDeliveryInfo.shippingAddressId, "");
  assert.throws(() => validatedSmartstoreShippingInfo(smartstore.originProduct.deliveryInfo), /SHIPPING_POLICY_CONFIRMATION_REQUIRED/);
});

test("shipping policy inspection prevents free/paying fee drift and unimplemented 11st paid shipping", () => {
  const input = context();
  input.manualFields.shippingRule = "";
  input.manualFields.packagingRule = "";
  const coupang = draft("coupang", input);
  assert.doesNotThrow(() => assertListingShippingReady("coupang", coupang, "listing.create"));
  Object.assign(coupang.body as Record<string, unknown>, { deliveryChargeType: "FREE", deliveryCharge: 0 });
  assert.throws(() => assertListingShippingReady("coupang", coupang, "listing.create"), /shipping-fee-contract/);

  const qoo10 = draft("qoo10", input);
  assert.equal((qoo10.params as Record<string, unknown>).ShippingNo, "");
  (qoo10.params as Record<string, unknown>).ShippingNo = "0";
  ((qoo10.sellerpilotAssets as Record<string, unknown>).shipping as Record<string, unknown>).policyReview = "확인";
  assert.throws(() => assertListingShippingReady("qoo10", qoo10, "listing.create"), /shipping-free-fee-match/);
  (qoo10.params as Record<string, unknown>).ShippingNo = "806971";
  assert.doesNotThrow(() => assertListingShippingReady("qoo10", qoo10, "listing.create"));

  const elevenst = draft("elevenst", input);
  ((elevenst.sellerpilotAssets as Record<string, unknown>).shipping as Record<string, unknown>).policyReview = "확인";
  assert.throws(() => assertListingShippingReady("elevenst", elevenst, "listing.create"), /shipping-supported-fee/);
});

test("structured Smartstore fee, claim fees and address IDs normalize text inputs without free defaults", () => {
  const delivery = {
    deliveryType: "DELIVERY", deliveryCompany: "CJGLS",
    deliveryFee: { deliveryFeeType: "CONDITIONAL_FREE", baseFee: "3500", freeConditionalAmount: "50000", deliveryFeePayType: "PREPAID" },
    claimDeliveryInfo: { returnDeliveryCompanyPriorityType: "SECONDARY_2", returnDeliveryFee: "3500", exchangeDeliveryFee: "7000", shippingAddressId: "123", returnAddressId: "456" },
  };
  const normalized = validatedSmartstoreShippingInfo(delivery);
  assert.equal(normalized.deliveryFee.baseFee, 3_500);
  assert.equal(normalized.deliveryFee.freeConditionalAmount, 50_000);
  assert.equal(normalized.claimDeliveryInfo.shippingAddressId, 123);
  assert.equal(normalized.claimDeliveryInfo.returnDeliveryFee, 3_500);
  assert.equal(delivery.deliveryFee.baseFee, "3500", "source is not mutated");
  for (const fee of [
    { ...delivery.deliveryFee, deliveryFeeType: "FREE" },
    { ...delivery.deliveryFee, freeConditionalAmount: "" },
    { ...delivery.deliveryFee, baseFee: 100_001 },
    { ...delivery.deliveryFee, deliveryFeeType: undefined },
  ]) assert.throws(() => validatedSmartstoreShippingInfo({ ...delivery, deliveryFee: fee }), /SHIPPING_POLICY_CONFIRMATION_REQUIRED/);
});

test("conditional Coupang shipping is explicit and does not interpret free-text rules", () => {
  assert.deepEqual(validatedCoupangShippingFees({ deliveryChargeType: "CONDITIONAL_FREE", deliveryCharge: "3500", freeShipOverAmount: "50000" }), { deliveryChargeType: "CONDITIONAL_FREE", deliveryCharge: 3_500, freeShipOverAmount: 50_000 });
  for (const type of ["CHARGE_RECEIVED", "CONDITIONAL_FREE", "FREE"]) {
    assert.throws(() => validatedCoupangShippingFees({ deliveryChargeType: type, deliveryCharge: 3_500, freeShipOverAmount: 0 }), /SHIPPING_FEE_CONFIRMATION_REQUIRED/);
  }
});

test("new shipping metadata never adds requirements or rewrites existing update contracts", () => {
  const value = { sellerpilotAssets: { shipping: listingShippingDraftSource(context().manualFields) }, params: { ShippingNo: "0" } };
  const before = JSON.stringify(value);
  assert.deepEqual(listingShippingRequirements("qoo10", value, "listing.update"), []);
  assert.doesNotThrow(() => assertListingShippingReady("qoo10", value, "listing.update"));
  assert.equal(JSON.stringify(value), before);
  assert.deepEqual(listingShippingRequirements("qoo10", { params: { ShippingNo: "0" } }, "listing.create"), []);
});

test("editing central shipping facts refreshes provider fees and invalidates prior manual reviews", () => {
  const input = context();
  const current = draft("smartstore", input);
  const assets = current.sellerpilotAssets as { shipping: Record<string, unknown> };
  assets.shipping.shippingRuleReview = "확인";
  assets.shipping.packagingRuleReview = "확인";
  const body = current.body as { originProduct: { deliveryInfo: ReturnType<typeof smartstoreShippingDraft> } };
  body.originProduct.deliveryInfo.deliveryCompany = "CJGLS";
  body.originProduct.deliveryInfo.claimDeliveryInfo.shippingAddressId = "123";
  input.manualFields.shippingFeeKrw = 4_000;
  input.manualFields.shippingRule = "7만원 이상 무료";
  const result = buildSynchronizedDraftMap(input, { smartstore: JSON.stringify(current) }, 10_000, 3, {}, { weight: 0.2, length: 10, width: 8, height: 4 }, 10);
  const next = JSON.parse(result.smartstore);
  assert.equal(next.body.originProduct.deliveryInfo.deliveryFee.baseFee, 4_000);
  assert.equal(next.body.originProduct.deliveryInfo.deliveryCompany, "CJGLS");
  assert.equal(next.body.originProduct.deliveryInfo.claimDeliveryInfo.shippingAddressId, "123");
  assert.equal(next.sellerpilotAssets.shipping.shippingRuleReview, "");
  assert.equal(next.sellerpilotAssets.shipping.packagingRuleReview, "");
});

test("ordinary Qoo10 update drafts never default to zero or offer a manual shipping override", () => {
  const input = context();
  input.listings = [{ id: "listing-shipping", channel: "qoo10", market: "JP", targetId: "", remoteId: "1234567890", status: "published", lastError: null, publishedAt: "2026-09-05T00:00:00Z", remoteVisibility: "live" }];
  const result = draft("qoo10", input);
  assert.equal((result.params as Record<string, unknown>).ShippingNo, "SERVER_MANAGED");
  const shipping = inspectWorkbenchListingDraft("qoo10", result, "listing.update").find((item) => item.key === "shipping");
  assert.equal(shipping?.status, "runtime");
  assert.equal(shipping?.manualPath, undefined);
});
