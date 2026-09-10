import assert from "node:assert/strict";
import test from "node:test";
import { executeShopee } from "../lib/product-registration/channels/shopee";

const credential = {
  partner_id: "1001",
  partner_key: "test-only",
  merchant_id: "2001",
  access_token: "test-only",
};

function input(argumentsValue: Record<string, unknown>) {
  return {
    channel: "shopee" as const,
    operation: "listing.create" as const,
    payload: credential,
    arguments: argumentsValue,
    environment: "production" as const,
  };
}

test("Shopee does not publish when add_global_item readback returns a different global identity", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (request) => {
    const url = String(request);
    calls.push(url);
    if (url.includes("/add_global_item")) {
      return Response.json({ error: "", response: { global_item_id: 7001 } });
    }
    if (url.includes("/get_global_item_info")) {
      return Response.json({ error: "", response: { global_item_list: [{ global_item_id: 7002, global_item_sku: "SKU-OTHER" }] } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const result = await executeShopee(input({
      globalProduct: true,
      body: { global_item_sku: "SKU-GLOBAL", condition: "NEW", seller_stock: [{ stock: 3 }] },
      publish: { shop_id: 8001, item: { item_sku: "SKU-SG" } },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "7001");
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "SHOPEE_GLOBAL_ITEM_IDENTITY_UNVERIFIED");
    assert.equal(calls.some((url) => url.includes("/create_publish_task")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee recovery requires exactly one global-to-local link for the selected shop", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("/get_global_item_info")) {
      return Response.json({ error: "", response: { global_item_list: [{ global_item_id: 7001, global_item_sku: "SKU-GLOBAL" }] } });
    }
    if (url.includes("/get_published_list")) {
      return Response.json({ error: "", response: { published_item: [
        { shop_id: 8001, item_id: 9001 },
        { shop_id: 8001, item_id: 9002 },
      ] } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const result = await executeShopee(input({
      globalProduct: true,
      globalItemId: "7001",
      recoverPublished: true,
      body: { global_item_sku: "SKU-GLOBAL" },
      publish: { shop_id: 8001, item: { item_sku: "SKU-SG" } },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "7001");
    assert.equal(result.steps.at(-1)?.data.sellerpilotVerification, "SHOPEE_EXACT_SHOP_LINKAGE_UNVERIFIED");
    assert.equal(result.steps.at(-1)?.data.exactMatchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee recovery returns the local item id only after exact selected-shop linkage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("/get_global_item_info")) {
      return Response.json({ error: "", response: { global_item_list: [{ global_item_id: 7001, global_item_sku: "SKU-GLOBAL" }] } });
    }
    if (url.includes("/get_published_list")) {
      return Response.json({ error: "", response: { published_item: [
        { shop_id: 8002, item_id: 9002 },
        { shop_id: 8001, item_id: 9001 },
      ] } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const result = await executeShopee(input({
      globalProduct: true,
      globalItemId: "7001",
      recoverPublished: true,
      body: { global_item_sku: "SKU-GLOBAL" },
      publish: { shop_id: 8001, item: { item_sku: "SKU-SG" } },
    }));
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "9001");
    assert.equal(result.steps.some((item) => item.name === "global-item-readback"), true);
    assert.equal(result.steps.some((item) => item.name === "published-item-readback"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
