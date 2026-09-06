import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});
const { prepareMarketplaceListingArguments } = await import("../lib/channels/provider-listing-runtime");
type Attribute = { attributeTypeName: string; attributeValueName: string };

async function prepare(facts: Record<string, unknown>, attributes: Attribute[] = [], grouped = true) {
  const metadata = {
    attributes: [
      { attributeTypeName: "수량", required: "MANDATORY", groupNumber: "NONE", exposed: "EXPOSED", usableUnits: ["개"] },
      { attributeTypeName: "개당 중량", required: "MANDATORY", groupNumber: grouped ? "1" : "NONE", exposed: "EXPOSED", usableUnits: ["g", "kg"] },
      ...(grouped ? [{ attributeTypeName: "개당 용량", required: "MANDATORY", groupNumber: "1", exposed: "EXPOSED", usableUnits: ["ml"] }] : []),
    ],
    noticeCategories: [{ noticeCategoryName: "식품", noticeCategoryDetailNames: [{ noticeCategoryDetailName: "제품명", required: "MANDATORY" }] }],
    certifications: [],
  };
  const address = { countryCode: "KR", addressType: "ROADNAME", returnZipCode: "04524", returnAddress: "서울 중구", returnAddressDetail: "테스트", companyContactNumber: "02-1111-1111" };
  const shippingRule = "테스트 판매자 확인 주문 기준 2영업일 출고";
  const original = {
    publicationIntent: "safe_test",
    sellerpilotAssets: { shipping: { shippingFeeKrw: 0, shippingRule, shippingRuleReview: "확인", coupangLeadTimeConfirmation: JSON.stringify({ shippingRule, outboundShippingTimeDay: 2, source: "coupang-wing", orderDateAndCalendarConfirmed: true, approvedPromiseMatched: true, sameDayShipping: false }) } },
    facts,
    body: {
      displayCategoryCode: 59631, sellerProductName: "테스트 샌드 비스킷", brand: "테스트", vendorId: "SERVER_MANAGED",
      deliveryCompanyCode: "", deliveryChargeType: "FREE", deliveryCharge: 0, freeShipOverAmount: 0, deliveryChargeOnReturn: 0, returnCharge: 0,
      items: [{ itemName: "테스트 샌드 비스킷", salePrice: 3190, maximumBuyCount: 1, outboundShippingTimeDay: 2,
        images: [{ vendorPath: "https://example.com/cookie.jpg" }],
        notices: [{ noticeCategoryName: "식품", noticeCategoryDetailName: "제품명", content: "테스트 샌드 비스킷" }], attributes, certifications: [] }],
    },
  };
  const before = structuredClone(original);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method ?? "GET", "GET", "preparation must never publish");
    calls++;
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/shipping-place/outbound")) return Response.json({ code: "SUCCESS", data: { content: [{ usable: true, outboundShippingPlaceCode: 11111111, placeAddresses: [address] }] } });
    if (path.includes("/returnShippingCenters")) return Response.json({ code: "SUCCESS", data: { content: [{ usable: true, returnCenterCode: "RET-TEST", deliverCode: "HANJIN", shippingPlaceName: "테스트 반품지", returnFee02kg: 3000, placeAddresses: [address] }] } });
    assert.match(path, /display-category-codes\/59631$/);
    return Response.json({ code: "SUCCESS", data: metadata });
  };
  try {
    const result = await prepareMarketplaceListingArguments({
      channel: "coupang", operation: "listing.create", environment: "production",
      credential: { vendor_id: "A00098765", access_key: "test-access", secret_key: "test-secret", requested_by: "test-user" },
      arguments: original, signal: new AbortController().signal,
      hooks: { assertLeaseHealthy: async () => undefined, beginProviderMutation: async () => assert.fail("no mutation") },
    });
    return (result.arguments.body as { items: Array<{ attributes: Attribute[] }> }).items[0].attributes;
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(calls, 3);
    assert.deepEqual(original, before, "preparation must preserve the source draft");
  }
}

for (const grouped of [true, false]) {
  test(`Coupang ${grouped ? "grouped" : "single"} weight rejects shipping mass without confirmed net weight`, async () => {
    await assert.rejects(prepare({ quantityAttribute: "1개", weightKg: 0.4 }, [], grouped), /COUPANG_MANDATORY_ATTRIBUTES_MISSING/);
  });
}

test("Coupang confirmed net weight remains 315g despite shipping weight of 0.4kg", async () => {
  const result = await prepare({ quantityAttribute: "1개", weightAttribute: "315g", weightKg: 0.4 });
  assert.equal(result.find(a => a.attributeTypeName === "개당 중량")?.attributeValueName, "315g");
  assert.equal(result.find(a => a.attributeTypeName === "수량")?.attributeValueName, "1개");
  assert.equal(result.some(a => a.attributeTypeName === "개당 용량"), false);
});

test("Coupang explicitly supplied 315g is preserved with no derived quantity or weight facts", async () => {
  const result = await prepare({ weightKg: 0.4 }, [
    { attributeTypeName: "수량", attributeValueName: "1개" },
    { attributeTypeName: "개당 중량", attributeValueName: "315g" },
  ]);
  assert.equal(result.find(a => a.attributeTypeName === "개당 중량")?.attributeValueName, "315g");
});

test("Coupang weight confirmation does not invent a missing quantity", async () => {
  await assert.rejects(prepare({ weightAttribute: "315g", weightKg: 0.4, quantity: 6 }), /COUPANG_MANDATORY_ATTRIBUTES_MISSING/);
});

test("Coupang placeholder net weights remain blocked even with shipping mass", async () => {
  for (const value of [undefined, "", "미확인", "상세페이지 참조", "unknown"]) {
    await assert.rejects(prepare({ quantityAttribute: "1개", weightAttribute: value, weightKg: 0.4 }), /COUPANG_MANDATORY_ATTRIBUTES_MISSING/);
  }
});

for (const grouped of [true, false]) {
  test(`Coupang ${grouped ? "grouped" : "single"} weight requires a positive number and an exact metadata unit`, async () => {
    for (const value of ["banana", "315", "0g", "-1kg", "315lb"]) {
      await assert.rejects(
        prepare({ quantityAttribute: "1개", weightAttribute: value, weightKg: 0.4 }, [], grouped),
        /COUPANG_MANDATORY_ATTRIBUTES_MISSING/,
        value,
      );
    }
  });
}
