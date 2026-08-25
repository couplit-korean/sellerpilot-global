import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationName } from "./operations";

type ResourceContext = {
  listingId?: string;
  inventoryItemId?: string;
  orderId?: string;
  carrierCode?: string;
  trackingNumber?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return "";
}

function firstRecord(value: unknown) {
  return Array.isArray(value) ? record(value[0]) : {};
}

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : undefined;
}

function listingIdentity(channel: ActiveChannelKey, operation: ChannelOperationName, argumentsValue: Record<string, unknown>) {
  const params = record(argumentsValue.params);
  const body = record(argumentsValue.body);
  const request = record(argumentsValue.request);
  const requestProduct = record(request.Product);
  const requestSkus = record(requestProduct.Skus);
  const requestSku = firstRecord(requestSkus.Sku);
  const bodyModel = firstRecord(body.model);
  if (channel === "qoo10") return text(params.ItemCode, argumentsValue.itemCode, argumentsValue.remoteId);
  if (channel === "shopee") return text(body.item_id, bodyModel.model_id, argumentsValue.itemId, argumentsValue.item_id);
  if (channel === "lazada") return text(argumentsValue.itemId, requestSku.ItemId, requestSku.SellerSku, requestProduct.ItemId);
  if (channel === "coupang") return text(argumentsValue.vendorItemId, argumentsValue.sellerProductId);
  if (channel === "smartstore") return text(argumentsValue.originProductNo, body.originProductNo);
  if (channel === "ebay") {
    return operation === "price.update"
      ? text(argumentsValue.offerId)
      : text(argumentsValue.sku);
  }
  if (channel === "temu") return text(argumentsValue.goodsId, argumentsValue.skuId, argumentsValue.sku);
  return text(argumentsValue.remoteId, argumentsValue.itemId);
}

function shipmentIdentity(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>) {
  const params = record(argumentsValue.params);
  const query = record(argumentsValue.query);
  const body = record(argumentsValue.body);
  const invoice = firstRecord(body.orderSheetInvoiceApplyDtoList);
  const dispatch = firstRecord(body.dispatchProductOrders);
  if (channel === "qoo10") return text(params.OrderNo, argumentsValue.orderNo);
  if (channel === "shopee") return text(body.order_sn, query.order_sn, argumentsValue.orderSn);
  if (channel === "lazada") return text(argumentsValue.orderId, record(argumentsValue.providerContext).orderId);
  if (channel === "coupang") return text(invoice.shipmentBoxId, firstValue(argumentsValue.shipmentBoxIds));
  if (channel === "smartstore") return text(dispatch.productOrderId, firstValue(body.productOrderIds));
  if (channel === "ebay") return text(argumentsValue.orderId);
  if (channel === "temu") return text(argumentsValue.parentOrderSn, argumentsValue.orderSn);
  return text(argumentsValue.orderId, argumentsValue.orderNo);
}

export function channelWriteResource(input: {
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  arguments: Record<string, unknown>;
  context?: ResourceContext;
}) {
  const context = input.context ?? {};
  let kind: "listing_mutation" | "order_shipment";
  let identity: string;
  if (input.operation === "price.update" || input.operation === "inventory.update") {
    kind = "listing_mutation";
    identity = text(context.listingId) || listingIdentity(input.channel, input.operation, input.arguments);
  } else if (input.operation === "shipment.acknowledge" || input.operation === "shipment.confirm") {
    kind = "order_shipment";
    identity = text(context.orderId) || shipmentIdentity(input.channel, input.arguments);
  } else {
    throw new Error(`CHANNEL_WRITE_RESOURCE_UNSUPPORTED:${input.operation}`);
  }
  if (!identity || identity.length > 500) throw new Error(`CHANNEL_WRITE_RESOURCE_REQUIRED:${input.operation}`);
  return {
    kind,
    key: createHash("sha256").update(`${input.channel}\u0000${kind}\u0000${identity}`).digest("hex"),
    listingId: context.listingId,
    inventoryItemId: context.inventoryItemId,
    orderId: context.orderId,
    carrierCode: context.carrierCode,
    trackingNumber: context.trackingNumber,
  };
}
