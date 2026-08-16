import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { compareSync as bcryptCompareSync } from "bcryptjs";
import { activeChannelKeys, channelCatalog } from "../lib/channels/catalog";
import {
  buildCoupangAuthorization,
  buildEbayConsentUrl,
  buildQoo10Url,
  createNaverClientSecretSign,
  ensureEbayAccessToken,
} from "../lib/channels/protocols";
import { executeChannelOperation } from "../lib/channels/operations";

test("Coupang CEA authorization signs the documented canonical value", () => {
  const now = new Date("2026-08-16T03:04:05.000Z");
  const path = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
  const query = "vendorId=A00012345&maxPerPage=1";
  const expectedSignature = createHmac("sha256", "test-secret")
    .update(`260816T030405ZGET${path}${query}`)
    .digest("hex");
  assert.equal(
    buildCoupangAuthorization({ method: "GET", path, query, accessKey: "test-access", secretKey: "test-secret", now }),
    `CEA algorithm=HmacSHA256, access-key=test-access, signed-date=260816T030405Z, signature=${expectedSignature}`,
  );
});

test("Naver client secret signature is a bcrypt hash wrapped in Base64", () => {
  const clientId = "test-client";
  const timestamp = 1_786_848_245_000;
  const bcryptSalt = "$2b$10$abcdefghijklmnopqrstuu";
  const encoded = createNaverClientSecretSign(clientId, bcryptSalt, timestamp);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  assert.equal(bcryptCompareSync(`${clientId}_${timestamp}`, decoded), true);
});

test("Qoo10 uses current QAPI endpoint and qualified method name", () => {
  const url = buildQoo10Url({
    apiKey: "hidden-key",
    service: "ItemsLookup",
    method: "GetItemDetailInfo",
    version: "1.2",
    params: { ItemCode: "1234567890", SellerCode: "" },
  });
  assert.equal(url.pathname, "/GMKT.INC.Front.QAPIService/ebayjapan.qapi");
  assert.equal(url.searchParams.get("method"), "ItemsLookup.GetItemDetailInfo");
  assert.equal(url.searchParams.get("v"), "1.2");
});

test("eBay consent URL separates sandbox and production and includes CSRF state", () => {
  const url = buildEbayConsentUrl({
    environment: "sandbox",
    clientId: "test-client",
    ruName: "test-runame",
    state: "sellerpilot-ebay-test-state",
  });
  assert.equal(url.origin, "https://auth.sandbox.ebay.com");
  assert.equal(url.searchParams.get("redirect_uri"), "test-runame");
  assert.equal(url.searchParams.get("state"), "sellerpilot-ebay-test-state");
  assert.match(url.searchParams.get("scope") ?? "", /sell\.inventory/);
});

test("all six active channels define every normalized capability", () => {
  assert.deepEqual(activeChannelKeys, ["qoo10", "lazada", "coupang", "elevenst", "smartstore", "ebay"]);
  const expectedCapabilities = Object.keys(channelCatalog.qoo10.capabilities).sort();
  for (const channel of activeChannelKeys) {
    assert.deepEqual(Object.keys(channelCatalog[channel].capabilities).sort(), expectedCapabilities);
    assert.ok(channelCatalog[channel].officialDocs.length > 0);
  }
  assert.equal(channelCatalog.elevenst.capabilities.listingCreate.mode, "vendor_docs_required");
  assert.equal(channelCatalog.qoo10.capabilities.webhooks.mode, "unsupported");
});

test("Coupang operation routing uses the documented item price endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ code: "SUCCESS", message: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "price.update",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: { vendorItemId: "3572784698", price: 49_000, forceSalePriceUpdate: false },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calls[0].url, /vendor-items\/3572784698\/prices\/49000\?forceSalePriceUpdate=false$/);
    assert.match(String(new Headers(calls[0].init?.headers).get("authorization")), /^CEA algorithm=HmacSHA256/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver order detail routing exchanges a token and uses the official batch query", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ traceId: "trace", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "orders.get",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELF" },
      arguments: { productOrderId: "2022040521691281" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(calls[1].url, "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/query");
    assert.equal(calls[1].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      productOrderIds: ["2022040521691281"],
      quantityClaimCompatibility: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay listing workflow creates inventory, creates an offer, then publishes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/offer")) return new Response(JSON.stringify({ offerId: "36445435465" }), { status: 201, headers: { "content-type": "application/json" } });
    if (url.endsWith("/publish")) return new Response(JSON.stringify({ listingId: "110000000001" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        sku: "SELLERPILOT-001",
        inventoryItem: { availability: { shipToLocationAvailability: { quantity: 1 } }, condition: "NEW", product: { title: "Test" } },
        offer: { sku: "SELLERPILOT-001", marketplaceId: "EBAY_US", format: "FIXED_PRICE" },
        publish: true,
      },
      environment: "sandbox",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "110000000001");
    assert.deepEqual(calls.map((url) => new URL(url).pathname), [
      "/sell/inventory/v1/inventory_item/SELLERPILOT-001",
      "/sell/inventory/v1/offer",
      "/sell/inventory/v1/offer/36445435465/publish",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st writes stay blocked until the authenticated seller specification is fixed", async () => {
  await assert.rejects(
    executeChannelOperation({
      channel: "elevenst",
      operation: "listing.create",
      payload: { api_key: "key", seller_id: "seller" },
      arguments: { body: {} },
      environment: "production",
    }),
    /CHANNEL_VENDOR_SPEC_REQUIRED/,
  );
});

test("eBay does not invent a domestic-style order acknowledgement step", async () => {
  await assert.rejects(
    executeChannelOperation({
      channel: "ebay",
      operation: "shipment.acknowledge",
      payload: { access_token: "token" },
      arguments: {},
      environment: "sandbox",
    }),
    /CHANNEL_OPERATION_UNSUPPORTED/,
  );
});

test("eBay refreshes an expired two-hour access token before a live operation", async () => {
  const originalFetch = globalThis.fetch;
  let tokenBody = "";
  globalThis.fetch = async (_input, init) => {
    tokenBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "fresh-access-token", expires_in: 7200 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const ensured = await ensureEbayAccessToken({
      client_id: "client",
      client_secret: "secret",
      ru_name: "runame",
      access_token: "expired-access-token",
      access_token_expires_at: "2000-01-01T00:00:00.000Z",
      refresh_token: "refresh-token",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    }, "sandbox");
    assert.equal(ensured.refreshed, true);
    assert.equal(ensured.payload.access_token, "fresh-access-token");
    assert.match(tokenBody, /grant_type=refresh_token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
