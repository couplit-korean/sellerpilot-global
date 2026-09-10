import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/commerce-operations";
import { prepareMarketplaceListingArguments } from "../lib/channels/provider-listing-runtime";
import { assertSmartstoreCreateAbsence } from "../lib/channels/smartstore-create-preflight";
import { readElevenstSellerProdcode } from "../lib/channels/elevenst-sellerprodcode-read";
import { elevenstVerifiedSkuAbsence } from "../lib/channels/elevenst-create-preflight";
import { shopeeGlobalCreateBody } from "../lib/channels/shopee-create-preflight";
import { smartstoreListingCreateContract } from "../lib/channels/smartstore-listing-create-contract";

const emptySearch = () => ({ page: 1, size: 50, first: true, last: true, totalElements: 0, totalPages: 0, contents: [] });
const naverCredential = { access_token: "fixture-token", access_token_expires_at: "2099-01-01T00:00:00.000Z" };
const smartstoreImageUrl = (index: number) =>
  `https://shop-phinf.pstatic.net/20260909_sellerpilot/domestic-${index}.jpg`;
const naverArguments = () => ({
  sellerpilotSmartstoreCreateContract: smartstoreListingCreateContract,
  publicationIntent: "live",
  publicationStateContract: "verified_remote_state_v1",
  publicationExpectedLocale: "ko-KR",
  publicationExpectedFingerprint: "a".repeat(64),
  publicationExpectedImageCount: 8,
  body: {
    originProduct: {
      statusType: "SALE",
      saleType: "NEW",
      leafCategoryId: "50022679",
      name: "SmartStore contract fixture",
      detailContent: Array.from({ length: 8 }, (_, index) =>
        `<img src="${smartstoreImageUrl(index + 1)}" />`).join(""),
      images: {
        representativeImage: { url: smartstoreImageUrl(0) },
        optionalImages: Array.from({ length: 8 }, (_, index) => ({
          url: smartstoreImageUrl(index + 1),
        })),
      },
      salePrice: 10_000,
      stockQuantity: 1,
      deliveryInfo: {
        deliveryType: "DELIVERY",
        deliveryAttributeType: "NORMAL",
        deliveryCompany: "HANJIN",
        deliveryFee: {
          deliveryFeeType: "PAID",
          baseFee: 3_000,
          deliveryFeePayType: "PREPAID",
        },
        claimDeliveryInfo: {
          returnDeliveryCompanyPriorityType: "PRIMARY",
          returnDeliveryFee: 3_000,
          exchangeDeliveryFee: 6_000,
          shippingAddressId: 123,
          returnAddressId: 456,
        },
      },
      detailAttribute: {
        naverShoppingSearchInfo: { brandName: "TEST" },
        afterServiceInfo: {
          afterServiceTelephoneNumber: "02-1234-5678",
          afterServiceGuideContent: "Test fixture",
        },
        originAreaInfo: { originAreaCode: "04", content: "대한민국" },
        sellerCodeInfo: { sellerManagementCode: "TEST-SKU" },
        certificationTargetExcludeContent: {
          childCertifiedProductExclusionYn: true,
          kcCertifiedProductExclusionYn: "TRUE",
          greenCertifiedProductExclusionYn: true,
          chemicalCertifiedProductExclusionYn: true,
        },
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: "ETC",
          etc: {
            returnCostReason: "상품상세 참조",
            noRefundReason: "상품상세 참조",
            qualityAssuranceStandard: "상품상세 참조",
            compensationProcedure: "상품상세 참조",
            troubleShootingContents: "상품상세 참조",
            itemName: "Test fixture",
            modelName: "TEST-SKU",
            certificateDetails: "해당사항 없음",
            manufacturer: "TEST",
            customerServicePhoneNumber: "02-1234-5678",
          },
        },
        optionInfo: {},
        unitCapacity: { unitPriceYn: false },
      },
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductName: "SmartStore contract fixture",
      channelProductDisplayStatusType: "ON",
    },
  },
});
const coupangValidBody = () => ({
  sellerProductId: 12345678,
  brand: "SellerPilotBrand",
  requested: false,
  items: [{
    itemName: "검증 옵션 1",
    externalVendorSku: "COUPANG-NO-REMOTE-ID-TEST",
    barcode: "8802259030799",
    emptyBarcode: false,
    emptyBarcodeReason: "",
    modelNo: "",
    maximumBuyCount: 1,
    unitCount: 1,
    attributes: [{
      attributeTypeName: "수량",
      attributeValueName: "1개",
      exposed: "EXPOSED",
    }],
  }],
});

for (const [label, status, data] of [
  ["unauthorized", 401, { code: "UNAUTHORIZED" }],
  ["rate limited", 429, {}],
  ["business error", 200, { ...emptySearch(), code: "ERROR" }],
  ["missing pagination", 200, { contents: [] }],
  ["incomplete page", 200, { ...emptySearch(), last: false, totalPages: 2 }],
  ["contradictory count", 200, { ...emptySearch(), totalElements: 1 }],
  ["existing SKU", 200, { ...emptySearch(), totalElements: 1, totalPages: 1, contents: [{ originProductNo: 10000001 }] }],
] as const) {
  test(`SmartStore ${label} cannot create or overwrite any product`, async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method} ${String(input)}`);
      assert.match(String(input), /\/v1\/products\/search$/);
      return Response.json(data, { status });
    };
    try {
      const result = await executeChannelOperation({ channel: "smartstore", operation: "listing.create", environment: "production", payload: naverCredential, arguments: naverArguments() });
      assert.equal(result.ok, false);
      assert.equal(calls.length, 1);
      assert.equal(result.remoteId, undefined);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("SmartStore empty search permits one create but missing paired identity stops without GET", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(`${init?.method} ${url}`);
    if (url.endsWith("/products/search")) return Response.json(emptySearch());
    if (url.endsWith("/v2/products")) return Response.json({ originProductNo: 10000001 });
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  };
  try {
    const result = await executeChannelOperation({ channel: "smartstore", operation: "listing.create", environment: "production", payload: naverCredential, arguments: naverArguments() });
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "10000001");
    assert.deepEqual(result.steps.map((item) => item.name), [
      "product-create",
      "product-create-identity",
    ]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(x => x.split(" ")[0]), ["POST", "POST"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("SmartStore preflight never calls a partial empty page proof absent", () => {
  assert.doesNotThrow(() => assertSmartstoreCreateAbsence({ response: new Response(null, { status: 200 }), data: emptySearch(), text: "" }));
  assert.throws(() => assertSmartstoreCreateAbsence({ response: new Response(null, { status: 200 }), data: { ...emptySearch(), page: 2 }, text: "" }), /PREFLIGHT_FAILED/);
});

test("Coupang CREATE cannot substitute caller body ID for missing provider ID", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => { calls.push(`${init?.method} ${String(input)}`); return Response.json({ code: "SUCCESS" }); };
  try {
    const result = await executeChannelOperation({ channel: "coupang", operation: "listing.create", environment: "production",
      payload: { vendor_id: "A00000000", access_key: "fixture-access", secret_key: "fixture-secret" },
      arguments: { body: coupangValidBody() },
    });
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, undefined);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^POST /);
  } finally { globalThis.fetch = originalFetch; }
});

for (const [label, status, xml] of [
  ["proxy HTML 404", 404, "<html><body>Not found</body></html>"],
  ["blank 404", 404, ""],
  ["provider failure 404", 404, "<ClientMessage><resultCode>500</resultCode></ClientMessage>"],
  ["server failure with code 404", 500, "<ClientMessage><resultCode>404</resultCode></ClientMessage>"],
] as const) {
  test(`11st ${label} is unverified and cannot authorize CREATE`, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_input, init) => { calls++; assert.equal(init?.method, "GET"); return new Response(xml, { status, headers: { "content-type": "text/xml;charset=UTF-8" } }); };
    try {
      const result = await readElevenstSellerProdcode({ payload: { api_key: "fixture-key" }, sellerProductCode: "TEST-SKU" });
      assert.equal(result.outcome, "unverified"); assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("11st accepts only bounded official empty collection or provider 404 XML", () => {
  const response = new Response(null, { status: 404 });
  const data = { lookupDocumentRoot: "ClientMessage", lookupBodyBytes: 70, resultCode: "404" };
  assert.equal(elevenstVerifiedSkuAbsence({ response, data, text: "" }), true);
  assert.equal(elevenstVerifiedSkuAbsence({ response, data: { ...data, productNo: "123" }, text: "" }), false);
  assert.equal(elevenstVerifiedSkuAbsence({ response, data: { ...data, lookupBodyBytes: 10000 }, text: "" }), false);
});

for (const body of [{ normal_stock: 1 }, { condition: "NEW" }, { condition: "NEW", normal_stock: 2, seller_stock: [{ stock: 1 }] }]) {
  test(`Shopee invalid create is blocked before images: ${JSON.stringify(body)}`, async () => {
    let requests = 0, mutations = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { requests++; throw Error("Unexpected fetch"); };
    try {
      await assert.rejects(prepareMarketplaceListingArguments({ channel: "shopee", operation: "listing.create", environment: "production", credential: {},
        arguments: { globalProduct: true, publicationStateContract: "verified_remote_state_v1", body }, signal: new AbortController().signal,
        hooks: { assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { mutations++; } },
      }), /SHOPEE_CREATE_/);
      assert.equal(requests, 0); assert.equal(mutations, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("Shopee accepted lowercase condition is serialized in documented uppercase", () => {
  const body = { condition: "new", normal_stock: 0 };
  assert.deepEqual(shopeeGlobalCreateBody(body, true), { condition: "NEW", seller_stock: [{ stock: 0 }] });
  assert.equal(body.condition, "new");
});
