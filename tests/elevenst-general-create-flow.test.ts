import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { executeElevenst } from "../lib/product-registration/channels/elevenst";
import {
  assertElevenstCreateCredentialBinding,
  elevenstSellerCodeLookupProductNo,
  verifyElevenstCreateProductReadback,
  verifyElevenstCreateStockReadback,
} from "../lib/product-registration/elevenst/create-verification";
import { prepareElevenstCredentialForSave } from "../lib/product-registration/elevenst/credential-save";
import {
  assertElevenstGatewayCredentialVersionReceipt,
  elevenstGatewayCredentialVersionContract,
} from "../lib/product-registration/elevenst/credential-version";
import {
  assertElevenstCreateCredentialRequestBinding,
  buildElevenstCreateCredentialRequestBinding,
  elevenstCreateCredentialBindingArgument,
} from "../lib/product-registration/elevenst/credential-request-binding";
import { prepareMarketplaceListingArguments } from "../lib/channels/provider-listing-runtime";
import type { RemoteResponse } from "../lib/channels/protocols";

const credential = {
  api_key: "A".repeat(32),
  seller_id: "fixture-seller",
};

const categoryXml = `<?xml version="1.0"?><categorys>
  <category><depth>3</depth><dispNm>케이블 정리소품</dispNm><dispNo>1341821</dispNo><leafYn>Y</leafYn><parentDispNo>1340388</parentDispNo></category>
</categorys>`;

function product(overrides: Record<string, unknown> = {}) {
  const detail = `<section lang="ko-KR">${Array.from(
    { length: 8 },
    (_, index) => `<img src="https://cdn.example.test/detail-${index + 1}.jpg">`,
  ).join("")}</section>`;
  return {
    selMthdCd: "01",
    dispCtgrNo: "1341821",
    prdTypCd: "01",
    prdNm: "일반 등록 검증 상품",
    brand: "SellerPilot",
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: "대한민국",
    sellerPrdCd: "GENERAL-CREATE-001",
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: "01",
    minorSelCnYn: "Y",
    prdImage01: "https://cdn.example.test/main.jpg",
    prdImage02: "https://cdn.example.test/sub-2.jpg",
    prdImage03: "https://cdn.example.test/sub-3.jpg",
    prdImage04: "https://cdn.example.test/sub-4.jpg",
    htmlDetail: detail,
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    aplBgnDy: "2026/09/09",
    aplEndDy: "2029/09/08",
    selPrc: "3190",
    prdSelQty: "7",
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
      type: "891045",
      item: [
        { code: "11800", name: "일반 등록 검증 상품" },
        { code: "11905", name: "SellerPilot" },
        { code: "23760413", name: "11번가 판매자 문의 이용" },
        { code: "23759100", name: "대한민국" },
        { code: "23756033", name: "해당사항 없음" },
      ],
    },
    ...overrides,
  };
}

function escape(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function officialProductReadback(
  productNo: string,
  value: Record<string, unknown>,
) {
  const officialDate = (field: "aplBgnDy" | "aplEndDy", time: string) =>
    `${String(value[field]).replaceAll("/", "-")} ${time}`;
  return {
    prdNo: productNo,
    dispCtgrNo: value.dispCtgrNo,
    prdNm: value.prdNm,
    sellerPrdCd: value.sellerPrdCd,
    selPrc: value.selPrc,
    bndlDlvCnYn: value.bndlDlvCnYn,
    rtngdDlvCst: value.rtngdDlvCst,
    exchDlvCst: value.exchDlvCst,
    asDetail: value.asDetail,
    htmlDetail: value.htmlDetail,
    aplBgnDy: officialDate("aplBgnDy", "00:00:00"),
    aplEndDy: officialDate("aplEndDy", "23:59:59"),
  };
}

function productXml(productNo: string, value: Record<string, unknown>) {
  const readback = officialProductReadback(productNo, value);
  const scalarFields = [
    "dispCtgrNo", "prdNm", "sellerPrdCd", "selPrc", "bndlDlvCnYn",
    "rtngdDlvCst", "exchDlvCst", "asDetail", "aplBgnDy", "aplEndDy",
  ];
  const scalars = scalarFields.flatMap((field) =>
    readback[field as keyof typeof readback] === undefined ||
      readback[field as keyof typeof readback] === ""
      ? []
      : [
          `<${field}>${escape(
            readback[field as keyof typeof readback],
          )}</${field}>`,
        ],
  ).join("");
  return `<Product><prdNo>${productNo}</prdNo><selStatCd>103</selStatCd>${scalars}<htmlDetail><![CDATA[${String(readback.htmlDetail)}]]></htmlDetail></Product>`;
}

function stockXml(productNo: string, quantity: string, status = "01") {
  return `<ProductStocks><ProductStock><prdNo>${productNo}</prdNo><prdStckNo>987654321</prdStckNo><stckQty>${quantity}</stckQty><prdStckStatCd>${status}</prdStckStatCd></ProductStock></ProductStocks>`;
}

function remote(data: Record<string, unknown>): RemoteResponse {
  return {
    response: new Response(null, { status: 200 }),
    text: "",
    data: { accepted: true, ...data },
  };
}

test("11st general create credential requires a 32-character OPEN API key and separately stored seller ID", () => {
  assert.deepEqual(assertElevenstCreateCredentialBinding(credential), {
    apiKeyConfigured: true,
    sellerIdConfigured: true,
  });
  assert.deepEqual(
    assertElevenstCreateCredentialBinding({
      api_key: "B".repeat(32),
      seller_id: "another-seller",
    }),
    { apiKeyConfigured: true, sellerIdConfigured: true },
  );
  assert.throws(
    () => assertElevenstCreateCredentialBinding({ api_key: "password", seller_id: "fixture-seller" }),
    /ELEVENST_CREATE_OPEN_API_KEY_REQUIRED/u,
  );
  assert.throws(
    () => assertElevenstCreateCredentialBinding({ api_key: "A".repeat(32) }),
    /ELEVENST_CREATE_SELLER_ID_REQUIRED/u,
  );
  assert.throws(
    () => assertElevenstCreateCredentialBinding({ api_key: "A".repeat(32), seller_id: " sample " }),
    /ELEVENST_CREATE_SELLER_ID_PLACEHOLDER/u,
  );
});

test("11st credential save binds the exact active version and preserves the selected seller", () => {
  const metadata = {
    id: "00000000-0000-4000-8000-000000000011",
    channel: "elevenst",
    environment: "production",
    status: "active",
    version: 3,
  };
  const prepared = prepareElevenstCredentialForSave({
    credentialId: metadata.id,
    credentialVersion: 3,
    environment: "production",
    metadata,
    secretPayload: { api_key: "A".repeat(32), seller_id: " another-seller " },
  });
  assert.equal(prepared.seller_id, "another-seller");
  assert.equal(prepared.api_key, "A".repeat(32));

  for (const candidate of [
    { ...metadata, version: 2 },
    { ...metadata, id: "00000000-0000-4000-8000-000000000012" },
    { ...metadata, environment: "sandbox" },
    { ...metadata, status: "grace" },
  ]) {
    assert.throws(
      () => prepareElevenstCredentialForSave({
        credentialId: metadata.id,
        credentialVersion: 3,
        environment: "production",
        metadata: candidate,
        secretPayload: credential,
      }),
      /ELEVENST_CREDENTIAL_SOURCE_STALE/u,
    );
  }
});

test("11st credential save rejects missing version, seller ID and placeholder", () => {
  const metadata = {
    id: "00000000-0000-4000-8000-000000000011",
    channel: "elevenst",
    environment: "production",
    status: "active",
    version: 3,
  };
  assert.throws(
    () => prepareElevenstCredentialForSave({
      credentialId: metadata.id,
      environment: "production",
      metadata,
      secretPayload: credential,
    }),
    /ELEVENST_CREDENTIAL_SOURCE_VERSION_REQUIRED/u,
  );
  for (const [sellerId, code] of [
    [undefined, "ELEVENST_CREATE_SELLER_ID_REQUIRED"],
    ["sample", "ELEVENST_CREATE_SELLER_ID_PLACEHOLDER"],
  ] as const) {
    assert.throws(
      () => prepareElevenstCredentialForSave({
        environment: "production",
        metadata: null,
        secretPayload: {
          api_key: "A".repeat(32),
          ...(sellerId === undefined ? {} : { seller_id: sellerId }),
        },
      }),
      new RegExp(code, "u"),
    );
  }
});

test("11st request binding isolates the credential ID, version, environment and seller digest", () => {
  const credentialId = "00000000-0000-4000-8000-000000000011";
  const selectedCredential = { api_key: "A".repeat(32), seller_id: "seller-alpha" };
  const binding = buildElevenstCreateCredentialRequestBinding({
    credentialId,
    credentialVersion: 3,
    environment: "production",
    credential: selectedCredential,
  });
  assert.equal(JSON.stringify(binding).includes("seller-alpha"), false);
  assert.deepEqual(assertElevenstCreateCredentialRequestBinding({
    credentialId,
    credentialVersion: 3,
    environment: "production",
    credential: selectedCredential,
    binding,
  }), { credentialId, credentialVersion: 3 });
  assert.throws(
    () => assertElevenstCreateCredentialRequestBinding({
      credentialId,
      credentialVersion: undefined,
      environment: "production",
      credential: selectedCredential,
      binding,
    }),
    /ELEVENST_CREATE_CREDENTIAL_VERSION_REQUIRED/u,
  );
  assert.throws(
    () => assertElevenstCreateCredentialRequestBinding({
      credentialId,
      credentialVersion: 4,
      environment: "production",
      credential: selectedCredential,
      binding,
    }),
    /ELEVENST_CREATE_CREDENTIAL_VERSION_MISMATCH/u,
  );
  assert.throws(
    () => assertElevenstCreateCredentialRequestBinding({
      credentialId: "00000000-0000-4000-8000-000000000012",
      credentialVersion: 3,
      environment: "production",
      credential: selectedCredential,
      binding,
    }),
    /ELEVENST_CREATE_CREDENTIAL_ID_MISMATCH/u,
  );
  assert.throws(
    () => assertElevenstCreateCredentialRequestBinding({
      credentialId,
      credentialVersion: 3,
      environment: "sandbox",
      credential: selectedCredential,
      binding,
    }),
    /ELEVENST_CREATE_CREDENTIAL_ENVIRONMENT_MISMATCH/u,
  );
  assert.throws(
    () => assertElevenstCreateCredentialRequestBinding({
      credentialId,
      credentialVersion: 3,
      environment: "production",
      credential: { ...selectedCredential, seller_id: "seller-beta" },
      binding,
    }),
    /ELEVENST_CREATE_SELLER_ID_MISMATCH/u,
  );
});

test("11st gateway credential-version receipt is exact and contains no secret material", () => {
  const receipt = {
    contract: elevenstGatewayCredentialVersionContract,
    status: "verified",
    jobId: "00000000-0000-4000-8000-000000000021",
    credentialId: "00000000-0000-4000-8000-000000000011",
    credentialVersion: 3,
    environment: "production",
  };
  assert.equal(assertElevenstGatewayCredentialVersionReceipt({
    receipt,
    jobId: receipt.jobId,
    credentialId: receipt.credentialId,
    environment: "production",
  }), 3);
  assert.equal(JSON.stringify(receipt).includes("api_key"), false);
  assert.equal(JSON.stringify(receipt).includes("seller_id"), false);
  assert.throws(() => assertElevenstGatewayCredentialVersionReceipt({
    receipt: { ...receipt, credentialVersion: 0 },
    jobId: receipt.jobId,
    credentialId: receipt.credentialId,
    environment: "production",
  }), /ELEVENST_GATEWAY_CREDENTIAL_VERSION_RECEIPT_INVALID/u);
});

test("11st worker prepare rejects an unbound seller and accepts another selected seller before mutation", async () => {
  const credentialId = "00000000-0000-4000-8000-000000000011";
  const input = (sellerId: string, boundSellerId = sellerId) => ({
    channel: "elevenst" as const,
    operation: "listing.create" as const,
    environment: "production" as const,
    credentialId,
    credentialVersion: 3,
    credential: { api_key: "A".repeat(32), seller_id: sellerId },
    arguments: {
      product: product(),
      sellerpilotAssets: { shipping: { shippingFeeKrw: 3000, policyReview: "확인" } },
      [elevenstCreateCredentialBindingArgument]:
        buildElevenstCreateCredentialRequestBinding({
          credentialId,
          credentialVersion: 3,
          environment: "production",
          credential: { api_key: "A".repeat(32), seller_id: boundSellerId },
        }),
    },
    signal: AbortSignal.timeout(1_000),
    hooks: {
      assertLeaseHealthy: async () => undefined,
      beginProviderMutation: async () => { throw new Error("mutation must not begin"); },
    },
  });
  await assert.rejects(
    prepareMarketplaceListingArguments(input("seller-beta", "seller-alpha")),
    /ELEVENST_CREATE_SELLER_ID_MISMATCH/u,
  );
  await assert.rejects(
    prepareMarketplaceListingArguments({
      ...input("seller-alpha"),
      arguments: { product: product() },
    }),
    /ELEVENST_CREATE_CREDENTIAL_BINDING_REQUIRED/u,
  );
  await assert.rejects(
    prepareMarketplaceListingArguments({
      ...input("seller-alpha"),
      credentialVersion: 4,
    }),
    /ELEVENST_CREATE_CREDENTIAL_VERSION_MISMATCH/u,
  );
  const validInput = input("another-seller");
  const prepared = await prepareMarketplaceListingArguments(validInput);
  assert.equal(prepared.arguments, validInput.arguments);
  assert.equal(prepared.mediaMutationObserved, false);
});

test("11st actual admin route and both gateway workers carry the exact current credential version", async () => {
  const [route, rotateRoute, localWorker, serverlessGateway, serverlessWorker, versionRoute] = await Promise.all([
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/channel-credentials/rotate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/commerce-gateway-job.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/channel-gateway/worker/elevenst-credential-version/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /elevenst_credential_binding_server_owned/u);
  assert.match(route, /buildElevenstCreateCredentialRequestBinding\(\{[\s\S]*credentialId: parsed\.data\.credentialId,[\s\S]*credentialVersion,[\s\S]*environment,[\s\S]*credential: elevenstCredential/u);
  assert.match(localWorker, /credentialId: job\.credential_id/u);
  assert.match(localWorker, /elevenst-credential-version[\s\S]*credentialVersion: elevenstCredentialVersion/u);
  assert.match(serverlessGateway, /verifyElevenstGatewayCredentialVersion[\s\S]*elevenstCredentialVersion/u);
  assert.match(serverlessWorker, /credentialId: input\.job\.credential_id/u);
  assert.match(serverlessWorker, /credentialVersion: input\.elevenstCredentialVersion/u);
  assert.match(versionRoute, /sellerpilot_service_elevenst_gateway_credential_version|elevenstGatewayCredentialVersionRpc/u);
  assert.match(rotateRoute, /sellerpilot_rotate_elevenst_credential_exact/u);
  assert.match(rotateRoute, /: await userClient\.rpc\("sellerpilot_rotate_credential"/u);
});

test("11st general create rejects a missing seller ID before category, lookup, or product calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const operation = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      environment: "production",
      payload: { api_key: "A".repeat(32) },
      arguments: { product: product() },
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.name, "seller-account-contract");
    assert.equal(operation.steps[0]?.data.error, "ELEVENST_CREATE_SELLER_ID_REQUIRED");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st general create rejects the observed seller ID placeholder before provider calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const operation = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      environment: "production",
      payload: { api_key: "A".repeat(32), seller_id: "sample" },
      arguments: { product: product() },
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.name, "seller-account-contract");
    assert.equal(
      operation.steps[0]?.data.error,
      "ELEVENST_CREATE_SELLER_ID_PLACEHOLDER",
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st create verifier checks documented Product fields and the separate single-stock resource", () => {
  const expected = product();
  const productRemote = remote({
    productNo: "123456789",
    product: officialProductReadback("123456789", expected),
  });
  const verified = verifyElevenstCreateProductReadback({
    expectedProduct: expected,
    remote: productRemote,
    productNo: "123456789",
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.mismatches, []);
  assert.deepEqual(verified.normalizedFields, ["aplBgnDy", "aplEndDy"]);
  assert.deepEqual(verified.separatelyVerifiedFields, ["prdSelQty"]);
  assert.ok(verified.providerReadbackUnavailableFields.includes("dlvCst1"));
  assert.ok(
    verified.providerReadbackUnavailableFields.includes("ProductNotification"),
  );
  assert.ok(
    verified.providerReadbackUnavailableFields.includes("ProductCertGroup"),
  );
  const changed = officialProductReadback("123456789", expected);
  changed.selPrc = "3200";
  const mismatched = verifyElevenstCreateProductReadback({
    expectedProduct: expected,
    remote: remote({ productNo: "123456789", product: changed }),
    productNo: "123456789",
  });
  assert.equal(mismatched.ok, false);
  assert.deepEqual(mismatched.mismatches, ["product.selPrc"]);
  assert.equal(
    verifyElevenstCreateStockReadback({
      remote: remote({
        stockDocumentRoot: "ProductStocks",
        stocks: [{ prdNo: "123456789", prdStckNo: "987654321", stckQty: "7", prdStckStatCd: "01" }],
      }),
      productNo: "123456789",
      expectedQuantity: 7,
    }).ok,
    true,
  );
});

test("11st Product readback verifies response and Product-node IDs independently", () => {
  const expected = product();
  const nodeMismatch = verifyElevenstCreateProductReadback({
    expectedProduct: expected,
    remote: remote({
      productNo: "123456789",
      product: officialProductReadback("123456790", expected),
    }),
    productNo: "123456789",
  });
  assert.equal(nodeMismatch.ok, false);
  assert.ok(nodeMismatch.mismatches.includes("product.prdNo"));

  const responseMismatch = verifyElevenstCreateProductReadback({
    expectedProduct: expected,
    remote: remote({
      productNo: "123456790",
      product: officialProductReadback("123456789", expected),
    }),
    productNo: "123456789",
  });
  assert.equal(responseMismatch.ok, false);
  assert.ok(responseMismatch.mismatches.includes("response.productNo"));
});

test("11st seller code lookup rejects multiple remote products instead of choosing the first", () => {
  assert.throws(
    () => elevenstSellerCodeLookupProductNo({
      sellerProductCode: "GENERAL-CREATE-001",
      remote: remote({
        productNo: "123456789",
        products: [
          { productNo: "123456789", sellerProductCode: "GENERAL-CREATE-001" },
          { productNo: "123456790", sellerProductCode: "GENERAL-CREATE-001" },
        ],
      }),
    }),
    /ELEVENST_SELLER_CODE_LOOKUP_AMBIGUOUS/u,
  );
});

test("11st general create stops before POST when seller product code lookup is ambiguous", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = {
      url: String(input),
      method: String(init?.method ?? "GET"),
    };
    calls.push(call);
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200 });
    }
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response(
        `<products>
          <product><prdNo>123456789</prdNo><sellerPrdCd>GENERAL-CREATE-001</sellerPrdCd></product>
          <product><prdNo>123456790</prdNo><sellerPrdCd>GENERAL-CREATE-001</sellerPrdCd></product>
        </products>`,
        { status: 200 },
      );
    }
    throw new Error(`unexpected request ${call.url}`);
  };
  try {
    const operation = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      environment: "production",
      payload: credential,
      arguments: { product: product() },
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.name, "product-idempotency-read");
    assert.equal(
      operation.steps[0]?.data.error,
      "ELEVENST_SELLER_CODE_LOOKUP_AMBIGUOUS",
    );
    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st fresh CREATE reports an existing seller code as duplicate recovery and never POSTs", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    if (call.url.includes("/rest/cateservice/category")) {
      return new Response(categoryXml, { status: 200 });
    }
    if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
      return new Response(
        `<products><product><prdNo>123456789</prdNo><sellerPrdCd>GENERAL-CREATE-001</sellerPrdCd></product></products>`,
        { status: 200 },
      );
    }
    if (call.url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
      return new Response(
        `<Product><prdNo>123456789</prdNo><sellerPrdCd>GENERAL-CREATE-001</sellerPrdCd><selStatCd>103</selStatCd></Product>`,
        { status: 200 },
      );
    }
    throw new Error(`unexpected request ${call.url}`);
  };
  try {
    const operation = await executeElevenst({
      channel: "elevenst",
      operation: "listing.create",
      environment: "production",
      payload: credential,
      arguments: { product: product() },
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.name, "product-create-duplicate-detected");
    assert.equal(operation.steps[0]?.status, 409);
    assert.equal(operation.steps[0]?.data.sellerpilotDuplicateExistingProduct, true);
    assert.equal(operation.steps[0]?.data.sellerpilotFreshCreateCompleted, false);
    assert.equal(operation.steps[0]?.data.sellerpilotProviderMutationPerformed, false);
    assert.equal(
      gatewayJobCompletionStatus(operation.operation, operation.ok, operation.steps),
      "failed",
    );
    assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const mismatch of ["none", "product-price", "stock-quantity", "stock-status"] as const) {
  test(`11st general paid CREATE performs one POST and requires Product plus stock readback: ${mismatch}`, async () => {
    const originalFetch = globalThis.fetch;
    const expected = product();
    const calls: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const call = {
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: String(init?.body ?? ""),
      };
      calls.push(call);
      if (call.url.includes("/rest/cateservice/category")) {
        return new Response(categoryXml, { status: 200 });
      }
      if (call.url.includes("/rest/prodmarketservice/sellerprodcode/")) {
        return new Response(
          "<ClientMessage><resultCode>404</resultCode><message>상품이 없습니다.</message></ClientMessage>",
          { status: 404 },
        );
      }
      if (call.url.endsWith("/rest/prodservices/product")) {
        return new Response(
          "<ClientMessage><resultCode>200</resultCode><productNo>123456789</productNo></ClientMessage>",
          { status: 200 },
        );
      }
      if (call.url.endsWith("/rest/prodmarketservice/prodmarket/123456789")) {
        return new Response(
          productXml(
            "123456789",
            mismatch === "product-price"
              ? { ...expected, selPrc: "3200" }
              : expected,
          ),
          { status: 200 },
        );
      }
      if (call.url.endsWith("/rest/prodmarketservice/prodmarket/stck/123456789")) {
        return new Response(
          stockXml(
            "123456789",
            mismatch === "stock-quantity" ? "0" : "7",
            mismatch === "stock-status" ? "02" : "01",
          ),
          { status: 200 },
        );
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
          product: expected,
          sellerpilotAssets: { shipping: { shippingFeeKrw: 3000 } },
        },
      });
      assert.equal(operation.ok, mismatch === "none");
      assert.equal(operation.remoteId, "123456789");
      assert.equal(
        calls.filter((call) => call.method === "POST").length,
        1,
      );
      const post = calls.find((call) => call.method === "POST")!;
      assert.match(post.body, /<sellerPrdCd>GENERAL-CREATE-001<\/sellerPrdCd>/u);
      assert.match(post.body, /<dlvCstInstBasiCd>02<\/dlvCstInstBasiCd>/u);
      assert.match(post.body, /<dlvCst1>3000<\/dlvCst1>/u);
      assert.match(post.body, /<addrSeqOut>1234<\/addrSeqOut>/u);
      assert.match(post.body, /<rtngdDlvCst>3000<\/rtngdDlvCst>/u);
      assert.match(post.body, /<exchDlvCst>6000<\/exchDlvCst>/u);
      assert.doesNotMatch(post.body, /fixture-seller|seller_id|openapikey/u);
      assert.deepEqual(operation.steps.map((step) => step.name), [
        "product-create",
        "product-readback",
        "product-stock-readback",
      ]);
      if (mismatch === "product-price") {
        assert.match(
          JSON.stringify(operation.steps[1]?.data.sellerpilotMismatches),
          /product\.selPrc/u,
        );
      }
      if (mismatch === "stock-quantity") {
        assert.match(
          JSON.stringify(operation.steps[2]?.data.sellerpilotMismatches),
          /stocks\.0\.stckQty/u,
        );
      }
      if (mismatch === "stock-status") {
        assert.match(
          JSON.stringify(operation.steps[2]?.data.sellerpilotMismatches),
          /stocks\.0\.prdStckStatCd/u,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
