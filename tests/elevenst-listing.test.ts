import assert from "node:assert/strict";
import test from "node:test";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { executeChannelOperation } from "../lib/channels/operations";
import { elevenstSellerXmlRequest } from "../lib/channels/protocols";

const apiKey = "A".repeat(32);

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

test("11st verification listing creates, reads back, and stops the exact remote product", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
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
          dispCtgrNo: "1000000",
          prdImage01: "https://example.com/product.jpg",
          htmlDetail: "<p>detail</p>",
          selPrc: "10000",
          prdSelQty: "1",
          ProductNotification: { type: "891045", item: [{ code: "11800", name: "QA" }] },
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "123456789");
    assert.equal(result.publicUrl, "https://www.11st.co.kr/products/123456789");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create", "product-readback", "verification-stop-display"]);
    assert.deepEqual(calls.map((call) => call.method), ["POST", "POST", "PUT"]);
    assert.match(calls[0].body, /SellerPilot &lt;QA&gt;/);
    assert.match(calls[1].body, /<prdNo>123456789<\/prdNo>/);
    assert.match(calls[2].url, /stopdisplay\/123456789$/);
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
