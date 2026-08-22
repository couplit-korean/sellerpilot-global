import type { ActiveChannelKey } from "./catalog";

export type ShipmentDraft = {
  channel: ActiveChannelKey;
  externalOrderId: string;
  carrierCode: string;
  trackingNumber: string;
  shippedAt?: Date;
  providerContext?: Record<string, unknown>;
};

function requiredText(value: string, field: string, max: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`SHIPMENT_FIELD_INVALID:${field}`);
  return normalized;
}

export function buildShipmentArguments(input: ShipmentDraft): Record<string, unknown> {
  const externalOrderId = requiredText(input.externalOrderId, "externalOrderId", 240);
  const carrierCode = requiredText(input.carrierCode, "carrierCode", 40);
  const trackingNumber = requiredText(input.trackingNumber, "trackingNumber", 100);
  const shippedAt = (input.shippedAt ?? new Date()).toISOString();

  if (input.channel === "qoo10") {
    return { params: { OrderNo: externalOrderId, ShippingCorp: carrierCode, TrackingNo: trackingNumber } };
  }
  if (input.channel === "shopee") {
    return { body: { order_sn: externalOrderId, non_integrated: { tracking_number: trackingNumber } } };
  }
  if (input.channel === "coupang") {
    const shipmentBoxId = Number(externalOrderId);
    if (!Number.isSafeInteger(shipmentBoxId) || shipmentBoxId <= 0) throw new Error("SHIPMENT_FIELD_INVALID:shipmentBoxId");
    return {
      body: {
        orderSheetInvoiceApplyDtoList: [{ shipmentBoxId, deliveryCompanyCode: carrierCode, invoiceNumber: trackingNumber }],
      },
    };
  }
  if (input.channel === "smartstore") {
    return {
      body: {
        dispatchProductOrders: [{
          productOrderId: externalOrderId,
          deliveryMethod: "DELIVERY",
          deliveryCompanyCode: carrierCode,
          trackingNumber,
          dispatchDate: shippedAt,
        }],
      },
    };
  }
  if (input.channel === "ebay") {
    return { orderId: externalOrderId, body: { shippingCarrierCode: carrierCode, trackingNumber, shippedDate: shippedAt } };
  }
  if (input.channel === "temu") {
    return { parentOrderSn: externalOrderId, carrierCode, trackingNumber, providerContext: input.providerContext ?? {} };
  }
  if (input.channel === "lazada") throw new Error("SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada");
  throw new Error(`SHIPMENT_CHANNEL_UNAVAILABLE:${input.channel}`);
}
