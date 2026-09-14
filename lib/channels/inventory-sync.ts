import type { ActiveChannelKey } from "./catalog";

export type InventorySyncTask = {
  id: string;
  listingId: string;
  channel: ActiveChannelKey;
  market: string;
  targetId: string;
  remoteId: string;
  quantity: number;
  status: "pending" | "running" | "succeeded" | "failed" | "superseded";
  safeMessage?: string | null;
};

export type InventorySyncRun = {
  runId: string;
  status: "pending" | "running" | "succeeded" | "partial" | "failed" | "superseded";
  requestedOnHand: number;
  availableQuantity: number;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  tasks: InventorySyncTask[];
};

function record(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`INVENTORY_SYNC_DRAFT_REQUIRED:${key}`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`INVENTORY_SYNC_SINGLE_SKU_REQUIRED:${key}`);
  }
  return value;
}

function numericId(value: string, key: string) {
  if (!/^\d+$/.test(value)) throw new Error(`INVENTORY_SYNC_REMOTE_ID_INVALID:${key}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`INVENTORY_SYNC_REMOTE_ID_INVALID:${key}`);
  return parsed;
}

export function buildInventoryUpdateArguments(input: {
  channel: ActiveChannelKey;
  remoteId: string;
  quantity: number;
  productSku: string;
  market: string;
  targetId: string;
  draft: Record<string, unknown>;
}) {
  const { channel, remoteId, productSku, market, targetId, draft } = input;
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 99_999_999) {
    throw new Error("INVENTORY_SYNC_QUANTITY_INVALID");
  }
  const quantity = input.quantity;
  if (!remoteId.trim()) throw new Error("INVENTORY_SYNC_REMOTE_ID_REQUIRED");

  if (channel === "qoo10") {
    const params = record(draft.params, "qoo10.params");
    return {
      quantity,
      params: {
        ItemCode: remoteId,
        SellerCode: String(params.SellerCode ?? productSku),
        Price: String(params.ItemPrice ?? params.Price ?? ""),
        Qty: String(quantity),
      },
    };
  }
  if (channel === "shopee") {
    return {
      quantity,
      shopId: targetId,
      globalProduct: false,
      body: {
        item_id: numericId(remoteId, "shopee.item_id"),
        stock_list: [{ seller_stock: [{ stock: quantity }] }],
      },
    };
  }
  if (channel === "lazada") {
    const request = record(draft.request, "lazada.request");
    const requestRoot = record(request.Request, "lazada.Request");
    const product = record(requestRoot.Product, "lazada.Product");
    const skus = record(product.Skus, "lazada.Skus");
    record(array(skus.Sku, "lazada.Sku")[0], "lazada.Sku[0]");
    return {
      country: market.toLowerCase(),
      itemId: remoteId,
      quantity,
      queryParams: {},
    };
  }
  if (channel === "coupang") {
    return { sellerProductId: remoteId, quantity };
  }
  if (channel === "smartstore") {
    return {
      originProductNo: remoteId,
      mode: "origin-product",
      quantity,
    };
  }
  if (channel === "temu") {
    const body = record(draft.body, "temu.body");
    const sku = record(array(body.skuList, "temu.skuList")[0], "temu.skuList[0]");
    const externalSkuId = String(sku.externalSkuId ?? "").trim();
    if (!externalSkuId) throw new Error("INVENTORY_SYNC_SELLER_SKU_REQUIRED:temu");
    const goodsId = numericId(remoteId, "temu.goodsId");
    return {
      goodsId,
      quantity,
      body: {
        goodsId,
        skuList: [{ externalSkuId, quantity }],
      },
    };
  }
  const sku = String(draft.sku ?? productSku).trim();
  if (!sku) throw new Error("INVENTORY_SYNC_SELLER_SKU_REQUIRED:ebay");
  return { sku, quantity };
}
