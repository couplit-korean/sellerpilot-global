import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { compareSync as bcryptCompareSync } from "bcryptjs";
import { activeChannelKeys, channelCatalog } from "../lib/channels/catalog";
import {
  buildCoupangAuthorization,
  buildEbayConsentUrl,
  buildQoo10Url,
  buildShopeeAuthorizationUrl,
  buildShopeeSignature,
  createNaverClientSecretSign,
  ensureEbayAccessToken,
  ensureShopeeAccessToken,
  ensureShopeeMerchantAccessToken,
  exchangeShopeeOAuthToken,
  fetchNaverAccessToken,
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

test("Naver seller data token requires SELLER type and account_id", async () => {
  await assert.rejects(
    fetchNaverAccessToken({
      client_id: "client",
      client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
      token_type: "SELF",
    }),
    /NAVER_CREDENTIALS_MISSING/,
  );
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

test("Qoo10 product creation uses SetNewGoods v1.1 and records GdNo", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ ResultCode: 0, ResultMsg: "SUCCESS", ResultObject: { GdNo: "1234567890" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
      arguments: { params: { SecondSubCat: "320002604", ItemTitle: "Test", StandardImage: "https://example.test/item.jpg", ItemDescription: "<p>Test</p>", RetailPrice: "0", ItemPrice: "2500", ItemQty: "1", ExpireDate: "2027-12-31", ShippingNo: "0", AvailableDateType: "0", AvailableDateValue: "3", AudultYN: "N" } },
      environment: "production",
    });
    const url = new URL(calledUrl);
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.equal(url.searchParams.get("method"), "ItemsBasic.SetNewGoods");
    assert.equal(url.searchParams.get("v"), "1.1");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("Shopee authorization URL uses the current auth endpoint and preserves SellerPilot CSRF state", () => {
  const timestamp = 1_786_848_245;
  const path = "/api/v2/shop/auth_partner";
  const expected = createHmac("sha256", "partner-secret").update(`2031489${path}${timestamp}`).digest("hex");
  assert.equal(buildShopeeSignature({ partnerId: "2031489", partnerKey: "partner-secret", path, timestamp }), expected);
  const url = buildShopeeAuthorizationUrl({
    environment: "production",
    partnerId: "2031489",
    redirectUri: "https://sellerpilot-global.vercel.app/",
    state: "sellerpilot-shopee-test-state",
  });
  assert.equal(url.origin, "https://open.shopee.com");
  assert.equal(url.pathname, "/auth");
  assert.equal(url.searchParams.get("auth_type"), "seller");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://sellerpilot-global.vercel.app/");
  assert.equal(url.searchParams.get("state"), "sellerpilot-shopee-test-state");
});

test("all seven active channels define every normalized capability", () => {
  assert.deepEqual(activeChannelKeys, ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay"]);
  const expectedCapabilities = Object.keys(channelCatalog.qoo10.capabilities).sort();
  for (const channel of activeChannelKeys) {
    assert.deepEqual(Object.keys(channelCatalog[channel].capabilities).sort(), expectedCapabilities);
    assert.ok(channelCatalog[channel].officialDocs.length > 0);
  }
  assert.equal(channelCatalog.elevenst.capabilities.listingCreate.mode, "vendor_docs_required");
  assert.equal(channelCatalog.qoo10.capabilities.webhooks.mode, "unsupported");
});

test("Shopee operation routing signs the shop request and uses v2 order detail", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ error: "", request_id: "request", response: { order_list: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "orders.get",
      payload: { partner_id: "2031489", partner_key: "partner-secret", shop_id: "123456", access_token: "access-token" },
      arguments: { orderSn: "260816ABC123" },
      environment: "production",
    });
    const url = new URL(calledUrl);
    assert.equal(result.ok, true);
    assert.equal(url.pathname, "/api/v2/order/get_order_detail");
    assert.equal(url.searchParams.get("order_sn_list"), "260816ABC123");
    assert.equal(url.searchParams.get("shop_id"), "123456");
    assert.match(url.searchParams.get("sign") ?? "", /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee main-account code exchange uses main_account_id and returns the authorized shop lists", async () => {
  const originalFetch = globalThis.fetch;
  let calledBody = "";
  globalThis.fetch = async (_input, init) => {
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      error: "",
      access_token: "main-access",
      refresh_token: "main-refresh",
      shop_id_list: [1001, 1002],
      merchant_id_list: [2001],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await exchangeShopeeOAuthToken({
      environment: "production",
      partnerId: "2031489",
      partnerKey: "partner-secret",
      code: "one-time-code",
      mainAccountId: "3001",
    });
    assert.equal(result.response.ok, true);
    assert.deepEqual(JSON.parse(calledBody), { code: "one-time-code", main_account_id: 3001, partner_id: 2031489 });
    assert.deepEqual(result.data.shop_id_list, [1001, 1002]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee operation token selection projects the requested authorized shop without exposing another shop token", async () => {
  const payload = {
    partner_id: "2031489",
    partner_key: "partner-secret",
    shop_id: "1001",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [
      { type: "shop", id: "1001", access_token: "shop-one-access", refresh_token: "shop-one-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
      { type: "shop", id: "1002", access_token: "shop-two-access", refresh_token: "shop-two-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
    ],
  };
  const selected = await ensureShopeeAccessToken(payload, "production", 10 * 60 * 1000, "1002");
  assert.equal(selected.refreshed, false);
  assert.equal(selected.payload.shop_id, "1002");
  assert.equal(selected.payload.access_token, "shop-two-access");
  assert.equal(selected.payload.refresh_token, "shop-two-refresh");
  await assert.rejects(ensureShopeeAccessToken(payload, "production", 10 * 60 * 1000, "9999"), /SHOPEE_SHOP_NOT_AUTHORIZED/);
});

test("Shopee merchant token and GlobalProduct category request use the merchant signature dimension", async () => {
  const payload = {
    partner_id: "2031489",
    partner_key: "partner-secret",
    merchant_id: "2001",
    authorization_expires_at: "2099-01-01T00:00:00.000Z",
    shopee_targets: [
      { type: "merchant", id: "2001", access_token: "merchant-access", refresh_token: "merchant-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
      { type: "shop", id: "1001", access_token: "shop-access", refresh_token: "shop-refresh", access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-01-01T00:00:00.000Z" },
    ],
  };
  const selected = await ensureShopeeMerchantAccessToken(payload, "production", 10 * 60 * 1000, "2001");
  assert.equal(selected.payload.merchant_id, "2001");
  assert.equal(selected.payload.access_token, "merchant-access");

  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ error: "", request_id: "request", response: { category_list: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "categories.list",
      payload: selected.payload,
      arguments: { globalProduct: true, query: { language: "en" } },
      environment: "production",
    });
    const url = new URL(calledUrl);
    assert.equal(result.ok, true);
    assert.equal(url.pathname, "/api/v2/global_product/get_category");
    assert.equal(url.searchParams.get("merchant_id"), "2001");
    assert.equal(url.searchParams.get("shop_id"), null);
    assert.equal(url.searchParams.get("access_token"), "merchant-access");
    assert.match(url.searchParams.get("sign") ?? "", /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada product create serializes the structured request as official XML and reads the item back", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    const creating = String(input).includes("/product/create");
    return new Response(JSON.stringify(creating
      ? { code: "0", request_id: "create-request", data: { item_id: 987654321 } }
      : { code: "0", request_id: "read-request", data: { item_id: 987654321, primary_category: 12345 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.create",
      payload: { app_key: "app-key", app_secret: "app-secret", access_token: "access-token", country: "my" },
      arguments: {
        request: {
          Request: {
            Product: {
              PrimaryCategory: "12345",
              Attributes: { name: "White cup", description: "Cup & mug" },
              Skus: { Sku: [{ SellerSku: "CUP-001", price: "12.90", quantity: "1", Status: "inactive" }] },
            },
          },
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "987654321");
    assert.equal(calls.length, 2);
    const form = new URLSearchParams(calls[0].body);
    const xml = form.get("payload") ?? "";
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<Request><Product><PrimaryCategory>12345<\/PrimaryCategory>/);
    assert.match(xml, /<description>Cup &amp; mug<\/description>/);
    assert.match(xml, /<Skus><Sku><SellerSku>CUP-001<\/SellerSku>/);
    assert.match(calls[1].url, /\/product\/item\/get/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("Coupang category recommendation sends the official product context payload", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ code: 200, data: { autoCategorizationPredictionResultType: "SUCCESS", predictedCategoryId: "63955", predictedCategoryName: "분말형" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "categories.suggest",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: { query: "유한젠 가루세제 1kg", body: { productDescription: "분말형 살균 표백제", brand: "유한양행" } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(new URL(calledUrl).pathname, "/v2/providers/openapi/apis/api/v1/categorization/predict");
    assert.deepEqual(JSON.parse(calledBody), { productDescription: "분말형 살균 표백제", brand: "유한양행", productName: "유한젠 가루세제 1kg" });
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
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { productOrderId: "2022040521691281" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    const tokenBody = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(tokenBody.get("type"), "SELLER");
    assert.equal(tokenBody.get("account_id"), "seller-uid");
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

test("Naver seller request refreshes once after GW.AUTHN", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let tokenCount = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/oauth2/token")) {
      tokenCount += 1;
      return new Response(JSON.stringify({ access_token: `naver-token-${tokenCount}`, expires_in: 10_800 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (calls.filter((item) => item.includes("/v1/categories/")).length === 1) {
      return new Response(JSON.stringify({ code: "GW.AUTHN", message: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "50000000", name: "패션의류" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "categories.list",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { categoryId: "50000000" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(tokenCount, 2);
    assert.equal(calls.filter((item) => item.includes("/v1/categories/50000000")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Naver category preflight loads the category, attributes, values, and standard options", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "naver-token", expires_in: 10_800 }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/v1/categories/50000805")) return new Response(JSON.stringify({ id: "50000805", name: "건강기능식품", last: true }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "categories.attributes",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { categoryId: "50000805" },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 4);
    assert.equal(calls.some((url) => url.includes("/v1/product-attributes/attributes?categoryId=50000805")), true);
    assert.equal(calls.some((url) => url.includes("/v1/product-attributes/attribute-values?categoryId=50000805")), true);
    assert.equal(calls.some((url) => url.includes("/v1/options/standard-options?categoryId=50000805")), true);
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

test("Shopee refresh rotates both the four-hour access token and thirty-day refresh token", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "fresh-access", refresh_token: "fresh-refresh", expire_in: 14_400 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const ensured = await ensureShopeeAccessToken({
      partner_id: "2031489",
      partner_key: "partner-secret",
      shop_id: "123456",
      access_token: "expired-access",
      access_token_expires_at: "2000-01-01T00:00:00.000Z",
      refresh_token: "refresh-token",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      authorization_expires_at: "2099-01-01T00:00:00.000Z",
    }, "production");
    assert.equal(ensured.refreshed, true);
    assert.equal(ensured.payload.access_token, "fresh-access");
    assert.equal(ensured.payload.refresh_token, "fresh-refresh");
    assert.equal(new URL(calledUrl).pathname, "/api/v2/auth/access_token/get");
    assert.deepEqual(JSON.parse(calledBody), { refresh_token: "refresh-token", shop_id: 123456, partner_id: 2031489 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
