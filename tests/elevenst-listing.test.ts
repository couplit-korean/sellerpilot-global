import assert from "node:assert/strict";
import test from "node:test";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { executeChannelOperation } from "../lib/channels/operations";
import { elevenstCategoryRequest, elevenstSellerXmlRequest } from "../lib/channels/protocols";
import { elevenstSaleDateRange } from "../lib/channels/elevenst-listing";

const apiKey = "A".repeat(32);
const categoryXml = `<?xml version="1.0" encoding="euc-kr"?><ns2:categorys xmlns:ns2="urn:test">
  <ns2:category><depth>1</depth><dispNm>생활잡화</dispNm><dispNo>1001387</dispNo><leafYn>N</leafYn><parentDispNo>0</parentDispNo></ns2:category>
  <ns2:category><depth>2</depth><dispNm>정리소품</dispNm><dispNo>1340388</dispNo><leafYn>N</leafYn><parentDispNo>1001387</parentDispNo></ns2:category>
  <ns2:category><depth>3</depth><dispNm>케이블 정리소품</dispNm><dispNo>1341821</dispNo><leafYn>Y</leafYn><parentDispNo>1340388</parentDispNo></ns2:category>
  <ns2:category><depth>3</depth><dispNm>케이블타이</dispNm><dispNo>1341822</dispNo><leafYn>Y</leafYn><parentDispNo>1340388</parentDispNo></ns2:category>
</ns2:categorys>`;

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
  globalThis.fetch = async () => new Response(
    "<?xml version=\"1.0\"?><ClientMessage><message>상품등록실패 : 판매가는 10원 단위로 입력해 주세요.</message><resultCode>500</resultCode></ClientMessage>",
    { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } },
  );
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: apiKey },
      environment: "production",
      arguments: { product: { prdNm: "SellerPilot QA", selPrc: "10" } },
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
        product: {
          prdNm: "SellerPilot <QA>",
          sellerPrdCd: "QA-001",
          dispCtgrNo: "1000000",
          prdImage01: "https://example.com/product.jpg",
          htmlDetail: "<p>detail</p>",
          aplBgnDy: "2026/08/24",
          aplEndDy: "2029/08/23",
          selPrc: "10000",
          prdSelQty: "1",
          ProductCertGroup: [
            { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
            { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
          ],
          ProductNotification: { type: "891045", item: [{ code: "11800", name: "QA" }] },
        },
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
        product: { sellerPrdCd: "QA-TIMEOUT-001", prdNm: "SellerPilot timeout QA" },
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
