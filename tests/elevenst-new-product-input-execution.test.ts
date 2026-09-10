import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  elevenstNewProductInputContract,
  elevenstProviderAvailabilityReceiptContract,
  elevenstSellerIdentityReceiptContract,
  resolveElevenstNewProductInput,
  type ElevenstNoticeInput,
} from "../lib/channels/elevenst-new-product-input";
import { elevenstProcessedFoodNotificationFields } from "../lib/channels/elevenst-listing";
import { executeElevenst } from "../lib/product-registration/channels/elevenst";
import {
  buildElevenstCreateCredentialRequestBinding,
  elevenstCreateCredentialBindingArgument,
} from "../lib/product-registration/elevenst/credential-request-binding";
import {
  buildElevenstNewProductInputExecutionReceipt,
  elevenstNewProductInputReceiptArgument,
} from "../lib/product-registration/elevenst/new-product-input-execution";

const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const credentialId = "00000000-0000-4000-8000-000000000011";
const credentialVersion = 3;
const credential = { api_key: "A".repeat(32), seller_id: "couplit" };
const productName = "가공식품 실행 계약 테스트 상품";
const sellerProductCode = "FOOD-EXECUTION-001";
const digest = "a".repeat(64);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function detailHtml() {
  return `<section>${Array.from(
    { length: 8 },
    (_, index) => `<img src="https://cdn.example.test/food-${index + 1}.jpg">`,
  ).join("")}</section>`;
}

function noticeValues() {
  return new Map(elevenstProcessedFoodNotificationFields.map(({ code }) => [
    code,
    code === "176317774" ? productName : `테스트 승인값 ${code}`,
  ]));
}

function processedProduct(overrides: Record<string, unknown> = {}) {
  const values = noticeValues();
  return {
    selMthdCd: "01",
    dispCtgrNo: "1346631",
    prdTypCd: "01",
    prdNm: productName,
    brand: "SellerPilot",
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: "대한민국",
    sellerPrdCd: sellerProductCode,
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: "01",
    minorSelCnYn: "Y",
    prdImage01: "https://cdn.example.test/main.jpg",
    htmlDetail: detailHtml(),
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    aplBgnDy: "2026/09/10",
    aplEndDy: "2029/09/09",
    selPrc: "3190",
    prdSelQty: "1",
    dlvCnAreaCd: "01",
    dlvWyCd: "01",
    dlvCstInstBasiCd: "02",
    dlvCst1: "3000",
    addrSeqOut: "1234",
    addrSeqIn: "5678",
    bndlDlvCnYn: "Y",
    dlvCstPayTypCd: "03",
    rtngdDlvCst: "3000",
    exchDlvCst: "6000",
    asDetail: "11번가 판매자 문의 이용",
    rtngExchDetail: "지정 반품지로 반송",
    ProductNotification: {
      type: "891031",
      item: elevenstProcessedFoodNotificationFields.map(({ code }) => ({
        code,
        name: values.get(code),
      })),
    },
    ...overrides,
  };
}

function evidenceNotice(
  code: string,
  value: string,
  capturedAt: string,
  approvedAt: string,
): ElevenstNoticeInput {
  const sourceSha256 = sha256(`source:${code}`);
  return {
    code,
    required: true,
    value,
    source: {
      kind: "product_label",
      productId,
      revision: 1,
      sourceSha256,
      capturedAt,
    },
    approval: {
      productId,
      categoryId: "1346631",
      fieldCode: code,
      revision: 2,
      sourceSha256,
      valueSha256: sha256(value),
      approvedAt,
    },
  };
}

function readyExecution(now = new Date()) {
  const product = processedProduct();
  const capturedAt = new Date(now.getTime() - 120_000).toISOString();
  const approvedAt = new Date(now.getTime() - 60_000).toISOString();
  const values = noticeValues();
  const preflight = resolveElevenstNewProductInput({
    contract: elevenstNewProductInputContract,
    product: { id: productId, name: productName, approvalRevision: 2 },
    categoryId: "1346631",
    notices: elevenstProcessedFoodNotificationFields
      .filter(({ code }) => code !== "176317774")
      .map(({ code }) => evidenceNotice(code, values.get(code)!, capturedAt, approvedAt)),
    sellerIdentity: {
      contract: elevenstSellerIdentityReceiptContract,
      credentialId,
      credentialVersion,
      environment: "production",
      sellerIdSha256: digest,
      sellerOfficeAccountSha256: digest,
      ownershipRevision: 4,
      verifiedAt: approvedAt,
    },
    providerAvailability: {
      contract: elevenstProviderAvailabilityReceiptContract,
      state: "available",
      observedAt: approvedAt,
    },
  }, now);
  assert.equal(preflight.state, "ready", JSON.stringify(preflight.blockers));
  const binding = buildElevenstCreateCredentialRequestBinding({
    credentialId,
    credentialVersion,
    environment: "production",
    credential,
  });
  const receipt = buildElevenstNewProductInputExecutionReceipt({
    preflight,
    productId,
    product,
    credentialId,
    credentialVersion,
    environment: "production",
    productApprovalRevision: 2,
    sellerIdentityOwnershipRevision: 4,
    providerAvailabilityObservedAt: approvedAt,
    issuedAt: now,
  });
  return { product, binding, receipt };
}

async function executeWithoutProvider(argumentsValue: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let beginCalls = 0;
  let leaseCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const operation = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      environment: "production",
      payload: credential,
      arguments: argumentsValue,
      providerMutationHooks: {
        begin: async () => { beginCalls += 1; },
        assertLeaseHealthy: async () => { leaseCalls += 1; },
      },
    });
    return { operation, fetchCalls, beginCalls, leaseCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("006-style 2-of-11 input is blocked before provider GET/POST and exposes the exact nine missing codes", async () => {
  const product = processedProduct();
  const notification = product.ProductNotification as { item: Array<{ code: string; name: string }> };
  notification.item = notification.item.filter(({ code }) => ["176317774", "42155152"].includes(code));
  const outcome = await executeWithoutProvider({ product });

  assert.equal(outcome.operation.ok, false);
  assert.equal(outcome.operation.steps[0]?.name, "new-product-input-preflight");
  assert.equal(outcome.operation.steps[0]?.data.sellerpilotProviderCalls, 0);
  const blockers = outcome.operation.steps[0]?.data.sellerpilotBlockers as Array<{ code: string; fieldCode?: string }>;
  assert.deepEqual(
    blockers.filter(({ code }) => code === "ELEVENST_NEW_PRODUCT_NOTICE_INPUT_MISSING").map(({ fieldCode }) => fieldCode),
    ["176400445", "176398001", "42154823", "23757260", "23757095", "176312674", "23756754", "23757245", "23757000"],
  );
  assert.ok(blockers.some(({ code }) => code === "ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_REQUIRED"));
  assert.deepEqual([outcome.fetchCalls, outcome.beginCalls, outcome.leaseCalls], [0, 0, 0]);
});

test("complete 11-field XML without a server-owned receipt still performs zero provider calls", async () => {
  const outcome = await executeWithoutProvider({ product: processedProduct() });
  const blockers = outcome.operation.steps[0]?.data.sellerpilotBlockers as Array<{ code: string }>;
  assert.ok(blockers.some(({ code }) => code === "ELEVENST_NEW_PRODUCT_INPUT_RECEIPT_REQUIRED"));
  assert.deepEqual([outcome.fetchCalls, outcome.beginCalls, outcome.leaseCalls], [0, 0, 0]);
});

test("receipt mismatch, stale credential revision, expiry and browser-added fields all fail before provider access", async () => {
  const scenarios = [
    (input: ReturnType<typeof readyExecution>) => {
      const notification = input.product.ProductNotification as { item: Array<{ code: string; name: string }> };
      notification.item.splice(3, 1);
    },
    (input: ReturnType<typeof readyExecution>) => {
      input.binding = { ...input.binding, credentialVersion: credentialVersion + 1 };
    },
    (input: ReturnType<typeof readyExecution>) => {
      input.receipt = { ...input.receipt, issuedAt: "2026-01-01T00:00:00.000Z", validUntil: "2026-01-01T00:10:00.000Z" };
    },
    (input: ReturnType<typeof readyExecution>) => {
      input.receipt = { ...input.receipt, browserApproved: true } as typeof input.receipt;
    },
  ];
  for (const mutate of scenarios) {
    const input = readyExecution();
    mutate(input);
    const outcome = await executeWithoutProvider({
      product: input.product,
      [elevenstCreateCredentialBindingArgument]: input.binding,
      [elevenstNewProductInputReceiptArgument]: input.receipt,
    });
    assert.equal(outcome.operation.ok, false);
    assert.equal(outcome.operation.steps[0]?.name, "new-product-input-preflight");
    assert.deepEqual([outcome.fetchCalls, outcome.beginCalls, outcome.leaseCalls], [0, 0, 0]);
  }
});

function escape(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function productXml(productNo: string, product: Record<string, unknown>) {
  const fields = [
    "dispCtgrNo", "prdNm", "sellerPrdCd", "selPrc", "bndlDlvCnYn",
    "rtngdDlvCst", "exchDlvCst", "asDetail",
  ];
  const scalars = fields.map((field) => `<${field}>${escape(product[field])}</${field}>`).join("");
  return `<Product><prdNo>${productNo}</prdNo><selStatCd>103</selStatCd>${scalars}<aplBgnDy>2026-09-10 00:00:00</aplBgnDy><aplEndDy>2029-09-09 23:59:59</aplEndDy><htmlDetail><![CDATA[${String(product.htmlDetail)}]]></htmlDetail></Product>`;
}

test("verified receipt permits one POST and its exact 11 values and order enter ProductNotification XML", async () => {
  const prepared = readyExecution();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  let beginCalls = 0;
  let leaseCalls = 0;
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response("<categorys><category><depth>4</depth><dispNm>가공식품</dispNm><dispNo>1346631</dispNo><leafYn>Y</leafYn><parentDispNo>1</parentDispNo></category></categorys>", { status: 200 });
    }
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response("<ClientMessage><resultCode>404</resultCode><message>상품이 없습니다.</message></ClientMessage>", { status: 404 });
    }
    if (call.method === "POST") {
      return new Response("<ClientMessage><resultCode>200</resultCode><productNo>123456789</productNo></ClientMessage>", { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/stck/123456789")) {
      return new Response("<ProductStocks><ProductStock><prdNo>123456789</prdNo><prdStckNo>987654321</prdStckNo><stckQty>1</stckQty><prdStckStatCd>01</prdStckStatCd></ProductStock></ProductStocks>", { status: 200 });
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
      return new Response(productXml("123456789", prepared.product), { status: 200 });
    }
    throw new Error(`unexpected request ${call.url}`);
  };
  try {
    const operation = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      environment: "production",
      payload: credential,
      arguments: {
        product: prepared.product,
        sellerpilotAssets: { shipping: { shippingFeeKrw: 3000 } },
        [elevenstCreateCredentialBindingArgument]: prepared.binding,
        [elevenstNewProductInputReceiptArgument]: prepared.receipt,
      },
      providerMutationHooks: {
        begin: async () => { beginCalls += 1; },
        assertLeaseHealthy: async () => { leaseCalls += 1; },
      },
    });

    assert.equal(operation.ok, true);
    assert.equal(operation.remoteId, "123456789");
    const posts = calls.filter(({ method }) => method === "POST");
    assert.equal(posts.length, 1);
    const notificationXml = posts[0].body.match(/<ProductNotification>[\s\S]*?<\/ProductNotification>/u)?.[0] ?? "";
    const xmlItems = [...notificationXml.matchAll(/<item><code>([^<]+)<\/code><name>([^<]+)<\/name><\/item>/gu)]
      .map((match) => ({ code: match[1], name: match[2] }));
    const expected = (prepared.product.ProductNotification as { item: Array<{ code: string; name: string }> }).item;
    assert.deepEqual(xmlItems, expected);
    assert.deepEqual(
      xmlItems.map(({ code, name }) => ({ code, valueSha256: sha256(name) })),
      prepared.receipt.items.map(({ code, valueSha256 }) => ({ code, valueSha256 })),
    );
    assert.deepEqual([beginCalls, leaseCalls], [0, 0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("receipt builder rejects a blocked 007 preflight instead of blessing partial input", () => {
  const prepared = readyExecution();
  const blocked = { ...resolveElevenstNewProductInput({
    contract: elevenstNewProductInputContract,
    product: { id: productId, name: productName, approvalRevision: 2 },
    categoryId: "1346631",
    notices: [],
  }), state: "blocked" as const, canCreate: false };
  assert.throws(() => buildElevenstNewProductInputExecutionReceipt({
    preflight: blocked,
    productId,
    product: prepared.product,
    credentialId,
    credentialVersion,
    environment: "production",
    productApprovalRevision: 2,
    sellerIdentityOwnershipRevision: 4,
    providerAvailabilityObservedAt: new Date().toISOString(),
  }), /ELEVENST_NEW_PRODUCT_INPUT_PREFLIGHT_NOT_READY/u);
});
