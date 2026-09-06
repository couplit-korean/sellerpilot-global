import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  blockingListingRequirements,
  inspectListingDraft,
} from "../lib/channels/listing-preflight";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { prepareMarketplaceListingArguments } = await import(
  "../lib/channels/provider-listing-runtime"
);

const credential = {
  vendor_id: "A00098765",
  access_key: "access",
  secret_key: "secret",
  requested_by: "wing-user",
};

function confirmedNotices() {
  return [
    { noticeCategoryName: "식품", noticeCategoryDetailName: "제품명", content: "롯데샌드 쿠키" },
    { noticeCategoryName: "식품", noticeCategoryDetailName: "원재료", content: "밀가루, 설탕, 유지" },
  ];
}

function genericDraft(overrides: Record<string, unknown> = {}) {
  return {
    publicationIntent: "safe_test",
    // Explicit synthetic shipping contract lets the original notice, attribute
    // and account-enrichment regressions reach their intended validation layer.
    sellerpilotAssets: { shipping: {
      shippingFeeKrw: 0,
      shippingRule: "테스트 판매자 확인 주문 기준 2영업일 출고",
      shippingRuleReview: "확인",
      coupangLeadTimeConfirmation: JSON.stringify({
        shippingRule: "테스트 판매자 확인 주문 기준 2영업일 출고",
        outboundShippingTimeDay: 2, source: "coupang-wing",
        orderDateAndCalendarConfirmed: true, approvedPromiseMatched: true, sameDayShipping: false,
      }),
    } },
    facts: {
      manufacturer: "롯데제과",
      countryOfOrigin: "대한민국",
      material: "밀가루",
      quantityAttribute: "12개",
    },
    body: {
      displayCategoryCode: 76890,
      sellerProductName: "롯데샌드 쿠키",
      brand: "롯데",
      vendorId: "SERVER_MANAGED",
      deliveryCompanyCode: "",
      deliveryChargeType: "FREE",
      deliveryCharge: 0,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: 0,
      returnCharge: 0,
      items: [{
        itemName: "롯데샌드 쿠키",
        salePrice: 10000,
        maximumBuyCount: 1,
        outboundShippingTimeDay: 2,
        images: [{ vendorPath: "https://example.com/cookie.jpg" }],
        notices: [],
        attributes: [],
        certifications: [],
      }],
    },
    ...overrides,
  };
}

function genericReadyDraft(overrides: Record<string, unknown> = {}) {
  const draft = genericDraft(overrides);
  const body = draft.body as { items: Array<Record<string, unknown>> };
  if (!Array.isArray(body.items[0].notices) || body.items[0].notices.length === 0) {
    body.items[0].notices = confirmedNotices();
  }
  return draft;
}

function outboundResponse() {
  return {
    code: "SUCCESS",
    data: { content: [{
      usable: true,
      outboundShippingPlaceCode: 11111111,
      placeAddresses: [{
        countryCode: "KR",
        addressType: "ROADNAME",
        returnZipCode: "04524",
        returnAddress: "서울특별시 중구 세종대로",
        returnAddressDetail: "1층",
        companyContactNumber: "02-1111-1111",
      }],
    }] },
  };
}

function returnCenterResponse(overrides: Record<string, unknown> = {}) {
  return {
    code: "SUCCESS",
    data: { content: [{
      usable: true,
      returnCenterCode: "RET-COOKIE",
      deliverCode: "HANJIN",
      shippingPlaceName: "쿠키 반품지",
      returnFee02kg: 4500,
      placeAddresses: [{
        countryCode: "KR",
        addressType: "ROADNAME",
        returnZipCode: "04524",
        returnAddress: "서울특별시 중구 세종대로",
        returnAddressDetail: "1층",
        companyContactNumber: "02-1111-1111",
      }],
      ...overrides,
    }] },
  };
}

function categoryMetadataResponse(overrides: Record<string, unknown> = {}) {
  return {
    code: "SUCCESS",
    data: {
      attributes: [{
        attributeTypeName: "수량",
        dataType: "STRING",
        required: "MANDATORY",
        groupNumber: "NONE",
        exposed: "EXPOSED",
      }],
      noticeCategories: [{
        noticeCategoryName: "식품",
        noticeCategoryDetailNames: [
          { noticeCategoryDetailName: "제품명", required: "MANDATORY" },
          { noticeCategoryDetailName: "원재료", required: "MANDATORY" },
        ],
      }],
      certifications: [],
      ...overrides,
    },
  };
}

async function prepareGeneric(options: {
  argumentsValue?: Record<string, unknown>;
  outbound?: Record<string, unknown>;
  returnCenter?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} = {}) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; pathname: string }> = [];
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    calls.push({ method: init?.method ?? "GET", pathname });
    if (pathname.endsWith("/shipping-place/outbound")) return Response.json(options.outbound ?? outboundResponse());
    if (pathname.includes("/returnShippingCenters")) {
      return Response.json(options.returnCenter ?? returnCenterResponse());
    }
    return Response.json(options.metadata ?? categoryMetadataResponse());
  };
  try {
    const prepared = await prepareMarketplaceListingArguments({
      channel: "coupang",
      operation: "listing.create",
      credential,
      arguments: options.argumentsValue ?? genericReadyDraft(),
      environment: "production",
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => assert.fail("generic Coupang prepare must be read-only"),
      },
    });
    return { prepared, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("generic Coupang preflight does not claim notices ready without seller-confirmed content", () => {
  const draft = genericDraft({
    facts: { manufacturer: "롯데제과", countryOfOrigin: "대한민국", material: "밀가루" },
  });
  const requirements = inspectListingDraft("coupang", draft);
  assert.equal(requirements.find((item) => item.key === "notices")?.status, "manual");
  assert.equal(requirements.find((item) => item.key === "outbound")?.status, "runtime");
  assert.equal(requirements.find((item) => item.key === "certification")?.status, "runtime");
  assert.ok(blockingListingRequirements("coupang", draft).some((item) => item.key === "notices"));
});

test("generic Coupang prepare fails closed without publicationIntent instead of requesting live", async () => {
  const argumentsValue = genericDraft();
  delete argumentsValue.publicationIntent;
  await assert.rejects(
    prepareGeneric({ argumentsValue }),
    /COUPANG_PUBLICATION_INTENT_REQUIRED/,
  );
});

test("generic Coupang prepare maps safe_test to requested false and live to requested true", async () => {
  const safe = await prepareGeneric({
    argumentsValue: genericReadyDraft({ publicationIntent: "safe_test" }),
  });
  assert.equal((safe.prepared.arguments.body as Record<string, unknown>).requested, false);
  const live = await prepareGeneric({
    argumentsValue: genericReadyDraft({ publicationIntent: "live" }),
  });
  assert.equal((live.prepared.arguments.body as Record<string, unknown>).requested, true);
});

test("generic Coupang prepare uses seller-confirmed notices and contracted shipping, not placeholders", async () => {
  const { prepared, calls } = await prepareGeneric();
  const body = prepared.arguments.body as Record<string, unknown>;
  const item = (body.items as Array<Record<string, unknown>>)[0];
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET"]);
  assert.equal(body.vendorId, "A00098765");
  assert.equal(body.deliveryCompanyCode, "HANJIN");
  assert.equal(body.returnCharge, 4500);
  assert.equal(body.deliveryChargeOnReturn, 4500);
  assert.equal(body.returnCenterCode, "RET-COOKIE");
  assert.equal(body.requested, false);
  assert.deepEqual(item.notices, confirmedNotices());
  assert.ok((item.attributes as Array<Record<string, unknown>>).some((attribute) =>
    attribute.attributeTypeName === "수량" && attribute.attributeValueName === "12개"));
  assert.deepEqual(item.certifications, []);
  assert.equal(JSON.stringify(prepared.arguments).includes("상품상세 참조"), false);
  assert.equal(JSON.stringify(prepared.arguments).includes("CJGLS"), false);
  assert.equal(
    (item.attributes as Array<Record<string, unknown>>).some((attribute) =>
      attribute.attributeValueName === "1개"),
    false,
  );
  assert.equal(JSON.stringify(prepared.arguments).includes("부착형 케이블 정리 클립"), false);
  assert.equal(JSON.stringify(prepared.arguments).includes("Generic OEM"), false);
});

test("generic Coupang preparation preserves paid and conditional fees through account enrichment", async () => {
  for (const [type, threshold] of [["NOT_FREE", 0], ["CONDITIONAL_FREE", 50_000]] as const) {
    const argumentsValue = genericReadyDraft();
    Object.assign(argumentsValue.body, { deliveryChargeType: type, deliveryCharge: 3_500, freeShipOverAmount: threshold });
    argumentsValue.sellerpilotAssets.shipping.shippingFeeKrw = 3_500;
    const { prepared } = await prepareGeneric({ argumentsValue });
    const body = prepared.arguments.body as Record<string, unknown>;
    assert.equal(body.deliveryChargeType, type);
    assert.equal(body.deliveryCharge, 3_500);
    assert.equal(body.freeShipOverAmount, threshold);
    assert.equal(body.deliveryChargeOnReturn, 0);
    assert.equal(body.returnCharge, 4_500);
  }
});

test("generic Coupang preparation refuses missing or contradictory shipping before provider calls", async () => {
  for (const shipping of [
    { deliveryChargeType: undefined },
    { deliveryChargeType: "FREE", deliveryCharge: 3_500 },
    { deliveryChargeType: "CONDITIONAL_FREE", deliveryCharge: 3_500, freeShipOverAmount: 0 },
  ]) {
    const argumentsValue = genericReadyDraft();
    Object.assign(argumentsValue.body, shipping);
    await assert.rejects(prepareGeneric({ argumentsValue }), /LISTING_SHIPPING_CONFIRMATION_REQUIRED:.*shipping-fee-contract/);
  }
});

test("generic Coupang account enrichment honors selected centers and shipping flags", async () => {
  const argumentsValue = genericReadyDraft();
  Object.assign(argumentsValue.body, { outboundShippingPlaceCode: "22222222", returnCenterCode: "RET-SELECTED", remoteAreaDeliverable: "Y", unionDeliveryType: "NOT_UNION_DELIVERY" });
  const outbound = outboundResponse();
  outbound.data.content.push({ ...outbound.data.content[0], outboundShippingPlaceCode: 22222222 });
  const returnCenter = returnCenterResponse();
  returnCenter.data.content.push({ ...returnCenter.data.content[0], returnCenterCode: "RET-SELECTED" });
  const { prepared } = await prepareGeneric({ argumentsValue, outbound, returnCenter });
  const body = prepared.arguments.body as Record<string, unknown>;
  assert.equal(body.outboundShippingPlaceCode, 22222222);
  assert.equal(body.returnCenterCode, "RET-SELECTED");
  assert.equal(body.remoteAreaDeliverable, "Y");
  assert.equal(body.unionDeliveryType, "NOT_UNION_DELIVERY");
  await assert.rejects(prepareGeneric({ argumentsValue }), /COUPANG_USABLE_RETURN_CENTER_MISSING/);
});

test("generic Coupang prepare rejects placeholder notices before create", async () => {
  await assert.rejects(
    prepareGeneric({
      argumentsValue: genericDraft({
        facts: {
          manufacturer: "롯데제과",
          countryOfOrigin: "대한민국",
          material: "밀가루",
          noticeContent: "상품상세 참조",
          quantityAttribute: "12개",
        },
      }),
    }),
    /COUPANG_NOTICE_CONFIRMATION_REQUIRED/,
  );
});

test("generic Coupang prepare does not broadcast a scalar notice over multiple mandatory fields", async () => {
  await assert.rejects(
    prepareGeneric({
      argumentsValue: genericDraft({
        facts: {
          manufacturer: "롯데제과",
          countryOfOrigin: "대한민국",
          material: "밀가루",
          noticeContent: "밀가루, 설탕, 유지",
          quantityAttribute: "12개",
        },
      }),
    }),
    /COUPANG_NOTICE_CONFIRMATION_REQUIRED/,
  );
});

test("generic Coupang prepare rejects a notice category that does not match metadata", async () => {
  const argumentsValue = genericReadyDraft();
  (argumentsValue.body as { items: Array<Record<string, unknown>> }).items[0].notices = [
    { noticeCategoryName: "기타 재화", noticeCategoryDetailName: "제품명", content: "롯데샌드 쿠키" },
    { noticeCategoryName: "기타 재화", noticeCategoryDetailName: "원재료", content: "밀가루, 설탕, 유지" },
  ];
  await assert.rejects(
    prepareGeneric({ argumentsValue }),
    /COUPANG_NOTICE_CATEGORY_MISMATCH/,
  );
});

test("generic Coupang prepare preserves per-field notice values and JSON envelope details", async () => {
  const envelope = {
    noticeCategoryName: "식품",
    details: {
      제품명: "롯데샌드 쿠키",
      원재료: "밀가루, 설탕, 유지",
    },
  };
  const argumentsValue = genericDraft({
    facts: {
      manufacturer: "롯데제과",
      countryOfOrigin: "대한민국",
      material: "밀가루",
      quantityAttribute: "12개",
      noticeContent: JSON.stringify(envelope),
    },
  });
  const { prepared } = await prepareGeneric({ argumentsValue });
  const item = (prepared.arguments.body as { items: Array<Record<string, unknown>> }).items[0];
  assert.deepEqual(item.notices, confirmedNotices());
  assert.notEqual(
    (item.notices as Array<{ content: string }>)[0].content,
    (item.notices as Array<{ content: string }>)[1].content,
  );
});

test("generic Coupang prepare requires an explicit unique category when metadata has multiple notice groups", async () => {
  const metadata = categoryMetadataResponse({
    noticeCategories: [
      {
        noticeCategoryName: "식품",
        noticeCategoryDetailNames: [
          { noticeCategoryDetailName: "제품명", required: "MANDATORY" },
          { noticeCategoryDetailName: "원재료", required: "MANDATORY" },
        ],
      },
      {
        noticeCategoryName: "기타 재화",
        noticeCategoryDetailNames: [
          { noticeCategoryDetailName: "품명 및 모델명", required: "MANDATORY" },
        ],
      },
    ],
  });
  const unlabeled = genericDraft();
  (unlabeled.body as { items: Array<Record<string, unknown>> }).items[0].notices = [
    { noticeCategoryDetailName: "제품명", content: "롯데샌드 쿠키" },
    { noticeCategoryDetailName: "원재료", content: "밀가루, 설탕, 유지" },
  ];
  await assert.rejects(
    prepareGeneric({ argumentsValue: unlabeled, metadata }),
    /COUPANG_NOTICE_CATEGORY_REQUIRED/,
  );
  const { prepared } = await prepareGeneric({
    argumentsValue: genericReadyDraft(),
    metadata,
  });
  const item = (prepared.arguments.body as { items: Array<Record<string, unknown>> }).items[0];
  assert.deepEqual(item.notices, confirmedNotices());
});

test("generic Coupang prepare does not invent quantity as 1개", async () => {
  const argumentsValue = genericDraft();
  (argumentsValue.facts as Record<string, unknown>).quantityAttribute = "";
  await assert.rejects(prepareGeneric({ argumentsValue }), /COUPANG_MANDATORY_ATTRIBUTES_MISSING/);
});

test("generic Coupang prepare does not invent ingredients or food facts", async () => {
  await assert.rejects(
    prepareGeneric({
      metadata: categoryMetadataResponse({
        attributes: [{
          attributeTypeName: "원재료",
          dataType: "STRING",
          required: "MANDATORY",
          groupNumber: "NONE",
          exposed: "EXPOSED",
        }],
      }),
    }),
    /COUPANG_MANDATORY_ATTRIBUTES_MISSING/,
  );
});

test("generic Coupang prepare requires contracted delivery code instead of assuming CJGLS", async () => {
  await assert.rejects(
    prepareGeneric({ returnCenter: returnCenterResponse({ deliverCode: "" }) }),
    /COUPANG_DELIVERY_COMPANY_CODE_MISSING/,
  );
});

test("generic Coupang prepare requires contracted return fee instead of assuming 3000", async () => {
  await assert.rejects(
    prepareGeneric({ returnCenter: returnCenterResponse({ returnFee02kg: 0 }) }),
    /COUPANG_RETURN_FEE_MISSING/,
  );
});

test("generic Coupang prepare validates explicit operator delivery values against contracted GET facts", async () => {
  const argumentsValue = genericReadyDraft();
  (argumentsValue.body as Record<string, unknown>).deliveryCompanyCode = "CJGLS";
  await assert.rejects(
    prepareGeneric({ argumentsValue }),
    /COUPANG_DELIVERY_COMPANY_CODE_MISMATCH/,
  );
});

test("generic Coupang prepare requires a code for mandatory CODE certifications", async () => {
  await assert.rejects(
    prepareGeneric({
      metadata: categoryMetadataResponse({
        certifications: [{
          certificationType: "KC",
          required: "MANDATORY",
          dataType: "CODE",
        }],
      }),
    }),
    /COUPANG_CERTIFICATION_REQUIRED/,
  );
});

test("generic Coupang prepare does not treat unknown certification dataType as a verified exemption", async () => {
  await assert.rejects(
    prepareGeneric({
      metadata: categoryMetadataResponse({
        certifications: [{
          certificationType: "NOT_REQUIRED",
          required: "MANDATORY",
          dataType: "NONE",
        }],
      }),
    }),
    /COUPANG_CERTIFICATION_EXEMPTION_UNVERIFIED/,
  );
  await assert.rejects(
    prepareGeneric({
      metadata: categoryMetadataResponse({
        certifications: [{
          certificationType: "KC",
          required: "MANDATORY",
          dataType: "STRING",
        }],
      }),
    }),
    /COUPANG_CERTIFICATION_EXEMPTION_UNVERIFIED/,
  );
  await assert.rejects(
    prepareGeneric({
      metadata: categoryMetadataResponse({
        certifications: [{
          certificationType: "KC",
          required: "MANDATORY",
        }],
      }),
    }),
    /COUPANG_CERTIFICATION_EXEMPTION_UNVERIFIED/,
  );
});

test("generic Coupang prepare accepts an explicit seller certification code for unknown dataType", async () => {
  const argumentsValue = genericReadyDraft();
  (argumentsValue.body as { items: Array<Record<string, unknown>> }).items[0].certifications = [
    { certificationType: "KC", certificationCode: "KC1234567890123" },
  ];
  const { prepared } = await prepareGeneric({
    argumentsValue,
    metadata: categoryMetadataResponse({
      certifications: [{
        certificationType: "KC",
        required: "MANDATORY",
        dataType: "FUTURE_TYPE",
      }],
    }),
  });
  const item = (prepared.arguments.body as { items: Array<Record<string, unknown>> }).items[0];
  assert.deepEqual(item.certifications, [{
    certificationType: "KC",
    certificationCode: "KC1234567890123",
  }]);
});
