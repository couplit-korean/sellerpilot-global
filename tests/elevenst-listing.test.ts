import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { elevenstListingUpdateProjectionDigestInput } from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";
import { elevenstCategoryRequest, elevenstSellerXmlRequest } from "../lib/channels/protocols";
import {
  elevenstSaleDateRange,
  mergeElevenstListingUpdateProduct,
  validateElevenstListingProduct,
} from "../lib/channels/elevenst-listing";

const apiKey = "A".repeat(32);
const categoryXml = `<?xml version="1.0" encoding="euc-kr"?><ns2:categorys xmlns:ns2="urn:test">
  <ns2:category><depth>1</depth><dispNm>생활잡화</dispNm><dispNo>1001387</dispNo><leafYn>N</leafYn><parentDispNo>0</parentDispNo></ns2:category>
  <ns2:category><depth>2</depth><dispNm>정리소품</dispNm><dispNo>1340388</dispNo><leafYn>N</leafYn><parentDispNo>1001387</parentDispNo></ns2:category>
  <ns2:category><depth>3</depth><dispNm>케이블 정리소품</dispNm><dispNo>1341821</dispNo><leafYn>Y</leafYn><parentDispNo>1340388</parentDispNo></ns2:category>
  <ns2:category><depth>3</depth><dispNm>케이블타이</dispNm><dispNo>1341822</dispNo><leafYn>Y</leafYn><parentDispNo>1340388</parentDispNo></ns2:category>
</ns2:categorys>`;

function completeProduct(overrides: Record<string, unknown> = {}) {
  return {
    selMthdCd: "01",
    dispCtgrNo: "1341821",
    prdTypCd: "01",
    prdNm: "SellerPilot QA",
    brand: "SellerPilot",
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: "대한민국",
    sellerPrdCd: "QA-001",
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: "01",
    minorSelCnYn: "Y",
    prdImage01: "https://example.com/product.jpg",
    htmlDetail: "<p>detail</p>",
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    aplBgnDy: "2026/08/24",
    aplEndDy: "2029/08/23",
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
    rtngExchDetail: "11번가 반품·교환 정책 확인",
    ProductNotification: {
      type: "891045",
      item: [
        { code: "11800", name: "SellerPilot QA" },
        { code: "11905", name: "SellerPilot" },
        { code: "23760413", name: "11번가 판매자 문의 이용" },
        { code: "23759100", name: "대한민국" },
        { code: "23756033", name: "해당사항 없음" },
      ],
    },
    ...overrides,
  };
}

function exactProductXml(productNo: string, product: Record<string, unknown>) {
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
  const notification = product.ProductNotification as { type?: unknown; item?: Array<{ code?: unknown; name?: unknown }> } | undefined;
  const notificationXml = notification
    ? `<ProductNotification><type>${escape(notification.type)}</type>${(notification.item ?? [])
      .map((item) => `<item><code>${escape(item.code)}</code><name>${escape(item.name)}</name></item>`)
      .join("")}</ProductNotification>`
    : "";
  return `<Product><prdNo>${productNo}</prdNo>${scalars}<htmlDetail><![CDATA[${String(product.htmlDetail)}]]></htmlDetail>${notificationXml}</Product>`;
}

function trustedSnapshotFingerprint(product: Record<string, unknown>) {
  return createHash("sha256")
    .update(elevenstListingUpdateProjectionDigestInput(product))
    .digest("hex");
}

test("11st public category request reconstructs official leaf paths without a credential", async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders = new Headers();
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  };
  try {
    const remote = await elevenstCategoryRequest();
    const items = remote.data.items as Array<Record<string, unknown>>;
    assert.equal(requestHeaders.has("openapikey"), false);
    assert.deepEqual(items.find((item) => item.categoryId === "1341821"), {
      categoryId: "1341821",
      categoryName: "케이블 정리소품",
      parentCategoryId: "1340388",
      depth: 3,
      leaf: true,
      categoryPath: "생활잡화 > 정리소품 > 케이블 정리소품",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st category suggestion ranks the official cable-organizer leaf and rejects a parent", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  try {
    const suggestion = await executeChannelOperation({
      channel: "elevenst",
      operation: "categories.suggest",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { query: "부착형 케이블 정리 클립 6개 세트" },
    });
    const suggestions = suggestion.steps[0].data.items as Array<Record<string, unknown>>;
    assert.equal(suggestion.ok, true);
    assert.equal(suggestions[0].categoryId, "1341821");

    const leaf = await executeChannelOperation({
      channel: "elevenst",
      operation: "categories.validate",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { categoryId: "1341821" },
    });
    const parent = await executeChannelOperation({
      channel: "elevenst",
      operation: "categories.validate",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { categoryId: "1340388" },
    });
    assert.equal(leaf.ok, true);
    assert.equal(parent.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st category suggestion does not accept unrelated leaves only because they are deep", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  try {
    const suggestion = await executeChannelOperation({
      channel: "elevenst",
      operation: "categories.suggest",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { query: "무관한 화장품 세럼" },
    });
    assert.equal(suggestion.ok, false);
    assert.deepEqual(suggestion.steps[0].data.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st seller XML request keeps the key in the header and returns only safe metadata", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  let calledKey = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    calledKey = new Headers(init?.headers).get("openapikey") ?? "";
    return new Response("<?xml version=\"1.0\"?><ClientMessage><message>ok</message><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", {
      status: 200,
      headers: { "content-type": "text/xml; charset=euc-kr" },
    });
  };
  try {
    const result = await elevenstSellerXmlRequest({
      payload: { api_key: apiKey },
      method: "POST",
      path: "/rest/prodservices/product",
      body: "<Product><prdNm>SellerPilot QA</prdNm></Product>",
    });
    assert.equal(calledUrl, "https://api.11st.co.kr/rest/prodservices/product");
    assert.equal(calledKey, apiKey);
    assert.match(calledBody, /SellerPilot QA/);
    assert.equal(result.text, "");
    assert.deepEqual(result.data, {
      accepted: true,
      resultCode: "200",
      resultMessage: "ok",
      productNo: "123456789",
      products: [],
    });
    assert.doesNotMatch(JSON.stringify(result.data), new RegExp(apiKey));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing failures preserve the provider result message without exposing credentials", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    if (url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 });
    }
    return new Response(
        "<?xml version=\"1.0\"?><ClientMessage><message>상품등록실패 : 판매가는 10원 단위로 입력해 주세요.</message><resultCode>500</resultCode></ClientMessage>",
        { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } },
      );
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: completeProduct({ selPrc: "10" }) },
    });
    assert.equal(result.ok, false);
    assert.match(result.safeMessage, /판매가는 10원 단위/);
    assert.doesNotMatch(result.safeMessage, new RegExp(apiKey));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st verification listing creates, reads back, and stops the exact remote product", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    calls.push(call);
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response("<ClientMessage><message>not found</message><resultCode>404</resultCode></ClientMessage>", { status: 404 });
    }
    if (call.url.endsWith("/rest/prodservices/product")) {
      return new Response("<ClientMessage><message>created</message><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket")) {
      return new Response("<ns2:products><ns2:product><prdNo>123456789</prdNo><sellerPrdCd>QA-001</sellerPrdCd><selStatCd>103</selStatCd></ns2:product></ns2:products>", { status: 200 });
    }
    return new Response("<ClientMessage><message>stopped</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: {
        verificationOnly: true,
        product: completeProduct({
          prdNm: "SellerPilot <QA>",
          sellerPrdCd: "QA-001",
        }),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "123456789");
    assert.equal(result.publicUrl, "https://www.11st.co.kr/products/123456789");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create", "product-readback", "verification-stop-display"]);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "POST", "PUT"]);
    assert.match(calls[0].url, /sellerprodcode\/QA-001$/);
    assert.match(calls[1].body, /SellerPilot &lt;QA&gt;/);
    assert.match(calls[1].body, /<aplBgnDy>2026\/08\/24<\/aplBgnDy>/);
    assert.match(calls[1].body, /<aplEndDy>2029\/08\/23<\/aplEndDy>/);
    assert.match(calls[1].body, /<ProductCertGroup><crtfGrpTypCd>01<\/crtfGrpTypCd><crtfGrpObjClfCd>03<\/crtfGrpObjClfCd><\/ProductCertGroup>/);
    assert.doesNotMatch(calls[1].body, /<certTypeCd>|<certKey>/);
    assert.match(calls[2].body, /<prdNo>123456789<\/prdNo>/);
    assert.match(calls[3].url, /stopdisplay\/123456789$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing reconciles a timed-out create by seller product code without a duplicate write", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let sellerLookupCount = 0;
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    calls.push(call);
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      sellerLookupCount += 1;
      if (sellerLookupCount === 1) return new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 });
      return new Response("<Product><prdNo>987654321</prdNo><sellerPrdCd>QA-TIMEOUT-001</sellerPrdCd></Product>", { status: 200 });
    }
    if (call.url.endsWith("/rest/prodservices/product")) throw new DOMException("timed out", "TimeoutError");
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket")) {
      return new Response("<ns2:products><ns2:product><prdNo>987654321</prdNo><sellerPrdCd>QA-TIMEOUT-001</sellerPrdCd><selStatCd>103</selStatCd></ns2:product></ns2:products>", { status: 200 });
    }
    return new Response("<ClientMessage><message>stopped</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: {
        verificationOnly: true,
        product: completeProduct({ sellerPrdCd: "QA-TIMEOUT-001", prdNm: "SellerPilot timeout QA" }),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.deepEqual(result.steps.map((item) => item.name), ["product-create-reconcile", "product-readback", "verification-stop-display"]);
    assert.equal(calls.filter((call) => call.url.endsWith("/rest/prodservices/product")).length, 1);
    assert.equal(calls.filter((call) => call.url.includes("/sellerprodcode/")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing contract fails closed for guessed category, certification, notice, option, and delivery values", () => {
  assert.doesNotThrow(() => validateElevenstListingProduct(completeProduct()));

  const invalidCases: Array<{ product: Record<string, unknown>; error: RegExp }> = [
    { product: completeProduct({ sellerPrdCd: "" }), error: /ELEVENST_CONTRACT_FIELD_INVALID:sellerPrdCd/ },
    { product: completeProduct({ dispCtgrNo: "ORDER-123" }), error: /ELEVENST_CONTRACT_FIELD_INVALID:dispCtgrNo/ },
    { product: completeProduct({ brand: "알 수 없음" }), error: /ELEVENST_CONTRACT_PLACEHOLDER_REJECTED:brand/ },
    {
      product: completeProduct({
        ProductCertGroup: [
          { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03", ProductCert: { certTypeCd: "131", certKey: "해당사항 없음" } },
          { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
          { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
          { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
        ],
      }),
      error: /ELEVENST_CERTIFICATION_CONTRACT_UNVERIFIED/,
    },
    {
      product: completeProduct({ ProductNotification: { type: "891045", item: [{ code: "11800", name: "QA" }] } }),
      error: /ELEVENST_NOTICE_CONTRACT_UNVERIFIED/,
    },
    { product: completeProduct({ dlvWyCd: "99" }), error: /ELEVENST_CONTRACT_CODE_UNVERIFIED:dlvWyCd/ },
    { product: completeProduct({ prdTypCd: "02", ProductOption: [{ value: "임의 옵션" }] }), error: /ELEVENST_PRODUCT_FIELD_UNVERIFIED:ProductOption/ },
  ];

  for (const invalid of invalidCases) {
    assert.throws(() => validateElevenstListingProduct(invalid.product), invalid.error);
  }
});

test("11st server contract rejects copied no-certification metadata for another official numeric leaf before any provider request", async () => {
  const copiedContract = completeProduct({
    dispCtgrNo: "1341822",
    sellerPrdCd: "CABLE-TIE-001",
    prdNm: "케이블타이",
  });
  assert.throws(
    () => validateElevenstListingProduct(copiedContract),
    /ELEVENST_CATEGORY_CONTRACT_UNVERIFIED/,
  );

  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error("provider must not be called");
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: copiedContract },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "product-contract-validation");
    assert.equal(result.steps[0]?.status, 422);
    assert.equal(result.steps[0]?.data.error, "ELEVENST_CATEGORY_CONTRACT_UNVERIFIED");
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing rejects an invalid local contract before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: completeProduct({ sellerPrdCd: "" }) },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "product-contract-validation");
    assert.equal(result.steps[0]?.status, 422);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing verifies the exact official leaf category before seller lookup or create", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const nonLeafCategoryXml = categoryXml.replace(
    "<dispNo>1341821</dispNo><leafYn>Y</leafYn>",
    "<dispNo>1341821</dispNo><leafYn>N</leafYn>",
  );
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/rest/cateservice/category")) {
      return new Response(nonLeafCategoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    throw new Error("seller endpoint must not be called");
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: completeProduct() },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "category-validation");
    assert.deepEqual(calls, ["https://api.11st.co.kr/rest/cateservice/category"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing stops before create when the stable seller-code idempotency lookup is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    return new Response("<ClientMessage><message>lookup unavailable</message><resultCode>500</resultCode></ClientMessage>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: completeProduct({ sellerPrdCd: "QA-FENCE-001" }) },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "product-idempotency-read");
    assert.equal(result.steps[0]?.status, 503);
    assert.equal(calls.filter((url) => url.endsWith("/rest/prodservices/product")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st reconciles an accepted create response without productNo and never repeats the create POST", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let sellerLookupCount = 0;
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    calls.push(call);
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      sellerLookupCount += 1;
      return sellerLookupCount === 1
        ? new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 })
        : new Response("<Product><prdNo>777888999</prdNo><sellerPrdCd>QA-NO-ID-001</sellerPrdCd></Product>", { status: 200 });
    }
    if (call.url.endsWith("/rest/prodservices/product")) {
      return new Response("<ClientMessage><message>created</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    }
    return new Response("<ns2:products><ns2:product><prdNo>777888999</prdNo><sellerPrdCd>QA-NO-ID-001</sellerPrdCd></ns2:product></ns2:products>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: completeProduct({ sellerPrdCd: "QA-NO-ID-001" }) },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "777888999");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create-reconcile", "product-readback"]);
    assert.equal(calls.filter((call) => call.url.endsWith("/rest/prodservices/product")).length, 1);
    assert.equal(calls.filter((call) => call.url.includes("/sellerprodcode/")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st readback timeout preserves the observed create step for reconciliation without a second create", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    calls.push(call);
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 });
    }
    if (call.url.endsWith("/rest/prodservices/product")) {
      return new Response("<ClientMessage><message>created</message><productNo>555666777</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    }
    throw new DOMException("timed out", "TimeoutError");
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: completeProduct({ sellerPrdCd: "QA-READBACK-001" }) },
    });
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "555666777");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create", "product-readback"]);
    assert.equal(result.steps[0]?.ok, true);
    assert.equal(result.steps[1]?.status, 503);
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
    assert.equal(calls.filter((call) => call.url.endsWith("/rest/prodservices/product")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing update preserves the trusted full document and verifies the exact product before and after PUT", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const snapshot = completeProduct({ prdNm: "수정 전 상품", htmlDetail: "<p>수정 전 설명</p>" });
  const patch = { prdNm: "수정 후 상품", htmlDetail: "<p>수정 후 설명</p>" };
  const product = mergeElevenstListingUpdateProduct(snapshot, patch);
  let exactReadCount = 0;
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
      exactReadCount += 1;
      return new Response(exactProductXml("123456789", exactReadCount === 1 ? snapshot : product), { status: 200 });
    }
    if (call.url.endsWith("/rest/prodservices/product/123456789")) {
      return new Response("<ClientMessage><message>updated</message><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
    }
    throw new Error(`unexpected request: ${call.url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: {
        productNo: "123456789",
        productPatch: patch,
        product,
        sellerpilotSnapshotMutableFingerprint: trustedSnapshotFingerprint(snapshot),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "123456789");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-update-preflight", "product-update", "listing-readback"]);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT", "GET"]);
    assert.match(calls[1].body, /<prdNm>수정 후 상품<\/prdNm>/);
    assert.match(calls[1].body, /<selPrc>10000<\/selPrc>/, "가격은 신뢰 원본에서 보존해야 합니다.");
    assert.match(calls[1].body, /<prdSelQty>1<\/prdSelQty>/, "재고는 신뢰 원본에서 보존해야 합니다.");
    assert.match(calls[1].body, /<dlvCstPayTypCd>03<\/dlvCstPayTypCd>/, "배송 정책은 신뢰 원본에서 보존해야 합니다.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st accepted update with stale exact readback requires reconciliation instead of reporting success", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = completeProduct({ prdNm: "수정 전 상품", htmlDetail: "<p>수정 전 설명</p>" });
  const patch = { prdNm: "수정 후 상품" };
  const product = mergeElevenstListingUpdateProduct(snapshot, patch);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
      return new Response(exactProductXml("123456789", snapshot), { status: 200 });
    }
    return new Response("<ClientMessage><message>updated</message><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: {
        productNo: "123456789",
        productPatch: patch,
        product,
        sellerpilotSnapshotMutableFingerprint: trustedSnapshotFingerprint(snapshot),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[1]?.name, "product-update");
    assert.equal(result.steps[1]?.ok, true);
    assert.equal(result.steps[2]?.name, "listing-readback");
    assert.equal(result.steps[2]?.ok, false);
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st update blocks a stale trusted snapshot before PUT and requires reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const snapshot = completeProduct({ prdNm: "스냅샷 상품", htmlDetail: "<p>스냅샷 설명</p>" });
  const remoteCurrent = completeProduct({ prdNm: "판매자센터 수동 변경", htmlDetail: "<p>스냅샷 설명</p>" });
  const patch = { htmlDetail: "<p>새 설명</p>" };
  const product = mergeElevenstListingUpdateProduct(snapshot, patch);
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: String(init?.method ?? "GET") });
    return new Response(exactProductXml("123456789", remoteCurrent), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: {
        productNo: "123456789",
        productPatch: patch,
        product,
        sellerpilotSnapshotMutableFingerprint: trustedSnapshotFingerprint(snapshot),
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.method), ["GET"]);
    assert.equal(result.steps[0]?.data.sellerpilotSnapshotMutableProjectionMatched, false);
    assert.equal(result.steps[0]?.data.sellerpilotReconciliationRequired, true);
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st update requires exact HTTP 200 even when a different 2xx carries resultCode 200", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const snapshot = completeProduct({ prdNm: "수정 전 상품" });
  const patch = { prdNm: "수정 후 상품" };
  const product = mergeElevenstListingUpdateProduct(snapshot, patch);
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    if (call.method === "GET") return new Response(exactProductXml("123456789", snapshot), { status: 200 });
    return new Response("<ClientMessage><message>accepted</message><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 202 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.update",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: {
        productNo: "123456789",
        productPatch: patch,
        product,
        sellerpilotSnapshotMutableFingerprint: trustedSnapshotFingerprint(snapshot),
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT"]);
    assert.equal(result.steps[1]?.status, 202);
    assert.equal(result.steps[1]?.ok, false);
    assert.equal(result.steps[1]?.data.sellerpilotMutation, "accepted");
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st preflight blocks missing notice data and accepts a complete seller draft", () => {
  const complete = {
    product: {
      dispCtgrNo: "1000000",
      prdNm: "SellerPilot QA",
      brand: "SellerPilot",
      orgnNmVal: "대한민국",
      prdImage01: "https://example.com/product.jpg",
      htmlDetail: "<p>detail</p>",
      aplBgnDy: "2026/08/24",
      aplEndDy: "2029/08/23",
      selPrc: "10000",
      prdSelQty: "1",
      dlvWyCd: "01",
      dlvCstInstBasiCd: "01",
      rtngExchDetail: "정책 확인",
      ProductCertGroup: [{ crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" }],
      ProductNotification: { type: "891045", item: [{ code: "11800", name: "QA" }] },
    },
  };
  assert.equal(inspectListingDraft("elevenst", complete).every((item) => item.status === "ready"), true);
  const missingNotice = structuredClone(complete);
  missingNotice.product.ProductNotification.type = "";
  assert.equal(inspectListingDraft("elevenst", missingNotice).find((item) => item.key === "notice")?.status, "manual");
});

test("11st sale period uses the official inclusive three-year date range", () => {
  assert.deepEqual(elevenstSaleDateRange(new Date("2026-08-23T15:30:00.000Z")), {
    aplBgnDy: "2026/08/24",
    aplEndDy: "2029/08/23",
  });
});
