import assert from "node:assert/strict";
import test from "node:test";
import { cancelRelease, cloneInventoryLedger, confirmSale, createInventoryLedger, inventoryLedgerSnapshot, receiveStock, reserveStock } from "../lib/inventory/ledger";

for (const [name, finish] of [["confirm", confirmSale], ["cancel", cancelRelease]] as const) {
  test(`cloned pending reservation ${name} cannot mutate or block the original order`, () => {
    const original = createInventoryLedger("LOCAL-CLONE-FIXTURE");
    const order = { channel: "ebay", externalOrderId: "ORDER-1", orderLineKey: "LINE-1", quantity: 2 };
    assert.equal(receiveStock(original, { idempotencyKey: "receipt-clone-fixture", quantity: 5 }).ok, true);
    assert.equal(reserveStock(original, order).ok, true);
    const before = structuredClone(inventoryLedgerSnapshot(original));
    const branch = cloneInventoryLedger(original);
    assert.equal(finish(branch, order).ok, true);
    assert.deepEqual(inventoryLedgerSnapshot(original), before);
    assert.equal(branch.reservationIndex.get(branch.reservations[0].orderKey), branch.reservations[0]);
    assert.notEqual(branch.reservations[0], original.reservations[0]);
    assert.equal(branch.reservations[0].status, name === "confirm" ? "confirmed" : "released");
    assert.equal(finish(original, order).ok, true);
  });
}
