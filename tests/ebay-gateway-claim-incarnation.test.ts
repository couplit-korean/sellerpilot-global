import assert from "node:assert/strict";
import test from "node:test";
import { gatewayClaimSchema } from "../lib/channels/gateway-contract";
import { attachEbayCreateClaimIncarnation } from "../lib/channels/ebay-create-claim";

const claim = {
  id: "004aff8e-7f0c-4c8e-bff5-ac75b395b2cb",
  claim_token: "00000000-0000-4000-8000-000000000001",
  credential_id: "0aca8183-7440-4076-ba0f-679c20259a81",
  attempt_id: "5cb20ea7-8924-4d3f-b74c-c26c3ae0251d",
  credential_version: 211,
  credential_fingerprint: "a".repeat(64),
  channel: "ebay",
  operation: "listing.create",
  environment: "production",
  request: { arguments: {} },
  credential: { access_token: "fixture-only" },
  attempt_count: 1,
};

test("DB CREATE incarnation survives API schema and JSON response into the Mac executor", () => {
  const parsed = gatewayClaimSchema.parse({ ...claim, unrelatedInternalField: "discard" });
  const response = JSON.parse(JSON.stringify(parsed));
  assert.doesNotThrow(() => attachEbayCreateClaimIncarnation(response));
  for (const field of ["attempt_id", "credential_version", "credential_fingerprint"] as const) {
    assert.equal(response[field], claim[field]);
  }
  assert.equal("unrelatedInternalField" in response, false);
});

test("eBay CREATE rejects absent or malformed incarnation before worker dispatch", () => {
  for (const field of ["attempt_id", "credential_version", "credential_fingerprint"] as const) {
    const missing: Record<string, unknown> = { ...claim };
    delete missing[field];
    assert.equal(gatewayClaimSchema.safeParse(missing).success, false, field);
  }
  for (const patch of [
    { attempt_id: null }, { attempt_id: "not-a-uuid" },
    { credential_version: 0 }, { credential_version: 1.5 }, { credential_version: "211" },
    { credential_fingerprint: "short" }, { credential_fingerprint: "x".repeat(64) },
  ]) assert.equal(gatewayClaimSchema.safeParse({ ...claim, ...patch }).success, false);
});

test("other channel claims and eBay reads preserve the existing optional incarnation contract", () => {
  const { attempt_id: _attempt, credential_version: _version, credential_fingerprint: _fingerprint, ...legacy } = claim;
  for (const patch of [
    { channel: "smartstore" }, { channel: "qoo10" },
    { channel: "ebay", operation: "inquiries.list" },
    { channel: "ebay", operation: "listing.update" },
  ]) {
    const parsed = gatewayClaimSchema.parse({ ...legacy, ...patch, attempt_id: null });
    assert.doesNotThrow(() => attachEbayCreateClaimIncarnation(parsed));
  }
});

test("publication reconciliation cannot substitute a different operation attempt", () => {
  const recovery = {
    contract: "sellerpilot-ebay-publication-reconciliation/1",
    sourceJobId: claim.id,
    attemptId: claim.attempt_id,
    credentialId: claim.credential_id,
    sku: "fixture-sku",
    marketplaceId: "EBAY_US",
    offerId: "123456",
    lastStage: "offer",
    requestFingerprint: "a".repeat(64),
  };
  assert.equal(gatewayClaimSchema.safeParse({ ...claim, ebay_publication_reconciliation: recovery }).success, true);
  assert.equal(gatewayClaimSchema.safeParse({
    ...claim,
    ebay_publication_reconciliation: { ...recovery, attemptId: claim.id },
  }).success, false);
});
