import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";

test("Qoo10 listing update keeps the requested item ID and verifies all detail images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    calls.push({ method, body });
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({
        ResultCode: 0,
        ResultObject: { ItemTitle: "수정 상품", ItemDetail: '<img src="1"><img src="2"><img src="3"><img src="4">' },
      });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "test-key" },
      arguments: { params: { ItemCode: "1234567890", ItemTitle: "수정 상품", ItemDescription: '<img src="1"><img src="2"><img src="3"><img src="4">' } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.deepEqual(result.steps.map((step) => step.name), ["UpdateGoods", "EditGoodsContents", "detail-image-readback"]);
    assert.equal(calls[0].body.ItemCode, "1234567890");
    assert.equal(calls.at(-1)?.method, "ItemsLookup.GetItemDetailInfo");
    assert.equal(calls.some((call) => call.method === "ItemsBasic.EditGoodsStatus"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee listing update reads back the exact requested local item ID", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/v2/product/get_item_base_info")) {
      return Response.json({ error: "", response: { item_list: [{ item_id: 1234567890, item_name: "수정 상품" }] } });
    }
    return Response.json({ error: "", response: { request_id: "request-only-id" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "listing.update",
      payload: { partner_id: "123", partner_key: "secret", shop_id: "456", access_token: "token" },
      arguments: { localItemId: "1234567890", body: { item_id: 1234567890, item_name: "수정 상품", original_price: 999, seller_stock: [{ stock: 999 }], logistic_info: [{ logistic_id: 7, enabled: true }] } },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.deepEqual(result.steps.map((step) => step.name), ["local-item-preflight", "listing.update", "listing-readback"]);
    assert.equal(new URL(calls[0].url).pathname, "/api/v2/product/get_item_base_info");
    assert.equal(new URL(calls[1].url).pathname, "/api/v2/product/update_item");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { item_id: 1234567890, item_name: "수정 상품" });
    assert.equal(new URL(calls[2].url).searchParams.get("item_id_list"), "1234567890");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada listing update verifies the requested item identity after the XML write", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/product/item/get")) return Response.json({ code: "0", data: { item: { item_id: "1234567890", attributes: { name: "수정 상품" } } } });
    return Response.json({ code: "0", data: {} });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "listing.update",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: {
        itemId: "1234567890",
        request: { Request: { Product: { Attributes: { name: "수정 상품" } } } },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.deepEqual(result.steps.map((step) => step.name), ["/product/update", "listing-readback"]);
    assert.equal(new URL(calls[0].url).pathname, "/rest/product/update");
    assert.match(new URLSearchParams(String(calls[0].init?.body)).get("payload") ?? "", /<name>수정 상품<\/name>/);
    assert.equal(new URL(calls[1].url).searchParams.get("item_id"), "1234567890");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore listing update merges content into the remote product without replacing sale or display policy", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "naver-token", expires_in: 10_800 });
    if (init?.method === "GET") return Response.json({
      originProduct: { name: "수정 상품", salePrice: 77_770, stockQuantity: 9, deliveryInfo: { deliveryType: "DELIVERY" } },
      smartstoreChannelProduct: { channelProductName: "수정 상품", channelProductDisplayStatusType: "SUSPENSION" },
    });
    return Response.json({});
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.update",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: {
        originProductNo: "1234567890",
        body: {
          originProduct: { name: "수정 상품", salePrice: 1000, stockQuantity: 999 },
          smartstoreChannelProduct: { channelProductName: "수정 상품", channelProductDisplayStatusType: "ON" },
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.deepEqual(result.steps.map((step) => step.name), ["product-update-preflight", "product-update", "product-readback"]);
    const productCalls = calls.filter((call) => call.url.includes("/v2/products/origin-products/1234567890"));
    assert.deepEqual(productCalls.map((call) => call.init?.method), ["GET", "PUT", "GET"]);
    assert.deepEqual(JSON.parse(String(productCalls[1].init?.body)), {
      originProduct: { name: "수정 상품", salePrice: 77_770, stockQuantity: 9, deliveryInfo: { deliveryType: "DELIVERY" } },
      smartstoreChannelProduct: { channelProductName: "수정 상품", channelProductDisplayStatusType: "SUSPENSION" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee local update blocks a global-or-unknown ID before any write", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return Response.json({ error: "", response: { item_list: [] } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "listing.update",
      payload: { partner_id: "123", partner_key: "secret", shop_id: "456", access_token: "token" },
      arguments: { localItemId: "9999999999", body: { item_id: 9999999999, item_name: "수정 상품" } },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.steps.map((step) => step.name), ["local-item-preflight"]);
    assert.equal(result.steps[0].data.sellerpilotVerification, "SHOPEE_LOCAL_ITEM_ID_NOT_FOUND");
    assert.deepEqual(methods, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listing update fails when the provider accepts the write but readback keeps old mutable content", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "naver-token", expires_in: 10_800 });
    if (url.includes("/origin-products/")) return Response.json({ originProduct: { name: "기존 상품", salePrice: 77_770 } });
    return Response.json({});
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.update",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: { originProductNo: "1234567890", body: { originProduct: { name: "수정 상품" } } },
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "LISTING_MUTABLE_FIELDS_MISMATCH");
    assert.deepEqual(result.steps.at(-1)?.data.sellerpilotMismatchPaths, ["originProduct.name"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
