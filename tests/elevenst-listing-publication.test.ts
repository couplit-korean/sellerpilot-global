import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  elevenstVerifiedListingRemoteState,
  elevenstVisibilityFromStatus,
} from "../lib/channels/elevenst-listing-publication";
import { executeChannelOperation } from "../lib/channels/operations";
import { elevenstListingUpdateProjectionDigestInput } from "../lib/channels/listing-update";

const API_KEY = "A".repeat(32);
const FINGERPRINT = "b".repeat(64);
const CATEGORY_XML = `<?xml version="1.0" encoding="euc-kr"?><ns2:categorys xmlns:ns2="urn:test">
  <ns2:category><depth>1</depth><dispNm>생활잡화</dispNm><dispNo>1001387</dispNo><leafYn>N</leafYn><parentDispNo>0</parentDispNo></ns2:category>
  <ns2:category><depth>3</depth><dispNm>케이블 정리소품</dispNm><dispNo>1341821</dispNo><leafYn>Y</leafYn><parentDispNo>1001387</parentDispNo></ns2:category>
</ns2:categorys>`;
const DETAIL_HTML = `<section lang="ko-KR"><p>한국어 상품 상세 설명입니다.</p>${Array.from(
  { length: 8 },
  (_, index) => `<img src="https://cdn.example.test/${index + 1}.jpg">`,
).join("")}</section>`;

function completeProduct(overrides: Record<string, unknown> = {}) {
  return {
    selMthdCd: "01",
    dispCtgrNo: "1341821",
    prdTypCd: "01",
    prdNm: "한국어 상품명",
    brand: "SellerPilot",
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: "대한민국",
    sellerPrdCd: "QA-KR-001",
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: "01",
    minorSelCnYn: "Y",
    prdImage01: "https://cdn.example.test/1.jpg",
    prdImage02: "https://cdn.example.test/2.jpg",
    prdImage03: "https://cdn.example.test/3.jpg",
    prdImage04: "https://cdn.example.test/4.jpg",
    htmlDetail: DETAIL_HTML,
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    aplBgnDy: "2026/08/30",
    aplEndDy: "2029/08/29",
    selPrc: "10000",
    prdSelQty: "1",
    dlvCnAreaCd: "01",
    dlvWyCd: "01",
    dlvCstInstBasiCd: "01",
    bndlDlvCnYn: "Y",
    dlvCstPayTypCd: "03",
    rtngdDlvCst: "0",
    exchDlvCst: "0",
    asDetail: "11번가 판매자 문의 이용",
    rtngExchDetail: "11번가 반품 교환 정책 확인",
    ProductNotification: {
      type: "891045",
      item: [
        { code: "11800", name: "한국어 상품명" },
        { code: "11905", name: "SellerPilot" },
        { code: "23760413", name: "11번가 판매자 문의 이용" },
        { code: "23759100", name: "대한민국" },
        { code: "23756033", name: "해당사항 없음" },
      ],
    },
    ...overrides,
  };
}

function exactProductXml(productNo: string, product: Record<string, unknown>, status = "103") {
  const escape = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const scalarFields = [
    "sellerPrdCd", "prdNm", "brand", "orgnNmVal", "prdStatCd",
    "prdImage01", "prdImage02", "prdImage03", "prdImage04",
    "asDetail", "rtngExchDetail",
  ];
  const scalars = scalarFields.flatMap((field) => product[field] === undefined || product[field] === ""
    ? []
    : [`<${field}>${escape(product[field])}</${field}>`]).join("");
  const notification = product.ProductNotification as { type: string; item: Array<{ code: string; name: string }> };
  const notificationXml = `<ProductNotification><type>${escape(notification.type)}</type>${notification.item
    .map((item) => `<item><code>${escape(item.code)}</code><name>${escape(item.name)}</name></item>`)
    .join("")}</ProductNotification>`;
  return `<Product><prdNo>${productNo}</prdNo><selStatCd>${status}</selStatCd><selStatNm>상태 ${status}</selStatNm>${scalars}<htmlDetail><![CDATA[${String(product.htmlDetail)}]]></htmlDetail>${notificationXml}</Product>`;
}

function publicationArguments(intent: "live" | "safe_test" = "live", imageCount = 8) {
  return {
    publicationIntent: intent,
    publicationStateContract: "verified_remote_state_v1" as const,
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: imageCount,
  };
}

test("11st status codes normalize to the official publication states", () => {
  assert.equal(elevenstVisibilityFromStatus("103"), "live");
  for (const status of ["101", "102", "110"]) assert.equal(elevenstVisibilityFromStatus(status), "pending_review");
  assert.equal(elevenstVisibilityFromStatus("105"), "non_public");
  assert.equal(elevenstVisibilityFromStatus("106"), "withdrawn");
  for (const status of ["107", "108", "109"]) assert.equal(elevenstVisibilityFromStatus(status), "rejected");
  assert.equal(elevenstVisibilityFromStatus("999"), null);
});

test("11st read-only publication helper verifies exact identity, Korean locale, fingerprint, and eight images", () => {
  const product = {
    prdNo: "123456789",
    sellerPrdCd: "QA-KR-001",
    prdNm: "한국어 상품명",
    htmlDetail: DETAIL_HTML,
    selStatCd: "103",
    selStatNm: "판매중",
  };
  const remoteState = elevenstVerifiedListingRemoteState({
    operation: "listing.create",
    remoteId: "123456789",
    product,
    expectedSellerProductCode: "QA-KR-001",
    expectedLocale: "ko-KR",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
    verifiedAt: new Date("2026-08-29T20:00:00.000Z"),
  });
  assert.equal(remoteState?.visibility, "live");
  assert.equal(remoteState?.providerStatus, "103");
  assert.equal(remoteState?.locale, "ko-KR");
  assert.equal(remoteState?.fingerprint, FINGERPRINT);
  assert.equal(remoteState?.imageCount, 8);
  assert.deepEqual(remoteState?.resources, {
    productNo: "123456789",
    sellerProductCode: "QA-KR-001",
    market: "KR",
  });
});

test("11st read-only publication helper fails shut on wrong seller code, language, image count, or status", () => {
  const base = {
    operation: "listing.create" as const,
    remoteId: "123456789",
    product: {
      prdNo: "123456789",
      sellerPrdCd: "QA-KR-001",
      prdNm: "한국어 상품명",
      htmlDetail: DETAIL_HTML,
      selStatCd: "103",
    },
    expectedSellerProductCode: "QA-KR-001",
    expectedLocale: "ko-KR",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  };
  assert.equal(elevenstVerifiedListingRemoteState({ ...base, expectedSellerProductCode: "OTHER" }), null);
  assert.equal(elevenstVerifiedListingRemoteState({ ...base, product: { ...base.product, prdNm: "English", htmlDetail: DETAIL_HTML.replace("한국어 상품 상세 설명입니다.", "English").replace('lang="ko-KR"', "") } }), null);
  assert.equal(elevenstVerifiedListingRemoteState({ ...base, expectedImageCount: 7 }), null);
  assert.equal(elevenstVerifiedListingRemoteState({ ...base, product: { ...base.product, selStatCd: "999" } }), null);
});

test("11st safe_test create rejects before category, seller, or write requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: API_KEY },
      arguments: { ...publicationArguments("safe_test"), product: completeProduct() },
      environment: "production",
    });
    assert.equal(calls, 0);
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.name, "safe-test-prewrite-fence");
    assert.equal(operation.steps[0]?.data.error, "ELEVENST_SAFE_TEST_CREATE_UNSUPPORTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st live create uses the exact single-product GET before returning verified_remote_state_v1", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const product = completeProduct();
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    if (call.url.includes("/rest/cateservice/category")) return new Response(CATEGORY_XML, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) return new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 });
    if (call.url.endsWith("/rest/prodservices/product")) return new Response("<ClientMessage><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) return new Response(exactProductXml("123456789", product, "103"), { status: 200 });
    throw new Error(`unexpected request: ${call.url}`);
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: API_KEY },
      arguments: { ...publicationArguments(), product },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "live");
    assert.equal(operation.remoteState?.imageCount, 8);
    assert.equal(calls.at(-1)?.method, "GET");
    assert.match(calls.at(-1)?.url ?? "", /prodmarket\/123456789$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st pending approval remains verified but not publication-fulfilled", async () => {
  const originalFetch = globalThis.fetch;
  const product = completeProduct();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/cateservice/category")) return new Response(CATEGORY_XML, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    if (url.includes("/rest/prodmarketservice/sellerprodcode/")) return new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 });
    if (url.endsWith("/rest/prodservices/product")) return new Response("<ClientMessage><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    return new Response(exactProductXml("123456789", product, "101"), { status: 200 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: API_KEY },
      arguments: { ...publicationArguments(), product },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, false);
    assert.equal(operation.remoteState?.visibility, "pending_review");
    assert.equal(operation.remoteState?.providerStatus, "101");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st update verifies mutable content and live status in the same exact GET readback", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = completeProduct({ prdNm: "수정 전 한국어 상품" });
  const product = completeProduct({ prdNm: "수정 후 한국어 상품" });
  let exactReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
      exactReads += 1;
      return new Response(exactProductXml("123456789", exactReads === 1 ? snapshot : product, "103"), { status: 200 });
    }
    if (String(init?.method) === "PUT") return new Response("<ClientMessage><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: API_KEY },
      arguments: {
        ...publicationArguments(),
        productNo: "123456789",
        productPatch: { prdNm: "수정 후 한국어 상품" },
        product,
        sellerpilotSnapshotMutableFingerprint: createHash("sha256")
          .update(elevenstListingUpdateProjectionDigestInput(snapshot))
          .digest("hex"),
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "live");
    assert.equal(operation.steps.at(-1)?.name, "listing-readback");
    assert.equal(operation.steps.at(-1)?.data.sellerpilotVerification, "ELEVENST_PUBLICATION_STATE_VERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st stop is complete only after exact GET returns status 105", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    if (call.method === "PUT") return new Response("<ClientMessage><message>판매상태가 수정되었습니다. [STAT : 105]</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    return new Response(exactProductXml("123456789", completeProduct(), "105"), { status: 200 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.stop",
      payload: { api_key: API_KEY },
      arguments: {
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 0,
        productNo: "123456789",
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "non_public");
    assert.equal(operation.remoteState?.providerStatus, "105");
    assert.deepEqual(calls.map((call) => call.method), ["PUT", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
