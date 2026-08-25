import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { listingLedgerRemoteIdentity } from "../lib/channels/write-resource";

test("eBay inventory is bound to its persisted marketplace SKU, not the public listing ID", () => {
  const listing = { remoteId: "PUBLIC-LISTING-123", marketplaceSku: "EBAY-SKU" };
  assert.equal(listingLedgerRemoteIdentity("ebay", "inventory.update", listing), "EBAY-SKU");
  assert.equal(listingLedgerRemoteIdentity("ebay", "listing.stop", listing), "PUBLIC-LISTING-123");
  assert.equal(listingLedgerRemoteIdentity("qoo10", "inventory.update", listing), "PUBLIC-LISTING-123");
});

test("Qoo10 inventory succeeds only after quantity readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let normalizedWriteQuantity = "";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const method = url.searchParams.get("method") ?? "";
    methods.push(method);
    if (method.endsWith("SetGoodsPriceQty")) normalizedWriteQuantity = url.searchParams.get("Qty") ?? "";
    return method.endsWith("GetItemDetailInfo")
      ? Response.json({ ResultCode: 0, ResultObject: { ItemQty: "17" } })
      : Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10", operation: "inventory.update", environment: "production",
      payload: { api_key: "test" },
      arguments: { quantity: 17, params: { ItemCode: "123456789", SellerCode: "SKU", ItemPrice: "2500", ItemQty: "17" } },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(methods, ["ItemsOrder.SetGoodsPriceQty", "ItemsLookup.GetItemDetailInfo"]);
    assert.equal(normalizedWriteQuantity, "17");
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "INVENTORY_QUANTITY_VERIFIED");
  } finally { globalThis.fetch = originalFetch; }
});

test("Qoo10 inventory accepts quantity nested in the provider result object", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const method = new URL(String(input)).searchParams.get("method") ?? "";
    return method.endsWith("GetItemDetailInfo")
      ? Response.json({ ResultCode: 0, ResultObject: { Goods: { StockQty: "17" } } })
      : Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10", operation: "inventory.update", environment: "production",
      payload: { api_key: "test" },
      arguments: { quantity: 17, params: { ItemCode: "123456789" } },
    });
    assert.equal(result.ok, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("Qoo10 inventory accepts the provider list response shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const method = new URL(String(input)).searchParams.get("method") ?? "";
    return method.endsWith("GetItemDetailInfo")
      ? Response.json({ ResultCode: 0, ResultObject: [{ ItemCode: "123456789", ItemQty: "17" }] })
      : Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10", operation: "inventory.update", environment: "production",
      payload: { api_key: "test" },
      arguments: { quantity: 17, params: { ItemCode: "123456789" } },
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps.at(-1)?.data.actualQuantity, 17);
  } finally { globalThis.fetch = originalFetch; }
});

test("Qoo10 inventory retries an eventually consistent quantity readback", async () => {
  const originalFetch = globalThis.fetch;
  let readbackCount = 0;
  globalThis.fetch = async (input) => {
    const method = new URL(String(input)).searchParams.get("method") ?? "";
    if (!method.endsWith("GetItemDetailInfo")) return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
    readbackCount += 1;
    return Response.json({ ResultCode: 0, ResultMsg: "Success", ResultObject: { ItemQty: readbackCount < 2 ? "9999" : "17" } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10", operation: "inventory.update", environment: "production",
      payload: { api_key: "test" },
      arguments: { quantity: 17, params: { ItemCode: "123456789" } },
    });
    assert.equal(result.ok, true);
    assert.equal(readbackCount, 2);
    assert.equal(result.steps.at(-1)?.data.actualQuantity, 17);
  } finally { globalThis.fetch = originalFetch; }
});

test("Shopee inventory writes stock then verifies item base info", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    return url.pathname.endsWith("update_stock")
      ? Response.json({ response: { request_id: "req-1" }, error: "" })
      : Response.json({ response: { item_list: [{ item_id: 123456789, stock_info_v2: { summary_info: { total_available_stock: 17 } } }] }, error: "" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee", operation: "inventory.update", environment: "production",
      payload: { partner_id: "1001", partner_key: "secret", access_token: "token", shop_id: "70001" },
      arguments: { body: { item_id: 123456789, stock_list: [{ seller_stock: [{ stock: 17 }] }] } },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.at(-1)?.endsWith("get_item_base_info"), true);
  } finally { globalThis.fetch = originalFetch; }
});

test("Lazada inventory verifies the item quantity after price-quantity update", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    return url.pathname.endsWith("price_quantity/update")
      ? Response.json({ code: "0", data: {} })
      : Response.json({ code: "0", data: { skus: [{ SkuId: "987654321", SellerSku: "MY-SKU", quantity: "17" }] } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada", operation: "inventory.update", environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token", country: "my" },
      arguments: { itemId: "123456789", quantity: 17, queryParams: {} },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["/rest/product/item/get", "/rest/product/price_quantity/update", "/rest/product/item/get"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("Coupang resolves the vendor item and verifies its quantity", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    methods.push(`${init?.method}:${url.pathname}`);
    if (url.pathname.includes("seller-products")) return Response.json({ code: "SUCCESS", data: { sellerProductId: 123456789, items: [{ vendorItemId: 998877 }] } });
    if (init?.method === "PUT") return Response.json({ code: "SUCCESS", data: {} });
    return Response.json({ code: "SUCCESS", data: { vendorItemId: 998877, amountInStock: 17 } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang", operation: "inventory.update", environment: "production",
      payload: { access_key: "access", secret_key: "secret", vendor_id: "A0001" },
      arguments: { sellerProductId: "123456789", quantity: 17 },
    });
    assert.equal(result.ok, true);
    assert.equal(methods.some((value) => value.includes("vendor-items/998877/quantities/17")), true);
    assert.equal(methods.some((value) => value.includes("vendor-items/998877/inventories")), true);
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "INVENTORY_QUANTITY_VERIFIED");
  } finally { globalThis.fetch = originalFetch; }
});

test("Smartstore full-product stock update is read back before success", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method}:${url.pathname}`);
    if (url.pathname.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 10_800 });
    if (init?.method === "PUT") return Response.json({});
    return Response.json({ originProduct: { name: "상품", images: { representativeImage: { url: "https://example.com/item.jpg" } }, stockQuantity: 17 }, smartstoreChannelProduct: {} });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore", operation: "inventory.update", environment: "production",
      payload: { client_id: "client", client_secret: "$2b$10$abcdefghijklmnopqrstuu", token_type: "SELF" },
      arguments: { originProductNo: "123456789", mode: "origin-product", quantity: 17 },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.some((value) => value === "GET:/external/v2/products/origin-products/123456789"), true);
  } finally { globalThis.fetch = originalFetch; }
});

test("Temu inventory verifies quantity through goods detail", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    return call === 1
      ? Response.json({ success: true, result: { goodsId: 123456789 } })
      : Response.json({ success: true, result: { goodsId: 123456789, skuList: [{ externalSkuId: "TEMU-SKU", quantity: 17 }] } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu", operation: "inventory.update", environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: { goodsId: 123456789, quantity: 17, body: { goodsId: 123456789, skuList: [{ externalSkuId: "TEMU-SKU", quantity: 17 }] } },
    });
    assert.equal(result.ok, true);
    assert.equal(call, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("Temu inventory uses the official goods-detail method before and after stock edit", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return body.type === "bg.local.goods.stock.edit"
      ? Response.json({ success: true, result: { goodsId: 123456789 } })
      : Response.json({ success: true, result: { goodsId: 123456789, skuList: [{ skuId: 9001, stockQuantity: 17 }] } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu", operation: "inventory.update", environment: "production",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: { goodsId: 123456789, quantity: 17 },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.local.goods.detail.query",
      "bg.local.goods.stock.edit",
      "bg.local.goods.detail.query",
    ]);
    assert.deepEqual(calls[1].skuStockList, [{ skuId: 9001, stockQuantity: 17 }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("eBay uses safe bulk quantity update instead of overwriting the inventory item", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method?: string; path: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method, path: url.pathname, body: String(init?.body ?? "") });
    return init?.method === "POST"
      ? Response.json({ responses: [{ sku: "EBAY-SKU", statusCode: 204 }] })
      : Response.json({ sku: "EBAY-SKU", availability: { shipToLocationAvailability: { quantity: 17 } } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay", operation: "inventory.update", environment: "production",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: { sku: "EBAY-SKU", quantity: 17 },
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0]?.path.endsWith("/bulk_update_price_quantity"), true);
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]?.body ?? "", /shipToLocationAvailability/);
    assert.equal(calls[1]?.method, "GET");
  } finally { globalThis.fetch = originalFetch; }
});
