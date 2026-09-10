import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { elevenstListingUpdateProjectionDigestInput } from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";
import { elevenstCategoryRequest, elevenstSellerXmlRequest } from "../lib/channels/protocols";
import { executeElevenst } from "../lib/product-registration/channels/elevenst";
import {
  assertElevenstListingShippingSource,
  bindElevenstAuthoritativeShippingSource,
  elevenstSaleDateRange,
  elevenstListingShippingFields,
  elevenstFixedShippingReadbackMatches,
  elevenstShippingContractErrorMessage,
  mergeElevenstListingUpdateProduct,
  validateElevenstListingArguments,
  validateElevenstListingProduct,
} from "../lib/channels/elevenst-listing";

const apiKey = "A".repeat(32);
const elevenstCredential = {
  api_key: apiKey,
  seller_id: "fixture-seller",
};
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

function completeProcessedFoodProduct(overrides: Record<string, unknown> = {}) {
  return completeProduct({
    dispCtgrNo: "1346631",
    sellerPrdCd: "FOOD-001",
    prdNm: "롯데샌드 순우유맛 315g",
    ProductNotification: {
      type: "891031",
      item: [
        { code: "176400445", name: "롯데웰푸드㈜ / 대한민국" },
        { code: "176398001", name: "제품 별도 표기일까지" },
        { code: "42154823", name: "해당사항 없음" },
        { code: "23757260", name: "해당사항 없음" },
        { code: "23757095", name: "총 내용량 315g, 100g당 500kcal" },
        { code: "176312674", name: "우유 함유" },
        { code: "176317774", name: "롯데샌드 순우유맛 315g" },
        { code: "23756754", name: "080-024-6060" },
        { code: "23757245", name: "밀가루(밀:미국산), 설탕" },
        { code: "42155152", name: "315g(6봉입)" },
        { code: "23757000", name: "과자" },
      ],
    },
    ...overrides,
  });
}

function exactProductXml(productNo: string, product: Record<string, unknown>) {
  const escape = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const scalarFields = [
    "sellerPrdCd", "selMthdCd", "dispCtgrNo", "prdTypCd", "prdNm", "brand",
    "rmaterialTypCd", "orgnTypCd", "orgnNmVal", "suplDtyfrPrdClfCd",
    "forAbrdBuyClf", "prdStatCd", "minorSelCnYn",
    "prdImage01", "prdImage02", "prdImage03", "prdImage04",
    "selPrdClfCd", "aplBgnDy", "aplEndDy", "selPrc", "prdSelQty",
    "dlvCnAreaCd", "dlvWyCd", "asDetail", "rtngExchDetail",
    "dlvCstInstBasiCd", "dlvCst1", "dlvCstPayTypCd", "bndlDlvCnYn", "rtngdDlvCst", "exchDlvCst", "addrSeqOut", "addrSeqIn",
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
  const certificationXml = Array.isArray(product.ProductCertGroup)
    ? product.ProductCertGroup.map((item) => {
      const group = item as Record<string, unknown>;
      return `<ProductCertGroup><crtfGrpTypCd>${escape(group.crtfGrpTypCd)}</crtfGrpTypCd><crtfGrpObjClfCd>${escape(group.crtfGrpObjClfCd)}</crtfGrpObjClfCd></ProductCertGroup>`;
    }).join("")
    : "";
  return `<Product><prdNo>${productNo}</prdNo>${scalars}<htmlDetail><![CDATA[${String(product.htmlDetail)}]]></htmlDetail>${certificationXml}${notificationXml}</Product>`;
}

function exactStockXml(productNo: string, quantity = "1") {
  return `<ns2:ProductStocks xmlns:ns2="urn:fixture"><ns2:ProductStock><prdNo>${productNo}</prdNo><prdStckNo>987654321</prdStckNo><stckQty>${quantity}</stckQty><prdStckStatCd>01</prdStckStatCd></ns2:ProductStock></ns2:ProductStocks>`;
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
      payload: elevenstCredential,
      environment: "production",
      arguments: { query: "부착형 케이블 정리 클립 6개 세트" },
    });
    const suggestions = suggestion.steps[0].data.items as Array<Record<string, unknown>>;
    assert.equal(suggestion.ok, true);
    assert.equal(suggestions[0].categoryId, "1341821");

    const leaf = await executeChannelOperation({
      channel: "elevenst",
      operation: "categories.validate",
      payload: elevenstCredential,
      environment: "production",
      arguments: { categoryId: "1341821" },
    });
    const parent = await executeChannelOperation({
      channel: "elevenst",
      operation: "categories.validate",
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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
    const path = "/rest/prodservices/product";
    const body = "<Product><prdNm>SellerPilot QA</prdNm></Product>";
    const xml = "<?xml version=\"1.0\"?><ClientMessage><message>ok</message><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>";
    const result = await elevenstSellerXmlRequest({
      payload: elevenstCredential,
      method: "POST",
      path,
      body,
    });
    assert.equal(calledUrl, "https://api.11st.co.kr/rest/prodservices/product");
    assert.equal(calledKey, apiKey);
    assert.match(calledBody, /SellerPilot QA/);
    assert.equal(result.text, "");
    assert.deepEqual(result.data, {
      accepted: true,
      transportEvidence: {
        method: "POST",
        requestBytesSha256: createHash("sha256").update(`POST\n${path}\n${body}`, "utf8").digest("hex"),
        responseBodySha256: createHash("sha256").update(Buffer.from(xml)).digest("hex"),
        responseBodyBytes: Buffer.byteLength(xml),
      },
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
      payload: elevenstCredential,
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
  const product = completeProduct({
    prdNm: "SellerPilot <QA>",
    sellerPrdCd: "QA-001",
  });
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
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
      return new Response(exactProductXml("123456789", product), { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/stck/123456789")) {
      return new Response(exactStockXml("123456789"), { status: 200 });
    }
    return new Response("<ClientMessage><message>stopped</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: elevenstCredential,
      environment: "production",
      arguments: {
        verificationOnly: true,
        product,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "123456789");
    assert.equal(result.publicUrl, "https://www.11st.co.kr/products/123456789");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create", "product-readback", "product-stock-readback", "verification-stop-display"]);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "GET", "GET", "PUT"]);
    assert.match(calls[0].url, /sellerprodcode\/QA-001$/);
    assert.match(calls[1].body, /SellerPilot &lt;QA&gt;/);
    assert.match(calls[1].body, /<aplBgnDy>2026\/08\/24<\/aplBgnDy>/);
    assert.match(calls[1].body, /<aplEndDy>2029\/08\/23<\/aplEndDy>/);
    assert.match(calls[1].body, /<ProductCertGroup><crtfGrpTypCd>01<\/crtfGrpTypCd><crtfGrpObjClfCd>03<\/crtfGrpObjClfCd><\/ProductCertGroup>/);
    assert.doesNotMatch(calls[1].body, /<certTypeCd>|<certKey>/);
    assert.match(calls[2].url, /prodmarket\/123456789$/);
    assert.match(calls[3].url, /prodmarket\/stck\/123456789$/);
    assert.match(calls[4].url, /stopdisplay\/123456789$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st listing reconciles a timed-out create by seller product code without a duplicate write", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let sellerLookupCount = 0;
  const product = completeProduct({ sellerPrdCd: "QA-TIMEOUT-001", prdNm: "SellerPilot timeout QA" });
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
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/987654321")) {
      return new Response(exactProductXml("987654321", product), { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/stck/987654321")) {
      return new Response(exactStockXml("987654321"), { status: 200 });
    }
    return new Response("<ClientMessage><message>stopped</message><resultCode>200</resultCode></ClientMessage>", { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: elevenstCredential,
      environment: "production",
      arguments: {
        verificationOnly: true,
        product,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.deepEqual(result.steps.map((item) => item.name), ["product-create-reconcile", "product-readback", "product-stock-readback", "verification-stop-display"]);
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

test("11st listing contract accepts only the exact processed-food leaf and 11-field notice mapping", () => {
  assert.doesNotThrow(() => validateElevenstListingProduct(completeProcessedFoodProduct()));

  const missingNutrition = completeProcessedFoodProduct();
  const missingNutritionNotice = missingNutrition.ProductNotification as { item: Array<{ code: string; name: string }> };
  missingNutritionNotice.item = missingNutritionNotice.item.filter((item) => item.code !== "23757095");
  assert.throws(() => validateElevenstListingProduct(missingNutrition), /ELEVENST_NOTICE_CONTRACT_UNVERIFIED/);

  const placeholderExpiry = completeProcessedFoodProduct();
  const placeholderNotice = placeholderExpiry.ProductNotification as { item: Array<{ code: string; name: string }> };
  const expiry = placeholderNotice.item.find((item) => item.code === "176398001");
  if (expiry) expiry.name = "TBD";
  assert.throws(() => validateElevenstListingProduct(placeholderExpiry), /ELEVENST_CONTRACT_PLACEHOLDER_REJECTED:name/);

  assert.throws(
    () => validateElevenstListingProduct(completeProcessedFoodProduct({ ProductNotification: { type: "891045", item: [] } })),
    /ELEVENST_NOTICE_CONTRACT_UNVERIFIED/,
  );
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
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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

test("11st treats only the official namespaced empty products document as an absent seller code", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
    }
    calls.push(call);
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ns2:products xmlns:ns2="http://skt.tmall.business.openapi.spring.service.client.domain"></ns2:products>`,
        { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } },
      );
    }
    if (call.url.endsWith("/rest/prodservices/product")) {
      return new Response("<ClientMessage><resultCode>200</resultCode><productNo>777888111</productNo></ClientMessage>", { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/777888111")) {
      return new Response(exactProductXml("777888111", completeProduct({ sellerPrdCd: "QA-EMPTY-001" })), { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/stck/777888111")) {
      return new Response(exactStockXml("777888111"), { status: 200 });
    }
    throw new Error(`unexpected URL ${call.url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: elevenstCredential,
      environment: "production",
      arguments: { product: completeProduct({ sellerPrdCd: "QA-EMPTY-001" }) },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "777888111");
    assert.equal(calls.filter((call) => call.url.endsWith("/rest/prodservices/product")).length, 1);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st reconciles an accepted create response without productNo and never repeats the create POST", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  let sellerLookupCount = 0;
  const product = completeProduct({ sellerPrdCd: "QA-NO-ID-001" });
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
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/stck/777888999")) {
      return new Response(exactStockXml("777888999"), { status: 200 });
    }
    return new Response(exactProductXml("777888999", product), { status: 200 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: elevenstCredential,
      environment: "production",
      arguments: { product },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "777888999");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create-reconcile", "product-readback", "product-stock-readback"]);
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
      payload: elevenstCredential,
      environment: "production",
      arguments: { product: completeProduct({ sellerPrdCd: "QA-READBACK-001" }) },
    });
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "555666777");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-create", "product-readback", "product-stock-readback"]);
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
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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
      payload: elevenstCredential,
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


test("11st native create/update argument fence rejects paid source facts without erasing them", () => {
  for (const operation of ["listing.create", "listing.update"] as const) {
    for (const shippingFeeKrw of [3000, "3000", " 3000 "]) {
      const args = {
        product: completeProduct(),
        ...(operation === "listing.update" ? { productNo: "123456789" } : {}),
        sellerpilotAssets: {
          shipping: {
            shippingFeeKrw, shippingRule: "결제 후 1~2영업일 내 출고", packagingRule: "완충재 포장",
            policyReview: "확인", shippingRuleReview: "확인", packagingRuleReview: "확인",
          }
        },
      };
      const before = structuredClone(args);
      assert.throws(() => validateElevenstListingArguments(args), /ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:\d+/);
      assert.deepEqual(args, before, `${operation} must preserve the user shipping facts and native fields`);
    }
  }
});

test("11st shipping errors survive the existing safe-code filter and explain the exact mismatch", () => {
  const code = "ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:3000";
  assert.match(code, /^ELEVENST_[A-Z0-9_:-]+$/u);
  assert.match(elevenstShippingContractErrorMessage(code) ?? "", /입력 배송비 3000 KRW.*유료배송 필드/);
  assert.match(elevenstShippingContractErrorMessage("ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED") ?? "", /미입력.*무료배송으로 처리하지/);
  assert.equal(elevenstShippingContractErrorMessage(code + "<unsafe>"), undefined);
});

test("11st source fence never coerces missing, malformed or negative fees into free shipping", () => {
  for (const fee of [undefined, null, "", " ", true, false, -1, "-1", 1, 0.5, 10_000_000, "NaN", Infinity, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertElevenstListingShippingSource({ shippingFeeKrw: fee }), /ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED/);
    assert.throws(() => validateElevenstListingArguments({ product: completeProduct(), sellerpilotAssets: { shipping: { shippingFeeKrw: fee } } }), /ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED/);
  }
  for (const shipping of [null, undefined, [], "free"]) {
    assert.throws(() => validateElevenstListingArguments({ product: completeProduct(), sellerpilotAssets: { shipping } }), /ELEVENST_CONTRACT_OBJECT_REQUIRED:sellerpilotAssets.shipping/);
  }
});

test("11st verified free shipping remains unchanged and source metadata never becomes provider XML fields", () => {
  for (const shippingFeeKrw of [0, "0", " 0 "]) {
    const product = completeProduct();
    const args = { product, sellerpilotAssets: { shipping: { shippingFeeKrw, shippingRule: "출고 2일", packagingRule: "완충재" } } };
    const before = structuredClone(args);
    assert.strictEqual(validateElevenstListingArguments(args), product);
    assert.strictEqual(validateElevenstListingProduct(product, args.sellerpilotAssets.shipping), product);
    assert.deepEqual(args, before);
    assert.equal(Object.hasOwn(product, "shippingFeeKrw"), false);
    assert.equal(product.dlvCstInstBasiCd, "01");
    assert.equal(product.dlvCstPayTypCd, "03");
  }
  // Historical native snapshots have no source metadata. They stay byte-stable;
  // this compatibility is not permission to omit known source facts at enqueue.
  const legacy = completeProduct();
  assert.strictEqual(validateElevenstListingArguments({ product: legacy }), legacy);
});

test("11st update merge cannot project away a known paid source before validation", () => {
  const snapshot = completeProduct();
  const patch = { prdNm: "Updated verified name", htmlDetail: "<p>Updated detail</p>" };
  const source = { shippingFeeKrw: 3000, shippingRule: "출고 2일", packagingRule: "완충재" };
  const before = structuredClone({ snapshot, patch, source });
  assert.throws(() => mergeElevenstListingUpdateProduct(snapshot, patch, source), /ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED/);
  assert.deepEqual({ snapshot, patch, source }, before);
  const merged = mergeElevenstListingUpdateProduct(snapshot, patch, { shippingFeeKrw: 0 });
  assert.equal(merged.prdNm, patch.prdNm);
  assert.equal(merged.dlvCstInstBasiCd, snapshot.dlvCstInstBasiCd);
  assert.equal(merged.dlvCstPayTypCd, snapshot.dlvCstPayTypCd);
  assert.deepEqual(snapshot, before.snapshot);
});


test("11st execution rejects mismatched paid shipping fields before any provider call", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: String(init?.method ?? "GET") });
    throw new Error("Provider must not be called for paid shipping");
  };
  try {
    for (const operation of ["listing.create", "listing.update"] as const) {
      const product = completeProduct();
      const args = {
        product,
        ...(operation === "listing.update" ? {
          productNo: "123456789",
          productPatch: { prdNm: product.prdNm },
          sellerpilotSnapshotMutableFingerprint: trustedSnapshotFingerprint(product),
        } : {}),
        sellerpilotAssets: {
          shipping: {
            shippingFeeKrw: 3000, shippingRule: "결제 후 1~2영업일 내 출고", packagingRule: "완충재 포장",
            policyReview: "확인", shippingRuleReview: "확인", packagingRuleReview: "확인",
          }
        },
      };
      const before = structuredClone(args);
      const outcome = await executeChannelOperation({
        channel: "elevenst", operation, payload: elevenstCredential, environment: "production", arguments: args,
      });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.steps.length, 1);
      assert.equal(outcome.steps[0].name, "product-contract-validation");
      assert.equal(outcome.steps[0].status, 422);
      assert.equal(outcome.steps[0].data.error, "ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:3000");
      assert.equal(outcome.steps[0].data.sellerpilotVerification, "ELEVENST_PREWRITE_REJECTED");
      assert.match(outcome.safeMessage, /입력 배송비 3000 KRW.*유료배송 필드/);
      assert.doesNotMatch(outcome.safeMessage, new RegExp(apiKey));
      assert.deepEqual(args, before, "source facts, native values and existing remote ID must be unchanged");
      assert.equal(calls.length, 0, `${operation} must reject before category GET, SKU GET, POST or PUT`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st execution rejects unknown shipping source before create/update provider calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected provider call"); };
  try {
    for (const operation of ["listing.create", "listing.update"] as const) {
      const outcome = await executeChannelOperation({
        channel: "elevenst", operation, payload: elevenstCredential, environment: "production",
        arguments: { product: completeProduct(), productNo: "123456789", sellerpilotAssets: { shipping: { shippingFeeKrw: null } } },
      });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.steps[0].data.error, "ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED");
      assert.match(outcome.safeMessage, /미입력.*무료배송으로 처리하지/);
      assert.equal(calls, 0);
    }
  } finally { globalThis.fetch = originalFetch; }
});


test("11st execution keeps explicit zero-fee create/update working without serializing source metadata", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const operation of ["listing.create", "listing.update"] as const) {
      const product = completeProduct();
      const calls: Array<{ url: string; method: string; body: string }> = [];
      globalThis.fetch = async (input, init) => {
        const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
        calls.push(call);
        if (call.url.includes("/rest/cateservice/category")) return new Response(categoryXml);
        if (call.url.includes("/sellerprodcode/")) return new Response("<ClientMessage><resultCode>404</resultCode></ClientMessage>", { status: 404 });
        if (call.url.includes("/prodmarket/stck/123456789")) return new Response(exactStockXml("123456789"));
        if (call.url.includes("/prodmarket/123456789")) return new Response(exactProductXml("123456789", product));
        if (call.url.includes("/rest/prodservices/product")) return new Response("<ClientMessage><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>");
        throw new Error(`Unexpected provider URL: ${call.url}`);
      };
      const args = {
        product,
        ...(operation === "listing.update" ? { productNo: "123456789", productPatch: { prdNm: product.prdNm }, sellerpilotSnapshotMutableFingerprint: trustedSnapshotFingerprint(product) } : {}),
        sellerpilotAssets: { shipping: { shippingFeeKrw: 0, shippingRule: "출고 2일", packagingRule: "완충재" } },
      };
      const before = structuredClone(args);
      const route = await runElevenstShippingRouteBranch({ argumentsValue: args, operation, context: authoritativeShippingContext(0) });
      assert.equal(route.response, null, "stored zero must pass the real route source-binding branch");
      const outcome = await executeChannelOperation({ channel: "elevenst", operation, payload: elevenstCredential, environment: "production", arguments: route.argumentsValue });
      assert.equal(outcome.ok, true, outcome.safeMessage);
      assert.equal(outcome.remoteId, "123456789");
      const writes = calls.filter(call => call.method === "POST" || call.method === "PUT");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].method, operation === "listing.create" ? "POST" : "PUT");
      assert.match(writes[0].body, /<dlvCstInstBasiCd>01<\/dlvCstInstBasiCd>/);
      assert.match(writes[0].body, /<dlvCstPayTypCd>03<\/dlvCstPayTypCd>/);
      assert.doesNotMatch(writes[0].body, /sellerpilotAssets|shippingFeeKrw|packagingRule/);
      assert.deepEqual(args, before);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


async function runElevenstShippingRouteBranch(input: {
  argumentsValue: Record<string, unknown>;
  operation: string;
  context: unknown;
  channel?: string;
  contextError?: unknown;
  throughContentMode?: boolean;
}) {
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const start = route.indexOf("// ELEVENST_AUTHORITATIVE_SHIPPING_BEGIN");
  const end = route.indexOf("// ELEVENST_AUTHORITATIVE_SHIPPING_END");
  assert.ok(start > route.indexOf("credentialMetadata.channel !== channel"));
  assert.ok(end > start && end < route.indexOf('const baseRequestFingerprint = createHash("sha256")'));
  assert.ok(end < route.indexOf('"sellerpilot_claim_channel_operation"'));
  const contentStart = route.indexOf('const contentBoundListingOperation = operation === "listing.create"');
  const contentEnd = route.indexOf("let verifiedPublishContext", contentStart);
  const modeStart = route.indexOf("if (contentBoundListingOperation)", contentEnd);
  const modeEnd = route.indexOf("// EXTERNAL_DETAIL_SOURCE_BEGIN", modeStart);
  const helperStart = route.indexOf("function marketplaceContentModeMatchesProduct(");
  const helperEnd = route.indexOf("function errorMessage(", helperStart);
  assert.ok(contentEnd > contentStart && modeEnd > modeStart && helperEnd > helperStart);
  const continuation = input.throughContentMode ? `
    const exactSmartstoreContentUpdate = false;
    const exactTemuExistingContentUpdateRequest = false;
    const exactShopeeSgContentUpdate = false;
    const exactQoo10AdoptedContentUpdateRequest = false;
    let temuActivationSourceArguments = null;
    const externallyVerifiedPublishContext = null;
    ${route.slice(helperStart, helperEnd)}
    ${route.slice(contentStart, contentEnd)}
    observations.contentBound = contentBoundListingOperation;
    ${route.slice(modeStart, modeEnd)}
      observations.contentModePassed = true;
    }
  ` : "";
  const body = ts.transpileModule(`return (async () => { ${route.slice(start, end)} ${continuation} return null; })();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const executeBranch = new Function("userClient", "parsed", "channel", "operation", "bindElevenstAuthoritativeShippingSource", "elevenstShippingContractErrorMessage", "NextResponse", "isRecord", "observations", body);
  const parsed = { data: { productId: "1ed4acfc-7603-48ec-a638-241131e59358", arguments: input.argumentsValue } };
  const reads: unknown[] = [];
  const observations: { contentBound?: boolean; contentModePassed?: boolean } = {};
  const response = await executeBranch({
    rpc: async (name: string, args: unknown) => {
      assert.equal(name, "sellerpilot_get_product_publish_context", "only a read-only context RPC is allowed");
      reads.push(args);
      return { data: input.context, error: input.contextError ?? null };
    }
  }, parsed, input.channel ?? "elevenst", input.operation, bindElevenstAuthoritativeShippingSource, elevenstShippingContractErrorMessage,
    { json: (value: unknown, init: ResponseInit) => new Response(JSON.stringify(value), init) },
    (value: unknown) => Boolean(value) && typeof value === "object" && !Array.isArray(value), observations) as Response | null;
  return { response, argumentsValue: parsed.data.arguments, reads, observations };
}

function authoritativeShippingContext(fee: unknown) {
  return {
    product: { id: "1ed4acfc-7603-48ec-a638-241131e59358" }, manualFields: {
      shippingFeeKrw: fee, shippingRule: "결제 후 1~2영업일 내 출고", packagingRule: "식품용 외부 포장 및 완충재 포장",
    }
  };
}

test("11st actual route branch rejects stored 3000 with missing or zero-forged metadata before provider and enqueue", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("No provider request allowed"); };
  try {
    for (const operation of ["listing.create", "listing.update"]) {
      for (const assets of [undefined, {}, { shipping: { shippingFeeKrw: 0, policyReview: "확인" } }]) {
        const args = { product: completeProduct(), productNo: "9598600918", ...(assets === undefined ? {} : { sellerpilotAssets: assets }) };
        const original = structuredClone(args);
        const result = await runElevenstShippingRouteBranch({ argumentsValue: args, operation, context: authoritativeShippingContext(3000) });
        assert.equal(result.response?.status, 409);
        const body = await result.response!.json();
        assert.equal(body.code, "ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:3000");
        assert.match(body.message, /입력 배송비 3000 KRW/);
        assert.deepEqual(result.reads, [{ p_product_id: "1ed4acfc-7603-48ec-a638-241131e59358" }]);
        assert.deepEqual(args, original);
        assert.equal(providerCalls, 0);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("11st actual route branch fails closed for missing stored fee, wrong product and context errors", async () => {
  for (const context of [authoritativeShippingContext(null), authoritativeShippingContext(undefined), null,
  { ...authoritativeShippingContext(0), product: { id: "different-product" } }]) {
    const outcome = await runElevenstShippingRouteBranch({ argumentsValue: { product: completeProduct(), sellerpilotAssets: { shipping: { shippingFeeKrw: 0 } } }, operation: "listing.update", context });
    assert.equal(outcome.response?.status, 409);
  }
  const failure = await runElevenstShippingRouteBranch({ argumentsValue: {}, operation: "listing.create", context: authoritativeShippingContext(0), contextError: { message: "unavailable" } });
  assert.equal(failure.response?.status, 409);
});

test("11st actual route binds stored zero over browser fee/rules without changing product, SKU or remote ID", async () => {
  const args = {
    product: completeProduct(), productNo: "9598600918", sellerpilotAssets: {
      contentMode: "ai_generated", shipping: { shippingFeeKrw: 3000, shippingRule: "browser forged", packagingRule: "browser forged" },
    }
  };
  const before = structuredClone(args);
  const result = await runElevenstShippingRouteBranch({ argumentsValue: args, operation: "listing.update", context: authoritativeShippingContext(0) });
  assert.equal(result.response, null);
  assert.deepEqual(args, before, "the caller object remains immutable");
  assert.deepEqual(result.argumentsValue.product, before.product);
  assert.equal(result.argumentsValue.productNo, before.productNo);
  assert.deepEqual((result.argumentsValue.sellerpilotAssets as Record<string, unknown>).shipping, authoritativeShippingContext(0).manualFields);
  assert.doesNotThrow(() => validateElevenstListingArguments(result.argumentsValue));
});

test("11st route source binding cannot change other channels or non-listing operations", async () => {
  for (const [channel, operation] of [["ebay", "listing.create"], ["qoo10", "listing.update"], ["elevenst", "inventory.update"]]) {
    const args = { untouched: true };
    const result = await runElevenstShippingRouteBranch({ argumentsValue: args, channel, operation, context: null });
    assert.equal(result.response, null);
    assert.strictEqual(result.argumentsValue, args);
    assert.equal(result.reads.length, 0);
  }
});


test("11st legacy zero-fee update stays outside contentMode binding after authoritative shipping injection", async () => {
  const args = { productNo: "9598600918", productPatch: { prdNm: "existing verified product name" } };
  const before = structuredClone(args);
  const result = await runElevenstShippingRouteBranch({
    argumentsValue: args, operation: "listing.update", throughContentMode: true,
    context: { ...authoritativeShippingContext(0), contentMode: "ai_generated" },
  });
  assert.equal(result.response, null, "the downstream mode branch must not produce product_content_mode_mismatch");
  assert.equal(result.observations.contentBound, false);
  assert.equal(result.observations.contentModePassed, undefined, "legacy update must not enter contentMode checks");
  assert.equal(result.reads.length, 1, "only authoritative shipping context is read, not a new content context");
  assert.equal(result.argumentsValue.productNo, "9598600918");
  assert.deepEqual(result.argumentsValue.productPatch, before.productPatch);
  assert.deepEqual((result.argumentsValue.sellerpilotAssets as Record<string, unknown>).shipping, authoritativeShippingContext(0).manualFields);
  assert.deepEqual(args, before);
});

test("11st stored paid fee blocks legacy omission and forged zero before downstream contentMode checks", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not be called"); };
  try {
    for (const assets of [undefined, { shipping: { shippingFeeKrw: 0 } }]) {
      const result = await runElevenstShippingRouteBranch({
        argumentsValue: {
          productNo: "9598600918", productPatch: { prdNm: "existing verified product name" },
          ...(assets === undefined ? {} : { sellerpilotAssets: assets })
        },
        operation: "listing.update", throughContentMode: true,
        context: { ...authoritativeShippingContext(3000), contentMode: "ai_generated" },
      });
      assert.equal(result.response?.status, 409);
      assert.equal((await result.response!.json()).code, "ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:3000");
      assert.equal(result.observations.contentBound, undefined, "paid source must return before classification or content lookup");
      assert.equal(result.reads.length, 1);
      assert.equal(providerCalls, 0);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("11st originally content-bound updates still enforce the real downstream contentMode guard", async () => {
  for (const operation of ["listing.create", "listing.update"]) {
    const invalid = await runElevenstShippingRouteBranch({
      argumentsValue: { productNo: "9598600918", productPatch: { prdNm: "existing verified product name" }, sellerpilotAssets: {} },
      operation, throughContentMode: true, context: { ...authoritativeShippingContext(0), contentMode: "ai_generated" },
    });
    assert.equal(invalid.observations.contentBound, true);
    assert.equal(invalid.response?.status, 409);
    assert.equal((await invalid.response!.json()).mode, "product_content_mode_mismatch");
    const valid = await runElevenstShippingRouteBranch({
      argumentsValue: {
        productNo: "9598600918", productPatch: { prdNm: "existing verified product name" },
        sellerpilotAssets: { contentMode: "manual_mvp", detailAssetMode: "manual_source" }
      },
      operation, throughContentMode: true, context: { ...authoritativeShippingContext(0), contentMode: "manual_mvp" },
    });
    assert.equal(valid.response, null);
    assert.equal(valid.observations.contentBound, true);
    assert.equal(valid.observations.contentModePassed, true);
    assert.equal(valid.reads.length, 2);
  }
});

for (const body of ["<html><body>not found</body></html>", "", "<ClientMessage><resultCode>500</resultCode></ClientMessage>"]) {
  test(`11st CREATE rejects unverified HTTP 404 before any product POST: ${body || "blank"}`, async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input); calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("category")) return new Response(categoryXml, { status: 200 });
      assert.match(url, /\/sellerprodcode\//);
      return new Response(body, { status: 404, headers: { "content-type": "text/xml;charset=UTF-8" } });
    };
    try {
      const result = await executeChannelOperation({ channel: "elevenst", operation: "listing.create", environment: "production", payload: elevenstCredential, arguments: { product: completeProduct() } });
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /ELEVENST_IDEMPOTENCY_LOOKUP_UNVERIFIED/);
      assert.ok(calls.every(call => call.method === "GET"));
    } finally { globalThis.fetch = originalFetch; }
  });
}

for (const field of ["rtngdDlvCst", "exchDlvCst"] as const) {
  test(`11st official ${field} accepts only whole ten-won amounts before any provider call`, async () => {
    for (const value of ["0", "10", "3000", "6000", "9999990"]) {
      assert.doesNotThrow(() => validateElevenstListingProduct(completeProduct({ [field]: value })));
    }
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error("No provider call expected"); };
    try {
      for (const value of ["1", "2999", "3001", "3,000", "3000.5"]) {
        assert.throws(() => validateElevenstListingProduct(completeProduct({ [field]: value })),
          new RegExp(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`));
        const result = await executeChannelOperation({
          channel: "elevenst", operation: "listing.create",
          payload: elevenstCredential, arguments: { product: completeProduct({ [field]: value }) }, environment: "production"
        });
        assert.equal(result.ok, false);
        assert.match(JSON.stringify(result.steps), /ELEVENST_PREWRITE_VALIDATION_FAILED/);
      }
      assert.equal(calls, 0);
    } finally { globalThis.fetch = original; }
  });
  test(`11st update rejects an invalid ${field} snapshot without changing the original`, () => {
    const snapshot = completeProduct({ [field]: "2999" });
    const before = structuredClone(snapshot);
    assert.throws(() => mergeElevenstListingUpdateProduct(snapshot, { prdNm: "Corrected name" }),
      new RegExp(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`));
    assert.deepEqual(snapshot, before);
  });
}

test("11st fixed prepaid shipping binds authoritative fee without changing free legacy XML", () => {
  assert.deepEqual(elevenstListingShippingFields({ shippingFeeKrw: 0 }), { dlvCstInstBasiCd: "01", dlvCstPayTypCd: "03" });
  const source = { shippingFeeKrw: 3000 };
  const fields = elevenstListingShippingFields(source);
  assert.deepEqual(fields, { dlvCstInstBasiCd: "02", dlvCstPayTypCd: "03", dlvCst1: "3000" });
  const product = completeProduct({ ...fields, addrSeqOut: "1234", addrSeqIn: "5678" });
  assert.strictEqual(validateElevenstListingArguments({ product, sellerpilotAssets: { shipping: source } }), product);
  const bound = bindElevenstAuthoritativeShippingSource({ product }, { product: { id: "same-product" }, manualFields: source }, "same-product");
  assert.deepEqual((bound.sellerpilotAssets as { shipping: unknown }).shipping, { shippingFeeKrw: 3000, shippingRule: undefined, packagingRule: undefined });
  for (const shippingFeeKrw of [undefined, null, "", true, 1, 2999, -10, 10_000_000]) {
    assert.throws(() => elevenstListingShippingFields({ shippingFeeKrw }), /ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED/);
  }
  for (const invalid of [{ dlvCst1: "4000" }, { dlvCstPayTypCd: "02" }, { dlvCstInstBasiCd: "01" }]) {
    assert.throws(() => validateElevenstListingArguments({ product: { ...product, ...invalid }, sellerpilotAssets: { shipping: source } }), /ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED/);
  }
  assert.throws(() => validateElevenstListingArguments({ product, sellerpilotAssets: { shipping: { shippingFeeKrw: 0 } } }), /ELEVENST_FREE_SHIPPING_AMOUNT_INVALID/);
});

test("11st fixed shipping preserves the small-price exception and enforces the documented limits", () => {
  const validateFixed = (salePrice: number, shippingFeeKrw: number) => {
    const product = completeProduct({
      selPrc: String(salePrice),
      ...elevenstListingShippingFields({ shippingFeeKrw }),
    });
    const before = structuredClone(product);
    const validated = validateElevenstListingArguments({
      product,
      sellerpilotAssets: { shipping: { shippingFeeKrw } },
    });
    assert.deepEqual(product, before);
    assert.equal(validated.dlvCst1, String(shippingFeeKrw));
  };

  assert.doesNotThrow(() => validateFixed(3190, 3000));
  assert.doesNotThrow(() => validateFixed(10_000, 5_000));
  assert.doesNotThrow(() => validateFixed(10_010, 5_000));
  assert.doesNotThrow(() => validateFixed(100_000, 50_000));

  for (const [salePrice, shippingFeeKrw] of [[10_000, 5_010], [10_010, 5_010], [100_010, 50_010]]) {
    assert.throws(
      () => validateFixed(salePrice, shippingFeeKrw),
      /ELEVENST_FIXED_SHIPPING_FEE_EXCEEDS_POLICY_LIMIT/,
    );
  }
});

test("11st create asks the user to correct a truly over-limit fixed fee without rewriting it", async () => {
  const impossible = completeProduct({
    selPrc: "3190",
    ...elevenstListingShippingFields({ shippingFeeKrw: 5010 }),
  });
  const before = structuredClone(impossible);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider access must not run");
  };
  try {
    const result = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      payload: elevenstCredential,
      environment: "production",
      arguments: {
        product: impossible,
        sellerpilotAssets: { shipping: { shippingFeeKrw: 5010 } },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
    assert.equal(
      result.steps[0]?.data.error,
      "ELEVENST_FIXED_SHIPPING_FEE_EXCEEDS_POLICY_LIMIT",
    );
    assert.match(
      result.safeMessage,
      /판매가 1만원 이하 국내 택배 상품은 최대 5천원/u,
    );
    assert.doesNotMatch(result.safeMessage, /1,?590/u);
    assert.deepEqual(impossible, before);
    assert.equal(impossible.dlvCst1, "5010");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const wrongFee of [false, true]) {
  test(`11st fixed shipping create sends official XML without treating undocumented Product GET fee echo as proof (changed=${wrongFee})`, async () => {
    const product = completeProduct({ ...elevenstListingShippingFields({ shippingFeeKrw: 3000 }), addrSeqOut: "1234", addrSeqIn: "5678" });
    const before = structuredClone(product);
    const originalFetch = globalThis.fetch;
    const writes: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("category")) return new Response(categoryXml, { status: 200 });
      if (url.includes("sellerprodcode")) return new Response("<ClientMessage><resultCode>404</resultCode><message>상품이 없습니다.</message></ClientMessage>", { status: 404 });
      if (init?.method === "POST") {
        writes.push(String(init.body));
        return new Response("<ClientMessage><productNo>123456789</productNo><resultCode>200</resultCode></ClientMessage>", { status: 200 });
      }
      if (url.includes("/prodmarket/stck/123456789")) return new Response(exactStockXml("123456789"), { status: 200 });
      return new Response(exactProductXml("123456789", { ...product, ...(wrongFee ? { dlvCst1: "0" } : {}) }), { status: 200 });
    };
    try {
      const result = await executeChannelOperation({ channel: "elevenst", operation: "listing.create", payload: elevenstCredential, environment: "production", arguments: { product, sellerpilotAssets: { shipping: { shippingFeeKrw: 3000 } } } });
      assert.equal(writes.length, 1);
      assert.match(writes[0], /<dlvCstInstBasiCd>02<\/dlvCstInstBasiCd>/);
      assert.match(writes[0], /<dlvCst1>3000<\/dlvCst1>/);
      assert.match(writes[0], /<addrSeqOut>1234<\/addrSeqOut>/);
      assert.doesNotMatch(writes[0], /shippingFeeKrw/);
      assert.equal(result.ok, true);
      assert.equal(
        result.steps[1]?.data.sellerpilotAdditionalEvidenceRequired,
        true,
      );
      assert.match(
        JSON.stringify(
          result.steps[1]?.data
            .sellerpilotProviderReadbackUnavailableFields,
        ),
        /dlvCst1/u,
      );
      assert.deepEqual(product, before);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("11st fixed shipping readback rejects changed or missing amount, address and return policy", () => {
  const product = completeProduct({ ...elevenstListingShippingFields({ shippingFeeKrw: 3000 }), addrSeqOut: "1234", addrSeqIn: "5678" });
  assert.equal(elevenstFixedShippingReadbackMatches(product, structuredClone(product)), true);
  for (const field of ["dlvCst1", "dlvCstPayTypCd", "bndlDlvCnYn", "rtngdDlvCst", "exchDlvCst", "addrSeqOut", "addrSeqIn"]) {
    assert.equal(elevenstFixedShippingReadbackMatches(product, { ...product, [field]: undefined }), false, field);
  }
});
