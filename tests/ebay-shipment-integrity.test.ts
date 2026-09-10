import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { buildShipmentArguments } from "../lib/channels/shipment-draft";
import { executeChannelOperation } from "../lib/channels/operations";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import type { ChannelOperationResult } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});
const { normalizeChannelOrders } = await import("../lib/channels/order-sync");

const orderId = "6498414015!260000000562911";
const lineItems = [{ lineItemId: "LINE-1", quantity: 2 }, { lineItemId: "LINE-2", quantity: 1 }];
const shippedAt = new Date("2026-09-05T03:04:05.000Z");
const shipment = {
  channel: "ebay" as const,
  externalOrderId: orderId,
  carrierCode: "USPS",
  trackingNumber: "TRACK-1",
  shippedAt,
  providerContext: { orderId, lineItems },
};
const body = {
  lineItems,
  shippingCarrierCode: "USPS",
  trackingNumber: "TRACK-1",
  shippedDate: shippedAt.toISOString(),
};
const readyOrder = {
  orderId,
  orderPaymentStatus: "PAID",
  orderFulfillmentStatus: "NOT_STARTED",
  cancelStatus: { cancelState: "NONE_REQUESTED" },
  lineItems: lineItems.map((item) => ({ ...item, lineItemFulfillmentStatus: "NOT_STARTED" })),
};
const fulfilled = { fulfillments: [{ fulfillmentId: "FULFILL-1", ...body }] };
type MockResponse = unknown | (() => Response);

async function runShipment(responses: MockResponse[], argumentsValue: Record<string, unknown> = { orderId, body }) {
  const originalFetch = globalThis.fetch;
  const requests: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    assert.ok(responses.length, "unexpected provider call");
    const response = responses.shift();
    return typeof response === "function" ? response() : Response.json(response);
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "shipment.confirm",
      environment: "sandbox",
      payload: { access_token: "fixture-token" },
      arguments: argumentsValue,
    });
    return { result, requests, completion: gatewayJobCompletionStatus(result.operation, result.ok, result.steps) };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("eBay order sync preserves line item identities and quantities for the exact shipment draft", () => {
  const result: ChannelOperationResult = {
    ok: true, channel: "ebay", operation: "orders.list", safeMessage: "fixture",
    steps: [{ name: "orders", ok: true, status: 200, data: { orders: [readyOrder] } }],
  };
  const [order] = normalizeChannelOrders("ebay", result, shippedAt.toISOString());
  assert.deepEqual(order.providerContext, { orderId, lineItems });
  assert.deepEqual(buildShipmentArguments({ ...shipment, providerContext: order.providerContext }), { orderId, body });
  assert.throws(() => buildShipmentArguments({ ...shipment, providerContext: undefined }), /REMOTE_ID_REQUIRED/);
  assert.throws(() => buildShipmentArguments({ ...shipment, providerContext: { orderId: "OTHER", lineItems } }), /REMOTE_ID_MISMATCH/);
  for (const incomplete of [[], [{ quantity: 1 }], [{ lineItemId: "LINE-1", quantity: 0 }], [lineItems[0], lineItems[0]]]) {
    assert.throws(() => buildShipmentArguments({ ...shipment, providerContext: { orderId, lineItems: incomplete } }), /SHIPMENT_FIELD_INVALID:ebay/);
  }
});

test("eBay FULFILLED orders are shipped rather than delivered or newly paid", () => {
  const result: ChannelOperationResult = {
    ok: true, channel: "ebay", operation: "orders.list", safeMessage: "fixture",
    steps: [{ name: "orders", ok: true, status: 200, data: { orders: [{ ...readyOrder, orderFulfillmentStatus: "FULFILLED" }] } }],
  };
  assert.equal(normalizeChannelOrders("ebay", result, shippedAt.toISOString())[0].status, "shipped");
  for (const [overrides, expected] of [
    [{ orderPaymentStatus: "FULLY_REFUNDED" }, "refunded"],
    [{ cancelStatus: { cancelState: "CANCELED" } }, "cancelled"],
    [{ cancelStatus: { cancelState: "CANCEL_REJECTED" } }, "shipped"],
  ] as const) {
    result.steps[0].data.orders = [{ ...readyOrder, orderFulfillmentStatus: "FULFILLED", ...overrides }];
    assert.equal(normalizeChannelOrders("ebay", result, shippedAt.toISOString())[0].status, expected);
  }
});

test("eBay submits one exact full-order shipment and requires carrier, tracking, line items, quantity and shipped date readback", async () => {
  const { result, requests, completion } = await runShipment([readyOrder, { fulfillments: [] }, () => new Response(null, { status: 201 }), fulfilled]);
  assert.equal(result.ok, true);
  assert.equal(result.remoteId, orderId);
  assert.equal(completion, "succeeded");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET", "POST", "GET"]);
  assert.deepEqual(requests[2].body, body);
  assert.equal(requests[0].path, `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`);
  assert.equal(requests[3].path, `${requests[0].path}/shipping_fulfillment`);
});

test("eBay existing exact fulfillment returns verified without a duplicate POST even after order fulfillment", async () => {
  const { result, requests } = await runShipment([{ ...readyOrder, orderFulfillmentStatus: "FULFILLED" }, fulfilled]);
  assert.equal(result.ok, true);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET"]);
  assert.equal(result.steps.at(-1)?.data.code, "EBAY_SHIPMENT_ALREADY_VERIFIED");
});

test("eBay a cancelled or refunded remote order cannot be returned as successful shipment from an old fulfillment", async () => {
  for (const order of [
    { ...readyOrder, orderFulfillmentStatus: "FULFILLED", cancelStatus: { cancelState: "CANCELED" } },
    { ...readyOrder, orderFulfillmentStatus: "FULFILLED", orderPaymentStatus: "FULLY_REFUNDED" },
  ]) {
    const { result, requests } = await runShipment([order, fulfilled]);
    assert.equal(result.ok, false);
    assert.equal(result.steps.at(-1)?.data.code, "EBAY_SHIPMENT_ORDER_NOT_READY");
    assert.equal(requests.length, 1);
  }
});

test("eBay rejects another order or a subset quantity before the shipment mutation", async () => {
  for (const order of [
    { ...readyOrder, orderId: "OTHER" },
    { ...readyOrder, lineItems: [readyOrder.lineItems[0]] },
    { ...readyOrder, lineItems: [{ ...readyOrder.lineItems[0], quantity: 3 }, readyOrder.lineItems[1]] },
  ]) {
    const { result, requests } = await runShipment([order]);
    assert.equal(result.ok, false);
    assert.equal(requests.length, 1);
    assert.equal(result.steps[0].data.code, "EBAY_SHIPMENT_ORDER_MISMATCH");
  }
});

test("eBay unpaid, cancellation requested, already allocated and missing status orders cannot be shipped", async () => {
  for (const order of [
    { ...readyOrder, orderPaymentStatus: "PENDING" },
    { ...readyOrder, cancelStatus: { cancelState: "CANCEL_REQUESTED" } },
    { ...readyOrder, orderFulfillmentStatus: "IN_PROGRESS" },
    { ...readyOrder, cancelStatus: {} },
    { ...readyOrder, lineItems: lineItems },
  ]) {
    const { result, requests } = await runShipment([order, { fulfillments: [] }]);
    assert.equal(result.ok, false);
    assert.ok(requests.every((request) => request.method === "GET"));
    assert.equal(result.steps.at(-1)?.data.code, "EBAY_SHIPMENT_ORDER_NOT_READY");
  }
});

test("eBay an existing different or duplicate allocation requires reconciliation with zero POSTs", async () => {
  for (const existing of [
    { fulfillments: [{ ...fulfilled.fulfillments[0], trackingNumber: "OTHER" }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], shippingCarrierCode: "UPS" }] },
    { fulfillments: [fulfilled.fulfillments[0], fulfilled.fulfillments[0]] },
  ]) {
    const { result, requests, completion } = await runShipment([readyOrder, existing]);
    assert.equal(result.ok, false);
    assert.equal(completion, "reconciliation_required");
    assert.ok(requests.every((request) => request.method === "GET"));
  }
});

test("eBay malformed or unavailable existing shipment readback never permits POST", async () => {
  for (const existing of [{}, { fulfillments: [], errors: [{ errorId: 1 }] }, () => new Response("temporarily unavailable", { status: 503 }), () => { throw new Error("read timeout"); }]) {
    const { result, requests } = await runShipment([readyOrder, existing]);
    assert.equal(result.ok, false);
    assert.ok(requests.every((request) => request.method === "GET"));
  }
});

test("eBay accepted POST without an exact readback remains reconciliation-required", async () => {
  for (const readback of [
    { fulfillments: [] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], trackingNumber: "OTHER" }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], shippingCarrierCode: "UPS" }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], lineItems: [{ lineItemId: "OTHER", quantity: 2 }, lineItems[1]] }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], lineItems: [{ ...lineItems[0], quantity: 1 }, lineItems[1]] }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], shippedDate: "invalid" }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], shippedDate: "1" }] },
    { ...fulfilled, errors: [{ errorId: 1 }] },
    { fulfillments: [{ ...fulfilled.fulfillments[0], fulfillmentId: "" }] },
    () => { throw new Error("read timeout"); },
  ]) {
    const { result, requests, completion } = await runShipment([readyOrder, { fulfillments: [] }, () => new Response(null, { status: 201 }), readback]);
    assert.equal(result.ok, false);
    assert.equal(completion, "reconciliation_required");
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  }
});

test("eBay explicit shipment rejection remains failed without a readback or automatic second POST", async () => {
  const { result, requests } = await runShipment([
    readyOrder, { fulfillments: [] }, () => Response.json({ errors: [{ errorId: 32300 }] }, { status: 400 }),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET", "POST"]);
  assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, undefined);
});

test("eBay HTTP 503 after a POST keeps uncertainty until one exact readback resolves it", async () => {
  const { result, requests, completion } = await runShipment([
    readyOrder, { fulfillments: [] }, () => new Response("temporarily unavailable", { status: 503 }), { fulfillments: [] },
  ]);
  assert.equal(result.ok, false);
  assert.equal(completion, "reconciliation_required");
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
});

test("eBay lost POST response is recovered only from exact GET and is never resubmitted", async () => {
  for (const readback of [fulfilled, { fulfillments: [] }]) {
    const { result, requests, completion } = await runShipment([
      readyOrder, { fulfillments: [] }, () => { throw new Error("write timeout"); }, readback,
    ]);
    assert.equal(result.ok, readback === fulfilled);
    assert.equal(completion, readback === fulfilled ? "succeeded" : "reconciliation_required");
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  }
});
