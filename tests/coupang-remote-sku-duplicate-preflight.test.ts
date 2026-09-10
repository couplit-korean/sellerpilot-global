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

const { prepareMarketplaceListingArguments } = await import(
  "../lib/channels/provider-listing-runtime"
);

const vendorId = "A00098765";
const sellerSku = "AUTO SKU/한글";
const shippingRule = "결제 완료 주문 기준 2영업일 내 출고";
const address = {
  countryCode: "KR",
  addressType: "ROADNAME",
  returnZipCode: "04524",
  returnAddress: "서울특별시 중구 세종대로",
  returnAddressDetail: "1층",
  companyContactNumber: "02-1111-1111",
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    sellerpilotCoupangBaseSku: sellerSku,
    sellerpilotAssets: {
      shipping: {
        shippingFeeKrw: 3_000,
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
      },
    },
    facts: {},
    body: {
      displayCategoryCode: 59631,
      sellerProductName: "롯데샌드 315g",
      outboundShippingPlaceCode: 12345,
      returnCenterCode: "RET-1",
      deliveryCompanyCode: "HANJIN",
      returnCharge: 4_500,
      deliveryChargeType: "NOT_FREE",
      deliveryCharge: 3_000,
      freeShipOverAmount: 0,
      items: [{
        itemName: "롯데샌드 315g",
        externalVendorSku: sellerSku,
        barcode: "8802259030799",
        originalPrice: 3_190,
        salePrice: 3_190,
        maximumBuyCount: 1,
        outboundShippingTimeDay: 2,
        attributes: [
          { attributeTypeName: "개당 중량", attributeValueName: "315g" },
          { attributeTypeName: "수량", attributeValueName: "1개" },
        ],
        notices: [{
          noticeCategoryName: "가공식품",
          noticeCategoryDetailName: "제품명",
          content: "롯데샌드 315g",
        }],
        certifications: [],
      }],
    },
    ...overrides,
  };
}

function metadata() {
  return {
    code: "SUCCESS",
    data: {
      attributes: [
        { attributeTypeName: "개당 중량", dataType: "NUMBER", basicUnit: "g", usableUnits: ["g"], required: "MANDATORY", groupNumber: "NONE", exposed: "EXPOSED" },
        { attributeTypeName: "수량", dataType: "NUMBER", basicUnit: "개", usableUnits: ["개"], required: "MANDATORY", groupNumber: "NONE", exposed: "EXPOSED" },
      ],
      noticeCategories: [{
        noticeCategoryName: "가공식품",
        noticeCategoryDetailNames: [{ noticeCategoryDetailName: "제품명", required: "MANDATORY" }],
      }],
      certifications: [],
    },
  };
}

async function prepare(options: {
  argumentsValue?: Record<string, unknown>;
  lookup?: Response | Record<string, unknown>;
} = {}) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string }> = [];
  let mutationStarted = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const pathname = new URL(url).pathname;
    calls.push({ method: init?.method ?? "GET", url });
    if (pathname.includes("/external-vendor-sku-codes/")) {
      if (options.lookup instanceof Response) return options.lookup;
      return Response.json(options.lookup ?? { code: "SUCCESS", data: [] });
    }
    if (pathname.endsWith("/shipping-place/outbound")) {
      return Response.json({ code: "SUCCESS", data: { content: [{ usable: true, outboundShippingPlaceCode: 12345, placeAddresses: [address] }] } });
    }
    if (pathname.includes("/return/shipping-places/center-code")) {
      return Response.json({ code: "SUCCESS", data: { content: [{ usable: true, returnCenterCode: "RET-1", deliverCode: "HANJIN", shippingPlaceName: "반품지", returnFee02kg: 4_500, placeAddresses: [address] }] } });
    }
    if (pathname.endsWith("/status")) return Response.json({ code: "SUCCESS", data: true });
    return Response.json(metadata());
  };
  try {
    const prepared = await prepareMarketplaceListingArguments({
      channel: "coupang",
      operation: "listing.create",
      environment: "production",
      credential: {
        vendor_id: vendorId,
        access_key: "access",
        secret_key: "secret",
        requested_by: "wing-user",
      },
      arguments: options.argumentsValue ?? draft(),
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { mutationStarted = true; },
      },
    });
    return { prepared, calls, mutationStarted };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Coupang create checks the exact external seller SKU before all write preparation", async () => {
  const result = await prepare();
  const lookup = result.calls.find((call) => call.url.includes("/external-vendor-sku-codes/"));
  assert.ok(lookup);
  assert.equal(lookup.method, "GET");
  assert.equal(
    decodeURIComponent(new URL(lookup.url).pathname.split("/").at(-1) ?? ""),
    sellerSku,
  );
  assert.equal(result.calls.length, 5);
  assert.equal(result.mutationStarted, false);
  const outbound = result.calls.find((call) =>
    new URL(call.url).pathname.endsWith("/shipping-place/outbound"));
  const returns = result.calls.find((call) =>
    new URL(call.url).pathname.endsWith("/return/shipping-places/center-code"));
  assert.equal(new URL(outbound!.url).searchParams.get("placeCodes"), "12345");
  assert.equal(new URL(outbound!.url).searchParams.has("pageNum"), false);
  assert.equal(new URL(returns!.url).searchParams.get("returnCenterCodes"), "RET-1");
  assert.equal(new URL(returns!.url).searchParams.has("pageNum"), false);
  assert.equal((result.prepared.arguments.body as Record<string, unknown>).vendorId, vendorId);
});

test("saved Coupang option rows compile before exact duplicate lookup", async () => {
  const argumentsValue = draft();
  argumentsValue.facts = {
    coupangOptionRows: [{
      skuSuffix: "RED-M",
      itemName: "롯데샌드 315g 빨강 M",
      barcode: "8802259030799",
      modelNo: "",
      emptyBarcodeReason: "",
      salePrice: 3_190,
      stock: 2,
      unitCount: 1,
      purchaseOptions: [{ name: "색상", value: "빨강" }, { name: "사이즈", value: "M" }],
    }, {
      skuSuffix: "BLUE-L",
      itemName: "롯데샌드 315g 파랑 L",
      barcode: "",
      modelNo: "LOTTE-BLUE-L",
      emptyBarcodeReason: "제조사 바코드 미부여",
      salePrice: 3_290,
      stock: 3,
      unitCount: 1,
      purchaseOptions: [{ name: "색상", value: "파랑" }, { name: "사이즈", value: "L" }],
    }],
  };
  (argumentsValue.body as Record<string, unknown>).brand = "롯데";
  const template = ((argumentsValue.body as { items: Array<Record<string, unknown>> }).items)[0];
  template.unitCount = 1;
  const result = await prepare({ argumentsValue });
  const lookups = result.calls
    .filter((call) => call.url.includes("/external-vendor-sku-codes/"))
    .map((call) => decodeURIComponent(new URL(call.url).pathname.split("/").at(-1) ?? ""));
  assert.deepEqual(lookups, [`${sellerSku}-RED-M`, `${sellerSku}-BLUE-L`]);
  const items = (result.prepared.arguments.body as { items: Array<Record<string, unknown>> }).items;
  assert.deepEqual(items.map((item) => [item.externalVendorSku, item.salePrice, item.maximumBuyCount, item.unitCount]), [
    [`${sellerSku}-RED-M`, 3_190, 2, 1],
    [`${sellerSku}-BLUE-L`, 3_290, 3, 1],
  ]);
});

test("provider preparation never strips a matching suffix from the explicit base SKU", async () => {
  const argumentsValue = draft({ sellerpilotCoupangBaseSku: "CP-RED-M" });
  const body = argumentsValue.body as { brand?: string; items: Array<Record<string, unknown>> };
  body.brand = "롯데";
  body.items[0].externalVendorSku = "CP-RED-M";
  body.items[0].unitCount = 1;
  argumentsValue.facts = { coupangOptionRows: [{
    skuSuffix: "RED-M",
    itemName: "접미사 충돌 검증 옵션",
    barcode: "8802259030799",
    modelNo: "",
    emptyBarcodeReason: "",
    salePrice: 3_190,
    stock: 2,
    unitCount: 1,
    purchaseOptions: [{ name: "색상", value: "빨강" }],
  }] };
  const result = await prepare({ argumentsValue });
  const lookup = result.calls.find((call) => call.url.includes("/external-vendor-sku-codes/"));
  assert.ok(lookup);
  assert.equal(decodeURIComponent(new URL(lookup.url).pathname.split("/").at(-1) ?? ""), "CP-RED-M-RED-M");
});

test("Coupang provider preparation rejects malformed option facts before any lookup", async () => {
  await assert.rejects(
    prepare({ argumentsValue: draft({ facts: { coupangOptionRows: true } }) }),
    /COUPANG_OPTION_ROWS_INVALID/,
  );
});

test("Coupang create blocks an existing exact seller SKU from the authenticated vendor", async () => {
  await assert.rejects(
    prepare({ lookup: { code: "SUCCESS", data: [{ sellerProductId: 123456, vendorId }] } }),
    /COUPANG_EXTERNAL_VENDOR_SKU_ALREADY_EXISTS/,
  );
});

test("Coupang exact seller SKU lookup fails closed on incomplete or unverifiable results", async () => {
  for (const lookup of [
    new Response("upstream", { status: 503 }),
    { code: "ERROR", data: [] },
    { code: "SUCCESS", data: {} },
    { code: "SUCCESS", data: [], nextToken: "2" },
    { code: "SUCCESS", data: [], hasNext: true },
    { code: "SUCCESS", data: [{ sellerProductId: 123456, vendorId: "A-OTHER" }] },
    { code: "SUCCESS", data: [{ sellerProductId: null, vendorId }] },
    { code: "SUCCESS", data: [{ sellerProductId: 123456, vendorId }, { sellerProductId: 123456, vendorId }] },
  ]) {
    await assert.rejects(
      prepare({ lookup }),
      /COUPANG_EXTERNAL_VENDOR_SKU_LOOKUP_(?:FAILED|INCOMPLETE|IDENTITY_INVALID)/,
    );
  }
});

test("every Coupang create requires unique nonempty seller SKUs", async () => {
  const missingSku = draft();
  delete missingSku.publicationStateContract;
  delete ((missingSku.body as { items: Array<Record<string, unknown>> }).items[0].externalVendorSku);
  await assert.rejects(
    prepare({ argumentsValue: missingSku }),
    /COUPANG_EXTERNAL_VENDOR_SKU_REQUIRED_FOR_DUPLICATE_CHECK/,
  );

  const repeatedSku = draft();
  const items = (repeatedSku.body as { items: Array<Record<string, unknown>> }).items;
  items.push(structuredClone(items[0]));
  await assert.rejects(
    prepare({ argumentsValue: repeatedSku }),
    /COUPANG_EXTERNAL_VENDOR_SKU_DUPLICATE_IN_REQUEST/,
  );
});

test("Coupang resume allows only the exact already-bound remote seller product", async () => {
  const argumentsValue = draft({ resumeRemoteId: "123456" });
  const allowed = await prepare({
    argumentsValue,
    lookup: { code: "SUCCESS", data: [{ sellerProductId: 123456, vendorId }] },
  });
  assert.equal(allowed.calls.length, 5);

  await assert.rejects(
    prepare({
      argumentsValue,
      lookup: { code: "SUCCESS", data: [{ sellerProductId: 654321, vendorId }] },
    }),
    /COUPANG_EXTERNAL_VENDOR_SKU_ALREADY_EXISTS/,
  );
});
