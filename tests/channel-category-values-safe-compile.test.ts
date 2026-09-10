import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  coupangCategoryInputs,
  shopeeCategoryAttributes,
} from "../lib/channel-category-values";

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

test("Coupang notice selector controls its details without becoming a provider notice row", () => {
  assert.deepEqual(coupangCategoryInputs({
    "notice:category": "가공식품",
    "notice:가공식품:제품명": "롯데샌드",
    "notice:가공식품:원재료명": "밀가루, 설탕",
    "certification:KC": "KC-123",
    중량: "315g",
  }), {
    attributes: [{ attributeTypeName: "중량", attributeValueName: "315g" }],
    notices: [
      { noticeCategoryName: "가공식품", noticeCategoryDetailName: "제품명", content: "롯데샌드" },
      { noticeCategoryName: "가공식품", noticeCategoryDetailName: "원재료명", content: "밀가루, 설탕" },
    ],
    certifications: [{ certificationType: "KC", certificationCode: "KC-123" }],
  });
  assert.throws(() => coupangCategoryInputs({
    "notice:category": "가공식품",
    "notice:기타 재화:품명": "롯데샌드",
  }), /고시 분류/);
});

test("Shopee typed descriptors keep numeric free text separate from numeric option ids", () => {
  const descriptors = [
    { id: "2", inputKind: "text", values: [] },
    { id: "3", inputKind: "multi_select", values: [{ id: "31" }, { id: "32" }] },
  ];
  assert.deepEqual(shopeeCategoryAttributes({ "2": "315", "3": ["31", "32"] }, descriptors), [
    { attribute_id: 2, attribute_value_list: [{ original_value_name: "315" }] },
    { attribute_id: 3, attribute_value_list: [{ value_id: 31 }, { value_id: 32 }] },
  ]);
  assert.throws(
    () => shopeeCategoryAttributes({ "3": "999" }, descriptors),
    /공식 옵션 ID/,
  );
});

function genericArguments() {
  const shippingRule = "판매자 확인 주문 기준 2영업일 출고";
  return {
    publicationIntent: "safe_test",
    sellerpilotAssets: { shipping: {
      shippingFeeKrw: 0,
      shippingRule,
      shippingRuleReview: "확인",
      coupangLeadTimeConfirmation: JSON.stringify({
        shippingRule,
        outboundShippingTimeDay: 2,
        source: "coupang-wing",
        orderDateAndCalendarConfirmed: true,
        approvedPromiseMatched: true,
        sameDayShipping: false,
      }),
    } },
    facts: {},
    body: {
      displayCategoryCode: 76890,
      sellerProductName: "롯데샌드",
      deliveryCompanyCode: "",
      deliveryChargeType: "FREE",
      deliveryCharge: 0,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: 0,
      returnCharge: 0,
      items: [{
        itemName: "롯데샌드",
        externalVendorSku: "CATEGORY-VALUE-TEST-SKU",
        salePrice: 10_000,
        maximumBuyCount: 1,
        outboundShippingTimeDay: 2,
        images: [{ vendorPath: "https://example.com/lotte-sand.jpg" }],
        notices: [
          { noticeCategoryName: "가공식품", noticeCategoryDetailName: "제품명", content: "롯데샌드" },
          { noticeCategoryName: "가공식품", noticeCategoryDetailName: "소비자상담 전화번호", content: "판매자 문의" },
        ],
        attributes: [],
        certifications: [
          { certificationType: "KC", certificationCode: "KC-123" },
          { certificationType: "선택인증", certificationCode: "OPTIONAL-1" },
        ],
      }],
    },
  };
}

const metadata = {
  code: "SUCCESS",
  data: {
    attributes: [],
    noticeCategories: [{
      noticeCategoryName: "가공식품",
      noticeCategoryDetailNames: [
        { noticeCategoryDetailName: "제품명", required: "MANDATORY" },
        { noticeCategoryDetailName: "소비자상담 전화번호", required: "OPTIONAL" },
        { noticeCategoryDetailName: "표시광고 확인", required: "OPTIONAL" },
      ],
    }],
    certifications: [
      { certificationType: "KC", required: "MANDATORY", dataType: "CODE" },
      { certificationType: "선택인증", required: "OPTIONAL", dataType: "CODE" },
      { certificationType: "미입력 선택인증", required: "OPTIONAL", dataType: "CODE" },
      { certificationType: "문서 선택인증", required: "OPTIONAL", dataType: "DOCUMENT" },
    ],
  },
};

async function prepare(argumentsValue: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  const address = {
    countryCode: "KR",
    addressType: "ROADNAME",
    returnZipCode: "04524",
    returnAddress: "서울 중구",
    returnAddressDetail: "1층",
    companyContactNumber: "02-1111-1111",
  };
  globalThis.fetch = async (input) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.includes("/external-vendor-sku-codes/")) {
      return Response.json({ code: "SUCCESS", data: [] });
    }
    if (pathname.endsWith("/shipping-place/outbound")) {
      return Response.json({ code: "SUCCESS", data: { content: [{
        usable: true,
        outboundShippingPlaceCode: 11111111,
        placeAddresses: [address],
      }] } });
    }
    if (pathname.includes("/returnShippingCenters")) {
      return Response.json({ code: "SUCCESS", data: { content: [{
        usable: true,
        returnCenterCode: "RET-1",
        deliverCode: "HANJIN",
        returnFee02kg: 3_000,
        placeAddresses: [address],
      }] } });
    }
    if (pathname.endsWith("/status")) {
      return Response.json({ code: "SUCCESS", data: true });
    }
    return Response.json(metadata);
  };
  try {
    return await prepareMarketplaceListingArguments({
      channel: "coupang",
      operation: "listing.create",
      environment: "production",
      credential: {
        vendor_id: "A00098765",
        access_key: "access",
        secret_key: "secret",
        requested_by: "wing-user",
      },
      arguments: argumentsValue,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => assert.fail("prepare must remain read-only"),
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("generic Coupang preparation keeps supplied official optional rows and omits unsupplied ones", async () => {
  const prepared = await prepare(genericArguments());
  const item = (prepared.arguments.body as { items: Array<Record<string, unknown>> }).items[0];
  assert.deepEqual(item.notices, [
    { noticeCategoryName: "가공식품", noticeCategoryDetailName: "제품명", content: "롯데샌드" },
    { noticeCategoryName: "가공식품", noticeCategoryDetailName: "소비자상담 전화번호", content: "판매자 문의" },
  ]);
  assert.deepEqual(item.certifications, [
    { certificationType: "KC", certificationCode: "KC-123" },
    { certificationType: "선택인증", certificationCode: "OPTIONAL-1" },
  ]);
});

test("generic Coupang preparation rejects a seller certification absent from official metadata", async () => {
  const argumentsValue = genericArguments();
  (argumentsValue.body.items[0].certifications as Array<Record<string, unknown>>).push({
    certificationType: "임의 인증",
    certificationCode: "UNVERIFIED",
  });
  await assert.rejects(
    prepare(argumentsValue),
    /COUPANG_CERTIFICATION_EXEMPTION_UNVERIFIED/,
  );
});
