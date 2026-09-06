import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRegistrationPatches,
  channelRegistrationFields,
  registrationPatches,
  registrationValueAt,
  setRegistrationValue,
} from "../lib/channel-registration-form";
import {
  asRegistrationValue,
  coupangCommonLeadTimeDay,
  coupangLeadTimeConfirmationPath,
  readCoupangLeadTimeDraftConfirmation,
  updateCoupangLeadTimeDraftConfirmation,
} from "../lib/channels/coupang-registration-input";
import { assertListingShippingReady, listingShippingRequirements } from "../lib/channels/listing-shipping";
import { buildChannelArguments } from "../app/product-publish-workbench";

const shippingRule = "결제 후 1~2영업일 내 출고";

function draft() {
  return {
    sellerpilotAssets: {
      token: "must-stay-hidden",
      galleryImageUrls: ["https://example.com/private.jpg"],
      shipping: {
        shippingFeeKrw: 3000,
        shippingRule,
        shippingRuleReview: "",
        packagingRule: "완충재 포장",
        packagingRuleReview: "",
      },
    },
    body: {
      deliveryChargeType: "NOT_FREE",
      deliveryCharge: 3000,
      freeShipOverAmount: 0,
      items: [{ outboundShippingTimeDay: null }],
    },
  };
}

test("Coupang lead-time form never infers days or true confirmations from a shipping phrase", () => {
  const value = draft();
  assert.deepEqual(readCoupangLeadTimeDraftConfirmation(value), {
    shippingRule,
    outboundShippingTimeDay: null,
    source: "coupang-wing",
    orderDateAndCalendarConfirmed: false,
    approvedPromiseMatched: false,
    sameDayShipping: null,
  });
  const withDays = updateCoupangLeadTimeDraftConfirmation(value, { outboundShippingTimeDay: 2 });
  assert.equal(withDays.outboundShippingTimeDay, 2);
  assert.equal(withDays.orderDateAndCalendarConfirmed, false);
  assert.equal(withDays.approvedPromiseMatched, false);
  assert.equal(withDays.sameDayShipping, null);
});

test("only the narrow Coupang review receipt survives registration patch save and restore", () => {
  const before = draft();
  let edited = setRegistrationValue(before, ["sellerpilotAssets", "shipping", "shippingRuleReview"], "확인");
  edited = setRegistrationValue(edited, ["sellerpilotAssets", "shipping", "packagingRuleReview"], "확인");
  edited = setRegistrationValue(edited, [...coupangLeadTimeConfirmationPath], asRegistrationValue({
    shippingRule,
    outboundShippingTimeDay: 2,
    source: "coupang-wing",
    orderDateAndCalendarConfirmed: true,
    approvedPromiseMatched: true,
    sameDayShipping: false,
  }));
  edited = setRegistrationValue(edited, ["sellerpilotAssets", "token"], "changed-secret");
  edited = setRegistrationValue(edited, ["sellerpilotAssets", "shipping", "shippingRule"], "changed-rule");

  const restored = applyRegistrationPatches(before, registrationPatches(before, edited));
  assert.equal(registrationValueAt(restored, ["sellerpilotAssets", "shipping", "shippingRuleReview"]), "확인");
  assert.equal(registrationValueAt(restored, ["sellerpilotAssets", "shipping", "packagingRuleReview"]), "확인");
  assert.deepEqual(registrationValueAt(restored, [...coupangLeadTimeConfirmationPath]),
    registrationValueAt(edited, [...coupangLeadTimeConfirmationPath]));
  assert.equal(registrationValueAt(restored, ["sellerpilotAssets", "token"]), "must-stay-hidden");
  assert.equal(registrationValueAt(restored, ["sellerpilotAssets", "shipping", "shippingRule"]), shippingRule);
  const crafted = applyRegistrationPatches(before, [{
    path: ["sellerpilotAssets"],
    value: { shipping: { shippingRuleReview: "확인", shippingRule: "forged" }, token: "exposed" },
  }]);
  assert.deepEqual(crafted, before);
  for (const replacement of [{}, null, []] as const) {
    assert.deepEqual(applyRegistrationPatches(before, [{
      path: ["sellerpilotAssets"], value: replacement,
    }]), before);
    assert.deepEqual(applyRegistrationPatches(before, [{
      path: ["sellerpilotAssets", "shipping"], value: replacement,
    }]), before);
  }
});

test("unrelated sellerpilot assets remain absent from generated registration fields", () => {
  const value = draft();
  const fields = channelRegistrationFields("coupang", value, listingShippingRequirements("coupang", value, "listing.create"));
  const paths = fields.map((field) => field.path.join("."));
  assert.ok(paths.includes("sellerpilotAssets.shipping.shippingRuleReview"));
  assert.ok(paths.includes("sellerpilotAssets.shipping.packagingRuleReview"));
  assert.ok(paths.includes("sellerpilotAssets.shipping.coupangLeadTimeConfirmation"));
  assert.ok(!paths.some((path) => path.includes("token") || path.includes("galleryImageUrls") || path.endsWith("shippingRule")));
});

test("UI-equivalent explicit values generate a payload that passes the unchanged server guard", () => {
  let value = draft();
  value = setRegistrationValue(value, ["sellerpilotAssets", "shipping", "shippingRuleReview"], "확인");
  value = setRegistrationValue(value, ["sellerpilotAssets", "shipping", "packagingRuleReview"], "확인");
  value = setRegistrationValue(value, ["body", "items", "0", "outboundShippingTimeDay"], 2);
  const confirmation = updateCoupangLeadTimeDraftConfirmation(value, {
    outboundShippingTimeDay: 2,
    orderDateAndCalendarConfirmed: true,
    approvedPromiseMatched: true,
    sameDayShipping: false,
  });
  value = setRegistrationValue(value, [...coupangLeadTimeConfirmationPath], asRegistrationValue(confirmation));

  assert.doesNotThrow(() => assertListingShippingReady("coupang", value, "listing.create"));
});

test("a changed approved rule does not inherit an old positive confirmation", () => {
  let value = draft();
  value = setRegistrationValue(value, [...coupangLeadTimeConfirmationPath], asRegistrationValue({
    shippingRule,
    outboundShippingTimeDay: 2,
    source: "coupang-wing",
    orderDateAndCalendarConfirmed: true,
    approvedPromiseMatched: true,
    sameDayShipping: false,
  }));
  value = setRegistrationValue(value, ["sellerpilotAssets", "shipping", "shippingRule"], "새 승인 출고 규칙");
  const stale = readCoupangLeadTimeDraftConfirmation(value);
  assert.equal(stale.outboundShippingTimeDay, null);
  assert.equal(stale.orderDateAndCalendarConfirmed, false);
  assert.equal(stale.approvedPromiseMatched, false);
  assert.equal(stale.sameDayShipping, null);
});

test("AUTO-03 confirmed 59631 assignment reaches the native Coupang payload", () => {
  const title = "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)";
  const context: Parameters<typeof buildChannelArguments>[1] = {
    product: {
      id: "1ed4acfc-7603-48ec-a638-241131e59358",
      externalCode: "AUTO-03",
      sku: "AUTO-780720401E2D4E4EA45F",
      name: title,
      description: "공식 승인 상세",
      sourceUrl: null,
      status: "ready",
    },
    manualFields: {
      productName: title,
      description: "공식 승인 상세",
      sellerSku: "AUTO-780720401E2D4E4EA45F",
      categoryHint: "샌드/산도",
      brandName: "롯데(LOTTE)",
      manufacturer: "롯데웰푸드(주)",
      countryOfOrigin: "대한민국",
      material: "공식 표시사항 참조",
      packageContents: "315g × 1개 (52.5g × 6봉입)",
      condition: "NEW",
      gtinStatus: "HAS_GTIN",
      gtin: "8802259030799",
      sellingPrice: 3190,
      currency: "KRW",
      stock: 1,
      shippingFeeKrw: 3000,
      shippingRule,
      packagingRule: "판매자 승인 포장 규칙",
      weightKg: 0.4,
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 8,
    },
    assignments: [{
      channel: "coupang",
      market: "KR",
      categoryId: "59631",
      categoryPath: ["식품", "스낵/간식", "스낵/시리얼", "과자쿠키/비스킷/크래커", "샌드/산도"],
      providedAttributes: {
        "개당 중량": "315g",
        "수량": "1개",
        "notice:category": "가공식품",
        "notice:가공식품:제품명": title,
      },
      requiredAttributes: [],
      officialMetadata: {},
      status: "confirmed",
      confirmedAt: "2026-09-07T00:00:00.000Z",
    }],
    imageSpecs: [],
    listings: [],
    sourceImages: [{ path: "original-2.jpg", url: "https://example.com/original-2.jpg" }],
    generatedImages: [],
    localizedListings: [],
    detailData: null,
    contentMode: "manual_mvp",
  };

  const result = buildChannelArguments("coupang", context, 3190, 1, undefined,
    { weight: 0.4, length: 20, width: 15, height: 8 }, 3) as Record<string, unknown>;
  const body = result.body as Record<string, unknown>;
  const item = (body.items as Array<Record<string, unknown>>)[0];
  assert.equal(body.displayCategoryCode, 59631);
  assert.equal(body.sellerProductName, title);
  assert.equal(item.externalVendorSku, "AUTO-780720401E2D4E4EA45F");
  assert.equal(item.barcode, "8802259030799");
  assert.equal(item.salePrice, 3190);
  assert.equal(item.maximumBuyCount, 1);
  assert.deepEqual(item.attributes, [
    { attributeTypeName: "개당 중량", attributeValueName: "315g" },
    { attributeTypeName: "수량", attributeValueName: "1개" },
  ]);
  assert.deepEqual(item.notices, [{
    noticeCategoryName: "가공식품",
    noticeCategoryDetailName: "제품명",
    content: title,
  }]);
  assert.equal(item.outboundShippingTimeDay, null, "2 days must remain unfilled until WING confirmation");
});

test("the parent functional update sequence preserves all item days and the shared confirmation", () => {
  let value = draft();
  (value.body.items as Array<Record<string, unknown>>).push({ outboundShippingTimeDay: null });
  const staleRender = structuredClone(value);
  const onChange = (path: string[], next: Parameters<typeof setRegistrationValue>[2]) => {
    // Matches the parent's setDrafts(current => setRegistrationValue(current))
    // semantics: every queued callback receives the previous callback's result.
    value = setRegistrationValue(value, path, next);
  };
  const nextDay = 2;
  for (const path of [
    ["body", "items", "0", "outboundShippingTimeDay"],
    ["body", "items", "1", "outboundShippingTimeDay"],
  ]) onChange(path, nextDay);
  onChange([...coupangLeadTimeConfirmationPath], asRegistrationValue(
    updateCoupangLeadTimeDraftConfirmation(staleRender, { outboundShippingTimeDay: nextDay }),
  ));

  assert.deepEqual(coupangCommonLeadTimeDay(value), {
    day: 2,
    inconsistent: false,
    itemValues: [2, 2],
  });
  assert.equal(registrationValueAt(value, ["sellerpilotAssets", "shipping", "coupangLeadTimeConfirmation", "outboundShippingTimeDay"]), 2);

  value = setRegistrationValue(value, ["body", "items", "1", "outboundShippingTimeDay"], 3);
  assert.deepEqual(coupangCommonLeadTimeDay(value), {
    day: null,
    inconsistent: true,
    itemValues: [2, 3],
  });
});
