import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { recoverElevenstCreateGetOnly } from "../lib/product-registration/elevenst/create-recovery";

const apiKey = "A".repeat(32);
const sellerProductCode = "ELEVENST-RECOVERY-001";
const credentialBinding = {
  credentialId: "00000000-0000-4000-8000-000000000011",
  credentialVersion: 3,
  credentialFingerprint: "ABCDEF123456",
  vaultSecretId: "00000000-0000-4000-8000-000000000012",
  expectedApiKeySha256: createHash("sha256").update(apiKey).digest("hex"),
};

function xmlResponse(body: string, contentType = "text/xml; charset=utf-8") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

test("11st CREATE recovery classifies official zero-result lookup as absent and stays GET-only", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(String(init?.method ?? "GET"));
    return xmlResponse(
      `<?xml version="1.0"?><ns2:products xmlns:ns2="http://skt.tmall.business.openapi.spring.service.client.domain"></ns2:products>`,
    );
  };
  try {
    const result = await recoverElevenstCreateGetOnly({
      payload: { api_key: apiKey },
      credentialBinding,
      expectedProduct: { sellerPrdCd: sellerProductCode },
    });
    assert.equal(result.contract, "sellerpilot_elevenst_create_get_only_recovery_v2");
    assert.equal(result.outcome, "absent");
    assert.equal(result.productNo, null);
    assert.equal(result.fullOfficialReadback, false);
    assert.equal(result.providerMutationPerformed, false);
    assert.equal(result.providerReads.length, 1);
    assert.equal(result.providerReads[0]?.method, "GET");
    assert.match(result.providerReads[0]?.requestBytesSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(result.providerReads[0]?.responseBodySha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.deepEqual(methods, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st CREATE recovery classifies two seller-code matches as ambiguous and never follows or writes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: String(init?.method ?? "GET") });
    return xmlResponse(`<products>
      <product><prdNo>1234567890</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd></product>
      <product><prdNo>1234567891</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd></product>
    </products>`);
  };
  try {
    const result = await recoverElevenstCreateGetOnly({
      payload: { api_key: apiKey },
      credentialBinding,
      expectedProduct: { sellerPrdCd: sellerProductCode },
    });
    assert.equal(result.outcome, "ambiguous");
    assert.equal(result.providerMutationPerformed, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls.map((call) => call.method), ["GET"]);
    assert.match(calls[0]!.url, /sellerprodcode/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st CREATE recovery classifies non-official HTML lookup as unavailable without mutation", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(String(init?.method ?? "GET"));
    return xmlResponse("<html><body>gateway error</body></html>", "text/html");
  };
  try {
    const result = await recoverElevenstCreateGetOnly({
      payload: { api_key: apiKey },
      credentialBinding,
      expectedProduct: { sellerPrdCd: sellerProductCode },
    });
    assert.equal(result.outcome, "unavailable");
    assert.equal(result.providerMutationPerformed, false);
    assert.deepEqual(methods, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st CREATE recovery preserves a downstream GET timeout as unavailable and performs no mutation", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(String(init?.method ?? "GET"));
    if (methods.length === 1) {
      return xmlResponse(`<products><product><prdNo>1234567890</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd></product></products>`);
    }
    if (methods.length === 2) {
      return xmlResponse(`<Product><prdNo>1234567890</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd><selStatCd>103</selStatCd></Product>`);
    }
    throw new DOMException("timed out", "TimeoutError");
  };
  try {
    const result = await recoverElevenstCreateGetOnly({
      payload: { api_key: apiKey },
      credentialBinding,
      expectedProduct: { sellerPrdCd: sellerProductCode },
    });
    assert.equal(result.outcome, "unavailable");
    assert.equal(result.productNo, "1234567890");
    assert.equal(result.fullOfficialReadback, false);
    assert.equal(result.providerMutationPerformed, false);
    assert.deepEqual(methods, ["GET", "GET", "GET"]);
    assert.equal(result.providerReads.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st CREATE recovery unique path stays GET-only and binds raw request/response hashes", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    methods.push(String(init?.method ?? "GET"));
    const url = String(input);
    if (url.includes("sellerprodcode")) {
      return xmlResponse(`<products><product><prdNo>1234567890</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd></product></products>`);
    }
    if (url.endsWith("/stck/1234567890")) {
      return xmlResponse(`<ProductStocks><ProductStock><prdNo>1234567890</prdNo><prdStckNo>987654321</prdStckNo><stckQty>7</stckQty><prdStckStatCd>01</prdStckStatCd></ProductStock></ProductStocks>`);
    }
    return xmlResponse(`<Product><prdNo>1234567890</prdNo><sellerPrdCd>${sellerProductCode}</sellerPrdCd><selStatCd>103</selStatCd></Product>`);
  };
  try {
    const result = await recoverElevenstCreateGetOnly({
      payload: { api_key: apiKey },
      credentialBinding,
      expectedProduct: { sellerPrdCd: sellerProductCode, prdSelQty: "7" },
    });
    assert.equal(result.outcome, "unique");
    assert.equal(result.productNo, "1234567890");
    assert.equal(result.providerMutationPerformed, false);
    assert.equal(result.fullOfficialReadback, false);
    assert.equal(result.providerReads.length, 4);
    assert.deepEqual(result.providerReads.map((read) => read.kind), [
      "seller-product-code", "seller-product-identity", "product", "stock",
    ]);
    assert.ok(result.providerReads.every((read) => read.method === "GET"
      && read.responseBodyBytes > 0
      && /^[a-f0-9]{64}$/u.test(read.requestBytesSha256)
      && /^[a-f0-9]{64}$/u.test(read.responseBodySha256)));
    assert.deepEqual(methods, ["GET", "GET", "GET", "GET"]);
    assert.equal(methods.includes("POST"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
