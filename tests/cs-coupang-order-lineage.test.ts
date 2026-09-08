import assert from "node:assert/strict";
import test from "node:test";
import { decideCoupangOrderLineage } from "../lib/cs/channels/coupang/order-lineage";

const credentialA = "00000000-0000-4000-8000-000000005011";
const credentialB = "00000000-0000-4000-8000-000000005012";
const sellerA = "a".repeat(64);
const sellerB = "b".repeat(64);

test("Coupang order binding selects only the same credential incarnation and vendor", () => {
  assert.deepEqual(decideCoupangOrderLineage({
    ticketCredentialId: credentialA,
    ticketSellerAccountKey: sellerA,
    candidates: [
      { id: "order-b", sourceCredentialId: credentialB, sellerAccountKey: sellerB },
      { id: "order-a", sourceCredentialId: credentialA, sellerAccountKey: sellerA },
    ],
  }), { state: "exact", orderId: "order-a" });
});

test("Coupang order binding rejects another vendor and legacy order-number-only rows", () => {
  assert.deepEqual(decideCoupangOrderLineage({
    ticketCredentialId: credentialA,
    ticketSellerAccountKey: sellerA,
    candidates: [{ id: "order-b", sourceCredentialId: credentialB, sellerAccountKey: sellerB }],
  }), { state: "unverifiable_order_lineage", orderId: null });
  assert.deepEqual(decideCoupangOrderLineage({
    ticketCredentialId: credentialA,
    ticketSellerAccountKey: sellerA,
    candidates: [{ id: "legacy-order", sourceCredentialId: null, sellerAccountKey: null }],
  }), { state: "unverifiable_order_lineage", orderId: null });
});

test("Coupang order binding rejects missing credential evidence and duplicate exact rows", () => {
  assert.deepEqual(decideCoupangOrderLineage({
    ticketCredentialId: null,
    ticketSellerAccountKey: null,
    candidates: [{ id: "order-a", sourceCredentialId: credentialA, sellerAccountKey: sellerA }],
  }), { state: "unverified_credential", orderId: null });
  assert.deepEqual(decideCoupangOrderLineage({
    ticketCredentialId: credentialA,
    ticketSellerAccountKey: sellerA,
    candidates: [
      { id: "order-a-1", sourceCredentialId: credentialA, sellerAccountKey: sellerA },
      { id: "order-a-2", sourceCredentialId: credentialA, sellerAccountKey: sellerA },
    ],
  }), { state: "ambiguous_order_lineage", orderId: null });
});
