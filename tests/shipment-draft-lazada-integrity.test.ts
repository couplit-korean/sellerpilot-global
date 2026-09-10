import assert from "node:assert/strict";
import test from "node:test";
import { buildShipmentArguments, type ShipmentDraft } from "../lib/channels/shipment-draft";

// Local-only contract fixtures. No provider requests or order ledger writes.
const draft: ShipmentDraft = {
  channel: "lazada",
  externalOrderId: "ORDER-1",
  carrierCode: "FM49",
  trackingNumber: "",
  providerContext: { orderId: "ORDER-1", orderItemIds: ["ITEM-1"], deliveryType: "dropship" },
};
const withItems = (orderItemIds: unknown) => ({
  ...draft,
  providerContext: { ...draft.providerContext, orderItemIds },
});
const invalidItems = /SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada\.orderItemIds/;

test("Lazada shipment preserves all valid item identities without mutating the source", () => {
  const input = withItems([" ITEM-1 ", 9102, "9007199254740993"]);
  const before = structuredClone(input);
  assert.deepEqual(buildShipmentArguments(input).providerContext, {
    orderId: "ORDER-1",
    orderItemIds: ["ITEM-1", "9102", "9007199254740993"],
    deliveryType: "dropship",
  });
  assert.deepEqual(input, before);
});

test("Lazada shipment rejects a malformed line instead of silently dropping or stringifying it", () => {
  for (const value of ["", " ", null, undefined, {}, [], true, false, NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildShipmentArguments(withItems(["ITEM-1", value])), invalidItems);
  }
  const sparseItems = new Array(3);
  sparseItems[0] = "ITEM-1";
  sparseItems[2] = "ITEM-3";
  assert.throws(() => buildShipmentArguments(withItems(sparseItems)), invalidItems);
});

test("Lazada shipment rejects duplicate identities before the adapter can silently deduplicate", () => {
  for (const items of [["ITEM-1", "ITEM-1"], ["ITEM-1", " ITEM-1 "], [9101, "9101"]]) {
    assert.throws(() => buildShipmentArguments(withItems(items)), invalidItems);
  }
});

test("Lazada shipment refuses more than the adapter's 100-item bound instead of allowing truncation", () => {
  const items = Array.from({ length: 100 }, (_, index) => `ITEM-${index + 1}`);
  assert.deepEqual((buildShipmentArguments(withItems(items)).providerContext as Record<string, unknown>).orderItemIds, items);
  assert.throws(() => buildShipmentArguments(withItems([...items, "ITEM-101"])), invalidItems);
});

test("Lazada shipment keeps missing item lists and wrong order identity blocked", () => {
  for (const items of [undefined, null, [], "ITEM-1", { id: "ITEM-1" }]) {
    assert.throws(() => buildShipmentArguments(withItems(items)), invalidItems);
  }
  assert.throws(() => buildShipmentArguments({
    ...draft,
    providerContext: { ...draft.providerContext, orderId: "OTHER-ORDER" },
  }), /SHIPMENT_PACKAGE_DETAILS_REQUIRED:lazada\.orderId/);
});
