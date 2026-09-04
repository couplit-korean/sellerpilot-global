import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  elevenstCookieSellerProductCode,
  readElevenstSellerProdcode,
} from "../lib/channels/elevenst-sellerprodcode-read";
import {
  elevenstSellerXmlRequest,
  runWithProviderReadOnlyTransport,
} from "../lib/channels/protocols";

const apiKey = "A".repeat(32);
const cookieSku = "AUTO-780720401E2D4E4EA45F";
const emptyProductsXml =
  `<?xml version="1.0" encoding="UTF-8"?><ns2:products xmlns:ns2="http://skt.tmall.business.openapi.spring.service.client.domain"></ns2:products>`;

function xmlResponse(body: string, status = 200, contentType = "text/xml; charset=utf-8") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

test("11st GET-only script decrypts vault in-process and never prints the key", async () => {
  const source = await readFile(
    new URL("../scripts/elevenst-sellerprodcode-get-only.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /sellerpilot_decrypt_credential/);
  assert.match(source, /readElevenstSellerProdcode/);
  assert.doesNotMatch(source, /from ["'].*live-channel-operation|executeChannelOperation|prodservices\/product/);
  assert.doesNotMatch(source, /console\.log\([^\n]*api_key/);
  assert.doesNotMatch(source, /api\.11st\.co\.kr[\s\S]{0,80}method:\s*"POST"/);
});

test("11st sellerprodcode read source is GET-only and cannot claim other channels", async () => {
  const source = await readFile(
    new URL("../lib/channels/elevenst-sellerprodcode-read.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /runWithProviderReadOnlyTransport/);
  assert.match(source, /method: "GET"/);
  assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /prodservices\/product|listing\.create|executeChannelOperation/);
  assert.doesNotMatch(source, /claim_channel_gateway|gateway:worker|live-channel-operation/);
  assert.doesNotMatch(source, /shopeeRequest|qoo10Request|coupangRequest|ebayRequest/);
});

test("11st cookie SKU constant matches the launch SKU", () => {
  assert.equal(elevenstCookieSellerProductCode, cookieSku);
});

test("11st sellerprodcode GET treats official namespaced empty products as absent without prodmarket or POST", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: String(init?.method ?? "GET") });
    assert.match(String(input), /\/rest\/prodmarketservice\/sellerprodcode\/AUTO-780720401E2D4E4EA45F$/);
    return xmlResponse(emptyProductsXml);
  };
  try {
    const result = await readElevenstSellerProdcode({
      payload: { api_key: apiKey },
      sellerProductCode: cookieSku,
    });
    assert.equal(result.outcome, "absent");
    assert.equal(result.absentReason, "official_namespaced_empty_products");
    assert.equal(result.lookupHttpStatus, 200);
    assert.equal(result.lookupResultCode, "NONE");
    assert.equal(result.lookupRoot, "NS2_PRODUCTS");
    assert.equal(result.lookupBodyBytes, Buffer.byteLength(emptyProductsXml));
    assert.equal(result.productNo, null);
    assert.equal(result.prodmarket, null);
    assert.deepEqual(calls.map((call) => call.method), ["GET"]);
    assert.equal(calls.some((call) => call.url.includes("/prodservices/product")), false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st sellerprodcode GET does not treat HTML or empty 200 as absence", async () => {
  const originalFetch = globalThis.fetch;
  for (const body of ["<html><body>error</body></html>", ""]) {
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(String(init?.method ?? "GET"));
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    };
    try {
      const result = await readElevenstSellerProdcode({
        payload: { api_key: apiKey },
        sellerProductCode: cookieSku,
      });
      assert.equal(result.outcome, "unverified");
      assert.match(String(result.unverifiedReason), /ELEVENST_IDEMPOTENCY_LOOKUP_UNVERIFIED:HTTP_200:/);
      assert.equal(result.productNo, null);
      assert.deepEqual(calls, ["GET"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("11st sellerprodcode GET 404 is absent and never follows with prodmarket", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return xmlResponse("<ClientMessage><resultCode>404</resultCode></ClientMessage>", 404);
  };
  try {
    const result = await readElevenstSellerProdcode({
      payload: { api_key: apiKey },
      sellerProductCode: cookieSku,
    });
    assert.equal(result.outcome, "absent");
    assert.equal(result.absentReason, "http_404");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^GET /);
    assert.doesNotMatch(calls[0], /prodmarket\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st sellerprodcode GET follows observed prdNo with one prodmarket GET and no POST", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET") };
    calls.push(call);
    if (call.url.includes("/sellerprodcode/")) {
      return xmlResponse("<Product><prdNo>1234567890</prdNo><sellerPrdCd>AUTO-780720401E2D4E4EA45F</sellerPrdCd></Product>");
    }
    if (call.url.endsWith("/prodmarket/1234567890")) {
      return xmlResponse("<Product><prdNo>1234567890</prdNo><sellerPrdCd>AUTO-780720401E2D4E4EA45F</sellerPrdCd></Product>");
    }
    throw new Error(`unexpected URL ${call.url}`);
  };
  try {
    const result = await readElevenstSellerProdcode({
      payload: { api_key: apiKey },
      sellerProductCode: cookieSku,
    });
    assert.equal(result.outcome, "present");
    assert.equal(result.productNo, "1234567890");
    assert.equal(result.prodmarket?.sellerProductCodeMatched, true);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
    assert.match(calls[0].url, /sellerprodcode\/AUTO-780720401E2D4E4EA45F$/);
    assert.match(calls[1].url, /prodmarket\/1234567890$/);
    assert.equal(calls.some((call) => /POST|PUT|PATCH|DELETE/i.test(call.method)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st sellerprodcode read rejects path-injection SKUs before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("fetch must not run");
  };
  try {
    await assert.rejects(
      () => readElevenstSellerProdcode({
        payload: { api_key: apiKey },
        sellerProductCode: "../prodservices/product",
      }),
      /ELEVENST_SELLER_PRODUCT_CODE_INVALID/,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st read-only transport blocks POST even if a caller tries seller XML write", async () => {
  await assert.rejects(
    () => runWithProviderReadOnlyTransport(() => elevenstSellerXmlRequest({
      payload: { api_key: apiKey },
      method: "POST",
      path: "/rest/prodservices/product",
      body: "<Product/>",
    })),
    /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/,
  );
});
