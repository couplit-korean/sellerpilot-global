// Official contract: https://developer.ebay.com/api-docs/sell/static/orders/handling-unfulfilled-lineitems.html
// Readback: https://developer.ebay.com/api-docs/sell/static/orders/managing-fulfillments.html
// The current order ledger supports one shipment for the entire order. Do not
// accept a subset and then mark the remaining order items as shipped.
export type EbayShipmentLineItem = { lineItemId: string; quantity: number };
export type EbayShipmentBody = {
  lineItems: EbayShipmentLineItem[];
  shippingCarrierCode: string;
  trackingNumber: string;
  shippedDate: string;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

function validShippedDate(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function exactText(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`SHIPMENT_FIELD_INVALID:ebay.${field}`);
  }
  return value.trim();
}

export function ebayShipmentLineItems(value: unknown): EbayShipmentLineItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw new Error("SHIPMENT_FIELD_INVALID:ebay.lineItems");
  }
  const seen = new Set<string>();
  return value.map((value) => {
    const item = record(value);
    const lineItemId = exactText(item.lineItemId, "lineItemId", 240);
    if (seen.has(lineItemId) || typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("SHIPMENT_FIELD_INVALID:ebay.lineItems");
    }
    seen.add(lineItemId);
    return { lineItemId, quantity: item.quantity };
  });
}

export function ebayShipmentBody(value: unknown): EbayShipmentBody {
  const body = record(value);
  const shippedDate = exactText(body.shippedDate, "shippedDate", 40);
  if (!validShippedDate(shippedDate)) {
    throw new Error("SHIPMENT_FIELD_INVALID:ebay.shippedDate");
  }
  return {
    lineItems: ebayShipmentLineItems(body.lineItems),
    shippingCarrierCode: exactText(body.shippingCarrierCode, "shippingCarrierCode", 40),
    trackingNumber: exactText(body.trackingNumber, "trackingNumber", 100),
    shippedDate,
  };
}

export function ebayShipmentItemsMatch(value: unknown, expected: EbayShipmentLineItem[]) {
  try {
    const actual = ebayShipmentLineItems(value);
    return actual.length === expected.length && expected.every((item) => actual.some((candidate) =>
      candidate.lineItemId === item.lineItemId && candidate.quantity === item.quantity));
  } catch {
    return false;
  }
}

export function ebayOrderMatchesShipment(order: Record<string, unknown>, orderId: string, body: EbayShipmentBody) {
  return order.orderId === orderId && ebayShipmentItemsMatch(order.lineItems, body.lineItems);
}

export function ebayOrderPaymentAllowsShipment(order: Record<string, unknown>) {
  return order.orderPaymentStatus === "PAID"
    && record(order.cancelStatus).cancelState === "NONE_REQUESTED";
}

export function ebayOrderReadyForShipment(order: Record<string, unknown>) {
  return ebayOrderPaymentAllowsShipment(order)
    && order.orderFulfillmentStatus === "NOT_STARTED"
    && Array.isArray(order.lineItems)
    && order.lineItems.every((item) => record(item).lineItemFulfillmentStatus === "NOT_STARTED");
}

export function ebayShipmentReadback(data: Record<string, unknown>, expected: EbayShipmentBody) {
  if (!Array.isArray(data.fulfillments)) return { valid: false, empty: false, verified: false };
  const fulfillments = data.fulfillments;
  if (!fulfillments.length) return { valid: true, empty: true, verified: false };
  // Any additional allocation needs manual reconciliation: our UI does not
  // support combining/splitting packages or replacing an existing fulfillment.
  if (fulfillments.length !== 1) return { valid: true, empty: false, verified: false };
  const fulfillment = record(fulfillments[0]);
  const verified = typeof fulfillment.fulfillmentId === "string" && Boolean(fulfillment.fulfillmentId.trim())
    && fulfillment.shippingCarrierCode === expected.shippingCarrierCode
    && fulfillment.trackingNumber === expected.trackingNumber
    && validShippedDate(fulfillment.shippedDate)
    && ebayShipmentItemsMatch(fulfillment.lineItems, expected.lineItems);
  return { valid: true, empty: false, verified, ...(verified ? { fulfillmentId: fulfillment.fulfillmentId as string } : {}) };
}
