import assert from "node:assert/strict";
import test from "node:test";
import { executeElevenst } from "../lib/product-registration/channels/elevenst";
import {
  assertElevenstCreateCredentialBinding,
  elevenstSellerCodeLookupProductNo,
  verifyElevenstCreateProductReadback,
  verifyElevenstCreateStockReadback,
} from "../lib/product-registration/elevenst/create-verification";
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
