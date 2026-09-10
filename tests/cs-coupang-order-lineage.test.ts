import assert from "node:assert/strict";
import test from "node:test";
import { decideCoupangOrderLineage } from "../lib/cs/channels/coupang/order-lineage";

const ownerA = "00000000-0000-4000-8000-000000005001";
const ownerB = "00000000-0000-4000-8000-000000005002";
const credentialA = "00000000-0000-4000-8000-000000005011";
const credentialB = "00000000-0000-4000-8000-000000005012";
const sellerA = "a".repeat(64);
const sellerB = "b".repeat(64);
const externalOrderId = "ORDER-5001";
const revisionA = "c".repeat(64);

const exactCandidate = {
  id: "order-a",
  ownerId: ownerA,
  externalOrderId,
  orderRevision: revisionA,
  sourceCredentialId: credentialA,
  sellerAccountKey: sellerA,
};

function decide(overrides: Partial<Parameters<typeof decideCoupangOrderLineage>[0]> = {}) {
  return decideCoupangOrderLineage({
    ticketOwnerId: ownerA,
    externalOrderReference: externalOrderId,
    expectedOrderRevision: revisionA,
    ticketCredentialId: credentialA,
    ticketSellerAccountKey: sellerA,
    candidates: [exactCandidate],
    ...overrides,
  });
}

test("Coupang order binding selects one exact owner, order, credential, and seller lineage", () => {
  assert.deepEqual(decide({
    candidates: [
      { ...exactCandidate, id: "other-owner", ownerId: ownerB },
      { ...exactCandidate, id: "other-order", externalOrderId: "ORDER-OTHER" },
      exactCandidate,
    ],
  }), { state: "exact", orderId: "order-a" });
});

test("Coupang order binding rejects a product order owned by another user", () => {
  assert.deepEqual(decide({
    candidates: [{ ...exactCandidate, ownerId: ownerB }],
  }), { state: "unmatched", orderId: null });
});

test("Coupang order binding rejects another credential or seller lineage", () => {
  for (const candidate of [
    { ...exactCandidate, sourceCredentialId: credentialB },
    { ...exactCandidate, sellerAccountKey: sellerB },
    { ...exactCandidate, sourceCredentialId: null, sellerAccountKey: null },
  ]) {
    assert.deepEqual(decide({ candidates: [candidate] }), {
      state: "unverifiable_order_lineage",
      orderId: null,
    });
  }
});

test("Coupang order binding rejects ambiguous product rows for one external order ID", () => {
  assert.deepEqual(decide({
    candidates: [
      exactCandidate,
      { ...exactCandidate, id: "order-duplicate" },
    ],
  }), { state: "ambiguous_order_lineage", orderId: null });
});

test("Coupang order binding rejects stale evidence from an earlier same-transaction revision", () => {
  assert.deepEqual(decide({
    expectedOrderRevision: "d".repeat(64),
  }), { state: "stale_order_lineage", orderId: null });
  assert.deepEqual(decide({
    expectedOrderRevision: null,
  }), { state: "unverifiable_order_lineage", orderId: null });
});

test("Coupang order binding treats an absent order reference as not applicable", () => {
  for (const externalOrderReference of [null, undefined, "", "   "]) {
    assert.deepEqual(decide({ externalOrderReference }), {
      state: "not_applicable",
      orderId: null,
    });
  }
});

test("Coupang order binding rejects missing ticket identity before considering candidates", () => {
  for (const overrides of [
    { ticketOwnerId: null },
    { ticketCredentialId: null },
    { ticketSellerAccountKey: null },
    { ticketSellerAccountKey: "not-a-provider-key" },
  ]) {
    assert.deepEqual(decide(overrides), {
      state: "unverified_credential",
      orderId: null,
    });
  }
});
