import type { ActiveChannelKey } from "./catalog";

export type ShipmentDraft = {
  channel: ActiveChannelKey;
  externalOrderId: string;
  carrierCode: string;
  trackingNumber: string;
  shippedAt?: Date;
  providerContext?: Record<string, unknown>;
  shippingParameter?: unknown;
};

function requiredText(value: string, field: string, max: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`SHIPMENT_FIELD_INVALID:${field}`);
  return normalized;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactProviderIdentity(input: ShipmentDraft, externalOrderId: string, field: string) {
  const providerValue = String(input.providerContext?.[field] ?? "").trim();
  if (!providerValue) throw new Error(`SHIPMENT_REMOTE_ID_REQUIRED:${input.channel}.${field}`);
  if (providerValue !== externalOrderId) throw new Error(`SHIPMENT_REMOTE_ID_MISMATCH:${input.channel}.${field}`);
  return providerValue;
}

function positiveSafeInteger(value: string, field: string) {
  const numeric = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`SHIPMENT_FIELD_INVALID:${field}`);
  }
  return numeric;
}

function shopeeIdentity(input: ShipmentDraft, externalOrderId: string) {
  exactProviderIdentity(input, externalOrderId, "orderSn");
  const shopId = String(input.providerContext?.shopId ?? "").trim();
  positiveSafeInteger(shopId, "shopee.shopId");
  return shopId;
}

function shopeeParameterResponse(value: unknown) {
  const payload = record(value);
  const steps = Array.isArray(payload.steps) ? payload.steps.map(record) : [];
  const parameterStep = steps.find((step) => step.name === "shipping-parameter");
  if (!parameterStep || parameterStep.ok !== true) throw new Error("SHOPEE_SHIPPING_PARAMETER_INVALID");
  const response = record(record(parameterStep.data).response);
  const infoNeeded = response.info_needed;
  if (!Array.isArray(infoNeeded) && (!infoNeeded || typeof infoNeeded !== "object")) {
    throw new Error("SHOPEE_SHIPPING_PARAMETER_INVALID");
  }
  return infoNeeded;
}

function shopeeNonIntegratedSupported(infoNeeded: unknown) {
  if (Array.isArray(infoNeeded)) {
    return infoNeeded.some((value) => String(value).trim().toLowerCase() === "non_integrated");
  }
  const modes = record(infoNeeded);
  if (!Object.prototype.hasOwnProperty.call(modes, "non_integrated")) return false;
  const requirements = modes.non_integrated;
  if (Array.isArray(requirements)) {
    const unknownRequirements = requirements
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => value && value !== "tracking_number");
    if (unknownRequirements.length) throw new Error("SHOPEE_SHIPPING_PARAMETER_UNSUPPORTED_REQUIREMENTS");
  } else if (requirements && typeof requirements === "object") {
    const unknownRequirements = Object.keys(record(requirements))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value && value !== "tracking_number");
    if (unknownRequirements.length) throw new Error("SHOPEE_SHIPPING_PARAMETER_UNSUPPORTED_REQUIREMENTS");
  }
  return requirements !== false;
}

export function buildShipmentAcknowledgeArguments(input: ShipmentDraft): Record<string, unknown> | null {
  const externalOrderId = requiredText(input.externalOrderId, "externalOrderId", 240);
  if (input.channel === "qoo10") return { params: { OrderNo: externalOrderId } };
  if (input.channel === "coupang") {
    const shipmentBoxId = positiveSafeInteger(
      exactProviderIdentity(input, externalOrderId, "shipmentBoxId"),
      "shipmentBoxId",
    );
    return { shipmentBoxIds: [shipmentBoxId] };
  }
  if (input.channel === "smartstore") {
    const productOrderId = exactProviderIdentity(input, externalOrderId, "productOrderId");
    return { body: { productOrderIds: [productOrderId] } };
  }
  return null;
}

export function buildShipmentReadbackArguments(input: ShipmentDraft): Record<string, unknown> | null {
  const externalOrderId = requiredText(input.externalOrderId, "externalOrderId", 240);
  if (input.channel !== "coupang") return null;
  const shipmentBoxId = exactProviderIdentity(input, externalOrderId, "shipmentBoxId");
  positiveSafeInteger(shipmentBoxId, "shipmentBoxId");
  return { shipmentBoxId };
}

export function buildShipmentPreflightArguments(input: ShipmentDraft): Record<string, unknown> | null {
  const externalOrderId = requiredText(input.externalOrderId, "externalOrderId", 240);
  if (input.channel !== "shopee") return null;
  const shopId = shopeeIdentity(input, externalOrderId);
  return { shopId, query: { order_sn: externalOrderId } };
}

export function buildShipmentArguments(input: ShipmentDraft): Record<string, unknown> {
  const externalOrderId = requiredText(input.externalOrderId, "externalOrderId", 240);
  const carrierCode = requiredText(input.carrierCode, "carrierCode", 40);
  const trackingNumber = input.channel === "lazada"
    ? input.trackingNumber.trim().slice(0, 100)
    : requiredText(input.trackingNumber, "trackingNumber", 100);
  const shippedAt = (input.shippedAt ?? new Date()).toISOString();

  if (input.channel === "qoo10") {
    return { params: { OrderNo: externalOrderId, ShippingCorp: carrierCode, TrackingNo: trackingNumber } };
  }
  if (input.channel === "shopee") {
    const shopId = shopeeIdentity(input, externalOrderId);
    const infoNeeded = shopeeParameterResponse(input.shippingParameter);
    if (!shopeeNonIntegratedSupported(infoNeeded)) {
      throw new Error("SHOPEE_SHIPPING_MODE_SELECTION_REQUIRED");
    }
    return { shopId, body: { order_sn: externalOrderId, non_integrated: { tracking_number: trackingNumber } } };
  }
  if (input.channel === "coupang") {
    const shipmentBoxId = positiveSafeInteger(
      exactProviderIdentity(input, externalOrderId, "shipmentBoxId"),
      "shipmentBoxId",
    );
    return {
      body: {
        orderSheetInvoiceApplyDtoList: [{ shipmentBoxId, deliveryCompanyCode: carrierCode, invoiceNumber: trackingNumber }],
      },
    };
  }
  if (input.channel === "smartstore") {
    const productOrderId = exactProviderIdentity(input, externalOrderId, "productOrderId");
    return {
      body: {
        dispatchProductOrders: [{
          productOrderId,
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
  if (input.channel === "lazada") {
    const providerContext = input.providerContext ?? {};
    const orderId = String(providerContext.orderId ?? "").trim();
    const orderItemIds = Array.isArray(providerContext.orderItemIds)
      ? providerContext.orderItemIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const deliveryType = String(providerContext.deliveryType ?? "").trim();
    if (orderId !== externalOrderId) throw new Error("SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada.orderId");
    if (!orderItemIds.length) throw new Error("SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada.orderItemIds");
    if (!deliveryType) throw new Error("SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada.deliveryType");
    return { orderId, carrierCode, trackingNumber, providerContext: { ...providerContext, orderId, orderItemIds, deliveryType } };
  }
  throw new Error(`SHIPMENT_CHANNEL_UNAVAILABLE:${input.channel}`);
}
