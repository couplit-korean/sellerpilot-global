import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCoupangExactQaRecoveryArguments,
  coupangExactQaCreateForbidden,
  coupangExactQaRecoveryBinding,
  coupangExactQaRecoveryCandidate,
  coupangExactQaRecoveryIdentity,
} from "../lib/channels/coupang-exact-qa-recovery";
import {
  assertCoupangExactQaUpdateReadback,
  prepareCoupangExactQaRecoveryArguments,
} from "../lib/channels/coupang-listing-update";
import { listingUpdateServerCandidate } from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";
import { prepareMarketplaceListingArguments } from "../lib/channels/provider-listing-runtime";

const fingerprint = "c".repeat(64);

function detailContents() {
  return Array.from({ length: 8 }, (_, index) => ({
    contentsType: "IMAGE",
    contentDetails: [{
      detailType: "IMAGE",
      content: `https://cdn.example.com/coupang-exact-${index + 1}.jpg`,
    }],
  }));
}

function exactNotices() {
  return [
    ["품명 및 모델명", "부착형 케이블 정리 클립 6개 세트"],
    ["인증/허가 사항", "해당사항 없음"],
    ["제조국(원산지)", "중국"],
    ["제조자(수입자)", "Generic OEM"],
    ["소비자상담 관련 전화번호", "쿠팡 판매자 문의 이용"],
  ].map(([noticeCategoryDetailName, content]) => ({
    noticeCategoryName: "기타 재화",
    noticeCategoryDetailName,
    content,
  }));
}

function exactRemoteProduct(overrides: Record<string, unknown> = {}) {
  return {
    sellerProductId: Number(coupangExactQaRecoveryIdentity.sellerProductId),
    displayCategoryCode: coupangExactQaRecoveryIdentity.displayCategoryCode,
    sellerProductName: "부착형 케이블 정리 클립 6개 세트",
    displayProductName: "부착형 케이블 정리 클립 6개 세트",
    brand: "No Brand",
    manufacture: "Generic OEM",
    requested: true,
    statusName: "승인완료",
    items: [{
      vendorItemId: Number(coupangExactQaRecoveryIdentity.vendorItemId),
      externalVendorSku: coupangExactQaRecoveryIdentity.sellerSku,
      modelNo: coupangExactQaRecoveryIdentity.sellerSku,
      itemName: "부착형 케이블 정리 클립 검정색 6개",
      attributes: [{ attributeTypeName: "색상", attributeValueName: "검정색" }],
      notices: exactNotices(),
      contents: detailContents(),
    }],
    ...overrides,
  };
}

function baseRecoveryArguments() {
  return bindCoupangExactQaRecoveryArguments({
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    body: {
      sellerProductId: Number(coupangExactQaRecoveryIdentity.sellerProductId),
      displayCategoryCode: coupangExactQaRecoveryIdentity.displayCategoryCode,
      sellerProductName: "부착형 케이블 정리 클립 6개 세트",
      items: [{
        sellerpilotItemMatchId: coupangExactQaRecoveryIdentity.sellerSku,
        itemName: "부착형 케이블 정리 클립 화이트 6개",
        modelNo: coupangExactQaRecoveryIdentity.sellerSku,
        attributes: [
          { attributeTypeName: "색상", attributeValueName: "화이트" },
          { attributeTypeName: "수량", attributeValueName: "6개" },
        ],
        notices: [],
        contents: detailContents(),
      }],
    },
  }, "listing.update");
}

function outboundResponse() {
  return {
    code: "SUCCESS",
    data: { content: [{
      usable: true,
      outboundShippingPlaceCode: 25291339,
      placeAddresses: [{
        countryCode: "KR",
        addressType: "ROADNAME",
        returnZipCode: "06236",
        returnAddress: "서울특별시 강남구 테헤란로",
        returnAddressDetail: "1층",
        companyContactNumber: "02-0000-0000",
      }],
    }] },
  };
}

function returnCenterResponse() {
  return {
    code: "SUCCESS",
    data: { content: [{
      usable: true,
      returnCenterCode: "RET-001",
      deliverCode: "CJGLS",
      shippingPlaceName: "서울 반품지",
      returnFee02kg: 3000,
      placeAddresses: [{
        countryCode: "KR",
        addressType: "ROADNAME",
        returnZipCode: "06236",
        returnAddress: "서울특별시 강남구 테헤란로",
        returnAddressDetail: "1층",
        companyContactNumber: "02-0000-0000",
      }],
    }] },
  };
}

function categoryMetadataResponse(noticeCategoryName = "기타 재화") {
  return {
    code: "SUCCESS",
    data: {
      attributes: [{
        attributeTypeName: "색상",
        dataType: "STRING",
        required: "MANDATORY",
        groupNumber: "NONE",
        exposed: "EXPOSED",
      }],
      noticeCategories: [{
        noticeCategoryName,
        noticeCategoryDetailNames: exactNotices().map((notice) => ({
          noticeCategoryDetailName: notice.noticeCategoryDetailName,
          required: "MANDATORY",
        })),
      }],
      certifications: [],
    },
  };
}

async function prepareExactRecoveryWithFetch(
  noticeCategoryName = "기타 재화",
  returnCenter = returnCenterResponse(),
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; pathname: string }> = [];
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    calls.push({ method: init?.method ?? "GET", pathname });
    if (pathname.endsWith("/shipping-place/outbound")) return Response.json(outboundResponse());
    if (pathname.includes("/returnShippingCenters")) return Response.json(returnCenter);
    if (pathname.endsWith("/status")) return Response.json({ code: "SUCCESS", data: true });
    return Response.json(categoryMetadataResponse(noticeCategoryName));
  };
  try {
    const prepared = await prepareMarketplaceListingArguments({
      channel: "coupang",
      operation: "listing.update",
      credential: {
        vendor_id: "A00012345",
        access_key: "access",
        secret_key: "secret",
        requested_by: "wing-user",
      },
      arguments: baseRecoveryArguments(),
      environment: "production",
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => assert.fail("recovery metadata preparation must be read-only"),
      },
    });
    return { prepared, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("only the exact stale Coupang ledger row is an update recovery candidate", () => {
  const candidate = {
    channel: "coupang",
    listingId: coupangExactQaRecoveryIdentity.listingId,
    remoteId: coupangExactQaRecoveryIdentity.sellerProductId,
    status: "failed",
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
    providerStatus: null,
    publishedAt: null,
    failureClass: null,
  };
  assert.equal(coupangExactQaRecoveryCandidate(candidate), true);
  assert.equal(listingUpdateServerCandidate("coupang", candidate), true);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, failureClass: "external_action" }), true);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, listingId: crypto.randomUUID() }), false);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, remoteId: "16356981735" }), false);
  assert.equal(coupangExactQaRecoveryCandidate({ ...candidate, remoteVisibility: "live" }), false);
});

test("the exact QA product and immutable remote SKU can never enter listing.create", () => {
  assert.equal(coupangExactQaCreateForbidden({
    productId: coupangExactQaRecoveryIdentity.productId,
  }), true);
  assert.equal(coupangExactQaCreateForbidden({
    argumentsValue: {
      body: { items: [{ externalVendorSku: coupangExactQaRecoveryIdentity.sellerSku }] },
    },
  }), true);
  assert.equal(coupangExactQaCreateForbidden({
    productId: crypto.randomUUID(),
    argumentsValue: { body: { items: [{ externalVendorSku: "OTHER-SKU" }] } },
  }), false);
});

test("exact recovery prepares current category, active shipping metadata, strict facts, and eight buyer images", async () => {
  const { prepared, calls } = await prepareExactRecoveryWithFetch();
  const body = prepared.arguments.body as Record<string, unknown>;
  const item = (body.items as Array<Record<string, unknown>>)[0];
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET", "GET"]);
  assert.equal(body.sellerProductId, Number(coupangExactQaRecoveryIdentity.sellerProductId));
  assert.equal(body.displayCategoryCode, 64574);
  assert.equal(body.brand, "No Brand");
  assert.equal(body.manufacture, "Generic OEM");
  assert.equal(body.outboundShippingPlaceCode, 25291339);
  assert.equal(body.returnCenterCode, "RET-001");
  assert.equal(body.deliveryCompanyCode, "CJGLS");
  assert.equal(item.sellerpilotItemMatchId, coupangExactQaRecoveryIdentity.vendorItemId);
  assert.equal((item.contents as unknown[]).filter((value) =>
    (value as Record<string, unknown>).contentsType === "IMAGE").length, 8);
  assert.deepEqual(item.notices, exactNotices());
  assert.ok((item.attributes as Array<Record<string, unknown>>).some((attribute) =>
    attribute.attributeTypeName === "색상" && attribute.attributeValueName === "검정색"));
});

test("exact recovery fails before PUT when Coupang metadata does not expose the approved notice category", async () => {
  await assert.rejects(
    prepareExactRecoveryWithFetch("가정용 전기제품"),
    /COUPANG_EXACT_QA_NOTICE_CATEGORY_UNAVAILABLE/,
  );
});

test("exact recovery fails before PUT without an active return center and carrier", async () => {
  const unavailable = returnCenterResponse();
  unavailable.data.content[0].usable = false;
  unavailable.data.content[0].deliverCode = "";
  await assert.rejects(
    prepareExactRecoveryWithFetch("기타 재화", unavailable),
    /COUPANG_USABLE_RETURN_CENTER_MISSING/,
  );
});

test("exact update proves signed GET before PUT and verifies the strict readback", async () => {
  const { prepared } = await prepareExactRecoveryWithFetch();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; pathname: string; body: string }> = [];
  let sellerReads = 0;
  let transmittedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({ method, pathname, body: String(init?.body ?? "") });
    if (method === "PUT") {
      transmittedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Response.json({ code: "SUCCESS", data: null });
    }
    if (pathname.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/inventories`)) {
      return Response.json({ code: "SUCCESS", data: { vendorItemId: Number(coupangExactQaRecoveryIdentity.vendorItemId), onSale: true } });
    }
    sellerReads += 1;
    return Response.json({
      code: "SUCCESS",
      data: transmittedBody
        ? { ...transmittedBody, requested: true, statusName: "승인완료" }
        : exactRemoteProduct(),
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.update",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: prepared.arguments,
      environment: "production",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(sellerReads, 3);
    assert.deepEqual(calls.slice(0, 3).map((call) => call.method), ["GET", "PUT", "GET"]);
    const transmitted = JSON.parse(calls.find((call) => call.method === "PUT")!.body);
    assert.equal(transmitted.sellerProductId, Number(coupangExactQaRecoveryIdentity.sellerProductId));
    assert.equal(transmitted.items.length, 1);
    assert.equal(transmitted.items[0].vendorItemId, Number(coupangExactQaRecoveryIdentity.vendorItemId));
    const binding = coupangExactQaRecoveryBinding(prepared.arguments, "listing.update");
    assert.ok(binding);
    assertCoupangExactQaUpdateReadback(transmitted, binding);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact stop binds one vendor item and completes only after onSale false readback", async () => {
  const argumentsValue = bindCoupangExactQaRecoveryArguments({
    sellerProductId: coupangExactQaRecoveryIdentity.sellerProductId,
    vendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
    sellerSku: coupangExactQaRecoveryIdentity.sellerSku,
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 0,
  }, "listing.stop");
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    calls.push(`${init?.method ?? "GET"} ${pathname}`);
    if (init?.method === "PUT") return Response.json({ code: "SUCCESS" });
    if (pathname.includes("/seller-products/")) {
      return Response.json({ code: "SUCCESS", data: exactRemoteProduct() });
    }
    return Response.json({
      code: "SUCCESS",
      data: { vendorItemId: Number(coupangExactQaRecoveryIdentity.vendorItemId), onSale: false },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.stop",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: argumentsValue,
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "withdrawn");
    assert.equal(calls.filter((call) => call.startsWith("PUT ")).length, 1);
    assert.ok(calls.some((call) => call.includes(`/vendor-items/${coupangExactQaRecoveryIdentity.vendorItemId}/sales/stop`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unbound or duplicate buyer content fails before any recovery provider mutation", () => {
  const unbound = baseRecoveryArguments();
  delete unbound.sellerpilotCoupangExactQaRecovery;
  assert.throws(
    () => prepareCoupangExactQaRecoveryArguments(unbound),
    /COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED/,
  );
  const duplicate = baseRecoveryArguments();
  const item = (duplicate.body as { items: Array<{ contents: unknown[] }> }).items[0];
  item.contents[7] = item.contents[0];
  assert.throws(
    () => prepareCoupangExactQaRecoveryArguments(duplicate),
    /COUPANG_EXACT_QA_BUYER_CONTENT_IMAGES_REQUIRED/,
  );
});
