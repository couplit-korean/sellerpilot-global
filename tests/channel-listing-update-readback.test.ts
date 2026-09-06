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
        ResultObject: { ItemTitle: "수정 상품", ItemDetail: Array.from({ length: 8 }, (_, index) => `<img src="${index + 1}">`).join("") },
      });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "test-key" },
      arguments: { params: { ItemCode: "1234567890", ItemTitle: "수정 상품", ItemDescription: Array.from({ length: 8 }, (_, index) => `<img src="${index + 1}">`).join("") } },
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

test("Smartstore listing 13671684696 update preserves category 50001578 and remote sale/display policy", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let transmittedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "naver-token", expires_in: 10_800 });
    if (url.includes("/v2/products/channel-products/")) return Response.json({
      originProductNo: 13671684696,
      smartstoreChannelProductNo: 20000001,
      smartstoreChannelProduct: {
        channelProductNo: 20000001,
        originProductNo: 13671684696,
        channelProductName: "수정 상품",
        channelProductDisplayStatusType: "SUSPENSION",
        naverShoppingRegistration: true,
      },
    });
    if (init?.method === "PUT") {
      transmittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({});
    }
    if (init?.method === "GET") return Response.json(transmittedBody ?? {
      originProductNo: 13671684696,
      smartstoreChannelProductNo: 20000001,
      originProduct: {
        leafCategoryId: "50001578",
        name: "수정 상품",
        salePrice: 77_770,
        stockQuantity: 9,
        deliveryInfo: { deliveryType: "DELIVERY" },
        detailAttribute: {
          unitCapacity: { unitPriceYn: true, totalCapacityValue: 315, unitCapacity: 10, indicationUnit: "g" },
          productInfoProvidedNotice: {
            productInfoProvidedNoticeType: "ETC",
            etc: { manufacturer: "기존 제조사", customerServicePhoneNumber: "010-0000-0000" },
          },
        },
      },
      smartstoreChannelProduct: {
        channelProductNo: 20000001,
        originProductNo: 13671684696,
        channelProductName: "수정 상품",
        channelProductDisplayStatusType: "SUSPENSION",
        naverShoppingRegistration: true,
      },
    });
    return Response.json({});
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.update",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: {
        originProductNo: "13671684696",
        body: {
          originProduct: { name: "수정 상품", salePrice: 1000, stockQuantity: 999 },
          smartstoreChannelProduct: { channelProductName: "수정 상품", channelProductDisplayStatusType: "ON" },
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "13671684696");
    assert.deepEqual(result.steps.map((step) => step.name), [
      "product-update-preflight",
      "channel-product-update-preflight",
      "product-update",
      "product-readback",
    ]);
    const productCalls = calls.filter((call) => call.url.includes("/v2/products/origin-products/13671684696"));
    assert.deepEqual(productCalls.map((call) => call.init?.method), ["GET", "PUT", "GET"]);
    assert.deepEqual(JSON.parse(String(productCalls[1].init?.body)), {
      originProduct: {
        leafCategoryId: "50001578",
        name: "수정 상품",
        salePrice: 77_770,
        stockQuantity: 9,
        deliveryInfo: { deliveryType: "DELIVERY" },
        detailAttribute: {
          unitCapacity: { unitPriceYn: true, totalCapacityValue: 315, unitCapacity: 10, indicationUnit: "g" },
          productInfoProvidedNotice: {
            productInfoProvidedNoticeType: "ETC",
            etc: { manufacturer: "기존 제조사", customerServicePhoneNumber: "010-0000-0000" },
          },
        },
      },
      smartstoreChannelProduct: {
        channelProductNo: 20000001,
        originProductNo: 13671684696,
        channelProductName: "수정 상품",
        channelProductDisplayStatusType: "SUSPENSION",
        naverShoppingRegistration: true,
      },
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
    if (url.includes("/channel-products/")) return Response.json({
      originProductNo: 1234567890,
      smartstoreChannelProductNo: 20000001,
      smartstoreChannelProduct: {
        channelProductNo: 20000001,
        originProductNo: 1234567890,
        channelProductName: "기존 상품",
        channelProductDisplayStatusType: "ON",
      },
    });
    if (url.includes("/origin-products/")) return Response.json({
      originProductNo: 1234567890,
      smartstoreChannelProductNo: 20000001,
      originProduct: { name: "기존 상품", salePrice: 77_770 },
      smartstoreChannelProduct: {
        channelProductNo: 20000001,
        originProductNo: 1234567890,
        channelProductName: "기존 상품",
        channelProductDisplayStatusType: "ON",
      },
    });
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
