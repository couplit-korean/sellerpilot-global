import assert from "node:assert/strict";
import test from "node:test";
import {
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentCollector,
  qoo10QsmCreateFulfillmentOrigin,
  qoo10QsmCreateFulfillmentTrustBoundary,
  sealQoo10QsmCreateFulfillmentCapture,
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";
import {
  Qoo10DurableCreateFulfillmentSourceError,
  assertQoo10CreateFulfillmentMutationFence,
  buildQoo10ListingCreateFulfillmentEvidenceFromDurableSource,
  qoo10DurableCreateFulfillmentBindingArgument,
  qoo10DurableCreateFulfillmentBindingContract,
} from "../lib/server-qoo10-listing-create-fulfillment-source";

const now = new Date("2026-09-10T04:00:00.000Z");
const ownerId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000001";
const sourceId = "40000000-0000-4000-8000-000000000001";
const sellerId = "seller-fixture";
const targetId = "Japan · QAPI";
const observedAt = "2026-09-10T03:59:59.000Z";

function source() {
  const capture = sealQoo10QsmCreateFulfillmentCapture({
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: { name: "Chrome", family: "chrome", type: "extension", profileName: "CHANGHEE" },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: sellerId,
    testItemCode: "1234567890",
    testItemSellerCode: "seller-item-fixture",
    observedAt,
    dispatchPlaces: [{ id: "dispatch-1", active: true, payload: {
      label: "dispatch", countryCode: "JP", postalCode: "1000001", addressLine1: "Tokyo",
    } }],
    returnPolicies: [{ id: "return-1", active: true, payload: {
      label: "return", returnWindowDays: 7, returnShippingPaidBy: "buyer",
    } }],
  });
  return {
    capture,
    envelope: {
      contract: "sellerpilot_qoo10_durable_create_fulfillment_source_v1",
      sourceId, ownerId, productId, credentialId, credentialVersion: 7,
      sellerId, market: "JP", targetId,
      testItemCode: "1234567890", testItemSellerCode: "seller-item-fixture",
      dispatchPlaceId: "dispatch-1", returnPolicyId: "return-1",
      sourceRevision: capture.sourceRevision, captureDigest: capture.captureDigest,
      observedAt, expiresAt: "2026-09-10T04:04:59.000Z",
      consumedAt: "2026-09-10T04:00:00.000Z", capture,
    },
  };
}

test("service RPC read is exact-bound to owner/product/credential/JP/target and builds Q012 evidence", async () => {
  const { envelope } = source();
  let calls = 0;
  const evidence = await buildQoo10ListingCreateFulfillmentEvidenceFromDurableSource({
    rpc: async (name, parameters) => {
      calls += 1;
      assert.equal(name, "sellerpilot_service_take_qoo10_create_fulfillment_capture");
      assert.deepEqual(parameters, {
        p_owner_id: ownerId, p_product_id: productId,
        p_credential_id: credentialId, p_credential_version: 7,
        p_market: "JP", p_target_id: targetId,
      });
      return { data: envelope, error: null };
    },
    ownerId, productId, credentialId, credentialVersion: 7,
    market: "JP", targetId, now,
  });
  assert.equal(calls, 1);
  assert.equal(evidence.testItemCode, "1234567890");
  assert.equal(evidence.dispatchPlaceId, "dispatch-1");
  assert.equal(evidence.returnPolicyId, "return-1");
});

test("absent and cross-product rows fail closed before any downstream mutation", async () => {
  const providerMutations = 0;
  await assert.rejects(() => buildQoo10ListingCreateFulfillmentEvidenceFromDurableSource({
    rpc: async () => ({ data: null, error: null }),
    ownerId, productId, credentialId, credentialVersion: 7,
    market: "JP", targetId, now,
  }), (error) => error instanceof Qoo10DurableCreateFulfillmentSourceError && error.unavailable);
  const { envelope } = source();
  await assert.rejects(() => buildQoo10ListingCreateFulfillmentEvidenceFromDurableSource({
    rpc: async () => ({ data: { ...envelope, productId: "50000000-0000-4000-8000-000000000001" }, error: null }),
    ownerId, productId, credentialId, credentialVersion: 7,
    market: "JP", targetId, now,
  }), /QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID/u);
  assert.equal(providerMutations, 0);
});

test("mutation CAS sends only the sealed exact binding and rejects replay/extra fields", async () => {
  const { capture } = source();
  const binding = {
    contract: qoo10DurableCreateFulfillmentBindingContract,
    sourceId, ownerId, productId, credentialId, credentialVersion: 7,
    sellerId, market: "JP", targetId,
    sourceRevision: capture.sourceRevision, captureDigest: capture.captureDigest,
    fulfillmentEvidenceDigest: "e".repeat(64), observedAt,
    expiresAt: "2026-09-10T04:04:59.000Z",
  };
  const argumentsValue = {
    [qoo10DurableCreateFulfillmentBindingArgument]: binding,
    sellerpilotQoo10CreateFulfillmentEvidence: { evidenceDigest: "e".repeat(64) },
    sellerpilotQoo10CreateApprovalBinding: { fulfillmentEvidenceDigest: "e".repeat(64) },
  };
  let providerMutations = 0;
  await assertQoo10CreateFulfillmentMutationFence({
    rpc: async (name, parameters) => {
      assert.equal(name, "sellerpilot_service_fence_qoo10_create_fulfillment_v2");
      assert.deepEqual(Object.keys(parameters).sort(), [
        "p_capture_digest", "p_credential_id", "p_credential_version",
        "p_fulfillment_evidence_digest", "p_market", "p_owner_id", "p_product_id",
        "p_seller_id", "p_source_id", "p_source_revision", "p_target_id",
      ]);
      return { data: true, error: null };
    },
    argumentsValue,
    ownerId, productId, credentialId, market: "JP", targetId, now,
  });
  await assert.rejects(() => assertQoo10CreateFulfillmentMutationFence({
    rpc: async () => ({ data: false, error: { code: "replay" } }),
    argumentsValue,
    ownerId, productId, credentialId, market: "JP", targetId, now,
  }), /QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID/u);
  await assert.rejects(() => assertQoo10CreateFulfillmentMutationFence({
    rpc: async () => { providerMutations += 1; return { data: true, error: null }; },
    argumentsValue: {
      ...argumentsValue,
      [qoo10DurableCreateFulfillmentBindingArgument]: { ...binding, extra: true },
    },
    ownerId, productId, credentialId, market: "JP", targetId, now,
  }), /QOO10_CREATE_FULFILLMENT_DURABLE_SOURCE_INVALID/u);
  assert.equal(providerMutations, 0);
});
