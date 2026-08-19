import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryUpdateArguments } from "../lib/channels/inventory-sync";
import type { ActiveChannelKey } from "../lib/channels/catalog";

const base = {
  remoteId: "123456789",
  quantity: 17,
  productSku: "SP-SKU-1",
  market: "MY",
  targetId: "70001",
};

function build(channel: ActiveChannelKey, draft: Record<string, unknown>) {
  return buildInventoryUpdateArguments({ ...base, channel, draft });
}

test("inventory sync builds provider-native arguments for all seven channels", () => {
  assert.deepEqual(build("qoo10", { params: { SellerCode: "SELLER-1", ItemPrice: "2500" } }), {
    quantity: 17,
    params: { ItemCode: "123456789", SellerCode: "SELLER-1", ItemPrice: "2500", ItemQty: "17" },
  });
  assert.deepEqual(build("shopee", {}), {
    shopId: "70001",
    globalProduct: false,
    body: { item_id: 123456789, stock_list: [{ seller_stock: [{ stock: 17 }] }] },
  });
  assert.deepEqual(build("lazada", { request: { Request: { Product: { Skus: { Sku: [{ SellerSku: "MY-SKU" }] } } } } }), {
    country: "my",
    itemId: "123456789",
    queryParams: {},
    request: { Request: { Product: { Skus: { Sku: [{ SellerSku: "MY-SKU", quantity: "17" }] } } } },
  });
  assert.deepEqual(build("coupang", {}), { sellerProductId: "123456789", quantity: 17 });
  assert.deepEqual(build("smartstore", { body: { originProduct: { name: "상품", stockQuantity: 3 }, smartstoreChannelProduct: { channelProductName: "상품" } } }), {
    originProductNo: "123456789",
    mode: "origin-product",
    quantity: 17,
    body: { originProduct: { name: "상품", stockQuantity: 17 }, smartstoreChannelProduct: { channelProductName: "상품" } },
  });
  assert.deepEqual(build("temu", { body: { skuList: [{ externalSkuId: "TEMU-SKU" }] } }), {
    goodsId: 123456789,
    quantity: 17,
    body: { goodsId: 123456789, skuList: [{ externalSkuId: "TEMU-SKU", quantity: 17 }] },
  });
  assert.deepEqual(build("ebay", { sku: "EBAY-SKU" }), { sku: "EBAY-SKU", quantity: 17 });
});

test("inventory sync rejects ambiguous multi-option stock instead of overselling", () => {
  assert.throws(() => build("lazada", { request: { Request: { Product: { Skus: { Sku: [{ SellerSku: "A" }, { SellerSku: "B" }] } } } } }), /SINGLE_SKU_REQUIRED/);
  assert.throws(() => build("temu", { body: { skuList: [{ externalSkuId: "A" }, { externalSkuId: "B" }] } }), /SINGLE_SKU_REQUIRED/);
});

test("inventory sync allows zero stock and rejects invalid quantities", () => {
  assert.deepEqual(buildInventoryUpdateArguments({ ...base, channel: "ebay", quantity: 0, draft: { sku: "EBAY-SKU" } }), { sku: "EBAY-SKU", quantity: 0 });
  assert.throws(() => buildInventoryUpdateArguments({ ...base, channel: "ebay", quantity: -1, draft: { sku: "EBAY-SKU" } }), /QUANTITY_INVALID/);
});
